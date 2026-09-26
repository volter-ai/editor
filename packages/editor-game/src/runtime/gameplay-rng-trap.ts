/**
 * The dev-mode `Math.random` phase trap (enforcer 3, T-D15.3). A project that
 * declares `determinism.seededRandom` is claiming ALL gameplay RNG flows
 * through `ctx.random` — the burn-down scan (`test/gameplay-rng-ban.test.ts`)
 * catches raw `Math.random()`/`Date.now()`/`performance.now()` call sites it
 * can SEE in source; this trap catches what the scan structurally can't: a
 * TRANSITIVE draw made by a third-party library the game calls into during a
 * gameplay tick.
 *
 * Scope is exactly one fixed-step frame (`GameInternal.runFrame`'s whole
 * body — see `game.ts`'s `runFrameImpl`, which brackets its entire call with
 * `profiler.beginFrame()`/`endFrame()`; this trap's `enable()`/`disable()`
 * are called at those exact two points) — code that runs OUTSIDE a frame
 * (module-load-time library init, an unrelated timer callback) never trips
 * it. Warn-once PER CALL SITE (not once ever, not once per call) — a
 * third-party library that draws from several different internal call sites
 * gets one warning per site, so nothing is silently swallowed after the
 * first hit, but a hot per-frame draw from the SAME site doesn't spam.
 * Never throws: a cosmetic third-party draw is legal, just outside the
 * contract (the design doc is explicit about this — "warn, never throw").
 */

import { createGameScopedSlot } from '../core/game-scoped-slot';

export interface GameplayRngTrap {
  /** Wrap `Math.random` for the duration of one frame — call at frame start. */
  enable(): void;
  /** Restore whatever `Math.random` was immediately before `enable()` — call
   *  at frame end. A no-op if something else already replaced `Math.random`
   *  out from under this trap between `enable()` and `disable()` (defensive;
   *  should not happen in practice). */
  disable(): void;
}

/** Pull a single representative "call site" line out of a captured stack —
 *  the warn-once dedupe key. `stack[0]` is the `Error:` header line,
 *  `stack[1]` is this trap's OWN wrapper frame — the caller's frame is the
 *  next one down. Falls back to a fixed string when `Error().stack` isn't
 *  populated (some non-V8 engines) so the trap still functions, just with
 *  coarser (single-bucket) deduping. */
function callSiteFromStack(stack: string | undefined): string {
  if (!stack) return '<unknown call site — no stack captured>';
  const lines = stack.split('\n');
  return (lines[2] ?? lines[1] ?? lines[0] ?? '<unknown call site>').trim();
}

/**
 * Construct a fresh trap. `warn` defaults to `console.warn`; tests (and any
 * caller that wants to assert on the message) can override it to a plain
 * capturing function instead of spying on the global console.
 */
export function createGameplayRngTrap(
  warn: (message: string) => void = (message: string) => {
    // biome-ignore lint/suspicious/noConsole: the trap's entire purpose is a structured, greppable dev-mode warning (D15) — this IS the console sink, not incidental debug output.
    console.warn(message);
  },
): GameplayRngTrap {
  const warnedSites = new Set<string>();
  let previous: (() => number) | undefined;

  function trapped(): number {
    const site = callSiteFromStack(new Error().stack);
    if (!warnedSites.has(site)) {
      warnedSites.add(site);
      warn(
        // Deliberately NOT the literal substring "Math.random(" (the phrasing
        // below reads fine without it) — this engine repo's OWN gameplay-rng-
        // ban scan (`test/gameplay-rng-ban.test.ts`) greps engine src/ for
        // that exact pattern, and a plain-text mention of the call inside
        // this warning STRING would otherwise false-positive against itself.
        '[determinism] the global Math.random generator was drawn from during a gameplay frame ' +
          'while this project declares determinism.seededRandom — use ctx.random() / ' +
          `ctx.random.stream(name) instead. Call site:\n${site}`,
      );
    }
    // `previous` is always set by the time `trapped` can run — `enable()`
    // assigns it before installing `trapped` as `Math.random`, and nothing
    // else can invoke this function reference.
    return previous!();
  }

  return {
    enable() {
      previous = Math.random;
      Math.random = trapped;
    },
    disable() {
      if (Math.random === trapped && previous) {
        Math.random = previous;
        previous = undefined;
      }
      // else: something else replaced `Math.random` out from under this trap
      // between `enable()` and `disable()` — leave `previous` untouched.
      // `trapped` may still be reachable via a chain built on top of it (e.g.
      // a third party did `const wrapped = Math.random; Math.random = () =>
      // { ...; return wrapped(); }` while `wrapped` was `trapped`) — nulling
      // `previous` here would make that still-chained call to `trapped()`
      // throw (`previous!()` on undefined) instead of quietly forwarding to
      // the real original generator.
    },
  };
}

// ---------------------------------------------------------------------------
// Game-scoped registry — same slot-on-owner-object pattern as
// `core/seeded-random.ts`'s `registerSeededRandom`/`getSeededRandom` (and
// `debug-registry.ts`'s `registerDebugRegistry`/`getDebugRegistry`): the
// trap's enable/disable calls live inside `game.ts`'s `runFrameImpl`, gated
// on a boolean only the manifest-aware boot path (`mount-manifest.ts`) knows
// how to set — `createGame` constructs the trap unconditionally (cheap, does
// nothing while disabled) and registers a control surface for that boot path
// to flip once it has resolved `manifest.determinism?.seededRandom`.
// ---------------------------------------------------------------------------

export interface GameplayRngTrapControl {
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

const controlByOwner = createGameScopedSlot<GameplayRngTrapControl>('gameplay-rng-trap');

/** Called once by `createGame`, alongside `registerSeededRandom`/
 *  `registerDebugRegistry`. */
export function registerGameplayRngTrapControl(
  owner: object,
  control: GameplayRngTrapControl,
): void {
  controlByOwner.set(owner, control);
}

/** `null` for an owner built without one — same absence precedent as
 *  `getSeededRandom`/`getDebugRegistry`. */
export function getGameplayRngTrapControl(owner: object): GameplayRngTrapControl | null {
  return controlByOwner.get(owner) ?? null;
}
