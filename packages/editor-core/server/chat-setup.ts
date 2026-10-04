/** Host data for Supercode's native Chat setup. Credentials stay with the harness. */
import { ChatStarterPromptsSchema } from '@volter/editor-project/adapter/adapter-module';
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { HarnessChatHarness } from '../src/harness-chat-types';

export interface ChatSetupAction {
  kind: 'login' | 'install';
  harness: string;
  name: string;
  command: string;
}

export function chatSetupActions(harnesses: readonly HarnessChatHarness[], programs: { supercode?: string | undefined; npm?: string | undefined }): ChatSetupAction[] {
  const signedOut = harnesses.filter(h => h.installed && h.auth === 'required')
    .sort((a, b) => Number(b.id === 'codex') - Number(a.id === 'codex'));
  if (signedOut.length) return programs.supercode ? signedOut.map(h => ({
    kind: 'login', harness: h.id, name: h.label, command: `${quoteProgram(programs.supercode!)} harness login ${h.id}`,
  })) : [];
  // Offer one concrete install, only when the registry reports Codex and no agent is installed.
  const codex = harnesses.find(h => h.id === 'codex');
  // Supercode itself is necessarily installed to report this inventory; it is
  // the bridge, not an installed subscription agent for this first-run offer.
  return programs.npm && codex && !codex.installed && !harnesses.some(h => h.installed && h.id !== 'supercode' && h.capabilities.startSession) ? [{
    kind: 'install', harness: codex.id, name: codex.label, command: `${quoteProgram(programs.npm)} install -g @openai/codex`,
  }] : [];
}

function quoteProgram(program: string): string { return `'${program.replaceAll("'", "'\\''")}'`; }

/** Resolve the executable now, before a terminal's shell environment can select another install. */
export function chatExecutable(command: string, cwd: string, path = process.env['PATH'] ?? ''): string | undefined {
  const candidates = isAbsolute(command) || command.includes('/') ? [resolve(cwd, command)]
    : path.split(delimiter).map(dir => resolve(cwd, dir, command));
  return candidates.find(candidate => {
    try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
  });
}

/** Put npm's actual global bin on the long-lived probe's PATH before the first inventory.
 * Installing later adds a file to an already-searched directory; no process restart is needed. */
export async function chatProcessEnvironment(cwd: string): Promise<{ env: { PATH: string }; npm?: string; installError?: string }> {
  const env = { PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter) };
  const npm = chatExecutable('npm', cwd, env.PATH);
  if (!npm) return { env, installError: 'npm is unavailable to the editor process.' };
  try {
    const { stdout } = await promisify(execFile)(npm, ['prefix', '--global'], {
      cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000,
    });
    const prefix = stdout.trim();
    if (!isAbsolute(prefix) || /[\r\n]/.test(prefix)) throw new Error('npm returned no absolute global prefix.');
    const bin = process.platform === 'win32' ? prefix : join(prefix, 'bin');
    if (!env.PATH.split(delimiter).includes(bin)) env.PATH += delimiter + bin;
    return { env, npm };
  } catch (error) {
    return { env, installError: `Cannot resolve npm's install directory: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Read the loaded adapter's existing wire facet, never evaluate a second project module.
 * Undefined means the project adapter has not reported yet, not an empty declaration. */
export function chatStarterPrompts(adapter: unknown): string[] | undefined {
  if (!adapter || typeof adapter !== 'object') return undefined;
  const editor: unknown = Reflect.get(adapter, 'editor');
  const chat: unknown = editor && typeof editor === 'object' ? Reflect.get(editor, 'chat') : undefined;
  return ChatStarterPromptsSchema.parse(chat && typeof chat === 'object' ? Reflect.get(chat, 'starterPrompts') : []);
}
