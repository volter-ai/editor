/** Godot 4 TextParagraph resource composed from retained TextLine layout rows. */

import type { GodotFont } from './font';
import { godotFontStringSize } from './font';
import { godotRidNew, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import { GodotTextLine } from './text-line';

interface ParagraphRun {
  text: string;
  font: GodotFont;
  size: number;
  language: string;
  meta: unknown;
}

interface ParagraphObject {
  key: unknown;
  size: unknown;
  inlineAlign: number;
  length: number;
  baseline: number;
}

interface DropcapState {
  text: string;
  font: GodotFont;
  size: number;
  margins: { x: number; y: number; width: number; height: number };
  language: string;
}

export class GodotTextParagraph {
  private directionValue = 0;
  private orientationValue = 0;
  private preserveInvalidValue = true;
  private preserveControlValue = false;
  private alignmentValue = 0;
  private breakFlagsValue = 3;
  private justificationFlagsValue = 3;
  private tabStopsValue: number[] = [];
  private widthValue = -1;
  private maxLinesVisibleValue = -1;
  private visibleCharactersValue = -1;
  private overrunBehaviorValue = 0;
  private ellipsisCharValue = 0x2026;
  private customPunctuationValue = '';
  private bidiOverrideValue: unknown[] = [];
  private readonly runs: ParagraphRun[] = [];
  private readonly objects: ParagraphObject[] = [];
  private linesValue: GodotTextLine[] = [];
  private lineRanges: Array<{ x: number; y: number }> = [];
  private dropcapValue: DropcapState | null = null;
  private dropcapLineValue: GodotTextLine | null = null;
  private dirty = true;

  constructor(direction = 0, orientation = 0) {
    this.set_direction(direction);
    this.set_orientation(orientation);
    registerGodotObjectIdentity(this, 'TextParagraph');
  }

  get direction(): number { return this.get_direction(); }
  set direction(value: number) { this.set_direction(value); }
  get orientation(): number { return this.get_orientation(); }
  set orientation(value: number) { this.set_orientation(value); }
  get preserve_invalid(): boolean { return this.get_preserve_invalid(); }
  set preserve_invalid(value: boolean) { this.set_preserve_invalid(value); }
  get preserve_control(): boolean { return this.get_preserve_control(); }
  set preserve_control(value: boolean) { this.set_preserve_control(value); }
  get custom_punctuation(): string { return this.get_custom_punctuation(); }
  set custom_punctuation(value: string) { this.set_custom_punctuation(value); }
  get width(): number { return this.get_width(); }
  set width(value: number) { this.set_width(value); }
  get alignment(): number { return this.get_alignment(); }
  set alignment(value: number) { this.set_alignment(value); }
  get break_flags(): number { return this.get_break_flags(); }
  set break_flags(value: number) { this.set_break_flags(value); }
  get justification_flags(): number { return this.get_justification_flags(); }
  set justification_flags(value: number) { this.set_justification_flags(value); }
  get tab_stops(): number[] { return this.get_tab_stops(); }
  set tab_stops(value: number[]) { this.set_tab_stops(value); }
  get text_overrun_behavior(): number { return this.get_text_overrun_behavior(); }
  set text_overrun_behavior(value: number) { this.set_text_overrun_behavior(value); }
  get ellipsis_char(): number { return this.get_ellipsis_char(); }
  set ellipsis_char(value: number) { this.set_ellipsis_char(value); }
  get max_lines_visible(): number { return this.get_max_lines_visible(); }
  set max_lines_visible(value: number) { this.set_max_lines_visible(value); }
  get visible_characters(): number { return this.get_visible_characters(); }
  set visible_characters(value: number) { this.set_visible_characters(value); }

  clear(): void { this.runs.length = 0; this.objects.length = 0; this.linesValue = []; this.lineRanges = []; this.dirty = true; }
  set_direction(value: number): void { this.directionValue = this.enum(value, 'direction', 0, 3); this.dropcapLineValue = null; this.dirty = true; }
  get_direction(): number { return this.directionValue; }
  set_orientation(value: number): void { this.orientationValue = this.enum(value, 'orientation', 0, 1); this.dropcapLineValue = null; this.dirty = true; }
  get_orientation(): number { return this.orientationValue; }
  set_preserve_invalid(value: boolean): void { this.preserveInvalidValue = this.bool(value, 'preserve_invalid'); this.dropcapLineValue = null; this.dirty = true; }
  get_preserve_invalid(): boolean { return this.preserveInvalidValue; }
  set_preserve_control(value: boolean): void { this.preserveControlValue = this.bool(value, 'preserve_control'); this.dropcapLineValue = null; this.dirty = true; }
  get_preserve_control(): boolean { return this.preserveControlValue; }
  set_bidi_override(value: readonly unknown[]): void { if (!Array.isArray(value)) throw new TypeError('TextParagraph.bidi_override requires Array.'); this.bidiOverrideValue = [...value]; this.dropcapLineValue = null; this.dirty = true; }
  set_custom_punctuation(value: string): void { if (typeof value !== 'string') throw new TypeError('TextParagraph.custom_punctuation requires String.'); this.customPunctuationValue = value; this.dirty = true; }
  get_custom_punctuation(): string { return this.customPunctuationValue; }

  set_width(value: number): void { if (!Number.isFinite(value) || value < -1) throw new RangeError('TextParagraph.width requires -1 or non-negative finite value.'); this.widthValue = value; this.dirty = true; }
  get_width(): number { return this.widthValue; }
  set_alignment(value: number): void { this.alignmentValue = this.enum(value, 'alignment', 0, 3); this.dirty = true; }
  get_alignment(): number { return this.alignmentValue; }
  set_break_flags(value: number): void { this.breakFlagsValue = this.enum(value, 'break_flags', 0, 0x7fffffff); this.dirty = true; }
  get_break_flags(): number { return this.breakFlagsValue; }
  set_justification_flags(value: number): void { this.justificationFlagsValue = this.enum(value, 'justification_flags', 0, 0x7fffffff); this.dirty = true; }
  get_justification_flags(): number { return this.justificationFlagsValue; }
  set_tab_stops(value: readonly number[]): void { if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)) throw new TypeError('TextParagraph.tab_stops requires non-negative PackedFloat32Array.'); this.tabStopsValue = [...value]; this.dirty = true; }
  get_tab_stops(): number[] { return [...this.tabStopsValue]; }
  set_text_overrun_behavior(value: number): void { this.overrunBehaviorValue = this.enum(value, 'text_overrun_behavior', 0, 6); this.dirty = true; }
  get_text_overrun_behavior(): number { return this.overrunBehaviorValue; }
  set_ellipsis_char(value: number): void { this.ellipsisCharValue = this.enum(value, 'ellipsis_char', 0, 0x10ffff); this.dirty = true; }
  get_ellipsis_char(): number { return this.ellipsisCharValue; }
  set_max_lines_visible(value: number): void { this.maxLinesVisibleValue = this.enum(value, 'max_lines_visible', -1, 0x7fffffff); }
  get_max_lines_visible(): number { return this.maxLinesVisibleValue; }
  set_visible_characters(value: number): void { this.visibleCharactersValue = this.enum(value, 'visible_characters', -1, 0x7fffffff); this.dirty = true; }
  get_visible_characters(): number { return this.visibleCharactersValue; }

  add_string(text: string, font: GodotFont, fontSize: number, language = '', meta: unknown = null): boolean {
    if (typeof text !== 'string' || typeof language !== 'string') throw new TypeError('TextParagraph.add_string requires String text and language.');
    if (typeof font !== 'object' || font === null) throw new TypeError('TextParagraph.add_string requires Font.');
    if (!Number.isSafeInteger(fontSize) || fontSize <= 0) throw new RangeError('TextParagraph.add_string font_size requires positive integer.');
    this.runs.push({ text, font, size: fontSize, language, meta }); this.dirty = true; return true;
  }
  add_object(key: unknown, size: unknown, inlineAlign = 5, length = 1, baseline = 0): boolean { this.objects.push({ key, size, inlineAlign: this.enum(inlineAlign, 'object.inline_align', 0, 15), length: this.enum(length, 'object.length', 1, 0x7fffffff), baseline: this.finite(baseline, 'object.baseline') }); this.dirty = true; return true; }
  resize_object(key: unknown, size: unknown, inlineAlign = 5, baseline = 0): boolean { const object = this.objects.find((candidate) => Object.is(candidate.key, key)); if (object === undefined) return false; object.size = size; object.inlineAlign = this.enum(inlineAlign, 'object.inline_align', 0, 15); object.baseline = this.finite(baseline, 'object.baseline'); this.dirty = true; return true; }

  set_dropcap(text: string, font: GodotFont, fontSize: number, margins: unknown, language = ''): void {
    if (typeof text !== 'string' || typeof language !== 'string') throw new TypeError('TextParagraph.set_dropcap requires String.');
    if (typeof margins !== 'object' || margins === null) throw new TypeError('TextParagraph.set_dropcap margins requires Rect2.');
    this.dropcapValue = { text, font, size: this.enum(fontSize, 'dropcap.font_size', 1, 4096), margins: { x: this.finite(Reflect.get(margins, 'x'), 'dropcap.margins.x'), y: this.finite(Reflect.get(margins, 'y'), 'dropcap.margins.y'), width: this.finite(Reflect.get(margins, 'width'), 'dropcap.margins.width'), height: this.finite(Reflect.get(margins, 'height'), 'dropcap.margins.height') }, language };
    this.dropcapLineValue = null;
  }
  clear_dropcap(): void { this.dropcapValue = null; this.dropcapLineValue = null; }
  get_dropcap_size(): { x: number; y: number } { if (this.dropcapValue === null) return { x: 0, y: 0 }; const value = godotFontStringSize(this.dropcapValue.font, this.dropcapValue.text, this.dropcapValue.size); return { x: value.x + this.dropcapValue.margins.x + this.dropcapValue.margins.width, y: value.y + this.dropcapValue.margins.y + this.dropcapValue.margins.height }; }
  get_dropcap_rid(): GodotRid {
    return this.dropcapLine()?.get_rid() ?? godotRidNew();
  }
  get_dropcap_lines(): number {
    if (this.dropcapValue === null) return 0;
    this.layout();
    const height = this.get_dropcap_size().y;
    let occupied = 0;
    let lines = 0;
    for (const line of this.visibleLines()) {
      if (occupied >= height) break;
      occupied += line.get_size().y;
      lines += 1;
    }
    return lines;
  }

  get_line_count(): number { this.layout(); return this.visibleLines().length; }
  get_line_objects(line: number): unknown[] { return this.line(line, 'get_line_objects').get_objects(); }
  get_line_object_rect(line: number, key: unknown): unknown { return this.line(line, 'get_line_object_rect').get_object_rect(key); }
  get_line_size(line: number): { x: number; y: number } { return this.line(line, 'get_line_size').get_size(); }
  get_line_ascent(line: number): number { return this.line(line, 'get_line_ascent').get_line_ascent(); }
  get_line_descent(line: number): number { return this.line(line, 'get_line_descent').get_line_descent(); }
  get_line_width(line: number): number { return this.line(line, 'get_line_width').get_line_width(); }
  get_line_underline_position(line: number): number { return this.line(line, 'get_line_underline_position').get_line_underline_position(); }
  get_line_underline_thickness(line: number): number { return this.line(line, 'get_line_underline_thickness').get_line_underline_thickness(); }
  get_line_range(line: number): { x: number; y: number } { this.line(line, 'get_line_range'); return { ...this.lineRanges[line]! }; }
  get_size(): { x: number; y: number } { this.layout(); const lines = this.visibleLines(); return { x: Math.max(0, ...lines.map((line) => line.get_line_width())), y: lines.reduce((sum, line) => sum + line.get_size().y, 0) }; }

  hit_test(position: { x: number; y: number }): number { this.layout(); if (typeof position !== 'object' || position === null) throw new TypeError('TextParagraph.hit_test requires Vector2.'); let y = 0; for (let index = 0; index < this.visibleLines().length; index += 1) { const line = this.linesValue[index]!; const height = line.get_size().y; if (position.y <= y + height) return this.lineRanges[index]!.x + line.hit_test(position.x); y += height; } return this.lineRanges.at(-1)?.y ?? 0; }
  draw(canvasItem: GodotRid, position: { x: number; y: number }, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void { this.layout(); let y = position.y; for (const line of this.visibleLines()) { line.draw(canvasItem, { x: position.x, y }, color, oversampling); y += line.get_size().y; } }
  draw_outline(canvasItem: GodotRid, position: { x: number; y: number }, outlineSize = 1, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void { this.layout(); let y = position.y; for (const line of this.visibleLines()) { line.draw_outline(canvasItem, { x: position.x, y }, outlineSize, color, oversampling); y += line.get_size().y; } }
  draw_line(canvasItem: GodotRid, position: { x: number; y: number }, line: number, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    this.line(line, 'draw_line').draw(canvasItem, position, color, oversampling);
  }
  draw_line_outline(canvasItem: GodotRid, position: { x: number; y: number }, line: number, outlineSize = 1, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    this.line(line, 'draw_line_outline').draw_outline(canvasItem, position, outlineSize, color, oversampling);
  }
  draw_dropcap(canvasItem: GodotRid, position: { x: number; y: number }, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    const line = this.dropcapLine();
    if (line === null) return;
    line.draw(canvasItem, position, color, oversampling);
  }
  draw_dropcap_outline(canvasItem: GodotRid, position: { x: number; y: number }, outlineSize = 1, color = { r: 1, g: 1, b: 1, a: 1 }, oversampling = 0): void {
    const line = this.dropcapLine();
    if (line === null) return;
    line.draw_outline(canvasItem, position, outlineSize, color, oversampling);
  }

  private layout(): void {
    if (!this.dirty) return;
    this.linesValue = []; this.lineRanges = [];
    let globalIndex = 0;
    for (const run of this.runs) {
      const visibleText = this.visibleCharactersValue < 0 ? run.text : run.text.slice(0, Math.max(0, this.visibleCharactersValue - globalIndex));
      for (const paragraph of visibleText.split('\n')) {
        const words = paragraph.match(/\s+|\S+/gu) ?? ['']; let current = ''; let start = globalIndex;
        const flush = (): void => { const line = this.makeLine(); line.add_string(current, run.font, run.size, run.language, run.meta); this.linesValue.push(line); this.lineRanges.push({ x: start, y: start + current.length }); start += current.length; current = ''; };
        for (const word of words) { const candidate = current + word; if (current !== '' && this.widthValue >= 0 && godotFontStringSize(run.font, candidate, run.size).x > this.widthValue) flush(); current += word; }
        flush(); globalIndex += paragraph.length + 1;
      }
    }
    if (this.linesValue.length === 0) this.linesValue.push(this.makeLine());
    for (const object of this.objects) this.linesValue[0]!.add_object(object.key, object.size, object.inlineAlign, object.length, object.baseline);
    this.dirty = false;
  }

  private makeLine(): GodotTextLine { const line = new GodotTextLine(this.directionValue, this.orientationValue); line.set_preserve_invalid(this.preserveInvalidValue); line.set_preserve_control(this.preserveControlValue); line.set_bidi_override(this.bidiOverrideValue); line.set_width(this.widthValue); line.set_alignment(this.alignmentValue); line.set_flags(this.justificationFlagsValue); line.set_tab_stops(this.tabStopsValue); line.set_text_overrun_behavior(this.overrunBehaviorValue); line.set_ellipsis_char(this.ellipsisCharValue); return line; }
  private dropcapLine(): GodotTextLine | null {
    const dropcap = this.dropcapValue;
    if (dropcap === null) return null;
    if (this.dropcapLineValue !== null) return this.dropcapLineValue;
    const line = new GodotTextLine(this.directionValue, this.orientationValue);
    line.set_preserve_invalid(this.preserveInvalidValue);
    line.set_preserve_control(this.preserveControlValue);
    line.set_bidi_override(this.bidiOverrideValue);
    line.add_string(dropcap.text, dropcap.font, dropcap.size, dropcap.language);
    this.dropcapLineValue = line;
    return this.dropcapLineValue;
  }
  private visibleLines(): GodotTextLine[] { return this.maxLinesVisibleValue < 0 ? this.linesValue : this.linesValue.slice(0, this.maxLinesVisibleValue); }
  private line(index: number, member: string): GodotTextLine { this.layout(); const line = this.visibleLines()[this.enum(index, member, 0, Math.max(0, this.visibleLines().length - 1))]; if (line === undefined) throw new RangeError(`TextParagraph.${member} line does not exist.`); return line; }
  private enum(value: number, member: string, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`TextParagraph.${member} requires integer ${min}..${max}.`); return value; }
  private finite(value: unknown, member: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`TextParagraph.${member} requires finite number.`); return value; }
  private bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`TextParagraph.${member} requires bool.`); return value; }
}

export function createGodotTextParagraph(direction = 0, orientation = 0): GodotTextParagraph { return new GodotTextParagraph(direction, orientation); }
