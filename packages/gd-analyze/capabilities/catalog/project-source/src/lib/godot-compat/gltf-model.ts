/**
 * The native `.glb` model — cloned per instance, and its `AnimationPlayer` transform clip.
 *
 * A Godot 3D scene instances a `.glb` as a `PackedScene` (`Player.tscn`'s `Pivot/Character`), and
 * an `AnimationPlayer` beside it keys that instance's own `translation`/`rotation_degrees`
 * (`Player.tscn`'s `float` clip bobs `Pivot/Character`). Both are NATIVE now — there is no port
 * seam — and this file owns the three things that need the decoded model in hand: cloning one per
 * instance, turning the `.tscn`'s `Animation` sub-resource into a `THREE.AnimationClip` bound
 * to the cloned model, and handing back the clips the FILE itself carries.
 *
 * ## The clips the file carries, and the player Godot synthesizes for them
 *
 * A `.glb` with `animations` gets an `AnimationPlayer` from GODOT'S IMPORTER — a node the glTF node
 * list does not contain, holding one `Animation` per glTF animation
 * (`starter-kit-3d-platformer`'s `character.glb`: `static`, `idle`, `walk`, `jump`, reached by
 * `player.gd:85`/`:95`/`:103`). three's `GLTFLoader` decodes the same animations into
 * `GLTF.animations`, so the clips are already in hand — {@link godotModelClips} only says which
 * three clip each GODOT clip name means, and hands the caller three's own `AnimationClip`s to drive
 * with a real `AnimationMixer`. Nothing is rebuilt; there is no second animation system here, the
 * same return-path split the rest of this file keeps.
 *
 * ## How the models are loaded: `fetch` + `GLTFLoader.parseAsync`, NOT drei `useGLTF`
 *
 * `src/world.tsx` loads every distinct `.glb` ITSELF, in its startup effect, with a plain
 * `fetch('/path.glb')` and three's own `GLTFLoader.parseAsync(bytes, '')` — the model's decoded
 * scene goes into `ctx.models`, threaded to every scene BEFORE the tree builds. (`.glb` is
 * self-contained, so `parseAsync(bytes, '')` needs no resource base path.) This is deliberately
 * NOT `@react-three/drei`'s `useGLTF`/`<Suspense>`, for two reasons that a future edit "toward
 * idiomatic R3F" must not undo:
 *
 *  1. `useGLTF` calls `GLTFLoader.load(url)`, and three's `FileLoader.load` wraps a RELATIVE url in
 *     a `new Request()` — which the headless test host (jsdom/undici) cannot parse (`Failed to
 *     parse URL from /art/x.glb`), so the game would never mount there. `fetch` + `parseAsync(bytes)`
 *     hands three the decoded bytes directly and sidesteps that entirely.
 *  2. The model must be in hand SYNCHRONOUSLY when a scene's constructor runs — a script-instanced
 *     scene (`new MobScene(ctx)` mid-frame) clones its model and builds `new AnimationMixer(this
 *     .Character)`, and `initialize()` reads `playback_speed`, all BEFORE that scene's component (and
 *     any `<Suspense>` child) would mount. Loading every model before `ctx` is set is what makes that
 *     synchronous clone possible.
 *
 * The pre-existing hand-written port loaded its models with this identical `fetch` + `parseAsync`
 * technique; going native moved it from the port into the world's own document, unchanged.
 *
 * ## Cloning is per-instance, by contract
 *
 * A scene instanced twice is two graphs — two mobs are two models — so {@link cloneGodotModel}
 * hands back a fresh `SkeletonUtils.clone()` per call (Godot's own `PackedScene.instance()`). It
 * shares geometry and materials while rebinding every `SkinnedMesh` to the clone's own bones — the
 * distinction ordinary `Object3D.clone(true)` misses. The emitted scene then re-materials/shadows
 * its own copy (`withExternalMaterials`/`withGodotShadows`).
 *
 * ## The transform clip, and the one conversion that matters
 *
 * A Godot `Animation` sub-resource keys `Pivot/Character:translation` and `:rotation_degrees` —
 * i.e. the model instance's OWN local transform. The mixer is bound to the cloned model itself, so
 * the tracks address its root: a `translation` track is a `VectorKeyframeTrack('.position')`, and a
 * `rotation_degrees` track is a `QuaternionKeyframeTrack('.quaternion')`. The rotation is the
 * conversion that matters: Godot keys an Euler triple in DEGREES, and three has no Euler track, so
 * each key is turned into a quaternion — through the SAME `'YXZ'` order `spatial.ts` converts every
 * Godot rotation with, for the reason it records at length. A quaternion track is the faithful
 * carrier here rather than a lookalike: every measured clip turns about one axis, where three's
 * slerp and Godot's componentwise Euler lerp agree.
 *
 * This is NOT a second animation system: {@link buildModelTransformClip} returns three's own
 * `AnimationClip` and nothing of its own — the caller drives it with a `THREE.AnimationMixer`, the
 * same return-path split every clip builder here keeps (`value-track-animation.ts`,
 * `skeletal-animation.ts`).
 *
 * ## Godot's per-key easing stays on three's native track
 *
 * Godot's `keys.transitions` is one easing exponent per SOURCE key: it remaps the interpolation
 * factor of the segment leaving that key through `Math::ease`. Three has no serialized counterpart,
 * but its native `KeyframeTrack` deliberately owns an interpolant factory, so the eased factor is
 * carried through that seam. This file shipped that mechanism first and no longer owns it:
 * `animation-transition.ts` holds `godotEase` + `withGodotTransitions`, and the two sibling clip
 * builders (`skeletal-animation.ts`, `value-track-animation.ts`) read the same Godot field through
 * the same factory. A looping `loop_wrap` track gets one copied key on either side of the clip so
 * three's ordinary interval seek can evaluate Godot's last-to-first segment. The result is still a
 * real `THREE.AnimationClip` driven by a real `THREE.AnimationMixer`; this helper owns no playhead
 * or runtime.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing with a lifetime — every function here is pure. {@link cloneGodotModel} reads the
 * caller's `ctx.models` and returns a fresh clone; {@link buildModelTransformClip} returns a fresh
 * `AnimationClip`; {@link godotModelClips} returns a fresh map over clips the LOADER owns and does
 * not copy them. **Does not own:** the loaded source models (`src/world.tsx` owns `ctx.models`),
 * the `AnimationClip`s inside one, the `AnimationMixer`, or the objects the tracks key (the emitted
 * scene owns those). **Teardown:** none.
 */

