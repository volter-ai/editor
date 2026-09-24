import { connectEvents } from './editor-api';
import { announceAssetReload, evictLoaderCaches } from '@volter/editor-sdk/kit/project-asset-refresh';

export interface AssetMovedEvent {
  oldPath: string;
  newPath: string;
  updatedFiles: string[];
}

export interface AssetsChangedEvent {
  readonly paths?: readonly string[];
}

/**
 * Connect to the editor server's SSE endpoint for asset events.
 * Returns a cleanup function to disconnect.
 */
export function connectAssetEvents(
  onAssetMoved: (event: AssetMovedEvent) => void,
  onAssetsChanged: (event: AssetsChangedEvent) => void = () => {},
): () => void {
  // Browser mode (Phase A2): no Node dev server / SSE. A rename can't be
  // reconstructed from self-derived watch events — a move surfaces as an
  // unlinked `remove` + `create` with no old→new pairing — so asset-move sync
  // stays a server-only signal (revisit with A4's external-change detection).
  const source = connectEvents();

  source.addEventListener('asset-moved', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as AssetMovedEvent;
      onAssetMoved(data);
    } catch {
      /* ignore malformed events */
    }
  });
  source.addEventListener('assets-changed', async (event: MessageEvent) => {
    let detail: AssetsChangedEvent;
    try {
      detail = JSON.parse(event.data) as AssetsChangedEvent;
    } catch {
      detail = {};
    }
    const paths =
      detail.paths?.map((path) => `/${path.replace(/^\/?public\//, '').replace(/^\//, '')}`) ?? [];
    await evictLoaderCaches(paths);
    announceAssetReload(paths);
    onAssetsChanged(detail);
  });

  return () => source.close();
}

export function connectToolFileEvents(onChanged: () => void): () => void {
  const source = connectEvents();
  source.addEventListener('tool-files-changed', () => onChanged());
  return () => source.close();
}

/** Root declarations affect project configuration and adapter capabilities. */
export function connectProjectDeclarationEvents(onChanged: () => void): () => void {
  const source = connectEvents();
  source.addEventListener('project-declarations-changed', onChanged);
  return () => source.close();
}

/**
 * Connect to the editor server's SSE endpoint for project STORY file
 * add/unlink events (C3, spec §9). Mirrors `connectToolFileEvents` for
 * `*.stories.tsx` / `*.stories.ts` anywhere under `src/` — the React hierarchy's
 * `refreshProjectStories()` is a cheap full rescan, same discipline as
 * `refreshProjectTools`.
 */
/**
 * The editor server's `source-files-changed`: any `src/` file that is neither
 * a tool nor a story — the files contributed FINDERS read (a models project's
 * `src/models/*.ts`). Carries the project-relative path; the browser lane
 * cannot name one and reports `''`.
 */
export function connectSourceFileEvents(onChanged: (path: string) => void): () => void {
  const source = connectEvents();
  source.addEventListener('source-files-changed', (event) => {
    let path = '';
    try {
      path = String((JSON.parse((event as MessageEvent).data) as { path?: string }).path ?? '');
    } catch {
      /* a payload without a path still means "something changed" */
    }
    onChanged(path);
  });
  return () => source.close();
}

export function connectStoryFileEvents(onChanged: () => void): () => void {
  const source = connectEvents();
  source.addEventListener('story-files-changed', () => onChanged());
  return () => source.close();
}
