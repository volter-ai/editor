/*---------------------------------------------------------------------------------------------
 *  THE EDITOR KIT'S WORKBENCH HALF — the vgai editor hosted in Code-OSS PARTS.
 *
 *  THIS FILE LIVES IN THE vgai-engine REPOSITORY (`packages/editor/workbench/src/`) and is
 *  OVERLAID on a Code-OSS checkout at a pin by `scripts/workbench/overlay.mjs`
 *  (ARCHITECTURE-CORE §The target shape, rule 6: nothing of ours is built inside a fork). Edit
 *  it there; a copy inside a fork checkout is build output.
 *
 *  ADDITIVE ONLY in the fork: two overlaid directories plus two import lines in
 *  workbench.common.main.ts — this one and the PRODUCT's (`vgaiProduct.ts`). The vgai editor
 *  itself is served by the `vgai edit` SESSION, which also runs the one-origin proxy this page
 *  is behind; the session's frame entry swaps the SDK layout host so the project's own layout
 *  renders its header, document, hierarchy and inspector into the parts this file hands over:
 *  the title bar, an editor pane and two sidebar views. The status bar is the workbench's own
 *  and every vgai status item is a real entry in it.
 *
 *  IT NAMES NO PRODUCT. What the document is called, what this editor says when it asks for
 *  trust, which themes its look wears and whatever else a product installs come from
 *  `registerVgaiProduct` — one door, read once, refusing by name when the overlay wrote no
 *  product half.
 *--------------------------------------------------------------------------------------------*/

import './media/vgai-parts.css';
import { attachDocumentView, installDocumentViewSink, VgaiDocumentViews } from './vgaiDocumentViews.js';
import { $, Dimension } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { EditorExtensions, IEditorOpenContext, IEditorFactoryRegistry } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { GettingStartedInput } from '../../welcomeGettingStarted/browser/gettingStartedInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { installDefaultTrustedTypesPolicy, installSessionOriginShim, installSessionTabBootstrap, resolveSessionOrigin } from './vgaiSessionOrigin.js';
import { VgaiKeyboard, VgaiKeyboardBridge } from './vgaiKeyboard.js';
import { VgaiHistory, VgaiHistoryBridge } from './vgaiHistory.js';
import { VgaiFiles, VgaiFilesBridge } from './vgaiFiles.js';
import { VgaiCommands, VgaiCommandsBridge } from './vgaiCommands.js';
import { VgaiNotifications, VgaiNotificationsBridge } from './vgaiNotifications.js';
import { VgaiViews, VgaiViewsBridge } from './vgaiViews.js';
import { VgaiOutput, VgaiOutputBridge } from './vgaiOutput.js';
import { VgaiUtilitiesBridge, VgaiUtilityViews } from './vgaiUtilityViews.js';
import { VgaiStatus, VgaiStatusBridge } from './vgaiStatus.js';
import { viewBackgroundFor } from './vgaiColors.js';
import { VgaiSettings, VgaiSettingsBridge } from './vgaiSettings.js';
import { NO_PRODUCT_REGISTERED, vgaiProduct, type VgaiProductMountContext } from './vgaiProduct.js';
import { raiseOpeningCover, VgaiOpeningCover } from './vgaiCover.js';
import { VgaiDocuments, VgaiDocumentsBridge } from './vgaiDocuments.js';
import { VgaiDocumentInput, VgaiDocumentInputSerializer } from './vgaiDocumentInput.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IListService } from '../../../../platform/list/browser/listService.js';
import { COPY_EDITOR_GROUP_INTO_NEW_WINDOW_COMMAND_ID, COPY_EDITOR_INTO_NEW_WINDOW_COMMAND_ID, MOVE_EDITOR_GROUP_INTO_NEW_WINDOW_COMMAND_ID, MOVE_EDITOR_INTO_NEW_WINDOW_COMMAND_ID } from '../../../browser/parts/editor/editorCommands.js';
import { resolveCommandsContext } from '../../../browser/parts/editor/editorCommandsContext.js';

/** THE PRODUCT, read ONCE at load. `undefined` is a build the overlay assembled without a
 *  product half: the registrations below are skipped and the mount command refuses by name,
 *  rather than a pane and a container registering with nothing to name them. */
const product = vgaiProduct();

/**
 * `center:<n>` is a SECOND (third, …) vgai editor pane — the pane VS Code builds for the group
 * an AREA document opened in (WORK.md's Timeline item 1). It is a part for the purpose of
 * FOCUS ONLY: `vgai.stage.focused` must be true when the caret is in the Timeline exactly as
 * it is when the caret is in the Model pane, because both are our stage and neither is Monaco.
 * The bridge's `VscodeParts` still names the three the mount hands over, and an area pane's
 * container reaches the bridge as a per-document SLOT instead (`offerDocumentSlot`).
 */
type PartId = 'center' | 'outliner' | 'properties' | 'content' | `center:${string}`;
/** The parts handed to the bridge, as their DOM elements become available. */
const parts = new Map<PartId, HTMLElement>();
const partWaiters = new Set<() => void>();
/** The one keyboard owner's publisher, once the bridge has mounted (vgaiKeyboard.ts). */
let keyboard: VgaiKeyboard | undefined;
/**
 * WITHDRAW A PART, when the pane that handed it over is disposed (W12).
 *
 * Only the CURRENT holder may withdraw: panes are built and disposed in any order — closing
 * the main group's last editor disposes that pane while the area's pane lives on, and a split
 * builds the new pane before the old one goes — so a late `dispose` from a pane whose element
 * has already been replaced must not delete its successor's part. The bridge is told too, so
 * its centre portal stops pointing at a detached node.
 */
