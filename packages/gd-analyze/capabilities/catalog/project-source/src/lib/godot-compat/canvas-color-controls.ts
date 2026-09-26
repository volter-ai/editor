/** Pixi-native ColorPicker/ColorPickerButton on the retained Control Container identity. */

import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import {
  createGodotCanvasPopupPanel,
  releaseCanvasAdvancedControl,
  type GodotCanvasPopupDialog,
} from './canvas-advanced-controls';
import {
  colorFromHsv,
  colorFromOkHsl,
  colorH,
  colorOkHslH,
  colorOkHslL,
  colorOkHslS,
  colorS,
  colorToRgba32,
  colorV,
  copyColor,
  godotColor,
} from './color';
import { bindRuntimeCanvasControl, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { setCanvasControlCustomMinimumSize } from './canvas-control-state';
import { registerGodotObjectIdentity } from './object';
import { packedColorArray, type PackedArrayValue } from './packed-array';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import type { ColorValue } from './variant';

function checkedColor(value: ColorValue): ColorValue {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.r) || !Number.isFinite(value.g) ||
      !Number.isFinite(value.b) || !Number.isFinite(value.a)) {
    throw new TypeError('ColorPicker.color must be a finite Color.');
  }
  return copyColor(value);
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

export type GodotCanvasColorPicker = Container & {
  color: ColorValue;
  edit_alpha: boolean;
  deferred_mode: boolean;
  color_mode: number;
  picker_shape: number;
  edit_intensity: boolean;
  sampler_visible: boolean;
  sliders_visible: boolean;
  hex_visible: boolean;
  presets_visible: boolean;
  color_modes_visible: boolean;
  can_add_swatches: boolean;
  colorize_sliders: boolean;
  readonly color_changed: GodotSignal<readonly [ColorValue]>;
  readonly preset_added: GodotSignal<readonly [ColorValue]>;
  readonly preset_removed: GodotSignal<readonly [ColorValue]>;
  set_pick_color(value: ColorValue): void;
  get_pick_color(): ColorValue;
  set_edit_alpha(value: boolean): void;
  is_editing_alpha(): boolean;
  set_deferred_mode(value: boolean): void;
  is_deferred_mode(): boolean;
  set_color_mode(value: number): void;
  get_color_mode(): number;
  set_picker_shape(value: number): void;
  get_picker_shape(): number;
  add_preset(value: ColorValue): void;
  erase_preset(value: ColorValue): void;
  add_recent_preset(value: ColorValue): void;
  erase_recent_preset(value: ColorValue): void;
  get_presets(): PackedArrayValue<ColorValue>;
  get_recent_presets(): PackedArrayValue<ColorValue>;
  set_can_add_swatches(value: boolean): void;
  are_swatches_enabled(): boolean;
  set_colorize_sliders(value: boolean): void;
  is_colorizing_sliders(): boolean;
  set_edit_intensity(value: boolean): void;
  is_editing_intensity(): boolean;
  set_presets_visible(value: boolean): void;
  are_presets_visible(): boolean;
  set_modes_visible(value: boolean): void;
  are_modes_visible(): boolean;
  set_sampler_visible(value: boolean): void;
  is_sampler_visible(): boolean;
  set_sliders_visible(value: boolean): void;
  are_sliders_visible(): boolean;
  set_hex_visible(value: boolean): void;
  is_hex_visible(): boolean;
};

interface PickerState {
  readonly canvas: Graphics;
  readonly changed: SignalHandle<readonly [ColorValue]>;
  readonly presetAdded: SignalHandle<readonly [ColorValue]>;
  readonly presetRemoved: SignalHandle<readonly [ColorValue]>;
  value: ColorValue;
  editAlpha: boolean;
  deferred: boolean;
  pending: ColorValue | null;
  colorMode: number;
  pickerShape: number;
  presets: ColorValue[];
  recent: ColorValue[];
  canAddSwatches: boolean;
  colorizeSliders: boolean;
  editIntensity: boolean;
  samplerVisible: boolean;
  slidersVisible: boolean;
  hexVisible: boolean;
  presetsVisible: boolean;
  modesVisible: boolean;
  width: number;
  height: number;
  released: boolean;
  unregister(): void;
  releaseListeners(): void;
}

const PICKERS = new WeakMap<GodotCanvasColorPicker, PickerState>();

function wrappedHueFromPoint(x: number, y: number): number {
  const hue = Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2);
  return hue < 0 ? hue + 1 : hue;
}

