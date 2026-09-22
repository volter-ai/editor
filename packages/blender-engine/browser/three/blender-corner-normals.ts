/* SPDX-License-Identifier: GPL-2.0-or-later */
/** Blender mesh_normals.cc (fbe6228777e7): smooth fans and custom-normal
 * reference spaces. Shared by modifier evaluation, viewport drawing and GLB.
 * Custom normals retain Blender's INT16_2D representation in mesh attributes.
 */

export type Normal = [number, number, number];

/** `normalize_v3` (`blenlib/intern/math_vector.cc`), returning the length it
 *  divided by; a zero-length vector stays zero. Inlined from the kit's
 *  `face-interpolation.ts` when this file became `@volter/editor-blender`'s — it is the
 *  one function of that module this drawing path used. Float width is part of
 *  the answer: native computes it in `float`, so every step is `Math.fround`. */
function normalize3(n: Normal): { unit: Normal; length: number } {
  const w = Math.fround;
  const d = w(w(w(n[0] * n[0]) + w(n[1] * n[1])) + w(n[2] * n[2]));
  if (d > 1.0e-35) {
    const length = w(Math.sqrt(d));
    const mul = w(1 / length);
    return { unit: [w(n[0] * mul), w(n[1] * mul), w(n[2] * mul)], length };
  }
  return { unit: [0, 0, 0], length: 0 };
}
export interface NormalMesh {
  v: Normal[];
  f: number[][];
  s?: boolean[] | undefined;
  edge_order?: [number, number][] | undefined;
  face_edges?: number[][] | undefined;
  sharp?: [number, number][] | undefined;
  edge_sharp?: boolean[] | undefined;
}
const f = Math.fround;
const tau = f(2 * Math.PI),
  threshold = f(1 - 1e-4);
export const dotNormal = (a: Normal, b: Normal): number =>
  f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
export const addNormal = (a: Normal, b: Normal, weight = 1): Normal =>
  a.map((x, i) => f(x + f(b[i]! * weight))) as Normal;
const sub = (a: Normal, b: Normal): Normal => a.map((x, i) => f(x - b[i]!)) as Normal;
export function unitNormal(a: Normal): Normal {
  const length = f(Math.sqrt(dotNormal(a, a)));
  return length > 0 ? (a.map((x) => f(x / length)) as Normal) : [0, 0, 0];
}
export function normalAngle(x: number): number {
  const m = Math.abs(x) < 1 ? f(1 - f(1 - Math.abs(x))) : 1;
  let p = f(f(0.077980478) + f(m * f(-0.02164095)));
  p = f(f(-0.213300989) + f(m * p));
  p = f(f(1.5707963267) + f(m * p));
  const angle = f(f(Math.sqrt(f(1 - m))) * p);
  return x < 0 ? f(f(Math.PI) - angle) : angle;
}
export function faceVector(points: Normal[]): Normal {
  let last = points.at(-1)!;
  const result: Normal = [0, 0, 0];
  for (const point of points) {
    for (let i = 0; i < 3; i++) {
      const a = (i + 1) % 3,
        b = (i + 2) % 3;
      result[i] = f(result[i]! + f(f(last[a]! - point[a]!) * f(last[b]! + point[b]!)));
    }
    last = point;
  }
  return result;
}
export interface NormalCorner {
  vertex: number;
  face: number;
  prev: number;
  next: number;
  edge: number;
}
export interface NormalSpace {
  normal: Normal;
  reference: Normal;
  ortho: Normal;
  alpha: number;
  beta: number;
}
export interface NormalFans {
  corners: NormalCorner[];
  fans: number[][];
  fanOf: number[];
  spaces: NormalSpace[];
  faceNormals: Normal[];
  /** The fan's own auto normal, per fan — `normals_calc_corners`' answer, which
   *  is NOT `spaces[i].normal`: a space too aligned with its normal to be
   *  usable carries a zero `vec_lnor` while the fan's normal stands. This is
   *  what `Mesh::corner_normals` returns once a `custom_normal` layer exists. */
  fanNormals: Normal[];
}

