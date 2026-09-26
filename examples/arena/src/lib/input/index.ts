/**
 * THIS GAME'S OWN INPUT — one store, its bindings read from the game's own
 * `.inputmap.json`, its devices attached by `<InputRig />` and ticked from the
 * world's own frame, and read by mechanics (`gameInput.isPressed('jump')`).
 * The session input door (`game.input.hold/tap` from `vgai eval`) reaches this
 * SAME store through the entry's `debug.input` export (`src/world.tsx`), so an
 * agent's virtual press and a human's key land in one place.
 *
 * What it answers is what this arena's map binds: keys, mouse buttons and
 * motion, gamepad buttons, axes and stick pairs, and
 * virtual actions. `touch_stick` and `test_pointer_delta` bindings read zero:
 * nothing in this game writes them.
 *
 * Resource ownership: THIS MODULE owns the store and the frame bracket's tick
 * state (module lifetime — Edit/Play remounts reuse it; `loadMap` replaces the
 * bindings). The device listeners are owned by whoever called
 * {@link attachInputDevices} — `<InputRig />`, whose unmount detaches them.
 */

interface KeyBinding {
  readonly type: 'key';
  readonly code: string;
}
interface MouseButtonBinding {
  readonly type: 'mouse_button';
  readonly button: number;
}
interface MouseMoveBinding {
  readonly type: 'mouse_move';
}
interface GamepadButtonBinding {
  readonly type: 'gamepad_button';
  readonly button: number;
}
interface GamepadAxisBinding {
  readonly type: 'gamepad_axis';
  readonly axis: number;
  readonly direction: 'positive' | 'negative';
  readonly deadzone?: number;
}
interface GamepadAxisPairBinding {
  readonly type: 'gamepad_axis_pair';
  readonly xAxis: number;
  readonly yAxis: number;
  readonly deadzone?: number;
}
interface UnwrittenBinding {
  readonly type: 'touch_stick' | 'test_pointer_delta';
  readonly sourceId: string;
}

type Binding =
  | KeyBinding
  | MouseButtonBinding
  | MouseMoveBinding
  | GamepadButtonBinding
  | GamepadAxisBinding
  | GamepadAxisPairBinding
  | UnwrittenBinding;

export type ActionValueType = 'digital' | 'vector2' | 'pointerDelta';

interface Action {
  readonly valueType: ActionValueType;
  readonly bindings: readonly Binding[];
}

interface Vector2 {
  readonly x: number;
  readonly y: number;
}

const DEFAULT_DEADZONE = 0.15;
const ZERO: Vector2 = { x: 0, y: 0 };
const BINDING_TYPES = new Set([
  'key',
  'mouse_button',
  'mouse_move',
  'gamepad_button',
  'gamepad_axis',
  'gamepad_axis_pair',
  'touch_stick',
  'test_pointer_delta',
]);

function parseMap(data: unknown, url: string): Map<string, Action> {
  const actions = (data as { actions?: unknown } | null)?.actions;
  if (!actions || typeof actions !== 'object') throw new Error(`${url}: no "actions" object`);
  const out = new Map<string, Action>();
  for (const [name, raw] of Object.entries(actions as Record<string, unknown>)) {
    const entry = raw as { valueType?: unknown; bindings?: unknown };
    const valueType = entry.valueType ?? 'digital';
    if (valueType !== 'digital' && valueType !== 'vector2' && valueType !== 'pointerDelta') {
      throw new Error(`${url}: action "${name}" has valueType ${JSON.stringify(valueType)}`);
    }
    if (!Array.isArray(entry.bindings)) throw new Error(`${url}: action "${name}" has no bindings`);
    for (const binding of entry.bindings) {
      if (!BINDING_TYPES.has((binding as { type?: string }).type ?? '')) {
        throw new Error(`${url}: action "${name}" has binding ${JSON.stringify(binding)}`);
      }
    }
    out.set(name, { valueType, bindings: entry.bindings as Binding[] });
  }
  return out;
}

