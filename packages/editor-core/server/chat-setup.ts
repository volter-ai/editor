/** Host data for Supercode's native Chat setup. Credentials stay with the harness. */
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { HarnessChatHarness } from '../src/harness-chat-types';

export interface ChatSetupAction {
  kind: 'login' | 'install';
  harness: string;
  name: string;
  command: string;
}

/** The agents the Chat welcome offers by the plan people pay for (docs/CHAT-WELCOME.md), each with the
 *  vendor's own npm package: Codex from OpenAI, Claude Code from Anthropic. */
export const CHAT_SETUP_PROVIDERS: Readonly<Record<string, { provider: 'openai' | 'anthropic'; npmPackage: string }>> = {
  codex: { provider: 'openai', npmPackage: '@openai/codex' },
  'claude-code': { provider: 'anthropic', npmPackage: '@anthropic-ai/claude-code' },
};

/** One row per agent the welcome can show: what is installed and signed in. No credentials. Supercode's
 *  inventory reports auth state, not the account, so `account` is null until it does. */
export interface ChatSetupAgent {
  harness: string;
  name: string;
  provider: 'openai' | 'anthropic' | null;
  installed: boolean;
  signedIn: boolean;
  account: string | null;
}

export function chatSetupAgents(harnesses: readonly HarnessChatHarness[]): ChatSetupAgent[] {
  // The two providers' agents always (installed or not), then any other installed agent that can start a chat;
  // Supercode itself is the bridge that reports this inventory, not an agent.
  return harnesses
    .filter(h => h.id in CHAT_SETUP_PROVIDERS || (h.installed && h.id !== 'supercode' && h.capabilities.startSession))
    .sort((a, b) => setupOrder(a.id) - setupOrder(b.id))
    .map(h => ({
      harness: h.id, name: h.label, provider: CHAT_SETUP_PROVIDERS[h.id]?.provider ?? null,
      installed: h.installed, signedIn: h.installed && h.auth === 'ready', account: null,
    }));
}

function setupOrder(id: string): number {
  const index = Object.keys(CHAT_SETUP_PROVIDERS).indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function chatSetupActions(harnesses: readonly HarnessChatHarness[], programs: { supercode?: string | undefined; npm?: string | undefined; npmPrefix?: string | undefined }): ChatSetupAction[] {
  const supercode = programs.supercode;
  const signedOut = harnesses.filter(h => h.availableActions.login === true)
    .sort((a, b) => setupOrder(a.id) - setupOrder(b.id));
  const logins: ChatSetupAction[] = supercode ? signedOut.map(h => ({
    kind: 'login', harness: h.id, name: h.label, command: `${quoteProgram(supercode)} harness login ${h.id}`,
  })) : [];
  // Each provider's agent that is missing gets its own install, whatever else is ready: the welcome's button
  // installs it and then signs in, in one click. Its login action appears once the install lands.
  const installs: ChatSetupAction[] = programs.npm && programs.npmPrefix
    ? harnesses.filter(h => h.id in CHAT_SETUP_PROVIDERS && !h.installed)
      .sort((a, b) => setupOrder(a.id) - setupOrder(b.id))
      .map(h => ({
        kind: 'install', harness: h.id, name: h.label,
        command: `${quoteProgram(programs.npm!)} install -g --prefix ${quoteProgram(programs.npmPrefix!)} ${CHAT_SETUP_PROVIDERS[h.id]!.npmPackage}`,
      }))
    : [];
  return [...logins, ...installs];
}

function quoteProgram(program: string): string { return `'${program.replaceAll("'", "'\\''")}'`; }

/** Resolve the executable now, before a terminal's shell environment can select another install. */
export function chatExecutable(command: string, cwd: string, path = process.env['PATH'] ?? ''): string | undefined {
  const candidates = isAbsolute(command) || command.includes('/') ? [resolve(cwd, command)]
    : path.split(delimiter).map(dir => resolve(cwd, dir, command));
  return candidates.find(candidate => {
    try { accessSync(candidate, constants.X_OK); return statSync(candidate).isFile(); } catch { return false; }
  });
}

/** Put npm's actual global bin on the long-lived probe's PATH before the first inventory.
 * Installing later adds a file to an already-searched directory; no process restart is needed. */
export async function chatProcessEnvironment(cwd: string): Promise<{ env: { PATH: string }; npm?: string; npmPrefix?: string; installError?: string }> {
  const env = { PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter) };
  const npm = chatExecutable('npm', cwd, env.PATH);
  if (!npm) return { env, installError: 'npm is unavailable to the editor process.' };
  try {
    const { stdout } = await promisify(execFile)(npm, ['prefix', '--global'], {
      windowsHide: true,
      cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000,
    });
    const prefix = stdout.trim();
    if (!isAbsolute(prefix) || /[\r\n]/.test(prefix)) throw new Error('npm returned no absolute global prefix.');
    const bin = process.platform === 'win32' ? prefix : join(prefix, 'bin');
    if (!env.PATH.split(delimiter).includes(bin)) env.PATH += delimiter + bin;
    return { env, npm, npmPrefix: prefix };
  } catch (error) {
    return { env, installError: `Cannot resolve npm's install directory: ${error instanceof Error ? error.message : String(error)}` };
  }
}
