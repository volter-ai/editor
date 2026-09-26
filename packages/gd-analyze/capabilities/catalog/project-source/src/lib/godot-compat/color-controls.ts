/** Retained ColorPicker/ColorPickerButton behavior projected through the existing Control store. */

import { colorToHtml, copyColor, godotColor } from './color';
import { bindBaseButton, type GodotButtonControl } from './control-widgets';
import {
  controlBinding,
  createControlHandle,
  createControlState,
  type ControlPoint,
  type GodotControl,
} from './control-state';
import { registerGodotObjectIdentity } from './object';
import { packedColorArray, type PackedArrayValue } from './packed-array';
import { bindPopupControl, type GodotPopupControl } from './popup-control';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import type { ColorValue } from './variant';

function color(value: ColorValue): ColorValue {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.r) || !Number.isFinite(value.g) ||
      !Number.isFinite(value.b) || !Number.isFinite(value.a)) {
    throw new TypeError('ColorPicker.color must be a finite Color.');
  }
  return copyColor(value);
}

function bool(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function retainedIntensity(value: ColorValue, enabled: boolean): number {
  if (!enabled) return 0;
  const peak = Math.max(value.r, value.g, value.b);
  return peak > 1 ? Math.log2(peak) : 0;
}

function applyRetainedIntensity(value: ColorValue, intensity: number): ColorValue {
  if (intensity === 0) return value;
  const multiplier = 2 ** intensity;
  return { r: value.r * multiplier, g: value.g * multiplier, b: value.b * multiplier, a: value.a };
}

export interface GodotColorPicker extends GodotControl {
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
}

interface PickerState {
  value: ColorValue;
  editAlpha: boolean;
  deferred: boolean;
  mode: number;
  shape: number;
  readonly changed: SignalHandle<readonly [ColorValue]>;
  pending: ColorValue | null;
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
  readonly presetAdded: SignalHandle<readonly [ColorValue]>;
  readonly presetRemoved: SignalHandle<readonly [ColorValue]>;
}

export function bindColorPicker(
  control: GodotControl,
  initial: {
    readonly color?: ColorValue;
    readonly editAlpha?: boolean;
    readonly deferredMode?: boolean;
    readonly colorMode?: number;
    readonly pickerShape?: number;
    readonly editIntensity?: boolean;
    readonly canAddSwatches?: boolean;
    readonly colorizeSliders?: boolean;
    readonly samplerVisible?: boolean;
    readonly slidersVisible?: boolean;
    readonly hexVisible?: boolean;
    readonly presetsVisible?: boolean;
    readonly modesVisible?: boolean;
  } = {},
  projected = true,
): GodotColorPicker {
  const picker = control as GodotColorPicker;
  const binding = projected ? controlBinding(control) : null;
  const integer = (member: string, value: number, maximum: number): number => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new RangeError(`${member} must be an integer from 0 through ${maximum}.`);
    }
    return value;
  };
  const state: PickerState = {
    value: color(initial.color ?? godotColor(1, 1, 1, 1)),
    editAlpha: bool('ColorPicker.edit_alpha', initial.editAlpha ?? true),
    deferred: bool('ColorPicker.deferred_mode', initial.deferredMode ?? false),
    mode: integer('ColorPicker.color_mode', initial.colorMode ?? 0, 3),
    shape: integer('ColorPicker.picker_shape', initial.pickerShape ?? 0, 6),
    changed: createSignal<readonly [ColorValue]>(),
    pending: null,
    presets: [],
    recent: [],
    canAddSwatches: bool('ColorPicker.can_add_swatches', initial.canAddSwatches ?? true),
    colorizeSliders: bool('ColorPicker.colorize_sliders', initial.colorizeSliders ?? true),
    editIntensity: bool('ColorPicker.edit_intensity', initial.editIntensity ?? false),
    samplerVisible: bool('ColorPicker.sampler_visible', initial.samplerVisible ?? true),
    slidersVisible: bool('ColorPicker.sliders_visible', initial.slidersVisible ?? true),
    hexVisible: bool('ColorPicker.hex_visible', initial.hexVisible ?? true),
    presetsVisible: bool('ColorPicker.presets_visible', initial.presetsVisible ?? true),
    modesVisible: bool('ColorPicker.color_modes_visible', initial.modesVisible ?? true),
    presetAdded: createSignal<readonly [ColorValue]>(),
    presetRemoved: createSignal<readonly [ColorValue]>(),
  };
  const commitPending = (): void => {
    if (state.pending === null) return;
    state.value = state.pending;
    state.pending = null;
    sync();
    state.changed.emit(copyColor(state.value));
  };
  const sync = (): void => binding?.state.write(binding.id, {
    colorPickerHex: `#${colorToHtml(state.value, false)}`,
    colorPickerAlpha: state.value.a,
    colorPickerEditAlpha: state.editAlpha,
    colorPickerMode: state.mode,
    colorPickerSamplerVisible: state.samplerVisible,
    colorPickerSlidersVisible: state.slidersVisible,
    colorPickerHexVisible: state.hexVisible,
    colorPickerPresetsVisible: state.presetsVisible,
    colorPickerModesVisible: state.modesVisible,
    colorPickerPresets: state.presets.map((entry) => `#${colorToHtml(entry, false)}`),
    onColorPickerInput(hex, alpha, commit): void {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex) || !Number.isFinite(alpha)) {
        throw new TypeError('ColorPicker browser input must be #RRGGBB with finite alpha.');
      }
      const normalized = godotColor(
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
        state.editAlpha ? Math.max(0, Math.min(1, alpha)) : state.value.a,
      );
      const next = applyRetainedIntensity(normalized, retainedIntensity(state.value, state.editIntensity));
      if (state.deferred && !commit) state.pending = next;
      else {
        state.pending = null;
        state.value = next;
        sync();
        state.changed.emit(copyColor(state.value));
      }
    },
    onColorPickerCommit(): void {
      commitPending();
    },
  });
  Object.defineProperties(picker, {
    color: { enumerable: true, configurable: true, get: () => copyColor(state.value), set: (value: ColorValue) => { state.value = color(value); state.pending = null; sync(); state.changed.emit(copyColor(state.value)); } },
    edit_alpha: { enumerable: true, configurable: true, get: () => state.editAlpha, set: (value: boolean) => { state.editAlpha = bool('ColorPicker.edit_alpha', value); sync(); } },
    deferred_mode: { enumerable: true, configurable: true, get: () => state.deferred, set: (value: boolean) => { state.deferred = bool('ColorPicker.deferred_mode', value); if (!state.deferred) commitPending(); } },
    color_mode: { enumerable: true, configurable: true, get: () => state.mode, set: (value: number) => { state.mode = integer('ColorPicker.color_mode', value, 3); } },
    picker_shape: { enumerable: true, configurable: true, get: () => state.shape, set: (value: number) => { state.shape = integer('ColorPicker.picker_shape', value, 6); } },
    edit_intensity: { enumerable: true, configurable: true, get: () => state.editIntensity, set: (value: boolean) => { state.editIntensity = bool('ColorPicker.edit_intensity', value); sync(); } },
    sampler_visible: { enumerable: true, configurable: true, get: () => state.samplerVisible, set: (value: boolean) => { state.samplerVisible = bool('ColorPicker.sampler_visible', value); sync(); } },
    sliders_visible: { enumerable: true, configurable: true, get: () => state.slidersVisible, set: (value: boolean) => { state.slidersVisible = bool('ColorPicker.sliders_visible', value); sync(); } },
    hex_visible: { enumerable: true, configurable: true, get: () => state.hexVisible, set: (value: boolean) => { state.hexVisible = bool('ColorPicker.hex_visible', value); sync(); } },
    presets_visible: { enumerable: true, configurable: true, get: () => state.presetsVisible, set: (value: boolean) => { state.presetsVisible = bool('ColorPicker.presets_visible', value); sync(); } },
    color_modes_visible: { enumerable: true, configurable: true, get: () => state.modesVisible, set: (value: boolean) => { state.modesVisible = bool('ColorPicker.color_modes_visible', value); sync(); } },
    color_changed: { enumerable: true, configurable: true, value: state.changed.signal },
    preset_added: { enumerable: true, configurable: true, value: state.presetAdded.signal },
    preset_removed: { enumerable: true, configurable: true, value: state.presetRemoved.signal },
  });
  picker.set_pick_color = (value): void => { picker.color = value; };
  picker.get_pick_color = (): ColorValue => copyColor(state.value);
  picker.set_edit_alpha = (value): void => { picker.edit_alpha = value; };
  picker.is_editing_alpha = (): boolean => state.editAlpha;
  picker.set_deferred_mode = (value): void => { picker.deferred_mode = value; };
  picker.is_deferred_mode = (): boolean => state.deferred;
  picker.set_color_mode = (value): void => { picker.color_mode = value; };
  picker.get_color_mode = (): number => state.mode;
  picker.set_picker_shape = (value): void => { picker.picker_shape = value; };
  picker.get_picker_shape = (): number => state.shape;
  const equal = (left: ColorValue, right: ColorValue): boolean => left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
  picker.add_preset = (value): void => { const next = color(value); if (state.presets.some((entry) => equal(entry, next))) return; state.presets.push(next); sync(); state.presetAdded.emit(copyColor(next)); };
  picker.erase_preset = (value): void => { const next = color(value); const index = state.presets.findIndex((entry) => equal(entry, next)); if (index < 0) return; const [removed] = state.presets.splice(index, 1); sync(); state.presetRemoved.emit(copyColor(removed!)); };
  picker.add_recent_preset = (value): void => {
    const next = color(value);
    const existing = state.recent.findIndex((entry) => equal(entry, next));
    if (existing >= 0) {
      const [retained] = state.recent.splice(existing, 1);
      state.recent.push(retained!);
      return;
    }
    if (state.recent.length >= 9) state.recent.shift();
    state.recent.push(next);
  };
  picker.erase_recent_preset = (value): void => { const next = color(value); const index = state.recent.findIndex((entry) => equal(entry, next)); if (index >= 0) state.recent.splice(index, 1); };
  picker.get_presets = (): PackedArrayValue<ColorValue> => packedColorArray(state.presets.map((entry) => copyColor(entry)));
  picker.get_recent_presets = (): PackedArrayValue<ColorValue> => packedColorArray(state.recent.map((entry) => copyColor(entry)));
  picker.set_can_add_swatches = (value): void => { state.canAddSwatches = bool('ColorPicker.can_add_swatches', value); };
  picker.are_swatches_enabled = (): boolean => state.canAddSwatches;
  picker.set_colorize_sliders = (value): void => { state.colorizeSliders = bool('ColorPicker.colorize_sliders', value); };
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
  sync();
  return picker;
}

