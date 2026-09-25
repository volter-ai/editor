import type { HistoryService } from '@volter/editor-sdk/kit/history/history-service';
import { getProjectFileHistory } from '@volter/editor-sdk/kit/history/project-file-history';
import type { StorageBackend } from '@volter/editor-sdk/kit/storage-types';

export type ProjectAssetOperation =
  | { readonly type: 'create-folder'; readonly path: string }
  | { readonly type: 'duplicate'; readonly source: string; readonly destination: string }
  | { readonly type: 'move'; readonly source: string; readonly destination: string }
  | {
      readonly type: 'move-many';
      readonly moves: readonly { readonly source: string; readonly destination: string }[];
    }
  | { readonly type: 'delete'; readonly paths: readonly string[] }
  | { readonly type: 'import'; readonly files: readonly { path: string; bytes: Uint8Array }[] };

/** Announce a project asset write. Every consumer of `editor:assets-changed`
 *  keys off this — the panel listing, and the public-asset blob bridge that
 *  makes a newly written file loadable by its own URL. Exported because
 *  writes also happen OUTSIDE the operation union (the browser asset
 *  library's own download path). */
export function emitAssetMutation(detail: {
  type: 'move' | 'delete' | 'change';
  oldPath?: string;
  newPath?: string;
  paths?: readonly string[];
}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('editor:asset-mutation', { detail }));
  window.dispatchEvent(new CustomEvent('editor:assets-changed'));
}

function validPath(path: string): string {
  const normalized = path
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.split('/').some((part) => !part || part === '..')
  ) {
    throw new Error(`Invalid project asset path: ${path}`);
  }
  return normalized;
}

async function assertDestinationsFree(backend: StorageBackend, paths: readonly string[]) {
  for (const path of paths) {
    if (await backend.exists(path)) throw new Error(`An asset already exists at ${path}.`);
  }
}

/** Executes all writes through exact-byte project history; no UI owns filesystem mutation. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the tagged operation union is intentionally centralized so every project mutation shares one atomic history boundary.
export async function executeProjectAssetOperation(
  operation: ProjectAssetOperation,
  dependencies: { readonly backend: StorageBackend; readonly history: HistoryService },
): Promise<boolean> {
  const files = getProjectFileHistory(dependencies.history, dependencies.backend);
  switch (operation.type) {
    case 'create-folder': {
      const folder = validPath(operation.path);
      const marker = `${folder}/.vgai-folder`;
      if (await dependencies.backend.exists(folder))
        throw new Error(`Folder already exists: ${folder}.`);
      return files.write(marker, '', { label: `Create folder ${folder}` });
    }
    case 'duplicate': {
      const source = validPath(operation.source);
      const destination = validPath(operation.destination);
      await assertDestinationsFree(dependencies.backend, [destination]);
      const bytes = await dependencies.backend.readBytes(source);
      return files.write(destination, bytes, { label: `Duplicate ${source}` });
    }
    case 'move': {
      const source = validPath(operation.source);
      const destination = validPath(operation.destination);
      await assertDestinationsFree(dependencies.backend, [destination]);
      const bytes = await dependencies.backend.readBytes(source);
      const changes = new Map<string, string | Uint8Array | null>([
        [destination, bytes],
        [source, null],
      ]);
      const changed = await files.mutate(
        [...changes].map(([path, data]) => ({ path, data })),
        { label: `Move ${source}` },
      );
      if (changed) emitAssetMutation({ type: 'move', oldPath: source, newPath: destination });
      return changed;
    }
    case 'move-many': {
      const moves = operation.moves.map((move) => ({
        source: validPath(move.source),
        destination: validPath(move.destination),
      }));
      if (moves.length === 0) return false;
      const sources = new Set(moves.map((move) => move.source));
      const destinations = moves.map((move) => move.destination);
      if (new Set(destinations).size !== destinations.length) {
        throw new Error('Batch move destinations must be unique.');
      }
      for (const destination of destinations) {
        if (!sources.has(destination) && (await dependencies.backend.exists(destination))) {
          throw new Error(`An asset already exists at ${destination}.`);
        }
      }
      const payloads = await Promise.all(
        moves.map(async (move) => ({
          ...move,
          bytes: await dependencies.backend.readBytes(move.source),
        })),
      );
      const changes = new Map<string, string | Uint8Array | null>();
      for (const { destination, bytes } of payloads) changes.set(destination, bytes);
      for (const { source } of payloads) {
        if (!destinations.includes(source)) changes.set(source, null);
      }
      const changed = await files.mutate(
        [...changes].map(([path, data]) => ({ path, data })),
        { label: `Move ${moves.length} assets` },
      );
      if (changed) {
        for (const move of moves) {
          emitAssetMutation({ type: 'move', oldPath: move.source, newPath: move.destination });
        }
      }
      return changed;
    }
    case 'delete': {
      const paths = [...new Set(operation.paths.map(validPath))];
      const changed = await files.mutate(
        paths.map((path) => ({ path, data: null })),
        { label: `Delete ${paths.length} asset${paths.length === 1 ? '' : 's'}` },
      );
      if (changed) emitAssetMutation({ type: 'delete', paths });
      return changed;
    }
    case 'import': {
      const imported = operation.files.map((file) => ({
        path: validPath(file.path),
        data: file.bytes,
      }));
      await assertDestinationsFree(
        dependencies.backend,
        imported.map((file) => file.path),
      );
      const changed = await files.mutate(imported, {
        label: `Import ${imported.length} asset${imported.length === 1 ? '' : 's'}`,
      });
      if (changed) emitAssetMutation({ type: 'change', paths: imported.map((file) => file.path) });
      return changed;
    }
  }
}
