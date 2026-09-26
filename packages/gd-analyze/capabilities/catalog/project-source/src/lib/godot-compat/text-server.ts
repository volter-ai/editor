/** TextServer font RID façade over retained FontFile resources and browser-native metrics. */

import {
  createGodotFontFile,
  getFontFileData,
  getFontFileName,
  godotFontAscent,
  godotFontCharSize,
  godotFontDescent,
  godotFontGetFaceCount,
  godotFontGetOpentypeFeatures,
  godotFontGetOtNameStrings,
  godotFontGetSupportedFeatureList,
  godotFontGetSupportedVariationList,
  godotFontHasChar,
  godotFontHeight,
  godotFontIsLanguageSupported,
  godotFontIsScriptSupported,
  godotFontScale,
  godotFontUnderlinePosition,
  godotFontUnderlineThickness,
  setFontFileData,
  setFontFileName,
  setGodotFontProperty,
  type GodotFontFile,
} from './font';
import {
  godotFontFileGetCharFromGlyphIndex,
  godotFontFileGetGlyphIndex,
  godotFontFileGetLanguageSupportOverride,
  godotFontFileGetLanguageSupportOverrides,
  godotFontFileGetOpentypeFeatureOverrides,
  godotFontFileGetScriptSupportOverride,
  godotFontFileGetScriptSupportOverrides,
  godotFontFileRemoveLanguageSupportOverride,
  godotFontFileRemoveScriptSupportOverride,
  godotFontFileSetLanguageSupportOverride,
  godotFontFileSetOpentypeFeatureOverrides,
  godotFontFileSetScriptSupportOverride,
} from './font-cache';
import type { GodotRid } from './gdscript-builtins';
import { godotResourceGetRid, godotResourceOfRid } from './resource-io';

export function godotTextServerGetName(): string { return 'Browser TextServer'; }
export function godotTextServerGetFeatures(): number { return 0; }
export function godotTextServerHasFeature(featureValue: unknown): boolean { integer(featureValue, 'has_feature.feature', 0); return false; }
export function godotTextServerLoadSupportData(filenameValue: unknown): boolean { string(filenameValue, 'load_support_data.filename'); return false; }
export function godotTextServerGetSupportDataFilename(): string { return ''; }
export function godotTextServerGetSupportDataInfo(): Record<string, unknown> { return { name: 'Browser TextServer', features: 0 }; }
export function godotTextServerSaveSupportData(filenameValue: unknown): boolean { string(filenameValue, 'save_support_data.filename'); return false; }
export function godotTextServerGetSupportData(): Uint8Array { return new Uint8Array(); }

export function godotTextServerIsLocaleRightToLeft(localeValue: unknown): boolean {
  const locale = string(localeValue, 'is_locale_right_to_left.locale').toLowerCase();
  return /^(ar|arc|az-arab|dv|fa|he|ku-arab|nqo|ps|sd|syr|ug|ur|yi)(?:[-_]|$)/u.test(locale);
}

export function godotTextServerGetHexCodeBoxSize(sizeValue: unknown, indexValue: unknown): { x: number; y: number } {
  const size = integer(sizeValue, 'get_hex_code_box_size.size', 1, 4096);
  integer(indexValue, 'get_hex_code_box_size.index', 0, 0x10ffff);
  return { x: size * 1.5, y: size };
}

export function godotTextServerNameToTag(nameValue: unknown): number {
  const name = string(nameValue, 'name_to_tag.name').padEnd(4, ' ').slice(0, 4);
  return ((name.charCodeAt(0) << 24) | (name.charCodeAt(1) << 16) | (name.charCodeAt(2) << 8) | name.charCodeAt(3)) >>> 0;
}

export function godotTextServerTagToName(tagValue: unknown): string {
  const tag = integer(tagValue, 'tag_to_name.tag', 0, 0xffffffff) >>> 0;
  return String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff).trimEnd();
}

export function godotTextServerHas(codeValue: unknown): boolean {
  const code = integer(codeValue, 'has.code', 0, 0x10ffff);
  return code < 0xd800 || code > 0xdfff;
}

export function godotTextServerGetPercentSign(languageValue: unknown): string {
  const language = string(languageValue, 'get_percent_sign.language').toLowerCase();
  return /^(ar|fa|ur)(?:[-_]|$)/u.test(language) ? '٪' : '%';
}

export function godotTextServerStripDiacritics(textValue: unknown): string {
  return string(textValue, 'strip_diacritics.text').normalize('NFD').replace(/\p{Mark}+/gu, '').normalize('NFC');
}

