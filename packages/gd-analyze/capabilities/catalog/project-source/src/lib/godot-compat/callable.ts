/**
 * @godot-class Callable
 * @role PROTOCOL
 *
 * Godot 4.7's `Callable`, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Its
 * representation is a JS function: calling the Callable calls the function. Callable equality
 * (object + method, `core/variant/callable.cpp`) is not transcribed; `signal.ts` keys connections
 * by function reference until it is.
 */

/**
 * `bind(...)` returns a `CallableCustomBind` (`core/variant/callable.cpp:126`) whose call passes
 * the call's own arguments first and the bound ones after them
 * (`core/variant/callable_bind.cpp:141`); binding a bound Callable wraps it again.
 *
 * @godot Callable.bind
 * @source core/variant/callable_bind.cpp:141
 */
export function bind(
  self: (...args: never[]) => unknown,
  ...p_binds: readonly unknown[]
): (...args: readonly unknown[]) => unknown {
  const callable = self as (...args: readonly unknown[]) => unknown;
  return (...args: readonly unknown[]) => callable(...args, ...p_binds);
}

/**
 * @godot Callable.call
 * @source core/variant/callable.cpp:43
 */
export function call(self: (...args: never[]) => unknown, ...args: readonly unknown[]): unknown {
  return (self as (...values: readonly unknown[]) => unknown)(...args);
}

/**
 * @godot Callable.callv
 * @source core/variant/callable.cpp:73
 */
export function callv(self: (...args: never[]) => unknown, arguments_: readonly unknown[]): unknown {
  return (self as (...values: readonly unknown[]) => unknown)(...arguments_);
}

/**
 * The call made later, after the current work (`MessageQueue::push_callablep`): on the page, a
 * microtask, as `Object.call_deferred` is (`object.ts`). A script error aborts only this call.
 *
 * @godot Callable.call_deferred
 * @source core/variant/callable.cpp:39
 */
export function call_deferred(self: (...args: never[]) => unknown, ...args: readonly unknown[]): void {
  queueMicrotask(() => {
    try {
      (self as (...values: readonly unknown[]) => unknown)(...args);
    } catch (error) {
      console.error(error);
    }
  });
}

const METHOD_CALLABLES = new WeakMap<object, Map<string, (...args: readonly unknown[]) => unknown>>();

/**
 * `Callable(object, method)` of a script function named as a value (`body_entered.connect(_on_hit)`):
 * one function per object and method, so connecting, testing and disconnecting it name the same
 * Callable as Godot's equality does (object and method); a call calls the object's function by
 * name at that time (the most derived one, as Godot looks it up).
 *
 * @godot Callable (protocol)
 * @source core/variant/callable.cpp:392 (Callable(Object *, StringName))
 */
export function godot_callable_method(object: object, method: string): (...args: readonly unknown[]) => unknown {
  let methods = METHOD_CALLABLES.get(object);
  if (methods === undefined) {
    methods = new Map();
    METHOD_CALLABLES.set(object, methods);
  }
  let callable = methods.get(method);
  if (callable === undefined) {
    callable = (...args) => (Reflect.get(object, method) as (...values: readonly unknown[]) => unknown).apply(object, [...args]);
    methods.set(method, callable);
  }
  return callable;
}

const NATIVE_CALLABLES = new WeakMap<object, Map<string, (...args: readonly unknown[]) => unknown>>();

/**
 * `Callable(object, method)` of an engine method named as a value (`timeout.connect(queue_free)`):
 * one function per object and method, as `godot_callable_method` is, calling the method's binding
 * with the object's native entity first.
 *
 * @godot Callable (protocol)
 * @source core/variant/callable.cpp:392 (Callable(Object *, StringName))
 */
export function godot_callable_native(
  object: object,
  method: string,
  bound: (self: never, ...args: never[]) => unknown,
): (...args: readonly unknown[]) => unknown {
  let methods = NATIVE_CALLABLES.get(object);
  if (methods === undefined) {
    methods = new Map();
    NATIVE_CALLABLES.set(object, methods);
  }
  let callable = methods.get(method);
  if (callable === undefined) {
    const call = bound as (self: object, ...args: readonly unknown[]) => unknown;
    callable = (...args) => call(object, ...args);
    methods.set(method, callable);
  }
  return callable;
}
