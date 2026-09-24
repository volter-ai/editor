/** React/Fiber primitives selected from the graph that owns a project story. */

import { createRoot as staticCreateR3FRoot, extend as staticExtendThree } from '@react-three/fiber';
import { createElement as staticCreateElement } from 'react';
import * as staticThree from 'three';
import { R3F_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';

export interface StoryThreePreviewRuntime {
  readonly packaged: boolean;
  readonly createElement: typeof staticCreateElement;
  readonly createR3FRoot: typeof staticCreateR3FRoot;
  readonly extendThree: typeof staticExtendThree;
  readonly three: typeof staticThree;
}

const STATIC_RUNTIME: StoryThreePreviewRuntime = {
  packaged: false,
  createElement: staticCreateElement,
  createR3FRoot: staticCreateR3FRoot,
  extendThree: staticExtendThree,
  three: staticThree,
};

let cachedPackagedRuntime: Promise<StoryThreePreviewRuntime> | null = null;

async function loadPackagedRuntime(): Promise<StoryThreePreviewRuntime> {
  const mod = (await import(/* @vite-ignore */ R3F_RUNTIME_PATH)) as Record<string, unknown>;
  for (const name of ['createElement', 'createR3FRoot', 'extendThree']) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `The packaged R3F preview runtime did not export ${name} as a function — see ` +
          'vite-plugin-module-doorways.ts.',
      );
    }
  }
  if (typeof mod['projectThree'] !== 'object' || mod['projectThree'] === null) {
    throw new Error(
      'The packaged R3F preview runtime did not export projectThree — see ' +
        'vite-plugin-module-doorways.ts.',
    );
  }
  return {
    packaged: true,
    createElement: mod['createElement'] as typeof staticCreateElement,
    createR3FRoot: mod['createR3FRoot'] as typeof staticCreateR3FRoot,
    extendThree: mod['extendThree'] as typeof staticExtendThree,
    three: mod['projectThree'] as typeof staticThree,
  };
}

export async function resolveStoryThreePreviewRuntime(): Promise<StoryThreePreviewRuntime> {
  if (!(await isPackagedRuntime())) return STATIC_RUNTIME;
  if (!cachedPackagedRuntime) cachedPackagedRuntime = loadPackagedRuntime();
  return cachedPackagedRuntime;
}
