import { type Vector2, vec2 } from './vector2';
import { type Vector3, vec3 } from './variant-3d';

interface GraphPoint<V> {
  position: V;
  weightScale: number;
  disabled: boolean;
  outgoing: Set<number>;
  incoming: Set<number>;
}

type VectorOps<V> = {
  copy(value: V): V;
  distance(a: V, b: V): number;
  closestOnSegment(point: V, from: V, to: V): V;
};

const vector2Ops: VectorOps<Vector2> = {
  copy: (value) => vec2(value.x, value.y),
  distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  closestOnSegment: (point, from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return vec2(from.x + dx * t, from.y + dy * t);
  },
};

const vector3Ops: VectorOps<Vector3> = {
  copy: (value) => vec3(value.x, value.y, value.z),
  distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  closestOnSegment: (point, from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSquared));
    return vec3(from.x + dx * t, from.y + dy * t, from.z + dz * t);
  },
};

abstract class GodotAStarGraph<V> {
  protected readonly points = new Map<number, GraphPoint<V>>();

  constructor(private readonly ops: VectorOps<V>) {}

  protected computeCost(from: V, to: V): number { return this.ops.distance(from, to); }
  protected estimateCost(from: V, to: V): number { return this.ops.distance(from, to); }

  get_available_point_id(): number {
    let id = 0;
    while (this.points.has(id)) id += 1;
    return id;
  }

  add_point(id: number, position: V, weightScale = 1): void {
    const current = this.points.get(id);
    if (current) {
      current.position = this.ops.copy(position);
      current.weightScale = weightScale;
      return;
    }
    this.points.set(id, { position: this.ops.copy(position), weightScale, disabled: false, outgoing: new Set(), incoming: new Set() });
  }

  get_point_position(id: number): V | null {
    const point = this.points.get(id);
    return point ? this.ops.copy(point.position) : null;
  }

  set_point_position(id: number, position: V): void {
    const point = this.points.get(id);
    if (point) point.position = this.ops.copy(position);
  }

  get_point_weight_scale(id: number): number { return this.points.get(id)?.weightScale ?? 0; }
  set_point_weight_scale(id: number, weightScale: number): void {
    const point = this.points.get(id);
    if (point) point.weightScale = weightScale;
  }
  set_point_disabled(id: number, disabled = true): void {
    const point = this.points.get(id);
    if (point) point.disabled = disabled;
  }
  is_point_disabled(id: number): boolean { return this.points.get(id)?.disabled ?? false; }
  has_point(id: number): boolean { return this.points.has(id); }

  remove_point(id: number): void {
    const point = this.points.get(id);
    if (!point) return;
    for (const other of point.outgoing) this.points.get(other)?.incoming.delete(id);
    for (const other of point.incoming) this.points.get(other)?.outgoing.delete(id);
    this.points.delete(id);
  }

  connect_points(id: number, toId: number, bidirectional = true): void {
    if (id === toId) return;
    const from = this.points.get(id);
    const to = this.points.get(toId);
    if (!from || !to) return;
    from.outgoing.add(toId);
    to.incoming.add(id);
    if (bidirectional) {
      to.outgoing.add(id);
      from.incoming.add(toId);
    }
  }

  disconnect_points(id: number, toId: number, bidirectional = true): void {
    this.points.get(id)?.outgoing.delete(toId);
    this.points.get(toId)?.incoming.delete(id);
    if (bidirectional) {
      this.points.get(toId)?.outgoing.delete(id);
      this.points.get(id)?.incoming.delete(toId);
    }
  }

  are_points_connected(id: number, toId: number, bidirectional = true): boolean {
    const forward = this.points.get(id)?.outgoing.has(toId) ?? false;
    return bidirectional ? forward && (this.points.get(toId)?.outgoing.has(id) ?? false) : forward;
  }

  get_point_connections(id: number): number[] { return [...(this.points.get(id)?.outgoing ?? [])]; }
  get_point_ids(): number[] { return [...this.points.keys()]; }
  get_point_count(): number { return this.points.size; }
  reserve_space(_numNodes: number): void {}
  clear(): void { this.points.clear(); }

  get_closest_point(position: V, includeDisabled = false): number {
    let closest = -1;
    let distance = Infinity;
    for (const [id, point] of this.points) {
      if (point.disabled && !includeDisabled) continue;
      const candidate = this.ops.distance(position, point.position);
      if (candidate < distance || (candidate === distance && id < closest)) {
        closest = id;
        distance = candidate;
      }
    }
    return closest;
  }

