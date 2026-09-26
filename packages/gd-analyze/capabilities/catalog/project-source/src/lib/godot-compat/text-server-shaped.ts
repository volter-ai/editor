/** Retained TextServer shaped-text buffers for translated custom controls and rich text. */

import type { GodotFontFile } from './font';
import { godotFontAscent, godotFontDescent, godotFontStringSize, godotFontUnderlinePosition, godotFontUnderlineThickness } from './font';
import { godotFontDrawString, godotFontDrawStringOutline } from './font-draw';
import type { GodotRid } from './gdscript-builtins';
import { godotResourceGetRid, godotResourceOfRid } from './resource-io';

export interface GodotShapedTextGlyph {
  start: number;
  end: number;
  count: number;
  repeat: number;
  flags: number;
  offset: { x: number; y: number };
  advance: number;
  font_rid: GodotRid;
  font_size: number;
  index: number;
}

interface ShapedSpan {
  start: number;
  end: number;
  text: string;
  fonts: GodotRid[];
  size: number;
  features: Record<string, number>;
  language: string;
  meta: unknown;
}

interface EmbeddedObject {
  key: unknown;
  position: number;
  size: { x: number; y: number };
  inlineAlign: number;
  length: number;
  baseline: number;
}

interface ShapedState {
  direction: number;
  inferredDirection: number;
  orientation: number;
  bidiOverride: unknown[];
  preserveInvalid: boolean;
  preserveControl: boolean;
  customPunctuation: string;
  text: string;
  spans: ShapedSpan[];
  objects: EmbeddedObject[];
  parent: GodotRid | null;
  ready: boolean;
  width: number;
  customWidth: number | null;
  trimPos: number;
  ellipsisPos: number;
  ellipsisGlyphs: GodotShapedTextGlyph[];
  customEllipsis: number;
}

const SHAPED = new WeakMap<object, ShapedState>();
const ZERO_RID: GodotRid = Object.freeze({ id: 0n });

function integer(value: unknown, member: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`TextServer.${member} requires integer ${minimum}..${maximum}.`);
  return value;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`TextServer.${member} requires finite number.`);
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`TextServer.${member} requires bool.`);
  return value;
}

function string(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`TextServer.${member} requires String.`);
  return value;
}

function point(value: unknown, member: string): { x: number; y: number } {
  if (typeof value !== 'object' || value === null) throw new TypeError(`TextServer.${member} requires Vector2.`);
  return { x: finite(Reflect.get(value, 'x'), `${member}.x`), y: finite(Reflect.get(value, 'y'), `${member}.y`) };
}

function stateOf(rid: GodotRid, member: string): ShapedState {
  const retained = godotResourceOfRid(rid);
  if (typeof retained !== 'object' || retained === null) throw new TypeError(`TextServer.${member} RID requires shaped text buffer.`);
  const state = SHAPED.get(retained);
  if (state === undefined) throw new TypeError(`TextServer.${member} RID requires shaped text buffer.`);
  return state;
}

function fontOf(rid: GodotRid): GodotFontFile | null {
  if (rid.id === 0n) return null;
  const retained = godotResourceOfRid(rid);
  return typeof retained === 'object' && retained !== null && 'fallbacks' in retained ? retained as GodotFontFile : null;
}

function primarySpan(state: ShapedState): ShapedSpan | null { return state.spans[0] ?? null; }

function metrics(state: ShapedState): { width: number; ascent: number; descent: number; height: number } {
  let width = 0;
  let ascent = 0;
  let descent = 0;
  for (const span of state.spans) {
    const font = fontOf(span.fonts[0] ?? ZERO_RID);
    if (font === null) { width += span.text.length * span.size * 0.5; ascent = Math.max(ascent, span.size * 0.8); descent = Math.max(descent, span.size * 0.2); continue; }
    const size = godotFontStringSize(font, span.text, span.size);
    width += size.x;
    ascent = Math.max(ascent, godotFontAscent(font, span.size));
    descent = Math.max(descent, godotFontDescent(font, span.size));
  }
  for (const object of state.objects) width += object.size.x;
  return { width: state.customWidth ?? width, ascent, descent, height: ascent + descent };
}

