import { Container } from 'pixi.js';
import { CubicBezierCurve, Vector2 as ThreeVector2 } from 'three';

import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { vec2, type Vector2 } from './vector2';

export interface Curve2DPoint {
  position: Vector2;
  inControl: Vector2;
  outControl: Vector2;
}

export interface GodotCurve2D {
  bake_interval: number;
  readonly point_count: number;
  add_point(position: Vector2, inControl?: Vector2, outControl?: Vector2, atPosition?: number): void;
  set_point_position(index: number, position: Vector2): void;
  get_point_position(index: number): Vector2;
  set_point_in(index: number, control: Vector2): void;
  get_point_in(index: number): Vector2;
  set_point_out(index: number, control: Vector2): void;
  get_point_out(index: number): Vector2;
  remove_point(index: number): void;
  clear_points(): void;
  get_point_count(): number;
  set_bake_interval(interval: number): void;
  get_bake_interval(): number;
  get_baked_length(): number;
  interpolate_baked(offset: number, cubic?: boolean): Vector2;
  sample_baked(offset: number, cubic?: boolean): Vector2;
  get_baked_points(): PackedVector2Array;
}

interface Curve2DState {
  readonly points: Curve2DPoint[];
  bakeInterval: number;
  baked: readonly Vector2[] | undefined;
  bakedMaxOffset: number;
  readonly listeners: Set<() => void>;
}

const STATES = new WeakMap<object, Curve2DState>();
const PATHS = new WeakMap<Container, { curve: GodotCurve2D | null; releaseCurve: () => void; readonly listeners: Set<() => void> }>();
const ZERO = vec2(0, 0);

export type GodotPath2D = Container & {
  curve: GodotCurve2D | null;
  set_curve(value: GodotCurve2D | null): void;
  get_curve(): GodotCurve2D | null;
};

function vector(value: Vector2, member: string): Vector2 {
  if (value === null || typeof value !== 'object' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`Curve2D.${member} requires a finite Vector2.`);
  }
  return vec2(value.x, value.y);
}

function stateOf(curve: GodotCurve2D): Curve2DState {
  const state = STATES.get(curve);
  if (state === undefined) throw new TypeError('Expected a Curve2D Resource created by godot-compat.');
  return state;
}

function pointAt(state: Curve2DState, index: number, member: string): Curve2DPoint {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.points.length) {
    throw new RangeError(`Curve2D.${member} point index ${String(index)} is out of range.`);
  }
  return state.points[index]!;
}

function sampleSegment(state: Curve2DState, index: number, t: number): Vector2 {
  const a = pointAt(state, index, 'sample');
  const b = pointAt(state, index + 1, 'sample');
  const curve = new CubicBezierCurve(
    new ThreeVector2(a.position.x, a.position.y),
    new ThreeVector2(a.position.x + a.outControl.x, a.position.y + a.outControl.y),
    new ThreeVector2(b.position.x + b.inControl.x, b.position.y + b.inControl.y),
    new ThreeVector2(b.position.x, b.position.y),
  );
  const sampled = curve.getPoint(t);
  return vec2(sampled.x, sampled.y);
}

function bakedOf(state: Curve2DState): readonly Vector2[] {
  if (state.baked !== undefined) return state.baked;
  if (state.points.length === 0) {
    state.bakedMaxOffset = 0;
    return state.baked = [];
  }
  if (state.points.length === 1) {
    state.bakedMaxOffset = 0;
    return state.baked = [vector(state.points[0]!.position, 'get_baked_points')];
  }
  let position = vector(state.points[0]!.position, 'get_baked_points');
  const baked: Vector2[] = [position];
  for (let segment = 0; segment < state.points.length - 1; segment += 1) {
    const step = 0.1;
    let parameter = 0;
    while (parameter < 1) {
      const nextParameter = Math.min(1, parameter + step);
      let nextPosition = sampleSegment(state, segment, nextParameter);
      const distance = Math.hypot(nextPosition.x - position.x, nextPosition.y - position.y);
      if (distance > state.bakeInterval) {
        let low = parameter;
        let high = nextParameter;
        let middle = low + (high - low) * 0.5;
        for (let iteration = 0; iteration < 10; iteration += 1) {
          nextPosition = sampleSegment(state, segment, middle);
          const span = Math.hypot(nextPosition.x - position.x, nextPosition.y - position.y);
          if (state.bakeInterval < span) high = middle;
          else low = middle;
          middle = low + (high - low) * 0.5;
        }
        position = nextPosition;
        parameter = middle;
        baked.push(position);
      } else {
        parameter = nextParameter;
      }
    }
  }
  const last = vector(state.points[state.points.length - 1]!.position, 'get_baked_points');
  const remainder = Math.hypot(last.x - position.x, last.y - position.y);
  state.bakedMaxOffset = (baked.length - 1) * state.bakeInterval + remainder;
  baked.push(last);
  state.baked = baked;
  return baked;
}

