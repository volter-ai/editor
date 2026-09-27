/*---------------------------------------------------------------------------------------------
 *  THE PRODUCT'S HALF OF THE WORKBENCH CONTRIBUTION — one door, called once, at load.
 *
 *  The kit's contribution (`vgai.contribution.ts`) is product-neutral: it hands the workbench's
 *  parts to the vgai editor, owns the document pane, the product-declared views, the mount command
 *  and every door's frame half. What it CANNOT know is what the thing being edited is called,
 *  what this product says when it asks for trust, which colour theme its look wears, or what
 *  else this product installs once the bridge is up. Those are the product's, and this is how
 *  a product states them:
 *
 *      import { registerVgaiProduct } from '../../vgai/browser/vgaiProduct.js';
 *
 *      registerVgaiProduct({ id: 'model-editor', title: 'Model', trustSentence: … });
 *
 *  THE SHAPE IS THE UNION OF WHAT THE FORK'S PRODUCT-SPECIFIC IDENTIFIERS PARAMETERISED, and
 *  nothing more. Measured against the tier as it stood at fork 53bf66e4205f:
 *
 *    `title`         — `localize('vgaiModelPane', "Model")` (the pane's registered name) and
 *                      `localize2('vgaiContainer', "Model")` (the view container's title), the
 *                      two places the word `Model` reached a person through the frame.
 *    `trustSentence` — `localize('vgaiTrustRequest', "The vgai Model workspace runs this
 *                      project's own code — its editor contributions, its dev server and its
 *                      game. Trust this folder to open it.")`. A model editor has no game and
 *                      a game editor has no Blender engine in the tab, so the WHOLE sentence is
 *                      the product's; the refusal beside it named the command and is the kit's
 *                      now that the command is `VGAI: Open Workspace`.
 *    `mount`         — `vgaiGameSkew.ts`, which the mount command constructed for every product
 *                      because there was only one contribution to construct it from.
 *
 *  WHAT IS DELIBERATELY NOT HERE. The product's DEFAULT WORKSPACE (`model`, `game`) is not a
 *  frame fact: nothing under `src/vs/` ever read one, and the product already declares it in
 *  its own entry (`product({ workspace })`, `packages/editor/src/frame/product.ts`), which is
 *  the in-realm side that acts on it. A second declaration here would be a second author of
 *  one fact.
 *
 *  A PRODUCT'S WORKBENCH HALF IMPORTS ONLY THIS FILE AND `vgaiColors.ts` — never
 *  `vgai.contribution.ts`. Both are leaves that register nothing of the contribution, so the
 *  overlay can write the product's import line ABOVE the kit's and be sure the product is
 *  registered before the kit reads it. Importing the contribution would evaluate it first and
 *  the kit would find no product.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

/** What the kit hands a product when the bridge has mounted. */
export interface VgaiProductMountContext {
	/**
	 * What `mountVgai` handed back. The kit's own doors are installed by the kit; a product
	 * reads the member its OWN bridge half publishes (`bridge.tsx`'s `VgaiGameHandle` →
	 * `vgaiGameSkew.ts`'s `VgaiGameBridge`) and declares the shape it expects, exactly as the
	 * kit declares the shapes it expects. Nothing under `src/vs/` can import the bridge's
	 * types — it is React TSX this fork does not compile — so both sides are mirrors, as they
	 * have always been.
	 */
	readonly mount: Readonly<Record<string, unknown>>;
	/** The ids the kit registered, PASSED rather than imported, so a product never becomes a
	 *  second author of an id the kit spells (and never imports the contribution module). */
	readonly ids: {
		readonly pane: string;
		readonly hierarchyView: string;
		readonly inspectorView: string;
		readonly contentView: string;
	};
	readonly instantiationService: IInstantiationService;
	/** Lives as long as the mount's own installations do. */
	readonly store: DisposableStore;
}

/** What the kit hands a product when it raises the opening cover. The folder is all there is
 *  to say at that moment: it is the first instant the workspace is known, before any session,
 *  any project file or any mount. */
export interface VgaiProductCoverContext {
	readonly folderName: string;
}

/** A product's rendered splash, so the kit can take it away when the cover comes down. */
export interface VgaiProductCover {
	dispose(): void;
}

/** Native view containers and starting proportions. The product owns the defaults;
 * Code-OSS owns subsequent moves, resizing and persistence. */
export interface VgaiProductLayout {
	readonly sidebarWidth: number;
	readonly containers: readonly {
		readonly id: string;
		readonly title: string;
		readonly location: 'sidebar' | 'auxiliarybar';
		readonly views: readonly {
			readonly part: 'outliner' | 'properties' | 'content';
			readonly title: string;
			readonly weight: number;
		}[];
	}[];
}

