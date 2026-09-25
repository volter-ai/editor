/** Scene-table navigation delegates rendering to installed document owners. */
import { openRegisteredDocument } from '@volter/editor-sdk/kit/document-open-registry';
import { shellStoreForHost } from '@volter/editor-sdk/kit/shell-store-door';
import { projectAdapterFacet, type ResolvedDocumentTable, subscribeProjectAdapter } from '../project-adapter';
import { planSceneDocument, sceneTabRow } from '../scene-document-plan';
import { openAvailableWorkspaceDocument } from '../workspace-available-documents';
import { activateWorkspaceDocument, setWorkspaceDocumentTitle } from '@volter/editor-sdk/kit/workspace-document-registry';
import { rootDocumentId } from '../world-document-routing';
import { kindDocumentId, openKindDocument } from './kind-documents';

export function reconcileSceneDocuments(table: ResolvedDocumentTable | null): void {
  if (!table) return;
  for (const row of sceneTabRow(table)) {
    if (row.plan.kind !== 'root-document') continue;
    const id = rootDocumentId(row.plan.regionId);
    if (id) setWorkspaceDocumentTitle(id, row.plan.title);
  }
}
export function startSceneDocuments(): () => void {
  const run = () => reconcileSceneDocuments(projectAdapterFacet()?.scenes ?? null);
  run();
  return subscribeProjectAdapter(run);
}

export interface SceneOpenRefusal {
  readonly ok: false;
  readonly code:
    | 'SCENE_TABLE_UNAVAILABLE'
    | 'SCENE_NOT_FOUND'
    | 'SCENE_NOT_OPENABLE'
    /** Reached ONLY through the running game's own navigation, and no game is
     *  running here. Distinct from `SCENE_NOT_OPENABLE` because it is not a
     *  dead end: starting the game makes it openable (`scene-live-open.ts`). */
    | 'SCENE_NAVIGATION_NOT_RUNNING'
    | 'SCENE_DOCUMENT_NOT_MOUNTED';
  readonly error: string;
  readonly known?: readonly string[];
}

export type SceneOpenResult =
  | { readonly ok: true; readonly documentId: string; readonly title: string }
  | SceneOpenRefusal;

/**
 * OPEN one piece of the adapter's scene table by id — the Edit half of the
 * table's `open` verb, and the same verb for a scene, a prefab, or a story
 * state (ARCHITECTURE-CORE §Editor: "any other piece … opens as a sibling
 * document through the same verb").
 *
 * Every refusal is CODED because the classes are graded differently: a table
 * that has not loaded is a session fact, an unknown id is a caller error, an
 * unopenable entry is the GAME's own declaration (quoted verbatim), and a
 * document the host has not mounted is a host gap. Prose alone cannot separate
 * them.
 */
/**
 * How long {@link openSceneTableEntryWhenListed} will wait for the project
 * adapter's table before refusing.
 *
 * MEASURED, not chosen: three cold `vgai edit` sessions on a
 * `--template models` probe, opening `model:src/models/cube.blend` in a poll
 * loop from the moment the tab connected — **6025 ms, 6831 ms, 6474 ms**, and
 * in all three the first refusal was `SCENE_TABLE_UNAVAILABLE`, i.e. the
 * adapter had not loaded at all. So for ~6.4 s after the editor reports
 * "Editor ready" and the tab is present, the ONE general door for putting a
 * document on screen answered "no". Every walk in the stage-transport unit
 * had to wrap `editor.open` in a retry loop to get past it, and the frame
 * hits the same window from the other side (WORK.md NEXT item 2).
 *
 * 15 s is that worst case with headroom for a slower box. It is a BOUND and
 * not a fix for slowness: if opening a document ever legitimately needs
 * longer than this, the thing to change is why, not this number.
 */
const SCENE_TABLE_WAIT_MS = 15_000;

/**
 * {@link openSceneTableEntry}, but WAITING for the adapter's table first.
 *
 * WHY THE WAIT CANNOT STOP AT THE FIRST RESOLUTION: a table resolves MORE
 * THAN ONCE — a contributed finder (the mesh capability's models finder)
 * registers after the first resolution and the table is resolved again with
 * its entries — so "the adapter answered and your id is not in it" is not yet
 * "your id does not exist". `kind-documents.tsx`'s `whenDocumentEntry` learned
 * this on 2026-09-05 and has waited correctly ever since; this door never did,
 * and that asymmetry IS the defect: two doors onto one table, one patient and
 * one not.
 *
 * BOTH REFUSALS SURVIVE UNCHANGED. On timeout this returns exactly what the
 * synchronous door would have returned at that moment — `SCENE_TABLE_UNAVAILABLE`
 * if the adapter never loaded, `SCENE_NOT_FOUND` with the known ids if it did.
 * The cost of the patience is paid by a genuinely unknown id, which now takes
 * the full bound to be told so; that is the right side to lose on, because the
 * alternative is the 2026-09-05 bug — refusing a document that was about to
 * exist.
 */
