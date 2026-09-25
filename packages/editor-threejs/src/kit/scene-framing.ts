/**
 * What the editor camera should look at when it adopts a world nobody authored
 * here — the two answers behind `EditorViewport.focusOnScene`.
 *
 * ## The measured defect
 *
 * Auto-frame framed the game's ENTIRE content AABB. Measured on a Cuberun
 * mount: a 2,000-radius BackSide skybox sphere, a sun mesh at `z = -2000` and a
 * hyperspace prop at `z ≈ -5365` stretched that AABB to ~8,400 units deep, so
 * the fit distance landed the camera 12,870 units away from a ~1,000-unit
 * gameplay corridor. 93% of the Scene viewport was black, and the one visible
 * thing was the OUTSIDE of the skybox. The same world framed at working
 * distance is vivid and correct. (Descent measured the same looseness at a
 * smaller scale: a camera at ~2,580 for an ~800-unit world.)
 *
 * The union is the wrong instrument because a backdrop is not content the
 * reader is looking FOR — it is content that exists to be far away. One prop
 * 5,000 units out costs the whole framing, and no amount of care in the fit
 * math can recover it.
 *
 * ## The two answers, in order
 *
 * 1. {@link viewFromGameCamera} — a game's author already decided the
 *    interesting view, so seeding the orbit camera from the world matrix of a
 *    camera the game itself placed opens the Scene tab where the game looks.
 *    {@link pickGameCamera} decides which camera that is.
 * 2. {@link frameableContentBounds} — the fallback for a game whose camera we
 *    cannot name. It trims outliers off the union before framing.
 *
 * ## Why gap-trimming and not a percentile
 *
 * A blanket percentile (frame the inner 90% of content) would tighten the
 * framing of EVERY world, including the uniform ones that are framed correctly
 * today. This trims only across a spatial GAP: a face of the bounding box moves
 * inward only when a small share of boxes sits beyond a void spanning a large
 * fraction of the current diagonal. A uniformly-filled world has no such gap,
 * so it comes back byte-identical to the plain union — that identity is the
 * first property the tests pin.
 */

import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import * as THREE from 'three';

/** Tuning for {@link frameableContentBounds}. Defaults are the shipped values. */
export interface FrameableBoundsOptions {
  /** Largest share of the boxes all trimming together may discard. */
  maxOutlierFraction?: number;
  /** A gap must span this share of the current content diagonal to be a gap. */
  minGapFraction?: number;
  /** Below this many boxes there is no distribution to judge; nothing trims. */
  minSampleSize?: number;
  /** Cap on trim passes, so cost stays bounded on a huge world. */
  maxPasses?: number;
}

const DEFAULTS: Required<FrameableBoundsOptions> = {
  maxOutlierFraction: 0.1,
  minGapFraction: 0.2,
  minSampleSize: 8,
  maxPasses: 8,
};

/** Orbit pivot distance when there is no content to measure one from. */
const EMPTY_CONTENT_PIVOT_DISTANCE = 10;

/** How far down the view axis the content must start for the pivot to mean
 *  anything — as a share of the content's own radius. */
const MIN_PIVOT_RADIUS_FRACTION = 0.01;

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

function unionOf(boxes: readonly THREE.Box3[], indices: Iterable<number>): THREE.Box3 {
  const out = new THREE.Box3();
  for (const i of indices) out.union(boxes[i] as THREE.Box3);
  return out;
}

/** One candidate trim: the boxes beyond the widest gap on one box face. */
interface GapCut {
  gap: number;
  discard: number[];
}

/**
 * The widest gap found scanning inward from any of the six faces, across at
 * most `budget` boxes.
 *
 * Scanning from a FACE (rather than clustering centers) is what catches a
 * skybox: its centre sits with the content, and only its extent is an outlier.
 */
function widestOuterGap(
  boxes: readonly THREE.Box3[],
  kept: ReadonlySet<number>,
  budget: number,
): GapCut | null {
  let best: GapCut | null = null;
  for (const axis of AXES) {
    for (const side of ['min', 'max'] as const) {
      const values: Array<{ i: number; v: number }> = [];
      for (const i of kept) values.push({ i, v: (boxes[i] as THREE.Box3)[side][axis] });
      // Outliers are the smallest values on a min face and the largest on a max
      // face; sort so index 0 is always the outermost.
      values.sort((a, b) => (side === 'min' ? a.v - b.v : b.v - a.v));
      const reach = Math.min(budget, values.length - 1);
      for (let k = 0; k < reach; k++) {
        const gap = Math.abs((values[k + 1] as { v: number }).v - (values[k] as { v: number }).v);
        if (best && gap <= best.gap) continue;
        best = { gap, discard: values.slice(0, k + 1).map((e) => e.i) };
      }
    }
  }
  return best;
}

