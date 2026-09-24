/**
 * The editor's MODULE DOORWAYS: synthetic ES modules that statically re-export
 * a fixed set of members, so the editor SHELL reaches a package through the
 * OPENED PROJECT's Vite graph instead of through its own prebuilt bundle.
 *
 * One plugin, one declarative table per doorway. Everything below is the same
 * two-line mechanism — `resolveId` maps `/__vgai-<name>` to a `\0`-prefixed
 * virtual id, `load` answers with a literal string of `export … from '<bare
 * specifier>'` lines — and the ONLY thing that ever differed between the five
 * was the specifier table, so the tables are the module's data and the plugin
 * machinery is written once.
 *
 * ## Why a doorway exists at all
 *
 * Under the PACKAGED runtime (`server/packaged.ts` — a `@vgai/editor` npm
 * package with no monorepo checkout) the editor shell is a prebuilt production
 * bundle with its own React, three, `@react-three/fiber`, `pixi.js`,
 * `@pixi/react` and `@storybook/react` inlined, while the opened project's
 * source is served by a SEPARATE, project-rooted Vite instance that resolves
 * those same bare specifiers from the PROJECT's `node_modules`. A bare static
 * `import` in shell code therefore holds a DIFFERENT module instance than the
 * objects it is pointed at. A doorway is how the shell asks the project's graph
 * for the same identity the project itself resolved: the synthetic body's
 * specifiers go through that instance's own transform-time resolver and its own
 * `optimizeDeps` prebundle cache, exactly the way a project entry module's own
 * `import … from 'react'` does.
 *
 * `dev.ts` has no such split — one Vite
 * instance, and the repo-root `vite.config.ts`'s `resolve.dedupe` already
 * collapses `react`/`three`/`pixi.js`/`@pixi/react`/`@react-three/fiber` onto
 * one instance — so this plugin is registered ONLY on the packaged runtime's
 * project-rooted instance, plus the root `vitest.config.ts` (two doorways
 * there, so the branch is exercisable headlessly).
 *
 * ## Why the doorways stay SEPARATE modules
 *
 * The plugin merges; the MODULES deliberately do not. Each doorway is fetched
 * only when the lane that needs it actually mounts, so its packages are only
 * ever demanded of a project that has them:
 *
 *  - a DOM/canvas-only project must not resolve `@react-three/fiber` merely to
 *    mount an ordinary React root (which is why the r3f rows are not on the
 *    react-world doorway — keeping them there meant a valid 2D project could
 *    not boot the packaged editor without installing an unrelated renderer
 *    stack), nor a three-only project `@pixi/react`;
 *  - an INGEST root's whole premise is a game that brought its OWN stack, so
 *    the three-ingest doorway does not borrow `/__vgai-r3f-runtime` even though
 *    that module already publishes `projectThree` and reusing it would be one
 *    line: a vendored plain-three game has no Fiber installed, and demanding it
 *    would break the exact case the doorway closes;
 *  - `@storybook/react` is a devDependency a project may drop, so a project
 *    with no stories must never pay for it and a project missing it must lose
 *    only the story lane (with an error naming the missing package, surfaced by
 *    `src/story-dom-runtime.ts`), never react-world mounting.
 *
 * ## The measured defects, per doorway
 *
 * These are the failures each row set was bought with. None of them reproduce
 * from a checkout — every one needs a real packaged build.
 *
 * ### `/__vgai-react-world-runtime` (`REACT_WORLD_DOORWAY`)
 *
 * Mounting a react world with `createRoot` from the editor's own bundle while
 * the entry component's hooks ran against the project's `react` produced two
 * React module instances: `useContext`/`useState` read and wrote different
 * internal singletons, and `useContext` threw on a `null` dispatcher (confirmed
 * live; see `server/packaged.ts`'s header, "React-world OID authoring parity",
 * and `src/react-mount-runtime.ts`'s `resolveReactRootMountRuntime`).
 *
 * A real-browser run then caught a SECOND bug the wiring tests could not see:
 * `flushSync` must come from bare `react-dom`, and this instance's
 * `optimizeDeps` uses a project-entry-scoped crawl, so an injected bare
 * specifier the crawl cannot see is served RAW — `react-dom`'s package entry
 * re-exports its implementation through a `NODE_ENV`-conditional `require(...)`
 * the raw-serve path cannot see through. Because a doorway is ONE ES module
 * with several `export … from` statements, that single broken re-export sinks
 * the whole dynamic import, breaking even Play mode's `ReactRootAdapter.mount()`
 * which never touches `flushSync`:
 *
 *   SyntaxError: The requested module '/node_modules/react-dom/index.js'
 *     does not provide an export named 'flushSync'
 *
 * — gone once bare `react-dom` was in `optimizeDeps.include`, in the same run.
 * That is what `EDITOR_RUNTIME_MODULE_SPECIFIERS` (below, read by
 * `server/project-optimize-deps-entries.ts`) exists to keep true.
 *
 * WHICH react the graph then points at is not this module's business and has
 * changed: `packaged.ts` redirects every React specifier in this graph to the
 * editor SHELL's own built React chunks (`vite-plugin-shared-react.ts`), so the
 * page has exactly one React the way `dev.ts` always did. The contract is
 * unchanged and still load-bearing — the mount call and the entry component's
 * hooks must resolve `react` through the SAME graph, whatever that graph points
 * at.
 *
 * ### `/__vgai-canvas-runtime` (`CANVAS_DOORWAY`)
 *
 * `src/authoring/canvas-design-mount.ts` and `src/binding-resolver.ts` are
 * SHELL modules. A bare `await import('@vgai/game-runtime/canvas-react')` there built the
 * adapter — and thus called `createRoot` and `extend` — with the SHELL's
 * copies, then rendered the PROJECT's world component inside it. Measured on a
 * packaged build against `examples/retro-shooter`:
 *
 *   Invalid hook call … more than one copy of React in the same app   (×12)
 *   TypeError: Cannot read properties of null (reading 'useSyncExternalStore')
 *   [design-time-layers] world "world" (canvas) failed to mount:
 *     canvas world "world": no first commit within 10s
 *
 * — the canvas world never design-mounted, and the Scene view was a Boundary
 * node.
 *
 * `projectPixi` rides along because mounting is only half of what the editor
 * does to a canvas world. Everything AFTERWARDS — the authoring adapter that
 * duplicates a node, the drop that loads a texture, the capture trap an ingest
 * root installs, the preview that photographs a selection — is SHELL code
 * holding `pixi.js` VALUES, and those values came from a different module
 * instance than the objects they point at. Four measured failures:
 *
 *  - `object.constructor === Container` is FALSE for every project node, so
 *    `PixiAuthoringAdapter`'s duplicate gate refuses a plain project Container
 *    with the sentence it reserves for a game's own subclass;
 *  - `Assets.load` reads the SHELL's cache, so an image dropped on the world is
 *    fetched and decoded a second time into a texture the project's own loader
 *    has never heard of;
 *  - `installSceneCapture2D` traps the SHELL's `Application.prototype`, which an
 *    ingested game never calls — MEASURED on a packaged build of the
 *    `bunnymark` ingest fixture, the mount died with the engine's own words:
 *    "the game never rendered, or it bundles its own (un-shared) copy of
 *    pixi.js" (8s of visible time, then the whole root failed by name);
 *  - a selection preview clones a project subtree through a five-way
 *    `instanceof` chain of SHELL classes, which every branch misses, and renders
 *    the result on a SHELL `Application` against the project's GPU textures.
 *
 * So, stated once: A CANVAS SURFACE HOLDS ONE PIXI NAMESPACE, and it is the one
 * the graph its objects came from resolved. The mount site chooses it
 * (`resolveCanvasPixiForEditor`) and hands it to whatever it constructs;
 * nothing downstream reaches for a static import. `CanvasHostContext` carries
 * no renderer namespace (the mount calls `extend(PIXI)` with its OWN `pixi.js`
 * import, which is the project's once this doorway resolves it), so the MOUNT
 * needs nothing further.
 *
 * ### `/__vgai-three-ingest-runtime` (`THREE_INGEST_DOORWAY`)
 *
 * `src/authoring/ingest-root-adapter.ts` is SHELL code, and it installed the
 * render accessor trap on the `three` it statically imported — while the
 * ingested game's entry is served as `/@fs/<project>/…` by the project-rooted
 * Vite and therefore resolves the PROJECT's `three`. The trap sat on a
 * `WebGLRenderer.prototype` the game never constructs. The engine states the
 * invariant in `adapter/ingest/scene-capture.ts`'s own header — "every trap
 * must be installed on the SAME `three` module/addon instance the game uses" —
 * and says exactly what a violation looks like. MEASURED on a packaged build
 * (published `@vgai/editor@0.5.20`, real npm install) against a ~30-line
 * unmodified three.js game declared as a `{ surface: 'three', ingest: {} }`
 * root:
 *
 *   WARNING: Multiple instances of Three.js being imported.
 *   Scene capture timed out after 15000ms of VISIBLE time (0ms
 *     browser-suspended …) — the game never rendered, or it bundles its own
 *     (un-shared) copy of three.
 *
 * — three.js's own duplicate-instance guard naming the cause, beside the mount
 * failing by name 15 seconds later. The ADDONS ride along because they are the
 * same identity question: `EffectComposer` and `CSS3DRenderer` are FILES inside
 * the `three` package tree, so an unmodified game's `three/addons/…` import
 * resolves to the copy beside its own `three`, and trapping the shell's would
 * miss a composer-driven or CSS3D-driven game for precisely that reason.
 *
 * ### `/__vgai-story-runtime` (`STORY_DOORWAY`)
 *
 * A CSF module is dynamically imported through the project's Vite graph
 * (`src/stories/story-discovery.ts`'s `/@fs/` import), so its components' hooks
 * resolve against the PROJECT's own `react` — while `mountIsolatedStory`
 * (`StoryPreviewMount.tsx`) rendered them with the editor SPA's statically
 * bundled `react-dom`, and `compose-project-stories.ts` composed them with the
 * editor's own bundled `@storybook/react`. Two React module instances: every
 * story render died on "Invalid hook call" — confirmed live in a package-native
 * project, where the Stories panel and the `vgai screenshot` story lane were
 * both dead.
 *
 * ### `/__vgai-r3f-runtime` (`R3F_DOORWAY`)
 *
 * The three lane's original doorway, and the pattern the canvas and
 * three-ingest ones were transcribed from: the R3F entry adjudicator, plus
 * `projectThree` for the same reason `projectPixi` exists on the canvas
 * doorway.
 *
 * ## Why the module BODY is exported (`doorwayModuleSource`)
 *
 * A synthesized module hangs off no file the `optimizeDeps` crawl can reach, so
 * its specifiers were discovered only when a lane first mounted — mid-session —
 * which re-optimizes and hard-reloads the controlling tab. Measured on a real
 * canonical-Pixi project with a cold `node_modules/.vite`: the boot pass
 * prebundled 19 deps; one request for the synthetic modules took it to 21,
 * adding `three` and `@react-three/fiber` — two optimizer waves, two reloads.
 * `server/project-optimize-deps-entries.ts` closes that by reading
 * `EDITOR_RUNTIME_MODULE_SPECIFIERS` out of the SAME strings the browser is
 * served, which is what stops the prebundle list from drifting from what the
 * modules actually import.
 */