import {
  AnimationClip,
  Euler,
  type KeyframeTrack,
  type Mesh,
  Matrix4,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Vector3,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { NamedClip } from './animation-player';
import { isGodotEased, withGodotTransitions } from './animation-transition';

/**
 * ONE decoded `res://….glb`, as `ctx.models` holds it: three's `GLTFLoader` output, kept together.
 *
 * `scene` is what a `.tscn` instances and {@link cloneGodotModel} clones. `animations` is what
 * Godot's importer turns into the `AnimationPlayer` it SYNTHESIZES beside that scene — a node the
 * glTF node list does not contain, whose clips exist only here. The two are one value because
 * three's loader hands them back as one (`GLTF.scene` / `GLTF.animations`); splitting them into two
 * maps keyed by the same `res://` path would be a second record of one load, with two ways to be
 * missing and two errors to write.
 */
export interface GodotModel {
  readonly scene: Object3D;
  /** `GLTF.animations`, verbatim — each `AnimationClip.name` is the FILE's own `animations[i].name`
   *  (`GLTFLoader.js:4141`, three 0.180.0), not the name Godot's importer gave the clip. */
  readonly animations: readonly AnimationClip[];
}

/** The loaded model at `path`, or the build error that says the world never loaded it. */
function modelAt(models: ReadonlyMap<string, GodotModel>, path: string): GodotModel {
  const source = models.get(path);
  if (source === undefined) {
    const known = [...models.keys()].sort();
    throw new Error(
      `godot-compat: no loaded model for "${path}". src/world.tsx loads every res://….glb the ` +
        `game instances into ctx.models before the tree builds; loaded: ${
          known.length === 0 ? '(none)' : known.join(', ')
        }. A missing one means the world did not load it.`,
    );
  }
  return source;
}

/**
 * `PackedScene.instance()` for an opaque `res://….glb` — a FRESH clone of the loaded source.
 *
 * `models` is `ctx.models`, the decoded `.glb`s `src/world.tsx` loaded (`fetch` +
 * `GLTFLoader.parseAsync`; see this file's header) and threaded to every scene before the tree
 * built. A missing entry is a build error — the world loads every model the game instances — so it
 * throws by name rather than returning an empty object a scene would place and animate to nothing.
 */
export function cloneGodotModel(models: ReadonlyMap<string, GodotModel>, path: string): Object3D {
  // A FRESH clone per instance, by contract — two mobs are two graphs. SkeletonUtils keeps shared
  // geometry/materials cheap while rebinding a SkinnedMesh to THIS clone's own bones; Object3D's
  // ordinary recursive clone leaves it pointing at the source skeleton.
  return SkeletonUtils.clone(modelAt(models, path).scene);
}

export interface GodotModelBonePose {
  readonly index: number;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
  readonly scale?: readonly [number, number, number];
}

/** Apply a `.tscn` patch on an importer-synthesized `Skeleton3D` to the clone's real bones. */
export function applyGodotModelBonePoses(
  model: Object3D,
  expectedNames: readonly string[],
  poses: readonly GodotModelBonePose[],
): void {
  const candidates: Array<{ bones: readonly Object3D[] }> = [];
  model.traverse((node) => {
    const skinned = node as Object3D & { isSkinnedMesh?: boolean; skeleton?: { bones: Object3D[] } };
    if (skinned.isSkinnedMesh === true && skinned.skeleton !== undefined) candidates.push(skinned.skeleton);
  });
  const matches = candidates.filter(
    (skeleton) =>
      skeleton.bones.length === expectedNames.length &&
      skeleton.bones.every((bone, index) => bone.name === expectedNames[index]),
  );
  if (matches.length === 0) {
    throw new Error(
      `godot-compat: expected at least one model skeleton [${expectedNames.join(', ')}], found 0 ` +
        `among ${candidates.length} skin wrapper(s).`,
    );
  }
  for (const pose of poses) {
    // A glTF skin may be bound by several SkinnedMeshes. GLTFLoader may hand those wrappers the
    // SAME live Bone objects or distinct copies with the same ordered names; Godot's one
    // Skeleton3D patch reaches every binding, while multiplying a shared bone twice compounds the
    // pose. Apply to every distinct live bone identity exactly once for this authored pose.
    const seen = new Set<Object3D>();
    for (const skeleton of matches) {
      const bone = skeleton.bones[pose.index];
      if (bone === undefined) {
        throw new Error(`godot-compat: bone pose index ${pose.index} is out of range.`);
      }
      if (seen.has(bone)) continue;
      seen.add(bone);
      const rest = new Matrix4().compose(bone.position, bone.quaternion, bone.scale);
      const p = pose.position ?? [0, 0, 0];
      const r = pose.rotation ?? [0, 0, 0, 1];
      const s = pose.scale ?? [1, 1, 1];
      const localPose = new Matrix4().compose(
        new Vector3(p[0], p[1], p[2]),
        new Quaternion(r[0], r[1], r[2], r[3]),
        new Vector3(s[0], s[1], s[2]),
      );
      rest.multiply(localPose).decompose(bone.position, bone.quaternion, bone.scale);
    }
  }
}

/**
 * Every mesh inside an imported `.glb` casts and receives, which is Godot's own default for a
 * `GeometryInstance` and the opposite of three's. The emitter cannot annotate these nodes
 * individually — the reader never opened the binary — so it states the class fact over the subtree
 * the port hands back. See `translate/data/shadow.ts` for the Godot 3.6 run that measured the default.
 *
 * It runs per INSTANCE rather than per resource because the port mints a fresh clone per call, and
 * three's flags live on the `Object3D`, not on the geometry.
 */
export function withGodotShadows(model: Object3D): Object3D {
  model.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
}

/**
 * One clip of the `AnimationPlayer` Godot's importer synthesizes for a `.glb`, as the emitter
 * lifted it from the file: the name GODOT gave it, the name the FILE gives it, and Godot's own
 * loop flag.
 *
 * The two names are separate because the two importers do not agree on one. Godot sanitizes every
 * generated name through `validate_node_name` and uniquifies with `2`, `3`, …; three's
 * `GLTFLoader` keeps `animationDef.name` verbatim and uniquifies nothing
 * (`three/examples/jsm/loaders/GLTFLoader.js:4141`, 0.180.0 as vendored:
 * `const animationName = animationDef.name ? animationDef.name : 'animation_' + animationIndex;`).
 * A script says `play("<godot name>")`; the `THREE.AnimationClip` it must reach is named
 * `threeName`. Same shape as {@link godotModelNode}'s raw-glTF-name descent, one level along.
 */
export interface GodotModelClipSpec {
  /** Godot's clip name — what `play(…)`/`current_animation` spell. */
  readonly name: string;
  /** three's `AnimationClip.name` for the same animation. */
  readonly threeName: string;
  /** Godot `Animation.loop_mode !== 0`. */
  readonly loop: boolean;
}

/**
 * The `name → {@link NamedClip}` map a glb-synthesized `AnimationPlayer` is built from: three's OWN
 * `AnimationClip`s off the loaded model, keyed by the name Godot's importer gave each one.
 *
 * Nothing is rebuilt here — the clips are the loader's, tracks and interpolants included, so the
 * pose is whatever three's `GLTFLoader` decoded from the same bytes Godot imported. This is the
 * `AnimationPlayer` half of what {@link cloneGodotModel} is for the node half, and the return path
 * is three's own: the caller drives the result with a real `AnimationMixer`.
 *
 * A spec naming a clip the loaded model does not carry throws by name — the specs were computed
 * from the same `.glb` at translate time, so a mismatch means the file on disk is not the one the
 * project was translated from, which is the same claim {@link godotModelNode} makes.
 */
export function godotModelClips(
  models: ReadonlyMap<string, GodotModel>,
  path: string,
  specs: readonly GodotModelClipSpec[],
): ReadonlyMap<string, NamedClip> {
  const model = modelAt(models, path);
  const clips = new Map<string, NamedClip>();
  for (const spec of specs) {
    const matches = model.animations.filter((clip) => clip.name === spec.threeName);
    if (matches.length !== 1) {
      const available = model.animations.map((clip) => clip.name);
      throw new Error(
        `godot-compat: the loaded model "${path}" has ${matches.length} animation(s) named ` +
          `"${spec.threeName}" (Godot's clip "${spec.name}"), not 1. The clip names three ` +
          `decoded are: ${available.length === 0 ? '(none)' : available.join(', ')}. This ` +
          'mapping was computed from the same .glb at translate time, so a mismatch means the ' +
          'file on disk is not the one the project was translated from.',
      );
    }
    clips.set(spec.name, { clip: matches[0] as AnimationClip, loop: spec.loop });
  }
  return clips;
}

/**
 * The `Object3D` INSIDE a cloned model that a Godot `[node]` patch names.
 *
 * A `.tscn` that instances a `.glb` overrides nodes inside it — `[node name="torso"
 * parent="character/root"] transform = …`, `[node name="cloud2" parent="."]
 * surface_material_override/0 = …`. The clone this file hands back is one object; that line names a
 * node within it, and this is how the emitted scene reaches it.
 *
 * `gltfNames` is a chain of RAW glTF node names — `nodeDef.name` exactly as the file spells it,
 * outermost first — NOT Godot node names and NOT three `Object3D.name`s. Those three strings differ:
 * `cloud.glb`'s one mesh is `cloud` in the file, `cloud2` in Godot's tree and `cloud_1` in three's,
 * because the two importers resolve the same name collision on different objects. three keeps the
 * file's own string on `userData.name` (`GLTFLoader`'s `node.userData.name = nodeDef.name`) and
 * `SkeletonUtils.clone` carries it onto the clone, so it is the one name both engines agree on.
 * The emitter computes the chain and refuses anything it cannot address (`gd-analyze`'s
 * `translate/glb-internal-node.ts`); this function is the runtime half and asserts what it was told.
 *
 * Descent is by `userData.name` rather than by child INDEX on purpose: three splits a glTF mesh
 * with several primitives into a `Group` of `Mesh` children that Godot keeps as one node with
 * several surfaces, and those extra children carry no `userData.name` — so a name descent walks
 * past them and an ordinal descent would have to count them.
 */
export function godotModelNode(model: Object3D, gltfNames: readonly string[]): Object3D {
  let at = model;
  const reached: string[] = [];
  for (const name of gltfNames) {
    const matches = at.children.filter((child) => child.userData['name'] === name);
    if (matches.length !== 1) {
      const available = at.children
        .map((child) => child.userData['name'])
        .filter((one): one is string => typeof one === 'string');
      throw new Error(
        `godot-compat: the loaded model has ${matches.length} child(ren) named "${name}" under ` +
          `"${reached.length === 0 ? '<model root>' : reached.join('/')}", not 1. The glTF node ` +
          `names there are: ${available.length === 0 ? '(none)' : available.join(', ')}. This ` +
          'address was computed from the same .glb at translate time, so a mismatch means the ' +
          'file on disk is not the one the project was translated from.',
      );
    }
    at = matches[0] as Object3D;
    reached.push(name);
  }
  return at;
}

/** Godot's `get_node_or_null()` over the same raw-glTF-name address. Unlike `godotModelNode`, an
 *  absent or ambiguous segment is the method's ordinary `null` result rather than an asset error. */
export function godotModelNodeOrNull(
  model: Object3D,
  gltfNames: readonly string[],
): Object3D | null {
  let at = model;
  for (const name of gltfNames) {
    const matches = at.children.filter((child) => child.userData['name'] === name);
    if (matches.length !== 1) return null;
    at = matches[0] as Object3D;
  }
  return at;
}

/**
 * The `Mesh` inside a loaded model that ONE Godot mesh SURFACE is — what a `.tscn`'s
 * `[node] surface_material_override/<s> = …` line names, once {@link godotModelNode} has reached
 * the node that owns it.
 *
 * A Godot `MeshInstance3D` holds an `ArrayMesh` of N surfaces and overrides them one at a time;
 * three has no per-surface slot on a loaded glTF node, because it already SPLIT the mesh: with one
 * primitive the node IS a `Mesh`, and with several it is a `Group` whose first N children are those
 * primitives in order (`GLTFParser.loadMesh` pushes one `Mesh` per primitive and, above one, adds
 * them to a fresh `Group` over the same loop; `loadNode` adds the node's glTF children only
 * afterwards — "child glTF nodes have not been added to this node yet"). A Godot surface index and
 * a glTF primitive index are the same number, so surface `s` is that s-th primitive mesh.
 *
 * `surfaceCount` is the count the EMITTER read out of the same `.glb` at translate time, and this
 * asserts against it rather than trusting the shape it finds — the same claim
 * {@link godotModelNode} and {@link godotModelClips} make, for the same reason: a mismatch means
 * the file on disk is not the one the project was translated from.
 *
 * The return path is three's own object, so the caller assigns `.material` with three's API and
 * this helper owns nothing.
 */
export function godotModelSurface(node: Object3D, surface: number, surfaceCount: number): Mesh {
  const describe = (): string =>
    `node "${node.name}" (${node.type}) with ${String(node.children.length)} child(ren)`;
  if (surface < 0 || surface >= surfaceCount) {
    throw new Error(
      `godot-compat: surface ${String(surface)} is outside the ${String(surfaceCount)} surface(s) ` +
        `the translated .glb records for ${describe()}.`,
    );
  }
  const candidate = surfaceCount === 1 ? node : node.children[surface];
  if (candidate === undefined || (candidate as Partial<Mesh>).isMesh !== true) {
    throw new Error(
      `godot-compat: the loaded model has no THREE.Mesh for Godot surface ${String(surface)} of ` +
        `${describe()}. A ${String(surfaceCount)}-surface glTF node loads as ` +
        `${surfaceCount === 1 ? 'a Mesh' : 'a Group whose first children are its primitive meshes'}` +
        '; this address was computed from the same .glb at translate time, so a mismatch means ' +
        'the file on disk is not the one the project was translated from.',
    );
  }
  return candidate as Mesh;
}

/** The three property a Godot model-transform track was keyed on. `translation` becomes the model
 *  root's `.position`; `rotation_degrees` its `.quaternion` (see this file's header). */
export type ModelTransformProperty = 'translation' | 'rotation_degrees';

/**
 * One `type = "value"` track of a Godot `Animation` keying a `.glb` instance's own transform, as
 * DATA the emitter lifted from the `.tscn`. `values` is FLAT — three floats per key (an `x, y, z`
 * Godot `Vector3`): a position triple for `translation`, an Euler-DEGREES triple for
 * `rotation_degrees`.
 */
export interface ModelTransformTrack {
  readonly property: ModelTransformProperty;
  /** `keys.times` — one time per keyframe. */
  readonly times: readonly number[];
  /** `keys.values`, flattened — three per key (`x, y, z`). */
  readonly values: readonly number[];
  /** `keys.transitions` — the easing exponent applied to the segment LEAVING each key. */
  readonly transitions: readonly number[];
  /** `tracks/N/loop_wrap` — interpolate the last-to-first segment when the clip loops. */
  readonly loopWrap: boolean;
}

/**
 * One Godot `Animation` sub-resource whose tracks key a `.glb` instance's own transform: its name,
 * `length`, authored loop mode, and the resolved transform tracks. `loop` is needed here as well as
 * by the caller: a track's `loop_wrap` only exists when the owning animation loops.
 */
export interface ModelTransformAnimation {
  readonly name: string;
  readonly length: number;
  readonly loop: boolean;
  readonly tracks: readonly ModelTransformTrack[];
}

/** Assert a track's flat `values` length is three per key (a `Vector3`), or throw by name. */
function assertVector3Keys(track: ModelTransformTrack, clip: string): void {
  if (track.values.length !== track.times.length * 3) {
    throw new Error(
      `godot-compat: model-transform Animation "${clip}" track "${track.property}" has ` +
        `${track.times.length} time(s) but ${track.values.length} value(s), not ` +
        `${track.times.length * 3} (a Vector3 is three per key).`,
    );
  }
  if (track.transitions.length !== track.times.length) {
    throw new Error(
      `godot-compat: model-transform Animation "${clip}" track "${track.property}" has ` +
        `${track.times.length} time(s) but ${track.transitions.length} transition(s); Godot stores ` +
        'one transition per key.',
    );
  }
}

/** Add virtual boundary keys so three can seek Godot's wrapped last-to-first segment. */
function prepareTrack(
  track: ModelTransformTrack,
  clip: ModelTransformAnimation,
): { times: number[]; values: number[]; transitions: number[] } {
  const times = [...track.times];
  const values = [...track.values];
  const transitions = [...track.transitions];
  if (!clip.loop || !track.loopWrap || times.length < 2) return { times, values, transitions };

  const first = values.slice(0, 3);
  const last = values.slice(-3);
  times.unshift((times.at(-1) as number) - clip.length);
  values.unshift(...last);
  transitions.unshift(transitions.at(-1) as number);
  times.push((times[1] as number) + clip.length);
  values.push(...first);
  transitions.push(transitions[1] as number);
  return { times, values, transitions };
}

/**
 * Build a `THREE.AnimationClip` from a Godot `Animation` keying a `.glb` instance's own transform.
 * A `translation` track becomes a `VectorKeyframeTrack('.position')`; a `rotation_degrees` track a
 * `QuaternionKeyframeTrack('.quaternion')`, each Euler-DEGREES key converted to a quaternion in
 * `'YXZ'` order (see this file's header). The clip binds to the model the caller's mixer is rooted
 * at, so the paths are root-relative (`.position`/`.quaternion`).
 */
export function buildModelTransformClip(animation: ModelTransformAnimation): AnimationClip {
  const tracks: KeyframeTrack[] = [];
  // Scratch, reused across keys — never escapes this call.
  const euler = new Euler(0, 0, 0, 'YXZ');
  const quaternion = new Quaternion();
  const toRadians = Math.PI / 180;
  for (const track of animation.tracks) {
    assertVector3Keys(track, animation.name);
    const prepared = prepareTrack(track, animation);
    // Both track kinds are LINEAR here (a Godot model-transform value track has no `interp` this
    // builder reads), so the eased factory applies whenever an exponent is not 1; at 1 the remap is
    // the identity and three's own interpolant is left in place.
    const eased = isGodotEased(prepared.transitions);
    if (track.property === 'translation') {
      const positions = new VectorKeyframeTrack('.position', prepared.times, prepared.values);
      tracks.push(eased ? withGodotTransitions(positions, prepared.transitions, false) : positions);
      continue;
    }
    // `rotation_degrees` — a YXZ Euler triple in degrees per key, turned into a quaternion three can
    // keyframe. The order is compat's `'YXZ'`, for the reason `spatial.ts` states at length.
    const quaternions: number[] = [];
    for (let i = 0; i < prepared.times.length; i += 1) {
      const base = i * 3;
      euler.set(
        (prepared.values[base] as number) * toRadians,
        (prepared.values[base + 1] as number) * toRadians,
        (prepared.values[base + 2] as number) * toRadians,
        'YXZ',
      );
      quaternion.setFromEuler(euler);
      quaternions.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    const rotations = new QuaternionKeyframeTrack('.quaternion', prepared.times, quaternions);
    tracks.push(eased ? withGodotTransitions(rotations, prepared.transitions, true) : rotations);
  }
  // three's AnimationClip length defaults to the max track time; Godot's `length` can exceed that (a
  // clip padded past its last key), so pass it through — the same period-fidelity the sibling clip
  // builders keep.
  return new AnimationClip(animation.name, animation.length, tracks);
}
