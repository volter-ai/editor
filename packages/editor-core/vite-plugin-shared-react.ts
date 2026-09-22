/**
 * ONE React for the editor's own tree — the shell's.
 *
 * ## The defect this closes
 *
 * Under the PACKAGED runtime (`server/packaged.ts`: a `@vgai/editor` npm
 * package with no monorepo checkout) the page runs two module graphs at once:
 *
 *  - the editor shell, a PREBUILT production bundle (`dist/assets/index-*.js`)
 *    with its own React inlined; and
 *  - the opened PROJECT's source, served fresh by a second, project-rooted
 *    Vite instance, whose bare `react` resolves — correctly, for its root — to
 *    the PROJECT's own `node_modules`.
 *
 * Anything the project contributes that renders INSIDE the editor's React tree
 * therefore called hooks from a different React than the one reconciling it.
 * Measured on a fresh scaffold against the published 0.5.17 packaged editor:
 * all four dev-tools inspector facets (`src/tools/game-*.inspector.tsx`)
 * REGISTERED (`editor.inspect()` listed them) and then threw
 * `Invalid hook call … more than one copy of React in the same app` instead of
 * drawing — and so did every other project contribution that renders (the
 * humanoid/bird/castle builder inspectors, the World Labs asset inspector, the
 * data-tables document). None of it was visible from a checkout: `dev.ts`
 * serves the editor's OWN source and the project's source through ONE Vite
 * with `resolve.dedupe: ['react', …]`, so in-repo there has only ever been one
 * React and every in-repo check passed.
 *
 * ## The mechanism: URL identity
 *
 * The editor build emits one extra ENTRY chunk per specifier in
 * {@link SHARED_REACT_ENTRIES} — the SHELL's own React, `react-dom`,
 * `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and the one
 * third-party package that CALLS React hooks inside the editor's tree. Because
 * they are entries of the SAME build, rollup hoists the actual module into a
 * chunk both they and the shell import: they are not a copy of React, they are
 * a doorway onto the shell's instance.
 *
 * At serve time {@link sharedReactPlugin} resolves those specifiers, for
 * every module in the EDITOR TREE (see below), to the built chunk's URL
 * (`/assets/vgai-shared-react-<hash>.js`) — the SAME absolute URL the shell's
 * own bundle imports, so the browser's module map hands both sides the one
 * instance.
 *
 * ### Why the entry bodies are GENERATED, not written
 *
 * The obvious spelling — a one-line `export * from 'react'` — silently emits a
 * chunk with NO named exports (measured: the built chunk exported only the
 * default and the raw namespace). React ships CommonJS, and rollup makes
 * `import { useState } from 'react'` work by rewriting the IMPORTER's member
 * access, not by synthesizing static named exports a star can forward. So each
 * entry body is generated at build time from the installed package's own
 * runtime key list (`Object.keys(require('react'))`), and every export is that
 * package's own function read off its own module object. That is a DOORWAY,
 * not a shim: there is no second implementation, nothing is faked, and the
 * list cannot drift from the installed React because it is read from it. The
 * chunks are emitted with `preserveSignature: 'strict'` because Vite's app
 * build otherwise sets `preserveEntrySignatures: false` and mangles an entry's
 * export names away.
 *
 * ## Where the seam is drawn (measured, not assumed)
 *
 * {@link sharedReactPlugin}'s own doc comment carries the full rule and the
 * live failure that set it: the redirect covers the EDITOR TREE — the
 * contribution lane, the widget kit, and whatever project source they reach —
 * and deliberately stops at the GAME, which mounts into its own isolated
 * `createRoot` tree with the project's own development React and a matching
 * development reconciler. Redirecting the game too was tried first and broke
 * Play mode outright.
 *
 * {@link sharedReactPlugin} is registered ONLY by `server/packaged.ts`.
 * `dev.ts` is untouched — it has one React already.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { EDITOR_LANE_DIRS } from '@volter/editor-sdk/session/tool-contribution-convention';
import type { Plugin } from 'vite';

/**
 * The published specifiers, and the rollup chunk NAME each appears under.
 *
 * The membership rule is one sentence: **a module belongs here when it CALLS
 * React hooks while rendering inside the editor's tree.** React itself is the
 * obvious case; a third-party component is the non-obvious one, and it fails
 * exactly as loudly — its `useState`/`useId` read a different dispatcher than
 * the tree reconciling it, which is "Invalid hook call" again with the
 * project's name nowhere in the stack.
 *
 * `@fortawesome/react-fontawesome` is here because it is the ONLY such module
 * `@volter/editor-sdk/widgets` reaches (measured: the kit's whole transitive bare-import
 * closure is `react`, `react-dom`, `@fortawesome/free-solid-svg-icons` — pure
 * path DATA, no React — and this). `SectionHeader` renders its
 * `DisclosureIcon` unconditionally, so before this entry existed every project
 * tool that used the kit's own section header crashed on the packaged path
 * while the tool's own hooks were being redirected correctly.
 *
 * `react-dom/server` is deliberately absent: nothing renders to a string in an
 * editor page, and an entry for it would drag React's server build into every
 * shell bundle.
 *
 * KNOWN REMAINING HOLE, same class: any OTHER bare dependency a contribution
 * renders calls its own prebundled React, and adding it here is not always the
 * answer. `@pixi/react` is the worked case and the reason this paragraph
 * exists — a doorway for it hands the editor's tree the SHELL's `@pixi/react`
 * and therefore the shell's `pixi.js`, while the contribution's own
 * `Texture`/`Assets` stay the project's: one renderer looking at another
 * renderer's textures, the same renderer-instance split that broke Play mode
 * when the game was redirected. The `sprite` capability's Sprite Lab took the
 * other exit instead — it drives plain `pixi.js` imperatively
 * (`sprite-lab/stage.ts`), because `pixi.js` calls no React hooks and so
 * crosses nothing. Reach for that shape first; a new line in this map is for a
 * dependency whose whole job IS rendering in the editor's tree.
 */
