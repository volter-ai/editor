/** CollisionObject2D's native Pixi hit-test input surface and retained built-in signals. */
import type { Container, FederatedPointerEvent } from 'pixi.js';
import { createInputEventMouseButton, type GodotInputMapEvent } from './input';
import type { CollisionPolygon2DHandle } from './collision-polygon-2d';
import type { GodotShape2D } from './physics-query-2d';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

interface CollisionInputState {
  pickable: boolean;
  readonly inputEvent: SignalHandle<readonly [unknown, GodotInputMapEvent, number]>;
  readonly mouseEntered: SignalHandle<readonly []>;
  readonly mouseExited: SignalHandle<readonly []>;
  readonly release: () => void;
}

const STATES = new WeakMap<object, CollisionInputState>();

export interface CollisionObjectInput2DOptions {
  readonly godotMajor: 3 | 4;
  readonly viewport: unknown;
  /** Direct shape-owner children in the same index order Godot exposes to input_event. */
  readonly shapes: readonly CollisionInputShape2D[];
  readonly inputPickable?: boolean;
}

export type CollisionInputShape2D =
  | {
      readonly shapeIndex: number;
      readonly shape: GodotShape2D;
      readonly collider: { isEnabled(): boolean };
      readonly position: Readonly<{ x: number; y: number }>;
      readonly rotation: number;
    }
  | {
      readonly shapeIndex: number;
      readonly polygon: CollisionPolygon2DHandle;
    };

function shapeLocalPoint(
  x: number,
  y: number,
  position: Readonly<{ x: number; y: number }>,
  rotation: number,
): { readonly x: number; readonly y: number } {
  const dx = x - position.x;
  const dy = y - position.y;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return { x: cosine * dx + sine * dy, y: -sine * dx + cosine * dy };
}

function onSegment(
  point: Readonly<{ x: number; y: number }>,
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const scale = Math.max(1, Math.abs(abx), Math.abs(aby), Math.abs(apx), Math.abs(apy));
  if (Math.abs(abx * apy - aby * apx) > Number.EPSILON * scale * scale * 8) return false;
  const dot = apx * abx + apy * aby;
  return dot >= 0 && dot <= abx * abx + aby * aby;
}

function polygonContains(
  point: Readonly<{ x: number; y: number }>,
  points: readonly Readonly<{ x: number; y: number }>[],
): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous]!;
    const b = points[index]!;
    if (onSegment(point, a, b)) return true;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function resourceContains(shape: GodotShape2D, point: Readonly<{ x: number; y: number }>): boolean {
  // Godot 3's RayShape2D is a collision-solving probe, not a pickable area:
  // RayShape2DSW::contains_point returns false unconditionally.
  if (shape.kind === 'ray') return false;
  if (shape.kind === 'circle') return point.x * point.x + point.y * point.y <= shape.radius * shape.radius;
  if (shape.kind === 'rectangle') {
    return Math.abs(point.x) <= shape.size.x / 2 && Math.abs(point.y) <= shape.size.y / 2;
  }
  if (shape.kind === 'capsule') {
    const halfSegment = shape.midHeight / 2;
    const nearestY = Math.max(-halfSegment, Math.min(halfSegment, point.y));
    const dy = point.y - nearestY;
    return point.x * point.x + dy * dy <= shape.radius * shape.radius;
  }
  if (shape.kind === 'convex-polygon') return polygonContains(point, [...shape.points]);
  if (shape.kind === 'segment') return onSegment(point, shape.a, shape.b);
  if (shape.kind === 'concave-polygon') {
    for (let index = 0; index + 1 < shape.segments.length; index += 2) {
      if (onSegment(point, shape.segments[index]!, shape.segments[index + 1]!)) return true;
    }
    return false;
  }
  return shape.normal.x * point.x + shape.normal.y * point.y <= shape.distance;
}

function containsShape(shape: CollisionInputShape2D, x: number, y: number): boolean {
  if ('polygon' in shape) {
    if (!shape.polygon.isEnabled()) return false;
    const point = shapeLocalPoint(x, y, shape.polygon.position, shape.polygon.rotation);
    const polygon = [...shape.polygon.polygon];
    if (shape.polygon.build_mode === 0) return polygonContains(point, polygon);
    for (let index = 0; index < polygon.length; index += 1) {
      if (onSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!)) return true;
    }
    return false;
  }
  if (!shape.collider.isEnabled()) return false;
  return resourceContains(
    shape.shape,
    shapeLocalPoint(x, y, shape.position, shape.rotation),
  );
}

