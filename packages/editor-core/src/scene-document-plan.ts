/**
 * THE EDIT TAB ROW, as pure logic — what the adapter's scene table means for
 * the workspace's open documents.
 *
 * ARCHITECTURE-CORE §Editor: "the scene table (entries, default, authorable
 * flags, reach) is ONE adapter declaration with two clients — the Edit tab row
 * projects it as isolation documents through the substrate family's piece
 * mounts, and Play's `open()` walks it as live navigation." This module is the
 * decision half of the FIRST client; `components/scene-documents.tsx` is the
 * half that talks to the workspace registry, and `command-listener.ts`'s
 * `open` verb resolves ONE entry through the very same table below — so the
 * tab row and the verb can never disagree about what an entry is.
 *
 * ZERO INFERENCE. Every answer here is read off a DECLARED field of the
 * entry — `authorable`, `reach`, `source`, `region`. Nothing is derived from a
 * folder, a filename, a root, or the shape of the project: an entry the
 * adapter did not declare simply is not here, and an entry it declared
 * unreachable stays unreachable with the game's own reason attached.
 */

import type { DocumentEntry, SceneSource } from '@volter/editor-project/adapter/adapter-module';
import type { ResolvedDocumentTable } from './project-adapter';

/** Document-id namespace for a per-scene isolation document. Distinct from
 *  `three-story:` ids (the story turntable, `@vgai/game`'s): a scene is
 *  reached through the entrypoint's own selection table, not through a story,
 *  and the two can legitimately name the same composition. */
export const SCENE_DOCUMENT_PREFIX = 'scene:';

/** The workspace document id for one entrypoint-selection scene entry. */
export function sceneDocumentId(entryId: string): string {
  return `${SCENE_DOCUMENT_PREFIX}${entryId}`;
}

/** A standing isolation tab — `scene:TitleScreen`, not `workspace:scene`. */
export function isIsolationSceneDocumentId(id: string): boolean {
  return id.startsWith(SCENE_DOCUMENT_PREFIX);
}

/**
 * What the Edit workspace does with ONE scene-table entry.
 *
 * `no-document` is not a failure — a traversal entry and a declared-unreachable
 * one are both honest table rows that simply own no Edit document. Its `reason`
 * is the game's OWN sentence whenever the game supplied one (a `none` reach
 * carries its `reason` verbatim), so a refusal quotes the adapter rather than
 * paraphrasing it.
 */
export type SceneDocumentPlan =
  /** Mounting the region IS opening this scene — it is the root's own standing
   *  document, which this entry merely NAMES. No second document. */
  | { readonly kind: 'root-document'; readonly regionId: string; readonly title: string }
  /** A viewport document of its own, mounting `source` in isolation. */
  | {
      readonly kind: 'isolation-document';
      readonly documentId: string;
      readonly title: string;
      /** Owning root, carried into the document so its declared region — not
       *  its filename or export shape — decides the mounting surface. */
      readonly regionId: string | null;
      readonly source: SceneSource;
      readonly isolationSetup?: SceneSource;
      /** Present when this piece is also a running-game screen. Play's `open`
       *  still navigates live; Edit mounts the source in isolation and never
       *  holds the live host. */
      readonly contractSceneId?: string;
    }
  /** A portable story mounts it — the existing story-document opener owns it. */
  | { readonly kind: 'story-document'; readonly title: string; readonly storyId: string }
  /**
   * No Edit document, with the reason stated.
   *
   * `liveReach` separates "no document, and nothing else either" from "no
   * document BECAUSE this scene is REACHED live" — the Edit workspace treats
   * both the same (neither is a tab), while the `open` verb must route the
   * second to the running game instead of refusing it, and must tell a caller
   * with no game running to start one rather than that the scene is a dead end.
   *
   * Present means the live half REACHES this entry — it opens it and answers
   * ok. Absent means it does not, which is two different things and
   * deliberately one field: the live half may have no business with the entry
   * at all (it answers `null` for `story`/`none`). A session that cannot
   * remount still refuses `entrypoint-selection` coded; that is a session
   * fact, not a reach fact — the intended path is remount-at-key and ends
   * `ok: true`. {@link liveReachOf} is where that line is drawn.
   *
   * It is derived from REACH ALONE ({@link liveReachOf}), never from
   * `authorable`, because the live half is the authority on this half of the
   * question and it reads reach only (`scene-live-open.ts` switches on
   * `entry.reach.kind`). A planner that also asked `authorable` here would call
   * a screen the running game navigates to a dead end — the exact collapse this
   * field exists to prevent.
   */
  | {
      readonly kind: 'no-document';
      readonly reason: string;
      readonly liveReach?: 'game-contract' | 'root-mount' | 'entrypoint-selection';
    };