export const SHARED_REACT_ENTRIES = {
  react: 'vgai-shared-react',
  'react-dom': 'vgai-shared-react-dom',
  'react-dom/client': 'vgai-shared-react-dom-client',
  'react/jsx-runtime': 'vgai-shared-jsx-runtime',
  'react/jsx-dev-runtime': 'vgai-shared-jsx-dev-runtime',
  '@fortawesome/react-fontawesome': 'vgai-shared-fontawesome',

} as const satisfies Record<string, string>;

export type SharedReactSpecifier = keyof typeof SHARED_REACT_ENTRIES;

/** The specifiers this plugin owns — the same list `packaged.ts` keeps out of
 *  dependency prebundling, exported so the two can never drift apart. */
export const SHARED_REACT_SPECIFIERS = Object.keys(SHARED_REACT_ENTRIES) as SharedReactSpecifier[];

/**
 * The emitted map, written beside the built shell. NOT `.vite/manifest.json`:
 * this file is read out of an INSTALLED tarball, and a dot-directory is one
 * more thing that has to survive `npm pack`.
 */
export const SHARED_REACT_MANIFEST_FILE = 'vgai-shared-react.json';

export interface SharedReactManifest {
  /** Bare specifier → outDir-relative built chunk file (`assets/…js`). */
  files: Record<string, string>;
}

const VIRTUAL_PREFIX = '\0vgai-shared-react:';

/**
 * The body of one entry: every export the installed package actually has, read
 * off that package's own module object.
 *
 * `__ns.default ?? __ns` covers both shapes this has to handle — a CommonJS
 * package (rollup's interop puts `module.exports` on `default`) and a real ES
 * module (the root Vite config aliases `react/jsx-dev-runtime` to
 * `src/jsx-dev-runtime-prod-shim.ts` for builds, because production React
 * stubs `jsxDEV` to `undefined`).
 */
export function sharedReactEntryModule(specifier: string, exportNames: readonly string[]): string {
  const named = exportNames
    .filter((name) => VALID_IDENTIFIER.test(name))
    .map((name) => `export const ${name} = __m.${name};`);
  return [
    `import * as __ns from ${JSON.stringify(specifier)};`,
    // Bracketed on purpose: `__ns.default` makes rollup warn that the ES-module
    // shape (the jsx-dev-runtime shim) has no `default` export, which is the
    // case this line exists to handle.
    "const __m = __ns['default'] ?? __ns;",
    'export default __m;',
    ...named,
    '',
  ].join('\n');
}

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The runtime export names of an installed package, resolved from `fromDir`. */
export function installedExportNames(fromDir: string, specifier: string): string[] {
  const require_ = createRequire(path.join(fromDir, 'package.json'));
  // biome-ignore lint/suspicious/noExplicitAny: reading an arbitrary package's runtime shape.
  const loaded = require_(specifier) as Record<string, any>;
  return Object.keys(loaded).filter((name) => name !== 'default');
}

/**
 * BUILD side: emit the five entry chunks and the manifest naming them.
 *
 * `fromDir` is the directory whose `node_modules` the React being published
 * comes from — the repo root for this build, which is the same React the shell
 * itself bundles.
 */
