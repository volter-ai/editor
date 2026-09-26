/**
 * The node and resource families a scene writes as idiomatic JSX (GODOT.md, "The output is
 * idiomatic three.js"): which authored properties each family's element states, and the data files
 * an `ArrayMesh` becomes. A carried family has no other scene path: a property its element cannot
 * state refuses the scene, whatever shape the rest of the scene is written in.
 */
import type { TargetGodotArrayMeshPlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from './scene-document-plan';

/** The setters (`name`, or `name:index` for one index of an indexed property) each family states. */
const NODE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  MeshInstance3D: ['set_mesh', 'set_surface_override_material:*', 'set_layer_mask', 'set_cast_shadows_setting'],
  DirectionalLight3D: ['set_color', 'set_param:0', 'set_shadow', 'set_sky_mode'],
  OmniLight3D: ['set_color', 'set_param:0', 'set_param:4', 'set_param:6', 'set_shadow'],
  // The lens (`fov`, `near`, `far`) is the node's JSX property rules; `current` is the default camera.
  Camera3D: ['set_current'],
};

const PRIMITIVE_PLANE = ['set_size', 'set_subdivide_width', 'set_subdivide_depth', 'set_orientation', 'set_material'];

const RESOURCE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  PlaneMesh: PRIMITIVE_PLANE,
  QuadMesh: PRIMITIVE_PLANE,
  SphereMesh: ['set_radius', 'set_height', 'set_radial_segments', 'set_rings', 'set_is_hemisphere', 'set_material'],
  CylinderMesh: ['set_top_radius', 'set_bottom_radius', 'set_height', 'set_radial_segments', 'set_rings', 'set_cap_top', 'set_cap_bottom', 'set_material'],
  StandardMaterial3D: [
    'set_albedo',
    'set_metallic',
    'set_roughness',
    'set_feature:0',
    'set_emission',
    'set_emission_energy_multiplier',
    'set_transparency',
    'set_blend_mode',
    'set_shading_mode',
    'set_texture:0',
    'set_texture:2',
    'set_texture_filter',
    'set_flag:16',
  ],
  ArrayMesh: [],
  CompressedTexture2D: [],
};

/** Whether `className`'s nodes are written by a family's element. */
export function godotFamilyCarriesNode(className: string): boolean {
  return Object.hasOwn(NODE_SETTERS, className);
}

/** Whether `className`'s resources are written by a family's element or loader. */
export function godotFamilyCarriesResource(className: string): boolean {
  return Object.hasOwn(RESOURCE_SETTERS, className);
}

function valueOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string): TargetGodotSceneValue | undefined {
  return setters.find((entry) => entry.setter.exportName === exportName)?.value;
}

function numberOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, initial: number): number {
  const value = valueOf(setters, exportName);
  return value?.kind === 'number' ? value.value : initial;
}

function boolOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, initial: boolean): boolean {
  const value = valueOf(setters, exportName);
  return value?.kind === 'bool' ? value.value : initial;
}

function unstated(allowed: readonly string[], setters: readonly TargetGodotSceneSetterPlan[]): TargetGodotSceneSetterPlan | undefined {
  return setters.find(
    (entry) =>
      !allowed.includes(entry.setter.exportName) &&
      !allowed.includes(`${entry.setter.exportName}:*`) &&
      !allowed.includes(`${entry.setter.exportName}:${String(entry.index)}`),
  );
}

const f32 = Math.fround;

/**
 * Why a family's element cannot state these authored properties (the property named), or
 * undefined when it can.
 */
export function godotFamilyRefusal(
  className: string,
  kind: 'node' | 'resource',
  setters: readonly TargetGodotSceneSetterPlan[],
): string | undefined {
  const allowed = (kind === 'node' ? NODE_SETTERS : RESOURCE_SETTERS)[className];
  if (allowed === undefined) return undefined;
  const extra = unstated(allowed, setters);
  if (extra !== undefined) return `${extra.propertyName} has no ${className} element prop`;
  switch (className) {
    case 'SphereMesh': {
      if (boolOf(setters, 'set_is_hemisphere', false)) return 'is_hemisphere has no three sphere';
      const radius = numberOf(setters, 'set_radius', 0.5);
      const height = numberOf(setters, 'set_height', 1);
      return f32(height) === f32(radius * 2) ? undefined : 'a height other than the diameter has no three sphere';
    }
    case 'CylinderMesh':
      return boolOf(setters, 'set_cap_top', true) === boolOf(setters, 'set_cap_bottom', true)
        ? undefined
        : 'one cap without the other has no three cylinder';
    case 'StandardMaterial3D': {
      const transparency = numberOf(setters, 'set_transparency', 0);
      if (transparency > 2) return `transparency=${String(transparency)} has no three form`;
      const blend = numberOf(setters, 'set_blend_mode', 0);
      if (blend > 3) return `blend_mode=${String(blend)} has no three form`;
      const shading = numberOf(setters, 'set_shading_mode', 1);
      return shading > 1 ? `shading_mode=${String(shading)} has no three form` : undefined;
    }
    default:
      return undefined;
  }
}

