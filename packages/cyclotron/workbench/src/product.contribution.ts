/*---------------------------------------------------------------------------------------------
 *  CYCLOTRON'S WORKBENCH HALF — everything about this build that is Blender's rather
 *  than the editor kit's.
 *
 *  THIS FILE LIVES IN THIS REPOSITORY (`packages/cyclotron/workbench/src/`) and is OVERLAID on a
 *  Code-OSS checkout at a pin by `scripts/workbench/overlay.mjs --product editor`. Edit it here.
 *
 *  It is the counterpart of `packages/cyclotron/src/index.ts`, which composes the SAME
 *  product in the editor's own realm: that file says which packages this editor is, what it
 *  looks like and what workspace it opens; this one says what the WORKBENCH around them is
 *  called, what it says when it asks for trust, and which of this build's theme artifacts the
 *  look wears. Both are thin, and neither is a switch.
 *
 *  IT IMPORTS TWO LEAVES OF THE KIT and nothing else of it (`volterProduct.ts`'s header says
 *  why): importing the kit's contribution would evaluate it before this file registers, and
 *  the kit reads its product at load.
 *--------------------------------------------------------------------------------------------*/

import './media/blender-look.css';
import './media/model-cover.css';
import { $ } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { FileAccess } from '../../../../base/common/network.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from '../../files/browser/fileConstants.js';
import { registerViewBackground } from '../../volter/browser/volterColors.js';
import { registerVolterProduct, type VolterProductCover, type VolterProductCoverContext, type VolterProductMountContext } from '../../volter/browser/volterProduct.js';
import { CYCLOTRON_MACHINE } from './cyclotronMachine.js';

// BLENDER'S OWN UI FONT (Inter, OFL), lifted from the Blender payload's datafiles/fonts. It is
// loaded through `FileAccess.asBrowserUri` off the APP ROOT, which is what makes the look
// survive the origin split: the font and the skin CSS are both `'self'` under the workbench's
// CSP and nothing of the look is fetched from the session (docs/CODE-OSS.md §Assets under the
// app root). The path is the overlay's fixed product directory — one name for every product,
// which is what keeps this literal and the build's resource glob from drifting apart.
(() => {
	const style = mainWindow.document.createElement('style');
	style.textContent = `@font-face { font-family: 'Inter'; src: url(${FileAccess.asBrowserUri('vs/workbench/contrib/volterProduct/browser/media/Inter.woff2').toString(true)}) format('woff2'); font-weight: 100 900; }`;
	mainWindow.document.head.appendChild(style);
})();

/**
 * THE NODE EDITOR'S OWN BACKDROP — U8's ruling (2), and I5's open item.
 *
 * The colour id and its row are CYCLOTRON's, because both halves are: the utility is
 * `@volter/editor-blender`'s node editor and the value is `theme-blender`'s traced `TH_BACK`. The kit
 * keeps the generic `volter.view.background` that every other view resolves to. The default is
 * null for the reason `volterColors.ts` states: a default of `#1a1a1a` would make an unthemed
 * workbench wear a Blender value under a different name.
 */
const volterNodeEditorBackground = registerColor('volter.nodeEditor.background',
	{ dark: null, light: null, hcDark: null, hcLight: null },
	localize('volterNodeEditorBackground', "The node editor's canvas backdrop. Blender's Shader Editor fills its area with TH_BACK (#1a1a1a) inside a #303030 panel, which is why this view does not read as a panel."));
registerViewBackground('blender-node-editor', volterNodeEditorBackground);

/** What this product reads off the mount — the kit installs its own doors and hands the whole
 *  object over. `activeSource()`'s `path` is PROJECT-RELATIVE and may be empty, which is the
 *  honest answer for a document that is not a file on disk.
 *
 *  It is a MIRROR of the kit's `VolterDocumentsBridge` and not an import of it, the same way the
 *  game editor mirrors its own half: a product declares the shape it expects
 *  (`volterProduct.ts`'s header), and a door this build's kit does not have reads as missing
 *  rather than as a crash. */
