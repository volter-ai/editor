/**
 * @godot-class Font
 * @role BINDING
 *
 * Godot 4.7's `Font` (`scene/resources/font.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the browser's fonts: a font is a CSS font
 * family the page has registered as a `FontFace` (the default theme's, and each imported
 * `FontFile`'s), measured with a 2D canvas context's `measureText` and drawn by the browser (a
 * Label's DOM text, a Label3D's canvas). Where the page has no canvas to measure with (a headless
 * DOM), text is measured as an em box: half an em per character, an ascent of 0.8 em and a descent
 * of 0.2 em.
 *
 * A font's native entity is a `GodotFont`: its CSS family.
 */

import { construct as vector2, type Vector2 } from './vector2';

export interface GodotFont {
  /** The page's font family the font is registered as. */
  readonly family: string;
}

/** The default theme's font, registered with the page by the host (`godot_font_register`). */
const DEFAULT_FONT: GodotFont = { family: 'godot-default-font' };

/**
 * The default theme's font (`ThemeDB::fallback_font`): Godot's embedded Open Sans SemiBold
 * (`thirdparty/fonts/OpenSans_SemiBold.woff2`, shipped beside this module with its licence), which
 * the host registers with the page before a scene that draws text mounts.
 *
 * @godot Font (protocol)
 * @source scene/theme/default_theme.cpp:1397
 */
export function godot_font_default(): GodotFont {
  return DEFAULT_FONT;
}

/**
 * The URL of the default theme's font file beside this module, which the host registers.
 *
 * @godot Font (protocol)
 * @source scene/theme/SCsub:14
 */
export function godot_font_default_url(): string {
  return new URL('./OpenSans_SemiBold.woff2', import.meta.url).href;
}

/**
 * Registers the font file at `url` with the page as `font`'s family (a loaded `FontFace` added to
 * `document.fonts`), so text measured and drawn in it uses it. A page without `FontFace` keeps its
 * fallback font.
 *
 * @godot Font (protocol)
 * @source scene/resources/font.cpp:2115
 */
export async function godot_font_register(font: GodotFont, url: string): Promise<void> {
  const page = (globalThis as { readonly document?: Document }).document;
  if (page?.fonts === undefined || typeof FontFace !== 'function') return;
  const bytes = await (await fetch(url)).arrayBuffer();
  page.fonts.add(await new FontFace(font.family, bytes).load());
}

/**
 * The CSS `font` shorthand of `font` at `size` pixels.
 *
 * @godot Font (protocol)
 * @source scene/resources/font.cpp:319
 */
export function godot_font_css(font: GodotFont, size: number): string {
  return `${String(size)}px "${font.family}", sans-serif`;
}

let measurer: OffscreenCanvasRenderingContext2D | null | undefined;

/** A 2D context to measure with, or null where the page has none. */
function context(): OffscreenCanvasRenderingContext2D | null {
  if (measurer === undefined) measurer = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  return measurer;
}

/**
 * The width of `text` in `font` at `size`, as the browser lays it out.
 *
 * @godot Font (protocol)
 * @source scene/resources/font.cpp:319
 */
export function godot_font_measure(font: GodotFont, text: string, size: number): number {
  const ctx = context();
  if (ctx === null) return Array.from(text).length * size * 0.5;
  ctx.font = godot_font_css(font, size);
  return ctx.measureText(text).width;
}

/** The font's ascent and descent at `size`, as the browser reports them. */
function metrics(font: GodotFont, size: number): { readonly ascent: number; readonly descent: number } {
  const ctx = context();
  if (ctx !== null) {
    ctx.font = godot_font_css(font, size);
    const measured = ctx.measureText('');
    if (typeof measured.fontBoundingBoxAscent === 'number') return { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent };
  }
  return { ascent: size * 0.8, descent: size * 0.2 };
}

/**
 * The height above the baseline.
 *
 * @godot Font.get_ascent
 * @source scene/resources/font.cpp:229
 */
export function get_ascent(self: GodotFont, p_font_size = 16): number {
  return metrics(self, p_font_size).ascent;
}

/**
 * The depth below the baseline.
 *
 * @godot Font.get_descent
 * @source scene/resources/font.cpp:240
 */
export function get_descent(self: GodotFont, p_font_size = 16): number {
  return metrics(self, p_font_size).descent;
}

/**
 * The ascent plus the descent: the height of a line.
 *
 * @godot Font.get_height
 * @source scene/resources/font.cpp:217
 */
export function get_height(self: GodotFont, p_font_size = 16): number {
  const { ascent, descent } = metrics(self, p_font_size);
  return ascent + descent;
}

/** `TextServer::AutowrapMode` (`servers/text/text_server.h:98`). */
const AUTOWRAP_ARBITRARY = 1;
const AUTOWRAP_WORD = 2;
const AUTOWRAP_WORD_SMART = 3;

/** Breaks `text` into pieces of whole characters, each as wide as fits `width` (at least one character). */
function breakCharacters(font: GodotFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(text)) {
    if (line.length > 0 && godot_font_measure(font, line + character, size) > width) {
      lines.push(line);
      line = '';
    }
    line += character;
  }
  lines.push(line);
  return lines;
}

/**
 * A paragraph's lines at `width` by the autowrap mode (`TextServer::AutowrapMode`): off keeps the
 * paragraph one line; arbitrary breaks between any characters; word breaks between words, a word
 * wider than the width kept whole; word (smart) breaks such a word between its characters. The
 * spaces a line breaks at are dropped from its ends.
 *
 * @godot Font (protocol)
 * @source servers/text/text_server.h:98
 */
export function godot_font_wrap(font: GodotFont, paragraph: string, size: number, width: number, autowrapMode: number): string[] {
  if (width <= 0 || godot_font_measure(font, paragraph, size) <= width) return [paragraph];
  if (autowrapMode === AUTOWRAP_ARBITRARY) return breakCharacters(font, paragraph, size, width).map((line) => line.trim());
  if (autowrapMode !== AUTOWRAP_WORD && autowrapMode !== AUTOWRAP_WORD_SMART) return [paragraph];
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/\s+/u).filter((part) => part.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (godot_font_measure(font, candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    if (autowrapMode === AUTOWRAP_WORD_SMART && godot_font_measure(font, word, size) > width) {
      const pieces = breakCharacters(font, word, size, width);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    } else {
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * The size of `p_text` on one line: its width and its line height, rounded up. A positive
 * `p_width` with `HORIZONTAL_ALIGNMENT_FILL` stretches the line to that width.
 *
 * @godot Font.get_string_size
 * @source scene/resources/font.cpp:319
 */
export function get_string_size(self: GodotFont, p_text: string, p_alignment = 0, p_width = -1, p_font_size = 16): Vector2 {
  const width = p_alignment === 3 && p_width > 0 ? p_width : godot_font_measure(self, p_text, p_font_size);
  return vector2(Math.ceil(width), Math.ceil(get_height(self, p_font_size)));
}

