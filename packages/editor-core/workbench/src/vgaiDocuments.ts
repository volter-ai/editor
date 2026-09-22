/*---------------------------------------------------------------------------------------------
 *  THE EDITOR'S OPEN DOCUMENTS ARE THE GROUP'S EDITORS — walk 3's beat 19, fixed forward
 *  2026-09-20.
 *
 *  U2 put the Game document in the editor pane and that reading was right as far as it went:
 *  the bridge draws the ACTIVE workspace document into the one part the mount hands over. What
 *  nothing carried was the open SET. The workbench had exactly one editor — the bootstrap
 *  `Model` — whatever the registry held, so a document that was open and NOT active could not
 *  be reached by any workbench gesture: quick open's `edt ` listed one row, and
 *  `View: Open Next Editor` had nowhere to go.
 *
 *  An ingest root is where that stops being cosmetic. `landIngestBootInEdit` deliberately puts
 *  the authoring Scene in front at boot while `acquireLiveDocument` keeps the Game document
 *  open behind it — standalone the dock draws both as tabs and a person clicks Game. Under the
 *  frame there was no tab and no second editor, so the walk measured `playState: "playing"`
 *  with the pane still reading "No renderable content" and ONE canvas in the page: the Game
 *  document's content had never mounted, so the realm host was never parented and the points
 *  never drew.
 *
 *  WHAT THIS DOES. One `VgaiDocumentInput` per open document, placed by native editor groups; the
 *  registry's active document is the group's active editor; and the group's active editor is
 *  pushed BACK into the registry, so `View: Open Next Editor`, quick open and ⌘1 switch the
 *  drawn document the way they switch any other editor.
 *
 *  THE ORDER IS LOAD-BEARING: open, then activate, then close. Closing the bootstrap input
 *  while it is the group's ACTIVE editor runs `doHideActiveEditorPane`, which REMOVES the
 *  pane's container from the DOM — and that container is what the bridge's React portals point
 *  at. Activating a document editor first means the close never touches the active pane. For
 *  the same reason an empty document list is left alone: the bootstrap stays, and the frame
 *  behaves exactly as it did before this file existed.
 *
 *  AND AN AREA DOCUMENT IS A SECOND GROUP — WORK.md's Timeline item 1, 2026-09-20. Blender's
 *  Layout screen puts the Timeline full-width UNDER the 3D viewport, and the ruling that made
 *  that reachable here is "a Blender editor AREA is an editor group" (orchestrator,
 *  2026-09-19). The mechanism is VS Code's own: `IEditorGroupsService.addGroup(location,
 *  GroupDirection)` splits the group the mount used, `setSize`/`getSize` give it Blender's
 *  measured share of the two groups' combined extent, and `onDidRemoveGroup` says when one
 *  went away. Before this the Timeline was a hidden TAB beside the Model document — one group,
 *  `display:none` on everything but the active document — which is not a bottom area at all.
 *
 *  THE SIZE IS A BOOTSTRAP, NOT AN ASSERTION, exactly as `WorkspaceAreaContribution.ratio`
 *  says: it is applied when the area is STOOD UP — the first open, and every workspace switch
 *  that puts a different document there — and never while the same document sits in it, so a
 *  person's drag on the sash is theirs. A group the person CLOSED is re-created on the next
 *  reconcile, because a Blender area is resized or joined, never closed. `sizeAreaGroup` below
 *  carries the measurement that says why one `setSize` is not enough.
 *
 *  Activation in any native group selects its document. Layout areas are excluded so
 *  clicking a Timeline does not change the current model. Native serialization preserves
 *  placement across reloads; the bridge only resolves each restored input's content.
 *
 *  Nothing under `src/vs/` imports an editor module: what arrives is `VgaiDocumentsBridge`.
 *  Its counterpart is `bridge.tsx`'s `VgaiDocumentsHandle`.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { EditorCloseContext } from '../../../common/editor.js';
import { GroupDirection, GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
// From the LEAF module, never from the contribution: importing it back from there
// while the contribution imports `VgaiDocuments` is the cycle the production emit's
// dependency checker fails on (see `vgaiDocumentInput.ts`'s header).
import { VgaiDocumentInput } from './vgaiDocumentInput.js';
import { documentView, VgaiDocumentView } from './vgaiDocumentViews.js';

/** The workspace AREA one document fills — `WorkspaceAreaContribution`'s own three fields,
 *  reshaped so that no file under `src/vs/` imports an editor module. `place` is relative to
 *  the group the mount used; `ratio` is that area's share of the two groups' combined extent,
 *  and it is the BOOTSTRAP size only. */
