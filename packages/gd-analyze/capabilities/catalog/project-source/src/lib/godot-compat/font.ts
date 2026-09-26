/**
 * Godot 3 DynamicFont/DynamicFontData and Godot 4 Font resources over browser-native FontFace and
 * Canvas text metrics. Font rasterization remains the browser's; this module retains Godot's
 * Resource properties, fallback order, variation selection, and metric/query protocol.
 */

import { registerGodotObjectIdentity } from './object';
import { installGodotFontFileCacheApi } from './font-cache';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
  godotResourceGetRid,
} from './resource-io';

export interface GodotFontSource {
  readonly family: string;
  readonly source?: string | ArrayBuffer | undefined;
  readonly descriptors?: FontFaceDescriptors;
}

export interface GodotFont extends GodotFontSource {
  fallbacks: GodotFont[];
  get_height(fontSize?: number): number;
  get_ascent(fontSize?: number): number;
  get_descent(fontSize?: number): number;
  get_underline_position(fontSize?: number): number;
  get_underline_thickness(fontSize?: number): number;
  get_scale(fontSize?: number): number;
  get_string_size(text: string, horizontalAlignment?: number, width?: number, fontSize?: number): { x: number; y: number };
  get_multiline_string_size(text: string, horizontalAlignment?: number, width?: number, fontSize?: number, maxLines?: number): { x: number; y: number };
  get_wordwrap_string_size(text: string, width: number): { x: number; y: number };
  has_char(character: number): boolean;
  get_char_size(character: number, fontSizeOrNext?: number): { x: number; y: number };
  get_glyph_index(fontSize: number, character: number, variationSelector?: number): number;
  get_char_from_glyph_index(fontSize: number, glyphIndex: number): number;
  get_glyph_advance(fontSize: number, glyphIndex: number): { x: number; y: number };
  get_kerning(fontSize: number, glyphPair: { x: number; y: number }): { x: number; y: number };
  is_language_supported(language: string): boolean;
  is_script_supported(script: string): boolean;
  set_language_support_override(language: string, supported: boolean): void;
  get_language_support_override(language: string): boolean;
  remove_language_support_override(language: string): void;
  get_language_support_overrides(): readonly string[];
  set_script_support_override(script: string, supported: boolean): void;
  get_script_support_override(script: string): boolean;
  remove_script_support_override(script: string): void;
  get_script_support_overrides(): readonly string[];
  get_opentype_features(): Record<string, number>;
  get_supported_feature_list(): Record<string, number>;
  get_supported_variation_list(): Record<string, { min_value: number; max_value: number; default_value: number }>;
  get_face_count(): number;
  get_ot_name_strings(): Record<string, Record<string, string>>;
  get_rid(): ReturnType<typeof godotResourceGetRid>;
  get_rids(): ReturnType<typeof godotResourceGetRid>[];
  get_font_name(): string;
  get_font_style_name(): string;
  get_font_style(): number;
  get_font_weight(): number;
  get_font_stretch(): number;
  set_fallbacks(fallbacks: readonly GodotFont[]): void;
}

export interface GodotDynamicFontData extends GodotFontSource {
  fontPath: string;
  antialiased: boolean;
  hinting: number;
  overrideOversampling: number;
}

export interface GodotDynamicFont extends GodotFont {
  fontData: GodotDynamicFontData | null;
  size: number;
  outlineSize: number;
  outlineColor: { r: number; g: number; b: number; a: number };
  useMipmaps: boolean;
  useFilter: boolean;
  spacingTop: number;
  spacingBottom: number;
  spacingChar: number;
  spacingSpace: number;
}

export interface GodotBitmapGlyph {
  readonly character: number;
  texture: number;
  rect: { x: number; y: number; width: number; height: number };
  align: { x: number; y: number };
  advance: number;
}

/** Godot 3 BitmapFont's exact retained atlas metrics and texture identities. */
export interface GodotBitmapFont extends GodotFont {
  ascent: number;
  height: number;
  distanceField: boolean;
  fallback: GodotBitmapFont | null;
  readonly glyphs: Map<number, GodotBitmapGlyph>;
  readonly kernings: Map<string, number>;
  readonly textures: unknown[];
}

export interface GodotFontOutlinePresentation {
  readonly size: number;
  readonly color: string;
}

export interface GodotFontFile extends GodotFont {
  data: Uint8Array;
  sourcePath: string;
  fontName: string;
  styleName: string;
  fontStyle: number;
  fontWeight: number;
  fontStretch: number;
  antialiasing: number;
  disableEmbeddedBitmaps: boolean;
  generateMipmaps: boolean;
  allowSystemFallback: boolean;
  forceAutohinter: boolean;
  modulateColorGlyphs: boolean;
  hinting: number;
  subpixelPositioning: number;
  keepRoundingRemainders: boolean;
  multichannelSignedDistanceField: boolean;
  msdfPixelRange: number;
  msdfSize: number;
  fixedSize: number;
  fixedSizeScaleMode: number;
  oversampling: number;
  opentypeFeatureOverrides: Record<string, number>;
}

export interface GodotFontVariation extends GodotFont {
  baseFont: GodotFont | null;
  variationOpentype: Record<string, number>;
  variationFaceIndex: number;
  variationEmbolden: number;
  variationTransform: readonly number[];
  opentypeFeatures: Record<string, number>;
  spacing: [number, number, number, number];
  baselineOffset: number;
  paletteIndex: number;
  paletteCustomColors: readonly unknown[];
}

export interface GodotSystemFont extends GodotFont {
  fontNames: string[];
  fontItalic: boolean;
  fontWeight: number;
  fontStretch: number;
  antialiasing: number;
  disableEmbeddedBitmaps: boolean;
  generateMipmaps: boolean;
  allowSystemFallback: boolean;
  forceAutohinter: boolean;
  modulateColorGlyphs: boolean;
  hinting: number;
  subpixelPositioning: number;
  keepRoundingRemainders: boolean;
  multichannelSignedDistanceField: boolean;
  msdfPixelRange: number;
  msdfSize: number;
  oversampling: number;
}

const REGISTERED_FACES = new WeakMap<object, Promise<FontFace | null>>();
const FONT_LOAD_ERRORS = new WeakMap<object, unknown>();
let nextFontFamily = 1;

function generatedFamily(prefix: string): string {
  const family = `${prefix}_${nextFontFamily.toString(36)}`;
  nextFontFamily += 1;
  return family;
}

function changed(resource: object): void {
  REGISTERED_FACES.delete(resource);
  FONT_LOAD_ERRORS.delete(resource);
  godotResourceEmitChanged(resource);
}

/** Last native FontFace construction/load failure, retained without producing an unhandled rejection. */
export function getGodotFontLoadError(font: GodotFontSource): unknown {
  return FONT_LOAD_ERRORS.get(font as object);
}

const BOOLEAN_FONT_FIELDS = new Set([
  'disableEmbeddedBitmaps', 'generateMipmaps', 'allowSystemFallback', 'forceAutohinter',
  'modulateColorGlyphs', 'keepRoundingRemainders', 'multichannelSignedDistanceField',
  'fontItalic', 'useMipmaps', 'useFilter',
]);
const NON_NEGATIVE_FINITE_FONT_FIELDS = new Set(['oversampling']);
const SIGNED_FINITE_FONT_FIELDS = new Set(['variationEmbolden', 'baselineOffset']);
const INTEGER_FONT_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  antialiasing: [0, 2],
  fontStyle: [0, 7],
  fontWeight: [100, 999],
  fontStretch: [50, 200],
  hinting: [0, 2],
  fixedSize: [-0x80000000, 0x7fffffff],
  fixedSizeScaleMode: [0, 2],
  msdfPixelRange: [-0x80000000, 0x7fffffff],
  msdfSize: [-0x80000000, 0x7fffffff],
  variationFaceIndex: [0, 32767],
  paletteIndex: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  outlineSize: [0, 0x7fffffff],
  spacingTop: [-0x80000000, 0x7fffffff],
  spacingBottom: [-0x80000000, 0x7fffffff],
  spacingChar: [-0x80000000, 0x7fffffff],
  spacingSpace: [-0x80000000, 0x7fffffff],
};
const KNOWN_FONT_FIELDS = new Set([
  ...BOOLEAN_FONT_FIELDS,
  ...NON_NEGATIVE_FINITE_FONT_FIELDS,
  ...SIGNED_FINITE_FONT_FIELDS,
  ...Object.keys(INTEGER_FONT_RANGES),
  'styleName', 'fontName', 'variationOpentype', 'opentypeFeatures',
  'opentypeFeatureOverrides', 'baseFont', 'variationTransform', 'spacing',
  'paletteCustomColors', 'outlineColor',
]);

function requireDictionary(value: unknown, member: string): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${member} requires a Dictionary.`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) {
      throw new TypeError(`${member}[${JSON.stringify(key)}] requires an integer value.`);
    }
  }
  return value as Record<string, number>;
}

function requireFiniteTuple(value: unknown, length: number, member: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new TypeError(`${member} requires ${length} finite numeric components.`);
  }
  return value;
}

function requireColorArray(value: unknown, member: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${member} requires PackedColorArray.`);
  for (const color of value) {
    requireColor(color, member);
  }
  return value;
}

function requireColor(value: unknown, member: string): void {
  if (
    typeof value !== 'object' || value === null ||
    ['r', 'g', 'b', 'a'].some((key) => typeof (value as Record<string, unknown>)[key] !== 'number' || !Number.isFinite((value as Record<string, number>)[key]))
  ) {
    throw new TypeError(`${member} requires Color with finite r, g, b, and a channels.`);
  }
}

function requireBoolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function cssColor(value: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): string {
  const channel = (entry: number): number => Math.round(Math.max(0, Math.min(1, entry)) * 255);
  return `rgba(${channel(value.r)}, ${channel(value.g)}, ${channel(value.b)}, ${Math.max(0, Math.min(1, value.a))})`;
}

function requireByteArray(data: Iterable<number>, member: string): Uint8Array {
  if (data === null || data === undefined || typeof data[Symbol.iterator] !== 'function') {
    throw new TypeError(`${member} requires PackedByteArray.`);
  }
  const values = [...data];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)) {
    throw new RangeError(`${member} requires byte values in 0..255.`);
  }
  return Uint8Array.from(values);
}

