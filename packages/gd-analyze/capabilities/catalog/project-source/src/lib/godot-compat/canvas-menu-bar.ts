/** Retained Pixi MenuBar implementation for Godot 4 menu composition and runtime APIs. */

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { markInternalCanvasChild } from './node';
import type { GodotCanvasPopupMenu } from './canvas-menu-controls';

export interface GodotMenuBarMenu {
  title: string;
  tooltip: string;
  disabled: boolean;
  hidden: boolean;
  popup: GodotCanvasPopupMenu | Container | null;
}

export interface GodotCanvasMenuBarApi {
  flat: boolean;
  start_index: number;
  switch_on_hover: boolean;
  prefer_global_menu: boolean;
  language: string;
  text_direction: number;
  structured_text_bidi_override: number;
  structured_text_bidi_override_options: unknown[];
  readonly menu_changed: GodotSignal<[index: number]>;
  add_menu(title: string, popup?: GodotCanvasPopupMenu | Container | null): number;
  remove_menu(index: number): void;
  clear(): void;
  get_menu_count(): number;
  set_menu_title(index: number, title: string): void;
  get_menu_title(index: number): string;
  set_menu_tooltip(index: number, tooltip: string): void;
  get_menu_tooltip(index: number): string;
  set_menu_disabled(index: number, disabled: boolean): void;
  is_menu_disabled(index: number): boolean;
  set_menu_hidden(index: number, hidden: boolean): void;
  is_menu_hidden(index: number): boolean;
  get_menu_popup(index: number): GodotCanvasPopupMenu | Container | null;
  set_menu_popup(index: number, popup: GodotCanvasPopupMenu | Container | null): void;
  get_menu_idx_from_control(control: object): number;
  is_native_menu(): boolean;
  set_disable_shortcuts(disabled: boolean): void;
  is_shortcuts_disabled(): boolean;
  set_flat(flat: boolean): void;
  is_flat(): boolean;
  set_start_index(index: number): void;
  get_start_index(): number;
  set_switch_on_hover(enabled: boolean): void;
  is_switch_on_hover(): boolean;
  set_prefer_global_menu(enabled: boolean): void;
  is_prefer_global_menu(): boolean;
  set_language(language: string): void;
  get_language(): string;
  set_text_direction(direction: number): void;
  get_text_direction(): number;
  set_structured_text_bidi_override(parser: number): void;
  get_structured_text_bidi_override(): number;
  set_structured_text_bidi_override_options(options: readonly unknown[]): void;
  get_structured_text_bidi_override_options(): unknown[];
  focus(): void;
}

export type GodotCanvasMenuBar = Container & GodotCanvasMenuBarApi;

interface MenuBarState {
  readonly node: GodotCanvasMenuBar;
  readonly background: Graphics;
  readonly labels: Container;
  readonly changed: SignalHandle<[number]>;
  readonly menus: GodotMenuBarMenu[];
  readonly hitAreas: Graphics[];
  flat: boolean;
  startIndex: number;
  switchOnHover: boolean;
  preferGlobal: boolean;
  shortcutsDisabled: boolean;
  language: string;
  direction: number;
  bidiOverride: number;
  bidiOptions: unknown[];
  active: number;
  highlighted: number;
  focusButton: HTMLButtonElement | null;
  keyDown(event: KeyboardEvent): void;
  width: number;
  height: number;
}

const MENU_BARS = new WeakMap<Container, MenuBarState>();

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`MenuBar.${member} requires bool.`);
  return value;
}

function integer(value: unknown, member: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`MenuBar.${member} requires integer ${minimum}..${maximum}.`);
  }
  return value;
}

function string(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`MenuBar.${member} requires String.`);
  return value;
}

function stateOf(node: Container): MenuBarState {
  const state = MENU_BARS.get(node);
  if (state === undefined) throw new Error('MenuBar is not bound to retained canvas state.');
  return state;
}

function menuAt(state: MenuBarState, indexValue: unknown, member: string): GodotMenuBarMenu {
  const index = integer(indexValue, member, 0);
  const menu = state.menus[index];
  if (menu === undefined) throw new RangeError(`MenuBar.${member} index ${index} does not exist.`);
  return menu;
}

