/**
 * EDITOR NOTIFICATIONS — the one door for a transient, event-shaped message
 * the editor has for the human: an agent presented a view, the editor server
 * went away, a document reloaded from disk. Persistent STATE — "the editor is
 * disconnected", "play is running" — belongs on the status bar
 * (`workspace-status-registry.ts`), where a glance answers it; a notification
 * is for the moment something HAPPENED.
 *
 * ## WHO SHOWS IT: the workbench, and only the workbench
 *
 * A notification is the workbench's own toast, raised through
 * `INotificationService` by the fork's `vgaiNotifications.ts`. This module is
 * the door every caller already uses — `notify()`, which is also what
 * `EditorHost.notify` delegates to — plus the by-id replace and dismiss
 * contract both sides honour. It draws nothing itself, and there is no second
 * surface for it to draw into.
 *
 * The payload maps exactly onto VS Code's, and both halves were measured
 * rather than assumed: `NotificationAction.keeps` ("the card stays after this
 * action runs") IS VS Code's SECONDARY action, while a plain action is
 * PRIMARY; and `detail` is joined to the title with an em dash, because
 * `NotificationMessage` is `string | Error` and NOT markdown.
 *
 * WHAT IS SAID BEFORE ANYONE CAN HEAR IT is queued, not dropped — see
 * {@link setNotificationDelegate}. A message with nowhere else to go is still
 * a message; it just waits for the surface instead of getting a second one.
 *
 * NOT here, and measured rather than assumed: `transient-hint.ts`. A hint is
 * a stage-local, three-second whisper over the viewport (45 call sites), not
 * an event-shaped message for the human — the workbench has no counterpart
 * and it stays ours whole.
 */

export type NotificationTone = 'info' | 'warning' | 'error';

export interface NotificationAction {
  readonly label: string;
  readonly run: () => void;
  /** The one action drawn as the primary button. */
  readonly primary?: boolean;
  /** Keep the card after this action runs (default: the card dismisses). */
  readonly keeps?: boolean;
}

export interface EditorNotification {
  readonly id: string;
  readonly tone: NotificationTone;
  /** One line, bold — what happened. */
  readonly title: string;
  /** The rest, plain — what it means, what to do. */
  readonly detail?: string;
  readonly actions?: readonly NotificationAction[];
  /** Stay until dismissed. Default: warnings, errors and action-bearing
   *  cards stay; a plain info card hides after {@link INFO_NOTIFICATION_MS}. */
  readonly sticky?: boolean;
  /** Hide after {@link INFO_NOTIFICATION_MS} even though the tone is a
   *  warning — a report of a moment (a refused gesture), not a state. */
  readonly fades?: boolean;
  /** Called when the card leaves for any reason (dismiss, action, timeout). */
  readonly onDismiss?: () => void;
}

/**
 * How a notification REACHES THE PERSON: the workbench's own
 * `INotificationService`, installed by the fork's contribution once it has
 * one. `show` returns the dismiss, exactly as {@link notify} does.
 */
export interface NotificationDelegate {
  show(notification: EditorNotification): () => void;
}

let _delegate: NotificationDelegate | null = null;
/** Live notifications by id, so `dismissNotification(id)` — which several
 *  callers use instead of the closure `notify()` returns — reaches the toast
 *  too. Without it a card would be undismissable by id, silently. */
const _delegated = new Map<string, () => void>();
/**
 * WHAT IS SAID BEFORE ANYONE CAN HEAR IT. The editor mounts before the
 * contribution has `INotificationService` (a `ServicesAccessor` is valid only
 * for the synchronous part of a command), and a `notify()` in that window is
 * still a message. It waits here and is shown in order the moment the delegate
 * arrives, rather than being drawn into a tray of our own that nobody looks at
 * twice — there is one notification surface and it is the workbench's.
 */
let _pending: EditorNotification[] = [];

/**
 * Install how the frame shows one, and flush anything said before it could.
 * Passing `null` stops delegation: further notifications wait again.
 */
export function setNotificationDelegate(delegate: NotificationDelegate | null): void {
  _delegate = delegate;
  if (!delegate) return;
  const waiting = _pending;
  _pending = [];
  for (const notification of waiting) showThroughDelegate(delegate, notification);
}

/** Show one through the delegate, keeping the by-id dismiss reachable. */
function showThroughDelegate(
  delegate: NotificationDelegate,
  notification: EditorNotification,
): () => void {
  // Replace-by-id is the door's contract on both sides.
  _delegated.get(notification.id)?.();
  const close = delegate.show(notification);
  const dismiss = () => {
    if (_delegated.get(notification.id) !== dismiss) return;
    _delegated.delete(notification.id);
    close();
    notification.onDismiss?.();
  };
  _delegated.set(notification.id, dismiss);
  return dismiss;
}

let _seq = 0;

/** Publish (or replace, by id). Returns the dismiss. */
export function notify(input: Omit<EditorNotification, 'id'> & { id?: string }): () => void {
  const id = input.id ?? `notification-${++_seq}`;
  const notification: EditorNotification = { ...input, id };
  if (_delegate) return showThroughDelegate(_delegate, notification);
  // Nothing can draw it yet. Queue, replacing any earlier message with this id
  // — the same replace-by-id contract the delegate path has.
  _pending = [..._pending.filter((n) => n.id !== id), notification];
  return () => dismissNotification(id);
}

export function dismissNotification(id: string): void {
  const delegated = _delegated.get(id);
  if (delegated) {
    delegated();
    return;
  }
  const waiting = _pending.find((n) => n.id === id);
  if (!waiting) return;
  _pending = _pending.filter((n) => n.id !== id);
  waiting.onDismiss?.();
}