function glyphs(state: ShapedState): GodotShapedTextGlyph[] {
  const result: GodotShapedTextGlyph[] = [];
  for (const span of state.spans) {
    const fontRid = span.fonts[0] ?? ZERO_RID;
    const font = fontOf(fontRid);
    for (let index = 0; index < span.text.length;) {
      const character = span.text.codePointAt(index)!;
      const length = character > 0xffff ? 2 : 1;
      const advance = font === null ? span.size * 0.5 : godotFontStringSize(font, String.fromCodePoint(character), span.size).x;
      result.push({ start: span.start + index, end: span.start + index + length, count: 1, repeat: 1, flags: 0, offset: { x: 0, y: 0 }, advance, font_rid: fontRid, font_size: span.size, index: character });
      index += length;
    }
  }
  return result;
}

function reshape(state: ShapedState): void { state.ready = true; state.width = metrics(state).width; }

export function godotTextServerCreateShapedText(directionValue = 0, orientationValue = 0): GodotRid {
  const retained = {};
  SHAPED.set(retained, { direction: integer(directionValue, 'create_shaped_text.direction', 0, 3), inferredDirection: 1, orientation: integer(orientationValue, 'create_shaped_text.orientation', 0, 1), bidiOverride: [], preserveInvalid: true, preserveControl: false, customPunctuation: '', text: '', spans: [], objects: [], parent: null, ready: false, width: 0, customWidth: null, trimPos: -1, ellipsisPos: -1, ellipsisGlyphs: [], customEllipsis: 0x2026 });
  return godotResourceGetRid(retained);
}

