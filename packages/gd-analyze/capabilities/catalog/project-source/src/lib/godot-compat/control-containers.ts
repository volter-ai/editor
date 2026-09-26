/** Runtime properties for BoxContainer, GridContainer, and ScrollContainer. */

import { controlBinding, createControlHandle, optionalControlBinding, type GodotControl } from './control-state';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { registerGodotObjectIdentity } from './object';

function integer(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${member} must be a safe integer.`);
  return value;
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${member} must be finite.`);
  return value;
}

export interface GodotBoxContainer extends GodotControl {
  alignment: number;
  get_alignment(): number;
  set_alignment(value: number): void;
  is_vertical(): boolean;
  add_spacer(begin?: boolean): GodotControl;
}

export function bindBoxContainer(control: GodotControl, initialAlignment = 0, vertical = false): GodotBoxContainer {
  const box = control as GodotBoxContainer;
  const binding = controlBinding(control);
  let alignment = integer('BoxContainer.alignment', initialAlignment);
  if (alignment < 0 || alignment > 2) throw new RangeError('BoxContainer.alignment must be BEGIN (0), CENTER (1), or END (2).');
  Object.defineProperty(box, 'alignment', {
    enumerable: true,
    configurable: true,
    get: () => alignment,
    set: (value: number) => {
      const next = integer('BoxContainer.alignment', value);
      if (next < 0 || next > 2) throw new RangeError('BoxContainer.alignment must be BEGIN (0), CENTER (1), or END (2).');
      alignment = next;
      binding.state.write(binding.id, { containerAlignment: alignment });
    },
  });
  box.get_alignment = (): number => alignment;
  box.set_alignment = (value: number): void => { box.alignment = value; };
  box.is_vertical = (): boolean => boolean('BoxContainer vertical orientation', vertical);
  let spacerSerial = 0;
  box.add_spacer = (begin = false): GodotControl => {
    boolean('BoxContainer.add_spacer begin', begin);
    const spacer = createControlHandle(`${binding.id}:spacer:${spacerSerial++}`, {
      visible: true,
      text: '',
      texture: '',
      position: { x: 0, y: 0 },
      size: { x: 0, y: 0 },
      custom_minimum_size: { x: 0, y: 0 },
      size_flags_horizontal: vertical ? 1 : 3,
      size_flags_vertical: vertical ? 3 : 1,
      mouse_filter: 2,
      focusMode: 0,
      pivot_offset: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      modulate: { r: 1, g: 1, b: 1, a: 1 },
    }, binding.state);
    registerGodotObjectIdentity(spacer, 'Control');
    const retained = binding.state.read(binding.id).containerSpacers ?? [];
    binding.state.write(binding.id, { containerSpacers: begin ? [spacer, ...retained] : [...retained, spacer] });
    return spacer;
  };
  binding.state.write(binding.id, { containerAlignment: alignment });
  return box;
}

export interface GodotGridContainer extends GodotControl {
  columns: number;
  get_columns(): number;
  set_columns(value: number): void;
}

export function bindGridContainer(control: GodotControl, initialColumns = 1): GodotGridContainer {
  const grid = control as GodotGridContainer;
  const binding = controlBinding(control);
  let columns = integer('GridContainer.columns', initialColumns);
  if (columns < 1) throw new RangeError('GridContainer.columns must be greater than zero.');
  Object.defineProperty(grid, 'columns', {
    enumerable: true,
    configurable: true,
    get: () => columns,
    set: (value: number) => {
      const next = integer('GridContainer.columns', value);
      if (next < 1) throw new RangeError('GridContainer.columns must be greater than zero.');
      columns = next;
      binding.state.write(binding.id, { containerColumns: columns });
    },
  });
  grid.get_columns = (): number => columns;
  grid.set_columns = (value: number): void => { grid.columns = value; };
  binding.state.write(binding.id, { containerColumns: columns });
  return grid;
}

export interface GodotScrollBar {
  value: number;
  readonly value_changed: GodotSignal<readonly [number]>;
  get_value(): number;
  set_value(value: number): void;
}

