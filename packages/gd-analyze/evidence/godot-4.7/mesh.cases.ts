/**
 * Mesh (on ArrayMesh): meshes built natively with `add_surface_from_arrays` (uncompressed positions, UVs,
 * colours and indices; normals are octahedral-quantized on the way in, so a surface built here
 * carries none: the scene-meshes proof compares imported normals and tangents) and in compat from
 * the same arrays (colours at multiples of 1/255: a surface stores them as 8-bit unorm), read back
 * through the surface getters.
 */
import * as AM from '../../capabilities/catalog/project-source/src/lib/godot-compat/array-mesh';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/mesh';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/standard-material-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('Mesh');

interface Surface {
  readonly vertex: readonly number[];
  readonly tex_uv?: readonly number[];
  readonly color?: readonly number[];
  readonly index?: readonly number[];
}

const QUAD: Surface = {
  vertex: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
  tex_uv: [0, 0, 1, 0, 1, 1, 0, 1],
  index: [0, 1, 2, 0, 2, 3],
};
const TRI: Surface = { vertex: [0.1, 0.25, -3.5, 2.75, 1e-3, 0, -0.3, 7.125, 1.5], color: [1, 0, 0, 1, 0, 1, 0, 0.2, 0.2, 0.4, 0.6, 1] };

function native(surfaces: readonly Surface[], material: boolean): string[] {
  const lines = ['var mesh := ArrayMesh.new()'];
  surfaces.forEach((surface, index) => {
    lines.push(`var a${String(index)} := []`, `a${String(index)}.resize(Mesh.ARRAY_MAX)`);
    const v3 = (flat: readonly number[]): string => `PackedVector3Array([${Array.from({ length: flat.length / 3 }, (_, i) => `Vector3(${flat.slice(i * 3, i * 3 + 3).map(gd).join(', ')})`).join(', ')}])`;
    const v2 = (flat: readonly number[]): string => `PackedVector2Array([${Array.from({ length: flat.length / 2 }, (_, i) => `Vector2(${flat.slice(i * 2, i * 2 + 2).map(gd).join(', ')})`).join(', ')}])`;
    lines.push(`a${String(index)}[Mesh.ARRAY_VERTEX] = ${v3(surface.vertex)}`);
    if (surface.tex_uv !== undefined) lines.push(`a${String(index)}[Mesh.ARRAY_TEX_UV] = ${v2(surface.tex_uv)}`);
    if (surface.color !== undefined) {
      const colors = Array.from({ length: surface.color.length / 4 }, (_, i) => `Color(${surface.color!.slice(i * 4, i * 4 + 4).map(gd).join(', ')})`);
      lines.push(`a${String(index)}[Mesh.ARRAY_COLOR] = PackedColorArray([${colors.join(', ')}])`);
    }
    if (surface.index !== undefined) lines.push(`a${String(index)}[Mesh.ARRAY_INDEX] = PackedInt32Array([${surface.index.join(', ')}])`);
    lines.push(`mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a${String(index)})`);
    if (material) lines.push(`mesh.surface_set_material(${String(index)}, StandardMaterial3D.new())`);
  });
  return lines;
}

function target(surfaces: readonly Surface[], material: boolean): AM.ArrayMesh {
  return AM.godot_array_mesh_new({ surfaces: surfaces.map((surface) => ({ primitive: 3, ...surface, ...(material ? { material: S.construct() } : {}) })) });
}

/** A surface's arrays as plain numbers, the way both sides can print them. */
const nativeRead = (s: number): string =>
  `[mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_VERTEX], mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_TEX_UV], (null if mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_COLOR] == null else Array(mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_COLOR])), mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_INDEX], mesh.surface_get_arrays(${String(s)})[Mesh.ARRAY_NORMAL], mesh.surface_get_arrays(${String(s)}).size()]`;

for (const [name, surfaces] of [
  ['quad', [QUAD]],
  ['tri', [TRI]],
  ['two', [QUAD, TRI]],
] as const) {
  c.add(`get_surface_count-${name}`, 'get_surface_count', [...native(surfaces, false), 'return mesh.get_surface_count()'], () => M.get_surface_count(target(surfaces, false)));
  surfaces.forEach((_, s) => {
    c.add(`surface_get_arrays-${name}-${String(s)}`, 'surface_get_arrays', [...native(surfaces, false), `return ${nativeRead(s)}`], () => {
      const arrays = M.surface_get_arrays(target(surfaces, false), s);
      return [arrays[0], arrays[4], arrays[3], arrays[12], arrays[1], arrays.length];
    });
    for (const material of [false, true]) {
      c.add(`surface_get_material-${name}-${String(s)}-${String(material)}`, 'surface_get_material', [...native(surfaces, material), `return mesh.surface_get_material(${String(s)}) == null`], () => M.surface_get_material(target(surfaces, material), s) === null);
    }
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Mesh', compatModule: 'lib/godot-compat/mesh', cases: c.cases };
export default EVIDENCE;
