import { BufferAttribute, BufferGeometry, Color, Vector2, Vector3, Vector4 } from 'three';
import { registerGodotObjectIdentity } from './object';

export interface GodotMeshDataFace {
  vertices: [number, number, number];
  edges: [number, number, number];
  material: unknown | null;
  metadata: unknown;
}

export interface GodotMeshDataEdge {
  vertices: [number, number];
  faces: number[];
  metadata: unknown;
}

interface MeshDataState {
  vertices: Vector3[];
  normals: Array<Vector3 | null>;
  tangents: Array<Vector4 | null>;
  uv: Array<Vector2 | null>;
  uv2: Array<Vector2 | null>;
  colors: Array<Color | null>;
  bones: number[][];
  weights: number[][];
  vertexMetadata: unknown[];
  faces: GodotMeshDataFace[];
  edges: GodotMeshDataEdge[];
  format: number;
  material: unknown | null;
}

function emptyState(): MeshDataState {
  return { vertices: [], normals: [], tangents: [], uv: [], uv2: [], colors: [], bones: [], weights: [], vertexMetadata: [], faces: [], edges: [], format: 0, material: null };
}

function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RangeError(`godot-compat: MeshDataTool.${member} requires integer in [${minimum}, ${maximum}].`);
  return value as number;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires finite number.`);
  return value;
}

function vector2(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires Vector2.`);
  return new Vector2(finite(value.x, `${member}.x`), finite(value.y, `${member}.y`));
}

function vector3(value: unknown, member: string): Vector3 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires Vector3.`);
  return new Vector3(finite(value.x, `${member}.x`), finite(value.y, `${member}.y`), finite(value.z, `${member}.z`));
}

function vector4(value: unknown, member: string): Vector4 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value) || !('w' in value)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires Plane.`);
  return new Vector4(finite(value.x, `${member}.x`), finite(value.y, `${member}.y`), finite(value.z, `${member}.z`), finite(value.w, `${member}.w`));
}