export function godotTextServerShapedTextClear(rid: GodotRid): void { const state = stateOf(rid, 'shaped_text_clear'); state.text = ''; state.spans.length = 0; state.objects.length = 0; state.ready = false; state.customWidth = null; }
export function godotTextServerShapedTextSetDirection(rid: GodotRid, value: unknown): void { const state = stateOf(rid, 'shaped_text_set_direction'); state.direction = integer(value, 'shaped_text_set_direction', 0, 3); state.ready = false; }
export function godotTextServerShapedTextGetDirection(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_direction').direction; }
export function godotTextServerShapedTextGetInferredDirection(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_inferred_direction').inferredDirection; }
export function godotTextServerShapedTextSetOrientation(rid: GodotRid, value: unknown): void { const state = stateOf(rid, 'shaped_text_set_orientation'); state.orientation = integer(value, 'shaped_text_set_orientation', 0, 1); state.ready = false; }
export function godotTextServerShapedTextGetOrientation(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_orientation').orientation; }
export function godotTextServerShapedTextSetBidiOverride(rid: GodotRid, value: unknown): void { if (!Array.isArray(value)) throw new TypeError('TextServer.shaped_text_set_bidi_override requires Array.'); const state = stateOf(rid, 'shaped_text_set_bidi_override'); state.bidiOverride = [...value]; state.ready = false; }
export function godotTextServerShapedTextSetPreserveInvalid(rid: GodotRid, value: unknown): void { stateOf(rid, 'shaped_text_set_preserve_invalid').preserveInvalid = boolean(value, 'shaped_text_set_preserve_invalid'); }
export function godotTextServerShapedTextGetPreserveInvalid(rid: GodotRid): boolean { return stateOf(rid, 'shaped_text_get_preserve_invalid').preserveInvalid; }
export function godotTextServerShapedTextSetPreserveControl(rid: GodotRid, value: unknown): void { stateOf(rid, 'shaped_text_set_preserve_control').preserveControl = boolean(value, 'shaped_text_set_preserve_control'); }
export function godotTextServerShapedTextGetPreserveControl(rid: GodotRid): boolean { return stateOf(rid, 'shaped_text_get_preserve_control').preserveControl; }
export function godotTextServerShapedTextSetCustomPunctuation(rid: GodotRid, value: unknown): void { stateOf(rid, 'shaped_text_set_custom_punctuation').customPunctuation = string(value, 'shaped_text_set_custom_punctuation'); }
export function godotTextServerShapedTextGetCustomPunctuation(rid: GodotRid): string { return stateOf(rid, 'shaped_text_get_custom_punctuation').customPunctuation; }

export function godotTextServerShapedTextAddString(rid: GodotRid, textValue: unknown, fontsValue: unknown, sizeValue: unknown, featuresValue: unknown = {}, languageValue = '', meta: unknown = null): boolean {
  const state = stateOf(rid, 'shaped_text_add_string');
  const text = string(textValue, 'shaped_text_add_string.text');
  if (!Array.isArray(fontsValue)) throw new TypeError('TextServer.shaped_text_add_string fonts requires Array[RID].');
  const fonts = fontsValue as GodotRid[];
  const size = integer(sizeValue, 'shaped_text_add_string.size', 1, 4096);
  if (typeof featuresValue !== 'object' || featuresValue === null || Array.isArray(featuresValue)) throw new TypeError('TextServer.shaped_text_add_string features requires Dictionary.');
  const start = state.text.length;
  state.text += text;
  state.spans.push({ start, end: state.text.length, text, fonts: [...fonts], size, features: { ...(featuresValue as Record<string, number>) }, language: string(languageValue, 'shaped_text_add_string.language'), meta });
  state.ready = false;
  return true;
}

export function godotTextServerShapedTextAddObject(rid: GodotRid, key: unknown, sizeValue: unknown, inlineAlignValue = 5, lengthValue = 1, baselineValue = 0): boolean {
  const state = stateOf(rid, 'shaped_text_add_object'); const size = point(sizeValue, 'shaped_text_add_object.size');
  state.objects.push({ key, position: state.text.length, size, inlineAlign: integer(inlineAlignValue, 'shaped_text_add_object.inline_align', 0), length: integer(lengthValue, 'shaped_text_add_object.length', 1), baseline: finite(baselineValue, 'shaped_text_add_object.baseline') }); state.ready = false; return true;
}
export function godotTextServerShapedTextResizeObject(rid: GodotRid, key: unknown, sizeValue: unknown, inlineAlignValue = 5, baselineValue = 0): boolean {
  const object = stateOf(rid, 'shaped_text_resize_object').objects.find((candidate) => Object.is(candidate.key, key)); if (object === undefined) return false;
  object.size = point(sizeValue, 'shaped_text_resize_object.size'); object.inlineAlign = integer(inlineAlignValue, 'shaped_text_resize_object.inline_align', 0); object.baseline = finite(baselineValue, 'shaped_text_resize_object.baseline'); return true;
}

export function godotTextServerShapedTextShape(rid: GodotRid): boolean { reshape(stateOf(rid, 'shaped_text_shape')); return true; }
export function godotTextServerShapedTextUpdateBreaks(rid: GodotRid): boolean { reshape(stateOf(rid, 'shaped_text_update_breaks')); return true; }
export function godotTextServerShapedTextUpdateJustificationOps(rid: GodotRid): boolean { reshape(stateOf(rid, 'shaped_text_update_justification_ops')); return true; }
export function godotTextServerShapedTextIsReady(rid: GodotRid): boolean { return stateOf(rid, 'shaped_text_is_ready').ready; }
export function godotTextServerShapedTextGetGlyphs(rid: GodotRid): GodotShapedTextGlyph[] { const state = stateOf(rid, 'shaped_text_get_glyphs'); if (!state.ready) reshape(state); return glyphs(state); }
export function godotTextServerShapedTextSortLogical(rid: GodotRid): GodotShapedTextGlyph[] { return godotTextServerShapedTextGetGlyphs(rid).sort((left, right) => left.start - right.start); }
export function godotTextServerShapedTextGetGlyphCount(rid: GodotRid): number { return godotTextServerShapedTextGetGlyphs(rid).length; }
export function godotTextServerShapedTextGetRange(rid: GodotRid): { x: number; y: number } { const state = stateOf(rid, 'shaped_text_get_range'); return { x: 0, y: state.text.length }; }
export function godotTextServerShapedTextSubstr(rid: GodotRid, startValue: unknown, lengthValue: unknown): GodotRid {
  const source = stateOf(rid, 'shaped_text_substr');
  const start = integer(startValue, 'shaped_text_substr.start', 0, source.text.length);
  const length = integer(lengthValue, 'shaped_text_substr.length', 0, source.text.length - start);
  const result = godotTextServerCreateShapedText(source.direction, source.orientation);
  const target = stateOf(result, 'shaped_text_substr');
  target.parent = rid;
  target.preserveInvalid = source.preserveInvalid;
  target.preserveControl = source.preserveControl;
  target.customPunctuation = source.customPunctuation;
  const end = start + length;
  for (const span of source.spans) {
    const clippedStart = Math.max(start, span.start);
    const clippedEnd = Math.min(end, span.end);
    if (clippedStart >= clippedEnd) continue;
    const text = source.text.slice(clippedStart, clippedEnd);
    const offset = target.text.length;
    target.text += text;
    target.spans.push({ ...span, start: offset, end: offset + text.length, text, fonts: [...span.fonts], features: { ...span.features } });
  }
  for (const object of source.objects) {
    if (object.position >= start && object.position < end) target.objects.push({ ...object, position: object.position - start, size: { ...object.size } });
  }
  reshape(target);
  return result;
}
export function godotTextServerShapedTextGetParent(rid: GodotRid): GodotRid { return stateOf(rid, 'shaped_text_get_parent').parent ?? ZERO_RID; }
export function godotTextServerShapedTextGetObjects(rid: GodotRid): unknown[] { return stateOf(rid, 'shaped_text_get_objects').objects.map((object) => object.key); }
export function godotTextServerShapedTextGetSpanCount(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_span_count').spans.length; }
export function godotTextServerShapedTextGetSpanMeta(rid: GodotRid, spanValue: unknown): unknown { const state = stateOf(rid, 'shaped_text_get_span_meta'); return state.spans[integer(spanValue, 'shaped_text_get_span_meta.span', 0, state.spans.length - 1)]?.meta ?? null; }
export function godotTextServerShapedTextGetSpanEmbeddedObject(rid: GodotRid, spanValue: unknown): unknown { const state = stateOf(rid, 'shaped_text_get_span_embedded_object'); const span = state.spans[integer(spanValue, 'shaped_text_get_span_embedded_object.span', 0, state.spans.length - 1)]; return span === undefined ? null : state.objects.find((object) => object.position >= span.start && object.position < span.end)?.key ?? null; }
export function godotTextServerShapedTextSetSpanUpdateFont(rid: GodotRid, spanValue: unknown, fontsValue: unknown, sizeValue: unknown, featuresValue: unknown = {}): void {
  const state = stateOf(rid, 'shaped_text_set_span_update_font'); const span = state.spans[integer(spanValue, 'shaped_text_set_span_update_font.span', 0, state.spans.length - 1)]; if (span === undefined) throw new RangeError('TextServer.shaped_text_set_span_update_font span does not exist.');
  if (!Array.isArray(fontsValue)) throw new TypeError('TextServer.shaped_text_set_span_update_font fonts requires Array[RID].'); if (typeof featuresValue !== 'object' || featuresValue === null || Array.isArray(featuresValue)) throw new TypeError('TextServer.shaped_text_set_span_update_font features requires Dictionary.');
  span.fonts = [...fontsValue] as GodotRid[]; span.size = integer(sizeValue, 'shaped_text_set_span_update_font.size', 1, 4096); span.features = { ...(featuresValue as Record<string, number>) }; state.ready = false;
}
export function godotTextServerShapedTextGetObjectRect(rid: GodotRid, key: unknown): { position: { x: number; y: number }; size: { x: number; y: number } } { const state = stateOf(rid, 'shaped_text_get_object_rect'); const object = state.objects.find((candidate) => Object.is(candidate.key, key)); if (object === undefined) return { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } }; const prefix = state.text.slice(0, object.position); const span = primarySpan(state); const font = fontOf(span?.fonts[0] ?? ZERO_RID); const x = font === null ? prefix.length * (span?.size ?? 16) * 0.5 : godotFontStringSize(font, prefix, span?.size ?? 16).x; return { position: { x, y: -object.baseline }, size: { ...object.size } }; }
export function godotTextServerShapedTextGetSize(rid: GodotRid): { x: number; y: number } { const value = metrics(stateOf(rid, 'shaped_text_get_size')); return { x: value.width, y: value.height }; }
export function godotTextServerShapedTextGetWidth(rid: GodotRid): number { return metrics(stateOf(rid, 'shaped_text_get_width')).width; }
export function godotTextServerShapedTextGetAscent(rid: GodotRid): number { return metrics(stateOf(rid, 'shaped_text_get_ascent')).ascent; }
export function godotTextServerShapedTextGetDescent(rid: GodotRid): number { return metrics(stateOf(rid, 'shaped_text_get_descent')).descent; }
export function godotTextServerShapedTextGetUnderlinePosition(rid: GodotRid): number { const state = stateOf(rid, 'shaped_text_get_underline_position'); const span = primarySpan(state); const font = fontOf(span?.fonts[0] ?? ZERO_RID); return font === null ? 1 : godotFontUnderlinePosition(font, span?.size); }
export function godotTextServerShapedTextGetUnderlineThickness(rid: GodotRid): number { const state = stateOf(rid, 'shaped_text_get_underline_thickness'); const span = primarySpan(state); const font = fontOf(span?.fonts[0] ?? ZERO_RID); return font === null ? 1 : godotFontUnderlineThickness(font, span?.size); }
export function godotTextServerShapedTextFitToWidth(rid: GodotRid, widthValue: unknown, justificationFlagsValue = 3): number { const state = stateOf(rid, 'shaped_text_fit_to_width'); state.customWidth = Math.max(0, finite(widthValue, 'shaped_text_fit_to_width.width')); integer(justificationFlagsValue, 'shaped_text_fit_to_width.flags', 0); reshape(state); return state.customWidth; }
export function godotTextServerShapedTextTabAlign(rid: GodotRid, tabStops: unknown): number { if (!Array.isArray(tabStops)) throw new TypeError('TextServer.shaped_text_tab_align requires PackedFloat32Array.'); const state = stateOf(rid, 'shaped_text_tab_align'); reshape(state); return state.width; }

export function godotTextServerShapedTextGetLineBreaks(rid: GodotRid, widthValue: unknown, startValue = 0, breakFlagsValue = 3): number[] {
  const state = stateOf(rid, 'shaped_text_get_line_breaks'); const width = Math.max(0, finite(widthValue, 'shaped_text_get_line_breaks.width')); const start = integer(startValue, 'shaped_text_get_line_breaks.start', 0, state.text.length); integer(breakFlagsValue, 'shaped_text_get_line_breaks.flags', 0);
  const breaks: number[] = []; let lineStart = start; let cursor = start;
  while (cursor < state.text.length) { const newline = state.text.indexOf('\n', cursor); const hardEnd = newline < 0 ? state.text.length : newline; const average = Math.max(1, metrics(state).width / Math.max(1, state.text.length)); const capacity = width === 0 ? 1 : Math.max(1, Math.floor(width / average)); const end = Math.min(hardEnd, lineStart + capacity); breaks.push(lineStart, end); lineStart = end === hardEnd ? hardEnd + (newline >= 0 ? 1 : 0) : end; cursor = lineStart; }
  return breaks;
}
export function godotTextServerShapedTextGetWordBreaks(rid: GodotRid, graphemeFlagsValue = 0): number[] { integer(graphemeFlagsValue, 'shaped_text_get_word_breaks.flags', 0); const text = stateOf(rid, 'shaped_text_get_word_breaks').text; const result: number[] = []; for (const match of text.matchAll(/\S+/gu)) { const index = match.index ?? 0; result.push(index, index + match[0].length); } return result; }
export function godotTextServerShapedTextOverrunTrimToWidth(rid: GodotRid, widthValue: unknown, trimFlagsValue: unknown): void {
  const state = stateOf(rid, 'shaped_text_overrun_trim_to_width');
  const width = Math.max(0, finite(widthValue, 'shaped_text_overrun_trim_to_width.width'));
  const flags = integer(trimFlagsValue, 'shaped_text_overrun_trim_to_width.flags', 0);
  const measured = metrics(state);
  state.trimPos = -1; state.ellipsisPos = -1; state.ellipsisGlyphs = [];
  if (measured.width <= width || state.text.length === 0) return;
  const average = measured.width / state.text.length;
  const capacity = Math.max(0, Math.min(state.text.length, Math.floor(width / Math.max(1, average))));
  state.trimPos = capacity;
  if ((flags & 8) !== 0 || (flags & 16) !== 0 || (flags & 32) !== 0) {
    state.ellipsisPos = Math.max(0, capacity - 1);
    const span = primarySpan(state);
    state.ellipsisGlyphs = [{ start: state.ellipsisPos, end: state.ellipsisPos, count: 1, repeat: 1, flags: 0, offset: { x: 0, y: 0 }, advance: average, font_rid: span?.fonts[0] ?? ZERO_RID, font_size: span?.size ?? 16, index: state.customEllipsis }];
  }
}
export function godotTextServerShapedTextGetDominantDirectionInRange(rid: GodotRid, startValue: unknown, endValue: unknown): number {
  const state = stateOf(rid, 'shaped_text_get_dominant_direction_in_range'); const start = integer(startValue, 'shaped_text_get_dominant_direction_in_range.start', 0, state.text.length); const end = integer(endValue, 'shaped_text_get_dominant_direction_in_range.end', start, state.text.length);
  return /[\u0590-\u08ff]/u.test(state.text.slice(start, end)) ? 2 : 1;
}
export function godotTextServerShapedTextGetGraphemeBounds(rid: GodotRid, positionValue: unknown): { x: number; y: number } {
  const state = stateOf(rid, 'shaped_text_get_grapheme_bounds'); const position = integer(positionValue, 'shaped_text_get_grapheme_bounds.position', 0, state.text.length);
  const all = glyphs(state); let x = 0; for (const glyph of all) { if (glyph.start === position || (position >= glyph.start && position < glyph.end)) return { x, y: x + glyph.advance }; x += glyph.advance; } return { x, y: x };
}
export function godotTextServerShapedTextNextGraphemePos(rid: GodotRid, positionValue: unknown): number { const state = stateOf(rid, 'shaped_text_next_grapheme_pos'); const position = integer(positionValue, 'shaped_text_next_grapheme_pos.position', 0, state.text.length); if (position >= state.text.length) return state.text.length; const code = state.text.codePointAt(position)!; return Math.min(state.text.length, position + (code > 0xffff ? 2 : 1)); }
export function godotTextServerShapedTextPrevGraphemePos(rid: GodotRid, positionValue: unknown): number { const state = stateOf(rid, 'shaped_text_prev_grapheme_pos'); const position = integer(positionValue, 'shaped_text_prev_grapheme_pos.position', 0, state.text.length); if (position <= 0) return 0; const prior = state.text.charCodeAt(position - 1); return Math.max(0, position - (prior >= 0xdc00 && prior <= 0xdfff ? 2 : 1)); }
export function godotTextServerShapedTextHitTestGrapheme(rid: GodotRid, coordinateValue: unknown): number { const state = stateOf(rid, 'shaped_text_hit_test_grapheme'); const coordinate = finite(coordinateValue, 'shaped_text_hit_test_grapheme.coordinate'); let x = 0; for (const glyph of glyphs(state)) { if (coordinate < x + glyph.advance / 2) return glyph.start; x += glyph.advance; } return state.text.length; }
export function godotTextServerShapedTextHitTestPosition(rid: GodotRid, coordinateValue: unknown): number { return godotTextServerShapedTextHitTestGrapheme(rid, coordinateValue); }
export function godotTextServerShapedTextGetSelection(rid: GodotRid, startValue: unknown, endValue: unknown): Array<{ x: number; y: number }> { const start = godotTextServerShapedTextGetGraphemeBounds(rid, startValue).x; const end = godotTextServerShapedTextGetGraphemeBounds(rid, endValue).x; return [{ x: Math.min(start, end), y: Math.max(start, end) }]; }
export function godotTextServerShapedTextSetCustomEllipsis(rid: GodotRid, characterValue: unknown): void { stateOf(rid, 'shaped_text_set_custom_ellipsis').customEllipsis = integer(characterValue, 'shaped_text_set_custom_ellipsis.char', 0, 0x10ffff); }
export function godotTextServerShapedTextGetCustomEllipsis(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_custom_ellipsis').customEllipsis; }
export function godotTextServerShapedTextGetCarets(rid: GodotRid, positionValue: unknown): Record<string, unknown> {
  const state = stateOf(rid, 'shaped_text_get_carets'); const position = integer(positionValue, 'shaped_text_get_carets.position', 0, state.text.length); const bounds = godotTextServerShapedTextGetGraphemeBounds(rid, position); const measured = metrics(state);
  return { leading_caret: { x: bounds.x, y: -measured.ascent, width: 1, height: measured.height }, trailing_caret: { x: bounds.y, y: -measured.ascent, width: 1, height: measured.height }, leading_direction: state.direction, trailing_direction: state.direction };
}
export function godotTextServerShapedTextGetTrimPos(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_trim_pos').trimPos; }
export function godotTextServerShapedTextGetEllipsisPos(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_ellipsis_pos').ellipsisPos; }
export function godotTextServerShapedTextGetEllipsisGlyphs(rid: GodotRid): GodotShapedTextGlyph[] { return [...stateOf(rid, 'shaped_text_get_ellipsis_glyphs').ellipsisGlyphs]; }
export function godotTextServerShapedTextGetEllipsisGlyphCount(rid: GodotRid): number { return stateOf(rid, 'shaped_text_get_ellipsis_glyph_count').ellipsisGlyphs.length; }

export function godotTextServerShapedTextDraw(rid: GodotRid, canvasItem: GodotRid, position: unknown, clipLeft = -1, clipRight = -1, color = { r: 1, g: 1, b: 1, a: 1 }): void { const state = stateOf(rid, 'shaped_text_draw'); finite(clipLeft, 'shaped_text_draw.clip_left'); finite(clipRight, 'shaped_text_draw.clip_right'); const span = primarySpan(state); const font = fontOf(span?.fonts[0] ?? ZERO_RID); if (font !== null) godotFontDrawString(font, canvasItem, position, state.text, -1, state.customWidth ?? -1, span?.size ?? 16, color); }
export function godotTextServerShapedTextDrawOutline(rid: GodotRid, canvasItem: GodotRid, position: unknown, clipLeft = -1, clipRight = -1, outlineSize = 1, color = { r: 1, g: 1, b: 1, a: 1 }): void { const state = stateOf(rid, 'shaped_text_draw_outline'); finite(clipLeft, 'shaped_text_draw_outline.clip_left'); finite(clipRight, 'shaped_text_draw_outline.clip_right'); const span = primarySpan(state); const font = fontOf(span?.fonts[0] ?? ZERO_RID); if (font !== null) godotFontDrawStringOutline(font, canvasItem, position, state.text, outlineSize, -1, state.customWidth ?? -1, span?.size ?? 16, color); }
