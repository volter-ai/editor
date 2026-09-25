/**
 * ONE three.js for the whole page — the editor shell's.
 *
 * ## The defect this closes (WORK.md P2, "Packaged shell loads three.js twice")
 *
 * Under the PACKAGED runtime (`server/packaged.ts`: a `@vgai/editor` npm
 * package with no monorepo checkout) the page runs two module graphs at once:
 *
 *  - the editor shell, a PREBUILT production bundle (`dist/assets/index-*.js`)
 *    with its own `three` inlined — the viewport renderer, the gizmos, the
 *    selection outline and ~100 other shell modules import it, so it evaluates
 *    at boot; and
 *  - the opened PROJECT's source, served fresh by a second, project-rooted
 *    Vite instance, whose bare `three` resolves — correctly, for its root — to
 *    the PROJECT's own `node_modules` (prebundled into `.vite/deps/three.js`).
 *
 * three's own module body runs `if (window.__THREE__) console.warn('WARNING:
 * Multiple instances of Three.js being imported.')` on evaluation, so the
 * SECOND graph's copy trips the guard. That warning is not cosmetic: it keeps
 * `vgai console` from reaching exit-0, a hard gate. `dev.ts` never sees it —
 * one Vite instance, and the repo-root `vite.config.ts`'s
 * `resolve.dedupe: ['three', …]` already collapses the project's copy onto the
 * editor's — so nothing in a checkout ever reproduced it.
 *
 * ## The mechanism: URL identity (the sibling of `vite-plugin-shared-react.ts`)
 *
 * The editor build emits one extra ENTRY chunk for `three`
 * ({@link sharedThreeBuildPlugin}) — the SHELL's own three. Because it is an
 * entry of the SAME build, rollup hoists the actual module into a chunk both it
 * and the shell import: it is not a copy of three, it is a doorway onto the
 * shell's instance. At serve time {@link sharedThreePlugin} resolves the bare
 * `three` specifier, for the whole PROJECT graph, to a stable doorway module that
 * re-exports that built chunk's URL (`/assets/vgai-shared-three-<hash>.js`) — the
 * SAME absolute URL the shell's own bundle imports, so the browser's module map
 * hands both sides the one instance and three's body evaluates exactly once.
 *
 * ## Why the scope is the WHOLE project graph — unlike shared-React
 *
 * `sharedReactPlugin` deliberately redirects react only for the EDITOR TREE and
 * leaves the GAME on the project's own (development) react, because React ships
 * distinct dev/prod builds and its prebundled DEVELOPMENT reconciler must not
 * run against the shell's PRODUCTION React (that broke Play mode, measured in
 * that plugin's header). three has NO such split — it is one build — and
 * `dev.ts`'s `resolve.dedupe` already proves the correct answer is ONE three
 * for editor AND game together (the R3F entry runtime already hands Fiber's
 * catalogue `host.three`, so a world's objects, Fiber's intrinsics and the
 * editor viewport that adopts them must all be the SAME three or `applyProps`
 * mis-types — see `r3f-entry-runtime.ts`). So this redirect is unscoped: every
 * project-graph `three` import becomes the shell's one instance.
 *
 * ## Ingest keeps its own three — for free, by construction
 *
 * An INGEST root's premise is a vendored game that brought its own three. Two
 * shapes, both preserved without a special case here:
 *
 *  - a SOURCE game (its modules served by this same project-rooted Vite) has
 *    its bare `three` DEDUPED to the editor's instance already under `dev.ts`
 *    (see `ingest/resolve-three.ts`'s header, and the `cov-bundled-dedupe`
 *    e2e). This redirect is the packaged analogue of that dedupe — the source
 *    game lands on the shell's three exactly as it lands on the editor's in a
 *    checkout, and the three-ingest doorway's `projectThree` (which goes
 *    through this same resolver) lands there too, so the capture trap and the
 *    game agree;
 *  - a PRE-BUILT BUNDLE game inlines its own three into a blob/`public/` URL
 *    that never passes through a bare-specifier resolve, so this plugin cannot
 *    and does not touch it — it keeps its own copy, the case the doorway
 *    header calls out as inherently un-shareable.
 *
 * For the redirect to reach `@react-three/fiber`'s OWN `import 'three'`,
 * `packaged.ts` also `optimizeDeps.exclude`s `three`: an excluded dep is
 * externalized out of every prebundled chunk and resolved at serve time, where
 * this plugin answers. Prebundling it instead would bake a second, un-
 * redirectable three chunk into `.vite/deps` — exactly the duplicate this
 * plugin removes.
 *
 * {@link sharedThreePlugin} is registered ONLY by `server/packaged.ts`.
 * `dev.ts` is untouched — it has one three already.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { installedExportNames, sharedReactEntryModule } from './vite-plugin-shared-react.js';

/** The bare specifier this plugin owns. three's `window.__THREE__` guard lives
 *  in its main entry (`three/build/three.core.js`, re-exported by `three`), so
 *  collapsing the main entry collapses the duplicate-instance warning; addons
 *  (`three/addons/*`, `three/examples/jsm/*`) import bare `three` internally and
 *  ride this same redirect. */
export const SHARED_THREE_SPECIFIER = 'three';

/** The rollup chunk NAME the shell's three is emitted under. */
export const SHARED_THREE_ENTRY_NAME = 'vgai-shared-three';

/**
 * The emitted map, written beside the built shell — the sibling of
 * `vgai-shared-react.json`, kept a SEPARATE file so an editor build that
 * predates one manifest but not the other degrades one lane at a time.
 */