export function normalFans(mesh: NormalMesh): NormalFans {
  const corners: NormalCorner[] = [],
    faceNormals: Normal[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const edges = new Map((mesh.edge_order ?? []).map(([a, b], i) => [key(a, b), i]));
  const sharpPairs = new Set((mesh.sharp ?? []).map(([a, b]) => key(a, b)));
  const uses = new Map<number, number[]>();
  for (const [face, vertices] of mesh.f.entries()) {
    const start = corners.length;
    const normal = normalize3(faceVector(vertices.map((v) => mesh.v[v]!))).unit as Normal;
    faceNormals.push(normal.some(Boolean) ? normal : [0, 0, 1]);
    for (let j = 0; j < vertices.length; j++) {
      const pair = key(vertices[j]!, vertices[(j + 1) % vertices.length]!);
      if (!edges.has(pair)) edges.set(pair, edges.size);
      const edge = mesh.face_edges?.[face]?.[j] ?? edges.get(pair)!;
      const c = corners.length;
      corners.push({
        vertex: vertices[j]!,
        face,
        edge,
        prev: start + ((j + vertices.length - 1) % vertices.length),
        next: start + ((j + 1) % vertices.length),
      });
      const rows = uses.get(edge) ?? [];
      rows.push(c);
      uses.set(edge, rows);
    }
  }
  const nextFan = new Map<number, number>(),
    prevFan = new Map<number, number>();
  for (const [edge, rows] of uses) {
    if (rows.length !== 2 || mesh.edge_sharp?.[edge]) continue;
    const [a, b] = rows as [number, number],
      ca = corners[a]!,
      cb = corners[b]!;
    if (!mesh.s?.[ca.face] || !mesh.s?.[cb.face]) continue;
    if (ca.vertex !== corners[cb.next]!.vertex || cb.vertex !== corners[ca.next]!.vertex) continue;
    if (!mesh.edge_sharp && sharpPairs.has(key(ca.vertex, cb.vertex))) continue;
    prevFan.set(a, cb.next);
    nextFan.set(cb.next, a);
    prevFan.set(b, ca.next);
    nextFan.set(ca.next, b);
  }
  const fans: number[][] = [],
    fanOf: number[] = [],
    spaces: NormalSpace[] = [],
    fanNormals: Normal[] = [];
  const direction = (c: number, which: 'prev' | 'next') =>
    unitNormal(sub(mesh.v[corners[corners[c]![which]]!.vertex]!, mesh.v[corners[c]!.vertex]!));
  for (let c = 0; c < corners.length; c++) {
    if (fanOf[c] !== undefined) continue;
    let start = c;
    const visited = new Set([start]);
    while (prevFan.has(start) && !visited.has(prevFan.get(start)!)) {
      start = prevFan.get(start)!;
      visited.add(start);
    }
    if (prevFan.has(start)) start = Math.min(...visited);
    const fan = [start];
    while (nextFan.has(fan.at(-1)!) && nextFan.get(fan.at(-1)!) !== start)
      fan.push(nextFan.get(fan.at(-1)!)!);
    let normal: Normal = [0, 0, 0];
    if (fan.length === 1) normal = faceNormals[corners[start]!.face]!;
    else {
      for (const row of fan)
        normal = addNormal(
          normal,
          faceNormals[corners[row]!.face]!,
          normalAngle(dotNormal(direction(row, 'prev'), direction(row, 'next'))),
        );
      normal = unitNormal(normal);
    }
    const reference = direction(start, 'next'),
      last = fan.at(-1)!;
    const other = direction(last, 'prev');
    const dtpRef = dotNormal(reference, normal),
      dtpOther = dotNormal(other, normal);
    const space: NormalSpace = {
      normal,
      reference: [0, 0, 0],
      ortho: [0, 0, 0],
      alpha: 0,
      beta: 0,
    };
    if (Math.abs(dtpRef) < threshold && Math.abs(dtpOther) < threshold) {
      const vectors = fan.length > 1 ? fan.map((row) => direction(row, 'next')) : [];
      if (vectors.length && corners[corners[last]!.prev]!.edge !== corners[start]!.edge)
        vectors.push(other);
      space.alpha = vectors.length
        ? f(
            vectors.reduce((sum, v) => f(sum + normalAngle(dotNormal(v, normal))), 0) /
              vectors.length,
          )
        : f(f(normalAngle(dtpRef) + normalAngle(dtpOther)) / 2);
      space.reference = unitNormal(addNormal(reference, normal, -dtpRef));
      const a = normal,
        b = space.reference;
      space.ortho = unitNormal([
        f(f(a[1] * b[2]) - f(a[2] * b[1])),
        f(f(a[2] * b[0]) - f(a[0] * b[2])),
        f(f(a[0] * b[1]) - f(a[1] * b[0])),
      ]);
      const projected = unitNormal(addNormal(other, normal, -dtpOther));
      const cosine = dotNormal(space.reference, projected);
      const beta = normalAngle(cosine);
      space.beta =
        cosine < threshold ? (dotNormal(space.ortho, projected) < 0 ? f(tau - beta) : beta) : tau;
    }
    if (space.alpha === 0) space.normal = [0, 0, 0];
    for (const row of fan) fanOf[row] = fans.length;
    fans.push(fan);
    spaces.push(space);
    fanNormals.push(normal);
  }
  return { corners, fans, fanOf, spaces, faceNormals, fanNormals };
}

export function encodeNormal(space: NormalSpace, normal: Normal): [number, number] {
  if (
    !normal.some(Boolean) ||
    normal.every((x, i) => Math.abs(x - space.normal[i]!) <= 1e-4) ||
    space.alpha === 0
  )
    return [0, 0];
  const short = (x: number) => Math.floor(f(f(x * 32767) + 0.5));
  const anglePair = (angle: number, reference: number) =>
    reference === 0
      ? 0
      : short(angle > reference ? f(-f(tau - angle) / f(tau - reference)) : f(angle / reference));
  const cosAlpha = dotNormal(space.normal, normal);
  const alpha = normalAngle(cosAlpha);
  const vector = unitNormal(addNormal(normal, space.normal, -cosAlpha));
  const cosBeta = dotNormal(space.reference, vector);
  let beta = cosBeta < threshold ? normalAngle(cosBeta) : 0;
  if (cosBeta < threshold && dotNormal(space.ortho, vector) < 0) beta = f(tau - beta);
  return [anglePair(alpha, space.alpha), anglePair(beta, space.beta)];
}

export function decodeNormal(space: NormalSpace, pair: number[]): Normal {
  if (!pair[0] || space.alpha === 0 || space.beta === 0) return space.normal;
  const af = f(pair[0] / 32767),
    bf = f(pair[1]! / 32767);
  const alpha = f((af > 0 ? space.alpha : f(tau - space.alpha)) * af);
  const beta = f((bf > 0 ? space.beta : f(tau - space.beta)) * bf);
  let result = space.normal.map((x) => f(x * f(Math.cos(alpha)))) as Normal;
  result = addNormal(result, space.reference, f(f(Math.sin(alpha)) * f(Math.cos(beta))));
  if (bf !== 0) result = addNormal(result, space.ortho, f(f(Math.sin(alpha)) * f(Math.sin(beta))));
  return result;
}

export interface CustomNormalsMesh extends NormalMesh {
  /** Every face's corner edges; the sharp-edge marking names edges, not pairs. */
  face_edges: number[][];
  /** The `sharp_edge` column this starts from and returns, one per edge. */
  edge_sharp: boolean[];
  /** `bpy._mesh_normals.vertex_normals`. Read only by the VERTEX door's zero
   *  substitution, which stands a zero input on the vertex's own normal. */
  vertexNormals?: ArrayLike<number> | undefined;
}

/** The two columns the setter writes: the `custom_normal` INT16_2D pair per
 *  corner, and the `sharp_edge` BOOLEAN flag per edge. */
export interface CustomNormals {
  customNormal: Int16Array;
  sharpEdge: Uint8Array;
}

/**
 * `mesh_normals_corner_custom_set` (mesh_normals.cc:1409-1596), the pipeline
 * behind `Mesh.normals_split_custom_set(_from_vertices)`. `normals` is three
 * float32 per corner, or per VERTEX when `useVertices`; both are already
 * clamped and normalized by the RNA layer.
 *
 * The steps, in native's order:
 *   1. `normals_calc_corners` — the fans and their auto normals (`normalFans`);
 *   2. ZERO SUBSTITUTION (:1443-1456): a zero input becomes the auto corner
 *      normal, or in the vertex door the vertex normal;
 *   3. SHARP-EDGE SPLITTING (:1466-1543), corner door only: within a fan, a
 *      corner whose normal differs from the fan's running reference by
 *      `dot < LNOR_SPACE_TRIGO_THRESHOLD` marks an edge sharp. Never un-sharps;
 *   4. a SECOND `normals_calc_corners` (:1544-1555), so the spaces match what
 *      was asked for;
 *   5. FAN AVERAGING (:1583-1596): a fan of two or more corners is summed,
 *      divided by the corner count, encoded ONCE, and that one pair fills every
 *      corner of the fan. Only a fan below two is encoded per corner.
 */
export function setCustomNormals(
  mesh: CustomNormalsMesh,
  normals: Float32Array,
  useVertices: boolean,
): CustomNormals {
  const sharp = mesh.edge_sharp.slice();
  let basis = normalFans({ ...mesh, edge_sharp: sharp });
  const total = basis.corners.length;
  const custom: Normal[] = Array.from({ length: normals.length / 3 }, (_, i) => [
    normals[i * 3]!,
    normals[i * 3 + 1]!,
    normals[i * 3 + 2]!,
  ]);
  // 2. zero substitution, before anything else looks at the vectors.
  if (useVertices) {
    const vertex = mesh.vertexNormals;
    if (!vertex) throw new Error('setCustomNormals: the vertex door needs vertexNormals');
    for (const [i, value] of custom.entries())
      if (!value.some(Boolean))
        custom[i] = [vertex[i * 3]!, vertex[i * 3 + 1]!, vertex[i * 3 + 2]!];
  } else {
    for (const [i, value] of custom.entries())
      if (!value.some(Boolean)) custom[i] = basis.fanNormals[basis.fanOf[i]!]!;
  }
  const at = (corner: number): Normal =>
    custom[useVertices ? basis.corners[corner]!.vertex : corner]!;
  // 3 + 4. splitting, then rebuild. The vertex door skips this entirely
  // (`done_corners.fill(true)`, :1461).
  if (!useVertices) {
    // `sharp_edges[prev_edge == edge_prev ? prev_edge : edge] = true` (:1510-1517).
    const markSharp = (corner: number, previous: number): void => {
      const edge = basis.corners[corner]!.edge;
      const edgePrev = basis.corners[basis.corners[corner]!.prev]!.edge;
      const prevEdge = previous >= 0 ? basis.corners[previous]!.edge : -1;
      sharp[prevEdge === edgePrev ? prevEdge : edge] = true;
    };
    let marked = false;
    const seen = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (seen[i]) continue;
      const fan = basis.fans[basis.fanOf[i]!]!;
      for (const corner of fan) seen[corner] = 1;
      if (fan.length < 2) continue;
      let org: Normal | null = null,
        previous = -1;
      for (let k = fan.length - 1; k >= 0; k--) {
        const corner = fan[k]!,
          normal = at(corner);
        if (org === null) org = normal;
        else if (dotNormal(org, normal) < threshold) {
          markSharp(corner, previous);
          marked = true;
          org = normal;
        }
        previous = corner;
      }
      const corner = fan.at(-1)!;
      if (org !== null && dotNormal(org, at(corner)) < threshold) {
        markSharp(corner, previous);
        marked = true;
      }
    }
    if (marked) basis = normalFans({ ...mesh, edge_sharp: sharp });
  }
  // 5. encode, averaging over each surviving fan.
  const customNormal = new Int16Array(total * 2);
  const done = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (done[i]) continue;
    const index = basis.fanOf[i]!,
      fan = basis.fans[index]!,
      space = basis.spaces[index]!;
    if (fan.length < 2) {
      const pair = encodeNormal(space, at(i));
      customNormal[i * 2] = pair[0];
      customNormal[i * 2 + 1] = pair[1];
      done[i] = 1;
      continue;
    }
    let sum: Normal = [0, 0, 0];
    for (const corner of fan) sum = addNormal(sum, at(corner));
    const pair = encodeNormal(space, sum.map((x) => f(x / fan.length)) as Normal);
    for (const corner of fan) {
      customNormal[corner * 2] = pair[0];
      customNormal[corner * 2 + 1] = pair[1];
      done[corner] = 1;
    }
  }
  return { customNormal, sharpEdge: Uint8Array.from(sharp, (x) => (x ? 1 : 0)) };
}

