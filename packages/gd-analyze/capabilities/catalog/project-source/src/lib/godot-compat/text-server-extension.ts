/** Godot TextServerExtension protocol over a project-owned text shaping backend. */

import { registerGodotObjectIdentity } from './object';
import {
  packedByteArray,
  packedColorArray,
  packedFloat32Array,
  packedInt32Array,
  packedStringArray,
  packedVector2Array,
  type PackedByteArray,
  type PackedColorArray,
  type PackedFloat32Array,
  type PackedInt32Array,
  type PackedStringArray,
  type PackedVector2Array,
} from './packed-array';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export type GodotTextServerRID = unknown;
export type GodotTextServerDictionary = Readonly<Record<string, unknown>> | ReadonlyMap<unknown, unknown>;

export interface GodotTextServerExtensionCarrier {
  invoke(method: string, args: readonly unknown[]): unknown;
}

function integer(value: unknown, member: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError(`TextServerExtension.${member} must return int.`);
  return number;
}
function numeric(value: unknown, member: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`TextServerExtension.${member} must return finite float.`);
  return number;
}
function vector(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) {
    throw new TypeError(`TextServerExtension.${member} must return Vector2.`);
  }
  return { x: Number(value.x), y: Number(value.y) };
}

export class GodotTextServerExtension {
  constructor(private readonly carrier: GodotTextServerExtensionCarrier) {
    registerGodotObjectIdentity(this, 'TextServerExtension');
  }

  private call(method: string, ...args: readonly unknown[]): unknown { return this.carrier.invoke(method, args); }
  private int(method: string, ...args: readonly unknown[]): number { return integer(this.call(method, ...args), method); }
  private float(method: string, ...args: readonly unknown[]): number { return numeric(this.call(method, ...args), method); }
  private bool(method: string, ...args: readonly unknown[]): boolean { return Boolean(this.call(method, ...args)); }
  private string(method: string, ...args: readonly unknown[]): string { return String(this.call(method, ...args) ?? ''); }

  _has_feature(feature: number): boolean { return this.bool('_has_feature', feature); }
  _get_name(): string { return this.string('_get_name'); }
  _get_features(): number { return this.int('_get_features'); }
  _free_rid(rid: GodotTextServerRID): void { this.call('_free_rid', rid); }
  _has(rid: GodotTextServerRID): boolean { return this.bool('_has', rid); }
  _load_support_data(filename: string): boolean { return this.bool('_load_support_data', filename); }
  _get_support_data_filename(): string { return this.string('_get_support_data_filename'); }
  _get_support_data_info(): string { return this.string('_get_support_data_info'); }
  _save_support_data(filename: string): boolean { return this.bool('_save_support_data', filename); }
  _get_support_data(): PackedByteArray { return packedByteArray(this.call('_get_support_data') as Iterable<unknown>); }
  _is_locale_using_support_data(locale: string): boolean { return this.bool('_is_locale_using_support_data', locale); }
  _is_locale_right_to_left(locale: string): boolean { return this.bool('_is_locale_right_to_left', locale); }
  _name_to_tag(name: string): number { return this.int('_name_to_tag', name); }
  _tag_to_name(tag: number): string { return this.string('_tag_to_name', tag); }