/** Shared property bridge for source-visible FontFile/Variation/SystemFont setters. */
export function setGodotFontProperty<T extends object, K extends keyof T>(font: T, key: K, value: T[K]): void {
  const name = String(key);
  if (!KNOWN_FONT_FIELDS.has(name)) throw new Error(`Font.${name} is not a writable compat property.`);
  if (BOOLEAN_FONT_FIELDS.has(name) && typeof value !== 'boolean') throw new TypeError(`Font.${name} requires bool.`);
  if (NON_NEGATIVE_FINITE_FONT_FIELDS.has(name) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Font.${name} requires a finite non-negative number.`);
  }
  if (SIGNED_FINITE_FONT_FIELDS.has(name) && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError(`Font.${name} requires a finite number.`);
  }
  if ((name === 'variationEmbolden' || name === 'baselineOffset') && (typeof value !== 'number' || value < -2 || value > 2)) {
    throw new RangeError(`Font.${name} requires a number in -2..2.`);
  }
  const range = INTEGER_FONT_RANGES[name];
  if (range !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < range[0] || value > range[1])) {
    throw new RangeError(`Font.${name} requires an integer in ${range[0]}..${range[1]}.`);
  }
  if (name === 'subpixelPositioning' && !(typeof value === 'number' && [0, 1, 2, 3].includes(value))) {
    throw new RangeError('Font.subpixelPositioning requires a TextServer.SubpixelPositioning value.');
  }
  if ((name === 'styleName' || name === 'fontName') && typeof value !== 'string') throw new TypeError(`Font.${name} requires String.`);
  if (name === 'variationOpentype' || name === 'opentypeFeatures' || name === 'opentypeFeatureOverrides') {
    requireDictionary(value, `Font.${name}`);
  }
  if (name === 'variationTransform') requireFiniteTuple(value, 6, 'Font.variationTransform');
  if (name === 'spacing') {
    const spacing = requireFiniteTuple(value, 4, 'Font.spacing');
    if (spacing.some((entry) => !Number.isSafeInteger(entry) || entry < -0x80000000 || entry > 0x7fffffff)) {
      throw new RangeError('Font.spacing requires four signed 32-bit integers.');
    }
  }
  if (name === 'paletteCustomColors') requireColorArray(value, 'Font.paletteCustomColors');
  if (name === 'outlineColor') requireColor(value, 'DynamicFont.outline_color');
  if (name === 'baseFont' && value !== null) requireFontResource(value, 'FontVariation.base_font');
  if (Object.is(font[key], value)) return;
  font[key] = (name === 'outlineColor' ? { ...(value as object) } : value) as T[K];
  changed(font);
}

export function getGodotFontProperty<T extends object, K extends keyof T>(font: T, key: K): T[K] {
  return (String(key) === 'outlineColor' ? { ...(font[key] as object) } : font[key]) as T[K];
}

/** DynamicFont's retained outline as the native Pixi/CSS stroke presentation. */
export function godotFontOutlinePresentation(value: unknown): GodotFontOutlinePresentation | null {
  const font = requireFontResource(value, 'DynamicFont outline');
  if (!('outlineSize' in font)) return null;
  const dynamic = font as GodotDynamicFont;
  const size = integer(dynamic.outlineSize, 'DynamicFont.outline_size', 0, 0x7fffffff);
  requireColor(dynamic.outlineColor, 'DynamicFont.outline_color');
  return size === 0 ? null : { size, color: cssColor(dynamic.outlineColor) };
}

export function setGodotFontFallbacks(font: GodotFont, fallbacks: readonly GodotFont[]): void {
  if (!Array.isArray(fallbacks)) throw new TypeError('Font.fallbacks requires an Array[Font].');
  for (const fallback of fallbacks) requireFontResource(fallback, 'Font.fallbacks');
  font.fallbacks = [...fallbacks];
  changed(font);
}

export const getGodotFontFallbacks = (font: GodotFont): readonly GodotFont[] => [...font.fallbacks];

export function getGodotFontSpacing(font: GodotFont, type: number): number {
  return fontSpacing(font)[integer(type, 'Font.get_spacing', 0, 3)]!;
}

function requireFontResource(value: unknown, member: string): GodotFont {
  if (typeof value !== 'object' || value === null || typeof (value as Partial<GodotFont>).family !== 'string' || !Array.isArray((value as Partial<GodotFont>).fallbacks)) {
    throw new TypeError(`${member} requires a Font resource.`);
  }
  return value as GodotFont;
}

export function refuseGodotFontGlyphEnumeration(): never {
  throw new Error('Font.get_supported_chars is unavailable: browser FontFace exposes no glyph enumeration API.');
}

function nonNegative(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${member} requires a finite non-negative number.`);
  return value;
}

