/**
 * WHETHER A MODEL DOCUMENT'S AREA IS SPLIT, with the Render view beside the modeling viewport
 * (View ▸ Area ▸ Vertical Split, `blender-header-menus.tsx`; drawn by
 * `blender-runtime.document.tsx`). Blender keeps its areas in the file's screen; this editor's
 * screen is the workbench's, so the split is kept per document on this machine, the way the
 * workbench keeps its own layout, and never written into the `.blend`.
 */
const STORAGE_PREFIX = 'volter.blender.render-view-split:';
const listeners = new Set<() => void>();
const split = new Map<string, boolean>();

function stored(documentId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + documentId) === '1';
  } catch {
    return false;
  }
}

export function renderViewSplit(documentId: string): boolean {
  let value = split.get(documentId);
  if (value === undefined) {
    value = stored(documentId);
    split.set(documentId, value);
  }
  return value;
}

export function setRenderViewSplit(documentId: string, value: boolean): void {
  if (renderViewSplit(documentId) === value) return;
  split.set(documentId, value);
  try {
    if (value) globalThis.localStorage?.setItem(STORAGE_PREFIX + documentId, '1');
    else globalThis.localStorage?.removeItem(STORAGE_PREFIX + documentId);
  } catch {
    // A page without storage keeps the split for its own life.
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeRenderViewSplit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
