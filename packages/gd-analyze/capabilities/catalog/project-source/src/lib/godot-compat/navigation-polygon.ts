/** Godot NavigationPolygon and 2D source geometry as project-owned plain data resources. */
import { geometry2DSegmentIntersectsSegment } from './geometry-2d';
import { partitionNavigationOutlines, type NavigationPartitionOutline } from './navigation-polygon-partition';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface NavigationPolygonVector2 { readonly x: number; readonly y: number }
export interface NavigationPolygonRect2 { readonly position: NavigationPolygonVector2; readonly size: NavigationPolygonVector2 }
export interface NavigationPolygonMeshData {
  readonly vertices: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly polygons: readonly (readonly number[])[];
  readonly cell_size: number;
}

const NAVIGATION_POLYGONS = new WeakSet<object>();

/** Exact retained NavigationPolygon resource identity used by the native Recast map owner. */
export function isGodotNavigationPolygon(value: unknown): value is GodotNavigationPolygon {
  return typeof value === 'object' && value !== null && NAVIGATION_POLYGONS.has(value);
}

const copyPoint = (point: NavigationPolygonVector2): NavigationPolygonVector2 => ({ x: Number(point.x), y: Number(point.y) });
const copyOutline = (outline: readonly NavigationPolygonVector2[]): NavigationPolygonVector2[] => outline.map(copyPoint);
const copyOutlines = (outlines: readonly (readonly NavigationPolygonVector2[])[]): NavigationPolygonVector2[][] => outlines.map(copyOutline);
const copyPolygon = (polygon: readonly number[]): number[] => polygon.map((index) => Number(index) | 0);
function checkedIndex(index: number, length: number, member: string, insertion = false): number {
  const maximum = insertion ? length : length - 1;
  if (!Number.isSafeInteger(index) || index < 0 || index > maximum) throw new RangeError(`${member} index ${index} is outside [0, ${maximum}].`);
  return index;
}
function layerBit(layer: number): number {
  if (!Number.isSafeInteger(layer) || layer < 1 || layer > 32) throw new RangeError('NavigationPolygon collision layer must be in [1, 32].');
  return 2 ** (layer - 1);
}
function boundsOf(outlines: readonly (readonly NavigationPolygonVector2[])[]): NavigationPolygonRect2 {
  const points = outlines.flat();
  if (points.length === 0) return { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
  let minX = points[0]!.x, maxX = minX, minY = points[0]!.y, maxY = minY;
  for (const point of points.slice(1)) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  return { position: { x: minX, y: minY }, size: { x: maxX - minX, y: maxY - minY } };
}

export interface GodotNavigationPolygon {
  readonly kind: 'NavigationPolygon';
  set_vertices(value: readonly NavigationPolygonVector2[]): void; get_vertices(): readonly NavigationPolygonVector2[];
  add_polygon(value: readonly number[]): void; get_polygon_count(): number; get_polygon(index: number): readonly number[]; clear_polygons(): void;
  set_polygons(value: readonly (readonly number[])[]): void; get_polygons(): readonly (readonly number[])[];
  _set_polygons(value: readonly (readonly number[])[]): void; _get_polygons(): readonly (readonly number[])[];
  add_outline(value: readonly NavigationPolygonVector2[]): void; add_outline_at_index(value: readonly NavigationPolygonVector2[], index: number): void;
  get_outline_count(): number; set_outline(index: number, value: readonly NavigationPolygonVector2[]): void; get_outline(index: number): readonly NavigationPolygonVector2[];
  remove_outline(index: number): void; clear_outlines(): void; set_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void; get_outlines(): readonly (readonly NavigationPolygonVector2[])[];
  _set_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void; _get_outlines(): readonly (readonly NavigationPolygonVector2[])[];
  make_polygons_from_outlines(): void;
  set_cell_size(value: number): void; get_cell_size(): number; set_border_size(value: number): void; get_border_size(): number;
  set_sample_partition_type(value: number): void; get_sample_partition_type(): number;
  set_parsed_geometry_type(value: number): void; get_parsed_geometry_type(): number;
  set_parsed_collision_mask(value: number): void; get_parsed_collision_mask(): number;
  set_parsed_collision_mask_value(layer: number, value: boolean): void; get_parsed_collision_mask_value(layer: number): boolean;
  set_source_geometry_mode(value: number): void; get_source_geometry_mode(): number;
  set_source_geometry_group_name(value: string): void; get_source_geometry_group_name(): string;
  set_agent_radius(value: number): void; get_agent_radius(): number;
  set_baking_rect(value: NavigationPolygonRect2): void; get_baking_rect(): NavigationPolygonRect2;
  set_baking_rect_offset(value: NavigationPolygonVector2): void; get_baking_rect_offset(): NavigationPolygonVector2;
  get_navigation_mesh(): NavigationPolygonMeshData; clear(): void;
}

export interface GodotNavigationPolygonOptions {
  readonly vertices?: readonly NavigationPolygonVector2[];
  readonly polygons?: readonly (readonly number[])[];
  readonly outlines?: readonly (readonly NavigationPolygonVector2[])[];
  readonly cellSize?: number;
  readonly borderSize?: number;
  readonly samplePartitionType?: number;
  readonly parsedGeometryType?: number;
  readonly parsedCollisionMask?: number;
  readonly sourceGeometryMode?: number;
  readonly sourceGeometryGroupName?: string;
  readonly agentRadius?: number;
  readonly bakingRect?: NavigationPolygonRect2;
  readonly bakingRectOffset?: NavigationPolygonVector2;
}

export function createGodotNavigationPolygon(options: GodotNavigationPolygonOptions = {}): GodotNavigationPolygon {
  let vertices = (options.vertices ?? []).map(copyPoint), polygons = (options.polygons ?? []).map(copyPolygon), outlines = copyOutlines(options.outlines ?? []);
  let cellSize = 1, borderSize = 0, samplePartitionType = 0, parsedGeometryType = 2, parsedCollisionMask = 0xffff_ffff;
  let sourceGeometryMode = 0, sourceGeometryGroupName = 'navigation_polygon_source_geometry_group', agentRadius = 10;
  let bakingRect: NavigationPolygonRect2 = { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } }, bakingRectOffset: NavigationPolygonVector2 = { x: 0, y: 0 };
  let navigationMesh: { vertices: { x: number; y: number; z: number }[]; polygons: number[][]; cell_size: number } | undefined;
  const invalidateMesh = (): void => {
    navigationMesh = undefined;
    godotResourceEmitChanged(resource);
  };
  const resource: GodotNavigationPolygon = {
    kind: 'NavigationPolygon',
    set_vertices(value) { vertices = value.map(copyPoint); invalidateMesh(); }, get_vertices: () => vertices.map(copyPoint),
    add_polygon(value) { polygons.push(copyPolygon(value)); invalidateMesh(); }, get_polygon_count: () => polygons.length,
    get_polygon(index) { return [...polygons[checkedIndex(index, polygons.length, 'NavigationPolygon.get_polygon')]!]; }, clear_polygons() { polygons = []; invalidateMesh(); },
    set_polygons(value) { polygons = value.map(copyPolygon); invalidateMesh(); }, get_polygons: () => polygons.map((polygon) => [...polygon]),
    _set_polygons(value) { resource.set_polygons(value); }, _get_polygons: () => resource.get_polygons(),
    add_outline(value) { outlines.push(copyOutline(value)); }, add_outline_at_index(value, index) { outlines.splice(checkedIndex(index, outlines.length, 'NavigationPolygon.add_outline_at_index', true), 0, copyOutline(value)); },
    get_outline_count: () => outlines.length, set_outline(index, value) { outlines[checkedIndex(index, outlines.length, 'NavigationPolygon.set_outline')] = copyOutline(value); },
    get_outline(index) { return copyOutline(outlines[checkedIndex(index, outlines.length, 'NavigationPolygon.get_outline')]!); }, remove_outline(index) { outlines.splice(checkedIndex(index, outlines.length, 'NavigationPolygon.remove_outline'), 1); },
    clear_outlines() { outlines = []; }, set_outlines(value) { outlines = copyOutlines(value); }, get_outlines: () => copyOutlines(outlines),
    _set_outlines(value) { resource.set_outlines(value); }, _get_outlines: () => resource.get_outlines(),
    make_polygons_from_outlines() {
      console.warn(
        'NavigationPolygon.make_polygons_from_outlines() is deprecated; use NavigationServer2D.parse_source_geometry_data() and bake_from_source_geometry_data().',
      );
      // Godot drops the lazily generated NavigationMesh before partitioning, including when an
      // invalid set of outlines makes TPPL return failure.
      invalidateMesh();
      let outsideX = -1e10;
      let outsideY = -1e10;
      for (const outline of outlines) {
        if (outline.length < 3) continue;
        for (const point of outline) {
          outsideX = Math.max(outsideX, point.x);
          outsideY = Math.max(outsideY, point.y);
        }
      }
      const outside = { x: outsideX + 0.7239784, y: outsideY + 0.819238 };
      const input: NavigationPartitionOutline[] = [];
      for (let outlineIndex = 0; outlineIndex < outlines.length; outlineIndex += 1) {
        const outline = outlines[outlineIndex]!;
        if (outline.length < 3) continue;
        let intersections = 0;
        for (let otherIndex = 0; otherIndex < outlines.length; otherIndex += 1) {
          if (otherIndex === outlineIndex) continue;
          const other = outlines[otherIndex]!;
          if (other.length < 3) continue;
          for (let edge = 0; edge < other.length; edge += 1) {
            if (geometry2DSegmentIntersectsSegment(
              outline[0]!,
              outside,
              other[edge]!,
              other[(edge + 1) % other.length]!,
            ) !== null) intersections += 1;
          }
        }
        const hole = intersections % 2 !== 0;
        const points = copyOutline(outline);
        let twiceArea = 0;
        for (let index = 0; index < points.length; index += 1) {
          const point = points[index]!;
          const next = points[(index + 1) % points.length]!;
          twiceArea += point.x * next.y - point.y * next.x;
        }
        // TPPL leaves zero-area orientation untouched. Non-holes are CCW and holes are CW.
        if (twiceArea !== 0 && (hole ? twiceArea > 0 : twiceArea < 0)) points.reverse();
        input.push({ points, hole });
      }
      const partitioned = partitionNavigationOutlines(input);
      if (partitioned === null) {
        console.error(
          'NavigationPolygon: Convex partition failed. Outlines cannot overlap vertices or edges, self-intersect, or intersect another outline.',
        );
        return;
      }
      const nextVertices: NavigationPolygonVector2[] = [];
      const nextPolygons: number[][] = [];
      const pointIndices = new Map<string, number>();
      for (const part of partitioned) {
        const polygon: number[] = [];
        for (const point of part) {
          const key = `${Object.is(point.x, -0) ? 0 : point.x}\u0000${Object.is(point.y, -0) ? 0 : point.y}`;
          let index = pointIndices.get(key);
          if (index === undefined) {
            index = nextVertices.length;
            pointIndices.set(key, index);
            nextVertices.push(copyPoint(point));
          }
          polygon.push(index);
        }
        nextPolygons.push(polygon);
      }
      vertices = nextVertices;
      polygons = nextPolygons;
    },
    set_cell_size(value) { if (!Number.isFinite(value)) throw new TypeError('NavigationPolygon.cell_size must be finite.'); if (cellSize === value) return; cellSize = value; if (navigationMesh !== undefined) navigationMesh.cell_size = value; godotResourceEmitChanged(resource); }, get_cell_size: () => cellSize,
    set_border_size(value) { if (!Number.isFinite(value) || value < 0) throw new RangeError('NavigationPolygon.border_size must be non-negative.'); borderSize = value; }, get_border_size: () => borderSize,
    set_sample_partition_type(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 1) throw new RangeError('NavigationPolygon.sample_partition_type is outside its Godot enum.'); samplePartitionType = value; }, get_sample_partition_type: () => samplePartitionType,
    set_parsed_geometry_type(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError('NavigationPolygon.parsed_geometry_type is outside its Godot enum.'); parsedGeometryType = value; }, get_parsed_geometry_type: () => parsedGeometryType,
    set_parsed_collision_mask(value) { parsedCollisionMask = value >>> 0; }, get_parsed_collision_mask: () => parsedCollisionMask,
    set_parsed_collision_mask_value(layer, value) { const bit = layerBit(layer); parsedCollisionMask = value ? (parsedCollisionMask | bit) >>> 0 : (parsedCollisionMask & ~bit) >>> 0; }, get_parsed_collision_mask_value: (layer) => (parsedCollisionMask & layerBit(layer)) !== 0,
    set_source_geometry_mode(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError('NavigationPolygon.source_geometry_mode is outside its Godot enum.'); sourceGeometryMode = value; }, get_source_geometry_mode: () => sourceGeometryMode,
    set_source_geometry_group_name(value) { sourceGeometryGroupName = String(value); }, get_source_geometry_group_name: () => sourceGeometryGroupName,
    set_agent_radius(value) { if (!Number.isFinite(value) || value < 0) throw new RangeError('NavigationPolygon.agent_radius must be non-negative.'); if (agentRadius === value) return; agentRadius = value; godotResourceEmitChanged(resource); }, get_agent_radius: () => agentRadius,
    set_baking_rect(value) {
      bakingRect = { position: copyPoint(value.position), size: copyPoint(value.size) };
      godotResourceEmitChanged(resource);
    },
    get_baking_rect: () => ({ position: copyPoint(bakingRect.position), size: copyPoint(bakingRect.size) }),
    set_baking_rect_offset(value) {
      bakingRectOffset = copyPoint(value);
      godotResourceEmitChanged(resource);
    },
    get_baking_rect_offset: () => copyPoint(bakingRectOffset),
    get_navigation_mesh: () => navigationMesh ??= { vertices: vertices.map((point) => ({ x: point.x, y: 0, z: point.y })), polygons: polygons.map((polygon) => [...polygon]), cell_size: cellSize },
    clear() { vertices = []; polygons = []; invalidateMesh(); },
  };
  if (options.cellSize !== undefined) resource.set_cell_size(options.cellSize);
  if (options.borderSize !== undefined) resource.set_border_size(options.borderSize);
  if (options.samplePartitionType !== undefined) resource.set_sample_partition_type(options.samplePartitionType);
  if (options.parsedGeometryType !== undefined) resource.set_parsed_geometry_type(options.parsedGeometryType);
  if (options.parsedCollisionMask !== undefined) resource.set_parsed_collision_mask(options.parsedCollisionMask);
  if (options.sourceGeometryMode !== undefined) resource.set_source_geometry_mode(options.sourceGeometryMode);
  if (options.sourceGeometryGroupName !== undefined) resource.set_source_geometry_group_name(options.sourceGeometryGroupName);
  if (options.agentRadius !== undefined) resource.set_agent_radius(options.agentRadius);
  if (options.bakingRect !== undefined) resource.set_baking_rect(options.bakingRect);
  if (options.bakingRectOffset !== undefined) resource.set_baking_rect_offset(options.bakingRectOffset);
  NAVIGATION_POLYGONS.add(resource);
  registerGodotObjectIdentity(resource, 'NavigationPolygon');
  bindGodotResourceProtocol(resource, {
    createDuplicate(source) {
      return createGodotNavigationPolygon({
        vertices: source.get_vertices(),
        polygons: source.get_polygons(),
        outlines: source.get_outlines(),
        cellSize: source.get_cell_size(),
        borderSize: source.get_border_size(),
        samplePartitionType: source.get_sample_partition_type(),
        parsedGeometryType: source.get_parsed_geometry_type(),
        parsedCollisionMask: source.get_parsed_collision_mask(),
        sourceGeometryMode: source.get_source_geometry_mode(),
        sourceGeometryGroupName: source.get_source_geometry_group_name(),
        agentRadius: source.get_agent_radius(),
        bakingRect: source.get_baking_rect(),
        bakingRectOffset: source.get_baking_rect_offset(),
      });
    },
  });
  return resource;
}