import {
  CANVAS_RUNTIME_PATH,
  R3F_ENTRY_RUNTIME_PATH,
  R3F_RUNTIME_PATH,
  REACT_WORLD_RUNTIME_PATH,
  STORY_RUNTIME_PATH,
  THREE_INGEST_RUNTIME_PATH,
} from '@volter/editor-sdk/host';
import type { Plugin } from 'vite';

/** One `from '<specifier>'` line of a doorway's synthetic module body. */
export interface ModuleDoorwayRow {
  /** The bare (or aliased) specifier this row re-exports from. */
  readonly from: string;
  /**
   * Named re-exports, verbatim and in order — `'createRoot as createR3FRoot'`
   * is a single entry, because the rename IS the published name.
   */
  readonly names?: readonly string[];
  /**
   * Publish the specifier's whole namespace under this binding
   * (`import * as projectThree from 'three'` + `export { projectThree }`).
   * Namespace imports lead the module body and their re-export closes it, the
   * way a hand-written module reads.
   */
  readonly namespace?: string;
}

/** A synthetic module the editor shell imports by URL to reach the project's graph. */
export interface ModuleDoorway {
  /** The URL shell code imports (`/__vgai-r3f-runtime`). Part of the public API. */
  readonly path: string;
  readonly rows: readonly ModuleDoorwayRow[];
}

