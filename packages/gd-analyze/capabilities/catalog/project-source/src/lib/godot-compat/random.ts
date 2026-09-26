/**
 * `randomize()`, `randi()`, `randf()`, `rand_range(a, b)` — over the engine's
 * SEEDED PRNG.
 *
 * These are GDScript GLOBAL functions, not members of any class, so no member
 * table can requisition them — and the pilot cannot run without them. Every mob
 * spawn is three draws (`Main.gd:35` `randi()`, `:44` `rand_range(-PI/4, PI/4)`,
 * `:48` `rand_range(150.0, 250.0)`) and every mob picks its walk cycle with a
 * fourth (`Mob.gd:7` `randi()`).
 *
 * ## `Math.random` is the wrong backend, and the engine already has the right one
 *
 * `@vgai/engine/core/seeded-random` is `ctx.random`: a game-scoped PRNG with NAMED
 * STREAMS, where `ctx.random()` draws from `'gameplay'` and
 * `ctx.random.stream('vfx')` is an independent generator, so a cosmetic draw
 * can never perturb the gameplay draw order. It is what makes a replay
 * reproduce and what `play.seed.set` steers. A port that reached for
 * `Math.random()` would be opting its whole game out of that, silently, for the
 * sake of one shorter line.
 *
 * So the caller passes `ctx.random` and every draw here goes through it. There
 * is no fallback to `Math.random`: a game with no PRNG supplied throws at
 * construction rather than being quietly non-deterministic, because "quietly
 * non-deterministic" is the failure this seam exists to prevent.
 *
 * ## `randomize()` is a documented NO-OP, and that is the honest answer
 *
 * Godot's `randomize()` reseeds the global PRNG from system entropy — its whole
 * purpose is to make each run differ. In this engine the SEED is owned by the
 * determinism door: the host chooses it, the manifest can declare it, and
 * `play.seed.set` overrides it so a session can be replayed. Reseeding from the
 * clock here would take that back and make a replay of a ported game
 * impossible.
 *
 * The observable behaviour a game wants from `randomize()` — "this run differs
 * from the last" — is already true, because the host chooses the seed. So
 * {@link randomize} does nothing, deliberately and loudly in the docs rather
 * than silently. It is kept as a callable so an emitter does not
 * have to special-case one global function out of three.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. **Shares:** the `SeededRandom`, which is the game's.
 * **Teardown:** none — no stream is created that the manager does not already
 * own, and nothing is subscribed.
 */

import type { SeededRandom } from '@volter/game-runtime/core/seeded-random';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

/** Godot's global random functions, bound to one PRNG. */
export interface GodotRandom {
  /**
   * `randomize()` — a deliberate no-op. See this module's header: the engine's
   * determinism door owns seeding, and reseeding from the clock here would make
   * a ported game unreplayable.
   */
  randomize(): void;
  /**
   * `randi()` — a random 32-bit UNSIGNED integer.
   *
   * Godot's is unsigned and full-width, and the pilot depends on that width in
   * two places: `Main.gd:35` writes it straight into `PathFollow2D.offset` and
   * relies on the wrap to land anywhere on the path, and `Mob.gd:7` takes it
   * modulo the animation count. A narrower or signed value changes both.
   */
  randi(): number;
  /** `randi_range(from, to)` — an integer in the inclusive range, accepting either bound order. */
  randiRange(from: number, to: number): number;
  /**
   * `randf()` — a random float in `[0, 1)`.
   *
   * `squash-the-creeps` `Main.gd:23` writes it straight into
   * `PathFollow.unit_offset`, which IS a 0..1 ratio — the 3D counterpart of the
   * 2D pilot's full-width `randi()` into `PathFollow2D.offset`. It is the
   * engine's draw unchanged, which is the whole point: the two games' spawn
   * positions come off the same seeded stream in the same number of draws.
   */
  randf(): number;
  /**
   * `rand_range(from, to)` — a random float in `[from, to)`.
   *
   * Godot's is inclusive of neither endpoint in practice (it is
   * `from + (to - from) * randf()`, and `randf()` is `[0, 1)`), which is
   * exactly what this computes.
   */
  randRange(from: number, to: number): number;
  /** Replace the Godot-compatible stream with the exact PCG32 stream for this signed seed. */
  seed(value: number | bigint): void;
  /** Godot's independent one-shot `rand_from_seed`, returning `[draw, seed]`. */
  randFromSeed(value: number | bigint): [number, bigint];
  /** Normally distributed draw using Godot's Box-Muller implementation. */
  randfn(mean?: number, deviation?: number): number;
  /** Current signed 64-bit initialization seed for a retained RandomNumberGenerator Resource. */
  getSeed(): bigint;
  /** Current raw PCG state for exact Resource duplication and Godot's state property. */
  getState(): bigint;
  /** Replace the raw PCG state without changing the initialization seed. */
  setState(value: number | bigint): void;
}

