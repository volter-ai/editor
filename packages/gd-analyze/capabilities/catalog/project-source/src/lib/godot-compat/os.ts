/** Godot's Web/HTML5 OS singleton over real browser platform services. */

import {
  godotBrowserCommandLine,
  godotTimeGetDatetimeDictFromSystem,
  godotTimeGetDatetimeDictFromUnixTime,
  godotTimeGetDateDictFromSystem,
  godotTimeGetTicksMsec,
  godotTimeGetTicksUsec,
  godotTimeGetTimeDictFromSystem,
  godotTimeGetTimeZoneFromSystem,
  godotTimeGetUnixTimeFromSystem,
  type GodotDateTimeDictionary,
} from './time';
import type { PackedArrayValue } from './packed-array';
import { vec2, type Vector2 } from './vector2';
import { godotImageToPngBlob, type GodotImage } from './image';
import { rect2, type GodotRect2 } from './rect2';
import {
  packedInt32Array,
  packedByteArray,
  packedStringArray,
  type PackedInt32Array,
  type PackedStringArray,
} from './packed-array';
import { GODOT4_GLOBAL_CONSTANTS } from './global-scope-godot4-constants';
import { GODOT3_GLOBAL_CONSTANTS } from './global-scope-godot3';
import type { ColorValue } from './variant';

type GodotCursorImage = GodotImage | { readonly get_image: () => GodotImage };

export type GodotPlatformMajor = 3 | 4;

const DISPLAY_SERVER_TTS_UTTERANCE_EVENT = {
  STARTED: 0,
  ENDED: 1,
  CANCELED: 2,
  BOUNDARY: 3,
} as const;

function major(value: unknown): GodotPlatformMajor {
  if (value !== 3 && value !== 4) throw new RangeError(`Godot platform major must be 3 or 4; received ${String(value)}.`);
  return value;
}

function string(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`OS.${member} requires a string.`);
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`OS.${member} requires a boolean.`);
  return value;
}

function browserWindow(member: string): Window {
  if (typeof window === 'undefined') {
    throw new Error(`godot-compat: OS.${member} requires a browser Window.`);
  }
  return window;
}

function browserDocument(member: string): Document {
  if (typeof document === 'undefined') {
    throw new Error(`godot-compat: OS.${member} requires a browser Document.`);
  }
  return document;
}

function reportBrowserAuthorityFailure(member: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`godot-compat: OS.${member} was refused by the browser: ${reason}`);
}

let retainedClipboard = '';
let clipboardPasteOwner: Document | undefined;

function retainNativePasteEvents(): void {
  if (typeof document === 'undefined' || clipboardPasteOwner === document) return;
  clipboardPasteOwner = document;
  document.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (text !== undefined) retainedClipboard = text;
  });
}

function writeBrowserClipboard(value: unknown, member: string): void {
  const text = string(value, member);
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined ||
      typeof navigator.clipboard.writeText !== 'function') {
    throw new Error(`godot-compat: ${member} requires the browser Clipboard API.`);
  }
  if (navigator.userActivation?.isActive === false) {
    throw new Error(`godot-compat: ${member} requires an active browser user gesture.`);
  }
  const previous = retainedClipboard;
  retainedClipboard = text;
  retainNativePasteEvents();
  void navigator.clipboard.writeText(text).catch((error: unknown) => {
    if (retainedClipboard === text) retainedClipboard = previous;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`godot-compat: ${member} was refused by the browser: ${reason}`);
  });
}

/** DisplayServer and OS share the Web platform's one retained native clipboard owner. */
export const godotDisplayServerClipboardSet = (value: unknown): void =>
  writeBrowserClipboard(value, 'DisplayServer.clipboard_set');
export const godotOsSetClipboard = (value: unknown): void =>
  writeBrowserClipboard(value, 'OS.set_clipboard');
export function godotOsGetClipboard(): string {
  retainNativePasteEvents();
  return retainedClipboard;
}

export function godotOsIsWindowFullscreen(): boolean {
  return browserDocument('window_fullscreen').fullscreenElement !== null;
}

export function godotOsSetWindowFullscreen(value: unknown): void {
  const enabled = boolean(value, 'window_fullscreen');
  const documentValue = browserDocument('window_fullscreen');
  if ((documentValue.fullscreenElement !== null) === enabled) return;

  if (!enabled) {
    if (typeof documentValue.exitFullscreen !== 'function') {
      throw new Error('godot-compat: OS.window_fullscreen cannot exit fullscreen because this browser exposes no Fullscreen API.');
    }
    void documentValue.exitFullscreen().catch((error: unknown) => {
      reportBrowserAuthorityFailure('window_fullscreen', error);
    });
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.userActivation?.isActive === false) {
    throw new Error('godot-compat: OS.window_fullscreen=true requires an active browser user gesture.');
  }
  const root = documentValue.documentElement;
  if (typeof root.requestFullscreen !== 'function') {
    throw new Error('godot-compat: OS.window_fullscreen cannot enter fullscreen because this browser exposes no Fullscreen API.');
  }
  void root.requestFullscreen().catch((error: unknown) => {
    reportBrowserAuthorityFailure('window_fullscreen', error);
  });
}

/** Ordinary browser tabs have no independent borderless-window authority. */
export function godotOsGetWindowBorderless(): boolean {
  browserWindow('window_borderless');
  return false;
}

export function godotOsSetWindowBorderless(value: unknown): void {
  const enabled = boolean(value, 'window_borderless');
  browserWindow('window_borderless');
  if (!enabled) return;
  throw new Error('godot-compat: OS.window_borderless=true is unavailable to an ordinary browser tab; use fullscreen instead.');
}

let requestedWindowMaximized: boolean | undefined;
let restoreWindowBounds: { x: number; y: number; width: number; height: number } | undefined;

export function godotOsIsWindowMaximized(): boolean {
  const browser = browserWindow('window_maximized');
  if (requestedWindowMaximized !== undefined) return requestedWindowMaximized;
  if (typeof screen === 'undefined') return false;
  return (
    Math.abs(browser.screenX) <= 1 &&
    Math.abs(browser.screenY) <= 1 &&
    Math.abs(browser.outerWidth - screen.availWidth) <= 2 &&
    Math.abs(browser.outerHeight - screen.availHeight) <= 2
  );
}

/** Use host window-manager authority when available and retain the requested web-export state. */
export function godotOsSetWindowMaximized(value: unknown): void {
  const maximized = boolean(value, 'window_maximized');
  const browser = browserWindow('window_maximized');
  if (requestedWindowMaximized === maximized) return;
  if (maximized) {
    restoreWindowBounds = {
      x: browser.screenX,
      y: browser.screenY,
      width: browser.outerWidth,
      height: browser.outerHeight,
    };
  }
  requestedWindowMaximized = maximized;
  try {
    if (maximized) {
      if (typeof screen === 'undefined') return;
      browser.moveTo(0, 0);
      browser.resizeTo(screen.availWidth, screen.availHeight);
    } else if (restoreWindowBounds !== undefined) {
      browser.moveTo(restoreWindowBounds.x, restoreWindowBounds.y);
      browser.resizeTo(restoreWindowBounds.width, restoreWindowBounds.height);
    }
  } catch (error) {
    reportBrowserAuthorityFailure('window_maximized', error);
  }
}

export function godotOsGetWindowSize(): Vector2 {
  const browser = browserWindow('window_size');
  return vec2(browser.innerWidth, browser.innerHeight);
}

/** Godot 3's primary-screen size in browser CSS pixels. */
export function godotOsGetScreenSize(): Vector2 {
  if (typeof screen === 'undefined') {
    throw new Error('godot-compat: OS.get_screen_size requires the browser Screen API.');
  }
  return vec2(screen.width, screen.height);
}