function integer(value: number, member: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${member} requires an integer in ${min}..${max}.`);
  }
  return value;
}

function familyStack(font: GodotFont): string {
  return [font.family, ...font.fallbacks.map((fallback) => fallback.family)]
    .map((family) => JSON.stringify(family))
    .join(', ');
}

function resolvedFontSize(font: GodotFont, requested: number | undefined): number {
  if (requested !== undefined) return nonNegative(requested, 'Font font_size');
  return 'size' in font ? (font as GodotDynamicFont).size : 16;
}

function cssFont(font: GodotFont, requestedSize: number | undefined): string {
  const fontSize = resolvedFontSize(font, requestedSize);
  const italic = ('fontItalic' in font && (font as GodotSystemFont).fontItalic) ||
    ('fontStyle' in font && (((font as GodotFontFile).fontStyle & 2) !== 0));
  const weight = 'fontWeight' in font ? integer((font as GodotFontFile | GodotSystemFont).fontWeight, 'Font.font_weight', 1, 1000) : 400;
  const stretch = 'fontStretch' in font ? integer((font as GodotFontFile | GodotSystemFont).fontStretch, 'Font.font_stretch', 1, 1000) : 100;
  return `${italic ? 'italic ' : ''}${weight} ${stretch}% ${fontSize}px ${familyStack(font)}`;
}

/** Native Pixi/Canvas text projection for Font-backed retained draw commands. */
export function godotFontCanvasPresentation(
  value: unknown,
  requestedSize?: number,
): {
  readonly fontFamily: readonly string[];
  readonly fontSize: number;
  readonly fontStyle: 'normal' | 'italic';
  readonly fontWeight: '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  readonly letterSpacing: number;
  readonly ascent: number;
  readonly height: number;
  readonly outline: GodotFontOutlinePresentation | null;
} {
  const font = requireFontResource(value, 'CanvasItem.draw_string font');
  const size = resolvedFontSize(font, requestedSize);
  const [glyphSpacing, spaceSpacing] = fontSpacing(font);
  if (spaceSpacing !== 0) {
    throw new Error(
      'godot-compat: CanvasItem.draw_string cannot project Font space spacing separately from Pixi letter spacing.',
    );
  }
  const stretch = 'fontStretch' in font
    ? integer((font as GodotFontFile | GodotSystemFont).fontStretch, 'Font.font_stretch', 1, 1000)
    : 100;
  if (stretch !== 100) {
    throw new Error('godot-compat: CanvasItem.draw_string does not support non-default Font stretch.');
  }
  const weight = 'fontWeight' in font
    ? integer((font as GodotFontFile | GodotSystemFont).fontWeight, 'Font.font_weight', 1, 1000)
    : 400;
  if (weight < 100 || weight > 900 || weight % 100 !== 0) {
    throw new Error(
      'godot-compat: CanvasItem.draw_string requires a Pixi-supported Font weight (100..900 by 100).',
    );
  }
  void loadGodotFont(font);
  return {
    fontFamily: [font.family, ...font.fallbacks.map((fallback) => fallback.family)],
    fontSize: size,
    fontStyle:
      (('fontItalic' in font && (font as GodotSystemFont).fontItalic) ||
        ('fontStyle' in font && ((font as GodotFontFile).fontStyle & 2) !== 0))
        ? 'italic'
        : 'normal',
    fontWeight: String(weight) as '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900',
    letterSpacing: glyphSpacing,
    ascent: godotFontAscent(font, size),
    height: godotFontHeight(font, size),
    outline: godotFontOutlinePresentation(font),
  };
}

function fontSpacing(font: GodotFont): readonly [number, number, number, number] {
  if ('spacing' in font) return (font as GodotFontVariation).spacing;
  if ('spacingChar' in font) {
    const dynamic = font as GodotDynamicFont;
    return [dynamic.spacingChar, dynamic.spacingSpace, dynamic.spacingTop, dynamic.spacingBottom];
  }
  return [0, 0, 0, 0];
}

function measuredTextWidth(font: GodotFont, text: string, width: number): number {
  const [glyph, space] = fontSpacing(font);
  const characters = [...text];
  const spaces = characters.reduce((count, character) => count + (character === ' ' ? 1 : 0), 0);
  return width + Math.max(0, characters.length - 1) * glyph + spaces * space;
}

function metricValue(metrics: TextMetrics, browserMetric: 'fontBoundingBoxAscent' | 'fontBoundingBoxDescent', glyphMetric: 'actualBoundingBoxAscent' | 'actualBoundingBoxDescent', fallback: number): number {
  const faceValue = (metrics as unknown as Record<string, unknown>)[browserMetric];
  if (typeof faceValue === 'number' && Number.isFinite(faceValue) && faceValue > 0) return faceValue;
  const glyphValue = metrics[glyphMetric];
  return Number.isFinite(glyphValue) && glyphValue > 0 ? glyphValue : fallback;
}

/** Load and register the native browser face once. System fonts require no FontFace allocation. */
export function loadGodotFont(font: GodotFontSource): Promise<FontFace | null> {
  const object = font as object;
  const retained = REGISTERED_FACES.get(object);
  if (retained !== undefined) return retained;
  if ('fontData' in font && (font as GodotDynamicFont).fontData !== null) {
    const pending = loadGodotFont((font as GodotDynamicFont).fontData!);
    REGISTERED_FACES.set(object, pending);
    return pending;
  }
  if ('baseFont' in font && (font as GodotFontVariation).baseFont !== null) {
    const pending = loadGodotFont((font as GodotFontVariation).baseFont!);
    REGISTERED_FACES.set(object, pending);
    return pending;
  }
  if (font.source === undefined || typeof FontFace === 'undefined') {
    const resolved = Promise.resolve(null);
    REGISTERED_FACES.set(object, resolved);
    return resolved;
  }
  let pending: Promise<FontFace | null>;
  try {
    const source = typeof font.source === 'string' ? `url(${JSON.stringify(font.source)})` : font.source.slice(0);
    const face = new FontFace(font.family, source, font.descriptors);
    pending = face.load().then((loaded) => {
      FONT_LOAD_ERRORS.delete(object);
      if (typeof document !== 'undefined') document.fonts.add(loaded);
      return loaded;
    }, (error: unknown) => {
      FONT_LOAD_ERRORS.set(object, error);
      godotResourceEmitChanged(object);
      throw error;
    });
  } catch (error) {
    FONT_LOAD_ERRORS.set(object, error);
    godotResourceEmitChanged(object);
    pending = Promise.reject(error);
  }
  REGISTERED_FACES.set(object, pending);
  return pending;
}

function canvasContext(): CanvasRenderingContext2D {
  if (typeof document === 'undefined') throw new Error('Font measurement requires browser Canvas2D.');
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) throw new Error('Font measurement could not acquire Canvas2D.');
  return context;
}

export function godotFontStringSize(font: GodotFont, text: string, requestedSize?: number): { x: number; y: number } {
  if ('glyphs' in font) return bitmapFontStringSize(font as GodotBitmapFont, text, requestedSize);
  const fontSize = resolvedFontSize(font, requestedSize);
  const context = canvasContext();
  context.font = cssFont(font, fontSize);
  const metrics = context.measureText(text);
  return { x: measuredTextWidth(font, text, metrics.width), y: godotFontHeight(font, fontSize) };
}

export function godotFontMultilineStringSize(
  font: GodotFont,
  text: string,
  requestedSize?: number,
  lineSpacing = 0,
): { x: number; y: number } {
  const fontSize = resolvedFontSize(font, requestedSize);
  const lines = text.split('\n');
  const sizes = lines.map((line) => godotFontStringSize(font, line, fontSize));
  return {
    x: Math.max(0, ...sizes.map((size) => size.x)),
    y: sizes.length * godotFontHeight(font, fontSize) + Math.max(0, sizes.length - 1) * lineSpacing,
  };
}

/** Godot 3 Font.get_wordwrap_string_size over the same native glyph metrics as get_string_size. */
export function godotFontWordwrapStringSize(
  font: GodotFont,
  text: string,
  width: number,
): { x: number; y: number } {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0) {
    throw new RangeError('Font.get_wordwrap_string_size width must be finite and non-negative.');
  }
  const fontSize = resolvedFontSize(font, undefined);
  const context = canvasContext();
  context.font = cssFont(font, fontSize);
  const measure = (value: string): number => measuredTextWidth(font, value, context.measureText(value).width);
  const measuredLines: number[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      measuredLines.push(0);
      continue;
    }
    let line = '';
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      const candidate = line + token;
      if (line === '' || measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      measuredLines.push(measure(line.replace(/\s+$/u, '')));
      line = token.replace(/^\s+/u, '');
    }
    measuredLines.push(measure(line.replace(/\s+$/u, '')));
  }

  return {
    x: Math.max(0, ...measuredLines),
    y: measuredLines.length * godotFontHeight(font, fontSize),
  };
}

export function godotFontHeight(font: GodotFont, requestedSize?: number): number {
  if ('glyphs' in font) return scaledBitmapMetric(font as GodotBitmapFont, (font as GodotBitmapFont).height, requestedSize);
  const [, , top, bottom] = fontSpacing(font);
  return godotFontAscent(font, requestedSize) + godotFontDescent(font, requestedSize) + top + bottom;
}

export function godotFontAscent(font: GodotFont, requestedSize?: number): number {
  if ('glyphs' in font) return scaledBitmapMetric(font as GodotBitmapFont, (font as GodotBitmapFont).ascent, requestedSize);
  const fontSize = resolvedFontSize(font, requestedSize);
  const context = canvasContext();
  context.font = cssFont(font, fontSize);
  const metrics = context.measureText('Hg');
  return metricValue(metrics, 'fontBoundingBoxAscent', 'actualBoundingBoxAscent', fontSize * 0.8);
}

export function godotFontDescent(font: GodotFont, requestedSize?: number): number {
  if ('glyphs' in font) {
    const bitmap = font as GodotBitmapFont;
    return scaledBitmapMetric(bitmap, Math.max(0, bitmap.height - bitmap.ascent), requestedSize);
  }
  const fontSize = resolvedFontSize(font, requestedSize);
  const context = canvasContext();
  context.font = cssFont(font, fontSize);
  const metrics = context.measureText('Hg');
  return metricValue(metrics, 'fontBoundingBoxDescent', 'actualBoundingBoxDescent', fontSize * 0.2);
}

export function godotFontUnderlinePosition(font: GodotFont, requestedSize?: number): number {
  return Math.max(1, godotFontDescent(font, requestedSize) * 0.5);
}

export function godotFontUnderlineThickness(font: GodotFont, requestedSize?: number): number {
  const size = resolvedFontSize(font, requestedSize);
  return Math.max(1, size / 16);
}

export function godotFontScale(font: GodotFont, requestedSize?: number): number {
  if ('fixedSize' in font && (font as GodotFontFile).fixedSize > 0) {
    return resolvedFontSize(font, requestedSize) / (font as GodotFontFile).fixedSize;
  }
  return 1;
}

export function godotFontHasChar(font: GodotFont, character: number): boolean {
  integer(character, 'Font.has_char', 0, 0x10ffff);
  if ('glyphs' in font) {
    const bitmap = font as GodotBitmapFont;
    return bitmap.glyphs.has(character) || bitmap.fallback?.glyphs.has(character) === true;
  }
  // Browser shaping transparently traverses the installed fallback list, so every valid scalar is
  // drawable even though the browser does not expose which physical face ultimately owns it.
  void font;
  return character < 0xd800 || character > 0xdfff;
}

export function godotFontCharSize(font: GodotFont, character: number, sizeOrNext?: number): { x: number; y: number } {
  integer(character, 'Font.get_char_size', 0, 0x10ffff);
  const characterText = String.fromCodePoint(character);
  if ('size' in font) {
    const next = sizeOrNext === undefined ? 0 : integer(sizeOrNext, 'Font.get_char_size next', 0, 0x10ffff);
    if (next === 0) return godotFontStringSize(font, characterText);
    const nextText = String.fromCodePoint(next);
    const pair = godotFontStringSize(font, characterText + nextText);
    const nextSize = godotFontStringSize(font, nextText);
    return { x: pair.x - nextSize.x, y: pair.y };
  }
  return godotFontStringSize(font, characterText, sizeOrNext);
}

/** Browser/system fonts shape every valid BCP-47 language through the platform fallback stack. */
export function godotFontIsLanguageSupported(font: GodotFont, language: string): boolean {
  if (typeof language !== 'string') throw new TypeError('Font.is_language_supported requires String.');
  void font;
  return language.length > 0;
}

/** Browser/system fonts expose platform script fallback without a per-face script query. */
export function godotFontIsScriptSupported(font: GodotFont, script: string): boolean {
  if (typeof script !== 'string') throw new TypeError('Font.is_script_supported requires String.');
  void font;
  return script.length > 0;
}

const FONT_LANGUAGE_OVERRIDES = new WeakMap<GodotFont, Map<string, boolean>>();
const FONT_SCRIPT_OVERRIDES = new WeakMap<GodotFont, Map<string, boolean>>();

function supportOverrides(
  owner: GodotFont,
  storage: WeakMap<GodotFont, Map<string, boolean>>,
): Map<string, boolean> {
  let overrides = storage.get(owner);
  if (overrides === undefined) {
    overrides = new Map();
    storage.set(owner, overrides);
  }
  return overrides;
}

function supportKey(value: string, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${member} requires a non-empty String.`);
  }
  return value;
}

/** Browser glyph identity uses the Unicode scalar retained by this compatibility resource. */
export function godotFontGetGlyphIndex(
  font: GodotFont,
  fontSize: number,
  character: number,
  variationSelector = 0,
): number {
  nonNegative(fontSize, 'Font.get_glyph_index font_size');
  const scalar = integer(character, 'Font.get_glyph_index char', 0, 0x10ffff);
  integer(variationSelector, 'Font.get_glyph_index variation_selector', 0, 0x10ffff);
  return godotFontHasChar(font, scalar) ? scalar : 0;
}

export function godotFontGetCharFromGlyphIndex(
  font: GodotFont,
  fontSize: number,
  glyphIndex: number,
): number {
  nonNegative(fontSize, 'Font.get_char_from_glyph_index font_size');
  const glyph = integer(glyphIndex, 'Font.get_char_from_glyph_index glyph_index', 0, 0x10ffff);
  return godotFontHasChar(font, glyph) ? glyph : 0;
}

export function godotFontGetGlyphAdvance(
  font: GodotFont,
  fontSize: number,
  glyphIndex: number,
): { x: number; y: number } {
  const glyph = godotFontGetCharFromGlyphIndex(font, fontSize, glyphIndex);
  return glyph === 0 ? { x: 0, y: 0 } : godotFontStringSize(font, String.fromCodePoint(glyph), fontSize);
}

export function godotFontGetKerning(
  font: GodotFont,
  fontSize: number,
  glyphPair: { x: number; y: number },
): { x: number; y: number } {
  const left = godotFontGetCharFromGlyphIndex(font, fontSize, glyphPair.x);
  const right = godotFontGetCharFromGlyphIndex(font, fontSize, glyphPair.y);
  if (left === 0 || right === 0) return { x: 0, y: 0 };
  const leftText = String.fromCodePoint(left);
  const rightText = String.fromCodePoint(right);
  const pair = godotFontStringSize(font, leftText + rightText, fontSize);
  const separate = godotFontStringSize(font, leftText, fontSize).x +
    godotFontStringSize(font, rightText, fontSize).x;
  return { x: pair.x - separate, y: 0 };
}

