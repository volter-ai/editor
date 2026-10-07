/*---------------------------------------------------------------------------------------------
 *  THE LIMITED VIEW'S WORKSPACE FOLDER — the project's files, in memory, as a file system.
 *
 *  THIS FILE IS ONLY IN THE WEB WORKBENCH (`scripts/workbench/overlay.mjs --target web` copies it
 *  to `contrib/volterView/browser/` and imports it from `workbench.web.main.ts`). The workbench a
 *  session serves never carries it, and nothing in the kit asks which one it is in: the kit's
 *  `volterFiles.ts` calls `IFileService` on the open folder exactly as it does over the REH.
 *
 *  A limited view (docs/LIMITED-VIEW.md) has no server behind the folder. The page that hosts the
 *  workbench owns the project's files — seeded from the view at build time, edited in memory,
 *  gone on reload — and the same store answers the `/__editor/*` routes the editor calls through
 *  the view's service worker. This provider is that store as the `volter-view:` scheme, so the
 *  workbench and the editor see one set of bytes and one stream of changes.
 *
 *  The page publishes the store on `globalThis.__volterLimitedView` before it calls the
 *  workbench's `create()` (`packages/editor-core/view/page/boot.ts`), and opens the folder
 *  `volter-view:/<project name>`. No store, no provider: this contribution does nothing.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import {
	createFileSystemProviderError,
	FileChangeType,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	IFileChange,
	IFileDeleteOptions,
	IFileOverwriteOptions,
	IFileService,
	IFileSystemProviderWithFileReadWriteCapability,
	IFileWriteOptions,
	IStat,
	IWatchOptions,
} from '../../../../platform/files/common/files.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/** The scheme the page opens its folder under. Spelled here and in `boot.ts`. */
export const VOLTER_VIEW_SCHEME = 'volter-view';

/** What the page publishes — the `StorageBackend` subset this provider reads, paths
 *  project-relative, `/`-separated, no leading slash. */
interface LimitedViewFiles {
	stat(path: string): Promise<{ type: 'file' | 'dir'; size: number; mtime: number } | null>;
	list(dir: string): Promise<{ name: string; type: 'file' | 'dir' }[]>;
	readBytes(path: string): Promise<Uint8Array>;
	write(path: string, data: Uint8Array): Promise<void>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	watch(callback: (event: { type: 'create' | 'update' | 'remove'; path: string }) => void): () => void;
}

interface LimitedViewHost {
	readonly files: LimitedViewFiles;
	/** The folder's name: the first path segment of every `volter-view:` URI. */
	readonly folder: string;
}

function limitedViewHost(): LimitedViewHost | undefined {
	return (mainWindow as unknown as { __volterLimitedView?: LimitedViewHost }).__volterLimitedView;
}

class LimitedViewFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private readonly changes = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile: Event<readonly IFileChange[]> = this.changes.event;

	constructor(private readonly host: LimitedViewHost) {
		super();
		const unwatch = host.files.watch(event => {
			const type = event.type === 'create' ? FileChangeType.ADDED : event.type === 'remove' ? FileChangeType.DELETED : FileChangeType.UPDATED;
			this.changes.fire([{ type, resource: this.uriOf(event.path) }]);
		});
		this._register({ dispose: unwatch });
	}

	private uriOf(path: string): URI {
		return URI.from({ scheme: VOLTER_VIEW_SCHEME, path: path ? `/${this.host.folder}/${path}` : `/${this.host.folder}` });
	}

	/** `volter-view:/<folder>/<path>` → `<path>`; anything outside the folder is not a file here. */
	private pathOf(resource: URI): string {
		const prefix = `/${this.host.folder}`;
		if (resource.path === prefix || resource.path === `${prefix}/`) { return ''; }
		if (!resource.path.startsWith(`${prefix}/`)) {
			throw createFileSystemProviderError(`${resource.toString()} is outside the limited view's project`, FileSystemProviderErrorCode.FileNotFound);
		}
		return resource.path.slice(prefix.length + 1).replace(/\/+$/, '');
	}

	watch(_resource: URI, _opts: IWatchOptions): IDisposable {
		// Every change the store makes is already reported through `onDidChangeFile`.
		return Disposable.None;
	}

	async stat(resource: URI): Promise<IStat> {
		const found = await this.host.files.stat(this.pathOf(resource));
		if (!found) { throw createFileSystemProviderError(`${resource.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		return { type: found.type === 'dir' ? FileType.Directory : FileType.File, size: found.size, mtime: found.mtime, ctime: found.mtime };
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const path = this.pathOf(resource);
		const found = await this.host.files.stat(path);
		if (!found) { throw createFileSystemProviderError(`${resource.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		if (found.type !== 'dir') { throw createFileSystemProviderError(`${resource.toString()} is not a folder`, FileSystemProviderErrorCode.FileNotADirectory); }
		return (await this.host.files.list(path)).map(entry => [entry.name, entry.type === 'dir' ? FileType.Directory : FileType.File]);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const path = this.pathOf(resource);
		const found = await this.host.files.stat(path);
		if (!found) { throw createFileSystemProviderError(`${resource.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		if (found.type === 'dir') { throw createFileSystemProviderError(`${resource.toString()} is a folder`, FileSystemProviderErrorCode.FileIsADirectory); }
		return this.host.files.readBytes(path);
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		const path = this.pathOf(resource);
		const found = await this.host.files.stat(path);
		if (found?.type === 'dir') { throw createFileSystemProviderError(`${resource.toString()} is a folder`, FileSystemProviderErrorCode.FileIsADirectory); }
		if (!found && !opts.create) { throw createFileSystemProviderError(`${resource.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		if (found && opts.create && !opts.overwrite) { throw createFileSystemProviderError(`${resource.toString()} already exists`, FileSystemProviderErrorCode.FileExists); }
		await this.host.files.write(path, content);
	}

	async mkdir(resource: URI): Promise<void> {
		const path = this.pathOf(resource);
		if (await this.host.files.stat(path)) { throw createFileSystemProviderError(`${resource.toString()} already exists`, FileSystemProviderErrorCode.FileExists); }
		await this.host.files.mkdir(path);
	}

	async delete(resource: URI, _opts: IFileDeleteOptions): Promise<void> {
		const path = this.pathOf(resource);
		if (!await this.host.files.stat(path)) { throw createFileSystemProviderError(`${resource.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		await this.host.files.remove(path);
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const source = this.pathOf(from);
		const target = this.pathOf(to);
		if (!await this.host.files.stat(source)) { throw createFileSystemProviderError(`${from.toString()} does not exist`, FileSystemProviderErrorCode.FileNotFound); }
		if (await this.host.files.stat(target)) {
			if (!opts.overwrite) { throw createFileSystemProviderError(`${to.toString()} already exists`, FileSystemProviderErrorCode.FileExists); }
			await this.host.files.remove(target);
		}
		await this.copyTree(source, target);
		await this.host.files.remove(source);
	}

	private async copyTree(source: string, target: string): Promise<void> {
		const found = await this.host.files.stat(source);
		if (!found) { return; }
		if (found.type === 'file') {
			await this.host.files.write(target, await this.host.files.readBytes(source));
			return;
		}
		await this.host.files.mkdir(target);
		for (const entry of await this.host.files.list(source)) {
			await this.copyTree(`${source}/${entry.name}`, `${target}/${entry.name}`);
		}
	}
}

class LimitedViewFolder extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.volterLimitedViewFolder';

	constructor(@IFileService fileService: IFileService) {
		super();
		const host = limitedViewHost();
		if (!host) { return; }
		this._register(fileService.registerProvider(VOLTER_VIEW_SCHEME, this._register(new LimitedViewFileSystemProvider(host))));
	}
}

// BlockStartup: the folder has to be readable before the kit's own contributions ask whether it
// is a project (`VolterProjectAutoOpen`, AfterRestored) or connect the tab (BlockRestore).
registerWorkbenchContribution2(LimitedViewFolder.ID, LimitedViewFolder, WorkbenchPhase.BlockStartup);
