/**
 * @godot-class Label
 * @role BINDING
 *
 * Godot 4.7's `Label` (`scene/gui/label.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * its text split into paragraphs at `\n`, each shaped in the font (`font.ts`, Godot's text-server
 * arithmetic over the font file) and broken into lines by the autowrap mode; its minimum size, line
 * count, line and character rectangles are Godot's (`_shape`, `_update_visible`,
 * `get_layout_data`, `_get_line_rect`). It is bound onto the page as SVG text: each line drawn by
 * the browser in the same font, its baseline where Godot puts it.
 *
 * The font is the default theme's (`font.ts`); `LabelSettings` gives the size, colours, spacing and
 * outline. Not bound: `uppercase`, visible characters, `max_lines_visible`, `lines_skipped`,
 * clipping and overrun trimming, tab stops, `HORIZONTAL_ALIGNMENT_FILL` justification and
 * right-to-left text.
 */

import type { Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import {
  get_size,
  get_theme_constant,
  godot_control_maximum_size,
  godot_control_mount,
  set_mouse_filter,
  set_v_size_flags,
  update_minimum_size,
} from './control';
import {
  get_height,
  godot_font_autowrap_flags,
  godot_font_is_space,
  godot_font_default,
  godot_font_line_breaks,
  godot_font_shape,
  godot_font_substr,
  godot_font_width,
  type ShapedText,
} from './font';
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

interface LabelState {
  text: string;
  settings: LabelSettings | null;
  horizontalAlignment: number;
  verticalAlignment: number;
  autowrapMode: number;
  readonly invalidate: () => void;
}

interface Paragraph {
  /** Where the paragraph starts in the text, in code points. */
  readonly start: number;
  readonly lines: readonly ShapedText[];
}

const LABELS = new WeakMap<Object3D, LabelState>();

function stateOf(self: object, member: string): LabelState {
  const state = LABELS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Label`);
  return state;
}

function fontSize(state: LabelState): number {
  return state.settings?.fontSize ?? 16;
}

function lineSpacing(entity: Object3D, state: LabelState): number {
  return Math.trunc(state.settings !== null ? state.settings.lineSpacing : get_theme_constant(entity, 'line_spacing'));
}

function paragraphSpacing(entity: Object3D, state: LabelState): number {
  return Math.trunc(state.settings !== null ? state.settings.paragraphSpacing : get_theme_constant(entity, 'paragraph_spacing'));
}

function fontHeight(state: LabelState): number {
  return Math.trunc(get_height(godot_font_default(), fontSize(state)));
}

/** A line's height as the Label spaces lines: its ascent and descent raised to the font height. */
function lineHeight(line: ShapedText, fontH: number): number {
  const sum = line.ascent + line.descent;
  return sum < fontH ? fontH : sum;
}

/** `_shape` (`label.cpp:144`): the paragraphs and their lines at the node's width. */
function shape(entity: Object3D, state: LabelState): Paragraph[] {
  let width = Math.trunc(get_size(entity).x);
  const maxWidth = godot_control_maximum_size(entity).x;
  if (state.autowrapMode !== AUTOWRAP_OFF && maxWidth > 0) width = Math.max(1, Math.trunc(maxWidth));
  const flags = godot_font_autowrap_flags(state.autowrapMode);
  const font = godot_font_default();
  const paragraphs: Paragraph[] = [];
  let start = 0;
  for (const part of state.text.split('\n')) {
    const shaped = godot_font_shape(font, `${part}​`, fontSize(state));
    const breaks = godot_font_line_breaks(shaped, width, flags);
    const lines: ShapedText[] = [];
    for (let i = 0; i < breaks.length; i += 2) lines.push(godot_font_substr(shaped, breaks[i] as number, breaks[i + 1] as number));
    paragraphs.push({ start, lines });
    start += Array.from(part).length + 1;
  }
  return paragraphs;
}

/** `shaped_text_get_size` of a line: its width rounded up. */
function lineWidth(line: ShapedText): number {
  return Math.ceil(godot_font_width(line.glyphs));
}

/**
 * `get_minimum_size` (`label.cpp:991`) after `_shape` and `_update_visible` (`label.cpp:366`): no
 * text is one line high; otherwise the widest line (1 when wrapping) and the lines' heights with
 * the line spacing between them and the paragraph spacing after each paragraph.
 */
function minimumSize(entity: Object3D): Vector2 {
  const state = LABELS.get(entity) as LabelState;
  const fontH = fontHeight(state);
  const paragraphs = shape(entity, state);
  let width = 1;
  let height = 0;
  if (state.text.length === 0) {
    height = fontH;
    for (const paragraph of paragraphs) for (const line of paragraph.lines) height = Math.max(height, Math.ceil(line.ascent + line.descent));
  } else {
    width = 0;
    for (const paragraph of paragraphs) for (const line of paragraph.lines) width = Math.max(width, lineWidth(line));
    const spacing = lineSpacing(entity, state);
    const paragraphGap = paragraphSpacing(entity, state);
    for (const paragraph of paragraphs) {
      for (const line of paragraph.lines) height += lineHeight(line, fontH) + spacing;
      height += paragraphGap;
    }
    if (height > 0) height -= spacing + paragraphGap;
  }
  height = Math.max(height, fontH);
  return state.autowrapMode !== AUTOWRAP_OFF ? vector2(1, height) : vector2(width, height);
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
    text: '',
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
    themeConstants: { line_spacing: 3, paragraph_spacing: 0 },
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
 * The settings; a change to them reshapes the text (`_invalidate`), which updates the minimum size
 * when next shaped (`label.cpp:364`).
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
 * The lines are broken again at the next shaping, which updates the minimum size.
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
  return shape(entity, state).reduce((count, paragraph) => count + paragraph.lines.length, 0);
}

/**
 * The height of line `p_line`, or with no line the tallest line and at least the font height.
 *
 * @godot Label.get_line_height
 * @source scene/gui/label.cpp:117
 */
export function get_line_height(self: object, p_line = -1): number {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'get_line_height');
  const fontH = fontHeight(state);
  const lines = shape(entity, state).flatMap((paragraph) => paragraph.lines);
  if (p_line >= 0 && p_line < lines.length) return Math.trunc(lineHeight(lines[p_line] as ShapedText, fontH));
  if (lines.length > 0) return lines.reduce((h, line) => Math.max(h, Math.ceil(line.ascent + line.descent)), fontH);
  return fontH;
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
  return layoutData(entity, state, shape(entity, state)).visible;
}

/**
 * `get_layout_data` (`label.cpp:538`): how many lines fit the height, and the first line's offset
 * and the spacing between lines by the vertical alignment.
 */
function layoutData(entity: Object3D, state: LabelState, paragraphs: readonly Paragraph[]): { readonly visible: number; readonly offsetY: number; readonly spacing: number } {
  const size = get_size(entity);
  const fontH = fontHeight(state);
  const spacing = lineSpacing(entity, state);
  const paragraphGap = paragraphSpacing(entity, state);
  let total = 0;
  let visible = 0;
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines) {
      total = Math.fround(total + lineHeight(line, fontH) + spacing);
      if (total > Math.ceil(size.y + spacing)) break;
      visible += 1;
    }
    total = Math.fround(total + paragraphGap);
  }
  total = 0;
  let index = 0;
  for (const paragraph of paragraphs) {
    const end = Math.min(paragraph.lines.length, visible - index);
    if (end <= 0) break;
    for (let i = 0; i < end; i += 1) total = Math.fround(total + lineHeight(paragraph.lines[i] as ShapedText, fontH) + spacing);
    total = Math.fround(total + paragraphGap);
    index += paragraph.lines.length;
  }
  let vbegin = 0;
  let vsep = 0;
  if (visible > 0) {
    const content = Math.fround(total - spacing - paragraphGap);
    if (state.verticalAlignment === ALIGNMENT_CENTER) vbegin = Math.trunc(Math.fround(Math.fround(size.y - content) / 2));
    else if (state.verticalAlignment === ALIGNMENT_END) vbegin = Math.trunc(Math.fround(size.y - content));
    else if (state.verticalAlignment === ALIGNMENT_FILL && visible > 1) vsep = Math.trunc(Math.fround(Math.fround(size.y - content) / (visible - 1)));
  }
  return { visible, offsetY: vbegin, spacing: spacing + vsep };
}

/** `_get_line_rect` (`label.cpp:488`): the line's offset by the horizontal alignment, and size. */
function lineRect(entity: Object3D, state: LabelState, line: ShapedText): Rect2 {
  const size = get_size(entity);
  const width = lineWidth(line);
  const height = lineHeight(line, fontHeight(state));
  let x = 0;
  if (state.horizontalAlignment === ALIGNMENT_CENTER) x = Math.trunc(Math.trunc(size.x - width) / 2);
  else if (state.horizontalAlignment === ALIGNMENT_END) x = Math.trunc(size.x - width);
  return rect2(x, 0, width, height);
}

/** Each visible line with its rectangle in the node: where it is drawn. */
function placedLines(entity: Object3D, state: LabelState): { readonly paragraph: Paragraph; readonly line: ShapedText; readonly rect: Rect2; readonly ascent: number }[] {
  const paragraphs = shape(entity, state);
  const { visible, offsetY, spacing } = layoutData(entity, state, paragraphs);
  const fontH = fontHeight(state);
  const placed: { readonly paragraph: Paragraph; readonly line: ShapedText; readonly rect: Rect2; readonly ascent: number }[] = [];
  let y = offsetY;
  let index = 0;
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines) {
      if (index >= visible) return placed;
      const rect = lineRect(entity, state, line);
      let ascent = line.ascent;
      if (line.ascent + line.descent < fontH) ascent += (fontH - (line.ascent + line.descent)) / 2;
      placed.push({ paragraph, line, rect: rect2(rect.position.x, y, rect.size.x, rect.size.y), ascent });
      y += lineHeight(line, fontH) + spacing;
      index += 1;
    }
    y += paragraphSpacing(entity, state);
  }
  return placed;
}

/**
 * The rectangle of the character at `p_pos`: its glyph's advance on its line, the line's height.
 *
 * @godot Label.get_character_bounds
 * @source scene/gui/label.cpp:927
 */
export function get_character_bounds(self: object, p_pos: number): Rect2 {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'get_character_bounds');
  for (const { paragraph, line, rect } of placedLines(entity, state)) {
    let offset = 0;
    const glyphs = line.glyphs;
    for (let j = 0; j < glyphs.length; j += 1) {
      const glyph = glyphs[j] as (typeof glyphs)[number];
      if (glyph.count > 0 && (glyph.index !== 0 || godot_font_is_space(glyph))) {
        if (p_pos >= glyph.start + paragraph.start && p_pos < glyph.end + paragraph.start) {
          let advance = 0;
          for (let k = 0; k < glyph.count; k += 1) advance = Math.fround(advance + (glyphs[j + k] as (typeof glyphs)[number]).advance);
          return rect2(Math.fround(rect.position.x + offset), rect.position.y, advance, rect.size.y);
        }
      }
      offset = Math.fround(offset + glyph.advance);
    }
  }
  return rect2();
}

const SVGS = new WeakMap<Object3D, SVGSVGElement>();

/** CSS `rgba()` of a Color. */
function css(color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): string {
  return `rgba(${String(Math.round(color.r * 255))}, ${String(Math.round(color.g * 255))}, ${String(Math.round(color.b * 255))}, ${String(color.a)})`;
}

/**
 * `NOTIFICATION_DRAW` on the page (`label.cpp:749`): an SVG over the node, each visible line a
 * `<text>` at the line's x and baseline (its top plus its ascent), in the default font at the
 * Label's size and colour; an outline is a stroke under the fill whose outer half is the outline
 * size over four (Godot's stroker radius, `text_server_adv.cpp:1512`), tinted by `self_modulate`.
 */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = LABELS.get(entity) as LabelState;
  const document = element.ownerDocument;
  const namespace = 'http://www.w3.org/2000/svg';
  let svg = SVGS.get(entity);
  if (svg === undefined) {
    svg = document.createElementNS(namespace, 'svg') as SVGSVGElement;
    svg.setAttribute('data-godot-content', '');
    svg.style.position = 'absolute';
    svg.style.left = '0px';
    svg.style.top = '0px';
    svg.style.overflow = 'visible';
    SVGS.set(entity, svg);
  }
  if (svg.parentElement !== element) element.insertBefore(svg, element.firstChild);
  const size = get_size(entity);
  svg.setAttribute('width', String(size.x));
  svg.setAttribute('height', String(size.y));
  svg.style.filter = godot_canvas_item_self_filter(entity, element);
  while (svg.firstChild !== null) svg.removeChild(svg.firstChild);
  const settings = state.settings;
  const color = settings?.fontColor ?? { r: 1, g: 1, b: 1, a: 1 };
  const outline = settings?.outlineSize ?? 0;
  const outlineColor = settings?.outlineColor ?? { r: 0, g: 0, b: 0, a: 1 };
  const codePoints = Array.from(state.text);
  for (const { paragraph, line, rect, ascent } of placedLines(entity, state)) {
    const first = line.glyphs[0];
    const last = line.glyphs[line.glyphs.length - 1];
    if (first === undefined || last === undefined) continue;
    const text = codePoints.slice(paragraph.start + first.start, paragraph.start + Math.min(last.end, codePoints.length - paragraph.start)).join('').replace(/​/g, '');
    const node = document.createElementNS(namespace, 'text');
    node.setAttribute('x', String(rect.position.x));
    node.setAttribute('y', String(rect.position.y + ascent));
    node.setAttribute('font-family', 'godot-default-font');
    node.setAttribute('font-size', String(fontSize(state)));
    node.setAttribute('fill', css(color));
    node.setAttribute('xml:space', 'preserve');
    if (outline > 0 && outlineColor.a > 0) {
      node.setAttribute('stroke', css(outlineColor));
      node.setAttribute('stroke-width', String(outline / 2));
      node.setAttribute('stroke-linejoin', 'round');
      node.setAttribute('paint-order', 'stroke');
    }
    node.textContent = text;
    svg.appendChild(node);
  }
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
