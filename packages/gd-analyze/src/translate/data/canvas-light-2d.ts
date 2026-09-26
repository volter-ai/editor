/** Authored-data extraction for retained Pixi CanvasItem lighting. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface LightPoint { readonly x: number; readonly y: number }
export interface LightColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

export interface AuthoredCanvasLight2DSpec {
  readonly major: 3 | 4;
  readonly kind: 'point' | 'directional';
  readonly enabled: boolean;
  readonly editorOnly: boolean;
  readonly color: LightColor;
  readonly energy: number;
  readonly blendMode: number;
  readonly rangeZMin: number;
  readonly rangeZMax: number;
  readonly rangeLayerMin: number;
  readonly rangeLayerMax: number;
  readonly itemCullMask: number;
  readonly shadowEnabled: boolean;
  readonly shadowColor: LightColor;
  readonly shadowFilter: number;
  readonly shadowSmooth: number;
  readonly shadowBufferSize: number;
  readonly shadowGradientLength: number;
  readonly shadowItemCullMask: number;
  readonly texture: GodotValue | undefined;
  readonly offset: LightPoint;
  readonly textureScale: number;
  readonly height: number;
  readonly maxDistance: number;
}

export interface AuthoredCanvasLightOccluder2DSpec {
  readonly occluder: GodotValue | undefined;
  readonly sdfCollision: boolean;
  readonly lightMask: number;
}

export interface AuthoredOccluderPolygon2DSpec {
  readonly points: readonly LightPoint[];
  readonly closed: boolean;
  readonly cullMode: number;
}

function finite(props: Readonly<Record<string, GodotValue>>, key: string, fallback: number, at: string): number {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'number' || !Number.isFinite(value.value)) throw new TranslateError(at, `${key} must be a finite number.`);
  return value.value;
}

function integer(props: Readonly<Record<string, GodotValue>>, key: string, fallback: number, at: string): number {
  const value = finite(props, key, fallback, at);
  if (!Number.isSafeInteger(value)) throw new TranslateError(at, `${key} must be an integer.`);
  return value;
}

function boolean(props: Readonly<Record<string, GodotValue>>, key: string, fallback: boolean, at: string): boolean {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'bool') throw new TranslateError(at, `${key} must be bool.`);
  return value.value;
}

function color(props: Readonly<Record<string, GodotValue>>, key: string, fallback: LightColor, at: string): LightColor {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'ctor' || value.name !== 'Color' || value.args.length < 3 || value.args.length > 4 ||
      value.args.some((component) => component.kind !== 'number' || !Number.isFinite(component.value))) {
    throw new TranslateError(at, `${key} must be a finite Color.`);
  }
  const parts = value.args as readonly { readonly kind: 'number'; readonly value: number }[];
  return { r: parts[0]!.value, g: parts[1]!.value, b: parts[2]!.value, a: parts[3]?.value ?? 1 };
}

function point(props: Readonly<Record<string, GodotValue>>, key: string, at: string): LightPoint {
  const value = props[key];
  if (value === undefined) return { x: 0, y: 0 };
  if (value.kind !== 'ctor' || value.name !== 'Vector2' || value.args.length !== 2 ||
      value.args[0]?.kind !== 'number' || value.args[1]?.kind !== 'number' ||
      !Number.isFinite(value.args[0].value) || !Number.isFinite(value.args[1].value)) {
    throw new TranslateError(at, `${key} must be a finite Vector2.`);
  }
  return { x: value.args[0].value, y: value.args[1].value };
}

function enumValue(props: Readonly<Record<string, GodotValue>>, key: string, fallback: number, max: number, at: string): number {
  const value = integer(props, key, fallback, at);
  if (value < 0 || value > max) throw new TranslateError(at, `${key} must be an enum from 0 through ${max}.`);
  return value;
}

export function readCanvasLight2DSpec(
  props: Readonly<Record<string, GodotValue>>,
  godotClass: string,
  major: 3 | 4,
  at: string,
): AuthoredCanvasLight2DSpec {
  const pointKey = 'offset';
  return {
    major,
    kind: godotClass === 'DirectionalLight2D' ? 'directional' : 'point',
    enabled: boolean(props, 'enabled', true, at),
    editorOnly: boolean(props, 'editor_only', false, at),
    color: color(props, 'color', { r: 1, g: 1, b: 1, a: 1 }, at),
    energy: finite(props, 'energy', 1, at),
    blendMode: enumValue(props, major === 3 ? 'mode' : 'blend_mode', 0, major === 3 ? 3 : 2, at),
    rangeZMin: integer(props, 'range_z_min', -1024, at),
    rangeZMax: integer(props, 'range_z_max', 1024, at),
    rangeLayerMin: integer(props, 'range_layer_min', -512, at),
    rangeLayerMax: integer(props, 'range_layer_max', 512, at),
    itemCullMask: integer(props, 'range_item_cull_mask', 1, at),
    shadowEnabled: boolean(props, 'shadow_enabled', false, at),
    shadowColor: color(props, 'shadow_color', { r: 0, g: 0, b: 0, a: 0 }, at),
    shadowFilter: enumValue(props, 'shadow_filter', 0, major === 3 ? 5 : 2, at),
    shadowSmooth: finite(props, 'shadow_filter_smooth', 0, at),
    shadowBufferSize: integer(props, 'shadow_buffer_size', 2048, at),
    shadowGradientLength: finite(props, 'shadow_gradient_length', 0, at),
    shadowItemCullMask: integer(props, 'shadow_item_cull_mask', 1, at),
    texture: props['texture'],
    offset: point(props, pointKey, at),
    textureScale: finite(props, 'texture_scale', 1, at),
    height: finite(props, major === 3 ? 'range_height' : 'height', 0, at),
    maxDistance: finite(props, 'max_distance', 10_000, at),
  };
}

export function readCanvasLightOccluder2DSpec(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): AuthoredCanvasLightOccluder2DSpec {
  return {
    occluder: props['occluder'],
    sdfCollision: boolean(props, 'sdf_collision', true, at),
    lightMask: integer(props, props['occluder_light_mask'] === undefined ? 'light_mask' : 'occluder_light_mask', 1, at),
  };
}

export function readCanvasItemLightMask(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): number {
  return integer(props, 'light_mask', 1, at);
}

export function readCanvasLayerIndex(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): number {
  return integer(props, 'layer', 1, at);
}

export function readOccluderPolygon2DSpec(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): AuthoredOccluderPolygon2DSpec {
  const value = props['polygon'];
  const items = value === undefined
    ? []
    : value.kind === 'array'
      ? value.items
      : value.kind === 'ctor' && (value.name === 'PoolVector2Array' || value.name === 'PackedVector2Array')
        ? value.args
        : null;
  if (items === null) throw new TranslateError(at, 'polygon must be PackedVector2Array.');
  const points: LightPoint[] = [];
  if (items.every((item) => item.kind === 'number')) {
    if (items.length % 2 !== 0) throw new TranslateError(at, 'polygon must contain complete Vector2 coordinate pairs.');
    for (let index = 0; index < items.length; index += 2) {
      const x = items[index];
      const y = items[index + 1];
      if (x?.kind !== 'number' || y?.kind !== 'number' || !Number.isFinite(x.value) || !Number.isFinite(y.value)) {
        throw new TranslateError(at, `polygon[${index / 2}] must be a finite Vector2.`);
      }
      points.push({ x: x.value, y: y.value });
    }
  } else {
    for (const [index, item] of items.entries()) {
      if (item.kind !== 'ctor' || item.name !== 'Vector2' || item.args.length !== 2 ||
          item.args[0]?.kind !== 'number' || item.args[1]?.kind !== 'number' ||
          !Number.isFinite(item.args[0].value) || !Number.isFinite(item.args[1].value)) {
        throw new TranslateError(at, `polygon[${index}] must be a finite Vector2.`);
      }
      points.push({ x: item.args[0].value, y: item.args[1].value });
    }
  }
  return {
    points,
    closed: boolean(props, 'closed', true, at),
    cullMode: enumValue(props, 'cull_mode', 0, 2, at),
  };
}
