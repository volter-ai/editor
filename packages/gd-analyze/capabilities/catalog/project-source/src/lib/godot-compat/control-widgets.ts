/** Godot's interactive Control widgets over the translated overlay's retained handles. */

import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { setCanvasControlTooltipPresentation } from './canvas-control-accessibility-api';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  controlBinding,
  optionalControlBinding,
  retainedControlFocusOwner,
  type ControlPoint,
  type GodotControl,
} from './control-state';
import {
  activateGodotGroupedButton,
  getGodotButtonGroup,
  setGodotGroupedButtonPressed,
  setGodotButtonGroup,
  type GodotButtonGroup,
} from './button-group';
import {
  bindBaseButtonShortcut,
  getBaseButtonShortcut,
  setBaseButtonShortcut,
} from './base-button-shortcut';
import type { GodotShortcut } from './shortcut';
import type { GodotFontSource } from './font';
import type { ColorValue } from './variant';
import type { ControlRichMetaRun } from './control-state';
import { projectGodotTexture } from './button-icon';
import { godotCallScriptVirtual } from './object';

export interface FocusableControl {
  focus?: () => void;
  blur?: () => void;
}

/** `Control.grab_focus()` requests keyboard focus immediately. */
export function grabControlFocus(control: FocusableControl): void {
  focusRetainedControlElement(control as GodotControl);
}

/** Focus the retained DOM element projected for a focusable Control, never a mirrored focus flag. */
export function focusRetainedControlElement(control: GodotControl): void {
  if (getControlFocusMode(control) === 0) return;
  const binding = controlBinding(control);
  const element = binding.state.read(binding.id).focusElement;
  if (element === undefined || element === null || !element.isConnected) {
    throw new Error('Control.grab_focus requires the retained browser focus element to be mounted.');
  }
  element.focus();
  if (element.ownerDocument.activeElement !== element) {
    throw new Error(
      'Control.grab_focus could not focus the retained browser element because it is disabled or not focusable.',
    );
  }
}

/** Godot 3 Control.get_focus_owner(): the key-focus owner in this Control's retained root. */
export function getControlFocusOwner(control: object): GodotControl | null {
  return retainedControlFocusOwner(control);
}

/** Transfer an in-flight mouse press exactly; this is distinct from keyboard `grab_focus()`. */
export function grabControlClickFocus(control: object): void {
  const binding = optionalControlBinding(control);
  if (binding === undefined) {
    throw new Error('Control.grab_click_focus requires a retained Control pointer carrier.');
  }
  binding.state.grabClickFocus(control as GodotControl);
}

/** Read browser focus from the retained element; canvas-only Controls truthfully have no DOM focus. */
export function hasControlFocus(control: object): boolean {
  const binding = optionalControlBinding(control);
  if (binding === undefined) return false;
  const element = binding.state.read(binding.id).focusElement;
  return retainedControlFocusOwner(control) === control && element !== undefined && element !== null &&
    element.isConnected && element.ownerDocument.activeElement === element;
}

/** Relinquish native browser focus immediately when this retained Control owns it. */
export function releaseControlFocus(control: object): void {
  const binding = optionalControlBinding(control);
  if (binding === undefined) return;
  const element = binding.state.read(binding.id).focusElement;
  if (element !== undefined && element !== null && element.ownerDocument.activeElement === element) {
    element.blur();
  }
  binding.state.releaseFocus(control as GodotControl);
}

const CONTROL_FOCUS_MODES = new WeakMap<object, number>();

export function getControlFocusMode(control: object): number {
  return CONTROL_FOCUS_MODES.get(control) ?? 0;
}

export function setControlFocusMode(control: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new RangeError(
      'Control.focus_mode must be FOCUS_NONE (0), FOCUS_CLICK (1), FOCUS_ALL (2), or FOCUS_ACCESSIBILITY (3).',
    );
  }
  CONTROL_FOCUS_MODES.set(control, value);
  const binding = optionalControlBinding(control);
  if (value === 0 && binding !== undefined && retainedControlFocusOwner(control) === control) {
    releaseControlFocus(control);
  }
  binding?.state.write(binding.id, { focusMode: value });
  const element = binding?.state.read(binding.id).focusElement;
  if (element !== undefined && element !== null) element.tabIndex = value === 2 ? 0 : -1;
}

const CONTROL_TOOLTIPS = new WeakMap<object, string>();
const CONTROL_MOUSE_ENTERED = new WeakMap<object, SignalHandle<readonly []>>();

/** Built-in Control.mouse_entered signal driven by the retained DOM/Pixi pointer surface. */
export function getControlMouseEnteredSignal(control: object): GodotSignal<readonly []> {
  let handle = CONTROL_MOUSE_ENTERED.get(control);
  if (handle === undefined) {
    handle = createSignal<readonly []>();
    CONTROL_MOUSE_ENTERED.set(control, handle);
    const binding = optionalControlBinding(control);
    binding?.state.write(binding.id, { onMouseEntered: () => handle?.emit() });
  }
  return handle.signal;
}

export function getControlTooltipText(control: object): string {
  const binding = optionalControlBinding(control);
  return binding?.state.read(binding.id).tooltipText ?? CONTROL_TOOLTIPS.get(control) ?? '';
}

/** Keep the Godot string on the retained Control and project it to native DOM/Pixi accessibility. */
export function setControlTooltipText(control: object, value: string): void {
  if (typeof value !== 'string') throw new TypeError('Control.tooltip_text requires a String.');
  CONTROL_TOOLTIPS.set(control, value);
  const binding = optionalControlBinding(control);
  if (binding !== undefined) {
    binding.state.write(binding.id, { tooltipText: value });
    const record = binding.state.read(binding.id);
    for (const element of [record.presentationElement, record.focusElement]) {
      if (element !== undefined && element !== null) element.title = value;
    }
  }
  if (control instanceof Container) setCanvasControlTooltipPresentation(control, value);
}

export interface RichTextLabelState {
  text: string;
  bbcode_enabled: boolean;
  bbcode_text: string;
  fit_content: boolean;
  scroll_active: boolean;
  scroll_following: boolean;
  visible_characters: number;
  visible_ratio: number;
  percent_visible: number;
  visible_characters_behavior: number;
  horizontal_alignment: number;
  vertical_alignment: number;
  autowrap_mode: number;
  custom_effects: unknown[];
  meta_underlined: boolean;
  selection_enabled: boolean;
  deselect_on_focus_loss_enabled: boolean;
  context_menu_enabled: boolean;
  shortcut_keys_enabled: boolean;
  threaded: boolean;
  progress_bar_delay: number;
  tab_size: number;
  text_direction: number;
  language: string;
}

export interface GodotRichTextLabel extends GodotControl, RichTextLabelState {
  readonly meta_clicked: GodotSignal<readonly [unknown]>;
  readonly meta_hover_started: GodotSignal<readonly [unknown]>;
  readonly meta_hover_ended: GodotSignal<readonly [unknown]>;
  readonly finished: GodotSignal<readonly []>;
  set_text(text: string): void;
  parse_bbcode(text: string): number;
  append_text(text: string): void;
  append_bbcode(text: string): number;
  add_image(texture: unknown, width?: number, height?: number, ...advanced: unknown[]): void;
  add_text(text: string): void;
  pop(): void;
  push_align(alignment: number): void;
  push_color(color: ColorValue): void;
  push_font(font: GodotFontSource, fontSize?: number): void;
  scroll_to_line(line: number): void;
  set_horizontal_alignment(alignment: number): void;
  set_vertical_alignment(alignment: number): void;
  set_visible_ratio(ratio: number): void;
  set_percent_visible(ratio: number): void;
  get_percent_visible(): number;
  newline(): void;
  clear(): void;
  get_content_height(): number;
  get_line_count(): number;
  get_parsed_text(): string;
  get_total_character_count(): number;
  set_fit_content_height(enabled: boolean): void;
  is_fit_content_height_enabled(): boolean;
  push_outline_size(size: number): void;
  push_outline_color(color: ColorValue): void;
  push_font_size(size: number): void;
  push_bold(): void;
  push_italics(): void;
  push_bold_italics(): void;
  push_mono(): void;
  push_normal(): void;
  push_underline(): void;
  push_strikethrough(): void;
  push_indent(level: number): void;
  push_list(level: number, type: number, capitalize?: boolean, bullet?: string): void;
  push_meta(data: unknown, underlineMode?: number, tooltip?: string): void;
  push_hint(description: string): void;
  push_language(language: string): void;
  push_paragraph(alignment: number, baseDirection?: number, language?: string, stParser?: number, justificationFlags?: number, tabStops?: readonly number[]): void;
  push_bgcolor(color: ColorValue): void;
  push_fgcolor(color: ColorValue): void;
  pop_all(): void;
  pop_context(): void;
  scroll_to_paragraph(paragraph: number): void;
  get_paragraph_count(): number;
  get_visible_line_count(): number;
  set_selection_enabled(enabled: boolean): void;
  is_selection_enabled(): boolean;
  set_deselect_on_focus_loss_enabled(enabled: boolean): void;
  is_deselect_on_focus_loss_enabled(): boolean;
  set_context_menu_enabled(enabled: boolean): void;
  is_context_menu_enabled(): boolean;
  set_shortcut_keys_enabled(enabled: boolean): void;
  is_shortcut_keys_enabled(): boolean;
  set_threaded(enabled: boolean): void;
  is_threaded(): boolean;
  set_progress_bar_delay(milliseconds: number): void;
  get_progress_bar_delay(): number;
  set_tab_size(spaces: number): void;
  get_tab_size(): number;
  set_text_direction(direction: number): void;
  get_text_direction(): number;
  set_language(language: string): void;
  get_language(): string;
  get_character_line(character: number): number;
  get_character_paragraph(character: number): number;
  get_content_width(): number;
  get_line_height(line: number): number;
  get_line_offset(line: number): number;
  get_line_range(line: number): ControlPoint;
  get_line_width(line: number): number;
  get_paragraph_offset(paragraph: number): number;
  get_selected_text(): string;
  get_selection_from(): number;
  get_selection_to(): number;
  get_selection_line_offset(): number;
}

interface ParsedRichText {
  readonly text: string;
  readonly runs: readonly ControlRichMetaRun[];
}

const RICH_TEXT_BBCODE_TAGS = new Set([
  'b',
  'bgcolor',
  'cell',
  'center',
  'code',
  'color',
  'dropcap',
  'fade',
  'fill',
  'font',
  'font_size',
  'fgcolor',
  'hint',
  'i',
  'img',
  'indent',
  'lang',
  'left',
  'meta',
  'ol',
  'outline_color',
  'outline_size',
  'p',
  'pulse',
  'rainbow',
  'right',
  's',
  'shake',
  'table',
  'tornado',
  'u',
  'ul',
  'url',
  'wave',
]);

function parseRichText(text: string, customEffects: readonly unknown[] = []): ParsedRichText {
  const plain: string[] = [];
  const runs: ControlRichMetaRun[] = [];
  const stack: {
    tag: string;
    meta?: unknown;
    metaStart?: number;
    color?: string;
    fontFamily?: string;
    fontSize?: number;
    alignment?: number;
    underline?: boolean;
  }[] = [];
  const active = (): Omit<ControlRichMetaRun, 'text'> => {
    const meta = [...stack].reverse().find((entry) => entry.meta !== undefined)?.meta ?? null;
    const color = [...stack].reverse().find((entry) => entry.color !== undefined)?.color;
    const fontFamily = [...stack].reverse().find((entry) => entry.fontFamily !== undefined)?.fontFamily;
    const fontSize = [...stack].reverse().find((entry) => entry.fontSize !== undefined)?.fontSize;
    const alignment = [...stack].reverse().find((entry) => entry.alignment !== undefined)?.alignment;
    const underline = [...stack].reverse().some((entry) => entry.underline === true);
    return {
      meta,
      ...(color === undefined ? {} : { color }),
      ...(fontFamily === undefined ? {} : { fontFamily }),
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(alignment === undefined ? {} : { alignment }),
      ...(underline ? { underline: true } : {}),
    };
  };
  const append = (value: string): void => {
    if (value === '') return;
    plain.push(...value);
    const style = active();
    const previous = runs.at(-1);
    if (
      previous !== undefined && previous.meta === style.meta && previous.color === style.color &&
      previous.fontFamily === style.fontFamily && previous.alignment === style.alignment
      && previous.fontSize === style.fontSize && previous.underline === style.underline
    ) {
      runs[runs.length - 1] = { ...previous, text: previous.text + value };
    } else runs.push({ text: value, ...style });
  };
  const token = /\[([^\]]+)\]/g;
  const customTags = new Set(customEffects.flatMap((effect) => {
    if (typeof effect !== 'object' || effect === null) return [];
    const direct = Reflect.get(effect, 'bbcode');
    if (typeof direct === 'string' && direct.length > 0) return [direct.toLowerCase()];
    const getter = Reflect.get(effect, 'get_bbcode');
    if (typeof getter !== 'function') return [];
    const value = getter.call(effect) as unknown;
    return typeof value === 'string' && value.length > 0 ? [value.toLowerCase()] : [];
  }));
  let cursor = 0;
  for (let match = token.exec(text); match !== null; match = token.exec(text)) {
    const source = match[1]!.trim();
    const closing = source.startsWith('/');
    const body = closing ? source.slice(1).trim() : source;
    const equal = body.indexOf('=');
    const tagSource = equal < 0 ? body : body.slice(0, equal);
    const tag = tagSource.trim().toLowerCase();
    const recognized = RICH_TEXT_BBCODE_TAGS.has(tag) || customTags.has(tag) ||
      (!closing && (tag === 'br' || tag === 'lb' || tag === 'rb'));
    append(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (!recognized) {
      append(match[0]);
      continue;
    }
    if (!closing && tag === 'br') {
      append('\n');
      continue;
    }
    if (!closing && tag === 'lb') {
      append('[');
      continue;
    }
    if (!closing && tag === 'rb') {
      append(']');
      continue;
    }
    if (closing) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index < 0) continue;
      const frame = stack[index];
      if (frame?.metaStart !== undefined) {
        const resolved = plain.slice(frame.metaStart).join('');
        let at = 0;
        for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
          const run = runs[runIndex]!;
          const end = at + [...run.text].length;
          if (end > frame.metaStart && run.meta === '') runs[runIndex] = { ...run, meta: resolved };
          at = end;
        }
      }
      stack.splice(index, 1);
      continue;
    }
    const argument = equal < 0 ? '' : body.slice(equal + 1).trim().replace(/^['"]|['"]$/g, '');
    if (tag === 'url' || tag === 'meta') {
      stack.push(argument === '' ? { tag, meta: '', metaStart: plain.length } : { tag, meta: argument });
    }
    else if (tag === 'color' || tag === 'fgcolor') stack.push({ tag, color: argument });
    else if (tag === 'font') stack.push({ tag, fontFamily: argument });
    else if (tag === 'font_size') stack.push({ tag, fontSize: Number(argument) });
    else if (tag === 'center') stack.push({ tag, alignment: 1 });
    else if (tag === 'right') stack.push({ tag, alignment: 2 });
    else if (tag === 'fill') stack.push({ tag, alignment: 3 });
    else if (tag === 'left') stack.push({ tag, alignment: 0 });
    else if (tag === 'u') stack.push({ tag, underline: true });
    else stack.push({ tag });
  }
  append(text.slice(cursor));
  return { text: plain.join(''), runs };
}

