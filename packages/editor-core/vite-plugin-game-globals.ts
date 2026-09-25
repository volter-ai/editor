/**
 * The `vgai-game-globals` transform — prepends the game-globals prelude to game
 * source so raw `window`/`document` input listeners resolve to the gated proxies
 * (`gated-globals.ts`) instead of the real globals, making them focus-gated.
 *
 * Shared by BOTH Vite configs, which is the point:
 *   - `server/dev.ts` registers it over an opened project's root PLUS the
 *     same-realm ingest-fixture roots;
 *   - the repo-root `vite.config.ts` registers it over the ingest-fixture roots
 *     alone, which is what a production build of the editor needs. Before
 *     this existed the plugin lived only in `dev.ts`, so a same-realm ingested
 *     game ran UNSHADOWED there — its input listeners fired regardless of
 *     editor focus. The in-page analogue of this seam is
 *     `applyGameGlobalsShadow` (`browser-transpile.ts`, A3).
 *
 * `dev.ts` builds its Vite server with `configFile: <repo-root>/vite.config.ts`
 * AND adds its own plugins, so in dev BOTH registrations are live and both
 * `transform` hooks see the ingest-fixture modules. The prelude check below is
 * what makes that safe: whichever runs first prepends, the other sees the
 * prelude already there and no-ops. Prepending twice would shadow the shadow —
 * the inner `const window` would resolve to the outer `const window` rather than
 * to the gated proxy — and `const` redeclaration in one scope is a SyntaxError
 * besides.
 */

import { GAME_CSS_SCOPE_SELECTOR } from '@volter/editor-sdk/session/game-css-scope';
import type { Plugin } from 'vite';
import { isRuntimeInputModule, shouldScopeGameCss, shouldShadowGameGlobals } from './server/game-globals-shadow';
import { mountIdOf } from './server/project-module-instance';
import { scopeGameCss } from './server/scoped-game-css';
// The DOM-free prelude module, NOT `src/gated-globals.ts`: this file is reachable
// from `tsconfig.server.json` (via `server/dev.ts`), which compiles without the
// DOM lib and so cannot see `window`/`document`/`EventListenerOrEventListenerObject`.
import { gameGlobalsPrelude } from './src/game-globals-prelude';
import { EDITOR_TREE_QUERY } from './vite-plugin-shared-react';

/**
 * `getRoots` is a thunk, not a snapshot: `dev.ts` mutates its root set when a
 * project opens after boot (`onProjectOpened`), and the transform must see that.
 */
export function gameGlobalsShadowPlugin(
  getRoots: () => Iterable<string>,
  /**
   * Runtime package directories whose modules a game uses as its own library
   * and which register raw input listeners — `@volter/game-runtime`'s `input/`,
   * whose `InputManager` a project may construct itself. Their listeners go
   * through the same realm gate as the project's own code. Omitted: none.
   */
  getRuntimeRoots: () => Iterable<string> = () => [],
): Plugin {
  return {
    name: 'vgai-game-globals',
    transform(code: string, id: string) {
      if (new URLSearchParams(id.split('?')[1]).has(EDITOR_TREE_QUERY)) return null;
      const file = id.split('?')[0]!;
      if (shouldScopeGameCss(file, getRoots()) && !code.includes('@scope (')) {
        return {
          code: scopeGameCss({
            css: code,
            scopeSelector: GAME_CSS_SCOPE_SELECTOR,
            styleSheetPath: file,
          }),
          map: null,
        };
      }
      if (!shouldShadowGameGlobals(file, getRoots()) && !isRuntimeInputModule(file, getRuntimeRoots()))
        return null;
      // Already shadowed. The marker is the prelude's stable HEAD rather than
      // the whole string, because the prelude now varies by mount id — a
      // whole-string check would re-prepend for every mounted module and
      // shadow the shadow (`const` redeclaration in one scope is a SyntaxError
      // besides, which is how the original check earned its comment).
      if (code.startsWith("const __vgaiHost=({}).constructor.constructor('return globalThis')()"))
        return null;
      // Bake the module's own mount id in, so its game globals resolve to the
      // realm of the INSTANCE it belongs to. No id selects the default realm
      // used by in-page transpiles and single-instance ingests.
      const prelude = gameGlobalsPrelude(mountIdOf(id));
      return { code: prelude + code, map: null };
    },
  };
}
