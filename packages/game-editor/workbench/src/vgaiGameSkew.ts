/*---------------------------------------------------------------------------------------------
 *  THE GAME SKEW UNDER THE FRAME.
 *
 *  THE ONE PIECE OF WORKBENCH CODE THAT IS A GAME EDITOR'S. It lives in this
 *  repository beside the rest of the game editor (`packages/game-editor/workbench/src/`) and is
 *  overlaid on a Code-OSS checkout by `scripts/workbench/overlay.mjs --product game-editor`; a
 *  copy inside a fork checkout is build output. `product.contribution.ts` beside it is what
 *  constructs this, from the bridge member the kit's mount hands over.
 *
 *  The product declares its native view arrangement in product.contribution.ts: hierarchy
 *  above Content in the primary sidebar, inspector in the secondary sidebar. The bridge
 *  mounts those panels and the viewport-local compact inspector. This file binds that
 *  presentation to the workbench, plus Play, semantic panel commands and keyboard ownership.
 *
 *  1. IMMERSIVE PLAY IS A LAYOUT ACT, performed with the workbench's own verbs.
 *     `installPlayTransitionDock({ hideChrome, showChrome })` is the editor's existing seam —
 *     `live-transition.ts` owns the TIMING and the camera flight and deliberately never touches
 *     Dockview, so what the dock registered there (a chrome dissolve over its groups) the frame
 *     registers as: hide the side bar, the auxiliary bar and the panel, and maximize the editor
 *     group when there is more than one. Reversing it is not "show everything" — it is
 *     RESTORING WHAT WAS THERE, so the act persists each part's visibility and the group
 *     arrangement on the way in and puts exactly those back on the way out. A person who was
 *     already working with the panel hidden gets it back hidden.
 *
 *     THERE IS NO EDGE REVEAL HERE, and that is a decision rather than a gap. The dock's
 *     immersive presentation has a macOS-style auto-hide: dwell at an edge and the chrome
 *     re-materializes over the game (`LiveRevealOverlays.tsx`, mounted by the dock). Under the
 *     frame the chrome is not hidden-but-present, it is genuinely laid out away, and reviving it
 *     on a pointer dwell would be a second layout act firing on mouse movement — the exact
 *     "DOCUMENT-OPEN NEVER MOVES CHROME" inversion ARCHITECTURE-CORE §Editor chrome rules
 *     against, now on an even weaker trigger. Escape is the way out, and it already works
 *     without anything here: `play-mode.ts` registers Escape-to-stop, stopping ends the
 *     transition, and `showChrome` restores the layout. One gesture, one reversal.
 *
 *  2. THE SEMANTIC DOCK COMMANDS. `workspace-dock-controller.ts` is the editor's imperative
 *     boundary — "reveal the Profiler", "focus the hierarchy" — and callers deliberately name a
 *     capability rather than a location. Only `WorkspaceDock.tsx` ever installed an
 *     implementation, so under the frame every such call QUEUED FOREVER (the controller holds
 *     pending resolvers until one arrives): `playUtilities` on a layout, the Generations button,
 *     every menu item that reveals a utility. Here they are the views service: a utility is the
 *     view U8 gave it (`vgai.utility.<id>` in the panel container), the two static panels are the
 *     outliner and properties views, and focus mode is the editor group's own maximize.
 *
 *  3. THE SURFACE-KEYBOARD PROBE, and it is the one that closes a real defect. The play-input
 *     predicate is "play is running AND the Game tab is active" (plus instance focus), and
 *     standalone those clauses are the whole truth because the editor page is the only surface.
 *     Under the frame the page is a workbench: Monaco can sit in the group beside a running game,
 *     on the same `document` the game's listeners are on, and both clauses stay true while a
 *     person types into a source file. `@editor/surface-keyboard`'s probe is the missing term and
 *     this is the frame's answer to it — the WORKBENCH'S OWN notion of the active editor, not DOM
 *     focus. Focus would have been wrong in a way that costs the game: a game canvas with no
 *     `tabindex` leaves focus on `body`, so a focus-based probe would go false on the first click
 *     INTO the game.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiGameBridge`, whose
 *  counterpart is `bridge.tsx`'s `VgaiGameHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { GroupsArrangement, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId } from '../../chat/browser/chat.js';

/** What the frame performs when the editor asks for immersive Play, and its exact reversal. */
export interface VgaiImmersiveAct {
	enter(): void;
	exit(): void;
}

/** The editor's semantic dock vocabulary, as the frame answers it. Every member is optional on
 *  the editor's own `WorkspaceDockCommands` except the two that are not; the bridge adapts. */
export interface VgaiDockCommands {
	showUtility(id: string): void;
	toggleUtility(id: string): void;
	ensureUtility(id: string): void;
	closeUtility(id: string): void;
	/** `'hierarchy'` and `'inspector'` are the two the editor's static-panel registry names. */
	showStaticPanel(kind: string): void;
	setFocus(focused: boolean): void;
	toggleFocus(): void;
}