function axisOn(value: number, direction: 'positive' | 'negative', deadzone: number): boolean {
  return direction === 'positive' ? value > deadzone : value < -deadzone;
}

function rescale(raw: Vector2, deadzone: number): Vector2 {
  const length = Math.hypot(raw.x, raw.y);
  if (length <= deadzone) return ZERO;
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return { x: (raw.x / length) * scaled, y: (raw.y / length) * scaled };
}

function clampUnit(value: Vector2): Vector2 {
  const length = Math.hypot(value.x, value.y);
  return length > 1 ? { x: value.x / length, y: value.y / length } : value;
}

function textEntryFocused(): boolean {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!active) return false;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range'].includes(active.type);
  return (active as HTMLElement).isContentEditable === true;
}

class GameInput {
  private actions = new Map<string, Action>();

  // Real devices. Edges accumulate between frames and are cleared by endFrame.
  private readonly keysDown = new Set<string>();
  private readonly keysJustDown = new Set<string>();
  private readonly buttonsDown = new Set<number>();
  private readonly buttonsJustDown = new Set<number>();
  private mouseDelta = { x: 0, y: 0 };
  private gamepads: Gamepad[] = [];
  private padButtonsPrev = new Set<string>();
  private padButtonsDown = new Set<string>();
  private padAxesPrev = new Map<string, number>();
  private padAxesNow = new Map<string, number>();

  // Virtual actions: the tester's and the session door's write path.
  private readonly virtualHeld = new Set<string>();
  private readonly virtualVectors = new Map<string, Vector2>();
  private tapsQueued = new Set<string>();
  private tapsActive = new Set<string>();

  async loadMap(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    this.actions = parseMap(await response.json(), url);
  }

  actionNames(): string[] {
    return [...this.actions.keys()];
  }

  getActionValueType(name: string): ActionValueType {
    return this.action(name, null).valueType;
  }

  /** A read of an action the map does not declare (or has not loaded yet — mechanics read from
   *  their first frame, before the map's fetch lands) is inert; a wrong-typed read throws. */
  private readable(name: string, expected: ActionValueType): Action | null {
    const action = this.actions.get(name);
    if (action && action.valueType !== expected) {
      throw new Error(`Input action "${name}" is ${action.valueType}, not ${expected}.`);
    }
    return action ?? null;
  }

  /** A write names an action the map declares, with its type, or throws. */
  private action(name: string, expected: ActionValueType | null): Action {
    const action = this.actions.get(name);
    if (!action) {
      throw new Error(
        `Unknown input action "${name}" — this game declares ${this.actionNames().join(', ') || 'none (its map has not loaded)'}.`,
      );
    }
    if (expected && action.valueType !== expected) {
      throw new Error(`Input action "${name}" is ${action.valueType}, not ${expected}.`);
    }
    return action;
  }

  /** Start of a frame: take the gamepads' state and promote queued taps. */
  poll(): void {
    this.tapsActive = this.tapsQueued;
    this.tapsQueued = new Set();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepads = pads.filter((pad): pad is Gamepad => pad !== null && pad.connected);
    this.padButtonsDown = new Set();
    this.padAxesNow = new Map();
    this.gamepads.forEach((pad, index) => {
      pad.buttons.forEach((button, b) => {
        if (button.pressed) this.padButtonsDown.add(`${index}:${b}`);
      });
      pad.axes.forEach((value, a) => this.padAxesNow.set(`${index}:${a}`, value));
    });
  }

  /** End of a frame: close every edge and per-frame delta it read. */
  endFrame(): void {
    this.keysJustDown.clear();
    this.buttonsJustDown.clear();
    this.mouseDelta = { x: 0, y: 0 };
    this.padButtonsPrev = this.padButtonsDown;
    this.padAxesPrev = this.padAxesNow;
    this.tapsActive.clear();
  }

