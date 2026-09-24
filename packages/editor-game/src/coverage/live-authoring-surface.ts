/**
 * Project-level authoring-surface coverage: the Edit documents and Content
 * pieces the resolved adapter table actually presents. Runtime capture alone
 * cannot answer this; a game may mount perfectly while exposing no authoring
 * surface at all.
 */

import {
  type CapabilityCoverageReport,
  deriveCapabilityCoverage,
} from '@editor/coverage/capability-coverage';
import { projectAdapterFacet } from '@editor/project-adapter';
import { getCurrentProject } from '@editor/project-manager';
import { authoringSurfaceFromTable } from '@editor/scene-document-plan';
import { projectStoriesReady } from '@editor/stories/story-registry';
import { availableWorkspaceDocuments } from '@editor/workspace-available-documents';
import { openWorkspaceDocuments } from '@editor/workspace-document-registry';

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