/** Web export system directories live in the persistent user:// virtual filesystem. */
export function godotOsGetSystemDir(directory: number, sharedStorage = true): string {
  if (!Number.isSafeInteger(directory) || directory < 0 || directory > 7) {
    throw new RangeError(`OS.get_system_dir requires SystemDir 0..7; received ${String(directory)}.`);
  }
  if (typeof sharedStorage !== 'boolean') throw new TypeError('OS.get_system_dir shared_storage requires bool.');
  const names = ['Desktop', 'DCIM', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Ringtones'] as const;
  return `user://${names[directory]}`;
}

/** DisplayServer window mode through the browser Fullscreen API; unsupported window-manager modes refuse. */
export function godotDisplayServerWindowSetMode(mode: number, windowId = 0): void {
  if (windowId !== 0) throw new Error('DisplayServer.window_set_mode cannot address a non-main browser window.');
  if (mode === 0) { godotOsSetWindowFullscreen(false); return; }
  if (mode === 3) { godotOsSetWindowFullscreen(true); return; }
  throw new Error(
    `DisplayServer.window_set_mode(${String(mode)}) cannot represent minimized, maximized, or exclusive-fullscreen browser window-manager state.`,
  );
}

/** Browser presentation is compositor-synchronized; only Godot's enabled VSync mode is exact. */
export function godotDisplayServerWindowSetVsyncMode(mode: number, windowId = 0): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 3) {
    throw new RangeError('DisplayServer.window_set_vsync_mode requires VSyncMode 0..3.');
  }
  if (windowId !== 0) {
    throw new Error('DisplayServer.window_set_vsync_mode cannot address a non-main browser window.');
  }
  browserWindow('DisplayServer.window_set_vsync_mode');
  if (mode === 1) return;
  throw new Error(
    `DisplayServer.window_set_vsync_mode(${String(mode)}) is unavailable because browser presentation is requestAnimationFrame-synchronized.`,
  );
}

function mainScreen(value: number, member: string): void {
  if (value !== -1 && value !== 0) throw new Error(`DisplayServer.${member} cannot address screen ${String(value)}; the browser exposes one synchronous screen.`);
}

function mainWindow(value: number, member: string): void {
  if (value !== 0) throw new Error(`DisplayServer.${member} cannot address non-main browser window ${String(value)}.`);
}

export function godotDisplayServerScreenGetSize(screenIndex = -1): Vector2 {
  mainScreen(screenIndex, 'screen_get_size');
  return godotOsGetScreenSize();
}

export function godotDisplayServerScreenGetPosition(screenIndex = -1): Vector2 {
  mainScreen(screenIndex, 'screen_get_position');
  if (typeof screen === 'undefined') throw new Error('DisplayServer.screen_get_position requires the browser Screen API.');
  const positioned = screen as Screen & { readonly availLeft?: number; readonly availTop?: number };
  return vec2(positioned.availLeft ?? 0, positioned.availTop ?? 0);
}

export function godotDisplayServerScreenGetScale(screenIndex = -1): number {
  mainScreen(screenIndex, 'screen_get_scale');
  const browser = browserWindow('screen_get_scale');
  return Number.isFinite(browser.devicePixelRatio) && browser.devicePixelRatio > 0 ? browser.devicePixelRatio : 1;
}

export function godotDisplayServerScreenGetDpi(screenIndex = -1): number {
  mainScreen(screenIndex, 'screen_get_dpi');
  return 96 * godotDisplayServerScreenGetScale(screenIndex);
}

/** The Web display driver exposes one synchronous screen to Godot. */
export function godotDisplayServerGetScreenCount(): number {
  if (typeof screen === 'undefined') {
    throw new Error('DisplayServer.get_screen_count requires the browser Screen API.');
  }
  return 1;
}

export function godotDisplayServerGetPrimaryScreen(): number {
  godotDisplayServerGetScreenCount();
  return 0;
}

export function godotDisplayServerGetKeyboardFocusScreen(): number {
  browserDocument('get_keyboard_focus_screen');
  return 0;
}

/** Any finite rectangle belongs to the one screen visible through the synchronous Web API. */
export function godotDisplayServerGetScreenFromRect(value: unknown): number {
  if (
    typeof value !== 'object' || value === null ||
    typeof (value as { readonly position?: { readonly x?: unknown; readonly y?: unknown } }).position?.x !== 'number' ||
    typeof (value as { readonly position?: { readonly x?: unknown; readonly y?: unknown } }).position?.y !== 'number' ||
    typeof (value as { readonly size?: { readonly x?: unknown; readonly y?: unknown } }).size?.x !== 'number' ||
    typeof (value as { readonly size?: { readonly x?: unknown; readonly y?: unknown } }).size?.y !== 'number'
  ) {
    throw new TypeError('DisplayServer.get_screen_from_rect requires a Rect2.');
  }
  const numbers = [
    (value as { position: { x: number; y: number } }).position.x,
    (value as { position: { x: number; y: number } }).position.y,
    (value as { size: { x: number; y: number } }).size.x,
    (value as { size: { x: number; y: number } }).size.y,
  ];
  if (!numbers.every(Number.isFinite)) throw new RangeError('DisplayServer.get_screen_from_rect requires a finite Rect2.');
  godotDisplayServerGetScreenCount();
  return 0;
}

export function godotDisplayServerScreenGetUsableRect(screenIndex = -1): GodotRect2 {
  mainScreen(screenIndex, 'screen_get_usable_rect');
  if (typeof screen === 'undefined') {
    throw new Error('DisplayServer.screen_get_usable_rect requires the browser Screen API.');
  }
  const positioned = screen as Screen & {
    readonly availLeft?: number;
    readonly availTop?: number;
  };
  return rect2(positioned.availLeft ?? 0, positioned.availTop ?? 0, screen.availWidth, screen.availHeight);
}

export function godotDisplayServerScreenGetMaxScale(screenIndex = -1): number {
  mainScreen(screenIndex, 'screen_get_max_scale');
  return godotDisplayServerScreenGetScale(screenIndex);
}

export function godotDisplayServerWindowGetSize(windowId = 0): Vector2 {
  mainWindow(windowId, 'window_get_size');
  return godotOsGetWindowSize();
}

export function godotDisplayServerWindowGetPosition(windowId = 0): Vector2 {
  mainWindow(windowId, 'window_get_position');
  return godotOsGetWindowPosition();
}

/** The Web backend has one retained top-level browser window with Godot id 0. */
export function godotDisplayServerGetWindowList(): PackedInt32Array {
  browserWindow('get_window_list');
  return packedInt32Array([0]);
}

/** Popup ownership is unavailable until Window nodes share the DisplayServer window-id carrier. */
export function godotDisplayServerWindowGetActivePopup(): never {
  throw new Error(
    'DisplayServer.window_get_active_popup is unavailable: retained Window nodes do not yet expose DisplayServer window ids.',
  );
}

/** Browser outer coordinates include the user-agent decorations. */
export function godotDisplayServerWindowGetPositionWithDecorations(windowId = 0): Vector2 {
  mainWindow(windowId, 'window_get_position_with_decorations');
  const browser = browserWindow('window_get_position_with_decorations');
  return vec2(browser.screenX, browser.screenY);
}

/** Browser outer dimensions include the user-agent decorations. */
export function godotDisplayServerWindowGetSizeWithDecorations(windowId = 0): Vector2 {
  mainWindow(windowId, 'window_get_size_with_decorations');
  const browser = browserWindow('window_get_size_with_decorations');
  return vec2(browser.outerWidth, browser.outerHeight);
}

export function godotDisplayServerWindowGetMode(windowId = 0): number {
  mainWindow(windowId, 'window_get_mode');
  return godotOsIsWindowFullscreen() ? 3 : 0;
}

export function godotDisplayServerWindowSetTitle(title: unknown, windowId = 0): void {
  mainWindow(windowId, 'window_set_title');
  if (typeof title !== 'string') throw new TypeError('DisplayServer.window_set_title requires a String.');
  browserDocument('window_set_title').title = title;
}

export function godotDisplayServerWindowIsFocused(windowId = 0): boolean {
  mainWindow(windowId, 'window_is_focused');
  return browserDocument('window_is_focused').hasFocus();
}

export function godotDisplayServerWindowGetCurrentScreen(windowId = 0): number {
  mainWindow(windowId, 'window_get_current_screen');
  godotDisplayServerGetScreenCount();
  return 0;
}

/** Moving the main window to the only browser-visible screen is an exact no-op. */
export function godotDisplayServerWindowSetCurrentScreen(screenIndex: number, windowId = 0): void {
  mainWindow(windowId, 'window_set_current_screen');
  mainScreen(screenIndex, 'window_set_current_screen');
}