export function godotFontSetLanguageSupportOverride(
  font: GodotFont,
  language: string,
  supported: boolean,
): void {
  if (typeof supported !== 'boolean') throw new TypeError('Font language override requires bool.');
  supportOverrides(font, FONT_LANGUAGE_OVERRIDES)
    .set(supportKey(language, 'Font language override'), supported);
  changed(font);
}

export function godotFontGetLanguageSupportOverride(font: GodotFont, language: string): boolean {
  return FONT_LANGUAGE_OVERRIDES.get(font)?.get(supportKey(language, 'Font language override')) ?? false;
}

export function godotFontRemoveLanguageSupportOverride(font: GodotFont, language: string): void {
  if (FONT_LANGUAGE_OVERRIDES.get(font)?.delete(supportKey(language, 'Font language override')) === true) changed(font);
}

export function godotFontGetLanguageSupportOverrides(font: GodotFont): readonly string[] {
  return [...(FONT_LANGUAGE_OVERRIDES.get(font)?.keys() ?? [])];
}

export function godotFontSetScriptSupportOverride(
  font: GodotFont,
  script: string,
  supported: boolean,
): void {
  if (typeof supported !== 'boolean') throw new TypeError('Font script override requires bool.');
  supportOverrides(font, FONT_SCRIPT_OVERRIDES)
    .set(supportKey(script, 'Font script override'), supported);
  changed(font);
}

export function godotFontGetScriptSupportOverride(font: GodotFont, script: string): boolean {
  return FONT_SCRIPT_OVERRIDES.get(font)?.get(supportKey(script, 'Font script override')) ?? false;
}

export function godotFontRemoveScriptSupportOverride(font: GodotFont, script: string): void {
  if (FONT_SCRIPT_OVERRIDES.get(font)?.delete(supportKey(script, 'Font script override')) === true) changed(font);
}

export function godotFontGetScriptSupportOverrides(font: GodotFont): readonly string[] {
  return [...(FONT_SCRIPT_OVERRIDES.get(font)?.keys() ?? [])];
}

export function godotFontGetOpentypeFeatures(font: GodotFont): Record<string, number> {
  if ('opentypeFeatures' in font) return { ...(font as GodotFontVariation).opentypeFeatures };
  if ('opentypeFeatureOverrides' in font) return { ...(font as GodotFontFile).opentypeFeatureOverrides };
  return {};
}

export function godotFontGetSupportedFeatureList(font: GodotFont): Record<string, number> {
  const retained = godotFontGetOpentypeFeatures(font);
  return Object.fromEntries(Object.keys(retained).map((tag) => [tag, 1]));
}

export function godotFontGetSupportedVariationList(font: GodotFont): Record<string, { min_value: number; max_value: number; default_value: number }> {
  if ('variationOpentype' in font) {
    return Object.fromEntries(Object.entries((font as GodotFontVariation).variationOpentype).map(([tag, value]) => [tag, {
      min_value: value, max_value: value, default_value: value,
    }]));
  }
  return {};
}

export function godotFontGetFaceCount(font: GodotFont): number {
  void font;
  return 1;
}

export function godotFontGetOtNameStrings(font: GodotFont): Record<string, Record<string, string>> {
  return {
    en: {
      family: godotFontName(font),
      style: godotFontStyleName(font),
    },
  };
}

export function godotFontGetRid(font: GodotFont): ReturnType<typeof godotResourceGetRid> {
  return godotResourceGetRid(font as object);
}

export function godotFontGetRids(font: GodotFont): ReturnType<typeof godotResourceGetRid>[] {
  const seen = new Set<object>();
  const rids: ReturnType<typeof godotResourceGetRid>[] = [];
  const collect = (candidate: GodotFont): void => {
    if (seen.has(candidate as object)) return;
    seen.add(candidate as object);
    rids.push(godotResourceGetRid(candidate as object));
    for (const fallback of candidate.fallbacks) collect(fallback);
  };
  collect(font);
  return rids;
}

type GodotFontStorage = GodotFontSource & { fallbacks: GodotFont[] };

function installGodotFontApi<T extends GodotFontStorage>(font: T): T & GodotFont {
  let complete!: T & GodotFont;
  const api = {
    get_height: (fontSize?: number): number => godotFontHeight(complete, fontSize),
    get_ascent: (fontSize?: number): number => godotFontAscent(complete, fontSize),
    get_descent: (fontSize?: number): number => godotFontDescent(complete, fontSize),
    get_underline_position: (fontSize?: number): number => godotFontUnderlinePosition(complete, fontSize),
    get_underline_thickness: (fontSize?: number): number => godotFontUnderlineThickness(complete, fontSize),
    get_scale: (fontSize?: number): number => godotFontScale(complete, fontSize),
    get_string_size: (
      text: string,
      _horizontalAlignment = 0,
      _width = -1,
      fontSize?: number,
    ): { x: number; y: number } => godotFontStringSize(complete, text, fontSize),
    get_multiline_string_size: (
      text: string,
      _horizontalAlignment = 0,
      width = -1,
      fontSize?: number,
      maxLines = -1,
    ): { x: number; y: number } => {
      if (!Number.isSafeInteger(maxLines) || maxLines < -1) {
        throw new RangeError('Font.get_multiline_string_size max_lines must be -1 or non-negative.');
      }
      const retained = maxLines < 0 ? text : text.split('\n').slice(0, maxLines).join('\n');
      if (width >= 0 && fontSize === undefined) return godotFontWordwrapStringSize(complete, retained, width);
      return godotFontMultilineStringSize(complete, retained, fontSize);
    },
    get_wordwrap_string_size: (text: string, width: number): { x: number; y: number } =>
      godotFontWordwrapStringSize(complete, text, width),
    has_char: (character: number): boolean => godotFontHasChar(complete, character),
    get_char_size: (character: number, fontSizeOrNext?: number): { x: number; y: number } =>
      godotFontCharSize(complete, character, fontSizeOrNext),
    get_glyph_index: (fontSize: number, character: number, variationSelector = 0): number =>
      godotFontGetGlyphIndex(complete, fontSize, character, variationSelector),
    get_char_from_glyph_index: (fontSize: number, glyphIndex: number): number =>
      godotFontGetCharFromGlyphIndex(complete, fontSize, glyphIndex),
    get_glyph_advance: (fontSize: number, glyphIndex: number): { x: number; y: number } =>
      godotFontGetGlyphAdvance(complete, fontSize, glyphIndex),
    get_kerning: (fontSize: number, glyphPair: { x: number; y: number }): { x: number; y: number } =>
      godotFontGetKerning(complete, fontSize, glyphPair),
    is_language_supported: (language: string): boolean => godotFontIsLanguageSupported(complete, language),
    is_script_supported: (script: string): boolean => godotFontIsScriptSupported(complete, script),
    set_language_support_override: (language: string, supported: boolean): void =>
      godotFontSetLanguageSupportOverride(complete, language, supported),
    get_language_support_override: (language: string): boolean =>
      godotFontGetLanguageSupportOverride(complete, language),
    remove_language_support_override: (language: string): void =>
      godotFontRemoveLanguageSupportOverride(complete, language),
    get_language_support_overrides: (): readonly string[] => godotFontGetLanguageSupportOverrides(complete),
    set_script_support_override: (script: string, supported: boolean): void =>
      godotFontSetScriptSupportOverride(complete, script, supported),
    get_script_support_override: (script: string): boolean =>
      godotFontGetScriptSupportOverride(complete, script),
    remove_script_support_override: (script: string): void =>
      godotFontRemoveScriptSupportOverride(complete, script),
    get_script_support_overrides: (): readonly string[] => godotFontGetScriptSupportOverrides(complete),
    get_opentype_features: (): Record<string, number> => godotFontGetOpentypeFeatures(complete),
    get_supported_feature_list: (): Record<string, number> => godotFontGetSupportedFeatureList(complete),
    get_supported_variation_list: (): Record<string, { min_value: number; max_value: number; default_value: number }> =>
      godotFontGetSupportedVariationList(complete),
    get_face_count: (): number => godotFontGetFaceCount(complete),
    get_ot_name_strings: (): Record<string, Record<string, string>> => godotFontGetOtNameStrings(complete),
    get_rid: (): ReturnType<typeof godotResourceGetRid> => godotFontGetRid(complete),
    get_rids: (): ReturnType<typeof godotResourceGetRid>[] => godotFontGetRids(complete),
    get_font_name: (): string => godotFontName(complete),
    get_font_style_name: (): string => godotFontStyleName(complete),
    get_font_style: (): number => godotFontStyle(complete),
    get_font_weight: (): number => godotFontWeight(complete),
    get_font_stretch: (): number => godotFontStretch(complete),
    set_fallbacks: (fallbacks: readonly GodotFont[]): void => setGodotFontFallbacks(complete, fallbacks),
  };
  Object.defineProperties(font, Object.fromEntries(
    Object.entries(api).map(([name, value]) => [name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    }]),
  ));
  complete = Object.assign(font, api);
  return complete;
}

function installBitmapFontApi(font: GodotBitmapFont): void {
  Object.defineProperties(font, {
    distance_field: {
      configurable: true,
      enumerable: true,
      get: () => font.distanceField,
      set: (value: boolean) => setBitmapFontDistanceField(font, value),
    },
    set_height: { configurable: true, value: (value: number): void => setBitmapFontHeight(font, value) },
    set_ascent: { configurable: true, value: (value: number): void => setBitmapFontAscent(font, value) },
    set_distance_field_hint: { configurable: true, value: (value: boolean): void => setBitmapFontDistanceField(font, value) },
    is_distance_field_hint: { configurable: true, value: (): boolean => isBitmapFontDistanceField(font) },
    set_fallback: { configurable: true, value: (value: GodotBitmapFont | null): void => setBitmapFontFallback(font, value) },
    get_fallback: { configurable: true, value: (): GodotBitmapFont | null => font.fallback },
    add_texture: { configurable: true, value: (value: unknown): void => addBitmapFontTexture(font, value) },
    get_texture: { configurable: true, value: (index: number): unknown => getBitmapFontTexture(font, index) },
    add_char: {
      configurable: true,
      value: (character: number, textureIndex: number, rect: GodotBitmapGlyph['rect'], align = { x: 0, y: 0 }, advance = -1): void =>
        addBitmapFontGlyph(font, character, textureIndex, rect, align, advance),
    },
    add_kerning_pair: {
      configurable: true,
      value: (left: number, right: number, amount: number): void => addBitmapFontKerning(font, left, right, amount),
    },
    get_kerning_pair: {
      configurable: true,
      value: (left: number, right: number): number => getBitmapFontKerning(font, left, right),
    },
    set_chars: { configurable: true, value: (values: readonly number[]): void => setBitmapFontChars(font, values) },
    get_chars: { configurable: true, value: (): number[] => getBitmapFontChars(font) },
    set_kernings: { configurable: true, value: (values: readonly number[]): void => setBitmapFontKernings(font, values) },
    get_kernings: { configurable: true, value: (): number[] => getBitmapFontKernings(font) },
    set_textures: { configurable: true, value: (values: readonly unknown[]): void => setBitmapFontTextures(font, values) },
    get_textures: { configurable: true, value: (): unknown[] => getBitmapFontTextures(font) },
  });
}

