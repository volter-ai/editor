/**
 * A CHARACTER'S ANIMATION IN A GAME: layered, weighted actions on one armature's bones, and a
 * look-at for targets only the game knows.
 *
 * LAYERS: the base layer plays on every bone; a named layer plays on the bones from one bone down
 * (`from: 'spine_01'`: the upper body), and takes those bones from the base. So legs can run while
 * the upper body aims. A layer holds any number of actions at weights (`blend`); setting one action
 * is a blend of that one, crossfaded (`set`).
 *
 * LOOK-AT: turns one bone so its axis points at a point, after the actions, by a weight and within
 * an angle. The axis is the bone's FORWARD unless given: the direction in the bone that pointed the
 * way the character faces (Blender's convention, the armature's -Y) in the pose the file was in. A
 * bone's own Y runs along it, out of the top of a head, so it is not what "look" means. It is the game's, not Blender's: Blender's own IK and constraints are what an action was
 * authored with; this aims at what exists only while the game runs (an aim target, the player).
 *
 * Everything advances on the game's clock (`update(dt)`).
 */
import * as THREE from 'three';

export interface LayerOptions {
  /** The layer: `base` (default) or a name of the game's choosing. */
  readonly layer?: string;
  /** For a layer other than `base`: the bone it plays from, with every bone below it. */
  readonly from?: string;
  /** Seconds for weights to reach what was set (default 0.2 for `set`, 0 for `blend`). */
  readonly fade?: number;
  /** Repeat (default true); `false` plays once and holds the last frame. */
  readonly loop?: boolean;
  /** Playback rate, 1 is the action's own. */
  readonly speed?: number;
  /** Start again from the first frame when this action already plays on the layer. */
  readonly restart?: boolean;
}

export interface LookAtOptions {
  /** How far toward the target, 0 to 1 (default 1). */
  readonly weight?: number;
  /** The bone's local axis that should point at the target: `forward` (default, see the header)
   *  or one of the bone's own axes (`y` is a Blender bone's length). */
  readonly axis?: 'forward' | 'x' | 'y' | 'z' | '-x' | '-y' | '-z';
  /** The most it turns away from the animated pose, in degrees (default 75). */
  readonly limit?: number;
}

interface Entry {
  readonly name: string;
  action: THREE.AnimationAction | null;
  weight: number;
  target: number;
  rate: number;
  loop: boolean;
  speed: number;
}

interface Layer {
  readonly name: string;
  from: string | null;
  /** The bones it plays on, by uuid; null for the base (everything other layers do not hold). */
  bones: Set<string> | null;
  readonly entries: Map<string, Entry>;
}

const AXES: Record<Exclude<NonNullable<LookAtOptions['axis']>, 'forward'>, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1),
  '-x': new THREE.Vector3(-1, 0, 0), '-y': new THREE.Vector3(0, -1, 0), '-z': new THREE.Vector3(0, 0, -1),
};

export class LayeredMixer {
  readonly #mixer: THREE.AnimationMixer;
  readonly #layers = new Map<string, Layer>();
  readonly #masked = new Map<string, THREE.AnimationClip>();
  readonly #looks = new Map<string, { bone: THREE.Bone; target: THREE.Vector3 | THREE.Object3D; options: LookAtOptions }>();
  /** Each bone's forward in its own space, from the pose the file was in (before any action). */
  readonly #forward = new Map<string, THREE.Vector3>();

  /** `clipFor` answers an action's full clip, or null while it is not available yet (a bake in
   *  flight); the mixer asks again on later updates. */
  constructor(
    readonly root: THREE.Object3D,
    readonly bones: ReadonlyMap<string, THREE.Bone>,
    private readonly clipFor: (action: string) => THREE.AnimationClip | null,
  ) {
    this.#mixer = new THREE.AnimationMixer(root);
    // The character faces the armature's -Y, as in Blender; each bone's forward is that direction
    // in the bone's frame at the pose the file was in.
    root.updateWorldMatrix(true, true);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const facing = new THREE.Vector3(0, -1, 0).applyQuaternion(rootWorld);
    for (const [name, bone] of bones) {
      const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
      this.#forward.set(name, facing.clone().applyQuaternion(boneWorld.invert()).normalize());
    }
    this.#layers.set('base', { name: 'base', from: null, bones: null, entries: new Map() });
  }

