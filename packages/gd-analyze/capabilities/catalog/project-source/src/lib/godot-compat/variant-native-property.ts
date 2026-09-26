/** Exact native property dispatch for statically open Godot Object/Variant receivers. */

import {
  getInputEventAction,
  isGodotInputEventAction,
  setInputEventAction,
} from './input';
import { isGodotShape2D } from './physics-query-2d';
import { isGodotShape3D } from './shape-3d';
import { isGodotTouchScreenButton } from './touch-screen-button';

type OpenNativeProperty = 'radius' | 'action';

function carrierName(value: unknown): string {
  if (value === null) return 'Nil';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return typeof value;
  return value.constructor?.name ?? 'Object';
}

function radiusOwner(value: unknown): value is { radius: number } {
  if (isGodotShape2D(value)) return value.kind === 'circle' || value.kind === 'capsule';
  if (!isGodotShape3D(value)) return false;
  return value.kind === 'sphere' || value.kind === 'capsule' || value.kind === 'cylinder';
}

function refusal(receiver: unknown, property: OpenNativeProperty): never {
  throw new TypeError(
    `godot-compat: Variant.${property} has no covered property on retained ` +
      `${carrierName(receiver)} identity.`,
  );
}

/** Read only after a retained native identity proves the ClassDB property owner. */
export function godotVariantNativeProperty(
  receiver: unknown,
  property: OpenNativeProperty,
): number | string {
  if (property === 'radius' && radiusOwner(receiver)) return receiver.radius;
  if (property === 'action') {
    if (isGodotInputEventAction(receiver)) return getInputEventAction(receiver);
    if (isGodotTouchScreenButton(receiver)) return receiver.action;
  }
  return refusal(receiver, property);
}

/** Write through the existing live Resource/input/widget owner and its validation/change effects. */
export function setGodotVariantNativeProperty(
  receiver: unknown,
  property: OpenNativeProperty,
  value: unknown,
): void {
  if (property === 'radius' && radiusOwner(receiver)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError('godot-compat: Variant.radius requires a finite non-negative number.');
    }
    receiver.radius = value;
    return;
  }
  if (property === 'action') {
    if (typeof value !== 'string') {
      throw new TypeError('godot-compat: Variant.action requires a StringName.');
    }
    if (isGodotInputEventAction(receiver)) {
      setInputEventAction(receiver, value);
      return;
    }
    if (isGodotTouchScreenButton(receiver)) {
      receiver.action = value;
      return;
    }
  }
  refusal(receiver, property);
}