function radiusFromPoint(x: number, y: number): number {
  return Math.hypot(x - 0.5, y - 0.5) * 2;
}

function retainedIntensity(value: ColorValue, enabled: boolean): number {
  if (!enabled) return 0;
  const peak = Math.max(value.r, value.g, value.b);
  return peak > 1 ? Math.log2(peak) : 0;
}

function applyRetainedIntensity(value: ColorValue, intensity: number): ColorValue {
  if (intensity === 0) return value;
  const multiplier = 2 ** intensity;
  return {
    r: value.r * multiplier,
    g: value.g * multiplier,
    b: value.b * multiplier,
    a: value.a,
  };
}

function pickerColorAt(state: PickerState, normalizedX: number, normalizedY: number): ColorValue | null {
  const x = Math.max(0, Math.min(1, normalizedX));
  const y = Math.max(0, Math.min(1, normalizedY));
  const intensity = retainedIntensity(state.value, state.editIntensity);
  const preserveIntensity = (value: ColorValue): ColorValue => applyRetainedIntensity(value, intensity);
  switch (state.pickerShape) {
    case 0:
      return preserveIntensity(colorFromHsv(colorH(state.value), x, 1 - y, state.value.a));
    case 1:
    case 2: {
      const saturation = radiusFromPoint(x, y);
      if (saturation > 1) return null;
      const value = colorV(state.value) / (2 ** intensity);
      return preserveIntensity(colorFromHsv(wrappedHueFromPoint(x, y), saturation, value, state.value.a));
    }
    case 3: {
      const saturation = radiusFromPoint(x, y);
      if (saturation > 1) return null;
      return preserveIntensity(colorFromOkHsl(wrappedHueFromPoint(x, y), saturation, colorOkHslL(state.value), state.value.a));
    }
    case 4:
      return null;
    case 5:
      return preserveIntensity(colorFromOkHsl(x, 1 - y, colorOkHslL(state.value), state.value.a));
    case 6:
      return preserveIntensity(colorFromOkHsl(x, colorOkHslS(state.value), 1 - y, state.value.a));
    default:
      return null;
  }
}

function pickerCursor(state: PickerState): { readonly x: number; readonly y: number } | null {
  switch (state.pickerShape) {
    case 0:
      return { x: colorS(state.value), y: 1 - colorV(state.value) };
    case 1:
    case 2: {
      const angle = colorH(state.value) * Math.PI * 2;
      const radius = colorS(state.value) * 0.5;
      return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
    }
    case 3: {
      const angle = colorOkHslH(state.value) * Math.PI * 2;
      const radius = colorOkHslS(state.value) * 0.5;
      return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
    }
    case 4:
      return null;
    case 5:
      return { x: colorOkHslH(state.value), y: 1 - colorOkHslS(state.value) };
    case 6:
      return { x: colorOkHslH(state.value), y: 1 - colorOkHslL(state.value) };
    default:
      return null;
  }
}

function draw(picker: GodotCanvasColorPicker): void {
  const state = PICKERS.get(picker);
  if (state === undefined || state.released) return;
  const steps = 32;
  state.canvas.clear();
  if (state.pickerShape === 4) return;
  for (let y = 0; y < steps; y += 1) {
    for (let x = 0; x < steps; x += 1) {
      const sample = pickerColorAt(state, (x + 0.5) / steps, (y + 0.5) / steps);
      if (sample === null) continue;
      state.canvas.rect(x * state.width / steps, y * state.height / steps, state.width / steps + 1, state.height / steps + 1)
        .fill(colorToRgba32(sample) >>> 8);
    }
  }
  const cursor = pickerCursor(state);
  if (cursor !== null) {
    const x = cursor.x * state.width;
    const y = cursor.y * state.height;
    state.canvas.circle(x, y, 5).stroke({ color: 0x000000, width: 3 });
    state.canvas.circle(x, y, 4).stroke({ color: 0xffffff, width: 2 });
  }
}

