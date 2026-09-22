/*---------------------------------------------------------------------------------------------
 *  UNDO OWNERSHIP — under this frame there is ONE undo stack, and it is VS Code's.
 *
 *  ARCHITECTURE-CORE §The core is Code-OSS: *"history-service.ts → IUndoRedoService … an entry
 *  becomes an undo element keyed by the document's resource, a cross-document transaction a
 *  workspace element, there is one Cmd+Z, and a gizmo drag that rewrites a source file and a
 *  keystroke in that file's text editor share ONE ordered stack; adapter-side coalescing of a
 *  drag into one entry stays the adapter's, and snapshot size stays a design concern, because
 *  the service caps nothing by bytes"*.
 *
 *  What this file does, and nothing else:
 *
 *  1. PUSHES every edit the vgai editor records as an undo element on the workbench's
 *     `IUndoRedoService`, keyed on the FILE it changed — `IResourceUndoRedoElement` for one
 *     file, `IWorkspaceUndoRedoElement` for a transaction spanning several. The editor hands
 *     over project-relative paths (`@vgai/editor-sdk/host`'s `history` door) and this file
 *     resolves them against the open workspace folder, so a gizmo drag on `cube.ts`'s model
 *     lands on exactly the URI Monaco holds for `cube.ts` — which is the whole one-stack
 *     property. Monaco's own text edits push there through `editStack.ts`; nothing about that
 *     is changed or wrapped.
 *
 *  2. ANSWERS ⌘Z when a vgai stage has focus, through `UndoCommand.addImplementation` — the
 *     additive door upstream's own custom editors, notebooks and the Explorer already use
 *     (`customEditors.ts` registers at priority 105 and calls `undoRedoService.undo(resource)`;
 *     this is the same shape at the same priority, gated on `vgai.stage.focused`). NO CORE
 *     EDIT: `undo`/`redo` are `MultiCommand`s precisely so a pane can bring its own
 *     implementation.
 *
 *     WHY IT NEVER FALLS THROUGH. `MultiCommand.runCommand` walks implementations until one
 *     returns truthy, so returning false with a stage focused would hand ⌘Z to Monaco's
 *     implementation and undo a keystroke in a text editor the person is not looking at —
 *     exactly the wrong-stack defect this unit exists to close. So a focused stage ALWAYS
 *     handles ⌘Z, and when it has nothing to undo it says so in the vgai console, by name.
 *
 *  3. SCOPES that ⌘Z to THE FOCUSED DOCUMENT, which is the fix for "Component-view Ctrl+Z acts
 *     on the MAIN scene's history" (WORK.md §The core is Code-OSS, U4's absorb list). The
 *     scoping key is the DOCUMENT and not a single file, because MEASURED (2026-09-19, the game
 *     template in the frame) a three root's document is not one file: its adapter's own source
 *     path is `src/world.tsx` while a gizmo drag on the scene's HeroBox instance writes
 *     `src/scenes/MainScene.tsx`. Every element carries the document it was made in, this file
 *     keeps the per-document ledger of files touched, and a stage's ⌘Z asks the undo service
 *     about the most recently edited of THAT document's files that still has a step. A
 *     component view's elements carry that view's id, so its ⌘Z can never reach the main
 *     scene's. The Model document is the case where the answer is a refusal rather than a step
 *     — see THE MODEL DOCUMENT below.
 *
 *  THE MODEL DOCUMENT, decided here and MEASURED rather than assumed. A `.blend` document's
 *  edits are bpy calls that reach the engine, and the obvious mapping would be to push one
 *  resource element per call whose `undo()` is `bpy.ops.ed.undo` through the session. It does
 *  not exist: this Blender runs `--background`, which has NO UNDO STACK — stated twice in
 *  `packages/blender/browser/session.py` (the `dirty` instrument at ~l.551 and `save_document`
 *  at ~l.820: "`--background` has no undo stack, so nothing ever pushes one", with
 *  `bpy.data.is_dirty` measured False before a save, after one, and across a script that
 *  models an entire scene). Nor do those edits enter the editor's history at all —
 *  `packages/blender` imports nothing of `history/`. So a Model document's ⌘Z REFUSES BY NAME
 *  on that resource, in the vgai console, naming the mechanism (the engine's own undo, absent
 *  in this build). It is a standing warning naming its mechanism, never a silent degrade and
 *  never someone else's stack quietly taking the keystroke. The day the engine runs with an
 *  undo stack, this is the one place that changes.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';

/**
 * WHAT THE FRAME GETS OF THE EDITOR'S HISTORY — the counterpart of the bridge's
 * `VgaiHistoryHandle`, declared here for the same reason `VgaiKeyboardBridge` is: nothing
 * under `src/vs/` imports an editor module.
 */
