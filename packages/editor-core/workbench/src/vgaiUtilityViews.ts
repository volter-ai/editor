/*---------------------------------------------------------------------------------------------
 *  OUR DRAWER UTILITIES ARE VS CODE VIEWS IN A VIEW CONTAINER — WORK.md §The core is Code-OSS
 *  U8, ruling (1)'s other half.
 *
 *  The editor's Properties and Outliner were already views here (one sidebar container, two
 *  `ViewPane`s) and the active document is an editor pane. What was still the DOCK's was the
 *  BOTTOM DRAWER — Console, Profiler, Network, the node editor — a tab strip of
 *  `workspace.utility` contributions with no frame counterpart at all. Under the frame that
 *  each utility has its own view container in the PANEL: the panel's own
 *  tab strip is the drawer's, `View: Toggle Panel` is the drawer's toggle, and a utility can be
 *  dragged to the sidebar or a second group like any other view, which the dock never allowed.
 *
 *  WHY THE SET IS DYNAMIC. Which utilities exist is a fact about the OPEN PROJECT's packages —
 *  `@vgai/blender` contributes the node editor, `@vgai/game` the Profiler and State Watch,
 *  Network exists only while a live session exposes a networking adapter. So the views are
 *  registered from the editor's live registry and re-registered when it changes, the same way
 *  `vgaiCommands.ts` publishes the palette. `registerViews`/`deregisterViews` is the workbench's
 *  own runtime door and is what every extension uses.
 *
 *  THE BODY IS OURS. A view here renders nothing of its own: it hands its body element back
 *  through `offerViewBody`, and the bridge portals the utility's real React content into it —
 *  identical to how `vgai.contribution.ts` hands over the centre, outliner and
 *  properties parts. The ONE stage rule is untouched; a utility is panel content.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiUtilitiesBridge`.
 *  Its counterpart is `bridge.tsx`'s `VgaiUtilitiesHandle`.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { viewBackgroundFor } from './vgaiColors.js';

export interface VgaiUtility {
	readonly id: string;
	readonly title: string;
	readonly order: number;
}

export interface VgaiUtilitiesBridge {
	/** Every available `workspace.utility`, right now, in tab order. */
	list(): readonly VgaiUtility[];
	/** Fires when the registry or an availability gate changes the set. */
	subscribe(listener: () => void): () => void;
	/** A view's body element, as the workbench renders it; `null` when the view goes away. */
	offerBody(utilityId: string, element: HTMLElement | null): void;
}

/** `console` → `vgai.utility.console`. The view id is what the workbench persists a layout
 *  against, so it is derived from the utility's own stable id and never from its title. */
function viewIdFor(utilityId: string): string {
	return `vgai.utility.${utilityId}`;
}
function utilityIdFor(viewId: string): string {
	return viewId.slice('vgai.utility.'.length);
}

/** The live bridge, so a view pane — which the workbench constructs, not us — can reach it. */
let liveBridge: VgaiUtilitiesBridge | undefined;

class VgaiUtilityView extends ViewPane {
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
		// A handed-over part is a REAL focusable part, for U6's reason: `vgai.focused` is
		// answered by VS Code's own focus tracking, and a click that leaves focus in Monaco is
		// the incident the keyboard ruling closes.
		this.hostBody.tabIndex = -1;
		this.hostBody.addEventListener('pointerdown', () => this.hostBody?.focus({ preventScroll: true }));
		container.appendChild(this.hostBody);
		// THE VIEW'S SURFACE COLOUR IS ITS OWN THEME COLOUR (U8, ruling 2, and I5's open item).
		// Unset by every theme but ours, so Classic paints nothing here and our panel's own
		// stylesheet is what shows — which is what "Classic is our panels with no look" means.
		this._register(this.themeService.onDidColorThemeChange(() => this.applyBackground()));
		this.applyBackground();
		liveBridge?.offerBody(utilityIdFor(this.id), this.hostBody);
		this._register(toDisposable(() => liveBridge?.offerBody(utilityIdFor(this.id), null)));
	}
	private applyBackground(): void {
		if (!this.hostBody) { return; }
		const color = viewBackgroundFor(this.themeService.getColorTheme(), utilityIdFor(this.id));
		this.hostBody.style.background = color ? color.toString() : '';
	}
	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.hostBody) { this.hostBody.style.height = `${height}px`; this.hostBody.style.width = `${width}px`; }
	}
	override focus(): void {
		if (this.hostBody) { this.hostBody.focus({ preventScroll: true }); } else { super.focus(); }
	}
}

export class VgaiUtilityViews extends Disposable {

	private readonly registrations = new Map<string, { store: DisposableStore; container: ViewContainer; title: string }>();

	constructor(private readonly bridge: VgaiUtilitiesBridge) {
		super();
		liveBridge = bridge;
		this._register(toDisposable(() => { if (liveBridge === bridge) { liveBridge = undefined; } }));
		this._register(toDisposable(bridge.subscribe(() => this.publish())));
		this._register(toDisposable(() => { for (const registration of this.registrations.values()) { registration.store.dispose(); } this.registrations.clear(); }));
		this.publish();
	}

	private publish(): void {
		const utilities = this.bridge.list();
		const present = new Set(utilities.map(utility => utility.id));
		for (const [id, registration] of this.registrations) {
			if (!present.has(id)) { registration.store.dispose(); this.registrations.delete(id); }
		}
		const containers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		const views = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		for (const utility of utilities) {
			if (this.registrations.has(utility.id)) { continue; }
			const id = `workbench.view.${viewIdFor(utility.id)}`;
			const container = containers.registerViewContainer({
				id, title: { value: utility.title, original: utility.title }, icon: Codicon.tools,
				order: utility.order, hideIfEmpty: true,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, { mergeViewWithContainerWhenSingleView: true }]),
			}, ViewContainerLocation.Panel);
			const descriptors: IViewDescriptor[] = [{
				id: viewIdFor(utility.id), name: { value: utility.title, original: utility.title },
				ctorDescriptor: new SyncDescriptor(VgaiUtilityView), canToggleVisibility: true,
				canMoveView: true, order: utility.order,
			}];
			views.registerViews(descriptors, container);
			const store = new DisposableStore();
			store.add(toDisposable(() => {
				views.deregisterViews(descriptors, container);
				containers.deregisterViewContainer(container);
			}));
			this.registrations.set(utility.id, { store, container, title: utility.title });
		}
	}
}
