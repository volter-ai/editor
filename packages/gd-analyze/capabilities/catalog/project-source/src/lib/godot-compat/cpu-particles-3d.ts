/**
 * @godot-class CPUParticles3D
 * @role BINDING
 *
 * Godot 4.7's `CPUParticles3D` (`scene/3d/cpu_particles_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the particle system a three.js developer writes:
 * an `InstancedMesh` of the node's mesh with one instance per particle, and a small emitter that
 * spawns, moves and fades the particles each frame, run from the node's own component
 * (`useGodotAdvance`: R3F's `useFrame`), drawing its randomness from `Math.random`. Godot's source is
 * read for what each property means, never for how its simulation steps.
 *
 * The emitter: `amount` particles each `lifetime`, spread over it (`explosiveness` gathers them at
 * the cycle's start, `randomness` jitters their spacing); a `one_shot` system runs one cycle and
 * stops emitting. Each particle starts in the emission shape (a point, a sphere, a sphere's surface
 * or a box), leaves within `spread` degrees of `direction` at its initial velocity, falls under
 * `gravity`, speeds up by its linear acceleration, slows by its damping, turns by its angle and
 * angular velocity, and scales and colours over its life by the scale curve, colour ramp and alpha
 * curve. With `local_coords` the particles move with the node; without, they are left in the
 * world where they were emitted. A GPUParticles3D is the same system reading its process material
 * (`gpu-particles-3d.ts`).
 *
 * Each particle's colour and its angle and life fraction are per-instance attributes
 * (`godotInstanceColor`, `godotInstanceCustom`) that a Godot material reads as `COLOR` and
 * `INSTANCE_CUSTOM` (vertex colour as albedo, a particle billboard). Stored and not used:
 * `fixed_fps`, `fractional_delta`, `seed`, `use_fixed_seed` and `visibility_aabb` (the emitter
 * steps on the frame, draws from `Math.random` and is drawn unculled). The other parameters
 * (orbit, radial and tangential acceleration, hue variation, animation), the points and ring
 * emission shapes, `rotate_y`, split scale and draw orders other than by index have no member here:
 * a scene that states one is refused by name at import.
 */

import type { ReactElement } from 'react';
import { type BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, type Material, Matrix4, type Object3D, Quaternion, Vector3 as ThreeVector3 } from 'three';
import { godot_base_material_3d_three } from './base-material-3d';
import { type Color, construct as color } from './color';
import { type Curve, sample as curveSample } from './curve';
import { get_cast_shadows_setting, godot_geometry_instance_3d_draws_override, godot_geometry_instance_3d_material_override, set_cast_shadows_setting } from './geometry-instance-3d';
import { type Gradient, sample as gradientSample } from './gradient';
import { godot_node_foreign, godot_node_set_internal_process } from './node';
import { godot_primitive_mesh_geometry, get_material, type PrimitiveMesh } from './primitive-mesh';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { construct as vector3, type Vector3 } from './vector3';

/** `CPUParticles3D::Parameter` (`cpu_particles_3d.h:52`), the ones the emitter reads. */
const PARAM_INITIAL_LINEAR_VELOCITY = 0;
const PARAM_ANGULAR_VELOCITY = 1;
const PARAM_LINEAR_ACCEL = 3;
const PARAM_DAMPING = 6;
const PARAM_ANGLE = 7;
const PARAM_SCALE = 8;
const PARAM_MAX = 12;
/** `CPUParticles3D::ParticleFlags` (`cpu_particles_3d.h:68`). */
const FLAG_ALIGN_Y_TO_VELOCITY = 0;
const FLAG_ROTATE_Y = 1;
const FLAG_DISABLE_Z = 2;
/** `CPUParticles3D::EmissionShape` (`cpu_particles_3d.h:75`): the ones the emitter emits from. */
const SHAPE_SPHERE = 1;
const SHAPE_SPHERE_SURFACE = 2;
const SHAPE_RING = 6;
const SHAPE_BOX = 3;

/**
 * What each particle does over its life: a CPUParticles3D's own properties, or a GPUParticles3D's
 * process material read as the same values.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1548
 */
export interface ParticleProcess {
  direction: Vector3;
  /** Degrees either side of `direction`. */
  spread: number;
  flatness: number;
  gravity: Vector3;
  /** Each parameter's range and its curve over the particle's life, by `Parameter`. */
  params_min: number[];
  params_max: number[];
  curves: (Curve | null)[];
  color: Color;
  color_ramp: Gradient | null;
  color_initial_ramp: Gradient | null;
  alpha_curve: Curve | null;
  emission_shape: number;
  emission_sphere_radius: number;
  emission_box_extents: Vector3;
  /** A ring's axis, height, radii (a process material's; a CPUParticles3D has none). */
  emission_ring?: { readonly axis: Vector3; readonly height: number; readonly radius: number; readonly inner: number };
  lifetime_randomness: number;
  particle_flags: boolean[];
}

interface Particle {
  alive: boolean;
  age: number;
  life: number;
  position: ThreeVector3;
  velocity: ThreeVector3;
  angle: number;
  angular_velocity: number;
  accel: number;
  damping: number;
  scale: number;
  color: [number, number, number, number];
}

/** The node's emitter: its parameters, its particles and the mesh drawing them. */
interface Emitter {
  emitting: boolean;
  amount: number;
  lifetime: number;
  one_shot: boolean;
  pre_process_time: number;
  speed_scale: number;
  explosiveness_ratio: number;
  randomness_ratio: number;
  local_coords: boolean;
  fixed_fps: number;
  fractional_delta: boolean;
  seed: number;
  use_fixed_seed: boolean;
  visibility_aabb: unknown;
  /** What the particles do: the node's own, or its process material's. */
  process: () => ParticleProcess | null;
  particles: Particle[];
  /** When, in the current cycle, each particle is emitted. */
  slots: number[];
  /** Seconds into the current emission cycle. */
  clock: number;
  /** The emission has just (re)started: the preprocess time is run before the next frame's. */
  fresh: boolean;
  finished: SignalHandle<[]>;
  mesh: PrimitiveMesh | null;
  geometry: BufferGeometry | null;
  material: Material | null;
  material_override: Material | null;
  drawn: InstancedMesh | null;
}

