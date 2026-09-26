import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D, type Texture } from 'three';
import { registerGodotObjectIdentity } from './object';

export type GodotGpuParticlesCollisionKind =
  | 'GPUParticlesCollisionBox3D'
  | 'GPUParticlesCollisionSphere3D'
  | 'GPUParticlesCollisionSDF3D'
  | 'GPUParticlesCollisionHeightField3D'
  | 'GPUParticlesAttractorBox3D'
  | 'GPUParticlesAttractorSphere3D'
  | 'GPUParticlesAttractorVectorField3D';

export interface GodotParticlesCollisionVector3 { readonly x: number; readonly y: number; readonly z: number }

export interface GodotGpuParticlesCollisionSnapshot {
  readonly kind: GodotGpuParticlesCollisionKind;
  readonly size: GodotParticlesCollisionVector3;
  readonly radius: number;
  readonly strength: number;
  readonly attenuation: number;
  readonly directionality: number;
  readonly texture: Texture | null;
  readonly resolution: number;
  readonly thickness: number;
  readonly bakeMask: number;
}

export interface GodotGpuParticlesCollisionBinding {
  apply(node: Object3D, snapshot: GodotGpuParticlesCollisionSnapshot): void;
}

interface CollisionState {
  kind: GodotGpuParticlesCollisionKind;
  size: GodotParticlesCollisionVector3;
  radius: number;
  strength: number;
  attenuation: number;
  directionality: number;
  texture: Texture | null;
  resolution: number;
  thickness: number;
  bakeMask: number;
  debugMesh: Mesh | null;
  binding: GodotGpuParticlesCollisionBinding | null;
  listeners: Set<(snapshot: GodotGpuParticlesCollisionSnapshot) => void>;
}