export interface VgaiGameBridge {
	setActiveStaticPanel(kind: string | null): void;
	focusCompactInspector(): boolean;
	/** Whether OUR editor pane currently holds the keyboard, pushed on every change. */
	setPaneActive(active: boolean): void;
	/** Install the immersive-Play layout act (null uninstalls). */
	setImmersive(act: VgaiImmersiveAct | null): void;
	/** Install the frame's answers for the semantic dock commands (null uninstalls). */
	setDockCommands(commands: VgaiDockCommands | null): void;
	/** Say something in the editor's OWN console, where `volter-game-editor console` reads it. */
	report(level: 'warn' | 'error', message: string): void;
}

/** The view id U8 gives a `workspace.utility`; kept in step with `vgaiUtilityViews.ts`'s own
 *  `viewIdFor`, which is its single author — this file only needs to name one. */
function utilityViewId(id: string): string {
	return `vgai.utility.${id}`;
}

/** What `hideChrome` recorded, so `showChrome` restores rather than reveals. */
const PLAY_LAYOUT_KEY = 'vgai.play.layout';

interface LayoutSnapshot {
	readonly sideBar: boolean;
	readonly auxiliaryBar: boolean;
	readonly panel: boolean;
	readonly maximized: boolean;
}

export class VgaiGameSkew extends Disposable {

	/** Non-null exactly while immersive Play is in force. Also the re-entrancy guard: a second
	 *  `enter()` (a re-mount inside one play session) must not overwrite the pre-play layout
	 *  with the immersive one, which would make the exit a no-op and strand the person in a
	 *  bare editor with no side bars and no way back but the View menu. */
	private snapshot: LayoutSnapshot | null = null;
	private readonly playTabOptions = this._register(new MutableDisposable());

	constructor(
		private readonly bridge: VgaiGameBridge,
		/** The contribution's own ids — passed rather than imported, so this file never becomes a
		 *  second author of an id the contribution already spells (and never imports the module
		 *  that constructs it). */
		private readonly ids: { readonly pane: string; readonly hierarchyView: string; readonly inspectorView: string; readonly contentView: string },
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IViewsService private readonly viewsService: IViewsService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		const restoredGroups = this.editorGroupsService.groups.map(group => ({ id: group.id, editors: group.editors.map(editor => editor.getName()) }));
		// Read the native owners when diagnosing a missing view or tab strip. This
		// command reports state; it never reveals views or rewrites preferences.
		this._register(CommandsRegistry.registerCommand('vgai.layout.inspect', accessor => ({
			settings: ['workbench.editor.showTabs', 'zenMode.showTabs'].map(key => {
				const value = accessor.get(IConfigurationService).inspect(key);
				return { key, value: value.value, defaultValue: value.defaultValue, userValue: value.userValue, workspaceValue: value.workspaceValue, memoryValue: value.memoryValue };
			}),
			zen: this.contextKeyService.getContextKeyValue<boolean>('inZenMode') === true,
			effectiveTabs: this.editorGroupsService.mainPart.partOptions.showTabs,
			restoredGroups,
			immersive: this.snapshot,
			parts: ([Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART] as const).map(part => ({ part, visible: this.layoutService.isVisible(part) })),
			views: [this.ids.hierarchyView, this.ids.contentView, this.ids.inspectorView, ChatViewId].map(id => ({ id, visible: this.viewsService.isViewVisible(id) })),
			groups: this.editorGroupsService.groups.map(group => ({ id: group.id, editors: group.editors.map(editor => ({ name: editor.getName(), type: editor.typeId, serializable: Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).getEditorSerializer(editor)?.canSerialize(editor) ?? false })) })),
		})));

		// A reload ends Play but Code-OSS persists the hidden parts. Recover the
		// pre-Play visibility before accepting another Play entry, just as Zen
		// Mode retains exitInfo. This is workspace state, never a user setting.
		this.snapshot = this.storageService.getObject<LayoutSnapshot>(PLAY_LAYOUT_KEY, StorageScope.WORKSPACE) ?? null;
		this.exitImmersive();

		this._register(this.editorService.onDidActiveEditorChange(() => this.syncPaneActive()));
		this.syncPaneActive();
		// Inspector presentation changes its content, not native view visibility.
		// Only a view command or the temporary Play/Zen layout may hide the pane.

		this.bridge.setImmersive({ enter: () => this.enterImmersive(), exit: () => this.exitImmersive() });
		this._register({ dispose: () => this.bridge.setImmersive(null) });

