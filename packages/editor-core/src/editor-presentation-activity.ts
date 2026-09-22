/** Host visibility controls presentation work, never document ownership. */
interface PresentationActivity {
  hostActive: boolean;
  readonly listeners: Set<() => void>;
}

// Existing renderer sessions can survive a replacement of this module. Keep
// their subscriptions and the host's last answer on the same shared object.
const hotData = import.meta.hot?.data;
const activity: PresentationActivity = hotData?.presentationActivity ?? {
  hostActive: true,
  listeners: new Set<() => void>(),
};
if (hotData) hotData.presentationActivity = activity;

export function isEditorPresentationActive(): boolean {
  return activity.hostActive && (typeof document === 'undefined' || !document.hidden);
}
function changed(): void {
  for (const listener of activity.listeners) listener();
}

const parentOrigin =
  typeof document !== 'undefined' && document.referrer ? new URL(document.referrer).origin : null;

function receive(event: MessageEvent): void {
  if (window.parent === window || event.source !== window.parent) return;
  if (!parentOrigin || event.origin !== parentOrigin) return;
  if (event.data?.type !== 'vgai:embed-activity' || typeof event.data.active !== 'boolean') return;
  if (activity.hostActive === event.data.active) return;
  activity.hostActive = event.data.active;
  changed();
}
export function subscribeEditorPresentationActivity(listener: () => void): () => void {
  activity.listeners.add(listener);
  return () => {
    activity.listeners.delete(listener);
  };
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', receive);
  document.addEventListener('visibilitychange', changed);
  if (window.parent !== window && parentOrigin) {
    window.parent.postMessage({ type: 'vgai:request-embed-activity' }, parentOrigin);
  }
  import.meta.hot?.dispose(() => {
    window.removeEventListener('message', receive);
    document.removeEventListener('visibilitychange', changed);
  });
}