export interface GodotColorPickerButton extends GodotButtonControl {
  color: ColorValue;
  edit_alpha: boolean;
  edit_intensity: boolean;
  readonly color_changed: GodotSignal<readonly [ColorValue]>;
  readonly popup_closed: GodotSignal<readonly []>;
  readonly picker_created: GodotSignal<readonly []>;
  get_picker(): GodotColorPicker;
  get_popup(): GodotPopupControl;
  set_pick_color(value: ColorValue): void;
  get_pick_color(): ColorValue;
  set_edit_alpha(value: boolean): void;
  is_editing_alpha(): boolean;
  set_edit_intensity(value: boolean): void;
  is_editing_intensity(): boolean;
}

export function bindColorPickerButton(
  control: GodotControl,
  initial: {
    readonly color?: ColorValue;
    readonly editAlpha?: boolean;
    readonly editIntensity?: boolean;
    readonly viewportSize?: () => ControlPoint;
  } = {},
): GodotColorPickerButton {
  const button = bindBaseButton(control) as GodotColorPickerButton;
  const binding = controlBinding(control);
  const changed = createSignal<readonly [ColorValue]>();
  const closed = createSignal<readonly []>();
  const created = createSignal<readonly []>();
  let value = color(initial.color ?? godotColor(1, 1, 1, 1));
  let editAlpha = bool('ColorPickerButton.edit_alpha', initial.editAlpha ?? true);
  let editIntensity = bool('ColorPickerButton.edit_intensity', initial.editIntensity ?? false);
  let picker: GodotColorPicker | null = null;
  let popup: GodotPopupControl | null = null;
  const ensurePopup = (): GodotPopupControl => {
    if (popup !== null) return popup;
    const popupState = createControlState();
    const popupControl = createControlHandle('color-picker-popup', {
      visible: false,
      text: '',
      texture: '',
      position: { x: 0, y: 0 },
      size: { x: 240, y: 180 },
      custom_minimum_size: { x: 240, y: 180 },
      size_flags_horizontal: 1,
      size_flags_vertical: 1,
      mouse_filter: 0,
      focusMode: 0,
      pivot_offset: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      modulate: { r: 1, g: 1, b: 1, a: 1 },
    }, popupState);
    popup = bindPopupControl(popupControl, {
      viewportSize: initial.viewportSize ?? (() => {
        const record = binding.state.read(binding.id);
        return { x: Math.max(240, record.size?.x ?? 0), y: Math.max(180, record.size?.y ?? 0) };
      }),
    });
    registerGodotObjectIdentity(popup, 'PopupPanel');
    popup.popup_hide.connect(() => closed.emit());
    return popup;
  };
  const ensurePicker = (): GodotColorPicker => {
    if (picker !== null) return picker;
    ensurePopup();
    const pickerIdentity = {} as GodotControl;
    registerGodotObjectIdentity(pickerIdentity, 'ColorPicker');
    picker = bindColorPicker(pickerIdentity, { color: value, editAlpha, editIntensity }, false);
    picker.color_changed.connect((next) => { value = copyColor(next); sync(); changed.emit(copyColor(value)); });
    created.emit();
    return picker;
  };
  const sync = (): void => binding.state.write(binding.id, {
    colorPickerHex: `#${colorToHtml(value, false)}`,
    colorPickerAlpha: value.a,
    colorPickerEditAlpha: editAlpha,
    onColorPickerInput(hex, alpha): void {
      const next = godotColor(Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255, editAlpha ? alpha : value.a);
      value = next;
      if (picker !== null) picker.set_pick_color(next);
      sync();
      changed.emit(copyColor(value));
    },
  });
  button.pressed.connect(() => {
    ensurePicker();
    const panel = ensurePopup();
    if (panel.is_popup_visible()) panel.hide();
    else panel.popup_centered({ x: 240, y: 180 });
  });
  Object.defineProperties(button, {
    color: { enumerable: true, configurable: true, get: () => copyColor(value), set: (next: ColorValue) => { value = color(next); if (picker !== null) picker.set_pick_color(value); sync(); changed.emit(copyColor(value)); } },
    edit_alpha: { enumerable: true, configurable: true, get: () => editAlpha, set: (next: boolean) => { editAlpha = bool('ColorPickerButton.edit_alpha', next); if (picker !== null) picker.set_edit_alpha(editAlpha); sync(); } },
    edit_intensity: { enumerable: true, configurable: true, get: () => editIntensity, set: (next: boolean) => { editIntensity = bool('ColorPickerButton.edit_intensity', next); if (picker !== null) picker.set_edit_intensity(editIntensity); sync(); } },
    color_changed: { enumerable: true, configurable: true, value: changed.signal },
    popup_closed: { enumerable: true, configurable: true, value: closed.signal },
    picker_created: { enumerable: true, configurable: true, value: created.signal },
  });
  button.get_picker = (): GodotColorPicker => ensurePicker();
  button.get_popup = (): GodotPopupControl => ensurePopup();
  button.set_pick_color = (value): void => { button.color = value; };
  button.get_pick_color = (): ColorValue => button.color;
  button.set_edit_alpha = (value): void => { button.edit_alpha = value; };
  button.is_editing_alpha = (): boolean => editAlpha;
  button.set_edit_intensity = (value): void => { button.edit_intensity = value; };
  button.is_editing_intensity = (): boolean => editIntensity;
  sync();
  return button;
}
