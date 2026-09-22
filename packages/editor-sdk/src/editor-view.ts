import type { AssetKind, EditorCameraState, EditorView, ViewPreset } from './types.js';
import { EDITOR_VIEW_WORKSPACE_DOCUMENT_IDS, isEditorViewUtility } from './types.js';

const PREFIX = 'view.';
const MAX_QUERY_LENGTH = 4096;
const WORKSPACE_DOCUMENT_IDS = new Set<string>(EDITOR_VIEW_WORKSPACE_DOCUMENT_IDS);
const ASSET_KINDS = new Set<AssetKind>([
  'model',
  'image',
  'audio',
  'animation',
  'json',
  'prefab',
  'source',
]);
const CAMERAS = new Set<ViewPreset | 'isometric'>([
  'top',
  'front',
  'right',
  'perspective',
  'isometric',
]);
type EditorViewDiagnostic = NonNullable<NonNullable<EditorView['viewport']>['diagnostic']>;
const DIAGNOSTICS = new Set<EditorViewDiagnostic>([
  'solid',
  'unlit',
  'wireframe',
  'normals',
  'overdraw',
  'uv',
  'vertex-colors',
  'bounds',
  'skeleton',
]);
function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function writeDocument(params: URLSearchParams, document: EditorView['document']): void {
  if (!document) return;
  params.set(`${PREFIX}docKind`, document.kind);
  if (document.kind === 'asset' && document.entityId) {
    params.set(`${PREFIX}doc`, document.entityId);
    params.set(`${PREFIX}assetSource`, 'entity');
  } else if (document.kind === 'asset') {
    params.set(`${PREFIX}doc`, document.path!);
  } else if (document.kind === 'scene') {
    params.set(`${PREFIX}doc`, document.path);
  } else if (document.kind === 'story') {
    params.set(`${PREFIX}doc`, document.modulePath);
    params.set(`${PREFIX}story`, document.storyName);
    if (document.mode === 'docs') params.set(`${PREFIX}storyMode`, 'docs');
  } else if (document.kind === 'project-tool') {
    params.set(`${PREFIX}doc`, document.name);
  } else {
    params.set(`${PREFIX}doc`, document.id);
  }
  if (document.kind === 'asset' && document.assetKind) {
    params.set(`${PREFIX}assetKind`, document.assetKind);
  }
}

function writeViewport(params: URLSearchParams, viewport: EditorView['viewport']): void {
  if (!viewport) return;
  if (typeof viewport.camera === 'string') params.set(`${PREFIX}camera`, viewport.camera);
  else if (viewport.camera) {
    params.set(`${PREFIX}camera`, 'pose');
    params.set(
      `${PREFIX}cameraPosition`,
      [viewport.camera.position.x, viewport.camera.position.y, viewport.camera.position.z].join(
        ',',
      ),
    );
    params.set(
      `${PREFIX}cameraTarget`,
      [viewport.camera.target.x, viewport.camera.target.y, viewport.camera.target.z].join(','),
    );
    if (viewport.camera.fov !== undefined)
      params.set(`${PREFIX}cameraFov`, String(viewport.camera.fov));
  }
  if (viewport.diagnostic) params.set(`${PREFIX}diagnostic`, viewport.diagnostic);
  if (viewport.frame) params.set(`${PREFIX}frame`, viewport.frame);
  if (viewport.grid !== undefined) params.set(`${PREFIX}grid`, viewport.grid ? '1' : '0');
}

function parseVec3(value: string | null): EditorCameraState['position'] | null {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
}

function parseCamera(params: URLSearchParams): NonNullable<EditorView['viewport']>['camera'] {
  const camera = params.get(`${PREFIX}camera`);
  if (camera && CAMERAS.has(camera as ViewPreset | 'isometric')) {
    return camera as ViewPreset | 'isometric';
  }
  if (camera !== 'pose') return undefined;
  const position = parseVec3(params.get(`${PREFIX}cameraPosition`));
  const target = parseVec3(params.get(`${PREFIX}cameraTarget`));
  const fovValue = params.get(`${PREFIX}cameraFov`);
  const fov = fovValue === null ? undefined : Number(fovValue);
  if (!position || !target || (fov !== undefined && !Number.isFinite(fov))) return undefined;
  return { position, target, ...(fov !== undefined ? { fov } : {}) };
}

function parseStoryDocument(params: URLSearchParams, modulePath: string): EditorView['document'] {
  const storyName = nonEmpty(params.get(`${PREFIX}story`));
  if (!storyName) return undefined;
  return {
    kind: 'story',
    modulePath,
    storyName,
    ...(params.get(`${PREFIX}storyMode`) === 'docs' ? { mode: 'docs' as const } : {}),
  };
}