export interface VgaiHistoryBridge {
	/** Everything recorded before this subscription, oldest first — the bridge mounts after
	 *  edits are already possible, so the stack must not start missing its beginning. */
	elements(): readonly VgaiHistoryElement[];
	/** Every entry as it is recorded from here on. Returns the removal. */
	onElement(listener: (element: VgaiHistoryElement) => void): () => void;
	/** The focused document's own project-relative file, or null when the active document is
	 *  not a file on disk. The FIRST resource a stage's ⌘Z tries, and what a refusal names. */
	focusedResource(): string | null;
	/** WHICH DOCUMENT has the stage, so a ⌘Z there can only reach edits made IN it. */
	focusedDocument(): { id: string; label: string } | null;
	/** Hand the editor the frame's OWN undo: its Edit menu ("Undo Set position"), its
	 *  palette and `vgai eval`'s undo verb all call the editor's `edit.undo`, and under
	 *  the frame every one of them has to reach THIS stack. */
	setDelegate(delegate: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean }): void;
	/** Say something in the vgai editor's OWN console, where `vgai console` reads it. */
	report(level: 'warn' | 'error', message: string): void;
}

export interface VgaiHistoryElement {
	readonly id: string;
	readonly label: string;
	/** PROJECT-RELATIVE paths, in the transaction's own order. Empty for a session-scoped
	 *  edit (a live journal, a play run), which has no file at all. */
	readonly resources: readonly string[];
	/** The workspace document this edit was made in, or null. */
	readonly document: string | null;
	undo(): Promise<boolean>;
	redo(): Promise<boolean>;
}

/** The one reason a stage's ⌘Z can have no subject at all, spelled once. */
const enum Refusal {
	NoDocument = 'no document is open on the stage',
}

export class VgaiHistory extends Disposable {

	/** Every element we have pushed, by id — so a re-push of the same id (a bridge remount
	 *  replaying its catch-up buffer) is a no-op rather than a duplicate step. */
	private readonly pushed = new Set<string>();

	/**
	 * WHICH FILES EACH DOCUMENT HAS EDITED, oldest first — the ledger a stage's ⌘Z resolves
	 * against, and the reason this class keeps any state at all.
	 *
	 * MEASURED (2026-09-19, the game template in the frame): a three root's document is NOT
	 * one file. `focusedResource()` for the main scene answers `src/world.tsx` (the adapter's
	 * own save destination) while a gizmo drag on the scene's HeroBox instance writes
	 * `src/scenes/MainScene.tsx` — so asking the undo service about the focused resource alone
	 * finds nothing to undo. The document id is the stable thing; which FILE its next undo
	 * acts on is the newest element recorded in it, which is what this ledger answers.
	 *
	 * It is also what keeps the stacks apart: an element carries the document it was made in,
	 * so a component view's ⌘Z can only ever reach that view's own files.
	 */
	private readonly byDocument = new Map<string, URI[]>();

	constructor(
		private readonly bridge: VgaiHistoryBridge,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super();

		for (const element of bridge.elements()) { this.push(element); }
		this._register(toDisposable(bridge.onElement(element => this.push(element))));

		// The same priority and the same door upstream's custom editors use. The `when` is
		// U6's context key, so the implementation is consulted only while focus is on one of
		// our stages — with focus in Monaco this is not even asked, and the text editor's own
		// undo runs exactly as it always did.
		const stageFocused = ContextKeyExpr.has('vgai.stage.focused');
		const PRIORITY = 105;
		this._register(UndoCommand.addImplementation(PRIORITY, 'vgai-stage', () => this.run('undo'), stageFocused));
		this._register(RedoCommand.addImplementation(PRIORITY, 'vgai-stage', () => this.run('redo'), stageFocused));

		// The editor's OWN undo affordances (its Edit menu, its palette, `vgai eval`) now run
		// this same resolution rather than the editor's cursor, so there is one answer to
		// "undo" however it is asked for. `canUndo`/`canRedo` are what enable those items.
		bridge.setDelegate({
			undo: () => { this.run('undo'); },
			redo: () => { this.run('redo'); },
			canUndo: () => this.available('undo'),
			canRedo: () => this.available('redo'),
		});
	}

	/**
	 * The workspace folder a project-relative path resolves against. `null` on a window with
	 * no folder open, where a path names nothing we could key an element on.
	 */
	private get root(): URI | null {
		return this.workspaceService.getWorkspace().folders[0]?.uri ?? null;
	}

