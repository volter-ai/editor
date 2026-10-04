/*---------------------------------------------------------------------------------------------
 *  NATIVE CHAT, BRIDGED FOR THE SUPERCODE SESSION PROVIDER.
 *
 *  Code-OSS owns the composer, transcript, toolbar, menus and session list; the bundled
 *  `supercode-frontend-vscode` extension adapts the runtime's protocol; the editor host owns
 *  runtime lifecycle (`packages/editor-core/server/frontend-controls.ts`). These are the few
 *  doors this Code-OSS pin does not give an extension session provider on its own.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { IAgentHostEnablementService } from '../../../../platform/agentHost/common/agentHostEnablementService.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../../chat/browser/chat.js';

const CHAT_EXTENSION = new ExtensionIdentifier('volter-ai-dev.supercode-frontend-vscode');

// The native permissions picker supports provider-defined permission groups,
// but this Code-OSS pin only exposes its menu for built-in session types.
// Contribute the existing action for our session; the workbench owns its UI.
MenuRegistry.appendMenuItem(MenuId.ChatInputSecondary, {
	command: { id: 'workbench.action.chat.openPermissionPicker', title: localize('runtimePermissions', 'Set Permissions') },
	group: 'navigation', order: 1,
	when: ContextKeyExpr.equals('chatSessionType', 'supercode'),
});

// The pinned extension API can publish sessions but cannot reveal a specific
// resource in the sidebar. Keep this bridge limited to the native widget service.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.openSession', title: localize2('openHarnessChat', 'Open Harness Conversation'), f1: false }); }
	async run(accessor: ServicesAccessor, value: string): Promise<void> {
		const resource = URI.parse(value);
		if (resource.scheme !== 'supercode') { throw new Error('Expected a Volter Harness chat session.'); }
		await accessor.get(IChatWidgetService).openSession(resource, ChatViewPaneTarget, { revealIfOpened: true });
	}
});

// A draft belongs to a resource, not whichever Chat widget happened to have focus.
// Do not submit input, create a session, or switch to a different conversation here.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.fillInput', title: localize2('fillHarnessChat', 'Fill Harness Conversation Input'), f1: false }); }
	async run(accessor: ServicesAccessor, value: string, prompt: string) {
		const resource = URI.parse(value);
		if (resource.scheme !== 'supercode' || typeof prompt !== 'string' || !prompt.trim()) {
			throw new Error('Expected a Volter Harness conversation and a nonempty draft.');
		}
		const widgets = accessor.get(IChatWidgetService);
		const widget = widgets.getWidgetBySessionResource(resource);
		if (!widget || !(await widgets.reveal(widget))) { throw new Error('This conversation is no longer open.'); }
		if (widget.viewModel?.sessionResource.toString() !== resource.toString()) {
			throw new Error('The conversation changed before its input could be filled.');
		}
		widget.setInput(prompt);
		widget.focusInput();
		return { sessionResource: resource.toString(), input: widget.getInput() };
	}
});

// Cached native chat models can be revealed without asking their content provider
// again. Notify the adapter on focus so its model/permission catalogue follows
// that exact conversation before the next request.
class HarnessChatFocus extends Disposable {
	static readonly ID = 'volter.harnessChatFocus';
	constructor(
		@IChatWidgetService widgets: IChatWidgetService,
		@ICommandService commands: ICommandService,
		@IExtensionService extensions: IExtensionService,
		@INotificationService notifications: INotificationService,
	) {
		super();
		let last: string | undefined;
		const sync = () => {
			const resource = widgets.lastFocusedWidget?.viewModel?.sessionResource;
			if (resource?.scheme !== 'supercode' || resource.path.startsWith('/untitled-')) { return; }
			const key = resource.toString();
			if (key === last) { return; }
			last = key;
			void extensions.activateById(CHAT_EXTENSION, {
				startup: false, extensionId: CHAT_EXTENSION, activationEvent: 'onChatSession:supercode',
			}).then(() => commands.executeCommand('supercode.frontend.activateSession', key)).catch(error => {
				if (last === key) { last = undefined; }
				notifications.error(error);
			});
		};
		this._register(widgets.onDidChangeFocusedSession(sync));
		sync();
	}
}
registerWorkbenchContribution2(HarnessChatFocus.ID, HarnessChatFocus, WorkbenchPhase.AfterRestored);

// Read-only diagnostics for the product's native Chat/runtime boundary.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.inspect', title: localize2('inspectHarnessChat', 'Inspect Chat Runtime'), f1: false }); }
	run(accessor: ServicesAccessor) {
		const widget = accessor.get(IChatWidgetService).lastFocusedWidget;
		return {
			builtInAgentHostEnabled: accessor.get(IAgentHostEnablementService).enabled.get(),
			sessionResource: widget?.viewModel?.sessionResource.toString(),
			input: widget?.getInput(),
		};
	}
});
