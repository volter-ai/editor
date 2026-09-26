/** Retained NativeMenu singleton for browser-hosted menu structure and callbacks. */

import { GodotCallable } from './callable';
import { allocateGodotRid, godotRidNew, type GodotRid } from './gdscript-builtins';

export const NATIVE_MENU_FEATURE_GLOBAL_MENU = 0;
export const NATIVE_MENU_FEATURE_POPUP_MENU = 1;
export const NATIVE_MENU_FEATURE_OPEN_CLOSE_CALLBACK = 2;
export const NATIVE_MENU_FEATURE_HOVER_CALLBACK = 3;
export const NATIVE_MENU_FEATURE_KEY_CALLBACK = 4;

export const NATIVE_MENU_INVALID_MENU_ID = 0;
export const NATIVE_MENU_MAIN_MENU_ID = 1;
export const NATIVE_MENU_APPLICATION_MENU_ID = 2;
export const NATIVE_MENU_WINDOW_MENU_ID = 3;
export const NATIVE_MENU_HELP_MENU_ID = 4;
export const NATIVE_MENU_DOCK_MENU_ID = 5;

interface MenuItem {
  kind: 'item' | 'separator' | 'submenu';
  text: string;
  tag: unknown;
  callback: GodotCallable;
  hoverCallback: GodotCallable;
  keyCallback: GodotCallable;
  submenu: GodotRid;
  accelerator: number;
  icon: unknown;
  checked: boolean;
  checkable: boolean;
  radioCheckable: boolean;
  disabled: boolean;
  hidden: boolean;
  tooltip: string;
  state: number;
  maxStates: number;
  indentationLevel: number;
}

interface MenuState {
  readonly rid: GodotRid;
  readonly systemId: number;
  readonly items: MenuItem[];
  name: string;
  text: string;
  rtl: boolean;
  opened: boolean;
  minimumWidth: number;
  popupOpenCallback: GodotCallable;
  popupCloseCallback: GodotCallable;
  popupPosition: { x: number; y: number };
}

function nullCallable(): GodotCallable { return GodotCallable.null(); }

function callable(value: unknown, member: string): GodotCallable {
  if (value === undefined || value === null) return nullCallable();
  if (value instanceof GodotCallable) return value;
  if (typeof value === 'function') return GodotCallable.custom(value as (...args: readonly unknown[]) => unknown);
  throw new TypeError(`NativeMenu.${member} requires Callable.`);
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`NativeMenu.${member} requires integer.`);
  }
  return value;
}

function numberValue(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`NativeMenu.${member} requires finite number.`);
  }
  return value;
}

function stringValue(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`NativeMenu.${member} requires String.`);
  return value;
}

function ridKey(rid: GodotRid): bigint {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') {
    throw new TypeError('NativeMenu requires RID.');
  }
  return rid.id;
}

function makeItem(kind: MenuItem['kind'], text = ''): MenuItem {
  return {
    kind, text, tag: null, callback: nullCallable(), hoverCallback: nullCallable(),
    keyCallback: nullCallable(), submenu: godotRidNew(), accelerator: 0, icon: null,
    checked: false, checkable: false, radioCheckable: false, disabled: false,
    hidden: false, tooltip: '', state: 0, maxStates: 0, indentationLevel: 0,
  };
}

class GodotNativeMenuRuntime {
  private readonly menus = new Map<bigint, MenuState>();
  private readonly systemMenus = new Map<number, GodotRid>();

  constructor() {
    for (const [id, name] of [
      [NATIVE_MENU_MAIN_MENU_ID, 'Main'], [NATIVE_MENU_APPLICATION_MENU_ID, 'Application'],
      [NATIVE_MENU_WINDOW_MENU_ID, 'Window'], [NATIVE_MENU_HELP_MENU_ID, 'Help'],
      [NATIVE_MENU_DOCK_MENU_ID, 'Dock'],
    ] as const) {
      const menu = this.newMenu(id, name);
      this.systemMenus.set(id, menu.rid);
    }
  }

