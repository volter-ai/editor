/**
 * THE COMPONENT-INSTANCE VERBS of an R3F world's hierarchy row
 * (`@volter/editor-sdk/services`, a `workspace.service` contribution):
 * "Extract Component…", "Fork Component…" and "Reveal / Hide Internals".
 *
 * ## Why this is a package and not the host's
 *
 * They were three host modules registered at boot by three bare side-effect
 * imports in `main.tsx` (`./authoring/instance-extract-menu-register` and its
 * two siblings). Their subject is a project's TSX COMPONENT ESTATE — a row
 * that came from `<HeroBox/>` in `src/prefabs/hero.tsx`, whose subtree becomes
 * a new prefab with a portable CSF story, whose module gets copied and
 * retargeted, whose internal nodes a component rendered itself. A MODEL
 * DOCUMENT HAS NONE OF THOSE: the open-source `models` build authors geometry
 * and has no component instances at all, so it paid eight files of the host's
 * eager closure for three menu items it can never show.
 *
 * ## Why `@volter/editor-game` and not a package named for the substrate
 *
 * The substrate rule (WORK.md §The open-source launch, unit 9) sends a module
 * to a package named for its substrate only when a SECOND sibling package
 * imports it. Measured 2026-09-18: nothing outside the editor imports these
 * three, and the only implementer of `extractComponent`/`forkComponent`
 * anywhere in the estate is the host's own `r3f-source-authoring-adapter.ts`.
 * With no second sibling, the rule's default stands — the game lane's, because
 * a prefab estate with CSF stories is what a game's scene is made of.
 *
 * ## The seam, which is not a new one
 *
 * `@editor/hierarchy-menu-registry` is the host's own registry and has always
 * been the "escape hatch, registered elsewhere by the adapter modules"
 * (`components/GameHierarchy.tsx:26`, `hierarchy-menu-registry.ts:50`); the
 * package REGISTERS and the panel names no lane. The service point is
 * transcribed from `@volter/editor-game`'s `react-inspector.service.ts`, which installs
 * a contributed Inspector section the same way and for the same reason: a menu
 * item is not a document, so it never opens and never persists, and what a
 * contribution pass owns is when its registration exists. Host internals are
 * reached through the `@editor/*` alias the editor's Vite serves to every
 * contribution — the precedent `@volter/editor-game`'s own `bridge.command.ts` and
 * `instances.command.ts` already set.
 *
 * ## What did NOT come, and why
 *
 * `instance-extract-actions.ts` and `instance-fork-actions.ts` — the pure
 * applicability rules and every sentence these verbs can say — stay HOST
 * FILES, because the host's `authoring/r3f-source-authoring-adapter.ts` mints
 * those sentences when it performs the write. They leave the EAGER closure
 * with this cut (nothing in the boot path reaches them any more), which is the
 * shape units 5 and 11 landed; they become this package's own when the R3F
 * source adapter moves.
 *
 * The SOURCE verbs ("Go to Callsite" / "Open Component Source") did not come
 * either, and the measurement says why: four host callers, three of them in
 * `keep` buckets and one of them the launch's own feature —
 * `components/GameHierarchy.tsx:115` (the panel's double-click),
 * `three-board/ThreeBoardDocument.tsx:71` and
 * `authoring/creation-site-related.ts:25`. (A fourth was
 * `authoring/model-drill.ts`, deleted 2026-09-19 with the TypeScript model
 * module it drilled into.) Moving them needs a row-activation
 * seam and a locator extraction; that is its own unit, not a rider on this one.
 */

import {
  ensureInstanceExtractMenuRegistered,
  unregisterInstanceExtractMenu,
} from '../../src/three/component-verbs/extract-menu';
import {
  ensureInstanceForkMenuRegistered,
  unregisterInstanceForkMenu,
} from '../../src/three/component-verbs/fork-menu';
import {
  ensureInstanceInternalsMenuRegistered,
  unregisterInstanceInternalsMenu,
} from '../../src/three/component-verbs/internals-menu';

export const point = 'workspace.service';

export function start(): () => void {
  ensureInstanceExtractMenuRegistered();
  ensureInstanceForkMenuRegistered();
  ensureInstanceInternalsMenuRegistered();
  // Unlike the inspector section this point is transcribed from, the stop is
  // REAL: `registerHierarchyMenuItems` hands back an unregister and the
  // registry is a plain list the panel reads on every open, so a pass that
  // ends without calling these would leave three matchers answering for a
  // lane that is no longer loaded.
  return () => {
    unregisterInstanceExtractMenu();
    unregisterInstanceForkMenu();
    unregisterInstanceInternalsMenu();
  };
}
