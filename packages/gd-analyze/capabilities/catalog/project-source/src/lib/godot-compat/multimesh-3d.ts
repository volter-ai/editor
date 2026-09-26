/** Native Three ownership for Godot MultiMeshInstance / MultiMeshInstance3D. */

import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import { getGodotMeshResourceMaterials } from './mesh-instance';
import {
  GodotMultiMesh,
  MULTIMESH_TRANSFORM_3D,
  type MultiMeshChange,
} from './multimesh';
import type { ColorValue } from './variant';
import type { Transform } from './variant-3d';

export type GodotMultiMeshInstance3D = Object3D & {
  multimesh: GodotMultiMesh | null;
  set_multimesh(value: GodotMultiMesh | null): void;
  get_multimesh(): GodotMultiMesh | null;
  readonly nativeInstancedMesh: InstancedMesh | null;
};

export interface GodotMultiMeshInstance3DOptions {
  readonly major?: 3 | 4;
  readonly multimesh?: GodotMultiMesh | null;
  readonly material?: Material | Material[];
  /** The caller just constructed these materials for this node; the node may patch/dispose them. */
  readonly takeMaterialOwnership?: boolean;
}

interface ViewState {
  resource: GodotMultiMesh | null;
  material: Material | Material[];
  ownedMaterials: Material[];
  materialExplicit: boolean;
  mesh: InstancedMesh | null;
  unsubscribe: (() => void) | null;
}

const STATES = new WeakMap<GodotMultiMeshInstance3D, ViewState>();
const MATRIX = new Matrix4();
const COLOR = new Color();

function transformMatrix(value: Transform): Matrix4 {
  return MATRIX.set(
    value.basis[0].x, value.basis[1].x, value.basis[2].x, value.origin.x,
    value.basis[0].y, value.basis[1].y, value.basis[2].y, value.origin.y,
    value.basis[0].z, value.basis[1].z, value.basis[2].z, value.origin.z,
    0, 0, 0, 1,
  );
}

function requireState(owner: GodotMultiMeshInstance3D): ViewState {
  const state = STATES.get(owner);
  if (state === undefined) throw new Error('MultiMeshInstance3D was released.');
  return state;
}

function sourceGeometry(resource: GodotMultiMesh): BufferGeometry | null {
  const value = resource.mesh;
  if (value === null) return null;
  if (!(value instanceof BufferGeometry)) {
    throw new TypeError('MultiMeshInstance3D requires MultiMesh.mesh to be a native THREE.BufferGeometry Mesh resource.');
  }
  return value;
}

function instanceMaterial(source: Material, clone: boolean): Material {
  if (source instanceof ShaderMaterial) {
    throw new Error('MultiMeshInstance3D cannot inject Godot per-instance alpha into an authored THREE.ShaderMaterial; translate its INSTANCE_COLOR shader input explicitly.');
  }
  const material = clone ? source.clone() : source;
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.transparent = true;
  (material as Material & { vertexColors: boolean }).vertexColors = true;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    if (!shader.vertexShader.includes('#include <common>') || !shader.vertexShader.includes('#include <begin_vertex>') ||
        !shader.fragmentShader.includes('#include <common>') || !shader.fragmentShader.includes('vec4 diffuseColor = vec4( diffuse, opacity );')) {
      throw new Error('MultiMesh per-instance alpha requires a Three material using the standard shader chunks.');
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float godotInstanceAlpha;\nvarying float vGodotInstanceAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGodotInstanceAlpha = godotInstanceAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGodotInstanceAlpha;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vGodotInstanceAlpha );');
  };
  material.customProgramCacheKey = () => `${previousKey()}|godot-multimesh-instance-alpha-v1`;
  material.needsUpdate = true;
  return material;
}

function materialsOf(source: Material | Material[] | undefined, takeOwnership: boolean): { material: Material | Material[]; owned: Material[] } {
  if (source === undefined) {
    const material = instanceMaterial(new MeshBasicMaterial({ color: 0xffffff }), false);
    return { material, owned: [material] };
  }
  const owned = (Array.isArray(source) ? source : [source]).map((one) => instanceMaterial(one, !takeOwnership));
  return { material: Array.isArray(source) ? owned : owned[0]!, owned };
}

function replaceMaterials(state: ViewState, source: Material | Material[] | undefined): void {
  for (const material of state.ownedMaterials) material.dispose();
  const replacement = materialsOf(source, false);
  state.material = replacement.material;
  state.ownedMaterials = replacement.owned;
}

function resourceMaterials(resource: GodotMultiMesh | null): Material | Material[] | undefined {
  if (resource === null || !(resource.mesh instanceof BufferGeometry)) return undefined;
  const materials = getGodotMeshResourceMaterials(resource.mesh);
  return materials.length === 0 ? undefined : materials.length === 1 ? materials[0] : [...materials];
}

function applyColor(mesh: InstancedMesh, index: number, value: ColorValue): void {
  COLOR.setRGB(value.r, value.g, value.b);
  mesh.setColorAt(index, COLOR);
  const alpha = mesh.geometry.getAttribute('godotInstanceAlpha') as InstancedBufferAttribute;
  alpha.setX(index, value.a);
  alpha.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
}

function applyInstance(resource: GodotMultiMesh, mesh: InstancedMesh, index: number): void {
  mesh.setMatrixAt(index, transformMatrix(resource.get_instance_transform(index)));
  if (resource.use_colors) applyColor(mesh, index, resource.get_instance_color(index));
  mesh.instanceMatrix.needsUpdate = true;
}

