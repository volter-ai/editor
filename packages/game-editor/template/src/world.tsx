/**
 * The Three root's thin entrypoint. Complete replaceable compositions live in
 * `src/scenes/`; story-backed placeable assets live in `src/prefabs/`; and
 * extracted non-placeable implementation lives in `src/components/`. Folder
 * names describe what a file IS, never merely where it is used.
 *
 * `scenes` is the app's ordinary composition table and `activeScene` selects
 * the component rendered at the root. Add another composition to
 * `src/scenes/`, import it here, and give it a key in the table.
 */

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { QaTester } from './bot/QaTester';
import { attachKeyboard } from './input';
import { NetworkedPlayers } from './net/NetworkedPlayers';
import { MainScene } from './scenes/MainScene';

/** Renderer finish is project-owned state, restored when this world unmounts. */
function RenderFinish() {
  const renderer = useThree((state) => state.gl);

  useEffect(() => {
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousShadowsEnabled = renderer.shadowMap?.enabled;
    const previousShadowType = renderer.shadowMap?.type;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    return () => {
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
      if (renderer.shadowMap && previousShadowType !== undefined) {
        renderer.shadowMap.enabled = previousShadowsEnabled ?? false;
        renderer.shadowMap.type = previousShadowType;
      }
    };
  }, [renderer]);

  return null;
}

/**
 * The physical keyboard half of `src/input.ts`, owned by the world that reads
 * it. The effect's cleanup detaches on unmount, so a Play→stop cycle leaves no
 * window listener behind — the editor's realm audit warns about any that
 * survive, and a listener attached at module load can never be released.
 */
function GameKeyboard() {
  useEffect(() => attachKeyboard(window), []);
  return null;
}

/** This world's swap slot — every composition it can mount, by id. */
const scenes = {
  main: MainScene,
};

/** The composition mounted at the slot right now. */
const activeScene: keyof typeof scenes = 'main';

function World() {
  const Scene = scenes[activeScene];
  return (
    <>
      <RenderFinish />
      <GameKeyboard />
      {/* The resident QA tester's hands on the frame — everything else about
          the playtesting loop (the seat, the repertoire, pause/handoff) is
          plain application code in src/bot/, reached from `vgai eval` via
          `game.run(({ modules }) => …)` like every other module. */}
      <QaTester />
      <Scene name="Main Scene" />
      <NetworkedPlayers name="Networked Players" />
    </>
  );
}

export default World;
