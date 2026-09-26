/**
 * `Animation` (value-track) — a Godot `Animation`'s per-PROPERTY tracks, as a
 * `THREE.AnimationClip` that keys the emitted objects' own properties.
 *
 * The skeletal sibling ({@link buildSkeletalClip}, `skeletal-animation.ts`) turns a Godot
 * `type = "transform"` track into a bone's `position`/`quaternion`/`scale`. THIS file is the other
 * kind of `Animation` an `AnimationPlayer` owns: a `type = "value"` track that keys an ordinary node
 * property — `Circle:visible`, `Icon:scale`, `Marker:translation`. `coin.tscn`'s `take` clip (played
 * at `coin.gd:9`) is the worked case: one `Circle:visible` track that hides the coin on pickup.
 *
 * ## What a value track is, and the one mapping that matters
 *
 * A Godot value track stores `keys = { "times": …, "update": …, "values": […] }`: the keyframe
 * times, an UPDATE MODE, and the raw values. three's `KeyframeTrack` addresses an object property by
 * a path string (`"Circle.visible"`, resolved against the mixer's root by name — the same name-based
 * resolution `skeletal-animation.ts`'s `"<bone>.quaternion"` tracks rely on), so a Godot property
 * track becomes the matching three keyframe track: a boolean property is a `BooleanKeyframeTrack`, a
 * scalar a `NumberKeyframeTrack`, and a `Vector2`/`Vector3`/`Color` a `VectorKeyframeTrack`. The EMITTER decides the path
 * and which three property a Godot property maps to (it holds the scene graph); this file owns the
 * one thing that needs the values in hand — turning Godot's UPDATE MODE and INTERPOLATION into
 * three's, and refusing by name the combinations three cannot reproduce.
 *
 * ## Update mode → interpolation, and what refuses
 *
 * Godot's `Animation.UpdateMode` (`scene/resources/animation.h`) decides how a value track is
 * sampled, and it is a DIFFERENT axis from the per-track `interp`:
 *
 *  - `UPDATE_CONTINUOUS` (0): the property is interpolated between keys. A scalar/vector track then
 *    honours `interp` — LINEAR (1) is three's default linear interpolation, NEAREST (0) is
 *    `InterpolateDiscrete`, CUBIC (2) is REFUSED by name (Godot's cubic is a wrap-aware hermite
 *    three's `InterpolateSmooth` does not reproduce — the same refusal `skeletal-animation.ts`
 *    makes). A CONTINUOUS boolean is refused: three's `BooleanKeyframeTrack` cannot interpolate a
 *    boolean, and Godot never authors a continuously-interpolated bool (`visible`/`emitting`/
 *    `playing` are all discrete), so a plausible-wrong "hold" is refused rather than shipped.
 *  - `UPDATE_DISCRETE` (1): the value is HELD until the next key — three's `InterpolateDiscrete`.
 *    A boolean track is always this in Godot, and `BooleanKeyframeTrack` is discrete by nature, so
 *    it needs no interpolation change.
 *  - `UPDATE_TRIGGER` (2) / `UPDATE_CAPTURE` (3): REFUSED by name. `TRIGGER` fires a value ONCE when
 *    the playhead crosses the key (it does not hold or interpolate); `CAPTURE` blends from the
 *    property's live value at play time. Neither is a keyframe curve three's mixer samples, so a
 *    track that used one would be a lookalike that desynchronises — refused rather than approximated.
 *
 * A THIRD axis is the per-KEY `transitions` easing exponent, which Godot applies as
 * `Math::ease(c, transition)` to the segment leaving each key. `1` is the plain curve three draws;
 * anything else is CARRIED through the interpolant factory `animation-transition.ts` owns (three's
 * `KeyframeTrack` lets its interpolant be replaced, which is where the per-key remap lands). It was
 * refused here while the `.glb` transform sibling `gltf-model.ts` carried the identical Godot field
 * through a factory of its own; that factory is now shared by all three clip builders, because one
 * authored field cannot be expressible on one and inexpressible on another.
 *
 * Where the ease applies here, per kind:
 *
 *  - `number`/`vector2`/`vector`/`color` — the factory goes straight on the built track, exact: it remaps only the
 *    segment factor and hands the lerp back to three.
 *  - `bool`, and any DISCRETE/NEAREST track — NOT eased, because Godot does not ease them either.
 *    `_interpolate` returns the key's value outright for a held track, so the exponent never
 *    reaches an interpolation factor.
 *  - `euler` — the ease is baked into the RESAMPLE instead of the interpolant, because the
 *    resample already replaces this track's key grid (see {@link resampleEulerDegrees}). Each
 *    emitted sample sits exactly on Godot's eased curve; between samples three slerps linearly, so
 *    an eased rotation track CONVERGES rather than matching to the last bit — the same standing
 *    claim the unrotated resample already makes, now applying to time as well as arc.
 *
 * This is NOT a second animation system: {@link buildValueTrackClip} returns three's own
 * `AnimationClip` and nothing of its own — the caller drives it with a `THREE.AnimationMixer`
 * (`animation-player.ts`'s `createAnimationPlayer`/`playAnimation`), the same return-path split every
 * clip builder here keeps.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing with a lifetime — {@link buildValueTrackClip} is pure, returning a fresh
 * `AnimationClip`. **Does not own:** the `AnimationMixer`, the `AnimationAction`s, or the objects the
 * tracks key (the emitted scene owns those). **Teardown:** none; the caller disposes the mixer.
 */

