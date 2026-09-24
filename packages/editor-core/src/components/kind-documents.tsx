/**
 * KIND DOCUMENTS — an adapter-table document (a model, a page; ARCHITECTURE-CORE
 * §The project model, "Documents, not scenes") opened in the editor
 * registered for its kind (owner ruling, 2026-09-05: the tab IS the thing —
 * `cage`, kind Model — and the editor is chosen by the document's kind; code
 * is never a fallback, it opens only when code is opened).
 *
 * A `workspace.document` contribution declares `export const documentKind =
 * 'model'` (`tool-loader.ts`, `documentContributionForKind`). Opening a table
 * entry of that kind opens ONE document per entry — id `document:<entry id>`,
 * title = the entry's label — whose content, header and shelf are the
 * contribution's own components mounted through the same `ToolHost` a tool
 * document uses, with the entry handed over as `props.document`
 * (`ToolDocumentEntry`). Persisted and restored by the entry's id
 * (`workspace-state-persistence.ts`); presented in view links as
 * `{ kind: 'document', id }`. A kind with no registered editor opens nothing
 * here and the caller falls back to the entry's source, by its own choice.
 */

import type { ToolDocumentEntry } from '@volter/editor-sdk/contributions';
import { themeVars } from '@volter/editor-sdk/widgets';
import type { DocumentEntry } from '@volter/editor-project/adapter/adapter-module';
import { type ComponentType, useSyncExternalStore } from 'react';
import { setSelectedAsset } from '../asset-selection';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  awaitAnnouncedObject3DDocumentSession,
  waitForContributedDocumentMount,
} from '../document-context-registry';
import { registerDocumentOpener } from '../document-open-registry';
import type { AssetKind } from '../asset-selection';
import {
  projectAdapterFacet,
  type ResolvedDocumentTable,
  subscribeProjectAdapter,
} from '../project-adapter';
import {
  documentContributionForKind,
  getGlobalToolContributions,
  subscribeToolContributions,
} from '../tool-loader';
import { waitUntil } from '../wait-until';
import {
  type OpenWorkspaceDocumentOptions,
  openWorkspaceDocument,
  openWorkspaceDocuments,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '../workspace-document-restore';
import { openAssetDocument } from './asset-documents';
import { ToolHost } from './ToolHost';

const PREFIX = 'document:';

/** Stable identity for one table entry's document. */
export function kindDocumentId(entryId: string): string {
  return `${PREFIX}${entryId}`;
}

/** The table entry id a kind document id names, or `null` for another kind of id. */
export function kindDocumentEntryId(documentId: string): string | null {
  return documentId.startsWith(PREFIX) ? documentId.slice(PREFIX.length) : null;
}

/** The entries of every open kind document, by document id — what content,
 *  header and shelf mounts read, and what persistence records. */
const entries = new Map<
  string,
  { readonly entry: DocumentEntry; readonly props: ToolDocumentEntry }
>();

export function kindDocumentEntry(documentId: string): DocumentEntry | undefined {
  return entries.get(documentId)?.entry;
}

function asToolDocumentEntry(entry: DocumentEntry): ToolDocumentEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    ...(entry.source
      ? {
          source: {
            path: entry.source.path,
            ...(entry.source.export ? { export: entry.source.export } : {}),
          },
        }
      : {}),
  };
}

/**
 * What a table entry of a kind NOTHING edits opens as: the asset its source
 * already is. A module, or anything the asset routes do not know, opens as
 * source; a kind the routes DO know (a model, an image, a video) opens in its
 * own viewer. Before this, every unedited kind opened as source.
 */
export function uneditedKindAssetKind(entry: DocumentEntry): AssetKind {
  const path = entry.source?.path;
  if (!path) return 'source';
  const kind = assetCapabilities(path).kind;
  return kind === 'model' ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'audio' ||
    kind === 'json'
    ? kind
    : 'source';
}

/** Is there an editor registered for documents of `kind`? */
export function hasKindEditor(kind: string): boolean {
  return documentContributionForKind(kind) !== undefined;
}

/**
 * Open (or activate) the document for one table entry in the editor
 * registered for its kind. `false` (opens nothing) when no contribution
 * declares that kind — the caller decides what an unedited kind opens as.
 */
export function openKindDocument(
  entry: DocumentEntry,
  options: OpenWorkspaceDocumentOptions = {},
): boolean {
  const contribution = documentContributionForKind(entry.kind);
  if (!contribution) return false;
  const id = kindDocumentId(entry.id);
  entries.set(id, { entry, props: asToolDocumentEntry(entry) });
  openWorkspaceDocument(
    {
      id,
      // The tab is the THING: the entry's own label, never the editor's name.
      title: entry.label,
      kind: 'document',
      workspaceRole: 'authored-subject',
      provenance: {
        ...(entry.source ? { sourcePath: entry.source.path } : {}),
        origin: contribution.file,
      },
      Content: KindDocumentContent,
      ...(contribution.Toolbar ? { Toolbar: KindDocumentToolbar } : {}),
      ...(contribution.Shelf ? { Shelf: KindDocumentShelf } : {}),
      presentation: () => ({ kind: 'document', id: entry.id }),
      persist: () => ({ entryId: entry.id }),
      onDispose: (documentId) => {
        entries.delete(documentId);
      },
    },
    options,
  );
  return true;
}