function withdrawPart(id: PartId, element: HTMLElement): void {
	if (parts.get(id) !== element) { return; }
	parts.delete(id);
	keyboard?.untrackPart(id);
	if (id === 'center' || id === 'outliner' || id === 'properties' || id === 'content') {
		void mounted?.then(mount => mount.offerPart?.(id, null)).catch(() => { /* an unmounted bridge has no part to withdraw */ });
	}
}
function offerPart(id: PartId, element: HTMLElement): void {
	element.classList.add('vgai-host-part');
	// A HANDED-OVER PART IS A REAL FOCUSABLE PART. `vgai.stage.focused` and `vgai.focused`
	// are what every one of our keybinding rules is gated on, and they are answered by VS
	// Code's own focus tracking (`trackFocus`) — so the element has to be able to hold
	// focus, and a pointer down in it has to take focus the way clicking any other part
	// does. Without this a click on the stage leaves focus in Monaco and a bare G types a
	// letter into the source file, which is the incident this unit closes from the other
	// side. `focus()` here never fights a real control: the native focus of a clicked
	// input/textarea is the pointerdown's DEFAULT action and runs after this listener.
	element.tabIndex = -1;
	element.addEventListener('pointerdown', () => element.focus({ preventScroll: true }));
	parts.set(id, element);
	keyboard?.trackPart(id, element);
	// THE BRIDGE RE-TARGETS ITS PORTAL. A part offered AFTER the mount is a pane that replaced
	// a disposed one (W12); the mount captured the first element and would otherwise keep
	// drawing into the node that went away with its group.
	if (id === 'center' || id === 'outliner' || id === 'properties' || id === 'content') {
		void mounted?.then(mount => mount.offerPart?.(id, element)).catch(() => { /* not mounted yet: the mount takes the map */ });
	}
	for (const wake of partWaiters) { wake(); }
}
/**
 * THIS PAGE BECOMES ONE OF THE SESSION'S TABS, and the folder's TRUST is settled
 * in the same breath — resolved once, awaited by both callers (the activation
 * contribution below and the mount command).
 *
 * WHY THE TAB IS NOT PART OF THE MOUNT, measured 2026-09-21 on a fresh scaffold:
 * the mount awaits `requestWorkspaceTrust` before it reaches the bootstrap, so
 * for the whole trust window the page was NOT a tab. Chrome held two established
 * connections to the proxy while `vgai status` said "no tab has ever reported"
 * and the CLI said the auto-open had likely failed silently — the product could
 * not tell "nothing opened" from "open, waiting for a person", which are
 * opposite situations with opposite remedies.
 *
 * WHAT THE BOOTSTRAP IS: the SESSION's own script (`/__editor/tab-bootstrap.js`)
 * — a tab identity, the control channel, the heartbeat worker and the goodbye
 * beacon. None of it is the project's code; that is the bridge. It is safe
 * before the editor by its own design: it buffers every routed event for the
 * consumer `editor-presence.ts` becomes at module evaluation, and acts on
 * exactly one instruction itself (`tab-reload`, the one that matters when the
 * module graph never evaluates at all).
 *
 * A SESSION ON THIS FOLDER IS THE TRUST DECISION, already made (owner,
 * 2026-09-21, on their own first open: *"wait why do I have to click that?"*).
 * `vgai edit <folder>` starts a session that RUNS THE FOLDER'S OWN CODE — its
 * dev server executes the project's `vgai.adapter.ts`, its contributions load
 * from the project's `node_modules` — before this page exists at all, by the
 * person's own command. Workspace trust exists to gate exactly that, and
 * finding a live session for THIS folder is finding the decision already taken
 * by the only person the prompt would have asked. So the moment the origin
 * resolves, {@link trustTheSessionsFolder} calls the workbench's OWN
 * `IWorkspaceTrustManagementService.setWorkspaceTrust(true)`.
 *
 * WHAT THAT IS NOT. It is not `security.workspace.trust.enabled`: the trust
 * model stays on, with its own prompt, banner, badge and trust editor
 * untouched, and this writes one entry into the service's own per-folder memory
 * in its own storage — the same entry a person clicking Yes would have written.
 * A folder with no session never reaches the line, so VS Code's prompt is
 * exactly as it was there. And the mount command's `isWorkspaceTrusted()` check
 * STAYS as the gate that bites in that case; it awaits this promise first, so
 * what it reads is the settled answer rather than a race.
 *
 * A FAILURE IS NOT LATCHED. A folder with no live session throws here — an
 * ordinary workbench on an ordinary folder — and the memo is cleared so the
 * mount command resolves again and reports the failure in its own words.
 */
let sessionTab: Promise<string> | undefined;
function connectSessionTab(fileService: IFileService, workspaceService: IWorkspaceContextService, workspaceTrust: IWorkspaceTrustManagementService): Promise<string> {
	if (!sessionTab) {
		sessionTab = (async () => {
			const sessionOrigin = await resolveSessionOrigin(fileService, workspaceService);
			installSessionOriginShim(sessionOrigin);
			// BEFORE the bootstrap: assigning `script.src` is a TrustedScriptURL
			// sink on this page (`vgaiSessionOrigin.ts` states the measurement).
			installDefaultTrustedTypesPolicy();
			await installSessionTabBootstrap(sessionOrigin);
			await trustTheSessionsFolder(workspaceTrust);
			return sessionOrigin;
		})();
		sessionTab.catch(() => { sessionTab = undefined; });
	}
	return sessionTab;
}

/**
 * The trust the session already implies, written through the service's own door.
 *
 * AFTER `workspaceTrustInitialized`, because before it there is nothing to write into: under
 * the REH shape the service waits on `resolveAuthority` and `canSetWorkspaceTrust()` answers
 * false until that lands (`workspaceTrust.ts`'s remote branch). Already-trusted folders and a
 * workspace the service says cannot be set (a remote that decides trust itself) are left
 * alone — this adds the person's own decision, it never overrides the host's.
 *
 * A THROW HERE IS NOT FATAL TO THE TAB. The write failing means the folder stays untrusted,
 * and the mount command's gate is exactly the right thing to happen next; reported through the
 * workbench's own unexpected-error channel so it is not silent.
 */
async function trustTheSessionsFolder(workspaceTrust: IWorkspaceTrustManagementService): Promise<void> {
	try {
		await workspaceTrust.workspaceTrustInitialized;
		if (workspaceTrust.isWorkspaceTrusted() || !workspaceTrust.canSetWorkspaceTrust()) { return; }
		await workspaceTrust.setWorkspaceTrust(true);
	} catch (error) {
		onUnexpectedError(error);
	}
}

