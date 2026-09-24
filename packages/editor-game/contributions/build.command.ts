/**
 * `show-build` (`@vgai/editor-sdk/commands`) — the session verb that opens the
 * Build Profiles document. It sat in `command-listener.ts` because opening a
 * workspace document needed the live shell store; the host door's
 * `workspace.openContributedDocument` is that reach, so the verb travels with
 * the document it opens. Its relay budget is the host table's row it replaces
 * (`alwaysRefresh()`: opening the document changes what a caller reads next).
 */
import type { CommandContribution } from '@vgai/editor-sdk/commands';
import { openBuildProfilesDocument } from '../src/build/build-session';

export const point = 'workspace.command';

export const commands: CommandContribution['commands'] = {
  'show-build': {
    derivedRefresh: 'always',
    handle: () => {
      if (!openBuildProfilesDocument()) {
        return {
          ok: false,
          error: 'The Build Profiles document is not registered in this session.',
        };
      }
      return { ok: true };
    },
  },
};
