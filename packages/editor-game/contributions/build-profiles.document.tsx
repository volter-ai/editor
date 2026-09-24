/**
 * BUILD PROFILES (`workspace.document`) — the project's build configuration
 * as a center document: the build-role targets, the manifest fields a build
 * reads, and the Build trigger. A document rather than a dialog because the
 * configuration is a persistent authored surface (it writes
 * `vgai.project.json` through the history service) someone tunes and re-runs,
 * and because a modal would block the viewport while a build streams.
 *
 * It ships with `@vgai/game`, so a folder of models has no Build Profiles tab
 * and no Build button at all.
 */

import type { ToolContributionProps } from '@vgai/editor-sdk/contributions';
import { BuildProfilesPanel } from '../src/build/BuildProfilesPanel';

export const point = 'workspace.document';
export const title = 'Build Profiles';

export default function BuildProfilesDocument(_props: ToolContributionProps) {
  return <BuildProfilesPanel />;
}