const EMITTERS = new WeakMap<object, Emitter>();
/** A CPUParticles3D's own process values (a GPUParticles3D reads its material instead). */
const OWN = new WeakMap<object, ParticleProcess>();

function emitterOf(self: object, member: string): Emitter {
  const emitter = EMITTERS.get(self);
  if (emitter === undefined) throw new TypeError(`godot-compat: ${member} requires a particle system.`);
  return emitter;
}

function ownOf(self: object, member: string): ParticleProcess {
  const own = OWN.get(self);
  if (own === undefined) throw new TypeError(`godot-compat: CPUParticles3D.${member} requires a CPUParticles3D.`);
  return own;
}

const random = (min: number, max: number): number => min + (max - min) * Math.random();
const DEGREES = Math.PI / 180;
const UP = new ThreeVector3(0, 1, 0);
const Z = new ThreeVector3(0, 0, 1);

function particle(): Particle {
  return {
    alive: false,
    age: 0,
    life: 1,
    position: new ThreeVector3(),
    velocity: new ThreeVector3(),
    angle: 0,
    angular_velocity: 0,
    accel: 0,
    damping: 0,
    scale: 1,
    color: [1, 1, 1, 1],
  };
}

/** Each particle's emission time in the cycle: evenly spaced, gathered by explosiveness, jittered by randomness. */
function placeSlots(e: Emitter): void {
  const spacing = (e.lifetime * (1 - e.explosiveness_ratio)) / e.amount;
  e.slots = Array.from({ length: e.amount }, (_, i) => spacing * i * (1 - e.randomness_ratio * Math.random()));
}

/** A direction within the spread cone around `direction`, flattened toward its plane by `flatness`. */
function emitDirection(p: ParticleProcess, out: ThreeVector3): ThreeVector3 {
  const axis = new ThreeVector3(p.direction.x, p.direction.y, p.direction.z);
  if (axis.lengthSq() === 0) return out.set(0, 0, 0);
  axis.normalize();
  const cos = 1 - Math.random() * (1 - Math.cos(p.spread * DEGREES));
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const turn = Math.random() * Math.PI * 2;
  const u = new ThreeVector3().crossVectors(axis, Math.abs(axis.y) < 0.99 ? UP : Z).normalize();
  const w = new ThreeVector3().crossVectors(axis, u);
  return out
    .copy(axis)
    .multiplyScalar(cos)
    .addScaledVector(u, Math.cos(turn) * sin * (1 - p.flatness))
    .addScaledVector(w, Math.sin(turn) * sin)
    .normalize();
}

/** A point of the emission shape, around the node's origin. */
function emitPosition(p: ParticleProcess, out: ThreeVector3): ThreeVector3 {
  if (p.emission_shape === SHAPE_SPHERE || p.emission_shape === SHAPE_SPHERE_SURFACE) {
    out.randomDirection();
    return out.multiplyScalar(p.emission_sphere_radius * (p.emission_shape === SHAPE_SPHERE ? Math.cbrt(Math.random()) : 1));
  }
  if (p.emission_shape === SHAPE_BOX) {
    const e = p.emission_box_extents;
    return out.set(random(-e.x, e.x), random(-e.y, e.y), random(-e.z, e.z));
  }
  const ring = p.emission_ring;
  if (p.emission_shape === SHAPE_RING && ring !== undefined) {
    // A point of the ring's annulus, at a height along its axis (`EMISSION_SHAPE_RING`,
    // `particle_process_material.cpp:720`); a zero axis is Z.
    const axis = new ThreeVector3(ring.axis.x, ring.axis.y, ring.axis.z);
    if (axis.lengthSq() === 0) axis.set(0, 0, 1);
    axis.normalize();
    const u = new ThreeVector3(1, 0, 0);
    if (Math.abs(axis.dot(u)) > 0.99) u.set(0, 1, 0);
    u.cross(axis).normalize();
    const w = axis.clone().cross(u);
    const turn = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(random(ring.inner * ring.inner, ring.radius * ring.radius));
    return out.copy(u).multiplyScalar(Math.cos(turn) * radius).addScaledVector(w, Math.sin(turn) * radius).addScaledVector(axis, random(-ring.height / 2, ring.height / 2));
  }
  return out.set(0, 0, 0);
}

const worldQuaternion = new Quaternion();
const worldPosition = new ThreeVector3();
const worldScale = new ThreeVector3();

function spawn(node: Object3D, e: Emitter, p: ParticleProcess, particle: Particle): void {
  particle.alive = true;
  particle.age = 0;
  particle.life = e.lifetime * (1 - p.lifetime_randomness * Math.random());
  const range = (param: number): number => random(p.params_min[param] ?? 0, p.params_max[param] ?? 0);
  emitPosition(p, particle.position);
  emitDirection(p, particle.velocity).multiplyScalar(range(PARAM_INITIAL_LINEAR_VELOCITY));
  if (p.particle_flags[FLAG_DISABLE_Z] === true) {
    particle.position.z = 0;
    particle.velocity.z = 0;
  }
  if (!e.local_coords) {
    // Left in the world: placed and aimed by the node's transform as it is now.
    particle.position.applyMatrix4(node.matrixWorld);
    particle.velocity.applyQuaternion(worldQuaternion);
  }
  particle.angle = range(PARAM_ANGLE) * DEGREES;
  particle.angular_velocity = range(PARAM_ANGULAR_VELOCITY) * DEGREES;
  particle.accel = range(PARAM_LINEAR_ACCEL);
  particle.damping = range(PARAM_DAMPING);
  particle.scale = range(PARAM_SCALE);
  const initial = p.color_initial_ramp === null ? null : gradientSample(p.color_initial_ramp, Math.random());
  particle.color = [p.color.r * (initial?.r ?? 1), p.color.g * (initial?.g ?? 1), p.color.b * (initial?.b ?? 1), p.color.a * (initial?.a ?? 1)];
}

