/** Godot 4 TextLine resource over the retained TextServer shaped-text buffer. */

import type { GodotFont } from './font';
import type { GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import { godotResourceGetRid } from './resource-io';
import {
  godotTextServerCreateShapedText,
  godotTextServerShapedTextAddObject,
  godotTextServerShapedTextAddString,
  godotTextServerShapedTextClear,
  godotTextServerShapedTextDraw,
  godotTextServerShapedTextDrawOutline,
  godotTextServerShapedTextFitToWidth,
  godotTextServerShapedTextGetAscent,
  godotTextServerShapedTextGetDescent,
  godotTextServerShapedTextGetDominantDirectionInRange,
  godotTextServerShapedTextGetGraphemeBounds,
  godotTextServerShapedTextGetObjectRect,
  godotTextServerShapedTextGetObjects,
  godotTextServerShapedTextGetOrientation,
  godotTextServerShapedTextGetPreserveControl,
  godotTextServerShapedTextGetPreserveInvalid,
  godotTextServerShapedTextGetRange,
  godotTextServerShapedTextGetSize,
  godotTextServerShapedTextGetUnderlinePosition,
  godotTextServerShapedTextGetUnderlineThickness,
  godotTextServerShapedTextGetWidth,
  godotTextServerShapedTextHitTestGrapheme,
  godotTextServerShapedTextResizeObject,
  godotTextServerShapedTextSetBidiOverride,
  godotTextServerShapedTextSetCustomEllipsis,
  godotTextServerShapedTextSetDirection,
  godotTextServerShapedTextSetOrientation,
  godotTextServerShapedTextSetPreserveControl,
  godotTextServerShapedTextSetPreserveInvalid,
  godotTextServerShapedTextShape,
  godotTextServerShapedTextTabAlign,
} from './text-server-shaped';

export class GodotTextLine {
  private readonly shaped: GodotRid;
  private widthValue = -1;
  private alignmentValue = 0;
  private flagsValue = 3;
  private tabStopsValue: number[] = [];
  private overrunBehaviorValue = 0;
  private ellipsisCharValue = 0x2026;

  constructor(direction = 0, orientation = 0) {
    this.shaped = godotTextServerCreateShapedText(direction, orientation);
    registerGodotObjectIdentity(this, 'TextLine');
  }

  get direction(): number { return this.get_direction(); }
  set direction(value: number) { this.set_direction(value); }
  get orientation(): number { return this.get_orientation(); }
  set orientation(value: number) { this.set_orientation(value); }
  get preserve_invalid(): boolean { return this.get_preserve_invalid(); }
  set preserve_invalid(value: boolean) { this.set_preserve_invalid(value); }
  get preserve_control(): boolean { return this.get_preserve_control(); }
  set preserve_control(value: boolean) { this.set_preserve_control(value); }
  get width(): number { return this.get_width(); }
  set width(value: number) { this.set_width(value); }
  get alignment(): number { return this.get_alignment(); }
  set alignment(value: number) { this.set_alignment(value); }
  get flags(): number { return this.get_flags(); }
  set flags(value: number) { this.set_flags(value); }
  get tab_stops(): number[] { return this.get_tab_stops(); }
  set tab_stops(value: number[]) { this.set_tab_stops(value); }
  get text_overrun_behavior(): number { return this.get_text_overrun_behavior(); }
  set text_overrun_behavior(value: number) { this.set_text_overrun_behavior(value); }
  get ellipsis_char(): number { return this.get_ellipsis_char(); }
  set ellipsis_char(value: number) { this.set_ellipsis_char(value); }

  clear(): void {
    godotTextServerShapedTextClear(this.shaped);
  }

  set_direction(direction: number): void { godotTextServerShapedTextSetDirection(this.shaped, direction); }
  get_direction(): number { return godotTextServerShapedTextGetDominantDirectionInRange(this.shaped, 0, this.get_character_count()); }
  set_orientation(orientation: number): void { godotTextServerShapedTextSetOrientation(this.shaped, orientation); }
  get_orientation(): number { return godotTextServerShapedTextGetOrientation(this.shaped); }
  set_preserve_invalid(enabled: boolean): void { godotTextServerShapedTextSetPreserveInvalid(this.shaped, enabled); }
  get_preserve_invalid(): boolean { return godotTextServerShapedTextGetPreserveInvalid(this.shaped); }
  set_preserve_control(enabled: boolean): void { godotTextServerShapedTextSetPreserveControl(this.shaped, enabled); }
  get_preserve_control(): boolean { return godotTextServerShapedTextGetPreserveControl(this.shaped); }
  set_bidi_override(override: readonly unknown[]): void { godotTextServerShapedTextSetBidiOverride(this.shaped, override); }

  add_string(text: string, font: GodotFont, fontSize: number, language = '', meta: unknown = null): boolean {
    if (typeof font !== 'object' || font === null) throw new TypeError('TextLine.add_string requires Font.');
    return godotTextServerShapedTextAddString(this.shaped, text, [godotResourceGetRid(font as object)], fontSize, {}, language, meta);
  }

  add_object(key: unknown, size: unknown, inlineAlign = 5, length = 1, baseline = 0): boolean {
    return godotTextServerShapedTextAddObject(this.shaped, key, size, inlineAlign, length, baseline);
  }

  resize_object(key: unknown, size: unknown, inlineAlign = 5, baseline = 0): boolean {
    return godotTextServerShapedTextResizeObject(this.shaped, key, size, inlineAlign, baseline);
  }

  set_width(width: number): void {
    if (!Number.isFinite(width) || width < -1) throw new RangeError('TextLine.width requires -1 or non-negative finite value.');
    this.widthValue = width;
    if (width >= 0) godotTextServerShapedTextFitToWidth(this.shaped, width, this.flagsValue);
  }
  get_width(): number { return this.widthValue; }

  set_alignment(alignment: number): void {
    if (!Number.isSafeInteger(alignment) || alignment < 0 || alignment > 3) throw new RangeError('TextLine.alignment requires 0..3.');
    this.alignmentValue = alignment;
  }
  get_alignment(): number { return this.alignmentValue; }

  set_flags(flags: number): void {
    if (!Number.isSafeInteger(flags) || flags < 0) throw new RangeError('TextLine.flags requires non-negative integer.');
    this.flagsValue = flags;
    if (this.widthValue >= 0) godotTextServerShapedTextFitToWidth(this.shaped, this.widthValue, flags);
  }
  get_flags(): number { return this.flagsValue; }

  set_tab_stops(stops: readonly number[]): void {
    if (!Array.isArray(stops) || stops.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new TypeError('TextLine.tab_stops requires PackedFloat32Array of non-negative values.');
    this.tabStopsValue = [...stops];
    godotTextServerShapedTextTabAlign(this.shaped, this.tabStopsValue);
  }
  get_tab_stops(): number[] { return [...this.tabStopsValue]; }

  set_text_overrun_behavior(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new RangeError('TextLine.text_overrun_behavior requires 0..6.');
    this.overrunBehaviorValue = value;
  }
  get_text_overrun_behavior(): number { return this.overrunBehaviorValue; }

  set_ellipsis_char(character: number): void {
    if (!Number.isSafeInteger(character) || character < 0 || character > 0x10ffff) throw new RangeError('TextLine.ellipsis_char requires valid Unicode scalar.');
    this.ellipsisCharValue = character;
    godotTextServerShapedTextSetCustomEllipsis(this.shaped, character);
  }
  get_ellipsis_char(): number { return this.ellipsisCharValue; }

  get_objects(): unknown[] { return godotTextServerShapedTextGetObjects(this.shaped); }
  get_rid(): GodotRid { return this.shaped; }
  get_object_rect(key: unknown): unknown { return godotTextServerShapedTextGetObjectRect(this.shaped, key); }
  get_size(): { x: number; y: number } { this.shape(); return godotTextServerShapedTextGetSize(this.shaped); }
  get_line_ascent(): number { this.shape(); return godotTextServerShapedTextGetAscent(this.shaped); }
  get_line_descent(): number { this.shape(); return godotTextServerShapedTextGetDescent(this.shaped); }
  get_line_width(): number { this.shape(); return godotTextServerShapedTextGetWidth(this.shaped); }
  get_line_underline_position(): number { this.shape(); return godotTextServerShapedTextGetUnderlinePosition(this.shaped); }
  get_line_underline_thickness(): number { this.shape(); return godotTextServerShapedTextGetUnderlineThickness(this.shaped); }
  get_character_count(): number {
    return godotTextServerShapedTextGetRange(this.shaped).y;
  }
  hit_test(position: number): number { return godotTextServerShapedTextHitTestGrapheme(this.shaped, position); }

  draw(canvasItem: GodotRid, position: unknown, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    if (!Number.isFinite(oversampling) || oversampling < 0) throw new RangeError('TextLine.draw oversampling requires non-negative finite value.');
    this.shape(); godotTextServerShapedTextDraw(this.shaped, canvasItem, position, -1, -1, color);
  }
  draw_outline(canvasItem: GodotRid, position: unknown, outlineSize = 1, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    if (!Number.isFinite(oversampling) || oversampling < 0) throw new RangeError('TextLine.draw_outline oversampling requires non-negative finite value.');
    this.shape(); godotTextServerShapedTextDrawOutline(this.shaped, canvasItem, position, -1, -1, outlineSize, color);
  }

  private shape(): void {
    godotTextServerShapedTextShape(this.shaped);
    if (this.widthValue >= 0) godotTextServerShapedTextFitToWidth(this.shaped, this.widthValue, this.flagsValue);
  }
}

export function createGodotTextLine(direction = 0, orientation = 0): GodotTextLine {
  return new GodotTextLine(direction, orientation);
}
