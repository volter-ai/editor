import { registerGodotObjectIdentity } from './object';

export interface GodotOpenXRTopLevelPathMetadata {
  readonly displayName: string;
  readonly openxrPath: string;
  readonly extensionName: string;
}

export interface GodotOpenXRInteractionProfileMetadataEntry {
  readonly displayName: string;
  readonly openxrPath: string;
  readonly extensionName: string;
}

export interface GodotOpenXRIOPathMetadata {
  readonly interactionProfile: string;
  readonly displayName: string;
  readonly topLevelPath: string;
  readonly openxrPath: string;
  readonly extensionName: string;
  readonly actionType: number;
}

function requiredPath(value: string, owner: string): string {
  if (typeof value !== 'string') throw new TypeError(`${owner} requires String.`);
  const path = value.trim();
  if (path.length === 0 || !path.startsWith('/')) throw new RangeError(`${owner} requires an absolute OpenXR path.`);
  return path;
}

function requiredText(value: string, owner: string): string {
  if (typeof value !== 'string') throw new TypeError(`${owner} requires String.`);
  const text = value.trim();
  if (text.length === 0) throw new RangeError(`${owner} cannot be empty.`);
  return text;
}

function optionalExtension(value: string): string {
  if (typeof value !== 'string') throw new TypeError('OpenXR extension name requires String.');
  return value.trim();
}

export class GodotOpenXRInteractionProfileMetadata {
  private readonly profileRenames = new Map<string, string>();
  private readonly topLevelPaths = new Map<string, GodotOpenXRTopLevelPathMetadata>();
  private readonly interactionProfiles = new Map<string, GodotOpenXRInteractionProfileMetadataEntry>();
  private readonly ioPaths = new Map<string, Map<string, GodotOpenXRIOPathMetadata>>();
  private readonly enabledExtensions = new Set<string>();

  constructor() {
    registerGodotObjectIdentity(this, 'OpenXRInteractionProfileMetadata');
  }

  register_profile_rename(oldName: string, newName: string): void {
    const source = requiredPath(oldName, 'OpenXRInteractionProfileMetadata.register_profile_rename old_name');
    const target = requiredPath(newName, 'OpenXRInteractionProfileMetadata.register_profile_rename new_name');
    if (source === target) {
      this.profileRenames.delete(source);
      return;
    }
    let cursor = target;
    const visited = new Set<string>([source]);
    while (this.profileRenames.has(cursor)) {
      if (visited.has(cursor)) throw new Error('OpenXR interaction profile rename cycle detected.');
      visited.add(cursor);
      cursor = this.profileRenames.get(cursor)!;
    }
    if (cursor === source) throw new Error('OpenXR interaction profile rename cycle detected.');
    this.profileRenames.set(source, target);
  }

  register_top_level_path(displayName: string, openxrPath: string, openxrExtensionName = ''): void {
    const path = requiredPath(openxrPath, 'OpenXRInteractionProfileMetadata.register_top_level_path openxr_path');
    this.topLevelPaths.set(path, Object.freeze({
      displayName: requiredText(displayName, 'OpenXRInteractionProfileMetadata.register_top_level_path display_name'),
      openxrPath: path,
      extensionName: optionalExtension(openxrExtensionName),
    }));
  }

  register_interaction_profile(displayName: string, openxrPath: string, openxrExtensionName = ''): void {
    const path = requiredPath(openxrPath, 'OpenXRInteractionProfileMetadata.register_interaction_profile openxr_path');
    this.interactionProfiles.set(path, Object.freeze({
      displayName: requiredText(displayName, 'OpenXRInteractionProfileMetadata.register_interaction_profile display_name'),
      openxrPath: path,
      extensionName: optionalExtension(openxrExtensionName),
    }));
    if (!this.ioPaths.has(path)) this.ioPaths.set(path, new Map());
  }

  register_io_path(
    interactionProfile: string,
    displayName: string,
    topLevelPath: string,
    openxrPath: string,
    openxrExtensionName: string,
    actionType: number,
  ): void {
    const profile = this.resolve_profile_path(interactionProfile);
    if (!this.interactionProfiles.has(profile)) {
      throw new Error(`OpenXR interaction profile ${profile} must be registered before its I/O paths.`);
    }
    const topLevel = requiredPath(topLevelPath, 'OpenXRInteractionProfileMetadata.register_io_path top_level_path');
    if (!this.topLevelPaths.has(topLevel)) {
      throw new Error(`OpenXR top-level path ${topLevel} must be registered before its I/O paths.`);
    }
    if (!Number.isSafeInteger(actionType) || actionType < 0) {
      throw new RangeError('OpenXRInteractionProfileMetadata.register_io_path action_type must be a non-negative integer.');
    }
    const path = requiredPath(openxrPath, 'OpenXRInteractionProfileMetadata.register_io_path openxr_path');
    const profilePaths = this.ioPaths.get(profile)!;
    profilePaths.set(path, Object.freeze({
      interactionProfile: profile,
      displayName: requiredText(displayName, 'OpenXRInteractionProfileMetadata.register_io_path display_name'),
      topLevelPath: topLevel,
      openxrPath: path,
      extensionName: optionalExtension(openxrExtensionName),
      actionType,
    }));
  }

  set_extension_enabled(extensionName: string, enabled: boolean): void {
    const extension = requiredText(extensionName, 'OpenXRInteractionProfileMetadata extension_name');
    if (enabled) this.enabledExtensions.add(extension);
    else this.enabledExtensions.delete(extension);
  }

