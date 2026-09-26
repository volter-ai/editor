/** Exact retained InputEvent dispatch for a statically open Variant receiver. */

import {
  getInputEventButtonIndex,
  getInputEventAction,
  getInputEventActionStrength,
  getInputEventDevice,
  getInputEventGlobalPosition,
  getInputEventJoypadAxis,
  getInputEventJoypadAxisValue,
  getInputEventJoypadButtonPressure,
  getInputEventKeyLabel,
  getInputEventKeycode,
  getInputEventKeyUnicode,
  getInputEventMouseButtonDoubleClick,
  getInputEventMouseButtonFactor,
  getInputEventMouseButtonMask,
  getInputEventMouseMotionPressure,
  getInputEventMouseMotionVector,
  getInputEventPhysicalKeycode,
  getInputEventPhysicalScancode,
  getInputEventPosition,
  getInputEventScancode,
  getInputEventScreenDragPressure,
  getInputEventScreenDragRelative,
  getInputEventScreenDragVelocity,
  getInputEventScreenIndex,
  getInputEventStrengthForAction,
  inputEventAsText,
  isInputEventActionPressed,
  isInputEventActionReleased,
  isInputEventAltPressed,
  isInputEventCommandPressed,
  isInputEventCommandOrControlPressed,
  isInputEventCommandOrControlAutoremap,
  isInputEventControlPressed,
  isInputEventEcho,
  isInputEventMetaPressed,
  isInputEventPressed,
  isInputEventReleased,
  isRetainedInputEvent,
  isInputEventScreenTouchCanceled,
  isInputEventShiftPressed,
  setInputEventButtonIndex,
  setInputEventAction,
  setInputEventActionStrength,
  setInputEventDevice,
  setInputEventGlobalPosition,
  setInputEventJoypadAxis,
  setInputEventJoypadAxisValue,
  setInputEventJoypadButtonPressure,
  setInputEventKeyLabel,
  setInputEventKeyEcho,
  setInputEventKeycode,
  setInputEventKeyUnicode,
  setInputEventMouseButtonDoubleClick,
  setInputEventMouseButtonFactor,
  setInputEventMouseButtonMask,
  setInputEventMouseMotionPressure,
  setInputEventMouseMotionVector,
  setInputEventPhysicalKeycode,
  setInputEventPhysicalScancode,
  setInputEventPosition,
  setInputEventPressed,
  setInputEventScancode,
  setInputEventScreenTouchPressed,
  setInputEventScreenDragPressure,
  setInputEventScreenDragRelative,
  setInputEventScreenDragVelocity,
  setInputEventScreenIndex,
  setInputEventAltPressed,
  setInputEventCommandOrControlAutoremap,
  setInputEventCommandPressed,
  setInputEventControlPressed,
  setInputEventMetaPressed,
  setInputEventScreenTouchCanceled,
  setInputEventShiftPressed,
  type GodotInput,
  type GodotInputMapEvent,
  type GodotScreenEvent,
} from './input';
import {
  godotVariantNodeNativeSignal,
  godotVariantNodePresentationGet,
  setGodotVariantNodePresentation,
} from './variant-node';
import {
  godotVariantGlobalPosition,
  godotVariantPosition,
  setGodotVariantGlobalPosition,
  setGodotVariantPosition,
} from './variant-spatial';

type InputEventMethod =
  | 'get_device'
  | 'set_device'
  | 'get_action'
  | 'set_action'
  | 'get_strength'
  | 'set_strength'
  | 'set_pressed'
  | 'get_unicode'
  | 'set_unicode'
  | 'get_keycode'
  | 'set_keycode'
  | 'get_physical_keycode'
  | 'set_physical_keycode'
  | 'get_scancode'
  | 'set_scancode'
  | 'get_physical_scancode'
  | 'set_physical_scancode'
  | 'set_echo'
  | 'get_button_index'
  | 'set_button_index'
  | 'get_pressure'
  | 'set_pressure'
  | 'get_axis'
  | 'set_axis'
  | 'get_axis_value'
  | 'set_axis_value'
  | 'get_factor'
  | 'set_factor'
  | 'is_doubleclick'
  | 'set_doubleclick'
  | 'is_double_click'
  | 'set_double_click'
  | 'is_action_pressed'
  | 'is_action_released'
  | 'get_action_strength'
  | 'is_pressed'
  | 'is_released'
  | 'is_echo'
  | 'as_text'
  | 'is_shift_pressed'
  | 'is_alt_pressed'
  | 'is_ctrl_pressed'
  | 'is_meta_pressed'
  | 'is_command_or_control_pressed'
  | 'set_shift_pressed'
  | 'set_alt_pressed'
  | 'set_ctrl_pressed'
  | 'set_meta_pressed'
  | 'set_command_or_control_autoremap'
  | 'get_shift'
  | 'set_shift'
  | 'get_alt'
  | 'set_alt'
  | 'get_control'
  | 'set_control'
  | 'get_metakey'
  | 'set_metakey'
  | 'get_command'
  | 'set_command';

