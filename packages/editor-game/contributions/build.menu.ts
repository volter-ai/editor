/**
 * Window ▸ Build Profiles / Build Output — the two build surfaces in the
 * application menu. A build spawns `npm run <script>` on the session's own
 * server.
 */
import type { MenuContribution } from '@volter/editor-sdk/chrome';
import { openBuildProfilesDocument, showBuildOutput } from '../src/build/build-session';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'window',
  items: [
    {
      id: 'build-profiles',
      label: 'Build Profiles',
      testId: 'menu-build-profiles',
      execute: () => {
        openBuildProfilesDocument();
      },
    },
    {
      id: 'build-output',
      label: 'Build Output',
      testId: 'menu-build-output',
      execute: () => {
        showBuildOutput();
      },
    },
  ],
};