function waitForParts(ids: readonly PartId[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const check = () => {
			if (ids.every(id => parts.has(id))) { partWaiters.delete(check); resolve(); }
			else if (Date.now() > deadline) { partWaiters.delete(check); reject(new Error(`parts missing: ${ids.filter(id => !parts.has(id)).join(', ')}`)); }
		};
		partWaiters.add(check);
		check();
		setTimeout(check, timeoutMs + 10);
	});
}

// ---- The editor pane: the document.

// `VgaiDocumentInput` LIVES IN ITS OWN MODULE (`vgaiDocumentInput.ts`) and is re-exported
// here: `vgaiDocuments.ts` needs it, this file needs `VgaiDocuments`, and the two
// importing each other is a cycle the production emit's dependency checker fails on
// by name. Read that file's header for the measurement.
export { VgaiDocumentInput };

export class VgaiDocumentPane extends EditorPane {
	static readonly ID = 'workbench.editor.vgaiDocument';
	private container: HTMLElement | undefined;
	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(VgaiDocumentPane.ID, group, telemetryService, themeService, storageService);
	}
	/**
	 * A vgai PANE IS NOT A TEXT EDITOR, and its minimum height is what makes a Blender AREA
	 * possible at all. `EditorPane`'s default is `DEFAULT_EDITOR_MIN_DIMENSIONS.height` = 70,
	 * and `EditorPart.doRestoreGroup` treats a group sitting at EXACTLY its minimum as one the
	 * person collapsed: it calls `arrangeGroups(EXPAND, group)` on the next activation, which
	 * gives that group the whole centre and puts every other one at ITS minimum.
	 *
	 * Blender's Timeline area is 74 px of a 1029-px centre column — `model.layout.ts`'s
	 * measured `ratio: 0.0719`, about 68 px here — which is BELOW that default, so it clamped
	 * to exactly 70 and then tripped the rule. MEASURED 2026-09-20: a click into the Timeline
	 * pane flipped the split from 882/70 to 70/882, every time, and so did the workbench's own
	 * settling layout. 24 px is the header row `blender-timeline-geometry.ts` draws plus a
	 * line — below that this surface genuinely cannot show anything — and it leaves Blender's
	 * own proportion comfortably inside the range.
	 */
	override get minimumHeight(): number { return 24; }
	override get minimumWidth(): number { return 24; }
	/** The document this pane's container is currently the slot for. */
	private releaseView: (() => void) | undefined;
	/** The part id this pane handed over, withdrawn when it is disposed. */
	private partId: PartId | undefined;
	private static panes = 0;
	protected createEditor(parent: HTMLElement): void {
		this.container = $('.vgai-model-pane');
		this.container.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
		parent.appendChild(this.container);
		// THE PANE HOLDING `center` IS WHICHEVER ONE IS THERE. The first pane is the part the
		// mount waits for and hands to the bridge; a pane built for a workspace AREA's group
		// (WORK.md Timeline item 1) is a second stage surface, not a second `center`, and is
		// offered under its own id so the keyboard's `vgai.stage.focused` covers it while its
		// container reaches the bridge as the SLOT of whatever document it is showing.
		//
		// A LIVE centre is the test, not "has one ever been offered" (W12): closing the last
		// vgai editor disposes that pane with its group, and the pane that opens the document
		// again must BECOME the centre rather than take `center:<n>` beside a dead one.
		this.partId = parts.has('center') ? `center:${VgaiDocumentPane.panes++}` : 'center';
		offerPart(this.partId, this.container);
	}
	/** The group activating this editor focuses the STAGE, so `vgai.stage.focused` is true
	 *  for the same gestures that focus any other editor (a tab click, ⌘1, Go Back). */
	override focus(): void {
		this.container?.focus({ preventScroll: true });
	}
	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested && this.input === input) { this.takeSlot(input); }
	}
	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		this.takeSlot(visible ? this.input : undefined);
	}
	override clearInput(): void {
		this.takeSlot(undefined);
		super.clearInput();
	}
	override dispose(): void {
		this.takeSlot(undefined);
		if (this.partId !== undefined && this.container) { withdrawPart(this.partId, this.container); }
		super.dispose();
	}
	/** VS Code REUSES one pane for every input of its type in a group, and it calls `setInput`
	 *  for the new one without a `clearInput` for the old — so the withdrawal is here, in the
	 *  one place that knows both halves. */
	private takeSlot(input: EditorInput | undefined): void {
		this.releaseView?.();
		this.releaseView = input && this.container ? attachDocumentView(this.group.id, input, this.container) : undefined;
	}

	override layout(_dimension: Dimension): void { /* the vgai document surface measures its own box */ }
}

// THE PANE'S REGISTERED NAME IS THE PRODUCT'S TITLE. It is what the workbench shows where it
// names the KIND of editor rather than the document (the `Reopen Editor With…` list); the tab
// itself carries the document's own title, which is why a models scaffold's editor is called
// `cube`.
if (product) {
	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(VgaiDocumentPane, VgaiDocumentPane.ID, product.title),
		[new SyncDescriptor(VgaiDocumentInput)]
	);
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(VgaiDocumentInput.ID, VgaiDocumentInputSerializer);

// ---- Portal hosts for the native views declared by each product.

abstract class VgaiHostView extends ViewPane {
	protected abstract readonly partId: 'outliner' | 'properties' | 'content';
	private hostBody: HTMLElement | undefined;
	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}
	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.closest('.pane')?.classList.add('vgai-pane');
		this.hostBody = $('.vgai-view-body');
		this.hostBody.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
		container.appendChild(this.hostBody);
		// THE VIEW'S SURFACE COLOUR IS ITS OWN THEME COLOUR (U8, ruling 2) — the same line
		// `vgaiUtilityViews.ts` has, and its absence here is walk 2's beat 5: the Outliner and
		// Properties bodies were TRANSPARENT, so what showed through was `sideBar.background`
		// (#2f2f2f in `theme-blender`) and not the `vgai.view.background` (#303030) the ruling
		// declares. Unset by every theme but ours, so Classic still paints nothing.
		this._register(this.themeService.onDidColorThemeChange(() => this.applyBackground()));
		this.applyBackground();
		offerPart(this.partId, this.hostBody);
		const body = this.hostBody;
		this._register({ dispose: () => withdrawPart(this.partId, body) });
	}
	private applyBackground(): void {
		if (!this.hostBody) { return; }
		// `viewBackgroundFor` keys its per-view rows by UTILITY id; these two are views of the
		// contribution's own, so they take the generic colour — which is the whole point of it.
		const color = viewBackgroundFor(this.themeService.getColorTheme(), this.partId);
		this.hostBody.style.background = color ? color.toString() : '';
	}
	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.hostBody) { this.hostBody.style.height = `${height}px`; this.hostBody.style.width = `${width}px`; }
	}
	/** Focusing the view focuses the vgai panel inside it, not the empty pane body, so
	 *  `vgai.focused` follows the workbench's own focus gestures. */
	override focus(): void {
		if (this.hostBody) { this.hostBody.focus({ preventScroll: true }); } else { super.focus(); }
	}
}
class VgaiOutlinerView extends VgaiHostView { static readonly ID = 'vgai.outliner'; protected readonly partId = 'outliner' as const; }
class VgaiPropertiesView extends VgaiHostView { static readonly ID = 'vgai.properties'; protected readonly partId = 'properties' as const; }

