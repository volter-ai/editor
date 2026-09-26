/**
 * THE SCENE DOCUMENT (`workspace:scene`): the active Three scene, titled
 * `Scene` (the subject, not its entry file — see SCENE_DOCUMENT_TITLE),
 * closeable and discoverable in Content, content = the world root's stage.
 *
 * Transcribed from the Scene half of vgai's `components/CenterDocuments.tsx`.
 * The kit keeps the other half (`@volter/editor-core/components/CenterDocuments`
 * `useCenterDocuments`): it binds the Game document's tab, reports the
 * live/stopped edge and closes every document on session teardown. What moved
 * here is only what the kit no longer does — synthesize the Scene document
 * the kit still routes every three root's edit document to.
 *
 * THE INPUT-GATE CONTRACT (CLAUDE.md T6.3): `play-mode.ts` and the ingest
 * lanes gate game input on `playState === 'playing' && activeViewportTab ===
 * 'play'`. The tab is derived from workspace focus (the Game document is
 * active), so this module never writes it and never mirrors it back into
 * activation. */

import {
  activeDocumentSourcePath,
  activeSaveDestination,
  activeSaveState,
} from '@volter/editor-sdk/kit/authoring/shell-document-ops';
import { Object3DDocumentViewport } from '@volter/editor-threejs/kit/components/Object3DDocumentViewport';
import type { DocumentPreviewSource } from '@volter/editor-sdk/kit/document-preview-source';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore, ViewportTab } from '@volter/editor-threejs/kit/editor-shell-store';
import { projectAdapterFacet, subscribeProjectAdapter } from '@volter/editor-core/project-adapter';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import { isolationTabsReplaceGenericScene, sceneTabRow } from '@volter/editor-core/scene-document-plan';
import {
  registerAvailableWorkspaceDocument,
  unregisterAvailableWorkspaceDocument,
} from '@volter/editor-sdk/kit/workspace-available-documents';
import { SCENE_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocumentId,
  setWorkspaceDocumentDirty,
  type WorkspaceDocumentContentProps,
  type WorkspaceDocumentDescriptor,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { Button, themeVars } from '@volter/editor-sdk/widgets';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { scheduleAfterPaint } from '../after-paint';

/**
 * The scene document's tab title. It is the WORD `Scene`, not the entry file's
 * name: this document is the project's one three world, and a strip that reads
 * `Scene · 3D · UI` names four subjects the same way instead of leaking one
 * root's implementation file (`world.tsx`) into a rail of plain nouns. The
 * authored source path is still the document's `provenance.sourcePath`, and
 * the unsaved-changes dot is registry state (`dirty`) rather than title text,
 * so both survive a fixed title.
 */
export const SCENE_DOCUMENT_TITLE = 'Scene';

/** The narrow store surface this module reads/writes — kept minimal so the
 *  bridge reads against a plain fake (no full EditorStore). */
export interface CenterDocumentsStore {
  subscribe(listener: () => void): () => void;
  readonly playState: 'stopped' | 'playing' | 'paused';
  readonly activeViewportTab: ViewportTab;
  /** Where the ACTIVE authoring adapter's edits persist (its
   *  `PersistenceProvider.destination`), or null when it persists nothing. */
  readonly savePath: string | null;
  /** Project-relative source path for an immediate-write document whose
   *  adapter intentionally exposes no PersistenceProvider. */
  readonly sourcePath?: string | null;
  /** Whether the active authoring adapter has unsaved edits. */
  readonly isDirty: boolean;
}

/** The root Scene's preview stays available after its tab closes. Its source
 * identity is read lazily because the three authoring adapter arrives after
 * the workspace document is registered on a cold boot. */
function rootScenePreviewSource(store: CenterDocumentsStore): DocumentPreviewSource {
  const source = (): { path: string; exportName?: string } | null => {
    const table = projectAdapterFacet()?.scenes;
    const row = table
      ? sceneTabRow(table).find((item) => item.plan.kind === 'root-document')
      : undefined;
    const declared = row?.entry.source;
    const path = declared?.path ?? store.sourcePath ?? store.savePath;
    return path
      ? { path, ...(declared?.export === undefined ? {} : { exportName: declared.export }) }
      : null;
  };
  return {
    revision: () => {
      const current = source();
      return current ? `${current.path}:${current.exportName ?? 'default'}` : 'unavailable';
    },
    subscribe: (listener) => {
      let identity = JSON.stringify(source());
      const changed = () => {
        const next = JSON.stringify(source());
        if (next === identity) return;
        identity = next;
        listener();
      };
      const stopStore = store.subscribe(changed);
      const stopAdapter = subscribeProjectAdapter(changed);
      return () => {
        stopStore();
        stopAdapter();
      };
    },
    capture: async (request) => {
      const current = source();
      if (!current) throw new Error('The Scene has no declared source module to preview.');
      const owner = await import('./ThreeIsolationSceneContent');
      return owner.captureThreeIsolationScenePreview(
        {
          path: current.path,
          exportName: current.exportName,
          label: SCENE_DOCUMENT_TITLE,
        },
        request,
      );
    },
  };
}

interface ViewportErrorBoundaryState {
  error: Error | null;
  /** Whether an automatic retry is currently scheduled — tracked as state
   *  (not inferred from the timer field) so the "retrying…" copy is part of
   *  the same render pass `componentDidCatch` triggers when it schedules one. */
  autoRetryPending: boolean;
}

/** THREE's context-creation failure message for the transient
 *  Chromium/SwiftShader GPU-channel race that occasionally loses at editor
 *  boot — distinct from a genuinely dead/unsupported renderer, which fails
 *  differently. */
const TRANSIENT_RENDERER_STARTUP_FAILURE_PATTERN = /creating WebGL context/i;

/** The SAME transient class in its other spelling: the context was created but
 *  came back already dead, so THREE's capability probe reads `precision` off
 *  the `null` that `getShaderPrecisionFormat` returns on a lost context. Seen
 *  live while a project's thumbnail sweep was churning short-lived contexts —
 *  the same renderer boots fine on the retry, exactly like the class above. */
const TRANSIENT_DEAD_CONTEXT_PATTERN = /null \(reading 'precision'\)/;

/** True when `error` matches the transient renderer-startup failure class. */
export function isTransientRendererStartupFailure(error: Error): boolean {
  return (
    TRANSIENT_RENDERER_STARTUP_FAILURE_PATTERN.test(error.message) ||
    TRANSIENT_DEAD_CONTEXT_PATTERN.test(error.message)
  );
}

/** Bound on automatic retries per boundary instance — see `componentDidCatch`. */
const MAX_AUTO_RETRIES = 3;

/** A renderer failure must degrade the Scene document, not unmount the whole
 * workspace. The surrounding hierarchy, Inspector, Console, menus,
 * and project resources remain usable, with an explicit retry after the old
 * renderer/context has been torn down.
 *
 * A transient WebGL context-creation failure at boot would otherwise kill the
 * viewport permanently even though the SAME renderer boots fine moments
 * later. For that specific, recognizable failure class the boundary retries
 * automatically with backoff BEFORE surfacing the manual button — bounded to
 * 3 attempts per boundary instance so a genuinely dead renderer still ends up
 * in front of the user with the manual UI. */
export class ViewportErrorBoundary extends Component<
  { children: ReactNode },
  ViewportErrorBoundaryState
> {
  override state: ViewportErrorBoundaryState = { error: null, autoRetryPending: false };

  /** Automatic retries already used by THIS boundary instance — never reset
   *  by a manual retry click, so a manual click after the auto-budget is
   *  exhausted does not re-open the budget. */
  private autoRetryCount = 0;
  // `window.setTimeout` (DOM lib) returns `number`; typed explicitly rather
  // than via `ReturnType<typeof setTimeout>` because @types/node's ambient
  // overload would otherwise mis-widen this to `Timeout`.
  private retryTimer: number | null = null;

  static getDerivedStateFromError(error: Error): ViewportErrorBoundaryState {
    return { error, autoRetryPending: false };
  }

  private clearPendingRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    editorConsole.error(`Viewport failed to start: ${error.message}`, 'editor');
    // Keep the component stack in the browser console for developer diagnosis.
    // biome-ignore lint/suspicious/noConsole: renderer startup failures need their React component stack in developer tools as well as the user-facing editor Console entry
    console.error('[vgai] Viewport failed to start', error, info.componentStack);

    if (isTransientRendererStartupFailure(error) && this.autoRetryCount < MAX_AUTO_RETRIES) {
      this.clearPendingRetry();
      const delayMs = 500 * 2 ** this.autoRetryCount;
      this.autoRetryCount++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.setState({ error: null, autoRetryPending: false });
      }, delayMs);
      this.setState({ autoRetryPending: true });
    }
  }

  override componentWillUnmount(): void {
    this.clearPendingRetry();
  }

  private handleManualRetry = (): void => {
    // A manual click also cancels any pending auto-retry (the boundary must
    // not race a scheduled retry against the user's own), but deliberately
    // does NOT reset `autoRetryCount` — the auto-retry budget is per
    // boundary instance, not per error occurrence.
    this.clearPendingRetry();
    this.setState({ error: null, autoRetryPending: false });
  };

  override render() {
    if (!this.state.error) return this.props.children;
    const retryPending = this.state.autoRetryPending;
    return (
      <div
        data-testid="viewport-startup-error"
        role="alert"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 24,
          background: themeVars.surface.shell,
          color: themeVars.content.muted,
          textAlign: 'center',
        }}
      >
        <div style={{ color: themeVars.content.primary, fontSize: 14 }}>
          {retryPending ? 'Viewport unavailable — retrying…' : 'Viewport unavailable'}
        </div>
        <div style={{ maxWidth: 520, color: themeVars.content.dim, fontSize: 11 }}>
          {this.state.error.message}
        </div>
        <Button
          type="button"
          className="vgai-btn"
          data-testid="retry-viewport"
          onClick={this.handleManualRetry}
        >
          Retry Viewport
        </Button>
      </div>
    );
  }
}

