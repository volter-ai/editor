/**
 * @godot-class GPUParticles2D
 * @role BINDING
 *
 * Godot 4.7's `GPUParticles2D` (`scene/2d/gpu_particles_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) with its ParticleProcessMaterial's process shader
 * (`particle_process_material.cpp` `_update_shader`) run on the page: `amount` particles over each
 * `lifetime` cycle, spread by `explosiveness`, emitted from the material's emission shape (a point,
 * sphere, box or ring, in the node's plane) along its direction within its spread at its initial
 * velocity, accelerated by gravity and linear acceleration, slowed by damping, rotated by its angle
 * and scaled by its scale and scale curve; one-shot, emitting stops after one cycle and `finished`
 * is emitted when the last particle dies. Each particle draws the node's texture centred on it,
 * tinted by the material's colour. With `local_coords` particles move with the node, else they stay
 * in the canvas where they were emitted (their velocity not turned by the node's rotation); sub-emitters,
 * trails, turbulence, collision and colour ramps are not drawn.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { get_global_transform_with_canvas, godot_canvas_item_self_filter } from './canvas-item';
import { affine_inverse, op_multiply } from './transform-2d';
import { construct as vector2 } from './vector2';
import { get_curve } from './curve-texture';
import { sample } from './curve';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_entity, godot_node_set_internal_process, ready } from './node';
import type { ParticleProcessMaterial } from './particle-process-material';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { get_height, get_width } from './texture-2d';

const CLASSES = ['GPUParticles2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

/** `ParticleProcessMaterial::Parameter` (`particle_process_material.h:48`). */
const PARAM_INITIAL_LINEAR_VELOCITY = 0;
const PARAM_ANGULAR_VELOCITY = 1;
const PARAM_LINEAR_ACCEL = 3;
const PARAM_DAMPING = 6;
const PARAM_ANGLE = 7;
const PARAM_SCALE = 8;
/** `EmissionShape` (`particle_process_material.h:80`). */
const SHAPE_SPHERE = 1;
const SHAPE_SPHERE_SURFACE = 2;
const SHAPE_BOX = 3;
const SHAPE_RING = 6;

interface Particle {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  scale: number;
  /** The per-particle randoms the curves and ranges are lerped by. */
  readonly random: number[];
}

interface Particles2DState {
  readonly entity: Object3D;
  emitting: boolean;
  amount: number;
  lifetime: number;
  oneShot: boolean;
  speedScale: number;
  explosiveness: number;
  randomness: number;
  localCoords: boolean;
  texture: Texture | null;
  material: ParticleProcessMaterial | null;
  /** Time into the current cycle, and how many particles it has emitted. */
  cycleTime: number;
  emitted: number;
  particles: Particle[];
  readonly finished: SignalHandle<[]>;
}

const PARTICLES = new WeakMap<object, Particles2DState>();

