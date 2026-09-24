/**
 * The client half of `/__editor/configurations` (`server/routes/run.ts`): the project's
 * declared run configurations and their runtime status, and the start/stop
 * verbs the transport's picker and `vgai run` share.
 */

import { assertEditorServerResponse, editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';

export interface ConfigurationStatus {
  readonly id: string;
  readonly kind: string;
  /** The kind's registered role, or `null` for a kind this host does not know. */
  readonly role: 'run' | 'build' | null;
  readonly describe: string | null;
  readonly status: 'running' | 'stopped';
  readonly pid?: number;
  readonly since?: number;
  readonly entry?: string;
  readonly port?: number | null;
  readonly run?: readonly string[];
  readonly instances?: number | null;
}

/** The declared configurations with status. */
export async function listConfigurations(): Promise<ConfigurationStatus[]> {
  const res = await fetch(`${BASE}/configurations`);
  const body = await editorServerJson<{ configurations: ConfigurationStatus[] }>(
    res,
    'Could not list run configurations',
  );
  return body.configurations;
}

export interface StartConfigurationOutcome {
  readonly ok: boolean;
  readonly started: readonly string[];
  readonly attached: readonly string[];
  readonly ready: boolean;
  readonly logs: Readonly<Record<string, readonly string[]>>;
}

export async function startConfiguration(id: string): Promise<StartConfigurationOutcome> {
  const res = await fetch(`${BASE}/configurations/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  });
  return editorServerJson<StartConfigurationOutcome>(
    res,
    `Could not start run configuration "${id}"`,
  );
}

/** Start a build-role configuration; the response is the server's SSE log
 *  stream (`log` and `done` events), which the Build document consumes. */
export async function startBuild(id: string, signal?: AbortSignal | null): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  if (signal) init.signal = signal;
  return fetch(`${BASE}/configurations/${encodeURIComponent(id)}/build`, init);
}

export async function stopConfiguration(id: string): Promise<void> {
  const res = await fetch(`${BASE}/configurations/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
  });
  assertEditorServerResponse(res, `Could not stop run configuration "${id}"`);
}
