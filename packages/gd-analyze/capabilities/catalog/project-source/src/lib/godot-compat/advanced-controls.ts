/** Retained TabContainer, SpinBox, dialog, FileDialog, and Tree behavior. */

import { type GodotTextureProjection, projectGodotTexture } from './button-icon';
import {
  type ControlPoint,
  type ControlRecord,
  controlBinding,
  createControlHandle,
  createControlState,
  type GodotControl,
} from './control-state';
import {
  bindBaseButton,
  bindHSlider,
  bindLineEdit,
  type GodotButtonControl,
  type GodotLineEditControl,
  type GodotRangeControl,
  type RangeState,
} from './control-widgets';
import { registerGodotObjectIdentity } from './object';
import { type PackedStringArray, packedStringArray } from './packed-array';
import { createSignal, type GodotConnection, type GodotSignal, type SignalHandle } from './signal';
import { createGodotDomTabBar, type GodotTabBar } from './tab-bar';
import type { ColorValue } from './variant';

function integer(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
  return value;
}

function text(name: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be String.`);
  return value;
}

function bool(name: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be bool.`);
  return value;
}

function retainedColor(name: string, value: ColorValue): ColorValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Number.isFinite(value.r) ||
    !Number.isFinite(value.g) ||
    !Number.isFinite(value.b) ||
    !Number.isFinite(value.a)
  )
    throw new TypeError(`${name} must be a finite Color.`);
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function colorHex(value: ColorValue): number {
  const channel = (one: number): number => Math.round(Math.max(0, Math.min(1, one)) * 255);
  return (channel(value.r) << 16) | (channel(value.g) << 8) | channel(value.b);
}

export interface GodotSpinBox extends GodotRangeControl {
  prefix: string;
  suffix: string;
  align?: number;
  alignment?: number;
  editable: boolean;
  update_on_text_changed: boolean;
  custom_arrow_step: number;
  get_line_edit(): GodotLineEditControl;
  set_prefix(value: string): void;
  get_prefix(): string;
  set_suffix(value: string): void;
  get_suffix(): string;
  set_alignment(value: number): void;
  get_alignment(): number;
  set_align(value: number): void;
  get_align(): number;
  set_horizontal_alignment(value: number): void;
  get_horizontal_alignment(): number;
  set_editable(enabled: boolean): void;
  is_editable(): boolean;
  set_update_on_text_changed(enabled: boolean): void;
  get_update_on_text_changed(): boolean;
  set_custom_arrow_step(step: number): void;
  get_custom_arrow_step(): number;
  apply(): void;
}

export function bindSpinBox(
  control: GodotControl,
  initial: Partial<RangeState> & {
    readonly prefix?: string;
    readonly suffix?: string;
    readonly align?: number;
    readonly alignment?: number;
    readonly editable?: boolean;
    readonly update_on_text_changed?: boolean;
    readonly custom_arrow_step?: number;
  } = {},
): GodotSpinBox {
  const spin = bindHSlider(control, { ...initial, scrollable: true }) as GodotSpinBox;
  // Authored inherited/instanced controls may not receive a scene-owned dynamic binding. Retain
  // the concrete class at the behavior boundary so `is SpinBox` walks SpinBox -> Range -> Control
  // through object.ts's major-specific ClassDB ancestry instead of seeing only the range behavior.
  registerGodotObjectIdentity(spin, 'SpinBox');
  const binding = controlBinding(control);
  const godotMajor = initial.godot_major ?? 4;
  let prefix = text('SpinBox.prefix', initial.prefix ?? '');
  let suffix = text('SpinBox.suffix', initial.suffix ?? '');
  let alignment = integer(
    `SpinBox.${godotMajor === 4 ? 'alignment' : 'align'}`,
    godotMajor === 4 ? (initial.alignment ?? 0) : (initial.align ?? 0),
  );
  let editable = bool('SpinBox.editable', initial.editable ?? true);
  let updateOnTextChanged = bool(
    'SpinBox.update_on_text_changed',
    initial.update_on_text_changed ?? false,
  );
  let customArrowStep = initial.custom_arrow_step ?? -1;
  if (!Number.isFinite(customArrowStep) || customArrowStep < -1)
    throw new RangeError('SpinBox.custom_arrow_step must be -1 or non-negative.');
  let lineEdit: GodotLineEditControl | undefined;
  const displayText = (): string => `${prefix}${String(spin.value)}${suffix}`;
  const sync = (): void => {
    binding.state.write(binding.id, {
      spinPrefix: prefix,
      spinSuffix: suffix,
      spinAlign: alignment,
    });
    lineEdit?.set_text(displayText());
  };
  const setAlignment = (value: number): void => {
    const member = godotMajor === 4 ? 'alignment' : 'align';
    const next = integer(`SpinBox.${member}`, value);
    const maximum = godotMajor === 4 ? 3 : 2;
    if (next < 0 || next > maximum) {
      throw new RangeError(
        `SpinBox.${member} requires an integer from 0 through ${String(maximum)} in Godot ${String(godotMajor)}.`,
      );
    }
    lineEdit?.set_alignment(next);
    alignment = next;
    sync();
  };
  Object.defineProperties(spin, {
    prefix: {
      enumerable: true,
      configurable: true,
      get: () => prefix,
      set: (value: string) => {
        prefix = text('SpinBox.prefix', value);
        sync();
      },
    },
    suffix: {
      enumerable: true,
      configurable: true,
      get: () => suffix,
      set: (value: string) => {
        suffix = text('SpinBox.suffix', value);
        sync();
      },
    },
    [godotMajor === 4 ? 'alignment' : 'align']: {
      enumerable: true,
      configurable: true,
      get: () => alignment,
      set: setAlignment,
    },
    editable: {
      enumerable: true,
      configurable: true,
      get: () => editable,
      set: (value: boolean) => {
        editable = bool('SpinBox.editable', value);
        if (lineEdit !== undefined) lineEdit.editable = editable;
        const element = binding.state.read(binding.id).focusElement;
        if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement)
          element.readOnly = !editable;
      },
    },
    update_on_text_changed: {
      enumerable: true,
      configurable: true,
      get: () => updateOnTextChanged,
      set: (value: boolean) => {
        updateOnTextChanged = bool('SpinBox.update_on_text_changed', value);
      },
    },
    custom_arrow_step: {
      enumerable: true,
      configurable: true,
      get: () => customArrowStep,
      set: (value: number) => {
        if (!Number.isFinite(value) || value < -1)
          throw new RangeError('SpinBox.custom_arrow_step must be -1 or non-negative.');
        customArrowStep = value;
      },
    },
  });
  const lineState = createControlState();
  const retainedSize = binding.state.read(binding.id).size ??
    binding.state.authored(binding.id)?.size ?? { x: 0, y: 0 };
  const lineControl = createControlHandle(
    'line-edit',
    {
      visible: true,
      text: displayText(),
      texture: '',
      position: { x: 0, y: 0 },
      size: { x: retainedSize.x, y: retainedSize.y },
      custom_minimum_size: { x: 0, y: 0 },
      size_flags_horizontal: 1,
      size_flags_vertical: 1,
      mouse_filter: 0,
      focusMode: 2,
      pivot_offset: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      modulate: { r: 1, g: 1, b: 1, a: 1 },
    },
    lineState,
  );
  lineEdit = bindLineEdit(lineControl, {
    dialect: godotMajor,
    text: displayText(),
    editable,
    alignment,
  });
  registerGodotObjectIdentity(lineEdit, 'LineEdit');
  const lineBinding = controlBinding(lineEdit);
  binding.state.write(binding.id, {
    focusElement: null,
    bindFocusElement(element): void {
      binding.state.write(binding.id, { focusElement: element });
      lineBinding.state.read(lineBinding.id).bindFocusElement?.(element);
    },
  });
  spin.value_changed.connect(() => lineEdit?.set_text(displayText()));
  lineEdit.text_submitted.connect((value) => {
    const withoutPrefix =
      prefix !== '' && value.startsWith(prefix) ? value.slice(prefix.length) : value;
    const numeric =
      suffix !== '' && withoutPrefix.endsWith(suffix)
        ? withoutPrefix.slice(0, -suffix.length)
        : withoutPrefix;
    const parsed = Number(numeric.trim());
    if (Number.isFinite(parsed)) spin.value = parsed;
    lineEdit?.set_text(displayText());
  });
  lineEdit.text_changed.connect((value) => {
    if (!updateOnTextChanged) return;
    const withoutPrefix =
      prefix !== '' && value.startsWith(prefix) ? value.slice(prefix.length) : value;
    const numeric =
      suffix !== '' && withoutPrefix.endsWith(suffix)
        ? withoutPrefix.slice(0, -suffix.length)
        : withoutPrefix;
    const parsed = Number(numeric.trim());
    if (Number.isFinite(parsed)) spin.value = parsed;
  });
  spin.get_line_edit = () => lineEdit!;
  spin.set_prefix = (value: string): void => {
    spin.prefix = value;
  };
  spin.get_prefix = (): string => prefix;
  spin.set_suffix = (value: string): void => {
    spin.suffix = value;
  };
  spin.get_suffix = (): string => suffix;
  spin.set_alignment = setAlignment;
  spin.get_alignment = (): number => alignment;
  spin.set_align = setAlignment;
  spin.get_align = (): number => alignment;
  spin.set_horizontal_alignment = setAlignment;
  spin.get_horizontal_alignment = (): number => alignment;
  spin.set_editable = (value: boolean): void => {
    spin.editable = value;
  };
  spin.is_editable = (): boolean => editable;
  spin.set_update_on_text_changed = (value: boolean): void => {
    spin.update_on_text_changed = value;
  };
  spin.get_update_on_text_changed = (): boolean => updateOnTextChanged;
  spin.set_custom_arrow_step = (value: number): void => {
    spin.custom_arrow_step = value;
  };
  spin.get_custom_arrow_step = (): number => customArrowStep;
  spin.apply = (): void => {
    lineEdit?.submit();
  };
  sync();
  return spin;
}

export type GodotTabBarSurface = Omit<GodotTabBar, keyof GodotControl>;

export interface GodotTabContainer<TTabBar extends GodotTabBarSurface = GodotTabBar>
  extends GodotControl {
  current_tab: number;
  tabs_visible: boolean;
  all_tabs_in_front: boolean;
  drag_to_rearrange_enabled: boolean;
  tabs_rearrange_group: number;
  tab_alignment: number;
  clip_tabs: boolean;
  use_hidden_tabs_for_min_size: boolean;
  deselect_enabled: boolean;
  readonly tab_changed: GodotSignal<readonly [number]>;
  readonly tab_selected: GodotSignal<readonly [number]>;
  readonly tab_hovered: GodotSignal<readonly [number]>;
  get_current_tab(): number;
  get_current_tab_control(): object | null;
  get_tab_bar(): TTabBar;
  get_tab_control(index: number): object;
  get_tab_count(): number;
  get_tab_idx_from_control(control: object): number;
  set_tab_disabled(index: number, disabled: boolean): void;
  set_tab_title(index: number, title: string): void;
  get_tab_title(index: number): string;
  is_tab_disabled(index: number): boolean;
  set_tab_hidden(index: number, hidden: boolean): void;
  is_tab_hidden(index: number): boolean;
  set_tab_icon(index: number, icon: unknown): void;
  get_tab_icon(index: number): unknown;
  set_tab_metadata(index: number, metadata: unknown): void;
  get_tab_metadata(index: number): unknown;
  set_tab_tooltip(index: number, tooltip: string): void;
  get_tab_tooltip(index: number): string;
  select_previous_available(): boolean;
  select_next_available(): boolean;
}

interface TabState<TTabBar extends GodotTabBarSurface = GodotTabBar> {
  readonly pages: object[];
  readonly titles: string[];
  readonly disabled: boolean[];
  readonly hidden: boolean[];
  readonly icons: unknown[];
  readonly metadata: unknown[];
  readonly tooltips: string[];
  readonly changed: SignalHandle<readonly [number]>;
  readonly selected: SignalHandle<readonly [number]>;
  readonly hovered: SignalHandle<readonly [number]>;
  current: number;
  readonly tabBar: TTabBar | undefined;
  syncingTabBar: boolean;
  tabsVisible: boolean;
  allTabsInFront: boolean;
  dragToRearrange: boolean;
  rearrangeGroup: number;
  alignment: number;
  clipTabs: boolean;
  hiddenTabsForMinimum: boolean;
  deselectEnabled: boolean;
}

const TABS = new WeakMap<object, TabState<GodotTabBarSurface>>();

function tabIndex(state: TabState<GodotTabBarSurface>, index: number, member: string): number {
  const next = integer(`${member} index`, index);
  if (next < 0 || next >= state.pages.length)
    throw new RangeError(`${member} index ${next} is out of range.`);
  return next;
}

function syncTabs(control: GodotControl, state: TabState<GodotTabBarSurface>): void {
  state.pages.forEach((page, index) => {
    if (typeof page === 'object' && page !== null && 'visible' in page) {
      (page as { visible: boolean }).visible = index === state.current && !state.hidden[index];
    }
  });
  const binding = controlBinding(control);
  binding.state.write(binding.id, {
    tabCurrent: state.current,
    tabTitles: [...state.titles],
    tabDisabled: [...state.disabled],
    onTabSelect(index): void {
      (control as GodotTabContainer).current_tab = index;
    },
  });
  if (state.tabBar !== undefined) {
    state.syncingTabBar = true;
    try {
      state.tabBar.clear_tabs();
      state.titles.forEach((title, index) => {
        state.tabBar!.add_tab(title);
        state.tabBar!.set_tab_disabled(index, state.disabled[index] ?? false);
        state.tabBar!.set_tab_hidden(index, state.hidden[index] ?? false);
        state.tabBar!.set_tab_icon(index, state.icons[index] ?? null);
        state.tabBar!.set_tab_metadata(index, state.metadata[index]);
        state.tabBar!.set_tab_tooltip(index, state.tooltips[index] ?? '');
      });
      if (state.current >= 0) state.tabBar.current_tab = state.current;
    } finally {
      state.syncingTabBar = false;
    }
  }
}