/**
 * `Mesh::corner_normals`: one normal per corner, whatever the mesh carries.
 *
 * The decoded custom normals where a `custom_normal` layer exists, and the
 * smooth fans' own auto normals where it does not — the split-normal answer,
 * with sharp edges and flat faces already respected because they are what
 * `normalFans` splits the fans on. ONE function so a reader of corner normals
 * never has to know which of the two it is looking at; both halves are the
 * same fans, computed once.
 */
export function cornerNormals(
  mesh: NormalMesh,
  attribute?: Parameters<typeof customCornerNormals>[1],
): Normal[] {
  const custom = customCornerNormals(mesh, attribute);
  if (custom) return custom;
  const { corners, fanOf, fanNormals } = normalFans(mesh);
  return corners.map((_, c) => fanNormals[fanOf[c]!]!);
}

/** Read custom attributes at the geometry boundary, preserving corner splits. */
export function customCornerNormals(
  mesh: NormalMesh,
  attribute:
    | {
        type: string;
        domain: string;
        data: unknown[];
      }
    | undefined,
): Normal[] | null {
  if (!attribute) return null;
  const { corners, fans, spaces } = normalFans(mesh);
  if (attribute.type === 'INT16_2D' && attribute.domain === 'CORNER') {
    const result: Normal[] = new Array(corners.length);
    for (const [i, fan] of fans.entries()) {
      const sum = fan.reduce(
        (total, c) => {
          const pair = attribute.data[c] as number[];
          return [total[0]! + pair[0]!, total[1]! + pair[1]!];
        },
        [0, 0],
      );
      const normal = decodeNormal(
        spaces[i]!,
        sum.map((x) => Math.trunc(x / fan.length)),
      );
      for (const c of fan) result[c] = normal;
    }
    return result;
  }
  if (attribute.type === 'FLOAT_VECTOR')
    return corners.map((corner, c) => {
      const row =
        attribute.domain === 'POINT'
          ? corner.vertex
          : attribute.domain === 'FACE'
            ? corner.face
            : c;
      return attribute.data[row] as Normal;
    });
  throw new Error(`Unsupported custom_normal attribute: ${attribute.type}/${attribute.domain}`);
}
