import type { Container, TickerCallback } from 'pixi.js';
import * as shellPixi from 'pixi.js';
import type { CanvasPixiNamespace } from '../canvas-entry-runtime';
import { currentGameRealmMountId, gameRealmForMountId } from '../gated-globals';

/** The part of a GSAP instance this reads: its global timeline's live work. */
interface GsapAnimation {
  kill(): unknown;
}
interface GameGsap {
  readonly globalTimeline: {
    getChildren(nested: boolean, tweens: boolean, timelines: boolean): GsapAnimation[];
  };
}

/**
 * THE GAME'S OWN GSAP, when it has one. GSAP installs itself as `gsap` on the
 * global its code runs against — the game realm's, or the page's — so the
 * animations a game's widgets start are read from the instance the GAME
 * loaded. The editor carries no GSAP of its own.
 */
function gameGsap(): GameGsap | null {
  const mountId = currentGameRealmMountId();
  const realmGlobal = mountId === null ? null : gameRealmForMountId(mountId).globalThis;
  const candidate =
    (realmGlobal as { gsap?: unknown } | null)?.gsap ?? (globalThis as { gsap?: unknown }).gsap;
  const timeline = (candidate as Partial<GameGsap> | undefined)?.globalTimeline;
  return typeof timeline?.getChildren === 'function' ? (candidate as GameGsap) : null;
}

function liveGsapAnimations(gsap: GameGsap | null): GsapAnimation[] {
  return gsap ? gsap.globalTimeline.getChildren(true, true, true) : [];
}

function newGsapAnimations(
  gsap: GameGsap | null,
  before: ReadonlySet<GsapAnimation>,
): GsapAnimation[] {
  return liveGsapAnimations(gsap).filter((animation) => !before.has(animation));
}

/**
 * Construct one short-lived Pixi object while withholding shared-ticker
 * listeners installed synchronously by its constructor.
 *
 * `@pixi/ui` FancyButton installs an anonymous `Ticker.shared` callback for
 * each animated button and exposes no matching disposer. That is harmless for
 * the original page-lifetime game, but editor isolation deliberately mounts
 * and destroys the same classes repeatedly. Registering the callback and only
 * removing it at teardown is too late: while this preview is alive it advances
 * the package-global tween group, including stale tweens from a preview React
 * just destroyed. Edit is contractually static, so constructor-time ownership
 * of a wall-clock shared ticker is withheld at the isolation boundary. Play
 * never uses this helper and keeps the game's original clock unchanged.
 *
 * `pixi` is the namespace `create()` CONSTRUCTS IN, because `Ticker.shared` is
 * a module-global: the shell's is a different clock from the project's, and
 * withholding registrations on the wrong one withholds nothing at all — the
 * `@pixi/ui` callbacks this exists to intercept install on whichever
 * `Ticker.shared` the constructed class imported. Absent ⇒ this bundle's own
 * copy (see `../../vite-plugin-module-doorways.ts`).
 */
export function createWithOwnedPixiTickerListeners<T extends Container>(
  create: () => T,
  pixi: CanvasPixiNamespace = shellPixi,
): {
  readonly value: T;
  dispose(): void;
} {
  const ticker = pixi.Ticker.shared;
  const originalAdd = ticker.add;
  const gsap = gameGsap();
  const animationsBefore = new Set(liveGsapAnimations(gsap));
  ticker.add = ((_fn: TickerCallback<unknown>, _context?: unknown, _priority?: number) =>
    ticker) as typeof ticker.add;

  try {
    const value = create();
    // Game interaction is not an authoring gesture. Besides keeping Edit
    // static, disabling the isolated subtree prevents @pixi/ui hover handlers
    // from enqueueing tweedle animations that would survive React teardown in
    // the package-global group and crash when Play later advances it.
    value.eventMode = 'none';
    const ownedAnimations = newGsapAnimations(gsap, animationsBefore);
    // A delayed GSAP call is already live once construction returns. Waiting
    // until disposal lets it mutate the supposedly held document for its whole
    // visible lifetime, so remove construction-owned work immediately.
    for (const animation of ownedAnimations) animation.kill();
    return { value, dispose: () => {} };
  } catch (error) {
    for (const animation of newGsapAnimations(gsap, animationsBefore)) animation.kill();
    throw error;
  } finally {
    ticker.add = originalAdd;
  }
}
