/**
 * THE THREE SURFACE'S DESIGN-TIME AUTHORING (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): the two registrations that make a `three`
 * root editable, and the reason the kit names no medium.
 *
 *  1. THE LIVE ADAPTER for a declared `three` world
 *     (`@editor/authoring/active-adapter`'s `setBaseAuthoringFactory`). The
 *     edit-mode installer used to build this one adapter itself, by picking
 *     the project's three root by name; it asks by SURFACE now, and a world
 *     whose surface nobody claims keeps its honest Boundary disclosure.
 *  2. THE DESIGN SESSION on the world root's 3D stage
 *     (`@editor/authoring/design-time-mount-registry`'s `kind: 'three'`),
 *     beside `@volter/editor-game`'s `kind: 'dom'` and the canvas medium's. Those two
 *     mount into a LAYER over the artboard; this one adopts the stage's own
 *     renderer and scene, which is why the registry carries two mount shapes.
 *
 * ARRIVING LATE IS ORDINARY. The contribution pass is deferred behind the
 * first viewport frame, so the edit-mode composite is routinely installed
 * before this runs. `queueEditModeRebuild()` is the kit's own door for that —
 * the same one a source change uses — so the adapter seam needs no
 * notification of its own, and the stage's mount is re-asked on the rebuild.
 *
 * THE SESSION CHUNK IS WARMED HERE, at registration, because the stage used
 * to warm it when it began building and the wait it hides is real. Only a
 * product that composes this package pays for it.
 */

import { setBaseAuthoringFactory } from '@volter/editor-core/authoring/active-adapter';
import { registerDesignTimeMount } from '@volter/editor-core/authoring/design-time-mount-registry';
import { queueEditModeRebuild } from '@volter/editor-core/authoring/edit-mode-authoring';
import { authoringJournal } from '../../src/host/history/json-history-resource';
import { oidThree } from '../../src/three/authoring/three-authoring-adapter';
import type { WorldRootSessionContext } from '../../src/host/components/world-root-stage';

export const point = 'workspace.service';

export function start(): () => void {
  // Warm the session chunk with the pass, not with the first mount.
  const session = import('../../src/three/authoring/r3f-design-session');
  void session.catch(() => {
    // The mount below awaits the same promise and reports its own failure;
    // this early start must not create a second unhandled rejection.
  });
  const stopFactory = setBaseAuthoringFactory('three', (store, worldId) =>
    // The store's scene is the subject: whatever has been mounted into it (the
    // R3F design session's fiber scene, once it adopts) is what the hierarchy
    // shows, and an unmounted world honestly shows nothing rather than a
    // fabricated document.
    oidThree(store, () => store.scene, worldId, authoringJournal(worldId)),
  );
  const stopMount = registerDesignTimeMount({
    kind: 'three',
    owner: '@volter/editor-game/three/three-authoring',
    async mountWorldRootSession(stage) {
      const context = stage as WorldRootSessionContext;
      const { mountR3FDesignSession } = await session;
      return mountR3FDesignSession(context.store, context.composite, context.renderer);
    },
  });
  // The composite that is already installed was built before this package's
  // factory existed, so its three world is a Boundary node. Ask for the one
  // rebuild that turns it live.
  queueEditModeRebuild();
  return () => {
    stopMount();
    stopFactory();
  };
}
