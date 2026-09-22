/**
 * The ADDRESSES a portable CSF story opens under, and the request shape that
 * carries one — the story kind's half of `document-open-registry.ts`.
 *
 * It lives here, in the host's story estate (the registry, discovery, the
 * declared medium, the arg descriptors, the three mount), and NOT in the
 * documents, because the documents are a contribution: `@vgai/game` registers
 * openers for these ids, the host asks for them, and neither side imports the
 * other. A build that does not carry that package simply has no opener, which
 * every call site already handles — `null` is the same answer an undeclared
 * medium has always given.
 *
 * Three ids, because a story opens on three genuinely different surfaces and
 * the CHOICE between them is made in three different places: by the story's
 * declared medium (`story-opener.ts`'s `story` opener), by the owning component's
 * surface (the Content grid), and by the caller asking for Docs explicitly.
 */

/** A story rendered on the Object3D document surface — the turntable. */
export const THREE_STORY_DOCUMENT_OPENER = 'story:three';
/** A story rendered in its own isolated DOM/canvas preview root. */
export const ISOLATED_STORY_DOCUMENT_OPENER = 'story:isolated';
/** The Storybook Docs companion for one story. */
export const STORY_DOCS_DOCUMENT_OPENER = 'story:docs';

export interface StoryDocumentOpenRequest {
  /** Project-relative CSF module path. */
  readonly modulePath: string;
  /** The story's authored export name. */
  readonly storyName: string;
  /** Tab title; the export name when absent. */
  readonly title?: string;
  /** Whether opening also FOCUSES the tab. A click-through opens and focuses;
   *  the Edit tab row offers a standing tab instead and passes `false`. */
  readonly activate?: boolean;
}
