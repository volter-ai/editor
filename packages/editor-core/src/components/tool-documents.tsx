import { themeVars } from '@volter/editor-sdk/widgets';
/**
 * Project-tool DOCUMENTS (W3 — inventory rows B12/T2-behavior/T3): a
 * `placement: 'document'` project tool (including every legacy `'dock'` tool
 * — the W0 alias rule) opens as a CENTER workspace document (kind `'tool'`,
 * title = the tool's own declared title per §8), hosted in the same
 * error-boundaried `ToolHost` the bottom ⚙ tabs used. `placement: 'utility'`
 * tools stay in the bottom area — rendered as sections of the ONE Dev
 * utility (`components/DevPanel.tsx`), never as tabs of their own.
 * The ⚙ dock-tab row is gone.
 *
 * Open gesture: one `Open Tool: <title>` command-palette action per
 * discovered document tool (`buildToolActions`) — the fixed-layout menu the
 * ⚙ row used to be, now a searchable command.
 *
 * HMR/lifecycle: the document's CONTENT reads the LIVE tool store — an HMR
 * reload bumps the tool's `version`, which re-keys the mount (fresh
 * component + cleared error boundary, the same physics the dock tabs had);
 * a deleted tool file leaves an honest "no longer available" message in any
 * open document (discovery is the folder scan, D3).
 */

