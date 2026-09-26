/** PopupMenu/MenuButton state over the retained Control entity. */

import { bindBaseButton, type BaseButtonState, type GodotButtonControl } from './control-widgets';
import { controlBinding, type ControlColor, type GodotControl } from './control-state';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { registerGodotObjectIdentity } from './object';
import { projectGodotTexture } from './button-icon';

export type PopupCheckable = 'none' | 'check' | 'radio';

export interface GodotPopupMenuItem {
  text: string;
  icon?: unknown;
  id: number;
  metadata: unknown;
  checked: boolean;
  disabled: boolean;
  separator: boolean;
  checkable: PopupCheckable;
  maxStates: number;
  submenu: string;
  state?: number;
  tooltip?: string;
  iconMaxWidth?: number;
  indent?: number;
  accelerator?: number;
  shortcut?: unknown;
  shortcutIsGlobal?: boolean;
  shortcutDisabled?: boolean;
  autoTranslateMode?: number;
  language?: string;
  textDirection?: number;
  iconModulate?: ControlColor;
}

export interface GodotPopupMenu {
  readonly id_pressed: GodotSignal<readonly [number]>;
  readonly index_pressed: GodotSignal<readonly [number]>;
  readonly about_to_popup: GodotSignal<readonly []>;
  readonly popup_hide: GodotSignal<readonly []>;
  readonly close_requested: GodotSignal<readonly []>;
  readonly id_focused: GodotSignal<readonly [number]>;
  readonly menu_changed: GodotSignal<readonly []>;
  visible: boolean;
  item_count: number;
  hide_on_item_selection: boolean;
  hide_on_checkable_item_selection: boolean;
  hide_on_state_item_selection: boolean;
  allow_search: boolean;
  submenu_popup_delay: number;
  prefer_native_menu: boolean;
  add_item(label: string, id?: number, accelerator?: number): void;
  add_icon_item(icon: unknown, label: string, id?: number, accelerator?: number): void;
  add_icon_check_item(icon: unknown, label: string, id?: number, accelerator?: number): void;
  add_icon_radio_check_item(icon: unknown, label: string, id?: number, accelerator?: number): void;
  add_multistate_item(label: string, maxStates: number, defaultState?: number, id?: number, accelerator?: number): void;
  add_check_item(label: string, id?: number, accelerator?: number): void;
  add_radio_check_item(label: string, id?: number, accelerator?: number): void;
  add_separator(label?: string, id?: number): void;
  add_submenu_item(label: string, submenu: string, id?: number): void;
  add_shortcut(shortcut: unknown, id?: number, global?: boolean, allowEcho?: boolean): void;
  add_icon_shortcut(icon: unknown, shortcut: unknown, id?: number, global?: boolean, allowEcho?: boolean): void;
  add_check_shortcut(shortcut: unknown, id?: number, global?: boolean): void;
  add_icon_check_shortcut(icon: unknown, shortcut: unknown, id?: number, global?: boolean): void;
  add_radio_check_shortcut(shortcut: unknown, id?: number, global?: boolean): void;
  add_icon_radio_check_shortcut(icon: unknown, shortcut: unknown, id?: number, global?: boolean): void;
  clear(freeSubmenus?: boolean): void;
  get_item_count(): number;
  set_item_count(value: number): void;
  get_item_text(index: number): string;
  get_item_id(index: number): number;
  get_item_index(id: number): number;
  get_item_metadata(index: number): unknown;
  is_item_checked(index: number): boolean;
  is_item_disabled(index: number): boolean;
  set_item_icon(index: number, icon: unknown): void;
  get_item_icon(index: number): unknown;
  set_item_icon_max_width(index: number, width: number): void;
  get_item_icon_max_width(index: number): number;
  set_item_indent(index: number, indent: number): void;
  get_item_indent(index: number): number;
  set_item_text(index: number, value: string): void;
  set_item_id(index: number, value: number): void;
  set_item_metadata(index: number, value: unknown): void;
  set_item_checked(index: number, value: boolean): void;
  set_item_disabled(index: number, value: boolean): void;
  remove_item(index: number): void;
  set_item_as_separator(index: number, value: boolean): void;
  is_item_separator(index: number): boolean;
  set_item_as_checkable(index: number, value: boolean): void;
  is_item_checkable(index: number): boolean;
  set_item_as_radio_checkable(index: number, value: boolean): void;
  is_item_radio_checkable(index: number): boolean;
  toggle_item_checked(index: number): void;
  set_item_tooltip(index: number, value: string): void;
  get_item_tooltip(index: number): string;
  set_item_submenu(index: number, value: string): void;
  get_item_submenu(index: number): string;
  set_item_submenu_node(index: number, submenu: GodotPopupMenu | null): void;
  get_item_submenu_node(index: number): GodotPopupMenu | null;
  register_submenu(name: string, submenu: GodotPopupMenu): void;
  unregister_submenu(name: string): void;
  set_item_multistate(index: number, value: number): void;
  get_item_state(index: number): number;
  set_item_max_states(index: number, value: number): void;
  get_item_max_states(index: number): number;
  toggle_item_multistate(index: number): void;
  set_hide_on_item_selection(enable: boolean): void;
  is_hide_on_item_selection(): boolean;
  set_hide_on_checkable_item_selection(enable: boolean): void;
  is_hide_on_checkable_item_selection(): boolean;
  set_hide_on_state_item_selection(enable: boolean): void;
  is_hide_on_state_item_selection(): boolean;
  popup(): void;
  show(): void;
  hide(): void;
  activate_item(index: number): void;
  activate_item_by_event(event: unknown, forGlobalOnly?: boolean): boolean;
  focus_item(index: number): void;
  set_item_accelerator(index: number, accelerator: number): void;
  get_item_accelerator(index: number): number;
  set_item_shortcut(index: number, shortcut: unknown, global?: boolean): void;
  get_item_shortcut(index: number): unknown;
  is_item_shortcut_global(index: number): boolean;
  set_item_shortcut_disabled(index: number, disabled: boolean): void;
  is_item_shortcut_disabled(index: number): boolean;
  set_item_auto_translate_mode(index: number, mode: number): void;
  get_item_auto_translate_mode(index: number): number;
  set_item_text_direction(index: number, direction: number): void;
  get_item_text_direction(index: number): number;
  set_item_language(index: number, language: string): void;
  get_item_language(index: number): string;
  set_item_icon_modulate(index: number, color: ControlColor): void;
  get_item_icon_modulate(index: number): ControlColor;
  set_allow_search(enabled: boolean): void;
  get_allow_search(): boolean;
  set_submenu_popup_delay(seconds: number): void;
  get_submenu_popup_delay(): number;
  set_prefer_native_menu(enabled: boolean): void;
  is_prefer_native_menu(): boolean;
}