type InputEventProperty =
  | 'device'
  | 'pressed'
  | 'echo'
  | 'button_index'
  | 'button_mask'
  | 'scancode'
  | 'physical_scancode'
  | 'keycode'
  | 'physical_keycode'
  | 'position'
  | 'global_position'
  | 'relative'
  | 'velocity'
  | 'factor'
  | 'index'
  | 'pressure'
  | 'axis'
  | 'axis_value'
  | 'doubleclick'
  | 'double_click'
  | 'shift_pressed'
  | 'alt_pressed'
  | 'ctrl_pressed'
  | 'meta_pressed'
  | 'command_or_control_autoremap'
  | 'unicode'
  | 'key_label'
  | 'canceled'
  | 'shift'
  | 'alt'
  | 'control'
  | 'meta'
  | 'command';

function retained(receiver: unknown): GodotInputMapEvent | GodotScreenEvent {
  if (!isRetainedInputEvent(receiver)) {
    throw new TypeError(
      'godot-compat: open InputEvent dispatch requires an engine-retained InputEvent identity.',
    );
  }
  return receiver;
}

function mapEvent(receiver: unknown): GodotInputMapEvent {
  const event = retained(receiver);
  if ('kind' in event) {
    throw new TypeError(`godot-compat: ${event.__godotClass} has no action binding identity.`);
  }
  return event;
}

function exactActionArgs(method: string, args: readonly unknown[]): [string, boolean] {
  if (args.length < 1 || args.length > 2 || typeof args[0] !== 'string') {
    throw new TypeError(`godot-compat: InputEvent.${method} requires action String and optional bool.`);
  }
  const exact = args[1] ?? false;
  if (typeof exact !== 'boolean') {
    throw new TypeError(`godot-compat: InputEvent.${method} exact_match requires bool.`);
  }
  return [args[0], exact];
}

function exactPressedActionArgs(args: readonly unknown[]): [string, boolean, boolean] {
  if (args.length < 1 || args.length > 3 || typeof args[0] !== 'string') {
    throw new TypeError(
      'godot-compat: InputEvent.is_action_pressed requires action String, optional allow_echo bool, and optional exact_match bool.',
    );
  }
  const allowEcho = args[1] ?? false;
  const exact = args[2] ?? false;
  if (typeof allowEcho !== 'boolean' || typeof exact !== 'boolean') {
    throw new TypeError(
      'godot-compat: InputEvent.is_action_pressed allow_echo and exact_match require bool.',
    );
  }
  return [args[0], allowEcho, exact];
}

