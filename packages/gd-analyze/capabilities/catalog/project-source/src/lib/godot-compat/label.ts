/**
 * @godot-class Label
 * @role BINDING
 *
 * Godot 4.7's `Label` (`scene/gui/label.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * bound onto DOM text: its text split into paragraphs at `\n`, each wrapped by the autowrap mode at
 * the node's width (`font.ts`, measured by the browser), and drawn as the node's element's content,
 * one line per row in the Label's CSS font, size, colour, outline (`-webkit-text-stroke`) and shadow
 * (`text-shadow`), aligned by `text-align` and a flex column. Its minimum size is its widest line by
 * its lines' heights with the line and paragraph spacing between them.
 *
 * The font is the settings' font file, else the node's theme font (its override, else the default
 * theme's, `label.cpp:118`), at the settings' size, else the theme's `font_size` (16); the colour is
 * the settings', else the theme's `font_color`. The text is split into paragraphs at the paragraph
 * separator, upper-cased by `uppercase` in the node's language, cut to the visible characters before
 * shaping (or, after shaping, drawn up to them); `lines_skipped` and `max_lines_visible` choose the
 * lines drawn, `clip_text` clips them to the node, and the overrun behaviour trims each line to the
 * width (by character or word, with the ellipsis character). The text direction is the CSS
 * `direction`, the language the element's `lang`.
 *
 * Kept and read back, not applied: tab stops (the page's tab width is uniform), the autowrap trim
 * and justification flags (the browser trims and justifies by its own rules), and the structured
 * text BiDi override.
 */