const gravity = new ThreeVector3();

/** Moves the live particles by `delta` seconds and emits those whose time in the cycle has come. */
function advance(node: Object3D, e: Emitter, p: ParticleProcess, delta: number): void {
  gravity.set(p.gravity.x, p.gravity.y, p.gravity.z);
  // Gravity pulls in the world; particles that move with the node feel it in the node's space.
  if (e.local_coords) gravity.applyQuaternion(worldQuaternion.clone().invert());
  let alive = false;
  for (const particle of e.particles) {
    if (!particle.alive) continue;
    particle.age += delta;
    if (particle.age >= particle.life) {
      particle.alive = false;
      continue;
    }
    alive = true;
    const v = particle.velocity;
    v.addScaledVector(gravity, delta);
    const speed = v.length();
    if (speed > 0) {
      const next = Math.max(0, speed + particle.accel * delta - particle.damping * delta);
      v.multiplyScalar(next / speed);
    }
    if (p.particle_flags[FLAG_DISABLE_Z] === true && e.local_coords) v.z = 0;
    particle.position.addScaledVector(v, delta);
    particle.angle += particle.angular_velocity * delta;
  }
  let from = e.clock;
  let to = e.clock + delta;
  while (e.emitting) {
    const end = Math.min(to, e.lifetime);
    e.slots.forEach((slot, i) => {
      if (slot >= from && slot < end) {
        spawn(node, e, p, e.particles[i] as Particle);
        alive = true;
      }
    });
    if (to < e.lifetime) {
      e.clock = to;
      break;
    }
    // The cycle is over: a one-shot system stops emitting, another starts the next cycle.
    e.clock = 0;
    if (e.one_shot) {
      e.emitting = false;
      break;
    }
    placeSlots(e);
    from = 0;
    to -= e.lifetime;
  }
  if (!alive && !e.emitting && e.drawn?.visible === true) {
    e.drawn.visible = false;
    e.finished.emit();
  }
}

const matrix = new Matrix4();
const inverseWorld = new Matrix4();
const rotation = new Quaternion();
const spin = new Quaternion();
const heading = new ThreeVector3();
const size = new ThreeVector3();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** The instanced mesh drawing the particles, made as the emitter first draws and again when its mesh changes. */
function drawnOf(node: Object3D, e: Emitter): InstancedMesh | null {
  if (e.drawn !== null && e.drawn.count === e.amount) return e.drawn;
  const geometry = e.geometry ?? (e.mesh === null ? null : godot_primitive_mesh_geometry(e.mesh));
  if (geometry === null) return null;
  if (e.drawn !== null) node.remove(e.drawn);
  const source = e.mesh === null ? null : get_material(e.mesh);
  const material = e.material_override ?? e.material ?? (source === null ? undefined : godot_base_material_3d_three(source as never));
  const own = geometry.clone();
  own.setAttribute('godotInstanceColor', new InstancedBufferAttribute(new Float32Array(e.amount * 4), 4));
  own.setAttribute('godotInstanceCustom', new InstancedBufferAttribute(new Float32Array(e.amount * 4), 4));
  const drawn = new InstancedMesh(own, material, e.amount);
  drawn.frustumCulled = false;
  godot_node_foreign(drawn);
  node.add(drawn);
  e.drawn = drawn;
  return drawn;
}

/** Writes each particle's transform, colour and custom values into the instanced mesh. */
function draw(node: Object3D, e: Emitter, p: ParticleProcess): void {
  const drawn = drawnOf(node, e);
  if (drawn === null) return;
  drawn.visible = e.particles.some((particle) => particle.alive);
  drawn.castShadow = node.castShadow;
  if (!e.local_coords) inverseWorld.copy(node.matrixWorld).invert();
  const colors = drawn.geometry.getAttribute('godotInstanceColor') as InstancedBufferAttribute;
  const customs = drawn.geometry.getAttribute('godotInstanceCustom') as InstancedBufferAttribute;
  const scaleCurve = p.curves[PARAM_SCALE] ?? null;
  e.particles.forEach((particle, i) => {
    if (!particle.alive) {
      drawn.setMatrixAt(i, HIDDEN);
      colors.setXYZW(i, 0, 0, 0, 0);
      return;
    }
    const t = particle.age / particle.life;
    const scale = particle.scale * (scaleCurve === null ? 1 : curveSample(scaleCurve, t));
    if (p.particle_flags[FLAG_ALIGN_Y_TO_VELOCITY] === true && particle.velocity.lengthSq() > 0) {
      rotation.setFromUnitVectors(UP, heading.copy(particle.velocity).normalize());
    } else rotation.identity();
    // Flat particles turn in their plane by their angle (`cpu_particles_3d.cpp`: the basis's first
    // column `(cos, -sin, 0)`, the other way). Otherwise the angle turns nothing here: a particle
    // billboard reads it as `INSTANCE_CUSTOM.x`.
    if (p.particle_flags[FLAG_DISABLE_Z] === true && p.particle_flags[FLAG_ALIGN_Y_TO_VELOCITY] !== true) rotation.multiply(spin.setFromAxisAngle(Z, -particle.angle));
    matrix.compose(particle.position, rotation, size.setScalar(scale));
    if (!e.local_coords) matrix.premultiply(inverseWorld);
    drawn.setMatrixAt(i, matrix);
    const ramp = p.color_ramp === null ? null : gradientSample(p.color_ramp, t);
    const alpha = p.alpha_curve === null ? 1 : curveSample(p.alpha_curve, t);
    const [r, g, b, a] = particle.color;
    colors.setXYZW(i, r * (ramp?.r ?? 1), g * (ramp?.g ?? 1), b * (ramp?.b ?? 1), a * (ramp?.a ?? 1) * alpha);
    customs.setXYZW(i, particle.angle, t, 0, 1);
  });
  drawn.instanceMatrix.needsUpdate = true;
  colors.needsUpdate = true;
  customs.needsUpdate = true;
}