  is_extension_enabled(extensionName: string): boolean {
    const extension = optionalExtension(extensionName);
    return extension === '' || this.enabledExtensions.has(extension);
  }

  resolve_profile_path(path: string): string {
    let current = requiredPath(path, 'OpenXRInteractionProfileMetadata profile path');
    const visited = new Set<string>();
    while (this.profileRenames.has(current)) {
      if (visited.has(current)) throw new Error('OpenXR interaction profile rename cycle detected.');
      visited.add(current);
      current = this.profileRenames.get(current)!;
    }
    return current;
  }

  get_profile_rename(path: string): string {
    const source = requiredPath(path, 'OpenXRInteractionProfileMetadata.get_profile_rename path');
    return this.profileRenames.get(source) ?? '';
  }

  get_top_level_path(path: string): GodotOpenXRTopLevelPathMetadata | null {
    return this.topLevelPaths.get(requiredPath(path, 'OpenXRInteractionProfileMetadata.get_top_level_path path')) ?? null;
  }

  get_interaction_profile(path: string): GodotOpenXRInteractionProfileMetadataEntry | null {
    return this.interactionProfiles.get(this.resolve_profile_path(path)) ?? null;
  }

  get_io_path(interactionProfile: string, path: string): GodotOpenXRIOPathMetadata | null {
    const profile = this.resolve_profile_path(interactionProfile);
    const ioPath = requiredPath(path, 'OpenXRInteractionProfileMetadata.get_io_path path');
    return this.ioPaths.get(profile)?.get(ioPath) ?? null;
  }

  has_top_level_path(path: string): boolean {
    return this.topLevelPaths.has(requiredPath(path, 'OpenXRInteractionProfileMetadata.has_top_level_path path'));
  }

  has_interaction_profile(path: string): boolean {
    return this.interactionProfiles.has(this.resolve_profile_path(path));
  }

  has_io_path(interactionProfile: string, path: string): boolean {
    return this.get_io_path(interactionProfile, path) !== null;
  }

  is_top_level_path_available(path: string): boolean {
    const metadata = this.get_top_level_path(path);
    return metadata !== null && this.is_extension_enabled(metadata.extensionName);
  }

  is_interaction_profile_available(path: string): boolean {
    const metadata = this.get_interaction_profile(path);
    return metadata !== null && this.is_extension_enabled(metadata.extensionName);
  }

  is_io_path_available(interactionProfile: string, path: string): boolean {
    const metadata = this.get_io_path(interactionProfile, path);
    if (metadata === null || !this.is_extension_enabled(metadata.extensionName)) return false;
    return this.is_interaction_profile_available(metadata.interactionProfile) && this.is_top_level_path_available(metadata.topLevelPath);
  }

  get_top_level_paths(includeUnavailable = true): readonly GodotOpenXRTopLevelPathMetadata[] {
    return [...this.topLevelPaths.values()].filter((entry) => includeUnavailable || this.is_extension_enabled(entry.extensionName));
  }

  get_interaction_profiles(includeUnavailable = true): readonly GodotOpenXRInteractionProfileMetadataEntry[] {
    return [...this.interactionProfiles.values()].filter((entry) => includeUnavailable || this.is_extension_enabled(entry.extensionName));
  }

  get_io_paths(interactionProfile: string, includeUnavailable = true): readonly GodotOpenXRIOPathMetadata[] {
    const profile = this.resolve_profile_path(interactionProfile);
    const paths = [...(this.ioPaths.get(profile)?.values() ?? [])];
    return paths.filter((entry) => includeUnavailable || this.is_io_path_available(profile, entry.openxrPath));
  }

  get_io_paths_for_top_level_path(interactionProfile: string, topLevelPath: string, includeUnavailable = true): readonly GodotOpenXRIOPathMetadata[] {
    const topLevel = requiredPath(topLevelPath, 'OpenXRInteractionProfileMetadata.get_io_paths_for_top_level_path path');
    return this.get_io_paths(interactionProfile, includeUnavailable).filter((entry) => entry.topLevelPath === topLevel);
  }

  get_io_paths_for_action_type(interactionProfile: string, actionType: number, includeUnavailable = true): readonly GodotOpenXRIOPathMetadata[] {
    if (!Number.isSafeInteger(actionType) || actionType < 0) throw new RangeError('OpenXR action type must be a non-negative integer.');
    return this.get_io_paths(interactionProfile, includeUnavailable).filter((entry) => entry.actionType === actionType);
  }

  unregister_interaction_profile(path: string): void {
    const profile = this.resolve_profile_path(path);
    this.interactionProfiles.delete(profile);
    this.ioPaths.delete(profile);
    for (const [source, target] of this.profileRenames) {
      if (source === profile || target === profile) this.profileRenames.delete(source);
    }
  }

  clear(): void {
    this.profileRenames.clear();
    this.topLevelPaths.clear();
    this.interactionProfiles.clear();
    this.ioPaths.clear();
    this.enabledExtensions.clear();
  }
}

export const OpenXRInteractionProfileMetadata = new GodotOpenXRInteractionProfileMetadata();

export function createGodotOpenXRInteractionProfileMetadata(): GodotOpenXRInteractionProfileMetadata {
  return new GodotOpenXRInteractionProfileMetadata();
}
