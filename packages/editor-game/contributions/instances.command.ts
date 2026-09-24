/**
 * The INSTANCE verbs of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): how many instances of the game play
 * split-screen, and which exist.
 *
 * Play mode and the live instance registry are the game skew's own modules,
 * still housed in the editor until Play leaves the host (WORK.md §The
 * workbench, G); they are reached through the `@editor/*` alias the editor's
 * Vite serves to every contribution, and become this package's own imports
 * when they move. Nothing here is host API.
 */

import { liveInstanceIds } from '@volter/editor-core/authoring/active-systems';
import type { CommandContribution } from '@volter/editor-sdk/commands';
import {
  instanceEntries,
  isPlayModeActive,
  setDesiredExtraInstances,
  setDesiredInstanceNames,
} from '../src/play/play-mode';

export const point = 'workspace.command';

const notPlaying = () => ({
  ok: false,
  error: 'not in play mode — start play before using the debug seam',
});

export const commands: CommandContribution['commands'] = {
  // Multiplayer authoring: how many instances of this game to show
  // split-screen (total, including the primary). The GamePanel reconciles by
  // mounting/unmounting extra instances to match. Requires a live play
  // session — there is no primary to sit beside otherwise — and reads as a
  // no-op-that-lies if silently ignored, so it fails loudly when stopped.
  'set-instance-count': {
    derivedRefresh: 'always',
    handle: (cmd) => {
      if (!isPlayModeActive()) return notPlaying();
      // `names` (optional) labels the instances (index 0 = primary); its length
      // is then the total count. Otherwise `count` is the total, with default
      // "Player N" labels.
      const names = cmd['names'];
      if (Array.isArray(names) && names.every((n) => typeof n === 'string')) {
        if (names.length < 1) {
          return { ok: false, error: 'set-instance-count "names" must have at least one entry.' };
        }
        setDesiredInstanceNames(names as string[]);
        return { ok: true };
      }
      const count = cmd['count'];
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
        return {
          ok: false,
          error: `set-instance-count requires a whole "count" >= 1 (or a "names" array), got ${String(count)}.`,
        };
      }
      setDesiredExtraInstances(Math.floor(count) - 1);
      return { ok: true };
    },
  },
  // The instance-enumeration op — the ONE session-wire question that must
  // NOT route through the bridge: it answers "which instances exist", and the
  // bridge RESOLVES an instance (and refuses when several are live), so
  // asking it "which exist" is the exact ambiguity it throws on. Returns the
  // live mount ids so `@volter/editor-live`'s `game.instances()` can hand back one
  // addressed `GameClient` per id. No play gate: `liveInstanceIds()` is `[]`
  // when nothing is mounted, which is the honest answer, not a precondition
  // failure. `named` adds the friendly labels a HUD/driver shows ("Player
  // 2"), from the play-mode instances (ids without a play-mode name — e.g. an
  // ingest mount — simply do not appear in `named`).
  'list-instances': {
    derivedRefresh: 'if-content-changed',
    handle: () => ({ ok: true, data: { instances: liveInstanceIds(), named: instanceEntries() } }),
  },
};
