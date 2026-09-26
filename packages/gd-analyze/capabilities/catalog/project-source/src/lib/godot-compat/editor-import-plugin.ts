export type GodotImportExtensionResult = unknown;

export interface GodotImportExtensionCarrier {
  invoke(method: string, args: readonly unknown[]): GodotImportExtensionResult;
}

export interface GodotImportExternalResource {
  path: string;
  customOptions: Readonly<Record<string, unknown>>;
  customImporter: string;
  generatorParameters: unknown;
}

export class GodotEditorFileSystemImportFormatSupportQuery {
  constructor(private readonly carrier: GodotImportExtensionCarrier) {}

  _is_active(): GodotImportExtensionResult {
    return this.carrier.invoke('_is_active', []);
  }

  _get_file_extensions(): GodotImportExtensionResult {
    return this.carrier.invoke('_get_file_extensions', []);
  }

  _query(): GodotImportExtensionResult {
    return this.carrier.invoke('_query', []);
  }
}

export class GodotEditorImportPlugin {
  private readonly externalResources: GodotImportExternalResource[] = [];

  constructor(private readonly carrier: GodotImportExtensionCarrier) {}

  private call(method: string, args: readonly unknown[] = []): GodotImportExtensionResult {
    return this.carrier.invoke(method, args);
  }

  _get_importer_name(): GodotImportExtensionResult {
    return this.call('_get_importer_name');
  }

  _get_visible_name(): GodotImportExtensionResult {
    return this.call('_get_visible_name');
  }

  _get_preset_count(): GodotImportExtensionResult {
    return this.call('_get_preset_count');
  }

  _get_preset_name(presetIndex: number): GodotImportExtensionResult {
    return this.call('_get_preset_name', [presetIndex]);
  }

  _get_recognized_extensions(): GodotImportExtensionResult {
    return this.call('_get_recognized_extensions');
  }

  _get_import_options(path: string, presetIndex: number): GodotImportExtensionResult {
    return this.call('_get_import_options', [path, presetIndex]);
  }

  _get_save_extension(): GodotImportExtensionResult {
    return this.call('_get_save_extension');
  }

  _get_resource_type(): GodotImportExtensionResult {
    return this.call('_get_resource_type');
  }

  _get_priority(): GodotImportExtensionResult {
    return this.call('_get_priority');
  }

  _get_import_order(): GodotImportExtensionResult {
    return this.call('_get_import_order');
  }

  _get_format_version(): GodotImportExtensionResult {
    return this.call('_get_format_version');
  }

  _get_option_visibility(path: string, optionName: string, options: Readonly<Record<string, unknown>>): GodotImportExtensionResult {
    return this.call('_get_option_visibility', [path, optionName, options]);
  }

  _import(
    sourceFile: string,
    savePath: string,
    options: Readonly<Record<string, unknown>>,
    platformVariants: readonly string[],
    generatedFiles: readonly string[],
  ): GodotImportExtensionResult {
    return this.call('_import', [sourceFile, savePath, options, platformVariants, generatedFiles]);
  }

  _can_import_threaded(): GodotImportExtensionResult {
    return this.call('_can_import_threaded');
  }

  append_import_external_resource(
    path: string,
    customOptions: Readonly<Record<string, unknown>> = {},
    customImporter = '',
    generatorParameters: unknown = null,
  ): number {
    this.externalResources.push({ path, customOptions: { ...customOptions }, customImporter, generatorParameters });
    return 0;
  }

  get_external_resources(): readonly GodotImportExternalResource[] {
    return this.externalResources;
  }

  clear_external_resources(): void {
    this.externalResources.length = 0;
  }

  import_resource(
    sourceFile: string,
    savePath: string,
    options: Readonly<Record<string, unknown>> = {},
  ): GodotImportExtensionResult {
    const platformVariants: string[] = [];
    const generatedFiles: string[] = [];
    const result = this._import(sourceFile, savePath, options, platformVariants, generatedFiles);
    return result;
  }
}

export function createGodotEditorImportPlugin(carrier: GodotImportExtensionCarrier): GodotEditorImportPlugin {
  return new GodotEditorImportPlugin(carrier);
}

export function createGodotImportFormatSupportQuery(
  carrier: GodotImportExtensionCarrier,
): GodotEditorFileSystemImportFormatSupportQuery {
  return new GodotEditorFileSystemImportFormatSupportQuery(carrier);
}
