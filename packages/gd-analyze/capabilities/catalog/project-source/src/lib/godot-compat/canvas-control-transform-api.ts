/** Native Control maximum-size and pivot state over the retained Pixi transform. */

import { Container, type PointData } from 'pixi.js';

import {
  getCanvasControlCustomMaximumSize,
  getCanvasControlSize,
  setCanvasControlCustomMaximumSize,
} from './canvas-control-state';
import { copyVector2, vec2, type Vector2 } from './vector2';

interface CanvasControlTransformState {
  propagateMaximumSize: boolean;
  pivotOffset: Vector2;
  pivotRatio: Vector2;
  pivotUsesRatio: boolean;
}

const TRANSFORMS = new WeakMap<Container, CanvasControlTransformState>();

function stateOf(control: Container): CanvasControlTransformState {
  let state = TRANSFORMS.get(control);
  if (state === undefined) {
    state = {
      propagateMaximumSize: false,
      pivotOffset: vec2(),
      pivotRatio: vec2(),
      pivotUsesRatio: false,
    };
    TRANSFORMS.set(control, state);
  }
  return state;
}

function point(value: PointData, member: string, nonNegative = false): Vector2 {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`Control.${member} requires a finite Vector2.`);
  }
  if (nonNegative && (value.x < 0 || value.y < 0)) {
    throw new RangeError(`Control.${member} components must be non-negative.`);
  }
  return vec2(value.x, value.y);
}

function applyPivot(control: Container, state: CanvasControlTransformState): void {
  if (state.pivotUsesRatio) {
    const size = getCanvasControlSize(control);
    state.pivotOffset = vec2(size.x * state.pivotRatio.x, size.y * state.pivotRatio.y);
  }
  control.pivot.set(state.pivotOffset.x, state.pivotOffset.y);
}

export interface GodotCanvasControlTransformApi {
  custom_maximum_size: Vector2;
  propagate_maximum_size: boolean;
  pivot_offset: Vector2;
  pivot_offset_ratio: Vector2;
  set_custom_maximum_size(value: PointData): void;
  get_custom_maximum_size(): Vector2;
  get_maximum_size(): Vector2;
  get_combined_maximum_size(): Vector2;
  set_propagate_maximum_size(value: boolean): void;
  is_propagating_maximum_size(): boolean;
  set_pivot_offset(value: PointData): void;
  get_pivot_offset(): Vector2;
  set_pivot_offset_ratio(value: PointData): void;
  get_pivot_offset_ratio(): Vector2;
  get_combined_pivot_offset(): Vector2;
}

export function bindGodotCanvasControlTransformApi<T extends Container>(
  source: T,
): T & GodotCanvasControlTransformApi {
  const control = source as T & GodotCanvasControlTransformApi;
  const state = stateOf(control);
  const setMaximum = (value: PointData): void => setCanvasControlCustomMaximumSize(
    control,
    point(value, 'custom_maximum_size', true),
  );
  const setPropagate = (value: boolean): void => {
    if (typeof value !== 'boolean') throw new TypeError('Control.propagate_maximum_size requires bool.');
    state.propagateMaximumSize = value;
  };
  const setPivot = (value: PointData): void => {
    state.pivotOffset = point(value, 'pivot_offset');
    state.pivotUsesRatio = false;
    const size = getCanvasControlSize(control);
    state.pivotRatio = vec2(
      size.x === 0 ? 0 : state.pivotOffset.x / size.x,
      size.y === 0 ? 0 : state.pivotOffset.y / size.y,
    );
    applyPivot(control, state);
  };
  const setPivotRatio = (value: PointData): void => {
    state.pivotRatio = point(value, 'pivot_offset_ratio');
    state.pivotUsesRatio = true;
    applyPivot(control, state);
  };
  Object.defineProperties(control, {
    custom_maximum_size: { configurable: true, enumerable: true, get: () => getCanvasControlCustomMaximumSize(control), set: setMaximum },
    propagate_maximum_size: { configurable: true, enumerable: true, get: () => state.propagateMaximumSize, set: setPropagate },
    pivot_offset: { configurable: true, enumerable: true, get: () => copyVector2(state.pivotOffset), set: setPivot },
    pivot_offset_ratio: { configurable: true, enumerable: true, get: () => copyVector2(state.pivotRatio), set: setPivotRatio },
  });
  Object.assign(control, {
    set_custom_maximum_size: setMaximum,
    get_custom_maximum_size: (): Vector2 => getCanvasControlCustomMaximumSize(control),
    get_maximum_size: (): Vector2 => getCanvasControlCustomMaximumSize(control),
    get_combined_maximum_size: (): Vector2 => getCanvasControlCustomMaximumSize(control),
    set_propagate_maximum_size: setPropagate,
    is_propagating_maximum_size: (): boolean => state.propagateMaximumSize,
    set_pivot_offset: setPivot,
    get_pivot_offset: (): Vector2 => copyVector2(state.pivotOffset),
    set_pivot_offset_ratio: setPivotRatio,
    get_pivot_offset_ratio: (): Vector2 => copyVector2(state.pivotRatio),
    get_combined_pivot_offset: (): Vector2 => { applyPivot(control, state); return copyVector2(state.pivotOffset); },
  });
  applyPivot(control, state);
  return control;
}