function installDynamicFontDataApi(data: GodotDynamicFontData): void {
  Object.defineProperties(data, {
    font_path: {
      configurable: true,
      enumerable: true,
      get: () => data.fontPath,
      set: (value: string) => setDynamicFontDataPath(data, value),
    },
    override_oversampling: {
      configurable: true,
      enumerable: true,
      get: () => data.overrideOversampling,
      set: (value: number) => setDynamicFontDataOverrideOversampling(data, value),
    },
    set_font_path: { configurable: true, value: (value: string): void => setDynamicFontDataPath(data, value) },
    get_font_path: { configurable: true, value: (): string => getDynamicFontDataPath(data) },
    set_antialiased: { configurable: true, value: (value: boolean): void => setDynamicFontDataAntialiased(data, value) },
    is_antialiased: { configurable: true, value: (): boolean => isDynamicFontDataAntialiased(data) },
    set_hinting: { configurable: true, value: (value: number): void => setDynamicFontDataHinting(data, value) },
    get_hinting: { configurable: true, value: (): number => getDynamicFontDataHinting(data) },
    set_override_oversampling: { configurable: true, value: (value: number): void => setDynamicFontDataOverrideOversampling(data, value) },
    get_override_oversampling: { configurable: true, value: (): number => getDynamicFontDataOverrideOversampling(data) },
  });
}

function installDynamicFontApi(font: GodotDynamicFont): void {
  Object.defineProperties(font, {
    font_data: {
      configurable: true,
      enumerable: true,
      get: () => font.fontData,
      set: (value: GodotDynamicFontData | null) => setDynamicFontData(font, value),
    },
    outline_size: {
      configurable: true,
      enumerable: true,
      get: () => font.outlineSize,
      set: (value: number) => setGodotFontProperty(font, 'outlineSize', integer(value, 'DynamicFont.outline_size', 0)),
    },
    outline_color: {
      configurable: true,
      enumerable: true,
      get: () => ({ ...font.outlineColor }),
      set: (value: GodotDynamicFont['outlineColor']) => {
        requireColor(value, 'DynamicFont.outline_color');
        setGodotFontProperty(font, 'outlineColor', { ...value });
      },
    },
    use_mipmaps: {
      configurable: true,
      enumerable: true,
      get: () => font.useMipmaps,
      set: (value: boolean) => setGodotFontProperty(font, 'useMipmaps', requireBoolean(value, 'DynamicFont.use_mipmaps')),
    },
    use_filter: {
      configurable: true,
      enumerable: true,
      get: () => font.useFilter,
      set: (value: boolean) => setGodotFontProperty(font, 'useFilter', requireBoolean(value, 'DynamicFont.use_filter')),
    },
    set_font_data: { configurable: true, value: (value: GodotDynamicFontData | null): void => setDynamicFontData(font, value) },
    get_font_data: { configurable: true, value: (): GodotDynamicFontData | null => font.fontData },
    set_size: { configurable: true, value: (value: number): void => setDynamicFontSize(font, value) },
    get_size: { configurable: true, value: (): number => font.size },
    add_fallback: { configurable: true, value: (value: GodotFont): void => addDynamicFontFallback(font, value) },
    set_fallback: { configurable: true, value: (index: number, value: GodotFont): void => setDynamicFontFallback(font, index, value) },
    get_fallback: { configurable: true, value: (index: number): GodotFont => font.fallbacks[integer(index, 'DynamicFont.get_fallback', 0, font.fallbacks.length - 1)]! },
    get_fallback_count: { configurable: true, value: (): number => font.fallbacks.length },
    remove_fallback: { configurable: true, value: (index: number): void => removeDynamicFontFallback(font, index) },
    set_spacing: { configurable: true, value: (type: number, value: number): void => setDynamicFontSpacing(font, type, value) },
    get_spacing: { configurable: true, value: (type: number): number => getDynamicFontSpacing(font, type) },
  });
}

function installFontAliases<T extends object>(
  font: T,
  aliases: Readonly<Record<string, keyof T>>,
): void {
  Object.defineProperties(font, Object.fromEntries(
    Object.entries(aliases).map(([alias, key]) => [alias, {
      configurable: true,
      enumerable: true,
      get: () => font[key],
      set: (value: T[keyof T]) => setGodotFontProperty(font, key, value),
    }]),
  ));
}

function installFontFileApi(font: GodotFontFile): void {
  installFontAliases(font, {
    font_name: 'fontName',
    style_name: 'styleName',
    font_style: 'fontStyle',
    font_weight: 'fontWeight',
    font_stretch: 'fontStretch',
    disable_embedded_bitmaps: 'disableEmbeddedBitmaps',
    generate_mipmaps: 'generateMipmaps',
    allow_system_fallback: 'allowSystemFallback',
    force_autohinter: 'forceAutohinter',
    modulate_color_glyphs: 'modulateColorGlyphs',
    subpixel_positioning: 'subpixelPositioning',
    keep_rounding_remainders: 'keepRoundingRemainders',
    multichannel_signed_distance_field: 'multichannelSignedDistanceField',
    msdf_pixel_range: 'msdfPixelRange',
    msdf_size: 'msdfSize',
    fixed_size: 'fixedSize',
    fixed_size_scale_mode: 'fixedSizeScaleMode',
    opentype_feature_overrides: 'opentypeFeatureOverrides',
  });
  Object.defineProperties(font, {
    set_data: { configurable: true, value: (value: Iterable<number>): void => setFontFileData(font, value) },
    get_data: { configurable: true, value: (): Uint8Array => getFontFileData(font) },
    set_font_name: { configurable: true, value: (value: string): void => setFontFileName(font, value) },
    get_font_name: { configurable: true, value: (): string => getFontFileName(font) },
    load_dynamic_font: { configurable: true, value: (path: string): number => loadFontFileDynamic(font, path) },
    load_bitmap_font: { configurable: true, value: (): never => refuseBitmapFontLoad() },
    set_opentype_feature_overrides: {
      configurable: true,
      value: (value: Record<string, number>): void => setGodotFontProperty(font, 'opentypeFeatureOverrides', value),
    },
    get_opentype_feature_overrides: {
      configurable: true,
      value: (): Record<string, number> => ({ ...font.opentypeFeatureOverrides }),
    },
    set_font_style: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fontStyle', value) },
    get_font_style: { configurable: true, value: (): number => font.fontStyle },
    set_font_weight: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fontWeight', value) },
    get_font_weight: { configurable: true, value: (): number => font.fontWeight },
    set_font_stretch: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fontStretch', value) },
    get_font_stretch: { configurable: true, value: (): number => font.fontStretch },
    set_antialiasing: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'antialiasing', value) },
    get_antialiasing: { configurable: true, value: (): number => font.antialiasing },
    set_disable_embedded_bitmaps: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'disableEmbeddedBitmaps', value) },
    get_disable_embedded_bitmaps: { configurable: true, value: (): boolean => font.disableEmbeddedBitmaps },
    set_generate_mipmaps: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'generateMipmaps', value) },
    get_generate_mipmaps: { configurable: true, value: (): boolean => font.generateMipmaps },
    set_allow_system_fallback: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'allowSystemFallback', value) },
    is_allow_system_fallback: { configurable: true, value: (): boolean => font.allowSystemFallback },
    set_force_autohinter: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'forceAutohinter', value) },
    is_force_autohinter: { configurable: true, value: (): boolean => font.forceAutohinter },
    set_modulate_color_glyphs: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'modulateColorGlyphs', value) },
    is_modulate_color_glyphs: { configurable: true, value: (): boolean => font.modulateColorGlyphs },
    set_hinting: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'hinting', value) },
    get_hinting: { configurable: true, value: (): number => font.hinting },
    set_subpixel_positioning: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'subpixelPositioning', value) },
    get_subpixel_positioning: { configurable: true, value: (): number => font.subpixelPositioning },
    set_keep_rounding_remainders: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'keepRoundingRemainders', value) },
    get_keep_rounding_remainders: { configurable: true, value: (): boolean => font.keepRoundingRemainders },
    set_multichannel_signed_distance_field: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'multichannelSignedDistanceField', value) },
    is_multichannel_signed_distance_field: { configurable: true, value: (): boolean => font.multichannelSignedDistanceField },
    set_msdf_pixel_range: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'msdfPixelRange', value) },
    get_msdf_pixel_range: { configurable: true, value: (): number => font.msdfPixelRange },
    set_msdf_size: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'msdfSize', value) },
    get_msdf_size: { configurable: true, value: (): number => font.msdfSize },
    set_fixed_size: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fixedSize', value) },
    get_fixed_size: { configurable: true, value: (): number => font.fixedSize },
    set_fixed_size_scale_mode: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fixedSizeScaleMode', value) },
    get_fixed_size_scale_mode: { configurable: true, value: (): number => font.fixedSizeScaleMode },
    set_oversampling: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'oversampling', value) },
    get_oversampling: { configurable: true, value: (): number => font.oversampling },
  });
}

