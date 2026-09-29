/**
 * @godot-class RichTextLabel
 * @role BINDING
 *
 * Godot 4.7's `RichTextLabel` (`scene/gui/rich_text_label.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): text in its theme's `normal_font` at
 * `normal_font_size` and `default_color`, wrapped at its width (`autowrap_mode`, word-smart by
 * default), drawn in the node's element. With `fit_content` its minimum height is its text's.
 * Kept and read back, not drawn: `scroll_active` (overflowing text is clipped, without a scroll
 * bar).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { type Color, construct as color } from './color';
import { get_size, get_theme_color, get_theme_font, get_theme_font_size, godot_control_mount, godot_control_props, update_minimum_size } from './control';
import { godot_font_css, godot_font_default, type GodotFont } from './font';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector2, type Vector2 } from './vector2';

/** `TextServer::AutowrapMode` (`servers/text/text_server.h:98`): off, arbitrary, word, word-smart. */
const AUTOWRAP_OFF = 0;
const AUTOWRAP_ARBITRARY = 1;
const AUTOWRAP_WORD_SMART = 3;

interface RichTextLabelState {
  text: string;
  fitContent: boolean;
  autowrapMode: number;
  scrollActive: boolean;
  /** The text's height as the page last laid it out, which `fit_content` makes the minimum. */
  contentHeight: number;
}

const LABELS = new WeakMap<object, RichTextLabelState>();
const CONTENTS = new WeakMap<Object3D, HTMLElement>();