interface DocumentsSource {
	activeSource(): { readonly kind: string; readonly path: string } | null;
	/** Every OPEN workspace document. Absent on a bridge older than this door.
	 *  `area` is set only for a document the active WORKSPACE opened into one of its
	 *  `areas` — this product's Timeline strip is one — and {@link openDocument} is why
	 *  this mirror carries it. */
	list?(): readonly { readonly id: string; readonly title: string; readonly area?: unknown }[];
	/** The registry's active document id, or null while nothing is open yet. */
	activeId?(): string | null;
	/** Fires when the open set or the active document changes. */
	subscribe?(listener: () => void): () => void;
}

/**
 * IS A DOCUMENT A PERSON CAME TO SEE OPEN — never an AREA document, and that
 * distinction is the whole of this function.
 *
 * A workspace's own `areas` (this product's Timeline strip) open WITH THE LAYOUT,
 * before the adapter's table has settled, and they are never activatable. Counting
 * one is the same mistake walk 4's W2 (#7739) found in `openDefaultTableDocument`,
 * whose own comment states the rule; `ready` below was written afterwards with the
 * naive predicate and inherited it.
 *
 * MEASURED, walk 5 beat 3, on a fresh `cyclotron create` scaffold: after `View:
 * Close Editor` the session answered `openDocumentIds:
 * ["tool:blender-timeline.document"]`, `activeDocumentId:
 * "tool:blender-timeline.document"` — so `Volter Editor: Open Workspace` re-ran, `ready`
 * called the product OPEN on the strength of the Timeline alone, the cover came off
 * and the pane read "No document open yet (0 registered)".
 */
function openDocument(registry: DocumentsSource): boolean {
	return (
		(registry.list?.() ?? []).some((document) => document.area === undefined) &&
		registry.activeId?.() !== null
	);
}
let documents: DocumentsSource | undefined;

/**
 * WHEN THE SPLASH STARTS SAYING HOW LONG THE FIRST MODEL HAS TAKEN, and it is this product's
 * number because the thing being waited for is this product's: Blender itself, compiled to
 * WebAssembly, booting in the tab's worker. Measured 2026-09-21 on both releases, cold: the
 * Model document appeared about 12 s after the mount resolved.
 *
 * IT IS NOT A DEADLINE ANY MORE (#147 review). This used to reject at 90 s, which turned a slow
 * but healthy boot (a cold page cache, a busy box, a large file) into the cover's refusal. A
 * Blender that cannot open the model says so itself — the Model document publishes its failure
 * to the cover (`@volter/editor-sdk/kit/startup-failure`) — and so does an editor whose
 * contributions failed to load with no document open (`bridge.tsx`'s no-document dead end), so
 * the wait here only narrates; the kit's cover offers Dismiss once it has been long.
 */
const MODEL_OPEN_NARRATE_AFTER_MS = 30_000;

/** This product's splash while it is opening, so `ready` below can narrate its own wait into
 *  the cover it drew. Set by `cover`, cleared by the handle's `dispose`. */
let splash: { say(text: string): void } | undefined;

