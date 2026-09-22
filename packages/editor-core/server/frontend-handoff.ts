/**
 * THE AI IN THE TAB GETS ITS RUNTIME FROM THE SESSION, AT SPAWN.
 *
 * ARCHITECTURE-CORE §The core is Code-OSS, rule 7: the agent's front end is the
 * workbench's own Chat view, filled by `sdk/frontend-vscode`, and its back end is
 * the harness runtime this session already runs. This module is the wire between
 * them, and it is four environment variables.
 *
 * WHY ENV, AND WHY AT SPAWN. The extension's second connection path (its README,
 * "The runtime's environment handover") reads `SUPERCODE_FRONTEND_URL`,
 * `_CLIENT_ID`, `_CREDENTIAL_FILE` and `_PERMISSIONS` from the EXTENSION HOST's
 * environment at activation — the same shape supercode's own CLI uses to launch
 * the pi frontend, without the `PI` infix. A Code-OSS server passes its
 * environment to its extension host, and `frame-workbench.ts` spawns that server,
 * so the handover costs no pasted token and no route of ours. The price is that
 * env is FIXED AT SPAWN: whatever the runtime is when the REH starts is what the
 * panel gets, which is why the session starts the runtime first.
 *
 * WHY THE SESSION MINTS RATHER THAN FORWARDS. The runtime's receipt carries a
 * BOOTSTRAP bearer (`crates/harness/src/live_runtime.rs`), and handing that to a
 * frontend would give it the runtime's own authority. Every supercode frontend
 * instead asks the runtime's loopback mint door for a credential scoped to its
 * own client id and grant, and gives it back on the way out. That door's reader
 * and caller are supercode's, not ours —
 * `@volter-ai-dev/supercode-harness-sdk/live-runtime`, extracted there from
 * `sdk/teams`'s HTTP door when this became its second consumer.
 *
 * WHAT THE SESSION NEVER DOES is read the credential file back. It receives 64
 * hex bytes from the mint door, writes them 0600 where only this user can read
 * them, and hands over the PATH; the extension re-checks the file's identity
 * across the open (`sdk/frontend-vscode`'s `credential.ts`).
 *
 * RESOURCE OWNERSHIP, stated once:
 *  - OWNER: the `HarnessChatService` that minted it. It holds exactly one
 *    handoff at a time and replaces it only by disposing the previous one.
 *  - SHARERS: the REH child, which received the path in its environment and may
 *    re-read it across an extension-host reload for as long as the session lives.
 *  - THE ONE TEARDOWN: `dispose()`, called from the service's `close()` — the
 *    same shutdown list that stops the REH. Nothing else may revoke it, because
 *    a revoked grant with a live panel is a chat that has silently gone deaf.
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** `observe` watches, `interact` sends, `approve` answers a permission request.
 *  `terminate` is deliberately NOT here: the panel may drive the agent and answer
 *  for it, and may not kill the session the terminal and the CLI also hold. */
export const FRONTEND_PERMISSIONS = 'observe,interact,approve';

/**
 * THE OTHER HALF OF THE HANDOVER: why there is no runtime, when there is none.
 *
 * The four `SUPERCODE_FRONTEND_*` variables above hand the extension a runtime. This one hands
 * it the SENTENCE instead — B9c's refusal, which names the harness and its own login command —
 * and `sdk/frontend-vscode` 0.1.3 reads it at activation and shows it as the session's first
 * turn. Without it the Chat view was indistinguishable from a working one: "Build with Agent"
 * and a live input over an agent that would never answer (measured on the 0.1.1 bytes, gate 6).
 *
 * It is never set beside the four: a handoff either carries a runtime or carries the reason it
 * does not.
 */
export const FRONTEND_UNAVAILABLE_ENV = 'SUPERCODE_FRONTEND_UNAVAILABLE';

/** The four variables, and the one call that ends the grant they carry. */
export interface FrontendHandoff {
  /** Spread into the REH spawn's environment. Empty means there is nothing to hand over. */
  readonly env: Readonly<Record<string, string>>;
  /** The client id the runtime's lease coordinator will see. */
  readonly clientId: string;
  /** True when the runtime's mint door answered; false when it 404'd and the receipt's own
   *  bearer was handed over instead (see the measurement in `mintFrontendHandoff`). */
  readonly minted: boolean;
  /** Revoke the grant and delete the credential file. Idempotent. */
  dispose(): Promise<void>;
}

interface LiveRuntimeReceipt {
  readonly base_url: string;
  readonly token: string;
}

interface LiveRuntimeDoor {
  findLiveReceipt(runtimeId: string, env?: NodeJS.ProcessEnv): LiveRuntimeReceipt | null;
  mintFrontendCredential(
    receipt: LiveRuntimeReceipt,
    options: { clientId: string; grant: 'interactive' | 'observer' },
  ): Promise<string>;
  revokeFrontendCredential(
    receipt: LiveRuntimeReceipt,
    options: { clientId: string },
  ): Promise<number | undefined>;
}

function moduleCandidate(root: string | undefined, file: string): string[] {
  if (!root) return [];
  return [root.endsWith('.mjs') ? root : join(root, file)];
}

/**
 * The supercode door, resolved the way every other optional supercode import in
 * this server is: the published package first, a sibling checkout after, and a
 * refusal that names every location tried rather than an opaque `ERR_MODULE_NOT_FOUND`.
 */
