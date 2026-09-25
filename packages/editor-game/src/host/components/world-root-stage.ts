/**
 * THE WORLD ROOT'S CONTENT BINDING — what the one stage host shows when its
 * `content` is `{ kind: 'world-root' }` (ARCHITECTURE-CORE §One stage).
 *
 * This is the scene panel's whole body, moved: the design session that mounts
 * the manifest's three roots, the composer that draws them (the world's own
 * image pipeline, the shading modes, the soft-particle depth pass, the
 * adopted-image config), the camera-authoring host, the viewport action bus,
 * the auto-frame window, and the presenter Play adopts through
 * (`viewport-root-presentation.ts`). A `build` binding shows one Object3D the
 * project constructed; THIS one shows the project's world, and Play adoption
 * is the condition on it — a build binding presents nothing.
 *
 * WHY IT IS A SEPARATE MODULE, and loaded by dynamic import:
 * `scripts/validate-editor-closure.mjs` pins the host because a BOUNDED HOST
 * (`@volter/editor-blender`'s Model document) mounts it with no shell above it. Everything below reaches the shell's own estate — its transport
 * (`editor-api.ts`), the collaboration client, the server-log bridge, the
 * command listener, the world-adapter install. Static imports would have put
 * all of that into every stage's closure, which is exactly the erosion that
 * ratchet exists to stop. The condition that selects this content gates its
 * LOAD too.
 */

