/**
 * The InputMap the translated project loads (`InputMap::load_from_project_settings`,
 * `core/input/input_map.cpp:325`): every `input/*` setting, which is Godot's built-in actions
 * (`ProjectSettings::_add_builtin_input_map`, `core/config/project_settings.cpp:1648`, deadzone
 * `DEFAULT_TOGGLE_DEADZONE` 0.5) with the project's `[input]` actions over them by name. The
 * built-ins are transcribed from `InputMap::get_builtins` (`core/input/input_map.cpp:452`) in
 * insertion order; a `.macos` entry is its own setting and so its own action, and the base action
 * keeps its own events on the web (whose features are `web_*`, never `macos`). An event built with
 * `KeyModifierMask::CMD_OR_CTRL` keeps `command_or_control_autoremap`, which compat resolves on the
 * page (`OS::prefer_meta_over_ctrl`).
 */
import type { InputAction } from '../../read/godot-types';

/** An input event record as `godot-compat/input-event.ts` holds it (a mouse position is `[x, y]`). */
export type TargetInputEventRecord = Readonly<Record<string, number | boolean | string | readonly [number, number]>>;

export interface DirectGodotInputActionPlan {
  readonly name: string;
  readonly deadzone: number;
  readonly events: readonly TargetInputEventRecord[];
}

