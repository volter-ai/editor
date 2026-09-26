import { createSignal, type GodotSignal } from './signal';

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && 'then' in value && typeof value.then === 'function';
}

export interface GodotEditorFileEntry {
  name: string;
  path: string;
  type: string;
  scriptClassName?: string;
  scriptClassExtends?: string;
  importValid?: boolean;
}

export class GodotEditorFileSystemDirectory {
  private readonly subdirectories: GodotEditorFileSystemDirectory[] = [];
  private readonly files: GodotEditorFileEntry[] = [];

  constructor(
    private readonly name: string,
    private readonly path: string,
    private parent: GodotEditorFileSystemDirectory | null = null,
  ) {}

  get_subdir_count(): number { return this.subdirectories.length; }
  get_subdir(index: number): GodotEditorFileSystemDirectory | null { return this.subdirectories[index] ?? null; }
  get_file_count(): number { return this.files.length; }
  get_file(index: number): string { return this.files[index]?.name ?? ''; }
  get_file_path(index: number): string { return this.files[index]?.path ?? ''; }
  get_file_type(index: number): string { return this.files[index]?.type ?? ''; }
  get_file_script_class_name(index: number): string { return this.files[index]?.scriptClassName ?? ''; }
  get_file_script_class_extends(index: number): string { return this.files[index]?.scriptClassExtends ?? ''; }
  get_file_import_is_valid(index: number): boolean { return this.files[index]?.importValid ?? false; }
  get_name(): string { return this.name; }
  get_path(): string { return this.path; }
  get_parent(): GodotEditorFileSystemDirectory | null { return this.parent; }
  find_file_index(name: string): number { return this.files.findIndex((file) => file.name === name); }
  find_dir_index(name: string): number { return this.subdirectories.findIndex((directory) => directory.name === name); }

  add_subdirectory(directory: GodotEditorFileSystemDirectory): void {
    if (this.subdirectories.includes(directory)) return;
    directory.parent = this;
    this.subdirectories.push(directory);
    this.subdirectories.sort((left, right) => left.name.localeCompare(right.name));
  }

  add_file(file: GodotEditorFileEntry): void {
    const index = this.find_file_index(file.name);
    if (index >= 0) this.files[index] = { ...file };
    else this.files.push({ ...file });
    this.files.sort((left, right) => left.name.localeCompare(right.name));
  }

  remove_file(name: string): boolean {
    const index = this.find_file_index(name);
    if (index < 0) return false;
    this.files.splice(index, 1);
    return true;
  }

  find_directory(path: string): GodotEditorFileSystemDirectory | null {
    if (path === this.path) return this;
    for (const directory of this.subdirectories) {
      const found = directory.find_directory(path);
      if (found !== null) return found;
    }
    return null;
  }

  find_file(path: string): GodotEditorFileEntry | null {
    const local = this.files.find((file) => file.path === path);
    if (local !== undefined) return local;
    for (const directory of this.subdirectories) {
      const found = directory.find_file(path);
      if (found !== null) return found;
    }
    return null;
  }
}

export interface GodotEditorFileSystemCarrier {
  scan?(): GodotEditorFileSystemDirectory | PromiseLike<GodotEditorFileSystemDirectory>;
  scanSources?(): void | PromiseLike<void>;
  reimport?(files: readonly string[]): void | PromiseLike<void>;
  updateFile?(path: string): GodotEditorFileEntry | null | PromiseLike<GodotEditorFileEntry | null>;
}

export class GodotEditorFileSystem {
  private readonly filesystemChangedSignal = createSignal<readonly []>();
  private readonly scriptClassesUpdatedSignal = createSignal<readonly []>();
  private readonly sourcesChangedSignal = createSignal<readonly [boolean]>();
  private readonly resourcesReimportingSignal = createSignal<readonly [readonly string[]]>();
  private readonly resourcesReimportedSignal = createSignal<readonly [readonly string[]]>();
  private readonly resourcesReloadSignal = createSignal<readonly [readonly string[]]>();
  private root = new GodotEditorFileSystemDirectory('res://', 'res://');
  private scanning = false;
  private importing = false;
  private scanningProgress = 0;

