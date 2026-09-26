import type { SparkRenderer } from '@sparkjsdev/spark';
import { invalidateStages } from '@volter/editor-sdk/kit/stage-invalidation';
import { StagePresentationRig } from './components/standard-viewport-dressing';
import {
  bindViewPresentation,
  subscribeViewportPresentation,
  type ViewportOverlays,
  viewPresentation,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { themeVars, zIndex } from '@volter/editor-sdk/widgets';
import type { AssetDropContext, AuthoringAdapter } from '@volter/editor-project/adapter';
import {
  EDITOR_CAMERA_FAR,
  EDITOR_CAMERA_NEAR,
  fitClipPlanes,
} from '@volter/editor-threejs/viewport/clip-planes';
import {
  ContentBoundsHelper,
  collectContentNodeBoxes,
  contentWorldBounds,
  expandBoxByContent,
} from '@volter/editor-threejs/viewport/content-bounds';
import { EDITOR_LAYER, isInEditorOwnedSubtree } from '@volter/editor-threejs/viewport/editor-layers';
import { constraintsOf } from '@volter/editor-threejs/adapter/constraint';
import { reflectionProbeOf } from '@volter/editor-threejs/adapter/reflection-probe';
import { triggerVolumeOf } from '@volter/editor-threejs/adapter/trigger-volume';
import { getUserData, setUserData } from '@volter/editor-threejs/ecs/user-data';
import {
  disposeSparkRendererWhenIdle,
  sceneHasGaussianSplat,
  shouldDiscoverGaussianSplat,
} from '@volter/editor-threejs/render/spark-renderer-lifecycle';
import * as THREE from 'three';
import { axisViewName, isQuarterTurnUp } from './asset-workflow/model-inspection';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { BatchedRenderer } from 'three.quarks';
import {
  applyAuthoringTransform,
  beginAuthoringTransformEdit,
  dropAuthoringAsset,
  endAuthoringTransformEdit,
  setAuthoringSelection,
  spatialHandlesForAdapter,
} from '@volter/editor-sdk/kit/authoring/consumer-actions';
import { beginLiveGesture, endLiveGesture } from '@volter/editor-sdk/kit/live-gesture-lock';
import { drillIntoSelectionScope, pickAcrossScopeExit } from '@volter/editor-sdk/kit/authoring/selection-scope';
import { setViewportPickContext } from './authoring/viewport-pick-context';
import { isRootHidden } from '@volter/editor-sdk/kit/authoring/world-session-state';
import type { CameraViewMode } from './camera-authoring';
import { type ConstraintControl, ConstraintHelper } from './constraint-helper';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from './editor-shell-store';
import { findEntityLod } from './entity-lod';
import { entityIdOf, entityObject3D } from './entity-object';
import { describeInstancedPresentation, instancedUnitCount } from './instanced-presentation';
import {
  type NativeGizmoLook,
  type NativeViewportLook,
  nativeGizmoLook,
  nativeSelectionColors,
  nativeViewportGizmoSize,
  nativeViewportLook,
  nativeViewportGrid,
  nativeViewportSelectionBox,
  nativeViewportWire,
  subscribeNativeSelectionTheme,
} from '@volter/editor-sdk/kit/native-selection-style';
import { presentationRegionBasis } from '@volter/editor-sdk/kit/presentation-surface';
import { ReflectionProbeHelper } from './reflection-probe-helper';
import { frameableContentBounds, seededViewShowsWorld, viewFromGameCamera } from './scene-framing';
import {
  createSpatialHandleVisuals,
  disposeSpatialHandleVisuals,
  type SpatialHandleBinding,
  type SpatialHandleMesh,
  scaleSpatialHandle,
  setSpatialHandleHovered,
  spatialHandleBinding,
} from './spatial-handle-visuals';
import { perspectiveDistanceToFitBox } from './three-viewport/camera-fit';
import { SelectionBrackets } from './three-viewport/selection-brackets';
import { collectThreeSelectionOutlineTargets } from './three-viewport/selection-outline';
import { toneMappedSourceColor } from './three-viewport/source-color';
import type { ThreeViewportProjection } from '@volter/editor-sdk/kit/three-viewport-presentation';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import { activeKeymapNavigation, subscribeEditorKeymap } from '@volter/editor-sdk/kit/keymap-presets';
import { TriggerVolumeHelper } from './trigger-volume-helper';
import { viewportAuthoringPolicy } from './viewport-authoring-policy';
import { ensureThreeIntegration } from './three-integration';

/** A bounds box or LineSegments wireframe tagged with its source entity object. */
/** A selected mesh's wireframe (the view's `selection.wire` overlay, Unity's Selection Wire):
 *  a stage-owned line set that copies the mesh's world matrix each frame, never a child of it. */
interface WireHelper extends THREE.LineSegments {
  _wireOf?: THREE.Object3D;
}

interface TaggedHelper extends ContentBoundsHelper {
  isBoxHelper: boolean;
  _entityObj?: THREE.Object3D;
}

/**
 * The shell map publishes every authoring node, including ancestors and their
 * descendants. Calling `traverse` from every map value therefore revisits a
 * nested graph once per depth level. Return only published objects with no
 * published ancestor so a whole-graph helper pass visits each native object
 * once while still reaching unprojected implementation children.
 */
export function topmostPublishedObjects(
  objectMap: ReadonlyMap<string, THREE.Object3D>,
): THREE.Object3D[] {
  const published = new Set(objectMap.values());
  const roots: THREE.Object3D[] = [];
  for (const object of published) {
    let parent = object.parent;
    let nested = false;
    while (parent !== null) {
      if (published.has(parent)) {
        nested = true;
        break;
      }
      parent = parent.parent;
    }
    if (!nested) roots.push(object);
  }
  return roots;
}

/** Topmost live objects among an exact add/remove delta; removed ids contribute nothing. */
export function topmostChangedObjects(
  objectMap: ReadonlyMap<string, THREE.Object3D>,
  changedIds: ReadonlySet<string>,
): THREE.Object3D[] {
  const changed = new Set<THREE.Object3D>();
  for (const id of changedIds) {
    const object = objectMap.get(id);
    if (object) changed.add(object);
  }
  return [...changed].filter((object) => {
    for (let parent = object.parent; parent !== null; parent = parent.parent) {
      if (changed.has(parent)) return false;
    }
    return true;
  });
}

/**
 * Everything the viewport parks in `_boxHelpers`: the Bounds diagnostic's
 * plain full boxes (and its degenerate-entity wire cubes), plus selection
 * brackets for nodes that have no renderable silhouette. They share one map
 * because every consumer treats them identically — hide for the camera
 * preview, re-add on `setScene`, refresh each frame, dispose on rebuild.
 */
type BoundsHelper = ContentBoundsHelper | THREE.LineSegments | SelectionBrackets;

interface PreservedChildTransform {
  id: string;
  obj: THREE.Object3D;
  worldMatrix: THREE.Matrix4;
}

/** Edge length of the wire cube / bracket cage drawn for entities that own no
 *  renderable geometry (cameras, lights, audio sources). */
const DEGENERATE_HELPER_SIZE = 0.5;

/** How long a scene-wide content-bounds measurement stays usable. Long enough
 *  that a full-graph walk is not a per-frame cost, short enough that a world
 *  streaming itself in is reached within a second. */
const CONTENT_BOUNDS_MAX_AGE_MS = 1000;

/** The two ground-plane normals a region's declared basis selects between.
 *  Shared constants: `Plane.set` copies the normal, so nothing here is handed a
 *  reference it could mutate. */
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_Z = new THREE.Vector3(0, 0, 1);

/** Scratch for the clip-plane fit — one per module, same reason as
 *  `content-bounds.ts`'s `nodeBox`. */
const _clipSphere = new THREE.Sphere();
/** Gizmo-anchor scratch — see the two pivot branches in `_syncSelection`. */
const _medianTmp = new THREE.Vector3();
const _pivotPos = new THREE.Vector3();
const _pivotQuat = new THREE.Quaternion();
const _pivotScale = new THREE.Vector3();
/** Below this (squared, world units) the content centre and the object's own
 *  origin are the same place, and the centre anchor has nothing to move. */
const CENTRE_ANCHOR_EPSILON_SQ = 1e-8;

/** View directions indexed by click-target userData. */
const VC_DIRS: THREE.Vector3[] = [
  /* 0 +X */ new THREE.Vector3(1, 0, 0),
  /* 1 -X */ new THREE.Vector3(-1, 0, 0),
  /* 2 +Y */ new THREE.Vector3(0, 1, 0),
  /* 3 -Y */ new THREE.Vector3(0, -1, 0),
  /* 4 +Z */ new THREE.Vector3(0, 0, 1),
  /* 5 -Z */ new THREE.Vector3(0, 0, -1),
];

/**
 * THE EDITOR'S OWN TRANSFORM-GIZMO AXIS COLOURS (X/Y/Z), used when the look names no
 * `color.gizmo` group. Their values are Godot's editor axis colours (`theme_modern.cpp`,
 * `axis_x_color`…). Kept as plain `[r,g,b]` triples: call sites construct their own
 * `new THREE.Color(...)`, so nothing here can be mutated in place.
 */
const KIT_GIZMO_AXIS_RGB: readonly [number, number, number][] = [
  [0.96, 0.2, 0.32], // X
  [0.53, 0.84, 0.01], // Y
  [0.16, 0.55, 0.96], // Z
];

/**
 * WHAT THREE'S X, Y AND Z ARE CALLED IN THE WORLD THIS STAGE IS PRESENTING.
 *
 * Entry `i` answers for three's axis `i`: the SOURCE axis it carries (0=X,
 * 1=Y, 2=Z) and the SIGN that source axis's positive direction has in three.
 * Everything a person reads off the two gizmos — the colour of a handle, the
 * side its arm is drawn on, the quadrant a plane square sits in, and the six
 * labels on the navigation balls — is that table and nothing else. No matrix
 * is touched: the transform write is still `P⁻¹ · matrixWorld` and the engine
 * still decomposes it (`blender-outliner-authoring.ts`). This is naming, and
 * it is here because naming is the viewport's.
 *
 * The Z-up row IS the presented root's own permutation, read as a table: that
 * root carries `(x, y, z) → (x, z, −y)`, so three's Y is the source's Z with
 * sign +1 and three's Z is the source's Y with sign −1. One fact, two
 * spellings, and the matrix is the authority — see
 * `blender-runtime-view.ts`'s constructor.
 *
 * Chosen by the look (`StageContribution.upAxis`), never by the
 * document: the stage draws one world at a time and the look is what states
 * which program's viewport this is.
 */
type StageAxisFrame = readonly (readonly [axis: number, sign: 1 | -1])[];
const AXIS_FRAME_Y_UP: StageAxisFrame = [
  [0, 1],
  [1, 1],
  [2, 1],
];
const AXIS_FRAME_Z_UP: StageAxisFrame = [
  [0, 1],
  [2, 1],
  [1, -1],
];
/** A LEFT-handed Z-up world (Unreal's): three's Z carries the source's +Y, the mirror that
 *  presents a left-handed frame in three's right-handed one. */
const AXIS_FRAME_Z_UP_LEFT: StageAxisFrame = [
  [0, 1],
  [2, 1],
  [1, 1],
];
/** The label a source axis index carries on the navigation gizmo. */
const AXIS_LETTER = ['X', 'Y', 'Z'] as const;

/**
 * An ONLINE asset dropped on the viewport — the asset browser's drag payload,
 * verbatim. An `url` means the file to fetch is already known; without one the
 * source has to be asked for its file list first.
 */
export interface OnlineAssetDrop {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url?: string;
  readonly format?: string;
  readonly includes?: { relativePath: string; url: string; size: number }[];
}

/**
 * THE VIEWPORT'S ONE DOOR TO THE ONLINE ASSET LIBRARY — a collaborator the
 * SHELL installs, never a transport the viewport imports (ARCHITECTURE-CORE
 * §Editor chrome, "the viewport stack is separable").
 *
 * The viewport contributes what only it knows: the world point under the
 * cursor, and the adapter that owns what a dropped path MEANS. Everything the
 * download needs — the asset cache, the source's file list, the project's
 * download history, and the console report when it fails — is the shell's
 * (`world-root-stage.ts` installs it over `editor-api.ts` +
 * `asset-editor-persistence.ts`, which together weigh 64 files the gizmo
 * viewport otherwise carries to place a chair).
 *
 * Returns the PROJECT-LOCAL path to hand the adapter's `assetDrop`, or `null`
 * when the asset could not be resolved — in which case the resolver has
 * already SAID SO on the console, so the viewport stays quiet. A rejection is
 * the resolver failing to report at all, and the viewport reports that itself.
 */
export type OnlineAssetResolver = (asset: OnlineAssetDrop) => Promise<string | null>;

export interface EditorViewportOptions {
  /** Native renderer for renderer-coupled Three extensions such as Spark. */
  readonly renderer?: THREE.WebGLRenderer;
  /** How a dropped ONLINE asset becomes a project path. Omit and an online
   *  drop is REFUSED BY NAME on the console — see {@link OnlineAssetResolver}. */
  readonly onlineAssetResolver?: OnlineAssetResolver;
  /** Document-local adapter. Omit for the editor's active project adapter. */
  readonly authoring?: () => AuthoringAdapter;
  /** Document-local picking when this viewport is not the project viewport. */
  readonly pick?: (clientX: number, clientY: number) => string | null;
  /** The camera the stage draws with, when that is not the viewport's own (a document session's
   *  orthographic or camera view): screen tests such as the box select project through it. */
  readonly drawCamera?: () => THREE.Camera;
  /** Only the one project viewport publishes the legacy global pick context. */
  readonly publishPickContext?: boolean;
  readonly onProjectionChange?: (projection: ThreeViewportProjection) => void;
  /**
   * How far the canvas BLEEDS past the box a person can see, in CSS px.
   *
   * A document stage inflates its canvas (`StageHost.tsx`, `inset: -12`) so
   * the image fills the dock panel edge to edge, and gives the DOM furniture
   * that bleed back (`inset: 12`) so the chrome stays inside the panel. The
   * ORIENTATION GIZMO is drawn on the canvas, not in the DOM, so it never got
   * that correction: measured on the Model stage, the canvas runs to page x
   * 1437.5 where the panel ends at 1419, and the gizmo — placed 5 px from the
   * CANVAS edge — had its −Z ball cut off by the Inspector. That is the same
   * defect the furniture's own docblock records fixing for the navigation
   * cluster. One value, set from the one expression that positions the DOM
   * furniture; every other host leaves it 0.
   */
  readonly chromeInsetPx?: number;
  /**
   * The editor's own DESIGN-TIME LIGHT RIG (the ambient and the directional
   * this class adds to every scene it is given). Default on. `false` is a
   * host saying the content lights itself — which is the same thing a
   * document says by turning the standard dressing's key light off, and the
   * rig has to hear it. MEASURED: the rig's lights sit on `EDITOR_LAYER`,
   * but three filters lights by the CAMERA's layers
   * (`WebGLRenderer.projectObject`), and the camera that draws a document
   * stage enables that layer so it can see the grid and the gizmo — so the
   * layer scopes the rig away from nobody, and a document lit by its own
   * view-locked studio was being lit by this as well.
   */
  readonly lightRig?: boolean;
}

/**
 * The floor grid as a shader over one plane (`extent` metres square, y = 0).
 * Lines are `fwidth`-antialiased so they keep one on-screen width at every
 * distance; the 1 m level fades out where its cells fall under a few pixels
 * (Blender's adaptive grid never lets lines merge), the 10 m level stays; the
 * whole floor fades to its edge. `uColor` is the palette's grid colour
 * (`_applyViewportLook`). Depth-tested, never written: content standing on
 * the floor occludes it, and it occludes nothing.
 */
/**
 * THE STAGE'S LENS — Blender's, and the reason the viewport's field of view is derived rather
 * than stored.
 *
 * Blender holds an ANGLE on the larger of the region's two dimensions (sensor fit AUTO), so a
 * wider panel sees no more world sideways and a shorter one sees less vertically — which is why
 * three's vertical `fov` cannot be a constant here.
 *
 * The angle is the view's own arithmetic (`BKE_camera_params_from_view3d`,
 * `BKE_camera_params_compute_viewplane`): the 36 mm sensor over the View's lens
 * (`View3D.lens`, 50 at factory startup, read back from Blender 5.2; {@link EditorViewport.setLens}), times the viewport's
 * `CAMERA_PARAM_ZOOM_INIT_PERSP` of 2. The same zoom scales an orthographic view's
 * `dist * sensor / lens`, so the two projections agree at the pivot.
 */
const STAGE_LENS_MM = 50;

/** three's fov is VERTICAL; Blender's lens angle is on the larger dimension. `lens` is the view's
 *  focal length in mm over the 36 mm sensor. */
export function stageVerticalFovDegrees(aspect: number, lens = STAGE_LENS_MM): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.01 ? aspect : 1;
  const safeLens = Number.isFinite(lens) && lens > 0 ? lens : STAGE_LENS_MM;
  const halfLensAngle = Math.atan((36 * 2) / (2 * safeLens));
  // Sensor fit AUTO: the angle belongs to the longer side.
  const halfVertical =
    safeAspect >= 1 ? Math.atan(Math.tan(halfLensAngle) / safeAspect) : halfLensAngle;
  return THREE.MathUtils.radToDeg(halfVertical * 2);
}

/** The direction the stage opens from, Blender's default user perspective:
 *  elevation 26.5°, azimuth −23.8° about the up axis — SOLVED from the
 *  reference's two floor axes, whose projected slopes there are +1.0093 (X)
 *  and −0.1969 (Y). In three's Y-up frame that is this unit vector. */

/** A colour's hue, saturation and value (each 0..1), in whatever channels it carries. */
function rgbToHsv(color: THREE.Color): { h: number; s: number; v: number } {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === color.r) h = ((color.g - color.b) / d + 6) % 6;
    else if (max === color.g) h = (color.b - color.r) / d + 2;
    else h = (color.r - color.g) / d + 4;
    h /= 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToColor(h: number, s: number, v: number, out: THREE.Color): THREE.Color {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6]!;
  return out.setRGB(r!, g!, b!);
}

/** The navigation gizmo's axis colours, read off Blender's own balls in
 *  `modeling-object-none.png`: X (245,54,81), Y (111,164,27), Z (46,131,227).
 *  They are NOT the floor axes' palette hexes — the gizmo is drawn straight,
 *  without the stage's view transform, so it is sampled where it lands. */
const COMPASS_AXIS_COLOR: readonly THREE.Color[] = [
  new THREE.Color(0xf53651),
  new THREE.Color(0x6fa41b),
  new THREE.Color(0x2e83e3),
];

/**
 * One ball of the navigation gizmo: filled with its letter (a positive axis),
 * or the ring Blender draws for a negative one.
 *
 * BOTH FORMS MUST REACH THE SAME EDGE, and they did not. The disc was filled
 * to `size/2 − 5` while the ring's 8 px stroke straddled that radius and
 * reached `size/2 − 1`, so a POSITIVE ball drew 0.844 of its sprite and a
 * negative one 0.969 — measured live on the Model stage, +X came out 11.8 CSS
 * beside −X's 15.5, the filled ball SMALLER than the hollow one beside it.
 * Blender's are one size (its variation is depth, which the caller applies).
 * One outer radius here, the ring's stroke laid inside it.
 *
 * THE LETTER is not black. Measured on Blender's +X ball: glyph ink
 * (88,19,29) over a (245,54,81) fill — 0.359 / 0.352 / 0.358 of the ball's
 * own colour, one ratio in all three channels, so it is the axis colour
 * darkened rather than a neutral. Cap height 7.5 CSS on a 17.5 CSS ball.
 */
const COMPASS_LETTER_INK = 0.356;
const COMPASS_LETTER_CAP_FRACTION = 7.5 / 17.5;

/** A LETTER ALONE in its axis colour, for the cone and triad forms (Unity letters its cones,
 *  Unreal its triad's tips); two texels per screen pixel, as the balls are. */
function compassLetterTexture(color: THREE.Color, letter: string): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.font = `bold ${Math.round(size * 0.8)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The ball's parts, WHITE, for the per-frame tint (`_syncOrientationGizmoDepth`): its disc, its
 *  ring and its letter share one outer radius, the ring's stroke laid inside it. */
function compassCanvas(paint: (ctx: CanvasRenderingContext2D, size: number, outer: number) => void): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // One pixel of texture margin for the edge's own anti-aliasing; the caller's `ballUnits` is this
  // outer diameter, so what is asked for is what lands.
  if (ctx) paint(ctx, size, size / 2 - 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function compassDiscTexture(): THREE.CanvasTexture {
  return compassCanvas((ctx, size, outer) => {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, outer, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
}

function compassRingTexture(): THREE.CanvasTexture {
  return compassCanvas((ctx, size, outer) => {
    const strokeWidth = (COMPASS_STALK_WIDTH_PX / COMPASS_BALL_BACK_PX) * size;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, outer - strokeWidth / 2, 0, Math.PI * 2);
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
}

function compassGlyphTexture(text: string): THREE.CanvasTexture {
  return compassCanvas((ctx, size, outer) => {
    // A cap height is ~0.72 of a sans font's size, so the size that draws the measured cap is the
    // cap over that; a negative's `-Y` is narrowed to stay inside its ball.
    const capPx = COMPASS_LETTER_CAP_FRACTION * (2 * outer);
    const fontPx = Math.round(capPx / 0.72);
    ctx.font = `bold ${fontPx}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 2, 2 * outer * 0.86);
  });
}

const STAGE_OPENING_DIRECTION = new THREE.Vector3(0.8187, 0.4458, 0.3617);

/**
 * THE COMPASS'S BOX, AND THE GIZMO'S OWN SIZES — re-measured 2026-09-19 from
 * `modeling-edit-none.png` and `modeling-object-none.png` at their native 2x,
 * and the numbers they replace were not small errors.
 *
 * THE METHOD, because a ball-centre distance read straight off the frame is
 * the wrong number: every axis is FORESHORTENED by the view, so the one thing
 * that can be measured is the projection. The main camera's own basis comes
 * out of the floor calibration (see {@link GRAZING_FADE_GLSL}); an axis `a`
 * lands at `R · (a·right, −a·up)` from the gizmo's centre, and the three
 * NEGATIVE balls (no stalk to contaminate a centroid) then give three
 * equations for `R` and the centre. Solved: R = 63.9 device px = **31.96 CSS**
 * with the centre at (2734.2, 257.3) device, cross-checked by the third ball
 * to within one device pixel and by the ink bbox (2·R·0.9155 + ball = 150
 * device against 149 measured). The previous `28` came from reading a
 * foreshortened distance as if it were the radius.
 *
 * BALL DIAMETER is not one number either: Blender scales it with DEPTH, which
 * an orthographic gizmo camera does not do for free. Six balls, against
 * `facing` = (axis·view + 1)/2 — the same quantity
 * `_syncOrientationGizmoDepth` already fades with:
 *
 *   facing   0.09   0.28   0.32   0.68   0.72   0.91
 *   d (CSS)  15.25  15.75  16.12  17.00  16.75  17.50
 *
 * — a straight line, `d = 15.0 + 2.75·facing`, residual ≤ 0.25 CSS on all six.
 *
 * PLACEMENT, measured identically in both frames: the gizmo's coloured ink
 * spans 74.5 × 73.5 CSS centred on that solved centre, its right edge 8.5 CSS
 * inside the region's right edge and its top 38 CSS below the region's top.
 * (The old `14` and `39.5` were the same reading taken against a smaller
 * drawn circle.) The navigation cluster's first glyph sits 16 CSS under the
 * ink, its glyphs 16 CSS on a 30 CSS pitch — which ours already draws
 * exactly, so only where the cluster STARTS moves.
 *
 * The box is the scissored square the gizmo draws into; the geometry reaches
 * `stalk + ball/2` = 40.2 px from the centre, so 90 still contains it.
 */
export const COMPASS_BOX_PX = 90;
/** Blender's gizmo sphere: the distance from the centre to a ball's centre. */
const COMPASS_STALK_PX = 32;
/** The ball's diameter at the BACK of the gizmo, and how much the front adds. */
const COMPASS_BALL_BACK_PX = 15;
const COMPASS_BALL_DEPTH_GAIN_PX = 2.75;
/** The stalk's drawn width. Blender's measures 4 device px at native 2x. */
const COMPASS_STALK_WIDTH_PX = 2;
/** The gizmo's coloured ink, as it lands on screen under this view. */
const COMPASS_INK_WIDTH_PX = 74.5;
const COMPASS_INK_HEIGHT_PX = 73.5;
const COMPASS_MARGIN_RIGHT_PX = 8.5 + COMPASS_INK_WIDTH_PX / 2 - COMPASS_BOX_PX / 2;
const COMPASS_MARGIN_TOP_PX = 38 + COMPASS_INK_HEIGHT_PX / 2 - COMPASS_BOX_PX / 2;
/**
 * Where the navigation cluster starts. Blender's first GLYPH sits 16 CSS
 * under the gizmo's ink; the cluster component pads 14.5 CSS above its own
 * first glyph (measured on our frame), so the constant is that gap less the
 * padding.
 */
export const COMPASS_CLUSTER_TOP_PX =
  COMPASS_MARGIN_TOP_PX + COMPASS_BOX_PX / 2 + COMPASS_INK_HEIGHT_PX / 2 + 16 - 14.5;

/**
 * THE GRAZING FADE — the floor's depth, transcribed from Blender's own frames.
 *
 * The radial band below keeps a finite grid off a hard rim; it says nothing
 * about DEPTH, and at a document camera standing 11 m from a 1 m subject the
 * band (110–200 m) never engages inside the visible floor. Measured on our
 * Model stage: the 1 m line reads 84 and the X axis `203,41,63` at EVERY
 * depth, from the front of the frame to the horizon — a flat lattice, which
 * is what a fresh viewer names first.
 *
 * WHAT BLENDER DOES, measured (not read out of its source): calibrate
 * `modeling-edit-none.png` from its own floor — fit the two axis lines, index
 * the 1 m grid crossings along each (a 1D projective map, residual <0.05 of a
 * cell), and solve the camera from the two vanishing points with the
 * principal point at the region centre. That gives f = 1976 device px
 * (Blender's viewport lens: 50 mm on its DEFAULT_SENSOR_WIDTH of 72 mm),
 * camera 17.96 m out at elevation 26.46°, azimuth −23.82° — which reproduces
 * the elevation and azimuth `STAGE_OPENING_DIRECTION` was independently
 * solved from, so the calibration is checked against something already in
 * this repo. Sampling the X axis at thirteen known floor points, its ink over
 * the `#3f3f3f` floor, IN LINEAR LIGHT (the blend happens before the sRGB
 * encode — read as sRGB levels the profile fits nothing):
 *
 *   camera dist  12.3   15.6   22.2   28.6   45.9   70.5   115.2  (metres)
 *   alpha        0.943  0.963  0.872  0.766  0.572  0.426  0.258
 *   1-(1-h/r)^4  0.985  0.944  0.832  0.731  0.535  0.383  0.250
 *   ratio        0.957  1.020  1.048  1.048  1.068  1.113  1.033
 *
 * So the fade is `1 - (1 - |V·n|)^4` over the unit fragment→camera vector and
 * the floor normal — the GRAZING ANGLE, flat to ±6% across a 9x range of
 * distance. Two frames of the same scene at different view distances
 * (`modeling-near.png`, `modeling-far.png`) put the axis at the same PIXELS
 * with ink within 3–5%, which is the same statement: the profile follows the
 * angle, not the metres.
 *
 * WHERE THE EVIDENCE STOPS: Blender also carries a far-distance term, and
 * these frames cannot size it — at 115 m from an 18 m camera the residual is
 * still flat, so whatever its onset is, it is past everything photographed.
 * Not transcribed; the band below is what ends our finite floor.
 *
 * Scale-free by construction: the fade is a ratio of camera height to
 * distance, so a 1 m subject framed like Blender's 2 m one fades identically
 * at the same pixels.
 */
export const GRAZING_FADE_GLSL = /* glsl */ `
float vgaiGrazingFade(vec3 worldPosition, vec3 eye, vec3 planeNormal, float amount) {
  vec3 toEye = eye - worldPosition;
  float toEyeLength = max(length(toEye), 1e-6);
  float graze = 1.0 - abs(dot(toEye / toEyeLength, planeNormal));
  graze *= graze;
  return mix(1.0, 1.0 - graze * graze, amount);
}
`;

/** The floor axes' half-length in metres, and the length of ONE of the
 *  segments the cross is built from. */
const AXIS_HALF_LENGTH = 200;
const AXIS_SEGMENT_METRES = 2;
/** Segments per axis (both directions from the origin). */
const AXIS_SEGMENTS_PER_AXIS = (AXIS_HALF_LENGTH * 2) / AXIS_SEGMENT_METRES;

/**
 * The X and Z axis lines as a CHAIN of short segments rather than one segment
 * each, so the grazing fade below can read a per-fragment world position.
 *
 * WHY, measured: a line through the origin always runs BEHIND the camera in
 * one direction, and `LineMaterial` trims such a segment against the camera
 * plane while building its screen-space quad (`trimSegment`). A varying
 * carried from the UNTRIMMED endpoints then interpolates across a quad whose
 * clip `w` went through zero, and the reconstruction is meaningless: probed
 * on the live Model stage with the fragment's own `|Δy|/|Δ|` written out as
 * grey, a 400 m segment read 0.027–0.045 down the whole visible line where
 * the true grazing sine runs 0.20–0.70 — i.e. pinned near the far endpoint's
 * value, and the axis faded flat to a tenth of its colour everywhere. Over a
 * 2 m segment the interpolation is exact wherever the segment is in front of
 * the camera, and the one segment that straddles the camera plane is 2 m of
 * line at the edge of the frame. (three's own answer to this is the
 * `worldUnits` path, which carries BOTH endpoints as constant varyings and
 * solves for the fragment — but that path also makes `linewidth` a world
 * measure, and this line's 2 device px is measured.)
 */
function axisSegmentPositions(threeAxis: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < AXIS_SEGMENTS_PER_AXIS; i++) {
    const from = -AXIS_HALF_LENGTH + i * AXIS_SEGMENT_METRES;
    const to = from + AXIS_SEGMENT_METRES;
    // A floor line sits a millimetre above the floor; the vertical one stands on the origin.
    if (threeAxis === 0) positions.push(from, 0.001, 0, to, 0.001, 0);
    else if (threeAxis === 2) positions.push(0, 0.001, from, 0, 0.001, to);
    else positions.push(0, from, 0, 0, to, 0);
  }
  return positions;
}

/**
 * Give the floor AXES the same grazing fade the floor grid takes, through the
 * same 0..1 amount object. It starts at 0 — today's flat axis — and
 * `_applyViewportLook` raises it for a look that paints the viewport.
 */
function applyAxisGrazingFade(
  material: LineMaterial,
  amount: { value: number },
  planeNormal: { value: THREE.Vector3 },
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uGrazingFade'] = amount;
    shader.uniforms['uPlaneNormal'] = planeNormal;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vAxisWorld;\nvoid main() {')
      .replace(
        'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
        'vAxisWorld = ( modelMatrix * vec4( position.y < 0.5 ? instanceStart : instanceEnd, 1.0 ) ).xyz;\n\t\t\tvec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vAxisWorld;\nuniform float uGrazingFade;\nuniform vec3 uPlaneNormal;\n${GRAZING_FADE_GLSL}\nvoid main() {`,
      )
      .replace(
        'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        'gl_FragColor = vec4( diffuseColor.rgb, alpha * vgaiGrazingFade( vAxisWorld, cameraPosition, uPlaneNormal, uGrazingFade ) );',
      );
  };
  material.customProgramCacheKey = () => 'vgai-axis-grazing-fade';
}

const _gridView = new THREE.Vector3();
const _gridQuat = new THREE.Quaternion();
const _gridEye = new THREE.Vector3();
const _gridUp = new THREE.Vector3(0, 1, 0);