  private newMenu(systemId = 0, name = ''): MenuState {
    const menu: MenuState = {
      rid: allocateGodotRid(), systemId, items: [], name, text: name, rtl: false,
      opened: false, minimumWidth: 0, popupOpenCallback: nullCallable(),
      popupCloseCallback: nullCallable(), popupPosition: { x: 0, y: 0 },
    };
    this.menus.set(menu.rid.id, menu);
    return menu;
  }

  private menu(rid: GodotRid): MenuState {
    const value = this.menus.get(ridKey(rid));
    if (value === undefined) throw new Error(`NativeMenu RID ${String(rid.id)} does not identify a menu.`);
    return value;
  }

  private item(rid: GodotRid, idx: unknown): MenuItem {
    const menu = this.menu(rid);
    const position = integer(idx, 'item index');
    if (position < 0 || position >= menu.items.length) {
      throw new RangeError(`NativeMenu item index ${position} is out of range.`);
    }
    return menu.items[position]!;
  }

  private insert(rid: GodotRid, item: MenuItem, indexValue: unknown): number {
    const menu = this.menu(rid);
    const index = integer(indexValue, 'add item index');
    const position = index < 0 ? menu.items.length : Math.min(index, menu.items.length);
    menu.items.splice(position, 0, item);
    return position;
  }

  has_feature(feature: unknown): boolean {
    const value = integer(feature, 'has_feature');
    return value >= NATIVE_MENU_FEATURE_GLOBAL_MENU && value <= NATIVE_MENU_FEATURE_KEY_CALLBACK;
  }

  has_system_menu(menuId: unknown): boolean { return this.systemMenus.has(integer(menuId, 'has_system_menu')); }
  get_system_menu(menuId: unknown): GodotRid { return this.systemMenus.get(integer(menuId, 'get_system_menu')) ?? godotRidNew(); }
  get_system_menu_name(menuId: unknown): string { return this.menus.get(this.get_system_menu(menuId).id)?.name ?? ''; }
  get_system_menu_text(menuId: unknown): string { return this.menus.get(this.get_system_menu(menuId).id)?.text ?? ''; }

  set_system_menu_text(menuId: unknown, name: unknown): void {
    const menu = this.menus.get(this.get_system_menu(menuId).id);
    if (menu !== undefined) menu.text = stringValue(name, 'set_system_menu_text');
  }

  create_menu(): GodotRid { return this.newMenu().rid; }
  has_menu(rid: GodotRid): boolean { return this.menus.has(ridKey(rid)); }

  free_menu(rid: GodotRid): void {
    const menu = this.menu(rid);
    if (menu.systemId !== 0) throw new Error('NativeMenu cannot free a system menu.');
    if (menu.opened) this.dismiss(rid);
    this.menus.delete(rid.id);
  }

  get_size(rid: GodotRid): { x: number; y: number } {
    const menu = this.menu(rid);
    const visible = menu.items.filter((item) => !item.hidden);
    const textWidth = visible.reduce((width, item) => Math.max(width, item.text.length * 8 + item.indentationLevel * 16), 0);
    return { x: Math.max(menu.minimumWidth, textWidth + 32), y: visible.length * 24 };
  }

  popup(rid: GodotRid, position: { x: number; y: number }): void {
    const menu = this.menu(rid);
    menu.popupPosition = { x: numberValue(position.x, 'popup position.x'), y: numberValue(position.y, 'popup position.y') };
    if (!menu.opened) { menu.opened = true; menu.popupOpenCallback.call(); }
  }

  dismiss(rid: GodotRid): void {
    const menu = this.menu(rid);
    if (!menu.opened) return;
    menu.opened = false;
    menu.popupCloseCallback.call();
  }

  activate_item(rid: GodotRid, idx: unknown): void {
    const item = this.item(rid, idx);
    if (item.disabled || item.hidden || item.kind === 'separator') return;
    item.callback.call(item.tag);
    this.dismiss(rid);
  }

