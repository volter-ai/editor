/**
 * WHETHER A MODEL DOCUMENT IS PLAYING (the header's Play, `blender-header-menus.tsx`; drawn by
 * `blender-runtime.document.tsx`). Playing, the document's area shows a detached copy of the
 * model (`BlenderRuntimeView.detach`) that the project's play script moves
 * (`play-script.ts`); the model, its selection and its history stand as they were, and Stop
 * returns to them. Kept for the page's life and never stored: a reload opens the model, not a
 * game.
 */
const listeners = new Set<() => void>();
const playing = new Set<string>();
const stops = new Map<string, (escape: boolean) => void>();

export function modelPlaying(documentId: string): boolean {
  return playing.has(documentId);
}

export function setModelPlaying(documentId: string, value: boolean): void {
  if (playing.has(documentId) === value) return;
  if (!value && stops.has(documentId)) { stops.get(documentId)!(false); return; }
  if (value) playing.add(documentId);
  else playing.delete(documentId);
  for (const listener of [...listeners]) listener();
}

export function finishModelPlay(documentId: string): void {
  stops.delete(documentId);
  setModelPlaying(documentId, false);
}

export function escapeModelPlay(documentId: string): void {
  const stop = stops.get(documentId);
  if (stop) stop(true);
  else finishModelPlay(documentId);
}

export function registerModelPlayStop(documentId: string, stop: (escape: boolean) => void): () => void {
  stops.set(documentId, stop);
  return () => { if (stops.get(documentId) === stop) stops.delete(documentId); };
}

export function subscribeModelPlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