/** Everything a product tells the kit's contribution. */
export interface VgaiProduct {
	/** `model-editor`, `game-editor` — the product package's own short name. Reported by the
	 *  release's `BUILD.json` and never branched on. */
	readonly id: string;
	/** What the thing being edited is called: the document pane's registered name and the
	 *  sidebar container's title. */
	readonly title: string;
	readonly layout: VgaiProductLayout;
	/** The product's own sentence in the workbench's trust prompt. */
	readonly trustSentence: string;
	/** Anything else this product installs once the bridge has mounted. */
	mount?(context: VgaiProductMountContext): void;
	/**
	 * THIS PRODUCT'S OWN SPLASH, drawn into the kit's cover element (owner, 2026-09-21:
	 * *"can each product supply its own loading?"*).
	 *
	 * THE SPLIT IS MECHANISM / CONTENT. The kit owns WHEN the cover is raised (the first
	 * moment the workspace folder is known), HOW it attaches (`.monaco-workbench`, so the
	 * theme's variables are inherited), that it is removed WHOLE, that a folder with no
	 * session gets none, and what a REFUSAL looks like — that last one stays the kit's
	 * because a product's splash is a picture of an open that is happening, and a refusal is
	 * the one state where it is not. The product owns everything a person actually sees
	 * while it IS happening: its own markup, its own stylesheet out of its `media/`, its
	 * logo, its colours, its wording.
	 *
	 * It may spell its own palette, and that is the difference between this and every other
	 * surface in the kit: the cover paints BEFORE the product's theme extension is
	 * registered, so a splash that waited for `--vscode-*` to become the look's values would
	 * be the wrong colour for exactly the seconds it exists.
	 *
	 * With none, the kit's plain cover (title / folder / "Opening…") is what shows.
	 */
	cover?(host: HTMLElement, context: VgaiProductCoverContext): VgaiProductCover;
	/**
	 * WHEN THIS PRODUCT IS OPEN, in its own terms — and the kit takes the cover down then.
	 *
	 * `mountVgai` resolving means the EDITOR is assembled, which is not the same as the thing
	 * a person came to see being on screen. Measured 2026-09-21 on the model editor: the
	 * mount resolved and the person then watched the editor's own "No document open yet (0
	 * registered)" for ~12 s while Blender booted. That gap is this member's whole reason:
	 * the model editor resolves when its Model document is open and drawn, the game editor
	 * when the Game document is.
	 *
	 * A REJECTION is the same path as a mount failure: the cover stays and carries the
	 * message in the product's words, with a way out. So a product that waits here bounds its
	 * own wait and says what it was waiting for — the kit has no timer of its own and will
	 * not invent one.
	 *
	 * With none, the cover comes down when `mountVgai` resolves, as it did before this
	 * member existed.
	 */
	ready?(context: VgaiProductMountContext): Promise<void>;
}

let registered: VgaiProduct | undefined;

/**
 * Register this build's product. Called at module scope by the product's own workbench
 * contribution, which the overlay imports ABOVE the kit's.
 *
 * A SECOND CALL IS A THROW, not a replacement: two products in one workbench means the overlay
 * copied two product halves into one build, and a silent last-one-wins would decide which
 * editor a person is looking at by import order.
 */
export function registerVgaiProduct(product: VgaiProduct): void {
	if (registered) {
		throw new Error(
			`the vgai workbench already has a product (${registered.id}); ${product.id} is a second one. ` +
			'One build is one product (ARCHITECTURE-CORE §The target shape, rule 4) — the overlay copies ' +
			'exactly one product\'s workbench half into a checkout (scripts/workbench/overlay.mjs --product).'
		);
	}
	registered = product;
}

/** The registered product, or `undefined` when the overlay wrote none. */
export function vgaiProduct(): VgaiProduct | undefined {
	return registered;
}

/**
 * What the kit says when it is asked to mount with no product. It is a REFUSAL BY NAME rather
 * than a default product: a workbench with the kit and no product is a build that was assembled
 * wrong, and the only honest thing it can do is say which step did not run.
 */
export const NO_PRODUCT_REGISTERED =
	'No vgai product is registered in this workbench, so there is nothing to open. The build overlays ' +
	'the editor kit AND one product on the Code-OSS fork at a pin (ARCHITECTURE-CORE §The target shape, ' +
	'rule 6): run scripts/workbench/overlay.mjs --checkout <fork dir> --product <model-editor|game-editor> ' +
	'from a vgai-engine checkout, then compile the fork again.';
