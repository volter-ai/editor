/** Retained MeshInstance material ownership over native Three meshes. */

import { Material, Mesh, Object3D } from 'three';
import { applyGodotMaterialPriority } from './material';
import { GodotShaderMaterial } from './shader-material';
import {
  bindGodotSpatialMaterialAnimationState,
  getGodotSpatialMaterialAnimationEmissionEnergy,
  setGodotSpatialMaterialAnimationEmissionEnergy,
  type GodotSpatialMaterialAnimationState,
} from './spatial-material';

export type GodotGeometryMaterial = Material | GodotShaderMaterial;

interface MeshInstanceMaterialState {
  override: GodotGeometryMaterial | null;
  nativeOverride: Material | null;
  readonly surfaces: Map<number, Material | null>;
  readonly authored: WeakMap<Mesh, Material | Material[]>;
}

const materialState = new WeakMap<Object3D, MeshInstanceMaterialState>();
const castShadowState = new WeakMap<Object3D, 0 | 1>();

function meshesOf(node: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  node.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child);
  });
  if (meshes.length === 0) {
    throw new Error('MeshInstance material access requires a retained native Three Mesh.');
  }
  return meshes;
}

function stateOf(node: Object3D): MeshInstanceMaterialState {
  let state = materialState.get(node);
  if (state !== undefined) return state;
  state = { override: null, nativeOverride: null, surfaces: new Map(), authored: new WeakMap() };
  for (const mesh of meshesOf(node)) state.authored.set(mesh, mesh.material);
  materialState.set(node, state);
  return state;
}

function surfaceCount(node: Object3D): number {
  const meshes = meshesOf(node);
  if (meshes.length !== 1) {
    throw new Error(
      `MeshInstance surface access is ambiguous across ${meshes.length} native Three meshes.`,
    );
  }
  const state = stateOf(node);
  const material = state.authored.get(meshes[0]!);
  if (material === undefined) {
    throw new Error('MeshInstance native mesh ownership changed after material binding.');
  }
  return Array.isArray(material) ? material.length : 1;
}

function assertSurface(node: Object3D, surface: number): void {
  if (!Number.isInteger(surface) || surface < 0 || surface >= surfaceCount(node)) {
    throw new RangeError(`MeshInstance surface ${surface} is outside the native mesh surface range.`);
  }
}

function apply(node: Object3D, state: MeshInstanceMaterialState): void {
  for (const mesh of meshesOf(node)) {
    const authored = state.authored.get(mesh);
    if (authored === undefined) {
      throw new Error('MeshInstance native mesh ownership changed after material binding.');
    }
    if (state.nativeOverride !== null) {
      mesh.material = state.nativeOverride;
      applyGodotMaterialPriority(mesh, mesh.material);
      continue;
    }
    if (Array.isArray(authored)) {
      mesh.material = authored.map((material, index) => state.surfaces.get(index) ?? material);
    } else {
      mesh.material = state.surfaces.get(0) ?? authored;
    }
    applyGodotMaterialPriority(mesh, mesh.material);
  }
}

export function setGodotMeshMaterialOverride(
  node: Object3D,
  material: GodotGeometryMaterial | null,
): void {
  if (
    material !== null &&
    !(material instanceof Material) &&
    !(material instanceof GodotShaderMaterial)
  ) {
    throw new TypeError(
      'GeometryInstance3D.material_override requires a Material Resource or null.',
    );
  }
  const state = stateOf(node);
  if (state.override === material) return;
  if (state.override instanceof GodotShaderMaterial && state.nativeOverride !== null) {
    state.override.releaseNative(state.nativeOverride);
    state.nativeOverride.dispose();
  }
  state.override = material;
  state.nativeOverride = material instanceof GodotShaderMaterial
    ? material.createThreeMaterial()
    : material;
  apply(node, state);
}

export function getGodotMeshMaterialOverride(node: Object3D): GodotGeometryMaterial | null {
  return stateOf(node).override;
}

/**
 * Capture the material React authored on a MeshInstance as the retained Godot material_override
 * Resource. Subsequent nodes naming the same resource receive this exact object, preserving Godot
 * Resource sharing rather than cloning renderer parameters per node.
 */