export function bindCanvasColorPicker(
  node: Container,
  options: {
    readonly width: number;
    readonly height: number;
    readonly color?: ColorValue;
    readonly editAlpha?: boolean;
    readonly deferredMode?: boolean;
    readonly colorMode?: number;
    readonly pickerShape?: number;
    readonly editIntensity?: boolean;
    readonly samplerVisible?: boolean;
    readonly slidersVisible?: boolean;
    readonly hexVisible?: boolean;
    readonly presetsVisible?: boolean;
    readonly modesVisible?: boolean;
  },
): GodotCanvasColorPicker {
  const picker = node as GodotCanvasColorPicker;
  if (PICKERS.has(picker)) throw new Error('ColorPicker retained Pixi node is already bound.');
  if (!Number.isSafeInteger(options.colorMode ?? 0) || (options.colorMode ?? 0) < 0 || (options.colorMode ?? 0) > 3) {
    throw new RangeError('ColorPicker.color_mode must be RGB (0) through OKHSL (3).');
  }
  if (!Number.isSafeInteger(options.pickerShape ?? 0) || (options.pickerShape ?? 0) < 0 || (options.pickerShape ?? 0) > 6) {
    throw new RangeError('ColorPicker.picker_shape must be SHAPE_HSV_RECTANGLE (0) through SHAPE_OK_HL_RECTANGLE (6).');
  }
  if (!Number.isFinite(options.width) || options.width < 0 || !Number.isFinite(options.height) || options.height < 0) {
    throw new RangeError('ColorPicker retained size must be finite and non-negative.');
  }
  const canvas = markInternalCanvasChild(new Graphics());
  node.addChild(canvas);
  node.eventMode = 'static';
  node.cursor = 'crosshair';
  node.hitArea = new Rectangle(0, 0, options.width, options.height);
  const state: PickerState = {
    canvas,
    changed: createSignal<readonly [ColorValue]>(),
    presetAdded: createSignal<readonly [ColorValue]>(),
    presetRemoved: createSignal<readonly [ColorValue]>(),
    value: checkedColor(options.color ?? godotColor(1, 1, 1, 1)),
    editAlpha: boolean('ColorPicker.edit_alpha', options.editAlpha ?? true),
    deferred: boolean('ColorPicker.deferred_mode', options.deferredMode ?? false),
    pending: null,
    colorMode: options.colorMode ?? 0,
    pickerShape: options.pickerShape ?? 0,
    presets: [],
    recent: [],
    canAddSwatches: true,
    colorizeSliders: true,
    editIntensity: boolean('ColorPicker.edit_intensity', options.editIntensity ?? false),
    samplerVisible: boolean('ColorPicker.sampler_visible', options.samplerVisible ?? true),
    slidersVisible: boolean('ColorPicker.sliders_visible', options.slidersVisible ?? true),
    hexVisible: boolean('ColorPicker.hex_visible', options.hexVisible ?? true),
    presetsVisible: boolean('ColorPicker.presets_visible', options.presetsVisible ?? true),
    modesVisible: boolean('ColorPicker.color_modes_visible', options.modesVisible ?? true),
    width: options.width,
    height: options.height,
    released: false,
    unregister: () => {},
    releaseListeners: () => {},
  };
  PICKERS.set(picker, state);
  let dragging = false;
  const choose = (event: FederatedPointerEvent, commit: boolean): void => {
    const point = picker.toLocal(event.global);
    const normalizedX = Math.max(0, Math.min(1, point.x / Math.max(1, state.width)));
    const normalizedY = Math.max(0, Math.min(1, point.y / Math.max(1, state.height)));
    const sampled = pickerColorAt(state, normalizedX, normalizedY);
    if (sampled === null) return;
    const next = { ...sampled, a: state.value.a };
    if (state.deferred && !commit) {
      state.pending = next;
      state.value = next;
      draw(picker);
    }
    else {
      state.pending = null;
      state.value = next;
      draw(picker);
      state.changed.emit(copyColor(state.value));
    }
  };
  const down = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return;
    dragging = true;
    choose(event, false);
  };
  const move = (event: FederatedPointerEvent): void => {
    if (!dragging) return;
    choose(event, false);
  };
  const up = (event: FederatedPointerEvent): void => {
    if (!dragging || event.button !== 0) return;
    dragging = false;
    if (state.deferred && state.pending !== null) {
      const committed = state.pending;
      state.pending = null;
      state.value = committed;
      draw(picker);
      state.changed.emit(copyColor(state.value));
    } else {
      choose(event, true);
    }
  };
  const cancel = (): void => {
    dragging = false;
    state.pending = null;
  };
  node.on('pointerdown', down);
  node.on('globalpointermove', move);
  node.on('pointerup', up);
  node.on('pointerupoutside', up);
  node.on('pointercancel', cancel);
  state.releaseListeners = () => {
    node.off('pointerdown', down);
    node.off('globalpointermove', move);
    node.off('pointerup', up);
    node.off('pointerupoutside', up);
    node.off('pointercancel', cancel);
  };
  Object.defineProperties(picker, {
    color: { enumerable: true, configurable: true, get: () => copyColor(state.value), set: (value: ColorValue) => { state.value = checkedColor(value); state.pending = null; draw(picker); state.changed.emit(copyColor(state.value)); } },
    edit_alpha: { enumerable: true, configurable: true, get: () => state.editAlpha, set: (value: boolean) => { state.editAlpha = boolean('ColorPicker.edit_alpha', value); } },
    deferred_mode: { enumerable: true, configurable: true, get: () => state.deferred, set: (value: boolean) => { state.deferred = boolean('ColorPicker.deferred_mode', value); } },
    color_mode: { enumerable: true, configurable: true, get: () => state.colorMode, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('ColorPicker.color_mode must be 0 through 3.'); state.colorMode = value; } },
    picker_shape: { enumerable: true, configurable: true, get: () => state.pickerShape, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new RangeError('ColorPicker.picker_shape must be 0 through 6.'); state.pickerShape = value; draw(picker); } },
    edit_intensity: { enumerable: true, configurable: true, get: () => state.editIntensity, set: (value: boolean) => { state.editIntensity = boolean('ColorPicker.edit_intensity', value); draw(picker); } },
    sampler_visible: { enumerable: true, configurable: true, get: () => state.samplerVisible, set: (value: boolean) => { state.samplerVisible = boolean('ColorPicker.sampler_visible', value); } },
    sliders_visible: { enumerable: true, configurable: true, get: () => state.slidersVisible, set: (value: boolean) => { state.slidersVisible = boolean('ColorPicker.sliders_visible', value); } },
    hex_visible: { enumerable: true, configurable: true, get: () => state.hexVisible, set: (value: boolean) => { state.hexVisible = boolean('ColorPicker.hex_visible', value); } },
    presets_visible: { enumerable: true, configurable: true, get: () => state.presetsVisible, set: (value: boolean) => { state.presetsVisible = boolean('ColorPicker.presets_visible', value); } },
    color_modes_visible: { enumerable: true, configurable: true, get: () => state.modesVisible, set: (value: boolean) => { state.modesVisible = boolean('ColorPicker.color_modes_visible', value); } },
    can_add_swatches: { enumerable: true, configurable: true, get: () => state.canAddSwatches, set: (value: boolean) => { state.canAddSwatches = boolean('ColorPicker.can_add_swatches', value); } },
    colorize_sliders: { enumerable: true, configurable: true, get: () => state.colorizeSliders, set: (value: boolean) => { state.colorizeSliders = boolean('ColorPicker.colorize_sliders', value); } },
    color_changed: { enumerable: true, configurable: true, value: state.changed.signal },
    preset_added: { enumerable: true, configurable: true, value: state.presetAdded.signal },
    preset_removed: { enumerable: true, configurable: true, value: state.presetRemoved.signal },
  });
  picker.set_pick_color = (value): void => { picker.color = value; };
  picker.get_pick_color = (): ColorValue => picker.color;
  picker.set_edit_alpha = (value): void => { picker.edit_alpha = value; };
  picker.is_editing_alpha = (): boolean => state.editAlpha;
  picker.set_deferred_mode = (value): void => { picker.deferred_mode = value; };
  picker.is_deferred_mode = (): boolean => state.deferred;
  picker.set_color_mode = (value): void => { picker.color_mode = value; };
  picker.get_color_mode = (): number => state.colorMode;
  picker.set_picker_shape = (value): void => { picker.picker_shape = value; };
  picker.get_picker_shape = (): number => state.pickerShape;
  const equal = (left: ColorValue, right: ColorValue): boolean => left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
  picker.add_preset = (value): void => { const next = checkedColor(value); if (state.presets.some((entry) => equal(entry, next))) return; state.presets.push(next); state.presetAdded.emit(copyColor(next)); };
  picker.erase_preset = (value): void => { const next = checkedColor(value); const index = state.presets.findIndex((entry) => equal(entry, next)); if (index < 0) return; const [removed] = state.presets.splice(index, 1); state.presetRemoved.emit(copyColor(removed!)); };
  picker.add_recent_preset = (value): void => {
    const next = checkedColor(value);
    const index = state.recent.findIndex((entry) => equal(entry, next));
    if (index >= 0) {
      const [retained] = state.recent.splice(index, 1);
      state.recent.push(retained!);
      return;
    }
    if (state.recent.length >= 9) state.recent.shift();
    state.recent.push(next);
  };
  picker.erase_recent_preset = (value): void => { const next = checkedColor(value); const index = state.recent.findIndex((entry) => equal(entry, next)); if (index >= 0) state.recent.splice(index, 1); };
  picker.get_presets = (): PackedArrayValue<ColorValue> => packedColorArray(state.presets.map((entry) => copyColor(entry)));
  picker.get_recent_presets = (): PackedArrayValue<ColorValue> => packedColorArray(state.recent.map((entry) => copyColor(entry)));
  picker.set_can_add_swatches = (value): void => { picker.can_add_swatches = value; };
  picker.are_swatches_enabled = (): boolean => state.canAddSwatches;
  picker.set_colorize_sliders = (value): void => { picker.colorize_sliders = value; };
  picker.is_colorizing_sliders = (): boolean => state.colorizeSliders;
  picker.set_edit_intensity = (value): void => { picker.edit_intensity = value; };
  picker.is_editing_intensity = (): boolean => state.editIntensity;
  picker.set_presets_visible = (value): void => { picker.presets_visible = value; };
  picker.are_presets_visible = (): boolean => state.presetsVisible;
  picker.set_modes_visible = (value): void => { picker.color_modes_visible = value; };
  picker.are_modes_visible = (): boolean => state.modesVisible;
  picker.set_sampler_visible = (value): void => { picker.sampler_visible = value; };
  picker.is_sampler_visible = (): boolean => state.samplerVisible;
  picker.set_sliders_visible = (value): void => { picker.sliders_visible = value; };
  picker.are_sliders_visible = (): boolean => state.slidersVisible;
  picker.set_hex_visible = (value): void => { picker.hex_visible = value; };
  picker.is_hex_visible = (): boolean => state.hexVisible;
  state.unregister = registerCanvasNodeRelease(node, () => releaseCanvasColorPicker(picker));
  draw(picker);
  return picker;
}

