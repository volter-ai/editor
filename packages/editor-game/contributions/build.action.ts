/**
 * The palette's BUILD actions — `Build for Web (itch.io)` and
 * `Build for Desktop (Steam)`, both opening the Build Profiles document where
 * the target is chosen and the build is run.
 */
import type { ActionContribution } from '@vgai/editor-sdk/chrome';
import { openBuildProfilesDocument } from '../src/build/build-session';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = [
  {
    id: 'build.web',
    label: 'Build for Web (itch.io)',
    execute: () => {
      openBuildProfilesDocument();
    },
  },
  {
    id: 'build.steam',
    label: 'Build for Desktop (Steam)',
    execute: () => {
      openBuildProfilesDocument();
    },
  },
];