/**
 * THE ONE DERIVATION of `liveReach`, from the entry's DECLARED reach and
 * nothing else — never from `authorable`, so the two clients cannot disagree.
 *
 * It answers for exactly the reaches `openLiveSceneEntry` REACHES: it
 * navigates a `game-contract` scene through the game's own contract, it
 * shows the document a `root-mount` scene draws into, and it remounts play
 * at an `entrypoint-selection` key. All three end `ok: true` when the
 * session can honour them, so for all three the honest Edit-half refusal
 * with nothing running is `SCENE_NAVIGATION_NOT_RUNNING` — start the game
 * and ask again.
 *
 * A session that cannot remount still refuses `entrypoint-selection` with
 * `SCENE_NOT_OPENABLE_LIVE` — that is the same shape as a `game-contract`
 * scene whose running game publishes no contract (`SCENE_CONTRACT_UNAVAILABLE`).
 * The field names the intended live path, not every session's ability to
 * walk it.
 *
 * A spread rather than a value so `exactOptionalPropertyTypes` gets an ABSENT
 * key for "no live reach", never an explicit `undefined`. Every `no-document`
 * return below spreads it unconditionally — the two where it is currently
 * provably empty included — so this function stays the SOLE decider and a
 * later widening cannot leave a branch silently behind.
 */
function liveReachOf(entry: DocumentEntry): {
  readonly liveReach?: 'game-contract' | 'root-mount' | 'entrypoint-selection';
} {
  const { kind } = entry.reach;
  return kind === 'game-contract' || kind === 'root-mount' || kind === 'entrypoint-selection'
    ? { liveReach: kind }
    : {};
}

/**
 * Plan ONE entry.
 *
 * Order matters: `authorable` is asked FIRST because a traversal entry
 * (boot/loading choreography) earns no column whatever its reach — the flag is
 * about what the entry IS, while reach is about how the running game gets
 * there.
 *
 * That order decides the DOCUMENT, and only the document. `liveReach` is
 * carried through it untouched: whether a running game can be sent to a screen
 * is the game's contract's business, not the host's opinion of whether the
 * screen is worth authoring, and the live half honours that by reading reach
 * alone.
 */
export function planSceneDocument(entry: DocumentEntry): SceneDocumentPlan {
  if (!entry.authorable) {
    return {
      kind: 'no-document',
      ...liveReachOf(entry),
      reason:
        `"${entry.id}" is declared TRAVERSAL (boot/loading choreography), not an authorable ` +
        'composition, so it has no Edit document.',
    };
  }
  switch (entry.reach.kind) {
    case 'none':
      // VERBATIM. The adapter wrote this sentence about its own game; a host
      // paraphrase would be the host claiming to know why.
      return { kind: 'no-document', ...liveReachOf(entry), reason: entry.reach.reason };
    case 'root-mount':
      return entry.region === null
        ? {
            // Still LIVE-REACHED: `openLiveSceneEntry` shows the document the
            // running game draws into and never looks at `region`, so the
            // missing region costs this entry its Edit document and nothing
            // else.
            kind: 'no-document',
            ...liveReachOf(entry),
            reason:
              `"${entry.id}" is reached by mounting a region, but the entry names no region, ` +
              'so there is no standing document it could be.',
          }
        : { kind: 'root-document', regionId: entry.region, title: entry.label };
    case 'entrypoint-selection':
      // ACTIVE means the entrypoint indexes its selection table with THIS key,
      // so the region's standing document already mounts this composition —
      // opening a second document for it would show the same thing twice under
      // two titles. The entry names the standing document instead, exactly as
      // `root-mount` does. A region-less entry keeps the isolation document:
      // there is no honest mapping from "active" to a document without one, and
      // inventing a region is what zero-inference forbids.
      if (entry.reach.active === true && entry.region !== null) {
        return { kind: 'root-document', regionId: entry.region, title: entry.label };
      }
      return entry.source
        ? {
            kind: 'isolation-document',
            documentId: sceneDocumentId(entry.id),
            title: entry.label,
            regionId: entry.region,
            source: entry.source,
            ...(entry.isolationSetup ? { isolationSetup: entry.isolationSetup } : {}),
          }
        : {
            kind: 'no-document',
            ...liveReachOf(entry),
            reason:
              `"${entry.id}" is selected at the entrypoint's \`${entry.reach.selection}\` slot, ` +
              'but the finder could not resolve the module it names, so there is nothing to ' +
              'mount in isolation.',
          };
    case 'game-contract':
      // Authorable + a source module is an Edit piece: every authorable scene
      // gets a tab (ARCHITECTURE-CORE §Editor). Play still navigates live
      // through `liveReach`. Without a source there is nothing to isolate, so
      // Edit stays silent and `open` asks the running game.
      return entry.source
        ? {
            kind: 'isolation-document',
            documentId: sceneDocumentId(entry.id),
            title: entry.label,
            regionId: entry.region,
            source: entry.source,
            ...(entry.isolationSetup ? { isolationSetup: entry.isolationSetup } : {}),
            contractSceneId: entry.reach.sceneId,
          }
        : {
            kind: 'no-document',
            ...liveReachOf(entry),
            reason:
              `"${entry.id}" is reached only through the running game's own navigation ` +
              `(its scenes contract calls it "${entry.reach.sceneId}"), and the entry names no ` +
              'source module, so there is no Edit document — open it while the game is running.',
          };
    case 'story':
      return { kind: 'story-document', title: entry.label, storyId: entry.reach.storyId };
  }
}

