/**
 * The host POINTER stream, in the game's own coordinate space — the DOM edge
 * `InputManager`'s touch backends (`setTouchButton` / `setTouchStick`) and any
 * pointer-position read need, and which the manager itself deliberately does
 * not own.
 *
 * `InputManager` listens on `window` for keyboard, mouse and focus, in CLIENT
 * pixels, because an action map is surface-agnostic. A pointer is not: a tap is
 * only meaningful relative to the surface it landed on, and a game's own
 * coordinate space is usually NOT that surface's CSS pixels — a fixed design
 * resolution presented by uniformly scaling and letterboxing is the common
 * case, and a hit-test against a UI rect authored in design pixels has to
 * happen in one space with the pointer. That mapping needs a surface and a
 * design size the manager has no way to know, so it lives here, beside it.
 *
 * What this owns, and nothing more:
 *
 * - **Position** — the last pointer position over the surface, mapped into the
 *   design space. `setPosition` is the headless door (a harness or a game
 *   command driving the game with no DOM), the same shape as
 *   `InputManager.addMouseDelta`: inject through the accumulator the reader
 *   already reads, never a synthetic `pointermove`.
 * - **Touches** — a per-frame queue of {@link HostPointerTouch} records with
 *   DENSE finger indices, drained by the game's own frame. `pointerId` is the
 *   browser's opaque, monotonically growing handle; a touch API that reports
 *   "finger 0 and finger 1" wants the lowest free slot, reused the moment a
 *   finger lifts, which is what {@link HostPointerTouch.index} is.
 * - **Cursor** — the CSS cursor applied to the surface, because the surface is
 *   resolved here and nowhere else.
 *
 * **Gating.** Every listener returns early unless
 * `InputManager.isInputActive()` — the SAME predicate the manager's own
 * `keydown`/`mousemove` listeners pass, so play-mode isolation and window
 * blur suppress pointer position and touches exactly as they suppress a key.
 * The predicate is read from the manager rather than recomposed here
 * (`isEnabled() && isFocused()` written out a second time is how a looser gate
 * drifts in: a blurred or typing tab kept updating a pointer position under
 * exactly that duplication). Text-entry focus is deliberately NOT part of it,
 * matching `onMouseMove` rather than `onKeyDown` — moving a finger is not
 * typing.
 *
 * **Ownership.** Owns its four pointer listeners on the resolved owner, the
 * touch queue and the finger-index table. Shares the `InputManager`, which is
 * the game's and is never mutated here — this reports; what a control DOES
 * with a finger (which rect owns it, whether that becomes a `setTouchButton`)
 * belongs to the UI that draws the control. Teardown is {@link
 * HostPointer.dispose}, and only that: `InputManager.dispose` does not reach
 * these listeners.
 *
 * Headless (no `window`): construction succeeds and binds nothing. Position is
 * whatever {@link HostPointer.setPosition} last wrote, and the touch queue
 * stays empty.
 */

import type { InputManager } from './input-manager';
import type { Vector2 } from './input-types';

/**
 * Cap on the undrained touch queue. A game that drains every frame cannot
 * reach it — this is the bound for one that never drains at all (a project
 * that reads no touches, on a device that has them), so the queue is a RING:
 * the newest records win and the oldest are dropped.
 */
const TOUCH_QUEUE_MAX = 256;

