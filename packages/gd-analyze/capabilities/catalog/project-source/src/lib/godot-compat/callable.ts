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
