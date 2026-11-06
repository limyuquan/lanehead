/**
 * Films a scene frame by frame. The scene drives the real extension and CLI, hands each fresh
 * capture (page, popup) to the stage (stage.html), and says how long to hold it or where the
 * cursor goes; every output frame is a screenshot of the stage. Time is virtual (frame count), so
 * the pacing is the same on every run however slow the machine is, and unchanged frames are hard
 * links to the previous one. `finish()` encodes mp4, webm, gif and the poster with ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Locator, Page } from '@playwright/test';
import { EXTENSION_PATH } from '../../tests/e2e/fixtures';

export const FPS = 30;
export const OUT_DIR = path.resolve('media');
/** Stage size in CSS px, and its device scale: the videos are 1920×1200. */
export const STAGE = { w: 1200, h: 750, scale: 1.6 };

type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export interface Geometry {
  win: Rect;
  /** The page area, in stage px; the captured page's viewport is this size. */
  content: Rect;
  term?: Rect;
  tabW: number;
  /** The extension button's left edge, inside the window. */
  extLeft: number;
}

function geometry(layout: 'browser' | 'agent'): Geometry {
  const term = layout === 'agent' ? { x: 30, y: 30, w: 500, h: 690 } : undefined;
  const win = term ? { x: 546, y: 30, w: 624, h: 690 } : { x: 36, y: 30, w: 1128, h: 690 };
  // The window has a 1 px border; the tab strip and toolbar take 88 px.
  const content = { x: win.x + 1, y: win.y + 89, w: win.w - 2, h: win.h - 90 };
  return { win, content, ...(term && { term }), tabW: term ? 196 : 232, extLeft: win.w - 70 };
}

export interface Tab {
  title: string;
  active: boolean;
}