/** One frame of the emitter, from the node's own component. */
function frame(node: Object3D, e: Emitter, delta: number): void {
  const p = e.process();
  if (p === null) return;
  node.updateWorldMatrix(true, false);
  node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
  if (e.fresh) {
    e.fresh = false;
    // The preprocess time runs at once, in thirtieths of a second, before the first frame is drawn.
    for (let done = 0; e.emitting && done < e.pre_process_time; done += 1 / 30) advance(node, e, p, Math.min(1 / 30, e.pre_process_time - done));
  }
  if (e.emitting || e.particles.some((particle) => particle.alive)) {
    advance(node, e, p, Math.min(delta, 0.1) * e.speed_scale);
    draw(node, e, p);
  }
}

/** Starts a new emission cycle, keeping the particles already alive. */
function start(e: Emitter): void {
  e.clock = 0;
  e.fresh = true;
  placeSlots(e);
}

/**
 * Makes `entity` a particle system with Godot's defaults (`CPUParticles3D::CPUParticles3D`):
 * emitting, 8 particles living a second, drawn by its mesh; `process` is what its particles do.
 * It advances from its own component's frame.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1812
 */
export function godot_particles_3d_adopt(entity: Object3D, process: () => ParticleProcess | null): void {
  if (EMITTERS.has(entity)) return;
  const e: Emitter = {
    emitting: true,
    amount: 8,
    lifetime: 1,
    one_shot: false,
    pre_process_time: 0,
    speed_scale: 1,
    explosiveness_ratio: 0,
    randomness_ratio: 0,
    local_coords: false,
    fixed_fps: 0,
    fractional_delta: true,
    seed: 0,
    use_fixed_seed: false,
    visibility_aabb: null,
    process,
    particles: Array.from({ length: 8 }, particle),
    slots: [],
    clock: 0,
    fresh: true,
    finished: createSignal<[]>(),
    mesh: null,
    geometry: null,
    material: null,
    material_override: null,
    drawn: null,
  };
  placeSlots(e);
  EMITTERS.set(entity, e);
  // The material override draws the instances in place of the mesh's material.
  godot_geometry_instance_3d_draws_override(entity, (material) => {
    e.material_override = material;
    redraw(entity, e);
  });
  godot_node_set_internal_process(entity, (delta) => frame(entity, e, delta));
}

/** The instanced mesh is made again at the next frame (a new mesh, material or amount). */
function redraw(node: object, e: Emitter): void {
  if (e.drawn !== null) (node as Object3D).remove(e.drawn);
  e.drawn = null;
}

/** A CPUParticles3D's own process values, Godot's defaults (`cpu_particles_3d.cpp:1812`). */
function ownProcess(): ParticleProcess {
  const params_min = new Array<number>(PARAM_MAX).fill(0);
  const params_max = new Array<number>(PARAM_MAX).fill(0);
  params_min[PARAM_SCALE] = 1;
  params_max[PARAM_SCALE] = 1;
  return {
    direction: vector3(1, 0, 0),
    spread: 45,
    flatness: 0,
    gravity: vector3(0, -9.8, 0),
    params_min,
    params_max,
    curves: new Array<Curve | null>(PARAM_MAX).fill(null),
    color: color(1, 1, 1, 1),
    color_ramp: null,
    color_initial_ramp: null,
    alpha_curve: null,
    emission_shape: 0,
    emission_sphere_radius: 1,
    emission_box_extents: vector3(1, 1, 1),
    lifetime_randomness: 0,
    particle_flags: [false, false, false],
  };
}

/**
 * Makes `entity` a CPUParticles3D: the particle system, its particles doing what its own
 * properties say.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1812
 */
export function godot_cpu_particles_3d_adopt(entity: Object3D): void {
  if (OWN.has(entity)) return;
  const own = ownProcess();
  OWN.set(entity, own);
  godot_particles_3d_adopt(entity, () => own);
}

/**
 * Emitted once the system has stopped emitting and its last particle has died.
 *
 * @godot CPUParticles3D.finished
 * @source scene/3d/cpu_particles_3d.cpp:1703
 */
export function finished(self: object): GodotSignal<[]> {
  return emitterOf(self, 'finished').finished.signal;
}

/**
 * Whether new particles are emitted; stopping lets the live particles finish their lives. A system
 * whose particles have all died starts a new cycle; one with particles still alive carries on its
 * cycle (Godot resets its time only once the system is inactive, `cpu_particles_3d.cpp:662`), so a
 * script that switches a trail off and on each frame keeps a steady trail, and a one-shot switched
 * on again while its burst still lives does not burst twice (`restart` does that).
 *
 * @godot CPUParticles3D.set_emitting
 * @source scene/3d/cpu_particles_3d.cpp:51
 */
export function set_emitting(self: object, emitting: boolean): void {
  const e = emitterOf(self, 'set_emitting');
  if (e.emitting === emitting) return;
  e.emitting = emitting;
  if (emitting && !e.particles.some((particle) => particle.alive)) start(e);
}

/**
 * @godot CPUParticles3D.is_emitting
 * @source scene/3d/cpu_particles_3d.cpp:134
 */
export function is_emitting(self: object): boolean {
  return emitterOf(self, 'is_emitting').emitting;
}

/**
 * How many particles one cycle emits; fewer than one fails. The particles start afresh.
 *
 * @godot CPUParticles3D.set_amount
 * @source scene/3d/cpu_particles_3d.cpp:75
 */
export function set_amount(self: object, amount: number): void {
  const e = emitterOf(self, 'set_amount');
  if (amount < 1) throw new Error('godot-compat: a particle system needs at least one particle.');
  e.amount = Math.trunc(amount);
  e.particles = Array.from({ length: e.amount }, particle);
  placeSlots(e);
  redraw(self, e);
}

/**
 * @godot CPUParticles3D.get_amount
 * @source scene/3d/cpu_particles_3d.cpp:138
 */
