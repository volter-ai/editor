import { BufferGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotTextMeshSnapshot {
  readonly text: string; readonly font: unknown | null; readonly fontSize: number;
  readonly horizontalAlignment: number; readonly verticalAlignment: number; readonly uppercase: boolean;
  readonly lineSpacing: number; readonly autowrapMode: number; readonly justificationFlags: number;
  readonly pixelSize: number; readonly curveStep: number; readonly depth: number; readonly width: number;
  readonly offset: { readonly x: number; readonly y: number }; readonly textDirection: number;
  readonly language: string; readonly structuredTextBidiOverride: number;
  readonly structuredTextBidiOverrideOptions: readonly unknown[];
}

export interface GodotTextMeshBuilder { build(snapshot: GodotTextMeshSnapshot): BufferGeometry }
let builder: GodotTextMeshBuilder | null = null;
function finite(v: unknown, m: string, min = -Infinity): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new RangeError(`godot-compat: TextMesh.${m} requires finite value >= ${min}.`); return v; }
function integer(v: unknown, m: string, min = 0, max = 0x7fff_ffff): number { const n = finite(v, m, min); if (!Number.isSafeInteger(n) || n > max) throw new RangeError(`godot-compat: TextMesh.${m} requires integer in [${min}, ${max}].`); return n; }
function bool(v: unknown, m: string): boolean { if (typeof v !== 'boolean') throw new TypeError(`godot-compat: TextMesh.${m} requires bool.`); return v; }

