/** Native Pixi pointer events projected as Godot Control signals. */

import { Container, type FederatedPointerEvent } from 'pixi.js';

import { optionalControlBinding, type ControlGuiPointerEvent } from './control-state';
import { godotMouseButtonMask, type GodotInputMapEvent } from './input';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { vec2 } from './vector2';

interface ControlSignalState {
  readonly focusEntered: SignalHandle<readonly []>;
  readonly focusExited: SignalHandle<readonly []>;
  readonly mouseExited: SignalHandle<readonly []>;
  readonly guiInput: SignalHandle<readonly [GodotInputMapEvent]>;
  readonly resized: SignalHandle<readonly []>;
  readonly leave: () => void;
  readonly down: (event: FederatedPointerEvent) => void;
  readonly up: (event: FederatedPointerEvent) => void;
  readonly move: (event: FederatedPointerEvent) => void;
}

const SIGNALS = new WeakMap<Container, ControlSignalState>();
const DOM_SIGNALS = new WeakMap<object, {
  readonly focusEntered: SignalHandle<readonly []>;
  readonly focusExited: SignalHandle<readonly []>;
  readonly mouseExited: SignalHandle<readonly []>;
  readonly guiInput: SignalHandle<readonly [GodotInputMapEvent]>;
  readonly resized: SignalHandle<readonly []>;
}>();

function godotButton(button: number): number {
  if (button === 0) return 1;
  if (button === 2) return 2;
  if (button === 1) return 3;
  return button + 1;
}

function pointerPosition(node: Container, event: FederatedPointerEvent): {
  readonly local: ReturnType<typeof vec2>;
  readonly global: ReturnType<typeof vec2>;
} {
  const global = event.global;
  const local = node.toLocal(global);
  return { local: vec2(local.x, local.y), global: vec2(global.x, global.y) };
}

function mouseButtonEvent(
  node: Container,
  event: FederatedPointerEvent,
  pressed: boolean,
  major: 3 | 4,
): GodotInputMapEvent {
  const position = pointerPosition(node, event);
  const button = godotButton(event.button);
  return {
    __godotClass: 'InputEventMouseButton',
    device: major === 4 ? 32 : 0,
    pressed,
    echo: false,
    canceled: false,
    control: event.ctrlKey,
    alt_pressed: event.altKey,
    shift_pressed: event.shiftKey,
    meta_pressed: event.metaKey,
    button_index: button,
    button_mask: godotMouseButtonMask(event.buttons),
    position: position.local,
    global_position: position.global,
    as_text: () => `Mouse Button ${String(button)}`,
  };
}

function mouseMotionEvent(
  node: Container,
  event: FederatedPointerEvent,
  major: 3 | 4,
  elapsedSeconds: number | undefined,
): GodotInputMapEvent {
  const position = pointerPosition(node, event);
  const relative = vec2(event.movementX, event.movementY);
  const velocity = elapsedSeconds === undefined || elapsedSeconds <= 0
    ? vec2(0, 0)
    : vec2(relative.x / elapsedSeconds, relative.y / elapsedSeconds);
  return {
    __godotClass: 'InputEventMouseMotion',
    device: major === 4 ? 32 : 0,
    pressed: event.buttons !== 0,
    echo: false,
    canceled: false,
    control: event.ctrlKey,
    alt_pressed: event.altKey,
    shift_pressed: event.shiftKey,
    meta_pressed: event.metaKey,
    position: position.local,
    global_position: position.global,
    relative,
    speed: velocity,
    velocity,
    button_mask: godotMouseButtonMask(event.buttons),
    as_text: () => 'Mouse Motion',
  };
}

function signals(node: Container, major: 3 | 4): ControlSignalState {
  const existing = SIGNALS.get(node);
  if (existing !== undefined) return existing;
  const mouseExited = createSignal<readonly []>();
  const guiInput = createSignal<readonly [GodotInputMapEvent]>();
  const focusEntered = createSignal<readonly []>();
  const focusExited = createSignal<readonly []>();
  const resized = createSignal<readonly []>();
  let lastMotionTimestamp: number | undefined;
  const state: ControlSignalState = {
    focusEntered,
    focusExited,
    mouseExited,
    guiInput,
    resized,
    leave: () => mouseExited.emit(),
    down: (event) => guiInput.emit(mouseButtonEvent(node, event, true, major)),
    up: (event) => guiInput.emit(mouseButtonEvent(node, event, false, major)),
    move: (event) => {
      const timestamp = event.timeStamp;
      const elapsed = lastMotionTimestamp === undefined
        ? undefined
        : (timestamp - lastMotionTimestamp) / 1000;
      lastMotionTimestamp = timestamp;
      guiInput.emit(mouseMotionEvent(node, event, major, elapsed));
    },
  };
  const binding = optionalControlBinding(node);
  if (binding === undefined) {
    throw new TypeError('Control.gui_input requires the retained Pixi Control binding.');
  }
  const priorResized = binding.state.read(binding.id).onControlResized;
  binding.state.write(binding.id, {
    onControlFocusEntered: () => focusEntered.emit(),
    onControlFocusExited: () => focusExited.emit(),
    onControlGuiInput: (event) => guiInput.emit(domInputEvent(event, major)),
    onControlResized: () => {
      priorResized?.();
      resized.emit();
    },
  });
  node.on('pointerleave', state.leave);
  node.on('pointerdown', state.down);
  node.on('pointerup', state.up);
  node.on('pointermove', state.move);
  SIGNALS.set(node, state);
  return state;
}

