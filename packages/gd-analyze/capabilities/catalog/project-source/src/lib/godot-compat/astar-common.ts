/** Shared storage and search protocol for Godot's AStar2D/AStar3D classes.
 *
 * Ported from pinned Godot 4.7 `core/math/a_star.cpp`: connections are directed adjacency
 * entries, point weights multiply the edge cost on arrival, disabled points do not participate,
 * and a partial path ends at the visited point with the smallest heuristic distance to the goal.
 */

export interface AStarPoint<V> {
  readonly id: number;
  position: V;
  weightScale: number;
  disabled: boolean;
  readonly neighbours: Map<number, boolean>;
}

export interface AStarMetric<V> {
  zero(): V;
  copy(value: Readonly<V>): V;
  distance(left: Readonly<V>, right: Readonly<V>): number;
  closestOnSegment(point: Readonly<V>, from: Readonly<V>, to: Readonly<V>): V;
}

export interface GodotAStarGraph<V> {
  neighbor_filter_enabled: boolean;
  _filter_neighbor(from_id: number, neighbor_id: number): boolean;
  _compute_cost(from_id: number, to_id: number): number;
  _estimate_cost(from_id: number, to_id: number): number;
  add_point(id: number, position: V, weight_scale?: number): void;
  get_point_position(id: number): V;
  set_point_position(id: number, position: V): void;
  get_point_weight_scale(id: number): number;
  set_point_weight_scale(id: number, weight_scale: number): void;
  remove_point(id: number): void;
  has_point(id: number): boolean;
  get_point_connections(id: number): number[];
  get_point_ids(): number[];
  get_point_count(): number;
  reserve_space(capacity: number): void;
  get_point_capacity(): number;
  set_neighbor_filter_enabled(enabled: boolean): void;
  is_neighbor_filter_enabled(): boolean;
  connect_points(id: number, to_id: number, bidirectional?: boolean): void;
  disconnect_points(id: number, to_id: number, bidirectional?: boolean): void;
  are_points_connected(id: number, to_id: number, bidirectional?: boolean): boolean;
  get_available_point_id(): number;
  set_point_disabled(id: number, disabled?: boolean): void;
  is_point_disabled(id: number): boolean;
  get_closest_point(position: V, include_disabled?: boolean): number;
  get_closest_position_in_segment(position: V): V;
  get_id_path(from_id: number, to_id: number, allow_partial_path?: boolean): number[];
  get_point_path(from_id: number, to_id: number, allow_partial_path?: boolean): V[];
  clear(): void;
}

const asId = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`AStar point id must be a non-negative integer; received ${String(value)}`);
  }
  return value;
};

const asWeight = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`AStar weight_scale must be finite and non-negative; received ${String(value)}`);
  }
  return value;
};