class VgaiContentView extends VgaiHostView { static readonly ID = 'vgai.content'; protected readonly partId = 'content' as const; }
const hostViews = { outliner: VgaiOutlinerView, properties: VgaiPropertiesView, content: VgaiContentView };
// Product defaults register real Code-OSS views. Never impose a Model arrangement on Game.
if (product) {
	for (const container of product.layout.containers) {
		const registered = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
			id: container.id, title: { value: container.title, original: container.title }, icon: Codicon.symbolClass, order: 0,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [container.id, { mergeViewWithContainerWhenSingleView: false }]),
			hideIfEmpty: true,
		}, container.location === 'sidebar' ? ViewContainerLocation.Sidebar : ViewContainerLocation.AuxiliaryBar);
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(container.views.map((view, order) => ({
			id: hostViews[view.part].ID, name: { value: view.title, original: view.title },
			ctorDescriptor: new SyncDescriptor<VgaiHostView>(hostViews[view.part]), canToggleVisibility: true, canMoveView: true,
			weight: view.weight, order,
		})), registered);
	}
}

// ---- The command that assembles the parts and mounts the vgai editor over them.

// WHAT THE FRAME READS OF THE OPEN DOCUMENTS is `vgaiDocuments.ts`'s
// `VgaiDocumentsBridge` — declared there rather than here since the open SET became
// the group's editors (walk 3 beat 19). `activeSource()`'s `path` is PROJECT-RELATIVE
// and may be empty, which is the honest answer for a document that is not a file on
// disk. Optional on the mount so a bridge older than this door is a missing door
// rather than a crash.

// The members this file installs are the KIT's doors. A PRODUCT's own door (`bridge.tsx`'s
// `VgaiGameHandle`, which the game editor's `vgaiGameSkew.ts` consumes) rides the same object
// and is read by the product's `mount` hook, which declares the shape it expects — the two
// sides have always been mirrors, because nothing under `src/vs/` can import React TSX.
interface BridgeMount { output?: VgaiOutputBridge; host: HTMLElement; keyboard: VgaiKeyboardBridge; offerPart?(id: 'center' | 'outliner' | 'properties' | 'content', element: HTMLElement | null): void; documents?: VgaiDocumentsBridge; history?: VgaiHistoryBridge; files?: VgaiFilesBridge; settings?: VgaiSettingsBridge; commands?: VgaiCommandsBridge; notifications?: VgaiNotificationsBridge; views?: VgaiViewsBridge; utilities?: VgaiUtilitiesBridge; status?: VgaiStatusBridge }
interface BridgeModule {
	mountVgai(parts: { chromeRoot: HTMLElement; header: HTMLElement; center: HTMLElement; outliner?: HTMLElement; properties?: HTMLElement; content?: HTMLElement }): Promise<BridgeMount>;
}
let mounted: Promise<BridgeMount> | undefined;
const keyboardStore = new DisposableStore();

/**
 * THE PRODUCT'S COVER over this open (`vgaiCover.ts`). Raised by `VgaiSessionTab` at the first
 * moment the workspace folder is known and taken away by whichever outcome arrives first —
 * there is deliberately no timer here that decides one for it:
 *
 *   * this folder has no session   → `VgaiSessionTab`'s rejection removes it (an ordinary
 *                                    workbench on an ordinary folder, which is the truth)
 *   * this folder is not a project → `VgaiProjectAutoOpen` removes it (nothing of ours will run)
 *   * the person declines trust    → the mount command removes it (the workbench is what is left)
 *   * the editor mounts            → the mount command removes it
 *   * the open refuses or throws   → the cover SAYS SO and grows a way out
 */
let cover: VgaiOpeningCover | undefined;

