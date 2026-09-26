import {
  registerAvailableWorkspaceDocument,
  unregisterAvailableWorkspaceDocument,
} from '@volter/editor-sdk/kit/workspace-available-documents';
/**
 * Edit-time center documents for a project, beside the native Three.js scene
 * document. Runtime composition belongs to the Game document (which exists
 * only while a runtime does); authoring pins the project-level component
 * boards — one per registered medium, each installed and closed here on its
 * own package's verdict (`component-board-registry.ts`). This module names no
 * board and no medium.
 *
 * THE SCENE VIEWPORT IS FOR THE SCENE (owner, 2026-08-10). Every edit-time
 * subject presents through a document of its own; nothing composites over the
 * viewport while editing.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { authoringAdapterKey } from '../authoring/adapter-key';
import type { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import {
  type DesignTimeRootDescriptor,
  designTimeRootDescriptors,
  mountDesignTimeLayers,
} from '@volter/editor-sdk/kit/authoring/design-time-layers';
import { INVALID_MANIFEST_SURFACE } from '@volter/editor-sdk/kit/authoring/edit-mode-authoring';
import {
  getMountFailureReports,
  subscribeToMountFailures,
} from '@volter/editor-sdk/kit/mount-failure-report';
import {
  installCanvasSceneNavigation,
  installReactCanvasNavigation,
} from '@volter/editor-sdk/kit/authoring/react-canvas-navigation';
import {
  REACT_DESIGN_CANVAS_COLOR,
  REACT_DESIGN_CANVAS_DOT,
} from '@volter/editor-sdk/kit/authoring/react-design-canvas-style';
import { resolveViewportToolContext } from '@volter/editor-sdk/kit/authoring/viewport-tool-context';
import {
  createRootViewController,
  getRootPan,
  sharedRootViewController,
  subscribeRootPan,
} from '@volter/editor-sdk/kit/world-pan-state';
import {
  type ComponentBoard,
  componentBoardForDocument,
  componentBoardForMedium,
  componentBoards,
  subscribeComponentBoards,
} from '@volter/editor-sdk/kit/component-board-registry';
import { setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { readinessFacet, subscribeRootReadiness } from '@volter/editor-sdk/kit/readiness';
import { explainSurface } from '@volter/editor-sdk/kit/surface-state';
import { recordViewportFirstFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import {
  CANVAS_SCENE_DOCUMENT_ID,
  GAME_DOCUMENT_ID,
  SCENE_DOCUMENT_ID,
} from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocumentId,
  closeWorkspaceDocument,
  openWorkspaceDocuments,
  registerWorkspaceDocumentSelection,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  registerRootDocumentGap,
  registerRootDocumentRoute,
  registerWorkspaceDocumentGap,
} from '../world-document-routing';
import { BoardRulers } from './BoardRulers';
import {
  CANVAS_SCENE_BACKGROUND,
  CanvasSceneBackdrop,
  CanvasSceneControls,
} from '@volter/editor-sdk/kit/components/CanvasSceneViewport';
import { ReactCanvasControls } from './ReactCanvasControls';
import { RootSelectionOverlay } from '@volter/editor-sdk/kit/components/RootSelectionOverlay';
import { SurfaceStateOverlay } from '@volter/editor-sdk/kit/components/SurfaceStateOverlay';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

/** The canvas root's world document reads `Scene`, exactly like a three
 *  project's — THE SCENE VIEWPORT IS FOR THE SCENE, and a 2D world is a scene
 *  (owner, 2026-08-15: "why don't we have a 'scene'? it's a 2d scene of
 *  course"). A project has one medium's scene or the other, never both. */
const CANVAS_SCENE_TITLE = 'Scene';

