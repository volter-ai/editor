/** Godot 4 TabBar state on the retained DOM/Pixi Control identity. */

import {
  controlBinding,
  createControlState,
  registerControlBinding,
  type ControlPoint,
  type GodotControl,
} from './control-state';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

interface TabEntry {
  title: string;
  disabled: boolean;
  hidden: boolean;
  icon: unknown;
  buttonIcon: unknown;
  iconMaxWidth: number;
  metadata: unknown;
  tooltip: string;
  language: string;
  textDirection: number;
}

interface TabBarState {
  readonly tabs: TabEntry[];
  readonly changed: SignalHandle<readonly [number]>;
  readonly hitTest?: (point: ControlPoint) => number;
  current: number;
  dragToRearrange: boolean;
  closeDisplayPolicy: number;
  readonly closePressed: SignalHandle<readonly [number]>;
  readonly clicked: SignalHandle<readonly [number]>;
  readonly hovered: SignalHandle<readonly [number]>;
  readonly rmbClicked: SignalHandle<readonly [number]>;
  readonly buttonPressed: SignalHandle<readonly [number]>;
  readonly reordered: SignalHandle<readonly [number]>
  alignment: number;
  clipping: boolean;
  deselectEnabled: boolean;
  maxTabWidth: number;
  scrollingEnabled: boolean;
  selectWithRmb: boolean;
  reorderGroup: number;
  scrollToSelected: boolean;
  previous: number;
}

export interface GodotTabBar extends GodotControl {
  current_tab: number;
  drag_to_rearrange_enabled: boolean;
  tab_close_display_policy: number;
  tab_alignment: number;
  clip_tabs: boolean;
  deselect_enabled: boolean;
  max_tab_width: number;
  scrolling_enabled: boolean;
  select_with_rmb: boolean;
  tabs_rearrange_group: number;
  scroll_to_selected: boolean;
  readonly tab_changed: GodotSignal<readonly [number]>;
  readonly tab_close_pressed: GodotSignal<readonly [number]>;
  readonly tab_clicked: GodotSignal<readonly [number]>;
  readonly tab_hovered: GodotSignal<readonly [number]>;
  readonly tab_rmb_clicked: GodotSignal<readonly [number]>;
  readonly tab_button_pressed: GodotSignal<readonly [number]>;
  readonly active_tab_rearranged: GodotSignal<readonly [number]>;
  add_tab(title?: string): void;
  clear_tabs(): void;
  get_current_tab(): number;
  set_current_tab(index: number): void;
  get_tab_count(): number;
  get_tab_title(index: number): string;
  set_tab_title(index: number, title: string): void;
  get_tab_idx_at_point(point: ControlPoint): number;
  is_tab_disabled(index: number): boolean;
  set_tab_disabled(index: number, disabled: boolean): void;
  move_tab(from: number, to: number): void;
  remove_tab(index: number): void;
  set_tab_count(count: number): void;
  get_previous_active_tab(): number;
  select_previous_available(): boolean;
  select_next_available(): boolean;
  set_tab_icon(index: number, icon: unknown): void;
  get_tab_icon(index: number): unknown;
  set_tab_button_icon(index: number, icon: unknown): void;
  get_tab_button_icon(index: number): unknown;
  set_tab_icon_max_width(index: number, width: number): void;
  get_tab_icon_max_width(index: number): number;
  set_tab_hidden(index: number, hidden: boolean): void;
  is_tab_hidden(index: number): boolean;
  set_tab_metadata(index: number, metadata: unknown): void;
  get_tab_metadata(index: number): unknown;
  set_tab_tooltip(index: number, tooltip: string): void;
  get_tab_tooltip(index: number): string;
  set_tab_text_direction(index: number, direction: number): void;
  get_tab_text_direction(index: number): number;
  set_tab_language(index: number, language: string): void;
  get_tab_language(index: number): string;
  set_tab_alignment(alignment: number): void;
  get_tab_alignment(): number;
  set_clip_tabs(enabled: boolean): void;
  get_clip_tabs(): boolean;
  set_deselect_enabled(enabled: boolean): void;
  get_deselect_enabled(): boolean;
  set_max_tab_width(width: number): void;
  get_max_tab_width(): number;
  set_scrolling_enabled(enabled: boolean): void;
  get_scrolling_enabled(): boolean;
  set_select_with_rmb(enabled: boolean): void;
  get_select_with_rmb(): boolean;
  set_tabs_rearrange_group(group: number): void;
  get_tabs_rearrange_group(): number;
  set_scroll_to_selected(enabled: boolean): void;
  get_scroll_to_selected(): boolean;
  ensure_tab_visible(index: number): void;
  get_tab_rect(index: number): { position: ControlPoint; size: ControlPoint };
  get_tab_offset(): number;
}

