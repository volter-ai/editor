/** Draw a mesh snapshot without allocating editable BMesh topology.
 * Triangulation, smooth connected fans, UV splits and material groups follow
 * toBufferGeometry; only the temporary adjacency uses compact corner indices.
 *
 * Two doors, one algorithm. The worker that owns the mesh store draws from
 * the COLUMNS into typed arrays (`drawArraysFromColumns`) and the tab turns
 * those into a `BufferGeometry` (`geometryFromDrawArrays`) — the frame
 * crosses as transferable buffers, never as nested number arrays. The
 * boundary JSON door (`drawRuntimeGeometry`) remains for a frame that
 * arrives as JSON.
 *
 * A drawn geometry carried a `userData.authoredUv` mark until 2026-09-19.
 * MEASURED when this file became `@volter/editor-blender`'s: its only readers were the
 * kit's own `bmesh.ts` and `unwrap.ts`, and a presented frame's geometry is
 * never handed to the kit — it is the Model document's scene. Data with no
 * reader is not authored, so the mark is gone.
 */
import * as THREE from 'three';
import { customCornerNormals, type Normal } from './blender-corner-normals';
import { ATTRIBUTE_LAYOUT, type MeshColumns } from './blender-frame-columns';
import { triangulatePolygon } from './blender-triangulate';

type MeshData = {
  v: [number, number, number][];
  f: number[][];
  e?: [number, number][] | undefined;
  edge_order?: [number, number][] | undefined;
  m?: number[] | undefined;
  s?: boolean[] | undefined;
  sharp?: [number, number][] | undefined;
  attributes?: { name: string; domain: string; type: string; data: unknown[] }[] | undefined;
  active_uv?: string | null | undefined;
  render_uv?: string | null | undefined;
};

/** The draw geometry as buffers: what the worker posts and the tab uploads. */
export interface DrawArrays {
  positions: Float32Array;
  normals: Float32Array | null;
  /** Per drawn vertex, or null when the mesh has no UV map. */
  uv: Float32Array | null;
  indices: Uint32Array;
  groups: { start: number; count: number; materialIndex: number }[];
  /** THE BLENDER VERTEX EACH DRAWN VERTEX CAME FROM, one per drawn vertex.
   *
   * The draw splits a Blender vertex into as many drawn ones as its corners
   * need (a UV seam, a sharp edge, a flat face), so nothing downstream can
   * recover the mapping from the arrays alone — and an overlay that colours by
   * a PER-VERTEX fact off the engine (a vertex group's weights,
   * `blender-runtime-weights.ts`) needs exactly this. `emit` is the one place
   * a drawn vertex is created, so it is the one place that knows. */
  sourceVertex: Uint32Array;
  /** The store's content hash: the frame reuse key. */
  hash: string;
}

/** What the draw algorithm reads, from either door. */
interface DrawView {
  vertexCount: number;
  normals: Normal[] | null;
  co(i: number): THREE.Vector3;
  /** CSR faces: corner `starts[i]..starts[i+1]` hold vertex indices. */
  starts: Uint32Array;
  cornerVerts: Uint32Array;
  smooth(face: number): boolean;
  material(face: number): number;
  /** Every mesh edge as a vertex pair; `null` when only faces define them. */
  edges: Iterable<[number, number]> | null;
  sharp: Iterable<[number, number]>;
  /** A corner's UV, or undefined when the mesh has no map. */
  uv: ((corner: number) => [number, number]) | null;
}

