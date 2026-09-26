/** Save barriers run while the server and command relay are still live.
 * Never put them in onEnded: that signal is forced resource teardown. */
const handlers = new Set<() => Promise<void>>();
let preparing: Promise<void> | null = null;

export function onBeforeSessionClose(handler: () => Promise<void>): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

export function prepareSessionClose(): Promise<void> {
  if (preparing) return preparing;
  preparing = Promise.all([...handlers].map(handler => Promise.resolve().then(handler)))
    .then(() => undefined)
    .finally(() => { preparing = null; });
  return preparing;
}
