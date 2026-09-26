/** Retained policy state for Control translation, recursive input, cursor, and shortcut behavior. */

import { Container } from 'pixi.js';

import { getControlDefaultCursorShape, setControlDefaultCursorShape } from './control-layout-runtime';

interface CanvasControlPolicyState {
  autoTranslate: boolean;
  translationContext: string;
  localizeNumeralSystem: boolean;
  focusBehaviorRecursive: 0 | 1 | 2;
  mouseBehaviorRecursive: 0 | 1 | 2;
  forcePassScrollEvents: boolean;
  shortcutContext: object | null;
  tooltipAutoTranslateMode: 0 | 1 | 2;
}

const POLICIES = new WeakMap<Container, CanvasControlPolicyState>();

function policy(control: Container): CanvasControlPolicyState {
  let state = POLICIES.get(control);
  if (state === undefined) {
    state = {
      autoTranslate: true,
      translationContext: '',
      localizeNumeralSystem: true,
      focusBehaviorRecursive: 0,
      mouseBehaviorRecursive: 0,
      forcePassScrollEvents: true,
      shortcutContext: null,
      tooltipAutoTranslateMode: 0,
    };
    POLICIES.set(control, state);
  }
  return state;
}

function bool(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Control.${member} requires bool.`);
  return value;
}

function text(value: string, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`Control.${member} requires a String.`);
  return value;
}

function recursive(value: number, member: string): 0 | 1 | 2 {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`Control.${member} requires INHERITED, DISABLED, or ENABLED.`);
  }
  return value as 0 | 1 | 2;
}

function shortcutContext(value: object | null): object | null {
  if (value !== null && typeof value !== 'object') {
    throw new TypeError('Control.shortcut_context requires a Node or null.');
  }
  return value;
}

export interface GodotCanvasControlPolicyApi {
  auto_translate: boolean;
  translation_context: string;
  localize_numeral_system: boolean;
  focus_behavior_recursive: number;
  mouse_behavior_recursive: number;
  mouse_force_pass_scroll_events: boolean;
  mouse_default_cursor_shape: number;
  shortcut_context: object | null;
  tooltip_auto_translate_mode: number;
  set_auto_translate(value: boolean): void;
  is_auto_translating(): boolean;
  set_translation_context(value: string): void;
  get_translation_context(): string;
  set_localize_numeral_system(value: boolean): void;
  is_localizing_numeral_system(): boolean;
  set_focus_behavior_recursive(value: number): void;
  get_focus_behavior_recursive(): number;
  set_mouse_behavior_recursive(value: number): void;
  get_mouse_behavior_recursive(): number;
  set_force_pass_scroll_events(value: boolean): void;
  is_force_pass_scroll_events(): boolean;
  set_default_cursor_shape(value: number): void;
  get_default_cursor_shape(): number;
  set_shortcut_context(value: object | null): void;
  get_shortcut_context(): object | null;
  set_tooltip_auto_translate_mode(value: number): void;
  get_tooltip_auto_translate_mode(): number;
}

export function bindGodotCanvasControlPolicyApi<T extends Container>(
  source: T,
): T & GodotCanvasControlPolicyApi {
  const control = source as T & GodotCanvasControlPolicyApi;
  const state = policy(control);
  const setAutoTranslate = (value: boolean): void => { state.autoTranslate = bool(value, 'auto_translate'); };
  const setTranslationContext = (value: string): void => { state.translationContext = text(value, 'translation_context'); };
  const setLocalize = (value: boolean): void => { state.localizeNumeralSystem = bool(value, 'localize_numeral_system'); };
  const setFocusRecursive = (value: number): void => { state.focusBehaviorRecursive = recursive(value, 'focus_behavior_recursive'); };
  const setMouseRecursive = (value: number): void => { state.mouseBehaviorRecursive = recursive(value, 'mouse_behavior_recursive'); };
  const setForceScroll = (value: boolean): void => { state.forcePassScrollEvents = bool(value, 'mouse_force_pass_scroll_events'); };
  const setShortcutContext = (value: object | null): void => { state.shortcutContext = shortcutContext(value); };
  const setTooltipTranslate = (value: number): void => { state.tooltipAutoTranslateMode = recursive(value, 'tooltip_auto_translate_mode'); };
  Object.defineProperties(control, {
    auto_translate: { configurable: true, enumerable: true, get: () => state.autoTranslate, set: setAutoTranslate },
    translation_context: { configurable: true, enumerable: true, get: () => state.translationContext, set: setTranslationContext },
    localize_numeral_system: { configurable: true, enumerable: true, get: () => state.localizeNumeralSystem, set: setLocalize },
    focus_behavior_recursive: { configurable: true, enumerable: true, get: () => state.focusBehaviorRecursive, set: setFocusRecursive },
    mouse_behavior_recursive: { configurable: true, enumerable: true, get: () => state.mouseBehaviorRecursive, set: setMouseRecursive },
    mouse_force_pass_scroll_events: { configurable: true, enumerable: true, get: () => state.forcePassScrollEvents, set: setForceScroll },
    mouse_default_cursor_shape: { configurable: true, enumerable: true, get: () => getControlDefaultCursorShape(control), set: (value: number) => setControlDefaultCursorShape(control, value) },
    shortcut_context: { configurable: true, enumerable: true, get: () => state.shortcutContext, set: setShortcutContext },
    tooltip_auto_translate_mode: { configurable: true, enumerable: true, get: () => state.tooltipAutoTranslateMode, set: setTooltipTranslate },
  });
  Object.assign(control, {
    set_auto_translate: setAutoTranslate,
    is_auto_translating: (): boolean => state.autoTranslate,
    set_translation_context: setTranslationContext,
    get_translation_context: (): string => state.translationContext,
    set_localize_numeral_system: setLocalize,
    is_localizing_numeral_system: (): boolean => state.localizeNumeralSystem,
    set_focus_behavior_recursive: setFocusRecursive,
    get_focus_behavior_recursive: (): number => state.focusBehaviorRecursive,
    set_mouse_behavior_recursive: setMouseRecursive,
    get_mouse_behavior_recursive: (): number => state.mouseBehaviorRecursive,
    set_force_pass_scroll_events: setForceScroll,
    is_force_pass_scroll_events: (): boolean => state.forcePassScrollEvents,
    set_default_cursor_shape: (value: number): void => setControlDefaultCursorShape(control, value),
    get_default_cursor_shape: (): number => getControlDefaultCursorShape(control),
    set_shortcut_context: setShortcutContext,
    get_shortcut_context: (): object | null => state.shortcutContext,
    set_tooltip_auto_translate_mode: setTooltipTranslate,
    get_tooltip_auto_translate_mode: (): number => state.tooltipAutoTranslateMode,
  });
  return control;
}