function createTabEntry(value = ''): TabEntry {
  return {
    title: title(value), disabled: false, hidden: false, icon: null, buttonIcon: null,
    iconMaxWidth: 0, metadata: null, tooltip: '', language: '', textDirection: 0,
  };
}

function title(value: string): string {
  if (typeof value !== 'string') throw new TypeError('TabBar title requires a String.');
  return value;
}

function indexOf(state: TabBarState, value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= state.tabs.length) {
    throw new RangeError(`${member} index ${String(value)} is outside the retained tab range.`);
  }
  return value;
}

function point(value: ControlPoint): ControlPoint {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError('TabBar.get_tab_idx_at_point requires a finite Vector2 position.');
  }
  return { x: value.x, y: value.y };
}

function domTabAtPoint(control: HTMLElement, value: ControlPoint): number {
  const root = control.getBoundingClientRect();
  const clientX = root.left + value.x;
  const clientY = root.top + value.y;
  const children = Array.from(control.children);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!(child instanceof HTMLElement)) continue;
    const bounds = child.getBoundingClientRect();
    if (clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top && clientY < bounds.bottom) {
      return index;
    }
  }
  return -1;
}

function sync(control: GodotControl, state: TabBarState): void {
  const binding = controlBinding(control);
  binding.state.write(binding.id, {
    tabCurrent: state.current,
    tabTitles: state.tabs.map((tab) => tab.title),
    tabDisabled: state.tabs.map((tab) => tab.disabled),
    onTabSelect(index): void {
      if (state.tabs[index]?.disabled === true) return;
      (control as GodotTabBar).current_tab = index;
    },
    tabCloseDisplayPolicy: state.closeDisplayPolicy,
    onTabClose: (index) => state.closePressed.emit(index),
    onTabHover: (index) => state.hovered.emit(index),
  });
  if (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement) {
    control.replaceChildren(...state.tabs.map((tab, index) => {
      const button = control.ownerDocument.createElement('button');
      button.type = 'button';
      button.role = 'tab';
      button.textContent = tab.title;
      button.disabled = tab.disabled;
      button.hidden = tab.hidden;
      button.title = tab.tooltip;
      button.lang = tab.language;
      button.dir = tab.textDirection === 2 ? 'rtl' : tab.textDirection === 1 ? 'ltr' : 'auto';
      if (state.maxTabWidth > 0) button.style.maxWidth = `${state.maxTabWidth}px`;
      button.draggable = state.dragToRearrange;
      button.setAttribute('aria-selected', String(index === state.current));
      button.addEventListener('click', () => {
        state.clicked.emit(index);
        controlBinding(control).state.read(controlBinding(control).id).onTabSelect?.(index);
      });
      button.addEventListener('mouseenter', () => state.hovered.emit(index));
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        state.rmbClicked.emit(index);
        if (state.selectWithRmb) controlBinding(control).state.read(controlBinding(control).id).onTabSelect?.(index);
      });
      if (state.dragToRearrange) {
        button.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-godot-tab', String(index)));
        button.addEventListener('dragover', (event) => event.preventDefault());
        button.addEventListener('drop', (event) => {
          event.preventDefault();
          const source = Number(event.dataTransfer?.getData('application/x-godot-tab'));
          if (!Number.isSafeInteger(source) || source < 0 || source >= state.tabs.length || source === index) return;
          const [entry] = state.tabs.splice(source, 1);
          state.tabs.splice(index, 0, entry!);
          if (state.current === source) state.current = index;
          else if (source < index && state.current > source && state.current <= index) state.current -= 1;
          else if (index < source && state.current >= index && state.current < source) state.current += 1;
          sync(control, state);
          state.reordered.emit(index);
        });
      }
      const showClose = state.closeDisplayPolicy === 2 ||
        (state.closeDisplayPolicy === 1 && index === state.current);
      if (showClose) {
        const close = control.ownerDocument.createElement('button');
        close.type = 'button';
        close.ariaLabel = `Close ${tab.title}`;
        close.textContent = '×';
        close.addEventListener('click', (event) => { event.stopPropagation(); state.closePressed.emit(index); });
        button.append(close);
      }
      if (tab.buttonIcon !== null) {
        const auxiliary = control.ownerDocument.createElement('button');
        auxiliary.type = 'button';
        auxiliary.ariaLabel = `Tab action ${tab.title}`;
        auxiliary.textContent = '●';
        auxiliary.addEventListener('click', (event) => { event.stopPropagation(); state.buttonPressed.emit(index); });
        button.append(auxiliary);
      }
      return button;
    }));
  }
}

