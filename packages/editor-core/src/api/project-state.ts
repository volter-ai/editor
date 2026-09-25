/**
 * What the session currently IS, as the editor's own UI reads it: the server
 * validation log, the editor lease identity, and the durable
 * `.vgai/editor-state.json` view/tool state.
 *
 */

import type { LeasePollResult } from '../editor-lease';
import { assertEditorServerResponse, editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { postJson } from '@volter/editor-sdk/kit/user-local-state';
import { BASE } from '@volter/editor-sdk/kit/api-base';
/**
 * PD-13: the validation failures and authoring warnings the dev server knows
 * about RIGHT NOW, pre-formatted as `server-log` payloads. `editor-console.ts`
 * pulls this once per connection to render what the live broadcast could not
 * deliver — see `connectServerLogs` for why a pull rather than a push. THROWS
 * on any failure, including a server that predates the endpoint and an origin
 * whose page fallback answered instead; the one caller treats a failed replay
 * as "nothing to replay" and says why.
 */
export async function getServerValidationLog(): Promise<{ level: string; message: string }[]> {
  const res = await fetch(`${BASE}/validation-log`);
  const data = await editorServerJson<{ entries?: { level: string; message: string }[] }>(
    res,
    'Could not read the server validation log',
  );
  return data.entries ?? [];
}

/**
 * One liveness poll for the editor-lease watchdog (editor-lease.ts): ask the
 * server on THIS tab's origin who it is. Reuses the same `/__editor/project`
 * identity endpoint the CLI probes (`session.pid` + the served project path) —
 * a replaced server on the same port answers with a new pid, which is how the
 * watchdog detects a takeover.
 *
 * `ok: false` is any reason the reading is unusable — connection refused (the
 * server is gone), a non-OK status, a timeout, or a malformed body — folded
 * into one "failed poll" the reducer counts toward `server-gone`. The timeout
 * is short: this runs every few seconds and a hung request should read as a
 * failure, not stall the poll.
 */
export async function pollEditorLeaseIdentity(timeoutMs = 3000): Promise<LeasePollResult> {
  // Browser mode has no Node server to lease from; the watchdog never mounts
  // there, but guard anyway so a stray call can never false-void a page.
  if (typeof fetch === 'undefined') return { ok: false };
  try {
    const res = await fetch(`${BASE}/project`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await editorServerJson<{
      project?: { path?: unknown } | null;
      session?: { pid?: unknown } | null;
    }>(res, 'Editor lease poll failed');
    return {
      ok: true,
      identity: {
        project: typeof body.project?.path === 'string' ? body.project.path : null,
        pid: typeof body.session?.pid === 'number' ? body.session.pid : null,
      },
    };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Persistent editor state (.vgai/editor-state.json)
// ---------------------------------------------------------------------------

/** Load persisted editor state (remembered transform mode/snap/last
 *  scene/camera). Returns {} if none exists. */
export async function loadEditorState(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${BASE}/editor-state`);
    return await editorServerJson<Record<string, unknown>>(res, 'Could not read editor state');
  } catch {
    return {};
  }
}

/** Set once the write below has reported a failure, so an autosave that fires
 *  on every viewport change reports a permanently broken origin ONCE. */
let reportedEditorStateWriteFailure = false;

/** Save editor state (persisted in .vgai/editor-state.json — see
 *  `loadEditorState`'s doc comment for the browser-mode routing).
 *
 *  The boolean is this function's only channel and its one caller
 *  (`editor-shell-store.savePersistentState`) discards it, so the failure is
 *  ALSO logged: `res.ok` used to read a page fallback as a completed write,
 *  and a silent false would be the same lie one indirection later. */
export async function saveEditorState(
  state: Record<string, unknown>,
  options: { readonly leaving?: boolean } = {},
): Promise<boolean> {
  try {
    // A page going away cancels its requests unless they are kept alive (`postJson` says within
    // what bound).
    const res = await postJson(`${BASE}/editor-state`, JSON.stringify(state), options.leaving === true);
    assertEditorServerResponse(res, 'Could not save editor state');
    return true;
  } catch (cause) {
    if (!reportedEditorStateWriteFailure) {
      reportedEditorStateWriteFailure = true;
      // biome-ignore lint/suspicious/noConsole: the editor console captures console.error session-wide — this IS the report channel for a caller that discards the boolean.
      console.error(cause instanceof Error ? cause.message : String(cause));
    }
    return false;
  }
}
