/** CodeEdit construction and SyntaxHighlighter ownership over the retained Pixi TextEdit. */

import { Text } from 'pixi.js';
import { bindCanvasTextEdit, type CanvasTextEditOptions, type GodotCanvasTextEdit } from './canvas-text-edit';
import { registerGodotObjectIdentity } from './object';
import { packedInt32Array, packedStringArray, type PackedArrayValue } from './packed-array';
import { bindGodotResourceProtocol } from './resource-io';
import type { GodotTextEdit } from './text-edit';
import type { ColorValue } from './variant';

export interface GodotSyntaxHighlighter {
  get_text_edit(): GodotCodeEdit | null;
  get_line_syntax_highlighting(line: number): ReadonlyMap<number, { readonly color: ColorValue }>;
  clear_highlighting_cache(): void;
  update_cache(): void;
}

export interface GodotCodeHighlighter extends GodotSyntaxHighlighter {
  number_color: ColorValue;
  symbol_color: ColorValue;
  function_color: ColorValue;
  member_variable_color: ColorValue;
  set_number_color(color: ColorValue): void;
  get_number_color(): ColorValue;
  set_symbol_color(color: ColorValue): void;
  get_symbol_color(): ColorValue;
  set_function_color(color: ColorValue): void;
  get_function_color(): ColorValue;
  set_member_variable_color(color: ColorValue): void;
  get_member_variable_color(): ColorValue;
  add_keyword_color(keyword: string, color: ColorValue): void;
  remove_keyword_color(keyword: string): void;
  has_keyword_color(keyword: string): boolean;
  get_keyword_color(keyword: string): ColorValue;
  set_keyword_colors(colors: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void;
  clear_keyword_colors(): void;
  get_keyword_colors(): ReadonlyMap<string, ColorValue>;
  add_member_keyword_color(keyword: string, color: ColorValue): void;
  remove_member_keyword_color(keyword: string): void;
  has_member_keyword_color(keyword: string): boolean;
  get_member_keyword_color(keyword: string): ColorValue;
  set_member_keyword_colors(colors: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void;
  clear_member_keyword_colors(): void;
  get_member_keyword_colors(): ReadonlyMap<string, ColorValue>;
  add_color_region(startKey: string, endKey: string, color: ColorValue, lineOnly?: boolean): void;
  remove_color_region(startKey: string): void;
  has_color_region(startKey: string): boolean;
  get_color_region_end_key(startKey: string): string;
  set_color_regions(regions: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void;
  clear_color_regions(): void;
  get_color_regions(): ReadonlyMap<string, ColorValue>;
  get_line_syntax_highlighting(line: number): ReadonlyMap<number, { readonly color: ColorValue }>;
  clear_highlighting_cache(): void;
  update_cache(): void;
}

export type GodotCodeEdit = GodotTextEdit & {
  syntax_highlighter: GodotSyntaxHighlighter | null;
  indent_size: number;
  indent_use_spaces: boolean;
  indent_automatic: boolean;
  indent_automatic_prefixes: PackedArrayValue<string>;
  auto_brace_completion_enabled: boolean;
  auto_brace_completion_highlight_matching: boolean;
  auto_brace_completion_pairs: Map<string, string>;
  gutters_draw_breakpoints_gutter: boolean;
  gutters_draw_bookmarks: boolean;
  gutters_draw_executing_lines: boolean;
  gutters_draw_line_numbers: boolean;
  gutters_zero_pad_line_numbers: boolean;
  gutters_line_numbers_min_digits: number;
  set_syntax_highlighter(value: GodotSyntaxHighlighter | null): void;
  get_syntax_highlighter(): GodotSyntaxHighlighter | null;
  set_indent_size(value: number): void;
  get_indent_size(): number;
  set_indent_using_spaces(value: boolean): void;
  is_indent_using_spaces(): boolean;
  set_auto_indent_enabled(value: boolean): void;
  is_auto_indent_enabled(): boolean;
  set_auto_indent_prefixes(value: readonly string[] | PackedArrayValue<string>): void;
  get_auto_indent_prefixes(): PackedArrayValue<string>;
  do_indent(): void;
  indent_lines(): void;
  unindent_lines(): void;
  set_auto_brace_completion_enabled(value: boolean): void;
  is_auto_brace_completion_enabled(): boolean;
  set_highlight_matching_braces_enabled(value: boolean): void;
  is_highlight_matching_braces_enabled(): boolean;
  add_auto_brace_completion_pair(open: string, close: string): void;
  set_auto_brace_completion_pairs(value: Map<unknown, unknown> | Record<string, unknown>): void;
  get_auto_brace_completion_pairs(): Map<string, string>;
  has_auto_brace_completion_open_key(value: string): boolean;
  has_auto_brace_completion_close_key(value: string): boolean;
  get_auto_brace_completion_close_key(value: string): string;
  set_line_as_breakpoint(line: number, enabled: boolean): void;
  is_line_breakpointed(line: number): boolean;
  clear_breakpointed_lines(): void;
  get_breakpointed_lines(): PackedArrayValue<number>;
  set_line_as_bookmarked(line: number, enabled: boolean): void;
  is_line_bookmarked(line: number): boolean;
  clear_bookmarked_lines(): void;
  get_bookmarked_lines(): PackedArrayValue<number>;
  set_line_as_executing(line: number, enabled: boolean): void;
  is_line_executing(line: number): boolean;
  clear_executing_lines(): void;
  get_executing_lines(): PackedArrayValue<number>;
  set_draw_breakpoints_gutter(value: boolean): void;
  is_drawing_breakpoints_gutter(): boolean;
  set_draw_bookmarks_gutter(value: boolean): void;
  is_drawing_bookmarks_gutter(): boolean;
  set_draw_executing_lines_gutter(value: boolean): void;
  is_drawing_executing_lines_gutter(): boolean;
  set_draw_line_numbers(value: boolean): void;
  is_draw_line_numbers_enabled(): boolean;
  set_line_numbers_zero_padded(value: boolean): void;
  is_line_numbers_zero_padded(): boolean;
  set_line_numbers_min_digits(value: number): void;
  get_line_numbers_min_digits(): number;
};

const HIGHLIGHTER_OWNERS = new WeakMap<GodotSyntaxHighlighter, GodotCodeEdit>();

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`CodeEdit.${member} requires bool.`);
  return value;
}

function integer(value: unknown, member: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`CodeEdit.${member} requires an integer >= ${minimum}.`);
  }
  return value;
}

