/** Godot 4 navigation source geometry over retained native Three mesh data. */
import { BufferGeometry, Matrix4, Mesh, type Object3D, Vector3 } from 'three';
import {
  getCollisionShape3DShape,
  isCollisionShape3DEnabled,
  isGodotCollisionShape3DNode,
} from './collider-3d';
import {
  createGodotNavigationMesh,
  type GodotNavigationMesh,
  type NavigationMeshVector3,
} from './navigation-mesh';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { godotSceneTreeNavigationIndex } from './scene-tree';

export interface GodotNavigationMeshSourceGeometryData3D {
  readonly kind: 'NavigationMeshSourceGeometryData3D';
  vertices: readonly number[];
  indices: readonly number[];
  projectedObstructions: readonly GodotProjectedNavigationObstruction3D[];
  set_vertices(vertices: readonly number[]): void;
  get_vertices(): readonly number[];
  set_indices(indices: readonly number[]): void;
  get_indices(): readonly number[];
  append_arrays(vertices: readonly number[], indices: readonly number[]): void;
  merge(other: GodotNavigationMeshSourceGeometryData3D): void;
  clear(): void;
  has_data(): boolean;
  add_mesh(mesh: unknown, transform: unknown): void;
  add_mesh_array(meshArray: readonly unknown[], transform: unknown): void;
  add_faces(faces: readonly NavigationMeshVector3[], transform: unknown): void;
  add_projected_obstruction(
    vertices: readonly NavigationMeshVector3[],
    elevation: number,
    height: number,
    carve: boolean,
  ): void;
  clear_projected_obstructions(): void;
  set_projected_obstructions(obstructions: readonly GodotProjectedNavigationObstruction3D[]): void;
  get_projected_obstructions(): readonly GodotProjectedNavigationObstruction3D[];
  get_bounds(): { readonly position: NavigationMeshVector3; readonly size: NavigationMeshVector3 };
}

export interface GodotProjectedNavigationObstruction3D {
  readonly vertices: readonly NavigationMeshVector3[];
  readonly elevation: number;
  readonly height: number;
  readonly carve: boolean;
}

export interface GodotNavigationBakeObstacle3D {
  readonly node: Object3D;
  readonly vertices: readonly NavigationMeshVector3[];
  readonly height: number;
  readonly affectNavigationMesh: boolean;
  readonly carveNavigationMesh: boolean;
}

const BAKE_OBSTACLES = new WeakMap<Object3D, () => GodotNavigationBakeObstacle3D>();

/** Retains authored NavigationObstacle3D bake state on the native scene node. */
export function bindGodotNavigationBakeObstacle3D(
  node: Object3D,
  read: () => Omit<GodotNavigationBakeObstacle3D, 'node'>,
): () => void {
  BAKE_OBSTACLES.set(node, () => ({ node, ...read() }));
  return () => BAKE_OBSTACLES.delete(node);
}

const SOURCES = new WeakMap<
  GodotNavigationMeshSourceGeometryData3D,
  {
    vertices: number[];
    indices: number[];
    obstructions: GodotProjectedNavigationObstruction3D[];
  }
>();

function finitePoint(value: NavigationMeshVector3): NavigationMeshVector3 {
  const point = { x: Number(value?.x), y: Number(value?.y), z: Number(value?.z) };
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new TypeError(
      'NavigationMeshSourceGeometryData3D vertices require finite Vector3 values.',
    );
  }
  return point;
}

function stateOf(source: GodotNavigationMeshSourceGeometryData3D) {
  const state = SOURCES.get(source);
  if (state === undefined)
    throw new TypeError('Expected a retained NavigationMeshSourceGeometryData3D Resource.');
  return state;
}

function finiteNumbers(values: readonly number[], member: string): number[] {
  const result = values.map(Number);
  if (!result.every(Number.isFinite))
    throw new TypeError(
      `NavigationMeshSourceGeometryData3D.${member} requires finite numeric values.`,
    );
  return result;
}

function checkedIndices(values: readonly number[], vertexCount: number): number[] {
  return values.map((value) => {
    if (!Number.isSafeInteger(value) || value < 0 || value >= vertexCount) {
      throw new RangeError('Navigation source triangle index is outside its vertex array.');
    }
    return value;
  });
}

