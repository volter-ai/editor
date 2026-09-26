/** OptionButton and ItemList state shared by retained DOM and Pixi presentations. */

import { packedInt32Array, type PackedInt32Array } from './packed-array';
import { createSignal, type GodotConnection, type GodotSignal, type SignalHandle } from './signal';
import {
  controlBinding,
  createControlHandle,
  createControlState,
  type ControlColor,
  type ControlChoiceItem,
  type GodotControl,
  type ControlPoint,
} from './control-state';
import { projectGodotTexture } from './button-icon';
import { bindHSlider, type GodotRangeControl } from './control-widgets';
import { registerGodotObjectIdentity } from './object';

interface ChoiceItem extends ControlChoiceItem {
  text: string;
  id: number;
  separator: boolean;
  disabled: boolean;
  selected: boolean;
  selectable: boolean;
  tooltip: string;
  metadata: unknown;
  tooltipEnabled: boolean;
  iconIdentity?: unknown;
  icon?: unknown;
  iconSource?: string;
  customFgColor?: ControlColor;
  customBgColor?: ControlColor;
  iconModulate?: ControlColor;
  iconTransposed?: boolean;
  iconRegion?: unknown;
  tagIcon?: unknown;
  tagIconIdentity?: unknown;
  language?: string;
  textDirection?: number;
}

export interface AuthoredChoiceItem {
  readonly text: string;
  readonly id?: number;
  readonly separator?: boolean;
  readonly disabled?: boolean;
  readonly selectable?: boolean;
  readonly metadata?: unknown;
}

export interface GodotChoiceScrollBar {
  min_value: number;
  max_value: number;
  page: number;
  value: number;
  visible: boolean;
  readonly value_changed: GodotSignal<readonly [number]>;
  set_value_no_signal(value: number): void;
}

interface ChoiceState {
  readonly items: ChoiceItem[];
  readonly selected: Set<number>;
  readonly selectionChanged: SignalHandle<readonly [number]>;
  popupIdPressed?: SignalHandle<readonly [number]>;
  popupIndexPressed?: SignalHandle<readonly [number]>;
  multiple: boolean;
  allowReselect: boolean;
  allowRmbSelect: boolean;
  allowSearch: boolean;
  autoHeight: boolean;
  maxColumns: number;
  sameColumnWidth: boolean;
  iconMode: number;
  fixedIconSize: ControlPoint;
  textOverrunBehavior: number;
  wraparound: boolean;
  current: number;
  scrollIndex: number;
  scrollOffset: number;
  viewportHeight?: number;
  syncingScrollBar: boolean;
  scrollConnection?: GodotConnection;
  readonly vScrollBar?: GodotChoiceScrollBar;
  readonly godotMajor: 3 | 4;
}

const CHOICES = new WeakMap<object, ChoiceState>();

/** The retained Pixi ItemList renderer's authored row extent. */
export const ITEM_LIST_ROW_HEIGHT = 24;

function createInternalVScrollBar(godotMajor: 3 | 4): GodotRangeControl {
  const state = createControlState();
  const control = createControlHandle('item-list-v-scroll-bar', {
    visible: false,
    text: '',
    texture: '',
    position: { x: 0, y: 0 },
    size: { x: 0, y: 0 },
    custom_minimum_size: { x: 0, y: 0 },
    size_flags_horizontal: 0,
    size_flags_vertical: 0,
    mouse_filter: 0,
    focusMode: 0,
    pivot_offset: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    modulate: { r: 1, g: 1, b: 1, a: 1 },
  }, state);
  const scrollBar = bindHSlider(control, {
    godot_major: godotMajor,
    min_value: 0,
    max_value: 0,
    step: 1,
    page: 0,
    value: 0,
    vertical: true,
    custom_step: -1,
  });
  registerGodotObjectIdentity(scrollBar, 'VScrollBar');
  return scrollBar;
}

function integer(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer; received ${String(value)}.`);
  }
  return value;
}

function boolean(name: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be bool.`);
  return value;
}