export interface GodotProjectedNavigationObstruction2D { readonly version: 1; readonly vertices: readonly number[]; readonly carve: boolean }
export interface GodotNavigationMeshSourceGeometryData2D {
  readonly kind: 'NavigationMeshSourceGeometryData2D';
  clear(): void; has_data(): boolean;
  set_traversable_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void; get_traversable_outlines(): readonly (readonly NavigationPolygonVector2[])[];
  set_obstruction_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void; get_obstruction_outlines(): readonly (readonly NavigationPolygonVector2[])[];
  append_traversable_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void; append_obstruction_outlines(value: readonly (readonly NavigationPolygonVector2[])[]): void;
  add_traversable_outline(value: readonly NavigationPolygonVector2[]): void; add_obstruction_outline(value: readonly NavigationPolygonVector2[]): void;
  merge(other: GodotNavigationMeshSourceGeometryData2D): void;
  add_projected_obstruction(vertices: readonly NavigationPolygonVector2[], carve: boolean): void; clear_projected_obstructions(): void;
  set_projected_obstructions(value: readonly GodotProjectedNavigationObstruction2D[]): void; get_projected_obstructions(): readonly GodotProjectedNavigationObstruction2D[];
  get_bounds(): NavigationPolygonRect2;
}

export function createGodotNavigationMeshSourceGeometryData2D(): GodotNavigationMeshSourceGeometryData2D {
  let traversable: NavigationPolygonVector2[][] = [], obstruction: NavigationPolygonVector2[][] = [], projected: GodotProjectedNavigationObstruction2D[] = [];
  const resource: GodotNavigationMeshSourceGeometryData2D = {
    kind: 'NavigationMeshSourceGeometryData2D', clear() { traversable = []; obstruction = []; projected = []; }, has_data: () => traversable.length > 0,
    set_traversable_outlines(value) { traversable = copyOutlines(value); }, get_traversable_outlines: () => copyOutlines(traversable),
    set_obstruction_outlines(value) { obstruction = copyOutlines(value); }, get_obstruction_outlines: () => copyOutlines(obstruction),
    append_traversable_outlines(value) { traversable.push(...copyOutlines(value)); }, append_obstruction_outlines(value) { obstruction.push(...copyOutlines(value)); },
    add_traversable_outline(value) { if (value.length > 1) traversable.push(copyOutline(value)); }, add_obstruction_outline(value) { if (value.length > 1) obstruction.push(copyOutline(value)); },
    merge(other) { traversable.push(...copyOutlines(other.get_traversable_outlines())); obstruction.push(...copyOutlines(other.get_obstruction_outlines())); projected.push(...other.get_projected_obstructions().map((value) => ({ version: 1 as const, vertices: [...value.vertices], carve: value.carve }))); },
    add_projected_obstruction(value, carve) { if (value.length < 2) return; projected.push({ version: 1, vertices: value.flatMap((point) => [point.x, point.y]), carve: Boolean(carve) }); }, clear_projected_obstructions() { projected = []; },
    set_projected_obstructions(value) { projected = value.map((one) => { if (one.version !== 1 || one.vertices.length % 2 !== 0) throw new Error('NavigationMeshSourceGeometryData2D projected obstruction must use version 1 and paired vertices.'); return { version: 1, vertices: [...one.vertices], carve: Boolean(one.carve) }; }); },
    get_projected_obstructions: () => projected.map((one) => ({ version: 1, vertices: [...one.vertices], carve: one.carve })),
    get_bounds() { const projectedOutlines = projected.map((one) => { const points: NavigationPolygonVector2[] = []; for (let at = 0; at + 1 < one.vertices.length; at += 2) points.push({ x: one.vertices[at]!, y: one.vertices[at + 1]! }); return points; }); return boundsOf([...traversable, ...obstruction, ...projectedOutlines]); },
  };
  registerGodotObjectIdentity(resource, 'NavigationMeshSourceGeometryData2D'); return resource;
}