/** Each doorway's address is spelled once, on the SDK's host door, where the
 *  browser code that imports it reads it; this plugin owns what is served. */
export {
  CANVAS_RUNTIME_PATH,
  R3F_ENTRY_RUNTIME_PATH,
  R3F_RUNTIME_PATH,
  REACT_WORLD_RUNTIME_PATH,
  THREE_INGEST_RUNTIME_PATH,
};
/** The dynamic-import-facing URL `stories/story-dom-runtime.ts` imports. Its
 *  one spelling is `@volter/editor-sdk/host`, because a reader reaches a host
 *  fact through the published door and never through this build tier; this
 *  plugin still owns WHAT is served at that address, below. */
export { STORY_RUNTIME_PATH };

export const REACT_WORLD_DOORWAY: ModuleDoorway = {
  path: REACT_WORLD_RUNTIME_PATH,
  rows: [
    { from: 'react', names: ['createElement', 'useEffect', 'useRef'] },
    { from: 'react-dom/client', names: ['createRoot'] },
    // `flushSync` — needed by the react-world layer mount (its synchronous
    // initial render), from the SAME react-dom peer as `createRoot` above
    // (react-dom/client and react-dom are the same installed package's two
    // entry points).
    { from: 'react-dom', names: ['flushSync'] },
    {
      from: '@volter/game-runtime/react/world-state',
      names: ['WorldProvider as EngineWorldProvider'],
    },
  ],
};