export function captureGodotMeshSpatialMaterialOverride(
  node: Object3D,
  source: GodotSpatialMaterialAnimationState,
): Material {
  const meshes = meshesOf(node);
  const first = meshes[0]?.material;
  if (first === undefined || Array.isArray(first)) {
    throw new Error(
      'GeometryInstance3D.material_override requires one non-null native material shared by every surface.',
    );
  }
  bindGodotSpatialMaterialAnimationState(first, source);
  setGodotMeshMaterialOverride(node, first);
  return first;
}

/** Indexed AnimationPlayer setter over the retained material_override Resource. */
export function setGodotMeshMaterialOverrideEmissionEnergy(
  node: Object3D,
  value: unknown,
): void {
  const material = getGodotMeshMaterialOverride(node);
  if (material === null) {
    throw new Error(
      'GeometryInstance3D.material_override:emission_energy cannot resolve a null material_override.',
    );
  }
  if (!(material instanceof Material)) {
    throw new TypeError(
      'GeometryInstance3D.material_override:emission_energy requires SpatialMaterial or StandardMaterial3D, not ShaderMaterial.',
    );
  }
  setGodotSpatialMaterialAnimationEmissionEnergy(material, value);
}

export function getGodotMeshMaterialOverrideEmissionEnergy(node: Object3D): number {
  const material = getGodotMeshMaterialOverride(node);
  if (material === null) {
    throw new Error(
      'GeometryInstance3D.material_override:emission_energy cannot resolve a null material_override.',
    );
  }
  if (!(material instanceof Material)) {
    throw new TypeError(
      'GeometryInstance3D.material_override:emission_energy requires SpatialMaterial or StandardMaterial3D, not ShaderMaterial.',
    );
  }
  return getGodotSpatialMaterialAnimationEmissionEnergy(material);
}

export function releaseGodotMeshMaterialOverride(node: Object3D): void {
  const state = materialState.get(node);
  if (state === undefined) return;
  if (state.override instanceof GodotShaderMaterial && state.nativeOverride !== null) {
    state.override.releaseNative(state.nativeOverride);
    state.nativeOverride.dispose();
  }
  state.override = null;
  state.nativeOverride = null;
  apply(node, state);
}

export function setGodotMeshSurfaceMaterial(
  node: Object3D,
  surface: number,
  material: Material | null,
): void {
  assertSurface(node, surface);
  if (material !== null && !(material instanceof Material)) {
    throw new TypeError('MeshInstance surface material requires a native Three Material or null.');
  }
  const state = stateOf(node);
  if (material === null) state.surfaces.delete(surface);
  else state.surfaces.set(surface, material);
  apply(node, state);
}

export function getGodotMeshSurfaceMaterial(
  node: Object3D,
  surface: number,
): Material | null {
  assertSurface(node, surface);
  const state = stateOf(node);
  return state.surfaces.get(surface) ?? null;
}

export function getGodotMeshSurfaceCount(node: Object3D): number {
  return surfaceCount(node);
}

/** GeometryInstance3D shadow casting over the actual native Three mesh subtree. */
export function setGodotGeometryCastShadow(node: Object3D, mode: number): void {
  if (mode !== 0 && mode !== 1) {
    throw new Error(
      `GeometryInstance3D.cast_shadow ${String(mode)} requires double-sided or shadows-only material passes; only OFF (0) and ON (1) have exact native Three instance semantics.`,
    );
  }
  const enabled = mode === 1;
  for (const mesh of meshesOf(node)) mesh.castShadow = enabled;
  castShadowState.set(node, mode);
}

export function getGodotGeometryCastShadow(node: Object3D): number {
  const retained = castShadowState.get(node);
  if (retained !== undefined) return retained;
  // `meshesOf` deliberately refuses an empty native subtree. Do not let
  // `every([])` fabricate Godot's default ON for an owner with no render consumer.
  const meshes = meshesOf(node);
  const enabled = meshes.every((mesh) => mesh.castShadow);
  castShadowState.set(node, enabled ? 1 : 0);
  return enabled ? 1 : 0;
}