/**
 * The box worth FRAMING, given one world-space box per content node.
 *
 * Returns the plain union whenever there is nothing defensible to trim: too few
 * boxes to judge, no gap wide enough, or a budget of zero. Never returns an
 * empty box for non-empty input.
 */
export function frameableContentBounds(
  boxes: readonly THREE.Box3[],
  options: FrameableBoundsOptions = {},
): THREE.Box3 {
  const opts = { ...DEFAULTS, ...options };
  const content = boxes.filter((b) => !b.isEmpty());
  const all = content.map((_, i) => i);
  const full = unionOf(content, all);
  if (content.length < opts.minSampleSize) return full;

  let budget = Math.floor(content.length * opts.maxOutlierFraction);
  if (budget < 1) return full;

  const kept = new Set(all);
  let bounds = full;
  const size = new THREE.Vector3();
  for (let pass = 0; pass < opts.maxPasses && budget > 0; pass++) {
    const diagonal = bounds.getSize(size).length();
    if (!(diagonal > 0)) break;
    const cut = widestOuterGap(content, kept, budget);
    if (!cut || cut.gap <= opts.minGapFraction * diagonal) break;
    for (const i of cut.discard) kept.delete(i);
    budget -= cut.discard.length;
    bounds = unionOf(content, kept);
  }
  return bounds.isEmpty() ? full : bounds;
}

/** An orbit-camera pose: where the eye sits and what it orbits around. */
export interface SeededView {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * The editor orbit pose that reproduces `camera`'s own view.
 *
 * The eye is the game camera's world position and the view direction is its
 * own; the only thing invented is the orbit PIVOT, which is placed at the depth
 * of the content along that view direction — the point the reader is already
 * looking at, so the first orbit drag turns around the world rather than
 * around a point behind their head.
 *
 * Returns `null` when that pivot cannot be placed: the world sits BEHIND the
 * camera (a view showing none of the game is not worth adopting), or it sits
 * ON it, which leaves an orbit pivot at the eye — measured as a target
 * 4.6e-14 units out, an orbit control that can only spin in place. Both fall
 * back to {@link frameableContentBounds}.
 */
export function viewFromGameCamera(camera: THREE.Camera, content: THREE.Box3): SeededView | null {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  if (!Number.isFinite(position.lengthSq()) || forward.lengthSq() === 0) return null;
  if (content.isEmpty()) {
    return {
      position,
      target: position.clone().addScaledVector(forward, EMPTY_CONTENT_PIVOT_DISTANCE),
    };
  }
  const sphere = content.getBoundingSphere(new THREE.Sphere());
  const along = sphere.center.clone().sub(position).dot(forward);
  if (!(along > sphere.radius * MIN_PIVOT_RADIUS_FRACTION)) return null;
  return { position, target: position.clone().addScaledVector(forward, along) };
}

/**
 * The NDC points a seeded view is sampled at: the centre plus a ring at 60% of
 * the way to each edge/corner. Nine rays — enough that a view whose middle is
 * blocked by one prop still reads as open, cheap enough to run on every seed
 * attempt over a whole game graph.
 */
const OCCLUSION_SAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-0.6, 0.6],
  [0.6, 0.6],
  [-0.6, -0.6],
  [0.6, -0.6],
  [0, 0.6],
  [0, -0.6],
  [-0.6, 0],
  [0.6, 0],
];

/**
 * How near a hit has to be, as a share of the view's own pivot distance, to
 * count as "pressed against the lens" rather than "part of the world". At 2%,
 * a camera looking 100 units into a world is blocked only by something inside
 * 2 units of it.
 */
const NEAR_FIELD_FRACTION = 0.02;

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/** Three's raycast reports hits on invisible objects; a hidden collider proxy
 *  in front of the lens blocks nothing a reader would see. */