function drawCore(view: DrawView): Omit<DrawArrays, 'hash'> {
  const nv = view.vertexCount,
    nf = view.starts.length - 1;
  const starts = view.starts,
    cornerVerts = view.cornerVerts;
  const cornerCount = starts[nf]!;
  let capacity = nv;
  for (let i = 0; i < nf; i++) capacity += (starts[i + 1]! - starts[i]! - 2) * 3;
  const next = new Uint32Array(cornerCount);
  const smooth = new Uint8Array(cornerCount),
    used = new Uint8Array(nv);
  const parents = new Uint32Array(cornerCount);
  let mixed = false;
  for (let i = 0; i < nf; i++)
    if (view.smooth(i)) {
      mixed = true;
      break;
    }
  const edgeKey = (a: number, b: number): number | string =>
    nv < 94906265 ? Math.min(a, b) * nv + Math.max(a, b) : `${Math.min(a, b)}:${Math.max(a, b)}`;
  const edges = new Map<number | string, number>();
  const sharp = new Set<number | string>();
  for (const [a, b] of view.sharp) sharp.add(edgeKey(a, b));
  if (view.edges)
    for (const [a, b] of view.edges) {
      if (a === b) throw new Error('Runtime mesh edge needs distinct vertices');
      edges.set(edgeKey(a, b), -1);
    }
  const find = (value: number): number => {
    while (parents[value] !== value) {
      parents[value] = parents[parents[value]!]!;
      value = parents[value]!;
    }
    return value;
  };
  const union = (a: number, b: number) => {
    const x = find(a),
      y = find(b);
    parents[Math.max(x, y)] = Math.min(x, y);
  };
  for (let i = 0; i < nf; i++) {
    const start = starts[i]!,
      length = starts[i + 1]! - start;
    const s = view.smooth(i) ? 1 : 0;
    for (let j = 0; j < length; j++) {
      const c = start + j;
      used[cornerVerts[c]!] = 1;
      next[c] = start + ((j + 1) % length);
      smooth[c] = s;
      parents[c] = c;
    }
  }
  for (let c = 0; c < cornerCount; c++) {
    const end = next[c]!,
      a = cornerVerts[c]!,
      b = cornerVerts[end]!;
    const key = edgeKey(a, b),
      previous = edges.get(key);
    if (
      previous !== undefined &&
      previous >= 0 &&
      smooth[c] &&
      smooth[previous] &&
      !sharp.has(key)
    ) {
      const otherEnd = next[previous]!;
      union(c, cornerVerts[previous] === a ? previous : otherEnd);
      union(end, cornerVerts[previous] === a ? otherEnd : previous);
    }
    if (previous === undefined || previous < 0 || (!smooth[previous] && smooth[c]))
      edges.set(key, c);
  }
  const uv = view.uv;
  const positions = new Float32Array(capacity * 3),
    texcoords = new Float32Array(capacity * 2);
  const sourceVertex = new Uint32Array(capacity);
  const indices = new Uint32Array(capacity),
    shared = new Map<string, number>();
  const groups: DrawArrays['groups'] = [];
  const normals = view.normals ? new Float32Array(capacity * 3) : null;
  let count = 0,
    indexCount = 0;
  const emit = (v: number, texture?: [number, number], normal?: Normal): number => {
    const index = count++;
    sourceVertex[index] = v;
    view.co(v).toArray(positions, index * 3);
    if (texture) texcoords.set(texture, index * 2);
    if (normal) normals!.set(normal, index * 3);
    return index;
  };
  const corner = (c: number): number => {
    const texture = uv?.(c);
    const normal = view.normals?.[c];
    if (!mixed) return emit(cornerVerts[c]!, texture, normal);
    const key = `${smooth[c] ? find(c) : c}${texture ? `:${texture[0]}:${texture[1]}` : ''}${normal ? `:n${normal.join(':')}` : ''}`;
    let index = shared.get(key);
    if (index === undefined) {
      index = emit(cornerVerts[c]!, texture, normal);
      shared.set(key, index);
    }
    return index;
  };
  for (let i = 0; i < nf; i++) {
    const start = indexCount,
      faceStart = starts[i]!,
      length = starts[i + 1]! - faceStart;
    const points: THREE.Vector3[] = [];
    for (let j = 0; j < length; j++) points.push(view.co(cornerVerts[faceStart + j]!));
    for (const triangle of triangulatePolygon(points).triangles)
      for (const c of triangle) indices[indexCount++] = corner(faceStart + c);
    const materialIndex = view.material(i),
      previous = groups.at(-1);
    if (previous?.materialIndex === materialIndex) previous.count += indexCount - start;
    else groups.push({ start, count: indexCount - start, materialIndex });
  }
  for (let i = 0; i < nv; i++) if (!used[i]) emit(i);
  return {
    positions: positions.slice(0, count * 3),
    normals: normals?.slice(0, count * 3) ?? null,
    uv: uv ? texcoords.slice(0, count * 2) : null,
    indices: indices.slice(0, indexCount),
    sourceVertex: sourceVertex.slice(0, count),
    groups,
  };
}

export function geometryFromDrawArrays(
  arrays: Omit<DrawArrays, 'hash' | 'sourceVertex'> & { sourceVertex?: Uint32Array },
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(arrays.uv ?? new Float32Array((arrays.positions.length / 3) * 2), 2),
  );
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  for (const group of arrays.groups)
    geometry.addGroup(group.start, group.count, group.materialIndex);
  if (arrays.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  else geometry.computeVertexNormals();
  // The draw's own vertex map (see `DrawArrays.sourceVertex`). Optional here
  // because a frame may arrive ALREADY DRAWN from the worker, whose buffers
  // predate this attribute; a reader that needs it says so by name rather than
  // colouring by a guessed index.
  if (arrays.sourceVertex)
    geometry.setAttribute('blenderVertex', new THREE.BufferAttribute(arrays.sourceVertex, 1));
  return geometry;
}

