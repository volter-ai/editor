/**
 * `AdapterSurface` — the kinds of render surface a world can be (T7.1/T7.3/T6.2).
 *
 * Moved here from `runtime/game.ts`
 * so `adapter/root-adapter.ts`'s kind-tagged `MountedRoot` types can name it
 * without a value-level import cycle (`runtime/game.ts` type-imports from
 * `adapter/root-adapter.ts` already). This is a leaf module — it imports
 * nothing — so anything may import it with zero risk of a cycle.
 * `runtime/game.ts` re-exports this SAME type (`export type { AdapterSurface }`),
 * so no existing `import type { AdapterSurface } from '@vgai/game-runtime/runtime/game'` call site
 * needed to change.
 */
export type AdapterSurface = 'three' | 'canvas' | 'dom';

/**
 * Exhaustiveness guard for `AdapterSurface` dispatch (v4 architecture-review
 * §7.4-2: a hypothetical 4th kind must fail to COMPILE at every kind-dispatch
 * site, not silently contribute nothing or silently default to an existing
 * kind). Lives here — colocated with the kind vocabulary itself, not in a
 * generic util module — so the three call sites that need it
 * (`runtime/create-runtime.ts`'s mount loop, `editor/binding-resolver.ts`'s
 * `resolveAllRoots`, `editor/play-mode.ts`'s `installMultiRootAuthoring`)
 * import it from the same leaf module that defines `AdapterSurface`, keeping the
 * type and its guard from drifting apart. The `never` parameter is the
 * compile-time half of the guard (TS refuses to call this with anything the
 * compiler hasn't already narrowed to zero remaining variants); the thrown
 * Error is the runtime half, in case a value's static type lied (e.g. data
 * crossing a JSON boundary).
 */
export function assertNever(value: never, context?: string): never {
  throw new Error(
    `Unreachable${context ? ` ${context}` : ''}: unexpected value ${JSON.stringify(value)}`,
  );
}
