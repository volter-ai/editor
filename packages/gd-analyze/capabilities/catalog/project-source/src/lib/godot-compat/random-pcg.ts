/**
 * @godot-class RandomPCG
 * @role PROTOCOL
 *
 * Godot 4.7's `RandomPCG` (`core/math/random_pcg.{h,cpp}` over `thirdparty/misc/pcg.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a PCG32 generator as an object, which a node's own
 * `RandomNumberGenerator` holds (`CPUParticles3D::rng`). The global generator is `global-scope.ts`'s.
 */

const U64 = (1n << 64n) - 1n;
const PCG_MULTIPLIER = 6364136223846793005n;
/** `PCG_DEFAULT_INC_64` (`thirdparty/misc/pcg.h:9`). */
const PCG_DEFAULT_INC_64 = 1442695040888963407n;
/** `RandomPCG::DEFAULT_SEED` (`core/math/random_pcg.h:60`). */
const DEFAULT_SEED = 12047754176567800795n;

/** `pcg32_random_t`: 64-bit state and increment. */
export interface RandomPCG {
  state: bigint;
  inc: bigint;
}

/** `pcg32_random_r` (`thirdparty/misc/pcg.cpp:6`): XSH RR output of the old state. */
function next(self: RandomPCG): number {
  const oldstate = self.state;
  self.state = (oldstate * PCG_MULTIPLIER + (self.inc | 1n)) & U64;
  const xorshifted = Number((((oldstate >> 18n) ^ oldstate) >> 27n) & 0xffffffffn);
  const rot = Number(oldstate >> 59n);
  return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
}

/**
 * `RandomPCG::seed` (`core/math/random_pcg.h:65`): `pcg32_srandom_r` with the default increment.
 *
 * @godot RandomPCG (protocol)
 * @source thirdparty/misc/pcg.cpp:18
 */
export function godot_random_pcg_seed(self: RandomPCG, seed: bigint | number): void {
  self.state = 0n;
  self.inc = ((PCG_DEFAULT_INC_64 << 1n) | 1n) & U64;
  next(self);
  self.state = (self.state + (BigInt(seed) & U64)) & U64;
  next(self);
}

/**
 * A generator seeded with `DEFAULT_SEED` (`RandomPCG::RandomPCG`, `random_pcg.cpp:36`).
 *
 * @godot RandomPCG (protocol)
 * @source core/math/random_pcg.cpp:36
 */
export function godot_random_pcg_new(): RandomPCG {
  const self = { state: 0n, inc: 0n };
  godot_random_pcg_seed(self, DEFAULT_SEED);
  return self;
}

/**
 * `RandomPCG::randf` (`core/math/random_pcg.h:109`): `ldexp((float)(rand() | 0x80000001), -32 -
 * clz(proto))`, the uint32 rounded to float as C++ converts it.
 *
 * @godot RandomPCG (protocol)
 * @source core/math/random_pcg.h:109
 */
export function godot_random_pcg_randf(self: RandomPCG): number {
  const proto = next(self);
  if (proto === 0) return 0;
  const bits = (next(self) | 0x80000001) >>> 0;
  return Math.fround(Math.fround(bits) * 2 ** (-32 - Math.clz32(proto)));
}