		this.bridge.setDockCommands({
			showUtility: id => void this.openUtility(id, true),
			toggleUtility: id => void this.toggleUtility(id),
			ensureUtility: id => void this.openUtility(id, false),
			closeUtility: id => this.viewsService.closeView(utilityViewId(id)),
			showStaticPanel: kind => void this.showStaticPanel(kind),
			setFocus: focused => this.setFocus(focused),
			toggleFocus: () => this.layoutService.toggleZenMode(),
			// The workbench owns view placement and has its own `View: Reset View Locations`;
			// a second reset here would be a parallel layout authority over state that is no
			// longer ours to hold (U8's ruling that a view's home is the view container's).
		});
		this._register({ dispose: () => this.bridge.setDockCommands(null) });
	}

	/** THE ACTIVE EDITOR, not DOM focus — see the header's point 3. `activeEditorPane` is the
	 *  pane of the ACTIVE GROUP, so typing into Monaco in the group beside the stage makes this
	 *  false while a click anywhere inside our own pane keeps it true. */
	private syncPaneActive(): void {
		this.bridge.setPaneActive(this.editorService.activeEditorPane?.getId() === this.ids.pane);
	}

	private enterImmersive(): void {
		if (this.snapshot) { return; }
		this.snapshot = {
			sideBar: this.layoutService.isVisible(Parts.SIDEBAR_PART),
			auxiliaryBar: this.layoutService.isVisible(Parts.AUXILIARYBAR_PART),
			panel: this.layoutService.isVisible(Parts.PANEL_PART),
			maximized: this.editorGroupsService.mainPart.hasMaximizedGroup(),
		};
		this.storageService.store(PLAY_LAYOUT_KEY, this.snapshot, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		this.setMaximized(true);
		this.playTabOptions.value = this.editorGroupsService.mainPart.enforcePartOptions({ showTabs: 'none' });
	}

	private exitImmersive(): void {
		this.playTabOptions.clear();
		const snapshot = this.snapshot;
		if (!snapshot) { return; }
		this.snapshot = null;
		this.layoutService.setPartHidden(!snapshot.sideBar, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(!snapshot.auxiliaryBar, Parts.AUXILIARYBAR_PART);
		this.layoutService.setPartHidden(!snapshot.panel, Parts.PANEL_PART);
		this.setMaximized(snapshot.maximized);
		this.storageService.remove(PLAY_LAYOUT_KEY, StorageScope.WORKSPACE);
	}

	/** Maximizing is meaningless with one group and `toggleMaximizeGroup` would then be a
	 *  visible no-op that still fires the workbench's own notifications, so the single-group
	 *  case is skipped rather than toggled. */
	private setMaximized(maximized: boolean): void {
		const part = this.editorGroupsService.mainPart;
		if (part.count < 2) { return; }
		if (part.hasMaximizedGroup() === maximized) { return; }
		// THE INVERSE OF MAXIMIZE IS THE GRID'S OWN RESTORE, NEVER `EVEN`. `EVEN` means "size
		// all groups the same", and a workspace AREA is not a sibling of equal weight — the
		// Model workspace's Timeline declares 0.0719. Measured 2026-09-20 (U8 walk 3, beat 8)
		// on a `--template game` scaffold: mount 874/68, Play 942/0, Stop **471/471**, and it
		// stayed there through a Sculpt round trip because nothing else re-sizes a group whose
		// document never moved. `toggleMaximizeGroup` takes `unmaximizeGroup` ->
		// `gridWidget.exitMaximizedView()`, which puts back the proportions maximizing saved.
		if (maximized) { part.arrangeGroups(GroupsArrangement.MAXIMIZE); } else { part.toggleMaximizeGroup(); }
	}

	private setFocus(focused: boolean): void {
		// Native Zen owns its visibility snapshot, tabs, and restoration. Group
		// maximization is independent and cannot tell whether focus mode is active.
		if ((this.contextKeyService.getContextKeyValue<boolean>('inZenMode') === true) !== focused) {
			this.layoutService.toggleZenMode();
		}
	}

	private async openUtility(id: string, focus: boolean): Promise<void> {
		const view = await this.viewsService.openView(utilityViewId(id), focus);
		// A utility whose availability gate is closed has no view registered, and a silent
		// nothing is how a menu item becomes a lie. The editor's own console is where a
		// person (and `volter-game-editor console`) sees it.
		if (!view) { this.bridge.report('warn', localize('vgaiUtilityMissing', "The “{0}” utility has no view in this window, so it could not be opened — its availability gate is closed, or the panel's views have not been published yet.", id)); }
	}

	private async toggleUtility(id: string): Promise<void> {
		const viewId = utilityViewId(id);
		if (this.viewsService.isViewVisible(viewId)) { this.viewsService.closeView(viewId); return; }
		await this.openUtility(id, true);
	}

	private async showStaticPanel(kind: string): Promise<void> {
		// Resolve semantic panel commands to the product's real native views.
		const viewId = kind === 'hierarchy' ? this.ids.hierarchyView : kind === 'inspector' ? this.ids.inspectorView : kind === 'assets' ? this.ids.contentView : kind === 'agent' ? ChatViewId : null;
		if (!viewId) {
			this.bridge.report('warn', localize('vgaiStaticPanelMissing', "The “{0}” panel has no view under the VS Code frame, so it could not be focused.", kind));
			return;
		}
		if (kind === 'inspector' && this.bridge.focusCompactInspector()) return;
		const view = await this.viewsService.openView(viewId, true);
		this.bridge.setActiveStaticPanel(view ? kind : null);
	}
}
