/** Runtime Godot SurfaceTool over native Three BufferGeometry and Pixi MeshGeometry resources. */

import { MeshGeometry, Texture } from 'pixi.js';
import { BufferAttribute, BufferGeometry, Material } from 'three';
import {
  createGodotArrayMesh,
  getGodotMeshResourceSurfaceCount,
  refreshGodotMeshResourceViews,
  retainGodotMeshResource,
  setGodotMeshResourceSurfaceMaterial,
} from './mesh-instance';
import { godotObjectGetClass, registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';
import type { GodotMultiMesh2DGeometry } from './multimesh-2d';
import type { ColorValue } from './variant';
import type { Vector3 } from './variant-3d';
import type { Vector2 } from './vector2';

export const SURFACE_TOOL_PRIMITIVE_TRIANGLES = 4;

export type GodotSurfaceToolMesh = BufferGeometry & GodotMultiMesh2DGeometry & {
  readonly threeGeometry: BufferGeometry;
};

export interface GodotSurfaceTool {
  begin(primitive: number): void;
  add_color(color: ColorValue): void;
  add_uv(uv: Vector2): void;
  set_uv(uv: Vector2): void;
  set_normal(normal: Vector3): void;
  set_material(material: Material | null): void;
  generate_normals(flip?: boolean): void;
  add_vertex(vertex: Vector3): void;
  add_triangle_fan(vertices: readonly Vector3[]): void;
  commit(existing?: BufferGeometry | null, flags?: number): GodotSurfaceToolMesh;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`SurfaceTool.${member} requires finite numeric components.`);
  }
  return value;
}

function integer(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`SurfaceTool.${member} requires an integer.`);
  return value as number;
}

