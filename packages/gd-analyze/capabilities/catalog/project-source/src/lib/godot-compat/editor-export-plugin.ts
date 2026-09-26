export type GodotExportPluginResult = unknown;

export interface GodotEditorExportPluginCarrier {
  invoke(method: string, args: readonly unknown[]): GodotExportPluginResult;
}

export interface GodotExportSharedObject {
  path: string;
  tags: readonly string[];
  target: string;
}

export interface GodotExportFile {
  path: string;
  bytes: Uint8Array;
  remap: boolean;
}

export class GodotEditorExportPlugin {
  private readonly sharedObjects: GodotExportSharedObject[] = [];
  private readonly files: GodotExportFile[] = [];
  private readonly appleStaticLibraries: string[] = [];
  private readonly appleFrameworks: string[] = [];
  private readonly appleEmbeddedFrameworks: string[] = [];
  private readonly applePlistContent: string[] = [];
  private readonly appleLinkerFlags: string[] = [];
  private readonly appleBundleFiles: string[] = [];
  private readonly appleCppCode: string[] = [];
  private readonly macosPluginFiles: string[] = [];
  private skipped = false;
  private exportPreset: unknown = null;
  private exportPlatform: unknown = null;
  private readonly options = new Map<string, unknown>();

  constructor(private readonly carrier: GodotEditorExportPluginCarrier) {}

  private call(method: string, args: readonly unknown[] = []): GodotExportPluginResult {
    return this.carrier.invoke(method, args);
  }

  _export_file(path: string, type: string, features: readonly string[]): GodotExportPluginResult {
    return this.call('_export_file', [path, type, features]);
  }

  _export_begin(features: readonly string[], isDebug: boolean, path: string, flags: number): GodotExportPluginResult {
    this.skipped = false;
    return this.call('_export_begin', [features, isDebug, path, flags]);
  }

  _export_end(): GodotExportPluginResult { return this.call('_export_end'); }

  _end_generate_apple_embedded_project(path: string, willBuildArchive: boolean): GodotExportPluginResult {
    return this.call('_end_generate_apple_embedded_project', [path, willBuildArchive]);
  }

  _begin_customize_resources(platform: unknown, features: readonly string[]): GodotExportPluginResult {
    return this.call('_begin_customize_resources', [platform, features]);
  }

  _customize_resource(resource: unknown, path: string): GodotExportPluginResult {
    return this.call('_customize_resource', [resource, path]);
  }

  _begin_customize_scenes(platform: unknown, features: readonly string[]): GodotExportPluginResult {
    return this.call('_begin_customize_scenes', [platform, features]);
  }

  _customize_scene(scene: unknown, path: string): GodotExportPluginResult {
    return this.call('_customize_scene', [scene, path]);
  }

  _get_customization_configuration_hash(): GodotExportPluginResult {
    return this.call('_get_customization_configuration_hash');
  }

  _end_customize_scenes(): GodotExportPluginResult { return this.call('_end_customize_scenes'); }
  _end_customize_resources(): GodotExportPluginResult { return this.call('_end_customize_resources'); }

  _get_export_options(platform: unknown): GodotExportPluginResult {
    return this.call('_get_export_options', [platform]);
  }

  _get_export_options_overrides(platform: unknown): GodotExportPluginResult {
    return this.call('_get_export_options_overrides', [platform]);
  }

  _should_update_export_options(platform: unknown): GodotExportPluginResult {
    return this.call('_should_update_export_options', [platform]);
  }

  _get_export_option_visibility(platform: unknown, option: string): GodotExportPluginResult {
    return this.call('_get_export_option_visibility', [platform, option]);
  }

  _get_export_option_warning(platform: unknown, option: string): GodotExportPluginResult {
    return this.call('_get_export_option_warning', [platform, option]);
  }

  _get_export_features(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_export_features', [platform, debug]);
  }

  _get_name(): GodotExportPluginResult { return this.call('_get_name'); }

  _supports_platform(platform: unknown): GodotExportPluginResult {
    return this.call('_supports_platform', [platform]);
  }

  _get_android_dependencies(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_dependencies', [platform, debug]);
  }

  _get_android_dependencies_maven_repos(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_dependencies_maven_repos', [platform, debug]);
  }

