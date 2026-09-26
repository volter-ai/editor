export const GODOT_EDITOR_FEATURE_3D = 0;
export const GODOT_EDITOR_FEATURE_SCRIPT = 1;
export const GODOT_EDITOR_FEATURE_ASSET_LIB = 2;
export const GODOT_EDITOR_FEATURE_SCENE_TREE = 3;
export const GODOT_EDITOR_FEATURE_NODE_DOCK = 4;
export const GODOT_EDITOR_FEATURE_FILESYSTEM_DOCK = 5;
export const GODOT_EDITOR_FEATURE_IMPORT_DOCK = 6;
export const GODOT_EDITOR_FEATURE_HISTORY_DOCK = 7;
export const GODOT_EDITOR_FEATURE_GAME = 8;
export const GODOT_EDITOR_FEATURE_SIGNALS_DOCK = 9;
export const GODOT_EDITOR_FEATURE_GROUPS_DOCK = 10;
export const GODOT_EDITOR_FEATURE_MAX = 11;

export interface GodotEditorFeatureProfileData {
  disabledClasses: readonly string[];
  disabledClassEditors: readonly string[];
  disabledClassProperties: Readonly<Record<string, readonly string[]>>;
  disabledFeatures: readonly number[];
}

export interface GodotEditorFeatureProfileCarrier {
  save(path: string, data: GodotEditorFeatureProfileData): number;
  load(path: string): GodotEditorFeatureProfileData | null;
}

export class GodotEditorFeatureProfile {
  private readonly disabledClasses = new Set<string>();
  private readonly disabledClassEditors = new Set<string>();
  private readonly disabledClassProperties = new Map<string, Set<string>>();
  private readonly disabledFeatures = new Set<number>();

  constructor(private readonly carrier: GodotEditorFeatureProfileCarrier | null = null) {}

  set_disable_class(className: string, disable: boolean): void {
    this.setMembership(this.disabledClasses, className, disable);
  }

  is_class_disabled(className: string): boolean { return this.disabledClasses.has(className); }

  set_disable_class_editor(className: string, disable: boolean): void {
    this.setMembership(this.disabledClassEditors, className, disable);
  }

  is_class_editor_disabled(className: string): boolean {
    return this.disabledClassEditors.has(className) || this.disabledClasses.has(className);
  }

  set_disable_class_property(className: string, property: string, disable: boolean): void {
    let properties = this.disabledClassProperties.get(className);
    if (properties === undefined) {
      properties = new Set();
      this.disabledClassProperties.set(className, properties);
    }
    this.setMembership(properties, property, disable);
    if (properties.size === 0) this.disabledClassProperties.delete(className);
  }

  is_class_property_disabled(className: string, property: string): boolean {
    return this.disabledClasses.has(className) || this.disabledClassProperties.get(className)?.has(property) === true;
  }

  set_disable_feature(feature: number, disable: boolean): void {
    if (!Number.isSafeInteger(feature) || feature < 0 || feature >= GODOT_EDITOR_FEATURE_MAX) {
      throw new RangeError('EditorFeatureProfile feature is invalid.');
    }
    if (disable) this.disabledFeatures.add(feature);
    else this.disabledFeatures.delete(feature);
  }

  is_feature_disabled(feature: number): boolean { return this.disabledFeatures.has(feature); }

  get_feature_name(feature: number): string {
    return [
      '3D Editor',
      'Script Editor',
      'Asset Library',
      'Scene Tree',
      'Node Dock',
      'FileSystem Dock',
      'Import Dock',
      'History Dock',
      'Game',
      'Signals Dock',
      'Groups Dock',
    ][feature] ?? '';
  }

  save_to_file(path: string): number {
    return this.carrier?.save(path, this.to_data()) ?? 2;
  }

  load_from_file(path: string): number {
    const data = this.carrier?.load(path);
    if (data === null || data === undefined) return 2;
    this.from_data(data);
    return 0;
  }

  to_data(): GodotEditorFeatureProfileData {
    const properties: Record<string, readonly string[]> = {};
    for (const [className, names] of this.disabledClassProperties) properties[className] = [...names].sort();
    return {
      disabledClasses: [...this.disabledClasses].sort(),
      disabledClassEditors: [...this.disabledClassEditors].sort(),
      disabledClassProperties: properties,
      disabledFeatures: [...this.disabledFeatures].sort((left, right) => left - right),
    };
  }

  from_data(data: GodotEditorFeatureProfileData): void {
    this.disabledClasses.clear();
    this.disabledClassEditors.clear();
    this.disabledClassProperties.clear();
    this.disabledFeatures.clear();
    for (const className of data.disabledClasses) this.disabledClasses.add(className);
    for (const className of data.disabledClassEditors) this.disabledClassEditors.add(className);
    for (const [className, properties] of Object.entries(data.disabledClassProperties)) {
      this.disabledClassProperties.set(className, new Set(properties));
    }
    for (const feature of data.disabledFeatures) this.set_disable_feature(feature, true);
  }

  private setMembership<T>(set: Set<T>, value: T, enabled: boolean): void {
    if (enabled) set.add(value);
    else set.delete(value);
  }
}

export function createGodotEditorFeatureProfile(
  carrier: GodotEditorFeatureProfileCarrier | null = null,
): GodotEditorFeatureProfile {
  return new GodotEditorFeatureProfile(carrier);
}
