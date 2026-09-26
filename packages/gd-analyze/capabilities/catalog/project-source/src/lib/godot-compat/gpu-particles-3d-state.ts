import type { BufferGeometry, Material, Object3D } from 'three';
import type { GodotAabb } from './aabb';
import type { CpuParticles3D } from './cpu-particles-3d';

export const GODOT_PARTICLES_DRAW_ORDER = {
  INDEX: 0,
  LIFETIME: 1,
  REVERSE_LIFETIME: 2,
  VIEW_DEPTH: 3,
  DRAW_ORDER_INDEX: 0,
  DRAW_ORDER_LIFETIME: 1,
  DRAW_ORDER_REVERSE_LIFETIME: 2,
  DRAW_ORDER_VIEW_DEPTH: 3,
} as const;

export const GODOT_PARTICLES_TRANSFORM_ALIGN = {
  DISABLED: 0,
  Z_BILLBOARD: 1,
  Y_TO_VELOCITY: 2,
  Z_BILLBOARD_Y_TO_VELOCITY: 3,
  PARTICLE_TRANSFORM_ALIGN_DISABLED: 0,
  PARTICLE_TRANSFORM_ALIGN_Z_BILLBOARD: 1,
  PARTICLE_TRANSFORM_ALIGN_Y_TO_VELOCITY: 2,
  PARTICLE_TRANSFORM_ALIGN_Z_BILLBOARD_Y_TO_VELOCITY: 3,
} as const;

export type GodotParticlesDrawOrder = 0 | 1 | 2 | 3;
export type GodotParticlesTransformAlign = 0 | 1 | 2 | 3;

export interface GodotParticleProcessMaterial {
  readonly __godotClass?: 'ParticleProcessMaterial' | 'ParticlesMaterial';
}

export interface GodotGpuParticles3DSnapshot {
  readonly oneShot: boolean;
  readonly amountRatio: number;
  readonly explosiveness: number;
  readonly randomness: number;
  readonly visibilityAabb: GodotAabb | null;
  readonly trailEnabled: boolean;
  readonly trailLifetime: number;
  readonly interpolationToEnd: number;
  readonly drawOrder: GodotParticlesDrawOrder;
  readonly transformAlign: GodotParticlesTransformAlign;
  readonly processMaterial: GodotParticleProcessMaterial | Material | null;
  readonly drawPasses: readonly (BufferGeometry | null)[];
}

export interface GodotGpuParticles3DBinding {
  apply(snapshot: GodotGpuParticles3DSnapshot): void;
}

interface MutableGpuParticlesState {
  oneShot: boolean;
  amountRatio: number;
  explosiveness: number;
  randomness: number;
  visibilityAabb: GodotAabb | null;
  trailEnabled: boolean;
  trailLifetime: number;
  interpolationToEnd: number;
  drawOrder: GodotParticlesDrawOrder;
  transformAlign: GodotParticlesTransformAlign;
  processMaterial: GodotParticleProcessMaterial | Material | null;
  drawPasses: [BufferGeometry | null, BufferGeometry | null, BufferGeometry | null, BufferGeometry | null];
  binding: GodotGpuParticles3DBinding | null;
  listeners: Set<(snapshot: GodotGpuParticles3DSnapshot) => void>;
}

export type GodotGpuParticles3DCarrier = CpuParticles3D | Object3D | object;

const GPU_PARTICLES_STATE = new WeakMap<object, MutableGpuParticlesState>();

function ownerOf(particles: GodotGpuParticles3DCarrier): object {
  if (typeof particles !== 'object' || particles === null) {
    throw new TypeError('godot-compat: GPUParticles3D requires a particle emitter object.');
  }
  return particles;
}

