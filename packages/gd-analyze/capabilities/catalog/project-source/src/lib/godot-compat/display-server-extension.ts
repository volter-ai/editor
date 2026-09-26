import { registerGodotObjectIdentity } from './object';

export interface GodotDisplayVector2 { readonly x: number; readonly y: number }
export interface GodotDisplayRect2 { readonly position: GodotDisplayVector2; readonly size: GodotDisplayVector2 }
export interface GodotDisplayColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
export type GodotDisplayWindowId = number;
export type GodotDisplayServerExtensionHooks = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

export class GodotDisplayServerExtension {
  constructor(private readonly hooks: GodotDisplayServerExtensionHooks) {
    registerGodotObjectIdentity(this, 'DisplayServerExtension');
  }

  private call(name: string, ...args: readonly unknown[]): unknown {
    const hook = this.hooks[name];
    if (hook === undefined) throw new Error(`${name} is not implemented by this display server extension.`);
    return hook(...args);
  }

  private number(name: string, ...args: readonly unknown[]): number {
    const value = this.call(name, ...args);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must return a finite number.`);
    return value;
  }

  private string(name: string, ...args: readonly unknown[]): string {
    const value = this.call(name, ...args);
    if (typeof value !== 'string') throw new TypeError(`${name} must return a string.`);
    return value;
  }

  private boolean(name: string, ...args: readonly unknown[]): boolean {
    return Boolean(this.call(name, ...args));
  }

  private array<T>(name: string, ...args: readonly unknown[]): T[] {
    const value = this.call(name, ...args);
    if (!Array.isArray(value)) throw new TypeError(`${name} must return an Array.`);
    return value as T[];
  }

  _has_feature(feature: number): boolean { return this.boolean('_has_feature', feature); }
  _get_name(): string { return this.string('_get_name'); }
  _help_set_search_callbacks(searchCallback: unknown, actionCallback: unknown): void { this.call('_help_set_search_callbacks', searchCallback, actionCallback); }
  _global_menu_add_submenu_item(menuRoot: string, label: string, submenu: string, index = -1): number { return this.number('_global_menu_add_submenu_item', menuRoot, label, submenu, index); }
  _global_menu_add_item(menuRoot: string, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_item', menuRoot, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_check_item(menuRoot: string, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_check_item', menuRoot, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_icon_item(menuRoot: string, icon: unknown, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_icon_item', menuRoot, icon, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_icon_check_item(menuRoot: string, icon: unknown, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_icon_check_item', menuRoot, icon, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_radio_check_item(menuRoot: string, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_radio_check_item', menuRoot, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_icon_radio_check_item(menuRoot: string, icon: unknown, label: string, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_icon_radio_check_item', menuRoot, icon, label, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_multistate_item(menuRoot: string, label: string, maxStates: number, defaultState: number, callback: unknown, keyCallback: unknown = null, tag: unknown = null, accelerator = 0, index = -1): number { return this.number('_global_menu_add_multistate_item', menuRoot, label, maxStates, defaultState, callback, keyCallback, tag, accelerator, index); }
  _global_menu_add_separator(menuRoot: string, index = -1): void { this.call('_global_menu_add_separator', menuRoot, index); }
  _global_menu_get_item_index_from_text(menuRoot: string, text: string): number { return this.number('_global_menu_get_item_index_from_text', menuRoot, text); }
  _global_menu_get_item_index_from_tag(menuRoot: string, tag: unknown): number { return this.number('_global_menu_get_item_index_from_tag', menuRoot, tag); }
  _global_menu_is_item_checked(menuRoot: string, index: number): boolean { return this.boolean('_global_menu_is_item_checked', menuRoot, index); }
  _global_menu_is_item_checkable(menuRoot: string, index: number): boolean { return this.boolean('_global_menu_is_item_checkable', menuRoot, index); }
  _global_menu_is_item_radio_checkable(menuRoot: string, index: number): boolean { return this.boolean('_global_menu_is_item_radio_checkable', menuRoot, index); }
  _global_menu_get_item_callback(menuRoot: string, index: number): unknown { return this.call('_global_menu_get_item_callback', menuRoot, index); }
  _global_menu_get_item_key_callback(menuRoot: string, index: number): unknown { return this.call('_global_menu_get_item_key_callback', menuRoot, index); }
  _global_menu_get_item_tag(menuRoot: string, index: number): unknown { return this.call('_global_menu_get_item_tag', menuRoot, index); }
  _global_menu_get_item_text(menuRoot: string, index: number): string { return this.string('_global_menu_get_item_text', menuRoot, index); }
  _global_menu_get_item_submenu(menuRoot: string, index: number): string { return this.string('_global_menu_get_item_submenu', menuRoot, index); }
  _global_menu_get_item_accelerator(menuRoot: string, index: number): number { return this.number('_global_menu_get_item_accelerator', menuRoot, index); }
  _global_menu_is_item_disabled(menuRoot: string, index: number): boolean { return this.boolean('_global_menu_is_item_disabled', menuRoot, index); }
  _global_menu_is_item_hidden(menuRoot: string, index: number): boolean { return this.boolean('_global_menu_is_item_hidden', menuRoot, index); }
  _global_menu_get_item_tooltip(menuRoot: string, index: number): string { return this.string('_global_menu_get_item_tooltip', menuRoot, index); }
  _global_menu_get_item_state(menuRoot: string, index: number): number { return this.number('_global_menu_get_item_state', menuRoot, index); }
  _global_menu_get_item_max_states(menuRoot: string, index: number): number { return this.number('_global_menu_get_item_max_states', menuRoot, index); }
  _global_menu_get_item_icon(menuRoot: string, index: number): unknown { return this.call('_global_menu_get_item_icon', menuRoot, index); }
  _global_menu_get_item_indentation_level(menuRoot: string, index: number): number { return this.number('_global_menu_get_item_indentation_level', menuRoot, index); }
  _global_menu_set_item_checked(menuRoot: string, index: number, checked: boolean): void { this.call('_global_menu_set_item_checked', menuRoot, index, checked); }
  _global_menu_set_item_checkable(menuRoot: string, index: number, checkable: boolean): void { this.call('_global_menu_set_item_checkable', menuRoot, index, checkable); }
  _global_menu_set_item_radio_checkable(menuRoot: string, index: number, checkable: boolean): void { this.call('_global_menu_set_item_radio_checkable', menuRoot, index, checkable); }
  _global_menu_set_item_callback(menuRoot: string, index: number, callback: unknown): void { this.call('_global_menu_set_item_callback', menuRoot, index, callback); }
  _global_menu_set_item_key_callback(menuRoot: string, index: number, callback: unknown): void { this.call('_global_menu_set_item_key_callback', menuRoot, index, callback); }
  _global_menu_set_item_tag(menuRoot: string, index: number, tag: unknown): void { this.call('_global_menu_set_item_tag', menuRoot, index, tag); }
  _global_menu_set_item_text(menuRoot: string, index: number, text: string): void { this.call('_global_menu_set_item_text', menuRoot, index, text); }
  _global_menu_set_item_submenu(menuRoot: string, index: number, submenu: string): void { this.call('_global_menu_set_item_submenu', menuRoot, index, submenu); }
  _global_menu_set_item_accelerator(menuRoot: string, index: number, keycode: number): void { this.call('_global_menu_set_item_accelerator', menuRoot, index, keycode); }
  _global_menu_set_item_disabled(menuRoot: string, index: number, disabled: boolean): void { this.call('_global_menu_set_item_disabled', menuRoot, index, disabled); }
  _global_menu_set_item_hidden(menuRoot: string, index: number, hidden: boolean): void { this.call('_global_menu_set_item_hidden', menuRoot, index, hidden); }
  _global_menu_set_item_tooltip(menuRoot: string, index: number, tooltip: string): void { this.call('_global_menu_set_item_tooltip', menuRoot, index, tooltip); }
  _global_menu_set_item_state(menuRoot: string, index: number, state: number): void { this.call('_global_menu_set_item_state', menuRoot, index, state); }
  _global_menu_set_item_max_states(menuRoot: string, index: number, maxStates: number): void { this.call('_global_menu_set_item_max_states', menuRoot, index, maxStates); }
  _global_menu_set_item_icon(menuRoot: string, index: number, icon: unknown): void { this.call('_global_menu_set_item_icon', menuRoot, index, icon); }
  _global_menu_set_item_indentation_level(menuRoot: string, index: number, level: number): void { this.call('_global_menu_set_item_indentation_level', menuRoot, index, level); }
  _global_menu_get_item_count(menuRoot: string): number { return this.number('_global_menu_get_item_count', menuRoot); }
  _global_menu_remove_item(menuRoot: string, index: number): void { this.call('_global_menu_remove_item', menuRoot, index); }
  _global_menu_clear(menuRoot: string): void { this.call('_global_menu_clear', menuRoot); }

  _tts_is_speaking(): boolean { return this.boolean('_tts_is_speaking'); }
  _tts_is_paused(): boolean { return this.boolean('_tts_is_paused'); }
  _tts_get_voices(): unknown[] { return this.array('_tts_get_voices'); }
  _tts_get_voices_for_language(language: string): string[] { return this.array('_tts_get_voices_for_language', language); }
  _tts_speak(text: string, voice: string, volume: number, pitch: number, rate: number, utteranceId: number, interrupt: boolean): void { this.call('_tts_speak', text, voice, volume, pitch, rate, utteranceId, interrupt); }
  _tts_pause(): void { this.call('_tts_pause'); }
  _tts_resume(): void { this.call('_tts_resume'); }
  _tts_stop(): void { this.call('_tts_stop'); }

  _mouse_set_mode(mode: number): void { this.call('_mouse_set_mode', mode); }
  _mouse_get_mode(): number { return this.number('_mouse_get_mode'); }
  _mouse_get_position(): GodotDisplayVector2 { return this.call('_mouse_get_position') as GodotDisplayVector2; }
  _mouse_get_button_state(): number { return this.number('_mouse_get_button_state'); }
  _clipboard_set(text: string): void { this.call('_clipboard_set', text); }
  _clipboard_get(): string { return this.string('_clipboard_get'); }
  _clipboard_get_image(): unknown { return this.call('_clipboard_get_image'); }
  _clipboard_has(): boolean { return this.boolean('_clipboard_has'); }
  _clipboard_has_image(): boolean { return this.boolean('_clipboard_has_image'); }
  _primary_clipboard_set(text: string): void { this.call('_primary_clipboard_set', text); }
  _primary_clipboard_get(): string { return this.string('_primary_clipboard_get'); }

  _get_display_cutouts(): GodotDisplayRect2[] { return this.array('_get_display_cutouts'); }
  _get_display_safe_area(): GodotDisplayRect2 { return this.call('_get_display_safe_area') as GodotDisplayRect2; }
  _get_screen_count(): number { return this.number('_get_screen_count'); }
  _get_primary_screen(): number { return this.number('_get_primary_screen'); }
  _get_keyboard_focus_screen(): number { return this.number('_get_keyboard_focus_screen'); }
  _get_screen_from_rect(rect: GodotDisplayRect2): number { return this.number('_get_screen_from_rect', rect); }
  _screen_get_position(screen = -1): GodotDisplayVector2 { return this.call('_screen_get_position', screen) as GodotDisplayVector2; }
  _screen_get_size(screen = -1): GodotDisplayVector2 { return this.call('_screen_get_size', screen) as GodotDisplayVector2; }
  _screen_get_usable_rect(screen = -1): GodotDisplayRect2 { return this.call('_screen_get_usable_rect', screen) as GodotDisplayRect2; }
  _screen_get_dpi(screen = -1): number { return this.number('_screen_get_dpi', screen); }
  _screen_get_scale(screen = -1): number { return this.number('_screen_get_scale', screen); }
  _screen_get_max_scale(): number { return this.number('_screen_get_max_scale'); }
  _screen_get_refresh_rate(screen = -1): number { return this.number('_screen_get_refresh_rate', screen); }
  _screen_get_pixel(screen: number, position: GodotDisplayVector2): GodotDisplayColor { return this.call('_screen_get_pixel', screen, position) as GodotDisplayColor; }
  _screen_get_image(screen = -1): unknown { return this.call('_screen_get_image', screen); }

  _screen_set_orientation(orientation: number, screen = -1): void { this.call('_screen_set_orientation', orientation, screen); }
  _screen_get_orientation(screen = -1): number { return this.number('_screen_get_orientation', screen); }
  _screen_set_keep_on(enable: boolean): void { this.call('_screen_set_keep_on', enable); }
  _screen_is_kept_on(): boolean { return this.boolean('_screen_is_kept_on'); }
  _screen_set_energy_saving(enable: boolean): void { this.call('_screen_set_energy_saving', enable); }
  _screen_is_energy_saving_enabled(): boolean { return this.boolean('_screen_is_energy_saving_enabled'); }

  _window_create(mode: number, vsyncMode: number, flags: number, rect: GodotDisplayRect2, exclusive: boolean): GodotDisplayWindowId { return this.number('_window_create', mode, vsyncMode, flags, rect, exclusive); }
  _window_get_native_handle(handleType: number, windowId = 0): number { return this.number('_window_get_native_handle', handleType, windowId); }
  _window_attach_instance_id(instanceId: number, windowId = 0): void { this.call('_window_attach_instance_id', instanceId, windowId); }
  _window_get_attached_instance_id(windowId = 0): number { return this.number('_window_get_attached_instance_id', windowId); }
  _window_set_rect_changed_callback(callback: unknown, windowId = 0): void { this.call('_window_set_rect_changed_callback', callback, windowId); }
  _window_set_window_event_callback(callback: unknown, windowId = 0): void { this.call('_window_set_window_event_callback', callback, windowId); }
  _window_set_input_event_callback(callback: unknown, windowId = 0): void { this.call('_window_set_input_event_callback', callback, windowId); }
  _window_set_input_text_callback(callback: unknown, windowId = 0): void { this.call('_window_set_input_text_callback', callback, windowId); }
  _window_set_drop_files_callback(callback: unknown, windowId = 0): void { this.call('_window_set_drop_files_callback', callback, windowId); }
  _window_set_title_outline_size(size: number, windowId = 0): void { this.call('_window_set_title_outline_size', size, windowId); }
  _window_set_title_outline_modulate(color: GodotDisplayColor, windowId = 0): void { this.call('_window_set_title_outline_modulate', color, windowId); }
  _window_set_title_font(font: unknown, windowId = 0): void { this.call('_window_set_title_font', font, windowId); }
  _window_set_title_font_size(size: number, windowId = 0): void { this.call('_window_set_title_font_size', size, windowId); }
  _window_set_title_color(color: GodotDisplayColor, windowId = 0): void { this.call('_window_set_title_color', color, windowId); }
  _window_set_titlebar_background(color: GodotDisplayColor, windowId = 0): void { this.call('_window_set_titlebar_background', color, windowId); }
  _window_set_titlebar_foreground(color: GodotDisplayColor, windowId = 0): void { this.call('_window_set_titlebar_foreground', color, windowId); }
  _window_get_position(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_position', windowId) as GodotDisplayVector2; }
  _window_get_position_with_decorations(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_position_with_decorations', windowId) as GodotDisplayVector2; }
  _window_set_position(position: GodotDisplayVector2, windowId = 0): void { this.call('_window_set_position', position, windowId); }
  _window_get_size(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_size', windowId) as GodotDisplayVector2; }
  _window_set_size(size: GodotDisplayVector2, windowId = 0): void { this.call('_window_set_size', size, windowId); }
  _window_set_rect(rect: GodotDisplayRect2, windowId = 0): void { this.call('_window_set_rect', rect, windowId); }
  _window_get_size_with_decorations(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_size_with_decorations', windowId) as GodotDisplayVector2; }
  _window_set_mode(mode: number, windowId = 0): void { this.call('_window_set_mode', mode, windowId); }
  _window_get_mode(windowId = 0): number { return this.number('_window_get_mode', windowId); }
  _window_set_flag(flag: number, enabled: boolean, windowId = 0): void { this.call('_window_set_flag', flag, enabled, windowId); }
  _window_get_flag(flag: number, windowId = 0): boolean { return this.boolean('_window_get_flag', flag, windowId); }
  _window_set_window_buttons_offset(offset: GodotDisplayVector2, windowId = 0): void { this.call('_window_set_window_buttons_offset', offset, windowId); }
  _window_get_title_size(title: string, windowId = 0): GodotDisplayVector2 { return this.call('_window_get_title_size', title, windowId) as GodotDisplayVector2; }
  _window_get_safe_title_margins(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_safe_title_margins', windowId) as GodotDisplayVector2; }
  _window_request_attention(windowId = 0): void { this.call('_window_request_attention', windowId); }
  _window_move_to_foreground(windowId = 0): void { this.call('_window_move_to_foreground', windowId); }
  _window_is_focused(windowId = 0): boolean { return this.boolean('_window_is_focused', windowId); }
  _window_can_draw(windowId = 0): boolean { return this.boolean('_window_can_draw', windowId); }
  _can_any_window_draw(): boolean { return this.boolean('_can_any_window_draw'); }
  _window_set_transient(windowId: number, parentWindowId: number): void { this.call('_window_set_transient', windowId, parentWindowId); }
  _window_set_exclusive(windowId: number, exclusive: boolean): void { this.call('_window_set_exclusive', windowId, exclusive); }
  _window_set_popup_safe_rect(windowId: number, rect: GodotDisplayRect2): void { this.call('_window_set_popup_safe_rect', windowId, rect); }
  _window_get_popup_safe_rect(windowId: number): GodotDisplayRect2 { return this.call('_window_get_popup_safe_rect', windowId) as GodotDisplayRect2; }
  _window_set_popup_exclude_parent(windowId: number, exclude: boolean): void { this.call('_window_set_popup_exclude_parent', windowId, exclude); }
  _window_get_active_popup(): GodotDisplayWindowId { return this.number('_window_get_active_popup'); }
  _window_set_popup_safe_rect_callback(callback: unknown, windowId = 0): void { this.call('_window_set_popup_safe_rect_callback', callback, windowId); }
  _window_set_mouse_passthrough(region: readonly GodotDisplayVector2[], windowId = 0): void { this.call('_window_set_mouse_passthrough', region, windowId); }
  _window_set_caret_position(position: GodotDisplayVector2, windowId = 0): void { this.call('_window_set_caret_position', position, windowId); }
  _window_get_vsync_mode(windowId = 0): number { return this.number('_window_get_vsync_mode', windowId); }
  _window_set_vsync_mode(mode: number, windowId = 0): void { this.call('_window_set_vsync_mode', mode, windowId); }
  _window_is_maximize_allowed(windowId = 0): boolean { return this.boolean('_window_is_maximize_allowed', windowId); }
  _window_maximize_on_title_dbl_click(): boolean { return this.boolean('_window_maximize_on_title_dbl_click'); }
  _window_minimize_on_title_dbl_click(): boolean { return this.boolean('_window_minimize_on_title_dbl_click'); }
  _window_set_title(title: string, windowId = 0): void { this.call('_window_set_title', title, windowId); }
  _window_set_mouse_passthrough_polygon(polygon: readonly GodotDisplayVector2[], windowId = 0): void { this.call('_window_set_mouse_passthrough_polygon', polygon, windowId); }
  _window_set_current_screen(screen: number, windowId = 0): void { this.call('_window_set_current_screen', screen, windowId); }
  _window_get_current_screen(windowId = 0): number { return this.number('_window_get_current_screen', windowId); }
  _window_set_ime_active(active: boolean, windowId = 0): void { this.call('_window_set_ime_active', active, windowId); }
  _window_set_ime_position(position: GodotDisplayVector2, windowId = 0): void { this.call('_window_set_ime_position', position, windowId); }
  _window_get_ime_selection(windowId = 0): GodotDisplayVector2 { return this.call('_window_get_ime_selection', windowId) as GodotDisplayVector2; }
  _window_get_ime_text(windowId = 0): string { return this.string('_window_get_ime_text', windowId); }
  _window_start_drag(windowId = 0): void { this.call('_window_start_drag', windowId); }
  _window_start_resize(edge: number, windowId = 0): void { this.call('_window_start_resize', edge, windowId); }
  _window_set_embedded(windowId: number, embedded: boolean): void { this.call('_window_set_embedded', windowId, embedded); }
  _window_set_ignore_mouse_events(ignore: boolean, windowId = 0): void { this.call('_window_set_ignore_mouse_events', ignore, windowId); }
  _window_get_ids(): GodotDisplayWindowId[] { return this.array('_window_get_ids'); }

  _virtual_keyboard_show(existingText: string, position: GodotDisplayRect2, type: number, maxLength: number, cursorStart: number, cursorEnd: number): void { this.call('_virtual_keyboard_show', existingText, position, type, maxLength, cursorStart, cursorEnd); }
  _virtual_keyboard_hide(): void { this.call('_virtual_keyboard_hide'); }
  _virtual_keyboard_get_height(): number { return this.number('_virtual_keyboard_get_height'); }
  _cursor_set_shape(shape: number): void { this.call('_cursor_set_shape', shape); }
  _cursor_get_shape(): number { return this.number('_cursor_get_shape'); }
  _cursor_set_custom_image(image: unknown, shape: number, hotspot: GodotDisplayVector2): void { this.call('_cursor_set_custom_image', image, shape, hotspot); }
  _get_swap_cancel_ok(): boolean { return this.boolean('_get_swap_cancel_ok'); }
  _enable_for_stealing_focus(processId: number): void { this.call('_enable_for_stealing_focus', processId); }
  _dialog_show(title: string, description: string, buttons: readonly string[], callback: unknown): number { return this.number('_dialog_show', title, description, buttons, callback); }
  _dialog_input_text(title: string, description: string, partial: string, callback: unknown): number { return this.number('_dialog_input_text', title, description, partial, callback); }
  _file_dialog_show(title: string, currentDirectory: string, filename: string, showHidden: boolean, mode: number, filters: readonly string[], callback: unknown, windowId = 0): number { return this.number('_file_dialog_show', title, currentDirectory, filename, showHidden, mode, filters, callback, windowId); }
  _file_dialog_with_options_show(title: string, currentDirectory: string, root: string, filename: string, showHidden: boolean, mode: number, filters: readonly string[], options: readonly unknown[], callback: unknown, windowId = 0): number { return this.number('_file_dialog_with_options_show', title, currentDirectory, root, filename, showHidden, mode, filters, options, callback, windowId); }
  _status_indicator_create(icon: unknown, tooltip: string, callback: unknown): number { return this.number('_status_indicator_create', icon, tooltip, callback); }
  _status_indicator_set_icon(id: number, icon: unknown): void { this.call('_status_indicator_set_icon', id, icon); }
  _status_indicator_set_tooltip(id: number, tooltip: string): void { this.call('_status_indicator_set_tooltip', id, tooltip); }
  _status_indicator_set_menu(id: number, menu: unknown): void { this.call('_status_indicator_set_menu', id, menu); }
  _status_indicator_set_callback(id: number, callback: unknown): void { this.call('_status_indicator_set_callback', id, callback); }
  _status_indicator_delete(id: number): void { this.call('_status_indicator_delete', id); }
  _keyboard_get_layout_count(): number { return this.number('_keyboard_get_layout_count'); }
  _keyboard_get_current_layout(): number { return this.number('_keyboard_get_current_layout'); }
  _keyboard_set_current_layout(index: number): void { this.call('_keyboard_set_current_layout', index); }
  _keyboard_get_layout_language(index: number): string { return this.string('_keyboard_get_layout_language', index); }
  _keyboard_get_layout_name(index: number): string { return this.string('_keyboard_get_layout_name', index); }
  _keyboard_get_keycode_from_physical(keycode: number): number { return this.number('_keyboard_get_keycode_from_physical', keycode); }
  _process_and_drop_events(): void { this.call('_process_and_drop_events'); }
  _send_window_event(event: number, windowId = 0): void { this.call('_send_window_event', event, windowId); }
  _set_native_icon(filename: string): void { this.call('_set_native_icon', filename); }
  _set_icon(image: unknown): void { this.call('_set_icon', image); }
  _accessibility_should_increase_contrast(): boolean { return this.boolean('_accessibility_should_increase_contrast'); }
  _accessibility_should_reduce_animation(): boolean { return this.boolean('_accessibility_should_reduce_animation'); }
  _accessibility_should_reduce_transparency(): boolean { return this.boolean('_accessibility_should_reduce_transparency'); }
  _accessibility_screen_reader_active(): boolean { return this.boolean('_accessibility_screen_reader_active'); }
  _accessibility_create_element(windowId: number, role: number): number { return this.number('_accessibility_create_element', windowId, role); }
  _accessibility_create_sub_element(parentId: number, role: number): number { return this.number('_accessibility_create_sub_element', parentId, role); }
  _accessibility_free_element(elementId: number): void { this.call('_accessibility_free_element', elementId); }
  _accessibility_element_set_meta(elementId: number, meta: unknown): void { this.call('_accessibility_element_set_meta', elementId, meta); }
  _accessibility_element_get_meta(elementId: number): unknown { return this.call('_accessibility_element_get_meta', elementId); }
  _accessibility_element_set_callback(elementId: number, event: number, callback: unknown): void { this.call('_accessibility_element_set_callback', elementId, event, callback); }
  _accessibility_element_set_focus(elementId: number): void { this.call('_accessibility_element_set_focus', elementId); }
  _accessibility_element_get_focus(windowId = 0): number { return this.number('_accessibility_element_get_focus', windowId); }
  _accessibility_element_set_parent(elementId: number, parentId: number): void { this.call('_accessibility_element_set_parent', elementId, parentId); }
  _accessibility_element_get_parent(elementId: number): number { return this.number('_accessibility_element_get_parent', elementId); }
  _accessibility_element_set_children(elementId: number, children: readonly number[]): void { this.call('_accessibility_element_set_children', elementId, children); }
  _accessibility_element_get_children(elementId: number): number[] { return this.array('_accessibility_element_get_children', elementId); }
  _accessibility_element_set_name(elementId: number, name: string): void { this.call('_accessibility_element_set_name', elementId, name); }
  _accessibility_element_set_description(elementId: number, description: string): void { this.call('_accessibility_element_set_description', elementId, description); }
  _accessibility_element_set_value(elementId: number, value: string): void { this.call('_accessibility_element_set_value', elementId, value); }
  _accessibility_element_set_bounds(elementId: number, bounds: GodotDisplayRect2): void { this.call('_accessibility_element_set_bounds', elementId, bounds); }
  _accessibility_element_set_role(elementId: number, role: number): void { this.call('_accessibility_element_set_role', elementId, role); }
  _accessibility_element_set_state(elementId: number, state: number, enabled: boolean): void { this.call('_accessibility_element_set_state', elementId, state, enabled); }
  _accessibility_element_set_number_value(elementId: number, value: number): void { this.call('_accessibility_element_set_number_value', elementId, value); }
  _accessibility_element_set_number_range(elementId: number, minimum: number, maximum: number, step: number): void { this.call('_accessibility_element_set_number_range', elementId, minimum, maximum, step); }
  _accessibility_element_set_placeholder(elementId: number, placeholder: string): void { this.call('_accessibility_element_set_placeholder', elementId, placeholder); }
  _accessibility_element_set_language(elementId: number, language: string): void { this.call('_accessibility_element_set_language', elementId, language); }
  _accessibility_hit_test(windowId: number, position: GodotDisplayVector2): number { return this.number('_accessibility_hit_test', windowId, position); }
  _accessibility_update_if_active(): void { this.call('_accessibility_update_if_active'); }
  _beep(): void { this.call('_beep'); }
  _process_events(): void { this.call('_process_events'); }
  _force_process_and_drop_events(): void { this.call('_force_process_and_drop_events'); }
  _release_rendering_thread(): void { this.call('_release_rendering_thread'); }
  _swap_buffers(): void { this.call('_swap_buffers'); }
}

export function createGodotDisplayServerExtension(hooks: GodotDisplayServerExtensionHooks): GodotDisplayServerExtension {
  return new GodotDisplayServerExtension(hooks);
}
