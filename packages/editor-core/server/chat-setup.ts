/** Host data for Supercode's native Chat setup. Credentials stay with the harness. */
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { HarnessChatHarness } from '../src/harness-chat-types';

export interface ChatSetupAction {
  kind: 'login' | 'install';
  harness: string;
  name: string;
  command: string;
}

/** The one agent the Chat welcome installs and signs in, with the vendor's own npm package: Codex, by Sign in with
 *  ChatGPT (docs/CHAT-WELCOME.md). Any other agent already on this machine is used as it is, never offered for
 *  install (the owner's ruling, 2026-10-07: "sign in with chat gpt or use whatever we're already signed into
 *  locally"). */
export const CHAT_SETUP_PROVIDERS: Readonly<Record<string, { provider: 'openai' | 'anthropic'; npmPackage: string }>> = {
  codex: { provider: 'openai', npmPackage: '@openai/codex' },
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
      // 'configured' auth also starts a chat (autoStart) and offers no sign-in.
      installed: h.installed, signedIn: h.installed && h.availableActions.login !== true && (h.auth === 'ready' || h.auth === 'configured'),
      account: null,
    }));
}

function setupOrder(id: string): number {
  const index = Object.keys(CHAT_SETUP_PROVIDERS).indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function chatSetupActions(harnesses: readonly HarnessChatHarness[], programs: { supercode?: string | undefined; npm?: string | undefined; npmArgs?: readonly string[] | undefined; npmPrefix?: string | undefined }): ChatSetupAction[] {
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
        command: [programs.npm!, ...(programs.npmArgs ?? [])].map(quoteProgram).join(' ') +
          ` install -g --prefix ${quoteProgram(programs.npmPrefix!)} ${CHAT_SETUP_PROVIDERS[h.id]!.npmPackage}`,
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

/** npm as a process the editor can start directly, with no shell between: the program and its leading arguments.
 *  On Windows the `npm` on PATH is a shell script and `npm.cmd` a batch file, and neither is a native executable,
 *  so npm runs as Node on its own CLI script: first the npm beside this Node, then the one beside an npm.cmd on
 *  PATH. Elsewhere `npm` itself is executable. */
export function chatNpm(cwd: string, path: string): { program: string; args: string[] } | undefined {
  if (process.platform !== 'win32') {
    const npm = chatExecutable('npm', cwd, path);
    return npm ? { program: npm, args: [] } : undefined;
  }
  const dirs = [dirname(process.execPath), ...path.split(delimiter).filter(dir => {
    try { return statSync(join(dir, 'npm.cmd')).isFile(); } catch { return false; }
  })];
  for (const dir of dirs) {
    const cli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    try { if (statSync(cli).isFile()) return { program: process.execPath, args: [cli] }; } catch { /* the next */ }
  }
  return undefined;
}

/** Where Chat installs an agent: npm's global prefix when this user can write it, otherwise a prefix of the editor's
 *  own in the home directory. The nodejs.org installer on macOS (and a system Node on Linux) leaves the global prefix
 *  to root, so `npm install -g` there fails with EACCES, and the welcome's one-click install would end in "Sign-in
 *  didn't finish." for exactly the people installing their first agent. Windows' access check reads only the
 *  read-only attribute, not ACLs, so there npm's per-user default prefix is taken as it is. */
export function agentInstallPrefix(globalPrefix: string, home = homedir()): string {
  const targets = process.platform === 'win32' ? [join(globalPrefix, 'node_modules'), globalPrefix]
    : [join(globalPrefix, 'lib', 'node_modules'), join(globalPrefix, 'bin')];
  const writable = targets.every(target => {
    let dir = target;
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    try { accessSync(dir, constants.W_OK); return true; } catch { return false; }
  });
  if (writable) return globalPrefix;
  const own = join(home, '.volter', 'agents');
  // A home that refuses the folder keeps the global prefix: its install then fails visibly, and agents already
  // installed there stay on PATH instead of the whole probe failing.
  try { mkdirSync(own, { recursive: true }); } catch { return globalPrefix; }
  return own;
}

/** The PATH a sign-in terminal runs with. On Windows npm installs an extensionless shell script beside each agent's
 *  `.cmd` shim, and supercode's sign-in lookup (harness_auth.rs `find_executable`, 0.5.184 and main on
 *  2026-10-07) takes the bare name first, so `harness login codex` started that script and failed with os error 193
 *  ("not a valid Win32 application"): a first-time user's Sign in with ChatGPT ended in "Sign-in didn't finish."
 *  When the agent was installed by npm into `prefix`, a folder holding only `<harness>.cmd`, which calls npm's
 *  shim, comes first on that terminal's PATH, and the lookup finds a file Windows can start. Elsewhere, or for an
 *  agent installed any other way, PATH is unchanged. */
export function signInPath(path: string, prefix: string | undefined, harness: string, home = homedir()): string {
  if (process.platform !== 'win32' || !prefix) return path;
  const shim = join(prefix, `${harness}.cmd`);
  if (!existsSync(join(prefix, harness)) || !existsSync(shim)) return path;
  const dir = join(home, '.volter', 'sign-in-shims');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${harness}.cmd`), ['@echo off', `call "${shim}" %*`, ''].join('\r\n'));
  } catch { return path; }
  return dir + delimiter + path;
}

function prefixBin(prefix: string): string { return process.platform === 'win32' ? prefix : join(prefix, 'bin'); }

/** Put npm's actual global bin on the long-lived probe's PATH before the first inventory.
 * Installing later adds a file to an already-searched directory; no process restart is needed. */
export async function chatProcessEnvironment(cwd: string): Promise<{ env: { PATH: string }; npm?: string; npmArgs?: string[]; npmPrefix?: string; installError?: string }> {
  const env = { PATH: [dirname(process.execPath), process.env['PATH'] ?? ''].join(delimiter) };
  const resolved = chatNpm(cwd, env.PATH);
  if (!resolved) return { env, installError: 'npm is unavailable to the editor process.' };
  const { program: npm, args: npmArgs } = resolved;
  try {
    const { stdout } = await promisify(execFile)(npm, [...npmArgs, 'prefix', '--global'], {
      windowsHide: true,
      cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10_000,
    });
    const prefix = stdout.trim();
    if (!isAbsolute(prefix) || /[\r\n]/.test(prefix)) throw new Error('npm returned no absolute global prefix.');
    // Agents the person installed globally stay findable; Chat's own installs go where this user can write.
    const installPrefix = agentInstallPrefix(prefix);
    if (!env.PATH.split(delimiter).includes(prefixBin(prefix))) env.PATH += delimiter + prefixBin(prefix);
    // An agent Chat installed into its own prefix comes first, so an older copy in the root-owned prefix (or anywhere
    // else on PATH) doesn't shadow it.
    if (installPrefix !== prefix) env.PATH = prefixBin(installPrefix) + delimiter + env.PATH;
    return { env, npm, npmArgs, npmPrefix: installPrefix };
  } catch (error) {
    return { env, installError: `Cannot resolve npm's install directory: ${error instanceof Error ? error.message : String(error)}` };
  }
}