  isPressed(name: string): boolean {
    const action = this.readable(name, 'digital');
    if (!action) return false;
    if (this.virtualHeld.has(name) || this.tapsActive.has(name)) return true;
    return action.bindings.some((binding) => {
      switch (binding.type) {
        case 'key':
          return this.keysDown.has(binding.code);
        case 'mouse_button':
          return this.buttonsDown.has(binding.button);
        case 'gamepad_button':
          return this.gamepads.some((_, i) => this.padButtonsDown.has(`${i}:${binding.button}`));
        case 'gamepad_axis':
          return this.gamepads.some((_, i) =>
            axisOn(this.padAxesNow.get(`${i}:${binding.axis}`) ?? 0, binding.direction, binding.deadzone ?? DEFAULT_DEADZONE),
          );
        default:
          return false;
      }
    });
  }

  isJustPressed(name: string): boolean {
    const action = this.readable(name, 'digital');
    if (!action) return false;
    if (this.tapsActive.has(name)) return true;
    return action.bindings.some((binding) => {
      switch (binding.type) {
        case 'key':
          return this.keysJustDown.has(binding.code);
        case 'mouse_button':
          return this.buttonsJustDown.has(binding.button);
        case 'gamepad_button':
          return this.gamepads.some(
            (_, i) => this.padButtonsDown.has(`${i}:${binding.button}`) && !this.padButtonsPrev.has(`${i}:${binding.button}`),
          );
        case 'gamepad_axis': {
          const deadzone = binding.deadzone ?? DEFAULT_DEADZONE;
          return this.gamepads.some((_, i) => {
            const key = `${i}:${binding.axis}`;
            return (
              axisOn(this.padAxesNow.get(key) ?? 0, binding.direction, deadzone) &&
              !axisOn(this.padAxesPrev.get(key) ?? 0, binding.direction, deadzone)
            );
          });
        }
        default:
          return false;
      }
    });
  }

  getVector2(name: string): Vector2 {
    const action = this.readable(name, 'vector2');
    if (!action) return ZERO;
    let sum = this.virtualVectors.get(name) ?? ZERO;
    for (const binding of action.bindings) {
      if (binding.type !== 'gamepad_axis_pair') continue;
      for (const pad of this.gamepads) {
        const raw = { x: pad.axes[binding.xAxis] ?? 0, y: pad.axes[binding.yAxis] ?? 0 };
        const value = rescale(raw, binding.deadzone ?? DEFAULT_DEADZONE);
        sum = { x: sum.x + value.x, y: sum.y + value.y };
      }
    }
    return clampUnit(sum);
  }

  /** This frame's mouse motion. */
  getPointerDelta(name: string): Vector2 {
    const action = this.readable(name, 'pointerDelta');
    if (!action) return ZERO;
    return action.bindings.some((binding) => binding.type === 'mouse_move') ? { ...this.mouseDelta } : ZERO;
  }