export const SHARED_THREE_MANIFEST_FILE = 'vgai-shared-three.json';

export interface SharedThreeManifest {
  /** outDir-relative built chunk file (`assets/…js`) for `three`. */
  file: string;
}

const VIRTUAL_PREFIX = '\0vgai-shared-three:';

/**
 * BUILD side: emit the `three` entry chunk and the manifest naming it.
 *
 * `fromDir` is the directory whose `node_modules` the three being published
 * comes from — the repo root for this build, which is the same three the shell
 * itself bundles. The entry body is generated from the installed package's own
 * runtime key list ({@link sharedReactEntryModule} / {@link installedExportNames}
 * — generic over the specifier despite the React-shaped names), so it cannot
 * drift from the installed three and needs no hand-maintained export list.
 */
export function sharedThreeBuildPlugin(fromDir: string): Plugin {
  let referenceId: string | null = null;
  return {
    name: 'vgai-shared-three-build',
    apply: 'build',
    buildStart() {
      referenceId = this.emitFile({
        type: 'chunk',
        id: `${VIRTUAL_PREFIX}${SHARED_THREE_SPECIFIER}`,
        name: SHARED_THREE_ENTRY_NAME,
        // Same reason as the shared-React entries: Vite's app build sets
        // `preserveEntrySignatures: false`, which would mangle the entry's
        // export names away — `strict` keeps `Mesh` spelled `Mesh`.
        preserveSignature: 'strict',
      });
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
      if (!referenceId) return;
      this.emitFile({
        type: 'asset',
        fileName: SHARED_THREE_MANIFEST_FILE,
        source: `${JSON.stringify(
          { file: this.getFileName(referenceId) } satisfies SharedThreeManifest,
          null,
          2,
        )}\n`,
      });
    },
  };
}

/** The manifest a built `dist/` carries, or `null` when it predates this build
 *  step (an old tarball, or a checkout whose `dist/` was never rebuilt). */
export function readSharedThreeManifest(distPath: string): SharedThreeManifest | null {
  const manifestPath = path.join(distPath, SHARED_THREE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SharedThreeManifest;
    return manifest.file ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * The `three` chunk URL, from a manifest. `base` is the built shell's own base
 * (`/` for the packaged build), so this URL is byte-identical to the one the
 * shell's bundle imports. That identity IS the fix: a differently-spelled URL
 * for the same file is a second three.
 */
export function sharedThreeUrl(manifest: SharedThreeManifest, base = '/'): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${manifest.file}`;
}

/** The stable module every project-graph `three` import resolves to; only it imports the hashed
 *  chunk. Browsers keep prebundled chunks naming this id for as long as their `?v=` stands, so
 *  renaming it must rename the plugin too (which moves `?v=`), or those chunks import a module
 *  that no longer answers. */
const SHARED_THREE_DOORWAY = '\0vgai-shared-three-doorway';

/**
 * SERVE side: point every project-graph `three` import at the shell's built
 * chunk, through a DOORWAY whose URL never changes. Registered ONLY on the
 * packaged runtime's project-rooted Vite.
 *
 * WHY A DOORWAY, NOT THE CHUNK URL ITSELF. The chunk's name carries the shell
 * build's hash, and Vite serves prebundled dependencies under a version
 * (`.vite/deps/*.js?v=<browserHash>`) computed from the lockfile and config,
 * not from the shell. The browser keeps those responses, so a dependency chunk
 * whose `import 'three'` was rewritten to one shell build's chunk kept naming it
 * after the next build renamed the file: the chunk failed to load, and with it
 * every module importing it (drei, and through it a project's prefabs and its
 * world), in silence. Measured: script loads of the dependency chunks came from
 * the cache with 0 bytes over the wire, importing a chunk the rebuilt shell no
 * longer served. Rewritten to this doorway, a cached body stays correct across
 * shell builds, and the doorway itself (an ordinary served module, revalidated
 * on every load) is the one place the hash appears. It re-exports the chunk, so
 * the shell and the project still share the one instance at the chunk's URL.
 */
export function sharedThreePlugin(url: string): Plugin {
  return {
    // Vite hashes plugin names into the dependency version, so this name also moves every
    // prebundled chunk a browser cached before the doorway existed onto a new `?v=`.
    name: 'vgai-shared-three-doorway',
    enforce: 'pre',
    load(id) {
      // The chunk also has a default export (the namespace, `sharedReactEntryModule`), which
      // `export *` leaves out; a project's `import THREE from 'three'` read it before the doorway.
      return id === SHARED_THREE_DOORWAY
        ? `export * from ${JSON.stringify(SHARED_THREE_SPECIFIER)};\nexport { default } from ${JSON.stringify(SHARED_THREE_SPECIFIER)};\n`
        : undefined;
    },
    resolveId(source, importer, options) {
      if (source !== SHARED_THREE_SPECIFIER) return undefined;
      // Never during dependency SCANNING — the scanner records whatever an id
      // resolves to as a file to prebundle, and handing it a `/assets/*` URL
      // makes the boot optimizer die on ENOENT (the exact failure
      // `sharedReactPlugin` documents). Returning undefined lets the scanner
      // resolve `three` normally; because `packaged.ts` `exclude`s it from
      // optimizeDeps, the scanner externalizes it rather than prebundling a
      // second copy. `scan` is Vite's own flag on the resolve options, not part
      // of rollup's published type — hence the cast.
      if ((options as { scan?: boolean } | undefined)?.scan) return undefined;
      return importer === SHARED_THREE_DOORWAY ? url : SHARED_THREE_DOORWAY;
    },
  };
}
