/** Browser-backed Godot Thread and Mutex values.
 *
 * JavaScript cannot expose an OS thread to translated scene code without moving the whole object
 * graph through structured cloning. Thread therefore uses deterministic cooperative execution:
 * start invokes its Callable to completion in the current turn and retains its result or error;
 * wait_to_finish synchronously returns or rethrows it. This preserves GDScript's synchronous join
 * shape without pretending mutable Godot Objects can cross a Worker boundary or leaking a Promise
 * into source that never authored `await`.
 *
 * A Mutex protects synchronous main-thread critical sections. JavaScript run-to-completion makes
 * lock...unlock atomic so long as the section does not await. Contended lock cannot synchronously
 * block the browser event loop; it refuses loudly, while try_lock returns ERR_BUSY. This is the
 * precise browser ceiling rather than a spin lock that would deadlock rendering forever.
 */

import { GodotCallable } from './callable';
import { registerGodotObjectIdentity } from './object';

export const GODOT_OK = 0;
export const GODOT_ERR_BUSY = 44;

type ThreadCallable = GodotCallable | ((...args: readonly unknown[]) => unknown);

function invokeCallable(callable: ThreadCallable, args: readonly unknown[]): unknown {
  if (callable instanceof GodotCallable) return callable.callv(args);
  if (typeof callable === 'function') return callable(...args);
  throw new TypeError('Thread.start requires a Callable.');
}

export class GodotThread {
  private started = false;
  private alive = false;
  private result: unknown = null;
  private error: unknown;
  private didThrow = false;

  constructor() {
    registerGodotObjectIdentity(this, 'Thread');
  }

  /** Godot 4 `start(callable, priority)` and Godot 3 `start(instance, method, userdata, priority)`. */
  start(first: unknown, second?: unknown, third?: unknown, _priority?: unknown): number {
    if (this.started) {
      throw new Error('godot-compat: Thread.start called before wait_to_finish joined the prior invocation.');
    }

    let callable: ThreadCallable;
    let args: readonly unknown[];
    if (first instanceof GodotCallable) {
      callable = first;
      args = [];
    } else if (typeof first === 'function') {
      callable = (...values) => Reflect.apply(first, undefined, values);
      args = [];
    } else {
      if ((typeof first !== 'object' && typeof first !== 'function') || first === null || typeof second !== 'string') {
        throw new TypeError('Thread.start requires a Callable, or a Godot 3 object and method name.');
      }
      const candidate = (first as Record<string, unknown>)[second];
      if (typeof candidate !== 'function') {
        throw new TypeError(`Thread.start target has no callable method '${second}'.`);
      }
      callable = (...values) => candidate.apply(first, values);
      // Godot 3 always invokes the method with its userdata argument; the omitted default is NIL.
      args = [third ?? null];
    }

    this.started = true;
    this.alive = true;
    this.result = null;
    this.error = undefined;
    this.didThrow = false;
    try {
      const result = invokeCallable(callable, args);
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as { then?: unknown }).then === 'function'
      ) {
        throw new Error(
          'godot-compat: Thread callable returned a Promise; cooperative Thread execution requires a synchronous Callable.',
        );
      }
      this.result = result;
    } catch (error) {
      this.error = error;
      this.didThrow = true;
    } finally {
      this.alive = false;
    }
    return GODOT_OK;
  }

  is_started(): boolean {
    return this.started;
  }

  is_alive(): boolean {
    return this.alive;
  }

  is_active(): boolean { return this.alive; }

  wait_to_finish(): unknown {
    if (!this.started) {
      throw new Error('godot-compat: Thread.wait_to_finish called before Thread.start.');
    }
    const result = this.result;
    const error = this.error;
    try {
      if (this.didThrow) throw error;
      return result;
    } finally {
      this.started = false;
      this.alive = false;
      this.result = null;
      this.error = undefined;
      this.didThrow = false;
    }
  }
}

/** Counting semaphore for uncontended cooperative browser execution. */
export class GodotSemaphore {
  private permits = 0;

  constructor(private readonly godotMajor: 3 | 4) {
    registerGodotObjectIdentity(this, 'Semaphore');
  }

  post(count = 1): number | void {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('Semaphore.post count requires a positive integer.');
    }
    if (this.permits > Number.MAX_SAFE_INTEGER - count) {
      throw new RangeError('Semaphore.post would exceed the exact browser counter range.');
    }
    this.permits += count;
    if (this.godotMajor === 3) return GODOT_OK;
  }

  wait(): number | void {
    if (this.permits === 0) {
      throw new Error(
        'Semaphore.wait cannot block the browser main thread; a permit must be posted before the cooperative wait.',
      );
    }
    this.permits -= 1;
    if (this.godotMajor === 3) return GODOT_OK;
  }
}

let threadSafetyChecksEnabled = true;

export function setGodotThreadSafetyChecksEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Thread.set_thread_safety_checks_enabled requires bool.');
  }
  threadSafetyChecksEnabled = enabled;
  void threadSafetyChecksEnabled;
}

export class GodotMutex {
  private locked = false;

  constructor(private readonly godotMajor: 3 | 4) {
    registerGodotObjectIdentity(this, 'Mutex');
  }

  lock(): void {
    if (this.locked) {
      throw new Error(
        'godot-compat: contended Mutex.lock cannot block the browser main thread; use try_lock or keep the critical section synchronous.',
      );
    }
    this.locked = true;
  }

  try_lock(): number | boolean {
    if (this.locked) return this.godotMajor === 3 ? GODOT_ERR_BUSY : false;
    this.locked = true;
    // Godot 3 returns Error; Godot 4 changed this exact API to bool.
    return this.godotMajor === 3 ? GODOT_OK : true;
  }

  unlock(): void {
    if (!this.locked) throw new Error('godot-compat: Mutex.unlock called while the mutex is not locked.');
    this.locked = false;
  }
}

export function createGodotThread(): GodotThread {
  return new GodotThread();
}

export function createGodotMutex(godotMajor: 3 | 4): GodotMutex {
  return new GodotMutex(godotMajor);
}

export function createGodotSemaphore(godotMajor: 3 | 4): GodotSemaphore {
  return new GodotSemaphore(godotMajor);
}