function isVisibleInWorld(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/**
 * Does a view posed HERE show the world, or a surface pressed against the lens?
 *
 * The measured defect: a game's own camera is placed for the game's own moment
 * — inside a cockpit, behind a wall it is about to drive through, under
 * terrain that has not settled — and adopting it as the editor's opening view
 * can hand the reader a full-bleed rectangle of rock. The view is a perfectly
 * good gameplay camera and a useless first look, and nothing in the pose
 * itself says which.
 *
 * The instrument is geometric, not pixels: nine rays through the frustum, and
 * a view SHOWS THE WORLD when at least one of them either escapes (sky,
 * backdrop, open space) or reaches something farther than
 * {@link NEAR_FIELD_FRACTION} of what this view claims to be looking at. The
 * threshold is relative to the view's own pivot distance, so it needs no
 * world-scale constant and reads the same on a 10-unit room and a 10,000-unit
 * canyon.
 *
 * Deliberately conservative: EVERY sample must be blocked in the near field
 * before the view is refused, so an ordinary view with a prop in the middle or
 * ground filling its lower half still passes. A refusal here costs the reader
 * only the game's own camera — the caller falls back to
 * {@link frameableContentBounds}, which always shows something.
 *
 * Three's raycast honours `material.side` exactly as the renderer does, and
 * that alignment is the reason this instrument is honest rather than merely
 * cheap: a camera sealed inside a front-faced solid is invisible to BOTH — the
 * reader sees through the shell, the rays escape through it, and the view is
 * correctly not called blocked. The failure this catches is the one that is
 * actually on screen: front faces, filling the frame, right at the lens.
 *
 * (The screenshot lane measures the same failure from the other side, on
 * PIXELS, in `composite-screenshot.ts`. That instrument needs a drawn frame
 * and a GPU readback, and it cannot tell a legitimately flat picture from a
 * blocked one — which is why the decision to adopt a pose is made here, before
 * anything is drawn.)
 */
export function seededViewShowsWorld(
  camera: THREE.Camera,
  content: readonly THREE.Object3D[],
  pivotDistance: number,
): boolean {
  if (!(pivotDistance > 0) || content.length === 0) return true;
  const nearField = pivotDistance * NEAR_FIELD_FRACTION;
  for (const [x, y] of OCCLUSION_SAMPLES) {
    _ndc.set(x, y);
    _raycaster.setFromCamera(_ndc, camera);
    const hits = _raycaster.intersectObjects(content as THREE.Object3D[], true);
    const blocker = hits.find((hit) => isVisibleInWorld(hit.object));
    if (!blocker || blocker.distance > nearField) return true;
  }
  return false;
}

/** Every camera in the game's own scene, in scene order, editor furniture and
 *  its subtrees excluded. */
function gameCameras(node: THREE.Object3D, out: THREE.Camera[] = []): THREE.Camera[] {
  if (isEditorOwnedObject(node)) return out;
  if ((node as THREE.Camera).isCamera) out.push(node as THREE.Camera);
  for (const child of node.children) gameCameras(child, out);
  return out;
}

/**
 * The camera whose view an ingest mount should adopt — one the game itself
 * CREATED AND PLACED, which means one that is in the game's own scene graph.
 *
 * The capture's own camera (the one the first `render(scene, camera)` used) is
 * preferred WHEN it is one of those, and is otherwise ignored, because on the
 * first rendered frame it can be a reconciler's placeholder rather than the
 * author's camera. Measured on Cuberun: the captured camera came back with an
 * identity world matrix at the origin while the game's own
 * `<PerspectiveCamera position={[0, 10, -10]}>` was sitting in the scene at
 * (0, 8, 3.5) looking down the corridor — seeding from the capture opened on a
 * flat wall of ground plane, seeding from the scene's camera opened on the
 * game.
 *
 * Editor furniture is never adopted: the capture trap sits on the shared
 * `WebGLRenderer.prototype`, so the editor's own cameras are the one thing
 * that must never come back from here.
 */
export function pickGameCamera(
  captured: THREE.Camera | null | undefined,
  scene: THREE.Object3D,
): THREE.Camera | null {
  const cameras = gameCameras(scene);
  if (cameras.length === 0) return null;
  if (captured && cameras.includes(captured)) return captured;
  return cameras[0] as THREE.Camera;
}