export function godotVariantInputEventCall<T = unknown>(
  receiver: unknown,
  input: GodotInput,
  major: 3 | 4,
  method: InputEventMethod,
  args: readonly unknown[],
): T;
export function godotVariantInputEventCall(
  receiver: unknown,
  input: GodotInput,
  major: 3 | 4,
  method: InputEventMethod,
  args: readonly unknown[],
): unknown {
  const event = retained(receiver);
  if (method === 'get_device' || method === 'set_device') {
    if (method === 'get_device') {
      if (args.length !== 0) throw new TypeError('godot-compat: InputEvent.get_device takes no arguments.');
      return getInputEventDevice(event);
    }
    if (args.length !== 1 || !Number.isInteger(args[0])) {
      throw new TypeError('godot-compat: InputEvent.set_device requires one integer device ID.');
    }
    setInputEventDevice(event, args[0] as number);
    return undefined;
  }
  if (method === 'get_action' || method === 'set_action' ||
      method === 'get_strength' || method === 'set_strength') {
    const action = requireMapEvent(event, method);
    if (action.__godotClass !== 'InputEventAction') {
      throw new TypeError(`godot-compat: ${action.__godotClass}.${method} is absent.`);
    }
    if (method === 'get_action' || method === 'get_strength') {
      if (args.length !== 0) {
        throw new TypeError(`godot-compat: InputEventAction.${method} takes no arguments.`);
      }
      return method === 'get_action'
        ? getInputEventAction(action)
        : getInputEventActionStrength(action);
    }
    if (args.length !== 1) {
      throw new TypeError(`godot-compat: InputEventAction.${method} takes one argument.`);
    }
    if (method === 'set_action') {
      if (typeof args[0] !== 'string') {
        throw new TypeError('godot-compat: InputEventAction.set_action requires StringName.');
      }
      setInputEventAction(action, args[0]);
    } else {
      if (typeof args[0] !== 'number' || !Number.isFinite(args[0])) {
        throw new TypeError('godot-compat: InputEventAction.set_strength requires a finite float.');
      }
      setInputEventActionStrength(action, args[0]);
    }
    return undefined;
  }
  if (method === 'set_pressed') {
    if (args.length !== 1 || typeof args[0] !== 'boolean') {
      throw new TypeError('godot-compat: InputEvent.set_pressed requires one bool.');
    }
    requirePressed(event);
    if ('kind' in event) setInputEventScreenTouchPressed(event, args[0]);
    else setInputEventPressed(event, args[0]);
    return undefined;
  }
  if (method === 'get_unicode' || method === 'set_unicode' || method === 'set_echo' ||
      method === 'get_keycode' || method === 'set_keycode' ||
      method === 'get_physical_keycode' || method === 'set_physical_keycode' ||
      method === 'get_scancode' || method === 'set_scancode' ||
      method === 'get_physical_scancode' || method === 'set_physical_scancode') {
    const key = requireKey(event);
    const godot3Name = method.includes('scancode');
    const godot4Name = method.includes('keycode');
    if ((godot3Name && major !== 3) || (godot4Name && major !== 4)) {
      throw new Error(`godot-compat: InputEventKey.${method} is not a Godot ${major} method.`);
    }
    if (method.startsWith('get_')) {
      if (args.length !== 0) throw new TypeError(`godot-compat: InputEventKey.${method} takes no arguments.`);
      if (method === 'get_unicode') return getInputEventKeyUnicode(key);
      if (method === 'get_keycode') return getInputEventKeycode(key);
      if (method === 'get_physical_keycode') return getInputEventPhysicalKeycode(key);
      if (method === 'get_scancode') return getInputEventScancode(key);
      return getInputEventPhysicalScancode(key);
    }
    if (args.length !== 1) throw new TypeError(`godot-compat: InputEventKey.${method} takes one argument.`);
    if (method === 'set_echo') {
      if (typeof args[0] !== 'boolean') throw new TypeError('godot-compat: InputEventKey.set_echo requires bool.');
      setInputEventKeyEcho(key, args[0]);
    } else {
      if (!Number.isInteger(args[0])) {
        throw new TypeError(`godot-compat: InputEventKey.${method} requires an integer key value.`);
      }
      if (method === 'set_unicode') setInputEventKeyUnicode(key, args[0] as number);
      else if (method === 'set_keycode') setInputEventKeycode(key, args[0] as number);
      else if (method === 'set_physical_keycode') setInputEventPhysicalKeycode(key, args[0] as number);
      else if (method === 'set_scancode') setInputEventScancode(key, args[0] as number);
      else setInputEventPhysicalScancode(key, args[0] as number);
    }
    return undefined;
  }
  if (method === 'get_button_index' || method === 'set_button_index' ||
      method === 'get_pressure' || method === 'set_pressure' ||
      method === 'get_axis' || method === 'set_axis' ||
      method === 'get_axis_value' || method === 'set_axis_value' ||
      method === 'get_factor' || method === 'set_factor' ||
      method === 'is_doubleclick' || method === 'set_doubleclick' ||
      method === 'is_double_click' || method === 'set_double_click') {
    if (method === 'get_pressure' || method === 'set_pressure') {
      if (method === 'get_pressure') {
        if (args.length !== 0) {
          throw new TypeError(`godot-compat: ${mapClass(event)}.get_pressure takes no arguments.`);
        }
        if ('kind' in event) return getInputEventScreenDragPressure(event);
        if (event.__godotClass === 'InputEventJoypadButton') {
          return getInputEventJoypadButtonPressure(event);
        }
        return getInputEventMouseMotionPressure(event);
      }
      if (args.length !== 1 || typeof args[0] !== 'number') {
        throw new TypeError(`godot-compat: ${mapClass(event)}.set_pressure requires one float.`);
      }
      if ('kind' in event) setInputEventScreenDragPressure(event, args[0]);
      else if (event.__godotClass === 'InputEventJoypadButton') {
        setInputEventJoypadButtonPressure(event, args[0]);
      } else setInputEventMouseMotionPressure(event, args[0]);
      return undefined;
    }
    const mapped = requireMapEvent(event, method);
    const setter = method.startsWith('set_');
    if (args.length !== (setter ? 1 : 0)) {
      throw new TypeError(
        `godot-compat: ${mapped.__godotClass}.${method} takes ${setter ? 'one argument' : 'no arguments'}.`,
      );
    }
    if (method === 'get_button_index') return getInputEventButtonIndex(mapped);
    if (method === 'set_button_index') {
      if (!Number.isInteger(args[0])) {
        throw new TypeError('godot-compat: InputEvent button index requires an integer.');
      }
      setInputEventButtonIndex(mapped, args[0] as number);
      return undefined;
    }
    if (method === 'get_axis') return getInputEventJoypadAxis(mapped);
    if (method === 'set_axis') {
      if (!Number.isInteger(args[0])) {
        throw new TypeError('godot-compat: InputEventJoypadMotion.set_axis requires an integer axis.');
      }
      setInputEventJoypadAxis(mapped, args[0] as number);
      return undefined;
    }
    if (method === 'get_axis_value') return getInputEventJoypadAxisValue(mapped);
    if (method === 'set_axis_value') {
      if (typeof args[0] !== 'number') {
        throw new TypeError('godot-compat: InputEventJoypadMotion.set_axis_value requires float.');
      }
      setInputEventJoypadAxisValue(mapped, args[0]);
      return undefined;
    }
    if (method === 'get_factor') return getInputEventMouseButtonFactor(mapped);
    if (method === 'set_factor') {
      if (typeof args[0] !== 'number') {
        throw new TypeError('godot-compat: InputEventMouseButton.set_factor requires float.');
      }
      setInputEventMouseButtonFactor(mapped, args[0]);
      return undefined;
    }
    const godot3DoubleClick = method === 'is_doubleclick' || method === 'set_doubleclick';
    if (godot3DoubleClick !== (major === 3)) {
      throw new Error(`godot-compat: InputEventMouseButton.${method} is not a Godot ${major} method.`);
    }
    if (method === 'is_doubleclick' || method === 'is_double_click') {
      return getInputEventMouseButtonDoubleClick(mapped);
    }
    if (typeof args[0] !== 'boolean') {
      throw new TypeError(`godot-compat: InputEventMouseButton.${method} requires bool.`);
    }
    setInputEventMouseButtonDoubleClick(mapped, args[0]);
    return undefined;
  }
  if (method === 'is_action_pressed') {
    const [action, allowEcho, exact] = exactPressedActionArgs(args);
    const mapped = mapEvent(event);
    if (!allowEcho && isInputEventEcho(mapped)) return false;
    return isInputEventActionPressed(input, mapped, action, exact);
  }
  if (method === 'is_action_released' || method === 'get_action_strength') {
    const [action, exact] = exactActionArgs(method, args);
    const mapped = mapEvent(event);
    if (method === 'is_action_released') return isInputEventActionReleased(input, mapped, action, exact);
    return getInputEventStrengthForAction(input, mapped, action, exact);
  }
  if (method === 'as_text') {
    if (args.length !== 0) throw new TypeError('godot-compat: InputEvent.as_text takes no arguments.');
    return inputEventAsText(event);
  }
  if (method === 'is_pressed' || method === 'is_released' || method === 'is_echo') {
    if (args.length !== 0) throw new TypeError(`godot-compat: InputEvent.${method} takes no arguments.`);
    if (method === 'is_pressed') return isInputEventPressed(event);
    if (method === 'is_released') return isInputEventReleased(event);
    return isInputEventEcho(event);
  }
  if (major === 3) {
    const mapped = requireMapEvent(event, method);
    if (method.startsWith('set_')) {
      if (args.length !== 1 || typeof args[0] !== 'boolean') {
        throw new TypeError(`godot-compat: InputEventWithModifiers.${method} requires one bool.`);
      }
      if (method === 'set_shift') setInputEventShiftPressed(mapped, args[0]);
      else if (method === 'set_alt') setInputEventAltPressed(mapped, args[0]);
      else if (method === 'set_control') setInputEventControlPressed(mapped, args[0]);
      else if (method === 'set_metakey') setInputEventMetaPressed(mapped, args[0]);
      else if (method === 'set_command') setInputEventCommandPressed(mapped, args[0]);
      else throw new Error(`godot-compat: InputEventWithModifiers.${method} is Godot 4-only.`);
      return undefined;
    }
    if (args.length !== 0) {
      throw new TypeError(`godot-compat: InputEventWithModifiers.${method} takes no arguments.`);
    }
    if (method === 'get_shift') return isInputEventShiftPressed(mapped);
    if (method === 'get_alt') return isInputEventAltPressed(mapped);
    if (method === 'get_control') return isInputEventControlPressed(mapped);
    if (method === 'get_metakey') return isInputEventMetaPressed(mapped);
    if (method === 'get_command') return isInputEventCommandPressed(mapped);
    throw new Error(`godot-compat: InputEventWithModifiers.${method} is Godot 4-only.`);
  }
  if (major !== 4) {
    throw new Error(`godot-compat: InputEventWithModifiers.${method} is Godot 4-only.`);
  }
  const mapped = requireMapEvent(event, method);
  if (method.startsWith('set_')) {
    if (args.length !== 1 || typeof args[0] !== 'boolean') {
      throw new TypeError(`godot-compat: InputEventWithModifiers.${method} requires one bool.`);
    }
    if (method === 'set_shift_pressed') setInputEventShiftPressed(mapped, args[0]);
    else if (method === 'set_alt_pressed') setInputEventAltPressed(mapped, args[0]);
    else if (method === 'set_ctrl_pressed') setInputEventControlPressed(mapped, args[0]);
    else if (method === 'set_meta_pressed') setInputEventMetaPressed(mapped, args[0]);
    else if (method === 'set_command_or_control_autoremap') {
      setInputEventCommandOrControlAutoremap(mapped, args[0]);
    } else throw new Error(`godot-compat: InputEventWithModifiers.${method} is Godot 3-only.`);
    return undefined;
  }
  if (args.length !== 0) {
    throw new TypeError(`godot-compat: InputEventWithModifiers.${method} takes no arguments.`);
  }
  if (method === 'is_shift_pressed') return isInputEventShiftPressed(mapped);
  if (method === 'is_alt_pressed') return isInputEventAltPressed(mapped);
  if (method === 'is_ctrl_pressed') return isInputEventControlPressed(mapped);
  if (method === 'is_meta_pressed') return isInputEventMetaPressed(mapped);
  if (method === 'is_command_or_control_pressed') return isInputEventCommandOrControlPressed(mapped);
  throw new Error(`godot-compat: InputEventWithModifiers.${method} is Godot 3-only.`);
}