/** Browser presentation can draw whenever the retained document is not hidden or prerendering. */
export function godotDisplayServerWindowCanDraw(windowId = 0): boolean {
  mainWindow(windowId, 'window_can_draw');
  const documentValue = browserDocument('window_can_draw');
  return documentValue.visibilityState !== 'hidden';
}

/** Web presentation is requestAnimationFrame synchronized, Godot's VSYNC_ENABLED enum value. */
export function godotDisplayServerWindowGetVsyncMode(windowId = 0): number {
  mainWindow(windowId, 'window_get_vsync_mode');
  browserWindow('window_get_vsync_mode');
  return 1;
}

/** An ordinary browser tab cannot be promoted to a window-manager maximized state. */
export function godotDisplayServerWindowIsMaximizeAllowed(windowId = 0): boolean {
  mainWindow(windowId, 'window_is_maximize_allowed');
  browserWindow('window_is_maximize_allowed');
  return false;
}

/** Browser-native virtual keyboard occlusion in CSS pixels.
 * VisualViewport is the only web API exposing the shrunken interactive viewport; desktop/no-IME
 * browsers report zero because their layout viewport is not occluded. */
export function godotDisplayServerVirtualKeyboardGetHeight(): number {
  if (typeof window === 'undefined') return 0;
  const keyboard = (navigator as Navigator & {
    readonly virtualKeyboard?: { readonly boundingRect: { readonly height: number } };
  }).virtualKeyboard;
  const nativeHeight = keyboard?.boundingRect.height;
  if (Number.isFinite(nativeHeight)) return Math.max(0, Math.round(nativeHeight!));
  const viewport = window.visualViewport;
  if (viewport === null) return 0;
  const occluded = window.innerHeight - viewport.height - viewport.offsetTop;
  return Math.max(0, Math.round(Number.isFinite(occluded) ? occluded : 0));
}

function browserSpeech(member: string): SpeechSynthesis {
  if (typeof speechSynthesis === 'undefined') throw new Error(`DisplayServer.${member} requires the browser SpeechSynthesis API.`);
  return speechSynthesis;
}

export const godotDisplayServerTtsIsSpeaking = (): boolean => browserSpeech('tts_is_speaking').speaking;
export const godotDisplayServerTtsIsPaused = (): boolean => browserSpeech('tts_is_paused').paused;
export const godotDisplayServerTtsPause = (): void => { browserSpeech('tts_pause').pause(); };
export const godotDisplayServerTtsResume = (): void => { browserSpeech('tts_resume').resume(); };

type GodotTtsCallback = ((...args: readonly unknown[]) => unknown) | {
  readonly call: (...args: readonly unknown[]) => unknown;
  readonly isNull?: () => boolean;
};

const displayServerTtsCallbacks = new Map<number, GodotTtsCallback>();
interface ActiveTtsUtterance { readonly utterance: SpeechSynthesisUtterance; readonly id: number }
const activeTtsUtterances = new Set<ActiveTtsUtterance>();

function invokeTtsCallback(event: number, ...args: readonly unknown[]): void {
  const callback = displayServerTtsCallbacks.get(event);
  if (callback === undefined) return;
  queueMicrotask(() => {
    if (typeof callback === 'function') callback(...args);
    else Reflect.apply(callback.call, callback, args);
  });
}

function finishTtsUtterance(entry: ActiveTtsUtterance, event: number): void {
  if (!activeTtsUtterances.delete(entry)) return;
  invokeTtsCallback(event, entry.id);
}

function cancelActiveTtsUtterances(): void {
  for (const entry of [...activeTtsUtterances]) {
    finishTtsUtterance(entry, DISPLAY_SERVER_TTS_UTTERANCE_EVENT.CANCELED);
  }
}

export function godotDisplayServerTtsStop(): void {
  cancelActiveTtsUtterances();
  browserSpeech('tts_stop').cancel();
}

export function godotDisplayServerTtsSetUtteranceCallback(eventValue: unknown, callbackValue: unknown): void {
  if (!Number.isSafeInteger(eventValue) || Number(eventValue) < 0 || Number(eventValue) > 3) {
    throw new RangeError('DisplayServer.tts_set_utterance_callback requires TTSUtteranceEvent 0..3.');
  }
  const event = Number(eventValue);
  if (
    typeof callbackValue === 'object' && callbackValue !== null &&
    typeof Reflect.get(callbackValue, 'isNull') === 'function' &&
    Reflect.apply(Reflect.get(callbackValue, 'isNull') as () => boolean, callbackValue, []) === true
  ) {
    displayServerTtsCallbacks.delete(event);
    return;
  }
  if (
    typeof callbackValue !== 'function' &&
    (typeof callbackValue !== 'object' || callbackValue === null || typeof Reflect.get(callbackValue, 'call') !== 'function')
  ) {
    throw new TypeError('DisplayServer.tts_set_utterance_callback requires a Callable.');
  }
  displayServerTtsCallbacks.set(event, callbackValue as GodotTtsCallback);
}

export interface GodotTtsVoice {
  readonly name: string;
  readonly id: string;
  readonly language: string;
}

function browserTtsVoices(): readonly SpeechSynthesisVoice[] {
  return browserSpeech('tts_get_voices').getVoices();
}

/** Godot's voice Dictionary rows, sourced directly from the browser voice inventory. */
export function godotDisplayServerTtsGetVoices(): readonly GodotTtsVoice[] {
  return browserTtsVoices().map((voice) => ({
    name: voice.name,
    id: voice.name,
    language: voice.lang,
  }));
}

/** Voice names whose browser-authored language begins with the requested source spelling. */
export function godotDisplayServerTtsGetVoicesForLanguage(language: unknown): PackedStringArray {
  if (typeof language !== 'string') {
    throw new TypeError('DisplayServer.tts_get_voices_for_language requires a String language.');
  }
  return packedStringArray(
    browserTtsVoices()
      .filter((voice) => voice.lang.startsWith(language))
      .map((voice) => voice.name),
  );
}

/**
 * Queue a real browser speech utterance with Godot's voice, volume, pitch, rate and interrupt
 * controls. Browser autoplay policy may still refuse audible speech; the emitter remains present
 * so that refusal is platform-loud rather than replaced by a pretend completed utterance.
 */
export function godotDisplayServerTtsSpeak(
  textValue: unknown,
  voiceId: unknown,
  volume = 50,
  pitch = 1,
  rate = 1,
  utteranceId = 0,
  interrupt = false,
): void {
  if (typeof textValue !== 'string' || typeof voiceId !== 'string') {
    throw new TypeError('DisplayServer.tts_speak requires String text and voice id.');
  }
  if (![volume, pitch, rate].every(Number.isFinite)) {
    throw new TypeError('DisplayServer.tts_speak volume, pitch, and rate must be finite numbers.');
  }
  if (!Number.isSafeInteger(utteranceId)) {
    throw new TypeError('DisplayServer.tts_speak utterance_id must be an integer.');
  }
  if (typeof interrupt !== 'boolean') throw new TypeError('DisplayServer.tts_speak interrupt must be bool.');
  if (typeof SpeechSynthesisUtterance === 'undefined') {
    throw new Error('DisplayServer.tts_speak requires the browser SpeechSynthesisUtterance API.');
  }
  const speech = browserSpeech('tts_speak');
  if (textValue === '') {
    invokeTtsCallback(DISPLAY_SERVER_TTS_UTTERANCE_EVENT.CANCELED, utteranceId);
    return;
  }
  const voice = browserTtsVoices().find((candidate) => candidate.name === voiceId);
  if (interrupt) {
    cancelActiveTtsUtterances();
    speech.cancel();
  }
  const utterance = new SpeechSynthesisUtterance(textValue);
  if (voice !== undefined) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.volume = Math.min(100, Math.max(0, volume)) / 100;
  utterance.pitch = Math.min(2, Math.max(0, pitch));
  utterance.rate = Math.min(10, Math.max(0.1, rate));
  const active: ActiveTtsUtterance = { utterance, id: utteranceId };
  utterance.onstart = () => {
    if (activeTtsUtterances.has(active)) {
      invokeTtsCallback(DISPLAY_SERVER_TTS_UTTERANCE_EVENT.STARTED, utteranceId);
    }
  };
  utterance.onend = () => finishTtsUtterance(active, DISPLAY_SERVER_TTS_UTTERANCE_EVENT.ENDED);
  utterance.onerror = () => finishTtsUtterance(active, DISPLAY_SERVER_TTS_UTTERANCE_EVENT.CANCELED);
  utterance.onboundary = (event) => {
    if (!activeTtsUtterances.has(active)) return;
    invokeTtsCallback(DISPLAY_SERVER_TTS_UTTERANCE_EVENT.BOUNDARY, event.charIndex, utteranceId);
  };
  activeTtsUtterances.add(active);
  // Keep the Godot utterance id reachable for host-side inspection without changing spoken text.
  Object.defineProperty(utterance, '__godotUtteranceId', { value: utteranceId, enumerable: false });
  try {
    speech.resume();
    speech.speak(utterance);
  } catch (error) {
    activeTtsUtterances.delete(active);
    throw error;
  }
}