/** One finger edge the host pointer stream produced. */
export interface HostPointerTouch {
  /**
   * `'start'` when the finger went down on the surface, `'move'` while it
   * drags, `'end'` when it lifted or the browser cancelled it. A cancel is an
   * end: the finger is gone either way, and a control that treats them
   * differently is holding a button nothing will ever release.
   */
  readonly phase: 'start' | 'move' | 'end';
  /** True only when the browser ended this contact with `pointercancel`. */
  readonly canceled: boolean;
  /**
   * DENSE finger index — the lowest slot free when this finger went down, and
   * free again the moment it lifts. NOT the browser's `pointerId`, which never
   * reuses a value and is therefore useless as "which finger is this".
   */
  readonly index: number;
  /** Position in the design space (see {@link HostPointerOptions.designSize}). */
  readonly position: Vector2;
  /** Position before design-resolution scaling, in surface CSS pixels. */
  readonly screenPosition: Vector2;
  /** Delta since this contact's preceding sample, in design pixels. */
  readonly relative: Vector2;
  /** Delta since this contact's preceding sample, in surface CSS pixels. */
  readonly screenRelative: Vector2;
  /** Design-pixel velocity derived from the browser event timestamps. */
  readonly velocity: Vector2;
  /** Surface CSS-pixel velocity derived from the browser event timestamps. */
  readonly screenVelocity: Vector2;
  /** Native PointerEvent pressure in the normalized [0, 1] range. */
  readonly pressure: number;
  /** Native PointerEvent tilt, in degrees. Touch contacts normally report zero. */
  readonly tilt: Vector2;
  /** Touch pointers are never an inverted pen; retained for Godot's event value contract. */
  readonly penInverted: false;
}

/** What {@link createHostPointer} needs. */
export interface HostPointerOptions {
  /** The game's own manager — read for its gate, never written. */
  readonly input: InputManager;
  /**
   * The render surface pointer positions are relative to.
   *
   * A GETTER rather than an element because a renderer usually mints its
   * canvas after the game's services exist. Absent (or returning `null`) falls
   * back to the event's own target element, and listening falls back to
   * `window` — which is what makes a finger that starts on the canvas and
   * drags over a DOM overlay keep reporting.
   */
  readonly surface?: (() => HTMLElement | null) | undefined;
  /**
   * The game's own logical resolution, if it has one. Surface CSS pixels are
   * mapped into it, so a pointer and a UI rect authored at this size share one
   * space regardless of how the host scaled and letterboxed the surface.
   *
   * Absent: positions are reported in the surface's own CSS pixels, and the
   * position before any event is `{x: 0, y: 0}`. Present: the position before
   * any event is the CENTRE of the design space — a pointer that has never
   * moved is better described as the middle of the view than as a corner it
   * was never at.
   */
  readonly designSize?: Vector2 | undefined;
}

/** The host pointer stream bound to one surface. One per mounted game. */
export interface HostPointer {
  /** The last pointer position, in the design space. */
  getPosition(): Vector2;
  /** Headless / harness door onto {@link getPosition}'s value. */
  setPosition(position: Vector2): void;
  /**
   * Drain the touch records queued since the last call. Returns them in
   * arrival order and empties the queue, so a frame that drains sees each
   * finger edge exactly once.
   */
  takeTouches(): readonly HostPointerTouch[];
  /**
   * Set the CSS `cursor` applied to the surface. Applied on the next pointer
   * move over it, which is also when the surface is known.
   */
  setCursor(cursor: string): void;
  /** Remove the listeners this owns. */
  dispose(): void;
}

