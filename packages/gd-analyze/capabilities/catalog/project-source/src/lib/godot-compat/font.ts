/**
 * @godot-class Font
 * @role BINDING
 *
 * Godot 4.7's `Font` measurement (`scene/resources/font.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto fontkit reading the font file itself. Godot's
 * web export measures text with its own text server (`modules/text_server_adv`), so this module is
 * that server's arithmetic over the font's own tables, not the browser's:
 *
 * - The size's scale is FreeType's (`FT_Request_Size`, nominal, `size * 64` in 26.6):
 *   `x_scale = FT_DivFix(size * 64, units_per_EM)`. The ascent and descent are the face's
 *   (`OS/2` typo metrics when `USE_TYPO_METRICS` is set, else `hhea`, `sfobjs.c:1380`) scaled with
 *   `FT_MulFix` and grid-fitted outward (`FT_PIX_CEIL`, `FT_PIX_FLOOR`, `ftobjs.c:3177`), as
 *   `_ensure_cache_for_size` reads them (`text_server_adv.cpp:1658`).
 * - A glyph's advance is HarfBuzz's through FreeType with the default theme's light hinting (the
 *   unhinted path, `FT_Get_Advances` scaling by `FT_MulDiv(advance, x_scale, 64)`, then `hb_ft`'s
 *   `(v + 512) >> 10`), plus the GPOS adjustments HarfBuzz scales by `em_mult`. Shaping (ligatures,
 *   kerning, marks) is fontkit's OpenType layout of the same GSUB/GPOS tables; where it differs
 *   from HarfBuzz the difference is the recorded `font-shaping` deviation.
 * - Advances at sizes up to 20 are kept in 64ths (subpixel positioning, `text_server_adv.cpp:7339`);
 *   above, rounded to whole pixels carrying the remainder (`keep_rounding_remainders`).
 * - Line-break opportunities are Unicode's (UAX #14, the `linebreak` package) where Godot asks ICU;
 *   where ICU's rules differ the difference is the recorded `line-break` deviation.
 *
 * A font's native entity is `GodotFont`: the parsed face and its per-size metrics.
 */

import { create, type Font as Face } from 'fontkit';
// @ts-expect-error `linebreak` ships no type declarations; its surface is `LineBreaker` below.
import LineBreakerModule from 'linebreak';
import { construct as vector2, type Vector2 } from './vector2';

interface LineBreaker {
  nextBreak(): { readonly position: number; readonly required: boolean } | null;
}
const LineBreakerClass = LineBreakerModule as new (text: string) => LineBreaker;

interface SizeMetrics {
  /** `x_scale` in 16.16. */
  readonly xScale: number;
  /** HarfBuzz's `em_mult` for the x scale. */
  readonly hbMult: number;
  readonly ascent: number;
  readonly descent: number;
}

export interface GodotFont {
  readonly face: Face;
  readonly sizes: Map<number, SizeMetrics>;
}

/** `TextServer::GraphemeFlag` (`servers/text/text_server.h:144`). */
const GRAPHEME_IS_VIRTUAL = 1 << 2;
const GRAPHEME_IS_SPACE = 1 << 3;
const GRAPHEME_IS_BREAK_HARD = 1 << 4;
const GRAPHEME_IS_BREAK_SOFT = 1 << 5;
const GRAPHEME_IS_TAB = 1 << 6;
const GRAPHEME_IS_SOFT_HYPHEN = 1 << 13;

/** `TextServer::SUBPIXEL_POSITIONING_ONE_HALF_MAX_SIZE` (`servers/text/text_server.h:172`). */
const SUBPIXEL_MAX_SIZE = 20;

/** One glyph of shaped text, as `TextServer`'s `Glyph` (`servers/text/text_server.h:634`). */
export interface ShapedGlyph {
  readonly start: number;
  readonly end: number;
  readonly count: number;
  readonly index: number;
  readonly advance: number;
  readonly flags: number;
}

/** A shaped text's glyphs in logical order, its code points, and its font's ascent and descent. */
export interface ShapedText {
  readonly text: readonly number[];
  readonly glyphs: readonly ShapedGlyph[];
  readonly ascent: number;
  readonly descent: number;
}

