/**
 * A CHARACTER'S ANIMATION IN A GAME: layered, weighted actions on one armature's bones, and a
 * look-at for targets only the game knows.
 *
 * LAYERS: the base layer plays on every bone; a named layer plays on the bones from one bone down
 * (`from: 'spine_01'`: the upper body), over the base. So legs can run while the upper body aims.
 * A layer holds any number of actions at weights (`blend`); setting one action is a blend of that
 * one, crossfaded (`set`).
 *
 * HOW A LAYER COVERS THE BASE: on a named layer's bones the base plays at (1 - that layer's
 * weight), so a layer fading in crossfades from the base, and a layer with nothing playing gives
 * those bones back to the base whole. Each action is played once per region of bones (the bones no
 * named layer holds, and each named layer's own), all at one clock: rebuilding the regions, when a
 * layer is created, keeps every action's time, so the legs never restart. A bone in two named
 * layers belongs to the one created first.
 *
 * LOOK-AT: turns one bone so its axis points at a point, after the actions, by a weight and within
 * an angle. The axis is the bone's FORWARD unless given: the direction in the bone that pointed the
 * way the character faces (Blender's convention, the armature's -Y) in the pose the file was in. A
 * bone's own Y runs along it, out of the top of a head, so it is not what "look" means. Each update
 * turns from the pose the actions gave (or, on a bone no action moves, the pose before the first
 * turn), never from the last turn, and ending a look-at puts that pose back.
 *
 * It is the game's, not Blender's: Blender's own IK and constraints are what an action was
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
  /** Its action on each region it plays on, by region key. */
  readonly actions: Map<string, THREE.AnimationAction>;
  /** The clock while it has no actions (regions being rebuilt, or a clip not baked yet). */
  time: number;
  weight: number;
  target: number;
  rate: number;
  loop: boolean;
  speed: number;
}

interface Layer {
  readonly name: string;
  from: string | null;
  /** The bones its `from` reaches, by uuid; null for the base. */
  reach: Set<string> | null;
  readonly entries: Map<string, Entry>;
}

interface Region {
  readonly key: string;
  /** The named layer whose bones these are; null for the bones no named layer holds. */
  readonly layer: string | null;
  readonly bones: Set<string>;
}

interface Look {
  readonly bone: THREE.Bone;
  readonly target: THREE.Vector3 | THREE.Object3D;
  readonly options: LookAtOptions;
  /** The pose the turn starts from: what the actions left, or the bone's own pose. */
  readonly from: THREE.Quaternion;
}

const AXES: Record<Exclude<NonNullable<LookAtOptions['axis']>, 'forward'>, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1),
  '-x': new THREE.Vector3(-1, 0, 0), '-y': new THREE.Vector3(0, -1, 0), '-z': new THREE.Vector3(0, 0, -1),
};

export class LayeredMixer {
  readonly #mixer: THREE.AnimationMixer;
  readonly #layers = new Map<string, Layer>();
  /** Masked clips by `action@region key`, dropped from the mixer when the regions change. */
  readonly #masked = new Map<string, THREE.AnimationClip>();
  readonly #looks = new Map<string, Look>();
  /** Each bone's forward in its own space, from the pose the file was in (before any action). */
  readonly #forward = new Map<string, THREE.Vector3>();
  #regions: Region[];
  #generation = 0;

  /** `clipFor` answers an action's full clip, or null while it is not available yet (a bake in
   *  flight); the mixer asks again on later updates. */
  constructor(
    readonly root: THREE.Object3D,
    readonly bones: ReadonlyMap<string, THREE.Bone>,
    private readonly clipFor: (action: string) => THREE.AnimationClip | null,
  ) {
    this.#mixer = new THREE.AnimationMixer(root);
    this.#layers.set('base', { name: 'base', from: null, reach: null, entries: new Map() });
    this.#regions = this.#divide();
    // The character faces the armature's -Y, as in Blender; each bone's forward is that direction
    // in the bone's frame at the pose the file was in.
    root.updateWorldMatrix(true, true);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const facing = new THREE.Vector3(0, -1, 0).applyQuaternion(rootWorld);
    for (const [name, bone] of bones) {
      const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
      this.#forward.set(name, facing.clone().applyQuaternion(boneWorld.invert()).normalize());
    }
  }

  /** Play one action on a layer, crossfading the layer's others out. */
  set(action: string, options: LayerOptions = {}): string | null {
    const layer = this.#layer(options);
    if (typeof layer === 'string') return layer;
    const held = layer.entries.get(action);
    if (held && options.restart) {
      held.time = 0;
      for (const played of held.actions.values()) played.reset();
    }
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

  /** Fade out what a layer plays (the base: everything the character plays under its layers). */
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
    const held = this.#looks.get(bone);
    if (target === null) {
      if (held) { held.bone.quaternion.copy(held.from); held.bone.updateMatrixWorld(true); }
      this.#looks.delete(bone);
      return null;
    }
    const found = this.bones.get(bone);
    if (!found) return `no bone "${bone}"`;
    const from = held?.from ?? found.quaternion.clone();
    this.#looks.set(bone, { bone: found, target, options: { ...options, axis: options.axis ?? 'forward' }, from });
    return null;
  }