export function godotOsAlert(textValue: unknown, titleValue = 'Alert!'): void {
  if (typeof textValue !== 'string' || typeof titleValue !== 'string') throw new TypeError('OS.alert requires String text and title.');
  browserWindow('alert').alert(titleValue === '' ? textValue : `${titleValue}\n\n${textValue}`);
}

export function godotOsCanDraw(): boolean {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

export function godotOsIsWindowFocused(): boolean {
  return browserDocument('is_window_focused').hasFocus();
}

export function godotOsGetScreenDpi(screenIndex = -1): number {
  return godotDisplayServerScreenGetDpi(screenIndex);
}

export function godotOsSetWindowTitle(title: unknown): void {
  godotDisplayServerWindowSetTitle(title);
}

/** Godot's Web display server exposes the browser's current screen as its one synchronous screen. */
export function godotOsGetScreenCount(): number {
  if (typeof screen === 'undefined') {
    throw new Error('godot-compat: OS.get_screen_count requires the browser Screen API.');
  }
  return 1;
}

export function godotOsGetCurrentScreen(): number {
  godotOsGetScreenCount();
  return 0;
}

/** Godot's browser touch-UI hint, derived from the same platform facts as the overlay. */
export function godotOsHasTouchscreenUiHint(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}

let requestedWindowPosition: Vector2 | undefined;
let warnedWindowPositionAuthority = false;

function warnWindowPositionAuthority(reason: string): void {
  if (warnedWindowPositionAuthority) return;
  warnedWindowPositionAuthority = true;
  console.warn(
    `godot-compat: OS.window_position retained the requested position, but the browser ` +
    `cannot move this window: ${reason}`,
  );
}

export function godotOsGetWindowPosition(): Vector2 {
  if (requestedWindowPosition !== undefined) return vec2(requestedWindowPosition.x, requestedWindowPosition.y);
  const browser = browserWindow('window_position');
  return vec2(browser.screenX, browser.screenY);
}

export function godotOsSetWindowPosition(value: unknown): void {
  if (
    typeof value !== 'object' || value === null ||
    !Number.isSafeInteger((value as { x?: unknown }).x) ||
    !Number.isSafeInteger((value as { y?: unknown }).y)
  ) {
    throw new TypeError('OS.window_position requires an integer Vector2.');
  }
  const browser = browserWindow('window_position');
  const requested = vec2(Number((value as { x: number }).x), Number((value as { y: number }).y));
  requestedWindowPosition = requested;
  if (browser.opener === null) {
    warnWindowPositionAuthority('move authority is limited to script-opened windows');
    return;
  }
  try {
    browser.moveTo(requested.x, requested.y);
  } catch (error) {
    warnWindowPositionAuthority(error instanceof Error ? error.message : String(error));
  }
}

export function godotOsSetWindowSize(value: unknown): void {
  if (
    typeof value !== 'object' || value === null ||
    !Number.isSafeInteger((value as { x?: unknown }).x) ||
    !Number.isSafeInteger((value as { y?: unknown }).y) ||
    Number((value as { x: number }).x) <= 0 ||
    Number((value as { y: number }).y) <= 0
  ) {
    throw new TypeError('OS.window_size requires a positive integer Vector2.');
  }
  const browser = browserWindow('window_size');
  const width = Number((value as { x: number }).x);
  const height = Number((value as { y: number }).y);
  if (browser.innerWidth === width && browser.innerHeight === height) return;
  if (browser.opener === null) {
    throw new Error('godot-compat: OS.window_size cannot resize an ordinary browser tab; browser resize authority is limited to script-opened windows.');
  }
  browser.resizeBy(width - browser.innerWidth, height - browser.innerHeight);
}

/** Browser-hosted rendering is synchronized by requestAnimationFrame. */
export function godotOsIsVsyncEnabled(): boolean {
  browserWindow('vsync_enabled');
  return true;
}

export function godotOsSetUseVsync(value: unknown): void {
  const enabled = boolean(value, 'vsync_enabled');
  browserWindow('vsync_enabled');
  if (enabled) return;
  throw new Error('godot-compat: OS.vsync_enabled=false is unavailable because browser presentation is requestAnimationFrame-synchronized.');
}

export function godotOsGetName(engineMajor: unknown): string {
  return major(engineMajor) === 3 ? 'HTML5' : 'Web';
}

/** The Web export executable is the browser document currently hosting the game. */
export function godotOsGetExecutablePath(): string {
  return browserWindow('get_executable_path').location.href;
}

/** Godot 4's Web display driver name. */
export function godotDisplayServerGetName(): string {
  return 'web';
}

const displayServerIconUrls = new WeakMap<Document, string>();

/** DisplayServer.set_icon installs the retained Image as the document's browser-native favicon. */
export function godotDisplayServerSetIcon(image: GodotImage): void {
  if (typeof image !== 'object' || image === null || typeof image.get_pixel !== 'function') {
    throw new TypeError('DisplayServer.set_icon requires an Image Resource.');
  }
  if (image.is_empty()) throw new Error('DisplayServer.set_icon cannot install an empty Image.');
  const documentValue = browserDocument('set_icon');
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('DisplayServer.set_icon requires browser object-URL support.');
  }
  const nextUrl = URL.createObjectURL(godotImageToPngBlob(image));
  let link = documentValue.querySelector<HTMLLinkElement>('link[data-godot-display-icon]');
  if (link === null) {
    link = documentValue.createElement('link');
    link.rel = 'icon';
    link.dataset['godotDisplayIcon'] = 'true';
    documentValue.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = nextUrl;
  const previousUrl = displayServerIconUrls.get(documentValue);
  if (previousUrl !== undefined && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previousUrl);
  displayServerIconUrls.set(documentValue, nextUrl);
}

interface BrowserCursorSlot {
  readonly url: string;
  readonly hotspot: Vector2;
}

interface BrowserCursorState {
  shape: number;
  readonly custom: Map<number, BrowserCursorSlot>;
}

const displayServerCursorStates = new WeakMap<Document, BrowserCursorState>();
const CSS_CURSOR_SHAPES = [
  'default', 'text', 'pointer', 'crosshair', 'wait', 'progress', 'grab', 'copy', 'not-allowed',
  'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize', 'move', 'row-resize', 'col-resize', 'help',
] as const;

function cursorShape(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= CSS_CURSOR_SHAPES.length) {
    throw new RangeError(`DisplayServer cursor shape must be CURSOR_ARROW (0) through CURSOR_HELP (16); received ${String(value)}.`);
  }
  return value as number;
}

function cursorState(documentValue: Document): BrowserCursorState {
  let state = displayServerCursorStates.get(documentValue);
  if (state !== undefined) return state;
  state = { shape: 0, custom: new Map() };
  displayServerCursorStates.set(documentValue, state);
  return state;
}

function applyBrowserCursor(documentValue: Document, state: BrowserCursorState): void {
  const slot = state.custom.get(state.shape);
  documentValue.documentElement.style.cursor = slot === undefined
    ? CSS_CURSOR_SHAPES[state.shape]!
    : `url("${slot.url}") ${Math.trunc(slot.hotspot.x)} ${Math.trunc(slot.hotspot.y)}, ${CSS_CURSOR_SHAPES[state.shape]!}`;
}

