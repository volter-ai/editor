/** Drive the same native Chat the person sees, through the editor's command door. */
import { connect } from '@volter/editor-live';

export const CHAT_USAGE = 'chat status | chat send <prompt> | chat stop';

interface ChatState {
  activeSession?: string;
  busy?: boolean;
  setupHandoff?: { complete?: boolean };
  connections?: Array<{ id: string; sessionId?: string; pendingRequests?: unknown[] }>;
}

export async function chat(args: string[]): Promise<unknown> {
  const [action, prompt] = args;
  if (!['status', 'send', 'stop'].includes(action ?? '') || args.length !== (action === 'send' ? 2 : 1) ||
      (action === 'send' && !prompt?.trim())) throw new Error(`Usage: volter-model-editor ${CHAT_USAGE}`);
  const { editor } = await connect();
  const state = await editor.command('supercode.frontend.status', true) as ChatState;
  const view = await editor.command('volter.chat.inspect') as { sessionResource?: string };
  if (action === 'status') return { ...state, focusedSessionResource: view.sessionResource };
  const resource = view.sessionResource ? new URL(view.sessionResource) : null;
  if (resource && resource.protocol !== 'supercode:') throw new Error('The focused Chat is not a Volter Harness conversation. Choose an agent in Volter Harness Chat before sending.');
  const draft = resource?.pathname.startsWith('/untitled-');
  const connection = state.connections?.find(c => c.id === (resource?.hostname || state.activeSession));
  // The setup handoff describes the initial reveal, and can remain stale after
  // switching agents. A connected, focused native conversation is ready itself.
  if ((!connection && !draft) || (!connection && state.setupHandoff?.complete !== true)) {
    throw new Error('Chat is not ready. Open Chat in the editor and choose an agent or complete its sign-in, then run chat status.');
  }
  if (action === 'send' && (state.busy || connection?.pendingRequests?.length)) {
    throw new Error('Chat has an active turn or a pending request. Finish it in the editor or use chat stop before sending another prompt.');
  }
  // Keep a visible New Chat draft and its selected agent/model. Revealing the
  // host's previous active conversation here would discard that choice.
  if (!resource && connection) await editor.command('volter.chat.openSession', `supercode://${connection.id}/conversation`);
  if (action === 'stop') {
    await editor.command('workbench.action.chat.cancel');
    return { stopRequested: true, sessionId: connection?.sessionId };
  }
  await editor.command('workbench.action.chat.open', { query: prompt, isPartialQuery: false, preserveInput: true });
  // The native command does not await acceptInput. Its return cannot confirm a turn:
  // acceptInput can refuse a read-only composer or pending model selection.
  return { submissionRequested: true, submissionConfirmed: false };
}