export function get_amount(self: object): number {
  return emitterOf(self, 'get_amount').amount;
}

/**
 * How long each particle lives, in seconds, and so how long a cycle is; zero or less fails.
 *
 * @godot CPUParticles3D.set_lifetime
 * @source scene/3d/cpu_particles_3d.cpp:95
 */
export function set_lifetime(self: object, lifetime: number): void {
  const e = emitterOf(self, 'set_lifetime');
  if (lifetime <= 0) throw new Error('godot-compat: a particle system\'s lifetime must be greater than zero.');
  e.lifetime = lifetime;
  placeSlots(e);
}

/**
 * @godot CPUParticles3D.get_lifetime
 * @source scene/3d/cpu_particles_3d.cpp:142
 */
export function get_lifetime(self: object): number {
  return emitterOf(self, 'get_lifetime').lifetime;
}

/**
 * Whether the system emits one cycle and stops.
 *
 * @godot CPUParticles3D.set_one_shot
 * @source scene/3d/cpu_particles_3d.cpp:100
 */
export function set_one_shot(self: object, one_shot: boolean): void {
  emitterOf(self, 'set_one_shot').one_shot = one_shot;
}

/**
 * @godot CPUParticles3D.get_one_shot
 * @source scene/3d/cpu_particles_3d.cpp:146
 */
export function get_one_shot(self: object): boolean {
  return emitterOf(self, 'get_one_shot').one_shot;
}

/**
 * Seconds the system has already run when it starts emitting.
 *
 * @godot CPUParticles3D.set_pre_process_time
 * @source scene/3d/cpu_particles_3d.cpp:104
 */
export function set_pre_process_time(self: object, time: number): void {
  emitterOf(self, 'set_pre_process_time').pre_process_time = time;
}

/**
 * @godot CPUParticles3D.get_pre_process_time
 * @source scene/3d/cpu_particles_3d.cpp:150
 */
export function get_pre_process_time(self: object): number {
  return emitterOf(self, 'get_pre_process_time').pre_process_time;
}

/**
 * How much of a cycle's particles are emitted at once at its start (1: all of them).
 *
 * @godot CPUParticles3D.set_explosiveness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:108
 */
export function set_explosiveness_ratio(self: object, ratio: number): void {
  const e = emitterOf(self, 'set_explosiveness_ratio');
  e.explosiveness_ratio = ratio;
  placeSlots(e);
}

/**
 * @godot CPUParticles3D.get_explosiveness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:154
 */
export function get_explosiveness_ratio(self: object): number {
  return emitterOf(self, 'get_explosiveness_ratio').explosiveness_ratio;
}

/**
 * How much the particles' emission times are randomized.
 *
 * @godot CPUParticles3D.set_randomness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:112
 */
export function set_randomness_ratio(self: object, ratio: number): void {
  const e = emitterOf(self, 'set_randomness_ratio');
  e.randomness_ratio = ratio;
  placeSlots(e);
}

/**
 * @godot CPUParticles3D.get_randomness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:158
 */
export function get_randomness_ratio(self: object): number {
  return emitterOf(self, 'get_randomness_ratio').randomness_ratio;
}

/**
 * How much each particle's lifetime is shortened at random.
 *
 * @godot CPUParticles3D.set_lifetime_randomness
 * @source scene/3d/cpu_particles_3d.cpp:122
 */
export function set_lifetime_randomness(self: object, random: number): void {
  ownOf(self, 'set_lifetime_randomness').lifetime_randomness = random;
}

/**
 * @godot CPUParticles3D.get_lifetime_randomness
 * @source scene/3d/cpu_particles_3d.cpp:166
 */
export function get_lifetime_randomness(self: object): number {
  return ownOf(self, 'get_lifetime_randomness').lifetime_randomness;
}

/**
 * Whether the particles move with the node (true) or stay in the world where they were emitted.
 *
 * @godot CPUParticles3D.set_use_local_coordinates
 * @source scene/3d/cpu_particles_3d.cpp:126
 */
export function set_use_local_coordinates(self: object, enable: boolean): void {
  emitterOf(self, 'set_use_local_coordinates').local_coords = enable;
}

/**
 * @godot CPUParticles3D.get_use_local_coordinates
 * @source scene/3d/cpu_particles_3d.cpp:170
 */
export function get_use_local_coordinates(self: object): boolean {
  return emitterOf(self, 'get_use_local_coordinates').local_coords;
}

/**
 * How fast the system runs (1: real time).
 *
 * @godot CPUParticles3D.set_speed_scale
 * @source scene/3d/cpu_particles_3d.cpp:130
 */
export function set_speed_scale(self: object, scale: number): void {
  emitterOf(self, 'set_speed_scale').speed_scale = scale;
}

/**
 * @godot CPUParticles3D.get_speed_scale
 * @source scene/3d/cpu_particles_3d.cpp:174
 */
export function get_speed_scale(self: object): number {
  return emitterOf(self, 'get_speed_scale').speed_scale;
}

/**
 * Stored: the emitter steps on the host's frame.
 *
 * @godot CPUParticles3D.set_fixed_fps
 * @source scene/3d/cpu_particles_3d.cpp:202
 */
export function set_fixed_fps(self: object, fps: number): void {
  emitterOf(self, 'set_fixed_fps').fixed_fps = fps;
}

/**
 * @godot CPUParticles3D.get_fixed_fps
 * @source scene/3d/cpu_particles_3d.cpp:206
 */
export function get_fixed_fps(self: object): number {
  return emitterOf(self, 'get_fixed_fps').fixed_fps;
}

/**
 * Stored: the emitter steps on the host's frame.
 *
 * @godot CPUParticles3D.set_fractional_delta
 * @source scene/3d/cpu_particles_3d.cpp:210
 */
export function set_fractional_delta(self: object, enable: boolean): void {
  emitterOf(self, 'set_fractional_delta').fractional_delta = enable;
}

