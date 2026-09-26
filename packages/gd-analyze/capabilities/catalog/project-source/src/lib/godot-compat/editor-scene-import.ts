export interface GodotEditorSceneImportCarrier {
  invoke(method: string, args: readonly unknown[]): unknown;
}

export interface GodotSceneImportOption {
  name: string;
  defaultValue: unknown;
  type?: number;
  hint?: number;
  hintString?: string;
  usageFlags?: number;
}

export const GODOT_SCENE_IMPORT_SCENE = 1;
export const GODOT_SCENE_IMPORT_ANIMATION = 2;
export const GODOT_SCENE_IMPORT_FAIL_ON_MISSING_DEPENDENCIES = 4;
export const GODOT_SCENE_IMPORT_GENERATE_TANGENT_ARRAYS = 8;
export const GODOT_SCENE_IMPORT_USE_NAMED_SKIN_BINDS = 16;
export const GODOT_SCENE_IMPORT_DISCARD_MESHES_AND_MATERIALS = 32;
export const GODOT_SCENE_IMPORT_FORCE_DISABLE_MESH_COMPRESSION = 64;

export class GodotEditorResourceConversionPlugin {
  constructor(private readonly carrier: GodotEditorSceneImportCarrier) {}
  _converts_to(): unknown { return this.carrier.invoke('_converts_to', []); }
  _handles(resource: unknown): unknown { return this.carrier.invoke('_handles', [resource]); }
  _convert(resource: unknown): unknown { return this.carrier.invoke('_convert', [resource]); }
}

export class GodotEditorSceneFormatImporter {
  private readonly options: GodotSceneImportOption[] = [];

  constructor(private readonly carrier: GodotEditorSceneImportCarrier) {}

  private call(method: string, args: readonly unknown[] = []): unknown {
    return this.carrier.invoke(method, args);
  }

  _get_extensions(): unknown { return this.call('_get_extensions'); }

  _import_scene(path: string, flags: number, options: Readonly<Record<string, unknown>>): unknown {
    return this.call('_import_scene', [path, flags, options]);
  }

  _get_import_options(path: string): unknown {
    return this.call('_get_import_options', [path]);
  }

  _get_option_visibility(path: string, forAnimation: boolean, option: string): unknown {
    return this.call('_get_option_visibility', [path, forAnimation, option]);
  }

  add_import_option(name: string, value: unknown): void {
    this.options.push({ name, defaultValue: value });
  }

  add_import_option_advanced(
    type: number,
    name: string,
    defaultValue: unknown,
    hint = 0,
    hintString = '',
    usageFlags = 6,
  ): void {
    this.options.push({ type, name, defaultValue, hint, hintString, usageFlags });
  }

  get_added_import_options(): readonly GodotSceneImportOption[] {
    return this.options;
  }
}

export class GodotEditorScenePostImport {
  private sourceFile = '';

  constructor(private readonly carrier: GodotEditorSceneImportCarrier) {}

  _post_import(scene: unknown): unknown {
    return this.carrier.invoke('_post_import', [scene]);
  }

  get_source_file(): string { return this.sourceFile; }
  set_source_file(sourceFile: string): void { this.sourceFile = sourceFile; }
}

export const GODOT_INTERNAL_IMPORT_CATEGORY_NODE = 0;
export const GODOT_INTERNAL_IMPORT_CATEGORY_MESH_3D_NODE = 1;
export const GODOT_INTERNAL_IMPORT_CATEGORY_MESH = 2;
export const GODOT_INTERNAL_IMPORT_CATEGORY_MATERIAL = 3;
export const GODOT_INTERNAL_IMPORT_CATEGORY_ANIMATION = 4;
export const GODOT_INTERNAL_IMPORT_CATEGORY_ANIMATION_NODE = 5;
export const GODOT_INTERNAL_IMPORT_CATEGORY_SKELETON_3D_NODE = 6;
export const GODOT_INTERNAL_IMPORT_CATEGORY_MAX = 7;

export class GodotEditorScenePostImportPlugin {
  private readonly options = new Map<string, unknown>();
  private readonly definitions: GodotSceneImportOption[] = [];

  constructor(private readonly carrier: GodotEditorSceneImportCarrier) {}

  private call(method: string, args: readonly unknown[] = []): unknown {
    return this.carrier.invoke(method, args);
  }

  _get_internal_import_options(category: number): unknown {
    return this.call('_get_internal_import_options', [category]);
  }

  _get_internal_option_visibility(category: number, forAnimation: boolean, option: string): unknown {
    return this.call('_get_internal_option_visibility', [category, forAnimation, option]);
  }

  _get_internal_option_update_view_required(category: number, option: string): unknown {
    return this.call('_get_internal_option_update_view_required', [category, option]);
  }

  _internal_process(category: number, baseNode: unknown, node: unknown, resource: unknown): unknown {
    return this.call('_internal_process', [category, baseNode, node, resource]);
  }

  _get_import_options(path: string): unknown {
    return this.call('_get_import_options', [path]);
  }

  _get_option_visibility(path: string, forAnimation: boolean, option: string): unknown {
    return this.call('_get_option_visibility', [path, forAnimation, option]);
  }

  _pre_process(scene: unknown): unknown { return this.call('_pre_process', [scene]); }
  _post_process(scene: unknown): unknown { return this.call('_post_process', [scene]); }
  get_option_value(name: string): unknown { return this.options.get(name); }

  add_import_option(name: string, value: unknown): void {
    this.options.set(name, value);
    this.definitions.push({ name, defaultValue: value });
  }

  add_import_option_advanced(
    type: number,
    name: string,
    defaultValue: unknown,
    hint = 0,
    hintString = '',
    usageFlags = 6,
  ): void {
    this.options.set(name, defaultValue);
    this.definitions.push({ type, name, defaultValue, hint, hintString, usageFlags });
  }

  set_option_value(name: string, value: unknown): void { this.options.set(name, value); }
  get_added_import_options(): readonly GodotSceneImportOption[] { return this.definitions; }
}

export function createGodotEditorSceneFormatImporter(carrier: GodotEditorSceneImportCarrier): GodotEditorSceneFormatImporter {
  return new GodotEditorSceneFormatImporter(carrier);
}

export function createGodotEditorScenePostImport(carrier: GodotEditorSceneImportCarrier): GodotEditorScenePostImport {
  return new GodotEditorScenePostImport(carrier);
}

export function createGodotEditorScenePostImportPlugin(carrier: GodotEditorSceneImportCarrier): GodotEditorScenePostImportPlugin {
  return new GodotEditorScenePostImportPlugin(carrier);
}