function sourcePoints(source: GodotNavigationMeshSourceGeometryData3D): NavigationMeshVector3[] {
  const values = stateOf(source).vertices;
  return Array.from({ length: values.length / 3 }, (_, index) => ({
    x: values[index * 3]!,
    y: values[index * 3 + 1]!,
    z: values[index * 3 + 2]!,
  }));
}

function transformSourcePoint(
  point: NavigationMeshVector3,
  transform: unknown,
): NavigationMeshVector3 {
  if (transform === null || transform === undefined) return finitePoint(point);
  const value = transform as {
    readonly elements?: readonly number[];
    readonly origin?: NavigationMeshVector3;
    readonly basis?: {
      readonly x?: NavigationMeshVector3;
      readonly y?: NavigationMeshVector3;
      readonly z?: NavigationMeshVector3;
    };
  };
  const elements = Array.isArray(transform) ? (transform as readonly number[]) : value.elements;
  if (elements?.length === 16) {
    return {
      x: elements[0]! * point.x + elements[4]! * point.y + elements[8]! * point.z + elements[12]!,
      y: elements[1]! * point.x + elements[5]! * point.y + elements[9]! * point.z + elements[13]!,
      z: elements[2]! * point.x + elements[6]! * point.y + elements[10]! * point.z + elements[14]!,
    };
  }
  const origin = value.origin ?? { x: 0, y: 0, z: 0 };
  const x = value.basis?.x ?? { x: 1, y: 0, z: 0 };
  const y = value.basis?.y ?? { x: 0, y: 1, z: 0 };
  const z = value.basis?.z ?? { x: 0, y: 0, z: 1 };
  return {
    x: x.x * point.x + y.x * point.y + z.x * point.z + origin.x,
    y: x.y * point.x + y.y * point.y + z.y * point.z + origin.y,
    z: x.z * point.x + y.z * point.y + z.z * point.z + origin.z,
  };
}

function geometryArrays(value: unknown): { vertices: NavigationMeshVector3[]; indices: number[] } {
  const geometry = value instanceof Mesh ? value.geometry : value;
  if (!(geometry instanceof BufferGeometry))
    throw new TypeError(
      'NavigationMeshSourceGeometryData3D.add_mesh requires a native Three BufferGeometry or Mesh.',
    );
  const position = geometry.getAttribute('position');
  if (position === undefined) return { vertices: [], indices: [] };
  const vertices = Array.from({ length: position.count }, (_, index) => ({
    x: position.getX(index),
    y: position.getY(index),
    z: position.getZ(index),
  }));
  const index = geometry.getIndex();
  return {
    vertices,
    indices:
      index === null
        ? Array.from({ length: position.count }, (_, at) => at)
        : Array.from({ length: index.count }, (_, at) => index.getX(at)),
  };
}

export function appendGodotNavigationSourceTriangles(
  source: GodotNavigationMeshSourceGeometryData3D,
  vertices: readonly NavigationMeshVector3[],
  indices: readonly number[],
): void {
  const state = stateOf(source),
    offset = state.vertices.length / 3;
  const points = vertices.map(finitePoint);
  const checked = checkedIndices(indices, points.length);
  if (checked.length % 3 !== 0)
    throw new RangeError('Navigation source indices must contain complete triangles.');
  for (const point of points) state.vertices.push(point.x, point.y, point.z);
  state.indices.push(...checked.map((index) => index + offset));
  godotResourceEmitChanged(source);
}

