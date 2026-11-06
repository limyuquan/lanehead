/**
 * Copy buttons for the page's prompts and commands. Markup (index.html):
 *
 *   <div class="copy" data-copy>
 *     <code data-copy-text>…</code>
 *     <button data-copy-btn><span data-copy-label>Copy</span></button>
 *     <span role="status" aria-live="polite" data-copy-status></span>
 *   </div>
 *
 * A click copies the code's exact text, says "Copied" for a moment and announces it. If the
 * clipboard is refused, the text is selected instead, so Ctrl/⌘+C copies it.
 */
const SHOWN_MS = 1800;

async function write(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function select(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function wireCopyButtons(root: ParentNode = document) {
  for (const box of root.querySelectorAll<HTMLElement>('[data-copy]')) {
    const source = box.querySelector('[data-copy-text]');
    const button = box.querySelector<HTMLButtonElement>('[data-copy-btn]');
    const label = box.querySelector('[data-copy-label]');
    const status = box.querySelector('[data-copy-status]');
    if (!source || !button || !label) continue;
    const idle = label.textContent ?? 'Copy';
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', async () => {
      const ok = await write((source.textContent ?? '').trim());
      if (!ok) select(source);
      label.textContent = ok ? 'Copied' : 'Selected';
      button.toggleAttribute('data-copied', ok);
      if (status)
        status.textContent = ok ? 'Copied to clipboard.' : 'Selected. Press Ctrl+C to copy.';
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = idle;
        button.removeAttribute('data-copied');
        if (status) status.textContent = '';
      }, SHOWN_MS);
    });
  }
}