export function godotDisplayServerCursorSetShape(value: unknown): void {
  const documentValue = browserDocument('cursor_set_shape');
  const state = cursorState(documentValue);
  state.shape = cursorShape(value);
  applyBrowserCursor(documentValue, state);
}

export function godotDisplayServerCursorGetShape(): number {
  const documentValue = browserDocument('cursor_get_shape');
  return cursorState(documentValue).shape;
}

/** Installs the custom arrow cursor on the retained browser game document. */
export function godotDisplayServerCursorSetCustomImage(
  value: GodotCursorImage | null,
  shape = 0,
  hotspot: Vector2 = vec2(0, 0),
): void {
  const slotShape = cursorShape(shape);
  if (![hotspot.x, hotspot.y].every(Number.isFinite) || hotspot.x < 0 || hotspot.y < 0) {
    throw new RangeError('DisplayServer.cursor_set_custom_image hotspot must be a finite non-negative Vector2.');
  }
  const documentValue = browserDocument('cursor_set_custom_image');
  const state = cursorState(documentValue);
  const previous = state.custom.get(slotShape);
  if (value === null) {
    if (previous !== undefined && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous.url);
    state.custom.delete(slotShape);
    if (state.shape === slotShape) applyBrowserCursor(documentValue, state);
    return;
  }
  const image = typeof (value as { readonly get_image?: unknown }).get_image === 'function'
    ? (value as { readonly get_image: () => GodotImage }).get_image()
    : value as GodotImage;
  if (typeof image !== 'object' || image === null || typeof image.get_pixel !== 'function' || image.is_empty()) {
    throw new TypeError('DisplayServer.cursor_set_custom_image requires a non-empty Image or Texture2D Resource.');
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('DisplayServer.cursor_set_custom_image requires browser object-URL support.');
  }
  const nextUrl = URL.createObjectURL(godotImageToPngBlob(image));
  state.custom.set(slotShape, { url: nextUrl, hotspot: vec2(hotspot.x, hotspot.y) });
  if (previous !== undefined && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous.url);
  if (state.shape === slotShape) applyBrowserCursor(documentValue, state);
}


/** Godot Web cannot inspect the processor model and exposes the platform's exact empty String. */
export function godotOsGetProcessorName(): string {
  return '';
}

const GODOT3_KEY_CODE_MASK = (1 << 25) - 1;
const GODOT3_ONLY_KEY_TEXT = [
  ['KEY_SUPER_L', 'Super L'], ['KEY_SUPER_R', 'Super R'],
  ['KEY_HYPER_L', 'Hyper L'], ['KEY_HYPER_R', 'Hyper R'],
  ['KEY_DIRECTION_L', 'Direction L'], ['KEY_DIRECTION_R', 'Direction R'],
  ['KEY_BASSBOOST', 'BassBoost'], ['KEY_BASSUP', 'BassUp'], ['KEY_BASSDOWN', 'BassDown'],
  ['KEY_TREBLEUP', 'TrebleUp'], ['KEY_TREBLEDOWN', 'TrebleDown'],
  ['KEY_NOBREAKSPACE', 'NoBreakSpace'], ['KEY_EXCLAMDOWN', 'ExclamDown'],
  ['KEY_CENT', 'Cent'], ['KEY_STERLING', 'Sterling'], ['KEY_CURRENCY', 'Currency'],
  ['KEY_BROKENBAR', 'BrokenBar'], ['KEY_DIAERESIS', 'Diaeresis'],
  ['KEY_COPYRIGHT', 'Copyright'], ['KEY_ORDFEMININE', 'Ordfeminine'],
  ['KEY_GUILLEMOTLEFT', 'GuillemotLeft'], ['KEY_NOTSIGN', 'NotSign'],
  ['KEY_HYPHEN', 'Hyphen'], ['KEY_REGISTERED', 'Registered'], ['KEY_MACRON', 'Macron'],
  ['KEY_DEGREE', 'Degree'], ['KEY_PLUSMINUS', 'PlusMinus'],
  ['KEY_TWOSUPERIOR', 'TwoSuperior'], ['KEY_THREESUPERIOR', 'ThreeSuperior'],
  ['KEY_ACUTE', 'Acute'], ['KEY_MU', 'Mu'], ['KEY_PARAGRAPH', 'Paragraph'],
  ['KEY_PERIODCENTERED', 'PeriodCentered'], ['KEY_CEDILLA', 'Cedilla'],
  ['KEY_ONESUPERIOR', 'OneSuperior'], ['KEY_MASCULINE', 'Masculine'],
  ['KEY_GUILLEMOTRIGHT', 'GuillemotRight'], ['KEY_ONEQUARTER', 'OneQuarter'],
  ['KEY_ONEHALF', 'OneHalf'], ['KEY_THREEQUARTERS', 'ThreeQuarters'],
  ['KEY_QUESTIONDOWN', 'QuestionDown'], ['KEY_AGRAVE', 'Agrave'], ['KEY_AACUTE', 'Aacute'],
  ['KEY_ACIRCUMFLEX', 'AcircumFlex'], ['KEY_ATILDE', 'Atilde'],
  ['KEY_ADIAERESIS', 'Adiaeresis'], ['KEY_ARING', 'Aring'], ['KEY_AE', 'Ae'],
  ['KEY_CCEDILLA', 'Ccedilla'], ['KEY_EGRAVE', 'Egrave'], ['KEY_EACUTE', 'Eacute'],
  ['KEY_ECIRCUMFLEX', 'Ecircumflex'], ['KEY_EDIAERESIS', 'Ediaeresis'],
  ['KEY_IGRAVE', 'Igrave'], ['KEY_IACUTE', 'Iacute'], ['KEY_ICIRCUMFLEX', 'Icircumflex'],
  ['KEY_IDIAERESIS', 'Idiaeresis'], ['KEY_ETH', 'Eth'], ['KEY_NTILDE', 'Ntilde'],
  ['KEY_OGRAVE', 'Ograve'], ['KEY_OACUTE', 'Oacute'], ['KEY_OCIRCUMFLEX', 'Ocircumflex'],
  ['KEY_OTILDE', 'Otilde'], ['KEY_ODIAERESIS', 'Odiaeresis'], ['KEY_MULTIPLY', 'Multiply'],
  ['KEY_OOBLIQUE', 'Ooblique'], ['KEY_UGRAVE', 'Ugrave'], ['KEY_UACUTE', 'Uacute'],
  ['KEY_UCIRCUMFLEX', 'Ucircumflex'], ['KEY_UDIAERESIS', 'Udiaeresis'],
  ['KEY_YACUTE', 'Yacute'], ['KEY_THORN', 'Thorn'], ['KEY_SSHARP', 'Ssharp'],
  ['KEY_DIVISION', 'Division'], ['KEY_YDIAERESIS', 'Ydiaeresis'],
] as const;

/** Godot 3 `OS.get_scancode_string`: printable Unicode or the stable key name, with modifiers. */
export function godotOsGetScancodeString(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('OS.get_scancode_string requires a non-negative integer scancode.');
  }
  const scancode = value as number;
  const code = scancode & GODOT3_KEY_CODE_MASK;
  let name = GODOT3_KEY_NAMES.get(code);
  if (name === undefined && code >= 16777244 && code <= 16777279) name = `F${code - 16777243}`;
  if (name === undefined && code > 0 && code <= 0x10ffff) name = String.fromCodePoint(code).toUpperCase();
  if (name === undefined) name = '';
  const modifiers: string[] = [];
  if ((scancode & (1 << 28)) !== 0) modifiers.push('Control');
  if ((scancode & (1 << 26)) !== 0) modifiers.push('Alt');
  if ((scancode & (1 << 25)) !== 0) modifiers.push('Shift');
  if ((scancode & (1 << 27)) !== 0) modifiers.push('Meta');
  return [...modifiers, name].filter((part) => part.length > 0).join('+');
}

