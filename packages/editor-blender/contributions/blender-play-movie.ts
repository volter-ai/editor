/**
 * THE SCENE'S MOVIE IN A GAME: what Blender's own playback shows — every object's own animation
 * and the camera cuts at the Timeline's markers — evaluated on the game's copy of the model, at a
 * scene frame the game's clock chooses (a cutscene, `@volter/play`'s `play.cutscene`).
 *
 * - AN OBJECT'S TRANSFORM is its stack as `BKE_animsys_evaluate_animdata` evaluates it: its NLA
 *   tracks bottom to top, then its active action over them, each F-Curve whole (`blender-pose.ts`,
 *   the evaluator a bone uses), blended into its own channels. The channels make its basis as
 *   `BKE_object_to_mat4` does (location plus delta, the delta rotation after the rotation, scale
 *   times delta scale), placed in its parent's space by `matrix_parent_inverse`
 *   (`BKE_object_get_parent_matrix` for an object parent), then its Damped Track and Track To
 *   constraints (`damptrack_do_transform`, `trackto_evaluate` / `vectomat`) at their influence.
 *   Any other constraint, a driver, or a parent that is a bone or a vertex is named, not played.
 * - A CAMERA'S PROJECTION is its data's: lens, sensor and fit, orthographic scale, shift and clip
 *   range, each keyed or not, through its data's own stack.
 * - THE CAMERA AT A FRAME is `BKE_scene_camera_switch_find`'s: the camera of the last marker at
 *   or before the frame that is bound to one (and not disabled in renders), else the earliest
 *   such marker's, else the scene's camera.
 *
 * Inside the copy's root the coordinates are Blender's (Z up); the root carries the turn to the
 * stage's Y up. So an object's local matrix is written exactly as Blender composes it, and a
 * camera is looked through from its world matrix, which three and Blender both read as looking
 * down its own -Z with +Y up.
 *
 * LICENCE. This file follows Blender's source (the functions named above), so it is a derivative
 * work of Blender and is GPL-3.0-or-later, as `blender-pose.ts` is. Blender, Copyright (C) Blender
 * Authors, GPL-2.0-or-later. It must not be copied into an Apache-2.0 or MIT package.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { BlenderActionClip, BlenderMovieClip, BlenderMovieObject, BlenderMovieStack, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import type { BlenderArmatureAnimation } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import * as THREE from 'three';
import {
  actionLayer, blendMatrix, blendOwnChannels, curveAt, dampedTrack, nlaLayers, poseClip, poseCurve, rotationOf,
  type PoseClip, type PoseLayer,
} from './blender-pose';

/** One Timeline marker, by frame, with the camera Blender cuts to there. */
export interface MovieMarker {
  readonly name: string;
  readonly frame: number;
  readonly camera: string | null;
}

/** The scene's movie on the game's copy. */
export interface PlayMovie {
  readonly scene: BlenderSceneMovie['scene'];
  readonly markers: readonly MovieMarker[];
  /** Every object it moves, by Blender name. */
  readonly objects: readonly string[];
  /** Pose every animated object at a scene frame, whole or fractional. */
  pose(frame: number): void;
  /** The camera Blender's playback looks through at `frame`; null when the scene has none. */
  cameraAt(frame: number): string | null;
  /** Look through a Blender camera as it stands at the last posed frame: its world pose and its
   *  projection, written into `camera`; false when the file has no such camera. */
  look(camera: THREE.Camera, name: string): boolean;
  /** What the movie does in Blender that a game does not play, each named once. */
  readonly warnings: readonly string[];
}

/** One object's camera data, as the movie evaluates it. */
type CameraProps = Record<(typeof CAMERA_PROPS)[number], number>;
const CAMERA_PROPS = ['lens', 'sensor_width', 'sensor_height', 'ortho_scale', 'shift_x', 'shift_y', 'clip_start', 'clip_end'] as const;
/** The RNA defaults (`DNA_camera_defaults.h`), where Blender's NLA starts an animated property from. */
const CAMERA_DEFAULTS: CameraProps = { lens: 50, sensor_width: 36, sensor_height: 24, ortho_scale: 6, shift_x: 0, shift_y: 0, clip_start: 0.1, clip_end: 1000 };