/** What {@link createRandom} needs from the game. */
export interface CreateRandomOptions {
  /**
   * The game's own PRNG — `ctx.random`. Any `() => number` in `[0, 1)` is
   * accepted, so a test can pass a fixed sequence, but a real game passes
   * `ctx.random` (or `ctx.random.stream('godot')` to keep the port's draws off
   * the default gameplay stream).
   */
  readonly random: SeededRandom | (() => number);
}

/** 2^32 — the width of Godot's `randi()`. */
const UINT32 = 0x1_0000_0000;
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;
const PCG_MULTIPLIER = 6364136223846793005n;
const PCG_DEFAULT_INC = 1442695040888963407n;

interface PcgState {
  state: bigint;
  inc: bigint;
  seed: bigint;
}

function pcg32(state: PcgState): number {
  const old = state.state;
  state.state = (old * PCG_MULTIPLIER + (state.inc | 1n)) & UINT64_MASK;
  const shifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffff_ffffn) >>> 0;
  const rotation = Number((old >> 59n) & 31n);
  return ((shifted >>> rotation) | (shifted << (-rotation & 31))) >>> 0;
}

function seededPcg(value: number | bigint): PcgState {
  const seed = BigInt.asUintN(64, BigInt(value));
  const state: PcgState = { state: 0n, inc: ((PCG_DEFAULT_INC << 1n) | 1n) & UINT64_MASK, seed };
  pcg32(state);
  state.state = (state.state + seed) & UINT64_MASK;
  pcg32(state);
  return state;
}

function pcgBounded(state: PcgState, bound: number): number {
  if (bound === UINT32) return pcg32(state);
  const width = bound >>> 0;
  const threshold = (UINT32 - width) % width;
  for (;;) {
    const value = pcg32(state);
    if (value >= threshold) return value % width;
  }
}

function leadingZeros32(value: number): number {
  return Math.clz32(value >>> 0);
}

function pcgRandd(state: PcgState): number {
  const exponent = pcg32(state);
  if (exponent === 0) return 0;
  const significand = (BigInt(pcg32(state)) << 32n) | BigInt(pcg32(state)) | 0x8000000000000001n;
  return Number(significand) * 2 ** (-64 - leadingZeros32(exponent));
}