/** An `ArrayMesh` as three reads it: the surfaces joined, a group per surface. */
export interface GodotArrayMeshData {
  readonly position: readonly number[];
  readonly normal?: readonly number[];
  readonly tangent?: readonly number[];
  readonly color?: readonly number[];
  readonly uv?: readonly number[];
  readonly uv1?: readonly number[];
  readonly index: readonly number[];
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: number }[];
}

/** Why an `ArrayMesh`'s surfaces have no joined three geometry, or undefined. */
export function godotArrayMeshRefusal(mesh: TargetGodotArrayMeshPlan): string | undefined {
  // `PRIMITIVE_TRIANGLES` (`rendering_server_enums.h:208`).
  if (mesh.surfaces.some((surface) => surface.primitive !== 3)) return 'a surface that is not triangles';
  const present = (surface: TargetGodotArrayMeshPlan['surfaces'][number]) =>
    Object.entries(surface.arrays)
      .filter(([, values]) => values !== undefined)
      .map(([name]) => (name === 'index' ? '' : name))
      .join();
  const first = mesh.surfaces[0];
  if (first !== undefined && mesh.surfaces.some((surface) => present(surface) !== present(first))) {
    return 'surfaces with different arrays';
  }
  return undefined;
}

/**
 * The surfaces converted at import into three's conventions: each triangle's last two indices
 * exchanged (Godot's front faces wind clockwise, `glFrontFace(GL_CW)`), UVs with their origin at the
 * bottom (three's; Godot's is the top, so `v` becomes `1 - v`, and a tangent's handedness flips with
 * it), the surfaces' arrays joined and a group per surface drawing its material.
 */
export function godotArrayMeshData(mesh: TargetGodotArrayMeshPlan): GodotArrayMeshData {
  const joined = (name: keyof TargetGodotArrayMeshPlan['surfaces'][number]['arrays'], map: (values: readonly number[]) => number[] = (values) => [...values]) => {
    if (mesh.surfaces.every((surface) => surface.arrays[name] === undefined)) return undefined;
    return mesh.surfaces.flatMap((surface) => map(surface.arrays[name] as readonly number[]));
  };
  const flipV = (values: readonly number[]) => values.map((value, i) => (i % 2 === 1 ? f32(1 - value) : value));
  const index: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let base = 0;
  mesh.surfaces.forEach((surface, materialIndex) => {
    const vertices = surface.arrays.vertex?.length ?? 0;
    const own = surface.arrays.index ?? Array.from({ length: vertices / 3 }, (_, i) => i);
    const start = index.length;
    for (let i = 0; i + 2 < own.length; i += 3) {
      index.push((own[i] as number) + base, (own[i + 2] as number) + base, (own[i + 1] as number) + base);
    }
    groups.push({ start, count: index.length - start, materialIndex });
    base += vertices / 3;
  });
  const normal = joined('normal');
  const tangent = joined('tangent', (values) => values.map((value, i) => (i % 4 === 3 ? -value : value)));
  const color = joined('color');
  const uv = joined('tex_uv', flipV);
  const uv1 = joined('tex_uv2', flipV);
  return {
    position: joined('vertex') ?? [],
    ...(normal === undefined ? {} : { normal }),
    ...(tangent === undefined ? {} : { tangent }),
    ...(color === undefined ? {} : { color }),
    ...(uv === undefined ? {} : { uv }),
    ...(uv1 === undefined ? {} : { uv1 }),
    index,
    groups: mesh.surfaces.length > 1 ? groups : [],
  };
}

/**
 * Where an `ArrayMesh`'s data file is written: a scene's own sub-resource beside the scene, a
 * resource file's under `src/meshes/` (shared by every scene that uses it).
 */
export function godotArrayMeshDataPath(sceneTargetPath: string, key: string): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9._/-]+/gu, '_');
  if (key.startsWith('sub:')) return `${sceneTargetPath.replace(/\.tsx$/u, '')}.${safe(key.slice('sub:'.length))}.mesh.json`;
  const [file, sub] = key.slice('ext:res://'.length).split('#sub:') as [string, string | undefined];
  return `src/meshes/${safe(file)}${sub === undefined ? '' : `.${safe(sub)}`}.json`;
}