export interface VgaiDocumentArea {
	readonly id: string;
	readonly place: 'left' | 'right' | 'above' | 'below';
	readonly ratio: number;
}

export interface VgaiDocument {
	readonly id: string;
	readonly title: string;
	/** Set only for a document the active workspace opened into one of its `areas`. */
	readonly area?: VgaiDocumentArea;
}

/** Blender's `place`, as VS Code's own split direction. */
const AREA_DIRECTION: Record<VgaiDocumentArea['place'], GroupDirection> = {
	left: GroupDirection.LEFT,
	right: GroupDirection.RIGHT,
	above: GroupDirection.UP,
	below: GroupDirection.DOWN,
};

export interface VgaiDocumentsBridge {
	whenRestored?(): Promise<void>;
	/** The active document's kind and the project-relative file it is, or null. */
	activeSource(): { kind: string; path: string } | null;
	/** Every OPEN workspace document, in the registry's own order. */
	list?(): readonly VgaiDocument[];
	/** The registry's active document id, or null. */
	activeId?(): string | null;
	/** Fires when the open set, the titles or the active document change. */
	subscribe?(listener: () => void): () => void;
	/** Activate one open document — the frame's half of a tab click. */
	activate?(id: string, viewId?: string): void;
	/** Close one open document — the frame's half of `View: Close Editor`. */
	close?(id: string): void;
	/** Publish one native editor occurrence; detachment is distinct from close. */
	setView?(view: VgaiDocumentView, closed: boolean): void;
}

export class VgaiDocuments extends Disposable {

	/** The group the mount used, and the one the registry's ACTIVE document draws in.
	 *  REBOUND, never latched: a person can close its last editor, which disposes it. */
	private group: IEditorGroup;
	private readonly registeredDocuments = new Set<string>();
	/** One group per workspace AREA, keyed by the area's id — the frame's half of
	 *  `WorkspaceAreaContribution.id`'s own promise ("the frame's editor group is keyed by
	 *  it"). Cleared by `onDidRemoveGroup` when a person closes one. */
	private readonly areaGroups = new Map<string, IEditorGroup>();
	/** The DOCUMENT each area GROUP last stood up with, keyed by the group's own id and not by
	 *  the area's. A workspace switch puts a different document in the same group (the Shading
	 *  workspace's node editor where the Model workspace's Timeline was), and that is a fresh
	 *  stand-up at the new area's ratio — which is what Blender does too, because switching
	 *  workspaces restores that workspace's screen. Keyed by AREA id this missed the trip back:
	 *  the Timeline's area/document pair was unchanged from before the switch, while the group
	 *  it lives in had been resized to the shader area's 0.5 in between (measured 2026-09-20:
	 *  Model came back at 476/476 instead of 882/70). The same document sitting in the same
	 *  group keeps whatever size the person dragged it to. */
	private readonly areaDocuments = new Map<number, string>();
	/** Areas stood up during the pass now running, sized once it has finished opening AND
	 *  closing — see `groupForArea` for why the order matters. */
	private readonly areaToSize = new Map<string, { group: IEditorGroup; area: VgaiDocumentArea }>();
	/** True while THIS class is driving the group, so the active-editor
	 *  listener does not report our own activation back as a person's gesture. */
	private applying = false;
	/** The bound group was disposed (its last editor closed, a merge, a closed window).
	 *  A FLAG TO REBIND ON, not a latch — see `liveGroup`. */
	private groupGone = false;
	/** The document id this class last made the group's active editor; `null`
	 *  until the first pass, so the first pass always activates. */
	private appliedActiveId: string | null = null;
	/** The dispose watch on the bound group, re-armed by `watchGroup` on every rebind. */
	private readonly groupWatch = this._register(new MutableDisposable());
	private pass: Promise<void> = Promise.resolve();
	private queued = false;

