/**
 * Project Storybook discovery lifecycle. Story navigation is a project
 * capability, not a side effect of mounting a particular React world or
 * opening a Story document.
 *
 * `story-lane.ts` starts it, as one piece of the kit's own CSF install, and
 * never `EditorContext.tsx`: the editor's first render is not what decides
 * whether a project's stories are scanned.
 */

import { connectStoryFileEvents } from '../asset-events';
import { getCurrentProject, onProjectChange } from '../project-manager';
import { subscribeProjectModuleChange } from '../project-module-changes';
import { waitForFirstViewportFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { resetUndeclaredStoryMediumReports } from './story-declared-medium';
import { refreshProjectStories } from './story-registry';

/** Discover after the first authored frame, then re-discover on project
 * switches, CSF file add/remove events, and CONTENT writes to `src/**`.
 * The content trigger exists because a story renders the project's own
 * components: Apply-to-Component rewrote a prefab's default and the board
 * kept exhibiting the old one — the registry only ever heard about
 * added/removed story FILES, never a changed module (runhuman pass 43).
 * Dev tier: the HMR module-change channel. Browser tier: the storage
 * backend's own watch. A newer refresh supersedes an in-flight older pass. */
export function startProjectStoryDiscovery(): () => void {
  let refreshGeneration = 0;
  let stopped = false;
  const refresh = (changedPaths?: ReadonlySet<string>): void => {
    const generation = ++refreshGeneration;
    resetUndeclaredStoryMediumReports();
    // Story discovery feeds the Content panel and design boards; none of those
    // may hold the opening world behind evaluation of every prefab's CSF graph.
    // Wait for the first honest authored frame. There is deliberately no timer:
    // on a slow cold GPU, a five-second fallback fired while the Scene was still
    // constructing and moved the entire story graph back onto its critical path.
    // A genuinely broken viewport is not a reason to import every asset story in
    // the background; explicitly opening a Story/board calls
    // `refreshProjectStories` directly and remains its recovery door.
    void waitForFirstViewportFrame().then(() => {
      if (stopped || generation !== refreshGeneration) return;
      return refreshProjectStories(getCurrentProject(), undefined, {
        deferUndeclared: true,
        ...(changedPaths ? { changedPaths } : {}),
      });
    });
  };
  refresh();
  // Content writes arrive per keystroke-ish (autosave); coalesce a burst into
  // one rescan rather than re-importing every CSF module per write.
  let contentTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingContentPaths = new Set<string>();
  const refreshOnContentWrite = (path: string): void => {
    // Dev reports absolute paths, storage reports project-relative ones; the
    // filter is the same fact both ways: a source module under src/.
    const match = /(?:^|\/)(src\/.+\.(?:[cm]?tsx?|jsx?))$/.exec(path);
    if (!match) return;
    pendingContentPaths.add(match[1] ?? path);
    if (contentTimer !== null) clearTimeout(contentTimer);
    contentTimer = setTimeout(() => {
      contentTimer = null;
      const changed = pendingContentPaths;
      pendingContentPaths = new Set();
      refresh(changed);
    }, 1_000);
  };
  const stopModuleWatch = subscribeProjectModuleChange(refreshOnContentWrite);
  const stopProjectWatch = onProjectChange(() => refresh());
  const stopStoryFileWatch = connectStoryFileEvents(refresh);
  return () => {
    stopped = true;
    refreshGeneration += 1;
    if (contentTimer !== null) clearTimeout(contentTimer);
    stopModuleWatch();
    stopProjectWatch();
    stopStoryFileWatch();
  };
}
