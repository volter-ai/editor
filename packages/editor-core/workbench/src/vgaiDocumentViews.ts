/* Native editor occurrences own views. A pane/DOM slot is only an attachment:
 * hiding or moving it must not dispose the document's content. */
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { VgaiDocumentInput } from './vgaiDocumentInput.js';

export interface VgaiDocumentView {
	readonly id: string;
	readonly documentId: string;
	readonly element: HTMLElement | null;
}

interface Occurrence {
	readonly id: string;
	readonly documentId: string;
	groupId: number;
	retired: boolean;
	element: HTMLElement | null;
}

const occurrences = new Map<string, Occurrence>();
let sequence = 0;
let sink: ((view: VgaiDocumentView, closed: boolean) => void) | undefined;
const key = (groupId: number, documentId: string) => JSON.stringify([groupId, documentId]);

export function documentView(groupId: number, input: EditorInput): Occurrence | undefined {
	if (!(input instanceof VgaiDocumentInput) || input.documentId === undefined) { return undefined; }
	const address = key(groupId, input.documentId);
	let view = occurrences.get(address);
	if (!view) {
		view = { id: `view:${++sequence}`, documentId: input.documentId, groupId, retired: false, element: null };
		occurrences.set(address, view);
		sink?.(view, false);
	}
	return view;
}

export function attachDocumentView(groupId: number, input: EditorInput, element: HTMLElement): (() => void) | undefined {
	const view = documentView(groupId, input);
	if (!view) { return undefined; }
	view.element = element;
	sink?.(view, false);
	return () => {
		// A source pane may clear after the destination already attached a moved view.
		if (view.retired || view.element !== element) { return; }
		view.element = null;
		sink?.(view, false);
	};
}

export function installDocumentViewSink(next: (view: VgaiDocumentView, closed: boolean) => void): void {
	sink = next;
	for (const view of occurrences.values()) { next(view, false); }
}

export class VgaiDocumentViews extends Disposable {
	private readonly groups = new Map<number, DisposableStore>();
	private queued = false;
	constructor(@IEditorGroupsService private readonly editorGroups: IEditorGroupsService) {
		super();
		for (const group of editorGroups.groups) { this.watch(group); }
		this._register(editorGroups.onDidAddGroup(group => this.watch(group)));
		this._register(editorGroups.onDidRemoveGroup(group => {
			this.groups.get(group.id)?.dispose();
			this.groups.delete(group.id);
			this.reconcile();
		}));
	}
	private watch(group: IEditorGroup): void {
		if (this.groups.has(group.id)) { return; }
		const listeners = new DisposableStore();
		this.groups.set(group.id, listeners);
		listeners.add(group.onDidModelChange(() => this.reconcile()));
		listeners.add(group.onWillMoveEditor(event => {
			const view = documentView(group.id, event.editor);
			if (!view || occurrences.has(key(event.target, view.documentId))) { return; }
			// Native move opens its target before closing its source. Hold the same
			// occurrence across that synchronous membership change, then reconcile.
			occurrences.delete(key(group.id, view.documentId));
			view.groupId = event.target;
			occurrences.set(key(event.target, view.documentId), view);
		}));
		this.reconcile();
	}
	private reconcile(): void {
		// Native model events can fire inside a move before both memberships have
		// settled. Never infer disposal from its intermediate open/close events.
		if (this.queued) { return; }
		this.queued = true;
		queueMicrotask(() => {
			this.queued = false;
			if (this._store.isDisposed) { return; }
			const live = new Set<string>();
			for (const group of this.editorGroups.groups) {
				for (const input of group.editors) {
					const view = documentView(group.id, input);
					if (view) { live.add(key(group.id, view.documentId)); }
				}
			}
			for (const [address, view] of occurrences) {
				if (live.has(address)) { continue; }
				occurrences.delete(address);
				view.retired = true;
				sink?.(view, true);
			}
		});
	}
	override dispose(): void {
		for (const listeners of this.groups.values()) { listeners.dispose(); }
		this.groups.clear();
		for (const view of occurrences.values()) { view.retired = true; sink?.(view, true); }
		occurrences.clear();
		sink = undefined;
		super.dispose();
	}
}