/** `FT_MulFix` (`ftcalc.c:212`): `(a * b + 0x8000 + sign) >> 16`, in 64-bit integers. */
function mulFix(a: number, b: number): number {
  const ab = BigInt(a) * BigInt(b);
  return Number((ab + 0x8000n + (ab < 0n ? -1n : 0n)) >> 16n);
}

/** `FT_DivFix` (`ftcalc.c:233`): `((|a| << 16) + |b| / 2) / |b|`, signed. */
function divFix(a: number, b: number): number {
  const sign = Math.sign(a) * Math.sign(b) < 0 ? -1 : 1;
  const ua = BigInt(Math.abs(a));
  const ub = BigInt(Math.abs(b));
  return sign * Number(((ua << 16n) + (ub >> 1n)) / ub);
}

/** `FT_MulDiv` (`ftcalc.c:162`): `(|a| * |b| + |c| / 2) / |c|`, signed. */
function mulDiv(a: number, b: number, c: number): number {
  const sign = Math.sign(a) * Math.sign(b) * Math.sign(c) < 0 ? -1 : 1;
  const ua = BigInt(Math.abs(a));
  const ub = BigInt(Math.abs(b));
  const uc = BigInt(Math.abs(c));
  return sign * Number((ua * ub + (uc >> 1n)) / uc);
}

interface MetricsTables {
  readonly 'OS/2'?: {
    readonly version: number;
    readonly fsSelection: { readonly useTypoMetrics?: boolean };
    readonly typoAscender: number;
    readonly typoDescender: number;
    readonly winAscent: number;
    readonly winDescent: number;
  };
  readonly hhea: { readonly ascent: number; readonly descent: number };
}

/** The face's `ascender` and `descender` as FreeType's `sfnt` driver sets them (`sfobjs.c:1380`). */
function faceMetrics(face: Face): { readonly ascender: number; readonly descender: number } {
  const tables = face as unknown as MetricsTables;
  const os2 = tables['OS/2'];
  if (os2 !== undefined && os2.fsSelection.useTypoMetrics === true) return { ascender: os2.typoAscender, descender: os2.typoDescender };
  if (tables.hhea.ascent !== 0 || tables.hhea.descent !== 0 || os2 === undefined) return { ascender: tables.hhea.ascent, descender: tables.hhea.descent };
  if (os2.typoAscender !== 0 || os2.typoDescender !== 0) return { ascender: os2.typoAscender, descender: os2.typoDescender };
  return { ascender: os2.winAscent, descender: -os2.winDescent };
}

function metricsOf(font: GodotFont, size: number): SizeMetrics {
  let metrics = font.sizes.get(size);
  if (metrics === undefined) {
    const upem = font.face.unitsPerEm;
    const xScale = divFix(Math.min(2048, size) * 64, upem);
    const { ascender, descender } = faceMetrics(font.face);
    const hbScale = Number((BigInt(xScale) * BigInt(upem) + (1n << 15n)) >> 16n);
    metrics = {
      xScale,
      hbMult: Math.trunc((hbScale * 65536) / upem),
      // `FT_PIX_CEIL`, `FT_PIX_FLOOR` of the scaled values, in pixels.
      ascent: (Math.ceil(mulFix(ascender, xScale) / 64) * 64) / 64,
      descent: -((Math.floor(mulFix(descender, xScale) / 64) * 64) / 64),
    };
    font.sizes.set(size, metrics);
  }
  return metrics;
}

/**
 * A font of the file's bytes (a `FontFile`'s `data`).
 *
 * @godot Font (protocol)
 * @source scene/resources/font.cpp:2115
 */
export function godot_font_load(bytes: Uint8Array): GodotFont {
  const face = create(bytes as unknown as Buffer) as Face;
  return { face, sizes: new Map() };
}

let defaultFont: GodotFont | undefined;