import {
  AnimationClip,
  BooleanKeyframeTrack,
  Euler,
  InterpolateDiscrete,
  type InterpolationModes,
  type KeyframeTrack,
  NumberKeyframeTrack,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { godotEase, isGodotEased, withGodotTransitions } from './animation-transition';
import {
  getGodotMeshMaterialOverrideEmissionEnergy,
  setGodotMeshMaterialOverrideEmissionEnergy,
} from './mesh-material';

/** Godot's `Animation.UpdateMode` (`scene/resources/animation.h`). `CONTINUOUS` (0) is the implicit
 *  `else` — a value interpolated between keys — so it needs no named constant here. */
const GODOT_UPDATE_DISCRETE = 1;
const GODOT_UPDATE_TRIGGER = 2;
const GODOT_UPDATE_CAPTURE = 3;

/** Godot's `Animation.INTERPOLATION_*` (`scene/resources/animation.h`). */
const GODOT_INTERP_NEAREST = 0;
const GODOT_INTERP_LINEAR = 1;
const GODOT_INTERP_CUBIC = 2;

/** The three property KIND a Godot value property was mapped to — it decides the keyframe track
 *  class and how many floats each keyframe carries. `vector` and `euler` are three per key (a Godot
 *  `Vector3`); `bool`/`number` one. An `euler` key is a YXZ Euler triple in DEGREES — three has no
 *  Euler keyframe track, so it becomes a `QuaternionKeyframeTrack` (see {@link buildValueTrackClip}),
 *  the SAME conversion `gltf-model.ts`'s `buildModelTransformClip` does for a `.glb`'s own transform. */
export type ValueTrackKind = 'bool' | 'number' | 'vector2' | 'vector' | 'color' | 'euler';

export interface GodotValueTrackResourceTarget {
  readonly kind: 'material-override-property';
  readonly nodePath: string;
  readonly objectName: string;
  readonly resource: 'material_override';
  readonly property: 'emission_energy';
}

export type GodotValueTrackCrossSurfaceTarget =
  | {
      readonly kind: 'canvas-sprite-property';
      readonly scenePath: string;
      readonly nodePath: string;
      readonly property: 'frame';
    }
  | {
      readonly kind: 'canvas-animation-tree-property';
      readonly scenePath: string;
      readonly nodePath: string;
      readonly property: 'active';
    }
  | {
      readonly kind: 'canvas-node-property';
      readonly scenePath: string;
      readonly nodePath: string;
      readonly property: 'visible' | 'position' | 'modulate' | 'self_modulate' | 'frame';
      readonly valueKind: 'bool' | 'number' | 'vector2' | 'color';
    };

export interface GodotValueTrackScriptTarget {
  readonly kind: 'script-instance-property';
  readonly nodePath: string;
  readonly property: string;
  readonly member: string;
  readonly scriptPath: string;
  readonly valueKind: 'bool' | 'int' | 'number' | 'vector3';
  readonly crossSurface: boolean;
}

/** Godot lerps an Euler value track's COMPONENTS linearly; three keyframes rotation as a quaternion
 *  and SLERPs. The two agree exactly for a single-axis turn, but a quaternion slerp between two keys
 *  takes the SHORT arc, so a segment sweeping more than half a turn (the coin's `spin` keys `0` → `-360`
 *  about one axis, whose end quaternion EQUALS its start) would slerp to a standstill. Resampling the
 *  Euler curve so no segment exceeds this many degrees on any axis keeps every slerp on the arc Godot's
 *  Euler lerp traces — exact for the single-axis case, and converging elsewhere. */
const EULER_RESAMPLE_MAX_STEP_DEG = 45;

/**
 * One `type = "value"` track of a Godot `Animation`, as DATA an emitter lifts from the `.tscn` and
 * has already RESOLVED against the scene graph. `path` is three's binding path (`"Circle.visible"`)
 * — the emitter turned the Godot `NodePath("Circle:visible")` into the emitted object's name plus
 * the three property; this file never sees a Godot property name. `kind` is that property's three
 * type, `update`/`interp` are Godot's raw modes, and `values` is flat (one entry per key for
 * `bool`/`number`, two for `vector2`, three for `vector`, and four for `color`).
 */
export interface GodotValueTrack {
  /** three's keyframe binding path — `<objectName>.<property>`, resolved by the emitter. */
  readonly path: string;
  readonly resourceTarget?: GodotValueTrackResourceTarget;
  readonly crossSurfaceTarget?: GodotValueTrackCrossSurfaceTarget;
  readonly scriptTarget?: GodotValueTrackScriptTarget;
  /** The three property kind the Godot property mapped to. */
  readonly kind: ValueTrackKind;
  /** `keys.update` — `0` CONTINUOUS, `1` DISCRETE, `2` TRIGGER, `3` CAPTURE. */
  readonly update: number;
  /** `tracks/N/interp` — `0` NEAREST, `1` LINEAR, `2` CUBIC. */
  readonly interp: number;
  /** `keys.times` — one time per keyframe. */
  readonly times: readonly number[];
  /** `keys.transitions` — one EASING EXPONENT per keyframe. Godot eases the segment leaving a key
   *  by `Math::ease(c, transition)` (`animation.cpp` `_interpolate`); `1` is the plain linear curve
   *  three draws, and anything else is carried per this file's header. */
  readonly transitions: readonly number[];
  /** `keys.values`, flattened — one per key for `bool`/`number`, two for `vector2`, three for
   *  `vector`/`euler` (an `x, y, z` triple; for `euler`, DEGREES), and four for `color`. */
  readonly values: readonly number[];
}

const MATERIAL_OVERRIDE_ENERGY_BINDING = '__godotMaterialOverrideEmissionEnergy';

function valueTrackBindingPath(track: GodotValueTrack): string {
  if (track.scriptTarget !== undefined) return `.${scriptBindingName(track.scriptTarget)}`;
  if (track.crossSurfaceTarget !== undefined) {
    return `.${crossSurfaceBindingName(track.crossSurfaceTarget)}`;
  }
  if (track.resourceTarget === undefined) return track.path;
  return `${track.resourceTarget.objectName}.${MATERIAL_OVERRIDE_ENERGY_BINDING}`;
}

function scriptBindingName(target: GodotValueTrackScriptTarget): string {
  let hash = 2166136261;
  const identity = `${target.scriptPath}\0${target.nodePath}\0${target.property}`;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `__godotScriptAnimation_${(hash >>> 0).toString(16)}`;
}

const scriptTargetBindings = new WeakMap<
  Object3D,
  Map<string, { readonly instance: object; readonly target: GodotValueTrackScriptTarget; references: number }>
>();

/** Native mixer property seat forwarding through the exact translated ScriptInstance accessor. */
export function bindGodotValueTrackScriptTarget(
  root: Object3D,
  instance: object,
  target: GodotValueTrackScriptTarget,
): () => void {
  if (target.kind !== 'script-instance-property' || !(target.member in instance)) {
    throw new Error(
      `Godot Animation ScriptInstance target is not retained: ${target.scriptPath}:${target.property}.`,
    );
  }
  const property = scriptBindingName(target);
  let retained = scriptTargetBindings.get(root);
  if (retained === undefined) {
    retained = new Map();
    scriptTargetBindings.set(root, retained);
  }
  const existing = retained.get(property);
  if (existing === undefined) {
    if (Object.prototype.hasOwnProperty.call(root, property)) {
      throw new Error(`Godot ScriptInstance Animation binding collides with native property ${property}.`);
    }
    Object.defineProperty(root, property, {
      configurable: true,
      enumerable: false,
      get: () => Reflect.get(instance, target.member),
      set: (value: unknown) => {
        const valid =
          (target.valueKind === 'bool' && typeof value === 'boolean') ||
          (target.valueKind === 'int' && typeof value === 'number' && Number.isSafeInteger(value)) ||
          (target.valueKind === 'number' && typeof value === 'number') ||
          (target.valueKind === 'vector3' && typeof value === 'object' && value !== null &&
            'x' in value && 'y' in value && 'z' in value &&
            typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number');
        if (!valid) throw new TypeError(`Godot Animation script property ${target.scriptPath}:${target.property} requires ${target.valueKind}.`);
        if (!Reflect.set(instance, target.member, value)) {
          throw new Error(`Godot Animation could not set ScriptInstance property ${target.scriptPath}:${target.property}.`);
        }
      },
    });
    retained.set(property, { instance, target, references: 1 });
  } else {
    if (
      existing.instance !== instance || existing.target.scriptPath !== target.scriptPath ||
      existing.target.nodePath !== target.nodePath || existing.target.property !== target.property ||
      existing.target.member !== target.member || existing.target.valueKind !== target.valueKind
    ) throw new Error(`Godot ScriptInstance Animation target collision on ${target.scriptPath}:${target.property}.`);
    existing.references += 1;
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const binding = retained?.get(property);
    if (binding === undefined) return;
    binding.references -= 1;
    if (binding.references > 0) return;
    retained?.delete(property);
    delete (root as unknown as Record<string, unknown>)[property];
    if (retained?.size === 0) scriptTargetBindings.delete(root);
  };
}

const crossSurfaceScriptTargetBindings = new WeakMap<
  Object3D,
  Map<string, {
    readonly bindings: GodotCrossSurfaceValueTrackBindings;
    readonly instanceKey: string;
    readonly scenePath: string;
    readonly target: GodotValueTrackScriptTarget;
    references: number;
  }>
>();

/** Shared mixer seat for a ScriptInstance owned by the sibling native projection. */
export function bindGodotValueTrackCrossSurfaceScriptTarget(
  root: Object3D,
  bindings: GodotCrossSurfaceValueTrackBindings,
  instanceKey: string,
  scenePath: string,
  target: GodotValueTrackScriptTarget,
): () => void {
  if (!target.crossSurface) {
    throw new Error(`Godot cross-surface ScriptInstance target is not marked cross-surface.`);
  }
  const property = scriptBindingName(target);
  let retained = crossSurfaceScriptTargetBindings.get(root);
  if (retained === undefined) {
    retained = new Map();
    crossSurfaceScriptTargetBindings.set(root, retained);
  }
  const existing = retained.get(property);
  if (existing === undefined) {
    if (Object.prototype.hasOwnProperty.call(root, property)) {
      throw new Error(`Godot cross-surface ScriptInstance binding collides with native property ${property}.`);
    }
    Object.defineProperty(root, property, {
      configurable: true,
      enumerable: false,
      get: () => bindings.read(instanceKey, scenePath, target.nodePath, target.property),
      set: (value: unknown) => bindings.write(instanceKey, scenePath, target.nodePath, target.property, value),
    });
    retained.set(property, { bindings, instanceKey, scenePath, target, references: 1 });
  } else {
    if (
      existing.bindings !== bindings || existing.instanceKey !== instanceKey ||
      existing.scenePath !== scenePath || existing.target.kind !== target.kind ||
      existing.target.nodePath !== target.nodePath || existing.target.property !== target.property ||
      existing.target.member !== target.member || existing.target.scriptPath !== target.scriptPath ||
      existing.target.valueKind !== target.valueKind || existing.target.crossSurface !== target.crossSurface
    ) {
      throw new Error(
        `Godot cross-surface ScriptInstance Animation target collision on ${target.scriptPath}:${target.property}.`,
      );
    }
    existing.references += 1;
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const binding = retained?.get(property);
    if (binding === undefined) return;
    binding.references -= 1;
    if (binding.references > 0) return;
    retained?.delete(property);
    delete (root as unknown as Record<string, unknown>)[property];
    if (retained?.size === 0) crossSurfaceScriptTargetBindings.delete(root);
  };
}

function crossSurfaceBindingName(target: GodotValueTrackCrossSurfaceTarget): string {
  const identity = `${target.kind}\0${target.scenePath}\0${target.nodePath}\0${target.property}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `__godotCrossSurfaceAnimation_${(hash >>> 0).toString(16)}`;
}

export interface GodotCrossSurfaceValueTrackBindings {
  read(instanceKey: string, scenePath: string, nodePath: string, property: string): unknown;
  write(instanceKey: string, scenePath: string, nodePath: string, property: string, value: unknown): void;
}

const crossSurfaceTargetBindings = new WeakMap<
  Object3D,
  Map<string, { readonly target: GodotValueTrackCrossSurfaceTarget; references: number }>
>();

/** Install one Three AnimationMixer property seat backed by the sibling surface's retained node. */
export function bindGodotValueTrackCrossSurfaceTarget(
  root: Object3D,
  bindings: GodotCrossSurfaceValueTrackBindings,
  instanceKey: string,
  target: GodotValueTrackCrossSurfaceTarget,
): () => void {
  if (
    !(
      (target.kind === 'canvas-sprite-property' && target.property === 'frame') ||
      (target.kind === 'canvas-animation-tree-property' && target.property === 'active') ||
      (target.kind === 'canvas-node-property' &&
        ((target.property === 'visible' && target.valueKind === 'bool') ||
          (target.property === 'frame' && target.valueKind === 'number') ||
          (target.property === 'position' && target.valueKind === 'vector2') ||
          ((target.property === 'modulate' || target.property === 'self_modulate') &&
            target.valueKind === 'color')))
    )
  ) {
    throw new Error(`Unsupported Godot cross-surface Animation target ${JSON.stringify(target)}.`);
  }
  const property = crossSurfaceBindingName(target);
  let targets = crossSurfaceTargetBindings.get(root);
  if (targets === undefined) {
    targets = new Map();
    crossSurfaceTargetBindings.set(root, targets);
  }
  const existing = targets.get(property);
  if (existing !== undefined) {
    if (
      existing.target.kind !== target.kind ||
      existing.target.scenePath !== target.scenePath ||
      existing.target.nodePath !== target.nodePath ||
      existing.target.property !== target.property ||
      ('valueKind' in existing.target ? existing.target.valueKind : undefined) !==
        ('valueKind' in target ? target.valueKind : undefined)
    ) throw new Error(`Godot cross-surface Animation target collision on ${target.scenePath}#${target.nodePath}:${target.property}.`);
    existing.references += 1;
  } else {
    if (Object.prototype.hasOwnProperty.call(root, property)) {
      throw new Error(`Godot cross-surface Animation binding collides with native property ${property}.`);
    }
    if (
      target.kind === 'canvas-node-property' &&
      (target.valueKind === 'vector2' || target.valueKind === 'color')
    ) {
      const carrier = {
        fromArray(values: ArrayLike<number>, offset = 0) {
          const value = target.valueKind === 'vector2'
            ? { x: values[offset] as number, y: values[offset + 1] as number }
            : {
                r: values[offset] as number,
                g: values[offset + 1] as number,
                b: values[offset + 2] as number,
                a: values[offset + 3] as number,
              };
          bindings.write(instanceKey, target.scenePath, target.nodePath, target.property, value);
          return this;
        },
        toArray(values: number[], offset = 0): number[] {
          const value = bindings.read(instanceKey, target.scenePath, target.nodePath, target.property);
          if (target.valueKind === 'vector2') {
            if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) ||
                typeof value.x !== 'number' || typeof value.y !== 'number') {
              throw new TypeError(`Godot cross-surface ${target.scenePath}#${target.nodePath}:${target.property} is not Vector2.`);
            }
            values[offset] = value.x;
            values[offset + 1] = value.y;
          } else {
            if (typeof value !== 'object' || value === null ||
                !('r' in value) || !('g' in value) || !('b' in value) || !('a' in value) ||
                typeof value.r !== 'number' || typeof value.g !== 'number' ||
                typeof value.b !== 'number' || typeof value.a !== 'number') {
              throw new TypeError(`Godot cross-surface ${target.scenePath}#${target.nodePath}:${target.property} is not Color.`);
            }
            values[offset] = value.r;
            values[offset + 1] = value.g;
            values[offset + 2] = value.b;
            values[offset + 3] = value.a;
          }
          return values;
        },
      };
      Object.defineProperty(root, property, { configurable: true, enumerable: false, value: carrier });
    } else {
      Object.defineProperty(root, property, {
        configurable: true,
        enumerable: false,
        get: () => bindings.read(instanceKey, target.scenePath, target.nodePath, target.property),
        set: (value: unknown) => bindings.write(instanceKey, target.scenePath, target.nodePath, target.property, value),
      });
    }
    targets.set(property, { target, references: 1 });
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const retained = targets?.get(property);
    if (retained === undefined) return;
    retained.references -= 1;
    if (retained.references > 0) return;
    targets?.delete(property);
    delete (root as unknown as Record<string, unknown>)[property];
    if (targets?.size === 0) crossSurfaceTargetBindings.delete(root);
  };
}