export function bindTabBar(
  control: GodotControl,
  initial: {
    readonly titles?: readonly string[];
    readonly disabled?: readonly boolean[];
    readonly current?: number;
    readonly hitTest?: (point: ControlPoint) => number;
  } = {},
): GodotTabBar {
  const tabBar = control as GodotTabBar;
  const state: TabBarState = {
    tabs: (initial.titles ?? []).map((value, index) => ({ ...createTabEntry(value), disabled: initial.disabled?.[index] ?? false })),
    changed: createSignal<readonly [number]>(),
    ...(initial.hitTest === undefined ? {} : { hitTest: initial.hitTest }),
    current: -1,
    dragToRearrange: false,
    closeDisplayPolicy: 0,
    closePressed: createSignal<readonly [number]>(),
    clicked: createSignal<readonly [number]>(),
    hovered: createSignal<readonly [number]>(),
    rmbClicked: createSignal<readonly [number]>(),
    buttonPressed: createSignal<readonly [number]>(),
    reordered: createSignal<readonly [number]>(),
    alignment: 0,
    clipping: true,
    deselectEnabled: false,
    maxTabWidth: 0,
    scrollingEnabled: true,
    selectWithRmb: false,
    reorderGroup: -1,
    scrollToSelected: true,
    previous: -1,
  };
  const select = (value: number): void => {
    if (value === state.current) return;
    if (value === -1) {
      if (!state.deselectEnabled) return;
      state.previous = state.current;
      state.current = -1;
      sync(control, state);
      state.changed.emit(-1);
      return;
    }
    const index = indexOf(state, value, 'TabBar.current_tab');
    if (state.tabs[index]!.disabled || state.tabs[index]!.hidden) return;
    state.previous = state.current;
    state.current = index;
    sync(control, state);
    state.changed.emit(index);
  };
  const move = (from: number, to: number): void => {
    const source = indexOf(state, from, 'TabBar.move_tab');
    const target = indexOf(state, to, 'TabBar.move_tab');
    if (source === target) return;
    const [entry] = state.tabs.splice(source, 1);
    state.tabs.splice(target, 0, entry!);
    if (state.current === source) state.current = target;
    else if (source < target && state.current > source && state.current <= target) state.current -= 1;
    else if (target < source && state.current >= target && state.current < source) state.current += 1;
    sync(control, state);
  };
  Object.defineProperties(tabBar, {
    current_tab: { enumerable: true, configurable: true, get: () => state.current, set: select },
    drag_to_rearrange_enabled: {
      enumerable: true, configurable: true, get: () => state.dragToRearrange,
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.drag_to_rearrange_enabled requires bool.'); state.dragToRearrange = value; sync(control, state); },
    },
    tab_close_display_policy: {
      enumerable: true, configurable: true, get: () => state.closeDisplayPolicy,
      set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError('TabBar.tab_close_display_policy must be in [0, 2].'); state.closeDisplayPolicy = value; sync(control, state); },
    },
    tab_alignment: { enumerable: true, configurable: true, get: () => state.alignment, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('TabBar.tab_alignment requires an integer.'); state.alignment = value; sync(control, state); } },
    clip_tabs: { enumerable: true, configurable: true, get: () => state.clipping, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.clip_tabs requires bool.'); state.clipping = value; sync(control, state); } },
    deselect_enabled: { enumerable: true, configurable: true, get: () => state.deselectEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.deselect_enabled requires bool.'); state.deselectEnabled = value; } },
    max_tab_width: { enumerable: true, configurable: true, get: () => state.maxTabWidth, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('TabBar.max_tab_width requires a non-negative integer.'); state.maxTabWidth = value; sync(control, state); } },
    scrolling_enabled: { enumerable: true, configurable: true, get: () => state.scrollingEnabled, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.scrolling_enabled requires bool.'); state.scrollingEnabled = value; } },
    select_with_rmb: { enumerable: true, configurable: true, get: () => state.selectWithRmb, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.select_with_rmb requires bool.'); state.selectWithRmb = value; } },
    tabs_rearrange_group: { enumerable: true, configurable: true, get: () => state.reorderGroup, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('TabBar.tabs_rearrange_group requires an integer.'); state.reorderGroup = value; } },
    scroll_to_selected: { enumerable: true, configurable: true, get: () => state.scrollToSelected, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TabBar.scroll_to_selected requires bool.'); state.scrollToSelected = value; } },
    tab_changed: { enumerable: true, configurable: true, value: state.changed.signal },
    tab_close_pressed: { enumerable: true, configurable: true, value: state.closePressed.signal },
    tab_clicked: { enumerable: true, configurable: true, value: state.clicked.signal },
    tab_hovered: { enumerable: true, configurable: true, value: state.hovered.signal },
    tab_rmb_clicked: { enumerable: true, configurable: true, value: state.rmbClicked.signal },
    tab_button_pressed: { enumerable: true, configurable: true, value: state.buttonPressed.signal },
    active_tab_rearranged: { enumerable: true, configurable: true, value: state.reordered.signal },
  });
  Object.assign(tabBar, {
    add_tab(value = ''): void {
      state.tabs.push(createTabEntry(value));
      if (state.tabs.length === 1) state.current = 0;
      sync(control, state);
    },
    clear_tabs(): void {
      state.tabs.length = 0;
      state.current = -1;
      sync(control, state);
    },
    get_current_tab(): number { return state.current; },
    set_current_tab(value: number): void { select(value); },
    get_tab_count(): number { return state.tabs.length; },
    get_tab_title(value: number): string { return state.tabs[indexOf(state, value, 'TabBar.get_tab_title')]!.title; },
    set_tab_title(value: number, next: string): void {
      state.tabs[indexOf(state, value, 'TabBar.set_tab_title')]!.title = title(next);
      sync(control, state);
    },
    get_tab_idx_at_point(value: ControlPoint): number {
      const local = point(value);
      if (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement) return domTabAtPoint(control, local);
      return state.hitTest?.(local) ?? -1;
    },
    is_tab_disabled(value: number): boolean { return state.tabs[indexOf(state, value, 'TabBar.is_tab_disabled')]!.disabled; },
    set_tab_disabled(value: number, disabled: boolean): void {
      if (typeof disabled !== 'boolean') throw new TypeError('TabBar.set_tab_disabled requires bool.');
      state.tabs[indexOf(state, value, 'TabBar.set_tab_disabled')]!.disabled = disabled;
      sync(control, state);
    },
    move_tab(from: number, to: number): void { move(from, to); },
    remove_tab(value: number): void {
      const index = indexOf(state, value, 'TabBar.remove_tab');
      state.tabs.splice(index, 1);
      if (state.current === index) state.current = state.tabs.length === 0 ? -1 : Math.min(index, state.tabs.length - 1);
      else if (state.current > index) state.current -= 1;
      sync(control, state);
    },
    set_tab_count(count: number): void {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('TabBar.set_tab_count requires a non-negative integer.');
      while (state.tabs.length < count) state.tabs.push(createTabEntry());
      if (state.tabs.length > count) state.tabs.length = count;
      if (state.current >= count) state.current = count - 1;
      sync(control, state);
    },
    get_previous_active_tab(): number { return state.previous; },
    select_previous_available(): boolean {
      for (let index = state.current - 1; index >= 0; index -= 1) if (!state.tabs[index]!.disabled && !state.tabs[index]!.hidden) { select(index); return true; }
      return false;
    },
    select_next_available(): boolean {
      for (let index = state.current + 1; index < state.tabs.length; index += 1) if (!state.tabs[index]!.disabled && !state.tabs[index]!.hidden) { select(index); return true; }
      return false;
    },
    set_tab_icon(value: number, icon: unknown): void { state.tabs[indexOf(state, value, 'TabBar.set_tab_icon')]!.icon = icon; sync(control, state); },
    get_tab_icon(value: number): unknown { return state.tabs[indexOf(state, value, 'TabBar.get_tab_icon')]!.icon; },
    set_tab_button_icon(value: number, icon: unknown): void { state.tabs[indexOf(state, value, 'TabBar.set_tab_button_icon')]!.buttonIcon = icon; sync(control, state); },
    get_tab_button_icon(value: number): unknown { return state.tabs[indexOf(state, value, 'TabBar.get_tab_button_icon')]!.buttonIcon; },
    set_tab_icon_max_width(value: number, width: number): void { if (!Number.isSafeInteger(width) || width < 0) throw new RangeError('TabBar.set_tab_icon_max_width requires a non-negative integer.'); state.tabs[indexOf(state, value, 'TabBar.set_tab_icon_max_width')]!.iconMaxWidth = width; sync(control, state); },
    get_tab_icon_max_width(value: number): number { return state.tabs[indexOf(state, value, 'TabBar.get_tab_icon_max_width')]!.iconMaxWidth; },
    set_tab_hidden(value: number, hidden: boolean): void { if (typeof hidden !== 'boolean') throw new TypeError('TabBar.set_tab_hidden requires bool.'); state.tabs[indexOf(state, value, 'TabBar.set_tab_hidden')]!.hidden = hidden; sync(control, state); },
    is_tab_hidden(value: number): boolean { return state.tabs[indexOf(state, value, 'TabBar.is_tab_hidden')]!.hidden; },
    set_tab_metadata(value: number, metadata: unknown): void { state.tabs[indexOf(state, value, 'TabBar.set_tab_metadata')]!.metadata = metadata; },
    get_tab_metadata(value: number): unknown { return state.tabs[indexOf(state, value, 'TabBar.get_tab_metadata')]!.metadata; },
    set_tab_tooltip(value: number, tooltip: string): void { state.tabs[indexOf(state, value, 'TabBar.set_tab_tooltip')]!.tooltip = title(tooltip); sync(control, state); },
    get_tab_tooltip(value: number): string { return state.tabs[indexOf(state, value, 'TabBar.get_tab_tooltip')]!.tooltip; },
    set_tab_text_direction(value: number, direction: number): void { if (!Number.isSafeInteger(direction)) throw new TypeError('TabBar.set_tab_text_direction requires an integer.'); state.tabs[indexOf(state, value, 'TabBar.set_tab_text_direction')]!.textDirection = direction; sync(control, state); },
    get_tab_text_direction(value: number): number { return state.tabs[indexOf(state, value, 'TabBar.get_tab_text_direction')]!.textDirection; },
    set_tab_language(value: number, language: string): void { state.tabs[indexOf(state, value, 'TabBar.set_tab_language')]!.language = title(language); sync(control, state); },
    get_tab_language(value: number): string { return state.tabs[indexOf(state, value, 'TabBar.get_tab_language')]!.language; },
    set_tab_alignment(value: number): void { tabBar.tab_alignment = value; },
    get_tab_alignment(): number { return state.alignment; },
    set_clip_tabs(value: boolean): void { tabBar.clip_tabs = value; },
    get_clip_tabs(): boolean { return state.clipping; },
    set_deselect_enabled(value: boolean): void { tabBar.deselect_enabled = value; },
    get_deselect_enabled(): boolean { return state.deselectEnabled; },
    set_max_tab_width(value: number): void { tabBar.max_tab_width = value; },
    get_max_tab_width(): number { return state.maxTabWidth; },
    set_scrolling_enabled(value: boolean): void { tabBar.scrolling_enabled = value; },
    get_scrolling_enabled(): boolean { return state.scrollingEnabled; },
    set_select_with_rmb(value: boolean): void { tabBar.select_with_rmb = value; },
    get_select_with_rmb(): boolean { return state.selectWithRmb; },
    set_tabs_rearrange_group(value: number): void { tabBar.tabs_rearrange_group = value; },
    get_tabs_rearrange_group(): number { return state.reorderGroup; },
    set_scroll_to_selected(value: boolean): void { tabBar.scroll_to_selected = value; },
    get_scroll_to_selected(): boolean { return state.scrollToSelected; },
    ensure_tab_visible(value: number): void {
      const index = indexOf(state, value, 'TabBar.ensure_tab_visible');
      if (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement) (control.children.item(index) as HTMLElement | null)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    },
    get_tab_rect(value: number): { position: ControlPoint; size: ControlPoint } {
      const index = indexOf(state, value, 'TabBar.get_tab_rect');
      if (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement) {
        const root = control.getBoundingClientRect();
        const bounds = (control.children.item(index) as HTMLElement | null)?.getBoundingClientRect();
        if (bounds !== undefined) return { position: { x: bounds.left - root.left, y: bounds.top - root.top }, size: { x: bounds.width, y: bounds.height } };
      }
      return { position: { x: index * 96, y: 0 }, size: { x: 96, y: 32 } };
    },
    get_tab_offset(): number { return 0; },
  });
  if (state.tabs.length > 0) {
    const requested = initial.current ?? 0;
    state.current = indexOf(state, requested, 'TabBar.current_tab');
  }
  sync(control, state);
  registerGodotObjectIdentity(tabBar, 'TabBar');
  return tabBar;
}

/** Runtime TabBar constructor for DOM/Three roots over a real retained tablist element. */
export function createGodotDomTabBar(
  documentValue: Document = document,
): GodotTabBar & HTMLDivElement {
  const element = documentValue.createElement('div') as HTMLDivElement & GodotControl;
  element.role = 'tablist';
  const state = createControlState();
  registerControlBinding(element, { id: 'tab-bar', state });
  return bindTabBar(element) as GodotTabBar & HTMLDivElement;
}
