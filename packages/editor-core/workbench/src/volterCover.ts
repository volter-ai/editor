/*---------------------------------------------------------------------------------------------
 *  THE PRODUCT'S LOADING COVER — what this page shows between the workbench's first paint and
 *  the Volter editor mounting over it.
 *
 *  THIS FILE LIVES IN THE volter-engine REPOSITORY (`packages/editor/workbench/src/`) and is
 *  OVERLAID on a Code-OSS checkout at a pin by `scripts/workbench/overlay.mjs`
 *  (ARCHITECTURE-CORE §The target shape, rule 6). Edit it there; a copy inside a fork checkout
 *  is build output.
 *
 *  WHY IT EXISTS (owner, 2026-09-21, watching their own first open after creating a project
 *  with `--workbench <release>`): *"why does it first show vscode?"* the editor's `edit` command IS the Volter editor —
 *  a person who typed it asked for THIS product — and for the seconds between the page load and
 *  `mountVolter` resolving they were shown somebody else's application instead: VS Code's
 *  menubar, an empty editor group, its trust modal. The frame cannot make the mount instant, so
 *  the product covers its own assembly with its own name.
 *
 *  IT IS DISPLAY ONLY. It takes no focus, registers no key handler and holds nothing of the
 *  editor's state, so the session's tab bootstrap, the keyboard and every part underneath carry
 *  on exactly as they did; it is removed WHOLE rather than hidden. It does absorb the POINTER,
 *  so nothing behind it is half-clicked while it is still assembling — and it sits BELOW the
 *  workbench's own modal layers, so a dialog or a notification that does appear is readable and
 *  clickable OVER it rather than trapped behind it.
 *
 *  IT NAMES NO PRODUCT. The title is `registerVolterProduct`'s, read HERE rather than at module
 *  load so a product that registers late still names the cover, and every colour is a workbench
 *  theme variable — so a product's look paints this element through its OWN theme registration
 *  (`packages/cyclotron/workbench/extensions/theme-blender` and the type in its
 *  `media/blender-look.css`, both of which reach the cover because it is a child of
 *  `.monaco-workbench`) and this file spells no product's palette.
 *
 *  AND SINCE 2026-09-21 A PRODUCT MAY DRAW ITS OWN (owner: *"can each product supply its own
 *  loading?"*). The split is MECHANISM here / CONTENT there: this file keeps when the cover
 *  goes up, how it attaches, that it comes away whole, and what a REFUSAL looks like; the
 *  product's `cover` renders its splash into this element and its `ready` decides when the open
 *  is over (`volterProduct.ts`). A product with neither gets exactly what this file drew before.
 *--------------------------------------------------------------------------------------------*/

import './media/volter-cover.css';
import { $ } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize } from '../../../../nls.js';
import { volterProduct, type VolterProduct, type VolterProductCover } from './volterProduct.js';

/**
 * The cover over one open. Raised by the contribution the moment the workspace folder is known
 * and taken away by whichever of the mount's outcomes arrives — there is no third state and no
 * timer that decides one.
 */
export class VolterOpeningCover {
	/** How many frames to wait for `.monaco-workbench`. See {@link attach}. */
	private static readonly ATTACH_FRAMES = 120;

	private readonly element: HTMLElement;
	/** The kit's own status line — present only while the KIT is drawing the cover. */
	private state: HTMLElement | undefined;
	/** What the product drew, so it can be taken away with the cover. */
	private productCover: VolterProductCover | undefined;
	private removed = false;

	constructor(
		private readonly product: VolterProduct,
		private readonly folderName: string,
	) {
		this.element = $('.volter-opening-cover');
		// THE CONTENT IS THE PRODUCT'S WHEN IT HAS ONE (`VolterProduct.cover`). This class keeps
		// the mechanism either way — the element, the attach, the whole-removal, the refusal —
		// and a product that supplies nothing gets the plain one below, which is what this
		// file drew for every product until 2026-09-21.
		if (this.product.cover) {
			this.element.classList.add('volter-opening-cover-product');
			this.productCover = this.product.cover(this.element, { folderName });
		} else {
			this.drawKitContent();
		}
		this.attach(0);
	}

	/** The kit's own cover: the product's title, the folder, and what is happening. */
	private drawKitContent(): void {
		const heading = $('.volter-opening-cover-title');
		heading.textContent = this.product.title;
		const folder = $('.volter-opening-cover-folder');
		folder.textContent = this.folderName;
		const state = $('.volter-opening-cover-state');
		state.textContent = localize('volterCoverOpening', "Opening…");
		this.state = state;
		this.element.append(heading, folder, state);
	}

