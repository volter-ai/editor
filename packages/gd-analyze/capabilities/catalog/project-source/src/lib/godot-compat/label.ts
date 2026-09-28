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
 * The font is the settings' font file, else the default theme's (`label.cpp:118`), at the settings'
 * size, else the default theme's 16. Not bound: `uppercase`, visible characters,
 * `max_lines_visible`, `lines_skipped`, clipping and overrun trimming, tab stops and right-to-left
 * text.
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
import { get_height, godot_font_css, godot_font_default, godot_font_measure, godot_font_wrap, type GodotFont } from './font';
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
  return state.settings?.font ?? godot_font_default();
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
  for (const paragraph of state.text.split('\n')) {
    const wrapped = state.autowrapMode === AUTOWRAP_OFF ? [paragraph] : godot_font_wrap(font(state), paragraph, fontSize(state), width, state.autowrapMode);
    let cursor = 0;
    wrapped.forEach((text, i) => {
      const at = Math.max(cursor, paragraph.indexOf(text, cursor));
      out.push({ text, start: start + Array.from(paragraph.slice(0, at)).length, last: i === wrapped.length - 1 });
      cursor = at + text.length;
    });
    start += Array.from(paragraph).length + 1;
  }
  return out;
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
  for (const line of all) height += lineH + spacing + (line.last ? paragraphGap : 0);
  if (height > 0) height -= spacing + paragraphGap;
  height = Math.max(height, lineH);
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
    drawKey: (node, element) => {
      const label = LABELS.get(node) as LabelState;
      const size = get_size(node);
      return JSON.stringify([label.text, label.settings, label.horizontalAlignment, label.verticalAlignment, label.autowrapMode, size.x, size.y, godot_canvas_item_self_filter(node, element)]);
    },
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
  for (const line of all) {
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
  const visible = all.slice(0, visibleCount(entity, state, all));
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
  box.style.color = css(settings?.fontColor ?? { r: 1, g: 1, b: 1, a: 1 });
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
  box.replaceChildren(
    ...placedLines(entity, state).map(({ line, top }) => {
      const row = element.ownerDocument.createElement('div');
      row.style.position = 'absolute';
      row.style.left = '0px';
      row.style.right = '0px';
      row.style.top = `${String(top)}px`;
      row.textContent = line.text;
      return row;
    }),
  );
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