/**
 * The Scene document's content: the kit's ONE 3D STAGE HOST, showing the
 * world root. It is a document like any other — same host, same furniture,
 * same overlays, same per-stage door — and the ONE thing it says that a
 * prefab's stage does not is WHAT it shows (`content`): the world, through
 * this package's world-root binding, loaded only when a Scene stage mounts.
 *
 * The after-paint gate owns the mount of everything below it — the viewport
 * door's binding included — so it may never be scheduled on a bare rAF chain.
 * A hidden tab fires no frames at all and the editor would boot to a
 * heartbeating shell that can never start play.
 */
const SCENE_CONTENT = {
  kind: 'world-root',
  load: () => import('./world-root-stage-binding').then((module) => module.worldRootStageBinding),
} as const;

function SceneDocumentContent({ documentId, active }: WorkspaceDocumentContentProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => scheduleAfterPaint(() => setReady(true)), []);
  return (
    <ViewportErrorBoundary>
      {ready ? (
        <Object3DDocumentViewport
          documentId={documentId}
          active={active}
          content={SCENE_CONTENT}
          displayName={SCENE_DOCUMENT_TITLE}
        />
      ) : null}
    </ViewportErrorBoundary>
  );
}

/** Build the Scene document descriptor bound to a store. `onActivate` is the
 *  registry→store half of the bridge: activating the tab (click, open,
 *  close-neighbor fallback) writes the store's `activeViewportTab`, which is
 *  what the T6.3 input gate reads. */