function retainedRichTextContentHeight(control: object): number {
  const native = control as {
    readonly scrollHeight?: number;
    getLocalBounds?: () => { readonly height?: number };
  };
  if (typeof native.getLocalBounds === 'function') {
    const height = native.getLocalBounds().height;
    if (typeof height === 'number' && Number.isFinite(height)) return Math.ceil(Math.max(0, height));
  }
  if (typeof native.scrollHeight === 'number' && Number.isFinite(native.scrollHeight)) {
    return Math.ceil(Math.max(0, native.scrollHeight));
  }
  throw new Error('RichTextLabel.get_content_height requires retained native text layout bounds.');
}

function retainedRichTextLineCount(control: object, text: string): number {
  if (control instanceof Text) return CanvasTextMetrics.measureText(text, control.style).lines.length;
  const binding = optionalControlBinding(control);
  const element = binding?.state.read(binding.id).focusElement;
  if (element !== undefined && element !== null && element.isConnected) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    const lineHeight = style === undefined ? Number.NaN : Number.parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight) && lineHeight > 0) return Math.max(1, Math.round(element.scrollHeight / lineHeight));
  }
  throw new Error('RichTextLabel.get_line_count requires retained native text layout metrics.');
}

export interface LineEditState {
  text: string;
  placeholder_text: string;
  editable: boolean;
  max_length: number;
  caret_column: number;
  secret: boolean;
  selecting_enabled: boolean;
  clear_button_enabled: boolean;
  secret_character: string;
  expand_to_text_length: boolean;
  context_menu_enabled: boolean;
  virtual_keyboard_enabled: boolean;
  virtual_keyboard_type: number;
  emoji_menu_enabled: boolean;
  middle_mouse_paste_enabled: boolean;
  keep_editing_on_text_submit: boolean;
  select_all_on_focus: boolean;
  draw_control_chars: boolean;
  flat: boolean;
  alignment: number;
  text_direction: number;
  language: string;
  caret_blink: boolean;
  caret_blink_interval: number;
  caret_force_displayed: boolean;
}

export interface GodotLineEdit extends GodotControl, LineEditState, FocusableControl {
  readonly text_changed: GodotSignal<readonly [string]>;
  readonly text_submitted: GodotSignal<readonly [string]>;
  /** Godot 3 spelling of the same Enter-submission signal. */
  readonly text_entered: GodotSignal<readonly [string]>;
  readonly text_change_rejected: GodotSignal<readonly [string]>;
  readonly editing_toggled: GodotSignal<readonly [boolean]>;
  clear(): void;
  get_text(): string;
  set_text(text: string): void;
  is_editable(): boolean;
  get_max_length(): number;
  set_max_length(length: number): void;
  get_placeholder(): string;
  set_placeholder(text: string): void;
  is_secret(): boolean;
  set_secret(enabled: boolean): void;
  is_clear_button_enabled(): boolean;
  set_clear_button_enabled(enabled: boolean): void;
  select(from?: number, to?: number): void;
  select_all(): void;
  deselect(): void;
  has_selection(): boolean;
  get_caret_column(): number;
  set_caret_column(column: number): void;
  get_cursor_position(): number;
  set_cursor_position(column: number): void;
  get_selected_text(): string;
  get_selection_from_column(): number;
  get_selection_to_column(): number;
  set_selecting_enabled(enabled: boolean): void;
  is_selecting_enabled(): boolean;
  insert_text_at_caret(text: string): void;
  append_at_cursor(text: string): void;
  delete_char_at_caret(): void;
  delete_text(fromColumn: number, toColumn: number): void;
  submit(): void;
  set_editable(enabled: boolean): void;
  set_secret_character(character: string): void;
  get_secret_character(): string;
  set_expand_to_text_length_enabled(enabled: boolean): void;
  is_expand_to_text_length_enabled(): boolean;
  set_context_menu_enabled(enabled: boolean): void;
  is_context_menu_enabled(): boolean;
  set_virtual_keyboard_enabled(enabled: boolean): void;
  is_virtual_keyboard_enabled(): boolean;
  set_virtual_keyboard_type(type: number): void;
  get_virtual_keyboard_type(): number;
  set_emoji_menu_enabled(enabled: boolean): void;
  is_emoji_menu_enabled(): boolean;
  set_middle_mouse_paste_enabled(enabled: boolean): void;
  is_middle_mouse_paste_enabled(): boolean;
  set_keep_editing_on_text_submit(enabled: boolean): void;
  is_editing_kept_on_text_submit(): boolean;
  set_select_all_on_focus(enabled: boolean): void;
  is_select_all_on_focus(): boolean;
  set_draw_control_chars(enabled: boolean): void;
  get_draw_control_chars(): boolean;
  set_flat(enabled: boolean): void;
  is_flat(): boolean;
  set_alignment(alignment: number): void;
  get_alignment(): number;
  set_align(alignment: number): void;
  get_align(): number;
  set_horizontal_alignment(alignment: number): void;
  get_horizontal_alignment(): number;
  set_text_direction(direction: number): void;
  get_text_direction(): number;
  set_language(language: string): void;
  get_language(): string;
  set_caret_blink_enabled(enabled: boolean): void;
  is_caret_blink_enabled(): boolean;
  set_caret_blink_interval(seconds: number): void;
  get_caret_blink_interval(): number;
  set_caret_force_displayed(enabled: boolean): void;
  is_caret_force_displayed(): boolean;
  menu_option(option: number): void;
}

export interface LineEditBindOptions extends Partial<LineEditState> {
  /** Source dialect also owns the valid horizontal-alignment enum range. */
  readonly dialect?: 3 | 4;
}

function fitLineEditText(text: string, maxLength: number): string {
  return maxLength > 0 ? [...text].slice(0, maxLength).join('') : text;
}

function lineEditLength(text: string): number {
  return [...text].length;
}

function lineEditSplice(text: string, from: number, to: number, insert: string): string {
  const characters = [...text];
  return [...characters.slice(0, from), ...insert, ...characters.slice(to)].join('');
}

export interface RangeState {
  godot_major: 3 | 4;
  min_value: number;
  max_value: number;
  step: number;
  page: number;
  value: number;
  allow_greater: boolean;
  allow_lesser: boolean;
  exp_edit: boolean;
  rounded: boolean;
}

export interface GodotRange extends GodotControl, RangeState {
  readonly value_changed: GodotSignal<readonly [number]>;
  readonly changed: GodotSignal<readonly []>;
  ratio: number;
  set_value(value: number): void;
  set_value_no_signal(value: number): void;
  set_min(value: number): void;
  set_max(value: number): void;
  set_as_ratio(value: number): void;
  set_allow_greater(value: boolean): void;
  set_allow_lesser(value: boolean): void;
  set_step(value: number): void;
  set_page(value: number): void;
  get_value(): number;
  get_min(): number;
  get_max(): number;
  get_step(): number;
  get_page(): number;
  get_as_ratio(): number;
  is_greater_allowed(): boolean;
  is_lesser_allowed(): boolean;
  set_exp_ratio(value: boolean): void;
  is_ratio_exp(): boolean;
  set_use_rounded_values(value: boolean): void;
  is_using_rounded_values(): boolean;
  share(withRange: GodotRange): never;
  unshare(): void;
}

export interface GodotHSlider extends GodotRange, FocusableControl {
  vertical: boolean;
  editable: boolean;
  scrollable: boolean;
  tick_count: number;
  ticks_on_borders: boolean;
  ticks_position: number;
  custom_step: number;
  readonly scrolling: GodotSignal<readonly []>;
  readonly drag_started: GodotSignal<readonly []>;
  readonly drag_ended: GodotSignal<readonly [boolean]>;
  is_editable(): boolean;
  set_editable(value: boolean): void;
  is_scrollable(): boolean;
  set_scrollable(value: boolean): void;
  get_ticks(): number;
  set_ticks(value: number): void;
  get_ticks_on_borders(): boolean;
  set_ticks_on_borders(value: boolean): void;
  get_ticks_position(): number;
  set_ticks_position(value: number): void;
  get_custom_step(): number;
  set_custom_step(value: number): void;
}

function roundRangeValue(value: number): number {
  return value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
}

function equalRangeValue(left: number, right: number): boolean {
  if (left === right) return true;
  const tolerance = Math.max(0.00001, 0.00001 * Math.abs(left));
  return Math.abs(left - right) < tolerance;
}

function normalizeRangeValue(range: RangeState, value: number): number {
  let next = Number.isFinite(value) ? value : range.min_value;
  if (range.step > 0) {
    if (range.godot_major === 4) {
      const steps = (next - range.min_value) / range.step;
      next = range.min_value + Math.floor(steps + 0.5) * range.step;
    } else {
      next = roundRangeValue(next / range.step) * range.step;
    }
  }
  if (range.rounded) next = roundRangeValue(next);
  if (!range.allow_greater) next = Math.min(range.max_value - range.page, next);
  if (!range.allow_lesser) next = Math.max(range.min_value, next);
  return next;
}

export interface BaseButtonState {
  disabled: boolean;
  toggle_mode: boolean;
  button_pressed: boolean;
  action_mode: number;
  button_mask: number;
  keep_pressed_outside: boolean;
  shortcut: GodotShortcut | null;
  shortcut_feedback: boolean;
  shortcut_in_tooltip: boolean;
}

export interface BaseButtonBindOptions extends Partial<BaseButtonState> {
  readonly godot_major?: 3 | 4;
}

export interface GodotBaseButton extends GodotControl, BaseButtonState, FocusableControl {
  button_group: GodotButtonGroup | null;
  readonly pressed: GodotSignal<readonly []>;
  readonly toggled: GodotSignal<readonly [boolean]>;
  readonly button_down: GodotSignal<readonly []>;
  readonly button_up: GodotSignal<readonly []>;
  press(mouseButton?: number): boolean;
  release(mouseButton?: number): boolean;
  cancel(): void;
  pointer_outside(mouseButton?: number): void;
  set_pressed(value: boolean): void;
  set_pressed_no_signal(value: boolean): void;
  set_disabled(value: boolean): void;
  is_hovered(): boolean;
  is_pressed(): boolean;
  set_toggle_mode(value: boolean): void;
  is_toggle_mode(): boolean;
  is_disabled(): boolean;
  set_action_mode(value: number): void;
  get_action_mode(): number;
  set_button_mask(value: number): void;
  get_button_mask(): number;
  get_draw_mode(): number;
  set_keep_pressed_outside(value: boolean): void;
  is_keep_pressed_outside(): boolean;
  set_shortcut(shortcut: GodotShortcut | null): void;
  get_shortcut(): GodotShortcut | null;
  set_shortcut_feedback(enabled: boolean): void;
  is_shortcut_feedback(): boolean;
  set_shortcut_in_tooltip(enabled: boolean): void;
  is_shortcut_in_tooltip_enabled(): boolean;
  get_button_group(): GodotButtonGroup | null;
}

function buttonMask(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('BaseButton.button_mask must be a non-negative MouseButtonMask bitfield.');
  }
  return value;
}

function mouseButtonBit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 31) return 0;
  if (value === 0) return 1;
  if (value === 1) return 4;
  if (value === 2) return 2;
  return 2 ** value;
}

function emitButtonPressed(
  button: GodotBaseButton,
  pressed: SignalHandle<readonly []>,
  toggled: SignalHandle<readonly [boolean]>,
): void {
  if (button.toggle_mode) {
    button.button_pressed = activateGodotGroupedButton(button, !button.button_pressed);
    toggled.emit(button.button_pressed);
  }
  // BaseButton invokes the script virtual before emitting `pressed`; both DOM and Pixi pointer
  // paths converge here, so an override observes the same retained button state exactly once.
  godotCallScriptVirtual(button, '_pressed', []);
  pressed.emit();
}