import type { Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import {
  get_size,
  get_theme_color,
  get_theme_constant,
  get_theme_font,
  get_theme_font_size,
  is_layout_rtl,
  godot_control_maximum_size,
  godot_control_mount,
  set_mouse_filter,
  set_v_size_flags,
  update_minimum_size,
} from './control';
import { get_height, godot_font_css, godot_font_default, godot_font_measure, godot_font_wrap, type GodotFont } from './font';
import { construct as color } from './color';
import type { LabelSettings } from './label-settings';
import { godot_node_entity, is_inside_tree } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { godot_control_props } from './control';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

/** `TextServer::AutowrapMode` (`servers/text/text_server.h:98`). */
const AUTOWRAP_OFF = 0;

/** `HorizontalAlignment`, `VerticalAlignment` (`core/math/math_defs.h:80`). */
const ALIGNMENT_BEGIN = 0;
const ALIGNMENT_CENTER = 1;
const ALIGNMENT_END = 2;
const ALIGNMENT_FILL = 3;

/** `Control::SIZE_SHRINK_CENTER` (`scene/gui/control.h:83`). */
const SIZE_SHRINK_CENTER = 4;

/** `TextServer::VisibleCharactersBehavior` (`servers/text/text_server.h:139`). */
const VC_CHARS_BEFORE_SHAPING = 0;

/** `TextServer::OverrunBehavior` (`servers/text/text_server.h:124`). */
const OVERRUN_NO_TRIMMING = 0;
const OVERRUN_TRIM_CHAR = 1;
const OVERRUN_TRIM_WORD = 2;
const OVERRUN_TRIM_ELLIPSIS = 3;
const OVERRUN_TRIM_WORD_ELLIPSIS = 4;

/** `Control::TextDirection` (`scene/gui/control.h:143`): auto, LTR, RTL, inherited. */
const TEXT_DIRECTION_AUTO = 0;
const TEXT_DIRECTION_LTR = 1;
const TEXT_DIRECTION_RTL = 2;

interface LabelState {
  readonly entity: Object3D;
  text: string;
  textDirection: number;
  language: string;
  paragraphSeparator: string;
  autowrapTrimFlags: number;
  justificationFlags: number;
  clipText: boolean;
  tabStops: number[];
  overrunBehavior: number;
  ellipsisChar: string;
  uppercase: boolean;
  visibleCharacters: number;
  visibleRatio: number;
  visibleCharactersBehavior: number;
  linesSkipped: number;
  maxLinesVisible: number;
  structuredTextBidiOverride: number;
  structuredTextBidiOverrideOptions: unknown[];
  settings: LabelSettings | null;
  horizontalAlignment: number;
  verticalAlignment: number;
  autowrapMode: number;
  readonly invalidate: () => void;
}

interface Line {
  readonly text: string;
  /** Where the line starts in the Label's text, in characters. */
  readonly start: number;
  /** Whether the line ends its paragraph. */
  readonly last: boolean;
}

const LABELS = new WeakMap<Object3D, LabelState>();

function stateOf(self: object, member: string): LabelState {
  const state = LABELS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Label`);
  return state;
}

/** The settings' font, else the theme's (`label.cpp:118`). */
function font(state: LabelState): GodotFont {
  return state.settings?.font ?? ((get_theme_font(state.entity, 'font') as GodotFont | null) ?? godot_font_default());
}

function fontSize(state: LabelState): number {
  return state.settings?.fontSize ?? get_theme_font_size(state.entity, 'font_size');
}

/** `String::c_unescape` of the separator: `\n`, `\t`, `\r`, `\\` and the quotes. */
function unescaped(text: string): string {
  const escapes: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v' };
  return text.replace(/\\(.)/gu, (whole, char: string) => escapes[char] ?? whole);
}

/**
 * The text `_shape` lays out (`label.cpp:170`): upper-cased in the node's language by `uppercase`,
 * and cut to the visible characters when they apply before shaping.
 */
function shapedText(state: LabelState): string {
  let text = state.uppercase ? state.text.toLocaleUpperCase(state.language === '' ? undefined : state.language) : state.text;
  if (state.visibleCharacters >= 0 && state.visibleCharactersBehavior === VC_CHARS_BEFORE_SHAPING) {
    text = Array.from(text).slice(0, state.visibleCharacters).join('');
  }
  return text;
}

function lineSpacing(entity: Object3D, state: LabelState): number {
  return Math.trunc(state.settings !== null ? state.settings.lineSpacing : get_theme_constant(entity, 'line_spacing'));
}

function paragraphSpacing(entity: Object3D, state: LabelState): number {
  return Math.trunc(state.settings !== null ? state.settings.paragraphSpacing : get_theme_constant(entity, 'paragraph_spacing'));
}

/** Every line's height: the font's, rounded up. */
function lineHeight(state: LabelState): number {
  return Math.ceil(get_height(font(state), fontSize(state)));
}

function measure(state: LabelState, text: string): number {
  return godot_font_measure(font(state), text, fontSize(state));
}

/** The lines of the text at the node's width (its maximum width when wrapping), paragraph by paragraph. */
function lines(entity: Object3D, state: LabelState): Line[] {
  let width = get_size(entity).x;
  const maxWidth = godot_control_maximum_size(entity).x;
  if (state.autowrapMode !== AUTOWRAP_OFF && maxWidth > 0) width = Math.max(1, maxWidth);
  const out: Line[] = [];
  let start = 0;
  const separator = unescaped(state.paragraphSeparator);
  const separatorLength = Array.from(separator).length;
  for (const paragraph of separator === '' ? [shapedText(state)] : shapedText(state).split(separator)) {
    const wrapped = state.autowrapMode === AUTOWRAP_OFF ? [paragraph] : godot_font_wrap(font(state), paragraph, fontSize(state), width, state.autowrapMode);
    let cursor = 0;
    wrapped.forEach((text, i) => {
      const at = Math.max(cursor, paragraph.indexOf(text, cursor));
      out.push({ text, start: start + Array.from(paragraph.slice(0, at)).length, last: i === wrapped.length - 1 });
      cursor = at + text.length;
    });
    start += Array.from(paragraph).length + separatorLength;
  }
  return out;
}

/** The lines from `lines_skipped` on, at most `max_lines_visible` of them (`_update_visible`, `label.cpp:366`). */
function shownLines(state: LabelState, all: readonly Line[]): Line[] {
  const shown = all.slice(state.linesSkipped);
  return state.maxLinesVisible >= 0 ? shown.slice(0, state.maxLinesVisible) : shown;
}

/** Whether lines may be cut to the node (`clip_text` or an overrun behaviour). */
function trims(state: LabelState): boolean {
  return state.clipText || state.overrunBehavior !== OVERRUN_NO_TRIMMING;
}

/**
 * The minimum size (`get_minimum_size`, `label.cpp:991`): the widest line (1 when wrapping, which
 * follows the width it is given) by the lines' heights with the spacing between them, at least one
 * line high.
 */
function minimumSize(entity: Object3D): Vector2 {
  const state = LABELS.get(entity) as LabelState;
  const lineH = lineHeight(state);
  const all = state.text.length === 0 ? [] : lines(entity, state);
  let width = 1;
  for (const line of all) width = Math.max(width, Math.ceil(measure(state, line.text)));
  let height = 0;
  const spacing = lineSpacing(entity, state);
  const paragraphGap = paragraphSpacing(entity, state);
  for (const line of shownLines(state, all)) height += lineH + spacing + (line.last ? paragraphGap : 0);
  if (height > 0) height -= spacing + paragraphGap;
  height = Math.max(height, lineH);
  if (state.autowrapMode !== AUTOWRAP_OFF) {
    if (!state.clipText && state.overrunBehavior !== OVERRUN_NO_TRIMMING && state.maxLinesVisible > 0) height = Math.min(height, (lineH + spacing) * state.maxLinesVisible);
    else if (trims(state)) height = 1;
    return vector2(1, height);
  }
  return vector2(trims(state) ? 1 : width, height);
}

/**
 * Makes `entity` a Label, a node of that class: vertically shrunk to its center in a container
 * (`Label::Label`, `label.cpp:1526`), with the default theme's Label constants
 * (`scene/theme/default_theme.cpp:392`).
 *
 * @godot Label (protocol)
 * @source scene/gui/label.cpp:1526
 */
export function godot_label_mount(entity: Object3D): void {
  const state: LabelState = {
    entity,
    text: '',
    textDirection: TEXT_DIRECTION_AUTO,
    language: '',
    paragraphSeparator: '\\n',
    autowrapTrimFlags: 128 | 256,
    justificationFlags: 1 | 2 | 32 | 64,
    clipText: false,
    tabStops: [],
    overrunBehavior: OVERRUN_NO_TRIMMING,
    ellipsisChar: '\u2026',
    uppercase: false,
    visibleCharacters: -1,
    visibleRatio: 1,
    visibleCharactersBehavior: VC_CHARS_BEFORE_SHAPING,
    linesSkipped: 0,
    maxLinesVisible: -1,
    structuredTextBidiOverride: 0,
    structuredTextBidiOverrideOptions: [],
    settings: null,
    horizontalAlignment: ALIGNMENT_BEGIN,
    verticalAlignment: ALIGNMENT_BEGIN,
    autowrapMode: AUTOWRAP_OFF,
    invalidate: () => update_minimum_size(entity),
  };
  LABELS.set(entity, state);
  godot_control_mount(entity, ['Label', 'Control', 'CanvasItem', 'Node'], {
    minimumSize,
    draw,
    drawKey: (node, element) => {
      const label = LABELS.get(node) as LabelState;
      const size = get_size(node);
      return JSON.stringify([
        label.text,
        label.settings,
        label.horizontalAlignment,
        label.verticalAlignment,
        label.autowrapMode,
        size.x,
        size.y,
        godot_canvas_item_self_filter(node, element),
        label.textDirection,
        label.textDirection === 3 ? is_layout_rtl(node) : false,
        label.language,
        label.paragraphSeparator,
        label.clipText,
        label.overrunBehavior,
        label.ellipsisChar,
        label.uppercase,
        label.visibleCharacters,
        label.visibleCharactersBehavior,
        label.linesSkipped,
        label.maxLinesVisible,
        get_theme_color(node, 'font_color'),
        fontSize(label),
        font(label),
      ]);
    },
    themeConstants: { line_spacing: 3, paragraph_spacing: 0 },
    themeColors: { font_color: color(1, 1, 1, 1) },
    themeFontSizes: { font_size: 16 },
  });
  // `set_mouse_filter(MOUSE_FILTER_IGNORE)` (`label.cpp:1529`).
  set_mouse_filter(entity, 2);
  set_v_size_flags(entity, SIZE_SHRINK_CENTER);
}

/**
 * The text; the minimum size is updated.
 *
 * @godot Label.set_text
 * @source scene/gui/label.cpp:1131
 */
export function set_text(self: object, p_string: string): void {
  const state = stateOf(self, 'set_text');
  if (state.text === p_string) return;
  state.text = p_string;
  update_minimum_size(self);
}

/**
 * @godot Label.get_text
 * @source scene/gui/label.cpp:1331
 */
export function get_text(self: object): string {
  return stateOf(self, 'get_text').text;
}

/**
 * The settings; a change to them updates the minimum size.
 *
 * @godot Label.set_label_settings
 * @source scene/gui/label.cpp:1168
 */
export function set_label_settings(self: object, p_settings: LabelSettings | null): void {
  const state = stateOf(self, 'set_label_settings');
  if (state.settings === p_settings) return;
  state.settings?.listeners.delete(state.invalidate);
  state.settings = p_settings;
  p_settings?.listeners.add(state.invalidate);
  state.invalidate();
}

/**
 * @godot Label.get_label_settings
 * @source scene/gui/label.cpp:1182
 */
export function get_label_settings(self: object): LabelSettings | null {
  return stateOf(self, 'get_label_settings').settings;
}

/**
 * An index outside the four alignments fails and is ignored.
 *
 * @godot Label.set_horizontal_alignment
 * @source scene/gui/label.cpp:1096
 */
export function set_horizontal_alignment(self: object, p_alignment: number): void {
  if (p_alignment < 0 || p_alignment > 3) return;
  stateOf(self, 'set_horizontal_alignment').horizontalAlignment = p_alignment;
}

/**
 * @godot Label.get_horizontal_alignment
 * @source scene/gui/label.cpp:1112
 */
export function get_horizontal_alignment(self: object): number {
  return stateOf(self, 'get_horizontal_alignment').horizontalAlignment;
}

/**
 * @godot Label.set_vertical_alignment
 * @source scene/gui/label.cpp:1116
 */
export function set_vertical_alignment(self: object, p_alignment: number): void {
  if (p_alignment < 0 || p_alignment > 3) return;
  stateOf(self, 'set_vertical_alignment').verticalAlignment = p_alignment;
}

/**
 * @godot Label.get_vertical_alignment
 * @source scene/gui/label.cpp:1127
 */
export function get_vertical_alignment(self: object): number {
  return stateOf(self, 'get_vertical_alignment').verticalAlignment;
}

/**
 * The lines are wrapped again, which updates the minimum size.
 *
 * @godot Label.set_autowrap_mode
 * @source scene/gui/label.cpp:41
 */
export function set_autowrap_mode(self: object, p_mode: number): void {
  const state = stateOf(self, 'set_autowrap_mode');
  if (state.autowrapMode === p_mode) return;
  state.autowrapMode = p_mode;
  update_minimum_size(self);
}

/**
 * @godot Label.get_autowrap_mode
 * @source scene/gui/label.cpp:59
 */
export function get_autowrap_mode(self: object): number {
  return stateOf(self, 'get_autowrap_mode').autowrapMode;
}

/**
 * Outside the tree 1; else the number of lines.
 *
 * @godot Label.get_line_count
 * @source scene/gui/label.cpp:1045
 */
export function get_line_count(self: object): number {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'get_line_count');
  if (!is_inside_tree(entity)) return 1;
  return lines(entity, state).length;
}

/**
 * The height of a line: the font's.
 *
 * @godot Label.get_line_height
 * @source scene/gui/label.cpp:117
 */
export function get_line_height(self: object, _p_line = -1): number {
  return lineHeight(stateOf(self, 'get_line_height'));
}

/** How many of the lines fit the node's height. */
function visibleCount(entity: Object3D, state: LabelState, all: readonly Line[]): number {
  const height = get_size(entity).y;
  const lineH = lineHeight(state);
  const spacing = lineSpacing(entity, state);
  const paragraphGap = paragraphSpacing(entity, state);
  let total = 0;
  let visible = 0;
  for (const line of all.slice(state.linesSkipped)) {
    if (state.maxLinesVisible >= 0 && visible >= state.maxLinesVisible) break;
    total += lineH + spacing;
    if (total > Math.ceil(height + spacing)) break;
    visible += 1;
    if (line.last) total += paragraphGap;
  }
  return visible;
}

/**
 * The lines that fit the node's height.
 *
 * @godot Label.get_visible_line_count
 * @source scene/gui/label.cpp:1054
 */
export function get_visible_line_count(self: object): number {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'get_visible_line_count');
  return visibleCount(entity, state, lines(entity, state));
}

/** Each visible line with its top in the node, by the vertical alignment. */
function placedLines(entity: Object3D, state: LabelState): { readonly line: Line; readonly top: number }[] {
  const all = lines(entity, state);
  const visible = all.slice(state.linesSkipped, state.linesSkipped + visibleCount(entity, state, all));
  const lineH = lineHeight(state);
  let spacing = lineSpacing(entity, state);
  const paragraphGap = paragraphSpacing(entity, state);
  let content = 0;
  for (const line of visible) content += lineH + spacing + (line.last ? paragraphGap : 0);
  content -= spacing + paragraphGap;
  const free = get_size(entity).y - content;
  let top = 0;
  if (state.verticalAlignment === ALIGNMENT_CENTER) top = Math.trunc(free / 2);
  else if (state.verticalAlignment === ALIGNMENT_END) top = Math.trunc(free);
  else if (state.verticalAlignment === ALIGNMENT_FILL && visible.length > 1) spacing += Math.trunc(free / (visible.length - 1));
  return visible.map((line) => {
    const placed = { line, top };
    top += lineH + spacing + (line.last ? paragraphGap : 0);
    return placed;
  });
}

/** Where a line of `width` starts by the horizontal alignment. */
function lineX(entity: Object3D, state: LabelState, width: number): number {
  const free = get_size(entity).x - width;
  if (state.horizontalAlignment === ALIGNMENT_CENTER) return Math.trunc(free / 2);
  if (state.horizontalAlignment === ALIGNMENT_END) return Math.trunc(free);
  return 0;
}

/**
 * The rectangle of the character at `p_pos`: its width on its line, the line's height.
 *
 * @godot Label.get_character_bounds
 * @source scene/gui/label.cpp:927
 */
export function get_character_bounds(self: object, p_pos: number): Rect2 {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'get_character_bounds');
  const lineH = lineHeight(state);
  for (const { line, top } of placedLines(entity, state)) {
    const characters = Array.from(line.text);
    const index = p_pos - line.start;
    if (index < 0 || index >= characters.length) continue;
    const x = lineX(entity, state, Math.ceil(measure(state, line.text)));
    const before = measure(state, characters.slice(0, index).join(''));
    return rect2(x + before, top, measure(state, characters[index] as string), lineH);
  }
  return rect2();
}

/** A setter that changes what is laid out: the minimum size is updated (the node redraws by its key). */
function relayout(self: object): void {
  update_minimum_size(self);
}

/**
 * `TEXT_DIRECTION_AUTO` (0), `LTR` (1), `RTL` (2) or `INHERITED` (3); another value fails.
 *
 * @godot Label.set_text_direction
 * @source scene/gui/label.cpp:1186
 */
export function set_text_direction(self: object, p_text_direction: number): void {
  if (p_text_direction < -1 || p_text_direction > 3) return;
  stateOf(self, 'set_text_direction').textDirection = p_text_direction;
}

/**
 * @godot Label.get_text_direction
 * @source scene/gui/label.cpp:1227
 */
export function get_text_direction(self: object): number {
  return stateOf(self, 'get_text_direction').textDirection;
}

/**
 * The language the text is shaped and upper-cased in (the element's `lang`).
 *
 * @godot Label.set_language
 * @source scene/gui/label.cpp:1231
 */
export function set_language(self: object, p_language: string): void {
  const state = stateOf(self, 'set_language');
  if (state.language === p_language) return;
  state.language = String(p_language);
  relayout(self);
}

/**
 * @godot Label.get_language
 * @source scene/gui/label.cpp:1241
 */
export function get_language(self: object): string {
  return stateOf(self, 'get_language').language;
}

/**
 * The separator (escaped, `c_unescape`d when used) the text splits into paragraphs at.
 *
 * @godot Label.set_paragraph_separator
 * @source scene/gui/label.cpp:1245
 */
export function set_paragraph_separator(self: object, p_paragraph_separator: string): void {
  const state = stateOf(self, 'set_paragraph_separator');
  if (state.paragraphSeparator === p_paragraph_separator) return;
  state.paragraphSeparator = String(p_paragraph_separator);
  relayout(self);
}

/**
 * @godot Label.get_paragraph_separator
 * @source scene/gui/label.cpp:1254
 */
export function get_paragraph_separator(self: object): string {
  return stateOf(self, 'get_paragraph_separator').paragraphSeparator;
}

/**
 * Kept to its trim bits (`BREAK_TRIM_MASK`) and read back (the module header).
 *
 * @godot Label.set_autowrap_trim_flags
 * @source scene/gui/label.cpp:63
 */
export function set_autowrap_trim_flags(self: object, p_flags: number): void {
  stateOf(self, 'set_autowrap_trim_flags').autowrapTrimFlags = p_flags & (128 | 256 | 512);
}

/**
 * @godot Label.get_autowrap_trim_flags
 * @source scene/gui/label.cpp:81
 */
export function get_autowrap_trim_flags(self: object): number {
  return stateOf(self, 'get_autowrap_trim_flags').autowrapTrimFlags;
}

/**
 * Kept and read back (the module header).
 *
 * @godot Label.set_justification_flags
 * @source scene/gui/label.cpp:85
 */
export function set_justification_flags(self: object, p_flags: number): void {
  stateOf(self, 'set_justification_flags').justificationFlags = p_flags;
}

/**
 * @godot Label.get_justification_flags
 * @source scene/gui/label.cpp:97
 */
export function get_justification_flags(self: object): number {
  return stateOf(self, 'get_justification_flags').justificationFlags;
}

/**
 * The text is clipped to the node, and its minimum size no longer holds the whole text.
 *
 * @godot Label.set_clip_text
 * @source scene/gui/label.cpp:1258
 */
export function set_clip_text(self: object, p_clip: boolean): void {
  const state = stateOf(self, 'set_clip_text');
  if (state.clipText === Boolean(p_clip)) return;
  state.clipText = Boolean(p_clip);
  relayout(self);
}

/**
 * @godot Label.is_clipping_text
 * @source scene/gui/label.cpp:1269
 */
export function is_clipping_text(self: object): boolean {
  return stateOf(self, 'is_clipping_text').clipText;
}

/**
 * Kept and read back (the module header).
 *
 * @godot Label.set_tab_stops
 * @source scene/gui/label.cpp:1273
 */
export function set_tab_stops(self: object, p_tab_stops: number[]): void {
  stateOf(self, 'set_tab_stops').tabStops = [...p_tab_stops];
}

/**
 * @godot Label.get_tab_stops
 * @source scene/gui/label.cpp:1283
 */
export function get_tab_stops(self: object): number[] {
  return [...stateOf(self, 'get_tab_stops').tabStops];
}

/**
 * How a line wider than the node is trimmed: `OVERRUN_NO_TRIMMING` (0), by character (1), by word
 * (2), with an ellipsis (3), by word with an ellipsis (4), or with the ellipsis forced (5, 6).
 *
 * @godot Label.set_text_overrun_behavior
 * @source scene/gui/label.cpp:1287
 */
export function set_text_overrun_behavior(self: object, p_behavior: number): void {
  const state = stateOf(self, 'set_text_overrun_behavior');
  if (state.overrunBehavior === p_behavior) return;
  state.overrunBehavior = p_behavior;
  relayout(self);
}

/**
 * @godot Label.get_text_overrun_behavior
 * @source scene/gui/label.cpp:1303
 */
export function get_text_overrun_behavior(self: object): number {
  return stateOf(self, 'get_text_overrun_behavior').overrunBehavior;
}

/**
 * One character; a longer string keeps its first.
 *
 * @godot Label.set_ellipsis_char
 * @source scene/gui/label.cpp:1307
 */
export function set_ellipsis_char(self: object, p_char: string): void {
  const state = stateOf(self, 'set_ellipsis_char');
  const char = Array.from(String(p_char)).slice(0, 1).join('');
  if (state.ellipsisChar === char) return;
  state.ellipsisChar = char;
  if (trims(state)) relayout(self);
}

/**
 * @godot Label.get_ellipsis_char
 * @source scene/gui/label.cpp:1327
 */
export function get_ellipsis_char(self: object): string {
  return stateOf(self, 'get_ellipsis_char').ellipsisChar;
}

/**
 * The text is shaped and drawn in upper case.
 *
 * @godot Label.set_uppercase
 * @source scene/gui/label.cpp:101
 */
export function set_uppercase(self: object, p_uppercase: boolean): void {
  const state = stateOf(self, 'set_uppercase');
  if (state.uppercase === Boolean(p_uppercase)) return;
  state.uppercase = Boolean(p_uppercase);
  relayout(self);
}

/**
 * @godot Label.is_uppercase
 * @source scene/gui/label.cpp:113
 */
export function is_uppercase(self: object): boolean {
  return stateOf(self, 'is_uppercase').uppercase;
}

/**
 * The text's length in characters.
 *
 * @godot Label.get_total_character_count
 * @source scene/gui/label.cpp:1425
 */
export function get_total_character_count(self: object): number {
  return Array.from(stateOf(self, 'get_total_character_count').text).length;
}

/**
 * How many characters show (-1 for all); the ratio follows.
 *
 * @godot Label.set_visible_characters
 * @source scene/gui/label.cpp:1335
 */
export function set_visible_characters(self: object, p_amount: number): void {
  const state = stateOf(self, 'set_visible_characters');
  if (state.visibleCharacters === p_amount) return;
  state.visibleCharacters = Math.trunc(p_amount);
  const total = get_total_character_count(self);
  state.visibleRatio = p_amount === -1 || total === 0 ? 1 : Math.fround(p_amount / total);
  if (state.visibleCharactersBehavior === VC_CHARS_BEFORE_SHAPING) relayout(self);
}

/**
 * @godot Label.get_visible_characters
 * @source scene/gui/label.cpp:1351
 */
export function get_visible_characters(self: object): number {
  return stateOf(self, 'get_visible_characters').visibleCharacters;
}

/**
 * The share of characters that show: 1 or more is all (-1), below 0 none.
 *
 * @godot Label.set_visible_ratio
 * @source scene/gui/label.cpp:1355
 */
export function set_visible_ratio(self: object, p_ratio: number): void {
  const state = stateOf(self, 'set_visible_ratio');
  const ratio = Math.fround(p_ratio);
  if (state.visibleRatio === ratio) return;
  if (ratio >= 1) {
    state.visibleCharacters = -1;
    state.visibleRatio = 1;
  } else if (ratio < 0) {
    state.visibleCharacters = 0;
    state.visibleRatio = 0;
  } else {
    state.visibleCharacters = Math.trunc(get_total_character_count(self) * ratio);
    state.visibleRatio = ratio;
  }
  if (state.visibleCharactersBehavior === VC_CHARS_BEFORE_SHAPING) relayout(self);
}

/**
 * @godot Label.get_visible_ratio
 * @source scene/gui/label.cpp:1376
 */
export function get_visible_ratio(self: object): number {
  return stateOf(self, 'get_visible_ratio').visibleRatio;
}

/**
 * `VC_CHARS_BEFORE_SHAPING` (0) cuts the text before it is laid out; the others lay out the whole
 * text and draw the visible characters.
 *
 * @godot Label.set_visible_characters_behavior
 * @source scene/gui/label.cpp:1384
 */
export function set_visible_characters_behavior(self: object, p_behavior: number): void {
  const state = stateOf(self, 'set_visible_characters_behavior');
  if (state.visibleCharactersBehavior === p_behavior) return;
  const relays = state.visibleCharactersBehavior === VC_CHARS_BEFORE_SHAPING || p_behavior === VC_CHARS_BEFORE_SHAPING;
  state.visibleCharactersBehavior = p_behavior;
  if (relays) relayout(self);
}

/**
 * @godot Label.get_visible_characters_behavior
 * @source scene/gui/label.cpp:1380
 */
export function get_visible_characters_behavior(self: object): number {
  return stateOf(self, 'get_visible_characters_behavior').visibleCharactersBehavior;
}

/**
 * The lines drawn start after this many; a negative count fails.
 *
 * @godot Label.set_lines_skipped
 * @source scene/gui/label.cpp:1395
 */
export function set_lines_skipped(self: object, p_lines: number): void {
  if (p_lines < 0) return;
  const state = stateOf(self, 'set_lines_skipped');
  if (state.linesSkipped === p_lines) return;
  state.linesSkipped = Math.trunc(p_lines);
  relayout(self);
}

/**
 * @godot Label.get_lines_skipped
 * @source scene/gui/label.cpp:1407
 */
export function get_lines_skipped(self: object): number {
  return stateOf(self, 'get_lines_skipped').linesSkipped;
}

/**
 * At most this many lines are drawn (-1 for no limit).
 *
 * @godot Label.set_max_lines_visible
 * @source scene/gui/label.cpp:1411
 */
export function set_max_lines_visible(self: object, p_lines: number): void {
  const state = stateOf(self, 'set_max_lines_visible');
  if (state.maxLinesVisible === p_lines) return;
  state.maxLinesVisible = Math.trunc(p_lines);
  relayout(self);
}

/**
 * @godot Label.get_max_lines_visible
 * @source scene/gui/label.cpp:1421
 */
export function get_max_lines_visible(self: object): number {
  return stateOf(self, 'get_max_lines_visible').maxLinesVisible;
}

/**
 * Kept and read back (the module header).
 *
 * @godot Label.set_structured_text_bidi_override
 * @source scene/gui/label.cpp:1197
 */
export function set_structured_text_bidi_override(self: object, p_parser: number): void {
  stateOf(self, 'set_structured_text_bidi_override').structuredTextBidiOverride = p_parser;
}

/**
 * @godot Label.get_structured_text_bidi_override
 * @source scene/gui/label.cpp:1207
 */
export function get_structured_text_bidi_override(self: object): number {
  return stateOf(self, 'get_structured_text_bidi_override').structuredTextBidiOverride;
}

/**
 * Kept (a copy of the array) and read back.
 *
 * @godot Label.set_structured_text_bidi_override_options
 * @source scene/gui/label.cpp:1211
 */
export function set_structured_text_bidi_override_options(self: object, p_args: unknown[]): void {
  stateOf(self, 'set_structured_text_bidi_override_options').structuredTextBidiOverrideOptions = [...p_args];
}

/**
 * @godot Label.get_structured_text_bidi_override_options
 * @source scene/gui/label.cpp:1223
 */
export function get_structured_text_bidi_override_options(self: object): unknown[] {
  return [...stateOf(self, 'get_structured_text_bidi_override_options').structuredTextBidiOverrideOptions];
}

const CONTENT = new WeakMap<Object3D, HTMLDivElement>();

/** CSS `rgba()` of a Color. */
function css(color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): string {
  return `rgba(${String(Math.round(color.r * 255))}, ${String(Math.round(color.g * 255))}, ${String(Math.round(color.b * 255))}, ${String(color.a)})`;
}

const TEXT_ALIGN = ['left', 'center', 'right', 'justify'] as const;

/**
 * `NOTIFICATION_DRAW` (`label.cpp:749`) on the page: a box over the node holding each visible line
 * as a row at its top, aligned by `text-align`, in the Label's font, size and colour; an outline is
 * a text stroke painted under the fill, a shadow a `text-shadow`; tinted by `self_modulate`.
 */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = LABELS.get(entity) as LabelState;
  let box = CONTENT.get(entity);
  if (box === undefined) {
    box = element.ownerDocument.createElement('div');
    box.setAttribute('data-godot-content', '');
    box.style.position = 'absolute';
    box.style.left = '0px';
    box.style.top = '0px';
    box.style.whiteSpace = 'pre';
    CONTENT.set(entity, box);
  }
  if (box.parentElement !== element) element.insertBefore(box, element.firstChild);
  const size = get_size(entity);
  const settings = state.settings;
  const lineH = lineHeight(state);
  box.style.width = `${String(size.x)}px`;
  box.style.height = `${String(size.y)}px`;
  box.style.font = godot_font_css(font(state), fontSize(state));
  box.style.lineHeight = `${String(lineH)}px`;
  box.style.color = css(settings?.fontColor ?? get_theme_color(entity, 'font_color'));
  box.style.overflow = state.clipText ? 'hidden' : '';
  box.lang = state.language;
  const rtl = state.textDirection === TEXT_DIRECTION_RTL || (state.textDirection === 3 && is_layout_rtl(entity));
  box.style.direction = state.textDirection === TEXT_DIRECTION_LTR ? 'ltr' : rtl ? 'rtl' : '';
  box.style.unicodeBidi = state.textDirection === TEXT_DIRECTION_AUTO ? 'plaintext' : '';
  box.style.textAlign = TEXT_ALIGN[state.horizontalAlignment] ?? 'left';
  box.style.setProperty('text-align-last', state.horizontalAlignment === ALIGNMENT_FILL ? 'justify' : '');
  box.style.filter = godot_canvas_item_self_filter(entity, element);
  const outline = settings?.outlineSize ?? 0;
  const outlineColor = settings?.outlineColor ?? { r: 1, g: 1, b: 1, a: 1 };
  const stroke = outline > 0 && outlineColor.a > 0;
  box.style.setProperty('-webkit-text-stroke', stroke ? `${String(outline / 2)}px ${css(outlineColor)}` : '');
  box.style.setProperty('paint-order', stroke ? 'stroke fill' : '');
  const shadow = settings?.shadowColor;
  box.style.textShadow =
    settings !== null && shadow !== undefined && shadow.a > 0
      ? `${String(settings.shadowOffset.x)}px ${String(settings.shadowOffset.y)}px ${String(Math.max(0, settings.shadowSize - 1))}px ${css(shadow)}`
      : '';
  // Visible characters counted after shaping draw the text up to them; the rest keeps its place.
  const shown = state.visibleCharacters >= 0 && state.visibleCharactersBehavior !== VC_CHARS_BEFORE_SHAPING ? state.visibleCharacters : Number.POSITIVE_INFINITY;
  box.replaceChildren(
    ...placedLines(entity, state).map(({ line, top }) => {
      const row = element.ownerDocument.createElement('div');
      row.style.position = 'absolute';
      row.style.left = '0px';
      row.style.right = '0px';
      row.style.top = `${String(top)}px`;
      const text = overrun(state, line.text, size.x);
      const characters = Array.from(text);
      const count = Math.max(0, Math.min(characters.length, shown - line.start));
      if (count >= characters.length) {
        row.textContent = text;
      } else {
        const hidden = element.ownerDocument.createElement('span');
        hidden.style.visibility = 'hidden';
        hidden.textContent = characters.slice(count).join('');
        row.replaceChildren(characters.slice(0, count).join(''), hidden);
      }
      return row;
    }),
  );
}

/**
 * A line trimmed to `width` by the overrun behaviour (`TextServer::shaped_text_overrun_trim_to_width`):
 * characters, or whole words, dropped from the end, and the ellipsis character added for the
 * ellipsis modes; a line that fits is kept.
 */
function overrun(state: LabelState, text: string, width: number): string {
  const behavior = state.overrunBehavior;
  if (behavior === OVERRUN_NO_TRIMMING || measure(state, text) <= width) return text;
  const ellipsis = behavior === OVERRUN_TRIM_ELLIPSIS || behavior === OVERRUN_TRIM_WORD_ELLIPSIS || behavior > OVERRUN_TRIM_WORD_ELLIPSIS ? state.ellipsisChar : '';
  const byWord = behavior === OVERRUN_TRIM_WORD || behavior === OVERRUN_TRIM_WORD_ELLIPSIS || behavior === 6;
  let characters = Array.from(text);
  while (characters.length > 0) {
    if (byWord) {
      const cut = characters.lastIndexOf(' ');
      characters = cut <= 0 ? [] : characters.slice(0, cut);
    } else {
      characters = characters.slice(0, -1);
    }
    const trimmed = characters.join('').trimEnd() + ellipsis;
    if (measure(state, trimmed) <= width) return trimmed;
  }
  return behavior === OVERRUN_TRIM_CHAR || behavior === OVERRUN_TRIM_WORD ? '' : ellipsis;
}

const LABEL = {
  create: () => new Group(),
  classes: ['Label', 'Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_label_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['text', (entity, value: string) => set_text(entity, value)],
    ['labelSettings', (entity, value: LabelSettings | null) => set_label_settings(entity, value)],
    ['horizontalAlignment', (entity, value: number) => set_horizontal_alignment(entity, value)],
    ['verticalAlignment', (entity, value: number) => set_vertical_alignment(entity, value)],
    ['autowrapMode', (entity, value: number) => set_autowrap_mode(entity, value)],
  ]),
};

/**
 * A Label as a scene writes it: `<GodotLabel text="Score: 12" horizontalAlignment={1} />`.
 *
 * @godot Label (protocol)
 * @source scene/gui/label.cpp:1481
 */
export function GodotLabel(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(LABEL, props);
}