	/**
	 * `.monaco-workbench` is built by `Workbench.renderWorkbench`, which runs in the SAME task
	 * as the BlockRestore contributions and AFTER them (`lifecycleService.phase` is already
	 * `Ready` when `WorkbenchContributionsRegistry.start` runs, so that phase's contributions
	 * are constructed synchronously, before the workbench element exists). So the first frame
	 * is where the element is, and this is a retry rather than an observer. The bound is what
	 * keeps a page that never renders a workbench from holding a frame callback forever.
	 *
	 * The cover has to be a DESCENDANT of that element rather than of `body`: the colour theme
	 * is a stylesheet scoped to `.monaco-workbench` (`generateColorThemeCSS(…, '.monaco-workbench', …)`),
	 * so every `--vscode-*` this file reads is inherited through that node and nowhere else.
	 */
	private attach(frame: number): void {
		if (this.removed) { return; }
		const workbench = mainWindow.document.querySelector<HTMLElement>('.monaco-workbench');
		if (workbench) { workbench.appendChild(this.element); return; }
		if (frame >= VolterOpeningCover.ATTACH_FRAMES) { return; }
		mainWindow.requestAnimationFrame(() => this.attach(frame + 1));
	}

	/** The progress line, while one is shown. See {@link note}. */
	private noteElement: HTMLElement | undefined;

	/**
	 * SAY WHAT A SLOW OPEN IS WAITING ON, without calling it a failure (#147 review: a deadline
	 * that flipped the cover to a refusal turned a healthy slow start into a reported failure, and
	 * a refusal is one-way). A line along the bottom, under whichever splash is drawn; `null`
	 * takes it away. A refusal already shown is never replaced by progress.
	 */
	note(text: string | null): void {
		if (this.removed || this.element.classList.contains('volter-opening-cover-failed')) { return; }
		if (text === null) { this.noteElement?.remove(); this.noteElement = undefined; return; }
		if (!this.noteElement) {
			this.noteElement = $('.volter-opening-cover-note');
			this.element.appendChild(this.noteElement);
		}
		this.noteElement.textContent = text;
	}

	/**
	 * A WAY OUT FROM A LONG WAIT, not only from a refusal (#147 re-review): a cover that only
	 * narrates seals the workbench behind it for as long as the wait lasts. The same Dismiss a
	 * refusal grows, offered once the open has been slow for a while; the open goes on behind.
	 */
	offerDismiss(): void {
		if (this.removed || this.element.querySelector('.volter-opening-cover-dismiss')) { return; }
		const dismiss = $<HTMLButtonElement>('button.volter-opening-cover-dismiss.volter-opening-cover-dismiss-waiting');
		dismiss.textContent = localize('volterCoverDismiss', "Dismiss");
		dismiss.addEventListener('click', () => this.remove());
		this.element.appendChild(dismiss);
	}

	/** The editor is there: take the cover away, whole — the product's splash with it. */
	remove(): void {
		this.removed = true;
		this.productCover?.dispose();
		this.productCover = undefined;
		this.element.remove();
	}

	/**
	 * The open did not happen. The cover STAYS, carrying the refusal in the words whoever
	 * refused chose, plus the one control it ever grows: a way out, so the workbench behind is
	 * usable rather than sealed under a product that never arrived.
	 *
	 * THE REFUSAL IS ALWAYS THE KIT'S PRESENTATION, even for a product that drew its own
	 * splash: a splash is a picture of an open that is happening, and this is the one state
	 * where it is not. So the product's content is disposed and the kit draws its own here —
	 * which is also what guarantees a Dismiss exists no matter what a product rendered.
	 */
	fail(message: string): void {
		if (this.removed) { return; }
		// A SECOND REFUSAL REPLACES THE FIRST, never queues behind it: the open's deadline can
		// fire first and the editor's own reason arrive after, and the reason is the better
		// sentence. The Dismiss already drawn stays.
		if (this.element.classList.contains('volter-opening-cover-failed')) {
			if (this.state) { this.state.textContent = message; }
			return;
		}
		this.productCover?.dispose();
		this.productCover = undefined;
		this.element.classList.remove('volter-opening-cover-product');
		this.element.textContent = '';
		this.noteElement = undefined;
		this.drawKitContent();
		this.element.classList.add('volter-opening-cover-failed');
		if (this.state) { this.state.textContent = message; }
		const dismiss = $<HTMLButtonElement>('button.volter-opening-cover-dismiss');
		dismiss.textContent = localize('volterCoverDismiss', "Dismiss");
		dismiss.addEventListener('click', () => this.remove());
		this.element.appendChild(dismiss);
	}
}

/**
 * Raise the cover for `folderName`, or nothing at all when this build has no product: with none
 * the mount command refuses by name (`NO_PRODUCT_REGISTERED`) and there is no editor coming, so
 * there is nothing to cover and the workbench is the honest thing to show.
 */
export function raiseOpeningCover(folderName: string): VolterOpeningCover | undefined {
	const product = volterProduct();
	if (!product) { return undefined; }
	return new VolterOpeningCover(product, folderName);
}