	constructor(
		private readonly bridge: VgaiDocumentsBridge,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
	) {
		super();
		// Native restoration owns the group grid, including intentionally empty splits.
		this.group = editorGroupsService.activeGroup;
		// Restoration already chose the active native editor, possibly a source file.
		// Registry metadata alone must not steal focus on the first reconciliation.
		this.appliedActiveId = bridge.activeId?.() ?? null;
		// A bridge older than this door is a MISSING door, not a crash: the frame keeps the
		// one bootstrap editor and behaves exactly as it did before.
		if (!this.bridge.list || !this.bridge.subscribe || !this.bridge.activate) { return; }
		this.watchGroup();
		this.reportActiveEditor();
		this._register(toDisposable(this.bridge.subscribe(() => this.schedule())));
		this._register(this.editorService.onDidActiveEditorChange(() => this.reportActiveEditor()));
		this._register(this.editorGroupsService.onDidChangeActiveGroup(() => this.reportActiveEditor()));
		// A BLENDER AREA IS RESIZED OR JOINED, NEVER CLOSED. If a person closes the area's
		// group the map must forget it (its `IEditorGroup` is dead) and the next reconcile
		// re-creates it — which is this schedule, because the registry has no reason to
		// notify about a workbench group going away.
		this._register(editorGroupsService.onDidRemoveGroup(removed => {
			let ours = removed === this.group;
			for (const [id, group] of this.areaGroups) {
				if (group === removed) { this.areaGroups.delete(id); ours = true; }
			}
			if (ours) { this.schedule(); }
		}));
		// A PERSON'S CLOSE IS THE DOCUMENT'S CLOSE (walk 4, W12). `View: Close Editor` on a
		// vgai editor used to leave the registry reporting that document open and ACTIVE with
		// no editor anywhere — `vgai status` disagreed with the screen, and the next reconcile
		// simply re-opened the tab. `this.applying` is what tells a person's close from one of
		// our own: every close this class makes runs inside a pass with that flag set.
		this._register(this.editorService.onDidCloseEditor(event => {
			if (this.applying) { return; }
			const editor = event.editor;
			if (!(editor instanceof VgaiDocumentInput) || editor.documentId === undefined) { return; }
			// A MOVE IS NOT A CLOSE: dragging an editor between groups closes it in one and
			// opens it in the other, and the workbench says so (`context`). Closing a document
			// that is still open somewhere is the tab reappearing for no reason.
			if (event.context === EditorCloseContext.MOVE) { return; }
			if (this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).some(group => group.contains(editor))) { return; }
			this.bridge.close?.(editor.documentId);
		}));
		this.schedule();
	}

	/** Re-arm the dispose watch on whatever group is currently bound. */
	private watchGroup(): void {
		this.groupGone = false;
		this.groupWatch.value = this.group.onWillDispose(() => { this.groupGone = true; });
	}

	/**
	 * THE BOUND GROUP, REBOUND WHEN IT DIED — walk 4's W12, fixed 2026-09-21.
	 *
	 * This used to be a latch: `onWillDispose` set `groupGone` and every later `reconcile`
	 * returned immediately, forever. A person closing the Model document closes the main
	 * group's last editor, which disposes that group — so after ONE close the class was inert
	 * and nothing could open a vgai document again for the rest of the session. The workspace
	 * came back with the Timeline alone and the mount command was a no-op.
	 *
	 * A group going away is ordinary. What the class needs is the group our documents should
	 * draw in NOW: the live one already holding one of our inputs (the Timeline's, when that is
	 * all that is left), else the active one. Both are real groups the workbench maintains; the
	 * class re-binds, re-arms its dispose watch, and carries on.
	 */
	private liveGroup(): IEditorGroup {
		if (!this.groupGone) { return this.group; }
		const groups = this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		const areaGroups = new Set(this.areaGroups.values());
		const holding = groups.find(group => !areaGroups.has(group)
			&& group.editors.some(editor => editor instanceof VgaiDocumentInput));
		this.group = holding ?? this.editorGroupsService.activeGroup;
		// The mount's own active-editor report is the MAIN group's only, so the bound group
		// changing means the registry's next activation belongs to a different group.
		this.appliedActiveId = null;
		this.watchGroup();
		return this.group;
	}

	/**
	 * The editor group for one area — created on first use, ADOPTED when one is already there.
	 *
	 * `addGroup(location, direction)` is VS Code's own split of the group the mount used. A
	 * group that is already in that direction is the area and is adopted rather than split
	 * again: the workbench RESTORES its editor grid across a reload while our inputs are not
	 * serialized, so the area's group comes back EMPTY and waiting, and a person may also have
	 * closed and re-split it. Measured 2026-09-20 before that branch existed: every reload of
	 * the frame added another group, three deep, each a split of a strip already sized to
	 * `ratio`. A neighbour that still HOLDS editors is somebody else's (a Monaco file split
	 * below) and is left alone.
	 */
	private groupForArea(area: VgaiDocumentArea, documentId: string): IEditorGroup {
		const restored = this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).find(group => group.editors.some(editor => editor instanceof VgaiDocumentInput && editor.documentId === documentId));
		if (!this.areaGroups.has(area.id) && restored) {
			this.areaGroups.set(area.id, restored);
			this.areaDocuments.set(restored.id, documentId);
			return restored;
		}
		const known = this.areaGroups.get(area.id);
		const neighbour = known ?? this.editorGroupsService.findGroup({ direction: AREA_DIRECTION[area.place] }, this.group);
		const group = neighbour && neighbour !== this.group && (known !== undefined || neighbour.count === 0)
			? neighbour
			: this.editorGroupsService.addGroup(this.group, AREA_DIRECTION[area.place]);
		this.areaGroups.set(area.id, group);
		// A STAND-UP IS A NEW DOCUMENT IN THE AREA, and only that: the first open, and every
		// workspace switch that puts a different document there (the Shading workspace's node
		// editor where the Model workspace's Timeline was). Blender does the same — switching
		// workspaces restores that workspace's screen, ratios and all — and the same document
		// staying put keeps whatever size the person dragged it to.
		if (this.areaDocuments.get(group.id) !== documentId) {
			this.areaDocuments.set(group.id, documentId);
			// SIZED AT THE END OF THE PASS, never here. A stand-up that REPLACES a document —
			// the Shading workspace's node editor where the Model workspace's Timeline was —
			// opens the new one before it closes the old, so at this moment the area's group
			// holds two editors and the split it would be sized against is not the one that
			// will exist a few lines later. Measured 2026-09-20: sizing here left the Shading
			// area at 651 of 952 against its declared 0.5.
			if (area.ratio > 0 && area.ratio < 1) { this.areaToSize.set(area.id, { group, area }); }
		}
		return group;
	}

	/**
	 * THE BOOTSTRAP SIZE, APPLIED THROUGH THE WORKBENCH'S OWN SETTLING AND THEN NEVER AGAIN.
	 *
	 * One `setSize` is not enough, and this is the measurement that says so — taken 2026-09-20,
	 * one action at a time, on a `--template models` probe under `vgai edit --frame`:
	 *
	 *   right after `addGroup` + `setSize`   main 872 / area  70   (what we asked for)
	 *   the ONE `onDidLayout` that followed  main  70 / area 882   (EXCHANGED, not scaled)
	 *   `setSize` again, after that layout   main 882 / area  70   (and it held, to +6s)
	 *
	 * An area is stood up while the workbench is still settling — `vgaiTitleBar` takes the top
	 * bar's height moments after the mount, and the editor part is laid out once more at a new
	 * height (1345x942 -> 1345x952 in that reading) — and the grid brings the two groups back
	 * with their extents swapped rather than scaled by the 10 px. I could not find the line in
	 * VS Code's grid that does it (`setSize` -> `resizeView` -> `relayout` -> `saveProportions`
	 * reads back correct at every step), so this is stated as the behaviour it is rather than
	 * explained; the same exchange was measured again on a workspace switch, which is why the
	 * window below exists rather than a single re-apply.
	 *
	 * So: apply now, so the first painted frames are right, and re-apply on every layout for
	 * the next second, which covers the settle. Then the listener disposes itself and the sash
	 * is the person's — nothing here touches it again.
	 */
	private sizeAreaGroup(group: IEditorGroup, area: VgaiDocumentArea): void {
		const horizontal = area.place === 'left' || area.place === 'right';
		const extentOf = (size: { width: number; height: number }) => (horizontal ? size.width : size.height);
		const set = (target: IEditorGroup, extent: number) => {
			const size = this.editorGroupsService.getSize(target);
			this.editorGroupsService.setSize(target, horizontal
				? { width: Math.max(1, extent), height: size.height }
				: { width: size.width, height: Math.max(1, extent) });
		};
		// CONVERGE, DO NOT ASSERT. `setSize` is `SplitView.resizeView`, which sets the view's
		// size and then hands the leftover to the OTHER views by priority — so a single call
		// lands the split only when the asked-for change happens to fit what it has to
		// redistribute. Growing the area works in one; shrinking it was measured on
		// 2026-09-20 to leave the two groups EXCHANGED (the main group collapsed to VS Code's
		// own 70 px `DEFAULT_EDITOR_MIN_DIMENSIONS.height` and the area took the rest).
		// So: ask, measure, and ask again from the other side — at most four passes, each one
		// synchronous, and it stops the moment the measured extent is the wanted one.
		const apply = () => {
			for (let pass = 0; pass < 4; pass++) {
				const own = extentOf(this.editorGroupsService.getSize(group));
				const main = extentOf(this.editorGroupsService.getSize(this.group));
				const combined = own + main;
				if (combined <= 0) { return; }
				const target = Math.max(1, Math.round(combined * area.ratio));
				if (Math.abs(own - target) <= 1) { return; }
				if (pass % 2 === 0) { set(group, target); } else { set(this.group, combined - target); }
			}
		};
		apply();
		// AND THROUGH THE WORKBENCH'S SETTLING. An area is stood up while the frame is still
		// taking its own shape — `vgaiTitleBar` takes the top bar's height moments after the
		// mount and the editor part is laid out again at a new height — so the pass is
		// repeated on every layout for one second and then the listener disposes itself.
		// After that the sash is the person's and nothing here touches it.
		const until = Date.now() + 1000;
		const settling = this.editorGroupsService.mainPart.onDidLayout(() => {
			if (Date.now() > until) { settling.dispose(); return; }
			apply();
		});
		this._register(settling);
	}

	/** One reconcile at a time; a publish during one queues exactly one more. */
	private schedule(): void {
		if (this.queued) { return; }
		this.queued = true;
		this.pass = this.pass.then(async () => {
			this.queued = false;
			try { await this.reconcile(); } catch { /* a closed group or a disposed input is not a failure to report */ }
		});
	}

	private async reconcile(): Promise<void> {
		// REBIND FIRST, so a closed group is a group that moved rather than the end of this
		// class's life (W12). Everything below reads `this.group`, which `liveGroup` has just
		// made current.
		this.liveGroup();
		const documents = this.bridge.list?.() ?? [];
		this.applying = true;
		try {
			// An area opens in its area group; other documents keep their native group. `preserveFocus` matters for the area: creating the split must not
			// take the caret out of whatever the person was typing in.
			const opened = new Set<string>();
			for (const document of documents) {
				const input = VgaiDocumentInput.forDocument(document.id, document.title);
				// Native tab moves own placement after the document is opened.
				const group = document.area ? this.groupForArea(document.area, document.id) : this.groupContaining(input) ?? this.group;
				if (!group.contains(input)) {
					opened.add(document.id);
					await this.editorService.openEditor(input, { inactive: true, preserveFocus: true, pinned: true }, group);
				}
			}
			// ACTIVATE ONLY ON A REAL CHANGE OF THE REGISTRY'S ACTIVE DOCUMENT. The registry
			// notifies on far more than activation — a dirty dot, a retitled model, a
			// utility appearing — and re-asserting our document on every one of those would
			// yank a person out of a Monaco editor open in this same group, on a beat they
			// did not cause. So: the first pass activates (that is the mount's own
			// behaviour), and after that only a moved `activeId` does.
			//
			// Area documents do not become the registry's active authoring subject.
			const centre = documents.filter(document => !document.area);
			const activeId = this.bridge.activeId?.() ?? null;
			const active = centre.find(document => document.id === activeId) ?? centre[0];
			if (active) {
				const activeInput = VgaiDocumentInput.forDocument(active.id, active.title);
				// …AND ON A DOCUMENT THIS PASS JUST OPENED, whatever the memo says (walk 4,
				// W12). `appliedActiveId` remembers what this class last activated, and a
				// person closing that editor makes the memo a lie: reopening the SAME
				// document then opened it `inactive` beside the workbench's welcome page and
				// never brought it forward — the registry said the document was open and
				// active while the screen showed Editing evolved. Opening a document is a
				// gesture that means SHOW IT, so it is not the re-assertion the memo exists
				// to prevent (that is a retitle, a dirty dot, a utility appearing — none of
				// which open anything).
				const activeGroup = this.groupContaining(activeInput) ?? this.group;
				if ((this.appliedActiveId !== active.id || opened.has(active.id)) && activeGroup.activeEditor !== activeInput) {
					await this.editorService.openEditor(activeInput, { pinned: true }, activeGroup);
				}
				this.appliedActiveId = active.id;
			}
			const wanted = new Set(documents.map(document => document.id));
			// A native restored input can precede its asynchronous content. Only an
			// actual removal from a previously registered open set means "close".
			// Missing source content stays a native tab, just like a missing text file.
			for (const id of wanted) { this.registeredDocuments.add(id); }
			for (const group of this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE)) {
				// NEVER EMPTY THE MAIN GROUP, for the reason the head of this file states:
				// closing its last editor detaches the pane container the bridge portals
				// into. An AREA group has no such contract — its document leaves with the
				// workspace switch that closed it, and the group goes with it.
				for (const editor of [...group.editors]) {
					if (!(editor instanceof VgaiDocumentInput)) { continue; }
					if (editor.documentId !== undefined && (wanted.has(editor.documentId) || !this.registeredDocuments.has(editor.documentId))) { continue; }
					if (group === this.group && editor.documentId === undefined && centre.length === 0) { continue; }
					await group.closeEditor(editor);
				}
			}
			// THE AREAS STOOD UP IN THIS PASS TAKE THEIR SIZE NOW — after every open and every
			// close, so the split being measured is the one that will exist.
			for (const [id, pending] of [...this.areaToSize]) {
				this.areaToSize.delete(id);
				this.sizeAreaGroup(pending.group, pending.area);
			}
		} finally {
			this.applying = false;
			this.reportActiveEditor();
		}
	}

	private groupContaining(input: VgaiDocumentInput): IEditorGroup | undefined {
		return this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).find(group => group.contains(input));
	}

	/** Native activation in any group selects its document; layout areas do not
	 * change the authoring subject (for example, clicking Blender’s Timeline). */
	private reportActiveEditor(): void {
		if (this.applying) { return; }
		const editor = this.editorGroupsService.activeGroup.activeEditor;
		if (!(editor instanceof VgaiDocumentInput) || editor.documentId === undefined) { return; }
		if (!this.bridge.list?.().some(document => document.id === editor.documentId && !document.area)) { return; }
		this.appliedActiveId = editor.documentId;
		this.bridge.activate?.(editor.documentId, documentView(this.editorGroupsService.activeGroup.id, editor)?.id);
	}
}
