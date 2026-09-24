/**
 * The ONE ordered plugin list every editor host serves an opened PROJECT
 * through — `dev.ts` (checkout, one shared Vite instance) and `packaged.ts`
 * (a `@vgai/editor` npm package, a second Vite instance rooted at the project).
 *
 * Both hosts answer the same question — "how does this Vite instance serve the
 * project's own code?" — and the two lists had drifted apart three separate
 * times, each time as a silent capability hole under a registry install only
 * (a JSX-bearing `.js` module dying in import analysis; the ingest lane's
 * source-write route having nothing to reach; a hand-copied globals prelude
 * that dropped scheduler gating and mount identity). One builder is why a
 * plugin added for one host cannot be missing from the other by accident.
 *
 * **Order is load-bearing.** Vite applies plugins in array order, and three
 * relationships here are real:
 *
 *  - `sharedReactPlugin` is `enforce: 'pre'`, so it decides what `react` means
 *    before Vite's resolver or the alias list can;
 *  - `projectJsxInJsPlugin` must precede the prelude/mount/creation-site
 *    transforms, which all assume the module body is already valid JS — which
 *    a JSX-bearing `.js` file is not yet;
 *  - `creationSitePlugin` is `enforce: 'pre'`, so the `file:line` it records is
 *    the author's own rather than a position inside the prepended prelude.
 *
 * Everything a host may legitimately differ on is an explicit named option
 * below, each stating WHY that host is the only one that gets it.
 */
import { readFileSync } from 'node:fs';
import type { Plugin, PluginOption } from 'vite';
import { creationSitePlugin } from '../vite-plugin-creation-site';
import { creationSiteWritePlugin } from '../vite-plugin-creation-site-write';
import { gameGlobalsShadowPlugin } from '../vite-plugin-game-globals';
import { type ModuleDoorway, moduleDoorwaysPlugin } from '../vite-plugin-module-doorways';
import { mountIsolationPlugin } from '../vite-plugin-mount-isolation';
import { projectGameStaticPlugin } from '../vite-plugin-project-game-static';
import { projectJsxInJsPlugin } from '../vite-plugin-project-jsx-js';
import { projectRootAbsoluteAssetsPlugin } from '../vite-plugin-project-root-absolute-assets';
import { sharedReactPlugin } from '../vite-plugin-shared-react';
import { sharedThreePlugin } from '../vite-plugin-shared-three';
import {
  handleProjectScriptHotUpdate,
  recordReactBoundary,
  type ScriptHmrHookContext,
  type ScriptHmrHostOptions,
} from './project-script-hmr';

/**
 * The plugins ONLY the packaged host registers, because `dev.ts` already
 * reaches equivalents through its `configFile:` (the repo-root
 * `vite.config.ts`) or does not need them at all. Omitted (`undefined`) by
 * `dev.ts`; see each field for the one-sentence reason.
 */
export interface PackagedOnlyServingOptions {
  /**
   * ONE React for everything that renders inside the EDITOR's own tree — the
   * shell's. Packaged-only because there the shell is a prebuilt bundle with
   * React inlined while this instance would otherwise resolve `react` to the
   * PROJECT's node_modules; `dev.ts` has one graph and the repo-root config's
   * `resolve.dedupe` already collapses them. `null` when this dist predates
   * the shared-React entry chunks (the host warns at boot).
   */
  readonly sharedReactUrls: Record<string, string> | null;
  /**
   * ONE three for the WHOLE page — the shell's. Packaged-only, same reason as
   * `sharedReactUrls`: the shell's inlined `three` and the project's prebundled
   * `three` are two module instances on one page, and three's own
   * duplicate-instance guard warns (blocking `vgai console`). The build
   * publishes the shell's three as a chunk; `sharedThreePlugin` points every
   * project-graph `three` import at its URL. `null` when this dist predates the
   * shared-three entry chunk (the host warns at boot). See
   * `../vite-plugin-shared-three.ts`.
   */
  readonly sharedThreeUrl: string | null;
  /** Where the editor package itself lives — `sharedReactPlugin`'s own scope. */
  readonly editorPackageRoot: string;
  /**
   * The vendored ESTATE ownership is measured against, for
   * `creationSiteWritePlugin`. In a registry install this names a directory
   * with no `vendor/games/` under it, which is the correct answer there — the
   * recorder is then the user's own version control.
   */
  readonly checkoutRoot: string;
  /**
   * The synthetic module doorways this host serves
   * (`vite-plugin-module-doorways.ts`). Packaged-only because a doorway exists
   * to bridge the shell's prebuilt bundle to the project's separate Vite graph
   * — a split `dev.ts` does not have.
   */
  readonly doorways: readonly ModuleDoorway[];
}

