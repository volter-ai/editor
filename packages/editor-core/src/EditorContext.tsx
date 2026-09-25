import { type ReactNode, useEffect, useRef } from 'react';
import { SHELL_OBJECT3D_DOCUMENT_WRITE_POLICY } from './authoring/shell-object3d-document-write-policy';

import { connectCommandListener } from './command-listener';
import { registerStoryMediaCaptures } from './stories/story-media-captures';
import { startSceneDocuments } from './components/scene-documents';
import { reportTabCensus } from '@volter/editor-sdk/kit/editor-presence';
import { EditorRuntimeProvider, type EditorStats } from '@volter/editor-sdk/kit/editor-runtime';
import { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { EditorSession } from '@volter/editor-sdk/kit/history/editor-session';
import { bootstrapProject } from './initial-project';
import { installObject3DDocumentWritePolicy } from '@volter/editor-sdk/kit/object3d-document-write-policy';
import { startProjectAdapterLoad } from './project-adapter';
import { startProjectDeclarationRefresh } from './project-declaration-refresh';
import { getCurrentProject } from './project-manager';
import { startProjectSessionReset } from './project-session-reset';
import { startProjectToolContributionDiscovery } from './project-tool-discovery';
import { startProjectToolCatalog } from './project-tools';
import { registerShellStoreForHost } from '@volter/editor-sdk/kit/shell-store-door';
import { startTabCensus } from '@volter/editor-sdk/kit/tab-census';

export function EditorProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ShellStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new ShellStore({ followsWorkspaceFocus: true });
    // The host door (`@volter/editor-sdk/host`, `session`) reads this store.
    registerShellStoreForHost(storeRef.current);
  }

  const sessionRef = useRef<EditorSession | null>(null);
  if (!sessionRef.current) {
    const project = getCurrentProject();
    sessionRef.current = new EditorSession(project?.rootPath ?? 'unknown-project');
  }
  storeRef.current.attachHistory(sessionRef.current.history);
  // The shell's answers to the Asset Lab 3D document's writes — its own
  // persistence binding, whole-file source replacement, thumbnail framing.
  // Installed HERE, during render, before any surface mounts: an Asset Lab
  // document can be the only surface on screen, and its writes must reach the
  // project the moment it mounts. See `object3d-document-write-policy.ts`.
  installObject3DDocumentWritePolicy(SHELL_OBJECT3D_DOCUMENT_WRITE_POLICY);

  const statsRef = useRef<EditorStats | null>(null);
  if (!statsRef.current) {
    statsRef.current = {
      fps: 0,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraTarget: { x: 0, y: 0, z: 0 },
    };
  }

  const initRef = useRef<Promise<void> | null>(null);
  if (!initRef.current) {
    // Detect the project AND run its script registry. Tracked by
    // `projectBootstrapSettled()`, which play-mode awaits — see that function's
    // doc comment for the defect this ordering exists to prevent.
    initRef.current = bootstrapProject();
  }

  useEffect(() => {
    return connectCommandListener(storeRef.current!, sessionRef.current!.historyCommands);
  }, []);
  useEffect(() => registerStoryMediaCaptures(), []);

  // Project-tool discovery is EDITOR-INIT lifecycle, not a side effect of any
  // one surface — it runs (and keeps re-running on project change / tool-file
  // add/unlink) whether or not a workspace is mounted.
  // The workspace host only consumes the discovered registrations.
  useEffect(() => startProjectToolContributionDiscovery(), []);
  useEffect(() => startProjectToolCatalog(), []);

  // The project's own adapter (`vgai.adapter.ts`, or the declared native
  // default when it has none) — a PROJECT capability, loaded at init and on
  // every project switch, exactly like the discoveries above.
  useEffect(() => startProjectAdapterLoad(), []);
  useEffect(() => startProjectDeclarationRefresh(), []);

  // The other half of that lifecycle: what must NOT survive a project switch.
  // `onProjectChange` re-derives against the new project; this ends the
  // PREVIOUS one's live sessions and measurement ledgers, which are module
  // state and do not go away with the layout remount. See
  // `project-session-reset.ts` for the list.
  useEffect(() => startProjectSessionReset(), []);

  // The scene table's EDIT client: every authorable scene the adapter declares
  // becomes a workspace document, the default open by default
  // (`components/scene-documents.tsx`). Bound beside the load above because it
  // consumes exactly what that publishes and nothing else.
  useEffect(() => startSceneDocuments(), []);

  // The tab's RESOURCE CENSUS (tab-census.ts) — a 0.2 Hz sample that rides the
  // heartbeat, so a browser-level renderer death has a cause line instead of a
  // bare 1006. Editor-init lifecycle for the same reason as the discoveries
  // above: it must run whether or not any panel that reads it is mounted.
  useEffect(() => startTabCensus({ report: reportTabCensus }), []);

  const sessionMounted = useRef(false);
  useEffect(() => {
    sessionMounted.current = true;
    const session = sessionRef.current!;
    return () => {
      sessionMounted.current = false;
      // Fast Refresh replays effects while preserving the store and session.
      // Dispose only if the provider remains unmounted after that replay.
      queueMicrotask(() => {
        if (!sessionMounted.current) session.dispose();
      });
    };
  }, []);

  return (
    <EditorRuntimeProvider
      runtime={{
        store: storeRef.current,
        stats: statsRef.current,
        initPromise: initRef.current!,
        session: sessionRef.current,
      }}
    >
      {children}
    </EditorRuntimeProvider>
  );
}
