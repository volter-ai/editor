import { CubicBezierCurve3, Vector3 as ThreeVector3, type Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import { packedFloat32Array, packedVector3Array, type PackedFloat32Array, type PackedVector3Array } from './packed-array';
import { type Vector3, vec3, VECTOR3_UP, VECTOR3_ZERO } from './variant-3d';
import type { ColorValue } from './variant';

export interface Curve3DPoint {
  position: Vector3;
  inControl: Vector3;
  outControl: Vector3;
  tilt: number;
}

export interface GodotCurve3D {
  bake_interval: number;
  closed: boolean;
  up_vector_enabled: boolean;
  add_point(position: Vector3, inControl?: Vector3, outControl?: Vector3, index?: number): void;
  set_point_position(index: number, position: Vector3): void;
  get_point_position(index: number): Vector3;
  set_point_in(index: number, control: Vector3): void;
  get_point_in(index: number): Vector3;
  set_point_out(index: number, control: Vector3): void;
  get_point_out(index: number): Vector3;
  set_point_tilt(index: number, tilt: number): void;
  get_point_tilt(index: number): number;
  set_point_count(count: number): void;
  remove_point(index: number): void;
  clear_points(): void;
  get_point_count(): number;
  set_bake_interval(interval: number): void;
  get_bake_interval(): number;
  set_closed(closed: boolean): void;
  is_closed(): boolean;
  set_up_vector_enabled(enabled: boolean): void;
  is_up_vector_enabled(): boolean;
  sample(index: number, t: number): Vector3;
  interpolate(index: number, t: number): Vector3;
  samplef(fofs: number): Vector3;
  sample_baked(offset?: number, cubic?: boolean): Vector3;
  interpolate_baked(offset?: number, cubic?: boolean): Vector3;
  sample_baked_with_rotation(offset?: number, cubic?: boolean, applyTilt?: boolean): never;
  get_baked_length(): number;
  get_baked_points(): PackedVector3Array;
  get_baked_tilts(): PackedFloat32Array;
  get_baked_up_vectors(): PackedVector3Array;
  sample_baked_up_vector(offset?: number, applyTilt?: boolean): Vector3;
  get_closest_point(toPoint: Vector3): Vector3;
  get_closest_offset(toPoint: Vector3): number;
  tessellate(maxStages?: number, toleranceDegrees?: number): PackedVector3Array;
  tessellate_even_length(maxStages?: number, toleranceLength?: number): PackedVector3Array;
}

interface BakedCurve {
  readonly points: readonly Vector3[];
  readonly offsets: readonly number[];
  readonly tilts: readonly number[];
  readonly upVectors: readonly Vector3[];
  readonly length: number;
}

interface Curve3DState {
  readonly points: Curve3DPoint[];
  bakeInterval: number;
  closed: boolean;
  upVectorEnabled: boolean;
  baked: BakedCurve | undefined;
  readonly listeners: Set<() => void>;
}

const STATES = new WeakMap<object, Curve3DState>();

const copy = (value: Vector3): Vector3 => vec3(value.x, value.y, value.z);
const add = (a: Vector3, b: Vector3): Vector3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vector3, b: Vector3): Vector3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (value: Vector3, amount: number): Vector3 => vec3(value.x * amount, value.y * amount, value.z * amount);
const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const lengthSquared = (value: Vector3): number => dot(value, value);
const distance = (a: Vector3, b: Vector3): number => Math.sqrt(lengthSquared(sub(a, b)));
const lerp = (a: Vector3, b: Vector3, t: number): Vector3 => vec3(
  a.x + (b.x - a.x) * t,
  a.y + (b.y - a.y) * t,
  a.z + (b.z - a.z) * t,
);

function vector(value: Vector3, caller: string): Vector3 {
  if (value === null || typeof value !== 'object' ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    throw new TypeError(`Curve3D.${caller} requires a finite Vector3.`);
  }
  return copy(value);
}