export function createGodotNavigationMeshSourceGeometryData3D(): GodotNavigationMeshSourceGeometryData3D {
  let source!: GodotNavigationMeshSourceGeometryData3D;
  source = {
    kind: 'NavigationMeshSourceGeometryData3D',
    get vertices() {
      return source.get_vertices();
    },
    set vertices(value) {
      source.set_vertices(value);
    },
    get indices() {
      return source.get_indices();
    },
    set indices(value) {
      source.set_indices(value);
    },
    get projectedObstructions() {
      return source.get_projected_obstructions();
    },
    set projectedObstructions(value) {
      source.set_projected_obstructions(value);
    },
    set_vertices(vertices) {
      const checked = finiteNumbers(vertices, 'set_vertices');
      if (checked.length % 3 !== 0)
        throw new RangeError('Navigation source vertices must contain packed XYZ triples.');
      stateOf(source).vertices = checked;
      godotResourceEmitChanged(source);
    },
    get_vertices: () => [...stateOf(source).vertices],
    set_indices(indices) {
      const state = stateOf(source),
        checked = checkedIndices(indices, state.vertices.length / 3);
      if (checked.length % 3 !== 0)
        throw new RangeError('Navigation source indices must contain complete triangles.');
      state.indices = checked;
      godotResourceEmitChanged(source);
    },
    get_indices: () => [...stateOf(source).indices],
    append_arrays(vertices, indices) {
      const values = finiteNumbers(vertices, 'append_arrays');
      if (values.length % 3 !== 0)
        throw new RangeError('Navigation source vertices must contain packed XYZ triples.');
      appendGodotNavigationSourceTriangles(
        source,
        Array.from({ length: values.length / 3 }, (_, at) => ({
          x: values[at * 3]!,
          y: values[at * 3 + 1]!,
          z: values[at * 3 + 2]!,
        })),
        indices,
      );
    },
    merge(other) {
      const state = stateOf(source),
        incoming = stateOf(other),
        offset = state.vertices.length;
      state.vertices.push(...incoming.vertices);
      state.indices.push(...incoming.indices.map((index) => index + offset / 3));
      state.obstructions.push(
        ...incoming.obstructions.map((obstruction) => ({
          ...obstruction,
          vertices: obstruction.vertices.map(finitePoint),
        })),
      );
      godotResourceEmitChanged(source);
    },
    clear() {
      const state = stateOf(source);
      if (
        state.vertices.length === 0 &&
        state.indices.length === 0 &&
        state.obstructions.length === 0
      )
        return;
      state.vertices.length = 0;
      state.indices.length = 0;
      state.obstructions.length = 0;
      godotResourceEmitChanged(source);
    },
    has_data: () => stateOf(source).indices.length >= 3,
    add_mesh(mesh, transform) {
      const arrays = geometryArrays(mesh);
      appendGodotNavigationSourceTriangles(
        source,
        arrays.vertices.map((point) => transformSourcePoint(point, transform)),
        arrays.indices,
      );
    },
    add_mesh_array(meshArray, transform) {
      for (const mesh of meshArray) source.add_mesh(mesh, transform);
    },
    add_faces(faces, transform) {
      if (faces.length % 3 !== 0)
        throw new RangeError('Navigation source faces must contain complete triangles.');
      appendGodotNavigationSourceTriangles(
        source,
        faces.map((point) => transformSourcePoint(point, transform)),
        faces.map((_, index) => index),
      );
    },
    add_projected_obstruction(vertices, elevation, height, carve) {
      if (!Number.isFinite(elevation) || !Number.isFinite(height) || height < 0)
        throw new RangeError(
          'Projected obstruction elevation and height must be finite and height nonnegative.',
        );
      if (vertices.length < 3)
        throw new RangeError('Projected navigation obstructions require at least three vertices.');
      stateOf(source).obstructions.push({
        vertices: vertices.map(finitePoint),
        elevation,
        height,
        carve: Boolean(carve),
      });
      godotResourceEmitChanged(source);
    },
    clear_projected_obstructions() {
      const state = stateOf(source);
      if (state.obstructions.length === 0) return;
      state.obstructions.length = 0;
      godotResourceEmitChanged(source);
    },
    set_projected_obstructions(obstructions) {
      stateOf(source).obstructions = obstructions.map((obstruction) => {
        const elevation = Number(obstruction.elevation),
          height = Number(obstruction.height);
        if (
          !Number.isFinite(elevation) ||
          !Number.isFinite(height) ||
          height < 0 ||
          obstruction.vertices.length < 3
        ) {
          throw new TypeError(
            'Projected navigation obstructions require at least three vertices, finite elevation, and nonnegative finite height.',
          );
        }
        return {
          vertices: obstruction.vertices.map(finitePoint),
          elevation,
          height,
          carve: Boolean(obstruction.carve),
        };
      });
      godotResourceEmitChanged(source);
    },
    get_projected_obstructions: () =>
      stateOf(source).obstructions.map((obstruction) => ({
        ...obstruction,
        vertices: obstruction.vertices.map(finitePoint),
      })),
    get_bounds() {
      const state = stateOf(source);
      const points = [
        ...sourcePoints(source),
        ...state.obstructions.flatMap((obstruction) =>
          obstruction.vertices.flatMap((point) => [
            { x: point.x, y: obstruction.elevation, z: point.z },
            { x: point.x, y: obstruction.elevation + obstruction.height, z: point.z },
          ]),
        ),
      ];
      if (points.length === 0)
        return { position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
      const min = { x: Infinity, y: Infinity, z: Infinity },
        max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const point of points) {
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
      }
      return { position: min, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
    },
  };
  SOURCES.set(source, { vertices: [], indices: [], obstructions: [] });
  registerGodotObjectIdentity(source, 'NavigationMeshSourceGeometryData3D');
  return bindGodotResourceProtocol(source, {
    createDuplicate(original) {
      const duplicate = createGodotNavigationMeshSourceGeometryData3D();
      duplicate.set_vertices(original.get_vertices());
      duplicate.set_indices(original.get_indices());
      duplicate.set_projected_obstructions(original.get_projected_obstructions());
      return duplicate;
    },
  });
}

const transformed = new Vector3();
const sourceTransform = new Matrix4();

interface NavigationStaticBody3DSource {
  readonly collisionLayer: number;
}

const NAVIGATION_STATIC_BODY_3D_SOURCES = new WeakMap<Object3D, NavigationStaticBody3DSource>();

/** Retain the two StaticBody3D facts Godot's navigation source parser reads from its owner. */
export function bindGodotNavigationStaticBody3DSource(
  node: Object3D,
  collisionLayer: number,
): void {
  if (!Number.isSafeInteger(collisionLayer) || collisionLayer < 0 || collisionLayer > 0xffff_ffff) {
    throw new RangeError('StaticBody3D.collision_layer requires an unsigned 32-bit integer.');
  }
  NAVIGATION_STATIC_BODY_3D_SOURCES.set(node, { collisionLayer });
}

interface ProjectedObstacle {
  readonly points: readonly NavigationMeshVector3[];
  readonly minY: number;
  readonly maxY: number;
}

function cross2(
  a: NavigationMeshVector3,
  b: NavigationMeshVector3,
  c: NavigationMeshVector3,
): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function pointInPolygon(
  point: NavigationMeshVector3,
  polygon: readonly NavigationMeshVector3[],
): boolean {
  let inside = false;
  for (let at = 0, previous = polygon.length - 1; at < polygon.length; previous = at, at += 1) {
    const a = polygon[at]!,
      b = polygon[previous]!;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  a: NavigationMeshVector3,
  b: NavigationMeshVector3,
  c: NavigationMeshVector3,
  d: NavigationMeshVector3,
): boolean {
  const abC = cross2(a, b, c),
    abD = cross2(a, b, d),
    cdA = cross2(c, d, a),
    cdB = cross2(c, d, b);
  return (
    ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0)) &&
    ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0))
  );
}