/**
 * The default theme's font (`ThemeDB::fallback_font`): the host loads the bytes Godot embeds,
 * `thirdparty/fonts/OpenSans_SemiBold.woff2` at the pinned revision (shipped beside this module,
 * SHA-256 `55809808749613ed9ef9ad4f61424a14d2aa265d74369ad43403b9761aa6bac4`, with its licence),
 * before a scene that draws text mounts.
 *
 * @godot Font (protocol)
 * @source scene/theme/default_theme.cpp:1397
 */
export function godot_font_default(font?: GodotFont): GodotFont {
  if (font !== undefined) defaultFont = font;
  if (defaultFont === undefined) throw new Error('godot-compat: the default theme font is not loaded');
  return defaultFont;
}

/**
 * The URL of the default theme's font file beside this module, which the host fetches and hands to
 * `godot_font_load`, and registers with the page as the `godot-default-font` face the Label draws in.
 *
 * @godot Font (protocol)
 * @source scene/theme/SCsub:14
 */
export function godot_font_default_url(): string {
  return new URL('./OpenSans_SemiBold.woff2', import.meta.url).href;
}

/**
 * @godot Font.get_ascent
 * @source scene/resources/font.cpp:229
 */
export function get_ascent(self: GodotFont, p_font_size = 16): number {
  return metricsOf(self, p_font_size).ascent;
}

/**
 * @godot Font.get_descent
 * @source scene/resources/font.cpp:240
 */
export function get_descent(self: GodotFont, p_font_size = 16): number {
  return metricsOf(self, p_font_size).descent;
}

/**
 * The ascent plus the descent.
 *
 * @godot Font.get_height
 * @source scene/resources/font.cpp:217
 */
export function get_height(self: GodotFont, p_font_size = 16): number {
  const metrics = metricsOf(self, p_font_size);
  return metrics.ascent + metrics.descent;
}

/** `is_whitespace` (`core/string/char_utils.h:135`). */
function isWhitespace(c: number): boolean {
  return (
    c === 0x20 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200b) ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0x2028 ||
    c === 0x2029 ||
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x85
  );
}

/** `is_linebreak` (`core/string/char_utils.h:139`). */
function isLinebreak(c: number): boolean {
  return (c >= 0x0a && c <= 0x0d) || c === 0x85 || c === 0x2028 || c === 0x2029;
}

/**
 * Shapes `text` in `font` at `size` (`shaped_text_add_string`, `_shape_run`,
 * `text_server_adv.cpp:7185`) and marks its graphemes and break opportunities
 * (`_shaped_text_update_breaks`, `text_server_adv.cpp:6520`).
 *
 * @godot Font (protocol)
 * @source modules/text_server_adv/text_server_adv.cpp:7185
 */
