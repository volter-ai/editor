/**
 * @godot-class RandomNumberGenerator
 * @role BINDING
 *
 * Godot 4.7's `RandomNumberGenerator` (`core/math/random_number_generator.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a PCG32 generator of its own (`random-pcg.ts`),
 * seeded from the clock as it is made (`randomize`). Its seed is kept as Godot's `uint64_t`
 * and read back as the int64 a script sees. The state (`get_state`/`set_state`) is not bound: a
 * 64-bit state does not fit a script number.
 */

import { godot_random_pcg_new, godot_random_pcg_rand, godot_random_pcg_rand_bounded, godot_random_pcg_randf, godot_random_pcg_seed, type RandomPCG } from './random-pcg';


export interface RandomNumberGenerator {
  readonly pcg: RandomPCG;
  seed: bigint;
}

/**
 * Reseeds the generator unpredictably, as Godot's clock-derived seed does
 * (`RandomPCG::randomize`, `core/math/random_pcg.cpp:42`): from the platform's random source.
 *
 * @godot RandomNumberGenerator.randomize
 * @source core/math/random_pcg.cpp:42
 */
export function randomize(self: RandomNumberGenerator): void {
  set_seed(self, globalThis.crypto.getRandomValues(new BigUint64Array(1))[0] as bigint);
}

/**
 * A generator seeded unpredictably (`RandomNumberGenerator()`, `random_number_generator.h:61`).
 *
 * @godot RandomNumberGenerator.RandomNumberGenerator
 * @source core/math/random_number_generator.h:61
 */
export function construct(): RandomNumberGenerator {
  const self: RandomNumberGenerator = { pcg: godot_random_pcg_new(), seed: 0n };
  randomize(self);
  return self;
}

/**
 * The seed as `uint64_t`.
 *
 * @godot RandomNumberGenerator.set_seed
 * @source core/math/random_number_generator.h:45
 */
export function set_seed(self: RandomNumberGenerator, seed: number | bigint): void {
  self.seed = BigInt.asUintN(64, BigInt(seed));
  godot_random_pcg_seed(self.pcg, self.seed);
}

/**
 * The `uint64_t` seed as the int64 a script reads.
 *
 * @godot RandomNumberGenerator.get_seed
 * @source core/math/random_number_generator.h:46
 */
export function get_seed(self: RandomNumberGenerator): number {
  return Number(BigInt.asIntN(64, self.seed));
}

/**
 * @godot RandomNumberGenerator.randi
 * @source core/math/random_number_generator.h:53
 */
export function randi(self: RandomNumberGenerator): number {
  return godot_random_pcg_rand(self.pcg);
}

/**
 * @godot RandomNumberGenerator.randf
 * @source core/math/random_number_generator.h:54
 */
export function randf(self: RandomNumberGenerator): number {
  return godot_random_pcg_randf(self.pcg);
}

/**
 * `RandomPCG::random(float, float)` (`random_pcg.cpp:75`): `randf() * (to - from) + from` in float.
 *
 * @godot RandomNumberGenerator.randf_range
 * @source core/math/random_number_generator.h:55
 */
export function randf_range(self: RandomNumberGenerator, from: number, to: number): number {
  const f32 = Math.fround;
  return f32(f32(randf(self) * f32(f32(to) - f32(from))) + f32(from));
}

/**
 * `RandomPCG::random(int, int)` (`random_pcg.cpp:79`).
 *
 * @godot RandomNumberGenerator.randi_range
 * @source core/math/random_number_generator.h:57
 */
export function randi_range(self: RandomNumberGenerator, from: number, to: number): number {
  const a = from | 0;
  const b = to | 0;
  if (a === b) return a;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const diff = (high - low) >>> 0;
  if (diff === 0xffffffff) return godot_random_pcg_rand(self.pcg) + low;
  return godot_random_pcg_rand_bounded(self.pcg, (diff + 1) >>> 0) + low;
}