export function bindTabContainer<TTabBar extends GodotTabBarSurface = GodotTabBar>(
  control: GodotControl,
  initial: {
    readonly pages: readonly object[];
    readonly titles?: readonly string[];
    readonly current?: number;
    readonly disabled?: readonly boolean[];
    readonly tabBar?: TTabBar;
    readonly hidden?: readonly boolean[];
    readonly icons?: readonly unknown[];
    readonly metadata?: readonly unknown[];
    readonly tooltips?: readonly string[];
  },
): GodotTabContainer<TTabBar> {
  const tabs = control as GodotTabContainer<TTabBar>;
  const retainedTabBar = (initial.tabBar ??
    (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement
      ? createGodotDomTabBar(control.ownerDocument)
      : undefined)) as TTabBar | undefined;
  if (
    retainedTabBar !== undefined &&
    typeof HTMLElement !== 'undefined' &&
    control instanceof HTMLElement &&
    retainedTabBar instanceof HTMLElement &&
    retainedTabBar.parentElement !== control
  )
    control.prepend(retainedTabBar);
  const state: TabState<TTabBar> = {
    pages: [...initial.pages],
    titles: initial.pages.map((_, index) =>
      text('TabContainer title', initial.titles?.[index] ?? `Tab ${index + 1}`),
    ),
    disabled: initial.pages.map((_, index) => initial.disabled?.[index] ?? false),
    hidden: initial.pages.map((_, index) => initial.hidden?.[index] ?? false),
    icons: initial.pages.map((_, index) => initial.icons?.[index] ?? null),
    metadata: initial.pages.map((_, index) => initial.metadata?.[index] ?? null),
    tooltips: initial.pages.map((_, index) => initial.tooltips?.[index] ?? ''),
    changed: createSignal<readonly [number]>(),
    selected: createSignal<readonly [number]>(),
    hovered: createSignal<readonly [number]>(),
    current: -1,
    tabBar: retainedTabBar,
    syncingTabBar: false,
    tabsVisible: true,
    allTabsInFront: false,
    dragToRearrange: false,
    rearrangeGroup: -1,
    alignment: 0,
    clipTabs: true,
    hiddenTabsForMinimum: false,
    deselectEnabled: false,
  };
  TABS.set(control, state);
  state.tabBar?.tab_changed.connect((index) => {
    if (!state.syncingTabBar) (control as GodotTabContainer).current_tab = index;
  });
  state.tabBar?.tab_hovered.connect((index) => state.hovered.emit(index));
  const setCurrent = (value: number): void => {
    const index = tabIndex(state, value, 'TabContainer.current_tab');
    if (state.disabled[index] || state.hidden[index]) return;
    if (index === state.current) return;
    state.current = index;
    syncTabs(control, state);
    state.changed.emit(index);
    state.selected.emit(index);
  };
  Object.defineProperties(tabs, {
    current_tab: {
      enumerable: true,
      configurable: true,
      get: () => state.current,
      set: setCurrent,
    },
    tab_changed: { enumerable: true, configurable: true, value: state.changed.signal },
    tab_selected: { enumerable: true, configurable: true, value: state.selected.signal },
    tab_hovered: { enumerable: true, configurable: true, value: state.hovered.signal },
    tabs_visible: {
      enumerable: true,
      configurable: true,
      get: () => state.tabsVisible,
      set: (value: boolean) => {
        state.tabsVisible = bool('TabContainer.tabs_visible', value);
        if (state.tabBar !== undefined && 'visible' in state.tabBar)
          (state.tabBar as unknown as { visible: boolean }).visible = value;
      },
    },
    all_tabs_in_front: {
      enumerable: true,
      configurable: true,
      get: () => state.allTabsInFront,
      set: (value: boolean) => {
        state.allTabsInFront = bool('TabContainer.all_tabs_in_front', value);
      },
    },
    drag_to_rearrange_enabled: {
      enumerable: true,
      configurable: true,
      get: () => state.dragToRearrange,
      set: (value: boolean) => {
        state.dragToRearrange = bool('TabContainer.drag_to_rearrange_enabled', value);
        if (state.tabBar !== undefined) state.tabBar.drag_to_rearrange_enabled = value;
      },
    },
    tabs_rearrange_group: {
      enumerable: true,
      configurable: true,
      get: () => state.rearrangeGroup,
      set: (value: number) => {
        state.rearrangeGroup = integer('TabContainer.tabs_rearrange_group', value);
        if (state.tabBar !== undefined) state.tabBar.tabs_rearrange_group = value;
      },
    },
    tab_alignment: {
      enumerable: true,
      configurable: true,
      get: () => state.alignment,
      set: (value: number) => {
        state.alignment = integer('TabContainer.tab_alignment', value);
        if (state.tabBar !== undefined) state.tabBar.tab_alignment = value;
      },
    },
    clip_tabs: {
      enumerable: true,
      configurable: true,
      get: () => state.clipTabs,
      set: (value: boolean) => {
        state.clipTabs = bool('TabContainer.clip_tabs', value);
        if (state.tabBar !== undefined) state.tabBar.clip_tabs = value;
      },
    },
    use_hidden_tabs_for_min_size: {
      enumerable: true,
      configurable: true,
      get: () => state.hiddenTabsForMinimum,
      set: (value: boolean) => {
        state.hiddenTabsForMinimum = bool('TabContainer.use_hidden_tabs_for_min_size', value);
      },
    },
    deselect_enabled: {
      enumerable: true,
      configurable: true,
      get: () => state.deselectEnabled,
      set: (value: boolean) => {
        state.deselectEnabled = bool('TabContainer.deselect_enabled', value);
        if (state.tabBar !== undefined) state.tabBar.deselect_enabled = value;
      },
    },
  });
  Object.assign(tabs, {
    get_current_tab(): number {
      return state.current;
    },
    get_current_tab_control(): object | null {
      return state.pages[state.current] ?? null;
    },
    get_tab_bar(): TTabBar {
      if (state.tabBar === undefined)
        throw new Error('TabContainer.get_tab_bar requires the retained native tab strip.');
      return state.tabBar;
    },
    get_tab_control(index: number): object {
      return state.pages[tabIndex(state, index, 'TabContainer.get_tab_control')]!;
    },
    get_tab_count(): number {
      return state.pages.length;
    },
    get_tab_idx_from_control(page: object): number {
      return state.pages.indexOf(page);
    },
    set_tab_disabled(index: number, disabled: boolean): void {
      const resolved = tabIndex(state, index, 'TabContainer.set_tab_disabled');
      state.disabled[resolved] = bool('TabContainer.set_tab_disabled disabled', disabled);
      syncTabs(control, state);
    },
    set_tab_title(index: number, title: string): void {
      state.titles[tabIndex(state, index, 'TabContainer.set_tab_title')] = text(
        'TabContainer.set_tab_title title',
        title,
      );
      syncTabs(control, state);
    },
    get_tab_title(index: number): string {
      return state.titles[tabIndex(state, index, 'TabContainer.get_tab_title')]!;
    },
    is_tab_disabled(index: number): boolean {
      return state.disabled[tabIndex(state, index, 'TabContainer.is_tab_disabled')] ?? false;
    },
    set_tab_hidden(index: number, hidden: boolean): void {
      state.hidden[tabIndex(state, index, 'TabContainer.set_tab_hidden')] = bool(
        'TabContainer.set_tab_hidden hidden',
        hidden,
      );
      syncTabs(control, state);
    },
    is_tab_hidden(index: number): boolean {
      return state.hidden[tabIndex(state, index, 'TabContainer.is_tab_hidden')] ?? false;
    },
    set_tab_icon(index: number, icon: unknown): void {
      state.icons[tabIndex(state, index, 'TabContainer.set_tab_icon')] = icon;
      syncTabs(control, state);
    },
    get_tab_icon(index: number): unknown {
      return state.icons[tabIndex(state, index, 'TabContainer.get_tab_icon')] ?? null;
    },
    set_tab_metadata(index: number, metadata: unknown): void {
      state.metadata[tabIndex(state, index, 'TabContainer.set_tab_metadata')] = metadata;
      syncTabs(control, state);
    },
    get_tab_metadata(index: number): unknown {
      return state.metadata[tabIndex(state, index, 'TabContainer.get_tab_metadata')];
    },
    set_tab_tooltip(index: number, tooltip: string): void {
      state.tooltips[tabIndex(state, index, 'TabContainer.set_tab_tooltip')] = text(
        'TabContainer tooltip',
        tooltip,
      );
      syncTabs(control, state);
    },
    get_tab_tooltip(index: number): string {
      return state.tooltips[tabIndex(state, index, 'TabContainer.get_tab_tooltip')] ?? '';
    },
    select_previous_available(): boolean {
      for (let index = state.current - 1; index >= 0; index -= 1)
        if (!state.disabled[index] && !state.hidden[index]) {
          setCurrent(index);
          return true;
        }
      return false;
    },
    select_next_available(): boolean {
      for (let index = state.current + 1; index < state.pages.length; index += 1)
        if (!state.disabled[index] && !state.hidden[index]) {
          setCurrent(index);
          return true;
        }
      return false;
    },
  });
  if (state.pages.length > 0) setCurrent(initial.current ?? 0);
  else syncTabs(control, state);
  return tabs;
}

export interface GodotDialogButton extends GodotButtonControl {}

export function createDialogButton(label: string): GodotDialogButton {
  const button = bindBaseButton(
    createControlHandle(
      'dialog-button',
      {
        visible: true,
        text: text('Dialog button text', label),
        texture: '',
        position: { x: 0, y: 0 },
        size: { x: 0, y: 0 },
        custom_minimum_size: { x: 0, y: 0 },
        size_flags_horizontal: 1,
        size_flags_vertical: 1,
        mouse_filter: 0,
        focusMode: 2,
        pivot_offset: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        modulate: { r: 1, g: 1, b: 1, a: 1 },
      },
      createControlState(),
    ),
    { godot_major: 4 },
  );
  registerGodotObjectIdentity(button, 'Button');
  return button;
}

function activateDialogButton(button: GodotDialogButton): void {
  if (button.press()) button.release();
}

export interface GodotDialogLabel extends GodotControl {
  set_text(value: string): void;
  get_text(): string;
}

export interface GodotAcceptDialog extends GodotControl {
  dialog_text: string;
  dialog_autowrap: boolean;
  dialog_autowrap_mode: number;
  dialog_hide_on_ok: boolean;
  dialog_close_on_escape: boolean;
  ok_button_text: string;
  readonly confirmed: GodotSignal<readonly []>;
  readonly canceled: GodotSignal<readonly []>;
  readonly custom_action: GodotSignal<readonly [string]>;
  readonly about_to_popup: GodotSignal<readonly []>;
  get_ok(): GodotDialogButton;
  get_ok_button(): GodotDialogButton;
  get_label(): GodotDialogLabel;
  show(): void;
  hide(): void;
  popup_centered(minSize?: ControlPoint): void;
  add_button(text: string, right?: boolean, action?: string): GodotDialogButton;
  add_cancel(text?: string): GodotDialogButton;
  add_cancel_button(text: string): GodotDialogButton;
  remove_button(button: GodotDialogButton): void;
  set_text(value: string): void;
  get_text(): string;
  set_hide_on_ok(enabled: boolean): void;
  get_hide_on_ok(): boolean;
  set_autowrap(enabled: boolean): void;
  has_autowrap(): boolean;
  set_autowrap_mode(mode: number): void;
  get_autowrap_mode(): number;
  set_close_on_escape(enabled: boolean): void;
  get_close_on_escape(): boolean;
  set_ok_button_text(value: string): void;
  get_ok_button_text(): string;
  register_text_enter(lineEdit: unknown): void;
  remove_text_enter(lineEdit: unknown): void;
  confirm(): void;
  cancel(): void;
}

export interface GodotConfirmationDialog extends GodotAcceptDialog {
  cancel_button_text: string;
  get_cancel(): GodotDialogButton;
  get_cancel_button(): GodotDialogButton;
  set_cancel_button_text(value: string): void;
  get_cancel_button_text(): string;
}

interface DialogState {
  readonly confirmed: SignalHandle<readonly []>;
  readonly aboutToPopup: SignalHandle<readonly []>;
  readonly canceled: SignalHandle<readonly []>;
  readonly customAction: SignalHandle<readonly [string]>;
  readonly ok: GodotDialogButton;
  readonly buttons: GodotDialogButton[];
  readonly buttonConnections: Map<GodotDialogButton, GodotConnection>;
  cancel?: GodotDialogButton;
  text: string;
  autowrap: boolean;
  autowrapMode: number;
  hideOnOk: boolean;
  closeOnEscape: boolean;
  readonly textEnterControls: Set<unknown>;
  readonly label: GodotDialogLabel;
}

const DIALOGS = new WeakMap<object, DialogState>();

function syncDialog(control: GodotControl, state: DialogState): void {
  const binding = controlBinding(control);
  binding.state.write(binding.id, {
    dialogText: state.text,
    dialogAutowrap: state.autowrap,
    dialogAutowrapMode: state.autowrapMode,
    dialogHideOnOk: state.hideOnOk,
    dialogCloseOnEscape: state.closeOnEscape,
    dialogButtons: state.buttons.map((button) => button.text),
    onDialogConfirm(): void {
      activateDialogButton(state.ok);
    },
    onDialogCancel(): void {
      if (!state.closeOnEscape) return;
      if (state.cancel !== undefined) activateDialogButton(state.cancel);
      else {
        state.canceled.emit();
        control.visible = false;
      }
    },
    onDialogButton(index): void {
      const button = state.buttons[index];
      if (button !== undefined) activateDialogButton(button);
    },
  });
}