  _get_android_libraries(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_libraries', [platform, debug]);
  }

  _get_android_manifest_activity_element_contents(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_manifest_activity_element_contents', [platform, debug]);
  }

  _get_android_manifest_application_element_contents(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_manifest_application_element_contents', [platform, debug]);
  }

  _get_android_manifest_element_contents(platform: unknown, debug: boolean): GodotExportPluginResult {
    return this.call('_get_android_manifest_element_contents', [platform, debug]);
  }

  _update_android_prebuilt_manifest(platform: unknown, manifestData: Uint8Array): GodotExportPluginResult {
    return this.call('_update_android_prebuilt_manifest', [platform, manifestData]);
  }

  add_shared_object(path: string, tags: readonly string[], target: string): void {
    this.sharedObjects.push({ path, tags: [...tags], target });
  }

  add_file(path: string, file: Uint8Array, remap: boolean): void {
    this.files.push({ path, bytes: file.slice(), remap });
  }

  add_apple_embedded_platform_project_static_lib(path: string): void { this.appleStaticLibraries.push(path); }
  add_apple_embedded_platform_framework(path: string): void { this.appleFrameworks.push(path); }
  add_apple_embedded_platform_embedded_framework(path: string): void { this.appleEmbeddedFrameworks.push(path); }
  add_apple_embedded_platform_plist_content(plistContent: string): void { this.applePlistContent.push(plistContent); }
  add_apple_embedded_platform_linker_flags(flags: string): void { this.appleLinkerFlags.push(flags); }
  add_apple_embedded_platform_bundle_file(path: string): void { this.appleBundleFiles.push(path); }
  add_apple_embedded_platform_cpp_code(code: string): void { this.appleCppCode.push(code); }
  add_ios_project_static_lib(path: string): void { this.add_apple_embedded_platform_project_static_lib(path); }
  add_ios_framework(path: string): void { this.add_apple_embedded_platform_framework(path); }
  add_ios_embedded_framework(path: string): void { this.add_apple_embedded_platform_embedded_framework(path); }
  add_ios_plist_content(plistContent: string): void { this.add_apple_embedded_platform_plist_content(plistContent); }
  add_ios_linker_flags(flags: string): void { this.add_apple_embedded_platform_linker_flags(flags); }
  add_ios_bundle_file(path: string): void { this.add_apple_embedded_platform_bundle_file(path); }
  add_ios_cpp_code(code: string): void { this.add_apple_embedded_platform_cpp_code(code); }
  add_macos_plugin_file(path: string): void { this.macosPluginFiles.push(path); }
  skip(): void { this.skipped = true; }
  get_option(name: string): unknown { return this.options.get(name); }
  get_export_preset(): unknown { return this.exportPreset; }
  get_export_platform(): unknown { return this.exportPlatform; }

  set_export_context(platform: unknown, preset: unknown, options: Readonly<Record<string, unknown>> = {}): void {
    this.exportPlatform = platform;
    this.exportPreset = preset;
    this.options.clear();
    for (const [name, value] of Object.entries(options)) this.options.set(name, value);
  }

  get_added_shared_objects(): readonly GodotExportSharedObject[] { return this.sharedObjects; }
  get_added_files(): readonly GodotExportFile[] { return this.files; }
  get_apple_static_libraries(): readonly string[] { return this.appleStaticLibraries; }
  get_apple_frameworks(): readonly string[] { return this.appleFrameworks; }
  get_apple_embedded_frameworks(): readonly string[] { return this.appleEmbeddedFrameworks; }
  get_apple_plist_content(): readonly string[] { return this.applePlistContent; }
  get_apple_linker_flags(): readonly string[] { return this.appleLinkerFlags; }
  get_apple_bundle_files(): readonly string[] { return this.appleBundleFiles; }
  get_apple_cpp_code(): readonly string[] { return this.appleCppCode; }
  get_macos_plugin_files(): readonly string[] { return this.macosPluginFiles; }
  is_skipped(): boolean { return this.skipped; }
}

export function createGodotEditorExportPlugin(carrier: GodotEditorExportPluginCarrier): GodotEditorExportPlugin {
  return new GodotEditorExportPlugin(carrier);
}
