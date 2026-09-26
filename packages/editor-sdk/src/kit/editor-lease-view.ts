/**
 * The editor's OWN connection state, as the lease guard measures it
 * (`components/EditorLeaseGuard.tsx`), published for the status bar. VS
 * Code shows its remote connection at the far left of the status bar and
 * turns it red when the host is gone; this is that item's source. State
 * lives here, events (the moment it changed) go to the notification stack.
 */

export type EditorLeaseView =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'degraded'; readonly subject: 'busy' | 'stale' }
  | {
      readonly kind: 'void';
      readonly reason: 'taken-over' | 'server-gone';
      readonly reloadOffered: boolean;
    };

let _view: EditorLeaseView = { kind: 'quiet' };
let _version = 0;
const _listeners = new Set<() => void>();

export function editorLeaseView(): EditorLeaseView {
  return _view;
}

export function publishEditorLeaseView(view: EditorLeaseView): void {
  _view = view;
  _version += 1;
  for (const fn of _listeners) fn();
}

export function subscribeEditorLeaseView(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function editorLeaseViewVersion(): number {
  return _version;
}