import { type ComponentType, useSyncExternalStore } from 'react';
import type { EditorAction } from '../action-registry';
import {
  awaitAnnouncedObject3DDocumentSession,
  waitForContributedDocumentMount,
} from '../document-context-registry';
import { registerDocumentOpener } from '../document-open-registry';
import type { ViewportTab } from '../editor-shell-store';
import {
  contributionFailureHint,
  getDocumentToolContributions,
  getGlobalToolContributions,
  refreshProjectToolContributions,
  subscribeToolContributions,
} from '../tool-loader';
import {
  closeWorkspaceDocument,
  type OpenWorkspaceDocumentOptions,
  openWorkspaceDocument,
  openWorkspaceDocuments,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '../workspace-document-restore';
import { ToolHost } from './ToolHost';

/** The narrow store surface tool documents need (T6.3 tab hand-off). */
export interface ToolDocumentStore {
  setActiveViewportTab(tab: ViewportTab): void;
}

/** Stable §7.1 identity for one project tool's document. */
export function toolDocumentId(toolId: string): string {
  return `tool:${toolId}`;
}

/** Resolve either the canonical tool-qualified id or one unambiguous package-local id. */
export function resolveToolDocumentContributionId(id: string): string | null {
  const contributions = getDocumentToolContributions();
  const exact = contributions.find((item) => item.id === id);
  if (exact) return exact.id;
  // Ids are no longer tool-prefixed, so an exact match above is the only
  // lookup left — there is no local-vs-qualified form to reconcile.
  return null;
}

/**
 * Open (or activate) the center document for one document-placement project
 * tool. Returns `false` (opens nothing) when no discovered document tool
 * carries that id — no fabricated documents for deleted/renamed tools.
 */
export function openToolDocument(
  store: ToolDocumentStore | null,
  toolId: string,
  options: OpenWorkspaceDocumentOptions = {},
  /** THE WORKSPACE AREA this document fills, when a workspace's own `areas`
   *  list is what opened it (`WorkspaceDocumentDescriptor.area`). Absent for
   *  every other opener, which is what keeps an ordinary tool document a
   *  centre tab. */
  area?: string,
): boolean {
  const resolvedId = resolveToolDocumentContributionId(toolId);
  const contribution = getDocumentToolContributions().find((item) => item.id === resolvedId);
  if (!contribution) return false;
  openWorkspaceDocument(
    {
      id: toolDocumentId(contribution.id),
      ...(area === undefined ? {} : { area }),
      // §8: the tool's own declared title, never a tech bucket.
      title: contribution.title,
      kind: 'tool-contribution',
      workspaceRole: 'workspace-reference',
      provenance: {
        sourcePath: contribution.file,
        origin: contribution.tool?.name ?? contribution.file,
      },
      Content: ToolDocumentContent,
      // The contribution's header rides the host's own strip — the region the
      // Game and Story documents already use — so a project document gets the
      // same header anatomy as a built-in, drawn by the host.
      ...(contribution.Toolbar ? { Toolbar: ToolDocumentToolbar } : {}),
      ...(contribution.Shelf ? { Shelf: ToolDocumentShelf } : {}),
      // A STANDING document is a place in the project, not an errand — pinned
      // like the `3D`/`UI`/`Dev` boards. See `GlobalToolContribution.standing`.
      // AN AREA DOCUMENT IS PINNED TOO, and for a stronger reason: it is not
      // a tab at all, it IS the workspace's second editor group, and a close
      // affordance on it would offer to empty a group nothing refills.
      closeable: area === undefined && !contribution.standing,
      presentation: () => ({ kind: 'tool', id: contribution.id }),
      // AN AREA DOCUMENT DOES NOT PERSIST ITSELF. The WORKSPACE reopens it,
      // from its own `areas` list, and it does so knowing the area id — a
      // restorer running first would reopen the same contribution with NO
      // area and strand it as a centre tab beside the model. `undefined` is
      // the descriptor's own documented opt-out for "something else
      // re-derives this at boot", which is exactly the case here.
      ...(area === undefined ? { persist: () => ({ contributionId: contribution.id }) } : {}),
      ...(store ? { onActivate: () => store.setActiveViewportTab('edit') } : {}),
    },
    options,
  );
  return true;
}

/** Reopen a persisted tool document. `openToolDocument` is self-verifying —
 *  a deleted or renamed contribution opens nothing and answers `false`, so
 *  the stale panel is reconciled away. No `prepare`: the discovery pass this
 *  kind used to await for itself is now the restore's own first step, run for
 *  EVERY record because a package owns its restorer as well as its documents
 *  (`workspace-state-persistence.ts`, "contributions load first"). Keeping
 *  both ran the pass twice per boot — three reports of each unimplemented
 *  stub instead of one, measured on a `full` scaffold 2026-09-18. */
registerWorkspaceDocumentRestorer({
  kind: 'tool-contribution',
  owner: 'tool-documents',
  restore: ({ state, store }) => {
    const record = state as { contributionId?: unknown } | null | undefined;
    const contributionId =
      typeof record?.contributionId === 'string' ? record.contributionId : null;
    return contributionId !== null && openToolDocument(store, contributionId);
  },
});

/**
 * THE `tool` ADDRESS (`document-open-registry.ts`) — the other half of the
 * `presentation()` above, so the presenter reaches a contributed document
 * without importing this module. Registered at module load, the shape
 * `packages/game/src/story-documents/three-story-documents.tsx:239` uses.
 *
 * SETTLING is the discovery pass this kind opens out of. A cold Vite graph can
 * register the project catalog before its document contribution modules finish
 * loading, and an explicit address is durable intent, so the owning pass is
 * DRIVEN rather than raced with a timeout — what the presenter did by hand.
 * "Not registered" then has two causes that need different fixes (no such
 * contribution exists, or one exists and its module threw on import) and
 * `contributionFailureHint` is what tells them apart; a generic refusal used to
 * send the reader hunting for a missing file that was on disk all along, so
 * this address refuses in its own words.
 */
registerDocumentOpener<{ readonly id: string }>({
  id: 'tool',
  owner: 'tool-documents',
  open: (store, request) => {
    // Resolve FIRST: `openToolDocument` resolves the same way and the document
    // id is built from what it found, so the resolution is the answer.
    const resolvedId = resolveToolDocumentContributionId(request.id);
    if (resolvedId === null) return null;
    return openToolDocument(store, resolvedId) ? toolDocumentId(resolvedId) : null;
  },
  settle: async (request) => {
    await refreshProjectToolContributions();
    if (resolveToolDocumentContributionId(request.id) !== null) return;
    throw new Error(
      `Tool document is not registered: ${request.id}.${contributionFailureHint(request.id)}`,
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

/**
 * Open every STANDING document contribution, and keep that set in step with
 * discovery: a capability added mid-session brings its tab with it, and a
 * capability whose source is deleted takes its tab away rather than leaving a
 * pinned panel nothing backs.
 *
 * Returns the teardown for the subscription (it does not close the documents —
 * the project-open path owns that, the same way it owns the boards).
 */
export function installStandingToolDocuments(store: ToolDocumentStore): () => void {
  const opened = new Set<string>();
  const reconcile = () => {
    const standing = getDocumentToolContributions().filter((item) => item.standing);
    const live = new Set(standing.map((item) => item.id));
    for (const id of opened) {
      if (live.has(id)) continue;
      closeWorkspaceDocument(toolDocumentId(id), { discardDirty: true });
      opened.delete(id);
    }
    for (const item of standing) {
      if (opened.has(item.id)) continue;
      if (openToolDocument(store, item.id, { activate: false })) opened.add(item.id);
    }
    // EVERY open tool document takes its slots afresh on discovery change,
    // standing or not: a module re-evaluated on save may have gained or lost
    // its `Toolbar`, and `openWorkspaceDocument` on an open id is what
    // refreshes the descriptor's mount slots (see the registry).
    const open = new Set(openWorkspaceDocuments().map((d) => d.descriptor.id));
    for (const item of getDocumentToolContributions()) {
      if (!open.has(toolDocumentId(item.id))) continue;
      openToolDocument(store, item.id, { activate: false });
    }
  };
  reconcile();
  return subscribeToolContributions(reconcile);
}

/** `Open Tool: <title>` palette actions — one per discovered document tool
 *  (the B12 discovery gesture). A standing document is always open, so its
 *  action ACTIVATES the tab rather than teaching a way to summon it. */
export function buildToolActions(store: ToolDocumentStore): EditorAction[] {
  return getDocumentToolContributions().map((t) => ({
    id: `tool-doc:${t.id}`,
    label: t.standing ? `Show ${t.title}` : `Open Tool: ${t.title}`,
    category: 'action' as const,
    execute: () => void openToolDocument(store, t.id),
  }));
}

/** Content host: resolves the LIVE tool by id on every render (HMR re-key,
 *  honest deleted-tool state). */
/** The header strip's contents for a tool document: the contribution's own
 *  `Toolbar`, mounted through the same host so it reads the same props. */
export function ToolDocumentToolbar({ documentId, active }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const toolId = documentId.startsWith('tool:') ? documentId.slice('tool:'.length) : documentId;
  const contribution = getDocumentToolContributions().find((item) => item.id === toolId);
  if (!contribution?.Toolbar) return null;
  return (
    <ToolHost
      key={`${contribution.id}:${contribution.version}:toolbar`}
      contribution={contribution}
      Component={contribution.Toolbar as unknown as ComponentType<Record<string, unknown>>}
      documentId={documentId}
      active={active}
    />
  );
}

/** The shelf rail's contents for a tool document: the contribution's own
 *  `Shelf`, mounted through the same host so it reads the same props. */
export function ToolDocumentShelf({ documentId, active }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const toolId = documentId.startsWith('tool:') ? documentId.slice('tool:'.length) : documentId;
  const contribution = getDocumentToolContributions().find((item) => item.id === toolId);
  if (!contribution?.Shelf) return null;
  return (
    <ToolHost
      key={`${contribution.id}:${contribution.version}:shelf`}
      contribution={contribution}
      Component={contribution.Shelf as unknown as ComponentType<Record<string, unknown>>}
      documentId={documentId}
      active={active}
    />
  );
}

export function ToolDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const toolId = documentId.startsWith('tool:') ? documentId.slice('tool:'.length) : documentId;
  const contribution = getDocumentToolContributions().find((item) => item.id === toolId);
  if (!contribution) {
    return (
      <div
        style={{ padding: 12, fontSize: 12, color: themeVars.content.muted, pointerEvents: 'auto' }}
      >
        This tool contribution is no longer registered — close this document.
      </div>
    );
  }
  return (
    <div
      key={`${contribution.id}:${contribution.version}`}
      data-testid={`tool-document:${contribution.id}`}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        // B-11: the editor-provided baseline breathing room every hosted
        // surface's content root has by convention (carried from the dock).
        padding: 12,
      }}
    >
      <ToolHost contribution={contribution} documentId={documentId} active={active} />
    </div>
  );
}
