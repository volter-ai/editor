/**
 * THE MODEL PLAY VERB of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): `model-play-log`, the read behind
 * `volter-model-editor play-log` and `editor.modelPlayLog()` in `eval`.
 *
 * It answers the page's one play log (`../src/play-log.ts`) — the current run's, or the last
 * one's after Stop — filtered by `since` (simulation seconds, inclusive) and `kind`. A read
 * only: no play gate, since an empty log is the honest answer when nothing has played.
 */
import type { CommandContribution } from '@volter/editor-sdk/commands';
import { readModelPlayLog } from '../src/play-log';

export const point = 'workspace.command';

export const commands: CommandContribution['commands'] = {
  'model-play-log': {
    derivedRefresh: 'none',
    handle: (command) => {
      const since = command['since'];
      const kind = command['kind'];
      if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since)))
        return { ok: false, error: `model-play-log's since is simulation seconds, a number; it was given ${JSON.stringify(since)}.` };
      if (kind !== undefined && typeof kind !== 'string')
        return { ok: false, error: `model-play-log's kind is an entry kind, a string; it was given ${JSON.stringify(kind)}.` };
      const reading = readModelPlayLog({
        ...(since === undefined ? {} : { since }),
        ...(kind === undefined ? {} : { kind }),
      });
      return { ok: true, data: { ...reading } };
    },
  },
};
