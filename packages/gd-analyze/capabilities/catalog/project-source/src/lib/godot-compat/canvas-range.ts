/** Godot Range/HSlider state on the retained Pixi Container that renders and receives the slider. */

import {
  Container,
  Graphics,
  Rectangle,
  Text,
  Ticker,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
} from 'pixi.js';
import { bindRuntimeCanvasControl, markInternalCanvasChild, registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import { optionalControlBinding } from './control-state';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

export interface CanvasRangeOptions {
  readonly node: Container;
  readonly godotMajor: 3 | 4;
  readonly width: number;
  readonly height: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
  readonly page?: number;
  readonly value?: number;
  readonly allowGreater?: boolean;
  readonly allowLesser?: boolean;
  readonly rounded?: boolean;
  readonly expEdit?: boolean;
  readonly scrollable?: boolean;
  readonly vertical?: boolean;
  readonly editable?: boolean;
  readonly tickCount?: number;
  readonly ticksOnBorders?: boolean;
  readonly ticksPosition?: number;
  readonly customStep?: number;
  readonly presentation?: 'slider' | 'progress' | 'texture-progress';
  readonly showPercentage?: boolean;
  readonly progressFillMode?: number;
  readonly indeterminate?: boolean;
  readonly editorPreviewIndeterminate?: boolean;
}

export interface GodotCanvasRange extends GodotCanvasItem {
  min_value: number;
  max_value: number;
  step: number;
  page: number;
  value: number;
  allow_greater: boolean;
  allow_lesser: boolean;
  rounded: boolean;
  exp_edit: boolean;
  scrollable: boolean;
  vertical: boolean;
  editable: boolean;
  tick_count: number;
  ticks_on_borders: boolean;
  ticks_position: number;
  custom_step: number;
  ratio: number;
  readonly value_changed: GodotSignal<readonly [number]>;
  readonly changed: GodotSignal<readonly []>;
  readonly drag_started: GodotSignal<readonly []>;
  readonly drag_ended: GodotSignal<readonly [boolean]>;
  readonly scrolling: GodotSignal<readonly []>;
  set_value(value: number): void;
  set_value_no_signal(value: number): void;
  set_min(value: number): void;
  set_max(value: number): void;
  set_as_ratio(value: number): void;
  set_allow_greater(value: boolean): void;
  set_allow_lesser(value: boolean): void;
  set_step(value: number): void;
  set_page(value: number): void;
  get_value(): number;
  get_min(): number;
  get_max(): number;
  get_step(): number;
  get_page(): number;
  get_as_ratio(): number;
  is_greater_allowed(): boolean;
  is_lesser_allowed(): boolean;
  set_exp_ratio(value: boolean): void;
  is_ratio_exp(): boolean;
  set_use_rounded_values(value: boolean): void;
  is_using_rounded_values(): boolean;
  share(withRange: GodotCanvasRange): never;
  unshare(): void;
  is_editable(): boolean;
  set_editable(value: boolean): void;
  is_scrollable(): boolean;
  set_scrollable(value: boolean): void;
  get_ticks(): number;
  set_ticks(value: number): void;
  get_ticks_on_borders(): boolean;
  set_ticks_on_borders(value: boolean): void;
  get_ticks_position(): number;
  set_ticks_position(value: number): void;
  get_custom_step(): number;
  set_custom_step(value: number): void;
  focus(): void;
}

export interface GodotCanvasProgressBar extends GodotCanvasRange {
  show_percentage: boolean;
  percent_visible: boolean;
  fill_mode: number;
  indeterminate: boolean;
  editor_preview_indeterminate: boolean;
  set_fill_mode(value: number): void;
  get_fill_mode(): number;
  set_show_percentage(value: boolean): void;
  is_percentage_shown(): boolean;
  set_indeterminate(value: boolean): void;
  is_indeterminate(): boolean;
  set_editor_preview_indeterminate(value: boolean): void;
  is_editor_preview_indeterminate_enabled(): boolean;
}

interface CanvasRangeState {
  readonly renderer: Graphics;
  readonly percentage: Text | null;
  readonly changed: SignalHandle<readonly [number]>;
  readonly configurationChanged: SignalHandle<readonly []>;
  readonly dragStarted: SignalHandle<readonly []>;
  readonly dragEnded: SignalHandle<readonly [boolean]>;
  readonly scrolling: SignalHandle<readonly []>;
  focusInput: HTMLInputElement | null;
  width: number;
  height: number;
  readonly godotMajor: 3 | 4;
  readonly presentation: 'slider' | 'progress' | 'texture-progress';
  held: boolean;
  pointerOffset: number;
  dragInitialValue: number;
  progressFillMode: number;
  indeterminate: boolean;
  editorPreviewIndeterminate: boolean;
  animationTime: number;
  released: boolean;
  readonly ownedReleases: Set<() => void>;
  unregisterRelease(): void;
  removeListeners(): void;
}

const RANGES = new WeakMap<GodotCanvasRange, CanvasRangeState>();

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Range.${name} must be finite; received ${value}.`);
  return value;
}

function nonNegative(name: string, value: number): number {
  const next = finite(name, value);
  if (next < 0) throw new RangeError(`Range.${name} must be non-negative; received ${value}.`);
  return next;
}

function roundAwayFromZero(value: number): number {
  return value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
}

function equalApprox(left: number, right: number): boolean {
  if (left === right) return true;
  const tolerance = Math.max(0.00001, 0.00001 * Math.abs(left));
  return Math.abs(left - right) < tolerance;
}

function snapToStep(range: GodotCanvasRange, value: number): number {
  // Godot 3.6 Range::set_value_no_signal uses Math::round. Godot 4.7 Range::_calc_value
  // uses _snapped_r128, whose tie rule is floor(value / step + 0.5).
  if (RANGES.get(range)?.godotMajor === 4) {
    return range.min_value + Math.floor((value - range.min_value) / range.step + 0.5) * range.step;
  }
  return roundAwayFromZero(value / range.step) * range.step;
}

function normalized(range: GodotCanvasRange, value: number): number {
  let next = finite('value', value);
  if (range.step > 0) {
    next = snapToStep(range, next);
  }
  if (range.rounded) next = roundAwayFromZero(next);
  if (!range.allow_greater) next = Math.min(range.max_value - range.page, next);
  if (!range.allow_lesser) next = Math.max(range.min_value, next);
  return next;
}

function ratioOf(range: GodotCanvasRange): number {
  const span = range.max_value - range.min_value;
  if (equalApprox(range.max_value, range.min_value)) return 1;
  const value = Math.max(range.min_value, Math.min(range.max_value, range.value));
  if (range.exp_edit && range.min_value >= 0) {
    const minimum = range.min_value > 0 ? Math.log2(range.min_value) : 0;
    const maximum = Math.log2(range.max_value);
    return maximum === minimum ? 1 : Math.max(0, Math.min(1, (Math.log2(value) - minimum) / (maximum - minimum)));
  }
  return Math.max(0, Math.min(1, (value - range.min_value) / span));
}

function valueAtRatio(range: GodotCanvasRange, ratio: number): number {
  if (range.exp_edit && range.min_value >= 0) {
    const minimum = range.min_value > 0 ? Math.log2(range.min_value) : 0;
    return 2 ** (minimum + (Math.log2(range.max_value) - minimum) * finite('ratio', ratio));
  }
  const percent = (range.max_value - range.min_value) * finite('ratio', ratio);
  const offset = range.step > 0 ? roundAwayFromZero(percent / range.step) * range.step : percent;
  return Math.max(range.min_value, Math.min(range.max_value, offset + range.min_value));
}

function draw(range: GodotCanvasRange): void {
  const state = RANGES.get(range);
  if (state === undefined || state.released) return;
  const ratio = Math.max(0, Math.min(1, range.ratio));
  if (state.presentation === 'progress') {
    state.renderer.clear().rect(0, 0, state.width, state.height).fill(0x30343b);
    if (state.indeterminate) {
      const span = state.progressFillMode <= 1 ? state.width : state.height;
      const segment = span * 0.3;
      const start = (Math.sin(state.animationTime * 3) * 0.5 + 0.5) * Math.max(0, span - segment);
      if (state.progressFillMode <= 1) state.renderer.rect(state.progressFillMode === 1 ? state.width - start - segment : start, 0, segment, state.height).fill(0x4da3ff);
      else state.renderer.rect(0, state.progressFillMode === 3 ? state.height - start - segment : start, state.width, segment).fill(0x4da3ff);
    } else {
      const fillWidth = state.progressFillMode <= 1 ? state.width * ratio : state.width;
      const fillHeight = state.progressFillMode >= 2 ? state.height * ratio : state.height;
      const x = state.progressFillMode === 1 ? state.width - fillWidth : 0;
      const y = state.progressFillMode === 3 ? state.height - fillHeight : 0;
      state.renderer.rect(x, y, fillWidth, fillHeight).fill(0x4da3ff);
    }
    if (state.percentage !== null) {
      state.percentage.text = `${Math.round(ratio * 100)}%`;
      state.percentage.visible = (range as GodotCanvasProgressBar).show_percentage;
      state.percentage.anchor.set(0.5);
      state.percentage.position.set(state.width / 2, state.height / 2);
    }
    return;
  }
  if (state.presentation === 'texture-progress') {
    state.renderer.clear();
    return;
  }
  const cross = range.vertical ? state.width : state.height;
  const main = range.vertical ? state.height : state.width;
  const thickness = Math.max(2, Math.min(6, cross * 0.2));
  const radius = Math.max(4, Math.min(cross * 0.45, 10));
  const travel = Math.max(0, main - radius * 2);
  state.renderer.clear();
  if (range.vertical) {
    state.renderer
      .roundRect(state.width / 2 - thickness / 2, 0, thickness, state.height, thickness / 2)
      .fill(0x6b7280)
      .circle(state.width / 2, state.height - radius - ratio * travel, radius)
      .fill(0xf3f4f6);
  } else {
    state.renderer
      .roundRect(0, state.height / 2 - thickness / 2, state.width, thickness, thickness / 2)
      .fill(0x6b7280)
      .circle(radius + ratio * travel, state.height / 2, radius)
      .fill(0xf3f4f6);
  }
  if (range.tick_count > 0) {
    const denominator = Math.max(1, range.ticks_on_borders ? range.tick_count - 1 : range.tick_count + 1);
    for (let index = 0; index < range.tick_count; index += 1) {
      const tick = (index + (range.ticks_on_borders ? 0 : 1)) / denominator;
      if (range.vertical) state.renderer.rect(state.width / 2 + radius + 2, state.height - tick * state.height, 3, 1).fill(0xf3f4f6);
      else state.renderer.rect(tick * state.width, state.height / 2 + radius + 2, 1, 3).fill(0xf3f4f6);
    }
  }
}

/** Bind Range state directly to one retained native Pixi entity. */
export function bindCanvasRange(
  options: CanvasRangeOptions & { readonly presentation: 'progress' },
): GodotCanvasProgressBar;
export function bindCanvasRange(options: CanvasRangeOptions): GodotCanvasRange;
export function bindCanvasRange(options: CanvasRangeOptions): GodotCanvasRange {
  if (optionalControlBinding(options.node) === undefined) bindRuntimeCanvasControl(options.node);
  const range = options.node as GodotCanvasRange;
  if (RANGES.has(range)) throw new Error('Range canvas entity is already bound.');
  const width = nonNegative('width', options.width);
  const height = nonNegative('height', options.height);
  const renderer = markInternalCanvasChild(new Graphics());
  range.addChild(renderer);
  const presentation = options.presentation ?? 'slider';
  const percentage = presentation === 'progress'
    ? markInternalCanvasChild(new Text({ text: '', style: { fill: 0xffffff, fontSize: 12 } }))
    : null;
  if (percentage !== null) range.addChild(percentage);
  range.hitArea = new Rectangle(0, 0, width, height);
  range.eventMode = presentation === 'slider' ? 'static' : 'passive';
  range.cursor = presentation === 'slider' ? 'pointer' : 'default';

  const changed = createSignal<readonly [number]>();
  const configurationChanged = createSignal<readonly []>();
  const dragStarted = createSignal<readonly []>();
  const dragEnded = createSignal<readonly [boolean]>();
  const scrolling = createSignal<readonly []>();
  const state: CanvasRangeState = {
    renderer,
    percentage,
    changed,
    configurationChanged,
    dragStarted,
    dragEnded,
    scrolling,
    focusInput: null,
    width,
    height,
    godotMajor: options.godotMajor,
    presentation,
    held: false,
    pointerOffset: 0,
    dragInitialValue: options.value ?? options.minValue ?? 0,
    progressFillMode: options.progressFillMode ?? 0,
    indeterminate: options.indeterminate ?? false,
    editorPreviewIndeterminate: options.editorPreviewIndeterminate ?? false,
    animationTime: 0,
    released: false,
    ownedReleases: new Set(),
    unregisterRelease: () => {},
    removeListeners: () => {},
  };
  RANGES.set(range, state);

  let minValue = finite('min_value', options.minValue ?? 0);
  let maxValue = finite('max_value', options.maxValue ?? 100);
  if (options.godotMajor === 4 && maxValue < minValue) maxValue = minValue;
  let step = finite('step', options.step ?? 0.01);
  let page = options.godotMajor === 4 ? nonNegative('page', options.page ?? 0) : finite('page', options.page ?? 0);
  if (options.godotMajor === 4) page = Math.min(page, maxValue - minValue);
  let value = minValue;
  const strictBoolean = (name: string, next: boolean): boolean => {
    if (typeof next !== 'boolean') throw new TypeError(`Range.${name} must be bool.`);
    return next;
  };
  let expEdit = strictBoolean('exp_edit', options.expEdit ?? false);
  let allowGreater = strictBoolean('allow_greater', options.allowGreater ?? false);
  let allowLesser = strictBoolean('allow_lesser', options.allowLesser ?? false);
  let rounded = strictBoolean('rounded', options.rounded ?? false);
  let scrollable = strictBoolean('scrollable', options.scrollable ?? true);
  let vertical = strictBoolean('vertical', options.vertical ?? false);
  let editable = strictBoolean('editable', options.editable ?? true);
  let tickCount = nonNegative('tick_count', options.tickCount ?? 0);
  if (!Number.isSafeInteger(tickCount)) throw new TypeError('Slider.tick_count must be an integer.');
  let ticksOnBorders = strictBoolean('ticks_on_borders', options.ticksOnBorders ?? false);
  let ticksPosition = finite('ticks_position', options.ticksPosition ?? 0);
  if (!Number.isSafeInteger(ticksPosition) || ticksPosition < 0 || ticksPosition > 3) throw new RangeError('Slider.ticks_position must be 0 through 3.');
  let customStep = finite('custom_step', options.customStep ?? -1);
  if (customStep < 0 && customStep !== -1) throw new RangeError('ScrollBar.custom_step must be -1 or non-negative.');
  if (!Number.isSafeInteger(state.progressFillMode) || state.progressFillMode < 0 || state.progressFillMode > 3) throw new RangeError('ProgressBar.fill_mode must be 0 through 3.');
  state.indeterminate = strictBoolean('indeterminate', state.indeterminate);
  state.editorPreviewIndeterminate = strictBoolean('editor_preview_indeterminate', state.editorPreviewIndeterminate);

  const setValue = (next: number, emit: boolean): void => {
    const result = normalized(range, next);
    if (result === value) return;
    value = result;
    if (state.focusInput !== null) state.focusInput.value = String(value);
    draw(range);
    if (emit) changed.emit(value);
  };
  Object.defineProperties(range, {
    min_value: {
      enumerable: true, configurable: true, get: () => minValue,
      set: (next: number) => {
        const authored = finite('min_value', next);
        if (state.godotMajor === 4 && authored === minValue) return;
        minValue = authored;
        if (state.godotMajor === 4) {
          if (maxValue < minValue) maxValue = minValue;
          page = Math.max(0, Math.min(page, maxValue - minValue));
        }
        setValue(value, true);
        draw(range);
        configurationChanged.emit();
      },
    },
    max_value: {
      enumerable: true, configurable: true, get: () => maxValue,
      set: (next: number) => {
        const authored = finite('max_value', next);
        const validated = state.godotMajor === 4 ? Math.max(authored, minValue) : authored;
        if (state.godotMajor === 4 && validated === maxValue) return;
        maxValue = validated;
        if (state.godotMajor === 4) page = Math.max(0, Math.min(page, maxValue - minValue));
        setValue(value, true);
        draw(range);
        configurationChanged.emit();
      },
    },
    step: {
      enumerable: true, configurable: true, get: () => step,
      set: (next: number) => { const value = finite('step', next); if (state.godotMajor === 4 && value === step) return; step = value; draw(range); configurationChanged.emit(); },
    },
    page: {
      enumerable: true, configurable: true, get: () => page,
      set: (next: number) => { const authored = finite('page', next); const value = state.godotMajor === 4 ? Math.max(0, Math.min(authored, maxValue - minValue)) : authored; if (state.godotMajor === 4 && value === page) return; page = value; setValue(range.value, true); draw(range); configurationChanged.emit(); },
    },
    allow_greater: {
      enumerable: true, configurable: true, get: () => allowGreater,
      set: (next: boolean) => { allowGreater = strictBoolean('allow_greater', next); },
    },
    allow_lesser: {
      enumerable: true, configurable: true, get: () => allowLesser,
      set: (next: boolean) => { allowLesser = strictBoolean('allow_lesser', next); },
    },
    rounded: {
      enumerable: true, configurable: true, get: () => rounded,
      set: (next: boolean) => { rounded = strictBoolean('rounded', next); },
    },
    exp_edit: {
      enumerable: true, configurable: true, get: () => expEdit,
      set: (next: boolean) => { expEdit = strictBoolean('exp_edit', next); draw(range); },
    },
    scrollable: {
      enumerable: true, configurable: true, get: () => scrollable,
      set: (next: boolean) => { scrollable = strictBoolean('scrollable', next); },
    },
    vertical: {
      enumerable: true, configurable: true, get: () => vertical,
      set: (next: boolean) => { vertical = strictBoolean('vertical', next); draw(range); },
    },
    editable: {
      enumerable: true, configurable: true, get: () => editable,
      set: (next: boolean) => { editable = strictBoolean('editable', next); range.cursor = editable ? 'pointer' : 'default'; },
    },
    tick_count: {
      enumerable: true, configurable: true, get: () => tickCount,
      set: (next: number) => { const value = nonNegative('tick_count', next); if (!Number.isSafeInteger(value)) throw new TypeError('Slider.tick_count must be an integer.'); tickCount = value; draw(range); },
    },
    ticks_on_borders: {
      enumerable: true, configurable: true, get: () => ticksOnBorders,
      set: (next: boolean) => { ticksOnBorders = strictBoolean('ticks_on_borders', next); draw(range); },
    },
    ticks_position: {
      enumerable: true, configurable: true, get: () => ticksPosition,
      set: (next: number) => { const value = finite('ticks_position', next); if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Slider.ticks_position must be 0 through 3.'); ticksPosition = value; draw(range); },
    },
    custom_step: {
      enumerable: true, configurable: true, get: () => customStep,
      set: (next: number) => { const value = finite('custom_step', next); if (value < 0 && value !== -1) throw new RangeError('ScrollBar.custom_step must be -1 or non-negative.'); customStep = value; },
    },
    value: {
      enumerable: true, configurable: true, get: () => value,
      set: (next: number) => setValue(next, true),
    },
    ratio: {
      enumerable: true, configurable: true,
      get: () => ratioOf(range),
      set: (next: number) => setValue(valueAtRatio(range, next), true),
    },
    value_changed: { enumerable: true, configurable: true, value: changed.signal },
    changed: { enumerable: true, configurable: true, value: configurationChanged.signal },
    drag_started: { enumerable: true, configurable: true, value: dragStarted.signal },
    drag_ended: { enumerable: true, configurable: true, value: dragEnded.signal },
    scrolling: { enumerable: true, configurable: true, value: scrolling.signal },
    ...(presentation === 'progress'
      ? {
          show_percentage: {
            enumerable: true,
            configurable: true,
            get: () => percentage?.visible ?? false,
            set: (next: boolean) => {
              if (typeof next !== 'boolean') throw new TypeError('ProgressBar.show_percentage must be bool.');
              if (percentage !== null) percentage.visible = next;
            },
          },
          percent_visible: { enumerable: true, configurable: true, get: () => percentage?.visible ?? false, set: (next: boolean) => { (range as GodotCanvasProgressBar).show_percentage = next; } },
          fill_mode: { enumerable: true, configurable: true, get: () => state.progressFillMode, set: (next: number) => { if (!Number.isSafeInteger(next) || next < 0 || next > 3) throw new RangeError('ProgressBar.fill_mode must be 0 through 3.'); state.progressFillMode = next; draw(range); } },
          indeterminate: { enumerable: true, configurable: true, get: () => state.indeterminate, set: (next: boolean) => { state.indeterminate = strictBoolean('indeterminate', next); draw(range); } },
          editor_preview_indeterminate: { enumerable: true, configurable: true, get: () => state.editorPreviewIndeterminate, set: (next: boolean) => { state.editorPreviewIndeterminate = strictBoolean('editor_preview_indeterminate', next); } },
        }
      : {}),
  });
  Object.assign(range, {
    set_value(next: number): void { setValue(next, true); },
    set_value_no_signal(next: number): void { setValue(next, false); },
    set_min(next: number): void { range.min_value = next; },
    set_max(next: number): void { range.max_value = next; },
    set_as_ratio(next: number): void { range.ratio = next; },
    set_allow_greater(next: boolean): void { range.allow_greater = next; },
    set_allow_lesser(next: boolean): void { range.allow_lesser = next; },
    set_step(next: number): void { range.step = next; },
    set_page(next: number): void { range.page = next; },
    get_value(): number { return range.value; },
    get_min(): number { return range.min_value; },
    get_max(): number { return range.max_value; },
    get_step(): number { return range.step; },
    get_page(): number { return range.page; },
    get_as_ratio(): number { return range.ratio; },
    is_greater_allowed(): boolean { return range.allow_greater; },
    is_lesser_allowed(): boolean { return range.allow_lesser; },
    set_exp_ratio(next: boolean): void { range.exp_edit = next; },
    is_ratio_exp(): boolean { return range.exp_edit; },
    set_use_rounded_values(next: boolean): void { range.rounded = next; },
    is_using_rounded_values(): boolean { return range.rounded; },
    share(): never { throw new Error('Range.share requires shared native Range storage and is not approximated.'); },
    unshare(): void {},
    is_editable(): boolean { return range.editable; },
    set_editable(next: boolean): void { range.editable = next; },
    is_scrollable(): boolean { return range.scrollable; },
    set_scrollable(next: boolean): void { range.scrollable = next; },
    get_ticks(): number { return range.tick_count; },
    set_ticks(next: number): void { range.tick_count = next; },
    get_ticks_on_borders(): boolean { return range.ticks_on_borders; },
    set_ticks_on_borders(next: boolean): void { range.ticks_on_borders = next; },
    get_ticks_position(): number { return range.ticks_position; },
    set_ticks_position(next: number): void { range.ticks_position = next; },
    get_custom_step(): number { return range.custom_step; },
    set_custom_step(next: number): void { range.custom_step = next; },
  });
  setValue(options.value ?? minValue, false);
  if (presentation === 'progress') {
    const progress = range as GodotCanvasProgressBar;
    progress.show_percentage = options.showPercentage ?? true;
    progress.set_fill_mode = (next): void => { progress.fill_mode = next; };
    progress.get_fill_mode = (): number => progress.fill_mode;
    progress.set_show_percentage = (next): void => { progress.show_percentage = next; };
    progress.is_percentage_shown = (): boolean => progress.show_percentage;
    progress.set_indeterminate = (next): void => { progress.indeterminate = next; };
    progress.is_indeterminate = (): boolean => progress.indeterminate;
    progress.set_editor_preview_indeterminate = (next): void => { progress.editor_preview_indeterminate = next; };
    progress.is_editor_preview_indeterminate_enabled = (): boolean => progress.editor_preview_indeterminate;
  }
  draw(range);

  const focusInput = typeof document === 'undefined' || presentation !== 'slider'
    ? null
    : document.createElement('input');
  if (focusInput !== null) {
    focusInput.type = 'range';
    focusInput.tabIndex = -1;
    focusInput.style.position = 'fixed';
    focusInput.style.left = '-10000px';
    focusInput.style.top = '0';
    focusInput.style.width = '1px';
    focusInput.style.height = '1px';
    focusInput.style.opacity = '0';
    focusInput.style.pointerEvents = 'none';
    focusInput.min = String(range.min_value);
    focusInput.max = String(range.max_value - range.page);
    focusInput.step = String(range.custom_step >= 0 ? range.custom_step : range.step || 'any');
    focusInput.value = String(range.value);
    focusInput.disabled = !range.editable;
    document.body.append(focusInput);
    state.focusInput = focusInput;
  }
  range.focus = (): void => {
    if (state.focusInput === null) {
      throw new Error('Range.grab_focus requires a browser DOM focus target.');
    }
    state.focusInput.disabled = !range.editable;
    state.focusInput.min = String(range.min_value);
    state.focusInput.max = String(range.max_value - range.page);
    state.focusInput.step = range.custom_step >= 0
      ? String(range.custom_step)
      : range.step > 0 ? String(range.step) : 'any';
    state.focusInput.value = String(range.value);
    state.focusInput.focus();
  };

  const keyboardStep = (): number => {
    if (range.custom_step >= 0) return range.custom_step;
    if (range.step > 0) return range.step;
    return Math.max(0.01, (range.max_value - range.min_value) / 100);
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (!range.editable) return;
    const lower = range.vertical ? 'ArrowDown' : 'ArrowLeft';
    const higher = range.vertical ? 'ArrowUp' : 'ArrowRight';
    const increment = keyboardStep();
    let next: number | null = null;
    if (event.key === lower) next = range.value - increment;
    else if (event.key === higher) next = range.value + increment;
    else if (event.key === 'Home') next = range.min_value;
    else if (event.key === 'End') next = range.max_value - range.page;
    else if (event.key === 'PageDown') next = range.value - Math.max(increment, range.page || increment * 10);
    else if (event.key === 'PageUp') next = range.value + Math.max(increment, range.page || increment * 10);
    if (next === null) return;
    event.preventDefault();
    range.value = next;
  };
  focusInput?.addEventListener('keydown', keyDown);

  const updateFromPointer = (event: FederatedPointerEvent): void => {
    const point = range.toLocal(event.global);
    const cross = range.vertical ? state.width : state.height;
    const main = range.vertical ? state.height : state.width;
    const pointMain = range.vertical ? state.height - point.y : point.x;
    const radius = Math.max(4, Math.min(cross * 0.45, 10));
    const travel = main - radius * 2;
    range.ratio = travel <= 0
      ? 0
      : Math.max(0, Math.min(1, (pointMain - state.pointerOffset - radius) / travel));
  };
  const pointerDown = (event: FederatedPointerEvent): void => {
    if (event.button !== 0 || !range.editable) return;
    range.focus();
    const point = range.toLocal(event.global);
    const cross = range.vertical ? state.width : state.height;
    const main = range.vertical ? state.height : state.width;
    const radius = Math.max(4, Math.min(cross * 0.45, 10));
    const pointMain = range.vertical ? state.height - point.y : point.x;
    const center = radius + range.ratio * Math.max(0, main - radius * 2);
    state.pointerOffset = Math.abs(pointMain - center) <= radius ? pointMain - center : 0;
    state.held = true;
    state.dragInitialValue = range.value;
    state.dragStarted.emit();
    updateFromPointer(event);
  };
  const pointerMove = (event: FederatedPointerEvent): void => {
    if (state.held) updateFromPointer(event);
  };
  const pointerUp = (event: FederatedPointerEvent): void => {
    if (event.button === 0) {
      if (state.held) state.dragEnded.emit(!equalApprox(state.dragInitialValue, range.value));
      state.held = false;
      state.pointerOffset = 0;
    }
  };
  const wheel = (event: FederatedWheelEvent): void => {
    if (!range.editable || !range.scrollable || event.deltaY === 0) return;
    const increment = range.custom_step >= 0 ? range.custom_step : range.step;
    range.value += event.deltaY < 0 ? increment : -increment;
    state.scrolling.emit();
  };
  if (presentation === 'slider') {
    range.on('pointerdown', pointerDown);
    range.on('globalpointermove', pointerMove);
    range.on('pointerup', pointerUp);
    range.on('pointerupoutside', pointerUp);
    range.on('wheel', wheel);
    state.removeListeners = () => {
      range.off('pointerdown', pointerDown);
      range.off('globalpointermove', pointerMove);
      range.off('pointerup', pointerUp);
      range.off('pointerupoutside', pointerUp);
      range.off('wheel', wheel);
      focusInput?.removeEventListener('keydown', keyDown);
      focusInput?.remove();
      state.focusInput = null;
    };
  }
  const animate = (ticker: Ticker): void => {
    if (presentation !== 'progress' || !state.indeterminate) return;
    state.animationTime += ticker.deltaMS / 1000;
    draw(range);
  };
  if (presentation === 'progress') {
    Ticker.shared.add(animate);
    const removeInputListeners = state.removeListeners;
    state.removeListeners = () => { removeInputListeners(); Ticker.shared.remove(animate); };
  }
  state.unregisterRelease = registerCanvasNodeRelease(range, () => releaseCanvasRange(range));
  return range;
}

/** Runtime `HScrollBar.new()` using the retained Pixi Range carrier and Godot defaults. */
export function createGodotCanvasHScrollBar(godotMajor: 3 | 4): GodotCanvasRange {
  const node = new Container();
  registerGodotObjectIdentity(node, 'HScrollBar');
  return bindCanvasRange({
    node,
    godotMajor,
    width: 0,
    height: 0,
    minValue: 0,
    maxValue: 100,
    step: 0.01,
    page: 0,
    value: 0,
    vertical: false,
    customStep: -1,
  });
}

/** Runtime `VScrollBar.new()` using the same retained Pixi Range carrier in vertical orientation. */
export function createGodotCanvasVScrollBar(godotMajor: 3 | 4): GodotCanvasRange {
  const node = new Container();
  registerGodotObjectIdentity(node, 'VScrollBar');
  return bindCanvasRange({
    node,
    godotMajor,
    width: 0,
    height: 0,
    minValue: 0,
    maxValue: 100,
    step: 0.01,
    page: 0,
    value: 0,
    vertical: true,
    customStep: -1,
  });
}

/** Runtime HSlider constructor with editable horizontal thumb and Godot defaults. */
export function createGodotCanvasHSlider(godotMajor: 3 | 4): GodotCanvasRange {
  const node = new Container();
  registerGodotObjectIdentity(node, 'HSlider');
  return bindCanvasRange({
    node, godotMajor, width: 0, height: 0,
    minValue: 0, maxValue: 100, step: 1, page: 0, value: 0,
    vertical: false, customStep: -1, presentation: 'slider', editable: true, scrollable: true,
  });
}

/** Runtime VSlider constructor with editable vertical thumb and Godot defaults. */
export function createGodotCanvasVSlider(godotMajor: 3 | 4): GodotCanvasRange {
  const node = new Container();
  registerGodotObjectIdentity(node, 'VSlider');
  return bindCanvasRange({
    node, godotMajor, width: 0, height: 0,
    minValue: 0, maxValue: 100, step: 1, page: 0, value: 0,
    vertical: true, customStep: -1, presentation: 'slider', editable: true, scrollable: true,
  });
}

/** Runtime ProgressBar constructor with Godot defaults on one retained Pixi Container. */
export function createGodotCanvasProgressBar(major: 3 | 4): GodotCanvasProgressBar {
  const node = new Container();
  registerGodotObjectIdentity(node, 'ProgressBar');
  return bindCanvasRange({
    node,
    godotMajor: major,
    width: 0,
    height: 0,
    minValue: 0,
    maxValue: 100,
    value: 0,
    presentation: 'progress',
    showPercentage: true,
  }) as GodotCanvasProgressBar;
}

/** Resize the retained slider rect and redraw its native track/thumb without replacing the node. */
export function resizeCanvasRange(range: GodotCanvasRange, width: number, height: number): void {
  const state = RANGES.get(range);
  if (state === undefined || state.released) throw new Error('Canvas Range is not bound.');
  state.width = nonNegative('width', width);
  state.height = nonNegative('height', height);
  range.hitArea = new Rectangle(0, 0, state.width, state.height);
  draw(range);
}

export function releaseCanvasRange(range: GodotCanvasRange): void {
  const state = RANGES.get(range);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  state.removeListeners();
  for (const release of state.ownedReleases) release();
  state.ownedReleases.clear();
  state.renderer.removeFromParent();
  state.renderer.destroy();
  state.percentage?.removeFromParent();
  state.percentage?.destroy();
  RANGES.delete(range);
}

/** Register renderer-owned children that must die with the retained Range entity. */
export function addCanvasRangeRelease(range: GodotCanvasRange, release: () => void): () => void {
  const state = RANGES.get(range);
  if (state === undefined || state.released) throw new Error('Canvas Range is not bound.');
  state.ownedReleases.add(release);
  return () => state.ownedReleases.delete(release);
}
