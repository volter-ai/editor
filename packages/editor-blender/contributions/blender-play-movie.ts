/**
 * THE SCENE'S MOVIE IN A GAME, on three.js's own `AnimationMixer`: what Blender's playback shows
 * (every animated object and camera, and the camera cuts at the Timeline's markers), played on the
 * game's copy of the model at a scene frame the game's clock chooses (a cutscene, `@volter/play`'s
 * `play.cutscene`).
 *
 * - BLENDER SAMPLES, THREE.JS PLAYS. Blender evaluates every animated object's transform at every
 *   scene frame (`session.py`'s `_sample_object`: its channels through `FCurve.evaluate`, with its
 *   delta transform, placed in its parent's space), and the movie is one `THREE.AnimationClip` of
 *   position, quaternion, scale (and visibility, where it is keyed) tracks on the copy's objects,
 *   played on the scene's one mixer beside the armatures (`blender-scene-mixer.ts`): `place` sets
 *   the clips' time, the scene evaluates, `settle` places a sequence and turns the aimed objects.
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
   *  it names, placed where it says: `place`, the mixer's evaluation, `settle`. */
  pose(frame: number, scope?: MovieScope): void;
  /** Set the frame on the mixer (nothing moves until it evaluates); null holds the movie off it, so
   *  an evaluation for others leaves its objects where they stand (its materials still take the
   *  `presented` frame: the presenter does not follow a material's animation). `presented` is the
   *  frame the drawn geometry was evaluated at (Blender's own; the read's when absent): a shape key
   *  plays relative to the value it already has there. */
  place(frame: number | null, scope?: MovieScope, presented?: number): void;
  /** After the mixer: a sequence carried to where the game puts it, and the aimed objects turned. */
  settle(): void;
  /** Its actions off the mixer. */
  dispose(): void;
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
/** `mixer`: the scene's (`sceneMixer(view).mixer`); absent, the movie gets one of its own. */
export function playMovie(view: BlenderRuntimeView, data: BlenderSceneMovie, mixer = new THREE.AnimationMixer(view.root)): PlayMovie {
  const warnings: string[] = [];
  const objects: MovieObject[] = [];
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
  // MATERIALS AND SHAPE KEYS (`docs/SCENE-ANIMATION.md` step 5): more clips on the same mixer, placed
  // with the objects'. A material's keyed inputs drive the presented material of its name (through one
  // mesh that wears it: the material is one object, shared); a mesh's keyed shape keys become morph
  // targets on its drawn geometry (each drawn vertex takes its Blender vertex's offset, `blenderVertex`,
  // and the normals the offset gives it), driven by the value Blender gives each key there minus the
  // value the drawn geometry already holds (its value at the presented frame, subtracted in `settle`).
  const materialActions: THREE.AnimationAction[] = [];
  const shapeActions: THREE.AnimationAction[] = [];
  const shapeMeshes: { mesh: THREE.Mesh; keys: Float32Array[] }[] = [];
  const extraClip = (name: string, tracks: THREE.KeyframeTrack[], into: THREE.AnimationAction[]): void => {
    if (!tracks.length) return;
    const action = mixer.clipAction(new THREE.AnimationClip(name, (frames - 1) / fps, tracks));
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = 0;
    into.push(action);
  };
  const extras = (): THREE.AnimationAction[] => [...materialActions, ...shapeActions];
  /** A key's value at a scene frame, from its sampled column. */
  const valueAt = (values: Float32Array, frame: number): number =>
    values.length <= 1 ? values[0] ?? 0 : values[Math.max(0, Math.min(values.length - 1, Math.round(frame - start)))]!;
  const timesOf = (values: Float32Array, stride: number): Float32Array =>
    values.length === stride ? new Float32Array([0]) : times.slice(0, values.length / stride);
  for (const entry of data.materials ?? []) {
    let path: string | null = null;
    let material: THREE.Material | null = null;
    view.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (path || !mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const index = list.findIndex((one) => one?.name === entry.name);
      if (index < 0) return;
      path = Array.isArray(mesh.material) ? `${mesh.uuid}.material[${index}]` : `${mesh.uuid}.material`;
      material = list[index]!;
    });
    const worn = material as THREE.Material | null;
    if (!path || !worn) { warnings.push(`The keyed material "${entry.name}" is not drawn here, so its animation does not play.`); continue; }
    const tracks: THREE.KeyframeTrack[] = [];
    if (entry.color) { const values = float32Of(entry.color); tracks.push(new THREE.ColorKeyframeTrack(`${path}.color`, timesOf(values, 3), values)); }
    if (entry.emissive) {
      const values = float32Of(entry.emissive);
      tracks.push(new THREE.ColorKeyframeTrack(`${path}.emissive`, timesOf(values, 3), values));
      if ('emissiveIntensity' in worn) (worn as THREE.MeshStandardMaterial).emissiveIntensity = 1;
    }
    if (entry.opacity) {
      const values = float32Of(entry.opacity);
      tracks.push(new THREE.NumberKeyframeTrack(`${path}.opacity`, timesOf(values, 1), values));
      worn.transparent = true;
      worn.needsUpdate = true;
    }
    extraClip(`movie-material:${entry.name}`, tracks, materialActions);
  }
  for (const entry of data.shapes ?? []) {
    const owner = view.objectForBlenderName(entry.object);
    if (!owner) continue;
    if (!entry.mapped) { warnings.push(`${entry.object}: its shape keys play only in Blender, not in a game: its modifiers change its vertices.`); continue; }
    const meshes: THREE.Mesh[] = [];
    owner.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh && mesh.geometry.getAttribute('blenderVertex')) meshes.push(mesh); });
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      const source = geometry.getAttribute('blenderVertex') as THREE.BufferAttribute;
      const drawn = geometry.getAttribute('position').count;
      const morphs: THREE.BufferAttribute[] = [];
      const normals: THREE.BufferAttribute[] = [];
      const dictionary: Record<string, number> = {};
      const tracks: THREE.KeyframeTrack[] = [];
      const keys: Float32Array[] = [];
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
      let fits = true;
      entry.keys.forEach((key, k) => {
        const delta = float32Of(key.delta);
        const offsets = new Float32Array(drawn * 3);
        for (let j = 0; j < drawn; j++) {
          const from = source.getX(j);
          if (from >= entry.vertices) { fits = false; continue; }
          offsets[j * 3] = delta[from * 3]!;
          offsets[j * 3 + 1] = delta[from * 3 + 1]!;
          offsets[j * 3 + 2] = delta[from * 3 + 2]!;
        }
        morphs.push(new THREE.BufferAttribute(offsets, 3));
        // THE NORMALS THE OFFSET GIVES: the shape's own, less the drawn ones (smooth over the drawn faces)
        if (normal) {
          const shaped = new THREE.BufferGeometry();
          shaped.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(position.array as Float32Array, (v, i) => v + offsets[i]!), 3));
          if (geometry.index) shaped.setIndex(geometry.index);
          shaped.computeVertexNormals();
          const turned = shaped.getAttribute('normal') as THREE.BufferAttribute;
          normals.push(new THREE.BufferAttribute(Float32Array.from(turned.array as Float32Array, (v, i) => v - (normal.array as Float32Array)[i]!), 3));
          shaped.dispose();
        }
        dictionary[key.name] = k;
        const values = float32Of(key.values);
        keys.push(values);
        tracks.push(new THREE.NumberKeyframeTrack(`${mesh.uuid}.morphTargetInfluences[${k}]`, timesOf(values, 1), values));
      });
      if (!fits) { warnings.push(`${entry.object}: its drawn vertices do not match its mesh, so its shape keys play only in Blender.`); continue; }
      geometry.morphAttributes['position'] = morphs;
      if (normal && normals.length === morphs.length) geometry.morphAttributes['normal'] = normals;
      geometry.morphTargetsRelative = true;
      mesh.updateMorphTargets();
      mesh.morphTargetDictionary = dictionary;
      for (const one of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) one.needsUpdate = true;
      shapeMeshes.push({ mesh, keys });
      extraClip(`movie-shapes:${entry.object}:${mesh.uuid}`, tracks, shapeActions);
    }
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
  /** What the last `place` asked for (null: held off the mixer), for `settle`. */
  let placed: { readonly scope: MovieScope | undefined } | null = null;
  /** The frame the drawn geometry was evaluated at: Blender's own (the director says), else the read's. */
  let presentedFrame = data.scene.current;
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
      this.place(frame, scope);
      mixer.update(0);
      this.settle();
    },
    place(frame, scope, presented) {
      presentedFrame = presented ?? presentedFrame;
      if (frame === null) {
        for (const entry of objects) if (entry.action) entry.action.enabled = false;
        for (const action of shapeActions) action.enabled = false;
        for (const { mesh } of shapeMeshes) mesh.morphTargetInfluences?.fill(0);
        // (the presenter draws a material's file value, not its animation: the movie keeps it)
        const held = Math.max(0, Math.min(end, presentedFrame) - start) / fps;
        for (const action of materialActions) {
          action.enabled = true;
          if (!action.isRunning()) action.play();
          action.paused = false;
          action.time = held;
        }
        placed = null;
        return;
      }
      frameNow = frame;
      placed = { scope };
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
      // (materials and shape keys play in the whole movie; a sequence scoped to a collection leaves them)
      for (const action of extras()) {
        action.enabled = !scope?.only;
        if (!action.enabled) continue;
        if (!action.isRunning()) action.play();
        action.paused = false;
        action.time = time;
      }
    },
    settle() {
      if (!placed) return;
      // SHAPE KEYS relative to what the drawn geometry already holds (its value at the presented frame)
      for (const { mesh, keys } of shapeMeshes) {
        const influences = mesh.morphTargetInfluences;
        if (!influences) continue;
        keys.forEach((values, k) => { influences[k] = (influences[k] ?? 0) - valueAt(values, presentedFrame); });
      }
      const scope = placed.scope;
      const inScope = (entry: MovieObject): boolean => !scope?.only || scope.only.has(entry.data.name);
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
    dispose() {
      for (const entry of objects) {
        if (!entry.action) continue;
        const clip = entry.action.getClip();
        entry.action.stop();
        mixer.uncacheAction(clip);
        mixer.uncacheClip(clip);
      }
      for (const action of extras()) {
        const clip = action.getClip();
        action.stop();
        mixer.uncacheAction(clip);
        mixer.uncacheClip(clip);
      }
      placed = null;
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
