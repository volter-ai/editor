/**
 * THE SCENE'S MOVIE IN A GAME, on three.js's own `AnimationMixer`: what Blender's playback shows
 * (every animated object and camera, and the camera cuts at the Timeline's markers), played on the
 * game's copy of the model at a scene frame the game's clock chooses (a cutscene, `@volter/play`'s
 * `play.cutscene`).
 *
 * - BLENDER SAMPLES, THREE.JS PLAYS. Blender evaluates every animated object's transform at every
 *   scene frame (`session.py`'s `_sample_object`: its channels through `FCurve.evaluate`, with its
 *   delta transform, placed in its parent's space), and the movie is one `THREE.AnimationClip` of
 *   position, quaternion, scale (and visibility, where it is keyed) tracks on the copy's objects.
 *   A seek sets the clip's time and lets the mixer pose them.
 * - A CAMERA'S PROJECTION is sampled the same way (lens, sensor, shift, clip range) and fitted to
 *   the game's own frame when it is looked through.
 * - THE CAMERA AT A FRAME is the camera of the last marker at or before it that is bound to one
 *   (and not disabled in renders), else the earliest such marker's, else the scene's camera.
 * - Track To and Damped Track on an object (a camera aimed at a subject) turn it after the mixer,
 *   toward the target as it stands this frame.
 *
 * When a cutscene ends nothing is put back: the objects keep the movie's last pose, so a door the
 * cutscene opened stays open, and the game moves them from there.
 */
import * as THREE from 'three';
import type { BlenderClipColumn, BlenderMovieObject, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';

/**
 * WHAT A SEQUENCE DRIVES, AND WHERE: only the objects `only` names (a collection's), and with
 * `place` the movie is moved so its `anchor` (an object of the file, an Empty) stands where `at`
 * stands in the game, turned as it is turned: an attack authored around a stand-in plays around the
 * player.
 */
export interface MovieScope {
  readonly only?: ReadonlySet<string>;
  readonly place?: { readonly at: THREE.Object3D; readonly anchor: string };
}

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
  /** Pose every animated object at a scene frame, whole or fractional; within `scope` only those
   *  it names, placed where it says. */
  pose(frame: number, scope?: MovieScope): void;
  /** The objects a collection holds (recursively), by Blender name; null when the movie names no
   *  such collection. */
  collection(name: string): ReadonlySet<string> | null;
  /** The camera Blender's playback looks through at `frame`; null when the scene has none. */
  cameraAt(frame: number): string | null;
  /** Look through a Blender camera as it stands at the last posed frame: its world pose and its
   *  projection, written into `camera`; false when the file has no such camera. */
  look(camera: THREE.Camera, name: string): boolean;
  /** A camera as it stands at the last posed frame, in the shape of the frame's camera data (its
   *  world matrix in Blender's space, by rows, and its sampled projection): what the editor's
   *  camera view draws through while the Timeline plays. Null when the movie does not move it. */
  cameraData(name: string): ({ name: string; type: string; sensor_fit: string; matrix: [number, number, number, number][] } & CameraProps) | null;
  /** What the movie does in Blender that a game does not play, each named once. */
  readonly warnings: readonly string[];
}

const CAMERA_PROPS = ['lens', 'sensor_width', 'sensor_height', 'ortho_scale', 'shift_x', 'shift_y', 'clip_start', 'clip_end'] as const;
type CameraProps = Record<(typeof CAMERA_PROPS)[number], number>;

