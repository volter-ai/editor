/**
 * Godot's `Signal` — `connect` / `disconnect` / `emit_signal`, over `EventTarget`.
 *
 * Nine of the pilot's wirings are authored `[connection]` lines in a `.tscn`
 * and two more are signals the scripts DECLARE themselves (`Player.hit`,
 * `HUD.start_game`), so every one of them lands on this shape. Writing it
 * eleven times would be eleven chances to differ; writing it once is ~40 lines.
 *
 * **There is no signal bus and no name→signal registry.** Godot addresses a
 * signal by string (`emit_signal("hit")`, `connect("timeout", …)`) because
 * GDScript has no other way to name a member of a foreign object. TypeScript
 * does: the emitted class holds its signals as fields, so `emit_signal("hit")`
 * translates to `this.hit.emit()` and the string disappears at emission time
 * rather than being looked up at runtime. A registry here would keep the
 * stringly-typed indirection alive for no gain and cost every port its
 * compile-time check that the signal exists.
 *
 * ## `yield(obj, "signal")` is a promise, and that is the whole coroutine story
 *
 * GDScript's `yield` suspends the calling function until a signal fires
 * (`HUD.gd:14`, `:17`). That is `await` over a one-shot connection, which is
 * what {@link signalToPromise} returns. There is no scheduler, no fiber, no
 * resume stack and no state machine — the emitter marks the enclosing function
 * `async` and writes `await signalToPromise(timer.timeout)`. Godot's `yield`
 * also returns a `GDScriptFunctionState`. The retained thenable below preserves
 * its live/completed validity state while the emitted async function remains the
 * native owner of suspension and resumption.
 *
 * ## What `connect` deliberately does NOT take
 *
 * Godot's `Object.connect(signal, target, method, binds, flags)` appends
 * `binds` to the emitted arguments. **All 9 authored connections in the pilot
 * pass no binds**, so no bind support ships — a parameter with no caller is a
 * shape guessed rather than measured, and it would have to be guessed exactly
 * right (bind arguments come AFTER the signal's own, and only Godot's docs say
 * so). It is recorded as deliberately absent rather than merely missing.
 *
 * ## Resource ownership
 *
 * A signal owns ONE `EventTarget` and nothing else; whatever object exposes the
 * signal owns the signal. `connect` owns an `AbortController` per connection
 * and `disconnect()` aborts it — that is `removeEventListener`, so a
 * disconnected listener is really gone. Nothing outlives the object that
 * created it, so there is no teardown path to get wrong.
 *
 * ## `emit` is separate from `connect`, on purpose
 *
 * {@link createSignal} hands back `{ signal, emit }` and a node exposes only
 * `signal`. Godot's own engine signals are read-only to game code — nothing may
 * `emit_signal("timeout")` on a `Timer` it does not own — and keeping the
 * emitter private is what makes that true here instead of merely documented.
 */

import { godotCallableSignalIdentity, type GodotCallable } from './callable';
import { registerGodotObjectIdentity } from './object';

/** What `connect` hands back. Godot has no connection object at all (it
 *  disconnects by `(signal, target, method)` triple); this is the handle that
 *  replaces that triple, since the emitted TS has no method names to pass. */
export interface GodotConnection {
  /** Stop calling this listener. Idempotent. */
  disconnect(): void;
  /** Whether this exact connection is still active. */
  isConnected(): boolean;
}

/** Options a `connect` call may carry. */
export interface ConnectOptions {
  /**
   * Godot's `CONNECT_ONESHOT`: disconnect immediately after the first emission.
   * {@link signalToPromise} is built on it.
   */
  readonly oneShot?: boolean;
  /**
   * An `AbortSignal` that disconnects the listener when it aborts — the
   * platform's own unsubscribe, for a caller who already has one (a React
   * effect, a game teardown) and would rather not hold a connection object.
   */
  readonly signal?: AbortSignal;
  /** Original Godot connection flags, retained for Signal.get_connections(). */
  readonly flags?: number;
}

/** Godot's `Signal`, narrowed to the half a port uses. */
export interface GodotSignal<Args extends readonly unknown[]> {
  /**
   * `obj.connect("name", self, "method")` — the listener is called with the
   * signal's arguments, in the order they were emitted.
   */
  connect(
    listener: (...args: Args) => void,
    options?: ConnectOptions,
    callable?: GodotCallable,
  ): GodotConnection;
  /** Disconnect the exact callable identity used at connect time. */
  disconnect(callable: GodotCallable): void;
  /** Godot's `is_connected`: identity equality, not listener source equality. */
  isConnected(callable: GodotCallable): boolean;
  /** First-class Signal connection metadata from the same underlying slot map. */
  getConnections(): readonly { readonly callable: GodotCallable; readonly flags: number }[];
  hasConnections(): boolean;
}

