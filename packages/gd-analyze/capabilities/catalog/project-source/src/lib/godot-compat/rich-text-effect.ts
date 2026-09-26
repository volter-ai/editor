/** Retained RichTextEffect and per-glyph CharFXTransform state. */

import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol } from './resource-io';
import type { ColorValue } from './variant';
import type { ControlPoint } from './control-state';

function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires finite number.`);
  return value;
}

function integer(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${member} requires int.`);
  return value;
}

function bool(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function point(member: string, value: ControlPoint): ControlPoint {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError(`${member} requires finite Vector2.`);
  return { x: value.x, y: value.y };
}

function color(member: string, value: ColorValue): ColorValue {
  if (typeof value !== 'object' || value === null || ![value.r, value.g, value.b, value.a].every(Number.isFinite)) throw new TypeError(`${member} requires Color.`);
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

export interface GodotCharFxTransform {
  elapsed_time: number;
  env: Map<unknown, unknown>;
  relative_index: number;
  absolute_index: number;
  visibility: boolean;
  outline: boolean;
  offset: ControlPoint;
  color: ColorValue;
  glyph_index: number;
  glyph_flags: number;
  glyph_count: number;
  glyph_repeat: number;
  font: unknown | null;
}

export interface GodotRichTextEffect {
  bbcode: string;
  _process_custom_fx(transform: GodotCharFxTransform): boolean;
  process_custom_fx(transform: GodotCharFxTransform): boolean;
  set_process(callback: (transform: GodotCharFxTransform) => boolean): void;
}

export function createGodotCharFxTransform(initial: Partial<GodotCharFxTransform> = {}): GodotCharFxTransform {
  let elapsedTime = finite('CharFXTransform.elapsed_time', initial.elapsed_time ?? 0);
  let env = new Map(initial.env ?? []);
  let relativeIndex = integer('CharFXTransform.relative_index', initial.relative_index ?? 0);
  let absoluteIndex = integer('CharFXTransform.absolute_index', initial.absolute_index ?? 0);
  let visibility = bool('CharFXTransform.visibility', initial.visibility ?? true);
  let outline = bool('CharFXTransform.outline', initial.outline ?? false);
  let offset = point('CharFXTransform.offset', initial.offset ?? { x: 0, y: 0 });
  let tint = color('CharFXTransform.color', initial.color ?? { r: 1, g: 1, b: 1, a: 1 });
  let glyphIndex = integer('CharFXTransform.glyph_index', initial.glyph_index ?? 0);
  let glyphFlags = integer('CharFXTransform.glyph_flags', initial.glyph_flags ?? 0);
  let glyphCount = integer('CharFXTransform.glyph_count', initial.glyph_count ?? 1);
  let glyphRepeat = integer('CharFXTransform.glyph_repeat', initial.glyph_repeat ?? 1);
  let font: unknown = initial.font ?? null;
  const transform = {} as GodotCharFxTransform;
  Object.defineProperties(transform, {
    elapsed_time: { enumerable: true, configurable: true, get: () => elapsedTime, set: (value: number) => { elapsedTime = finite('CharFXTransform.elapsed_time', value); } },
    env: { enumerable: true, configurable: true, get: () => env, set: (value: Map<unknown, unknown>) => { if (!(value instanceof Map)) throw new TypeError('CharFXTransform.env requires Dictionary.'); env = new Map(value); } },
    relative_index: { enumerable: true, configurable: true, get: () => relativeIndex, set: (value: number) => { relativeIndex = integer('CharFXTransform.relative_index', value); } },
    absolute_index: { enumerable: true, configurable: true, get: () => absoluteIndex, set: (value: number) => { absoluteIndex = integer('CharFXTransform.absolute_index', value); } },
    visibility: { enumerable: true, configurable: true, get: () => visibility, set: (value: boolean) => { visibility = bool('CharFXTransform.visibility', value); } },
    outline: { enumerable: true, configurable: true, get: () => outline, set: (value: boolean) => { outline = bool('CharFXTransform.outline', value); } },
    offset: { enumerable: true, configurable: true, get: () => ({ ...offset }), set: (value: ControlPoint) => { offset = point('CharFXTransform.offset', value); } },
    color: { enumerable: true, configurable: true, get: () => ({ ...tint }), set: (value: ColorValue) => { tint = color('CharFXTransform.color', value); } },
    glyph_index: { enumerable: true, configurable: true, get: () => glyphIndex, set: (value: number) => { glyphIndex = integer('CharFXTransform.glyph_index', value); } },
    glyph_flags: { enumerable: true, configurable: true, get: () => glyphFlags, set: (value: number) => { glyphFlags = integer('CharFXTransform.glyph_flags', value); } },
    glyph_count: { enumerable: true, configurable: true, get: () => glyphCount, set: (value: number) => { glyphCount = integer('CharFXTransform.glyph_count', value); } },
    glyph_repeat: { enumerable: true, configurable: true, get: () => glyphRepeat, set: (value: number) => { glyphRepeat = integer('CharFXTransform.glyph_repeat', value); } },
    font: { enumerable: true, configurable: true, get: () => font, set: (value: unknown | null) => { font = value; } },
  });
  registerGodotObjectIdentity(transform, 'CharFXTransform');
  return transform;
}

export function createGodotRichTextEffect(bbcode = ''): GodotRichTextEffect {
  if (typeof bbcode !== 'string') throw new TypeError('RichTextEffect.bbcode requires String.');
  let tag = bbcode;
  let callback: (transform: GodotCharFxTransform) => boolean = () => true;
  const effect = {} as GodotRichTextEffect;
  Object.defineProperty(effect, 'bbcode', { enumerable: true, configurable: true, get: () => tag, set: (value: string) => { if (typeof value !== 'string') throw new TypeError('RichTextEffect.bbcode requires String.'); tag = value; } });
  effect._process_custom_fx = (transform): boolean => callback(transform);
  effect.process_custom_fx = (transform): boolean => {
    if (typeof transform !== 'object' || transform === null) throw new TypeError('RichTextEffect.process_custom_fx requires CharFXTransform.');
    return bool('RichTextEffect._process_custom_fx return', effect._process_custom_fx(transform));
  };
  effect.set_process = (next): void => { if (typeof next !== 'function') throw new TypeError('RichTextEffect.set_process requires Callable.'); callback = next; };
  registerGodotObjectIdentity(effect, 'RichTextEffect');
  bindGodotResourceProtocol(effect, {
    createDuplicate: () => createGodotRichTextEffect(tag),
    populateDuplicate: () => {},
  });
  return effect;
}