function installFontVariationApi(font: GodotFontVariation): void {
  installFontAliases(font, {
    base_font: 'baseFont',
    variation_opentype: 'variationOpentype',
    variation_face_index: 'variationFaceIndex',
    variation_embolden: 'variationEmbolden',
    variation_transform: 'variationTransform',
    opentype_features: 'opentypeFeatures',
    baseline_offset: 'baselineOffset',
    palette_index: 'paletteIndex',
    palette_custom_colors: 'paletteCustomColors',
  });
  Object.defineProperties(font, {
    set_spacing: {
      configurable: true,
      value: (type: number, value: number): void => setFontVariationSpacing(font, type, value),
    },
    get_spacing: {
      configurable: true,
      value: (type: number): number => font.spacing[integer(type, 'FontVariation.get_spacing', 0, 3)]!,
    },
    set_base_font: {
      configurable: true,
      value: (value: GodotFont | null): void => setGodotFontProperty(font, 'baseFont', value),
    },
    get_base_font: { configurable: true, value: (): GodotFont | null => font.baseFont },
    set_variation_opentype: { configurable: true, value: (value: Record<string, number>): void => setGodotFontProperty(font, 'variationOpentype', value) },
    get_variation_opentype: { configurable: true, value: (): Record<string, number> => ({ ...font.variationOpentype }) },
    set_variation_face_index: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'variationFaceIndex', value) },
    get_variation_face_index: { configurable: true, value: (): number => font.variationFaceIndex },
    set_variation_embolden: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'variationEmbolden', value) },
    get_variation_embolden: { configurable: true, value: (): number => font.variationEmbolden },
    set_variation_transform: { configurable: true, value: (value: readonly number[]): void => setGodotFontProperty(font, 'variationTransform', value) },
    get_variation_transform: { configurable: true, value: (): readonly number[] => [...font.variationTransform] },
    set_opentype_features: { configurable: true, value: (value: Record<string, number>): void => setGodotFontProperty(font, 'opentypeFeatures', value) },
    get_opentype_features: { configurable: true, value: (): Record<string, number> => ({ ...font.opentypeFeatures }) },
    set_baseline_offset: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'baselineOffset', value) },
    get_baseline_offset: { configurable: true, value: (): number => font.baselineOffset },
    set_palette_index: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'paletteIndex', value) },
    get_palette_index: { configurable: true, value: (): number => font.paletteIndex },
    set_palette_custom_colors: { configurable: true, value: (value: readonly unknown[]): void => setGodotFontProperty(font, 'paletteCustomColors', value) },
    get_palette_custom_colors: { configurable: true, value: (): readonly unknown[] => [...font.paletteCustomColors] },
  });
}

function installSystemFontApi(font: GodotSystemFont): void {
  installFontAliases(font, {
    font_italic: 'fontItalic',
    font_weight: 'fontWeight',
    font_stretch: 'fontStretch',
    disable_embedded_bitmaps: 'disableEmbeddedBitmaps',
    generate_mipmaps: 'generateMipmaps',
    allow_system_fallback: 'allowSystemFallback',
    force_autohinter: 'forceAutohinter',
    modulate_color_glyphs: 'modulateColorGlyphs',
    subpixel_positioning: 'subpixelPositioning',
    keep_rounding_remainders: 'keepRoundingRemainders',
    multichannel_signed_distance_field: 'multichannelSignedDistanceField',
    msdf_pixel_range: 'msdfPixelRange',
    msdf_size: 'msdfSize',
  });
  Object.defineProperties(font, {
    font_names: {
      configurable: true,
      enumerable: true,
      get: () => [...font.fontNames],
      set: (value: readonly string[]) => setSystemFontNames(font, value),
    },
    set_font_names: {
      configurable: true,
      value: (value: readonly string[]): void => setSystemFontNames(font, value),
    },
    get_font_names: {
      configurable: true,
      value: (): readonly string[] => getSystemFontNames(font),
    },
    set_font_italic: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'fontItalic', value) },
    get_font_italic: { configurable: true, value: (): boolean => font.fontItalic },
    set_font_weight: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fontWeight', value) },
    get_font_weight: { configurable: true, value: (): number => font.fontWeight },
    set_font_stretch: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'fontStretch', value) },
    get_font_stretch: { configurable: true, value: (): number => font.fontStretch },
    set_antialiasing: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'antialiasing', value) },
    get_antialiasing: { configurable: true, value: (): number => font.antialiasing },
    set_disable_embedded_bitmaps: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'disableEmbeddedBitmaps', value) },
    get_disable_embedded_bitmaps: { configurable: true, value: (): boolean => font.disableEmbeddedBitmaps },
    set_generate_mipmaps: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'generateMipmaps', value) },
    get_generate_mipmaps: { configurable: true, value: (): boolean => font.generateMipmaps },
    set_allow_system_fallback: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'allowSystemFallback', value) },
    is_allow_system_fallback: { configurable: true, value: (): boolean => font.allowSystemFallback },
    set_force_autohinter: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'forceAutohinter', value) },
    is_force_autohinter: { configurable: true, value: (): boolean => font.forceAutohinter },
    set_modulate_color_glyphs: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'modulateColorGlyphs', value) },
    is_modulate_color_glyphs: { configurable: true, value: (): boolean => font.modulateColorGlyphs },
    set_hinting: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'hinting', value) },
    get_hinting: { configurable: true, value: (): number => font.hinting },
    set_subpixel_positioning: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'subpixelPositioning', value) },
    get_subpixel_positioning: { configurable: true, value: (): number => font.subpixelPositioning },
    set_keep_rounding_remainders: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'keepRoundingRemainders', value) },
    get_keep_rounding_remainders: { configurable: true, value: (): boolean => font.keepRoundingRemainders },
    set_multichannel_signed_distance_field: { configurable: true, value: (value: boolean): void => setGodotFontProperty(font, 'multichannelSignedDistanceField', value) },
    is_multichannel_signed_distance_field: { configurable: true, value: (): boolean => font.multichannelSignedDistanceField },
    set_msdf_pixel_range: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'msdfPixelRange', value) },
    get_msdf_pixel_range: { configurable: true, value: (): number => font.msdfPixelRange },
    set_msdf_size: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'msdfSize', value) },
    get_msdf_size: { configurable: true, value: (): number => font.msdfSize },
    set_oversampling: { configurable: true, value: (value: number): void => setGodotFontProperty(font, 'oversampling', value) },
    get_oversampling: { configurable: true, value: (): number => font.oversampling },
  });
}

function bitmapKerningKey(left: number, right: number): string {
  return `${left}:${right}`;
}

function scaledBitmapMetric(font: GodotBitmapFont, value: number, requestedSize?: number): number {
  if (requestedSize === undefined || font.height <= 0) return value;
  return value * (integer(requestedSize, 'BitmapFont size', 1) / font.height);
}

function bitmapFontStringSize(font: GodotBitmapFont, text: string, requestedSize?: number): { x: number; y: number } {
  let width = 0;
  let previous: number | undefined;
  for (const characterText of text) {
    const character = characterText.codePointAt(0)!;
    const owner = font.glyphs.has(character) ? font : font.fallback;
    const glyph = owner?.glyphs.get(character);
    if (glyph === undefined) continue;
    if (previous !== undefined) width += owner!.kernings.get(bitmapKerningKey(previous, character)) ?? 0;
    width += glyph.advance >= 0 ? glyph.advance : glyph.rect.width;
    previous = character;
  }
  return {
    x: scaledBitmapMetric(font, width, requestedSize),
    y: scaledBitmapMetric(font, font.height, requestedSize),
  };
}

export function createGodotBitmapFont(): GodotBitmapFont {
  const font = installGodotFontApi({
    family: generatedFamily('GodotBitmapFont'), fallbacks: [] as GodotFont[], ascent: 0, height: 1,
    distanceField: false, fallback: null as GodotBitmapFont | null,
    glyphs: new Map<number, GodotBitmapGlyph>(), kernings: new Map<string, number>(),
    textures: [] as unknown[],
  });
  registerGodotObjectIdentity(font, 'BitmapFont');
  installBitmapFontApi(font);
  return bindGodotResourceProtocol<GodotBitmapFont>(font, {
    createDuplicate(source) {
      const copy = createGodotBitmapFont();
      copy.ascent = source.ascent;
      copy.height = source.height;
      copy.distanceField = source.distanceField;
      for (const [character, glyph] of source.glyphs) {
        copy.glyphs.set(character, { ...glyph, rect: { ...glyph.rect }, align: { ...glyph.align } });
      }
      for (const [pair, kerning] of source.kernings) copy.kernings.set(pair, kerning);
      copy.textures.push(...source.textures);
      return copy;
    },
    populateDuplicate(source, target, deep, memo) {
      target.fallback = deep ? duplicateGodotSubresource(source.fallback, memo) : source.fallback;
    },
  });
}

