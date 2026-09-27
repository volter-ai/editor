/**
 * THE SCENE TABLE'S SECOND CLIENT — `open()` against the RUNNING game.
 *
 * ARCHITECTURE-CORE §Editor: "the scene table … is ONE adapter declaration with
 * two clients — the Edit tab row projects it as isolation documents … and
 * Play's `open()` walks it as live navigation." `scene-document-plan.ts` +
 * `components/scene-documents.tsx` are the first client; this module is the
 * second, and both are reached through the ONE `open` verb in
 * `command-listener.ts`, which asks this one first whenever a game is live.
 *
 * ZERO INFERENCE, twice over:
 *
 *  1. WHICH contract id an entry is, is the adapter's own declaration
 *     (`reach: { kind: 'game-contract', sceneId }`). Nothing here matches
 *     entry ids against contract ids, or assumes the two vocabularies coincide.
 *  2. WHETHER that id is navigable is the GAME's answer, at the moment of use:
 *     the switch goes through the bound scenes projection's own
 *     `goToScene` (`authoring/contract-scenes-stories.ts`), which validates
 *     membership against the game's own `list()` and carries the mount's
 *     held-repaint seam. Calling the contract's `goTo` directly would route
 *     around both.
 *
 * Every seam is injected ({@link LiveSceneSession}) so the whole matrix is
 * decidable headlessly — no mounted game, no workspace, no browser.
 */

import type { LiveSceneTable } from '@volter/editor-sdk/host';
import type { DocumentEntry } from '@volter/editor-project/adapter/adapter-module';