function stateOf(particles: GodotGpuParticles3DCarrier): MutableGpuParticlesState {
  const owner = ownerOf(particles);
  let state = GPU_PARTICLES_STATE.get(owner);
  if (state !== undefined) return state;
  state = {
    oneShot: false,
    amountRatio: 1,
    explosiveness: 0,
    randomness: 0,
    visibilityAabb: null,
    trailEnabled: false,
    trailLifetime: 0.3,
    interpolationToEnd: 0,
    drawOrder: GODOT_PARTICLES_DRAW_ORDER.INDEX,
    transformAlign: GODOT_PARTICLES_TRANSFORM_ALIGN.DISABLED,
    processMaterial: null,
    drawPasses: [null, null, null, null],
    binding: null,
    listeners: new Set(),
  };
  if ('drawPass1' in owner) state.drawPasses[0] = (owner as CpuParticles3D).drawPass1;
  GPU_PARTICLES_STATE.set(owner, state);
  return state;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: GPUParticles3D.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: GPUParticles3D.${member} requires bool.`);
  return value;
}

function copyAabb(value: GodotAabb | null): GodotAabb | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !value.position || !value.size ||
    ![value.position.x, value.position.y, value.position.z, value.size.x, value.size.y, value.size.z]
      .every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new TypeError('godot-compat: GPUParticles3D.visibility_aabb requires a finite AABB.');
  }
  return Object.freeze({
    position: Object.freeze({ ...value.position }),
    size: Object.freeze({ ...value.size }),
  });
}

function snapshot(state: MutableGpuParticlesState): GodotGpuParticles3DSnapshot {
  return Object.freeze({
    oneShot: state.oneShot,
    amountRatio: state.amountRatio,
    explosiveness: state.explosiveness,
    randomness: state.randomness,
    visibilityAabb: copyAabb(state.visibilityAabb),
    trailEnabled: state.trailEnabled,
    trailLifetime: state.trailLifetime,
    interpolationToEnd: state.interpolationToEnd,
    drawOrder: state.drawOrder,
    transformAlign: state.transformAlign,
    processMaterial: state.processMaterial,
    drawPasses: Object.freeze([...state.drawPasses]),
  });
}

function publish(state: MutableGpuParticlesState): void {
  const value = snapshot(state);
  state.binding?.apply(value);
  for (const listener of state.listeners) listener(value);
}

export function bindGodotGpuParticles3D(
  particles: GodotGpuParticles3DCarrier,
  binding: GodotGpuParticles3DBinding | null,
): () => void {
  const state = stateOf(particles);
  state.binding = binding;
  if (binding !== null) binding.apply(snapshot(state));
  return () => {
    if (state.binding === binding) state.binding = null;
  };
}

export function watchGodotGpuParticles3D(
  particles: GodotGpuParticles3DCarrier,
  listener: (snapshot: GodotGpuParticles3DSnapshot) => void,
): () => void {
  const state = stateOf(particles);
  state.listeners.add(listener);
  listener(snapshot(state));
  return () => state.listeners.delete(listener);
}

export function getGodotGpuParticles3DSnapshot(particles: GodotGpuParticles3DCarrier): GodotGpuParticles3DSnapshot {
  return snapshot(stateOf(particles));
}

export function isGodotGpuParticles3DOneShot(particles: GodotGpuParticles3DCarrier): boolean { return stateOf(particles).oneShot; }
export function setGodotGpuParticles3DOneShot(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.oneShot = boolean(value, 'one_shot'); publish(state);
}

export function getGodotGpuParticles3DAmountRatio(particles: GodotGpuParticles3DCarrier): number { return stateOf(particles).amountRatio; }
export function setGodotGpuParticles3DAmountRatio(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.amountRatio = finite(value, 'amount_ratio', 0, 1); publish(state);
}

export function getGodotGpuParticles3DExplosiveness(particles: GodotGpuParticles3DCarrier): number { return stateOf(particles).explosiveness; }
export function setGodotGpuParticles3DExplosiveness(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.explosiveness = finite(value, 'explosiveness', 0, 1); publish(state);
}

export function getGodotGpuParticles3DRandomness(particles: GodotGpuParticles3DCarrier): number { return stateOf(particles).randomness; }
export function setGodotGpuParticles3DRandomness(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.randomness = finite(value, 'randomness', 0, 1); publish(state);
}

export function getGodotGpuParticles3DVisibilityAabb(particles: GodotGpuParticles3DCarrier): GodotAabb | null {
  return copyAabb(stateOf(particles).visibilityAabb);
}
export function setGodotGpuParticles3DVisibilityAabb(particles: GodotGpuParticles3DCarrier, value: GodotAabb | null): void {
  const state = stateOf(particles); state.visibilityAabb = copyAabb(value); publish(state);
}

export function isGodotGpuParticles3DTrailEnabled(particles: GodotGpuParticles3DCarrier): boolean { return stateOf(particles).trailEnabled; }
export function setGodotGpuParticles3DTrailEnabled(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.trailEnabled = boolean(value, 'trail_enabled'); publish(state);
}

export function getGodotGpuParticles3DTrailLifetime(particles: GodotGpuParticles3DCarrier): number { return stateOf(particles).trailLifetime; }
export function setGodotGpuParticles3DTrailLifetime(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.trailLifetime = finite(value, 'trail_lifetime', 0.001); publish(state);
}

export function getGodotGpuParticles3DInterpolationToEnd(particles: GodotGpuParticles3DCarrier): number { return stateOf(particles).interpolationToEnd; }
export function setGodotGpuParticles3DInterpolationToEnd(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const state = stateOf(particles); state.interpolationToEnd = finite(value, 'interp_to_end', 0, 1); publish(state);
}

export function getGodotGpuParticles3DDrawOrder(particles: GodotGpuParticles3DCarrier): GodotParticlesDrawOrder { return stateOf(particles).drawOrder; }
export function setGodotGpuParticles3DDrawOrder(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const mode = finite(value, 'draw_order', 0, 3);
  if (!Number.isSafeInteger(mode)) throw new TypeError('godot-compat: GPUParticles3D.draw_order requires an integer.');
  const state = stateOf(particles); state.drawOrder = mode as GodotParticlesDrawOrder; publish(state);
}

export function getGodotGpuParticles3DTransformAlign(particles: GodotGpuParticles3DCarrier): GodotParticlesTransformAlign { return stateOf(particles).transformAlign; }
export function setGodotGpuParticles3DTransformAlign(particles: GodotGpuParticles3DCarrier, value: unknown): void {
  const mode = finite(value, 'transform_align', 0, 3);
  if (!Number.isSafeInteger(mode)) throw new TypeError('godot-compat: GPUParticles3D.transform_align requires an integer.');
  const state = stateOf(particles); state.transformAlign = mode as GodotParticlesTransformAlign; publish(state);
}

export function getGodotGpuParticles3DProcessMaterial(particles: GodotGpuParticles3DCarrier): GodotParticleProcessMaterial | Material | null {
  return stateOf(particles).processMaterial;
}
export function setGodotGpuParticles3DProcessMaterial(particles: GodotGpuParticles3DCarrier, value: GodotParticleProcessMaterial | Material | null): void {
  if (value !== null && typeof value !== 'object') throw new TypeError('godot-compat: GPUParticles3D.process_material requires Material or null.');
  const state = stateOf(particles); state.processMaterial = value; publish(state);
}

function drawPassIndex(value: unknown): number {
  const pass = finite(value, 'draw_pass', 0, 3);
  if (!Number.isSafeInteger(pass)) throw new TypeError('godot-compat: GPUParticles3D draw pass requires an integer.');
  return pass;
}

export function getGodotGpuParticles3DDrawPass(particles: GodotGpuParticles3DCarrier, pass: unknown): BufferGeometry | null {
  return stateOf(particles).drawPasses[drawPassIndex(pass)] ?? null;
}

export function setGodotGpuParticles3DDrawPass(
  particles: GodotGpuParticles3DCarrier,
  pass: unknown,
  geometry: BufferGeometry | null,
): void {
  if (geometry !== null && (typeof geometry !== 'object' || !('isBufferGeometry' in geometry))) {
    throw new TypeError('godot-compat: GPUParticles3D draw pass requires Mesh geometry or null.');
  }
  const index = drawPassIndex(pass);
  const state = stateOf(particles);
  state.drawPasses[index] = geometry;
  if (index === 0 && 'drawPass1' in ownerOf(particles)) (particles as CpuParticles3D).drawPass1 = geometry;
  publish(state);
}

export function getGodotGpuParticles3DDrawPasses(particles: GodotGpuParticles3DCarrier): number {
  const state = stateOf(particles);
  for (let index = state.drawPasses.length - 1; index >= 0; index -= 1) {
    if (state.drawPasses[index] !== null) return index + 1;
  }
  return 0;
}
