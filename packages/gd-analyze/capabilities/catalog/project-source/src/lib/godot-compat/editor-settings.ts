import type { GodotInputMapEvent } from './input';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol } from './resource-io';
import type { GodotShortcut } from './shortcut';
import { createSignal, type GodotSignal } from './signal';

export const GODOT_NOTIFICATION_EDITOR_SETTINGS_CHANGED = 10000;

export interface GodotEditorPropertyInfo {
  name: string;
  type?: number;
  hint?: number;
  hint_string?: string;
  usage?: number;
}

export class GodotEditorSettings {
  private readonly settings = new Map<string, unknown>();
  private readonly initialValues = new Map<string, unknown>();
  private readonly propertyInfo = new Map<string, GodotEditorPropertyInfo>();
  private readonly projectMetadata = new Map<string, Map<string, unknown>>();
  private readonly shortcuts = new Map<string, GodotShortcut>();
  private readonly builtinActionOverrides = new Map<string, readonly GodotInputMapEvent[]>();
  private readonly changedSettings = new Set<string>();
  private readonly settingsChangedSignal = createSignal<readonly []>();
  private favorites: string[] = [];
  private recentDirectories: string[] = [];

  readonly settings_changed: GodotSignal<readonly []> = this.settingsChangedSignal.signal;

  constructor() {
    registerGodotObjectIdentity(this, 'EditorSettings');
    bindGodotResourceProtocol(this, {
      createDuplicate: () => new GodotEditorSettings(),
      populateDuplicate: (source, target) => target.import_state(source.export_state()),
    });
  }

  has_setting(name: string): boolean { return this.settings.has(name); }

  set_setting(name: string, value: unknown): void {
    if (value === null) this.settings.delete(name);
    else this.settings.set(name, value);
    this.mark_setting_changed(name);
  }

  get_setting(name: string): unknown {
    return this.settings.get(name) ?? this.initialValues.get(name) ?? null;
  }
  get_settings_dir(): string { return 'user://editor'; }
  get_project_settings_dir(): string { return 'user://editor/projects'; }
  property_can_revert(name: string): boolean { return this.initialValues.has(name) && this.settings.get(name) !== this.initialValues.get(name); }
  property_get_revert(name: string): unknown { return this.initialValues.get(name) ?? null; }

  erase(property: string): void {
    if (this.settings.delete(property)) this.mark_setting_changed(property);
  }

  set_initial_value(name: string, value: unknown, updateCurrent: boolean): void {
    this.initialValues.set(name, value);
    if (updateCurrent || !this.settings.has(name)) this.settings.set(name, value);
  }

  add_property_info(info: GodotEditorPropertyInfo): void {
    if (typeof info.name !== 'string' || info.name === '') throw new TypeError('EditorSettings property info requires name.');
    this.propertyInfo.set(info.name, { ...info });
  }

  get_property_info(name: string): GodotEditorPropertyInfo | null {
    return this.propertyInfo.get(name) ?? null;
  }

  set_project_metadata(section: string, key: string, data: unknown): void {
    let metadata = this.projectMetadata.get(section);
    if (metadata === undefined) { metadata = new Map(); this.projectMetadata.set(section, metadata); }
    if (data === null) metadata.delete(key);
    else metadata.set(key, data);
    if (metadata.size === 0) this.projectMetadata.delete(section);
  }

  get_project_metadata(section: string, key: string, defaultValue: unknown = null): unknown {
    return this.projectMetadata.get(section)?.get(key) ?? defaultValue;
  }

  set_favorites(directories: Iterable<string>): void { this.favorites = [...directories].map(String); }
  get_favorites(): readonly string[] { return [...this.favorites]; }
  set_recent_dirs(directories: Iterable<string>): void { this.recentDirectories = [...directories].map(String); }
  get_recent_dirs(): readonly string[] { return [...this.recentDirectories]; }

  set_builtin_action_override(name: string, actionsList: readonly GodotInputMapEvent[]): void {
    this.builtinActionOverrides.set(name, [...actionsList]);
  }

  get_builtin_action_override(name: string): readonly GodotInputMapEvent[] {
    return this.builtinActionOverrides.get(name) ?? [];
  }

  add_shortcut(path: string, shortcut: GodotShortcut): void {
    this.shortcuts.set(path, shortcut);
  }

  remove_shortcut(path: string): void { this.shortcuts.delete(path); }

  is_shortcut(path: string, event: GodotInputMapEvent): boolean {
    return this.shortcuts.get(path)?.matches_event(event) ?? false;
  }

  has_shortcut(path: string): boolean { return this.shortcuts.has(path); }
  get_shortcut(path: string): GodotShortcut | null { return this.shortcuts.get(path) ?? null; }
  get_shortcut_list(): readonly string[] { return [...this.shortcuts.keys()].sort(); }

  check_changed_settings_in_group(settingPrefix: string): boolean {
    for (const setting of this.changedSettings) if (setting.startsWith(settingPrefix)) return true;
    return false;
  }

  get_changed_settings(): readonly string[] { return [...this.changedSettings].sort(); }

  mark_setting_changed(setting: string): void {
    this.changedSettings.add(setting);
    this.settingsChangedSignal.emit();
  }

  clear_changed_settings(): void { this.changedSettings.clear(); }

  export_state(): Readonly<Record<string, unknown>> {
    const metadata: Record<string, Record<string, unknown>> = {};
    for (const [section, values] of this.projectMetadata) metadata[section] = Object.fromEntries(values);
    return {
      settings: Object.fromEntries(this.settings),
      initial_values: Object.fromEntries(this.initialValues),
      property_info: Object.fromEntries(this.propertyInfo),
      project_metadata: metadata,
      favorites: [...this.favorites],
      recent_dirs: [...this.recentDirectories],
      shortcuts: Object.fromEntries(this.shortcuts),
      builtin_action_overrides: Object.fromEntries(this.builtinActionOverrides),
    };
  }

  import_state(value: Readonly<Record<string, unknown>>): void {
    const entries = (name: string): readonly [string, unknown][] => {
      const section = value[name];
      return typeof section === 'object' && section !== null ? Object.entries(section) : [];
    };
    this.settings.clear(); this.initialValues.clear(); this.propertyInfo.clear(); this.projectMetadata.clear();
    this.shortcuts.clear(); this.builtinActionOverrides.clear();
    for (const [key, item] of entries('settings')) this.settings.set(key, item);
    for (const [key, item] of entries('initial_values')) this.initialValues.set(key, item);
    for (const [key, item] of entries('property_info')) if (typeof item === 'object' && item !== null) this.propertyInfo.set(key, { ...(item as GodotEditorPropertyInfo), name: key });
    for (const [section, item] of entries('project_metadata')) if (typeof item === 'object' && item !== null) this.projectMetadata.set(section, new Map(Object.entries(item)));
    const favorites = value['favorites'];
    const recentDirectories = value['recent_dirs'];
    this.favorites = Array.isArray(favorites) ? favorites.map(String) : [];
    this.recentDirectories = Array.isArray(recentDirectories) ? recentDirectories.map(String) : [];
    for (const [key, item] of entries('shortcuts')) this.shortcuts.set(key, item as GodotShortcut);
    for (const [key, item] of entries('builtin_action_overrides')) if (Array.isArray(item)) this.builtinActionOverrides.set(key, item as GodotInputMapEvent[]);
    this.changedSettings.clear();
  }
}

export const GodotEditorSettingsSingleton = new GodotEditorSettings();
export function createGodotEditorSettings(): GodotEditorSettings { return new GodotEditorSettings(); }
