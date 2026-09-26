/** Pixi-native container mutation and ScrollContainer clipping. */

import { Container, Graphics, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';

import {
  bindCanvasControl,
  reflowCanvasControl,
  setCanvasContainerLayout,
  setCanvasContainerScroll,
} from './canvas-control-state';
import { markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasContainerApi } from './canvas-container';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

export interface GodotCanvasScrollBar {
  value: number;
  min_value: number;
  max_value: number;
  step: number;
  page: number;
  allow_greater: boolean;
  allow_lesser: boolean;
  exp_edit: boolean;
  rounded: boolean;
  ratio: number;
  readonly value_changed: GodotSignal<readonly [number]>;
  readonly changed: GodotSignal<readonly []>;
  get_value(): number;
  set_value(value: number): void;
  set_value_no_signal(value: number): void;
  get_min(): number;
  set_min(value: number): void;
  get_max(): number;
  set_max(value: number): void;
  get_step(): number;
  set_step(value: number): void;
  get_page(): number;
  set_page(value: number): void;
  get_as_ratio(): number;
  set_as_ratio(value: number): void;
  set_allow_greater(value: boolean): void;
  is_greater_allowed(): boolean;
  set_allow_lesser(value: boolean): void;
  is_lesser_allowed(): boolean;
  set_exp_ratio(value: boolean): void;
  is_ratio_exp(): boolean;
  set_use_rounded_values(value: boolean): void;
  is_using_rounded_values(): boolean;
}

interface CanvasContainerState {
  readonly kind: 'horizontal' | 'vertical' | 'grid' | 'scroll';
  mask?: Graphics;
  focusBorder?: Graphics;
  owner?: Container;
  unregisterRelease(): void;
  columns: number;
  alignment: 0 | 1 | 2;
  horizontal: number;
  vertical: number;
  horizontalMaximum?: number;
  verticalMaximum?: number;
  horizontalPage?: number;
  verticalPage?: number;
  horizontalStep?: number;
  verticalStep?: number;
  horizontalAllowGreater?: boolean;
  verticalAllowGreater?: boolean;
  horizontalAllowLesser?: boolean;
  verticalAllowLesser?: boolean;
  horizontalEnabled: boolean;
  verticalEnabled: boolean;
  horizontalMode: number;
  verticalMode: number;
  followFocus: boolean;
  horizontalCustomStep: number;
  verticalCustomStep: number;
  drawFocusBorder: boolean;
  horizontalBar?: GodotCanvasScrollBar;
  verticalBar?: GodotCanvasScrollBar;
  horizontalChanged?: SignalHandle<readonly [number]>;
  verticalChanged?: SignalHandle<readonly [number]>;
  horizontalRangeChanged?: SignalHandle<readonly []>;
  verticalRangeChanged?: SignalHandle<readonly []>;
  horizontalExp?: boolean;
  verticalExp?: boolean;
  horizontalRounded?: boolean;
  verticalRounded?: boolean;
  scrollStarted?: SignalHandle<readonly []>;
  scrollEnded?: SignalHandle<readonly []>;
  pointerDown?(): void;
  pointerMove?(event: FederatedPointerEvent): void;
  pointerUp?(): void;
  wheel?(event: FederatedWheelEvent): void;
  outsidePointer?(event: FederatedPointerEvent): void;
  keyDown?(event: KeyboardEvent): void;
  applyScroll?(): void;
  width: number;
  height: number;
  scrollDeadzone: number;
  dragStart?: { x: number; y: number; horizontal: number; vertical: number };
  dragging: boolean;
  focused: boolean;
  released: boolean;
}

const CONTAINERS = new WeakMap<Container, CanvasContainerState>();

function integer(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${member} must be a safe integer.`);
  return value;
}

function boxAlignment(member: string, value: number): 0 | 1 | 2 {
  const next = integer(member, value);
  if (next < 0 || next > 2) throw new RangeError(`${member} must be BEGIN (0), CENTER (1), or END (2).`);
  return next as 0 | 1 | 2;
}

function stateOf(node: Container): CanvasContainerState {
  const state = CONTAINERS.get(node);
  if (state === undefined) throw new Error('Canvas Container is not bound.');
  return state;
}

function redrawMask(node: Container, state: CanvasContainerState): void {
  if (state.mask === undefined) return;
  state.mask.clear().rect(0, 0, state.width, state.height).fill({ color: 0xffffff });
  node.mask = state.mask;
}

function redrawScrollFocus(state: CanvasContainerState): void {
  if (state.focusBorder === undefined) return;
  state.focusBorder.clear();
  if (state.drawFocusBorder && state.focused) {
    state.focusBorder.rect(1, 1, Math.max(0, state.width - 2), Math.max(0, state.height - 2)).stroke({ color: 0x75b7ff, width: 2 });
  }
}

export type GodotCanvasBoxContainer = Container & {
  alignment: number;
  get_alignment(): number;
  set_alignment(value: number): void;
  is_vertical(): boolean;
  add_spacer(begin?: boolean): Container;
};
export type GodotCanvasGridContainer = Container & { columns: number; get_columns(): number; set_columns(value: number): void };
export type GodotCanvasScrollContainer = Container & {
  scroll_horizontal: number;
  scroll_vertical: number;
  scroll_horizontal_enabled: boolean;
  scroll_vertical_enabled: boolean;
  scroll_deadzone: number;
  horizontal_scroll_mode: number;
  vertical_scroll_mode: number;
  follow_focus: boolean;
  scroll_horizontal_custom_step: number;
  scroll_vertical_custom_step: number;
  draw_focus_border: boolean;
  get_h_scrollbar(): GodotCanvasScrollBar;
  get_v_scrollbar(): GodotCanvasScrollBar;
  get_h_scroll_bar(): GodotCanvasScrollBar;
  get_v_scroll_bar(): GodotCanvasScrollBar;
  set_enable_h_scroll(value: boolean): void;
  set_enable_v_scroll(value: boolean): void;
  get_horizontal_scroll_mode(): number;
  set_horizontal_scroll_mode(value: number): void;
  get_vertical_scroll_mode(): number;
  set_vertical_scroll_mode(value: number): void;
  get_deadzone(): number;
  set_deadzone(value: number): void;
  is_following_focus(): boolean;
  set_follow_focus(value: boolean): void;
  set_horizontal_custom_step(value: number): void;
  get_horizontal_custom_step(): number;
  set_vertical_custom_step(value: number): void;
  get_vertical_custom_step(): number;
  set_draw_focus_border(value: boolean): void;
  is_drawing_focus_border(): boolean;
  ensure_control_visible(control: Container): void;
  readonly scroll_started: GodotSignal<readonly []>;
  readonly scroll_ended: GodotSignal<readonly []>;
};

function scrollMode(member: string, value: number): number {
  const next = integer(member, value);
  if (next < 0 || next > 5) throw new RangeError(`${member} must be a ScrollMode value from 0 through 5.`);
  return next;
}

function canvasScrollBar(state: CanvasContainerState, axis: 'horizontal' | 'vertical'): GodotCanvasScrollBar {
  const changed = axis === 'horizontal' ? state.horizontalChanged : state.verticalChanged;
  if (changed === undefined) throw new Error('Canvas ScrollContainer signal state was not initialized.');
  const rangeChanged = axis === 'horizontal' ? state.horizontalRangeChanged : state.verticalRangeChanged;
  if (rangeChanged === undefined) throw new Error('Canvas ScrollContainer range signal state was not initialized.');
  const bar = {} as GodotCanvasScrollBar;
  registerGodotObjectIdentity(bar, axis === 'horizontal' ? 'HScrollBar' : 'VScrollBar');
  const measuredMaximum = (): number => {
    const explicit = axis === 'horizontal' ? state.horizontalMaximum : state.verticalMaximum;
    if (explicit !== undefined) return explicit;
    const owner = state.owner;
    if (owner === undefined) return 0;
    let maximum = axis === 'horizontal' ? state.width : state.height;
    for (const child of owner.children) {
      if (child === state.mask) continue;
      const bounds = child.getBounds();
      const far = axis === 'horizontal' ? bounds.right : bounds.bottom;
      const local = owner.toLocal(axis === 'horizontal' ? { x: far, y: bounds.top } : { x: bounds.left, y: far });
      maximum = Math.max(maximum, (axis === 'horizontal' ? local.x : local.y) + (axis === 'horizontal' ? state.horizontal : state.vertical));
    }
    return maximum;
  };
  const page = (): number => axis === 'horizontal' ? (state.horizontalPage ?? state.width) : (state.verticalPage ?? state.height);
  const effectiveMaximum = (): number => Math.max(0, measuredMaximum() - page());
  const assign = (value: number, emit: boolean): void => {
    if (!Number.isFinite(value)) throw new RangeError(`ScrollBar ${axis} value must be finite.`);
    const allowLesser = axis === 'horizontal' ? state.horizontalAllowLesser : state.verticalAllowLesser;
    const allowGreater = axis === 'horizontal' ? state.horizontalAllowGreater : state.verticalAllowGreater;
    const lower = allowLesser ? -Infinity : 0;
    const upper = allowGreater ? Infinity : effectiveMaximum();
    const rounded = axis === 'horizontal' ? state.horizontalRounded : state.verticalRounded;
    const requested = rounded ? Math.round(value) : value;
    const next = Math.min(upper, Math.max(lower, requested));
    const previous = axis === 'horizontal' ? state.horizontal : state.vertical;
    if (previous === next) return;
    if (axis === 'horizontal') state.horizontal = next;
    else state.vertical = next;
    state.applyScroll?.();
    if (emit) changed.emit(next);
  };
  Object.defineProperties(bar, {
    value: {
      enumerable: true,
      configurable: true,
      get: () => axis === 'horizontal' ? state.horizontal : state.vertical,
      set: (value: number) => assign(value, true),
    },
    min_value: { enumerable: true, configurable: true, get: () => 0, set: (value: number) => { if (value !== 0) throw new RangeError('ScrollBar minimum is fixed at zero.'); } },
    max_value: {
      enumerable: true, configurable: true, get: measuredMaximum,
      set: (value: number) => {
        if (!Number.isFinite(value) || value < 0) throw new RangeError('ScrollBar.max_value must be finite and non-negative.');
        if (axis === 'horizontal') state.horizontalMaximum = value; else state.verticalMaximum = value;
        assign(bar.value, true);
        rangeChanged.emit();
      },
    },
    step: {
      enumerable: true, configurable: true, get: () => axis === 'horizontal' ? (state.horizontalStep ?? 0) : (state.verticalStep ?? 0),
      set: (value: number) => {
        if (!Number.isFinite(value) || value < 0) throw new RangeError('ScrollBar.step must be finite and non-negative.');
        if (axis === 'horizontal') state.horizontalStep = value; else state.verticalStep = value;
        rangeChanged.emit();
      },
    },
    page: {
      enumerable: true, configurable: true, get: page,
      set: (value: number) => {
        if (!Number.isFinite(value) || value < 0) throw new RangeError('ScrollBar.page must be finite and non-negative.');
        if (axis === 'horizontal') state.horizontalPage = value; else state.verticalPage = value;
        assign(bar.value, true);
        rangeChanged.emit();
      },
    },
    allow_greater: {
      enumerable: true, configurable: true, get: () => axis === 'horizontal' ? (state.horizontalAllowGreater ?? false) : (state.verticalAllowGreater ?? false),
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollBar.allow_greater must be bool.'); if (axis === 'horizontal') state.horizontalAllowGreater = value; else state.verticalAllowGreater = value; assign(bar.value, true); rangeChanged.emit(); },
    },
    allow_lesser: {
      enumerable: true, configurable: true, get: () => axis === 'horizontal' ? (state.horizontalAllowLesser ?? false) : (state.verticalAllowLesser ?? false),
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollBar.allow_lesser must be bool.'); if (axis === 'horizontal') state.horizontalAllowLesser = value; else state.verticalAllowLesser = value; assign(bar.value, true); rangeChanged.emit(); },
    },
    exp_edit: {
      enumerable: true, configurable: true,
      get: () => axis === 'horizontal' ? (state.horizontalExp ?? false) : (state.verticalExp ?? false),
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollBar.exp_edit must be bool.'); if (axis === 'horizontal') state.horizontalExp = value; else state.verticalExp = value; rangeChanged.emit(); },
    },
    rounded: {
      enumerable: true, configurable: true,
      get: () => axis === 'horizontal' ? (state.horizontalRounded ?? false) : (state.verticalRounded ?? false),
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollBar.rounded must be bool.'); if (axis === 'horizontal') state.horizontalRounded = value; else state.verticalRounded = value; assign(bar.value, true); rangeChanged.emit(); },
    },
    ratio: { enumerable: true, configurable: true, get: () => bar.get_as_ratio(), set: (value: number) => bar.set_as_ratio(value) },
    value_changed: { enumerable: true, configurable: true, value: changed.signal },
    changed: { enumerable: true, configurable: true, value: rangeChanged.signal },
  });
  bar.get_value = (): number => bar.value;
  bar.set_value = (value: number): void => { bar.value = value; };
  bar.set_value_no_signal = (value: number): void => assign(value, false);
  bar.get_min = (): number => bar.min_value;
  bar.set_min = (value: number): void => { bar.min_value = value; };
  bar.get_max = (): number => bar.max_value;
  bar.set_max = (value: number): void => { bar.max_value = value; };
  bar.get_step = (): number => bar.step;
  bar.set_step = (value: number): void => { bar.step = value; };
  bar.get_page = (): number => bar.page;
  bar.set_page = (value: number): void => { bar.page = value; };
  bar.get_as_ratio = (): number => effectiveMaximum() === 0 ? 0 : bar.value / effectiveMaximum();
  bar.set_as_ratio = (value: number): void => {
    if (!Number.isFinite(value)) throw new RangeError('ScrollBar ratio must be finite.');
    bar.value = Math.max(0, Math.min(1, value)) * effectiveMaximum();
  };
  bar.set_allow_greater = (value: boolean): void => { bar.allow_greater = value; };
  bar.is_greater_allowed = (): boolean => bar.allow_greater;
  bar.set_allow_lesser = (value: boolean): void => { bar.allow_lesser = value; };
  bar.is_lesser_allowed = (): boolean => bar.allow_lesser;
  bar.set_exp_ratio = (value: boolean): void => { bar.exp_edit = value; };
  bar.is_ratio_exp = (): boolean => bar.exp_edit;
  bar.set_use_rounded_values = (value: boolean): void => { bar.rounded = value; };
  bar.is_using_rounded_values = (): boolean => bar.rounded;
  return bar;
}

export function bindCanvasBoxContainer(
  node: Container,
  options: { readonly vertical: boolean; readonly separation: number; readonly alignment?: number },
): GodotCanvasBoxContainer {
  releaseCanvasControlContainer(node);
  const alignment = boxAlignment('BoxContainer.alignment', options.alignment ?? 0);
  const state: CanvasContainerState = {
    kind: options.vertical ? 'vertical' : 'horizontal',
    unregisterRelease: () => {},
    columns: 1,
    alignment,
    horizontal: 0,
    vertical: 0,
    horizontalEnabled: true,
    verticalEnabled: true,
    horizontalMode: 1,
    verticalMode: 1,
    followFocus: false,
    horizontalCustomStep: -1,
    verticalCustomStep: -1,
    drawFocusBorder: false,
    width: 0,
    height: 0,
    scrollDeadzone: 0,
    dragging: false,
    focused: false,
    released: false,
  };
  CONTAINERS.set(node, state);
  setCanvasContainerLayout(node, state.kind, { separation: options.separation, alignment });
  Object.defineProperty(node, 'alignment', {
    enumerable: true,
    configurable: true,
    get: () => state.alignment,
    set: (value: number) => {
      const next = boxAlignment('BoxContainer.alignment', value);
      state.alignment = next;
      setCanvasContainerLayout(node, state.kind, { separation: options.separation, alignment: next });
    },
  });
  Object.assign(node, {
    get_alignment: (): number => state.alignment,
    set_alignment: (value: number): void => { (node as GodotCanvasBoxContainer).alignment = value; },
    is_vertical: (): boolean => state.kind === 'vertical',
    add_spacer: (begin = false): Container => {
      if (typeof begin !== 'boolean') throw new TypeError('BoxContainer.add_spacer begin must be bool.');
      const spacer = new Container();
      bindCanvasControl(spacer, {
        position: { x: 0, y: 0 }, size: { x: 0, y: 0 }, anchor: { x: 0, y: 0 },
        customMinimumSize: { x: 0, y: 0 },
        sizeFlagsHorizontal: state.kind === 'horizontal' ? 3 : 1,
        sizeFlagsVertical: state.kind === 'vertical' ? 3 : 1,
        mouseFilter: 2,
        nativeSize: false,
      });
      registerGodotObjectIdentity(spacer, 'Control');
      if (begin) node.addChildAt(spacer, 0);
      else node.addChild(spacer);
      reflowCanvasControl(node);
      return spacer;
    },
  });
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseCanvasControlContainer(node));
  return node as GodotCanvasBoxContainer;
}

export function bindCanvasGridContainer(
  node: Container,
  options: { readonly columns: number; readonly horizontalSeparation: number; readonly verticalSeparation: number },
): GodotCanvasGridContainer {
  releaseCanvasControlContainer(node);
  const columns = integer('GridContainer.columns', options.columns);
  if (columns < 1) throw new RangeError('GridContainer.columns must be greater than zero.');
  const state: CanvasContainerState = {
    kind: 'grid', unregisterRelease: () => {}, columns, alignment: 0, horizontal: 0, vertical: 0,
    horizontalEnabled: true, verticalEnabled: true, horizontalMode: 1, verticalMode: 1, followFocus: false, width: 0, height: 0, released: false,
    horizontalCustomStep: -1, verticalCustomStep: -1, drawFocusBorder: false,
    scrollDeadzone: 0, dragging: false, focused: false,
  };
  CONTAINERS.set(node, state);
  const apply = (): void => setCanvasContainerLayout(node, 'grid', {
    columns: state.columns,
    separation: options.horizontalSeparation,
    rowSeparation: options.verticalSeparation,
  });
  Object.defineProperty(node, 'columns', {
    enumerable: true,
    configurable: true,
    get: () => state.columns,
    set: (value: number) => {
      const next = integer('GridContainer.columns', value);
      if (next < 1) throw new RangeError('GridContainer.columns must be greater than zero.');
      state.columns = next;
      apply();
    },
  });
  Object.assign(node, { get_columns: () => state.columns, set_columns: (value: number) => { (node as GodotCanvasGridContainer).columns = value; } });
  apply();
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseCanvasControlContainer(node));
  return node as GodotCanvasGridContainer;
}

export function bindCanvasScrollContainer(
  node: Container,
  options: {
    readonly width: number;
    readonly height: number;
    readonly horizontal?: number;
    readonly vertical?: number;
    readonly horizontalEnabled?: boolean;
    readonly verticalEnabled?: boolean;
    readonly horizontalMode?: number;
    readonly verticalMode?: number;
    readonly followFocus?: boolean;
  },
): GodotCanvasScrollContainer {
  releaseCanvasControlContainer(node);
  if (!Number.isFinite(options.width) || options.width < 0 || !Number.isFinite(options.height) || options.height < 0) {
    throw new RangeError('Canvas ScrollContainer dimensions must be finite and non-negative.');
  }
  if (!Number.isFinite(options.horizontal ?? 0) || (options.horizontal ?? 0) < 0 ||
      !Number.isFinite(options.vertical ?? 0) || (options.vertical ?? 0) < 0) {
    throw new RangeError('Canvas ScrollContainer scroll values must be finite and non-negative.');
  }
  const mask = markInternalCanvasChild(new Graphics());
  node.addChild(mask);
  const focusBorder = markInternalCanvasChild(new Graphics());
  node.addChild(focusBorder);
  const state: CanvasContainerState = {
    kind: 'scroll', mask, focusBorder, unregisterRelease: () => {}, columns: 1, alignment: 0,
    owner: node,
    horizontal: Math.max(0, options.horizontal ?? 0), vertical: Math.max(0, options.vertical ?? 0),
    horizontalEnabled: options.horizontalEnabled ?? true, verticalEnabled: options.verticalEnabled ?? true,
    horizontalMode: scrollMode('ScrollContainer.horizontal_scroll_mode', options.horizontalMode ?? ((options.horizontalEnabled ?? true) ? 1 : 0)),
    verticalMode: scrollMode('ScrollContainer.vertical_scroll_mode', options.verticalMode ?? ((options.verticalEnabled ?? true) ? 1 : 0)),
    followFocus: options.followFocus ?? false,
    horizontalCustomStep: -1, verticalCustomStep: -1, drawFocusBorder: false,
    horizontalChanged: createSignal<readonly [number]>(), verticalChanged: createSignal<readonly [number]>(),
    horizontalRangeChanged: createSignal<readonly []>(), verticalRangeChanged: createSignal<readonly []>(),
    scrollStarted: createSignal<readonly []>(), scrollEnded: createSignal<readonly []>(),
    width: options.width, height: options.height,
    horizontalPage: options.width, verticalPage: options.height,
    horizontalStep: 0, verticalStep: 0,
    scrollDeadzone: 0, dragging: false, focused: false, released: false,
  };
  if (typeof state.horizontalEnabled !== 'boolean' || typeof state.verticalEnabled !== 'boolean') {
    throw new TypeError('Canvas ScrollContainer enabled properties must be bool.');
  }
  state.horizontalEnabled = state.horizontalMode !== 0;
  CONTAINERS.set(node, state);
  setCanvasContainerLayout(node, 'scroll');
  const apply = (): void => setCanvasContainerScroll(node, {
    x: state.horizontalEnabled ? state.horizontal : 0,
    y: state.verticalEnabled ? state.vertical : 0,
  });
  state.applyScroll = apply;
  state.horizontalBar = canvasScrollBar(state, 'horizontal');
  state.verticalBar = canvasScrollBar(state, 'vertical');
  Object.defineProperties(node, {
    scroll_horizontal: { enumerable: true, configurable: true, get: () => state.horizontal, set: (value: number) => { state.horizontalBar!.value = value; } },
    scroll_vertical: { enumerable: true, configurable: true, get: () => state.vertical, set: (value: number) => { state.verticalBar!.value = value; } },
    scroll_horizontal_enabled: { enumerable: true, configurable: true, get: () => state.horizontalEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollContainer.scroll_horizontal_enabled must be bool.'); state.horizontalEnabled = value; state.horizontalMode = value ? 1 : 0; apply(); } },
    scroll_vertical_enabled: { enumerable: true, configurable: true, get: () => state.verticalEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollContainer.scroll_vertical_enabled must be bool.'); state.verticalEnabled = value; apply(); } },
    scroll_deadzone: {
      enumerable: true,
      configurable: true,
      get: () => state.scrollDeadzone,
      set: (value: number) => {
        const next = integer('ScrollContainer.scroll_deadzone', value);
        if (next < 0) throw new RangeError('ScrollContainer.scroll_deadzone must be non-negative.');
        state.scrollDeadzone = next;
      },
    },
    horizontal_scroll_mode: {
      enumerable: true,
      configurable: true,
      get: () => state.horizontalMode,
      set: (value: number) => {
        state.horizontalMode = scrollMode('ScrollContainer.horizontal_scroll_mode', value);
        state.horizontalEnabled = state.horizontalMode !== 0;
        apply();
      },
    },
    vertical_scroll_mode: {
      enumerable: true, configurable: true, get: () => state.verticalMode,
      set: (value: number) => { state.verticalMode = scrollMode('ScrollContainer.vertical_scroll_mode', value); state.verticalEnabled = state.verticalMode !== 0; apply(); },
    },
    follow_focus: {
      enumerable: true, configurable: true, get: () => state.followFocus,
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollContainer.follow_focus must be bool.'); state.followFocus = value; },
    },
    scroll_horizontal_custom_step: { enumerable: true, configurable: true, get: () => state.horizontalCustomStep, set: (value: number) => { if (!Number.isFinite(value) || value < -1) throw new RangeError('ScrollContainer horizontal custom step must be >= -1.'); state.horizontalCustomStep = value; } },
    scroll_vertical_custom_step: { enumerable: true, configurable: true, get: () => state.verticalCustomStep, set: (value: number) => { if (!Number.isFinite(value) || value < -1) throw new RangeError('ScrollContainer vertical custom step must be >= -1.'); state.verticalCustomStep = value; } },
    draw_focus_border: { enumerable: true, configurable: true, get: () => state.drawFocusBorder, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('ScrollContainer.draw_focus_border must be bool.'); state.drawFocusBorder = value; redrawScrollFocus(state); } },
    scroll_started: { enumerable: true, configurable: true, value: state.scrollStarted!.signal },
    scroll_ended: { enumerable: true, configurable: true, value: state.scrollEnded!.signal },
  });
  Object.assign(node, {
    get_h_scrollbar: (): GodotCanvasScrollBar => state.horizontalBar!,
    get_v_scrollbar: (): GodotCanvasScrollBar => state.verticalBar!,
    get_h_scroll_bar: (): GodotCanvasScrollBar => state.horizontalBar!,
    get_v_scroll_bar: (): GodotCanvasScrollBar => state.verticalBar!,
    set_enable_h_scroll: (value: boolean): void => { (node as GodotCanvasScrollContainer).scroll_horizontal_enabled = value; },
    set_enable_v_scroll: (value: boolean): void => { (node as GodotCanvasScrollContainer).scroll_vertical_enabled = value; },
    get_horizontal_scroll_mode: (): number => state.horizontalMode,
    set_horizontal_scroll_mode: (value: number): void => { (node as GodotCanvasScrollContainer).horizontal_scroll_mode = value; },
    get_vertical_scroll_mode: (): number => state.verticalMode,
    set_vertical_scroll_mode: (value: number): void => { (node as GodotCanvasScrollContainer).vertical_scroll_mode = value; },
    get_deadzone: (): number => state.scrollDeadzone,
    set_deadzone: (value: number): void => { (node as GodotCanvasScrollContainer).scroll_deadzone = value; },
    is_following_focus: (): boolean => state.followFocus,
    set_follow_focus: (value: boolean): void => { (node as GodotCanvasScrollContainer).follow_focus = value; },
    set_horizontal_custom_step: (value: number): void => { (node as GodotCanvasScrollContainer).scroll_horizontal_custom_step = value; },
    get_horizontal_custom_step: (): number => state.horizontalCustomStep,
    set_vertical_custom_step: (value: number): void => { (node as GodotCanvasScrollContainer).scroll_vertical_custom_step = value; },
    get_vertical_custom_step: (): number => state.verticalCustomStep,
    set_draw_focus_border: (value: boolean): void => { (node as GodotCanvasScrollContainer).draw_focus_border = value; },
    is_drawing_focus_border: (): boolean => state.drawFocusBorder,
    ensure_control_visible: (target: Container): void => {
      let ancestor = target.parent;
      while (ancestor !== null && ancestor !== node) ancestor = ancestor.parent;
      if (ancestor !== node) {
        throw new Error('ScrollContainer.ensure_control_visible target must be a descendant of this ScrollContainer.');
      }
      const bounds = target.getBounds();
      const corners = [
        node.toLocal({ x: bounds.left, y: bounds.top }),
        node.toLocal({ x: bounds.right, y: bounds.top }),
        node.toLocal({ x: bounds.left, y: bounds.bottom }),
        node.toLocal({ x: bounds.right, y: bounds.bottom }),
      ];
      const left = Math.min(...corners.map((point) => point.x));
      const right = Math.max(...corners.map((point) => point.x));
      const top = Math.min(...corners.map((point) => point.y));
      const bottom = Math.max(...corners.map((point) => point.y));
      let horizontal = state.horizontal;
      let vertical = state.vertical;
      if (state.horizontalEnabled) {
        if (left < 0) horizontal = Math.max(0, horizontal + left);
        else if (right > state.width) horizontal += right - state.width;
      }
      if (state.verticalEnabled) {
        if (top < 0) vertical = Math.max(0, vertical + top);
        else if (bottom > state.height) vertical += bottom - state.height;
      }
      if (horizontal !== state.horizontal) state.horizontalBar!.value = horizontal;
      if (vertical !== state.vertical) state.verticalBar!.value = vertical;
    },
  });
  state.pointerDown = (event?: FederatedPointerEvent): void => {
    if (event === undefined) return;
    state.focused = true;
    redrawScrollFocus(state);
    state.dragStart = { x: event.global.x, y: event.global.y, horizontal: state.horizontal, vertical: state.vertical };
    state.dragging = false;
  };
  state.pointerMove = (event): void => {
    const start = state.dragStart;
    if (start === undefined) return;
    const dx = event.global.x - start.x;
    const dy = event.global.y - start.y;
    if (!state.dragging && Math.hypot(dx, dy) < state.scrollDeadzone) return;
    if (!state.dragging) { state.dragging = true; state.scrollStarted!.emit(); }
    if (state.horizontalEnabled) state.horizontalBar!.value = Math.max(0, start.horizontal - dx);
    if (state.verticalEnabled) state.verticalBar!.value = Math.max(0, start.vertical - dy);
  };
  state.pointerUp = (): void => {
    delete state.dragStart;
    if (state.dragging) state.scrollEnded!.emit();
    state.dragging = false;
  };
  state.wheel = (event): void => {
    const horizontalDelta = state.horizontalCustomStep >= 0
      ? Math.sign(event.deltaX) * state.horizontalCustomStep
      : event.deltaX;
    const verticalDelta = state.verticalCustomStep >= 0
      ? Math.sign(event.deltaY) * state.verticalCustomStep
      : event.deltaY;
    const previousHorizontal = state.horizontal;
    const previousVertical = state.vertical;
    if (state.horizontalEnabled && horizontalDelta !== 0) state.horizontalBar!.value = state.horizontal + horizontalDelta;
    if (state.verticalEnabled && verticalDelta !== 0) state.verticalBar!.value = state.vertical + verticalDelta;
    if (state.horizontal === previousHorizontal && state.vertical === previousVertical) return;
    state.scrollStarted!.emit();
    state.scrollEnded!.emit();
    event.preventDefault();
    event.stopPropagation();
  };
  state.outsidePointer = (event): void => {
    if (!state.focused) return;
    const bounds = node.getBounds();
    if (event.global.x >= bounds.left && event.global.x <= bounds.right && event.global.y >= bounds.top && event.global.y <= bounds.bottom) return;
    state.focused = false;
    redrawScrollFocus(state);
  };
  state.keyDown = (event): void => {
    if (!state.focused) return;
    const horizontalStep = state.horizontalCustomStep >= 0 ? state.horizontalCustomStep : Math.max(16, state.horizontalBar?.step ?? 0);
    const verticalStep = state.verticalCustomStep >= 0 ? state.verticalCustomStep : Math.max(16, state.verticalBar?.step ?? 0);
    const before = { x: state.horizontal, y: state.vertical };
    if (event.key === 'ArrowLeft' && state.horizontalEnabled) state.horizontalBar!.value -= horizontalStep;
    else if (event.key === 'ArrowRight' && state.horizontalEnabled) state.horizontalBar!.value += horizontalStep;
    else if (event.key === 'ArrowUp' && state.verticalEnabled) state.verticalBar!.value -= verticalStep;
    else if (event.key === 'ArrowDown' && state.verticalEnabled) state.verticalBar!.value += verticalStep;
    else if (event.key === 'PageUp' && state.verticalEnabled) state.verticalBar!.value -= state.height;
    else if (event.key === 'PageDown' && state.verticalEnabled) state.verticalBar!.value += state.height;
    else if (event.key === 'Home') {
      if (event.ctrlKey && state.horizontalEnabled) state.horizontalBar!.value = 0;
      if (state.verticalEnabled) state.verticalBar!.value = 0;
    } else if (event.key === 'End') {
      if (event.ctrlKey && state.horizontalEnabled) state.horizontalBar!.value = state.horizontalBar!.max_value;
      if (state.verticalEnabled) state.verticalBar!.value = state.verticalBar!.max_value;
    } else return;
    if (before.x === state.horizontal && before.y === state.vertical) return;
    state.scrollStarted!.emit();
    state.scrollEnded!.emit();
    event.preventDefault();
    event.stopPropagation();
  };
  node.eventMode = 'static';
  node.on('pointerdown', state.pointerDown);
  node.on('globalpointermove', state.pointerMove);
  node.on('pointerup', state.pointerUp);
  node.on('pointerupoutside', state.pointerUp);
  node.on('wheel', state.wheel);
  node.on('globalpointerdown', state.outsidePointer);
  if (typeof window !== 'undefined') window.addEventListener('keydown', state.keyDown);
  redrawMask(node, state);
  redrawScrollFocus(state);
  apply();
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseCanvasControlContainer(node));
  return node as GodotCanvasScrollContainer;
}

export function createGodotCanvasScrollContainer(): GodotCanvasScrollContainer {
  const node = new Container();
  registerGodotObjectIdentity(node, 'ScrollContainer');
  return bindGodotCanvasContainerApi(bindCanvasScrollContainer(node, { width: 0, height: 0 }));
}

export function resizeCanvasControlContainer(node: Container, width: number, height: number): void {
  const state = CONTAINERS.get(node);
  if (state === undefined) return;
  state.width = width;
  state.height = height;
  redrawMask(node, state);
  redrawScrollFocus(state);
  reflowCanvasControl(node);
}

export function releaseCanvasControlContainer(node: Container): void {
  const state = CONTAINERS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  if (state.mask !== undefined) {
    if (node.mask === state.mask) node.mask = null;
    state.mask.removeFromParent();
    state.mask.destroy();
  }
  if (state.focusBorder !== undefined) {
    state.focusBorder.removeFromParent();
    state.focusBorder.destroy();
  }
  if (state.pointerDown !== undefined) node.off('pointerdown', state.pointerDown);
  if (state.pointerMove !== undefined) node.off('globalpointermove', state.pointerMove);
  if (state.pointerUp !== undefined) {
    node.off('pointerup', state.pointerUp);
    node.off('pointerupoutside', state.pointerUp);
  }
  if (state.wheel !== undefined) node.off('wheel', state.wheel);
  if (state.outsidePointer !== undefined) node.off('globalpointerdown', state.outsidePointer);
  if (state.keyDown !== undefined && typeof window !== 'undefined') window.removeEventListener('keydown', state.keyDown);
  CONTAINERS.delete(node);
}
