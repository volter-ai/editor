/**
 * Project-tool discovery LIFECYCLE (W0 — "project tool discovery must move
 * out of `BottomPanel` and into project/editor initialization").
 *
 * Until W0, `BottomPanel.tsx` anchored discovery in its own mount effects:
 * the dock was both the DISCOVERER and one consumer of project tools, so
 * inspector-placement tools only loaded because the bottom dock happened to
 * be mounted. This module owns that lifecycle instead; the editor shell
 * starts it once at editor initialization (`EditorContext.tsx`'s
 * `EditorProvider`), and the placement hosts (center tool documents,
 * workspace-utility registrations — `components/tool-documents.tsx`,
 * tool-loader.ts's `getGlobalTools`/`subscribeGlobalTools`) are plain
 * consumers of the already-discovered store — proven by
 * `test/project-tool-discovery.test.ts`, which runs discovery with no
 * component module imported at all.
 *
 * The pass itself still has editor-init ownership (`refreshProjectTools`,
 * tool-loader.ts), but its generic startup inventory waits until the opening
 * viewport has painted: discover after first presentation, re-discover when
 * the open project changes, and
 * re-discover on server-watched editor-lane add/unlink events (W6a).
 * Edit-HMR stays where it was — tool-loader's own module-level
 * `vgai:script-update` listener.
 */

import { connectToolFileEvents } from '@volter/editor-sdk/kit/asset-events';
import { onProjectChange } from '@volter/editor-sdk/kit/project-manager';
import { refreshProjectToolContributions } from './tool-loader';
import { waitForFirstViewportFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';

async function refreshAfterOpeningViewport(): Promise<void> {
  // Contribution modules are executable UI, not an index. A plain startup
  // used to import every unopened tool here, putting the template's full Data
  // Tables/react-data-grid graph into the same Vite queue as the Scene. Saved
  // tool documents still take workspace-state-persistence's explicit awaited
  // refresh path; this generic inventory can land after the authored frame.
  // Non-navigation DOMs (unit hosts and embedded documents) have no opening
  // page critical path to protect. In a real editor page the Navigation entry
  // is always present, including reloads and history restoration.
  const hasOpeningNavigation =
    typeof performance !== 'undefined' && performance.getEntriesByType('navigation').length > 0;
  if (hasOpeningNavigation) {
    await Promise.race([
      waitForFirstViewportFrame(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await refreshProjectToolContributions();
}

/**
 * Start the project-tool discovery lifecycle: one presentation-deferred
 * inventory pass, plus immediate re-discovery on project change and on
 * tool-file add/unlink events.
 * Returns a stop function that disconnects both subscriptions (the pass in
 * flight is left to finish — `refreshProjectTools` never throws).
 */
export function startProjectToolContributionDiscovery(): () => void {
  void refreshAfterOpeningViewport();
  const stopProjectWatch = onProjectChange(() => void refreshProjectToolContributions());
  const stopToolFileWatch = connectToolFileEvents(() => void refreshProjectToolContributions());
  return () => {
    stopProjectWatch();
    stopToolFileWatch();
  };
}