export function sharedReactBuildPlugin(fromDir: string): Plugin {
  const referenceIds = new Map<SharedReactSpecifier, string>();
  return {
    name: 'vgai-shared-react-build',
    apply: 'build',
    buildStart() {
      referenceIds.clear();
      for (const specifier of SHARED_REACT_SPECIFIERS) {
        referenceIds.set(
          specifier,
          this.emitFile({
            type: 'chunk',
            id: `${VIRTUAL_PREFIX}${specifier}`,
            name: SHARED_REACT_ENTRIES[specifier],
            // Vite's app build sets `preserveEntrySignatures: false`, which
            // mangles an entry's export names away. Per-chunk `strict` is what
            // keeps `useState` spelled `useState` in the emitted file — the
            // whole point of publishing it.
            preserveSignature: 'strict',
          }),
        );
      }
    },
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? id : undefined;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return undefined;
      const specifier = id.slice(VIRTUAL_PREFIX.length);
      return sharedReactEntryModule(specifier, installedExportNames(fromDir, specifier));
    },
    generateBundle() {
      const files: Record<string, string> = {};
      for (const [specifier, referenceId] of referenceIds) {
        files[specifier] = this.getFileName(referenceId);
      }
      this.emitFile({
        type: 'asset',
        fileName: SHARED_REACT_MANIFEST_FILE,
        source: `${JSON.stringify({ files } satisfies SharedReactManifest, null, 2)}\n`,
      });
    },
  };
}

/** The manifest a built `dist/` carries, or `null` when it predates this build
 *  step (an old tarball, or a checkout whose `dist/` was never rebuilt). */
export function readSharedReactManifest(distPath: string): SharedReactManifest | null {
  const manifestPath = path.join(distPath, SHARED_REACT_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  let manifest: SharedReactManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SharedReactManifest;
  } catch {
    return null;
  }
  if (SHARED_REACT_SPECIFIERS.some((specifier) => !manifest.files?.[specifier])) return null;
  return manifest;
}

/**
 * Specifier → URL, from a manifest. `base` is the built shell's own base (`/`
 * for the packaged build), so these URLs are byte-identical to the ones the
 * shell's bundle imports. That identity IS the fix: a differently-spelled URL
 * for the same file is a second React.
 */
export function sharedReactUrls(manifest: SharedReactManifest, base = '/'): Record<string, string> {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return Object.fromEntries(
    SHARED_REACT_SPECIFIERS.map((specifier) => [
      specifier,
      `${prefix}${manifest.files[specifier]}`,
    ]),
  );
}

/**
 * The query that marks a module as part of the EDITOR TREE — the same
 * "the query IS the scope" device `vite-plugin-mount-isolation.ts` uses.
 * Queries survive `cleanUrl`, so every other plugin's `.tsx` scope test still
 * matches a marked module.
 */
export const EDITOR_TREE_QUERY = 'vgai-editor-react';

/** A file inside a `@vgai/*` package's `contributions/` directory under any
 *  `node_modules` (a real install; in a checkout the package is a symlink
 *  whose realpath is its workspace directory, already `isOwnSource`). */
const PACKAGE_CONTRIBUTION_PATH = /[\\/]node_modules[\\/]@vgai[\\/][^\\/]+[\\/]contributions[\\/]/;

function markEditorTree(id: string): string {
  return id.includes(`?${EDITOR_TREE_QUERY}`) || id.includes(`&${EDITOR_TREE_QUERY}`)
    ? id
    : `${id}${id.includes('?') ? '&' : '?'}${EDITOR_TREE_QUERY}`;
}

function stripQuery(id: string): string {
  const cut = id.indexOf('?');
  return cut === -1 ? id : id.slice(0, cut);
}

function isUnder(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}${path.sep}`);
}

export interface SharedReactScope {
  /** Specifier → built chunk URL (see {@link sharedReactUrls}). */
  urls: Record<string, string>;
  /** The installed `@vgai/editor` package root — its `src/` is `@editor/*`. */
  editorPackageRoot: string;
  /** Every open project root, live (the same getter the sibling plugins take). */
  projectRoots: () => Set<string>;
}