  _create_font(): GodotTextServerRID { return this.call('_create_font'); }
  _create_font_linked_variation(fontRid: GodotTextServerRID): GodotTextServerRID { return this.call('_create_font_linked_variation', fontRid); }
  _font_set_data(fontRid: GodotTextServerRID, data: Iterable<number>): void { this.call('_font_set_data', fontRid, packedByteArray(data)); }
  _font_set_data_ptr(fontRid: GodotTextServerRID, data: Iterable<number>, dataSize: number): void {
    const bytes = packedByteArray(data);
    this.call('_font_set_data_ptr', fontRid, bytes.slice(0, Math.max(0, Math.trunc(dataSize))), dataSize);
  }
  _font_set_face_index(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_face_index', fontRid, value); }
  _font_get_face_index(fontRid: GodotTextServerRID): number { return this.int('_font_get_face_index', fontRid); }
  _font_get_face_count(fontRid: GodotTextServerRID): number { return this.int('_font_get_face_count', fontRid); }
  _font_set_style(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_style', fontRid, value); }
  _font_get_style(fontRid: GodotTextServerRID): number { return this.int('_font_get_style', fontRid); }
  _font_set_name(fontRid: GodotTextServerRID, value: string): void { this.call('_font_set_name', fontRid, value); }
  _font_get_name(fontRid: GodotTextServerRID): string { return this.string('_font_get_name', fontRid); }
  _font_get_ot_name_strings(fontRid: GodotTextServerRID): GodotTextServerDictionary { return this.call('_font_get_ot_name_strings', fontRid) as GodotTextServerDictionary; }
  _font_set_style_name(fontRid: GodotTextServerRID, value: string): void { this.call('_font_set_style_name', fontRid, value); }
  _font_get_style_name(fontRid: GodotTextServerRID): string { return this.string('_font_get_style_name', fontRid); }
  _font_set_weight(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_weight', fontRid, value); }
  _font_get_weight(fontRid: GodotTextServerRID): number { return this.int('_font_get_weight', fontRid); }
  _font_set_stretch(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_stretch', fontRid, value); }
  _font_get_stretch(fontRid: GodotTextServerRID): number { return this.int('_font_get_stretch', fontRid); }
  _font_set_antialiasing(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_antialiasing', fontRid, value); }
  _font_get_antialiasing(fontRid: GodotTextServerRID): number { return this.int('_font_get_antialiasing', fontRid); }
  _font_set_disable_embedded_bitmaps(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_disable_embedded_bitmaps', fontRid, value); }
  _font_get_disable_embedded_bitmaps(fontRid: GodotTextServerRID): boolean { return this.bool('_font_get_disable_embedded_bitmaps', fontRid); }
  _font_set_generate_mipmaps(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_generate_mipmaps', fontRid, value); }
  _font_get_generate_mipmaps(fontRid: GodotTextServerRID): boolean { return this.bool('_font_get_generate_mipmaps', fontRid); }
  _font_set_multichannel_signed_distance_field(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_multichannel_signed_distance_field', fontRid, value); }
  _font_is_multichannel_signed_distance_field(fontRid: GodotTextServerRID): boolean { return this.bool('_font_is_multichannel_signed_distance_field', fontRid); }
  _font_set_msdf_pixel_range(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_msdf_pixel_range', fontRid, value); }
  _font_get_msdf_pixel_range(fontRid: GodotTextServerRID): number { return this.int('_font_get_msdf_pixel_range', fontRid); }
  _font_set_msdf_size(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_msdf_size', fontRid, value); }
  _font_get_msdf_size(fontRid: GodotTextServerRID): number { return this.int('_font_get_msdf_size', fontRid); }
  _font_set_fixed_size(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_fixed_size', fontRid, value); }
  _font_get_fixed_size(fontRid: GodotTextServerRID): number { return this.int('_font_get_fixed_size', fontRid); }
  _font_set_fixed_size_scale_mode(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_fixed_size_scale_mode', fontRid, value); }
  _font_get_fixed_size_scale_mode(fontRid: GodotTextServerRID): number { return this.int('_font_get_fixed_size_scale_mode', fontRid); }
  _font_set_allow_system_fallback(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_allow_system_fallback', fontRid, value); }
  _font_is_allow_system_fallback(fontRid: GodotTextServerRID): boolean { return this.bool('_font_is_allow_system_fallback', fontRid); }
  _font_clear_system_fallback_cache(): void { this.call('_font_clear_system_fallback_cache'); }
  _font_set_force_autohinter(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_force_autohinter', fontRid, value); }
  _font_is_force_autohinter(fontRid: GodotTextServerRID): boolean { return this.bool('_font_is_force_autohinter', fontRid); }
  _font_set_modulate_color_glyphs(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_modulate_color_glyphs', fontRid, value); }
  _font_is_modulate_color_glyphs(fontRid: GodotTextServerRID): boolean { return this.bool('_font_is_modulate_color_glyphs', fontRid); }
  _font_get_palette_count(fontRid: GodotTextServerRID): number { return this.int('_font_get_palette_count', fontRid); }
  _font_get_palette_name(fontRid: GodotTextServerRID, index: number): string { return this.string('_font_get_palette_name', fontRid, index); }
  _font_get_palette_colors(fontRid: GodotTextServerRID, index: number): PackedColorArray { return packedColorArray(this.call('_font_get_palette_colors', fontRid, index) as Iterable<ColorValue>); }
  _font_set_palette_custom_colors(fontRid: GodotTextServerRID, colors: Iterable<ColorValue>): void { this.call('_font_set_palette_custom_colors', fontRid, packedColorArray(colors)); }
  _font_get_palette_custom_colors(fontRid: GodotTextServerRID): PackedColorArray { return packedColorArray(this.call('_font_get_palette_custom_colors', fontRid) as Iterable<ColorValue>); }
  _font_get_used_palette(fontRid: GodotTextServerRID): number { return this.int('_font_get_used_palette', fontRid); }
  _font_set_used_palette(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_used_palette', fontRid, value); }
  _font_set_hinting(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_hinting', fontRid, value); }
  _font_get_hinting(fontRid: GodotTextServerRID): number { return this.int('_font_get_hinting', fontRid); }
  _font_set_subpixel_positioning(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_subpixel_positioning', fontRid, value); }
  _font_get_subpixel_positioning(fontRid: GodotTextServerRID): number { return this.int('_font_get_subpixel_positioning', fontRid); }
  _font_set_keep_rounding_remainders(fontRid: GodotTextServerRID, value: boolean): void { this.call('_font_set_keep_rounding_remainders', fontRid, value); }
  _font_get_keep_rounding_remainders(fontRid: GodotTextServerRID): boolean { return this.bool('_font_get_keep_rounding_remainders', fontRid); }
  _font_set_embolden(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_embolden', fontRid, value); }
  _font_get_embolden(fontRid: GodotTextServerRID): number { return this.float('_font_get_embolden', fontRid); }
  _font_set_spacing(fontRid: GodotTextServerRID, spacing: number, value: number): void { this.call('_font_set_spacing', fontRid, spacing, value); }
  _font_get_spacing(fontRid: GodotTextServerRID, spacing: number): number { return this.int('_font_get_spacing', fontRid, spacing); }
  _font_set_baseline_offset(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_baseline_offset', fontRid, value); }
  _font_get_baseline_offset(fontRid: GodotTextServerRID): number { return this.float('_font_get_baseline_offset', fontRid); }
  _font_set_transform(fontRid: GodotTextServerRID, value: unknown): void { this.call('_font_set_transform', fontRid, value); }
  _font_get_transform(fontRid: GodotTextServerRID): unknown { return this.call('_font_get_transform', fontRid); }
  _font_set_variation_coordinates(fontRid: GodotTextServerRID, value: GodotTextServerDictionary): void { this.call('_font_set_variation_coordinates', fontRid, value); }
  _font_get_variation_coordinates(fontRid: GodotTextServerRID): GodotTextServerDictionary { return this.call('_font_get_variation_coordinates', fontRid) as GodotTextServerDictionary; }
  _font_set_oversampling(fontRid: GodotTextServerRID, value: number): void { this.call('_font_set_oversampling', fontRid, value); }
  _font_get_oversampling(fontRid: GodotTextServerRID): number { return this.float('_font_get_oversampling', fontRid); }
  _font_get_size_cache_list(fontRid: GodotTextServerRID): readonly Vector2[] { return [...(this.call('_font_get_size_cache_list', fontRid) as Iterable<Vector2>)]; }
  _font_clear_size_cache(fontRid: GodotTextServerRID): void { this.call('_font_clear_size_cache', fontRid); }
  _font_remove_size_cache(fontRid: GodotTextServerRID, size: Vector2): void { this.call('_font_remove_size_cache', fontRid, size); }
  _font_get_size_cache_info(fontRid: GodotTextServerRID): readonly GodotTextServerDictionary[] { return [...(this.call('_font_get_size_cache_info', fontRid) as Iterable<GodotTextServerDictionary>)]; }
  _font_set_ascent(fontRid: GodotTextServerRID, size: number, value: number): void { this.call('_font_set_ascent', fontRid, size, value); }
  _font_get_ascent(fontRid: GodotTextServerRID, size: number): number { return this.float('_font_get_ascent', fontRid, size); }
  _font_set_descent(fontRid: GodotTextServerRID, size: number, value: number): void { this.call('_font_set_descent', fontRid, size, value); }
  _font_get_descent(fontRid: GodotTextServerRID, size: number): number { return this.float('_font_get_descent', fontRid, size); }
  _font_set_underline_position(fontRid: GodotTextServerRID, size: number, value: number): void { this.call('_font_set_underline_position', fontRid, size, value); }
  _font_get_underline_position(fontRid: GodotTextServerRID, size: number): number { return this.float('_font_get_underline_position', fontRid, size); }
  _font_set_underline_thickness(fontRid: GodotTextServerRID, size: number, value: number): void { this.call('_font_set_underline_thickness', fontRid, size, value); }
  _font_get_underline_thickness(fontRid: GodotTextServerRID, size: number): number { return this.float('_font_get_underline_thickness', fontRid, size); }
  _font_set_scale(fontRid: GodotTextServerRID, size: number, value: number): void { this.call('_font_set_scale', fontRid, size, value); }
  _font_get_scale(fontRid: GodotTextServerRID, size: number): number { return this.float('_font_get_scale', fontRid, size); }

  _font_get_texture_count(fontRid: GodotTextServerRID, size: Vector2): number { return this.int('_font_get_texture_count', fontRid, size); }
  _font_clear_textures(fontRid: GodotTextServerRID, size: Vector2): void { this.call('_font_clear_textures', fontRid, size); }
  _font_remove_texture(fontRid: GodotTextServerRID, size: Vector2, textureIndex: number): void { this.call('_font_remove_texture', fontRid, size, textureIndex); }
  _font_set_texture_image(fontRid: GodotTextServerRID, size: Vector2, textureIndex: number, image: unknown): void { this.call('_font_set_texture_image', fontRid, size, textureIndex, image); }
  _font_get_texture_image(fontRid: GodotTextServerRID, size: Vector2, textureIndex: number): unknown { return this.call('_font_get_texture_image', fontRid, size, textureIndex); }
  _font_set_texture_offsets(fontRid: GodotTextServerRID, size: Vector2, textureIndex: number, offsets: Iterable<number>): void { this.call('_font_set_texture_offsets', fontRid, size, textureIndex, packedInt32Array(offsets)); }
  _font_get_texture_offsets(fontRid: GodotTextServerRID, size: Vector2, textureIndex: number): PackedInt32Array { return packedInt32Array(this.call('_font_get_texture_offsets', fontRid, size, textureIndex) as Iterable<number>); }

  _font_get_glyph_list(fontRid: GodotTextServerRID, size: Vector2): PackedInt32Array { return packedInt32Array(this.call('_font_get_glyph_list', fontRid, size) as Iterable<number>); }
  _font_clear_glyphs(fontRid: GodotTextServerRID, size: Vector2): void { this.call('_font_clear_glyphs', fontRid, size); }
  _font_remove_glyph(fontRid: GodotTextServerRID, size: Vector2, glyph: number): void { this.call('_font_remove_glyph', fontRid, size, glyph); }
  _font_get_glyph_advance(fontRid: GodotTextServerRID, size: number, glyph: number): Vector2 { return vector(this.call('_font_get_glyph_advance', fontRid, size, glyph), '_font_get_glyph_advance'); }
  _font_set_glyph_advance(fontRid: GodotTextServerRID, size: number, glyph: number, advance: Vector2): void { this.call('_font_set_glyph_advance', fontRid, size, glyph, advance); }
  _font_get_glyph_offset(fontRid: GodotTextServerRID, size: Vector2, glyph: number): Vector2 { return vector(this.call('_font_get_glyph_offset', fontRid, size, glyph), '_font_get_glyph_offset'); }
  _font_set_glyph_offset(fontRid: GodotTextServerRID, size: Vector2, glyph: number, offset: Vector2): void { this.call('_font_set_glyph_offset', fontRid, size, glyph, offset); }
  _font_get_glyph_size(fontRid: GodotTextServerRID, size: Vector2, glyph: number): Vector2 { return vector(this.call('_font_get_glyph_size', fontRid, size, glyph), '_font_get_glyph_size'); }
  _font_set_glyph_size(fontRid: GodotTextServerRID, size: Vector2, glyph: number, glyphSize: Vector2): void { this.call('_font_set_glyph_size', fontRid, size, glyph, glyphSize); }
  _font_get_glyph_texture_idx(fontRid: GodotTextServerRID, size: Vector2, glyph: number): number { return this.int('_font_get_glyph_texture_idx', fontRid, size, glyph); }
  _font_set_glyph_texture_idx(fontRid: GodotTextServerRID, size: Vector2, glyph: number, textureIndex: number): void { this.call('_font_set_glyph_texture_idx', fontRid, size, glyph, textureIndex); }
  _font_get_glyph_texture_rid(fontRid: GodotTextServerRID, size: Vector2, glyph: number): GodotTextServerRID { return this.call('_font_get_glyph_texture_rid', fontRid, size, glyph); }
  _font_get_glyph_texture_size(fontRid: GodotTextServerRID, size: Vector2, glyph: number): Vector2 { return vector(this.call('_font_get_glyph_texture_size', fontRid, size, glyph), '_font_get_glyph_texture_size'); }
  _font_get_glyph_uv_rect(fontRid: GodotTextServerRID, size: Vector2, glyph: number): unknown { return this.call('_font_get_glyph_uv_rect', fontRid, size, glyph); }
  _font_set_glyph_uv_rect(fontRid: GodotTextServerRID, size: Vector2, glyph: number, rect: unknown): void { this.call('_font_set_glyph_uv_rect', fontRid, size, glyph, rect); }
  _font_get_glyph_contours(fontRid: GodotTextServerRID, size: number, index: number): GodotTextServerDictionary { return this.call('_font_get_glyph_contours', fontRid, size, index) as GodotTextServerDictionary; }
  _font_get_kerning_list(fontRid: GodotTextServerRID, size: number): readonly Vector2[] { return [...(this.call('_font_get_kerning_list', fontRid, size) as Iterable<Vector2>)]; }
  _font_clear_kerning_map(fontRid: GodotTextServerRID, size: number): void { this.call('_font_clear_kerning_map', fontRid, size); }
  _font_remove_kerning(fontRid: GodotTextServerRID, size: number, glyphPair: Vector2): void { this.call('_font_remove_kerning', fontRid, size, glyphPair); }
  _font_set_kerning(fontRid: GodotTextServerRID, size: number, glyphPair: Vector2, kerning: Vector2): void { this.call('_font_set_kerning', fontRid, size, glyphPair, kerning); }
  _font_get_kerning(fontRid: GodotTextServerRID, size: number, glyphPair: Vector2): Vector2 { return vector(this.call('_font_get_kerning', fontRid, size, glyphPair), '_font_get_kerning'); }
  _font_get_glyph_index(fontRid: GodotTextServerRID, size: number, character: number, variationSelector = 0): number { return this.int('_font_get_glyph_index', fontRid, size, character, variationSelector); }
  _font_get_char_from_glyph_index(fontRid: GodotTextServerRID, size: number, glyphIndex: number): number { return this.int('_font_get_char_from_glyph_index', fontRid, size, glyphIndex); }
  _font_render_range(fontRid: GodotTextServerRID, size: Vector2, start: number, end: number): void { this.call('_font_render_range', fontRid, size, start, end); }
  _font_render_glyph(fontRid: GodotTextServerRID, size: Vector2, index: number): void { this.call('_font_render_glyph', fontRid, size, index); }
  _font_draw_glyph(fontRid: GodotTextServerRID, canvas: GodotTextServerRID, size: number, position: Vector2, index: number, color: ColorValue, oversampling = 1): void { this.call('_font_draw_glyph', fontRid, canvas, size, position, index, color, oversampling); }
  _font_draw_glyph_outline(fontRid: GodotTextServerRID, canvas: GodotTextServerRID, size: number, outlineSize: number, position: Vector2, index: number, color: ColorValue, oversampling = 1): void { this.call('_font_draw_glyph_outline', fontRid, canvas, size, outlineSize, position, index, color, oversampling); }

  _font_has_char(fontRid: GodotTextServerRID, char: number): boolean { return this.bool('_font_has_char', fontRid, char); }
  _font_get_supported_chars(fontRid: GodotTextServerRID): string { return this.string('_font_get_supported_chars', fontRid); }
  _font_get_supported_glyphs(fontRid: GodotTextServerRID): PackedInt32Array { return packedInt32Array(this.call('_font_get_supported_glyphs', fontRid) as Iterable<number>); }
  _font_is_language_supported(fontRid: GodotTextServerRID, language: string): boolean { return this.bool('_font_is_language_supported', fontRid, language); }
  _font_set_language_support_override(fontRid: GodotTextServerRID, language: string, supported: boolean): void { this.call('_font_set_language_support_override', fontRid, language, supported); }
  _font_get_language_support_override(fontRid: GodotTextServerRID, language: string): boolean { return this.bool('_font_get_language_support_override', fontRid, language); }
  _font_remove_language_support_override(fontRid: GodotTextServerRID, language: string): void { this.call('_font_remove_language_support_override', fontRid, language); }
  _font_get_language_support_overrides(fontRid: GodotTextServerRID): PackedStringArray { return packedStringArray(this.call('_font_get_language_support_overrides', fontRid) as Iterable<string>); }
  _font_is_script_supported(fontRid: GodotTextServerRID, script: string): boolean { return this.bool('_font_is_script_supported', fontRid, script); }
  _font_set_script_support_override(fontRid: GodotTextServerRID, script: string, supported: boolean): void { this.call('_font_set_script_support_override', fontRid, script, supported); }
  _font_get_script_support_override(fontRid: GodotTextServerRID, script: string): boolean { return this.bool('_font_get_script_support_override', fontRid, script); }
  _font_remove_script_support_override(fontRid: GodotTextServerRID, script: string): void { this.call('_font_remove_script_support_override', fontRid, script); }
  _font_get_script_support_overrides(fontRid: GodotTextServerRID): PackedStringArray { return packedStringArray(this.call('_font_get_script_support_overrides', fontRid) as Iterable<string>); }
  _font_set_opentype_feature_overrides(fontRid: GodotTextServerRID, overrides: GodotTextServerDictionary): void { this.call('_font_set_opentype_feature_overrides', fontRid, overrides); }
  _font_get_opentype_feature_overrides(fontRid: GodotTextServerRID): GodotTextServerDictionary { return this.call('_font_get_opentype_feature_overrides', fontRid) as GodotTextServerDictionary; }
  _font_supported_feature_list(fontRid: GodotTextServerRID): GodotTextServerDictionary { return this.call('_font_supported_feature_list', fontRid) as GodotTextServerDictionary; }
  _font_supported_variation_list(fontRid: GodotTextServerRID): GodotTextServerDictionary { return this.call('_font_supported_variation_list', fontRid) as GodotTextServerDictionary; }
  _font_get_global_oversampling(): number { return this.float('_font_get_global_oversampling'); }
  _font_set_global_oversampling(value: number): void { this.call('_font_set_global_oversampling', value); }
  _reference_oversampling_level(value: number): void { this.call('_reference_oversampling_level', value); }
  _unreference_oversampling_level(value: number): void { this.call('_unreference_oversampling_level', value); }

  _get_hex_code_box_size(size: number, index: number): Vector2 { return vector(this.call('_get_hex_code_box_size', size, index), '_get_hex_code_box_size'); }
  _draw_hex_code_box(canvas: GodotTextServerRID, size: number, position: Vector2, index: number, color: ColorValue): void { this.call('_draw_hex_code_box', canvas, size, position, index, color); }

  _create_shaped_text(direction: number, orientation: number): GodotTextServerRID { return this.call('_create_shaped_text', direction, orientation); }
  _shaped_text_clear(shaped: GodotTextServerRID): void { this.call('_shaped_text_clear', shaped); }
  _shaped_text_duplicate(shaped: GodotTextServerRID): GodotTextServerRID { return this.call('_shaped_text_duplicate', shaped); }
  _shaped_text_set_direction(shaped: GodotTextServerRID, direction: number): void { this.call('_shaped_text_set_direction', shaped, direction); }
  _shaped_text_get_direction(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_direction', shaped); }
  _shaped_text_get_inferred_direction(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_inferred_direction', shaped); }
  _shaped_text_set_bidi_override(shaped: GodotTextServerRID, override: readonly unknown[]): void { this.call('_shaped_text_set_bidi_override', shaped, override.slice()); }
  _shaped_text_set_custom_punctuation(shaped: GodotTextServerRID, punctuation: string): void { this.call('_shaped_text_set_custom_punctuation', shaped, punctuation); }
  _shaped_text_get_custom_punctuation(shaped: GodotTextServerRID): string { return this.string('_shaped_text_get_custom_punctuation', shaped); }
  _shaped_text_set_custom_ellipsis(shaped: GodotTextServerRID, character: number): void { this.call('_shaped_text_set_custom_ellipsis', shaped, character); }
  _shaped_text_get_custom_ellipsis(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_custom_ellipsis', shaped); }
  _shaped_text_set_orientation(shaped: GodotTextServerRID, orientation: number): void { this.call('_shaped_text_set_orientation', shaped, orientation); }
  _shaped_text_get_orientation(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_orientation', shaped); }
  _shaped_text_set_preserve_invalid(shaped: GodotTextServerRID, enabled: boolean): void { this.call('_shaped_text_set_preserve_invalid', shaped, enabled); }
  _shaped_text_get_preserve_invalid(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_get_preserve_invalid', shaped); }
  _shaped_text_set_preserve_control(shaped: GodotTextServerRID, enabled: boolean): void { this.call('_shaped_text_set_preserve_control', shaped, enabled); }
  _shaped_text_get_preserve_control(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_get_preserve_control', shaped); }
  _shaped_text_set_spacing(shaped: GodotTextServerRID, spacing: number, value: number): void { this.call('_shaped_text_set_spacing', shaped, spacing, value); }
  _shaped_text_get_spacing(shaped: GodotTextServerRID, spacing: number): number { return this.int('_shaped_text_get_spacing', shaped, spacing); }
  _shaped_text_add_string(shaped: GodotTextServerRID, text: string, fonts: readonly GodotTextServerRID[], size: number, features: GodotTextServerDictionary, language: string, meta: unknown): boolean { return this.bool('_shaped_text_add_string', shaped, text, fonts.slice(), size, features, language, meta); }
  _shaped_text_add_object(shaped: GodotTextServerRID, key: unknown, size: Vector2, inlineAlign: number, length = 1, baseline = 0): boolean { return this.bool('_shaped_text_add_object', shaped, key, size, inlineAlign, length, baseline); }
  _shaped_text_resize_object(shaped: GodotTextServerRID, key: unknown, size: Vector2, inlineAlign: number, baseline = 0): boolean { return this.bool('_shaped_text_resize_object', shaped, key, size, inlineAlign, baseline); }
  _shaped_text_has_object(shaped: GodotTextServerRID, key: unknown): boolean { return this.bool('_shaped_text_has_object', shaped, key); }
  _shaped_get_text(shaped: GodotTextServerRID): string { return this.string('_shaped_get_text', shaped); }
  _shaped_get_span_count(shaped: GodotTextServerRID): number { return this.int('_shaped_get_span_count', shaped); }
  _shaped_get_span_meta(shaped: GodotTextServerRID, index: number): unknown { return this.call('_shaped_get_span_meta', shaped, index); }
  _shaped_get_span_embedded_object(shaped: GodotTextServerRID, index: number): unknown { return this.call('_shaped_get_span_embedded_object', shaped, index); }
  _shaped_get_span_text(shaped: GodotTextServerRID, index: number): string { return this.string('_shaped_get_span_text', shaped, index); }
  _shaped_get_span_object(shaped: GodotTextServerRID, index: number): unknown { return this.call('_shaped_get_span_object', shaped, index); }
  _shaped_set_span_update_font(shaped: GodotTextServerRID, index: number, fonts: readonly GodotTextServerRID[], size: number, features: GodotTextServerDictionary): void { this.call('_shaped_set_span_update_font', shaped, index, fonts.slice(), size, features); }
  _shaped_get_run_count(shaped: GodotTextServerRID): number { return this.int('_shaped_get_run_count', shaped); }
  _shaped_get_run_text(shaped: GodotTextServerRID, index: number): string { return this.string('_shaped_get_run_text', shaped, index); }
  _shaped_get_run_range(shaped: GodotTextServerRID, index: number): Vector2 { return vector(this.call('_shaped_get_run_range', shaped, index), '_shaped_get_run_range'); }
  _shaped_get_run_glyph_range(shaped: GodotTextServerRID, index: number): Vector2 { return vector(this.call('_shaped_get_run_glyph_range', shaped, index), '_shaped_get_run_glyph_range'); }
  _shaped_get_run_font_rid(shaped: GodotTextServerRID, index: number): GodotTextServerRID { return this.call('_shaped_get_run_font_rid', shaped, index); }
  _shaped_get_run_font_size(shaped: GodotTextServerRID, index: number): number { return this.int('_shaped_get_run_font_size', shaped, index); }
  _shaped_get_run_language(shaped: GodotTextServerRID, index: number): string { return this.string('_shaped_get_run_language', shaped, index); }
  _shaped_get_run_direction(shaped: GodotTextServerRID, index: number): number { return this.int('_shaped_get_run_direction', shaped, index); }
  _shaped_get_run_object(shaped: GodotTextServerRID, index: number): unknown { return this.call('_shaped_get_run_object', shaped, index); }
  _shaped_text_substr(shaped: GodotTextServerRID, start: number, length: number): GodotTextServerRID { return this.call('_shaped_text_substr', shaped, start, length); }
  _shaped_text_get_parent(shaped: GodotTextServerRID): GodotTextServerRID { return this.call('_shaped_text_get_parent', shaped); }
  _shaped_text_fit_to_width(shaped: GodotTextServerRID, width: number, justificationFlags: number): number { return this.float('_shaped_text_fit_to_width', shaped, width, justificationFlags); }
  _shaped_text_tab_align(shaped: GodotTextServerRID, tabStops: Iterable<number>): number { return this.float('_shaped_text_tab_align', shaped, packedFloat32Array(tabStops)); }
  _shaped_text_shape(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_shape', shaped); }
  _shaped_text_update_breaks(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_update_breaks', shaped); }
  _shaped_text_update_justification_ops(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_update_justification_ops', shaped); }
  _shaped_text_is_ready(shaped: GodotTextServerRID): boolean { return this.bool('_shaped_text_is_ready', shaped); }
  _shaped_text_get_glyphs(shaped: GodotTextServerRID): readonly unknown[] { return [...(this.call('_shaped_text_get_glyphs', shaped) as Iterable<unknown>)]; }
  _shaped_text_sort_logical(shaped: GodotTextServerRID): readonly unknown[] { return [...(this.call('_shaped_text_sort_logical', shaped) as Iterable<unknown>)]; }
  _shaped_text_get_glyph_count(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_glyph_count', shaped); }
  _shaped_text_get_range(shaped: GodotTextServerRID): Vector2 { return vector(this.call('_shaped_text_get_range', shaped), '_shaped_text_get_range'); }
  _shaped_text_get_line_breaks_adv(shaped: GodotTextServerRID, widths: Iterable<number>, start: number, once: boolean, breakFlags: number): PackedInt32Array { return packedInt32Array(this.call('_shaped_text_get_line_breaks_adv', shaped, packedFloat32Array(widths), start, once, breakFlags) as Iterable<number>); }
  _shaped_text_get_line_breaks(shaped: GodotTextServerRID, width: number, start: number, breakFlags: number): PackedInt32Array { return packedInt32Array(this.call('_shaped_text_get_line_breaks', shaped, width, start, breakFlags) as Iterable<number>); }
  _shaped_text_get_word_breaks(shaped: GodotTextServerRID, graphemeFlags: number, skipGraphemeFlags: number): PackedInt32Array { return packedInt32Array(this.call('_shaped_text_get_word_breaks', shaped, graphemeFlags, skipGraphemeFlags) as Iterable<number>); }
  _shaped_text_get_trim_pos(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_trim_pos', shaped); }
  _shaped_text_get_ellipsis_pos(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_ellipsis_pos', shaped); }
  _shaped_text_get_ellipsis_glyph_count(shaped: GodotTextServerRID): number { return this.int('_shaped_text_get_ellipsis_glyph_count', shaped); }
  _shaped_text_get_ellipsis_glyphs(shaped: GodotTextServerRID): readonly unknown[] { return [...(this.call('_shaped_text_get_ellipsis_glyphs', shaped) as Iterable<unknown>)]; }
  _shaped_text_overrun_trim_to_width(shaped: GodotTextServerRID, width: number, trimFlags: number): void { this.call('_shaped_text_overrun_trim_to_width', shaped, width, trimFlags); }
  _shaped_text_get_objects(shaped: GodotTextServerRID): readonly unknown[] { return [...(this.call('_shaped_text_get_objects', shaped) as Iterable<unknown>)]; }
  _shaped_text_get_object_rect(shaped: GodotTextServerRID, key: unknown): unknown { return this.call('_shaped_text_get_object_rect', shaped, key); }
  _shaped_text_get_object_range(shaped: GodotTextServerRID, key: unknown): Vector2 { return vector(this.call('_shaped_text_get_object_range', shaped, key), '_shaped_text_get_object_range'); }
  _shaped_text_get_object_glyph(shaped: GodotTextServerRID, key: unknown): number { return this.int('_shaped_text_get_object_glyph', shaped, key); }
  _shaped_text_get_size(shaped: GodotTextServerRID): Vector2 { return vector(this.call('_shaped_text_get_size', shaped), '_shaped_text_get_size'); }
  _shaped_text_get_ascent(shaped: GodotTextServerRID): number { return this.float('_shaped_text_get_ascent', shaped); }
  _shaped_text_get_descent(shaped: GodotTextServerRID): number { return this.float('_shaped_text_get_descent', shaped); }
  _shaped_text_get_width(shaped: GodotTextServerRID): number { return this.float('_shaped_text_get_width', shaped); }
  _shaped_text_get_underline_position(shaped: GodotTextServerRID): number { return this.float('_shaped_text_get_underline_position', shaped); }
  _shaped_text_get_underline_thickness(shaped: GodotTextServerRID): number { return this.float('_shaped_text_get_underline_thickness', shaped); }
  _shaped_text_get_dominant_direction_in_range(shaped: GodotTextServerRID, start: number, end: number): number { return this.int('_shaped_text_get_dominant_direction_in_range', shaped, start, end); }
  _shaped_text_get_carets(shaped: GodotTextServerRID, position: number): unknown { return this.call('_shaped_text_get_carets', shaped, position); }
  _shaped_text_get_selection(shaped: GodotTextServerRID, start: number, end: number): PackedVector2Array { return packedVector2Array(this.call('_shaped_text_get_selection', shaped, start, end) as Iterable<Vector2>); }
  _shaped_text_hit_test_grapheme(shaped: GodotTextServerRID, coordinate: number): number { return this.int('_shaped_text_hit_test_grapheme', shaped, coordinate); }
  _shaped_text_hit_test_position(shaped: GodotTextServerRID, coordinate: number): number { return this.int('_shaped_text_hit_test_position', shaped, coordinate); }
  _shaped_text_draw(shaped: GodotTextServerRID, canvas: GodotTextServerRID, position: Vector2, clipLeft: number, clipRight: number, color: ColorValue, oversampling = 1): void { this.call('_shaped_text_draw', shaped, canvas, position, clipLeft, clipRight, color, oversampling); }
  _shaped_text_draw_outline(shaped: GodotTextServerRID, canvas: GodotTextServerRID, position: Vector2, clipLeft: number, clipRight: number, outlineSize: number, color: ColorValue, oversampling = 1): void { this.call('_shaped_text_draw_outline', shaped, canvas, position, clipLeft, clipRight, outlineSize, color, oversampling); }
  _shaped_text_get_grapheme_bounds(shaped: GodotTextServerRID, position: number): Vector2 { return vector(this.call('_shaped_text_get_grapheme_bounds', shaped, position), '_shaped_text_get_grapheme_bounds'); }
  _shaped_text_next_grapheme_pos(shaped: GodotTextServerRID, position: number): number { return this.int('_shaped_text_next_grapheme_pos', shaped, position); }
  _shaped_text_prev_grapheme_pos(shaped: GodotTextServerRID, position: number): number { return this.int('_shaped_text_prev_grapheme_pos', shaped, position); }
  _shaped_text_get_character_breaks(shaped: GodotTextServerRID): PackedInt32Array { return packedInt32Array(this.call('_shaped_text_get_character_breaks', shaped) as Iterable<number>); }
  _shaped_text_next_character_pos(shaped: GodotTextServerRID, position: number): number { return this.int('_shaped_text_next_character_pos', shaped, position); }
  _shaped_text_prev_character_pos(shaped: GodotTextServerRID, position: number): number { return this.int('_shaped_text_prev_character_pos', shaped, position); }
  _shaped_text_closest_character_pos(shaped: GodotTextServerRID, position: number): number { return this.int('_shaped_text_closest_character_pos', shaped, position); }

  _format_number(number: string, language: string): string { return this.string('_format_number', number, language); }
  _parse_number(number: string, language: string): string { return this.string('_parse_number', number, language); }
  _percent_sign(language: string): string { return this.string('_percent_sign', language); }
  _strip_diacritics(value: string): string { return this.string('_strip_diacritics', value); }
  _is_valid_identifier(value: string): boolean { return this.bool('_is_valid_identifier', value); }
  _is_valid_letter(unicode: number): boolean { return this.bool('_is_valid_letter', unicode); }
  _string_get_word_breaks(value: string, language: string, charsPerLine: number): PackedInt32Array { return packedInt32Array(this.call('_string_get_word_breaks', value, language, charsPerLine) as Iterable<number>); }
  _string_get_character_breaks(value: string, language: string): PackedInt32Array { return packedInt32Array(this.call('_string_get_character_breaks', value, language) as Iterable<number>); }
  _is_confusable(value: string, dictionary: Iterable<string>): number { return this.int('_is_confusable', value, packedStringArray(dictionary)); }
  _spoof_check(value: string): boolean { return this.bool('_spoof_check', value); }
  _string_to_upper(value: string, language: string): string { return this.string('_string_to_upper', value, language); }
  _string_to_lower(value: string, language: string): string { return this.string('_string_to_lower', value, language); }
  _string_to_title(value: string, language: string): string { return this.string('_string_to_title', value, language); }
  _parse_structured_text(parserType: number, args: readonly unknown[], text: string): readonly unknown[] { return [...(this.call('_parse_structured_text', parserType, args.slice(), text) as Iterable<unknown>)]; }

  _cleanup(): void { this.call('_cleanup'); }
}

export function createGodotTextServerExtension(
  carrier: GodotTextServerExtensionCarrier,
): GodotTextServerExtension {
  return new GodotTextServerExtension(carrier);
}
