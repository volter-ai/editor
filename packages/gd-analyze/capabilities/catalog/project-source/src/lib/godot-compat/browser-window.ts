/** Godot Window title over the browser document that owns the mounted game. */

import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import {
  godotDisplayServerWindowGetCurrentScreen,
  godotDisplayServerWindowGetMode,
  godotDisplayServerWindowGetPositionWithDecorations,
  godotDisplayServerWindowGetSizeWithDecorations,
  godotDisplayServerWindowCanDraw,
  godotDisplayServerWindowIsMaximizeAllowed,
  godotDisplayServerWindowSetCurrentScreen,
  godotDisplayServerWindowSetMode,
  godotOsGetWindowBorderless,
} from './os';
import { type Vector2, vec2 } from './vector2';

export interface GodotBrowserWindow {
  title: string;
  size: Vector2;
  position: Vector2;
  visible: boolean;
  unresizable: boolean;
  readonly borderless: boolean;
  readonly content_scale_size: Vector2;
  readonly content_scale_mode: number;
  readonly content_scale_aspect: number;
  readonly content_scale_factor: number;
  mode: number;
  current_screen: number;
  readonly focus_entered: GodotSignal<readonly []>;
  readonly focus_exited: GodotSignal<readonly []>;
  readonly mouse_entered: GodotSignal<readonly []>;
  readonly mouse_exited: GodotSignal<readonly []>;
  readonly visibility_changed: GodotSignal<readonly []>;
  set_title(value: string): void;
  get_title(): string;
  set_position(value: Vector2): void;
  get_position(): Vector2;
  set_size(value: Vector2): void;
  get_size(): Vector2;
  reset_size(): void;
  set_mode(value: number): void;
  get_mode(): number;
  set_current_screen(value: number): void;
  get_current_screen(): number;
  get_position_with_decorations(): Vector2;
  get_size_with_decorations(): Vector2;
  get_window_id(): number;
  get_focused_window(): GodotBrowserWindow | null;
  is_embedded(): boolean;
  is_maximize_allowed(): boolean;
  can_draw(): boolean;
  grab_focus(): void;
  move_to_foreground(): void;
  move_to_center(): void;
  has_focus(): boolean;
  get_content_scale_size(): Vector2;
  get_content_scale_mode(): number;
  get_content_scale_aspect(): number;
  get_content_scale_factor(): number;
  set_visible(value: boolean): void;
  is_visible(): boolean;
  show(): void;
  hide(): void;
  popup_centered(minSize?: { readonly x: number; readonly y: number }): void;
}

const WINDOWS = new WeakMap<Document, GodotBrowserWindow>();