export function godot_font_shape(font: GodotFont, text: string, size: number): ShapedText {
  const metrics = metricsOf(font, size);
  const codePoints = Array.from(text, (character) => character.codePointAt(0) as number);
  const run = font.face.layout(text);
  const subpos = size <= SUBPIXEL_MAX_SIZE;
  const glyphs: { start: number; end: number; count: number; index: number; advance: number; flags: number }[] = [];
  let cursor = 0;
  let remainder = 0;
  run.glyphs.forEach((glyph, index) => {
    const start = cursor;
    cursor += Math.max(1, glyph.codePoints.length);
    const c = codePoints[start] as number;
    const position = run.positions[index] as { readonly xAdvance: number };
    // A zero-width character, or a glyph the font does not have (HarfBuzz's glyph 0: a tab keeps it
    // with no advance, `text_server_adv.cpp:7376`), adds nothing. A missing visible character would
    // take a system font or a hex box on the web platform; that fallback is not bound.
    const zeroWidth = (c >= 0x200b && c <= 0x200d) || c === 0x2060 || c === 0xfeff || glyph.id === 0;
    if (c === 0x09 || isWhitespace(c) || isLinebreak(c)) remainder = 0;
    let advance = 0;
    if (!zeroWidth) {
      const hinted = (mulDiv(glyph.advanceWidth, metrics.xScale, 64) + 512) >> 10;
      const gpos = position.xAdvance - glyph.advanceWidth;
      const adjusted = hinted + Number((BigInt(gpos) * BigInt(metrics.hbMult) + 32768n) >> 16n);
      if (subpos) advance = adjusted / 64;
      else {
        const full = remainder + adjusted / 64;
        advance = Math.round(full);
        remainder = full - advance;
      }
    }
    glyphs.push({ start, end: 0, count: 1, index: zeroWidth ? 0 : glyph.id, advance, flags: 0 });
  });
  // Each glyph ends where the next cluster starts; the last at the text's end.
  glyphs.forEach((glyph, i) => {
    glyph.end = i + 1 < glyphs.length ? (glyphs[i + 1] as { start: number }).start : codePoints.length;
  });
  // Break opportunities, in code points.
  const breaks = new Map<number, boolean>();
  const units: number[] = [];
  let unit = 0;
  for (const cp of codePoints) {
    units.push(unit);
    unit += cp > 0xffff ? 2 : 1;
  }
  units.push(unit);
  const breaker = new LineBreakerClass(text);
  for (let bk = breaker.nextBreak(); bk !== null; bk = breaker.nextBreak()) {
    const pos = units.indexOf(bk.position);
    if (pos >= 0) breaks.set(pos, bk.required);
  }
  const marked: ShapedGlyph[] = [];
  for (const glyph of glyphs) {
    const c = codePoints[glyph.start] as number;
    let flags = 0;
    if (c === 0x09 || c === 0x0b) flags |= GRAPHEME_IS_TAB;
    if (c === 0xad) flags |= GRAPHEME_IS_SOFT_HYPHEN;
    if (isWhitespace(c)) flags |= GRAPHEME_IS_SPACE;
    let virtual: ShapedGlyph | undefined;
    const hard = breaks.get(glyph.end);
    if (hard !== undefined) {
      if (hard && isLinebreak(c)) flags |= GRAPHEME_IS_BREAK_HARD;
      else if (isWhitespace(c) || c === 0xad) flags |= GRAPHEME_IS_BREAK_SOFT;
      else if (glyph.end !== codePoints.length) {
        virtual = { start: glyph.start, end: glyph.end, count: 1, index: 0, advance: 0, flags: GRAPHEME_IS_BREAK_SOFT | GRAPHEME_IS_VIRTUAL | GRAPHEME_IS_SPACE };
      }
    }
    marked.push({ ...glyph, flags });
    if (virtual !== undefined) marked.push(virtual);
  }
  return { text: codePoints, glyphs: marked, ascent: metrics.ascent, descent: metrics.descent };
}

/**
 * The width of shaped glyphs (`sd->width`, the advances summed), unrounded.
 *
 * @godot Font (protocol)
 * @source modules/text_server_adv/text_server_adv.cpp:7786
 */
export function godot_font_width(glyphs: readonly ShapedGlyph[]): number {
  let width = 0;
  for (const glyph of glyphs) width += glyph.advance;
  return width;
}

/**
 * The glyphs of `[start, end)` (`shaped_text_substr` copying the glyphs inside the range,
 * `text_server_adv.cpp:5531`).
 *
 * @godot Font (protocol)
 * @source modules/text_server_adv/text_server_adv.cpp:5531
 */
export function godot_font_substr(shaped: ShapedText, start: number, end: number): ShapedText {
  return { ...shaped, glyphs: shaped.glyphs.filter((glyph) => glyph.start >= start && glyph.end <= end) };
}

/** `TextServer::LineBreakFlag` (`servers/text/text_server.h:105`). */
const BREAK_MANDATORY = 1 << 0;
const BREAK_WORD_BOUND = 1 << 1;
const BREAK_GRAPHEME_BOUND = 1 << 2;
const BREAK_ADAPTIVE = 1 << 3;
const BREAK_TRIM_START_EDGE_SPACES = 1 << 6;
const BREAK_TRIM_END_EDGE_SPACES = 1 << 7;

function has(flags: number, flag: number): boolean {
  return (flags & flag) === flag;
}

function edge(glyph: ShapedGlyph): boolean {
  return has(glyph.flags, GRAPHEME_IS_SPACE) || has(glyph.flags, GRAPHEME_IS_BREAK_HARD) || has(glyph.flags, GRAPHEME_IS_BREAK_SOFT);
}

