/**
 * WHETHER THE WORKBENCH IS SHOWING A PART — the one fact about the Code-OSS frame's layout a page
 * module needs without importing the bridge. The bridge records each part as the workbench offers
 * or withdraws it (`bridge.tsx`'s `offerVgaiPart`); `null` means there is no frame, and the
 * editor's panels are in the page.
 */
let framed = false;
const shown = new Set<string>();
const listeners = new Set<() => void>();

/** The bridge: a part was offered (`true`) or withdrawn (`false`). */
export function setFramePartShown(part: string, isShown: boolean): void {
  framed = true;
  if (shown.has(part) === isShown) return;
  if (isShown) shown.add(part);
  else shown.delete(part);
  for (const listener of listeners) listener();
}

/** Whether the frame shows `part`; `null` without a frame. */
export function framePartShown(part: string): boolean | null {
  return framed ? shown.has(part) : null;
}

export function subscribeFrameParts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