/** What the stage shows; see stage.html. */
export interface StageState {
  tabs: Tab[];
  url: string;
  badge: { text: string; color: string } | null;
  page: string | null;
  popup: { img: string; x: number; y: number; w: number; h: number } | null;
  loading: number;
  terminal: { cmd?: string; out?: string; comment?: string; typing?: boolean }[];
  termTitle?: string;
  prompt: boolean;
  cursor: (Point & { down?: boolean }) | null;
  ring: (Point & { r: number; o: number }) | null;
  key: (Point & { label: string; caption?: string; o?: number; right?: boolean }) | null;
  fade: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

let ffmpegPath: string | undefined;
/** ffmpeg on PATH, else Homebrew's; throws a clear error when there is none. */
export function ffmpeg(): string {
  if (ffmpegPath) return ffmpegPath;
  for (const bin of [
    process.env.FFMPEG,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ]) {
    if (bin && spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) {
      ffmpegPath = bin;
      return bin;
    }
  }
  throw new Error(
    'pnpm media needs ffmpeg (with libx264 and libvpx-vp9): `brew install ffmpeg`, or set FFMPEG=/path/to/ffmpeg.',
  );
}

function run(args: string[]) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${r.stderr}`);
}

export class Film {
  readonly g: Geometry;
  state: StageState = {
    tabs: [],
    url: '',
    badge: null,
    page: null,
    popup: null,
    loading: 0,
    terminal: [],
    prompt: false,
    cursor: null,
    ring: null,
    key: null,
    fade: 0,
  };
  private frame = 0;
  private posterFrame = 0;
  private dirty = true;
  private readonly dir: string;
  private seq = 0;

  private constructor(
    private readonly stage: Page,
    readonly name: string,
    layout: 'browser' | 'agent',
  ) {
    this.g = geometry(layout);
    // A private temp dir: a concurrent `playwright test` wipes test-results/ when it starts.
    this.dir = mkdtempSync(path.join(os.tmpdir(), `lh-${name}-`));
  }

  /** A stage page in `browser` (a plain headless browser, no extension). */
  static async open(browser: Browser, name: string, layout: 'browser' | 'agent') {
    const page = await browser.newPage({
      viewport: { width: STAGE.w, height: STAGE.h },
      deviceScaleFactor: STAGE.scale,
      colorScheme: 'dark',
    });
    await page.goto(`file://${path.resolve('scripts/media/stage.html')}`);
    const film = new Film(page, name, layout);
    await film.image('icon', readFileSync(path.join(EXTENSION_PATH, 'icon/32.png')));
    return film;
  }

  /** Registers an image for the stage; returns its key. */
  async image(key: string, png: Buffer): Promise<string> {
    await this.stage.evaluate(
      ([k, b]) =>
        (
          window as unknown as { stage: { image(k: string, b: string): Promise<void> } }
        ).stage.image(k, b),
      [key, png.toString('base64')] as const,
    );
    this.dirty = true;
    return key;
  }

  /** A new image key each time, so the stage never shows a stale decode. */
  async capture(png: Buffer): Promise<string> {
    this.seq += 1;
    return this.image(`i${this.seq}`, png);
  }

  set(patch: Partial<StageState>) {
    Object.assign(this.state, patch);
    this.dirty = true;
  }

  /** Writes one frame (a hard link when nothing changed). */
  private async emit() {
    const file = path.join(this.dir, `f${String(this.frame).padStart(5, '0')}.png`);
    if (this.dirty || this.frame === 0) {
      await this.stage.evaluate(
        ([s, g]) =>
          (
            window as unknown as { stage: { set(s: unknown, g: unknown): Promise<void> } }
          ).stage.set(s, g),
        [this.state, this.g] as const,
      );
      writeFileSync(file, await this.stage.screenshot({ type: 'png' }));
      this.dirty = false;
    } else {
      linkSync(path.join(this.dir, `f${String(this.frame - 1).padStart(5, '0')}.png`), file);
    }
    this.frame += 1;
  }

  /** Holds the current picture for `sec` seconds. */
  async hold(sec: number) {
    const n = Math.max(1, Math.round(sec * FPS));
    for (let i = 0; i < n; i++) await this.emit();
  }

  /** Animates over `sec` seconds; `step(t)` sets the state for t in (0, 1]. */
  async tween(sec: number, step: (t: number) => void) {
    const n = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= n; i++) {
      step(ease(i / n));
      this.dirty = true;
      await this.emit();
    }
  }

  /** Glides the cursor to `to`. */
  async move(to: Point, sec = 0.6) {
    const from = this.state.cursor ?? { x: to.x + 140, y: to.y + 120 };
    await this.tween(sec, (t) =>
      this.set({ cursor: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } }),
    );
  }

  /** Cursor press: down, `act` (the real click), up with a ring. */
  async click(act?: () => Promise<void>) {
    const c = this.state.cursor;
    if (!c) throw new Error('No cursor to click with');
    this.set({ cursor: { ...c, down: true } });
    await this.hold(0.1);
    if (act) await act();
    this.set({ cursor: { ...c, down: false } });
    await this.tween(0.3, (t) =>
      this.set({ ring: { x: c.x, y: c.y, r: 6 + 16 * t, o: 0.8 * (1 - t) } }),
    );
    this.set({ ring: null });
  }

  /** Shows a keycap at the bottom of the window while `act` (the real key press) runs. */
  async key(label: string, caption: string, act: () => Promise<void>, sec = 0.9) {
    // Left of the popup when it is open (where the eye is; the popup may grow), else at the
    // bottom of the page.
    const p = this.state.popup;
    const at = p
      ? { x: p.x - 28, y: p.y + 250, right: true }
      : { x: this.g.content.x + this.g.content.w / 2, y: this.g.win.y + this.g.win.h - 70 };
    await this.tween(0.12, (t) => this.set({ key: { ...at, label, caption, o: t } }));
    await act();
    return async () => {
      await this.hold(sec);
      await this.tween(0.2, (t) => this.set({ key: { ...at, label, caption, o: 1 - t } }));
      this.set({ key: null });
    };
  }

  /** The address bar's load bar, then `page` (the reloaded capture). */
  async load(page: string, sec = 0.45) {
    await this.tween(sec * 0.7, (t) => this.set({ loading: 0.1 + 0.8 * t }));
    this.set({ page, loading: 1 });
    await this.hold(sec * 0.3);
    this.set({ loading: 0 });
  }

  /** Cross-fades back to the first frame, so the loop restarts without a jump. */
  async loopBack(sec = 0.6) {
    await this.image('first', readFileSync(path.join(this.dir, 'f00000.png')));
    await this.tween(sec, (t) => this.set({ fade: t }));
  }

  /** Stage position of a box in the popup capture. */
  popupPoint(box: { x: number; y: number; width: number; height: number }, origin: Point): Point {
    const p = this.state.popup;
    if (!p) throw new Error('No popup on stage');
    return {
      x: p.x + box.x - origin.x + box.width / 2,
      y: p.y + box.y - origin.y + box.height / 2,
    };
  }

  /** Where the popup sits for a capture `w`×`h`: under the extension button, right-aligned. */
  popupAt(img: string, w: number, h: number): StageState['popup'] {
    const right = this.g.win.x + 1 + this.g.extLeft + 28 + 12;
    return { img, x: right - w, y: this.g.content.y + 4, w, h };
  }

  /** Centre of the extension button, in stage px. */
  get extButton(): Point {
    return { x: this.g.win.x + 1 + this.g.extLeft + 14, y: this.g.win.y + 1 + 42 + 9 + 14 };
  }

  /** Centre of tab `i` in the strip. */
  tabPoint(i: number): Point {
    return {
      x: this.g.win.x + 1 + 92 + i * (this.g.tabW + 2) + this.g.tabW * 0.4,
      y: this.g.win.y + 25,
    };
  }

  /** The next frame is the poster (default: the first). */
  poster() {
    this.posterFrame = this.frame;
  }

  get seconds() {
    return this.frame / FPS;
  }

  /** Encodes `<name>.mp4`, `.webm`, `.gif` and the poster `<name>.png` into media. */
  async finish(): Promise<{ file: string; bytes: number }[]> {
    await this.stage.close();
    mkdirSync(OUT_DIR, { recursive: true });
    const input = ['-framerate', String(FPS), '-i', path.join(this.dir, 'f%05d.png')];
    const out = (ext: string) => path.join(OUT_DIR, `${this.name}.${ext}`);
    copyFileSync(
      path.join(this.dir, `f${String(this.posterFrame).padStart(5, '0')}.png`),
      out('png'),
    );
    run([
      ...input,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-tune',
      'animation',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      out('mp4'),
    ]);
    run([
      ...input,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '32',
      '-b:v',
      '0',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-row-mt',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-an',
      out('webm'),
    ]);
    // GIF for the README: ≤ 4 MB. Fewer colors / frames until it fits.
    const budget = 4 * 1024 * 1024;
    for (const [fps, width, colors] of [
      [15, 900, 256],
      [12, 900, 128],
      [10, 900, 96],
      [10, 820, 64],
      [8, 760, 48],
    ] as const) {
      run([
        ...input,
        '-vf',
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        '-loop',
        '0',
        out('gif'),
      ]);
      if (statSync(out('gif')).size <= budget) break;
    }
    rmSync(this.dir, { recursive: true, force: true });
    return ['mp4', 'webm', 'gif', 'png'].map((ext) => ({
      file: out(ext),
      bytes: statSync(out(ext)).size,
    }));
  }
}

/** A capture of `locator` (or the page) as PNG, caret shown (typing must look like typing). */
export function shoot(target: Page | Locator): Promise<Buffer> {
  return target.screenshot({ type: 'png', animations: 'disabled', caret: 'initial' });
}
