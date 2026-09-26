/**
 * The seeded-random core (T-D15.1). `ctx.random` is a game-scoped PRNG with
 * NAMED STREAMS: calling the object itself (`ctx.random()`) draws from the
 * `'gameplay'` stream; `ctx.random.stream('vfx')` (or any other name) derives
 * an INDEPENDENT generator, so a cosmetic/VFX draw can never perturb the
 * gameplay draw order — the classic replay-drift trap option B ("one
 * game-scoped PRNG only") would fall into (see the design doc's §2.a option
 * table).
 *
 * Each stream is seeded from `fnv1a(name) ^ rootSeed` — deterministic given
 * the root seed, independent of draw order across streams (drawing from
 * `'vfx'` never advances `'gameplay'`'s generator, since they are two
 * separate mulberry32 instances). `reseed(seed)` re-derives every stream
 * that has EVER been asked for via `.stream(name)` (including the implicit
 * `'gameplay'` stream `ctx.random()` itself draws from) — future draws only:
 * numbers already returned before a `reseed()` call are not (and cannot be)
 * un-returned; this matches `play.seed.set`'s documented semantics (T-D15.6).
 *
 * Deliberately reuses {@link createMulberry32} FROM `runtime/render-seed.ts`
 * (the render/capture door's own generator) rather than duplicating the
 * algorithm — `render-seed.ts` stays a zero-import module itself (this file
 * imports FROM it, never the reverse), so this is a dependency-clean
 * direction: the render/capture door and the gameplay determinism door share
 * one PRNG implementation without either depending on the other's door
 * logic (§2.a: "Kept as-is for the render/capture door only" — the two doors
 * stay orthogonal; only the generator function itself is shared).
 */

import { createMulberry32 } from '../runtime/render-seed';
import { createGameScopedSlot } from './game-scoped-slot';

/** The name `ctx.random()` (called with no `.stream(...)`) draws from. */
export const GAMEPLAY_STREAM = 'gameplay';

/** The fixed fallback seed a `SeededRandom` boots with when no explicit seed
 *  is supplied (mirrors `render-seed.ts`'s own `DEFAULT_RENDER_SEED` in
 *  spirit — an arbitrary but fixed golden-ratio-derived constant, never
 *  wall-clock/`Math.random`-derived, so an UNDECLARED project's `ctx.random`
 *  is still perfectly reproducible on its own terms even though nothing in
 *  the manifest asked for that — it just isn't a documented CONTRACT until
 *  `determinism.seededRandom` is declared, per T4.1's "no dead field" rule). */
export const DEFAULT_SEEDED_RANDOM_SEED = 0x9e3779b9;

/**
 * A game-scoped random surface.
 * Callable (draws from the `'gameplay'` stream), plus:
 * - `stream(name)` — an independent named generator, `[0, 1)` floats, same
 *   call signature as `Math.random`/the bare `SeededRandom` call itself.
 * - `reseed(seed)` — re-derive every stream ever requested so far (future
 *   draws only) from a NEW root seed.
 * - `seed` — the CURRENT root seed (reflects the last `reseed()` call, if
 *   any) — a live getter, not a value snapshotted at construction.
 */
export interface SeededRandom {
  (): number;
  stream(name: string): () => number;
  reseed(seed: number): void;
  readonly seed: number;
}

/** fnv1a-32, the standard non-cryptographic string hash — used only to mix a
 *  stream NAME into the root seed, never as a determinism primitive on its
 *  own (mulberry32 is still what actually produces the `[0,1)` sequence). */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface StreamBox {
  /** Reassigned wholesale on `reseed()` — the wrapper function `.stream(name)`
   *  returns to callers stays the SAME identity forever; only what it reads
   *  from changes, which is what makes reseed observable through a handle a
   *  caller obtained long before the reseed call. */
  gen: () => number;
}

/**
 * Construct a fresh, game-scoped seeded-random surface. `initialSeed` is
 * coerced to an unsigned 32-bit integer the same way `render-seed.ts`'s
 * `installDeterministicRandom` does (`>>> 0`), so any finite JS number is
 * accepted.
 */
export function createSeededRandom(initialSeed: number): SeededRandom {
  let rootSeed = initialSeed >>> 0;
  const streams = new Map<string, StreamBox>();

  function deriveStreamSeed(name: string): number {
    return (fnv1a32(name) ^ rootSeed) >>> 0;
  }

  function getBox(name: string): StreamBox {
    let box = streams.get(name);
    if (!box) {
      box = { gen: createMulberry32(deriveStreamSeed(name)) };
      streams.set(name, box);
    }
    return box;
  }

  function streamFn(name: string): () => number {
    const box = getBox(name);
    return () => box.gen();
  }

  const random = (() => getBox(GAMEPLAY_STREAM).gen()) as SeededRandom;

  Object.defineProperties(random, {
    stream: { value: streamFn, enumerable: true },
    reseed: {
      value: (seed: number) => {
        rootSeed = seed >>> 0;
        // Re-derive every stream ANYONE has ever asked for (including the
        // implicit 'gameplay' stream, once `random()` or
        // `.stream('gameplay')` has been called at least once) — a handle a
        // caller stashed before this call keeps its identity but now reads
        // from the freshly-seeded generator on its NEXT call (future draws
        // only, per the design doc's `play.seed.set` semantics).
        for (const [name, box] of streams) {
          box.gen = createMulberry32(deriveStreamSeed(name));
        }
      },
      enumerable: true,
    },
    seed: {
      get: () => rootSeed,
      enumerable: true,
    },
  });

  return random;
}

// ---------------------------------------------------------------------------
// Game-scoped registry — mirrors `editor-game/src/runtime/debug-registry.ts`'s
// `registerDebugRegistry`/`getDebugRegistry` game-slot pattern exactly, but
// keyed on a bare `object` (not `Game`) so this module never needs to import
// `editor-game/src/runtime/game.ts` even as a type — `core/` stays independent of `runtime/`
// except for the one explicit, documented `render-seed.ts` reuse above.
// `createGame` (`editor-game/src/runtime/game.ts`) is the one real registrant, passing itself
// (the `GameInternal` shell) as the key, exactly like it does for
// `registerDebugRegistry(gameInternal, debugRegistry)`.
// ---------------------------------------------------------------------------

const registryByOwner = createGameScopedSlot<SeededRandom>('seeded-random');

/** Called once by `createGame`, right after both the seeded-random surface
 *  and the Game shell object exist — mirrors `registerDebugRegistry`. */
export function registerSeededRandom(owner: object, random: SeededRandom): void {
  registryByOwner.set(owner, random);
}

/** The game-scoped `SeededRandom` backing every world's `ctx.random` — `null`
 *  for an owner built without one (there is always one for every real
 *  `createGame` call; `null` only for a hand-built `Game`-shaped stand-in a
 *  test constructs without going through `createGame`). */
export function getSeededRandom(owner: object): SeededRandom | null {
  return registryByOwner.get(owner) ?? null;
}
