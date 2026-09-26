/** Pixi-native presentation for retained advanced Godot Controls. */

import { Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';

import {
  bindAcceptDialog,
  bindFileDialog,
  bindSpinBox,
  bindTabContainer,
  bindTree,
  type GodotAcceptDialog,
  type GodotFileDialog,
  type GodotSpinBox,
  type GodotTabContainer,
  type GodotTree,
  type GodotTreeItem,
} from './advanced-controls';
import {
  createControlState,
  registerControlBinding,
  type ControlPoint,
  type ControlRecord,
  type ControlState,
  type GodotControl,
} from './control-state';
import { markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { setCanvasControlPosition, setCanvasControlSize } from './canvas-control-state';
import { bindControlLayoutDirectionChanged, getControlCombinedMinimumSize, isControlLayoutRtl } from './control-layout';
import { registerGodotObjectIdentity } from './object';
import { bindCanvasBaseButton, releaseCanvasBaseButton, type GodotCanvasBaseButton } from './canvas-button';
import { bindTabBar, type GodotTabBar } from './tab-bar';
import { bindPopupControl, type GodotPopupControl, type PopupRect } from './popup-control';
import { bindWindowControl, type GodotWindowControl } from './window-control';

export type CanvasAdvancedKind = 'spin-box' | 'tab-bar' | 'tab-container' | 'popup' | 'popup-dialog' | 'window' | 'window-dialog' | 'accept-dialog' | 'confirmation-dialog' | 'file-dialog' | 'tree';

export interface CanvasAdvancedOptions {
  readonly node: Container;
  readonly kind: CanvasAdvancedKind;
  readonly width: number;
  readonly height: number;
  readonly viewportSize?: () => ControlPoint;
  readonly title?: string;
}

export interface GodotCanvasSpinBox extends Container, Omit<GodotSpinBox, keyof GodotControl> {}
export interface GodotCanvasTabContainer extends Container, Omit<GodotTabContainer<GodotCanvasTabBar>, keyof GodotControl> {}
export interface GodotCanvasTabBar extends Container, Omit<GodotTabBar, keyof GodotControl> {}
export interface GodotCanvasDialog extends Container, Omit<GodotAcceptDialog, keyof GodotControl> {}
export interface GodotCanvasPopup extends Container, Omit<GodotPopupControl, keyof GodotControl> {}
export type GodotCanvasWindow = Container & GodotWindowControl;
export interface GodotCanvasPopupDialog extends Container, Omit<GodotPopupControl, keyof GodotControl> {
  popup(bounds?: PopupRect): void;
  set_as_minsize(): void;
  popup_centered(size?: ControlPoint): void;
  popup_centered_minsize(minSize?: ControlPoint): void;
  popup_centered_clamped(size?: ControlPoint, fallbackRatio?: number): void;
  popup_centered_ratio(ratio?: number): void;
  popup_exclusive(fromNode?: object): void;
  exclusive: boolean;
  window_title: string;
  get_close_button(): GodotCanvasBaseButton;
}
export type GodotCanvasFileDialog = Container & Omit<GodotFileDialog, keyof GodotControl>;
export type GodotCanvasTree = Container & GodotTree;

interface RenderState {
  readonly background: Graphics;
  readonly labels: Text[];
  readonly icons: Sprite[];
  readonly treeButtonHits: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rowKey: number; readonly column: number; readonly buttonKey: number; readonly disabled: boolean }[];
  readonly treeCellHits: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rowKey: number; readonly column: number }[];
  readonly treeColumnHits: { readonly x: number; readonly width: number; readonly column: number }[];
  readonly store: ControlState;
  readonly kind: CanvasAdvancedKind;
  pointerTap: (event: FederatedPointerEvent) => void;
  pointerDown: (event: FederatedPointerEvent) => void;
  pointerMove: (event: FederatedPointerEvent) => void;
  globalPointerMove: (event: FederatedPointerEvent) => void;
  pointerUp: () => void;
  pointerLeave: () => void;
  outsidePointer: (event: FederatedPointerEvent) => void;
  keyDown: (event: KeyboardEvent) => void;
  wheel: (event: FederatedWheelEvent) => void;
  unregisterRelease(): void;
  releaseLayoutDirection(): void;
  width: number;
  height: number;
  released: boolean;
  keyboardFocus: boolean;
  searchBuffer: string;
  searchTime: number;
  closeButton?: GodotCanvasBaseButton;
}

const ADVANCED = new WeakMap<Container, RenderState>();