const GODOT4_KEY_CODE_MASK = 0x7fffff;
const GODOT4_KEY_TEXT = [
  ['KEY_ESCAPE', 'Escape'], ['KEY_TAB', 'Tab'], ['KEY_BACKTAB', 'Backtab'],
  ['KEY_BACKSPACE', 'Backspace'], ['KEY_ENTER', 'Enter'], ['KEY_KP_ENTER', 'Kp Enter'],
  ['KEY_INSERT', 'Insert'], ['KEY_DELETE', 'Delete'], ['KEY_PAUSE', 'Pause'],
  ['KEY_PRINT', 'Print'], ['KEY_SYSREQ', 'SysReq'], ['KEY_CLEAR', 'Clear'],
  ['KEY_HOME', 'Home'], ['KEY_END', 'End'], ['KEY_LEFT', 'Left'], ['KEY_UP', 'Up'],
  ['KEY_RIGHT', 'Right'], ['KEY_DOWN', 'Down'], ['KEY_PAGEUP', 'PageUp'],
  ['KEY_PAGEDOWN', 'PageDown'], ['KEY_SHIFT', 'Shift'], ['KEY_CTRL', 'Ctrl'],
  ['KEY_META', 'Meta'], ['KEY_ALT', 'Alt'], ['KEY_CAPSLOCK', 'CapsLock'],
  ['KEY_NUMLOCK', 'NumLock'], ['KEY_SCROLLLOCK', 'ScrollLock'],
  ...Array.from({ length: 35 }, (_, index) => [`KEY_F${index + 1}`, `F${index + 1}`] as const),
  ['KEY_KP_MULTIPLY', 'Kp Multiply'], ['KEY_KP_DIVIDE', 'Kp Divide'],
  ['KEY_KP_SUBTRACT', 'Kp Subtract'], ['KEY_KP_PERIOD', 'Kp Period'],
  ['KEY_KP_ADD', 'Kp Add'],
  ...Array.from({ length: 10 }, (_, index) => [`KEY_KP_${index}`, `Kp ${index}`] as const),
  ['KEY_MENU', 'Menu'], ['KEY_HYPER', 'Hyper'], ['KEY_HELP', 'Help'], ['KEY_BACK', 'Back'],
  ['KEY_FORWARD', 'Forward'], ['KEY_STOP', 'Stop'], ['KEY_REFRESH', 'Refresh'],
  ['KEY_VOLUMEDOWN', 'VolumeDown'], ['KEY_VOLUMEMUTE', 'VolumeMute'],
  ['KEY_VOLUMEUP', 'VolumeUp'], ['KEY_MEDIAPLAY', 'MediaPlay'],
  ['KEY_MEDIASTOP', 'MediaStop'], ['KEY_MEDIAPREVIOUS', 'MediaPrevious'],
  ['KEY_MEDIANEXT', 'MediaNext'], ['KEY_MEDIARECORD', 'MediaRecord'],
  ['KEY_HOMEPAGE', 'HomePage'], ['KEY_FAVORITES', 'Favorites'], ['KEY_SEARCH', 'Search'],
  ['KEY_STANDBY', 'StandBy'], ['KEY_OPENURL', 'OpenURL'], ['KEY_LAUNCHMAIL', 'LaunchMail'],
  ['KEY_LAUNCHMEDIA', 'LaunchMedia'],
  ...'0123456789ABCDEF'.split('').map((suffix) => [`KEY_LAUNCH${suffix}`, `Launch${suffix}`] as const),
  ['KEY_GLOBE', 'Globe'], ['KEY_KEYBOARD', 'On-screen keyboard'],
  ['KEY_JIS_EISU', 'JIS Eisu'], ['KEY_JIS_KANA', 'JIS Kana'], ['KEY_UNKNOWN', 'Unknown'],
  ['KEY_SPACE', 'Space'], ['KEY_EXCLAM', 'Exclam'], ['KEY_QUOTEDBL', 'QuoteDbl'],
  ['KEY_NUMBERSIGN', 'NumberSign'], ['KEY_DOLLAR', 'Dollar'], ['KEY_PERCENT', 'Percent'],
  ['KEY_AMPERSAND', 'Ampersand'], ['KEY_APOSTROPHE', 'Apostrophe'],
  ['KEY_PARENLEFT', 'ParenLeft'], ['KEY_PARENRIGHT', 'ParenRight'],
  ['KEY_ASTERISK', 'Asterisk'], ['KEY_PLUS', 'Plus'], ['KEY_COMMA', 'Comma'],
  ['KEY_MINUS', 'Minus'], ['KEY_PERIOD', 'Period'], ['KEY_SLASH', 'Slash'],
  ['KEY_COLON', 'Colon'], ['KEY_SEMICOLON', 'Semicolon'], ['KEY_LESS', 'Less'],
  ['KEY_EQUAL', 'Equal'], ['KEY_GREATER', 'Greater'], ['KEY_QUESTION', 'Question'],
  ['KEY_AT', 'At'], ['KEY_BRACKETLEFT', 'BracketLeft'], ['KEY_BACKSLASH', 'BackSlash'],
  ['KEY_BRACKETRIGHT', 'BracketRight'], ['KEY_ASCIICIRCUM', 'AsciiCircum'],
  ['KEY_UNDERSCORE', 'UnderScore'], ['KEY_QUOTELEFT', 'QuoteLeft'],
  ['KEY_BRACELEFT', 'BraceLeft'], ['KEY_BAR', 'Bar'], ['KEY_BRACERIGHT', 'BraceRight'],
  ['KEY_ASCIITILDE', 'AsciiTilde'], ['KEY_YEN', 'Yen'], ['KEY_SECTION', 'Section'],
] as const;
const GODOT4_KEY_NAMES = new Map<number, string>();
for (const [constant, text] of GODOT4_KEY_TEXT) {
  const keycode = GODOT4_GLOBAL_CONSTANTS[constant as keyof typeof GODOT4_GLOBAL_CONSTANTS];
  if (typeof keycode === 'number') GODOT4_KEY_NAMES.set(keycode, text);
}
const GODOT3_KEY_NAMES = new Map<number, string>();
for (const [constant, text] of GODOT4_KEY_TEXT) {
  const godot3Name = constant === 'KEY_CTRL' ? 'KEY_CONTROL' : constant;
  if (!Object.hasOwn(GODOT3_GLOBAL_CONSTANTS, godot3Name)) continue;
  const label = constant === 'KEY_BACKTAB' ? 'BackTab'
    : constant === 'KEY_BACKSPACE' ? 'BackSpace'
      : constant === 'KEY_CTRL' ? 'Control'
        : text;
  const keycode = GODOT3_GLOBAL_CONSTANTS[godot3Name as keyof typeof GODOT3_GLOBAL_CONSTANTS];
  if (typeof keycode === 'number') GODOT3_KEY_NAMES.set(keycode, label);
}
for (const [constant, text] of GODOT3_ONLY_KEY_TEXT) {
  const keycode = GODOT3_GLOBAL_CONSTANTS[constant as keyof typeof GODOT3_GLOBAL_CONSTANTS];
  if (typeof keycode === 'number') GODOT3_KEY_NAMES.set(keycode, text);
}

/** Godot 4 `OS.get_keycode_string`, including the Key modifier-mask spelling/order. */
export function godotOsGetKeycodeString(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('OS.get_keycode_string requires a non-negative integer Key value.');
  }
  const keycode = value as number;
  const code = keycode & GODOT4_KEY_CODE_MASK;
  let name = GODOT4_KEY_NAMES.get(code);
  if (name === undefined && code >= 4194332 && code <= 4194366) name = `F${code - 4194331}`;
  if (name === undefined && code > 0 && code <= 0x10ffff) name = String.fromCodePoint(code);
  if (name === undefined) name = '';
  const modifiers: string[] = [];
  if ((keycode & (1 << 28)) !== 0) modifiers.push('Ctrl');
  if ((keycode & (1 << 26)) !== 0) modifiers.push('Alt');
  if ((keycode & (1 << 25)) !== 0) modifiers.push('Shift');
  if ((keycode & (1 << 27)) !== 0) modifiers.push('Meta');
  return [...modifiers, name].filter((part) => part.length > 0).join('+');
}

