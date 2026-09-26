/** Runtime Control transform/layout properties across retained Pixi and DOM identities. */

import { Container } from 'pixi.js';

import { getCanvasControlMargin, setCanvasControlMargin } from './canvas-control-state';
import { optionalControlBinding, type ControlPoint, type GodotControl } from './control-state';

const ROTATION_DEGREES = new WeakMap<object, number>();

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

export function getControlRotationDegrees(control: object): number {
  if (control instanceof Container) return control.rotation * 180 / Math.PI;
  return ROTATION_DEGREES.get(control) ?? 0;
}

export function setControlRotationDegrees(control: object, value: number): void {
  const degrees = finite(value, 'Control.rect_rotation');
  ROTATION_DEGREES.set(control, degrees);
  if (control instanceof Container) control.rotation = degrees * Math.PI / 180;
  const binding = optionalControlBinding(control);
  binding?.state.write(binding.id, { rotationDegrees: degrees });
}

export function getControlRuntimeScale(control: object): ControlPoint {
  if (control instanceof Container) return { x: control.scale.x, y: control.scale.y };
  const value = control as GodotControl;
  return { x: value.scale.x, y: value.scale.y };
}

export function setControlRuntimeScale(control: object, value: ControlPoint): void {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError('Control.scale requires a finite Vector2.');
  }
  if (control instanceof Container) control.scale.set(value.x, value.y);
  else (control as GodotControl).scale = { x: value.x, y: value.y };
}

export function getControlOffsetLeft(control: object): number {
  if (control instanceof Container) return getCanvasControlMargin(control, 'left');
  return (control as GodotControl).position.x;
}

export function setControlOffsetLeft(control: object, value: number): void {
  const next = finite(value, 'Control.offset_left');
  if (control instanceof Container) {
    setCanvasControlMargin(control, 'left', next);
    return;
  }
  const retained = control as GodotControl;
  const right = retained.position.x + retained.size.x;
  retained.position = { x: next, y: retained.position.y };
  retained.size = { x: Math.max(0, right - next), y: retained.size.y };
}

export function getControlOffsetRight(control: object): number {
  if (control instanceof Container) return getCanvasControlMargin(control, 'right');
  const retained = control as GodotControl;
  return retained.position.x + retained.size.x;
}

export function setControlOffsetRight(control: object, value: number): void {
  const next = finite(value, 'Control.offset_right');
  if (control instanceof Container) {
    setCanvasControlMargin(control, 'right', next);
    return;
  }
  const retained = control as GodotControl;
  retained.size = { x: Math.max(0, next - retained.position.x), y: retained.size.y };
}
