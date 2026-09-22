/**
 * The `vgai-creation-site` transform — stamps every direct
 * `new <Ctor>(…)` in a served PROJECT module so the editor can name the source
 * line that created a selected live object. The rewriting rules and why they
 * are semantics-preserving live in `server/creation-site-transform.ts`; this
 * file is the Vite wiring and the OWNERSHIP BOUNDARY.
 *
 * SCOPE IS THE SAME BOUNDARY THE GAME-GLOBALS PRELUDE USES, deliberately.
 * `creationSiteScopeFor` is `shouldShadowGameGlobals`'s predicate plus the
 * matched root, so "is this file the project's own code?" has exactly one
 * answer in this codebase rather than two that can drift. The editor's own
 * modules are therefore never stamped: `packages/editor/src` is only ever in
 * the root set through `ingestGameShadowRoots`, which names the
 * `ingest/games/**` fixture subtree and nothing else — and those fixtures ARE
 * game code.
 *
 * REGISTERED IN BOTH CONFIGS, exactly like `gameGlobalsShadowPlugin`: the
 * repo-root `vite.config.ts` covers the in-tree ingest fixtures, and
 * `server/dev.ts` covers an opened project's root. In dev both are live and both `transform` hooks see the same
 * modules; the marker check in `transformCreationSites` makes the overlap a
 * no-op.
 *
 * `enforce: 'pre'` IS LOAD-BEARING. It puts this transform ahead of the
 * game-globals prelude (which prepends a line, shifting every line number) and
 * ahead of esbuild's TS transpile, so the `line:col` we bake in points at the
 * author's own file on disk. Moving it out of `pre` silently makes every
 * recorded line wrong by one.
 */
import path from 'node:path';
import type { Plugin } from 'vite';
import { transformCreationSites } from './server/creation-site-transform';
import { shouldShadowGameGlobals } from './server/game-globals-shadow';

/**
 * The project root that owns `file`, or `null` when no root does (the editor's
 * own source, `node_modules`, a non-module asset).
 *
 * Returns the ROOT and not just a boolean because the recorded path must be
 * root-relative: that string is shown in the inspector and read back through
 * `vgai eval`, and an absolute path would put the host's directory layout into
 * a product surface. Longest matching root wins, so a project nested inside
 * another root is described against the nearest one.
 */
export function creationSiteScopeFor(
  file: string,
  roots: Iterable<string>,
): { root: string; displayFile: string } | null {
  let best: string | null = null;
  for (const root of roots) {
    if (!shouldShadowGameGlobals(file, [root])) continue;
    if (best === null || root.length > best.length) best = root;
  }
  if (best === null) return null;
  // POSIX separators: this string is an identifier shown to a user and read by
  // an agent, not a path anything opens.
  return { root: best, displayFile: path.relative(best, file).split(path.sep).join('/') };
}

/**
 * `getRoots` is a thunk, not a snapshot — `dev.ts` mutates its root set when a
 * project opens after boot (`onProjectOpened`), the same reason
 * `gameGlobalsShadowPlugin` takes one.
 */
export function creationSitePlugin(getRoots: () => Iterable<string>): Plugin {
  return {
    name: 'vgai-creation-site',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?')[0]!;
      const scope = creationSiteScopeFor(file, getRoots());
      if (!scope) return null;
      const result = transformCreationSites(code, scope.displayFile);
      if (!result) return null;
      // No source map: this transform only INSERTS text, and the shipped
      // precedent (`vite-plugin-game-globals.ts`) makes the same trade. The
      // positions that matter are the ones baked into the emitted literals.
      return { code: result.code, map: null };
    },
  };
}