export function setBitmapFontHeight(font: GodotBitmapFont, value: number): void {
  const next = nonNegative(value, 'BitmapFont.height');
  if (font.height !== next) { font.height = next; changed(font); }
}
export const getBitmapFontHeight = (font: GodotBitmapFont): number => font.height;
export function setBitmapFontAscent(font: GodotBitmapFont, value: number): void {
  const next = nonNegative(value, 'BitmapFont.ascent');
  if (font.ascent !== next) { font.ascent = next; changed(font); }
}
export const getBitmapFontAscent = (font: GodotBitmapFont): number => font.ascent;
export function setBitmapFontDistanceField(font: GodotBitmapFont, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('BitmapFont.distance_field requires bool.');
  if (font.distanceField !== enabled) { font.distanceField = enabled; changed(font); }
}
export const isBitmapFontDistanceField = (font: GodotBitmapFont): boolean => font.distanceField;
export function setBitmapFontFallback(font: GodotBitmapFont, fallback: GodotBitmapFont | null): void {
  if (fallback !== null && !('glyphs' in fallback)) throw new TypeError('BitmapFont.fallback requires BitmapFont.');
  if (font.fallback !== fallback) { font.fallback = fallback; changed(font); }
}
export const getBitmapFontFallback = (font: GodotBitmapFont): GodotBitmapFont | null => font.fallback;
export function addBitmapFontTexture(font: GodotBitmapFont, texture: unknown): void {
  if (texture === null || texture === undefined) throw new TypeError('BitmapFont.add_texture requires Texture.');
  font.textures.push(texture); changed(font);
}
export const getBitmapFontTextureCount = (font: GodotBitmapFont): number => font.textures.length;
export function getBitmapFontTexture(font: GodotBitmapFont, index: number): unknown {
  return font.textures[integer(index, 'BitmapFont.get_texture', 0, font.textures.length - 1)];
}
export function addBitmapFontGlyph(
  font: GodotBitmapFont,
  character: number,
  texture: number,
  rect: { x: number; y: number; width: number; height: number },
  align: { x: number; y: number } = { x: 0, y: 0 },
  advance = -1,
): void {
  const codepoint = integer(character, 'BitmapFont.add_char character', 0, 0x10ffff);
  const textureIndex = integer(texture, 'BitmapFont.add_char texture', 0);
  if (![rect.x, rect.y, rect.width, rect.height, align.x, align.y, advance].every(Number.isFinite)) {
    throw new TypeError('BitmapFont.add_char requires finite Rect2, alignment, and advance values.');
  }
  if (rect.width < 0 || rect.height < 0) throw new RangeError('BitmapFont.add_char Rect2 size cannot be negative.');
  font.glyphs.set(codepoint, { character: codepoint, texture: textureIndex, rect: { ...rect }, align: { ...align }, advance });
  changed(font);
}
export function addBitmapFontKerning(font: GodotBitmapFont, left: number, right: number, amount: number): void {
  const a = integer(left, 'BitmapFont.add_kerning_pair char_a', 0, 0x10ffff);
  const b = integer(right, 'BitmapFont.add_kerning_pair char_b', 0, 0x10ffff);
  font.kernings.set(bitmapKerningKey(a, b), integer(amount, 'BitmapFont.add_kerning_pair kerning'));
  changed(font);
}
export function getBitmapFontKerning(font: GodotBitmapFont, left: number, right: number): number {
  const a = integer(left, 'BitmapFont.get_kerning_pair char_a', 0, 0x10ffff);
  const b = integer(right, 'BitmapFont.get_kerning_pair char_b', 0, 0x10ffff);
  return font.kernings.get(bitmapKerningKey(a, b)) ?? 0;
}
export function clearBitmapFont(font: GodotBitmapFont): void {
  font.glyphs.clear(); font.kernings.clear(); font.textures.length = 0; changed(font);
}

export function setBitmapFontChars(font: GodotBitmapFont, values: readonly number[]): void {
  if (!Array.isArray(values) || values.length % 9 !== 0) {
    throw new TypeError('BitmapFont.chars requires PoolIntArray records of 9 integers.');
  }
  font.glyphs.clear();
  for (let index = 0; index < values.length; index += 9) {
    const record = values.slice(index, index + 9).map((value) => integer(value, 'BitmapFont.chars'));
    addBitmapFontGlyph(font, record[0]!, record[1]!, {
      x: record[2]!, y: record[3]!, width: record[4]!, height: record[5]!,
    }, { x: record[6]!, y: record[7]! }, record[8]!);
  }
  changed(font);
}
export function getBitmapFontChars(font: GodotBitmapFont): number[] {
  return [...font.glyphs.values()].flatMap((glyph) => [
    glyph.character, glyph.texture, glyph.rect.x, glyph.rect.y, glyph.rect.width, glyph.rect.height,
    glyph.align.x, glyph.align.y, glyph.advance,
  ]);
}
export function setBitmapFontKernings(font: GodotBitmapFont, values: readonly number[]): void {
  if (!Array.isArray(values) || values.length % 3 !== 0) {
    throw new TypeError('BitmapFont.kernings requires PoolIntArray records of 3 integers.');
  }
  font.kernings.clear();
  for (let index = 0; index < values.length; index += 3) {
    addBitmapFontKerning(font, values[index]!, values[index + 1]!, values[index + 2]!);
  }
  changed(font);
}
export function getBitmapFontKernings(font: GodotBitmapFont): number[] {
  return [...font.kernings].flatMap(([pair, amount]) => {
    const [left, right] = pair.split(':').map(Number);
    return [left!, right!, amount];
  });
}
export function setBitmapFontTextures(font: GodotBitmapFont, textures: readonly unknown[]): void {
  if (!Array.isArray(textures) || textures.some((texture) => texture === null || texture === undefined)) {
    throw new TypeError('BitmapFont.textures requires an Array of Texture resources.');
  }
  font.textures.splice(0, font.textures.length, ...textures);
  changed(font);
}
export const getBitmapFontTextures = (font: GodotBitmapFont): unknown[] => [...font.textures];

