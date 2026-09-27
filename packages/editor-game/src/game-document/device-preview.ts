/**
 * Device preview (W2c, F13 — critique O4). Chrome-device-mode-style presets
 * for the Game tab: a preset constrains the game mount to a device's CSS
 * resolution (letterboxed/centered in the panel, scaled down to fit — the
 * scale/letterbox math is `GamePanel`'s existing device-resolution path in
 * `CenterDocuments.tsx`), applies the device's DPR to the running renderers
 * (`resizeGame(w, h, dpr)` → `GameSession.resize`'s optional third arg), and
 * for phone/tablet presets:
 *
 *  - SAFE AREA — the preset carries notch/home-indicator insets. `GamePanel`
 *    draws a visual overlay (`data-testid="device-safe-area-overlay"`) and
 *    sets CSS custom properties on the game mount container
 *    (`data-testid="game-runtime-container"`), the element game canvases and
 *    react-world DOM layers mount into:
 *      --vgai-safe-area-inset-top / -right / -bottom / -left   (CSS px)
 *    Game UI reads them with `var(--vgai-safe-area-inset-top, 0px)`.
 *    Recorded choice: real `env(safe-area-inset-*)` injection is NOT
 *    possible from a same-document host (env() values come from the UA for
 *    the top-level viewport only), so the overlay + CSS vars ARE the
 *    contract here.
 *
 *  - POINTER-AS-TOUCH — mouse input reaches the game as pointer events with
 *    `pointerType: 'touch'`, emulated at the game-mount DOM boundary
 *    (`attachDeviceTouchTarget` below): a capture-phase listener on the
 *    mount container swallows mouse-typed pointer events and re-dispatches a
 *    clone with `pointerType: 'touch'` on the same target — so anything the
 *    game registered (raw canvas listeners, gated `window`/`document`
 *    listeners via `gated-globals.ts` — the clone bubbles to the real window
 *    exactly like the original would, so the T6.3 input gate still applies)
 *    sees touch. A game listening for compatibility `mouse*` events on
 *    `window` still hears them: the browser still fires them (we never
 *    `preventDefault()` the pointer event). Fidelity limits, recorded: real
 *    mobile fires compat mousedown/up AFTER a tap completes and never streams
 *    hover mousemove — here a game sees desktop-timed mouse events alongside
 *    the touch clones, so games mixing pointer handlers with mouse state get
 *    simultaneous rather than sequenced input, and hover-dependent logic that breaks on device
 *    still works in emulation. No `TouchEvent` (`touchstart`/`touchmove`)
 *    synthesis (Chrome device mode does synthesize these) — raw-touch-event
 *    games see nothing. A game capture-phase window/document pointer
 *    listener registers ahead of this seam and sees the original mouse
 *    event before the clone.
 *
 * Persistence: preset + touch override are the PROJECT settings layer's
 * `devicePreview` (`settings-store.ts` → `.vgai/settings.json`, committed):
 * the frame a game is designed for is a fact about the project, shared by
 * everyone who opens it.
 */

import { projectSettings, updateProjectSettings } from '@volter/editor-sdk/kit/settings-store';

export type DevicePresetKind = 'fit' | 'phone' | 'tablet' | 'desktop';

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface DevicePreset {
  readonly id: string;
  readonly label: string;
  readonly kind: DevicePresetKind;
  /** CSS resolution; null for the default fit-panel preset. */
  readonly width: number | null;
  readonly height: number | null;
  /** Device pixel ratio applied to the game renderers; null → host default. */
  readonly dpr: number | null;
  /** Notch/home-indicator insets in CSS px; null → no safe-area treatment. */
  readonly safeArea: SafeAreaInsets | null;
}

export const FIT_PRESET_ID = 'fit';

/** Chrome-device-mode-class presets. Insets are the real devices' values
 *  (iPhone 14: 47pt notch + 34pt home indicator; landscape rotates the notch
 *  to the sides; Android: 24dp status bar + 24dp gesture bar; iPad: 24pt
 *  status bar + 20pt home indicator). */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  {
    id: FIT_PRESET_ID,
    label: 'Fit panel',
    kind: 'fit',
    width: null,
    height: null,
    dpr: null,
    safeArea: null,
  },
  {
    id: 'iphone-portrait',
    label: 'iPhone 14 — 390×844 @3x',
    kind: 'phone',
    width: 390,
    height: 844,
    dpr: 3,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  {
    id: 'iphone-landscape',
    label: 'iPhone 14 landscape — 844×390 @3x',
    kind: 'phone',
    width: 844,
    height: 390,
    dpr: 3,
    safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
  },
  {
    id: 'android-portrait',
    label: 'Android — 412×915 @2.6x',
    kind: 'phone',
    width: 412,
    height: 915,
    dpr: 2.6,
    safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
  },
  {
    id: 'ipad-portrait',
    label: 'iPad — 820×1180 @2x',
    kind: 'tablet',
    width: 820,
    height: 1180,
    dpr: 2,
    safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
  },
  {
    id: 'desktop-1080p',
    label: 'Desktop — 1920×1080 @1x',
    kind: 'desktop',
    width: 1920,
    height: 1080,
    dpr: 1,
    safeArea: null,
  },
];

const FIT_PRESET = DEVICE_PRESETS[0] as DevicePreset;

function presetById(id: string): DevicePreset {
  return DEVICE_PRESETS.find((p) => p.id === id) ?? FIT_PRESET;
}

// --- store (house module-scope useSyncExternalStore shape) ------------------

let _preset: DevicePreset = FIT_PRESET;
/** null → auto (on for phone/tablet presets); boolean → explicit override. */
let _touchOverride: boolean | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function notify(): void {
  _version++;
  for (const fn of _listeners) fn();
}