  /** Play one action on a layer, crossfading the layer's others out. */
  set(action: string, options: LayerOptions = {}): string | null {
    const layer = this.#layer(options);
    if (typeof layer === 'string') return layer;
    const held = layer.entries.get(action);
    if (held && options.restart) held.action?.reset();
    this.#weigh(layer, { [action]: 1 }, options.fade ?? 0.2, options);
    return null;
  }

  /** Set a layer's actions at weights; an action left out fades to nothing. */
  blend(weights: Readonly<Record<string, number>>, options: LayerOptions = {}): string | null {
    const layer = this.#layer(options);
    if (typeof layer === 'string') return layer;
    this.#weigh(layer, weights, options.fade ?? 0, options);
    return null;
  }

  /** Fade out what a layer plays (the base: everything the character plays). */
  stop(options: LayerOptions = {}): void {
    const layer = this.#layers.get(options.layer ?? 'base');
    if (layer) this.#weigh(layer, {}, options.fade ?? 0.2, options);
  }

  /** The action that weighs most on a layer, as set (what a script asked for), or null. */
  playing(layer = 'base'): string | null {
    let best: Entry | null = null;
    for (const entry of this.#layers.get(layer)?.entries.values() ?? []) if (entry.target > 0 && (!best || entry.target > best.target)) best = entry;
    return best?.name ?? null;
  }

  /** Turn `bone` toward `target` (world point or object) every update until set to null. */
  lookAt(bone: string, target: THREE.Vector3 | THREE.Object3D | null, options: LookAtOptions = {}): string | null {
    if (target === null) { this.#looks.delete(bone); return null; }
    const found = this.bones.get(bone);
    if (!found) return `no bone "${bone}"`;
    this.#looks.set(bone, { bone: found, target, options: { ...options, axis: options.axis ?? 'forward' } });
    return null;
  }

  update(dt: number): void {
    for (const layer of this.#layers.values()) {
      for (const [name, entry] of [...layer.entries]) {
        if (!entry.action) entry.action = this.#action(layer, name, entry);
        entry.weight = entry.rate <= 0 ? entry.target
          : entry.weight < entry.target ? Math.min(entry.target, entry.weight + dt * entry.rate)
          : Math.max(entry.target, entry.weight - dt * entry.rate);
        if (entry.action) entry.action.setEffectiveWeight(entry.weight);
        if (entry.weight === 0 && entry.target === 0) {
          entry.action?.stop();
          layer.entries.delete(name);
        }
      }
    }
    this.#mixer.update(dt);
    for (const look of this.#looks.values()) this.#turn(look.bone, look.target, look.options);
  }

  dispose(): void {
    this.#mixer.stopAllAction();
    this.#looks.clear();
  }

  // ---------------------------------------------------------------- internals

  #layer(options: LayerOptions): Layer | string {
    const name = options.layer ?? 'base';
    if (name === 'base') return this.#layers.get('base')!;
    let layer = this.#layers.get(name);
    if (!layer || (options.from !== undefined && options.from !== layer.from)) {
      if (!options.from) return `layer "${name}" needs the bone it plays from (\`from\`)`;
      const root = this.bones.get(options.from);
      if (!root) return `no bone "${options.from}" for layer "${name}"`;
      const bones = new Set<string>();
      root.traverse((child) => { if ((child as THREE.Bone).isBone) bones.add(child.uuid); });
      if (layer) for (const entry of layer.entries.values()) entry.action?.stop();
      layer = { name, from: options.from, bones, entries: layer?.entries ?? new Map() };
      for (const entry of layer.entries.values()) entry.action = null;
      this.#layers.set(name, layer);
      // The base gives up these bones: its actions are rebuilt over what it still holds.
      for (const entry of this.#layers.get('base')!.entries.values()) { entry.action?.stop(); entry.action = null; }
    }
    return layer;
  }

  #weigh(layer: Layer, weights: Readonly<Record<string, number>>, fade: number, options: LayerOptions): void {
    const rate = fade > 0 ? 1 / fade : 0;
    for (const entry of layer.entries.values()) { entry.target = 0; entry.rate = rate; }
    for (const [name, raw] of Object.entries(weights)) {
      const target = Math.max(0, Math.min(1, raw));
      const entry = layer.entries.get(name) ?? { name, action: null, weight: 0, target: 0, rate, loop: true, speed: 1 };
      entry.target = target;
      entry.rate = rate;
      entry.loop = options.loop ?? entry.loop;
      entry.speed = options.speed ?? entry.speed;
      if (entry.action) this.#configure(entry.action, entry);
      layer.entries.set(name, entry);
    }
  }

  /** The action of `name` on `layer`: its clip limited to the layer's bones. */
  #action(layer: Layer, name: string, entry: Entry): THREE.AnimationAction | null {
    const full = this.clipFor(name);
    if (!full) return null;
    const allowed = layer.bones ?? this.#baseBones();
    const key = `${name}\u0000${layer.name}\u0000${allowed.size}`;
    let clip = this.#masked.get(key);
    if (!clip) {
      const tracks = full.tracks.filter((track) => allowed.has(track.name.slice(0, track.name.indexOf('.'))));
      clip = new THREE.AnimationClip(`${name}@${layer.name}`, full.duration, tracks);
      this.#masked.set(key, clip);
    }
    const action = this.#mixer.clipAction(clip);
    this.#configure(action, entry);
    action.setEffectiveWeight(entry.weight);
    action.play();
    return action;
  }

  #configure(action: THREE.AnimationAction, entry: Entry): void {
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce, Number.POSITIVE_INFINITY);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveTimeScale(entry.speed);
  }

  /** Every bone no named layer holds. */
  #baseBones(): Set<string> {
    const taken = new Set<string>();
    for (const layer of this.#layers.values()) for (const uuid of layer.bones ?? []) taken.add(uuid);
    const bones = new Set<string>();
    for (const bone of this.bones.values()) if (!taken.has(bone.uuid)) bones.add(bone.uuid);
    return bones;
  }

  #turn(bone: THREE.Bone, target: THREE.Vector3 | THREE.Object3D, options: LookAtOptions): void {
    const weight = Math.max(0, Math.min(1, options.weight ?? 1));
    if (weight === 0) return;
    bone.updateWorldMatrix(true, false);
    // A script's Vector3 may come from its own copy of three, so it is recognised by its flag.
    const at = (target as THREE.Vector3).isVector3 ? new THREE.Vector3().copy(target as THREE.Vector3) : (target as THREE.Object3D).getWorldPosition(new THREE.Vector3());
    const position = new THREE.Vector3();
    const world = new THREE.Quaternion();
    bone.matrixWorld.decompose(position, world, new THREE.Vector3());
    const desired = at.sub(position);
    if (desired.lengthSq() < 1e-10) return;
    desired.normalize();
    const axis = options.axis ?? 'forward';
    const local = axis === 'forward' ? this.#forward.get(bone.name) ?? AXES.y : AXES[axis];
    const current = local.clone().applyQuaternion(world).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(current, desired);
    const limit = THREE.MathUtils.degToRad(options.limit ?? 75);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    const amount = angle > limit ? (limit / angle) * weight : weight;
    const applied = new THREE.Quaternion().slerp(turn, amount);
    const next = applied.multiply(world);
    const parent = new THREE.Quaternion();
    bone.parent?.getWorldQuaternion(parent);
    bone.quaternion.copy(parent.invert().multiply(next));
    bone.updateMatrixWorld(true);
  }
}