function buttonIndex(button: number): number {
  if (button === 0) return 1;
  if (button === 2) return 2;
  if (button === 1) return 3;
  return button + 1;
}

function mouseButtonEvent(event: FederatedPointerEvent, pressed: boolean, major: 3 | 4): GodotInputMapEvent {
  const value = createInputEventMouseButton(major);
  value.pressed = pressed;
  value.control = event.ctrlKey;
  value.alt_pressed = event.altKey;
  value.shift_pressed = event.shiftKey;
  value.meta_pressed = event.metaKey;
  value.button_index = buttonIndex(event.button);
  value.button_mask = event.buttons;
  value.double_click = event.detail === 2;
  value.position = { x: event.global.x, y: event.global.y };
  value.global_position = { x: event.global.x, y: event.global.y };
  return value;
}

export function bindCollisionObjectInput2D(
  node: Container,
  options: CollisionObjectInput2DOptions,
): () => void {
  if (STATES.has(node)) throw new Error('CollisionObject2D input was already bound to this retained Pixi node');
  if (
    options.shapes.length === 0 ||
    options.shapes.some((shape) => !Number.isInteger(shape.shapeIndex) || shape.shapeIndex < 0)
  ) {
    throw new RangeError('CollisionObject2D input requires non-negative authored shape indexes');
  }
  const inputEvent = createSignal<readonly [unknown, GodotInputMapEvent, number]>();
  const mouseEntered = createSignal<readonly []>();
  const mouseExited = createSignal<readonly []>();
  const previousHitArea = node.hitArea;
  const shapeIndexesAt = (x: number, y: number): number[] => options.shapes
    .filter((shape) => containsShape(shape, x, y))
    .map((shape) => shape.shapeIndex);
  node.hitArea = { contains: (x: number, y: number) => shapeIndexesAt(x, y).length > 0 };
  const onDown = (event: FederatedPointerEvent) => {
    const state = STATES.get(node);
    if (state?.pickable !== true) return;
    const point = node.toLocal(event.global);
    const value = mouseButtonEvent(event, true, options.godotMajor);
    for (const shapeIndex of shapeIndexesAt(point.x, point.y)) {
      inputEvent.emit(options.viewport, value, shapeIndex);
    }
  };
  const onUp = (event: FederatedPointerEvent) => {
    const state = STATES.get(node);
    if (state?.pickable !== true) return;
    const point = node.toLocal(event.global);
    const value = mouseButtonEvent(event, false, options.godotMajor);
    for (const shapeIndex of shapeIndexesAt(point.x, point.y)) {
      inputEvent.emit(options.viewport, value, shapeIndex);
    }
  };
  const onEnter = () => { if (STATES.get(node)?.pickable === true) mouseEntered.emit(); };
  const onExit = () => { if (STATES.get(node)?.pickable === true) mouseExited.emit(); };
  node.on('pointerdown', onDown);
  node.on('pointerup', onUp);
  node.on('pointerenter', onEnter);
  node.on('pointerleave', onExit);
  const release = () => {
    node.off('pointerdown', onDown);
    node.off('pointerup', onUp);
    node.off('pointerenter', onEnter);
    node.off('pointerleave', onExit);
    if (previousHitArea === undefined) delete node.hitArea;
    else node.hitArea = previousHitArea;
    STATES.delete(node);
  };
  const state: CollisionInputState = {
    pickable: options.inputPickable ?? true,
    inputEvent,
    mouseEntered,
    mouseExited,
    release,
  };
  STATES.set(node, state);
  node.eventMode = state.pickable ? 'static' : 'passive';
  return release;
}

function stateOf(node: object): CollisionInputState {
  const state = STATES.get(node);
  if (state === undefined) throw new Error('CollisionObject2D input requires an emitted retained Pixi binding');
  return state;
}

export function getCollisionObject2DInputPickable(node: object): boolean {
  return stateOf(node).pickable;
}

export function setCollisionObject2DInputPickable(node: Container, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('CollisionObject2D.input_pickable requires bool');
  stateOf(node).pickable = value;
  node.eventMode = value ? 'static' : 'passive';
}

export function getCollisionObject2DInputEventSignal(
  node: object,
): GodotSignal<readonly [unknown, GodotInputMapEvent, number]> {
  return stateOf(node).inputEvent.signal;
}

export function getCollisionObject2DMouseEnteredSignal(node: object): GodotSignal<readonly []> {
  return stateOf(node).mouseEntered.signal;
}

export function getCollisionObject2DMouseExitedSignal(node: object): GodotSignal<readonly []> {
  return stateOf(node).mouseExited.signal;
}
