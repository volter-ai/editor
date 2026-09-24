/**
 * THE BUILD FAILURE REVEAL (`workspace.service`) — when a build finishes
 * FAILED, show the Build output channel so the log that explains it is on screen.
 * Only actionable failures open a utility automatically, and a build the user
 * started and that did not produce an artifact is the clearest of them; it
 * fires on the completing EDGE, never repeatedly.
 *
 * It was one of three watchers in the host's `installUtilityAutoOpen`. The
 * other two (a world that did not mount, a source write that failed) watch
 * the host's own state and stay there; this one watches THIS package's
 * session, so it belongs here.
 */
import type { ServiceContribution } from '@vgai/editor-sdk/services';
import {
  getBuildSession,
  showBuildOutput,
  subscribeBuildSession,
} from '../src/build/build-session';

export const point = 'workspace.service';

export const start: ServiceContribution['start'] = () => {
  let previousPhase = getBuildSession().phase;
  return subscribeBuildSession(() => {
    const session = getBuildSession();
    if (session.phase === 'done' && previousPhase !== 'done' && session.result?.ok === false) {
      showBuildOutput();
    }
    previousPhase = session.phase;
  });
};
