import { type ReactNode, useEffect, useRef } from 'react';
import { SHELL_OBJECT3D_DOCUMENT_WRITE_POLICY } from './authoring/shell-object3d-document-write-policy';
import { SHELL_VIEWPORT_AUTHORING_POLICY } from './authoring/shell-viewport-policy';

import { connectCommandListener } from './command-listener';
import { registerContributedCommands } from './command-registry';
import { viewportCommands } from './viewport-commands';
import { registerThreeAssetViewers } from './components/asset-viewers/three-asset-viewers';
import { registerThreeInspectionMedia } from './inspection/compose';
import { registerModelThumbnails } from './model-thumbnail';
import { registerStoryMediaCaptures } from './stories/story-media-captures';
import { reportViewportStatus } from './viewport-status-facet';
import { registerThreeCanvasRender } from './three-canvas-render';
import { startSceneDocuments } from './components/scene-documents';
import { saveThumbnail } from './editor-api';
import { reportTabCensus } from './editor-presence';
import { EditorRuntimeProvider, type EditorStats } from './editor-runtime';
import type { EditorStatePersistence } from './editor-shell-store';
import { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { threeStateOf } from './three-state';
import { EditorSession } from './history/editor-session';
import { bootstrapProject } from './initial-project';
import { installObject3DDocumentWritePolicy } from './object3d-document-write-policy';
import { startProjectAdapterLoad } from './project-adapter';
import { startProjectDeclarationRefresh } from './project-declaration-refresh';
import { writeProjectLocalSection } from './project-local-state';
import { getCurrentProject } from './project-manager';
import { startProjectSessionReset } from './project-session-reset';
import { startProjectToolContributionDiscovery } from './project-tool-discovery';
import { startProjectToolCatalog } from './project-tools';
import { registerShellStoreForHost } from './shell-store-door';
import { startTabCensus } from './tab-census';
import { installViewportAuthoringPolicy } from './viewport-authoring-policy';

/**
 * The store's persistence collaborator, bound to the server SDK. ONE module
 * constant, not an object literal at the install site: `attachStatePersistence`
 * keeps the one-owner rule `attachHistory` keeps, so a fresh literal on every
 * render (a strict-mode double render, any re-render of the provider) was a
 * different owner and threw — measured 2026-09-02 as "EditorStore is already
 * attached to a state persistence" from `<EditorProvider>` on every editor boot.
 */
const SERVER_STATE_PERSISTENCE: EditorStatePersistence = hmrStableValue(
  'SERVER_STATE_PERSISTENCE',
  () => ({ save: (state) => writeProjectLocalSection('view', state), saveThumbnail }),
);

/**
 * The same object across a Fast Refresh of THIS module. The store lives in a
 * ref, which Fast Refresh preserves, but a module-scope constant is minted
 * again on every re-evaluation — so the second render after an HMR edit
 * handed the store a NEW persistence object and `attachStatePersistence`'s
 * one-owner rule threw (measured 2026-09-03, editing a sibling module in
 * this file's graph while the editor was open: every panel went dark). The
 * context itself already rides `import.meta.hot.data` for exactly this
 * reason (`createHmrStableReactContext`); the collaborator does the same.
 */
function hmrStableValue<T>(key: string, create: () => T): T {
  const data = import.meta.hot?.data as Record<string, T> | undefined;
  if (data?.[key]) return data[key] as T;
  const value = create();
  if (data) data[key] = value;
  return value;
}

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
  // The shell's answers to the gizmo viewport's questions — which adapter is
  // active, what is under the pointer, which root is world-hidden. Installed
  // HERE (boot, before any viewport mounts) rather than in `the world root's stage`,
  // because an Asset Lab document's own viewport can be the only one on
  // screen; see `viewport-authoring-policy.ts`. Idempotent for the same
  // policy object, so a strict-mode double render is a no-op.
  installViewportAuthoringPolicy(SHELL_VIEWPORT_AUTHORING_POLICY);
  // The shell's answers to the Asset Lab 3D document's writes — its own
  // persistence binding, whole-file source replacement, thumbnail framing.
  // Installed HERE for the same reason as the policy above: an Asset Lab
  // document can be the only surface on screen, and its writes must reach the
  // project the moment it mounts. See `object3d-document-write-policy.ts`.
  installObject3DDocumentWritePolicy(SHELL_OBJECT3D_DOCUMENT_WRITE_POLICY);
  // The shell binds the server SDK as the store's persistence; the store
  // itself imports no transport (ARCHITECTURE-CORE §Editor chrome).
  threeStateOf(storeRef.current).attachStatePersistence(SERVER_STATE_PERSISTENCE);

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
  // The Three viewport's relay verbs arrive as its own command contribution,
  // and its Asset Lab viewers by route.
  useEffect(() => registerContributedCommands('three-viewport', viewportCommands), []);
  useEffect(() => registerThreeAssetViewers(), []);
  useEffect(() => registerThreeInspectionMedia(), []);
  useEffect(() => registerModelThumbnails(), []);
  useEffect(() => registerStoryMediaCaptures(), []);
  useEffect(() => reportViewportStatus(), []);
  useEffect(() => registerThreeCanvasRender(), []);

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
