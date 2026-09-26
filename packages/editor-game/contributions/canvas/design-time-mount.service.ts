/**
 * THE CANVAS MEDIUM'S DESIGN-TIME MOUNT (a `workspace.service` contribution):
 * tells the SDK's design-time mount registry how a `canvas` world mounts in
 * Edit. The same shape as `contributions/react/design-time-mount.service.ts`;
 * the mount itself stays behind a dynamic `import()` so `pixi.js` and
 * `@pixi/react` load only for a project that declares a canvas root.
 */

import { registerDesignTimeMount } from '@volter/editor-sdk/kit/authoring/design-time-mount-registry';

export const point = 'workspace.service';

export function start(): () => void {
  return registerDesignTimeMount({
    kind: 'canvas',
    owner: '@volter/editor-game/canvas/design-time-mount',
    // The `ResolvedAdapter['identity']` a mount failure is reported under —
    // the literal the host's own catch block used to spell.
    identity: 'default-pixi',
    // A canvas layer is always interactive: its content IS the document's
    // whole subject (the game's 2D scene), and a click on it is how you
    // select in it. The dom medium declares the opposite, because its
    // design-time hover/press testing competes with authoring gestures.
    alwaysInteractive: true,
    mount: async (candidate, layer, context) => {
      const { mountCanvasDesignTimeLayer } = await import('../../src/canvas/design-time-canvas-mount');
      return mountCanvasDesignTimeLayer(candidate, layer, context);
    },
  });
}
