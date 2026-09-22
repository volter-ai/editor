/**
 * Pure predicate for the `vgai-game-globals` Vite plugin in `dev.ts` — split
 * out into its own side-effect-free module so it's unit-testable without
 * booting Vite/Express (`dev.ts`'s module top-level calls `main()`, which
 * starts real servers — importing it directly in a test would do that).
 *
 * The prelude used to be scoped to `projectRoots` alone (an opened project's
 * own `/src/`), which covers first-party project code and play-mode's game
 * examples but NOT the in-tree ingest fixtures' same-realm
 * ingest-fixture entry modules — those live under this EDITOR
 * PACKAGE's own `packages/editor/src/ingest/games/**` tree (every surface —
 * holds the former `games-2d`/`games-react` siblings),
 * which `ingest/registry.ts` pulls into the SAME Vite module graph via
 * `import.meta.glob` (they are ordinary `/src/` modules Vite already knows
 * about statically — not an external project folder), so they were served
 * UNSHADOWED: a vendored game's raw `window`/`document` input listeners ran
 * for its entire mount regardless of editor focus.
 */
import path from 'node:path';
import { isEditorLanePath } from '@volter/editor-sdk/session/tool-contribution-convention';
import { isPathInside } from './server-utils';

/**
 * The same-realm ingest-fixture root, given this editor package's own `src/`
 * directory. Fixed (not runtime-discovered) — this folder is part of THIS
 * package's source tree, not a project a user opens. It was a LIST of two
 * once the per-library fixture directories merged into one; the
 * signature stays plural because the caller wires an array of roots and
 * nothing is gained by narrowing it.
 */
export function ingestGameShadowRoots(editorSrcRoot: string): string[] {
  return [
    path.resolve(editorSrcRoot, 'ingest/games'),
    // THE GAME'S OWN SOURCE, which until now was the half that got missed.
    // The root above covers only the host-authored manifest folder — the
    // entry shim, a contract shim — while every line of the game itself lives
    // under `vendor/games/<id>/src/`, outside it. A source-vendored game
    // therefore ran its raw `window`/`document` listeners and its own rAF
    // loop UNSHADOWED for its entire mount, so play-mode's input gate and
    // pause reached nothing in it. Measured on the racing-game ingest, whose
    // `controls/Keyboard.ts` binds `window.addEventListener('keydown')`
    // directly and whose Vehicle drives a `useFrame` loop: with only the
    // manifest folder shadowed, `editor.pause()` left the coverage `loop` row
    // at `loop: null` — the host held no gate over it.
    //
    // Bundle-vendored games are deliberately NOT covered: they are BUILT
    // output under `public/ingest/<id>/`, which `isShadowableModulePath`
    // already declines (no `/src/` segment) and which the prelude's lexical
    // shadow is not safe to prepend to anyway.
    path.resolve(editorSrcRoot, '../../../vendor/games'),
  ];
}

/**
 * True if `file` is a `/src/` TS/JS module — the shape the prelude assumes
 * (a lexically-scoped `const window=…,document=…;` prepended to the top of
 * the module body; see `gated-globals.ts`'s doc comment for why that's safe
 * even ahead of the module's own `import` statements).
 *
 * DEPENDENCY CODE IS NEVER THE PROJECT'S OWN, and the `/src/` test alone does
 * not say so: a project whose own path contains a `src` segment makes every
 * file under its `node_modules/` match — including Vite's project-local
 * optimized-deps cache (`<project>/node_modules/.vite-editor/deps/three.js`,
 * `editorViteCacheDir`). Measured on an ingest whose manifest folder lives
 * under `packages/editor/src/ingest/games/`: the prebundled
 * `three.js` was instrumented by `vite-plugin-creation-site`, so
 * `DRACOLoader`'s worker — which it builds by `DRACOWorker.toString()` and
 * hands to a Blob URL — carried the recorder identifier into a realm that has
 * no such binding. `__vgaiCS$ is not defined` in a `blob:` URL, every Draco
 * mesh failed to decode, `useGLTF` suspended forever, and the scene mounted
 * EMPTY with no error naming any of it. Ordinary projects were safe only by
 * accident of their path.
 */
export function isShadowableModulePath(file: string): boolean {
  if (file.includes('/node_modules/') || isEditorLanePath(file)) return false;
  return /\.(ts|tsx|js|jsx)$/.test(file) && file.includes('/src/');
}

/**
 * True if `file` should get the `GAME_GLOBALS_PRELUDE` shadow prepended:
 * a shadowable module path under any of `roots` (an opened project's root,
 * or one of {@link ingestGameShadowRoots}).
 */
export function shouldShadowGameGlobals(file: string, roots: Iterable<string>): boolean {
  if (!isShadowableModulePath(file)) return false;
  // Containment, not a string prefix: a bare `startsWith` shadows every module
  // of the SIBLING project `<root>-old/src/…` as if it belonged to `<root>`.
  for (const root of roots) {
    if (isPathInside(root, file)) return true;
  }
  return false;
}

/** A project (or ingest-fixture) stylesheet, not a dependency. */
export function isGameCssPath(file: string): boolean {
  return file.endsWith('.css') && !file.includes('/node_modules/') && !isEditorLanePath(file);
}

/**
 * True if Vite-imported game CSS must be rewritten into `@scope` so
 * `html`/`body`/`*` rules cannot restyle the editor document. The sibling
 * of {@link shouldShadowGameGlobals} for stylesheets: first-party worlds
 * `import './style.css'`, which Vite injects as a page sheet unless this
 * transform contains it the same way `server/scoped-game-css.ts` contains
 * a declared ingest stylesheet.
 */
export function shouldScopeGameCss(file: string, roots: Iterable<string>): boolean {
  if (!isGameCssPath(file)) return false;
  for (const root of roots) {
    if (isPathInside(root, file)) return true;
  }
  return false;
}
