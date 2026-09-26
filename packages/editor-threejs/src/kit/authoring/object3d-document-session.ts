import { createPerformanceProfiler } from '@volter/editor-sdk/kit/performance-profiler';
import { resetViewPresentation, type ViewportXray } from '@volter/editor-sdk/kit/viewport-presentation';
import { invalidateStages } from '@volter/editor-sdk/kit/stage-invalidation';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { viewportCaptureOutputPass } from '@volter/editor-threejs/capture/output-pass';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { setUserData } from '@volter/editor-threejs/ecs/user-data';
import {
  type ViewportShadingMode,
  ViewportShadingRenderer,
} from '@volter/editor-threejs/render/viewport-shading';
import type { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import * as THREE from 'three';
import { threeObject } from '../../adapter/three-contract';
import { axisViewName, cameraPresetDirection, type ModelCameraPreset } from '../asset-workflow/model-inspection';
import { activeKeymapNavigation } from '@volter/editor-sdk/kit/keymap-presets';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { type EditorViewport } from '../editor-viewport';
import { nativeSelectionColors, subscribeNativeSelectionTheme } from '@volter/editor-sdk/kit/native-selection-style';
import { BoneSelectionHighlight } from '../three-viewport/bone-selection-highlight';
import { perspectiveDistanceToFitBox } from '../three-viewport/camera-fit';
import {
  acquireThreeSelectionOutline,
  releaseThreeSelectionOutline,
  setThreeSelectionOutlineColors,
  syncThreeSelectionOutline,
} from '../three-viewport/selection-outline';
import { styleEditorSkeletonHelper } from '../three-viewport/skeleton-helper';
import { isEditorViewportShadingTarget } from '../viewport-shading-boundary';
import { setAuthoringSelection } from '@volter/editor-sdk/kit/authoring/consumer-actions';
import type { ToolCameraView, ToolCameraViewSource } from '../../object3d-contributions';

export type Object3DDocumentViewMode = ViewportShadingMode | 'uv' | 'vertex-colors';

/**
 * How a look flight ended. Never a rejection: "the human grabbed the view
 * mid-orbit" is an ordinary outcome of a shared camera, not an error, and the
 * caller needs to be able to tell it apart from "it ran to the end".
 */
export interface DocumentLookOutcome {
  readonly completed: boolean;
  /** Only when `completed` is false. */
  readonly cancelledBy?: 'human' | 'superseded' | 'closed';
  /** Where the camera actually ended up, in the pivot's spherical frame. */
  readonly azimuth: number;
  readonly elevation: number;
  readonly seconds: number;
}

/**
 * One in-flight camera move. The pivot and radius are captured at LAUNCH from
 * wherever the human left the view, so a flight always lerps from the current
 * pose rather than snapping to a canonical one.
 */
interface CameraFlight {
  readonly pivot: THREE.Vector3;
  readonly radius: number;
  readonly startTheta: number;
  readonly startPhi: number;
  readonly deltaTheta: number;
  readonly deltaPhi: number;
  readonly duration: number;
  readonly ease: (t: number) => number;
  elapsed: number;
  theta: number;
  phi: number;
  settle: ((outcome: DocumentLookOutcome) => void) | null;
}

/**
 * Dihedral angle below which an interior edge is dropped from the topology
 * overlay. At 1° a PLANAR quad's triangulation diagonal disappears while every
 * real face boundary survives — which is the entire reason the overlay exists
 * (`toBufferGeometry` fan-triangulates, so nothing downstream of the mesh kit
 * still knows which pairs of triangles were one quad).
 */
const TOPOLOGY_EDGE_THRESHOLD_DEGREES = 1;

/** OrbitControls' own poles-excluded range; orbiting past them flips the view. */
/** How long a presented-frame request waits on the host's draw loop before it
 *  gives the chrome door back `null` (see `requestPresentedFrame`). Two frames
 *  at 30fps is a loop that is running; longer means it is not. */
const PRESENTED_FRAME_WAIT_MS = 700;

const MIN_POLAR = 1e-3;
const MAX_POLAR = Math.PI - 1e-3;

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const linear = (t: number): number => t;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface Object3DDocumentPresentationState {
  readonly mode: Object3DDocumentViewMode;
  readonly background: 'neutral' | 'transparent';
  readonly projection: 'perspective' | 'orthographic';
  readonly skeleton: boolean;
  readonly bounds: boolean;
}

const INITIAL_PRESENTATION: Object3DDocumentPresentationState = {
  mode: 'solid',
  background: 'neutral',
  projection: 'perspective',
  skeleton: false,
  bounds: false,
};

/**
 * Live presentation controls for one native Object3D document. The model
 * graph remains truth; this session owns only editor chrome and diagnostics.
 */
/** The wire of an unselected object in the wireframe overlay: dark on the light clay body. */
const TOPOLOGY_WIRE_COLOR = 0x11161d;

export class Object3DDocumentSession {
  readonly profiler = createPerformanceProfiler();
  private readonly shading = new ViewportShadingRenderer();
  private readonly helpers: THREE.Object3D[] = [];
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private boundsHelper: THREE.BoxHelper | null = null;
  private boneSelectionHighlight: BoneSelectionHighlight | null = null;
  private boneSelectionSignature = '';
  private composer: EffectComposer | null = null;
  /** One in-flight `import('postprocessing')` at a time — {@link ensureComposer}
   *  is called from every frame. */
  private composerLoading = false;
  private disposed = false;
  private sceneRenderPass: RenderPass | null = null;
  private selectionOutline: ReturnType<typeof acquireThreeSelectionOutline> | null = null;
  private selectionOutlinePass: EffectPass | null = null;
  private selectedObjects: THREE.Object3D[] = [];
  /** The view's origin dots (`overlays.selection.origins`), when it shows them. */
  private selectionOrigins: SelectionOrigins | null = null;
  private renderWidth = 1;
  private renderHeight = 1;
  private readonly orthographicCamera = new THREE.OrthographicCamera();
  /** The offscreen render target's aspect, non-null ONLY inside
   *  {@link Object3DDocumentSession.captureImage} — whose buffer has its own
   *  shape (square by default, `{width, height}` when a caller asks for one)
   *  while the live camera's aspect is the panel's. */
  private captureAspect: number | null = null;
  /** The camera a capture door was handed, for the duration of that capture.
   *  A BLENDER RENDER IS NOT THE MODELING VIEWPORT: it photographs the scene
   *  through the scene's OWN camera, which has nothing to do with where the
   *  person is looking — see `blender-runtime-host.ts`. Before this existed the
   *  only way to photograph from another camera was to move the viewport onto
   *  it and move it back, which is why that code had a restore dance at all. */
  private cameraOverride: THREE.Camera | null = null;
  /** The document's cameras a camera view can look through (`ToolObject3DAuthoringProps.cameraView`). */
  private cameraViewSource: ToolCameraViewSource | null = null;
  /** A camera view in progress: the camera, the frame's zoom and offset, the view it left, and
   *  how to put its input back. */
  private through: {
    readonly camera: string;
    zoom: number;
    offset: [number, number];
    readonly left: {
      readonly position: THREE.Vector3;
      readonly target: THREE.Vector3;
      readonly up: THREE.Vector3;
      readonly projection: 'perspective' | 'orthographic';
    };
    /** Undo the input the view holds: its own capture, or the lock's hand-over. */
    release: () => void;
    locked: boolean;
  } | null = null;
  private leaving = false;
  /** The view computed for one synchronous burst of readers (a frame asks a dozen times). */
  private viewMemo: { key: string; view: ToolCameraView | null } | null = null;
  private readonly throughPerspective = new THREE.PerspectiveCamera();
  private readonly throughOrthographic = new THREE.OrthographicCamera();
  /** The host's mirror of the document scene onto the rendered scene — see
   *  {@link Object3DDocumentSession.setBeforeRender}. */
  private beforeRender: (() => void) | null = null;
  private state = INITIAL_PRESENTATION;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribeSelectionTheme: () => void = () => {};
  /** The one in-flight look move. See {@link Object3DDocumentSession.orbit}. */
  private flight: CameraFlight | null = null;
  /** The camera position the live flight wrote LAST frame — the drift check
   *  in {@link Object3DDocumentSession.advanceLook} compares against it. */
  private readonly flightPose = new THREE.Vector3();
  /** Wireframe's edge overlay and the meshes each line set shadows. */
  private topologyOverlay: THREE.Group | null = null;
  private topologyFollowers: Array<{
    readonly line: THREE.LineSegments;
    readonly source: THREE.Object3D;
  }> = [];

  constructor(
    readonly documentId: string,
    public root: THREE.Object3D,
    readonly scene: THREE.Scene,
    readonly renderer: THREE.WebGLRenderer,
    readonly viewport: EditorViewport,
    private authoring?: AuthoringAdapter,
    /** Asset Lab renders its neutral stage in editor chrome behind an alpha
     *  canvas; other document hosts may retain a real Three background. */
    private neutralBackground: THREE.Color | THREE.Texture | null = new THREE.Color(0x20242a),
    /** When set, Frame and view presets fit this box instead of the root AABB. */
    private readonly frameBox: THREE.Box3 | null = null,
  ) {
    this.unsubscribeSelectionTheme = subscribeNativeSelectionTheme(
      renderer.domElement,
      this.syncSelectionTheme,
    );
    // THE HUMAN ALWAYS WINS THE CAMERA. OrbitControls fires `start` on the
    // pointer-down that begins a real drag (its `update()` only ever fires
    // `change`), so this is the one event that means "a person just grabbed
    // this view". An agent flight yields at that instant, leaving the camera
    // exactly where it is: no snap-back, no two writers fighting for the pose.
    viewport.orbitControls.addEventListener('start', this.cancelLookForHuman);
    this.unsubscribeRotateStart = viewport.onRotateStart(this.autoPerspective);
    this.unsubscribeAxisView = viewport.onAxisView(this.axisView);
  }

  private readonly unsubscribeRotateStart: () => void;
  private readonly unsubscribeAxisView: () => void;

  /** The navigation gizmo turning the view to an axis: out of a camera view at the camera's pose
   *  (Blender's `view_axis` leaves it), and orthographic under Auto Perspective. */
  private readonly axisView = (): boolean => {
    this.leaveCameraView(false);
    this.settleFlight('superseded');
    if (activeKeymapNavigation().autoPerspective) this.setProjection('orthographic');
    return true;
  };

  /** Auto Perspective, where the keymap states it (`KeymapNavigation.autoPerspective`): a rotate
   *  that starts from an orthographic view still down an axis draws in perspective. */
  private readonly autoPerspective = (): void => {
    if (!activeKeymapNavigation().autoPerspective || this.cameraView() !== null) return;
    if (this.state.projection !== 'orthographic') return;
    const camera = this.viewport.camera;
    const offset = camera.position.clone().sub(this.viewport.orbitControls.target);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (axisViewName(offset, up) !== null) this.setProjection('perspective');
  };

  /** Replace authored content without replacing the editor session or camera. */
  replaceContent(root: THREE.Object3D, authoring: AuthoringAdapter): void {
    invalidateStages();
    this.selectionOutline?.selection.clear();
    this.selectedObjects = [];
    this.boneSelectionSignature = '';
    this.clearBoneSelectionHighlight();
    this.clearSkeletonHelper();
    this.clearBoundsHelper();
    this.clearTopologyOverlay();
    this.root = root;
    this.authoring = authoring;
    if (this.state.mode === 'wireframe') this.buildTopologyOverlay();
    if (this.state.bounds) {
      this.boundsHelper = new THREE.BoxHelper(root, 0xffb454);
      this.addHelper(this.boundsHelper, 'bounds');
    }
    this.syncSelectionPresentation();
    this.refreshSkeletonHelper();
    this.notify();
  }

  private readonly cancelLookForHuman = (): void => {
    this.settleFlight('human');
  };

  /** The look's selection colours, read when the theme changes (not per frame: the read resolves
   *  computed styles). */
  private selectionColors: ReturnType<typeof nativeSelectionColors> | null = null;

  private readonly syncSelectionTheme = (): void => {
    this.selectionColors = nativeSelectionColors(this.renderer.domElement);
    const color = this.selectionColors.visible;
    if (this.selectionOutline) {
      setThreeSelectionOutlineColors(
        this.selectionOutline,
        nativeSelectionColors(this.renderer.domElement),
      );
    }
    this.boneSelectionHighlight?.setColor(color);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  presentation(): Object3DDocumentPresentationState {
    return this.state;
  }

  private resolveFrameBounds(subject: 'selection' | 'all' = 'selection'): THREE.Box3 {
    const selection = subject === 'all' ? [] : (this.authoring?.selection?.get() ?? []);
    if (selection.length > 0) {
      const selected = new THREE.Box3();
      let found = false;
      for (const id of selection) {
        const object = this.authoring ? threeObject(this.authoring.hierarchy, id) : null;
        if (!object) continue;
        const bounds = contentWorldBounds(object);
        if (bounds.isEmpty()) continue;
        selected.union(bounds);
        found = true;
      }
      if (found) return selected;
    }
    if (this.frameBox && !this.frameBox.isEmpty()) return this.frameBox;
    return contentWorldBounds(this.root);
  }

  /**
   * Frame the subject: the selection if there is one, else this document's
   * frame box, else the whole root; `subject: 'all'` passes over the
   * selection (Blender's View All). `fit` scales the fitted distance — 1 is
   * the tight fit the toolbar's Frame button has always used, >1 pulls back.
   */
  frame(fit = 1, subject: 'selection' | 'all' = 'selection'): boolean {
    this.leaveCameraView(false);
    const bounds = this.resolveFrameBounds(subject);
    if (bounds.isEmpty()) {
      // A Frame that does nothing must say why — a model document whose
      // mesh measures as nothing is a defect, never a quiet no-op.
      let meshes = 0;
      let positions = 0;
      this.root.traverse((node) => {
        const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;
        meshes += 1;
        positions += geometry.getAttribute('position')?.count ?? 0;
      });
      editorConsole.warn(
        `frame: nothing to frame — root "${this.root.name}" (${this.root.children.length} children, ${meshes} meshes, ${positions} positions), selection ${JSON.stringify(this.authoring?.selection?.get() ?? [])}, frameBox ${this.frameBox ? (this.frameBox.isEmpty() ? 'empty' : 'set') : 'none'}`,
        'document',
      );
      return false;
    }
    this.settleFlight('superseded');
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = this.viewport.camera.position
      .clone()
      .sub(this.viewport.orbitControls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(0.8, 0.5, -1).normalize();
    const scale = Math.min(10, Math.max(0.1, finiteOr(fit, 1)));
    const distance = perspectiveDistanceToFitBox(bounds, this.viewport.camera, direction) * scale;
    this.viewport.setPose(center.clone().addScaledVector(direction, distance), center);
    return true;
  }

  /**
   * THE AGENT LOOKING AT THE MODEL, as an act a person can watch.
   *
   * Swing this document's ONE camera — the camera the human is looking
   * through — around the framed subject by `azimuth`/`elevation` radians,
   * animated over `duration` seconds (advanced in {@link renderViewport}, so
   * every intermediate pose is a frame that actually got drawn). The returned
   * promise settles when the move ends, either because it finished or because
   * a human grabbed the view.
   *
   * The pivot and radius are read from the CURRENT pose at launch, so this
   * composes with wherever the view already is instead of homing to a canon.
   * A second flight supersedes the first rather than blending with it.
   *
   * The move is drawn by the document's rAF loop, so a document that is not
   * rendering (a background tab, an inactive dock panel) does not orbit —
   * which is the honest behavior for a verb whose whole point is being seen.
   */
  orbit(options: {
    readonly azimuth?: number;
    readonly elevation?: number;
    readonly duration?: number;
  }): Promise<DocumentLookOutcome> {
    return this.launchFlight(
      finiteOr(options.azimuth, 0),
      finiteOr(options.elevation, 0),
      Math.min(60, Math.max(0, finiteOr(options.duration, 0.6))),
      easeInOutCubic,
    );
  }

  /**
   * A slow full orbit — {@link orbit} with the revolutions spelled in turns
   * and a CONSTANT angular rate, because a turntable that eases in and out
   * reads as a nervous camera rather than a rotating subject.
   */
  turntable(options: {
    readonly seconds?: number;
    readonly revolutions?: number;
  }): Promise<DocumentLookOutcome> {
    const revolutions = finiteOr(options.revolutions, 1);
    return this.launchFlight(
      revolutions * Math.PI * 2,
      0,
      Math.min(60, Math.max(0, finiteOr(options.seconds, 6))),
      linear,
    );
  }

  /** Is a look flight drawing right now? */
  looking(): boolean {
    return this.flight !== null;
  }

  private launchFlight(
    deltaAzimuth: number,
    deltaElevation: number,
    duration: number,
    ease: (t: number) => number,
  ): Promise<DocumentLookOutcome> {
    this.settleFlight('superseded');
    const camera = this.viewport.camera;
    const pivot = this.viewport.orbitControls.target.clone();
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(pivot));
    // A degenerate radius (camera sitting on its own target) has no orbit to
    // run; back off to something the subject's own scale justifies.
    const radius =
      spherical.radius > 1e-4
        ? spherical.radius
        : Math.max(this.resolveFrameBounds().getSize(new THREE.Vector3()).length(), 1);
    const flight: CameraFlight = {
      pivot,
      radius,
      startTheta: spherical.theta,
      startPhi: spherical.phi,
      deltaTheta: deltaAzimuth,
      // Elevation is measured UP from the horizon; the polar angle is measured
      // DOWN from +Y. Raising the camera therefore shrinks phi.
      deltaPhi: -deltaElevation,
      duration,
      ease,
      elapsed: 0,
      theta: spherical.theta,
      phi: spherical.phi,
      settle: null,
    };
    this.flight = flight;
    const settled = new Promise<DocumentLookOutcome>((resolve) => {
      flight.settle = resolve;
    });
    // A zero-length move is still a move: apply it now so the pose is correct
    // even on a surface whose next frame never comes.
    this.applyFlightPose(flight, 0);
    if (duration <= 0) this.settleFlight(null);
    return settled;
  }

  private applyFlightPose(flight: CameraFlight, progress: number): void {
    const k = flight.ease(progress);
    flight.theta = flight.startTheta + flight.deltaTheta * k;
    flight.phi = Math.min(MAX_POLAR, Math.max(MIN_POLAR, flight.startPhi + flight.deltaPhi * k));
    const camera = this.viewport.camera;
    camera.position
      .setFromSphericalCoords(flight.radius, flight.phi, flight.theta)
      .add(flight.pivot);
    this.viewport.orbitControls.target.copy(flight.pivot);
    camera.lookAt(flight.pivot);
    camera.updateMatrixWorld();
    this.flightPose.copy(camera.position);
  }

  /**
   * Advance the live flight. Called from {@link renderViewport} — i.e. AFTER
   * `EditorViewport.update()` has run OrbitControls for this frame — so the
   * flight has the final say on the pose that is about to be drawn. (Same
   * ordering rule the viewport's own snap-to-view animation follows.)
   */
  private advanceLook(deltaSeconds: number): void {
    const flight = this.flight;
    if (!flight) return;
    // DID THE POSE I WROTE LAST FRAME SURVIVE? If not, something else owns the
    // camera now, and it wins — yielding here rather than yanking the view
    // back onto the arc is the difference between "the agent stopped" and two
    // writers fighting over one camera.
    //
    // This is the door-independent half of cancellation, and it is not
    // redundant with the OrbitControls `start` listener: three dispatches
    // `start` for mouse, wheel and touch, but NOT for its keyboard pan, and a
    // pointer gesture that cannot take pointer capture (every synthetic one)
    // throws inside `onPointerDown` before reaching the dispatch. The listener
    // names the human case early; this catches every writer that moves the
    // camera without announcing itself.
    const tolerance = Math.max(1e-4, flight.radius * 1e-3);
    if (this.viewport.camera.position.distanceToSquared(this.flightPose) > tolerance * tolerance) {
      this.settleFlight('human');
      return;
    }
    if (deltaSeconds > 0 && Number.isFinite(deltaSeconds)) flight.elapsed += deltaSeconds;
    const progress = flight.duration <= 0 ? 1 : Math.min(1, flight.elapsed / flight.duration);
    this.applyFlightPose(flight, progress);
    if (progress >= 1) this.settleFlight(null);
  }

  private settleFlight(cancelledBy: 'human' | 'superseded' | 'closed' | null): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    const ended = {
      completed: cancelledBy === null,
      azimuth: flight.theta,
      elevation: Math.PI / 2 - flight.phi,
      seconds: Math.min(flight.elapsed, flight.duration),
    };
    flight.settle?.(cancelledBy === null ? ended : { ...ended, cancelledBy });
  }

  select(ids: readonly string[]): void {
    invalidateStages();
    if (this.authoring) setAuthoringSelection(this.authoring, [...ids]);
  }

  selection(): string[] {
    return [...(this.authoring?.selection?.get() ?? [])];
  }

  idForObject(object: THREE.Object3D): string | null {
    return this.authoring?.hierarchy.idForObject3D?.(object) ?? null;
  }

  /** Keep native hierarchy selection legible in this document's one viewport. */
  syncSelectionPresentation(): void {
    invalidateStages();
    const selected = (this.authoring?.selection?.get() ?? [])
      .map((id) => (this.authoring ? threeObject(this.authoring.hierarchy, id) : null))
      .filter((object): object is THREE.Object3D => object !== null);
    this.selectedObjects = selected;
    if (this.selectionOutline) {
      syncThreeSelectionOutline(this.selectionOutline, this.selectionOutlineWanted ? selected : []);
      this.syncComposerOutput();
    }
    if (this.selectionOrigins) {
      const colors = nativeSelectionColors(this.renderer.domElement);
      this.selectionOrigins.update(selected, {
        visible: colors.visible,
        ...(colors.active ? { active: colors.active.visible } : {}),
      });
    }
    const bones = selected.filter((object): object is THREE.Bone =>
      Boolean((object as THREE.Bone).isBone),
    );
    const signature = bones.map((bone) => bone.uuid).join('\u0000');
    if (signature === this.boneSelectionSignature) return;
    this.boneSelectionSignature = signature;
    this.clearBoneSelectionHighlight();
    if (bones.length > 0) {
      this.boneSelectionHighlight = new BoneSelectionHighlight(
        bones,
        nativeSelectionColors(this.renderer.domElement).visible,
      );
      this.scene.add(this.boneSelectionHighlight);
    }
    this.refreshSkeletonHelper();
  }

  frameSelection(): boolean {
    return this.frameIds(this.authoring?.selection?.get() ?? []);
  }

  frameIds(ids: readonly string[]): boolean {
    this.leaveCameraView(false);
    this.settleFlight('superseded');
    const objects = ids
      .map((id) => (this.authoring ? threeObject(this.authoring.hierarchy, id) : null))
      .filter((object): object is THREE.Object3D => object !== null);
    if (objects.length === 0) return false;
    if (objects.every((object) => (object as THREE.Bone).isBone)) {
      this.frameBones(objects as THREE.Bone[]);
      return true;
    }
    this.viewport.focusOnMultiple(objects);
    return true;
  }

  /**
   * An AXIS view is ORTHOGRAPHIC, the way Blender's numpad 1/3/7 are: the
   * reference frame for numpad 1 (`modeling-front-ortho.png`) says so in its
   * own view text, "Front Orthographic". Ours left the stage in perspective,
   * so a front view still showed the cube's side faces converging.
   *
   * `isometric` is the perspective preset (it is the stage's 3/4 opening
   * direction, not an axis) and stays perspective. Both callers of this door
   * already separate the two: the relay's `view-preset` maps its own
   * `perspective` onto `isometric`, and the document toolbar's view menu
   * carries the projection pair as its own second group — so nothing here
   * reads an axis preset expecting perspective.
   *
   * The pose is still solved against the PERSPECTIVE camera, because the
   * session's orthographic camera is derived from that pose every frame
   * (`syncOrthographicCamera`) rather than posed independently.
   *
   * `around` says what the view turns about. `bounds`, the document's opening camera, frames the
   * content from that side. `view` is a person's numpad: Blender's `view3d.view_axis` turns about
   * the view's own pivot at its own distance, so the zoom holds.
   */
  setViewPreset(preset: ModelCameraPreset, around: 'bounds' | 'view' = 'bounds'): void {
    invalidateStages();
    this.leaveCameraView(false);
    this.settleFlight('superseded');
    const direction = cameraPresetDirection(preset);
    let center: THREE.Vector3;
    let distance: number;
    if (around === 'view') {
      center = this.viewport.orbitControls.target.clone();
      distance = this.viewport.camera.position.distanceTo(center);
    } else {
      const bounds = this.resolveFrameBounds();
      if (bounds.isEmpty()) return;
      center = bounds.getCenter(new THREE.Vector3());
      distance = perspectiveDistanceToFitBox(bounds, this.viewport.camera, direction);
    }
    const position = center.clone().addScaledVector(direction, distance);
    // A preset has no roll. Top's screen up is the world's -Z and Bottom's +Z (Blender's +Y and
    // -Y); the others' is the world's up.
    const up = preset === 'top' ? { x: 0, y: 0, z: -1 } : preset === 'bottom' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    this.viewport.setPose(position, center, undefined, up);
    this.setProjection(preset === 'isometric' ? 'perspective' : 'orthographic');
  }

  setCameraPose(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov?: number,
  ): void {
    invalidateStages();
    this.leaveCameraView(false);
    this.settleFlight('superseded');
    this.viewport.setPose(position, target, fov);
  }

  cameraPose(): {
    readonly position: [number, number, number];
    readonly target: [number, number, number];
    readonly fov: number;
  } {
    return {
      position: this.viewport.camera.position.toArray(),
      target: this.viewport.orbitControls.target.toArray(),
      fov: this.viewport.camera.fov,
    };
  }

  camera(): THREE.Camera {
    if (this.cameraOverride) return this.cameraOverride;
    const drawn = this.drawnCamera();
    // The gizmos size, face and pick against the camera on screen: this session's orthographic
    // camera or its camera view, else the viewport's own.
    this.viewport.setGizmoCamera(drawn === this.viewport.camera ? null : drawn);
    return drawn;
  }

  private drawnCamera(): THREE.Camera {
    const through = this.through ? this.cameraView() : null;
    if (through) return this.throughCamera(through);
    // The camera went (deleted, renamed): the view leaves rather than hold the input on a frame
    // no one can see. After this call, never inside it — a read must not notify.
    if (this.through && !this.leaving) {
      this.leaving = true;
      queueMicrotask(() => {
        this.leaving = false;
        if (this.through && !this.cameraView()) this.leaveCameraView(false);
      });
    }
    if (this.state.projection === 'perspective') return this.viewport.camera;
    this.syncOrthographicCamera();
    return this.orthographicCamera;
  }

  /**
   * THE CAMERA VIEW (Blender's `view3d.view_camera`): the stage draws through one of the
   * document's own cameras, with that camera's frame on the region. Entering remembers the view
   * it leaves; the toggle puts that view back. Any other navigation leaves it where it is —
   * a preset, a Frame, a set pose — and ROTATING leaves it at the camera's own pose, as Blender
   * switches a rotated camera view to a user view from the camera (`ED_view3d_persp_switch_
   * from_camera`). While it lasts the wheel zooms the frame, a pan moves it and a dolly drag
   * zooms it, each by Blender's rule (`view_zoomstep_apply_ex`'s 1.2 a step, `view_move`,
   * `viewzoom_scale_value`), and the orbit controls stand down.
   */
  setCameraViewSource(source: ToolCameraViewSource | null): void {
    if (this.cameraViewSource === source) return;
    this.cameraViewSource = source;
    if (!source) this.leaveCameraView(false);
    this.notify();
  }

  /** Whether the document has cameras to look through at all. */
  hasCameraView(): boolean {
    return this.cameraViewSource !== null;
  }

  /** The camera view in progress on the current region, or null. */
  cameraView(): ToolCameraView | null {
    const through = this.through;
    const source = this.cameraViewSource;
    if (!through || !source) return null;
    // A photograph renders into its own buffer shape (`captureImage`), as the other cameras do.
    const canvas = this.renderer.domElement;
    const region = this.captureAspect
      ? { width: this.captureAspect, height: 1 }
      : { width: canvas.clientWidth, height: canvas.clientHeight };
    // A LOCKED view is drawn from the free camera the navigation moves, ahead of the camera's
    // own pose, which the engine confirms at the end of each gesture.
    const free = this.viewport.camera;
    const pose = through.locked
      ? `${free.position.toArray().join(',')}|${free.quaternion.toArray().join(',')}`
      : '';
    const key = `${through.camera}|${region.width}|${region.height}|${through.zoom}|${through.offset.join(',')}|${pose}`;
    if (this.viewMemo?.key === key) return this.viewMemo.view;
    const seen = source.view(through.camera, region, through.zoom, through.offset);
    const view =
      seen && through.locked
        ? {
            ...seen,
            position: free.position.toArray() as [number, number, number],
            quaternion: free.quaternion.toArray() as [number, number, number, number],
          }
        : seen;
    this.viewMemo = { key, view };
    queueMicrotask(() => {
      this.viewMemo = null;
    });
    return view;
  }

  /** Enter or leave the camera view; false when there is no camera to look through. */
  toggleCameraView(): boolean {
    if (this.through) {
      this.leaveCameraView(true);
      return true;
    }
    const source = this.cameraViewSource;
    const camera = source?.camera() ?? null;
    if (!source) return false;
    if (camera === null) {
      // A view that does not change says why, as Blender's `view_camera_exec` reports.
      editorConsole.warn('camera view: No active camera — the scene has no camera to look through', 'document');
      return false;
    }
    invalidateStages();
    this.settleFlight('superseded');
    const viewport = this.viewport;
    // The orbit's damping would go on moving the free camera behind the view: spend it now, so
    // the view it leaves is the one on screen.
    const controls = viewport.orbitControls;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    this.through = {
      camera,
      zoom: source.zoom.opening,
      offset: [0, 0],
      left: {
        position: viewport.camera.position.clone(),
        target: viewport.orbitControls.target.clone(),
        up: viewport.camera.up.clone(),
        projection: this.state.projection,
      },
      release: this.captureCameraViewInput(),
      locked: false,
    };
    source.showing?.(camera);
    this.notify();
    return true;
  }

  /** Whether the camera view is locked to its camera; null outside one, or where the document
   *  cannot move its camera. */
  cameraViewLocked(): boolean | null {
    if (!this.through || !this.cameraViewSource?.setPose) return null;
    return this.through.locked;
  }

  /**
   * LOCK THE CAMERA TO THE VIEW (Blender's `View3D.lock_camera`, the navigation cluster's lock):
   * navigating a locked camera view moves the camera. The orbit controls take the view from the
   * camera's own pose about a pivot as far ahead as the view it left stood from its pivot; the
   * view draws from where they put it, and the camera follows as they move — one write in
   * flight at a time, the latest pose after it (`ED_view3d_camera_lock_sync`, which keeps the
   * camera's scale). Unlocked, the view's own input comes back.
   */
  toggleCameraViewLock(): void {
    const through = this.through;
    const source = this.cameraViewSource;
    if (!through || !source?.setPose) return;
    through.release();
    through.locked = !through.locked;
    if (!through.locked) {
      through.release = this.captureCameraViewInput();
    } else {
      const view = this.cameraView();
      const controls = this.viewport.orbitControls;
      const camera = this.viewport.camera;
      if (view) {
        const eye = new THREE.Vector3(...view.position);
        const rotation = new THREE.Quaternion(...view.quaternion);
        const distance = through.left.position.distanceTo(through.left.target);
        // The camera's own up, so a rolled camera keeps its roll (the controls re-aim by it).
        camera.up.set(0, 1, 0).applyQuaternion(rotation);
        camera.position.copy(eye);
        camera.quaternion.copy(rotation);
        controls.target.copy(eye).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(rotation), distance);
        controls.update();
      }
      const enabled = controls.enabled;
      controls.enabled = true;
      // No inertia: Blender's navigation stops where the gesture does, and so does the camera
      // it moves — the gesture's end is the pose the history records.
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      const name = through.camera;
      // One write in flight; the latest pose after it, and the gesture's end as its own final
      // write. A failed write is the source's to report (the session only keeps the chain going).
      type Pose = { position: [number, number, number]; quaternion: [number, number, number, number]; final: boolean };
      const snapshot = (final: boolean): Pose => ({
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray() as [number, number, number, number],
        final,
      });
      let writing = false;
      let pending: Pose | null = null;
      let moving = false;
      const send = (pose: Pose): void => {
        if (writing) {
          // The latest pose waits, and a final one stays final.
          pending = { ...pose, final: pose.final || (pending?.final ?? false) };
          return;
        }
        writing = true;
        pending = null;
        void Promise.resolve(source.setPose!(name, pose.position, pose.quaternion, pose.final))
          .catch(() => undefined)
          .finally(() => {
            writing = false;
            if (pending) send(pending);
          });
      };
      const moved = (): void => {
        moving = true;
        invalidateStages();
        this.notify();
        send(snapshot(false));
      };
      const ended = (): void => {
        if (!moving) return;
        moving = false;
        send(snapshot(true));
      };
      controls.addEventListener('change', moved);
      controls.addEventListener('end', ended);
      through.release = () => {
        // A gesture cut short by leaving or unlocking still lands, as its last pose.
        ended();
        controls.removeEventListener('change', moved);
        controls.removeEventListener('end', ended);
        controls.enabled = enabled;
        controls.enableDamping = damping;
      };
    }
    this.viewMemo = null;
    invalidateStages();
    this.notify();
  }

  /** The camera view's frame zoom, or null outside one. */
  cameraViewZoom(): number | null {
    return this.through?.zoom ?? null;
  }

  /** Set the camera view's frame zoom, within the source's range. */
  setCameraViewZoom(zoom: number): void {
    const through = this.through;
    const source = this.cameraViewSource;
    if (!through || !source || !Number.isFinite(zoom) || zoom <= 0) return;
    through.zoom = Math.min(source.zoom.max, Math.max(source.zoom.min, zoom));
    invalidateStages();
    this.notify();
  }

  /** Zoom the camera view's frame by `factor` (the wheel's step). */
  zoomCameraView(factor: number): void {
    if (this.through) this.setCameraViewZoom(this.through.zoom * factor);
  }

  /** Pan the camera view by a pointer move, in fractions of the region (the source's rule). */
  panCameraView(dx: number, dy: number): void {
    const through = this.through;
    const source = this.cameraViewSource;
    if (!through || !source) return;
    const [x, y] = source.pan(through.offset, through.zoom, dx, dy);
    through.offset = [x, y];
    invalidateStages();
    this.notify();
  }

  /**
   * Leave the camera view: back to the view it left (`restore`), or, when navigation moves on
   * from it, with the view standing at the camera's pose at the distance it had.
   */
  private leaveCameraView(restore: boolean): void {
    const through = this.through;
    if (!through) return;
    const view = this.cameraView();
    through.release();
    this.through = null;
    this.viewMemo = null;
    this.cameraViewSource?.showing?.(null);
    this.viewport.setGizmoCamera(null);
    const viewport = this.viewport;
    if (restore) {
      viewport.camera.position.copy(through.left.position);
      viewport.camera.up.copy(through.left.up);
      viewport.orbitControls.target.copy(through.left.target);
      this.state = { ...this.state, projection: through.left.projection };
    } else if (view) {
      const distance = through.left.position.distanceTo(through.left.target);
      const eye = new THREE.Vector3(...view.position);
      const rotation = new THREE.Quaternion(...view.quaternion);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
      // The camera's rotation, roll included (`ED_view3d_persp_switch_from_camera`), in the
      // projection the view had before it went through (`lpersp`), or perspective where Auto
      // Perspective holds and that view was down an axis (`ED_view3d_persp_ensure`).
      viewport.camera.up.set(0, 1, 0).applyQuaternion(rotation);
      viewport.camera.position.copy(eye);
      viewport.orbitControls.target.copy(eye).addScaledVector(forward, distance);
      const leftAxis =
        axisViewName(through.left.position.clone().sub(through.left.target), through.left.up) !== null;
      const projection =
        activeKeymapNavigation().autoPerspective && leftAxis ? 'perspective' : through.left.projection;
      this.state = { ...this.state, projection };
    }
    viewport.camera.lookAt(viewport.orbitControls.target);
    viewport.orbitControls.update();
    invalidateStages();
    this.notify();
  }

  /** The stage's drawing camera for `view`: its pose, and its window as the projection. */
  private throughCamera(view: ToolCameraView): THREE.Camera {
    const { left, right, top, bottom } = view.window;
    const layers = this.viewport.camera.layers.mask;
    if (view.projection === 'orthographic') {
      const camera = this.throughOrthographic;
      Object.assign(camera, { left, right, top, bottom, near: view.near, far: view.far, zoom: 1 });
      camera.position.set(...view.position);
      camera.quaternion.set(...view.quaternion);
      camera.layers.mask = layers;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      return camera;
    }
    const camera = this.throughPerspective;
    camera.near = view.near;
    camera.far = view.far;
    // Readers of the angle (the 3D cursor's size) see the window's; the matrix is the window.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((top - bottom) / 2));
    camera.aspect = (right - left) / (top - bottom);
    camera.zoom = 1;
    camera.position.set(...view.position);
    camera.quaternion.set(...view.quaternion);
    camera.layers.mask = layers;
    camera.projectionMatrix.makePerspective(
      left * view.near,
      right * view.near,
      top * view.near,
      bottom * view.near,
      view.near,
      view.far,
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    return camera;
  }

  /**
   * The pointer while a camera view lasts, read ahead of the orbit controls (a capturing
   * listener on the canvas's parent), which stand down. A gesture the controls would read as
   * ROTATE leaves the view at the camera and hands the same press back to them; PAN moves the
   * frame and DOLLY zooms it. Returns the undo.
   */
  private captureCameraViewInput(): () => void {
    const controls = this.viewport.orbitControls;
    const canvas = this.renderer.domElement;
    const host = canvas.parentElement ?? canvas;
    const enabled = controls.enabled;
    controls.enabled = false;
    const onWheel = (event: WheelEvent): void => {
      if (event.target !== canvas || event.deltaY === 0) return;
      event.preventDefault();
      this.zoomCameraView(event.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target !== canvas) return;
      const buttons = controls.mouseButtons as Record<string, THREE.MOUSE | null | undefined>;
      let action = [buttons['LEFT'], buttons['MIDDLE'], buttons['RIGHT']][event.button] ?? null;
      const modified = event.ctrlKey || event.metaKey || event.shiftKey;
      // Ctrl/Cmd on an orbiting middle button zooms (the viewport's own rule, Blender's
      // Ctrl+MIDDLEMOUSE); Shift and the rest swap orbit and pan, as OrbitControls does.
      if (event.button === 1 && (event.ctrlKey || event.metaKey) && action === THREE.MOUSE.ROTATE)
        action = THREE.MOUSE.DOLLY;
      else if (modified && action === THREE.MOUSE.ROTATE) action = THREE.MOUSE.PAN;
      else if (modified && action === THREE.MOUSE.PAN) action = THREE.MOUSE.ROTATE;
      if (action === THREE.MOUSE.ROTATE) {
        this.leaveCameraView(false);
        return;
      }
      if (action !== THREE.MOUSE.PAN && action !== THREE.MOUSE.DOLLY) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      let lastX = event.clientX;
      let lastY = event.clientY;
      const zoom0 = this.through?.zoom ?? 1;
      const lenOld = Math.max(5 + event.clientY - rect.top, 1);
      const move = (moveEvent: PointerEvent): void => {
        if (action === THREE.MOUSE.PAN) {
          this.panCameraView(
            (moveEvent.clientX - lastX) / Math.max(rect.width, 1),
            (moveEvent.clientY - lastY) / Math.max(rect.height, 1),
          );
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          return;
        }
        const factor = Math.max(0.01, 2 * ((5 + moveEvent.clientY - rect.top) / lenOld - 1) + 1);
        this.setCameraViewZoom(zoom0 / factor);
      };
      const end = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    };
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    host.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      host.removeEventListener('wheel', onWheel, { capture: true });
      host.removeEventListener('pointerdown', onPointerDown, { capture: true });
      controls.enabled = enabled;
    };
  }

  /** Which projection the session is drawing with. Public because a caller
   *  that switches it for ONE frame — the Blender render capture — has to put
   *  it back, and cannot read it otherwise. */
  projection(): 'perspective' | 'orthographic' {
    return this.state.projection;
  }

  setProjection(projection: 'perspective' | 'orthographic'): void {
    invalidateStages();
    if (this.state.projection === projection) return;
    this.state = { ...this.state, projection };
    this.notify();
  }

  setMode(mode: Object3DDocumentViewMode): void {
    invalidateStages();
    if (this.state.mode === mode) return;
    this.clearDiagnosticPresentation();
    this.state = { ...this.state, mode };
    if (mode === 'uv') {
      this.scene.overrideMaterial = new THREE.ShaderMaterial({
        vertexShader:
          'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; void main(){ gl_FragColor=vec4(vUv,0.0,1.0); }',
      });
    } else if (mode === 'vertex-colors') {
      this.scene.overrideMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    } else if (mode === 'wireframe') {
      this.buildTopologyOverlay();
    }
    this.notify();
  }

  /**
   * WIREFRAME ON THE MODELING SURFACE IS TOPOLOGY, NOT TRIANGLES.
   *
   * The shared `wireframe` shading mode flips every material's
   * `wireframe` flag, which draws each RENDERABLE triangle — so a quad shows
   * its triangulation diagonal and a modeller reads noise where they expect
   * face flow. On the Asset Lab document viewport, where the mesh IS the
   * subject, the mode instead draws neutral clay bodies (so wires behind the
   * form are correctly occluded) under an edge overlay built with
   * `EdgesGeometry`: coplanar diagonals fall out, quads read as quads.
   *
   * The overlay is editor chrome — tagged `editorHelper`, so picking, bakes
   * and the shading swap itself all skip it, and gizmos/outlines are
   * untouched. One honest limit: a line set follows its mesh's NODE transform,
   * not its skin, so a skinned mesh shows rest-pose edges while a clip plays.
   * This surface holds content time still by policy, so that is the rare case.
   */
  private buildTopologyOverlay(): void {
    const group = new THREE.Group();
    const followers: Array<{ line: THREE.LineSegments; source: THREE.Object3D }> = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const line = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, TOPOLOGY_EDGE_THRESHOLD_DEGREES),
        // Dark on the light clay body, and DEPTH-TEST OFF. An edge sits
        // exactly on the surface it bounds, so a depth-tested line stipples
        // itself away in z-fighting — photographed and read before this was
        // written. Off is also the truer read: Blender's wireframe shading
        // shows the far side too, and the far side is half the topology.
        new THREE.LineBasicMaterial({
          color: TOPOLOGY_WIRE_COLOR,
          toneMapped: false,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
        }),
      );
      line.matrixAutoUpdate = false;
      line.matrixWorldAutoUpdate = false;
      line.matrixWorld.copy(mesh.matrixWorld);
      line.frustumCulled = false;
      line.renderOrder = 2;
      group.add(line);
      followers.push({ line, source: mesh });
    });
    if (followers.length === 0) return;
    this.topologyOverlay = group;
    this.topologyFollowers = followers;
    this.addHelper(group, 'topology');
  }

  private syncTopologyOverlay(): void {
    // A live module document keeps this session and SWAPS the built child on
    // every save, which detaches the meshes these lines shadow. Rebuild from
    // the current graph rather than drawing the previous revision's edges.
    if (this.topologyFollowers.some(({ source }) => source.parent === null)) {
      this.clearTopologyOverlay();
      this.buildTopologyOverlay();
    }
    // A selected object's wires wear the selection's colour, the active one the active colour, as
    // Blender's wireframe overlay does; the rest the wire's own. The active object is the
    // selection's last, the shell's own rule (`EditorShellStore.selectedEntityId`), which a
    // Blender document keeps by publishing its active object last.
    this.selectionColors ??= nativeSelectionColors(this.renderer.domElement);
    const colors = this.selectionColors;
    const active = this.selectedObjects.at(-1) ?? null;
    const within = (object: THREE.Object3D, owner: THREE.Object3D): boolean => {
      for (let at: THREE.Object3D | null = object; at; at = at.parent) if (at === owner) return true;
      return false;
    };
    for (const { line, source } of this.topologyFollowers) {
      line.matrixWorld.copy(source.matrixWorld);
      line.visible = source.visible;
      const material = line.material as THREE.LineBasicMaterial;
      const isActive = active !== null && within(source, active);
      const isSelected = isActive || this.selectedObjects.some((owner) => within(source, owner));
      const color = isActive ? (colors.active?.visible ?? colors.visible) : isSelected ? colors.visible : null;
      material.color.setHex(color ?? TOPOLOGY_WIRE_COLOR);
    }
  }

  private clearTopologyOverlay(): void {
    for (const { line } of this.topologyFollowers.splice(0)) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    const group = this.topologyOverlay;
    this.topologyOverlay = null;
    if (!group) return;
    group.removeFromParent();
    const index = this.helpers.indexOf(group);
    if (index >= 0) this.helpers.splice(index, 1);
  }

  setBounds(bounds: boolean): void {
    invalidateStages();
    if (this.state.bounds === bounds) return;
    this.state = { ...this.state, bounds };
    if (bounds) {
      this.boundsHelper = new THREE.BoxHelper(this.root, 0xffb454);
      this.addHelper(this.boundsHelper, 'bounds');
    } else {
      this.clearBoundsHelper();
    }
    this.notify();
  }

  setSkeleton(skeleton: boolean): void {
    invalidateStages();
    if (this.state.skeleton === skeleton) return;
    this.state = { ...this.state, skeleton };
    this.refreshSkeletonHelper();
    this.notify();
  }

  /** The neutral backdrop as installed — what a re-tint replaces. */
  neutralBackgroundTexture(): THREE.Color | THREE.Texture | null {
    return this.neutralBackground;
  }

  /** Re-tint the neutral backdrop (a palette switch re-derives the dressing's
   *  gradient, `standard-viewport-dressing.ts`). Repaints when it is showing. */
  setNeutralBackground(background: THREE.Color | THREE.Texture | null): void {
    invalidateStages();
    // A flat colour is showing when the scene wears that colour, whichever
    // `THREE.Color` instance carries it (the viewport repaints a palette's
    // flat background as its own instance).
    const current = this.scene.background;
    const neutral = this.neutralBackground;
    const showing =
      current === neutral ||
      (current instanceof THREE.Color && neutral instanceof THREE.Color && current.equals(neutral));
    this.neutralBackground = background;
    if (showing) this.scene.background = background;
  }

  setBackground(background: 'neutral' | 'transparent'): void {
    invalidateStages();
    if (this.state.background === background) return;
    this.scene.background = background === 'transparent' ? null : this.neutralBackground;
    this.state = { ...this.state, background };
    this.notify();
  }

  resetPresentation(): void {
    invalidateStages();
    // Lighting, backdrop and tone are the view's presentation (`kit/viewport-presentation`).
    resetViewPresentation(this.documentId);
    this.clearDiagnosticPresentation();
    this.state = INITIAL_PRESENTATION;
    this.refreshSkeletonHelper();
    this.clearBoundsHelper();
    this.scene.background = this.neutralBackground;
    this.viewport.camera.up.set(0, 1, 0);
    this.frame();
    this.notify();
  }

  /**
   * The step the document host runs before EVERY draw of the rendered scene.
   *
   * The host keeps the document's own `THREE.Scene` nested inside the session's
   * rendered scene and mirrors the world dressing (environment, fog, their
   * intensities/rotations, background) outward. That mirror used to live in the
   * host's per-frame `animate`, so an offscreen photograph taken between two
   * viewport ticks drew whatever the LAST tick happened to mirror — a sky set
   * synchronously before the capture was simply missing from it. Registering it
   * here puts `renderViewport` and `captureImage` on one path.
   *
   * The host owns the step and clears it in its own teardown; the session only
   * holds the reference.
   */
  setBeforeRender(step: (() => void) | null): void {
    this.beforeRender = step;
  }

  /**
   * THE PRESENTED FRAME — the stage exactly as the person is seeing it,
   * including everything drawn OVER the document's own render: the
   * orientation compass (`EditorViewport.renderViewCube`) above all.
   *
   * Why this is not {@link captureImage}: that door is an offscreen
   * re-render of the document's content, for thumbnails and asset previews,
   * and it deliberately draws the subject alone. The chrome door's promise is
   * the opposite one — "photograph the editor as the person sees it" — and
   * routing it through `captureImage` made the door LIE about this stage: the
   * compass renders every frame into the default framebuffer (measured: the
   * call is reached, `_threeSurfaceShowing` true, 24 objects, target=screen)
   * and never appeared in a single chrome frame.
   *
   * The canvas has no `preserveDrawingBuffer`, so the only place its pixels
   * can be read is inside the frame that drew them — which is why the host
   * serves the request at the end of its own `animate`
   * ({@link servePresentedFrame}), the same shape the ingest lane's
   * `LiveSession.snapshotFrame` uses.
   */
  private presentedFrameWaiters: Array<(frame: HTMLCanvasElement | null) => void> = [];
  /** True while a host render loop is servicing {@link servePresentedFrame}. */
  private presentsFrames = false;

  /** The host declares that its loop serves presented-frame requests. Without
   *  it a request answers `null` at once rather than waiting for a frame that
   *  is never coming (a document whose loop has stopped). */
  setPresentsFrames(on: boolean): void {
    this.presentsFrames = on;
    if (!on) this.resolvePresentedFrame(null);
  }

  /** Ask for the next drawn frame. `null` when no loop is serving them, and
   *  `null` again when a loop that says it serves them does not draw within
   *  {@link PRESENTED_FRAME_WAIT_MS} — a hidden tab's rAF is throttled to a
   *  stop, and a photograph door may never hang on another loop's liveness. */
  requestPresentedFrame(): Promise<HTMLCanvasElement | null> {
    if (!this.presentsFrames) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const once = (frame: HTMLCanvasElement | null): void => {
        if (settled) return;
        settled = true;
        resolve(frame);
      };
      this.presentedFrameWaiters.push(once);
      // A stage that draws on change draws for this request.
      invalidateStages();
      setTimeout(() => once(null), PRESENTED_FRAME_WAIT_MS);
    });
  }

  /** Whether the next frame must be drawn whatever else changed: a camera
   *  flight is advanced by the draw itself, and a presented-frame request is
   *  served only by a frame that draws. */
  needsFrame(): boolean {
    return this.flight !== null || this.presentedFrameWaiters.length > 0;
  }

  /** Called by the host at the END of a frame, after every overlay pass. */
  servePresentedFrame(): void {
    if (this.presentedFrameWaiters.length === 0) return;
    const source = this.renderer.domElement;
    const copy = document.createElement('canvas');
    copy.width = Math.max(1, source.width);
    copy.height = Math.max(1, source.height);
    const context = copy.getContext('2d');
    if (!context) {
      this.resolvePresentedFrame(null);
      return;
    }
    context.drawImage(source, 0, 0);
    this.resolvePresentedFrame(copy);
  }

  private resolvePresentedFrame(frame: HTMLCanvasElement | null): void {
    const waiters = this.presentedFrameWaiters;
    this.presentedFrameWaiters = [];
    for (const resolve of waiters) resolve(frame);
  }

  render(renderSolid: (camera: THREE.Camera) => void): void {
    this.beforeRender?.();
    this.boneSelectionHighlight?.update();
    const camera = this.camera();
    const mode = this.state.mode;
    this.boundsHelper?.update();
    this.selectionOrigins?.place();
    if (mode === 'uv' || mode === 'vertex-colors') {
      renderSolid(camera);
      return;
    }
    if (mode === 'wireframe' && this.topologyOverlay) {
      this.syncTopologyOverlay();
      if (this.xray.enabled && this.xray.alpha <= 0) {
        // X-RAY AT NO ALPHA: the wires alone, every surface left out of the draw. The surfaces'
        // MATERIALS stand down, not the meshes, whose children (lines, points, other objects)
        // still draw, as every wire does in Blender's.
        const hidden = new Set<THREE.Material>();
        this.root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (material?.visible) {
              material.visible = false;
              hidden.add(material);
            }
          }
        });
        try {
          renderSolid(camera);
        } finally {
          for (const material of hidden) material.visible = true;
        }
        return;
      }
      // Clay bodies, not the triangle-wireframe swap: the overlay IS the wire,
      // and the solid form behind it is what occludes the far side.
      this.shading.render(
        this.scene,
        'clay',
        () => renderSolid(camera),
        isEditorViewportShadingTarget,
      );
      return;
    }
    this.shading.render(this.scene, mode, () => renderSolid(camera), isEditorViewportShadingTarget);
  }

  /** Visible authoring draw with the editor-only native selection silhouette. */
  renderViewport(deltaSeconds = 0): void {
    this.advanceLook(deltaSeconds);
    this.ensureComposer();
    this.render((camera) => {
      const composer = this.composer;
      if (!composer) {
        // The composer's library is still in flight (see `ensureComposer`).
        // Draw straight through — the same call the offscreen capture makes —
        // so the opening frames show the asset without its selection
        // silhouette rather than nothing at all.
        this.renderer.render(this.scene, camera);
        return;
      }
      composer.setMainScene(this.scene);
      composer.setMainCamera(camera);
      composer.render(deltaSeconds);
    });
  }

  resize(width: number, height: number): void {
    invalidateStages();
    this.renderWidth = Math.max(1, width);
    this.renderHeight = Math.max(1, height);
    this.composer?.setSize(this.renderWidth, this.renderHeight);
  }

  private renderCapture(renderSolid: (camera: THREE.Camera) => void, transparent: boolean): void {
    this.render((camera) => {
      if (!transparent) {
        renderSolid(camera);
        return;
      }
      // Apply after the host mirrors its world into this scene. Environment
      // lighting stays intact; only the camera background is omitted.
      const background = this.scene.background;
      const clearColor = this.renderer.getClearColor(new THREE.Color());
      const clearAlpha = this.renderer.getClearAlpha();
      try {
        this.scene.background = null;
        this.renderer.setClearColor(0, 0);
        renderSolid(camera);
      } finally {
        this.scene.background = background;
        this.renderer.setClearColor(clearColor, clearAlpha);
      }
    });
  }

  /**
   * Fresh offscreen capture through this document's own renderer and
   * diagnostic pipeline. This does not depend on preserveDrawingBuffer and
   * therefore remains truthful after the visible canvas has presented.
   *
   * A NUMBER is a square of that size — the default shape, and the right one
   * for an unstaged look at a model. `{width, height}` renders the buffer AND
   * the camera at that aspect, so a video-shaped look comes back already
   * shaped instead of square-and-cropped. Whatever the shape, the camera is
   * matched to the BUFFER for the duration: rendering the panel's aspect
   * through a square buffer is what photographed a cube as a tall thin prism
   * on a 3.05:1 document panel, through the one look instrument an agent has.
   * The visible viewport is never touched.
   */
  captureImage(
    size:
      | number
      | {
          width: number;
          height: number;
          transparent?: boolean;
          /** Photograph through this caller-owned camera without changing its projection. */
          camera?: THREE.Camera;
        } = 512,
  ): string | null {
    const requestedWidth = typeof size === 'number' ? size : size.width;
    const requestedHeight = typeof size === 'number' ? size : size.height;
    if (!Number.isFinite(requestedWidth) || requestedWidth < 1) return null;
    if (!Number.isFinite(requestedHeight) || requestedHeight < 1) return null;
    const outputWidth = Math.min(2048, Math.round(requestedWidth));
    const outputHeight = Math.min(2048, Math.round(requestedHeight));
    const renderWidth = outputWidth * 2;
    const renderHeight = outputHeight * 2;
    // Three disables material tone mapping on ordinary render targets. A
    // byte target clips lit surfaces to white before display conversion can
    // recover them. Keep HDR values, then use the same output resolve as the
    // scene viewport so exposure, tone mapping and color space affect captures.
    const sceneTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      type: THREE.HalfFloatType,
    });
    const target = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
    const previousTarget = this.renderer.getRenderTarget();
    const previousPixelRatio = this.renderer.getPixelRatio();
    const perspective = this.viewport.camera;
    const previousAspect = perspective.aspect;
    try {
      this.captureAspect = outputWidth / outputHeight;
      const override = typeof size === 'number' ? undefined : size.camera;
      if (override) this.cameraOverride = override;
      else {
        perspective.aspect = outputWidth / outputHeight;
        perspective.updateProjectionMatrix();
      }
      this.renderer.setPixelRatio(1);
      this.renderer.setRenderTarget(sceneTarget);
      this.renderCapture(
        (camera) => this.renderSolidForCapture(camera, sceneTarget, renderWidth, renderHeight),
        typeof size !== 'number' && size.transparent === true,
      );
      viewportCaptureOutputPass(typeof size !== 'number' && size.transparent === true).render(
        this.renderer,
        target,
        sceneTarget,
        0,
        false,
      );

      const rowBytes = renderWidth * 4;
      const pixels = new Uint8Array(rowBytes * renderHeight);
      this.renderer.readRenderTargetPixels(target, 0, 0, renderWidth, renderHeight, pixels);
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = renderWidth;
      fullCanvas.height = renderHeight;
      const fullContext = fullCanvas.getContext('2d');
      if (!fullContext) return null;
      const imageData = fullContext.createImageData(renderWidth, renderHeight);
      for (let y = 0; y < renderHeight; y++) {
        const sourceRow = (renderHeight - 1 - y) * rowBytes;
        const destinationRow = y * rowBytes;
        imageData.data.set(pixels.subarray(sourceRow, sourceRow + rowBytes), destinationRow);
      }
      fullContext.putImageData(imageData, 0, 0);
      const output = document.createElement('canvas');
      output.width = outputWidth;
      output.height = outputHeight;
      const outputContext = output.getContext('2d');
      if (!outputContext) return null;
      outputContext.drawImage(fullCanvas, 0, 0, outputWidth, outputHeight);
      return output.toDataURL('image/png');
    } finally {
      this.captureAspect = null;
      this.cameraOverride = null;
      perspective.aspect = previousAspect;
      perspective.updateProjectionMatrix();
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setPixelRatio(previousPixelRatio);
      // THE COMPOSER IS SIZED AGAIN AT THE DISPLAY'S RATIO. The capture's own draw restores the
      // composer's size while the ratio is still 1 (`renderSolidForCapture`), and the composer
      // sizes its buffers from the renderer's drawing buffer: every capture (a selection's
      // preview takes one) left the view and its outline mask at CSS resolution until the next
      // resize. Measured on the stage: a crisp outline stating 4 device px drew 10 right after a
      // selection and 4 after a repaint that resized.
      this.composer?.setSize(this.renderWidth, this.renderHeight, false);
      target.dispose();
      sceneTarget.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.leaveCameraView(false);
    this.selectionOrigins?.dispose();
    this.selectionOrigins = null;
    this.settleFlight('closed');
    this.viewport.orbitControls.removeEventListener('start', this.cancelLookForHuman);
    this.unsubscribeRotateStart();
    this.unsubscribeAxisView();
    this.unsubscribeSelectionTheme();
    this.clearDiagnosticPresentation();
    this.clearBoneSelectionHighlight();
    this.clearBoundsHelper();
    this.clearSkeletonHelper();
    // The outline goes back to this renderer's pool before the composer
    // disposes its pass (`releaseThreeSelectionOutline` clears its selection).
    if (this.selectionOutline)
      releaseThreeSelectionOutline(this.renderer, this.selectionOutline, this.selectionOutlinePass);
    this.composer?.dispose();
    this.sceneRenderPass = null;
    this.selectionOutline = null;
    this.selectionOutlinePass = null;
    this.composer = null;
    this.shading.dispose();
    this.listeners.clear();
  }

  private addHelper(helper: THREE.Object3D, kind: string): void {
    helper.name = `__object3d_document_${kind}`;
    setUserData(helper, 'editorHelper', true);
    this.scene.add(helper);
    this.helpers.push(helper);
  }

  /**
   * THE LAZY DOOR for `postprocessing` (~200 kB of passes and shaders).
   *
   * The composer exists for ONE feature — the editor-owned selection
   * silhouette; `syncComposerOutput` hands the screen back to the plain scene
   * pass whenever nothing is outlined — so the library belongs with the first
   * frame of this document, not with the module that draws it. Everything an
   * Asset Lab document does before that first frame (mount, adopt, frame the
   * content) is untouched by it.
   *
   * Called from every `renderViewport`, so it must be cheap and re-entrant:
   * `composerLoading` keeps exactly one import in flight, and the continuation
   * re-checks `disposed` because a document can close mid-load.
   */
  /**
   * WHETHER THIS DOCUMENT DRAWS THE SELECTION SILHOUETTE AT ALL — a LIVE
   * switch, not just a construction-time one.
   *
   * Two callers turn it off, for different reasons. The inspector's preview
   * lane shows a subject with nothing selectable inside it, so it never needs
   * the pass — or the effect it would build per selection — and says so once.
   * A modeling document says so whenever it is in EDIT mode: Blender draws no
   * object outline there (`modeling-edit-all.png`), and the silhouette
   * otherwise follows the hierarchy selection straight through the mode
   * change. That second caller flips it while the composer is already built,
   * so turning it off must drop the outline the composer is currently drawing
   * — gating construction alone leaves the frame exactly as it was.
   */
  get selectionOutlineEnabled(): boolean {
    return this.selectionOutlineWanted;
  }
  set selectionOutlineEnabled(value: boolean) {
    if (value === this.selectionOutlineWanted) return;
    this.selectionOutlineWanted = value;
    if (value) this.syncSelectionPresentation();
    else {
      this.selectionOutline?.selection.clear();
      this.syncComposerOutput();
    }
  }
  private selectionOutlineWanted = true;

  /** Whether the view draws its selected objects' origins (`overlays.selection.origins`). */
  /** The view's X-ray for its current draw mode (`ViewportModePresentation.xray`). */
  private xray: ViewportXray = { enabled: false, alpha: 1 };

  setXray(xray: ViewportXray): void {
    if (this.xray.enabled === xray.enabled && this.xray.alpha === xray.alpha) return;
    this.xray = xray;
    invalidateStages();
  }

  set selectionOriginsEnabled(value: boolean) {
    if (value === (this.selectionOrigins !== null)) return;
    if (value) {
      this.selectionOrigins = new SelectionOrigins();
      this.scene.add(this.selectionOrigins);
      this.syncSelectionPresentation();
    } else {
      this.selectionOrigins?.dispose();
      this.selectionOrigins = null;
      invalidateStages();
    }
  }

  private ensureComposer(): void {
    if (!this.selectionOutlineWanted) return;
    if (this.composer || this.composerLoading || this.disposed) return;
    this.composerLoading = true;
    void import('postprocessing')
      .then((postprocessing) => {
        this.composerLoading = false;
        if (this.disposed || this.composer) return;
        const camera = this.camera();
        const composer = new postprocessing.EffectComposer(this.renderer);
        this.sceneRenderPass = new postprocessing.RenderPass(this.scene, camera);
        composer.addPass(this.sceneRenderPass);
        this.selectionOutline = acquireThreeSelectionOutline(
          postprocessing,
          this.renderer,
          this.scene,
          camera,
          nativeSelectionColors(this.renderer.domElement),
        );
        this.syncSelectionTheme();
        syncThreeSelectionOutline(this.selectionOutline, this.selectedObjects);
        this.selectionOutlinePass = new postprocessing.EffectPass(camera, this.selectionOutline);
        composer.addPass(this.selectionOutlinePass);
        this.composer = composer;
        this.syncComposerOutput();
        composer.setSize(this.renderWidth, this.renderHeight);
        // The outline draws from the next frame on; ask for it.
        invalidateStages();
      })
      .catch(() => {
        // A failed chunk load must not wedge the surface: the plain draw path
        // in `renderViewport` keeps the document visible, and the next frame
        // retries the import.
        this.composerLoading = false;
      });
  }

  /**
   * EffectComposer marks the last added pass as the screen output. Disabling
   * that pass without transferring screen ownership to the scene pass leaves
   * the unoutlined frame stranded in the composer's offscreen buffer. Keep
   * selection responsible only for the outline, never for whether the asset
   * itself reaches the canvas.
   */
  /**
   * Draw the scene FOR A PHOTOGRAPH into `target` the way the screen sees it:
   * through the outline pass when a selection silhouette is on (the outline is
   * a pass, absent from a plain draw — a capture without it lied about the
   * screen), the plain draw otherwise.
   *
   * The two passes are driven DIRECTLY rather than through `composer.render()`,
   * because neither of the composer's own doors says where a frame landed:
   * `EffectComposer.render` ping-pongs LOCAL variables and never reassigns
   * `inputBuffer`/`outputBuffer`, and `CopyPass.render` ignores its
   * `outputBuffer` argument entirely (it always writes to its own render
   * target, 1x1 unless the composer sized it). Going through them wrote the
   * photograph nowhere — every capture of a selected object came back empty.
   * A pass's own contract is exact: `RenderPass` draws the scene into the
   * `inputBuffer` it is handed, `EffectPass` reads that and writes the
   * `outputBuffer` it is handed — so hand the outline pass the capture target.
   */
  private renderSolidForCapture(
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget,
    width: number,
    height: number,
  ): void {
    const composer = this.composer;
    const outlined = (this.selectionOutline?.selection.size ?? 0) > 0;
    if (!composer || !outlined || !this.sceneRenderPass || !this.selectionOutlinePass) {
      this.renderer.render(this.scene, camera);
      return;
    }
    const previousWidth = this.renderWidth;
    const previousHeight = this.renderHeight;
    try {
      this.sceneRenderPass.renderToScreen = false;
      this.selectionOutlinePass.renderToScreen = false;
      composer.setSize(width, height, false);
      this.sceneRenderPass.render(this.renderer, composer.inputBuffer, composer.outputBuffer, 0);
      this.selectionOutlinePass.render(this.renderer, composer.inputBuffer, target, 0);
    } finally {
      composer.setSize(previousWidth, previousHeight, false);
      this.syncComposerOutput();
      this.renderer.setRenderTarget(target);
    }
  }

  private syncComposerOutput(): void {
    const outlined = (this.selectionOutline?.selection.size ?? 0) > 0;
    if (this.sceneRenderPass) this.sceneRenderPass.renderToScreen = !outlined;
    if (this.selectionOutlinePass) {
      this.selectionOutlinePass.enabled = outlined;
      this.selectionOutlinePass.renderToScreen = outlined;
    }
  }

  private refreshSkeletonHelper(): void {
    const visible = this.state.skeleton || this.boneSelectionHighlight !== null;
    if (visible && !this.skeletonHelper) {
      this.skeletonHelper = new THREE.SkeletonHelper(this.root);
      styleEditorSkeletonHelper(this.skeletonHelper);
      this.scene.add(this.skeletonHelper);
    } else if (!visible) {
      this.clearSkeletonHelper();
    }
  }

  private clearSkeletonHelper(): void {
    if (!this.skeletonHelper) return;
    this.skeletonHelper.removeFromParent();
    this.skeletonHelper.dispose();
    this.skeletonHelper = null;
  }

  private clearBoneSelectionHighlight(): void {
    if (!this.boneSelectionHighlight) return;
    this.boneSelectionHighlight.removeFromParent();
    this.boneSelectionHighlight.dispose();
    this.boneSelectionHighlight = null;
  }

  private clearBoundsHelper(): void {
    if (!this.boundsHelper) return;
    const helper = this.boundsHelper;
    this.boundsHelper = null;
    const index = this.helpers.indexOf(helper);
    if (index >= 0) this.helpers.splice(index, 1);
    helper.removeFromParent();
    helper.geometry.dispose();
    if (Array.isArray(helper.material))
      helper.material.forEach((material) => {
        material.dispose();
      });
    else helper.material.dispose();
  }

  private frameBones(bones: readonly THREE.Bone[]): void {
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const bone of bones) {
      bounds.expandByPoint(bone.getWorldPosition(point));
      if ((bone.parent as THREE.Bone | null)?.isBone) {
        bounds.expandByPoint(bone.parent!.getWorldPosition(point));
      }
      for (const child of bone.children) {
        if ((child as THREE.Bone).isBone) bounds.expandByPoint(child.getWorldPosition(point));
      }
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const minimumSpan = Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.2);
    bounds.expandByScalar(minimumSpan * 0.35);
    const direction = this.viewport.camera.position
      .clone()
      .sub(this.viewport.orbitControls.target)
      .normalize();
    const distance = perspectiveDistanceToFitBox(bounds, this.viewport.camera, direction);
    this.viewport.setPose(center.clone().addScaledVector(direction, distance), center);
  }

  private syncOrthographicCamera(): void {
    const source = this.viewport.camera;
    const target = this.viewport.orbitControls.target;
    const distance = Math.max(source.position.distanceTo(target), 0.001);
    const halfHeight = Math.max(
      distance * Math.tan(THREE.MathUtils.degToRad(source.fov) / 2),
      0.001,
    );
    const width = Math.max(this.renderer.domElement.clientWidth, 1);
    const height = Math.max(this.renderer.domElement.clientHeight, 1);
    // The offscreen capture renders into its OWN buffer shape — see
    // `captureImage`; outside one, the panel's box is the aspect.
    const aspect = this.captureAspect ?? width / height;
    this.orthographicCamera.left = -halfHeight * aspect;
    this.orthographicCamera.right = halfHeight * aspect;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.near = source.near;
    this.orthographicCamera.far = source.far;
    this.orthographicCamera.position.copy(source.position);
    this.orthographicCamera.quaternion.copy(source.quaternion);
    this.orthographicCamera.up.copy(source.up);
    this.orthographicCamera.layers.mask = source.layers.mask;
    this.orthographicCamera.updateProjectionMatrix();
    this.orthographicCamera.updateMatrixWorld(true);
  }

  private clearDiagnosticPresentation(): void {
    this.clearTopologyOverlay();
    this.scene.overrideMaterial?.dispose();
    this.scene.overrideMaterial = null;
    for (const helper of this.helpers.splice(0)) {
      helper.removeFromParent();
      const line = helper as THREE.Line;
      line.geometry?.dispose();
      const material = line.material;
      if (Array.isArray(material))
        material.forEach((entry) => {
          entry.dispose();
        });
      else material?.dispose();
    }
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

// Compatibility for existing internal callers/tests; lookup-only consumers
// import the registry directly so they do not pull this implementation graph.
export {
  __resetObject3DDocumentSessionsForTest,
  allObject3DDocumentSessions,
  object3DDocumentSession,
  object3DDocumentSessionsVersion,
  registerObject3DDocumentSession,
  subscribeObject3DDocumentSessions,
} from './object3d-document-session-registry';

/**
 * OBJECT ORIGINS: a dot at the origin of each selected object, drawn over everything at a fixed
 * pixel size — Blender's "Origins" overlay (`overlays.selection.origins` in
 * `@volter/editor-sdk/kit/viewport-presentation`). Blender draws it one pixel wider than its
 * Object Origin Size (default 6; `overlay_instance.cc`: `obcenter_dia + 1`) with a one-pixel
 * dark rim, and in the active object's
 * colour for the active object; the kit's rule for the active colour stands in for that: a lone
 * selected object is shown in the look's active colour, several in its selection colour, the
 * same rule the outline follows.
 *
 * The positions are read from each object's world matrix as the frame is drawn, so a dot follows
 * a drag without the selection having to change.
 */
/** Blender's drawn origin diameter at the default Object Origin Size, in CSS pixels. three
 *  scales a point's size by the pixel ratio itself (`WebGLMaterials.refreshUniformsPoints`). */
const ORIGIN_SIZE_PX = 7;

let dotTexture: THREE.Texture | null = null;
/** A filled disc with a thin dark rim, white where the colour goes. */
function originDotTexture(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0, 0, 0, 0.75)';
  context.fill();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();
  dotTexture = new THREE.CanvasTexture(canvas);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

class SelectionOrigins extends THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  private objects: readonly THREE.Object3D[] = [];
  private readonly origin = new THREE.Vector3();

  constructor() {
    super(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        map: originDotTexture(),
        size: ORIGIN_SIZE_PX,
        sizeAttenuation: false,
        transparent: true,
        alphaTest: 0.05,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.name = 'vgai:selection-origins';
    this.userData['editorHelper'] = true;
    this.renderOrder = 1000;
    this.frustumCulled = false;
    this.raycast = () => {};
  }

  /** The selected objects and the colours their dots take (`active` for a lone selection). */
  update(objects: readonly THREE.Object3D[], colors: { readonly visible: number; readonly active?: number }): void {
    this.objects = objects;
    this.material.color.setHex(objects.length === 1 && colors.active !== undefined ? colors.active : colors.visible);
    this.visible = objects.length > 0;
  }

  /**
   * Before each draw: the dots where their objects are now. Called by the session's `render`
   * BEFORE the renderer starts, never from `onBeforeRender`: three uploads a geometry's
   * attributes while it builds the render list, so an attribute replaced in `onBeforeRender` is
   * drawn un-uploaded, and every dot falls to the Points object's own origin.
   */
  place(): void {
    const count = this.objects.length;
    let attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    // Grown, never shrunk, and drawn to `count`: a replaced attribute's GL buffer is not freed.
    if (attribute === undefined || attribute.count < count) {
      this.geometry.dispose();
      attribute = new THREE.BufferAttribute(new Float32Array(Math.max(count, 8) * 3), 3);
      this.geometry.setAttribute('position', attribute);
    }
    this.geometry.setDrawRange(0, count);
    this.objects.forEach((object, index) => {
      object.getWorldPosition(this.origin);
      attribute.setXYZ(index, this.origin.x, this.origin.y, this.origin.z);
    });
    attribute.needsUpdate = true;
  }

  dispose(): void {
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
