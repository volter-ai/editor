/**
 * The React, `@pixi/react` and `pixi.js` a project's canvas world is mounted
 * with — the sibling of `r3f-entry-runtime.ts`.
 *
 * The packaged editor's UI is prebuilt with its own React, `@pixi/react` and
 * `pixi.js`, while project modules are transformed by a separate,
 * project-rooted Vite server. Mounting a project component with the UI
 * bundle's reconciler crosses those graphs: the reconciler's hooks and the
 * component's hooks come from two Reacts, the tree never commits, and the
 * canvas mount fails its own first-commit ceiling ten seconds later. See
 * `vite-plugin-module-doorways.ts` for the measured failure.
 *
 * `pixi.js` and `@pixi/react` are dynamic-imported on the checkout branch,
 * deliberately: a static import would put the Pixi renderer and reconciler in
 * every editor bundle, including one opening a three-only project.
 */

import type { RootAdapter } from '@volter/editor-project/adapter';
import { CANVAS_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';
import type * as PIXI from 'pixi.js';
import { createElement, Fragment, useEffect, useLayoutEffect } from 'react';
import { type CanvasRuntime, resolveCanvasEntryAdapter } from './roots/canvas-root';

/**
 * The `pixi.js` module namespace a canvas surface constructs and class-checks
 * with. Every editor-side collaborator of one mounted canvas world takes THIS,
 * never a static import — see `../vite-plugin-module-doorways.ts` for the four
 * measured failures a second namespace causes.
 */
export type CanvasPixiNamespace = typeof PIXI;

let cachedRuntime: Promise<CanvasRuntime> | null = null;

const DOORWAY_MEMBERS = [
  'createElement',
  'Fragment',
  'useEffect',
  'useLayoutEffect',
  'createPixiRoot',
  'extendPixi',
  'projectPixi',
] as const;

async function packagedRuntime(): Promise<CanvasRuntime> {
  const mod = (await import(/* @vite-ignore */ CANVAS_RUNTIME_PATH)) as Record<string, unknown>;
  const missing = DOORWAY_MEMBERS.filter((name) => mod[name] === undefined || mod[name] === null);
  if (missing.length > 0) {
    throw new Error(
      `The packaged runtime's synthetic canvas module did not export ${missing.join(', ')} — ` +
        'see CANVAS_DOORWAY in vite-plugin-module-doorways.ts.',
    );
  }
  return {
    createElement: mod['createElement'] as CanvasRuntime['createElement'],
    Fragment: mod['Fragment'] as CanvasRuntime['Fragment'],
    useEffect: mod['useEffect'] as CanvasRuntime['useEffect'],
    useLayoutEffect: mod['useLayoutEffect'] as CanvasRuntime['useLayoutEffect'],
    createRoot: mod['createPixiRoot'] as CanvasRuntime['createRoot'],
    extend: mod['extendPixi'] as CanvasRuntime['extend'],
    pixi: mod['projectPixi'] as CanvasPixiNamespace,
  };
}

async function checkoutRuntime(): Promise<CanvasRuntime> {
  const [pixiReact, pixi] = await Promise.all([import('@pixi/react'), import('pixi.js')]);
  return {
    createElement,
    Fragment,
    useEffect,
    useLayoutEffect,
    createRoot: pixiReact.createRoot,
    extend: pixiReact.extend,
    pixi,
  };
}

/** The canvas runtime of the graph a canvas world mounts in, loaded once per session. */
async function canvasRuntime(): Promise<CanvasRuntime> {
  cachedRuntime ??= (async () => ((await isPackagedRuntime()) ? packagedRuntime() : checkoutRuntime()))();
  return cachedRuntime;
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
  return (await canvasRuntime()).pixi;
}

/** The canvas entry adjudicator, handed the runtime of the graph the world mounts in. */
export async function resolveCanvasEntryAdapterForEditor(
  entryModule: unknown,
  rootId: string,
): Promise<RootAdapter<'canvas'> | null> {
  return resolveCanvasEntryAdapter(entryModule, rootId, await canvasRuntime());
}