  requestPointerLock(element: HTMLElement): void {
    if (document.pointerLockElement === element) return;
    // A refused lock (no user activation, the browser's re-lock cooldown) leaves the mouse dead
    // for aiming; say so rather than fail silently.
    void Promise.resolve(element.requestPointerLock()).catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: the one channel a refused lock has — vgai status reads the console
      console.warn('[input] pointer lock refused:', error);
    });
  }

  setVirtualAction(name: string, value: boolean | Vector2): void {
    if (typeof value === 'boolean') {
      this.action(name, 'digital');
      if (value && !this.virtualHeld.has(name)) this.tapsQueued.add(name);
      if (value) this.virtualHeld.add(name);
      else this.virtualHeld.delete(name);
      return;
    }
    this.action(name, 'vector2');
    this.virtualVectors.set(name, value);
  }

  tapVirtualAction(name: string): void {
    this.action(name, 'digital');
    this.tapsQueued.add(name);
  }

  clearVirtualActions(): void {
    this.virtualHeld.clear();
    this.virtualVectors.clear();
    this.tapsQueued.clear();
  }

  /** Attach the real devices to `target`; the returned function detaches them. */
  attach(target: Window): () => void {
    const locked = () => typeof document !== 'undefined' && document.pointerLockElement !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (textEntryFocused()) return;
      if (!this.keysDown.has(event.code)) this.keysJustDown.add(event.code);
      this.keysDown.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => this.keysDown.delete(event.code);
    const onMouseDown = (event: MouseEvent) => {
      this.buttonsDown.add(event.button);
      this.buttonsJustDown.add(event.button);
    };
    const onMouseUp = (event: MouseEvent) => this.buttonsDown.delete(event.button);
    const onMouseMove = (event: MouseEvent) => {
      this.mouseDelta.x += event.movementX;
      this.mouseDelta.y += event.movementY;
    };
    // The browser delivers no keyup/mouseup while blurred or after a lock exits.
    const release = () => {
      this.keysDown.clear();
      this.buttonsDown.clear();
    };
    const onLockChange = () => {
      if (!locked()) this.buttonsDown.clear();
    };
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('mousedown', onMouseDown);
    target.addEventListener('mouseup', onMouseUp);
    target.addEventListener('mousemove', onMouseMove);
    target.addEventListener('blur', release);
    target.document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('blur', release);
      target.document.removeEventListener('pointerlockchange', onLockChange);
      release();
    };
  }
}

export const gameInput = new GameInput();

/** Project-relative URL of this game's map — the conventional path. */
export const INPUT_MAP_URL = '/inputmaps/default.inputmap.json';

let mapRequested = false;

/** Kick the map load once. Loud on failure: a game whose bindings did not
 *  load plays dead, and silence would blame the mechanic. */
export function ensureInputMap(url: string = INPUT_MAP_URL): void {
  if (mapRequested) return;
  mapRequested = true;
  void gameInput.loadMap(url).catch((error) => {
    // A transient failure must not be permanent: the next ensure retries.
    mapRequested = false;
    // biome-ignore lint/suspicious/noConsole: the one loud channel a failed binding load has — vgai status reads the console
    console.error(`[input] failed to load ${url}:`, error);
  });
}

/** Attach the real devices for as long as the caller lives (`<InputRig />`). */
export function attachInputDevices(target: Window): () => void {
  return gameInput.attach(target);
}

let taskOpen = false;

/**
 * THE FRAME BRACKET — call it once per frame, from the surface's own scheduler
 * and BEFORE anything that reads input (`useFrame(frameInput, -200)`).
 *
 * The FIRST call in a task polls the state accumulated since the last task
 * (device events and session-door writes arrive between tasks); each LATER call
 * in the same task first closes the previous one's edges, so a just-pressed
 * edge fires in exactly one step and a pointer delta is never applied twice
 * across a catch-up burst; and a task-end microtask closes the last step before
 * any input event task can land.
 */
export function frameInput(): void {
  if (taskOpen) gameInput.endFrame();
  gameInput.poll();
  if (taskOpen) return;
  taskOpen = true;
  queueMicrotask(() => {
    taskOpen = false;
    gameInput.endFrame();
  });
}

/**
 * The session input door over this store — the entry's `debug.input` export
 * (`src/world.tsx`). `actions` is a live thunk, so actions appear as soon as
 * the map finishes loading.
 */
export function inputDebugBinding(): {
  actions: () => Readonly<Record<string, string>>;
  set: (action: string, value: boolean | number | { x: number; y: number }) => void;
  clear: () => void;
  tap: (action: string) => void;
} {
  return {
    actions: () =>
      Object.fromEntries(gameInput.actionNames().map((name) => [name, gameInput.getActionValueType(name)])),
    set: (action, value) => {
      if (typeof value === 'number') {
        throw new Error(`Input action "${action}": this game has no scalar actions.`);
      }
      gameInput.setVirtualAction(action, value);
    },
    clear: () => {
      gameInput.clearVirtualActions();
    },
    tap: (action) => {
      gameInput.tapVirtualAction(action);
    },
  };
}
