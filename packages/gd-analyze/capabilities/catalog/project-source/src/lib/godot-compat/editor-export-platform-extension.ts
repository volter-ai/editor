export type GodotExportExtensionResult = unknown;

export interface GodotEditorExportPlatformCarrier {
  invoke(method: string, args: readonly unknown[]): GodotExportExtensionResult;
}

export interface GodotExportRequest {
  preset: unknown;
  debug: boolean;
  path: string;
  flags?: number;
  patches?: readonly string[];
}

export class GodotEditorExportPlatformExtension {
  private configError = '';
  private configMissingTemplates = false;
  private initialized = false;

  constructor(private readonly carrier: GodotEditorExportPlatformCarrier) {}

  private call(method: string, args: readonly unknown[] = []): GodotExportExtensionResult {
    return this.carrier.invoke(method, args);
  }

  _get_preset_features(preset: unknown): GodotExportExtensionResult {
    return this.call('_get_preset_features', [preset]);
  }

  _is_executable(path: string): GodotExportExtensionResult {
    return this.call('_is_executable', [path]);
  }

  _get_export_options(): GodotExportExtensionResult {
    return this.call('_get_export_options');
  }

  _should_update_export_options(): GodotExportExtensionResult {
    return this.call('_should_update_export_options');
  }

  _get_export_option_visibility(preset: unknown, option: string): GodotExportExtensionResult {
    return this.call('_get_export_option_visibility', [preset, option]);
  }

  _get_export_option_warning(preset: unknown, option: string): GodotExportExtensionResult {
    return this.call('_get_export_option_warning', [preset, option]);
  }

  _get_os_name(): GodotExportExtensionResult { return this.call('_get_os_name'); }
  _get_name(): GodotExportExtensionResult { return this.call('_get_name'); }
  _get_logo(): GodotExportExtensionResult { return this.call('_get_logo'); }
  _poll_export(): GodotExportExtensionResult { return this.call('_poll_export'); }
  _get_options_count(): GodotExportExtensionResult { return this.call('_get_options_count'); }
  _get_options_tooltip(): GodotExportExtensionResult { return this.call('_get_options_tooltip'); }

  _get_option_icon(device: number): GodotExportExtensionResult {
    return this.call('_get_option_icon', [device]);
  }

  _get_option_label(device: number): GodotExportExtensionResult {
    return this.call('_get_option_label', [device]);
  }

  _get_option_tooltip(device: number): GodotExportExtensionResult {
    return this.call('_get_option_tooltip', [device]);
  }

  _get_device_architecture(device: number): GodotExportExtensionResult {
    return this.call('_get_device_architecture', [device]);
  }

  _cleanup(): GodotExportExtensionResult { return this.call('_cleanup'); }

  _run(preset: unknown, device: number, debugFlags: number): GodotExportExtensionResult {
    return this.call('_run', [preset, device, debugFlags]);
  }

  _get_run_icon(): GodotExportExtensionResult { return this.call('_get_run_icon'); }

  _can_export(preset: unknown, debug: boolean): GodotExportExtensionResult {
    return this.call('_can_export', [preset, debug]);
  }

  _has_valid_export_configuration(preset: unknown, debug: boolean): GodotExportExtensionResult {
    return this.call('_has_valid_export_configuration', [preset, debug]);
  }

  _has_valid_project_configuration(preset: unknown): GodotExportExtensionResult {
    return this.call('_has_valid_project_configuration', [preset]);
  }

  _get_binary_extensions(preset: unknown): GodotExportExtensionResult {
    return this.call('_get_binary_extensions', [preset]);
  }

  _export_project(preset: unknown, debug: boolean, path: string, flags: number): GodotExportExtensionResult {
    return this.call('_export_project', [preset, debug, path, flags]);
  }

  _export_pack(preset: unknown, debug: boolean, path: string, flags: number): GodotExportExtensionResult {
    return this.call('_export_pack', [preset, debug, path, flags]);
  }

  _export_zip(preset: unknown, debug: boolean, path: string, flags: number): GodotExportExtensionResult {
    return this.call('_export_zip', [preset, debug, path, flags]);
  }

  _export_pack_patch(preset: unknown, debug: boolean, path: string, patches: readonly string[], flags: number): GodotExportExtensionResult {
    return this.call('_export_pack_patch', [preset, debug, path, patches, flags]);
  }

  _export_zip_patch(preset: unknown, debug: boolean, path: string, patches: readonly string[], flags: number): GodotExportExtensionResult {
    return this.call('_export_zip_patch', [preset, debug, path, patches, flags]);
  }

  _get_platform_features(): GodotExportExtensionResult { return this.call('_get_platform_features'); }
  _get_debug_protocol(): GodotExportExtensionResult { return this.call('_get_debug_protocol'); }

  _initialize(): GodotExportExtensionResult {
    this.initialized = true;
    return this.call('_initialize');
  }

  set_config_error(errorText: string): void { this.configError = errorText; }
  get_config_error(): string { return this.configError; }
  set_config_missing_templates(missingTemplates: boolean): void { this.configMissingTemplates = missingTemplates; }
  get_config_missing_templates(): boolean { return this.configMissingTemplates; }
  is_initialized(): boolean { return this.initialized; }

  export(request: GodotExportRequest, format: 'project' | 'pack' | 'zip' | 'pack_patch' | 'zip_patch' = 'project'): GodotExportExtensionResult {
    const flags = request.flags ?? 0;
    if (format === 'pack') return this._export_pack(request.preset, request.debug, request.path, flags);
    if (format === 'zip') return this._export_zip(request.preset, request.debug, request.path, flags);
    if (format === 'pack_patch') return this._export_pack_patch(request.preset, request.debug, request.path, request.patches ?? [], flags);
    if (format === 'zip_patch') return this._export_zip_patch(request.preset, request.debug, request.path, request.patches ?? [], flags);
    return this._export_project(request.preset, request.debug, request.path, flags);
  }
}

export function createGodotEditorExportPlatformExtension(
  carrier: GodotEditorExportPlatformCarrier,
): GodotEditorExportPlatformExtension {
  return new GodotEditorExportPlatformExtension(carrier);
}