function mapClass(event: GodotInputMapEvent | GodotScreenEvent): string {
  return event.__godotClass;
}

function requireMapEvent(event: GodotInputMapEvent | GodotScreenEvent, property: string): GodotInputMapEvent {
  if ('kind' in event) throw new TypeError(`godot-compat: ${event.__godotClass}.${property} is absent.`);
  return event;
}

function requireKey(event: GodotInputMapEvent | GodotScreenEvent): GodotInputMapEvent {
  const mapped = requireMapEvent(event, 'key');
  if (mapped.__godotClass !== 'InputEventKey') {
    throw new TypeError(`godot-compat: ${mapped.__godotClass} is not InputEventKey.`);
  }
  return mapped;
}

function requirePressed(event: GodotInputMapEvent | GodotScreenEvent): void {
  if (!['InputEventKey', 'InputEventMouseButton', 'InputEventJoypadButton', 'InputEventAction',
    'InputEventScreenTouch'].includes(mapClass(event))) {
    throw new TypeError(`godot-compat: ${mapClass(event)} has no pressed property.`);
  }
}

export function godotVariantInputEventGet<T = unknown>(
  receiver: unknown,
  major: 3 | 4,
  property: InputEventProperty,
): T;
export function godotVariantInputEventGet(
  receiver: unknown,
  major: 3 | 4,
  property: InputEventProperty,
): unknown {
  const event = retained(receiver);
  if (property === 'device') return getInputEventDevice(event);
  if (property === 'shift' || property === 'alt' || property === 'control' ||
      property === 'meta' || property === 'command') {
    if (major !== 3) throw new Error(`godot-compat: InputEventWithModifiers.${property} is Godot 3-only.`);
    const mapped = requireMapEvent(event, property);
    if (property === 'shift') return isInputEventShiftPressed(mapped);
    if (property === 'alt') return isInputEventAltPressed(mapped);
    if (property === 'control') return isInputEventControlPressed(mapped);
    if (property === 'meta') return isInputEventMetaPressed(mapped);
    return isInputEventCommandPressed(mapped);
  }
  if (property === 'shift_pressed') return isInputEventShiftPressed(requireMapEvent(event, property));
  if (property === 'alt_pressed') return isInputEventAltPressed(requireMapEvent(event, property));
  if (property === 'ctrl_pressed') return isInputEventControlPressed(requireMapEvent(event, property));
  if (property === 'meta_pressed') return isInputEventMetaPressed(requireMapEvent(event, property));
  if (property === 'command_or_control_autoremap') {
    if (major !== 4) throw new Error('godot-compat: command_or_control_autoremap is Godot 4-only.');
    return isInputEventCommandOrControlAutoremap(requireMapEvent(event, property));
  }
  if (property === 'unicode') return getInputEventKeyUnicode(requireKey(event));
  if (property === 'key_label') {
    if (major !== 4) throw new Error('godot-compat: InputEventKey.key_label is Godot 4-only.');
    return getInputEventKeyLabel(requireKey(event));
  }
  if (property === 'canceled') {
    if ('kind' in event) return isInputEventScreenTouchCanceled(event);
    if (event.__godotClass !== 'InputEventMouseButton') {
      throw new TypeError(`godot-compat: ${event.__godotClass}.canceled is absent.`);
    }
    return event.canceled;
  }
  if (property === 'position') return getInputEventPosition(event);
  if (property === 'global_position') return getInputEventGlobalPosition(requireMapEvent(event, property));
  if (property === 'relative') {
    return 'kind' in event
      ? getInputEventScreenDragRelative(event)
      : getInputEventMouseMotionVector(event, 'relative');
  }
  if (property === 'velocity') {
    if (major !== 4) throw new Error('godot-compat: InputEvent velocity is Godot 4-only.');
    return 'kind' in event
      ? getInputEventScreenDragVelocity(event)
      : getInputEventMouseMotionVector(event, 'velocity');
  }
  if (property === 'factor') return getInputEventMouseButtonFactor(requireMapEvent(event, property));
  if (property === 'index') return getInputEventScreenIndex(event);
  if (property === 'pressure') {
    if ('kind' in event) return getInputEventScreenDragPressure(event);
    if (event.__godotClass === 'InputEventJoypadButton') return getInputEventJoypadButtonPressure(event);
    return getInputEventMouseMotionPressure(event);
  }
  if (property === 'axis') return getInputEventJoypadAxis(requireMapEvent(event, property));
  if (property === 'axis_value') return getInputEventJoypadAxisValue(requireMapEvent(event, property));
  if (property === 'doubleclick' || property === 'double_click') {
    if ((property === 'doubleclick') !== (major === 3)) {
      throw new Error(`godot-compat: InputEventMouseButton.${property} is not a Godot ${major} property.`);
    }
    return getInputEventMouseButtonDoubleClick(requireMapEvent(event, property));
  }
  if (property === 'pressed') { requirePressed(event); return isInputEventPressed(event); }
  if (property === 'echo') return isInputEventEcho(requireKey(event));
  if (property === 'button_index') return getInputEventButtonIndex(requireMapEvent(event, property));
  if (property === 'button_mask') return getInputEventMouseButtonMask(requireMapEvent(event, property));
  const key = requireKey(event);
  if (property === 'scancode') {
    if (major !== 3) throw new Error('godot-compat: InputEventKey.scancode is Godot 3-only.');
    return getInputEventScancode(key);
  }
  if (property === 'physical_scancode') {
    if (major !== 3) throw new Error('godot-compat: InputEventKey.physical_scancode is Godot 3-only.');
    return getInputEventPhysicalScancode(key);
  }
  if (property === 'keycode') {
    if (major !== 4) throw new Error('godot-compat: InputEventKey.keycode is Godot 4-only.');
    return getInputEventKeycode(key);
  }
  if (major !== 4) throw new Error('godot-compat: InputEventKey.physical_keycode is Godot 4-only.');
  return getInputEventPhysicalKeycode(key);
}