export function createGodotDynamicFontData(fontPath = ''): GodotDynamicFontData {
  const data: GodotDynamicFontData = {
    family: generatedFamily('GodotDynamicFont'),
    get source() { return data.fontPath === '' ? undefined : data.fontPath.replace(/^res:\/\//, '/'); },
    fontPath,
    antialiased: true,
    hinting: 2,
    overrideOversampling: 0,
  };
  registerGodotObjectIdentity(data, 'DynamicFontData');
  installDynamicFontDataApi(data);
  return bindGodotResourceProtocol(data, {
    createDuplicate(source) {
      const copy = createGodotDynamicFontData(source.fontPath);
      copy.antialiased = source.antialiased;
      copy.hinting = source.hinting;
      copy.overrideOversampling = source.overrideOversampling;
      return copy;
    },
  });
}

export function setDynamicFontDataPath(data: GodotDynamicFontData, path: string): void {
  if (typeof path !== 'string') throw new TypeError('DynamicFontData.font_path requires String.');
  if (data.fontPath === path) return;
  data.fontPath = path;
  changed(data);
}
export const getDynamicFontDataPath = (data: GodotDynamicFontData): string => data.fontPath;
export function setDynamicFontDataAntialiased(data: GodotDynamicFontData, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('DynamicFontData.antialiased requires bool.');
  if (data.antialiased !== enabled) { data.antialiased = enabled; changed(data); }
}
export const isDynamicFontDataAntialiased = (data: GodotDynamicFontData): boolean => data.antialiased;
export function setDynamicFontDataHinting(data: GodotDynamicFontData, hinting: number): void { const next = integer(hinting, 'DynamicFontData.hinting', 0, 2); if (data.hinting !== next) { data.hinting = next; changed(data); } }
export const getDynamicFontDataHinting = (data: GodotDynamicFontData): number => data.hinting;
export function setDynamicFontDataOverrideOversampling(data: GodotDynamicFontData, value: number): void { const next = nonNegative(value, 'DynamicFontData.override_oversampling'); if (data.overrideOversampling !== next) { data.overrideOversampling = next; changed(data); } }
export const getDynamicFontDataOverrideOversampling = (data: GodotDynamicFontData): number => data.overrideOversampling;

export function createGodotDynamicFont(): GodotDynamicFont {
  const font = installGodotFontApi({
    family: generatedFamily('GodotDynamicFontInstance'), fallbacks: [] as GodotFont[],
    fontData: null as GodotDynamicFontData | null, size: 16,
    outlineSize: 0, outlineColor: { r: 1, g: 1, b: 1, a: 1 }, useMipmaps: false,
    useFilter: true, spacingTop: 0, spacingBottom: 0, spacingChar: 0, spacingSpace: 0,
  });
  Object.defineProperty(font, 'family', {
    configurable: true,
    enumerable: true,
    get: () => font.fontData?.family ?? 'sans-serif',
  });
  registerGodotObjectIdentity(font, 'DynamicFont');
  installDynamicFontApi(font);
  return bindGodotResourceProtocol(font, {
    createDuplicate(source) {
      const copy = createGodotDynamicFont();
      const { family: _family, ...fields } = source;
      Object.assign(copy, { ...fields, fallbacks: [] });
      copy.outlineColor = { ...source.outlineColor };
      return copy;
    },
    populateDuplicate(source, target, deep, memo) {
      target.fontData = deep ? duplicateGodotSubresource(source.fontData, memo) : source.fontData;
      target.fallbacks = source.fallbacks.map((fallback) => deep ? duplicateGodotSubresource(fallback, memo) : fallback);
    },
  });
}

/** Seat one authored file-backed Theme font under the exact family registered by the host. */
export function createGodotAuthoredThemeFont(
  major: 3 | 4,
  family: string,
  sourcePath: string,
  size = 16,
  outlineSize = 0,
  outlineColor: { readonly r: number; readonly g: number; readonly b: number; readonly a: number } = { r: 1, g: 1, b: 1, a: 1 },
): GodotFont {
  if (typeof family !== 'string' || family.length === 0) {
    throw new TypeError('Authored Theme font family must be a non-empty string.');
  }
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    throw new TypeError('Authored Theme font source path must be a non-empty string.');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('Authored Theme font size must be a positive integer.');
  }
  if (!Number.isSafeInteger(outlineSize) || outlineSize < 0) {
    throw new RangeError('Authored DynamicFont outline size must be a non-negative integer.');
  }
  requireColor(outlineColor, 'DynamicFont.outline_color');
  if (major === 3) {
    const data = createGodotDynamicFontData(sourcePath);
    Object.assign(data, { family });
    const font = createGodotDynamicFont();
    font.fontData = data;
    font.size = size;
    font.outlineSize = outlineSize;
    font.outlineColor = { ...outlineColor };
    return font;
  }
  const font = createGodotFontFile();
  Object.assign(font, { family, sourcePath });
  return font;
}

/** A renderer-resolved family still needs Godot Font Resource identity for Control.get_font(). */
export function createGodotRenderedFont(major: 3 | 4, family: string, size = 16): GodotFont {
  if (typeof family !== 'string' || family.length === 0) {
    throw new TypeError('Rendered Control font family must be a non-empty string.');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('Rendered Control font size must be a positive integer.');
  }
  if (major === 3) {
    const data = createGodotDynamicFontData();
    Object.assign(data, { family });
    const font = createGodotDynamicFont();
    font.fontData = data;
    font.size = size;
    return font;
  }
  const font = createGodotFontFile();
  Object.assign(font, { family, fixedSize: size });
  return font;
}

export function setDynamicFontData(font: GodotDynamicFont, data: GodotDynamicFontData | null): void {
  if (data !== null) {
    if (
      typeof data !== 'object' || typeof data.family !== 'string' || typeof data.fontPath !== 'string' ||
      typeof data.antialiased !== 'boolean'
    ) {
      throw new TypeError('DynamicFont.font_data requires DynamicFontData.');
    }
    integer(data.hinting, 'DynamicFontData.hinting', 0, 2);
    nonNegative(data.overrideOversampling, 'DynamicFontData.override_oversampling');
  }
  if (font.fontData !== data) { font.fontData = data; changed(font); }
}
export const getDynamicFontData = (font: GodotDynamicFont): GodotDynamicFontData | null => font.fontData;
export function setDynamicFontSize(font: GodotDynamicFont, size: number): void { const next = integer(size, 'DynamicFont.size', 1); if (font.size !== next) { font.size = next; changed(font); } }
export const getDynamicFontSize = (font: GodotDynamicFont): number => font.size;
export function addDynamicFontFallback(font: GodotDynamicFont, fallback: GodotFont): void { font.fallbacks.push(requireFontResource(fallback, 'DynamicFont.add_fallback')); changed(font); }
export function setDynamicFontFallback(font: GodotDynamicFont, index: number, fallback: GodotFont): void { font.fallbacks[integer(index, 'DynamicFont.set_fallback', 0, font.fallbacks.length - 1)] = requireFontResource(fallback, 'DynamicFont.set_fallback'); changed(font); }
export function removeDynamicFontFallback(font: GodotDynamicFont, index: number): void { font.fallbacks.splice(integer(index, 'DynamicFont.remove_fallback', 0, font.fallbacks.length - 1), 1); changed(font); }
export const getDynamicFontFallback = (font: GodotDynamicFont, index: number): GodotFont => font.fallbacks[integer(index, 'DynamicFont.get_fallback', 0, font.fallbacks.length - 1)]!;
export const getDynamicFontFallbackCount = (font: GodotDynamicFont): number => font.fallbacks.length;

const DYNAMIC_FONT_SPACING_KEYS = ['spacingTop', 'spacingBottom', 'spacingChar', 'spacingSpace'] as const;
export function setDynamicFontSpacing(font: GodotDynamicFont, type: number, value: number): void {
  const key = DYNAMIC_FONT_SPACING_KEYS[integer(type, 'DynamicFont.set_spacing', 0, 3)]!;
  setGodotFontProperty(font, key, integer(value, 'DynamicFont.set_spacing', -0x80000000, 0x7fffffff));
}
export function getDynamicFontSpacing(font: GodotDynamicFont, type: number): number {
  return font[DYNAMIC_FONT_SPACING_KEYS[integer(type, 'DynamicFont.get_spacing', 0, 3)]!];
}

function createFontFileDefaults(): GodotFontFile {
  return installGodotFontApi({
    family: generatedFamily('GodotFontFile'), fallbacks: [] as GodotFont[], data: new Uint8Array(), sourcePath: '', fontName: '', styleName: '',
    fontStyle: 0, fontWeight: 400, fontStretch: 100, antialiasing: 1, disableEmbeddedBitmaps: true,
    generateMipmaps: false, allowSystemFallback: true, forceAutohinter: false, modulateColorGlyphs: false,
    hinting: 1, subpixelPositioning: 1, keepRoundingRemainders: true, multichannelSignedDistanceField: false,
    msdfPixelRange: 16, msdfSize: 48, fixedSize: 0, fixedSizeScaleMode: 1, oversampling: 0,
    opentypeFeatureOverrides: {} as Record<string, number>,
  });
}

export function createGodotFontFile(data?: Iterable<number>): GodotFontFile {
  const font = createFontFileDefaults();
  if (data !== undefined) font.data = requireByteArray(data, 'FontFile.data');
  Object.defineProperty(font, 'source', {
    enumerable: false,
    get: () => font.sourcePath === '' ? font.data.buffer.slice(0) : font.sourcePath.replace(/^res:\/\//, '/'),
  });
  registerGodotObjectIdentity(font, 'FontFile');
  installFontFileApi(font);
  installGodotFontFileCacheApi(font);
  return bindGodotResourceProtocol(font, {
    createDuplicate(source) {
      const copy = createGodotFontFile(source.data);
      Object.assign(copy, { ...source, data: source.data.slice(), fallbacks: [], opentypeFeatureOverrides: { ...source.opentypeFeatureOverrides } });
      return copy;
    },
    populateDuplicate(source, target, deep, memo) {
      target.fallbacks = source.fallbacks.map((fallback) => deep ? duplicateGodotSubresource(fallback, memo) : fallback);
    },
  });
}

export function setFontFileData(font: GodotFontFile, data: Iterable<number>): void {
  const next = requireByteArray(data, 'FontFile.data');
  if (font.data.length === next.length && font.data.every((value, index) => value === next[index])) return;
  font.data = next;
  font.sourcePath = '';
  changed(font);
}
export const getFontFileData = (font: GodotFontFile): Uint8Array => font.data.slice();
export function setFontFileName(font: GodotFontFile, name: string): void {
  if (typeof name !== 'string') throw new TypeError('FontFile.font_name requires String.');
  if (font.fontName !== name) { font.fontName = name; changed(font); }
}
export const getFontFileName = (font: GodotFontFile): string => font.fontName;
export function loadFontFileDynamic(font: GodotFontFile, path: string): number {
  if (typeof path !== 'string' || path.length === 0) throw new Error('FontFile.load_dynamic_font requires a path.');
  font.sourcePath = path;
  changed(font);
  return 0;
}
export function refuseBitmapFontLoad(): never {
  throw new Error('FontFile.load_bitmap_font is unavailable: browser FontFace cannot decode Godot BMFont resources.');
}

export const godotFontName = (font: GodotFont): string =>
  'fontName' in font && typeof (font as GodotFontFile).fontName === 'string' && (font as GodotFontFile).fontName !== ''
    ? (font as GodotFontFile).fontName
    : font.family;

export const godotFontStyleName = (font: GodotFont): string =>
  'styleName' in font ? (font as GodotFontFile).styleName : '';
export const godotFontStyle = (font: GodotFont): number =>
  'fontStyle' in font
    ? (font as GodotFontFile).fontStyle
    : ('fontItalic' in font && (font as GodotSystemFont).fontItalic ? 2 : 0);
export const godotFontWeight = (font: GodotFont): number =>
  'fontWeight' in font ? (font as GodotFontFile | GodotSystemFont).fontWeight : 400;
export const godotFontStretch = (font: GodotFont): number =>
  'fontStretch' in font ? (font as GodotFontFile | GodotSystemFont).fontStretch : 100;

export function createGodotFontVariation(baseFont: GodotFont | null = null): GodotFontVariation {
  if (baseFont !== null) requireFontResource(baseFont, 'FontVariation.base_font');
  const font = installGodotFontApi({
    family: generatedFamily('GodotFontVariation'), fallbacks: [] as GodotFont[], baseFont,
    variationOpentype: {} as Record<string, number>,
    variationFaceIndex: 0, variationEmbolden: 0, variationTransform: [1, 0, 0, 1, 0, 0],
    opentypeFeatures: {} as Record<string, number>,
    spacing: [0, 0, 0, 0] as [number, number, number, number], baselineOffset: 0, paletteIndex: 0,
    paletteCustomColors: [] as unknown[],
  });
  Object.defineProperty(font, 'family', {
    configurable: true,
    enumerable: true,
    get: () => font.baseFont?.family ?? 'sans-serif',
  });
  registerGodotObjectIdentity(font, 'FontVariation');
  installFontVariationApi(font);
  return bindGodotResourceProtocol<GodotFontVariation>(font, {
    createDuplicate(source) { const copy = createGodotFontVariation(); const { family: _family, ...fields } = source; Object.assign(copy, { ...fields, fallbacks: [], variationOpentype: { ...source.variationOpentype }, opentypeFeatures: { ...source.opentypeFeatures }, spacing: [...source.spacing], paletteCustomColors: [...source.paletteCustomColors] }); return copy; },
    populateDuplicate(source, target, deep, memo) { target.baseFont = deep ? duplicateGodotSubresource(source.baseFont, memo) : source.baseFont; target.fallbacks = source.fallbacks.map((fallback) => deep ? duplicateGodotSubresource(fallback, memo) : fallback); },
  });
}

export function setFontVariationSpacing(font: GodotFontVariation, type: number, value: number): void {
  const index = integer(type, 'FontVariation.set_spacing', 0, 3);
  const next = integer(value, 'FontVariation.set_spacing', -0x80000000, 0x7fffffff);
  if (font.spacing[index] === next) return;
  const spacing: [number, number, number, number] = [...font.spacing];
  spacing[index] = next;
  setGodotFontProperty(font, 'spacing', spacing);
}

export function createGodotSystemFont(names: readonly string[] = ['sans-serif']): GodotSystemFont {
  const font = installGodotFontApi({
    family: names[0] ?? 'sans-serif', fallbacks: [] as GodotFont[], fontNames: [...names], fontItalic: false,
    fontWeight: 400, fontStretch: 100, antialiasing: 1, disableEmbeddedBitmaps: true,
    generateMipmaps: false, allowSystemFallback: true, forceAutohinter: false,
    modulateColorGlyphs: false, hinting: 1, subpixelPositioning: 1, keepRoundingRemainders: true,
    multichannelSignedDistanceField: false, msdfPixelRange: 16, msdfSize: 48, oversampling: 0,
  });
  registerGodotObjectIdentity(font, 'SystemFont');
  installSystemFontApi(font);
  return bindGodotResourceProtocol(font, {
    createDuplicate(source) { const copy = createGodotSystemFont(source.fontNames); Object.assign(copy, { ...source, fontNames: [...source.fontNames], fallbacks: [] }); return copy; },
    populateDuplicate(source, target, deep, memo) { target.fallbacks = source.fallbacks.map((fallback) => deep ? duplicateGodotSubresource(fallback, memo) : fallback); },
  });
}

export function setSystemFontNames(font: GodotSystemFont, names: readonly string[]): void {
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) throw new Error('SystemFont.font_names requires PackedStringArray.');
  if (font.fontNames.length === names.length && font.fontNames.every((name, index) => name === names[index])) return;
  font.fontNames = [...names];
  Object.defineProperty(font, 'family', { configurable: true, enumerable: true, value: names[0] ?? 'sans-serif', writable: true });
  changed(font);
}
export const getSystemFontNames = (font: GodotSystemFont): readonly string[] => [...font.fontNames];
