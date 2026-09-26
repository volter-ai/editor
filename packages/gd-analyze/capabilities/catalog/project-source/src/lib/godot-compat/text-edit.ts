/** Godot TextEdit state over one retained renderer-owned text entity. */

import { controlBinding, type ControlPoint, type GodotControl } from './control-state';
import { focusRetainedControlElement, type FocusableControl } from './control-widgets';
import { createSignal, type GodotSignal } from './signal';
import { controlMinimumSizeChanged } from './control-layout';

export interface TextEditState {
  text: string;
  placeholder_text: string;
  /** Godot 4 spelling. */
  editable: boolean;
  /** Godot 3 spelling, inverse of editable. */
  readonly: boolean;
  caret_line: number;
  caret_column: number;
  wrap_mode: number;
  scroll_vertical: number;
  scroll_fit_content_width: boolean;
  scroll_fit_content_height: boolean;
  scroll_horizontal: number;
  scroll_past_end_of_file: boolean;
  smooth_scroll_enabled: boolean;
  v_scroll_speed: number;
  minimap_draw: boolean;
  minimap_width: number;
  highlight_current_line: boolean;
  draw_control_chars: boolean;
  draw_tabs: boolean;
  draw_spaces: boolean;
  caret_blink: boolean;
  caret_blink_interval: number;
  caret_force_displayed: boolean;
  caret_mid_grapheme: boolean;
  selecting_enabled: boolean;
  deselect_on_focus_loss_enabled: boolean;
  context_menu_enabled: boolean;
  shortcut_keys_enabled: boolean;
  virtual_keyboard_enabled: boolean;
  middle_mouse_paste_enabled: boolean;
}

export interface GodotTextEdit extends GodotControl, TextEditState, FocusableControl {
  readonly text_changed: GodotSignal<readonly []>;
  readonly caret_changed: GodotSignal<readonly []>;
  readonly gutter_clicked: GodotSignal<readonly [number, number]>;
  readonly symbol_lookup: GodotSignal<readonly [string, number, number]>;
  readonly symbol_validate: GodotSignal<readonly [string]>;
  readonly completion_requested: GodotSignal<readonly []>;
  clear(): void;
  set_text(text: string): void;
  get_text(): string;
  set_editable(enabled: boolean): void;
  is_editable(): boolean;
  set_readonly(enabled: boolean): void;
  is_readonly(): boolean;
  set_placeholder(text: string): void;
  get_placeholder(): string;
  set_line_wrapping_mode(mode: number): void;
  get_line_wrapping_mode(): number;
  set_wrap_enabled(enabled: boolean): void;
  is_wrap_enabled(): boolean;
  set_v_scroll(line: number): void;
  get_v_scroll(): number;
  set_fit_content_width_enabled(enabled: boolean): void;
  is_fit_content_width_enabled(): boolean;
  get_line_count(): number;
  get_line(line: number): string;
  get_caret_line(caretIndex?: number): number;
  get_caret_column(caretIndex?: number): number;
  set_caret_line(line: number, adjustViewport?: boolean, canBeHidden?: boolean, wrapIndex?: number, caretIndex?: number): void;
  set_caret_column(column: number, adjustViewport?: boolean, caretIndex?: number): void;
  cursor_get_line(): number;
  cursor_get_column(): number;
  cursor_set_line(line: number, adjustViewport?: boolean, canBeHidden?: boolean, wrapIndex?: number): void;
  cursor_set_column(column: number, adjustViewport?: boolean): void;
  deselect(caretIndex?: number): void;
  select_all(): void;
  select(originLine: number, originColumn: number, caretLine: number, caretColumn: number, caretIndex?: number): void;
  has_selection(caretIndex?: number): boolean;
  delete_selection(caretIndex?: number): void;
  get_selection_text(caretIndex?: number): string;
  get_selected_text(caretIndex?: number): string;
  get_selection_from_line(caretIndex?: number): number;
  get_selection_from_column(caretIndex?: number): number;
  get_selection_to_line(caretIndex?: number): number;
  get_selection_to_column(caretIndex?: number): number;
  insert_text_at_caret(text: string, caretIndex?: number): void;
  insert_text_at_cursor(text: string): void;
  is_selection_active(): boolean;
  remove_text(fromLine: number, fromColumn: number, toLine: number, toColumn: number): void;
  set_line(line: number, text: string): void;
  insert_line_at(line: number, text: string): void;
  remove_line_at(line: number, moveCaretsDown?: boolean): void;
  swap_lines(fromLine: number, toLine: number): void;
  insert_text(text: string, line: number, column: number, beforeSelectionBegin?: boolean, beforeSelectionEnd?: boolean): void;
  get_line_width(line: number, wrapIndex?: number): number;
  get_line_height(): number;
  get_word_at_pos(position: ControlPoint): string;
  get_word_under_caret(caretIndex?: number): string;
  get_first_visible_line(): number;
  get_last_full_visible_line(): number;
  get_visible_line_count(): number;
  set_h_scroll(value: number): void;
  get_h_scroll(): number;
  set_scroll_past_end_of_file_enabled(enabled: boolean): void;
  is_scroll_past_end_of_file_enabled(): boolean;
  set_smooth_scroll_enabled(enabled: boolean): void;
  is_smooth_scroll_enabled(): boolean;
  set_v_scroll_speed(speed: number): void;
  get_v_scroll_speed(): number;
  set_fit_content_height_enabled(enabled: boolean): void;
  is_fit_content_height_enabled(): boolean;
  set_draw_minimap(enabled: boolean): void;
  is_drawing_minimap(): boolean;
  set_minimap_width(width: number): void;
  get_minimap_width(): number;
  set_highlight_current_line(enabled: boolean): void;
  is_highlight_current_line_enabled(): boolean;
  set_draw_control_chars(enabled: boolean): void;
  get_draw_control_chars(): boolean;
  set_draw_tabs(enabled: boolean): void;
  is_drawing_tabs(): boolean;
  set_draw_spaces(enabled: boolean): void;
  is_drawing_spaces(): boolean;
  set_caret_blink_enabled(enabled: boolean): void;
  is_caret_blink_enabled(): boolean;
  set_caret_blink_interval(seconds: number): void;
  get_caret_blink_interval(): number;
  set_caret_force_displayed(enabled: boolean): void;
  is_caret_force_displayed(): boolean;
  set_caret_mid_grapheme_enabled(enabled: boolean): void;
  is_caret_mid_grapheme_enabled(): boolean;
  set_selecting_enabled(enabled: boolean): void;
  is_selecting_enabled(): boolean;
  set_deselect_on_focus_loss_enabled(enabled: boolean): void;
  is_deselect_on_focus_loss_enabled(): boolean;
  set_context_menu_enabled(enabled: boolean): void;
  is_context_menu_enabled(): boolean;
  set_shortcut_keys_enabled(enabled: boolean): void;
  is_shortcut_keys_enabled(): boolean;
  set_virtual_keyboard_enabled(enabled: boolean): void;
  is_virtual_keyboard_enabled(): boolean;
  set_middle_mouse_paste_enabled(enabled: boolean): void;
  is_middle_mouse_paste_enabled(): boolean;
  menu_option(option: number): void;
}