export function setGodotVariantInputEvent(
  receiver: unknown,
  major: 3 | 4,
  property: InputEventProperty,
  value: unknown,
): void {
  const event = retained(receiver);
  if (property === 'device') { setInputEventDevice(event, value as number); return; }
  if (property === 'shift' || property === 'alt' || property === 'control' ||
      property === 'meta' || property === 'command') {
    if (major !== 3) throw new Error(`godot-compat: InputEventWithModifiers.${property} is Godot 3-only.`);
    if (typeof value !== 'boolean') {
      throw new TypeError(`InputEventWithModifiers.${property} requires bool.`);
    }
    const mapped = requireMapEvent(event, property);
    if (property === 'shift') setInputEventShiftPressed(mapped, value);
    else if (property === 'alt') setInputEventAltPressed(mapped, value);
    else if (property === 'control') setInputEventControlPressed(mapped, value);
    else if (property === 'meta') setInputEventMetaPressed(mapped, value);
    else setInputEventCommandPressed(mapped, value);
    return;
  }
  if (property === 'shift_pressed') {
    setInputEventShiftPressed(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'alt_pressed') {
    setInputEventAltPressed(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'ctrl_pressed') {
    setInputEventControlPressed(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'meta_pressed') {
    setInputEventMetaPressed(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'command_or_control_autoremap') {
    if (major !== 4) throw new Error('godot-compat: command_or_control_autoremap is Godot 4-only.');
    setInputEventCommandOrControlAutoremap(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'unicode') { setInputEventKeyUnicode(requireKey(event), value as number); return; }
  if (property === 'key_label') {
    if (major !== 4) throw new Error('godot-compat: InputEventKey.key_label is Godot 4-only.');
    setInputEventKeyLabel(requireKey(event), value as number); return;
  }
  if (property === 'canceled') {
    if (typeof value !== 'boolean') throw new TypeError('InputEvent canceled requires bool.');
    if ('kind' in event) setInputEventScreenTouchCanceled(event, value);
    else if (event.__godotClass === 'InputEventMouseButton') event.canceled = value;
    else throw new TypeError(`godot-compat: ${event.__godotClass}.canceled is absent.`);
    return;
  }
  if (property === 'position') { setInputEventPosition(event, value as never); return; }
  if (property === 'global_position') {
    setInputEventGlobalPosition(requireMapEvent(event, property), value as never); return;
  }
  if (property === 'relative') {
    if ('kind' in event) setInputEventScreenDragRelative(event, value);
    else setInputEventMouseMotionVector(event, 'relative', value);
    return;
  }
  if (property === 'velocity') {
    if (major !== 4) throw new Error('godot-compat: InputEvent velocity is Godot 4-only.');
    if ('kind' in event) setInputEventScreenDragVelocity(event, value);
    else setInputEventMouseMotionVector(event, 'velocity', value);
    return;
  }
  if (property === 'factor') {
    setInputEventMouseButtonFactor(requireMapEvent(event, property), value as number); return;
  }
  if (property === 'index') { setInputEventScreenIndex(event, value); return; }
  if (property === 'pressure') {
    if ('kind' in event) setInputEventScreenDragPressure(event, value);
    else if (event.__godotClass === 'InputEventJoypadButton') {
      setInputEventJoypadButtonPressure(event, value as number);
    } else setInputEventMouseMotionPressure(event, value as number);
    return;
  }
  if (property === 'axis') { setInputEventJoypadAxis(requireMapEvent(event, property), value as number); return; }
  if (property === 'axis_value') {
    setInputEventJoypadAxisValue(requireMapEvent(event, property), value as number); return;
  }
  if (property === 'doubleclick' || property === 'double_click') {
    if ((property === 'doubleclick') !== (major === 3)) {
      throw new Error(`godot-compat: InputEventMouseButton.${property} is not a Godot ${major} property.`);
    }
    setInputEventMouseButtonDoubleClick(requireMapEvent(event, property), value as boolean); return;
  }
  if (property === 'pressed') {
    requirePressed(event);
    if (typeof value !== 'boolean') throw new TypeError('InputEvent.pressed requires bool.');
    if ('kind' in event) setInputEventScreenTouchPressed(event, value);
    else setInputEventPressed(event, value);
    return;
  }
  if (property === 'echo') { setInputEventKeyEcho(requireKey(event), value as boolean); return; }
  const mapped = requireMapEvent(event, property);
  if (property === 'button_index') { setInputEventButtonIndex(mapped, value as number); return; }
  if (property === 'button_mask') { setInputEventMouseButtonMask(mapped, value as number); return; }
  const key = requireKey(mapped);
  if (property === 'scancode') {
    if (major !== 3) throw new Error('godot-compat: InputEventKey.scancode is Godot 3-only.');
    setInputEventScancode(key, value as number); return;
  }
  if (property === 'physical_scancode') {
    if (major !== 3) throw new Error('godot-compat: InputEventKey.physical_scancode is Godot 3-only.');
    setInputEventPhysicalScancode(key, value as number); return;
  }
  if (property === 'keycode') {
    if (major !== 4) throw new Error('godot-compat: InputEventKey.keycode is Godot 4-only.');
    setInputEventKeycode(key, value as number); return;
  }
  if (major !== 4) throw new Error('godot-compat: InputEventKey.physical_keycode is Godot 4-only.');
  setInputEventPhysicalKeycode(key, value as number);
}

/** The shared spelling is an InputEvent bool, a Godot 3 BaseButton bool, and a G4 signal. */
export function godotVariantPressed(receiver: unknown, major: 3 | 4): unknown {
  if (isRetainedInputEvent(receiver)) {
    const event = retained(receiver);
    requirePressed(event);
    return isInputEventPressed(event);
  }
  return major === 4
    ? godotVariantNodeNativeSignal(receiver, major, 'pressed')
    : godotVariantNodePresentationGet(receiver, major, 'pressed');
}

export function setGodotVariantPressed(receiver: unknown, major: 3 | 4, value: unknown): void {
  if (isRetainedInputEvent(receiver)) {
    setGodotVariantInputEvent(receiver, major, 'pressed', value);
    return;
  }
  if (major === 4) {
    throw new TypeError('godot-compat: Godot 4 BaseButton.pressed is a read-only Signal.');
  }
  setGodotVariantNodePresentation(receiver, major, 'pressed', value);
}

export function godotVariantCanceled(receiver: unknown, major: 3 | 4): unknown {
  return isRetainedInputEvent(receiver)
    ? godotVariantInputEventGet(receiver, major, 'canceled')
    : godotVariantNodeNativeSignal(receiver, major, 'canceled');
}

export function setGodotVariantCanceled(receiver: unknown, major: 3 | 4, value: unknown): void {
  if (!isRetainedInputEvent(receiver)) {
    throw new TypeError('godot-compat: native Node canceled is a read-only Signal.');
  }
  setGodotVariantInputEvent(receiver, major, 'canceled', value);
}

export function godotVariantInputPosition(receiver: unknown, major: 3 | 4): unknown {
  return isRetainedInputEvent(receiver)
    ? godotVariantInputEventGet(receiver, major, 'position')
    : godotVariantPosition(receiver);
}

export function setGodotVariantInputPosition(receiver: unknown, major: 3 | 4, value: unknown): void {
  if (isRetainedInputEvent(receiver)) setGodotVariantInputEvent(receiver, major, 'position', value);
  else setGodotVariantPosition(receiver, value);
}

export function godotVariantInputGlobalPosition(
  receiver: unknown,
  major: 3 | 4,
  root: unknown,
): unknown {
  return isRetainedInputEvent(receiver)
    ? godotVariantInputEventGet(receiver, major, 'global_position')
    : godotVariantGlobalPosition(receiver, root);
}

export function setGodotVariantInputGlobalPosition(
  receiver: unknown,
  major: 3 | 4,
  root: unknown,
  value: unknown,
): void {
  if (isRetainedInputEvent(receiver)) {
    setGodotVariantInputEvent(receiver, major, 'global_position', value);
  }
  else setGodotVariantGlobalPosition(receiver, root, value);
}

export function godotVariantInputVelocity(receiver: unknown, major: 3 | 4): unknown {
  return isRetainedInputEvent(receiver)
    ? godotVariantInputEventGet(receiver, major, 'velocity')
    : godotVariantNodePresentationGet(receiver, major, 'velocity');
}

export function setGodotVariantInputVelocity(receiver: unknown, major: 3 | 4, value: unknown): void {
  if (isRetainedInputEvent(receiver)) setGodotVariantInputEvent(receiver, major, 'velocity', value);
  else setGodotVariantNodePresentation(receiver, major, 'velocity', value);
}