/**
 * THE `document` ADDRESS (`document-open-registry.ts`) — the other half of the
 * `presentation()` above. An entry's id is the whole address; which editor
 * opens it, and what that document's id turns out to be, are this module's
 * rules and the presenter no longer holds either. Registered at module load,
 * the shape `packages/game/src/story-documents/three-story-documents.tsx:239`
 * uses.
 *
 * SETTLING is the two waits an explicit address needs, and they are separate
 * because they fail differently. The TABLE resolves more than once — a
 * contributed finder (the mesh capability's models finder) registers after the
 * first resolution and brings its entries — so a missing entry is not yet an
 * answer; and a kind's EDITOR arrives with the contribution pass, which on a
 * cold reload is well past the default window. Each refuses in its own words:
 * a table that lists no such document is a different defect from a kind
 * nothing can edit, and only this module can tell them apart.
 */
registerDocumentOpener<{ readonly id: string }>({
  id: 'document',
  owner: 'kind-documents',
  open: (_store, request) => {
    const entry = tableEntry(request.id);
    if (!entry || !hasKindEditor(entry.kind)) return null;
    return openKindDocument(entry) ? kindDocumentId(entry.id) : null;
  },
  settle: async (request) => {
    const REGISTRATION_WINDOW_MS = 20_000;
    await waitUntil(() => tableEntry(request.id) !== undefined, REGISTRATION_WINDOW_MS);
    const entry = tableEntry(request.id);
    if (!entry) throw new Error(`The project's document table lists no document: ${request.id}`);
    if (await waitUntil(() => hasKindEditor(entry.kind), REGISTRATION_WINDOW_MS)) return;
    throw new Error(
      `No editor is registered for documents of kind '${entry.kind}' (${request.id})`,
    );
  },
  /**
   * THE KIND'S OWN READINESS — a contributed document is ready to be driven
   * once its React root has committed and, if that root mounted a stage, once
   * the stage has registered its Object3D session. The presenter used to hold
   * this rule for this address by name (`editor-view-presentation.ts`'s
   * `kind === 'tool' || 'asset'`); it belongs here, where the contribution the
   * host mounted is what answers.
   */
  ready: async (documentId) => {
    await waitForContributedDocumentMount(documentId);
    await awaitAnnouncedObject3DDocumentSession(documentId);
  },
});

function tableEntry(id: string): DocumentEntry | undefined {
  return projectAdapterFacet()?.scenes.entries.find((candidate) => candidate.id === id);
}

/**
 * `openKindDocument` once the kind's editor is registered — now, or when the
 * contribution pass that brings it completes. A restored layout and a
 * shared view both name a document before the project's contributions have
 * loaded (measured 2026-09-05: the entry arrived, the editor had not, and
 * the document opened nothing). Gives up when the project changes under it.
 */
export function openKindDocumentWhenReady(
  entry: DocumentEntry,
  options: OpenWorkspaceDocumentOptions = {},
): void {
  if (openKindDocument(entry, options)) return;
  const stop = subscribeToolContributions(() => {
    if (openKindDocument(entry, options)) stop();
  });
}

/** Every open kind document takes its slots afresh when contributions
 *  change (a module re-evaluated on save may have gained or lost its
 *  `Toolbar`); `openWorkspaceDocument` on an open id refreshes the descriptor. */
export function installKindDocumentRefresh(): () => void {
  return subscribeToolContributions(() => {
    const open = new Set(openWorkspaceDocuments().map((d) => d.descriptor.id));
    for (const [id, { entry }] of entries) {
      if (!open.has(id)) continue;
      if (documentContributionForKind(entry.kind))
        openKindDocument(entry, { activate: false });
    }
  });
}

// --- Restore, and what this kind does when a project opens ----------------

/**
 * Run `fn` with the table entry `entryId` names once the adapter's table
 * lists it — now, or on the adapter change that brings it. A table resolves
 * MORE THAN ONCE: a contributed finder (the mesh capability's models finder)
 * registers after the first resolution and the table is resolved again with
 * its entries, so "not pending" is not "complete" (measured 2026-09-05: a
 * model document restored on the first resolution found no entry). Stops
 * waiting when the project changes under it.
 */
