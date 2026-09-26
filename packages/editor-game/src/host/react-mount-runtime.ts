/**
 * The react-world mount's OWN react — the sixth realm doorway, finally living
 * beside its five siblings (`r3f-entry-runtime`, `canvas-entry-runtime`,
 * `three-ingest-runtime`, `story-dom-runtime`, `story-three-preview-runtime`)
 * instead of inside the root resolver.
 *
 * Every one of those modules answers the same question for its own subject:
 * *whose copy of this library do we build with?* Under dev the answer
 * is always the editor's own static imports — one shared Vite instance plus the
 * root `vite.config.ts`'s `resolve.dedupe` already collapse the editor's and
 * the project's react onto one instance. Under the PACKAGED runtime the editor
 * shell is a prebuilt static bundle with its own baked-in `react`/`react-dom`,
 * disconnected from the separate project-rooted Vite instance the entry
 * component's hooks resolve `react` through — mounting with the shell's copy
 * produces two react instances and `useContext` throws on a `null` dispatcher
 * (confirmed live; see `packaged.ts`'s header).
 */

import {
  createElement,
  useEffect as reactUseEffect,
  useRef as reactUseRef,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { REACT_WORLD_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';

/**
 * The pieces of "react itself" a react-world mount needs: `createElement`/`createRoot`
 * to build and render `<Entry />`, and the hooks the editor's own wrappers use.
 */
export interface ReactRootMountRuntime {
  createElement: typeof createElement;
  createRoot: typeof createRoot;
  useEffect: typeof reactUseEffect;
  useRef: typeof reactUseRef;
  /** `react-dom`'s synchronous-flush escape hatch — the design-time react
   *  layer mount needs it from the SAME react-dom peer as `createRoot` above
   *  (both are entry points of the same installed package). */
  flushSync: typeof flushSync;
}

/** The dev default: this module's own static imports. */
function staticReactRootMountRuntime(): ReactRootMountRuntime {
  return {
    createElement,
    createRoot,
    useEffect: reactUseEffect,
    useRef: reactUseRef,
    flushSync,
  };
}

/**
 * Import + shape-check the packaged runtime's synthetic
 * `/__vgai-react-world-runtime` module (`vite-plugin-module-doorways.ts`,
 * registered only by `packaged.ts`'s project-rooted Vite instance and by
 * `vitest.config.ts` for test coverage — never by `dev.ts`/the root
 * `vite.config.ts`). A loud, named failure if the module resolves but is
 * malformed — never a silent fall-through that would re-introduce the dual-
 * instance bug it exists to prevent.
 */
async function loadPackagedReactRootMountRuntime(): Promise<ReactRootMountRuntime> {
  const mod = (await import(/* @vite-ignore */ REACT_WORLD_RUNTIME_PATH)) as {
    createElement?: unknown;
    createRoot?: unknown;
    useEffect?: unknown;
    useRef?: unknown;
    flushSync?: unknown;
  };
  if (
    typeof mod.createElement !== 'function' ||
    typeof mod.createRoot !== 'function' ||
    typeof mod.useEffect !== 'function' ||
    typeof mod.useRef !== 'function' ||
    typeof mod.flushSync !== 'function'
  ) {
    throw new Error(
      "The packaged runtime's synthetic react-world-runtime module " +
        `("${REACT_WORLD_RUNTIME_PATH}") did not export createElement/createRoot/useEffect/useRef/flushSync ` +
        'as functions — see vite-plugin-module-doorways.ts.',
    );
  }
  return {
    createElement: mod.createElement as typeof createElement,
    createRoot: mod.createRoot as typeof createRoot,
    useEffect: mod.useEffect as typeof reactUseEffect,
    useRef: mod.useRef as typeof reactUseRef,
    flushSync: mod.flushSync as typeof flushSync,
  };
}

let cachedPackagedReactRootMountRuntime: Promise<ReactRootMountRuntime> | null = null;

/**
 * Resolve the react-world mount's own react. A react world is an ISOLATED
 * `createRoot` (its own DOM subtree / react tree) that does NOT need to share
 * react with the editor's own UI — it only needs to be internally consistent
 * (the editor's wrapper and the project's entry component sharing ONE react
 * instance), which is exactly what the packaged branch restores.
 *
 * Memoized twice over: `isPackagedRuntime()` is itself session-memoized, and
 * the packaged module load is cached here, so this performs at most one
 * `/__editor/project` fetch and one dynamic import per editor session however
 * many react roots mount.
 */
export async function resolveReactRootMountRuntime(): Promise<ReactRootMountRuntime> {
  const packaged = await isPackagedRuntime();
  if (!packaged) return staticReactRootMountRuntime();
  if (!cachedPackagedReactRootMountRuntime) {
    cachedPackagedReactRootMountRuntime = loadPackagedReactRootMountRuntime();
  }
  return cachedPackagedReactRootMountRuntime;
}

/** Test-only: reset the packaged react-world mount runtime cache between
 *  tests that toggle `isPackagedRuntime()`'s own (separately memoized) result. */
export function resetReactRootMountRuntimeCacheForTest(): void {
  cachedPackagedReactRootMountRuntime = null;
}
