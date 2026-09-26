/**
 * The game's declared system adapters, re-exported by the root entry
 * (`src/world.tsx`) and read by the host at mount: this arena's navigation, a
 * navmesh baked from its own level (the editor's Debug > Bake NavMesh). Its
 * Web Audio and its `@react-three/rapier` world are the game's own libraries,
 * which the editor observes without a declaration here.
 *
 * The arena's own readings and setup functions are ordinary exports of the
 * modules that own them (`src/prefabs/Player.tsx`, `src/prefabs/Enemy.tsx`,
 * `src/arena-state.ts`), reached through `vgai eval`'s
 * `game.run(({ modules }) => …)`.
 */

import { createNavigationAdapter } from '@volter/threejs-runtime/adapter/first-party-navigation-system';
import { initNavigation, NavMeshManager } from '@volter/threejs-runtime/ai/navigation';

const navigation = new NavMeshManager();
void initNavigation();

export const systems = {
  navigation: createNavigationAdapter(navigation, { clear: (scene) => navigation.dispose(scene) }),
};
