import type { StorageBackend } from '@volter/editor-sdk/kit/storage-types';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import type { AssetHealth, AssetHealthCode } from './asset-types';

export interface ProjectAssetFileSnapshot {
  readonly path: string;
  readonly text?: string;
}

export interface ProjectAssetReference {
  readonly ownerPath: string;
  readonly jsonPath: string;
  readonly assetPath: string;
}

export interface ProjectAssetHealthResult {
  readonly health: AssetHealth;
  readonly dependencies: readonly string[];
  readonly references: readonly ProjectAssetReference[];
}

function collectStringPaths(value: unknown, path = '$'): { path: string; value: string }[] {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    collectStringPaths(entry, `${path}.${key}`),
  );
}

function externalDependencies(assetPath: string, text: string | undefined): string[] {
  if (!text || !assetPath.toLowerCase().endsWith('.gltf')) return [];
  try {
    const json = JSON.parse(text) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    const base = assetPath.includes('/') ? assetPath.slice(0, assetPath.lastIndexOf('/') + 1) : '';
    return [...(json.buffers ?? []), ...(json.images ?? [])].flatMap((entry) =>
      entry.uri && !entry.uri.startsWith('data:') ? [`${base}${entry.uri}`] : [],
    );
  } catch {
    return [];
  }
}

export function inspectProjectAssetHealth(input: {
  readonly assetPath: string;
  readonly files: readonly ProjectAssetFileSnapshot[];
}): ProjectAssetHealthResult {
  const byPath = new Map(input.files.map((file) => [file.path.replace(/^\//, ''), file]));
  const assetPath = input.assetPath.replace(/^\//, '');
  const asset = byPath.get(assetPath);
  const codes = new Set<AssetHealthCode>();
  const capability = assetCapabilities(assetPath);
  if (!asset) codes.add('missing-file');
  if (!capability.importable) codes.add('unsupported-format');
  else if (!capability.runtimeReady) codes.add('source-only');

  if (asset?.text && capability.kind === 'json') {
    try {
      JSON.parse(asset.text);
    } catch {
      codes.add('invalid-metadata');
    }
  }

  const dependencies = externalDependencies(assetPath, asset?.text);
  if (dependencies.some((path) => !byPath.has(path))) codes.add('missing-dependency');
  // Catalog attribution is project-authoring state in .vgai/provenance.json,
  // outside this public/-rooted storage snapshot. Do not infer it is missing
  // from the deliberate absence of a legacy per-directory sidecar.

  const references: ProjectAssetReference[] = [];
  for (const file of input.files) {
    // JSON is a common structured container, not a vgai material dialect.
    // Walk any JSON document supplied by the project snapshot and report the
    // exact path of a matching asset reference.
    if (!file.text || !/\.json$/i.test(file.path)) continue;
    try {
      for (const candidate of collectStringPaths(JSON.parse(file.text))) {
        const normalized = candidate.value.replace(/^\//, '');
        if (normalized === assetPath) {
          references.push({ ownerPath: file.path, jsonPath: candidate.path, assetPath });
        } else if (normalized.startsWith('assets/') && !byPath.has(normalized)) {
          codes.add('broken-asset-reference');
        }
      }
    } catch {}
  }

  if (codes.size === 0) codes.add('healthy');
  const errorCodes = new Set<AssetHealthCode>([
    'missing-file',
    'missing-dependency',
    'invalid-metadata',
    'broken-asset-reference',
  ]);
  return {
    health: {
      status: [...codes].some((code) => errorCodes.has(code))
        ? 'error'
        : codes.has('healthy')
          ? 'healthy'
          : 'warning',
      codes: [...codes],
    },
    dependencies,
    references,
  };
}

async function snapshotProjectFiles(
  backend: StorageBackend,
  dir = '',
): Promise<ProjectAssetFileSnapshot[]> {
  const entries = await backend.list(dir);
  const snapshots: ProjectAssetFileSnapshot[] = [];
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.type === 'dir') {
      snapshots.push(...(await snapshotProjectFiles(backend, path)));
    } else if (/\.json$|\.gltf$/i.test(path)) {
      snapshots.push({ path, text: await backend.read(path) });
    } else {
      snapshots.push({ path });
    }
  }
  return snapshots;
}

export async function inspectProjectAssetHealthFromStorage(
  backend: StorageBackend,
  assetPath: string,
): Promise<ProjectAssetHealthResult> {
  return inspectProjectAssetHealth({
    assetPath,
    files: await snapshotProjectFiles(backend),
  });
}