/** The worker's door: the mesh store's columns, drawn into buffers. */
export function drawArraysFromColumns(c: MeshColumns, hash: string): DrawArrays {
  const nv = c.co.length / 3;
  const maps = c.attributes.filter((a) => a.type === 'FLOAT2' && a.domain === 'CORNER');
  const mapName = c.renderUv ?? c.activeUv ?? maps[0]?.name;
  const map = maps.find((a) => a.name === mapName);
  if (mapName && !map) throw new Error(`Runtime UV map ${mapName} is missing`);
  const uvData = map ? (map.data as Float32Array) : null;
  const ne = c.edge.length / 2;
  const edges: [number, number][] = new Array(ne);
  for (let i = 0; i < ne; i++) edges[i] = [c.edge[i * 2]!, c.edge[i * 2 + 1]!];
  const sharp: [number, number][] = [];
  for (let i = 0; i < ne; i++) if (c.edgeSharp[i] === 1) sharp.push(edges[i]!);
  const custom = c.attributes.find((a) => a.name === 'custom_normal');
  const normalMesh = custom
    ? {
        v: Array.from(
          { length: nv },
          (_, i) => [c.co[i * 3]!, c.co[i * 3 + 1]!, c.co[i * 3 + 2]!] as Normal,
        ),
        f: Array.from({ length: c.faceStart.length - 1 }, (_, i) =>
          Array.from(c.corner.subarray(c.faceStart[i], c.faceStart[i + 1])),
        ),
        s: Array.from(c.smooth, Boolean),
        edge_order: edges,
        sharp,
        face_edges: Array.from({ length: c.faceStart.length - 1 }, (_, i) =>
          Array.from(c.cornerEdge.subarray(c.faceStart[i], c.faceStart[i + 1])),
        ),
        edge_sharp: Array.from(c.edgeSharp, Boolean),
      }
    : null;
  const customData = custom
    ? {
        type: custom.type,
        domain: custom.domain,
        data: Array.from(
          { length: custom.data.length / ATTRIBUTE_LAYOUT[custom.type].size },
          (_, i) =>
            Array.from({ length: ATTRIBUTE_LAYOUT[custom.type].size }, (_, j) =>
              Number(custom.data[i * ATTRIBUTE_LAYOUT[custom.type].size + j]),
            ),
        ),
      }
    : undefined;
  const scratch = new THREE.Vector3();
  const view: DrawView = {
    vertexCount: nv,
    normals: normalMesh ? customCornerNormals(normalMesh, customData) : null,
    co: (i) => scratch.set(c.co[i * 3]!, c.co[i * 3 + 1]!, c.co[i * 3 + 2]!).clone(),
    starts: c.faceStart,
    cornerVerts: c.corner,
    smooth: (i) => c.smooth[i] === 1,
    material: (i) => c.material[i]!,
    edges,
    sharp,
    uv: uvData ? (corner) => [uvData[corner * 2]!, uvData[corner * 2 + 1]!] : null,
  };
  if (map && ATTRIBUTE_LAYOUT.FLOAT2.size !== 2) throw new Error('FLOAT2 layout');
  return { ...drawCore(view), hash };
}

/** The boundary JSON door. */
export function drawRuntimeGeometry(data: MeshData): THREE.BufferGeometry {
  const vertices = data.v.map((co) => new THREE.Vector3(...co));
  const vertex = (index: number) => {
    const value = vertices[index];
    if (!value) throw new Error(`Runtime mesh vertex ${index} is missing`);
    return value;
  };
  const starts = new Uint32Array(data.f.length + 1);
  data.f.forEach((face, i) => {
    if (face.length < 3 || new Set(face).size !== face.length)
      throw new Error('Runtime mesh face needs at least three distinct vertices');
    starts[i + 1] = starts[i]! + face.length;
  });
  const cornerVerts = new Uint32Array(starts[data.f.length]!);
  data.f.forEach((face, i) =>
    face.forEach((v, j) => {
      vertex(v);
      cornerVerts[starts[i]! + j] = v;
    }),
  );
  for (const [a, b] of data.edge_order ?? data.e ?? []) {
    vertex(a);
    vertex(b);
  }
  const counts: Record<string, number> = {
    POINT: vertices.length,
    EDGE: (data.edge_order ?? data.e ?? []).length,
    FACE: data.f.length,
    CORNER: cornerVerts.length,
  };
  for (const attribute of data.attributes ?? [])
    if (attribute.domain !== 'EDGE' && attribute.data.length !== counts[attribute.domain])
      throw new Error(
        `Runtime attribute ${attribute.name} has ${attribute.data.length} values for ${counts[attribute.domain]} ${attribute.domain} elements`,
      );
  const maps = (data.attributes ?? []).filter((a) => a.type === 'FLOAT2' && a.domain === 'CORNER');
  const mapName = data.render_uv ?? data.active_uv ?? maps[0]?.name;
  const map = maps.find((a) => a.name === mapName);
  if (mapName && !map) throw new Error(`Runtime UV map ${mapName} is missing`);
  const uv = map?.data as [number, number][] | undefined;
  const view: DrawView = {
    vertexCount: vertices.length,
    normals: customCornerNormals(
      data,
      data.attributes?.find((a) => a.name === 'custom_normal'),
    ),
    co: vertex,
    starts,
    cornerVerts,
    smooth: (i) => Boolean(data.s?.[i]),
    material: (i) => data.m?.[i] ?? 0,
    edges: data.edge_order ?? data.e ?? null,
    sharp: data.sharp ?? [],
    uv: uv ? (corner) => uv[corner]! : null,
  };
  return geometryFromDrawArrays(drawCore(view));
}