function closeMenu(state: MenuBarState, index: number): void {
  const popup = state.menus[index]?.popup;
  if (popup !== null && popup !== undefined) {
    popup.visible = false;
    const hide = Reflect.get(popup, 'hide');
    if (typeof hide === 'function') hide.call(popup);
  }
  if (state.active === index) state.active = -1;
}

function openMenu(state: MenuBarState, index: number): void {
  const menu = state.menus[index];
  if (menu === undefined || menu.disabled || menu.hidden) return;
  if (state.active >= 0 && state.active !== index) closeMenu(state, state.active);
  state.active = index;
  const popup = menu.popup;
  if (popup !== null) {
    popup.position.set(state.hitAreas[index]?.x ?? 0, state.height);
    popup.visible = true;
    const popupMethod = Reflect.get(popup, 'popup');
    if (typeof popupMethod === 'function') popupMethod.call(popup);
  }
}

function redraw(state: MenuBarState): void {
  for (const child of [...state.labels.children]) child.destroy({ children: true });
  state.hitAreas.splice(0).forEach((area) => area.destroy());
  state.background.clear();
  if (!state.flat) state.background.roundRect(0, 0, state.width, state.height, 4).fill({ color: 0x24262b, alpha: 0.98 });
  let x = 4;
  const style = new TextStyle({ fontFamily: 'sans-serif', fontSize: 14, fill: 0xf2f3f5 });
  state.menus.forEach((menu, index) => {
    if (menu.hidden) return;
    const label = markInternalCanvasChild(new Text({ text: menu.title, style }));
    label.alpha = menu.disabled ? 0.45 : 1;
    label.position.set(x + 9, Math.max(0, (state.height - label.height) / 2));
    const width = Math.max(28, label.width + 18);
    const hit = markInternalCanvasChild(new Graphics());
    if (state.active === index || state.highlighted === index) {
      hit.roundRect(x, 2, width, Math.max(0, state.height - 4), 3).fill({
        color: state.active === index ? 0x5b78aa : 0x475569,
        alpha: state.active === index ? 0.65 : 0.45,
      });
    }
    hit.rect(x, 0, width, state.height).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = menu.disabled ? 'none' : 'static';
    hit.cursor = menu.disabled ? 'default' : 'pointer';
    hit.on('pointertap', () => {
      state.highlighted = index;
      state.focusButton?.focus();
      if (state.active === index) closeMenu(state, index); else openMenu(state, index);
      redraw(state);
    });
    hit.on('pointerover', () => {
      state.highlighted = index;
      if (state.switchOnHover && state.active >= 0 && state.active !== index) { openMenu(state, index); redraw(state); }
    });
    state.labels.addChild(hit, label);
    state.hitAreas[index] = hit;
    x += width;
  });
}

function emitChanged(state: MenuBarState, index: number): void {
  redraw(state);
  state.changed.emit(index);
}

