/** Retained Pixi presentation for MenuButton/PopupMenu. */

import { Container, Graphics, Sprite, Text, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';

import {
  bindMenuButton,
  bindPopupMenu,
  releaseMenuControl,
  type GodotMenuButton,
  type GodotPopupMenu,
  type GodotPopupMenuItem,
} from './menu-controls';
import {
  createControlState,
  registerControlBinding,
  type ControlPoint,
  type ControlRecord,
  type ControlState,
  type GodotControl,
} from './control-state';
import { markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { projectGodotTexture } from './button-icon';

const ROW_HEIGHT = 26;

interface MenuRenderState {
  readonly background: Graphics;
  readonly labels: Container[];
  readonly store: ControlState;
  readonly kind: 'menu-button' | 'popup-menu';
  width: number;
  height: number;
  pointerDown(event: FederatedPointerEvent): void;
  pointerMove(event: FederatedPointerEvent): void;
  pointerOut(): void;
  pointerUp(event: FederatedPointerEvent): void;
  pointerUpOutside(event: FederatedPointerEvent): void;
  closeRequest(event: FederatedPointerEvent): void;
  wheel(event: FederatedWheelEvent): void;
  keyDown(event: KeyboardEvent): void;
  unregisterRelease(): void;
  scrollRow: number;
  released: boolean;
}

const MENUS = new WeakMap<Container, MenuRenderState>();

export interface CanvasMenuOptions {
  readonly node: Container;
  readonly width: number;
  readonly height: number;
  readonly text?: string;
  readonly switchOnHover?: boolean;
  readonly disableShortcuts?: boolean;
  readonly disabled?: boolean;
  readonly toggleMode?: boolean;
  readonly buttonPressed?: boolean;
  readonly actionMode?: 0 | 1;
  readonly buttonMask?: number;
  readonly keepPressedOutside?: boolean;
  readonly items?: readonly GodotPopupMenuItem[];
  readonly godotMajor?: 3 | 4;
  readonly hideOnItemSelection?: boolean;
  readonly hideOnCheckableItemSelection?: boolean;
  readonly hideOnMultistateItemSelection?: boolean;
}

export interface GodotCanvasMenuButton extends Container, Omit<GodotMenuButton, keyof GodotControl> {}
export interface GodotCanvasPopupMenu extends Container, Omit<GodotPopupMenu, keyof GodotControl> {}

function dimension(member: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${member} must be finite and non-negative.`);
  return value;
}

function stateOf(node: Container): MenuRenderState {
  const state = MENUS.get(node);
  if (state === undefined) throw new Error('Canvas MenuButton/PopupMenu is not bound.');
  return state;
}

function clearLabels(state: MenuRenderState): void {
  for (const label of state.labels.splice(0)) {
    label.removeFromParent();
    label.destroy();
  }
}

function label(node: Container, state: MenuRenderState, value: string, x: number, y: number, color = 0xffffff): void {
  const text = markInternalCanvasChild(new Text({
    text: value,
    x,
    y,
    style: { fill: color, fontFamily: 'sans-serif', fontSize: 14 },
  }));
  state.labels.push(text);
  node.addChild(text);
}

function draw(node: Container): void {
  const state = stateOf(node);
  const record = state.store.read('menu');
  const items = record.menuItems ?? [];
  clearLabels(state);
  state.background.clear();
  if (state.kind === 'menu-button') {
    state.background.rect(0, 0, state.width, state.height).fill({ color: 0x252a32 });
    state.background.rect(0, 0, state.width, state.height).stroke({ color: 0x737983, width: 1 });
    label(node, state, record.text ?? '', 8, Math.max(0, (state.height - 20) / 2));
    label(node, state, '▼', Math.max(0, state.width - 20), Math.max(0, (state.height - 18) / 2));
    if (!record.menuOpen) return;
  } else if (!record.menuOpen) {
    node.visible = false;
    return;
  }
  node.visible = true;
  const top = state.kind === 'menu-button' ? state.height : 0;
  const popupWidth = Math.max(
    state.width,
    ...items.map((item) =>
      item.text.length * 9 + 44 + Math.max(0, item.indent ?? 0) * 16 + Math.max(0, item.iconMaxWidth ?? 0)),
  );
  const visibleItems = items.slice(state.scrollRow, state.scrollRow + 12);
  visibleItems.forEach((item, visibleIndex) => {
    const index = state.scrollRow + visibleIndex;
    const y = top + visibleIndex * ROW_HEIGHT;
    state.background.rect(0, y, popupWidth, ROW_HEIGHT).fill({ color: record.menuFocusedItem === index ? 0x365a8c : 0x181c22 });
    state.background.rect(0, y, popupWidth, ROW_HEIGHT).stroke({ color: 0x646a74, width: 1 });
    if (item.separator) {
      state.background.moveTo(8, y + ROW_HEIGHT / 2).lineTo(popupWidth - 8, y + ROW_HEIGHT / 2).stroke({ color: 0x707780, width: 1 });
      return;
    }
    const prefix = item.checkable === 'none' ? '' : item.checked ? '✓ ' : '  ';
    const suffix = item.submenu === '' ? '' : '  ▶';
    const indentX = 8 + Math.max(0, item.indent ?? 0) * 16;
    let textX = indentX;
    const itemTexture = item.icon === undefined || item.icon === null
      ? null
      : projectGodotTexture(item.icon, 'PopupMenu item icon').pixiTexture;
    if (itemTexture !== null) {
      const icon = markInternalCanvasChild(new Sprite(itemTexture));
      icon.position.set(indentX, y + 3);
      const scale = Math.min(
        1,
        20 / Math.max(1, itemTexture.width),
        20 / Math.max(1, itemTexture.height),
        (item.iconMaxWidth ?? 0) > 0
          ? (item.iconMaxWidth ?? 0) / Math.max(1, itemTexture.width)
          : 1,
      );
      icon.scale.set(scale);
      state.labels.push(icon);
      node.addChild(icon);
      textX = indentX + 26;
    }
    label(node, state, `${prefix}${item.text}${suffix}`, textX, y + 3, item.disabled ? 0x777777 : 0xffffff);
  });
}

function projectedState(node: Container): ControlState {
  const base = createControlState();
  return {
    read: (id) => base.read(id),
    write(id: string, patch: ControlRecord): void { base.write(id, patch); if (MENUS.has(node)) draw(node); },
    register: (id, value) => base.register(id, value),
    authored: (id) => base.authored(id),
    seatControl: (id, control) => base.seatControl(id, control),
    control: (id) => base.control(id),
    childControls: (id) => base.childControls(id),
    focusOwner: () => base.focusOwner(),
    releaseFocus: (control) => base.releaseFocus(control),
    routePointer: (control, event) => base.routePointer(control, event),
    grabClickFocus: (control) => base.grabClickFocus(control),
    removeControl: (id, control) => base.removeControl(id, control),
    retain: (release) => base.retain(release),
    clear: () => base.clear(),
    snapshot: () => base.snapshot(),
  };
}

function prepare(options: CanvasMenuOptions, kind: MenuRenderState['kind']): MenuRenderState {
  releaseCanvasMenu(options.node);
  const background = markInternalCanvasChild(new Graphics());
  options.node.addChild(background);
  const store = projectedState(options.node);
  const state: MenuRenderState = {
    background,
    labels: [],
    store,
    kind,
    width: dimension('Canvas menu width', options.width),
    height: dimension('Canvas menu height', options.height),
    pointerDown: () => {},
    pointerMove: () => {},
    pointerOut: () => {},
    pointerUp: () => {},
    pointerUpOutside: () => {},
    closeRequest: () => {},
    wheel: () => {},
    keyDown: () => {},
    unregisterRelease: () => {},
    scrollRow: 0,
    released: false,
  };
  MENUS.set(options.node, state);
  registerControlBinding(options.node as unknown as GodotControl, { id: 'menu', state: store });
  store.write('menu', { text: options.text ?? '' });
  options.node.eventMode = 'static';
  options.node.cursor = 'pointer';
  state.unregisterRelease = registerCanvasNodeRelease(options.node, () => releaseCanvasMenu(options.node));
  return state;
}

function installMenuNavigation(node: Container, state: MenuRenderState): void {
  const focusIndex = (index: number): void => {
    const items = state.store.read('menu').menuItems ?? [];
    if (index < state.scrollRow) state.scrollRow = index;
    else if (index >= state.scrollRow + 12) state.scrollRow = index - 11;
    state.scrollRow = Math.max(0, Math.min(Math.max(0, items.length - 12), state.scrollRow));
    state.store.read('menu').onMenuFocus?.(index);
    draw(node);
  };
  const adjacent = (direction: -1 | 1): void => {
    const record = state.store.read('menu');
    const items = record.menuItems ?? [];
    if (items.length === 0) return;
    let index = record.menuFocusedItem ?? (direction > 0 ? -1 : items.length);
    for (let attempts = 0; attempts < items.length; attempts += 1) {
      index = (index + direction + items.length) % items.length;
      const item = items[index];
      if (item !== undefined && !item.separator && !item.disabled) { focusIndex(index); return; }
    }
  };
  state.wheel = (event) => {
    const record = state.store.read('menu');
    const items = record.menuItems ?? [];
    if (record.menuOpen !== true || items.length <= 12 || event.deltaY === 0) return;
    const next = Math.max(0, Math.min(items.length - 12, state.scrollRow + (event.deltaY > 0 ? 1 : -1)));
    if (next === state.scrollRow) return;
    state.scrollRow = next;
    draw(node);
    event.preventDefault();
    event.stopPropagation();
  };
  state.keyDown = (event) => {
    const record = state.store.read('menu');
    if (record.menuOpen !== true) return;
    if (event.key === 'ArrowDown') adjacent(1);
    else if (event.key === 'ArrowUp') adjacent(-1);
    else if (event.key === 'Home') {
      const first = (record.menuItems ?? []).findIndex((item) => !item.separator && !item.disabled);
      if (first >= 0) focusIndex(first);
    } else if (event.key === 'End') {
      const items = record.menuItems ?? [];
      for (let index = items.length - 1; index >= 0; index -= 1) if (!items[index]!.separator && !items[index]!.disabled) { focusIndex(index); break; }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if ((record.menuFocusedItem ?? -1) >= 0) record.onMenuSelect?.(record.menuFocusedItem!);
    } else if (event.key === 'ArrowRight') {
      const index = record.menuFocusedItem ?? -1;
      if (index >= 0 && (record.menuItems?.[index]?.submenu ?? '') !== '') record.onMenuSelect?.(index);
    } else if (event.key === 'Escape' || event.key === 'ArrowLeft') record.onMenuCloseRequest?.();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  node.on('wheel', state.wheel);
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
}

export function bindCanvasMenuButton(options: CanvasMenuOptions): GodotCanvasMenuButton {
  const state = prepare(options, 'menu-button');
  const menu = bindMenuButton(options.node as unknown as GodotControl, {
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
    ...(options.toggleMode === undefined ? {} : { toggle_mode: options.toggleMode }),
    ...(options.buttonPressed === undefined ? {} : { button_pressed: options.buttonPressed }),
    ...(options.actionMode === undefined ? {} : { action_mode: options.actionMode }),
    ...(options.buttonMask === undefined ? {} : { button_mask: options.buttonMask }),
    ...(options.keepPressedOutside === undefined ? {} : { keep_pressed_outside: options.keepPressedOutside }),
    ...(options.switchOnHover === undefined ? {} : { switch_on_hover: options.switchOnHover }),
    ...(options.disableShortcuts === undefined ? {} : { disable_shortcuts: options.disableShortcuts }),
    ...(options.items === undefined ? {} : { popup_items: options.items }),
    ...(options.godotMajor === undefined ? {} : { godot_major: options.godotMajor }),
    ...(options.hideOnItemSelection === undefined ? {} : { hide_on_item_selection: options.hideOnItemSelection }),
    ...(options.hideOnCheckableItemSelection === undefined ? {} : { hide_on_checkable_item_selection: options.hideOnCheckableItemSelection }),
    ...(options.hideOnMultistateItemSelection === undefined ? {} : { hide_on_multistate_item_selection: options.hideOnMultistateItemSelection }),
  });
  installMenuNavigation(options.node, state);
  const down = (event: FederatedPointerEvent): void => {
    const point = event.getLocalPosition(options.node);
    const record = state.store.read('menu');
    if (record.menuOpen && point.y >= state.height) {
      const index = state.scrollRow + Math.floor((point.y - state.height) / ROW_HEIGHT);
      record.onMenuFocus?.(index);
      record.onMenuSelect?.(index);
      return;
    }
    record.onButtonPointerDown?.(event.button);
  };
  const up = (event: FederatedPointerEvent): void => { state.store.read('menu').onButtonPointerUp?.(event.button); };
  const upOutside = (event: FederatedPointerEvent): void => { state.store.read('menu').onButtonPointerOutside?.(event.button); };
  const move = (event: FederatedPointerEvent): void => {
    const point = event.getLocalPosition(options.node);
    if (state.store.read('menu').menuOpen !== true || point.y < state.height) return;
    const index = state.scrollRow + Math.floor((point.y - state.height) / ROW_HEIGHT);
    const items = state.store.read('menu').menuItems ?? [];
    if (index >= 0 && index < items.length && !items[index]!.separator) state.store.read('menu').onMenuFocus?.(index);
  };
  const out = (): void => { if (state.store.read('menu').menuOpen === true) state.store.read('menu').onMenuFocus?.(-1); };
  state.pointerDown = down;
  state.pointerMove = move;
  state.pointerOut = out;
  state.pointerUp = up;
  state.pointerUpOutside = upOutside;
  options.node.on('pointerdown', down);
  options.node.on('pointermove', move);
  options.node.on('pointerout', out);
  options.node.on('pointerup', up);
  options.node.on('pointerupoutside', upOutside);
  draw(options.node);
  return menu as unknown as GodotCanvasMenuButton;
}

/** Runtime MenuButton constructor with its real retained PopupMenu child state. */
export function createGodotCanvasMenuButton(godotMajor: 3 | 4): GodotCanvasMenuButton {
  const node = new Container();
  registerGodotObjectIdentity(node, 'MenuButton');
  return bindCanvasMenuButton({
    node,
    width: 120,
    height: 28,
    text: '',
    switchOnHover: false,
    disableShortcuts: false,
    items: [],
    godotMajor,
  });
}

export function bindCanvasPopupMenu(options: CanvasMenuOptions): GodotCanvasPopupMenu {
  const state = prepare(options, 'popup-menu');
  const popup = bindPopupMenu(options.node as unknown as GodotControl, options.node, {
    ...(options.items === undefined ? {} : { items: options.items }),
    ...(options.godotMajor === undefined ? {} : { godotMajor: options.godotMajor }),
    ...(options.hideOnItemSelection === undefined ? {} : { hideOnItemSelection: options.hideOnItemSelection }),
    ...(options.hideOnCheckableItemSelection === undefined ? {} : { hideOnCheckableItemSelection: options.hideOnCheckableItemSelection }),
    ...(options.hideOnMultistateItemSelection === undefined ? {} : { hideOnMultistateItemSelection: options.hideOnMultistateItemSelection }),
  });
  installMenuNavigation(options.node, state);
  const down = (event: FederatedPointerEvent): void => {
    const index = state.scrollRow + Math.floor(event.getLocalPosition(options.node).y / ROW_HEIGHT);
    state.store.read('menu').onMenuFocus?.(index);
    state.store.read('menu').onMenuSelect?.(index);
  };
  const move = (event: FederatedPointerEvent): void => {
    const index = state.scrollRow + Math.floor(event.getLocalPosition(options.node).y / ROW_HEIGHT);
    const items = state.store.read('menu').menuItems ?? [];
    if (index >= 0 && index < items.length && !items[index]!.separator) state.store.read('menu').onMenuFocus?.(index);
  };
  const out = (): void => { state.store.read('menu').onMenuFocus?.(-1); };
  state.pointerDown = down;
  state.pointerMove = move;
  state.pointerOut = out;
  state.closeRequest = (event: FederatedPointerEvent): void => {
    if (state.store.read('menu').menuOpen !== true) return;
    const bounds = options.node.getBounds();
    if (
      event.global.x < bounds.left || event.global.x > bounds.right ||
      event.global.y < bounds.top || event.global.y > bounds.bottom
    ) {
      state.store.read('menu').onMenuCloseRequest?.();
    }
  };
  options.node.on('pointerdown', down);
  options.node.on('pointermove', move);
  options.node.on('pointerout', out);
  options.node.on('globalpointerdown', state.closeRequest);
  draw(options.node);
  return popup as unknown as GodotCanvasPopupMenu;
}

export function createGodotCanvasPopupMenu(godotMajor: 3 | 4): GodotCanvasPopupMenu {
  const node = new Container();
  registerGodotObjectIdentity(node, 'PopupMenu');
  return bindCanvasPopupMenu({ node, width: 160, height: 24, items: [], godotMajor });
}

export function resizeCanvasMenu(node: Container, size: ControlPoint): void {
  const state = stateOf(node);
  state.width = dimension('Canvas menu width', size.x);
  state.height = dimension('Canvas menu height', size.y);
  draw(node);
}

export function releaseCanvasMenu(node: Container): void {
  const state = MENUS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  node.off('pointerdown', state.pointerDown);
  node.off('pointermove', state.pointerMove);
  node.off('pointerout', state.pointerOut);
  node.off('pointerup', state.pointerUp);
  node.off('pointerupoutside', state.pointerUpOutside);
  node.off('globalpointerdown', state.closeRequest);
  node.off('wheel', state.wheel);
  if (typeof window !== 'undefined') window.removeEventListener('keydown', state.keyDown);
  releaseMenuControl(node);
  clearLabels(state);
  state.background.removeFromParent();
  state.background.destroy();
  MENUS.delete(node);
}