export function godotTextServerIsValidIdentifier(textValue: unknown): boolean {
  return /^[_\p{ID_Start}][\p{ID_Continue}]*$/u.test(string(textValue, 'is_valid_identifier.text'));
}

export function godotTextServerIsValidLetter(codeValue: unknown): boolean {
  return /\p{Letter}/u.test(String.fromCodePoint(integer(codeValue, 'is_valid_letter.unicode', 0, 0x10ffff)));
}

export function godotTextServerStringToUpper(textValue: unknown, languageValue = ''): string {
  const text = string(textValue, 'string_to_upper.text'); const language = string(languageValue, 'string_to_upper.language');
  try { return language === '' ? text.toUpperCase() : text.toLocaleUpperCase(language); } catch { return text.toUpperCase(); }
}

export function godotTextServerStringToLower(textValue: unknown, languageValue = ''): string {
  const text = string(textValue, 'string_to_lower.text'); const language = string(languageValue, 'string_to_lower.language');
  try { return language === '' ? text.toLowerCase() : text.toLocaleLowerCase(language); } catch { return text.toLowerCase(); }
}

export function godotTextServerStringToTitle(textValue: unknown, languageValue = ''): string {
  const text = string(textValue, 'string_to_title.text'); const language = string(languageValue, 'string_to_title.language');
  return text.replace(/\p{Letter}[\p{Letter}\p{Mark}]*/gu, (word) => godotTextServerStringToUpper(word.slice(0, 1), language) + godotTextServerStringToLower(word.slice(1), language));
}

export function godotTextServerParseNumber(textValue: unknown, languageValue = ''): string {
  const text = string(textValue, 'parse_number.text'); string(languageValue, 'parse_number.language');
  const digits: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  return [...text].map((entry) => digits[entry] ?? entry).join('');
}

export function godotTextServerPercentSign(languageValue: unknown): string { return godotTextServerGetPercentSign(languageValue); }

export function godotTextServerParseStructuredText(parserValue: unknown, argsValue: unknown, textValue: unknown): Array<{ start: number; end: number; direction: number }> {
  const parser = integer(parserValue, 'parse_structured_text.parser', 0);
  if (!Array.isArray(argsValue)) throw new TypeError('TextServer.parse_structured_text args requires Array.');
  const text = string(textValue, 'parse_structured_text.text');
  if (parser === 0 || text.length === 0) return [{ start: 0, end: text.length, direction: 0 }];
  const result: Array<{ start: number; end: number; direction: number }> = [];
  const pattern = parser === 1 ? /\b(?:https?:\/\/|www\.)\S+/giu : parser === 2 ? /\S+@\S+/gu : /\S+/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? cursor;
    if (start > cursor) result.push({ start: cursor, end: start, direction: 0 });
    result.push({ start, end: start + match[0].length, direction: 1 });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) result.push({ start: cursor, end: text.length, direction: 0 });
  return result;
}

function fontOf(rid: GodotRid, member: string): GodotFontFile {
  const retained = godotResourceOfRid(rid);
  if (typeof retained !== 'object' || retained === null || !('data' in retained) || !('fallbacks' in retained)) {
    throw new TypeError(`TextServer.${member} RID requires retained FontFile.`);
  }
  return retained as GodotFontFile;
}

function integer(value: unknown, member: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`TextServer.${member} requires integer ${minimum}..${maximum}.`);
  }
  return value;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`TextServer.${member} requires finite number.`);
  return value;
}

function string(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`TextServer.${member} requires String.`);
  return value;
}

export function godotTextServerCreateFont(): GodotRid {
  return godotResourceGetRid(createGodotFontFile());
}