export function bindAcceptDialog(
  control: GodotControl,
  initial: {
    readonly text?: string;
    readonly autowrap?: boolean;
    readonly autowrapMode?: number;
    readonly closeOnEscape?: boolean;
    readonly confirmation?: boolean;
    readonly viewportSize?: () => ControlPoint;
    readonly popupCentered?: (minSize: ControlPoint) => void;
  } = {},
): GodotAcceptDialog | GodotConfirmationDialog {
  const dialog = control as GodotConfirmationDialog;
  const ok = createDialogButton('OK');
  const labelControl = createControlHandle(
    'dialog-label',
    {
      visible: true,
      text: text('AcceptDialog.dialog_text', initial.text ?? ''),
      texture: '',
      position: { x: 0, y: 0 },
      size: { x: 0, y: 0 },
      custom_minimum_size: { x: 0, y: 0 },
      size_flags_horizontal: 3,
      size_flags_vertical: 1,
      mouse_filter: 2,
      focusMode: 0,
      pivot_offset: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      modulate: { r: 1, g: 1, b: 1, a: 1 },
    },
    createControlState(),
  );
  const retainedLabelText = Object.getOwnPropertyDescriptor(labelControl, 'text');
  if (retainedLabelText?.get === undefined || retainedLabelText.set === undefined) {
    throw new Error('AcceptDialog retained Label requires the canonical Control text property.');
  }
  let dialogState: DialogState | undefined;
  const label: GodotDialogLabel = Object.assign(labelControl, {
    set_text(value: string): void {
      label.text = value;
    },
    get_text(): string {
      return label.text;
    },
  });
  const state: DialogState = {
    confirmed: createSignal<readonly []>(),
    aboutToPopup: createSignal<readonly []>(),
    canceled: createSignal<readonly []>(),
    customAction: createSignal<readonly [string]>(),
    ok,
    buttons: [ok],
    buttonConnections: new Map(),
    text: text('AcceptDialog.dialog_text', initial.text ?? ''),
    autowrap: initial.autowrap ?? false,
    autowrapMode: initial.autowrapMode ?? 0,
    hideOnOk: true,
    closeOnEscape: initial.closeOnEscape ?? true,
    textEnterControls: new Set(),
    label,
  };
  dialogState = state;
  Object.defineProperty(label, 'text', {
    enumerable: true,
    configurable: true,
    get: () => dialogState?.text ?? retainedLabelText.get!.call(labelControl),
    set: (value: string) => {
      const retained = text('AcceptDialog label text', value);
      retainedLabelText.set!.call(labelControl, retained);
      if (dialogState !== undefined) {
        dialogState.text = retained;
        syncDialog(control, dialogState);
      }
    },
  });
  registerGodotObjectIdentity(label, 'Label');
  state.ok.pressed.connect(() => {
    state.confirmed.emit();
    if (state.hideOnOk) control.visible = false;
  });
  if (initial.confirmation) {
    state.cancel = createDialogButton('Cancel');
    state.cancel.pressed.connect(() => {
      state.canceled.emit();
      control.visible = false;
    });
    state.buttons.push(state.cancel);
  }
  DIALOGS.set(control, state);
  Object.defineProperties(dialog, {
    dialog_text: {
      enumerable: true,
      configurable: true,
      get: () => state.text,
      set: (value: string) => {
        label.text = text('AcceptDialog.dialog_text', value);
      },
    },
    dialog_autowrap: {
      enumerable: true,
      configurable: true,
      get: () => state.autowrap,
      set: (value: boolean) => {
        state.autowrap = bool('AcceptDialog.dialog_autowrap', value);
        syncDialog(control, state);
      },
    },
    dialog_autowrap_mode: {
      enumerable: true,
      configurable: true,
      get: () => state.autowrapMode,
      set: (value: number) => {
        state.autowrapMode = integer('AcceptDialog.dialog_autowrap_mode', value);
        syncDialog(control, state);
      },
    },
    dialog_hide_on_ok: {
      enumerable: true,
      configurable: true,
      get: () => state.hideOnOk,
      set: (value: boolean) => {
        state.hideOnOk = bool('AcceptDialog.dialog_hide_on_ok', value);
      },
    },
    dialog_close_on_escape: {
      enumerable: true,
      configurable: true,
      get: () => state.closeOnEscape,
      set: (value: boolean) => {
        state.closeOnEscape = bool('AcceptDialog.dialog_close_on_escape', value);
      },
    },
    ok_button_text: {
      enumerable: true,
      configurable: true,
      get: () => state.ok.text,
      set: (value: string) => {
        state.ok.text = text('AcceptDialog.ok_button_text', value);
        syncDialog(control, state);
      },
    },
    confirmed: { enumerable: true, configurable: true, value: state.confirmed.signal },
    canceled: { enumerable: true, configurable: true, value: state.canceled.signal },
    custom_action: { enumerable: true, configurable: true, value: state.customAction.signal },
    about_to_popup: { enumerable: true, configurable: true, value: state.aboutToPopup.signal },
  });
  Object.assign(dialog, {
    get_ok(): GodotDialogButton {
      return state.ok;
    },
    get_ok_button(): GodotDialogButton {
      return state.ok;
    },
    get_label(): GodotDialogLabel {
      return state.label;
    },
    show(): void {
      control.visible = true;
    },
    hide(): void {
      control.visible = false;
    },
    popup_centered(requested: ControlPoint = { x: 0, y: 0 }): void {
      if (
        typeof requested !== 'object' ||
        requested === null ||
        !Number.isSafeInteger(requested.x) ||
        !Number.isSafeInteger(requested.y) ||
        requested.x < 0 ||
        requested.y < 0
      ) {
        throw new RangeError('Window.popup_centered minsize must be a non-negative Vector2i.');
      }
      state.aboutToPopup.emit();
      if (initial.popupCentered !== undefined) {
        initial.popupCentered(requested);
        control.visible = true;
        return;
      }
      const viewport = initial.viewportSize?.();
      if (viewport === undefined) {
        throw new Error('Window.popup_centered requires the retained parent Viewport dimensions.');
      }
      const size = requested.x === 0 && requested.y === 0 ? control.size : requested;
      control.size = { x: size.x, y: size.y };
      control.position = {
        x: Math.floor((viewport.x - size.x) / 2),
        y: Math.floor((viewport.y - size.y) / 2),
      };
      control.visible = true;
    },
    get_cancel(): GodotDialogButton {
      if (state.cancel === undefined)
        throw new Error('ConfirmationDialog.get_cancel requires a ConfirmationDialog.');
      return state.cancel;
    },
    add_button(label: string, right = false, action = ''): GodotDialogButton {
      const placeRight = bool('AcceptDialog.add_button right', right);
      const actionName = text('AcceptDialog.add_button action', action);
      const button = createDialogButton(label);
      if (actionName !== '') {
        state.buttonConnections.set(
          button,
          button.pressed.connect(() => state.customAction.emit(actionName)),
        );
      }
      if (placeRight) state.buttons.push(button);
      else state.buttons.splice(Math.max(0, state.buttons.indexOf(state.ok)), 0, button);
      syncDialog(control, state);
      return button;
    },
    add_cancel(label = 'Cancel'): GodotDialogButton {
      const button = createDialogButton(label);
      state.buttonConnections.set(
        button,
        button.pressed.connect(() => {
          state.canceled.emit();
          control.visible = false;
        }),
      );
      state.buttons.push(button);
      syncDialog(control, state);
      return button;
    },
    add_cancel_button(label: string): GodotDialogButton {
      return dialog.add_cancel(label);
    },
    remove_button(button: GodotDialogButton): void {
      if (button === state.ok || button === state.cancel) {
        throw new Error(
          'AcceptDialog.remove_button only removes custom buttons returned by add_button().',
        );
      }
      const index = state.buttons.indexOf(button);
      if (index < 0)
        throw new Error('AcceptDialog.remove_button requires a button owned by this dialog.');
      state.buttonConnections.get(button)?.disconnect();
      state.buttonConnections.delete(button);
      state.buttons.splice(index, 1);
      syncDialog(control, state);
    },
    set_text(value: string): void {
      dialog.dialog_text = value;
    },
    get_text(): string {
      return state.text;
    },
    set_hide_on_ok(enabled: boolean): void {
      dialog.dialog_hide_on_ok = enabled;
    },
    get_hide_on_ok(): boolean {
      return state.hideOnOk;
    },
    set_autowrap(enabled: boolean): void {
      dialog.dialog_autowrap = enabled;
    },
    has_autowrap(): boolean {
      return state.autowrap;
    },
    set_autowrap_mode(mode: number): void {
      dialog.dialog_autowrap_mode = mode;
    },
    get_autowrap_mode(): number {
      return state.autowrapMode;
    },
    set_close_on_escape(enabled: boolean): void {
      dialog.dialog_close_on_escape = enabled;
    },
    get_close_on_escape(): boolean {
      return state.closeOnEscape;
    },
    set_ok_button_text(value: string): void {
      dialog.ok_button_text = value;
    },
    get_ok_button_text(): string {
      return state.ok.text;
    },
    register_text_enter(lineEdit: unknown): void {
      state.textEnterControls.add(lineEdit);
    },
    remove_text_enter(lineEdit: unknown): void {
      state.textEnterControls.delete(lineEdit);
    },
    confirm(): void {
      activateDialogButton(state.ok);
    },
    cancel(): void {
      if (state.cancel !== undefined) activateDialogButton(state.cancel);
      else {
        state.canceled.emit();
        control.visible = false;
      }
    },
    get_cancel_button(): GodotDialogButton {
      if (state.cancel === undefined)
        throw new Error('ConfirmationDialog.get_cancel_button requires a ConfirmationDialog.');
      return state.cancel;
    },
    set_cancel_button_text(value: string): void {
      if (state.cancel === undefined)
        throw new Error('ConfirmationDialog.cancel_button_text requires a ConfirmationDialog.');
      state.cancel.text = text('ConfirmationDialog.cancel_button_text', value);
      syncDialog(control, state);
    },
    get_cancel_button_text(): string {
      if (state.cancel === undefined)
        throw new Error('ConfirmationDialog.cancel_button_text requires a ConfirmationDialog.');
      return state.cancel.text;
    },
  });
  if (initial.confirmation) {
    Object.defineProperty(dialog, 'cancel_button_text', {
      enumerable: true,
      configurable: true,
      get: () => dialog.get_cancel_button_text(),
      set: (value: string) => {
        dialog.set_cancel_button_text(value);
      },
    });
  }
  syncDialog(control, state);
  return dialog;
}

export interface GodotFileDialog extends GodotAcceptDialog {
  title: string;
  exclusive: boolean;
  access: number;
  current_dir: string;
  current_file: string;
  current_path: string;
  file_mode: number;
  mode: number;
  filters: PackedStringArray;
  show_hidden_files: boolean;
  use_native_dialog: boolean;
  root_subfolder: string;
  display_mode: number;
  filename_filter: string;
  readonly file_selected: GodotSignal<readonly [string]>;
  readonly files_selected: GodotSignal<readonly [PackedStringArray]>;
  readonly dir_selected: GodotSignal<readonly [string]>;
  readonly about_to_popup: GodotSignal<readonly []>;
  add_filter(filter: string, description?: string, mimeType?: string): void;
  clear_filters(): void;
  get_access(): number;
  get_current_dir(): string;
  get_current_file(): string;
  get_current_path(): string;
  get_file_mode(): number;
  get_filters(): PackedStringArray;
  get_option_count(): number;
  get_option_name(option: number): string;
  get_option_values(option: number): PackedStringArray;
  get_option_default(option: number): number;
  set_option_name(option: number, name: string): void;
  set_option_values(option: number, values: Iterable<string>): void;
  set_option_default(option: number, defaultValue: number): void;
  add_option(name: string, values: Iterable<string>, defaultValue?: number): void;
  clear_options(): void;
  set_show_hidden_files(show: boolean): void;
  is_showing_hidden_files(): boolean;
  set_use_native_dialog(enabled: boolean): void;
  get_use_native_dialog(): boolean;
  set_root_subfolder(path: string): void;
  get_root_subfolder(): string;
  set_display_mode(mode: number): void;
  get_display_mode(): number;
  set_filename_filter(filter: string): void;
  get_filename_filter(): string;
  set_filters(filters: Iterable<string>): void;
  set_access(access: number): void;
  set_current_dir(path: string): void;
  set_current_file(file: string): void;
  set_file_mode(mode: number): void;
  set_title(title: string): void;
  get_title(): string;
  popup(): void;
  popup_centered_ratio(ratio?: number): void;
  popup_file_dialog(): void;
}