function float32Of(column: BlenderClipColumn): Float32Array {
  const binary = atob(column.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

const AXES: Record<string, readonly [number, number]> = {
  TRACK_X: [0, 1], TRACK_Y: [1, 1], TRACK_Z: [2, 1], TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1],
  UP_X: [0, 1], UP_Y: [1, 1], UP_Z: [2, 1],
};

/** The rotation that points `trackAxis` (signed) along `forward` and `upAxis` as near `up` as it can. */
function aimed(forward: THREE.Vector3, up: THREE.Vector3, trackAxis: string, upAxis: string): THREE.Quaternion | null {
  const [track, sign] = AXES[trackAxis] ?? AXES['TRACK_NEGATIVE_Z']!;
  const [upIndex] = AXES[upAxis] ?? AXES['UP_Y']!;
  if (upIndex === track) return null;
  const f = forward.clone().normalize();
  const u = up.clone().sub(f.clone().multiplyScalar(up.dot(f)));
  if (u.lengthSq() < 1e-10) return null;
  u.normalize();
  const columns: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  columns[track] = f.multiplyScalar(sign);
  columns[upIndex] = u;
  const third = 3 - track - upIndex;
  columns[third] = new THREE.Vector3().crossVectors(columns[(third + 1) % 3]!, columns[(third + 2) % 3]!);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(columns[0]!, columns[1]!, columns[2]!));
}

interface MovieObject {
  readonly data: BlenderMovieObject;
  readonly object: THREE.Object3D;
  /** Its sampled transform, played on the mixer; null when it does not move. */
  readonly action: THREE.AnimationAction | null;
  /** The camera's sampled projection, by property. */
  readonly projection: Partial<Record<(typeof CAMERA_PROPS)[number], Float32Array>>;
  readonly projectionStart: number;
}

