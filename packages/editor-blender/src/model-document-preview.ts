/** One last photograph, never a live model or an editable document context. */
export interface ModelDocumentPreview {
  readonly project: string;
  readonly entryId: string;
  readonly path: string;
  readonly image: string;
}

let preview: ModelDocumentPreview | null = null;
const listeners = new Set<() => void>();
let queued = false;

function changed(): void {
  // A pane captures during layout cleanup; notify other roots after the commit.
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const listener of [...listeners]) listener();
  });
}

export function rememberModelDocumentPreview(value: ModelDocumentPreview): void {
  preview = value;
  changed();
}

export function clearModelDocumentPreview(): void {
  if (!preview) return;
  preview = null;
  changed();
}

export function modelDocumentPreview(project: string | null): ModelDocumentPreview | null {
  return preview?.project === project ? preview : null;
}

export function subscribeModelDocumentPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
