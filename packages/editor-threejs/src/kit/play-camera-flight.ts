/**
 * THE PLAY ENTRY CAMERA FLIGHT — the Three integration's half of Play's immersive entry
 * (`@volter/editor-sdk/kit/play-camera-flight`). The kit's transition owns the phases and the
 * chrome; this owns the camera: the editor viewport flies along a Catmull-Rom spline from its
 * preview pose to the AUTHORED game camera's pose, retargets to the game's live camera once it
 * boots so the cross-fade is pixel-continuous, and restores the preview pose when Play ends. The
 * flight reads the authored viewport's rig through the viewport door and rides its frame hook, so
 * flight pacing rides the editor's own frame clock.
 */
import { registerPlayCameraFlight, type LiveCameraLookup } from '@volter/editor-sdk/kit/play-camera-flight';
import { onViewportFrame, viewportRig } from '@volter/editor-sdk/kit/viewport-door';
import * as THREE from 'three';
import { threeStoreForHost } from './three-state';

/** Flight time scales mildly with distance so short hops feel snappy and
 *  cross-scene flights stay graceful, clamped to a tight band. */
export function flightDurationMs(distance: number): number {
  return Math.min(1600, Math.max(800, 900 + distance * 25));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Control points for the camera flight spline: start, two interior points
 * forming a gentle arc, end. The arc lifts along world-up and bows slightly
 * sideways, both proportional to (but clamped against) the travel distance —
 * a short hop barely arcs, a long flight gets a visible swoop, and a
 * degenerate zero-length flight returns a straight (stationary) curve.
 */
export function computeFlightControlPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  up: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): THREE.Vector3[] {
  const travel = new THREE.Vector3().subVectors(end, start);
  const distance = travel.length();
  if (distance < 1e-6) {
    return [start.clone(), start.clone(), end.clone(), end.clone()];
  }
  const lift = Math.min(distance * 0.18, 6);
  // Side bias perpendicular to travel and up — gives the arc a slight bank
  // instead of a purely vertical hump. Falls back to zero when travel is
  // parallel to up (straight vertical flights just lift).
  const side = new THREE.Vector3().crossVectors(travel, up);
  if (side.lengthSq() > 1e-9) side.normalize().multiplyScalar(Math.min(distance * 0.08, 2.5));
  else side.set(0, 0, 0);
  const liftVec = up.clone().normalize().multiplyScalar(lift);
  const p1 = start.clone().addScaledVector(travel, 0.3).add(liftVec).add(side);
  const p2 = end
    .clone()
    .addScaledVector(travel, -0.3)
    .addScaledVector(liftVec, 0.6)
    .addScaledVector(side, 0.5);
  return [start.clone(), p1, p2, end.clone()];
}

/** The narrow store surface `resolveAuthoredCameraTarget` reads. */
export interface PlayCameraSourceStore {
  readonly objectMap: ReadonlyMap<string, THREE.Object3D>;
}

export interface AuthoredCameraTarget {
  entityId: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
}

/** Editor-only overlays (helpers, gizmos) live on layer 31 — never flight targets. */
const EDITOR_ONLY_LAYER_MASK = 1 << 31;

function isEditorOnlyOrGizmo(obj: THREE.Object3D): boolean {
  return (obj.layers.mask & EDITOR_ONLY_LAYER_MASK) !== 0 || /gizmo/i.test(obj.name);
}

/** Depth-first search for the first real camera in a subtree, skipping
 *  editor-only/gizmo branches wholesale. */
function findCameraInSubtree(obj: THREE.Object3D): THREE.Camera | null {
  if (isEditorOnlyOrGizmo(obj)) return null;
  if ((obj as Partial<THREE.Camera>).isCamera) return obj as THREE.Camera;
  for (const child of obj.children) {
    const found = findCameraInSubtree(child);
    if (found) return found;
  }
  return null;
}

function targetFromObject(
  entityId: string,
  obj: THREE.Object3D,
  fov: number,
): AuthoredCameraTarget {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  obj.getWorldPosition(position);
  obj.getWorldQuaternion(quaternion);
  return {
    entityId,
    position: position.toArray() as [number, number, number],
    quaternion: quaternion.toArray() as [number, number, number, number],
    fov,
  };
}

/**
 * Find the authored game camera in the CURRENT (pre-play) editor scene.
 *
 * A world's source IS its document, so there is no descriptor to read a
 * declared camera out of: the design session adopts the mounted fiber scene
 * into the store, which makes the authored camera (e.g. drei
 * `<PerspectiveCamera makeDefault>`) a live `THREE.Camera` in the mapped
 * object graphs. Take the first one outside editor-only (layer-31) and gizmo
 * branches, at its live world transform.
 *
 * `null` when no camera is found — play then keeps today's behavior (game
 * starts at the preview pose, no flight).
 */
export function resolveAuthoredCameraTarget(
  store: PlayCameraSourceStore,
): AuthoredCameraTarget | null {
  for (const [id, obj] of store.objectMap) {
    const camera = findCameraInSubtree(obj);
    if (!camera) continue;
    const perspective = camera as Partial<THREE.PerspectiveCamera>;
    return targetFromObject(id, camera, perspective.isPerspectiveCamera ? perspective.fov! : 60);
  }
  return null;
}

interface FlightRuntime {
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  startFov: number;
  endPos: THREE.Vector3;
  endQuat: THREE.Quaternion;
  endFov: number;
  curve: THREE.CatmullRomCurve3;
  startedAt: number;
  durationMs: number;
  landed: boolean;
}