export function bindFileDialog(
  control: GodotControl,
  options: {
    readonly popupCenteredRatio?: (ratio: number) => void;
    readonly viewportSize?: () => ControlPoint;
    readonly popupCentered?: (minSize: ControlPoint) => void;
  } = {},
): GodotFileDialog {
  const file = bindAcceptDialog(control, {
    confirmation: true,
    ...(options.viewportSize === undefined ? {} : { viewportSize: options.viewportSize }),
    ...(options.popupCentered === undefined ? {} : { popupCentered: options.popupCentered }),
  }) as GodotFileDialog;
  const dialogState = DIALOGS.get(control);
  if (dialogState === undefined)
    throw new Error('FileDialog requires its retained ConfirmationDialog state.');
  const selected = createSignal<readonly [string]>();
  const filesSelected = createSignal<readonly [PackedStringArray]>();
  const dirSelected = createSignal<readonly [string]>();
  const binding = controlBinding(control);
  let access = 0;
  let currentDir = 'res://';
  let currentFile = '';
  let fileMode = 4;
  let title = '';
  let exclusive = false;
  let showHiddenFiles = false;
  let useNativeDialog = false;
  let rootSubfolder = '';
  let displayMode = 0;
  let filenameFilter = '';
  const filters: string[] = [];
  const dialogOptions: { name: string; values: string[]; defaultValue: number }[] = [];
  const checkedAccess = (value: number): number => {
    const next = integer('FileDialog.access', value);
    if (next < 0 || next > 2) {
      throw new RangeError(
        'FileDialog.access must be ACCESS_RESOURCES (0), USERDATA (1), or FILESYSTEM (2).',
      );
    }
    return next;
  };
  const checkedFileMode = (value: number): number => {
    const next = integer('FileDialog.file_mode', value);
    if (next < 0 || next > 4) {
      throw new RangeError('FileDialog.file_mode must be one of the pinned FileMode values 0..4.');
    }
    return next;
  };
  const checkedFilters = (value: Iterable<string>): string[] => {
    if (value === null || value === undefined || typeof value[Symbol.iterator] !== 'function') {
      throw new TypeError('FileDialog.filters requires PackedStringArray-compatible strings.');
    }
    return Array.from(value, (entry) => text('FileDialog filter', entry));
  };
  const browserAccept = (): string =>
    filters
      .flatMap((entry) => {
        const patterns = entry.split(';', 1)[0]?.split(',') ?? [];
        return patterns.flatMap((pattern) => {
          const clean = pattern.trim();
          if (clean === '' || clean === '*' || clean === '*.*') return [];
          if (/^[a-z]+\/[a-z0-9.+*-]+$/i.test(clean)) return [clean];
          const extension = /^\*?(\.[a-z0-9]+)$/i.exec(clean)?.[1];
          if (extension === undefined)
            throw new Error(`FileDialog filter '${clean}' has no exact browser accept spelling.`);
          return [extension.toLowerCase()];
        });
      })
      .join(',');
  const okText = (): string =>
    fileMode === 2
      ? 'Select Current Folder'
      : fileMode === 3
        ? 'Select This Folder'
        : fileMode === 4
          ? 'Save'
          : 'Open';
  const sync = (): void =>
    binding.state.write(binding.id, {
      dialogButtons: dialogState.buttons.map((button) => button.text),
      windowTitle: title,
      fileAccept: browserAccept(),
      fileDirectoryMode: fileMode === 2 || fileMode === 3,
      fileCurrentDir: currentDir,
      fileCurrentFile: currentFile,
      fileShowHiddenFiles: showHiddenFiles,
      fileUseNativeDialog: useNativeDialog,
      fileRootSubfolder: rootSubfolder,
      fileDisplayMode: displayMode,
      fileFilenameFilter: filenameFilter,
      fileOptions: dialogOptions.map((option) => ({ ...option, values: [...option.values] })),
      onFileNameInput(value): void {
        currentFile = text('FileDialog.current_file', value);
        sync();
      },
      onFileSelect(path): void {
        if (fileMode === 2 || fileMode === 3) {
          const slash = path.indexOf('/');
          const directory = slash < 0 ? path : path.slice(0, slash);
          if (directory !== '') dirSelected.emit(directory);
        } else {
          currentFile = path.split('/').at(-1) ?? '';
          selected.emit(path);
          filesSelected.emit(packedStringArray([path]));
        }
        sync();
      },
    });
  Object.defineProperties(file, {
    title: {
      enumerable: true,
      configurable: true,
      get: () => title,
      set: (value: string) => {
        title = text('Window.title', value);
        sync();
      },
    },
    exclusive: {
      enumerable: true,
      configurable: true,
      get: () => exclusive,
      set: (value: boolean) => {
        exclusive = bool('Window.exclusive', value);
      },
    },
    access: {
      enumerable: true,
      configurable: true,
      get: () => access,
      set: (value: number) => {
        access = checkedAccess(value);
      },
    },
    current_dir: {
      enumerable: true,
      configurable: true,
      get: () => currentDir,
      set: (value: string) => {
        currentDir = text('FileDialog.current_dir', value);
        sync();
      },
    },
    current_file: {
      enumerable: true,
      configurable: true,
      get: () => currentFile,
      set: (value: string) => {
        currentFile = text('FileDialog.current_file', value);
        sync();
      },
    },
    current_path: {
      enumerable: true,
      configurable: true,
      get: () => currentDir.replace(/\/$/, '') + '/' + currentFile,
      set: (value: string) => {
        const path = text('FileDialog.current_path', value);
        const slash = path.lastIndexOf('/');
        currentDir = slash < 0 ? '' : path.slice(0, slash);
        currentFile = slash < 0 ? path : path.slice(slash + 1);
        sync();
      },
    },
    file_mode: {
      enumerable: true,
      configurable: true,
      get: () => fileMode,
      set: (value: number) => {
        const next = checkedFileMode(value);
        if (next === fileMode) return;
        fileMode = next;
        dialogState.ok.text = okText();
        sync();
      },
    },
    mode: {
      enumerable: true,
      configurable: true,
      get: () => fileMode,
      set: (value: number) => {
        file.file_mode = value;
      },
    },
    filters: {
      enumerable: true,
      configurable: true,
      get: () => packedStringArray(filters),
      set: (value: Iterable<string>) => {
        filters.splice(0, filters.length, ...checkedFilters(value));
        sync();
      },
    },
    show_hidden_files: {
      enumerable: true,
      configurable: true,
      get: () => showHiddenFiles,
      set: (value: boolean) => {
        showHiddenFiles = bool('FileDialog.show_hidden_files', value);
        sync();
      },
    },
    use_native_dialog: {
      enumerable: true,
      configurable: true,
      get: () => useNativeDialog,
      set: (value: boolean) => {
        useNativeDialog = bool('FileDialog.use_native_dialog', value);
        sync();
      },
    },
    root_subfolder: {
      enumerable: true,
      configurable: true,
      get: () => rootSubfolder,
      set: (value: string) => {
        rootSubfolder = text('FileDialog.root_subfolder', value);
        sync();
      },
    },
    display_mode: {
      enumerable: true,
      configurable: true,
      get: () => displayMode,
      set: (value: number) => {
        displayMode = integer('FileDialog.display_mode', value);
        sync();
      },
    },
    filename_filter: {
      enumerable: true,
      configurable: true,
      get: () => filenameFilter,
      set: (value: string) => {
        filenameFilter = text('FileDialog.filename_filter', value);
        sync();
      },
    },
    file_selected: { enumerable: true, configurable: true, value: selected.signal },
    files_selected: { enumerable: true, configurable: true, value: filesSelected.signal },
    dir_selected: { enumerable: true, configurable: true, value: dirSelected.signal },
  });
  file.add_filter = (filter, description = '', mimeType = ''): void => {
    const pattern = text('FileDialog filter', filter);
    if (pattern.startsWith('.'))
      throw new Error(
        'FileDialog.add_filter filter must be a filename pattern and cannot start with a dot.',
      );
    const label = text('FileDialog description', description);
    const mime = text('FileDialog MIME type', mimeType);
    filters.push(
      label === '' && mime === ''
        ? pattern
        : mime === ''
          ? `${pattern} ; ${label}`
          : `${pattern} ; ${label} ; ${mime}`,
    );
    sync();
  };
  file.clear_filters = (): void => {
    filters.length = 0;
    sync();
  };
  file.get_access = (): number => access;
  file.get_current_dir = (): string => currentDir;
  file.get_current_file = (): string => currentFile;
  file.get_current_path = (): string => file.current_path;
  file.get_file_mode = (): number => fileMode;
  file.get_filters = (): PackedStringArray => packedStringArray(filters);
  file.get_option_count = (): number => dialogOptions.length;
  file.get_option_name = (option: number): string =>
    dialogOptions[integer('FileDialog option', option)]?.name ?? '';
  file.get_option_values = (option: number): PackedStringArray =>
    packedStringArray(dialogOptions[integer('FileDialog option', option)]?.values ?? []);
  file.get_option_default = (option: number): number =>
    dialogOptions[integer('FileDialog option', option)]?.defaultValue ?? 0;
  file.set_option_name = (option: number, name: string): void => {
    const entry = dialogOptions[integer('FileDialog option', option)];
    if (entry === undefined)
      throw new RangeError('FileDialog.set_option_name option is out of range.');
    entry.name = text('FileDialog option name', name);
    sync();
  };
  file.set_option_values = (option: number, values: Iterable<string>): void => {
    const entry = dialogOptions[integer('FileDialog option', option)];
    if (entry === undefined)
      throw new RangeError('FileDialog.set_option_values option is out of range.');
    entry.values = checkedFilters(values);
    entry.defaultValue = Math.min(entry.defaultValue, Math.max(0, entry.values.length - 1));
    sync();
  };
  file.set_option_default = (option: number, defaultValue: number): void => {
    const entry = dialogOptions[integer('FileDialog option', option)];
    if (entry === undefined)
      throw new RangeError('FileDialog.set_option_default option is out of range.');
    entry.defaultValue = integer('FileDialog option default', defaultValue);
    sync();
  };
  file.add_option = (name: string, values: Iterable<string>, defaultValue = 0): void => {
    dialogOptions.push({
      name: text('FileDialog option name', name),
      values: checkedFilters(values),
      defaultValue: integer('FileDialog option default', defaultValue),
    });
    sync();
  };
  file.clear_options = (): void => {
    dialogOptions.length = 0;
    sync();
  };
  file.set_show_hidden_files = (show: boolean): void => {
    file.show_hidden_files = show;
  };
  file.is_showing_hidden_files = (): boolean => showHiddenFiles;
  file.set_use_native_dialog = (enabled: boolean): void => {
    file.use_native_dialog = enabled;
  };
  file.get_use_native_dialog = (): boolean => useNativeDialog;
  file.set_root_subfolder = (path: string): void => {
    file.root_subfolder = path;
  };
  file.get_root_subfolder = (): string => rootSubfolder;
  file.set_display_mode = (mode: number): void => {
    file.display_mode = mode;
  };
  file.get_display_mode = (): number => displayMode;
  file.set_filename_filter = (filter: string): void => {
    file.filename_filter = filter;
  };
  file.get_filename_filter = (): string => filenameFilter;
  file.set_filters = (value: Iterable<string>): void => {
    file.filters = packedStringArray(value);
  };
  file.set_access = (value: number): void => {
    file.access = value;
  };
  file.set_current_dir = (path: string): void => {
    file.current_dir = path;
  };
  file.set_current_file = (value: string): void => {
    file.current_file = value;
  };
  file.set_file_mode = (value: number): void => {
    file.file_mode = value;
  };
  file.set_title = (value: string): void => {
    file.title = value;
  };
  file.get_title = (): string => title;
  file.popup = (): void => {
    dialogState.aboutToPopup.emit();
    file.visible = true;
  };
  file.popup_centered_ratio = (ratio = 0.8): void => {
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new RangeError('Window.popup_centered_ratio ratio must be in (0, 1].');
    }
    if (options.popupCenteredRatio === undefined) {
      throw new Error(
        'Window.popup_centered_ratio requires the embedded dialog viewport dimensions.',
      );
    }
    dialogState.aboutToPopup.emit();
    options.popupCenteredRatio(ratio);
    file.visible = true;
  };
  file.popup_file_dialog = (): void => {
    file.popup();
  };
  dialogState.ok.text = okText();
  sync();
  return file;
}