function whenDocumentEntry(entryId: string, fn: (entry: DocumentEntry) => void): void {
  const attempt = (): boolean => {
    const facet = projectAdapterFacet();
    if (!facet) return false;
    const entry = facet.scenes.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return false;
    fn(entry);
    return true;
  };
  if (attempt()) return;
  const stop = subscribeProjectAdapter(() => {
    if (attempt()) stop();
  });
}

/** The table entry a fresh checkout opens on: the declared default when it
 *  is a document with a source (and not a scene, which is pinned elsewhere),
 *  else the NEWEST such entry — the table lists finder sources newest first,
 *  so with several models and nothing declared the one most recently written
 *  is the one on screen (Photoshop reopens the last document; a models
 *  project with two models and no record used to open on nothing at all). */
function defaultTableEntry(table: ResolvedDocumentTable): DocumentEntry | null {
  const candidates = table.entries.filter(
    (entry) => entry.kind !== 'scene' && entry.kind !== 'prefab' && entry.source !== undefined,
  );
  const declared = candidates.find((entry) => entry.id === table.default);
  if (declared) return declared;
  return candidates[0] ?? null;
}

/**
 * THE THING BEING WORKED ON IS THE DOCUMENT. Blender opens on its scene,
 * Photoshop on its file; a models project should open on the model the agent
 * or the person is making, not on the starter cube it scaffolded. Measured
 * 2026-09-06: an owner watched a bench session write `mushroom.ts`, look at it
 * nine times, and the viewport showed `cage` throughout, because the only
 * automatic open was the boot-time default.
 *
 * So: when the adapter table gains a NEW non-scene entry after its first
 * settled resolution (a model module written to `src/models/`, a page added),
 * the latest entry opens as a replaceable preview, selected the way a Content
 * click leaves it. Explicitly opened or edited tabs stay open. A discovery
 * batch opens only one preview: importing a scene with 35 model modules must
 * not create 35 GPU contexts. Entries already in the table are the user's to open;
 * an entry that comes back after a rename is new to the table and opens.
 * Installed once per project load; the previous watch is dropped.
 */
let stopFollowingTableDocuments: (() => void) | null = null;
/** The follow rule's baseline, persisted as this kind's own session state. */
let seenTableIds: Set<string> | null = null;
/**
 * A table entry that APPEARS while this workspace is open is the document
 * being worked on (Blender opens on its scene, Photoshop on its file): open
 * it, active, selected the way a Content click leaves it. `seen` is the
 * baseline a previous page of this workspace persisted — without it every
 * Vite full reload (a tsconfig event, an invalidation the graph cannot
 * patch) reset the baseline to "everything now", and a model written in
 * the seconds around a reload was never opened (measured 2026-09-06: an
 * agent iterated a mushroom 24 times while the owner's viewport showed the
 * starter cube).
 */
function followNewTableDocuments(seen?: readonly string[]): void {
  stopFollowingTableDocuments?.();
  let known: Set<string> | null = seen ? new Set(seen) : null;
  const observe = (): void => {
    const facet = projectAdapterFacet();
    if (!facet || facet.documentsPending) return;
    const ids = new Set(facet.scenes.entries.map((entry) => entry.id));
    if (known === null) {
      known = ids;
      seenTableIds = ids;
      return;
    }
    const entry = [...facet.scenes.entries]
      .reverse()
      .find(
        (candidate) =>
          !known?.has(candidate.id) &&
          candidate.kind !== 'scene' &&
          candidate.kind !== 'prefab' &&
          candidate.source &&
          hasKindEditor(candidate.kind),
      );
    // Advance before opening: document activation can publish the table again.
    known = ids;
    seenTableIds = ids;
    if (entry?.source && openKindDocument(entry, { activate: true, preview: true })) {
      setSelectedAsset({
        path: `/${entry.source.path}`,
        name: entry.label,
        kind: 'source',
        capabilities: assetCapabilities(entry.source.path),
        origin: 'project',
        health: 'healthy',
        selectionCount: 1,
      });
    }
  };
  observe();
  stopFollowingTableDocuments = subscribeProjectAdapter(observe);
}

