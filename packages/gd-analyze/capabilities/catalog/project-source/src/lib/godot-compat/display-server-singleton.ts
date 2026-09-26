/** Native DisplayServer singleton facade over browser-owned display and window APIs. */

import * as display from './display-server';
import type { GodotInput } from './input';

export interface GodotDisplayServer {
  has_feature(feature: unknown): boolean;
  is_dark_mode_supported(): boolean;
  is_dark_mode(): boolean;
  get_accent_color(): ReturnType<typeof display.godotDisplayServerGetAccentColor>;
  get_base_color(): ReturnType<typeof display.godotDisplayServerGetBaseColor>;
  get_display_cutouts(): never;
  get_display_safe_area(): ReturnType<typeof display.godotDisplayServerGetDisplaySafeArea>;
  keyboard_get_keycode_from_physical(keycode: unknown): number;
  screen_get_refresh_rate(screen?: number): number;
  screen_set_orientation(orientation: unknown, screen?: number): void;
  screen_get_orientation(screen?: number): number;
  screen_set_keep_on(enabled: unknown): void;
  screen_is_kept_on(): boolean;
  virtual_keyboard_show(
    existingText: unknown,
    position?: unknown,
    type?: number,
    maxLength?: number,
    cursorStart?: number,
    cursorEnd?: number,
  ): void;
  virtual_keyboard_hide(): void;
  mouse_set_mode(mode: unknown): void;
  mouse_get_mode(): number;
  mouse_get_position(): ReturnType<typeof display.godotDisplayServerMouseGetPosition>;
  mouse_get_button_state(): number;
  get_window_at_screen_position(position: unknown): number;
  window_set_icon(image: Parameters<typeof display.godotDisplayServerWindowSetIcon>[0], window?: number): void;
  window_move_to_foreground(window?: number): void;
  window_set_position(position: unknown, window?: number): void;
  window_set_size(size: unknown, window?: number): void;
}

function requireInput(input: GodotInput | undefined, member: string): GodotInput {
  if (input === undefined) {
    throw new Error(`DisplayServer.${member} requires the mounted Godot Input singleton.`);
  }
  return input;
}

export function createGodotDisplayServer(input?: GodotInput): GodotDisplayServer {
  return {
    has_feature: display.godotDisplayServerHasFeature,
    is_dark_mode_supported: display.godotDisplayServerIsDarkModeSupported,
    is_dark_mode: display.godotDisplayServerIsDarkMode,
    get_accent_color: display.godotDisplayServerGetAccentColor,
    get_base_color: display.godotDisplayServerGetBaseColor,
    get_display_cutouts: display.godotDisplayServerGetDisplayCutouts,
    get_display_safe_area: display.godotDisplayServerGetDisplaySafeArea,
    keyboard_get_keycode_from_physical:
      display.godotDisplayServerKeyboardGetKeycodeFromPhysical,
    screen_get_refresh_rate: display.godotDisplayServerScreenGetRefreshRate,
    screen_set_orientation: display.godotDisplayServerScreenSetOrientation,
    screen_get_orientation: display.godotDisplayServerScreenGetOrientation,
    screen_set_keep_on: display.godotDisplayServerScreenSetKeepOn,
    screen_is_kept_on: display.godotDisplayServerScreenIsKeptOn,
    virtual_keyboard_show: display.godotDisplayServerVirtualKeyboardShow,
    virtual_keyboard_hide: display.godotDisplayServerVirtualKeyboardHide,
    mouse_set_mode: (mode: unknown): void =>
      display.godotDisplayServerMouseSetMode(requireInput(input, 'mouse_set_mode'), mode),
    mouse_get_mode: (): number =>
      display.godotDisplayServerMouseGetMode(requireInput(input, 'mouse_get_mode')),
    mouse_get_position: () =>
      display.godotDisplayServerMouseGetPosition(requireInput(input, 'mouse_get_position')),
    mouse_get_button_state: (): number =>
      display.godotDisplayServerMouseGetButtonState(requireInput(input, 'mouse_get_button_state')),
    get_window_at_screen_position: display.godotDisplayServerGetWindowAtScreenPosition,
    window_set_icon: display.godotDisplayServerWindowSetIcon,
    window_move_to_foreground: display.godotDisplayServerWindowMoveToForeground,
    window_set_position: display.godotDisplayServerWindowSetPosition,
    window_set_size: display.godotDisplayServerWindowSetSize,
  };
}

/** DisplayServer without a mounted Input owner; non-pointer methods remain directly usable. */
export const GODOT_DISPLAY_SERVER: GodotDisplayServer = Object.freeze(createGodotDisplayServer());