export function bindCanvasMenuBar(node: Container, width = 320, height = 30): GodotCanvasMenuBar {
  releaseCanvasMenuBar(node);
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) throw new RangeError('MenuBar dimensions must be finite and non-negative.');
  const bar = node as GodotCanvasMenuBar;
  const background = markInternalCanvasChild(new Graphics());
  const labels = markInternalCanvasChild(new Container());
  bar.addChild(background, labels);
  const state: MenuBarState = {
    node: bar, background, labels, changed: createSignal<[number]>(), menus: [], hitAreas: [],
    flat: false, startIndex: 0, switchOnHover: true, preferGlobal: true, shortcutsDisabled: false,
    language: '', direction: 0, bidiOverride: 0, bidiOptions: [], active: -1,
    highlighted: -1,
    focusButton: null,
    keyDown: () => {},
    width, height,
  };
  MENU_BARS.set(bar, state);
  const focusButton = typeof document === 'undefined' ? null : document.createElement('button');
  if (focusButton !== null) {
    focusButton.type = 'button';
    focusButton.tabIndex = -1;
    focusButton.style.position = 'fixed';
    focusButton.style.left = '-10000px';
    focusButton.style.top = '0';
    focusButton.style.width = '1px';
    focusButton.style.height = '1px';
    focusButton.style.opacity = '0';
    focusButton.style.pointerEvents = 'none';
    focusButton.setAttribute('aria-label', 'Menu bar');
    document.body.append(focusButton);
    state.focusButton = focusButton;
  }
  const selectable = (): number[] => state.menus
    .map((menu, index) => ({ menu, index }))
    .filter(({ menu }) => !menu.hidden && !menu.disabled)
    .map(({ index }) => index);
  const moveHighlight = (delta: number): void => {
    const indices = selectable();
    if (indices.length === 0) { state.highlighted = -1; return; }
    const current = indices.indexOf(state.highlighted);
    state.highlighted = indices[(current < 0 ? (delta > 0 ? 0 : indices.length - 1) : current + delta + indices.length) % indices.length]!;
    if (state.active >= 0) openMenu(state, state.highlighted);
    redraw(state);
  };
  state.keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveHighlight(state.direction === 3 ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveHighlight(state.direction === 3 ? 1 : -1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const indices = selectable();
      state.highlighted = indices[0] ?? -1;
      redraw(state);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const indices = selectable();
      state.highlighted = indices.at(-1) ?? -1;
      redraw(state);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (state.highlighted < 0) state.highlighted = selectable()[0] ?? -1;
      if (state.highlighted >= 0) {
        if (state.active === state.highlighted && (event.key === 'Enter' || event.key === ' ')) closeMenu(state, state.highlighted);
        else openMenu(state, state.highlighted);
        redraw(state);
      }
      return;
    }
    if (event.key === 'Escape' && state.active >= 0) {
      event.preventDefault();
      closeMenu(state, state.active);
      redraw(state);
    }
  };
  focusButton?.addEventListener('keydown', state.keyDown);
  const property = <T>(name: string, read: () => T, write: (value: T) => void): void => {
    Object.defineProperty(bar, name, { configurable: true, enumerable: true, get: read, set: write });
  };
  property('flat', () => state.flat, (value) => { state.flat = boolean(value, 'flat'); redraw(state); });
  property('start_index', () => state.startIndex, (value) => { state.startIndex = integer(value, 'start_index'); });
  property('switch_on_hover', () => state.switchOnHover, (value) => { state.switchOnHover = boolean(value, 'switch_on_hover'); });
  property('prefer_global_menu', () => state.preferGlobal, (value) => { state.preferGlobal = boolean(value, 'prefer_global_menu'); });
  property('language', () => state.language, (value) => { state.language = string(value, 'language'); redraw(state); });
  property('text_direction', () => state.direction, (value) => { state.direction = integer(value, 'text_direction', -1, 3); redraw(state); });
  property('structured_text_bidi_override', () => state.bidiOverride, (value) => { state.bidiOverride = integer(value, 'structured_text_bidi_override', 0); redraw(state); });
  property('structured_text_bidi_override_options', () => [...state.bidiOptions], (value) => {
    if (!Array.isArray(value)) throw new TypeError('MenuBar.structured_text_bidi_override_options requires Array.');
    state.bidiOptions = [...value]; redraw(state);
  });
  Object.defineProperty(bar, 'menu_changed', { configurable: true, enumerable: true, value: state.changed.signal });
  Object.assign(bar, {
    add_menu(title: string, popup: GodotCanvasPopupMenu | Container | null = null): number {
      state.menus.push({ title: string(title, 'add_menu.title'), tooltip: '', disabled: false, hidden: false, popup });
      const index = state.menus.length - 1; emitChanged(state, index); return index;
    },
    remove_menu(indexValue: number): void { const index = integer(indexValue, 'remove_menu', 0); menuAt(state, index, 'remove_menu'); closeMenu(state, index); state.menus.splice(index, 1); emitChanged(state, index); },
    clear(): void { if (state.active >= 0) closeMenu(state, state.active); state.menus.length = 0; emitChanged(state, -1); },
    get_menu_count: (): number => state.menus.length,
    set_menu_title(index: number, value: string): void { menuAt(state, index, 'set_menu_title').title = string(value, 'set_menu_title.title'); emitChanged(state, index); },
    get_menu_title: (index: number): string => menuAt(state, index, 'get_menu_title').title,
    set_menu_tooltip(index: number, value: string): void { menuAt(state, index, 'set_menu_tooltip').tooltip = string(value, 'set_menu_tooltip.tooltip'); emitChanged(state, index); },
    get_menu_tooltip: (index: number): string => menuAt(state, index, 'get_menu_tooltip').tooltip,
    set_menu_disabled(index: number, value: boolean): void { const menu = menuAt(state, index, 'set_menu_disabled'); menu.disabled = boolean(value, 'set_menu_disabled.disabled'); if (menu.disabled) closeMenu(state, index); emitChanged(state, index); },
    is_menu_disabled: (index: number): boolean => menuAt(state, index, 'is_menu_disabled').disabled,
    set_menu_hidden(index: number, value: boolean): void { const menu = menuAt(state, index, 'set_menu_hidden'); menu.hidden = boolean(value, 'set_menu_hidden.hidden'); if (menu.hidden) closeMenu(state, index); emitChanged(state, index); },
    is_menu_hidden: (index: number): boolean => menuAt(state, index, 'is_menu_hidden').hidden,
    get_menu_popup: (index: number) => menuAt(state, index, 'get_menu_popup').popup,
    set_menu_popup(index: number, popup: GodotCanvasPopupMenu | Container | null): void { menuAt(state, index, 'set_menu_popup').popup = popup; emitChanged(state, index); },
    get_menu_idx_from_control(control: object): number {
      if (typeof control !== 'object' || control === null) throw new TypeError('MenuBar.get_menu_idx_from_control requires Control.');
      return state.menus.findIndex((menu) => menu.popup === control);
    },
    is_native_menu: (): boolean => false,
    set_disable_shortcuts(value: boolean): void { state.shortcutsDisabled = boolean(value, 'set_disable_shortcuts'); },
    is_shortcuts_disabled: (): boolean => state.shortcutsDisabled,
    set_flat(value: boolean): void { bar.flat = value; }, is_flat: (): boolean => bar.flat,
    set_start_index(value: number): void { bar.start_index = value; }, get_start_index: (): number => bar.start_index,
    set_switch_on_hover(value: boolean): void { bar.switch_on_hover = value; }, is_switch_on_hover: (): boolean => bar.switch_on_hover,
    set_prefer_global_menu(value: boolean): void { bar.prefer_global_menu = value; }, is_prefer_global_menu: (): boolean => bar.prefer_global_menu,
    set_language(value: string): void { bar.language = value; }, get_language: (): string => bar.language,
    set_text_direction(value: number): void { bar.text_direction = value; }, get_text_direction: (): number => bar.text_direction,
    set_structured_text_bidi_override(value: number): void { bar.structured_text_bidi_override = value; }, get_structured_text_bidi_override: (): number => bar.structured_text_bidi_override,
    set_structured_text_bidi_override_options(value: readonly unknown[]): void { bar.structured_text_bidi_override_options = [...value]; }, get_structured_text_bidi_override_options: (): unknown[] => [...bar.structured_text_bidi_override_options],
    focus(): void {
      if (state.focusButton === null) throw new Error('MenuBar.grab_focus requires a browser DOM focus target.');
      if (state.highlighted < 0) state.highlighted = selectable()[0] ?? -1;
      state.focusButton.focus();
      redraw(state);
    },
  });
  redraw(state);
  return bar;
}

export function createGodotCanvasMenuBar(): GodotCanvasMenuBar {
  const bar = bindCanvasMenuBar(new Container());
  registerGodotObjectIdentity(bar, 'MenuBar');
  return bar;
}

export function resizeCanvasMenuBar(node: Container, width: number, height: number): void {
  const state = stateOf(node);
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) throw new RangeError('MenuBar dimensions must be finite and non-negative.');
  state.width = width; state.height = height; redraw(state);
}

export function releaseCanvasMenuBar(node: Container): void {
  const state = MENU_BARS.get(node);
  if (state === undefined) return;
  if (state.active >= 0) closeMenu(state, state.active);
  state.changed.clear();
  state.focusButton?.removeEventListener('keydown', state.keyDown);
  state.focusButton?.remove();
  state.background.removeFromParent(); state.background.destroy();
  state.labels.removeFromParent(); state.labels.destroy({ children: true });
  MENU_BARS.delete(node);
}
