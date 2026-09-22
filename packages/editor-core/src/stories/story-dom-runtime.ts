/** Storybook/React-DOM primitives selected from the graph that owns a
 *  project's CSF modules — the DOM-mount sibling of
 *  `story-three-preview-runtime.ts`, same seam, same reason (see
 *  `vite-plugin-module-doorways.ts`'s doc comment for the dual-React failure
 *  this closes). */

import {
  composeStories as staticComposeStories,
  setProjectAnnotations as staticSetProjectAnnotations,
} from '@storybook/react';
// The doorway's ADDRESS is the host's own statement about what it serves, and
// it is spelled ONCE — in `@volter/editor-sdk/host`, the published door. It used
// to be read from the plugin that SERVES it through a `@editor/../` specifier
// that stepped out of the editor's `src/` into its build tier, which is a
// reach no package gets; the plugin now imports the same constant.
import { STORY_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { flushSync as staticFlushSync } from 'react-dom';
import { createRoot as staticCreateRoot } from 'react-dom/client';
import { isPackagedRuntime } from '../packaged-runtime';

export interface StoryDomRuntime {
  readonly packaged: boolean;
  readonly composeStories: typeof staticComposeStories;
  readonly setProjectAnnotations: typeof staticSetProjectAnnotations;
  readonly createRoot: typeof staticCreateRoot;
  readonly flushSync: typeof staticFlushSync;
}

const STATIC_RUNTIME: StoryDomRuntime = {
  packaged: false,
  composeStories: staticComposeStories,
  setProjectAnnotations: staticSetProjectAnnotations,
  createRoot: staticCreateRoot,
  flushSync: staticFlushSync,
};

let cachedPackagedRuntime: Promise<StoryDomRuntime> | null = null;

async function loadPackagedRuntime(): Promise<StoryDomRuntime> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ STORY_RUNTIME_PATH)) as Record<string, unknown>;
  } catch (err) {
    // The one legitimate cause besides a server bug: the opened project has
    // CSF files but no installed `@storybook/react` (the virtual module's
    // re-export then fails to resolve). Name it — this error surfaces
    // per-module through composeProjectStories/mountIsolatedStory callers.
    throw new Error(
      'The story runtime failed to load from the project module graph — is `@storybook/react` ' +
        `installed in the project? (${String(err instanceof Error ? err.message : err)})`,
    );
  }
  for (const name of ['composeStories', 'setProjectAnnotations', 'createRoot', 'flushSync']) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `The packaged story runtime did not export ${name} as a function — see ` +
          'vite-plugin-module-doorways.ts.',
      );
    }
  }
  return {
    packaged: true,
    composeStories: mod['composeStories'] as typeof staticComposeStories,
    setProjectAnnotations: mod['setProjectAnnotations'] as typeof staticSetProjectAnnotations,
    createRoot: mod['createRoot'] as typeof staticCreateRoot,
    flushSync: mod['flushSync'] as typeof staticFlushSync,
  };
}

export async function resolveStoryDomRuntime(): Promise<StoryDomRuntime> {
  if (!(await isPackagedRuntime())) return STATIC_RUNTIME;
  if (!cachedPackagedRuntime) cachedPackagedRuntime = loadPackagedRuntime();
  return cachedPackagedRuntime;
}

export function resetStoryDomRuntimeCacheForTest(): void {
  cachedPackagedRuntime = null;
}
