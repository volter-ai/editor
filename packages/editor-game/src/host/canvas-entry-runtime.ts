/**
 * Resolve the canvas entry adapter from the same module graph as project
 * worlds — the `@pixi/react` sibling of `r3f-entry-runtime.ts`.
 *
 * The packaged editor's UI is prebuilt with its own React, `@pixi/react` and
 * `pixi.js`, while project modules are transformed by a separate,
 * project-rooted Vite server. Building a project component's adapter with the
 * UI bundle's factory crosses those graphs: the reconciler's hooks and the
 * component's hooks come from two Reacts, the tree never commits, and
 * the canvas mount fails its own first-commit ceiling ten seconds
 * later. See `../vite-plugin-module-doorways.ts` for the measured failure.
 *
 * `@volter/game-runtime/canvas-react` is dynamic-imported on BOTH branches, deliberately: a
 * static import would put `pixi.js` and the Pixi reconciler in every editor
 * bundle, including one opening a three-only project — the same reason the
 * call sites this replaces were already dynamic.
 */

import type { resolveCanvasEntryAdapter } from '@volter/game-runtime/canvas-react';
import type { RootAdapter } from '@volter/editor-project/adapter';
import type * as PIXI from 'pixi.js';
import { CANVAS_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';

type CanvasEntryResolver = typeof resolveCanvasEntryAdapter;

/**
 * The `pixi.js` module namespace a canvas surface constructs and class-checks
 * with. Every editor-side collaborator of one mounted canvas world takes THIS,
 * never a static import — see `../vite-plugin-module-doorways.ts` for the four
 * measured failures a second namespace causes.
 */
export type CanvasPixiNamespace = typeof PIXI;

interface PackagedCanvasRuntime {
  readonly resolve: CanvasEntryResolver;
  readonly projectPixi: CanvasPixiNamespace;
}

let cachedPackagedRuntime: Promise<PackagedCanvasRuntime> | null = null;

async function packagedRuntime(): Promise<PackagedCanvasRuntime> {
  const mod = (await import(/* @vite-ignore */ CANVAS_RUNTIME_PATH)) as {
    resolveCanvasEntryAdapter?: unknown;
    projectPixi?: unknown;
  };
  if (typeof mod.resolveCanvasEntryAdapter !== 'function') {
    throw new Error(
      "The packaged runtime's synthetic canvas module did not export " +
        '`resolveCanvasEntryAdapter` — see vite-plugin-module-doorways.ts.',
    );
  }
  if (typeof mod.projectPixi !== 'object' || mod.projectPixi === null) {
    throw new Error(
      "The packaged runtime's synthetic canvas module did not export " +
        '`projectPixi` — see vite-plugin-module-doorways.ts.',
    );
  }
  return {
    resolve: mod.resolveCanvasEntryAdapter as CanvasEntryResolver,
    projectPixi: mod.projectPixi as CanvasPixiNamespace,
  };
}

/**
 * THE `pixi.js` OF THE GRAPH A CANVAS WORLD MOUNTS IN — the project's under the
 * packaged runtime, this bundle's own copy otherwise.
 *
 * Dynamic on BOTH branches for the reason this module's header gives: a static
 * `pixi.js` import here would put the whole renderer in every editor bundle,
 * including one opening a three-only project.
 *
 * A mount site resolves this ONCE and hands it to everything it builds for that
 * world. Nothing further down calls it per node — a namespace that could differ
 * between two collaborators of the same surface is the bug, not the seam.
 */
export async function resolveCanvasPixiForEditor(): Promise<CanvasPixiNamespace> {
  if (!(await isPackagedRuntime())) return import('pixi.js');
  if (!cachedPackagedRuntime) cachedPackagedRuntime = packagedRuntime();
  return (await cachedPackagedRuntime).projectPixi;
}

/** The adjudicator `resolveCanvasEntryAdapter` — from the PROJECT's graph
 *  under the packaged runtime, from this bundle's own engine copy otherwise. */
export async function resolveCanvasEntryAdapterForEditor(
  entryModule: unknown,
  rootId: string,
): Promise<RootAdapter<'canvas'> | null> {
  if (!(await isPackagedRuntime())) {
    const { resolveCanvasEntryAdapter } = await import('@volter/game-runtime/canvas-react');
    return resolveCanvasEntryAdapter(entryModule, rootId);
  }
  if (!cachedPackagedRuntime) cachedPackagedRuntime = packagedRuntime();
  return (await cachedPackagedRuntime).resolve(entryModule, rootId);
}