/** A stack's clips as the evaluator holds them. */
interface Stack {
  readonly animation: BlenderArmatureAnimation | undefined;
  readonly action: string | null;
  readonly transform: Map<string, PoseClip | null>;
  /** Per action, each camera property's curve. */
  readonly scalars: Map<string, { readonly start: number; readonly end: number; readonly keysStart: number; readonly keysEnd: number; readonly curves: Map<string, ReturnType<typeof poseCurve>> }>;
}

interface MovieObject {
  readonly data: BlenderMovieObject;
  readonly object: THREE.Object3D;
  readonly stack: Stack | null;
  readonly camera: Stack | null;
  readonly pre: THREE.Matrix4;
  /** The camera's projection at the last posed frame. */
  props: CameraProps | null;
}

function stackOf(source: BlenderMovieStack | undefined, scalar: boolean): Stack | null {
  if (!source?.clips) return null;
  const transform = new Map<string, PoseClip | null>();
  const scalars: Stack['scalars'] = new Map();
  for (const [name, clip] of Object.entries(source.clips)) {
    if (scalar) scalars.set(name, scalarClip(clip));
    else transform.set(name, poseClip(asActionClip(clip)));
  }
  return { animation: source.animation as BlenderArmatureAnimation | undefined, action: source.action ?? null, transform, scalars };
}

/** The movie's clip in the clip door's shape, so `poseClip` reads it as it reads a bone action's. */
function asActionClip(clip: BlenderMovieClip): BlenderActionClip {
  return {
    object: null, armature: null, action: clip.action, slot: null, frameCurrent: 0, frameStart: 0, frameEnd: 0, fps: 24,
    keyframes: [], tracks: clip.tracks as unknown as BlenderActionClip['tracks'], clipStart: clip.clipStart, clipEnd: clip.clipEnd,
    keysStart: clip.keysStart, keysEnd: clip.keysEnd, ...(clip.unsupported ? { unsupported: clip.unsupported } : {}),
  };
}

function scalarClip(clip: BlenderMovieClip): NonNullable<ReturnType<Stack['scalars']['get']>> {
  const curves = new Map<string, ReturnType<typeof poseCurve>>();
  for (const track of clip.tracks) curves.set(track.property, poseCurve(track));
  return {
    start: clip.clipStart, end: clip.clipEnd,
    keysStart: clip.keysStart === null ? -Infinity : clip.keysStart, keysEnd: clip.keysEnd === null ? Infinity : clip.keysEnd,
    curves,
  };
}

/** The transform stack's layers at a scene frame: NLA strips, then the active action over them. */
function transformLayers(stack: Stack, frame: number): PoseLayer[] {
  const clips = (action: string): PoseClip | null => stack.transform.get(action) ?? null;
  const nla = nlaLayers(stack.animation, frame, clips);
  const layers = [...nla.layers];
  const active = stack.action ? clips(stack.action) : null;
  if (active) {
    const layer = actionLayer(stack.animation, active, frame, nla.evaluated);
    if (layer) layers.push(layer);
  }
  return layers;
}

/** A camera's projection at a scene frame: its data's stack over the file's values, each property
 *  blended as `nla_blend_value` blends it. */
