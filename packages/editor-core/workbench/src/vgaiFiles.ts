/*---------------------------------------------------------------------------------------------
 *  THE PROJECT'S FILES — under this frame the file system is the WORKBENCH'S, and that is a
 *  CALL, not a provider.
 *
 *  ARCHITECTURE-CORE §The core is Code-OSS: *"the storage backends → file system providers, the
 *  dev server as one provider"*, under the rule that governs every unit of the program —
 *  everything VS Code already does is USED, not rebuilt.
 *
 *  WHY NOT A PROVIDER, measured for U5. Both product shapes already have a real file service
 *  over the project folder: DESKTOP opens it as the workspace folder on Electron's own disk
 *  provider, and WEB + SERVER (the REH) serves the same folder over `vscode-remote://`. A
 *  `vgai-session:` provider mounting the session's `/__editor/*` routes would be a SECOND path
 *  to bytes the workbench can already reach — more code, a second cache, and two notions of
 *  when a file changed. So the vgai editor CALLS `IFileService`/`ITextFileService` through the
 *  SDK's `files` door, and the session's file routes stay exactly what the STANDALONE shape
 *  speaks. Nothing here registers a provider and nothing here is a core edit.
 *
 *  WHAT IT BUYS, and it is U4's one open (docs/CODE-OSS.md §Undo, the trap):
 *
 *    A vgai element's REDO was lost while a text model for that file was open. The editor's
 *    undo wrote the file through its own transport (`/__ui-source/apply`), which is an
 *    EXTERNAL change to the workbench: `TextFileEditorModel` sees the file-change event, the
 *    model is not dirty so it reloads, `ModelService.updateModel` diffs the new bytes and calls
 *    `model.pushEditOperations(...)`, that lands a TEXT element on the resource's stack through
 *    `EditStack` — and `IUndoRedoService.pushElement` clears the resource's FUTURE. ⇧⌘Z then
 *    had nothing to redo. Measured 2026-09-19: the same undo/redo pair with no text model open
 *    worked.
 *
 *    A write made HERE is the workbench's own. When a resolved text file model holds the file,
 *    the write is applied to that MODEL and the model is saved: no external-change reload, no
 *    `updateModel`, no text element, and the redo future survives.
 *
 *  WHY `applyEdits` AND NOT `pushEditOperations`. `pushEditOperations` is precisely the call
 *  that pushes a text undo element — the thing that destroyed the future. `applyEdits` is the
 *  raw apply the command manager itself uses, and it pushes nothing. That is correct here and
 *  not a shortcut: this edit ALREADY HAS an undo element on this resource's stack, the vgai one
 *  `vgaiHistory.ts` pushed for it, and a second element for one gesture is exactly the
 *  two-stacks defect U4 exists to close.
 *
 *  AND THE STACK STAYS COHERENT, which is the question a raw apply owes an answer to. The
 *  elements below ours on that resource are text elements whose inverse edits were recorded
 *  against the text as it stood when they were pushed. `IUndoRedoService` pops a resource's
 *  stack strictly top-down, and our element's undo restores the file to its own BEFORE
 *  snapshot — which IS the text the element below it was pushed against. So by the time an
 *  older text element is reached, the buffer is the one it expects. Ordering is what makes the
 *  raw apply safe; nothing here reorders anything.
 *
 *  A DIRTY MODEL IS REFUSED BY NAME, never clobbered. The vgai editor computes its new source
 *  from the file ON DISK (the session's `/__ui-source/prepare` reads it with `node:fs`), so
 *  writing that over a model holding unsaved keystrokes would silently destroy them. The read
 *  side answers from the MODEL for the same reason — a resolved model is the file's truth in
 *  this workbench — which is also what makes the editor's own `ifMatchSha` guard see the
 *  divergence and refuse first, in the editor's own words.
 *
 *  WHAT THIS DELIBERATELY DOES NOT CARRY: `list` and `watch`. The door declares both optional
 *  and falls back to the session's own transports for them, and that is the right answer rather
 *  than an omission — the session's chokidar watcher is what drives save-validation and HMR,
 *  it watches the same files on the same disk, and it fires for a workbench write exactly as it
 *  fires for a session write. A second watcher here would report the same event twice and
 *  validate nothing new. A member nobody reads is cut.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { SaveReason } from '../../../common/editor.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';

/**
 * WHAT THE FRAME HANDS THE EDITOR — the counterpart of the bridge's `VgaiFilesHandle`,
 * declared here for the same reason `VgaiHistoryBridge` is: nothing under `src/vs/` imports an
 * editor module.
 *
 * Every path is PROJECT-RELATIVE, `/`-separated, no leading slash — the same spelling the
 * history door hands over, resolved against the same workspace folder. That is what puts a
 * vgai write on exactly the URI Monaco holds for that file.
 */
