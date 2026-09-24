/**
 * What a TAB reports upstream: its state snapshot, that it picked a command
 * up, that a command finished, which play-boot phase it is in — plus the
 * gameplay recording sink.
 *
 * The editor-state reporter serializes and coalesces on purpose. One user
 * action can change several things at once (a Play click changes both play
 * state and the active viewport), so only the newest waiting snapshot is kept
 * and sends are serialized — an older, slower report can never land after a
 * newer one and roll `/__editor/state` back.
 */

import {
  EDITOR_CLIENT_ID,
  reportTabPhase,
  sendCommandResultControl,
  sendControl,
} from '../editor-presence';
import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';

// State reports can be triggered by several browser-owned transitions at once
// (a Play click changes both play state and the active viewport, for example).
// Keep only the newest waiting snapshot and serialize sends so an older,
// slower report can never land after a newer one and roll `/__editor/state`
// back.
let pendingEditorState: Record<string, unknown> | null = null;
let editorStateReportDrain: Promise<void> | null = null;

async function drainEditorStateReports(): Promise<void> {
  while (pendingEditorState) {
    const state = pendingEditorState;
    pendingEditorState = null;
    await sendControl('state', { ...state, _clientId: EDITOR_CLIENT_ID });
  }
  editorStateReportDrain = null;
  // A caller cannot interleave with the synchronous block above, but keep
  // this defensive restart so future refactors cannot strand a late report.
  if (pendingEditorState) editorStateReportDrain = drainEditorStateReports();
}

/** Report the current editor state to the server (called by command-listener). */
export function reportEditorState(state: Record<string, unknown>): Promise<void> {
  pendingEditorState = state;
  editorStateReportDrain ??= drainEditorStateReports();
  return editorStateReportDrain;
}

/**
 * Tell the server this tab PICKED UP a relayed command — sent before the work
 * starts, so it says "my command listener is running", nothing about the
 * outcome.
 *
 * Long-budget commands (`play` waits out a whole async `setup()`) used to give
 * a tab that had stopped answering the control channel the same silence as a tab
 * that was merely busy, and the caller waited the entire budget for a result
 * that was never coming. This receipt is what separates the two — see
 * `server/server-utils.ts`'s `RELAY_DELIVERY_ACK_MS`. Best-effort and
 * deliberately not awaited by the caller: a lost receipt costs a fast, named
 * refusal, never a wrong result.
 */
export async function reportCommandReceived(requestId: string): Promise<void> {
  await sendControl('command-received', { _requestId: requestId, _clientId: EDITOR_CLIENT_ID });
}

/**
 * Tell the server whether this page is RUNNING a command listener at all.
 *
 * The receipt above answers that question one command at a time, and only
 * after somebody sends a command. This answers it standing, at the two moments
 * that change the answer — `connectCommandListener` attaching, and its
 * teardown running — so `vgai status` can name a dead page on the FIRST read
 * instead of it being inferable only from a command that hangs.
 *
 * It is worth its own message because presence cannot carry it: the control
 * channel is opened by the tiny pre-React entry
 * (`early-editor-presence.ts`), long before the React graph that owns the
 * listener finishes loading — so a page that dies in between connects,
 * beats, and executes nothing.
 */
export async function reportCommandListener(attached: boolean): Promise<void> {
  await sendControl('command-listener', { _clientId: EDITOR_CLIENT_ID, attached });
}

/**
 * Tell the server which play-boot step this page is ENTERING.
 *
 * Sent before the step's work, never after it, so a step that never returns is
 * still named — see `play-boot-phase.ts` for the 199.5-second block that made
 * three consecutive commands time out against a session every reader called
 * healthy. Not awaited by the caller: the phase is diagnostics, and diagnostics
 * that can delay a boot are worse than none.
 */
let phaseSequence = 0;
export function reportPlayBootPhase(state: {
  phase: string | null;
  at: number;
  run: number;
}): void {
  // Two roads, because the control socket is the PAGE's: a phase announced
  // right before a synchronous block sat in the page's send queue until the
  // block ended (measured 2026-09-06: a 45 s build's phase arrived after the
  // build). The heartbeat worker's socket keeps beating through the block,
  // so the phase rides the next beat too; whichever lands first wins.
  const sequence = ++phaseSequence;
  reportTabPhase(state.phase, EDITOR_CLIENT_ID, sequence);
  void sendControl('play-phase', { _clientId: EDITOR_CLIENT_ID, ...state, source: EDITOR_CLIENT_ID, sequence });
}

/** Report a command result back to the server so the SDK/CLI gets the response.
 *  `data` carries an optional payload for commands that answer with data
 *  (e.g. `capture-viewport`'s base64 PNG, the debug-seam reads)
 *  forwarded verbatim through `/__editor/command-result` →
 *  `commandResponseFor` → the SDK transports, on the failure path too (where
 *  it carries structured `{ code: ... }` markers). */
export async function reportCommandResult(
  requestId: string,
  ok: boolean,
  error?: string,
  data?: Record<string, unknown>,
  waitForCaller = false,
): Promise<void> {
  const payload = {
    _requestId: requestId,
    _clientId: EDITOR_CLIENT_ID,
    ok,
    error,
    data,
  };
  if (waitForCaller) await sendCommandResultControl(requestId, payload);
  else await sendControl('command-result', payload);
}