function keycodeFromString(value: unknown, godotMajor: GodotPlatformMajor): number {
  const text = string(value, godotMajor === 3 ? 'find_scancode_from_string' : 'find_keycode_from_string');
  const parts = text.split('+').map((part) => part.trim()).filter((part) => part.length > 0);
  const keyName = parts.pop() ?? '';
  const names = godotMajor === 3 ? GODOT3_KEY_NAMES : GODOT4_KEY_NAMES;
  let code = [...names].find(([, name]) => name.toLowerCase() === keyName.toLowerCase())?.[0];
  const functionKey = /^f(\d{1,2})$/iu.exec(keyName);
  if (code === undefined && functionKey !== null) {
    const index = Number(functionKey[1]);
    const maximum = godotMajor === 3 ? 36 : 35;
    if (index >= 1 && index <= maximum) code = (godotMajor === 3 ? 16777243 : 4194331) + index;
  }
  if (code === undefined && /^[a-z0-9]$/iu.test(keyName)) {
    code = keyName.toUpperCase().codePointAt(0);
  }
  if (code === undefined) return 0;
  for (const modifier of parts) {
    const normalized = modifier.toLowerCase();
    if (normalized === 'shift') code |= godotMajor === 3 ? 1 << 25 : 1 << 24;
    else if (normalized === 'alt') code |= godotMajor === 3 ? 1 << 26 : 1 << 25;
    else if (normalized === 'meta' || normalized === 'command') code |= godotMajor === 3 ? 1 << 27 : 1 << 26;
    else if (normalized === 'control' || normalized === 'ctrl') code |= godotMajor === 3 ? 1 << 28 : 1 << 27;
    else return 0;
  }
  return code;
}

export const godotOsFindScancodeFromString = (value: unknown): number => keycodeFromString(value, 3);
export const godotOsFindKeycodeFromString = (value: unknown): number => keycodeFromString(value, 4);

function delayDuration(value: unknown, member: string, millisecondsPerUnit: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) {
    throw new RangeError(`OS.${member} requires a non-negative uint32 duration.`);
  }
  if (typeof performance === 'undefined') {
    throw new Error(`godot-compat: OS.${member} requires the browser/worker monotonic clock.`);
  }
  const deadline = performance.now() + (value as number) * millisecondsPerUnit;
  while (performance.now() < deadline) {
    // Godot's delay methods are synchronous. A bounded monotonic spin is the browser equivalent;
    // yielding to a timer would change the source method into an asynchronous operation.
  }
}

export const godotOsDelayUsec = (value: unknown): void =>
  delayDuration(value, 'delay_usec', 1 / 1_000);
export const godotOsDelayMsec = (value: unknown): void =>
  delayDuration(value, 'delay_msec', 1);

/** Godot Web has no stable hardware identifier and its native contract returns an empty String. */
export const godotOsGetUniqueId = (): string => '';

let retainedExitCode = 0;

export function godotOsSetExitCode(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < -0x80000000 || (value as number) > 0x7fffffff) {
    throw new RangeError('OS.exit_code requires a signed 32-bit integer.');
  }
  retainedExitCode = value as number;
}

export const godotOsGetExitCode = (): number => retainedExitCode;

/** Godot 3's legacy OS conversion is the same UTC Dictionary protocol now owned by Time. */
export const godotOsGetDatetimeFromUnixTime = (value: unknown): GodotDateTimeDictionary =>
  godotTimeGetDatetimeDictFromUnixTime(value);

/** Browser exports expose the Unix wall clock in integral milliseconds. */
export const godotOsGetSystemTimeMsecs = (): number => Date.now();

/** The Web target reports -1 when the browser exposes no monitor refresh-rate authority. */
export function godotOsGetScreenRefreshRate(screenIndex = -1): number {
  if (!Number.isSafeInteger(screenIndex)) {
    throw new TypeError('OS.get_screen_refresh_rate requires an integer screen index.');
  }
  return -1;
}

/** A non-threaded Web export has one stable engine thread identity. */
export const godotOsGetMainThreadId = (): number => 1;
export const godotOsGetThreadCallerId = (): number => 1;

export function godotOsGetStaticMemoryUsage(): number {
  const memory = typeof performance === 'undefined'
    ? undefined
    : (performance as Performance & { readonly memory?: { readonly usedJSHeapSize?: number } }).memory;
  const bytes = memory?.usedJSHeapSize;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('OS.get_static_memory_usage is unavailable because this browser does not expose live heap usage.');
  }
  return bytes;
}

/** The browser filesystem backend exposes the project-owned persistent namespace as user://. */
export function godotOsGetUserDataDir(): string {
  return 'user://';
}

function renderingAdapterString(member: string, debugName: 'UNMASKED_RENDERER_WEBGL' | 'UNMASKED_VENDOR_WEBGL', fallback: 'RENDERER' | 'VENDOR'): string {
  const canvas = browserDocument(member).createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) throw new Error(`RenderingServer.${member} requires a browser WebGL context.`);
  const debug = gl.getExtension('WEBGL_debug_renderer_info') as Record<typeof debugName, number> | null;
  const parameter = debug?.[debugName] ?? gl[fallback];
  const value = gl.getParameter(parameter);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`RenderingServer.${member} did not receive an adapter string from WebGL.`);
  }
  return value;
}

export const godotRenderingServerGetVideoAdapterName = (): string =>
  renderingAdapterString('get_video_adapter_name', 'UNMASKED_RENDERER_WEBGL', 'RENDERER');

export const godotRenderingServerGetVideoAdapterVendor = (): string =>
  renderingAdapterString('get_video_adapter_vendor', 'UNMASKED_VENDOR_WEBGL', 'VENDOR');

export function godotRenderingServerSetDefaultClearColor(
  input: { setDefaultClearColor(color: ColorValue): void },
  value: unknown,
): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('RenderingServer.set_default_clear_color requires Color.');
  }
  const color = value as Partial<ColorValue>;
  if (![color.r, color.g, color.b, color.a].every((channel) => typeof channel === 'number' && Number.isFinite(channel))) {
    throw new TypeError('RenderingServer.set_default_clear_color requires finite Color channels.');
  }
  input.setDefaultClearColor(color as ColorValue);
}

/**
 * Godot 3 drains VisualServer's cross-thread command queue before `sync()` returns. The browser
 * backend mutates its retained Three/Pixi objects synchronously, so the call boundary is already
 * that same completed synchronization point.
 */
export function godotVisualServerSync(): void {
  // No queued renderer commands exist behind this single-threaded backend.
}

/** Godot 3's stronger forced flush reaches the same already-synchronous browser renderer state. */
export function godotVisualServerForceSync(): void {
  godotVisualServerSync();
}

/** Three/WebGL has no SDFGI allocation, so this global quality toggle has no native work to do. */
export function godotRenderingServerGiSetUseHalfResolution(enabled: unknown): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('RenderingServer.gi_set_use_half_resolution requires bool.');
  }
}


export function godotOsHasFeature(feature: unknown, engineMajor: unknown): boolean {
  const name = string(feature, 'has_feature');
  const version = major(engineMajor);
  // Godot 3.6's JavaScript export uses the platform name as a feature and its
  // ordinary release template is the non-GDNative wasm build. Godot 4.7's Web
  // release template instead exposes the lowercase identifier and template
  // tags; its Web platform also owns the UA-derived feature tags below.
  const features = version === 3
    ? new Set(['HTML5', 'web', 'release', 'standalone', '32', 'wasm'])
    : new Set([
      'web',
      'template',
      'template_release',
      'release',
      'single',
      '32',
      'wasm32',
      'wasm',
      'web_noextensions',
    ]);
  if (version === 4 && typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    if (/android/.test(userAgent)) features.add('web_android');
    else if (
      /iphone|ipad|ipod/.test(userAgent) ||
      (/mac/.test(platform) && navigator.maxTouchPoints > 1)
    ) features.add('web_ios');
    else if (/mac/.test(platform)) features.add('web_macos');
    else if (/win/.test(platform)) features.add('web_windows');
    else if (/linux|bsd/.test(platform)) features.add('web_linuxbsd');
  }
  return features.has(name);
}

export function godotOsShellOpen(uri: unknown): number {
  const target = string(uri, 'shell_open');
  if (typeof window === 'undefined') {
    throw new Error('godot-compat: OS.shell_open requires a browser Window.');
  }
  window.open(target, '_blank');
  return 0;
}

