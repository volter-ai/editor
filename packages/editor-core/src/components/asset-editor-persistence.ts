import {
  type AppliedAssetImportHistory,
  captureProjectAssetHistory,
  type DownloadOnlineAssetResult,
  downloadOnlineAsset,
  restoreProjectAssetHistory,
} from '../api/assets';
import { sha256Hex } from '../bytes-codec';
import type { HistoryService } from '../history/history-service';
import { getProjectFileHistory } from '../history/project-file-history';
import type { ResourceDriver, ResourceKind } from '../history/types';
import { getStorageBackend } from '../storage';
import { workspaceHistoryService } from './workspace-history';

interface ImportedAssetHistoryResource {
  driver: ResourceDriver;
  revision: number;
}

const importedAssetHistoryResources = new WeakMap<
  HistoryService,
  Map<string, ImportedAssetHistoryResource>
>();

function notifyAssetChanged(assetPath: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('editor:assets-changed', {
      detail: { paths: [projectAssetPath(assetPath)] },
    }),
  );
  window.dispatchEvent(
    new CustomEvent('editor:asset-mutation', {
      detail: { type: 'change', paths: [projectAssetPath(assetPath)] },
    }),
  );
}

function importedAssetHistoryResource(
  history: HistoryService,
  assetPath: string,
): ImportedAssetHistoryResource {
  const normalized = projectAssetPath(assetPath);
  let resources = importedAssetHistoryResources.get(history);
  if (!resources) {
    resources = new Map();
    importedAssetHistoryResources.set(history, resources);
  }
  const existing = resources.get(normalized);
  if (existing) return existing;
  const descriptor = history.registry.registerProject(
    'project-file',
    `.vgai/history/imported-assets/${normalized}`,
    normalized.split('/').pop(),
  );
  const resource: ImportedAssetHistoryResource = {
    revision: 0,
    driver: undefined as unknown as ResourceDriver,
  };
  const capture = async () => {
    const token = await captureProjectAssetHistory(normalized);
    const bytes = new TextEncoder().encode(token);
    return {
      revision: resource.revision,
      contentType: 'application/vnd.vgai.asset-history-token',
      bytes,
      sha256: await sha256Hex(bytes),
    };
  };
  resource.driver = {
    descriptor,
    capture,
    preflight: async (expected) => {
      const current = await capture();
      return current.sha256 === expected.sha256
        ? { ok: true }
        : {
            ok: false,
            reason: 'content-conflict',
            actualRevision: resource.revision,
            actualSha256: current.sha256,
          };
    },
    restore: async (snapshot) => {
      const token = new TextDecoder().decode(history.snapshots.read(snapshot).bytes);
      await restoreProjectAssetHistory(normalized, token);
      resource.revision++;
      notifyAssetChanged(normalized);
    },
    estimateBytes: (snapshot) => snapshot.byteLength,
  };
  history.registerDriver(resource.driver);
  resources.set(normalized, resource);
  return resource;
}

function historyTokenBytes(token: string): Uint8Array {
  return new TextEncoder().encode(token);
}

/** Journal already-committed server acquisitions as one exact project transaction. */
export async function recordAppliedAssetImportsWithHistory(
  imports: readonly AppliedAssetImportHistory[],
  label: string,
): Promise<void> {
  if (imports.length === 0) return;
  const history = workspaceHistoryService();
  if (!history) return;
  const resources = imports.map((entry) => ({
    entry,
    resource: importedAssetHistoryResource(history, entry.assetPath),
  }));
  try {
    await history.recordAppliedTransaction(
      {
        label,
        detail: imports.map((entry) => projectAssetPath(entry.assetPath)).join(', '),
        resources: resources.map(({ resource }) => resource.driver.descriptor.key),
        scope: 'project',
      },
      resources.map(({ entry, resource }) => ({
        resource: resource.driver.descriptor.key,
        beforeBytes: historyTokenBytes(entry.beforeToken),
        afterBytes: historyTokenBytes(entry.afterToken),
        contentType: 'application/vnd.vgai.asset-history-token',
      })),
    );
  } catch (error) {
    const compensation = await Promise.allSettled(
      imports.map((entry) => restoreProjectAssetHistory(entry.assetPath, entry.beforeToken)),
    );
    for (const entry of imports) notifyAssetChanged(entry.assetPath);
    const compensationFailure = compensation.find((result) => result.status === 'rejected');
    if (compensationFailure?.status === 'rejected') {
      throw new Error(
        `Project history could not record undo/redo and rollback failed: ${compensationFailure.reason instanceof Error ? compensationFailure.reason.message : String(compensationFailure.reason)}`,
      );
    }
    throw new Error(
      `Assets were rolled back because project history could not record undo/redo: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Acquire one catalog asset and add the committed mutation to project history. */
export async function downloadOnlineAssetWithHistory(
  params: Parameters<typeof downloadOnlineAsset>[0],
  label = `Import ${params.name}`,
): Promise<DownloadOnlineAssetResult> {
  const result = await downloadOnlineAsset(params);
  if (result.ok && result.history) {
    await recordAppliedAssetImportsWithHistory([result.history], label);
  }
  return result;
}

/** Convert an asset's public serving URL into the StorageBackend path. */
export function projectAssetPath(assetPath: string): string {
  const path = assetPath.split(/[?#]/, 1)[0]!.replace(/^\/+/, '');
  if (!path) throw new Error('Project asset path cannot be empty.');
  return path;
}

/** Persist one authored asset through the project-wide undo history. */
export async function writeProjectAsset(
  assetPath: string,
  content: string,
  options: { label: string; kind: ResourceKind },
): Promise<boolean> {
  const path = projectAssetPath(assetPath);
  const history = workspaceHistoryService();
  const ok = history
    ? await getProjectFileHistory(history).write(path, content, {
        label: options.label,
        kind: options.kind,
        contentType: 'application/json',
      })
    : await getStorageBackend()
        .write(path, content)
        .then(() => true);
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('editor:assets-changed'));
  }
  return ok;
}

/** Refresh an open editor after undo/redo or another surface writes its file. */
export function subscribeProjectAsset(assetPath: string, listener: () => void): () => void {
  const history = workspaceHistoryService();
  const path = projectAssetPath(assetPath);
  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      listener();
    });
  };
  const unsubscribeHistory = history
    ? getProjectFileHistory(history).subscribeAll((changedPath) => {
        if (changedPath === path) notify();
      })
    : () => {};
  const onAssetChanged = (event: Event) => {
    const paths = (event as CustomEvent<{ paths?: readonly string[] }>).detail?.paths;
    if (!paths || paths.some((candidate) => projectAssetPath(candidate) === path)) notify();
  };
  if (typeof window !== 'undefined')
    window.addEventListener('editor:assets-changed', onAssetChanged);
  return () => {
    unsubscribeHistory();
    if (typeof window !== 'undefined')
      window.removeEventListener('editor:assets-changed', onAssetChanged);
  };
}