export function subscribeDevicePreview(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export const devicePreviewVersion = (): number => _version;

export function devicePreset(): DevicePreset {
  return _preset;
}

/** Effective pointer-as-touch state: explicit override, else auto-on for
 *  phone/tablet presets. */
export function touchEmulationActive(): boolean {
  return _touchOverride ?? (_preset.kind === 'phone' || _preset.kind === 'tablet');
}

export function touchEmulationOverride(): boolean | null {
  return _touchOverride;
}

export function setDevicePreset(id: string): void {
  const next = presetById(id);
  if (next === _preset) return;
  _preset = next;
  // A new device's auto touch policy takes over; the override was a choice
  // about the PREVIOUS preset.
  _touchOverride = null;
  persist();
  notify();
}

export function setTouchEmulationOverride(enabled: boolean | null): void {
  if (enabled === _touchOverride) return;
  _touchOverride = enabled;
  persist();
  notify();
}

/** The renderer pixel ratio the active preset emulates, or `null` for the
 *  host default (`min(devicePixelRatio, 2)` — `create-runtime.ts`'s mount
 *  policy). `play-mode.ts` consults this on session boot so a preset chosen
 *  BEFORE Play still lands its DPR. */
export function deviceEmulatedPixelRatio(): number | null {
  return _preset.dpr;
}

/** The host-default pixel ratio `GamePanel` passes to restore after a preset
 *  is cleared — the same formula the runtime mounts with. */
export function hostDefaultPixelRatio(): number {
  return Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
}

// --- project persistence (the PROJECT settings layer) ----------------------

function persist(): void {
  updateProjectSettings({ devicePreview: { preset: _preset.id, touch: _touchOverride } });
}

/** Load the active project's declared preset into the store (no persist
 *  write-back) and return it — `GamePanel` calls this on mount and applies
 *  the returned preset's resolution to the shared game-resolution store. */
export function restoreDevicePresetForProject(): DevicePreset {
  const stored = projectSettings().devicePreview;
  if (stored?.preset) {
    _preset = presetById(stored.preset);
    _touchOverride = typeof stored.touch === 'boolean' ? stored.touch : null;
  } else {
    // Nothing declared for THIS project: reset module state, or a preset
    // carried over from a previously-open project would silently apply here
    // (and a later toggle would persist it under this project).
    _preset = FIT_PRESET;
    _touchOverride = null;
  }
  notify();
  return _preset;
}

// --- pointer-as-touch emulation at the game-mount DOM boundary --------------

const EMULATED_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/** Clones this module dispatched — never re-intercept our own events. */
const _synthetic = new WeakSet<Event>();

let _touchTarget: HTMLElement | null = null;
let _detach: (() => void) | null = null;

function interceptPointer(e: Event): void {
  if (!touchEmulationActive()) return;
  if (_synthetic.has(e)) return;
  if (!(e instanceof PointerEvent) || e.pointerType !== 'mouse') return;
  const target = e.target;
  if (!target) return;
  // Swallow the mouse-typed pointer event before it reaches the game (canvas
  // listeners, gated window/document listeners) …
  e.stopImmediatePropagation();
  // … and deliver the identical gesture as touch. Compat mouse events are
  // deliberately NOT suppressed (no preventDefault): a game listening for
  // window `mouse*` keeps working, exactly as on a real
  // mobile browser where compat mouse events accompany touches.
  const clone = new PointerEvent(e.type, {
    bubbles: true,
    cancelable: e.cancelable,
    composed: true,
    view: e.view,
    detail: e.detail,
    clientX: e.clientX,
    clientY: e.clientY,
    screenX: e.screenX,
    screenY: e.screenY,
    button: e.button,
    buttons: e.buttons,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    pointerId: e.pointerId,
    pointerType: 'touch',
    isPrimary: true,
    pressure: e.type === 'pointerup' || e.type === 'pointercancel' ? 0 : Math.max(e.pressure, 0.5),
    width: 20,
    height: 20,
  });
  _synthetic.add(clone);
  target.dispatchEvent(clone);
  if (clone.defaultPrevented) e.preventDefault();
}

/**
 * (Re)bind the emulation seam to the game mount container. `GamePanel`'s
 * container callback ref calls this alongside `setGameContainer`; `null`
 * detaches. Listeners are capture-phase so they run before the canvas (the
 * event target) and before any bubble listener the game installed; they
 * no-op unless {@link touchEmulationActive}.
 */
export function attachDeviceTouchTarget(el: HTMLElement | null): void {
  if (el === _touchTarget) return;
  _detach?.();
  _detach = null;
  _touchTarget = el;
  if (!el) return;
  for (const type of EMULATED_TYPES) {
    el.addEventListener(type, interceptPointer, { capture: true });
  }
  _detach = () => {
    for (const type of EMULATED_TYPES) {
      el.removeEventListener(type, interceptPointer, { capture: true });
    }
  };
}

/**
 * The detach half, keyed by the element letting go — the same ownership rule
 * as `play-mode.ts`'s `releaseGameContainer`, for the same overlap: two
 * GamePanels coexist across a close/reopen gesture, and a STALE panel's
 * cleanup calling `attachDeviceTouchTarget(null)` after the new panel
 * attached would strip the CURRENT element's listeners.
 */
export function detachDeviceTouchTarget(el: HTMLElement): void {
  if (_touchTarget !== el) return;
  attachDeviceTouchTarget(null);
}

// --- e2e state hook (house rule: assert state, never screenshot-diff) -------

function _stateForE2E() {
  return {
    presetId: _preset.id,
    presetLabel: _preset.label,
    dpr: _preset.dpr,
    safeArea: _preset.safeArea,
    touchActive: touchEmulationActive(),
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__vgaiDevicePreview'] = _stateForE2E;
}
