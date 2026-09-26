import { registerAvailableWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-available-documents';
/**
 * THE `UI` BOARD's DOCUMENT — what `ui-component-board.ts` installs, kept in
 * its own module so the registration's eager closure is the verdict and
 * nothing else. This half reaches the host's whole root-document machinery
 * (and through it the design-time layer stack); loading that at contribution
 * time for a project that has no dom stories is what the lazy `install`
 * contract exists to avoid — the 2D board's own reason, applied to all three.
 *
 * It was `openUiBoard` inside `@editor/components/world-documents.tsx`, one
 * arm of a literal table of three media that the host reconciled against a
 * CSF census it also imported. What is dom-specific about it — that its
 * medium is `dom`, that it exists because this project has `dom` stories,
 * what a human should be told when it does not, and that its captured frame
 * round-trips through the remembered portable story — travels here. What is
 * HOST machinery stays host and is called through: `RootDocumentContent` (the
 * board substrate every root document mounts, which draws the infinite canvas,
 * the selection overlay, the rulers and the surface-state explanation) and the
 * workspace document registry.
 *
 * A DOM ROOT IS NOT WHY THIS BOARD EXISTS — it only decides what the board is
 * a document OF. With a dom root the board carries that root's provenance and
 * its route, so `activateRootDocument(rootId)` reaches it; without one the
 * board is still the project's UI component gallery, mounted rootless on
 * `projectStoryBoardDescriptor()`.
 */

import {
  designTimeRootDescriptors,
  projectStoryBoardDescriptor,
  rememberedPortableStory,
} from '@volter/editor-core/authoring/design-time-layers';
import type { ComponentBoardContext } from '@volter/editor-sdk/kit/component-board-registry';
import { RootDocumentContent } from '@volter/editor-core/components/world-documents';
import type { DocumentPreviewSource } from '@volter/editor-sdk/kit/document-preview-source';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import {
  getProjectPreviewStories,
  subscribeProjectStoryModules,
} from '@volter/editor-core/stories/story-registry';
import { UI_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import type { WorkspaceDocumentContentProps } from '@volter/editor-sdk/kit/workspace-document-registry';

import { UI_COMPONENTS_TITLE } from './ui-board-title';

const uiCanvasPreview: DocumentPreviewSource = {
  revision: () =>
    JSON.stringify(getProjectPreviewStories().map(({ id, modulePath }) => [id, modulePath])),
  subscribe: subscribeProjectStoryModules,
  capture: async ({ width, height }) => {
    const { captureDomStoryBoardPreview } = await import('@volter/editor-core/stories/story-capture');
    return captureDomStoryBoardPreview(width, height);
  },
};

export function installUiBoard({ store, composite }: ComponentBoardContext): void {
  const descriptor =
    designTimeRootDescriptors(composite).find((root) => root.kind === 'dom') ??
    projectStoryBoardDescriptor();
  const Content = (props: WorkspaceDocumentContentProps) => (
    <RootDocumentContent {...props} composite={composite} descriptor={descriptor} store={store} />
  );
  registerAvailableWorkspaceDocument(
    {
      id: UI_COMPONENTS_DOCUMENT_ID,
      title: UI_COMPONENTS_TITLE,
      kind: 'world',
      workspaceRole: 'authored-subject',
      provenance: {
        rootId: descriptor.worldId,
        ...(descriptor.path ? { sourcePath: descriptor.path } : {}),
      },
      Content,
      preview: uiCanvasPreview,
      presentation: () => {
        // Round-trip the board's active frame: a captured view names the
        // story it was on (the design ledger's board story selector).
        const projectRoot = getCurrentProject()?.rootPath;
        const story = projectRoot
          ? rememberedPortableStory(projectRoot, descriptor.worldId)
          : undefined;
        return {
          kind: 'workspace',
          id: UI_COMPONENTS_DOCUMENT_ID,
          ...(story ? { story } : {}),
        };
      },
    },
    // A board NEVER steals focus — presence is answered asynchronously, so a
    // board that arrives late would otherwise yank the author off whatever
    // they were looking at (measured: the canvas root's `Scene` opened, then a
    // board landed a second later and took the tab).
    {
      category: 'canvas',
      default: !composite
        .childAdapters()
        .some((root) => root.kind === 'three' || root.kind === 'canvas'),
    },
  );
}
