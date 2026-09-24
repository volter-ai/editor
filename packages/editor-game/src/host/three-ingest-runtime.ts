/**
 * Resolve the THREE primitives an INGEST root's capture trap is installed on
 * from the same module graph as the game's own entry — the three sibling of
 * `canvas-entry-runtime.ts`'s `resolveCanvasPixiForEditor`.
 *
 * See `../vite-plugin-module-doorways.ts` for the measured failure this
 * closes and for why the ingest lane does not borrow `/__vgai-r3f-runtime`.
 *
 * A mount site resolves this ONCE and hands what it gets to everything it
 * builds for that game. Nothing further down reaches for a static import: a
 * namespace that could differ between two collaborators of the same game is
 * the bug, not the seam.
 */

import * as shellThree from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { THREE_INGEST_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-core/packaged-runtime';

/**
 * THE three of the graph an ingested game's modules resolve — the project's
 * under the packaged runtime, this bundle's own copy otherwise (where one
 * Vite instance's `resolve.dedupe` has already made them the same object, so
 * the packaged branch's absence is not a degrade).
 *
 * The addons travel with the namespace deliberately: they are files inside
 * the same `three` package tree, so "which three?" and "which EffectComposer?"
 * are ONE question and answering them separately is how they drift.
 */
export interface ThreeIngestRuntime {
  readonly three: typeof shellThree;
  readonly EffectComposer: typeof EffectComposer;
  readonly CSS3DRenderer: typeof CSS3DRenderer;
}

const shellRuntime: ThreeIngestRuntime = {
  three: shellThree,
  EffectComposer,
  CSS3DRenderer,
};

let cachedPackagedRuntime: Promise<ThreeIngestRuntime> | null = null;

async function packagedRuntime(): Promise<ThreeIngestRuntime> {
  const mod = (await import(/* @vite-ignore */ THREE_INGEST_RUNTIME_PATH)) as {
    projectThree?: unknown;
    EffectComposer?: unknown;
    CSS3DRenderer?: unknown;
  };
  const missing = (['projectThree', 'EffectComposer', 'CSS3DRenderer'] as const).filter(
    (name) => mod[name] === undefined || mod[name] === null,
  );
  if (missing.length > 0) {
    // Loud, not a fallback to the shell's copy: falling back would put the
    // trap on a `WebGLRenderer.prototype` the game never constructs and the
    // mount would then fail 10 seconds later saying the game "bundles its own
    // (un-shared) copy of three" — a sentence about the GAME, for a defect in
    // this host.
    throw new Error(
      "The packaged runtime's synthetic three-ingest module did not export " +
        `${missing.join(', ')} — see vite-plugin-module-doorways.ts.`,
    );
  }
  return {
    three: mod.projectThree as typeof shellThree,
    EffectComposer: mod.EffectComposer as typeof EffectComposer,
    CSS3DRenderer: mod.CSS3DRenderer as typeof CSS3DRenderer,
  };
}

export async function resolveThreeIngestRuntimeForEditor(): Promise<ThreeIngestRuntime> {
  if (!(await isPackagedRuntime())) return shellRuntime;
  if (!cachedPackagedRuntime) cachedPackagedRuntime = packagedRuntime();
  return cachedPackagedRuntime;
}