function cameraProps(base: CameraProps, stack: Stack | null, frame: number): CameraProps {
  const out = { ...base };
  if (!stack) return out;
  // The scalar stack's layers, placed exactly as a transform stack's are: a stand-in clip per
  // action carries its range, and the layer's frame is the action frame to sample.
  const ranges = new Map<string, PoseClip>();
  for (const [name, clip] of stack.scalars)
    ranges.set(name, { action: name, start: clip.start, end: clip.end, keysStart: clip.keysStart, keysEnd: clip.keysEnd, cyclic: false, channels: [], unsupported: [] });
  const nla = nlaLayers(stack.animation, frame, (action) => ranges.get(action) ?? null);
  const layers = [...nla.layers];
  const active = stack.action ? ranges.get(stack.action) : undefined;
  if (active) {
    const layer = actionLayer(stack.animation, active, frame, nla.evaluated);
    if (layer) layers.push(layer);
  }
  const touched = new Set<string>();
  for (const layer of layers) {
    const k = Math.max(0, Math.min(1, layer.influence));
    if (k === 0) continue;
    const clip = stack.scalars.get(layer.clip.action);
    for (const [property, curve] of clip?.curves ?? []) {
      if (!(property in out)) continue;
      const key = property as keyof CameraProps;
      if (!touched.has(key)) { touched.add(key); out[key] = CAMERA_DEFAULTS[key]; }
      const lower = out[key];
      const upper = curveAt(curve, layer.frame);
      switch (layer.blend) {
        case 'ADD': out[key] = lower + upper * k; break;
        case 'SUBTRACT': out[key] = lower - upper * k; break;
        case 'MULTIPLY': out[key] = k * (lower * upper) + (1 - k) * lower; break;
        case 'COMBINE': out[key] = lower + (upper - CAMERA_DEFAULTS[key]) * k; break;
        default: out[key] = lower * (1 - k) + upper * k;
      }
    }
  }
  return out;
}

const AXES = ['TRACK_X', 'TRACK_Y', 'TRACK_Z', 'TRACK_NEGATIVE_X', 'TRACK_NEGATIVE_Y', 'TRACK_NEGATIVE_Z'];
const UP_AXES = ['UP_X', 'UP_Y', 'UP_Z'];
/** `basis_cross`. */
const basisCross = (n: number, m: number): number => (n - m === 1 || n - m === -2 ? 1 : n - m === -1 || n - m === 2 ? -1 : 0);

/** `trackto_evaluate` with `vectomat`: the owner's rotation replaced by one that points its track
 *  axis at the target with its up axis toward world Z (or the target's Z), its scale kept. */
function trackTo(owner: THREE.Matrix4, target: THREE.Matrix4, trackAxis: string, upAxis: string, useTargetZ: boolean): THREE.Matrix4 {
  const ownerPosition = new THREE.Vector3().setFromMatrixPosition(owner);
  const scale = new THREE.Vector3().setFromMatrixScale(owner);
  const vec = ownerPosition.clone().sub(new THREE.Vector3().setFromMatrixPosition(target));
  let axis = Math.max(0, AXES.indexOf(trackAxis));
  const up = Math.max(0, UP_AXES.indexOf(upAxis));
  const n = vec.lengthSq() > 0 ? vec.normalize() : new THREE.Vector3(0, 0, 1);
  if (axis > 2) axis -= 3;
  else n.negate();
  const u = useTargetZ ? new THREE.Vector3().setFromMatrixColumn(target, 2) : new THREE.Vector3(0, 0, 1);
  const proj = u.clone().sub(n.clone().multiplyScalar(u.dot(n) / (n.dot(n) || 1)));
  if (proj.lengthSq() === 0) proj.set(0, 1, 0);
  else proj.normalize();
  const right = new THREE.Vector3().crossVectors(proj, n).normalize();
  if (axis === up) return owner.clone();
  const basis: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  basis[3 - axis - up] = right.multiplyScalar(basisCross(axis, up));
  basis[up] = proj;
  basis[axis] = n;
  return new THREE.Matrix4().makeBasis(basis[0]!, basis[1]!, basis[2]!)
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .setPosition(ownerPosition);
}

