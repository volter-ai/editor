import { optionalThreeStateOf, threeStateOf } from '../three-state';
import { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import type {
  ToolObject3DAuthoringProps,
  ToolObject3DDocumentAuthoring,
  ToolObject3DPreviewSource,
  ToolViewportDressing,
} from '@volter/editor-sdk/contributions';
import { invalidateStages, stageGeneration } from '@volter/editor-sdk/kit/stage-invalidation';
import type { StageTransportSnapshot } from '@volter/editor-sdk/host';
import { EditorIcon, editorIcons, IconButton, themeVars } from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { isInEditorOwnedSubtree } from '@volter/editor-threejs/viewport/editor-layers';
import { createStandardEnvironment } from '@volter/editor-threejs/viewport/environment';
import {
  acquireInspectorPreviewRenderer,
  type InspectorPreviewLease,
} from '@volter/editor-threejs/viewport/preview-renderer';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import {
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import { registerStageTransport, StageTransport } from '@volter/editor-sdk/kit/animation/stage-transport';
import { scanClipSubjects } from '../animation/three-clips-subject';
import { liveGestureActive, whenLiveGestureIdle } from '@volter/editor-sdk/kit/live-gesture-lock';
import {
  type Object3DDocumentPresentationState,
  Object3DDocumentSession,
} from '../authoring/object3d-document-session';
import {
  registerObject3DDocumentSession,
} from '../authoring/object3d-document-session-registry';
import { Object3DGestureController } from '@volter/editor-sdk/kit/authoring/object3d-gesture-controller';
import { SourceObject3DAuthoringAdapter } from '../authoring/source-object3d-authoring-adapter';
import { registerDesignTimeSurface } from '@volter/editor-sdk/kit/coverage/design-time-surfaces';
import { DocumentRendererSession } from '@volter/editor-sdk/kit/document-renderer-session';
import { useOptionalEditorStats, useOptionalEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import type { EditorShellStore } from '../editor-shell-store';
import { EditorViewport } from '../editor-viewport';
import {
  lookDeclaresViewportColors,
  nativeViewportLook,
  subscribeNativeSelectionTheme,
} from '@volter/editor-sdk/kit/native-selection-style';
import {
  type Object3DDocumentPersistenceSession,
  object3DDocumentWritePolicy,
} from '@volter/editor-sdk/kit/object3d-document-write-policy';
import { registerPerformanceSource } from '@volter/editor-sdk/kit/performance-sources';
import {
  assetSubjectApplies,
  documentStageContext,
  focusedStageStore,
  identityRowApplies,
  studioStageApplies,
} from '@volter/editor-sdk/kit/stage-context';
import { registerStageStore } from '@volter/editor-sdk/kit/stage-store-registry';
import { announceDocumentStage, registerDocumentViewport } from '@volter/editor-sdk/kit/document-viewports';
import { sceneDocumentViewport } from '../scene-document-viewport';
import { threeStageTransformChrome } from './stage-transform-chrome';
import { RetainedDocumentStates } from '@volter/editor-sdk/kit/retained-document-states';
import { perspectiveDistanceToFitBox } from '../three-viewport/camera-fit';
import {
  acquireInteractiveViewportRenderer,
  type InteractiveViewportRendererLease,
} from '../three-viewport/interactive-renderer';
import type { ThreeViewportProjection } from '@volter/editor-sdk/kit/three-viewport-presentation';
import {
  activeViewportBreakdownDocumentId,
  markViewportConstructReady,
  markViewportConstructStarted,
  markViewportFirstRenderStart,
  markViewportRafResume,
  markViewportReactActive,
  markViewportSegment,
  recordViewportFirstFrame,
} from '@volter/editor-sdk/kit/viewport-activation-timings';
import { bindViewportRig, runViewportFrame } from '../../viewport-door';
import {
  notifyWorkspaceDocumentSelectionChanged,
  openWorkspaceDocuments,
  registerWorkspaceDocumentSelection,
  subscribeWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { AssetEditorShell } from '@volter/editor-sdk/kit/components/AssetEditorShell';
import { StageOverlays } from './StageOverlays';
import type { WorldRootStageBinding } from './world-root-binding';
import { TransportStrip } from '@volter/editor-sdk/kit/transport-strip';

// The stage's own keyboard actions, behind the same lazy boundary as the
// overlays and for the same reason — a bounded host pays for neither
// (`stage-keyboard.tsx`).
const LazyStageKeyboard = lazy(async () => {
  const module = await import('./stage-keyboard');
  return { default: module.StageKeyboardBinding };
});

import {
  applyStandardViewportDressing,
  createGradientBackgroundTexture,
  type StandardViewportDressing,
  watchPaletteBackdrop,
} from './standard-viewport-dressing';
import { ViewportFurniture } from './ViewportFurniture';
import { OBJECT3D_SURFACE_BUILDING, ViewportSurfaceStatus } from '@volter/editor-sdk/kit/viewport-surface-status';
import { workspaceHistoryService } from '@volter/editor-sdk/kit/components/workspace-history';
import {
  bindViewPresentation,
  DOCUMENT_STUDIO_PRESET,
  reportViewDraw,
  setViewPresentation,
  stageLightsPerMode,
  startingPresentation,
  subscribeViewportPresentation,
  viewPresentation,
  viewPresentationSnapshot,
  type ViewportDrawMode,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { subscribeEnvironmentImages } from '@volter/editor-sdk/kit/environment-images';
import { StagePresentationRig } from './standard-viewport-dressing';
import { threeStoreForHost } from '../three-state';
import { threeObject } from '../../adapter/three-contract';

/** The kind of stage a document's view is, for its starting presentation: the document's own
 *  kind, its id's prefix inside the workspace's `document:` wrapper
 *  (`document:model:src/models/cube.blend` is a `model` stage). */
const stageKindOf = (documentId: string): string => {
  const parts = documentId.split(':');
  return (parts[0] === 'document' ? parts[1] : parts[0]) ?? documentId;
};

/** WHERE THIS DOCUMENT'S BYTES GO — the one collaborator the shell installs
 *  (`object3d-document-write-policy.ts`). The tier's source recorder, the
 *  project file history and the thumbnail manifest all live behind it, so the
 *  Asset Lab 3D document carries no editor transport in its own closure
 *  (ARCHITECTURE-CORE §Editor chrome, "the viewport stack is separable").
 *  With no shell above it every member refuses by name, which is the same
 *  refusal a read-only tier already produced. */
const projectWrites = () => object3DDocumentWritePolicy();

/**
 * How far a BARE dock-panel stage bleeds past the box a person sees, so the
 * rendered image fills the panel edge to edge under its padding. THE ONE
 * PLACE this number lives: the stage box takes it negative, the DOM furniture
 * takes it back positive, and the canvas-drawn orientation gizmo takes it
 * through `EditorViewportOptions.chromeInsetPx` — three readers, one value.
 * A chromeless mount and the Asset Editor shell fill their own box exactly
 * and bleed nothing.
 */
const STAGE_BLEED_PX = 12;

function boxFromFrameBounds(
  bounds:
    | {
        readonly min: readonly [number, number, number];
        readonly max: readonly [number, number, number];
      }
    | undefined,
): THREE.Box3 | null {
  if (!bounds) return null;
  const box = new THREE.Box3(
    new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
  );
  return box.isEmpty() ? null : box;
}

/**
 * Per-document overrides of the standard viewport dressing
 * (`standard-viewport-dressing.ts`) — explicit opt-outs/opt-ins, never
 * re-implementations. Omitted means the standard look.
 *
 * THE SHAPE IS THE SDK'S (`ToolViewportDressing`), because a contributed
 * document is what asks for it: `@volter/editor-blender`'s Model document hands over
 * its view-locked studio through this door. One declaration, so the public
 * surface and the host cannot drift.
 */
export type StandardDressingProps = ToolViewportDressing;

/** What an editor-side source lane gets to build its authoring adapter over
 *  the document's own store and scene. */
export interface SourceDocumentAuthoringContext {
  readonly store: EditorShellStore;
  readonly scene: THREE.Scene;
  readonly hierarchyRoots?: readonly THREE.Object3D[];
}

export type SourceDocumentAuthoringFactory = (
  context: SourceDocumentAuthoringContext,
) => ToolObject3DDocumentAuthoring;

/** WHAT THE STAGE IS SHOWING. `build` is one Object3D the caller's `build()`
 * constructs, in isolation; its kind supplies authoring behavior and chrome,
 * and this host owns renderer lifetime, capture and disposal. `world-root` is
 * the project's world: the contributing package's binding mounts the
 * manifest's roots and presents the live roots Play adopts, and this host
 * gives it the same surface place, frame session, per-stage door and
 * overlays. A modeling host never loads a world binding. */
export type Object3DDocumentContent =
  | { readonly kind: 'build' }
  | { readonly kind: 'world-root'; load(): Promise<WorldRootStageBinding> };

/** Throttle for the world-root stage's clip rescan. A traverse per store
 *  notification would run on every selection change; 500 ms is fast enough
 *  that a streamed-in character becomes scrubbable while a person is still
 *  looking at it. */
const CLIP_RESCAN_INTERVAL_MS = 500;

/** Module-level so its identity is stable across renders, which
 *  `useSyncExternalStore` requires; the theme root is global, so no stage's
 *  own element narrows it. */
function subscribeThemeViewportGroup(onChange: () => void): () => void {
  return subscribeNativeSelectionTheme(null, onChange);
}

export interface Object3DDocumentViewportProps
  extends Omit<ToolObject3DAuthoringProps, 'build' | 'sourcePath'> {
  /** Required by `build` content (and by the SDK door, where both stay
   *  mandatory); a `world-root` stage constructs nothing of its own and has no
   *  single source file — its content is the manifest's roots. */
  readonly build?: ToolObject3DAuthoringProps['build'];
  readonly sourcePath?: string;
  /** See {@link Object3DDocumentContent}. Default `{ kind: 'build' }`. */
  readonly content?: Object3DDocumentContent;
  /** See `@volter/editor-sdk`'s `ToolObject3DAuthoringProps.audit`. */
  readonly audit?: boolean;
  /** Reuse the canonical Asset Lab viewport with NONE of the document chrome —
   *  no toolbar, no animation widget, no workspace-document registration —
   *  so it can fill a small box (the inspector's preview section). */
  readonly chromeless?: boolean;
  readonly modelSource?:
    | { readonly kind: 'project-file'; readonly path: string }
    | { readonly kind: 'entity'; readonly entityId: string };
  /** Asset Lab's native subject kind for this Object3D document. */
  readonly assetType?: string;
  /**
   * Editor-side authoring for a document whose write authority is project
   * SOURCE (a mounted R3F composition's stamped JSX, today). The caller that
   * knows the source lane supplies the adapter; this document constructs
   * none of them, so it stays mountable without any source lane in its
   * closure (ARCHITECTURE-CORE §Editor chrome, "the viewport stack is
   * separable"). Raw model/artifact documents omit this and remain honestly
   * read-only through the native source adapter. Consulted only when the
   * project `authoring` factory declined. MUST be referentially stable for
   * the document's lifetime, like `build`: it is an activation dependency.
   */
  readonly sourceAuthoring?: SourceDocumentAuthoringFactory;
  /**
   * Where this viewport's `WebGLRenderer` comes from.
   *
   * `own` (the default) constructs one for this mount — the right answer for a
   * document that lives as long as its panel does. `inspector-preview` draws
   * through the shared inspector-preview renderer
   * (`inspector-preview-renderer.ts`): that lane REMOUNTS PER SELECTION, and a
   * renderer construction there is ~1.9 s of frozen main thread plus a cold
   * shader cache and a fresh PMREM bake, every time you click something.
   */
  readonly rendererLane?: 'own' | 'inspector-preview';
  /**
   * Double-click on a picked node — the document's "open THIS" gesture,
   * reported with the node's own `Object3D` so the owner can resolve whatever
   * it means by it. Single click stays plain selection; a document that
   * declares no handler has no open gesture at all.
   *
   * Sole caller: the `3D` board, where an exhibit opens that
   * story's own turntable document (`three-board/ThreeBoardDocument.tsx`).
   */
  readonly onOpenNode?: (object: THREE.Object3D) => void;
  /**
   * When set, Frame with no selection and the view presets fit THIS box
   * instead of `contentWorldBounds(root)`. The 3D board passes the union of
   * each exhibit's presence as its true-scale overview.
   */
  readonly frameBounds?: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /** Optional first-paint frame distinct from the document's Frame fallback.
   * The 3D component board opens on one readable exhibit, while clearing the
   * selection and pressing Frame still restores its true-scale overview. */
  readonly openingFrameBounds?: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /** Multiplies the opening fit distance; `1` fills the view. */
  readonly openingFit?: number;
  /** The kind of stage this view is, for its starting presentation
   *  (`@volter/editor-sdk/kit/viewport-presentation`): the document's own kind (`'model'`).
   *  Without it the kind is read off the document id's prefix. */
  readonly stageKind?: string;
}

/**
 * Distinguishes the chromeless mounts of ONE document from each other and from
 * that document's viewport, so each publishes its own design-time surface
 * instead of overwriting a sibling's (see the registration below).
 */
/** The draw modes a view's presentation carries (`ViewportDrawMode`). */
const VIEW_DRAW_MODES: readonly ViewportDrawMode[] = [
  'solid',
  'preview',
  'rendered',
  'clay',
  'unlit',
  'wireframe',
  'matcap',
  'normals',
  'overdraw',
];

let chromelessSurfaceSequence = 0;

interface RetainedObject3DStageState {
  readonly documentId: string;
  readonly store: EditorShellStore;
  inUse: boolean;
  source: ToolObject3DPreviewSource | null;
  camera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } | null;
  presentation: Object3DDocumentPresentationState | null;
  transport: StageTransportSnapshot | null;
  contentSeconds: number;
  transportAdvances: number;
}

/**
 * Per-pane state outlives the React surface Code-OSS mounts for the active tab.
 * A second visible pane showing the same document claims a second state slot;
 * an inactive slot is reused only after its former pane has unmounted.
 */
const retainedObject3DStages = new RetainedDocumentStates<RetainedObject3DStageState>(
  documentId => ({
    documentId,
    store: threeStateOf(new ShellStore()),
    inUse: false,
    source: null,
    camera: null,
    presentation: null,
    transport: null,
    contentSeconds: 0,
    transportAdvances: 0,
  }),
  documentId => openWorkspaceDocuments().some(document => document.descriptor.id === documentId),
  subscribeWorkspaceDocuments,
);

/**
 * The element the viewport draws INTO — an EMPTY host div in both lanes.
 * React never owns the canvas. Both lanes mount a leased renderer canvas into
 * this host imperatively, then return it when the pane hides. A lost canvas is
 * destroyed rather than reused; a healthy one can safely serve the next pane.
 */
function ViewportSurface({
  canvasHostRef,
}: {
  readonly canvasHostRef: RefObject<HTMLDivElement | null>;
}) {
  return <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />;
}

/**
 * The viewport's drawing surface for one mount: either the shared
 * inspector-preview renderer or the interactive-document renderer pool. The
 * lane decides which exclusive lease to mount into `canvasHost`.
 */
function mountViewportSurface(
  canvasHost: HTMLDivElement,
  lane: 'own' | 'inspector-preview',
  displayName: string,
  initialSize: { readonly width: number; readonly height: number },
  onContextLost?: () => void,
): {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  lease: InspectorPreviewLease | InteractiveViewportRendererLease | null;
} {
  if (lane === 'inspector-preview') {
    const lease = acquireInspectorPreviewRenderer();
    lease.canvas.setAttribute('aria-label', `${displayName} authoring viewport`);
    canvasHost.appendChild(lease.canvas);
    return { canvas: lease.canvas, renderer: lease.renderer, lease };
  }
  const lease = acquireInteractiveViewportRenderer(
    initialSize.width,
    initialSize.height,
    onContextLost,
  );
  const { canvas, renderer } = lease;
  canvas.setAttribute('aria-label', `${displayName} authoring viewport`);
  canvasHost.appendChild(canvas);
  return { canvas, renderer, lease };
}

/** The drawing surface belongs to the document, not to a source revision.
 * Source lifetimes borrow it; closing waits for any asynchronous gesture
 * cleanup to return its borrow before releasing the context. */


interface DocumentContentBinding {
  readonly scene: THREE.Scene;
  settle(): Promise<void>;
  dispose(): Promise<void>;
}

/** Persistent editor state. Source revisions own only their content binding. */
class Object3DDocumentHost {
  readonly scene = new THREE.Scene();
  /** This document's store, optionally supplied by its owner. */
  readonly store: EditorShellStore;
  readonly cleanups: Array<() => void> = [];
  readonly rendererSession = new DocumentRendererSession(
    (time, resumed) => this.frame?.(time, resumed),
    () => {},
  );
  viewport: EditorViewport | null = null;
  session: Object3DDocumentSession | null = null;
  dressing: StandardViewportDressing | null = null;
  /** The stage's lighting, tone and exposure, from its view's presentation
   *  (`standard-viewport-dressing.ts`, `kit/viewport-presentation`). */
  presentationRig: StagePresentationRig | null = null;
  /** Re-apply the view's presentation (after the viewport and session exist). */
  applyPresentation: (() => void) | null = null;
  /** Whether the view's presentation replaced the stage's own backdrop at the last draw. */
  backdropOverridden = false;
  /** The document's own view-locked studio, under the stage's holder (`dressing.viewLocked`). */
  documentStudio: THREE.Group | null = null;
  /** The lights the content carries and what it holds, for the view's `auto` rule. */
  contentLights: readonly THREE.Light[] = [];
  contentHas: { readonly light: boolean; readonly 'directional-light': boolean } = {
    light: false,
    'directional-light': false,
  };
  private darkened: THREE.Light[] = [];
  /** Hide the content's own lights for the coming draw; the rendered scene's after-render hook
   *  shows them again. */
  darkenContentLights(): number {
    for (const light of this.contentLights) {
      if (!light.visible) continue;
      light.visible = false;
      this.darkened.push(light);
    }
    if (this.darkened.length === 0) return 0;
    const count = this.darkened.length;
    this.scene.onAfterRender = () => {
      for (const light of this.darkened) light.visible = true;
      this.darkened = [];
      this.scene.onAfterRender = () => {};
    };
    return count;
  }
  defaultEnvironment: THREE.Texture | null = null;
  defaultBackground: THREE.Color | THREE.Texture | null = null;
  adapter: AuthoringAdapter | null = null;
  content: DocumentContentBinding | null = null;
  frame: ((time: number, resumed: boolean) => void) | null = null;
  /** Mirrors the document scene's world dressing onto the rendered scene. The
   *  HOST owns it; the active session holds a reference and runs it before
   *  every draw (see {@link Object3DDocumentSession.setBeforeRender}). */
  syncHostScene: (() => void) | null = null;
  /** The other participants on THIS stage, once its module has loaded
   *  (`stage-presence-markers.ts`). Null on a chromeless mount and until then. */
  presence: { syncMarkers(dtSeconds: number): void; live(): boolean } | null = null;
  initialized = false;
  contentSeconds = 0;
  transportAdvances = 0;
  private users = 0;
  private closed = false;
  private released = false;

  /** Whether {@link close} has run — a late async install must not push a
   *  cleanup onto a host whose cleanups have already been drained. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** THIS STAGE's transport — the one holder of the content-time door below.
   *  Built from this stage's own store, because `driver` is that store's
   *  `playState` and nothing else (`animation/stage-transport.ts`). */
  readonly transport: StageTransport;

  constructor(
    readonly lane: 'own' | 'inspector-preview',
    readonly surface: ReturnType<typeof mountViewportSurface>,
    store?: EditorShellStore,
  ) {
    this.store = store ?? threeStateOf(new ShellStore());
    this.transport = new StageTransport(this.store.shell);
  }

  borrow(): () => void {
    this.users++;
    let returned = false;
    return () => {
      if (returned) return;
      returned = true;
      this.users--;
      this.releaseIfClosed();
    };
  }

  close(): void {
    this.closed = true;
    this.frame = null;
    this.syncHostScene = null;
    this.session?.setBeforeRender(null);
    this.session?.setPresentsFrames(false);
    this.rendererSession.setActive(false);
    void this.content?.dispose();
    // The one teardown path allowed to end the transport (its header states
    // the ownership): the document that owns this stage is unmounting.
    this.transport.dispose();
    this.releaseIfClosed();
  }

  private releaseIfClosed(): void {
    if (!this.closed || this.users !== 0 || this.released) return;
    this.released = true;
    const { lease, renderer, canvas } = this.surface;
    for (const cleanup of [
      ...this.cleanups.splice(0),
      () => this.session?.dispose(),
      () => this.viewport?.dispose(),
      () => this.rendererSession.dispose(),
      () => this.dressing?.dispose(),
      ...(lease
        ? [() => lease.release()]
        : [() => renderer.dispose(), () => renderer.forceContextLoss(), () => canvas.remove()]),
    ]) {
      try {
        cleanup();
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: all remaining resources must still be released
        console.error('Object3D document cleanup failed.', error);
      }
    }
  }
}

/**
 * Editor-owned authoring host for a project-supplied native Object3D factory.
 * Project code supplies only source construction; this component owns the
 * real EditorViewport, document-scoped AuthoringAdapter, selection, framing,
 * animation preview, resize, and teardown.
 *
 * ## TIME ON THIS SURFACE — the one policy, inherited by everything mounted here
 *
 * This host is the shared stack: Asset Lab documents, story turntables, 3D board
 * exhibits and the inspector's preview card all render through it. So the
 * Edit-static rule is enforced HERE, once, rather than at each of them:
 *
 *  - PRESENTATION time always advances — orbit damping, the view cube, the
 *    standard dressing, the editor's own helpers and overlays. It is
 *    editor-owned and it moves while the editor is in Edit.
 *  - CONTENT time does NOT. The source's own `update(dt)` and any clip a
 *    subject shows move only through the stage TRANSPORT, and only while a
 *    human is holding it (`animation/stage-transport.ts`, WORK.md §The stage
 *    transport and the animation door). A mounted
 *    document plays nothing on its own: that is the defect this closes (a GLB
 *    train animating in the Asset Lab while every instrument called the editor
 *    still, owner find 2026-08-15).
 *
 * Whatever content time this surface has reached is published as its content
 * clock (`coverage/design-time-surfaces.ts`), so the Edit-static vitals row
 * measures THIS surface by name instead of speaking only for the Scene view.
 */
export function Object3DDocumentViewport({
  documentId,
  sourcePath,
  build,
  displayName = 'Source Object3D',
  // No default: an omitted background means the STANDARD dressing's gradient;
  // a value is an explicit flat-color override (SDK contributions may pass it).
  background,
  cameraDirection,
  persistence,
  documentSource,
  authoring,
  interaction,
  selectionOutline = true,
  active = true,
  audit = true,
  chromeless = false,
  modelSource,
  assetType,
  sourceAuthoring,
  dressing,
  rendererLane = 'own',
  onOpenNode,
  frameBounds,
  openingFrameBounds,
  openingFit,
  openingView,
  cameraView,
  stageKind,
  statistics,
  subject,
  gridScale,
  content,
}: Object3DDocumentViewportProps) {
  const viewStageKind = stageKind ?? stageKindOf(documentId);
  // ANNOUNCE THE STAGE (`authoring/object3d-document-session-registry.ts`).
  // The lazy boundary announces for the documents that go through it; the
  // asset viewers import THIS component directly (`asset-viewers/
  // ModelAssetDocument.tsx:19` and its two siblings), so the announcement is
  // made here too. Announcing is counted, so the two overlap harmlessly.
  useEffect(() => {
    if (chromeless) return;
    return announceDocumentStage(documentId);
  }, [documentId, chromeless]);
  // The SHELL store, not this host's own: what a stage is showing is a fact
  // about the workspace's document, and `stage-context.ts` is where every
  // stage capability asks it (ARCHITECTURE-CORE §One stage). OPTIONAL because
  // this host is a bounded-host surface — `@volter/editor-blender`'s Model document
  // mounts it with no `EditorProvider` above it, and the throwing hook took
  // that document off the screen with "useEditorStore must be used within
  // <EditorProvider>" (measured live, 2026-09-18). No shell, no shell frame.
  const shellStore = optionalThreeStateOf(useOptionalEditorStore());
  /**
   * THE STORE THE STAGE CONTEXT IS ASKED AGAINST — the session's own, reached
   * without a React provider.
   *
   * `optionalThreeStateOf(useOptionalEditorStore())` above answers a NARROWER question than the
   * context needs: it is whether the shell's own React tree is above this
   * host, and for every package-contributed document it is not.
   * `@volter/editor-blender`'s Model document mounts this host through `ToolHost`, so the
   * context store is null there — and reading only it left `stageCtx` null,
   * which made EVERY condition in `stage-context.ts` unanswerable for that
   * document. That is a capability decided by where a document's React tree
   * happens to mount, which is the origin-deciding reading §One stage
   * retired. Without the context, the studio arm of `studioStageApplies`
   * could never fire for a model no matter what the look declared.
   *
   * `shellStoreForHost()` supplies the session store that
   * `focusedStageStore()` falls back to. It is deliberately NOT used for the
   * overlay set or the shell readout below: those are the SHELL's estate and
   * their condition is the shell's React presence, exactly as §One stage
   * unit 3 measured it — a stage that is not inside the shell has no shell
   * overlays. That gap is real and named, not closed here: unit 1's bar is
   * that the Model document's Blender frame does not move.
   */
  const contextStore = shellStore ?? threeStoreForHost();
  /**
   * WHAT THIS STAGE IS SHOWING, asked once (ARCHITECTURE-CORE §One stage).
   * `chrome` is the host's own answer and nothing infers it: an EMBEDDED
   * preview has no workspace document at all, which is exactly why the
   * subject would come back `unknown` for one.
   */
  const stageCtx = contextStore
    ? documentStageContext(contextStore.shell, documentId, chromeless ? 'embedded' : 'document')
    : null;
  /**
   * THE STUDIO PRESENTATION — the alpha clear, the suppressed palette
   * backdrop, the identity-row frame and the asset flavour of this stage's
   * provenance. It replaced a `documentKind` prop the CALLER chose, which is
   * exactly the origin-of-the-document reading §One stage retired: every
   * mount that passed `documentKind="asset"` is a story, an artifact or an
   * embedded preview, and each still answers true.
   */
  // The LOOK is one of `studioStageApplies`'s live inputs (a data subject takes
  // the studio only where the look leaves the backdrop to the editor), and the
  // one that changes with no store write behind it: switching the style
  // re-emits the tokens onto the theme root's inline `style`, which is exactly
  // what this observes. Without the subscription the presentation would flip
  // only on the next unrelated render, and a style switch is the gesture the
  // condition exists for.
  const lookPaintsViewport = useSyncExternalStore(
    subscribeThemeViewportGroup,
    lookDeclaresViewportColors,
  );
  const studioStage = stageCtx !== null && studioStageApplies(stageCtx, lookPaintsViewport);
  const studioStageRef = useRef(studioStage);
  studioStageRef.current = studioStage;
  // An ARTIFACT document gets the identity-row shell — the frame, the context
  // activation and the SELECTION REGISTRATION (`AssetEditorShell`'s
  // `selection` prop). Asked here, beside the studio presentation, because the
  // mount effect needs it too: whoever does NOT get the shell registers its own
  // workspace selection instead, and exactly one of the two must.
  const hasShell = stageCtx !== null && identityRowApplies(stageCtx);
  const hasShellRef = useRef(hasShell);
  hasShellRef.current = hasShell;
  // The ASSET FLAVOUR of this stage's provenance: the source adapter's
  // `documentKind` ("derived asset", `model-asset`) and the performance
  // source's kind. It is the studio presentation MINUS the data arm — a mesh
  // module opens in an isolation scene but is not a derived asset — and was
  // read off `studioStage` while the two were the same answer.
  const assetSubject = stageCtx !== null && assetSubjectApplies(stageCtx);
  const assetSubjectRef = useRef(assetSubject);
  assetSubjectRef.current = assetSubject;
  // The focused document fills the shell's readout. Null without a shell.
  const shellStats = useOptionalEditorStats();
  const shellStatsRef = useRef(shellStats);
  shellStatsRef.current = shellStats;
  const containerRef = useRef<HTMLDivElement>(null);
  // The shared lane mounts the pool's own canvas here instead of rendering one.
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const documentHostRef = useRef<Object3DDocumentHost | null>(null);
  const retainedRef = useRef<RetainedObject3DStageState | null>(null);
  if (!retainedRef.current || retainedRef.current.documentId !== documentId) {
    if (retainedRef.current) retainedObject3DStages.release(retainedRef.current);
    retainedRef.current = retainedObject3DStages.claim(documentId);
  }
  useEffect(() => {
    const retained = retainedRef.current!;
    const generation = retainedObject3DStages.generation(retained);
    return () => retainedObject3DStages.release(retained, generation);
  }, [documentId]);
  const retainedState = retainedRef.current;
  // WHAT THIS STAGE SHOWS. A world root stays attached while hidden: Play
  // adopts into it, and the play-entry flight rides its frame clock.
  const worldRoot = content?.kind === 'world-root';
  // Only a visible pane owns an interactive attachment. Hidden documents
  // retain their state and return their renderer to the bounded pool.
  const wantsSurface = active || worldRoot;
  const worldRootLoadRef = useRef(content?.kind === 'world-root' ? content.load : null);
  worldRootLoadRef.current = content?.kind === 'world-root' ? content.load : null;
  const [surfaceAttached, setSurfaceAttached] = useState(wantsSurface);
  useEffect(() => setSurfaceAttached(wantsSurface), [wantsSurface]);
  // The selection silhouette is a LIVE prop: a modeling document turns it off
  // the moment it enters its own sub-object mode and back on when it leaves,
  // and the session applies that to the composer it has already built. The ref
  // is what the mount path reads, since the session is built inside an effect
  // that does not depend on this prop.
  const selectionOutlineRef = useRef(selectionOutline);
  useEffect(() => {
    selectionOutlineRef.current = selectionOutline;
    const session = documentHostRef.current?.session;
    if (session)
      session.selectionOutlineEnabled = rendererLane !== 'inspector-preview' && selectionOutline;
    // And the view's own selection marks over it (`overlays.selection.outline`).
    documentHostRef.current?.applyPresentation?.();
  }, [selectionOutline, rendererLane]);
  const contentUpdateTail = useRef<Promise<void>>(Promise.resolve());
  const retainSourceOnDisposeRef = useRef(false);
  useEffect(() => {
    if (!surfaceAttached) return;
    firstFrameGateRef.current = false;
    setSurfaceStatus('building');
    return () => {
      const host = documentHostRef.current;
      if (host && !worldRoot) {
        // Inactive tabs stay open in the workspace. Their source remains
        // mounted in retained CPU state while the expensive attachment goes
        // back to the pool. A source revision or final close still disposes it.
        retainSourceOnDisposeRef.current = !activeRef.current;
        const pose = host.store.cameraPose;
        retainedState.camera =
          pose && host.viewport ? { ...pose, up: host.viewport.camera.up.clone() } : null;
        retainedState.presentation = host.session?.presentation() ?? null;
        retainedState.transport = host.transport.snapshot();
        retainedState.contentSeconds = host.contentSeconds;
        retainedState.transportAdvances = host.transportAdvances;
      }
      documentStateRef.current = null;
      persistenceSessionRef.current = null;
      interactionExtensionRef.current = null;
      rendererSessionRef.current = null;
      host?.close();
      documentHostRef.current = null;
    };
  }, [documentId, rendererLane, retainedState, surfaceAttached, worldRoot]);
  // Read through a ref: the one big lifetime effect below owns the canvas
  // listener, and re-running it on a new handler identity would tear the whole
  // renderer down and rebuild it.
  const onOpenNodeRef = useRef(onOpenNode);
  onOpenNodeRef.current = onOpenNode;
  const frameBoundsRef = useRef(frameBounds);
  frameBoundsRef.current = frameBounds;
  const openingFrameBoundsRef = useRef(openingFrameBounds);
  openingFrameBoundsRef.current = openingFrameBounds;
  const openingViewRef = useRef(openingView);
  openingViewRef.current = openingView;
  const cameraViewRef = useRef(cameraView);
  cameraViewRef.current = cameraView;
  // The current prop is still read by asynchronous installation. Attachment
  // lifetime is controlled separately by `surfaceAttached` above.
  const activeRef = useRef(active);
  activeRef.current = active;
  const previousActiveRef = useRef(active);
  const sourceIdentityRef = useRef({ build, sourcePath });
  useEffect(() => {
    const previous = sourceIdentityRef.current;
    sourceIdentityRef.current = { build, sourcePath };
    if (previous.build === build && previous.sourcePath === sourcePath) return;
    // An HMR revision received while hidden invalidates the prepared source.
    // The next reveal constructs the current revision while retaining the
    // pane's camera, tool, helpers, selection, and transport state.
    if (!surfaceAttached && retainedState.source) {
      retainedState.source.dispose();
      retainedState.source = null;
    }
  }, [build, retainedState, sourcePath, surfaceAttached]);
  const rendererSessionRef = useRef<DocumentRendererSession | null>(null);
  const firstFrameGateRef = useRef(false);
  const interactionExtensionRef = useRef<ReturnType<
    NonNullable<typeof interaction>['setup']
  > | null>(null);
  const documentStateRef = useRef<{
    root: THREE.Object3D;
    animations: readonly THREE.AnimationClip[];
  } | null>(null);
  const persistenceSessionRef = useRef<Promise<Object3DDocumentPersistenceSession> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surfaceStatus, setSurfaceStatus] = useState<'building' | 'ready'>('building');
  // A world root's own mount state and the binding that draws its overlays.
  const [worldRootBinding, setWorldRootBinding] = useState<WorldRootStageBinding | null>(null);
  const [designMountStatus, setDesignMountStatus] = useState<'mounting' | 'ready'>('mounting');
  const [designRootIds, setDesignRootIds] = useState<readonly string[]>([]);
  const cameraPreviewRef = useRef<HTMLDivElement | null>(null);
  const [projection, setProjection] = useState<ThreeViewportProjection>('perspective');
  // The live authoring adapter this document's inspection composes from. It
  // only exists once the graph is built, so it is state rather than a ref:
  // its arrival is what re-renders the aside below.
  const [documentAdapter, setDocumentAdapter] = useState<AuthoringAdapter | null>(null);
  const documentAdapterRef = useRef<AuthoringAdapter | null>(null);
  documentAdapterRef.current = documentAdapter;
  const cameraX = cameraDirection?.[0];
  const cameraY = cameraDirection?.[1];
  const cameraZ = cameraDirection?.[2];
  const modelSourceKind = modelSource?.kind;
  const modelSourcePath = modelSource?.kind === 'project-file' ? modelSource.path : undefined;
  const modelSourceEntityId = modelSource?.kind === 'entity' ? modelSource.entityId : undefined;
  const dressingEnvironment = dressing?.environment;
  const dressingBackground = dressing?.background;
  const dressingKeyLight = dressing?.keyLight;
  const dressingGrid = dressing?.grid;
  const dressingViewLocked = dressing?.viewLocked;
  const dressingToneMapping = dressing?.toneMapping;
  if (active) markViewportReactActive(documentId);

  // Document identity owns the host. Source changes prepare a separate native
  // graph, then publish it into that host without recreating editor state.
  useEffect(() => {
    let cancelled = false;
    if (!surfaceAttached) return;
    /**
     * THE WORLD ROOT'S CONTENT BINDING. It shows the project's world rather
     * than one constructed Object3D, so it brings its own surface, scene,
     * composer and the presenter Play adopts through; everything else about
     * the stage is the host's, exactly as it is for a prefab or a model.
     */
    const installWorldRoot = async (
      load: () => Promise<WorldRootStageBinding>,
    ): Promise<void> => {
      const container = containerRef.current;
      const canvasHost = canvasHostRef.current;
      if (!container || !canvasHost || documentHostRef.current) return;
      const stats = shellStatsRef.current;
      if (!stats) {
        // The world root IS the shell's own subject — its readout, its
        // adoption stack, its transport. A bounded host has none of that.
        setError('The world root needs the editor shell above it; this host has none.');
        return;
      }
      const binding = await load();
      if (cancelled || documentHostRef.current) return;
      setWorldRootBinding(() => binding);
      markViewportConstructStarted();
      const host = new Object3DDocumentHost(
        'own',
        binding.mountWorldRootSurface(canvasHost, container, displayName),
        // The world is the session's own subject: Play adoption, ingest, the
        // project history and the host door's hierarchy facet all address the
        // SESSION store, so this stage runs on it rather than a private one.
        threeStoreForHost() ?? undefined,
      );
      documentHostRef.current = host;
      host.cleanups.push(registerStageStore(documentId, host.store.shell));
      host.cleanups.push(registerStageTransport(documentId, host.transport));
      host.cleanups.push(
        registerDocumentViewport(documentId, {
          ...sceneDocumentViewport(host.store, documentId),
          ...threeStageTransformChrome(documentId),
        }),
      );
      const stage = binding.installWorldRootStage({
        store: host.store,
        documentId,
        container,
        canvas: host.surface.canvas,
        renderer: host.surface.renderer,
        stats,
        cameraPreview: () => cameraPreviewRef.current,
        onMountStatus: setDesignMountStatus,
        onRootIds: setDesignRootIds,
        runFrame: (delta) => runViewportFrame(documentId, delta),
      });
      host.viewport = stage.viewport;
      host.frame = stage.frame;
      host.content = {
        scene: stage.scene,
        settle: () => Promise.resolve(),
        dispose: async () => stage.dispose(),
      };
      // The world's tree arrives asynchronously and keeps changing, so its
      // clip subjects are rescanned on the store's change notification,
      // throttled, and not while Play drives time.
      // The scene the stage DRAWS: an R3F world renders the session store's
      // scene, not the stage's own (`world-root-stage.ts`), and scanning the
      // latter found no subject on a world whose enemies each had a mixer.
      const clipScan = scanClipSubjects(() => host.store.scene ?? stage.scene, host.transport, {
        // A game makes its mixers as its world runs, not when the store changes.
        rescanOnLiveMixers: () => host.store.shell.playState === 'stopped',
      });
      let lastClipScan = 0;
      host.cleanups.push(() => clipScan.dispose());
      host.cleanups.push(
        host.store.shell.subscribe(() => {
          if (host.store.shell.playState !== 'stopped') return;
          const now = performance.now();
          if (now - lastClipScan < CLIP_RESCAN_INTERVAL_MS) return;
          lastClipScan = now;
          clipScan.refresh();
        }),
      );
      // This stage's presenter is the real one: Play adoption is a condition
      // on the world-root binding, and a `build` stage declines every root.
      host.cleanups.push(
        bindViewportRig(
          {
            camera: stage.viewport.camera,
            drawCamera: () => stage.viewport.renderCamera,
            orbit: stage.viewport.orbitControls,
            scene: stage.scene,
          },
          stage.present,
          stage.setHelper,
          { documentId },
        ),
      );
      rendererSessionRef.current = host.rendererSession;
      host.initialized = true;
      markViewportConstructReady();
      // The binding's own overlay reports mount progress.
      setSurfaceStatus('ready');
      // Always active: the play-entry flight rides this clock while the Game
      // document holds focus; the stage skips frames by its own visibility.
      host.rendererSession.setActive(true);
    };
    const install = async () => {
      await documentHostRef.current?.content?.settle();
      while (liveGestureActive()) await whenLiveGestureIdle();
      if (cancelled) return;
      const loadWorldRoot = worldRootLoadRef.current;
      if (loadWorldRoot) return installWorldRoot(loadWorldRoot);
      const container = containerRef.current;
      const canvasHost = canvasHostRef.current;
      if (!container || !canvasHost) return;
      if (!build || sourcePath === undefined) {
        // `build` content is one Object3D the caller constructs from one file.
        // Both are required by the SDK; validate callers at the runtime boundary.
        setError('This stage shows `build` content and was given no `build()`/`sourcePath`.');
        return;
      }
      let source: ReturnType<NonNullable<typeof build>>;
      const retainedGeneration = retainedObject3DStages.generation(retainedState);
      try {
        source = retainedState.source ?? build();
        retainedState.source = null;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return;
      }
      try {
        if (!documentHostRef.current) {
          markViewportConstructStarted();
          documentHostRef.current = new Object3DDocumentHost(
            rendererLane,
            mountViewportSurface(
              canvasHost,
              rendererLane,
              displayName,
              {
                width: Math.max(1, container.clientWidth),
                height: Math.max(1, container.clientHeight),
              },
              () => {
                // A lost context is never returned to the pool. Rebuild this
                // visible attachment from the retained document state.
                setSurfaceAttached(false);
                window.setTimeout(() => {
                  if (activeRef.current) setSurfaceAttached(true);
                }, 0);
              },
            ),
            retainedState.store,
          );
          documentHostRef.current.contentSeconds = retainedState.contentSeconds;
          documentHostRef.current.transportAdvances = retainedState.transportAdvances;
        }
      } catch (caught) {
        source.dispose();
        throw caught;
      }
      const host = documentHostRef.current!;
      const returnSurface = host.borrow();
      const { renderer, canvas, lease } = host.surface;
      const store = host.store;
      // This stage's store, reachable by the shared panels through
      // `focusedStageStore()` (ARCHITECTURE-CORE §One stage unit 4). A
      // CHROMELESS preview is not a stage anything can focus — it has no
      // workspace document — so it registers nothing.
      if (!chromeless) {
        host.cleanups.push(registerStageStore(documentId, store.shell));
        host.cleanups.push(registerStageTransport(documentId, host.transport));
      }
      const history = workspaceHistoryService();
      if (history) store.shell.attachHistory(history);
      const shared = rendererLane === 'inspector-preview';
      const studioStage = studioStageRef.current;
      const hasShell = hasShellRef.current;
      const assetSubject = assetSubjectRef.current;
      const scene = new THREE.Scene();
      // The image-based light's strength is the view presentation's (its studio preset's), set
      // on the rendered scene before every draw (`syncHostScene`). The content scene keeps
      // three's default, so a document that authors its own strength still states it here.
      const sourceParent = source.root.parent;
      scene.add(source.root);
      if (source.animations) source.root.animations = [...source.animations];
      const documentState = { root: source.root, animations: source.root.animations };
      let defaultAdapter: SourceObject3DAuthoringAdapter | null = null;
      let projectAuthoring: ToolObject3DDocumentAuthoring | null = null;
      let activePersistenceSession: Promise<Object3DDocumentPersistenceSession> | null = null;
      let interactionExtension: ReturnType<NonNullable<typeof interaction>['setup']> | null = null;
      let gestureController: Object3DGestureController | null = null;
      let pointerDownListener: ((event: PointerEvent) => void) | null = null;
      let pointerMoveListener: ((event: PointerEvent) => void) | null = null;
      let pointerUpListener: ((event: PointerEvent) => void) | null = null;
      let pointerCancelListener: ((event: PointerEvent) => void) | null = null;
      let escapeListener: ((event: KeyboardEvent) => void) | null = null;
      let stopDrawSignals: (() => void) | null = null;
      let activateInteraction: (() => void) | null = null;
      let rollback: (() => void) | null = null;
      let published = false;
      let disposed = false;
      let cleanup: Promise<void> | null = null;
      const binding: DocumentContentBinding = {
        scene,
        settle: () => gestureController?.settle() ?? Promise.resolve(),
        dispose: () => {
          if (cleanup) return cleanup;
          disposed = true;
          const retainSource = retainSourceOnDisposeRef.current;
          retainSourceOnDisposeRef.current = false;
          if (pointerDownListener)
            container.removeEventListener('pointerdown', pointerDownListener, true);
          if (pointerMoveListener)
            container.removeEventListener('pointermove', pointerMoveListener, true);
          if (pointerUpListener)
            container.removeEventListener('pointerup', pointerUpListener, true);
          if (pointerCancelListener)
            container.removeEventListener('pointercancel', pointerCancelListener, true);
          if (escapeListener) window.removeEventListener('keydown', escapeListener);
          stopDrawSignals?.();
          stopDrawSignals = null;
          cleanup = (async () => {
            await gestureController?.settle();
            const failures: unknown[] = [];
            for (const release of [
              () => interactionExtension?.dispose(),
              () => projectAuthoring?.dispose?.(),
              () => defaultAdapter?.dispose(),
              () => scene.removeFromParent(),
              () => {
                if (retainSource)
                  retainedObject3DStages.retain(retainedState, source, retainedGeneration);
                else source.dispose();
              },
              returnSurface,
            ]) {
              try {
                release();
              } catch (error) {
                failures.push(error);
              }
            }
            if (failures.length) {
              // biome-ignore lint/suspicious/noConsole: teardown must remain diagnosable
              console.error('Object3D source cleanup failed.', ...failures);
            }
          })();
          return cleanup;
        },
      };
      try {
        const commitProjectDocument = async (label?: string): Promise<boolean> => {
          try {
            const document = documentState;
            if (documentSource && !persistence) {
              // The whole document is ONE source module: the same seam the
              // animation binding writes through — checksum-guarded whole-file
              // replace, recorded in canonical history — never the resource
              // route, which refuses executable source by rule.
              if (!document)
                throw new Error('Project history is unavailable; the edit was not saved.');
              const history = workspaceHistoryService();
              if (!history) {
                throw new Error('Project history is unavailable; the edit was not saved.');
              }
              const source = documentSource.serialize(document);
              if (source === null) {
                // The document says nothing changed: a real no-change outcome,
                // never a write of the emitted form over a hand-written file.
                setError(null);
                return false;
              }
              const changed = await projectWrites().replaceSource(history, {
                file: documentSource.path,
                source,
                label: label ?? documentSource.label ?? `Edit ${displayName}`,
              });
              setError(null);
              return changed;
            }
            if (!persistence) {
              throw new Error('This Asset Lab document has no persistence binding.');
            }
            if (!activePersistenceSession || !document) {
              throw new Error('Project history is unavailable; the edit was not saved.');
            }
            // The pipe's ack for THIS commit: `persisted` is whether a byte moved
            // (a serializer that reproduced the bytes already on disk is a real
            // no-change outcome; a genuine failure throws below).
            const { persisted } = await (await activePersistenceSession).commit(document, label);
            setError(null);
            return persisted;
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : JSON.stringify(caught));
            throw caught;
          }
        };
        defaultAdapter = new SourceObject3DAuthoringAdapter(store, scene, {
          documentId,
          title: displayName,
          sourcePath,
          documentKind: assetSubject ? 'asset' : 'source',
          audit,
          ...(source.hierarchyRoots ? { hierarchyRoots: source.hierarchyRoots } : {}),
          ...(modelSourceKind === 'project-file' && modelSourcePath
            ? { modelSource: { kind: modelSourceKind, path: modelSourcePath } as const }
            : modelSourceKind === 'entity' && modelSourceEntityId
              ? { modelSource: { kind: modelSourceKind, entityId: modelSourceEntityId } as const }
              : {}),
        });
        const authoringContext = {
          documentId,
          sourcePath,
          root: source.root,
          animations: source.root.animations,
          scene,
          defaultAdapter,
          commit: commitProjectDocument,
        };
        projectAuthoring = authoring?.(authoringContext) ?? null;
        if (!projectAuthoring && sourceAuthoring) {
          projectAuthoring = sourceAuthoring({
            store,
            scene,
            ...(source.hierarchyRoots ? { hierarchyRoots: source.hierarchyRoots } : {}),
          });
          defaultAdapter.dispose();
        }
        // Project authoring may establish the module-local artifact that its
        // serializers read (a rig document is the concrete example). Open the
        // persistence baseline only after that factory has adopted the root;
        // opening it before authoring made every clean rig mount reject with
        // "Object3D is not a project rig artifact."
        activePersistenceSession =
          persistence && history
            ? projectWrites().openPersistence({
                binding: persistence,
                document: documentState,
                history,
              })
            : null;
        if (activePersistenceSession) {
          void activePersistenceSession.catch((caught) => {
            if (!disposed && documentHostRef.current?.content === binding) {
              setError(caught instanceof Error ? caught.message : JSON.stringify(caught));
            }
          });
        }
        const adapter: AuthoringAdapter = projectAuthoring?.adapter ?? defaultAdapter;

        // All editor furniture belongs to the persistent scene. Adapters and
        // project extensions see only this revision's isolated content scene.
        if (!host.dressing) {
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          // The stage's VIEW TRANSFORM. ACES unless the document states its
          // own — see `ToolViewportDressing.toneMapping`. It is set here, with
          // the rest of the renderer's fixed state, because it belongs to the
          // surface rather than to any one material: three compiles the
          // operator into every `toneMapped` program.
          renderer.toneMapping = dressingToneMapping ?? THREE.ACESFilmicToneMapping;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.info.autoReset = false;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          if (studioStage) renderer.setClearColor(0x000000, 0);
          const environment =
            dressingEnvironment === false
              ? null
              : lease && 'environment' in lease
                ? lease.environment()
                : createStandardEnvironment(renderer);
          // A palette that carries a viewport background (Blender's flat grey,
          // Plotter's paper) paints it in place of the dressing's gradient. The
          // gradient is made either way, so a switch to a palette that names
          // none has a backdrop to return to (`watchPaletteBackdrop` below).
          const look = nativeViewportLook(canvas);
          host.dressing = applyStandardViewportDressing(host.scene, {
            environment,
            background:
              !studioStage &&
              background === undefined &&
              dressingBackground !== false,
            // The stage's lights are the presentation rig's, below.
            keyLight: false,
            grid: dressingGrid === true,
            content: source.root,
          });
          if (!studioStage && background !== undefined)
            host.scene.background = new THREE.Color(background);
          else if (!studioStage && look.background !== null)
            host.scene.background = new THREE.Color(look.background);
          host.defaultEnvironment = host.scene.environment;
          host.defaultBackground = host.scene.background;
          // Every document stage has one: a studio stage differs in its BACKDROP (the page shows
          // through its alpha canvas), not in how it is lit.
          {
            const rig = new StagePresentationRig(host.scene, invalidateStages);
            host.presentationRig = rig;
            bindViewPresentation(documentId, viewStageKind);
            const applyPresentation = () => {
              const presentation = viewPresentation(documentId);
              rig.apply(presentation, renderer, dressingToneMapping);
              // The view's overlays: its selection marks and its grid's major step. The native
              // outline is also the stage's own switch (a shared preview draws none).
              host.viewport?.setStageFunction(presentation.world, presentation.interaction);
              host.viewport?.setSelectionMarks(presentation.overlays.selection);
              host.viewport?.setGridMajorEvery(presentation.overlays.grid.majorEvery);
              host.viewport?.setAxisLines(presentation.overlays.axes);
              host.viewport?.setNavigation(presentation.overlays.navigation);
              host.viewport?.setGridVisible(presentation.overlays.grid.visible);
              if (host.session) {
                host.session.selectionOutlineEnabled =
                  !shared && selectionOutlineRef.current && presentation.overlays.selection.outline;
                host.session.selectionOriginsEnabled = !shared && presentation.overlays.selection.origins;
              }
              invalidateStages();
            };
            host.applyPresentation = applyPresentation;
            applyPresentation();
            host.cleanups.push(subscribeViewportPresentation(applyPresentation));
            // A view may name an environment image its integration registers later.
            host.cleanups.push(
              subscribeEnvironmentImages(() => {
                rig.forgetFailedImages();
                applyPresentation();
              }),
            );
            host.cleanups.push(() => {
              rig.dispose();
              if (host.presentationRig === rig) host.presentationRig = null;
            });
          }
          host.cleanups.push(() => {
            if (
              host.defaultBackground instanceof THREE.Texture &&
              host.defaultBackground !== host.dressing?.backgroundTexture
            )
              host.defaultBackground.dispose();
          });
        }
        const pick = (clientX: number, clientY: number): string | null => {
          const current = host.adapter;
          const viewport = host.viewport;
          if (!current || !viewport) return null;
          const rect = canvas.getBoundingClientRect();
          const pointer = new THREE.Vector2(
            ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
            -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
          );
          const raycaster = new THREE.Raycaster();
          raycaster.layers.enableAll();
          // A drawn line is hit within a few pixels of it (`LineSegments2`'s own test).
          (raycaster.params as { Line2?: { threshold: number } }).Line2 = { threshold: 4 };
          raycaster.setFromCamera(pointer, host.session?.camera() ?? viewport.camera);
          const idOf = (start: THREE.Object3D | null): string | null => {
            for (let object = start; object; object = object.parent) {
              const id = current.hierarchy.idForObject3D?.(object);
              if (id) return id;
            }
            return null;
          };
          let nearest: { distance: number; id: string } | null = null;
          for (const hit of raycaster.intersectObjects([...store.objectMap.values()], true)) {
            if (isInEditorOwnedSubtree(hit.object)) continue;
            const id = idOf(hit.object);
            if (id) {
              nearest = { distance: hit.distance, id };
              break;
            }
          }
          // AN OBJECT DRAWN BY A HELPER is picked through it: a document that draws an object's
          // overlay itself (a Blender camera's wire, a light's icon) marks each part with the
          // object it stands for (`userData.vgaiPicksAs`), and the nearer hit wins, as Blender's
          // pick over its whole drawing does.
          // Only helpers that say they can be picked (`userData.vgaiPickable`) are asked, and a
          // part is hit only where it is shown (three's raycast reads layers, not `visible`).
          const pickable = viewport.visibleHelpers().filter((helper) => helper.userData['vgaiPickable'] === true);
          for (const hit of raycaster.intersectObjects(pickable, true)) {
            let proxy: THREE.Object3D | null = null;
            let shown = true;
            for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
              if (!object.visible) shown = false;
              proxy ??= (object.userData['vgaiPicksAs'] as THREE.Object3D | undefined) ?? null;
            }
            if (!shown) continue;
            const id = proxy ? idOf(proxy) : null;
            if (!id) continue;
            if (!nearest || hit.distance < nearest.distance) nearest = { distance: hit.distance, id };
            break;
          }
          return nearest?.id ?? null;
        };
        if (!host.viewport) {
          host.viewport = new EditorViewport(canvas, host.scene, store, container, {
            renderer,
            authoring: () => host.adapter ?? adapter,
            pick,
            // Asked only once the viewport stands (a box select), so `host.viewport` is set.
            drawCamera: (): THREE.Camera => host.session?.camera() ?? host.viewport!.camera,
            publishPickContext: false,
            onProjectionChange: setProjection,
            // The same expression that places the DOM furniture, for the one
            // piece of furniture that is drawn on the canvas instead.
            chromeInsetPx: chromeless || hasShell ? 0 : STAGE_BLEED_PX,
            // A document that turns the dressing's key light off has said it
            // lights itself, and the editor's design-time rig answers exactly
            // the same question. MEASURED on the Model stage before this
            // existed: the rig's ambient 0.5 + directional 1.0 sit on
            // `EDITOR_LAYER`, but three filters lights by the CAMERA's layers
            // (`WebGLRenderer.projectObject`) and the one camera that draws
            // this stage enables that layer to see the grid and the gizmo —
            // so the layer scopes them away from nothing at all and they lit
            // the content.
            lightRig: false,
          });
          if (dressingGrid === true) host.viewport.grid.removeFromParent();
          const open = (event: MouseEvent) => {
            const id = pick(event.clientX, event.clientY);
            const object = id && host.adapter ? threeObject(host.adapter.hierarchy, id) : null;
            if (object) onOpenNodeRef.current?.(object);
          };
          container.addEventListener('dblclick', open);
          host.cleanups.push(() => container.removeEventListener('dblclick', open));
        }
        const viewport = host.viewport;
        if (dressingViewLocked) {
          // VIEW-LOCKED DRESSING. The object turns with the view because it
          // hangs off the camera, and the camera joins the RENDERED scene for
          // the same reason: three collects lights while it walks the scene
          // (`WebGLRenderer.projectObject`), so a light parented to a camera
          // that is not in the scene is never collected at all. A camera in
          // the graph draws nothing and picks nothing — it carries no
          // geometry — and the scene's own `updateMatrixWorld` is then what
          // carries the view pose down to its children each frame.
          //
          // ONE camera is the view pose for this stage: the session's
          // orthographic camera copies `viewport.camera`'s position and
          // quaternion before every draw it makes (`object3d-document-
          // session.ts::syncOrthographicCamera`), so locking to the
          // perspective camera locks to both projections. A capture with its
          // OWN camera (a Blender render photographs from the scene's camera)
          // is deliberately not followed: a render is lit by the scene.
          const camera = viewport.camera;
          host.scene.add(camera);
          // Under a group of the stage's own, which the view's presentation shows only while it
          // lights by the document's studio; the document keeps its say over what is inside.
          const viewLockedHolder = new THREE.Group();
          viewLockedHolder.name = 'vgai:document-studio';
          viewLockedHolder.add(dressingViewLocked);
          camera.add(viewLockedHolder);
          host.documentStudio = viewLockedHolder;
          host.cleanups.push(() => {
            dressingViewLocked.removeFromParent();
            viewLockedHolder.removeFromParent();
            if (host.documentStudio === viewLockedHolder) host.documentStudio = null;
            camera.removeFromParent();
          });
        }
        if (interaction) {
          const overlay = new THREE.Group();
          overlay.name = '__object3d_document_overlay';
          setUserData(overlay, 'editorHelper', true);
          scene.add(overlay);
          interactionExtension = interaction.setup({
            root: source.root,
            scene,
            renderer,
            overlay,
            camera: () => host.session?.camera() ?? viewport.camera,
            writable: persistence !== undefined || documentSource !== undefined,
          });
          const pointerEvent = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            const pointer = new THREE.Vector2(
              ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
              -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
            );
            const raycaster = new THREE.Raycaster();
            raycaster.layers.enableAll();
            raycaster.setFromCamera(pointer, host.session?.camera() ?? viewport.camera);
            return {
              pointerId: event.pointerId,
              button: event.button,
              buttons: event.buttons,
              clientX: event.clientX,
              clientY: event.clientY,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              ray: raycaster.ray.clone(),
              hits: raycaster.intersectObjects([source!.root, overlay], true),
            };
          };
          gestureController = new Object3DGestureController({
            begin: (event) => {
              if (!persistence && !documentSource) {
                throw new Error(
                  'This Asset Lab document has no persistence binding; project gestures are read-only.',
                );
              }
              return interactionExtension!.begin(event);
            },
            persist: async (label) => {
              await commitProjectDocument(label);
            },
            reportError: (caught) =>
              setError(caught instanceof Error ? caught.message : JSON.stringify(caught)),
          });
          const claim = (event: PointerEvent) => {
            event.preventDefault();
            event.stopPropagation();
          };
          pointerDownListener = (event) => {
            // A control painted OVER the stage owns its own press. These
            // listeners sit on the CONTAINER in the capture phase, so they run
            // before that control's own handler and a `stopPropagation` there
            // would be too late: pressing the rolled-back-operation notice's
            // Dismiss also started a box-select on the mesh (measured — the
            // notice's text changed from the failed op to "Box select").
            // The viewport's navigation cluster (`ViewportFurniture`) is the
            // same case and was missing here: its Pan button drives the camera
            // from `onPointerDown`, which React dispatches at the root, so
            // claiming the press here meant `startPan` never ran and the
            // control was inert (measured — the camera floats were identical
            // before and after a full pointer gesture, while the cluster's
            // `onClick` buttons beside it moved the camera every time).
            if (
              event.target instanceof Element &&
              event.target.closest('[role="alert"], [role="toolbar"]') !== null
            ) {
              return;
            }
            if (!gestureController?.begin(pointerEvent(event))) return;
            claim(event);
            // DOM-only editor automation dispatches honest untrusted pointer
            // events, which have no browser-owned active pointer and therefore
            // cannot be captured. Hardware pointers still take capture so a
            // gesture can leave the viewport without getting stranded.
            if (event.isTrusted) canvas.setPointerCapture?.(event.pointerId);
          };
          pointerMoveListener = (event) => {
            if (!gestureController?.hasActiveGesture()) return;
            claim(event);
            gestureController.update(pointerEvent(event));
          };
          pointerUpListener = (event) => {
            if (!gestureController?.hasActiveGesture()) return;
            claim(event);
            if (canvas.hasPointerCapture?.(event.pointerId)) {
              canvas.releasePointerCapture?.(event.pointerId);
            }
            void gestureController.commit(pointerEvent(event));
          };
          pointerCancelListener = (event) => {
            if (!gestureController?.hasActiveGesture()) return;
            claim(event);
            void gestureController.cancel(event.pointerId);
          };
          escapeListener = (event) => {
            if (event.key !== 'Escape' || !gestureController?.hasActiveGesture()) return;
            event.preventDefault();
            void gestureController.cancel();
          };
          activateInteraction = () => {
            container.addEventListener('pointerdown', pointerDownListener!, true);
            container.addEventListener('pointermove', pointerMoveListener!, true);
            container.addEventListener('pointerup', pointerUpListener!, true);
            container.addEventListener('pointercancel', pointerCancelListener!, true);
            window.addEventListener('keydown', escapeListener!);
          };
        }
        // Candidate construction has succeeded. Publish all source references in
        // one synchronous turn; no frame or input event can see a half-swap.
        const previous = host.content;
        const selected = [...store.shell.selectedEntityIds];
        const previousAdapter = host.adapter;
        const previousObjects = new Map(store.objectMap);
        const previousRoot = host.session?.root;
        const previousFrame = host.frame;
        const previousSyncHostScene = host.syncHostScene;
        const previousDocument = documentStateRef.current;
        const previousPersistence = persistenceSessionRef.current;
        const previousInteraction = interactionExtensionRef.current;
        const previousBackground = host.session?.neutralBackgroundTexture();
        const previousLights = host.dressing.lights.map((light) => light.visible);
        const cleanupCount = host.cleanups.length;
        const wasInitialized = host.initialized;
        rollback = () => {
          scene.removeFromParent();
          if (sourceParent) sourceParent.add(source.root);
          if (previous) host.scene.add(previous.scene);
          host.adapter = previousAdapter;
          host.content = previous;
          host.frame = previousFrame;
          host.syncHostScene = previousSyncHostScene;
          host.initialized = wasInitialized;
          for (const cleanup of host.cleanups.splice(cleanupCount)) cleanup();
          if (!previousRoot && host.session) {
            host.session.dispose();
            host.session = null;
          }
          store.objectMap.clear();
          for (const [id, object] of previousObjects) store.objectMap.set(id, object);
          if (previous)
            store.bindScene(previous.scene, renderer, viewport.batchedRenderer, viewport.camera);
          if (previousRoot && previousAdapter)
            host.session?.replaceContent(previousRoot, previousAdapter);
          documentStateRef.current = previousDocument;
          persistenceSessionRef.current = previousPersistence;
          interactionExtensionRef.current = previousInteraction;
          documentAdapterRef.current = previousAdapter;
          setDocumentAdapter(previousAdapter);
          if (previousBackground !== undefined)
            host.session?.setNeutralBackground(previousBackground);
          host.dressing?.lights.forEach((light, index) => {
            light.visible = previousLights[index] ?? true;
          });
          if (previousRoot) {
            host.dressing?.frameContent(previousRoot);
            host.presentationRig?.placeFloor(previousRoot);
          }
          store.shell.selectMultiple(selected);
          store.notifyIngestObjectMapEdit();
        };
        previous?.scene.removeFromParent();
        host.scene.add(scene);
        host.adapter = adapter;
        host.content = binding;
        store.bindScene(scene, renderer, viewport.batchedRenderer, viewport.camera);
        store.setOrbitTarget(viewport.orbitControls.target);
        store.objectMap.clear();
        scene.traverse((object) => {
          const id = adapter.hierarchy.idForObject3D?.(object);
          if (id) store.objectMap.set(id, object);
        });
        if (!host.session) {
          const overviewFrame = boxFromFrameBounds(frameBoundsRef.current);
          const openingFrame = boxFromFrameBounds(openingFrameBoundsRef.current) ?? overviewFrame;
          if (!openingFrame) viewport.focusOn(source.root);
          const stated = openingViewRef.current;
          if (stated) {
            if (stated.lens !== undefined) viewport.setLens(stated.lens);
            const target = new THREE.Vector3(...stated.target);
            const direction = new THREE.Vector3(...stated.direction).normalize();
            viewport.camera.position.copy(target).addScaledVector(direction, stated.distance);
            // The screen's up is the view's own, so a rolled view opens rolled (a turntable
            // orbit keeps it); without one, the world's.
            viewport.camera.up.set(0, 1, 0);
            if (stated.up) viewport.camera.up.set(...stated.up);
            viewport.orbitControls.target.copy(target);
          } else if (cameraX !== undefined && cameraY !== undefined && cameraZ !== undefined) {
            const box = openingFrame ?? contentWorldBounds(source.root);
            const center = box.getCenter(new THREE.Vector3());
            const direction = new THREE.Vector3(cameraX, cameraY, cameraZ).normalize();
            const distance =
              perspectiveDistanceToFitBox(box, viewport.camera, direction) *
              Math.min(10, Math.max(0.1, openingFit ?? 1));
            viewport.camera.position.copy(center).add(direction.multiplyScalar(distance));
            viewport.orbitControls.target.copy(center);
          }
          host.session = new Object3DDocumentSession(
            documentId,
            source.root,
            host.scene,
            renderer,
            viewport,
            adapter,
            studioStage
              ? null
              : background === undefined
                ? host.dressing.backgroundTexture
                : new THREE.Color(background),
            overviewFrame,
          );
          host.session.selectionOutlineEnabled = !shared && selectionOutlineRef.current;
          host.session.setCameraViewSource(cameraViewRef.current ?? null);
          // The view's presentation, now that the viewport and session exist to take it.
          host.applyPresentation?.();
          // A saved view's projection is part of where the file opens.
          if (openingViewRef.current?.projection === 'orthographic') host.session.setProjection('orthographic');
          if (!studioStage && background === undefined && host.dressing.backgroundTexture) {
            const session = host.session;
            host.cleanups.push(
              watchPaletteBackdrop(() => {
                // THE LOOK'S BACKDROP, in both directions and through the
                // session's neutral backdrop, which repaints what is showing: a
                // palette's flat viewport background when it names one, the
                // dressing's gradient re-derived for the palette otherwise.
                // Painting the flat colour straight onto the scene left it there
                // when the next palette named none (Plotter's paper stayed under
                // Classic).
                const flat = nativeViewportLook(canvas).background;
                const previous = host.defaultBackground;
                host.defaultBackground =
                  flat !== null ? new THREE.Color(flat) : createGradientBackgroundTexture();
                if (session.neutralBackgroundTexture() === previous)
                  session.setNeutralBackground(host.defaultBackground);
                if (
                  previous instanceof THREE.Texture &&
                  previous !== host.dressing?.backgroundTexture
                )
                  previous.dispose();
              }),
            );
          }
        } else host.session.replaceContent(source.root, adapter);
        const retainedCamera = retainedState.camera;
        if (retainedCamera) {
          // Top views and rolled views have their own up direction, which setPose's lookAt
          // derives the orientation with.
          viewport.setPose(
            retainedCamera.position,
            retainedCamera.target,
            retainedCamera.fov || undefined,
            retainedCamera.up,
          );
          // After the pose, which draws in perspective: an orthographic view comes back as one.
          viewport.setProjection(projection);
          retainedState.camera = null;
        }
        const documentSession = host.session;
        documentStateRef.current = documentState;
        persistenceSessionRef.current = activePersistenceSession;
        interactionExtensionRef.current = interactionExtension;
        documentAdapterRef.current = adapter;
        setDocumentAdapter(adapter);
        // THE DOCUMENT'S SAY, as its layer beneath the person's choices. A document that hands
        // the stage its own view-locked studio (Blender's four Solid-mode lights) is lit by it —
        // the `document` preset, never giving way to the scene, as Blender's Solid never does. A
        // document that turned the key off without one has said it lights itself: the `scene`
        // source. Lights the CONTENT carries are the view's `auto` rule's to weigh, per draw.
        // A stage whose builder already stated its lighting (Blender's, per shading mode) has said
        // it; the document's layer would override every mode's with one.
        const startingLights =
          startingPresentation(viewStageKind)?.all?.lighting !== undefined || stageLightsPerMode(viewStageKind);
        bindViewPresentation(
          documentId,
          viewStageKind,
          startingLights
            ? null
            : dressingViewLocked
              ? { all: { lighting: { source: 'studio', studioPreset: DOCUMENT_STUDIO_PRESET.id, auto: null } } }
              : dressingKeyLight === false
                ? { all: { lighting: { source: 'scene' } } }
                : null,
        );
        // THE DRAW MODE IS ONE FACT IN TWO PLACES, kept equal: the session draws it, and the view's
        // presentation resolves its per-mode lighting by it and persists it. A shading cell changes
        // the session and the view follows; a named view or a restored view changes the view and
        // the session follows. Modes the view does
        // not carry (UV, vertex colours) change only the session.
        const viewModes = new Set<string>(VIEW_DRAW_MODES);
        const sessionToView = (): void => {
          const mode = host.session?.presentation().mode;
          if (mode === undefined || !viewModes.has(mode)) return;
          if (viewPresentation(documentId).drawMode !== mode)
            setViewPresentation(documentId, { drawMode: mode as ViewportDrawMode });
        };
        // A draw mode the person chose and the view restored is theirs: the session takes it. Only
        // a view with no such choice is given the session's.
        const restoredMode = viewPresentationSnapshot(documentId).drawMode;
        if (restoredMode !== undefined && viewModes.has(restoredMode) && host.session)
          host.session.setMode(restoredMode);
        else sessionToView();
        const stopSessionMode = host.session?.subscribe(sessionToView);
        const stopViewMode = subscribeViewportPresentation(() => {
          const session = host.session;
          const mode = viewPresentation(documentId).drawMode;
          if (session && session.presentation().mode !== mode && viewModes.has(session.presentation().mode))
            session.setMode(mode);
        });
        host.cleanups.push(() => {
          stopSessionMode?.();
          stopViewMode();
        });
        const contentLights: THREE.Light[] = [];
        source.root.traverse((object) => {
          if ((object as THREE.Light).isLight) contentLights.push(object as THREE.Light);
        });
        const contentHas = {
          light: contentLights.length > 0,
          'directional-light': contentLights.some((light) => (light as THREE.DirectionalLight).isDirectionalLight),
        };
        host.contentLights = contentLights;
        host.contentHas = contentHas;
        host.dressing.frameContent(source.root);
        host.presentationRig?.placeFloor(source.root);
        // An edit can move the content's lowest point; the floor follows it.
        host.cleanups.push(store.shell.subscribe(() => host.presentationRig?.placeFloor(source.root)));
        // A selected id survives the swap when the new adapter still answers for it, not only when
        // it keys the object map: an adapter can answer in two id spaces (Blender's Outliner keys
        // its rows and resolves the presentation's ids too), and the map holds only its own.
        // One id per object: a selection that gathered an object under both of its ids keeps one.
        const kept = new Set<THREE.Object3D | string>();
        store.shell.selectMultiple(
          selected.filter((id) => {
            const object = store.objectMap.get(id) ?? threeObject(adapter.hierarchy, id);
            if (object === null && !store.objectMap.has(id)) return false;
            const key = object ?? id;
            if (kept.has(key)) return false;
            kept.add(key);
            return true;
          }),
        );
        store.notifyIngestObjectMapEdit();
        documentSession.syncSelectionPresentation();
        activateInteraction?.();
        setError(null);
        if (!chromeless) notifyWorkspaceDocumentSelectionChanged(documentId);
        let nativeBackground = scene.background;
        documentSession.setNeutralBackground(nativeBackground ?? host.defaultBackground);
        const retainedPresentation = retainedState.presentation;
        if (retainedPresentation) {
          documentSession.setMode(retainedPresentation.mode);
          documentSession.setBackground(retainedPresentation.background);
          documentSession.setProjection(retainedPresentation.projection);
          documentSession.setSkeleton(retainedPresentation.skeleton);
          documentSession.setBounds(retainedPresentation.bounds);
          retainedState.presentation = null;
        }
        // The document's world dressing lives on its OWN scene, nested inside the
        // rendered `host.scene`. Every draw of the rendered scene mirrors it out
        // first — the viewport frame and every offscreen photograph alike — so a
        // capture can never show the dressing the last viewport tick happened to
        // leave behind. The session runs this before it renders; nothing else may
        // hold a second copy of this field list.
        const syncHostScene = () => {
          // A document draws through its session's camera, which the viewport's own frame
          // does not know is orthographic.
          host.viewport?.alignGridToView(documentSession.camera(), renderer.domElement.width);
          host.scene.environment = scene.environment ?? host.defaultEnvironment;
          host.scene.fog = scene.fog;
          host.scene.environmentIntensity = scene.environmentIntensity;
          host.scene.environmentRotation.copy(scene.environmentRotation);
          host.scene.backgroundIntensity = scene.backgroundIntensity;
          host.scene.backgroundBlurriness = scene.backgroundBlurriness;
          host.scene.backgroundRotation.copy(scene.backgroundRotation);
          // The source this draw lights by. A `studio` view lights by its preset alone: the
          // stage's own environment at the preset's strength, its camera-locked lights turned
          // with the camera, and the content's own lights dark for this draw only (restored
          // after it, so nothing that saves the document ever sees them changed).
          const rig = host.presentationRig;
          if (rig) {
            const drawSource = rig.resolveSource({ ...host.contentHas, environment: scene.environment !== null });
            const environment = rig.environment();
            if (environment) {
              host.scene.environment = environment.texture ?? host.defaultEnvironment;
              host.scene.environmentIntensity = environment.intensity;
              host.scene.environmentRotation.set(0, environment.rotation, 0);
            }
            // What is drawn behind the scene: the stage's own backdrop (the look's fill, or the
            // scene's own as mirrored above) unless the view names another.
            const backdrop = rig.backdrop();
            if (backdrop !== 'keep') {
              host.scene.background = backdrop.value;
              host.scene.backgroundBlurriness = backdrop.blur;
              host.scene.backgroundIntensity = backdrop.intensity;
              host.scene.backgroundRotation.set(0, backdrop.rotation, 0);
              host.backdropOverridden = true;
            } else if (host.backdropOverridden) {
              host.scene.background = documentSession.neutralBackgroundTexture();
              host.scene.backgroundBlurriness = scene.backgroundBlurriness;
              host.scene.backgroundIntensity = scene.backgroundIntensity;
              host.backdropOverridden = false;
            }
            const documentStudio = drawSource === 'studio' && rig.presetId() === DOCUMENT_STUDIO_PRESET.id;
            if (host.documentStudio) host.documentStudio.visible = documentStudio;
            // The document's own studio manages its scene's lights itself (Blender stands them
            // down for modelling and up for a render).
            // A studio lights alone; a preview ADDS to the scene's other lights (Godot's preview
            // sun gives way only to a directional light, which `auto` weighs).
            // A preview without the scene's lights (Blender's Material Preview) darkens them too.
            const darkened =
              (drawSource === 'studio' && !documentStudio) || (drawSource === 'preview' && !rig.sceneLightsShown())
                ? host.darkenContentLights()
                : 0;
            rig.update(documentSession.camera());
            reportViewDraw(documentId, {
              source: drawSource,
              presetId: rig.presetId(),
              presetLights: rig.lightsVisible(),
              documentStudio: host.documentStudio ? host.documentStudio.visible : null,
              contentLights: host.contentLights.length,
              contentLightsDarkened: darkened,
              environmentIntensity: host.scene.environmentIntensity,
              environmentImage: rig.imageReport().shown,
              environmentImagePending: rig.imageReport().pending,
              toneMapping: String(renderer.toneMapping),
            });
          }
          if (nativeBackground !== scene.background) {
            nativeBackground = scene.background;
            documentSession.setNeutralBackground(nativeBackground ?? host.defaultBackground);
          }
        };
        host.syncHostScene = syncHostScene;
        documentSession.setBeforeRender(() => host.syncHostScene?.());
        // This loop draws the compass and every other overlay pass over the
        // document's own render, so it — and only it — can serve the chrome
        // door a frame that matches the screen.
        documentSession.setPresentsFrames(true);
        // THE CONTENT-TIME DOOR, re-created in Step 3 with exactly one caller
        // (the transport's `tick` below). The mixer line the deleted estate
        // had here is gone for good: subjects seek THEMSELVES, so content time
        // is only ever the bookkeeping plus the source's own update.
        const advanceContent = (deltaSeconds: number): void => {
          if (disposed || !(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return;
          host.contentSeconds += deltaSeconds;
          host.transportAdvances++;
          source.update?.(deltaSeconds);
        };
        // What this stage can show at a time. Scanned once here; the world
        // root's stage rescans (below) because its tree arrives later.
        const clipScan = scanClipSubjects(source.root, host.transport);
        host.cleanups.push(() => clipScan.dispose());
        const retainedTransport = retainedState.transport;
        if (retainedTransport) {
          if (retainedTransport.activeSubject)
            host.transport.setActiveSubject(retainedTransport.activeSubject);
          host.transport.setLoop(retainedTransport.range.loop);
          host.transport.setTimeScale(retainedTransport.timeScale);
          host.transport.seek(retainedTransport.time);
          if (retainedTransport.playbackState === 'playing') host.transport.play();
          else if (retainedTransport.playbackState === 'paused') host.transport.pause();
          retainedState.transport = null;
        }
        let previousTime = performance.now();
        // DRAWING ON CHANGE. A source that announces its changes
        // (`ToolObject3DPreviewSource.onChange`) is drawn only when something
        // changed; one that does not is drawn every frame, as before. The loop
        // itself still runs every frame -- transport, controls, flights and
        // presence advance there -- and what is skipped is the render: the
        // scene, the composer's passes and the compass. MEASURED before: an
        // idle Model document spent 43% of the main thread drawing the same
        // picture (4 s at load ~30: 372 frames, 1.7 s in the loop, 0.18 s of
        // it WebGL calls, the rest three's render and the outline passes).
        //
        // What draws a frame: the content's own announcement; the stage
        // store; pointer, wheel and key input on the stage (hover and gizmo
        // highlights follow the pointer); the editor acting on a stage from
        // outside those (`stage-invalidation.ts`); a moved camera or a resized
        // surface; playback; a flight or a pending photograph
        // (`needsFrame`); another participant's markers; particle systems;
        // and an interaction extension that refines every frame.
        const drawsOnChange = typeof source.onChange === 'function';
        let dirty = true;
        const markDirty = (): void => {
          dirty = true;
        };
        if (drawsOnChange) {
          const stopSource = source.onChange!(markDirty);
          const stopStore = store.shell.subscribe(markDirty);
          const inputs = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'wheel', 'keydown', 'keyup'] as const;
          for (const type of inputs) container.addEventListener(type, markDirty, { capture: true, passive: true });
          stopDrawSignals = () => {
            stopSource();
            stopStore();
            for (const type of inputs) container.removeEventListener(type, markDirty, { capture: true });
          };
        }
        let drawnGeneration = -1;
        const drawnCamera = new THREE.Matrix4();
        const drawnProjection = new THREE.Matrix4();
        const drawnSize = new THREE.Vector2();
        const currentSize = new THREE.Vector2();
        let drawnBackground: unknown = undefined;
        let drawnToneMapping: THREE.ToneMapping | null = null;
        let drawnExposure = Number.NaN;
        const mustDraw = (advanced: number): boolean => {
          if (!drawsOnChange || dirty || advanced > 0) return true;
          if (stageGeneration() !== drawnGeneration) return true;
          if (documentSession.needsFrame() || host.presence?.live()) return true;
          if (interactionExtension?.prepareFrame || interactionExtension?.update) return true;
          if (((viewport.batchedRenderer as unknown as { batches?: readonly unknown[] }).batches?.length ?? 0) > 0)
            return true;
          const camera = documentSession.camera();
          camera.updateMatrixWorld();
          renderer.getDrawingBufferSize(currentSize);
          return !camera.matrixWorld.equals(drawnCamera) ||
            !camera.projectionMatrix.equals(drawnProjection) ||
            !currentSize.equals(drawnSize) ||
            host.scene.background !== drawnBackground ||
            renderer.toneMapping !== drawnToneMapping ||
            renderer.toneMappingExposure !== drawnExposure;
        };
        const noteDrawn = (): void => {
          dirty = false;
          drawnGeneration = stageGeneration();
          const camera = documentSession.camera();
          drawnCamera.copy(camera.matrixWorld);
          drawnProjection.copy(camera.projectionMatrix);
          renderer.getDrawingBufferSize(drawnSize);
          drawnBackground = host.scene.background;
          drawnToneMapping = renderer.toneMapping;
          drawnExposure = renderer.toneMappingExposure;
        };
        const animate = (time: number, resumed: boolean) => {
          if (disposed || !renderer || !viewport) return;
          const activeRenderer = renderer;
          const activeViewport = viewport;
          const profiler = documentSession?.profiler;
          profiler?.beginFrame();
          if (resumed) previousTime = time;
          const delta = Math.min((time - previousTime) / 1000, 0.1);
          previousTime = time;
          profiler?.beginPhase();
          // CONTENT TIME moves ONLY through the stage transport, and only
          // while a human is holding it: `tick` is inert unless playing and
          // the editor drives, and it returns exactly the seconds it advanced.
          const advanced = host.transport.tick(delta);
          if (advanced > 0) advanceContent(advanced);
          interactionExtension?.prepareFrame?.(delta);
          interactionExtension?.update?.(delta);
          profiler?.endPhase('animation');
          profiler?.beginPhase();
          host.presence?.syncMarkers(delta);
          viewport.update(delta);
          // This stage's frame hook. After viewport.update, the same order the
          // scene panel uses, so anything riding the loop (a camera flight)
          // has final say over the pose and orbit damping never fights it.
          if (!chromeless) runViewportFrame(documentId, delta);
          viewport.batchedRenderer.update(delta);
          profiler?.endPhase('editor');
          if (!resumed && !mustDraw(advanced)) {
            profiler?.endFrame();
            return;
          }
          profiler?.beginPhase();
          activeRenderer.info.reset();
          const timeFirstRender =
            !firstFrameGateRef.current && activeViewportBreakdownDocumentId() === documentId;
          if (timeFirstRender) markViewportFirstRenderStart(documentId);
          const tFirstRender = timeFirstRender ? Date.now() : 0;
          const presentationOverride = host.scene.overrideMaterial;
          const mode = documentSession.presentation().mode;
          if (mode !== 'uv' && mode !== 'vertex-colors')
            host.scene.overrideMaterial = scene.overrideMaterial;
          try {
            activeViewport.renderWithInfrastructure(() => {
              documentSession.renderViewport(delta);
              activeViewport.renderViewCube(activeRenderer);
            });
          } finally {
            host.scene.overrideMaterial = presentationOverride;
          }
          // Inside the frame that drew them — the canvas has no
          // preserveDrawingBuffer, so this is the only moment its pixels exist.
          documentSession.servePresentedFrame();
          noteDrawn();
          if (!firstFrameGateRef.current) {
            firstFrameGateRef.current = true;
            if (timeFirstRender) markViewportSegment('first-render', Date.now() - tFirstRender);
            recordViewportFirstFrame(documentId);
            setSurfaceStatus('ready');
          }
          profiler?.reportRender({
            gpuMs: null,
            drawCalls: activeRenderer.info.render.calls,
            triangles: activeRenderer.info.render.triangles,
            geometries: activeRenderer.info.memory.geometries,
            textures: activeRenderer.info.memory.textures,
          });
          profiler?.endPhase('render');
          profiler?.endFrame();
          // THE SHELL'S READOUT IS THE FOCUSED STAGE'S (ARCHITECTURE-CORE
          // §One stage unit 4). `CameraInfo` and `StatsOverlay` read one
          // struct the shell owns; the stage the panels are following fills
          // it, so a model or prefab document reports ITS frame and ITS
          // camera. Inactive documents leave the shared readout alone.
          const shellReadout = shellStatsRef.current;
          if (shellReadout && shellStore && focusedStageStore(shellStore.shell) === store.shell) {
            const pose = documentSession.cameraPose();
            shellReadout.frameTime = delta * 1000;
            shellReadout.fps = delta > 0 ? 1 / delta : 0;
            shellReadout.drawCalls = activeRenderer.info.render.calls;
            shellReadout.triangles = activeRenderer.info.render.triangles;
            shellReadout.cameraPosition.x = pose.position[0];
            shellReadout.cameraPosition.y = pose.position[1];
            shellReadout.cameraPosition.z = pose.position[2];
            shellReadout.cameraTarget.x = pose.target[0];
            shellReadout.cameraTarget.y = pose.target[1];
            shellReadout.cameraTarget.z = pose.target[2];
          }
        };

        host.frame = animate;
        rendererSessionRef.current = host.rendererSession;
        if (!host.initialized) {
          if (!chromeless) {
            // --- The viewport door (viewport-door.ts) ---
            // This host is ONE STAGE among the mounted 3D documents
            // (ARCHITECTURE-CORE §One stage), and it binds under the id of the
            // document it draws, so an SDK reader reaches THIS stage's rig,
            // helper sink and frame loop through the viewport door's `viewportStages()`.
            // It presents no live roots yet — Play's adoption is the world
            // root's, and moves onto this host in unit 3 — so the presenter
            // declines every root rather than pretending to a subject.
            // A CHROMELESS mount (the inspector's object preview) binds
            // nothing: it is a thumbnail of a document, not a stage of its own,
            // and several can be alive for one document id at once.
            host.cleanups.push(
              bindViewportRig(
                {
                  camera: viewport.camera,
                  drawCamera: () => host.session?.camera() ?? viewport.camera,
                  orbit: viewport.orbitControls,
                  scene: host.scene,
                },
                () => null,
                (kind, object) => viewport.setHelper(kind, object),
                { documentId },
              ),
            );
            // --- The other participants, on THIS stage ---
            // Presence was the scene panel's, so only the world root had it.
            // It is a capability with a condition — a stage painting a three
            // surface — and a `build` stage always paints one, so every
            // document with chrome mounts it and a prefab story shows the
            // same camera frusta, selection boxes and pointer rays the Scene
            // does (ARCHITECTURE-CORE §One stage; WORK.md §Presence and the
            // substrate, presence unit 4). Dynamically imported: it reaches
            // the collaboration client, which a bounded host must not pay for.
            void import('./stage-presence-markers').then((markers) => {
              if (host.isClosed || documentHostRef.current !== host || host.presence) return;
              const binding = markers.bindStagePresenceMarkers({
                // The HOST's scene, not this revision's content scene: a
                // source update swaps the content and the markers must not go
                // with it.
                scene: host.scene,
                store,
                documentId,
                container,
                canvas,
                viewport,
                readVisibleCameraPose: () => {
                  const camera = host.session?.camera() ?? viewport.renderCamera;
                  const position = camera.getWorldPosition(new THREE.Vector3());
                  const fov = (camera as THREE.PerspectiveCamera).fov;
                  return {
                    position,
                    target: viewport.orbitControls.target,
                    fov: typeof fov === 'number' ? fov : 0,
                  };
                },
              });
              host.presence = binding;
              host.cleanups.push(() => binding.dispose());
            });
            host.cleanups.push(
              registerObject3DDocumentSession(documentSession, threeStageTransformChrome(documentId)),
            );
            host.cleanups.push(
              registerPerformanceSource({
                id: documentId,
                label: displayName,
                kind: assetSubject ? 'asset' : 'source',
                profiler: documentSession.profiler,
              }),
            );
          }
          // EXACTLY ONE registrar of this document's workspace selection: the
          // identity-row shell does it through its own `selection` prop, so
          // the host does it wherever that shell is absent. The condition was
          // `!studioStage` while the shell and the studio were the same
          // answer; they parted when a DATA subject gained the studio
          // (§A model is data), and reading the old one left the Model
          // document with NEITHER registrar — the Hierarchy said "No
          // authoring adapter" and the mesh inspector emptied (measured live
          // on the models scaffold, 2026-09-18).
          if (!chromeless && !hasShell) {
            host.cleanups.push(
              registerWorkspaceDocumentSelection(documentId, () => ({
                adapter: host.adapter!,
                nodeId: host.adapter?.selection?.get()[0] ?? null,
              })),
            );
          }
          const designTimeSurfaceId = chromeless
            ? `${documentId}#chromeless-${++chromelessSurfaceSequence}`
            : documentId;
          host.cleanups.push(
            registerDesignTimeSurface({
              id: designTimeSurfaceId,
              label: displayName,
              contentClock: () => host.contentSeconds,
              transportAdvances: () => host.transportAdvances,
            }),
          );
          // THE VIEWPORT ACTION BUS, on a document stage. The world root has
          // answered these since the scene panel existed; a document stage
          // never did, which is why Frame (`F`) was inert on a prefab or a
          // model — the hotkey pushes `focus-selection` onto the stage's own
          // store and nothing was listening (ARCHITECTURE-CORE §One stage:
          // the capability is present wherever its condition holds).
          host.cleanups.push(
            store.shell.onViewportAction((action) => {
              switch (action.type) {
                case 'focus-selection':
                case 'focus-scene':
                  // The session frames the selection, else the whole subject,
                  // and says so on the console when there is nothing to frame.
                  if (!host.session?.frame() && host.session?.root)
                    viewport.focusOn(host.session.root);
                  break;
                case 'focus-entity': {
                  const object = host.adapter ? threeObject(host.adapter.hierarchy, action.id) : null;
                  if (object) viewport.focusOn(object);
                  break;
                }
                case 'snap-selection-to-floor':
                  viewport.snapSelectionToFloor();
                  break;
                case 'set-view-preset':
                  // A mounted document draws with its own camera pair, so the preset is its
                  // (the relay's `view-preset` routes the same way); the viewport's own
                  // projection would change a camera nobody draws with.
                  if (host.session)
                    host.session.setViewPreset(action.preset === 'perspective' ? 'isometric' : action.preset, 'view');
                  else viewport.setViewPreset(action.preset);
                  break;
                case 'toggle-camera-view':
                  host.session?.toggleCameraView();
                  break;
                case 'step-view':
                  // A camera view's orbit is the lock's to make (Blender cancels it otherwise).
                  if (host.session?.cameraView()) break;
                  viewport.stepView(action.step);
                  break;
                case 'toggle-projection': {
                  // A camera view has its camera's projection, as the cluster's toggle does.
                  const session = host.session;
                  if (session?.cameraView()) break;
                  const drawn = session ? session.projection() : viewport.projection;
                  const next = drawn === 'perspective' ? 'orthographic' : 'perspective';
                  if (session) session.setProjection(next);
                  else viewport.setProjection(next);
                  break;
                }
                case 'set-camera-pose':
                  viewport.setPose(action.position, action.target, action.fov);
                  break;
              }
            }),
          );
          let selectionSignature = '';
          host.cleanups.push(
            store.shell.subscribe(() => {
              viewport.objectMap = store.objectMap;
              viewport.syncFromStore();
              host.session?.syncSelectionPresentation();
              const next = (host.adapter?.selection?.get() ?? []).join('\u0000');
              if (next !== selectionSignature) {
                selectionSignature = next;
                if (!chromeless) notifyWorkspaceDocumentSelectionChanged(documentId);
              }
            }),
          );
          const resize = () => {
            const width = Math.max(1, container.clientWidth);
            const height = Math.max(1, container.clientHeight);
            const ratio = renderer.getPixelRatio();
            if (
              canvas.width !== Math.floor(width * ratio) ||
              canvas.height !== Math.floor(height * ratio)
            )
              renderer.setSize(width, height, false);
            viewport.resize(width, height);
            host.session?.resize(width, height);
            host.rendererSession.redraw();
          };
          const observer = new ResizeObserver(resize);
          observer.observe(container);
          host.cleanups.push(() => observer.disconnect());
          resize();
          host.initialized = true;
          markViewportConstructReady();
        }
        viewport.objectMap = store.objectMap;
        viewport.syncFromStore();
        host.rendererSession.setActive(activeRef.current);
        host.rendererSession.redraw();
        published = true;
        // Old graph stays owned until the new binding is fully published.
        void previous?.dispose();
      } catch (caught) {
        if (!published) {
          try {
            rollback?.();
          } finally {
            if (sourceParent && source.root.parent === scene) sourceParent.add(source.root);
            void binding.dispose();
          }
        }
        // Candidate construction leaves the last good binding and pixels live.
        // biome-ignore lint/suspicious/noConsole: source failure must remain diagnosable
        console.error(`[object3d document] ${displayName}: source update failed`, caught);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    const update = contentUpdateTail.current.then(install);
    contentUpdateTail.current = update.catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [
    authoring,
    background,
    build,
    cameraX,
    cameraY,
    cameraZ,
    displayName,
    documentId,
    studioStage,
    dressingBackground,
    dressingEnvironment,
    dressingGrid,
    dressingKeyLight,
    dressingViewLocked,
    dressingToneMapping,
    chromeless,
    modelSourceEntityId,
    modelSourceKind,
    modelSourcePath,
    interaction,
    persistence,
    documentSource,
    rendererLane,
    retainedState,
    surfaceAttached,
    sourceAuthoring,
    sourcePath,
    worldRoot,
  ]);

  useEffect(() => {
    const session = rendererSessionRef.current;
    const becameActive = active && !previousActiveRef.current;
    previousActiveRef.current = active;
    if (!session) return;
    if (becameActive) {
      firstFrameGateRef.current = false;
      markViewportRafResume(documentId);
    }
    // A world root keeps its clock while another document holds focus.
    session.setActive(active || worldRoot);
  }, [active, documentId, worldRoot]);

  // The stage's own handle for the capabilities that drive it directly (the
  // viewport hotkeys). `surfaceStatus` is what re-renders once the stage has
  // finished building, so reading the ref here is safe and never stale.
  const host = documentHostRef.current;
  const stageHandle =
    surfaceStatus === 'ready' && host?.viewport
      ? { store: host.store, viewport: host.viewport, canvas: host.surface.canvas }
      : null;
  // The document's own selection changes as you pick inside it; the registry
  // reads this on demand, so the picked part follows without re-registering.
  // With nothing picked the DOCUMENT NODE is the subject — the same reading
  // as clicking a model's root in the scene.
  const readSelection = useCallback(() => {
    const owner = documentAdapterRef.current;
    return owner
      ? {
          adapter: owner,
          nodeId: owner.selection?.get()[0] ?? owner.hierarchy.roots()[0]?.id ?? null,
        }
      : null;
  }, []);
  const viewport = (
    <div
      data-testid="tool-object3d-authoring"
      data-vgai-chromeless={chromeless || undefined}
      className={studioStage ? 'vgai-object3d-studio-stage' : undefined}
      style={{
        position: chromeless || hasShell ? 'relative' : 'absolute',
        // Inside the Asset Editor shell the stage fills its own box exactly;
        // in a bare dock panel it bleeds under the panel's padding.
        ...(chromeless
          ? { width: '100%', height: '100%' }
          : hasShell
            ? { flex: 1, minHeight: 0 }
            : { inset: -STAGE_BLEED_PX }),
        overflow: 'hidden',
        // Asset documents paint the shared studio stage through their class.
        // An inline background here would win the cascade and hide it.
        background: studioStage ? undefined : themeVars.surface.raised,
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, minHeight: 0, overflow: 'hidden' }}
      >
        <ViewportSurface canvasHostRef={canvasHostRef} />
        {/* WHICH KEYS THIS STAGE ANSWERS — the transform modes, the view
            presets, Frame, pivot, snap. Beside the stage rather than inside
            the overlay set, because a package-contributed document mounts
            with no shell above it and reached none of them
            (`stage-keyboard.tsx`). The registry holds ONE stage's set, so the
            condition is the ACTIVE document's stage. */}
        {active && stageHandle && !chromeless ? (
          <Suspense fallback={null}>
            <LazyStageKeyboard stage={stageHandle} />
          </Suspense>
        ) : null}
        {/* The stage's own overlays, co-located with the canvas the way
            `RootSelectionOverlay`'s DOM contract requires (its marquee is
            measured against this container's box). A stage with no shell
            above it — a bounded host — renders none of them and never loads
            them. */}
        {shellStore && !chromeless ? (
          <StageOverlays
            store={shellStore}
            documentId={documentId}
            stage={stageHandle}
            active={active}
            chrome="document"
          />
        ) : null}
        {shellStore && worldRootBinding ? (
          <worldRootBinding.Overlays
            store={shellStore}
            documentId={documentId}
            cameraPreviewRef={cameraPreviewRef}
            mountStatus={designMountStatus}
            rootIds={designRootIds}
          />
        ) : null}
        {/* A ROLLED-BACK operation (an animation write, a capture, a source
            write the history guarded) — every writer of `error` restores the
            prior state, so the surface below is live and must stay visible.
            It used to mount a full-bleed opaque curtain with no dismiss: the
            stage read as dead until the session restarted (measured). A
            notice over the stage, dismissible, and cleared by the next
            gesture that succeeds. */}
        {error && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              insetInline: 0,
              top: 0,
              display: 'flex',
              justifyContent: 'center',
              padding: 'var(--vgai-space-3)',
              pointerEvents: 'none',
            }}
          >
            <div
              className="vgai-chrome-island"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--vgai-space-3)',
                maxWidth: '80%',
                padding: 'var(--vgai-space-2) var(--vgai-space-3)',
                borderRadius: 'var(--vgai-radius-md)',
                border: `var(--vgai-stroke-resting) solid ${themeVars.semantic.danger}`,
                background: themeVars.surface.raised,
                color: themeVars.semantic.danger,
                pointerEvents: 'auto',
              }}
            >
              <span>{error}</span>
              <IconButton
                size="compact"
                aria-label="Dismiss"
                onClick={() => setError(null)}
                data-testid="object3d-document-error-dismiss"
              >
                <EditorIcon icon={editorIcons.action.close} />
              </IconButton>
            </div>
          </div>
        )}
        {!error && surfaceStatus === 'building' && (
          <ViewportSurfaceStatus testId="object3d-document-status">
            {OBJECT3D_SURFACE_BUILDING}
          </ViewportSurfaceStatus>
        )}
        {/* The stage BLEEDS 12px under the dock panel's padding (`inset: -12`
            above) so the rendered image fills it edge to edge. The furniture is
            CHROME, not image: it has to sit inside the panel the person can
            actually see, so it gets that bleed back. Without this the view text
            started at page x=-6 — the "U" of "User Perspective" was clipped off
            the window — and the navigation cluster's right edge landed 4px past
            the panel, under the Inspector's section rail (both measured). */}
        <div
          style={{
            position: 'absolute',
            inset: chromeless || hasShell ? 0 : STAGE_BLEED_PX,
            pointerEvents: 'none',
          }}
        >
          {!chromeless && surfaceStatus === 'ready' && documentHostRef.current && (
            <ViewportFurniture
              viewport={documentHostRef.current.viewport}
              session={documentHostRef.current.session}
              store={documentHostRef.current.store.shell}
              projection={projection}
              displayName={displayName}
              {...(statistics ? { statistics } : {})}
              {...(subject !== undefined ? { subject } : {})}
              {...(gridScale ? { gridScale } : {})}
              objectName={(id) =>
                ((adapter) => (adapter ? threeObject(adapter.hierarchy, id)?.name : undefined))(documentHostRef.current?.adapter) ??
                // Document builders may supply names through their store index.
                documentHostRef.current?.store.objectMap.get(id)?.name ??
                null
              }
            />
          )}
        </div>
      </div>
    </div>
  );
  if (!hasShell) return viewport;
  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type={assetType ?? (modelSourceEntityId ? 'entity' : 'model')}
      title={displayName}
      status={sourcePath}
      selection={readSelection}
      fill
    >
      <div className="vgai-object3d-asset-workspace">
        {viewport}
        {/* Where the deleted preview strip was. It draws nothing until this
            stage's transport has a subject, so a document with nothing to show
            at a time is unchanged. */}
        <TransportStrip transport={documentHostRef.current?.transport ?? null} />
      </div>
    </AssetEditorShell>
  );
}

/** Public project contribution surface over the editor's native Object3D document host. */
export function ToolObject3DAuthoring(props: ToolObject3DAuthoringProps) {
  return <Object3DDocumentViewport {...props} />;
}