export type GodotPopupMenuControl = GodotPopupMenu & GodotControl;

interface PopupState {
  readonly control: GodotControl;
  readonly popup: GodotPopupMenu;
  readonly items: GodotPopupMenuItem[];
  readonly idPressed: SignalHandle<readonly [number]>;
  readonly indexPressed: SignalHandle<readonly [number]>;
  readonly aboutToPopup: SignalHandle<readonly []>;
  readonly popupHide: SignalHandle<readonly []>;
  readonly closeRequested: SignalHandle<readonly []>;
  readonly idFocused: SignalHandle<readonly [number]>;
  readonly menuChanged: SignalHandle<readonly []>;
  readonly godotMajor: 3 | 4;
  hideOnItemSelection: boolean;
  hideOnCheckableItemSelection: boolean;
  hideOnMultistateItemSelection: boolean;
  open: boolean;
  presentationElement: HTMLElement | null;
  outsidePointer: ((event: PointerEvent) => void) | null;
  allowSearch: boolean;
  submenuPopupDelay: number;
  preferNativeMenu: boolean;
  readonly submenus: Map<string, GodotPopupMenu>;
}

const POPUPS = new WeakMap<object, PopupState>();

function integer(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${member} must be a safe integer.`);
  return value;
}

function string(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} must be String.`);
  return value;
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function popupState(popup: object): PopupState {
  const state = POPUPS.get(popup);
  if (state === undefined) throw new Error('PopupMenu is not bound to a retained Control.');
  return state;
}

function itemAt(state: PopupState, index: number, member: string): GodotPopupMenuItem {
  const resolved = integer(`${member} index`, index);
  const item = state.items[resolved];
  if (item === undefined) throw new RangeError(`${member} index ${resolved} is out of bounds.`);
  return item;
}

function sync(state: PopupState): void {
  const binding = controlBinding(state.control);
  binding.state.write(binding.id, {
    menuOpen: state.open,
    menuItems: state.items.map((item) => {
      const icon = item.icon;
      const source = icon === null || icon === undefined
        ? undefined
        : projectGodotTexture(icon, 'PopupMenu item icon').domSource;
      return {
        ...item,
        iconMaxWidth: item.iconMaxWidth ?? 0,
        indent: item.indent ?? 0,
        ...(source === undefined ? {} : { iconSource: source }),
      };
    }),
    onMenuSelect(index): void { state.popup.activate_item(index); },
    onMenuFocus(index): void { state.popup.focus_item(index); },
    onMenuCloseRequest(): void { state.closeRequested.emit(); },
    bindMenuPresentationElement(element): void {
      if (state.outsidePointer !== null && state.presentationElement !== null) {
        state.presentationElement.ownerDocument.removeEventListener('pointerdown', state.outsidePointer, true);
      }
      state.presentationElement = element;
      state.outsidePointer = null;
      if (!state.open || element === null) return;
      const outsidePointer = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node) || !element.contains(target)) state.closeRequested.emit();
      };
      state.outsidePointer = outsidePointer;
      element.ownerDocument.addEventListener('pointerdown', outsidePointer, true);
    },
  });
  const element = state.presentationElement;
  binding.state.read(binding.id).bindMenuPresentationElement?.(element);
}

