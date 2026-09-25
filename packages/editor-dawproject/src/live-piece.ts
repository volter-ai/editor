/**
 * THE LIVE PIECE: the module's default export mounted with `@volter/dawproject`'s renderer and
 * re-mounted whenever the project's source changes, whoever changed it (the agent writing the
 * piece, a person in the text editor, a gesture in this document). The graph that comes back is
 * the piece as it currently sounds.
 *
 * Every re-import asks for a fresh module URL, because an ES module is evaluated once per URL;
 * the served graph under it is the dev server's, which already invalidates what changed.
 */

import type { DawNode } from '@volter/dawproject/render';
import { createPieceRoot } from '@volter/dawproject/render';
import { type Piece, readPiece } from '@volter/dawproject/piece';
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { subscribeCollaborationRevision } from '@volter/editor-sdk/kit/collaboration-client';
import { subscribeProjectModuleChange } from '@volter/editor-sdk/kit/project-module-changes';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

export interface LivePiece {
  readonly piece: Piece | null;
  readonly graph: DawNode | null;
  readonly error: string | null;
  /** Increments on every committed render; a change marker for dependent reads. */
  readonly revision: number;
}

let importCounter = 0;

async function importPiece(file: string): Promise<ComponentType> {
  const url = projectModuleUrl(file);
  if (!url) throw new Error(`This host serves no address for ${file}.`);
  url.searchParams.set('piece', String(++importCounter));
  const module = (await import(/* @vite-ignore */ url.href)) as Record<string, unknown>;
  const piece = module['default'];
  if (typeof piece !== 'function') {
    throw new Error(`${file} has no default export component; a piece default-exports the component that renders its <Project>.`);
  }
  return piece as ComponentType;
}

export function useLivePiece(file: string): LivePiece {
  const [state, setState] = useState<LivePiece>({ piece: null, graph: null, error: null, revision: 0 });

  useEffect(() => {
    let disposed = false;
    const root = createPieceRoot((error) => {
      if (!disposed) setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    });
    const unsubscribeRoot = root.subscribe((graph) => {
      if (disposed || !graph) return;
      try {
        const piece = readPiece(graph);
        setState((prev) => ({ piece, graph, error: null, revision: prev.revision + 1 }));
      } catch (error) {
        setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    let loading: Promise<void> = Promise.resolve();
    const load = (): void => {
      loading = loading.then(async () => {
        try {
          const component = await importPiece(file);
          if (!disposed) await root.render(component);
        } catch (error) {
          if (!disposed) setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    };
    load();
    // Any saved project module may be one the piece imports (a helper, a shared chord table),
    // so every save re-mounts; the renderer diffs, so an unchanged piece commits nothing new.
    const unsubscribeChanges = subscribeProjectModuleChange(() => load());
    // The session's source revisions, over the collaboration stream: every edit by anyone
    // (the agent, another participant, this document) advances it. Subscribing also keeps this
    // page's write attribution at the current revision, so a gesture after the agent's last edit
    // is not refused as stale.
    const unsubscribeRevisions = subscribeCollaborationRevision(() => load());
    return () => {
      disposed = true;
      unsubscribeChanges();
      unsubscribeRevisions();
      unsubscribeRoot();
      root.unmount();
    };
  }, [file]);

  return state;
}