export async function openSceneTableEntryWhenListed(
  id: string,
): Promise<SceneOpenResult> {
  const listed = (): boolean =>
    projectAdapterFacet()?.scenes.entries.some((candidate) => candidate.id === id) ?? false;
  if (!listed()) {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(finish, SCENE_TABLE_WAIT_MS);
      const stop = subscribeProjectAdapter(() => {
        if (listed()) finish();
      });
      // The table can resolve between the check above and the subscribe.
      if (listed()) finish();
    });
  }
  return openSceneTableEntry(id);
}

export function openSceneTableEntry(id: string): SceneOpenResult {
  const facet = projectAdapterFacet();
  if (!facet) {
    return {
      ok: false,
      code: 'SCENE_TABLE_UNAVAILABLE',
      error: 'open: the project adapter has not loaded yet, so there is no scene table to open.',
    };
  }
  const entry = facet.scenes.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    const known = facet.scenes.entries.map((candidate) => candidate.id);
    return {
      ok: false,
      code: 'SCENE_NOT_FOUND',
      error: `open: "${id}" is not in the adapter's scene table. Known ids: ${
        known.length > 0 ? known.join(', ') : '(the table is empty)'
      }.`,
      known,
    };
  }
  // A KIND document (a model, a page — any entry a project contribution
  // authors, `kind-documents.tsx`) is opened the way a Content double-click
  // opens it. Before this, `open` fell through to the scene planner, which
  // asked the entry for a region and refused it by name — so an agent had no
  // door to put the model it was writing on screen (2026-09-06).
  if (
    entry.kind !== 'scene' &&
    entry.kind !== 'prefab' &&
    openKindDocument(entry, { activate: true })
  ) {
    return { ok: true, documentId: kindDocumentId(entry.id), title: entry.label };
  }
  const plan = planSceneDocument(entry);
  switch (plan.kind) {
    case 'no-document':
      // A LIVE-REACHED scene is not a dead end — it is a scene this session
      // cannot reach because nothing is running. The verb tries the live half
      // FIRST (`command-listener.ts`), so arriving here means there was no
      // game. ANY `liveReach` earns this code: the planner sets the field only
      // for the reaches the live half actually OPENS (`scene-document-plan.ts`
      // states which), so "present" and "start the game and ask again" are
      // the same statement.
      if (plan.liveReach !== undefined) {
        return {
          ok: false,
          code: 'SCENE_NAVIGATION_NOT_RUNNING',
          error: `open: ${plan.reason} No game is running in this session.`,
        };
      }
      return {
        ok: false,
        code: 'SCENE_NOT_OPENABLE',
        // The adapter's own sentence, unaltered — see `scene-document-plan.ts`.
        error: `open: "${id}" has no Edit document — ${plan.reason}`,
      };
    case 'root-document': {
      const documentId = rootDocumentId(plan.regionId);
      if (!documentId) {
        return {
          ok: false,
          code: 'SCENE_DOCUMENT_NOT_MOUNTED',
          error: `open: "${id}" is region "${plan.regionId}"'s own document, and no document is mounted for that region in this session.`,
        };
      }
      // Reopen the registered root document if its tab was closed.
      openAvailableWorkspaceDocument(documentId) || activateWorkspaceDocument(documentId);
      return { ok: true, documentId, title: plan.title };
    }
    case 'isolation-document': {
      const documentId = openRegisteredDocument('scene', shellStoreForHost() ?? {}, { entry, activate: true });
      return documentId
        ? { ok: true, documentId, title: plan.title }
        : { ok: false, code: 'SCENE_NOT_OPENABLE', error: `No installed scene editor can open "${id}".` };
    }
    case 'story-document': {
      // The composed id is the whole address; resolving it, and saying WHICH
      // way it failed, is the story kind's own job — it reports the specific
      // reason (an id no composed story answers to, or a module whose medium
      // is undeclared) to the session console, and this verb refuses with the
      // one code the caller can act on.
      const documentId = openRegisteredDocument('story', shellStoreForHost() ?? {}, {
        storyId: plan.storyId,
        title: plan.title,
      });
      if (documentId === null) {
        return {
          ok: false,
          code: 'SCENE_DOCUMENT_NOT_MOUNTED',
          error:
            `open: "${id}" is reached by story "${plan.storyId}", and nothing in this editor ` +
            "opened it — either this project's story registry does not hold that id, or its " +
            'module declares no medium (declare it via `vgai.adapter.ts` regionIncludes or a ' +
            'manifest root entry). The session console names which.',
        };
      }
      return { ok: true, documentId, title: plan.title };
    }
  }
}