  update(dt: number): void {
    for (const layer of this.#layers.values()) {
      for (const [name, entry] of [...layer.entries]) {
        entry.weight = entry.rate <= 0 ? entry.target
          : entry.weight < entry.target ? Math.min(entry.target, entry.weight + dt * entry.rate)
          : Math.max(entry.target, entry.weight - dt * entry.rate);
        if (entry.weight === 0 && entry.target === 0) {
          this.#release(entry);
          layer.entries.delete(name);
        }
      }
    }
    // How much of the base each named layer covers on its own bones.
    const cover = new Map<string, number>();
    for (const layer of this.#layers.values()) {
      if (layer.name === 'base') continue;
      let sum = 0;
      for (const entry of layer.entries.values()) if (entry.actions.size || this.clipFor(entry.name)) sum += entry.weight;
      cover.set(layer.name, Math.min(1, sum));
    }
    for (const layer of this.#layers.values()) {
      for (const entry of layer.entries.values()) {
        for (const region of this.#regions) {
          if (layer.name !== 'base' && region.layer !== layer.name) continue;
          const action = entry.actions.get(region.key) ?? this.#start(entry, region);
          if (!action) continue;
          const covered = layer.name === 'base' && region.layer !== null ? cover.get(region.layer) ?? 0 : 0;
          action.setEffectiveWeight(entry.weight * (1 - covered));
        }
      }
    }
    // A look-at turns from what the actions give; on a bone no action moves, from its own pose.
    for (const look of this.#looks.values()) look.bone.quaternion.copy(look.from);
    this.#mixer.update(dt);
    for (const [name, look] of this.#looks) {
      look.from.copy(look.bone.quaternion);
      this.#turn(name, look);
    }
  }

  dispose(): void {
    this.#mixer.stopAllAction();
    for (const clip of this.#masked.values()) this.#mixer.uncacheClip(clip);
    this.#masked.clear();
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
      const reach = new Set<string>();
      root.traverse((child) => { if ((child as THREE.Bone).isBone) reach.add(child.uuid); });
      if (layer) { layer.from = options.from; layer.reach = reach; }
      else { layer = { name, from: options.from, reach, entries: new Map() }; this.#layers.set(name, layer); }
      this.#redivide();
    }
    return layer;
  }

  /** The bones no named layer holds, and each named layer's own (first created wins a bone). */
  #divide(): Region[] {
    const generation = ++this.#generation;
    const taken = new Set<string>();
    const regions: Region[] = [];
    for (const layer of this.#layers.values()) {
      if (!layer.reach) continue;
      const bones = new Set<string>();
      for (const uuid of layer.reach) if (!taken.has(uuid)) { bones.add(uuid); taken.add(uuid); }
      regions.push({ key: `${layer.name}#${generation}`, layer: layer.name, bones });
    }
    const free = new Set<string>();
    for (const bone of this.bones.values()) if (!taken.has(bone.uuid)) free.add(bone.uuid);
    regions.unshift({ key: `free#${generation}`, layer: null, bones: free });
    return regions;
  }

  /** New regions: every action is rebuilt over them on the next update, at the time it had. */
  #redivide(): void {
    for (const layer of this.#layers.values()) for (const entry of layer.entries.values()) this.#release(entry);
    for (const clip of this.#masked.values()) this.#mixer.uncacheClip(clip);
    this.#masked.clear();
    this.#regions = this.#divide();
  }

  /** Stop an entry's actions, keeping its clock for when they are built again. */
  #release(entry: Entry): void {
    for (const action of entry.actions.values()) {
      entry.time = action.time;
      action.stop();
    }
    entry.actions.clear();
  }

  #weigh(layer: Layer, weights: Readonly<Record<string, number>>, fade: number, options: LayerOptions): void {
    const rate = fade > 0 ? 1 / fade : 0;
    for (const entry of layer.entries.values()) { entry.target = 0; entry.rate = rate; }
    for (const [name, raw] of Object.entries(weights)) {
      const target = Math.max(0, Math.min(1, raw));
      const entry = layer.entries.get(name) ?? { name, actions: new Map(), time: 0, weight: 0, target: 0, rate, loop: true, speed: 1 };
      entry.target = target;
      entry.rate = rate;
      entry.loop = options.loop ?? entry.loop;
      entry.speed = options.speed ?? entry.speed;
      for (const action of entry.actions.values()) this.#configure(action, entry);
      layer.entries.set(name, entry);
    }
  }

  /** An entry's action on one region: its clip limited to the region's bones, at the entry's
   *  clock (any of its running actions', or the one kept while it had none). */
  #start(entry: Entry, region: Region): THREE.AnimationAction | null {
    const full = this.clipFor(entry.name);
    if (!full) return null;
    const key = `${entry.name}@${region.key}`;
    let clip = this.#masked.get(key);
    if (!clip) {
      const tracks = full.tracks.filter((track) => region.bones.has(track.name.slice(0, track.name.indexOf('.'))));
      clip = new THREE.AnimationClip(key, full.duration, tracks);
      this.#masked.set(key, clip);
    }
    const action = this.#mixer.clipAction(clip);
    this.#configure(action, entry);
    const running = entry.actions.values().next();
    action.time = running.done ? entry.time : running.value.time;
    action.setEffectiveWeight(0);
    action.play();
    entry.actions.set(region.key, action);
    return action;
  }

  #configure(action: THREE.AnimationAction, entry: Entry): void {
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce, Number.POSITIVE_INFINITY);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveTimeScale(entry.speed);
  }

  #turn(name: string, look: Look): void {
    const { bone, target, options } = look;
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
    const local = axis === 'forward' ? this.#forward.get(name) ?? AXES.y : AXES[axis];
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
