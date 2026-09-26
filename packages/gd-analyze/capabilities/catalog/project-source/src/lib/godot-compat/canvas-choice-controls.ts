/** Retained Pixi presentations for Godot OptionButton and ItemList. */

import { Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';

import {
  bindItemList,
  bindOptionButton,
  ITEM_LIST_ROW_HEIGHT,
  releaseChoiceControl,
  resizeItemListViewport,
  type AuthoredChoiceItem,
  type GodotItemList,
  type GodotOptionButton,
} from './choice-controls';
import {
  createControlState,
  registerControlBinding,
  type ControlChoiceItem,
  type ControlPoint,
  type ControlRecord,
  type ControlState,
  type GodotControl,
} from './control-state';
import { bindGodotCanvasItemApi, markInternalCanvasChild, registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import { registerGodotObjectIdentity } from './object';
import { bindCanvasRange, releaseCanvasRange, resizeCanvasRange, type GodotCanvasRange } from './canvas-range';
import { releaseCanvasItemMaterial } from './canvas-item-material';

export interface CanvasChoiceOptions {
  readonly node: Container;
  readonly width: number;
  readonly height: number;
  readonly multiple?: boolean;
  readonly allowReselect?: boolean;
  readonly items?: readonly AuthoredChoiceItem[];
  readonly selected?: number | readonly number[];
  readonly godotMajor?: 3 | 4;
}

export interface GodotCanvasOptionButton extends GodotCanvasItem, Omit<GodotOptionButton, keyof GodotControl> {}
export interface GodotCanvasItemList extends GodotCanvasItem, Omit<GodotItemList, keyof GodotControl> {}

interface CanvasChoiceState {
  readonly node: Container;
  readonly background: Graphics;
  readonly labels: Text[];
  readonly icons: Sprite[];
  readonly store: ControlState;
  pointerTap: (event: FederatedPointerEvent) => void;
  wheel: (event: FederatedWheelEvent) => void;
  keyDown: (event: KeyboardEvent) => void;
  outsidePointer: (event: FederatedPointerEvent) => void;
  unregisterRelease(): void;
  width: number;
  height: number;
  open: boolean;
  released: boolean;
  kind: 'option' | 'list';
  keyboardFocus: boolean;
  searchBuffer: string;
  searchTime: number;
  selectionAnchor: number;
  scrollBar?: GodotCanvasRange;
}

const CHOICES = new WeakMap<Container, CanvasChoiceState>();

function finiteDimension(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number; received ${String(value)}.`);
  }
  return value;
}

function stateOf(node: Container): CanvasChoiceState {
  const state = CHOICES.get(node);
  if (state === undefined) throw new Error('Retained Pixi choice Control is not bound.');
  return state;
}

function destroyLabels(state: CanvasChoiceState): void {
  for (const label of state.labels.splice(0)) {
    label.removeFromParent();
    label.destroy();
  }
  for (const icon of state.icons.splice(0)) {
    icon.removeFromParent();
    icon.destroy({ texture: false, textureSource: false });
  }
}

function label(state: CanvasChoiceState, text: string, y: number, color = 0xffffff): void {
  const native = markInternalCanvasChild(new Text({
    text,
    x: 8,
    y: y + 3,
    style: { fill: color, fontFamily: 'sans-serif', fontSize: 14 },
  }));
  state.labels.push(native);
  state.node.addChild(native);
}

function itemColor(item: ControlChoiceItem): number {
  const color = item.customFgColor;
  if (color === undefined) return item.disabled || !item.selectable ? 0x777777 : 0xffffff;
  return (Math.round(Math.max(0, Math.min(1, color.r)) * 255) << 16)
    | (Math.round(Math.max(0, Math.min(1, color.g)) * 255) << 8)
    | Math.round(Math.max(0, Math.min(1, color.b)) * 255);
}

function itemLabel(state: CanvasChoiceState, item: ControlChoiceItem, y: number): void {
  let x = 8;
  if (item.icon instanceof Texture) {
    const icon = markInternalCanvasChild(new Sprite(item.icon));
    const scale = Math.min(1, 18 / Math.max(1, icon.width), 18 / Math.max(1, icon.height));
    icon.scale.set(scale);
    icon.position.set(x, y + 2);
    state.icons.push(icon);
    state.node.addChild(icon);
    x += icon.width + 5;
  }
  const native = markInternalCanvasChild(new Text({
    text: item.text,
    x,
    y: y + 3,
    style: { fill: itemColor(item), fontFamily: 'sans-serif', fontSize: 14 },
  }));
  state.labels.push(native);
  state.node.addChild(native);
}

function draw(node: Container): void {
  const state = stateOf(node);
  const record = state.store.read('choice');
  const items = record.choiceItems ?? [];
  destroyLabels(state);
  state.background.clear();
  if (state.kind === 'option') {
    state.background.rect(0, 0, state.width, state.height).fill({ color: 0x20242b });
    state.background.rect(0, 0, state.width, state.height).stroke({ color: 0x8a9099, width: 1 });
    const selected = record.choiceSelected ?? -1;
    const selectedItem = selected >= 0 ? items[selected] : undefined;
    if (selectedItem !== undefined) itemLabel(state, selectedItem, 0);
    const arrow = markInternalCanvasChild(new Text({
      text: '▼',
      x: Math.max(0, state.width - 20),
      y: 4,
      style: { fill: 0xffffff, fontFamily: 'sans-serif', fontSize: 12 },
    }));
    state.labels.push(arrow);
    node.addChild(arrow);
    if (!state.open) return;
    items.forEach((item, index) => {
      const top = state.height + index * ITEM_LIST_ROW_HEIGHT;
      state.background.rect(0, top, state.width, ITEM_LIST_ROW_HEIGHT).fill({
        color: item.selected ? 0x365a8c : 0x20242b,
      });
      state.background.rect(0, top, state.width, ITEM_LIST_ROW_HEIGHT).stroke({ color: 0x666b73, width: 1 });
      if (item.separator) label(state, `── ${item.text}`, top, itemColor(item));
      else itemLabel(state, item, top);
    });
    return;
  }
  state.background.rect(0, 0, state.width, state.height).fill({ color: 0x15191f });
  state.background.rect(0, 0, state.width, state.height).stroke({ color: 0x676d76, width: 1 });
  const scrollOffset = record.choiceScrollOffset ?? 0;
  items.forEach((item, index) => {
    const top = index * ITEM_LIST_ROW_HEIGHT - scrollOffset;
    if (top + ITEM_LIST_ROW_HEIGHT <= 0) return;
    if (top >= state.height) return;
    if (item.selected) {
      state.background.rect(1, top + 1, Math.max(0, state.width - 2), ITEM_LIST_ROW_HEIGHT - 2).fill({ color: 0x365a8c });
    }
    itemLabel(state, item, top);
  });
  // Labels are recreated on every ItemList draw. Keep the retained native
  // scrollbar above them without replacing its identity or material state.
  if (state.scrollBar !== undefined) node.addChild(state.scrollBar);
}

function projectedStore(node: Container): ControlState {
  const base = createControlState();
  return {
    read: (id) => base.read(id),
    write(id: string, patch: ControlRecord): void {
      base.write(id, patch);
      if (CHOICES.has(node)) draw(node);
    },
    register: (id, authored) => base.register(id, authored),
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
    clear(): void { base.clear(); },
    snapshot: () => base.snapshot(),
  };
}

function bind(
  options: CanvasChoiceOptions,
  kind: 'option' | 'list',
): GodotCanvasOptionButton | GodotCanvasItemList {
  releaseCanvasChoice(options.node);
  const node = options.node;
  bindGodotCanvasItemApi(node);
  const background = markInternalCanvasChild(new Graphics());
  node.addChild(background);
  const store = projectedStore(node);
  const state: CanvasChoiceState = {
    node,
    background,
    labels: [],
    icons: [],
    store,
    width: finiteDimension('Choice Control width', options.width),
    height: finiteDimension('Choice Control height', options.height),
    open: false,
    released: false,
    kind,
    unregisterRelease: () => {},
    pointerTap: () => {},
    wheel: () => {},
    keyDown: () => {},
    outsidePointer: () => {},
    keyboardFocus: false,
    searchBuffer: '',
    searchTime: 0,
    selectionAnchor: -1,
  };
  CHOICES.set(node, state);
  registerControlBinding(node as unknown as GodotControl, { id: 'choice', state: store });
  let itemList: GodotItemList | undefined;
  let optionButton: GodotOptionButton | undefined;
  if (kind === 'option') optionButton = bindOptionButton(node as unknown as GodotControl, {
    ...(options.items === undefined ? {} : { items: options.items }),
    ...(typeof options.selected === 'number' ? { selected: options.selected } : {}),
  });
  else {
    itemList = bindItemList(node as unknown as GodotControl, {
      multiple: options.multiple ?? false,
      allowReselect: options.allowReselect ?? false,
      ...(options.items === undefined ? {} : { items: options.items }),
      ...(options.selected === undefined || typeof options.selected === 'number' ? {} : { selected: options.selected }),
      vScrollBar: (() => {
        const scrollNode = markInternalCanvasChild(new Container());
        scrollNode.position.set(Math.max(0, state.width - 12), 0);
        node.addChild(scrollNode);
        registerGodotObjectIdentity(scrollNode, 'VScrollBar');
        const scrollBar = bindCanvasRange({
          node: scrollNode,
          godotMajor: options.godotMajor ?? 4,
          width: 12,
          height: state.height,
          minValue: 0,
          maxValue: 0,
          step: 1,
          page: 0,
          value: 0,
          vertical: true,
          customStep: -1,
        });
        state.scrollBar = scrollBar;
        return scrollBar;
      })(),
    });
    resizeItemListViewport(node as unknown as GodotControl, state.height);
  }
  const pointerTap = (event: FederatedPointerEvent): void => {
    state.keyboardFocus = true;
    const record = state.store.read('choice');
    const point = event.getLocalPosition(node);
    if (state.kind === 'option') {
      if (!state.open) {
        state.open = true;
        draw(node);
        return;
      }
      const index = Math.floor((point.y - state.height) / ITEM_LIST_ROW_HEIGHT);
      if (index >= 0 && index < (record.choiceItems?.length ?? 0)) {
        record.onChoiceSelect?.([index]);
      }
      state.open = false;
      draw(node);
      return;
    }
    const index = Math.floor((point.y + (record.choiceScrollOffset ?? 0)) / ITEM_LIST_ROW_HEIGHT);
    if (index < 0 || index >= (record.choiceItems?.length ?? 0)) return;
    if (record.choiceMultiple) {
      const items = record.choiceItems ?? [];
      const selectable = (itemIndex: number): boolean => {
        const item = items[itemIndex];
        return item !== undefined && item.selectable && !item.disabled && !item.separator;
      };
      if (!selectable(index)) return;
      let selected: number[];
      if (event.shiftKey && state.selectionAnchor >= 0) {
        const from = Math.min(state.selectionAnchor, index);
        const to = Math.max(state.selectionAnchor, index);
        selected = [];
        for (let itemIndex = from; itemIndex <= to; itemIndex += 1) {
          if (selectable(itemIndex)) selected.push(itemIndex);
        }
        if (event.ctrlKey || event.metaKey) {
          for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            if (items[itemIndex]?.selected && !selected.includes(itemIndex)) selected.push(itemIndex);
          }
        }
      } else if (event.ctrlKey || event.metaKey) {
        selected = items.flatMap((item, itemIndex) =>
          itemIndex === index ? (item.selected ? [] : [itemIndex]) : item.selected ? [itemIndex] : [],
        );
        state.selectionAnchor = index;
      } else {
        selected = [index];
        state.selectionAnchor = index;
      }
      record.onChoiceSelect?.(selected);
    } else {
      record.onChoiceSelect?.([index]);
      state.selectionAnchor = index;
    }
    const button = event.button === 0 ? 1 : event.button === 1 ? 3 : event.button === 2 ? 2 : event.button + 1;
    record.onChoiceClick?.(index, { x: point.x, y: point.y }, button);
  };
  state.pointerTap = pointerTap;
  state.wheel = (event): void => {
    if (state.kind !== 'list' || state.scrollBar === undefined || !state.scrollBar.visible) return;
    const previous = state.scrollBar.value;
    state.scrollBar.value = previous + event.deltaY;
    if (state.scrollBar.value === previous) return;
    event.preventDefault();
    event.stopPropagation();
  };
  state.outsidePointer = (event): void => {
    if (!state.keyboardFocus) return;
    const bounds = node.getBounds();
    if (event.global.x < bounds.left || event.global.x > bounds.right || event.global.y < bounds.top || event.global.y > bounds.bottom) {
      state.keyboardFocus = false;
      state.searchBuffer = '';
    }
  };
  state.keyDown = (event): void => {
    if (!state.keyboardFocus) return;
    const items = state.store.read('choice').choiceItems ?? [];
    if (items.length === 0) return;
    if (state.kind === 'option' && optionButton !== undefined) {
      const selectable = (index: number): boolean => {
        const item = items[index];
        return item !== undefined && !item.disabled && item.selectable && !item.separator;
      };
      const seek = (start: number, direction: -1 | 1): number => {
        let index = start;
        for (let attempt = 0; attempt < items.length; attempt += 1) {
          index = (index + direction + items.length) % items.length;
          if (selectable(index)) return index;
        }
        return -1;
      };
      let handled = true;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        const index = seek(optionButton.get_selected(), 1);
        if (index >= 0) optionButton.select(index);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        const index = seek(optionButton.get_selected() < 0 ? 0 : optionButton.get_selected(), -1);
        if (index >= 0) optionButton.select(index);
      } else if (event.key === 'Home') {
        const index = items.findIndex((_item, itemIndex) => selectable(itemIndex));
        if (index >= 0) optionButton.select(index);
      } else if (event.key === 'End') {
        for (let index = items.length - 1; index >= 0; index -= 1) if (selectable(index)) { optionButton.select(index); break; }
      } else if (event.key === 'Enter' || event.key === ' ') {
        state.open = !state.open;
        draw(node);
      } else if (event.key === 'Escape') {
        state.open = false;
        draw(node);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        state.searchBuffer = now - state.searchTime > 1000 ? event.key : state.searchBuffer + event.key;
        state.searchTime = now;
        const query = state.searchBuffer.toLocaleLowerCase();
        const index = items.findIndex((item, itemIndex) => selectable(itemIndex) && item.text.toLocaleLowerCase().startsWith(query));
        if (index >= 0) optionButton.select(index);
      } else handled = false;
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (state.kind !== 'list' || itemList === undefined) return;
    const selectable = (index: number): boolean => {
      const item = items[index];
      return item !== undefined && !item.disabled && item.selectable && !item.separator;
    };
    const seek = (start: number, direction: -1 | 1, stride = 1): number => {
      let index = start;
      for (let attempt = 0; attempt < items.length; attempt += 1) {
        index += direction * stride;
        if (itemList!.wraparound_items) index = (index % items.length + items.length) % items.length;
        if (index < 0 || index >= items.length) return -1;
        if (selectable(index)) return index;
      }
      return -1;
    };
    const choose = (index: number, extend = false): void => {
      if (!selectable(index)) return;
      itemList!.set_current(index);
      if (extend && itemList!.select_mode === 1) {
        if (state.selectionAnchor < 0) state.selectionAnchor = current >= 0 ? current : index;
        itemList!.deselect_all();
        const from = Math.min(state.selectionAnchor, index);
        const to = Math.max(state.selectionAnchor, index);
        for (let itemIndex = from; itemIndex <= to; itemIndex += 1) {
          if (selectable(itemIndex)) itemList!.select(itemIndex, false);
        }
      } else {
        itemList!.select(index, true);
        state.selectionAnchor = index;
      }
      itemList!.ensure_current_is_visible();
    };
    const current = itemList.get_current();
    const columns = Math.max(1, itemList.max_columns || 1);
    let handled = true;
    if (event.key === 'ArrowDown') { const index = seek(current < 0 ? -1 : current, 1, columns); if (index >= 0) choose(index, event.shiftKey); }
    else if (event.key === 'ArrowUp') { const index = seek(current < 0 ? items.length : current, -1, columns); if (index >= 0) choose(index, event.shiftKey); }
    else if (event.key === 'ArrowRight') { const index = seek(current < 0 ? -1 : current, 1); if (index >= 0) choose(index, event.shiftKey); }
    else if (event.key === 'ArrowLeft') { const index = seek(current < 0 ? items.length : current, -1); if (index >= 0) choose(index, event.shiftKey); }
    else if (event.key === 'Home') { const index = items.findIndex((_item, index) => selectable(index)); if (index >= 0) choose(index, event.shiftKey); }
    else if (event.key === 'End') { for (let index = items.length - 1; index >= 0; index -= 1) if (selectable(index)) { choose(index, event.shiftKey); break; } }
    else if (event.key === 'Enter') { if (current >= 0) itemList.activate_item(current); }
    else if (event.key === ' ' && current >= 0) {
      if (itemList.select_mode === 1 && itemList.is_selected(current)) itemList.deselect(current);
      else choose(current, itemList.select_mode === 1);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && itemList.select_mode === 1) {
      itemList.deselect_all();
      for (let index = 0; index < items.length; index += 1) if (selectable(index)) itemList.select(index, false);
    } else if (itemList.allow_search && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      state.searchBuffer = now - state.searchTime > 1000 ? event.key : state.searchBuffer + event.key;
      state.searchTime = now;
      const query = state.searchBuffer.toLocaleLowerCase();
      const index = items.findIndex((item, itemIndex) => selectable(itemIndex) && item.text.toLocaleLowerCase().startsWith(query));
      if (index >= 0) choose(index);
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };
  node.eventMode = 'static';
  node.cursor = 'pointer';
  node.on('pointertap', pointerTap);
  node.on('wheel', state.wheel);
  node.on('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseCanvasChoice(node));
  draw(node);
  return node as GodotCanvasOptionButton | GodotCanvasItemList;
}

export function bindCanvasOptionButton(options: CanvasChoiceOptions): GodotCanvasOptionButton {
  return bind(options, 'option') as GodotCanvasOptionButton;
}

export function createGodotCanvasOptionButton(): GodotCanvasOptionButton {
  const node = new Container();
  registerGodotObjectIdentity(node, 'OptionButton');
  return bindCanvasOptionButton({ node, width: 120, height: 28, items: [] });
}

export function bindCanvasItemList(options: CanvasChoiceOptions): GodotCanvasItemList {
  return bind(options, 'list') as GodotCanvasItemList;
}

/** Runtime ItemList constructor on the same retained Pixi list renderer as authored controls. */
export function createGodotCanvasItemList(godotMajor: 3 | 4 = 4): GodotCanvasItemList {
  const node = new Container();
  registerGodotObjectIdentity(node, 'ItemList');
  return bindCanvasItemList({
    node,
    width: 120,
    height: 0,
    multiple: false,
    allowReselect: false,
    items: [],
    selected: [],
    godotMajor,
  });
}

export function resizeCanvasChoice(node: Container, size: ControlPoint): void {
  const state = stateOf(node);
  state.width = finiteDimension('Choice Control width', size.x);
  state.height = finiteDimension('Choice Control height', size.y);
  if (state.scrollBar !== undefined) {
    state.scrollBar.position.set(Math.max(0, state.width - 12), 0);
    resizeCanvasRange(state.scrollBar, 12, state.height);
    resizeItemListViewport(node as unknown as GodotControl, state.height);
    return;
  }
  draw(node);
}

export function releaseCanvasChoice(node: Container): void {
  const state = CHOICES.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  node.off('pointertap', state.pointerTap);
  node.off('wheel', state.wheel);
  node.off('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.removeEventListener('keydown', state.keyDown);
  destroyLabels(state);
  if (state.scrollBar !== undefined) {
    releaseCanvasItemMaterial(state.scrollBar);
    releaseCanvasRange(state.scrollBar);
    state.scrollBar.removeFromParent();
    state.scrollBar.destroy({ children: true });
  }
  state.background.removeFromParent();
  state.background.destroy();
  releaseChoiceControl(node);
  CHOICES.delete(node);
}
