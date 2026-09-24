/**
 * The ONE way a mounted game's browser-resource realm is ended.
 *
 * Every surface that runs game code in this tab — first-party play, an extra
 * play instance, and each of the three ingest teardowns — owns a
 * `gated-globals.ts` realm: the window/document proxies its listeners
 * registered through, its timer/frame gate, and its page. Ending a mount and
 * NOT ending its realm is invisible (nothing throws, nothing renders wrong) and
 * permanent: the listeners stay attached to the real `window`, and the next
 * mount under the same id inherits them.
 *
 * Extracted so play mode and ingest cannot drift — ingest used to reset the
 * input gate to always-true and stop there, which left a dead game's listeners
 * attached AND ungated.
 */

import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { disposeGameRealm } from './gated-globals';

/**
 * End one mount's realm and report anything the game left behind.
 *
 * `id` is the mount id; `''` (the default) is the DEFAULT realm — what ingest
 * and every module served without a mount id resolve through. `name` is what
 * the leak report calls the stopped game.
 *
 * The report is the point: a game that released everything it registered is
 * silent, and a game that did not is named, with the count, on the editor
 * console (and therefore in `vgai console`). The editor reclaims either way.
 */
export function reclaimGameRealm(id: string, name: string): void {
  const released = disposeGameRealm(id);
  const timerCount =
    released.timers.timeouts +
    released.timers.intervals +
    released.timers.animationFrames +
    released.timers.parkedCallbacks;
  if (released.listeners === 0 && timerCount === 0) return;
  const parts: string[] = [];
  if (released.listeners > 0) {
    parts.push(
      `${released.listeners} window/document listener${released.listeners === 1 ? '' : 's'}`,
    );
  }
  if (timerCount > 0) {
    parts.push(`${timerCount} timer/frame callback${timerCount === 1 ? '' : 's'}`);
  }
  editorConsole.logStructured(
    'warn',
    `${name} stopped without releasing ${parts.join(' and ')}; the editor reclaimed them.`,
    'environment',
    undefined,
    { instanceId: id, instanceName: name },
  );
}