export interface VgaiFilesBridge {
	/** Install the frame's file provider on `EditorHost.files`. Called once, after the mount,
	 *  because the services it needs exist only inside the command's own invocation. */
	setProvider(provider: VgaiFileProvider): void;
	/** Say something in the vgai editor's OWN console, where `vgai console` reads it. */
	report(level: 'warn' | 'error', message: string): void;
}

export interface VgaiFileProvider {
	read(path: string): Promise<string>;
	readBytes(path: string): Promise<Uint8Array>;
	write(path: string, data: string | Uint8Array): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export class VgaiFiles extends Disposable {

	constructor(
		private readonly bridge: VgaiFilesBridge,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super();
		bridge.setProvider({
			read: path => this.read(path),
			readBytes: path => this.readBytes(path),
			write: (path, data) => this.write(path, data),
			exists: path => this.exists(path),
		});
	}

	/**
	 * The workspace folder a project-relative path resolves against.
	 *
	 * THE BRIDGE IS THE TRUST BOUNDARY, which is why the containment check is
	 * repeated here rather than left to the editor's own door. `EditorHost.files`
	 * validates every path today (`files/project-files.ts`'s `assertContained`),
	 * but ANY package's contribution in the open project reaches that door, and
	 * `joinPath` NORMALIZES — `joinPath(root, '../x')` is a real URI outside the
	 * workspace, and `joinPath(root, '/etc/passwd')` is not the absolute path it
	 * looks like but is still not what the caller wrote. A check on one side of a
	 * trust boundary is a check the other side is free to stop making.
	 */
	private resolve(path: string): URI {
		const root = this.workspaceService.getWorkspace().folders[0]?.uri;
		if (!root) {
			throw new Error(localize('vgaiFilesNoFolder', "No folder is open in this window, so “{0}” names nothing on disk.", path));
		}
		const segments = path.replace(/\\/g, '/').split('/');
		if (path === '' || path.startsWith('/') || segments.includes('..')) {
			const message = localize('vgaiFilesEscape', "“{0}” is not a project-relative path, so the Volter Editor did not reach it. Paths through this door are relative to the open folder, `/`-separated, with no leading slash and no “..” segment.", path);
			this.bridge.report('error', message);
			throw new Error(message);
		}
		return joinPath(root, path);
	}

	/** A resolved text file model for this URI, or undefined. A resolved model is the file's
	 *  TRUTH in this workbench — reading anything else would hand the editor a version of the
	 *  file the person is not looking at. */
	private resolvedModel(uri: URI) {
		const model = this.textFileService.files.get(uri);
		return model?.isResolved() ? model : undefined;
	}

	private async read(path: string): Promise<string> {
		const uri = this.resolve(path);
		const model = this.resolvedModel(uri);
		if (model) { return model.textEditorModel.getValue(); }
		return (await this.textFileService.read(uri)).value;
	}

	private async readBytes(path: string): Promise<Uint8Array> {
		const content = await this.fileService.readFile(this.resolve(path));
		return content.value.buffer;
	}

	private async write(path: string, data: string | Uint8Array): Promise<void> {
		const uri = this.resolve(path);
		if (typeof data !== 'string') {
			// Bytes never have a text model to update, so this is the plain file-service write —
			// still the workbench's own, which is all the asset lane needs.
			await this.fileService.writeFile(uri, VSBuffer.wrap(data));
			return;
		}
		const model = this.resolvedModel(uri);
		if (!model) {
			await this.fileService.writeFile(uri, VSBuffer.fromString(data));
			return;
		}
		// Captured BEFORE the dirty check: upstream declares `isDirty(): this is
		// IResolvedTextFileEditorModel`, so its false branch narrows an already-resolved model
		// to `never` and every later member access fails to compile.
		const textModel = model.textEditorModel;
		if (model.isDirty()) {
			// NEVER CLOBBER UNSAVED TEXT. The editor computed this content from the file on
			// disk, so writing it over a model holding unsaved keystrokes would destroy them
			// with no event anywhere. The editor's own sha guard normally refuses before this
			// (its read answers from the model above, so the divergence is visible to it);
			// this is the floor under that, for a write that carries no guard of its own.
			const message = localize('vgaiFilesDirty', "“{0}” has unsaved changes in its editor, so the Volter Editor did not write over it. Save or revert that editor and try again.", path);
			this.bridge.report('warn', message);
			throw new Error(message);
		}
		// The raw apply — see the header: this edit's undo element is the vgai one already on
		// this resource's stack, and `pushEditOperations` here would push a second element and
		// destroy the redo future, which is the exact defect U5 closes.
		textModel.applyEdits([{ range: textModel.getFullModelRange(), text: data }]);
		await this.textFileService.save(uri, { reason: SaveReason.EXPLICIT });
	}

	private exists(path: string): Promise<boolean> {
		return this.fileService.exists(this.resolve(path));
	}
}