const BOUND_TEXT_EDITS = new WeakSet<GodotControl>();

function isBoundTextEdit(control: GodotControl): control is GodotTextEdit {
  return BOUND_TEXT_EDITS.has(control);
}

export interface TextEditBindOptions {
  readonly text?: string;
  readonly placeholder_text?: string;
  readonly editable?: boolean;
  readonly readonly?: boolean;
  readonly caret_line?: number;
  readonly caret_column?: number;
  readonly wrap_mode?: number;
  readonly scroll_vertical?: number;
  readonly scroll_fit_content_width?: boolean;
  readonly scroll_fit_content_height?: boolean;
  readonly scroll_horizontal?: number;
  /** Canvas-only native presentation seam; semantic text remains on the retained Control. */
  readonly renderText?: (text: string, scrollLine: number) => void;
}

function linesOf(text: string): readonly string[] {
  // Godot TextEdit always has at least one logical line, including for an empty document.
  return text.split('\n');
}

function normalizedText(text: string): string {
  // Godot 4.7 TextEdit::_base_insert_text removes every CR before splitting on LF.
  return text.replaceAll('\r', '');
}

function codePointLength(text: string): number {
  return [...text].length;
}

function utf16Offset(text: string, line: number, column: number): number {
  const lines = linesOf(text);
  const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
  const clampedColumn = Math.max(0, Math.min(column, codePointLength(lines[clampedLine] ?? '')));
  const prefix = lines.slice(0, clampedLine).join('\n');
  return prefix.length + (clampedLine > 0 ? 1 : 0) + [...(lines[clampedLine] ?? '')].slice(0, clampedColumn).join('').length;
}

function lineColumnAtUtf16(text: string, offset: number): readonly [number, number] {
  const prefix = text.slice(0, Math.max(0, Math.min(text.length, offset)));
  const lines = linesOf(prefix);
  return [lines.length - 1, codePointLength(lines[lines.length - 1] ?? '')];
}

function integer(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`TextEdit.${name} must be finite.`);
  return Math.trunc(value);
}

function requireDefault(name: string, received: unknown, expected: unknown): void {
  if (received !== expected) {
    throw new Error(`TextEdit.${name}=${String(received)} is not carried; expected ${String(expected)}.`);
  }
}

/**
 * Seat TextEdit behavior on the existing retained Control. Rendering remains the native DOM/Pixi
 * entity; this module owns only Godot's LF-based document, caret, editability, and signal rules.
 */