const resourceTargetBindings = new WeakMap<
  Object3D,
  { readonly target: GodotValueTrackResourceTarget; references: number }
>();

/** Install the native Three AnimationMixer property seat for a typed Godot Resource subpath. */
export function bindGodotValueTrackResourceTarget(
  node: Object3D,
  target: GodotValueTrackResourceTarget,
): () => void {
  if (
    target.kind !== 'material-override-property' ||
    target.resource !== 'material_override' ||
    target.property !== 'emission_energy'
  ) {
    throw new Error(`Unsupported Godot Animation Resource target ${JSON.stringify(target)}.`);
  }
  const existing = resourceTargetBindings.get(node);
  if (existing !== undefined) {
    if (
      existing.target.kind !== target.kind ||
      existing.target.resource !== target.resource ||
      existing.target.property !== target.property ||
      existing.target.nodePath !== target.nodePath
    ) {
      throw new Error(`Godot Animation Resource target collision on ${target.nodePath}.`);
    }
    existing.references += 1;
  } else {
    if (Object.prototype.hasOwnProperty.call(node, MATERIAL_OVERRIDE_ENERGY_BINDING)) {
      throw new Error(
        `Godot Animation Resource binding collides with native property ${MATERIAL_OVERRIDE_ENERGY_BINDING}.`,
      );
    }
    Object.defineProperty(node, MATERIAL_OVERRIDE_ENERGY_BINDING, {
      configurable: true,
      enumerable: false,
      get: (): number => getGodotMeshMaterialOverrideEmissionEnergy(node),
      set: (value: unknown): void => setGodotMeshMaterialOverrideEmissionEnergy(node, value),
    });
    resourceTargetBindings.set(node, { target, references: 1 });
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const retained = resourceTargetBindings.get(node);
    if (retained === undefined) return;
    retained.references -= 1;
    if (retained.references > 0) return;
    resourceTargetBindings.delete(node);
    delete (node as unknown as Record<string, unknown>)[MATERIAL_OVERRIDE_ENERGY_BINDING];
  };
}