/**
 * @godot CPUParticles3D.get_fractional_delta
 * @source scene/3d/cpu_particles_3d.cpp:214
 */
export function get_fractional_delta(self: object): boolean {
  return emitterOf(self, 'get_fractional_delta').fractional_delta;
}

/**
 * Stored: the particles are drawn unculled.
 *
 * @godot CPUParticles3D.set_visibility_aabb
 * @source scene/3d/cpu_particles_3d.cpp:116
 */
export function set_visibility_aabb(self: object, aabb: unknown): void {
  emitterOf(self, 'set_visibility_aabb').visibility_aabb = aabb;
}

/**
 * @godot CPUParticles3D.get_visibility_aabb
 * @source scene/3d/cpu_particles_3d.cpp:162
 */
export function get_visibility_aabb(self: object): unknown {
  return emitterOf(self, 'get_visibility_aabb').visibility_aabb;
}

/**
 * Stored: the emitter draws from `Math.random`.
 *
 * @godot CPUParticles3D.set_use_fixed_seed
 * @source scene/3d/cpu_particles_3d.cpp:570
 */
export function set_use_fixed_seed(self: object, use: boolean): void {
  emitterOf(self, 'set_use_fixed_seed').use_fixed_seed = use;
}

/**
 * @godot CPUParticles3D.get_use_fixed_seed
 * @source scene/3d/cpu_particles_3d.cpp:578
 */
export function get_use_fixed_seed(self: object): boolean {
  return emitterOf(self, 'get_use_fixed_seed').use_fixed_seed;
}

/**
 * Stored: the emitter draws from `Math.random`.
 *
 * @godot CPUParticles3D.set_seed
 * @source scene/3d/cpu_particles_3d.cpp:582
 */
export function set_seed(self: object, seed: number): void {
  emitterOf(self, 'set_seed').seed = seed;
}

/**
 * @godot CPUParticles3D.get_seed
 * @source scene/3d/cpu_particles_3d.cpp:586
 */
export function get_seed(self: object): number {
  return emitterOf(self, 'get_seed').seed;
}

/**
 * The mesh each particle is drawn as.
 *
 * @godot CPUParticles3D.set_mesh
 * @source scene/3d/cpu_particles_3d.cpp:187
 */
export function set_mesh(self: object, mesh: PrimitiveMesh | null): void {
  const e = emitterOf(self, 'set_mesh');
  e.mesh = mesh;
  e.geometry = null;
  e.material = null;
  redraw(self, e);
}

/**
 * @godot CPUParticles3D.get_mesh
 * @source scene/3d/cpu_particles_3d.cpp:198
 */
export function get_mesh(self: object): PrimitiveMesh | null {
  return emitterOf(self, 'get_mesh').mesh;
}

/**
 * Kills every particle and starts emitting a new cycle.
 *
 * @godot CPUParticles3D.restart
 * @source scene/3d/cpu_particles_3d.cpp:248
 */
export function restart(self: object, _keep_seed = false): void {
  const e = emitterOf(self, 'restart');
  for (const particle of e.particles) particle.alive = false;
  e.emitting = true;
  start(e);
}

/**
 * The direction particles are emitted in.
 *
 * @godot CPUParticles3D.set_direction
 * @source scene/3d/cpu_particles_3d.cpp:270
 */
export function set_direction(self: object, direction: Vector3): void {
  ownOf(self, 'set_direction').direction = vector3(direction);
}

/**
 * @godot CPUParticles3D.get_direction
 * @source scene/3d/cpu_particles_3d.cpp:274
 */
export function get_direction(self: object): Vector3 {
  return vector3(ownOf(self, 'get_direction').direction);
}

/**
 * Degrees either side of the direction a particle may leave in.
 *
 * @godot CPUParticles3D.set_spread
 * @source scene/3d/cpu_particles_3d.cpp:278
 */
export function set_spread(self: object, spread: number): void {
  ownOf(self, 'set_spread').spread = spread;
}

/**
 * @godot CPUParticles3D.get_spread
 * @source scene/3d/cpu_particles_3d.cpp:282
 */
export function get_spread(self: object): number {
  return ownOf(self, 'get_spread').spread;
}

/**
 * How much the spread is flattened toward a plane (1: a flat fan).
 *
 * @godot CPUParticles3D.set_flatness
 * @source scene/3d/cpu_particles_3d.cpp:286
 */
export function set_flatness(self: object, flatness: number): void {
  ownOf(self, 'set_flatness').flatness = flatness;
}

/**
 * @godot CPUParticles3D.get_flatness
 * @source scene/3d/cpu_particles_3d.cpp:290
 */
export function get_flatness(self: object): number {
  return ownOf(self, 'get_flatness').flatness;
}

/**
 * A parameter's minimum; a minimum above the maximum raises the maximum.
 *
 * @godot CPUParticles3D.set_param_min
 * @source scene/3d/cpu_particles_3d.cpp:294
 */
export function set_param_min(self: object, param: number, value: number): void {
  const own = ownOf(self, 'set_param_min');
  if (param < 0 || param >= PARAM_MAX) return;
  own.params_min[param] = value;
  if (value > (own.params_max[param] as number)) own.params_max[param] = value;
}

/**
 * @godot CPUParticles3D.get_param_min
 * @source scene/3d/cpu_particles_3d.cpp:305
 */
export function get_param_min(self: object, param: number): number {
  return ownOf(self, 'get_param_min').params_min[param] ?? 0;
}

/**
 * A parameter's maximum; a maximum below the minimum lowers the minimum.
 *
 * @godot CPUParticles3D.set_param_max
 * @source scene/3d/cpu_particles_3d.cpp:311
 */
export function set_param_max(self: object, param: number, value: number): void {
  const own = ownOf(self, 'set_param_max');
  if (param < 0 || param >= PARAM_MAX) return;
  own.params_max[param] = value;
  if (value < (own.params_min[param] as number)) own.params_min[param] = value;
}

/**
 * @godot CPUParticles3D.get_param_max
 * @source scene/3d/cpu_particles_3d.cpp:322
 */