export function createCenterDocumentDescriptors(store: CenterDocumentsStore): {
  scene: WorkspaceDocumentDescriptor;
} {
  const documentPath = store.sourcePath ?? store.savePath;
  const scene: WorkspaceDocumentDescriptor = {
    id: SCENE_DOCUMENT_ID,
    title: SCENE_DOCUMENT_TITLE,
    kind: 'scene',
    workspaceRole: 'authored-subject',
    ...(documentPath ? { provenance: { sourcePath: documentPath } } : {}),
    Content: SceneDocumentContent,
    preview: rootScenePreviewSource(store),
    presentation: () =>
      store.savePath
        ? { kind: 'scene', path: store.savePath }
        : { kind: 'workspace', id: SCENE_DOCUMENT_ID },
  };
  return { scene };
}

/**
 * Keeps the Scene document in step with the session. Idempotent — safe (and
 * designed) to run on EVERY store notify. The Game document's live/stopped edge
 * is the kit's (`useCenterDocuments`), not repeated here.
 *
 *  1. the scene document is available when the manifest has a Three root;
 *  2. its tab's dirty dot tracks `isDirty` live (the title is fixed);
 *  3. with no document active at all (a first run), the scene document is.
 */
export function syncCenterDocuments(
  store: CenterDocumentsStore,
  docs: { scene: WorkspaceDocumentDescriptor },
  hasThreeRoot = true,
): void {
  const table = projectAdapterFacet()?.scenes;
  if (hasThreeRoot && !(table && isolationTabsReplaceGenericScene(table))) {
    const row = table
      ? sceneTabRow(table).find((item) => item.plan.kind === 'root-document')
      : undefined;
    registerAvailableWorkspaceDocument(
      {
        ...docs.scene,
        title: row?.plan.kind === 'root-document' ? row.plan.title : docs.scene.title,
        provenance: {
          ...docs.scene.provenance,
          ...(row?.entry.source?.path ? { sourcePath: row.entry.source.path } : {}),
          ...(row?.plan.kind === 'root-document' ? { rootId: row.plan.regionId } : {}),
        },
      },
      {
        category: 'scene',
        rootId: row?.plan.kind === 'root-document' ? row.plan.regionId : undefined,
        default: table !== undefined && (row?.isDefault ?? table.entries.length === 0),
      },
    );
    setWorkspaceDocumentDirty(SCENE_DOCUMENT_ID, store.isDirty);
  } else {
    unregisterAvailableWorkspaceDocument(SCENE_DOCUMENT_ID);
  }

  if (hasThreeRoot && activeWorkspaceDocumentId() === null) {
    activateWorkspaceDocument(SCENE_DOCUMENT_ID);
  }
}