function append(state: PopupState, text: string, id: number, kind: PopupCheckable, separator: boolean, submenu = '', notify = true, icon: unknown = null, accelerator = 0): void {
  const explicitId = integer('PopupMenu item id', id);
  state.items.push({
    text: string('PopupMenu item label', text),
    icon,
    // PopupMenu assigns an omitted item id to the new item's index. This is observable through
    // get_item_id(), rather than only when the pressed signal substitutes the index.
    id: explicitId === -1 && !separator ? state.items.length : explicitId,
    metadata: null,
    checked: false,
    disabled: separator,
    separator,
    checkable: kind,
    maxStates: 0,
    submenu,
    state: 0,
    tooltip: '',
    accelerator: integer('PopupMenu item accelerator', accelerator),
    shortcut: null,
    shortcutIsGlobal: false,
    language: '',
    textDirection: 0,
    iconModulate: { r: 1, g: 1, b: 1, a: 1 },
  });
  sync(state);
  if (notify) state.menuChanged.emit();
}

/** Bind PopupMenu behavior to the renderer-owned Control that presents it. */
export function bindPopupMenu(
  control: GodotControl,
  identity: object = control,
  options: {
    readonly items?: readonly GodotPopupMenuItem[];
    readonly godotMajor?: 3 | 4;
    readonly hideOnItemSelection?: boolean;
    readonly hideOnCheckableItemSelection?: boolean;
    readonly hideOnMultistateItemSelection?: boolean;
    readonly submenus?: ReadonlyMap<string, GodotPopupMenu>;
  } = {},
): GodotPopupMenu & object {
  if (identity !== control) Object.setPrototypeOf(identity, control);
  const popup = identity as GodotPopupMenu & object;
  registerGodotObjectIdentity(popup, 'PopupMenu');
  const state: PopupState = {
    control,
    popup,
    items: (options.items ?? []).map((item) => ({ state: 0, tooltip: '', ...item })),
    idPressed: createSignal<readonly [number]>(),
    indexPressed: createSignal<readonly [number]>(),
    aboutToPopup: createSignal<readonly []>(),
    popupHide: createSignal<readonly []>(),
    closeRequested: createSignal<readonly []>(),
    idFocused: createSignal<readonly [number]>(),
    menuChanged: createSignal<readonly []>(),
    godotMajor: options.godotMajor ?? 4,
    hideOnItemSelection: boolean('PopupMenu.hide_on_item_selection', options.hideOnItemSelection ?? true),
    hideOnCheckableItemSelection: boolean(
      'PopupMenu.hide_on_checkable_item_selection',
      options.hideOnCheckableItemSelection ?? true,
    ),
    hideOnMultistateItemSelection: boolean(
      'PopupMenu.hide_on_multistate_item_selection',
      options.hideOnMultistateItemSelection ?? false,
    ),
    open: false,
    presentationElement: null,
    outsidePointer: null,
    allowSearch: true,
    submenuPopupDelay: 0.3,
    preferNativeMenu: false,
    submenus: new Map(options.submenus ?? []),
  };
  POPUPS.set(popup, state);
  Object.defineProperties(popup, {
    id_pressed: { enumerable: true, configurable: true, value: state.idPressed.signal },
    index_pressed: { enumerable: true, configurable: true, value: state.indexPressed.signal },
    about_to_popup: { enumerable: true, configurable: true, value: state.aboutToPopup.signal },
    popup_hide: { enumerable: true, configurable: true, value: state.popupHide.signal },
    close_requested: { enumerable: true, configurable: true, value: state.closeRequested.signal },
    id_focused: { enumerable: true, configurable: true, value: state.idFocused.signal },
    menu_changed: { enumerable: true, configurable: true, value: state.menuChanged.signal },
    visible: {
      enumerable: true,
      configurable: true,
      get: () => state.open,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('Window.visible requires a bool.');
        if (value) state.popup.show();
        else state.popup.hide();
      },
    },
    item_count: {
      enumerable: true,
      configurable: true,
      get: () => state.items.length,
      set: (value: number) => { state.popup.set_item_count(value); },
    },
    hide_on_item_selection: {
      enumerable: true,
      configurable: true,
      get: () => state.hideOnItemSelection,
      set: (value: boolean) => { state.hideOnItemSelection = boolean('PopupMenu.hide_on_item_selection', value); },
    },
    hide_on_checkable_item_selection: {
      enumerable: true,
      configurable: true,
      get: () => state.hideOnCheckableItemSelection,
      set: (value: boolean) => { state.hideOnCheckableItemSelection = boolean('PopupMenu.hide_on_checkable_item_selection', value); },
    },
    hide_on_state_item_selection: {
      enumerable: true,
      configurable: true,
      get: () => state.hideOnMultistateItemSelection,
      set: (value: boolean) => { state.hideOnMultistateItemSelection = boolean('PopupMenu.hide_on_state_item_selection', value); },
    },
    allow_search: { enumerable: true, configurable: true, get: () => state.allowSearch, set: (value: boolean) => { state.allowSearch = boolean('PopupMenu.allow_search', value); } },
    submenu_popup_delay: { enumerable: true, configurable: true, get: () => state.submenuPopupDelay, set: (value: number) => { if (!Number.isFinite(value) || value < 0) throw new RangeError('PopupMenu.submenu_popup_delay requires a non-negative number.'); state.submenuPopupDelay = value; } },
    prefer_native_menu: { enumerable: true, configurable: true, get: () => state.preferNativeMenu, set: (value: boolean) => { state.preferNativeMenu = boolean('PopupMenu.prefer_native_menu', value); } },
  });
  Object.assign(popup, {
    add_item(label: string, id = -1, accelerator = 0): void {
      append(state, label, id, 'none', false, '', true, null, accelerator);
    },
    add_icon_item(icon: unknown, label: string, id = -1, accelerator = 0): void {
      projectGodotTexture(icon, 'PopupMenu.add_icon_item icon');
      append(state, label, id, 'none', false, '', true, icon, accelerator);
    },
    add_icon_check_item(icon: unknown, label: string, id = -1, accelerator = 0): void { projectGodotTexture(icon, 'PopupMenu.add_icon_check_item icon'); append(state, label, id, 'check', false, '', true, icon, accelerator); },
    add_icon_radio_check_item(icon: unknown, label: string, id = -1, accelerator = 0): void { projectGodotTexture(icon, 'PopupMenu.add_icon_radio_check_item icon'); append(state, label, id, 'radio', false, '', true, icon, accelerator); },
    add_multistate_item(label: string, maxStates: number, defaultState = 0, id = -1, accelerator = 0): void {
      const count = integer('PopupMenu.add_multistate_item max_states', maxStates);
      const selected = integer('PopupMenu.add_multistate_item default_state', defaultState);
      if (count <= 0 || selected < 0 || selected >= count) throw new RangeError('PopupMenu multistate values are out of range.');
      append(state, label, id, 'none', false, '', true, null, accelerator);
      const entry = state.items.at(-1)!; entry.maxStates = count; entry.state = selected; sync(state);
    },
    add_check_item(label: string, id = -1, accelerator = 0): void {
      append(state, label, id, 'check', false, '', true, null, accelerator);
    },
    add_radio_check_item(label: string, id = -1, accelerator = 0): void {
      append(state, label, id, 'radio', false, '', true, null, accelerator);
    },
    add_separator(label = '', id = -1): void { append(state, label, id, 'none', true); },
    add_submenu_item(label: string, submenu: string, id = -1): void {
      append(state, label, id, 'none', false, string('PopupMenu submenu', submenu));
    },
    add_shortcut(shortcut: unknown, id = -1, global = false, _allowEcho = false): void {
      append(state, '', id, 'none', false, '', true, null, 0);
      const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    add_icon_shortcut(icon: unknown, shortcut: unknown, id = -1, global = false, _allowEcho = false): void {
      projectGodotTexture(icon, 'PopupMenu.add_icon_shortcut icon'); append(state, '', id, 'none', false, '', true, icon, 0);
      const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    add_check_shortcut(shortcut: unknown, id = -1, global = false): void {
      append(state, '', id, 'check', false); const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    add_icon_check_shortcut(icon: unknown, shortcut: unknown, id = -1, global = false): void {
      projectGodotTexture(icon, 'PopupMenu.add_icon_check_shortcut icon'); append(state, '', id, 'check', false, '', true, icon);
      const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    add_radio_check_shortcut(shortcut: unknown, id = -1, global = false): void {
      append(state, '', id, 'radio', false); const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    add_icon_radio_check_shortcut(icon: unknown, shortcut: unknown, id = -1, global = false): void {
      projectGodotTexture(icon, 'PopupMenu.add_icon_radio_check_shortcut icon'); append(state, '', id, 'radio', false, '', true, icon);
      const entry = state.items.at(-1)!; entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state);
    },
    clear(freeSubmenus = false): void {
      const releaseSubmenus = boolean('PopupMenu.clear free_submenus', freeSubmenus);
      state.items.length = 0;
      if (releaseSubmenus) {
        for (const submenu of state.submenus.values()) submenu.hide();
        state.submenus.clear();
      }
      sync(state);
      state.menuChanged.emit();
    },
    get_item_count(): number { return state.items.length; },
    set_item_count(value: number): void {
      const count = integer('PopupMenu item_count', value);
      if (count < 0) throw new RangeError('PopupMenu item_count must be non-negative.');
      if (count === state.items.length) return;
      while (state.items.length > count) state.items.pop();
      while (state.items.length < count) append(state, '', -1, 'none', false, '', false);
      sync(state);
      state.menuChanged.emit();
    },
    get_item_text(index: number): string { return itemAt(state, index, 'PopupMenu.get_item_text').text; },
    get_item_id(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_id').id; },
    get_item_index(id: number): number { return state.items.findIndex((item) => item.id === integer('PopupMenu item id', id)); },
    get_item_metadata(index: number): unknown { return itemAt(state, index, 'PopupMenu.get_item_metadata').metadata; },
    is_item_checked(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_checked').checked; },
    is_item_disabled(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_disabled').disabled; },
    set_item_icon(index: number, icon: unknown): void {
      if (icon !== null) projectGodotTexture(icon, 'PopupMenu.set_item_icon icon');
      itemAt(state, index, 'PopupMenu.set_item_icon').icon = icon;
      sync(state);
      state.menuChanged.emit();
    },
    get_item_icon(index: number): unknown { return itemAt(state, index, 'PopupMenu.get_item_icon').icon ?? null; },
    set_item_icon_max_width(index: number, width: number): void {
      const next = integer('PopupMenu icon max width', width);
      if (next < 0) throw new RangeError('PopupMenu icon max width must be non-negative.');
      itemAt(state, index, 'PopupMenu.set_item_icon_max_width').iconMaxWidth = next;
      sync(state);
      state.menuChanged.emit();
    },
    get_item_icon_max_width(index: number): number {
      return itemAt(state, index, 'PopupMenu.get_item_icon_max_width').iconMaxWidth ?? 0;
    },
    set_item_indent(index: number, indent: number): void {
      const next = integer('PopupMenu item indent', indent);
      if (next < 0) throw new RangeError('PopupMenu item indent must be non-negative.');
      itemAt(state, index, 'PopupMenu.set_item_indent').indent = next;
      sync(state);
      state.menuChanged.emit();
    },
    get_item_indent(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_indent').indent ?? 0; },
    set_item_text(index: number, value: string): void { itemAt(state, index, 'PopupMenu.set_item_text').text = string('PopupMenu item text', value); sync(state); state.menuChanged.emit(); },
    set_item_id(index: number, value: number): void { itemAt(state, index, 'PopupMenu.set_item_id').id = integer('PopupMenu item id', value); sync(state); state.menuChanged.emit(); },
    set_item_metadata(index: number, value: unknown): void { itemAt(state, index, 'PopupMenu.set_item_metadata').metadata = value; state.menuChanged.emit(); },
    set_item_checked(index: number, value: boolean): void { itemAt(state, index, 'PopupMenu.set_item_checked').checked = boolean('PopupMenu checked', value); sync(state); state.menuChanged.emit(); },
    set_item_disabled(index: number, value: boolean): void { itemAt(state, index, 'PopupMenu.set_item_disabled').disabled = boolean('PopupMenu disabled', value); sync(state); state.menuChanged.emit(); },
    remove_item(index: number): void {
      const item = itemAt(state, index, 'PopupMenu.remove_item');
      state.items.splice(state.items.indexOf(item), 1);
      sync(state);
      state.menuChanged.emit();
    },
    set_item_as_separator(index: number, value: boolean): void {
      const item = itemAt(state, index, 'PopupMenu.set_item_as_separator');
      item.separator = boolean('PopupMenu separator', value);
      sync(state);
      state.menuChanged.emit();
    },
    is_item_separator(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_separator').separator; },
    set_item_as_checkable(index: number, value: boolean): void {
      itemAt(state, index, 'PopupMenu.set_item_as_checkable').checkable = boolean('PopupMenu checkable', value) ? 'check' : 'none';
      sync(state);
      state.menuChanged.emit();
    },
    is_item_checkable(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_checkable').checkable !== 'none'; },
    set_item_as_radio_checkable(index: number, value: boolean): void {
      const item = itemAt(state, index, 'PopupMenu.set_item_as_radio_checkable');
      item.checkable = boolean('PopupMenu radio checkable', value) ? 'radio' : item.checkable === 'radio' ? 'none' : item.checkable;
      sync(state);
      state.menuChanged.emit();
    },
    is_item_radio_checkable(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_radio_checkable').checkable === 'radio'; },
    toggle_item_checked(index: number): void {
      const item = itemAt(state, index, 'PopupMenu.toggle_item_checked');
      item.checked = !item.checked;
      sync(state);
      state.menuChanged.emit();
    },
    set_item_tooltip(index: number, value: string): void { itemAt(state, index, 'PopupMenu.set_item_tooltip').tooltip = string('PopupMenu tooltip', value); state.menuChanged.emit(); },
    get_item_tooltip(index: number): string { return itemAt(state, index, 'PopupMenu.get_item_tooltip').tooltip ?? ''; },
    set_item_submenu(index: number, value: string): void { itemAt(state, index, 'PopupMenu.set_item_submenu').submenu = string('PopupMenu submenu', value); sync(state); state.menuChanged.emit(); },
    get_item_submenu(index: number): string { return itemAt(state, index, 'PopupMenu.get_item_submenu').submenu; },
    set_item_submenu_node(index: number, submenu: GodotPopupMenu | null): void {
      const item = itemAt(state, index, 'PopupMenu.set_item_submenu_node');
      if (submenu === null) { if (item.submenu !== '') state.submenus.delete(item.submenu); item.submenu = ''; sync(state); state.menuChanged.emit(); return; }
      if (typeof submenu !== 'object' || typeof submenu.popup !== 'function') throw new TypeError('PopupMenu.set_item_submenu_node requires PopupMenu or null.');
      const key = item.submenu === '' ? `submenu_${index}` : item.submenu;
      item.submenu = key; state.submenus.set(key, submenu); sync(state); state.menuChanged.emit();
    },
    get_item_submenu_node(index: number): GodotPopupMenu | null { const key = itemAt(state, index, 'PopupMenu.get_item_submenu_node').submenu; return key === '' ? null : state.submenus.get(key) ?? null; },
    register_submenu(name: string, submenu: GodotPopupMenu): void { const key = string('PopupMenu submenu name', name); if (key === '') throw new RangeError('PopupMenu submenu name must not be empty.'); if (typeof submenu !== 'object' || typeof submenu.popup !== 'function') throw new TypeError('PopupMenu.register_submenu requires PopupMenu.'); state.submenus.set(key, submenu); },
    unregister_submenu(name: string): void { const submenu = state.submenus.get(string('PopupMenu submenu name', name)); submenu?.hide(); state.submenus.delete(name); },
    set_item_multistate(index: number, value: number): void {
      const item = itemAt(state, index, 'PopupMenu.set_item_multistate');
      const next = integer('PopupMenu item state', value);
      if (next < 0 || next >= Math.max(1, item.maxStates)) throw new RangeError('PopupMenu item state exceeds max_states.');
      item.state = next;
      sync(state);
      state.menuChanged.emit();
    },
    get_item_state(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_state').state ?? 0; },
    set_item_max_states(index: number, value: number): void {
      const item = itemAt(state, index, 'PopupMenu.set_item_max_states');
      const count = integer('PopupMenu max states', value);
      if (count < 0) throw new RangeError('PopupMenu max states must be non-negative.');
      item.maxStates = count;
      item.state = count === 0 ? 0 : Math.min(item.state ?? 0, count - 1);
      state.menuChanged.emit();
    },
    get_item_max_states(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_max_states').maxStates; },
    toggle_item_multistate(index: number): void {
      const item = itemAt(state, index, 'PopupMenu.toggle_item_multistate');
      if (item.maxStates <= 0) return;
      item.state = ((item.state ?? 0) + 1) % item.maxStates;
      sync(state);
      state.menuChanged.emit();
    },
    set_hide_on_item_selection(enable: boolean): void { state.popup.hide_on_item_selection = enable; },
    is_hide_on_item_selection(): boolean { return state.hideOnItemSelection; },
    set_hide_on_checkable_item_selection(enable: boolean): void { state.popup.hide_on_checkable_item_selection = enable; },
    is_hide_on_checkable_item_selection(): boolean { return state.hideOnCheckableItemSelection; },
    set_hide_on_state_item_selection(enable: boolean): void { state.popup.hide_on_state_item_selection = enable; },
    is_hide_on_state_item_selection(): boolean { return state.hideOnMultistateItemSelection; },
    popup(): void {
      if (state.open) return;
      state.aboutToPopup.emit();
      state.open = true;
      sync(state);
    },
    show(): void {
      if (state.open) return;
      state.open = true;
      sync(state);
    },
    hide(): void {
      if (!state.open) return;
      state.open = false;
      sync(state);
      state.popupHide.emit();
    },
    activate_item(index: number): void {
      const resolved = integer('PopupMenu.activate_item index', index);
      const item = itemAt(state, resolved, 'PopupMenu.activate_item');
      if (item.disabled || item.separator) return;
      if (item.submenu !== '') {
        const submenu = state.submenus.get(item.submenu);
        if (submenu === undefined) throw new Error(`PopupMenu submenu '${item.submenu}' is not registered in the retained hierarchy.`);
        submenu.popup();
        return;
      }
      state.idPressed.emit(item.id >= 0 ? item.id : resolved);
      state.indexPressed.emit(resolved);
      const shouldHide = item.maxStates > 0
        ? state.hideOnMultistateItemSelection
        : item.checkable === 'none'
          ? state.hideOnItemSelection
          : state.hideOnCheckableItemSelection;
      if (shouldHide) popup.hide();
    },
    activate_item_by_event(event: unknown, forGlobalOnly = false): boolean {
      const globalOnly = boolean('PopupMenu.activate_item_by_event for_global_only', forGlobalOnly);
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index]!;
        if (item.disabled || item.separator || item.shortcutDisabled || item.shortcut == null) continue;
        if (globalOnly && !item.shortcutIsGlobal) continue;
        const shortcut = item.shortcut as { matches_event?: (candidate: unknown) => boolean };
        if (typeof shortcut.matches_event === 'function' && shortcut.matches_event(event)) { popup.activate_item(index); return true; }
        if (shortcut === event) { popup.activate_item(index); return true; }
      }
      return false;
    },
    focus_item(index: number): void {
      const item = itemAt(state, index, 'PopupMenu.focus_item');
      if (!item.disabled && !item.separator) {
        // Godot 3's legacy id_focused signal actually emits the item index; Godot 4 emits the
        // configured item id. The serialized dialect is therefore part of the retained state.
        state.idFocused.emit(state.godotMajor === 3 ? index : item.id);
      }
    },
    set_item_accelerator(index: number, accelerator: number): void { itemAt(state, index, 'PopupMenu.set_item_accelerator').accelerator = integer('PopupMenu item accelerator', accelerator); sync(state); state.menuChanged.emit(); },
    get_item_accelerator(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_accelerator').accelerator ?? 0; },
    set_item_shortcut(index: number, shortcut: unknown, global = false): void { const entry = itemAt(state, index, 'PopupMenu.set_item_shortcut'); entry.shortcut = shortcut; entry.shortcutIsGlobal = boolean('PopupMenu shortcut global', global); sync(state); state.menuChanged.emit(); },
    get_item_shortcut(index: number): unknown { return itemAt(state, index, 'PopupMenu.get_item_shortcut').shortcut ?? null; },
    is_item_shortcut_global(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_shortcut_global').shortcutIsGlobal ?? false; },
    set_item_shortcut_disabled(index: number, disabled: boolean): void { itemAt(state, index, 'PopupMenu.set_item_shortcut_disabled').shortcutDisabled = boolean('PopupMenu shortcut disabled', disabled); sync(state); state.menuChanged.emit(); },
    is_item_shortcut_disabled(index: number): boolean { return itemAt(state, index, 'PopupMenu.is_item_shortcut_disabled').shortcutDisabled ?? false; },
    set_item_auto_translate_mode(index: number, mode: number): void { itemAt(state, index, 'PopupMenu.set_item_auto_translate_mode').autoTranslateMode = integer('PopupMenu auto translate mode', mode); sync(state); state.menuChanged.emit(); },
    get_item_auto_translate_mode(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_auto_translate_mode').autoTranslateMode ?? 0; },
    set_item_text_direction(index: number, direction: number): void { itemAt(state, index, 'PopupMenu.set_item_text_direction').textDirection = integer('PopupMenu text direction', direction); sync(state); state.menuChanged.emit(); },
    get_item_text_direction(index: number): number { return itemAt(state, index, 'PopupMenu.get_item_text_direction').textDirection ?? 0; },
    set_item_language(index: number, language: string): void { itemAt(state, index, 'PopupMenu.set_item_language').language = string('PopupMenu language', language); sync(state); state.menuChanged.emit(); },
    get_item_language(index: number): string { return itemAt(state, index, 'PopupMenu.get_item_language').language ?? ''; },
    set_item_icon_modulate(index: number, color: ControlColor): void {
      if (typeof color !== 'object' || color === null || ![color.r, color.g, color.b, color.a].every(Number.isFinite)) throw new TypeError('PopupMenu.set_item_icon_modulate requires Color.');
      itemAt(state, index, 'PopupMenu.set_item_icon_modulate').iconModulate = { r: color.r, g: color.g, b: color.b, a: color.a }; sync(state); state.menuChanged.emit();
    },
    get_item_icon_modulate(index: number): ControlColor { return { ...(itemAt(state, index, 'PopupMenu.get_item_icon_modulate').iconModulate ?? { r: 1, g: 1, b: 1, a: 1 }) }; },
    set_allow_search(enabled: boolean): void { state.popup.allow_search = enabled; },
    get_allow_search(): boolean { return state.allowSearch; },
    set_submenu_popup_delay(seconds: number): void { state.popup.submenu_popup_delay = seconds; },
    get_submenu_popup_delay(): number { return state.submenuPopupDelay; },
    set_prefer_native_menu(enabled: boolean): void { state.popup.prefer_native_menu = enabled; },
    is_prefer_native_menu(): boolean { return state.preferNativeMenu; },
  });
  sync(state);
  return popup;
}

export interface GodotMenuButton extends GodotButtonControl {
  readonly about_to_show: GodotSignal<readonly []>;
  readonly about_to_popup: GodotSignal<readonly []>;
  switch_on_hover: boolean;
  disable_shortcuts: boolean;
  item_count: number;
  get_popup(): GodotPopupMenu;
  get_item_count(): number;
  set_item_count(value: number): void;
  show_popup(): void;
  is_switch_on_hover(): boolean;
  set_switch_on_hover(value: boolean): void;
  set_disable_shortcuts(value: boolean): void;
}

const MENU_POPUPS = new WeakMap<object, GodotPopupMenu>();
let OPEN_MENU_BUTTON: GodotMenuButton | null = null;

/** MenuButton is one retained button plus the PopupMenu it owns in source. */
export function bindMenuButton(
  control: GodotControl,
  initial: Partial<BaseButtonState> & {
    readonly switch_on_hover?: boolean;
    readonly disable_shortcuts?: boolean;
    readonly popup_items?: readonly GodotPopupMenuItem[];
    readonly godot_major?: 3 | 4;
    readonly hide_on_item_selection?: boolean;
    readonly hide_on_checkable_item_selection?: boolean;
    readonly hide_on_multistate_item_selection?: boolean;
  } = {},
): GodotMenuButton {
  const menu = bindBaseButton(control, {
    ...initial,
    toggle_mode: initial.toggle_mode ?? true,
    action_mode: initial.action_mode ?? 0,
  }) as GodotMenuButton;
  const popup = bindPopupMenu(control, {}, {
    ...(initial.popup_items === undefined ? {} : { items: initial.popup_items }),
    ...(initial.godot_major === undefined ? {} : { godotMajor: initial.godot_major }),
    ...(initial.hide_on_item_selection === undefined
      ? {}
      : { hideOnItemSelection: initial.hide_on_item_selection }),
    ...(initial.hide_on_checkable_item_selection === undefined
      ? {}
      : { hideOnCheckableItemSelection: initial.hide_on_checkable_item_selection }),
    ...(initial.hide_on_multistate_item_selection === undefined
      ? {}
      : { hideOnMultistateItemSelection: initial.hide_on_multistate_item_selection }),
  });
  MENU_POPUPS.set(control, popup);
  const aboutToShow = createSignal<readonly []>();
  let switchOnHover = initial.switch_on_hover ?? false;
  if (typeof switchOnHover !== 'boolean') throw new TypeError('MenuButton.switch_on_hover requires bool.');
  let disableShortcuts = initial.disable_shortcuts ?? false;
  Object.defineProperties(menu, {
    about_to_show: { enumerable: true, configurable: true, value: aboutToShow.signal },
    about_to_popup: { enumerable: true, configurable: true, value: aboutToShow.signal },
    switch_on_hover: {
      enumerable: true,
      configurable: true,
      get: () => switchOnHover,
      set: (value: boolean) => {
        switchOnHover = boolean('MenuButton.switch_on_hover', value);
      },
    },
    disable_shortcuts: { enumerable: true, configurable: true, get: () => disableShortcuts, set: (value: boolean) => { disableShortcuts = boolean('MenuButton.disable_shortcuts', value); } },
    item_count: {
      enumerable: true,
      configurable: true,
      get: () => popup.item_count,
      set: (value: number) => { popup.item_count = value; },
    },
  });
  menu.get_popup = (): GodotPopupMenu => popup;
  menu.get_item_count = (): number => popup.get_item_count();
  menu.set_item_count = (value: number): void => { popup.set_item_count(value); };
  menu.show_popup = (): void => {
    if (OPEN_MENU_BUTTON !== null && OPEN_MENU_BUTTON !== menu) OPEN_MENU_BUTTON.get_popup().hide();
    aboutToShow.emit();
    popup.popup();
    menu.button_pressed = true;
    OPEN_MENU_BUTTON = menu;
  };
  menu.is_switch_on_hover = (): boolean => switchOnHover;
  menu.set_switch_on_hover = (value: boolean): void => { menu.switch_on_hover = value; };
  menu.set_disable_shortcuts = (value: boolean): void => { menu.disable_shortcuts = value; };
  menu.pressed.connect(() => {
    menu.show_popup();
  });
  popup.popup_hide.connect(() => { menu.button_pressed = false; if (OPEN_MENU_BUTTON === menu) OPEN_MENU_BUTTON = null; });
  const binding = controlBinding(control);
  const priorMouseEntered = binding.state.read(binding.id).onMouseEntered;
  binding.state.write(binding.id, {
    onMouseEntered(): void {
      priorMouseEntered?.();
      if (switchOnHover && OPEN_MENU_BUTTON !== null && OPEN_MENU_BUTTON !== menu) menu.show_popup();
    },
  });
  return menu;
}

export function releaseMenuControl(control: object): void {
  const popup = MENU_POPUPS.get(control);
  if (popup !== undefined) {
    const popupValue = popupState(popup);
    if (popupValue.presentationElement !== null && popupValue.outsidePointer !== null) {
      popupValue.presentationElement.ownerDocument.removeEventListener(
        'pointerdown', popupValue.outsidePointer, true,
      );
    }
    POPUPS.delete(popup);
    MENU_POPUPS.delete(control);
  }
  const state = POPUPS.get(control);
  if (state !== undefined && state.presentationElement !== null && state.outsidePointer !== null) {
    state.presentationElement.ownerDocument.removeEventListener('pointerdown', state.outsidePointer, true);
  }
  POPUPS.delete(control);
}