/** The scene's movie bound to the game's copy (`view`, the detached copy's view). */
export function playMovie(view: BlenderRuntimeView, data: BlenderSceneMovie): PlayMovie {
  const warnings: string[] = [];
  const objects: MovieObject[] = [];
  const mixer = new THREE.AnimationMixer(view.root);
  const { start, end, fps } = data.scene;
  const frames = Math.max(1, end - start + 1);
  const times = Float32Array.from({ length: frames }, (_, i) => i / fps);
  for (const entry of data.objects) {
    const object = view.objectForBlenderName(entry.name);
    if (!object) continue;
    for (const thing of entry.unsupported ?? []) warnings.push(`${entry.name}: ${thing} plays only in Blender, not in a game.`);
    const sampled = entry.sampled;
    const tracks: THREE.KeyframeTrack[] = [];
    if (sampled) {
      const column = (c: BlenderClipColumn, stride: number): [Float32Array, Float32Array] => {
        const values = float32Of(c);
        return [values.length === stride ? new Float32Array([0]) : times.slice(0, values.length / stride), values];
      };
      tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.position`, ...column(sampled.position, 3)));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, ...column(sampled.quaternion, 4)));
      tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, ...column(sampled.scale, 3)));
      if (sampled.hidden) {
        const [at, hidden] = column(sampled.hidden, 1);
        tracks.push(new THREE.BooleanKeyframeTrack(`${object.uuid}.visible`, at, Array.from(hidden, (one) => one < 0.5)));
      }
    }
    const projection: MovieObject['projection'] = {};
    const lens = entry.camera?.sampled;
    if (lens) for (const prop of CAMERA_PROPS) projection[prop] = float32Of(lens[prop]);
    let action: THREE.AnimationAction | null = null;
    if (tracks.length) {
      action = mixer.clipAction(new THREE.AnimationClip(`movie:${entry.name}`, (frames - 1) / fps, tracks));
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 0;
    }
    objects.push({ data: entry, object, action, projection, projectionStart: lens?.start ?? start });
  }
  // PARENTS BEFORE CHILDREN, so an object aimed by a constraint is turned from its parent's pose.
  const depth = (object: THREE.Object3D): number => { let d = 0; for (let at = object.parent; at; at = at.parent) d += 1; return d; };
  const aiming = objects
    .filter((one) => one.data.constraints.some((c) => c.enabled && c.influence > 0 && c.target && (c.type === 'TRACK_TO' || c.type === 'DAMPED_TRACK')))
    .sort((a, b) => depth(a.object) - depth(b.object));
  const byName = new Map(objects.map((one) => [one.data.name, one]));
  const markers = data.markers.map((marker) => ({ name: marker.name, frame: marker.frame, camera: marker.camera }));
  const cutMarkers = markers.filter((marker) => marker.camera !== null && !(byName.get(marker.camera)?.data.camera?.renderHidden ?? false));

  let frameNow = data.scene.current;
  const collections = new Map(Object.entries(data.collections ?? {}).map(([name, names]) => [name, new Set(names)]));
  /** A still object's pose as the file has it, read before it was first placed. */
  const stills = new Map<THREE.Object3D, THREE.Matrix4>();
  /** The anchor's pose in the copy's root, read once, before anything was placed. */
  const anchors = new Map<string, THREE.Matrix4 | null>();
  const anchorOf = (name: string): THREE.Matrix4 | null => {
    if (anchors.has(name)) return anchors.get(name)!;
    const object = view.objectForBlenderName(name);
    let pose: THREE.Matrix4 | null = null;
    if (object) {
      view.root.updateMatrixWorld(true);
      pose = view.root.matrixWorld.clone().invert().multiply(object.matrixWorld);
    } else {
      warnings.push(`A sequence is placed by "${name}", which the file does not have; it plays where it was authored.`);
    }
    anchors.set(name, pose);
    return pose;
  };

  /** Track To and Damped Track, in Blender's space (the copy's root holds the turn to Y up). */
  const constrain = (inScope: (entry: MovieObject) => boolean): void => {
    if (!aiming.some(inScope)) return;
    view.root.updateMatrixWorld(true);
    const inverseRoot = view.root.matrixWorld.clone().invert();
    const [position, rotation, size] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
    for (const entry of aiming) {
      if (!inScope(entry)) continue;
      for (const constraint of entry.data.constraints) {
        if (!constraint.enabled || constraint.influence <= 0 || !constraint.target) continue;
        const target = view.objectForBlenderName(constraint.target);
        if (!target) continue;
        target.updateWorldMatrix(true, false);
        entry.object.updateWorldMatrix(true, false);
        const own = inverseRoot.clone().multiply(entry.object.matrixWorld);
        const aim = inverseRoot.clone().multiply(target.matrixWorld);
        own.decompose(position, rotation, size);
        const forward = new THREE.Vector3().setFromMatrixPosition(aim).sub(position);
        if (forward.lengthSq() === 0) continue;
        let turned: THREE.Quaternion | null;
        if (constraint.type === 'TRACK_TO') {
          const up = constraint.useTargetZ ? new THREE.Vector3(0, 0, 1).transformDirection(aim) : new THREE.Vector3(0, 0, 1);
          turned = aimed(forward, up, constraint.trackAxis ?? 'TRACK_NEGATIVE_Z', constraint.upAxis ?? 'UP_Y');
        } else {
          const [index, sign] = AXES[constraint.trackAxis ?? 'TRACK_Y'] ?? AXES['TRACK_Y']!;
          const axis = new THREE.Vector3().setComponent(index, sign).applyQuaternion(rotation);
          turned = new THREE.Quaternion().setFromUnitVectors(axis, forward.normalize()).multiply(rotation);
        }
        if (!turned) continue;
        const world = new THREE.Matrix4().compose(position, rotation.clone().slerp(turned, Math.min(1, constraint.influence)), size);
        const parentWorld = entry.object.parent ? inverseRoot.clone().multiply(entry.object.parent.matrixWorld) : new THREE.Matrix4();
        parentWorld.invert().multiply(world).decompose(entry.object.position, entry.object.quaternion, entry.object.scale);
        entry.object.updateMatrixWorld(true);
      }
    }
  };

  /** A camera's projection at the posed frame, interpolated between Blender's samples. */
  const projectionOf = (entry: MovieObject): CameraProps => {
    const own = entry.data.camera!;
    const props = Object.fromEntries(CAMERA_PROPS.map((prop) => [prop, own[prop]])) as CameraProps;
    const at = frameNow - entry.projectionStart;
    for (const prop of CAMERA_PROPS) {
      const column = entry.projection[prop];
      if (!column) continue;
      if (column.length === 1) { props[prop] = column[0]!; continue; }
      const i = Math.max(0, Math.min(column.length - 1, Math.floor(at)));
      const j = Math.min(column.length - 1, i + 1);
      const t = Math.max(0, Math.min(1, at - i));
      props[prop] = column[i]! + (column[j]! - column[i]!) * t;
    }
    return props;
  };

  return {
    scene: data.scene,
    markers,
    objects: objects.filter((one) => one.data.sampled).map((one) => one.data.name),
    warnings,
    collection: (name) => collections.get(name) ?? null,
    pose(frame, scope) {
      frameNow = frame;
      const inScope = (entry: MovieObject): boolean => !scope?.only || scope.only.has(entry.data.name);
      const time = Math.max(0, Math.min(end, frame) - start) / fps;
      for (const entry of objects) {
        if (!entry.action) continue;
        // AN OBJECT OUT OF SCOPE is the game's: its action holds still and writes nothing.
        entry.action.enabled = inScope(entry);
        if (!entry.action.enabled) continue;
        if (!entry.action.isRunning()) entry.action.play();
        entry.action.paused = false;
        entry.action.time = time;
      }
      mixer.update(0);
      // PLACED: every moving object at the top of the sequence (its parent not in it) is carried by
      // the turn and shift that takes the anchor to where `at` stands in the game.
      const anchor = scope?.place ? anchorOf(scope.place.anchor) : null;
      if (scope?.place && anchor) {
        view.root.updateMatrixWorld(true);
        scope.place.at.updateWorldMatrix(true, false);
        const [p, q] = [new THREE.Vector3(), new THREE.Quaternion()];
        scope.place.at.matrixWorld.decompose(p, q, new THREE.Vector3());
        const at = view.root.matrixWorld.clone().invert().multiply(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
        const carry = at.multiply(anchor.clone().invert());
        const moving = new Set(objects.filter((entry) => entry.action && inScope(entry)).map((entry) => entry.object));
        const carried = scope.only ? [...scope.only].map((name) => view.objectForBlenderName(name)) : [...moving];
        for (const object of carried) {
          // AT THE TOP OF THE SET (a child goes with its parent): a moving object from the pose the
          // mixer just gave it, a still one from where the file has it.
          if (!object || object.parent !== view.root) continue;
          let base: THREE.Matrix4;
          if (moving.has(object)) base = new THREE.Matrix4().compose(object.position, object.quaternion, object.scale);
          else {
            let held = stills.get(object);
            if (!held) stills.set(object, held = new THREE.Matrix4().compose(object.position, object.quaternion, object.scale));
            base = held;
          }
          carry.clone().multiply(base).decompose(object.position, object.quaternion, object.scale);
          object.updateMatrixWorld(true);
        }
      }
      constrain(inScope);
    },
    cameraAt(frame) {
      // Compared with the whole frame, as Blender's playback compares it.
      const now = Math.floor(frame);
      let best: MovieMarker | null = null;
      let first: MovieMarker | null = null;
      for (const marker of cutMarkers) {
        if (marker.frame <= now && (!best || marker.frame > best.frame)) best = marker;
        if (!first || marker.frame < first.frame) first = marker;
      }
      return (best ?? first)?.camera ?? data.scene.camera;
    },
    cameraData(name) {
      const entry = byName.get(name);
      if (!entry?.data.camera) return null;
      view.root.updateMatrixWorld(true);
      entry.object.updateWorldMatrix(true, false);
      const e = view.root.matrixWorld.clone().invert().multiply(entry.object.matrixWorld).elements;
      const matrix = [0, 1, 2, 3].map((r) => [e[r]!, e[4 + r]!, e[8 + r]!, e[12 + r]!] as [number, number, number, number]);
      const own = entry.data.camera;
      return { name, type: own.type, sensor_fit: own.sensor_fit, matrix, ...projectionOf(entry) };
    },
    look(camera, name) {
      const entry = byName.get(name);
      const own = entry?.data.camera;
      if (!entry || !own) return false;
      const props = projectionOf(entry);
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
      // THE PROJECTION: the sensor fitted to the game's own frame (`AUTO` fits its larger side),
      // shifted by a share of the fitted side.
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
