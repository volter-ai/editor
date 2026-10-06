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
import { isCancellationError } from '../../../../base/common/errors.js';
import { localize, localize2 } from '../../../../nls.js';
import { IAgentHostEnablementService } from '../../../../platform/agentHost/common/agentHostEnablementService.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../../chat/browser/chat.js';
import { IHarnessChatNavigationService } from './volterChatNavigation.js';

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
	async run(accessor: ServicesAccessor, value: string): Promise<{ resource: string }> {
		const resource = URI.parse(value);
		if (resource.scheme !== 'supercode') { throw new Error('Expected a Volter Harness chat session.'); }
		const widget = await accessor.get(IChatWidgetService).openSession(resource, ChatViewPaneTarget, { revealIfOpened: true });
		const selected = widget?.viewModel?.sessionResource.toString();
		if (selected !== resource.toString()) { throw new Error('The requested conversation was not selected.'); }
		return { resource: selected };
	}
});

// Readiness may reveal automatically after an extension-host round trip. Keep
// the observed native focus current throughout the same activation transaction.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.revealReadySession', title: localize2('revealReadyHarnessChat', 'Reveal Ready Harness Conversation'), f1: false }); }
	async run(accessor: ServicesAccessor, value: string, expectedFocus: string | null): Promise<{ resource: string }> {
		const resource = URI.parse(value);
		if (resource.scheme !== 'supercode') { throw new Error('Expected a Volter Harness chat session.'); }
		if (expectedFocus !== null && typeof expectedFocus !== 'string') { throw new Error('Expected the observed native conversation focus.'); }
		const widgets = accessor.get(IChatWidgetService);
		const navigation = accessor.get(IHarnessChatNavigationService);
		const focused = widgets.lastFocusedWidget;
		// A blank chat that is not a harness conversation holds nothing a person chose: the workbench restores one
		// on every page reload, and the extension is never told of it (focus is reported once a harness chat is
		// seen). Counted as focus, it refused every readiness reveal after a reload, leaving the running turn and
		// its approval cards out of sight (t_39dac582). It also matches no focus; a chat with requests or typed input,
		// and every harness chat, still guard. An extension that was told of the blank chat still matches it exactly.
		const resourceOf = (widget: typeof focused) => widget?.viewModel?.sessionResource.toString() ?? null;
		const blank = (widget: typeof focused) => {
			const viewModel = widget?.viewModel;
			return Boolean(viewModel && viewModel.sessionResource.scheme !== 'supercode' && !viewModel.model.hasRequests && !widget!.getInput().trim());
		};
		const matches = () => expectedFocus === resourceOf(focused) || (expectedFocus === null && blank(focused));
		const focusedResource = resourceOf(focused);
		const expected = matches();
		let unchanged = true;
		const isCurrent = () => unchanged && expected && matches()
			&& widgets.lastFocusedWidget === focused
			&& resourceOf(focused) === focusedResource
			&& (!focused || widgets.getAllWidgets().includes(focused));
		const listener = widgets.onDidChangeFocusedSession(() => { unchanged = isCurrent(); });
		try {
			return await navigation.run(resource, async permit => {
				const widget = await widgets.openSession(resource, ChatViewPaneTarget, { revealIfOpened: true, harnessNavigationPermit: permit });
				const selected = widget?.viewModel?.sessionResource.toString();
				if (selected !== resource.toString()) { throw new Error('The ready conversation was not selected.'); }
				return { resource: selected };
			}, undefined, isCurrent);
		} finally { listener.dispose(); }
	}
});

// Bound conversations activate through the awaited native navigation boundary.
// Focus bookkeeping (including newly materialized sessions) must not race it.
class HarnessChatFocus extends Disposable {
	static readonly ID = 'volter.harnessChatFocus';
	constructor(
		@IChatWidgetService widgets: IChatWidgetService,
		@IHarnessChatNavigationService navigation: IHarnessChatNavigationService,
		@INotificationService notifications: INotificationService,
	) {
		super();
		let last: string | undefined;
		let lastResource: URI | undefined;
		let lastWidget: typeof widgets.lastFocusedWidget;
		let generation = 0;
		let observingHarness = false;
		const sync = () => {
			const widget = widgets.lastFocusedWidget;
			const resource = widget?.viewModel?.sessionResource;
			const key = resource?.toString();
			if (key === last) { return; }
			const materialized = widget === lastWidget && lastResource?.scheme === 'supercode'
				&& lastResource.path.startsWith('/untitled-') && resource?.scheme === 'supercode'
				&& !resource.path.startsWith('/untitled-');
			last = key;
			lastResource = resource;
			lastWidget = widget;
			const current = ++generation;
			observingHarness ||= resource?.scheme === 'supercode';
			if (!observingHarness) { return; }
			void navigation.syncFocus(resource, () => current === generation
				&& widgets.lastFocusedWidget?.viewModel?.sessionResource.toString() === key, materialized).catch(error => {
				if (isCancellationError(error)) { return; }
				if (current !== generation) { return; }
				last = undefined;
				notifications.error(error);
			});
		};
		this._register(widgets.onDidChangeFocusedSession(sync));
		sync();
	}
}
registerWorkbenchContribution2(HarnessChatFocus.ID, HarnessChatFocus, WorkbenchPhase.AfterRestored);

// Versioned support for native confirmation cards that answer a running turn.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.inTurnApprovalCapability', title: localize2('inTurnApprovalCapability', 'Native In-Turn Approval Capability'), f1: false }); }
	run() { return { version: 1 }; }
});

// Read-only diagnostics for the product's native Chat/runtime boundary.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'volter.chat.inspect', title: localize2('inspectHarnessChat', 'Inspect Chat Runtime'), f1: false }); }
	run(accessor: ServicesAccessor) {
		const widget = accessor.get(IChatWidgetService).lastFocusedWidget;
		const navigation = accessor.get(IHarnessChatNavigationService);
		return {
			builtInAgentHostEnabled: accessor.get(IAgentHostEnablementService).enabled.get(),
			sessionResource: widget?.viewModel?.sessionResource.toString(),
			input: widget?.getInput(),
			activeConversationResource: navigation.activeResource,
			navigationOutcome: navigation.outcome,
			passive: widget?.viewModel?.sessionResource.scheme === 'supercode'
				&& !widget.viewModel.sessionResource.path.startsWith('/untitled-')
				&& widget.viewModel.sessionResource.toString() !== navigation.activeResource,
		};
	}
});