/**
 * Installs the Scene document for one session store and keeps it synced. The
 * returned teardown stops syncing; the service withdraws the Scene document, and the kit's
 * `useCenterDocuments` closes every open document on session teardown.
 */
export function bindSceneDocument(store: EditorShellStore): () => void {
  // `savePath`/`isDirty` are the ACTIVE authoring adapter's, read live
  // through getters rather than copied — the shell owns neither.
  // Keep the authored source identity across Edit → Play: Play deliberately
  // swaps in a live adapter with no source document, but the Scene
  // tab still represents the same authored TSX document.
  let lastSourcePath: string | null = null;
  const view: CenterDocumentsStore = {
    subscribe: (listener) => store.shell.subscribe(listener),
    get playState() {
      return store.shell.playState;
    },
    get activeViewportTab() {
      return store.shell.activeViewportTab;
    },
    get savePath() {
      return activeSaveDestination(store.shell);
    },
    get sourcePath() {
      const current = activeDocumentSourcePath(store.shell);
      if (current) lastSourcePath = current;
      return lastSourcePath;
    },
    get isDirty() {
      return activeSaveState(store.shell) === 'unsaved';
    },
  };
  const docs = createCenterDocumentDescriptors(view);
  // Missing is the legacy-safe default: manifests read by current editor
  // versions always carry this derived flag.
  const run = () =>
    syncCenterDocuments(view, docs, getCurrentProject()?.config.hasThreeRoot !== false);
  run();
  const unsubscribe = store.shell.subscribe(run);
  const unsubscribeAdapter = subscribeProjectAdapter(run);
  // Unbinding follows the session's store and leaves the document registered:
  // a store arriving again at boot must not close a restored Scene tab. The
  // service withdraws the document when it stops.
  return () => {
    unsubscribe();
    unsubscribeAdapter();
  };
}
