/**
 * `lazyChainProxy` — turns an async "resolve the real object" function into
 * a synchronously-importable stand-in that supports the SAME call shape as
 * the real thing, including nested member access (`game.input.hold(...)`,
 * `editor.document.query(...)`), by recording the property-access PATH and only
 * resolving + walking it down at the point of an actual function CALL.
 *
 * This is what makes `index.ts`'s top-level `export const editor = ...` /
 * `game` / `page` work as plain values a script can `import { editor, game,
 * page } from '@volter/editor-live'` and call immediately — each call transparently
 * awaits the memoized `connect()` first.
 *
 * Limitation (by design, documented on `index.ts`'s exports too): only
 * FUNCTION-shaped access resolves through this proxy — `game.input.hold(x)`
 * works, but reading a plain data property (e.g. `game.fenceTick`) would
 * return another inert proxy, not the real number, since there is no
 * function CALL to trigger resolution. Every documented `editor`/`game`/
 * `page` member is a method, so this never bites the documented surface.
 */

type AnyFn = (...args: unknown[]) => unknown;

function isFunction(value: unknown): value is AnyFn {
  return typeof value === 'function';
}

function walk(root: unknown, path: PropertyKey[]): { thisArg: unknown; fn: unknown } {
  if (path.length === 0) return { thisArg: undefined, fn: root };
  let obj: Record<PropertyKey, unknown> = root as Record<PropertyKey, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as PropertyKey;
    obj = obj[key] as Record<PropertyKey, unknown>;
  }
  const lastKey = path[path.length - 1] as PropertyKey;
  return { thisArg: obj, fn: obj[lastKey] };
}

/**
 * `resolveRoot` is called (and its result awaited) on every terminal
 * function call reached through the returned proxy — callers typically wire
 * it to a memoized `connect()` (see `index.ts`), so repeated calls across
 * many proxy invocations still resolve only once.
 */
export function lazyChainProxy<T>(
  resolveRoot: () => Promise<unknown>,
  path: PropertyKey[] = [],
): T {
  const callableTarget = (() => {}) as unknown as object;
  return new Proxy(callableTarget, {
    get(_target, prop) {
      // Never look thenable — `await`ing a proxy (accidentally, or via a
      // generic helper checking `typeof x.then`) must not trigger resolution
      // or hang; there is no promise here, only a call-shaped stand-in.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      return lazyChainProxy(resolveRoot, [...path, prop]);
    },
    apply(_target, _thisArg, args) {
      return resolveRoot().then((root) => {
        const { thisArg, fn } = walk(root, path);
        if (!isFunction(fn)) {
          const label = path.length > 0 ? path.map(String).join('.') : '(the connected value)';
          throw new TypeError(`@volter/editor-live: ${label} is not a function on the connected session.`);
        }
        return fn.apply(thisArg, args);
      });
    },
  }) as T;
}