function createFloorGrid(extent: number): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.PlaneGeometry(extent, extent);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x999999) },
      uMajorColor: { value: new THREE.Color(0x999999) },
      uOpacity: { value: 1 },
      // The look's widths (`nativeViewportGrid`), applied with its colours.
      uLineWidth: { value: 1 },
      uMajorWidth: { value: 1 },
      uAligned: { value: 0 },
      uMajorEvery: { value: 10 },
      uFadeStart: { value: (extent / 2) * 0.55 },
      uFadeEnd: { value: extent / 2 },
      // The grazing fade's amount, 0..1 — set by `_applyViewportLook` from
      // the one predicate that already decides whether a look paints the
      // viewport at all. See {@link GRAZING_FADE_GLSL} for the measurement.
      uGrazingFade: { value: 0 },
      // The plane the grid lies in: the floor, or an axis-aligned orthographic view's own plane
      // (`EditorViewport.alignGridToView`). A unit axis.
      uPlaneNormal: { value: new THREE.Vector3(0, 1, 0) },
      // The minor line spacing in metres and how much of it shows: 1 m and full on the floor;
      // in an axis-aligned orthographic view, Blender's zoom-dependent level
      // (`EditorViewport.alignGridToView`).
      uUnit: { value: 1 },
      uMinorFade: { value: 1 },
      // Where the grid's distance fade is centred, in the plane's own coordinates, and how far
      // it reaches: the origin and 1 on the floor; the view's centre and the view's size in an
      // axis-aligned orthographic view, which Blender's grid covers edge to edge.
      uCenter: { value: new THREE.Vector2() },
      uReach: { value: 1 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uMajorColor;
      uniform float uOpacity;
      uniform float uLineWidth;
      uniform float uMajorWidth;
      uniform float uAligned;
      uniform float uMajorEvery;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      uniform float uGrazingFade;
      uniform vec3 uPlaneNormal;
      uniform float uUnit;
      uniform float uMinorFade;
      uniform vec2 uCenter;
      uniform float uReach;
      varying vec3 vWorld;
      ${GRAZING_FADE_GLSL}
      // Coverage of a line WIDTH device pixels across, with a one-pixel
      // anti-aliased edge — so its core is FULL, the way Blender's is. The
      // earlier form (1 - distance/width) was a triangle with no plateau:
      // whether a line reached its own colour depended on where the nearest
      // fragment centre happened to fall, and the measured peak wandered
      // between 0.67 and 1 of it.
      float gridLine(vec2 coord, float width) {
        vec2 d = max(fwidth(coord), vec2(1e-6));
        vec2 dist = abs(fract(coord - 0.5) - 0.5) / d;
        vec2 cov = clamp(width * 0.5 - dist + 0.5, 0.0, 1.0);
        return max(cov.x, cov.y);
      }
      // One device pixel, the one nearest the line, and no anti-aliasing: Blender's lines in an
      // axis-aligned view (\`GRID_ALIGNED\`, which outputs no line-smoothing data for them).
      float alignedLine(vec2 coord) {
        vec2 dist = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), vec2(1e-6));
        return max(step(dist.x, 0.5), step(dist.y, 0.5));
      }
      void main() {
        vec2 world = abs(uPlaneNormal.y) > 0.5 ? vWorld.xz : abs(uPlaneNormal.z) > 0.5 ? vWorld.xy : vWorld.zy;
        vec2 p = world / uUnit;
        if (uAligned > 0.5) {
          // BLENDER'S THREE LEVELS in an axis-aligned orthographic view
          // (\`overlay_grid_vert.glsl\`, \`OVERLAY_GRID_STEPS_DRAW\` 3): the unit, the next step and
          // the one after, with f the level's fraction (\`uMinorFade\` is 1 - f). Level 0 is the
          // grid colour at alpha 1 - f, further faded as its cells shrink toward a pixel
          // (\`smoothstep(step / 4, step / 64, pixel size)\`, written in increasing order); level 1 is opaque and 1 - f of the
          // way to the emphasis colour; level 2 is the emphasis colour. A line on a higher level
          // is that level's.
          float top = alignedLine(p / (uMajorEvery * uMajorEvery));
          float middle = alignedLine(p / uMajorEvery);
          float bottom = alignedLine(p);
          float pixel = max(fwidth(world).x, fwidth(world).y);
          float bottomAlpha = uMinorFade * (1.0 - smoothstep(uUnit * 0.015625, uUnit * 0.25, pixel));
          float emphasis = top > 0.5 ? 1.0 : middle > 0.5 ? uMinorFade : 0.0;
          // The theme's grid colour carries alpha 0x80 and its emphasis colour none, and the
          // two colours here were fitted to Blender's PERSPECTIVE frames, where four additive
          // passes (1 + 1/2 + 1/4 + 1/8) take that alpha to about 0.94. Drawn once, as an
          // aligned view draws it, the grid colour keeps 0.502 / 0.941 of that. (Measured: the
          // 10 cm lines +5 over the ground at 198 px per metre, predicted +5.4; the 1 m lines
          // 89 against 88. The 0.94 is inferred from the passes, not read off a frame.)
          float levelAlpha = (top > 0.5 || middle > 0.5 ? 1.0 : bottom * bottomAlpha) * mix(0.533, 1.0, emphasis);
          float edge = 1.0 - smoothstep(uFadeStart * uReach, uFadeEnd * uReach, length(world - uCenter));
          float alignedAlpha = levelAlpha * edge * uOpacity;
          if (alignedAlpha <= 0.002) discard;
          gl_FragColor = vec4(mix(uColor, uMajorColor, emphasis), alignedAlpha);
          #include <colorspace_fragment>
          return;
        }
        vec2 pixelsPerMetre = 1.0 / max(fwidth(p), vec2(1e-6));
        float minorVisible = smoothstep(4.0, 14.0, min(pixelsPerMetre.x, pixelsPerMetre.y)) * uMinorFade;
        // Both levels reach FULL strength in their own colour, as Blender's
        // do: the 1 m line is measured at exactly the palette's grid colour
        // and the 10 m line brighter than it (see uMajorColor). The minor
        // level's only attenuation is its own drop-out as cells shrink.
        float minor = gridLine(p, uLineWidth) * minorVisible;
        // The 10 m level is WIDER as well as brighter, which is what lets it
        // reach full coverage — and so its full colour. Measured across one
        // scanline of modeling-object-none.png at device resolution: the 1 m
        // line is 4 px at half rise and plateaus at 83, the 10 m line is 6 px
        // and plateaus at 101. At one shared width ours drew a 10 m line that
        // never exceeded 0.75 coverage and so measured 91, not 102.
        float major = gridLine(p / uMajorEvery, uMajorWidth);
        float line = max(minor, major);
        float fade = 1.0 - smoothstep(uFadeStart * uReach, uFadeEnd * uReach, length(world - uCenter));
        // The floor's DEPTH, beside the band that ends its finite extent:
        // Blender's own grazing-angle profile, transcribed from its frames
        // (see GRAZING_FADE_GLSL above). Without it this lattice reads the
        // same ink at the front of the frame and at the horizon.
        fade *= vgaiGrazingFade(vWorld, cameraPosition, uPlaneNormal, uGrazingFade);
        float alpha = line * fade * uOpacity;
        if (alpha <= 0.002) discard;
        // WHICH level a fragment belongs to is the major's SHARE of the
        // coverage being drawn, never a comparison of the two and never the
        // major's raw coverage. Every 10 m line is also a 1 m line, so there
        // the two are equal: a step() between them compares values equal to
        // within rounding and flips per fragment (photographed with the major
        // forced white: the 10 m lines came out DOTTED), and mixing by the raw
        // coverage dilutes the colour by the line's own anti-aliasing (the
        // same lines then measured 91 where Blender's is 102). As a share it
        // is exactly 1 wherever the major draws — core and skirt alike, and in
        // the far field where the minor has dropped out — and 0 on a 1 m line.
        float majorShare = clamp(major / max(line, 1e-6), 0.0, 1.0);
        gl_FragColor = vec4(mix(uColor, uMajorColor, majorShare), alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'editor-floor-grid';
  return mesh;
}

export class EditorViewport {
  setTransformMode(mode: 'combined' | 'translate' | 'rotate' | 'scale'): void {
    this._store.shell.setTransformMode(mode);
  }

  readonly camera: THREE.PerspectiveCamera;
  readonly orthographicCamera: THREE.OrthographicCamera;
  readonly orbitControls: OrbitControls;
  readonly transformControls: TransformControls;
  /** The rotate/scale halves of the 'combined' gizmo (Unity's Transform
   *  tool). Constructed always, shown only in combined mode — three's
   *  TransformControls is single-mode, so combined is three synchronized
   *  instances sharing one drag pipeline (`_activeGizmo` names the one the
   *  pointer is actually driving). */
  private _auxRotateControls: TransformControls;
  private _auxScaleControls: TransformControls;
  private _activeGizmo: TransformControls;
  readonly raycaster = (() => {
    const r = new THREE.Raycaster();
    r.layers.enableAll();
    return r;
  })();
  /** The floor: a shader grid (`createFloorGrid`), not line geometry. */
  readonly grid: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Keyed `bounds:<id>` / `selection:<id>` — the Bounds diagnostic and a
   *  non-renderable selection fallback can both be live for the same entity.
   *  Nothing reads a key back; the map exists so a rebuild can dispose exactly
   *  what it made. */
  private _boxHelpers = new Map<string, BoundsHelper>();
  /** The view's selection marks (`kit/viewport-presentation` overlays.selection): the native
   *  outline is the stage's own switch; `box` brackets every selected object, not only those
   *  without geometry (Godot); `wire` draws the selected meshes' wireframes (Unity). */
  private _selectionMarks = { outline: true, wire: false, box: false };
  private _unsubscribeSelectionTheme: () => void = () => {};
  private _constraintHelpers = new Map<string, ConstraintHelper>();
  private _constraintControlRaycaster = (() => {
    const raycaster = new THREE.Raycaster();
    raycaster.layers.enableAll();
    return raycaster;
  })();
  private _hoveredConstraintControl: { helper: ConstraintHelper; mesh: THREE.Mesh } | null = null;
  private _constraintControlPointerSession = false;
  private _reflectionProbeHelpers = new Map<string, ReflectionProbeHelper>();
  private _triggerVolumeHelpers = new Map<string, TriggerVolumeHelper>();
  private _cameraHelpers = new Map<string, { source: THREE.Camera; helper: THREE.CameraHelper }>();
  private _lightHelpers = new Map<
    string,
    { source: THREE.Light; helper: THREE.Object3D & { update?(): void; dispose?(): void } }
  >();
  private _audioHelpers = new Map<string, { source: THREE.Object3D; helper: THREE.Group }>();
  private _spatialHandleRoots: THREE.Object3D[] = [];
  private _spatialHandleMeshes: SpatialHandleMesh[] = [];
  private _spatialHandleRaycaster = (() => {
    const raycaster = new THREE.Raycaster();
    raycaster.layers.enableAll();
    return raycaster;
  })();
  private _activeSpatialHandle: SpatialHandleBinding | null = null;
  private _hoveredSpatialHandle: SpatialHandleMesh | null = null;
  private _spatialHandleDragPlane = new THREE.Plane();
  private _spatialHandleDragOffset = new THREE.Vector3();
  private _spatialHandleDragPoint = new THREE.Vector3();
  private _orbitEnabledBeforeHandleDrag = true;
  private _transformEnabledBeforeHandleDrag = true;
  private _gizmoHelper: THREE.Object3D;
  private _editorAmbient: THREE.AmbientLight;
  private _editorDirLight: THREE.DirectionalLight;
  /** See {@link EditorViewportOptions.lightRig}. */
  private readonly _lightRig: boolean;

  private _scene: THREE.Scene;
  /** World AABB of the active scene's non-editor content, cached because
   *  measuring it walks the whole graph (2k+ nodes for an ingested game).
   *  Empty until the first refresh; see {@link _contentBounds}. */
  private readonly _contentBoundsBox = new THREE.Box3();
  /** `performance.now()` of the last content-bounds measurement; 0 invalidates
   *  it (a scene swap), so the next reader re-measures immediately. */
  private _contentBoundsAt = 0;
  private _renderer: THREE.WebGLRenderer | undefined;
  private _sparkRenderer: SparkRenderer | null = null;
  private _sparkRendererLoading = false;
  private _sparkRendererFailed = false;
  private _lastSparkDiscoveryAt = Number.NEGATIVE_INFINITY;
  private _disposed = false;
  /** Editor infrastructure objects that must move with the active scene. */
  private _editorObjects: THREE.Object3D[] = [];
  /** The view presentation this stage is lit by, when bound (`bindPresentation`). */
  private _presentation: { readonly rig: StagePresentationRig; readonly stop: () => void } | null = null;
  /** The world's axis lines: WHICH show is the view's (`overlays.axes`, {@link setAxisLines}),
   *  their colours and width the look's (`color.viewport.axisX/Y/Z`, `axisLineWidth`). */
  private _axisLines: LineSegments2 | null = null;
  /** The world's vertical axis line, a child of {@link _axisLines} (see `_rebuildAxisLines`). */
  private _verticalAxisLine: LineSegments2 | null = null;
  /** The look's axis-line width in device pixels (null: the editor's own), which an
   *  axis-aligned view sets aside for one pixel. */
  private _axisLineWidth: number | null = null;
  /** A device-pixel width as `LineMaterial` takes it: CSS pixels, three keeping its viewport in
   *  CSS units. The editor's own is 2 CSS. */
  private _axisLineCss(device: number | null): number {
    return device === null ? 2 : device / (this._renderer?.getPixelRatio() ?? 1);
  }
  private _axesWanted = false;
  private _stageAxes: ViewportOverlays['axes'] = 'floor';
  /** The look's axis colours by WORLD axis (X, Y, Z), each `null` for the gizmo's own. */
  private _lookAxisHexes: readonly [number | null, number | null, number | null] = [null, null, null];
  /** The palette's grid hex, kept for the same reason the axis hexes are. */
  private _lookGridHex: number | null = null;
  /** The palette background this viewport paints (the palette's sRGB hex) and
   *  the colour actually set for it under the renderer's tone mapping, so a
   *  theme or pipeline change replaces OUR colour and never a host's own. */
  private _lookBackgroundHex: number | null = null;
  private _lookToneMapping: THREE.ToneMapping | null = null;
  private _lookExposure: number | null = null;
  /** The active look's `stage.gizmoSize`, px per Blender gizmo unit
   *  — null under every look that names none. Cached off the theme token
   *  rather than read per frame; {@link _applyGizmoSize} is what turns it into
   *  three's `size`. */
  private _lookGizmoSizePx: number | null = null;
  /** The stage's world up axis (its presentation's `world.upAxis`, `setStageFunction`), as
   *  the table every gizmo label and colour reads (see {@link StageAxisFrame}). Defaults to
   *  three's own frame. */
  private _stageAxisFrame: StageAxisFrame = AXIS_FRAME_Y_UP;
  /** The axis frame the gizmo GEOMETRY has already been mirrored into, so
   *  {@link _applyGizmoAxisFrame} can be called again for a look change and
   *  apply only the difference. Mirroring is its own inverse, which is what
   *  makes a delta enough. */
  private _appliedAxisSigns: readonly (1 | -1)[] = [1, 1, 1];
  /** The look's gizmo colours and highlight ({@link nativeGizmoLook}); all-null keeps the
   *  editor's own (the kit's axis colours, three's yellow highlight, opaque handles). */
  private _gizmoLook: NativeGizmoLook = {
    axes: null,
    navigation: null,
    hover: null,
    drag: null,
    opacity: null,
    arrowLength: null,
    arrowHead: null,
    ringWidth: null,
    navigationSize: null,
    navigationForm: 'balls',
    background: null,
    navigationCorner: 'top-right',
    highlightSaturation: null,
    highlightValue: null,
  };
  /** The stage's box-select rule (its presentation's `interaction.boxSelect`) — `'touch'` is
   *  Blender's Select Box, `'contain'` (and null) the editor's own. Read by the marquee at the
   *  moment it resolves, never cached into the rectangle. */
  private _stageBoxSelect: 'contain' | 'touch' | null = null;
  /** The combined tool's extra handles (the presentation's `interaction.transformHandles`). */
  private _transformHandles: { readonly scale: boolean; readonly viewRotate: boolean; readonly freeMove: boolean } = {
    scale: true,
    viewRotate: true,
    freeMove: true,
  };
  /** The arrow shape the translate geometry is already in ({@link _applyGizmoArrows}): tip
   *  distance in ring radii and head scale, three's own to start. */
  private _appliedArrow: { readonly length: number; readonly head: number } = { length: 1.2, head: 1 };
  /** The ring thickness the rotate geometry is already in, as a multiple of three's. */
  private _appliedRingWidth = 1;
  private _store: EditorShellStore;
  private _objectMap = new Map<string, THREE.Object3D>();
  private _canvas: HTMLCanvasElement;
  /** Camera input belongs to the whole viewport surface, including authoring
   * overlays rendered above the WebGL canvas. */
  private _interactionElement: HTMLElement;
  /** The interaction-element pointerup relay (see the ctor's binding comment). */
  private _onInteractionPointerUp: ((e: PointerEvent) => void) | undefined;
  /** The interaction-element dblclick relay — same targeting story as the
   *  pointerup relay above (OrbitControls' pointer capture retargets the
   *  clicks a `dblclick` is synthesized from). */
  private _onInteractionDblClick: ((e: MouseEvent) => void) | undefined;
  private readonly _authoring: () => AuthoringAdapter;
  private readonly _pick: ((clientX: number, clientY: number) => string | null) | undefined;
  private readonly _drawCamera: (() => THREE.Camera) | undefined;
  /** The camera on screen: the stage's drawing camera where it states one, else the viewport's.
   *  Every screen test asks it (picks, the box select, vertex snap, handles, the ground plane);
   *  fly mode and the grid's own alignment keep the viewport's cameras, which they move. */
  private get _screenCamera(): THREE.Camera {
    return this._drawCamera?.() ?? this.renderCamera;
  }
  private readonly _standaloneAuthoring: boolean;
  private readonly _publishPickContext: boolean;
  private readonly _onlineAssetResolver: OnlineAssetResolver | undefined;
  private readonly _onProjectionChange: ((projection: ThreeViewportProjection) => void) | undefined;
  private _pointerDownPos = new THREE.Vector2();
  private _skipNextSync = false;

  // -- Marquee select --
  private _marqueeActive = false;
  /** True between a canvas pointerdown and its pointerup — see `_onPointerUp`. */
  private _pointerSessionActive = false;
  private _marqueeDiv: HTMLDivElement | null = null;
  private _pointerDownButton = -1;
  private _altDragOrbit = false;

  // -- Orientation gizmo --
  private _vcScene = new THREE.Scene();
  private _vcCamera: THREE.OrthographicCamera;
  private _vcClickTargets: THREE.Mesh[] = [];
  /** The gizmo's six balls and three stalks, kept for the per-frame depth
   *  cue (`_syncOrientationGizmoDepth`). */
  private _vcBalls: Array<{
    readonly fill: THREE.Sprite;
    readonly ring: THREE.Sprite;
    readonly letter: THREE.Sprite;
    readonly direction: THREE.Vector3;
    readonly positive: boolean;
    /** Which THREE axis (0 x, 1 y, 2 z) the ball lies on. */
    readonly axis: number;
    readonly color: THREE.Color;
  }> = [];
  private _vcStalks: Array<{
    readonly mesh: THREE.Mesh;
    readonly direction: THREE.Vector3;
    readonly positive: boolean;
    readonly color: THREE.Color;
  }> = [];
  /** The cone form's cones: drawn front to back, never dimmed (Unity's are not). */
  private _vcSolids: Array<{ readonly mesh: THREE.Mesh; readonly direction: THREE.Vector3 }> = [];
  private _vcSize = COMPASS_BOX_PX;
  /** The view's navigation gizmo (`overlays.navigation`): clicked, only drawn, or neither. */
  private _navigation: 'interactive' | 'indicator' | 'hidden' = 'interactive';
  /** The selection marks' look as last built ({@link _syncBoxHelpers}), to rebuild on change. */
  private _marksLook = '';
  /** The view's grid switch (`overlays.grid.visible`), which the person's toggle also writes. */
  private _presentationGrid = true;
  private _vcMarginRight = COMPASS_MARGIN_RIGHT_PX;
  private _vcMarginTop = COMPASS_MARGIN_TOP_PX;
  /** See {@link EditorViewportOptions.chromeInsetPx}. */
  private _chromeInsetPx = 0;
  /** Scratch dir vector reused each frame by renderViewCube (avoids per-frame alloc). */
  private _vcDir = new THREE.Vector3();
  /** Scratch color reused by renderCameraPreview (avoids per-frame alloc). */
  private _previewClearColor = new THREE.Color();
  /** Transient camera view/pilot subject. The native camera remains owned by
   *  the active adapter; this reference changes only viewport presentation. */
  private _cameraView: THREE.Camera | null = null;
  private _projection: ThreeViewportProjection = 'perspective';
  private _pendingProjection: ThreeViewportProjection | null = null;
  private _viewportAspect = 1;
  /** The view's lens in mm (`View3D.lens`); a document's saved view may state its own. */
  private _lens = STAGE_LENS_MM;
  private _orthographicHeight = 10;
  private _cameraViewMode: CameraViewMode | null = null;
  private _orbitEnabledBeforeCameraView = true;
  private _orbitTargetBeforeCameraView = new THREE.Vector3();
  /** Last objectMap + visibility signature applied by syncFromStore's gizmo/helper
   *  passes — lets those O(scene) loops skip when their inputs are unchanged (e.g.
   *  during a transform drag, which notifies per frame but changes none of them). */
  private _lastGizmoObjectMap: Map<string, THREE.Object3D> | null = null;
  private _lastGizmoSig = '';
  private _lastGizmoEpoch = -1;
  /** Previous world-hidden eye state — edge detection for environment suppress/restore. */
  /**
   * Spec 28 — recomputed from surface visibility AND selection ownership on every
   * `syncFromStore`; read by the per-frame render hooks (`renderViewCube`,
   * `renderCameraPreview`) and the view-cube click path, which run between
   * notifies and must not re-walk the composite 60×/s.
   */
  private _threejsToolContextActive = false;
  /** A three stage is painted here (selection or not) — the floor's and the compass's gate. */
  private _threeSurfaceShowing = false;
  private _vcRaycaster = new THREE.Raycaster();

  // -- Asset drop --
  private _dropOverlay: HTMLDivElement | null = null;
  /**
   * The ground the viewport drops assets and probe points onto. NOT a constant:
   * it is re-read from the ACTIVE region's declared basis
   * (`presentation-surface.ts`'s `presentationRegionBasis`) on every raycast,
   * because a Z-up
   * game's ground is not `y = 0` and the editor may not guess which it is
   * (ARCHITECTURE-CORE §The editor protocol, "Zero inference"). Mutated in
   * place rather than reallocated — this sits on a drag path, not a frame path.
   */
  private _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // -- Multi-drag: track primary object's transform at drag start --
  private _dragStartPos = new THREE.Vector3();
  private _dragStartQuat = new THREE.Quaternion();
  private _dragStartScale = new THREE.Vector3();
  /** Semantic authoring id represented by the currently attached native
   * object. It can differ from any source stamp for a component instance, and
   * it is the only identity on an unstamped foreign structural projection. */
  private _attachedAuthoringId: string | null = null;
  private _otherDragObjects: {
    id: string;
    obj: THREE.Object3D;
    startPos: THREE.Vector3;
    startQuat: THREE.Quaternion;
    startScale: THREE.Vector3;
  }[] = [];
  private _allDragObjects: {
    id: string;
    obj: THREE.Object3D;
    startPos: THREE.Vector3;
    startQuat: THREE.Quaternion;
    startScale: THREE.Vector3;
  }[] = [];
  private _preservedChildObjects: PreservedChildTransform[] = [];
  /** Every semantic transform subject participating in the current gizmo or
   * component-handle gesture. Kept independently from the native drag arrays
   * because those arrays are cleared before persistence completes. */
  private _activeTransformEditIds: string[] = [];
  private _pivotDummy = new THREE.Object3D();
  /**
   * True while `_pivotDummy` carries a CENTRE anchor — a place to draw the
   * handles, not a pivot the edit is about (`_centreAnchorFor`). It is the one
   * bit that separates the two dummy attachments: a real per-entity pivot orbits
   * the object, a presentation anchor must not.
   */
  private _dummyIsPresentationAnchor = false;
  private _pivotPos = new THREE.Vector3();

  // -- Surface snap --
  private _surfaceSnapRaycaster = new THREE.Raycaster();
  private _surfaceSnapIndicator: THREE.Mesh;

  // -- Vertex snap --
  private _vertexSnapTargets: THREE.Vector3[] = [];
  private _vertexSnapIndicator!: THREE.Mesh;
  private _vertexSnapThreshold = 20; // pixels

  // Component handles arrive through `AuthoringAdapter.spatialHandles`: the
  // viewport renders generic layers while each adapter owns the native values
  // and their persistence. There is no shell-side component switch here.

  // -- Particles --
  readonly batchedRenderer: BatchedRenderer;

  // -- NavMesh helper (scene-root, toggled separately) --
  /** Editor-only helper objects by kind (`setHelper`): a baked navmesh's
   *  debug mesh, … — scene-root objects toggled by the Helpers menu. */
  private _helpers = new Map<string, THREE.Object3D>();

  // -- NavMesh path-probe visuals (W1a Navigation window) --

  // -- Snap-to-view animation --
  private _snapAnimating = false;
  private _snapStartTime = 0;
  private _snapDuration = 400;
  private _snapQ1 = new THREE.Quaternion();
  private _snapQ2 = new THREE.Quaternion();
  private _snapDist = 0;

  // -- Fly camera (right-click + WASD) --
  private _flyActive = false;
  private _snapHold = false;
  private _flyKeys = new Set<string>();
  private _flySpeed = 5;
  private _flyEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _rightMouseDown = false;

  constructor(
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    store: EditorShellStore,
    interactionElement: HTMLElement = canvas,
    options: EditorViewportOptions = {},
  ) {
    // The integration's registrations (the authoring policy this viewport asks, its verbs, the
    // view-state persistence) exist before any viewport does; idempotent.
    ensureThreeIntegration();
    this._canvas = canvas;
    this._interactionElement = interactionElement;
    this._scene = scene;
    this._renderer = options.renderer;
    this._store = store;
    this._authoring =
      options.authoring ?? (() => viewportAuthoringPolicy().activeAuthoring(this._store.shell));
    this._pick = options.pick;
    this._drawCamera = options.drawCamera;
    this._standaloneAuthoring = options.authoring !== undefined;
    this._publishPickContext = options.publishPickContext ?? true;
    this._chromeInsetPx = options.chromeInsetPx ?? 0;
    this._onlineAssetResolver = options.onlineAssetResolver;
    this._onProjectionChange = options.onProjectionChange;

    // Camera — enableAll so editor sees both game content (layer 0) and editor objects (layer 31)
    this.camera = new THREE.PerspectiveCamera(
      stageVerticalFovDegrees(canvas.clientWidth / Math.max(1, canvas.clientHeight)),
      canvas.clientWidth / canvas.clientHeight,
      EDITOR_CAMERA_NEAR,
      EDITOR_CAMERA_FAR,
    );
    this.camera.position.copy(STAGE_OPENING_DIRECTION).multiplyScalar(17.32);
    this.camera.lookAt(0, 0, 0);
    this.camera.layers.enableAll();
    this._viewportAspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    this.orthographicCamera = new THREE.OrthographicCamera(
      -5,
      5,
      5,
      -5,
      EDITOR_CAMERA_NEAR,
      EDITOR_CAMERA_FAR,
    );
    this.orthographicCamera.layers.enableAll();
    this._syncOrthographicFromPerspective();

    // Grid — with the standard distance fade (the dressing module owns the
    // grid treatment), so it never ends on a hard rim or degenerates into
    // convergence-line artifacts at the horizon.
    // The floor is a SHADER grid, Blender's way: anti-aliased lines of a
    // constant on-screen width (a line helper's one device pixel halved into
    // the floor on every downsample — measured), a minor 1 m level that fades
    // out where its cells get small so distance never merges it into a slab,
    // a major 10 m level that stays, the palette's colour, and a fade to the
    // floor's own edge so it never ends on a rim.
    this.grid = createFloorGrid(400);
    this.grid.layers.set(EDITOR_LAYER);
    scene.add(this.grid);
    // Axis lines — the world's, which ones the view says (`_rebuildAxisLines`) — as
    // screen-space two-pixel lines: a one-pixel line halves into the floor
    // when a frame is downsampled (measured), Blender's are two.
    const axisGeometry = new LineSegmentsGeometry();
    axisGeometry.setPositions(axisSegmentPositions(0));
    axisGeometry.setColors(new Array(AXIS_SEGMENTS_PER_AXIS * 2 * 3).fill(1));
    this._axisLines = new LineSegments2(
      axisGeometry,
      new LineMaterial({
        vertexColors: true,
        linewidth: 2,
        // Blended for draw order over the floor, but at FULL strength:
        // Blender's axis plateaus at its flat theme colour (`#cb293f`,
        // `#69aa15`, measured across the whole width of
        // `modeling-object-none.png`), and an opacity here would make the
        // stage's axis colour depend on whatever it happens to cross.
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    // The axes take the floor's own grazing fade, because in the reference
    // they ARE the floor: Blender draws both out of one overlay shader and
    // one `fade`, and its X axis measures 0.96 of its colour at the front of
    // the frame against 0.26 near the horizon. `LineMaterial` interpolates
    // per-segment endpoints with the clip `w` intact, so a world-position
    // varying taken from the segment's own ends is perspective-correct along
    // the line — which is all a 400 m two-segment cross needs.
    applyAxisGrazingFade(
      this._axisLines.material as LineMaterial,
      this.grid.material.uniforms['uGrazingFade'] as { value: number },
      this.grid.material.uniforms['uPlaneNormal'] as { value: THREE.Vector3 },
    );
    this._axisLines.visible = false;
    this._axisLines.layers.set(EDITOR_LAYER);
    scene.add(this._axisLines);

    // The palette's viewport look is applied THROUGH the grid and the axis
    // lines, so this subscription cannot be made before they exist:
    // `subscribeNativeSelectionTheme` calls its listener SYNCHRONOUSLY once
    // (native-selection-style.ts), and from higher in this constructor that
    // first call read `this.grid.geometry` off an undefined grid — the whole
    // viewport construction threw, and every 3D document died with
    // "Cannot read properties of undefined (reading 'geometry')".
    this._unsubscribeSelectionTheme = subscribeNativeSelectionTheme(canvas, () => {
      invalidateStages();
      // The selection marks carry their look whole (colour, box form and frame, wire colour and
      // opacity), so a change to THAT look rebuilds them — not every theme mutation, which
      // includes each hover step of a palette preview and would regenerate every wire.
      const marksLook = JSON.stringify([
        nativeSelectionColors(canvas),
        nativeViewportSelectionBox(canvas),
        nativeViewportWire(canvas),
      ]);
      if (marksLook !== this._marksLook) {
        this._marksLook = marksLook;
        if (this._boxHelpers.size > 0) this._syncBoxHelpers();
      }
      // The gizmo look FIRST: an axis line the look gives no colour takes the gizmo's.
      this._gizmoLook = nativeGizmoLook(canvas);
      this._applyViewportLook(nativeViewportLook(canvas));
      this._applyGridLines(nativeViewportGrid(canvas));
      this._lookGizmoSizePx = nativeViewportGizmoSize(canvas);
      this._applyGizmoSize();
      this._applyGizmoArrows();
      // WHAT FRAME THIS STAGE IS PRESENTING, and what a box select means in
      // it. Like the size above, the first synchronous call runs before the
      // gizmos exist and both appliers answer that by returning.
      this._readLookStage(canvas);
    });

    // Editor lighting (on EDITOR_LAYER so game camera doesn't see them)
    this._lightRig = options?.lightRig !== false;
    this._editorAmbient = new THREE.AmbientLight(0xffffff, 0.5);
    this._editorAmbient.layers.set(EDITOR_LAYER);
    scene.add(this._editorAmbient);
    this._editorDirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this._editorDirLight.position.set(10, 20, 10);
    this._editorDirLight.layers.set(EDITOR_LAYER);
    scene.add(this._editorDirLight);
    // `_setScene` is where the rig's visibility is decided for every scene
    // AFTER this one; the first scene arrives here, so it is decided here too.
    this._editorAmbient.visible = this._lightRig;
    this._editorDirLight.visible = this._lightRig;

    // Particle BatchedRenderer
    this.batchedRenderer = new BatchedRenderer();
    this.batchedRenderer.layers.set(EDITOR_LAYER);
    scene.add(this.batchedRenderer);

    // TRACKPAD CAMERA, before OrbitControls exists: listeners on one element
    // run in registration order, so this must be first to win the wheel.
    // A trackpad has no middle button (pan was unreachable) and its two-finger
    // scroll arrived as plain zoom — a 20-minute human build session on one
    // called moving the camera "nearly impossible" (runhuman pass 12,
    // 2026-08-28). Semantics: pinch (ctrl+wheel) and pure-vertical wheel stay
    // ZOOM (mouse wheels are pure-vertical, so mice are untouched); a wheel
    // with a horizontal component — only trackpads produce one — or Shift
    // held PANS in screen space, Figma-fashion.
    interactionElement.addEventListener('wheel', this._onTrackpadWheel, { passive: false });

    // OrbitControls: the editor's own mouse is right-drag to orbit, middle-drag to pan and the
    // wheel to zoom; a keymap may orbit on the middle button instead (`applyKeymapNavigation`).
    this.orbitControls = new OrbitControls(this.camera, interactionElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.applyKeymapNavigation();
    this._unsubscribeKeymap = subscribeEditorKeymap(() => this.applyKeymapNavigation());
    this._installTurntable();

    // TransformControls — one instance per mode; 'combined' shows all three.
    // Construction order IS pointer priority (each instance registers its own
    // canvas listeners): translate, then SCALE, then rotate — the screen-space
    // rotate ring's band can cross a scale cube's projected spot, and a
    // pointer on that small explicit target means scale (measured: the ring
    // stole the X-cube drag when rotate registered first).
    this.transformControls = new TransformControls(this.camera, canvas);
    this._auxScaleControls = new TransformControls(this.camera, canvas);
    this._auxScaleControls.setMode('scale');
    this._auxRotateControls = new TransformControls(this.camera, canvas);
    this._auxRotateControls.setMode('rotate');
    this._activeGizmo = this.transformControls;
    const wireGizmo = (gizmoControls: TransformControls): void => {
      // Enable all layers on the internal raycaster so it can pick gizmo parts on EDITOR_LAYER
      gizmoControls.getRaycaster().layers.enableAll();
      gizmoControls.addEventListener('dragging-changed', (event) => {
        const dragging = (event as unknown as { value: boolean }).value;
        // The design session holds its remount SWAP while a drag runs
        // (live-gesture-lock.ts) — a swap mid-drag snapped moved objects back.
        if (dragging) beginLiveGesture();
        else endLiveGesture();
        this.orbitControls.enabled = !dragging;
        if (dragging) {
          // ONE gizmo drives a drag; its siblings must not also hover/pick.
          this._activeGizmo = gizmoControls;
          for (const other of this._allGizmos()) {
            if (other !== gizmoControls) other.enabled = false;
          }
          const gizmoObj = gizmoControls.object;
          const channel =
            gizmoControls.mode === 'translate'
              ? 'position'
              : gizmoControls.mode === 'rotate'
                ? 'rotation'
                : 'scale';
          const writable = (id: string): boolean =>
            this._authoring().transforms?.editability?.(id, channel).writable ?? true;
          const primaryDragId =
            this._attachedAuthoringId ?? (gizmoObj && this._authoringIdForObject(gizmoObj)) ?? '';
          if (gizmoObj) {
            this._dragStartPos.copy(gizmoObj.position);
            this._dragStartQuat.copy(gizmoObj.quaternion);
            this._dragStartScale.copy(gizmoObj.scale);
            this._otherDragObjects = [];
            this._allDragObjects = [];
            this._pivotPos.copy(gizmoObj.position);
            const primaryId =
              gizmoObj === this._pivotDummy ? null : this._authoringIdForObject(gizmoObj);
            if (!primaryId) {
              // Gizmo on pivot dummy (median-point mode or per-entity pivot)
              for (const id of this._store.shell.selectedEntityIds) {
                if (!writable(id)) continue;
                const obj = this._objectForAuthoringId(id);
                if (!obj) continue;
                this._allDragObjects.push({
                  id,
                  obj,
                  startPos: obj.position.clone(),
                  startQuat: obj.quaternion.clone(),
                  startScale: obj.scale.clone(),
                });
              }
            } else {
              for (const id of this._store.shell.selectedEntityIds) {
                if (id === primaryDragId) continue;
                if (!writable(id)) continue;
                const obj = this._objectForAuthoringId(id);
                if (!obj) continue;
                this._otherDragObjects.push({
                  id,
                  obj,
                  startPos: obj.position.clone(),
                  startQuat: obj.quaternion.clone(),
                  startScale: obj.scale.clone(),
                });
              }
            }
            const editIds =
              gizmoObj === this._pivotDummy
                ? this._allDragObjects.map(({ id }) => id)
                : [primaryDragId, ...this._otherDragObjects.map(({ id }) => id)];
            this._preservedChildObjects = this._preparePreservedChildren(editIds.filter(Boolean));
            this._activeTransformEditIds = [
              ...new Set([
                ...editIds.filter(Boolean),
                ...this._preservedChildObjects.map(({ id }) => id),
              ]),
            ];
            // Begin every semantic source edit before TransformControls mutates
            // any native object. Source-backed adapters need the pre-drag pose of
            // secondary selections too; physics-backed adapters freeze each body.
            const authoring = this._authoring();
            for (const id of this._activeTransformEditIds)
              beginAuthoringTransformEdit(authoring, id);
          }
        } else {
          // Hide snap indicators when drag ends
          this._surfaceSnapIndicator.visible = false;
          this._vertexSnapIndicator.visible = false;
          // After drag ends, re-sync for median-point pivot repositioning
          this.syncFromStore();
        }
      });
      gizmoControls.addEventListener('objectChange', () => {
        const gizmoObj = gizmoControls.object;
        if (!gizmoObj) return;
        const mode = gizmoControls.mode;
        // A CENTRE-anchored gizmo takes the individual-origins math on purpose:
        // its anchor is where the handles are DRAWN, not a pivot the edit is
        // about, so a rotate must spin the object on its own origin and write the
        // same numbers a pivot-anchored rotate would (`_centreAnchorFor`).
        const isIndividual =
          this._store.shell.pivotMode === 'individual-origins' || this._dummyIsPresentationAnchor;
        const isMedian = this._allDragObjects.length > 0;
        const targets = isMedian ? this._allDragObjects : this._otherDragObjects;
        if (targets.length > 0) {
          if (mode === 'translate') {
            const delta = gizmoObj.position.clone().sub(this._dragStartPos);
            for (const { obj, startPos } of targets) {
              obj.position.copy(startPos).add(delta);
            }
          } else if (mode === 'rotate') {
            const deltaQuat = gizmoObj.quaternion
              .clone()
              .multiply(this._dragStartQuat.clone().invert());
            if (isIndividual) {
              // Individual origins: only rotate, no position orbiting
              for (const { obj, startQuat } of targets) {
                obj.quaternion.copy(deltaQuat).multiply(startQuat);
              }
            } else {
              // Active element / Median: orbit positions around pivot + rotate
              for (const { obj, startPos, startQuat } of targets) {
                const offset = startPos.clone().sub(this._pivotPos);
                offset.applyQuaternion(deltaQuat);
                obj.position.copy(this._pivotPos).add(offset);
                obj.quaternion.copy(deltaQuat).multiply(startQuat);
              }
            }
          } else if (mode === 'scale') {
            const deltaScale = new THREE.Vector3(
              this._dragStartScale.x !== 0 ? gizmoObj.scale.x / this._dragStartScale.x : 1,
              this._dragStartScale.y !== 0 ? gizmoObj.scale.y / this._dragStartScale.y : 1,
              this._dragStartScale.z !== 0 ? gizmoObj.scale.z / this._dragStartScale.z : 1,
            );
            if (isIndividual) {
              // Individual origins: only scale, no position change
              for (const { obj, startScale } of targets) {
                obj.scale.copy(startScale).multiply(deltaScale);
              }
            } else {
              // Active element / Median: scale from pivot + scale objects
              for (const { obj, startPos, startScale } of targets) {
                const offset = startPos.clone().sub(this._pivotPos);
                offset.multiply(deltaScale);
                obj.position.copy(this._pivotPos).add(offset);
                obj.scale.copy(startScale).multiply(deltaScale);
              }
            }
          }
        }
        // Vertex snap takes priority over surface snap
        if (
          mode === 'translate' &&
          this._store.vertexSnapActive &&
          this._vertexSnapTargets.length > 0
        ) {
          this._applyVertexSnap(gizmoObj, targets);
        } else if (mode === 'translate' && this._store.shell.snapToSurface) {
          this._applySurfaceSnap(gizmoObj, targets);
        }
        this._restorePreservedChildren();

        // Keeps bounds visuals glued to the entity mid-drag. Both members of the
        // union expose `update()`; the diagnostic's degenerate wire cube (a bare
        // LineSegments) does not, hence the guard.
        for (const helper of this._boxHelpers.values()) {
          if ('update' in helper) helper.update();
        }
        this._flushGizmoToStoreLive();
      });
      gizmoControls.addEventListener('mouseUp', () => {
        // Final flush (with skip flag so viewport doesn't rebuild)
        this._flushGizmoToStore();
      });
    };
    wireGizmo(this.transformControls);
    wireGizmo(this._auxRotateControls);
    wireGizmo(this._auxScaleControls);
    this._gizmoHelper = this.transformControls.getHelper();
    this._gizmoHelper.traverse((child) => child.layers.set(EDITOR_LAYER));
    scene.add(this._gizmoHelper);
    for (const aux of [this._auxRotateControls, this._auxScaleControls]) {
      const helper = aux.getHelper();
      helper.traverse((child) => child.layers.set(EDITOR_LAYER));
      helper.visible = false;
      scene.add(helper);
    }

    // Pivot dummy for median-point mode (invisible, just a transform target)
    this._pivotDummy.layers.set(EDITOR_LAYER);
    scene.add(this._pivotDummy);

    // Surface snap indicator (small ring shown at snap point)
    this._surfaceSnapIndicator = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, depthTest: false }),
    );
    this._surfaceSnapIndicator.rotation.x = -Math.PI / 2;
    this._surfaceSnapIndicator.visible = false;
    this._surfaceSnapIndicator.renderOrder = 999;
    this._surfaceSnapIndicator.layers.set(EDITOR_LAYER);
    scene.add(this._surfaceSnapIndicator);

    // Vertex snap indicator (small green sphere shown at snap target vertex)
    this._vertexSnapIndicator = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffaa, depthTest: false }),
    );
    this._vertexSnapIndicator.visible = false;
    this._vertexSnapIndicator.renderOrder = 999;
    this._vertexSnapIndicator.layers.set(EDITOR_LAYER);
    scene.add(this._vertexSnapIndicator);

    // Patch gizmo: recolour handles to the look's axis colours and fix plane geometry.
    this._gizmoLook = nativeGizmoLook(canvas);
    this._rebuildAxisLines();
    for (const controls of this._allGizmos()) this._installGizmoHighlight(controls);
    this._patchGizmo(this._gizmoHelper);
    this._patchGizmo(this._auxRotateControls.getHelper());
    this._patchGizmo(this._auxScaleControls.getHelper());
    this._dropNegativeAxisHandles(this._gizmoHelper, ['translate', 'scale']);
    this._dropNegativeAxisHandles(this._auxScaleControls.getHelper(), ['scale']);
    this._patchCombinedScaleGizmo(this._auxScaleControls.getHelper());
    this._applyGizmoArrows();
    // The look's gizmo size, now that there are controls to set it on: the
    // theme subscription above installed before they existed and its first
    // synchronous call found none (see {@link _applyGizmoSize}).
    this._lookGizmoSizePx = nativeViewportGizmoSize(canvas);
    this._applyGizmoSize();
    // The look's AXIS FRAME, after the three patches above have run: the
    // mirror is a difference over the geometry they produced, so it is the
    // last word on where a handle is drawn.
    // The stage's AXIS FRAME (its world's up axis, `setStageFunction`), after the three patches
    // above have run: the mirror is a difference over the geometry they produced, so it is the
    // last word on where a handle is drawn.
    this._applyGizmoAxisFrame();

    // Orientation gizmo (axis arrows overlay) — built in that same frame.
    this._vcCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
    this._initOrientationGizmo();

    // -- Fly camera input (right-click + WASD) --
    window.addEventListener('keydown', this._onFlyKeyDown);
    window.addEventListener('keyup', this._onFlyKeyUp);
    interactionElement.addEventListener('pointerdown', this._onFlyPointerDown);
    interactionElement.addEventListener('pointerup', this._onFlyPointerUp);
    interactionElement.addEventListener('pointermove', this._onFlyPointerMove);
    interactionElement.addEventListener('wheel', this._onFlyWheel, { passive: false });

    // Alt+Left-drag = orbit (Unity-style), via capture phase so it fires before OrbitControls
    canvas.addEventListener('pointerdown', this._onAltOrbitStart, { capture: true });
    // The restore listens on WINDOW: an Alt+drag released outside the canvas
    // never fired the element-scoped pointerup, so LEFT stayed ROTATE — every
    // later left-drag orbited the camera and the marquee never drew (a human
    // tester lost rectangle-select entirely: "it's like a playing view" —
    // runhuman pass 27). `pointercancel` covers an interrupted drag the same
    // way. Registered in _onAltOrbitRelease so dispose can remove them.
    window.addEventListener('pointerup', this._onAltOrbitRelease, { capture: true });
    window.addEventListener('pointercancel', this._onAltOrbitRelease, { capture: true });
    window.addEventListener('keydown', this._onSnapHoldKey);
    window.addEventListener('keyup', this._onSnapHoldKey);

    // Click to select + marquee. The hazard this binding split defends against
    // is only reproducible with REAL pointer input — synthetic `dispatchEvent`
    // still works, so unit coverage cannot see it:
    // OrbitControls (constructed over `interactionElement` above) calls
    // `setPointerCapture` on its domElement on EVERY pointerdown — including
    // the disabled LEFT button — so all subsequent pointermove/pointerup are
    // RETARGETED to the interaction element and canvas-bound listeners
    // silently die. Because the interaction element is NOT the canvas
    // (right-drag-over-overlays orbit needs it off the canvas), canvas-bound
    // move/up alone would kill click-select, marquee, and the alt-orbit
    // release above.
    //
    // The combined mechanism:
    //  - `pointerdown` binds to the CANVAS: a down anywhere else is not a
    //    viewport gesture. It opens `_pointerSessionActive`, and the session
    //    guards in `_onPointerUp` AND `_onPointerMove` keep gestures that
    //    started on container chrome (toolbar buttons, overlay children)
    //    from running selection/marquee against a stale down-pos.
    //  - `pointermove` binds to the INTERACTION ELEMENT so marquee updates
    //    keep firing mid-drag: once OrbitControls owns the capture, a
    //    canvas-bound move never fires. (The DOM `RootSelectionOverlay` has
    //    its own marquee via `world-overlay-gestures`, but the viewport's
    //    must work bare too.)
    //  - `pointerup` binds to the interaction element via the stored
    //    `_onInteractionPointerUp` wrapper (removed in `dispose`). Its
    //    target guard keeps overlay-OWNED ups (the overlay stopPropagation's
    //    its own pointerdowns before OrbitControls can capture, so their ups
    //    land on overlay children) routed exclusively through the overlay's
    //    own selection logic. The `_pointerSessionActive` disjunct still
    //    admits a CANVAS-origin gesture whose down was never captured
    //    (handle drags stopPropagation the down too) and whose up therefore
    //    lands on overlay chrome — dropping those would leave the
    //    session/handle-drag flags stuck; `_onPointerUp`'s own guards make
    //    such ups end the drag, never select.
    canvas.addEventListener('pointerdown', this._onPointerDown);
    interactionElement.addEventListener('pointermove', this._onPointerMove);
    this._onInteractionPointerUp = (e: PointerEvent): void => {
      if (e.target === canvas || e.target === interactionElement || this._pointerSessionActive)
        this._onPointerUp(e);
    };
    interactionElement.addEventListener('pointerup', this._onInteractionPointerUp);

    // Double-click = DRILL IN (see `_onDoubleClick`). Bound on the interaction
    // element for the same reason `pointerup` is: OrbitControls captures the
    // pointer on every down, and a captured pointer's click/dblclick is
    // retargeted to the capture element, so a canvas-bound listener can miss
    // real input while synthetic events still reach it.
    this._onInteractionDblClick = (e: MouseEvent): void => {
      if (e.target === canvas || e.target === interactionElement) this._onDoubleClick(e);
    };
    interactionElement.addEventListener('dblclick', this._onInteractionDblClick);

    // Asset drag-and-drop onto viewport
    canvas.addEventListener('dragover', this._onDragOver);
    canvas.addEventListener('dragleave', this._onDragLeave);
    canvas.addEventListener('drop', this._onDrop);

    // Collect editor infrastructure objects so they can be moved between scenes
    this._editorObjects = [
      this.grid,
      ...(this._axisLines ? [this._axisLines] : []),
      this._editorAmbient,
      this._editorDirLight,
      this.batchedRenderer,
      this._gizmoHelper,
      this._auxRotateControls.getHelper(),
      this._auxScaleControls.getHelper(),
      this._pivotDummy,
      this._surfaceSnapIndicator,
      this._vertexSnapIndicator,
    ];

    // D12 (B4) — publish the camera/canvas seam `VgaiSceneAuthoringAdapter.pickable`
    // needs (it has no other way to reach them). Cleared in `dispose()`.
    if (this._publishPickContext) {
      this._installPickContext(this.camera);
    }
  }

  /** Swap the scene the viewport renders. Moves editor infrastructure objects to the new scene. */
  setScene(newScene: THREE.Scene): void {
    if (newScene === this._scene) return;
    // Move editor infrastructure to new scene
    for (const obj of this._editorObjects) {
      obj.removeFromParent();
      newScene.add(obj);
    }
    // Move box helpers
    for (const helper of this._boxHelpers.values()) {
      helper.removeFromParent();
      newScene.add(helper);
    }
    for (const helper of this._constraintHelpers.values()) {
      helper.removeFromParent();
      newScene.add(helper);
    }
    for (const helper of this._reflectionProbeHelpers.values()) {
      helper.removeFromParent();
      newScene.add(helper);
    }
    for (const helper of this._triggerVolumeHelpers.values()) {
      helper.removeFromParent();
      newScene.add(helper);
    }
    for (const { helper } of this._cameraHelpers.values()) {
      helper.removeFromParent();
      newScene.add(helper);
    }
    for (const root of this._spatialHandleRoots) {
      root.removeFromParent();
      newScene.add(root);
    }
    this._scene = newScene;
    this._contentBoundsAt = 0; // different content → re-measure before the next draw
    // The light rig is a design-time visibility aid for editor-owned scenes.
    // An ADOPTED live game scene (play adoption, ingest, the R3F design
    // session) owns its lighting completely — the editor camera sees
    // EDITOR_LAYER lights, so the rig would add a white ambient+directional
    // the game camera never sees, and the mismatch pops as a color/brightness
    // shift the instant play takes over the draw. WYSIWYG for adopted scenes.
    // A stage bound to a view presentation is lit by it instead (`bindPresentation`).
    const rigOn = this._lightRig && !this._store.isAdoptedSceneActive && this._presentation === null;
    this._editorAmbient.visible = rigOn;
    this._editorDirLight.visible = rigOn;
  }

  get currentScene(): THREE.Scene {
    return this._scene;
  }

  /** Camera that currently paints the Scene document. Ordinarily this is the
   *  free editor camera; view-through/pilot temporarily returns the authored
   *  native camera without changing its ownership. */
  get renderCamera(): THREE.Camera {
    return this._cameraView ?? this.freeCamera;
  }

  get freeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this._projection === 'orthographic' ? this.orthographicCamera : this.camera;
  }

  get projection(): ThreeViewportProjection {
    return this._projection;
  }

  private _installPickContext(camera: THREE.Camera): void {
    if (!this._publishPickContext) return;
    setViewportPickContext({
      camera,
      canvas: this._canvas,
      editorControls: {
        activate: (clientX, clientY) =>
          this._selectConstraintControlAt({ clientX, clientY }, false),
        hover: (clientX, clientY) => this._hoverConstraintControlAt({ clientX, clientY }),
        clearHover: () => this._clearConstraintControlHover(),
      },
    });
  }

  setProjection(projection: ThreeViewportProjection): void {
    if (this._cameraView) {
      this._pendingProjection = projection;
      return;
    }
    if (this._projection === projection) return;
    if (projection === 'orthographic') this._syncOrthographicFromPerspective();
    else this._syncPerspectiveFromOrthographic();
    this._projection = projection;
    const camera = this.freeCamera;
    this.orbitControls.object = camera;
    for (const controls of this._allGizmos()) controls.camera = camera;
    // The two projections scale a handle differently, so a look-stated pixel
    // size resolves to a different `size` on each ({@link _applyGizmoSize}).
    this._applyGizmoSize();
    this.orbitControls.update();
    this._installPickContext(camera);
    this._onProjectionChange?.(projection);
  }

  private _syncOrthographicFromPerspective(preserveHeight = false): void {
    const distance = Math.max(
      0.01,
      this.camera.position.distanceTo(this.orbitControls?.target ?? new THREE.Vector3()),
    );
    if (!preserveHeight) {
      this._orthographicHeight =
        2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    }
    this.orthographicCamera.position.copy(this.camera.position);
    this.orthographicCamera.quaternion.copy(this.camera.quaternion);
    this.orthographicCamera.up.copy(this.camera.up);
    this.orthographicCamera.zoom = 1;
    this._applyOrthographicFrustum();
    this.orthographicCamera.updateMatrixWorld(true);
  }

  private _syncPerspectiveFromOrthographic(): void {
    const visibleHeight = this._orthographicHeight / Math.max(this.orthographicCamera.zoom, 0.01);
    const distance =
      visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));
    const direction = this.orthographicCamera.position
      .clone()
      .sub(this.orbitControls.target)
      .normalize();
    this.camera.position.copy(this.orbitControls.target).add(direction.multiplyScalar(distance));
    this.camera.quaternion.copy(this.orthographicCamera.quaternion);
    this.camera.up.copy(this.orthographicCamera.up);
    this.camera.updateMatrixWorld(true);
  }

  private _applyOrthographicFrustum(): void {
    const halfHeight = this._orthographicHeight * 0.5;
    const halfWidth = halfHeight * this._viewportAspect;
    this.orthographicCamera.left = -halfWidth;
    this.orthographicCamera.right = halfWidth;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  /**
   * THE GIZMOS' CAMERA while a stage draws through another one (a document's camera view): the
   * handles size, face and pick against what is on screen. Null gives them back the free camera.
   */
  setGizmoCamera(camera: THREE.Camera | null): void {
    const target = camera ?? this.freeCamera;
    if (this.transformControls.camera === target) return;
    for (const controls of this._allGizmos()) controls.camera = target;
    this._applyGizmoSize();
  }

  /**
   * THE MOUSE THE ACTIVE KEYMAP STATES (`KeymapContribution.navigation`): the button that orbits.
   * Orbiting on the middle button pans with Shift on it (OrbitControls' own modifier swap), and
   * the right button then does nothing here, as in Blender, where it is the context menu's.
   */
  private applyKeymapNavigation(): void {
    const { orbit, turntable } = activeKeymapNavigation();
    // Only a turntable keeps a roll: under any other orbit the view comes back level (a Top
    // view's screen up, which is no roll, stands).
    if (!turntable && this.camera.up.y < 0.9999 && Math.abs(this.camera.up.z) < 0.9999) this.camera.up.set(0, 1, 0);
    this.orbitControls.mouseButtons = {
      // The left button selects; only an Alt-drag in progress orbits with it (`_onAltOrbitStart`).
      LEFT: this._altDragOrbit ? THREE.MOUSE.ROTATE : (-1 as THREE.MOUSE),
      MIDDLE: orbit === 'middle' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      RIGHT: orbit === 'middle' ? (-1 as THREE.MOUSE) : THREE.MOUSE.ROTATE,
    };
  }
  private _unsubscribeKeymap: () => void = () => {};

  /**
   * A KEYMAP'S TURNTABLE (`KeymapNavigation.turntable`) in place of three's spherical orbit, on
   * OrbitControls' own rotate drag so its buttons, capture and modifiers stand. Blender's
   * `viewrotate_apply` (`view3d_navigate_view_rotate.cc`), Turntable branch: the vertical drag
   * pitches about the horizon, `up × view z`, blended toward the view's own X as the view nears
   * straight up or down (`fac = (|angle(up, view z) / π − ½| · 2)²`), and the sideways drag spins
   * about the world's up, turned the other way when the view started upside down (`reverse`);
   * both about the orbit's pivot at its distance. The view keeps its roll and passes over the
   * top: the roll rides on the camera's `up`, which the orbit's `lookAt` keeps.
   */
  private _installTurntable(): void {
    const controls = this.orbitControls as unknown as {
      _handleMouseDownRotate(event: PointerEvent): void;
      _handleMouseMoveRotate(event: PointerEvent): void;
      _handleTouchStartRotate(event: PointerEvent): void;
    };
    // A touch rotate is a rotate too, for whoever ensures the projection when one starts.
    const touchDown = controls._handleTouchStartRotate.bind(this.orbitControls);
    controls._handleTouchStartRotate = (event) => {
      for (const listener of [...this._rotateStartListeners]) listener();
      touchDown(event);
    };
    const down = controls._handleMouseDownRotate.bind(this.orbitControls);
    const move = controls._handleMouseMoveRotate.bind(this.orbitControls);
    let drag: { x: number; y: number; reverse: number } | null = null;
    controls._handleMouseDownRotate = (event) => {
      down(event);
      drag = null;
      for (const listener of [...this._rotateStartListeners]) listener();
      if (!activeKeymapNavigation().turntable) return;
      const camera = this.orbitControls.object;
      const viewUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      drag = { x: event.clientX, y: event.clientY, reverse: viewUp.y < 0 ? -1 : 1 };
    };
    controls._handleMouseMoveRotate = (event) => {
      const turntable = activeKeymapNavigation().turntable;
      if (!turntable || !drag) {
        move(event);
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      this._turntableStep(dx, dy, drag.reverse, THREE.MathUtils.degToRad(turntable.degreesPerPixel));
    };
  }

  private readonly _rotateStartListeners = new Set<() => void>([
    // Auto Perspective on a stage that draws with the viewport's own projection (a document's
    // session keeps its own and answers for it).
    () => {
      if (!activeKeymapNavigation().autoPerspective || this._projection !== 'orthographic') return;
      const offset = this.camera.position.clone().sub(this.orbitControls.target);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      if (axisViewName(offset, up) !== null) this.setProjection('perspective');
    },
  ]);

  /**
   * Called as a click on the navigation gizmo turns the view to an axis, newest first, until one
   * answers `true`: the owner of the view's projection (a document's session; else the
   * viewport's own), which Blender's `view3d.view_axis` makes orthographic under Auto Perspective.
   */
  private readonly _axisViewListeners: (() => boolean)[] = [
    () => {
      if (activeKeymapNavigation().autoPerspective) this.setProjection('orthographic');
      return true;
    },
  ];

  onAxisView(listener: () => boolean): () => void {
    this._axisViewListeners.push(listener);
    return () => {
      const at = this._axisViewListeners.indexOf(listener);
      if (at !== -1) this._axisViewListeners.splice(at, 1);
    };
  }

  /** Called as a person's rotate drag begins, before its first step (a pan or a zoom is not
   *  one): where Blender's rotate operator ensures its projection. */
  onRotateStart(listener: () => void): () => void {
    this._rotateStartListeners.add(listener);
    return () => this._rotateStartListeners.delete(listener);
  }

  /**
   * ONE STEP OF THE VIEW about the orbit's pivot, as Blender's numpad makes it
   * (`view3d_navigate_view_orbit.cc`, `view3d_navigate_view_roll.cc`): an orbit of 15°
   * (`pad_rot_angle`) about the world's up or the view's horizon, the opposite side (π about the
   * up), or a roll of 15° about the view's axis. `viewquat · q` on Blender's world-to-view
   * rotation is `q⁻¹` applied to the camera's. The projection stands: neither operator ensures
   * perspective.
   */
  stepView(step: 'orbit-left' | 'orbit-right' | 'orbit-up' | 'orbit-down' | 'opposite' | 'roll-left' | 'roll-right'): void {
    const camera = this.orbitControls.object;
    const target = this.orbitControls.target;
    const angle = THREE.MathUtils.degToRad(15);
    const up = new THREE.Vector3(0, 1, 0);
    const viewX = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const viewZ = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const turn = new THREE.Quaternion();
    switch (step) {
      case 'orbit-left':
        turn.setFromAxisAngle(up, -angle);
        break;
      case 'orbit-right':
        turn.setFromAxisAngle(up, angle);
        break;
      case 'orbit-up':
        turn.setFromAxisAngle(viewX, -angle);
        break;
      case 'orbit-down':
        turn.setFromAxisAngle(viewX, angle);
        break;
      case 'opposite':
        turn.setFromAxisAngle(up, Math.PI);
        break;
      case 'roll-left':
        turn.setFromAxisAngle(viewZ, -angle);
        break;
      case 'roll-right':
        turn.setFromAxisAngle(viewZ, angle);
        break;
    }
    const rotation = turn.multiply(camera.quaternion).normalize();
    const distance = camera.position.distanceTo(target);
    camera.quaternion.copy(rotation);
    camera.position.copy(target).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation), distance);
    camera.up.set(0, 1, 0).applyQuaternion(rotation);
    this.orbitControls.update();
  }

  /** One turntable step of `dx`, `dy` CSS pixels (right and down positive). */
  private _turntableStep(dx: number, dy: number, reverse: number, radiansPerPixel: number): void {
    const camera = this.orbitControls.object;
    const target = this.orbitControls.target;
    const up = new THREE.Vector3(0, 1, 0);
    const viewX = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const viewZ = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const axis = new THREE.Vector3();
    if (up.distanceToSquared(viewZ) > 0.001) {
      axis.crossVectors(up, viewZ);
      if (axis.dot(viewX) < 0) axis.negate();
      const fac = ((Math.abs(up.angleTo(viewZ) / Math.PI - 0.5) * 2) ** 2);
      axis.lerp(viewX, fac);
    } else {
      axis.copy(viewX);
    }
    if (axis.lengthSq() === 0) axis.copy(viewX);
    axis.normalize();
    // Blender's `viewquat · q_x · q_z` on the world-to-view rotation is, on the camera's own
    // (view to world), the inverse pair applied the other side; its y runs up the screen.
    const pitch = new THREE.Quaternion().setFromAxisAngle(axis, -radiansPerPixel * dy);
    const spin = new THREE.Quaternion().setFromAxisAngle(up, -radiansPerPixel * reverse * dx);
    const rotation = spin.multiply(pitch).multiply(camera.quaternion).normalize();
    const distance = camera.position.distanceTo(target);
    camera.quaternion.copy(rotation);
    camera.position.copy(target).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation), distance);
    camera.up.set(0, 1, 0).applyQuaternion(rotation);
    this.orbitControls.update();
  }

  get cameraViewMode(): CameraViewMode | null {
    return this._cameraViewMode;
  }

  /** Enter an exact native camera view. Pilot additionally hands OrbitControls
   *  the authored camera; the caller owns begin/apply/end persistence. */
  setCameraView(camera: THREE.Camera, mode: CameraViewMode): void {
    this.clearCameraView();
    this._cameraView = camera;
    this._cameraViewMode = mode;
    this._orbitEnabledBeforeCameraView = this.orbitControls.enabled;
    this._orbitTargetBeforeCameraView.copy(this.orbitControls.target);
    if (mode === 'pilot') {
      const position = camera.getWorldPosition(new THREE.Vector3());
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const distance = Math.max(1, this.freeCamera.position.distanceTo(this.orbitControls.target));
      this.orbitControls.object = camera;
      this.orbitControls.target.copy(position).add(forward.multiplyScalar(distance));
      this.orbitControls.enabled = true;
      this.orbitControls.update();
    } else {
      this.orbitControls.enabled = false;
    }
    if (this._publishPickContext) {
      this._installPickContext(camera);
    }
  }

  /** Restore the free editor camera exactly where it was before view-through. */
  clearCameraView(): void {
    if (!this._cameraView) return;
    if (this._flyActive) this._exitFlyMode();
    this.orbitControls.object = this.freeCamera;
    this.orbitControls.target.copy(this._orbitTargetBeforeCameraView);
    this.orbitControls.enabled = this._orbitEnabledBeforeCameraView;
    this.orbitControls.update();
    this._cameraView = null;
    this._cameraViewMode = null;
    const pendingProjection = this._pendingProjection;
    this._pendingProjection = null;
    if (pendingProjection && pendingProjection !== this._projection) {
      this.setProjection(pendingProjection);
    }
    if (this._publishPickContext) {
      this._installPickContext(this.freeCamera);
    }
  }

  get objectMap(): Map<string, THREE.Object3D> {
    return this._objectMap;
  }
  set objectMap(map: Map<string, THREE.Object3D>) {
    this._objectMap = map;
  }

  /** Attach gizmo to entity by id. */
  attach(id: string): void {
    const obj = this._objectForAuthoringId(id);
    if (!obj) return;
    this._attachedAuthoringId = id;
    this._attachGizmosTo(obj);
  }

  /** Detach gizmo. */
  detach(): void {
    this._attachedAuthoringId = null;
    this._detachGizmos();
  }

  /** Resolve an authoring identity to the adapter's native spatial target.
   * This is intentionally adapter-owned: source-backed component callsites
   * may select one identity while rendering their transform on a child. */
  private _objectForAuthoringId(id: string): THREE.Object3D | null {
    const authoring = this._authoring();
    // Edit↔Play swaps the owning child adapter before it rebuilds the native
    // selection graph. A selection from the outgoing graph is temporarily
    // stale during that handoff; treat it as absent instead of asking the
    // composite to resolve an id no current root owns (which correctly logs a
    // refusal for genuinely bogus ids).
    if (authoring.hierarchy.node(id) === null) return null;
    return entityObject3D(authoring, this._objectMap, id);
  }

  private _authoringIdForObject(object: THREE.Object3D): string | null {
    return this._authoring().hierarchy.idForObject3D?.(object) ?? entityIdOf(object) ?? null;
  }

  /**
   * The same target expansion the silhouette uses decides whether a node owns
   * pixels. Keeping the question shared prevents a renderable selection from
   * receiving both an outline and fallback brackets, or neither.
   */
  private _hasBoundableGeometry(obj: THREE.Object3D): boolean {
    return collectThreeSelectionOutlineTargets([obj]).length > 0;
  }

  /** One Bounds-diagnostic visual: the plain twelve-edge box, or the
   *  fixed-size wire cube for an entity with no boundable geometry. */
  private _makeDiagnosticBounds(obj: THREE.Object3D): BoundsHelper {
    if (this._hasBoundableGeometry(obj)) {
      return new ContentBoundsHelper(obj, nativeSelectionColors(this._canvas).visible);
    }
    const geo = new THREE.BoxGeometry(
      DEGENERATE_HELPER_SIZE,
      DEGENERATE_HELPER_SIZE,
      DEGENERATE_HELPER_SIZE,
    );
    const edges = new THREE.EdgesGeometry(geo);
    geo.dispose();
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(nativeSelectionColors(this._canvas).visible),
      toneMapped: false,
    });
    const wire = new THREE.LineSegments(edges, mat) as unknown as TaggedHelper;
    obj.getWorldPosition(wire.position);
    // Tag so we can update/dispose like BoxHelper
    wire.isBoxHelper = true;
    wire._entityObj = obj;
    return wire;
  }

  /**
   * Rebuild the bounds visuals: the Bounds DIAGNOSTIC (plain full boxes over
   * every entity, a density view) and the non-renderable SELECTION fallback
   * (corner brackets — see `selection-brackets.ts`). Renderable selections are
   * painted by the native postprocessing silhouette instead.
   */
  private _syncBoxHelpers(): void {
    // Remove old + dispose geometry/materials on rebuild (LK6).
    for (const helper of this._boxHelpers.values()) {
      this._scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this._boxHelpers.clear();

    const add = (key: string, helper: BoundsHelper): void => {
      helper.layers.set(EDITOR_LAYER);
      this._scene.add(helper);
      this._boxHelpers.set(key, helper);
    };

    if (this._store.shell.showHelpers && this._store.shell.helperVisibility.bounds) {
      for (const id of this._objectMap.keys()) {
        const obj = this._objectForAuthoringId(id);
        if (obj) add(`bounds:${id}`, this._makeDiagnosticBounds(obj));
      }
    }

    // A geometry-following outline cannot paint a camera, light, audio source,
    // bone or empty transform. Those nodes retain the screen-space bracket
    // fallback so every hierarchy row can still be found in the viewport.
    for (const id of this._store.shell.selectedEntityIds) {
      const obj = this._objectForAuthoringId(id);
      if (!obj) continue;
      const geometric = this._hasBoundableGeometry(obj);
      if (geometric && this._selectionMarks.wire) {
        let index = 0;
        obj.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry || isInEditorOwnedSubtree(mesh)) return;
          const look = nativeViewportWire(this._canvas);
          const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(mesh.geometry),
            new THREE.LineBasicMaterial({
              color: look.color ?? nativeSelectionColors(this._canvas).visible,
              transparent: true,
              opacity: look.opacity ?? 0.5,
              depthTest: true,
            }),
          ) as WireHelper;
          wire.matrixAutoUpdate = false;
          wire._wireOf = mesh;
          add(`wire:${id}:${index++}`, wire);
        });
      }
      if (geometric && !this._selectionMarks.box) continue;
      if (geometric) {
        const box = nativeViewportSelectionBox(this._canvas);
        add(
          `selection:${id}`,
          new SelectionBrackets(obj, {
            color: nativeSelectionColors(this._canvas).visible,
            edges: box.edges,
            frame: box.frame,
            ...(box.lineWidth === null ? {} : { lineWidth: box.lineWidth }),
          }),
        );
        continue;
      }
      // Object3D documents paint bones with their native selected-joint point
      // and thick incident segments. The generic empty-transform brackets are
      // a second, less specific selection treatment and make the rig overlay
      // read like a field of box corners.
      if (this._standaloneAuthoring && (obj as THREE.Bone).isBone) continue;
      // Constraint owners, targets and poles already have a semantic native
      // viewport presentation (lines plus a target/pole handle). Drawing the
      // legacy empty-transform corner brackets over that presentation creates
      // two competing selection languages and obscures the draggable handle.
      if ([...this._constraintHelpers.values()].some((helper) => helper.presents(obj))) continue;
      // Nor over an object whose document draws its overlay itself, selection colour included
      // (`userData.vgaiOwnOverlay`: a Blender camera, light or empty).
      if (obj.userData['vgaiOwnOverlay']) continue;
      add(
        `selection:${id}`,
        new SelectionBrackets(obj, {
          fixedSize: DEGENERATE_HELPER_SIZE,
          color: nativeSelectionColors(this._canvas).visible,
        }),
      );
    }
  }

  /**
   * Keep one editor-owned influence/parallax visual beside every live probe.
   * The source component stays an empty, ordinary transform node; these
   * helpers live on EDITOR_LAYER and therefore never enter Game view.
   */
  private _syncReflectionProbeHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Object3D>();
      const admitted = new Set<THREE.Object3D>();
      for (const [id, object] of this._objectMap) {
        if (!object || admitted.has(object) || !reflectionProbeOf(object)) continue;
        admitted.add(object);
        current.set(id, object);
      }
      for (const [id, helper] of this._reflectionProbeHelpers) {
        if (current.get(id) === helper.source) continue;
        helper.dispose();
        this._reflectionProbeHelpers.delete(id);
      }
      for (const [id, source] of current) this._ensureReflectionProbeHelper(id, source);
    } else {
      let requiresFullReconcile = false;
      for (const id of changedIds) {
        const source = this._objectMap.get(id);
        const next = source && reflectionProbeOf(source) ? source : null;
        const previous = this._reflectionProbeHelpers.get(id);
        if (previous && previous.source !== next) {
          if (next === null) requiresFullReconcile = true;
          previous.dispose();
          this._reflectionProbeHelpers.delete(id);
        }
        if (
          next &&
          ![...this._reflectionProbeHelpers.values()].some((helper) => helper.source === next)
        ) {
          this._ensureReflectionProbeHelper(id, next);
        }
      }
      if (requiresFullReconcile) {
        this._syncReflectionProbeHelpers();
        return;
      }
    }
    for (const [id, helper] of this._reflectionProbeHelpers) {
      helper.setSelected(this._store.shell.selectedEntityIds.has(id));
      helper.visible =
        this._threejsToolContextActive &&
        this._store.shell.showHelpers &&
        this._store.shell.helperVisibility.reflectionProbes;
      helper.update();
    }
  }

  private _ensureReflectionProbeHelper(id: string, source: THREE.Object3D): void {
    if (this._reflectionProbeHelpers.has(id)) return;
    const helper = new ReflectionProbeHelper(source);
    this._reflectionProbeHelpers.set(id, helper);
    this._scene.add(helper);
  }

  /**
   * WHERE A TRIGGER FIRES. A group whose `userData.triggerVolume.radius` decides
   * where a hazard fires or a quest arrives has a hierarchy row and no geometry,
   * so the viewport showed nothing at all where it sits. The game must not draw
   * it: game source here is ecosystem-native and asks the runtime nothing about
   * being authored. So the editor draws it, in the shape `_syncLightHelpers`
   * already uses — editor-owned, on EDITOR_LAYER, never in the game's tree and
   * never in Play.
   */
  private _syncTriggerVolumeHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Object3D>();
      const admitted = new Set<THREE.Object3D>();
      for (const [id, object] of this._objectMap) {
        if (!object || admitted.has(object) || !triggerVolumeOf(object)) continue;
        admitted.add(object);
        current.set(id, object);
      }
      for (const [id, helper] of this._triggerVolumeHelpers) {
        if (current.get(id) === helper.source) continue;
        this._disposeTriggerVolumeHelper(id, helper);
      }
      for (const [id, source] of current) this._ensureTriggerVolumeHelper(id, source);
    } else {
      let requiresFullReconcile = false;
      for (const id of changedIds) {
        const source = this._objectMap.get(id);
        const next = source && triggerVolumeOf(source) ? source : null;
        const previous = this._triggerVolumeHelpers.get(id);
        if (previous && previous.source !== next) {
          if (next === null) requiresFullReconcile = true;
          this._disposeTriggerVolumeHelper(id, previous);
        }
        if (
          next &&
          ![...this._triggerVolumeHelpers.values()].some((helper) => helper.source === next)
        ) {
          this._ensureTriggerVolumeHelper(id, next);
        }
      }
      if (requiresFullReconcile) {
        this._syncTriggerVolumeHelpers();
        return;
      }
    }
    const visible =
      this._threeSurfaceShowing &&
      this._store.shell.showHelpers &&
      this._store.shell.helperVisibility.triggerVolumes;
    for (const [id, helper] of this._triggerVolumeHelpers) {
      helper.setSelected(this._store.shell.selectedEntityIds.has(id));
      helper.visible = visible;
      helper.update();
    }
  }

  private _ensureTriggerVolumeHelper(id: string, source: THREE.Object3D): void {
    if (this._triggerVolumeHelpers.has(id)) return;
    const helper = new TriggerVolumeHelper(source);
    this._triggerVolumeHelpers.set(id, helper);
    this._scene.add(helper);
  }

  private _disposeTriggerVolumeHelper(id: string, helper: TriggerVolumeHelper): void {
    helper.dispose();
    this._triggerVolumeHelpers.delete(id);
  }

  /** Keep one editor-owned projection beside every source-owned constraint owner. */
  private _syncConstraintHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Object3D>();
      const admitted = new Set<THREE.Object3D>();
      for (const [id, object] of this._objectMap) {
        if (!object || admitted.has(object) || constraintsOf(object).length === 0) continue;
        admitted.add(object);
        current.set(id, object);
      }
      for (const [id, helper] of this._constraintHelpers) {
        if (current.get(id) === helper.source) continue;
        this._disposeConstraintHelper(helper);
        this._constraintHelpers.delete(id);
      }
      for (const [id, source] of current) this._ensureConstraintHelper(id, source);
    } else {
      let requiresFullReconcile = false;
      for (const id of changedIds) {
        const source = this._objectMap.get(id);
        const next = source && constraintsOf(source).length > 0 ? source : null;
        const previous = this._constraintHelpers.get(id);
        if (previous && previous.source !== next) {
          if (next === null) requiresFullReconcile = true;
          this._disposeConstraintHelper(previous);
          this._constraintHelpers.delete(id);
        }
        if (
          next &&
          ![...this._constraintHelpers.values()].some((helper) => helper.source === next)
        ) {
          this._ensureConstraintHelper(id, next);
        }
      }
      if (requiresFullReconcile) {
        this._syncConstraintHelpers();
        return;
      }
    }

    const selectedObjects = new Set<THREE.Object3D>();
    for (const id of this._store.shell.selectedEntityIds) {
      const object = this._objectForAuthoringId(id);
      if (object) selectedObjects.add(object);
    }

    for (const [id, helper] of this._constraintHelpers) {
      helper.setSelected(this._store.shell.selectedEntityIds.has(id));
      helper.setSelectedObjects(selectedObjects);
      helper.visible =
        this._threejsToolContextActive &&
        this._store.shell.showHelpers &&
        this._store.shell.helperVisibility.constraints;
      helper.update(this.camera);
    }
  }

  private _ensureConstraintHelper(id: string, source: THREE.Object3D): void {
    if (this._constraintHelpers.has(id)) return;
    const helper = new ConstraintHelper(source);
    this._constraintHelpers.set(id, helper);
    this._scene.add(helper);
  }

  private _disposeConstraintHelper(helper: ConstraintHelper): void {
    if (this._hoveredConstraintControl?.helper === helper) {
      this._hoveredConstraintControl = null;
    }
    helper.dispose();
  }

  /** Constraint effectors are editor-owned projections, so the ordinary world
   * picker correctly ignores them. Give just target/pole meshes a narrow
   * helper-picking path that resolves back to their real hierarchy objects. */
  private _raycastConstraintControl(e: {
    clientX: number;
    clientY: number;
  }): { helper: ConstraintHelper; control: ConstraintControl } | null {
    const candidates: THREE.Mesh[] = [];
    for (const helper of this._constraintHelpers.values()) {
      if (helper.visible) candidates.push(...helper.controlMeshes());
    }
    if (candidates.length === 0) return null;
    const rect = this._canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._constraintControlRaycaster.setFromCamera(pointer, this._screenCamera);
    const hit = this._constraintControlRaycaster.intersectObjects(candidates, false)[0]?.object;
    if (!hit) return null;
    for (const helper of this._constraintHelpers.values()) {
      const control = helper.controlFor(hit);
      if (control) return { helper, control };
    }
    return null;
  }

  private _updateConstraintControlHover(e: PointerEvent): boolean {
    if (e.buttons & 1) return this._constraintControlPointerSession;
    const cursor = this._hoverConstraintControlAt(e);
    if (!cursor) {
      this._canvas.style.cursor = '';
      return false;
    }
    if (this._hoveredSpatialHandle) {
      setSpatialHandleHovered(this._hoveredSpatialHandle, false);
      this._hoveredSpatialHandle = null;
    }
    this._canvas.style.cursor = cursor;
    return true;
  }

  private _hoverConstraintControlAt(e: {
    clientX: number;
    clientY: number;
  }): 'pointer' | 'not-allowed' | null {
    const hit = this._raycastConstraintControl(e);
    const previous = this._hoveredConstraintControl;
    if (!hit) {
      this._clearConstraintControlHover();
      return null;
    }
    if (previous?.mesh !== hit.control.mesh) {
      if (previous) previous.helper.setHoveredControl(null);
      hit.helper.setHoveredControl(hit.control.mesh);
      this._hoveredConstraintControl = { helper: hit.helper, mesh: hit.control.mesh };
    }
    return this._authoringIdForObject(hit.control.object) ? 'pointer' : 'not-allowed';
  }

  private _clearConstraintControlHover(): void {
    this._hoveredConstraintControl?.helper.setHoveredControl(null);
    this._hoveredConstraintControl = null;
  }

  private _selectConstraintControlAt(
    e: { clientX: number; clientY: number },
    trackPointerSession = true,
  ): boolean {
    const hit = this._raycastConstraintControl(e);
    if (!hit) return false;
    this._constraintControlPointerSession = trackPointerSession;
    const id = this._authoringIdForObject(hit.control.object);
    if (id) {
      const adapter = this._authoring();
      if (!setAuthoringSelection(adapter, [id], { intent: 'exact' })) this._store.shell.select(id);
      showTransientHint(`${hit.control.label} selected — move it with the gizmo.`);
    } else {
      showTransientHint(`${hit.control.label} is a runtime-only constraint control.`);
    }
    return true;
  }

  /** Native camera frustums for the ordinary Helpers → Cameras overlay. */
  private _syncCameraHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Camera>();
      for (const [id, object] of this._objectMap) {
        const camera = this._nativeCamera(object);
        if (camera) current.set(id, camera);
      }
      for (const [id, entry] of this._cameraHelpers) {
        if (current.get(id) === entry.source) continue;
        this._disposeCameraHelper(id, entry);
      }
      for (const [id, camera] of current) this._ensureCameraHelper(id, camera);
    } else {
      let requiresFullReconcile = false;
      for (const id of changedIds) {
        const object = this._objectMap.get(id);
        const next = object ? this._nativeCamera(object) : null;
        const previous = this._cameraHelpers.get(id);
        if (previous && previous.source !== next) {
          if (next === null) requiresFullReconcile = true;
          this._disposeCameraHelper(id, previous);
        }
        if (next && ![...this._cameraHelpers.values()].some((entry) => entry.source === next)) {
          this._ensureCameraHelper(id, next);
        }
      }
      if (requiresFullReconcile) {
        this._syncCameraHelpers();
        return;
      }
    }
    // PERSISTENT, like every other engine's camera icon: Unity, Unreal, Godot
    // and Blender all draw a camera in the viewport whether or not it is
    // selected — that drawing is HOW you find it and click it. Gating it on a
    // three selection meant a scene with nothing selected showed no cameras at
    // all, and the only way to see one was to already have found it in the
    // hierarchy. The surface gate is the same one the grid uses ("Blender's
    // floor is persistent; only the gizmos need an owner"); a camera icon is
    // furniture, not a gizmo.
    const visible =
      this._threeSurfaceShowing && this._store.shell.showHelpers && this._store.shell.helperVisibility.cameras;
    for (const entry of this._cameraHelpers.values()) {
      entry.helper.visible = visible;
      entry.helper.update();
    }
  }

  /**
   * WHERE A LIGHT POINTS, drawn beside it — three's own light helpers on the
   * editor layer, gated by the Helpers → Lights toggle that already existed
   * with nothing behind it.
   *
   * Two testers asked for this in the same words: with a directional light
   * selected there was no way to tell which way it threw ("is it on the left
   * side, the right, downwards?" — runhuman passes 68/70), and a point light
   * showed only its transform. Same shape as `_syncCameraHelpers`: one
   * editor-owned overlay per native light, reconciled per notify, never in the
   * game's tree and never in Game view.
   */
  private _syncLightHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Light>();
      for (const [id, object] of this._objectMap) {
        const light = this._nativeLight(object);
        if (light) current.set(id, light);
      }
      for (const [id, entry] of this._lightHelpers) {
        if (current.get(id) === entry.source) continue;
        this._disposeLightHelper(id, entry);
      }
      for (const [id, light] of current) this._ensureLightHelper(id, light);
    } else {
      let requiresFullReconcile = false;
      for (const id of changedIds) {
        const object = this._objectMap.get(id);
        const next = object ? this._nativeLight(object) : null;
        const previous = this._lightHelpers.get(id);
        if (previous && previous.source !== next) {
          if (next === null) requiresFullReconcile = true;
          this._disposeLightHelper(id, previous);
        }
        if (next && ![...this._lightHelpers.values()].some((entry) => entry.source === next)) {
          this._ensureLightHelper(id, next);
        }
      }
      if (requiresFullReconcile) {
        this._syncLightHelpers();
        return;
      }
    }
    // Persistent for the same reason as the camera frustum above: a light you
    // have not selected is exactly the light you are looking for.
    const visible =
      this._threeSurfaceShowing && this._store.shell.showHelpers && this._store.shell.helperVisibility.lights;
    for (const entry of this._lightHelpers.values()) {
      entry.helper.visible = visible;
      entry.helper.update?.();
    }
  }

  /** A light the editor draws a helper for: not one whose document draws its own overlay
   *  (`userData.vgaiOwnOverlay`, the way `vgaiOwnMaterial` keeps a material its owner's). */
  private _nativeLight(object: THREE.Object3D): THREE.Light | null {
    if (object.userData['vgaiOwnOverlay']) return null;
    return (object as THREE.Light).isLight ? (object as THREE.Light) : null;
  }

  private _disposeLightHelper(
    id: string,
    entry: { source: THREE.Light; helper: THREE.Object3D & { dispose?(): void } },
  ): void {
    entry.helper.removeFromParent();
    entry.helper.dispose?.();
    this._lightHelpers.delete(id);
  }

  private _ensureLightHelper(id: string, light: THREE.Light): void {
    if (this._lightHelpers.has(id)) return;
    // An ambient/hemisphere light has no position or direction to draw, and a
    // light class this `three` does not know gets no overlay rather than a
    // wrong one — the same narrow refusal the camera overlay makes.
    const size = 0.5;
    let helper: (THREE.Object3D & { update?(): void; dispose?(): void }) | null = null;
    const candidate = light as THREE.Light & {
      isDirectionalLight?: boolean;
      isPointLight?: boolean;
      isSpotLight?: boolean;
      isHemisphereLight?: boolean;
    };
    try {
      if (candidate.isDirectionalLight) {
        helper = new THREE.DirectionalLightHelper(light as THREE.DirectionalLight, size);
      } else if (candidate.isPointLight) {
        helper = new THREE.PointLightHelper(light as THREE.PointLight, size);
      } else if (candidate.isSpotLight) {
        helper = new THREE.SpotLightHelper(light as THREE.SpotLight);
      } else if (candidate.isHemisphereLight) {
        helper = new THREE.HemisphereLightHelper(light as THREE.HemisphereLight, size);
      }
    } catch {
      helper = null;
    }
    if (!helper) return;
    helper.name = `Light helper: ${light.name || id}`;
    helper.userData['editorOnly'] = true;
    helper.traverse((child) => child.layers.set(EDITOR_LAYER));
    helper.layers.set(EDITOR_LAYER);
    this._lightHelpers.set(id, { source: light, helper });
    this._scene.add(helper);
  }

  /**
   * WHERE A SOUND COMES FROM, and how far it carries — the Helpers → Audio
   * toggle, which existed with nothing behind it exactly as Lights once did.
   *
   * A listener and a positional source have a place in the world and no
   * geometry, so without an overlay they are invisible in the viewport: the
   * hierarchy lists them and the scene shows nothing where they are. This
   * small marker locates each source. Selected-source distance and direction
   * guides belong to the adapter's spatial-handle provider, which understands
   * the native audio model and owns the corresponding edits. Markers follow
   * the same lifecycle as `_syncLightHelpers`: editor-owned, on the editor
   * layer, never in the game's tree and never in Game view.
   */
  private _syncAudioHelpers(changedIds: ReadonlySet<string> | null = null): void {
    if (changedIds === null) {
      const current = new Map<string, THREE.Object3D>();
      for (const [id, object] of this._objectMap) {
        const audio = this._nativeAudio(object);
        if (audio) current.set(id, audio);
      }
      for (const [id, entry] of this._audioHelpers) {
        if (current.get(id) === entry.source) continue;
        this._disposeAudioHelper(id, entry);
      }
      for (const [id, audio] of current) this._ensureAudioHelper(id, audio);
    } else {
      for (const id of changedIds) {
        const object = this._objectMap.get(id);
        const next = object ? this._nativeAudio(object) : null;
        const previous = this._audioHelpers.get(id);
        if (previous && previous.source !== next) this._disposeAudioHelper(id, previous);
        if (next && ![...this._audioHelpers.values()].some((entry) => entry.source === next)) {
          this._ensureAudioHelper(id, next);
        }
      }
    }
    const visible =
      this._threeSurfaceShowing && this._store.shell.showHelpers && this._store.shell.helperVisibility.audio;
    for (const entry of this._audioHelpers.values()) entry.helper.visible = visible;
  }

  /** A listener or an audio source, by three's own `type` — there is no
   *  `isAudio` flag to read the way `isLight`/`isCamera` are read. */
  private _nativeAudio(object: THREE.Object3D): THREE.Object3D | null {
    const type = object.type;
    return type === 'Audio' || type === 'PositionalAudio' || type === 'AudioListener'
      ? object
      : null;
  }

  private _ensureAudioHelper(id: string, source: THREE.Object3D): void {
    if (this._audioHelpers.has(id)) return;
    const helper = new THREE.Group();
    const colour = source.type === 'AudioListener' ? 0x7fd4ff : 0xffc98a;
    // A small octahedron marks the point itself — a listener has only a point.
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16),
      new THREE.MeshBasicMaterial({ color: colour, wireframe: true, depthTest: false }),
    );
    helper.add(marker);
    helper.name = `Audio helper: ${source.name || id}`;
    helper.userData['editorOnly'] = true;
    helper.traverse((child) => child.layers.set(EDITOR_LAYER));
    helper.layers.set(EDITOR_LAYER);
    // Parented to the source so it rides the same transform: a footstep
    // emitter on a walking character must not leave its ring behind.
    source.add(helper);
    this._audioHelpers.set(id, { source, helper });
  }

  private _disposeAudioHelper(
    id: string,
    entry: { source: THREE.Object3D; helper: THREE.Object3D & { dispose?(): void } },
  ): void {
    entry.helper.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose?.();
    });
    entry.helper.removeFromParent();
    this._audioHelpers.delete(id);
  }

  private _disposeCameraHelper(
    id: string,
    entry: { source: THREE.Camera; helper: THREE.CameraHelper },
  ): void {
    entry.helper.removeFromParent();
    entry.helper.dispose();
    this._cameraHelpers.delete(id);
  }

  private _ensureCameraHelper(id: string, camera: THREE.Camera): void {
    if (this._cameraHelpers.has(id)) return;
    // `CameraHelper` is the HOST's class reading fields off a camera the GAME may have made with
    // its own, older `three`. The failure is the discriminator; every compatible camera keeps its
    // overlay, while an incompatible revision records the narrow refusal below.
    let helper: THREE.CameraHelper;
    try {
      helper = new THREE.CameraHelper(camera);
    } catch (error) {
      this._refuseCameraOverlay(id, camera, error);
      return;
    }
    helper.name = `Camera frustum: ${camera.name || id}`;
    helper.userData['editorOnly'] = true;
    helper.layers.set(EDITOR_LAYER);
    this._cameraHelpers.set(id, { source: camera, helper });
    this._scene.add(helper);
  }

  /** Cameras whose frustum overlay the host's `three` refused to build. */
  private _refusedCameraOverlays = new Set<string>();
  private _refuseCameraOverlay(id: string, camera: THREE.Camera, error: unknown): void {
    if (this._refusedCameraOverlays.has(id)) return;
    this._refusedCameraOverlays.add(id);
    editorConsole.warn(
      `Helpers → Cameras draws no frustum for "${camera.name || camera.type}": ` +
        `${error instanceof Error ? error.message : String(error)}. This world's camera was ` +
        "constructed by the GAME's own copy of three, and `THREE.CameraHelper` is the editor's " +
        'class reading fields off it that that revision does not define. Every other camera ' +
        'capability (framing, selection, inspection) is unaffected. It closes when the game ' +
        "resolves `three` to the host's instance — a bare, un-rewritten `import 'three'` in its " +
        'own source.',
      'authoring',
    );
  }

  private _nativeCamera(object: THREE.Object3D): THREE.Camera | null {
    if (object.userData['vgaiOwnOverlay']) return null;
    if ((object as THREE.Camera).isCamera) return object as THREE.Camera;
    const owned = getUserData(object, '_camera');
    return owned?.isCamera ? owned : null;
  }

  /** Rebuild selected component guides from adapter-owned world-space data.
   * Detailed ranges/cones follow mainstream engine UX: they appear for the
   * selected component, while the Helpers menu owns their visibility. */
  private _syncSpatialHandles(): void {
    disposeSpatialHandleVisuals(this._spatialHandleRoots);
    this._spatialHandleRoots = [];
    this._spatialHandleMeshes = [];
    this._hoveredSpatialHandle = null;

    const provider = spatialHandlesForAdapter(this._authoring());
    if (!provider || !this._threejsToolContextActive || !this._store.shell.showHelpers) return;
    const visibility = this._store.shell.helperVisibility;
    for (const id of this._store.shell.selectedEntityIds) {
      const layers = provider.layers(id).filter((layer) => {
        if (!(layer.category in visibility)) return true;
        return visibility[layer.category as keyof typeof visibility];
      });
      const visuals = createSpatialHandleVisuals(id, layers);
      // Hidden/on-demand captures can draw before the next viewport tick, so
      // handles need their screen-constant scale at creation as well as during
      // the ordinary update loop.
      for (const handle of visuals.handles) scaleSpatialHandle(handle, this._screenCamera);
      for (const root of visuals.roots) this._scene.add(root);
      this._spatialHandleRoots.push(...visuals.roots);
      this._spatialHandleMeshes.push(...visuals.handles);
    }
  }

  private _raycastSpatialHandle(e: { clientX: number; clientY: number }): SpatialHandleMesh | null {
    if (this._spatialHandleMeshes.length === 0) return null;
    const rect = this._canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._spatialHandleRaycaster.setFromCamera(pointer, this._screenCamera);
    const hit = this._spatialHandleRaycaster.intersectObjects(this._spatialHandleMeshes, false)[0];
    return (hit?.object as SpatialHandleMesh | undefined) ?? null;
  }

  private _spatialHandleWorldPoint(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const rect = this._canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._spatialHandleRaycaster.setFromCamera(pointer, this._screenCamera);
    const point = new THREE.Vector3();
    if (!this._spatialHandleRaycaster.ray.intersectPlane(this._spatialHandleDragPlane, point)) {
      return null;
    }
    return point.add(this._spatialHandleDragOffset);
  }

  private _finishSpatialHandleDrag(commit: boolean): void {
    const active = this._activeSpatialHandle;
    this._activeSpatialHandle = null;
    this.orbitControls.enabled = this._orbitEnabledBeforeHandleDrag;
    this.transformControls.enabled = this._transformEnabledBeforeHandleDrag;
    this.syncFromStore();
    this._canvas.style.cursor = '';
    if (commit && active) {
      void spatialHandlesForAdapter(this._authoring())?.commit(active.nodeId, active.handle.id, [
        this._spatialHandleDragPoint.x,
        this._spatialHandleDragPoint.y,
        this._spatialHandleDragPoint.z,
      ]);
    }
  }

  private _updateSpatialHandleDrag(e: PointerEvent): boolean {
    const active = this._activeSpatialHandle;
    if (!active) return false;
    const point = this._spatialHandleWorldPoint(e);
    if (point) {
      this._spatialHandleDragPoint.copy(point);
      spatialHandlesForAdapter(this._authoring())?.preview(active.nodeId, active.handle.id, [
        point.x,
        point.y,
        point.z,
      ]);
      this._syncSpatialHandles();
      this._canvas.style.cursor = 'grabbing';
    }
    return true;
  }

  private _updateSpatialHandleHover(e: PointerEvent): void {
    if (e.buttons & 1 || this._spatialHandleMeshes.length === 0) return;
    const hovered = this._raycastSpatialHandle(e);
    if (hovered === this._hoveredSpatialHandle) return;
    if (this._hoveredSpatialHandle) setSpatialHandleHovered(this._hoveredSpatialHandle, false);
    this._hoveredSpatialHandle = hovered;
    if (!hovered) {
      this._canvas.style.cursor = '';
      return;
    }
    setSpatialHandleHovered(hovered, true);
    const binding = spatialHandleBinding(hovered);
    this._canvas.style.cursor = binding?.handle.writable ? 'grab' : 'not-allowed';
  }

  private _updateEditorHandleInteraction(e: PointerEvent): boolean {
    return this._updateSpatialHandleDrag(e) || this._updateConstraintControlHover(e);
  }

  private _previewInfrastructure(): THREE.Object3D[] {
    return [
      this.grid,
      ...(this._axisLines ? [this._axisLines] : []),
      this._gizmoHelper,
      this._auxRotateControls.getHelper(),
      this._auxScaleControls.getHelper(),
      ...this._boxHelpers.values(),
      ...this._constraintHelpers.values(),
      ...this._reflectionProbeHelpers.values(),
      ...this._triggerVolumeHelpers.values(),
      ...[...this._cameraHelpers.values()].map(({ helper }) => helper),
      ...this._spatialHandleRoots,
    ];
  }

  private _suspendPreviewInfrastructure(): () => void {
    const visibility = this._previewInfrastructure().map(
      (object) => [object, object.visible] as const,
    );
    for (const [object] of visibility) object.visible = false;
    return () => {
      for (const [object, visible] of visibility) object.visible = visible;
    };
  }

  private _allGizmos(): TransformControls[] {
    return [this.transformControls, this._auxRotateControls, this._auxScaleControls];
  }

  private _anyGizmoDragging(): boolean {
    return this._allGizmos().some((controls) => controls.dragging);
  }

  private _attachGizmosTo(obj: THREE.Object3D): void {
    this.transformControls.attach(obj);
    this._auxRotateControls.attach(obj);
    this._auxScaleControls.attach(obj);
  }

  private _detachGizmos(): void {
    for (const controls of this._allGizmos()) controls.detach();
  }

  /** Sync mode/space/snap from store. */
  syncFromStore(): void {
    // Ensure all gizmo children stay on EDITOR_LAYER (TransformControls rebuilds internally)
    this._gizmoHelper.traverse((child) => child.layers.set(EDITOR_LAYER));

    const mode = this._store.shell.transformMode;
    const combined = mode === 'combined';
    // `'select'` draws NO gizmo (Blender's Select Box — `TransformMode`'s own
    // note), so there is no handle family to put the primary controls in; it
    // keeps whatever it had and the attach block below detaches instead.
    const primaryMode = combined || mode === 'select' ? 'translate' : mode;
    if (this.transformControls.mode !== primaryMode) {
      this.transformControls.setMode(primaryMode);
    }
    this._applySnapToGizmos();
    for (const controls of this._allGizmos()) controls.setSpace(this._store.shell.transformSpace);

    // Spec 28 step 2 — visibility says a Three.js surface is painted;
    // selection ownership says it is the native world the user is editing.
    // The grid, view cube and transform gizmo require BOTH.
    // A pinned camera preview remains visible without a selection.
    // Empty/organizational/cross-world selections deliberately leave only
    // shell chrome rather than advertising an arbitrary coordinate system.
    const policy = viewportAuthoringPolicy();
    const authoring = this._authoring();
    const toolOwner = policy.toolOwner(authoring, this._store.shell.selectedEntityIds);
    this._threejsToolContextActive =
      (this._standaloneAuthoring || policy.toolOwnerPainted(this._store.shell, toolOwner)) &&
      toolOwner?.kind === 'three';

    // Grid visibility — the user's toggle, AND'd with a three stage showing at
    // all (selection or not: Blender's floor is persistent; the gizmos above
    // still need an owner).
    const threeSurface =
      this._standaloneAuthoring || policy.threeSurfaceShowing(this._store.shell, authoring);
    this._threeSurfaceShowing = threeSurface;
    this.grid.visible = this._presentationGrid && threeSurface;
    if (this._axisLines) this._axisLines.visible = this.grid.visible && this._axesWanted;

    // The two passes below (apply gizmos + per-type helper/icon visibility) are
    // idempotent and O(total scene nodes). Their only inputs are the objectMap
    // membership and the visibility toggles — none of which change during a
    // transform drag/scrub (which still fires syncFromStore every frame). Gate
    // them on a cheap signature so a drag doesn't re-walk the whole graph 60×/s.
    const vis = this._store.shell.helperVisibility;
    // World-hidden eye (D9) folded into the SAME cheap signature/gate as the
    // gizmo/helper passes below — see `world-hidden-viewport.ts`'s doc
    // comment for why this must be recomputed from scratch on every rebuild
    // (never a one-shot flip) and why folding it in here (rather than a
    // separate always-on pass) is safe: the toggle itself
    // (`GameHierarchy.tsx`'s `toggleRootHidden` + `store.notifyIngestEdit()`)
    // changes `hiddenRootId`'s hidden state, which changes this signature,
    // so it re-applies on the very next `syncFromStore()` call — exactly the
    // same notify path that already re-triggers this whole method.
    const hiddenRootId = this._standaloneAuthoring ? null : policy.threeViewportRootId(this._store.shell);
    const hidden = hiddenRootId !== null && isRootHidden(hiddenRootId);
    // While hidden, re-apply on EVERY notify, not just signature changes: a
    // SINGLE-entity rebuild (scene-sync `updateEntityPreview`) mutates the
    // existing objectMap in place — same instance, same size, so the gate
    // below never re-fires — while re-stamping the rebuilt object visible
    // from its descriptor. Cost is one map walk per notify only while a
    // world is actually hidden; the gated call below still handles the
    // hide→show transition (restoring per-entity visibility).
    if (hidden) policy.applyRootHiddenVisibility(this._objectMap, hiddenRootId);
    // Scene-LEVEL environment (background/skybox/fog/IBL). Nothing here has to
    // RESTORE it on the show edge — an adapter-backed world paints its own
    // environment. Suppression on the hide edge still runs on EVERY notify,
    // same rationale as the per-notify `applyRootHiddenVisibility` above.
    if (hidden) policy.suppressRootEnvironment(this._scene);
    const gizmoEpoch = this._store.gizmoEpoch;
    const gizmoSig = `${this._store.shell.showHelpers}|${JSON.stringify(vis)}|${hiddenRootId ?? ''}|${hidden}|${this._threejsToolContextActive}`;
    const mapChanged = this._objectMap !== this._lastGizmoObjectMap;
    const settingsChanged = gizmoSig !== this._lastGizmoSig;
    const membershipChanges = mapChanged
      ? null
      : this._store.ingestObjectMapMembershipChangesSince(this._lastGizmoEpoch);
    const changedIds =
      mapChanged || settingsChanged || membershipChanges === null
        ? null
        : membershipChanges.changedIds;
    const reconcileMembership = changedIds === null || changedIds.size > 0;
    this._lastGizmoObjectMap = this._objectMap;
    this._lastGizmoSig = gizmoSig;
    this._lastGizmoEpoch = gizmoEpoch;
    if (reconcileMembership) {
      // Threejs roots have no DOM layer to `display:none` (unlike react/pixi
      // — `design-time-layers.ts`'s `applySessionStyle`), so this is what
      // actually makes a hidden three world's group-row eye hide its
      // objects in THIS viewport. ABOVE the per-entity `visible` flag (ANDed
      // in, never overwritten) — see `world-hidden-viewport.ts`.
      policy.applyRootHiddenVisibility(this._objectMap, hiddenRootId);

      // Helper + icon visibility — per-type filtering
      const helperRoots =
        changedIds === null
          ? topmostPublishedObjects(this._objectMap)
          : topmostChangedObjects(this._objectMap, changedIds);
      for (const obj of helperRoots) {
        obj.traverse((child) => {
          if (getUserData(child, 'editorIcon')) {
            // Icon billboards follow the global helpers toggle
            child.visible = this._store.shell.showHelpers;
            return;
          }
          if (!getUserData(child, 'editorHelper')) return;
          const type = getUserData(child, 'editorHelperType') as string | undefined;
          if (type === 'skeletons') {
            child.visible =
              this._store.shell.showHelpers &&
              (vis.skeletons || Boolean(getUserData(child, 'skeletonEnabled')));
            return;
          }
          if (type && type in vis) {
            child.visible = this._store.shell.showHelpers && vis[type as keyof typeof vis];
          } else {
            child.visible = this._store.shell.showHelpers;
          }
        });
      }
      // Helper objects (`setHelper`) are scene-root objects, toggled here: a
      // kind the Helpers menu lists toggles on its own, any other follows the
      // master toggle.
      for (const [kind, helper] of this._helpers) {
        helper.visible =
          this._store.shell.showHelpers && (!(kind in vis) || (vis as Record<string, boolean>)[kind]!);
      }
      this._syncCameraHelpers(changedIds);
      this._syncLightHelpers(changedIds);
    }

    this._syncAudioHelpers(changedIds);
    this._syncReflectionProbeHelpers(changedIds);
    this._syncTriggerVolumeHelpers(changedIds);
    this._syncConstraintHelpers(changedIds);

    // Attach gizmo based on pivot mode. Spec 28: no gizmo without a visible
    // three surface — this whole block re-derives per notify, so detaching
    // here is self-healing (the un-hide notify re-attaches to the same
    // selection with no extra bookkeeping).
    // `'select'` is a tool with no gizmo (Blender's Select Box), so it answers
    // "no subject" here and takes the same detach branch a non-writable
    // selection takes — one detach path, not a second one beside it.
    const selectedId =
      this._threejsToolContextActive && authoring.capabilities.transform && mode !== 'select'
        ? this._store.shell.selectedEntityId
        : null;
    // Combined mode filters/attaches on POSITION (its median-filter channel)
    // and attaches when ANY channel is writable — a scale-locked prefab
    // instance still gets move+rotate handles instead of no gizmo at all
    // (which is also exactly what single-scale mode used to show a tester:
    // an empty viewport with no visible refusal).
    const activeTransformChannel =
      mode === 'translate' || mode === 'combined'
        ? 'position'
        : mode === 'rotate'
          ? 'rotation'
          : 'scale';
    const anyChannelWritable = (id: string): boolean =>
      (['position', 'rotation', 'scale'] as const).some(
        (channel) => authoring.transforms?.editability?.(id, channel).writable ?? true,
      );
    const selectedTransformWritable = selectedId
      ? mode === 'combined'
        ? anyChannelWritable(selectedId)
        : (authoring.transforms?.editability?.(selectedId, activeTransformChannel).writable ?? true)
      : false;
    if (selectedId && selectedTransformWritable) {
      if (!this._anyGizmoDragging()) {
        if (this._store.shell.pivotMode === 'median-point' && this._store.shell.selectedEntityIds.size > 1) {
          const median = new THREE.Vector3();
          let count = 0;
          for (const id of this._store.shell.selectedEntityIds) {
            if (
              !(authoring.transforms?.editability?.(id, activeTransformChannel).writable ?? true)
            ) {
              continue;
            }
            const obj = this._objectForAuthoringId(id);
            if (obj) {
              // WORLD position, from `matrixWorld` — the pivot dummy lives at
              // the scene root, so a median of LOCAL positions was already
              // wrong for any nested node, and it is wrong a second way for a
              // node whose driver owns its matrix (`authoring/
              // live-object-transform.ts`: `.position` is frozen at spawn while
              // the object renders wherever its matrix puts it).
              median.add(obj.getWorldPosition(_medianTmp));
              count++;
            }
          }
          if (count > 0) median.divideScalar(count);
          this._pivotDummy.position.copy(median);
          this._pivotDummy.quaternion.identity();
          this._pivotDummy.scale.set(1, 1, 1);
          this._attachedAuthoringId = null;
          this._dummyIsPresentationAnchor = false;
          this._attachGizmosTo(this._pivotDummy);
        } else {
          // Check for per-entity pivot
          const obj = this._objectForAuthoringId(selectedId);
          const entityPivot = getUserData(obj, 'pivot') as [number, number, number] | undefined;
          const hasPivot =
            entityPivot && (entityPivot[0] !== 0 || entityPivot[1] !== 0 || entityPivot[2] !== 0);
          const centreAnchor = hasPivot ? null : this._centreAnchorFor(obj);

          if (centreAnchor && obj) {
            // CENTRE anchor: the gizmo is drawn on the content, and every other
            // term still comes from the object, so a local-space drag rotates
            // about the object's own axes exactly as it does at the pivot.
            this._pivotDummy.position.copy(centreAnchor);
            this._pivotDummy.quaternion.copy(obj.getWorldQuaternion(_pivotQuat));
            this._pivotDummy.scale.copy(obj.getWorldScale(_pivotScale));
            this._attachedAuthoringId = selectedId;
            this._dummyIsPresentationAnchor = true;
            this._attachGizmosTo(this._pivotDummy);
          } else if (hasPivot && obj) {
            // Position dummy at pivot's world location. Every term comes from
            // `matrixWorld` (three's `getWorld*` decompose it), never from the
            // vector fields: a node whose driver owns its matrix keeps
            // `.position`/`.quaternion` frozen at spawn, so anchoring on those
            // put the gizmo where the object USED to be while its bounds drew
            // where it is (`authoring/live-object-transform.ts`).
            const pivotLocal = new THREE.Vector3(entityPivot[0], entityPivot[1], entityPivot[2]);
            pivotLocal.applyQuaternion(obj.getWorldQuaternion(_pivotQuat));
            this._pivotDummy.position.copy(obj.getWorldPosition(_pivotPos)).add(pivotLocal);
            this._pivotDummy.quaternion.copy(_pivotQuat);
            this._pivotDummy.scale.copy(obj.getWorldScale(_pivotScale));
            this._attachedAuthoringId = selectedId;
            this._dummyIsPresentationAnchor = false;
            this._attachGizmosTo(this._pivotDummy);
          } else {
            this._dummyIsPresentationAnchor = false;
            this.attach(selectedId);
          }
        }
      }
    } else {
      this.detach();
    }

    // Box helpers for all selected
    this._syncBoxHelpers();
    this._syncSpatialHandles();
    this._syncCombinedGizmoHalves();
  }

  /**
   * The combined gizmo's halves: shown only in combined mode, each half only
   * where its channel is WRITABLE for the attached entity — a prefab instance
   * with a locked scale (the starter's Hero Box) shows move+rotate and
   * honestly no scale handles, instead of a silently dead gizmo. Runs AFTER
   * the attach block: it reads the attachment this same pass just made.
   */
  /** Snap values reach the gizmos from the store's toggle OR a held
   *  Ctrl/⌘ (the Unity/Blender hold-to-snap convention) — three's controls
   *  read the snap on every pointer move, so a mid-drag hold takes effect. */
  private _applySnapToGizmos(): void {
    const snap = this._store.shell.snapEnabled || this._snapHold;
    const vals = this._store.shell.snapValues;
    for (const controls of this._allGizmos()) {
      controls.setTranslationSnap(snap ? vals.translate : null);
      controls.setRotationSnap(snap ? THREE.MathUtils.degToRad(vals.rotate) : null);
      controls.setScaleSnap(snap ? vals.scale : null);
    }
  }

  /** A Ctrl/Cmd+middle drag under a keymap that orbits on the middle button zooms, as
   *  Blender's does (`km_view3d`: `view3d.zoom` on Ctrl+MIDDLEMOUSE); OrbitControls would read
   *  the modifier as pan. The middle button dollies for that one gesture. */
  private _modifiedZoom = false;

  private readonly _onAltOrbitStart = (e: PointerEvent): void => {
    if (e.button === 1 && (e.ctrlKey || e.metaKey) && activeKeymapNavigation().orbit === 'middle') {
      this._modifiedZoom = true;
      this.orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    }
    if (e.altKey && e.button === 0) {
      this._altDragOrbit = true;
      this.orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
  };

  private readonly _onAltOrbitRelease = (event?: PointerEvent): void => {
    // The zoom is the middle button's gesture, and ends with that button's release.
    if (this._modifiedZoom && (!event || event.type === 'pointercancel' || event.button === 1)) {
      this._modifiedZoom = false;
      this.applyKeymapNavigation();
    }
    if (this._altDragOrbit) {
      this._altDragOrbit = false;
      this.orbitControls.mouseButtons.LEFT = -1 as THREE.MOUSE;
    }
  };

  private readonly _onSnapHoldKey = (e: KeyboardEvent): void => {
    // Modifier flags describe the state AFTER this event, so one read serves keydown and keyup.
    const hold = e.ctrlKey || e.metaKey;
    if (hold === this._snapHold) return;
    this._snapHold = hold;
    this._applySnapToGizmos();
    // Stepping reads as "slower/laggier" to someone who doesn't know it is
    // snapping (human pass 10 said exactly that) — name it while it happens.
    if (hold && this._anyGizmoDragging() && !this._store.shell.snapEnabled) {
      const { translate, rotate, scale } = this._store.shell.snapValues;
      showTransientHint(`Snapping while held: ${translate} units · ${rotate}° · ×${scale}`);
    }
  };

  private _syncCombinedGizmoHalves(): void {
    if (this._anyGizmoDragging()) return;
    const combined = this._store.shell.transformMode === 'combined';
    const attachedId = this._attachedAuthoringId;
    const editability = this._authoring().transforms?.editability;
    const writable = (channel: 'rotation' | 'scale'): boolean =>
      attachedId === null || (editability?.(attachedId, channel).writable ?? true);
    const rotateOn =
      combined && this._auxRotateControls.object !== undefined && writable('rotation');
    const scaleOn =
      combined &&
      this._transformHandles.scale &&
      this._auxScaleControls.object !== undefined &&
      writable('scale');
    this._auxRotateControls.enabled = rotateOn;
    this._auxScaleControls.enabled = scaleOn;
    const rotateHelper = this._auxRotateControls.getHelper();
    const scaleHelper = this._auxScaleControls.getHelper();
    rotateHelper.visible = rotateOn;
    scaleHelper.visible = scaleOn;
    for (const helper of [rotateHelper, scaleHelper]) {
      helper.traverse((child) => child.layers.set(EDITOR_LAYER));
    }
    this.transformControls.enabled = true;
  }

  /**
   * Re-add editor infrastructure objects to the scene after play mode
   * has cleared all scene children. Call this after loadDocument restores
   * entities so the grid, lights, gizmos, and particle renderer are present.
   */
  /** Move all editor gizmos from the editor scene into a target scene (e.g. the live game scene). */
  moveGizmosTo(target: THREE.Scene): void {
    const objs = this._gizmoObjects();
    for (const obj of objs) target.add(obj);
  }

  /** Move all editor gizmos back to the editor scene. */
  restoreGizmos(): void {
    const objs = this._gizmoObjects();
    for (const obj of objs) this._scene.add(obj);
  }

  /** All editor-layer objects that should travel with the gizmos. */
  private _gizmoObjects(): THREE.Object3D[] {
    return [
      this.grid,
      ...(this._axisLines ? [this._axisLines] : []),
      this._editorAmbient,
      this._editorDirLight,
      this.batchedRenderer,
      this._gizmoHelper,
      this._auxRotateControls.getHelper(),
      this._auxScaleControls.getHelper(),
      this._pivotDummy,
      this._surfaceSnapIndicator,
      ...[...this._cameraHelpers.values()].map(({ helper }) => helper),
      ...this._spatialHandleRoots,
    ];
  }

  /**
   * The active scene's content AABB, re-measured at most every
   * {@link CONTENT_BOUNDS_MAX_AGE_MS}.
   *
   * A live game keeps building itself long after the editor adopts it (a
   * level-streaming game parses its whole world in seconds after first
   * capture), so this cannot be a one-shot measurement at scene swap —
   * but neither can it run per frame over thousands of nodes. Cheap readers
   * (the per-frame clip planes) take the cache; {@link focusOnScene} forces a
   * fresh measurement, because framing on a stale box is exactly the miss it
   * exists to prevent.
   */
  private _contentBounds(force = false): THREE.Box3 {
    const now = performance.now();
    const stale =
      this._contentBoundsAt === 0 || now - this._contentBoundsAt > CONTENT_BOUNDS_MAX_AGE_MS;
    if (force || stale) {
      this._contentBoundsBox.makeEmpty();
      for (const child of this._scene.children) {
        if (isInEditorOwnedSubtree(child)) continue;
        expandBoxByContent(this._contentBoundsBox, child);
      }
      this._contentBoundsAt = now;
    }
    return this._contentBoundsBox;
  }

  /**
   * One fresh measurement serving both bounds questions: the per-node boxes
   * {@link focusOnScene} frames from, and — as their union, cached exactly as
   * {@link _contentBounds} would have — the full extent the clip planes reach.
   * Framing and clipping disagree deliberately (a backdrop is trimmed out of
   * the framing and still has to draw), and they must not disagree about WHEN
   * they were measured, so this is one walk.
   */
  private _measureContentBounds(): THREE.Box3[] {
    const boxes: THREE.Box3[] = [];
    for (const child of this._scene.children) {
      if (isInEditorOwnedSubtree(child)) continue;
      collectContentNodeBoxes(child, boxes);
    }
    this._contentBoundsBox.makeEmpty();
    for (const box of boxes) this._contentBoundsBox.union(box);
    this._contentBoundsAt = performance.now();
    return boxes;
  }

  /**
   * Grow the camera's clip planes to reach the content, every frame.
   *
   * See `viewport-clip-planes.ts` for the measured defect this closes: a world
   * larger than the frozen `far = 1000` was clipped away to an empty viewport.
   * Cheap — the bounds are cached, so a frame costs one distance and, only when
   * the planes actually move, one `updateProjectionMatrix`.
   */
  private _updateClipPlanes(): void {
    const box = this._contentBounds();
    let distance = 0;
    let radius = 0;
    if (!box.isEmpty()) {
      box.getBoundingSphere(_clipSphere);
      distance = this.freeCamera.position.distanceTo(_clipSphere.center);
      radius = _clipSphere.radius;
    }
    const { near, far } = fitClipPlanes(distance, radius);
    if (near === this.camera.near && far === this.camera.far) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.orthographicCamera.near = near;
    this.orthographicCamera.far = far;
    this.orthographicCamera.updateProjectionMatrix();
  }

  /**
   * Adopt an ingested game's OWN camera as the editor view — the first answer
   * `scene-framing.ts` gives, and the only one that is not a guess: the game's
   * author already decided the interesting view.
   *
   * Returns false — camera untouched — when that view cannot be used: the
   * world is behind it, on it, or PRESSED AGAINST IT (a camera placed inside
   * the geometry it is about to drive through is a fine gameplay camera and a
   * useless first look — `seededViewShowsWorld` is the measurement, and the
   * caller falls back to the framing, which always shows something).
   *
   * A caller inside the auto-frame window can simply ask again: a game builds
   * itself asynchronously, and Cuberun's own `<PerspectiveCamera makeDefault>`
   * is not in the scene at all on the frame the editor captures it (its
   * `<Suspense>` content has not resolved), so a seed attempted only at mount
   * misses the flagship case.
   */
  seedFromGameCamera(gameCamera: THREE.Camera): boolean {
    const box = frameableContentBounds(this._measureContentBounds());
    const seeded = viewFromGameCamera(gameCamera, box);
    if (!seeded) return false;
    // Tested on the EDITOR camera at the seeded pose, not on the game's own:
    // the frustum that decides what the reader sees is this one's (its fov and
    // the viewport's aspect), and the game camera's may be nothing like it.
    const previousPosition = this.camera.position.clone();
    const previousTarget = this.orbitControls.target.clone();
    this.camera.position.copy(seeded.position);
    this.orbitControls.target.copy(seeded.target);
    this.camera.lookAt(this.orbitControls.target);
    this.camera.updateMatrixWorld(true);
    const content = this._scene.children.filter((child) => !isInEditorOwnedSubtree(child));
    if (!seededViewShowsWorld(this.camera, content, seeded.position.distanceTo(seeded.target))) {
      this.camera.position.copy(previousPosition);
      this.orbitControls.target.copy(previousTarget);
      this.camera.lookAt(this.orbitControls.target);
      this.camera.updateMatrixWorld(true);
      return false;
    }
    this._updateClipPlanes();
    this.orbitControls.update();
    return true;
  }

  /**
   * Frame the whole scene's content. Returns false — leaving the camera
   * untouched — when there is nothing to frame yet, so a caller waiting on an
   * asynchronously-built world can simply ask again.
   *
   * What gets framed is the content worth framing, not the content AABB: see
   * `scene-framing.ts` for the backdrop that made those two different.
   */
  focusOnScene(): boolean {
    // Fresh, and one walk for both questions: the trimmed box is what the
    // camera fits, and the full union it is measured from is what the clip
    // planes must still reach (a trimmed-away skybox still has to draw).
    const box = frameableContentBounds(this._measureContentBounds());
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize();
    const distance = perspectiveDistanceToFitBox(box, this.camera, dir);
    if (!Number.isFinite(distance)) return false;
    this.camera.position.copy(center).add(dir.multiplyScalar(distance));
    this.orbitControls.target.copy(center);
    this._orthographicHeight =
      Math.max(
        box.getSize(new THREE.Vector3()).y,
        box.getSize(new THREE.Vector3()).x / this._viewportAspect,
      ) * 1.15;
    this._syncOrthographicFromPerspective(true);
    // Before any draw: the framing distance for a world-sized scene is exactly
    // what used to land past the far plane.
    this._updateClipPlanes();
    return true;
  }

  /** Focus camera on a given object. */
  focusOn(obj: THREE.Object3D): void {
    const box = this._contentOrProbeBounds(obj);
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize();
    const distance = perspectiveDistanceToFitBox(box, this.camera, dir);
    this.camera.position.copy(center).add(dir.multiplyScalar(distance));
    this.orbitControls.target.copy(center);
    const size = box.getSize(new THREE.Vector3());
    this._orthographicHeight = Math.max(size.y, size.x / this._viewportAspect, 0.01) * 1.15;
    this._syncOrthographicFromPerspective(true);
  }

  /** Activate vertex snap: collect target vertices from non-selected entities. */
  activateVertexSnap(): void {
    this._vertexSnapTargets = this._collectVertices(this._store.shell.selectedEntityIds);
  }

  /** Deactivate vertex snap: clear collected vertices and hide indicator. */
  deactivateVertexSnap(): void {
    this._vertexSnapTargets = [];
    this._vertexSnapIndicator.visible = false;
  }

  /** Focus camera on multiple objects. */
  focusOnMultiple(objects: THREE.Object3D[]): void {
    if (objects.length === 0) return;
    if (objects.length === 1) {
      this.focusOn(objects[0]!);
      return;
    }
    const box = new THREE.Box3();
    for (const obj of objects) box.union(this._contentOrProbeBounds(obj));
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize();
    const distance = perspectiveDistanceToFitBox(box, this.camera, dir);
    this.camera.position.copy(center).add(dir.multiplyScalar(distance));
    this.orbitControls.target.copy(center);
    const size = box.getSize(new THREE.Vector3());
    this._orthographicHeight = Math.max(size.y, size.x / this._viewportAspect, 0.01) * 1.15;
    this._syncOrthographicFromPerspective(true);
  }

  /**
   * WHERE to draw the gizmo for this single selection: the content's world
   * centre, or `null` to leave it on the object's own pivot.
   *
   * The DCC affordance (`EditorShellStore.gizmoAnchor`), and PRESENTATION ONLY —
   * `_dummyIsPresentationAnchor` is what keeps the drag writing the same source
   * values a pivot-anchored drag would.
   *
   * `auto`, the default, resolves per SUBJECT: an ordinary node's pivot is
   * already inside its content, so it stays put and nothing changes; a
   * world-anchored instanced system's pivot is at (0,0,0) with every unit the
   * reader can see somewhere else (`instanced-presentation.ts`), so that one
   * moves. Either explicit value overrides the derivation in its own direction.
   */
  private _centreAnchorFor(object: THREE.Object3D | null): THREE.Vector3 | null {
    const preference = this._store.shell.gizmoAnchor;
    if (!object || preference === 'pivot') return null;
    // The cheap half of the `auto` question FIRST: this runs on every notify,
    // and nearly every selection is a node that is not an instanced draw at
    // all — which must not pay for a bounds walk to find that out.
    if (preference === 'auto' && instancedUnitCount(object) === 0) return null;
    const bounds = contentWorldBounds(object);
    if (bounds.isEmpty()) return null;
    if (preference === 'auto' && !describeInstancedPresentation(object, bounds)?.worldAnchored) {
      return null;
    }
    const centre = bounds.getCenter(new THREE.Vector3());
    // Nothing to relocate when the pivot is already where the content is —
    // attaching the dummy there would only add an indirection with no visible
    // difference, and cost the ordinary drag its direct object binding.
    object.updateWorldMatrix(true, false);
    return centre.distanceToSquared(object.getWorldPosition(_pivotPos)) < CENTRE_ANCHOR_EPSILON_SQ
      ? null
      : centre;
  }

  /** Empty probe transforms still own a spatial volume worth framing. */
  private _contentOrProbeBounds(object: THREE.Object3D): THREE.Box3 {
    const probe = reflectionProbeOf(object);
    if (!probe) return contentWorldBounds(object);
    const config = probe.config;
    const [sizeX, sizeY, sizeZ] = config.size;
    const extent =
      config.shape === 'sphere'
        ? new THREE.Vector3(1, 1, 1).multiplyScalar(Math.max(0.01, config.radius))
        : new THREE.Vector3(
            Math.max(0.01, sizeX),
            Math.max(0.01, sizeY),
            Math.max(0.01, sizeZ),
          ).multiplyScalar(0.5);
    object.updateWorldMatrix(true, false);
    return new THREE.Box3(extent.clone().negate(), extent).applyMatrix4(object.matrixWorld);
  }

  /**
   * Show (or clear with null) the editor-only helper of `kind` —
   * `setViewportHelper`'s implementation. The object joins the editor
   * scene as a scene-root helper (`editorHelper`, `editorHelperType = kind`)
   * and follows the Helpers menu's toggle for its kind.
   */
  setHelper(kind: string, object: THREE.Object3D | null): void {
    invalidateStages();
    const previous = this._helpers.get(kind);
    if (previous) {
      this._scene.remove(previous);
      this._helpers.delete(kind);
    }
    if (!object) return;
    setUserData(object, 'editorHelper', true);
    setUserData(object, 'editorHelperType', kind);
    const vis = this._store.shell.helperVisibility;
    object.visible =
      this._store.shell.showHelpers && (!(kind in vis) || (vis as Record<string, boolean>)[kind]!);
    this._scene.add(object);
    this._helpers.set(kind, object);
  }

  /** The helper groups on screen now (`setHelper`), for a pick that lets a helper stand for the
   *  object it draws (`userData.vgaiPicksAs`). */
  visibleHelpers(): THREE.Object3D[] {
    return [...this._helpers.values()].filter((helper) => helper.visible && helper.parent !== null);
  }

  /** Snap camera to a preset view direction, preserving current zoom distance. */
  setViewPreset(preset: 'top' | 'front' | 'right' | 'bottom' | 'back' | 'left' | 'perspective'): void {
    if (this._projection === 'orthographic') this.setProjection('perspective');
    const target = this.orbitControls.target.clone();
    const distance = this.camera.position.distanceTo(target);

    const dir = new THREE.Vector3();
    switch (preset) {
      case 'top':
        dir.set(0, 1, 0);
        break;
      case 'front':
        dir.set(0, 0, 1);
        break;
      case 'right':
        dir.set(1, 0, 0);
        break;
      case 'bottom':
        dir.set(0, -1, 0);
        break;
      case 'back':
        dir.set(0, 0, -1);
        break;
      case 'left':
        dir.set(-1, 0, 0);
        break;
      case 'perspective':
        dir.set(1, 1, 1).normalize();
        break;
    }

    this.camera.position.copy(target).add(dir.multiplyScalar(distance));
    // A preset has no roll; Top's screen up is the world's -Z and Bottom's +Z, as the session's.
    if (preset === 'top') this.camera.up.set(0, 0, -1);
    else if (preset === 'bottom') this.camera.up.set(0, 0, 1);
    else this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (preset !== 'perspective') this.setProjection('orthographic');
    this.orbitControls.update();
  }

  /** The view's lens in mm over the 36 mm sensor (`View3D.lens`): the perspective angle and, at
   *  the same distance, the orthographic view's size. */
  setLens(lens: number): void {
    if (!Number.isFinite(lens) || lens <= 0 || lens === this._lens) return;
    const halfAngle = (fov: number) => Math.tan(THREE.MathUtils.degToRad(fov * 0.5));
    const before = halfAngle(this.camera.fov);
    this._lens = lens;
    this.camera.fov = stageVerticalFovDegrees(this._viewportAspect, lens);
    this.camera.updateProjectionMatrix();
    // An orthographic view at the same distance scales with the lens, as Blender's does.
    if (this._projection === 'orthographic') this._orthographicHeight *= halfAngle(this.camera.fov) / before;
    this._applyOrthographicFrustum();
  }

  /**
   * Move the camera to an arbitrary position/target/fov pose — the general
   * case `setViewPreset`/`focusOn` don't cover (an exact xyz position, not a
   * preset direction or a computed frame-to-fit). Backs the `set-camera`
   * relay command (`editor.viewport.camera.set`'s free-pose mode). `up` is the screen's up; a
   * pose that states none is level, whatever roll the view had.
   */
  setPose(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov?: number,
    up?: { x: number; y: number; z: number },
  ): void {
    this.setProjection('perspective');
    if (up) this.camera.up.set(up.x, up.y, up.z);
    else this.camera.up.set(0, 1, 0);
    this.camera.position.set(position.x, position.y, position.z);
    this.orbitControls.target.set(target.x, target.y, target.z);
    this.camera.lookAt(this.orbitControls.target);
    if (fov !== undefined) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.orbitControls.update();
  }

  /** Handle resize. */
  resize(width: number, height: number): void {
    this._viewportAspect = Math.max(1, width) / Math.max(1, height);
    this.camera.aspect = this._viewportAspect;
    // Blender holds the LENS, not the vertical angle: a wider panel sees no
    // more world sideways, a shorter one sees less vertically.
    this.camera.fov = stageVerticalFovDegrees(this._viewportAspect, this._lens);
    this.camera.updateProjectionMatrix();
    this._applyOrthographicFrustum();
    // A look-stated gizmo size is in PIXELS, so the conversion to three's
    // viewport-relative `size` moves with the viewport's height.
    this._applyGizmoSize();
    // Selection brackets need no resize handling: fat lines size their stroke
    // in screen space, and three's own `LineSegments2.onBeforeRender` pushes
    // the live renderer viewport into `LineMaterial`'s resolution uniform on
    // every draw. Nothing here should shadow that with a second source.
  }

  update(dt = 0): void {
    this._ensureSparkRenderer();
    this._syncLookBackground();
    // A remount can prune the attached object while the gizmos still hold it;
    // three then errors EVERY FRAME ("must be a part of the scene graph" —
    // human pass 10 recorded seven while authoring). Detach the moment the
    // attachment goes stale; the store-driven sync re-attaches when the
    // selection re-resolves onto the fresh object.
    const attachedObject = this.transformControls.object;
    if (attachedObject && attachedObject !== this._pivotDummy && !attachedObject.parent) {
      this._detachGizmos();
      this.syncFromStore();
    }
    // Animate custom (shader) materials in edit mode — same tick the runtime
    // preRender phase runs, so authored shaders preview live in the viewport.

    // Fly camera movement (before orbit so it takes priority)
    this._updateFlyCamera(dt);

    this.orbitControls.update();

    // Snap-to-view animation (runs after orbit update so we have final say on position)
    if (this._snapAnimating) {
      const elapsed = performance.now() - this._snapStartTime;
      let t = Math.min(elapsed / this._snapDuration, 1);
      // easeInOutCubic
      t = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

      const qt = new THREE.Quaternion().slerpQuaternions(this._snapQ1, this._snapQ2, t);
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(qt);
      this.freeCamera.position
        .copy(this.orbitControls.target)
        .add(dir.multiplyScalar(this._snapDist));
      // The whole orientation turns, roll with it; the orbit's next re-aim keeps it on `up`.
      this.freeCamera.quaternion.copy(qt);
      this.freeCamera.up.set(0, 1, 0).applyQuaternion(qt);

      if (t >= 1) this._snapAnimating = false;
    }

    if (this._presentation) {
      this._presentation.rig.resolveSource({ light: this._store.isAdoptedSceneActive });
      this._presentation.rig.update(this.camera);
    }
    for (const helper of this._boxHelpers.values()) {
      const wireOf = (helper as WireHelper)._wireOf;
      if (wireOf) {
        helper.matrix.copy(wireOf.matrixWorld);
        helper.matrixWorldNeedsUpdate = true;
        continue;
      }
      if (helper instanceof SelectionBrackets) {
        // Static terrain/building selections keep their already-computed AABB.
        // Root motion and vertex-animated selections still refresh here.
        helper.updateIfNeeded();
        continue;
      }
      const tagged = helper as TaggedHelper;
      if (tagged._entityObj) {
        // Fixed-size wireframe cube — follow the entity's world position
        tagged._entityObj.getWorldPosition(helper.position);
      } else if (helper instanceof ContentBoundsHelper) {
        helper.update();
      }
    }
    for (const helper of this._constraintHelpers.values()) helper.update(this.camera);
    for (const helper of this._reflectionProbeHelpers.values()) helper.update();
    for (const helper of this._triggerVolumeHelpers.values()) helper.update();
    for (const { helper } of this._cameraHelpers.values()) helper.update();
    for (const handle of this._spatialHandleMeshes) scaleSpatialHandle(handle, this._screenCamera);

    this._enforceLodForcedLevels();
    this.alignGridToView(this.renderCamera, this._renderer?.domElement.width ?? 1);
    // Last, so it reads the camera pose this frame will actually draw with.
    this._updateClipPlanes();
  }

  /**
   * W2b: enforce the editor-only forced-LOD-level preview every frame. The
   * THREE.LOD instance is replaced by entity rebuilds and doesn't even exist
   * until the glTF's async load resolves, so a one-shot apply at dropdown
   * time would silently un-pin — per-frame enforcement over a map that is
   * almost always empty is the robust (and cheap) form. 'Auto' removes the
   * map entry and restores `autoUpdate` (see EditorShellStore.setLodForcedLevel),
   * handing selection back to the renderer's own `LOD.update(camera)`.
   *
   * That last sentence is load-bearing and easy to disbelieve, because nothing
   * in this repo calls `LOD.update`: THREE does it itself. `WebGLRenderer`'s
   * `projectObject` runs `if (object.isLOD) { if (object.autoUpdate === true)
   * object.update(camera); }` for every visible LOD, every render. `autoUpdate`
   * is the ONE switch this whole feature turns, and pinning works by turning it
   * off. Do not add an engine-side per-frame LOD tick to "fix" the missing
   * call — it would duplicate the renderer's own work and fight the pin.
   */
  private _enforceLodForcedLevels(): void {
    const projectedObjects = new Set(this._objectMap.values());
    for (const [id, level] of this._store.lodForcedLevels) {
      const obj = this._objectMap.get(id);
      const lodObj = obj ? findEntityLod(obj, (node) => projectedObjects.has(node)) : null;
      if (!lodObj || lodObj.levels.length === 0) continue;
      lodObj.autoUpdate = false;
      const idx = Math.min(Math.max(level, 0), lodObj.levels.length - 1);
      for (let i = 0; i < lodObj.levels.length; i++) {
        lodObj.levels[i]!.object.visible = i === idx;
      }
    }
  }

  /**
   * Attach renderer-bound scene infrastructure only for this viewport's draw.
   * A live play scene can be observed by the game canvas and editor canvas at
   * once; persisting either canvas's SparkRenderer in that shared scene makes
   * the other WebGL context draw foreign integer textures.
   */
  renderWithInfrastructure(draw: () => void): void {
    const spark = this._sparkRenderer;
    const restoreCameraView = this._cameraView ? this._suspendPreviewInfrastructure() : null;
    if (spark) this._scene.add(spark);
    try {
      draw();
    } finally {
      spark?.removeFromParent();
      restoreCameraView?.();
    }
  }

  /** Render the standard orientation gizmo in the viewport's top-right corner. */
  renderViewCube(renderer: THREE.WebGLRenderer): void {
    if (!this._threeSurfaceShowing) return; // no three stage, no compass (Blender's is persistent on one)
    if (this._navigation === 'hidden') return;
    if (this._cameraView) return; // exact camera view owns the viewport
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const size = this._vcSize;

    // Sync gizmo camera with main camera orientation (reuse scratch — runs every frame)
    const dir = this._vcDir
      .subVectors(this.freeCamera.position, this.orbitControls.target)
      .normalize();
    this._vcCamera.position.copy(dir.multiplyScalar(4));
    this._vcCamera.up.copy(this.freeCamera.up);
    this._vcCamera.lookAt(0, 0, 0);
    this._syncOrientationGizmoDepth();

    // GL viewport coords (origin bottom-left), inside the box a person can
    // SEE: a document stage's canvas bleeds past its panel, and the gizmo is
    // canvas-drawn, so it takes that bleed off both margins the way the DOM
    // furniture beside it already does (`chromeInsetPx`).
    const origin = this._vcOrigin(w, h, this._chromeInsetPx);
    const px = origin.left;
    const py = h - size - origin.top;

    // EffectComposer owns autoClear=false. Preserve that renderer state across
    // this late overlay: forcing it back to true erases pass-specific clears on
    // the following frame (notably OutlineEffect's white selection mask).
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setScissorTest(true);
      renderer.setViewport(px, py, size, size);
      renderer.setScissor(px, py, size, size);
      // Only clear depth so main scene shows through; disable autoClear so
      // renderer.render() doesn't wipe the color buffer.
      renderer.clear(false, true, false);
      renderer.autoClear = false;
      renderer.render(this._vcScene, this._vcCamera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
    }
  }

  /** Paint an authored camera into the DOM preview body's exact canvas rect.
   *  The surrounding label/actions are React chrome; this reuses the one
   *  renderer and WebGL context rather than mounting a second viewport. */
  renderCameraPreview(
    renderer: THREE.WebGLRenderer,
    entityCamera: THREE.Camera | null,
    previewElement: HTMLElement | null,
  ): void {
    if (!entityCamera || !previewElement || this._cameraView) return;

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const previewRect = previewElement.getBoundingClientRect();
    const px = Math.round(previewRect.left - canvasRect.left);
    const py = Math.round(canvasRect.bottom - previewRect.bottom);
    const pw = Math.max(1, Math.round(previewRect.width));
    const ph = Math.max(1, Math.round(previewRect.height));
    if (px >= w || py >= h || px + pw <= 0 || py + ph <= 0) return;

    const restoreInfrastructure = this._suspendPreviewInfrastructure();
    // Save renderer state: the preview is a late scissored draw over the main
    // frame and must leave the following frame's composer untouched.
    const prevClearColor = renderer.getClearColor(this._previewClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    try {
      renderer.setScissorTest(true);
      renderer.setViewport(px, py, pw, ph);
      renderer.setScissor(px, py, pw, ph);
      renderer.setClearColor(0x111214, 1);
      renderer.clear();
      renderer.render(this._scene, entityCamera);
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      restoreInfrastructure();
    }
  }

  /** True when the fly camera is active (right-click + movement key held). */
  get isFlying(): boolean {
    return this._flyActive;
  }

  private _inputDisconnected = false;

  /** Stop receiving input before an asynchronous source cleanup completes. */
  disconnectInput(): void {
    if (this._inputDisconnected) return;
    this._inputDisconnected = true;
    if (this._publishPickContext) setViewportPickContext(null);
    window.removeEventListener('keydown', this._onFlyKeyDown);
    window.removeEventListener('keyup', this._onFlyKeyUp);
    this._interactionElement.removeEventListener('pointerdown', this._onFlyPointerDown);
    this._canvas.removeEventListener('pointerdown', this._onAltOrbitStart, { capture: true });
    window.removeEventListener('pointerup', this._onAltOrbitRelease, { capture: true });
    window.removeEventListener('pointercancel', this._onAltOrbitRelease, { capture: true });
    window.removeEventListener('keydown', this._onSnapHoldKey);
    window.removeEventListener('keyup', this._onSnapHoldKey);
    this._interactionElement.removeEventListener('pointerup', this._onFlyPointerUp);
    this._interactionElement.removeEventListener('pointermove', this._onFlyPointerMove);
    this._interactionElement.removeEventListener('wheel', this._onFlyWheel);
    this._interactionElement.removeEventListener('wheel', this._onTrackpadWheel);
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._interactionElement.removeEventListener('pointermove', this._onPointerMove);
    if (this._onInteractionPointerUp) {
      this._interactionElement.removeEventListener('pointerup', this._onInteractionPointerUp);
    }
    if (this._onInteractionDblClick) {
      this._interactionElement.removeEventListener('dblclick', this._onInteractionDblClick);
    }
    this._canvas.removeEventListener('dragover', this._onDragOver);
    this._canvas.removeEventListener('dragleave', this._onDragLeave);
    this._canvas.removeEventListener('drop', this._onDrop);
    // Dispose controls now: deferred source cleanup must never disconnect
    // the reused element after the replacement controls have connected.
    this.orbitControls.dispose();
    for (const controls of this._allGizmos()) controls.dispose();
  }

  /**
   * Paint the palette's viewport group (`EditorTheme.color.viewport`): the grid
   * recoloured in place (its identity is held by the infrastructure lists), the
   * axis lines shown and coloured when named, and a flat background when
   * named — replacing only a background this viewport painted or none at all,
   * never a host's own (a document's declared colour, a world radiance).
   */
  private _applyViewportLook(look: NativeViewportLook): void {
    this._lookGridHex = look.grid ?? 0x999999;
    // THE FLOOR'S DEPTH IS DECLARED, and by the predicate that already says a
    // look paints the viewport at all. `color.viewport` is all-or-nothing
    // (`native-selection-style.ts`), so a palette either hands over the
    // stage's colours or keeps none of them: Classic Graphite declares no
    // group and keeps its floor without the grazing fade. Which axis lines
    // show is the view's (`overlays.axes`), whatever the look.
    const grazing = this.grid.material.uniforms['uGrazingFade'];
    if (grazing) grazing.value = look.background !== null ? 1 : 0;
    this._paintLookGrid();
    this._lookAxisHexes = [look.axisX, look.axisY, look.axisZ];
    if (this._axisLines) {
      (this._axisLines.material as LineMaterial).linewidth = this._axisLineCss(look.axisLineWidth);
    }
    if (this._verticalAxisLine) {
      (this._verticalAxisLine.material as LineMaterial).linewidth = this._axisLineCss(look.axisLineWidth);
    }
    this._axisLineWidth = look.axisLineWidth;
    this._rebuildAxisLines();
    if (look.background !== null) {
      const current = this._scene.background;
      const ours =
        current === null ||
        (current instanceof THREE.Color &&
          [this._lookBackgroundHex, look.background].includes(current.getHex()));
      this._lookBackgroundHex = look.background;
      if (ours) this._paintLookBackground();
    } else {
      this._lookBackgroundHex = null;
    }
  }

  /**
   * The floor's TWO levels, from the palette's one grid colour. The grid is
   * the ONE stage surface whose material is tone-mapped (see
   * {@link toneMappedSourceColor}), so both levels are handed to it as the
   * colours that MAP to the palette's.
   *
   * Blender draws both levels from ONE grid colour at two alphas. Measured in
   * `modeling-object-none.png` over its #3f3f3f background: the 1 m line
   * composites to lum 84 — exactly the palette's `#545454` — and the 10 m
   * line to 102, a 1.86x contrast. The palette names the MINOR's finished
   * appearance, so the major is that colour carried the rest of the way by
   * the measured ratio — and the ratio is applied in the FINISHED sRGB space
   * the 84 and the 102 were read in, before the inversion, because ACES is
   * not linear and extrapolating on its far side lands somewhere else.
   */
  /**
   * LIGHT AND DRESS THIS STAGE BY A VIEW'S PRESENTATION (`kit/viewport-presentation`): its studio
   * or preview lighting through a `StagePresentationRig` in this scene (in place of the
   * viewport's own ambient and directional), its selection marks and its grid's major step.
   * The stage's render pipeline keeps its tone mapping. The scene's own lighting is what an
   * ADOPTED live scene brings, so that is what the view's `auto` rule weighs as `light`.
   * Returns the unbind. A document stage hosted by `StageHost` binds there instead.
   */
  bindPresentation(viewId: string, stageKind: string): () => void {
    this._presentation?.stop();
    const rig = new StagePresentationRig(this._scene);
    const roots = rig.roots();
    this._editorObjects.push(...roots);
    bindViewPresentation(viewId, stageKind);
    const apply = () => {
      const presentation = viewPresentation(viewId);
      // This stage draws neither the view's environment nor its backdrop, so it builds no sky,
      // and it has no content bounds to stand a floor under.
      if (this._renderer) rig.apply(presentation, this._renderer, undefined, { tone: false, sky: false, floor: false });
      this.setStageFunction(presentation.world, presentation.interaction);
      this.setSelectionMarks(presentation.overlays.selection);
      this.setGridMajorEvery(presentation.overlays.grid.majorEvery);
      this.setAxisLines(presentation.overlays.axes);
      this.setNavigation(presentation.overlays.navigation);
      this.setGridVisible(presentation.overlays.grid.visible);
      invalidateStages();
    };
    const stopListening = subscribeViewportPresentation(apply);
    const binding = {
      rig,
      stop: () => {
        stopListening();
        rig.dispose();
        this._editorObjects = this._editorObjects.filter((object) => !roots.includes(object));
        if (this._presentation === binding) this._presentation = null;
        const rigOn = this._lightRig && !this._store.isAdoptedSceneActive;
        this._editorAmbient.visible = rigOn;
        this._editorDirLight.visible = rigOn;
      },
    };
    this._presentation = binding;
    this._editorAmbient.visible = false;
    this._editorDirLight.visible = false;
    apply();
    return binding.stop;
  }

  /** The view's selection marks; a change rebuilds the marks for the current selection. */
  setSelectionMarks(marks: { readonly outline: boolean; readonly wire: boolean; readonly box: boolean }): void {
    const current = this._selectionMarks;
    if (current.outline === marks.outline && current.wire === marks.wire && current.box === marks.box) return;
    this._selectionMarks = { outline: marks.outline, wire: marks.wire, box: marks.box };
    this._syncBoxHelpers();
  }

  /**
   * THE GRID'S PLANE FOLLOWS THE VIEW, as Blender's does (`overlay_grid.hh`, "Fixed plane
   * orthographic"): an orthographic view looking straight down an axis (Front, Right, Top and
   * their opposites) draws the grid in that view's own plane, behind the geometry
   * (`GRID_BEHIND_GEOMETRY`), where the floor would stand edge-on and fade to nothing; any other
   * view draws the floor. Moving the grid and the axis lines along an orthographic view's
   * direction changes their depth and nothing on screen, so "behind" is a push along it.
   * The axis lines keep their world directions: the one along the view is a point, and the
   * rest lie in the plane. Called with the camera each draw uses.
   */
  alignGridToView(camera: THREE.Camera, bufferWidth: number): void {
    const uniforms = this.grid.material.uniforms;
    const normal = uniforms['uPlaneNormal']!.value as THREE.Vector3;
    let axis = -1;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      camera.getWorldDirection(_gridView);
      const components = [Math.abs(_gridView.x), Math.abs(_gridView.y), Math.abs(_gridView.z)];
      axis = components.findIndex((value) => value > 1 - 1e-4);
      // An axis view is one at a quarter-turn of roll (`RV3D_VIEW_IS_AXIS`); any other roll is a
      // User view, which draws the floor.
      if (axis !== -1 && !isQuarterTurnUp(_gridEye.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(_gridQuat)))) axis = -1;
    }
    normal.set(axis === 0 ? 1 : 0, axis === -1 || axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    this.grid.quaternion.setFromUnitVectors(_gridUp, normal);
    this.grid.position.set(0, 0, 0);
    this.grid.scale.setScalar(1);
    const center = uniforms['uCenter']!.value as THREE.Vector2;
    center.set(0, 0);
    uniforms['uReach']!.value = 1;
    this._axisLines?.position.set(0, 0, 0);
    this._axisLines?.scale.setScalar(1);
    if (axis !== -1) {
      const ortho = camera as THREE.OrthographicCamera;
      camera.getWorldPosition(_gridEye);
      // The view's centre, in the plane: the grid is drawn around it (`grid_ubo_.offset`), with
      // its lines still anchored to the world, and reaches past the view's corners.
      const eye = _gridEye.clone().addScaledVector(normal, -_gridEye.dot(normal));
      center.set(axis === 1 ? eye.x : axis === 2 ? eye.x : eye.z, axis === 1 ? eye.z : eye.y);
      const halfDiagonal =
        Math.hypot(ortho.right - ortho.left, ortho.top - ortho.bottom) / (2 * ortho.zoom);
      const reach = Math.max(1, halfDiagonal / (this.grid.geometry.parameters.width * 0.5 * 0.55));
      uniforms['uReach']!.value = reach;
      this.grid.scale.setScalar(reach);
      // Just short of the far plane, along the view, then kept only along the plane's normal.
      _gridEye.addScaledVector(_gridView, ortho.far * 0.98);
      const behind = normal.clone().multiplyScalar(_gridEye.dot(normal));
      this.grid.position.copy(eye).add(behind);
      this._axisLines?.position.copy(behind);
      // The axes run through the origin, so they reach from there past the view's far corner.
      this._axisLines?.scale.setScalar(Math.max(1, (center.length() + halfDiagonal) / AXIS_HALF_LENGTH));
    }
    // THE LEVEL, transcribed from `overlay_grid.hh`: an axis-aligned orthographic view measures
    // `dist = 10 * 12 / (sizex * winmat[0][0])` — sixty device pixels of world — and draws the
    // power of ten below it as the minor line, faded by how far `dist` has climbed toward the
    // next power, under the next as the emphasised one. Blender's grid steps are metric powers
    // of ten, and the grid's own major step (`uMajorEvery`, 10) is that next power.
    let unit = 1;
    let minorFade = 1;
    if (axis !== -1) {
      const ortho = camera as THREE.OrthographicCamera;
      const worldWidth = (ortho.right - ortho.left) / ortho.zoom;
      const dist = (60 * worldWidth) / Math.max(bufferWidth, 1);
      unit = 10 ** Math.floor(Math.log10(dist));
      minorFade = 1 - (dist - unit) / (unit * 10 - unit);
    }
    uniforms['uUnit']!.value = unit;
    uniforms['uMinorFade']!.value = minorFade;
    uniforms['uAligned']!.value = axis === -1 ? 0 : 1;
    // Blender's axis lines in an aligned view are one pixel too (the same \`GRID_ALIGNED\` rule).
    const axisWidth = this._axisLineCss(axis === -1 ? this._axisLineWidth : 1);
    for (const line of [this._axisLines, this._verticalAxisLine]) {
      const material = line?.material as LineMaterial | undefined;
      if (material && material.linewidth !== axisWidth) material.linewidth = axisWidth;
    }
  }

  /** Minor cells per major line (`overlays.grid.majorEvery`; Blender 10, Godot 8). */
  setGridMajorEvery(every: number): void {
    const uniform = this.grid.material.uniforms['uMajorEvery'];
    if (uniform && Number.isFinite(every) && every >= 1) uniform.value = every;
  }

  /** The look's floor lines: widths in device pixels and the major level's contrast. */
  private _gridMajorContrast = 1;
  private _applyGridLines(lines: ReturnType<typeof nativeViewportGrid>): void {
    const uniforms = this.grid.material.uniforms;
    if (uniforms['uLineWidth']) uniforms['uLineWidth'].value = lines.lineWidth;
    if (uniforms['uMajorWidth']) uniforms['uMajorWidth'].value = lines.majorWidth;
    this._gridMajorContrast = lines.majorContrast;
    this._paintLookGrid();
  }

  private _paintLookGrid(): void {
    const hex = this._lookGridHex;
    if (hex === null) return;
    const backgroundHex = this._lookBackgroundHex ?? 0x3f3f3f;
    const channel = (shift: number) => {
      const line = (hex >> shift) & 0xff;
      const back = (backgroundHex >> shift) & 0xff;
      return Math.round(Math.min(255, Math.max(0, back + (line - back) * this._gridMajorContrast)));
    };
    const majorHex = (channel(16) << 16) | (channel(8) << 8) | channel(0);
    const minor = toneMappedSourceColor(hex, this._renderer);
    const major = toneMappedSourceColor(majorHex, this._renderer);
    (this.grid.material.uniforms['uColor']?.value as THREE.Color | undefined)?.copy(minor);
    (this.grid.material.uniforms['uMajorColor']?.value as THREE.Color | undefined)?.copy(major);
  }

  /**
   * THE WORLD'S AXIS LINES, rebuilt from the view's `overlays.axes`, the stage's axis frame and
   * the look's colours. `floor` is the two world axes three's X and Z carry; each shown world
   * axis is drawn along the three axis that carries it. The colours are RAW (`toneMapped: false`,
   * opaque): what is set is what the screen shows — Blender's X plateaus at `#cb293f` and Y at
   * `#69aa15` in `modeling-object-none.png`, which is what its palette names. An axis the look
   * gives no colour takes the gizmo's.
   */
  private _rebuildAxisLines(): void {
    const lines = this._axisLines;
    if (!lines) return;
    const frame = this._stageAxisFrame;
    const axes = this._stageAxes;
    const shown = [0, 1, 2].filter((threeAxis) => {
      const world = frame[threeAxis]![0];
      if (axes === 'floor') return threeAxis !== 1;
      return (['x', 'y', 'z'] as const).some((name, index) => index === world && axes[name]);
    });
    this._axesWanted = shown.length > 0;
    lines.visible = this.grid.visible && this._axesWanted;
    if (!this._axesWanted) return;
    // A FRESH GEOMETRY per rebuild: three caches an instanced geometry's instance count at
    // its first draw (`_maxInstanceCount`), so growing one from two lines to three drew only
    // the first two.
    const build = (threeAxes: readonly number[]): LineSegmentsGeometry => {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const threeAxis of threeAxes) {
        const world = frame[threeAxis]![0];
        const hex = this._lookAxisHexes[world];
        const color = hex === null || hex === undefined ? this._gizmoAxisColor(world) : new THREE.Color(hex);
        positions.push(...axisSegmentPositions(threeAxis));
        for (let i = 0; i < AXIS_SEGMENTS_PER_AXIS * 2; i++) colors.push(color.r, color.g, color.b);
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(positions);
      geometry.setColors(colors);
      return geometry;
    };
    // The floor's lines take the floor's grazing fade; the VERTICAL one stands out of the floor,
    // always grazes it from a level view and would fade away (Godot's Y line does not), so it is
    // its own child line without the fade — carried wherever the floor lines are.
    const floor = shown.filter((threeAxis) => threeAxis !== 1);
    const vertical = shown.includes(1);
    (lines.material as LineMaterial).visible = floor.length > 0;
    if (floor.length > 0) {
      lines.geometry.dispose();
      lines.geometry = build(floor);
    }
    if (vertical && !this._verticalAxisLine) {
      const floorMaterial = lines.material as LineMaterial;
      this._verticalAxisLine = new LineSegments2(
        build([1]),
        new LineMaterial({
          vertexColors: true,
          linewidth: floorMaterial.linewidth,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this._verticalAxisLine.layers.set(EDITOR_LAYER);
      lines.add(this._verticalAxisLine);
    } else if (vertical && this._verticalAxisLine) {
      this._verticalAxisLine.geometry.dispose();
      this._verticalAxisLine.geometry = build([1]);
    }
    if (this._verticalAxisLine) this._verticalAxisLine.visible = vertical;
  }

  /** The view's axis lines (`overlays.axes`). */
  setAxisLines(axes: ViewportOverlays['axes']): void {
    const same =
      axes === this._stageAxes ||
      (typeof axes === 'object' &&
        typeof this._stageAxes === 'object' &&
        axes.x === this._stageAxes.x &&
        axes.y === this._stageAxes.y &&
        axes.z === this._stageAxes.z);
    if (same) return;
    this._stageAxes = typeof axes === 'object' ? { x: axes.x, y: axes.y, z: axes.z } : axes;
    this._rebuildAxisLines();
  }

  /** Set the palette background AS IT IS: three clears to a `THREE.Color`
   *  background rather than shading it, so no operator touches it and the
   *  screen shows the palette hex (see {@link toneMappedSourceColor}). */
  private _paintLookBackground(): void {
    if (this._lookBackgroundHex === null) return;
    const current = this._scene.background;
    if (current instanceof THREE.Color && current.getHex() === this._lookBackgroundHex) return;
    this._scene.background = new THREE.Color(this._lookBackgroundHex);
  }

  /** Per frame: a pipeline that re-derives tone mapping after we painted
   *  (the scene viewport's does) gets the TONE-MAPPED palette surface — the
   *  floor grid, and only it — re-derived under the new operator. The
   *  background and the axes are not tone-mapped and so never go stale. */
  private _syncLookBackground(): void {
    if (!this._renderer) return;
    if (
      this._renderer.toneMapping === this._lookToneMapping &&
      this._renderer.toneMappingExposure === this._lookExposure
    )
      return;
    this._paintLookGrid();
    this._lookToneMapping = this._renderer.toneMapping;
    this._lookExposure = this._renderer.toneMappingExposure;
  }

  dispose(): void {
    this._unsubscribeKeymap();
    this._disposed = true;
    this._unsubscribeSelectionTheme();
    if (this._verticalAxisLine) {
      this._verticalAxisLine.geometry.dispose();
      (this._verticalAxisLine.material as THREE.Material).dispose();
      this._verticalAxisLine = null;
    }
    if (this._axisLines) {
      this._scene.remove(this._axisLines);
      this._axisLines.geometry.dispose();
      (this._axisLines.material as THREE.Material).dispose();
      this._axisLines = null;
    }
    this.clearCameraView();
    if (this._sparkRenderer) {
      this._scene.remove(this._sparkRenderer);
      disposeSparkRendererWhenIdle(this._sparkRenderer);
      this._sparkRenderer = null;
    }
    this.disconnectInput();
    this._hideDropOverlay();
    for (const helper of this._helpers.values()) this._scene.remove(helper);
    this._helpers.clear();
    for (const helper of this._boxHelpers.values()) {
      this._scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this._boxHelpers.clear();
    for (const helper of this._reflectionProbeHelpers.values()) helper.dispose();
    this._reflectionProbeHelpers.clear();
    for (const helper of this._triggerVolumeHelpers.values()) helper.dispose();
    this._triggerVolumeHelpers.clear();
    for (const helper of this._constraintHelpers.values()) helper.dispose();
    this._constraintHelpers.clear();
    for (const { helper } of this._cameraHelpers.values()) helper.dispose();
    this._cameraHelpers.clear();
    disposeSpatialHandleVisuals(this._spatialHandleRoots);
    this._spatialHandleRoots = [];
    this._spatialHandleMeshes = [];
  }

  // --- Private ---

  private _ensureSparkRenderer(): void {
    if (
      !this._renderer ||
      this._sparkRenderer ||
      this._sparkRendererLoading ||
      this._sparkRendererFailed
    )
      return;
    const now = performance.now();
    if (!shouldDiscoverGaussianSplat(this._lastSparkDiscoveryAt, now)) return;
    this._lastSparkDiscoveryAt = now;
    if (!sceneHasGaussianSplat(this._scene)) return;
    this._sparkRendererLoading = true;
    void import('@sparkjsdev/spark')
      .then(({ SparkRenderer }) => {
        if (this._disposed || !this._renderer) return;
        const spark = new SparkRenderer({ renderer: this._renderer, enableLod: false });
        spark.traverse((node) => setUserData(node, 'engineInternal', true));
        this._sparkRenderer = spark;
        invalidateStages();
      })
      .catch((error: unknown) => {
        this._sparkRendererFailed = true;
        // biome-ignore lint/suspicious/noConsole: A missing renderer chunk must fail once and loudly, not retry every frame.
        console.error('Failed to install SparkRenderer in the editor viewport.', error);
      })
      .finally(() => {
        this._sparkRendererLoading = false;
      });
  }

  /**
   * BLENDER'S NAVIGATION GIZMO — six balls on three axis stalks, not an arrow
   * rig. Measured in `modeling-object-none.png` at matched scale: a 72 CSS px
   * circle of 16 px balls on a 28 px radius; the three POSITIVE balls are
   * filled in their axis colour and carry a dark letter, the three negative
   * ones are a 2 px ring of the same colour over the stage; a 3 px stalk runs
   * from the centre to each positive ball only; and the whole thing fades
   * back-to-front with depth (`_syncOrientationGizmoDepth`, run per frame),
   * which is what makes the near balls read as near.
   *
   * The gizmo camera's frustum is +/-1.5, and the scissored box it draws into
   * is `COMPASS_BOX_PX`, so one unit is `COMPASS_BOX_PX / 3` screen px — every
   * size below is a measured pixel count divided by that.
   */
  /**
   * BUILD (or REBUILD) THE NAVIGATION GIZMO in the look's axis frame.
   *
   * Blender's gizmo draws a stalk and a FILLED, LETTERED ball on each axis's
   * POSITIVE side and a hollow one opposite, and the axis it calls Z is the
   * one that points up. Under a Z-up world three's +Y carries that axis, so
   * the top ball is lettered Z and inked blue, and the source's +Y — three's
   * −Z — is where the green stalk and the lettered Y ball go. Everything on
   * this gizmo is that one table ({@link StageAxisFrame}): which letter, which
   * ink, and which SIDE is the positive one.
   *
   * The click targets keep three's own `vcDirIdx` vocabulary (`0=+X … 5=−Z`)
   * because what they do is snap the camera along a THREE direction, which is
   * a fact about the scene and not about what the axis is called.
   */
  private _buildOrientationGizmo(): void {
    if (this._vcScene === undefined) return;
    // Rebuilt on every look change, so what it held is released, textures included.
    for (const held of [...this._vcScene.children]) {
      this._vcScene.remove(held);
      const drawn = held as THREE.Mesh | THREE.Sprite;
      // A sprite's geometry is three's one shared quad: left alone.
      if (!(drawn as THREE.Sprite).isSprite) drawn.geometry?.dispose();
      const material = drawn.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      material?.map?.dispose();
      material?.dispose();
    }
    this._vcBalls.length = 0;
    this._vcStalks.length = 0;
    this._vcSolids.length = 0;
    this._vcClickTargets.length = 0;
    this._initOrientationGizmo();
  }

  private _initOrientationGizmo(): void {
    const form = this._gizmoLook.navigationForm;
    if (form !== 'balls' && form !== 'godot') {
      this._initNavigationForm(form);
      return;
    }
    const perUnit = COMPASS_BOX_PX / 3;
    // The ball's BACK size; `_syncOrientationGizmoDepth` adds the depth gain
    // per ball, which is how Blender's front balls come out larger.
    const ballUnits = COMPASS_BALL_BACK_PX / perUnit;
    const stalkUnits = COMPASS_STALK_PX / perUnit;
    const stalkRadius = COMPASS_STALK_WIDTH_PX / perUnit / 2;
    const axes = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const targetGeo = new THREE.SphereGeometry(ballUnits * 0.6, 8, 8);
    const targetMat = new THREE.MeshBasicMaterial({ visible: false });

    for (let i = 0; i < 3; i++) {
      // WHICH SOURCE AXIS THIS THREE AXIS CARRIES, and which way round its
      // positive direction runs here (see {@link _buildOrientationGizmo}).
      const [sourceAxis, positive] = this._stageAxisFrame[i]!;
      // The look's navigation colours, else its axis colours, else the editor's own.
      const lookAxes = this._gizmoLook.navigation ?? this._gizmoLook.axes;
      const color =
        lookAxes === null ? COMPASS_AXIS_COLOR[sourceAxis]! : new THREE.Color(lookAxes[sourceAxis]!);
      const letter = AXIS_LETTER[sourceAxis]!;
      const axis = axes[i]!.clone().multiplyScalar(positive);

      for (const sign of [1, -1] as const) {
        const direction = axis.clone().multiplyScalar(sign);
        // The stalk to each ball: Blender draws the positive ones always and all six when the
        // view looks straight down an axis (`_syncOrientationGizmoDepth`).
        const stalk = new THREE.Mesh(
          new THREE.CylinderGeometry(stalkRadius, stalkRadius, stalkUnits, 8),
          new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, toneMapped: false }),
        );
        stalk.position.copy(direction).multiplyScalar(stalkUnits / 2);
        stalk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        this._vcScene.add(stalk);
        this._vcStalks.push({ mesh: stalk, direction: direction.clone(), positive: sign > 0, color });

        // Three sprites per ball — its fill, its ring, its letter — all white and tinted per frame,
        // because Blender computes each colour from the ball's depth every draw.
        const sprite = (map: THREE.Texture) => {
          const made = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, toneMapped: false }));
          made.position.copy(direction).multiplyScalar(stalkUnits);
          made.scale.setScalar(ballUnits);
          this._vcScene.add(made);
          return made;
        };
        const fill = sprite(compassDiscTexture());
        const ring = sprite(compassRingTexture());
        const glyph = sprite(compassGlyphTexture(sign > 0 ? letter : `-${letter}`));
        this._vcBalls.push({ fill, ring, letter: glyph, direction: direction.clone(), positive: sign > 0, axis: i, color });

        const target = new THREE.Mesh(targetGeo, targetMat);
        target.position.copy(fill.position);
        // 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z — THREE's directions, because
        // what this does is point the camera down a direction in the scene,
        // which is a fact about the stage and not about what the axis is
        // called. `sign` is the side of the SOURCE axis, so the three
        // direction is the two signs multiplied: the ball lettered Y in a
        // Z-up world sits on three's −Z and must snap the camera there.
        setUserData(target, 'vcDirIdx', i * 2 + (positive * sign > 0 ? 0 : 1));
        this._vcScene.add(target);
        this._vcClickTargets.push(target);
      }
    }
  }

  /**
   * THE NAVIGATION GIZMO'S OTHER FORMS (`stage.navigationGizmo`), in the same frame
   * and colours as the balls. `cones`: Unity's scene gizmo — a cone on each side of each axis,
   * its tip toward a grey centre cube, the positive ones in the axis colour and lettered, the
   * negative ones grey; each is a click target. `triad`: Unreal's — a line along each positive
   * axis with its letter past the tip, no negatives, nothing to click.
   */
  private _initNavigationForm(form: 'cones' | 'triad'): void {
    const perUnit = COMPASS_BOX_PX / 3;
    const up = new THREE.Vector3(0, 1, 0);
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const lookAxes = this._gizmoLook.navigation ?? this._gizmoLook.axes;
    const letterSprite = (color: THREE.Color, letter: string, at: THREE.Vector3, px: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: compassLetterTexture(color, letter), transparent: true, depthTest: false, toneMapped: false }),
      );
      sprite.position.copy(at);
      sprite.scale.setScalar(px / perUnit);
      sprite.renderOrder = 200;
      this._vcScene.add(sprite);
    };
    for (let i = 0; i < 3; i++) {
      const [sourceAxis, positive] = this._stageAxisFrame[i]!;
      const color =
        lookAxes === null ? COMPASS_AXIS_COLOR[sourceAxis]! : new THREE.Color(lookAxes[sourceAxis]!);
      const letter = AXIS_LETTER[sourceAxis]!;
      const axis = axes[i]!.clone().multiplyScalar(positive);
      if (form === 'triad') {
        // Unreal's triad is about 40 px, opaque and undimmed by facing (`level-editor.png`); its
        // size is the look's (`navigationSize`, a multiple of this 24 px).
        const scale = this._gizmoLook.navigationSize ?? 1;
        const length = (24 * scale) / perUnit;
        const radius = (COMPASS_STALK_WIDTH_PX * Math.sqrt(scale)) / perUnit / 2;
        const line = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, length, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, toneMapped: false }),
        );
        line.position.copy(axis).multiplyScalar(length / 2);
        line.quaternion.setFromUnitVectors(up, axis);
        this._vcScene.add(line);
        this._vcSolids.push({ mesh: line, direction: axis.clone() });
        letterSprite(color, letter, axis.clone().multiplyScalar(length + (7 * scale) / perUnit), 12 * scale);
        continue;
      }
      for (const sign of [1, -1] as const) {
        const direction = axis.clone().multiplyScalar(sign);
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(6 / perUnit, 15 / perUnit, 20),
          new THREE.MeshBasicMaterial({
            color: sign > 0 ? color : new THREE.Color(0xd9d9d9),
            transparent: true,
            depthTest: false,
            toneMapped: false,
          }),
        );
        cone.position.copy(direction).multiplyScalar(19 / perUnit);
        cone.quaternion.setFromUnitVectors(up, direction.clone().negate());
        // Three's direction index, as the balls' targets carry it (see `_initOrientationGizmo`).
        setUserData(cone, 'vcDirIdx', i * 2 + (positive * sign > 0 ? 0 : 1));
        this._vcScene.add(cone);
        this._vcSolids.push({ mesh: cone, direction: direction.clone() });
        this._vcClickTargets.push(cone);
        if (sign > 0) letterSprite(color, letter.toLowerCase(), direction.clone().multiplyScalar(34 / perUnit), 12);
      }
    }
    if (form === 'cones') {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(11 / perUnit, 11 / perUnit, 11 / perUnit),
        new THREE.MeshBasicMaterial({ color: 0xbdbdbd, transparent: true, depthTest: false, toneMapped: false }),
      );
      cube.renderOrder = 50;
      this._vcScene.add(cube);
    }
  }

  /**
   * The gizmo's depth cue, per frame: a ball pointing AWAY from the viewer is
   * drawn behind, dimmer and SMALLER, exactly as Blender's is. Both laws are
   * measured off the reference's own six balls and stated where they are
   * applied below. Sprites carry no depth of their own here
   * (`depthTest: false`, so the stage never occludes the gizmo), so the draw
   * ORDER is set here too.
   */
  private _syncOrientationGizmoDepth(): void {
    const perUnit = COMPASS_BOX_PX / 3;
    const view = this._vcDir.copy(this._vcCamera.position).normalize();
    // BLENDER'S COLOURS, computed as `view3d_gizmo_navigate_type.cc` computes them each draw:
    // a ball's colour is its axis colour mixed with the viewport's background by its depth
    // (`fading_color`: `(depth + 1) · 0.25 + 0.5`), a negative ball a 25% tint of it ringed in
    // that colour, and a view looking straight down an axis (`axis_align`) hides that axis's far
    // ball, fills its near negative one (ringed halfway to white) and letters it `-Y`. Checked
    // against both reference frames: the default view's +X fill (245,54,81) is this mix at depth
    // 0.82, the front view's (204,55,78) at depth 0.
    if (this._gizmoLook.navigationForm === 'godot') {
      this._syncGodotNavigation(view);
      return;
    }
    const background = new THREE.Color(this._gizmoLook.background ?? 0x3d3d3d);
    const white = new THREE.Color(1, 1, 1);
    // Blender mixes its theme's display values, so the mix is done in sRGB, not three's linear.
    const mix = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): THREE.Color => {
      const x = a.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      const y = b.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      return out.setRGB(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t, THREE.SRGBColorSpace);
    };
    let aligned = -1;
    // Blender's test: the axis's in-plane length squared under 1e-6 (`axis_align`).
    for (const { direction, axis } of this._vcBalls) if (1 - direction.dot(view) ** 2 < 1e-6) aligned = axis;
    const scratch = new THREE.Color();
    const black = new THREE.Color(0, 0, 0);
    for (const { fill, ring, letter, direction, positive, axis, color } of this._vcBalls) {
      const depth = direction.dot(view);
      const facing = (depth + 1) / 2; // 0 away, 1 toward
      const behind = depth <= 0.01 * (positive ? -1 : 1);
      const alignedFront = axis === aligned && !behind;
      const alignedBack = axis === aligned && behind;
      const fading = mix(background, color, (depth + 1) * 0.25 + 0.5, new THREE.Color());
      const fillMaterial = fill.material as THREE.SpriteMaterial;
      const ringMaterial = ring.material as THREE.SpriteMaterial;
      const letterMaterial = letter.material as THREE.SpriteMaterial;
      const fade = Math.min(depth + 1, 1);
      if (positive || alignedFront) {
        fillMaterial.color.copy(fading);
        fillMaterial.opacity = 1;
      } else {
        fillMaterial.color.copy(mix(background, color, 0.25, scratch));
        fillMaterial.opacity = fade;
      }
      if (!positive && alignedFront) {
        ringMaterial.color.copy(mix(white, color, 0.5, scratch));
        ringMaterial.opacity = fade;
      } else {
        ringMaterial.color.copy(fading);
        ringMaterial.opacity = 1;
      }
      // The letter's ink is the fill darkened, as measured on Blender's frames (0.356; Blender
      // draws it black at 0.9 over a small glyph, and this is what that reads as).
      letterMaterial.color.copy(mix(black, fillMaterial.color, COMPASS_LETTER_INK, scratch));
      fill.visible = !alignedBack;
      ring.visible = !alignedBack;
      letter.visible = (positive || axis === aligned) && !alignedBack;
      // The ball's SIZE, on the same quantity: an orthographic gizmo camera gives no depth scale
      // for free, and Blender's six balls measure a straight line in `facing` (the fit is in the
      // box's docblock).
      const scale = (COMPASS_BALL_BACK_PX + COMPASS_BALL_DEPTH_GAIN_PX * facing) / perUnit;
      const order = 10 + Math.round(facing * 100) * 3;
      for (const [part, rank] of [[fill, 0], [ring, 1], [letter, 2]] as const) {
        part.scale.setScalar(scale);
        part.renderOrder = order + rank;
      }
    }
    for (const { mesh, direction, positive, color } of this._vcStalks) {
      const depth = direction.dot(view);
      const facing = (depth + 1) / 2;
      // Blender's line runs from `middle_color` (0.75) at the centre to `fading_color` at the
      // ball; one colour per stalk here, their mean.
      const material = mesh.material as THREE.MeshBasicMaterial;
      mix(background, color, (0.75 + (depth + 1) * 0.25 + 0.5) / 2, material.color);
      material.opacity = 1;
      mesh.visible = positive || aligned !== -1;
      // On the balls' scale, just under the ball it leads to, so depth sorts stalk and ball together.
      mesh.renderOrder = 10 + Math.round(facing * 100) * 3 - 1;
    }
    for (const { mesh, direction } of this._vcSolids) {
      mesh.renderOrder = Math.round(((direction.dot(view) + 1) / 2) * 100);
    }
  }

  /**
   * GODOT'S BALLS, as `ViewportRotationControl::_draw_axis` (`node_3d_editor_plugin.cpp`, 4.4)
   * draws them: every ball in its axis colour at an opacity of `remap((z + 1) / 2, 0, 0.5, 0.35,
   * 1)`; a positive ball filled, with its stalk and a black letter at 0.6 of that opacity; a
   * negative one a disc whose inner 0.8 is the colour darkened by 0.4, which is the soft light
   * rim of its frames. One size for every ball (`AXIS_CIRCLE_RADIUS` 8), and no axis-aligned
   * rule.
   */
  private _syncGodotNavigation(view: THREE.Vector3): void {
    const perUnit = COMPASS_BOX_PX / 3;
    const scale = 16 / perUnit;
    const dark = (color: THREE.Color): THREE.Color => {
      const c = color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      return new THREE.Color().setRGB(c.r * 0.6, c.g * 0.6, c.b * 0.6, THREE.SRGBColorSpace);
    };
    for (const { fill, ring, letter, direction, positive, color } of this._vcBalls) {
      const facing = (direction.dot(view) + 1) / 2;
      const alpha = Math.min(1, 0.35 + (facing / 0.5) * 0.65);
      const fillMaterial = fill.material as THREE.SpriteMaterial;
      const ringMaterial = ring.material as THREE.SpriteMaterial;
      const letterMaterial = letter.material as THREE.SpriteMaterial;
      fillMaterial.color.copy(positive ? color : dark(color));
      fillMaterial.opacity = alpha;
      ringMaterial.color.copy(color);
      ringMaterial.opacity = alpha;
      letterMaterial.color.setRGB(0, 0, 0);
      letterMaterial.opacity = alpha * 0.6;
      fill.visible = true;
      ring.visible = true;
      letter.visible = positive;
      const order = 10 + Math.round(facing * 100) * 3;
      for (const [part, rank] of [[fill, 0], [ring, 1], [letter, 2]] as const) {
        part.scale.setScalar(scale);
        part.renderOrder = order + rank;
      }
    }
    for (const { mesh, direction, positive, color } of this._vcStalks) {
      const facing = (direction.dot(view) + 1) / 2;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.copy(color);
      material.opacity = Math.min(1, 0.35 + (facing / 0.5) * 0.65);
      mesh.visible = positive;
      // On the balls' scale, just under the ball it leads to, so depth sorts stalk and ball together.
      mesh.renderOrder = 10 + Math.round(facing * 100) * 3 - 1;
    }
  }

  /**
   * Is this pointer over the orientation cube's screen-space box? The HIT
   * TEST alone, with no side effect, because two gestures need the answer for
   * different reasons: the single click snaps the camera with it, and the
   * double click (drill-in) must simply not treat the cube as geometry —
   * without this guard, double-clicking the cube drilled into whatever the
   * pointer found BEHIND it.
   */
  private _isOverViewCube(clientX: number, clientY: number): boolean {
    // An indicator is only drawn, and a triad has nothing to click: clicks pass to the stage.
    if (this._navigation !== 'interactive' || this._gizmoLook.navigationForm === 'triad') return false;
    const rect = this._canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { left: vcLeft, top: vcTop } = this._vcOrigin(rect.width, rect.height, this._chromeInsetPx);
    return x >= vcLeft && x <= vcLeft + this._vcSize && y >= vcTop && y <= vcTop + this._vcSize;
  }

  /**
   * WHERE THE NAVIGATION GIZMO'S BOX SITS, top-left in CSS px from the canvas's top-left: the
   * look's corner (`navigationCorner`) — Blender's top right, set by its measured margins, or
   * Unreal's bottom left, one small margin in from both edges — inset by the canvas's bleed.
   */
  private _vcOrigin(width: number, height: number, inset: number): { left: number; top: number } {
    if (this._gizmoLook.navigationCorner === 'bottom-left') {
      // Clear of the stage's own camera readout, two lines along the bottom edge (measured: a
      // 4 px margin put the triad's lower half under it).
      const left = 4;
      const bottom = 48;
      return { left: left + inset, top: height - this._vcSize - bottom - inset };
    }
    return { left: width - this._vcSize - this._vcMarginRight - inset, top: this._vcMarginTop + inset };
  }

  /** The view's grid switch (`overlays.grid.visible`) — the person's toggle, one per view. */
  setGridVisible(visible: boolean): void {
    if (visible === this._presentationGrid) return;
    this._presentationGrid = visible;
    this._applyGridVisibility();
  }

  /** THE GRID SHOWS when the view's switch (`overlays.grid.visible`, which every grid toggle
   *  writes) and a showing stage both say so; the axis lines follow it. */
  private _applyGridVisibility(): void {
    this.grid.visible = this._presentationGrid && this._threeSurfaceShowing;
    if (this._axisLines) this._axisLines.visible = this.grid.visible && this._axesWanted;
    invalidateStages();
  }

  /** The view's navigation gizmo (`overlays.navigation`). */
  setNavigation(navigation: 'interactive' | 'indicator' | 'hidden'): void {
    if (navigation === this._navigation) return;
    this._navigation = navigation;
    invalidateStages();
  }

  /** Returns true if the click was inside the gizmo area (consumed). */
  private _handleViewCubeClick(e: PointerEvent): boolean {
    if (!this._isOverViewCube(e.clientX, e.clientY)) return false;
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Screen-space gizmo rect, where it is drawn (the canvas's bleed inset included).
    const { left: vcLeft, top: vcTop } = this._vcOrigin(rect.width, rect.height, this._chromeInsetPx);

    // Convert to NDC for the gizmo camera
    const ndcX = ((x - vcLeft) / this._vcSize) * 2 - 1;
    const ndcY = -(((y - vcTop) / this._vcSize) * 2 - 1);

    this._vcRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._vcCamera);
    const hits = this._vcRaycaster.intersectObjects(this._vcClickTargets);
    if (hits.length === 0) return true; // In gizmo area but missed — still consume

    const dirIdx = getUserData(hits[0]!.object, 'vcDirIdx') as number;
    const targetDir = VC_DIRS[dirIdx]!;
    // Whoever owns the view's projection answers for an axis view first (Blender's
    // `view3d.view_axis`, which the gizmo's balls run: orthographic under Auto Perspective).
    for (const listener of [...this._axisViewListeners].reverse()) if (listener()) break;
    // A drag's leftover inertia would carry the view off the axis once the turn ends.
    const pending = this.orbitControls as unknown as { _sphericalDelta: THREE.Spherical; _panOffset: THREE.Vector3 };
    pending._sphericalDelta.set(0, 0, 0);
    pending._panOffset.set(0, 0, 0);

    // The view turns to the axis's own orientation, with no roll: Top's screen up is the world's
    // -Z, Bottom's +Z, the rest the world's up (`ED_view3d_quat_from_axis_view`, roll 0).
    const up =
      targetDir.y > 0.5 ? new THREE.Vector3(0, 0, -1) : targetDir.y < -0.5 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this._snapDist = this.freeCamera.position.distanceTo(this.orbitControls.target);
    this._snapQ1.copy(this.freeCamera.quaternion);
    this._snapQ2.setFromRotationMatrix(new THREE.Matrix4().lookAt(targetDir, new THREE.Vector3(), up));
    this._snapStartTime = performance.now();
    this._snapAnimating = true;

    return true;
  }

  /** Live flush during drag — updates inspector without undo or scene rebuild. */
  private _flushGizmoToStoreLive(): void {
    this._skipNextSync = true;
    // Live transform edits flow through the AuthoringAdapter (the gizmo already
    // moved the Object3D; apply syncs the descriptor without pushing undo).
    const authoring = this._authoring();
    const applyLive = (id: string | null, o: THREE.Object3D): void => {
      if (!id) return;
      applyAuthoringTransform(authoring, id, {
        position: o.position.toArray() as [number, number, number],
        rotation: o.quaternion.toArray() as [number, number, number, number],
        scale: o.scale.toArray() as [number, number, number],
      });
    };
    // Primary (if it's a real entity, not pivot dummy)
    const obj = this._activeGizmo.object;
    if (obj && obj !== this._pivotDummy) {
      applyLive(this._attachedAuthoringId ?? this._authoringIdForObject(obj), obj);
    }
    // Other selected objects (active-element / individual-origins)
    for (const { id, obj: other } of this._otherDragObjects) applyLive(id, other);
    // All selected objects (median-point mode — gizmo is on dummy)
    for (const { id, obj: mo } of this._allDragObjects) applyLive(id, mo);
    for (const { id, obj: child } of this._preservedChildObjects) applyLive(id, child);
  }

  /** Capture the ordinary hierarchy children whose world poses must survive a
   * parent transform. The feature remains an honest source gesture: if any
   * affected child cannot persist all three native transform channels, none
   * are compensated and the user sees why. */
  private _preparePreservedChildren(movedIds: readonly string[]): PreservedChildTransform[] {
    if (!this._store.shell.preserveChildrenTransform) return [];
    const authoring = this._authoring();
    const moved = new Set(movedIds);
    const preserved = new Map<string, PreservedChildTransform>();
    for (const parentId of moved) {
      const candidates = this._preservedChildrenForParent(authoring, parentId, moved, preserved);
      if (typeof candidates === 'string') {
        showTransientHint(candidates);
        return [];
      }
      for (const candidate of candidates) preserved.set(candidate.id, candidate);
    }
    return [...preserved.values()];
  }

  private _preservedChildrenForParent(
    authoring: AuthoringAdapter,
    parentId: string,
    moved: ReadonlySet<string>,
    existing: ReadonlyMap<string, PreservedChildTransform>,
  ): PreservedChildTransform[] | string {
    const result: PreservedChildTransform[] = [];
    for (const childId of authoring.hierarchy.node(parentId)?.childIds ?? []) {
      if (moved.has(childId) || existing.has(childId)) continue;
      const child = this._objectForAuthoringId(childId);
      if (!child?.parent) continue;
      const blockedChannel = this._unwritableTransformChannel(authoring, childId);
      if (blockedChannel) {
        const label = authoring.hierarchy.node(childId)?.label ?? childId;
        return `Preserve Children Transform needs writable ${blockedChannel} on ${label}. The parent will transform normally.`;
      }
      child.updateWorldMatrix(true, false);
      result.push({ id: childId, obj: child, worldMatrix: child.matrixWorld.clone() });
    }
    return result;
  }

  private _unwritableTransformChannel(
    authoring: AuthoringAdapter,
    id: string,
  ): 'position' | 'rotation' | 'scale' | undefined {
    return (['position', 'rotation', 'scale'] as const).find(
      (channel) => !(authoring.transforms?.editability?.(id, channel).writable ?? false),
    );
  }

  private _restorePreservedChildren(): void {
    const local = new THREE.Matrix4();
    for (const preserved of this._preservedChildObjects) {
      const parent = preserved.obj.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      local.copy(parent.matrixWorld).invert().multiply(preserved.worldMatrix);
      local.decompose(preserved.obj.position, preserved.obj.quaternion, preserved.obj.scale);
      preserved.obj.updateMatrix();
      preserved.obj.updateWorldMatrix(false, true);
    }
  }

  private _belongsToRoots(object: THREE.Object3D, roots: ReadonlySet<THREE.Object3D>): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (roots.has(current)) return true;
      current = current.parent;
    }
    return false;
  }

  private _floorSnapPosition(
    object: THREE.Object3D,
    selectedRoots: ReadonlySet<THREE.Object3D>,
  ): THREE.Vector3 | null {
    object.updateWorldMatrix(true, true);
    const bounds = contentWorldBounds(object);
    if (bounds.isEmpty()) return null;
    const insetX = Math.min((bounds.max.x - bounds.min.x) * 0.1, 0.05);
    const insetZ = Math.min((bounds.max.z - bounds.min.z) * 0.1, 0.05);
    const points: readonly [number, number][] = [
      [(bounds.min.x + bounds.max.x) / 2, (bounds.min.z + bounds.max.z) / 2],
      [bounds.min.x + insetX, bounds.min.z + insetZ],
      [bounds.max.x - insetX, bounds.min.z + insetZ],
      [bounds.min.x + insetX, bounds.max.z - insetZ],
      [bounds.max.x - insetX, bounds.max.z - insetZ],
    ];
    const raycaster = new THREE.Raycaster();
    raycaster.layers.enableAll();
    const originY = bounds.min.y + Math.max((bounds.max.y - bounds.min.y) * 0.001, 0.001);
    let floorY = Number.NEGATIVE_INFINITY;
    for (const [x, z] of points) {
      raycaster.set(new THREE.Vector3(x, originY, z), new THREE.Vector3(0, -1, 0));
      const hit = raycaster
        .intersectObjects(this._scene.children, true)
        .find(
          (candidate) =>
            !this._belongsToRoots(candidate.object, selectedRoots) &&
            !isInEditorOwnedSubtree(candidate.object) &&
            candidate.point.y <= originY,
        );
      if (hit) floorY = Math.max(floorY, hit.point.y);
    }
    if (!Number.isFinite(floorY)) return null;
    const deltaY = floorY - bounds.min.y;
    if (Math.abs(deltaY) < 1e-6) return null;
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    worldPosition.y += deltaY;
    if (!object.parent) return worldPosition;
    object.parent.updateWorldMatrix(true, false);
    return object.parent.worldToLocal(worldPosition);
  }

  /** Godot-style one-shot placement: lower every writable selection until its
   * content bounds meet the highest real scene surface directly beneath it.
   * The operation is one native transform gesture and therefore uses the
   * active adapter's ordinary history/source path. */
  snapSelectionToFloor(): void {
    const authoring = this._authoring();
    const transforms = authoring.transforms;
    if (!transforms) {
      showTransientHint('This document does not expose writable transforms.');
      return;
    }
    const writableSelections = [...this._store.shell.selectedEntityIds]
      .map((id) => ({ id, obj: this._objectForAuthoringId(id) }))
      .filter(
        (entry): entry is { id: string; obj: THREE.Object3D } =>
          !!entry.obj && (transforms.editability?.(entry.id, 'position').writable ?? true),
      );
    const selectedObjects = new Set(writableSelections.map(({ obj }) => obj));
    const selections = writableSelections.filter(({ obj }) => {
      let parent = obj.parent;
      while (parent) {
        if (selectedObjects.has(parent)) return false;
        parent = parent.parent;
      }
      return true;
    });
    if (selections.length === 0) {
      showTransientHint('Select an object with a writable position first.');
      return;
    }
    const selectedRoots = new Set(selections.map(({ obj }) => obj));
    const planned: Array<(typeof selections)[number] & { position: THREE.Vector3 }> = [];
    for (const entry of selections) {
      const position = this._floorSnapPosition(entry.obj, selectedRoots);
      if (!position) continue;
      planned.push({ ...entry, position });
    }
    if (planned.length === 0) {
      showTransientHint('No solid scene surface was found beneath the selection.');
      return;
    }
    for (const { id } of planned) beginAuthoringTransformEdit(authoring, id);
    for (const { obj, position } of planned) obj.position.copy(position);
    this._skipNextSync = true;
    for (const { id, obj } of planned) {
      applyAuthoringTransform(authoring, id, {
        position: obj.position.toArray() as [number, number, number],
        rotation: obj.quaternion.toArray() as [number, number, number, number],
        scale: obj.scale.toArray() as [number, number, number],
      });
    }
    for (const { id } of planned) endAuthoringTransformEdit(authoring, id);
    this.syncFromStore();
  }

  /**
   * Surface snap: raycast downward from the primary object to find
   * a surface and adjust Y positions accordingly.
   */
  private _applySurfaceSnap(
    gizmoObj: THREE.Object3D,
    targets: {
      id: string;
      obj: THREE.Object3D;
      startPos: THREE.Vector3;
      startQuat: THREE.Quaternion;
      startScale: THREE.Vector3;
    }[],
  ): void {
    // Collect all dragged entity IDs to exclude from raycast
    const draggedIds = new Set<string>();
    const gizmoId = this._attachedAuthoringId ?? this._authoringIdForObject(gizmoObj);
    if (gizmoId) draggedIds.add(gizmoId);
    for (const { id } of targets) draggedIds.add(id);

    // Collect scene objects that are NOT being dragged
    const sceneTargets: THREE.Object3D[] = [];
    for (const [id, obj] of this._objectMap) {
      if (!draggedIds.has(id)) sceneTargets.push(obj);
    }
    // Also include the grid as a snap target
    sceneTargets.push(this.grid);

    if (sceneTargets.length === 0) {
      this._surfaceSnapIndicator.visible = false;
      return;
    }

    // Raycast downward from the gizmo object position
    const origin = gizmoObj.position.clone();
    origin.y += 50; // Start high above
    this._surfaceSnapRaycaster.set(origin, new THREE.Vector3(0, -1, 0));
    this._surfaceSnapRaycaster.far = 200;

    const hits = this._surfaceSnapRaycaster.intersectObjects(sceneTargets, true);
    const surfaceHit = hits.find(
      (hit) => hit.object === this.grid || !isInEditorOwnedSubtree(hit.object),
    );
    if (surfaceHit) {
      const hitPoint = surfaceHit.point;
      const snapY = hitPoint.y;
      const deltaY = snapY - gizmoObj.position.y;

      gizmoObj.position.y = snapY;
      for (const { obj } of targets) {
        obj.position.y += deltaY;
      }

      // Show snap indicator at hit point
      this._surfaceSnapIndicator.position.copy(hitPoint);
      this._surfaceSnapIndicator.position.y += 0.01; // Slight offset to avoid z-fighting
      // Orient ring to match surface normal
      const normal = surfaceHit.face?.normal;
      if (normal) {
        const worldNormal = normal.clone().transformDirection(surfaceHit.object.matrixWorld);
        this._surfaceSnapIndicator.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          worldNormal,
        );
      }
      this._surfaceSnapIndicator.visible = true;
    } else {
      this._surfaceSnapIndicator.visible = false;
    }
  }

  /**
   * Collect world-space vertex positions from entity meshes.
   * Excludes entities in `excludeIds` and editor helper children.
   */
  private _collectVertices(excludeIds: ReadonlySet<string>): THREE.Vector3[] {
    const vertices: THREE.Vector3[] = [];
    const MAX_PER_MESH = 1000;
    for (const [id, obj] of this._objectMap) {
      if (excludeIds.has(id)) continue;
      obj.traverse((child) => {
        if (isInEditorOwnedSubtree(child)) return;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!posAttr) return;
        const count = Math.min(posAttr.count, MAX_PER_MESH);
        const worldMatrix = mesh.matrixWorld;
        for (let i = 0; i < count; i++) {
          const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          v.applyMatrix4(worldMatrix);
          vertices.push(v);
        }
      });
    }
    return vertices;
  }

  /**
   * Vertex snap: snap the gizmo object to the nearest vertex on non-selected geometry.
   */
  private _applyVertexSnap(
    gizmoObj: THREE.Object3D,
    targets: { obj: THREE.Object3D; startPos: THREE.Vector3 }[],
  ): void {
    const entityPos = gizmoObj.position;
    const projected = entityPos.clone().project(this._screenCamera);
    const rect = this._canvas.getBoundingClientRect();
    const entityScreenX = ((projected.x + 1) / 2) * rect.width;
    const entityScreenY = ((-projected.y + 1) / 2) * rect.height;

    let bestDist = this._vertexSnapThreshold;
    let bestVertex: THREE.Vector3 | null = null;

    for (const vert of this._vertexSnapTargets) {
      const vs = vert.clone().project(this._screenCamera);
      // Skip vertices behind camera
      if (vs.z > 1) continue;
      const vertScreenX = ((vs.x + 1) / 2) * rect.width;
      const vertScreenY = ((-vs.y + 1) / 2) * rect.height;
      const dx = entityScreenX - vertScreenX;
      const dy = entityScreenY - vertScreenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestVertex = vert;
      }
    }

    if (bestVertex) {
      const delta = bestVertex.clone().sub(entityPos);
      gizmoObj.position.copy(bestVertex);
      for (const { obj } of targets) {
        obj.position.add(delta);
      }
      this._vertexSnapIndicator.position.copy(bestVertex);
      this._vertexSnapIndicator.visible = true;
      // Constant screen size for indicator
      const dist = bestVertex.distanceTo(this._screenCamera.position);
      this._vertexSnapIndicator.scale.setScalar(dist * 0.008);
    } else {
      this._vertexSnapIndicator.visible = false;
    }
  }

  /** Final flush on drag end — no undo push (already pushed on drag start). */
  private _flushGizmoToStore(): void {
    this._flushGizmoToStoreLive();
    const editIds = this._activeTransformEditIds;
    this._activeTransformEditIds = [];
    this._otherDragObjects = [];
    this._allDragObjects = [];
    this._preservedChildObjects = [];
    // Persist the final transform + mark dirty (ED2). A mid-drag autosave may
    // have already fired and cleared dirty; this re-schedules the final write.
    const authoring = this._authoring();
    for (const id of editIds) endAuthoringTransformEdit(authoring, id);
  }

  /** Check if we should skip a sync (gizmo already moved the object). */
  consumeSkipSync(): boolean {
    if (this._skipNextSync) {
      this._skipNextSync = false;
      return true;
    }
    return false;
  }

  /** Recolor gizmo handles to Godot axis colors & shift plane geometry to meet at center. */
  /**
   * THE GIZMO IS A CONSTANT NUMBER OF PIXELS WHEN THE LOOK STATES ONE (owner,
   * 2026-09-21: *"is gizmo perhaps the wrong size?"*).
   *
   * Our gizmo is three's `TransformControls`, whose handles scale as
   * `factor · size / 4` (`TransformControls.js:1539-1551` at the pinned
   * 0.180.0). Work the projection through that and the distance cancels:
   *
   *   perspective — `factor = d · min(1.9·tan(fov/2)/zoom, 7)`, and one world
   *     unit at distance `d` spans `H·zoom / (2·d·tan(fov/2))` px, so one
   *     gizmo-LOCAL unit spans `1.9·size·H/8 = 0.2375 · size · H` px. Constant
   *     in `d` and in `zoom`, and a FRACTION OF THE VIEWPORT: at `size` 1 an
   *     800 px viewport gave 190 px per local unit and a 1400 px one gave 332.
   *   orthographic — `factor = (top − bottom)/zoom` and one world unit spans
   *     `H·zoom / (top − bottom)` px, so one local unit spans `size · H / 4`.
   *
   * Blender's rule is the same SHAPE with its own unit: one gizmo unit is
   * `U.gizmo_size` CSS px, flat (`wm_gizmo.cc:450-474`, and
   * `StageContribution.gizmoSize` for the whole derivation). So the
   * look states Blender's number and this converts it — and the conversion is
   * the one thing neither side can state, because THREE'S UNIT IS HALF
   * BLENDER'S. Measured off the two libraries' own handle geometry, all three
   * families agreeing within 5%:
   *
   *   translate arm, origin → arrow tip
   *       three     0.6  (stem `lineGeometry2` 0→0.5, `TransformControls.js:1207`;
   *                       cone 0.1 long placed at 0.5, `:1198-1199`, `:1235`)
   *       Blender   1.25 (stem ends at `gizmo_line_range`'s `end` 1.0,
   *                       `transform_gizmo_3d.cc:1173-1203`; head 0.25,
   *                       `arrow3d_gizmo.cc:191`)            ratio 2.08
   *   rotate ring radius
   *       three     0.5  (`CircleGeometry(0.5, …)`, `TransformControls.js:1315-1323`)
   *       Blender   1.0  (`imm_draw_circle_wire_3d(…, 1.0f, …)`,
   *                       `dial3d_gizmo.cc:162`)              ratio 2.00
   *   scale handle, origin → outer face
   *       three     0.58 (0.08 box lifted to 0.54, `:1235`-family)
   *       Blender   1.10 (line end 1.0 + box `size` 0.05 ×2,
   *                       `arrow3d_gizmo.cc:175-177`)         ratio 1.90
   *
   * so `pixels per three unit = 2 · gizmoSize`, which lands the rotate ring on
   * Blender's 75 px radius exactly and the move arrow at 90 px against
   * Blender's 93.75. The brief this was built from proposed
   * `size = px / (0.2375·H)` — that reads Blender's number as px per THREE
   * unit, which would draw every handle at half Blender's, and the three
   * ratios above are why it is not what landed.
   *
   * A look that states no size keeps `size` 1 — three's own default and what
   * every non-Blender look drew before this existed.
   *
   * CALLED ON EVERY RESIZE (the px↔local conversion has `H` in it), on a
   * projection change (the two branches differ) and on a theme change. It is
   * NOT called per frame: `getComputedStyle` is the expensive half and the
   * theme subscription is what invalidates it.
   */
  private _applyGizmoSize(): void {
    // The theme subscription fires SYNCHRONOUSLY on install, which is earlier
    // in the constructor than the controls — the same ordering the grid's own
    // note records a step above.
    if (this.transformControls === undefined) return;
    const px = this._lookGizmoSizePx;
    const height = Math.max(1, this._canvas.clientHeight);
    const perThreeUnit = px === null ? null : 2 * px;
    const size =
      perThreeUnit === null
        ? 1
        : // By the camera the gizmos draw with (`setGizmoCamera`), whose projection decides
          // TransformControls' own sizing.
          (this.transformControls.camera as THREE.OrthographicCamera).isOrthographicCamera
          ? (4 * perThreeUnit) / height
          : perThreeUnit / (0.2375 * height);
    for (const controls of this._allGizmos()) controls.size = size;
  }

  /**
   * THE MOVE AND SCALE GIZMOS HAVE THREE ARMS, NOT SIX.
   *
   * three's translate gizmo draws each axis TWICE — a stem with an arrowhead
   * at `+0.5` and a second bare arrowhead at `-0.5`
   * (`TransformControls.js`'s `gizmoTranslate`, two `arrowGeometry` entries
   * per axis) — so the handle set reads as six directions. No editor we draw
   * against does that: Blender's move gizmo is three arms out of the origin
   * plus the plane squares and the white view circle
   * (`transform_gizmo_3d.cc`'s `gizmo_line_range`, and the reference frame
   * `b6/blender-reference/gizmo-move.png`), and measured on the Model
   * document at walk 5 parity row 2 the stray heads read as three extra
   * "axes" pointing back through the object.
   *
   * The PLANE squares, the centre octahedron and every rotate ring are
   * untouched; this drops only the negative-side handles and the pick volumes
   * behind them, so nothing that used to be draggable stops being draggable —
   * a negative handle and its positive twin drive the same axis.
   *
   * WHICH CHILD IS WHICH is read off the GEOMETRY, because three's
   * `setupGizmo` bakes each handle's placement into a cloned geometry and
   * resets the object transform to the identity every frame — the same reason
   * {@link _patchCombinedScaleGizmo} measures bounding boxes rather than
   * positions. A stem spans 0 → 0.5 and centres at +0.25, so only the bare
   * `-0.5` head has a centre on the negative side of its own axis.
   */
  private _dropNegativeAxisHandles(helper: THREE.Object3D, modes: readonly string[]): void {
    const gizmoNode = helper.children.find(
      (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
    ) as unknown as
      | { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> }
      | undefined;
    if (!gizmoNode) return;
    const axisOf: Record<string, THREE.Vector3> = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
    for (const mode of modes)
      for (const group of [gizmoNode.gizmo[mode], gizmoNode.picker[mode]]) {
        if (!group) continue;
        for (const child of [...group.children]) {
          const axis = axisOf[child.name];
          if (axis === undefined) continue;
          const mesh = child as THREE.Mesh;
          if (!mesh.geometry) continue;
          mesh.geometry.computeBoundingBox();
          const bounds = mesh.geometry.boundingBox;
          if (!bounds) continue;
          if (bounds.getCenter(new THREE.Vector3()).dot(axis) < 0) group.remove(child);
        }
      }
  }

  /**
   * THE COLOUR EACH HANDLE CARRIES, in the frame the look says this stage is
   * presenting.
   *
   * A handle is NAMED for three's axis and COLOURED for the source axis that
   * three axis carries ({@link StageAxisFrame}) — under three's own frame the
   * two are the same table, and under a Z-up world the Y and Z inks swap, so
   * the arm that points up is the source's Z and is blue. A plane handle takes
   * its NORMAL axis's colour, which is the same rule one level removed.
   */
  private _axisColorMap(): Record<string, THREE.Color> {
    const ink = (threeAxis: number): THREE.Color => this._gizmoAxisColor(this._stageAxisFrame[threeAxis]![0]);
    const axisX = ink(0);
    const axisY = ink(1);
    const axisZ = ink(2);
    return {
      X: axisX,
      Y: axisY,
      Z: axisZ,
      XY: axisZ,
      YZ: axisX,
      XZ: axisY,
    };
  }

  /**
   * READ WHAT THE LOOK SAYS ABOUT THIS STAGE and put the gizmos in that frame.
   *
   * Called once the gizmos exist and again on every theme change, and it is
   * idempotent by construction: the mirror below is applied as the DIFFERENCE
   * between the frame the geometry is already in ({@link _appliedAxisSigns})
   * and the one the look now asks for, and a mirror is its own inverse.
   */
  private _readLookStage(_canvas: HTMLElement): void {
    this._applyGizmoAxisFrame();
    this._buildOrientationGizmo();
  }

  /**
   * THE STAGE'S FUNCTION from its view's presentation (ARCHITECTURE.md rule 7): which axis of
   * the presented world is up — what the gizmos name and orient their axes by — and what a box
   * drag selects. Never from the look: a Blender look over a Y-up game world named its axes Z-up.
   */
  setStageFunction(
    world: { readonly upAxis: 'y' | 'z'; readonly handedness: 'right' | 'left' },
    interaction: {
      readonly boxSelect: 'contain' | 'touch';
      readonly transformHandles: { readonly scale: boolean; readonly viewRotate: boolean; readonly freeMove: boolean };
    },
  ): void {
    this._stageBoxSelect = interaction.boxSelect;
    const handles = interaction.transformHandles;
    if (
      handles.scale !== this._transformHandles.scale ||
      handles.viewRotate !== this._transformHandles.viewRotate ||
      handles.freeMove !== this._transformHandles.freeMove
    ) {
      this._transformHandles = { scale: handles.scale, viewRotate: handles.viewRotate, freeMove: handles.freeMove };
      this._syncCombinedGizmoHalves();
      invalidateStages();
    }
    const frame =
      world.upAxis === 'z'
        ? world.handedness === 'left'
          ? AXIS_FRAME_Z_UP_LEFT
          : AXIS_FRAME_Z_UP
        : AXIS_FRAME_Y_UP;
    if (frame === this._stageAxisFrame) return;
    this._stageAxisFrame = frame;
    this._applyGizmoAxisFrame();
    this._buildOrientationGizmo();
    this._rebuildAxisLines();
  }

  /**
   * DRAW EACH ARM ON THE SIDE ITS SOURCE AXIS POINTS, and paint it that axis's
   * colour.
   *
   * three authors its translate arms, its scale stalks and its plane squares
   * on the POSITIVE side of each of its own axes, and B6 drops the stray
   * negative-side heads so the set reads as three arms rather than six. Under
   * a Z-up world one of those three arms is pointing the wrong WAY: the
   * source's +Y is three's −Z, and Blender draws an arm along +Y and nothing
   * along −Y. So the handles of a flipped axis are MIRRORED onto the other
   * side — geometry only, one `scale(±1, ±1, ±1)` over every handle and
   * picker, which also carries the plane squares into the right quadrant and
   * leaves the rotate rings (symmetric about every axis they span) untouched.
   *
   * NOTHING ABOUT THE DRAG CHANGES, and that is the point: `TransformControls`
   * picks by the handle's NAME and projects the pointer onto the infinite axis
   * line through the origin, so a mirrored arm drives the same three axis it
   * always did — and therefore the same source channel, through the same
   * `P⁻¹ · matrixWorld` write. Only the side it is drawn on moves.
   *
   * A mirror flips face winding, so every affected material is set
   * `DoubleSide`. The gizmo is depth-test-off flat colour, so that is
   * invisible and the alternative — a 180° rotation — cannot flip one axis on
   * its own.
   */
  private _applyGizmoAxisFrame(): void {
    if (this.transformControls === undefined) return;
    const want = this._stageAxisFrame.map(([, sign]) => sign);
    const delta = [0, 1, 2].map((i) => (want[i] === this._appliedAxisSigns[i] ? 1 : -1));
    const mirrored = delta.some((value) => value === -1);
    const permuted = this._axisColorMap();
    // THE SCALE FAMILY IS NOT IN THE WORLD'S FRAME, and that is three's rule
    // rather than a choice here: `TransformControlsGizmo.updateMatrixWorld`
    // forces `space = 'local'` for scale ("scale always oriented to local
    // rotation"), so its handles are drawn along the OBJECT's own axes. A
    // presented Blender object carries Blender's matrix and hangs under the
    // root that holds the permutation, so its local axes ALREADY ARE the
    // source's: handle `Z` scales the source's Z, and in a Z-up world that
    // handle already points up. Its colours are therefore the IDENTITY map and
    // its geometry is not mirrored — doing either would apply the permutation
    // a second time.
    //
    // MEASURED 2026-09-21: with the permutation applied to all three families,
    // the scale handle that had pointed up was mirrored to point DOWN and a
    // drag where it used to be moved nothing at all.
    const identity: Record<string, THREE.Color> = {
      X: this._gizmoAxisColor(0),
      Y: this._gizmoAxisColor(1),
      Z: this._gizmoAxisColor(2),
      XY: this._gizmoAxisColor(2),
      YZ: this._gizmoAxisColor(0),
      XZ: this._gizmoAxisColor(1),
    };
    // A HANDLE'S MATERIAL IS SHARED ACROSS THE WHOLE INSTANCE — three builds
    // ONE `materialLib` per `TransformControlsGizmo` and hands the same
    // `matGreen` to the translate arm, the rotate ring and the scale stalk of
    // that axis (`TransformControls.js`'s `materialLib`, and the public
    // `setColors` that writes it). So a family that needs its OWN ink must
    // take its own material first; without that the last paint wins for every
    // family at once (measured 2026-09-21: painting scale identity turned the
    // translate arms back to three's colours in the same call).
    const paint = (
      group: THREE.Object3D | undefined,
      map: Record<string, THREE.Color>,
      flip: boolean,
      ownMaterial: boolean,
      handles: boolean,
    ) => {
      if (!group) return;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (flip && mesh.geometry) mesh.geometry.scale(delta[0]!, delta[1]!, delta[2]!);
        if (
          ownMaterial &&
          mesh.material &&
          !Array.isArray(mesh.material) &&
          !mesh.userData['vgaiOwnMaterial']
        ) {
          mesh.material = (mesh.material as THREE.Material).clone();
          mesh.userData['vgaiOwnMaterial'] = true;
        }
        const material = mesh.material as
          | (THREE.MeshBasicMaterial & { _color?: THREE.Color | undefined })
          | undefined;
        if (!material || Array.isArray(material)) return;
        if (flip) material.side = THREE.DoubleSide;
        const ink = map[child.name];
        if (ink && material.color) {
          // THE LOOK'S RESTING OPACITY over the handle's own (three draws its plane squares
          // translucent); three caches it like the colour, so the cache is dropped too.
          // Handles only: the drag's axis lines (the `helper` family) keep three's own.
          if (handles) {
            const base = (material.userData['vgaiBaseOpacity'] ??= material.opacity) as number;
            material.opacity = base * (this._gizmoLook.opacity ?? 1);
            (material as { _opacity?: number | undefined })._opacity = undefined;
          }
          material.color.copy(ink);
          // THREE CACHES A HANDLE'S RESTING COLOUR ON ITS FIRST UPDATE
          // (`TransformControlsGizmo.updateMatrixWorld`: `material._color =
          // material._color || material.color.clone()`) and repaints from that
          // cache every frame. Dropping it is what lets a look change reach a
          // gizmo that has already rendered; without it the first frame's ink
          // is the only ink this gizmo will ever have.
          material._color = undefined;
        }
      });
    };
    for (const controls of this._allGizmos()) {
      const node = controls
        .getHelper()
        .children.find(
          (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
        ) as unknown as
        | {
            gizmo: Record<string, THREE.Object3D>;
            picker: Record<string, THREE.Object3D>;
            helper: Record<string, THREE.Object3D>;
          }
        | undefined;
      if (!node) continue;
      for (const family of ['gizmo', 'picker', 'helper'] as const) {
        // ONLY THE TRANSLATE ARMS ARE MIRRORED. A rotate RING is symmetric
        // about every axis it spans, so the permutation is visible in its
        // colour alone; the scale family is in the object's own frame (above).
        const handles = family === 'gizmo';
        paint(node[family]?.['translate'], permuted, mirrored, false, handles);
        paint(node[family]?.['rotate'], permuted, false, false, handles);
        paint(node[family]?.['scale'], identity, false, true, handles);
      }
    }
    if (mirrored) this._appliedAxisSigns = want as readonly (1 | -1)[];
  }

  /** The look's colour for a SOURCE axis (0=X, 1=Y, 2=Z), or the editor's own. */
  private _gizmoAxisColor(sourceAxis: number): THREE.Color {
    const axes = this._gizmoLook.axes;
    // Godot's values are sRGB; `new THREE.Color(r, g, b)` would read them as linear and draw
    // them washed out.
    return axes === null
      ? new THREE.Color().setRGB(...KIT_GIZMO_AXIS_RGB[sourceAxis]!, THREE.SRGBColorSpace)
      : new THREE.Color(axes[sourceAxis]!);
  }

  /**
   * HOW A HANDLE HIGHLIGHTS, by the look. three paints the hovered or dragged handle one
   * colour for every axis (`materialLib.active`, yellow) at full opacity. A look with a
   * `color.gizmo.hover` keeps that form in its own colours (Unity's preselection and selected
   * axis); a look without one highlights each handle in its own resting colour, carried by
   * `gizmoHighlightSaturation`/`gizmoHighlightValue` (Blender keeps it; Godot desaturates it
   * to a quarter at full value). Runs after three's own pass each frame, on the handles three
   * has just highlighted; a look that names no axes and no highlight keeps three's.
   */
  private _installGizmoHighlight(controls: TransformControls): void {
    const node = controls
      .getHelper()
      .children.find(
        (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
      ) as
      | (THREE.Object3D & {
          gizmo: Record<string, THREE.Object3D>;
          picker: Record<string, THREE.Object3D>;
          axis: string | null;
          mode: string;
          enabled: boolean;
          dragging: boolean;
        })
      | undefined;
    if (!node) return;
    const threeUpdate = node.updateMatrixWorld.bind(node);
    node.updateMatrixWorld = (force?: boolean) => {
      threeUpdate(force);
      // THE HANDLES THE VIEW TURNS OFF, drawn and picked by neither family: three sets every
      // handle's visibility on each update, and its pointer tests skip invisible pickers.
      // The free-move centre goes wherever move handles are drawn (Unity's Move tool has none,
      // Blender's and Unreal's do); the view ring only from the COMBINED tool — the single
      // Rotate tool keeps its own (Godot's Select gizmo has none, its Rotate tool does).
      const combined = this._store.shell.transformMode === 'combined';
      const hidden =
        node.mode === 'translate' && !this._transformHandles.freeMove
          ? 'XYZ'
          : combined && node.mode === 'rotate' && !this._transformHandles.viewRotate
            ? 'E'
            : null;
      if (hidden !== null) {
        for (const family of [node.gizmo, node.picker]) {
          for (const handle of family[node.mode]?.children ?? []) {
            if (handle.name === hidden) handle.visible = false;
          }
        }
      }
      const look = this._gizmoLook;
      const axis = node.axis;
      if (!node.enabled || !axis) return;
      if (
        look.hover === null &&
        look.axes === null &&
        look.highlightSaturation === null &&
        look.highlightValue === null
      )
        return;
      const fixed = node.dragging ? (look.drag ?? look.hover) : look.hover;
      for (const handle of node.gizmo[node.mode]?.children ?? []) {
        if (handle.name !== axis && !axis.split('').some((letter) => handle.name === letter)) continue;
        const material = (handle as THREE.Mesh).material as
          | (THREE.MeshBasicMaterial & { _color?: THREE.Color })
          | undefined;
        if (!material || Array.isArray(material) || !material.color) continue;
        if (fixed !== null) {
          material.color.setHex(fixed);
          continue;
        }
        // In sRGB, where the engines take their HSV (Godot's `Color.from_hsv`).
        const resting = (material._color ?? material.color).clone().convertLinearToSRGB();
        const hsv = rgbToHsv(resting);
        const saturation = hsv.s * (look.highlightSaturation ?? 1);
        const value = look.highlightValue ?? hsv.v;
        hsvToColor(hsv.h, saturation, value, material.color).convertSRGBToLinear();
      }
    };
  }

  /**
   * THE MOVE ARROWS IN THE LOOK'S SHAPE (`stage.gizmoArrowLength`/`gizmoArrowHead`).
   * three bakes each handle's placement into its geometry, and repaints positions every frame,
   * so the shape is geometry: the shaft is stretched along its axis, the head scaled about its
   * base and carried to the shaft's new end, and the picker stretched to the new tip. Applied
   * as the difference from the shape already there, so a look change can call it again, and
   * independent of the axis mirror (both are scales along an axis through the centre).
   * three's shape: ring radius 0.5, shaft to 0.5, a head 0.1 long, so a tip at 1.2 radii.
   */
  private _applyGizmoArrows(): void {
    if (this.transformControls === undefined) return;
    this._applyGizmoRings();
    const want = {
      length: this._gizmoLook.arrowLength ?? 1.2,
      head: this._gizmoLook.arrowHead ?? 1,
    };
    const was = this._appliedArrow;
    if (want.length === was.length && want.head === was.head) return;
    const RING = 0.5;
    const HEAD = 0.1;
    const shaftEnd = (shape: { length: number; head: number }) => RING * shape.length - HEAD * shape.head;
    // A shape whose head would swallow its shaft is refused: the shaft is scaled by a ratio of
    // shaft ends, and a zero end would make every later shape NaN.
    if (shaftEnd(want) <= 0.05) return;
    const stretch = shaftEnd(want) / shaftEnd(was);
    const headScale = want.head / was.head;
    const tipScale = want.length / was.length;
    const node = this.transformControls
      .getHelper()
      .children.find(
        (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
      ) as unknown as
      | { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> }
      | undefined;
    if (!node) return;
    const axisIndex: Record<string, number> = { X: 0, Y: 1, Z: 2 };
    const along = (index: number, factor: number): [number, number, number] =>
      [0, 1, 2].map((i) => (i === index ? factor : 1)) as [number, number, number];
    for (const handle of node.gizmo['translate']?.children ?? []) {
      const index = axisIndex[handle.name];
      const geometry = (handle as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (index === undefined || !geometry) continue;
      const cylinder = geometry as THREE.CylinderGeometry;
      const isHead = cylinder.parameters?.radiusTop === 0;
      if (!isHead) {
        geometry.scale(...along(index, stretch));
        continue;
      }
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const low = [box.min.x, box.min.y, box.min.z][index]!;
      const high = [box.max.x, box.max.y, box.max.z][index]!;
      // The base is the end nearer the centre, on whichever side the arm is drawn.
      const base = Math.abs(low) < Math.abs(high) ? low : high;
      const offset = [0, 0, 0] as [number, number, number];
      offset[index] = -base;
      geometry.translate(...offset);
      geometry.scale(headScale, headScale, headScale);
      offset[index] = base * stretch;
      geometry.translate(...offset);
    }
    for (const handle of node.picker['translate']?.children ?? []) {
      const index = axisIndex[handle.name];
      const geometry = (handle as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (index === undefined || !geometry) continue;
      geometry.scale(...along(index, tipScale));
    }
    this._appliedArrow = want;
  }

  /**
   * THE ROTATION RINGS AT THE LOOK'S THICKNESS (`stage.gizmoRingWidth`). three's
   * rings are thin tori baked into geometry, so each vertex is carried away from the ring's
   * centre line by the ratio of the wanted thickness to the one already there; the ring's plane
   * is its thinnest extent, its radius the centre line's. The X, Y and Z rings only; pickers
   * keep three's own reach.
   */
  private _applyGizmoRings(): void {
    const want = this._gizmoLook.ringWidth ?? 1;
    if (want <= 0 || want === this._appliedRingWidth) return;
    const ratio = want / this._appliedRingWidth;
    const point = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    for (const controls of [this.transformControls, this._auxRotateControls]) {
      const node = controls
        .getHelper()
        .children.find(
          (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
        ) as unknown as { gizmo: Record<string, THREE.Object3D> } | undefined;
      for (const handle of node?.gizmo['rotate']?.children ?? []) {
        const geometry = (handle as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        // The axis rings only: the trackball circle and the view ring stay hairlines (Godot's
        // grey circle is one).
        if (!['X', 'Y', 'Z'].includes(handle.name)) continue;
        if (!geometry || (geometry as THREE.TorusGeometry).type !== 'TorusGeometry') continue;
        const radius = (geometry as THREE.TorusGeometry).parameters.radius;
        geometry.computeBoundingBox();
        geometry.boundingBox!.getSize(size);
        const normal = size.x <= size.y && size.x <= size.z ? 0 : size.y <= size.z ? 1 : 2;
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index++) {
          point.fromBufferAttribute(positions, index);
          centre.copy(point).setComponent(normal, 0);
          if (centre.lengthSq() === 0) continue;
          centre.setLength(radius);
          point.sub(centre).multiplyScalar(ratio).add(centre);
          positions.setXYZ(index, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
        geometry.computeBoundingSphere();
      }
    }
    this._appliedRingWidth = want;
  }

  private _patchGizmo(gizmoHelper: THREE.Object3D): void {
    const colorMap = this._axisColorMap();

    // Plane geometry offsets to bring inner corners to object center
    const planeOffsets: Record<string, [number, number, number]> = {
      XY: [-0.075, -0.075, 0],
      YZ: [0, -0.075, -0.075],
      XZ: [-0.075, 0, -0.075],
    };

    gizmoHelper.traverse((child) => {
      const mesh = child as THREE.Mesh;

      // Recolor handle materials
      const newColor = colorMap[child.name];
      if (newColor && mesh.material) {
        const mat = mesh.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
        if (mat.color) mat.color.copy(newColor);
      }

      // Shift plane handle geometry
      const offset = planeOffsets[child.name];
      if (offset && mesh.geometry) {
        mesh.geometry.translate(offset[0], offset[1], offset[2]);
      }
    });
  }

  /**
   * Combined-mode surgery on the aux SCALE gizmo. The stock scale handles
   * share their axis span with the translate arrows (cubes at ±0.5, picker
   * cones 0–0.6 — identical to translate's pickers), so with three
   * synchronized gizmos the translate picker always wins the pointer and
   * scale is undraggable (measured: dragging the X cube moved position).
   * Slide the axis cubes and their pickers outward past the arrow tips, and
   * drop the plane/uniform handles and axis lines whose footprint translate
   * already owns. Placement is baked into geometry by three's setupGizmo, so
   * geometry.translate is frame-safe where object transforms are not
   * (TransformControlsGizmo.updateMatrixWorld resets handle transforms every
   * frame). Single-mode scale (R) uses the primary gizmo and is untouched.
   */
  private _patchCombinedScaleGizmo(helper: THREE.Object3D): void {
    const AXIS_OFFSET = 0.55;
    const gizmoNode = helper.children.find(
      (child) => (child as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo,
    ) as unknown as
      | { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> }
      | undefined;
    if (!gizmoNode) return;
    const axisOf: Record<string, THREE.Vector3> = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
    // three places the cube's center 0.54 along its axis (a 0.08 box lifted
    // 0.04, positioned at 0.5); the picker becomes a box of just that cube,
    // not the stock 0.6-long cone, so the rings crossing an axis stay theirs.
    const CUBE_CENTER = 0.54 + AXIS_OFFSET;
    const PICKER_SIZE = 0.3;
    for (const [group, isPicker] of [
      [gizmoNode.gizmo['scale'], false],
      [gizmoNode.picker['scale'], true],
    ] as const) {
      if (!group) continue;
      for (const child of [...group.children]) {
        const mesh = child as THREE.Mesh;
        const axis = axisOf[child.name];
        const isAxisLine =
          axis !== undefined &&
          mesh.geometry?.type === 'CylinderGeometry' &&
          (mesh.geometry as THREE.CylinderGeometry).parameters.radiusTop < 0.05;
        if (axis === undefined || isAxisLine) {
          group.remove(child);
          continue;
        }
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        if (!bounds) continue;
        const sign = Math.sign(bounds.getCenter(new THREE.Vector3()).dot(axis)) || 1;
        if (isPicker) {
          const at = axis.clone().multiplyScalar(sign * CUBE_CENTER);
          mesh.geometry.dispose();
          mesh.geometry = new THREE.BoxGeometry(PICKER_SIZE, PICKER_SIZE, PICKER_SIZE).translate(
            at.x,
            at.y,
            at.z,
          );
          continue;
        }
        const shift = axis.clone().multiplyScalar(sign * AXIS_OFFSET);
        mesh.geometry.translate(shift.x, shift.y, shift.z);
      }
    }
  }

  /** Project entity center to screen coords. */
  private _projectToScreen(obj: THREE.Object3D): THREE.Vector2 {
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    pos.project(this._screenCamera);
    const rect = this._canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((pos.x + 1) / 2) * rect.width + rect.left,
      ((-pos.y + 1) / 2) * rect.height + rect.top,
    );
  }

  // -- Fly camera handlers --

  private static _FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

  private _enterFlyMode(): void {
    if (this._flyActive) return;
    if (this._cameraViewMode === 'view') return;
    this._flyActive = true;
    this._snapAnimating = false; // cancel any view snap
    this.orbitControls.enabled = false;
    // Sync euler from current camera orientation
    this._flyEuler.setFromQuaternion(this.renderCamera.quaternion, 'YXZ');
    this.orbitControls.dispatchEvent({ type: 'start' });
    this._canvas.requestPointerLock?.();
  }

  private _exitFlyMode(): void {
    if (!this._flyActive) return;
    this._flyActive = false;
    this._flyKeys.clear();
    this.orbitControls.enabled = this._cameraViewMode !== 'view';
    document.exitPointerLock();
    // Sync orbit target to a point in front of the camera
    const camera = this.renderCamera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const dist = camera.position.distanceTo(this.orbitControls.target);
    this.orbitControls.target.copy(camera.position).add(forward.multiplyScalar(Math.max(dist, 5)));
    this.orbitControls.dispatchEvent({ type: 'end' });
  }

  /** Apply fly camera movement each frame. Called from update(). */
  private _updateFlyCamera(dt: number): void {
    if (!this._flyActive || this._flyKeys.size === 0) return;

    const camera = this.renderCamera;
    const speed = this._flySpeed * (this._flyKeys.has('shift') ? 3 : 1);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const move = new THREE.Vector3();

    if (this._flyKeys.has('w')) move.add(forward);
    if (this._flyKeys.has('s')) move.sub(forward);
    if (this._flyKeys.has('d')) move.add(right);
    if (this._flyKeys.has('a')) move.sub(right);
    if (this._flyKeys.has('e')) move.y += 1;
    if (this._flyKeys.has('q')) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.add(move);
      this.orbitControls.dispatchEvent({ type: 'change' });
    }
  }

  private _onFlyKeyDown = (e: KeyboardEvent): void => {
    if (!this._rightMouseDown) return;
    // Skip when typing in form inputs
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    )
      return;

    const key = e.key.toLowerCase();
    if (key === 'shift') {
      this._flyKeys.add('shift');
      return;
    }
    if (!EditorViewport._FLY_KEYS.has(key)) return;
    e.preventDefault();
    e.stopPropagation();
    this._flyKeys.add(key);
    if (!this._flyActive) this._enterFlyMode();
  };

  private _onFlyKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (key === 'shift') {
      this._flyKeys.delete('shift');
      return;
    }
    this._flyKeys.delete(key);
  };

  private _onFlyPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) this._rightMouseDown = true;
  };

  private _onFlyPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      this._rightMouseDown = false;
      if (this._flyActive) this._exitFlyMode();
    }
  };

  private _onFlyPointerMove = (e: PointerEvent): void => {
    if (!this._flyActive) return;
    const sensitivity = 0.002;
    this._flyEuler.y -= e.movementX * sensitivity;
    this._flyEuler.x -= e.movementY * sensitivity;
    // Clamp pitch to avoid gimbal flip
    this._flyEuler.x = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this._flyEuler.x),
    );
    this.renderCamera.quaternion.setFromEuler(this._flyEuler);
    this.orbitControls.dispatchEvent({ type: 'change' });
  };

  private _onTrackpadWheel = (e: WheelEvent): void => {
    if (this._flyActive || !this.orbitControls.enabled) return;
    if (e.ctrlKey) return; // pinch — OrbitControls' zoom
    if (Math.abs(e.deltaX) < 0.5 && !e.shiftKey) return; // mouse wheel — zoom
    e.preventDefault();
    e.stopImmediatePropagation();
    const height = this._interactionElement.clientHeight || 1;
    const distance = this.camera.position.distanceTo(this.orbitControls.target);
    const worldPerPixel =
      (2 * Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * distance) / height;
    // Trackpads report fine per-frame pixel deltas; a mouse wheel NOTCH is
    // ±100+ px (or line-mode units), so unclamped Shift+wheel panned a third
    // of the viewport per click and flung a human tester off the map ("went
    // to the bottom, can't get out" — runhuman pass 17). Clamp each event to
    // a modest step; trackpad deltas sit far below the clamp and keep 1:1.
    const unit = e.deltaMode === 1 ? 16 : 1;
    const clampStep = (value: number): number =>
      Math.sign(value) * Math.min(Math.abs(value * unit), 30);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const shift = right
      .multiplyScalar(clampStep(e.deltaX) * worldPerPixel)
      .add(up.multiplyScalar(-clampStep(e.deltaY) * worldPerPixel));
    this.camera.position.add(shift);
    this.orbitControls.target.add(shift);
    this.orbitControls.update();
  };

  private _onFlyWheel = (e: WheelEvent): void => {
    if (!this._flyActive) return;
    e.preventDefault();
    // Scroll adjusts fly speed (multiplicative, Godot-style)
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    this._flySpeed = Math.max(0.5, Math.min(100, this._flySpeed * factor));
  };

  private _onPointerDown = (e: PointerEvent): void => {
    this._pointerDownPos.set(e.clientX, e.clientY);
    this._pointerDownButton = e.button;
    this._marqueeActive = false;
    this._pointerSessionActive = true;
    this._constraintControlPointerSession = false;

    if (e.button === 0 && !e.altKey) {
      if (this._selectConstraintControlAt(e)) return;
      const mesh = this._raycastSpatialHandle(e);
      const binding = mesh ? spatialHandleBinding(mesh) : null;
      if (mesh && binding?.handle.writable) {
        e.stopPropagation();
        this._activeSpatialHandle = binding;
        this._spatialHandleDragPoint.copy(mesh.position);
        this._orbitEnabledBeforeHandleDrag = this.orbitControls.enabled;
        this._transformEnabledBeforeHandleDrag = this.transformControls.enabled;
        this.orbitControls.enabled = false;
        for (const controls of this._allGizmos()) controls.enabled = false;
        const cameraDirection = this._screenCamera.getWorldDirection(new THREE.Vector3());
        this._spatialHandleDragPlane.setFromNormalAndCoplanarPoint(cameraDirection, mesh.position);
        this._spatialHandleDragOffset.set(0, 0, 0);
        const pointerPoint = this._spatialHandleWorldPoint(e);
        if (pointerPoint) this._spatialHandleDragOffset.subVectors(mesh.position, pointerPoint);
        this._canvas.style.cursor = 'grabbing';
      }
    }
  };

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._updateEditorHandleInteraction(e)) return;
    this._updateSpatialHandleHover(e);

    // Only a gesture that STARTED on the canvas may start/update a marquee —
    // this listener lives on the interaction element (see the binding comment
    // in the constructor), which also hears drags over overlay/toolbar
    // chrome; without this gate an overlay-owned left-drag would paint a
    // phantom viewport marquee from a STALE down-pos/button.
    if (!this._pointerSessionActive) return;

    // Only left button drag starts marquee (skip if Alt-orbiting)
    if (!(e.buttons & 1) || this._pointerDownButton !== 0) return;
    if (this._anyGizmoDragging()) return;
    if (this._altDragOrbit) return;

    const dx = e.clientX - this._pointerDownPos.x;
    const dy = e.clientY - this._pointerDownPos.y;
    if (!this._marqueeActive && Math.sqrt(dx * dx + dy * dy) > 5) {
      // Check we're not dragging from the viewcube area
      if (this._isOverViewCube(this._pointerDownPos.x, this._pointerDownPos.y)) return;

      this._marqueeActive = true;
      // Disable orbit controls while marquee is active
      this.orbitControls.enabled = false;

      if (!this._marqueeDiv) {
        this._marqueeDiv = document.createElement('div');
        // V-12 — was the string `'999'` (a stray string literal in an
        // otherwise-numeric z-index scale); now the canonical `zIndex.sticky`
        // token. Sticky chrome stays above the editor root while dropdowns
        // retain their distinct higher tier.
        Object.assign(this._marqueeDiv.style, {
          position: 'fixed',
          border: `1px solid ${themeVars.accent.default}`,
          background: themeVars.accent.muted,
          pointerEvents: 'none',
          zIndex: zIndex.sticky,
        });
        // INSIDE the theme scope, never document.body: the `--vgai-*` tokens
        // live on `#editor-chrome-root` (deliberately not `:root`), so a
        // body-parented div resolves both colors to nothing and the rubber
        // band is INVISIBLE — three human passes marqueed blind, reading the
        // selection count jump 4/0 and calling the tool broken (runhuman
        // 27–29). `position: fixed` keeps the client-coordinate math.
        (document.getElementById('editor-chrome-root') ?? document.body).appendChild(
          this._marqueeDiv,
        );
      }
    }

    if (this._marqueeActive && this._marqueeDiv) {
      const left = Math.min(this._pointerDownPos.x, e.clientX);
      const top = Math.min(this._pointerDownPos.y, e.clientY);
      const w = Math.abs(e.clientX - this._pointerDownPos.x);
      const h = Math.abs(e.clientY - this._pointerDownPos.y);
      Object.assign(this._marqueeDiv.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${w}px`,
        height: `${h}px`,
        display: 'block',
      });
    }
  };

  private _onPointerUp = (e: PointerEvent): void => {
    // Only complete gestures that STARTED on the canvas (`_onPointerDown`) —
    // this listener lives on the interaction element (see the binding comment
    // in the constructor), which also hears clicks on overlay chrome.
    if (!this._pointerSessionActive) return;
    this._pointerSessionActive = false;

    if (this._activeSpatialHandle) {
      this._finishSpatialHandleDrag(true);
      return;
    }

    if (this._constraintControlPointerSession) {
      this._constraintControlPointerSession = false;
      return;
    }

    // Handle marquee select. D12 (B4) scope note: marquee stays THREEJS-ONLY —
    // it only ever scans `this._objectMap` (the Three world's live
    // objects), never the composite's other (react/pixi) layered children. A
    // layered/rect-based marquee across every visible layer is out of scope
    // for this task (D12) — single-click picking is layered (below), marquee
    // is not.
    if (this._marqueeActive) {
      this._marqueeActive = false;
      this.orbitControls.enabled = true;
      if (this._marqueeDiv) {
        this._marqueeDiv.style.display = 'none';
      }

      // Find all entities whose screen projection falls within the marquee
      const left = Math.min(this._pointerDownPos.x, e.clientX);
      const right = Math.max(this._pointerDownPos.x, e.clientX);
      const top = Math.min(this._pointerDownPos.y, e.clientY);
      const bottom = Math.max(this._pointerDownPos.y, e.clientY);

      const hitIds: string[] = [];
      const corner = new THREE.Vector3();
      const bounds = new THREE.Box3();
      for (const [id, obj] of this._objectMap) {
        // Skip invisible entities — mirrors `raycastPick`'s single-click
        // behavior for free (THREE.Raycaster's own `intersectObject` already
        // stops descending into an `obj.visible === false` subtree, so a
        // single click can never land on one). Marquee did its own screen-
        // space rect test with no such check, so a world hidden via the
        // group-row eye (`world-hidden-viewport.ts` — forces `obj.visible =
        // false` for the whole world while hidden) stayed marquee-selectable
        // even though it was invisible and unclickable. Also correctly skips
        // an entity hidden via its OWN eye, for the same reason.
        if (!obj.visible) continue;
        // A CAMERA never joins a marquee. Its empty bounds fall to the
        // origin test, so a rectangle around scene content kept catching the
        // template's authored camera — and camera selection pops the live
        // preview overlay, which two consecutive human passes read as "it
        // instantly plays" and which then sat over the viewport blocking
        // their next drag (runhuman passes 27/28; play state was measured
        // stopped throughout). Click and hierarchy selection still reach it.
        if ((obj as THREE.Camera).isCamera === true) continue;
        // CONTAINMENT of the projected bounds, not origin-in-rect: every
        // environment fixture's ORIGIN (the ground plane, the sky dome, the
        // Environment group — all at scene center) landed inside any central
        // rectangle, so circling three boxes selected seven things and a
        // human tester gave up on marquee ("I still select more than what is
        // needed" — runhuman pass 25). A rectangle dragged AROUND something
        // selects what fits inside it; a fixture larger than the rectangle
        // cannot. Entities with no renderable bounds (lights, cameras,
        // empty groups) keep the origin test — circling a light selects it.
        bounds.setFromObject(obj);
        if (bounds.isEmpty()) {
          const screen = this._projectToScreen(obj);
          if (screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom) {
            hitIds.push(id);
          }
          continue;
        }
        // WHAT THE RECTANGLE MEANS IS THE LOOK'S TO SAY (`boxSelect`): the
        // editor's own answer is CONTAINMENT, and Blender's Select Box is
        // TOUCH — its object-mode box select reads the object-id buffer under
        // the rectangle, so any drawn part inside it selects the object. Both
        // are real answers and the field's own note carries why neither can be
        // the other's default. Measured 2026-09-21 on the Model document: a
        // rectangle holding the whole cube and cutting the torus selected the
        // cube alone, where Blender takes both.
        //
        // TOUCH is the projected bounding box INTERSECTING the rectangle,
        // which is a superset of Blender's drawn-pixel test — an honest
        // approximation, and the closest one available without a picking
        // buffer. It is stated rather than hidden: a long thin diagonal object
        // whose box crosses the rectangle while none of its pixels do is the
        // case where the two differ.
        const touch = this._stageBoxSelect === 'touch';
        const rect = this._canvas.getBoundingClientRect();
        // Through the camera on screen: an orthographic document view or a camera view draws with
        // its own, and a rectangle means what the person sees.
        const screenCamera = this._screenCamera;
        let inside = true;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
          corner.set(
            cornerIndex & 1 ? bounds.max.x : bounds.min.x,
            cornerIndex & 2 ? bounds.max.y : bounds.min.y,
            cornerIndex & 4 ? bounds.max.z : bounds.min.z,
          );
          corner.project(screenCamera);
          if (corner.z < -1 || corner.z > 1) {
            inside = false;
            if (!touch) break;
            continue;
          }
          const sx = rect.left + ((corner.x + 1) * rect.width) / 2;
          const sy = rect.top + ((1 - corner.y) * rect.height) / 2;
          if (sx < left || sx > right || sy < top || sy > bottom) inside = false;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
        const crosses =
          minX <= maxX && maxX >= left && minX <= right && maxY >= top && minY <= bottom;
        if (touch ? crosses : inside) hitIds.push(id);
      }

      if (e.shiftKey) {
        // Add to existing selection (additive modifier — SelectionProvider
        // extension is Phase-F; first-party store op for now).
        for (const id of hitIds) this._store.shell.addToSelection(id);
      } else {
        setAuthoringSelection(this._authoring(), hitIds);
      }
      return;
    }

    // Only left-click triggers selection (right-drag = orbit, not select)
    if (e.button !== 0) return;

    // Only treat as click if pointer didn't move much (not a drag)
    const dx = e.clientX - this._pointerDownPos.x;
    const dy = e.clientY - this._pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    // Don't interfere with gizmo clicks
    if (this._anyGizmoDragging()) return;

    // Check orientation gizmo click first (spec 28 — the cube isn't rendered
    // without a visible three surface, so it can't be clicked either)
    if (this._threejsToolContextActive && this._handleViewCubeClick(e)) return;

    // D12 (B4) — topmost-first layered pick: the composite's non-threejs
    // children (react/pixi design-time layers) are tried topmost-first before
    // falling through to the three raycast (now `VgaiSceneAuthoringAdapter
    // .pickable`) — see `pickTopmost`'s doc comment. Note: an INTERACTIVE
    // layer (session `interactive` toggle, B1) is mutually exclusive with this
    // walk running at all, by construction — its `pointer-events:auto` DOM
    // intercepts the event before it ever reaches this canvas listener, so
    // there is no special-case here for it.
    const deepSelection = e.shiftKey && (e.metaKey || e.ctrlKey);
    // Figma's outside-click rule: a click the open scope does not contain
    // LEAVES that scope, and empty space closes every level. The pick resolves
    // against the scope that WAS open, so `pickAcrossScopeExit` lets the stack
    // follow the hit and re-resolves once when it moved — without that, a
    // three-deep stack answered one level too shallow and took a second click
    // to land (`authoring/selection-scope.ts`).
    const entityId = pickAcrossScopeExit(this._scopeAuthoring(), () =>
      this._pickAt(e.clientX, e.clientY, deepSelection ? 'deep' : 'normal'),
    );

    if (deepSelection) {
      setAuthoringSelection(this._authoring(), entityId ? [entityId] : []);
    } else if (e.shiftKey && entityId) {
      // TOGGLE, not add. On a canvas this modifier is the ONE gesture for
      // "and also this / no, not that one" — Figma, Blender and Unity all
      // remove an already-selected object on a second shift-click, and adding
      // only meant a mis-click was unrecoverable: "if it's like 20 items and
      // you mess up one, you're gonna have to start all over" (runhuman pass
      // 94, their top finding). The Hierarchy keeps the LIST convention
      // instead — shift extends a RANGE there — because a row list has an
      // order for a range to mean something and a viewport does not.
      this._store.shell.toggleSelection(entityId);
    } else if ((e.metaKey || e.ctrlKey) && entityId) {
      this._store.shell.toggleSelection(entityId);
    } else {
      setAuthoringSelection(this._authoring(), entityId ? [entityId] : []);
    }
  };

  /**
   * The adapter a selection SCOPE is keyed on.
   *
   * `authoring/selection-scope.ts` keys its stack by adapter IDENTITY, and the
   * Hierarchy — its breadcrumb, and its own double-click scope entry — resolves
   * the PANEL adapter (`authoring/panel-authoring.ts`), which for a Scene
   * document is the composite's Three child, not the composite itself.
   * A scope opened against a different object of the same tree is invisible
   * there (measured: a viewport drill-in selected the deeper member correctly
   * and the breadcrumb never appeared). One resolution, so the viewport gesture
   * and the panel are talking about the same scope.
   *
   * A host that INJECTED its own adapter (the Object3D document's own viewport)
   * is not driving the shared panels at all and keeps its own.
   */
  private _scopeAuthoring(): AuthoringAdapter {
    return this._standaloneAuthoring
      ? this._authoring()
      : viewportAuthoringPolicy().panelAuthoring(this._store.shell);
  }

  /** ONE pick expression for every viewport gesture: the injected `pick`
   *  override when a host supplied one, else the layered walk. */
  private _pickAt(clientX: number, clientY: number, intent: 'normal' | 'deep'): string | null {
    return this._pick
      ? this._pick(clientX, clientY)
      : viewportAuthoringPolicy().pick(this._store.shell, clientX, clientY, intent);
  }

  /**
   * Double-click = DRILL IN — the viewport's way INTO a component instance.
   *
   * A single click resolves to the OUTERMOST component boundary under the
   * pointer (`SelectionProvider.resolve`), which is why a whole arena selects
   * as one instance no matter where you click it. That is Figma's instance
   * semantics and it is correct; what was missing was the way in. Double-click
   * opens that instance's scope (`enterSelectionScope`) and selects the next
   * member down the same owner chain — repeat to keep descending, Escape
   * (`editor-hotkeys.ts`) walks back out, and a click outside the open scope
   * leaves it (`_onPointerUp`).
   *
   * The deeper member is not computed here: `layered-pick.ts` already hands
   * `currentSelectionScopeId()` to the adapter's own resolve, so re-running the
   * ORDINARY pick with the scope open is what answers. No second chain rule,
   * nothing per-surface, no new state.
   *
   * The two single-clicks that precede this both select that same outermost
   * boundary, so they cannot conflict with the drill — they are the step it
   * starts from.
   */
  private _onDoubleClick = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    // Same gesture guards as the click path: never fight the gizmo or a
    // marquee drag.
    if (this._anyGizmoDragging()) return;
    if (this._marqueeActive) return;
    // The orientation cube is chrome, not geometry: the single-click path
    // consumes a click on it (and snaps the camera), so a double click must
    // not drill into whatever happens to sit behind it. The hit test only —
    // the two clicks that preceded this already did the snapping.
    if (this._threejsToolContextActive && this._isOverViewCube(e.clientX, e.clientY)) return;
    const boundaryId = this._pickAt(e.clientX, e.clientY, 'normal');
    if (!boundaryId) return;
    drillIntoSelectionScope(this._scopeAuthoring(), boundaryId, () =>
      this._pickAt(e.clientX, e.clientY, 'normal'),
    );
  };

  // --- Asset drag-and-drop onto viewport ---

  /**
   * Screen → world point for the path-probe tool (W1a): prefer a hit on the
   * baked navmesh overlay (guarantees a point on the mesh), fall back to the
   * ground plane so probing still lands a marker pre-bake.
   */
  /**
   * Raycast from screen coordinates to the DECLARED ground plane. Returns world
   * position or null.
   */
  private _raycastGroundPlane(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const rect = this._canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this._screenCamera);
    const basis = presentationRegionBasis('three');
    this._groundPlane.set(
      basis.up === 'z' ? UP_Z : UP_Y,
      // `Plane.constant` is the SIGNED distance from the origin along -normal,
      // so a ground at `h` is `-h` here.
      -basis.groundHeight,
    );
    const target = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this._groundPlane, target);
    return hit;
  }

  private _showDropOverlay(): void {
    if (this._dropOverlay) return;
    const overlay = document.createElement('div');
    // V-12 — the stray string `'5'` (below every named tier in the z-index
    // scale) becomes the numeric `zIndex.base`, the lowest defined tier,
    // preserving its relative order (still below the marquee's `zIndex.
    // sticky` and every dropdown/menu). The semantic accent tokens reconcile this
    // block's former one-off blue onto the canonical palette accent tint per
    // the audit's own §3 absorption list.
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      border: `2px dashed ${themeVars.accent.default}`,
      background: themeVars.accent.muted,
      zIndex: zIndex.base,
    });
    // Same class as the marquee band: `--vgai-*` resolves only under
    // `#editor-chrome-root`, so a body-parented overlay draws with NO border
    // or fill — the drag-to-viewport highlight has been invisible.
    (document.getElementById('editor-chrome-root') ?? document.body).appendChild(overlay);
    this._dropOverlay = overlay;
  }

  private _hideDropOverlay(): void {
    if (this._dropOverlay) {
      this._dropOverlay.remove();
      this._dropOverlay = null;
    }
  }

  private _onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types.includes('application/x-editor-asset')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this._showDropOverlay();
  };

  private _onDragLeave = (_e: DragEvent): void => {
    this._hideDropOverlay();
  };

  private _onDrop = (e: DragEvent): void => {
    this._hideDropOverlay();
    const raw = e.dataTransfer?.getData('application/x-editor-asset');
    if (!raw) return;
    e.preventDefault();

    let data: {
      path: string;
      kind: string;
      name: string;
      component?: AssetDropContext['item'];
      online?: OnlineAssetDrop;
    };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // Find drop position via ground-plane raycast, fallback to the ground's own
    // origin. The two in-plane components are rounded to centimetres; the UP
    // component is pinned to the DECLARED ground height rather than to a
    // hardcoded 0 — which axis that is comes from the region's basis, not from
    // an assumption that every game is Y-up.
    const basis = presentationRegionBasis('three');
    const worldPos = this._raycastGroundPlane(e);
    const cm = (value: number): number => Math.round(value * 100) / 100;
    const pos: [number, number, number] =
      basis.up === 'z'
        ? [cm(worldPos?.x ?? 0), cm(worldPos?.y ?? 0), basis.groundHeight]
        : [cm(worldPos?.x ?? 0), basis.groundHeight, cm(worldPos?.z ?? 0)];

    // A viewport drop is an AUTHORING op, so it goes through the active
    // adapter's `assetDrop` provider — not straight into the first-party
    // document. An adapter that declares no `assetDrop` (for example a LIVE
    // adopted play scene) accepts nothing: dropping into it used to mutate the
    // retired descriptor document of a world that was not even on screen.
    // Absent ⇒ nothing happens, which is the honest degrade.
    const authoring = this._authoring();
    const assetDrop = authoring.assetDrop;
    const item: AssetDropContext['item'] = data.component ?? {
      kind: 'file',
      name: data.name,
    };
    // A refused drop SAYS so: the silent degrade read as "drag and drop is
    // not working" to a human who tried it both ways (runhuman pass 45).
    if (!assetDrop) {
      editorConsole.warn(
        `Dropped “${data.name}” was not placed: this document does not accept dropped assets.`,
        'editor',
      );
      return;
    }

    // Online asset: the SHELL's resolver turns it into a project-local path
    // (cache, file list, download, history — see `OnlineAssetResolver`), then
    // it takes the same adapter drop path a local asset takes.
    //
    // The shell owns no document, so there is nothing to place a progress
    // placeholder INTO: the resolve settles silently and a failure is reported
    // to the console.
    if (data.online) {
      const online = data.online;
      const resolveOnline = this._onlineAssetResolver;
      // Same rule as a missing `assetDrop` above: a refused drop SAYS so,
      // naming the missing collaborator rather than swallowing the gesture.
      if (!resolveOnline) {
        editorConsole.warn(
          `Dropped “${data.name}” was not placed: this viewport has no online-asset resolver installed.`,
          'editor',
        );
        return;
      }
      // The download takes seconds and used to be silent: "it does not
      // seem to be adding… oh, that took some time, but it did happen"
      // (runhuman pass 136). Say it where the hand is — a cached asset
      // answers at once and the two hints simply follow each other.
      showTransientHint(`Downloading ${online.name} from the library…`);
      resolveOnline(online)
        .then((path) => {
          // `null` = the resolver already reported why on the console.
          if (path) {
            showTransientHint(`${online.name} downloaded — placing it.`);
            void dropAuthoringAsset(authoring, '', path, { position: pos });
          } else {
            showTransientHint(`Could not download ${online.name} — see the Console.`);
          }
        })
        // Browser mode (no Node dev server) throws instead of resolving —
        // the one failure nobody else reported, and no unhandled rejection.
        .catch(() => {
          showTransientHint(`Could not download ${online.name} — see the Console.`);
          editorConsole.error(`Could not download ${online.name}.`, 'asset');
        });
      return;
    }

    // Model / image / audio / component: the adapter owns what an asset path
    // MEANS in its world, and its `drop` plans the same answer `accepts` would
    // — but when it refuses it SAYS WHY (transient hint + console), which a
    // boolean pre-check never could. The viewport contributes only the world
    // point under the cursor.
    void dropAuthoringAsset(authoring, '', data.path, { position: pos, item });
  };
}