import {
  registerStartingPresentation,
  registerStudioPreset,
  type StudioPreset,
} from '@volter/editor-sdk/kit/viewport-presentation';
import type { ViewportPresentation, ViewportRoot } from '@volter/editor-sdk/host';
import { themeVars } from '@volter/editor-sdk/widgets';
import { createPerformanceProfiler } from '@volter/game-runtime/dev/performance-profiler';
import { createWebGLGpuTimer } from '@volter/game-runtime/dev/webgl-gpu-timer';
import type { AuthoringAdapter, Transform } from '@volter/editor-project/adapter';
import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import { applyWorldRendererConfig } from '@volter/threejs-runtime/adapter/renderer-config';
import { getUserData } from '@volter/threejs-runtime/ecs/user-data';
import { detectKtx2Support } from '@volter/threejs-runtime/loader';
import { resolveRenderSettings } from '@volter/threejs-runtime/render/render-settings';
import { createSoftParticleDepthPass } from '@volter/threejs-runtime/render/soft-particle-depth';
import { ViewportShadingRenderer } from '@volter/threejs-runtime/render/viewport-shading';
import {
  applyRendererSettings,
  applySceneRenderPipeline,
} from '@volter/threejs-runtime/setup/setup-renderer';
import {
  BlendFunction,
  EffectComposer,
  EffectPass,
  KernelSize,
  OutlineEffect,
  type Pass,
} from 'postprocessing';
import * as THREE from 'three';
import { getActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import type { CompositeAuthoringAdapter } from '@volter/editor-core/authoring/composite-authoring-adapter';
import {
  applyAuthoringTransform,
  beginAuthoringTransformEdit,
  endAuthoringTransformEdit,
} from '@volter/editor-core/authoring/consumer-actions';
import { designTimeMountFor } from '@volter/editor-core/authoring/design-time-mount-registry';
import { attachProjectAuthoringStage } from '@volter/editor-core/authoring/project-authoring-session';
import {
  isThreejsSurfaceVisible,
  resolveThreeViewportRootId,
} from '@volter/editor-core/authoring/world-hidden-viewport';
import { AutoFrameWindow } from '../auto-frame-window';
import {
  type CameraAuthoringSubject,
  type CameraViewMode,
  cameraAuthoringPresentation,
  installCameraAuthoringHost,
} from '@volter/editor-core/camera-authoring';
import { registerPresentedCanvasFrame } from '@volter/editor-core/canvas-preview-frames';
import { collectState } from '@volter/editor-core/command-listener';
import { getDownloadedAssetPath, getOnlineAssetFiles, reportEditorState } from '@volter/editor-core/editor-api';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { isEditorPresentationActive } from '@volter/editor-sdk/kit/editor-presentation-activity';
import type { EditorStats } from '@volter/editor-core/editor-runtime';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { EditorViewport, type OnlineAssetDrop } from '@volter/editor-core/editor-viewport';
import { entityObject3D } from '@volter/editor-core/entity-object';
import {
  nativeSelectionColors,
  nativeViewportLook,
  subscribeNativeSelectionTheme,
} from '@volter/editor-sdk/kit/native-selection-style';
import { registerPerformanceSource } from '@volter/editor-core/performance-sources';
import { drawSceneUnlessRefused } from '../scene-view-drawability';
import { withSceneFogNeutralized } from '@volter/editor-core/scene-view-fog';
import { connectServerLogs } from '../server-log-bridge';
import { focusedStageStore } from '@volter/editor-core/stage-context';
import {
  acquireThreeSelectionOutline,
  releaseThreeSelectionOutline,
  setThreeSelectionOutlineColors,
  syncThreeSelectionOutline,
} from '@volter/editor-core/three-viewport/selection-outline';
import {
  setThreeViewportProjection,
  subscribeThreeViewportPresentation,
  threeViewportPresentation,
} from '@volter/editor-core/three-viewport-presentation';
import { recordViewportFirstFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { savedViewportPose, saveViewportPose } from '../viewport-pose-memory';
import { presentThreeRoots } from '../viewport-root-presentation';
import { isEditorViewportShadingTarget } from '@volter/editor-core/viewport-shading-boundary';
import { downloadOnlineAssetWithHistory } from '@volter/editor-core/components/asset-editor-persistence';
import { bindStagePresenceMarkers } from '@volter/editor-core/components/stage-presence-markers';

/** Everything the world root's stage hands its medium's design session: the stage's own three
 *  handles. The stage and the medium that registered for `three` agree on it; the kit's mount
 *  registry types it `unknown`. */
export interface WorldRootSessionContext {
  /** The shell store the session's adapter is built over. */
  readonly store: EditorShellStore;
  /** The edit-mode composite the session swaps its own child adapter into. */
  readonly composite: CompositeAuthoringAdapter;
  /** The stage's renderer — the session adopts it rather than building one. */
  readonly renderer: THREE.WebGLRenderer;
}

/**
 * THE WORLD STAGE'S STARTING PRESENTATION. Its studio is the light the world has always been
 * shown by — the viewport's own ambient (0.5) and directional (1.0 from (10, 20, 10)), with no
 * key and no image-based light of its own (the world's environment is the game's) — and it gives
 * way to the scene's own whenever a live scene is adopted, as that rig always has.
 */
const WORLD_STUDIO: StudioPreset = {
  id: 'world',
  title: 'World',
  lights: [{ color: '#ffffff', intensity: 1, direction: [-10, -20, -10], space: 'world' }],
  ambient: { color: '#ffffff', intensity: 0.5 },
  environmentIntensity: 0,
};
const releaseWorldPresentation = [
  registerStudioPreset(WORLD_STUDIO),
  registerStartingPresentation('world', {
    all: {
      lighting: { source: 'studio', studioPreset: WORLD_STUDIO.id, auto: { takeover: ['light'], overridable: true } },
    },
  }),
];
if (import.meta.hot) import.meta.hot.dispose(() => releaseWorldPresentation.forEach((release) => release()));

/**
 * The world root's renderer, built to the ENGINE's own render settings —
 * opaque, high-performance, PCF soft shadows, KTX2 support taught to the
 * shared loader. The host's `build` lane constructs a small alpha renderer for
 * a studio stage instead; a stage's drawing surface belongs to what it draws.
 */
export function mountWorldRootSurface(
  canvasHost: HTMLDivElement,
  container: HTMLDivElement,
  displayName: string,
): { canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer; lease: null } {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', `${displayName} authoring viewport`);
  canvas.setAttribute('data-testid', 'editor-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.tabIndex = -1;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.pointerEvents = 'auto';
  canvasHost.appendChild(canvas);
  // Construct WebGL at the viewport's real backing size. The old 300x150
  // canvas default made the driver allocate once during context creation and
  // again immediately below; under SwiftShader that second cold allocation
  // alone is visible in the startup trace.
  const initialWidth = Math.max(1, container.clientWidth);
  const initialHeight = Math.max(1, container.clientHeight);
  const initialPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(initialWidth * initialPixelRatio);
  canvas.height = Math.ceil(initialHeight * initialPixelRatio);
  const renderer = markHostRenderer(
    new THREE.WebGLRenderer({
      canvas,
      antialias: Boolean(resolveRenderSettings(undefined)['antialias']),
      powerPreference: 'high-performance',
    }),
  );
  // Cap at 2, matching the runtime's own policy (create-runtime.ts) — an
  // uncapped 3x display renders 2.25x the pixels the game itself would.
  applyRendererSettings(renderer, undefined, initialPixelRatio);
  renderer.setSize(initialWidth, initialHeight);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  // Teach the shared KTX2Loader this GPU's compressed-format support, so a
  // KHR_texture_basisu GLB (including the Asset Budget's own KTX2 output)
  // loads in EDIT mode too, not only once a game runtime has booted.
  // Idempotent; see `detectKtx2Support` in the engine's loader.
  detectKtx2Support(renderer);
  return { canvas, renderer, lease: null };
}

export interface WorldRootStageOptions {
  /** The SHELL's store — the world root's stage runs on it until unit 4. */
  readonly store: EditorShellStore;
  readonly documentId: string;
  readonly container: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly stats: EditorStats;
  /** The camera-authoring preview pane, read per frame (a React ref). */
  readonly cameraPreview: () => HTMLDivElement | null;
  readonly onMountStatus: (status: 'mounting' | 'ready') => void;
  readonly onRootIds: (rootIds: readonly string[]) => void;
  /** This stage's frame hook on the per-stage viewport door — the host owns
   *  the door binding, so it hands the stage the call rather than the id. */
  readonly runFrame: (deltaSeconds: number) => void;
}

export interface WorldRootStage {
  readonly scene: THREE.Scene;
  readonly viewport: EditorViewport;
  frame(timeMs: number, resumed: boolean): void;
  present(roots: readonly ViewportRoot[]): ViewportPresentation | null;
  setHelper(kind: string, object: THREE.Object3D | null): void;
  dispose(): void;
}

/**
 * THE SHELL'S HALF of a viewport online-asset drop — installed as the gizmo
 * viewport's `onlineAssetResolver` so the viewport itself imports neither the
 * editor's transport (`editor-api.ts`) nor the project's download history
 * (`asset-editor-persistence.ts`). See `OnlineAssetResolver` in
 * `editor-viewport.ts` for the contract; this is its one production
 * implementation.
 *
 * Answers a PROJECT-LOCAL path, or `null` after reporting on the console why
 * it could not — the viewport stays quiet on `null` precisely because this
 * already spoke. A cached asset answers with the cache's own path; a fresh
 * download answers with the served, leading-slash form.
 */
async function resolveDroppedOnlineAsset(online: OnlineAssetDrop): Promise<string | null> {
  const cachedPath = getDownloadedAssetPath(online.source, online.id);
  if (cachedPath) return cachedPath;

  let url = online.url;
  let format = online.format ?? 'gltf';
  let includes = online.includes;
  if (!url) {
    // No URL in the drag payload: ask the source for its file options and take
    // the first, exactly as the asset browser's own import does.
    const file = (await getOnlineAssetFiles(online.source, online.id))[0];
    if (!file) {
      editorConsole.error(`No downloadable files for ${online.name}.`, 'asset');
      return null;
    }
    url = file.url;
    format = file.format;
    includes = file.includes;
  }

  const params: Parameters<typeof downloadOnlineAssetWithHistory>[0] = {
    source: online.source,
    id: online.id,
    name: online.name,
    url,
    format,
  };
  if (includes) params.includes = includes;
  const result = await downloadOnlineAssetWithHistory(params);
  if (result.ok && result.path) return `/${result.path}`;
  editorConsole.error(`Could not download ${online.name}.`, 'asset');
  return null;
}

function cameraObjectOf(object: THREE.Object3D): THREE.Camera | null {
  if ((object as THREE.Camera).isCamera) return object as THREE.Camera;
  const owned = getUserData(object, '_camera');
  return owned?.isCamera ? owned : null;
}

function cameraLensLabel(camera: THREE.Camera): string {
  const perspective = camera as THREE.PerspectiveCamera;
  if (perspective.isPerspectiveCamera) return `${perspective.fov.toFixed(0)}° perspective`;
  const orthographic = camera as THREE.OrthographicCamera;
  if (orthographic.isOrthographicCamera) return `Orthographic · ${orthographic.zoom.toFixed(2)}×`;
  return camera.type;
}

function cameraPoseCapability(
  adapter: AuthoringAdapter,
  id: string,
): { canAuthorPose: boolean; poseRefusal?: string } {
  const transforms = adapter.transforms;
  if (!transforms) {
    return { canAuthorPose: false, poseRefusal: 'This camera has no transform authoring path.' };
  }
  const position = transforms.editability?.(id, 'position') ?? { writable: true };
  const rotation = transforms.editability?.(id, 'rotation') ?? { writable: true };
  if (position.writable && rotation.writable) return { canAuthorPose: true };
  return {
    canAuthorPose: false,
    poseRefusal: position.reason ?? rotation.reason ?? 'This camera pose is read-only.',
  };
}

function cameraSubjectFor(
  adapter: AuthoringAdapter,
  objectMap: Map<string, THREE.Object3D>,
  id: string,
): CameraAuthoringSubject | null {
  // Camera authoring exists only in the adopted Edit scene, whose objectMap is
  // the authoritative live index. Do not ask a temporarily suspended
  // composite root to resolve stale Edit selection during play-stop handoff;
  // that boundary correctly refuses ids it does not own and would turn an
  // ordinary transition into an editor error.
  const object = objectMap.get(id) ?? null;
  if (!object) return null;
  const camera = cameraObjectOf(object);
  if (!camera) return null;
  return {
    id,
    name: object.name || camera.name || 'Camera',
    camera,
    lens: cameraLensLabel(camera),
    ...cameraPoseCapability(adapter, id),
  };
}

/**
 * `id -> tags` for the tag-referencing post effects (outline). Tags are read
 * from the format-neutral `userData['tags']` key — `@volter/threejs-runtime/ecs/scene-query`'s
 * canonical location, so every adapter's nodes carry them the same way.
 */
function buildEntityTagMap(store: EditorShellStore): Map<string, string[]> {
  const tagMap = new Map<string, string[]>();
  for (const [id, obj] of store.objectMap) {
    const tags = getUserData(obj, 'tags');
    if (Array.isArray(tags) && tags.length > 0) tagMap.set(id, tags);
  }
  return tagMap;
}

export function installWorldRootStage(options: WorldRootStageOptions): WorldRootStage {
  const { store, documentId, container, canvas, renderer, stats } = options;

  // --- Post-processing ---
  const composer = new EffectComposer(renderer);
  // Renderer-coupled scene depth belongs to the renderer that presents the
  // Scene document. The R3F design mount only constructs and settles the
  // live Object3D graph; its detached no-draw renderer cannot produce depth,
  // and its game camera is not the camera the editor is looking through.
  //
  // This pass is scene-generic: while no armed soft-particle renderer lives
  // under the displayed scene it returns before traversing or drawing. When
  // one does, it uses this viewport's real WebGL context and current camera.
  const softParticleDepth = createSoftParticleDepthPass();
  const viewportShading = new ViewportShadingRenderer();
  const profiler = createPerformanceProfiler();
  // Real GPU time for the viewport's own draw (EXT_disjoint_timer_query_
  // webgl2 — same instrument the play path wires in setup-three-root-
  // adapter). This loop used to hardcode `gpuMs: null`, which left the
  // Profiler's GPU tile permanently "n/a" in edit mode and made a
  // GPU-bound editor unexplainable from the panel. Results resolve a few
  // frames late; `poll()` reports the most recently RESOLVED query, never
  // an interpolation. Unsupported contexts stay honestly null.
  const gpuTimer = createWebGLGpuTimer(renderer.getContext());
  // Timing is gated on the profiler so a closed Profiler pays zero query
  // overhead; end() self-pairs with begin(), so the gate lives here alone.
  const drawTimed = (draw: () => void): void => {
    if (profiler.enabled) gpuTimer.begin();
    try {
      draw();
    } finally {
      gpuTimer.end();
    }
  };
  const pollGpuMs = (): number | null => (profiler.enabled ? gpuTimer.poll() : null);
  const unregisterPerformanceSource = registerPerformanceSource({
    id: documentId,
    label: 'Scene viewport',
    kind: 'scene',
    profiler,
  });

  // --- Scene ---
  const scene = new THREE.Scene();
  // The palette's viewport background when it carries one; the editor's own
  // grey otherwise. The viewport's look subscription (`EditorViewport`) paints
  // a palette's colour over it; this one gives the grey back when the next
  // palette names none, as long as the scene still wears what was painted (a
  // game may set its own background).
  const WORLD_BACKGROUND = 0xaaaaaa;
  let paintedBackground = nativeViewportLook(canvas).background ?? WORLD_BACKGROUND;
  scene.background = new THREE.Color(paintedBackground);
  const unsubscribeWorldBackground = subscribeNativeSelectionTheme(canvas, () => {
    const next = nativeViewportLook(canvas).background ?? WORLD_BACKGROUND;
    const current = scene.background;
    if (current instanceof THREE.Color && current.getHex() === paintedBackground)
      scene.background = new THREE.Color(next);
    paintedBackground = next;
  });

  // --- Bind store to scene ---
  store.bindScene(scene, renderer);

  // --- Viewport ---
  // Bind navigation to the whole authoring surface. A DOM selection layer
  // above the WebGL canvas must not disable right-drag orbit/fly controls.
  const viewport = new EditorViewport(canvas, scene, store, container, {
    renderer,
    onlineAssetResolver: resolveDroppedOnlineAsset,
    onProjectionChange: setThreeViewportProjection,
  });
  // The world is lit and dressed by its view's presentation (`kit/viewport-presentation`), as
  // a `world` stage: this module builds it, so it states how it starts (`WORLD_STUDIO` below).
  const unbindPresentation = viewport.bindPresentation(documentId, 'world');
  // Bind the REAL viewport camera + orbit target so store.cameraPose (the
  // `editor.viewport.camera.get` facet, see command-listener.ts's
  // collectState) and the thumbnail-capture path read live data instead of
  // null — previously bindScene's `camera` param was never passed here, so
  // `store.cameraPose` (and _captureThumbnail's camera read) stayed dark.
  store.bindScene(scene, renderer, viewport.batchedRenderer, viewport.camera);
  store.setOrbitTarget(viewport.orbitControls.target);
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const readVisibleCameraPose = () => {
    const camera = viewport.renderCamera;
    camera.getWorldPosition(cameraPosition);
    if (viewport.cameraViewMode === 'pilot') {
      cameraTarget.copy(viewport.orbitControls.target);
    } else if (!viewport.cameraViewMode) {
      cameraTarget.copy(viewport.orbitControls.target);
    } else {
      camera.getWorldDirection(cameraForward);
      cameraTarget.copy(cameraPosition).add(cameraForward.multiplyScalar(10));
    }
    const fov = (camera as THREE.PerspectiveCamera).fov;
    return {
      position: cameraPosition,
      target: cameraTarget,
      fov: typeof fov === 'number' ? fov : 0,
    };
  };
  // THE PRESENCE this stage publishes, and the markers it paints for the other
  // participants, are one module now (`stage-presence-markers.ts`) keyed by
  // THIS stage's document id — the world root's is the Scene document's.
  const presence = bindStagePresenceMarkers({
    scene,
    store,
    documentId,
    container,
    canvas,
    viewport,
    readVisibleCameraPose,
  });

  let lastPresenceCamera = '';
  // DEV/e2e hook: lets the per-game feature matrix assert the viewport camera
  // reframes (view presets / focus / orbit) on an ingested scene.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__vgaiViewport'] = viewport;
  }

  // --- Composer rebuild ---
  // The un-apply half of the adopted image config below. `applySceneRender-
  // Pipeline` re-derives toneMapping/exposure on every rebuild, but the
  // seam's other fields (outputColorSpace, shadowMap.type, clearColor) have
  // no re-derive path of their own — so each rebuild first runs the RESTORE
  // the previous apply returned, putting back exactly what that apply found.
  // Without this, an adoption ending (or a remount that drops the
  // declaration) would leave the previous world's colour space on the
  // editor's renderer until page reload.
  let restoreAdoptedImage: (() => void) | null = null;
  let selectionOutline: ReturnType<typeof acquireThreeSelectionOutline> | null = null;
  let selectionOutlinePass: EffectPass | null = null;
  let selectionOutlineUnderlayPass: Pass | null = null;
  const syncSelectionTheme = (): void => {
    if (selectionOutline)
      setThreeSelectionOutlineColors(selectionOutline, nativeSelectionColors(renderer.domElement));
  };
  const unsubscribeSelectionTheme = subscribeNativeSelectionTheme(
    renderer.domElement,
    syncSelectionTheme,
  );
  const syncSelectionOutline = (): void => {
    if (!selectionOutline) return;
    const adapter = getActiveAuthoring(store.shell);
    const roots = [...store.shell.selectedEntityIds]
      // Edit↔Play swaps the active child before its native graph is rebuilt.
      // Do not route a stale outgoing id through the composite during that
      // handoff: it is temporarily absent, not an ownership error.
      .filter((id) => adapter.hierarchy.node(id) !== null)
      .map((id) => entityObject3D(adapter, store.objectMap, id))
      .filter((object): object is THREE.Object3D => object !== null);
    syncThreeSelectionOutline(selectionOutline, roots);
    const active = selectionOutline.selection.size > 0;
    if (selectionOutlinePass) {
      selectionOutlinePass.enabled = active;
      selectionOutlinePass.renderToScreen = active;
    }
    // EffectComposer assigns screen ownership only when passes are added;
    // toggling its final pass later does not promote the preceding pass.
    // Hand the screen back explicitly so deselection paints a fresh frame
    // instead of leaving the last outlined frame in the canvas.
    if (selectionOutlineUnderlayPass) selectionOutlineUnderlayPass.renderToScreen = !active;
  };
  function rebuildComposer(): void {
    // The chain always builds BARE here: nothing authors a render
    // environment for the editor's own composer, and an adapter-backed
    // world composes its own post chain (R3F's fiber-native
    // postprocessing). `editor-viewport.ts` bumps `composerVersion` (via
    // `store.reapplyEnvironment()`) on the world hide/show edges, which is
    // what re-runs this rebuild.
    const hiddenRootId = resolveThreeViewportRootId(store.shell);
    void hiddenRootId;
    // Unwind the previous adoption's config BEFORE re-deriving, so the
    // re-derive below and the (possibly absent) re-apply at the end both
    // start from the editor's own values — see `restoreAdoptedImage`'s decl.
    restoreAdoptedImage?.();
    restoreAdoptedImage = null;
    // `applySceneRenderPipeline` disposes the previous passes; the outline
    // returns to this renderer's pool first, detached from its pass and its
    // selection cleared, and the rebuilt pipeline takes it back below.
    if (selectionOutline) releaseThreeSelectionOutline(renderer, selectionOutline, selectionOutlinePass);
    selectionOutline = null;
    selectionOutlinePass = null;
    selectionOutlineUnderlayPass = null;
    applySceneRenderPipeline(
      composer,
      renderer,
      store.scene ?? scene,
      viewport.renderCamera,
      undefined,
      {
        // Same cap as the renderer-construction call site above.
        basePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        objectMap: store.objectMap,
        entityTags: buildEntityTagMap(store),
      },
    );
    // Editor selection is appended AFTER the world's image pipeline. It is
    // viewport chrome, never an authored post effect, and therefore remains
    // legible under every shading mode without entering Game rendering.
    // This stage already loaded `postprocessing` for its own composer, so it
    // hands the factory its own bindings — no second module load, and the
    // outline is attached synchronously exactly as before.
    selectionOutline = acquireThreeSelectionOutline(
      { BlendFunction, KernelSize, OutlineEffect },
      renderer,
      store.scene ?? scene,
      viewport.renderCamera,
      nativeSelectionColors(renderer.domElement),
    );
    syncSelectionTheme();
    selectionOutlineUnderlayPass = composer.passes.at(-1) ?? null;
    selectionOutlinePass = new EffectPass(viewport.renderCamera, selectionOutline);
    selectionOutlinePass.enabled = false;
    composer.addPass(selectionOutlinePass);
    syncSelectionOutline();
    // LAST, and after the engine defaults above have been re-derived: the
    // ADOPTED content's own declaration about the renderer that draws it
    // (`EditorShellStore.adoptedImageConfig`). Everything before this line
    // configures the renderer from the EDITOR's defaults, so a world that was
    // authored for a different colour pipeline would otherwise be drawn in a
    // pipeline it never asked for — see that getter's doc comment.
    //
    // Renderer PROPERTIES only. A world's own post chain stays its own: it
    // renders from the world's camera, not the viewport's, and putting the
    // game's grade on this frame would put it on the grid, the gizmo and
    // every helper too. That line is what keeps editor chrome legible under
    // any content.
    const adoptedImage = store.adoptedImageConfig;
    if (adoptedImage) {
      restoreAdoptedImage = applyWorldRendererConfig(THREE, renderer, adoptedImage);
    }
  }
  const applyViewportPresentation = (): void => {
    viewport.setProjection(threeViewportPresentation().projection);
    store.setViewportCamera(viewport.freeCamera);
    rebuildComposer();
  };
  const unsubscribeViewportPresentation =
    subscribeThreeViewportPresentation(applyViewportPresentation);
  applyViewportPresentation();

  const resolveCameraSubject = (id: string): CameraAuthoringSubject | null =>
    cameraSubjectFor(getActiveAuthoring(store.shell), store.objectMap, id);

  let pilotGestureId: string | null = null;
  const finishPilotGesture = (): void => {
    if (!pilotGestureId) return;
    endAuthoringTransformEdit(getActiveAuthoring(store.shell), pilotGestureId);
    pilotGestureId = null;
  };
  const beginPilotGesture = (): void => {
    const view = cameraAuthoringPresentation().view;
    if (view?.mode !== 'pilot' || !view.subject.canAuthorPose) return;
    pilotGestureId = view.subject.id;
    beginAuthoringTransformEdit(getActiveAuthoring(store.shell), pilotGestureId);
  };
  const applyPilotGesture = (): void => {
    if (!pilotGestureId || viewport.cameraViewMode !== 'pilot') return;
    const subject = resolveCameraSubject(pilotGestureId);
    const adapter = getActiveAuthoring(store.shell);
    const transforms = adapter.transforms;
    if (!subject || !transforms) return;
    // `transforms.get` REFUSES BY THROWING for a node with no transform truth
    // (composite-authoring-adapter's unowned/untransformed refusals) rather
    // than answering an identity pose. This runs on every OrbitControls
    // 'change', so an escaping throw would kill the control loop AND repeat
    // the message per frame: report it once and END the gesture, which is
    // what a subject with no pose to write actually means.
    let previous: Transform;
    try {
      previous = transforms.get(pilotGestureId);
    } catch (error) {
      editorConsole.error(
        error instanceof Error ? error.message : String(error),
        'camera-authoring',
      );
      finishPilotGesture();
      return;
    }
    applyAuthoringTransform(adapter, pilotGestureId, {
      position: subject.camera.position.toArray() as [number, number, number],
      rotation: subject.camera.quaternion.toArray() as [number, number, number, number],
      scale: previous.scale,
    });
    store.shell.notifyIngestEdit();
  };
  viewport.orbitControls.addEventListener('start', beginPilotGesture);
  viewport.orbitControls.addEventListener('change', applyPilotGesture);
  viewport.orbitControls.addEventListener('end', finishPilotGesture);

  const disposeCameraAuthoring = installCameraAuthoringHost({
    active: () => store.shell.playState === 'stopped' && store.shell.activeViewportTab === 'edit',
    selected: () => {
      const id = store.shell.selectedEntityId;
      return id ? resolveCameraSubject(id) : null;
    },
    resolve: resolveCameraSubject,
    showView: (subject: CameraAuthoringSubject, mode: CameraViewMode) => {
      finishPilotGesture();
      viewport.setCameraView(subject.camera, mode);
      rebuildComposer();
      presence.reportCamera();
    },
    leaveView: () => {
      finishPilotGesture();
      viewport.clearCameraView();
      rebuildComposer();
      presence.reportCamera();
    },
    alignToViewport: (subject: CameraAuthoringSubject) => {
      const adapter = getActiveAuthoring(store.shell);
      const transforms = adapter.transforms;
      if (!transforms || !subject.canAuthorPose) return;
      const targetObject = store.objectMap.get(subject.id) ?? null;
      if (!targetObject) return;
      const worldPosition = viewport.camera.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = viewport.camera.getWorldQuaternion(new THREE.Quaternion());
      const localPosition = worldPosition.clone();
      const localQuaternion = worldQuaternion.clone();
      if (targetObject.parent) {
        targetObject.parent.updateWorldMatrix(true, false);
        targetObject.parent.worldToLocal(localPosition);
        const parentWorldQuaternion = targetObject.parent.getWorldQuaternion(
          new THREE.Quaternion(),
        );
        localQuaternion.premultiply(parentWorldQuaternion.invert());
      }
      // Same refusal contract as applyPilotGesture above — surface it and
      // abort, before any beginEdit opens a gesture that cannot be written.
      let previous: Transform;
      try {
        previous = transforms.get(subject.id);
      } catch (error) {
        editorConsole.error(
          error instanceof Error ? error.message : String(error),
          'camera-authoring',
        );
        return;
      }
      beginAuthoringTransformEdit(adapter, subject.id);
      applyAuthoringTransform(adapter, subject.id, {
        position: localPosition.toArray() as [number, number, number],
        rotation: localQuaternion.toArray() as [number, number, number, number],
        scale: previous.scale,
      });
      store.shell.notifyIngestEdit();
      endAuthoringTransformEdit(adapter, subject.id);
    },
    subscribe: store.shell.subscribe,
  });

  // --- Store subscription → sync viewport ---
  // Rebuild the post-processing chain only when its inputs actually change
  // (environment / scene structure / play-stop swap), tracked by composerVersion.
  // Previously this ran on EVERY notify, so a gizmo drag — which notifies once
  // per pointer-move — reconstructed every EffectPass and recompiled shaders
  // 60×/s, causing severe stutter on any scene with post effects enabled.
  // Spec 28 — figma mode's backdrop is the STANDARD transparency
  // checkerboard, not a flat color: with no three surface showing, the area
  // behind the DOM roots isn't "a gray scene", it's NOTHING, and the
  // checkerboard is the universal signal for that. Achieved by fading the
  // WebGL canvas to opacity 0 (keeps layout AND pointer flow identical — the
  // layered-pick path still runs) so the container's own checkerboard shows
  // through behind the DOM world layers appended above it. Driven off the
  // store here rather than from React, because the canvas is the stage's and
  // React never owns it.
  let lastThreejsSurface: boolean | null = null;
  const syncSurfaceVisibility = (): void => {
    const visible = isThreejsSurfaceVisible(store.shell);
    if (visible === lastThreejsSurface) return;
    lastThreejsSurface = visible;
    canvas.style.opacity = visible ? '1' : '0';
    // Dark-UI transparency checkerboard (VS Code image-preview style — the
    // light Figma checker glares in a dark editor and washes out
    // light-on-transparent HUD content). V-20 — the PATTERN itself is a
    // deliberate, documented design choice (left alone); `themeVars.surface.raised`
    // is an exact-value token match for the base tone, so swapped in. The
    // gradient's `#444649` has no exact token in the current set, so it stays
    // a literal per the audit's own "only swap exact matches" guidance.
    container.style.backgroundColor = visible ? '' : themeVars.surface.raised;
    container.style.backgroundImage = visible
      ? ''
      : 'linear-gradient(45deg, #444649 25%, transparent 25%, transparent 75%, #444649 75%), linear-gradient(45deg, #444649 25%, transparent 25%, transparent 75%, #444649 75%)';
    container.style.backgroundPosition = visible ? '' : '0 0, 8px 8px';
    container.style.backgroundSize = visible ? '' : '16px 16px';
  };
  syncSurfaceVisibility();

  let lastComposerVersion = store.composerVersion;
  const unsubStore = store.shell.subscribe(() => {
    syncSurfaceVisibility();
    // Swap viewport scene if the store's scene changed (play mode enter/exit)
    const storeScene = store.scene;
    if (storeScene && storeScene !== viewport.currentScene) {
      viewport.setScene(storeScene);
    }
    viewport.objectMap = store.objectMap;
    viewport.syncFromStore();
    if (store.composerVersion !== lastComposerVersion) {
      lastComposerVersion = store.composerVersion;
      rebuildComposer();
    } else {
      syncSelectionOutline();
    }
  });

  // --- Pending scene auto-frame (see the 'focus-scene' action below) ---
  /** Live lookup for the adopted game's own camera — never a snapshot; see
   *  the store. Null for a world that has none to wait for. */
  let gameCameraLookup: (() => THREE.Camera | null) | null = null;
  /** Everything about WHEN the camera may still move on its own, and the
   *  reader's gesture ending that, lives in `auto-frame-window.ts`. */
  const autoFrame = new AutoFrameWindow({
    seedFromGameCamera: () => {
      const gameCamera = gameCameraLookup?.() ?? null;
      return !!gameCamera && viewport.seedFromGameCamera(gameCamera);
    },
    frameContent: () => viewport.focusOnScene(),
  });
  const cancelAutoFrame = (): void => {
    autoFrame.cancel();
    gameCameraLookup = null;
  };
  viewport.orbitControls.addEventListener('start', cancelAutoFrame);
  // A finished gesture is the pose worth remembering (viewport-pose-memory).
  const rememberPose = (): void => saveViewportPose(viewport.camera, viewport.orbitControls.target);
  viewport.orbitControls.addEventListener('end', rememberPose);

  // --- Viewport action subscription ---
  const unsubActions = store.onViewportAction((action) => {
    switch (action.type) {
      // Resolved through the ACTIVE ADAPTER first, same as selection and the
      // gizmo — an adopted play scene's nodes live in the adapter's walk and
      // never reach `objectMap`, so a store-only lookup silently framed
      // nothing for every entity in a running game (`entity-object.ts`).
      case 'focus-entity': {
        const obj = entityObject3D(getActiveAuthoring(store.shell), store.objectMap, action.id);
        if (obj) viewport.focusOn(obj);
        break;
      }
      case 'focus-scene': {
        // A game builds itself asynchronously — a level-streaming game
        // captures on its first frame and keeps parsing its world in for
        // seconds afterwards, and its own camera can appear later still — so
        // "open on the world" cannot be a single attempt at mount. The
        // window (auto-frame-window.ts) tries now and keeps trying on a slow
        // cadence; the frame hook below rides it.
        // A remembered pose is a reader gesture that already happened, and
        // the gesture outranks the whole window (auto-frame-window.ts) —
        // restore it and never open the window. First ever open of a
        // project still gets the designed first-look framing.
        {
          const remembered = savedViewportPose();
          if (remembered) {
            viewport.camera.position.set(...remembered.position);
            viewport.orbitControls.target.set(...remembered.target);
            viewport.orbitControls.update();
            break;
          }
        }
        gameCameraLookup = action.gameCamera ?? null;
        autoFrame.begin(performance.now(), gameCameraLookup !== null);
        break;
      }
      case 'focus-selection': {
        const adapter = getActiveAuthoring(store.shell);
        const objects = [...store.shell.selectedEntityIds]
          .map((id) => entityObject3D(adapter, store.objectMap, id))
          .filter((o): o is THREE.Object3D => o !== null);
        viewport.focusOnMultiple(objects);
        break;
      }
      case 'snap-selection-to-floor':
        viewport.snapSelectionToFloor();
        break;
      case 'set-view-preset':
        viewport.setViewPreset(action.preset);
        break;
      case 'set-camera-pose':
        viewport.setPose(action.position, action.target, action.fov);
        break;
    }
  });

  // --- Error capture → editor console ---
  // Owned by `installEditorConsoleCapture()` (main.tsx) since it became
  // session-lifetime: this stage's mount/unmount is the wrong lifetime for a
  // page-error listener (an error thrown before the viewport mounts, or after
  // it unmounts, is still the session's news), and two owners would have
  // double-logged every uncaught error.

  // --- Server logs ---
  connectServerLogs();

  // --- Resize ---
  const resizeObserver = new ResizeObserver(() => {
    // Docking, HMR, and tab switches can briefly collapse the panel to 0x0.
    // Three's EffectComposer allocates incomplete render targets at that
    // size, then floods the console when the shared RAF renders the frame.
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    viewport.resize(w, h);
  });
  resizeObserver.observe(container);

  // --- Frame loop ---
  let lastTime = performance.now();
  let sceneNeedsFirstFrame = true;
  // A queued callback can survive long enough to meet an HMR/unmount cleanup.
  // Never let it touch the renderer after that renderer has been disposed.
  let disposed = false;
  // The renderer exists before the project's authoring surface does. A draw
  // of the empty editor scene is not a loaded Scene viewport: wait until the
  // complete edit-mode mount / ingest adoption chain has settled, then stamp
  // the first draw that can actually contain the project's authored world.
  let sceneContentReady = false;

  function drawViewport(dt: number): boolean {
    return drawSceneUnlessRefused(viewport.currentScene, () => {
      // P26 attribution (SwiftShader, CitadelArena probe): a cold first
      // draw took 2.275s while steady-state draws were ~1.3ms with or
      // without the arena selected. Selection bounds were <=0.2ms for the
      // live 80-node subtree (and ~4.1ms for a synthetic 20k-node root).
      // Keep cold shader/driver work distinct from selected-subtree cost:
      // the latter is invalidated in SelectionBrackets.updateIfNeeded().
      // Take game-scene depth BEFORE `renderWithInfrastructure` attaches
      // the grid, gizmos, selection helpers, and other editor-only
      // objects. Those are presentation chrome and must never make an
      // authored particle fade. The pass restores the previous render
      // target before the ordinary composer draw begins.
      softParticleDepth.render(renderer, viewport.currentScene, viewport.renderCamera);
      viewport.renderWithInfrastructure(() => {
        // The Scene camera is not the game's camera, so the game's
        // distance-calibrated fog is not this view's look — see
        // `scene-view-fog.ts`. Presentation-only and restored in a
        // `finally`, exactly like the shading modes it wraps.
        withSceneFogNeutralized(viewport.currentScene, () =>
          viewportShading.render(
            viewport.currentScene,
            store.shadingMode,
            () => composer.render(dt),
            isEditorViewportShadingTarget,
          ),
        );
        viewport.renderViewCube(renderer);
        viewport.renderCameraPreview(
          renderer,
          cameraAuthoringPresentation().preview?.camera ?? null,
          options.cameraPreview(),
        );
      });
    });
  }

  const unregisterCanvasFrame = registerPresentedCanvasFrame(canvas, async () => {
    if (
      disposed ||
      !isEditorPresentationActive() ||
      !container.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
    )
      return null;
    if (!drawViewport(0)) return null;
    const frame = document.createElement('canvas');
    frame.width = canvas.width;
    frame.height = canvas.height;
    frame.getContext('2d')!.drawImage(canvas, 0, 0);
    return frame;
  });

  /** Whether this stage is the one the shared panels are following, and so the
   *  one that fills the shell's frame/camera readout — see its use below. */
  const ownsShellReadout = (): boolean => focusedStageStore(store) === store;

  function frame(now: number, resumed: boolean): void {
    if (disposed) return;
    // The Scene document stays MOUNTED during Play with its overlay ancestor
    // hidden by inherited `visibility: hidden`. The host keeps
    // this stage's loop alive so Edit resumes naturally AND so the play-entry
    // camera flight keeps its clock through the cross-fade — but do
    // absolutely no editor presentation/update/profiling work while that
    // document is hidden.
    if (resumed) lastTime = now;
    if (!container.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) {
      lastTime = now;
      sceneNeedsFirstFrame = true;
      return;
    }

    profiler.beginFrame();
    const frameTime = now - lastTime;
    const dt = frameTime / 1000;
    // THE SHELL'S READOUT IS THE FOCUSED STAGE'S (ARCHITECTURE-CORE §One stage
    // unit 4). `EditorStats` is one mutable struct the shell owns and
    // `CameraInfo`/`StatsOverlay` read; every stage can fill it, and the one
    // that does is whichever stage the panels are following — so a model
    // document's readout reports the camera its reader is looking through,
    // and this stage takes it back the moment focus returns (including while
    // the Game tab holds focus during Play, which owns no stage).
    if (ownsShellReadout()) {
      stats.frameTime = frameTime;
      stats.fps = 1000 / frameTime;
    }
    lastTime = now;
    presence.syncMarkers(dt);

    autoFrame.tick(now);

    profiler.beginPhase();
    viewport.update(dt);
    // The door's frame hook (the play-entry camera flight rides it): after
    // viewport.update so a flight has final say over the camera pose
    // (orbit damping never fights it).
    options.runFrame(dt);
    // NOTHING ADVANCES CONTENT HERE. Edit is static on every surface, and the
    // Scene view is no exception: the design world's frameloop is never run
    // (`authoring/r3f-design-session.ts`), its one advance is the bounded
    // settle at mount, and this loop drives only editor-owned presentation —
    // orbit damping, the play-entry flight, the view cube, and the editor's
    // own batched particle renderer, which lives on the editor layer.
    viewport.batchedRenderer.update(dt);
    profiler.endPhase('editor');
    profiler.beginPhase();
    renderer.info.reset();
    // A world built by a three the editor did not make can be beyond this
    // renderer's reach — the throw is what says so, once, and then this
    // scene stops being drawn here. See `scene-view-drawability.ts`.
    drawTimed(() => {
      drawViewport(dt);
    });
    profiler.reportRender({
      gpuMs: pollGpuMs(),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    });
    profiler.endPhase('render');
    if (ownsShellReadout()) {
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
    }
    if (sceneNeedsFirstFrame && sceneContentReady) {
      sceneNeedsFirstFrame = false;
      recordViewportFirstFrame(documentId);
    }
    profiler.endFrame();

    // Update camera info for CameraInfo panel
    const visiblePose = readVisibleCameraPose();
    const cam = visiblePose.position;
    const tgt = visiblePose.target;
    if (ownsShellReadout()) {
      stats.cameraPosition.x = cam.x;
      stats.cameraPosition.y = cam.y;
      stats.cameraPosition.z = cam.z;
      stats.cameraTarget.x = tgt.x;
      stats.cameraTarget.y = tgt.y;
      stats.cameraTarget.z = tgt.z;
    }
    const presenceCamera = `${cam.x},${cam.y},${cam.z},${tgt.x},${tgt.y},${tgt.z},${visiblePose.fov}`;
    if (presenceCamera !== lastPresenceCamera) {
      lastPresenceCamera = presenceCamera;
      presence.reportCamera();
    }
  }

  // --- Start ---
  viewport.objectMap = store.objectMap;
  viewport.syncFromStore();
  rebuildComposer();

  let editModeComposite: CompositeAuthoringAdapter | undefined;
  let disposeR3FSession: (() => void) | undefined;

  async function installStage(composite: CompositeAuthoringAdapter): Promise<void> {
    if (disposed) return;
    options.onMountStatus('mounting');
    disposeR3FSession?.();
    disposeR3FSession = undefined;
    editModeComposite = composite;
    options.onRootIds(
      composite
        .childAdapters()
        .filter((child) => child.role === 'world' && child.kind === 'three')
        .map((child) => child.worldId),
    );
    // Design-mount the three medium's design session on THIS stage, so EDIT
    // mode authors the live scene with source write-back. The stage names no
    // medium: `design-time-mount-registry.ts` answers by kind and the
    // integration that owns the surface registered it — the same seam a `dom`
    // or `canvas` layer mounts through, on the surface those media do not
    // have. Nothing registered is a real answer: a product that composes no
    // three integration leaves the world root's own Boundary node standing.
    const stageMount = designTimeMountFor('three');
    if (disposed || editModeComposite !== composite) return;
    const disposeSession = stageMount
      ? await stageMount.mountWorldRootSession({ store, composite, renderer } satisfies WorldRootSessionContext)
      : () => {};
    if (disposed || editModeComposite !== composite) {
      disposeSession();
      return;
    }
    disposeR3FSession = disposeSession;
    if (!disposed) options.onMountStatus('ready');
  }

  const authoringStage = attachProjectAuthoringStage(store, installStage);
  authoringStage.ready
    .then(() => reportEditorState(collectState(store.shell)))
    .catch((err) => {
      editorConsole.error(
        `Editor boot failed: ${err instanceof Error ? err.message : String(err)}`,
        'scene',
      );
      options.onMountStatus('ready');
    })
    .finally(() => {
      // Success and a surfaced terminal failure are both completed viewport
      // states. In either case the next visible draw is the first honest
      // frame a startup/activation measurement may certify.
      sceneContentReady = true;
      sceneNeedsFirstFrame = true;
    });

  return {
    scene,
    viewport,
    frame,
    // PLAY ADOPTION IS THIS BINDING'S — the condition is "the stage is showing
    // the world root" (ARCHITECTURE-CORE §One stage). A `build` binding shows
    // one constructed Object3D and presents nothing, so its presenter declines
    // every root; this one hands the live scene to the store's adoption stack.
    present: (roots) => presentThreeRoots(store, roots),
    setHelper: (kind, object) => viewport.setHelper(kind, object),
    dispose: () => {
      disposed = true;
      unregisterPerformanceSource();
      unregisterCanvasFrame();
      resizeObserver.disconnect();
      unsubStore();
      unsubActions();
      disposeCameraAuthoring();
      viewport.orbitControls.removeEventListener('start', beginPilotGesture);
      viewport.orbitControls.removeEventListener('change', applyPilotGesture);
      viewport.orbitControls.removeEventListener('end', finishPilotGesture);
      viewport.orbitControls.removeEventListener('start', cancelAutoFrame);
      viewport.orbitControls.removeEventListener('end', rememberPose);
      authoringStage.dispose();
      disposeR3FSession?.();
      presence.dispose();
      viewportShading.dispose();
      gpuTimer.dispose();
      unsubscribeViewportPresentation();
      unsubscribeSelectionTheme();
      unsubscribeWorldBackground();
      unbindPresentation();
      selectionOutline?.selection.clear();
      softParticleDepth.dispose();
      composer.dispose();
    },
  };
}
