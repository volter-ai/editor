/*---------------------------------------------------------------------------------------------
 *  THE GAME EDITOR'S WORKBENCH HALF — everything about this build that is a GAME editor's
 *  rather than the editor kit's.
 *
 *  THIS FILE LIVES IN THIS REPOSITORY (`packages/game-editor/workbench/src/`) and is OVERLAID
 *  on a Code-OSS checkout at a pin by `scripts/workbench/overlay.mjs --product game-editor`.
 *  Edit it here.
 *
 *  It is the counterpart of `packages/game-editor/src/index.ts`, which composes the SAME
 *  product in the editor's own realm. There is exactly one piece of workbench code that is a
 *  game editor's and not any editor's, and it is `vgaiGameSkew.ts` beside this file: what the
 *  frame must answer for a GAME layout — immersive Play, the semantic dock commands, and the
 *  surface-keyboard probe. Everything else a game editor draws is the kit's.
 *
 *  NO LOOK ROWS. This product wears Classic — the editor's own Graphite, which is the reference
 *  frame every host-default shape was measured against — and Classic is the workbench's own
 *  themes, so it declares none. A `looks` row is a claim that this build SHIPS a theme
 *  extension for that look, and this one ships none.
 *
 *  IT DOES SHIP ONE STYLESHEET, and only one: `media/game-cover.css`, this product's own
 *  opening splash. It spells Classic's palette because the cover paints before any theme is
 *  registered at all — see that file's header, and `vgaiProduct.ts`'s `cover`.
 *--------------------------------------------------------------------------------------------*/

import './media/game-cover.css';
import { $ } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize } from '../../../../nls.js';
import { registerVgaiProduct, type VgaiProductCover, type VgaiProductCoverContext, type VgaiProductMountContext } from '../../vgai/browser/vgaiProduct.js';
import { VgaiGameSkew, type VgaiGameBridge } from './vgaiGameSkew.js';

/** What this product reads off the mount to know its Game document is open and drawn — a
 *  MIRROR of the kit's `VgaiDocumentsBridge`, declared here for the same reason
 *  `VgaiGameBridge` is: a product declares the shape it expects (`vgaiProduct.ts`'s header),
 *  and a door this build's kit does not have reads as missing rather than as a crash. */
interface DocumentsRegistry {
	whenRestored?(): Promise<void>;
	/** `area` is set only for a document the active WORKSPACE opened into one of its
	 *  `areas`; {@link openDocument} is why this mirror carries it. */
	list?(): readonly { readonly id: string; readonly title: string; readonly area?: unknown }[];
	activeId?(): string | null;
	subscribe?(listener: () => void): () => void;
}

/**
 * IS A DOCUMENT A PERSON CAME TO SEE OPEN — never an AREA document.
 *
 * A workspace's own `areas` open WITH THE LAYOUT, before the adapter's table has settled,
 * and they are never activatable, so counting one calls the product open over an empty
 * pane. It is walk 4's W2 (#7739) — the rule `openDefaultTableDocument` states in as many
 * words — reappearing in a `ready` written after it. Measured on the MODEL editor (walk 5
 * beat 3: `openDocumentIds: ["tool:blender-timeline.document"]` answered as "open"); this
 * product carries the same predicate, and a `game` scaffold links `@volter/editor-blender`, so its
 * Model workspace's Timeline area registers here too.
 */
function openDocument(registry: DocumentsRegistry): boolean {
	return (
		(registry.list?.() ?? []).some((document) => document.area === undefined) &&
		registry.activeId?.() !== null
	);
}

/**
 * HOW LONG THIS PRODUCT WAITS FOR ITS FIRST DOCUMENT. Shorter than the model editor's 90 s
 * because what is being waited for is smaller: a game editor boots its project's own modules
 * and draws a scene, where the model editor waits for Blender itself to come up in the tab's
 * worker. Past it the honest thing is to say the game did not open, which the kit turns into
 * the cover's refusal with a way out.
 */
const GAME_OPEN_BUDGET_MS = 60_000;

/** This product's splash while it is opening, so `ready` can narrate its own wait into the
 *  cover it drew. Set by `cover`, cleared by the handle's `dispose`. */
let splash: { say(text: string): void } | undefined;

