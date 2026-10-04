/** Host data for Supercode's native Chat setup. Credentials stay with the harness. */
import { ChatStarterPromptsSchema } from '@volter/editor-project/adapter/adapter-module';
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

/** Read the loaded adapter's existing wire facet, never evaluate a second project module.
 * Undefined means the project adapter has not reported yet, not an empty declaration. */
export function chatStarterPrompts(adapter: unknown): string[] | undefined {
  if (!adapter || typeof adapter !== 'object') return undefined;
  const editor: unknown = Reflect.get(adapter, 'editor');
  const chat: unknown = editor && typeof editor === 'object' ? Reflect.get(editor, 'chat') : undefined;
  return ChatStarterPromptsSchema.parse(chat && typeof chat === 'object' ? Reflect.get(chat, 'starterPrompts') : []);
}