	private resolve(path: string): URI | null {
		const root = this.root;
		return root ? joinPath(root, path) : null;
	}

	private push(element: VgaiHistoryElement): void {
		if (this.pushed.has(element.id)) { return; }
		const resources = element.resources.map(path => this.resolve(path)).filter((uri): uri is URI => !!uri);
		if (resources.length === 0) {
			// A SESSION-SCOPED EDIT HAS NO FILE, and placing it on whichever document happens
			// to be open would put a live-journal step on a stack it does not belong to — the
			// same class of defect as the component-view one this unit closes. It is reported
			// where the person can see it, and it stays the editor's own to undo.
			this.bridge.report('warn', localize('vgaiHistoryNoResource', "“{0}” changed no file on disk, so it is not on the workbench's undo stack. Undo it from the surface that made it.", element.label));
			return;
		}
		this.pushed.add(element.id);
		if (element.document) {
			const seen = this.byDocument.get(element.document) ?? [];
			// Newest LAST; a file edited twice moves to the end rather than appearing twice.
			this.byDocument.set(element.document, [...seen.filter(u => !resources.some(r => r.toString() === u.toString())), ...resources]);
		}
		const code = 'vgai.edit';
		this.undoRedoService.pushElement(resources.length === 1
			? { type: UndoRedoElementType.Resource, resource: resources[0]!, label: element.label, code, undo: () => this.apply(element, 'undo'), redo: () => this.apply(element, 'redo') }
			: { type: UndoRedoElementType.Workspace, resources, label: element.label, code, undo: () => this.apply(element, 'undo'), redo: () => this.apply(element, 'redo') });
	}

	/**
	 * Run one element's inverse. The editor answers `false` when it refused (a conflict, an
	 * expired resource, blocked history); THROWING is what tells `IUndoRedoService` the step
	 * did not happen, so it does not move its cursor past an edit that is still applied.
	 */
	private async apply(element: VgaiHistoryElement, direction: 'undo' | 'redo'): Promise<void> {
		const done = direction === 'undo' ? await element.undo() : await element.redo();
		if (!done) {
			throw new Error(localize('vgaiHistoryRefused', "The Volter Editor could not {0} “{1}”; its own console says why.", direction, element.label));
		}
	}

	/**
	 * ⌘Z (or ⇧⌘Z) with a vgai stage focused. ALWAYS returns true — see the header: falling
	 * through would hand the keystroke to a stack the person is not looking at.
	 */
	private run(direction: 'undo' | 'redo'): boolean {
		const doc = this.bridge.focusedDocument();
		if (!doc) {
			this.bridge.report('warn', localize('vgaiHistoryNoSubject', "Cannot {0}: {1}.", direction, Refusal.NoDocument));
			return true;
		}
		const resource = this.resourceFor(doc.id, direction);
		if (resource) {
			void (direction === 'undo' ? this.undoRedoService.undo(resource) : this.undoRedoService.redo(resource));
			return true;
		}
		// THE MODEL DOCUMENT LANDS HERE, and this message carries its decision (header): a
		// `.blend`'s edits are bpy calls the engine keeps, and this Blender build runs
		// `--background`, which has no undo stack at all. Every other document lands here too
		// when its own stack is simply empty, and the message reads correctly for both
		// because it names the document rather than guessing why.
		const where = this.bridge.focusedResource() ?? doc.label;
		this.bridge.report('warn', localize('vgaiHistoryEmpty', "Nothing to {0} in “{1}” ({2}). An edit an engine keeps its own history for — a .blend document's bpy calls — is not on this stack, and this Blender build has no undo stack of its own either.", direction, doc.label, where));
		return true;
	}

	/** Whether the focused document has a step in this direction — what enables the
	 *  editor's own Undo/Redo menu items. */
	private available(direction: 'undo' | 'redo'): boolean {
		const doc = this.bridge.focusedDocument();
		return !!doc && !!this.resourceFor(doc.id, direction);
	}

	/**
	 * The file this document's next undo (or redo) acts on: the most recently edited one that
	 * still has a step in that direction. Newest first for undo, oldest first for redo, so the
	 * order a person made the edits in is the order they come back.
	 */
	private resourceFor(document: string, direction: 'undo' | 'redo'): URI | undefined {
		const edited = this.byDocument.get(document) ?? [];
		const order = direction === 'undo' ? [...edited].reverse() : edited;
		return order.find(uri => direction === 'undo' ? this.undoRedoService.canUndo(uri) : this.undoRedoService.canRedo(uri));
	}
}