/**
 * Project script HMR: intercept project source changes and send a custom HMR
 * event instead of a full page reload.
 */
export interface ScriptHmrServingOptions {
  /**
   * The project root, read LIVE on every update — a packaged session can be
   * switched to another project, and `dev.ts`'s boot project can be replaced
   * by `onProjectOpened`.
   */
  readonly projectRoot: () => string;
  /**
   * A directory to add to Vite's watcher, for a host whose Vite root does NOT
   * contain the project (`dev.ts` is rooted at the checkout, so changes in the
   * project directory are otherwise invisible). `packaged.ts` is rooted AT the
   * project and needs nothing.
   */
  readonly watchDir?: string | undefined;
}

export interface ProjectServingPluginOptions {
  /**
   * "Is this the project's own code?" — the opened project's root plus the
   * fixed in-tree ingest-fixture roots. Deliberately ONE predicate shared by
   * the JSX, globals-shadow, mount-isolation and creation-site transforms.
   */
  readonly projectRoots: () => Set<string>;
  /**
   * The single project root the static/asset routes serve out of, read live:
   * a project can open or switch AFTER boot and the routes must follow it.
   * `undefined` while a `dev.ts` session has no project open yet.
   */
  readonly currentProjectRoot: () => string | undefined;
  /** Omitted by `dev.ts` — see `PackagedOnlyServingOptions`. */
  readonly packagedOnly?: PackagedOnlyServingOptions | undefined;
  /**
   * `null` for a `dev.ts` boot with no project open yet — there is no root to
   * watch or to attribute an update to. `packaged.ts` always has one.
   */
  readonly scriptHmr: ScriptHmrServingOptions | null;
  /**
   * The plugins the product's composed packages contribute through their `vgai.serving`
   * modules (`project-serving-services.ts`), in composition order: a lane's own transforms
   * and routes over project source, such as the React integration's JSX identity stamp.
   */
  readonly contributed?: readonly PluginOption[];
}

/** Byte-identical between the hosts, so it is written once. */
function scriptHmrPlugin(options: ScriptHmrServingOptions): Plugin {
  return {
    name: 'vgai-script-hmr',
    enforce: 'pre',
    transform(source, id) {
      const file = id.split('?')[0]!;
      if (this.environment.name === 'client' && file.startsWith(`${options.projectRoot()}/`))
        recordReactBoundary(file, source);
      return null;
    },
    ...(options.watchDir
      ? {
          configureServer(server: { watcher: { add: (p: string) => void } }) {
            server.watcher.add(options.watchDir as string);
          },
        }
      : {}),
    // ONE shared implementation (see `project-script-hmr.ts` — including why
    // swallowing Vite's HMR obliges this hook to stamp the module graph
    // itself, and the stale-restart incident that proved it).
    //
    // `hotUpdate`, never the legacy `handleHotUpdate`: vite calls the legacy
    // hook for edits ONLY, so deletes and creates used to pass this seam
    // without a trace.
    hotUpdate(this: ScriptHmrHookContext, hot: ScriptHmrHostOptions) {
      return handleProjectScriptHotUpdate({
        file: hot.file,
        type: hot.type,
        timestamp: hot.timestamp,
        environment: this.environment?.name,
        projectRoot: options.projectRoot(),
        // A deleted file has no bytes to read; every classifier that needs
        // source already treats `''` as "no evidence".
        source:
          hot.type !== 'delete' && /\.[jt]sx?$/.test(hot.file)
            ? readFileSync(hot.file, 'utf-8')
            : '',
        server: hot.server,
      });
    },
  };
}