interface ScrollState {
  readonly control: GodotControl;
  horizontalBar: GodotScrollBar;
  verticalBar: GodotScrollBar;
  readonly horizontalChanged: SignalHandle<readonly [number]>;
  readonly verticalChanged: SignalHandle<readonly [number]>;
  readonly started: SignalHandle<readonly []>;
  readonly ended: SignalHandle<readonly []>;
  element: HTMLElement | null;
  horizontal: number;
  vertical: number;
  horizontalEnabled: boolean;
  verticalEnabled: boolean;
  horizontalMode: number;
  verticalMode: number;
  deadzone: number;
  followFocus: boolean;
  horizontalCustomStep: number;
  verticalCustomStep: number;
  drawFocusBorder: boolean;
}

const SCROLLS = new WeakMap<object, ScrollState>();

function syncScroll(state: ScrollState): void {
  const binding = controlBinding(state.control);
  binding.state.write(binding.id, {
    scrollHorizontal: state.horizontal,
    scrollVertical: state.vertical,
    scrollHorizontalEnabled: state.horizontalEnabled,
    scrollVerticalEnabled: state.verticalEnabled,
    bindScrollElement(element): void {
      state.element = element;
      if (element !== null) {
        element.scrollLeft = state.horizontal;
        element.scrollTop = state.vertical;
      }
    },
    onControlScroll(left, top): void {
      const horizontalChanged = state.horizontal !== left;
      const verticalChanged = state.vertical !== top;
      state.horizontal = left;
      state.vertical = top;
      if (horizontalChanged) state.horizontalChanged.emit(left);
      if (verticalChanged) state.verticalChanged.emit(top);
    },
    onControlScrollStart(): void { state.started.emit(); },
    onControlScrollEnd(): void { state.ended.emit(); },
  });
  if (state.element !== null) {
    state.element.scrollLeft = state.horizontal;
    state.element.scrollTop = state.vertical;
  }
}

function scrollBar(state: ScrollState, axis: 'horizontal' | 'vertical'): GodotScrollBar {
  const changed = axis === 'horizontal' ? state.horizontalChanged : state.verticalChanged;
  const bar = {} as GodotScrollBar;
  registerGodotObjectIdentity(bar, axis === 'horizontal' ? 'HScrollBar' : 'VScrollBar');
  Object.defineProperties(bar, {
    value: {
      enumerable: true,
      configurable: true,
      get: () => axis === 'horizontal' ? state.horizontal : state.vertical,
      set: (value: number) => {
        const next = Math.max(0, finite(`ScrollBar ${axis} value`, value));
        const previous = axis === 'horizontal' ? state.horizontal : state.vertical;
        if (previous === next) return;
        if (axis === 'horizontal') state.horizontal = next;
        else state.vertical = next;
        syncScroll(state);
        changed.emit(next);
      },
    },
    value_changed: { enumerable: true, configurable: true, value: changed.signal },
  });
  bar.get_value = (): number => bar.value;
  bar.set_value = (value: number): void => { bar.value = value; };
  return bar;
}

export interface GodotScrollContainer extends GodotControl {
  scroll_horizontal: number;
  scroll_vertical: number;
  scroll_horizontal_enabled: boolean;
  scroll_vertical_enabled: boolean;
  horizontal_scroll_mode: number;
  vertical_scroll_mode: number;
  scroll_deadzone: number;
  follow_focus: boolean;
  scroll_horizontal_custom_step: number;
  scroll_vertical_custom_step: number;
  draw_focus_border: boolean;
  readonly scroll_started: GodotSignal<readonly []>;
  readonly scroll_ended: GodotSignal<readonly []>;
  get_h_scrollbar(): GodotScrollBar;
  get_v_scrollbar(): GodotScrollBar;
  get_h_scroll_bar(): GodotScrollBar;
  get_v_scroll_bar(): GodotScrollBar;
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
  ensure_control_visible(control: GodotControl): void;
}

function scrollMode(member: string, value: number): number {
  const next = integer(member, value);
  if (next < 0 || next > 5) throw new RangeError(`${member} must be a ScrollMode value from 0 through 5.`);
  return next;
}