export type GodotCanvasColorPickerButton = Container & {
  color: ColorValue;
  edit_alpha: boolean;
  edit_intensity: boolean;
  readonly color_changed: GodotSignal<readonly [ColorValue]>;
  readonly popup_closed: GodotSignal<readonly []>;
  readonly picker_created: GodotSignal<readonly []>;
  get_picker(): GodotCanvasColorPicker;
  get_popup(): GodotCanvasPopupDialog;
  set_pick_color(value: ColorValue): void;
  get_pick_color(): ColorValue;
  set_edit_alpha(value: boolean): void;
  is_editing_alpha(): boolean;
  set_edit_intensity(value: boolean): void;
  is_editing_intensity(): boolean;
};

export function bindCanvasColorPickerButton(
  node: Container,
  options: { readonly width: number; readonly height: number; readonly color?: ColorValue; readonly editAlpha?: boolean; readonly editIntensity?: boolean },
): GodotCanvasColorPickerButton {
  const button = node as GodotCanvasColorPickerButton;
  const changed = createSignal<readonly [ColorValue]>();
  const closed = createSignal<readonly []>();
  const created = createSignal<readonly []>();
  let value = checkedColor(options.color ?? godotColor(1, 1, 1, 1));
  let editAlpha = boolean('ColorPickerButton.edit_alpha', options.editAlpha ?? true);
  let editIntensity = boolean('ColorPickerButton.edit_intensity', options.editIntensity ?? false);
  let picker: GodotCanvasColorPicker | null = null;
  let popup: GodotCanvasPopupDialog | null = null;
  const swatch = markInternalCanvasChild(new Graphics());
  button.addChild(swatch);
  const redraw = (): void => {
    swatch.clear().roundRect(0, 0, options.width, options.height, 3).fill({ color: colorToRgba32(value) >>> 8, alpha: value.a });
  };
  const ensurePicker = (): GodotCanvasColorPicker => {
    if (picker !== null) return picker;
    popup = createGodotCanvasPopupPanel(() => {
      const bounds = button.parent?.getLocalBounds();
      return {
        x: Math.max(240, bounds?.width ?? 0),
        y: Math.max(180, bounds?.height ?? 0),
      };
    });
    markInternalCanvasChild(popup);
    popup.visible = false;
    button.addChild(popup);
    const pickerNode = markInternalCanvasChild(new Container());
    registerGodotObjectIdentity(pickerNode, 'ColorPicker');
    picker = bindCanvasColorPicker(pickerNode, { ...options, color: value, editAlpha, editIntensity });
    bindRuntimeCanvasControl(picker, {
      applySize: (size) => resizeCanvasColorPicker(picker!, size.x, size.y),
    });
    setCanvasControlCustomMinimumSize(picker, { x: options.width, y: options.height });
    popup.addChild(picker);
    picker.color_changed.connect((next) => { value = copyColor(next); redraw(); changed.emit(copyColor(value)); });
    created.emit();
    return picker;
  };
  const activate = (event?: FederatedPointerEvent): void => {
    event?.stopPropagation();
    const live = ensurePicker();
    const panel = popup!;
    if (panel.visible) {
      panel.visible = false;
      closed.emit();
    } else {
      panel.popup_centered({ x: Math.max(240, options.width), y: Math.max(180, options.height) });
      live.visible = true;
    }
  };
  button.eventMode = 'static';
  button.cursor = 'pointer';
  button.hitArea = new Rectangle(0, 0, options.width, options.height);
  button.on('pointertap', activate);
  Object.defineProperties(button, {
    color: { enumerable: true, configurable: true, get: () => copyColor(value), set: (next: ColorValue) => { value = checkedColor(next); if (picker !== null) picker.color = value; redraw(); changed.emit(copyColor(value)); } },
    edit_alpha: { enumerable: true, configurable: true, get: () => editAlpha, set: (next: boolean) => { editAlpha = boolean('ColorPickerButton.edit_alpha', next); if (picker !== null) picker.edit_alpha = editAlpha; } },
    edit_intensity: { enumerable: true, configurable: true, get: () => editIntensity, set: (next: boolean) => { editIntensity = boolean('ColorPickerButton.edit_intensity', next); if (picker !== null) picker.edit_intensity = editIntensity; } },
    color_changed: { enumerable: true, configurable: true, value: changed.signal },
    popup_closed: { enumerable: true, configurable: true, value: closed.signal },
    picker_created: { enumerable: true, configurable: true, value: created.signal },
  });
  button.get_picker = (): GodotCanvasColorPicker => ensurePicker();
  button.get_popup = (): GodotCanvasPopupDialog => { ensurePicker(); return popup!; };
  button.set_pick_color = (next): void => { button.color = next; };
  button.get_pick_color = (): ColorValue => button.color;
  button.set_edit_alpha = (next): void => { button.edit_alpha = next; };
  button.is_editing_alpha = (): boolean => editAlpha;
  button.set_edit_intensity = (next): void => { button.edit_intensity = next; };
  button.is_editing_intensity = (): boolean => editIntensity;
  registerCanvasNodeRelease(button, () => {
    button.off('pointertap', activate);
    if (picker !== null) releaseCanvasColorPicker(picker);
    if (popup !== null) releaseCanvasAdvancedControl(popup);
    swatch.removeFromParent();
    swatch.destroy();
  });
  redraw();
  return button;
}

