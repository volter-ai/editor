/** Font.draw_string/multiline_string over retained Pixi CanvasItem RIDs. */

import { Container, Text } from 'pixi.js';
import type { GodotFont } from './font';
import { godotFontCanvasPresentation } from './font';
import { godotFontCharSize } from './font';
import type { GodotRid } from './gdscript-builtins';
import { markInternalCanvasChild } from './node';
import { godotResourceOfRid } from './resource-io';
import type { ColorValue } from './variant';

interface FontDrawOptions {
  alignment: number;
  width: number;
  size: number;
  modulate: ColorValue;
  justificationFlags: number;
  direction: number;
  orientation: number;
  oversampling: number;
  outlineSize: number;
  maxLines: number;
  multiline: boolean;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Font.${member} requires finite number.`);
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Font.${member} requires integer ${minimum}..${maximum}.`);
  }
  return value;
}

function point(value: unknown, member: string): { x: number; y: number } {
  if (typeof value !== 'object' || value === null) throw new TypeError(`Font.${member} requires Vector2.`);
  return { x: finite(Reflect.get(value, 'x'), `${member}.x`), y: finite(Reflect.get(value, 'y'), `${member}.y`) };
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError(`Font.${member} requires Color.`);
  return {
    r: finite(Reflect.get(value, 'r'), `${member}.r`), g: finite(Reflect.get(value, 'g'), `${member}.g`),
    b: finite(Reflect.get(value, 'b'), `${member}.b`), a: finite(Reflect.get(value, 'a'), `${member}.a`),
  };
}

function target(rid: GodotRid, member: string): Container {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Container)) throw new TypeError(`Font.${member} canvas_item RID requires retained Pixi CanvasItem.`);
  return retained;
}

function pixiColor(value: ColorValue): { color: number; alpha: number } {
  const byte = (entry: number): number => Math.round(Math.max(0, Math.min(1, entry)) * 255);
  return { color: byte(value.r) * 0x10000 + byte(value.g) * 0x100 + byte(value.b), alpha: Math.max(0, Math.min(1, value.a)) };
}

function normalizedText(text: unknown, maxLines: number): string {
  if (typeof text !== 'string') throw new TypeError('Font draw text requires String.');
  if (maxLines < 0) return text;
  return text.split('\n').slice(0, maxLines).join('\n');
}

function renderFontText(font: GodotFont, rid: GodotRid, positionValue: unknown, textValue: unknown, options: FontDrawOptions): number {
  const owner = target(rid, options.multiline ? 'draw_multiline_string' : 'draw_string');
  const position = point(positionValue, options.multiline ? 'draw_multiline_string.position' : 'draw_string.position');
  const presentation = godotFontCanvasPresentation(font, options.size);
  const text = normalizedText(textValue, options.maxLines);
  const tint = pixiColor(options.modulate);
  const align = options.alignment === 1 ? 'center' : options.alignment === 2 ? 'right' : 'left';
  const drawable = markInternalCanvasChild(new Text({
    text,
    style: {
      fill: tint.color,
      fontFamily: [...presentation.fontFamily],
      fontSize: presentation.fontSize,
      fontStyle: presentation.fontStyle,
      fontWeight: presentation.fontWeight,
      letterSpacing: presentation.letterSpacing,
      align,
      wordWrap: options.width >= 0,
      wordWrapWidth: options.width >= 0 ? options.width : 100000,
      whiteSpace: 'pre',
      ...(options.outlineSize > 0 ? { stroke: { color: tint.color, width: options.outlineSize * 2 } } :
        presentation.outline === null ? {} : { stroke: { color: presentation.outline.color, width: presentation.outline.size * 2 } }),
    },
  }));
  drawable.alpha = tint.alpha;
  drawable.position.set(position.x, position.y - presentation.ascent);
  if (options.width >= 0 && options.alignment === 1) drawable.position.x += options.width / 2;
  if (options.width >= 0 && options.alignment === 2) drawable.position.x += options.width;
  drawable.anchor.x = options.alignment === 1 ? 0.5 : options.alignment === 2 ? 1 : 0;
  if (options.direction === 2) drawable.scale.x = -1;
  if (options.orientation === 1) drawable.rotation = Math.PI / 2;
  owner.addChild(drawable);
  return drawable.width;
}