function hostedSlot(parentSelector: string, className: string): HTMLElement {
	const parent = mainWindow.document.querySelector<HTMLElement>(parentSelector);
	if (!parent) { throw new Error(`${parentSelector} is not in the workbench`); }
	parent.classList.add('vgai-hosted');
	let slot = parent.querySelector<HTMLElement>(`.${className}`);
	if (!slot) { slot = $(`.vgai-host-part.${className}`); parent.appendChild(slot); }
	return slot;
}

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'vgai.workspace.open', title: localize2('vgaiWorkspaceOpen', "Volter Editor: Open Workspace"), category: Categories.View, f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const viewsService = accessor.get(IViewsService);
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const notifications = accessor.get(INotificationService);
		// NO PRODUCT, NO WORKSPACE — and it is said in the workbench's own voice rather than
		// mounted half-way: with no product the pane and the container were never registered,
		// so there is nothing for this command to open.
		if (!product) { cover?.remove(); notifications.error(NO_PRODUCT_REGISTERED); return; }
		// Every service this command needs is taken HERE, before the first await: a
		// `ServicesAccessor` is only valid for the synchronous part of the invocation, and
		// `accessor.get` after an await throws — silently, from inside the mount chain
		// (measured 2026-09-19: the parts were handed over and nothing else ever ran).
		const fileService = accessor.get(IFileService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const contextKeyService = accessor.get(IContextKeyService);
		const instantiationService = accessor.get(IInstantiationService);
		const workspaceTrust = accessor.get(IWorkspaceTrustManagementService);
		const workspaceTrustRequest = accessor.get(IWorkspaceTrustRequestService);
		// AND THE CONFIGURATION SERVICE, which was taken BELOW the trust await until the
		// Timeline lane's walk hit it on 2026-09-20: on an UNTRUSTED folder — a fresh server
		// data dir, which is every first run of a new REH port — the command awaits the trust
		// dialog and then `accessor.get` threw "Illegal state: service accessor is only valid
		// during the invocation of its target method". The workbench showed that as a modal
		// error and the workspace never opened, so the very first launch of the frame on a new
		// project failed and the second one (folder now trusted) succeeded. It is the same
		// rule the comment above states; this line is the one that had escaped it.
		const storage = accessor.get(IStorageService);
		/** What this build's product is handed, spelled ONCE: `mount` installs into it and
		 *  `ready` reads from it, and a second literal would be a second author of the ids. */
		const productContext = (mount: BridgeMount): VgaiProductMountContext => ({
			mount: mount as unknown as Readonly<Record<string, unknown>>,
			ids: { pane: VgaiDocumentPane.ID, hierarchyView: VgaiOutlinerView.ID, inspectorView: VgaiPropertiesView.ID, contentView: VgaiContentView.ID },
			instantiationService,
			store: keyboardStore,
		});
		// WORKSPACE TRUST (U12, ruled 2026-09-19). A vgai project executes its OWN code the
		// moment it opens: its contributions load from its `node_modules`, its dev server runs
		// its config, its game runs in this pane. That is exactly what workspace trust exists
		// to gate, so the frame keeps trust ON and the bridge DOES NOT MOUNT in a restricted
		// workspace — nothing of ours re-implements the prompt, the per-folder memory or the
		// trust editor. `requestWorkspaceTrust` IS the workbench's own prompt; a person who
		// trusts the folder gets the workspace, and a person who declines gets this command
		// refusing by name rather than a pane that half-works. The declarative half of the
		// same ruling is the product's own theme extension manifest carrying
		// `capabilities.untrustedWorkspaces: { supported: false }`, which is what a reader
		// looking at our extension manifests sees.
		//
		// THE SENTENCE IS THE PRODUCT'S, because what runs when the folder is trusted differs
		// by product: a model editor has no game and a game editor has no Blender engine in
		// the tab. The REFUSAL below is this command's own and names it.
		//
		// AND IT IS READ AFTER THE SESSION TAB HAS SETTLED, never beside it: a folder with a
		// live session is one this person has already decided about, and `connectSessionTab`
		// is what records that through the trust service's own door. Awaiting it here is what
		// makes this gate read an ANSWER instead of a race — the tab connection starts at
		// BlockRestore and this command runs at AfterRestored, so without the await the check
		// would fire while the session was still being found and prompt a person who had
		// already said yes by typing `vgai edit`. A rejection is "no session", and then this
		// gate is exactly the right thing to happen.
		await connectSessionTab(fileService, workspaceService, workspaceTrust).catch(() => { /* no session: the gate below asks, and the mount says why */ });
		if (!workspaceTrust.isWorkspaceTrusted()) {
			const trusted = await workspaceTrustRequest.requestWorkspaceTrust({
				message: product.trustSentence,
			});
			if (!trusted) {
				// The cover comes down whole: what is left is the workbench, which is usable,
				// plus this refusal in the workbench's own voice.
				cover?.remove();
				notifications.warn(localize('vgaiTrustRefused', "Volter Editor: Open Workspace needs a trusted folder — this project's own code runs in the pane. Trust the folder and run the command again."));
				return;
			}
		}
		try {
			// Discard only upstream's onboarding, including a restored Welcome tab.
			await editorService.closeEditors(editorService.getEditors(EditorsOrder.SEQUENTIAL).filter(({ editor }) => editor.typeId === GettingStartedInput.ID));
			const layoutKey = `vgai.layout.${product.id}.v1`;
			const firstLayout = !storage.getBoolean(layoutKey, StorageScope.WORKSPACE, false);
			if (firstLayout) {
				layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
				layoutService.setPartHidden(true, Parts.PANEL_PART);
				// THE SECONDARY SIDE BAR IS NEVER HIDDEN ON A FIRST OPEN (B9b). It used to be
				// hidden for a product that declared no container there, which is the model
				// editor — and since ARCHITECTURE-CORE §The core is Code-OSS rule 7 that bar is
				// where the workbench's own Chat view lives, and that view IS this product's
				// agent surface. Upstream already puts it there by default
				// (`chatParticipant.contribution.ts` registers the chat container `isDefault` at
				// `AuxiliaryBar`, and `workbench.secondarySideBar.defaultVisibility` is
				// `visibleInWorkspace`); the old line was what took it away. A product that
				// declares its own auxiliary container still gets that container shown, because
				// the loop below opens its views; a product that declares none gets the Chat view.
				layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			}
			// Keep the native restored tab if a pane already supplies the mount slot.
			if (!parts.has('center')) {
				const restored = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(({ editor }) => editor instanceof VgaiDocumentInput);
				if (restored) { await editorService.openEditor(restored.editor, { preserveFocus: true }, restored.groupId); }
				else { await editorService.openEditor(VgaiDocumentInput.instance, { pinned: true }); }
			}
			// Only a fresh workspace needs product defaults. On later boots the native
			// view service restores visibility and placement; opening every view here
			// would switch containers and undo that restoration just to mount portals.
			if (firstLayout) {
				for (const container of product.layout.containers) {
					for (const view of container.views) {
						await viewsService.openView(hostViews[view.part].ID, false);
					}
				}
			}
			await waitForParts(['center'], 8000);
			if (firstLayout) {
				const sidebar = layoutService.getSize(Parts.SIDEBAR_PART);
				layoutService.resizePart(Parts.SIDEBAR_PART, product.layout.sidebarWidth - sidebar.width, 0);
				storage.store(layoutKey, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
			if (!mounted) {
				const header = hostedSlot('.part.titlebar .titlebar-container', 'vgai-titlebar-host');
				// NO STATUS SLOT. The status bar is the workbench's own — every `workspace.status`
				// contribution is a real `IStatusbarService` entry in it (`vgaiStatus.ts`, U8 step 7),
				// and the spike's hosted slot for `EditorBottomBar` was an empty blob stretched over
				// all of them (walk 2's beat 7: 20-25 entries, each 0x0, no `Hide <item>` reachable).
				// `bridge.tsx`'s `Footer` says what that drops and where the note lives.
				const chromeRoot = mainWindow.document.querySelector<HTMLElement>('.monaco-workbench')!;
				mounted = (async () => {
					// WHERE THE SESSION IS, and this page already being one of its TABS:
					// `connectSessionTab` above, which the activation contribution and this
					// command's own trust gate have both already run — this await is the memo,
					// and it is here for the ORIGIN it returns. It resolves that origin
					// (`vgaiSessionOrigin.ts`: the page's own on the web shape, the port
					// `.vgai/session.json` names on desktop), points this page's root-relative
					// URLs there, installs the session's tab bootstrap and records the trust
					// the session implies.
					const sessionOrigin = await connectSessionTab(fileService, workspaceService, workspaceTrust);
					// THE EDITOR IS THE SESSION'S, and the session says where: its serving door
					// (`/__editor/served-modules`) hands back the url of its own frame entry,
					// mtime-stamped in dev and content-hashed in a production build. Nothing here
					// declares anything and nothing is copied — the door answers with the module
					// the session is already serving.
					const doorUrl = `${sessionOrigin}/__editor/served-modules`;
					const door = await fetch(doorUrl, { headers: { accept: 'application/json' } });
					if (!door.ok) { throw new Error(`the vgai session's serving door answered ${door.status} at ${doorUrl}`); }
					const served = await door.json() as { modules: { id: string; url: string }[]; refusals?: { id: string | null; message: string }[] };
					const bridge = served.modules.find(m => m.id === 'vscode-bridge');
					if (!bridge) {
						const refused = (served.refusals ?? []).map(r => `${r.id ?? '(document)'}: ${r.message}`).join('; ');
						throw new Error(`the vgai session at ${sessionOrigin} serves no "vscode-bridge" module, so there is no editor to mount. Its serving door is /__editor/served-modules (packages/editor/server/routes/served-modules.ts)${refused ? ` and it refused: ${refused}` : ''}`);
					}
					const bridgeUrl = `${sessionOrigin}${bridge.url}`;
					// The serving host owns any development preamble. A packaged product
					// is a normal ESM entry and has no Vite Fast Refresh endpoint.
					const mod = await import(bridgeUrl) as BridgeModule;
					const mount = await mod.mountVgai({ chromeRoot, header, center: parts.get('center')!, outliner: parts.get('outliner'), properties: parts.get('properties'), content: parts.get('content') });
					// KEYBOARD OWNERSHIP, installed the moment the editor is there to dispatch
					// into (vgaiKeyboard.ts, and ARCHITECTURE-CORE §The core is Code-OSS rule 3).
					// The bridge has already told the editor the frame owns the keyboard — it
					// does that BEFORE mounting, so the editor's own dispatcher is never
					// installed — and what arrives here is that editor's action table.
					keyboard = keyboardStore.add(new VgaiKeyboard(mount.keyboard, contextKeyService));
					for (const [id, element] of parts) { keyboard.trackPart(id, element); }
					// UNDO OWNERSHIP, on the same beat and for the same reason (vgaiHistory.ts,
					// and ARCHITECTURE-CORE §The core is Code-OSS). The bridge has already told
					// the editor the frame owns undo — BEFORE mounting, so no entry is ever
					// recorded into a cursor nobody drives — and what arrives here is that
					// editor's recorded elements plus the stream of new ones. Optional on the
					// mount so a bridge older than this member is a missing door, not a crash.
					if (mount.history) { keyboardStore.add(instantiationService.createInstance(VgaiHistory, mount.history)); }
					// AND THE PROJECT'S FILES (vgaiFiles.ts, U5). The bridge has already told the
					// editor the frame owns them; this is where the PROVIDER — the workbench's own
					// `IFileService`/`ITextFileService` over the open folder — is installed, and it
					// is here because those services only exist inside this invocation. Until it
					// lands the door falls back to the session's transports, which is why taking
					// ownership early is safe. This is what makes a vgai write the workbench's own
					// and so closes U4's open: no external-change reload, no text element over
					// ours, no destroyed redo future.
					if (mount.files) { keyboardStore.add(instantiationService.createInstance(VgaiFiles, mount.files)); }
					// AND THE PALETTE (vgaiCommands.ts, U8). The bridge has already told the editor the
					// frame owns it — BEFORE mounting, so our own palette is never rendered over the
					// workbench — and what arrives here is that editor's live action table. One
					// `MenuId.CommandPalette` item per entry is what puts OUR actions in Cmd+Shift+P with
					// OUR labels; a bare `CommandsRegistry` command (which is all U6's 41 keyboard
					// commands are) does not appear there at all.
					if (mount.output) { keyboardStore.add(instantiationService.createInstance(VgaiOutput, mount.output)); }
					if (mount.commands) { keyboardStore.add(instantiationService.createInstance(VgaiCommands, mount.commands)); }
					// AND NOTIFICATIONS (vgaiNotifications.ts, U8). Same beat, same reason: the bridge
					// has already told the editor the frame owns them, and this is where the DELEGATE —
					// `INotificationService`, which only exists inside this invocation — is installed.
					// Until it lands the editor's own tray is still the destination, which is why
					// taking ownership early is safe.
					if (mount.notifications) { keyboardStore.add(instantiationService.createInstance(VgaiNotifications, mount.notifications)); }
					// AND OUR VIEWS' VERBS (vgaiViews.ts, U8's ruling 1). One `vgai.<view>.<verb>`
					// command per verb a view publishes, so a drawer utility — which `editor.document.*`
					// can never reach, being scoped to the active CENTRE document — is drivable by the
					// product through the frame's own command service, with no session verb per view.
					if (mount.views) { keyboardStore.add(new VgaiViews(mount.views)); }
					// AND THE DRAWER (vgaiUtilityViews.ts, U8). Every `workspace.utility` becomes a VIEW
					// in a view container in the PANEL: the panel's own tab strip is the drawer's, its
					// toggle is `View: Toggle Panel`, and a utility can be dragged to the sidebar or a
					// second group — which the dock never allowed. The content is unchanged; only where
					// its body lives is.
					if (mount.utilities) { keyboardStore.add(new VgaiUtilityViews(mount.utilities)); }
					// AND THE STATUS ITEMS (vgaiStatus.ts, U8). One real `IStatusbarService` entry per
					// `workspace.status` contribution, so each has the workbench's own alignment,
					// ordering against VS Code's own entries, `Hide <item>` in the bar's context menu
					// and `workbench.statusBar.visible` — none of which a portalled blob had. The
					// entry's `content` is an ELEMENT, so the item's pixels stay ours and nothing had
					// to be re-expressed as text.
					if (mount.status) { keyboardStore.add(instantiationService.createInstance(VgaiStatus, mount.status)); }
					// AND THE SETTINGS (vgaiSettings.ts, U7). The bridge has already told the editor
					// the frame owns them; this is where the PROVIDER — `IConfigurationService` — is
					// installed, and where the ADAPTER LAYER starts being applied: each key the open
					// project's `vgai.adapter.ts` declares is written to the service's own MEMORY
					// target unless the workspace already answers it, and re-evaluated on every
					// configuration change. That is "project over adapter over user" with no layer
					// added to the service (ARCHITECTURE-CORE §The core is Code-OSS, U7).
					if (mount.settings) { keyboardStore.add(instantiationService.createInstance(VgaiSettings, mount.settings)); }
					// AND WHATEVER THE PRODUCT INSTALLS. The game editor's is `vgaiGameSkew.ts` —
					// immersive Play as a LAYOUT ACT it performs and reverses exactly, the editor's
					// semantic dock commands (which would otherwise QUEUE forever under the frame,
					// because only the deleted dock ever installed an implementation), and the
					// surface-keyboard probe that keeps a keystroke aimed at Monaco beside a running
					// game out of the game. The model editor installs nothing here. The ids are
					// PASSED, so a product never becomes a second author of an id this file spells.
					product.mount?.(productContext(mount));
					// AND THE OPEN DOCUMENTS (vgaiDocuments.ts, walk 3's beat 19). One editor in this
					// group per OPEN workspace document, so a document that is open and not active —
					// an ingest root's Game, the one the pixels live in — is reachable by the
					// workbench's own gestures instead of existing only in our registry. It is
					// constructed LAST because it closes the bootstrap `Model` input, and that is
					// only safe once the bridge has mounted and published a document to replace it.
					// AND THE AREAS (WORK.md's Timeline item 1): the panes VS Code builds hand
					// their containers to the bridge per DOCUMENT, so an area document draws in
					// its own group's pane rather than under `display: none` in the main one.
					// Installed BEFORE `VgaiDocuments`, which is what creates the area's group.
					const documentsBridge = mount.documents;
					if (documentsBridge?.setView) { installDocumentViewSink((view, closed) => documentsBridge.setView?.(view, closed)); }
					keyboardStore.add(instantiationService.createInstance(VgaiDocumentViews));
					await documentsBridge?.whenRestored?.();
					if (mount.documents) { keyboardStore.add(instantiationService.createInstance(VgaiDocuments, mount.documents)); }
					return mount;
				})();
				// THE SHARED PROMISE'S OWN RESET, and nothing more. The `await mounted` below is
				// inside this invocation's try, so the refusal is REPORTED there — once, by the
				// one handler that also brings the cover down. This exists so a rejection no
				// one is awaiting is still handled and the next invocation builds a fresh mount.
				mounted.catch(() => { mounted = undefined; });
			}
			const mount = await mounted;
			// AND THEN THE PRODUCT DECIDES WHEN IT IS OPEN (`VgaiProduct.ready`, owner
			// 2026-09-21). The bridge mounting means the EDITOR is assembled; it does not
			// mean the thing a person came to see is on screen. Measured on the model
			// editor: the mount resolved and the editor's own "No document open yet (0
			// registered)" sat there for ~12 s while Blender booted. So the kit asks the
			// product, and the product's answer is what the cover waits for. No timer here
			// — a product that waits bounds its own wait and says what it waited for, which
			// is what makes the refusal below a sentence rather than a shrug.
			await product.ready?.(productContext(mount));
			// THE EDITOR IS THERE. The cover comes down whole, at the end of the whole open —
			// the bridge mounted, every door is installed, the documents are the group's
			// editors and the product says it is open — rather than at `mountVgai`, so nobody
			// watches the assembly finish.
			cover?.remove();
		} catch (error) {
			// THE OPEN DID NOT HAPPEN, and until 2026-09-21 that could be SILENT: the auto-open
			// contribution swallows this command's throw on purpose (the workbench's own
			// notifications are the channel), so a rejected `waitForParts` left a window that
			// simply never became the editor and never said why. The cover is what says it now,
			// in the words of whichever step refused, with a way out underneath.
			const message = error instanceof Error ? error.message : String(error);
			cover?.fail(localize('vgaiDidNotOpen', "{0} did not open.\n\n{1}", product.title, message));
			notifications.error(`vgai did not mount: ${message}`);
		}
	}
});

