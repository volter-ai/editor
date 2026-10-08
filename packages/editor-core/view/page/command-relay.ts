/**
 * THE SESSION'S COMMAND RELAY, IN THE PAGE — `POST /__editor/command` in a limited view.
 *
 * In a session a caller posts a command to the server, the server hands it to the tab over the
 * control channel as an `editor-command` event, the tab's listener runs it
 * (`@volter/editor-sdk` `kit/command-listener.ts`) and reports `command-result`, and the server
 * answers the caller (`server/routes/relay.ts`, `control-plane.ts`).
 *
 * A limited view has the tab and its listener and no server, so the page is both ends: this
 * dispatches the event on the tab's own control source and answers the caller when the listener
 * posts its result back, which it does over HTTP because the view's control socket never opens
 * (`boot.ts`, `installQuietSessionSockets`). The listener, the command table and every
 * contributed verb run unchanged; the request and response shapes are the session's.
 */

import type { ViewRoute } from '@volter/editor-sdk/session/limited-view';
import { COMMAND_RESULT_RECEIPT_EVENT } from '@volter/editor-sdk/session/editor-control-protocol';
import { relayCommandTimeoutMs } from '@volter/editor-sdk/session/command-table';

/** What a command answered: the session's `{ ok, error?, data? }`, and whether its budget ran out. */
export interface PageCommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: Record<string, unknown>;
  readonly timedOut?: boolean;
}

/** The tab bootstrap's shared control source (`src/tab-bootstrap.js`), when the editor has started. */
function controlSource(): EventTarget | null {
  const bootstrap = (globalThis as Record<string, unknown>)['__VOLTER_EDITOR_PRESENCE_BOOTSTRAP__'] as
    | { source?: unknown }
    | undefined;
  return bootstrap?.source instanceof EventTarget ? bootstrap.source : null;
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface PageCommandRelay {
  /** The relay's routes, for the page's router. */
  readonly routes: readonly ViewRoute[];
  /** Run one command from this page itself, with no request through the service worker. */
  run(command: Record<string, unknown>): Promise<PageCommandResult>;
}

export function createPageCommandRelay(json: (body: unknown, status?: number) => Response): PageCommandRelay {
  const pending = new Map<string, (result: PageCommandResult) => void>();
  /** The budgets the tab's contributed verbs declared (`/__editor/contributed-commands`). */
  const contributedTimeouts = new Map<string, number>();

  const run = async (command: Record<string, unknown>): Promise<PageCommandResult> => {
    const source = controlSource();
    if (!source) return { ok: false, timedOut: true, error: 'Command timed out — no editor connected.' };
    const type = String(command['type']);
    const requestId = crypto.randomUUID();
    const budget = contributedTimeouts.get(type) ?? relayCommandTimeoutMs(type, command);
    return new Promise<PageCommandResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({ ok: false, timedOut: true, error: `The editor did not answer '${type}' within ${budget} ms.` });
      }, budget);
      pending.set(requestId, (answered) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(answered);
      });
      source.dispatchEvent(new MessageEvent('editor-command', { data: JSON.stringify({ ...command, _requestId: requestId }) }));
    });
  };

  const routes: ViewRoute[] = [
    {
      method: 'POST',
      match: /^\/__editor\/command$/,
      handle: async (request) => {
        const command = await readObject(request);
        if (!command || typeof command['type'] !== 'string') return json({ ok: false, error: 'A command is a JSON object with a type.' }, 400);
        const result = await run(command);
        // `commandResponseFor` (`server/server-utils.ts`), without the console ledger a view does not keep.
        if (result.ok) return json({ ok: true, ...(result.data ?? {}) });
        if (result.timedOut) return json({ ok: false, error: result.error }, 504);
        return json({ ok: false, error: result.error, ...(result.data ?? {}) });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/command-result$/,
      handle: async (request) => {
        const body = await readObject(request);
        const requestId = typeof body?.['_requestId'] === 'string' ? body['_requestId'] : '';
        const settle = pending.get(requestId);
        if (body && settle) {
          settle({
            ok: body['ok'] === true,
            ...(typeof body['error'] === 'string' ? { error: body['error'] } : {}),
            ...(body['data'] && typeof body['data'] === 'object' ? { data: body['data'] as Record<string, unknown> } : {}),
          });
        }
        // The listener holds a deferred presentation until its caller is answered, and learns
        // that from this receipt.
        if (body?.['_awaitCallerReceipt'] === true) {
          controlSource()?.dispatchEvent(new MessageEvent(COMMAND_RESULT_RECEIPT_EVENT, { data: JSON.stringify(requestId) }));
        }
        return json({ ok: true });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/contributed-commands$/,
      handle: async (request) => {
        const rows = (await readObject(request))?.['commands'];
        if (!Array.isArray(rows)) return json({ error: 'contributed-commands requires { commands: [] }.' }, 400);
        contributedTimeouts.clear();
        for (const row of rows as unknown[]) {
          const record = (row ?? {}) as Record<string, unknown>;
          if (typeof record['type'] === 'string' && typeof record['timeoutMs'] === 'number' && record['timeoutMs'] > 0) {
            contributedTimeouts.set(record['type'], record['timeoutMs']);
          }
        }
        return json({ ok: true });
      },
    },
  ];
  return { routes, run };
}