function color(value: unknown, member: string): Color {
  if (value instanceof Color) return value.clone();
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires Color.`);
  return new Color(finite(value.r, `${member}.r`), finite(value.g, `${member}.g`), finite(value.b, `${member}.b`));
}

function geometry(value: unknown, member: string): BufferGeometry {
  if (!(value instanceof BufferGeometry)) throw new TypeError(`godot-compat: MeshDataTool.${member} requires native BufferGeometry mesh.`);
  return value;
}

function attributeVector2(attribute: BufferAttribute | undefined, index: number): Vector2 | null { return attribute === undefined ? null : new Vector2(attribute.getX(index), attribute.getY(index)); }
function attributeVector3(attribute: BufferAttribute | undefined, index: number): Vector3 | null { return attribute === undefined ? null : new Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index)); }
function attributeVector4(attribute: BufferAttribute | undefined, index: number): Vector4 | null { return attribute === undefined ? null : new Vector4(attribute.getX(index), attribute.getY(index), attribute.getZ(index), attribute.getW(index)); }

function buildTopology(state: MeshDataState, indices: number[]): void {
  state.faces = [];
  state.edges = [];
  const edgeByKey = new Map<string, number>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices: [number, number, number] = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!];
    const faceIndex = state.faces.length;
    const edgeIndices = vertices.map((vertex, corner) => {
      const next = vertices[(corner + 1) % 3]!, low = Math.min(vertex, next), high = Math.max(vertex, next), key = `${low}:${high}`;
      let edgeIndex = edgeByKey.get(key);
      if (edgeIndex === undefined) { edgeIndex = state.edges.length; edgeByKey.set(key, edgeIndex); state.edges.push({ vertices: [low, high], faces: [], metadata: null }); }
      state.edges[edgeIndex]!.faces.push(faceIndex); return edgeIndex;
    }) as [number, number, number];
    state.faces.push({ vertices, edges: edgeIndices, material: state.material, metadata: null });
  }
}

function componentArray(values: Array<Vector2 | Vector3 | Vector4 | Color | null>, itemSize: number): Float32Array | null {
  if (values.every((value) => value === null)) return null;
  const data = new Float32Array(values.length * itemSize);
  values.forEach((value, index) => {
    if (value === null) return;
    if (value instanceof Color) {
      data[index * itemSize] = value.r;
      data[index * itemSize + 1] = value.g;
      data[index * itemSize + 2] = value.b;
      return;
    }
    data[index * itemSize] = value.x;
    data[index * itemSize + 1] = value.y;
    if (value instanceof Vector3 || value instanceof Vector4) data[index * itemSize + 2] = value.z;
    if (value instanceof Vector4) data[index * itemSize + 3] = value.w;
  });
  return data;
}

function pairValue(values: readonly [number, number], index: number): number {
  return index === 0 ? values[0] : values[1];
}

function tripleValue(values: readonly [number, number, number], index: number): number {
  if (index === 0) return values[0];
  return index === 1 ? values[1] : values[2];
}

export class GodotMeshDataTool {
  public readonly __godotClass = 'MeshDataTool';
  private state: MeshDataState = emptyState();

  public constructor() { registerGodotObjectIdentity(this, 'MeshDataTool'); }
  private vertex(index: unknown, member: string): number { return integer(index, member, 0, this.state.vertices.length - 1); }
  private face(index: unknown, member: string): number { return integer(index, member, 0, this.state.faces.length - 1); }
  private edge(index: unknown, member: string): number { return integer(index, member, 0, this.state.edges.length - 1); }

  public clear(): void { this.state = emptyState(); }
  public createFromSurface(meshValue: unknown, surface: unknown): number {
    const mesh = geometry(meshValue, 'create_from_surface'), surfaceIndex = integer(surface, 'create_from_surface.surface');
    const position = mesh.getAttribute('position') as BufferAttribute | undefined;
    if (position === undefined) return 1;
    const group = mesh.groups[surfaceIndex];
    if (mesh.groups.length > 0 && group === undefined) return 1;
    const indexAttribute = mesh.getIndex();
    const allIndices = indexAttribute === null ? Array.from({ length: position.count }, (_, index) => index) : Array.from({ length: indexAttribute.count }, (_, index) => indexAttribute.getX(index));
    const selected = group === undefined ? allIndices : allIndices.slice(group.start, group.start + group.count);
    if (selected.length % 3 !== 0) return 1;
    const normal = mesh.getAttribute('normal') as BufferAttribute | undefined, tangent = mesh.getAttribute('tangent') as BufferAttribute | undefined;
    const uv = mesh.getAttribute('uv') as BufferAttribute | undefined, uv2 = mesh.getAttribute('uv1') as BufferAttribute | undefined;
    const colorAttribute = mesh.getAttribute('color') as BufferAttribute | undefined, skinIndex = mesh.getAttribute('skinIndex') as BufferAttribute | undefined, skinWeight = mesh.getAttribute('skinWeight') as BufferAttribute | undefined;
    const next = emptyState(); next.material = mesh.userData['godotSurfaceMaterials']?.[surfaceIndex] ?? null;
    for (let index = 0; index < position.count; index += 1) {
      next.vertices.push(new Vector3(position.getX(index), position.getY(index), position.getZ(index)));
      next.normals.push(attributeVector3(normal, index)); next.tangents.push(attributeVector4(tangent, index));
      next.uv.push(attributeVector2(uv, index)); next.uv2.push(attributeVector2(uv2, index));
      next.colors.push(colorAttribute === undefined ? null : new Color(colorAttribute.getX(index), colorAttribute.getY(index), colorAttribute.getZ(index)));
      next.bones.push(skinIndex === undefined ? [] : Array.from({ length: skinIndex.itemSize }, (_, component) => skinIndex.getComponent(index, component)));
      next.weights.push(skinWeight === undefined ? [] : Array.from({ length: skinWeight.itemSize }, (_, component) => skinWeight.getComponent(index, component)));
      next.vertexMetadata.push(null);
    }
    next.format = (normal ? 2 : 0) | (tangent ? 4 : 0) | (colorAttribute ? 8 : 0) | (uv ? 16 : 0) | (uv2 ? 32 : 0) | (skinIndex ? 64 : 0) | (skinWeight ? 128 : 0);
    buildTopology(next, selected); this.state = next; return 0;
  }

  public commitToSurface(meshValue: unknown, compressionFlags = 0): number {
    integer(compressionFlags, 'commit_to_surface.compression_flags', 0, 0xffff_ffff);
    const target = geometry(meshValue, 'commit_to_surface'), built = this.toGeometry();
    target.copy(built); built.dispose(); target.userData['godotSurfaceMaterials'] = [this.state.material]; return 0;
  }

  public toGeometry(): BufferGeometry {
    const output = new BufferGeometry();
    output.setAttribute('position', new BufferAttribute(new Float32Array(this.state.vertices.flatMap((value) => [value.x, value.y, value.z])), 3));
    const attributes: Array<[string, Float32Array | null, number]> = [
      ['normal', componentArray(this.state.normals, 3), 3], ['tangent', componentArray(this.state.tangents, 4), 4],
      ['uv', componentArray(this.state.uv, 2), 2], ['uv1', componentArray(this.state.uv2, 2), 2], ['color', componentArray(this.state.colors, 3), 3],
    ];
    for (const [name, data, itemSize] of attributes) if (data !== null) output.setAttribute(name, new BufferAttribute(data, itemSize));
    if (this.state.bones.some((value) => value.length > 0)) output.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.state.bones.flatMap((value) => value.slice(0, 4).concat(Array(Math.max(0, 4 - value.length)).fill(0)))), 4));
    if (this.state.weights.some((value) => value.length > 0)) output.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.state.weights.flatMap((value) => value.slice(0, 4).concat(Array(Math.max(0, 4 - value.length)).fill(0)))), 4));
    output.setIndex(new BufferAttribute(new Uint32Array(this.state.faces.flatMap((face) => face.vertices)), 1)); output.computeBoundingBox(); output.computeBoundingSphere(); return output;
  }

  public getFormat(): number { return this.state.format; }
  public getVertexCount(): number { return this.state.vertices.length; }
  public getEdgeCount(): number { return this.state.edges.length; }
  public getFaceCount(): number { return this.state.faces.length; }
  public setVertex(index: unknown, value: unknown): void { this.state.vertices[this.vertex(index, 'set_vertex')] = vector3(value, 'set_vertex.value'); }
  public getVertex(index: unknown): Vector3 { return this.state.vertices[this.vertex(index, 'get_vertex')]!.clone(); }
  public setVertexNormal(index: unknown, value: unknown): void { this.state.normals[this.vertex(index, 'set_vertex_normal')] = vector3(value, 'set_vertex_normal.value'); }
  public getVertexNormal(index: unknown): Vector3 { return this.state.normals[this.vertex(index, 'get_vertex_normal')]?.clone() ?? new Vector3(); }
  public setVertexTangent(index: unknown, value: unknown): void { this.state.tangents[this.vertex(index, 'set_vertex_tangent')] = vector4(value, 'set_vertex_tangent.value'); }
  public getVertexTangent(index: unknown): Vector4 { return this.state.tangents[this.vertex(index, 'get_vertex_tangent')]?.clone() ?? new Vector4(); }
  public setVertexUv(index: unknown, value: unknown): void { this.state.uv[this.vertex(index, 'set_vertex_uv')] = vector2(value, 'set_vertex_uv.value'); }
  public getVertexUv(index: unknown): Vector2 { return this.state.uv[this.vertex(index, 'get_vertex_uv')]?.clone() ?? new Vector2(); }
  public setVertexUv2(index: unknown, value: unknown): void { this.state.uv2[this.vertex(index, 'set_vertex_uv2')] = vector2(value, 'set_vertex_uv2.value'); }
  public getVertexUv2(index: unknown): Vector2 { return this.state.uv2[this.vertex(index, 'get_vertex_uv2')]?.clone() ?? new Vector2(); }
  public setVertexColor(index: unknown, value: unknown): void { this.state.colors[this.vertex(index, 'set_vertex_color')] = color(value, 'set_vertex_color.value'); }
  public getVertexColor(index: unknown): Color { return this.state.colors[this.vertex(index, 'get_vertex_color')]?.clone() ?? new Color(1, 1, 1); }
  public setVertexBones(index: unknown, value: unknown): void { if (!Array.isArray(value)) throw new TypeError('godot-compat: MeshDataTool.set_vertex_bones requires PackedInt32Array.'); this.state.bones[this.vertex(index, 'set_vertex_bones')] = value.map((one) => integer(one, 'set_vertex_bones.value')); }
  public getVertexBones(index: unknown): number[] { return [...this.state.bones[this.vertex(index, 'get_vertex_bones')]!]; }
  public setVertexWeights(index: unknown, value: unknown): void { if (!Array.isArray(value)) throw new TypeError('godot-compat: MeshDataTool.set_vertex_weights requires PackedFloat32Array.'); this.state.weights[this.vertex(index, 'set_vertex_weights')] = value.map((one) => finite(one, 'set_vertex_weights.value')); }
  public getVertexWeights(index: unknown): number[] { return [...this.state.weights[this.vertex(index, 'get_vertex_weights')]!]; }
  public setVertexMeta(index: unknown, value: unknown): void { this.state.vertexMetadata[this.vertex(index, 'set_vertex_meta')] = value; }
  public getVertexMeta(index: unknown): unknown { return this.state.vertexMetadata[this.vertex(index, 'get_vertex_meta')]; }
  public getVertexEdges(index: unknown): number[] { const vertex = this.vertex(index, 'get_vertex_edges'); return this.state.edges.flatMap((edge, edgeIndex) => edge.vertices.includes(vertex) ? [edgeIndex] : []); }
  public getVertexFaces(index: unknown): number[] { const vertex = this.vertex(index, 'get_vertex_faces'); return this.state.faces.flatMap((face, faceIndex) => face.vertices.includes(vertex) ? [faceIndex] : []); }
  public getEdgeVertex(edge: unknown, vertex: unknown): number { return pairValue(this.state.edges[this.edge(edge, 'get_edge_vertex')]!.vertices, integer(vertex, 'get_edge_vertex.vertex', 0, 1)); }
  public getEdgeFaces(edge: unknown): number[] { return [...this.state.edges[this.edge(edge, 'get_edge_faces')]!.faces]; }
  public setEdgeMeta(edge: unknown, value: unknown): void { this.state.edges[this.edge(edge, 'set_edge_meta')]!.metadata = value; }
  public getEdgeMeta(edge: unknown): unknown { return this.state.edges[this.edge(edge, 'get_edge_meta')]!.metadata; }
  public getFaceVertex(face: unknown, vertex: unknown): number { return tripleValue(this.state.faces[this.face(face, 'get_face_vertex')]!.vertices, integer(vertex, 'get_face_vertex.vertex', 0, 2)); }
  public getFaceEdge(face: unknown, edge: unknown): number { return tripleValue(this.state.faces[this.face(face, 'get_face_edge')]!.edges, integer(edge, 'get_face_edge.edge', 0, 2)); }
  public getFaceNormal(face: unknown): Vector3 { const value = this.state.faces[this.face(face, 'get_face_normal')]!, a = this.state.vertices[value.vertices[0]]!, b = this.state.vertices[value.vertices[1]]!, c = this.state.vertices[value.vertices[2]]!; return new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize(); }
  public setFaceMaterial(face: unknown, value: unknown): void { this.state.faces[this.face(face, 'set_face_material')]!.material = value; }
  public getFaceMaterial(face: unknown): unknown | null { return this.state.faces[this.face(face, 'get_face_material')]!.material; }
  public setFaceMeta(face: unknown, value: unknown): void { this.state.faces[this.face(face, 'set_face_meta')]!.metadata = value; }
  public getFaceMeta(face: unknown): unknown { return this.state.faces[this.face(face, 'get_face_meta')]!.metadata; }
  public setMaterial(value: unknown): void { this.state.material = value; for (const face of this.state.faces) face.material = value; }
  public getMaterial(): unknown | null { return this.state.material; }
}

export function createGodotMeshDataTool(): GodotMeshDataTool { return new GodotMeshDataTool(); }
