/** Godot 4.7 AStarGrid2D protocol, ported from `core/math/a_star_grid_2d.cpp`. */

import { createGodotAStarGraph, type GodotAStarGraph } from './astar-common';
import { godotRect2iNew, type GodotRect2i } from './rect2';
import { copyVector2, type Vector2, vec2 } from './vector2';
import { registerGodotObjectIdentity } from './object';
import { type GodotDictionary, godotDictionary } from './variant';

export interface Vector2i {
  x: number;
  y: number;
}

export interface Rect2i {
  position: Vector2i;
  size: Vector2i;
}

const exportedRegion = (region: Readonly<Rect2i>): GodotRect2i =>
  godotRect2iNew(region.position, region.size);

export const ASTAR_GRID_CELL_SHAPE = Object.freeze({
  CELL_SHAPE_SQUARE: 0,
  CELL_SHAPE_ISOMETRIC_RIGHT: 1,
  CELL_SHAPE_ISOMETRIC_DOWN: 2,
});
export const ASTAR_GRID_HEURISTIC = Object.freeze({
  HEURISTIC_EUCLIDEAN: 0,
  HEURISTIC_MANHATTAN: 1,
  HEURISTIC_OCTILE: 2,
  HEURISTIC_CHEBYSHEV: 3,
});
export const ASTAR_GRID_DIAGONAL_MODE = Object.freeze({
  DIAGONAL_MODE_ALWAYS: 0,
  DIAGONAL_MODE_NEVER: 1,
  DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE: 2,
  DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES: 3,
});

export interface GodotAStarGrid2D {
  _compute_cost(from_id: Vector2i, to_id: Vector2i): number;
  _estimate_cost(from_id: Vector2i, end_id: Vector2i): number;
  region: Rect2i;
  size: Vector2i;
  offset: Vector2;
  cell_size: Vector2;
  cell_shape: number;
  jumping_enabled: boolean;
  diagonal_mode: number;
  default_compute_heuristic: number;
  default_estimate_heuristic: number;
  update(): void;
  set_region(region: Rect2i): void;
  get_region(): Rect2i;
  set_size(size: Vector2i): void;
  get_size(): Vector2i;
  set_offset(offset: Vector2): void;
  get_offset(): Vector2;
  set_cell_size(cell_size: Vector2): void;
  get_cell_size(): Vector2;
  set_cell_shape(cell_shape: number): void;
  get_cell_shape(): number;
  set_jumping_enabled(enabled: boolean): void;
  is_jumping_enabled(): boolean;
  set_diagonal_mode(mode: number): void;
  get_diagonal_mode(): number;
  set_default_compute_heuristic(heuristic: number): void;
  get_default_compute_heuristic(): number;
  set_default_estimate_heuristic(heuristic: number): void;
  get_default_estimate_heuristic(): number;
  is_dirty(): boolean;
  clear(): void;
  set_point_solid(id: Vector2i, solid?: boolean): void;
  is_point_solid(id: Vector2i): boolean;
  set_point_weight_scale(id: Vector2i, weight_scale: number): void;
  get_point_weight_scale(id: Vector2i): number;
  fill_solid_region(region: Rect2i, solid?: boolean): void;
  fill_weight_scale_region(region: Rect2i, weight_scale: number): void;
  get_point_position(id: Vector2i): Vector2;
  get_point_data_in_region(region: Rect2i): Array<GodotDictionary<string, unknown>>;
  get_point_path(from_id: Vector2i, to_id: Vector2i, allow_partial_path?: boolean): Vector2[];
  get_id_path(from_id: Vector2i, to_id: Vector2i, allow_partial_path?: boolean): Vector2i[];
  is_in_bounds(x: number, y: number): boolean;
  is_in_boundsv(id: Vector2i): boolean;
}

const int = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`AStarGrid2D ${label} must be an integer`);
  return value;
};
const enumValue = (value: number, label: string, maximumExclusive: number): number => {
  const parsed = int(value, label);
  if (parsed < 0 || parsed >= maximumExclusive) {
    throw new Error(`AStarGrid2D ${label} is outside its enum domain: ${parsed}`);
  }
  return parsed;
};
const copyId = (id: Readonly<Vector2i>): Vector2i => ({ x: id.x, y: id.y });
const key = (id: Readonly<Vector2i>): string => `${id.x},${id.y}`;