function domInputEvent(event: ControlGuiPointerEvent, major: 3 | 4): GodotInputMapEvent {
  const button = godotButton(event.button);
  return event.kind === 'button'
    ? {
        __godotClass: 'InputEventMouseButton',
        device: major === 4 ? 32 : 0,
        pressed: event.pressed,
        echo: false,
        canceled: false,
        control: event.ctrlPressed,
        alt_pressed: event.altPressed ?? false,
        shift_pressed: event.shiftPressed ?? false,
        meta_pressed: event.metaPressed ?? false,
        button_index: button,
        button_mask: godotMouseButtonMask(event.buttons),
        position: vec2(event.local.x, event.local.y),
        global_position: vec2(event.global.x, event.global.y),
        as_text: () => `Mouse Button ${String(button)}`,
      }
    : {
        __godotClass: 'InputEventMouseMotion',
        device: major === 4 ? 32 : 0,
        pressed: event.buttons !== 0,
        echo: false,
        canceled: false,
        control: event.ctrlPressed,
        alt_pressed: event.altPressed ?? false,
        shift_pressed: event.shiftPressed ?? false,
        meta_pressed: event.metaPressed ?? false,
        position: vec2(event.local.x, event.local.y),
        global_position: vec2(event.global.x, event.global.y),
        relative: vec2(event.movement?.x ?? 0, event.movement?.y ?? 0),
        speed: event.elapsedSeconds === undefined || event.elapsedSeconds <= 0
          ? vec2(0, 0)
          : vec2(
              (event.movement?.x ?? 0) / event.elapsedSeconds,
              (event.movement?.y ?? 0) / event.elapsedSeconds,
            ),
        velocity: event.elapsedSeconds === undefined || event.elapsedSeconds <= 0
          ? vec2(0, 0)
          : vec2(
              (event.movement?.x ?? 0) / event.elapsedSeconds,
              (event.movement?.y ?? 0) / event.elapsedSeconds,
            ),
        button_mask: godotMouseButtonMask(event.buttons),
        as_text: () => 'Mouse Motion',
      };
}

function domSignals(node: object, major: 3 | 4) {
  const existing = DOM_SIGNALS.get(node);
  if (existing !== undefined) return existing;
  const binding = optionalControlBinding(node);
  if (binding === undefined) throw new TypeError('Control signals require a retained Pixi or DOM Control identity.');
  const mouseExited = createSignal<readonly []>();
  const guiInput = createSignal<readonly [GodotInputMapEvent]>();
  const focusEntered = createSignal<readonly []>();
  const focusExited = createSignal<readonly []>();
  const resized = createSignal<readonly []>();
  const priorResized = binding.state.read(binding.id).onControlResized;
  binding.state.write(binding.id, {
    onControlFocusEntered: () => focusEntered.emit(),
    onControlFocusExited: () => focusExited.emit(),
    onControlMouseExited: () => mouseExited.emit(),
    onControlGuiInput: (event) => guiInput.emit(domInputEvent(event, major)),
    onControlResized: () => {
      priorResized?.();
      resized.emit();
    },
  });
  const state = { focusEntered, focusExited, mouseExited, guiInput, resized };
  DOM_SIGNALS.set(node, state);
  return state;
}

export function getControlFocusEnteredSignal(node: object, major: 3 | 4): GodotSignal<readonly []> {
  return (node instanceof Container ? signals(node, major) : domSignals(node, major)).focusEntered.signal;
}

export function getControlFocusExitedSignal(node: object, major: 3 | 4): GodotSignal<readonly []> {
  return (node instanceof Container ? signals(node, major) : domSignals(node, major)).focusExited.signal;
}

export function getControlMouseExitedSignal(node: object, major: 3 | 4): GodotSignal<readonly []> {
  return (node instanceof Container ? signals(node, major) : domSignals(node, major)).mouseExited.signal;
}

export function getControlGuiInputSignal(
  node: object,
  major: 3 | 4,
): GodotSignal<readonly [GodotInputMapEvent]> {
  return (node instanceof Container ? signals(node, major) : domSignals(node, major)).guiInput.signal;
}

export function getControlResizedSignal(node: object, major: 3 | 4): GodotSignal<readonly []> {
  return (node instanceof Container ? signals(node, major) : domSignals(node, major)).resized.signal;
}

/** CanvasItem.item_rect_changed for retained Control subclasses: the same real rect mutation seat. */
export function getCanvasItemRectChangedSignal(node: object, major: 3 | 4): GodotSignal<readonly []> {
  if (optionalControlBinding(node) === undefined) {
    throw new TypeError('CanvasItem.item_rect_changed requires a retained Control rect owner.');
  }
  return getControlResizedSignal(node, major);
}

export function releaseControlSignals(node: Container): void {
  const state = SIGNALS.get(node);
  if (state === undefined) return;
  node.off('pointerleave', state.leave);
  node.off('pointerdown', state.down);
  node.off('pointerup', state.up);
  node.off('pointermove', state.move);
  const binding = optionalControlBinding(node);
  if (binding !== undefined) {
    binding.state.write(binding.id, {
      onControlFocusEntered: undefined,
      onControlFocusExited: undefined,
      onControlGuiInput: undefined,
      onControlResized: undefined,
    });
  }
  SIGNALS.delete(node);
}
