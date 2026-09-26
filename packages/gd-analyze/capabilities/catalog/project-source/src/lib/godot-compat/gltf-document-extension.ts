export type GodotGLTFExtensionResult = unknown;

export interface GodotGLTFDocumentExtensionCarrier {
  invoke(method: string, args: readonly unknown[]): GodotGLTFExtensionResult;
}

export interface GodotGLTFImportContext {
  state: unknown;
  root?: unknown;
  extensions?: readonly string[];
}

export interface GodotGLTFExportContext {
  state: unknown;
  root: unknown;
}

export class GodotGLTFDocumentExtension {
  constructor(protected readonly carrier: GodotGLTFDocumentExtensionCarrier) {}

  protected call(method: string, args: readonly unknown[]): GodotGLTFExtensionResult {
    return this.carrier.invoke(method, args);
  }

  _import_preflight(state: unknown, extensions: readonly string[]): GodotGLTFExtensionResult {
    return this.call('_import_preflight', [state, extensions]);
  }

  _get_supported_extensions(): GodotGLTFExtensionResult {
    return this.call('_get_supported_extensions', []);
  }

  _parse_node_extensions(state: unknown, gltfNode: unknown, extensions: unknown): GodotGLTFExtensionResult {
    return this.call('_parse_node_extensions', [state, gltfNode, extensions]);
  }

  _parse_image_data(state: unknown, imageData: Uint8Array, mimeType: string, retImage: unknown): GodotGLTFExtensionResult {
    return this.call('_parse_image_data', [state, imageData, mimeType, retImage]);
  }

  _get_image_file_extension(): GodotGLTFExtensionResult {
    return this.call('_get_image_file_extension', []);
  }

  _parse_texture_json(state: unknown, textureJson: Readonly<Record<string, unknown>>, retGLTFTexture: unknown): GodotGLTFExtensionResult {
    return this.call('_parse_texture_json', [state, textureJson, retGLTFTexture]);
  }

  _import_object_model_property(state: unknown, splitJsonPointer: readonly string[], partialPaths: readonly unknown[]): GodotGLTFExtensionResult {
    return this.call('_import_object_model_property', [state, splitJsonPointer, partialPaths]);
  }

  _import_post_parse(state: unknown): GodotGLTFExtensionResult {
    return this.call('_import_post_parse', [state]);
  }

  _import_pre_generate(state: unknown): GodotGLTFExtensionResult {
    return this.call('_import_pre_generate', [state]);
  }

  _generate_scene_node(state: unknown, gltfNode: unknown, sceneParent: unknown): GodotGLTFExtensionResult {
    return this.call('_generate_scene_node', [state, gltfNode, sceneParent]);
  }

  _import_node(state: unknown, gltfNode: unknown, json: Readonly<Record<string, unknown>>, node: unknown): GodotGLTFExtensionResult {
    return this.call('_import_node', [state, gltfNode, json, node]);
  }

  _import_post(state: unknown, root: unknown): GodotGLTFExtensionResult {
    return this.call('_import_post', [state, root]);
  }

  _export_get_property_list(rootNode: unknown): GodotGLTFExtensionResult {
    return this.call('_export_get_property_list', [rootNode]);
  }

  _export_preflight(state: unknown, root: unknown): GodotGLTFExtensionResult {
    return this.call('_export_preflight', [state, root]);
  }

  _convert_scene_node(state: unknown, gltfNode: unknown, sceneNode: unknown): GodotGLTFExtensionResult {
    return this.call('_convert_scene_node', [state, gltfNode, sceneNode]);
  }

  _export_post_convert(state: unknown, root: unknown): GodotGLTFExtensionResult {
    return this.call('_export_post_convert', [state, root]);
  }

  _export_preserialize(state: unknown): GodotGLTFExtensionResult {
    return this.call('_export_preserialize', [state]);
  }

  _export_object_model_property(state: unknown, nodePath: unknown, godotNode: unknown, gltfNodeIndex: number, targetObject: unknown, targetDepth: number): GodotGLTFExtensionResult {
    return this.call('_export_object_model_property', [state, nodePath, godotNode, gltfNodeIndex, targetObject, targetDepth]);
  }

  _get_saveable_image_formats(): GodotGLTFExtensionResult {
    return this.call('_get_saveable_image_formats', []);
  }

  _serialize_image_to_bytes(state: unknown, image: unknown, imageDict: Readonly<Record<string, unknown>>, imageFormat: string, lossyQuality: number): GodotGLTFExtensionResult {
    return this.call('_serialize_image_to_bytes', [state, image, imageDict, imageFormat, lossyQuality]);
  }

  _save_image_at_path(state: unknown, image: unknown, filePath: string, imageFormat: string, lossyQuality: number): GodotGLTFExtensionResult {
    return this.call('_save_image_at_path', [state, image, filePath, imageFormat, lossyQuality]);
  }

  _serialize_texture_json(state: unknown, textureJson: Readonly<Record<string, unknown>>, gltfTexture: unknown, imageFormat: string): GodotGLTFExtensionResult {
    return this.call('_serialize_texture_json', [state, textureJson, gltfTexture, imageFormat]);
  }

  _export_node(state: unknown, gltfNode: unknown, json: Readonly<Record<string, unknown>>, node: unknown): GodotGLTFExtensionResult {
    return this.call('_export_node', [state, gltfNode, json, node]);
  }

  _export_post(state: unknown): GodotGLTFExtensionResult {
    return this.call('_export_post', [state]);
  }

  importDocument(context: GodotGLTFImportContext): GodotGLTFExtensionResult[] {
    const results = [
      this._import_preflight(context.state, context.extensions ?? []),
      this._import_post_parse(context.state),
      this._import_pre_generate(context.state),
    ];
    if (context.root !== undefined) results.push(this._import_post(context.state, context.root));
    return results;
  }

  exportDocument(context: GodotGLTFExportContext): GodotGLTFExtensionResult[] {
    return [
      this._export_preflight(context.state, context.root),
      this._export_post_convert(context.state, context.root),
      this._export_preserialize(context.state),
      this._export_post(context.state),
    ];
  }
}

export class GodotGLTFDocumentExtensionConvertImporterMesh {
  constructor(public importerMesh: unknown = null, public image: unknown = null) {}

  setImporterMesh(importerMesh: unknown): void { this.importerMesh = importerMesh; }
  getImporterMesh(): unknown { return this.importerMesh; }
  setImage(image: unknown): void { this.image = image; }
  getImage(): unknown { return this.image; }
}

export function createGodotGLTFDocumentExtension(carrier: GodotGLTFDocumentExtensionCarrier): GodotGLTFDocumentExtension {
  return new GodotGLTFDocumentExtension(carrier);
}