export function createHostPointer(options: HostPointerOptions): HostPointer {
  const { input, surface: surfaceOf, designSize } = options;
  let position: Vector2 = designSize
    ? { x: designSize.x / 2, y: designSize.y / 2 }
    : { x: 0, y: 0 };
  let cursor = 'default';

  const touches: HostPointerTouch[] = [];
  /** Browser `pointerId` -> dense finger index, for fingers currently down. */
  const fingerOfPointer = new Map<number, number>();
  const sampleOfPointer = new Map<
    number,
    {
      readonly position: Vector2;
      readonly screenPosition: Vector2;
      readonly timestamp: number;
    }
  >();
  const freeFinger = (): number => {
    const taken = new Set(fingerOfPointer.values());
    let index = 0;
    while (taken.has(index)) index += 1;
    return index;
  };
  const queue = (touch: HostPointerTouch): void => {
    touches.push(touch);
    if (touches.length > TOUCH_QUEUE_MAX) touches.shift();
  };

  const queueTouch = (event: PointerEvent, point: Vector2, screenPoint: Vector2): void => {
    const previous = sampleOfPointer.get(event.pointerId);
    const relative =
      previous === undefined
        ? { x: 0, y: 0 }
        : { x: point.x - previous.position.x, y: point.y - previous.position.y };
    const screenRelative =
      previous === undefined
        ? { x: 0, y: 0 }
        : {
            x: screenPoint.x - previous.screenPosition.x,
            y: screenPoint.y - previous.screenPosition.y,
          };
    const elapsedSeconds =
      previous === undefined ? 0 : Math.max(0, event.timeStamp - previous.timestamp) / 1000;
    const velocity =
      elapsedSeconds > 0
        ? { x: relative.x / elapsedSeconds, y: relative.y / elapsedSeconds }
        : { x: 0, y: 0 };
    const screenVelocity =
      elapsedSeconds > 0
        ? { x: screenRelative.x / elapsedSeconds, y: screenRelative.y / elapsedSeconds }
        : { x: 0, y: 0 };
    const common = {
      position: point,
      screenPosition: screenPoint,
      relative,
      screenRelative,
      velocity,
      screenVelocity,
      pressure: Number.isFinite(event.pressure) ? Math.max(0, Math.min(1, event.pressure)) : 0,
      tilt: {
        x: Number.isFinite(event.tiltX) ? event.tiltX : 0,
        y: Number.isFinite(event.tiltY) ? event.tiltY : 0,
      },
      penInverted: false as const,
    };
    if (event.type === 'pointerdown') {
      const index = freeFinger();
      fingerOfPointer.set(event.pointerId, index);
      sampleOfPointer.set(event.pointerId, {
        position: point,
        screenPosition: screenPoint,
        timestamp: event.timeStamp,
      });
      queue({ phase: 'start', canceled: false, index, ...common });
      return;
    }
    // A move or a release from a pointer that never went down on this surface
    // is not one of our fingers.
    const index = fingerOfPointer.get(event.pointerId);
    if (index === undefined) return;
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      fingerOfPointer.delete(event.pointerId);
      sampleOfPointer.delete(event.pointerId);
      queue({
        phase: 'end',
        canceled: event.type === 'pointercancel',
        index,
        ...common,
      });
      return;
    }
    sampleOfPointer.set(event.pointerId, {
      position: point,
      screenPosition: screenPoint,
      timestamp: event.timeStamp,
    });
    queue({ phase: 'move', canceled: false, index, ...common });
  };

  /** A client-space event as a point in the design space, via the surface rect
   *  the host actually presented it at. */
  const toDesignSpace = (event: PointerEvent, rect: DOMRect): Vector2 => {
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!designSize) return { x, y };
    return { x: (x * designSize.x) / rect.width, y: (y * designSize.y) / rect.height };
  };

  const onPointer = (event: PointerEvent): void => {
    // The manager's own gate, read from the manager. See this module's header
    // for why it is not recomposed here.
    if (!input.isInputActive()) return;
    const surface = surfaceOf?.() ?? (event.target instanceof HTMLElement ? event.target : null);
    if (surface === null) return;
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const point = toDesignSpace(event, rect);

    if (event.type === 'pointermove') {
      // Every pointer type moves the position — a stylus and a dragging finger
      // are as much "where the pointer is" as a mouse. Only the TOUCH queue is
      // touch-only.
      position = point;
      surface.style.cursor = cursor;
    }
    // A mouse or a pen is not a finger. A control that answered them here would
    // steal the clicks of a player who cannot see it.
    if (event.pointerType === 'touch') queueTouch(event, point, screenPoint);
  };

  const KINDS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
  const owner: EventTarget | null =
    typeof window === 'undefined' ? null : (surfaceOf?.() ?? window);
  if (owner !== null) {
    for (const kind of KINDS) owner.addEventListener(kind, onPointer as EventListener);
  }

  return {
    getPosition(): Vector2 {
      return position;
    },
    setPosition(next): void {
      position = { x: next.x, y: next.y };
    },
    takeTouches(): readonly HostPointerTouch[] {
      return touches.splice(0, touches.length);
    },
    setCursor(next): void {
      cursor = next;
    },
    dispose(): void {
      if (owner === null) return;
      for (const kind of KINDS) owner.removeEventListener(kind, onPointer as EventListener);
    },
  };
}