/** `InputMap::get_builtins` (`core/input/input_map.cpp:452`): each action, its source line, its events. */
const BUILTINS: readonly (readonly [string, number, readonly TargetInputEventRecord[]])[] = [
  ['ui_accept', 462, [{ type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 32, physical_keycode: 0, key_label: 0 }]],
  ['ui_select', 467, [{ type: 'joypad_button', pressed: false, button_index: 3, device: -1 }, { type: 'key', pressed: false, keycode: 32, physical_keycode: 0, key_label: 0 }]],
  ['ui_cancel', 471, [{ type: 'key', pressed: false, keycode: 4194305, physical_keycode: 0, key_label: 0 }]],
  ['ui_close_dialog', 475, [{ type: 'key', pressed: false, keycode: 4194305, physical_keycode: 0, key_label: 0 }]],
  ['ui_close_dialog.macos', 480, [{ type: 'key', pressed: false, keycode: 87, physical_keycode: 0, key_label: 0, meta_pressed: true }, { type: 'key', pressed: false, keycode: 4194305, physical_keycode: 0, key_label: 0 }]],
  ['ui_focus_next', 484, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0 }]],
  ['ui_focus_prev', 488, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_left', 494, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0 }, { type: 'joypad_button', pressed: false, button_index: 13, device: -1 }, { type: 'joypad_motion', axis: 0, axis_value: -1, device: -1 }]],
  ['ui_right', 500, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0 }, { type: 'joypad_button', pressed: false, button_index: 14, device: -1 }, { type: 'joypad_motion', axis: 0, axis_value: 1, device: -1 }]],
  ['ui_up', 506, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0 }, { type: 'joypad_button', pressed: false, button_index: 11, device: -1 }, { type: 'joypad_motion', axis: 1, axis_value: -1, device: -1 }]],
  ['ui_down', 512, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0 }, { type: 'joypad_button', pressed: false, button_index: 12, device: -1 }, { type: 'joypad_motion', axis: 1, axis_value: 1, device: -1 }]],
  ['ui_page_up', 516, [{ type: 'key', pressed: false, keycode: 4194323, physical_keycode: 0, key_label: 0 }]],
  ['ui_page_down', 520, [{ type: 'key', pressed: false, keycode: 4194324, physical_keycode: 0, key_label: 0 }]],
  ['ui_home', 524, [{ type: 'key', pressed: false, keycode: 4194317, physical_keycode: 0, key_label: 0 }]],
  ['ui_end', 528, [{ type: 'key', pressed: false, keycode: 4194318, physical_keycode: 0, key_label: 0 }]],
  ['ui_accessibility_drag_and_drop', 531, []],
  ['ui_cut', 538, [{ type: 'key', pressed: false, keycode: 88, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_copy', 543, [{ type: 'key', pressed: false, keycode: 67, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194311, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_focus_mode', 547, [{ type: 'key', pressed: false, keycode: 77, physical_keycode: 0, key_label: 0, ctrl_pressed: true }]],
  ['ui_paste', 552, [{ type: 'key', pressed: false, keycode: 86, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194311, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_undo', 556, [{ type: 'key', pressed: false, keycode: 90, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_redo', 561, [{ type: 'key', pressed: false, keycode: 90, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true, shift_pressed: true }, { type: 'key', pressed: false, keycode: 89, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_completion_query', 566, [{ type: 'key', pressed: false, keycode: 32, physical_keycode: 0, key_label: 0, ctrl_pressed: true }]],
  ['ui_text_completion_accept', 572, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_completion_replace', 578, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0, shift_pressed: true }, { type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0, shift_pressed: true }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_text_newline', 586, [{ type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0, shift_pressed: true }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_text_newline_blank', 591, [{ type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_newline_above', 596, [{ type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }]],
  ['ui_text_indent', 601, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_dedent', 605, [{ type: 'key', pressed: false, keycode: 4194306, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_text_backspace', 611, [{ type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0, shift_pressed: true }]],
  ['ui_text_backspace_word', 615, [{ type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_backspace_word.macos', 619, [{ type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_text_backspace_all_to_left', 622, []],
  ['ui_text_backspace_all_to_left.macos', 626, [{ type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_delete', 630, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_delete_word', 634, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_delete_word.macos', 638, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_text_delete_all_to_right', 641, []],
  ['ui_text_delete_all_to_right.macos', 645, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_left', 651, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_word_left', 655, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_word_left.macos', 659, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_text_caret_right', 663, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_word_right', 667, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_word_right.macos', 671, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_text_caret_up', 677, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_down', 681, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_line_start', 687, [{ type: 'key', pressed: false, keycode: 4194317, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_line_start.macos', 693, [{ type: 'key', pressed: false, keycode: 65, physical_keycode: 0, key_label: 0, ctrl_pressed: true }, { type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194317, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_line_end', 697, [{ type: 'key', pressed: false, keycode: 4194318, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_line_end.macos', 703, [{ type: 'key', pressed: false, keycode: 69, physical_keycode: 0, key_label: 0, ctrl_pressed: true }, { type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194318, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_page_up', 709, [{ type: 'key', pressed: false, keycode: 4194323, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_page_down', 713, [{ type: 'key', pressed: false, keycode: 4194324, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_caret_document_start', 719, [{ type: 'key', pressed: false, keycode: 4194317, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_document_start.macos', 724, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194317, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_document_end', 728, [{ type: 'key', pressed: false, keycode: 4194318, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_document_end.macos', 733, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 4194318, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_caret_add_below', 739, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }]],
  ['ui_text_caret_add_below.macos', 743, [{ type: 'key', pressed: false, keycode: 76, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }]],
  ['ui_text_caret_add_above', 747, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }]],
  ['ui_text_caret_add_above.macos', 751, [{ type: 'key', pressed: false, keycode: 79, physical_keycode: 0, key_label: 0, shift_pressed: true, command_or_control_autoremap: true }]],
  ['ui_text_scroll_up', 757, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_scroll_up.macos', 761, [{ type: 'key', pressed: false, keycode: 4194320, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true, alt_pressed: true }]],
  ['ui_text_scroll_down', 765, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_scroll_down.macos', 769, [{ type: 'key', pressed: false, keycode: 4194322, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true, alt_pressed: true }]],
  ['ui_text_select_all', 775, [{ type: 'key', pressed: false, keycode: 65, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_select_word_under_caret', 779, [{ type: 'key', pressed: false, keycode: 71, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_text_select_word_under_caret.macos', 783, [{ type: 'key', pressed: false, keycode: 71, physical_keycode: 0, key_label: 0, ctrl_pressed: true, meta_pressed: true }]],
  ['ui_text_add_selection_for_next_occurrence', 787, [{ type: 'key', pressed: false, keycode: 68, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_text_skip_selection_for_next_occurrence', 791, [{ type: 'key', pressed: false, keycode: 68, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true, alt_pressed: true }]],
  ['ui_text_clear_carets_and_selection', 795, [{ type: 'key', pressed: false, keycode: 4194305, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_toggle_insert_mode', 799, [{ type: 'key', pressed: false, keycode: 4194311, physical_keycode: 0, key_label: 0 }]],
  ['ui_menu', 803, [{ type: 'key', pressed: false, keycode: 4194370, physical_keycode: 0, key_label: 0 }]],
  ['ui_text_submit', 808, [{ type: 'key', pressed: false, keycode: 4194309, physical_keycode: 0, key_label: 0 }, { type: 'key', pressed: false, keycode: 4194310, physical_keycode: 0, key_label: 0 }]],
  ['ui_unicode_start', 812, [{ type: 'key', pressed: false, keycode: 85, physical_keycode: 0, key_label: 0, ctrl_pressed: true, shift_pressed: true }]],
  ['ui_graph_duplicate', 818, [{ type: 'key', pressed: false, keycode: 68, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_graph_delete', 822, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0 }]],
  ['ui_graph_follow_left', 826, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_graph_follow_left.macos', 830, [{ type: 'key', pressed: false, keycode: 4194319, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_graph_follow_right', 834, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_graph_follow_right.macos', 838, [{ type: 'key', pressed: false, keycode: 4194321, physical_keycode: 0, key_label: 0, alt_pressed: true }]],
  ['ui_filedialog_delete', 843, [{ type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0 }]],
  ['ui_filedialog_up_one_level', 847, [{ type: 'key', pressed: false, keycode: 4194308, physical_keycode: 0, key_label: 0 }]],
  ['ui_filedialog_refresh', 851, [{ type: 'key', pressed: false, keycode: 4194336, physical_keycode: 0, key_label: 0 }]],
  ['ui_filedialog_show_hidden', 855, [{ type: 'key', pressed: false, keycode: 72, physical_keycode: 0, key_label: 0 }]],
  ['ui_filedialog_find', 859, [{ type: 'key', pressed: false, keycode: 70, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_filedialog_focus_path', 865, [{ type: 'key', pressed: false, keycode: 76, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_filedialog_focus_path.macos', 871, [{ type: 'key', pressed: false, keycode: 71, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }, { type: 'key', pressed: false, keycode: 76, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_swap_input_direction', 875, [{ type: 'key', pressed: false, keycode: 96, physical_keycode: 0, key_label: 0, command_or_control_autoremap: true }]],
  ['ui_colorpicker_delete_preset', 881, [{ type: 'joypad_button', pressed: false, button_index: 2, device: -1 }, { type: 'key', pressed: false, keycode: 4194312, physical_keycode: 0, key_label: 0 }]],
];

/** `DEFAULT_TOGGLE_DEADZONE` (`core/input/input_map.h:57`) and `DEFAULT_DEADZONE` (`:55`). */
const BUILTIN_DEADZONE = 0.5;
const DEFAULT_DEADZONE = 0.2;

/** Fields each event class carries into its record (`core/input/input_event.cpp`). */
const MODIFIERS = ['shift_pressed', 'alt_pressed', 'ctrl_pressed', 'meta_pressed', 'command_or_control_autoremap'] as const;
const EVENT_FIELDS: Readonly<Record<string, { readonly type: string; readonly fields: readonly string[] }>> = {
  InputEventKey: { type: 'key', fields: ['device', 'pressed', 'keycode', 'physical_keycode', 'key_label', 'location', 'echo', ...MODIFIERS] },
  InputEventMouseButton: { type: 'mouse_button', fields: ['device', 'pressed', 'button_index', 'canceled', ...MODIFIERS] },
  InputEventJoypadButton: { type: 'joypad_button', fields: ['device', 'pressed', 'button_index'] },
  InputEventJoypadMotion: { type: 'joypad_motion', fields: ['device', 'axis', 'axis_value'] },
};

/** A `project.godot` event as its record, or why it is not translated. */
function projectEvent(eventClass: string, fields: Readonly<Record<string, number | boolean>>): TargetInputEventRecord | string {
  const shape = EVENT_FIELDS[eventClass];
  if (shape === undefined) return `${eventClass} is not an input event class this lane translates`;
  const record: Record<string, number | boolean | string | readonly [number, number]> = { type: shape.type };
  for (const field of shape.fields) {
    const value = fields[field];
    if (value !== undefined) record[field] = value;
  }
  for (const [field, fallback] of [['pressed', false], ['keycode', 0], ['physical_keycode', 0], ['key_label', 0]] as const) {
    if (shape.type === 'key' && record[field] === undefined) record[field] = fallback;
  }
  if (shape.type === 'mouse_button') {
    record['pressed'] ??= false;
    record['button_index'] ??= 0;
    record['position'] = [0, 0];
  }
  if (shape.type === 'joypad_button') {
    record['pressed'] ??= false;
    record['button_index'] ??= 0;
  }
  return record;
}

/** The project's InputMap: the built-ins, then the project's actions replacing or following them. */
export function planDirectGodotInputMap(
  actions: readonly InputAction[],
  refuse: (at: string, message: string) => void,
  used: ReadonlySet<string> | 'all' = 'all',
): readonly DirectGodotInputActionPlan[] {
  const planned = new Map<string, DirectGodotInputActionPlan>();
  // The built-ins the project uses (by name in its scripts, or all when it reads an action by a
  // computed name or has GUI nodes that navigate with them), then the project's own over them.
  for (const [name, , events] of BUILTINS) {
    if (used === 'all' || used.has(name)) planned.set(name, { name, deadzone: BUILTIN_DEADZONE, events });
  }
  for (const action of actions) {
    const at = `project.godot#[input].${action.name}`;
    if (action.events.length !== action.eventCount) {
      refuse(at, 'an event is not an `Object(InputEvent…)` value');
      continue;
    }
    const events: TargetInputEventRecord[] = [];
    for (const event of action.events) {
      const record = projectEvent(event.eventClass, event.fields);
      if (typeof record === 'string') refuse(at, record);
      else events.push(record);
    }
    planned.set(action.name, { name: action.name, deadzone: action.deadzone ?? DEFAULT_DEADZONE, events });
  }
  return [...planned.values()];
}
