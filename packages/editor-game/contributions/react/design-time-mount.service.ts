/**
 * THE DOM MEDIUM'S DESIGN-TIME MOUNT (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): `@vgai/dom` tells the host's design-time
 * mount registry how a `dom` world mounts at design time, and when its
 * mounted layers go stale.
 *
 * It is a `workspace.service` for the same reason the React/DOM Inspector
 * beside it is: a mount is not a document, so it never opens and never
 * persists, and what a contribution pass owns is when its registration
 * exists. Unlike that one the stop is REAL — the registration is the only
 * thing standing between a `dom` root and the "no package registered a mount
 * for this medium" disclosure, so a pass that ends must take it back.
 *
 * THE MOUNT IS LAZY, and that is transcribed rather than invented: the canvas
 * medium's mount has been behind a dynamic `import()` since it was written
 * (so `pixi.js`/`@pixi/react` enter a bundle only for a project that declares
 * a canvas root), and the same argument holds here — the board's module
 * reaches the story registry, Storybook's preview API, the React mount
 * runtime and the React authoring adapter. A project with no `dom` root never
 * loads any of it, and this contribution module stays a handful of lines in
 * the build's eager graph.
 */

import { registerDesignTimeMount } from '@editor/authoring/design-time-mount-registry';

export const point = 'workspace.service';

export function start(): () => void {
  return registerDesignTimeMount({
    kind: 'dom',
    owner: '@vgai/dom/design-time-mount',
    // The `ResolvedAdapter['identity']` a mount failure is reported under —
    // the literal the host's own catch block used to spell.
    identity: 'default-react',
    // Deliberately absent: a dom layer's design-time hover/press testing of
    // real UI competes with authoring gestures, so it stays behind the `eye`
    // row's `interactive` toggle. The canvas medium declares the opposite.
    mount: async (candidate, layer, context) => {
      const { mountReactDesignLayer } = await import('../src/design-time-react-mount');
      return mountReactDesignLayer(candidate, layer, context);
    },
    reprojectWhen: (invalidate) => {
      let stopped = false;
      let stop: (() => void) | null = null;
      // The hook's own module is the mount's, so binding it eagerly would
      // load the board's whole graph for a project that has no dom root. The
      // host only calls this when a dom candidate exists, so loading here is
      // exactly the right moment.
      void import('../src/design-time-react-mount').then((module) => {
        if (stopped) return;
        stop = module.reprojectWhenStoriesRepublish(invalidate);
      });
      return () => {
        stopped = true;
        stop?.();
        stop = null;
      };
    },
  });
}