function stateOf(self: object, member: string): Particles2DState {
  const state = PARTICLES.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a GPUParticles2D`);
  return state;
}

function lerp(from: number, to: number, weight: number): number {
  return from + (to - from) * weight;
}

function param(material: ParticleProcessMaterial, index: number, random: number): number {
  return lerp(material.params_min[index] ?? 0, material.params_max[index] ?? 0, random);
}

function curveAt(material: ParticleProcessMaterial, index: number, offset: number): number {
  const texture = material.tex_parameters[index];
  const curve = texture === null || texture === undefined ? null : get_curve(texture);
  return curve === null ? 1 : sample(curve, offset);
}

/** A particle's start: position by the emission shape, velocity along the direction within the spread. */
function spawn(state: Particles2DState, particle: Particle): void {
  const material = state.material;
  const random = particle.random.map(() => Math.random());
  particle.random.splice(0, particle.random.length, ...random);
  particle.active = true;
  particle.age = 0;
  const randomness = material?.lifetime_randomness ?? 0;
  particle.life = state.lifetime * (1 - (random[0] as number) * randomness);
  let x = 0;
  let y = 0;
  if (material !== null) {
    const angle = (random[1] as number) * Math.PI * 2;
    switch (material.emission_shape) {
      case SHAPE_SPHERE:
      case SHAPE_SPHERE_SURFACE: {
        const radius = material.emission_sphere_radius * (material.emission_shape === SHAPE_SPHERE ? Math.sqrt(random[2] as number) : 1);
        x = Math.cos(angle) * radius;
        y = Math.sin(angle) * radius;
        break;
      }
      case SHAPE_BOX:
        x = ((random[2] as number) * 2 - 1) * material.emission_box_extents.x;
        y = ((random[3] as number) * 2 - 1) * material.emission_box_extents.y;
        break;
      case SHAPE_RING: {
        const outer = material.emission_ring_radius;
        const inner = material.emission_ring_inner_radius;
        const radius = Math.sqrt(lerp(inner * inner, outer * outer, random[2] as number));
        x = Math.cos(angle) * radius;
        y = Math.sin(angle) * radius;
        break;
      }
      default:
        break;
    }
    const spread = (material.spread * Math.PI) / 180;
    const heading = Math.atan2(material.direction.y, material.direction.x) + ((random[4] as number) * 2 - 1) * spread;
    const speed = param(material, PARAM_INITIAL_LINEAR_VELOCITY, random[5] as number);
    particle.vx = Math.cos(heading) * speed;
    particle.vy = Math.sin(heading) * speed;
    particle.angle = (param(material, PARAM_ANGLE, random[6] as number) * Math.PI) / 180;
    particle.angularVelocity = (param(material, PARAM_ANGULAR_VELOCITY, random[7] as number) * Math.PI) / 180;
    particle.scale = param(material, PARAM_SCALE, random[8] as number);
  } else {
    particle.vx = 0;
    particle.vy = 0;
    particle.angle = 0;
    particle.angularVelocity = 0;
    particle.scale = 1;
  }
  // Not in local coordinates, a particle is emitted in the canvas and stays there as the node moves.
  if (!state.localCoords) {
    const at = op_multiply(get_global_transform_with_canvas(state.entity), vector2(x, y));
    x = at.x;
    y = at.y;
  }
  particle.x = x;
  particle.y = y;
}

/** One process step of the particle system (`GPUParticles2D::_notification`, `gpu_particles_2d.cpp:686`). */
function advance(state: Particles2DState, delta: number): void {
  const step = delta * state.speedScale;
  if (state.particles.length !== state.amount) {
    state.particles = Array.from({ length: state.amount }, () => ({ active: false, age: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, angle: 0, angularVelocity: 0, scale: 1, random: new Array<number>(9).fill(0) }));
  }
  const material = state.material;
  for (const particle of state.particles) {
    if (!particle.active) continue;
    particle.age += step;
    if (particle.age >= particle.life) {
      particle.active = false;
      continue;
    }
    if (material !== null) {
      const accel = param(material, PARAM_LINEAR_ACCEL, particle.random[5] as number);
      const speed = Math.hypot(particle.vx, particle.vy);
      const damping = param(material, PARAM_DAMPING, particle.random[6] as number);
      let vx = particle.vx + (material.gravity.x + (speed > 0 ? (particle.vx / speed) * accel : 0)) * step;
      let vy = particle.vy + (material.gravity.y + (speed > 0 ? (particle.vy / speed) * accel : 0)) * step;
      const damped = Math.max(Math.hypot(vx, vy) - damping * step, 0);
      const length = Math.hypot(vx, vy);
      if (length > 0) {
        vx = (vx / length) * damped;
        vy = (vy / length) * damped;
      }
      particle.vx = vx;
      particle.vy = vy;
    }
    particle.x += particle.vx * step;
    particle.y += particle.vy * step;
    particle.angle += particle.angularVelocity * step;
  }
  if (state.emitting) {
    // Particle `i` of a cycle is emitted at `i / amount` of the lifetime, less by explosiveness.
    state.cycleTime += step;
    const spacing = (state.lifetime * (1 - state.explosiveness)) / Math.max(state.amount, 1);
    while (state.emitted < state.amount && state.cycleTime >= state.emitted * spacing) {
      const particle = state.particles[state.emitted];
      if (particle !== undefined) spawn(state, particle);
      state.emitted += 1;
    }
    if (state.cycleTime >= state.lifetime) {
      if (state.oneShot) state.emitting = false;
      else {
        state.cycleTime -= state.lifetime;
        state.emitted = 0;
      }
    }
  } else if (state.oneShot && state.emitted > 0 && state.particles.every((particle) => !particle.active)) {
    state.emitted = 0;
    state.cycleTime = 0;
    godot_node_set_internal_process(state.entity, undefined);
    state.finished.emit();
  }
}

function imageSource(texture: Texture): string {
  const image = texture.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

const SPRITES = new WeakMap<Object3D, HTMLElement[]>();

/** Each live particle as the texture centred on it, scaled and rotated, tinted by the material's colour. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = PARTICLES.get(entity) as Particles2DState;
  const nodes = SPRITES.get(entity) ?? [];
  SPRITES.set(entity, nodes);
  const texture = state.texture;
  const source = texture === null ? '' : imageSource(texture);
  const width = texture === null ? 0 : get_width(texture);
  const height = texture === null ? 0 : get_height(texture);
  const material = state.material;
  const tint = material?.color;
  state.particles.forEach((particle, index) => {
    let node = nodes[index];
    if (node === undefined) {
      node = element.ownerDocument.createElement('div');
      node.style.position = 'absolute';
      node.style.pointerEvents = 'none';
      nodes[index] = node;
    }
    if (node.parentElement !== element) element.appendChild(node);
    if (!particle.active || source === '') {
      node.style.display = 'none';
      return;
    }
    const scale = particle.scale * (material === null ? 1 : curveAt(material, PARAM_SCALE, particle.age / particle.life));
    const place = state.localCoords ? vector2(particle.x, particle.y) : op_multiply(affine_inverse(get_global_transform_with_canvas(entity)), vector2(particle.x, particle.y));
    node.style.display = '';
    node.style.left = `${String(place.x - width / 2)}px`;
    node.style.top = `${String(place.y - height / 2)}px`;
    node.style.width = `${String(width)}px`;
    node.style.height = `${String(height)}px`;
    node.style.backgroundImage = `url("${source}")`;
    node.style.backgroundSize = '100% 100%';
    node.style.transform = `rotate(${String(particle.angle)}rad) scale(${String(scale)})`;
    node.style.opacity = String(tint?.a ?? 1);
    node.style.filter = godot_canvas_item_self_filter(entity, element);
  });
  for (const extra of nodes.slice(state.particles.length)) extra.remove();
}

function setProcessing(state: Particles2DState): void {
  godot_node_set_internal_process(state.entity, (delta) => advance(state, delta));
}

/**
 * Makes `entity` a GPUParticles2D (`GPUParticles2D::GPUParticles2D`, `gpu_particles_2d.cpp:950`):
 * emitting, 8 particles, a 1-second lifetime.
 *
 * @godot GPUParticles2D (protocol)
 * @source scene/2d/gpu_particles_2d.cpp:950
 */
export function godot_gpu_particles_2d_mount(entity: Object3D): void {
  const state: Particles2DState = {
    entity,
    emitting: true,
    amount: 8,
    lifetime: 1,
    oneShot: false,
    speedScale: 1,
    explosiveness: 0,
    randomness: 0,
    localCoords: false,
    texture: null,
    material: null,
    cycleTime: 0,
    emitted: 0,
    particles: [],
    finished: createSignal<[]>(),
  };
  PARTICLES.set(entity, state);
  godot_node_2d_mount(entity, CLASSES, { draw });
  ready(entity).connect(() => setProcessing(state));
}

/**
 * A new GPUParticles2D (`GPUParticles2D.new()`).
 *
 * @godot GPUParticles2D.GPUParticles2D
 * @source scene/2d/gpu_particles_2d.cpp:950
 */
export function construct(): Group {
  const entity = new Group();
  godot_gpu_particles_2d_mount(entity);
  return entity;
}

/**
 * Starts (a one-shot system from its beginning) or stops emitting.
 *
 * @godot GPUParticles2D.set_emitting
 * @source scene/2d/gpu_particles_2d.cpp:41
 */
export function set_emitting(self: object, emitting: boolean): void {
  const state = stateOf(self, 'set_emitting');
  if (emitting && state.oneShot && !state.emitting) {
    state.cycleTime = 0;
    state.emitted = 0;
  }
  state.emitting = emitting;
  if (emitting) setProcessing(state);
}

/**
 * @godot GPUParticles2D.is_emitting
 * @source scene/2d/gpu_particles_2d.cpp:293
 */
export function is_emitting(self: object): boolean {
  return stateOf(self, 'is_emitting').emitting;
}

/**
 * @godot GPUParticles2D.set_amount
 * @source scene/2d/gpu_particles_2d.cpp:64
 */
export function set_amount(self: object, amount: number): void {
  if (amount < 1) return;
  stateOf(self, 'set_amount').amount = amount;
}

/**
 * @godot GPUParticles2D.get_amount
 * @source scene/2d/gpu_particles_2d.cpp:297
 */
export function get_amount(self: object): number {
  return stateOf(self, 'get_amount').amount;
}

/**
 * @godot GPUParticles2D.set_lifetime
 * @source scene/2d/gpu_particles_2d.cpp:70
 */
export function set_lifetime(self: object, lifetime: number): void {
  if (lifetime <= 0) return;
  stateOf(self, 'set_lifetime').lifetime = lifetime;
}

/**
 * @godot GPUParticles2D.get_lifetime
 * @source scene/2d/gpu_particles_2d.cpp:301
 */
export function get_lifetime(self: object): number {
  return stateOf(self, 'get_lifetime').lifetime;
}

/**
 * @godot GPUParticles2D.set_one_shot
 * @source scene/2d/gpu_particles_2d.cpp:76
 */
export function set_one_shot(self: object, enable: boolean): void {
  stateOf(self, 'set_one_shot').oneShot = enable;
}

/**
 * @godot GPUParticles2D.set_explosiveness_ratio
 * @source scene/2d/gpu_particles_2d.cpp:100
 */
export function set_explosiveness_ratio(self: object, ratio: number): void {
  stateOf(self, 'set_explosiveness_ratio').explosiveness = ratio;
}

/**
 * @godot GPUParticles2D.set_randomness_ratio
 * @source scene/2d/gpu_particles_2d.cpp:105
 */
export function set_randomness_ratio(self: object, ratio: number): void {
  stateOf(self, 'set_randomness_ratio').randomness = ratio;
}

/**
 * @godot GPUParticles2D.set_use_local_coordinates
 * @source scene/2d/gpu_particles_2d.cpp:122
 */
export function set_use_local_coordinates(self: object, enable: boolean): void {
  stateOf(self, 'set_use_local_coordinates').localCoords = enable;
}

/**
 * @godot GPUParticles2D.set_speed_scale
 * @source scene/2d/gpu_particles_2d.cpp:168
 */
export function set_speed_scale(self: object, scale: number): void {
  stateOf(self, 'set_speed_scale').speedScale = scale;
}

/**
 * @godot GPUParticles2D.set_texture
 * @source scene/2d/gpu_particles_2d.cpp:405
 */
export function set_texture(self: object, texture: Texture | null): void {
  stateOf(self, 'set_texture').texture = texture;
}

/**
 * @godot GPUParticles2D.set_process_material
 * @source scene/2d/gpu_particles_2d.cpp:140
 */
export function set_process_material(self: object, material: ParticleProcessMaterial | null): void {
  stateOf(self, 'set_process_material').material = material;
}

/**
 * @godot GPUParticles2D.restart
 * @source scene/2d/gpu_particles_2d.cpp:620
 */
export function restart(self: object): void {
  const state = stateOf(self, 'restart');
  for (const particle of state.particles) particle.active = false;
  state.cycleTime = 0;
  state.emitted = 0;
  state.emitting = true;
  setProcessing(state);
}

/**
 * @godot GPUParticles2D.finished
 * @source scene/2d/gpu_particles_2d.cpp:928
 */
export function finished(self: object): GodotSignal<[]> {
  return stateOf(self, 'finished').finished.signal;
}

const GPU_PARTICLES_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_gpu_particles_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['emitting', (entity, value: boolean) => set_emitting(entity, value)],
    ['amount', (entity, value: number) => set_amount(entity, value)],
    ['lifetime', (entity, value: number) => set_lifetime(entity, value)],
    ['oneShot', (entity, value: boolean) => set_one_shot(entity, value)],
    ['speedScale', (entity, value: number) => set_speed_scale(entity, value)],
    ['explosiveness', (entity, value: number) => set_explosiveness_ratio(entity, value)],
    ['randomness', (entity, value: number) => set_randomness_ratio(entity, value)],
    ['localCoords', (entity, value: boolean) => set_use_local_coordinates(entity, value)],
    ['texture', (entity, value: Texture | null) => set_texture(entity, value)],
    ['processMaterial', (entity, value: ParticleProcessMaterial | null) => set_process_material(entity, value)],
  ]),
};

/**
 * A GPUParticles2D as a scene writes it: `<GodotGPUParticles2D amount={4} texture={t} />`.
 *
 * @godot GPUParticles2D (protocol)
 * @source scene/2d/gpu_particles_2d.cpp:950
 */
export function GodotGPUParticles2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(GPU_PARTICLES_2D, props);
}