  hover_item(rid: GodotRid, idx: unknown): void { this.item(rid, idx).hoverCallback.call(this.item(rid, idx).tag); }
  activate_key(rid: GodotRid, idx: unknown): void { this.item(rid, idx).keyCallback.call(this.item(rid, idx).tag); }
  set_interface_direction(rid: GodotRid, isRtl: unknown): void { this.menu(rid).rtl = Boolean(isRtl); }
  set_popup_open_callback(rid: GodotRid, value: unknown): void { this.menu(rid).popupOpenCallback = callable(value, 'set_popup_open_callback'); }
  get_popup_open_callback(rid: GodotRid): GodotCallable { return this.menu(rid).popupOpenCallback; }
  set_popup_close_callback(rid: GodotRid, value: unknown): void { this.menu(rid).popupCloseCallback = callable(value, 'set_popup_close_callback'); }
  get_popup_close_callback(rid: GodotRid): GodotCallable { return this.menu(rid).popupCloseCallback; }
  set_minimum_width(rid: GodotRid, width: unknown): void { this.menu(rid).minimumWidth = Math.max(0, numberValue(width, 'set_minimum_width')); }
  get_minimum_width(rid: GodotRid): number { return this.menu(rid).minimumWidth; }
  is_opened(rid: GodotRid): boolean { return this.menu(rid).opened; }

  add_submenu_item(rid: GodotRid, label: unknown, submenu: GodotRid, tag: unknown = null, index = -1): number {
    this.menu(submenu);
    const item = makeItem('submenu', stringValue(label, 'add_submenu_item label'));
    item.submenu = submenu; item.tag = tag;
    return this.insert(rid, item, index);
  }

  private addNormal(rid: GodotRid, label: unknown, callbackValue: unknown, keyCallback: unknown, tag: unknown, accelerator: unknown, index: unknown, options: Partial<MenuItem>): number {
    const item = Object.assign(makeItem('item', stringValue(label, 'add_item label')), options);
    item.callback = callable(callbackValue, 'add_item callback');
    item.keyCallback = callable(keyCallback, 'add_item key_callback');
    item.tag = tag; item.accelerator = integer(accelerator, 'add_item accelerator');
    return this.insert(rid, item, index);
  }