function stateOf(self: object, member: string): RichTextLabelState {
  const state = LABELS.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: RichTextLabel.${member} requires a RichTextLabel.`);
  return state;
}

const css = (c: Color): string => `rgba(${String(Math.round(Math.min(Math.max(c.r, 0), 1) * 255))}, ${String(Math.round(Math.min(Math.max(c.g, 0), 1) * 255))}, ${String(Math.round(Math.min(Math.max(c.b, 0), 1) * 255))}, ${String(c.a)})`;

function fontOf(entity: Object3D): GodotFont {
  return (get_theme_font(entity, 'normal_font') as GodotFont | null) ?? godot_font_default();
}

/** `NOTIFICATION_DRAW` on the page: the text, in the theme's font, size and colour, wrapped at the width. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = LABELS.get(entity) as RichTextLabelState;
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    content.style.left = '0px';
    content.style.top = '0px';
    content.style.overflow = 'hidden';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const size = get_size(entity);
  const defaultColor = get_theme_color(entity, 'default_color');
  content.style.width = `${String(size.x)}px`;
  content.style.height = `${String(size.y)}px`;
  content.style.font = godot_font_css(fontOf(entity), get_theme_font_size(entity, 'normal_font_size'));
  content.style.color = css(defaultColor);
  content.style.whiteSpace = state.autowrapMode === AUTOWRAP_OFF ? 'pre' : 'pre-wrap';
  content.style.overflowWrap = state.autowrapMode === AUTOWRAP_ARBITRARY ? 'anywhere' : state.autowrapMode === AUTOWRAP_WORD_SMART ? 'break-word' : 'normal';
  content.style.filter = godot_canvas_item_self_filter(entity, element);
  content.textContent = state.text;
  // Its laid-out height, which `fit_content` asks for as its minimum size.
  if (state.fitContent) {
    const height = content.scrollHeight;
    if (height !== state.contentHeight) {
      state.contentHeight = height;
      update_minimum_size(entity);
    }
  }
}

/**
 * Makes `entity` a RichTextLabel with its defaults (`rich_text_label.h`: word-smart autowrap,
 * scrolling on, no BBCode, no fit to content).
 *
 * @godot RichTextLabel (protocol)
 * @source scene/gui/rich_text_label.cpp:8472
 */
export function godot_rich_text_label_mount(entity: Object3D): void {
  const state: RichTextLabelState = { text: '', fitContent: false, autowrapMode: AUTOWRAP_WORD_SMART, scrollActive: true, contentHeight: 0 };
  LABELS.set(entity, state);
  godot_control_mount(entity, ['RichTextLabel', 'Control', 'CanvasItem', 'Node'], {
    // `get_minimum_size` (`rich_text_label.cpp:8294`): the content's height with `fit_content`.
    minimumSize: (node): Vector2 => {
      const own = LABELS.get(node) as RichTextLabelState;
      return vector2(0, own.fitContent ? own.contentHeight : 0);
    },
    draw,
    drawKey: (node, element) => {
      const own = LABELS.get(node) as RichTextLabelState;
      const size = get_size(node);
      return JSON.stringify([own.text, own.autowrapMode, own.fitContent, size.x, size.y, get_theme_color(node, 'default_color'), get_theme_font_size(node, 'normal_font_size'), fontOf(node), godot_canvas_item_self_filter(node, element)]);
    },
    themeColors: { default_color: color(1, 1, 1, 1) },
    themeFontSizes: { normal_font_size: 16 },
  });
}

/**
 * @godot RichTextLabel.set_text
 * @source scene/gui/rich_text_label.cpp:7383
 */
export function set_text(self: object, text: string): void {
  stateOf(self, 'set_text').text = text;
}

/**
 * @godot RichTextLabel.get_text
 * @source scene/gui/rich_text_label.cpp:7417
 */
export function get_text(self: object): string {
  return stateOf(self, 'get_text').text;
}

/**
 * @godot RichTextLabel.get_parsed_text
 * @source scene/gui/rich_text_label.cpp:7437
 */
export function get_parsed_text(self: object): string {
  return stateOf(self, 'get_parsed_text').text;
}

/**
 * @godot RichTextLabel.clear
 * @source scene/gui/rich_text_label.cpp:5307
 */
export function clear(self: object): void {
  stateOf(self, 'clear').text = '';
}

/**
 * @godot RichTextLabel.set_fit_content
 * @source scene/gui/rich_text_label.cpp:5362
 */
export function set_fit_content(self: object, enabled: boolean): void {
  stateOf(self, 'set_fit_content').fitContent = enabled;
  update_minimum_size(self);
}

/**
 * @godot RichTextLabel.is_fit_content_enabled
 * @source scene/gui/rich_text_label.cpp:5371
 */
export function is_fit_content_enabled(self: object): boolean {
  return stateOf(self, 'is_fit_content_enabled').fitContent;
}

/**
 * @godot RichTextLabel.set_autowrap_mode
 * @source scene/gui/rich_text_label.cpp:7609
 */
export function set_autowrap_mode(self: object, mode: number): void {
  stateOf(self, 'set_autowrap_mode').autowrapMode = mode;
}

/**
 * @godot RichTextLabel.get_autowrap_mode
 * @source scene/gui/rich_text_label.cpp:7622
 */
export function get_autowrap_mode(self: object): number {
  return stateOf(self, 'get_autowrap_mode').autowrapMode;
}

/**
 * Stored: overflowing text is clipped, without a scroll bar.
 *
 * @godot RichTextLabel.set_scroll_active
 * @source scene/gui/rich_text_label.cpp:5402
 */
export function set_scroll_active(self: object, active: boolean): void {
  stateOf(self, 'set_scroll_active').scrollActive = active;
}

/**
 * @godot RichTextLabel.is_scroll_active
 * @source scene/gui/rich_text_label.cpp:5414
 */
export function is_scroll_active(self: object): boolean {
  return stateOf(self, 'is_scroll_active').scrollActive;
}

const RICH_TEXT_LABEL = {
  create: () => new Group(),
  classes: ['RichTextLabel', 'Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_rich_text_label_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['text', (entity, value: string) => set_text(entity, value)],
    ['fitContent', (entity, value: boolean) => set_fit_content(entity, value)],
    ['autowrapMode', (entity, value: number) => set_autowrap_mode(entity, value)],
    ['scrollActive', (entity, value: boolean) => set_scroll_active(entity, value)],
  ]),
};

/**
 * A RichTextLabel as a scene writes it: `<GodotRichTextLabel text="…" />`.
 *
 * @godot RichTextLabel (protocol)
 * @source scene/gui/rich_text_label.cpp:8472
 */
export function GodotRichTextLabel(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(RICH_TEXT_LABEL, props);
}