export class GodotTreeItem {
  readonly children: GodotTreeItem[] = [];
  readonly texts = new Map<number, string>();
  readonly suffixes = new Map<number, string>();
  readonly metadata = new Map<number, unknown>();
  readonly tooltips = new Map<number, string>();
  readonly disabled = new Map<number, boolean>();
  readonly editable = new Map<number, boolean>();
  readonly checked = new Map<number, boolean>();
  readonly indeterminate = new Map<number, boolean>();
  readonly ranges = new Map<number, number>();
  readonly rangeConfigs = new Map<
    number,
    {
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly expression: boolean;
    }
  >();
  readonly cellModes = new Map<number, number>();
  readonly customColors = new Map<number, ColorValue>();
  readonly customBackgroundColors = new Map<
    number,
    { readonly color: ColorValue; readonly outline: boolean }
  >();
  readonly textAlignments = new Map<number, number>();
  readonly icons = new Map<number, GodotTextureProjection>();
  readonly iconMaxWidths = new Map<number, number>();
  readonly iconModulates = new Map<number, ColorValue>();
  readonly iconTransposed = new Map<number, boolean>();
  readonly iconRegions = new Map<number, unknown>();
  readonly languages = new Map<number, string>();
  readonly textDirections = new Map<number, number>();
  readonly autowrapModes = new Map<number, number>();
  readonly expandRight = new Map<number, boolean>();
  readonly customFonts = new Map<number, unknown>();
  readonly customFontSizes = new Map<number, number>();
  readonly buttons = new Map<
    number,
    {
      readonly key: number;
      texture: GodotTextureProjection;
      id: number;
      disabled: boolean;
      tooltip: string;
      color: ColorValue;
      description: string;
    }[]
  >();
  readonly selectedColumns = new Set<number>();
  selected = false;
  collapsed = false;
  private foldingDisabled = false;
  private customMinimumHeight = 0;
  private visibleValue = true;
  constructor(
    readonly owner: GodotTree,
    parent: GodotTreeItem | null,
    readonly renderKey: number,
  ) {
    this.parent = parent;
    registerGodotObjectIdentity(this, 'TreeItem');
  }
  parent: GodotTreeItem | null;
  set_text(column: number, value: string): void {
    this.texts.set(integer('TreeItem column', column), text('TreeItem text', value));
    this.owner.refresh();
  }
  get_text(column: number): string {
    return this.texts.get(integer('TreeItem column', column)) ?? '';
  }
  set_suffix(column: number, value: string): void {
    this.suffixes.set(this.owner.column(column), text('TreeItem suffix', value));
    this.owner.refresh();
  }
  get_suffix(column: number): string {
    return this.suffixes.get(this.owner.column(column)) ?? '';
  }
  set_metadata(column: number, value: unknown): void {
    this.metadata.set(integer('TreeItem column', column), value);
  }
  get_metadata(column: number): unknown {
    return this.metadata.get(integer('TreeItem column', column)) ?? null;
  }
  select(column = 0): void {
    this.owner.set_selected(this, column);
  }
  deselect(column = 0): void {
    this.owner.clear_selected(this, column);
  }
  is_selected(column = 0): boolean {
    return this.selectedColumns.has(this.owner.column(column));
  }
  get_parent(): GodotTreeItem | null {
    return this.parent;
  }
  get_children(): GodotTreeItem | null {
    return this.children[0] ?? null;
  }
  get_first_child(): GodotTreeItem | null {
    return this.children[0] ?? null;
  }
  get_child_count(): number {
    return this.children.length;
  }
  get_next(): GodotTreeItem | null {
    const siblings = this.owner.siblingsOf(this);
    const index = siblings.indexOf(this);
    return siblings[index + 1] ?? null;
  }
  get_prev(): GodotTreeItem | null {
    const siblings = this.owner.siblingsOf(this);
    const index = siblings.indexOf(this);
    return index <= 0 ? null : (siblings[index - 1] ?? null);
  }
  create_child(): GodotTreeItem {
    return this.owner.create_item(this);
  }
  set_collapsed(value: boolean): void {
    const next = bool('TreeItem.collapsed', value);
    if (this.collapsed === next) return;
    this.collapsed = next;
    this.owner.emitItemCollapsed(this);
    this.owner.refresh();
  }
  is_collapsed(): boolean {
    return this.collapsed;
  }
  set_disable_folding(value: boolean): void {
    this.foldingDisabled = bool('TreeItem.disable_folding', value);
    this.owner.refresh();
  }
  is_folding_disabled(): boolean {
    return this.foldingDisabled;
  }
  set_custom_minimum_height(value: number): void {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('TreeItem.custom_minimum_height requires non-negative finite number.');
    this.customMinimumHeight = value;
    this.owner.refresh();
  }
  get_custom_minimum_height(): number {
    return this.customMinimumHeight;
  }
  set_visible(value: boolean): void {
    this.visibleValue = bool('TreeItem.visible', value);
    this.owner.refresh();
  }
  is_visible(): boolean {
    return this.visibleValue;
  }
  get_tree(): GodotTree {
    return this.owner;
  }
  get_next_in_tree(wrap = false): GodotTreeItem | null {
    return this.owner.relativeItem(this, 1, wrap);
  }
  get_prev_in_tree(wrap = false): GodotTreeItem | null {
    return this.owner.relativeItem(this, -1, wrap);
  }
  get_next_visible(wrap = false): GodotTreeItem | null {
    return this.get_next_in_tree(wrap);
  }
  get_prev_visible(wrap = false): GodotTreeItem | null {
    return this.get_prev_in_tree(wrap);
  }
  set_tooltip_text(column: number, value: string): void {
    this.tooltips.set(integer('TreeItem column', column), text('TreeItem tooltip', value));
  }
  get_tooltip_text(column: number): string {
    return this.tooltips.get(integer('TreeItem column', column)) ?? '';
  }
  set_disabled(column: number, value: boolean): void {
    this.disabled.set(integer('TreeItem column', column), bool('TreeItem disabled', value));
    this.owner.refresh();
  }
  is_disabled(column: number): boolean {
    return this.disabled.get(integer('TreeItem column', column)) ?? false;
  }
  set_editable(column: number, value: boolean): void {
    this.editable.set(integer('TreeItem column', column), bool('TreeItem editable', value));
  }
  is_editable(column: number): boolean {
    return this.editable.get(integer('TreeItem column', column)) ?? false;
  }
  set_checked(column: number, value: boolean): void {
    this.checked.set(integer('TreeItem column', column), bool('TreeItem checked', value));
    this.owner.refresh();
  }
  is_checked(column: number): boolean {
    return this.checked.get(integer('TreeItem column', column)) ?? false;
  }
  set_indeterminate(column: number, value: boolean): void {
    this.indeterminate.set(
      integer('TreeItem column', column),
      bool('TreeItem indeterminate', value),
    );
    this.owner.refresh();
  }
  is_indeterminate(column: number): boolean {
    return this.indeterminate.get(integer('TreeItem column', column)) ?? false;
  }
  set_range(column: number, value: number): void {
    if (!Number.isFinite(value)) throw new RangeError('TreeItem range must be finite.');
    const index = this.owner.column(column);
    const config = this.rangeConfigs.get(index);
    const retained =
      config === undefined
        ? value
        : Math.min(
            config.max,
            Math.max(
              config.min,
              config.min + Math.round((value - config.min) / config.step) * config.step,
            ),
          );
    this.ranges.set(index, retained);
    this.owner.refresh();
  }
  get_range(column: number): number {
    return this.ranges.get(integer('TreeItem column', column)) ?? 0;
  }
  get_cell_mode(column: number): number {
    return this.cellModes.get(this.owner.column(column)) ?? 0;
  }
  set_range_config(
    column: number,
    min: number,
    max: number,
    step: number,
    expression = false,
  ): void {
    const index = this.owner.column(column);
    for (const [member, value] of [
      ['min', min],
      ['max', max],
      ['step', step],
    ] as const) {
      if (!Number.isFinite(value)) throw new RangeError(`TreeItem range ${member} must be finite.`);
    }
    if (max < min) throw new RangeError('TreeItem range max must be greater than or equal to min.');
    if (step <= 0) throw new RangeError('TreeItem range step must be positive.');
    this.rangeConfigs.set(index, {
      min,
      max,
      step,
      expression: bool('TreeItem range expression', expression),
    });
    this.owner.refresh();
  }
  set_cell_mode(column: number, mode: number): void {
    const retained = integer('TreeItem cell mode', mode);
    if (retained < 0 || retained > 4)
      throw new RangeError('TreeItem cell mode must be 0 through 4.');
    if (retained === 4) {
      throw new Error(
        'TreeItem CELL_MODE_CUSTOM requires Tree.custom_draw with a retained native draw callback.',
      );
    }
    this.cellModes.set(this.owner.column(column), retained);
    this.owner.refresh();
  }
  set_custom_color(column: number, value: ColorValue): void {
    this.customColors.set(this.owner.column(column), retainedColor('TreeItem custom color', value));
    this.owner.refresh();
  }
  clear_custom_color(column: number): void {
    if (this.customColors.delete(this.owner.column(column))) this.owner.refresh();
  }
  get_custom_color(column: number): ColorValue {
    return { ...(this.customColors.get(this.owner.column(column)) ?? { r: 1, g: 1, b: 1, a: 1 }) };
  }
  set_custom_bg_color(column: number, value: ColorValue, justOutline = false): void {
    this.customBackgroundColors.set(this.owner.column(column), {
      color: retainedColor('TreeItem custom background color', value),
      outline: bool('TreeItem custom background outline', justOutline),
    });
    this.owner.refresh();
  }
  clear_custom_bg_color(column: number): void {
    if (this.customBackgroundColors.delete(this.owner.column(column))) this.owner.refresh();
  }
  get_custom_bg_color(column: number): ColorValue {
    return {
      ...(this.customBackgroundColors.get(this.owner.column(column))?.color ?? {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      }),
    };
  }
  get_custom_bg_outline(column: number): boolean {
    return this.customBackgroundColors.get(this.owner.column(column))?.outline ?? false;
  }
  set_text_alignment(column: number, alignment: number): void {
    const retained = integer('TreeItem text alignment', alignment);
    if (retained < 0 || retained > 3)
      throw new RangeError(
        'TreeItem text alignment must be LEFT (0), CENTER (1), RIGHT (2), or FILL (3).',
      );
    this.textAlignments.set(this.owner.column(column), retained);
    this.owner.refresh();
  }
  set_text_align(column: number, alignment: number): void {
    this.set_text_alignment(column, alignment);
  }
  get_text_alignment(column: number): number {
    return this.textAlignments.get(this.owner.column(column)) ?? 0;
  }
  set_text_direction(column: number, direction: number): void {
    const value = integer('TreeItem text direction', direction);
    if (value < -1 || value > 3) throw new RangeError('TreeItem text direction requires -1..3.');
    this.textDirections.set(this.owner.column(column), value);
    this.owner.refresh();
  }
  get_text_direction(column: number): number {
    return this.textDirections.get(this.owner.column(column)) ?? -1;
  }
  set_language(column: number, language: string): void {
    this.languages.set(this.owner.column(column), text('TreeItem language', language));
    this.owner.refresh();
  }
  get_language(column: number): string {
    return this.languages.get(this.owner.column(column)) ?? '';
  }
  set_autowrap_mode(column: number, mode: number): void {
    const value = integer('TreeItem autowrap mode', mode);
    if (value < 0 || value > 3) throw new RangeError('TreeItem autowrap mode requires 0..3.');
    this.autowrapModes.set(this.owner.column(column), value);
    this.owner.refresh();
  }
  get_autowrap_mode(column: number): number {
    return this.autowrapModes.get(this.owner.column(column)) ?? 0;
  }
  set_expand_right(column: number, value: boolean): void {
    this.expandRight.set(this.owner.column(column), bool('TreeItem expand_right', value));
    this.owner.refresh();
  }
  get_expand_right(column: number): boolean {
    return this.expandRight.get(this.owner.column(column)) ?? false;
  }
  set_custom_font(column: number, font: unknown): void {
    if (font !== null && (typeof font !== 'object' || font === null))
      throw new TypeError('TreeItem.custom_font requires Font or null.');
    this.customFonts.set(this.owner.column(column), font);
    this.owner.refresh();
  }
  get_custom_font(column: number): unknown {
    return this.customFonts.get(this.owner.column(column)) ?? null;
  }
  set_custom_font_size(column: number, size: number): void {
    const value = integer('TreeItem custom font size', size);
    if (value < 0) throw new RangeError('TreeItem custom font size requires non-negative integer.');
    this.customFontSizes.set(this.owner.column(column), value);
    this.owner.refresh();
  }
  get_custom_font_size(column: number): number {
    return this.customFontSizes.get(this.owner.column(column)) ?? 0;
  }
  set_icon(column: number, value: unknown): void {
    const index = this.owner.column(column);
    this.icons.set(index, projectGodotTexture(value, 'TreeItem.set_icon'));
    this.owner.refresh();
  }
  get_icon(column: number): unknown {
    return this.icons.get(this.owner.column(column))?.identity ?? null;
  }
  set_icon_max_width(column: number, width: number): void {
    const index = this.owner.column(column);
    this.iconMaxWidths.set(index, integer('TreeItem icon max width', width));
    this.owner.refresh();
  }
  get_icon_max_width(column: number): number {
    return this.iconMaxWidths.get(this.owner.column(column)) ?? 0;
  }
  set_icon_modulate(column: number, value: ColorValue): void {
    this.iconModulates.set(
      this.owner.column(column),
      retainedColor('TreeItem icon modulate', value),
    );
    this.owner.refresh();
  }
  get_icon_modulate(column: number): ColorValue {
    return { ...(this.iconModulates.get(this.owner.column(column)) ?? { r: 1, g: 1, b: 1, a: 1 }) };
  }
  set_icon_transposed(column: number, value: boolean): void {
    this.iconTransposed.set(this.owner.column(column), bool('TreeItem icon transposed', value));
    this.owner.refresh();
  }
  is_icon_transposed(column: number): boolean {
    return this.iconTransposed.get(this.owner.column(column)) ?? false;
  }
  set_icon_region(column: number, region: unknown): void {
    if (typeof region !== 'object' || region === null)
      throw new TypeError('TreeItem icon region requires Rect2.');
    this.iconRegions.set(this.owner.column(column), region);
    this.owner.refresh();
  }
  get_icon_region(column: number): unknown {
    return (
      this.iconRegions.get(this.owner.column(column)) ?? {
        position: { x: 0, y: 0 },
        size: { x: 0, y: 0 },
      }
    );
  }
  add_button(
    column: number,
    texture: unknown,
    id = -1,
    disabled = false,
    tooltip = '',
    description = '',
  ): void {
    const index = this.owner.column(column);
    const entries = this.buttons.get(index) ?? [];
    const requestedId = integer('TreeItem button id', id);
    const projected = projectGodotTexture(texture, 'TreeItem.add_button');
    if (projected.identity === null)
      throw new TypeError('TreeItem.add_button requires a non-null Texture resource.');
    entries.push({
      key: this.owner.allocateButtonKey(),
      texture: projected,
      id: requestedId < 0 ? entries.length : requestedId,
      disabled: bool('TreeItem button disabled', disabled),
      tooltip: text('TreeItem button tooltip', tooltip),
      color: { r: 1, g: 1, b: 1, a: 1 },
      description: text('TreeItem button description', description),
    });
    this.buttons.set(index, entries);
    this.owner.refresh();
  }
  get_button_count(column: number): number {
    return (this.buttons.get(this.owner.column(column)) ?? []).length;
  }
  get_button_id(column: number, buttonIndex: number): number {
    return this.button(column, buttonIndex, 'get_button_id').id;
  }
  get_button_by_id(column: number, id: number): number {
    return (this.buttons.get(this.owner.column(column)) ?? []).findIndex(
      (button) => button.id === integer('TreeItem button id', id),
    );
  }
  get_button(column: number, buttonIndex: number): unknown {
    return this.button(column, buttonIndex, 'get_button').texture.identity;
  }
  set_button(column: number, buttonIndex: number, texture: unknown): void {
    const button = this.button(column, buttonIndex, 'set_button');
    const projected = projectGodotTexture(texture, 'TreeItem.set_button');
    if (projected.identity === null)
      throw new TypeError('TreeItem.set_button requires non-null Texture.');
    button.texture = projected;
    this.owner.refresh();
  }
  erase_button(column: number, buttonIndex: number): void {
    const buttons = this.buttons.get(this.owner.column(column)) ?? [];
    const index = integer('TreeItem button index', buttonIndex);
    if (index < 0 || index >= buttons.length)
      throw new RangeError('TreeItem.erase_button index does not exist.');
    buttons.splice(index, 1);
    this.owner.refresh();
  }
  set_button_disabled(column: number, buttonIndex: number, value: boolean): void {
    this.button(column, buttonIndex, 'set_button_disabled').disabled = bool(
      'TreeItem button disabled',
      value,
    );
    this.owner.refresh();
  }
  is_button_disabled(column: number, buttonIndex: number): boolean {
    return this.button(column, buttonIndex, 'is_button_disabled').disabled;
  }
  set_button_tooltip_text(column: number, buttonIndex: number, value: string): void {
    this.button(column, buttonIndex, 'set_button_tooltip_text').tooltip = text(
      'TreeItem button tooltip',
      value,
    );
  }
  get_button_tooltip_text(column: number, buttonIndex: number): string {
    return this.button(column, buttonIndex, 'get_button_tooltip_text').tooltip;
  }
  set_button_color(column: number, buttonIndex: number, value: ColorValue): void {
    this.button(column, buttonIndex, 'set_button_color').color = retainedColor(
      'TreeItem button color',
      value,
    );
    this.owner.refresh();
  }
  get_button_color(column: number, buttonIndex: number): ColorValue {
    return { ...this.button(column, buttonIndex, 'get_button_color').color };
  }
  set_button_description(column: number, buttonIndex: number, value: string): void {
    this.button(column, buttonIndex, 'set_button_description').description = text(
      'TreeItem button description',
      value,
    );
  }
  get_button_description(column: number, buttonIndex: number): string {
    return this.button(column, buttonIndex, 'get_button_description').description;
  }
  private button(
    column: number,
    buttonIndex: number,
    member: string,
  ): {
    key: number;
    texture: GodotTextureProjection;
    id: number;
    disabled: boolean;
    tooltip: string;
    color: ColorValue;
    description: string;
  } {
    const buttons = this.buttons.get(this.owner.column(column)) ?? [];
    const index = integer(`TreeItem ${member} button index`, buttonIndex);
    const button = buttons[index];
    if (button === undefined)
      throw new RangeError(`TreeItem.${member} button index ${index} does not exist.`);
    return button;
  }
  remove_child(child: GodotTreeItem): void {
    if (child.parent !== this) throw new Error('TreeItem.remove_child requires a direct child.');
    this.owner.removeItem(child);
  }
  get_child(index: number): GodotTreeItem | null {
    return this.children[integer('TreeItem child index', index)] ?? null;
  }
  get_index(): number {
    return this.owner.siblingsOf(this).indexOf(this);
  }
  move_before(item: GodotTreeItem): void {
    if (item.owner !== this.owner)
      throw new Error('TreeItem.move_before requires an item in the same Tree.');
    if (item === this) return;
    for (let ancestor = item.parent; ancestor !== null; ancestor = ancestor.parent) {
      if (ancestor === this)
        throw new Error('TreeItem.move_before cannot move an item before one of its descendants.');
    }
    const currentSiblings = this.owner.siblingsOf(this);
    const currentIndex = currentSiblings.indexOf(this);
    if (currentIndex < 0) throw new Error('TreeItem.move_before source is detached.');
    currentSiblings.splice(currentIndex, 1);
    this.parent = item.parent;
    const targetSiblings = this.owner.siblingsOf(item);
    const targetIndex = targetSiblings.indexOf(item);
    if (targetIndex < 0) throw new Error('TreeItem.move_before target is detached.');
    targetSiblings.splice(targetIndex, 0, this);
    this.owner.refresh();
  }
  move_after(item: GodotTreeItem): void {
    if (item.owner !== this.owner)
      throw new Error('TreeItem.move_after requires an item in the same Tree.');
    if (item === this) return;
    for (let ancestor = item.parent; ancestor !== null; ancestor = ancestor.parent)
      if (ancestor === this)
        throw new Error('TreeItem.move_after cannot move an item after one of its descendants.');
    const currentSiblings = this.owner.siblingsOf(this);
    const currentIndex = currentSiblings.indexOf(this);
    if (currentIndex < 0) throw new Error('TreeItem.move_after source is detached.');
    currentSiblings.splice(currentIndex, 1);
    this.parent = item.parent;
    const targetSiblings = this.owner.siblingsOf(item);
    const targetIndex = targetSiblings.indexOf(item);
    if (targetIndex < 0) throw new Error('TreeItem.move_after target is detached.');
    targetSiblings.splice(targetIndex + 1, 0, this);
    this.owner.refresh();
  }
  set_collapsed_recursive(value: boolean): void {
    const collapsed = bool('TreeItem collapsed', value);
    const visit = (item: GodotTreeItem): void => {
      item.collapsed = collapsed;
      for (const child of item.children) visit(child);
    };
    visit(this);
    this.owner.refresh();
  }
  call_recursive(method: string, ...args: unknown[]): void {
    const member = text('TreeItem.call_recursive method', method);
    const visit = (item: GodotTreeItem): void => {
      const callable = (item as unknown as Record<string, unknown>)[member];
      if (typeof callable !== 'function')
        throw new TypeError(`TreeItem has no callable ${JSON.stringify(member)}.`);
      (callable as (...values: unknown[]) => unknown).apply(item, args);
      for (const child of item.children) visit(child);
    };
    visit(this);
  }
}