function dimension(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative.`);
  return value;
}

function stateOf(node: Container): RenderState {
  const state = ADVANCED.get(node);
  if (state === undefined) throw new Error('Advanced Pixi Control is not bound.');
  return state;
}

function clearLabels(state: RenderState): void {
  for (const label of state.labels.splice(0)) {
    label.removeFromParent();
    label.destroy();
  }
  for (const icon of state.icons.splice(0)) {
    icon.removeFromParent();
    icon.destroy({ texture: false, textureSource: false });
  }
}

function addLabel(node: Container, state: RenderState, value: string, x: number, y: number, color = 0xffffff, alpha = 1): Text {
  const label = markInternalCanvasChild(new Text({
    text: value,
    x,
    y,
    style: { fill: color, fontFamily: 'sans-serif', fontSize: 14 },
  }));
  label.alpha = alpha;
  state.labels.push(label);
  node.addChild(label);
  return label;
}

function addIcon(
  node: Container,
  state: RenderState,
  texture: unknown,
  x: number,
  y: number,
  maxWidth = 0,
  modulate = 0xffffff,
  alpha = 1,
): number {
  if (!(texture instanceof Texture)) return 0;
  const icon = markInternalCanvasChild(new Sprite(texture));
  const naturalWidth = texture.width;
  if (maxWidth > 0 && naturalWidth > maxWidth) {
    const scale = maxWidth / naturalWidth;
    icon.scale.set(scale);
  }
  icon.position.set(x, y);
  icon.tint = modulate;
  icon.alpha = alpha;
  state.icons.push(icon);
  node.addChild(icon);
  return icon.width;
}

function iconSize(texture: unknown, maxWidth = 0): ControlPoint {
  if (!(texture instanceof Texture)) return { x: 0, y: 0 };
  const scale = maxWidth > 0 && texture.width > maxWidth ? maxWidth / texture.width : 1;
  return { x: texture.width * scale, y: texture.height * scale };
}

function openFilePicker(record: ControlRecord): void {
  if (typeof document === 'undefined' || document.body === null) {
    throw new Error('FileDialog file selection requires a browser document and a user gesture.');
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = record.fileAccept ?? '';
  if (record.fileDirectoryMode === true) input.webkitdirectory = true;
  input.style.display = 'none';
  const release = (): void => input.remove();
  input.addEventListener('change', () => {
    const selected = input.files?.[0];
    if (selected !== undefined) record.onFileSelect?.(selected.webkitRelativePath || selected.name);
    release();
  }, { once: true });
  input.addEventListener('cancel', release, { once: true });
  document.body.appendChild(input);
  input.click();
}

function tabAtPoint(state: RenderState, point: ControlPoint): number {
  if (point.x < 0 || point.y < 0 || point.y >= 26) return -1;
  const titles = state.store.read('advanced').tabTitles ?? [];
  let cursor = 0;
  for (let index = 0; index < titles.length; index += 1) {
    const width = Math.max(56, (titles[index]?.length ?? 0) * 9 + 20);
    if (point.x >= cursor && point.x < cursor + width) return index;
    cursor += width;
  }
  return -1;
}

function draw(node: Container): void {
  const state = stateOf(node);
  const record = state.store.read('advanced');
  state.treeButtonHits.length = 0;
  state.treeCellHits.length = 0;
  state.treeColumnHits.length = 0;
  clearLabels(state);
  state.background.clear();
  const transparentWindow = state.kind === 'window' && record.windowTransparentBackground === true;
  state.background.rect(0, 0, state.width, state.height).fill({ color: 0x171a20, alpha: transparentWindow ? 0 : 1 });
  state.background.rect(0, 0, state.width, state.height).stroke({ color: 0x737983, width: 1 });
  if (state.kind === 'spin-box') {
    const value = record.rangeValue ?? 0;
    const label = addLabel(node, state, `${record.spinPrefix ?? ''}${String(value)}${record.spinSuffix ?? ''}`, 8, 4);
    const textWidth = Math.max(0, state.width - 36);
    const alignment = record.spinAlign ?? 0;
    const startIsRight = isControlLayoutRtl(node);
    label.x = alignment === 1
      ? 8 + Math.max(0, (textWidth - label.width) / 2)
      : (alignment === 2) !== startIsRight
        ? 8 + Math.max(0, textWidth - label.width)
        : 8;
    addLabel(node, state, '▲', Math.max(0, state.width - 20), 0);
    addLabel(node, state, '▼', Math.max(0, state.width - 20), Math.max(10, state.height / 2));
    return;
  }
  if (state.kind === 'tab-bar') {
    const titles = record.tabTitles ?? [];
    let x = 0;
    titles.forEach((title, index) => {
      const width = Math.max(56, title.length * 9 + 20);
      state.background.rect(x, 0, width, 26).fill({ color: index === record.tabCurrent ? 0x365a8c : 0x252a32 });
      addLabel(node, state, title, x + 8, 4, record.tabDisabled?.[index] ? 0x777777 : 0xffffff);
      const showClose = record.tabCloseDisplayPolicy === 2 ||
        (record.tabCloseDisplayPolicy === 1 && index === record.tabCurrent);
      if (showClose) addLabel(node, state, '×', x + width - 16, 4, 0xc9d2df);
      x += width;
    });
    return;
  }
  if (state.kind === 'popup-dialog' || state.kind === 'window' || state.kind === 'window-dialog' || state.kind === 'accept-dialog' || state.kind === 'confirmation-dialog' || state.kind === 'file-dialog') {
    const titleOffset = state.kind === 'window' || state.kind === 'window-dialog' ? 24 : 0;
    if (state.kind === 'window' || state.kind === 'window-dialog') {
      addLabel(node, state, record.windowTitle ?? '', 10, 2, 0xffffff);
      if (state.closeButton !== undefined) state.closeButton.position.set(Math.max(0, state.width - 22), 2);
    }
    addLabel(node, state, record.dialogText ?? '', 12, 12 + titleOffset);
    const buttons = record.dialogButtons ?? [];
    buttons.forEach((title, index) => {
      const x = 12 + index * 84;
      const y = Math.max(12, state.height - 30);
      state.background.roundRect(x, y, 76, 24, 4).fill({ color: record.dialogFocusedButton === index ? 0x365a8c : 0x252a32 });
      state.background.roundRect(x, y, 76, 24, 4).stroke({ color: 0x737983, width: 1 });
      addLabel(node, state, title, x + 8, y + 2);
    });
    if (state.kind === 'file-dialog') {
      addLabel(node, state, record.fileCurrentDir ?? 'res://', 12, 42, 0xc9d2df);
      addLabel(node, state, record.fileCurrentFile || 'Choose file…', 12, 64, 0x9fc5ff);
    }
    return;
  }
  const rows = record.treeRows ?? [];
  const columnCount = record.treeColumns ?? 1;
  const minimumWidths = Array.from({ length: columnCount }, (_, column) => {
    const authoredMinimum = Math.max(record.treeColumnMinimumWidth?.[column] ?? 0, 24);
    if (record.treeColumnClipContent?.[column]) return authoredMinimum;
    return Math.max(
      authoredMinimum,
      (record.treeColumnTitles?.[column]?.length ?? 0) * 8 + 12,
      ...rows.map((row) => {
        const cell = row.cells[column];
        if (cell === undefined) return 0;
        const iconWidth = iconSize(cell.iconTexture, cell.iconMaxWidth).x;
        return (column === 0 ? row.depth * 16 : 0) + iconWidth + cell.text.length * 8 + cell.buttons.length * 20 + 12;
      }),
    );
  });
  const expanded = minimumWidths.map((_, column) => record.treeColumnExpand?.[column] !== false);
  const spare = Math.max(0, state.width - minimumWidths.reduce((sum, width) => sum + width, 0));
  const expandWeight = expanded.reduce((sum, value, column) =>
    sum + (value ? Math.max(0, record.treeColumnExpandRatio?.[column] ?? 1) : 0), 0);
  const widths = minimumWidths.map((width, column) => width + (
    expanded[column] && expandWeight > 0
      ? spare * Math.max(0, record.treeColumnExpandRatio?.[column] ?? 1) / expandWeight
      : 0
  ));
  const treeScroll = record.treeScroll ?? { x: 0, y: 0 };
  let treeY = (record.treeColumnTitlesVisible ? 24 : 0) - treeScroll.y;
  if (record.treeColumnTitlesVisible) {
    let titleX = 0;
    for (let column = 0; column < columnCount; column += 1) {
      const width = widths[column] ?? 0;
      const authoredTitle = record.treeColumnTitles?.[column] ?? '';
      const title = record.treeColumnClipContent?.[column]
        ? authoredTitle.slice(0, Math.max(0, Math.floor((width - 12) / 8)))
        : authoredTitle;
      const alignment = record.treeColumnTitleAlignment?.[column] ?? 0;
      state.background.rect(titleX, 0, width, 24).fill({ color: 0x252a32 }).stroke({ color: 0x4e5662, width: 1 });
      state.treeColumnHits.push({ x: titleX, width, column });
      const textWidth = title.length * 8;
      const x = alignment === 1 ? titleX + (width - textWidth) / 2 : alignment === 2 ? titleX + width - textWidth - 6 : titleX + 6;
      addLabel(node, state, title, Math.max(titleX + 2, x), 2, 0xdfe5ef);
      titleX += width;
    }
  }
  rows.forEach((row) => {
    const rowHeight = Math.max(22, ...row.cells.map((cell) => Math.max(
      iconSize(cell.iconTexture, cell.iconMaxWidth).y + 4,
      ...cell.buttons.map((button) => iconSize(button.iconTexture, 16).y + 4),
    )));
    const y = treeY;
    treeY += rowHeight;
    if (y >= state.height) return;
    let columnX = 4 - treeScroll.x;
    if (record.treeHoveredRowKey === row.key && !row.selected) {
      state.background.rect(1, y + 1, Math.max(0, state.width - 2), rowHeight - 2).fill({ color: 0x2b3747, alpha: 0.9 });
    }
    row.cells.forEach((cell, column) => {
      const cellWidth = widths[column] ?? 0;
      state.treeCellHits.push({ x: columnX, y, width: cellWidth, height: rowHeight, rowKey: row.key, column });
      if (row.selectedColumns?.includes(column)) {
        state.background.rect(columnX + 1, y + 1, Math.max(0, cellWidth - 2), rowHeight - 2).fill({ color: 0x365a8c });
      }
      if (cell.customBackgroundColor !== undefined) {
        const background = state.background.rect(columnX + 1, y + 1, Math.max(0, cellWidth - 2), rowHeight - 2);
        const paint = cell.customBackgroundAlpha === undefined
          ? { color: cell.customBackgroundColor }
          : { color: cell.customBackgroundColor, alpha: cell.customBackgroundAlpha };
        if (cell.customBackgroundOutline) background.stroke({ ...paint, width: 1 });
        else background.fill(paint);
      }
      let x = columnX + (column === 0 ? row.depth * 16 : 0) + 4;
      x += addIcon(node, state, cell.iconTexture, x, y + 2, cell.iconMaxWidth, cell.iconModulate, cell.iconModulateAlpha) + (cell.iconTexture === undefined ? 0 : 4);
      const displayed = cell.text;
      const available = Math.max(0, cellWidth - (x - columnX) - cell.buttons.length * 20 - 4);
      const clipped = record.treeColumnClipContent?.[column]
        ? displayed.slice(0, Math.max(0, Math.floor(available / 8)))
        : displayed;
      const textWidth = clipped.length * 8;
      const textX = cell.textAlignment === 1
        ? columnX + (cellWidth - textWidth) / 2
        : cell.textAlignment === 2 ? columnX + cellWidth - textWidth - cell.buttons.length * 20 - 4 : x;
      addLabel(node, state, clipped, Math.max(x, textX), y + Math.max(2, (rowHeight - 18) / 2), cell.customColor, cell.customColorAlpha);
      let buttonX = columnX + (widths[column] ?? 0) - cell.buttons.length * 20;
      for (const button of cell.buttons) {
        const buttonY = y + (rowHeight - 18) / 2;
        state.background.roundRect(buttonX, buttonY, 18, 18, 3).fill({ color: button.disabled ? 0x343941 : 0x586273 });
        addIcon(node, state, button.iconTexture, buttonX + 1, buttonY + 1, 16);
        state.treeButtonHits.push({ x: buttonX, y: buttonY, width: 18, height: 18, rowKey: row.key, column, buttonKey: button.key, disabled: button.disabled });
        buttonX += 20;
      }
      columnX += widths[column] ?? 0;
    });
  });
}

function projection(node: Container): ControlState {
  const base = createControlState();
  return {
    read: (id) => base.read(id),
    write(id: string, patch: ControlRecord): void { base.write(id, patch); if (ADVANCED.has(node)) draw(node); },
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
    clear: () => base.clear(),
    snapshot: () => base.snapshot(),
  };
}

function prepare(options: CanvasAdvancedOptions): RenderState {
  releaseCanvasAdvancedControl(options.node);
  const background = markInternalCanvasChild(new Graphics());
  options.node.addChild(background);
  const store = projection(options.node);
  const state: RenderState = {
    background,
    labels: [],
    icons: [],
    treeButtonHits: [],
    treeCellHits: [],
    treeColumnHits: [],
    store,
    kind: options.kind,
    width: dimension('Advanced Control width', options.width),
    height: dimension('Advanced Control height', options.height),
    pointerTap: () => {},
    pointerDown: () => {},
    pointerMove: () => {},
    globalPointerMove: () => {},
    pointerUp: () => {},
    pointerLeave: () => {},
    outsidePointer: () => {},
    keyDown: () => {},
    wheel: () => {},
    unregisterRelease: () => {},
    releaseLayoutDirection: () => {},
    released: false,
    keyboardFocus: false,
    searchBuffer: '',
    searchTime: 0,
  };
  ADVANCED.set(options.node, state);
  registerControlBinding(options.node as unknown as GodotControl, { id: 'advanced', state: store });
  state.releaseLayoutDirection = bindControlLayoutDirectionChanged(options.node, () => draw(options.node));
  state.unregisterRelease = registerCanvasNodeRelease(options.node, () => releaseCanvasAdvancedControl(options.node));
  options.node.eventMode = 'static';
  return state;
}

function listen(node: Container, state: RenderState, callback: (event: FederatedPointerEvent) => void): void {
  state.pointerTap = callback;
  node.on('pointertap', callback);
}

export function bindCanvasSpinBox(
  options: CanvasAdvancedOptions & {
    readonly godotMajor: 3 | 4;
    readonly minValue: number;
    readonly maxValue: number;
    readonly step: number;
    readonly value: number;
    readonly prefix?: string;
    readonly suffix?: string;
    readonly align?: number;
    readonly alignment?: number;
    readonly editable?: boolean;
  },
): GodotCanvasSpinBox {
  const state = prepare({ ...options, kind: 'spin-box' });
  const spin = bindSpinBox(options.node as unknown as GodotControl, {
    godot_major: options.godotMajor,
    min_value: options.minValue,
    max_value: options.maxValue,
    step: options.step,
    value: options.value,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    ...(options.suffix === undefined ? {} : { suffix: options.suffix }),
    ...(options.align === undefined ? {} : { align: options.align }),
    ...(options.alignment === undefined ? {} : { alignment: options.alignment }),
    ...(options.editable === undefined ? {} : { editable: options.editable }),
  });
  listen(options.node, state, (event) => {
    if (!spin.editable) return;
    const point = event.getLocalPosition(options.node);
    if (point.x < state.width - 28) return;
    const arrowStep = spin.custom_arrow_step >= 0 ? spin.custom_arrow_step : spin.step;
    spin.value += point.y < state.height / 2 ? arrowStep : -arrowStep;
  });
  state.wheel = (event) => {
    if (!spin.editable || event.deltaY === 0) return;
    const arrowStep = spin.custom_arrow_step >= 0 ? spin.custom_arrow_step : spin.step;
    const before = spin.value;
    spin.value += event.deltaY < 0 ? arrowStep : -arrowStep;
    if (spin.value !== before) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  options.node.on('wheel', state.wheel);
  draw(options.node);
  return options.node as GodotCanvasSpinBox;
}

/** Runtime SpinBox constructor using the retained native Pixi advanced-control renderer. */
export function createGodotCanvasSpinBox(major: 3 | 4): GodotCanvasSpinBox {
  const node = new Container();
  registerGodotObjectIdentity(node, 'SpinBox');
  return bindCanvasSpinBox({
    node,
    kind: 'spin-box',
    width: 0,
    height: 0,
    godotMajor: major,
    minValue: 0,
    maxValue: 100,
    step: 0.01,
    value: 0,
  });
}

export function bindCanvasTabContainer(
  options: CanvasAdvancedOptions & {
    readonly pages: readonly object[];
    readonly titles: readonly string[];
    readonly current?: number;
    readonly disabled?: readonly boolean[];
  },
): GodotCanvasTabContainer {
  const state = prepare({ ...options, kind: 'tab-container' });
  const tabNode = markInternalCanvasChild(new Container());
  options.node.addChild(tabNode);
  const tabBar = bindCanvasTabBar({
    node: tabNode,
    kind: 'tab-bar',
    width: state.width,
    height: 26,
    titles: options.titles,
    ...(options.current === undefined ? {} : { current: options.current }),
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
  });
  const tabs = bindTabContainer(options.node as unknown as GodotControl, {
    pages: options.pages,
    titles: options.titles,
    tabBar,
    ...(options.current === undefined ? {} : { current: options.current }),
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
  });
  listen(options.node, state, (event) => {
    state.keyboardFocus = true;
    const point = event.getLocalPosition(options.node);
    let cursor = 0;
    for (let index = 0; index < options.titles.length; index += 1) {
      const width = Math.max(56, (options.titles[index]?.length ?? 0) * 9 + 20);
      if (point.x >= cursor && point.x < cursor + width && point.y < 26) { tabs.current_tab = index; break; }
      cursor += width;
    }
  });
  draw(options.node);
  return options.node as GodotCanvasTabContainer;
}

/** Runtime TabContainer constructor with an empty retained page/title set. */
export function createGodotCanvasTabContainer(): GodotCanvasTabContainer {
  const node = new Container();
  registerGodotObjectIdentity(node, 'TabContainer');
  return bindCanvasTabContainer({
    node,
    kind: 'tab-container',
    width: 0,
    height: 0,
    pages: [],
    titles: [],
    current: -1,
    disabled: [],
  });
}

export function bindCanvasTabBar(
  options: CanvasAdvancedOptions & {
    readonly titles?: readonly string[];
    readonly current?: number;
    readonly disabled?: readonly boolean[];
  },
): GodotCanvasTabBar {
  const state = prepare({ ...options, kind: 'tab-bar' });
  bindTabBar(options.node as unknown as GodotControl, {
    ...options,
    hitTest: (point) => tabAtPoint(state, point),
  });
  let draggedTab = -1;
  const pointerDown = (event: FederatedPointerEvent): void => {
    if (!(options.node as GodotCanvasTabBar).drag_to_rearrange_enabled) return;
    draggedTab = tabAtPoint(state, event.getLocalPosition(options.node));
  };
  const pointerUp = (event: FederatedPointerEvent): void => {
    if (draggedTab < 0) return;
    const target = tabAtPoint(state, event.getLocalPosition(options.node));
    if (target >= 0 && target !== draggedTab) (options.node as GodotCanvasTabBar).move_tab(draggedTab, target);
    draggedTab = -1;
  };
  options.node.on('pointerdown', pointerDown);
  options.node.on('pointerup', pointerUp);
  options.node.on('pointerupoutside', () => { draggedTab = -1; });
  let hoveredTab = -1;
  state.pointerMove = (event) => {
    const index = tabAtPoint(state, event.getLocalPosition(options.node));
    if (index === hoveredTab) return;
    hoveredTab = index;
    if (index >= 0) state.store.read('advanced').onTabHover?.(index);
  };
  options.node.on('pointermove', state.pointerMove);
  state.pointerLeave = () => { hoveredTab = -1; };
  options.node.on('pointerleave', state.pointerLeave);
  listen(options.node, state, (event) => {
    state.keyboardFocus = true;
    const point = event.getLocalPosition(options.node);
    const index = tabAtPoint(state, point);
    if (index < 0) return;
    const record = state.store.read('advanced');
    const titles = record.tabTitles ?? [];
    let left = 0;
    for (let cursor = 0; cursor < index; cursor += 1) left += Math.max(56, (titles[cursor]?.length ?? 0) * 9 + 20);
    const width = Math.max(56, (titles[index]?.length ?? 0) * 9 + 20);
    const showClose = record.tabCloseDisplayPolicy === 2 ||
      (record.tabCloseDisplayPolicy === 1 && index === record.tabCurrent);
    if (showClose && point.x >= left + width - 20) record.onTabClose?.(index);
    else record.onTabSelect?.(index);
  });
  state.outsidePointer = (event) => {
    if (!state.keyboardFocus) return;
    const bounds = options.node.getBounds();
    if (event.global.x >= bounds.left && event.global.x <= bounds.right && event.global.y >= bounds.top && event.global.y <= bounds.bottom) return;
    state.keyboardFocus = false;
  };
  state.keyDown = (event) => {
    if (!state.keyboardFocus) return;
    const tabBar = options.node as GodotCanvasTabBar;
    let handled = true;
    if (event.key === 'ArrowLeft') tabBar.select_previous_available();
    else if (event.key === 'ArrowRight') tabBar.select_next_available();
    else if (event.key === 'Home') {
      for (let index = 0; index < tabBar.get_tab_count(); index += 1) if (!tabBar.is_tab_disabled(index) && !tabBar.is_tab_hidden(index)) { tabBar.set_current_tab(index); break; }
    } else if (event.key === 'End') {
      for (let index = tabBar.get_tab_count() - 1; index >= 0; index -= 1) if (!tabBar.is_tab_disabled(index) && !tabBar.is_tab_hidden(index)) { tabBar.set_current_tab(index); break; }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
      const current = tabBar.get_current_tab();
      if (current >= 0) state.store.read('advanced').onTabClose?.(current);
    } else if (event.key === 'Escape' && tabBar.deselect_enabled) tabBar.set_current_tab(-1);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };
  options.node.on('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
  draw(options.node);
  return options.node as GodotCanvasTabBar;
}

export function createGodotCanvasTabBar(): GodotCanvasTabBar {
  const node = new Container();
  registerGodotObjectIdentity(node, 'TabBar');
  return bindCanvasTabBar({ node, kind: 'tab-bar', width: 0, height: 0 });
}

export function bindCanvasDialog(
  options: CanvasAdvancedOptions & { readonly text?: string; readonly autowrap?: boolean },
): GodotCanvasDialog | GodotCanvasFileDialog {
  const state = prepare(options);
  const dialog = options.kind === 'file-dialog'
    ? bindFileDialog(options.node as unknown as GodotControl, {
        popupCentered(requested): void {
          const viewport = options.viewportSize?.();
          if (viewport === undefined) {
            throw new Error('FileDialog requires its owning Viewport dimensions before popup_centered().');
          }
          const size = requested.x === 0 && requested.y === 0
            ? { x: state.width, y: state.height }
            : requested;
          resizeCanvasAdvancedControl(options.node, size);
          setCanvasControlSize(options.node, size);
          setCanvasControlPosition(options.node, {
            x: Math.floor((viewport.x - size.x) / 2),
            y: Math.floor((viewport.y - size.y) / 2),
          });
        },
        popupCenteredRatio(ratio): void {
          const viewport = options.viewportSize?.();
          if (viewport === undefined) {
            throw new Error('FileDialog requires its owning Viewport dimensions before popup_centered_ratio().');
          }
          const size = { x: viewport.x * ratio, y: viewport.y * ratio };
          resizeCanvasAdvancedControl(options.node, size);
          setCanvasControlSize(options.node, size);
          setCanvasControlPosition(options.node, {
            x: (viewport.x - size.x) / 2,
            y: (viewport.y - size.y) / 2,
          });
        },
      })
    : bindAcceptDialog(options.node as unknown as GodotControl, {
        ...(options.text === undefined ? {} : { text: options.text }),
        ...(options.autowrap === undefined ? {} : { autowrap: options.autowrap }),
        confirmation: options.kind === 'confirmation-dialog',
        popupCentered(requested): void {
          const viewport = options.viewportSize?.();
          if (viewport === undefined) {
            throw new Error('AcceptDialog requires its owning Viewport dimensions before popup_centered().');
          }
          const size = requested.x === 0 && requested.y === 0
            ? { x: state.width, y: state.height }
            : requested;
          resizeCanvasAdvancedControl(options.node, size);
          setCanvasControlSize(options.node, size);
          setCanvasControlPosition(options.node, {
            x: Math.floor((viewport.x - size.x) / 2),
            y: Math.floor((viewport.y - size.y) / 2),
          });
        },
      });
  if (options.kind === 'file-dialog' && options.text !== undefined) dialog.dialog_text = options.text;
  listen(options.node, state, (event) => {
    state.keyboardFocus = true;
    const point = event.getLocalPosition(options.node);
    const record = state.store.read('advanced');
    if (options.kind === 'file-dialog' && point.y >= 38 && point.y < Math.min(92, state.height - 40)) {
      openFilePicker(record);
      return;
    }
    if (point.y < state.height - 40) return;
    const index = Math.floor((point.x - 12) / 84);
    record.onDialogButton?.(index);
  });
  state.keyboardFocus = true;
  state.keyDown = (event) => {
    if (!state.keyboardFocus || !options.node.visible) return;
    const record = state.store.read('advanced');
    const buttons = record.dialogButtons ?? [];
    let focused = record.dialogFocusedButton ?? 0;
    if (event.key === 'Tab' || event.key === 'ArrowRight') {
      focused = buttons.length === 0 ? -1 : (focused + 1 + buttons.length) % buttons.length;
      state.store.write('advanced', { dialogFocusedButton: focused });
    } else if (event.key === 'ArrowLeft') {
      focused = buttons.length === 0 ? -1 : (focused - 1 + buttons.length) % buttons.length;
      state.store.write('advanced', { dialogFocusedButton: focused });
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (buttons.length > 0) record.onDialogButton?.(Math.max(0, Math.min(buttons.length - 1, focused)));
      else record.onDialogConfirm?.();
    } else if (event.key === 'Escape') {
      if (record.dialogCloseOnEscape !== false) record.onDialogCancel?.();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
  draw(options.node);
  return options.node as GodotCanvasDialog | GodotCanvasFileDialog;
}

export function createGodotCanvasAcceptDialog(): GodotCanvasDialog {
  const node = new Container();
  registerGodotObjectIdentity(node, 'AcceptDialog');
  return bindCanvasDialog({ node, kind: 'accept-dialog', width: 0, height: 0 }) as GodotCanvasDialog;
}

export function createGodotCanvasConfirmationDialog(): GodotCanvasDialog {
  const node = new Container();
  registerGodotObjectIdentity(node, 'ConfirmationDialog');
  return bindCanvasDialog({ node, kind: 'confirmation-dialog', width: 0, height: 0 }) as GodotCanvasDialog;
}

export function createGodotCanvasFileDialog(viewportSize: () => ControlPoint): GodotCanvasFileDialog {
  const node = new Container();
  registerGodotObjectIdentity(node, 'FileDialog');
  return bindCanvasDialog({ node, kind: 'file-dialog', width: 0, height: 0, viewportSize }) as GodotCanvasFileDialog;
}

/** Godot 4 embedded Window over the retained Pixi Container and its authored children. */
export function bindCanvasWindow(options: Omit<CanvasAdvancedOptions, 'kind'> & {
  readonly initialPosition?: number;
  readonly transparentBackground?: boolean;
  readonly unresizable?: boolean;
}): GodotCanvasWindow {
  const state = prepare({ ...options, kind: 'window' });
  const windowControl = bindWindowControl(options.node as unknown as GodotControl, {
    viewportSize: () => {
      const viewport = options.viewportSize?.();
      if (viewport === undefined) throw new Error('Window requires its owning Viewport dimensions.');
      return viewport;
    },
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.initialPosition === undefined ? {} : { initialPosition: options.initialPosition }),
    ...(options.transparentBackground === undefined ? {} : { transparentBackground: options.transparentBackground }),
    ...(options.unresizable === undefined ? {} : { unresizable: options.unresizable }),
    readSize: () => ({ x: state.width, y: state.height }),
    readPosition: () => ({ x: options.node.position.x, y: options.node.position.y }),
    writeSize: (size) => {
      resizeCanvasAdvancedControl(options.node, size);
      setCanvasControlSize(options.node, size);
    },
    writePosition: (position) => setCanvasControlPosition(options.node, position),
  });
  const closeButton = bindCanvasBaseButton(markInternalCanvasChild(new Text({ text: '×' })), {
    presentation: 'button',
  });
  registerGodotObjectIdentity(closeButton, 'Button');
  options.node.addChild(closeButton);
  state.closeButton = closeButton;
  closeButton.pressed.connect(() => state.store.read('advanced').onWindowCloseRequest?.());
  let dragKind: 'move' | 'resize' | null = null;
  let pointerOrigin: ControlPoint = { x: 0, y: 0 };
  let windowOrigin: ControlPoint = { x: 0, y: 0 };
  let sizeOrigin: ControlPoint = { x: 0, y: 0 };
  state.pointerDown = (event) => {
    if (event.button !== 0) return;
    const local = event.getLocalPosition(options.node);
    const size = windowControl.get_size();
    const resizeEdge = !windowControl.unresizable && (local.x >= size.x - 10 || local.y >= size.y - 10);
    if (!resizeEdge && (local.y < 0 || local.y >= 24 || local.x >= size.x - 30)) return;
    dragKind = resizeEdge ? 'resize' : 'move';
    pointerOrigin = { x: event.global.x, y: event.global.y };
    windowOrigin = windowControl.get_position();
    sizeOrigin = size;
    windowControl.grab_focus();
    event.stopPropagation();
  };
  state.globalPointerMove = (event) => {
    if (dragKind === null) return;
    const delta = { x: Math.round(event.global.x - pointerOrigin.x), y: Math.round(event.global.y - pointerOrigin.y) };
    if (dragKind === 'move') windowControl.set_position({ x: windowOrigin.x + delta.x, y: windowOrigin.y + delta.y });
    else windowControl.set_size({ x: Math.max(1, sizeOrigin.x + delta.x), y: Math.max(1, sizeOrigin.y + delta.y) });
  };
  state.pointerUp = () => { dragKind = null; };
  options.node.on('pointerdown', state.pointerDown);
  options.node.on('globalpointermove', state.globalPointerMove);
  options.node.on('pointerup', state.pointerUp);
  options.node.on('pointerupoutside', state.pointerUp);
  draw(options.node);
  return windowControl as unknown as GodotCanvasWindow;
}

/** Godot 4 Window.new() backed by the same retained embedded-window control as authored nodes. */
export function createGodotCanvasWindow(
  viewportSize: () => ControlPoint,
  options: {
    readonly title?: string;
    readonly initialPosition?: number;
    readonly transparentBackground?: boolean;
    readonly unresizable?: boolean;
    readonly width?: number;
    readonly height?: number;
  } = {},
): GodotCanvasWindow {
  const node = new Container();
  const windowControl = bindCanvasWindow({
    node,
    viewportSize,
    width: options.width ?? 0,
    height: options.height ?? 0,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.initialPosition === undefined ? {} : { initialPosition: options.initialPosition }),
    ...(options.transparentBackground === undefined ? {} : { transparentBackground: options.transparentBackground }),
    ...(options.unresizable === undefined ? {} : { unresizable: options.unresizable }),
  });
  registerGodotObjectIdentity(windowControl, 'Window');
  return windowControl;
}

/** Godot 3 PopupDialog over the retained Pixi Control; popup mutates that same native identity. */
export function bindCanvasPopupDialog(options: CanvasAdvancedOptions): GodotCanvasPopupDialog {
  const state = prepare(options);
  const popup = options.node as GodotCanvasPopupDialog;
  if (options.kind === 'popup') {
    const bound = bindPopupControl(options.node as unknown as GodotControl, {
      viewportSize: () => {
        const viewport = options.viewportSize?.();
        if (viewport === undefined) throw new Error('Popup requires its owning Viewport dimensions.');
        return viewport;
      },
      readSize: () => ({ x: state.width, y: state.height }),
      writeSize: (size) => {
        resizeCanvasAdvancedControl(options.node, size);
        setCanvasControlSize(options.node, size);
      },
      writePosition: (position) => setCanvasControlPosition(options.node, position),
    });
    draw(options.node);
    return bound as unknown as GodotCanvasPopupDialog;
  }
  if (options.kind === 'window-dialog') {
    let title = options.title ?? '';
    const closeButton = bindCanvasBaseButton(markInternalCanvasChild(new Text({ text: '×' })), {
      presentation: 'button',
    });
    registerGodotObjectIdentity(closeButton, 'TextureButton');
    popup.addChild(closeButton);
    state.closeButton = closeButton;
    closeButton.pressed.connect(() => { popup.visible = false; });
    Object.defineProperties(popup, {
      window_title: {
        enumerable: true,
        configurable: true,
        get: () => title,
        set: (value: string) => {
          if (typeof value !== 'string') throw new TypeError('WindowDialog.window_title requires a String.');
          title = value;
          state.store.write('advanced', { windowTitle: title });
        },
      },
    });
    popup.get_close_button = () => closeButton;
    state.store.write('advanced', { windowTitle: title });
  }
  popup.visible = false;
  let exclusive = false;
  Object.defineProperty(popup, 'exclusive', { enumerable: true, configurable: true, get: () => exclusive, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('Popup.exclusive requires bool.'); exclusive = value; } });
  registerGodotObjectIdentity(popup, options.kind === 'window-dialog' ? 'WindowDialog' : 'PopupDialog');
  popup.popup = () => {
    popup.visible = true;
  };
  popup.set_as_minsize = () => {
    const minimum = getControlCombinedMinimumSize(options.node);
    resizeCanvasAdvancedControl(options.node, minimum);
    setCanvasControlSize(options.node, minimum);
  };
  popup.popup_centered = (requested = { x: state.width, y: state.height }) => {
    const viewport = options.viewportSize?.();
    if (viewport === undefined) throw new Error('PopupDialog requires its owning Viewport dimensions before popup_centered().');
    if (![requested.x, requested.y].every(Number.isFinite) || requested.x < 0 || requested.y < 0) {
      throw new RangeError('Popup.popup_centered size must be finite and non-negative.');
    }
    resizeCanvasAdvancedControl(options.node, requested);
    setCanvasControlSize(options.node, requested);
    setCanvasControlPosition(options.node, { x: (viewport.x - requested.x) / 2, y: (viewport.y - requested.y) / 2 });
    popup.visible = true;
  };
  popup.popup_centered_minsize = (requested = { x: 0, y: 0 }) => {
    if (![requested.x, requested.y].every(Number.isFinite)) {
      throw new TypeError('Popup.popup_centered_minsize minsize must be a finite Vector2.');
    }
    const minimum = getControlCombinedMinimumSize(options.node);
    popup.popup_centered({
      x: Math.max(requested.x, minimum.x),
      y: Math.max(requested.y, minimum.y),
    });
  };
  popup.popup_centered_clamped = (requested = { x: state.width, y: state.height }, fallbackRatio = 0.75) => {
    if (!Number.isFinite(fallbackRatio) || fallbackRatio <= 0 || fallbackRatio > 1) {
      throw new RangeError('Popup.popup_centered_clamped fallback_ratio must be in (0, 1].');
    }
    const viewport = options.viewportSize?.();
    if (viewport === undefined) {
      throw new Error('PopupDialog requires its owning Viewport dimensions before popup_centered_clamped().');
    }
    const parentWidth = viewport.x;
    const parentHeight = viewport.y;
    const width = Math.min(requested.x, parentWidth * fallbackRatio);
    const height = Math.min(requested.y, parentHeight * fallbackRatio);
    resizeCanvasAdvancedControl(options.node, { x: width, y: height });
    setCanvasControlSize(options.node, { x: width, y: height });
    setCanvasControlPosition(options.node, {
      x: (parentWidth - width) / 2,
      y: (parentHeight - height) / 2,
    });
    popup.visible = true;
  };
  popup.popup_centered_ratio = (ratio = 0.75) => {
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new RangeError('Popup.popup_centered_ratio ratio must be in (0, 1].');
    const viewport = options.viewportSize?.();
    if (viewport === undefined) throw new Error('Popup.popup_centered_ratio requires the retained parent Viewport dimensions.');
    popup.popup_centered({ x: viewport.x * ratio, y: viewport.y * ratio });
  };
  popup.popup_exclusive = (_fromNode?: object) => { popup.exclusive = true; popup.popup(); };
  draw(options.node);
  return popup;
}

export function createGodotCanvasPopupPanel(viewportSize: () => ControlPoint): GodotCanvasPopupDialog {
  const node = new Container();
  const popup = bindCanvasPopupDialog({ node, kind: 'popup-dialog', width: 0, height: 0, viewportSize });
  registerGodotObjectIdentity(popup, 'PopupPanel');
  return popup;
}

export function createGodotCanvasPopupDialog(viewportSize: () => ControlPoint): GodotCanvasPopupDialog {
  const node = new Container();
  const popup = bindCanvasPopupDialog({ node, kind: 'popup-dialog', width: 0, height: 0, viewportSize });
  registerGodotObjectIdentity(popup, 'PopupDialog');
  return popup;
}

/** Godot 3 `WindowDialog.new()` over the same retained Pixi popup/window owner as authored nodes. */
export function createGodotCanvasWindowDialog(viewportSize: () => ControlPoint): GodotCanvasPopupDialog {
  const node = new Container();
  return bindCanvasPopupDialog({ node, kind: 'window-dialog', width: 0, height: 0, viewportSize });
}

export function createGodotCanvasPopup(viewportSize: () => ControlPoint): GodotCanvasPopup {
  const node = new Container();
  registerGodotObjectIdentity(node, 'Popup');
  return bindCanvasPopupDialog({ node, kind: 'popup', width: 0, height: 0, viewportSize }) as GodotCanvasPopup;
}

export function bindCanvasTree(options: CanvasAdvancedOptions): GodotCanvasTree {
  const state = prepare({ ...options, kind: 'tree' });
  const tree = bindTree(options.node as unknown as GodotControl);
  listen(options.node, state, (event) => {
    state.keyboardFocus = true;
    const point = event.getLocalPosition(options.node);
    const mouseButton = event.button === 0 ? 1 : event.button === 2 ? 2 : event.button === 1 ? 3 : event.button + 1;
    if (point.y >= 0 && point.y < 24) {
      const title = state.treeColumnHits.find((candidate) => point.x >= candidate.x && point.x < candidate.x + candidate.width);
      if (title !== undefined) {
        state.store.read('advanced').onTreeColumnTitleClick?.(title.column, mouseButton);
        return;
      }
    }
    const hit = state.treeButtonHits.find((candidate) => point.x >= candidate.x && point.x < candidate.x + candidate.width && point.y >= candidate.y && point.y < candidate.y + candidate.height);
    if (hit !== undefined) {
      if (hit.disabled) return;
      state.store.read('advanced').onTreeButtonClick?.(hit.rowKey, hit.column, hit.buttonKey, mouseButton);
      return;
    }
    const cell = state.treeCellHits.find((candidate) => point.x >= candidate.x && point.x < candidate.x + candidate.width && point.y >= candidate.y && point.y < candidate.y + candidate.height);
    if (cell !== undefined) {
      state.store.read('advanced').onTreeCellClick?.(cell.rowKey, cell.column, { x: point.x, y: point.y }, mouseButton, event.detail >= 2);
      return;
    }
    state.store.read('advanced').onTreeEmptyClick?.({ x: point.x, y: point.y }, mouseButton);
  });
  state.pointerMove = (event) => {
    const point = event.getLocalPosition(options.node);
    const hit = state.treeCellHits.find((candidate) => point.x >= candidate.x && point.x < candidate.x + candidate.width && point.y >= candidate.y && point.y < candidate.y + candidate.height);
    const rowKey = hit?.rowKey;
    if (state.store.read('advanced').treeHoveredRowKey === rowKey) return;
    state.store.write('advanced', { treeHoveredRowKey: rowKey });
  };
  options.node.on('pointermove', state.pointerMove);
  state.pointerLeave = () => {
    if (state.store.read('advanced').treeHoveredRowKey !== undefined) state.store.write('advanced', { treeHoveredRowKey: undefined });
  };
  options.node.on('pointerleave', state.pointerLeave);
  state.outsidePointer = (event) => {
    if (!state.keyboardFocus) return;
    const bounds = options.node.getBounds();
    if (event.global.x < bounds.left || event.global.x > bounds.right || event.global.y < bounds.top || event.global.y > bounds.bottom) {
      state.keyboardFocus = false;
      state.searchBuffer = '';
    }
  };
  state.keyDown = (event) => {
    if (!state.keyboardFocus) return;
    const selected = tree.get_selected();
    const column = Math.max(0, tree.get_selected_column());
    const visible = tree.visibleItems();
    const choose = (item: GodotTreeItem | null): void => {
      if (item === null) return;
      tree.set_selected(item, Math.min(column, tree.columns - 1));
      tree.ensure_cursor_is_visible();
    };
    let handled = true;
    if (event.key === 'ArrowDown') choose(selected?.get_next_visible(true) ?? visible[0] ?? null);
    else if (event.key === 'ArrowUp') choose(selected?.get_prev_visible(true) ?? visible.at(-1) ?? null);
    else if (event.key === 'ArrowLeft') {
      if (selected !== null && !selected.is_collapsed() && selected.get_child_count() > 0) selected.set_collapsed(true);
      else choose(selected?.get_parent() ?? null);
    } else if (event.key === 'ArrowRight') {
      if (selected !== null && selected.is_collapsed() && selected.get_child_count() > 0) selected.set_collapsed(false);
      else choose(selected?.get_first_child() ?? null);
    } else if (event.key === 'Home') choose(visible[0] ?? null);
    else if (event.key === 'End') choose(visible.at(-1) ?? null);
    else if (event.key === 'Enter') tree.activate_selected();
    else if (event.key === 'F2') tree.edit_selected(true);
    else if (event.key === ' ' && selected !== null && selected.get_cell_mode(column) === 1) selected.set_checked(column, !selected.is_checked(column));
    else if (event.key === 'Escape') tree.deselect_all();
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && tree.select_mode === 2) {
      for (const item of visible) tree.set_selected(item, column);
    } else if (tree.allow_search && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      state.searchBuffer = now - state.searchTime > 1000 ? event.key : state.searchBuffer + event.key;
      state.searchTime = now;
      const query = state.searchBuffer.toLocaleLowerCase();
      choose(visible.find((item) => item.get_text(column).toLocaleLowerCase().startsWith(query)) ?? null);
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };
  options.node.on('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
  state.wheel = (event) => {
    const before = tree.get_scroll();
    tree.scroll_by({ x: event.deltaX, y: event.deltaY });
    const after = tree.get_scroll();
    if (after.x !== before.x || after.y !== before.y) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  options.node.on('wheel', state.wheel);
  draw(options.node);
  return options.node as GodotCanvasTree;
}

/** Runtime Tree constructor with one retained native Pixi hierarchy renderer. */
export function createGodotCanvasTree(): GodotCanvasTree {
  const node = new Container();
  registerGodotObjectIdentity(node, 'Tree');
  return bindCanvasTree({ node, kind: 'tree', width: 0, height: 0 });
}

export function resizeCanvasAdvancedControl(node: Container, size: ControlPoint): void {
  const state = stateOf(node);
  state.width = dimension('Advanced Control width', size.x);
  state.height = dimension('Advanced Control height', size.y);
  draw(node);
}

export function releaseCanvasAdvancedControl(node: Container): void {
  const state = ADVANCED.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  state.releaseLayoutDirection();
  node.off('pointertap', state.pointerTap);
  node.off('pointerdown', state.pointerDown);
  node.off('pointermove', state.pointerMove);
  node.off('globalpointermove', state.globalPointerMove);
  node.off('pointerup', state.pointerUp);
  node.off('pointerupoutside', state.pointerUp);
  node.off('pointerleave', state.pointerLeave);
  node.off('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.removeEventListener('keydown', state.keyDown);
  node.off('wheel', state.wheel);
  clearLabels(state);
  if (state.closeButton !== undefined) {
    releaseCanvasBaseButton(state.closeButton);
    state.closeButton.removeFromParent();
    state.closeButton.destroy();
    delete state.closeButton;
  }
  state.background.removeFromParent();
  state.background.destroy();
  ADVANCED.delete(node);
}