function cubicInterpolate(a: Vector2, b: Vector2, preA: Vector2, postB: Vector2, weight: number): Vector2 {
  const t2 = weight * weight;
  const t3 = t2 * weight;
  const component = (p0: number, p1: number, p2: number, p3: number): number =>
    0.5 * (2 * p1 + (-p0 + p2) * weight + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return vec2(component(preA.x, a.x, b.x, postB.x), component(preA.y, a.y, b.y, postB.y));
}

function sampleBaked(state: Curve2DState, offset: number, cubic: boolean): Vector2 {
  const baked = bakedOf(state);
  if (baked.length === 0) return ZERO;
  if (baked.length === 1) return vector(baked[0]!, 'sample_baked');
  if (offset < 0) return vector(baked[0]!, 'sample_baked');
  if (offset >= state.bakedMaxOffset) return vector(baked[baked.length - 1]!, 'sample_baked');
  const index = Math.floor(offset / state.bakeInterval);
  let fraction = offset % state.bakeInterval;
  if (index >= baked.length - 1) return vector(baked[baked.length - 1]!, 'sample_baked');
  if (index === baked.length - 2) {
    if (fraction > 0) fraction /= state.bakedMaxOffset % state.bakeInterval;
  } else {
    fraction /= state.bakeInterval;
  }
  const a = baked[index]!;
  const b = baked[index + 1]!;
  if (!cubic) return vec2(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction);
  const pre = index > 0 ? baked[index - 1]! : a;
  const post = index < baked.length - 2 ? baked[index + 2]! : b;
  return cubicInterpolate(a, b, pre, post, fraction);
}

function changed(curve: GodotCurve2D, state: Curve2DState): void {
  state.baked = undefined;
  state.bakedMaxOffset = 0;
  godotResourceEmitChanged(curve);
  for (const listener of state.listeners) listener();
}

export function createGodotCurve2D(points: readonly Curve2DPoint[] = [], bakeInterval = 5): GodotCurve2D {
  if (!Number.isFinite(bakeInterval)) throw new TypeError('Curve2D.bake_interval must be finite.');
  const state: Curve2DState = { points: [], bakeInterval, baked: undefined, bakedMaxOffset: 0, listeners: new Set() };
  const curve = {} as GodotCurve2D;
  STATES.set(curve, state);
  registerGodotObjectIdentity(curve, 'Curve2D');
  const mutate = (action: () => void): void => { action(); changed(curve, state); };
  Object.defineProperty(curve, 'bake_interval', {
    enumerable: true,
    configurable: true,
    get: () => state.bakeInterval,
    set: (value: number) => curve.set_bake_interval(value),
  });
  Object.defineProperty(curve, 'point_count', {
    enumerable: true,
    configurable: true,
    get: () => state.points.length,
  });
  Object.assign(curve, {
    add_point(position: Vector2, inControl = ZERO, outControl = ZERO, atPosition = -1): void {
      const point = {
        position: vector(position, 'add_point'),
        inControl: vector(inControl, 'add_point'),
        outControl: vector(outControl, 'add_point'),
      };
      if (!Number.isSafeInteger(atPosition)) throw new TypeError('Curve2D.add_point index must be an integer.');
      mutate(() => {
        if (atPosition >= 0 && atPosition < state.points.length) state.points.splice(atPosition, 0, point);
        else state.points.push(point);
      });
    },
    set_point_position(index: number, position: Vector2): void { mutate(() => { pointAt(state, index, 'set_point_position').position = vector(position, 'set_point_position'); }); },
    get_point_position(index: number): Vector2 { return vector(pointAt(state, index, 'get_point_position').position, 'get_point_position'); },
    set_point_in(index: number, control: Vector2): void { mutate(() => { pointAt(state, index, 'set_point_in').inControl = vector(control, 'set_point_in'); }); },
    get_point_in(index: number): Vector2 { return vector(pointAt(state, index, 'get_point_in').inControl, 'get_point_in'); },
    set_point_out(index: number, control: Vector2): void { mutate(() => { pointAt(state, index, 'set_point_out').outControl = vector(control, 'set_point_out'); }); },
    get_point_out(index: number): Vector2 { return vector(pointAt(state, index, 'get_point_out').outControl, 'get_point_out'); },
    remove_point(index: number): void { pointAt(state, index, 'remove_point'); mutate(() => { state.points.splice(index, 1); }); },
    clear_points(): void { if (state.points.length > 0) mutate(() => { state.points.length = 0; }); },
    get_point_count(): number { return state.points.length; },
    set_bake_interval(interval: number): void {
      if (!Number.isFinite(interval)) throw new TypeError('Curve2D.bake_interval must be finite.');
      if (state.bakeInterval !== interval) mutate(() => { state.bakeInterval = interval; });
    },
    get_bake_interval(): number { return state.bakeInterval; },
    get_baked_length(): number { bakedOf(state); return state.bakedMaxOffset; },
    interpolate_baked(offset: number, cubic = false): Vector2 { return sampleBaked(state, offset, cubic); },
    sample_baked(offset: number, cubic = false): Vector2 { return sampleBaked(state, offset, cubic); },
    get_baked_points(): PackedVector2Array { return packedVector2Array(bakedOf(state)); },
  });
  for (const point of points) curve.add_point(point.position, point.inControl, point.outControl);
  bindGodotResourceProtocol(curve, {
    createDuplicate(source) {
      const sourceState = stateOf(source);
      return createGodotCurve2D(sourceState.points, sourceState.bakeInterval);
    },
  });
  return curve;
}

export function observeGodotCurve2D(curve: GodotCurve2D, listener: () => void): () => void {
  const listeners = stateOf(curve).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindGodotPath2D<TNode extends Container>(node: TNode, curve: GodotCurve2D | null = createGodotCurve2D()): TNode & GodotPath2D {
  const state = { curve, releaseCurve: () => {}, listeners: new Set<() => void>() };
  const publish = (): void => { for (const listener of state.listeners) listener(); };
  const observe = (): void => {
    state.releaseCurve();
    state.releaseCurve = state.curve === null ? () => {} : observeGodotCurve2D(state.curve, publish);
  };
  Object.defineProperty(node, 'curve', {
    enumerable: true,
    configurable: true,
    get: () => state.curve,
    set: (value: GodotCurve2D | null) => {
      if (value !== null) stateOf(value);
      if (state.curve === value) return;
      state.curve = value;
      observe();
      publish();
    },
  });
  Object.assign(node, {
    set_curve(value: GodotCurve2D | null): void { setPath2DCurve(node, value); },
    get_curve(): GodotCurve2D | null { return state.curve; },
  });
  PATHS.set(node, state);
  observe();
  registerGodotObjectIdentity(node, 'Path2D');
  return node as TNode & GodotPath2D;
}

/** Construct an unattached native Path2D whose Curve2D remains a shared mutable Resource. */
export function createGodotPath2D(curve: GodotCurve2D | null = createGodotCurve2D()): GodotPath2D {
  const node = bindGodotPath2D(bindGodotCanvasNode2DApi(new Container()), curve);
  registerCanvasNodeRelease(node, () => releaseGodotPath2D(node));
  return node;
}

export function getPath2DCurve(node: Container): GodotCurve2D | null {
  const state = PATHS.get(node);
  if (state === undefined) throw new TypeError('Expected a retained Path2D.');
  return state.curve;
}

export function setPath2DCurve(node: Container, curve: GodotCurve2D | null): void {
  (bindPath(node)).curve = curve;
}

function bindPath(node: Container): Container & { curve: GodotCurve2D | null } {
  if (!PATHS.has(node)) throw new TypeError('Expected a retained Path2D.');
  return node as Container & { curve: GodotCurve2D | null };
}

export function observeGodotPath2D(node: Container, listener: () => void): () => void {
  const state = PATHS.get(node);
  if (state === undefined) throw new TypeError('Expected a retained Path2D.');
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function releaseGodotPath2D(node: Container): void {
  const state = PATHS.get(node);
  if (state === undefined) return;
  state.releaseCurve();
  state.listeners.clear();
  PATHS.delete(node);
}
