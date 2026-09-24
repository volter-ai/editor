/*---------------------------------------------------------------------------------------------
 *  A NOTIFICATION IS THE WORKBENCH'S TOAST — WORK.md §The core is Code-OSS U8.
 *
 *  The vgai editor has one door for an event-shaped message to the human: `notify()` in
 *  `@editor/editor-notifications`, which `EditorHost.notify` also delegates to. Standalone it
 *  draws a stack of cards at the bottom right; under the frame it is `INotificationService`,
 *  and the editor's own tray is not written at all (the ruling's rule 6 — delete, never
 *  coexist — reads on a per-`notify()` basis here: two notifications for one call is exactly
 *  the "legacy shell path kept beside the VS Code one" it forbids).
 *
 *  THE MAPPING, and the one thing it could have got wrong. `NotificationAction.keeps` means
 *  "the card stays after this action runs", and VS Code has it: a SECONDARY action does not
 *  close the notification while a PRIMARY one does (`INotificationActions`, verbatim). So the
 *  two action kinds map exactly, and nothing about the editor's payload had to be dropped or
 *  approximated. `detail` is joined to the title with an em dash, because a VS Code
 *  notification's `message` is `string | Error` and NOT markdown (measured: a
 *  `MarkdownString` does not typecheck against `NotificationMessage`), so the editor's two
 *  fields become the toast's one line, which the notification itself expands when it is long.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiNotificationsBridge`,
 *  the editor's door reshaped into the facts a toast needs. Its counterpart is `bridge.tsx`'s
 *  `VgaiNotificationsHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { localize } from '../../../../nls.js';
import { IAction, toAction } from '../../../../base/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

/** One notification, as the editor publishes it. Mirrors `EditorNotification` minus the parts
 *  only the editor's own tray reads (its auto-hide timing, which is the toast's own concern). */
export interface VgaiNotification {
	readonly id: string;
	readonly tone: 'info' | 'warning' | 'error';
	readonly title: string;
	readonly detail?: string;
	readonly actions?: readonly { readonly label: string; readonly run: () => void; readonly primary?: boolean; readonly keeps?: boolean }[];
	readonly sticky?: boolean;
	/** The toast's "Source:" line — the served product's display name. */
	readonly source?: string;
}

export interface VgaiNotificationsBridge {
	/** Install how the frame shows one; the returned function closes that toast. `null` hands
	 *  notifications BACK to the editor's own tray, which is what a teardown means here. */
	setDelegate(show: ((notification: VgaiNotification) => () => void) | null): void;
}

function severityOf(tone: VgaiNotification['tone']): Severity {
	switch (tone) {
		case 'error': return Severity.Error;
		case 'warning': return Severity.Warning;
		default: return Severity.Info;
	}
}

export class VgaiNotifications extends Disposable {

	constructor(
		bridge: VgaiNotificationsBridge,
		@INotificationService notificationService: INotificationService,
	) {
		super();
		bridge.setDelegate(notification => {
			const primary: IAction[] = [];
			const secondary: IAction[] = [];
			for (const [index, action] of (notification.actions ?? []).entries()) {
				// `keeps` IS VS Code's secondary action: "a notification does not close
				// automatically when invoking a secondary action" (INotificationActions).
				(action.keeps ? secondary : primary).push(toAction({
					id: `vgai.notification.${notification.id}.${index}`,
					label: action.label,
					run: () => action.run(),
				}));
			}
			const handle = notificationService.notify({
				id: `vgai.${notification.id}`,
				severity: severityOf(notification.tone),
				message: notification.detail ? `${notification.title} — ${notification.detail}` : notification.title,
				source: notification.source ?? localize('vgaiNotificationSource', "Editor"),
				sticky: notification.sticky,
				...(primary.length || secondary.length ? { actions: { primary, secondary } } : {}),
			});
			return () => handle.close();
		});
		// Handing them BACK on teardown, rather than leaving a delegate that calls into a
		// disposed service: the editor's own tray is a real destination and a dropped message
		// is not.
		this._register(toDisposable(() => bridge.setDelegate(null)));
	}
}