export function createGodotSurfaceTool(major: 3 | 4 = 3): GodotSurfaceTool {
  let begun = false;
  let currentColor: ColorValue = { r: 1, g: 1, b: 1, a: 1 };
  let currentUv: Vector2 = { x: 0, y: 0 };
  let currentNormal: Vector3 = { x: 0, y: 0, z: 0 };
  let normalsEnabled = false;
  let material: Material | null = null;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const requireBegun = (member: string): void => {
    if (!begun) throw new Error(`SurfaceTool.${member} requires begin() first.`);
  };
  const addVertex = (vertex: Vector3, member = 'add_vertex'): number => {
    const index = vertices.length / 3;
    vertices.push(
      finite(vertex?.x, `${member} vertex`),
      finite(vertex?.y, `${member} vertex`),
      finite(vertex?.z, `${member} vertex`),
    );
    uvs.push(currentUv.x, currentUv.y);
    normals.push(currentNormal.x, currentNormal.y, currentNormal.z);
    colors.push(currentColor.r, currentColor.g, currentColor.b, currentColor.a);
    return index;
  };

  const tool: GodotSurfaceTool = {
    begin(primitive) {
      if (integer(primitive, 'begin') !== (major === 3 ? SURFACE_TOOL_PRIMITIVE_TRIANGLES : 3)) {
        throw new Error('SurfaceTool.begin currently requires Mesh.PRIMITIVE_TRIANGLES.');
      }
      begun = true;
      vertices.length = 0;
      uvs.length = 0;
      normals.length = 0;
      colors.length = 0;
      indices.length = 0;
      currentColor = { r: 1, g: 1, b: 1, a: 1 };
      currentUv = { x: 0, y: 0 };
      currentNormal = { x: 0, y: 0, z: 0 };
      normalsEnabled = false;
      material = null;
    },
    add_color(color) {
      requireBegun('add_color');
      currentColor = {
        r: finite(color?.r, 'add_color'),
        g: finite(color?.g, 'add_color'),
        b: finite(color?.b, 'add_color'),
        a: finite(color?.a, 'add_color'),
      };
    },
    add_uv(uv) {
      requireBegun('add_uv');
      currentUv = { x: finite(uv?.x, 'add_uv'), y: finite(uv?.y, 'add_uv') };
    },
    set_uv(uv) {
      requireBegun('set_uv');
      currentUv = { x: finite(uv?.x, 'set_uv'), y: finite(uv?.y, 'set_uv') };
    },
    set_normal(normal) {
      requireBegun('set_normal');
      currentNormal = {
        x: finite(normal?.x, 'set_normal'),
        y: finite(normal?.y, 'set_normal'),
        z: finite(normal?.z, 'set_normal'),
      };
      normalsEnabled = true;
    },
    set_material(next) {
      requireBegun('set_material');
      if (next !== null && !(next instanceof Material)) {
        throw new TypeError('SurfaceTool.set_material requires a native Three Material or null.');
      }
      material = next;
    },
    generate_normals(flip = false) {
      requireBegun('generate_normals');
      if (typeof flip !== 'boolean') throw new TypeError('SurfaceTool.generate_normals requires a boolean flip flag.');
      normals.fill(0);
      for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
        const ia = (indices[cursor] as number) * 3;
        const ib = (indices[cursor + 1] as number) * 3;
        const ic = (indices[cursor + 2] as number) * 3;
        const abx = (vertices[ib] as number) - (vertices[ia] as number);
        const aby = (vertices[ib + 1] as number) - (vertices[ia + 1] as number);
        const abz = (vertices[ib + 2] as number) - (vertices[ia + 2] as number);
        const acx = (vertices[ic] as number) - (vertices[ia] as number);
        const acy = (vertices[ic + 1] as number) - (vertices[ia + 1] as number);
        const acz = (vertices[ic + 2] as number) - (vertices[ia + 2] as number);
        const direction = flip ? -1 : 1;
        const nx = (aby * acz - abz * acy) * direction;
        const ny = (abz * acx - abx * acz) * direction;
        const nz = (abx * acy - aby * acx) * direction;
        for (const offset of [ia, ib, ic]) {
          normals[offset] = (normals[offset] ?? 0) + nx;
          normals[offset + 1] = (normals[offset + 1] ?? 0) + ny;
          normals[offset + 2] = (normals[offset + 2] ?? 0) + nz;
        }
      }
      for (let offset = 0; offset < normals.length; offset += 3) {
        const x = normals[offset] as number;
        const y = normals[offset + 1] as number;
        const z = normals[offset + 2] as number;
        const length = Math.hypot(x, y, z);
        if (length > 0) {
          normals[offset] = x / length;
          normals[offset + 1] = y / length;
          normals[offset + 2] = z / length;
        }
      }
      normalsEnabled = true;
    },
    add_vertex(vertex) {
      requireBegun('add_vertex');
      indices.push(addVertex(vertex));
    },
    add_triangle_fan(fan) {
      requireBegun('add_triangle_fan');
      if (!Array.isArray(fan) || fan.length < 3) {
        throw new TypeError('SurfaceTool.add_triangle_fan requires at least three Vector3 vertices.');
      }
      const base = fan.map((vertex) => addVertex(vertex, 'add_triangle_fan'));
      for (let index = 1; index + 1 < base.length; index += 1) {
        indices.push(base[0] as number, base[index] as number, base[index + 1] as number);
      }
    },
    commit(existing = null, flags = 2_194_432) {
      requireBegun('commit');
      if (existing !== null && !(existing instanceof BufferGeometry)) {
        throw new TypeError(
          'SurfaceTool.commit(existing) requires the native BufferGeometry returned by ArrayMesh.new().',
        );
      }
      if (existing !== null && godotObjectGetClass(existing) !== 'ArrayMesh') {
        throw new TypeError(
          'SurfaceTool.commit(existing) requires an ArrayMesh Resource, not another Mesh subclass.',
        );
      }
      // Godot's flags select ArrayMesh storage compression. Three owns its native attribute
      // storage, so there is no second compressed representation to select here, but the integer
      // is still accepted as part of the exact call contract (Godot 3's default is nonzero).
      integer(flags, 'commit flags');
      if (vertices.length === 0) {
        return (existing ?? createGodotArrayMesh()) as GodotSurfaceToolMesh;
      }
      if (indices.length % 3 !== 0) {
        throw new Error(
          `SurfaceTool.commit requires complete triangle topology; received ${indices.length} indices.`,
        );
      }
      const positionArray = new Float32Array(vertices);
      const uvArray = new Float32Array(uvs);
      const colorArray = new Float32Array(colors);
      const mesh = appendTriangleSurface(existing ?? createGodotArrayMesh(), {
        positions: positionArray,
        uvs: uvArray,
        colors: colorArray,
        ...(normalsEnabled ? { normals: new Float32Array(normals) } : {}),
        indices: new Uint32Array(indices),
      });
      setGodotMeshResourceSurfaceMaterial(mesh, getGodotMeshResourceSurfaceCount(mesh) - 1, material);
      return mesh;
    },
  };
  registerGodotObjectIdentity(tool, 'SurfaceTool');
  return tool;
}