/**
 * SERVE side: point the EDITOR TREE's React specifiers at the shell's built
 * chunk URLs.
 *
 * ## Scope, and why it is not the whole graph
 *
 * The first version of this redirected React for every module this Vite
 * instance served. It fixed the contributions and BROKE Play mode, loudly and
 * measurably: `@react-three/fiber`'s prebundled `react-reconciler` is a
 * DEVELOPMENT build (Vite prebundles a dev server's deps with
 * `NODE_ENV=development`), and a dev reconciler against the shell's PRODUCTION
 * React reads internals that production React does not have — `TypeError:
 * Cannot read properties of undefined (reading 'push')` inside
 * `updateContainer`, "The current testing environment is not configured to
 * support act(...)", and finally `r3f-adapter: onCreated did not fire within
 * 10s`. The DEV/PROD boundary is real: the shell ships a production React and
 * the project's own graph is a development graph.
 *
 * So the seam is drawn where the RENDERING is: a module that renders inside
 * the editor's own React tree uses the editor's React; the game — mounted by
 * `createRoot` into its own isolated tree, with its own dev React and its own
 * dev reconciler, internally consistent — keeps the project's. That is the
 * same line `vite-plugin-module-doorways.ts` already draws for the mount
 * call, and it is why Play mode works today.
 *
 * ## How the scope is decided
 *
 * An importer is in the editor tree when it is:
 *  - a project's `src/contributions/**` or `src/tools/**` module (the editor
 *    lanes shared with the contribution loader),
 *  - a file under the installed editor package's own `src/` (what `@editor/*`
 *    aliases to — the widget kit contributions build their panels from), or
 *  - anything already MARKED, which is how the scope propagates.
 *
 * Propagation is what makes this cover the real graph rather than one folder:
 * `src/tools/data-tables.document.tsx` renders React components that live in
 * `src/lib/data-tables/`, and a contribution may reach any project module. So
 * when an editor-tree module imports another PROJECT-OWNED source file, the
 * resolved id is marked and its own imports inherit the scope. Bare
 * dependencies are deliberately NOT marked: they are prebundled, and a
 * prebundled chunk's React is decided at prebundle time, not here.
 * `@volter/editor-sdk/widgets` is the one dependency that must therefore be kept
 * OUT of `optimizeDeps` (`packaged.ts` excludes it) — it renders in the editor's tree
 * and has to be source-served for this scope to reach it.
 *
 * `enforce: 'pre'` so this runs ahead of Vite's own resolver and its alias
 * plugin. The returned React id is a root-relative URL, not a filesystem path:
 * Vite's import analysis leaves an id it cannot map into the project root as
 * the literal import URL, and the packaged server's `express.static(dist)`
 * answers it — so the browser fetches the same `/assets/…` file the shell
 * already loaded.
 */
export function sharedReactPlugin({
  urls,
  editorPackageRoot,
  projectRoots,
}: SharedReactScope): Plugin {
  const editorSrc = path.join(editorPackageRoot, 'src');
  const layoutSdkSrc = path.resolve(editorPackageRoot, '../editor-sdk/src');
  const inEditorTree = (importer: string | undefined): boolean => {
    if (!importer) return false;
    if (importer.includes(EDITOR_TREE_QUERY)) return true;
    const file = stripQuery(importer);
    if (isUnder(file, editorSrc) || isUnder(file, layoutSdkSrc)) return true;
    // A skew PACKAGE's contribution (`node_modules/@vgai/<pkg>/contributions/`)
    // renders in the editor's tree exactly as a project's own contribution
    // does, so it takes the shell's React and SDK. Only the contributions
    // directory: the same package's `src/` is also game runtime (a mesh
    // component in a world), and a game keeps its own React.
    if (PACKAGE_CONTRIBUTION_PATH.test(file)) return true;
    for (const root of projectRoots()) {
      if (file === path.join(root, 'vgai.adapter.ts')) return true;
      if (EDITOR_LANE_DIRS.some((dir) => isUnder(file, path.join(root, dir)))) return true;
    }
    return false;
  };
  /** Project-owned source the scope propagates into — never a bare dep. */
  const isOwnSource = (file: string): boolean => {
    if (!path.isAbsolute(file)) return false;
    if (isUnder(file, editorSrc) || isUnder(file, layoutSdkSrc)) return true;
    if (file.includes(`${path.sep}node_modules${path.sep}`)) return false;
    for (const root of projectRoots()) {
      if (isUnder(file, root)) return true;
    }
    return false;
  };

  return {
    name: 'vgai-shared-react',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Never during dependency SCANNING. The scanner records whatever an id
      // resolves to as a file to prebundle, so handing it the shell's URL made
      // the boot-time optimizer die on `ENOENT: open
      // '/assets/vgai-shared-jsx-runtime-*.js'` — measured, on the first run
      // after this scope existed. The redirect belongs to serving, where the
      // browser is the thing fetching the URL.
      // `scan` is Vite's own flag on the resolve options, not part of rollup's
      // published type — hence the cast rather than a widened signature.
      //
      // The scan is not the only server-side pass that follows this redirect:
      // import analysis PRE-TRANSFORMS every static import it rewrites, and a
      // warmup for `/assets/vgai-shared-*.js` resolves against the project root
      // and fails the same way (measured: 64 formatted `Pre-transform error`
      // lines from one `*.inspector.tsx` request). Vite has no per-request
      // opt-out there, so `packaged.ts` turns `server.preTransformRequests` off
      // for its instance — see the comment on that option for why satisfying
      // the warmup instead would pull the whole prebuilt SPA into the project's
      // dev module graph.
      if ((options as { scan?: boolean } | undefined)?.scan) return undefined;
      if (!inEditorTree(importer)) return undefined;
      const url = urls[source];
      if (url) return url;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved ?? undefined;
      return isOwnSource(stripQuery(resolved.id))
        ? { ...resolved, id: markEditorTree(resolved.id) }
        : resolved;
    },
  };
}