// ---- AN AUXILIARY WINDOW IS NEVER A SECOND TAB, so the vgai pane is MAIN-WINDOW ONLY.
//
// ARCHITECTURE-CORE §The core is Code-OSS rule 5, as U11 measured it on 2026-09-19 and U6b
// enforces: `View: Move Editor into New Window` put the Model editor in an auxiliary window
// that renders EMPTY — the handed-over parts and the React portals into them stay in the main
// window — while the main window lost its document until the command was run again, and each
// move added ~30 page warnings. The auxiliary window also runs no session bootstrap, so the
// session never sees it: it is not a tab, and nothing about it is reported anywhere.
//
// The refusal is a SHADOWING HANDLER, not a patched core file. `CommandsRegistry` keeps a list
// per id and answers with the most recently registered, so registering these four ids here —
// after `editor.contribution.js` has registered them (it is imported at line 53 of
// `workbench.common.main.ts`, ours at line 330) — puts our handler in front while the original
// stays reachable and runs for every editor that is not ours. Nothing of VS Code changes: the
// commands keep their titles, their palette entries and their keybindings, and moving
// `cube.ts` into a new window works exactly as it did. The day the layout host is multi-window
// aware, this block is what is deleted.

for (const { id, wholeGroup } of [
	{ id: MOVE_EDITOR_INTO_NEW_WINDOW_COMMAND_ID, wholeGroup: false },
	{ id: COPY_EDITOR_INTO_NEW_WINDOW_COMMAND_ID, wholeGroup: false },
	{ id: MOVE_EDITOR_GROUP_INTO_NEW_WINDOW_COMMAND_ID, wholeGroup: true },
	{ id: COPY_EDITOR_GROUP_INTO_NEW_WINDOW_COMMAND_ID, wholeGroup: true },
]) {
	const original = CommandsRegistry.getCommand(id);
	// Upstream renamed or dropped the command: there is nothing to guard and nothing of ours
	// to break. The gate that catches it is the fork gate's `git apply --3way`, not a throw here.
	if (!original) { continue; }
	CommandsRegistry.registerCommand({
		id,
		handler: (accessor: ServicesAccessor, ...args: unknown[]) => {
			const editorService = accessor.get(IEditorService);
			const editorGroupsService = accessor.get(IEditorGroupsService);
			const listService = accessor.get(IListService);
			const notifications = accessor.get(INotificationService);
			const editors = wholeGroup
				? [...editorGroupsService.activeGroup.editors]
				: resolveCommandsContext(args, editorService, editorGroupsService, listService).groupedEditors.flatMap(entry => entry.editors);
			if (editors.some(editor => editor instanceof VgaiDocumentInput)) {
				notifications.warn(localize('vgaiNoAuxWindow', "The vgai Model document stays in this window. Its parts and the React portals into them live here, so an auxiliary window would show an empty pane and this window would lose the document; the auxiliary window is also not one of the vgai session's tabs. Split it beside another editor instead."));
				return;
			}
			return original.handler(accessor, ...args);
		},
	});
}