export function bindScrollContainer(
  control: GodotControl,
  initial: {
    readonly horizontal?: number;
    readonly vertical?: number;
    readonly horizontalEnabled?: boolean;
    readonly verticalEnabled?: boolean;
    readonly horizontalMode?: number;
    readonly verticalMode?: number;
    readonly deadzone?: number;
    readonly followFocus?: boolean;
    readonly horizontalCustomStep?: number;
    readonly verticalCustomStep?: number;
    readonly drawFocusBorder?: boolean;
  } = {},
): GodotScrollContainer {
  const scroll = control as GodotScrollContainer;
  const state: ScrollState = {
    control,
    horizontalBar: undefined as unknown as GodotScrollBar,
    verticalBar: undefined as unknown as GodotScrollBar,
    horizontalChanged: createSignal<readonly [number]>(),
    verticalChanged: createSignal<readonly [number]>(),
    started: createSignal<readonly []>(),
    ended: createSignal<readonly []>(),
    element: null,
    horizontal: Math.max(0, finite('ScrollContainer.scroll_horizontal', initial.horizontal ?? 0)),
    vertical: Math.max(0, finite('ScrollContainer.scroll_vertical', initial.vertical ?? 0)),
    horizontalEnabled: boolean('ScrollContainer.scroll_horizontal_enabled', initial.horizontalEnabled ?? true),
    verticalEnabled: boolean('ScrollContainer.scroll_vertical_enabled', initial.verticalEnabled ?? true),
    horizontalMode: scrollMode(
      'ScrollContainer.horizontal_scroll_mode',
      initial.horizontalMode ?? ((initial.horizontalEnabled ?? true) ? 1 : 0),
    ),
    verticalMode: scrollMode(
      'ScrollContainer.vertical_scroll_mode',
      initial.verticalMode ?? ((initial.verticalEnabled ?? true) ? 1 : 0),
    ),
    deadzone: Math.max(0, integer('ScrollContainer.scroll_deadzone', initial.deadzone ?? 0)),
    followFocus: boolean('ScrollContainer.follow_focus', initial.followFocus ?? false),
    horizontalCustomStep: Math.max(-1, finite('ScrollContainer.scroll_horizontal_custom_step', initial.horizontalCustomStep ?? -1)),
    verticalCustomStep: Math.max(-1, finite('ScrollContainer.scroll_vertical_custom_step', initial.verticalCustomStep ?? -1)),
    drawFocusBorder: boolean('ScrollContainer.draw_focus_border', initial.drawFocusBorder ?? false),
  };
  state.horizontalEnabled = state.horizontalMode !== 0;
  state.horizontalBar = scrollBar(state, 'horizontal');
  state.verticalBar = scrollBar(state, 'vertical');
  SCROLLS.set(control, state);
  Object.defineProperties(scroll, {
    scroll_horizontal: { enumerable: true, configurable: true, get: () => state.horizontal, set: (value: number) => { state.horizontalBar.value = value; } },
    scroll_vertical: { enumerable: true, configurable: true, get: () => state.vertical, set: (value: number) => { state.verticalBar.value = value; } },
    scroll_horizontal_enabled: { enumerable: true, configurable: true, get: () => state.horizontalEnabled, set: (value: boolean) => { state.horizontalEnabled = boolean('ScrollContainer.scroll_horizontal_enabled', value); state.horizontalMode = state.horizontalEnabled ? 1 : 0; syncScroll(state); } },
    scroll_vertical_enabled: { enumerable: true, configurable: true, get: () => state.verticalEnabled, set: (value: boolean) => { state.verticalEnabled = boolean('ScrollContainer.scroll_vertical_enabled', value); syncScroll(state); } },
    horizontal_scroll_mode: {
      enumerable: true,
      configurable: true,
      get: () => state.horizontalMode,
      set: (value: number) => {
        state.horizontalMode = scrollMode('ScrollContainer.horizontal_scroll_mode', value);
        state.horizontalEnabled = state.horizontalMode !== 0;
        syncScroll(state);
      },
    },
    vertical_scroll_mode: {
      enumerable: true, configurable: true, get: () => state.verticalMode,
      set: (value: number) => { state.verticalMode = scrollMode('ScrollContainer.vertical_scroll_mode', value); state.verticalEnabled = state.verticalMode !== 0; syncScroll(state); },
    },
    scroll_deadzone: {
      enumerable: true, configurable: true, get: () => state.deadzone,
      set: (value: number) => { const next = integer('ScrollContainer.scroll_deadzone', value); if (next < 0) throw new RangeError('ScrollContainer.scroll_deadzone must be non-negative.'); state.deadzone = next; },
    },
    follow_focus: { enumerable: true, configurable: true, get: () => state.followFocus, set: (value: boolean) => { state.followFocus = boolean('ScrollContainer.follow_focus', value); } },
    scroll_horizontal_custom_step: { enumerable: true, configurable: true, get: () => state.horizontalCustomStep, set: (value: number) => { const next = finite('ScrollContainer.scroll_horizontal_custom_step', value); if (next < -1) throw new RangeError('ScrollContainer custom step must be >= -1.'); state.horizontalCustomStep = next; } },
    scroll_vertical_custom_step: { enumerable: true, configurable: true, get: () => state.verticalCustomStep, set: (value: number) => { const next = finite('ScrollContainer.scroll_vertical_custom_step', value); if (next < -1) throw new RangeError('ScrollContainer custom step must be >= -1.'); state.verticalCustomStep = next; } },
    draw_focus_border: { enumerable: true, configurable: true, get: () => state.drawFocusBorder, set: (value: boolean) => { state.drawFocusBorder = boolean('ScrollContainer.draw_focus_border', value); syncScroll(state); } },
    scroll_started: { enumerable: true, configurable: true, value: state.started.signal },
    scroll_ended: { enumerable: true, configurable: true, value: state.ended.signal },
  });
  Object.assign(scroll, {
    get_h_scrollbar(): GodotScrollBar { return state.horizontalBar; },
    get_v_scrollbar(): GodotScrollBar { return state.verticalBar; },
    get_h_scroll_bar(): GodotScrollBar { return state.horizontalBar; },
    get_v_scroll_bar(): GodotScrollBar { return state.verticalBar; },
    set_enable_h_scroll(value: boolean): void { scroll.scroll_horizontal_enabled = value; },
    set_enable_v_scroll(value: boolean): void { scroll.scroll_vertical_enabled = value; },
    get_horizontal_scroll_mode(): number { return state.horizontalMode; },
    set_horizontal_scroll_mode(value: number): void { scroll.horizontal_scroll_mode = value; },
    get_vertical_scroll_mode(): number { return state.verticalMode; },
    set_vertical_scroll_mode(value: number): void { scroll.vertical_scroll_mode = value; },
    get_deadzone(): number { return state.deadzone; },
    set_deadzone(value: number): void { scroll.scroll_deadzone = value; },
    is_following_focus(): boolean { return state.followFocus; },
    set_follow_focus(value: boolean): void { scroll.follow_focus = value; },
    set_horizontal_custom_step(value: number): void { scroll.scroll_horizontal_custom_step = value; },
    get_horizontal_custom_step(): number { return state.horizontalCustomStep; },
    set_vertical_custom_step(value: number): void { scroll.scroll_vertical_custom_step = value; },
    get_vertical_custom_step(): number { return state.verticalCustomStep; },
    set_draw_focus_border(value: boolean): void { scroll.draw_focus_border = value; },
    is_drawing_focus_border(): boolean { return state.drawFocusBorder; },
    ensure_control_visible(target: GodotControl): void {
      const element = state.element;
      const targetBinding = optionalControlBinding(target);
      const targetElement = targetBinding?.state.read(targetBinding.id).presentationElement ?? null;
      if (element === null || targetElement === null) {
        throw new Error('ScrollContainer.ensure_control_visible requires retained native DOM elements for both controls.');
      }
      if (!element.contains(targetElement)) {
        throw new Error('ScrollContainer.ensure_control_visible target must be a descendant of this ScrollContainer.');
      }
      const targetRect = targetElement.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const viewportLeft = elementRect.left + element.clientLeft;
      const viewportTop = elementRect.top + element.clientTop;
      const viewportRight = viewportLeft + element.clientWidth;
      const viewportBottom = viewportTop + element.clientHeight;
      if (state.horizontalEnabled) {
        if (targetRect.left < viewportLeft) element.scrollLeft += targetRect.left - viewportLeft;
        else if (targetRect.right > viewportRight) element.scrollLeft += targetRect.right - viewportRight;
      }
      if (state.verticalEnabled) {
        if (targetRect.top < viewportTop) element.scrollTop += targetRect.top - viewportTop;
        else if (targetRect.bottom > viewportBottom) element.scrollTop += targetRect.bottom - viewportBottom;
      }
      const binding = controlBinding(state.control);
      binding.state.read(binding.id).onControlScroll?.(element.scrollLeft, element.scrollTop);
    },
  });
  syncScroll(state);
  return scroll;
}