export class GodotTree {
  private readonly roots: GodotTreeItem[] = [];
  private selected: GodotTreeItem | null = null;
  private selectedColumn = -1;
  private edited: GodotTreeItem | null = null;
  private editedColumn = -1;
  columns = 1;
  hide_root = false;
  column_titles_visible = false;
  select_mode = 0;
  allow_reselect = false;
  allow_rmb_select = false;
  allow_search = true;
  auto_tooltip = true;
  hide_folding = false;
  enable_recursive_folding = true;
  enable_drag_unfolding = true;
  drop_mode_flags = 0;
  scroll_horizontal_enabled = true;
  scroll_vertical_enabled = true;
  scroll_hint_mode = 0;
  tile_scroll_hint = false;
  private horizontalScroll = 0;
  private verticalScroll = 0;
  private readonly columnExpand = new Map<number, boolean>();
  private readonly columnExpandRatio = new Map<number, number>();
  private readonly columnMinimumWidth = new Map<number, number>();
  private readonly columnClipContent = new Map<number, boolean>();
  private readonly columnTitles = new Map<number, string>();
  private readonly columnTitleAlignment = new Map<number, number>();
  private readonly columnTitleDirection = new Map<number, number>();
  private readonly columnTitleLanguage = new Map<number, string>();
  private readonly columnTitleTooltips = new Map<number, string>();
  private pressedButtonId = -1;
  private nextRowKey = 1;
  private nextButtonKey = 1;
  private readonly buttonClicked = createSignal<readonly [GodotTreeItem, number, number, number]>();
  private readonly buttonPressed = createSignal<readonly [GodotTreeItem, number, number]>();
  private readonly cellSelected = createSignal<readonly []>();
  private readonly itemSelected = createSignal<readonly []>();
  private readonly columnTitleClicked = createSignal<readonly [number, number]>();
  private readonly checkPropagatedToItem = createSignal<readonly [GodotTreeItem, number]>();
  private readonly customItemClicked = createSignal<readonly [number]>();
  private readonly customPopupEdited = createSignal<readonly [boolean]>();
  private readonly emptyClicked =
    createSignal<readonly [{ readonly x: number; readonly y: number }, number]>();
  private readonly itemActivated = createSignal<readonly []>();
  private readonly itemCollapsed = createSignal<readonly [GodotTreeItem]>();
  private readonly itemEdited = createSignal<readonly []>();
  private readonly itemIconDoubleClicked = createSignal<readonly []>();
  private readonly itemMouseSelected =
    createSignal<readonly [{ readonly x: number; readonly y: number }, number]>();
  private readonly multiSelected = createSignal<readonly [GodotTreeItem, number, boolean]>();
  private readonly nothingSelected = createSignal<readonly []>();
  readonly button_clicked: GodotSignal<readonly [GodotTreeItem, number, number, number]> =
    this.buttonClicked.signal;
  readonly button_pressed: GodotSignal<readonly [GodotTreeItem, number, number]> =
    this.buttonPressed.signal;
  readonly cell_selected: GodotSignal<readonly []> = this.cellSelected.signal;
  readonly item_selected: GodotSignal<readonly []> = this.itemSelected.signal;
  readonly column_title_clicked: GodotSignal<readonly [number, number]> =
    this.columnTitleClicked.signal;
  readonly check_propagated_to_item: GodotSignal<readonly [GodotTreeItem, number]> =
    this.checkPropagatedToItem.signal;
  readonly custom_item_clicked: GodotSignal<readonly [number]> = this.customItemClicked.signal;
  readonly custom_popup_edited: GodotSignal<readonly [boolean]> = this.customPopupEdited.signal;
  readonly empty_clicked: GodotSignal<
    readonly [{ readonly x: number; readonly y: number }, number]
  > = this.emptyClicked.signal;
  readonly item_activated: GodotSignal<readonly []> = this.itemActivated.signal;
  readonly item_collapsed: GodotSignal<readonly [GodotTreeItem]> = this.itemCollapsed.signal;
  readonly item_edited: GodotSignal<readonly []> = this.itemEdited.signal;
  readonly item_icon_double_clicked: GodotSignal<readonly []> = this.itemIconDoubleClicked.signal;
  readonly item_mouse_selected: GodotSignal<
    readonly [{ readonly x: number; readonly y: number }, number]
  > = this.itemMouseSelected.signal;
  readonly multi_selected: GodotSignal<readonly [GodotTreeItem, number, boolean]> =
    this.multiSelected.signal;
  readonly nothing_selected: GodotSignal<readonly []> = this.nothingSelected.signal;
  constructor(private readonly control: GodotControl) {}
  create_item(parent: GodotTreeItem | null = null): GodotTreeItem {
    if (parent !== null && parent.owner !== this)
      throw new Error('Tree.create_item parent belongs to another Tree.');
    const item = new GodotTreeItem(this, parent, this.nextRowKey++);
    (parent?.children ?? this.roots).push(item);
    this.refresh();
    return item;
  }
  get_selected(): GodotTreeItem | null {
    return this.select_mode === 2
      ? (this.flattened().find((item) => item.selected) ?? null)
      : this.selected;
  }
  get_root(): GodotTreeItem | null {
    return this.roots[0] ?? null;
  }
  clear(): void {
    this.roots.length = 0;
    this.selected = null;
    this.selectedColumn = -1;
    this.edited = null;
    this.editedColumn = -1;
    this.refresh();
  }
  set_columns(value: number): void {
    const count = integer('Tree.columns', value);
    if (count < 1) throw new RangeError('Tree.columns must be positive.');
    this.columns = count;
    this.refresh();
  }
  get_columns(): number {
    return this.columns;
  }
  set_select_mode(value: number): void {
    const mode = integer('Tree.select_mode', value);
    if (mode < 0 || mode > 2) throw new RangeError('Tree.select_mode requires 0..2.');
    this.select_mode = mode;
    this.refresh();
  }
  get_select_mode(): number {
    return this.select_mode;
  }
  set_column_titles_visible(value: boolean): void {
    this.column_titles_visible = bool('Tree.column_titles_visible', value);
    this.refresh();
  }
  are_column_titles_visible(): boolean {
    return this.column_titles_visible;
  }
  set_allow_reselect(value: boolean): void {
    this.allow_reselect = bool('Tree.allow_reselect', value);
  }
  get_allow_reselect(): boolean {
    return this.allow_reselect;
  }
  set_allow_rmb_select(value: boolean): void {
    this.allow_rmb_select = bool('Tree.allow_rmb_select', value);
  }
  get_allow_rmb_select(): boolean {
    return this.allow_rmb_select;
  }
  set_allow_search(value: boolean): void {
    this.allow_search = bool('Tree.allow_search', value);
  }
  get_allow_search(): boolean {
    return this.allow_search;
  }
  set_auto_tooltip(value: boolean): void {
    this.auto_tooltip = bool('Tree.auto_tooltip', value);
  }
  is_auto_tooltip_enabled(): boolean {
    return this.auto_tooltip;
  }
  set_hide_folding(value: boolean): void {
    this.hide_folding = bool('Tree.hide_folding', value);
    this.refresh();
  }
  is_folding_hidden(): boolean {
    return this.hide_folding;
  }
  set_enable_recursive_folding(value: boolean): void {
    this.enable_recursive_folding = bool('Tree.enable_recursive_folding', value);
  }
  is_recursive_folding_enabled(): boolean {
    return this.enable_recursive_folding;
  }
  set_enable_drag_unfolding(value: boolean): void {
    this.enable_drag_unfolding = bool('Tree.enable_drag_unfolding', value);
  }
  is_drag_unfolding_enabled(): boolean {
    return this.enable_drag_unfolding;
  }
  set_drop_mode_flags(value: number): void {
    const flags = integer('Tree.drop_mode_flags', value);
    if (flags < 0 || flags > 7) throw new RangeError('Tree.drop_mode_flags requires 0..7.');
    this.drop_mode_flags = flags;
  }
  get_drop_mode_flags(): number {
    return this.drop_mode_flags;
  }
  set_h_scroll_enabled(value: boolean): void {
    this.scroll_horizontal_enabled = bool('Tree.scroll_horizontal_enabled', value);
    if (!this.scroll_horizontal_enabled) this.horizontalScroll = 0;
  }
  is_h_scroll_enabled(): boolean {
    return this.scroll_horizontal_enabled;
  }
  set_v_scroll_enabled(value: boolean): void {
    this.scroll_vertical_enabled = bool('Tree.scroll_vertical_enabled', value);
    if (!this.scroll_vertical_enabled) this.verticalScroll = 0;
  }
  is_v_scroll_enabled(): boolean {
    return this.scroll_vertical_enabled;
  }
  set_scroll_hint_mode(value: number): void {
    const mode = integer('Tree.scroll_hint_mode', value);
    if (mode < 0 || mode > 3) throw new RangeError('Tree.scroll_hint_mode requires 0..3.');
    this.scroll_hint_mode = mode;
    this.refresh();
  }
  get_scroll_hint_mode(): number {
    return this.scroll_hint_mode;
  }
  set_tile_scroll_hint(value: boolean): void {
    this.tile_scroll_hint = bool('Tree.tile_scroll_hint', value);
    this.refresh();
  }
  is_scroll_hint_tiled(): boolean {
    return this.tile_scroll_hint;
  }
  get_scroll(): { x: number; y: number } {
    return { x: this.horizontalScroll, y: this.verticalScroll };
  }
  scroll_to_item(item: GodotTreeItem, centerOnItem = false): void {
    if (item.owner !== this) throw new Error('Tree.scroll_to_item item belongs to another Tree.');
    const row = this.visibleItems().indexOf(item);
    if (row < 0) return;
    this.verticalScroll = Math.max(
      0,
      row * 24 - (bool('Tree.scroll_to_item.center', centerOnItem) ? 48 : 0),
    );
    this.refresh();
  }
  scroll_by(delta: { x: number; y: number }): void {
    if (
      typeof delta !== 'object' ||
      delta === null ||
      !Number.isFinite(delta.x) ||
      !Number.isFinite(delta.y)
    )
      throw new TypeError('Tree.scroll_by requires finite Vector2.');
    if (this.scroll_horizontal_enabled)
      this.horizontalScroll = Math.max(0, this.horizontalScroll + delta.x);
    if (this.scroll_vertical_enabled)
      this.verticalScroll = Math.max(0, this.verticalScroll + delta.y);
    this.refresh();
  }
  ensure_cursor_is_visible(): void {
    if (this.selected !== null) this.scroll_to_item(this.selected, false);
  }
  get_item_at_position(position: { x: number; y: number }): GodotTreeItem | null {
    if (
      typeof position !== 'object' ||
      position === null ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    )
      throw new TypeError('Tree.get_item_at_position requires finite Vector2.');
    const titleOffset = this.column_titles_visible ? 24 : 0;
    return (
      this.visibleItems()[Math.floor((position.y + this.verticalScroll - titleOffset) / 24)] ?? null
    );
  }
  get_column_at_position(position: { x: number; y: number }): number {
    if (typeof position !== 'object' || position === null || !Number.isFinite(position.x))
      throw new TypeError('Tree.get_column_at_position requires finite Vector2.');
    const width = 100;
    return Math.max(
      -1,
      Math.min(this.columns - 1, Math.floor((position.x + this.horizontalScroll) / width)),
    );
  }
  get_drop_section_at_position(position: { x: number; y: number }): number {
    if (this.get_item_at_position(position) === null) return -100;
    const within = (((position.y + this.verticalScroll) % 24) + 24) % 24;
    return within < 6 ? -1 : within > 18 ? 1 : 0;
  }
  get_item_area_rect(
    item: GodotTreeItem,
    column = -1,
    buttonIndex = -1,
  ): { position: { x: number; y: number }; size: { x: number; y: number } } {
    if (item.owner !== this)
      throw new Error('Tree.get_item_area_rect item belongs to another Tree.');
    const row = this.visibleItems().indexOf(item);
    if (row < 0) return { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
    const selectedColumn = column < 0 ? 0 : this.column(column);
    const width = 100;
    const buttonOffset = buttonIndex < 0 ? 0 : Math.max(0, width - (buttonIndex + 1) * 24);
    return {
      position: {
        x: selectedColumn * width + buttonOffset - this.horizontalScroll,
        y: row * 24 + (this.column_titles_visible ? 24 : 0) - this.verticalScroll,
      },
      size: { x: buttonIndex < 0 ? width : 24, y: 24 },
    };
  }
  column(value: number): number {
    const column = integer('Tree column', value);
    if (column < 0 || column >= this.columns)
      throw new RangeError(
        `Tree column ${String(column)} is outside [0, ${String(this.columns - 1)}].`,
      );
    return column;
  }
  set_column_expand(column: number, expand: boolean): void {
    this.columnExpand.set(this.column(column), bool('Tree column expand', expand));
    this.refresh();
  }
  is_column_expanding(column: number): boolean {
    return this.columnExpand.get(this.column(column)) ?? true;
  }
  set_column_title(column: number, title: string): void {
    this.columnTitles.set(this.column(column), text('Tree column title', title));
    this.refresh();
  }
  get_column_title(column: number): string {
    return this.columnTitles.get(this.column(column)) ?? '';
  }
  set_column_expand_ratio(column: number, ratio: number): void {
    const retained = integer('Tree column expand ratio', ratio);
    if (retained < 0) throw new RangeError('Tree column expand ratio must be non-negative.');
    this.columnExpandRatio.set(this.column(column), retained);
    this.refresh();
  }
  get_column_expand_ratio(column: number): number {
    return this.columnExpandRatio.get(this.column(column)) ?? 1;
  }
  set_column_custom_minimum_width(column: number, width: number): void {
    const retained = integer('Tree column custom minimum width', width);
    if (retained < 0)
      throw new RangeError('Tree column custom minimum width must be non-negative.');
    this.columnMinimumWidth.set(this.column(column), retained);
    this.refresh();
  }
  set_column_min_width(column: number, width: number): void {
    this.set_column_custom_minimum_width(column, width);
  }
  set_column_clip_content(column: number, enabled: boolean): void {
    this.columnClipContent.set(this.column(column), bool('Tree column clip content', enabled));
    this.refresh();
  }
  is_column_clipping_content(column: number): boolean {
    return this.columnClipContent.get(this.column(column)) ?? false;
  }
  set_column_title_alignment(column: number, alignment: number): void {
    const retained = integer('Tree column title alignment', alignment);
    if (retained < 0 || retained > 3)
      throw new RangeError(
        'Tree column title alignment must be LEFT (0), CENTER (1), RIGHT (2), or FILL (3).',
      );
    this.columnTitleAlignment.set(this.column(column), retained);
    this.refresh();
  }
  get_column_title_alignment(column: number): number {
    return this.columnTitleAlignment.get(this.column(column)) ?? 0;
  }
  set_column_title_direction(column: number, direction: number): void {
    const retained = integer('Tree column title direction', direction);
    if (retained < -1 || retained > 3)
      throw new RangeError('Tree column title direction requires -1..3.');
    this.columnTitleDirection.set(this.column(column), retained);
    this.refresh();
  }
  get_column_title_direction(column: number): number {
    return this.columnTitleDirection.get(this.column(column)) ?? -1;
  }
  set_column_title_language(column: number, language: string): void {
    this.columnTitleLanguage.set(this.column(column), text('Tree column title language', language));
    this.refresh();
  }
  get_column_title_language(column: number): string {
    return this.columnTitleLanguage.get(this.column(column)) ?? '';
  }
  set_column_title_tooltip_text(column: number, tooltip: string): void {
    this.columnTitleTooltips.set(this.column(column), text('Tree column title tooltip', tooltip));
    this.refresh();
  }
  get_column_title_tooltip_text(column: number): string {
    return this.columnTitleTooltips.get(this.column(column)) ?? '';
  }
  get_column_width(column: number): number {
    const index = this.column(column);
    const record = controlBinding(this.control).state.read(controlBinding(this.control).id);
    const available = Math.max(
      0,
      (record.size?.x ?? this.columns * 100) -
        Array.from(
          { length: this.columns },
          (_, one) => this.columnMinimumWidth.get(one) ?? 0,
        ).reduce((sum, one) => sum + one, 0),
    );
    const totalRatio = Array.from({ length: this.columns }, (_, one) =>
      this.columnExpand.get(one) === false ? 0 : (this.columnExpandRatio.get(one) ?? 1),
    ).reduce((sum, one) => sum + one, 0);
    return Math.max(
      this.columnMinimumWidth.get(index) ?? 0,
      totalRatio > 0
        ? available *
            ((this.columnExpand.get(index) === false
              ? 0
              : (this.columnExpandRatio.get(index) ?? 1)) /
              totalRatio)
        : 0,
    );
  }
  set_hide_root(value: boolean): void {
    this.hide_root = bool('Tree.hide_root', value);
    this.refresh();
  }
  is_root_hidden(): boolean {
    return this.hide_root;
  }
  get_edited(): GodotTreeItem | null {
    return this.edited;
  }
  get_edited_column(): number {
    return this.editedColumn;
  }
  deselect_all(): void {
    this.set_selected(null);
    this.nothingSelected.emit();
  }
  edit_selected(forceEdit = false): boolean {
    if (this.selected === null || (!forceEdit && !this.selected.is_editable(this.selectedColumn)))
      return false;
    this.edited = this.selected;
    this.editedColumn = this.selectedColumn;
    this.itemEdited.emit();
    return true;
  }
  activate_selected(): void {
    if (this.selected !== null) this.itemActivated.emit();
  }
  get_pressed_button(): number {
    return this.pressedButtonId;
  }
  get_custom_drawing_canvas_item(): GodotControl {
    return this.control;
  }
  get_custom_popup_rect(): { position: { x: number; y: number }; size: { x: number; y: number } } {
    return this.edited === null
      ? { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } }
      : this.get_item_area_rect(this.edited, this.editedColumn);
  }
  get_button_id_at_position(position: { x: number; y: number }): number {
    const item = this.get_item_at_position(position);
    const column = this.get_column_at_position(position);
    if (item === null || column < 0) return -1;
    const buttons = item.buttons.get(column) ?? [];
    const cell = this.get_item_area_rect(item, column);
    const fromRight = cell.position.x + cell.size.x - position.x;
    const buttonIndex = Math.floor(fromRight / 24);
    return buttonIndex >= 0 && buttonIndex < buttons.length ? (buttons[buttonIndex]?.id ?? -1) : -1;
  }
  emitItemMouseSelected(
    position: { readonly x: number; readonly y: number },
    mouseButton: number,
  ): void {
    this.itemMouseSelected.emit(position, integer('Tree mouse button', mouseButton));
  }
  emitEmptyClicked(
    position: { readonly x: number; readonly y: number },
    mouseButton: number,
  ): void {
    this.emptyClicked.emit(position, integer('Tree mouse button', mouseButton));
    if (this.select_mode !== 2) this.nothingSelected.emit();
  }
  emitItemCollapsed(item: GodotTreeItem): void {
    this.itemCollapsed.emit(item);
  }
  activateCell(rowKey: number, column: number): void {
    const item = this.flattened().find((candidate) => candidate.renderKey === rowKey);
    if (item === undefined || item.is_disabled(column)) return;
    this.set_selected(item, column);
    if (item.is_editable(column)) {
      this.edited = item;
      this.editedColumn = column;
    }
    this.cellSelected.emit();
    this.itemSelected.emit();
  }
  activateColumnTitle(column: number, mouseButton: number): void {
    this.columnTitleClicked.emit(
      this.column(column),
      integer('Tree column-title mouse index', mouseButton),
    );
  }
  allocateButtonKey(): number {
    return this.nextButtonKey++;
  }
  activateButton(rowKey: number, column: number, buttonKey: number, mouseButton: number): void {
    const item = this.flattened().find((candidate) => candidate.renderKey === rowKey);
    if (item === undefined) return;
    const button = item.buttons
      .get(this.column(column))
      ?.find((candidate) => candidate.key === buttonKey);
    if (button === undefined || button.disabled) return;
    this.pressedButtonId = button.id;
    this.buttonPressed.emit(item, column, button.id);
    this.buttonClicked.emit(
      item,
      column,
      button.id,
      integer('Tree button mouse index', mouseButton),
    );
  }
  siblingsOf(item: GodotTreeItem): GodotTreeItem[] {
    return item.parent?.children ?? this.roots;
  }
  flattened(): GodotTreeItem[] {
    const result: GodotTreeItem[] = [];
    const visit = (items: readonly GodotTreeItem[]): void => {
      for (const item of items) {
        result.push(item);
        visit(item.children);
      }
    };
    visit(this.roots);
    return result;
  }
  visibleItems(): GodotTreeItem[] {
    const result: GodotTreeItem[] = [];
    const visit = (items: readonly GodotTreeItem[]): void => {
      for (const item of items) {
        if (!item.is_visible()) continue;
        result.push(item);
        if (!item.collapsed) visit(item.children);
      }
    };
    if (this.hide_root) for (const root of this.roots) visit(root.children);
    else visit(this.roots);
    return result;
  }
  relativeItem(item: GodotTreeItem, delta: -1 | 1, wrap: boolean): GodotTreeItem | null {
    const items = this.flattened();
    const index = items.indexOf(item);
    if (index < 0) return null;
    const target = index + delta;
    if (target >= 0 && target < items.length) return items[target] ?? null;
    return wrap && items.length > 0
      ? (items[(target + items.length) % items.length] ?? null)
      : null;
  }
  removeItem(item: GodotTreeItem): void {
    const siblings = this.siblingsOf(item);
    const index = siblings.indexOf(item);
    if (index < 0) return;
    const contains = (root: GodotTreeItem, candidate: GodotTreeItem): boolean =>
      root === candidate || root.children.some((child) => contains(child, candidate));
    siblings.splice(index, 1);
    if (this.selected !== null && contains(item, this.selected)) {
      this.selected.selected = false;
      this.selected = null;
      this.selectedColumn = -1;
    }
    if (this.edited !== null && contains(item, this.edited)) {
      this.edited = null;
      this.editedColumn = -1;
    }
    this.refresh();
  }
  get_next_selected(from: GodotTreeItem | null = null): GodotTreeItem | null {
    const items = this.flattened();
    const start = from === null ? 0 : items.indexOf(from) + 1;
    return items.slice(Math.max(0, start)).find((item) => item.selected) ?? null;
  }
  get_selected_column(): number {
    return this.selectedColumn;
  }
  set_selected(item: GodotTreeItem | null, column = 0): void {
    if (item !== null && item.owner !== this)
      throw new Error('Tree.set_selected item belongs to another Tree.');
    const retainedColumn = item === null ? -1 : this.column(column);
    if (item === null || this.select_mode !== 2) {
      for (const candidate of this.flattened()) {
        candidate.selectedColumns.clear();
        candidate.selected = false;
      }
    }
    this.selected = item;
    this.selectedColumn = retainedColumn;
    if (item !== null) {
      if (this.select_mode === 1) {
        for (let index = 0; index < this.columns; index += 1) item.selectedColumns.add(index);
      } else item.selectedColumns.add(retainedColumn);
      item.selected = true;
      if (this.select_mode === 2) this.multiSelected.emit(item, retainedColumn, true);
    }
    this.refresh();
  }
  clear_selected(item: GodotTreeItem, column = 0): void {
    item.selectedColumns.delete(this.column(column));
    item.selected = item.selectedColumns.size > 0;
    if (this.selected === item && !item.selected) {
      this.selected = null;
      this.selectedColumn = -1;
    }
    this.refresh();
  }
  refresh(): void {
    const rows: NonNullable<ControlRecord['treeRows']>[number][] = [];
    const visit = (items: readonly GodotTreeItem[], depth: number): void => {
      for (const item of items) {
        if (!item.is_visible()) continue;
        const cells = Array.from({ length: this.columns }, (_, column) => {
          const icon = item.icons.get(column);
          const cellMode = item.cellModes.get(column) ?? 0;
          const range = item.rangeConfigs.get(column);
          const background = item.customBackgroundColors.get(column);
          const iconModulate = item.iconModulates.get(column) ?? { r: 1, g: 1, b: 1, a: 1 };
          const customColor = item.customColors.get(column) ?? { r: 1, g: 1, b: 1, a: 1 };
          return {
            text:
              cellMode === 1
                ? item.indeterminate.get(column)
                  ? '◩'
                  : item.checked.get(column)
                    ? '☑'
                    : '☐'
                : cellMode === 2
                  ? String(item.ranges.get(column) ?? 0)
                  : cellMode === 3
                    ? ''
                    : item.get_text(column),
            ...(icon?.domSource === undefined ? {} : { iconSource: icon.domSource }),
            ...(icon?.pixiTexture === null || icon?.pixiTexture === undefined
              ? {}
              : { iconTexture: icon.pixiTexture }),
            iconMaxWidth: item.iconMaxWidths.get(column) ?? 0,
            iconModulate: colorHex(iconModulate),
            iconModulateAlpha: iconModulate.a,
            textAlignment: item.textAlignments.get(column) ?? 0,
            customColor: colorHex(customColor),
            customColorAlpha: customColor.a,
            ...(background === undefined
              ? {}
              : {
                  customBackgroundColor: colorHex(background.color),
                  customBackgroundAlpha: background.color.a,
                  customBackgroundOutline: background.outline,
                }),
            cellMode,
            ...(range === undefined
              ? {}
              : {
                  rangeMin: range.min,
                  rangeMax: range.max,
                  rangeStep: range.step,
                  rangeExpression: range.expression,
                }),
            buttons: (item.buttons.get(column) ?? []).map((button) => ({
              key: button.key,
              ...(button.texture.domSource === undefined
                ? {}
                : { iconSource: button.texture.domSource }),
              ...(button.texture.pixiTexture === null
                ? {}
                : { iconTexture: button.texture.pixiTexture }),
              id: button.id,
              disabled: button.disabled,
              tooltip: button.tooltip,
              description: button.description,
            })),
          };
        });
        rows.push({
          key: item.renderKey,
          text: cells[0]?.text ?? '',
          cells,
          depth,
          selected: item.selected,
          selectedColumns: [...item.selectedColumns],
        });
        if (!item.collapsed) visit(item.children, depth + 1);
      }
    };
    if (this.hide_root) {
      for (const root of this.roots) visit(root.children, 0);
    } else visit(this.roots, 0);
    const binding = controlBinding(this.control);
    binding.state.write(binding.id, {
      treeColumns: this.columns,
      treeColumnExpand: Array.from(
        { length: this.columns },
        (_, column) => this.columnExpand.get(column) ?? true,
      ),
      treeColumnExpandRatio: Array.from(
        { length: this.columns },
        (_, column) => this.columnExpandRatio.get(column) ?? 1,
      ),
      treeColumnMinimumWidth: Array.from(
        { length: this.columns },
        (_, column) => this.columnMinimumWidth.get(column) ?? 0,
      ),
      treeColumnClipContent: Array.from(
        { length: this.columns },
        (_, column) => this.columnClipContent.get(column) ?? false,
      ),
      treeColumnTitles: Array.from(
        { length: this.columns },
        (_, column) => this.columnTitles.get(column) ?? '',
      ),
      treeColumnTitleAlignment: Array.from(
        { length: this.columns },
        (_, column) => this.columnTitleAlignment.get(column) ?? 0,
      ),
      treeColumnTitlesVisible: this.column_titles_visible,
      treeScroll: { x: this.horizontalScroll, y: this.verticalScroll },
      treeRows: rows,
      onTreeButtonClick: (rowKey, column, buttonKey, mouseButton) =>
        this.activateButton(rowKey, column, buttonKey, mouseButton),
      onTreeCellClick: (
        rowKey,
        column,
        position = { x: 0, y: 0 },
        mouseButton = 1,
        doubleClick = false,
      ) => {
        this.activateCell(rowKey, column);
        this.emitItemMouseSelected(position, mouseButton);
        if (doubleClick) this.activate_selected();
      },
      onTreeEmptyClick: (position, mouseButton) => this.emitEmptyClicked(position, mouseButton),
      onTreeColumnTitleClick: (column, mouseButton) =>
        this.activateColumnTitle(column, mouseButton),
    });
  }
}