  add_item(rid: GodotRid, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, {});
  }
  add_check_item(rid: GodotRid, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { checkable: true });
  }
  add_icon_item(rid: GodotRid, icon: unknown, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { icon });
  }
  add_icon_check_item(rid: GodotRid, icon: unknown, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { icon, checkable: true });
  }
  add_radio_check_item(rid: GodotRid, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { checkable: true, radioCheckable: true });
  }
  add_icon_radio_check_item(rid: GodotRid, icon: unknown, label: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { icon, checkable: true, radioCheckable: true });
  }
  add_multistate_item(rid: GodotRid, label: unknown, maxStates: unknown, defaultState: unknown, callbackValue?: unknown, keyCallback?: unknown, tag: unknown = null, accelerator = 0, index = -1): number {
    const max = Math.max(0, integer(maxStates, 'add_multistate_item max_states'));
    const state = integer(defaultState, 'add_multistate_item default_state');
    return this.addNormal(rid, label, callbackValue, keyCallback, tag, accelerator, index, { maxStates: max, state: Math.max(0, Math.min(state, max - 1)) });
  }
  add_separator(rid: GodotRid, index = -1): number { return this.insert(rid, makeItem('separator'), index); }

  find_item_index_with_text(rid: GodotRid, text: unknown): number { return this.menu(rid).items.findIndex((item) => item.text === stringValue(text, 'find_item_index_with_text')); }
  find_item_index_with_tag(rid: GodotRid, tag: unknown): number { return this.menu(rid).items.findIndex((item) => Object.is(item.tag, tag)); }
  find_item_index_with_submenu(rid: GodotRid, submenu: GodotRid): number { return this.menu(rid).items.findIndex((item) => item.submenu.id === ridKey(submenu)); }

  is_item_checked(rid: GodotRid, idx: unknown): boolean { return this.item(rid, idx).checked; }
  is_item_checkable(rid: GodotRid, idx: unknown): boolean { return this.item(rid, idx).checkable; }
  is_item_radio_checkable(rid: GodotRid, idx: unknown): boolean { return this.item(rid, idx).radioCheckable; }
  get_item_callback(rid: GodotRid, idx: unknown): GodotCallable { return this.item(rid, idx).callback; }
  get_item_key_callback(rid: GodotRid, idx: unknown): GodotCallable { return this.item(rid, idx).keyCallback; }
  get_item_tag(rid: GodotRid, idx: unknown): unknown { return this.item(rid, idx).tag; }
  get_item_text(rid: GodotRid, idx: unknown): string { return this.item(rid, idx).text; }
  get_item_submenu(rid: GodotRid, idx: unknown): GodotRid { return this.item(rid, idx).submenu; }
  get_item_accelerator(rid: GodotRid, idx: unknown): number { return this.item(rid, idx).accelerator; }
  is_item_disabled(rid: GodotRid, idx: unknown): boolean { return this.item(rid, idx).disabled; }
  is_item_hidden(rid: GodotRid, idx: unknown): boolean { return this.item(rid, idx).hidden; }
  get_item_tooltip(rid: GodotRid, idx: unknown): string { return this.item(rid, idx).tooltip; }
  get_item_state(rid: GodotRid, idx: unknown): number { return this.item(rid, idx).state; }
  get_item_max_states(rid: GodotRid, idx: unknown): number { return this.item(rid, idx).maxStates; }
  get_item_icon(rid: GodotRid, idx: unknown): unknown { return this.item(rid, idx).icon; }
  get_item_indentation_level(rid: GodotRid, idx: unknown): number { return this.item(rid, idx).indentationLevel; }

  set_item_checked(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).checked = Boolean(value); }
  set_item_checkable(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).checkable = Boolean(value); }
  set_item_radio_checkable(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).radioCheckable = Boolean(value); }
  set_item_callback(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).callback = callable(value, 'set_item_callback'); }
  set_item_hover_callbacks(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).hoverCallback = callable(value, 'set_item_hover_callbacks'); }
  set_item_key_callback(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).keyCallback = callable(value, 'set_item_key_callback'); }
  set_item_tag(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).tag = value; }
  set_item_text(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).text = stringValue(value, 'set_item_text'); }
  set_item_submenu(rid: GodotRid, idx: unknown, value: GodotRid): void { this.menu(value); this.item(rid, idx).submenu = value; }
  set_item_accelerator(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).accelerator = integer(value, 'set_item_accelerator'); }
  set_item_disabled(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).disabled = Boolean(value); }
  set_item_hidden(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).hidden = Boolean(value); }
  set_item_tooltip(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).tooltip = stringValue(value, 'set_item_tooltip'); }
  set_item_state(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).state = integer(value, 'set_item_state'); }
  set_item_max_states(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).maxStates = Math.max(0, integer(value, 'set_item_max_states')); }
  set_item_icon(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).icon = value; }
  set_item_indentation_level(rid: GodotRid, idx: unknown, value: unknown): void { this.item(rid, idx).indentationLevel = Math.max(0, integer(value, 'set_item_indentation_level')); }

  set_item_index(rid: GodotRid, idx: unknown, targetIdx: unknown): number {
    const menu = this.menu(rid);
    const source = integer(idx, 'set_item_index idx');
    const target = integer(targetIdx, 'set_item_index target_idx');
    if (source < 0 || source >= menu.items.length || target < 0 || target >= menu.items.length) return -1;
    const [item] = menu.items.splice(source, 1);
    menu.items.splice(target, 0, item!);
    return target;
  }

  get_item_count(rid: GodotRid): number { return this.menu(rid).items.length; }
  is_system_menu(rid: GodotRid): boolean { return this.menu(rid).systemId !== 0; }
  remove_item(rid: GodotRid, idx: unknown): void { this.menu(rid).items.splice(integer(idx, 'remove_item'), 1); }
  clear(rid: GodotRid): void { this.menu(rid).items.length = 0; }
}

export const GodotNativeMenu = new GodotNativeMenuRuntime();