export const godotOsGetCmdlineArgs = (): PackedArrayValue<string> => godotBrowserCommandLine();
/** Godot 4's arguments after `--`; a browser export has no process command line. */
export const godotOsGetCmdlineUserArgs = (): PackedArrayValue<string> => godotBrowserCommandLine();
export const godotOsIsDebugBuild = (): boolean => false;

/** Logical processor count exposed by the browser host. Browsers may privacy-cap this value; that
 * capped native value is the Web platform fact available to an exported game. */
export function godotOsGetProcessorCount(): number {
  if (typeof navigator === 'undefined' || !Number.isSafeInteger(navigator.hardwareConcurrency) || navigator.hardwareConcurrency < 1) {
    return 1;
  }
  return navigator.hardwareConcurrency;
}
/** Godot 3's OS binding is uint32 and intentionally wraps after roughly 49.7 days. */
export const godotOsGetTicksMsec = (): number => godotTimeGetTicksMsec() >>> 0;
export const godotOsGetTicksUsec = (): number => godotTimeGetTicksUsec();
export const godotOsGetUnixTime = (): number => Math.floor(godotTimeGetUnixTimeFromSystem());

export function godotOsGetLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  return (navigator.language || 'en').replace('-', '_');
}

export function godotOsGetLocaleLanguage(): string {
  return godotOsGetLocale().split('_')[0] ?? '';
}

/** Emscripten's browser export exposes no host environment variables to game scripts. */
export function godotOsHasEnvironment(variable: unknown): boolean {
  return retainedEnvironment.has(string(variable, 'has_environment'));
}

export function godotOsGetEnvironment(variable: unknown): string {
  return retainedEnvironment.get(string(variable, 'get_environment')) ?? '';
}

const retainedEnvironment = new Map<string, string>();

export function godotOsSetEnvironment(variable: unknown, value: unknown): void {
  const name = string(variable, 'set_environment');
  if (name.length === 0 || name.includes('=')) throw new Error('OS.set_environment requires a non-empty variable name without =.');
  retainedEnvironment.set(name, string(value, 'set_environment'));
}

export function godotOsUnsetEnvironment(variable: unknown): void {
  retainedEnvironment.delete(string(variable, 'unset_environment'));
}

export function godotOsGetDatetime(utc = false): GodotDateTimeDictionary {
  return godotTimeGetDatetimeDictFromSystem(utc);
}

export function godotOsGetDate(utc = false): GodotDateTimeDictionary {
  return godotTimeGetDateDictFromSystem(boolean(utc, 'get_date'));
}

export function godotOsGetTime(utc = false): GodotDateTimeDictionary {
  return godotTimeGetTimeDictFromSystem(utc);
}

export function godotOsGetTimeZoneInfo(): GodotDateTimeDictionary {
  return godotTimeGetTimeZoneFromSystem();
}

/** Cryptographically secure entropy from the Web Crypto owner. */
export function godotOsGetEntropy(size: number): PackedArrayValue<number> {
  if (!Number.isSafeInteger(size) || size < 0 || size > 256) {
    throw new RangeError('OS.get_entropy requires a byte count from 0 through 256.');
  }
  const cryptoOwner = globalThis.crypto;
  if (cryptoOwner === undefined) throw new Error('OS.get_entropy requires the Web Crypto API.');
  const bytes = new Uint8Array(size);
  cryptoOwner.getRandomValues(bytes);
  return packedByteArray(bytes);
}

/** Browsers own their trust store and intentionally do not expose its certificates. */
export function godotOsGetSystemCaCertificates(): string {
  return '';
}

let lowProcessorUsageMode = false;
let lowProcessorUsageSleepUsec = 6900;
let deltaSmoothing = true;
let restartOnExit = false;
let restartArguments: PackedStringArray = packedStringArray();

export function godotOsSetLowProcessorUsageMode(enabled: unknown): void {
  lowProcessorUsageMode = boolean(enabled, 'set_low_processor_usage_mode');
}

export function godotOsIsInLowProcessorUsageMode(): boolean {
  return lowProcessorUsageMode;
}

export function godotOsSetLowProcessorUsageModeSleepUsec(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('OS.low_processor_usage_mode_sleep_usec requires a non-negative integer.');
  }
  lowProcessorUsageSleepUsec = value;
}

export function godotOsGetLowProcessorUsageModeSleepUsec(): number {
  return lowProcessorUsageSleepUsec;
}

export function godotOsSetDeltaSmoothing(enabled: unknown): void {
  deltaSmoothing = boolean(enabled, 'set_delta_smoothing');
}

export function godotOsIsDeltaSmoothingEnabled(): boolean {
  return deltaSmoothing;
}

export function godotOsGetDistributionName(): string {
  return 'Web';
}

export function godotOsGetVersion(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent;
}

export function godotOsGetVersionAlias(): string {
  return 'web';
}

export function godotOsGetModelName(): string {
  if (typeof navigator === 'undefined') return 'Web';
  const nav = navigator as Navigator & { readonly userAgentData?: { readonly platform?: string } };
  return nav.userAgentData?.platform || navigator.platform || 'Web';
}

export function godotOsIsUserfsPersistent(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function godotOsIsSandboxed(): boolean {
  return true;
}

export function godotOsGetConfigDir(): string {
  return 'user://';
}

export function godotOsGetDataDir(): string {
  return 'user://';
}

export function godotOsGetCacheDir(): string {
  return 'user://cache';
}

export function godotOsGetTempDir(): string {
  return 'user://tmp';
}

export function godotOsSetRestartOnExit(enabled: unknown, argumentsValue: Iterable<unknown> = []): void {
  restartOnExit = boolean(enabled, 'set_restart_on_exit');
  restartArguments = packedStringArray(argumentsValue);
}

export function godotOsIsRestartOnExitSet(): boolean {
  return restartOnExit;
}

export function godotOsGetRestartOnExitArguments(): PackedStringArray {
  return packedStringArray(restartArguments);
}

export function godotOsGetProcessId(): number {
  return 1;
}

export function godotOsIsStdoutVerbose(): boolean {
  return false;
}

export function godotOsGetStaticMemoryPeakUsage(): number {
  return godotOsGetStaticMemoryUsage();
}

export function godotOsGetMemoryInfo(): Readonly<Record<string, number>> {
  const physical = godotOsGetStaticMemoryUsage();
  return { physical, free: 0, available: 0, stack: 0 };
}

export function godotOsIsKeycodeUnicode(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0x20 && value <= 0x10ffff;
}

export function godotOsSetThreadName(value: unknown): number {
  string(value, 'set_thread_name');
  return 0;
}

export function godotOsGetGrantedPermissions(): PackedStringArray {
  return packedStringArray();
}

export function godotOsRequestPermission(permission: unknown): boolean {
  string(permission, 'request_permission');
  return false;
}

export function godotOsRequestPermissions(): boolean {
  return false;
}

export function godotOsRevokeGrantedPermissions(): void {
  // Browser permission grants remain owned by the user agent.
}

export const godotOsGetStdinType = (): number => 0;
export const godotOsGetStdoutType = (): number => 1;
export const godotOsGetStderrType = (): number => 1;

export function godotOsGetVideoAdapterDriverInfo(): PackedStringArray {
  return packedStringArray([godotRenderingServerGetVideoAdapterVendor(), godotRenderingServerGetVideoAdapterName()]);
}

export function godotOsOpenWithProgram(path: unknown, programPath: unknown, argumentsValue: Iterable<unknown> = []): number {
  const target = string(path, 'open_with_program');
  const program = string(programPath, 'open_with_program');
  const args = [...argumentsValue].map((value) => string(value, 'open_with_program'));
  if ((program !== '' && program !== target) || args.length > 0) {
    throw new Error('OS.open_with_program cannot choose a native executable or pass arguments from a sandboxed browser tab.');
  }
  return godotOsShellOpen(target);
}

export function godotOsShellShowInFileManager(path: unknown, openFolder = true): number {
  boolean(openFolder, 'shell_show_in_file_manager');
  const target = string(path, 'shell_show_in_file_manager');
  if (/^https?:\/\//u.test(target)) return godotOsShellOpen(target);
  throw new Error('OS.shell_show_in_file_manager cannot reveal a virtual filesystem path in the host file manager.');
}
