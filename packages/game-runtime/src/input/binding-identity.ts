import type { InputBinding } from './input-types';

/**
 * Whether two bindings name the same physical input.
 *
 * This is the native identity rule used by both runtime rebinding and the
 * editor's `.inputmap.json` document. Deadzones do not change identity, while
 * opposite directions on one gamepad axis remain independent controls.
 */
export function inputBindingsCollide(a: InputBinding, b: InputBinding): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'key':
      return a.code === (b as typeof a).code;
    case 'mouse_button':
      return a.button === (b as typeof a).button;
    case 'mouse_move':
      return true;
    case 'gamepad_button':
      return a.button === (b as typeof a).button;
    case 'gamepad_axis': {
      const other = b as typeof a;
      return a.axis === other.axis && a.direction === other.direction;
    }
    case 'gamepad_axis_pair': {
      const other = b as typeof a;
      return a.xAxis === other.xAxis && a.yAxis === other.yAxis;
    }
    case 'touch_button':
    case 'touch_stick':
    case 'test_axis':
    case 'test_vector2':
    case 'test_pointer_delta':
    case 'test_pointer_position':
      return a.sourceId === (b as typeof a).sourceId;
  }
}
