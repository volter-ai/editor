/** Attach to an existing editor session; this package never launches one. */
import { EditorClient } from '@volter/editor-sdk/client';
import { LiveEditor } from './editor.js';
import { LiveTools } from './tools.js';
import { lazyChainProxy } from './lazy-proxy.js';
import { resolveSession, type ResolvedSession, type SessionResolutionDeps } from './session.js';
import { createLazySession } from './singleton.js';

export { LiveEditor, inferAssetKind, type PanelName } from './editor.js';
export { LiveEditorDocument } from './editor-document.js';
export type { DocumentGestureOptions, DocumentKeyOptions, DocumentPasteOptions } from './editor-document.js';
export { LiveTools } from './tools.js';
export { resolveSession, findProjectRootFrom } from './session.js';
export type { ResolvedSession, SessionResolutionDeps, SessionListingTransport, ProjectSessionHint } from './session.js';
export type { ActiveDocumentCapture, EditorView, PresentedEditorView } from '@volter/editor-sdk';

export interface LiveBindings {
  editor: LiveEditor;
  tools: LiveTools;
}
export interface LiveSession extends LiveBindings {
  session: ResolvedSession;
}
function bindTo(port: number): LiveBindings {
  const client = new EditorClient({ url: `http://127.0.0.1:${port}` });
  return { editor: new LiveEditor(client), tools: new LiveTools(client) };
}
/** Inspect the callable surface without connecting; calls fail on port zero. */
export function unconnectedBindings(): LiveBindings { return bindTo(0); }

/** Attach only to the session serving the requested project's canonical path. */
export async function connect(projectDir?: string, deps?: SessionResolutionDeps): Promise<LiveSession> {
  const session = await resolveSession(projectDir, deps);
  return { ...bindTo(session.port), session };
}
const lazySession = createLazySession(() => connect());
export const editor: LiveEditor = lazyChainProxy<LiveEditor>(() => lazySession.ensure().then(s => s.editor));
export const tools: LiveTools = lazyChainProxy<LiveTools>(() => lazySession.ensure().then(s => s.tools));