function openDefaultTableDocument(): void {
  const attempt = (): boolean => {
    const facet = projectAdapterFacet();
    if (!facet || facet.documentsPending) return false;
    // "SOMETHING IS ALREADY OPEN" MEANS A DOCUMENT A PERSON IS IN — never an
    // AREA document. A workspace's own `areas` (the Model workspace's Timeline)
    // open with the layout, before the adapter's table has settled, and they
    // are never activatable (`workspace-document-registry.ts` gates activation
    // on `!descriptor.area`). Counting one as "the session already has a
    // document" is what left a fresh `--template models` scaffold under the
    // Code-OSS frame with "No document open yet (0 registered)" and the cube
    // never opened — measured 2026-09-20, walk 3 beat 2: the table held
    // `model:src/models/cube.blend` while `open` held only the timeline.
    if (openWorkspaceDocuments().some((document) => !document.descriptor.area)) return true;
    const entry = defaultTableEntry(facet.scenes);
    if (entry?.source) {
      const path = `/${entry.source.path}`;
      // The kind's own editor when one is registered (a model opens as a
      // model); the source only for a kind nothing edits.
      if (!openKindDocument(entry)) {
        openAssetDocument(path, uneditedKindAssetKind(entry));
      }
      // Opened AND selected, the way a Content click leaves it: the kind's
      // own asset inspector (a model's Edit mesh door) is the first thing
      // the Inspector shows.
      setSelectedAsset({
        path,
        name: entry.label,
        kind: 'source',
        capabilities: assetCapabilities(entry.source.path),
        origin: 'project',
        health: 'healthy',
        selectionCount: 1,
      });
    }
    return true;
  };
  if (attempt()) return;
  const stop = subscribeProjectAdapter(() => {
    if (attempt()) stop();
  });
}

registerWorkspaceDocumentRestorer({
  kind: 'document',
  owner: 'kind-documents',
  // The table resolves asynchronously; an entry that is gone (or a kind whose
  // editor is gone) reopens nothing, like a deleted tool. It also resolves
  // AFTER the restore loop has ended and the stored active id has been asked
  // for, so a kind document that was the active tab must activate ITSELF as
  // it reopens — or the page lands on whichever sibling resolved first (a
  // session reloaded onto the starter cube while its mushroom was the tab in
  // use, 2026-09-06).
  restore: ({ state, active }) => {
    const record = state as { entryId?: unknown } | null | undefined;
    const entryId = typeof record?.entryId === 'string' ? record.entryId : null;
    if (!entryId) return false;
    whenDocumentEntry(entryId, (entry) => {
      openKindDocumentWhenReady(entry, { activate: active });
    });
    return true;
  },
  persistKindState: () => (seenTableIds ? { seen: [...seenTableIds] } : undefined),
  beginRestore: ({ state, hasDocumentsToRestore }) => {
    const record = state as { seen?: unknown } | null | undefined;
    const seen = Array.isArray(record?.seen)
      ? record.seen.filter((id): id is string => typeof id === 'string')
      : undefined;
    // A SESSION WITH NOTHING TO RESTORE opens on the project's own DEFAULT
    // document — what the adapter table declares (or its one non-scene
    // entry): a models project opens its model, a website its page. Scenes
    // have their pinned door (`CenterDocuments`) and are not this one's
    // business.
    //
    // This used to read `!hasRecord`, and "a project that recorded 'nothing
    // open' keeps nothing open" stood beside it as if it were a decision. It
    // was a hole: closing the last document writes `open: []`, and every boot
    // after that restored nothing and opened nothing (walk 5 beat 0 —
    // measured on a `model-editor create` scaffold, where the product's cover
    // then sat out its 90 s budget and blamed Blender for a model nobody had
    // asked it to open).
    if (!hasDocumentsToRestore) openDefaultTableDocument();
    followNewTableDocuments(seen);
  },
});

function useContribution(documentId: string) {
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const entry = entries.get(documentId)?.props;
  return { entry, contribution: entry ? documentContributionForKind(entry.kind) : undefined };
}

export function KindDocumentToolbar({ documentId, active }: WorkspaceDocumentContentProps) {
  const { entry, contribution } = useContribution(documentId);
  if (!entry || !contribution?.Toolbar) return null;
  return (
    <ToolHost
      key={`${contribution.id}:${contribution.version}:toolbar:${documentId}`}
      contribution={contribution}
      Component={contribution.Toolbar as unknown as ComponentType<Record<string, unknown>>}
      documentId={documentId}
      active={active}
      document={entry}
    />
  );
}

export function KindDocumentShelf({ documentId, active }: WorkspaceDocumentContentProps) {
  const { entry, contribution } = useContribution(documentId);
  if (!entry || !contribution?.Shelf) return null;
  return (
    <ToolHost
      key={`${contribution.id}:${contribution.version}:shelf:${documentId}`}
      contribution={contribution}
      Component={contribution.Shelf as unknown as ComponentType<Record<string, unknown>>}
      documentId={documentId}
      active={active}
      document={entry}
    />
  );
}

export function KindDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  const { entry, contribution } = useContribution(documentId);
  if (!entry || !contribution) {
    return (
      <div
        style={{ padding: 12, fontSize: 12, color: themeVars.content.muted, pointerEvents: 'auto' }}
      >
        No editor is registered for this document's kind — close this document.
      </div>
    );
  }
  return (
    <ToolHost
      key={`${contribution.id}:${contribution.version}:${documentId}`}
      contribution={contribution}
      documentId={documentId}
      active={active}
      document={entry}
    />
  );
}