registerVolterProduct({
	id: 'cyclotron',
	layout: {
		sidebarWidth: 255,
		containers: [
			{
				id: 'workbench.view.volter',
				title: 'Model',
				location: 'sidebar',
				views: [
					{ part: 'outliner', title: 'Outliner', weight: 18 },
					{ part: 'properties', title: 'Properties', weight: 82 },
				],
			},
		],
	},
	title: localize('volterModelTitle', "Volter Cyclotron"),
	// The package's own `bin` (packages/cyclotron/package.json), named in the kit's messages.
	command: 'cyclotron',
	// The workbench's own trust prompt, in this product's words: what actually runs when the
	// folder is trusted is this project's contributions, its dev server and Blender itself in
	// the tab's worker. Cyclotron has no game, which is what the one shared sentence used
	// to claim for both products.
	trustSentence: localize('volterModelTrustRequest', "Volter Cyclotron runs this project's own code — its editor contributions, its dev server, and Blender itself in this tab. Trust this folder to open it."),
	// THIS PRODUCT'S OWN SPLASH (F4). The kit owns the cover's mechanism — when it goes up,
	// that it comes away whole, what a refusal looks like; this is the picture inside it, in
	// Blender's own palette and this product's own words, drawn with no image to fetch so the
	// first painted frame is already this.
	cover(host: HTMLElement, context: VolterProductCoverContext): VolterProductCover {
		const root = $('.volter-model-cover');
		// THE MARK: the machine from the home page, this product's mascot (`cyclotronMachine.ts`),
		// built as ELEMENTS. Not `innerHTML` — the page carries a Trusted Types policy and the
		// workbench's own code never assigns markup — and not a file either, because an image to
		// fetch is a frame to wait for. Each part is one path the stylesheet plots in turn
		// (`--part` is its place in the reassembly order), then the machine floats.
		const machine = $.SVG<SVGElement>('svg', { class: 'volter-model-cover-mark', viewBox: '0 0 240 240', 'aria-hidden': 'true' });
		CYCLOTRON_MACHINE.forEach(({ accent, d }, index) => {
			const part = $.SVG<SVGElement>('path', {
				class: accent ? 'volter-model-cover-part volter-model-cover-accent' : 'volter-model-cover-part',
				// One unit long, so the dash that plots it is the same for every part.
				pathLength: '1',
				d,
			});
			// Through the CSSOM, not a `style` attribute, which the page's policy treats as markup.
			part.style.setProperty('--part', String(index));
			machine.append(part);
		});
		const title = $('.volter-model-cover-title');
		title.textContent = localize('volterModelCoverTitle', "Cyclotron");
		const folder = $('.volter-model-cover-folder');
		folder.textContent = context.folderName;
		const state = $('.volter-model-cover-state');
		state.textContent = localize('volterModelCoverStarting', "Starting Blender…");
		root.append(machine, title, folder, $('.volter-model-cover-rail'), state);
		host.appendChild(root);
		splash = { say: (text: string) => { state.textContent = text; } };
		return {
			dispose: () => {
				splash = undefined;
				root.remove();
			},
		};
	},
	// WHEN THIS PRODUCT IS OPEN: when its Model document is registered, active and drawn.
	// `mountVolter` resolving is the EDITOR being assembled, and on this product that is about
	// twelve seconds before there is a model to look at — the editor's own "No document open
	// yet (0 registered)" is what a person watched in that window. So the cover stays up over
	// it, narrating, and lifts onto the model itself.
	async ready(context: VolterProductMountContext): Promise<void> {
		const registry = context.mount['documents'] as DocumentsSource | undefined;
		// A BRIDGE WITHOUT THE DOOR IS A MISSING DOOR, never a crash and never a wait that
		// cannot end: with nothing to watch, the mount resolving IS the answer, which is what
		// this product did before `ready` existed.
		if (!registry?.subscribe || !registry.list || !registry.activeId) { return; }
		const open = (): boolean => openDocument(registry);
		if (!open()) {
			splash?.say(localize('volterModelCoverWaiting', "Opening the first model…"));
			await new Promise<void>((resolve) => {
				let unsubscribe: (() => void) | undefined;
				let timer: number | undefined;
				const startedAt = Date.now();
				// DECLARED BEFORE EITHER IS INSTALLED, because a registry that notifies
				// synchronously from `subscribe` would otherwise reach a `const` still in its
				// temporal dead zone and throw out of this promise.
				const stop = () => {
					if (timer !== undefined) { mainWindow.clearInterval(timer); }
					unsubscribe?.();
					unsubscribe = undefined;
				};
				timer = mainWindow.setInterval(() => {
					const elapsed = Date.now() - startedAt;
					if (elapsed < MODEL_OPEN_NARRATE_AFTER_MS) { return; }
					splash?.say(localize('volterModelCoverSlow', "Waiting for the first model to open ({0}s). `cyclotron status` says what the editor is doing.", Math.round(elapsed / 1000)));
				}, 1000);
				unsubscribe = registry.subscribe?.(() => { if (open()) { stop(); resolve(); } });
				// One more read after subscribing: the document can land between the check
				// above and this listener, and then no further change is coming.
				if (open()) { stop(); resolve(); }
			});
		}
		// DRAWN, not merely registered. The pane paints the active document on the frame after
		// the registry names it, so the cover comes off one frame later — otherwise it lifts
		// onto the empty pane it was covering and the person sees the gap anyway.
		splash?.say(localize('volterModelCoverDrawing', "Drawing…"));
		await new Promise<void>((resolve) => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
	},
	mount(context: VolterProductMountContext): void {
		documents = context.mount['documents'] as DocumentsSource | undefined;
		context.store.add({ dispose: () => { documents = undefined; } });
	},
});

// ---- Native VS Code beside the volter panels: the Explorer on the opposite side bar, and the
// active model's SOURCE in VS Code's own text editor, split next to the Model document.
//
// IT IS CYCLOTRON'S, not the kit's: what it opens is the `<name>.py` beside a
// `<name>.blend`, which is Blender's own authoring pair (ARCHITECTURE-CORE §Blender north
// star). A product editing something else has a different sibling or none.
registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'volter.model.openSourceBeside', title: localize2('volterOpenSource', "Volter Editor: Show Explorer and Open Model Source Beside"), category: Categories.View, f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const viewsService = accessor.get(IViewsService);
		const editorService = accessor.get(IEditorService);
		const workspace = accessor.get(IWorkspaceContextService).getWorkspace();
		// Explorer AND Source Control, because the desktop shape is where git exists at all
		// (the web test harness has no Node extension host) and the two are the same gesture:
		// VS Code's own file estate on the side bar OPPOSITE our outliner and properties.
		// The side bar itself is ours — moving these into it would evict the Model workspace's
		// own column.
		for (const id of ['workbench.view.explorer', 'workbench.view.scm']) {
			const container = viewDescriptorService.getViewContainerById(id);
			if (container && viewDescriptorService.getViewContainerLocation(container) !== ViewContainerLocation.AuxiliaryBar) {
				viewDescriptorService.moveViewContainerToLocation(container, ViewContainerLocation.AuxiliaryBar, undefined, 'volter');
			}
		}
		layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		await viewsService.openViewContainer('workbench.view.scm', false);
		await viewsService.openViewContainer('workbench.view.explorer', false);
		// ---- and the ACTIVE MODEL's own source beside it.
		//
		// This opened the literal `src/models/cube.ts` until 2026-09-19, which the models
		// template stopped shipping when a model became a `.blend` plus the bpy that authored
		// it (M1). So the command opened a file that does not exist, in whatever project was
		// loaded, and said nothing about it.
		//
		// What it opens now is derived from the document that is actually open: the bridge
		// knows the Model document's entry, the sibling `<name>.py` beside a `<name>.blend` is
		// the SOURCE (the `.blend` itself is binary and Monaco has nothing to show of it), and
		// when no such script exists the honest answer is the folder, revealed in the Explorer
		// this same command just opened. No model open at all is a refusal BY NAME rather than
		// a silent no-op.
		const folder = workspace.folders[0]?.uri;
		const notifications = accessor.get(INotificationService);
		const commands = accessor.get(ICommandService);
		const files = accessor.get(IFileService);
		const active = documents?.activeSource() ?? null;
		if (!folder) {
			notifications.warn(localize('volterNoFolder', "No folder is open, so there is no model source to open. Open the project folder first."));
			return;
		}
		if (!active) {
			notifications.warn(localize('volterNoModelOpen', "No document is open in the Volter Editor, so this command has no source to show. Run \"Volter Editor: Open Workspace\" and open a model first."));
			return;
		}
		if (active.path === '') {
			// Naming the KIND is the difference between a refusal and a shrug: the reader
			// learns that a document IS open and that it is not one with a file behind it.
			notifications.warn(localize('volterNotAModel', "The active volter document is a \"{0}\", which is not a file on disk, so there is no source to open beside it. Open a model first.", active.kind));
			return;
		}
		const model = joinPath(folder, active.path);
		const script = model.with({ path: model.path.replace(/\.blend$/, '.py') });
		if (script.path !== model.path && await files.exists(script)) {
			await editorService.openEditor({ resource: script, options: { pinned: true } }, SIDE_GROUP);
			return;
		}
		// No bpy beside it — show where the model lives instead of opening its bytes.
		await commands.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, model);
		notifications.info(localize('volterNoModelScript', "{0} has no bpy script beside it ({1}), so the Explorer is showing the model's folder instead.", basename(model), basename(script)));
	}
});
