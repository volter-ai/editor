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

import { WorldProvider as EngineWorldProvider } from '@volter/game-runtime/react/world-state';
import type { Game } from '@volter/game-runtime/runtime/game';
import {
  type ComponentType,
  createElement,
  useEffect as reactUseEffect,
  useRef as reactUseRef,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { REACT_WORLD_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';

/**
 * The pieces of "react itself" a react-world mount needs:
 * `createElement`/`createRoot` (to build + render the `<WorldProvider><Entry/>
 * </WorldProvider>` tree) and the engine-published `WorldProvider`.
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
  engineWorldProvider: ComponentType<{ game: Game; children?: unknown }>;
}

/** The dev default: this module's own static imports. */
function staticReactRootMountRuntime(): ReactRootMountRuntime {
  return {
    createElement,
    createRoot,
    useEffect: reactUseEffect,
    useRef: reactUseRef,
    flushSync,
    engineWorldProvider: EngineWorldProvider as unknown as ComponentType<{
      game: Game;
      children?: unknown;
    }>,
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
    EngineWorldProvider?: unknown;
  };
  if (
    typeof mod.createElement !== 'function' ||
    typeof mod.createRoot !== 'function' ||
    typeof mod.useEffect !== 'function' ||
    typeof mod.useRef !== 'function' ||
    typeof mod.flushSync !== 'function' ||
    typeof mod.EngineWorldProvider !== 'function'
  ) {
    throw new Error(
      "The packaged runtime's synthetic react-world-runtime module " +
        `("${REACT_WORLD_RUNTIME_PATH}") did not export createElement/createRoot/useEffect/useRef/flushSync/` +
        'EngineWorldProvider as functions — see vite-plugin-module-doorways.ts.',
    );
  }
  return {
    createElement: mod.createElement as typeof createElement,
    createRoot: mod.createRoot as typeof createRoot,
    useEffect: mod.useEffect as typeof reactUseEffect,
    useRef: mod.useRef as typeof reactUseRef,
    flushSync: mod.flushSync as typeof flushSync,
    engineWorldProvider: mod.EngineWorldProvider as ComponentType<{
      game: Game;
      children?: unknown;
    }>,
  };
}

let cachedPackagedReactRootMountRuntime: Promise<ReactRootMountRuntime> | null = null;

/**
 * Resolve the react-world mount's own react. A react world is an ISOLATED
 * `createRoot` (its own DOM subtree / react tree) that does NOT need to share
 * react with the editor's own UI — it only needs to be internally consistent
 * (the wrapper + `WorldProvider` + the project's entry component all sharing
 * ONE react instance), which is exactly what the packaged branch restores.
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

/**
 * `WorldProvider` is the canonical engine export from
 * `@volter/game-runtime/react/world-state`, reached through the mount runtime above so
 * the project's copy is used under the packaged runtime. Hosts and game
 * entries therefore share ONE module and one React context identity.
 *
 * WHY THIS IS AN ENGINE EXPORT AND NOT A PER-PROJECT FILE — a finding verified
 * empirically, kept because the trap it describes is still live for anyone
 * tempted to reintroduce a project-local provider. Back when each project
 * owned its own bridge module, a hand-built runtime `import('/@fs/' +
 * projectRoot + '/…')` for it did NOT reliably land on the same module
 * instance a react-world entry's own STATIC relative import resolved to:
 * Vite's dev server treated the two differently at the HTTP level (a
 * query-string divergence, confirmed by logging `import.meta.url` inside two
 * otherwise-identical fetches) even though both targeted the identical file on
 * disk, and browser ES module identity is keyed by the exact request URL. That
 * alone produced TWO separate `createContext()` calls. The whole apparatus is
 * gone: one engine module, no per-project path to diverge on.
 */
export async function resolveWorldProviderForProject(): Promise<
  ComponentType<{ game: Game; children?: unknown }>
> {
  const runtime = await resolveReactRootMountRuntime();
  return runtime.engineWorldProvider;
}

/** Test-only: reset the packaged react-world mount runtime cache between
 *  tests that toggle `isPackagedRuntime()`'s own (separately memoized) result. */
export function resetReactRootMountRuntimeCacheForTest(): void {
  cachedPackagedReactRootMountRuntime = null;
}