export interface GodotNavigationPolygonBakeResult { readonly vertices: readonly NavigationPolygonVector2[]; readonly polygons: readonly (readonly number[])[] }
export type GodotNavigationGeometryCallback = ((...args: readonly unknown[]) => unknown) | { call(...args: readonly unknown[]): unknown };
export interface GodotNavigationGeometrySupply {
  /** The supply owns scene traversal and calls parseNode once for every node visited in Godot order. */
  parse(rootNode: unknown, polygon: GodotNavigationPolygon, output: GodotNavigationMeshSourceGeometryData2D, parseNode: (node: unknown) => void): void;
  bake(polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D): GodotNavigationPolygonBakeResult | PromiseLike<GodotNavigationPolygonBakeResult>;
}
const bakingPolygons = new WeakSet<object>();
const isPromiseLike = (value: unknown): value is PromiseLike<GodotNavigationPolygonBakeResult> =>
  (typeof value === 'object' && value !== null || typeof value === 'function') && typeof (value as { readonly then?: unknown }).then === 'function';
const invokeCallback = (callback: GodotNavigationGeometryCallback | undefined, args: readonly unknown[]): void => {
  if (callback === undefined) return;
  if (typeof callback === 'function') callback(...args);
  else callback.call(...args);
};
export function isGodotNavigationPolygonBaking(polygon: GodotNavigationPolygon): boolean { return bakingPolygons.has(polygon); }
export function parseGodotNavigationSourceGeometry(polygon: GodotNavigationPolygon, output: GodotNavigationMeshSourceGeometryData2D, rootNode: unknown, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply, parseNode: (node: unknown) => void = () => {}): void {
  if (supply === undefined) throw new Error('NavigationServer2D.parse_source_geometry_data requires explicit translated scene-tree geometry parser supply.');
  output.clear();
  supply.parse(rootNode, polygon, output, parseNode);
  invokeCallback(callback, []);
}
export function bakeGodotNavigationPolygon(polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply): void {
  if (polygon.get_outline_count() === 0 && !source.has_data()) { polygon.clear(); invokeCallback(callback, []); return; }
  if (supply === undefined) throw new Error('NavigationServer2D.bake_from_source_geometry_data requires explicit native translator/Recast bake supply.');
  const apply = (value: GodotNavigationPolygonBakeResult) => { polygon.set_vertices(value.vertices); polygon.set_polygons(value.polygons); invokeCallback(callback, []); };
  const result = supply.bake(polygon, source);
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch((error: unknown) => { console.error('NavigationServer2D.bake_from_source_geometry_data rejected after its supply incorrectly returned a Promise.', error); });
    throw new Error('NavigationServer2D.bake_from_source_geometry_data requires a synchronous bake supply; use bake_from_source_geometry_data_async for Promise-returning supply.');
  }
  apply(result);
}
export function bakeGodotNavigationPolygonAsync(polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply): void {
  if (polygon.get_outline_count() === 0 && !source.has_data()) { polygon.clear(); invokeCallback(callback, []); return; }
  if (supply === undefined) throw new Error('NavigationServer2D.bake_from_source_geometry_data_async requires explicit native translator/Recast bake supply.');
  if (bakingPolygons.has(polygon)) throw new Error('NavigationServer2D.bake_from_source_geometry_data_async cannot bake the same NavigationPolygon concurrently.');
  const apply = (value: GodotNavigationPolygonBakeResult) => { polygon.set_vertices(value.vertices); polygon.set_polygons(value.polygons); invokeCallback(callback, []); };
  bakingPolygons.add(polygon);
  let result: GodotNavigationPolygonBakeResult | PromiseLike<GodotNavigationPolygonBakeResult>;
  try { result = supply.bake(polygon, source); }
  catch (error) { bakingPolygons.delete(polygon); throw error; }
  if (!isPromiseLike(result)) {
    try { apply(result); }
    finally { bakingPolygons.delete(polygon); }
    return;
  }
  void Promise.resolve(result).then(apply).catch((error: unknown) => { console.error('NavigationServer2D.bake_from_source_geometry_data_async failed.', error); }).finally(() => bakingPolygons.delete(polygon));
}
