export const GODOT_RESOURCE_CACHE_MODE_IGNORE = 0;
export const GODOT_RESOURCE_CACHE_MODE_REUSE = 1;
export const GODOT_RESOURCE_CACHE_MODE_REPLACE = 2;
export const GODOT_RESOURCE_CACHE_MODE_IGNORE_DEEP = 3;
export const GODOT_RESOURCE_CACHE_MODE_REPLACE_DEEP = 4;

export type GodotResourceFormatResult = unknown;

export interface GodotResourceFormatCarrier {
  invoke(method: string, args: readonly unknown[]): GodotResourceFormatResult;
}

export class GodotResourceFormatLoader {
  constructor(private readonly carrier: GodotResourceFormatCarrier) {}

  private call(method: string, args: readonly unknown[] = []): GodotResourceFormatResult {
    return this.carrier.invoke(method, args);
  }

  _get_recognized_extensions(): GodotResourceFormatResult {
    return this.call('_get_recognized_extensions');
  }

  _recognize_path(path: string, type: string): GodotResourceFormatResult {
    return this.call('_recognize_path', [path, type]);
  }

  _handles_type(type: string): GodotResourceFormatResult {
    return this.call('_handles_type', [type]);
  }

  _get_resource_type(path: string): GodotResourceFormatResult {
    return this.call('_get_resource_type', [path]);
  }

  _get_resource_script_class(path: string): GodotResourceFormatResult {
    return this.call('_get_resource_script_class', [path]);
  }

  _get_resource_uid(path: string): GodotResourceFormatResult {
    return this.call('_get_resource_uid', [path]);
  }

  _get_dependencies(path: string, addTypes: boolean): GodotResourceFormatResult {
    return this.call('_get_dependencies', [path, addTypes]);
  }

  _rename_dependencies(path: string, renames: Readonly<Record<string, string>>): GodotResourceFormatResult {
    return this.call('_rename_dependencies', [path, renames]);
  }

  _exists(path: string): GodotResourceFormatResult {
    return this.call('_exists', [path]);
  }

  _get_classes_used(path: string): GodotResourceFormatResult {
    return this.call('_get_classes_used', [path]);
  }

  _load(
    path: string,
    originalPath: string,
    useSubThreads: boolean,
    cacheMode: number,
  ): GodotResourceFormatResult {
    return this.call('_load', [path, originalPath, useSubThreads, cacheMode]);
  }
}

export class GodotResourceFormatSaver {
  constructor(private readonly carrier: GodotResourceFormatCarrier) {}

  private call(method: string, args: readonly unknown[] = []): GodotResourceFormatResult {
    return this.carrier.invoke(method, args);
  }

  _save(resource: unknown, path: string, flags: number): GodotResourceFormatResult {
    return this.call('_save', [resource, path, flags]);
  }

  _set_uid(path: string, uid: bigint | number): GodotResourceFormatResult {
    return this.call('_set_uid', [path, uid]);
  }

  _recognize(resource: unknown): GodotResourceFormatResult {
    return this.call('_recognize', [resource]);
  }

  _get_recognized_extensions(resource: unknown): GodotResourceFormatResult {
    return this.call('_get_recognized_extensions', [resource]);
  }

  _recognize_path(resource: unknown, path: string): GodotResourceFormatResult {
    return this.call('_recognize_path', [resource, path]);
  }
}

export class GodotResourceFormatRegistry {
  private readonly loaders: GodotResourceFormatLoader[] = [];
  private readonly savers: GodotResourceFormatSaver[] = [];

  add_resource_format_loader(loader: GodotResourceFormatLoader, atFront = false): void {
    this.remove_resource_format_loader(loader);
    if (atFront) this.loaders.unshift(loader);
    else this.loaders.push(loader);
  }

  remove_resource_format_loader(loader: GodotResourceFormatLoader): void {
    const index = this.loaders.indexOf(loader);
    if (index >= 0) this.loaders.splice(index, 1);
  }

  add_resource_format_saver(saver: GodotResourceFormatSaver, atFront = false): void {
    this.remove_resource_format_saver(saver);
    if (atFront) this.savers.unshift(saver);
    else this.savers.push(saver);
  }

  remove_resource_format_saver(saver: GodotResourceFormatSaver): void {
    const index = this.savers.indexOf(saver);
    if (index >= 0) this.savers.splice(index, 1);
  }

  get_loaders(): readonly GodotResourceFormatLoader[] { return this.loaders; }
  get_savers(): readonly GodotResourceFormatSaver[] { return this.savers; }

  find_loader(path: string, typeHint = ''): GodotResourceFormatLoader | null {
    for (const loader of this.loaders) {
      if (Boolean(loader._recognize_path(path, typeHint))) return loader;
      const type = loader._get_resource_type(path);
      if (typeof type === 'string' && type !== '' && (typeHint === '' || Boolean(loader._handles_type(typeHint)))) return loader;
    }
    return null;
  }

  find_saver(resource: unknown, path = ''): GodotResourceFormatSaver | null {
    for (const saver of this.savers) {
      if (path !== '' && Boolean(saver._recognize_path(resource, path))) return saver;
      if (Boolean(saver._recognize(resource))) return saver;
    }
    return null;
  }

  load(path: string, typeHint = '', cacheMode = GODOT_RESOURCE_CACHE_MODE_REUSE): GodotResourceFormatResult {
    const loader = this.find_loader(path, typeHint);
    return loader?._load(path, path, false, cacheMode) ?? null;
  }

  save(resource: unknown, path: string, flags = 0): GodotResourceFormatResult {
    const saver = this.find_saver(resource, path);
    return saver?._save(resource, path, flags) ?? 31;
  }
}

export function createGodotResourceFormatLoader(carrier: GodotResourceFormatCarrier): GodotResourceFormatLoader {
  return new GodotResourceFormatLoader(carrier);
}

export function createGodotResourceFormatSaver(carrier: GodotResourceFormatCarrier): GodotResourceFormatSaver {
  return new GodotResourceFormatSaver(carrier);
}