export const R3F_DOORWAY: ModuleDoorway = {
  path: R3F_RUNTIME_PATH,
  rows: [
    { from: 'three', namespace: 'projectThree' },
    { from: 'react', names: ['createElement'] },
    {
      from: '@react-three/fiber',
      names: ['createRoot as createR3FRoot', 'extend as extendThree'],
    },
  ],
};

/** The game runtime's R3F entry resolver, apart from {@link R3F_DOORWAY}: a
 *  story preview reaches that one in a project with no game runtime, and a
 *  doorway re-exports only what every project that asks for it has installed. */
export const R3F_ENTRY_DOORWAY: ModuleDoorway = {
  path: R3F_ENTRY_RUNTIME_PATH,
  rows: [{ from: '@volter/game-runtime/world3d-react', names: ['resolveR3FEntryAdapter'] }],
};

export const CANVAS_DOORWAY: ModuleDoorway = {
  path: CANVAS_RUNTIME_PATH,
  rows: [
    { from: 'pixi.js', namespace: 'projectPixi' },
    { from: '@volter/game-runtime/canvas-react', names: ['resolveCanvasEntryAdapter'] },
  ],
};

export const THREE_INGEST_DOORWAY: ModuleDoorway = {
  path: THREE_INGEST_RUNTIME_PATH,
  rows: [
    { from: 'three', namespace: 'projectThree' },
    {
      from: 'three/examples/jsm/postprocessing/EffectComposer.js',
      names: ['EffectComposer'],
    },
    {
      from: 'three/examples/jsm/renderers/CSS3DRenderer.js',
      names: ['CSS3DRenderer'],
    },
  ],
};

export const STORY_DOORWAY: ModuleDoorway = {
  path: STORY_RUNTIME_PATH,
  rows: [
    { from: '@storybook/react', names: ['composeStories', 'setProjectAnnotations'] },
    { from: 'react-dom', names: ['flushSync'] },
    { from: 'react-dom/client', names: ['createRoot'] },
  ],
};

/**
 * Every doorway the PACKAGED runtime serves, in registration order.
 *
 * `vitest.config.ts` deliberately registers a SUBSET (react-world + story), and
 * `dev.ts` registers none — see the header for why a doorway is only ever
 * served to a lane that asked for it.
 */
export const PACKAGED_MODULE_DOORWAYS: readonly ModuleDoorway[] = [
  REACT_WORLD_DOORWAY,
  R3F_DOORWAY,
  R3F_ENTRY_DOORWAY,
  CANVAS_DOORWAY,
  THREE_INGEST_DOORWAY,
  STORY_DOORWAY,
];

/**
 * The exact module text a doorway is served as — a literal string of STATIC
 * `import`/`export … from` lines and nothing else, so every specifier goes
 * through the serving instance's own resolver.
 */
export function doorwayModuleSource(doorway: ModuleDoorway): string {
  const lines: string[] = [];
  for (const row of doorway.rows) {
    if (row.namespace) lines.push(`import * as ${row.namespace} from '${row.from}';`);
  }
  for (const row of doorway.rows) {
    if (!row.names || row.names.length === 0) continue;
    lines.push(`export { ${row.names.join(', ')} } from '${row.from}';`);
  }
  for (const row of doorway.rows) {
    if (row.namespace) lines.push(`export { ${row.namespace} };`);
  }
  return lines.join('\n');
}

/** A doorway's private virtual id — `\0`-prefixed so no other plugin claims it. */
function virtualIdOf(doorway: ModuleDoorway): string {
  return `\0vgai${doorway.path.replace(/^\/__vgai/, '')}`;
}

/**
 * The ONE plugin serving every doorway handed to it.
 *
 * Registered per host with the doorways that host is meant to answer for, which
 * is the whole conditional cost model: a doorway not in this list is not a
 * module the graph can reach, so its packages are never demanded.
 */
export function moduleDoorwaysPlugin(doorways: readonly ModuleDoorway[]): Plugin {
  const byPath = new Map(doorways.map((doorway) => [doorway.path, virtualIdOf(doorway)]));
  const bodies = new Map(
    doorways.map((doorway) => [virtualIdOf(doorway), doorwayModuleSource(doorway)]),
  );
  return {
    name: 'vgai-module-doorways',
    resolveId(id) {
      return byPath.get(id);
    },
    load(id) {
      return bodies.get(id);
    },
  };
}