function discardNative(owner: GodotMultiMeshInstance3D, state: ViewState): void {
  if (state.mesh === null) return;
  owner.remove(state.mesh);
  // The InstancedMesh owns its clone carrying per-instance attributes, never the Resource geometry.
  state.mesh.geometry.dispose();
  state.mesh = null;
}

function rebuild(owner: GodotMultiMeshInstance3D, state: ViewState): void {
  discardNative(owner, state);
  const resource = state.resource;
  if (resource === null) return;
  if (resource.transform_format !== MULTIMESH_TRANSFORM_3D) {
    throw new Error('MultiMeshInstance3D requires MultiMesh.TRANSFORM_3D.');
  }
  if (resource.use_custom_data) {
    throw new Error('MultiMeshInstance3D cannot consume INSTANCE_CUSTOM without an authored Three shader backend.');
  }
  const source = sourceGeometry(resource);
  if (source === null) return;
  const geometry = source.clone();
  const count = resource.instance_count;
  geometry.setAttribute('godotInstanceAlpha', new InstancedBufferAttribute(new Float32Array(count).fill(1), 1).setUsage(DynamicDrawUsage));
  const native = new InstancedMesh(geometry, state.material, count);
  native.instanceMatrix.setUsage(DynamicDrawUsage);
  native.count = resource.visible_instance_count < 0
    ? count
    : Math.min(resource.visible_instance_count, count);
  native.frustumCulled = false;
  native.userData['godotMultiMesh'] = resource;
  for (let index = 0; index < count; index += 1) applyInstance(resource, native, index);
  state.mesh = native;
  owner.add(native);
}

function applyChange(owner: GodotMultiMeshInstance3D, state: ViewState, change: MultiMeshChange): void {
  const resource = state.resource;
  const native = state.mesh;
  if (resource === null) return;
  if (change.kind === 'allocation' || change.kind === 'mesh') {
    if (change.kind === 'mesh' && !state.materialExplicit) replaceMaterials(state, resourceMaterials(resource));
    rebuild(owner, state);
    return;
  }
  if (change.kind === 'visible') {
    if (native !== null) native.count = resource.visible_instance_count < 0
      ? resource.instance_count
      : Math.min(resource.visible_instance_count, resource.instance_count);
    return;
  }
  if (native === null) return;
  if (change.kind === 'transform') {
    native.setMatrixAt(change.index, transformMatrix(resource.get_instance_transform(change.index)));
    native.instanceMatrix.needsUpdate = true;
  } else if (change.kind === 'color') {
    applyColor(native, change.index, resource.get_instance_color(change.index));
  } else if (change.kind === 'custom-data') {
    throw new Error('MultiMeshInstance3D received INSTANCE_CUSTOM data without an authored Three shader backend.');
  } else {
    for (let index = 0; index < resource.instance_count; index += 1) applyInstance(resource, native, index);
  }
}

function bind(owner: GodotMultiMeshInstance3D, resource: GodotMultiMesh | null): void {
  const state = requireState(owner);
  if (resource !== null && !(resource instanceof GodotMultiMesh)) {
    throw new TypeError('MultiMeshInstance3D.multimesh requires a retained GodotMultiMesh Resource or null.');
  }
  if (state.resource === resource) return;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.resource = resource;
  if (!state.materialExplicit) replaceMaterials(state, resourceMaterials(resource));
  if (resource !== null) state.unsubscribe = resource.observe((change) => applyChange(owner, state, change));
  rebuild(owner, state);
}

export function createGodotMultiMeshInstance3D(
  options: GodotMultiMeshInstance3DOptions = {},
): GodotMultiMeshInstance3D {
  return bindGodotMultiMeshInstance3D(new Object3D(), options);
}

/** Adopt an emitter-owned root Object3D, or update a previously adopted root's binding. */
export function bindGodotMultiMeshInstance3D(
  value: Object3D,
  options: GodotMultiMeshInstance3DOptions = {},
): GodotMultiMeshInstance3D {
  const owner = value as GodotMultiMeshInstance3D;
  const retained = STATES.get(owner);
  if (retained !== undefined) {
    if (options.material !== undefined) {
      for (const material of retained.ownedMaterials) material.dispose();
      const materials = materialsOf(options.material, options.takeMaterialOwnership === true);
      retained.material = materials.material;
      retained.ownedMaterials = materials.owned;
      retained.materialExplicit = true;
    }
    if (options.multimesh !== undefined) bind(owner, options.multimesh);
    else if (options.material !== undefined) rebuild(owner, retained);
    return owner;
  }
  const materials = materialsOf(options.material, options.takeMaterialOwnership === true);
  const state: ViewState = {
    resource: null,
    material: materials.material,
    ownedMaterials: materials.owned,
    materialExplicit: options.material !== undefined,
    mesh: null,
    unsubscribe: null,
  };
  STATES.set(owner, state);
  registerGodotObjectIdentity(owner, options.major === 4 ? 'MultiMeshInstance3D' : 'MultiMeshInstance');
  Object.defineProperties(owner, {
    multimesh: {
      enumerable: true,
      configurable: false,
      get: () => state.resource,
      set: (value: GodotMultiMesh | null) => bind(owner, value),
    },
    nativeInstancedMesh: { enumerable: false, configurable: false, get: () => state.mesh },
  });
  owner.set_multimesh = (value) => bind(owner, value);
  owner.get_multimesh = () => state.resource;
  bind(owner, options.multimesh ?? null);
  return owner;
}

export function releaseGodotMultiMeshInstance3D(owner: GodotMultiMeshInstance3D): void {
  const state = STATES.get(owner);
  if (state === undefined) return;
  state.unsubscribe?.();
  discardNative(owner, state);
  for (const material of state.ownedMaterials) material.dispose();
  STATES.delete(owner);
}
