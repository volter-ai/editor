/** Closed authored CanvasLayer surface for the Three/DOM projection. */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

type Properties = Readonly<Record<string, GodotValue>>;

export interface CanvasLayerDomSpec {
  readonly layer: number;
  readonly visible: boolean;
  readonly offset: { readonly x: number; readonly y: number };
  readonly scale: { readonly x: number; readonly y: number };
  readonly rotationDegrees: number;
  readonly transform?: readonly [number, number, number, number, number, number];
  readonly deviations: readonly string[];
}

/**
 * Read the complete CanvasLayer property family shared by the pinned Godot dialects.
 *
 * DOM has exact counterparts for the layer's stacking index, visibility and affine transform.
 * A custom Viewport and follow-viewport motion require a second live canvas/camera relationship;
 * those are named deviations when authored rather than being mistaken for unknown Control keys.
 */
export function readCanvasLayerDomSpec(props: Properties, at: string): CanvasLayerDomSpec {
  const layer = finiteNumber(props, 'layer', 1, at);
  if (!Number.isSafeInteger(layer)) {
    throw new TranslateError(at, 'CanvasLayer.layer must be a safe integer.');
  }
  const visible = bool(props, 'visible', true, at);
  const offset = point(props, 'offset', { x: 0, y: 0 }, at);
  const scale = point(props, 'scale', { x: 1, y: 1 }, at);
  const radians = finiteNumber(props, 'rotation', 0, at);
  const authoredDegrees = props['rotation_degrees'];
  const degrees = finiteNumber(props, 'rotation_degrees', radians * 180 / Math.PI, at);
  if (props['rotation'] !== undefined && authoredDegrees !== undefined) {
    const fromRadians = radians * 180 / Math.PI;
    if (Math.abs(fromRadians - degrees) > 1e-9) {
      throw new TranslateError(at, 'CanvasLayer.rotation and rotation_degrees disagree.');
    }
  }

  const transform = transform2D(props['transform'], at);
  if (
    transform !== undefined &&
    (props['offset'] !== undefined || props['scale'] !== undefined || props['rotation'] !== undefined ||
      props['rotation_degrees'] !== undefined)
  ) {
    throw new TranslateError(
      at,
      'CanvasLayer authors both `transform` and decomposed offset/rotation/scale; property order is not retained, so their final affine value is ambiguous.',
    );
  }

  const follow3 = props['follow_viewport_enable'];
  const follow4 = props['follow_viewport_enabled'];
  if (follow3 !== undefined && follow4 !== undefined) {
    throw new TranslateError(at, 'CanvasLayer authors both Godot 3 and Godot 4 follow-viewport spellings.');
  }
  const followsViewport = boolValue(follow3 ?? follow4, false, at, 'follow_viewport_enabled');
  const followScale = finiteNumber(props, 'follow_viewport_scale', 1, at);
  const customViewport = props['custom_viewport'];
  const deviations: string[] = [];
  if (customViewport !== undefined && customViewport.kind !== 'null') {
    deviations.push(
      '`custom_viewport` targets a separate Viewport canvas, while this projection owns one DOM overlay and has no second viewport surface to attach the layer to',
    );
  }
  if (followsViewport) {
    deviations.push(
      '`follow_viewport_enable(d)` makes the layer inherit the active 2D viewport canvas transform' +
        (followScale === 1 ? '' : ` at scale ${String(followScale)}`) +
        '; the Three/DOM overlay has no Camera2D canvas transform to inherit',
    );
  }
  return { layer, visible, offset, scale, rotationDegrees: degrees, ...(transform === undefined ? {} : { transform }), deviations };
}

function finiteNumber(props: Properties, key: string, fallback: number, at: string): number {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'number' || !Number.isFinite(value.value)) {
    throw new TranslateError(at, `CanvasLayer.${key} must be a finite number.`);
  }
  return value.value;
}

function bool(props: Properties, key: string, fallback: boolean, at: string): boolean {
  return boolValue(props[key], fallback, at, key);
}

function boolValue(value: GodotValue | undefined, fallback: boolean, at: string, key: string): boolean {
  if (value === undefined) return fallback;
  if (value.kind !== 'bool') throw new TranslateError(at, `CanvasLayer.${key} must be bool.`);
  return value.value;
}

function point(
  props: Properties,
  key: string,
  fallback: { readonly x: number; readonly y: number },
  at: string,
): { readonly x: number; readonly y: number } {
  const value = props[key];
  if (
    value === undefined
  ) return fallback;
  if (
    value.kind !== 'ctor' || value.name !== 'Vector2' || value.args.length !== 2 ||
    value.args[0]?.kind !== 'number' || value.args[1]?.kind !== 'number' ||
    !Number.isFinite(value.args[0].value) || !Number.isFinite(value.args[1].value)
  ) {
    throw new TranslateError(at, `CanvasLayer.${key} must be a finite Vector2.`);
  }
  return { x: value.args[0].value, y: value.args[1].value };
}

function transform2D(
  value: GodotValue | undefined,
  at: string,
): readonly [number, number, number, number, number, number] | undefined {
  if (value === undefined) return undefined;
  if (
    value.kind !== 'ctor' || value.name !== 'Transform2D' || value.args.length !== 6 ||
    value.args.some((part) => part.kind !== 'number' || !Number.isFinite(part.value))
  ) {
    throw new TranslateError(at, 'CanvasLayer.transform must be a finite six-component Transform2D.');
  }
  return value.args.map((part) => (part as Extract<GodotValue, { kind: 'number' }>).value) as unknown as readonly [number, number, number, number, number, number];
}