/**
 * One Godot `Animation` sub-resource whose tracks key node PROPERTIES: its `resource_name`, `length`,
 * `loop`, and the value tracks the emitter resolved.
 */
export interface GodotValueAnimation {
  /** `resource_name` — the clip's name (`AnimationPlayer`'s `anims/<name>` key). */
  readonly name: string;
  /** `length`, in seconds. */
  readonly length: number;
  /** `loop`. */
  readonly loop: boolean;
  /** The resolved `type = "value"` tracks. */
  readonly tracks: readonly GodotValueTrack[];
}

/** three's interpolation for a Godot value track's update/interp, or `undefined` for three's default
 *  (linear). Refuses by name every mode three cannot reproduce. */
function interpolation(track: GodotValueTrack, clip: string): InterpolationModes | undefined {
  if (track.update === GODOT_UPDATE_TRIGGER || track.update === GODOT_UPDATE_CAPTURE) {
    throw new Error(
      `godot-compat: value Animation "${clip}" track "${track.path}" uses update mode ` +
        `${track.update} (${track.update === GODOT_UPDATE_TRIGGER ? 'TRIGGER' : 'CAPTURE'}). ` +
        'TRIGGER fires a value once as the playhead crosses the key and CAPTURE blends from the ' +
        "property's live value — neither is a keyframe curve three's AnimationMixer samples, so " +
        'this backend refuses rather than shipping a lookalike.',
    );
  }
  if (track.kind === 'bool') {
    if (track.update !== GODOT_UPDATE_DISCRETE) {
      throw new Error(
        `godot-compat: value Animation "${clip}" track "${track.path}" keys a boolean with update ` +
          `mode ${track.update}, not DISCRETE(1). three's BooleanKeyframeTrack cannot interpolate a ` +
          'boolean, and Godot authors boolean tracks as DISCRETE, so a continuous boolean is ' +
          'refused rather than approximated.',
      );
    }
    // BooleanKeyframeTrack is discrete by nature — no interpolation change to make.
    return undefined;
  }
  if (track.update === GODOT_UPDATE_DISCRETE) return InterpolateDiscrete;
  switch (track.interp) {
    case GODOT_INTERP_LINEAR:
      return undefined; // three's default linear interpolation.
    case GODOT_INTERP_NEAREST:
      return InterpolateDiscrete;
    case GODOT_INTERP_CUBIC:
      throw new Error(
        `godot-compat: value Animation "${clip}" track "${track.path}" is CUBIC (interp=2). Godot's ` +
          "cubic is a wrap-aware hermite three's InterpolateSmooth does not reproduce, so this " +
          'backend refuses rather than shipping a plausible-wrong curve.',
      );
    default:
      throw new Error(
        `godot-compat: value Animation "${clip}" track "${track.path}" has interp=${track.interp}, ` +
          "which is not one of Godot's NEAREST(0)/LINEAR(1)/CUBIC(2).",
      );
  }
}