export function godotTextServerFontSetData(rid: GodotRid, data: Iterable<number>): void { setFontFileData(fontOf(rid, 'font_set_data'), data); }
export function godotTextServerFontGetData(rid: GodotRid): Uint8Array { return getFontFileData(fontOf(rid, 'font_get_data')); }
export function godotTextServerFontSetName(rid: GodotRid, value: unknown): void { setFontFileName(fontOf(rid, 'font_set_name'), string(value, 'font_set_name')); }
export function godotTextServerFontGetName(rid: GodotRid): string { return getFontFileName(fontOf(rid, 'font_get_name')); }
export function godotTextServerFontSetStyleName(rid: GodotRid, value: unknown): void { setGodotFontProperty(fontOf(rid, 'font_set_style_name'), 'styleName', string(value, 'font_set_style_name')); }
export function godotTextServerFontGetStyleName(rid: GodotRid): string { return fontOf(rid, 'font_get_style_name').styleName; }
export function godotTextServerFontSetStyle(rid: GodotRid, value: unknown): void { setGodotFontProperty(fontOf(rid, 'font_set_style'), 'fontStyle', integer(value, 'font_set_style', 0, 7)); }
export function godotTextServerFontGetStyle(rid: GodotRid): number { return fontOf(rid, 'font_get_style').fontStyle; }
export function godotTextServerFontSetWeight(rid: GodotRid, value: unknown): void { setGodotFontProperty(fontOf(rid, 'font_set_weight'), 'fontWeight', integer(value, 'font_set_weight', 100, 999)); }
export function godotTextServerFontGetWeight(rid: GodotRid): number { return fontOf(rid, 'font_get_weight').fontWeight; }
export function godotTextServerFontSetStretch(rid: GodotRid, value: unknown): void { setGodotFontProperty(fontOf(rid, 'font_set_stretch'), 'fontStretch', integer(value, 'font_set_stretch', 50, 200)); }
export function godotTextServerFontGetStretch(rid: GodotRid): number { return fontOf(rid, 'font_get_stretch').fontStretch; }

export function godotTextServerFontGetFaceCount(rid: GodotRid): number { return godotFontGetFaceCount(fontOf(rid, 'font_get_face_count')); }
export function godotTextServerFontGetOtNameStrings(rid: GodotRid): Record<string, Record<string, string>> { return godotFontGetOtNameStrings(fontOf(rid, 'font_get_ot_name_strings')); }
export function godotTextServerFontGetOpentypeFeatures(rid: GodotRid): Record<string, number> { return godotFontGetOpentypeFeatures(fontOf(rid, 'font_get_opentype_features')); }
export function godotTextServerFontGetSupportedFeatureList(rid: GodotRid): Record<string, number> { return godotFontGetSupportedFeatureList(fontOf(rid, 'font_get_supported_feature_list')); }
export function godotTextServerFontGetSupportedVariationList(rid: GodotRid): Record<string, { min_value: number; max_value: number; default_value: number }> { return godotFontGetSupportedVariationList(fontOf(rid, 'font_get_supported_variation_list')); }

export function godotTextServerFontGetHeight(rid: GodotRid, sizeValue: unknown): number { return godotFontHeight(fontOf(rid, 'font_get_height'), integer(sizeValue, 'font_get_height.size', 1)); }
export function godotTextServerFontGetAscent(rid: GodotRid, sizeValue: unknown): number { return godotFontAscent(fontOf(rid, 'font_get_ascent'), integer(sizeValue, 'font_get_ascent.size', 1)); }
export function godotTextServerFontGetDescent(rid: GodotRid, sizeValue: unknown): number { return godotFontDescent(fontOf(rid, 'font_get_descent'), integer(sizeValue, 'font_get_descent.size', 1)); }
export function godotTextServerFontGetUnderlinePosition(rid: GodotRid, sizeValue: unknown): number { return godotFontUnderlinePosition(fontOf(rid, 'font_get_underline_position'), integer(sizeValue, 'font_get_underline_position.size', 1)); }
export function godotTextServerFontGetUnderlineThickness(rid: GodotRid, sizeValue: unknown): number { return godotFontUnderlineThickness(fontOf(rid, 'font_get_underline_thickness'), integer(sizeValue, 'font_get_underline_thickness.size', 1)); }
export function godotTextServerFontGetScale(rid: GodotRid, sizeValue: unknown): number { return godotFontScale(fontOf(rid, 'font_get_scale'), integer(sizeValue, 'font_get_scale.size', 1)); }

export function godotTextServerFontGetGlyphIndex(rid: GodotRid, sizeValue: unknown, characterValue: unknown, variationSelectorValue = 0): number {
  return godotFontFileGetGlyphIndex(fontOf(rid, 'font_get_glyph_index'), integer(sizeValue, 'font_get_glyph_index.size', 1), integer(characterValue, 'font_get_glyph_index.char', 0, 0x10ffff), integer(variationSelectorValue, 'font_get_glyph_index.variation_selector', 0, 0x10ffff));
}
export function godotTextServerFontGetCharFromGlyphIndex(rid: GodotRid, sizeValue: unknown, glyphValue: unknown): number {
  return godotFontFileGetCharFromGlyphIndex(fontOf(rid, 'font_get_char_from_glyph_index'), integer(sizeValue, 'font_get_char_from_glyph_index.size', 1), integer(glyphValue, 'font_get_char_from_glyph_index.glyph', 0));
}
export function godotTextServerFontHasChar(rid: GodotRid, characterValue: unknown): boolean { return godotFontHasChar(fontOf(rid, 'font_has_char'), integer(characterValue, 'font_has_char.char', 0, 0x10ffff)); }
export function godotTextServerFontGetGlyphAdvance(rid: GodotRid, sizeValue: unknown, glyphValue: unknown): { x: number; y: number } {
  const font = fontOf(rid, 'font_get_glyph_advance');
  const size = integer(sizeValue, 'font_get_glyph_advance.size', 1);
  const glyph = integer(glyphValue, 'font_get_glyph_advance.glyph', 0);
  const advance = godotFontCharSize(font, glyph <= 0x10ffff ? glyph : 0, size);
  return { x: advance.x, y: 0 };
}