function rebuildCurve(flight: FlightRuntime): void {
  flight.curve = new THREE.CatmullRomCurve3(
    computeFlightControlPoints(flight.startPos, flight.endPos),
  );
}

interface ActiveFlight {
  readonly runtime: FlightRuntime;
  readonly snapshot: { position: THREE.Vector3; target: THREE.Vector3; fov: number };
  readonly onLanded: () => void;
  /** Live game camera, registered at game-ready — the flight retargets to it
   *  each frame so the hand-off converges on whatever the game actually does
   *  with its camera during boot (follow rigs, SceneCamera components…). */
  getLiveCamera: LiveCameraLookup | null;
  /** Driving the camera: from `begin` until the game is on screen (`settle`) or Play ends. */
  driving: boolean;
}

let _flight: ActiveFlight | null = null;

function begin(onLanded: () => void): boolean {
  const viewport = viewportRig();
  const objects = threeStoreForHost()?.objectMap;
  const target = objects ? resolveAuthoredCameraTarget({ objectMap: objects }) : null;
  if (!target || !viewport) return false;
  const startPos = viewport.camera.position.clone();
  const endPos = new THREE.Vector3().fromArray(target.position);
  _flight = {
    runtime: {
      startPos,
      startQuat: viewport.camera.quaternion.clone(),
      startFov: viewport.camera.fov,
      endPos,
      endQuat: new THREE.Quaternion().fromArray(target.quaternion),
      endFov: target.fov,
      curve: new THREE.CatmullRomCurve3(computeFlightControlPoints(startPos, endPos)),
      startedAt: performance.now(),
      durationMs: flightDurationMs(startPos.distanceTo(endPos)),
      landed: false,
    },
    snapshot: {
      position: viewport.camera.position.clone(),
      target: viewport.orbit.target.clone(),
      fov: viewport.camera.fov,
    },
    onLanded,
    getLiveCamera: null,
    driving: true,
  };
  viewport.orbit.enabled = false;
  return true;
}

/** After the flight, leave OrbitControls in a sane state at the landed pose
 *  so a `set-viewport-tab scene` during play still orbits correctly. */
function settle(): void {
  const viewport = viewportRig();
  const active = _flight;
  if (!active) return;
  active.driving = false;
  if (!viewport) return;
  const camera = viewport.camera;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const distance = Math.max(1, active.snapshot.position.distanceTo(active.snapshot.target));
  viewport.orbit.target.copy(camera.position).addScaledVector(forward, distance);
  viewport.orbit.enabled = true;
}

/** Restore the pre-play camera pose. */
function end(): void {
  const active = _flight;
  if (!active) return;
  _flight = null;
  const viewport = viewportRig();
  if (!viewport) return;
  const snap = active.snapshot;
  viewport.camera.position.copy(snap.position);
  viewport.orbit.target.copy(snap.target);
  viewport.camera.lookAt(snap.target);
  if (viewport.camera.fov !== snap.fov) {
    viewport.camera.fov = snap.fov;
    viewport.camera.updateProjectionMatrix();
  }
  viewport.orbit.enabled = true;
  viewport.orbit.update();
}

const _liveCamPos = new THREE.Vector3();
const _liveCamQuat = new THREE.Quaternion();

/**
 * Per-frame flight driver — called from the world root's stage's RAF loop right after
 * `viewport.update(dt)` so the flight has final say over the camera pose.
 */
onViewportFrame(playTransitionFrame);

function playTransitionFrame(): void {
  const active = _flight;
  const viewport = viewportRig();
  if (!active || !viewport || !active.driving) return;
  const flight = active.runtime;

  // Retarget to the live game camera once it exists (`track`).
  const liveCamera = active.getLiveCamera?.() ?? null;
  if (liveCamera) {
    liveCamera.getWorldPosition(_liveCamPos);
    liveCamera.getWorldQuaternion(_liveCamQuat);
    if (_liveCamPos.distanceToSquared(flight.endPos) > 1e-8) {
      flight.endPos.copy(_liveCamPos);
      rebuildCurve(flight);
    }
    flight.endQuat.copy(_liveCamQuat);
    const liveFov = (liveCamera as THREE.PerspectiveCamera).fov;
    if (typeof liveFov === 'number') flight.endFov = liveFov;
  }

  const camera = viewport.camera;
  if (flight.landed) {
    // Holding/cross-fading: pin to the (possibly live-tracked) end pose.
    camera.position.copy(flight.endPos);
    camera.quaternion.copy(flight.endQuat);
    if (camera.fov !== flight.endFov) {
      camera.fov = flight.endFov;
      camera.updateProjectionMatrix();
    }
    return;
  }

  const t = Math.min(1, (performance.now() - flight.startedAt) / flight.durationMs);
  const eased = easeInOutCubic(t);
  camera.position.copy(flight.curve.getPoint(eased));
  camera.quaternion.slerpQuaternions(flight.startQuat, flight.endQuat, eased);
  camera.fov = flight.startFov + (flight.endFov - flight.startFov) * eased;
  camera.updateProjectionMatrix();
  if (t >= 1) {
    flight.landed = true;
    active.onLanded();
  }
}

export function registerThreePlayCameraFlight(): () => void {
  return registerPlayCameraFlight({
    begin,
    track: (liveCamera) => {
      if (_flight) _flight.getLiveCamera = liveCamera;
    },
    settle,
    end,
  });
}