export interface GameplayRecordingSink {
  id: string;
  path: string;
  format: 'composite-webm' | 'canvas-dom';
  /** Directory containing `manifest.json`, `events.json`, and interned assets
   * for a canvas + DOM recording. Absent for a composite WebM. */
  replayPath: string | null;
  /** True when this sink is the ROTATING unnamed file — the next recording
   *  overwrites it. False for a caller-named keepsake. */
  rotates: boolean;
  /** The `logs/play-*.jsonl` this project's live play run is writing, or
   *  `null` when nothing is logging. Its event timestamps are what map an
   *  event to an offset in the clip, so it travels WITH the clip's identity
   *  rather than being looked up separately later. */
  logFile: string | null;
}

async function recordingResponse<T>(response: Response, action: string): Promise<T> {
  // `.json().catch(() => ({}))` under a page fallback produced an OK-looking
  // empty sink: `start` handed back a sink with no id, and every chunk after it
  // posted into nothing while the recorder showed a recording in progress.
  assertEditorServerAnswered(response, `gameplay recording ${action} failed`);
  const body = (await response.json().catch(() => ({}))) as { error?: unknown } & T;
  if (!response.ok) {
    throw new Error(
      `gameplay recording ${action} failed: ${typeof body.error === 'string' ? body.error : `HTTP ${response.status}`}`,
    );
  }
  return body;
}

/** Open the server-owned, project-scoped WebM sink. Video bytes never ride the
 * JSON command relay: a long QA playthrough must not hit its 50 MiB ceiling. */
export async function beginGameplayRecordingSink(
  input: {
    startedAt: string;
    mimeType: string;
    format?: 'composite-webm' | 'canvas-dom';
    /** Fixed-step exports do not use the session's wall-clock playback timeline. */
    purpose?: 'export';
    /** During Play, `null` names the clip after the Gameplay Session; outside
     *  one it falls back to `play-latest.webm`. A name takes a keepsake path. */
    name?: string | null;
  },
  signal?: AbortSignal,
): Promise<GameplayRecordingSink> {
  const response = await fetch(`${BASE}/recording/start`, {
    ...(signal ? { signal } : {}),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return recordingResponse<GameplayRecordingSink>(response, 'start');
}

/** Append an ordered batch of standard rrweb events. */
export async function appendGameplayRecordingDomEvents(
  sink: GameplayRecordingSink,
  sequence: number,
  eventsJson: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const query = new URLSearchParams({ id: sink.id, sequence: String(sequence) });
  const response = await fetch(`${BASE}/recording/dom?${query}`, {
    ...(signal ? { signal } : {}),
    method: 'POST',
    // This is a streamed file body. Labeling it application/json lets the
    // server's ordinary JSON middleware consume it before the route can apply
    // its own byte bound, ordering, and append semantics.
    headers: { 'content-type': 'application/octet-stream' },
    body: eventsJson,
  });
  await recordingResponse<Record<string, never>>(response, 'DOM event upload');
}

/** Store one image interned out of the rrweb event stream. */
export async function appendGameplayRecordingAsset(
  sink: GameplayRecordingSink,
  name: string,
  asset: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const query = new URLSearchParams({ id: sink.id, name });
  const response = await fetch(`${BASE}/recording/asset?${query}`, {
    ...(signal ? { signal } : {}),
    method: 'POST',
    headers: { 'content-type': asset.type || 'application/octet-stream' },
    body: asset,
  });
  await recordingResponse<Record<string, never>>(response, 'replay asset upload');
}

/** Append one ordered MediaRecorder chunk to the open WebM. */
export async function appendGameplayRecordingChunk(
  sink: GameplayRecordingSink,
  sequence: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const query = new URLSearchParams({ id: sink.id, sequence: String(sequence) });
  const response = await fetch(`${BASE}/recording/chunk?${query}`, {
    ...(signal ? { signal } : {}),
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: chunk,
  });
  await recordingResponse<Record<string, never>>(response, 'chunk upload');
}

export async function finishGameplayRecordingSink(
  sink: GameplayRecordingSink,
  /** What ended it — journalled verbatim beside the file it produced. */
  reason?: string | null,
  signal?: AbortSignal,
  replay?: Record<string, unknown> | null,
): Promise<void> {
  const response = await fetch(`${BASE}/recording/finish`, {
    ...(signal ? { signal } : {}),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: sink.id, reason: reason ?? null, replay: replay ?? null }),
  });
  await recordingResponse<Record<string, never>>(response, 'finish');
}

/** Deliberately NOT read through `editor-server-response.ts`: this is the
 *  teardown leg, called only when a recording is already being abandoned, and
 *  its `.catch(() => undefined)` is the contract — there is no caller left to
 *  report to, so asserting could only turn a silent no-op into a swallowed
 *  throw. */
export async function abortGameplayRecordingSink(sink: GameplayRecordingSink): Promise<void> {
  await fetch(`${BASE}/recording/abort`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: sink.id }),
  }).catch(() => undefined);
}
