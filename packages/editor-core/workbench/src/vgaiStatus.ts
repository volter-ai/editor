/*---------------------------------------------------------------------------------------------
 *  OUR STATUS ITEMS ARE STATUS BAR ITEMS — WORK.md §The core is Code-OSS U8.
 *
 *  The bridge already portals `EditorBottomBar` into the workbench's status bar PART, which put
 *  our items in the right place and nowhere in the right MODEL: they were one opaque blob to the
 *  frame, so they had no alignment the workbench understood, no per-item ordering against VS
 *  Code's own entries, no `Hide <item>` in the status bar's context menu, and no participation
 *  in `workbench.statusBar.visible`.
 *
 *  THE DOOR IS `content?: HTMLElement`, and finding it is what made this step complete instead
 *  of partial. `IStatusbarEntry` is otherwise text-shaped (`text`, with `$(icon)` markup) and a
 *  `WorkspaceStatusContribution` is a React COMPONENT with no text form at all — Blender's
 *  version pill, the connection dot, the generation counter. Mapping those onto `text` would
 *  have meant inventing a second, poorer representation for each one, in each owning package,
 *  and calling the ones that did not fit an acceptable partial. `content` takes an element, so
 *  the frame registers a REAL entry per contribution and hands its element back for the bridge
 *  to portal the component into: the workbench owns the item, we own its pixels, and nothing is
 *  approximated.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiStatusBridge`. Its
 *  counterpart is `bridge.tsx`'s `VgaiStatusHandle`.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';

export interface VgaiStatusItem {
	readonly id: string;
	readonly title: string;
	readonly align: 'left' | 'right';
	readonly order: number;
}

export interface VgaiStatusBridge {
	/** Every registered `workspace.status` contribution, right now. */
	list(): readonly VgaiStatusItem[];
	/** Fires when the registry changes. */
	subscribe(listener: () => void): () => void;
	/** The element the workbench will draw this item in; `null` when it goes away. */
	offerBody(itemId: string, element: HTMLElement | null): void;
}

export class VgaiStatus extends Disposable {

	private readonly generation = this._register(new DisposableStore());
	private published = '';

	constructor(
		private readonly bridge: VgaiStatusBridge,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();
		this._register(toDisposable(bridge.subscribe(() => this.publish())));
		this.publish();
	}

	private publish(): void {
		const items = this.bridge.list();
		// A NO-OP IS SILENT, for `vgaiUtilityViews.ts`'s reason: the editor's registry emits
		// more often than its membership changes, and re-adding entries makes the bar flicker.
		const signature = items.map(item => `${item.id}\u0000${item.align}\u0000${item.order}`).join('\u0001');
		if (signature === this.published) { return; }
		this.generation.clear();
		this.published = signature;
		for (const item of items) {
			const element = $('.vgai-status-item');
			element.style.cssText = 'display:flex;align-items:center;height:100%;';
			// PRIORITY IS THE ORDER, NEGATED on the right. The workbench sorts descending from
			// the centre outwards on both sides, while our registry's `order` ascends from the
			// edge — so a left item keeps its sign and a right item flips, and the two bars read
			// the same left-to-right.
			const priority = item.align === 'right' ? -item.order : item.order;
			const accessor: IStatusbarEntryAccessor = this.statusbarService.addEntry({
				name: item.title,
				text: '',
				ariaLabel: item.title,
				content: element,
			}, `vgai.status.${item.id}`, item.align === 'right' ? StatusbarAlignment.RIGHT : StatusbarAlignment.LEFT, priority);
			this.generation.add(toDisposable(() => { this.bridge.offerBody(item.id, null); accessor.dispose(); }));
			this.bridge.offerBody(item.id, element);
		}
	}
}
