/**
 * The editor's one transient, non-blocking hint channel (H2).
 *
 * There was no toast/notification/status-message mechanism in the editor when
 * this landed (grepped: `toast`, `notification`, `statusMessage`, `hint` —
 * only unrelated hits), so this is the minimal one. Deliberately: one hint at
 * a time (a new one replaces the old), auto-dismissing, carrying nothing but
 * a string it did not write. Blocking dialogs (`window.alert`/`prompt`) are
 * banned in editor UI.
 *
 * Publisher lives here (plain module state, no React) so non-React callers —
 * hotkeys, the action registry — can raise a hint without importing the
 * component. `components/TransientHint.tsx` renders it.
 */

export const TRANSIENT_HINT_MS = 3000;

export interface TransientHint {
  /** Monotonic — lets the renderer restart its animation on a repeat message. */
  readonly id: number;
  readonly message: string;
}

let current: TransientHint | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show `message` for {@link TRANSIENT_HINT_MS}, replacing any live hint. */
export function showTransientHint(message: string): void {
  current = { id: nextId++, message };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    timer = null;
    emit();
  }, TRANSIENT_HINT_MS);
  emit();
}

export function dismissTransientHint(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

export const subscribeTransientHint = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const transientHint = (): TransientHint | null => current;

/**
 * A drag that ended with NOTHING accepting it says so.
 *
 * `dropEffect === 'none'` at `dragend` is the browser's own word that no drop
 * target took the payload: the card was released over editor chrome (a tab
 * strip, the toolbar, a console row) instead of the viewport or a hierarchy
 * row. That used to be perfectly silent — no hint, no console line, nothing
 * changed — and a verifier lost a whole round to it before checking
 * `elementFromPoint` (2026-09-02). A human just sees "the drop did nothing".
 */
export function reportUnacceptedAssetDrop(event: { dataTransfer: DataTransfer | null }): void {
  if (event.dataTransfer?.dropEffect !== 'none') return;
  // Surface-neutral on purpose: the source cannot know whether the scene is
  // three or canvas, and a 2D tester told 'the 3D view' would be misled.
  showTransientHint(
    'Nothing accepted that drop — release it over the scene view or a hierarchy row.',
  );
}