/**
 * The line-break flags a Label passes for its autowrap mode (`Label::_shape`, `label.cpp:225`):
 * mandatory breaks, and word bounds (adaptively for `AUTOWRAP_WORD_SMART`) or grapheme bounds, with
 * the edge spaces trimmed.
 *
 * @godot Font (protocol)
 * @source scene/gui/label.cpp:225
 */
export function godot_font_autowrap_flags(autowrapMode: number): number {
  let flags = BREAK_MANDATORY;
  if (autowrapMode === 3) flags = BREAK_WORD_BOUND | BREAK_ADAPTIVE | BREAK_MANDATORY;
  else if (autowrapMode === 2) flags = BREAK_WORD_BOUND | BREAK_MANDATORY;
  else if (autowrapMode === 1) flags = BREAK_GRAPHEME_BOUND | BREAK_MANDATORY;
  return flags | BREAK_TRIM_START_EDGE_SPACES | BREAK_TRIM_END_EDGE_SPACES;
}

/**
 * Whether a glyph is whitespace (`GRAPHEME_IS_SPACE`).
 *
 * @godot Font (protocol)
 * @source servers/text/text_server.h:147
 */
export function godot_font_is_space(glyph: ShapedGlyph): boolean {
  return has(glyph.flags, GRAPHEME_IS_SPACE);
}

/**
 * `TextServer::shaped_text_get_line_breaks` (`servers/text/text_server.cpp:1034`) for left-to-right
 * text without indent trimming: the `[start, end)` pairs of each line fitting `width`.
 *
 * @godot Font (protocol)
 * @source servers/text/text_server.cpp:1034
 */