  readonly filesystem_changed: GodotSignal<readonly []> = this.filesystemChangedSignal.signal;
  readonly script_classes_updated: GodotSignal<readonly []> = this.scriptClassesUpdatedSignal.signal;
  readonly sources_changed: GodotSignal<readonly [boolean]> = this.sourcesChangedSignal.signal;
  readonly resources_reimporting: GodotSignal<readonly [readonly string[]]> = this.resourcesReimportingSignal.signal;
  readonly resources_reimported: GodotSignal<readonly [readonly string[]]> = this.resourcesReimportedSignal.signal;
  readonly resources_reload: GodotSignal<readonly [readonly string[]]> = this.resourcesReloadSignal.signal;

  constructor(private readonly carrier: GodotEditorFileSystemCarrier = {}) {}

  get_filesystem(): GodotEditorFileSystemDirectory { return this.root; }
  is_scanning(): boolean { return this.scanning; }
  is_importing(): boolean { return this.importing; }
  get_scanning_progress(): number { return this.scanningProgress; }

  scan(): void {
    if (this.scanning) return;
    this.scanning = true;
    this.scanningProgress = 0;
    const scan = this.carrier.scan;
    if (scan === undefined) {
      this.completeScan(this.root);
      return;
    }
    const result = scan();
    if (isPromiseLike(result)) {
      void result.then((root) => this.completeScan(root), () => this.completeScan(this.root));
    } else this.completeScan(result);
  }

  scan_sources(): void {
    this.sourcesChangedSignal.emit(true);
    const result = this.carrier.scanSources?.();
    if (isPromiseLike(result)) void result.then(() => this.sourcesChangedSignal.emit(false));
    else this.sourcesChangedSignal.emit(false);
  }

  update_file(path: string): void {
    const updateFile = this.carrier.updateFile;
    if (updateFile === undefined) {
      this.applyUpdatedFile(path, null);
      return;
    }
    const result = updateFile(path);
    if (isPromiseLike(result)) void result.then((file) => this.applyUpdatedFile(path, file));
    else this.applyUpdatedFile(path, result);
  }

  get_filesystem_path(path: string): GodotEditorFileSystemDirectory | null { return this.root.find_directory(path); }
  get_file_type(path: string): string { return this.root.find_file(path)?.type ?? ''; }

  reimport_files(files: readonly string[]): void {
    const paths = [...files];
    this.importing = true;
    this.resourcesReimportingSignal.emit(paths);
    const result = this.carrier.reimport?.(paths);
    if (isPromiseLike(result)) void result.then(() => this.completeReimport(paths), () => this.completeReimport(paths));
    else this.completeReimport(paths);
  }

  set_scanning_progress(progress: number): void {
    this.scanningProgress = Math.min(1, Math.max(0, progress));
  }

  notify_script_classes_updated(): void { this.scriptClassesUpdatedSignal.emit(); }
  reload_resources(paths: readonly string[]): void { this.resourcesReloadSignal.emit([...paths]); }

  private completeScan(root: GodotEditorFileSystemDirectory): void {
    this.root = root;
    this.scanning = false;
    this.scanningProgress = 1;
    this.filesystemChangedSignal.emit();
  }

  private applyUpdatedFile(path: string, file: GodotEditorFileEntry | null): void {
    const slash = path.lastIndexOf('/');
    const directory = this.root.find_directory(slash >= 0 ? path.slice(0, slash) : 'res://');
    if (directory !== null) {
      if (file === null) directory.remove_file(path.slice(slash + 1));
      else directory.add_file(file);
    }
    this.filesystemChangedSignal.emit();
  }

  private completeReimport(paths: readonly string[]): void {
    this.importing = false;
    this.resourcesReimportedSignal.emit(paths);
    this.filesystemChangedSignal.emit();
  }
}

export function createGodotEditorFileSystem(carrier: GodotEditorFileSystemCarrier = {}): GodotEditorFileSystem {
  return new GodotEditorFileSystem(carrier);
}
