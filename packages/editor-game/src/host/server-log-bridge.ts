/**
 * The dev server's `server-log` stream → the editor console. This lives
 * BESIDE the console rather than in it: the console is a sink the shell feeds
 * and never a transport client (ARCHITECTURE-CORE §Editor chrome, "the
 * viewport stack is separable"), so the one place that knows both the SSE
 * endpoint and the console is this shell-side bridge, mounted once by the
 * session's viewport panel.
 */
import { getServerValidationLog } from '@volter/editor-core/api/project-state';
import { emitServerLogEntry } from '@volter/editor-core/editor-console';
import { connectEvents } from '@volter/editor-core/editor-presence';

/**
 * Connect to the editor SSE endpoint and pipe `server-log` events
 * into the editor console tagged with source 'server'.
 *
 * PD-13: `server-log` is a LIVE broadcast with no replay, and the dev server
 * validates the whole project at boot — before any tab exists. Every R3F00x
 * authoring warning found then was announced to zero clients, and
 * `runFileValidation` re-broadcasts a file's warnings only when the SET
 * CHANGES, so it was never announced again: the terminal had them and this
 * console did not. After attaching the live listener we therefore PULL the
 * current set from `/__editor/validation-log` and render it through the same
 * `emitServerLogEntry`. Attach-then-pull, in that order, because the failure
 * we can tolerate is showing one line twice, not losing a live one.
 */
export function connectServerLogs(): () => void {
  // Browser mode has no Node dev server, so `/__editor/events`
  // does not exist — an unconditional `EventSource` here would auto-retry
  // against a dead endpoint forever (the same anti-pattern A2 already fixed
  // for the CLI/asset/scene SSE consumers via `getEditorMode() === 'browser'`
  // guards; this one was missed). There is no browser-mode server-log source
  // to bridge from, so this is a clean skip, not a routed replacement.
  const source = connectEvents();

  source.addEventListener('server-log', (e: MessageEvent) => {
    try {
      emitServerLogEntry(JSON.parse(e.data) as { level: string; message: string });
    } catch {
      /* ignore malformed events */
    }
  });

  let released = false;
  void (async () => {
    try {
      const entries = await getServerValidationLog();
      if (released) return;
      for (const entry of entries) emitServerLogEntry(entry);
    } catch {
      // A server that predates this endpoint (or a torn-down one) simply has
      // nothing to replay — never a reason to break the live listener above.
    }
  })();

  return () => {
    released = true;
    source.close();
  };
}