/** Runtime ColorPickerButton constructor on the retained native Pixi swatch identity. */
export function createGodotCanvasColorPickerButton(): GodotCanvasColorPickerButton {
  const node = new Container();
  const button = bindCanvasColorPickerButton(node, { width: 28, height: 28 });
  bindRuntimeCanvasControl(button);
  setCanvasControlCustomMinimumSize(button, { x: 28, y: 28 });
  registerGodotObjectIdentity(node, 'ColorPickerButton');
  return button;
}

/** Runtime `ColorPicker.new()` over the retained HSV/circle sampler implementation. */
export function createGodotCanvasColorPicker(): GodotCanvasColorPicker {
  const picker = bindCanvasColorPicker(new Container(), { width: 240, height: 180 });
  bindRuntimeCanvasControl(picker, {
    applySize: (size) => resizeCanvasColorPicker(picker, size.x, size.y),
  });
  setCanvasControlCustomMinimumSize(picker, { x: 240, y: 180 });
  registerGodotObjectIdentity(picker, 'ColorPicker');
  return picker;
}

export function resizeCanvasColorPicker(picker: GodotCanvasColorPicker, width: number, height: number): void {
  const state = PICKERS.get(picker);
  if (state === undefined || state.released) throw new Error('Canvas ColorPicker is not bound.');
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) throw new RangeError('ColorPicker size must be finite and non-negative.');
  state.width = width;
  state.height = height;
  picker.hitArea = new Rectangle(0, 0, width, height);
  draw(picker);
}

export function releaseCanvasColorPicker(picker: GodotCanvasColorPicker): void {
  const state = PICKERS.get(picker);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  state.releaseListeners();
  state.canvas.removeFromParent();
  state.canvas.destroy();
  PICKERS.delete(picker);
}
