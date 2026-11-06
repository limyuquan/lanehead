import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { wireCopyButtons } from './copy';
import { Demo } from './demo/Demo';
import './site.css';

// ---- The demo. ----
const root = document.getElementById('demo-root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  );
}

// ---- Copy buttons. ----
wireCopyButtons();

// ---- Media: captured clips from docs/media. ----
// Each <video data-src="…/name"> gets its sources (webm, mp4) once it is near the viewport, and
// plays only while visible. With reduced motion it stays on its poster. A clip whose poster and
// video are both missing hides its frame.
const still = matchMedia('(prefers-reduced-motion: reduce)');

function hide(video: HTMLVideoElement) {
  video.closest('[data-media-frame]')?.setAttribute('data-missing', '');
}

function attach(video: HTMLVideoElement) {
  if (video.dataset.attached) return;
  video.dataset.attached = '1';
  const base = video.dataset.src ?? '';
  for (const [ext, type] of [
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ] as const) {
    const s = document.createElement('source');
    s.src = `${base}.${ext}`;
    s.type = type;
    video.append(s);
  }
  // The last source failing means no clip: keep the poster if there is one.
  video.lastElementChild?.addEventListener('error', () => {
    video.dataset.failed = '1';
    if (video.dataset.poster === 'missing') hide(video);
  });
  video.load();
}

const videos = [...document.querySelectorAll<HTMLVideoElement>('video[data-src]')];
for (const video of videos) {
  const poster = video.getAttribute('poster');
  if (poster) {
    const img = new Image();
    img.onload = () => {
      video.dataset.poster = 'ok';
      video.closest('[data-media-frame]')?.setAttribute('data-ready', '');
    };
    img.onerror = () => {
      video.dataset.poster = 'missing';
      video.removeAttribute('poster');
      if (still.matches || video.dataset.failed) hide(video);
    };
    img.src = poster;
  }
  video.addEventListener('loadeddata', () =>
    video.closest('[data-media-frame]')?.setAttribute('data-ready', ''),
  );
}

const io = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) {
      const video = target as HTMLVideoElement;
      if (still.matches) continue;
      if (isIntersecting) {
        attach(video);
        video.play().catch(() => {
          // Autoplay refused (data saver, low power): the poster stays.
        });
      } else if (!video.paused) video.pause();
    }
  },
  { rootMargin: '200px 0px' },
);
for (const video of videos) io.observe(video);

still.addEventListener('change', () => {
  for (const video of videos) {
    if (still.matches) {
      video.pause();
      video.currentTime = 0;
    }
  }
});
