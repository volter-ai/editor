export type AssetFormat =
  | 'glb'
  | 'gltf'
  | 'fbx'
  | 'obj'
  | 'dae'
  | 'stl'
  | 'ply'
  | 'spz'
  | '3ds'
  | 'bvh'
  | 'blend'
  | 'usd'
  | 'usda'
  | 'usdc'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'gif'
  | 'svg'
  | 'hdr'
  | 'exr'
  | 'mp4'
  | 'webm'
  | 'mp3'
  | 'ogg'
  | 'wav'
  | 'flac'
  | 'cube'
  | 'glsl'
  | 'vert'
  | 'frag'
  | 'ts'
  | 'tsx'
  | 'js'
  | 'jsx'
  | 'css'
  | 'html'
  | 'md'
  | 'txt'
  | 'mtl'
  | 'csv'
  | 'xml'
  | 'yaml'
  | 'yml'
  | 'inputmap.json'
  | 'data.json'
  | 'json'
  | 'unknown';

export type AssetImportStrategy =
  | 'copy-runtime'
  | 'convert-model'
  | 'animation-source'
  | 'copy-project'
  | 'unsupported';

export type AssetCapabilityKind =
  | 'model'
  | 'image'
  | 'video'
  | 'audio'
  | 'json'
  | 'prefab'
  | 'source'
  | 'unknown';

export interface AssetCapabilities {
  readonly format: AssetFormat;
  readonly kind: AssetCapabilityKind;
  readonly previewable: boolean;
  readonly importable: boolean;
  readonly runtimeReady: boolean;
  readonly placeable: boolean;
  readonly animated: boolean;
  readonly importStrategy: AssetImportStrategy;
  readonly editor:
    | 'model'
    | 'image'
    | 'environment'
    | 'video'
    | 'audio'
    | 'data'
    | 'source'
    | 'none';
}

const MODEL_PREVIEW_FORMATS = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'stl', 'ply', '3ds'] as const;
const SOURCE_MODEL_FORMATS = ['blend', 'usd', 'usda', 'usdc'] as const;
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] as const;
const HIGH_DYNAMIC_RANGE_FORMATS = ['hdr', 'exr'] as const;
const AUDIO_FORMATS = ['mp3', 'ogg', 'wav', 'flac'] as const;
/** Clip formats a browser plays natively. Reference material (a generated
 *  motion study, a captured plate) is the common case, and a video is NOT a
 *  runtime-ready game asset: nothing in a scene places one, so `placeable`
 *  and `runtimeReady` stay false and the row's whole job is to be seen. */
const VIDEO_FORMATS = ['mp4', 'webm'] as const;
const COLOR_GRADE_FORMATS = ['cube'] as const;
const SHADER_SOURCE_FORMATS = ['glsl', 'vert', 'frag'] as const;
const TEXT_SOURCE_FORMATS = [
  'txt',
  'md',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'mtl',
  'csv',
  'xml',
  'yaml',
  'yml',
] as const;

function row(
  format: AssetFormat,
  values: Omit<AssetCapabilities, 'format'>,
): readonly [AssetFormat, AssetCapabilities] {
  return [format, { format, ...values }];
}

const MODEL_SOURCE_BASE = {
  kind: 'source',
  previewable: true,
  importable: true,
  runtimeReady: false,
  placeable: false,
  animated: false,
  importStrategy: 'convert-model',
  editor: 'model',
} as const;