function parseAssetDocument(params: URLSearchParams, value: string): EditorView['document'] {
  const assetKind = params.get(`${PREFIX}assetKind`);
  if (params.get(`${PREFIX}assetSource`) === 'entity') {
    return { kind: 'asset', entityId: value, assetKind: 'model' };
  }
  return {
    kind: 'asset',
    path: value,
    ...(assetKind && ASSET_KINDS.has(assetKind as AssetKind)
      ? { assetKind: assetKind as AssetKind }
      : {}),
  };
}

function parseDocument(params: URLSearchParams): EditorView['document'] {
  const kind = params.get(`${PREFIX}docKind`);
  const value = nonEmpty(params.get(`${PREFIX}doc`));
  if (!value) return undefined;
  if (kind === 'scene') return { kind, path: value };
  if (kind === 'tool') return { kind, id: value };
  if (kind === 'document') return { kind, id: value };
  if (kind === 'world') return { kind, id: value };
  if (kind === 'project-tool') return { kind, name: value };
  if (kind === 'generation') return { kind, id: value };
  if (kind === 'story') return parseStoryDocument(params, value);
  if (kind === 'workspace' && WORKSPACE_DOCUMENT_IDS.has(value)) {
    return {
      kind,
      id: value as Extract<NonNullable<EditorView['document']>, { kind: 'workspace' }>['id'],
    };
  }
  return kind === 'asset' ? parseAssetDocument(params, value) : undefined;
}

function parseViewport(params: URLSearchParams): EditorView['viewport'] {
  const camera = parseCamera(params);
  const diagnostic = params.get(`${PREFIX}diagnostic`);
  const frame = params.get(`${PREFIX}frame`);
  const grid = params.get(`${PREFIX}grid`);
  const viewport = {
    ...(camera ? { camera } : {}),
    ...(diagnostic && DIAGNOSTICS.has(diagnostic as EditorViewDiagnostic)
      ? { diagnostic: diagnostic as EditorViewDiagnostic }
      : {}),
    ...(frame === 'document' || frame === 'selection'
      ? { frame: frame as 'document' | 'selection' }
      : {}),
    ...(grid === '0' || grid === '1' ? { grid: grid === '1' } : {}),
  };
  return Object.keys(viewport).length > 0 ? viewport : undefined;
}

/** Apply only the view-owned query parameters, preserving project/scene routing params. */
export function editorViewUrl(view: EditorView, baseUrl: string | URL): string {
  const url = new URL(baseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(PREFIX)) url.searchParams.delete(key);
  }
  url.searchParams.set(`${PREFIX}v`, '1');
  writeDocument(url.searchParams, view.document);
  if (view.selection?.ids.length) {
    for (const id of view.selection.ids) url.searchParams.append(`${PREFIX}select`, id);
    if (view.selection.focus) url.searchParams.set(`${PREFIX}focus`, '1');
  }
  writeViewport(url.searchParams, view.viewport);
  if (view.workspace) url.searchParams.set(`${PREFIX}workspace`, view.workspace);
  if (view.panel) url.searchParams.set(`${PREFIX}panel`, view.panel);
  if (view.utility) url.searchParams.set(`${PREFIX}utility`, view.utility);
  if (url.search.length > MAX_QUERY_LENGTH) {
    throw new Error(`Editor view URL exceeds the ${MAX_QUERY_LENGTH}-character share limit.`);
  }
  return url.toString();
}

/** Parse a shareable editor projection. Malformed projections are ignored at boot. */
export function editorViewFromUrl(value: string | URL): EditorView | null {
  const url = value instanceof URL ? value : new URL(value, 'http://editor.invalid');
  const params = url.searchParams;
  if (params.get(`${PREFIX}v`) !== '1') return null;
  const view: EditorView = { version: 1 };
  const document = parseDocument(params);
  if (document) view.document = document;
  const ids = params
    .getAll(`${PREFIX}select`)
    .filter((id) => id.length > 0)
    .slice(0, 32);
  if (ids.length) view.selection = { ids, focus: params.get(`${PREFIX}focus`) === '1' };
  const viewport = parseViewport(params);
  if (viewport) view.viewport = viewport;
  // Shape check only: a `tool:` id names a utility the OPEN PROJECT
  // contributes, so the URL cannot know whether it exists. The editor
  // validates it against its live registry when the view is presented.
  const workspace = params.get(`${PREFIX}workspace`);
  if (workspace) view.workspace = workspace;
  // Shape check only, like `workspace` above: which panels exist is the open
  // editor's registry, and it answers at present-time.
  const panel = params.get(`${PREFIX}panel`);
  if (panel) view.panel = panel;
  const utility = params.get(`${PREFIX}utility`);
  if (utility && isEditorViewUtility(utility)) view.utility = utility;
  return view;
}