  get_closest_position_in_segment(position: V): V | null {
    let closest: V | null = null;
    let distance = Infinity;
    const seen = new Set<string>();
    for (const [id, point] of this.points) {
      for (const toId of point.outgoing) {
        const key = id < toId ? `${id}:${toId}` : `${toId}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const to = this.points.get(toId);
        if (!to) continue;
        const candidate = this.ops.closestOnSegment(position, point.position, to.position);
        const candidateDistance = this.ops.distance(position, candidate);
        if (candidateDistance < distance) {
          closest = candidate;
          distance = candidateDistance;
        }
      }
    }
    return closest ? this.ops.copy(closest) : null;
  }

  get_id_path(fromId: number, toId: number, allowPartialPath = false): number[] {
    const from = this.points.get(fromId);
    const target = this.points.get(toId);
    if (!from || !target || from.disabled) return [];
    if (fromId === toId) return [fromId];
    const open = new Set<number>([fromId]);
    const previous = new Map<number, number>();
    const cost = new Map<number, number>([[fromId, 0]]);
    const score = new Map<number, number>([[fromId, this.estimateCost(from.position, target.position)]]);
    let nearest = fromId;
    let nearestDistance = this.estimateCost(from.position, target.position);

    while (open.size) {
      let current = -1;
      let currentScore = Infinity;
      for (const id of open) {
        const value = score.get(id) ?? Infinity;
        if (value < currentScore || (value === currentScore && id < current)) { current = id; currentScore = value; }
      }
      if (current === toId) { nearest = current; break; }
      open.delete(current);
      const point = this.points.get(current);
      if (!point) continue;
      for (const neighborId of point.outgoing) {
        const neighbor = this.points.get(neighborId);
        if (!neighbor || neighbor.disabled) continue;
        const candidateCost = (cost.get(current) ?? Infinity) + this.computeCost(point.position, neighbor.position) * neighbor.weightScale;
        if (candidateCost >= (cost.get(neighborId) ?? Infinity)) continue;
        previous.set(neighborId, current);
        cost.set(neighborId, candidateCost);
        const remaining = this.estimateCost(neighbor.position, target.position);
        score.set(neighborId, candidateCost + remaining);
        open.add(neighborId);
        if (remaining < nearestDistance) { nearest = neighborId; nearestDistance = remaining; }
      }
    }

    if (nearest !== toId && !allowPartialPath) return [];
    const path = [nearest];
    while (path[0] !== fromId) {
      const head = path[0];
      if (head === undefined) return [];
      const parent = previous.get(head);
      if (parent === undefined) return [];
      path.unshift(parent);
    }
    return path;
  }

  get_point_path(fromId: number, toId: number, allowPartialPath = false): V[] {
    return this.get_id_path(fromId, toId, allowPartialPath).map((id) => this.ops.copy(this.points.get(id)!.position));
  }
}

export class GodotAStar2D extends GodotAStarGraph<Vector2> {
  constructor() { super(vector2Ops); }
  _compute_cost(fromId: number, toId: number): number {
    const from = this.get_point_position(fromId); const to = this.get_point_position(toId);
    return from && to ? vector2Ops.distance(from, to) : 0;
  }
  _estimate_cost(fromId: number, toId: number): number { return this._compute_cost(fromId, toId); }
}

export class GodotAStar3D extends GodotAStarGraph<Vector3> {
  constructor() { super(vector3Ops); }
  _compute_cost(fromId: number, toId: number): number {
    const from = this.get_point_position(fromId); const to = this.get_point_position(toId);
    return from && to ? vector3Ops.distance(from, to) : 0;
  }
  _estimate_cost(fromId: number, toId: number): number { return this._compute_cost(fromId, toId); }
}

export const GODOT_ASTAR_GRID_CELL_SHAPE_SQUARE = 0;
export const GODOT_ASTAR_GRID_CELL_SHAPE_ISOMETRIC_RIGHT = 1;
export const GODOT_ASTAR_GRID_CELL_SHAPE_ISOMETRIC_DOWN = 2;
export const GODOT_ASTAR_GRID_DIAGONAL_MODE_ALWAYS = 0;
export const GODOT_ASTAR_GRID_DIAGONAL_MODE_NEVER = 1;
export const GODOT_ASTAR_GRID_DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE = 2;
export const GODOT_ASTAR_GRID_DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES = 3;

type GridCell = { solid: boolean; weightScale: number };

function gridKey(id: Readonly<Vector2>): string { return `${Math.trunc(id.x)},${Math.trunc(id.y)}`; }
function parseGridKey(key: string): Vector2 {
  const [x = 0, y = 0] = key.split(',').map(Number);
  return vec2(x, y);
}

export class GodotAStarGrid2D {
  private region = { position: vec2(), size: vec2() };
  private offset = vec2();
  private cellSize = vec2(1, 1);
  private cellShape = GODOT_ASTAR_GRID_CELL_SHAPE_SQUARE;
  private jumpingEnabled = false;
  private diagonalMode = GODOT_ASTAR_GRID_DIAGONAL_MODE_ALWAYS;
  private readonly cells = new Map<string, GridCell>();
  private dirty = true;

  set_region(region: Readonly<{ position: Vector2; size: Vector2 }>): void { this.region = { position: vec2(region.position.x, region.position.y), size: vec2(region.size.x, region.size.y) }; this.dirty = true; }
  get_region(): Readonly<{ position: Vector2; size: Vector2 }> { return this.region; }
  set_size(size: Readonly<Vector2>): void { this.region.size = vec2(size.x, size.y); this.dirty = true; }
  get_size(): Vector2 { return vec2(this.region.size.x, this.region.size.y); }
  set_offset(offset: Readonly<Vector2>): void { this.offset = vec2(offset.x, offset.y); this.dirty = true; }
  get_offset(): Vector2 { return vec2(this.offset.x, this.offset.y); }
  set_cell_size(size: Readonly<Vector2>): void { this.cellSize = vec2(size.x, size.y); this.dirty = true; }
  get_cell_size(): Vector2 { return vec2(this.cellSize.x, this.cellSize.y); }
  set_cell_shape(shape: number): void { this.cellShape = shape; this.dirty = true; }
  get_cell_shape(): number { return this.cellShape; }
  set_jumping_enabled(enabled: boolean): void { this.jumpingEnabled = enabled; }
  is_jumping_enabled(): boolean { return this.jumpingEnabled; }
  set_diagonal_mode(mode: number): void { this.diagonalMode = mode; }
  get_diagonal_mode(): number { return this.diagonalMode; }
  is_dirty(): boolean { return this.dirty; }
  update(): void { this.dirty = false; }
  clear(): void { this.cells.clear(); this.region = { position: vec2(), size: vec2() }; this.dirty = true; }

  is_in_bounds(x: number, y: number): boolean {
    return x >= this.region.position.x && y >= this.region.position.y && x < this.region.position.x + this.region.size.x && y < this.region.position.y + this.region.size.y;
  }
  is_in_boundsv(id: Readonly<Vector2>): boolean { return this.is_in_bounds(Math.trunc(id.x), Math.trunc(id.y)); }
  set_point_solid(id: Readonly<Vector2>, solid = true): void { const key = gridKey(id); const cell = this.cells.get(key) ?? { solid: false, weightScale: 1 }; cell.solid = solid; this.cells.set(key, cell); }
  is_point_solid(id: Readonly<Vector2>): boolean { return this.cells.get(gridKey(id))?.solid ?? false; }
  set_point_weight_scale(id: Readonly<Vector2>, weightScale: number): void { const key = gridKey(id); const cell = this.cells.get(key) ?? { solid: false, weightScale: 1 }; cell.weightScale = weightScale; this.cells.set(key, cell); }
  get_point_weight_scale(id: Readonly<Vector2>): number { return this.cells.get(gridKey(id))?.weightScale ?? 1; }
  fill_solid_region(region: Readonly<{ position: Vector2; size: Vector2 }>, solid = true): void { this.visitRegion(region, (id) => this.set_point_solid(id, solid)); }
  fill_weight_scale_region(region: Readonly<{ position: Vector2; size: Vector2 }>, weightScale: number): void { this.visitRegion(region, (id) => this.set_point_weight_scale(id, weightScale)); }

  private visitRegion(region: Readonly<{ position: Vector2; size: Vector2 }>, visitor: (id: Vector2) => void): void {
    for (let y = region.position.y; y < region.position.y + region.size.y; y += 1) for (let x = region.position.x; x < region.position.x + region.size.x; x += 1) if (this.is_in_bounds(x, y)) visitor(vec2(x, y));
  }

  get_point_position(id: Readonly<Vector2>): Vector2 {
    if (this.cellShape === GODOT_ASTAR_GRID_CELL_SHAPE_ISOMETRIC_RIGHT) return vec2(this.offset.x + (id.x - id.y) * this.cellSize.x * 0.5, this.offset.y + (id.x + id.y) * this.cellSize.y * 0.5);
    if (this.cellShape === GODOT_ASTAR_GRID_CELL_SHAPE_ISOMETRIC_DOWN) return vec2(this.offset.x + (id.x + id.y) * this.cellSize.x * 0.5, this.offset.y + (id.y - id.x) * this.cellSize.y * 0.5);
    return vec2(this.offset.x + id.x * this.cellSize.x, this.offset.y + id.y * this.cellSize.y);
  }

  private neighbors(id: Vector2): Vector2[] {
    const cardinal = [vec2(id.x + 1, id.y), vec2(id.x - 1, id.y), vec2(id.x, id.y + 1), vec2(id.x, id.y - 1)];
    const result = cardinal.filter((candidate) => this.is_in_boundsv(candidate) && !this.is_point_solid(candidate));
    if (this.diagonalMode === GODOT_ASTAR_GRID_DIAGONAL_MODE_NEVER) return result;
    for (const diagonal of [vec2(1, 1), vec2(1, -1), vec2(-1, 1), vec2(-1, -1)]) {
      const candidate = vec2(id.x + diagonal.x, id.y + diagonal.y);
      if (!this.is_in_boundsv(candidate) || this.is_point_solid(candidate)) continue;
      const horizontalOpen = !this.is_point_solid(vec2(id.x + diagonal.x, id.y));
      const verticalOpen = !this.is_point_solid(vec2(id.x, id.y + diagonal.y));
      if (this.diagonalMode === GODOT_ASTAR_GRID_DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES && !(horizontalOpen && verticalOpen)) continue;
      if (this.diagonalMode === GODOT_ASTAR_GRID_DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE && !(horizontalOpen || verticalOpen)) continue;
      result.push(candidate);
    }
    return result;
  }

  get_id_path(fromId: Readonly<Vector2>, toId: Readonly<Vector2>, allowPartialPath = false): Vector2[] {
    if (!this.is_in_boundsv(fromId) || !this.is_in_boundsv(toId) || this.is_point_solid(fromId)) return [];
    const start = gridKey(fromId); const target = gridKey(toId); const open = new Set([start]);
    const previous = new Map<string, string>(); const cost = new Map<string, number>([[start, 0]]); const score = new Map<string, number>([[start, vector2Ops.distance(fromId, toId)]]);
    let nearest = start; let nearestDistance = vector2Ops.distance(fromId, toId);
    while (open.size) {
      let current = ''; let best = Infinity;
      for (const key of open) { const value = score.get(key) ?? Infinity; if (value < best) { current = key; best = value; } }
      if (current === target) { nearest = current; break; }
      open.delete(current); const id = parseGridKey(current);
      for (const neighbor of this.neighbors(id)) {
        const key = gridKey(neighbor); const nextCost = (cost.get(current) ?? Infinity) + vector2Ops.distance(id, neighbor) * this.get_point_weight_scale(neighbor);
        if (nextCost >= (cost.get(key) ?? Infinity)) continue;
        previous.set(key, current); cost.set(key, nextCost); const remaining = vector2Ops.distance(neighbor, toId); score.set(key, nextCost + remaining); open.add(key);
        if (remaining < nearestDistance) { nearest = key; nearestDistance = remaining; }
      }
    }
    if (nearest !== target && !allowPartialPath) return [];
    const path = [nearest];
    while (path[0] !== start) {
      const head = path[0];
      if (head === undefined) return [];
      const parent = previous.get(head);
      if (!parent) return [];
      path.unshift(parent);
    }
    return path.map(parseGridKey);
  }

  get_point_path(fromId: Readonly<Vector2>, toId: Readonly<Vector2>, allowPartialPath = false): Vector2[] { return this.get_id_path(fromId, toId, allowPartialPath).map((id) => this.get_point_position(id)); }
}

export const createGodotAStar2D = (): GodotAStar2D => new GodotAStar2D();
export const createGodotAStar3D = (): GodotAStar3D => new GodotAStar3D();
export const createGodotAStarGrid2D = (): GodotAStarGrid2D => new GodotAStarGrid2D();