function common(
  alignmentValue: unknown,
  widthValue: unknown,
  sizeValue: unknown,
  modulateValue: unknown,
  justificationValue: unknown,
  directionValue: unknown,
  orientationValue: unknown,
  oversamplingValue: unknown,
  outlineSizeValue: unknown,
  maxLinesValue: unknown,
  multiline: boolean,
): FontDrawOptions {
  const alignment = integer(alignmentValue, 'draw alignment', -1, 3);
  const width = finite(widthValue, 'draw width');
  if (width < -1) throw new RangeError('Font draw width requires -1 or non-negative value.');
  const size = integer(sizeValue, 'draw font_size', 1, 4096);
  const justificationFlags = integer(justificationValue, 'draw justification_flags', 0, 0x7fffffff);
  const direction = integer(directionValue, 'draw direction', 0, 3);
  const orientation = integer(orientationValue, 'draw orientation', 0, 1);
  const oversampling = finite(oversamplingValue, 'draw oversampling');
  if (oversampling < 0) throw new RangeError('Font draw oversampling requires non-negative value.');
  const outlineSize = integer(outlineSizeValue, 'draw outline_size', 0, 1024);
  const maxLines = integer(maxLinesValue, 'draw max_lines', -1, 0x7fffffff);
  return { alignment, width, size, modulate: color(modulateValue, 'draw modulate'), justificationFlags, direction, orientation, oversampling, outlineSize, maxLines, multiline };
}

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

export function godotFontDrawString(
  font: GodotFont, canvasItem: GodotRid, position: unknown, text: unknown,
  alignment: unknown = -1, width: unknown = -1, fontSize: unknown = 16,
  modulate: unknown = WHITE, justificationFlags: unknown = 3, direction: unknown = 0,
  orientation: unknown = 0, oversampling: unknown = 0,
): number {
  return renderFontText(font, canvasItem, position, text, common(alignment, width, fontSize, modulate, justificationFlags, direction, orientation, oversampling, 0, -1, false));
}

export function godotFontDrawStringOutline(
  font: GodotFont, canvasItem: GodotRid, position: unknown, text: unknown,
  outlineSize: unknown = 1, alignment: unknown = -1, width: unknown = -1, fontSize: unknown = 16,
  modulate: unknown = WHITE, justificationFlags: unknown = 3, direction: unknown = 0,
  orientation: unknown = 0, oversampling: unknown = 0,
): number {
  return renderFontText(font, canvasItem, position, text, common(alignment, width, fontSize, modulate, justificationFlags, direction, orientation, oversampling, outlineSize, -1, false));
}

export function godotFontDrawMultilineString(
  font: GodotFont, canvasItem: GodotRid, position: unknown, text: unknown,
  alignment: unknown = -1, width: unknown = -1, fontSize: unknown = 16, maxLines: unknown = -1,
  modulate: unknown = WHITE, justificationFlags: unknown = 3, direction: unknown = 0,
  orientation: unknown = 0, oversampling: unknown = 0,
): number {
  return renderFontText(font, canvasItem, position, text, common(alignment, width, fontSize, modulate, justificationFlags, direction, orientation, oversampling, 0, maxLines, true));
}

export function godotFontDrawMultilineStringOutline(
  font: GodotFont, canvasItem: GodotRid, position: unknown, text: unknown,
  outlineSize: unknown = 1, alignment: unknown = -1, width: unknown = -1, fontSize: unknown = 16,
  maxLines: unknown = -1, modulate: unknown = WHITE, justificationFlags: unknown = 3,
  direction: unknown = 0, orientation: unknown = 0, oversampling: unknown = 0,
): number {
  return renderFontText(font, canvasItem, position, text, common(alignment, width, fontSize, modulate, justificationFlags, direction, orientation, oversampling, outlineSize, maxLines, true));
}

export function godotFontDrawChar(
  font: GodotFont,
  canvasItem: GodotRid,
  position: unknown,
  characterValue: unknown,
  fontSize: unknown = 16,
  modulate: unknown = WHITE,
): number {
  const character = integer(characterValue, 'draw_char char', 0, 0x10ffff);
  const size = integer(fontSize, 'draw_char font_size', 1, 4096);
  godotFontDrawString(font, canvasItem, position, String.fromCodePoint(character), -1, -1, size, modulate);
  return godotFontCharSize(font, character, size).x;
}

export function godotFontDrawCharOutline(
  font: GodotFont,
  canvasItem: GodotRid,
  position: unknown,
  characterValue: unknown,
  fontSize: unknown = 16,
  outlineSize: unknown = 1,
  modulate: unknown = WHITE,
): number {
  const character = integer(characterValue, 'draw_char_outline char', 0, 0x10ffff);
  const size = integer(fontSize, 'draw_char_outline font_size', 1, 4096);
  godotFontDrawStringOutline(font, canvasItem, position, String.fromCodePoint(character), outlineSize, -1, -1, size, modulate);
  return godotFontCharSize(font, character, size).x;
}