export function bindTree(control: GodotControl): GodotTree & GodotControl {
  const tree = new GodotTree(control);
  Object.defineProperties(control, {
    columns: {
      enumerable: true,
      configurable: true,
      get: () => tree.columns,
      set: (value: number) => {
        const count = integer('Tree.columns', value);
        if (count < 1) throw new RangeError('Tree.columns must be positive.');
        tree.columns = count;
        tree.refresh();
      },
    },
    hide_root: {
      enumerable: true,
      configurable: true,
      get: () => tree.hide_root,
      set: (value: boolean) => {
        tree.hide_root = bool('Tree.hide_root', value);
        tree.refresh();
      },
    },
    column_titles_visible: {
      enumerable: true,
      configurable: true,
      get: () => tree.column_titles_visible,
      set: (value: boolean) => {
        tree.column_titles_visible = bool('Tree.column_titles_visible', value);
        tree.refresh();
      },
    },
    select_mode: {
      enumerable: true,
      configurable: true,
      get: () => tree.select_mode,
      set: (value: number) => {
        const mode = integer('Tree.select_mode', value);
        if (mode < 0 || mode > 2)
          throw new RangeError(
            'Tree.select_mode must be SELECT_SINGLE (0), SELECT_ROW (1), or SELECT_MULTI (2).',
          );
        tree.select_mode = mode;
        tree.refresh();
      },
    },
    allow_reselect: {
      enumerable: true,
      configurable: true,
      get: () => tree.allow_reselect,
      set: (value: boolean) => tree.set_allow_reselect(value),
    },
    allow_rmb_select: {
      enumerable: true,
      configurable: true,
      get: () => tree.allow_rmb_select,
      set: (value: boolean) => tree.set_allow_rmb_select(value),
    },
    allow_search: {
      enumerable: true,
      configurable: true,
      get: () => tree.allow_search,
      set: (value: boolean) => tree.set_allow_search(value),
    },
    auto_tooltip: {
      enumerable: true,
      configurable: true,
      get: () => tree.auto_tooltip,
      set: (value: boolean) => tree.set_auto_tooltip(value),
    },
    hide_folding: {
      enumerable: true,
      configurable: true,
      get: () => tree.hide_folding,
      set: (value: boolean) => tree.set_hide_folding(value),
    },
    enable_recursive_folding: {
      enumerable: true,
      configurable: true,
      get: () => tree.enable_recursive_folding,
      set: (value: boolean) => tree.set_enable_recursive_folding(value),
    },
    enable_drag_unfolding: {
      enumerable: true,
      configurable: true,
      get: () => tree.enable_drag_unfolding,
      set: (value: boolean) => tree.set_enable_drag_unfolding(value),
    },
    drop_mode_flags: {
      enumerable: true,
      configurable: true,
      get: () => tree.drop_mode_flags,
      set: (value: number) => tree.set_drop_mode_flags(value),
    },
    scroll_horizontal_enabled: {
      enumerable: true,
      configurable: true,
      get: () => tree.scroll_horizontal_enabled,
      set: (value: boolean) => tree.set_h_scroll_enabled(value),
    },
    scroll_vertical_enabled: {
      enumerable: true,
      configurable: true,
      get: () => tree.scroll_vertical_enabled,
      set: (value: boolean) => tree.set_v_scroll_enabled(value),
    },
    scroll_hint_mode: {
      enumerable: true,
      configurable: true,
      get: () => tree.scroll_hint_mode,
      set: (value: number) => tree.set_scroll_hint_mode(value),
    },
    tile_scroll_hint: {
      enumerable: true,
      configurable: true,
      get: () => tree.tile_scroll_hint,
      set: (value: boolean) => tree.set_tile_scroll_hint(value),
    },
  });
  return Object.assign(control, {
    create_item: (parent: GodotTreeItem | null = null) => tree.create_item(parent),
    get_selected: () => tree.get_selected(),
    get_root: () => tree.get_root(),
    clear: () => tree.clear(),
    get_next_selected: (from: GodotTreeItem | null = null) => tree.get_next_selected(from),
    get_selected_column: () => tree.get_selected_column(),
    get_edited: () => tree.get_edited(),
    get_edited_column: () => tree.get_edited_column(),
    deselect_all: () => tree.deselect_all(),
    edit_selected: (forceEdit = false) => tree.edit_selected(forceEdit),
    get_pressed_button: () => tree.get_pressed_button(),
    get_custom_drawing_canvas_item: () => tree.get_custom_drawing_canvas_item(),
    get_custom_popup_rect: () => tree.get_custom_popup_rect(),
    set_selected: (item: GodotTreeItem | null, column = 0) => tree.set_selected(item, column),
    set_column_expand: (column: number, expand: boolean) => tree.set_column_expand(column, expand),
    is_column_expanding: (column: number) => tree.is_column_expanding(column),
    set_column_title: (column: number, title: string) => tree.set_column_title(column, title),
    get_column_title: (column: number) => tree.get_column_title(column),
    set_column_expand_ratio: (column: number, ratio: number) =>
      tree.set_column_expand_ratio(column, ratio),
    get_column_expand_ratio: (column: number) => tree.get_column_expand_ratio(column),
    set_column_custom_minimum_width: (column: number, width: number) =>
      tree.set_column_custom_minimum_width(column, width),
    set_column_min_width: (column: number, width: number) =>
      tree.set_column_min_width(column, width),
    set_column_clip_content: (column: number, enabled: boolean) =>
      tree.set_column_clip_content(column, enabled),
    is_column_clipping_content: (column: number) => tree.is_column_clipping_content(column),
    set_column_title_alignment: (column: number, alignment: number) =>
      tree.set_column_title_alignment(column, alignment),
    get_column_title_alignment: (column: number) => tree.get_column_title_alignment(column),
    set_column_title_direction: (column: number, direction: number) =>
      tree.set_column_title_direction(column, direction),
    get_column_title_direction: (column: number) => tree.get_column_title_direction(column),
    set_column_title_language: (column: number, language: string) =>
      tree.set_column_title_language(column, language),
    get_column_title_language: (column: number) => tree.get_column_title_language(column),
    set_column_title_tooltip_text: (column: number, tooltip: string) =>
      tree.set_column_title_tooltip_text(column, tooltip),
    get_column_title_tooltip_text: (column: number) => tree.get_column_title_tooltip_text(column),
    get_column_width: (column: number) => tree.get_column_width(column),
    is_root_hidden: () => tree.is_root_hidden(),
    set_hide_root: (value: boolean) => tree.set_hide_root(value),
    set_columns: (value: number) => tree.set_columns(value),
    get_columns: () => tree.get_columns(),
    set_select_mode: (value: number) => tree.set_select_mode(value),
    get_select_mode: () => tree.get_select_mode(),
    set_column_titles_visible: (value: boolean) => tree.set_column_titles_visible(value),
    are_column_titles_visible: () => tree.are_column_titles_visible(),
    set_allow_reselect: (value: boolean) => tree.set_allow_reselect(value),
    get_allow_reselect: () => tree.get_allow_reselect(),
    set_allow_rmb_select: (value: boolean) => tree.set_allow_rmb_select(value),
    get_allow_rmb_select: () => tree.get_allow_rmb_select(),
    set_allow_search: (value: boolean) => tree.set_allow_search(value),
    get_allow_search: () => tree.get_allow_search(),
    set_auto_tooltip: (value: boolean) => tree.set_auto_tooltip(value),
    is_auto_tooltip_enabled: () => tree.is_auto_tooltip_enabled(),
    set_hide_folding: (value: boolean) => tree.set_hide_folding(value),
    is_folding_hidden: () => tree.is_folding_hidden(),
    set_enable_recursive_folding: (value: boolean) => tree.set_enable_recursive_folding(value),
    is_recursive_folding_enabled: () => tree.is_recursive_folding_enabled(),
    set_enable_drag_unfolding: (value: boolean) => tree.set_enable_drag_unfolding(value),
    is_drag_unfolding_enabled: () => tree.is_drag_unfolding_enabled(),
    set_drop_mode_flags: (value: number) => tree.set_drop_mode_flags(value),
    get_drop_mode_flags: () => tree.get_drop_mode_flags(),
    set_h_scroll_enabled: (value: boolean) => tree.set_h_scroll_enabled(value),
    is_h_scroll_enabled: () => tree.is_h_scroll_enabled(),
    set_v_scroll_enabled: (value: boolean) => tree.set_v_scroll_enabled(value),
    is_v_scroll_enabled: () => tree.is_v_scroll_enabled(),
    set_scroll_hint_mode: (value: number) => tree.set_scroll_hint_mode(value),
    get_scroll_hint_mode: () => tree.get_scroll_hint_mode(),
    set_tile_scroll_hint: (value: boolean) => tree.set_tile_scroll_hint(value),
    is_scroll_hint_tiled: () => tree.is_scroll_hint_tiled(),
    get_scroll: () => tree.get_scroll(),
    scroll_by: (delta: { x: number; y: number }) => tree.scroll_by(delta),
    scroll_to_item: (item: GodotTreeItem, center = false) => tree.scroll_to_item(item, center),
    ensure_cursor_is_visible: () => tree.ensure_cursor_is_visible(),
    get_item_at_position: (position: { x: number; y: number }) =>
      tree.get_item_at_position(position),
    get_column_at_position: (position: { x: number; y: number }) =>
      tree.get_column_at_position(position),
    get_drop_section_at_position: (position: { x: number; y: number }) =>
      tree.get_drop_section_at_position(position),
    get_item_area_rect: (item: GodotTreeItem, column = -1, buttonIndex = -1) =>
      tree.get_item_area_rect(item, column, buttonIndex),
    get_button_id_at_position: (position: { x: number; y: number }) =>
      tree.get_button_id_at_position(position),
    button_clicked: tree.button_clicked,
    button_pressed: tree.button_pressed,
    cell_selected: tree.cell_selected,
    item_selected: tree.item_selected,
    column_title_clicked: tree.column_title_clicked,
    check_propagated_to_item: tree.check_propagated_to_item,
    custom_item_clicked: tree.custom_item_clicked,
    custom_popup_edited: tree.custom_popup_edited,
    empty_clicked: tree.empty_clicked,
    item_activated: tree.item_activated,
    item_collapsed: tree.item_collapsed,
    item_edited: tree.item_edited,
    item_icon_double_clicked: tree.item_icon_double_clicked,
    item_mouse_selected: tree.item_mouse_selected,
    multi_selected: tree.multi_selected,
    nothing_selected: tree.nothing_selected,
    refresh: () => tree.refresh(),
  }) as GodotTree & GodotControl;
}