/** One row of the Edit tab row. */
export interface SceneTabRow {
  readonly entry: DocumentEntry;
  /** Never `no-document` — a row that owns no document is not a tab. */
  readonly plan: Exclude<SceneDocumentPlan, { kind: 'no-document' }>;
  /** The table's declared default entry. At most one row carries it. */
  readonly isDefault: boolean;
}

/**
 * The whole Edit tab row: every AUTHORABLE SCENE the table declares that owns
 * a document, in the table's own order.
 *
 * Prefabs are excluded deliberately, and they are not second-class for it: a
 * prefab already surfaces through the boards and Content, and it opens as a
 * sibling document on demand through the same verb (`open`). What a standing
 * TAB means is "this is one of the game's scenes", which is exactly the
 * `kind: 'scene'` declaration.
 */
export function sceneTabRow(table: ResolvedDocumentTable): readonly SceneTabRow[] {
  const rows: SceneTabRow[] = [];
  for (const entry of table.entries) {
    if (entry.kind !== 'scene') continue;
    const plan = planSceneDocument(entry);
    if (plan.kind === 'no-document') continue;
    rows.push({ entry, plan, isDefault: table.default === entry.id });
  }
  return rows;
}

/** What Edit and Content actually present from one resolved scene table. */
export function authoringSurfaceFromTable(
  table: ResolvedDocumentTable,
  openDocumentIds: readonly string[],
  availableDocumentIds: readonly string[],
): {
  readonly sceneDocuments: number;
  readonly isolationDocuments: number;
  readonly openIsolationDocuments: number;
  readonly availableIsolationDocuments: number;
  readonly pieces: number;
  /** Entries of kind `scene` — the surface prefabs are placed on; a table
   *  with none (a models or website project) has no prefabs by design. */
  readonly sceneEntries: number;
} {
  const tabs = sceneTabRow(table);
  const isolationIds = tabs.flatMap((row) =>
    row.plan.kind === 'isolation-document' ? [row.plan.documentId] : [],
  );
  const open = new Set(openDocumentIds);
  const available = new Set(availableDocumentIds);
  // A finder's OWN document kind (a `model` from `@volter/editor-blender`'s finder, a
  // `page`, a `shot`) opens through that kind's document, never through the
  // scene plan above — which answers `no-document` for it because it names
  // no region. Those are documents Edit presents all the same; measured
  // 2026-09-17, a models project reported "no authorable scene with a
  // document to open" beside its open model document.
  const kindDocuments = table.entries.filter(
    (entry) => entry.authorable && entry.kind !== 'scene' && entry.kind !== 'prefab',
  ).length;
  return {
    sceneDocuments: tabs.length + kindDocuments,
    isolationDocuments: isolationIds.length,
    openIsolationDocuments: isolationIds.filter((id) => open.has(id)).length,
    availableIsolationDocuments: isolationIds.filter((id) => available.has(id)).length,
    pieces: table.entries.filter((entry) => entry.kind === 'prefab').length,
    sceneEntries: table.entries.filter((entry) => entry.kind === 'scene').length,
  };
}

/**
 * Isolation tabs ARE the Edit scene row. A generic Scene tab
 * (`workspace:scene` / `workspace:canvas-scene`) would be a second surface
 * for the same game — the live host, or an empty world — and only belongs
 * when this table has no isolation documents (or also names a root document
 * that Scene already is).
 */
export function isolationTabsReplaceGenericScene(table: ResolvedDocumentTable): boolean {
  const rows = sceneTabRow(table);
  return (
    rows.some((row) => row.plan.kind === 'isolation-document') &&
    !rows.some((row) => row.plan.kind === 'root-document')
  );
}
