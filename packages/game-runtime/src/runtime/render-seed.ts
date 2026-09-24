/**
 * Deterministic `Math.random` seeding for render-control mode (I2 AC:
 * "`Math.random` is deterministically seeded/stubbed page-wide before any
 * game module executes").
 *
 * Deliberately a ZERO-IMPORT module (no `three`, no other engine file) so
 * its own evaluation is instantaneous — a render-mode entry page loads this
 * as its FIRST `<script type="module">` tag, before the tag that pulls in
 * the actual game/runtime modules. Per the HTML module-script ordering
 * rules, sibling `<script type="module">` tags without `async` execute in
 * document order, and each one's own dependency graph (here, empty) is
 * fully evaluated before the browser moves to the next tag — so calling
 * {@link maybeInstallRenderModeRandom} from this module's importer, in a
 * script tag placed before the game's own entry tag, guarantees every
 * subsequent module's top-level code (and everything it does at runtime)
 * observes the seeded generator, never the platform's real
 * cryptographically-random `Math.random`.
 *
 * This module does not decide WHETHER to seed on its own (importing it has
 * no side effect) — the caller decides, by calling
 * {@link maybeInstallRenderModeRandom} (query-param gated) or
 * {@link installDeterministicRandom} (unconditional) from a tiny bootstrap
 * entry. See `packages/engine/e2e/fixture/render-seed-entry.ts` for the
 * worked bootstrap this module is designed to be loaded from.
 */

/**
 * mulberry32 — a small, fast, deterministic 32-bit PRNG. Not cryptographic;
 * this is explicitly a determinism tool (reproducible capture), not a
 * security primitive. Returns a function with the same call signature as
 * `Math.random` (no arguments, `[0, 1)` float).
 */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Replace the global `Math.random` with a seeded, deterministic generator.
 * Idempotent to call more than once (each call re-seeds from scratch — the
 * last call wins), which matters for HMR-style re-execution the same way
 * `main.ts`'s `registerAdapterSurface` guard does elsewhere in this runtime.
 */
export function installDeterministicRandom(seed: number): void {
  Math.random = createMulberry32(seed);
}

/** Query-param name that opts a page into render-control mode (I2 AC 4: the
 *  mode must be unavailable/protected in normal production gameplay unless
 *  explicitly enabled). Shared with `render-control.ts`'s own production
 *  guard so both checks agree on the same flag. */
export const RENDER_MODE_QUERY_PARAM = 'vgai-render';
/** Optional query param to pin a specific seed (default below when absent). */
export const RENDER_SEED_QUERY_PARAM = 'vgai-seed';
const DEFAULT_RENDER_SEED = 0x9e3779b9; // golden-ratio constant — an arbitrary but fixed default

/**
 * Seed `Math.random` iff the page's URL opts into render mode
 * (`?vgai-render=1`), reading an optional `?vgai-seed=<int>` override.
 * Returns whether it seeded, purely for the caller's own diagnostics/log —
 * the bootstrap entry doesn't need to branch on it.
 */
export function maybeInstallRenderModeRandom(
  location: { search: string } = window.location,
): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get(RENDER_MODE_QUERY_PARAM) !== '1') return false;
  const seedParam = params.get(RENDER_SEED_QUERY_PARAM);
  const seed = seedParam !== null && seedParam !== '' ? Number(seedParam) : DEFAULT_RENDER_SEED;
  installDeterministicRandom(Number.isFinite(seed) ? seed : DEFAULT_RENDER_SEED);
  return true;
}