async function importLiveRuntimeDoor(engineRoot: string): Promise<LiveRuntimeDoor> {
  const sibling = join(dirname(engineRoot), 'supercode', 'sdk', 'typescript', 'live-runtime.mjs');
  const cwdSibling = join(
    dirname(resolve(process.cwd())),
    'supercode',
    'sdk',
    'typescript',
    'live-runtime.mjs',
  );
  const failures: string[] = [];
  for (const candidate of [
    ...moduleCandidate(process.env['SUPERCODE_SDK_PATH'], 'live-runtime.mjs'),
    '@volter-ai-dev/supercode-harness-sdk/live-runtime',
    sibling,
    cwdSibling,
  ]) {
    try {
      const specifier = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate;
      const module = (await import(specifier)) as Partial<LiveRuntimeDoor>;
      if (module.findLiveReceipt && module.mintFrontendCredential && module.revokeFrontendCredential) {
        return module as LiveRuntimeDoor;
      }
      failures.push(`${candidate}: missing findLiveReceipt/mintFrontendCredential/revokeFrontendCredential`);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `The supercode live-runtime door could not be loaded, so the Chat view has no runtime to attach to. Tried:\n  ${failures.join('\n  ')}`,
  );
}

/**
 * Mint one scoped credential for a runtime this session started, and return the
 * environment the extension host reads at activation.
 *
 * `runtimeSessionId` is `ManagedRuntime.handle.runtime_id` — the same string the
 * runtime wrote into its receipt as `runtime_session_id`.
 */
export async function mintFrontendHandoff(options: {
  readonly engineRoot: string;
  readonly runtimeSessionId: string;
  /** Where the 0600 credential goes. One directory per session, removed with it. */
  readonly directory: string;
}): Promise<FrontendHandoff> {
  const door = await importLiveRuntimeDoor(options.engineRoot);
  const receipt = door.findLiveReceipt(options.runtimeSessionId);
  if (!receipt) {
    throw new Error(
      `Supercode registered no live receipt for runtime ${options.runtimeSessionId}, so there is nothing for the Chat view to attach to.`,
    );
  }
  const clientId = `vgai-editor-${process.pid}-${randomUUID().slice(0, 8)}`;
  // THERE ARE TWO HTTP SERVERS IN A SUPERCODE RUNTIME, and a MANAGED runtime's receipt
  // points at the one WITHOUT the mint door. Measured against supercode 0.4.36 on
  // 2026-09-21, on a runtime started through `startManagedRuntime`:
  //
  //   POST /rpc                                    200   (frontend.v2.describe answered)
  //   POST /_supercode/frontend-credentials/mint   404   {"error":"not found"}
  //   …the same path with no bearer                401   — so it IS supercode's server
  //
  // `crates/harness/src/server.rs`: `handle_http_conn` (~:2611) serves the mint door and is
  // what `supercode serve` runs; `handle_frontend_http_conn` (~:2962) is what
  // `insert_hosted_runtime` starts and registers in the receipt, and it serves `POST /rpc`,
  // `GET /frontend/events` and the observer assets — everything else is that 404.
  //
  // So the credential is minted WHEN THE DOOR EXISTS and is the receipt's own bearer when it
  // does not. That is not an invention: it is supercode's own fallback, transcribed from
  // `sdk/teams`'s HTTP door (`if (!/^mint 404/.test(error.message)) throw error;`), and it is
  // still SCOPED — the generated frontend client sends `x-supercode-client-id` and
  // `x-supercode-permissions` on every request (`sdk/frontend/client.mjs` :104-105), and
  // `coordinated_http_client` (~:2491) takes the supplied id for an unbound credential and
  // RESTRICTS the authorization to the header's permissions. What the fallback loses is the
  // server-side BINDING: a client that stripped those headers would keep the bootstrap's
  // authorization. Serving the mint door on the frontend server is supercode's to add.
  let token: string;
  let minted: boolean;
  try {
    token = await door.mintFrontendCredential(receipt, { clientId, grant: 'interactive' });
    minted = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/^mint 404/.test(message)) throw error;
    token = receipt.token;
    minted = false;
  }
  // The reader's own rules (`sdk/frontend-vscode`'s `credential.ts`): a regular,
  // private, single-linked file of exactly 64 lowercase hex bytes. Checked HERE too,
  // because a malformed secret should name the door it came from rather than surface later
  // as "the credential is malformed" from inside an extension host with no logs a person reads.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error(
      `The runtime's ${minted ? 'mint door' : 'receipt'} carried ${token.length} bytes that are not 64 hex characters; the Chat view's credential reader would refuse them.`,
    );
  }
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  chmodSync(options.directory, 0o700);
  const credentialFile = join(options.directory, 'frontend-credential');
  // `mode` on `writeFileSync` is masked by the umask, so the chmod is not redundant:
  // a 0022 umask would leave 0644 and the extension refuses a world-readable credential.
  writeFileSync(credentialFile, token, { mode: 0o600 });
  chmodSync(credentialFile, 0o600);
  let disposed = false;
  return {
    env: {
      SUPERCODE_FRONTEND_URL: receipt.base_url,
      SUPERCODE_FRONTEND_CLIENT_ID: clientId,
      SUPERCODE_FRONTEND_CREDENTIAL_FILE: credentialFile,
      SUPERCODE_FRONTEND_PERMISSIONS: FRONTEND_PERMISSIONS,
    },
    clientId,
    minted,
    async dispose() {
      if (disposed) return;
      disposed = true;
      rmSync(options.directory, { recursive: true, force: true });
      // Only a MINTED grant is ours to give back; the receipt's own bearer is the runtime's
      // and dies with it. A runtime that has already exited cannot take anything back either,
      // and saying so would be reporting the shutdown we are already performing.
      if (minted) await door.revokeFrontendCredential(receipt, { clientId }).catch(() => undefined);
    },
  };
}
