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
 * env is fixed at spawn, so the session starts the initial runtime first. The
 * private lifecycle channel supplies replacement handoffs for later selections.
 *
 * WHY THE SESSION MINTS RATHER THAN FORWARDS. The runtime's receipt carries a
 * BOOTSTRAP bearer (`crates/harness/src/live_runtime.rs`), and handing that to a
 * frontend would give it the runtime's own authority. Every supercode frontend
 * instead asks the runtime's loopback mint door for a credential scoped to its
 * own client id and grant, and gives it back on the way out. That door's reader
 * and caller are supercode's, not ours —
 * `@volter/supercode-harness-sdk/live-runtime`, extracted there from
 * `sdk/teams`'s HTTP door when this became its second consumer.
 *
 * WHAT THE SESSION NEVER DOES is read the credential file back. It receives 64
 * hex bytes from the mint door, writes them 0600 where only this user can read
 * them, and hands over the PATH; the extension re-checks the file's identity
 * across the open (`sdk/frontend-vscode`'s `credential.ts`).
 *
 * RESOURCE OWNERSHIP, stated once:
 *  - OWNER: the `HarnessChatService` that minted it. It holds exactly one
 *    handoff at a time; selection mints a replacement and disposes the previous one.
 *  - SHARERS: the REH child, which received the path in its environment and may
 *    re-read it across an extension-host reload for as long as the session lives.
 *  - TEARDOWN: `dispose()`, called when replacing a handoff or closing the service.
 *    The frontend reconnects using the lifecycle channel's current handoff.
 */

import { randomUUID } from 'node:crypto';
import { FrontendClient } from '@volter/supercode-frontend';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  /** Read the runtime itself: frontend turns do not pass through the headless controller. */
  isBusy(): Promise<boolean>;
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

/** Load the live-runtime door from an explicit SDK path or the installed package. */
async function importLiveRuntimeDoor(): Promise<LiveRuntimeDoor> {
  const failures: string[] = [];
  for (const candidate of [
    ...moduleCandidate(process.env['SUPERCODE_SDK_PATH'], 'live-runtime.mjs'),
    '@volter/supercode-harness-sdk/live-runtime',
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
    `The Volter Harness live-runtime door could not be loaded, so the Chat view has no runtime to attach to. Tried:\n  ${failures.join('\n  ')}`,
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
  readonly runtimeSessionId: string;
  /** Where the 0600 credential goes. One directory per session, removed with it. */
  readonly directory: string;
}): Promise<FrontendHandoff> {
  const door = await importLiveRuntimeDoor();
  const receipt = door.findLiveReceipt(options.runtimeSessionId);
  if (!receipt) {
    throw new Error(
      `Volter Harness registered no live receipt for runtime ${options.runtimeSessionId}, so there is nothing for the Chat view to attach to.`,
    );
  }
  const clientId = `volter-editor-${process.pid}-${randomUUID().slice(0, 8)}`;
  const token = await door.mintFrontendCredential(receipt, { clientId, grant: 'interactive' });
  // The reader's own rules (`sdk/frontend-vscode`'s `credential.ts`): a regular,
  // private, single-linked file of exactly 64 lowercase hex bytes. Checked HERE too,
  // because a malformed secret should name the door it came from rather than surface later
  // as "the credential is malformed" from inside an extension host with no logs a person reads.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error(
      `The runtime's mint door carried ${token.length} bytes that are not 64 hex characters; the Chat view's credential reader would refuse them.`,
    );
  }
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  chmodSync(options.directory, 0o700);
  const credentialFile = join(options.directory, 'frontend-credential');
  // `mode` on `writeFileSync` is masked by the umask, so the chmod is not redundant:
  // a 0022 umask would leave 0644 and the extension refuses a world-readable credential.
  writeFileSync(credentialFile, token, { mode: 0o600 });
  chmodSync(credentialFile, 0o600);
  const observer = new FrontendClient({baseUrl:receipt.base_url, token, clientId, permissions:['observe']});
  let disposed = false;
  return {
    env: {
      SUPERCODE_FRONTEND_URL: receipt.base_url,
      SUPERCODE_FRONTEND_CLIENT_ID: clientId,
      SUPERCODE_FRONTEND_CREDENTIAL_FILE: credentialFile,
      SUPERCODE_FRONTEND_PERMISSIONS: FRONTEND_PERMISSIONS,
    },
    clientId,
    async isBusy() {
      if (disposed) throw new Error('The chat runtime handoff is no longer active.');
      return (await observer.describe({signal:AbortSignal.timeout(5000)})).turn_state === 'busy';
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      rmSync(options.directory, { recursive: true, force: true });
      // A runtime that has already exited cannot accept revocation.
      await door.revokeFrontendCredential(receipt, { clientId }).catch(() => undefined);
    },
  };
}