interface TriangleSurface {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array;
  readonly normals?: Float32Array;
  readonly indices: Uint32Array;
}

function nativeAttribute(
  geometry: BufferGeometry,
  name: 'position' | 'normal' | 'uv' | 'color',
  itemSize: number,
): BufferAttribute | undefined {
  const attribute = geometry.getAttribute(name);
  if (attribute === undefined) return undefined;
  if (!(attribute instanceof BufferAttribute) || attribute.itemSize !== itemSize) {
    throw new Error(
      `SurfaceTool.commit(existing) cannot append to an ArrayMesh whose ${name} attribute is ` +
        `interleaved or has itemSize ${attribute.itemSize}; expected a native BufferAttribute(${itemSize}).`,
    );
  }
  return attribute;
}

function appendFloatAttribute(
  prior: BufferAttribute | undefined,
  priorVertexCount: number,
  itemSize: number,
  next: Float32Array,
  fill: readonly number[],
): BufferAttribute {
  const values = new Float32Array(priorVertexCount * itemSize + next.length);
  if (prior !== undefined) {
    for (let index = 0; index < prior.count * itemSize; index += 1) {
      values[index] = Number(prior.array[index]);
    }
  } else {
    for (let vertex = 0; vertex < priorVertexCount; vertex += 1) {
      for (let component = 0; component < itemSize; component += 1) {
        values[vertex * itemSize + component] = fill[component] as number;
      }
    }
  }
  values.set(next, priorVertexCount * itemSize);
  return new BufferAttribute(values, itemSize);
}

function nativeIndices(geometry: BufferGeometry, vertexCount: number): Uint32Array {
  const index = geometry.getIndex();
  if (index === null) return Uint32Array.from({ length: vertexCount }, (_, value) => value);
  if (!(index instanceof BufferAttribute) || index.itemSize !== 1) {
    throw new Error('SurfaceTool.commit(existing) requires a native scalar BufferAttribute index.');
  }
  return Uint32Array.from(index.array, (value) => Number(value));
}

function attachPixiSurfaceView(mesh: BufferGeometry): GodotSurfaceToolMesh {
  const positions = nativeAttribute(mesh, 'position', 3);
  const uvs = nativeAttribute(mesh, 'uv', 2);
  const index = mesh.getIndex();
  if (positions === undefined || uvs === undefined || index === null) {
    throw new Error('SurfaceTool ArrayMesh lacks the native position, uv, or index buffer.');
  }
  const positions2D = new Float32Array(positions.count * 2);
  for (let source = 0, target = 0; source < positions.count * 3; source += 3, target += 2) {
    positions2D[target] = Number(positions.array[source]);
    positions2D[target + 1] = Number(positions.array[source + 1]);
  }
  const priorPixi = Reflect.get(mesh, 'geometry');
  if (priorPixi instanceof MeshGeometry) priorPixi.destroy();
  Object.defineProperties(mesh, {
    geometry: {
      configurable: true,
      value: new MeshGeometry({
        positions: positions2D,
        uvs: Float32Array.from(uvs.array, (value) => Number(value)),
        indices: Uint32Array.from(index.array, (value) => Number(value)),
      }),
    },
    texture: { configurable: true, writable: true, value: Texture.WHITE },
    threeGeometry: { configurable: true, value: mesh },
  });
  return mesh as GodotSurfaceToolMesh;
}

