/**
 * PORTABLE CSF's page-side lane, installed by the kit itself.
 *
 * WHAT IT INSTALLS, and which registry each piece reaches: the Content
 * scope's story-backed entries (`content-entry-source-registry.ts`), the named
 * states a component has (`component-states-registry.ts`), the addresses a
 * story opens under (`document-open-registry.ts`, through `story-opener.ts`),
 * the palette's one action per composed story (`chrome-registry.ts`), the
 * `capture-story-variants` session verb (`command-registry.ts`) and the
 * discovery lifecycle that finds a project's `*.stories.ts(x)` modules and
 * re-composes them on project switches, CSF file add/remove events and content
 * writes under `src/` (`project-story-discovery.ts`).
 *
 * WHY THE KIT AND NOT A PACKAGE. Portable CSF is the design-time state the
 * three, DOM and canvas surfaces all read — a file three siblings import lives
 * in none of them — so it is the kit's, not an integration's
 * (ARCHITECTURE-CORE §The target shape, "`stories` is NOT React"). The kit's
 * own CSF therefore needs no contribution to exist: these are direct
 * registrations, at the registries a contribution would have reached.
 *
 * THE COST, stated rather than rounded away: `story-registry.ts` imports
 * `storybook/internal/preview-api`, so the kit's boot closure carries
 * Storybook's preview API and every product pays for it — the closure meter's
 * bridge pin names the number.
 *
 * WHY EVERYTHING HERE IS EAGER. There is no lazy half to find: the content
 * source, the states source and the opener each reach `story-registry.ts`
 * directly, so deferring the discovery scan alone would move no file out of
 * the closure and would only make the install order harder to read.
 *
 * WHAT IS NOT HERE, and why. `@volter/editor-project/adapter`'s `StoriesProvider` is the
 * CONTRACT — an adapter says which named states a node has, in its own
 * vocabulary, and answers `unavailable()` itself — so it and
 * `components/InspectorStoriesSection.tsx` (the section that DRAWS a contract)
 * stay where they are, with `components/inspector-stories-gating.ts` and
 * `authoring/stories-scope.ts`. The `prefabsFromStories` finder is registered
 * by `project-adapter.ts`, the one sanctioned importer of the engine's finder
 * namespace.
 */

import { registerContributedActions } from '@volter/editor-sdk/kit/chrome-registry';
import { registerContributedCommands } from '@volter/editor-sdk/kit/command-registry';
import { registerComponentStatesSource } from '../component-states-registry';
import { registerContentEntrySource } from '../content-entry-source-registry';
import { refreshProjectAdapter } from '../project-adapter';
import { storyComponentContentSource } from './component-content-source';
import { componentStatesSource } from './component-states-source';
import { startProjectStoryDiscovery } from './project-story-discovery';
import { storyPaletteActions } from './story-actions';
import { STORY_CAPTURE_COMMAND_SOURCE, storyCaptureCommands } from './story-capture-command';
import { registerStoryOpener } from './story-opener';
import { subscribeProjectStoryModules } from './story-registry';

/** Install the whole lane. Returns the teardown, in reverse order. */
export function installStoryLane(): () => void {
  const stopSource = registerContentEntrySource(storyComponentContentSource);
  // The SIBLING question: the content source says what a component LOOKS
  // LIKE, this one what named STATES it has. Three authoring adapters used to
  // construct the second answer inside their own constructors, which is why
  // the story registry could not be reached through a seam at all.
  const stopStates = registerComponentStatesSource(componentStatesSource);
  const stopOpener = registerStoryOpener();
  const stopActions = registerContributedActions(storyPaletteActions);
  const stopCommands = registerContributedCommands(
    STORY_CAPTURE_COMMAND_SOURCE,
    storyCaptureCommands,
  );
  // The scan's own first step is to await the first authored viewport frame
  // (`waitForFirstViewportFrame`, for the recorded reason that a cold GPU must
  // not spend its first context on prefab thumbnails), so starting it at boot
  // costs nothing before that frame.
  const stopDiscovery = startProjectStoryDiscovery();
  // A SETTLED LEDGER IS ANNOUNCED HERE. The document table holds prefab rows
  // the `prefabsFromStories` finder produced, and the table re-resolves when
  // the finder SET changes — not when one finder's own data does.
  const stopTableRefresh = subscribeProjectStoryModules(() => {
    void refreshProjectAdapter();
  });
  return () => {
    stopTableRefresh();
    stopDiscovery();
    stopCommands();
    stopActions();
    stopOpener();
    stopStates();
    stopSource();
  };
}