export function godotTextServerFontIsLanguageSupported(rid: GodotRid, languageValue: unknown): boolean {
  const language = string(languageValue, 'font_is_language_supported.language');
  const font = fontOf(rid, 'font_is_language_supported');
  const overrides = godotFontFileGetLanguageSupportOverrides(font);
  return overrides.includes(language) ? godotFontFileGetLanguageSupportOverride(font, language) : godotFontIsLanguageSupported(font, language);
}
export function godotTextServerFontSetLanguageSupportOverride(rid: GodotRid, languageValue: unknown, supported: unknown): void { godotFontFileSetLanguageSupportOverride(fontOf(rid, 'font_set_language_support_override'), string(languageValue, 'font_set_language_support_override.language'), Boolean(supported)); }
export function godotTextServerFontGetLanguageSupportOverride(rid: GodotRid, languageValue: unknown): boolean { return godotFontFileGetLanguageSupportOverride(fontOf(rid, 'font_get_language_support_override'), string(languageValue, 'font_get_language_support_override.language')); }
export function godotTextServerFontRemoveLanguageSupportOverride(rid: GodotRid, languageValue: unknown): void { godotFontFileRemoveLanguageSupportOverride(fontOf(rid, 'font_remove_language_support_override'), string(languageValue, 'font_remove_language_support_override.language')); }
export function godotTextServerFontGetLanguageSupportOverrides(rid: GodotRid): string[] { return godotFontFileGetLanguageSupportOverrides(fontOf(rid, 'font_get_language_support_overrides')); }

export function godotTextServerFontIsScriptSupported(rid: GodotRid, scriptValue: unknown): boolean {
  const script = string(scriptValue, 'font_is_script_supported.script');
  const font = fontOf(rid, 'font_is_script_supported');
  const overrides = godotFontFileGetScriptSupportOverrides(font);
  return overrides.includes(script) ? godotFontFileGetScriptSupportOverride(font, script) : godotFontIsScriptSupported(font, script);
}
export function godotTextServerFontSetScriptSupportOverride(rid: GodotRid, scriptValue: unknown, supported: unknown): void { godotFontFileSetScriptSupportOverride(fontOf(rid, 'font_set_script_support_override'), string(scriptValue, 'font_set_script_support_override.script'), Boolean(supported)); }
export function godotTextServerFontGetScriptSupportOverride(rid: GodotRid, scriptValue: unknown): boolean { return godotFontFileGetScriptSupportOverride(fontOf(rid, 'font_get_script_support_override'), string(scriptValue, 'font_get_script_support_override.script')); }
export function godotTextServerFontRemoveScriptSupportOverride(rid: GodotRid, scriptValue: unknown): void { godotFontFileRemoveScriptSupportOverride(fontOf(rid, 'font_remove_script_support_override'), string(scriptValue, 'font_remove_script_support_override.script')); }
export function godotTextServerFontGetScriptSupportOverrides(rid: GodotRid): string[] { return godotFontFileGetScriptSupportOverrides(fontOf(rid, 'font_get_script_support_overrides')); }

export function godotTextServerFontSetOpentypeFeatureOverrides(rid: GodotRid, overrides: unknown): void { godotFontFileSetOpentypeFeatureOverrides(fontOf(rid, 'font_set_opentype_feature_overrides'), overrides); }
export function godotTextServerFontGetOpentypeFeatureOverrides(rid: GodotRid): Record<string, number> { return godotFontFileGetOpentypeFeatureOverrides(fontOf(rid, 'font_get_opentype_feature_overrides')); }
export function godotTextServerFontSetOversampling(rid: GodotRid, value: unknown): void { setGodotFontProperty(fontOf(rid, 'font_set_oversampling'), 'oversampling', finite(value, 'font_set_oversampling')); }
export function godotTextServerFontGetOversampling(rid: GodotRid): number { return fontOf(rid, 'font_get_oversampling').oversampling; }