function appendTriangleSurface(mesh: BufferGeometry, surface: TriangleSurface): GodotSurfaceToolMesh {
  const geometry = retainGodotMeshResource(mesh);
  const existingPosition = nativeAttribute(geometry, 'position', 3);
  const existingUv = nativeAttribute(geometry, 'uv', 2);
  const existingColor = nativeAttribute(geometry, 'color', 4);
  const existingNormal = nativeAttribute(geometry, 'normal', 3);
  const priorVertexCount = existingPosition?.count ?? 0;
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') {
      throw new Error(
        `SurfaceTool.commit(existing) cannot append a differently shaped surface beside native ` +
          `attribute ${JSON.stringify(name)}; copy that surface through ArrayMesh arrays instead.`,
      );
    }
  }
  const priorIndices = nativeIndices(geometry, priorVertexCount);
  if (priorIndices.length % 3 !== 0) {
    throw new Error('SurfaceTool.commit(existing) refuses an existing non-triangle index buffer.');
  }
  let coveredIndices = 0;
  for (let surfaceIndex = 0; surfaceIndex < geometry.groups.length; surfaceIndex += 1) {
    const group = geometry.groups[surfaceIndex]!;
    if (
      group.start !== coveredIndices ||
      group.count <= 0 ||
      group.count % 3 !== 0 ||
      group.materialIndex !== surfaceIndex
    ) {
      throw new Error(
        `SurfaceTool.commit(existing) requires contiguous triangle surfaces whose native draw ` +
          `group and material slot equal the Godot surface index; surface ${surfaceIndex} does not.`,
      );
    }
    coveredIndices += group.count;
  }
  if (geometry.groups.length > 0 && coveredIndices !== priorIndices.length) {
    throw new Error(
      'SurfaceTool.commit(existing) refuses an ArrayMesh whose draw groups do not cover its index buffer.',
    );
  }
  if (priorVertexCount > 0 && geometry.groups.length === 0) {
    geometry.addGroup(0, priorIndices.length, 0);
  }
  const firstIndex = priorIndices.length;
  const combinedIndices = new Uint32Array(firstIndex + surface.indices.length);
  combinedIndices.set(priorIndices);
  for (let index = 0; index < surface.indices.length; index += 1) {
    combinedIndices[firstIndex + index] = priorVertexCount + (surface.indices[index] as number);
  }
  geometry.setAttribute(
    'position',
    appendFloatAttribute(existingPosition, priorVertexCount, 3, surface.positions, [0, 0, 0]),
  );
  geometry.setAttribute(
    'uv',
    appendFloatAttribute(existingUv, priorVertexCount, 2, surface.uvs, [0, 0]),
  );
  geometry.setAttribute(
    'color',
    appendFloatAttribute(existingColor, priorVertexCount, 4, surface.colors, [1, 1, 1, 1]),
  );
  if (existingNormal !== undefined || surface.normals !== undefined) {
    geometry.setAttribute(
      'normal',
      appendFloatAttribute(
        existingNormal,
        priorVertexCount,
        3,
        surface.normals ?? new Float32Array(surface.positions.length),
        [0, 0, 0],
      ),
    );
  }
  geometry.setIndex(new BufferAttribute(combinedIndices, 1));
  geometry.addGroup(firstIndex, surface.indices.length, geometry.groups.length);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  refreshGodotMeshResourceViews(geometry);
  godotResourceEmitChanged(geometry);
  return attachPixiSurfaceView(geometry);
}