export function get_param_max(self: object, param: number): number {
  return ownOf(self, 'get_param_max').params_max[param] ?? 0;
}

/**
 * A parameter's curve over each particle's life (the scale curve multiplies its scale).
 *
 * @godot CPUParticles3D.set_param_curve
 * @source scene/3d/cpu_particles_3d.cpp:337
 */
export function set_param_curve(self: object, param: number, curve: Curve | null): void {
  const own = ownOf(self, 'set_param_curve');
  if (param < 0 || param >= PARAM_MAX) return;
  own.curves[param] = curve;
}

/**
 * @godot CPUParticles3D.get_param_curve
 * @source scene/3d/cpu_particles_3d.cpp:384
 */
export function get_param_curve(self: object, param: number): Curve | null {
  return ownOf(self, 'get_param_curve').curves[param] ?? null;
}

/**
 * Each particle's colour, which the ramps multiply.
 *
 * @godot CPUParticles3D.set_color
 * @source scene/3d/cpu_particles_3d.cpp:390
 */
export function set_color(self: object, value: Color): void {
  ownOf(self, 'set_color').color = value;
}

/**
 * @godot CPUParticles3D.get_color
 * @source scene/3d/cpu_particles_3d.cpp:394
 */
export function get_color(self: object): Color {
  return ownOf(self, 'get_color').color;
}

/**
 * Each particle's colour over its life.
 *
 * @godot CPUParticles3D.set_color_ramp
 * @source scene/3d/cpu_particles_3d.cpp:398
 */
export function set_color_ramp(self: object, ramp: Gradient | null): void {
  ownOf(self, 'set_color_ramp').color_ramp = ramp;
}

/**
 * @godot CPUParticles3D.get_color_ramp
 * @source scene/3d/cpu_particles_3d.cpp:402
 */
export function get_color_ramp(self: object): Gradient | null {
  return ownOf(self, 'get_color_ramp').color_ramp;
}

/**
 * Each particle's starting colour, picked at random along the ramp.
 *
 * @godot CPUParticles3D.set_color_initial_ramp
 * @source scene/3d/cpu_particles_3d.cpp:406
 */
export function set_color_initial_ramp(self: object, ramp: Gradient | null): void {
  ownOf(self, 'set_color_initial_ramp').color_initial_ramp = ramp;
}

/**
 * @godot CPUParticles3D.get_color_initial_ramp
 * @source scene/3d/cpu_particles_3d.cpp:410
 */
export function get_color_initial_ramp(self: object): Gradient | null {
  return ownOf(self, 'get_color_initial_ramp').color_initial_ramp;
}

/**
 * Align Y to velocity and disable Z are drawn; rotate Y fails by name.
 *
 * @godot CPUParticles3D.set_particle_flag
 * @source scene/3d/cpu_particles_3d.cpp:414
 */
export function set_particle_flag(self: object, flag: number, enable: boolean): void {
  const own = ownOf(self, 'set_particle_flag');
  if (flag === FLAG_ROTATE_Y && enable) throw new Error('godot-compat: CPUParticles3D.particle_flag_rotate_y is not drawn.');
  if (flag < 0 || flag > FLAG_DISABLE_Z) return;
  own.particle_flags[flag] = enable;
}

/**
 * @godot CPUParticles3D.get_particle_flag
 * @source scene/3d/cpu_particles_3d.cpp:422
 */
export function get_particle_flag(self: object, flag: number): boolean {
  return ownOf(self, 'get_particle_flag').particle_flags[flag] ?? false;
}

/**
 * Where particles start: a point, a sphere, a sphere's surface or a box; another shape fails by name.
 *
 * @godot CPUParticles3D.set_emission_shape
 * @source scene/3d/cpu_particles_3d.cpp:427
 */
export function set_emission_shape(self: object, shape: number): void {
  if (shape > SHAPE_BOX) throw new Error(`godot-compat: CPUParticles3D.emission_shape ${String(shape)} is not emitted from.`);
  ownOf(self, 'set_emission_shape').emission_shape = shape;
}

/**
 * @godot CPUParticles3D.get_emission_shape
 * @source scene/3d/cpu_particles_3d.cpp:537
 */
export function get_emission_shape(self: object): number {
  return ownOf(self, 'get_emission_shape').emission_shape;
}

/**
 * @godot CPUParticles3D.set_emission_sphere_radius
 * @source scene/3d/cpu_particles_3d.cpp:433
 */
export function set_emission_sphere_radius(self: object, radius: number): void {
  ownOf(self, 'set_emission_sphere_radius').emission_sphere_radius = radius;
}

/**
 * @godot CPUParticles3D.get_emission_sphere_radius
 * @source scene/3d/cpu_particles_3d.cpp:497
 */
export function get_emission_sphere_radius(self: object): number {
  return ownOf(self, 'get_emission_sphere_radius').emission_sphere_radius;
}

/**
 * @godot CPUParticles3D.set_emission_box_extents
 * @source scene/3d/cpu_particles_3d.cpp:438
 */
export function set_emission_box_extents(self: object, extents: Vector3): void {
  ownOf(self, 'set_emission_box_extents').emission_box_extents = vector3(extents);
}

/**
 * @godot CPUParticles3D.get_emission_box_extents
 * @source scene/3d/cpu_particles_3d.cpp:501
 */
export function get_emission_box_extents(self: object): Vector3 {
  return vector3(ownOf(self, 'get_emission_box_extents').emission_box_extents);
}

/**
 * The world acceleration every particle falls by.
 *
 * @godot CPUParticles3D.set_gravity
 * @source scene/3d/cpu_particles_3d.cpp:541
 */
export function set_gravity(self: object, gravity: Vector3): void {
  ownOf(self, 'set_gravity').gravity = vector3(gravity);
}

/**
 * @godot CPUParticles3D.get_gravity
 * @source scene/3d/cpu_particles_3d.cpp:545
 */