export function RootDocumentContent({
  active,
  composite,
  descriptor,
  documentId,
  store,
}: WorkspaceDocumentContentProps & {
  composite: CompositeAuthoringAdapter;
  descriptor: DesignTimeRootDescriptor;
  store: ShellStore;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const disposeMountRef = useRef<(() => void) | null>(null);
  const [canvasSceneView] = useState(createRootViewController);
  const isCanvasScene = descriptor.kind === 'canvas';
  const documentView = isCanvasScene ? canvasSceneView : sharedRootViewController;
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rootReadiness = useSyncExternalStore(subscribeRootReadiness, readinessFacet);
  const mountFailures = useSyncExternalStore(subscribeToMountFailures, getMountFailureReports);
  // The layer's own adapter, for a board that has no composite child to carry
  // it — either a rootless board, or Dev (whose runtime root is deliberately
  // not an authoring child). A board's presence is its package's verdict, not
  // a fact about roots. The composite child stays the authority whenever
  // there IS one.
  const [mountedAdapter, setMountedAdapter] = useState<AuthoringAdapter | null>(null);
  const documentAdapter =
    composite.childAdapters().find((child) => child.worldId === descriptor.worldId)?.adapter ??
    mountedAdapter ??
    undefined;
  const isBabylonScene = isCanvasScene && documentAdapter?.provenance?.label === 'babylon';
  const nativeRoots = documentAdapter?.hierarchy.roots() ?? [];
  const emptyRootIds = new Set(
    documentAdapter?.rects?.emptyContainers?.().map((entry) => entry.id) ?? [],
  );
  const hasRenderableContent = nativeRoots.some((root) => !emptyRootIds.has(root.id));
  const rootExplanation = explainSurface({
    surface: isCanvasScene ? 'Scene' : descriptor.kind === 'dom' ? 'UI' : 'World',
    rootIds: [descriptor.worldId],
    // While the game PLAYS, this document's design mount is deliberately
    // suspended — the wait is not progress and says so (surface-state.ts).
    playSuspended:
      store.playState !== 'stopped' &&
      (!documentAdapter || documentAdapter.provenance?.source === 'boundary'),
    phase:
      !documentAdapter || documentAdapter.provenance?.source === 'boundary' ? 'loading' : 'ready',
    content:
      !documentAdapter || documentAdapter.provenance?.source === 'boundary'
        ? 'unknown'
        : hasRenderableContent
          ? 'present'
          : 'empty',
    readiness: rootReadiness,
    failures: mountFailures,
  });

  // A world document owns the shared Hierarchy/Inspector context while it is
  // the visible center subject. Publish only this document's child: the Game
  // document is the composition-wide surface, while an authored root document
  // must not leak sibling roots into its panels. The node id is read live from
  // the same selection provider the canvas updates.
  useEffect(() => {
    if (!documentAdapter) return;
    return registerWorkspaceDocumentSelection(documentId, () => ({
      adapter: documentAdapter,
      nodeId: [...store.selectedEntityIds].find((id) => documentAdapter.hierarchy.node(id)) ?? null,
    }));
  }, [composite, documentAdapter, documentId, store]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (isBabylonScene) return;
    return isCanvasScene
      ? installCanvasSceneNavigation(container, documentView)
      : installReactCanvasNavigation(container, documentView);
  }, [documentView, isBabylonScene, isCanvasScene]);

  // An open document stays mounted. Defer the relatively expensive Pixi/React
  // mount until the world is first visited, then retain it across tab changes
  // so hierarchy identity, story selection, and source editing remain stable.
  useEffect(() => {
    if (!active) return;
    const alreadyMounted = Boolean(disposeMountRef.current);
    if (!alreadyMounted && containerRef.current) {
      disposeMountRef.current = mountDesignTimeLayers(
        containerRef.current,
        composite,
        store,
        [descriptor],
        (_worldId, adapter) => setMountedAdapter(adapter),
        isCanvasScene ? { canvasSceneView } : undefined,
        documentId,
      );
      return;
    }
    // Switch-back of a retained board: the next two frames are the first
    // painted frames after the tab is in front. No remount, no WebGL.
    let frames = 0;
    let raf = 0;
    const paint = (): void => {
      frames += 1;
      if (frames < 2) {
        raf = requestAnimationFrame(paint);
        return;
      }
      recordViewportFirstFrame(documentId);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [active, canvasSceneView, composite, descriptor, documentId, isCanvasScene, store]);

  // A MOUNTED LAYER'S STALENESS IS ITS MEDIUM'S STATEMENT, NOT THIS
  // COMPONENT'S. This effect used to remount the whole stack whenever the
  // project's story MEMBERSHIP changed (a story saved from the editor's own
  // header, a hand-edited `.stories.tsx`), so a new frame appeared without an
  // F5 — blind-walk beat 9. It was a rule about one medium spelled in a
  // component that mounts two: a canvas world's `<Application>` was torn down
  // and rebuilt every time an unrelated dom story was saved. It lives with
  // the dom mount now, as `DesignTimeMount.reprojectWhen`
  // (`@vgai/dom`'s `reprojectWhenStoriesRepublish`), which the stack binds per
  // medium and applies only to that medium's candidates
  // (`design-time-layers.ts:717-742`) — and which re-projects rather than
  // remounting, so the board no longer blinks through empty on the way.

  useEffect(
    () => () => {
      disposeMountRef.current?.();
      disposeMountRef.current = null;
    },
    [],
  );

  const selectedContext = resolveViewportToolContext(
    getActiveAuthoring(store),
    store.selectedEntityIds,
  );
  const context =
    selectedContext?.worldId === descriptor.worldId
      ? selectedContext
      : documentAdapter?.rects
        ? { worldId: descriptor.worldId, kind: 'dom' as const, adapter: documentAdapter }
        : null;
  return (
    <div
      ref={containerRef}
      data-testid={`world-document:${descriptor.worldId}`}
      data-vgai-backdrop-color={
        active
          ? isBabylonScene
            ? '#111827'
            : isCanvasScene
              ? CANVAS_SCENE_BACKGROUND
              : REACT_DESIGN_CANVAS_COLOR
          : undefined
      }
      data-vgai-backdrop-policy={active ? 'dark-frost' : undefined}
      onPointerDown={() => setActiveScope('viewport')}
      style={{
        // DOM component documents are Storybook/Figma-style boards. A Canvas
        // root is instead a native 2D Scene with its own editor camera; both
        // remain independent center documents rather than runtime layers.
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        backgroundColor: isBabylonScene
          ? '#111827'
          : isCanvasScene
            ? CANVAS_SCENE_BACKGROUND
            : REACT_DESIGN_CANVAS_COLOR,
        touchAction: 'none',
      }}
    >
      {isBabylonScene ? null : isCanvasScene ? (
        <CanvasSceneBackdrop view={canvasSceneView} documentId={documentId} />
      ) : (
        <ReactDesignCanvasBackdrop />
      )}
      <RootSelectionOverlay
        key={`selection:${authoringAdapterKey(documentAdapter)}`}
        {...(documentAdapter ? { adapter: documentAdapter } : {})}
        {...(isCanvasScene && !isBabylonScene
          ? { view: canvasSceneView, transformModeAware: true }
          : {})}
      />
      <SurfaceStateOverlay
        explanation={rootExplanation}
        testId={`world-surface-status:${descriptor.worldId}`}
        style={{ zIndex: 20 }}
      />
      {isBabylonScene ? null : isCanvasScene ? (
        <CanvasSceneControls
          key={`controls:${authoringAdapterKey(documentAdapter)}`}
          active={active}
          {...(documentAdapter ? { adapter: documentAdapter } : {})}
          containerRef={containerRef}
          view={canvasSceneView}
          documentId={documentId}
        />
      ) : (
        <>
          <BoardRulers docId={descriptor.worldId} containerRef={containerRef} />
          <ReactCanvasControls containerRef={containerRef} context={context} />
        </>
      )}
    </div>
  );
}

/** Infinite editor canvas behind React story frames. The dot origin follows
 * the same world transform, making pan/zoom legible without implying that the
 * runtime React layer owns any background at all. */
function ReactDesignCanvasBackdrop() {
  const view = useSyncExternalStore(subscribeRootPan, getRootPan);
  const spacing = Math.max(8, 24 * view.zoom);
  const dotRadius = Math.max(0.7, Math.min(1.4, view.zoom));
  return (
    <div
      data-testid="react-design-canvas-backdrop"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundColor: REACT_DESIGN_CANVAS_COLOR,
        backgroundImage: `radial-gradient(circle, ${REACT_DESIGN_CANVAS_DOT} ${dotRadius}px, transparent ${dotRadius}px)`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${spacing}px ${spacing}px`,
      }}
    />
  );
}

/** Install the project's pinned center documents and map the three root to the
 * native scene document. Returns the project/rebuild disposer; it closes only
 * the documents installed by this call.
 *
 * ## A BOARD'S EXISTENCE IS ITS OWN PACKAGE'S VERDICT
 *
 * No board is decided here. A package registers one
 * (`component-board-registry.ts`) and answers `presence()` for it; this
 * installs and closes the registered set as those verdicts move, and asks the
 * board itself why it is absent. Three statements used to be made here that
 * are not the host's to make — that a project's boards are `dom`/`three`/
 * `canvas`, that a board exists because the project has stories of that
 * medium, and that "no board yet" is told from "no board ever" by a story
 * DISCOVERY flag. The first is the registered set; the second is
 * `presence()`; the third is `presence()` returning `null`.
 *
 * Everything else here is still root-derived where it is genuinely about a
 * root: the `Scene` document and the document routes. A root whose own
 * design surface IS a board — no separate document of its own — is routed at
 * that board by matching the root descriptor's `kind` against the registered
 * `medium`; the host compares two values it was handed and spells neither. */
export function installRootDocuments(
  store: ShellStore,
  composite: CompositeAuthoringAdapter,
): () => void {
  const previouslyActive = activeWorkspaceDocumentId();
  const hasThreeRoot = composite
    .childAdapters()
    .some((child) => child.role === 'world' && child.kind === 'three');
  // An UNPARSEABLE manifest installs one placeholder root and no three world.
  // Closing the Scene document on it unmounted `the world root's stage` — the edit-mode
  // rebuild OWNER — so the editor sat gutted ("No authoring adapter", no
  // tabs, no canvas) and the manifest becoming valid again could remount
  // nothing: measured 60 s after the fix, still gutted, only a second Play or
  // a reload recovered (Opus verification, 2026-09-01). The project still
  // declares a three root; its scene document stays, and the rebuild the
  // recovery queues has an owner to drain into.
  const manifestInvalid = composite
    .childAdapters()
    .some((child) => child.kind === INVALID_MANIFEST_SURFACE);
  if (!hasThreeRoot && !manifestInvalid) {
    closeWorkspaceDocument(SCENE_DOCUMENT_ID, { discardDirty: true });
  }
  const installedIds = new Set<string>();
  const unregisterRoutes: Array<() => void> = [];
  let disposed = false;

  for (const child of composite.childAdapters()) {
    if (child.role === 'world' && child.kind === 'three') {
      unregisterRoutes.push(registerRootDocumentRoute(child.worldId, SCENE_DOCUMENT_ID));
    }
  }

  const designTimeRoots = designTimeRootDescriptors(composite);

  // THE CANVAS ROOT'S SCENE. A three project's scene is `the world root's stage`
  // (`SCENE_DOCUMENT_ID`, owned by `syncCenterDocuments`); a canvas project's
  // scene is this document, and a project has one or the other. Unlike the
  // boards, it is ROOT-derived and not story-derived: it is a document OF that
  // root's world, not a gallery of components.
  const canvasRoot = designTimeRoots.find((root) => root.kind === 'canvas');
  if (canvasRoot) {
    unregisterRoutes.push(registerRootDocumentRoute(canvasRoot.worldId, CANVAS_SCENE_DOCUMENT_ID));
  }

  // A ROOT WHOSE DESIGN SURFACE IS A BOARD. A dom root has no document of its
  // own: its surface is the project's UI board, so `activateRootDocument(id)`
  // must reach that board and say why when it cannot. The pairing is the
  // descriptor's `kind` against a registered `medium` — the host matches two
  // values it was handed and names neither — and a root already routed at a
  // Scene above keeps that route, because a world root's own document always
  // wins over a gallery of its components.
  //
  // It is reconciled rather than registered once, for the reason every one of
  // these registries has: the contribution pass that loads the packages is
  // deferred behind the first viewport frame, so at project open NOTHING is
  // registered yet.
  const routedRoots = new Set(
    [
      ...composite
        .childAdapters()
        .filter((child) => child.role === 'world' && child.kind === 'three'),
      ...(canvasRoot ? [canvasRoot] : []),
    ].map((root) => root.worldId),
  );
  const boardRoutes = new Map<string, () => void>();
  function reconcileBoardRoutes(): void {
    for (const root of designTimeRoots) {
      if (routedRoots.has(root.worldId) || boardRoutes.has(root.worldId)) continue;
      const board = componentBoardForMedium(root.kind);
      if (!board) continue;
      const stopRoute = registerRootDocumentRoute(root.worldId, board.documentId);
      // ...and the honest answer for the case that route CANNOT reach. A board
      // exists only on its own package's verdict, so a root can route at a
      // document that will never open in THIS project. Without this the ask
      // waits out the whole registration window and then reports the generic
      // "world document is not registered", which reads as a missing ROOT —
      // the root is right there in the manifest, and the thing that is missing
      // is its board. Live thunk, and `presence() === null` is what keeps it
      // silent during boot: no verdict is never a No.
      const stopGap = registerRootDocumentGap(root.worldId, () =>
        board.presence() === 'absent'
          ? `Root "${root.worldId}" has no document of its own: its design surface is the ` +
            `project's ${board.title} board (${board.documentId}). ${board.absentReason()}`
          : null,
      );
      boardRoutes.set(root.worldId, () => {
        stopGap();
        stopRoute();
      });
    }
  }

  // THE SAME GAP, asked the other way. `openWorkspaceView` names a DOCUMENT
  // rather than a root, and `activateWorkspaceDocument`'s `false` carries the
  // identical ambiguity plus one a root cannot have: the id may name nothing at
  // all. Both were paid for with the full 10 s registration window and then a
  // generic "not available" — long after the asking side gave up (MEASURED on
  // this project: a bogus id timed out the relay at 5.6 s and left a
  // `play-stall` error behind). This owner installs the project's workspace
  // documents, so it is the one that can say why a document is absent — and
  // for a BOARD it asks the board, which is the only party that knows.
  unregisterRoutes.push(
    registerWorkspaceDocumentGap((documentId) => {
      const open = openWorkspaceDocuments();
      if (open.some((document) => document.descriptor.id === documentId)) return null;
      const board = componentBoardForDocument(documentId);
      if (board) return board.presence() === 'absent' ? board.absentReason() : null;
      return (
        `No workspace document is named "${documentId}". Open in this session: ` +
        `${open.map((document) => document.descriptor.id).join(', ') || '(none)'}. A component ` +
        'board is present only when the package that owns its medium says this project has one, ' +
        'so a board id can be absent for this project and present for another.'
      );
    }),
  );

  function openCanvasScene(descriptor: DesignTimeRootDescriptor): void {
    const Content = (props: WorkspaceDocumentContentProps) => (
      <RootDocumentContent {...props} composite={composite} descriptor={descriptor} store={store} />
    );
    registerAvailableWorkspaceDocument(
      {
        id: CANVAS_SCENE_DOCUMENT_ID,
        title: CANVAS_SCENE_TITLE,
        kind: 'world',
        workspaceRole: 'authored-subject',
        provenance: {
          rootId: descriptor.worldId,
          ...(descriptor.path ? { sourcePath: descriptor.path } : {}),
        },
        Content,
        presentation: () => ({ kind: 'world', id: descriptor.worldId }),
      },
      { category: 'scene', default: !hasThreeRoot, rootId: descriptor.worldId },
    );
  }

  /** Reserve the id BEFORE installing, so a second reconcile arriving while an
   *  asynchronous install is in flight does not start a second one; un-reserve
   *  if it fails, so the next verdict retries. Saying WHAT failed is the
   *  board's own job — only it knows what it was loading. */
  function installBoard(board: ComponentBoard): void {
    installedIds.add(board.documentId);
    const unreserve = (): void => {
      installedIds.delete(board.documentId);
    };
    try {
      void Promise.resolve(board.install({ store, composite })).catch(unreserve);
    } catch {
      unreserve();
    }
  }

  /** Bring the registered component boards in line with their own verdicts.
   *  Idempotent: `openWorkspaceDocument` is a no-op for a document already
   *  open, and `closeWorkspaceDocument` for one that is not.
   *
   *  A board NEVER steals focus, which is why `install` is documented to open
   *  without activating: presence is answered ASYNCHRONOUSLY, so a board that
   *  arrives late would otherwise yank the author off whatever they were
   *  looking at (measured: the canvas root's `Scene` opened, then a board
   *  landed a second later and took the tab). The tail of this function still
   *  chooses the opening document. */
  function reconcileBoards(): void {
    if (disposed) return;
    reconcileBoardRoutes();
    for (const board of componentBoards()) {
      const wanted = board.presence();
      // `null` is "no verdict yet": neither install nor close. A census that
      // has not run must not take a board away, and a board that has never
      // been installed must not be conjured by silence.
      if (wanted === null) continue;
      const installed = installedIds.has(board.documentId);
      if ((wanted === 'present') === installed) continue;
      if (wanted === 'present') installBoard(board);
      else {
        unregisterAvailableWorkspaceDocument(board.documentId);
        installedIds.delete(board.documentId);
      }
    }
  }

  // The canvas Scene is installed once, from the manifest — it does not
  // participate in `reconcileBoards`' verdicts, because a world root's
  // existence is not a question a board's package answers.
  if (canvasRoot) {
    openCanvasScene(canvasRoot);
    installedIds.add(CANVAS_SCENE_DOCUMENT_ID);
  }

  reconcileBoards();
  const unsubscribePresence = subscribeComponentBoards(reconcileBoards);

  const firstInstalled = canvasRoot ? CANVAS_SCENE_DOCUMENT_ID : [...installedIds][0];
  if (
    !hasThreeRoot &&
    firstInstalled !== undefined &&
    (previouslyActive === null ||
      previouslyActive === SCENE_DOCUMENT_ID ||
      previouslyActive === GAME_DOCUMENT_ID)
  ) {
    activateWorkspaceDocument(firstInstalled);
  } else if (previouslyActive) {
    activateWorkspaceDocument(previouslyActive);
  } else if (hasThreeRoot) {
    activateWorkspaceDocument(SCENE_DOCUMENT_ID);
  }

  return () => {
    disposed = true;
    unsubscribePresence();
    for (const unregister of unregisterRoutes) unregister();
    for (const unregister of boardRoutes.values()) unregister();
    boardRoutes.clear();
    for (const id of installedIds) unregisterAvailableWorkspaceDocument(id);
  };
}