/**
 * A VGAI PROJECT OPENS AS THE VGAI EDITOR, with no gesture.
 *
 * `vgai edit` IS this workbench: it starts the session, starts this server on
 * the project folder and opens the one tab at it. A person who ran that
 * command has already said which project they are editing and what they want
 * to edit it in — asking them to then find `VGAI: Open Workspace` in the
 * palette is asking twice, and until the mount runs the page is not one of the
 * session's TABS at all (the bootstrap loads with the mount), so `vgai status`
 * reads "no tab", `vgai eval` has nothing to reach and `vgai edit` reports that
 * no browser ever connected. The gesture was not a choice; it was a missing
 * door.
 *
 * WHAT DECIDES: the open folder carries a `vgai.project.json`. That file is the
 * project's own statement that it IS one (`@vgai/project`'s manifest is spelled
 * in exactly one place and this is its name), so a folder that is not a vgai
 * project opens as an ordinary workbench and nothing of ours runs.
 *
 * TRUST IS NOT BYPASSED. The command it runs asks for it in its own words and
 * refuses by name when a person declines — this only removes the step where
 * they have to ask for the thing they already asked for.
 *
 * `Restored` rather than `Eventually`: the parts this mounts into exist by
 * then, and a person watching their editor come up should not see an empty
 * workbench first.
 */
