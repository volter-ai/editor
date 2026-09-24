/**
 * WHAT DOES THIS ENTRY MODULE MEAN? — the ONE editor-side answer.
 *
 * The engine owns the answer itself (`resolveR3FEntryAdapter`, and the
 * packaged-aware `resolveR3FEntryAdapterForEditor` delegate that routes it
 * through the project's own module graph). The editor's job is to ASK, once.
 * Before this module there were three askers, and they had already drifted:
 *
 *  - the dev-server lane called the packaged-aware `…ForEditor`;
 *  - the browser/hosted lane called the BARE `resolveR3FEntryAdapter`, so a
 *    packaged run built a project component's adapter with the shell bundle's
 *    Fiber and crashed hooks on a null React dispatcher — a divergence
 *    invisible in dev and reachable only on the packaged lane;
 *  - the design session had two more inline resolutions of its own, one of
 *    which additionally understood a NAMED world export that neither other
 *    lane did.
 *
 * All three shapes are here, and the messages stay with their callers: a
 * project author reading "this entry has no mountable surface" needs to be
 * told which lane and which file, and that is the caller's knowledge, not
 * this function's.
 *
 * `entry-adjudication-single-owner.test.ts` is the tripwire; the canvas lane
 * has its own single owner in the engine (`resolveCanvasEntryAdapter`, reached
 * through `canvas-entry-runtime.ts`) and is not adjudicated here.
 */

import type { RootAdapter } from '@vgai/project/adapter';
import { resolveR3FEntryAdapterForEditor } from './r3f-entry-runtime';

/**
 * Runtime shape a `RootAdapter` export must satisfy — the same check
 * `guardModuleShape` makes for `{ module }` adapters: a non-null object with a
 * non-empty string `id` and a function `mount`.
 */
export function isRootAdapterShaped(candidate: unknown): candidate is RootAdapter {
  if (candidate === null || typeof candidate !== 'object') return false;
  const obj = candidate as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' && obj['id'].length > 0 && typeof obj['mount'] === 'function'
  );
}

/** What a caller may ask for beyond "read this module the usual way". */
export interface EntryAdjudicationOptions {
  /**
   * The manifest's `world.export` — ONE component in a module that exports
   * several (a game's `App.tsx` exporting `Scene` beside `Hud` and `App`).
   *
   * It takes precedence over an `adapter` export, and it is handed to the same
   * resolver a default export is rather than being adapted here, so an entry
   * module and a named world component reach fiber down one path. A name the
   * module does not export is a NAMED failure, never a silent fall-back to
   * `default` — which, for such a module, would mount the whole game into the
   * Scene view.
   */
  readonly namedExport?: string | undefined;
  /** The entry path, for the named-export failure message only. */
  readonly entryPath?: string | undefined;
}

/**
 * Resolve the `RootAdapter` a three-surface entry module means, or `null` when
 * it means none — the caller raises its own error for that case.
 *
 * The precedence, in one place: an explicit `namedExport` first (when the
 * caller asked for one), then a pre-built `adapter` export, then the engine's
 * own answer for a module that default-exports its React world component.
 */
export async function adjudicateThreeEntry(
  mod: Record<string, unknown>,
  rootId: string,
  opts?: EntryAdjudicationOptions,
): Promise<RootAdapter | null> {
  const named = opts?.namedExport;
  if (named !== undefined) {
    const picked = mod[named];
    if (typeof picked !== 'function') {
      throw new Error(
        `three root "${rootId}": ${opts?.entryPath ?? 'the entry module'} has no exported ` +
          `component "${named}" (manifest \`world.export\`) — it exports ` +
          `${Object.keys(mod).join(', ') || '(nothing)'}.`,
      );
    }
    return resolveR3FEntryAdapterForEditor({ default: picked }, rootId);
  }
  if (isRootAdapterShaped(mod['adapter'])) return mod['adapter'];
  return resolveR3FEntryAdapterForEditor(mod, rootId);
}
