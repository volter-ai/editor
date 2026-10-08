/**
 * A PHOTOGRAPH IS SEEN WHERE IT WAS TAKEN. Owner, 2026-09-28: "when a screenshot is takem in
 * blender, let's show that image in the corner for a little time (like how it happens on macosx)
 * and let's also do the 'camera flash'".
 *
 * So every photograph of the active document (the capture door an agent's
 * `get_viewport_screenshot`, the CLI's `screenshot` and `editor.captureActiveDocument` share)
 * flashes the document's box white and slides the picture into the page's bottom-right corner
 * for a few seconds, the way macOS shows a screenshot it has just taken. Clicking the picture
 * puts it away.
 *
 * Both elements sit OUTSIDE the document's box, in its theme root: a capture photographs the
 * document, so a second photograph taken while the first is still showing cannot contain it.
 * They start only after the capture resolved, so the photograph never holds its own flash.
 *
 * The editor-chrome capture (`cyclotron capture`) shows it too. Its `page` region photographs the
 * whole page, corner included, so it puts away what is showing first (`withdrawPhotograph`). A
 * capture can be named (`cyclotron capture --name "aim up"`); the name is the picture's caption,
 * so a person watching knows what each one was for.
 */

import { activeDocumentContainer } from '@volter/sdk/kit/editor-document-probe';
import { activeWorkspaceDocumentId } from '@volter/sdk/kit/workspace-document-registry';

/** How long the picture stays in the corner; macOS keeps its own for about five seconds. */
const SHOWN_MS = 5_000;
const FLASH_MS = 350;
const SLIDE_MS = 240;

let showing: HTMLElement | null = null;
let flashing: HTMLElement | null = null;

/** Take the corner picture and the flash off the page at once, before the page is photographed. */
export function withdrawPhotograph(): void {
  showing?.remove();
  showing = null;
  flashing?.remove();
  flashing = null;
}

export function announcePhotograph(base64: string, name?: string): void {
  if (typeof document === 'undefined') return;
  const id = activeWorkspaceDocumentId();
  const box = id === null ? null : activeDocumentContainer(id);
  const root =
    box?.closest<HTMLElement>('.volter-editor-theme') ??
    document.querySelector<HTMLElement>('.volter-editor-theme') ??
    document.body;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  if (box && !still) {
    const rect = box.getBoundingClientRect();
    const flash = document.createElement('div');
    flash.dataset['testid'] = 'photograph-flash';
    Object.assign(flash.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: '#ffffff',
      pointerEvents: 'none',
      zIndex: 'var(--volter-z-toast)',
    });
    flashing?.remove();
    flashing = flash;
    root.append(flash);
    flash
      .animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: FLASH_MS, easing: 'ease-out' })
      .finished.finally(() => {
        flash.remove();
        if (flashing === flash) flashing = null;
      });
  }

  showing?.remove();
  const card = document.createElement('button');
  card.type = 'button';
  card.dataset['testid'] = 'photograph-notice';
  card.title = `${name ? `${name}: photograph` : 'Photograph'} taken. Click to put it away.`;
  card.setAttribute('aria-label', name ? `Photograph taken: ${name}` : 'Photograph taken');
  Object.assign(card.style, {
    position: 'fixed',
    right: 'var(--volter-space-4)',
    bottom: '40px',
    width: '220px',
    padding: '0',
    border: '1px solid var(--volter-selection-border)',
    borderRadius: 'var(--volter-radius-md)',
    background: 'var(--volter-surface-raised)',
    boxShadow: 'var(--volter-shadow-lg)',
    overflow: 'hidden',
    cursor: 'pointer',
    zIndex: 'var(--volter-z-toast)',
  });
  const image = document.createElement('img');
  image.src = `data:image/png;base64,${base64}`;
  image.alt = 'The photograph just taken of the document';
  Object.assign(image.style, { display: 'block', width: '100%', height: 'auto' });
  card.append(image);
  if (name) {
    const caption = document.createElement('div');
    caption.dataset['testid'] = 'photograph-name';
    caption.textContent = name;
    Object.assign(caption.style, {
      padding: 'var(--volter-space-1) var(--volter-space-2)',
      font: 'var(--volter-font-ui-sm, 12px system-ui)',
      color: 'var(--volter-text)',
      textAlign: 'left',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    card.append(caption);
  }
  root.append(card);
  showing = card;

  const away = () => {
    if (showing === card) showing = null;
    if (!card.isConnected) return;
    if (still) {
      card.remove();
      return;
    }
    card
      .animate([{ transform: 'translateX(0)' }, { transform: 'translateX(130%)' }], {
        duration: SLIDE_MS,
        easing: 'ease-in',
        fill: 'forwards',
      })
      .finished.finally(() => card.remove());
  };
  card.addEventListener('click', away, { once: true });
  if (!still)
    card.animate([{ transform: 'translateX(130%)' }, { transform: 'translateX(0)' }], {
      duration: SLIDE_MS,
      easing: 'ease-out',
    });
  window.setTimeout(away, SHOWN_MS);
}