function text(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`CodeEdit.${member} requires String.`);
  return value;
}

function highlightColor(value: ColorValue, member: string): ColorValue {
  if (typeof value !== 'object' || value === null || ![value.r, value.g, value.b, value.a].every(Number.isFinite)) {
    throw new TypeError(`CodeHighlighter.${member} requires Color.`);
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function braceSymbol(value: unknown, member: string): string {
  const symbol = text(value, member);
  if (symbol.length === 0 || [...symbol].some((part) => /[\p{L}\p{N}_\s]/u.test(part))) {
    throw new RangeError(`CodeEdit.${member} requires a nonempty symbol-only key.`);
  }
  return symbol;
}

function strings(value: unknown, member: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`CodeEdit.${member} requires PackedStringArray.`);
  return value.map((item) => text(item, member));
}

function dictionary(value: unknown, member: string): Map<string, string> {
  const entries = value instanceof Map
    ? [...value.entries()]
    : typeof value === 'object' && value !== null
      ? Object.entries(value)
      : null;
  if (entries === null) throw new TypeError(`CodeEdit.${member} requires Dictionary.`);
  return new Map(entries.map(([open, close]) => [braceSymbol(open, member), braceSymbol(close, member)]));
}

function lines(edit: GodotTextEdit): string[] {
  return edit.text.split('\n');
}

function selectedLineRange(edit: GodotTextEdit): readonly [number, number] {
  if (!edit.has_selection()) return [edit.get_caret_line(), edit.get_caret_line()];
  const from = edit.get_selection_from_line();
  const rawTo = edit.get_selection_to_line();
  // A selection ending at column zero belongs to the preceding line. This is the same
  // line-domain rule CodeEdit uses for line indentation commands.
  const to = rawTo > from && edit.get_selection_to_column() === 0 ? rawTo - 1 : rawTo;
  return [from, to];
}

function replaceLines(
  edit: GodotTextEdit,
  from: number,
  to: number,
  replacement: readonly string[],
  caretLine: number,
  caretColumn: number,
): void {
  const current = lines(edit);
  current.splice(from, to - from + 1, ...replacement);
  edit.set_text(current.join('\n'));
  edit.set_caret_line(Math.max(0, Math.min(caretLine, current.length - 1)));
  edit.set_caret_column(caretColumn);
}

function bindCodeEdit(edit: GodotTextEdit): GodotCodeEdit {
  const code = edit as GodotCodeEdit;
  let indentSize = 4;
  let indentUsingSpaces = false;
  let autoIndent = true;
  let autoIndentPrefixes = [':', '{', '[', '('];
  let autoBraceCompletion = false;
  let highlightMatchingBraces = false;
  let autoBracePairs = new Map<string, string>([
    ['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"],
  ]);
  const breakpoints = new Set<number>();
  const bookmarks = new Set<number>();
  const executing = new Set<number>();
  let drawBreakpoints = false;
  let drawBookmarks = false;
  let drawExecuting = false;
  let drawLineNumbers = false;
  let zeroPadLineNumbers = false;
  let lineNumberMinimumDigits = 0;

  const indentation = (): string => indentUsingSpaces ? ' '.repeat(indentSize) : '\t';
  const validateLine = (line: unknown, member: string): number => {
    const index = integer(line, member);
    if (index >= code.get_line_count()) {
      throw new RangeError(`CodeEdit.${member} line ${index} is outside the document.`);
    }
    return index;
  };
  const setMarked = (
    values: Set<number>,
    line: unknown,
    enabled: unknown,
    member: string,
  ): void => {
    const index = validateLine(line, member);
    if (bool(enabled, member)) values.add(index);
    else values.delete(index);
  };
  const marked = (values: Set<number>, line: unknown, member: string): boolean =>
    values.has(validateLine(line, member));
  const packedLines = (values: Set<number>): PackedArrayValue<number> =>
    packedInt32Array([...values].sort((a, b) => a - b));
  const transformSelectedLines = (
    transform: (line: string) => readonly [text: string, columnDelta: number],
  ): void => {
    const hadSelection = code.has_selection();
    const [from, to] = selectedLineRange(code);
    const current = lines(code);
    const transformed = current.slice(from, to + 1).map(transform);
    const next = transformed.map(([line]) => line);
    const caretLine = code.get_caret_line();
    const caretColumn = code.get_caret_column();
    const caretDelta = caretLine >= from && caretLine <= to
      ? transformed[caretLine - from]?.[1] ?? 0
      : 0;
    const selectionFromColumn = hadSelection ? code.get_selection_from_column() : 0;
    const selectionToLine = hadSelection ? code.get_selection_to_line() : 0;
    const selectionToColumn = hadSelection ? code.get_selection_to_column() : 0;
    const selectionFromDelta = transformed[0]?.[1] ?? 0;
    const selectionToDelta = selectionToLine >= from && selectionToLine <= to
      ? transformed[selectionToLine - from]?.[1] ?? 0
      : 0;
    replaceLines(code, from, to, next, caretLine, Math.max(0, caretColumn + caretDelta));
    if (hadSelection) {
      code.select(
        from,
        Math.max(0, selectionFromColumn + selectionFromDelta),
        selectionToLine,
        Math.max(0, selectionToColumn + selectionToDelta),
      );
    }
  };

  const setIndentSize = (value: unknown): void => { indentSize = integer(value, 'indent_size', 1); };
  const setIndentUsingSpaces = (value: unknown): void => { indentUsingSpaces = bool(value, 'indent_use_spaces'); };
  const setAutoIndent = (value: unknown): void => { autoIndent = bool(value, 'indent_automatic'); };
  const setAutoIndentPrefixes = (value: unknown): void => { autoIndentPrefixes = strings(value, 'indent_automatic_prefixes'); };
  const setAutoBraceCompletion = (value: unknown): void => { autoBraceCompletion = bool(value, 'auto_brace_completion_enabled'); };
  const setHighlightMatchingBraces = (value: unknown): void => { highlightMatchingBraces = bool(value, 'auto_brace_completion_highlight_matching'); };
  const setAutoBracePairs = (value: unknown): void => { autoBracePairs = dictionary(value, 'auto_brace_completion_pairs'); };
  const setDrawBreakpoints = (value: unknown): void => { drawBreakpoints = bool(value, 'gutters_draw_breakpoints_gutter'); };
  const setDrawBookmarks = (value: unknown): void => { drawBookmarks = bool(value, 'gutters_draw_bookmarks'); };
  const setDrawExecuting = (value: unknown): void => { drawExecuting = bool(value, 'gutters_draw_executing_lines'); };
  const setDrawLineNumbers = (value: unknown): void => { drawLineNumbers = bool(value, 'gutters_draw_line_numbers'); };
  const setZeroPadLineNumbers = (value: unknown): void => { zeroPadLineNumbers = bool(value, 'gutters_zero_pad_line_numbers'); };
  const setLineNumberMinimumDigits = (value: unknown): void => { lineNumberMinimumDigits = integer(value, 'gutters_line_numbers_min_digits'); };

  Object.assign(code, {
    set_indent_size: setIndentSize,
    get_indent_size: () => indentSize,
    set_indent_using_spaces: setIndentUsingSpaces,
    is_indent_using_spaces: () => indentUsingSpaces,
    set_auto_indent_enabled: setAutoIndent,
    is_auto_indent_enabled: () => autoIndent,
    set_auto_indent_prefixes: setAutoIndentPrefixes,
    get_auto_indent_prefixes: () => packedStringArray(autoIndentPrefixes),
    do_indent(): void {
      if (code.has_selection()) { code.indent_lines(); return; }
      const column = code.get_caret_column();
      const insert = indentUsingSpaces ? ' '.repeat(indentSize - (column % indentSize)) : '\t';
      code.insert_text_at_caret(insert);
    },
    indent_lines: () => transformSelectedLines((line) => {
      const prefix = indentation();
      return [prefix + line, [...prefix].length] as const;
    }),
    unindent_lines: () => transformSelectedLines((line) => {
      if (line.startsWith('\t')) return [line.slice(1), -1] as const;
      let remove = 0;
      while (remove < indentSize && line[remove] === ' ') remove += 1;
      return [line.slice(remove), -remove] as const;
    }),
    set_auto_brace_completion_enabled: setAutoBraceCompletion,
    is_auto_brace_completion_enabled: () => autoBraceCompletion,
    set_highlight_matching_braces_enabled: setHighlightMatchingBraces,
    is_highlight_matching_braces_enabled: () => highlightMatchingBraces,
    add_auto_brace_completion_pair(open: unknown, close: unknown): void {
      const openKey = braceSymbol(open, 'add_auto_brace_completion_pair');
      const closeKey = braceSymbol(close, 'add_auto_brace_completion_pair');
      if (autoBracePairs.has(openKey)) {
        throw new Error(`CodeEdit.add_auto_brace_completion_pair already has open key ${JSON.stringify(openKey)}.`);
      }
      autoBracePairs.set(openKey, closeKey);
    },
    set_auto_brace_completion_pairs: setAutoBracePairs,
    get_auto_brace_completion_pairs: () => new Map(autoBracePairs),
    has_auto_brace_completion_open_key: (value: unknown) => autoBracePairs.has(text(value, 'has_auto_brace_completion_open_key')),
    has_auto_brace_completion_close_key: (value: unknown) => [...autoBracePairs.values()].includes(text(value, 'has_auto_brace_completion_close_key')),
    get_auto_brace_completion_close_key: (value: unknown) => autoBracePairs.get(text(value, 'get_auto_brace_completion_close_key')) ?? '',
    set_line_as_breakpoint: (line: unknown, enabled: unknown) => setMarked(breakpoints, line, enabled, 'set_line_as_breakpoint'),
    is_line_breakpointed: (line: unknown) => marked(breakpoints, line, 'is_line_breakpointed'),
    clear_breakpointed_lines: () => breakpoints.clear(),
    get_breakpointed_lines: () => packedLines(breakpoints),
    set_line_as_bookmarked: (line: unknown, enabled: unknown) => setMarked(bookmarks, line, enabled, 'set_line_as_bookmarked'),
    is_line_bookmarked: (line: unknown) => marked(bookmarks, line, 'is_line_bookmarked'),
    clear_bookmarked_lines: () => bookmarks.clear(),
    get_bookmarked_lines: () => packedLines(bookmarks),
    set_line_as_executing: (line: unknown, enabled: unknown) => setMarked(executing, line, enabled, 'set_line_as_executing'),
    is_line_executing: (line: unknown) => marked(executing, line, 'is_line_executing'),
    clear_executing_lines: () => executing.clear(),
    get_executing_lines: () => packedLines(executing),
    set_draw_breakpoints_gutter: setDrawBreakpoints,
    is_drawing_breakpoints_gutter: () => drawBreakpoints,
    set_draw_bookmarks_gutter: setDrawBookmarks,
    is_drawing_bookmarks_gutter: () => drawBookmarks,
    set_draw_executing_lines_gutter: setDrawExecuting,
    is_drawing_executing_lines_gutter: () => drawExecuting,
    set_draw_line_numbers: setDrawLineNumbers,
    is_draw_line_numbers_enabled: () => drawLineNumbers,
    set_line_numbers_zero_padded: setZeroPadLineNumbers,
    is_line_numbers_zero_padded: () => zeroPadLineNumbers,
    set_line_numbers_min_digits: setLineNumberMinimumDigits,
    get_line_numbers_min_digits: () => lineNumberMinimumDigits,
  });

  Object.defineProperties(code, {
    indent_size: { enumerable: true, configurable: true, get: () => indentSize, set: setIndentSize },
    indent_use_spaces: { enumerable: true, configurable: true, get: () => indentUsingSpaces, set: setIndentUsingSpaces },
    indent_automatic: { enumerable: true, configurable: true, get: () => autoIndent, set: setAutoIndent },
    indent_automatic_prefixes: { enumerable: true, configurable: true, get: () => packedStringArray(autoIndentPrefixes), set: setAutoIndentPrefixes },
    auto_brace_completion_enabled: { enumerable: true, configurable: true, get: () => autoBraceCompletion, set: setAutoBraceCompletion },
    auto_brace_completion_highlight_matching: { enumerable: true, configurable: true, get: () => highlightMatchingBraces, set: setHighlightMatchingBraces },
    auto_brace_completion_pairs: { enumerable: true, configurable: true, get: () => new Map(autoBracePairs), set: setAutoBracePairs },
    gutters_draw_breakpoints_gutter: { enumerable: true, configurable: true, get: () => drawBreakpoints, set: setDrawBreakpoints },
    gutters_draw_bookmarks: { enumerable: true, configurable: true, get: () => drawBookmarks, set: setDrawBookmarks },
    gutters_draw_executing_lines: { enumerable: true, configurable: true, get: () => drawExecuting, set: setDrawExecuting },
    gutters_draw_line_numbers: { enumerable: true, configurable: true, get: () => drawLineNumbers, set: setDrawLineNumbers },
    gutters_zero_pad_line_numbers: { enumerable: true, configurable: true, get: () => zeroPadLineNumbers, set: setZeroPadLineNumbers },
    gutters_line_numbers_min_digits: { enumerable: true, configurable: true, get: () => lineNumberMinimumDigits, set: setLineNumberMinimumDigits },
  });
  return code;
}

function highlighter(value: unknown): GodotSyntaxHighlighter | null {
  if (value === null) return null;
  if (typeof value !== 'object' || typeof Reflect.get(value, 'get_text_edit') !== 'function') {
    throw new TypeError('CodeEdit.syntax_highlighter requires a SyntaxHighlighter resource or null.');
  }
  return value as GodotSyntaxHighlighter;
}

export function createGodotGDScriptSyntaxHighlighter(): GodotSyntaxHighlighter {
  const resource: GodotSyntaxHighlighter = {
    get_text_edit: () => HIGHLIGHTER_OWNERS.get(resource) ?? null,
    get_line_syntax_highlighting: (line) => { integer(line, 'highlight line'); return new Map(); },
    clear_highlighting_cache: () => {},
    update_cache: () => {},
  };
  registerGodotObjectIdentity(resource, 'GDScriptSyntaxHighlighter');
  bindGodotResourceProtocol(resource, {
    createDuplicate: () => createGodotGDScriptSyntaxHighlighter(),
    populateDuplicate: () => {},
  });
  return resource;
}

export function createGodotCodeHighlighter(): GodotCodeHighlighter {
  let numberColor = { r: 0.63, g: 0.78, b: 1, a: 1 };
  let symbolColor = { r: 0.72, g: 0.75, b: 0.82, a: 1 };
  let functionColor = { r: 0.4, g: 0.86, b: 0.8, a: 1 };
  let memberVariableColor = { r: 0.82, g: 0.68, b: 1, a: 1 };
  const keywords = new Map<string, ColorValue>();
  const memberKeywords = new Map<string, ColorValue>();
  const regions = new Map<string, { end: string; color: ColorValue; lineOnly: boolean }>();
  const lineCache = new Map<number, ReadonlyMap<number, { readonly color: ColorValue }>>();
  const dictionary = (value: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>, member: string): Map<string, ColorValue> => {
    const entries = value instanceof Map ? [...value.entries()] : typeof value === 'object' && value !== null ? Object.entries(value) : null;
    if (entries === null) throw new TypeError(`CodeHighlighter.${member} requires Dictionary.`);
    return new Map(entries.map(([key, color]) => [text(key, member), highlightColor(color, member)]));
  };
  const reset = (): void => { lineCache.clear(); };
  const resource = {} as GodotCodeHighlighter;
  Object.defineProperties(resource, {
    number_color: { enumerable: true, configurable: true, get: () => ({ ...numberColor }), set: (value: ColorValue) => { numberColor = highlightColor(value, 'number_color'); reset(); } },
    symbol_color: { enumerable: true, configurable: true, get: () => ({ ...symbolColor }), set: (value: ColorValue) => { symbolColor = highlightColor(value, 'symbol_color'); reset(); } },
    function_color: { enumerable: true, configurable: true, get: () => ({ ...functionColor }), set: (value: ColorValue) => { functionColor = highlightColor(value, 'function_color'); reset(); } },
    member_variable_color: { enumerable: true, configurable: true, get: () => ({ ...memberVariableColor }), set: (value: ColorValue) => { memberVariableColor = highlightColor(value, 'member_variable_color'); reset(); } },
  });
  Object.assign(resource, {
    get_text_edit(): GodotCodeEdit | null { return HIGHLIGHTER_OWNERS.get(resource) ?? null; },
    set_number_color(value: ColorValue): void { resource.number_color = value; },
    get_number_color(): ColorValue { return resource.number_color; },
    set_symbol_color(value: ColorValue): void { resource.symbol_color = value; },
    get_symbol_color(): ColorValue { return resource.symbol_color; },
    set_function_color(value: ColorValue): void { resource.function_color = value; },
    get_function_color(): ColorValue { return resource.function_color; },
    set_member_variable_color(value: ColorValue): void { resource.member_variable_color = value; },
    get_member_variable_color(): ColorValue { return resource.member_variable_color; },
    add_keyword_color(keyword: string, color: ColorValue): void { keywords.set(text(keyword, 'keyword'), highlightColor(color, 'keyword color')); reset(); },
    remove_keyword_color(keyword: string): void { keywords.delete(text(keyword, 'keyword')); reset(); },
    has_keyword_color(keyword: string): boolean { return keywords.has(text(keyword, 'keyword')); },
    get_keyword_color(keyword: string): ColorValue { return { ...(keywords.get(text(keyword, 'keyword')) ?? { r: 0, g: 0, b: 0, a: 1 }) }; },
    set_keyword_colors(value: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void { keywords.clear(); for (const entry of dictionary(value, 'keyword_colors')) keywords.set(...entry); reset(); },
    clear_keyword_colors(): void { keywords.clear(); reset(); },
    get_keyword_colors(): ReadonlyMap<string, ColorValue> { return new Map([...keywords].map(([key, color]) => [key, { ...color }])); },
    add_member_keyword_color(keyword: string, color: ColorValue): void { memberKeywords.set(text(keyword, 'member keyword'), highlightColor(color, 'member keyword color')); reset(); },
    remove_member_keyword_color(keyword: string): void { memberKeywords.delete(text(keyword, 'member keyword')); reset(); },
    has_member_keyword_color(keyword: string): boolean { return memberKeywords.has(text(keyword, 'member keyword')); },
    get_member_keyword_color(keyword: string): ColorValue { return { ...(memberKeywords.get(text(keyword, 'member keyword')) ?? { r: 0, g: 0, b: 0, a: 1 }) }; },
    set_member_keyword_colors(value: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void { memberKeywords.clear(); for (const entry of dictionary(value, 'member_keyword_colors')) memberKeywords.set(...entry); reset(); },
    clear_member_keyword_colors(): void { memberKeywords.clear(); reset(); },
    get_member_keyword_colors(): ReadonlyMap<string, ColorValue> { return new Map([...memberKeywords].map(([key, color]) => [key, { ...color }])); },
    add_color_region(startKey: string, endKey: string, color: ColorValue, lineOnly = false): void { const start = text(startKey, 'region start'); if (start === '') throw new RangeError('CodeHighlighter region start must not be empty.'); regions.set(start, { end: text(endKey, 'region end'), color: highlightColor(color, 'region color'), lineOnly: bool(lineOnly, 'region line_only') }); reset(); },
    remove_color_region(startKey: string): void { regions.delete(text(startKey, 'region start')); reset(); },
    has_color_region(startKey: string): boolean { return regions.has(text(startKey, 'region start')); },
    get_color_region_end_key(startKey: string): string { return regions.get(text(startKey, 'region start'))?.end ?? ''; },
    set_color_regions(value: ReadonlyMap<string, ColorValue> | Record<string, ColorValue>): void { regions.clear(); for (const [start, color] of dictionary(value, 'color_regions')) regions.set(start, { end: '', color, lineOnly: false }); reset(); },
    clear_color_regions(): void { regions.clear(); reset(); },
    get_color_regions(): ReadonlyMap<string, ColorValue> { return new Map([...regions].map(([start, region]) => [start, { ...region.color }])); },
    get_line_syntax_highlighting(line: number): ReadonlyMap<number, { readonly color: ColorValue }> {
      const index = integer(line, 'highlight line');
      const cached = lineCache.get(index); if (cached !== undefined) return cached;
      const source = resource.get_text_edit()?.text.split('\n')[index] ?? '';
      const colors = new Map<number, { readonly color: ColorValue }>();
      for (const [start, region] of regions) { const offset = source.indexOf(start); if (offset >= 0) colors.set(offset, { color: { ...region.color } }); }
      for (const match of source.matchAll(/\b(?:\d+(?:\.\d+)?|0x[\da-f]+)\b/gi)) colors.set(match.index, { color: { ...numberColor } });
      for (const match of source.matchAll(/[A-Za-z_]\w*/g)) {
        const keyword = keywords.get(match[0]);
        const member = memberKeywords.get(match[0]);
        if (keyword !== undefined) colors.set(match.index, { color: { ...keyword } });
        else if (member !== undefined) colors.set(match.index, { color: { ...member } });
        else if (/^\s*\(/.test(source.slice(match.index + match[0].length))) colors.set(match.index, { color: { ...functionColor } });
      }
      const frozen = new Map([...colors].sort(([left], [right]) => left - right)); lineCache.set(index, frozen); return frozen;
    },
    clear_highlighting_cache(): void { reset(); },
    update_cache(): void { reset(); },
  });
  registerGodotObjectIdentity(resource, 'CodeHighlighter');
  bindGodotResourceProtocol(resource, {
    createDuplicate: () => createGodotCodeHighlighter(),
    populateDuplicate: (source, target) => {
      target.number_color = source.number_color; target.symbol_color = source.symbol_color;
      target.function_color = source.function_color; target.member_variable_color = source.member_variable_color;
      target.set_keyword_colors(source.get_keyword_colors()); target.set_member_keyword_colors(source.get_member_keyword_colors());
      target.set_color_regions(source.get_color_regions());
    },
  });
  return resource;
}

export function createGodotCanvasCodeEdit(): GodotCodeEdit {
  const node = new Text({ text: '' });
  return bindGodotCanvasCodeEdit({
    node,
    text: '',
    placeholder_text: '',
    editable: true,
  });
}

export function bindGodotCanvasCodeEdit(options: CanvasTextEditOptions): GodotCodeEdit {
  let detachHighlighter = (): void => {};
  const edit = bindCanvasTextEdit({
    ...options,
    onRelease: () => {
      detachHighlighter();
      options.onRelease?.();
    },
  });
  const code = bindGodotCodeEdit(edit);
  detachHighlighter = () => code.set_syntax_highlighter(null);
  return code;
}

export function bindGodotCodeEdit(edit: GodotTextEdit): GodotCodeEdit {
  registerGodotObjectIdentity(edit as object, 'CodeEdit');
  let current: GodotSyntaxHighlighter | null = null;
  const code = bindCodeEdit(edit);
  const set = (value: unknown): void => {
    const next = highlighter(value);
    if (next === current) return;
    if (next !== null) {
      const owner = HIGHLIGHTER_OWNERS.get(next);
      if (owner !== undefined && owner !== code) {
        throw new Error('SyntaxHighlighter is already attached to another CodeEdit.');
      }
    }
    if (current !== null) HIGHLIGHTER_OWNERS.delete(current);
    current = next;
    if (next !== null) HIGHLIGHTER_OWNERS.set(next, code);
  };
  Object.defineProperties(code, {
    syntax_highlighter: { enumerable: true, configurable: true, get: () => current, set },
    set_syntax_highlighter: { configurable: true, value: set },
    get_syntax_highlighter: { configurable: true, value: () => current },
  });
  return code;
}