function string(name: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be String.`);
  return value;
}

function indexOf(state: ChoiceState, index: number, member: string): number {
  const resolved = integer(`${member} index`, index);
  if (resolved < 0 || resolved >= state.items.length) {
    throw new RangeError(`${member} index ${resolved} is outside [0, ${state.items.length}).`);
  }
  return resolved;
}

function stateOf(control: object, member: string): ChoiceState {
  const state = CHOICES.get(control);
  if (state === undefined) throw new Error(`${member} requires a retained OptionButton/ItemList.`);
  return state;
}

function emitChoiceSelection(state: ChoiceState, item: ChoiceItem, index: number, repeated: boolean): void {
  // The internal PopupMenu observes every accepted activation. OptionButton's
  // item_selected signal separately obeys allow_reselect for the current item.
  state.popupIdPressed?.emit(item.id >= 0 ? item.id : index);
  state.popupIndexPressed?.emit(index);
  if (!repeated || state.allowReselect) state.selectionChanged.emit(index);
}

function assignItemIcon(item: ChoiceItem, value: unknown, member: string): void {
  const projected = projectGodotTexture(value, member);
  item.iconIdentity = projected.identity;
  item.icon = projected.pixiTexture ?? projected.identity ?? undefined;
  if (projected.domSource === undefined) delete item.iconSource;
  else item.iconSource = projected.domSource;
}

function resizeChoiceItems(state: ChoiceState, count: number, member: string): void {
  const size = integer(`${member} count`, count);
  if (size < 0) throw new RangeError(`${member} count must be non-negative.`);
  while (state.items.length < size) {
    const index = state.items.length;
    state.items.push({ text: '', id: index, metadata: null, separator: false, disabled: false, selected: false, selectable: true, tooltip: '', tooltipEnabled: true });
  }
  if (state.items.length > size) state.items.length = size;
  for (const selected of [...state.selected]) if (selected >= size) state.selected.delete(selected);
  if (state.current >= size) state.current = -1;
  state.scrollIndex = Math.max(0, Math.min(state.scrollIndex, Math.max(0, size - 1)));
  state.scrollOffset = state.scrollIndex * ITEM_LIST_ROW_HEIGHT;
}

function snapshot(control: GodotControl, state: ChoiceState): void {
  const binding = controlBinding(control);
  if (state.vScrollBar !== undefined) {
    const measuredHeight = binding.state.read(binding.id).size?.y ?? binding.state.authored(binding.id)?.size.y ?? 0;
    const viewportHeight = Math.max(0, state.viewportHeight ?? measuredHeight);
    const contentHeight = state.items.length * ITEM_LIST_ROW_HEIGHT;
    state.syncingScrollBar = true;
    try {
      state.vScrollBar.min_value = 0;
      state.vScrollBar.max_value = contentHeight;
      state.vScrollBar.page = Math.min(viewportHeight, contentHeight);
      state.vScrollBar.set_value_no_signal(state.scrollOffset);
      state.scrollOffset = state.vScrollBar.value;
      state.scrollIndex = Math.floor(state.scrollOffset / ITEM_LIST_ROW_HEIGHT);
      state.vScrollBar.visible = contentHeight > viewportHeight;
    } finally {
      state.syncingScrollBar = false;
    }
  }
  binding.state.write(binding.id, {
    choiceItems: state.items.map((item, index) => ({
      text: item.text,
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.iconSource === undefined ? {} : { iconSource: item.iconSource }),
      ...(item.customFgColor === undefined ? {} : { customFgColor: item.customFgColor }),
      id: item.id,
      separator: item.separator,
      disabled: item.disabled,
      selected: state.selected.has(index),
      selectable: item.selectable,
      tooltip: item.tooltipEnabled ? item.tooltip : '',
    })),
    choiceSelected: state.selected.values().next().value ?? -1,
    choiceMultiple: state.multiple,
    choiceScrollIndex: state.scrollIndex,
    choiceScrollOffset: state.scrollOffset,
  });
}

function createState(control: GodotControl, multiple: boolean, allowReselect: boolean, vScrollBar?: GodotChoiceScrollBar, godotMajor: 3 | 4 = 4): ChoiceState {
  if (CHOICES.has(control)) throw new Error('Choice Control is already bound.');
  const state: ChoiceState = {
    items: [],
    selected: new Set(),
    selectionChanged: createSignal<readonly [number]>(),
    multiple,
    allowReselect,
    allowRmbSelect: false,
    allowSearch: true,
    autoHeight: false,
    maxColumns: 1,
    sameColumnWidth: false,
    iconMode: 1,
    fixedIconSize: { x: 0, y: 0 },
    textOverrunBehavior: 0,
    wraparound: false,
    current: -1,
    scrollIndex: 0,
    scrollOffset: 0,
    syncingScrollBar: false,
    ...(vScrollBar === undefined ? {} : { vScrollBar }),
    godotMajor,
  };
  CHOICES.set(control, state);
  if (state.vScrollBar !== undefined) {
    state.scrollConnection = state.vScrollBar.value_changed.connect((value) => {
      if (state.syncingScrollBar) return;
      state.scrollOffset = Math.max(0, value);
      state.scrollIndex = Math.floor(state.scrollOffset / ITEM_LIST_ROW_HEIGHT);
      snapshot(control, state);
    });
  }
  const binding = controlBinding(control);
  binding.state.write(binding.id, {
    choiceItems: [],
    choiceSelected: -1,
    choiceMultiple: multiple,
    onChoiceSelect(indices): void {
      const prior = new Set(state.selected);
      state.selected.clear();
      for (const raw of indices) {
        const index = indexOf(state, raw, 'choice selection');
        const item = state.items[index] as ChoiceItem;
        if (item.disabled || item.separator || !item.selectable) continue;
        const repeated = prior.has(index);
        state.selected.add(index);
        state.current = index;
        emitChoiceSelection(state, item, index, repeated);
        if (!multiple) break;
      }
      snapshot(control, state);
    },
  });
  return state;
}

export interface GodotOptionButton extends GodotControl {
  selected: number;
  fit_to_longest_item: boolean;
  allow_reselect: boolean;
  disable_shortcuts: boolean;
  text_overrun_behavior: number;
  readonly item_count: number;
  readonly item_selected: GodotSignal<readonly [number]>;
  get_popup(): GodotOptionButtonPopup;
  add_item(label: string, id?: number): void;
  add_icon_item(icon: unknown, label: string, id?: number): void;
  add_separator(label?: string, id?: number): void;
  clear(): void;
  select(index: number): void;
  get_selected(): number;
  get_selected_id(): number;
  get_selected_metadata(): unknown;
  get_item_count(): number;
  get_item_id(index: number): number;
  get_item_index(id: number): number;
  get_item_text(index: number): string;
  get_item_metadata(index: number): unknown;
  set_item_icon(index: number, icon: unknown): void;
  get_item_icon(index: number): unknown;
  set_item_count(count: number): void;
  set_item_metadata(index: number, value: unknown): void;
  remove_item(index: number): void;
  set_item_text(index: number, value: string): void;
  set_item_id(index: number, value: number): void;
  set_item_disabled(index: number, disabled: boolean): void;
  is_item_disabled(index: number): boolean;
  set_item_as_separator(index: number, separator: boolean): void;
  is_item_separator(index: number): boolean;
  set_item_tooltip(index: number, tooltip: string): void;
  get_item_tooltip(index: number): string;
  set_item_auto_translate_mode(index: number, mode: number): void;
  get_item_auto_translate_mode(index: number): number;
  set_item_text_direction(index: number, direction: number): void;
  get_item_text_direction(index: number): number;
  set_item_language(index: number, language: string): void;
  get_item_language(index: number): string;
  set_fit_to_longest_item(enabled: boolean): void;
  is_fit_to_longest_item(): boolean;
  set_allow_reselect(enabled: boolean): void;
  get_allow_reselect(): boolean;
  set_disable_shortcuts(enabled: boolean): void;
  is_shortcuts_disabled(): boolean;
  set_text_overrun_behavior(behavior: number): void;
  get_text_overrun_behavior(): number;
  show_popup(): void;
}

/** The stable PopupMenu identity owned by an OptionButton.
 *
 * Godot does not copy the option items into a second menu: mutations through
 * get_popup() affect the same menu which the button presents. Keep this
 * facade intentionally limited to operations the retained choice model can
 * honor without inventing a second popup hierarchy.
 */
export interface GodotOptionButtonPopup {
  readonly id_pressed: GodotSignal<readonly [number]>;
  readonly index_pressed: GodotSignal<readonly [number]>;
  item_count: number;
  get_item_count(): number;
  get_item_id(index: number): number;
  get_item_index(id: number): number;
  get_item_text(index: number): string;
  get_item_metadata(index: number): unknown;
  get_item_icon(index: number): unknown;
  is_item_disabled(index: number): boolean;
  is_item_separator(index: number): boolean;
  set_item_count(count: number): void;
  set_item_id(index: number, value: number): void;
  set_item_text(index: number, value: string): void;
  set_item_metadata(index: number, value: unknown): void;
  set_item_icon(index: number, icon: unknown): void;
  set_item_disabled(index: number, disabled: boolean): void;
  set_item_as_separator(index: number, separator: boolean): void;
  set_item_tooltip(index: number, tooltip: string): void;
  get_item_tooltip(index: number): string;
  set_item_text_direction(index: number, direction: number): void;
  get_item_text_direction(index: number): number;
  set_item_language(index: number, language: string): void;
  get_item_language(index: number): string;
  remove_item(index: number): void;
  activate_item(index: number): void;
}

function bindOptionButtonPopup(
  control: GodotControl,
  option: GodotOptionButton,
  state: ChoiceState,
): GodotOptionButtonPopup {
  const popup = {} as GodotOptionButtonPopup;
  const idPressed = createSignal<readonly [number]>();
  const indexPressed = createSignal<readonly [number]>();
  state.popupIdPressed = idPressed;
  state.popupIndexPressed = indexPressed;
  Object.defineProperties(popup, {
    id_pressed: { enumerable: true, configurable: true, value: idPressed.signal },
    index_pressed: { enumerable: true, configurable: true, value: indexPressed.signal },
    item_count: {
      enumerable: true,
      configurable: true,
      get: () => option.get_item_count(),
      set: (value: number) => option.set_item_count(value),
    },
  });
  Object.assign(popup, {
    get_item_count(): number { return option.get_item_count(); },
    get_item_id(index: number): number { return option.get_item_id(index); },
    get_item_index(id: number): number { return option.get_item_index(id); },
    get_item_text(index: number): string { return option.get_item_text(index); },
    get_item_metadata(index: number): unknown { return option.get_item_metadata(index); },
    get_item_icon(index: number): unknown { return option.get_item_icon(index); },
    is_item_disabled(index: number): boolean { return option.is_item_disabled(index); },
    is_item_separator(index: number): boolean { return option.is_item_separator(index); },
    set_item_count(count: number): void { option.set_item_count(count); },
    set_item_id(index: number, value: number): void { option.set_item_id(index, value); },
    set_item_text(index: number, value: string): void { option.set_item_text(index, value); },
    set_item_metadata(index: number, value: unknown): void { option.set_item_metadata(index, value); },
    set_item_icon(index: number, icon: unknown): void { option.set_item_icon(index, icon); },
    set_item_disabled(index: number, disabled: boolean): void { option.set_item_disabled(index, disabled); },
    set_item_as_separator(index: number, separator: boolean): void { option.set_item_as_separator(index, separator); },
    set_item_tooltip(index: number, tooltip: string): void { option.set_item_tooltip(index, tooltip); },
    get_item_tooltip(index: number): string { return option.get_item_tooltip(index); },
    set_item_text_direction(index: number, direction: number): void { option.set_item_text_direction(index, direction); },
    get_item_text_direction(index: number): number { return option.get_item_text_direction(index); },
    set_item_language(index: number, language: string): void { option.set_item_language(index, language); },
    get_item_language(index: number): string { return option.get_item_language(index); },
    remove_item(index: number): void { option.remove_item(index); },
    activate_item(index: number): void {
      const resolved = indexOf(state, index, 'PopupMenu.activate_item');
      const item = state.items[resolved]!;
      if (item.disabled || item.separator || !item.selectable) return;
      const repeated = state.selected.has(resolved);
      state.selected.clear();
      state.selected.add(resolved);
      state.current = resolved;
      emitChoiceSelection(state, item, resolved, repeated);
      snapshot(control, state);
    },
  });
  registerGodotObjectIdentity(popup, 'PopupMenu');
  return popup;
}

export function bindOptionButton(
  control: GodotControl,
  initial: { readonly items?: readonly AuthoredChoiceItem[]; readonly selected?: number } = {},
): GodotOptionButton {
  const option = control as GodotOptionButton;
  const state = createState(control, false, false);
  let fitToLongestItem = true;
  let disableShortcuts = false;
  let textOverrunBehavior = 0;
  const autoTranslateModes = new Map<number, number>();
  const add = (label: string, id: number, separator: boolean): void => {
    string('OptionButton item label', label);
    const index = state.items.length;
    const authoredId = integer('OptionButton item id', id);
    state.items.push({
      text: label,
      id: authoredId < 0 ? index : authoredId,
      metadata: null,
      separator,
      disabled: separator,
      selected: false,
      selectable: !separator,
      tooltip: '',
      tooltipEnabled: true,
    });
    if (!separator && state.selected.size === 0) state.selected.add(index);
    snapshot(control, state);
  };
  const popup = bindOptionButtonPopup(control, option, state);
  Object.defineProperties(option, {
    selected: {
      enumerable: true,
      configurable: true,
      get: () => state.selected.values().next().value ?? -1,
      set: (value: number) => option.select(value),
    },
    fit_to_longest_item: { enumerable: true, configurable: true, get: () => fitToLongestItem, set: (value: boolean) => { fitToLongestItem = boolean('OptionButton.fit_to_longest_item', value); snapshot(control, state); } },
    allow_reselect: { enumerable: true, configurable: true, get: () => state.allowReselect, set: (value: boolean) => { state.allowReselect = boolean('OptionButton.allow_reselect', value); } },
    disable_shortcuts: { enumerable: true, configurable: true, get: () => disableShortcuts, set: (value: boolean) => { disableShortcuts = boolean('OptionButton.disable_shortcuts', value); } },
    text_overrun_behavior: { enumerable: true, configurable: true, get: () => textOverrunBehavior, set: (value: number) => { textOverrunBehavior = integer('OptionButton.text_overrun_behavior', value); snapshot(control, state); } },
    item_count: { enumerable: true, configurable: true, get: () => state.items.length },
    item_selected: { enumerable: true, configurable: true, value: state.selectionChanged.signal },
  });
  Object.assign(option, {
    get_popup(): GodotOptionButtonPopup { return popup; },
    add_item(label: string, id = -1): void { add(label, id, false); },
    add_icon_item(icon: unknown, label: string, id = -1): void {
      add(label, id, false);
      assignItemIcon(state.items.at(-1)!, icon, 'OptionButton.add_icon_item');
      snapshot(control, state);
    },
    add_separator(label = '', id = -1): void { add(label, id, true); },
    clear(): void { state.items.length = 0; state.selected.clear(); state.current = -1; state.scrollIndex = 0; snapshot(control, state); },
    select(index: number): void {
      if (index === -1) { state.selected.clear(); snapshot(control, state); return; }
      const resolved = indexOf(state, index, 'OptionButton.select');
      if (state.items[resolved]?.separator === true || state.items[resolved]?.disabled === true) return;
      state.selected.clear();
      state.selected.add(resolved);
      state.current = resolved;
      snapshot(control, state);
    },
    get_selected(): number { return option.selected; },
    get_selected_id(): number { return option.selected < 0 ? -1 : state.items[option.selected]?.id ?? -1; },
    get_selected_metadata(): unknown { return option.selected < 0 ? null : state.items[option.selected]?.metadata ?? null; },
    get_item_count(): number { return state.items.length; },
    get_item_id(index: number): number { return state.items[indexOf(state, index, 'OptionButton.get_item_id')]!.id; },
    get_item_index(id: number): number { return state.items.findIndex((item) => item.id === integer('OptionButton item id', id)); },
    get_item_text(index: number): string { return state.items[indexOf(state, index, 'OptionButton.get_item_text')]!.text; },
    get_item_metadata(index: number): unknown { return state.items[indexOf(state, index, 'OptionButton.get_item_metadata')]!.metadata; },
    set_item_icon(index: number, icon: unknown): void {
      assignItemIcon(state.items[indexOf(state, index, 'OptionButton.set_item_icon')]!, icon, 'OptionButton.set_item_icon');
      snapshot(control, state);
    },
    get_item_icon(index: number): unknown {
      return state.items[indexOf(state, index, 'OptionButton.get_item_icon')]!.iconIdentity ?? null;
    },
    set_item_count(count: number): void { resizeChoiceItems(state, count, 'OptionButton.set_item_count'); snapshot(control, state); },
    set_item_metadata(index: number, value: unknown): void {
      state.items[indexOf(state, index, 'OptionButton.set_item_metadata')]!.metadata = value;
    },
    remove_item(index: number): void {
      const resolved = indexOf(state, index, 'OptionButton.remove_item');
      state.items.splice(resolved, 1);
      const selected = option.selected;
      state.selected.clear();
      if (selected !== resolved && state.items.length > 0) {
        state.selected.add(selected > resolved ? selected - 1 : Math.max(0, selected));
      }
      snapshot(control, state);
    },
    set_item_text(index: number, value: string): void {
      state.items[indexOf(state, index, 'OptionButton.set_item_text')]!.text = string('OptionButton item text', value);
      snapshot(control, state);
    },
    set_item_id(index: number, value: number): void {
      state.items[indexOf(state, index, 'OptionButton.set_item_id')]!.id = integer('OptionButton item id', value);
      snapshot(control, state);
    },
    set_item_disabled(index: number, disabled: boolean): void {
      state.items[indexOf(state, index, 'OptionButton.set_item_disabled')]!.disabled = boolean('OptionButton item disabled', disabled);
      snapshot(control, state);
    },
    is_item_disabled(index: number): boolean {
      return state.items[indexOf(state, index, 'OptionButton.is_item_disabled')]!.disabled;
    },
    set_item_as_separator(index: number, separator: boolean): void {
      const entry = state.items[indexOf(state, index, 'OptionButton.set_item_as_separator')]!;
      entry.separator = boolean('OptionButton item separator', separator);
      entry.selectable = !entry.separator;
      snapshot(control, state);
    },
    is_item_separator(index: number): boolean {
      return state.items[indexOf(state, index, 'OptionButton.is_item_separator')]!.separator;
    },
    set_item_tooltip(index: number, tooltip: string): void { state.items[indexOf(state, index, 'OptionButton.set_item_tooltip')]!.tooltip = string('OptionButton item tooltip', tooltip); snapshot(control, state); },
    get_item_tooltip(index: number): string { return state.items[indexOf(state, index, 'OptionButton.get_item_tooltip')]!.tooltip; },
    set_item_auto_translate_mode(index: number, mode: number): void { autoTranslateModes.set(indexOf(state, index, 'OptionButton.set_item_auto_translate_mode'), integer('OptionButton item auto translate mode', mode)); },
    get_item_auto_translate_mode(index: number): number { return autoTranslateModes.get(indexOf(state, index, 'OptionButton.get_item_auto_translate_mode')) ?? 0; },
    set_item_text_direction(index: number, direction: number): void { state.items[indexOf(state, index, 'OptionButton.set_item_text_direction')]!.textDirection = integer('OptionButton item text direction', direction); snapshot(control, state); },
    get_item_text_direction(index: number): number { return state.items[indexOf(state, index, 'OptionButton.get_item_text_direction')]!.textDirection ?? -1; },
    set_item_language(index: number, language: string): void { state.items[indexOf(state, index, 'OptionButton.set_item_language')]!.language = string('OptionButton item language', language); snapshot(control, state); },
    get_item_language(index: number): string { return state.items[indexOf(state, index, 'OptionButton.get_item_language')]!.language ?? ''; },
    set_fit_to_longest_item(enabled: boolean): void { option.fit_to_longest_item = enabled; },
    is_fit_to_longest_item(): boolean { return fitToLongestItem; },
    set_allow_reselect(enabled: boolean): void { option.allow_reselect = enabled; },
    get_allow_reselect(): boolean { return state.allowReselect; },
    set_disable_shortcuts(enabled: boolean): void { option.disable_shortcuts = enabled; },
    is_shortcuts_disabled(): boolean { return disableShortcuts; },
    set_text_overrun_behavior(behavior: number): void { option.text_overrun_behavior = behavior; },
    get_text_overrun_behavior(): number { return textOverrunBehavior; },
    show_popup(): void { controlBinding(control).state.write(controlBinding(control).id, { choicePopupOpen: true }); },
  });
  for (const authored of initial.items ?? []) {
    add(authored.text, authored.id ?? -1, authored.separator ?? false);
    const entry = state.items.at(-1)!;
    entry.disabled = authored.disabled ?? entry.disabled;
    entry.selectable = authored.selectable ?? entry.selectable;
    entry.metadata = authored.metadata ?? null;
  }
  if (initial.selected !== undefined) option.select(initial.selected);
  snapshot(control, state);
  return option;
}

export interface GodotItemList extends GodotControl {
  readonly item_count: number;
  readonly item_selected: GodotSignal<readonly [number]>;
  readonly item_clicked: GodotSignal<readonly [number, ControlPoint, number]>;
  readonly multi_selected: GodotSignal<readonly [number, boolean]>;
  readonly empty_clicked: GodotSignal<readonly [ControlPoint, number]>;
  readonly item_activated: GodotSignal<readonly [number]>;
  allow_reselect: boolean;
  allow_rmb_select: boolean;
  allow_search: boolean;
  auto_height: boolean;
  max_columns: number;
  same_column_width: boolean;
  icon_mode: number;
  fixed_icon_size: ControlPoint;
  text_overrun_behavior: number;
  wraparound_items: boolean;
  select_mode: number;
  add_item(text: string): number | void;
  add_icon_item(icon: unknown, selectable?: boolean): number | void;
  clear(): void;
  select(index: number, single?: boolean): void;
  remove_item(index: number): void;
  move_item(from: number, to: number): void;
  unselect_all(): void;
  deselect_all(): void;
  get_item_count(): number;
  get_item_text(index: number): string;
  set_item_text(index: number, text: string): void;
  set_item_icon(index: number, icon: unknown): void;
  get_item_icon(index: number): unknown;
  set_item_count(count: number): void;
  set_item_custom_fg_color(index: number, color: ControlColor): void;
  get_item_custom_fg_color(index: number): ControlColor | null;
  set_item_custom_bg_color(index: number, color: ControlColor): void;
  get_item_custom_bg_color(index: number): ControlColor | null;
  set_item_icon_modulate(index: number, color: ControlColor): void;
  get_item_icon_modulate(index: number): ControlColor;
  set_item_icon_transposed(index: number, transposed: boolean): void;
  is_item_icon_transposed(index: number): boolean;
  set_item_icon_region(index: number, region: unknown): void;
  get_item_icon_region(index: number): unknown;
  set_item_tag_icon(index: number, icon: unknown): void;
  get_item_tag_icon(index: number): unknown;
  set_item_text_direction(index: number, direction: number): void;
  get_item_text_direction(index: number): number;
  set_item_language(index: number, language: string): void;
  get_item_language(index: number): string;
  get_item_metadata(index: number): unknown;
  set_item_metadata(index: number, value: unknown): void;
  get_selected_items(): PackedInt32Array;
  set_item_selectable(index: number, selectable: boolean): void;
  set_item_tooltip(index: number, tooltip: string): void;
  set_item_tooltip_enabled(index: number, enabled: boolean): void;
  sort_items_by_text(): void;
  ensure_current_is_visible(): void;
  deselect(index: number): void;
  is_selected(index: number): boolean;
  get_current(): number;
  /** Godot 3 spelling; returns the retained VScrollBar object, not its numeric value. */
  get_v_scroll(): GodotChoiceScrollBar;
  get_v_scroll_bar(): GodotChoiceScrollBar;
  set_current(index: number): void;
  set_item_disabled(index: number, disabled: boolean): void;
  is_item_disabled(index: number): boolean;
  is_item_selectable(index: number): boolean;
  get_item_tooltip(index: number): string;
  is_item_tooltip_enabled(index: number): boolean;
  set_select_mode(mode: number): void;
  get_select_mode(): number;
  set_allow_reselect(enabled: boolean): void;
  get_allow_reselect(): boolean;
  set_allow_rmb_select(enabled: boolean): void;
  get_allow_rmb_select(): boolean;
  set_allow_search(enabled: boolean): void;
  get_allow_search(): boolean;
  set_auto_height(enabled: boolean): void;
  is_auto_height_enabled(): boolean;
  set_max_columns(columns: number): void;
  get_max_columns(): number;
  set_same_column_width(enabled: boolean): void;
  is_same_column_width(): boolean;
  set_fixed_icon_size(size: ControlPoint): void;
  get_fixed_icon_size(): ControlPoint;
  set_icon_mode(mode: number): void;
  get_icon_mode(): number;
  set_text_overrun_behavior(behavior: number): void;
  get_text_overrun_behavior(): number;
  set_wraparound_items(enabled: boolean): void;
  is_wraparound_items(): boolean;
  get_item_at_position(position: ControlPoint, exactMatchOnly?: boolean): number;
  get_item_rect(index: number, expandToIcon?: boolean): { position: ControlPoint; size: ControlPoint };
  get_item_with_text(text: string, exact?: boolean): number;
  find_metadata(metadata: unknown): number;
  is_anything_selected(): boolean;
  activate_item(index: number): void;
  force_update_list_size(): void;
}

export function bindItemList(
  control: GodotControl,
  initial: {
    readonly multiple?: boolean;
    readonly allowReselect?: boolean;
    readonly items?: readonly AuthoredChoiceItem[];
    readonly selected?: readonly number[];
    readonly vScrollBar?: GodotChoiceScrollBar;
    readonly godotMajor?: 3 | 4;
    readonly allowRmbSelect?: boolean;
    readonly allowSearch?: boolean;
    readonly autoHeight?: boolean;
    readonly maxColumns?: number;
    readonly sameColumnWidth?: boolean;
    readonly iconMode?: number;
    readonly fixedIconSize?: ControlPoint;
    readonly textOverrunBehavior?: number;
    readonly wraparoundItems?: boolean;
  } = {},
): GodotItemList {
  const list = control as GodotItemList;
  const state = createState(
    control,
    initial.multiple ?? false,
    initial.allowReselect ?? false,
    initial.vScrollBar ?? createInternalVScrollBar(initial.godotMajor ?? 4),
    initial.godotMajor ?? 4,
  );
  const clicked = createSignal<readonly [number, ControlPoint, number]>();
  const multiSelected = createSignal<readonly [number, boolean]>();
  const emptyClicked = createSignal<readonly [ControlPoint, number]>();
  const activated = createSignal<readonly [number]>();
  state.allowRmbSelect = initial.allowRmbSelect ?? false;
  state.allowSearch = initial.allowSearch ?? true;
  state.autoHeight = initial.autoHeight ?? false;
  state.maxColumns = Math.max(0, initial.maxColumns ?? 1);
  state.sameColumnWidth = initial.sameColumnWidth ?? false;
  state.iconMode = initial.iconMode ?? 1;
  state.fixedIconSize = { ...(initial.fixedIconSize ?? { x: 0, y: 0 }) };
  state.textOverrunBehavior = initial.textOverrunBehavior ?? 0;
  state.wraparound = initial.wraparoundItems ?? false;
  const item = (index: number, member: string): ChoiceItem => state.items[indexOf(state, index, member)]!;
  Object.defineProperties(list, {
    item_count: { enumerable: true, configurable: true, get: () => state.items.length },
    item_selected: { enumerable: true, configurable: true, value: state.selectionChanged.signal },
    item_clicked: { enumerable: true, configurable: true, value: clicked.signal },
    multi_selected: { enumerable: true, configurable: true, value: multiSelected.signal },
    empty_clicked: { enumerable: true, configurable: true, value: emptyClicked.signal },
    item_activated: { enumerable: true, configurable: true, value: activated.signal },
    allow_reselect: {
      enumerable: true,
      configurable: true,
      get: () => state.allowReselect,
      set: (value: boolean) => { state.allowReselect = boolean('ItemList.allow_reselect', value); },
    },
    allow_rmb_select: { enumerable: true, configurable: true, get: () => state.allowRmbSelect, set: (value: boolean) => { state.allowRmbSelect = boolean('ItemList.allow_rmb_select', value); } },
    allow_search: { enumerable: true, configurable: true, get: () => state.allowSearch, set: (value: boolean) => { state.allowSearch = boolean('ItemList.allow_search', value); } },
    auto_height: { enumerable: true, configurable: true, get: () => state.autoHeight, set: (value: boolean) => { state.autoHeight = boolean('ItemList.auto_height', value); snapshot(control, state); } },
    max_columns: { enumerable: true, configurable: true, get: () => state.maxColumns, set: (value: number) => { state.maxColumns = Math.max(0, integer('ItemList.max_columns', value)); snapshot(control, state); } },
    same_column_width: { enumerable: true, configurable: true, get: () => state.sameColumnWidth, set: (value: boolean) => { state.sameColumnWidth = boolean('ItemList.same_column_width', value); snapshot(control, state); } },
    icon_mode: { enumerable: true, configurable: true, get: () => state.iconMode, set: (value: number) => { state.iconMode = integer('ItemList.icon_mode', value); snapshot(control, state); } },
    fixed_icon_size: { enumerable: true, configurable: true, get: () => ({ ...state.fixedIconSize }), set: (value: ControlPoint) => { state.fixedIconSize = { x: value.x, y: value.y }; snapshot(control, state); } },
    text_overrun_behavior: { enumerable: true, configurable: true, get: () => state.textOverrunBehavior, set: (value: number) => { state.textOverrunBehavior = integer('ItemList.text_overrun_behavior', value); snapshot(control, state); } },
    wraparound_items: { enumerable: true, configurable: true, get: () => state.wraparound, set: (value: boolean) => { state.wraparound = boolean('ItemList.wraparound_items', value); } },
    select_mode: { enumerable: true, configurable: true, get: () => state.multiple ? 1 : 0, set: (value: number) => { state.multiple = integer('ItemList.select_mode', value) !== 0; snapshot(control, state); } },
  });
  const binding = controlBinding(control);
  binding.state.write(binding.id, {
    onChoiceClick(index, position, button): void {
      if (index < 0 || index >= state.items.length) {
        emptyClicked.emit({ x: position.x, y: position.y }, integer('ItemList.empty_clicked button', button));
        return;
      }
      clicked.emit(indexOf(state, index, 'ItemList.item_clicked'), { x: position.x, y: position.y }, integer('ItemList.item_clicked button', button));
    },
  });
  Object.assign(list, {
    add_item(text: string): number | void {
      string('ItemList.add_item text', text);
      const index = state.items.length;
      state.items.push({ text, id: state.items.length, metadata: null, separator: false, disabled: false, selected: false, selectable: true, tooltip: '', tooltipEnabled: true });
      snapshot(control, state);
      return state.godotMajor === 4 ? index : undefined;
    },
    add_icon_item(icon: unknown, selectable = true): number | void {
      const index = state.items.length;
      state.items.push({ text: '', id: state.items.length, metadata: null, separator: false, disabled: false, selected: false, selectable: boolean('ItemList.add_icon_item selectable', selectable), tooltip: '', tooltipEnabled: true });
      assignItemIcon(state.items.at(-1)!, icon, 'ItemList.add_icon_item');
      snapshot(control, state);
      return state.godotMajor === 4 ? index : undefined;
    },
    clear(): void {
      state.items.length = 0;
      state.selected.clear();
      state.current = -1;
      state.scrollIndex = 0;
      state.scrollOffset = 0;
      snapshot(control, state);
    },
    select(index: number, single = true): void {
      const resolved = indexOf(state, index, 'ItemList.select');
      if (!state.items[resolved]?.selectable || state.items[resolved]?.disabled) return;
      if (single || !state.multiple) state.selected.clear();
      state.selected.add(resolved);
      state.current = resolved;
      multiSelected.emit(resolved, true);
      snapshot(control, state);
    },
    remove_item(index: number): void {
      const resolved = indexOf(state, index, 'ItemList.remove_item');
      state.items.splice(resolved, 1);
      const selected = [...state.selected];
      state.selected.clear();
      for (const prior of selected) if (prior !== resolved) state.selected.add(prior > resolved ? prior - 1 : prior);
      if (state.current === resolved) state.current = -1;
      else if (state.current > resolved) state.current -= 1;
      snapshot(control, state);
    },
    move_item(from: number, to: number): void {
      const source = indexOf(state, from, 'ItemList.move_item');
      const target = indexOf(state, to, 'ItemList.move_item');
      if (source === target) return;
      const selected = [...state.selected];
      const [moved] = state.items.splice(source, 1);
      state.items.splice(target, 0, moved!);
      state.selected.clear();
      for (const prior of selected) {
        if (prior === source) state.selected.add(target);
        else if (source < target && prior > source && prior <= target) state.selected.add(prior - 1);
        else if (target < source && prior >= target && prior < source) state.selected.add(prior + 1);
        else state.selected.add(prior);
      }
      if (state.current === source) state.current = target;
      else if (source < target && state.current > source && state.current <= target) state.current -= 1;
      else if (target < source && state.current >= target && state.current < source) state.current += 1;
      snapshot(control, state);
    },
    unselect_all(): void { state.selected.clear(); state.current = -1; snapshot(control, state); },
    deselect_all(): void { state.selected.clear(); state.current = -1; snapshot(control, state); },
    deselect(index: number): void {
      const resolved = indexOf(state, index, 'ItemList.deselect');
      state.selected.delete(resolved);
      multiSelected.emit(resolved, false);
      if (state.current === resolved) state.current = -1;
      snapshot(control, state);
    },
    is_selected(index: number): boolean { return state.selected.has(indexOf(state, index, 'ItemList.is_selected')); },
    get_current(): number { return state.current; },
    get_v_scroll(): GodotChoiceScrollBar {
      if (state.vScrollBar === undefined) throw new Error('ItemList.get_v_scroll requires the retained native scrollbar.');
      return state.vScrollBar;
    },
    get_v_scroll_bar(): GodotChoiceScrollBar {
      if (state.vScrollBar === undefined) throw new Error('ItemList.get_v_scroll_bar requires the retained native scrollbar.');
      return state.vScrollBar;
    },
    set_current(index: number): void {
      if (index === -1) { state.current = -1; snapshot(control, state); return; }
      state.current = indexOf(state, index, 'ItemList.set_current');
      state.scrollIndex = state.current;
      state.scrollOffset = state.current * ITEM_LIST_ROW_HEIGHT;
      snapshot(control, state);
    },
    get_item_count(): number { return state.items.length; },
    get_item_text(index: number): string { return item(index, 'ItemList.get_item_text').text; },
    set_item_text(index: number, text: string): void { item(index, 'ItemList.set_item_text').text = string('ItemList.set_item_text text', text); snapshot(control, state); },
    set_item_icon(index: number, icon: unknown): void { assignItemIcon(item(index, 'ItemList.set_item_icon'), icon, 'ItemList.set_item_icon'); snapshot(control, state); },
    get_item_icon(index: number): unknown { return item(index, 'ItemList.get_item_icon').iconIdentity ?? null; },
    set_item_count(count: number): void { resizeChoiceItems(state, count, 'ItemList.set_item_count'); snapshot(control, state); },
    set_item_custom_fg_color(index: number, color: ControlColor): void {
      if (typeof color !== 'object' || color === null || ![color.r, color.g, color.b, color.a].every(Number.isFinite)) {
        throw new TypeError('ItemList.set_item_custom_fg_color requires a Color.');
      }
      item(index, 'ItemList.set_item_custom_fg_color').customFgColor = { r: color.r, g: color.g, b: color.b, a: color.a };
      snapshot(control, state);
    },
    get_item_custom_fg_color(index: number): ControlColor | null { const value = item(index, 'ItemList.get_item_custom_fg_color').customFgColor; return value === undefined ? null : { ...value }; },
    set_item_custom_bg_color(index: number, color: ControlColor): void {
      if (typeof color !== 'object' || color === null || ![color.r, color.g, color.b, color.a].every(Number.isFinite)) throw new TypeError('ItemList.set_item_custom_bg_color requires a Color.');
      item(index, 'ItemList.set_item_custom_bg_color').customBgColor = { r: color.r, g: color.g, b: color.b, a: color.a };
      snapshot(control, state);
    },
    get_item_custom_bg_color(index: number): ControlColor | null { const value = item(index, 'ItemList.get_item_custom_bg_color').customBgColor; return value === undefined ? null : { ...value }; },
    set_item_icon_modulate(index: number, color: ControlColor): void {
      if (typeof color !== 'object' || color === null || ![color.r, color.g, color.b, color.a].every(Number.isFinite)) throw new TypeError('ItemList.set_item_icon_modulate requires a Color.');
      item(index, 'ItemList.set_item_icon_modulate').iconModulate = { r: color.r, g: color.g, b: color.b, a: color.a };
      snapshot(control, state);
    },
    get_item_icon_modulate(index: number): ControlColor { return { ...(item(index, 'ItemList.get_item_icon_modulate').iconModulate ?? { r: 1, g: 1, b: 1, a: 1 }) }; },
    set_item_icon_transposed(index: number, transposed: boolean): void { item(index, 'ItemList.set_item_icon_transposed').iconTransposed = boolean('ItemList.set_item_icon_transposed transposed', transposed); snapshot(control, state); },
    is_item_icon_transposed(index: number): boolean { return item(index, 'ItemList.is_item_icon_transposed').iconTransposed ?? false; },
    set_item_icon_region(index: number, region: unknown): void { item(index, 'ItemList.set_item_icon_region').iconRegion = region; snapshot(control, state); },
    get_item_icon_region(index: number): unknown { return item(index, 'ItemList.get_item_icon_region').iconRegion ?? null; },
    set_item_tag_icon(index: number, icon: unknown): void {
      const projected = projectGodotTexture(icon, 'ItemList.set_item_tag_icon');
      const entry = item(index, 'ItemList.set_item_tag_icon');
      entry.tagIconIdentity = projected.identity;
      entry.tagIcon = projected.pixiTexture ?? projected.identity ?? undefined;
      snapshot(control, state);
    },
    get_item_tag_icon(index: number): unknown { return item(index, 'ItemList.get_item_tag_icon').tagIconIdentity ?? null; },
    set_item_text_direction(index: number, direction: number): void { item(index, 'ItemList.set_item_text_direction').textDirection = integer('ItemList.set_item_text_direction direction', direction); snapshot(control, state); },
    get_item_text_direction(index: number): number { return item(index, 'ItemList.get_item_text_direction').textDirection ?? 0; },
    set_item_language(index: number, language: string): void { item(index, 'ItemList.set_item_language').language = string('ItemList.set_item_language language', language); snapshot(control, state); },
    get_item_language(index: number): string { return item(index, 'ItemList.get_item_language').language ?? ''; },
    get_item_metadata(index: number): unknown { return item(index, 'ItemList.get_item_metadata').metadata; },
    set_item_metadata(index: number, value: unknown): void { item(index, 'ItemList.set_item_metadata').metadata = value; },
    get_selected_items(): PackedInt32Array { return packedInt32Array([...state.selected].sort((a, b) => a - b)); },
    set_item_selectable(index: number, selectable: boolean): void { item(index, 'ItemList.set_item_selectable').selectable = boolean('ItemList.set_item_selectable selectable', selectable); snapshot(control, state); },
    is_item_selectable(index: number): boolean { return item(index, 'ItemList.is_item_selectable').selectable; },
    set_item_disabled(index: number, disabled: boolean): void { item(index, 'ItemList.set_item_disabled').disabled = boolean('ItemList.set_item_disabled disabled', disabled); snapshot(control, state); },
    is_item_disabled(index: number): boolean { return item(index, 'ItemList.is_item_disabled').disabled; },
    set_item_tooltip(index: number, tooltip: string): void { item(index, 'ItemList.set_item_tooltip').tooltip = string('ItemList.set_item_tooltip tooltip', tooltip); snapshot(control, state); },
    set_item_tooltip_enabled(index: number, enabled: boolean): void { item(index, 'ItemList.set_item_tooltip_enabled').tooltipEnabled = boolean('ItemList.set_item_tooltip_enabled enabled', enabled); snapshot(control, state); },
    get_item_tooltip(index: number): string { return item(index, 'ItemList.get_item_tooltip').tooltip; },
    is_item_tooltip_enabled(index: number): boolean { return item(index, 'ItemList.is_item_tooltip_enabled').tooltipEnabled; },
    set_select_mode(mode: number): void { state.multiple = integer('ItemList.set_select_mode mode', mode) !== 0; snapshot(control, state); },
    get_select_mode(): number { return state.multiple ? 1 : 0; },
    set_allow_reselect(enabled: boolean): void { list.allow_reselect = enabled; },
    get_allow_reselect(): boolean { return state.allowReselect; },
    set_allow_rmb_select(enabled: boolean): void { list.allow_rmb_select = enabled; },
    get_allow_rmb_select(): boolean { return state.allowRmbSelect; },
    set_allow_search(enabled: boolean): void { list.allow_search = enabled; },
    get_allow_search(): boolean { return state.allowSearch; },
    set_auto_height(enabled: boolean): void { list.auto_height = enabled; },
    is_auto_height_enabled(): boolean { return state.autoHeight; },
    set_max_columns(columns: number): void { list.max_columns = columns; },
    get_max_columns(): number { return state.maxColumns; },
    set_same_column_width(enabled: boolean): void { list.same_column_width = enabled; },
    is_same_column_width(): boolean { return state.sameColumnWidth; },
    set_fixed_icon_size(size: ControlPoint): void { list.fixed_icon_size = size; },
    get_fixed_icon_size(): ControlPoint { return { ...state.fixedIconSize }; },
    set_icon_mode(mode: number): void { list.icon_mode = mode; },
    get_icon_mode(): number { return state.iconMode; },
    set_text_overrun_behavior(behavior: number): void { list.text_overrun_behavior = behavior; },
    get_text_overrun_behavior(): number { return state.textOverrunBehavior; },
    set_wraparound_items(enabled: boolean): void { list.wraparound_items = enabled; },
    is_wraparound_items(): boolean { return state.wraparound; },
    get_item_at_position(position: ControlPoint, exactMatchOnly = false): number {
      const y = position.y + state.scrollOffset;
      const index = Math.floor(y / ITEM_LIST_ROW_HEIGHT);
      if (index < 0 || index >= state.items.length) return -1;
      if (exactMatchOnly && (position.x < 0 || position.y < 0)) return -1;
      return index;
    },
    get_item_rect(index: number, _expandToIcon = true): { position: ControlPoint; size: ControlPoint } {
      const resolved = indexOf(state, index, 'ItemList.get_item_rect');
      const width = controlBinding(control).state.read(controlBinding(control).id).size?.x ?? 0;
      return { position: { x: 0, y: resolved * ITEM_LIST_ROW_HEIGHT - state.scrollOffset }, size: { x: width, y: ITEM_LIST_ROW_HEIGHT } };
    },
    get_item_with_text(text: string, exact = false): number {
      const query = string('ItemList.get_item_with_text text', text);
      return state.items.findIndex((entry) => exact ? entry.text === query : entry.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    },
    find_metadata(metadata: unknown): number { return state.items.findIndex((entry) => Object.is(entry.metadata, metadata)); },
    is_anything_selected(): boolean { return state.selected.size > 0; },
    activate_item(index: number): void { const resolved = indexOf(state, index, 'ItemList.activate_item'); state.current = resolved; activated.emit(resolved); },
    force_update_list_size(): void { snapshot(control, state); },
    sort_items_by_text(): void {
      const selected = new Set([...state.selected].map((index) => state.items[index]));
      const current = state.items[state.current];
      state.items.sort((a, b) => a.text.localeCompare(b.text));
      state.selected.clear();
      state.items.forEach((entry, index) => { if (selected.has(entry)) state.selected.add(index); });
      state.current = current === undefined ? -1 : state.items.indexOf(current);
      snapshot(control, state);
    },
    ensure_current_is_visible(): void {
      if (state.current < 0) return;
      const viewportHeight = state.vScrollBar?.page ?? state.viewportHeight ?? 0;
      const itemTop = state.current * ITEM_LIST_ROW_HEIGHT;
      const itemBottom = itemTop + ITEM_LIST_ROW_HEIGHT;
      if (itemTop < state.scrollOffset) state.scrollOffset = itemTop;
      else if (itemBottom > state.scrollOffset + viewportHeight) {
        state.scrollOffset = Math.max(0, itemBottom - viewportHeight);
      }
      state.scrollIndex = Math.floor(state.scrollOffset / ITEM_LIST_ROW_HEIGHT);
      snapshot(control, state);
      const element = controlBinding(control).state.read(controlBinding(control).id).focusElement;
      if (element instanceof HTMLSelectElement) element.options.item(state.current)?.scrollIntoView({ block: 'nearest' });
    },
  });
  for (const authored of initial.items ?? []) {
    list.add_item(authored.text);
    const entry = state.items.at(-1)!;
    entry.disabled = authored.disabled ?? false;
    entry.selectable = authored.selectable ?? !entry.disabled;
    entry.metadata = authored.metadata ?? null;
  }
  for (const selected of initial.selected ?? []) list.select(selected, false);
  snapshot(control, state);
  return list;
}

/** Update the native ItemList scrollbar whenever its retained viewport is resized. */
export function resizeItemListViewport(control: GodotControl, height: number): void {
  const state = stateOf(control, 'ItemList viewport resize');
  if (!Number.isFinite(height) || height < 0) {
    throw new RangeError(`ItemList viewport height must be finite and non-negative; received ${String(height)}.`);
  }
  state.viewportHeight = height;
  snapshot(control, state);
}

export function releaseChoiceControl(control: object): void {
  CHOICES.get(control)?.scrollConnection?.disconnect();
  CHOICES.delete(control);
}