export const ASSET_CAPABILITY_REGISTRY: ReadonlyMap<AssetFormat, AssetCapabilities> = new Map([
  ...MODEL_PREVIEW_FORMATS.map((format) =>
    row(format, {
      ...MODEL_SOURCE_BASE,
      kind: format === 'glb' || format === 'gltf' ? 'model' : 'source',
      runtimeReady: format === 'glb' || format === 'gltf',
      placeable: format === 'glb' || format === 'gltf',
      importStrategy: format === 'glb' || format === 'gltf' ? 'copy-runtime' : 'convert-model',
    }),
  ),
  row('spz', {
    kind: 'model',
    previewable: true,
    importable: true,
    runtimeReady: true,
    placeable: true,
    animated: false,
    importStrategy: 'copy-runtime',
    editor: 'model',
  }),
  row('bvh', {
    kind: 'source',
    previewable: true,
    importable: true,
    runtimeReady: false,
    placeable: false,
    animated: true,
    importStrategy: 'animation-source',
    editor: 'model',
  }),
  ...SOURCE_MODEL_FORMATS.map((format) =>
    row(format, { ...MODEL_SOURCE_BASE, previewable: false, editor: 'source' }),
  ),
  ...IMAGE_FORMATS.map((format) =>
    row(format, {
      kind: 'image',
      previewable: true,
      importable: true,
      runtimeReady: true,
      placeable: false,
      animated: format === 'gif',
      importStrategy: 'copy-project',
      editor: 'image',
    }),
  ),
  ...HIGH_DYNAMIC_RANGE_FORMATS.map((format) =>
    row(format, {
      kind: 'image',
      previewable: true,
      importable: true,
      runtimeReady: true,
      placeable: false,
      animated: false,
      importStrategy: 'copy-project',
      editor: 'environment',
    }),
  ),
  ...AUDIO_FORMATS.map((format) =>
    row(format, {
      kind: 'audio',
      previewable: true,
      importable: true,
      runtimeReady: true,
      placeable: false,
      animated: false,
      importStrategy: 'copy-project',
      editor: 'audio',
    }),
  ),
  ...VIDEO_FORMATS.map((format) =>
    row(format, {
      kind: 'video',
      previewable: true,
      importable: true,
      runtimeReady: false,
      placeable: false,
      animated: true,
      importStrategy: 'copy-project',
      editor: 'video',
    }),
  ),
  ...COLOR_GRADE_FORMATS.map((format) =>
    row(format, {
      kind: 'source',
      previewable: true,
      importable: true,
      runtimeReady: true,
      placeable: false,
      animated: false,
      importStrategy: 'copy-project',
      editor: 'source',
    }),
  ),
  ...SHADER_SOURCE_FORMATS.map((format) =>
    row(format, {
      kind: 'source',
      previewable: true,
      importable: true,
      runtimeReady: true,
      placeable: false,
      animated: false,
      importStrategy: 'copy-project',
      editor: 'source',
    }),
  ),
  ...TEXT_SOURCE_FORMATS.map((format) =>
    row(format, {
      kind: 'source',
      previewable: true,
      importable: true,
      runtimeReady: false,
      placeable: false,
      animated: false,
      importStrategy: 'copy-project',
      editor: 'source',
    }),
  ),
  row('inputmap.json', {
    kind: 'json',
    previewable: true,
    importable: true,
    runtimeReady: true,
    placeable: false,
    animated: false,
    importStrategy: 'copy-project',
    editor: 'data',
  }),
  row('data.json', {
    kind: 'json',
    previewable: true,
    importable: true,
    runtimeReady: true,
    placeable: false,
    animated: false,
    importStrategy: 'copy-project',
    editor: 'data',
  }),
  row('json', {
    kind: 'json',
    previewable: true,
    importable: true,
    runtimeReady: false,
    placeable: false,
    animated: false,
    importStrategy: 'copy-project',
    editor: 'data',
  }),
]);

const UNKNOWN_CAPABILITIES: AssetCapabilities = {
  format: 'unknown',
  kind: 'unknown',
  previewable: false,
  importable: false,
  runtimeReady: false,
  placeable: false,
  animated: false,
  importStrategy: 'unsupported',
  editor: 'none',
};

export function assetFormatFromPath(path: string): AssetFormat {
  const clean = path.split(/[?#]/, 1)[0]!.toLowerCase();
  for (const compound of ['inputmap.json', 'data.json'] as const) {
    if (clean.endsWith(`.${compound}`)) return compound;
  }
  const dot = clean.lastIndexOf('.');
  const extension = dot >= 0 ? clean.slice(dot + 1) : '';
  return ASSET_CAPABILITY_REGISTRY.has(extension as AssetFormat)
    ? (extension as AssetFormat)
    : extension === 'json'
      ? 'json'
      : 'unknown';
}

export function assetCapabilities(pathOrFormat: string): AssetCapabilities {
  const direct = ASSET_CAPABILITY_REGISTRY.get(pathOrFormat.toLowerCase() as AssetFormat);
  if (direct) return direct;
  return ASSET_CAPABILITY_REGISTRY.get(assetFormatFromPath(pathOrFormat)) ?? UNKNOWN_CAPABILITIES;
}

export function supportedAssetFormats(): readonly AssetFormat[] {
  return [...ASSET_CAPABILITY_REGISTRY.keys()];
}

/** Editor document kind for a capability row; null means no honest editor exists. */
export function assetDocumentKind(
  capability: AssetCapabilities,
): 'model' | 'image' | 'video' | 'audio' | 'json' | 'source' | null {
  switch (capability.editor) {
    case 'model':
      return 'model';
    case 'image':
      return 'image';
    case 'environment':
      // Workspace persistence needs only the broad asset kind. The path and
      // capability registry recover the native HDR/EXR viewer on restore.
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'data':
      return 'json';
    case 'source':
      return 'source';
    default:
      return null;
  }
}
