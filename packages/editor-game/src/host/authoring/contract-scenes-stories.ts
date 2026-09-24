/**
 * Projects an ingested game's declared SCENES (`window.vgaiGame.scenes`, see
 * `@volter/editor-project/adapter/ingest/game-contract`) onto the ordinary
 * {@link StoriesProvider} the editor's story picker already reads — the sibling
 * of `contract-hierarchy-authoring.ts`, which does the same job for the
 * contract's `hierarchy` member.
 *
 * Why stories: a multi-screen game's screens ARE the design-time states of its
 * world, and the editor's stories vocabulary is exactly "the states a world can
 * be put into". Projecting rather than adding a second door means the picker,
 * the inspector's serialized subject and `adapter.stories` all work on an
 * ingested game unchanged and unaware of the provenance.
 *
 * SCOPE IS WORLD-LEVEL — `storiesFor`/`active` ignore `nodeId` entirely, the
 * same scope `ReactRootAuthoringAdapter.stories` has (B2). A game's screen is a
 * property of the whole world, not of the node the author happens to have
 * selected, and pretending otherwise would need a per-node scene model no game
 * declares.
 *
 * `isolate` is deliberately ABSENT: an ingested game cannot render ONE of its
 * display objects against a scene — the scene IS the game's whole screen. An
 * absent optional member is the honest answer; a no-op one would advertise a
 * capability that does nothing.
 */

import type {
  LiveSceneSwitch,
  LiveSceneSwitchSettled,
  LiveSceneTable,
} from '@volter/editor-sdk/host';
import type { StoriesProvider, StoryRef } from '@volter/editor-project/adapter';
import type { VgaiGameContract, VgaiGameScene } from '@volter/editor-project/adapter/ingest/game-contract';
import { readGameScenes } from '@volter/editor-project/adapter/ingest/game-contract';
import { editorConsole } from '@volter/editor-core/editor-console';

function assertScenes(value: unknown): VgaiGameScene[] {
  if (!Array.isArray(value)) throw new Error('scenes.list() did not return an array');
  const ids = new Set<string>();
  for (const scene of value) {
    if (
      typeof scene !== 'object' ||
      scene === null ||
      typeof scene.id !== 'string' ||
      scene.id.trim().length === 0 ||
      typeof scene.label !== 'string' ||
      scene.label.trim().length === 0
    ) {
      throw new Error('scenes.list() returned an invalid { id, label } scene');
    }
    if (ids.has(scene.id)) throw new Error(`scenes.list() returned duplicate id "${scene.id}"`);
    ids.add(scene.id);
  }
  return value;
}

/**
 * The switch vocabulary is the SDK's (`LiveSceneSwitch`), not this lane's.
 * It was declared here and the host's live registry imported it, which is how
 * the ingest game contract reached a core host module; the contract now states
 * its own result and this lane implements it (phase 1 of the open-source
 * launch, 2026-09-18). The aliases stay because this module's own readers
 * speak scenes, not "live scene tables".
 */
export type SceneSwitchSettled = LiveSceneSwitchSettled;
export type SceneSwitch = LiveSceneSwitch;

/**
 * The scenes projection: the ordinary {@link StoriesProvider} the picker reads,
 * plus `goToScene` — the SAME switch with its answer kept instead of dropped.
 *
 * One path, two callers. `apply` is `StoriesProvider`'s synchronous,
 * answer-less shape (the picker has `active()` to read afterwards); the `open`
 * protocol verb needs the game's answer and the refusal as VALUES, and getting
 * them by calling the contract's `goTo` directly would route around the
 * membership check this module owns.
 */
export type ContractScenesStories = LiveSceneTable;

/** True when `provider` is a scenes projection — i.e. carries the awaited,
 *  membership-checked switch above. A plain `StoriesProvider` (a react world's
 *  CSF states) does not, and must not be navigated as though it were a game's
 *  own screens. */
export function isContractScenesStories(
  provider: StoriesProvider | null | undefined,
): provider is ContractScenesStories {
  return typeof (provider as ContractScenesStories | null | undefined)?.goToScene === 'function';
}