export function createGodotAStarGraph<V>(metric: AStarMetric<V>): GodotAStarGraph<V> {
  const points = new Map<number, AStarPoint<V>>();
  let api: GodotAStarGraph<V>;
  let neighbourFilterEnabled = false;
  let reservedCapacity = 0;
  let lastFreeId = 0;

  const point = (rawId: number): AStarPoint<V> => {
    const id = asId(rawId);
    const found = points.get(id);
    if (found === undefined) throw new Error(`AStar has no point with id ${id}`);
    return found;
  };

  const connectOneWay = (from: AStarPoint<V>, to: AStarPoint<V>): void => {
    from.neighbours.set(to.id, true);
  };

  const disconnectOneWay = (from: AStarPoint<V>, to: AStarPoint<V>): void => {
    from.neighbours.delete(to.id);
  };

  const idPath = (rawFrom: number, rawTo: number, allowPartial: boolean): number[] => {
    const from = point(rawFrom);
    const target = point(rawTo);
    if (from.disabled || from.id === target.id) {
      return from.id === target.id && !from.disabled ? [from.id] : [];
    }

    const open = new Set<number>([from.id]);
    const closed = new Set<number>();
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[from.id, 0]]);
    const fScore = new Map<number, number>([[from.id, api._estimate_cost(from.id, target.id)]]);
    let closest = from.id;
    let closestEstimate = api._estimate_cost(from.id, target.id);
    let closestCost = 0;

    while (open.size > 0) {
      let currentId = -1;
      let currentScore = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
        if (score < currentScore || (score === currentScore && candidate < currentId)) {
          currentId = candidate;
          currentScore = score;
        }
      }
      if (currentId === target.id) {
        closest = target.id;
        break;
      }
      open.delete(currentId);
      closed.add(currentId);
      const current = point(currentId);

      for (const neighbourId of current.neighbours.keys()) {
        const neighbour = points.get(neighbourId);
        if (neighbour === undefined || neighbour.disabled || closed.has(neighbourId)) continue;
        if (neighbourFilterEnabled && api._filter_neighbor(current.id, neighbour.id)) continue;
        const tentative =
          (gScore.get(currentId) ?? Number.POSITIVE_INFINITY) +
          api._compute_cost(current.id, neighbour.id) * neighbour.weightScale;
        if (tentative >= (gScore.get(neighbourId) ?? Number.POSITIVE_INFINITY)) continue;
        cameFrom.set(neighbourId, currentId);
        gScore.set(neighbourId, tentative);
        const estimate = api._estimate_cost(neighbour.id, target.id);
        fScore.set(neighbourId, tentative + estimate);
        open.add(neighbourId);
        if (estimate < closestEstimate || (estimate === closestEstimate && tentative < closestCost)) {
          closestEstimate = estimate;
          closestCost = tentative;
          closest = neighbourId;
        }
      }
    }

    if (closest !== target.id && !allowPartial) return [];
    if (closest === from.id && !cameFrom.has(closest)) return allowPartial ? [from.id] : [];
    const result = [closest];
    while (result[0] !== from.id) {
      const previous = cameFrom.get(result[0] as number);
      if (previous === undefined) return [];
      result.unshift(previous);
    }
    return result;
  };

  api = {
    get neighbor_filter_enabled() {
      return neighbourFilterEnabled;
    },
    set neighbor_filter_enabled(enabled) {
      neighbourFilterEnabled = enabled;
    },
    _filter_neighbor() {
      return false;
    },
    _compute_cost(fromId, toId) {
      return metric.distance(point(fromId).position, point(toId).position);
    },
    _estimate_cost(fromId, toId) {
      return metric.distance(point(fromId).position, point(toId).position);
    },
    add_point(rawId, position, weightScale = 1) {
      const id = asId(rawId);
      const existing = points.get(id);
      if (existing !== undefined) {
        existing.position = metric.copy(position);
        existing.weightScale = asWeight(weightScale);
        return;
      }
      points.set(id, {
        id,
        position: metric.copy(position),
        weightScale: asWeight(weightScale),
        disabled: false,
        neighbours: new Map(),
      });
      if (id === lastFreeId) {
        while (points.has(lastFreeId)) lastFreeId += 1;
      }
    },
    get_point_position(id) {
      return metric.copy(point(id).position);
    },
    set_point_position(id, position) {
      point(id).position = metric.copy(position);
    },
    get_point_weight_scale(id) {
      return point(id).weightScale;
    },
    set_point_weight_scale(id, weightScale) {
      point(id).weightScale = asWeight(weightScale);
    },
    remove_point(id) {
      const removed = point(id);
      points.delete(removed.id);
      lastFreeId = removed.id;
      for (const other of points.values()) other.neighbours.delete(removed.id);
    },
    has_point(id) {
      return points.has(asId(id));
    },
    get_point_connections(id) {
      return [...point(id).neighbours.keys()];
    },
    get_point_ids() {
      return [...points.keys()];
    },
    get_point_count() {
      return points.size;
    },
    reserve_space(capacity) {
      if (!Number.isSafeInteger(capacity) || capacity <= 0) {
        throw new Error(
          `AStar.reserve_space capacity must be a positive integer; received ${String(capacity)}`,
        );
      }
      reservedCapacity = Math.max(reservedCapacity, capacity);
    },
    get_point_capacity() {
      return Math.max(points.size, reservedCapacity);
    },
    set_neighbor_filter_enabled(enabled) {
      neighbourFilterEnabled = enabled;
    },
    is_neighbor_filter_enabled() {
      return neighbourFilterEnabled;
    },
    connect_points(id, toId, bidirectional = true) {
      const from = point(id);
      const to = point(toId);
      if (from.id === to.id) throw new Error('AStar cannot connect a point to itself');
      connectOneWay(from, to);
      if (bidirectional) connectOneWay(to, from);
    },
    disconnect_points(id, toId, bidirectional = true) {
      const from = point(id);
      const to = point(toId);
      disconnectOneWay(from, to);
      if (bidirectional) disconnectOneWay(to, from);
    },
    are_points_connected(id, toId, bidirectional = true) {
      const from = point(id);
      const to = point(toId);
      return bidirectional
        ? from.neighbours.has(to.id) || to.neighbours.has(from.id)
        : from.neighbours.has(to.id);
    },
    get_available_point_id() {
      return lastFreeId;
    },
    set_point_disabled(id, disabled = true) {
      point(id).disabled = disabled;
    },
    is_point_disabled(id) {
      return point(id).disabled;
    },
    get_closest_point(position, includeDisabled = false) {
      let closest = -1;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of points.values()) {
        if (candidate.disabled && !includeDisabled) continue;
        const distance = metric.distance(position, candidate.position);
        if (distance < closestDistance || (distance === closestDistance && candidate.id < closest)) {
          closestDistance = distance;
          closest = candidate.id;
        }
      }
      return closest;
    },
    get_closest_position_in_segment(position) {
      let closest = metric.zero();
      let closestDistance = Number.POSITIVE_INFINITY;
      const visited = new Set<string>();
      for (const from of points.values()) {
        if (from.disabled) continue;
        for (const toId of from.neighbours.keys()) {
          const to = points.get(toId);
          if (to === undefined || to.disabled) continue;
          const key = from.id < to.id ? `${from.id}:${to.id}` : `${to.id}:${from.id}`;
          if (visited.has(key)) continue;
          visited.add(key);
          const candidate = metric.closestOnSegment(position, from.position, to.position);
          const distance = metric.distance(position, candidate);
          if (distance < closestDistance) {
            closestDistance = distance;
            closest = candidate;
          }
        }
      }
      return closest;
    },
    get_id_path(fromId, toId, allowPartialPath = false) {
      return idPath(fromId, toId, allowPartialPath);
    },
    get_point_path(fromId, toId, allowPartialPath = false) {
      return idPath(fromId, toId, allowPartialPath).map((id) => metric.copy(point(id).position));
    },
    clear() {
      points.clear();
      reservedCapacity = 0;
      lastFreeId = 0;
    },
  };
  return api;
}
