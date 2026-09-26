/** Retained FontFile cache protocol used by Godot 4's low-level glyph and texture APIs. */

import type { GodotFontFile } from './font';
import type { GodotRid } from './gdscript-builtins';
import { godotResourceGetRid } from './resource-io';

export interface GodotFontVector2 {
  x: number;
  y: number;
}

export interface GodotFontRect2 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GodotFontTransform2D {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
  ox: number;
  oy: number;
}

export interface GodotFontGlyphCache {
  advance: GodotFontVector2;
  offset: GodotFontVector2;
  size: GodotFontVector2;
  uvRect: GodotFontRect2;
  textureIndex: number;
}

export interface GodotFontSizeCache {
  ascent: number;
  descent: number;
  underlinePosition: number;
  underlineThickness: number;
  scale: number;
  textures: unknown[];
  textureOffsets: GodotFontVector2[][];
  glyphs: Map<number, GodotFontGlyphCache>;
  kerning: Map<string, GodotFontVector2>;
}

export interface GodotFontCache {
  readonly ridResource: object;
  variationCoordinates: Record<string, number>;
  embolden: number;
  transform: GodotFontTransform2D;
  extraSpacing: [number, number, number, number];
  baselineOffset: number;
  faceIndex: number;
  sizes: Map<string, GodotFontSizeCache>;
}

interface GodotFontFileCacheState {
  caches: GodotFontCache[];
  languageOverrides: Map<string, boolean>;
  scriptOverrides: Map<string, boolean>;
  opentypeOverrides: Record<string, number>;
}

const FONT_FILE_CACHES = new WeakMap<GodotFontFile, GodotFontFileCacheState>();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function point(value: unknown, member: string): GodotFontVector2 {
  if (!isRecord(value)) throw new TypeError(`${member} requires Vector2.`);
  const x = value['x'];
  const y = value['y'];
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new TypeError(`${member} requires finite Vector2 components.`);
  }
  return { x, y };
}

function rect(value: unknown, member: string): GodotFontRect2 {
  if (!isRecord(value)) throw new TypeError(`${member} requires Rect2.`);
  const authoredPosition = value['position'];
  const authoredSize = value['size'];
  const position = isRecord(authoredPosition) ? authoredPosition : undefined;
  const size = isRecord(authoredSize) ? authoredSize : undefined;
  const x = Number(value['x'] ?? position?.['x']);
  const y = Number(value['y'] ?? position?.['y']);
  const width = Number(value['width'] ?? size?.['x']);
  const height = Number(value['height'] ?? size?.['y']);
  if (![x, y, width, height].every(Number.isFinite)) throw new TypeError(`${member} requires finite Rect2 components.`);
  return { x, y, width, height };
}

function transform(value: unknown, member: string): GodotFontTransform2D {
  if (Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return { xx: value[0], xy: value[1], yx: value[2], yy: value[3], ox: value[4], oy: value[5] };
  }
  if (!isRecord(value)) throw new TypeError(`${member} requires Transform2D.`);
  const result = {
    xx: Number(value['xx'] ?? 1), xy: Number(value['xy'] ?? 0), yx: Number(value['yx'] ?? 0),
    yy: Number(value['yy'] ?? 1), ox: Number(value['ox'] ?? 0), oy: Number(value['oy'] ?? 0),
  };
  if (!Object.values(result).every(Number.isFinite)) throw new TypeError(`${member} requires finite Transform2D components.`);
  return result;
}