/** Assert a track's flat `values` length matches its `times` × floats-per-key, or throw by name. */
function assertKeyCount(track: GodotValueTrack, clip: string): void {
  const perKey = track.kind === 'vector2' ? 2
    : track.kind === 'vector' || track.kind === 'euler' ? 3
      : track.kind === 'color' ? 4
        : 1;
  if (track.values.length !== track.times.length * perKey) {
    throw new Error(
      `godot-compat: value Animation "${clip}" track "${track.path}" has ${track.times.length} ` +
        `time(s) but ${track.values.length} value(s), not ${track.times.length * perKey} ` +
        `(${perKey} per key for a ${track.kind} track).`,
    );
  }
  if (track.transitions.length !== track.times.length) {
    throw new Error(
      `godot-compat: value Animation "${clip}" track "${track.path}" has ${track.times.length} ` +
        `time(s) but ${track.transitions.length} transition(s). Godot writes one easing exponent ` +
        'per key.',
    );
  }
}

/**
 * The ceiling on how many sub-samples one segment may be split into. A segment's step count is
 * driven by the ARC it turns, which is bounded; the refinement loop below can also raise it to
 * resolve a steep ease, and this stops a pathological exponent (`transition = 40`, whose curve is
 * flat then near-vertical) from minting an unbounded track. At the cap the emitted samples still
 * lie exactly on Godot's curve — only the straight lines between them get coarser.
 */