registerVgaiProduct({
	id: 'game-editor',
	layout: {
		sidebarWidth: 260,
		containers: [
			{
				id: 'workbench.view.vgai',
				title: 'Game',
				location: 'sidebar',
				views: [
					{ part: 'outliner', title: 'Hierarchy', weight: 50 },
					{ part: 'content', title: 'Content', weight: 50 },
				],
			},
			{
				id: 'workbench.view.vgai.inspector',
				title: 'Inspector',
				location: 'auxiliarybar',
				views: [{ part: 'properties', title: 'Inspector', weight: 100 }],
			},
		],
	},
	title: localize('vgaiGameTitle', "Volter Game Editor"),
	// The workbench's own trust prompt, in this product's words: a game project runs its own
	// code the moment it opens — its contributions from its `node_modules`, its dev server, and
	// the game itself in the pane.
	trustSentence: localize('vgaiGameTrustRequest', "Volter Game Editor runs this project's own code — its editor contributions, its dev server and its game. Trust this folder to open it."),
	// THIS PRODUCT'S OWN SPLASH (F4). The kit owns the cover's mechanism — when it goes up,
	// that it comes away whole, what a refusal looks like; this is the picture inside it, in
	// Classic's own palette and this product's own words, drawn with no image to fetch so the
	// first painted frame is already this.
	cover(host: HTMLElement, context: VgaiProductCoverContext): VgaiProductCover {
		const root = $('.vgai-game-cover');
		// THE MARK, built as ELEMENTS. Not `innerHTML` — the page carries a Trusted Types
		// policy and the workbench's own code never assigns markup — and not a file either,
		// because an image to fetch is a frame to wait for.
		const mark = $.SVG<SVGElement>('svg', { class: 'vgai-game-cover-mark', viewBox: '0 0 48 48', 'aria-hidden': 'true' });
		mark.append(
			$.SVG<SVGElement>('rect', { x: '4', y: '4', width: '40', height: '40', rx: '9', fill: '#242424', stroke: '#333333' }),
			$.SVG<SVGElement>('path', { d: 'M20 16 L34 24 L20 32 Z', fill: '#579eff' }),
		);
		const title = $('.vgai-game-cover-title');
		title.textContent = localize('vgaiGameCoverTitle', "Game");
		const folder = $('.vgai-game-cover-folder');
		folder.textContent = context.folderName;
		const state = $('.vgai-game-cover-state');
		state.textContent = localize('vgaiGameCoverStarting', "Starting the editor…");
		root.append(mark, title, folder, $('.vgai-game-cover-rail'), state);
		host.appendChild(root);
		splash = { say: (text: string) => { state.textContent = text; } };
		return {
			dispose: () => {
				splash = undefined;
				root.remove();
			},
		};
	},
	// WHEN THIS PRODUCT IS OPEN: when its Game document is registered, active and drawn. The
	// mount resolving is the EDITOR being assembled — the project's own modules still have to
	// load and the scene still has to draw, and the editor's own "No document open yet" is
	// what a person would otherwise watch in that window.
	async ready(context: VgaiProductMountContext): Promise<void> {
		const registry = context.mount['documents'] as DocumentsRegistry | undefined;
		// A bridge without the door is a MISSING door: with nothing to watch, the mount
		// resolving is the answer, which is what this product did before `ready` existed.
		if (!registry?.subscribe || !registry.list || !registry.activeId) { return; }
		await registry.whenRestored?.();
		// An explicitly empty tab session is a valid authoring workspace.
		if (registry.list().length === 0) { return; }
		const open = (): boolean => openDocument(registry);
		if (!open()) {
			splash?.say(localize('vgaiGameCoverWaiting', "Opening the game…"));
			await new Promise<void>((resolve, reject) => {
				let unsubscribe: (() => void) | undefined;
				let timer: number | undefined;
				// DECLARED BEFORE EITHER IS INSTALLED, because a registry that notifies
				// synchronously from `subscribe` would otherwise reach a `const` still in its
				// temporal dead zone and throw out of this promise.
				const stop = () => {
					if (timer !== undefined) { mainWindow.clearTimeout(timer); }
					unsubscribe?.();
					unsubscribe = undefined;
				};
				timer = mainWindow.setTimeout(() => {
					stop();
					reject(new Error(localize('vgaiGameCoverTimedOut', "No document opened within {0}s. The project's own modules load through the editor session; `volter-game-editor console` is where it says why.", Math.round(GAME_OPEN_BUDGET_MS / 1000))));
				}, GAME_OPEN_BUDGET_MS);
				unsubscribe = registry.subscribe?.(() => { if (open()) { stop(); resolve(); } });
				// One more read after subscribing: the document can land between the check
				// above and this listener, and then no further change is coming.
				if (open()) { stop(); resolve(); }
			});
		}
		// DRAWN, not merely registered — the pane paints the active document on the frame
		// after the registry names it, so the cover lifts onto the game and not onto the empty
		// pane it was covering.
		splash?.say(localize('vgaiGameCoverDrawing', "Drawing…"));
		await new Promise<void>((resolve) => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
	},
	mount(context: VgaiProductMountContext): void {
		// THE GAME SKEW'S THREE FRAME ANSWERS (vgaiGameSkew.ts, U2). The bridge publishes its
		// half beside the kit's doors; a bridge without it is a missing door rather than a
		// crash, which is the same rule every other door here follows.
		const bridge = context.mount['game'] as VgaiGameBridge | undefined;
		if (!bridge) { return; }
		context.store.add(context.instantiationService.createInstance(VgaiGameSkew, bridge, {
			pane: context.ids.pane,
			hierarchyView: context.ids.hierarchyView,
			inspectorView: context.ids.inspectorView,
			contentView: context.ids.contentView,
		}));
	},
});
