/**
 * Project-level authoring-surface coverage: the Edit documents and Content
 * pieces the resolved adapter table actually presents. Runtime capture alone
 * cannot answer this; a game may mount perfectly while exposing no authoring
 * surface at all.
 */

import {
  type CapabilityCoverageReport,
  deriveCapabilityCoverage,
} from '../host/coverage/capability-coverage';
import { projectAdapterFacet } from '@volter/editor-core/project-adapter';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import { authoringSurfaceFromTable } from '@volter/editor-core/scene-document-plan';
import { projectStoriesReady } from '@volter/editor-core/stories/story-registry';
import { availableWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-available-documents';
import { openWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';

export function authoringSurfaceCoverage(): CapabilityCoverageReport | null {
  const facet = projectAdapterFacet();
  if (!facet || !projectStoriesReady()) return null;
  return deriveCapabilityCoverage({
    worldId: getCurrentProject()?.config.name ?? 'project',
    authoringSurface: authoringSurfaceFromTable(
      facet.scenes,
      openWorkspaceDocuments().map((document) => document.descriptor.id),
      availableWorkspaceDocuments().map((document) => document.descriptor.id),
    ),
  });
}