/** A signal plus its private emitter. */
export interface SignalHandle<Args extends readonly unknown[]> {
  /** Hand this out. */
  readonly signal: GodotSignal<Args>;
  /** Keep this. `emit_signal("name", …)` is this call. */
  emit(...args: Args): void;
  /** Disconnect every retained callable when the owning Godot Object is freed. */
  clear(): void;
}

/**
 * Godot 3's script-visible handle for an asynchronous GDScript invocation.
 *
 * Native promises still own scheduling. This object only retains the source-visible
 * validity transition: a state is valid while its invocation is suspended and invalid
 * after it resolves or rejects. Being PromiseLike keeps emitted `await` mechanical.
 */
export class GodotGDScriptFunctionState<T> implements PromiseLike<T> {
  private valid = true;
  private readonly completedHandle = createSignal<readonly [T]>();
  readonly completed = this.completedHandle.signal;
  private readonly result: Promise<T>;

  constructor(source: PromiseLike<T>) {
    registerGodotObjectIdentity(this, 'GDScriptFunctionState');
    this.result = Promise.resolve(source).then(
      (value) => {
        this.valid = false;
        this.completedHandle.emit(value);
        return value;
      },
      (error: unknown) => {
        this.valid = false;
        throw error;
      },
    );
  }

  isValid(_extendedCheck = false): boolean {
    return this.valid;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.result.then(onfulfilled, onrejected);
  }
}

export function godotFunctionState<T>(source: PromiseLike<T>): GodotGDScriptFunctionState<T> {
  return new GodotGDScriptFunctionState(source);
}

export function godotFunctionStateIsValid(
  state: GodotGDScriptFunctionState<unknown>,
  extendedCheck = false,
): boolean {
  if (!(state instanceof GodotGDScriptFunctionState)) {
    throw new Error('godot-compat: GDScriptFunctionState.is_valid requires a function state');
  }
  return state.isValid(extendedCheck);
}

const EVENT_TYPE = 'emit';
const SIGNAL_EMITTERS = new WeakMap<object, (...args: readonly unknown[]) => void>();

export function isRetainedGodotSignal(value: unknown): value is GodotSignal<readonly unknown[]> {
  return (typeof value === 'object' || typeof value === 'function') &&
    value !== null && SIGNAL_EMITTERS.has(value as object);
}

/** A script-declared signal field retains both its public signal and its private emitter. */
export function isSignalHandle(value: unknown): value is SignalHandle<readonly any[]> {
  if (typeof value !== 'object' || value === null) return false;
  const signal = Reflect.get(value, 'signal');
  return isRetainedGodotSignal(signal) &&
    typeof Reflect.get(value, 'emit') === 'function' &&
    typeof Reflect.get(value, 'clear') === 'function';
}

/** Object.emit_signal reaches the private emitter only for a Signal minted by this compat owner. */
export function emitRetainedGodotSignal(
  signal: GodotSignal<readonly unknown[]>,
  args: readonly unknown[],
): void {
  const emit = SIGNAL_EMITTERS.get(signal as object);
  if (emit === undefined) {
    throw new Error('godot-compat: Object.emit_signal reached a Signal without a retained emitter.');
  }
  emit(...args);
}