export function get_gravity(self: object): Vector3 {
  return vector3(ownOf(self, 'get_gravity').gravity);
}

/**
 * The mesh a scene states as three's geometry and its surface's material (`mesh` in Godot): what
 * each particle is drawn as.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:187
 */
export function godot_cpu_particles_3d_draw_with(self: object, geometry: BufferGeometry | undefined, material: Material | undefined): void {
  const e = emitterOf(self, 'mesh');
  if (geometry !== undefined) e.geometry = geometry;
  if (material !== undefined) e.material = material;
  redraw(self, e);
}

/**
 * `cast_shadow` as a scene states it (`GeometryInstance3D::set_cast_shadows_setting`): the
 * instances cast unless it is off.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/visual_instance_3d.cpp:373
 */
export function godot_cpu_particles_3d_cast_shadow(self: Object3D, setting: number): void {
  set_cast_shadows_setting(self, setting);
  const e = emitterOf(self, 'cast_shadow');
  if (e.drawn !== null) e.drawn.castShadow = get_cast_shadows_setting(self) !== 0;
}

// The node's class, for a CPUParticles3D its JSX declares.
const CPU_PARTICLES_3D = Object.freeze(['CPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);

/** A scene's `<name>Min`, `<name>Max` and `<name>Curve` props, by the parameter each sets. */
const PARAMS = [
  ['initialVelocity', PARAM_INITIAL_LINEAR_VELOCITY],
  ['angularVelocity', PARAM_ANGULAR_VELOCITY],
  ['linearAccel', PARAM_LINEAR_ACCEL],
  ['damping', PARAM_DAMPING],
  ['angle', PARAM_ANGLE],
  ['scaleAmount', PARAM_SCALE],
] as const;

/** The props a scene states on `<GodotCPUParticles3D>`, by the setter each calls. */
const CPU_PARTICLES_3D_ELEMENT: GodotElementClass<Group> = {
  advances: true,
  create: () => new Group(),
  classes: CPU_PARTICLES_3D,
  spatial: true,
  mount: (entity) => godot_cpu_particles_3d_adopt(entity),
  props: new Map<string, GodotElementProp<Group>>([
    ['emitting', (self, value: boolean) => set_emitting(self, value)],
    ['amount', (self, value: number) => set_amount(self, value)],
    ['lifetime', (self, value: number) => set_lifetime(self, value)],
    ['oneShot', (self, value: boolean) => set_one_shot(self, value)],
    ['preprocess', (self, value: number) => set_pre_process_time(self, value)],
    ['explosiveness', (self, value: number) => set_explosiveness_ratio(self, value)],
    ['randomness', (self, value: number) => set_randomness_ratio(self, value)],
    ['lifetimeRandomness', (self, value: number) => set_lifetime_randomness(self, value)],
    ['localCoords', (self, value: boolean) => set_use_local_coordinates(self, value)],
    ['speedScale', (self, value: number) => set_speed_scale(self, value)],
    ['fixedFps', (self, value: number) => set_fixed_fps(self, value)],
    ['fractDelta', (self, value: boolean) => set_fractional_delta(self, value)],
    ['visibilityAabb', (self, value: unknown) => set_visibility_aabb(self, value)],
    // The mesh as three's geometry and its surface material, as a scene states a drawn mesh.
    ['geometry', (self, value: BufferGeometry) => godot_cpu_particles_3d_draw_with(self, value, undefined)],
    ['material', (self, value: Material) => godot_cpu_particles_3d_draw_with(self, undefined, value)],
    // A mesh three has no geometry idiom for, as its resource.
    ['mesh', (self, value: PrimitiveMesh | null) => set_mesh(self, value)],
    ['castShadow', (self, value: number) => godot_cpu_particles_3d_cast_shadow(self, value)],
    ['materialOverride', (self, value: Material) => godot_geometry_instance_3d_material_override(self, value)],
    ['direction', (self, value: readonly [number, number, number]) => set_direction(self, vector3(...value))],
    ['spread', (self, value: number) => set_spread(self, value)],
    ['flatness', (self, value: number) => set_flatness(self, value)],
    ['gravity', (self, value: readonly [number, number, number]) => set_gravity(self, vector3(...value))],
    ['color', (self, value: readonly [number, number, number, number]) => set_color(self, color(...value))],
    ['colorRamp', (self, value: Gradient | null) => set_color_ramp(self, value)],
    ['colorInitialRamp', (self, value: Gradient | null) => set_color_initial_ramp(self, value)],
    ['emissionShape', (self, value: number) => set_emission_shape(self, value)],
    ['emissionSphereRadius', (self, value: number) => set_emission_sphere_radius(self, value)],
    ['emissionBoxExtents', (self, value: readonly [number, number, number]) => set_emission_box_extents(self, vector3(...value))],
    ['useFixedSeed', (self, value: boolean) => set_use_fixed_seed(self, value)],
    ['seed', (self, value: number) => set_seed(self, value)],
    ...PARAMS.flatMap(([name, index]): [string, GodotElementProp<Group>][] => [
      [`${name}Min`, (self, value: number) => set_param_min(self, index, value)],
      [`${name}Max`, (self, value: number) => set_param_max(self, index, value)],
      [`${name}Curve`, (self, value: Curve | null) => set_param_curve(self, index, value)],
    ]),
    ['particleFlagAlignY', (self, value: boolean) => set_particle_flag(self, FLAG_ALIGN_Y_TO_VELOCITY, value)],
    ['particleFlagRotateY', (self, value: boolean) => set_particle_flag(self, FLAG_ROTATE_Y, value)],
    ['particleFlagDisableZ', (self, value: boolean) => set_particle_flag(self, FLAG_DISABLE_Z, value)],
  ]),
};

/**
 * A CPUParticles3D as a scene writes it (`cpu_particles_3d.cpp:1548`: its properties): a group
 * holding the `InstancedMesh` its particles are drawn with, advancing from its own frame.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1548
 */
export function GodotCPUParticles3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CPU_PARTICLES_3D_ELEMENT, props);
}
