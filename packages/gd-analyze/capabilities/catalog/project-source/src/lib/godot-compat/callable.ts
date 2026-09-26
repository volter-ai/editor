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
