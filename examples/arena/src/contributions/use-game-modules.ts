/**
 * THE ONE HOOK an editor contribution needs: this game's RUNNING module
 * instances. Everything else about a dev surface is yours to imagine.
 *
 * The method (owner ruling: as native as possible, no imposed system):
 * imagine what THIS game's studio would hang on its wall — the readings,
 * the setup cheats, the dials, the charts — then write each surface as a
 * plain TSX contribution in this folder (`*.inspector.tsx`,
 * `*.utility.tsx`, `*.document.tsx`), in the game's own vocabulary, added
 * when there is something to show. A contribution is ordinary React
 * reading the game's own exported modules through this hook; agents reach
 * the same modules through `vgai eval`'s
 * `game.run(async ({ modules }) => await modules('src/sim/host.ts'))` — `modules` is an
 * ASYNC RESOLVER taking a served path, never a table: the `await` is not
 * optional, and reading a member off the unawaited promise throws a message
 * saying so. `modules.loaded` lists the paths the running mount can hand you.
 * There is no registry, no declaration call, and no prescribed sections.
 * The worked reference is the datacenter-tycoon game's `src/tools/`.
 *
 * Why the hook exists at all: contributions load under the EDITOR's
 * importer while the game's modules load under the mount's stamped URLs —
 * a direct `import '../sim/host'` from a contribution would be a phantom
 * second copy. `importGameModule` resolves the VERBATIM url the running
 * graph loaded, so what a contribution reads IS the game. It takes
 * `play.instanceId` EXPLICITLY: in a packaged editor the shell bundle and
 * this source-served module are two copies of `game-module-access`, so
 * injected module state cannot cross — the id the SDK already hands every
 * contribution is the one channel that works in both hosts.
 */
import { importGameModule } from '@editor/game-module-access';
import { useEffect, useState } from 'react';

/** Load the running mount's instances of the named modules. `null` until
 *  loaded; `error` when the mount refuses (not playing, module never
 *  imported by the game). Re-resolves when `play` identity changes.
 *
 *  `play.instanceId` is passed to `importGameModule` EXPLICITLY: in a
 *  packaged editor the shell bundle and this source-served module are two
 *  copies of `game-module-access`, so the shell's injected focused-instance
 *  provider is invisible here — the id the SDK already hands the face is
 *  the one channel that works in both hosts. */
export function useGameModules<T extends Record<string, string>>(
  play: { readonly instanceId: string } | null,
  paths: T,
): { mods: { [K in keyof T]: Record<string, unknown> } | null; error: string | null } {
  const [state, setState] = useState<{
    mods: { [K in keyof T]: Record<string, unknown> } | null;
    error: string | null;
  }>({ mods: null, error: null });
  const key = JSON.stringify(paths);
  useEffect(() => {
    if (!play) {
      setState({ mods: null, error: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(
          Object.entries(paths).map(async ([name, path]) => [
            name,
            await importGameModule(path, play.instanceId),
          ]),
        );
        if (!cancelled) {
          setState({ mods: Object.fromEntries(entries) as never, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ mods: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, key]);
  return state;
}