/** What the MOUNT contributes to a switch this projection accepted. */
export interface ContractScenesSeams {
  /**
   * Called synchronously the moment a switch is ACCEPTED — before the game's
   * own `goTo` settles, because the host's held-mount repaint has to draw
   * frames DURING the transition rather than after it lands
   * (`ingest/held-scene-repaint.ts`). Never called for a refused switch.
   *
   * A seam rather than a wrapper around the returned object: `apply` and
   * `goToScene` are ONE path through this module, and a mount that wrapped only
   * the outer member would leave the picker's own switches unpainted.
   */
  readonly onSwitchAccepted?: (sceneId: string) => void;
}

/**
 * The stories collaborator for a game that declared a usable scene surface, or
 * `null` for one that declared none — the ABSENCE the mount then passes on, so
 * the coverage report names the missing provider instead of the picker showing
 * an empty list.
 *
 * A declared-but-unusable surface is refused loudly (by name, once) rather than
 * bound: `readGameScenes` owns that shape check.
 */
export function createContractScenesStories(
  contract: VgaiGameContract | null | undefined,
  seams: ContractScenesSeams = {},
): ContractScenesStories | null {
  const { scenes, malformed } = readGameScenes(contract);
  if (malformed !== null) {
    editorConsole.warn(`Ignored the game contract's \`scenes\` surface: ${malformed}`, 'ingest');
  }
  if (!scenes) return null;

  let warned = false;
  const list = (): VgaiGameScene[] => {
    try {
      return assertScenes(scenes.list());
    } catch (error) {
      if (!warned) {
        warned = true;
        editorConsole.warn(
          `Ignored invalid game-contract scenes: ${error instanceof Error ? error.message : String(error)}`,
          'ingest',
        );
      }
      return [];
    }
  };

  const goToScene = (sceneId: string): SceneSwitch => {
    const known = list().map((scene) => scene.id);
    if (!known.includes(sceneId)) {
      return {
        ok: false,
        error: `scenes.goTo: "${sceneId}" is not one of this game's scenes (${
          known.length > 0 ? known.join(', ') : 'it lists none'
        }).`,
        known,
      };
    }
    seams.onSwitchAccepted?.(sceneId);
    // The game's own navigation call. It commonly loads the scene's assets
    // first, so a rejection is REPORTED rather than swallowed — and reported as
    // a value, beside the scene the game is actually in, which is read off the
    // game's own model either way.
    const settled = (async (): Promise<SceneSwitchSettled> => {
      try {
        await scenes.goTo(sceneId);
        return { requested: sceneId, current: scenes.current() };
      } catch (error) {
        return {
          requested: sceneId,
          current: scenes.current(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    return { ok: true, settled };
  };

  return {
    // The game calls these SCENES, so every surface that presents them does
    // too — the projection borrows the stories seam, never its vocabulary.
    title: 'Scenes',
    storiesFor: (_nodeId): StoryRef[] => list().map(({ id, label }) => ({ id, label })),
    active: (_nodeId) => scenes.current(),
    goToScene,
    apply: (_nodeId, storyId) => {
      if (storyId === null) {
        // The picker's "(none)" clears a story back to the document's default.
        // A running game has no such state — it is always in SOME scene — so
        // this refuses and says why rather than pretending to clear one.
        editorConsole.warn(
          'This game’s scenes cannot be cleared: it is always in one of its own scenes. ' +
            'Pick the scene to switch to instead.',
          'ingest',
        );
        return;
      }
      // THE SAME SWITCH the `open` verb takes — `apply` differs only in what it
      // does with the answer: nothing waits on it here, because
      // `StoriesProvider.apply` is synchronous and the picker's authoritative
      // reading is `active()`.
      const switched = goToScene(storyId);
      if (!switched.ok) {
        editorConsole.warn(`${switched.error} — ignoring.`, 'ingest');
        return;
      }
      void switched.settled.then((result) => {
        if (result.error === undefined) return;
        editorConsole.error(`scenes.goTo("${storyId}") failed: ${result.error}`, 'ingest');
      });
    },
  };
}