export function bindTextEdit(
  control: GodotControl,
  initial: TextEditBindOptions = {},
): GodotTextEdit {
  let edit: GodotTextEdit;
  const binding = controlBinding(control);
  const changed = createSignal<readonly []>();
  const caretChanged = createSignal<readonly []>();
  const gutterClicked = createSignal<readonly [number, number]>();
  const symbolLookup = createSignal<readonly [string, number, number]>();
  const symbolValidate = createSignal<readonly [string]>();
  const completionRequested = createSignal<readonly []>();
  let editable = initial.editable ?? !(initial.readonly ?? false);
  let placeholderText = initial.placeholder_text ?? '';
  if (typeof placeholderText !== 'string') {
    throw new TypeError('TextEdit.placeholder_text requires a String.');
  }
  let documentText = normalizedText(initial.text ?? control.text);
  let scrollVertical = Math.max(0, integer('scroll_vertical', initial.scroll_vertical ?? 0));
  let scrollFitContentWidth = initial.scroll_fit_content_width ?? false;
  let scrollFitContentHeight = initial.scroll_fit_content_height ?? false;
  let scrollHorizontal = Math.max(0, integer('scroll_horizontal', initial.scroll_horizontal ?? 0));
  let scrollPastEnd = false;
  let smoothScroll = false;
  let vScrollSpeed = 80;
  let drawMinimap = false;
  let minimapWidth = 80;
  let highlightCurrentLine = false;
  let drawControlChars = false;
  let drawTabs = false;
  let drawSpaces = false;
  let caretBlink = false;
  let caretBlinkInterval = 0.65;
  let caretForceDisplayed = false;
  let caretMidGrapheme = false;
  let selectingEnabled = true;
  let deselectOnFocusLoss = true;
  let contextMenuEnabled = true;
  let shortcutKeysEnabled = true;
  let virtualKeyboardEnabled = true;
  let middleMousePasteEnabled = true;
  const renderText = (): void => initial.renderText?.(
    documentText === '' ? placeholderText : documentText,
    scrollVertical,
  );
  const syncFitContentWidth = (): void => {
    if (!scrollFitContentWidth) {
      controlMinimumSizeChanged(control);
      return;
    }
    const element = binding.state.read(binding.id).focusElement;
    const retainedWidth: unknown = Reflect.get(control, 'width');
    const nativeWidth = typeof retainedWidth === 'number' ? retainedWidth : 0;
    const contentWidth = typeof HTMLElement !== 'undefined' && element instanceof HTMLElement
      ? element.scrollWidth
      : nativeWidth;
    const current = binding.state.read(binding.id).size ?? binding.state.authored(binding.id)?.size;
    if (current !== undefined && Number.isFinite(contentWidth)) {
      binding.state.write(binding.id, { size: { x: Math.max(current.x, contentWidth), y: current.y } });
    }
    controlMinimumSizeChanged(control);
  };
  if (initial.renderText !== undefined) {
    Object.defineProperty(control, 'text', {
      enumerable: true,
      configurable: true,
      get: () => documentText,
      set: (value: string) => {
        documentText = normalizedText(String(value));
        binding.state.write(binding.id, { text: documentText });
        renderText();
      },
    });
  }
  if (initial.text !== undefined) {
    binding.state.write(binding.id, { text: documentText });
  }
  let caretLine = 0;
  let caretColumn = 0;
  let selectionStart = 0;
  let selectionEnd = 0;
  let selectionDirection: 'forward' | 'backward' | 'none' = 'none';
  let wrapMode = integer('wrap_mode', initial.wrap_mode ?? 0);
  if (wrapMode < 0 || wrapMode > 1) {
    throw new RangeError('TextEdit.wrap_mode must be LINE_WRAPPING_NONE (0) or LINE_WRAPPING_BOUNDARY (1).');
  }

  const syncWrapMode = (): void => {
    binding.state.write(binding.id, { textEditWrapMode: wrapMode });
    const nativeWidth: unknown = Reflect.get(control, 'width');
    const nativeStyle: unknown = Reflect.get(control, 'style');
    if (typeof nativeStyle === 'object' && nativeStyle !== null) {
      Reflect.set(nativeStyle, 'wordWrap', wrapMode === 1);
      if (wrapMode === 1 && typeof nativeWidth === 'number' && Number.isFinite(nativeWidth) && nativeWidth > 0) {
        Reflect.set(nativeStyle, 'wordWrapWidth', nativeWidth);
      }
      Reflect.set(nativeStyle, 'breakWords', false);
      Reflect.set(nativeStyle, 'whiteSpace', wrapMode === 1 ? 'pre-wrap' : 'pre');
    }
    const element = binding.state.read(binding.id).focusElement;
    if (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) {
      element.wrap = wrapMode === 1 ? 'soft' : 'off';
    }
  };

  const clampCaret = (): void => {
    const lines = linesOf(control.text);
    caretLine = Math.max(0, Math.min(caretLine, lines.length - 1));
    caretColumn = Math.max(0, Math.min(caretColumn, codePointLength(lines[caretLine] ?? '')));
  };
  const setScrollVertical = (value: number): void => {
    const lines = linesOf(control.text);
    scrollVertical = Math.max(0, Math.min(integer('scroll_vertical', value), lines.length - 1));
    binding.state.write(binding.id, { textEditScrollVertical: scrollVertical });
    binding.state.read(binding.id).onTextEditScrollLine?.(scrollVertical);
    const element = binding.state.read(binding.id).focusElement;
    if (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      const lineHeight = style === undefined ? Number.NaN : Number.parseFloat(style.lineHeight);
      if (Number.isFinite(lineHeight) && lineHeight > 0) element.scrollTop = scrollVertical * lineHeight;
    }
    renderText();
  };
  const setCaretFromUtf16 = (
    nextSelectionStart?: number | null,
    nextSelectionEnd?: number | null,
    direction?: 'forward' | 'backward' | 'none' | null,
  ): void => {
    const previousLine = caretLine;
    const previousColumn = caretColumn;
    selectionStart = Math.max(0, Math.min(control.text.length, nextSelectionStart ?? control.text.length));
    selectionEnd = Math.max(0, Math.min(control.text.length, nextSelectionEnd ?? selectionStart));
    selectionDirection = direction ?? 'none';
    const utf16Caret = selectionDirection === 'backward'
      ? selectionStart
      : selectionEnd;
    const prefix = control.text.slice(0, Math.max(0, utf16Caret));
    const prefixLines = linesOf(prefix);
    caretLine = prefixLines.length - 1;
    caretColumn = codePointLength(prefixLines[caretLine] ?? '');
    if (caretLine !== previousLine || caretColumn !== previousColumn) caretChanged.emit();
  };
  const syncNativeEditor = (): void => {
    const element = binding.state.read(binding.id).focusElement;
    if (typeof HTMLTextAreaElement === 'undefined' || !(element instanceof HTMLTextAreaElement)) return;
    element.value = control.text;
    element.readOnly = !editable;
    const lines = linesOf(control.text);
    const prefix = [
      ...lines.slice(0, caretLine),
      [...(lines[caretLine] ?? '')].slice(0, caretColumn).join(''),
    ].join('\n');
    if (selectionStart === selectionEnd) selectionStart = selectionEnd = prefix.length;
    element.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  };
  const setCaretLine = (value: number): void => {
    const previousLine = caretLine;
    const previousColumn = caretColumn;
    caretLine = integer('caret_line', value);
    clampCaret();
    selectionStart = selectionEnd = utf16Offset(control.text, caretLine, caretColumn);
    selectionDirection = 'none';
    syncNativeEditor();
    if (caretLine !== previousLine || caretColumn !== previousColumn) caretChanged.emit();
  };
  const setCaretColumn = (value: number): void => {
    const previousLine = caretLine;
    const previousColumn = caretColumn;
    caretColumn = integer('caret_column', value);
    clampCaret();
    selectionStart = selectionEnd = utf16Offset(control.text, caretLine, caretColumn);
    selectionDirection = 'none';
    syncNativeEditor();
    if (caretLine !== previousLine || caretColumn !== previousColumn) caretChanged.emit();
  };
  setCaretLine(initial.caret_line ?? 0);
  setCaretColumn(initial.caret_column ?? 0);

  Object.defineProperties(control, {
    editable: {
      enumerable: true,
      configurable: true,
      get: () => editable,
      set: (value: boolean) => {
        editable = Boolean(value);
        binding.state.write(binding.id, { textEditEditable: editable });
        syncNativeEditor();
      },
    },
    readonly: {
      enumerable: true,
      configurable: true,
      get: () => !editable,
      set: (value: boolean) => {
        editable = !Boolean(value);
        binding.state.write(binding.id, { textEditEditable: editable });
        syncNativeEditor();
      },
    },
    placeholder_text: {
      enumerable: true,
      configurable: true,
      get: () => placeholderText,
      set: (value: string) => {
        if (typeof value !== 'string') throw new TypeError('TextEdit.placeholder_text requires a String.');
        placeholderText = value;
        binding.state.write(binding.id, { textEditPlaceholder: value });
        renderText();
        const element = binding.state.read(binding.id).focusElement;
        if (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) {
          element.placeholder = value;
        }
      },
    },
    caret_line: {
      enumerable: true,
      configurable: true,
      get: () => caretLine,
      set: setCaretLine,
    },
    caret_column: {
      enumerable: true,
      configurable: true,
      get: () => caretColumn,
      set: setCaretColumn,
    },
    wrap_mode: {
      enumerable: true,
      configurable: true,
      get: () => wrapMode,
      set: (value: number) => {
        const next = integer('wrap_mode', value);
        if (next < 0 || next > 1) {
          throw new RangeError('TextEdit.wrap_mode must be LINE_WRAPPING_NONE (0) or LINE_WRAPPING_BOUNDARY (1).');
        }
        wrapMode = next;
        syncWrapMode();
      },
    },
    scroll_vertical: {
      enumerable: true,
      configurable: true,
      get: () => scrollVertical,
      set: setScrollVertical,
    },
    scroll_fit_content_width: {
      enumerable: true,
      configurable: true,
      get: () => scrollFitContentWidth,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('TextEdit.scroll_fit_content_width requires bool.');
        scrollFitContentWidth = value;
        syncFitContentWidth();
      },
    },
    scroll_fit_content_height: { enumerable: true, configurable: true, get: () => scrollFitContentHeight, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.scroll_fit_content_height requires bool.'); scrollFitContentHeight = value; controlMinimumSizeChanged(control); } },
    scroll_horizontal: { enumerable: true, configurable: true, get: () => scrollHorizontal, set: (value: number) => { scrollHorizontal = Math.max(0, integer('scroll_horizontal', value)); binding.state.write(binding.id, { textEditScrollHorizontal: scrollHorizontal }); } },
    scroll_past_end_of_file: { enumerable: true, configurable: true, get: () => scrollPastEnd, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.scroll_past_end_of_file requires bool.'); scrollPastEnd = value; } },
    smooth_scroll_enabled: { enumerable: true, configurable: true, get: () => smoothScroll, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.smooth_scroll_enabled requires bool.'); smoothScroll = value; } },
    v_scroll_speed: { enumerable: true, configurable: true, get: () => vScrollSpeed, set: (value: number) => { if (!Number.isFinite(value) || value < 0) throw new RangeError('TextEdit.v_scroll_speed must be non-negative.'); vScrollSpeed = value; } },
    minimap_draw: { enumerable: true, configurable: true, get: () => drawMinimap, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.minimap_draw requires bool.'); drawMinimap = value; } },
    minimap_width: { enumerable: true, configurable: true, get: () => minimapWidth, set: (value: number) => { const next = integer('minimap_width', value); if (next <= 0) throw new RangeError('TextEdit.minimap_width must be positive.'); minimapWidth = next; } },
    highlight_current_line: { enumerable: true, configurable: true, get: () => highlightCurrentLine, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.highlight_current_line requires bool.'); highlightCurrentLine = value; } },
    draw_control_chars: { enumerable: true, configurable: true, get: () => drawControlChars, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.draw_control_chars requires bool.'); drawControlChars = value; } },
    draw_tabs: { enumerable: true, configurable: true, get: () => drawTabs, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.draw_tabs requires bool.'); drawTabs = value; } },
    draw_spaces: { enumerable: true, configurable: true, get: () => drawSpaces, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.draw_spaces requires bool.'); drawSpaces = value; } },
    caret_blink: { enumerable: true, configurable: true, get: () => caretBlink, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.caret_blink requires bool.'); caretBlink = value; } },
    caret_blink_interval: { enumerable: true, configurable: true, get: () => caretBlinkInterval, set: (value: number) => { if (!Number.isFinite(value) || value <= 0) throw new RangeError('TextEdit.caret_blink_interval must be positive.'); caretBlinkInterval = value; } },
    caret_force_displayed: { enumerable: true, configurable: true, get: () => caretForceDisplayed, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.caret_force_displayed requires bool.'); caretForceDisplayed = value; } },
    caret_mid_grapheme: { enumerable: true, configurable: true, get: () => caretMidGrapheme, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.caret_mid_grapheme requires bool.'); caretMidGrapheme = value; } },
    selecting_enabled: { enumerable: true, configurable: true, get: () => selectingEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.selecting_enabled requires bool.'); selectingEnabled = value; if (!value) edit.deselect(); } },
    deselect_on_focus_loss_enabled: { enumerable: true, configurable: true, get: () => deselectOnFocusLoss, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.deselect_on_focus_loss_enabled requires bool.'); deselectOnFocusLoss = value; } },
    context_menu_enabled: { enumerable: true, configurable: true, get: () => contextMenuEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.context_menu_enabled requires bool.'); contextMenuEnabled = value; } },
    shortcut_keys_enabled: { enumerable: true, configurable: true, get: () => shortcutKeysEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.shortcut_keys_enabled requires bool.'); shortcutKeysEnabled = value; } },
    virtual_keyboard_enabled: { enumerable: true, configurable: true, get: () => virtualKeyboardEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.virtual_keyboard_enabled requires bool.'); virtualKeyboardEnabled = value; } },
    middle_mouse_paste_enabled: { enumerable: true, configurable: true, get: () => middleMousePasteEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextEdit.middle_mouse_paste_enabled requires bool.'); middleMousePasteEnabled = value; } },
  });
  setScrollVertical(scrollVertical);

  Object.assign(control, {
    text_changed: changed.signal,
    caret_changed: caretChanged.signal,
    gutter_clicked: gutterClicked.signal,
    symbol_lookup: symbolLookup.signal,
    symbol_validate: symbolValidate.signal,
    completion_requested: completionRequested.signal,
    clear(): void {
      const hadText = control.text !== '';
      control.text = '';
      setScrollVertical(0);
      caretLine = 0;
      caretColumn = 0;
      selectionStart = selectionEnd = 0;
      syncNativeEditor();
      if (hadText) changed.emit();
      syncFitContentWidth();
    },
    set_text(value: string): void {
      const text = normalizedText(String(value));
      const changedValue = text !== control.text;
      control.text = text;
      setScrollVertical(scrollVertical);
      clampCaret();
      syncNativeEditor();
      if (changedValue) changed.emit();
      syncFitContentWidth();
    },
    get_text: (): string => control.text,
    set_editable(value: boolean): void { edit.editable = value; },
    is_editable: (): boolean => edit.editable,
    set_readonly(value: boolean): void { edit.readonly = value; },
    is_readonly: (): boolean => edit.readonly,
    set_placeholder(value: string): void { edit.placeholder_text = value; },
    get_placeholder: (): string => edit.placeholder_text,
    set_line_wrapping_mode(value: number): void { edit.wrap_mode = value; },
    get_line_wrapping_mode: (): number => edit.wrap_mode,
    set_wrap_enabled(value: boolean): void { edit.wrap_mode = value ? 1 : 0; },
    is_wrap_enabled: (): boolean => edit.wrap_mode !== 0,
    set_v_scroll(value: number): void { edit.scroll_vertical = value; },
    get_v_scroll: (): number => edit.scroll_vertical,
    set_fit_content_width_enabled(value: boolean): void { edit.scroll_fit_content_width = value; },
    is_fit_content_width_enabled: (): boolean => edit.scroll_fit_content_width,
    get_line_count: (): number => linesOf(control.text).length,
    get_line(line: number): string {
      const index = integer('get_line', line);
      return linesOf(control.text)[index] ?? '';
    },
    get_caret_line(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return caretLine;
    },
    get_caret_column(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return caretColumn;
    },
    set_caret_line(line: number, adjustViewport = true, canBeHidden = true, wrapIndex = 0, caretIndex = 0): void {
      requireDefault('adjust_viewport', adjustViewport, true);
      requireDefault('can_be_hidden', canBeHidden, true);
      requireDefault('wrap_index', wrapIndex, 0);
      requireDefault('caret_index', caretIndex, 0);
      setCaretLine(line);
    },
    set_caret_column(column: number, adjustViewport = true, caretIndex = 0): void {
      requireDefault('adjust_viewport', adjustViewport, true);
      requireDefault('caret_index', caretIndex, 0);
      setCaretColumn(column);
    },
    cursor_get_line: (): number => caretLine,
    cursor_get_column: (): number => caretColumn,
    cursor_set_line(line: number, adjustViewport = true, canBeHidden = true, wrapIndex = 0): void {
      requireDefault('adjust_viewport', adjustViewport, true);
      requireDefault('can_be_hidden', canBeHidden, true);
      requireDefault('wrap_index', wrapIndex, 0);
      setCaretLine(line);
    },
    cursor_set_column(column: number, adjustViewport = true): void {
      requireDefault('adjust_viewport', adjustViewport, true);
      setCaretColumn(column);
    },
    deselect(caretIndex = -1): void {
      if (caretIndex !== -1 && caretIndex !== 0) {
        throw new RangeError(`TextEdit.deselect caret_index ${String(caretIndex)} is outside the retained single-caret editor.`);
      }
      selectionStart = selectionEnd = utf16Offset(control.text, caretLine, caretColumn);
      selectionDirection = 'none';
      syncNativeEditor();
    },
    select_all(): void {
      selectionStart = 0;
      selectionEnd = control.text.length;
      setCaretFromUtf16(selectionStart, selectionEnd, 'forward');
      syncNativeEditor();
    },
    select(originLine: number, originColumn: number, nextCaretLine: number, nextCaretColumn: number, caretIndex = 0): void {
      requireDefault('caret_index', caretIndex, 0);
      const origin = utf16Offset(control.text, integer('origin_line', originLine), integer('origin_column', originColumn));
      const target = utf16Offset(control.text, integer('caret_line', nextCaretLine), integer('caret_column', nextCaretColumn));
      selectionStart = Math.min(origin, target);
      selectionEnd = Math.max(origin, target);
      selectionDirection = target < origin ? 'backward' : 'forward';
      setCaretFromUtf16(selectionStart, selectionEnd, selectionDirection);
      syncNativeEditor();
    },
    has_selection(caretIndex = -1): boolean {
      if (caretIndex !== -1 && caretIndex !== 0) {
        throw new RangeError(`TextEdit.has_selection caret_index ${String(caretIndex)} is outside the retained single-caret editor.`);
      }
      return selectionStart !== selectionEnd;
    },
    delete_selection(caretIndex = -1): void {
      if (caretIndex !== -1 && caretIndex !== 0) {
        throw new RangeError(`TextEdit.delete_selection caret_index ${String(caretIndex)} is outside the retained single-caret editor.`);
      }
      if (selectionStart === selectionEnd) return;
      const from = Math.min(selectionStart, selectionEnd);
      const to = Math.max(selectionStart, selectionEnd);
      control.text = control.text.slice(0, from) + control.text.slice(to);
      setCaretFromUtf16(from);
      syncNativeEditor();
      changed.emit();
      syncFitContentWidth();
    },
    get_selection_text(caretIndex = 0): string {
      requireDefault('caret_index', caretIndex, 0);
      return control.text.slice(Math.min(selectionStart, selectionEnd), Math.max(selectionStart, selectionEnd));
    },
    get_selected_text(caretIndex = -1): string {
      if (caretIndex !== -1 && caretIndex !== 0) {
        throw new RangeError(`TextEdit.get_selected_text caret_index ${String(caretIndex)} is outside the retained single-caret editor.`);
      }
      return control.text.slice(Math.min(selectionStart, selectionEnd), Math.max(selectionStart, selectionEnd));
    },
    get_selection_from_line(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return lineColumnAtUtf16(control.text, Math.min(selectionStart, selectionEnd))[0];
    },
    get_selection_from_column(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return lineColumnAtUtf16(control.text, Math.min(selectionStart, selectionEnd))[1];
    },
    get_selection_to_line(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return lineColumnAtUtf16(control.text, Math.max(selectionStart, selectionEnd))[0];
    },
    get_selection_to_column(caretIndex = 0): number {
      requireDefault('caret_index', caretIndex, 0);
      return lineColumnAtUtf16(control.text, Math.max(selectionStart, selectionEnd))[1];
    },
    insert_text_at_caret(value: string, caretIndex = -1): void {
      if (caretIndex !== -1 && caretIndex !== 0) {
        throw new RangeError(`TextEdit.insert_text_at_caret caret_index ${String(caretIndex)} is outside the retained single-caret editor.`);
      }
      const from = Math.min(selectionStart, selectionEnd);
      const to = Math.max(selectionStart, selectionEnd);
      const inserted = normalizedText(String(value));
      control.text = control.text.slice(0, from) + inserted + control.text.slice(to);
      setCaretFromUtf16(from + inserted.length);
      syncNativeEditor();
      changed.emit();
      syncFitContentWidth();
    },
    insert_text_at_cursor(value: string): void { edit.insert_text_at_caret(value); },
    is_selection_active(): boolean { return edit.has_selection(); },
    remove_text(fromLine: number, fromColumn: number, toLine: number, toColumn: number): void {
      const from = utf16Offset(control.text, integer('from_line', fromLine), integer('from_column', fromColumn));
      const to = utf16Offset(control.text, integer('to_line', toLine), integer('to_column', toColumn));
      if (from >= to) return;
      control.text = control.text.slice(0, from) + control.text.slice(to);
      setCaretFromUtf16(from);
      syncNativeEditor();
      changed.emit();
      syncFitContentWidth();
    },
    set_line(line: number, value: string): void { const index = integer('set_line line', line); const lines = [...linesOf(control.text)]; if (index < 0 || index >= lines.length) throw new RangeError('TextEdit.set_line line is out of range.'); lines[index] = normalizedText(String(value)).replaceAll('\n', ''); edit.set_text(lines.join('\n')); },
    insert_line_at(line: number, value: string): void { const index = integer('insert_line_at line', line); const lines = [...linesOf(control.text)]; if (index < 0 || index > lines.length) throw new RangeError('TextEdit.insert_line_at line is out of range.'); lines.splice(index, 0, normalizedText(String(value)).replaceAll('\n', '')); edit.set_text(lines.join('\n')); },
    remove_line_at(line: number, _moveCaretsDown = true): void { const index = integer('remove_line_at line', line); const lines = [...linesOf(control.text)]; if (index < 0 || index >= lines.length) throw new RangeError('TextEdit.remove_line_at line is out of range.'); lines.splice(index, 1); edit.set_text(lines.join('\n')); },
    swap_lines(fromLine: number, toLine: number): void { const from = integer('swap_lines from_line', fromLine); const to = integer('swap_lines to_line', toLine); const lines = [...linesOf(control.text)]; if (from < 0 || to < 0 || from >= lines.length || to >= lines.length) throw new RangeError('TextEdit.swap_lines line is out of range.'); [lines[from], lines[to]] = [lines[to]!, lines[from]!]; edit.set_text(lines.join('\n')); },
    insert_text(value: string, line: number, column: number, _beforeSelectionBegin = true, _beforeSelectionEnd = false): void { const offset = utf16Offset(control.text, integer('insert_text line', line), integer('insert_text column', column)); const inserted = normalizedText(String(value)); control.text = control.text.slice(0, offset) + inserted + control.text.slice(offset); setCaretFromUtf16(offset + inserted.length); syncNativeEditor(); changed.emit(); syncFitContentWidth(); },
    get_line_width(line: number, wrapIndex = -1): number { if (wrapIndex < -1 || !Number.isSafeInteger(wrapIndex)) throw new RangeError('TextEdit.get_line_width wrap_index is invalid.'); const value = edit.get_line(line); return codePointLength(value) * 8; },
    get_line_height(): number { const element = binding.state.read(binding.id).focusElement; if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) { const height = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? ''); if (Number.isFinite(height)) return height; } return 16; },
    get_word_at_pos(position: ControlPoint): string { if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new TypeError('TextEdit.get_word_at_pos requires Vector2.'); const line = Math.max(0, Math.min(Math.floor(position.y / edit.get_line_height()) + scrollVertical, edit.get_line_count() - 1)); const text = edit.get_line(line); const column = Math.max(0, Math.min(Math.floor(position.x / 8), codePointLength(text))); return text.slice(0, column).match(/[\p{L}\p{N}_]+$/u)?.[0] ?? text.slice(column).match(/^[\p{L}\p{N}_]+/u)?.[0] ?? ''; },
    get_word_under_caret(caretIndex = -1): string { if (caretIndex !== -1 && caretIndex !== 0) throw new RangeError('TextEdit.get_word_under_caret caret index is invalid.'); const value = edit.get_line(caretLine); const left = [...value].slice(0, caretColumn).join('').match(/[\p{L}\p{N}_]+$/u)?.[0] ?? ''; const right = [...value].slice(caretColumn).join('').match(/^[\p{L}\p{N}_]+/u)?.[0] ?? ''; return left + right; },
    get_first_visible_line(): number { return scrollVertical; },
    get_last_full_visible_line(): number { return Math.min(edit.get_line_count() - 1, scrollVertical + edit.get_visible_line_count() - 1); },
    get_visible_line_count(): number { const element = binding.state.read(binding.id).focusElement; const height = typeof HTMLElement !== 'undefined' && element instanceof HTMLElement ? element.clientHeight : 0; return Math.max(1, Math.floor(height / edit.get_line_height())); },
    set_h_scroll(value: number): void { edit.scroll_horizontal = value; },
    get_h_scroll(): number { return scrollHorizontal; },
    set_scroll_past_end_of_file_enabled(value: boolean): void { edit.scroll_past_end_of_file = value; },
    is_scroll_past_end_of_file_enabled(): boolean { return scrollPastEnd; },
    set_smooth_scroll_enabled(value: boolean): void { edit.smooth_scroll_enabled = value; },
    is_smooth_scroll_enabled(): boolean { return smoothScroll; },
    set_v_scroll_speed(value: number): void { edit.v_scroll_speed = value; },
    get_v_scroll_speed(): number { return vScrollSpeed; },
    set_fit_content_height_enabled(value: boolean): void { edit.scroll_fit_content_height = value; },
    is_fit_content_height_enabled(): boolean { return scrollFitContentHeight; },
    set_draw_minimap(value: boolean): void { edit.minimap_draw = value; },
    is_drawing_minimap(): boolean { return drawMinimap; },
    set_minimap_width(value: number): void { edit.minimap_width = value; },
    get_minimap_width(): number { return minimapWidth; },
    set_highlight_current_line(value: boolean): void { edit.highlight_current_line = value; },
    is_highlight_current_line_enabled(): boolean { return highlightCurrentLine; },
    set_draw_control_chars(value: boolean): void { edit.draw_control_chars = value; },
    get_draw_control_chars(): boolean { return drawControlChars; },
    set_draw_tabs(value: boolean): void { edit.draw_tabs = value; },
    is_drawing_tabs(): boolean { return drawTabs; },
    set_draw_spaces(value: boolean): void { edit.draw_spaces = value; },
    is_drawing_spaces(): boolean { return drawSpaces; },
    set_caret_blink_enabled(value: boolean): void { edit.caret_blink = value; },
    is_caret_blink_enabled(): boolean { return caretBlink; },
    set_caret_blink_interval(value: number): void { edit.caret_blink_interval = value; },
    get_caret_blink_interval(): number { return caretBlinkInterval; },
    set_caret_force_displayed(value: boolean): void { edit.caret_force_displayed = value; },
    is_caret_force_displayed(): boolean { return caretForceDisplayed; },
    set_caret_mid_grapheme_enabled(value: boolean): void { edit.caret_mid_grapheme = value; },
    is_caret_mid_grapheme_enabled(): boolean { return caretMidGrapheme; },
    set_selecting_enabled(value: boolean): void { edit.selecting_enabled = value; },
    is_selecting_enabled(): boolean { return selectingEnabled; },
    set_deselect_on_focus_loss_enabled(value: boolean): void { edit.deselect_on_focus_loss_enabled = value; },
    is_deselect_on_focus_loss_enabled(): boolean { return deselectOnFocusLoss; },
    set_context_menu_enabled(value: boolean): void { edit.context_menu_enabled = value; },
    is_context_menu_enabled(): boolean { return contextMenuEnabled; },
    set_shortcut_keys_enabled(value: boolean): void { edit.shortcut_keys_enabled = value; },
    is_shortcut_keys_enabled(): boolean { return shortcutKeysEnabled; },
    set_virtual_keyboard_enabled(value: boolean): void { edit.virtual_keyboard_enabled = value; },
    is_virtual_keyboard_enabled(): boolean { return virtualKeyboardEnabled; },
    set_middle_mouse_paste_enabled(value: boolean): void { edit.middle_mouse_paste_enabled = value; },
    is_middle_mouse_paste_enabled(): boolean { return middleMousePasteEnabled; },
    menu_option(option: number): void { const action = integer('menu_option', option); if (action === 0) edit.select_all(); else if (action === 1) edit.deselect(); else if (action === 4) edit.delete_selection(); else if (action === 5) edit.clear(); },
  });
  BOUND_TEXT_EDITS.add(control);
  if (!isBoundTextEdit(control)) {
    throw new Error('TextEdit retained Control did not receive its complete runtime contract.');
  }
  edit = control;

  binding.state.write(binding.id, {
    onTextEditInput(value, selectionStart): void {
      if (!editable) return;
      binding.state.write(binding.id, { text: normalizedText(value) });
      setCaretFromUtf16(selectionStart);
      changed.emit();
      syncFitContentWidth();
    },
    onTextEditCaret(selectionStart, selectionEnd, selectionDirection): void {
      setCaretFromUtf16(selectionStart, selectionEnd, selectionDirection);
    },
    focusElement: null,
    bindFocusElement(element): void {
      binding.state.write(binding.id, { focusElement: element });
    },
    textEditEditable: editable,
    textEditPlaceholder: placeholderText,
    textEditWrapMode: wrapMode,
  });
  syncWrapMode();
  renderText();
  syncFitContentWidth();
  edit.focus = (): void => focusRetainedControlElement(control);
  return edit;
}

export function getTextEditText(edit: GodotTextEdit): string {
  return edit.text;
}

export function setTextEditText(edit: GodotTextEdit, value: string): void {
  edit.set_text(value);
  edit.caret_line = 0;
  edit.caret_column = 0;
}
