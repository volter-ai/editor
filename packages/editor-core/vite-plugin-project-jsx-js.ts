/**
 * The `vgai-project-jsx-in-js` transform — JSX inside plain `.js` PROJECT
 * files, the CRA-era React idiom most of the OSS React/R3F corpus ships.
 *
 * create-react-app's babel pipeline allowed JSX in `.js`; esbuild does not,
 * so without this Vite's import-analysis refuses the whole game with
 * "content contains invalid JS syntax … name the file .jsx". Renaming an
 * ingested game's files is not an option (adapters never modify game
 * source), so the host transforms instead.
 *
 * This is ONE of THREE places that must agree that a project `.js` file may
 * contain JSX — fixing any one alone leaves the others red:
 *   1. this plugin — Vite's transform lane (the module actually served);
 *   2. `optimizeDeps.esbuildOptions.loader['.js'] = 'jsx'` in `server/dev.ts`
 *      — the dependency SCANNER is a second, independent esbuild pass over
 *      the same files;
 *   3. `sourceLoader` in `server/project-validation.ts` — the
 *      validate-on-change parse mirrors what the dev server will serve, or a
 *      servable file reds `vgai status`.
 *
 * Scope is deliberately the SAME predicate the globals shadow uses
 * (`shouldShadowGameGlobals`) — "is this a project-owned `/src/` module" is
 * one question (see `vite-plugin-mount-isolation.ts` for why answering it
 * twice differently is drift) — narrowed to `.js` outside `node_modules`, so
 * the editor's and engine's own sources keep their untouched serve path. A
 * `.js` module with no tag-start `<` is returned untouched (null), so plain-
 * JS project files stay byte-identical; a rare heuristic false positive
 * (`a<b`) still round-trips with identical semantics, because the `jsx`
 * loader only parses JSX where `<` would otherwise be a syntax error.
 */
import { transform as esbuildTransform } from 'esbuild';
import type { Plugin } from 'vite';
import { shouldShadowGameGlobals } from './server/game-globals-shadow';

/** Cheap "could this contain JSX?" gate: `<` immediately followed by a tag
 *  start (`<Foo`, `<div`, `</`, `<>`). Plain-JS comparisons (`a < b`) don't
 *  match. */
const JSX_LIKELY = /<[A-Za-z/>]/;

/**
 * `getRoots` is a thunk for the same reason the game-globals plugin's is:
 * `dev.ts` mutates its root set when a project opens after boot.
 */
export function projectJsxInJsPlugin(getRoots: () => Iterable<string>): Plugin {
  return {
    name: 'vgai-project-jsx-in-js',
    // Ahead of the prelude/mount/creation-site transforms: they assume the
    // module body is valid JS, which a JSX-bearing `.js` file is not yet.
    enforce: 'pre',
    async transform(code: string, id: string) {
      const file = id.split('?')[0]!;
      if (!file.endsWith('.js') || file.includes('/node_modules/')) return null;
      if (!shouldShadowGameGlobals(file, getRoots())) return null;
      if (!JSX_LIKELY.test(code)) return null;
      const out = await esbuildTransform(code, {
        loader: 'jsx',
        jsx: 'automatic',
        jsxDev: true,
        sourcefile: file,
        sourcemap: true,
      });
      return { code: out.code, map: out.map };
    },
  };
}
