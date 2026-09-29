/**
 * A Wavefront `.obj` as Godot's `wavefront_obj` importer makes it a Mesh
 * (`editor/import/3d/resource_importer_obj.cpp`, `_parse_obj`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): `v` positions (scaled and offset by the importer's
 * `scale_mesh` and `offset_mesh`), `vt` UVs with `v` flipped (`:304`), `vn` normals; each face a fan
 * of triangles in Godot's winding (the second corner, the first, the third, `:329`); one surface per
 * `usemtl` or `o` group (`:386`). A face without normals would have Godot generate them, which this
 * reader does not: such a file refuses by name.
 */

export interface ObjMeshSurface {
  /** Non-indexed triangle corners: `x, y, z` each. */
  readonly vertex: readonly number[];
  readonly normal: readonly number[];
  /** `u, v` each, `v` as Godot stores it (`1 - vt.v`). */
  readonly uv?: readonly number[];
}

export class ObjMeshError extends Error {}

export function readObjMesh(text: string, resPath: string, scale: readonly [number, number, number] = [1, 1, 1], offset: readonly [number, number, number] = [0, 0, 0]): readonly ObjMeshSurface[] {
  const vertices: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const uvs: [number, number][] = [];
  const surfaces: ObjMeshSurface[] = [];
  let vertex: number[] = [];
  let normal: number[] = [];
  let uv: number[] = [];
  let usesUv = false;
  const commit = () => {
    if (vertex.length > 0) surfaces.push({ vertex, normal, ...(usesUv ? { uv } : {}) });
    vertex = [];
    normal = [];
    uv = [];
    usesUv = false;
  };
  const index = (text: string | undefined, size: number, what: string): number => {
    let at = Number.parseInt(text ?? '', 10) - 1;
    if (at < 0) at += size + 1;
    if (!Number.isInteger(at) || at < 0 || at >= size) throw new ObjMeshError(`${resPath}: a face names ${what} ${String(text)} out of range`);
    return at;
  };
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    const parts = line.split(/\s+/u);
    if (line.startsWith('v ')) {
      vertices.push([Number(parts[1]) * scale[0] + offset[0], Number(parts[2]) * scale[1] + offset[1], Number(parts[3]) * scale[2] + offset[2]]);
    } else if (line.startsWith('vt ')) {
      uvs.push([Number(parts[1]), 1 - Number(parts[2])]);
    } else if (line.startsWith('vn ')) {
      normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (line.startsWith('f ')) {
      const corners = parts.slice(1).map((corner) => corner.split('/'));
      if (corners.length < 3) throw new ObjMeshError(`${resPath}: a face of fewer than three corners`);
      for (let i = 2; i < corners.length; i += 1) {
        // Godot's order: the previous corner, the first, the current (`idx = 1 ^ idx` for the first two).
        for (const corner of [corners[i - 1], corners[0], corners[i]] as string[][]) {
          if (corner[2] === undefined || corner[2] === '') throw new ObjMeshError(`${resPath}: a face without normals, which Godot would generate`);
          const position = vertices[index(corner[0], vertices.length, 'vertex')] as [number, number, number];
          const nrm = normals[index(corner[2], normals.length, 'normal')] as [number, number, number];
          vertex.push(...position);
          normal.push(...nrm);
          if (corner[1] !== undefined && corner[1] !== '') {
            usesUv = true;
            uv.push(...(uvs[index(corner[1], uvs.length, 'uv')] as [number, number]));
          } else {
            uv.push(0, 0);
          }
        }
      }
    } else if (line.startsWith('usemtl ') || line.startsWith('o ')) {
      commit();
    }
  }
  commit();
  if (surfaces.length === 0) throw new ObjMeshError(`${resPath}: no faces`);
  return surfaces;
}