const EULER_RESAMPLE_MAX_STEPS = 4096;

/**
 * Resample a linearly-interpolated Euler-DEGREES track so no segment turns more than
 * {@link EULER_RESAMPLE_MAX_STEP_DEG} on any axis, matching Godot's own componentwise Euler lerp. A
 * DISCRETE track holds each value to the next key with no interpolation, so it is returned unchanged.
 * `values` is flat, three per key.
 *
 * `transitions` is the per-key easing exponent (one per input key; the segment leaving key `k` uses
 * `transitions[k]`). The ease is applied to each sub-sample's own segment position, so every
 * emitted sample is a point Godot's `Math::ease`-remapped lerp actually passes through — that is
 * why an eased Euler track is resampled rather than handed the interpolant factory the other kinds
 * use: the factory keys its exponents to the ORIGINAL segments, which this resample replaces.
 * Because an ease can concentrate the turn into part of the segment, the step count is refined
 * until the sub-samples themselves respect the same per-axis limit.
 */
function resampleEulerDegrees(
  times: readonly number[],
  values: readonly number[],
  discrete: boolean,
  transitions: readonly number[],
): { times: number[]; values: number[] } {
  if (discrete || times.length < 2) return { times: [...times], values: [...values] };
  const outTimes: number[] = [];
  const outValues: number[] = [];
  for (let k = 0; k < times.length - 1; k += 1) {
    const t0 = times[k] as number;
    const t1 = times[k + 1] as number;
    const a = k * 3;
    const b = (k + 1) * 3;
    const curve = transitions[k] ?? 1;
    const delta = [
      (values[b] as number) - (values[a] as number),
      (values[b + 1] as number) - (values[a + 1] as number),
      (values[b + 2] as number) - (values[a + 2] as number),
    ] as const;
    const maxDelta = Math.max(...delta.map(Math.abs));
    // The eased position of sub-sample `s` of `count`. At `curve === 1` this is `s / count`, i.e.
    // exactly the uniform split an unaeased segment gets.
    const easedAt = (s: number, count: number): number => godotEase(s / count, curve);
    let steps = Math.max(1, Math.ceil(maxDelta / EULER_RESAMPLE_MAX_STEP_DEG));
    // Refine until no CONSECUTIVE pair of eased sub-samples turns more than the per-axis limit —
    // the uniform split only bounds the whole segment, and an ease redistributes it.
    while (steps < EULER_RESAMPLE_MAX_STEPS) {
      let worst = 0;
      for (let s = 0; s < steps; s += 1) {
        const span = Math.abs(easedAt(s + 1, steps) - easedAt(s, steps));
        worst = Math.max(worst, span * maxDelta);
      }
      if (worst <= EULER_RESAMPLE_MAX_STEP_DEG) break;
      steps = Math.min(steps * 2, EULER_RESAMPLE_MAX_STEPS);
    }
    // Emit the segment's start and its interior points; the final key is emitted once, after the loop,
    // so adjacent segments do not double it.
    for (let s = 0; s < steps; s += 1) {
      const f = easedAt(s, steps);
      outTimes.push(t0 + ((t1 - t0) * s) / steps);
      outValues.push(
        (values[a] as number) + delta[0] * f,
        (values[a + 1] as number) + delta[1] * f,
        (values[a + 2] as number) + delta[2] * f,
      );
    }
  }
  const last = times.length - 1;
  outTimes.push(times[last] as number);
  outValues.push(
    values[last * 3] as number,
    values[last * 3 + 1] as number,
    values[last * 3 + 2] as number,
  );
  return { times: outTimes, values: outValues };
}