function finite(value: number, caller: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Curve3D.${caller} requires a finite number.`);
  return value;
}

function stateOf(curve: GodotCurve3D): Curve3DState {
  const state = STATES.get(curve);
  if (state === undefined) throw new TypeError('Expected a Curve3D created by godot-compat.');
  return state;
}

function pointAt(state: Curve3DState, index: number, caller: string): Curve3DPoint {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.points.length) {
    throw new RangeError(`Curve3D.${caller} point index ${String(index)} is out of range.`);
  }
  return state.points[index]!;
}

function invalidate(curve: GodotCurve3D, state: Curve3DState): void {
  state.baked = undefined;
  for (const listener of state.listeners) listener();
}

function segmentCount(state: Curve3DState): number {
  if (state.points.length < 2) return 0;
  return state.closed ? state.points.length : state.points.length - 1;
}

function segmentPoints(state: Curve3DState, index: number): readonly [Curve3DPoint, Curve3DPoint] {
  const count = segmentCount(state);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`Curve3D sample segment ${String(index)} is out of range.`);
  }
  return [state.points[index]!, state.points[(index + 1) % state.points.length]!];
}

function sampleSegment(state: Curve3DState, index: number, t: number): Vector3 {
  if (state.points.length === 0) return VECTOR3_ZERO;
  if (index < 0) return copy(state.points[0]!.position);
  if (index >= segmentCount(state)) return copy(state.points[state.points.length - 1]!.position);
  const [a, b] = segmentPoints(state, index);
  const p0 = new ThreeVector3(a.position.x, a.position.y, a.position.z);
  const aOut = add(a.position, a.outControl);
  const bIn = add(b.position, b.inControl);
  const curve = new CubicBezierCurve3(
    p0,
    new ThreeVector3(aOut.x, aOut.y, aOut.z),
    new ThreeVector3(bIn.x, bIn.y, bIn.z),
    new ThreeVector3(b.position.x, b.position.y, b.position.z),
  );
  const result = curve.getPoint(t);
  return vec3(result.x, result.y, result.z);
}

function buildBake(state: Curve3DState): BakedCurve {
  if (state.points.length === 0) {
    return { points: [], offsets: [], tilts: [], upVectors: [], length: 0 };
  }
  const baked: Vector3[] = [copy(state.points[0]!.position)];
  const tilts: number[] = [state.points[0]!.tilt];
  const segments = segmentCount(state);
  for (let segment = 0; segment < segments; segment += 1) {
    const [a, b] = segmentPoints(state, segment);
    const controlLength =
      distance(a.position, add(a.position, a.outControl)) +
      distance(add(a.position, a.outControl), add(b.position, b.inControl)) +
      distance(add(b.position, b.inControl), b.position);
    const steps = Math.max(1, Math.ceil(controlLength / state.bakeInterval));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      baked.push(sampleSegment(state, segment, t));
      tilts.push(a.tilt + (b.tilt - a.tilt) * t);
    }
  }
  const offsets = [0];
  for (let index = 1; index < baked.length; index += 1) {
    offsets.push(offsets[index - 1]! + distance(baked[index - 1]!, baked[index]!));
  }
  const upVectors = baked.map((_point, index) => {
    if (!state.upVectorEnabled) return VECTOR3_UP;
    const previous = baked[Math.max(0, index - 1)]!;
    const next = baked[Math.min(baked.length - 1, index + 1)]!;
    const tangent = sub(next, previous);
    const length = Math.sqrt(lengthSquared(tangent));
    if (length === 0) return VECTOR3_UP;
    const direction = scale(tangent, 1 / length);
    const projected = sub(VECTOR3_UP, scale(direction, dot(VECTOR3_UP, direction)));
    const projectedLength = Math.sqrt(lengthSquared(projected));
    return projectedLength === 0 ? vec3(1, 0, 0) : scale(projected, 1 / projectedLength);
  });
  return {
    points: baked,
    offsets,
    tilts,
    upVectors,
    length: offsets[offsets.length - 1] ?? 0,
  };
}

function bakedOf(state: Curve3DState): BakedCurve {
  return state.baked ??= buildBake(state);
}

function sampleBake(state: Curve3DState, authoredOffset: number, cubic: boolean): Vector3 {
  const baked = bakedOf(state);
  if (baked.points.length === 0) return VECTOR3_ZERO;
  if (baked.points.length === 1 || baked.length === 0) return copy(baked.points[0]!);
  const offset = Math.min(baked.length, Math.max(0, authoredOffset));
  let high = 1;
  while (high < baked.offsets.length && baked.offsets[high]! < offset) high += 1;
  if (high >= baked.points.length) return copy(baked.points[baked.points.length - 1]!);
  const low = high - 1;
  const span = baked.offsets[high]! - baked.offsets[low]!;
  const t = span === 0 ? 0 : (offset - baked.offsets[low]!) / span;
  if (!cubic || baked.points.length < 4) return lerp(baked.points[low]!, baked.points[high]!, t);
  const p0 = baked.points[Math.max(0, low - 1)]!;
  const p1 = baked.points[low]!;
  const p2 = baked.points[high]!;
  const p3 = baked.points[Math.min(baked.points.length - 1, high + 1)]!;
  const t2 = t * t;
  const t3 = t2 * t;
  return vec3(
    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
}

export function createGodotCurve3D(): GodotCurve3D {
  const state: Curve3DState = {
    points: [], bakeInterval: 0.2, closed: false, upVectorEnabled: true,
    baked: undefined, listeners: new Set(),
  };
  const curve: GodotCurve3D = {
    get bake_interval() { return state.bakeInterval; },
    set bake_interval(value) { curve.set_bake_interval(value); },
    get closed() { return state.closed; },
    set closed(value) { curve.set_closed(value); },
    get up_vector_enabled() { return state.upVectorEnabled; },
    set up_vector_enabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Curve3D.up_vector_enabled requires bool.');
      if (state.upVectorEnabled === value) return;
      state.upVectorEnabled = value; invalidate(curve, state);
    },
    add_point(position, inControl = VECTOR3_ZERO, outControl = VECTOR3_ZERO, index = -1) {
      const point: Curve3DPoint = {
        position: vector(position, 'add_point'),
        inControl: vector(inControl, 'add_point'),
        outControl: vector(outControl, 'add_point'),
        tilt: 0,
      };
      if (!Number.isSafeInteger(index) || index < -1) throw new RangeError('Curve3D.add_point index must be -1 or a nonnegative integer.');
      if (index === -1 || index >= state.points.length) state.points.push(point);
      else state.points.splice(index, 0, point);
      invalidate(curve, state);
    },
    set_point_position(index, position) { pointAt(state, index, 'set_point_position').position = vector(position, 'set_point_position'); invalidate(curve, state); },
    get_point_position(index) { return copy(pointAt(state, index, 'get_point_position').position); },
    set_point_in(index, control) { pointAt(state, index, 'set_point_in').inControl = vector(control, 'set_point_in'); invalidate(curve, state); },
    get_point_in(index) { return copy(pointAt(state, index, 'get_point_in').inControl); },
    set_point_out(index, control) { pointAt(state, index, 'set_point_out').outControl = vector(control, 'set_point_out'); invalidate(curve, state); },
    get_point_out(index) { return copy(pointAt(state, index, 'get_point_out').outControl); },
    set_point_tilt(index, tilt) { pointAt(state, index, 'set_point_tilt').tilt = finite(tilt, 'set_point_tilt'); invalidate(curve, state); },
    get_point_tilt(index) { return pointAt(state, index, 'get_point_tilt').tilt; },
    set_point_count(count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Curve3D.set_point_count requires a nonnegative integer.');
      while (state.points.length > count) state.points.pop();
      while (state.points.length < count) state.points.push({
        position: VECTOR3_ZERO, inControl: VECTOR3_ZERO, outControl: VECTOR3_ZERO, tilt: 0,
      });
      if (state.points.length < 2) state.closed = false;
      invalidate(curve, state);
    },
    remove_point(index) {
      pointAt(state, index, 'remove_point'); state.points.splice(index, 1);
      if (state.points.length < 2) state.closed = false;
      invalidate(curve, state);
    },
    clear_points() { if (state.points.length > 0) { state.points.length = 0; invalidate(curve, state); } },
    get_point_count() { return state.points.length; },
    set_bake_interval(interval) {
      const next = finite(interval, 'set_bake_interval');
      if (next <= 0) throw new RangeError('Curve3D.bake_interval must be greater than zero.');
      if (state.bakeInterval !== next) { state.bakeInterval = next; invalidate(curve, state); }
    },
    get_bake_interval() { return state.bakeInterval; },
    set_closed(value) {
      if (typeof value !== 'boolean') throw new TypeError('Curve3D.closed requires bool.');
      if (state.closed !== value) { state.closed = value; invalidate(curve, state); }
    },
    is_closed() { return state.closed; },
    set_up_vector_enabled(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('Curve3D.set_up_vector_enabled requires bool.');
      if (state.upVectorEnabled !== enabled) { state.upVectorEnabled = enabled; invalidate(curve, state); }
    },
    is_up_vector_enabled() { return state.upVectorEnabled; },
    sample(index, t) { finite(t, 'sample'); return sampleSegment(state, index, t); },
    interpolate(index, t) { finite(t, 'interpolate'); return sampleSegment(state, index, t); },
    samplef(fofs) {
      finite(fofs, 'samplef');
      const segments = segmentCount(state);
      if (segments === 0) return state.points.length === 0 ? VECTOR3_ZERO : copy(state.points[0]!.position);
      const bounded = Math.min(segments, Math.max(0, fofs));
      const index = Math.min(segments - 1, Math.floor(bounded));
      return sampleSegment(state, index, bounded - index);
    },
    sample_baked(offset = 0, cubic = false) {
      if (typeof cubic !== 'boolean') throw new TypeError('Curve3D.sample_baked cubic requires bool.');
      return sampleBake(state, finite(offset, 'sample_baked'), cubic);
    },
    interpolate_baked(offset = 0, cubic = false) {
      if (typeof cubic !== 'boolean') throw new TypeError('Curve3D.interpolate_baked cubic requires bool.');
      return sampleBake(state, finite(offset, 'interpolate_baked'), cubic);
    },
    sample_baked_with_rotation() {
      throw new Error('Curve3D.sample_baked_with_rotation requires exact Godot transported-basis baking; this native position carry refuses it.');
    },
    get_baked_length() { return bakedOf(state).length; },
    get_baked_points() { return packedVector3Array(bakedOf(state).points); },
    get_baked_tilts() { return packedFloat32Array(bakedOf(state).tilts); },
    get_baked_up_vectors() { return packedVector3Array(bakedOf(state).upVectors); },
    sample_baked_up_vector(offset = 0, applyTilt = false) {
      if (typeof applyTilt !== 'boolean') throw new TypeError('Curve3D.sample_baked_up_vector apply_tilt requires bool.');
      const baked = bakedOf(state);
      if (baked.upVectors.length === 0) return VECTOR3_UP;
      if (baked.length === 0) return copy(baked.upVectors[0]!);
      const clamped = Math.min(baked.length, Math.max(0, finite(offset, 'sample_baked_up_vector')));
      let high = 1;
      while (high < baked.offsets.length && baked.offsets[high]! < clamped) high += 1;
      high = Math.min(high, baked.upVectors.length - 1);
      const low = Math.max(0, high - 1);
      const span = baked.offsets[high]! - baked.offsets[low]!;
      const t = span === 0 ? 0 : (clamped - baked.offsets[low]!) / span;
      const up = lerp(baked.upVectors[low]!, baked.upVectors[high]!, t);
      const upLength = Math.sqrt(lengthSquared(up));
      if (upLength === 0) return VECTOR3_UP;
      if (applyTilt && baked.tilts.some((tilt) => tilt !== 0)) {
        throw new Error('Curve3D.sample_baked_up_vector(apply_tilt=true) requires transported tangent-basis rotation; this carry refuses it.');
      }
      return scale(up, 1 / upLength);
    },
    get_closest_point(toPoint) {
      const result = closestOnBake(state, vector(toPoint, 'get_closest_point'));
      return result.point;
    },
    get_closest_offset(toPoint) {
      return closestOnBake(state, vector(toPoint, 'get_closest_offset')).offset;
    },
    tessellate(maxStages = 5, toleranceDegrees = 4) {
      if (!Number.isSafeInteger(maxStages) || maxStages < 0 || !Number.isFinite(toleranceDegrees) || toleranceDegrees < 0) {
        throw new RangeError('Curve3D.tessellate requires nonnegative max_stages and tolerance_degrees.');
      }
      return packedVector3Array(tessellated(state, maxStages, toleranceDegrees * Math.PI / 180, undefined));
    },
    tessellate_even_length(maxStages = 5, toleranceLength = 0.2) {
      if (!Number.isSafeInteger(maxStages) || maxStages < 0 || !Number.isFinite(toleranceLength) || toleranceLength <= 0) {
        throw new RangeError('Curve3D.tessellate_even_length requires nonnegative max_stages and positive tolerance_length.');
      }
      return packedVector3Array(tessellated(state, maxStages, undefined, toleranceLength));
    },
  };
  STATES.set(curve, state);
  registerGodotObjectIdentity(curve, 'Curve3D');
  return curve;
}

function closestOnBake(state: Curve3DState, target: Vector3): { point: Vector3; offset: number } {
  const baked = bakedOf(state);
  if (baked.points.length === 0) return { point: VECTOR3_ZERO, offset: 0 };
  let bestPoint = baked.points[0]!;
  let bestOffset = 0;
  let bestDistance = lengthSquared(sub(target, bestPoint));
  for (let index = 1; index < baked.points.length; index += 1) {
    const a = baked.points[index - 1]!;
    const b = baked.points[index]!;
    const delta = sub(b, a);
    const denominator = lengthSquared(delta);
    const t = denominator === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(target, a), delta) / denominator));
    const candidate = lerp(a, b, t);
    const candidateDistance = lengthSquared(sub(target, candidate));
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestPoint = candidate;
      bestOffset = baked.offsets[index - 1]! + distance(a, b) * t;
    }
  }
  return { point: bestPoint, offset: bestOffset };
}

function tessellated(
  state: Curve3DState,
  maxStages: number,
  toleranceRadians: number | undefined,
  toleranceLength: number | undefined,
): Vector3[] {
  const out: Vector3[] = [];
  const segments = segmentCount(state);
  for (let segment = 0; segment < segments; segment += 1) {
    const start = sampleSegment(state, segment, 0);
    if (out.length === 0) out.push(start);
    const subdivide = (from: Vector3, fromT: number, to: Vector3, toT: number, stage: number): void => {
      const midT = (fromT + toT) * 0.5;
      const mid = sampleSegment(state, segment, midT);
      const chordMid = lerp(from, to, 0.5);
      const error = distance(mid, chordMid);
      let split = toleranceLength === undefined ? error > state.bakeInterval * Math.sin(toleranceRadians ?? 0) : error > toleranceLength;
      if (stage >= maxStages) split = false;
      if (split) {
        subdivide(from, fromT, mid, midT, stage + 1);
        subdivide(mid, midT, to, toT, stage + 1);
      } else out.push(to);
    };
    subdivide(start, 0, sampleSegment(state, segment, 1), 1, 0);
  }
  return out;
}

export function observeGodotCurve3D(curve: GodotCurve3D, listener: () => void): () => void {
  const listeners = stateOf(curve).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface GodotPath3D<TNode extends Object3D = Object3D> {
  readonly node: TNode;
  curve: GodotCurve3D | null;
  debug_custom_color: ColorValue;
  set_debug_custom_color(value: ColorValue): void;
  get_debug_custom_color(): ColorValue;
}

interface Path3DState {
  curve: GodotCurve3D | null;
  releaseCurve: () => void;
  readonly listeners: Set<() => void>;
}

const PATH_STATES = new WeakMap<Object3D, Path3DState>();

export function bindGodotPath3D<TNode extends Object3D>(
  node: TNode,
  curve: GodotCurve3D | null = null,
  major: 3 | 4 = 4,
): TNode & GodotPath3D<TNode> {
  const state: Path3DState = { curve, releaseCurve: () => {}, listeners: new Set() };
  const publish = (): void => { for (const listener of state.listeners) listener(); };
  const observeCurve = (): void => {
    state.releaseCurve();
    state.releaseCurve = state.curve === null ? () => {} : observeGodotCurve3D(state.curve, publish);
  };
  observeCurve();
  let debugColor: ColorValue = Object.freeze({ r: 0.5, g: 0.5, b: 1, a: 1 });
  Object.defineProperties(node, {
    node: { value: node },
    curve: { enumerable: true, get: () => state.curve, set: (value: GodotCurve3D | null) => {
      if (value !== null) stateOf(value);
      if (state.curve === value) return;
      state.curve = value;
      observeCurve();
      publish();
    } },
    debug_custom_color: { enumerable: true, get: () => debugColor, set: (value: ColorValue) => {
      if (value === null || typeof value !== 'object') throw new TypeError('Path3D.debug_custom_color requires Color.');
      debugColor = Object.freeze({ r: value.r, g: value.g, b: value.b, a: value.a });
    } },
    set_debug_custom_color: { value: (value: ColorValue) => { (node as TNode & GodotPath3D<TNode>).debug_custom_color = value; } },
    get_debug_custom_color: { value: () => debugColor },
  });
  PATH_STATES.set(node, state);
  registerGodotObjectIdentity(node, major === 3 ? 'Path' : 'Path3D');
  return node as TNode & GodotPath3D<TNode>;
}

export function observeGodotPath3D(path: GodotPath3D, listener: () => void): () => void {
  const state = PATH_STATES.get(path.node);
  if (state === undefined) throw new TypeError('Expected a Path3D bound by godot-compat.');
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function releaseGodotPath3D(node: Object3D): void {
  const state = PATH_STATES.get(node);
  if (state === undefined) return;
  state.releaseCurve();
  state.listeners.clear();
  PATH_STATES.delete(node);
}

function boundPath(node: Object3D): GodotPath3D {
  if (!PATH_STATES.has(node)) throw new TypeError('Expected a Path3D bound by godot-compat.');
  return node as Object3D & GodotPath3D;
}

export function setPath3DCurve(node: Object3D, curve: GodotCurve3D | null): void {
  boundPath(node).curve = curve;
}

export function getPath3DCurve(node: Object3D): GodotCurve3D | null {
  return boundPath(node).curve;
}

export function setPath3DDebugCustomColor(node: Object3D, color: ColorValue): void {
  boundPath(node).debug_custom_color = color;
}

export function getPath3DDebugCustomColor(node: Object3D): ColorValue {
  return boundPath(node).get_debug_custom_color();
}
