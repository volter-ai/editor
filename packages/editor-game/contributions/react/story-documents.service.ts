/**
 * THE ISOLATED STORY DOCUMENT (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): the center document a portable CSF story
 * opens as on the DOM/canvas surface, with its `Story Args` Inspector section
 * and its `Actions`/`Interactions`/`Accessibility` utilities, plus the
 * Storybook Docs companion.
 *
 * The three-medium turntable is `@vgai/threejs`'s own contribution of the same
 * name. They were one service while both documents lived in `@vgai/game`;
 * splitting them is what lets a product compose one medium without the other,
 * and neither registers anything the other needs.
 *
 * A SERVICE and not a `workspace.document`: this is not ONE tab the host opens
 * by contribution id — it is a kind with an unbounded set of documents, one
 * per (module, story), each carrying its own arg overrides and action log.
 * What the contribution pass owns is when its registrations exist; the
 * documents themselves open through their addresses
 * (`@editor/document-open-registry` for the address,
 * `@editor/workspace-document-restore` for the persisted state), so the kit
 * names no module here.
 *
 * What stays the KIT's, deliberately: the story REGISTRY and discovery, the
 * declared medium and the project's story regions, the arg descriptors and the
 * Content grid's component thumbnail — portable CSF is the kit's design-time
 * state (ARCHITECTURE-CORE §The target shape), read by the project adapter,
 * the inspection projection, the coverage families and the Edit tab row.
 */

import { ensureStoryContributionsRegistered } from '../src/story-documents/story-documents';

export const point = 'workspace.service';

export function start(): () => void {
  // The module registers its opener and restorer at module scope; this call
  // installs the story-scoped Inspector section and utilities, which used to
  // happen at editor boot. It is idempotent and returns nothing; the
  // registration group it owns is HMR-safe by construction.
  ensureStoryContributionsRegistered();
  // The stop is a no-op, and that is the same lifetime this had as a host
  // module: its registration group is HMR-owned, and an open story document
  // outlives any one contribution pass. Nothing here holds a resource a pass
  // may end.
  return () => {};
}
