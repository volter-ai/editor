/**
 * THE THREE STORY TURNTABLE (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): the center document a portable CSF story
 * whose medium is `three` opens as — the story's R3F world mounted on the
 * kit's Object3D stage, with its `Story Args` Inspector section.
 *
 * The DOM/canvas isolated story document is `@vgai/dom`'s contribution of the
 * same name. They were one service while both documents lived in
 * `@vgai/game`; splitting them is what lets a product compose one medium
 * without the other, and neither registers anything the other needs.
 *
 * A SERVICE and not a `workspace.document`, for the same reason as its
 * sibling: this is a kind with an unbounded set of documents, one per
 * (module, story). The document opens through its address
 * (`@editor/document-open-registry`) and restores through its own restorer
 * (`@editor/workspace-document-restore`).
 */

import { ensureThreeStoryContributionsRegistered } from '../src/story-documents/three-story-documents';

export const point = 'workspace.service';

export function start(): () => void {
  // The module registers its opener and restorer at module scope; this call
  // installs the story-scoped Inspector section. It is idempotent and returns
  // nothing; the registration group it owns is HMR-safe by construction.
  ensureThreeStoryContributionsRegistered();
  // The stop is a no-op: the registration group is HMR-owned and an open story
  // document outlives any one contribution pass.
  return () => {};
}