/** Bind the globals to one PRNG. One per mounted game. */
export function createRandom(options: CreateRandomOptions): GodotRandom {
  const draw = options.random;
  if (typeof draw !== 'function') {
    throw new Error(
      "godot-compat: createRandom({ random }) needs the game's own PRNG — `ctx.random`, or any " +
        '() => number in [0, 1). There is deliberately no Math.random fallback: a port that ' +
        "silently opts out of the engine's seeded-random door cannot be replayed, and nothing " +
        'downstream would say so.',
    );
  }

  let explicit: PcgState | undefined;
  const nextUint = (): number =>
    explicit === undefined ? Math.floor(draw() * UINT32) : pcg32(explicit);
  const nextFloat = (): number =>
    explicit === undefined
      ? draw()
      : Math.fround(Math.fround(pcg32(explicit)) / Math.fround(0xffff_ffff));
  const nextDouble = (): number => (explicit === undefined ? draw() : pcgRandd(explicit));

  return {
    randomize(): void {
      // Intentionally empty — see this module's header.
    },
    randi(): number {
      return nextUint();
    },
    randiRange(from, to): number {
      const normalizedFrom = Math.trunc(from);
      const normalizedTo = Math.trunc(to);
      if (!Number.isSafeInteger(normalizedFrom) || !Number.isSafeInteger(normalizedTo)) {
        throw new RangeError(
          `RandomNumberGenerator.randi_range bounds must convert to safe integers; received ${from}, ${to}.`,
        );
      }
      const min = Math.min(normalizedFrom, normalizedTo);
      const max = Math.max(normalizedFrom, normalizedTo);
      const width = max - min + 1;
      if (!Number.isSafeInteger(width) || width <= 0) {
        throw new RangeError(
          `RandomNumberGenerator.randi_range cannot preserve the inclusive interval [${min}, ${max}].`,
        );
      }
      if (explicit !== undefined && width > 0 && width < UINT32)
        return min + pcgBounded(explicit, width);
      if (explicit !== undefined && width === UINT32) return min + pcg32(explicit);
      return min + Math.min(width - 1, Math.floor(nextFloat() * width));
    },
    randf(): number {
      return nextFloat();
    },
    randRange(from, to): number {
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new RangeError(
          `RandomNumberGenerator.randf_range bounds must be finite; received ${from}, ${to}.`,
        );
      }
      return from + (to - from) * nextDouble();
    },
    seed(value): void {
      explicit = seededPcg(value);
    },
    randFromSeed(value): [number, bigint] {
      const independent = seededPcg(value);
      return [pcg32(independent), BigInt.asIntN(64, BigInt(value))];
    },
    randfn(mean = 0, deviation = 1): number {
      let sample = nextDouble();
      if (sample < 0.00001) sample += 0.00001;
      return (
        mean + deviation * (Math.cos(Math.PI * 2 * nextDouble()) * Math.sqrt(-2 * Math.log(sample)))
      );
    },
    getSeed(): bigint {
      if (explicit === undefined) {
        throw new Error('godot-compat: the global random stream has no RandomNumberGenerator seed.');
      }
      return BigInt.asIntN(64, explicit.seed);
    },
    getState(): bigint {
      if (explicit === undefined) {
        throw new Error('godot-compat: the global random stream has no RandomNumberGenerator state.');
      }
      return BigInt.asIntN(64, explicit.state);
    },
    setState(value): void {
      if (explicit === undefined) {
        throw new Error('godot-compat: the global random stream has no RandomNumberGenerator state.');
      }
      explicit.state = BigInt.asUintN(64, BigInt(value));
    },
  };
}

export interface GodotRandomNumberGenerator extends GodotRandom {
  state: bigint;
  randi_range(from: number, to: number): number;
  randf_range(from: number, to: number): number;
  set_seed(value: number | bigint): void;
  get_seed(): bigint;
  set_state(value: number | bigint): void;
  get_state(): bigint;
}

function bindRandomNumberGenerator(
  generator: GodotRandom,
  parent: Pick<GodotRandom, 'randi' | 'randf'>,
): GodotRandomNumberGenerator {
  const resource = generator as GodotRandomNumberGenerator;
  registerGodotObjectIdentity(resource, 'RandomNumberGenerator');
  const setSeed = (value: number | bigint): void => {
    generator.seed(value);
    godotResourceEmitChanged(resource);
  };
  const setState = (value: number | bigint): void => {
    generator.setState(value);
    godotResourceEmitChanged(resource);
  };
  Object.defineProperties(resource, {
    state: {
      configurable: true,
      enumerable: false,
      get: () => generator.getState(),
      set: setState,
    },
    randi_range: { configurable: true, enumerable: false, value: generator.randiRange.bind(generator) },
    randf_range: { configurable: true, enumerable: false, value: generator.randRange.bind(generator) },
    set_seed: { configurable: true, enumerable: false, value: setSeed },
    get_seed: { configurable: true, enumerable: false, value: generator.getSeed.bind(generator) },
    set_state: { configurable: true, enumerable: false, value: setState },
    get_state: { configurable: true, enumerable: false, value: generator.getState.bind(generator) },
  });
  bindGodotResourceProtocol(resource, {
    createDuplicate(source) {
      const duplicate = createRandom({ random: () => parent.randf() });
      duplicate.seed(source.getSeed());
      duplicate.setState(source.getState());
      return bindRandomNumberGenerator(duplicate, parent);
    },
  });
  return resource;
}

/**
 * `RandomNumberGenerator.new()` as a retained Resource identity. Each instance receives its own
 * PCG state seeded deterministically from the game's existing stream, so constructing two RNGs
 * never aliases their later seed/state mutations and never escapes the host's replay seed.
 */
export function createRandomNumberGenerator(
  parent: Pick<GodotRandom, 'randi' | 'randf'>,
): GodotRandomNumberGenerator {
  const generator = createRandom({ random: () => parent.randf() });
  const seed = BigInt.asIntN(64, (BigInt(parent.randi()) << 32n) | BigInt(parent.randi()));
  generator.seed(seed);
  return bindRandomNumberGenerator(generator, parent);
}
