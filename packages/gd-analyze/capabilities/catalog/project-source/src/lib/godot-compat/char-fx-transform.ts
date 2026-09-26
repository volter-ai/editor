/** Godot CharFXTransform retained per-glyph rich-text effect state. */

import { godotColor } from './color';
import { registerGodotObjectIdentity } from './object';
import { godotTransform2DNew, type GodotTransform2D } from './transform-2d';
import { godotDictionary, type GodotDictionary } from './variant';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export interface GodotCharFXRange { readonly x: number; readonly y: number }
export type GodotCharFXRID = unknown;

function int(value: number, member: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`CharFXTransform.${member} requires int >= ${minimum}.`);
  return value;
}
function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`CharFXTransform.${member} requires finite float.`);
  return value;
}

export class GodotCharFXTransform {
  private transform = godotTransform2DNew();
  private range: GodotCharFXRange = { x: 0, y: 0 };
  private elapsedTime = 0;
  private visible = true;
  private outline = false;
  private offset: Vector2 = { x: 0, y: 0 };
  private color: ColorValue = godotColor(1, 1, 1, 1);
  private environment: GodotDictionary<unknown, unknown> = godotDictionary();
  private glyphIndex = 0;
  private relativeIndex = 0;
  private glyphCount = 0;
  private glyphFlags = 0;
  private font: GodotCharFXRID = null;

  constructor() { registerGodotObjectIdentity(this, 'CharFXTransform'); }
  get_transform(): GodotTransform2D { return godotTransform2DNew(this.transform); }
  set_transform(transform: GodotTransform2D): void { this.transform = godotTransform2DNew(transform); }
  get_range(): GodotCharFXRange { return { ...this.range }; }
  set_range(range: GodotCharFXRange): void {
    const start = int(range.x, 'range.x', 0), end = int(range.y, 'range.y', 0);
    if (end < start) throw new RangeError('CharFXTransform.range end must be >= start.');
    this.range = { x: start, y: end };
  }
  get_elapsed_time(): number { return this.elapsedTime; }
  set_elapsed_time(time: number): void { this.elapsedTime = finite(time, 'elapsed_time'); }
  is_visible(): boolean { return this.visible; }
  set_visibility(visibility: boolean): void { this.visible = Boolean(visibility); }
  is_outline(): boolean { return this.outline; }
  set_outline(outline: boolean): void { this.outline = Boolean(outline); }
  get_offset(): Vector2 { return { ...this.offset }; }
  set_offset(offset: Vector2): void { this.offset = { x: finite(offset.x, 'offset.x'), y: finite(offset.y, 'offset.y') }; }
  get_color(): ColorValue { return godotColor(this.color.r, this.color.g, this.color.b, this.color.a); }
  set_color(color: ColorValue): void { this.color = godotColor(color.r, color.g, color.b, color.a); }
  get_environment(): GodotDictionary<unknown, unknown> { return godotDictionary([...this.environment]); }
  set_environment(environment: GodotDictionary<unknown, unknown> | Readonly<Record<string, unknown>>): void {
    this.environment = environment instanceof Map
      ? godotDictionary([...environment])
      : godotDictionary(Object.entries(environment));
  }
  get_glyph_index(): number { return this.glyphIndex; }
  set_glyph_index(glyphIndex: number): void { this.glyphIndex = int(glyphIndex, 'glyph_index', 0); }
  get_relative_index(): number { return this.relativeIndex; }
  set_relative_index(relativeIndex: number): void { this.relativeIndex = int(relativeIndex, 'relative_index', 0); }
  get_glyph_count(): number { return this.glyphCount; }
  set_glyph_count(glyphCount: number): void { this.glyphCount = int(glyphCount, 'glyph_count', 0); }
  get_glyph_flags(): number { return this.glyphFlags; }
  set_glyph_flags(glyphFlags: number): void { this.glyphFlags = int(glyphFlags, 'glyph_flags', 0); }
  get_font(): GodotCharFXRID { return this.font; }
  set_font(font: GodotCharFXRID): void { this.font = font; }
}

export function createGodotCharFXTransform(): GodotCharFXTransform { return new GodotCharFXTransform(); }