export function getLineEditText(line: GodotLineEdit): string {
  return line.text;
}

export function setLineEditText(line: GodotLineEdit, value: string): void {
  line.set_text(value);
}

export function getRangeValue(range: GodotRange): number {
  return range.value;
}

export function setRangeValue(range: GodotRange, value: number): void {
  range.value = value;
}

export type GodotRichTextLabelControl = GodotRichTextLabel;
export type GodotLineEditControl = GodotLineEdit;
export type GodotRangeControl = GodotHSlider;
export type GodotButtonControl = GodotBaseButton;
export type GodotCheckControl = GodotButtonControl;
export type GodotProgressBarControl = GodotRangeControl & { show_percentage: boolean; percent_visible: boolean };

/** Add RichTextLabel behavior to the same retained Control whose text the DOM projection reads. */
export function bindRichTextLabel(
  control: GodotControl,
  initial: Partial<RichTextLabelState> = {},
): GodotRichTextLabelControl {
  const findTextDescriptor = (): PropertyDescriptor | undefined => {
    let owner: object | null = control;
    while (owner !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'text');
      if (descriptor !== undefined) return descriptor;
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return undefined;
  };
  const nativeText = findTextDescriptor();
  const writeNativeText = (value: string): void => {
    if (nativeText?.set !== undefined) {
      nativeText.set.call(control, value);
      return;
    }
    if (nativeText !== undefined && 'value' in nativeText && nativeText.writable === true) {
      nativeText.value = value;
      return;
    }
    throw new Error('RichTextLabel retained node has no writable native text property.');
  };
  let bbcodeEnabled = initial.bbcode_enabled ?? false;
  if (typeof bbcodeEnabled !== 'boolean') {
    throw new TypeError('RichTextLabel.bbcode_enabled requires a boolean.');
  }
  let bbcodeText = initial.bbcode_text ?? initial.text ?? control.text;
  if (typeof bbcodeText !== 'string') {
    throw new TypeError('RichTextLabel.bbcode_text requires a String.');
  }
  let parsedByMethod = false;
  const pushedTags: string[] = [];
  const inlineImages: { key?: unknown; texture: unknown; source?: string; width?: number; height?: number }[] = [];
  let customEffects = initial.custom_effects ?? [];
  if (!Array.isArray(customEffects)) throw new TypeError('RichTextLabel.custom_effects requires an Array.');
  const escapedLiteral = (value: string): string => [...value].map((character) =>
    character === '[' ? '[lb]' : character === ']' ? '[rb]' : character).join('');
  const beginImperativeMarkup = (): void => {
    if (parsedByMethod || bbcodeEnabled) return;
    bbcodeText = escapedLiteral(bbcodeText);
    parsedByMethod = true;
  };
  let fitContent = initial.fit_content ?? false;
  if (typeof fitContent !== 'boolean') throw new TypeError('RichTextLabel.fit_content requires a boolean.');
  const metaClicked = createSignal<readonly [unknown]>();
  const metaHoverStarted = createSignal<readonly [unknown]>();
  const metaHoverEnded = createSignal<readonly [unknown]>();
  const finished = createSignal<readonly []>();
  let metaUnderlined = initial.meta_underlined ?? true;
  if (typeof metaUnderlined !== 'boolean') {
    throw new TypeError('RichTextLabel.meta_underlined requires a boolean.');
  }
  let horizontalAlignment = initial.horizontal_alignment ?? 0;
  let verticalAlignment = initial.vertical_alignment ?? 0;
  let visibleCharactersBehavior = initial.visible_characters_behavior ?? 0;
  let selectionEnabled = initial.selection_enabled ?? false;
  let deselectOnFocusLoss = initial.deselect_on_focus_loss_enabled ?? true;
  let contextMenuEnabled = initial.context_menu_enabled ?? true;
  let shortcutKeysEnabled = initial.shortcut_keys_enabled ?? true;
  let threaded = initial.threaded ?? false;
  let progressBarDelay = initial.progress_bar_delay ?? 1000;
  let tabSize = initial.tab_size ?? 4;
  let textDirection = initial.text_direction ?? 0;
  let language = initial.language ?? '';
  const colorTag = (value: ColorValue, member: string): string => {
    if (typeof value !== 'object' || value === null || ![value.r, value.g, value.b, value.a].every((component) => typeof component === 'number' && Number.isFinite(component))) throw new TypeError(`${member} requires a Color.`);
    const channel = (component: number): number => Math.round(Math.max(0, Math.min(1, component)) * 255);
    return `rgba(${channel(value.r)},${channel(value.g)},${channel(value.b)},${Math.max(0, Math.min(1, value.a))})`;
  };
  const pushTag = (opening: string, closing: string): void => {
    beginImperativeMarkup(); bbcodeText += opening; pushedTags.push(closing); parsedByMethod = true; syncBbcodeText();
  };
  const parsedRichText = (): ParsedRichText => {
    const parsed = bbcodeEnabled || parsedByMethod
      ? parseRichText(bbcodeText, customEffects)
      : { text: bbcodeText, runs: [{ text: bbcodeText, meta: null }] };
    let imageIndex = 0;
    const runs = parsed.runs.flatMap((run): ControlRichMetaRun[] => {
      const pieces = run.text.split('\uFFFC');
      const result: ControlRichMetaRun[] = [];
      pieces.forEach((piece, index) => {
        if (piece !== '') result.push({ ...run, text: piece });
        if (index >= pieces.length - 1) return;
        const image = inlineImages[imageIndex++];
        if (image !== undefined) result.push({
          ...run,
          text: '\uFFFC',
          inlineTexture: image.texture,
          ...(image.source === undefined ? {} : { inlineTextureSource: image.source }),
          ...(image.width === undefined ? {} : { inlineWidth: image.width }),
          ...(image.height === undefined ? {} : { inlineHeight: image.height }),
        });
      });
      return result;
    });
    return {
      text: parsed.text,
      runs: runs.map((run) => ({
        ...run,
        ...(run.alignment === undefined ? { alignment: horizontalAlignment } : {}),
        ...(!run.underline && metaUnderlined && run.meta !== null ? { underline: true } : {}),
      })),
    };
  };
  const parsedText = (): string => parsedRichText().text;
  const syncFitContent = (): void => {
    const binding = optionalControlBinding(control);
    binding?.state.write(binding.id, { richFitContent: fitContent });
    if (!fitContent || binding === undefined) return;
    const current = binding.state.read(binding.id).size ?? binding.state.authored(binding.id)?.size;
    if (current === undefined) {
      throw new Error('RichTextLabel.fit_content requires retained Control dimensions.');
    }
    binding.state.write(binding.id, {
      size: { x: current.x, y: retainedRichTextContentHeight(control) },
    });
  };
  const syncBbcodeText = (): void => {
    const parsed = parsedRichText();
    const visible = visibleCharacters < 0 ? parsed.text : [...parsed.text].slice(0, visibleCharacters).join('');
    writeNativeText(visible);
    let remaining = [...visible].length;
    const runs = parsed.runs.flatMap((run) => {
      if (remaining <= 0) return [];
      const characters = [...run.text];
      const take = Math.min(remaining, characters.length);
      remaining -= take;
      return [{ ...run, text: characters.slice(0, take).join('') }];
    });
    const binding = optionalControlBinding(control);
    binding?.state.write(binding.id, {
      richMetaRuns: runs,
      onRichTextMeta: (meta) => metaClicked.emit(meta),
      onRichTextMetaHover: (meta, hovered) => {
        if (hovered) metaHoverStarted.emit(meta);
        else metaHoverEnded.emit(meta);
      },
    });
    binding?.state.read(binding.id).onRichTextRuns?.(runs);
    syncFitContent();
  };
  let scrollActive = initial.scroll_active ?? true;
  let scrollFollowing = initial.scroll_following ?? false;
  let visibleCharacters = initial.visible_characters ?? -1;
  let percentVisible = 1;
  let autowrapMode = initial.autowrap_mode ?? 0;
  const setVisibleRatioState = (value: number, legacyPercent: boolean): void => {
    if (!Number.isFinite(value)) {
      throw new TypeError(`RichTextLabel.${legacyPercent ? 'percent_visible' : 'visible_ratio'} requires a finite float.`);
    }
    if (legacyPercent && (value < 0 || value >= 1)) {
      visibleCharacters = -1;
      percentVisible = 1;
      return;
    }
    if (value < 0 || value > 1) {
      throw new RangeError('RichTextLabel.visible_ratio must be in [0, 1].');
    }
    visibleCharacters = value >= 1 ? -1 : Math.floor([...parsedText()].length * value);
    percentVisible = value >= 1 ? 1 : value;
  };
  if (initial.percent_visible !== undefined) setVisibleRatioState(initial.percent_visible, true);
  else if (initial.visible_ratio !== undefined) setVisibleRatioState(initial.visible_ratio, false);
  else if (visibleCharacters !== -1) {
    const total = [...parsedText()].length;
    if (total > 0) percentVisible = visibleCharacters / total;
  }
  Object.defineProperties(control, {
    text: {
      enumerable: true,
      configurable: true,
      get: () => bbcodeText,
      set: (value: string) => {
        if (typeof value !== 'string') throw new TypeError('RichTextLabel.text requires a String.');
        bbcodeText = value;
        parsedByMethod = false;
        pushedTags.length = 0;
        inlineImages.length = 0;
        syncBbcodeText();
      },
    },
    bbcode_enabled: {
      enumerable: true,
      configurable: true,
      get: () => bbcodeEnabled,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') {
          throw new TypeError('RichTextLabel.bbcode_enabled requires a boolean.');
        }
        if (bbcodeEnabled === value) return;
        bbcodeEnabled = value;
        syncBbcodeText();
      },
    },
    bbcode_text: {
      enumerable: true,
      configurable: true,
      get: () => bbcodeText,
      set: (value: string) => {
        if (typeof value !== 'string') {
          throw new TypeError('RichTextLabel.bbcode_text requires a String.');
        }
        bbcodeText = value;
        parsedByMethod = false;
        pushedTags.length = 0;
        inlineImages.length = 0;
        syncBbcodeText();
      },
    },
    fit_content: {
      enumerable: true,
      configurable: true,
      get: () => fitContent,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.fit_content requires a boolean.');
        fitContent = value;
        syncFitContent();
      },
    },
    scroll_active: {
      enumerable: true,
      configurable: true,
      get: () => scrollActive,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.scroll_active requires a boolean.');
        scrollActive = value;
        const binding = optionalControlBinding(control);
        binding?.state.write(binding.id, { richScrollActive: value });
      },
    },
    scroll_following: {
      enumerable: true,
      configurable: true,
      get: () => scrollFollowing,
      set: (value: boolean) => { scrollFollowing = value; },
    },
    visible_characters: {
      enumerable: true,
      configurable: true,
      get: () => visibleCharacters,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < -1) throw new RangeError('RichTextLabel.visible_characters must be -1 or a non-negative integer.');
        visibleCharacters = value;
        if (value === -1) percentVisible = 1;
        else {
          const total = [...parsedText()].length;
          if (total > 0) percentVisible = value / total;
        }
        syncBbcodeText();
      },
    },
    visible_ratio: {
      enumerable: true,
      configurable: true,
      get: () => {
        return percentVisible;
      },
      set: (value: number) => {
        setVisibleRatioState(value, false);
        syncBbcodeText();
      },
    },
    percent_visible: {
      enumerable: true,
      configurable: true,
      get: () => percentVisible,
      set: (value: number) => {
        setVisibleRatioState(value, true);
        syncBbcodeText();
      },
    },
    visible_characters_behavior: {
      enumerable: true,
      configurable: true,
      get: () => visibleCharactersBehavior,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > 4) {
          throw new RangeError('RichTextLabel.visible_characters_behavior must be in [0, 4].');
        }
        visibleCharactersBehavior = value;
      },
    },
    horizontal_alignment: {
      enumerable: true,
      configurable: true,
      get: () => horizontalAlignment,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
          throw new RangeError('RichTextLabel.horizontal_alignment requires ALIGN_LEFT..ALIGN_FILL.');
        }
        horizontalAlignment = value;
        syncBbcodeText();
      },
    },
    vertical_alignment: {
      enumerable: true,
      configurable: true,
      get: () => verticalAlignment,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
          throw new RangeError('RichTextLabel.vertical_alignment requires ALIGNMENT_BEGIN..ALIGNMENT_END.');
        }
        verticalAlignment = value;
        syncBbcodeText();
      },
    },
    autowrap_mode: {
      enumerable: true,
      configurable: true,
      get: () => autowrapMode,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('RichTextLabel.autowrap_mode must be in [0, 3].');
        autowrapMode = value;
        const binding = optionalControlBinding(control);
        binding?.state.write(binding.id, { richAutowrapMode: value });
        const native = control as unknown as {
          width?: number;
          style?: { wordWrap?: boolean; wordWrapWidth?: number; breakWords?: boolean; whiteSpace?: string };
        };
        if (native.style !== undefined) {
          const width = native.width;
          native.style.wordWrap = value !== 0;
          if (typeof width === 'number' && Number.isFinite(width) && width > 0) native.style.wordWrapWidth = width;
          native.style.breakWords = value === 1 || value === 3;
          native.style.whiteSpace = value === 0 ? 'pre' : 'pre-wrap';
        }
      },
    },
    custom_effects: {
      enumerable: true,
      configurable: true,
      get: () => customEffects,
      set: (value: unknown[]) => {
        if (!Array.isArray(value)) throw new TypeError('RichTextLabel.custom_effects requires an Array.');
        customEffects = value;
        syncBbcodeText();
      },
    },
    meta_underlined: {
      enumerable: true,
      configurable: true,
      get: () => metaUnderlined,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') {
          throw new TypeError('RichTextLabel.meta_underlined requires a boolean.');
        }
        metaUnderlined = value;
        syncBbcodeText();
      },
    },
    selection_enabled: { enumerable: true, configurable: true, get: () => selectionEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.selection_enabled requires bool.'); selectionEnabled = value; } },
    deselect_on_focus_loss_enabled: { enumerable: true, configurable: true, get: () => deselectOnFocusLoss, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.deselect_on_focus_loss_enabled requires bool.'); deselectOnFocusLoss = value; } },
    context_menu_enabled: { enumerable: true, configurable: true, get: () => contextMenuEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.context_menu_enabled requires bool.'); contextMenuEnabled = value; } },
    shortcut_keys_enabled: { enumerable: true, configurable: true, get: () => shortcutKeysEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.shortcut_keys_enabled requires bool.'); shortcutKeysEnabled = value; } },
    threaded: { enumerable: true, configurable: true, get: () => threaded, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.threaded requires bool.'); threaded = value; if (!threaded) finished.emit(); } },
    progress_bar_delay: { enumerable: true, configurable: true, get: () => progressBarDelay, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('RichTextLabel.progress_bar_delay must be non-negative.'); progressBarDelay = value; } },
    tab_size: { enumerable: true, configurable: true, get: () => tabSize, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('RichTextLabel.tab_size must be non-negative.'); tabSize = value; syncBbcodeText(); } },
    text_direction: { enumerable: true, configurable: true, get: () => textDirection, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('RichTextLabel.text_direction requires an integer.'); textDirection = value; syncBbcodeText(); } },
    language: { enumerable: true, configurable: true, get: () => language, set: (value: string) => { if (typeof value !== 'string') throw new TypeError('RichTextLabel.language requires String.'); language = value; syncBbcodeText(); } },
  });
  syncBbcodeText();
  return Object.assign(control, {
    bbcode_enabled: bbcodeEnabled,
    bbcode_text: bbcodeText,
    fit_content: fitContent,
    scroll_active: scrollActive,
    scroll_following: scrollFollowing,
    visible_characters: visibleCharacters,
    visible_ratio: percentVisible,
    percent_visible: percentVisible,
    visible_characters_behavior: visibleCharactersBehavior,
    horizontal_alignment: horizontalAlignment,
    vertical_alignment: verticalAlignment,
    autowrap_mode: autowrapMode,
    custom_effects: customEffects,
    meta_underlined: metaUnderlined,
    selection_enabled: selectionEnabled,
    deselect_on_focus_loss_enabled: deselectOnFocusLoss,
    context_menu_enabled: contextMenuEnabled,
    shortcut_keys_enabled: shortcutKeysEnabled,
    threaded,
    progress_bar_delay: progressBarDelay,
    tab_size: tabSize,
    text_direction: textDirection,
    language,
    meta_clicked: metaClicked.signal,
    meta_hover_started: metaHoverStarted.signal,
    meta_hover_ended: metaHoverEnded.signal,
    finished: finished.signal,
    set_text(value: string): void {
      if (typeof value !== 'string') throw new TypeError('RichTextLabel.set_text requires a String.');
      control.text = value;
    },
    parse_bbcode(value: string): number {
      if (typeof value !== 'string') throw new TypeError('RichTextLabel.parse_bbcode requires a String.');
      bbcodeText = value;
      parsedByMethod = true;
      pushedTags.length = 0;
      inlineImages.length = 0;
      syncBbcodeText();
      return 0;
    },
    append_text(value: string): void {
      if (typeof value !== 'string') throw new TypeError('RichTextLabel.append_text requires a String.');
      bbcodeText += value;
      syncBbcodeText();
    },
    append_bbcode(value: string): number {
      if (typeof value !== 'string') throw new TypeError('RichTextLabel.append_bbcode requires a String.');
      beginImperativeMarkup();
      bbcodeText += value;
      parsedByMethod = true;
      syncBbcodeText();
      return 0;
    },
    add_image(texture: unknown, width = 0, height = 0, ...advanced: unknown[]): void {
      if (advanced.length > 0) {
        throw new Error('RichTextLabel.add_image advanced color/alignment/region/key/padding arguments require retained inline-image layout support.');
      }
      if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0) {
        throw new RangeError('RichTextLabel.add_image width and height must be non-negative integers.');
      }
      const projected = projectGodotTexture(texture, 'RichTextLabel.add_image');
      inlineImages.push({
        texture: projected.pixiTexture ?? projected.identity,
        ...(projected.domSource === undefined ? {} : { source: projected.domSource }),
        ...(width === 0 ? {} : { width }),
        ...(height === 0 ? {} : { height }),
      });
      beginImperativeMarkup();
      bbcodeText += '\uFFFC';
      parsedByMethod = true;
      syncBbcodeText();
    },
    add_text(value: string): void {
      if (typeof value !== 'string') throw new TypeError('RichTextLabel.add_text requires a String.');
      bbcodeText += parsedByMethod || bbcodeEnabled ? escapedLiteral(value) : value;
      syncBbcodeText();
    },
    pop(): void {
      const closing = pushedTags.pop();
      if (closing === undefined) return;
      bbcodeText += closing;
      parsedByMethod = true;
      syncBbcodeText();
    },
    push_align(value: number): void {
      if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
        throw new RangeError('RichTextLabel.push_align requires ALIGN_LEFT..ALIGN_FILL.');
      }
      beginImperativeMarkup();
      const tag = ['left', 'center', 'right', 'fill'][value]!;
      bbcodeText += `[${tag}]`;
      pushedTags.push(`[/${tag}]`);
      parsedByMethod = true;
      syncBbcodeText();
    },
    push_color(value: ColorValue): void {
      if (
        typeof value !== 'object' || value === null ||
        ![value.r, value.g, value.b, value.a].every(
          (component) => typeof component === 'number' && Number.isFinite(component),
        )
      ) throw new TypeError('RichTextLabel.push_color requires a Color.');
      beginImperativeMarkup();
      const channel = (component: number): number =>
        Math.round(Math.max(0, Math.min(1, component)) * 255);
      const css = `rgba(${channel(value.r)},${channel(value.g)},${channel(value.b)},${Math.max(0, Math.min(1, value.a))})`;
      bbcodeText += `[color=${css}]`;
      pushedTags.push('[/color]');
      parsedByMethod = true;
      syncBbcodeText();
    },
    push_font(value: GodotFontSource, fontSize = 0): void {
      if (typeof value !== 'object' || value === null || typeof value.family !== 'string') {
        throw new TypeError('RichTextLabel.push_font requires a Font.');
      }
      if (!Number.isSafeInteger(fontSize) || fontSize < 0) {
        throw new RangeError('RichTextLabel.push_font font_size must be a non-negative int.');
      }
      beginImperativeMarkup();
      bbcodeText += `[font=${JSON.stringify(value.family)}]${fontSize === 0 ? '' : `[font_size=${fontSize}]`}`;
      pushedTags.push(`${fontSize === 0 ? '' : '[/font_size]'}[/font]`);
      parsedByMethod = true;
      syncBbcodeText();
    },
    scroll_to_line(value: number): void {
      if (!Number.isSafeInteger(value)) throw new TypeError('RichTextLabel.scroll_to_line requires an int.');
      const count = retainedRichTextLineCount(control, parsedText());
      if (value > 0 && value >= count) return;
      const line = Math.max(0, value);
      const binding = optionalControlBinding(control);
      const record = binding?.state.read(binding.id);
      record?.onRichTextScrollLine?.(line);
      const element = record?.focusElement;
      if (element !== undefined && element !== null) {
        const style = element.ownerDocument.defaultView?.getComputedStyle(element);
        const lineHeight = style === undefined ? Number.NaN : Number.parseFloat(style.lineHeight);
        if (Number.isFinite(lineHeight) && lineHeight > 0) element.scrollTop = line * lineHeight;
      }
    },
    set_horizontal_alignment(value: number): void {
      (control as GodotRichTextLabelControl).horizontal_alignment = value;
    },
    set_vertical_alignment(value: number): void {
      (control as GodotRichTextLabelControl).vertical_alignment = value;
    },
    set_visible_ratio(value: number): void {
      (control as GodotRichTextLabelControl).visible_ratio = value;
    },
    set_percent_visible(value: number): void {
      (control as GodotRichTextLabelControl).percent_visible = value;
    },
    get_percent_visible(): number {
      return (control as GodotRichTextLabelControl).percent_visible;
    },
    newline(): void {
      bbcodeText += '\n';
      syncBbcodeText();
    },
    clear(): void {
      bbcodeText = '';
      pushedTags.length = 0;
      inlineImages.length = 0;
      syncBbcodeText();
    },
    get_content_height(): number {
      return retainedRichTextContentHeight(control);
    },
    get_line_count(): number {
      return retainedRichTextLineCount(control, parsedText());
    },
    get_parsed_text(): string {
      return parsedText();
    },
    get_total_character_count(): number {
      return [...parsedText()].length;
    },
    set_fit_content_height(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('RichTextLabel.set_fit_content_height requires a boolean.');
      (control as GodotRichTextLabelControl).fit_content = value;
    },
    is_fit_content_height_enabled(): boolean {
      return fitContent;
    },
    push_outline_size(size: number): void { if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('RichTextLabel.push_outline_size requires non-negative int.'); pushTag(`[outline_size=${size}]`, '[/outline_size]'); },
    push_outline_color(color: ColorValue): void { pushTag(`[outline_color=${colorTag(color, 'RichTextLabel.push_outline_color')}]`, '[/outline_color]'); },
    push_font_size(size: number): void { if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError('RichTextLabel.push_font_size requires positive int.'); pushTag(`[font_size=${size}]`, '[/font_size]'); },
    push_bold(): void { pushTag('[b]', '[/b]'); },
    push_italics(): void { pushTag('[i]', '[/i]'); },
    push_bold_italics(): void { pushTag('[b][i]', '[/i][/b]'); },
    push_mono(): void { pushTag('[code]', '[/code]'); },
    push_normal(): void { pushTag('[font=normal]', '[/font]'); },
    push_underline(): void { pushTag('[u]', '[/u]'); },
    push_strikethrough(): void { pushTag('[s]', '[/s]'); },
    push_indent(level: number): void { if (!Number.isSafeInteger(level) || level < 0) throw new RangeError('RichTextLabel.push_indent requires non-negative int.'); pushTag(`[indent=${level}]`, '[/indent]'); },
    push_list(level: number, type: number, capitalize = false, bullet = '•'): void {
      if (!Number.isSafeInteger(level) || level < 0 || !Number.isSafeInteger(type)) throw new RangeError('RichTextLabel.push_list requires integer level and type.');
      if (typeof capitalize !== 'boolean' || typeof bullet !== 'string') throw new TypeError('RichTextLabel.push_list arguments are invalid.');
      pushTag(`[${type === 0 ? 'ul' : 'ol'} level=${level} capitalize=${capitalize} bullet=${JSON.stringify(bullet)}]`, type === 0 ? '[/ul]' : '[/ol]');
    },
    push_meta(data: unknown, underlineMode = 0, tooltip = ''): void { if (!Number.isSafeInteger(underlineMode) || typeof tooltip !== 'string') throw new TypeError('RichTextLabel.push_meta arguments are invalid.'); pushTag(`[meta=${JSON.stringify(data)} tooltip=${JSON.stringify(tooltip)}]`, '[/meta]'); },
    push_hint(description: string): void { if (typeof description !== 'string') throw new TypeError('RichTextLabel.push_hint requires String.'); pushTag(`[hint=${JSON.stringify(description)}]`, '[/hint]'); },
    push_language(value: string): void { if (typeof value !== 'string') throw new TypeError('RichTextLabel.push_language requires String.'); pushTag(`[lang=${JSON.stringify(value)}]`, '[/lang]'); },
    push_paragraph(alignment: number, baseDirection = 0, paragraphLanguage = '', stParser = 0, justificationFlags = 163, tabStops: readonly number[] = []): void {
      if (![alignment, baseDirection, stParser, justificationFlags].every(Number.isSafeInteger) || typeof paragraphLanguage !== 'string' || !Array.isArray(tabStops)) throw new TypeError('RichTextLabel.push_paragraph arguments are invalid.');
      pushTag(`[p align=${alignment} direction=${baseDirection} language=${JSON.stringify(paragraphLanguage)} parser=${stParser} justification=${justificationFlags}]`, '[/p]');
    },
    push_bgcolor(color: ColorValue): void { pushTag(`[bgcolor=${colorTag(color, 'RichTextLabel.push_bgcolor')}]`, '[/bgcolor]'); },
    push_fgcolor(color: ColorValue): void { pushTag(`[fgcolor=${colorTag(color, 'RichTextLabel.push_fgcolor')}]`, '[/fgcolor]'); },
    pop_all(): void { while (pushedTags.length > 0) bbcodeText += pushedTags.pop(); parsedByMethod = true; syncBbcodeText(); },
    pop_context(): void { (control as GodotRichTextLabel).pop_all(); },
    scroll_to_paragraph(paragraph: number): void { if (!Number.isSafeInteger(paragraph)) throw new TypeError('RichTextLabel.scroll_to_paragraph requires int.'); (control as GodotRichTextLabel).scroll_to_line(Math.max(0, paragraph)); },
    get_paragraph_count(): number { return Math.max(1, parsedText().split(/\n\s*\n/).length); },
    get_visible_line_count(): number { return retainedRichTextLineCount(control, control.text); },
    set_selection_enabled(value: boolean): void { (control as GodotRichTextLabel).selection_enabled = value; },
    is_selection_enabled(): boolean { return selectionEnabled; },
    set_deselect_on_focus_loss_enabled(value: boolean): void { (control as GodotRichTextLabel).deselect_on_focus_loss_enabled = value; },
    is_deselect_on_focus_loss_enabled(): boolean { return deselectOnFocusLoss; },
    set_context_menu_enabled(value: boolean): void { (control as GodotRichTextLabel).context_menu_enabled = value; },
    is_context_menu_enabled(): boolean { return contextMenuEnabled; },
    set_shortcut_keys_enabled(value: boolean): void { (control as GodotRichTextLabel).shortcut_keys_enabled = value; },
    is_shortcut_keys_enabled(): boolean { return shortcutKeysEnabled; },
    set_threaded(value: boolean): void { (control as GodotRichTextLabel).threaded = value; },
    is_threaded(): boolean { return threaded; },
    set_progress_bar_delay(value: number): void { (control as GodotRichTextLabel).progress_bar_delay = value; },
    get_progress_bar_delay(): number { return progressBarDelay; },
    set_tab_size(value: number): void { (control as GodotRichTextLabel).tab_size = value; },
    get_tab_size(): number { return tabSize; },
    set_text_direction(value: number): void { (control as GodotRichTextLabel).text_direction = value; },
    get_text_direction(): number { return textDirection; },
    set_language(value: string): void { (control as GodotRichTextLabel).language = value; },
    get_language(): string { return language; },
    add_hr(width = 90, height = 2, color: ColorValue = { r: 1, g: 1, b: 1, a: 1 }): void {
      if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0) throw new RangeError('RichTextLabel.add_hr dimensions must be non-negative integers.');
      beginImperativeMarkup();
      bbcodeText += `\n[fill][color=${colorTag(color, 'RichTextLabel.add_hr color')}]${'─'.repeat(Math.max(1, Math.round(width / Math.max(1, height))))}[/color][/fill]\n`;
      parsedByMethod = true;
      syncBbcodeText();
    },
    get_character_line(character: number): number {
      if (!Number.isSafeInteger(character)) throw new TypeError('RichTextLabel.get_character_line requires int.');
      const offset = Math.max(0, Math.min(character, [...parsedText()].length));
      return [...parsedText()].slice(0, offset).join('').split('\n').length - 1;
    },
    get_character_paragraph(character: number): number {
      if (!Number.isSafeInteger(character)) throw new TypeError('RichTextLabel.get_character_paragraph requires int.');
      const prefix = [...parsedText()].slice(0, Math.max(0, character)).join('');
      return prefix.split(/\n\s*\n/).length - 1;
    },
    get_content_width(): number {
      const binding = optionalControlBinding(control);
      const element = binding?.state.read(binding.id).focusElement;
      if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) return element.scrollWidth;
      const native = control as unknown as { readonly width?: number };
      return native.width ?? Math.max(0, ...parsedText().split('\n').map((lineText) => [...lineText].length * 8));
    },
    get_line_height(lineIndex: number): number {
      if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || lineIndex >= retainedRichTextLineCount(control, parsedText())) return 0;
      const binding = optionalControlBinding(control);
      const element = binding?.state.read(binding.id).focusElement;
      if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) {
        const value = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? '');
        if (Number.isFinite(value)) return value;
      }
      return 16;
    },
    get_line_offset(lineIndex: number): number {
      if (!Number.isSafeInteger(lineIndex)) throw new TypeError('RichTextLabel.get_line_offset requires int.');
      return Math.max(0, lineIndex) * ((control as GodotRichTextLabel).get_line_height(Math.max(0, lineIndex)) || 16);
    },
    get_line_range(lineIndex: number): { readonly x: number; readonly y: number } {
      if (!Number.isSafeInteger(lineIndex)) throw new TypeError('RichTextLabel.get_line_range requires int.');
      const lines = parsedText().split('\n');
      if (lineIndex < 0 || lineIndex >= lines.length) return { x: 0, y: 0 };
      const start = lines.slice(0, lineIndex).reduce((sum, value) => sum + [...value].length + 1, 0);
      return { x: start, y: start + [...lines[lineIndex]!].length };
    },
    get_line_width(lineIndex: number): number {
      const range = (control as GodotRichTextLabel).get_line_range(lineIndex);
      return Math.max(0, range.y - range.x) * 8;
    },
    get_paragraph_offset(paragraph: number): number {
      if (!Number.isSafeInteger(paragraph)) throw new TypeError('RichTextLabel.get_paragraph_offset requires int.');
      const sections = parsedText().split(/\n\s*\n/);
      const prefixLines = sections.slice(0, Math.max(0, paragraph)).join('\n\n').split('\n').length - (paragraph <= 0 ? 1 : 0);
      return prefixLines * 16;
    },
    get_selected_text(): string {
      const binding = optionalControlBinding(control);
      const element = binding?.state.read(binding.id).focusElement;
      const selection = element?.ownerDocument.defaultView?.getSelection();
      if (selection !== null && selection !== undefined && element !== undefined && element !== null) {
        if (selection.rangeCount > 0 && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) return selection.toString();
      }
      const record = binding?.state.read(binding.id);
      const from = record?.richSelectionFrom;
      const to = record?.richSelectionTo;
      if (from === undefined || to === undefined || from === to) return '';
      return [...parsedText()].slice(Math.min(from, to), Math.max(from, to)).join('');
    },
    get_selection_from(): number {
      const binding = optionalControlBinding(control);
      const record = binding?.state.read(binding.id);
      if (record?.richSelectionFrom !== undefined && record.richSelectionTo !== undefined) return Math.min(record.richSelectionFrom, record.richSelectionTo);
      const value = (control as GodotRichTextLabel).get_selected_text();
      return value === '' ? -1 : Math.max(0, parsedText().indexOf(value));
    },
    get_selection_to(): number {
      const binding = optionalControlBinding(control);
      const record = binding?.state.read(binding.id);
      if (record?.richSelectionFrom !== undefined && record.richSelectionTo !== undefined) return Math.max(record.richSelectionFrom, record.richSelectionTo);
      const from = (control as GodotRichTextLabel).get_selection_from();
      return from < 0 ? -1 : from + [...(control as GodotRichTextLabel).get_selected_text()].length;
    },
    get_selection_line_offset(): number { const from = (control as GodotRichTextLabel).get_selection_from(); return from < 0 ? 0 : (control as GodotRichTextLabel).get_character_line(from); },
    get_visible_content_rect(): { readonly position: { readonly x: number; readonly y: number }; readonly size: { readonly x: number; readonly y: number } } {
      const binding = optionalControlBinding(control);
      const element = binding?.state.read(binding.id).focusElement;
      if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) return { position: { x: element.scrollLeft, y: element.scrollTop }, size: { x: element.clientWidth, y: element.clientHeight } };
      const size = binding?.state.read(binding.id).size ?? { x: (control as unknown as { width?: number }).width ?? 0, y: (control as unknown as { height?: number }).height ?? 0 };
      return { position: { x: 0, y: 0 }, size };
    },
    is_finished(): boolean { return true; },
    install_effect(effect: unknown): void { if (effect === null || effect === undefined) throw new TypeError('RichTextLabel.install_effect requires RichTextEffect.'); customEffects = [...customEffects, effect]; syncBbcodeText(); },
    invalidate_paragraph(paragraph: number): boolean { return Number.isSafeInteger(paragraph) && paragraph >= 0 && paragraph < (control as GodotRichTextLabel).get_paragraph_count(); },
    remove_paragraph(paragraph: number, _noInvalidate = false): boolean {
      if (!Number.isSafeInteger(paragraph)) throw new TypeError('RichTextLabel.remove_paragraph requires int.');
      const sections = bbcodeText.split(/\n\s*\n/);
      if (paragraph < 0 || paragraph >= sections.length) return false;
      sections.splice(paragraph, 1);
      bbcodeText = sections.join('\n\n');
      syncBbcodeText();
      return true;
    },
    scroll_to_selection(): void { const from = (control as GodotRichTextLabel).get_selection_from(); if (from >= 0) (control as GodotRichTextLabel).scroll_to_line((control as GodotRichTextLabel).get_character_line(from)); },
    push_table(columns: number, inlineAlign = 0, alignToRow = -1): void { if (!Number.isSafeInteger(columns) || columns <= 0 || !Number.isSafeInteger(inlineAlign) || !Number.isSafeInteger(alignToRow)) throw new TypeError('RichTextLabel.push_table arguments are invalid.'); pushTag(`[table=${columns} align=${inlineAlign} row=${alignToRow}]`, '[/table]'); },
    set_table_column_expand(column: number, expand: boolean, ratio = 1): void { if (!Number.isSafeInteger(column) || typeof expand !== 'boolean' || !Number.isFinite(ratio) || ratio < 0) throw new TypeError('RichTextLabel.set_table_column_expand arguments are invalid.'); },
    set_cell_row_background_color(oddRowBg: ColorValue, evenRowBg: ColorValue): void { colorTag(oddRowBg, 'RichTextLabel.set_cell_row_background_color'); colorTag(evenRowBg, 'RichTextLabel.set_cell_row_background_color'); },
    set_cell_border_color(color: ColorValue): void { colorTag(color, 'RichTextLabel.set_cell_border_color'); },
    set_cell_size_override(minSize: ControlPoint, maxSize: ControlPoint): void { if (![minSize.x, minSize.y, maxSize.x, maxSize.y].every(Number.isFinite)) throw new TypeError('RichTextLabel.set_cell_size_override requires Vector2 values.'); },
    set_cell_padding(padding: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }): void { if (![padding.x, padding.y, padding.z, padding.w].every(Number.isFinite)) throw new TypeError('RichTextLabel.set_cell_padding requires Rect2-like padding.'); },
    push_cell(): void { pushTag('[cell]', '[/cell]'); },
    push_dropcap(value: string, font: GodotFontSource, size: number, _margins = { x: 0, y: 0, z: 0, w: 0 }, color: ColorValue = { r: 1, g: 1, b: 1, a: 1 }, outlineSize = 0, outlineColor: ColorValue = { r: 0, g: 0, b: 0, a: 1 }): void { if (typeof value !== 'string' || typeof font !== 'object' || font === null || !Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(outlineSize)) throw new TypeError('RichTextLabel.push_dropcap arguments are invalid.'); colorTag(color, 'RichTextLabel.push_dropcap color'); colorTag(outlineColor, 'RichTextLabel.push_dropcap outline_color'); beginImperativeMarkup(); bbcodeText += `[dropcap font=${JSON.stringify(font.family)} size=${size} outline_size=${outlineSize}]${escapedLiteral(value)}[/dropcap]`; syncBbcodeText(); },
    push_customfx(effect: unknown, env: Readonly<Record<string, unknown>> = {}): void { const index = customEffects.indexOf(effect); if (index < 0) customEffects = [...customEffects, effect]; pushTag(`[customfx effect=${Math.max(0, index)} env=${JSON.stringify(env)}]`, '[/customfx]'); },
    update_image(key: unknown, _mask: number, image: unknown, width = 0, height = 0): boolean { const entry = inlineImages.find((candidate) => Object.is(candidate.key, key)); if (entry === undefined) return false; const projected = projectGodotTexture(image, 'RichTextLabel.update_image'); entry.texture = projected.pixiTexture ?? projected.identity; if (projected.domSource === undefined) delete entry.source; else entry.source = projected.domSource; if (width > 0) entry.width = width; else delete entry.width; if (height > 0) entry.height = height; else delete entry.height; syncBbcodeText(); return true; },
  });
}