export function godot_font_line_breaks(shaped: ShapedText, p_width: number, p_break_flags: number): number[] {
  const lines: number[] = [];
  const gl = shaped.glyphs;
  const size = gl.length;
  const rangeEnd = shaped.text.length;
  let width = 0;
  let lineStart = 0;
  let lastEnd = lineStart;
  let prevSafeBreak = 0;
  let lastSafeBreak = -1;
  let wordCount = 0;
  let trimNext = false;
  const trimStart = has(p_break_flags, BREAK_TRIM_START_EDGE_SPACES);
  const trimEnd = has(p_break_flags, BREAK_TRIM_END_EDGE_SPACES);
  const lWidth = p_width;
  for (let i = 0; i < size; i += 1) {
    const g = gl[i] as ShapedGlyph;
    if (g.count > 0) {
      let adv = 0;
      for (let j = i; j < size && g.end === (gl[j] as ShapedGlyph).end && g.start === (gl[j] as ShapedGlyph).start; j += 1) adv = Math.fround(adv + (gl[j] as ShapedGlyph).advance);
      if (lWidth > 0 && width + adv > lWidth && lastSafeBreak >= 0) {
        let curSafeBrk = lastSafeBreak;
        if (trimStart || trimEnd) {
          let startPos = prevSafeBreak;
          let endPos = lastSafeBreak;
          while (trimStart && trimNext && startPos < endPos && !has((gl[startPos] as ShapedGlyph).flags, GRAPHEME_IS_SOFT_HYPHEN) && edge(gl[startPos] as ShapedGlyph)) {
            startPos += (gl[startPos] as ShapedGlyph).count;
          }
          while (trimEnd && startPos <= endPos && endPos > 0 && !has((gl[endPos] as ShapedGlyph).flags, GRAPHEME_IS_SOFT_HYPHEN) && edge(gl[endPos] as ShapedGlyph)) {
            endPos -= (gl[endPos] as ShapedGlyph).count;
          }
          if (lastEnd <= (gl[startPos] as ShapedGlyph).start && (gl[startPos] as ShapedGlyph).start !== (gl[endPos] as ShapedGlyph).end) {
            lines.push((gl[startPos] as ShapedGlyph).start, (gl[endPos] as ShapedGlyph).end);
            curSafeBrk = lastSafeBreak;
            lastEnd = (gl[endPos] as ShapedGlyph).end;
          }
          trimNext = true;
        } else if (lastEnd <= lineStart) {
          lines.push(lineStart, (gl[lastSafeBreak] as ShapedGlyph).end);
          lastEnd = (gl[lastSafeBreak] as ShapedGlyph).end;
        }
        lineStart = (gl[curSafeBrk] as ShapedGlyph).end;
        prevSafeBreak = curSafeBrk + 1;
        while (prevSafeBreak < size && (gl[prevSafeBreak] as ShapedGlyph).end === lineStart) prevSafeBreak += 1;
        i = curSafeBrk;
        lastSafeBreak = -1;
        width = 0;
        wordCount = 0;
        continue;
      }
      if (has(p_break_flags, BREAK_MANDATORY) && has(g.flags, GRAPHEME_IS_BREAK_HARD)) {
        let curSafeBrk = i;
        if (trimStart || trimEnd) {
          let startPos = prevSafeBreak;
          let endPos = i;
          while (trimStart && trimNext && startPos < endPos && edge(gl[startPos] as ShapedGlyph)) startPos += (gl[startPos] as ShapedGlyph).count;
          while (trimEnd && startPos <= endPos && endPos > 0 && edge(gl[endPos] as ShapedGlyph)) endPos -= (gl[endPos] as ShapedGlyph).count;
          trimNext = true;
          if (lastEnd <= (gl[startPos] as ShapedGlyph).start && (gl[startPos] as ShapedGlyph).start !== (gl[endPos] as ShapedGlyph).end) {
            lines.push((gl[startPos] as ShapedGlyph).start, (gl[endPos] as ShapedGlyph).end);
            lastEnd = g.end;
            curSafeBrk = i;
          }
        } else if (lastEnd <= lineStart) {
          lines.push(lineStart, g.end);
          lastEnd = g.end;
        }
        lineStart = (gl[curSafeBrk] as ShapedGlyph).end;
        prevSafeBreak = curSafeBrk + 1;
        while (prevSafeBreak < size && (gl[prevSafeBreak] as ShapedGlyph).end === lineStart) prevSafeBreak += 1;
        lastSafeBreak = -1;
        width = 0;
        continue;
      }
      if (has(p_break_flags, BREAK_WORD_BOUND)) {
        if (has(g.flags, GRAPHEME_IS_BREAK_SOFT) && !has(g.flags, GRAPHEME_IS_SOFT_HYPHEN)) {
          lastSafeBreak = i;
          wordCount += 1;
        }
        if (has(p_break_flags, BREAK_ADAPTIVE) && wordCount === 0) lastSafeBreak = i;
      }
      if (has(p_break_flags, BREAK_GRAPHEME_BOUND)) lastSafeBreak = i;
    }
    width += g.advance;
  }
  if (size > 0) {
    if (lines.length === 0 || ((lines[lines.length - 1] as number) < rangeEnd && prevSafeBreak < size)) {
      if (trimStart) {
        let startPos = prevSafeBreak < size ? prevSafeBreak : size - 1;
        if (lastEnd <= (gl[startPos] as ShapedGlyph).start) {
          const endPos = size - 1;
          while (trimNext && startPos < endPos && edge(gl[startPos] as ShapedGlyph)) startPos += (gl[startPos] as ShapedGlyph).count;
          lines.push((gl[startPos] as ShapedGlyph).start);
        } else {
          lines.push(lastEnd);
        }
      } else {
        lines.push(Math.max(lastEnd, lineStart));
      }
      lines.push(rangeEnd);
    }
  } else {
    lines.push(0, 0);
  }
  return lines;
}

/**
 * The size of a line of text with no width limit: its width and height rounded up
 * (`TextLine::get_size`, `shaped_text_get_size`, `text_server_adv.cpp:7786`). The alignment and
 * width fill (justify) a line only for `HORIZONTAL_ALIGNMENT_FILL`, which is not bound.
 *
 * @godot Font.get_string_size
 * @source scene/resources/font.cpp:319
 */
export function get_string_size(self: GodotFont, p_text: string, p_alignment = 0, p_width = -1, p_font_size = 16): Vector2 {
  const shaped = godot_font_shape(self, p_text, p_font_size);
  return vector2(Math.ceil(godot_font_width(shaped.glyphs)), Math.ceil(shaped.ascent + shaped.descent));
}