class VgaiProjectAutoOpen implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vgaiProjectAutoOpen';

	constructor(
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@ICommandService commandService: ICommandService,
	) {
		const folder = workspaceService.getWorkspace().folders[0]?.uri;
		if (!folder) { return; }
		(async () => {
			if (!await fileService.exists(joinPath(folder, 'vgai.project.json'))) {
				// NOT A VGAI PROJECT, so nothing of ours is coming and the product's cover has
				// nothing to cover. This contribution is the one that decides that, so it is
				// the one that takes the cover away — the alternative is a second reader of
				// `vgai.project.json`, and a cover with no owner left over a bare workbench.
				cover?.remove();
				return;
			}
			await commandService.executeCommand('vgai.workspace.open');
		})().catch(() => {
			// The command reports its own refusals through the workbench's
			// notifications and through the cover; a throw here would be a
			// second, worse channel.
			cover?.remove();
		});
	}
}

registerWorkbenchContribution2(
	VgaiProjectAutoOpen.ID,
	VgaiProjectAutoOpen,
	WorkbenchPhase.AfterRestored,
);

/**
 * THE PAGE IS A TAB AS SOON AS THERE IS A SESSION TO BE A TAB OF — and while it
 * is becoming one, it shows THIS PRODUCT rather than VS Code.
 *
 * Everything else of ours waits for something — the mount waits for trust, the
 * auto-open waits for the workbench to restore — and while a page waits, the
 * session has to be able to say WHICH wait it is. It cannot say that about a
 * page it has never heard from: `vgai status` reported "no tab has ever
 * reported" for a workbench that was open on screen asking a person to trust
 * the folder (measured 2026-09-21).
 *
 * So the tab connects here, at activation, before any of those waits — and with
 * it the folder's trust, which having a session already settled. See
 * {@link connectSessionTab} for both, and for why running the session's own
 * bootstrap ahead of the editor's modules is safe.
 *
 * AND THE COVER GOES UP HERE (`vgaiCover.ts`), because this is the first moment
 * the workspace folder is known and the wait it covers starts now. What the
 * owner saw on their own first open was the other product: VS Code's menubar
 * and an empty group, for as long as the mount took.
 *
 * `BlockRestore` rather than `AfterRestored`: the work is a fetch, a script tag
 * and an element, kicked off and never awaited, so it blocks nothing — it
 * simply starts at the first moment the workspace folder is known, which is all
 * it needs.
 */
class VgaiSessionTab implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vgaiSessionTab';

	constructor(
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@IWorkspaceTrustManagementService workspaceTrust: IWorkspaceTrustManagementService,
	) {
		const folder = workspaceService.getWorkspace().folders[0]?.uri;
		if (!folder) { return; }
		cover = raiseOpeningCover(basename(folder));
		connectSessionTab(fileService, workspaceService, workspaceTrust).catch(() => {
			// A folder with no live vgai session is an ordinary workbench on an
			// ordinary folder — so the cover comes down and VS Code's own trust
			// prompt is left exactly as it is. The mount command is where a
			// person asking for the editor learns that there is none, in its own
			// words.
			cover?.remove();
		});
	}
}

registerWorkbenchContribution2(
	VgaiSessionTab.ID,
	VgaiSessionTab,
	WorkbenchPhase.BlockRestore,
);