export function createGodotAStarGrid2D(): GodotAStarGrid2D {
  let region: Rect2i = { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
  let offset = vec2();
  let cellSize = vec2(1, 1);
  let cellShape: number = ASTAR_GRID_CELL_SHAPE.CELL_SHAPE_SQUARE;
  let jumpingEnabled = false;
  let diagonalMode: number = ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ALWAYS;
  let computeHeuristic: number = ASTAR_GRID_HEURISTIC.HEURISTIC_EUCLIDEAN;
  let estimateHeuristic: number = ASTAR_GRID_HEURISTIC.HEURISTIC_EUCLIDEAN;
  let dirty = true;
  let graph: GodotAStarGraph<Vector2i> | undefined;
  const solids = new Set<string>();
  const weights = new Map<string, number>();
  let ids: Vector2i[] = [];
  let idNumbers = new Map<string, number>();
  let api: GodotAStarGrid2D;

  const inBounds = (id: Readonly<Vector2i>): boolean =>
    id.x >= region.position.x &&
    id.y >= region.position.y &&
    id.x < region.position.x + region.size.x &&
    id.y < region.position.y + region.size.y;

  const requireId = (id: Readonly<Vector2i>): Vector2i => {
    const candidate = { x: int(id.x, 'point x'), y: int(id.y, 'point y') };
    if (!inBounds(candidate)) {
      throw new Error(`AStarGrid2D point (${candidate.x}, ${candidate.y}) is outside region`);
    }
    return candidate;
  };

  const requireGraph = (): GodotAStarGraph<Vector2i> => {
    if (dirty || graph === undefined) throw new Error('AStarGrid2D.update() is required after changing its region');
    return graph;
  };

  const walkable = (x: number, y: number): boolean => inBounds({ x, y }) && !solids.has(`${x},${y}`);

  const canStep = (from: Readonly<Vector2i>, dx: number, dy: number): boolean => {
    const x = from.x + dx;
    const y = from.y + dy;
    if (!walkable(x, y)) return false;
    if (dx === 0 || dy === 0) return true;
    if (diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_NEVER) return false;
    if (diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ALWAYS) return true;
    const horizontal = walkable(from.x + dx, from.y);
    const vertical = walkable(from.x, from.y + dy);
    return diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE
      ? horizontal || vertical
      : horizontal && vertical;
  };

  /** Direct TypeScript port of Godot 4.7 `AStarGrid2D::_forced_successor`/`_jump`. In particular,
   * NEVER scans vertical and horizontal successors differently, while ONLY_IF_NO_OBSTACLES starts
   * straight scans inclusively; replacing these with generic JPS changes returned jump points. */
  const forcedSuccessor = (
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    goal: Readonly<Vector2i>,
    inclusive = false,
  ): Vector2i | undefined => {
    let leftPrevious = false;
    let rightPrevious = false;
    let left = false;
    let right = false;
    let x = startX + (inclusive ? dx : 0);
    let y = startY + (inclusive ? dy : 0);
    let leftX = startX - dy;
    let leftY = startY - dx;
    let rightX = startX + dy;
    let rightY = startY + dx;
    while (walkable(x, y)) {
      if (x === goal.x && y === goal.y) return { x, y };
      leftPrevious = left || walkable(leftX, leftY);
      rightPrevious = right || walkable(rightX, rightY);
      leftX += dx; leftY += dy;
      rightX += dx; rightY += dy;
      left = walkable(leftX, leftY);
      right = walkable(rightX, rightY);
      if ((left && !leftPrevious) || (right && !rightPrevious)) return { x, y };
      x += dx; y += dy;
    }
    return undefined;
  };

  const jump = (
    from: Readonly<Vector2i>,
    dx: number,
    dy: number,
    goal: Readonly<Vector2i>,
  ): Vector2i | undefined => {
    let x = from.x + dx;
    let y = from.y + dy;
    if (
      diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ALWAYS ||
      diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE
    ) {
      if (dx === 0 || dy === 0) return forcedSuccessor(x, y, dx, dy, goal);
      while (
        walkable(x, y) &&
        (
          diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ALWAYS ||
          walkable(x, y - dy) || walkable(x - dx, y)
        )
      ) {
        if (x === goal.x && y === goal.y) return { x, y };
        if (
          (walkable(x - dx, y + dy) && !walkable(x - dx, y)) ||
          (walkable(x + dx, y - dy) && !walkable(x, y - dy))
        ) return { x, y };
        if (
          forcedSuccessor(x + dx, y, dx, 0, goal) !== undefined ||
          forcedSuccessor(x, y + dy, 0, dy, goal) !== undefined
        ) return { x, y };
        x += dx; y += dy;
      }
      return undefined;
    }
    if (diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES) {
      if (dx === 0 || dy === 0) return forcedSuccessor(from.x, from.y, dx, dy, goal, true);
      while (walkable(x, y) && walkable(x, y - dy) && walkable(x - dx, y)) {
        if (x === goal.x && y === goal.y) return { x, y };
        if (
          (walkable(x + dx, y + dy) && !walkable(x, y + dy)) ||
          !walkable(x + dx, y)
        ) return { x, y };
        if (
          forcedSuccessor(x, y, dx, 0, goal) !== undefined ||
          forcedSuccessor(x, y, 0, dy, goal) !== undefined
        ) return { x, y };
        x += dx; y += dy;
      }
      return undefined;
    }
    if (dy === 0) return forcedSuccessor(from.x, from.y, dx, 0, goal, true);
    while (walkable(x, y)) {
      if (x === goal.x && y === goal.y) return { x, y };
      if (
        (walkable(x - 1, y) && !walkable(x - 1, y - dy)) ||
        (walkable(x + 1, y) && !walkable(x + 1, y - dy))
      ) return { x, y };
      if (
        forcedSuccessor(x, y, 1, 0, goal, true) !== undefined ||
        forcedSuccessor(x, y, -1, 0, goal, true) !== undefined
      ) return { x, y };
      y += dy;
    }
    return undefined;
  };

  const jumpDirections = (
    point: Readonly<Vector2i>,
    parent: Readonly<Vector2i> | undefined,
  ): readonly (readonly [number, number])[] => {
    if (parent === undefined) {
      const all = [
        [0, -1], [1, 0], [0, 1], [-1, 0],
        [-1, -1], [1, -1], [1, 1], [-1, 1],
      ] as const;
      return all.filter(([dx, dy]) => canStep(point, dx, dy));
    }
    const dx = Math.sign(point.x - parent.x);
    const dy = Math.sign(point.y - parent.y);
    const result: Array<readonly [number, number]> = [];
    const add = (nextX: number, nextY: number): void => {
      if (canStep(point, nextX, nextY) && !result.some(([x, y]) => x === nextX && y === nextY)) {
        result.push([nextX, nextY]);
      }
    };
    if (dx !== 0 && dy !== 0) {
      add(dx, dy); add(dx, 0); add(0, dy);
      if (!walkable(point.x - dx, point.y)) add(-dx, dy);
      if (!walkable(point.x, point.y - dy)) add(dx, -dy);
    } else if (dx !== 0) {
      add(dx, 0);
      if (!walkable(point.x, point.y + 1)) add(dx, 1);
      if (!walkable(point.x, point.y - 1)) add(dx, -1);
    } else {
      add(0, dy);
      if (!walkable(point.x + 1, point.y)) add(1, dy);
      if (!walkable(point.x - 1, point.y)) add(-1, dy);
    }
    return result;
  };

  const jumpPath = (
    rawFrom: Readonly<Vector2i>,
    rawTo: Readonly<Vector2i>,
    allowPartial: boolean,
  ): Vector2i[] => {
    requireGraph();
    const from = requireId(rawFrom);
    const to = requireId(rawTo);
    if (solids.has(key(from))) return [];
    if (from.x === to.x && from.y === to.y) return [copyId(from)];
    const open = new Map<string, { point: Vector2i; score: number }>();
    const parents = new Map<string, Vector2i>();
    const costs = new Map<string, number>([[key(from), 0]]);
    const closed = new Set<string>();
    let closest = from;
    let closestEstimate = api._estimate_cost(from, to);
    open.set(key(from), { point: from, score: closestEstimate });
    while (open.size > 0) {
      let currentEntry: { point: Vector2i; score: number } | undefined;
      let currentKey = '';
      for (const [candidateKey, candidate] of open) {
        if (
          currentEntry === undefined || candidate.score < currentEntry.score ||
          (
            candidate.score === currentEntry.score &&
            (costs.get(candidateKey) ?? 0) > (costs.get(currentKey) ?? 0)
          )
        ) {
          currentEntry = candidate;
          currentKey = candidateKey;
        }
      }
      if (currentEntry === undefined) break;
      open.delete(currentKey);
      const current = currentEntry.point;
      if (current.x === to.x && current.y === to.y) { closest = current; break; }
      closed.add(currentKey);
      const currentCost = costs.get(currentKey) ?? 0;
      const currentEstimate = api._estimate_cost(current, to);
      if (
        currentEstimate < closestEstimate ||
        (currentEstimate === closestEstimate && currentCost < (costs.get(key(closest)) ?? Number.POSITIVE_INFINITY))
      ) {
        closest = current;
        closestEstimate = currentEstimate;
      }
      for (const [dx, dy] of jumpDirections(current, undefined)) {
        const next = jump(current, dx, dy, to);
        if (next === undefined || closed.has(key(next))) continue;
        const nextKey = key(next);
        const nextCost = currentCost + api._compute_cost(current, next);
        if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        parents.set(nextKey, current);
        costs.set(nextKey, nextCost);
        const estimate = api._estimate_cost(next, to);
        open.set(nextKey, { point: next, score: nextCost + estimate });
      }
    }
    if (closest.x !== to.x || closest.y !== to.y) {
      if (!allowPartial) return [];
    }
    const result = [copyId(closest)];
    let cursor = closest;
    while (cursor.x !== from.x || cursor.y !== from.y) {
      const parent = parents.get(key(cursor));
      if (parent === undefined) return [];
      result.push(copyId(parent));
      cursor = parent;
    }
    result.reverse();
    return result;
  };

  const heuristic = (mode: number, a: Readonly<Vector2i>, b: Readonly<Vector2i>): number => {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    switch (mode) {
      case ASTAR_GRID_HEURISTIC.HEURISTIC_EUCLIDEAN:
        return Math.hypot(dx, dy);
      case ASTAR_GRID_HEURISTIC.HEURISTIC_MANHATTAN:
        return dx + dy;
      case ASTAR_GRID_HEURISTIC.HEURISTIC_OCTILE:
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
      case ASTAR_GRID_HEURISTIC.HEURISTIC_CHEBYSHEV:
        return Math.max(dx, dy);
      default:
        throw new Error(`AStarGrid2D has invalid heuristic ${mode}`);
    }
  };

  const pointPosition = (id: Readonly<Vector2i>): Vector2 => {
    const { x, y } = id;
    switch (cellShape) {
      case ASTAR_GRID_CELL_SHAPE.CELL_SHAPE_SQUARE:
        return vec2(offset.x + x * cellSize.x, offset.y + y * cellSize.y);
      case ASTAR_GRID_CELL_SHAPE.CELL_SHAPE_ISOMETRIC_RIGHT:
        return vec2(
          offset.x + cellSize.x * 0.5 + (x + y) * cellSize.x * 0.5,
          offset.y + cellSize.y * 0.5 + (y - x) * cellSize.y * 0.5,
        );
      case ASTAR_GRID_CELL_SHAPE.CELL_SHAPE_ISOMETRIC_DOWN:
        return vec2(
          offset.x + cellSize.x * 0.5 + (x - y) * cellSize.x * 0.5,
          offset.y + cellSize.y * 0.5 + (x + y) * cellSize.y * 0.5,
        );
      default:
        throw new Error(`AStarGrid2D has invalid cell_shape ${cellShape}`);
    }
  };

  const rebuild = (resetPointData = true): void => {
    if (region.size.x < 0 || region.size.y < 0) throw new Error('AStarGrid2D region size cannot be negative');
    // Godot's update() reallocates the point array. Solidity and weight data belong to that
    // allocation and are intentionally reset whenever a dirty grid is rebuilt.
    if (resetPointData) {
      solids.clear();
      weights.clear();
    }
    ids = [];
    idNumbers = new Map();
    graph = createGodotAStarGraph<Vector2i>({
      zero: () => ({ x: 0, y: 0 }),
      copy: copyId,
      distance: (a, b) => heuristic(computeHeuristic, a, b),
      closestOnSegment: (point, from, to) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const squared = dx * dx + dy * dy;
        if (squared === 0) return copyId(from);
        const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared));
        return { x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) };
      },
    });
    for (let y = region.position.y; y < region.position.y + region.size.y; y += 1) {
      for (let x = region.position.x; x < region.position.x + region.size.x; x += 1) {
        const id = { x, y };
        const numericId = ids.length;
        ids.push(id);
        idNumbers.set(key(id), numericId);
        graph.add_point(numericId, id, weights.get(key(id)) ?? 1);
        graph.set_point_disabled(numericId, solids.has(key(id)));
      }
    }
    graph._compute_cost = (from, to) => api._compute_cost(ids[from] as Vector2i, ids[to] as Vector2i);
    graph._estimate_cost = (from, to) => api._estimate_cost(ids[from] as Vector2i, ids[to] as Vector2i);
    graph._filter_neighbor = (from, to) => {
      const fromId = ids[from] as Vector2i;
      const toId = ids[to] as Vector2i;
      const dx = toId.x - fromId.x;
      const dy = toId.y - fromId.y;
      if (dx === 0 || dy === 0 || diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_ALWAYS) {
        return false;
      }
      if (diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_NEVER) return true;
      const sideA = solids.has(`${fromId.x + dx},${fromId.y}`);
      const sideB = solids.has(`${fromId.x},${fromId.y + dy}`);
      return diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_AT_LEAST_ONE_WALKABLE
        ? sideA && sideB
        : sideA || sideB;
    };
    graph.set_neighbor_filter_enabled(true);
    const cardinals = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    for (const id of ids) {
      const from = idNumbers.get(key(id)) as number;
      for (const [dx, dy] of cardinals) {
        const to = idNumbers.get(`${id.x + dx},${id.y + dy}`);
        if (to !== undefined) graph.connect_points(from, to, false);
      }
      if (diagonalMode === ASTAR_GRID_DIAGONAL_MODE.DIAGONAL_MODE_NEVER) continue;
      for (const [dx, dy] of diagonals) {
        const toId = { x: id.x + dx, y: id.y + dy };
        const to = idNumbers.get(key(toId));
        if (to === undefined) continue;
        graph.connect_points(from, to, false);
      }
    }
    dirty = false;
  };

  const setRegion = (value: Rect2i): void => {
    const position = {
      x: int(value.position.x, 'region position x'),
      y: int(value.position.y, 'region position y'),
    };
    const size = { x: int(value.size.x, 'region size x'), y: int(value.size.y, 'region size y') };
    if (size.x < 0 || size.y < 0) throw new Error('AStarGrid2D region size cannot be negative');
    if (
      position.x === region.position.x &&
      position.y === region.position.y &&
      size.x === region.size.x &&
      size.y === region.size.y
    ) return;
    region = { position, size };
    dirty = true;
  };

  const setOffset = (value: Vector2): void => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
      throw new Error('AStarGrid2D.offset must have finite components');
    }
    if (offset.x === value.x && offset.y === value.y) return;
    offset = copyVector2(value);
    dirty = true;
  };
  const setCellSize = (value: Vector2): void => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x <= 0 || value.y <= 0) {
      throw new Error('AStarGrid2D.cell_size components must be finite and greater than zero');
    }
    if (cellSize.x === value.x && cellSize.y === value.y) return;
    cellSize = copyVector2(value);
    dirty = true;
  };
  const setJumping = (value: boolean): void => {
    if (typeof value !== 'boolean') throw new TypeError('AStarGrid2D.jumping_enabled requires bool');
    jumpingEnabled = value;
  };

  api = {
    _compute_cost(from, to) { return heuristic(computeHeuristic, from, to); },
    _estimate_cost(from, to) { return heuristic(estimateHeuristic, from, to); },
    // ClassDB exposes a real Rect2i Variant, including its derived `end` property. Returning the
    // internal `{ position, size }` storage leaks an incomplete carrier into Rect2i methods.
    get region() { return exportedRegion(region); },
    set region(value) { setRegion(value); },
    get size() { return copyId(region.size); },
    set size(value) { setRegion({ position: region.position, size: value }); },
    get offset() { return copyVector2(offset); },
    set offset(value) { setOffset(value); },
    get cell_size() { return copyVector2(cellSize); },
    set cell_size(value) { setCellSize(value); },
    get cell_shape() { return cellShape; },
    set cell_shape(value) { const next = enumValue(value, 'cell_shape', 3); if (next !== cellShape) { cellShape = next; dirty = true; } },
    get jumping_enabled() { return jumpingEnabled; },
    set jumping_enabled(value) { setJumping(value); },
    get diagonal_mode() { return diagonalMode; },
    set diagonal_mode(value) { diagonalMode = enumValue(value, 'diagonal_mode', 4); },
    get default_compute_heuristic() { return computeHeuristic; },
    set default_compute_heuristic(value) { computeHeuristic = enumValue(value, 'compute heuristic', 4); },
    get default_estimate_heuristic() { return estimateHeuristic; },
    set default_estimate_heuristic(value) { estimateHeuristic = enumValue(value, 'estimate heuristic', 4); },
    update: () => rebuild(true),
    set_region: setRegion,
    get_region: () => exportedRegion(region),
    set_size: (size) => setRegion({ position: region.position, size }),
    get_size: () => copyId(region.size),
    set_offset: setOffset,
    get_offset: () => copyVector2(offset),
    set_cell_size: setCellSize,
    get_cell_size: () => copyVector2(cellSize),
    set_cell_shape(value) { api.cell_shape = value; },
    get_cell_shape: () => cellShape,
    set_jumping_enabled: setJumping,
    is_jumping_enabled: () => jumpingEnabled,
    set_diagonal_mode(value) { api.diagonal_mode = value; },
    get_diagonal_mode: () => diagonalMode,
    set_default_compute_heuristic(value) { api.default_compute_heuristic = value; },
    get_default_compute_heuristic: () => computeHeuristic,
    set_default_estimate_heuristic(value) { api.default_estimate_heuristic = value; },
    get_default_estimate_heuristic: () => estimateHeuristic,
    is_dirty: () => dirty,
    clear() {
      const wasDirty = dirty;
      region = { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
      rebuild(true);
      dirty = wasDirty;
    },
    set_point_solid(raw, solid = true) { const active = requireGraph(); const id = requireId(raw); solid ? solids.add(key(id)) : solids.delete(key(id)); active.set_point_disabled(idNumbers.get(key(id)) as number, solid); },
    is_point_solid(raw) { requireGraph(); return solids.has(key(requireId(raw))); },
    set_point_weight_scale(raw, weight) { const active = requireGraph(); if (!Number.isFinite(weight) || weight < 0) throw new Error('AStarGrid2D weight_scale must be non-negative'); const id = requireId(raw); weights.set(key(id), weight); active.set_point_weight_scale(idNumbers.get(key(id)) as number, weight); },
    get_point_weight_scale(raw) { requireGraph(); return weights.get(key(requireId(raw))) ?? 1; },
    fill_solid_region(area, solid = true) { for (let y = area.position.y; y < area.position.y + area.size.y; y += 1) for (let x = area.position.x; x < area.position.x + area.size.x; x += 1) if (inBounds({ x, y })) this.set_point_solid({ x, y }, solid); },
    fill_weight_scale_region(area, weight) { for (let y = area.position.y; y < area.position.y + area.size.y; y += 1) for (let x = area.position.x; x < area.position.x + area.size.x; x += 1) if (inBounds({ x, y })) this.set_point_weight_scale({ x, y }, weight); },
    get_point_position(raw) { requireGraph(); return pointPosition(requireId(raw)); },
    get_point_data_in_region(area) {
      requireGraph();
      const result: Array<GodotDictionary<string, unknown>> = [];
      for (let y = area.position.y; y < area.position.y + area.size.y; y += 1) {
        for (let x = area.position.x; x < area.position.x + area.size.x; x += 1) {
          const id = { x, y };
          if (!inBounds(id)) continue;
          result.push(
            godotDictionary([
              ['id', id],
              ['position', pointPosition(id)],
              ['solid', solids.has(key(id))],
              ['weight_scale', weights.get(key(id)) ?? 1],
            ]),
          );
        }
      }
      return result;
    },
    get_id_path(from, to, partial = false) {
      if (jumpingEnabled) return jumpPath(from, to, partial);
      const active = requireGraph();
      const path = active.get_id_path(idNumbers.get(key(requireId(from))) as number, idNumbers.get(key(requireId(to))) as number, partial);
      return path.map((id) => copyId(ids[id] as Vector2i));
    },
    get_point_path(from, to, partial = false) { return this.get_id_path(from, to, partial).map(pointPosition); },
    is_in_bounds(x, y) { return inBounds({ x, y }); },
    is_in_boundsv(id) { return inBounds(id); },
  };
  registerGodotObjectIdentity(api, 'AStarGrid2D');
  return api;
}
