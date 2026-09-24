/**
 * The `vgai-mount-isolation` transform — propagates a mount id from a root
 * entry's url through the whole project-owned import subtree, so two mounts of
 * one project get separate module instances (and therefore separate
 * module-level state) while still sharing every PACKAGE.
 *
 * The rule and the reason it excludes packages live in
 * `server/project-module-instance.ts`. This file is only the Vite wiring, kept
 * separate for the same reason `vite-plugin-game-globals.ts` is: the predicate
 * has to be unit-testable without booting Vite.
 *
 * ORDERING. This must run BEFORE Vite's own import-analysis, which is what
 * resolves `./state?vgai-mount=3` to `/src/state.ts?vgai-mount=3`. A plugin's
 * default `transform` slot is already ahead of it, so no `enforce` is needed —
 * but note the direction, because running after import-analysis would mean
 * rewriting already-resolved urls and fighting Vite for the module graph.
 *
 * WHY THE TRANSITIVITY IS AUTOMATIC. The stamped specifier resolves to a
 * module id that CARRIES the query, so when Vite transforms that dependency
 * this hook sees a mount id on its id too and stamps ITS imports in turn. One
 * hook, no graph walk.
 *
 * THE ISOLATE QUERY is the same hook, a different key. Isolation imports a
 * vendor screen class; that class imports navigation → main; main calls
 * `init()` at module scope and boots the live game onto document.body.
 * `vgai-isolate=1` keys a separate graph, stamps through relative imports
 * (including vendor/games, which the mount-id shadow predicate does not
 * own), and silences that `init();`. Play still loads the unstamped entry.
 */
import type { Plugin } from 'vite';
import { rewriteEntrypointSelectionKey } from '@volter/editor-sdk/session/entrypoint-selection-source';
import { shouldShadowGameGlobals } from './server/game-globals-shadow';
import {
  initLexer,
  isolateFlagOf,
  isProjectSrcModule,
  mountIdOf,
  rewriteProjectImportsForIsolate,
  rewriteProjectImportsForMount,
  rewriteVendorImportsForIsolate,
  selectionOverrideOf,
  silenceIsolatedEntrypointBoot,
} from './server/project-module-instance';

/**
 * `getRoots` is a thunk for the same reason the game-globals plugin's is:
 * `dev.ts` mutates its root set when a project opens after boot.
 *
 * Scope is deliberately the SAME predicate the globals shadow uses
 * (`shouldShadowGameGlobals`) — "is this a project-owned `/src/` module" is one
 * question, and answering it twice differently is how the two transforms would
 * drift into disagreeing about what game source is.
 */
function applyMountIsolationTransform(
  code: string,
  id: string,
  roots: Iterable<string>,
): { code: string; map: null } | null {
  const file = id.split('?')[0]!;
  const override = selectionOverrideOf(id);
  let next = code;
  if (override) {
    // Fail closed: a query that cannot be honoured must not serve the
    // source-declared key under the caller's requested id.
    const rewritten = rewriteEntrypointSelectionKey(next, file, override.selection, override.key);
    if (!rewritten.ok) throw new Error(`vgai-mount-isolation: ${rewritten.reason}`);
    next = rewritten.source;
  }
  // Isolation is its own graph: the query is the scope (vendor `main.ts`
  // is not a project `/src/` module, and gating on the shadow predicate
  // would leave `init();` live). Stamp first so the silenced boot cannot
  // be reached through an unstamped relative import.
  if (isolateFlagOf(id)) {
    const silenced = silenceIsolatedEntrypointBoot(next);
    if (silenced !== null) next = silenced;
    const isolated = rewriteProjectImportsForIsolate(next);
    if (isolated !== null) next = isolated;
  } else if (isProjectSrcModule(file, roots)) {
    // Prefabs/lib import vendor classes without writing the query; Play's
    // entry sits outside src/ and keeps the live graph.
    const isolated = rewriteVendorImportsForIsolate(next);
    if (isolated !== null) next = isolated;
  }
  const mountId = mountIdOf(id);
  const stamped =
    mountId !== undefined && shouldShadowGameGlobals(file, roots)
      ? rewriteProjectImportsForMount(next, mountId)
      : null;
  if (stamped !== null) next = stamped;
  // Record evaluation, not resource-timing history. import.meta.url must be
  // read in the served module so Vite's route/query identity remains exact.
  // JSON is already JavaScript here; CSS and asset-query transforms are not
  // ordinary game modules and must keep their own transform semantics.
  const query = new URLSearchParams(id.split('?')[1]);
  if (
    mountId !== undefined &&
    isProjectSrcModule(file, roots) &&
    /\.(?:[cm]?[jt]sx?|json)$/.test(file) &&
    !file.includes('/node_modules/') &&
    !['raw', 'url', 'worker', 'sharedworker', 'inline', 'init'].some((key) => query.has(key))
  ) {
    const shadowed = shouldShadowGameGlobals(file, roots);
    const realm = shadowed ? '__vgaiR' : '__vgaiLoadedModuleRealm';
    const marker = `\n;${realm}?.recordModuleUrl(import.meta.url);\n`;
    if (!next.includes(marker)) {
      if (!shadowed) {
        // Capture the realm before top-level await. A late completion must
        // not recreate an instance that Stop already disposed.
        next = `const ${realm}=({}).constructor.constructor('return globalThis')().__vgaiGameRealm?.(${JSON.stringify(mountId)});\n${next}`;
      }
      next += marker;
    }
  }
  return next !== code ? { code: next, map: null } : null;
}

export function mountIsolationPlugin(getRoots: () => Iterable<string>): Plugin {
  return {
    name: 'vgai-mount-isolation',
    async buildStart() {
      await initLexer();
    },
    transform(code: string, id: string) {
      return applyMountIsolationTransform(code, id, getRoots());
    },
  };
}