/** The scene's movie bound to the game's copy (`view`, the detached copy's view). */
export function playMovie(view: BlenderRuntimeView, data: BlenderSceneMovie): PlayMovie {
  const warnings: string[] = [];
  const objects: MovieObject[] = [];
  for (const entry of data.objects) {
    const object = view.objectForBlenderName(entry.name);
    if (!object) continue;
    const stack = stackOf(entry, false);
    const camera = stackOf(entry.camera, true);
    for (const thing of entry.unsupported ?? []) warnings.push(`${entry.name}: ${thing} plays only in Blender, not in a game.`);
    for (const clip of [...Object.values(entry.clips ?? {}), ...Object.values(entry.camera?.clips ?? {})])
      for (const thing of clip.unsupported ?? []) warnings.push(`${entry.name}: ${clip.action}'s ${thing} plays only in Blender, not in a game.`);
    if (stack?.animation?.tweak) warnings.push(`${entry.name}: its NLA in tweak mode plays only in Blender (leave it with Tab in the NLA editor).`);
    objects.push({
      data: entry, object, stack, camera,
      pre: new THREE.Matrix4().set(...(entry.pre.flat() as Parameters<THREE.Matrix4['set']>)),
      props: null,
    });
  }
  // PARENTS BEFORE CHILDREN, and an object that aims at another after the objects it may aim at:
  // each is placed from its parent's (and its target's) pose this frame.
  const depth = (object: THREE.Object3D): number => { let d = 0; for (let at = object.parent; at; at = at.parent) d += 1; return d; };
  objects.sort((a, b) => depth(a.object) - depth(b.object) || (a.data.constraints.length > 0 ? 1 : 0) - (b.data.constraints.length > 0 ? 1 : 0));
  const byName = new Map(objects.map((one) => [one.data.name, one]));
  const markers = data.markers.map((marker) => ({ name: marker.name, frame: marker.frame, camera: marker.camera }));
  const cutMarkers = markers.filter((marker) => {
    if (marker.camera === null) return false;
    return !(byName.get(marker.camera)?.data.camera?.renderHidden ?? false);
  });

  const toBlender = (): THREE.Matrix4 => {
    view.root.updateWorldMatrix(true, false);
    return view.root.matrixWorld.clone().invert();
  };
  /** An object's world matrix in Blender's space. */
  const blenderWorld = (object: THREE.Object3D, inverseRoot: THREE.Matrix4): THREE.Matrix4 => {
    object.updateWorldMatrix(true, false);
    return inverseRoot.clone().multiply(object.matrixWorld);
  };

  const poseObject = (entry: MovieObject, frame: number, inverseRoot: THREE.Matrix4): void => {
    const { data: own, object } = entry;
    if (entry.camera || own.camera) entry.props = cameraProps(own.camera as unknown as CameraProps, entry.camera, frame);
    if (!entry.stack) return;
    const values = blendOwnChannels(own.channels, transformLayers(entry.stack, frame));
    // `BKE_object_to_mat4`: scale times delta scale, the delta rotation after the rotation, location plus delta.
    const rotation = rotationOf(own.rotationMode, values);
    const [dw, dx, dy, dz] = own.delta.rotation;
    rotation.premultiply(new THREE.Quaternion(dx, dy, dz, dw));
    const location = new THREE.Vector3(...(values.location as [number, number, number])).add(new THREE.Vector3(...(own.delta.location as [number, number, number])));
    const scale = new THREE.Vector3(...(values.scale as [number, number, number])).multiply(new THREE.Vector3(...(own.delta.scale as [number, number, number])));
    const local = entry.pre.clone().multiply(new THREE.Matrix4().compose(location, rotation, scale));
    const constraints = own.constraints.filter((one) => one.enabled && one.influence > 0 && one.target && (one.type === 'DAMPED_TRACK' || one.type === 'TRACK_TO'));
    if (constraints.length > 0 && object.parent) {
      // CONSTRAINTS WORK IN WORLD SPACE: the parent's world times the local, solved, and back.
      const parentWorld = blenderWorld(object.parent, inverseRoot);
      let world = parentWorld.clone().multiply(local);
      for (const constraint of constraints) {
        const target = view.objectForBlenderName(constraint.target!);
        if (!target) continue;
        const aim = blenderWorld(target, inverseRoot);
        const solved = constraint.type === 'DAMPED_TRACK'
          ? dampedTrack(world, new THREE.Vector3().setFromMatrixPosition(aim), constraint.trackAxis ?? 'TRACK_Y')
          : trackTo(world, aim, constraint.trackAxis ?? 'TRACK_NEGATIVE_Z', constraint.upAxis ?? 'UP_Y', constraint.useTargetZ ?? false);
        world = blendMatrix(world, solved, constraint.influence);
      }
      local.copy(parentWorld.invert().multiply(world));
    }
    object.matrix.copy(local);
    local.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);
  };

  let posed = false;
  return {
    scene: data.scene,
    markers,
    objects: objects.filter((one) => one.stack).map((one) => one.data.name),
    warnings,
    pose(frame) {
      const inverseRoot = toBlender();
      for (const entry of objects) poseObject(entry, frame, inverseRoot);
      posed = true;
    },
    cameraAt(frame) {
      // `BKE_scene_camera_switch_find`: compared with the whole frame, as Blender's `ctime` is.
      const now = Math.floor(frame);
      let best: MovieMarker | null = null;
      let first: MovieMarker | null = null;
      for (const marker of cutMarkers) {
        if (marker.frame <= now && (!best || marker.frame > best.frame)) best = marker;
        if (!first || marker.frame < first.frame) first = marker;
      }
      return (best ?? first)?.camera ?? data.scene.camera;
    },
    look(camera, name) {
      const entry = byName.get(name);
      const own = entry?.data.camera;
      if (!entry || !own) return false;
      if (!posed || !entry.props) entry.props = cameraProps(own as unknown as CameraProps, entry.camera, data.scene.current);
      const props = entry.props;
      // THE POSE: the camera object's world matrix in the stage, its scale dropped.
      entry.object.updateWorldMatrix(true, false);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      entry.object.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
      camera.position.copy(position);
      camera.quaternion.copy(quaternion);
      if (camera.parent) {
        camera.parent.updateWorldMatrix(true, false);
        camera.parent.worldToLocal(camera.position);
        camera.quaternion.premultiply(camera.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      }
      camera.updateMatrixWorld(true);
      // THE PROJECTION: the sensor fitted to the game's own shape (`AUTO` fits its larger side),
      // shifted by a share of the fitted side, as `BKE_camera_params_compute_viewplane` does.
      const perspective = camera as THREE.PerspectiveCamera;
      const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1;
      const orthographic = own.type === 'ORTHO';
      const fit = own.sensor_fit;
      const horizontal = fit === 'AUTO' ? aspect >= 1 : fit === 'HORIZONTAL';
      const sensor = fit === 'VERTICAL' ? props.sensor_height : props.sensor_width;
      const half = (orthographic ? props.ortho_scale : sensor / Math.max(props.lens, 1e-6)) / 2;
      const [halfWidth, halfHeight] = horizontal ? [half, half / aspect] : [half * aspect, half];
      const fitted = 2 * (horizontal ? halfWidth : halfHeight);
      const centerX = props.shift_x * fitted;
      const centerY = props.shift_y * fitted;
      const near = Math.max(props.clip_start, 1e-6);
      const far = Math.max(props.clip_end, near * 1.0001);
      if (perspective.isPerspectiveCamera) {
        perspective.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight));
        perspective.near = near;
        perspective.far = far;
        perspective.zoom = 1;
        perspective.filmOffset = 0;
        perspective.view = null;
      }
      if (orthographic)
        camera.projectionMatrix.makeOrthographic(centerX - halfWidth, centerX + halfWidth, centerY + halfHeight, centerY - halfHeight, near, far);
      else
        camera.projectionMatrix.makePerspective((centerX - halfWidth) * near, (centerX + halfWidth) * near, (centerY + halfHeight) * near, (centerY - halfHeight) * near, near, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      return true;
    },
  };
}