function triangleIntersectsObstacle(
  a: NavigationMeshVector3,
  b: NavigationMeshVector3,
  c: NavigationMeshVector3,
  obstacle: ProjectedObstacle,
): boolean {
  if (Math.max(a.y, b.y, c.y) < obstacle.minY || Math.min(a.y, b.y, c.y) > obstacle.maxY)
    return false;
  if (
    pointInPolygon(a, obstacle.points) ||
    pointInPolygon(b, obstacle.points) ||
    pointInPolygon(c, obstacle.points)
  )
    return true;
  if (
    obstacle.points.some((point) => {
      const ab = cross2(a, b, point),
        bc = cross2(b, c, point),
        ca = cross2(c, a, point);
      return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
    })
  )
    return true;
  const triangle = [a, b, c];
  for (let edge = 0; edge < 3; edge += 1) {
    const from = triangle[edge]!,
      to = triangle[(edge + 1) % 3]!;
    for (let at = 0; at < obstacle.points.length; at += 1) {
      if (
        segmentsIntersect(
          from,
          to,
          obstacle.points[at]!,
          obstacle.points[(at + 1) % obstacle.points.length]!,
        )
      )
        return true;
    }
  }
  return false;
}

export function parseGodotNavigationSourceGeometryData3D(
  navigationMesh: GodotNavigationMesh,
  source: GodotNavigationMeshSourceGeometryData3D,
  root: Object3D,
  callback?: () => void,
): void {
  if (navigationMesh.kind !== 'NavigationMesh')
    throw new TypeError('NavigationServer3D.parse_source_geometry_data requires NavigationMesh.');
  if (!(root && typeof root.traverse === 'function'))
    throw new TypeError(
      'NavigationServer3D.parse_source_geometry_data requires a retained Three Object3D root.',
    );
  source.clear();
  root.updateWorldMatrix(true, true);
  const sourceMode = navigationMesh.get_source_geometry_mode();
  const sources =
    sourceMode === 0
      ? [root]
      : [
          ...(godotSceneTreeNavigationIndex(root)?.getNodesInGroup(
            navigationMesh.get_source_geometry_group_name(),
          ) ?? []),
        ].filter(
          (node): node is Object3D =>
            typeof node === 'object' && node !== null && 'traverse' in node,
        );
  if (sourceMode !== 0 && godotSceneTreeNavigationIndex(root) === undefined) {
    throw new Error(
      'NavigationServer3D.parse_source_geometry_data group source requires a root inside SceneTree.',
    );
  }
  const rootInverse = root.matrixWorld.clone().invert();
  const parseObject = (object: Object3D): void => {
    object.updateWorldMatrix(true, true);
    sourceTransform.multiplyMatrices(rootInverse, object.matrixWorld);
    const obstacle = BAKE_OBSTACLES.get(object)?.();
    if (obstacle?.affectNavigationMesh && obstacle.vertices.length >= 3) {
      const points = obstacle.vertices.map((point) => {
        transformed.set(point.x, point.y, point.z).applyMatrix4(sourceTransform);
        return { x: transformed.x, y: transformed.y, z: transformed.z };
      });
      const scaledHeight = obstacle.height * Math.abs(object.getWorldScale(transformed).y);
      const centerY = object.getWorldPosition(transformed).y;
      source.add_projected_obstruction(
        points,
        centerY - scaledHeight * 0.5,
        scaledHeight,
        obstacle.carveNavigationMesh,
      );
    }
    const staticBody =
      object.parent === null ? undefined : NAVIGATION_STATIC_BODY_3D_SOURCES.get(object.parent);
    if (
      navigationMesh.get_parsed_geometry_type() !== 0 &&
      staticBody !== undefined &&
      (staticBody.collisionLayer & navigationMesh.get_parsed_collision_mask()) !== 0 &&
      isGodotCollisionShape3DNode(object) &&
      isCollisionShape3DEnabled(object)
    ) {
      const shape = getCollisionShape3DShape(object);
      if (shape?.type === 'box') {
        const { x, y, z } = shape.halfExtents;
        const vertices = [
          { x: -x, y: -y, z: -z },
          { x, y: -y, z: -z },
          { x, y, z: -z },
          { x: -x, y, z: -z },
          { x: -x, y: -y, z },
          { x, y: -y, z },
          { x, y, z },
          { x: -x, y, z },
        ].map((point) => {
          transformed.set(point.x, point.y, point.z).applyMatrix4(sourceTransform);
          return { x: transformed.x, y: transformed.y, z: transformed.z };
        });
        appendGodotNavigationSourceTriangles(
          source,
          vertices,
          [
            0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7,
            3, 1, 2, 6, 1, 6, 5,
          ],
        );
      } else if (shape?.type === 'trimesh') {
        const vertices = Array.from({ length: shape.vertices.length / 3 }, (_, index) => {
          transformed
            .set(
              shape.vertices[index * 3]!,
              shape.vertices[index * 3 + 1]!,
              shape.vertices[index * 3 + 2]!,
            )
            .applyMatrix4(sourceTransform);
          return { x: transformed.x, y: transformed.y, z: transformed.z };
        });
        appendGodotNavigationSourceTriangles(
          source,
          vertices,
          Array.from({ length: vertices.length }, (_, index) => index),
        );
      }
    }
    if (navigationMesh.get_parsed_geometry_type() === 1 || !(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (position === undefined) return;
    const vertices: NavigationMeshVector3[] = [];
    for (let index = 0; index < position.count; index += 1) {
      transformed
        .set(position.getX(index), position.getY(index), position.getZ(index))
        .applyMatrix4(sourceTransform);
      vertices.push({ x: transformed.x, y: transformed.y, z: transformed.z });
    }
    const nativeIndex = object.geometry.getIndex();
    const indices =
      nativeIndex === null
        ? Array.from({ length: position.count }, (_, index) => index)
        : Array.from({ length: nativeIndex.count }, (_, index) => nativeIndex.getX(index));
    if (indices.length >= 3)
      appendGodotNavigationSourceTriangles(
        source,
        vertices,
        indices.slice(0, indices.length - (indices.length % 3)),
      );
  };
  for (const rootSource of sources) {
    if (sourceMode === 2) parseObject(rootSource);
    else rootSource.traverse(parseObject);
  }
  const obstacles = source.get_projected_obstructions().map(
    (obstruction): ProjectedObstacle => ({
      points: obstruction.vertices.map(finitePoint),
      minY: obstruction.elevation,
      maxY: obstruction.elevation + obstruction.height,
    }),
  );
  if (obstacles.length !== 0 && source.has_data()) {
    const vertices = sourcePoints(source),
      input = source.get_indices(),
      retained: number[] = [];
    for (let at = 0; at + 2 < input.length; at += 3) {
      const ia = input[at]!,
        ib = input[at + 1]!,
        ic = input[at + 2]!;
      const a = vertices[ia],
        b = vertices[ib],
        c = vertices[ic];
      if (
        a !== undefined &&
        b !== undefined &&
        c !== undefined &&
        !obstacles.some((obstacle) => triangleIntersectsObstacle(a, b, c, obstacle))
      ) {
        retained.push(ia, ib, ic);
      }
    }
    source.set_vertices(vertices.flatMap((point) => [point.x, point.y, point.z]));
    source.set_indices(retained);
  }
  callback?.();
}

const BAKING = new WeakSet<GodotNavigationMesh>();
export const isGodotNavigationMeshBaking = (navigationMesh: GodotNavigationMesh): boolean =>
  BAKING.has(navigationMesh);
function clearGodotNavigationBakeTarget(navigationMesh: GodotNavigationMesh): void {
  const wasEmpty =
    navigationMesh.get_vertices().length === 0 && navigationMesh.get_polygon_count() === 0;
  navigationMesh.clear();
  // NavigationMesh::clear mutates the arrays; the generator owns the changed
  // notification and emits it even when the target was already empty.
  if (wasEmpty) godotResourceEmitChanged(navigationMesh);
}

export function bakeGodotNavigationMeshFromSourceGeometryData3D(
  navigationMesh: GodotNavigationMesh,
  source: GodotNavigationMeshSourceGeometryData3D,
  callback?: () => void,
): void {
  const vertices = sourcePoints(source),
    indices = source.get_indices();
  // Godot treats an empty source bake as a successful clear of the mutable bake
  // target. This keeps a valid NavigationMesh resource in the region while it has
  // no navigable surface; the resource change drives the map's retained rebuild.
  if (indices.length === 0) {
    clearGodotNavigationBakeTarget(navigationMesh);
    callback?.();
    return;
  }
  navigationMesh.set_vertices(vertices);
  navigationMesh.set_polygons(
    Array.from({ length: indices.length / 3 }, (_, triangle) =>
      indices.slice(triangle * 3, triangle * 3 + 3),
    ),
  );
  callback?.();
}

export function bakeGodotNavigationMeshFromSourceGeometryData3DAsync(
  navigationMesh: GodotNavigationMesh,
  source: GodotNavigationMeshSourceGeometryData3D,
  callback?: () => void,
): void {
  if (BAKING.has(navigationMesh)) throw new Error('NavigationMesh is already baking.');
  if (!source.has_data()) {
    clearGodotNavigationBakeTarget(navigationMesh);
    callback?.();
    return;
  }
  BAKING.add(navigationMesh);
  queueMicrotask(() => {
    try {
      bakeGodotNavigationMeshFromSourceGeometryData3D(navigationMesh, source, callback);
    } finally {
      BAKING.delete(navigationMesh);
    }
  });
}

export function bakeGodotNavigationRegion3D(
  region: Object3D & { navigationMesh: GodotNavigationMesh | null },
  callback?: () => void,
  onThread = false,
): void {
  const mesh = region.navigationMesh ?? createGodotNavigationMesh();
  region.navigationMesh = mesh;
  const source = createGodotNavigationMeshSourceGeometryData3D();
  parseGodotNavigationSourceGeometryData3D(mesh, source, region);
  if (onThread) bakeGodotNavigationMeshFromSourceGeometryData3DAsync(mesh, source, callback);
  else bakeGodotNavigationMeshFromSourceGeometryData3D(mesh, source, callback);
}

export function bakeGodotNavigationMeshFromRoot3D(
  navigationMesh: GodotNavigationMesh,
  root: Object3D,
): void {
  const source = createGodotNavigationMeshSourceGeometryData3D();
  parseGodotNavigationSourceGeometryData3D(navigationMesh, source, root);
  bakeGodotNavigationMeshFromSourceGeometryData3D(navigationMesh, source);
}
