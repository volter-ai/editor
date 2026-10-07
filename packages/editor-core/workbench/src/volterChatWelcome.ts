/*---------------------------------------------------------------------------------------------
 * The Chat welcome while no coding agent is ready (docs/CHAT-WELCOME.md), drawn with the
 * workbench's own Button, codicons and theme colors. The chat extension owns the state
 * (`supercode.frontend.setupState`) and both actions; this draws what it reports. Without a
 * version 1 answer the Markdown welcome stays exactly as it was. ChatWidget and
 * ChatViewWelcomePart call in here through scripts/workbench/overlay.mjs (patchChatSetupWelcome).
 *--------------------------------------------------------------------------------------------*/

import './media/volter-chat-welcome.css';
import * as dom from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { escapeIcons } from '../../../../base/common/iconLabels.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';

const SETUP_STATE = 'supercode.frontend.setupState';
const BEGIN_SETUP = 'supercode.frontend.beginSetup';
const CANCEL_SETUP = 'supercode.frontend.cancelSetup';

export interface ChatSetupRow {
	readonly harness: string;
	readonly name: string;
	/** The account people pay for, as shown: 'ChatGPT' | 'Claude'. */
	readonly provider: string;
	readonly installed: boolean;
	readonly signedIn: boolean;
	readonly account: string | null;
	readonly phase: 'idle' | 'installing' | 'signing-in' | 'failed' | 'signed-in';
	readonly buttonLabel: string;
	readonly caption: string;
	readonly busy: boolean;
	readonly operationId: string | null;
}

/** `supercode.frontend.setupState`, version 1. */
export interface ChatSetupState {
	readonly version: 1;
	readonly visible: boolean;
	readonly title: string;
	readonly subtitle: string;
	readonly footnote: string;
	readonly composerPlaceholder: string;
	readonly composerEnabled: boolean;
	readonly rows: readonly ChatSetupRow[];
	readonly signedInNotice: string | null;
}

const PHASES: readonly unknown[] = ['idle', 'installing', 'signing-in', 'failed', 'signed-in'];

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only what this draws is checked; the rest of a row is the extension's. */
function isRow(row: unknown): row is ChatSetupRow {
	return record(row) && typeof row.harness === 'string' && PHASES.includes(row.phase)
		&& typeof row.buttonLabel === 'string' && typeof row.caption === 'string' && typeof row.busy === 'boolean'
		&& (row.operationId === null || typeof row.operationId === 'string');
}

function isState(state: unknown): state is ChatSetupState {
	return record(state) && state.version === 1 && typeof state.visible === 'boolean'
		&& typeof state.title === 'string' && typeof state.subtitle === 'string' && typeof state.footnote === 'string'
		&& typeof state.composerPlaceholder === 'string' && typeof state.composerEnabled === 'boolean'
		&& Array.isArray(state.rows) && state.rows.every(isRow)
		&& (state.signedInNotice === null || typeof state.signedInNotice === 'string');
}

/**
 * One read of the extension's setup state, answered locally by the extension (no polling,
 * no host round trip). `undefined` instead of a read when no extension registered the
 * command, because asking must never activate one. A throw, another version or another
 * shape answers `undefined`, which keeps today's Markdown welcome.
 */
export function readChatSetupState(accessor: ServicesAccessor): Promise<ChatSetupState | undefined> | undefined {
	if (!CommandsRegistry.getCommand(SETUP_STATE)) {
		return undefined;
	}
	return accessor.get(ICommandService).executeCommand<unknown>(SETUP_STATE).then(state => isState(state) ? state : undefined, () => undefined);
}

/**
 * The welcome while no agent is ready: title and subtitle, one full-width button per agent
 * (the first primary, the rest secondary), one status slot under each (the caption, Cancel
 * or the error, so nothing below it moves), then the footnote.
 */
export function renderChatSetupWelcome(parent: HTMLElement, state: ChatSetupState, commands: ICommandService, log: ILogService): IDisposable {
	const store = new DisposableStore();
	const run = (id: string, ...args: unknown[]) => commands.executeCommand(id, ...args)
		.then(undefined, error => log.error('Chat setup: ' + id + ' failed', error));
	const root = dom.append(parent, dom.$('.volter-chat-setup'));
	dom.append(root, dom.$('.volter-chat-setup-title')).textContent = state.title;
	dom.append(root, dom.$('.volter-chat-setup-subtitle')).textContent = state.subtitle;
	state.rows.forEach((row, index) => {
		const group = dom.append(root, dom.$('.volter-chat-setup-row'));
		const button = store.add(new Button(group, { ...defaultButtonStyles, secondary: index > 0, supportIcons: true, disabled: row.busy }));
		// The label is the extension's text, never icon syntax; only the spinner is ours.
		const label = escapeIcons(row.buttonLabel);
		button.label = row.busy ? '$(' + ThemeIcon.modify(Codicon.loading, 'spin').id + ') ' + label : label;
		let starting = false;
		store.add(button.onDidClick(() => {
			// One click starts one setup; the extension's next state redraws this welcome.
			if (!row.busy && !starting) {
				starting = true;
				run(BEGIN_SETUP, row.harness).finally(() => { starting = false; });
			}
		}));
		const status = dom.append(group, dom.$('.volter-chat-setup-status'));
		if (row.phase === 'failed') {
			status.classList.add('error');
			status.append(renderIcon(Codicon.error), dom.$('span', undefined, localize('volterChatSetup.failed', "Sign-in didn't finish.")));
		} else if (row.busy && row.operationId !== null) {
			// Only an operation the extension can name can be cancelled (an install shows its caption).
			const operationId = row.operationId;
			const cancel = dom.append(status, dom.$('a.volter-chat-setup-cancel', { role: 'button', tabindex: '0' }, localize('volterChatSetup.cancel', "Cancel")));
			const onCancel = (event: Event) => {
				dom.EventHelper.stop(event, true);
				run(CANCEL_SETUP, row.harness, operationId);
			};
			store.add(dom.addDisposableListener(cancel, dom.EventType.CLICK, onCancel));
			store.add(dom.addStandardDisposableListener(cancel, dom.EventType.KEY_DOWN, event => {
				if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
					onCancel(event.browserEvent);
				}
			}));
		} else {
			status.textContent = row.caption;
		}
	});
	dom.append(root, dom.$('.volter-chat-setup-footnote')).textContent = state.footnote;
	return store;
}

/** After an explicit sign-in: one muted line at the top of the new chat, until its first request. */
export function renderChatSignedInNotice(parent: HTMLElement, notice: string): void {
	// The design's circled check is the `pass` codicon.
	dom.append(parent, dom.$('.volter-chat-signed-in', undefined, renderIcon(Codicon.pass), dom.$('span', undefined, notice)));
}

/** The view's own progress bar, for as long as the returned disposable lives. */
export function showChatSetupProgress(accessor: ServicesAccessor, viewId: string): IDisposable {
	const done = new DeferredPromise<void>();
	accessor.get(IProgressService).withProgress({ location: viewId }, () => done.p).then(undefined, () => { /* not a progress location: no bar */ });
	return toDisposable(() => done.complete());
}