export function getGodotBrowserWindow(documentValue: Document = document): GodotBrowserWindow {
  const existing = WINDOWS.get(documentValue);
  if (existing !== undefined) return existing;
  const nativeWindow = documentValue.defaultView;
  if (nativeWindow === null) {
    throw new Error('godot-compat: Window requires the browser Window that owns the mounted document.');
  }
  const contentsMinimumSize = (): Vector2 => {
    const root = documentValue.documentElement;
    const body = documentValue.body;
    return vec2(
      Math.ceil(Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0)),
      Math.ceil(Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0)),
    );
  };
  // A Godot Window signal owns the browser event edge itself. The main-window object has the same
  // lifetime as its Document, so these listeners cannot outlive their native owner.
  const focusEntered = createSignal<readonly []>();
  const focusExited = createSignal<readonly []>();
  const mouseEntered = createSignal<readonly []>();
  const mouseExited = createSignal<readonly []>();
  const visibilityChanged = createSignal<readonly []>();
  nativeWindow.addEventListener('focus', () => focusEntered.emit());
  nativeWindow.addEventListener('blur', () => focusExited.emit());
  documentValue.documentElement.addEventListener('pointerenter', () => mouseEntered.emit());
  documentValue.documentElement.addEventListener('pointerleave', () => mouseExited.emit());
  const value = {
    focus_entered: focusEntered.signal,
    focus_exited: focusExited.signal,
    mouse_entered: mouseEntered.signal,
    mouse_exited: mouseExited.signal,
    visibility_changed: visibilityChanged.signal,
    get title(): string { return documentValue.title; },
    set title(next: string) {
      if (typeof next !== 'string') throw new TypeError('Window.title requires a String.');
      documentValue.title = next;
    },
    get size(): Vector2 { return vec2(nativeWindow.innerWidth, nativeWindow.innerHeight); },
    set size(next: Vector2) {
      if (!Number.isSafeInteger(next.x) || !Number.isSafeInteger(next.y) || next.x <= 0 || next.y <= 0) {
        throw new TypeError('Window.size requires a positive integer Vector2i.');
      }
      if (nativeWindow.innerWidth === next.x && nativeWindow.innerHeight === next.y) return;
      if (nativeWindow.opener === null) {
        throw new Error('godot-compat: Window.size cannot resize an ordinary browser tab; browser resize authority is limited to script-opened windows.');
      }
      nativeWindow.resizeBy(next.x - nativeWindow.innerWidth, next.y - nativeWindow.innerHeight);
    },
    get position(): Vector2 { return vec2(nativeWindow.screenX, nativeWindow.screenY); },
    set position(next: Vector2) {
      if (!Number.isSafeInteger(next.x) || !Number.isSafeInteger(next.y)) {
        throw new TypeError('Window.position requires an integer Vector2i.');
      }
      if (nativeWindow.screenX === next.x && nativeWindow.screenY === next.y) return;
      if (nativeWindow.opener === null) {
        throw new Error('godot-compat: Window.position cannot move an ordinary browser tab; browser movement authority is limited to script-opened windows.');
      }
      nativeWindow.moveTo(next.x, next.y);
    },
    get visible(): boolean { return !documentValue.documentElement.hidden; },
    set visible(next: boolean) {
      if (typeof next !== 'boolean') throw new TypeError('Window.visible requires a bool.');
      if (documentValue.documentElement.hidden === !next) return;
      documentValue.documentElement.hidden = !next;
      visibilityChanged.emit();
    },
    set_visible(next: boolean): void { this.visible = next; },
    is_visible(): boolean { return this.visible; },
    set_title(next: string): void { this.title = next; },
    get_title(): string { return this.title; },
    set_position(next: Vector2): void { this.position = next; },
    get_position(): Vector2 { return this.position; },
    set_size(next: Vector2): void { this.size = next; },
    get_size(): Vector2 { return this.size; },
    reset_size(): void {
      const minimum = contentsMinimumSize();
      if (!(minimum.x > 0) || !(minimum.y > 0)) {
        throw new Error('godot-compat: Window.reset_size has no measurable native DOM minimum size.');
      }
      this.size = minimum;
    },
    has_focus(): boolean { return documentValue.hasFocus(); },
    // The exported browser root is born with Window's pinned defaults. Writes remain deliberately
    // unsupported until the renderer owns a resize/reprojection seam for every valid mode; these
    // getters are still exact for the native main Window rather than fabricated mutable state.
    get borderless(): boolean { return godotOsGetWindowBorderless(); },
    get content_scale_size(): Vector2 { return vec2(0, 0); },
    get content_scale_mode(): number { return 0; },
    get content_scale_aspect(): number { return 0; },
    get content_scale_factor(): number { return 1; },
    get_content_scale_size(): Vector2 { return this.content_scale_size; },
    get_content_scale_mode(): number { return this.content_scale_mode; },
    get_content_scale_aspect(): number { return this.content_scale_aspect; },
    get_content_scale_factor(): number { return this.content_scale_factor; },
    show(): void { this.visible = true; },
    hide(): void { this.visible = false; },
    get unresizable(): boolean { return false; },
    set unresizable(next: boolean) {
      if (typeof next !== 'boolean') throw new TypeError('Window.unresizable requires a bool.');
      if (!next) return;
      throw new Error('Window.unresizable=true is unavailable for the mounted root in an ordinary browser window.');
    },
    get mode(): number { return godotDisplayServerWindowGetMode(); },
    set mode(next: number) { godotDisplayServerWindowSetMode(next); },
    get current_screen(): number { return godotDisplayServerWindowGetCurrentScreen(); },
    set current_screen(next: number) { godotDisplayServerWindowSetCurrentScreen(next); },
    set_mode(next: number): void { this.mode = next; },
    get_mode(): number { return this.mode; },
    set_current_screen(next: number): void { this.current_screen = next; },
    get_current_screen(): number { return this.current_screen; },
    get_position_with_decorations(): Vector2 {
      return godotDisplayServerWindowGetPositionWithDecorations();
    },
    get_size_with_decorations(): Vector2 {
      return godotDisplayServerWindowGetSizeWithDecorations();
    },
    get_window_id(): number {
      // This object is the native browser document's main window, the sole Web DisplayServer id.
      return 0;
    },
    get_focused_window(): GodotBrowserWindow | null {
      return documentValue.hasFocus() ? this : null;
    },
    is_embedded(): boolean {
      // Browser export owns a top-level browsing context, never Godot's embedded subwindow mode.
      return false;
    },
    is_maximize_allowed(): boolean {
      return godotDisplayServerWindowIsMaximizeAllowed();
    },
    can_draw(): boolean {
      return godotDisplayServerWindowCanDraw();
    },
    grab_focus(): void {
      nativeWindow.focus();
    },
    move_to_foreground(): void {
      nativeWindow.focus();
    },
    move_to_center(): void {
      if (nativeWindow.opener === null) {
        throw new Error(
          'godot-compat: Window.move_to_center cannot move an ordinary browser tab; ' +
            'browser movement authority is limited to script-opened windows.',
        );
      }
      const screenValue = nativeWindow.screen;
      const positioned = screenValue as Screen & {
        readonly availLeft?: number;
        readonly availTop?: number;
      };
      const left =
        (positioned.availLeft ?? 0) + Math.round((screenValue.availWidth - nativeWindow.outerWidth) / 2);
      const top =
        (positioned.availTop ?? 0) + Math.round((screenValue.availHeight - nativeWindow.outerHeight) / 2);
      nativeWindow.moveTo(left, top);
    },
    popup_centered(_minSize = { x: 0, y: 0 }): never {
      // `get_window()` is the main Window; Godot refuses popup helpers on it. Embedded Window
      // subclasses use the retained dialog backend instead.
      throw new Error("Can't popup the main window.");
    },
  } satisfies GodotBrowserWindow;
  registerGodotObjectIdentity(value, 'Window');
  WINDOWS.set(documentValue, value);
  return value;
}
