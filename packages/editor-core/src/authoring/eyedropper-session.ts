/**
 * Eyedropper session (D3.d) — a module-level subscribable singleton bridging the
 * C1 `ColorPicker` (mounted inside the Inspector panel) and the canvas
 * (`RootSelectionOverlay`), the two SIBLING React trees a "click the eyedropper
 * button, then click somewhere on the canvas" gesture must cross when the native
 * `EyeDropper` API is unavailable (the FALLBACK path this whole module exists
 * for — see `ColorPicker.tsx`'s `handleEyedropper` and the `ColorSampleProvider`
 * contract doc comment for why the native path needs none of this: it samples
 * real rendered pixels itself).
 *
 * Mirrors `world-session-state.ts`'s "bare module singleton" shape, but keeps
 * its OWN subscriber list (rather than piggybacking on `EditorShellStore.
 * notifyIngestEdit`) since this is transient cross-panel UI state, not an
 * authored/session toggle any editor-store snapshot needs to carry.
 *
 * Only ONE fallback pick can be in flight at a time — beginning a new one
 * silently supersedes whatever was pending (mirrors the ColorPicker's own
 * "one popover at a time" assumption; nothing today opens two eyedroppers at
 * once).
 */

export type EyedropperApply = (color: string | null) => void;

let activeApply: EyedropperApply | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Begin a fallback eyedropper session — `apply` is the widget's own
 *  sampled-color callback, called exactly once when the session resolves
 *  (`null` color means "cancelled", e.g. Escape — never a fabricated color). */
export function beginEyedropperSession(apply: EyedropperApply): void {
  activeApply = apply;
  notify();
}

/** True while a fallback session is awaiting a canvas click/Escape. */
export function isEyedropperSessionActive(): boolean {
  return activeApply !== null;
}

/** Resolve the active session with a sampled color (or `null` to cancel),
 *  then close it. A no-op if no session is active. */
export function resolveEyedropperSession(color: string | null): void {
  const apply = activeApply;
  if (!apply) return;
  activeApply = null;
  notify();
  apply(color);
}

/** Subscribe to session begin/end transitions — `RootSelectionOverlay` binds
 *  this via `useSyncExternalStore` so it re-renders (shows/hides the cursor
 *  swatch) the instant a session starts or ends. */
export function subscribeEyedropperSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