/**
 * A `QuaternionKeyframeTrack` for an Euler-DEGREES value track. Each Euler triple is converted to a
 * quaternion through the SAME `'YXZ'` order `spatial.ts`/`gltf-model.ts` use, after resampling a
 * linear track (see {@link resampleEulerDegrees}). three has no Euler keyframe track, so this is the
 * faithful carrier — a quaternion slerp along the arc Godot's Euler lerp traces.
 */
function buildEulerQuaternionTrack(
  track: GodotValueTrack,
  discrete: boolean,
): QuaternionKeyframeTrack {
  const resampled = resampleEulerDegrees(track.times, track.values, discrete, track.transitions);
  const euler = new Euler(0, 0, 0, 'YXZ');
  const quaternion = new Quaternion();
  const toRadians = Math.PI / 180;
  const quaternions: number[] = [];
  for (let i = 0; i < resampled.times.length; i += 1) {
    const base = i * 3;
    euler.set(
      (resampled.values[base] as number) * toRadians,
      (resampled.values[base + 1] as number) * toRadians,
      (resampled.values[base + 2] as number) * toRadians,
      'YXZ',
    );
    quaternion.setFromEuler(euler);
    quaternions.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  return new QuaternionKeyframeTrack(track.path, resampled.times, quaternions);
}

/**
 * Build a `THREE.AnimationClip` from a Godot value-track `Animation`. Each resolved track becomes the
 * matching three keyframe track (`bool` → `BooleanKeyframeTrack`, `number` → `NumberKeyframeTrack`,
 * `vector2`/`vector`/`color` → `VectorKeyframeTrack`, `euler` → `QuaternionKeyframeTrack`), with Godot's update/interp
 * mapped to three's interpolation and every mode three cannot reproduce refused by name.
 */
export function buildValueTrackClip(animation: GodotValueAnimation): AnimationClip {
  const tracks: KeyframeTrack[] = [];
  for (const track of animation.tracks) {
    assertKeyCount(track, animation.name);
    const interp = interpolation(track, animation.name);
    const times = [...track.times];
    let built: KeyframeTrack;
    switch (track.kind) {
      case 'bool':
        built = new BooleanKeyframeTrack(
          valueTrackBindingPath(track),
          times,
          track.values.map((v) => v !== 0),
        );
        break;
      case 'number':
        built = new NumberKeyframeTrack(valueTrackBindingPath(track), times, [...track.values]);
        break;
      case 'vector2':
      case 'vector':
      case 'color':
        built = new VectorKeyframeTrack(valueTrackBindingPath(track), times, [...track.values]);
        break;
      case 'euler':
        // Resample-and-convert owns this track's times/values, so the shared `times`/`built` path
        // below (built from the RAW keys) does not apply — a quaternion track carries 4 floats per
        // resampled key, not the Euler triple.
        built = buildEulerQuaternionTrack(track, interp === InterpolateDiscrete);
        break;
    }
    if (interp !== undefined) built.setInterpolation(interp);
    // Godot's per-key easing, on the kinds whose ORIGINAL key grid survives into the built track.
    // `bool` is discrete by nature and a DISCRETE/NEAREST track holds its key value, so neither
    // reaches an interpolation factor in Godot either; `euler` baked the ease into its resample.
    if (
      (track.kind === 'number' || track.kind === 'vector2' || track.kind === 'vector' || track.kind === 'color') &&
      interp === undefined &&
      isGodotEased(track.transitions)
    ) {
      withGodotTransitions(built, track.transitions, false);
    }
    tracks.push(built);
  }
  // three's AnimationClip length defaults to the max track time; Godot's `length` can exceed that (a
  // clip padded past its last key), so pass it through — the same period-fidelity buildSkeletalClip keeps.
  return new AnimationClip(animation.name, animation.length, tracks);
}

/* ────────────────────────────── node-ACTION tracks ──────────────────────────────
 *
 * A value `Animation` can key more than a node PROPERTY: `coin.tscn`'s `take` clip keys
 * `Particles:emitting` and `Sound:playing`, which are node ACTIONS — the playhead crossing the key
 * START the CPUParticles emitter and PLAY the AudioStreamPlayer. three's `AnimationMixer` keyframes
 * OBJECT PROPERTIES (it writes `object.property = value` each sampled frame), so it is the wrong
 * instrument for a fire-once action against a target that is not even an `Object3D` in the graph (the
 * audio player is a compat FIELD, the particle system a compat helper). The refusal `interpolation`
 * makes for a `TRIGGER` value track is the same reason: three has no "fire as the head crosses the
 * key" curve.
 *
 * So node actions are carried BESIDE the mixer, not through it: a schedule that reads the clip's own
 * playhead (three's `AnimationAction.time`) and, exactly when the head crosses a key, calls the
 * action the emitter bound to that node. It owns NO clock — the caller steps the mixer, and this
 * reads the mixer's action time right after. This is the `euler`-shaped extension: a new kind of
 * track a value clip can carry, reduced to the one thing that needs a runtime — firing at the right
 * time — with the target call left to the emitter (which holds the scene graph), the same
 * responsibility split `buildValueTrackClip` keeps.
 */

/** One node-ACTION track, resolved by the emitter into the CALL to make. `fire(on)` runs the node
 *  action (`this.Particles.setEmitting(on)`, `on ? this.Sound.play() : this.Sound.stop()`); the
 *  emitter writes the closure because only it knows the node's field. `values` is one boolean per
 *  key (Godot's `emitting`/`playing` value at that key). */
export interface ScheduledNodeAction {
  /** The keyframe times, seconds into the clip. */
  readonly times: readonly number[];
  /** The boolean the node action is called with at each key — one per {@link times} entry. */
  readonly values: readonly boolean[];
  /** Run the node action. Called once as the playhead crosses each key. */
  fire(on: boolean): void;
}

/** One method-track key set, resolved by the emitter into the CALL to make at each keyframe. Godot
 *  `AnimationPlayer` METHOD tracks invoke a node method (with args) at a keyframe time; three's
 *  `AnimationMixer` keyframes PROPERTIES, not calls, so the call is carried here on the same crossing
 *  machinery as a node action. Unlike a node action there is no on/off value — `fire(i)` performs the
 *  i-th key's resolved call (its method + args closed over by the emitter, which alone knows the
 *  surface-table spelling of `queue_free` etc.). */
export interface ScheduledMethodCall {
  /** The keyframe times, seconds into the clip. */
  readonly times: readonly number[];
  /** Perform the i-th key's method call. Called once as the playhead crosses each key. */
  fire(i: number): void;
}

/** The per-player node-action schedule: the actions AND method calls of each clip, plus the small
 *  crossing state {@link stepNodeActions} keeps so a key fires exactly once per pass and re-fires when
 *  the clip is replayed. Built by {@link createNodeActionSchedule}. */
export interface NodeActionScheduleState {
  /** Clip name → its node-action tracks (`emitting`/`playing`). */
  readonly actions: ReadonlyMap<string, readonly ScheduledNodeAction[]>;
  /** Clip name → its method-CALL tracks (`queue_free`), fired by the same crossing logic. */
  readonly methods: ReadonlyMap<string, readonly ScheduledMethodCall[]>;
  /** Godot 3 AnimationPlayer METHOD_CALL_DEFERRED queues calls through SceneTree's message queue. */
  readonly deferMethod?: (invoke: () => void) => void;
  /** The clip name observed on the previous step, to detect a clip change. */
  lastName: string | null;
  /** The playhead time observed on the previous step, to detect a replay (time going backwards). */
  lastTime: number;
}

/** Build a node-action schedule from the emitter's clip→actions and clip→methods maps. A player with
 *  only node-action tracks passes just the first map; the method map defaults to empty. */
export function createNodeActionSchedule(
  actions: ReadonlyMap<string, readonly ScheduledNodeAction[]>,
  methods: ReadonlyMap<string, readonly ScheduledMethodCall[]> = new Map(),
  deferMethod?: (invoke: () => void) => void,
): NodeActionScheduleState {
  return { actions, methods, ...(deferMethod === undefined ? {} : { deferMethod }), lastName: null, lastTime: 0 };
}

/** The slice of an {@link AnimationPlayerState} {@link stepNodeActions} reads: the current clip name
 *  and its running action's playhead. Structural so this file needs no import of `animation-player.ts`
 *  (which a merge with a sibling touching that file must not fight over). */
export interface NodeActionHead {
  readonly currentName: string | null;
  readonly current: { readonly time: number } | null;
}

/**
 * Fire every node-action key the playhead crossed since the last step. Called right after the
 * player's `mixer.update(delta)`, so `head.current.time` is this frame's clip time.
 *
 * A key at time `t` fires when `prev < t <= now` — half-open so a key exactly on a frame boundary
 * fires once, never twice. A clip change or a backwards jump (a replay — `play("take")` rewinds the
 * action to 0) resets `prev` to `-∞`, so a `t = 0` key (every measured action key) fires on the first
 * step of each playback, matching Godot re-arming the action every time the clip plays.
 */
export function stepNodeActions(head: NodeActionHead, schedule: NodeActionScheduleState): void {
  const name = head.currentName;
  const current = head.current;
  if (name === null || current === null) {
    schedule.lastName = name;
    schedule.lastTime = 0;
    return;
  }
  const now = current.time;
  const replayed = name !== schedule.lastName || now < schedule.lastTime;
  const prev = replayed ? Number.NEGATIVE_INFINITY : schedule.lastTime;
  const tracks = schedule.actions.get(name);
  if (tracks !== undefined) {
    for (const track of tracks) {
      for (let i = 0; i < track.times.length; i += 1) {
        const t = track.times[i] as number;
        if (t > prev && t <= now) track.fire(track.values[i] as boolean);
      }
    }
  }
  // Method-CALL tracks fire AFTER the node actions of the same step: Godot runs a clip's tracks in
  // index order, and a method track (the enemy's/bullet's `queue_free`/`_die`, authored last) crosses
  // after the `emitting`/`playing` node actions — and a self-destruct (`queue_free`) must run last so
  // the actions it would otherwise touch have already fired this step.
  const methodTracks = schedule.methods.get(name);
  if (methodTracks !== undefined) {
    for (const track of methodTracks) {
      for (let i = 0; i < track.times.length; i += 1) {
        const t = track.times[i] as number;
        if (t > prev && t <= now) {
          const invoke = (): void => track.fire(i);
          if (schedule.deferMethod === undefined) invoke();
          else schedule.deferMethod(invoke);
        }
      }
    }
  }
  schedule.lastName = name;
  schedule.lastTime = now;
}