export class GodotTextMesh extends BufferGeometry {
  public readonly __godotClass = 'TextMesh';
  private values = { text: '', font: null as unknown | null, fontSize: 16, horizontalAlignment: 1, verticalAlignment: 1, uppercase: false, lineSpacing: 0, autowrapMode: 0, justificationFlags: 163, pixelSize: 0.01, curveStep: 0.5, depth: 0.05, width: 500, offset: { x: 0, y: 0 }, textDirection: 0, language: '', structuredTextBidiOverride: 0, structuredTextBidiOverrideOptions: [] as unknown[] };
  public constructor() { super(); registerGodotObjectIdentity(this, 'TextMesh'); bindGodotResourceProtocol<GodotTextMesh>(this, { createDuplicate: (source) => { const copy = new GodotTextMesh(); copy.values = { ...source.values, offset: { ...source.values.offset }, structuredTextBidiOverrideOptions: [...source.values.structuredTextBidiOverrideOptions] }; copy.rebuild(); return copy; } }); }
  private set<K extends keyof typeof this.values>(key: K, value: (typeof this.values)[K]): void { this.values[key] = value; this.rebuild(); }
  private rebuild(): void { if (builder !== null) { const next = builder.build(this.snapshot()); this.copy(next); next.dispose(); } godotResourceEmitChanged(this); }
  public snapshot(): GodotTextMeshSnapshot { return Object.freeze({ ...this.values, offset: Object.freeze({ ...this.values.offset }), structuredTextBidiOverrideOptions: Object.freeze([...this.values.structuredTextBidiOverrideOptions]) }); }
  public get text(): string { return this.getText(); } public set text(v: string) { this.setText(v); }
  public get font(): unknown | null { return this.getFont(); } public set font(v: unknown | null) { this.setFont(v); }
  public get font_size(): number { return this.getFontSize(); } public set font_size(v: number) { this.setFontSize(v); }
  public get horizontal_alignment(): number { return this.getHorizontalAlignment(); } public set horizontal_alignment(v: number) { this.setHorizontalAlignment(v); }
  public get vertical_alignment(): number { return this.getVerticalAlignment(); } public set vertical_alignment(v: number) { this.setVerticalAlignment(v); }
  public get uppercase(): boolean { return this.isUppercase(); } public set uppercase(v: boolean) { this.setUppercase(v); }
  public get line_spacing(): number { return this.getLineSpacing(); } public set line_spacing(v: number) { this.setLineSpacing(v); }
  public get autowrap_mode(): number { return this.getAutowrapMode(); } public set autowrap_mode(v: number) { this.setAutowrapMode(v); }
  public get justification_flags(): number { return this.getJustificationFlags(); } public set justification_flags(v: number) { this.setJustificationFlags(v); }
  public get pixel_size(): number { return this.getPixelSize(); } public set pixel_size(v: number) { this.setPixelSize(v); }
  public get curve_step(): number { return this.getCurveStep(); } public set curve_step(v: number) { this.setCurveStep(v); }
  public get depth(): number { return this.getDepth(); } public set depth(v: number) { this.setDepth(v); }
  public get width(): number { return this.getWidth(); } public set width(v: number) { this.setWidth(v); }
  public get offset(): { x: number; y: number } { return this.getOffset(); } public set offset(v: unknown) { this.setOffset(v); }
  public get text_direction(): number { return this.getTextDirection(); } public set text_direction(v: number) { this.setTextDirection(v); }
  public get language(): string { return this.getLanguage(); } public set language(v: string) { this.setLanguage(v); }
  public get structured_text_bidi_override(): number { return this.getStructuredTextBidiOverride(); } public set structured_text_bidi_override(v: number) { this.setStructuredTextBidiOverride(v); }
  public get structured_text_bidi_override_options(): unknown[] { return this.getStructuredTextBidiOverrideOptions(); } public set structured_text_bidi_override_options(v: unknown[]) { this.setStructuredTextBidiOverrideOptions(v); }
  public setText(v: unknown): void { this.set('text', String(v)); } public getText(): string { return this.values.text; }
  public setFont(v: unknown | null): void { this.set('font', v); } public getFont(): unknown | null { return this.values.font; }
  public setFontSize(v: unknown): void { this.set('fontSize', integer(v, 'font_size', 1, 4096)); } public getFontSize(): number { return this.values.fontSize; }
  public setHorizontalAlignment(v: unknown): void { this.set('horizontalAlignment', integer(v, 'horizontal_alignment', 0, 3)); } public getHorizontalAlignment(): number { return this.values.horizontalAlignment; }
  public setVerticalAlignment(v: unknown): void { this.set('verticalAlignment', integer(v, 'vertical_alignment', 0, 3)); } public getVerticalAlignment(): number { return this.values.verticalAlignment; }
  public setUppercase(v: unknown): void { this.set('uppercase', bool(v, 'uppercase')); } public isUppercase(): boolean { return this.values.uppercase; }
  public setLineSpacing(v: unknown): void { this.set('lineSpacing', finite(v, 'line_spacing')); } public getLineSpacing(): number { return this.values.lineSpacing; }
  public setAutowrapMode(v: unknown): void { this.set('autowrapMode', integer(v, 'autowrap_mode', 0, 3)); } public getAutowrapMode(): number { return this.values.autowrapMode; }
  public setJustificationFlags(v: unknown): void { this.set('justificationFlags', integer(v, 'justification_flags', 0, 0xffff_ffff)); } public getJustificationFlags(): number { return this.values.justificationFlags; }
  public setPixelSize(v: unknown): void { this.set('pixelSize', finite(v, 'pixel_size', Number.MIN_VALUE)); } public getPixelSize(): number { return this.values.pixelSize; }
  public setCurveStep(v: unknown): void { this.set('curveStep', finite(v, 'curve_step', 0.1)); } public getCurveStep(): number { return this.values.curveStep; }
  public setDepth(v: unknown): void { this.set('depth', finite(v, 'depth', 0)); } public getDepth(): number { return this.values.depth; }
  public setWidth(v: unknown): void { this.set('width', finite(v, 'width', 0)); } public getWidth(): number { return this.values.width; }
  public setOffset(v: unknown): void { if (typeof v !== 'object' || v === null || !('x' in v) || !('y' in v)) throw new TypeError('godot-compat: TextMesh.offset requires Vector2.'); this.set('offset', { x: finite(v.x, 'offset.x'), y: finite(v.y, 'offset.y') }); } public getOffset(): { x: number; y: number } { return { ...this.values.offset }; }
  public setTextDirection(v: unknown): void { this.set('textDirection', integer(v, 'text_direction', 0, 3)); } public getTextDirection(): number { return this.values.textDirection; }
  public setLanguage(v: unknown): void { this.set('language', String(v)); } public getLanguage(): string { return this.values.language; }
  public setStructuredTextBidiOverride(v: unknown): void { this.set('structuredTextBidiOverride', integer(v, 'structured_text_bidi_override', 0, 6)); } public getStructuredTextBidiOverride(): number { return this.values.structuredTextBidiOverride; }
  public setStructuredTextBidiOverrideOptions(v: unknown): void { if (!Array.isArray(v)) throw new TypeError('godot-compat: TextMesh structured bidi options require Array.'); this.set('structuredTextBidiOverrideOptions', [...v]); } public getStructuredTextBidiOverrideOptions(): unknown[] { return [...this.values.structuredTextBidiOverrideOptions]; }
}

export function createGodotTextMesh(): GodotTextMesh { return new GodotTextMesh(); }
export function bindGodotTextMeshBuilder(next: GodotTextMeshBuilder | null): () => void { builder = next; return () => { if (builder === next) builder = null; }; }