function integer(value: number, member: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${member} requires an integer >= ${minimum}.`);
  return value;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

function sizeKey(size: unknown): string {
  const value = point(size, 'FontFile cache size');
  return `${value.x}:${value.y}`;
}

function pairKey(pair: unknown): string {
  const value = point(pair, 'FontFile kerning pair');
  return `${integer(value.x, 'FontFile kerning left glyph', 0)}:${integer(value.y, 'FontFile kerning right glyph', 0)}`;
}

function state(font: GodotFontFile): GodotFontFileCacheState {
  let value = FONT_FILE_CACHES.get(font);
  if (value === undefined) {
    value = { caches: [], languageOverrides: new Map(), scriptOverrides: new Map(), opentypeOverrides: {} };
    FONT_FILE_CACHES.set(font, value);
  }
  return value;
}

function cache(font: GodotFontFile, index: number, create = true): GodotFontCache {
  integer(index, 'FontFile cache index', 0);
  const value = state(font);
  while (create && value.caches.length <= index) {
    value.caches.push({
      ridResource: {},
      variationCoordinates: {}, embolden: 0,
      transform: { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 },
      extraSpacing: [0, 0, 0, 0], baselineOffset: 0, faceIndex: 0, sizes: new Map(),
    });
  }
  const result = value.caches[index];
  if (result === undefined) throw new RangeError(`FontFile cache index ${index} does not exist.`);
  return result;
}

function sizeCache(font: GodotFontFile, cacheIndex: number, size: unknown, create = true): GodotFontSizeCache {
  const owner = cache(font, cacheIndex, create);
  const key = sizeKey(size);
  let value = owner.sizes.get(key);
  if (value === undefined && create) {
    value = {
      ascent: 0, descent: 0, underlinePosition: 0, underlineThickness: 0, scale: 1,
      textures: [], textureOffsets: [], glyphs: new Map(), kerning: new Map(),
    };
    owner.sizes.set(key, value);
  }
  if (value === undefined) throw new Error(`FontFile cache size ${key} does not exist.`);
  return value;
}

function glyph(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): GodotFontGlyphCache {
  integer(glyphIndex, 'FontFile glyph index', 0);
  const owner = sizeCache(font, cacheIndex, size);
  let value = owner.glyphs.get(glyphIndex);
  if (value === undefined) {
    value = {
      advance: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, size: { x: 0, y: 0 },
      uvRect: { x: 0, y: 0, width: 0, height: 0 }, textureIndex: 0,
    };
    owner.glyphs.set(glyphIndex, value);
  }
  return value;
}

export function godotFontFileResetCaches(font: GodotFontFile): void {
  FONT_FILE_CACHES.delete(font);
}

export function godotFontFileGetCacheCount(font: GodotFontFile): number {
  return state(font).caches.length;
}

export function godotFontFileGetCacheRid(font: GodotFontFile, cacheIndex: number): GodotRid {
  return godotResourceGetRid(cache(font, cacheIndex, false).ridResource);
}

export function godotFontFileClearCache(font: GodotFontFile): void {
  state(font).caches.length = 0;
}

export function godotFontFileRemoveCache(font: GodotFontFile, cacheIndex: number): void {
  const caches = state(font).caches;
  integer(cacheIndex, 'FontFile cache index', 0);
  if (cacheIndex >= caches.length) throw new RangeError(`FontFile cache index ${cacheIndex} does not exist.`);
  caches.splice(cacheIndex, 1);
}

export function godotFontFileGetSizeCacheList(font: GodotFontFile, cacheIndex: number): GodotFontVector2[] {
  return [...cache(font, cacheIndex, false).sizes.keys()].map((key) => {
    const [x, y] = key.split(':').map(Number);
    return { x: x!, y: y! };
  });
}

export function godotFontFileClearSizeCache(font: GodotFontFile, cacheIndex: number): void {
  cache(font, cacheIndex).sizes.clear();
}

export function godotFontFileRemoveSizeCache(font: GodotFontFile, cacheIndex: number, size: unknown): void {
  cache(font, cacheIndex, false).sizes.delete(sizeKey(size));
}

export function godotFontFileSetVariationCoordinates(font: GodotFontFile, cacheIndex: number, coordinates: unknown): void {
  if (typeof coordinates !== 'object' || coordinates === null || Array.isArray(coordinates)) throw new TypeError('FontFile variation coordinates require Dictionary.');
  const next: Record<string, number> = {};
  for (const [axis, value] of Object.entries(coordinates)) next[axis] = finite(Number(value), `FontFile variation axis ${axis}`);
  cache(font, cacheIndex).variationCoordinates = next;
}

export function godotFontFileGetVariationCoordinates(font: GodotFontFile, cacheIndex: number): Record<string, number> {
  return { ...cache(font, cacheIndex).variationCoordinates };
}

export function godotFontFileSetEmbolden(font: GodotFontFile, cacheIndex: number, strength: number): void {
  cache(font, cacheIndex).embolden = finite(strength, 'FontFile embolden');
}

export function godotFontFileGetEmbolden(font: GodotFontFile, cacheIndex: number): number {
  return cache(font, cacheIndex).embolden;
}

export function godotFontFileSetTransform(font: GodotFontFile, cacheIndex: number, value: unknown): void {
  cache(font, cacheIndex).transform = transform(value, 'FontFile transform');
}

export function godotFontFileGetTransform(font: GodotFontFile, cacheIndex: number): GodotFontTransform2D {
  return { ...cache(font, cacheIndex).transform };
}

export function godotFontFileSetExtraSpacing(font: GodotFontFile, cacheIndex: number, spacing: number, value: number): void {
  integer(spacing, 'FontFile spacing kind', 0);
  if (spacing > 3) throw new RangeError('FontFile spacing kind requires 0..3.');
  cache(font, cacheIndex).extraSpacing[spacing] = finite(value, 'FontFile extra spacing');
}

export function godotFontFileGetExtraSpacing(font: GodotFontFile, cacheIndex: number, spacing: number): number {
  integer(spacing, 'FontFile spacing kind', 0);
  return cache(font, cacheIndex).extraSpacing[spacing] ?? 0;
}

export function godotFontFileSetBaselineOffset(font: GodotFontFile, cacheIndex: number, value: number): void {
  cache(font, cacheIndex).baselineOffset = finite(value, 'FontFile baseline offset');
}

export function godotFontFileGetBaselineOffset(font: GodotFontFile, cacheIndex: number): number {
  return cache(font, cacheIndex).baselineOffset;
}

export function godotFontFileSetFaceIndex(font: GodotFontFile, cacheIndex: number, value: number): void {
  cache(font, cacheIndex).faceIndex = integer(value, 'FontFile face index', 0);
}

export function godotFontFileGetFaceIndex(font: GodotFontFile, cacheIndex: number): number {
  return cache(font, cacheIndex).faceIndex;
}

export function godotFontFileSetCacheAscent(font: GodotFontFile, cacheIndex: number, size: unknown, value: number): void {
  sizeCache(font, cacheIndex, size).ascent = finite(value, 'FontFile cache ascent');
}

export function godotFontFileGetCacheAscent(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).ascent;
}

export function godotFontFileSetCacheDescent(font: GodotFontFile, cacheIndex: number, size: unknown, value: number): void {
  sizeCache(font, cacheIndex, size).descent = finite(value, 'FontFile cache descent');
}

export function godotFontFileGetCacheDescent(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).descent;
}

export function godotFontFileSetCacheUnderlinePosition(font: GodotFontFile, cacheIndex: number, size: unknown, value: number): void {
  sizeCache(font, cacheIndex, size).underlinePosition = finite(value, 'FontFile underline position');
}

export function godotFontFileGetCacheUnderlinePosition(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).underlinePosition;
}

export function godotFontFileSetCacheUnderlineThickness(font: GodotFontFile, cacheIndex: number, size: unknown, value: number): void {
  sizeCache(font, cacheIndex, size).underlineThickness = finite(value, 'FontFile underline thickness');
}

export function godotFontFileGetCacheUnderlineThickness(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).underlineThickness;
}

export function godotFontFileSetCacheScale(font: GodotFontFile, cacheIndex: number, size: unknown, value: number): void {
  sizeCache(font, cacheIndex, size).scale = finite(value, 'FontFile cache scale');
}

export function godotFontFileGetCacheScale(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).scale;
}

export function godotFontFileGetTextureCount(font: GodotFontFile, cacheIndex: number, size: unknown): number {
  return sizeCache(font, cacheIndex, size).textures.length;
}

export function godotFontFileClearTextures(font: GodotFontFile, cacheIndex: number, size: unknown): void {
  const owner = sizeCache(font, cacheIndex, size);
  owner.textures.length = 0;
  owner.textureOffsets.length = 0;
}

export function godotFontFileRemoveTexture(font: GodotFontFile, cacheIndex: number, size: unknown, textureIndex: number): void {
  const owner = sizeCache(font, cacheIndex, size);
  integer(textureIndex, 'FontFile texture index', 0);
  owner.textures.splice(textureIndex, 1);
  owner.textureOffsets.splice(textureIndex, 1);
}

export function godotFontFileSetTextureImage(font: GodotFontFile, cacheIndex: number, size: unknown, textureIndex: number, image: unknown): void {
  const owner = sizeCache(font, cacheIndex, size);
  integer(textureIndex, 'FontFile texture index', 0);
  while (owner.textures.length <= textureIndex) owner.textures.push(null);
  owner.textures[textureIndex] = image;
}

export function godotFontFileGetTextureImage(font: GodotFontFile, cacheIndex: number, size: unknown, textureIndex: number): unknown {
  return sizeCache(font, cacheIndex, size).textures[integer(textureIndex, 'FontFile texture index', 0)] ?? null;
}

export function godotFontFileSetTextureOffsets(font: GodotFontFile, cacheIndex: number, size: unknown, textureIndex: number, offsets: readonly unknown[]): void {
  const owner = sizeCache(font, cacheIndex, size);
  integer(textureIndex, 'FontFile texture index', 0);
  while (owner.textureOffsets.length <= textureIndex) owner.textureOffsets.push([]);
  owner.textureOffsets[textureIndex] = offsets.map((value) => point(value, 'FontFile texture offset'));
}

export function godotFontFileGetTextureOffsets(font: GodotFontFile, cacheIndex: number, size: unknown, textureIndex: number): GodotFontVector2[] {
  return (sizeCache(font, cacheIndex, size).textureOffsets[integer(textureIndex, 'FontFile texture index', 0)] ?? []).map((value) => ({ ...value }));
}

export function godotFontFileGetGlyphList(font: GodotFontFile, cacheIndex: number, size: unknown): number[] {
  return [...sizeCache(font, cacheIndex, size).glyphs.keys()];
}

export function godotFontFileClearGlyphs(font: GodotFontFile, cacheIndex: number, size: unknown): void {
  sizeCache(font, cacheIndex, size).glyphs.clear();
}

export function godotFontFileRemoveGlyph(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): void {
  sizeCache(font, cacheIndex, size).glyphs.delete(integer(glyphIndex, 'FontFile glyph index', 0));
}

export function godotFontFileSetGlyphAdvance(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void {
  glyph(font, cacheIndex, size, glyphIndex).advance = point(value, 'FontFile glyph advance');
}

export function godotFontFileGetGlyphAdvance(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 {
  return { ...glyph(font, cacheIndex, size, glyphIndex).advance };
}

export function godotFontFileSetGlyphOffset(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void {
  glyph(font, cacheIndex, size, glyphIndex).offset = point(value, 'FontFile glyph offset');
}

export function godotFontFileGetGlyphOffset(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 {
  return { ...glyph(font, cacheIndex, size, glyphIndex).offset };
}

export function godotFontFileSetGlyphSize(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void {
  glyph(font, cacheIndex, size, glyphIndex).size = point(value, 'FontFile glyph size');
}

export function godotFontFileGetGlyphSize(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 {
  return { ...glyph(font, cacheIndex, size, glyphIndex).size };
}

export function godotFontFileSetGlyphUvRect(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void {
  glyph(font, cacheIndex, size, glyphIndex).uvRect = rect(value, 'FontFile glyph UV rect');
}

export function godotFontFileGetGlyphUvRect(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): GodotFontRect2 {
  return { ...glyph(font, cacheIndex, size, glyphIndex).uvRect };
}

export function godotFontFileSetGlyphTextureIndex(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number, textureIndex: number): void {
  glyph(font, cacheIndex, size, glyphIndex).textureIndex = integer(textureIndex, 'FontFile glyph texture index', 0);
}

export function godotFontFileGetGlyphTextureIndex(font: GodotFontFile, cacheIndex: number, size: unknown, glyphIndex: number): number {
  return glyph(font, cacheIndex, size, glyphIndex).textureIndex;
}

export function godotFontFileGetKerningList(font: GodotFontFile, cacheIndex: number, size: unknown): GodotFontVector2[] {
  return [...sizeCache(font, cacheIndex, size).kerning.keys()].map((key) => {
    const [x, y] = key.split(':').map(Number);
    return { x: x!, y: y! };
  });
}

export function godotFontFileClearKerningMap(font: GodotFontFile, cacheIndex: number, size: unknown): void {
  sizeCache(font, cacheIndex, size).kerning.clear();
}

export function godotFontFileRemoveKerning(font: GodotFontFile, cacheIndex: number, size: unknown, pair: unknown): void {
  sizeCache(font, cacheIndex, size).kerning.delete(pairKey(pair));
}

export function godotFontFileSetKerning(font: GodotFontFile, cacheIndex: number, size: unknown, pair: unknown, value: unknown): void {
  sizeCache(font, cacheIndex, size).kerning.set(pairKey(pair), point(value, 'FontFile kerning value'));
}

export function godotFontFileGetKerning(font: GodotFontFile, cacheIndex: number, size: unknown, pair: unknown): GodotFontVector2 {
  return { ...(sizeCache(font, cacheIndex, size).kerning.get(pairKey(pair)) ?? { x: 0, y: 0 }) };
}

export function godotFontFileSetLanguageSupportOverride(font: GodotFontFile, language: string, supported: boolean): void {
  state(font).languageOverrides.set(String(language), Boolean(supported));
}

export function godotFontFileGetLanguageSupportOverride(font: GodotFontFile, language: string): boolean {
  return state(font).languageOverrides.get(String(language)) ?? false;
}

export function godotFontFileRemoveLanguageSupportOverride(font: GodotFontFile, language: string): void {
  state(font).languageOverrides.delete(String(language));
}

export function godotFontFileGetLanguageSupportOverrides(font: GodotFontFile): string[] {
  return [...state(font).languageOverrides.keys()];
}

export function godotFontFileSetScriptSupportOverride(font: GodotFontFile, script: string, supported: boolean): void {
  state(font).scriptOverrides.set(String(script), Boolean(supported));
}

export function godotFontFileGetScriptSupportOverride(font: GodotFontFile, script: string): boolean {
  return state(font).scriptOverrides.get(String(script)) ?? false;
}

export function godotFontFileRemoveScriptSupportOverride(font: GodotFontFile, script: string): void {
  state(font).scriptOverrides.delete(String(script));
}

export function godotFontFileGetScriptSupportOverrides(font: GodotFontFile): string[] {
  return [...state(font).scriptOverrides.keys()];
}

export function godotFontFileSetOpentypeFeatureOverrides(font: GodotFontFile, overrides: unknown): void {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) throw new TypeError('FontFile OpenType overrides require Dictionary.');
  const next: Record<string, number> = {};
  for (const [tag, value] of Object.entries(overrides)) next[tag] = integer(Number(value), `FontFile OpenType feature ${tag}`);
  state(font).opentypeOverrides = next;
  font.opentypeFeatureOverrides = { ...next };
}

export function godotFontFileGetOpentypeFeatureOverrides(font: GodotFontFile): Record<string, number> {
  const overrides = state(font).opentypeOverrides;
  return { ...(Object.keys(overrides).length > 0 ? overrides : font.opentypeFeatureOverrides) };
}

export function godotFontFileGetGlyphIndex(font: GodotFontFile, _size: number, character: number, variationSelector = 0): number {
  integer(character, 'FontFile character', 0);
  integer(variationSelector, 'FontFile variation selector', 0);
  return variationSelector === 0 ? character : ((character * 0x110000 + variationSelector) >>> 0);
}

export function godotFontFileGetCharFromGlyphIndex(_font: GodotFontFile, _size: number, glyphIndex: number): number {
  integer(glyphIndex, 'FontFile glyph index', 0);
  return glyphIndex <= 0x10ffff ? glyphIndex : 0;
}

/** Install FontFile's low-level native cache API directly on the retained Resource identity. */
export function installGodotFontFileCacheApi(font: GodotFontFile): void {
  Object.defineProperties(font, {
    reset_state: { configurable: true, value: (): void => godotFontFileResetCaches(font) },
    get_cache_count: { configurable: true, value: (): number => godotFontFileGetCacheCount(font) },
    get_cache_rid: { configurable: true, value: (cacheIndex: number): GodotRid => godotFontFileGetCacheRid(font, cacheIndex) },
    clear_cache: { configurable: true, value: (): void => godotFontFileClearCache(font) },
    remove_cache: { configurable: true, value: (cacheIndex: number): void => godotFontFileRemoveCache(font, cacheIndex) },
    get_size_cache_list: { configurable: true, value: (cacheIndex: number): GodotFontVector2[] => godotFontFileGetSizeCacheList(font, cacheIndex) },
    clear_size_cache: { configurable: true, value: (cacheIndex: number): void => godotFontFileClearSizeCache(font, cacheIndex) },
    remove_size_cache: { configurable: true, value: (cacheIndex: number, size: unknown): void => godotFontFileRemoveSizeCache(font, cacheIndex, size) },
    set_variation_coordinates: {
      configurable: true,
      value: (cacheIndex: number, coordinates: unknown): void => godotFontFileSetVariationCoordinates(font, cacheIndex, coordinates),
    },
    get_variation_coordinates: {
      configurable: true,
      value: (cacheIndex: number): Record<string, number> => godotFontFileGetVariationCoordinates(font, cacheIndex),
    },
    set_embolden: { configurable: true, value: (cacheIndex: number, value: number): void => godotFontFileSetEmbolden(font, cacheIndex, value) },
    get_embolden: { configurable: true, value: (cacheIndex: number): number => godotFontFileGetEmbolden(font, cacheIndex) },
    set_transform: { configurable: true, value: (cacheIndex: number, value: unknown): void => godotFontFileSetTransform(font, cacheIndex, value) },
    get_transform: { configurable: true, value: (cacheIndex: number): GodotFontTransform2D => godotFontFileGetTransform(font, cacheIndex) },
    set_extra_spacing: {
      configurable: true,
      value: (cacheIndex: number, spacing: number, value: number): void => godotFontFileSetExtraSpacing(font, cacheIndex, spacing, value),
    },
    get_extra_spacing: {
      configurable: true,
      value: (cacheIndex: number, spacing: number): number => godotFontFileGetExtraSpacing(font, cacheIndex, spacing),
    },
    set_baseline_offset: { configurable: true, value: (cacheIndex: number, value: number): void => godotFontFileSetBaselineOffset(font, cacheIndex, value) },
    get_baseline_offset: { configurable: true, value: (cacheIndex: number): number => godotFontFileGetBaselineOffset(font, cacheIndex) },
    set_face_index: { configurable: true, value: (cacheIndex: number, value: number): void => godotFontFileSetFaceIndex(font, cacheIndex, value) },
    get_face_index: { configurable: true, value: (cacheIndex: number): number => godotFontFileGetFaceIndex(font, cacheIndex) },
    set_cache_ascent: { configurable: true, value: (cacheIndex: number, size: unknown, value: number): void => godotFontFileSetCacheAscent(font, cacheIndex, size, value) },
    get_cache_ascent: { configurable: true, value: (cacheIndex: number, size: unknown): number => godotFontFileGetCacheAscent(font, cacheIndex, size) },
    set_cache_descent: { configurable: true, value: (cacheIndex: number, size: unknown, value: number): void => godotFontFileSetCacheDescent(font, cacheIndex, size, value) },
    get_cache_descent: { configurable: true, value: (cacheIndex: number, size: unknown): number => godotFontFileGetCacheDescent(font, cacheIndex, size) },
    set_cache_underline_position: {
      configurable: true,
      value: (cacheIndex: number, size: unknown, value: number): void => godotFontFileSetCacheUnderlinePosition(font, cacheIndex, size, value),
    },
    get_cache_underline_position: {
      configurable: true,
      value: (cacheIndex: number, size: unknown): number => godotFontFileGetCacheUnderlinePosition(font, cacheIndex, size),
    },
    set_cache_underline_thickness: {
      configurable: true,
      value: (cacheIndex: number, size: unknown, value: number): void => godotFontFileSetCacheUnderlineThickness(font, cacheIndex, size, value),
    },
    get_cache_underline_thickness: {
      configurable: true,
      value: (cacheIndex: number, size: unknown): number => godotFontFileGetCacheUnderlineThickness(font, cacheIndex, size),
    },
    set_cache_scale: { configurable: true, value: (cacheIndex: number, size: unknown, value: number): void => godotFontFileSetCacheScale(font, cacheIndex, size, value) },
    get_cache_scale: { configurable: true, value: (cacheIndex: number, size: unknown): number => godotFontFileGetCacheScale(font, cacheIndex, size) },
    get_texture_count: { configurable: true, value: (cacheIndex: number, size: unknown): number => godotFontFileGetTextureCount(font, cacheIndex, size) },
    clear_textures: { configurable: true, value: (cacheIndex: number, size: unknown): void => godotFontFileClearTextures(font, cacheIndex, size) },
    remove_texture: { configurable: true, value: (cacheIndex: number, size: unknown, textureIndex: number): void => godotFontFileRemoveTexture(font, cacheIndex, size, textureIndex) },
    set_texture_image: { configurable: true, value: (cacheIndex: number, size: unknown, textureIndex: number, image: unknown): void => godotFontFileSetTextureImage(font, cacheIndex, size, textureIndex, image) },
    get_texture_image: { configurable: true, value: (cacheIndex: number, size: unknown, textureIndex: number): unknown => godotFontFileGetTextureImage(font, cacheIndex, size, textureIndex) },
    set_texture_offsets: { configurable: true, value: (cacheIndex: number, size: unknown, textureIndex: number, offsets: readonly unknown[]): void => godotFontFileSetTextureOffsets(font, cacheIndex, size, textureIndex, offsets) },
    get_texture_offsets: { configurable: true, value: (cacheIndex: number, size: unknown, textureIndex: number): GodotFontVector2[] => godotFontFileGetTextureOffsets(font, cacheIndex, size, textureIndex) },
    get_glyph_list: { configurable: true, value: (cacheIndex: number, size: unknown): number[] => godotFontFileGetGlyphList(font, cacheIndex, size) },
    clear_glyphs: { configurable: true, value: (cacheIndex: number, size: unknown): void => godotFontFileClearGlyphs(font, cacheIndex, size) },
    remove_glyph: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): void => godotFontFileRemoveGlyph(font, cacheIndex, size, glyphIndex) },
    set_glyph_advance: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void => godotFontFileSetGlyphAdvance(font, cacheIndex, size, glyphIndex, value) },
    get_glyph_advance: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 => godotFontFileGetGlyphAdvance(font, cacheIndex, size, glyphIndex) },
    set_glyph_offset: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void => godotFontFileSetGlyphOffset(font, cacheIndex, size, glyphIndex, value) },
    get_glyph_offset: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 => godotFontFileGetGlyphOffset(font, cacheIndex, size, glyphIndex) },
    set_glyph_size: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void => godotFontFileSetGlyphSize(font, cacheIndex, size, glyphIndex, value) },
    get_glyph_size: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): GodotFontVector2 => godotFontFileGetGlyphSize(font, cacheIndex, size, glyphIndex) },
    set_glyph_uv_rect: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number, value: unknown): void => godotFontFileSetGlyphUvRect(font, cacheIndex, size, glyphIndex, value) },
    get_glyph_uv_rect: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): GodotFontRect2 => godotFontFileGetGlyphUvRect(font, cacheIndex, size, glyphIndex) },
    set_glyph_texture_idx: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number, textureIndex: number): void => godotFontFileSetGlyphTextureIndex(font, cacheIndex, size, glyphIndex, textureIndex) },
    get_glyph_texture_idx: { configurable: true, value: (cacheIndex: number, size: unknown, glyphIndex: number): number => godotFontFileGetGlyphTextureIndex(font, cacheIndex, size, glyphIndex) },
    get_kerning_list: { configurable: true, value: (cacheIndex: number, size: unknown): GodotFontVector2[] => godotFontFileGetKerningList(font, cacheIndex, size) },
    clear_kerning_map: { configurable: true, value: (cacheIndex: number, size: unknown): void => godotFontFileClearKerningMap(font, cacheIndex, size) },
    remove_kerning: { configurable: true, value: (cacheIndex: number, size: unknown, pair: unknown): void => godotFontFileRemoveKerning(font, cacheIndex, size, pair) },
    set_kerning: { configurable: true, value: (cacheIndex: number, size: unknown, pair: unknown, value: unknown): void => godotFontFileSetKerning(font, cacheIndex, size, pair, value) },
    get_kerning: { configurable: true, value: (cacheIndex: number, size: unknown, pair: unknown): GodotFontVector2 => godotFontFileGetKerning(font, cacheIndex, size, pair) },
    set_language_support_override: { configurable: true, value: (language: string, supported: boolean): void => godotFontFileSetLanguageSupportOverride(font, language, supported) },
    get_language_support_override: { configurable: true, value: (language: string): boolean => godotFontFileGetLanguageSupportOverride(font, language) },
    remove_language_support_override: { configurable: true, value: (language: string): void => godotFontFileRemoveLanguageSupportOverride(font, language) },
    get_language_support_overrides: { configurable: true, value: (): string[] => godotFontFileGetLanguageSupportOverrides(font) },
    set_script_support_override: { configurable: true, value: (script: string, supported: boolean): void => godotFontFileSetScriptSupportOverride(font, script, supported) },
    get_script_support_override: { configurable: true, value: (script: string): boolean => godotFontFileGetScriptSupportOverride(font, script) },
    remove_script_support_override: { configurable: true, value: (script: string): void => godotFontFileRemoveScriptSupportOverride(font, script) },
    get_script_support_overrides: { configurable: true, value: (): string[] => godotFontFileGetScriptSupportOverrides(font) },
    set_opentype_feature_overrides: { configurable: true, value: (value: unknown): void => godotFontFileSetOpentypeFeatureOverrides(font, value) },
    get_opentype_feature_overrides: { configurable: true, value: (): Record<string, number> => godotFontFileGetOpentypeFeatureOverrides(font) },
    get_glyph_index: { configurable: true, value: (size: number, character: number, variationSelector = 0): number => godotFontFileGetGlyphIndex(font, size, character, variationSelector) },
    get_char_from_glyph_index: { configurable: true, value: (size: number, glyphIndex: number): number => godotFontFileGetCharFromGlyphIndex(font, size, glyphIndex) },
  });
}