export function createProjectServingPlugins(options: ProjectServingPluginOptions): PluginOption[] {
  const { projectRoots, currentProjectRoot, packagedOnly, scriptHmr, contributed = [] } = options;
  return [
    ...(packagedOnly?.sharedReactUrls
      ? [
          sharedReactPlugin({
            urls: packagedOnly.sharedReactUrls,
            editorPackageRoot: packagedOnly.editorPackageRoot,
            projectRoots,
          }),
        ]
      : []),
    // ONE three for the whole page — the shell's. Also `enforce: 'pre'`, so it
    // decides what bare `three` means before Vite's resolver/alias; unscoped
    // (every project-graph importer), unlike shared-React's editor-tree scope,
    // because three has no dev/prod split. See `../vite-plugin-shared-three.ts`.
    ...(packagedOnly?.sharedThreeUrl ? [sharedThreePlugin(packagedOnly.sharedThreeUrl)] : []),
    // What the product's integrations contribute to serving project source — where a lane's
    // identity stamp and authoring routes (the React integration's `/__ui-source/*`) run.
    ...contributed,
    // `/__ingest-source/*` — ownership, and the guarded
    // read/plan/apply that writes an ingest edit into the GAME's own source.
    // Without it the ingest lane's source writes have no route to reach at all
    // and the client reports the honest live-only floor forever.
    ...(packagedOnly
      ? [creationSiteWritePlugin(currentProjectRoot, packagedOnly.checkoutRoot)]
      : []),
    // The synthetic `/__vgai-*` module doorways, so a lane's React / Fiber /
    // `@pixi/react` / `three` / `@storybook/react` identity comes from the
    // PROJECT's graph rather than the shell's prebuilt bundle. See
    // `vite-plugin-module-doorways.ts` for the measured failure behind each.
    ...(packagedOnly ? [moduleDoorwaysPlugin(packagedOnly.doorways)] : []),
    // JSX inside plain `.js` PROJECT files — the CRA-era React idiom most of
    // the OSS React/R3F corpus ships, and the shape an ingested game arrives
    // in. One of THREE seams that must agree (the `optimizeDeps` `.js` loader
    // and `project-validation.ts`'s `sourceLoader` are the other two); the
    // plugin's own header holds the measured story. Ahead of the transforms
    // below, which assume a valid-JS module body.
    projectJsxInJsPlugin(projectRoots),
    // Pipe gated `window`/`document` into game code: prepend a lexical shadow
    // to every project `/src/` module so its globals resolve to the editor's
    // gated proxies. Engine/editor code is untouched (it keeps the real
    // window; its input is gated separately via `InputManager.setEnabled`).
    // A project with no roots serves no module this touches.
    gameGlobalsShadowPlugin(projectRoots),
    // Multi-instance isolation: propagate a root entry's `?vgai-mount=<id>`
    // through its project-owned import subtree, so two mounts of one project
    // hold separate module instances while still sharing every package. A
    // module served without a mount id is untouched, so single-instance play
    // is unchanged.
    mountIsolationPlugin(projectRoots),
    // The creation-site INDEX — what gives an authored edit an
    // ADDRESS, without which every object a project's own code constructs
    // answers "constructed outside project source". `enforce: 'pre'` puts it
    // ahead of the globals prelude (which prepends a line) and the TS
    // transpile, so the `file:line` it records is the author's own.
    creationSitePlugin(projectRoots),
    // Project-rooted verbatim static serving (D-X2) — the external-folder
    // sibling of `gameStaticPlugin`'s vendored-dist route.
    projectGameStaticPlugin(currentProjectRoot),
    // S-9: a root-absolute reference made by PROJECT code (`import x from
    // '/icons/a.png'`, `<img src="/icons/b.png">`, `url(/fonts/c.otf)`)
    // resolves inside the PROJECT, not against the editor's Vite root.
    projectRootAbsoluteAssetsPlugin(currentProjectRoot),
    ...(scriptHmr ? [scriptHmrPlugin(scriptHmr)] : []),
  ];
}
