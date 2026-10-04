/** Host data for Supercode's native Chat setup. Credentials stay with the harness. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessChatHarness } from '../src/harness-chat-types';

export interface ChatSetupAction {
  kind: 'login' | 'install';
  harness: string;
  name: string;
  command: string;
}

export function chatSetupActions(harnesses: readonly HarnessChatHarness[]): ChatSetupAction[] {
  const signedOut = harnesses.filter(h => h.installed && h.auth === 'required')
    .sort((a, b) => Number(b.id === 'codex') - Number(a.id === 'codex'));
  if (signedOut.length) return signedOut.map(h => ({
    kind: 'login', harness: h.id, name: h.label, command: `supercode harness login ${h.id}`,
  }));
  // Offer one concrete install, only when the registry reports Codex and no agent is installed.
  const codex = harnesses.find(h => h.id === 'codex');
  // Supercode itself is necessarily installed to report this inventory; it is
  // the bridge, not an installed subscription agent for this first-run offer.
  return codex && !codex.installed && !harnesses.some(h => h.installed && h.id !== 'supercode' && h.capabilities.startSession) ? [{
    kind: 'install', harness: codex.id, name: codex.label, command: 'npm install -g @openai/codex',
  }] : [];
}

/** Optional project-owned data; no defaults or purpose text belong in the kit. */
export function chatStarterPrompts(projectRoot: string): string[] {
  let value: unknown;
  try { value = JSON.parse(readFileSync(join(projectRoot, 'volter.chat.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`volter.chat.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'starterPrompts')) throw new Error('volter.chat.json: expected { starterPrompts: string[] }.');
  const prompts = (value as { starterPrompts?: unknown }).starterPrompts;
  if (!Array.isArray(prompts) || prompts.some(prompt => typeof prompt !== 'string' ||
      !prompt.trim() || prompt.length > 2000 || /[\x00-\x1f]/.test(prompt))) {
    throw new Error('volter.chat.json: starterPrompts must contain nonempty single-line strings (up to 2000 characters).');
  }
  return prompts.slice(0, 3);
}