/** One signal. See this module's header for why `emit` is not on the signal. */
export function createSignal<Args extends readonly unknown[]>(): SignalHandle<Args> {
  const target = new EventTarget();
  const connections = new Map<
    object,
    {
      readonly connection: GodotConnection;
      readonly callable?: GodotCallable;
      readonly flags: number;
      referenceCount: number;
    }
  >();
  const release = (identity: object): boolean => {
    const entry = connections.get(identity);
    if (entry === undefined) return false;
    if (entry.referenceCount > 1) {
      entry.referenceCount -= 1;
      return true;
    }
    entry.connection.disconnect();
    return true;
  };

  const signal: GodotSignal<Args> = {
      connect(listener, options, callable): GodotConnection {
        const flags = options?.flags ?? (options?.oneShot === true ? 4 : 0);
        if (!Number.isInteger(flags) || flags < 0 || (flags & ~15) !== 0) {
          throw new Error(
            `godot-compat: signal.connect received unsupported script-visible flags ${String(flags)}; ` +
              'only CONNECT_DEFERRED/PERSIST/ONE_SHOT/REFERENCE_COUNTED (1/2/4/8) exist.',
          );
        }
        const identity = callable === undefined ? listener : godotCallableSignalIdentity(callable);
        const existing = connections.get(identity);
        // Pinned Object::connect tests the NEW request's REFERENCE_COUNTED bit and increments the
        // existing slot even when that bit was absent on the original request.
        if (existing !== undefined && (flags & 8) !== 0) {
          existing.referenceCount += 1;
          return existing.connection;
        }
        if (existing !== undefined) {
          throw new Error(
            'godot-compat: signal.connect received the same callable twice. Godot rejects a ' +
              'duplicate connection unless CONNECT_REFERENCE_COUNTED is authored.',
          );
        }
        const controller = new AbortController();
        let connected = true;
        const disconnect = (): void => {
          if (!connected) return;
          connected = false;
          connections.delete(identity);
          controller.abort();
        };
        options?.signal?.addEventListener('abort', disconnect, { once: true });
        target.addEventListener(
          EVENT_TYPE,
          (event) => {
            // Godot disconnects one-shot slots BEFORE invoking them. A reference-counted slot
            // decrements one reference and survives until the final reference is released.
            if (options?.oneShot === true) release(identity);
            listener(...(event as CustomEvent<Args>).detail);
          },
          { signal: controller.signal },
        );
        const connection: GodotConnection = {
          disconnect,
          isConnected: () => connected,
        };
        connections.set(identity, {
          connection,
          ...(callable === undefined ? {} : { callable }),
          flags,
          referenceCount: 1,
        });
        return connection;
      },
      disconnect(callable): void {
        const entry = connections.get(godotCallableSignalIdentity(callable));
        if (entry === undefined) {
          throw new Error(
            'godot-compat: signal.disconnect received a callable which is not connected.',
          );
        }
        release(godotCallableSignalIdentity(callable));
      },
      isConnected(callable): boolean {
        return (
          connections.get(godotCallableSignalIdentity(callable))?.connection.isConnected() === true
        );
      },
      getConnections() {
        return [...connections.values()]
          .filter(
            (entry): entry is typeof entry & { readonly callable: GodotCallable } =>
              entry.callable !== undefined && entry.connection.isConnected(),
          )
          .map((entry) => ({ callable: entry.callable, flags: entry.flags }));
      },
      hasConnections(): boolean {
        return [...connections.values()].some((entry) => entry.connection.isConnected());
      },
  };
  const emit = (...args: Args): void => {
    target.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: args }));
  };
  SIGNAL_EMITTERS.set(signal as object, emit as (...args: readonly unknown[]) => void);
  const clear = (): void => {
    for (const entry of [...connections.values()]) entry.connection.disconnect();
  };
  return { signal, emit, clear };
}

/**
 * `yield(obj, "signal")` — a promise that resumes with Godot's signal result on its NEXT
 * emission: null for no arguments, the value for one argument, or an Array for several.
 *
 * ```ts
 * // GDScript: yield($MessageTimer, "timeout")
 * await signalToPromise(messageTimer.timeout);
 * ```
 *
 * One-shot by construction, so the listener is gone the moment it resolves and
 * an awaited signal cannot leak a listener per await. A promise that is never
 * awaited and whose signal never fires is collected with the signal itself —
 * there is no global pending-yield table for it to sit in.
 *
 * `options.signal` aborts the wait; the promise then REJECTS rather than
 * hanging forever, because a translated `yield` that silently never resumes is
 * indistinguishable from a deadlock. Godot's own `yield` has no cancellation,
 * so this is compat's addition for a host that can tear a game down mid-frame.
 */
type SignalAwaitResult<Args extends readonly unknown[]> =
  Args extends readonly [] ? null :
    Args extends readonly [infer Value] ? Value : Args;

export function signalToPromise<Args extends readonly unknown[]>(
  source: GodotSignal<Args> | SignalHandle<Args>,
  options?: { readonly signal?: AbortSignal },
): Promise<SignalAwaitResult<Args>> {
  const signal = isSignalHandle(source) ? source.signal as GodotSignal<Args> : source;
  return new Promise<SignalAwaitResult<Args>>((resolve, reject) => {
    const abort = options?.signal;
    if (abort?.aborted === true) {
      reject(new Error('godot-compat: signalToPromise was aborted before it was awaited'));
      return;
    }
    const connection = signal.connect((...args) => {
      // Godot resumes with the sole emitted argument directly; only multi-argument signals become
      // an Array. A zero-argument signal resumes with null. This matters for FunctionState's
      // `completed(result)`: callers must receive `result`, not `[result]`.
      const resumed = args.length === 0 ? null : args.length === 1 ? args[0] : args;
      resolve(resumed as SignalAwaitResult<Args>);
    }, { oneShot: true });
    abort?.addEventListener(
      'abort',
      () => {
        connection.disconnect();
        reject(new Error('godot-compat: signalToPromise was aborted while awaiting the signal'));
      },
      { once: true },
    );
  });
}
