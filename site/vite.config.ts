import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The project website (static, `site/`). The "Try it" demo compiles the extension's real popup
 * and its real service worker code (`src/background/api.ts`, `src/background/tabs.ts`) through
 * the `@/` alias. `wxt/browser` resolves to an in-page stand-in (`src/demo/browserShim.ts`), and
 * `node:util` to a small `parseArgs` (`src/demo/parseArgs.ts`) so the demo terminal can use the
 * CLI's own argument parser (`cli/args.ts`).
 *
 * `SITE_BASE` sets the public base path (GitHub Pages project sites live under `/<repo>/`).
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Absolute URL the site is published at (canonical link, Open Graph). */
const SITE_URL = process.env.SITE_URL ?? 'https://limyuquan.github.io/lanehead/';

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

/**
 * Files that live elsewhere in the repo, served at `<base><prefix>/…` in dev and copied into the
 * build: the extension's toolbar icons (`public/icon/`) and the captured media (`docs/media/`,
 * made by `pnpm media`; GIFs are for the README and stay out). A missing folder is no error: the
 * page shows the poster, or nothing, for media that isn't there.
 */
function repoFiles(): Plugin {
  const dirs = [
    { prefix: 'icon', dir: r('../public/icon'), keep: (f: string) => f.endsWith('.png') },
    {
      prefix: 'media',
      dir: r('../docs/media'),
      keep: (f: string) =>
        /^(hero|agent|switch|edit)\.(png|mp4|webm)$/.test(f) &&
        statSync(join(r('../docs/media'), f)).size > 1024,
    },
  ];
  const list = (dir: string, keep: (f: string) => boolean) =>
    existsSync(dir)
      ? readdirSync(dir).filter((f) => keep(f) && statSync(join(dir, f)).isFile())
      : [];
  let base = '/';
  return {
    name: 'lanehead-repo-files',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(req.url?.split('?')[0] ?? '');
        for (const { prefix, dir, keep } of dirs) {
          const m = new RegExp(`/${prefix}/([\\w.-]+)$`).exec(path);
          const file = m?.[1];
          if (!file || !keep(file) || !existsSync(join(dir, file))) continue;
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          res.end(readFileSync(join(dir, file)));
          return;
        }
        next();
      });
    },
    generateBundle() {
      for (const { prefix, dir, keep } of dirs) {
        for (const f of list(dir, keep)) {
          this.emitFile({
            type: 'asset',
            fileName: `${prefix}/${f}`,
            source: readFileSync(join(dir, f)),
          });
        }
      }
    },
    // Vite rebases publicDir files in index.html; these live outside it.
    transformIndexHtml: (html) =>
      html
        .replaceAll('%SITE_URL%', SITE_URL)
        .replaceAll('"/icon/', `"${base}icon/`)
        .replaceAll('"/media/', `"${base}media/`),
  };
}

export default defineConfig({
  root: r('.'),
  base: process.env.SITE_BASE ?? '/lanehead/',
  publicDir: r('./public'),
  plugins: [tailwindcss(), repoFiles()],
  define: {
    __VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(r('../package.json'), 'utf8')) as { version: string }).version,
    ),
  },
  resolve: {
    alias: [
      { find: 'wxt/browser', replacement: r('./src/demo/browserShim.ts') },
      { find: 'node:util', replacement: r('./src/demo/parseArgs.ts') },
      { find: /^@\//, replacement: `${r('../src')}/` },
    ],
  },
  server: { port: 5191, strictPort: false, fs: { allow: [r('..')] } },
  preview: { port: 4191 },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    reportCompressedSize: false,
  },
});