/** Add LineEdit editing/signals while keeping `text` on the overlay's Control store. */
export function bindLineEdit(
  control: GodotControl,
  initial: LineEditBindOptions = {},
): GodotLineEditControl {
  const changed = createSignal<readonly [string]>();
  const submitted = createSignal<readonly [string]>();
  const rejected = createSignal<readonly [string]>();
  const editingToggled = createSignal<readonly [boolean]>();
  const binding = controlBinding(control);
  if (!CONTROL_FOCUS_MODES.has(control)) {
    CONTROL_FOCUS_MODES.set(control, 2);
    binding.state.write(binding.id, { focusMode: 2 });
  }
  const godotMajor = initial.dialect ?? 3;
  let maxLength = initial.max_length ?? 0;
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError(`LineEdit.max_length must be a non-negative integer; received ${maxLength}.`);
  }
  if (initial.text !== undefined) control.text = fitLineEditText(initial.text, maxLength);
  let caret = Math.max(0, Math.min(initial.caret_column ?? 0, lineEditLength(control.text)));
  let selection: readonly [number, number] | null = null;
  let placeholderText = initial.placeholder_text ?? '';
  let editable = initial.editable ?? true;
  let secret = initial.secret ?? false;
  let selectingEnabled = initial.selecting_enabled ?? true;
  let clearButtonEnabled = initial.clear_button_enabled ?? false;
  let secretCharacter = initial.secret_character ?? '•';
  let expandToTextLength = initial.expand_to_text_length ?? false;
  let contextMenuEnabled = initial.context_menu_enabled ?? true;
  let virtualKeyboardEnabled = initial.virtual_keyboard_enabled ?? true;
  let virtualKeyboardType = initial.virtual_keyboard_type ?? 0;
  let emojiMenuEnabled = initial.emoji_menu_enabled ?? true;
  let middleMousePasteEnabled = initial.middle_mouse_paste_enabled ?? true;
  let keepEditingOnSubmit = initial.keep_editing_on_text_submit ?? false;
  let selectAllOnFocus = initial.select_all_on_focus ?? false;
  let drawControlChars = initial.draw_control_chars ?? false;
  let flat = initial.flat ?? false;
  let alignment = initial.alignment ?? 0;
  let textDirection = initial.text_direction ?? 0;
  let language = initial.language ?? '';
  let caretBlink = initial.caret_blink ?? false;
  let caretBlinkInterval = initial.caret_blink_interval ?? 0.65;
  let caretForceDisplayed = initial.caret_force_displayed ?? false;
  const validateAlignment = (value: number): number => {
    if (!Number.isSafeInteger(value)) throw new TypeError('LineEdit.alignment requires int.');
    const maximum = godotMajor === 4 ? 3 : 2;
    if (value < 0 || value > maximum) {
      throw new RangeError(`LineEdit.alignment requires an integer from 0 through ${String(maximum)} in Godot ${String(godotMajor)}.`);
    }
    if (value === 3) {
      throw new Error('LineEdit HORIZONTAL_ALIGNMENT_FILL requires TextServer shaped_text_fit_to_width justification, which a native single-line input cannot reproduce exactly.');
    }
    return value;
  };
  alignment = validateAlignment(alignment);
  const applyNativeAlignment = (): void => {
    const element = binding.state.read(binding.id).focusElement;
    if (typeof HTMLInputElement === 'undefined' || !(element instanceof HTMLInputElement)) return;
    element.style.textAlign = alignment === 1 ? 'center' : alignment === 2 ? 'end' : 'start';
  };
  const utf16Offset = (column: number): number => [...control.text].slice(0, column).join('').length;
  const syncNativeSelection = (): void => {
    const element = binding.state.read(binding.id).focusElement;
    if (typeof HTMLInputElement === 'undefined' || !(element instanceof HTMLInputElement)) return;
    const [from, to] = selection ?? [caret, caret];
    element.setSelectionRange(utf16Offset(from), utf16Offset(to));
  };
  const setSelectionFromNative = (
    start?: number | null,
    end?: number | null,
    direction?: 'forward' | 'backward' | 'none' | null,
  ): void => {
    const utf16Start = start ?? 0;
    const utf16End = end ?? utf16Start;
    const from = lineEditLength(control.text.slice(0, Math.max(0, utf16Start)));
    const to = lineEditLength(control.text.slice(0, Math.max(0, utf16End)));
    caret = direction === 'backward' ? from : to;
    selection = from === to ? null : [Math.min(from, to), Math.max(from, to)];
  };
  Object.defineProperties(control, {
    caret_column: {
      enumerable: true,
      configurable: true,
      get: () => caret,
      set: (value: number) => {
        caret = Math.max(0, Math.min(Math.trunc(value), lineEditLength(control.text)));
        syncNativeSelection();
      },
    },
    caret_position: {
      enumerable: true,
      configurable: true,
      get: () => caret,
      set: (value: number) => {
        caret = Math.max(0, Math.min(Math.trunc(value), lineEditLength(control.text)));
        syncNativeSelection();
      },
    },
    max_length: {
      enumerable: true,
      configurable: true,
      get: () => maxLength,
      set: (value: number) => {
        if (!Number.isInteger(value) || value < 0) {
          throw new RangeError(`LineEdit.max_length must be a non-negative integer; received ${value}.`);
        }
        maxLength = value;
        control.text = fitLineEditText(control.text, maxLength);
        caret = 0;
      },
    },
    placeholder_text: {
      enumerable: true,
      configurable: true,
      get: () => placeholderText,
      set: (value: string) => {
        placeholderText = String(value);
        binding.state.write(binding.id, { linePlaceholder: placeholderText });
      },
    },
    editable: {
      enumerable: true,
      configurable: true,
      get: () => editable,
      set: (value: boolean) => {
        editable = Boolean(value);
        binding.state.write(binding.id, { lineEditable: editable });
      },
    },
    secret: {
      enumerable: true,
      configurable: true,
      get: () => secret,
      set: (value: boolean) => {
        secret = Boolean(value);
        binding.state.write(binding.id, { lineSecret: secret });
      },
    },
    selecting_enabled: {
      enumerable: true,
      configurable: true,
      get: () => selectingEnabled,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('LineEdit.selecting_enabled requires bool.');
        selectingEnabled = value;
        if (!value) {
          selection = null;
          syncNativeSelection();
        }
        binding.state.write(binding.id, { lineSelecting: value });
      },
    },
    clear_button_enabled: {
      enumerable: true,
      configurable: true,
      get: () => clearButtonEnabled,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('LineEdit.clear_button_enabled requires bool.');
        clearButtonEnabled = value;
        binding.state.write(binding.id, { lineClearButtonEnabled: value });
      },
    },
    secret_character: { enumerable: true, configurable: true, get: () => secretCharacter, set: (value: string) => { if (typeof value !== 'string' || [...value].length !== 1) throw new TypeError('LineEdit.secret_character requires one character.'); secretCharacter = value; binding.state.write(binding.id, { lineSecretCharacter: value }); } },
    expand_to_text_length: { enumerable: true, configurable: true, get: () => expandToTextLength, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.expand_to_text_length requires bool.'); expandToTextLength = value; binding.state.write(binding.id, { lineExpandToTextLength: value }); } },
    context_menu_enabled: { enumerable: true, configurable: true, get: () => contextMenuEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.context_menu_enabled requires bool.'); contextMenuEnabled = value; } },
    virtual_keyboard_enabled: { enumerable: true, configurable: true, get: () => virtualKeyboardEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.virtual_keyboard_enabled requires bool.'); virtualKeyboardEnabled = value; } },
    virtual_keyboard_type: { enumerable: true, configurable: true, get: () => virtualKeyboardType, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('LineEdit.virtual_keyboard_type requires int.'); virtualKeyboardType = value; } },
    emoji_menu_enabled: { enumerable: true, configurable: true, get: () => emojiMenuEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.emoji_menu_enabled requires bool.'); emojiMenuEnabled = value; } },
    middle_mouse_paste_enabled: { enumerable: true, configurable: true, get: () => middleMousePasteEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.middle_mouse_paste_enabled requires bool.'); middleMousePasteEnabled = value; } },
    keep_editing_on_text_submit: { enumerable: true, configurable: true, get: () => keepEditingOnSubmit, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.keep_editing_on_text_submit requires bool.'); keepEditingOnSubmit = value; } },
    select_all_on_focus: { enumerable: true, configurable: true, get: () => selectAllOnFocus, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.select_all_on_focus requires bool.'); selectAllOnFocus = value; } },
    draw_control_chars: { enumerable: true, configurable: true, get: () => drawControlChars, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.draw_control_chars requires bool.'); drawControlChars = value; } },
    flat: { enumerable: true, configurable: true, get: () => flat, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.flat requires bool.'); flat = value; binding.state.write(binding.id, { lineFlat: value }); } },
    alignment: { enumerable: true, configurable: true, get: () => alignment, set: (value: number) => { alignment = validateAlignment(value); binding.state.write(binding.id, { lineAlignment: alignment }); applyNativeAlignment(); } },
    text_direction: { enumerable: true, configurable: true, get: () => textDirection, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('LineEdit.text_direction requires int.'); textDirection = value; } },
    language: { enumerable: true, configurable: true, get: () => language, set: (value: string) => { if (typeof value !== 'string') throw new TypeError('LineEdit.language requires String.'); language = value; } },
    caret_blink: { enumerable: true, configurable: true, get: () => caretBlink, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.caret_blink requires bool.'); caretBlink = value; } },
    caret_blink_interval: { enumerable: true, configurable: true, get: () => caretBlinkInterval, set: (value: number) => { if (!Number.isFinite(value) || value <= 0) throw new RangeError('LineEdit.caret_blink_interval must be positive.'); caretBlinkInterval = value; } },
    caret_force_displayed: { enumerable: true, configurable: true, get: () => caretForceDisplayed, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('LineEdit.caret_force_displayed requires bool.'); caretForceDisplayed = value; } },
  });
  const line = Object.assign(control, {
    text_changed: changed.signal,
    text_submitted: submitted.signal,
    text_entered: submitted.signal,
    text_change_rejected: rejected.signal,
    editing_toggled: editingToggled.signal,
    clear(): void {
      const wasEmpty = control.text.length === 0;
      control.text = '';
      caret = 0;
      selection = null;
      syncNativeSelection();
      if (godotMajor === 3 || !wasEmpty) changed.emit('');
    },
    get_text(): string {
      return control.text;
    },
    set_text(value: string): void {
      control.text = fitLineEditText(String(value), maxLength);
      caret = 0;
      selection = null;
      syncNativeSelection();
    },
    is_editable(): boolean {
      return editable;
    },
    get_max_length(): number {
      return maxLength;
    },
    set_max_length(value: number): void {
      line.max_length = value;
    },
    get_placeholder(): string {
      return placeholderText;
    },
    set_placeholder(value: string): void {
      line.placeholder_text = String(value);
    },
    is_secret(): boolean {
      return secret;
    },
    set_secret(value: boolean): void {
      line.secret = value;
    },
    is_clear_button_enabled(): boolean {
      return clearButtonEnabled;
    },
    set_clear_button_enabled(value: boolean): void {
      line.clear_button_enabled = value;
    },
    select(from = 0, to = -1): void {
      if (!selectingEnabled) return;
      let begin = Math.trunc(from);
      let end = Math.trunc(to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new RangeError('LineEdit.select requires finite integer columns.');
      }
      if (begin === 0 && end === 0) {
        selection = null;
        syncNativeSelection();
        return;
      }
      const length = lineEditLength(control.text);
      begin = Math.max(0, Math.min(begin, length));
      if (end < 0 || end > length) end = length;
      if (begin >= end) return;
      selection = [begin, end];
      syncNativeSelection();
    },
    select_all(): void {
      if (!selectingEnabled) return;
      if (control.text === '') {
        caret = 0;
        syncNativeSelection();
        return;
      }
      selection = [0, lineEditLength(control.text)];
      syncNativeSelection();
    },
    deselect(): void {
      selection = null;
      syncNativeSelection();
    },
    has_selection(): boolean {
      return selection !== null && selection[0] !== selection[1];
    },
    get_caret_column(): number {
      return caret;
    },
    set_caret_column(column: number): void {
      if (!Number.isFinite(column)) throw new RangeError('LineEdit.set_caret_column requires a finite integer column.');
      caret = Math.max(0, Math.min(Math.trunc(column), lineEditLength(control.text)));
      selection = null;
      syncNativeSelection();
    },
    get_cursor_position(): number {
      return caret;
    },
    set_cursor_position(column: number): void {
      line.set_caret_column(column);
    },
    get_selected_text(): string {
      if (selection === null) return '';
      return [...control.text].slice(selection[0], selection[1]).join('');
    },
    get_selection_from_column(): number {
      return selection?.[0] ?? 0;
    },
    get_selection_to_column(): number {
      return selection?.[1] ?? 0;
    },
    set_selecting_enabled(value: boolean): void {
      line.selecting_enabled = value;
    },
    is_selecting_enabled(): boolean {
      return selectingEnabled;
    },
    insert_text_at_caret(value: string): void {
      const line = this as GodotLineEdit;
      if (!line.editable) return;
      const [from, to] = selection ?? [caret, caret];
      control.text = fitLineEditText(
        lineEditSplice(control.text, from, to, value),
        maxLength,
      );
      caret = Math.min(from + lineEditLength(value), lineEditLength(control.text));
      selection = null;
      syncNativeSelection();
      changed.emit(control.text);
    },
    append_at_cursor(value: string): void {
      line.insert_text_at_caret(value);
    },
    delete_char_at_caret(): void {
      const line = this as GodotLineEdit;
      if (!line.editable) return;
      if (selection !== null) {
        line.insert_text_at_caret('');
      } else if (caret > 0) {
        control.text = lineEditSplice(control.text, caret - 1, caret, '');
        caret -= 1;
        syncNativeSelection();
        changed.emit(control.text);
      }
    },
    delete_text(fromColumn: number, toColumn: number): void {
      if (!Number.isFinite(fromColumn) || !Number.isFinite(toColumn)) {
        throw new RangeError('LineEdit.delete_text requires finite integer columns.');
      }
      const length = lineEditLength(control.text);
      const from = Math.max(0, Math.min(Math.trunc(fromColumn), length));
      const to = Math.max(from, Math.min(Math.trunc(toColumn), length));
      if (from === to) return;
      control.text = lineEditSplice(control.text, from, to, '');
      caret = caret <= from ? caret : caret <= to ? from : caret - (to - from);
      selection = null;
      syncNativeSelection();
      changed.emit(control.text);
    },
    submit(): void {
      submitted.emit(control.text);
      if (!keepEditingOnSubmit) editingToggled.emit(false);
    },
    set_editable(value: boolean): void { line.editable = value; },
    set_secret_character(value: string): void { line.secret_character = value; },
    get_secret_character(): string { return secretCharacter; },
    set_expand_to_text_length_enabled(value: boolean): void { line.expand_to_text_length = value; },
    is_expand_to_text_length_enabled(): boolean { return expandToTextLength; },
    set_context_menu_enabled(value: boolean): void { line.context_menu_enabled = value; },
    is_context_menu_enabled(): boolean { return contextMenuEnabled; },
    set_virtual_keyboard_enabled(value: boolean): void { line.virtual_keyboard_enabled = value; },
    is_virtual_keyboard_enabled(): boolean { return virtualKeyboardEnabled; },
    set_virtual_keyboard_type(value: number): void { line.virtual_keyboard_type = value; },
    get_virtual_keyboard_type(): number { return virtualKeyboardType; },
    set_emoji_menu_enabled(value: boolean): void { line.emoji_menu_enabled = value; },
    is_emoji_menu_enabled(): boolean { return emojiMenuEnabled; },
    set_middle_mouse_paste_enabled(value: boolean): void { line.middle_mouse_paste_enabled = value; },
    is_middle_mouse_paste_enabled(): boolean { return middleMousePasteEnabled; },
    set_keep_editing_on_text_submit(value: boolean): void { line.keep_editing_on_text_submit = value; },
    is_editing_kept_on_text_submit(): boolean { return keepEditingOnSubmit; },
    set_select_all_on_focus(value: boolean): void { line.select_all_on_focus = value; },
    is_select_all_on_focus(): boolean { return selectAllOnFocus; },
    set_draw_control_chars(value: boolean): void { line.draw_control_chars = value; },
    get_draw_control_chars(): boolean { return drawControlChars; },
    set_flat(value: boolean): void { line.flat = value; },
    is_flat(): boolean { return flat; },
    set_alignment(value: number): void { line.alignment = value; },
    get_alignment(): number { return alignment; },
    set_align(value: number): void { line.alignment = value; },
    get_align(): number { return alignment; },
    set_horizontal_alignment(value: number): void { line.alignment = value; },
    get_horizontal_alignment(): number { return alignment; },
    set_text_direction(value: number): void { line.text_direction = value; },
    get_text_direction(): number { return textDirection; },
    set_language(value: string): void { line.language = value; },
    get_language(): string { return language; },
    set_caret_blink_enabled(value: boolean): void { line.caret_blink = value; },
    is_caret_blink_enabled(): boolean { return caretBlink; },
    set_caret_blink_interval(value: number): void { line.caret_blink_interval = value; },
    get_caret_blink_interval(): number { return caretBlinkInterval; },
    set_caret_force_displayed(value: boolean): void { line.caret_force_displayed = value; },
    is_caret_force_displayed(): boolean { return caretForceDisplayed; },
    menu_option(option: number): void {
      if (!Number.isSafeInteger(option)) throw new TypeError('LineEdit.menu_option requires int.');
      if (option === 0) line.select_all();
      else if (option === 1) line.deselect();
      else if (option === 4) line.delete_char_at_caret();
      else if (option === 5) line.clear();
    },
  }) as unknown as GodotLineEditControl;
  binding.state.write(binding.id, {
    onLineEditInput(value, selectionStart, selectionEnd): void {
      if (!line.editable) return;
      control.text = fitLineEditText(value, line.max_length);
      setSelectionFromNative(selectionStart, selectionEnd);
      changed.emit(control.text);
    },
    onLineEditSelection(selectionStart, selectionEnd, selectionDirection): void {
      if (!selectingEnabled) {
        const nativeCaret = selectionDirection === 'backward'
          ? selectionStart ?? 0
          : selectionEnd ?? selectionStart ?? 0;
        caret = lineEditLength(control.text.slice(0, Math.max(0, nativeCaret)));
        selection = null;
        if ((selectionStart ?? 0) !== (selectionEnd ?? selectionStart ?? 0)) syncNativeSelection();
        return;
      }
      setSelectionFromNative(selectionStart, selectionEnd, selectionDirection);
    },
    syncLineEditSelection: syncNativeSelection,
    onLineEditSubmit(): void {
      line.submit();
    },
    focusElement: null,
    bindFocusElement(element): void {
      binding.state.write(binding.id, { focusElement: element });
      applyNativeAlignment();
      syncNativeSelection();
    },
    linePlaceholder: line.placeholder_text,
    lineEditable: line.editable,
    lineSecret: line.secret,
    lineSelecting: line.selecting_enabled,
    lineClearButtonEnabled: line.clear_button_enabled,
    lineAlignment: alignment,
  });
  line.focus = (): void => focusRetainedControlElement(control);
  return line;
}

export function bindHSlider(
  control: GodotControl,
  initial: Partial<RangeState & GodotHSlider> = {},
): GodotRangeControl {
  const slider = control as GodotRangeControl;
  const binding = controlBinding(control);
  if (!CONTROL_FOCUS_MODES.has(control)) {
    CONTROL_FOCUS_MODES.set(control, 2);
    binding.state.write(binding.id, { focusMode: 2 });
  }
  const changed = createSignal<readonly [number]>();
  const configurationChanged = createSignal<readonly []>();
  const dragStarted = createSignal<readonly []>();
  const dragEnded = createSignal<readonly [boolean]>();
  const scrolling = createSignal<readonly []>();
  const bool = (name: string, next: boolean): boolean => {
    if (typeof next !== 'boolean') throw new TypeError(`Range.${name} must be bool.`);
    return next;
  };
  let minValue = initial.min_value ?? 0;
  let maxValue = initial.max_value ?? 100;
  const godotMajor = initial.godot_major ?? 3;
  if (godotMajor === 4 && maxValue < minValue) maxValue = minValue;
  let step = initial.step ?? 0.01;
  let page = initial.page ?? 0;
  let allowGreater = initial.allow_greater ?? false;
  let allowLesser = initial.allow_lesser ?? false;
  let rounded = initial.rounded ?? false;
  let expEdit = bool('exp_edit', initial.exp_edit ?? false);
  let value = minValue;
  let dragInitialValue = value;
  const finite = (name: string, next: number): number => {
    if (!Number.isFinite(next)) throw new RangeError(`Range.${name} must be finite; received ${next}.`);
    return next;
  };
  minValue = finite('min_value', minValue);
  maxValue = finite('max_value', maxValue);
  step = finite('step', step);
  page = finite('page', page);
  if (godotMajor === 4) page = Math.max(0, Math.min(page, maxValue - minValue));
  let vertical = bool('vertical', initial.vertical ?? false);
  let editable = bool('editable', initial.editable ?? true);
  let scrollable = bool('scrollable', initial.scrollable ?? true);
  let tickCount = finite('tick_count', initial.tick_count ?? 0);
  if (!Number.isSafeInteger(tickCount) || tickCount < 0) throw new RangeError('Slider.tick_count must be a non-negative integer.');
  let ticksOnBorders = bool('ticks_on_borders', initial.ticks_on_borders ?? false);
  let ticksPosition = finite('ticks_position', initial.ticks_position ?? 0);
  if (!Number.isSafeInteger(ticksPosition) || ticksPosition < 0 || ticksPosition > 3) throw new RangeError('Slider.ticks_position must be 0 through 3.');
  let customStep = finite('custom_step', initial.custom_step ?? -1);
  if (customStep < 0 && customStep !== -1) throw new RangeError('ScrollBar.custom_step must be -1 or non-negative.');
  const sync = (): void => {
    binding.state.write(binding.id, {
      rangeValue: value,
      rangeMin: minValue,
      rangeMax: maxValue,
      rangeStep: step > 0 ? step : 'any',
      rangeVertical: vertical,
      rangeEditable: editable,
      rangeTickCount: tickCount,
      rangeTicksOnBorders: ticksOnBorders,
    });
  };
  const setValue = (next: number, emit: boolean): void => {
    const normalized = normalizeRangeValue(slider, finite('value', next));
    if (normalized === value) return;
    value = normalized;
    sync();
    if (emit) changed.emit(value);
  };
  Object.assign(slider, {
    godot_major: godotMajor,
    value_changed: changed.signal,
    changed: configurationChanged.signal,
    drag_started: dragStarted.signal,
    drag_ended: dragEnded.signal,
    scrolling: scrolling.signal,
    set_value(next: number): void { setValue(next, true); },
    set_value_no_signal(next: number): void { setValue(next, false); },
    set_min(next: number): void { slider.min_value = next; },
    set_max(next: number): void { slider.max_value = next; },
    set_as_ratio(next: number): void { slider.ratio = next; },
    set_allow_greater(next: boolean): void { slider.allow_greater = next; },
    set_allow_lesser(next: boolean): void { slider.allow_lesser = next; },
    set_step(next: number): void { slider.step = next; },
    set_page(next: number): void { slider.page = next; },
    get_value(): number { return slider.value; },
    get_min(): number { return slider.min_value; },
    get_max(): number { return slider.max_value; },
    get_step(): number { return slider.step; },
    get_page(): number { return slider.page; },
    get_as_ratio(): number { return slider.ratio; },
    is_greater_allowed(): boolean { return slider.allow_greater; },
    is_lesser_allowed(): boolean { return slider.allow_lesser; },
    set_exp_ratio(next: boolean): void { slider.exp_edit = next; },
    is_ratio_exp(): boolean { return slider.exp_edit; },
    set_use_rounded_values(next: boolean): void { slider.rounded = next; },
    is_using_rounded_values(): boolean { return slider.rounded; },
    share(): never { throw new Error('Range.share requires shared native Range storage and is not approximated by retained controls.'); },
    unshare(): void {},
    is_editable(): boolean { return slider.editable; },
    set_editable(next: boolean): void { slider.editable = next; },
    is_scrollable(): boolean { return slider.scrollable; },
    set_scrollable(next: boolean): void { slider.scrollable = next; },
    get_ticks(): number { return slider.tick_count; },
    set_ticks(next: number): void { slider.tick_count = next; },
    get_ticks_on_borders(): boolean { return slider.ticks_on_borders; },
    set_ticks_on_borders(next: boolean): void { slider.ticks_on_borders = next; },
    get_ticks_position(): number { return slider.ticks_position; },
    set_ticks_position(next: number): void { slider.ticks_position = next; },
    get_custom_step(): number { return slider.custom_step; },
    set_custom_step(next: number): void { slider.custom_step = next; },
  });
  Object.defineProperties(slider, {
    exp_edit: {
      enumerable: true,
      configurable: true,
      get: () => expEdit,
      set: (next: boolean) => {
        expEdit = bool('exp_edit', next);
      },
    },
    min_value: {
      enumerable: true,
      configurable: true,
      get: () => minValue,
      set: (next: number) => {
        const authored = finite('min_value', next);
        if (godotMajor === 4 && authored === minValue) return;
        minValue = authored;
        if (godotMajor === 4) {
          if (maxValue < minValue) maxValue = minValue;
          page = Math.max(0, Math.min(page, maxValue - minValue));
        }
        setValue(value, true);
        sync();
        configurationChanged.emit();
      },
    },
    max_value: {
      enumerable: true,
      configurable: true,
      get: () => maxValue,
      set: (next: number) => {
        const authored = finite('max_value', next);
        const validated = godotMajor === 4 ? Math.max(authored, minValue) : authored;
        if (godotMajor === 4 && validated === maxValue) return;
        maxValue = validated;
        if (godotMajor === 4) page = Math.max(0, Math.min(page, maxValue - minValue));
        setValue(value, true);
        sync();
        configurationChanged.emit();
      },
    },
    step: {
      enumerable: true,
      configurable: true,
      get: () => step,
      set: (next: number) => {
        const authored = finite('step', next);
        if (godotMajor === 4 && authored === step) return;
        step = authored;
        sync();
        configurationChanged.emit();
      },
    },
    page: {
      enumerable: true,
      configurable: true,
      get: () => page,
      set: (next: number) => {
        const authored = finite('page', next);
        const validated = godotMajor === 4 ? Math.max(0, Math.min(authored, maxValue - minValue)) : authored;
        if (godotMajor === 4 && validated === page) return;
        page = validated;
        setValue(value, true);
        sync();
        configurationChanged.emit();
      },
    },
    allow_greater: {
      enumerable: true,
      configurable: true,
      get: () => allowGreater,
      set: (next: boolean) => { allowGreater = bool('allow_greater', next); },
    },
    allow_lesser: {
      enumerable: true,
      configurable: true,
      get: () => allowLesser,
      set: (next: boolean) => { allowLesser = bool('allow_lesser', next); },
    },
    rounded: {
      enumerable: true,
      configurable: true,
      get: () => rounded,
      set: (next: boolean) => { rounded = bool('rounded', next); },
    },
    vertical: {
      enumerable: true,
      configurable: true,
      get: () => vertical,
      set: (next: boolean) => { vertical = bool('vertical', next); sync(); },
    },
    editable: {
      enumerable: true,
      configurable: true,
      get: () => editable,
      set: (next: boolean) => { editable = bool('editable', next); sync(); },
    },
    scrollable: { enumerable: true, configurable: true, get: () => scrollable, set: (next: boolean) => { scrollable = bool('scrollable', next); } },
    tick_count: { enumerable: true, configurable: true, get: () => tickCount, set: (next: number) => { const value = finite('tick_count', next); if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Slider.tick_count must be a non-negative integer.'); tickCount = value; sync(); } },
    ticks_on_borders: { enumerable: true, configurable: true, get: () => ticksOnBorders, set: (next: boolean) => { ticksOnBorders = bool('ticks_on_borders', next); sync(); } },
    ticks_position: { enumerable: true, configurable: true, get: () => ticksPosition, set: (next: number) => { const value = finite('ticks_position', next); if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Slider.ticks_position must be 0 through 3.'); ticksPosition = value; } },
    custom_step: { enumerable: true, configurable: true, get: () => customStep, set: (next: number) => { const value = finite('custom_step', next); if (value < 0 && value !== -1) throw new RangeError('ScrollBar.custom_step must be -1 or non-negative.'); customStep = value; } },
    value: {
      enumerable: true,
      configurable: true,
      get: () => value,
      set: (next: number) => setValue(next, true),
    },
    ratio: {
      enumerable: true,
      configurable: true,
      get: () => {
        const span = slider.max_value - slider.min_value;
        if (equalRangeValue(slider.max_value, slider.min_value)) return 1;
        const clamped = Math.max(slider.min_value, Math.min(slider.max_value, value));
        if (expEdit && slider.min_value >= 0) {
          const minimum = slider.min_value > 0 ? Math.log2(slider.min_value) : 0;
          const maximum = Math.log2(slider.max_value);
          return maximum === minimum ? 1 : Math.max(0, Math.min(1, (Math.log2(clamped) - minimum) / (maximum - minimum)));
        }
        return Math.max(0, Math.min(1, (clamped - slider.min_value) / span));
      },
      set: (next: number) => {
        const ratio = finite('ratio', next);
        if (expEdit && slider.min_value >= 0) {
          const minimum = slider.min_value > 0 ? Math.log2(slider.min_value) : 0;
          slider.set_value(2 ** (minimum + (Math.log2(slider.max_value) - minimum) * ratio));
        } else {
          const percent = (slider.max_value - slider.min_value) * ratio;
          const offset = slider.step > 0 ? roundRangeValue(percent / slider.step) * slider.step : percent;
          slider.set_value(Math.max(slider.min_value, Math.min(slider.max_value, offset + slider.min_value)));
        }
      },
    },
  });
  slider.set_value_no_signal(initial.value ?? minValue);
  sync();
  binding.state.write(binding.id, {
    onRangeInput(value): void {
      slider.value = value;
    },
    onRangeDragStart(): void { if (slider.editable) { dragInitialValue = slider.value; dragStarted.emit(); } },
    onRangeDragEnd(): void { if (slider.editable) dragEnded.emit(!equalRangeValue(dragInitialValue, slider.value)); },
    onRangeWheel(deltaY): void {
      if (!slider.scrollable || deltaY === 0) return;
      slider.value += deltaY < 0 ? (customStep >= 0 ? customStep : slider.step) : -(customStep >= 0 ? customStep : slider.step);
      scrolling.emit();
    },
    focusElement: null,
    bindFocusElement(element): void {
      binding.state.write(binding.id, { focusElement: element });
    },
  });
  slider.focus = (): void => focusRetainedControlElement(control);
  return slider;
}

export function bindBaseButton(
  control: GodotControl,
  initial: BaseButtonBindOptions = {},
): GodotButtonControl {
  const button = control as GodotButtonControl;
  const binding = controlBinding(control);
  if (!CONTROL_FOCUS_MODES.has(control)) {
    CONTROL_FOCUS_MODES.set(control, 2);
    binding.state.write(binding.id, { focusMode: 2 });
  }
  const pressed = createSignal<readonly []>();
  const toggled = createSignal<readonly [boolean]>();
  const down = createSignal<readonly []>();
  const up = createSignal<readonly []>();
  let held = false;
  let disabled = initial.disabled ?? false;
  let toggleMode = initial.toggle_mode ?? false;
  let buttonPressed = initial.button_pressed ?? false;
  let actionMode = initial.action_mode ?? 1;
  let acceptedButtonMask = buttonMask(initial.button_mask ?? 1);
  let keepPressedOutside = initial.keep_pressed_outside ?? false;
  let shortcutFeedback = initial.shortcut_feedback ?? true;
  let shortcutInTooltip = initial.shortcut_in_tooltip ?? true;
  let heldButton = -1;
  const releaseShortcut = bindBaseButtonShortcut(button, initial.godot_major ?? 4, () => {
    if (button.disabled) return;
    button.press();
    button.release();
  });
  const applyPressed = (value: boolean, emitSignal: boolean): void => {
    const next = setGodotGroupedButtonPressed(button, Boolean(value));
    if (next === buttonPressed) return;
    buttonPressed = next;
    binding.state.write(binding.id, { buttonPressed });
    if (emitSignal && toggleMode) toggled.emit(buttonPressed);
  };
  if (actionMode !== 0 && actionMode !== 1) {
    throw new RangeError(`BaseButton.action_mode must be 0 or 1; received ${String(actionMode)}.`);
  }
  Object.defineProperty(button, 'disabled', {
    enumerable: true,
    configurable: true,
    get: () => disabled,
    set: (value: boolean) => {
      const next = Boolean(value);
      if (next === disabled) return;
      disabled = next;
      if (disabled && held) {
        held = false;
        up.emit();
      }
      binding.state.write(binding.id, { buttonDisabled: disabled });
    },
  });
  Object.defineProperties(button, {
    toggle_mode: {
      enumerable: true,
      configurable: true,
      get: () => toggleMode,
      set: (value: boolean) => { toggleMode = Boolean(value); },
    },
    button_pressed: {
      enumerable: true,
      configurable: true,
      get: () => buttonPressed,
      set: (value: boolean) => applyPressed(value, true),
    },
    action_mode: {
      enumerable: true,
      configurable: true,
      get: () => actionMode,
      set: (value: number) => {
        if (value !== 0 && value !== 1) {
          throw new RangeError(`BaseButton.action_mode must be 0 or 1; received ${String(value)}.`);
        }
        actionMode = value;
      },
    },
    button_mask: {
      enumerable: true,
      configurable: true,
      get: () => acceptedButtonMask,
      set: (value: number) => {
        acceptedButtonMask = buttonMask(value);
        binding.state.write(binding.id, { buttonMask: acceptedButtonMask });
      },
    },
    keep_pressed_outside: {
      enumerable: true,
      configurable: true,
      get: () => keepPressedOutside,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('BaseButton.keep_pressed_outside requires bool.');
        keepPressedOutside = value;
        binding.state.write(binding.id, { buttonKeepPressedOutside: value });
      },
    },
    button_group: {
      enumerable: true,
      configurable: true,
      get: () => getGodotButtonGroup(button),
      set: (value: GodotButtonGroup | null) => setGodotButtonGroup(button, value),
    },
    shortcut: {
      enumerable: true,
      configurable: true,
      get: () => getBaseButtonShortcut(button),
      set: (value: GodotShortcut | null) => setBaseButtonShortcut(button, value),
    },
    shortcut_feedback: { enumerable: true, configurable: true, get: () => shortcutFeedback, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('BaseButton.shortcut_feedback requires bool.'); shortcutFeedback = value; binding.state.write(binding.id, { buttonShortcutFeedback: value }); } },
    shortcut_in_tooltip: { enumerable: true, configurable: true, get: () => shortcutInTooltip, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('BaseButton.shortcut_in_tooltip requires bool.'); shortcutInTooltip = value; binding.state.write(binding.id, { buttonShortcutInTooltip: value }); } },
  });
  Object.assign(button, {
    pressed: pressed.signal,
    toggled: toggled.signal,
    button_down: down.signal,
    button_up: up.signal,
    press(mouseButton = 0): boolean {
      if (button.disabled || held || (acceptedButtonMask & mouseButtonBit(mouseButton)) === 0) return false;
      held = true;
      heldButton = mouseButton;
      down.emit();
      if (button.action_mode === 0) emitButtonPressed(button, pressed, toggled);
      return true;
    },
    release(mouseButton = heldButton): boolean {
      if (!held || mouseButton !== heldButton) return false;
      held = false;
      heldButton = -1;
      up.emit();
      if (!button.disabled && button.action_mode !== 0) {
        emitButtonPressed(button, pressed, toggled);
      }
      return true;
    },
    cancel(): void {
      if (!held) return;
      held = false;
      heldButton = -1;
      up.emit();
    },
    pointer_outside(mouseButton = heldButton): void {
      if (!held || mouseButton !== heldButton) return;
      if (keepPressedOutside) button.release(mouseButton);
      else button.cancel();
    },
    set_pressed(value: boolean): void { applyPressed(value, true); },
    set_pressed_no_signal(value: boolean): void { applyPressed(value, false); },
    set_disabled(value: boolean): void { button.disabled = value; },
    is_hovered(): boolean {
      const element = binding.state.read(binding.id).focusElement;
      return element !== undefined && element !== null && element.isConnected && element.matches(':hover');
    },
    is_pressed(): boolean { return buttonPressed; },
    set_toggle_mode(value: boolean): void { button.toggle_mode = value; },
    is_toggle_mode(): boolean { return toggleMode; },
    is_disabled(): boolean { return disabled; },
    set_action_mode(value: number): void { button.action_mode = value; },
    get_action_mode(): number { return actionMode; },
    set_button_mask(value: number): void { button.button_mask = value; },
    get_button_mask(): number { return acceptedButtonMask; },
    get_draw_mode(): number {
      if (disabled) return 3;
      const element = binding.state.read(binding.id).focusElement;
      const hovered = element !== undefined && element !== null && element.isConnected && element.matches(':hover');
      const visuallyPressed = held || buttonPressed;
      if (hovered && visuallyPressed) return 4;
      if (visuallyPressed) return 1;
      return hovered ? 2 : 0;
    },
    set_keep_pressed_outside(value: boolean): void { button.keep_pressed_outside = value; },
    is_keep_pressed_outside(): boolean { return keepPressedOutside; },
    set_shortcut(value: GodotShortcut | null): void { setBaseButtonShortcut(button, value); },
    get_shortcut(): GodotShortcut | null { return getBaseButtonShortcut(button); },
    set_shortcut_feedback(value: boolean): void { button.shortcut_feedback = value; },
    is_shortcut_feedback(): boolean { return shortcutFeedback; },
    set_shortcut_in_tooltip(value: boolean): void { button.shortcut_in_tooltip = value; },
    is_shortcut_in_tooltip_enabled(): boolean { return shortcutInTooltip; },
    get_button_group(): GodotButtonGroup | null { return getGodotButtonGroup(button); },
  });
  binding.state.write(binding.id, {
    onButtonPointerDown(mouseButton = 0): boolean {
      return button.press(mouseButton);
    },
    onButtonPointerUp(mouseButton = 0): boolean {
      return button.release(mouseButton);
    },
    onButtonPointerCancel(): void {
      button.cancel();
    },
    onButtonPointerOutside(mouseButton = 0): void {
      button.pointer_outside(mouseButton);
    },
    buttonMask: acceptedButtonMask,
    buttonKeepPressedOutside: keepPressedOutside,
    buttonShortcutFeedback: shortcutFeedback,
    buttonShortcutInTooltip: shortcutInTooltip,
    focusElement: null,
    bindFocusElement(element): void {
      binding.state.write(binding.id, { focusElement: element });
    },
    buttonDisabled: button.disabled,
    buttonPressed: button.button_pressed,
  });
  binding.state.retain(() => setGodotButtonGroup(button, null));
  binding.state.retain(releaseShortcut);
  if (initial.shortcut !== undefined) setBaseButtonShortcut(button, initial.shortcut);
  button.focus = (): void => focusRetainedControlElement(control);
  return button;
}

/** CheckBox/CheckButton are BaseButtons whose native presentation reflects toggle state. */
export function bindCheckControl(
  control: GodotControl,
  initial: BaseButtonBindOptions = {},
): GodotCheckControl {
  return bindBaseButton(control, { ...initial, toggle_mode: initial.toggle_mode ?? true });
}

/** Godot 3 ToolButton is a Button whose constructor changes the `flat` default to true. */
export function bindToolButton(
  control: GodotControl,
  initial: Partial<BaseButtonState> & { readonly flat?: boolean } = {},
): GodotButtonControl & { flat: boolean } {
  if (initial.flat === false) {
    throw new Error('ToolButton.flat=false requires the non-flat themed Button presentation.');
  }
  const button = bindBaseButton(control, initial) as GodotButtonControl & { flat: boolean };
  Object.defineProperty(button, 'flat', {
    enumerable: true,
    configurable: true,
    get: () => true,
    set: (value: boolean) => {
      if (value !== true) {
        throw new Error('ToolButton.flat=false requires the non-flat themed Button presentation.');
      }
    },
  });
  return button;
}

/** ProgressBar shares Range's exact value protocol but exposes no input affordance. */
export function bindProgressBar(
  control: GodotControl,
  initial: Partial<RangeState> & { readonly show_percentage?: boolean } = {},
): GodotProgressBarControl {
  const progress = bindHSlider(control, { ...initial, scrollable: false }) as GodotProgressBarControl;
  const binding = controlBinding(control);
  let showPercentage = initial.show_percentage ?? true;
  Object.defineProperty(progress, 'show_percentage', {
    enumerable: true,
    configurable: true,
    get: () => showPercentage,
    set: (value: boolean) => {
      if (typeof value !== 'boolean') throw new TypeError('ProgressBar.show_percentage must be bool.');
      showPercentage = value;
      binding.state.write(binding.id, { progressShowPercentage: showPercentage });
    },
  });
  Object.defineProperty(progress, 'percent_visible', {
    enumerable: true,
    configurable: true,
    get: () => showPercentage,
    set: (value: boolean) => { progress.show_percentage = value; },
  });
  binding.state.write(binding.id, { progressShowPercentage: showPercentage });
  return progress;
}

/** HSeparator/VSeparator carry their source orientation onto the retained native element. */
export function bindSeparator(
  control: GodotControl,
  orientation: 'horizontal' | 'vertical',
): GodotControl {
  const binding = controlBinding(control);
  binding.state.write(binding.id, { separatorOrientation: orientation });
  return control;
}