const STATES = new WeakMap<Object3D, CollisionState>();

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: ${member} requires a finite value in [${minimum}, ${maximum}].`);
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const number = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return number;
}

function vector(value: unknown, member: string): GodotParticlesCollisionVector3 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError(`godot-compat: ${member} requires Vector3.`);
  return Object.freeze({ x: finite(value.x, `${member}.x`, Number.MIN_VALUE), y: finite(value.y, `${member}.y`, Number.MIN_VALUE), z: finite(value.z, `${member}.z`, Number.MIN_VALUE) });
}

function texture(value: unknown, member: string): Texture | null {
  if (value === null) return null;
  if (typeof value !== 'object' || !('isTexture' in value)) throw new TypeError(`godot-compat: ${member} requires Texture3D or null.`);
  return value as Texture;
}

function stateOf(node: Object3D): CollisionState {
  const state = STATES.get(node);
  if (state === undefined) throw new TypeError('godot-compat: particle collision member requires a retained collision node.');
  return state;
}

function snapshot(state: CollisionState): GodotGpuParticlesCollisionSnapshot {
  return Object.freeze({ kind: state.kind, size: { ...state.size }, radius: state.radius, strength: state.strength, attenuation: state.attenuation, directionality: state.directionality, texture: state.texture, resolution: state.resolution, thickness: state.thickness, bakeMask: state.bakeMask });
}

function rebuildDebugMesh(node: Object3D, state: CollisionState): void {
  state.debugMesh?.removeFromParent();
  state.debugMesh?.geometry.dispose();
  const spherical = state.kind.includes('Sphere');
  const geometry = spherical ? new SphereGeometry(state.radius, 24, 12) : new BoxGeometry(state.size.x, state.size.y, state.size.z);
  const material = new MeshBasicMaterial({ color: state.kind.includes('Attractor') ? 0x52a6ff : 0xff9b52, wireframe: true, transparent: true, opacity: 0.25, depthWrite: false });
  const debug = new Mesh(geometry, material);
  debug.visible = false;
  debug.userData['godotParticleCollisionDebug'] = true;
  node.add(debug);
  state.debugMesh = debug;
}

function publish(node: Object3D): void {
  const state = stateOf(node);
  const value = snapshot(state);
  state.binding?.apply(node, value);
  for (const listener of state.listeners) listener(value);
}

function create(kind: GodotGpuParticlesCollisionKind): Group {
  const node = new Group();
  const state: CollisionState = {
    kind,
    size: { x: 2, y: 2, z: 2 },
    radius: 1,
    strength: 1,
    attenuation: 1,
    directionality: 0,
    texture: null,
    resolution: 2,
    thickness: 1,
    bakeMask: 0xffff_ffff,
    debugMesh: null,
    binding: null,
    listeners: new Set(),
  };
  STATES.set(node, state);
  registerGodotObjectIdentity(node, kind);
  rebuildDebugMesh(node, state);
  return node;
}

export function createGodotGpuParticlesCollisionBox3D(): Group { return create('GPUParticlesCollisionBox3D'); }
export function createGodotGpuParticlesCollisionSphere3D(): Group { return create('GPUParticlesCollisionSphere3D'); }
export function createGodotGpuParticlesCollisionSdf3D(): Group { return create('GPUParticlesCollisionSDF3D'); }
export function createGodotGpuParticlesCollisionHeightField3D(): Group { return create('GPUParticlesCollisionHeightField3D'); }
export function createGodotGpuParticlesAttractorBox3D(): Group { return create('GPUParticlesAttractorBox3D'); }
export function createGodotGpuParticlesAttractorSphere3D(): Group { return create('GPUParticlesAttractorSphere3D'); }
export function createGodotGpuParticlesAttractorVectorField3D(): Group { return create('GPUParticlesAttractorVectorField3D'); }

export function bindGodotGpuParticlesCollision3D(node: Object3D, binding: GodotGpuParticlesCollisionBinding | null): () => void {
  const state = stateOf(node); state.binding = binding; if (binding !== null) binding.apply(node, snapshot(state));
  return () => { if (state.binding === binding) state.binding = null; };
}

export function watchGodotGpuParticlesCollision3D(node: Object3D, listener: (snapshot: GodotGpuParticlesCollisionSnapshot) => void): () => void {
  const state = stateOf(node); state.listeners.add(listener); listener(snapshot(state)); return () => state.listeners.delete(listener);
}

export function getGodotGpuParticlesCollisionSnapshot(node: Object3D): GodotGpuParticlesCollisionSnapshot { return snapshot(stateOf(node)); }
export function getGodotGpuParticlesCollisionSize(node: Object3D): GodotParticlesCollisionVector3 { return { ...stateOf(node).size }; }
export function setGodotGpuParticlesCollisionSize(node: Object3D, value: unknown): void { const state = stateOf(node); state.size = vector(value, `${state.kind}.size`); rebuildDebugMesh(node, state); publish(node); }
export function getGodotGpuParticlesCollisionRadius(node: Object3D): number { return stateOf(node).radius; }
export function setGodotGpuParticlesCollisionRadius(node: Object3D, value: unknown): void { const state = stateOf(node); state.radius = finite(value, `${state.kind}.radius`, Number.MIN_VALUE); rebuildDebugMesh(node, state); publish(node); }
export function getGodotGpuParticlesAttractorStrength(node: Object3D): number { return stateOf(node).strength; }
export function setGodotGpuParticlesAttractorStrength(node: Object3D, value: unknown): void { const state = stateOf(node); state.strength = finite(value, `${state.kind}.strength`); publish(node); }
export function getGodotGpuParticlesAttractorAttenuation(node: Object3D): number { return stateOf(node).attenuation; }
export function setGodotGpuParticlesAttractorAttenuation(node: Object3D, value: unknown): void { const state = stateOf(node); state.attenuation = finite(value, `${state.kind}.attenuation`, 0); publish(node); }
export function getGodotGpuParticlesAttractorDirectionality(node: Object3D): number { return stateOf(node).directionality; }
export function setGodotGpuParticlesAttractorDirectionality(node: Object3D, value: unknown): void { const state = stateOf(node); state.directionality = finite(value, `${state.kind}.directionality`, 0, 1); publish(node); }
export function getGodotGpuParticlesCollisionTexture(node: Object3D): Texture | null { return stateOf(node).texture; }
export function setGodotGpuParticlesCollisionTexture(node: Object3D, value: unknown): void { const state = stateOf(node); state.texture = texture(value, `${state.kind}.texture`); publish(node); }
export function getGodotGpuParticlesCollisionResolution(node: Object3D): number { return stateOf(node).resolution; }
export function setGodotGpuParticlesCollisionResolution(node: Object3D, value: unknown): void { const state = stateOf(node); state.resolution = integer(value, `${state.kind}.resolution`, 0, 5); publish(node); }
export function getGodotGpuParticlesCollisionThickness(node: Object3D): number { return stateOf(node).thickness; }
export function setGodotGpuParticlesCollisionThickness(node: Object3D, value: unknown): void { const state = stateOf(node); state.thickness = finite(value, `${state.kind}.thickness`, 0); publish(node); }
export function getGodotGpuParticlesCollisionBakeMask(node: Object3D): number { return stateOf(node).bakeMask; }
export function setGodotGpuParticlesCollisionBakeMask(node: Object3D, value: unknown): void { const state = stateOf(node); state.bakeMask = integer(value, `${state.kind}.bake_mask`, 0, 0xffff_ffff); publish(node); }
export function setGodotGpuParticlesCollisionDebugVisible(node: Object3D, visible: boolean): void { if (typeof visible !== 'boolean') throw new TypeError('particle collision debug visibility requires bool.'); const debug = stateOf(node).debugMesh; if (debug !== null) debug.visible = visible; }
export function disposeGodotGpuParticlesCollision3D(node: Object3D): void { const state = stateOf(node); state.debugMesh?.geometry.dispose(); (state.debugMesh?.material as MeshBasicMaterial | undefined)?.dispose(); node.removeFromParent(); STATES.delete(node); }