/** What a live game session offers this verb. */
export interface LiveSceneSession {
  /**
   * The running game's BOUND scenes projection, or `null` when the game
   * publishes none.
   *
   * "Bound" is load-bearing: this is the object the mount installed on the
   * game's own authoring adapter — the same one the inspector's scene picker
   * drives — so a switch made here is the same switch a click makes, held
   * repaint and all.
   */
  readonly scenes: () => LiveSceneTable | null;
  /**
   * Activate the document the running game is presented in; `false` when the
   * session has none open. An ingested game's mount IS the running game, and
   * it draws into the Game document — there is no second document a
   * `root-mount` scene could name.
   */
  readonly activateGameDocument: () => boolean;
  /** The Game document's id, for the answer. */
  readonly gameDocumentId: string;
  /**
   * Host remount of a native swap-slot scene: stop this play run and start a
   * new one with the entrypoint's selection const rewritten to `key`. Absent
   * when this session has no serve-time rewrite (an ingest root), which is
   * when `entrypoint-selection` still refuses `SCENE_NOT_OPENABLE_LIVE`.
   */
  readonly remountSelection?: (args: {
    readonly selection: string;
    readonly key: string;
    readonly regionId: string;
  }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}

/** A coded refusal from the live half — the SDK matches `code`, never prose. */
export interface LiveSceneOpenRefusal {
  readonly ok: false;
  readonly code:
    | 'SCENE_CONTRACT_UNAVAILABLE'
    | 'SCENE_NOT_IN_CONTRACT'
    | 'SCENE_SWITCH_FAILED'
    | 'SCENE_NOT_OPENABLE_LIVE'
    | 'SCENE_DOCUMENT_NOT_MOUNTED';
  readonly error: string;
  /** The ids the game itself published, when the refusal is about membership. */
  readonly known?: readonly string[];
}

export type LiveSceneOpenResult =
  | {
      readonly ok: true;
      readonly documentId: string;
      readonly title: string;
      /** The game's own answer: what was asked for, and where it ended up. */
      readonly scene?: { readonly requested: string; readonly current: string | null };
      /**
       * Present when this open restarted play rather than navigating a live
       * contract — the swap slot is a module-level const, so the honest
       * live path is remount-at-key.
       */
      readonly restart?: true;
    }
  | LiveSceneOpenRefusal;

/**
 * Open ONE scene-table entry against the running game, or answer `null` when
 * this entry is not the live half's business — a `story` reach has a portable
 * mount, and a `none` reach is the adapter's own declared dead end. Both are
 * the Edit half's, unchanged, and answering `null` is how this module says so
 * rather than duplicating those refusals.
 */
export async function openLiveSceneEntry(
  entry: DocumentEntry,
  session: LiveSceneSession,
): Promise<LiveSceneOpenResult | null> {
  switch (entry.reach.kind) {
    case 'game-contract': {
      const scenes = session.scenes();
      if (!scenes) {
        return {
          ok: false,
          code: 'SCENE_CONTRACT_UNAVAILABLE',
          error:
            `open: "${entry.id}" is reached through the running game's own scenes contract, ` +
            'and the game running in this session publishes none (`window.vgaiGame.scenes`).',
        };
      }
      const switched = scenes.goToScene(entry.reach.sceneId);
      if (!switched.ok) {
        // The projection's own membership refusal, passed through: the game's
        // `list()` is the authority on what it can be sent to, and a host
        // paraphrase would be the host claiming to know the game's screens.
        return {
          ok: false,
          code: 'SCENE_NOT_IN_CONTRACT',
          error: `open: "${entry.id}" — ${switched.error}`,
          known: switched.known,
        };
      }
      const settled = await switched.settled;
      if (settled.error !== undefined) {
        return {
          ok: false,
          code: 'SCENE_SWITCH_FAILED',
          error: `open: "${entry.id}" — the game's own navigation failed: ${settled.error}`,
        };
      }
      // Activation is best-effort AFTER the switch: the navigation is the
      // gesture, and a session with no Game document open (headless control,
      // a workspace the user rearranged) still navigated the game.
      session.activateGameDocument();
      return {
        ok: true,
        documentId: session.gameDocumentId,
        title: entry.label,
        scene: { requested: settled.requested, current: settled.current },
      };
    }
    case 'root-mount': {
      // The running game IS this scene — mounting the region opened it — so the
      // whole gesture is showing the document it draws into. REACHED, so the
      // planner carries it as `liveReach: 'root-mount'` and the Edit half
      // grades a no-game session `SCENE_NAVIGATION_NOT_RUNNING`: start the
      // game and this returns ok. babylon-space-truckers' `splashScreen` is
      // the shipped instance (`authorable: false`, so it owns no Edit
      // document — pressing ▶ is the whole answer, not a defect in its
      // declaration).
      if (!session.activateGameDocument()) {
        return {
          ok: false,
          code: 'SCENE_DOCUMENT_NOT_MOUNTED',
          error: `open: "${entry.id}" is the running game itself, and no game document is open in this session.`,
        };
      }
      return { ok: true, documentId: session.gameDocumentId, title: entry.label };
    }
    case 'entrypoint-selection': {
      // The slot is a module-level CONST — the running module cannot change
      // scenes. The honest live path is a host remount: stop this play run and
      // start a new one with the entrypoint served at `key`. That is REAL
      // navigation (the next mount executes that key), stated as a restart.
      // A session with no remount seam (hosted bundle, ingest) still refuses
      // coded — never an in-place fake.
      const remount = session.remountSelection;
      const regionId = entry.region;
      if (!remount || regionId === null) {
        return {
          ok: false,
          code: 'SCENE_NOT_OPENABLE_LIVE',
          error:
            `open: "${entry.id}" sits at the entrypoint's \`${entry.reach.selection}\` swap slot, ` +
            'and this session has no live remount for a native swap-slot scene — a running game ' +
            'cannot be sent there in place. Stop the game and open it as a document instead.',
        };
      }
      const remounted = await remount({
        selection: entry.reach.selection,
        key: entry.reach.key,
        regionId,
      });
      if (!remounted.ok) {
        return {
          ok: false,
          code: 'SCENE_SWITCH_FAILED',
          error: `open: "${entry.id}" — remount at \`${entry.reach.selection}["${entry.reach.key}"]\` failed: ${remounted.error}`,
        };
      }
      session.activateGameDocument();
      return {
        ok: true,
        documentId: session.gameDocumentId,
        title: entry.label,
        scene: { requested: entry.reach.key, current: entry.reach.key },
        restart: true,
      };
    }
    case 'story':
    case 'none':
      return null;
  }
}
