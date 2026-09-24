import gsap from 'gsap';
import type { Container, TickerCallback } from 'pixi.js';
import * as shellPixi from 'pixi.js';
import type { CanvasPixiNamespace } from '../canvas-entry-runtime';

type GsapAnimation = ReturnType<typeof gsap.globalTimeline.getChildren>[number];

function newGsapAnimations(before: ReadonlySet<GsapAnimation>): GsapAnimation[] {
  return gsap.globalTimeline
    .getChildren(true, true, true)
    .filter((animation) => !before.has(animation));
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
  const animationsBefore = new Set(gsap.globalTimeline.getChildren(true, true, true));
  ticker.add = ((_fn: TickerCallback<unknown>, _context?: unknown, _priority?: number) =>
    ticker) as typeof ticker.add;

  try {
    const value = create();
    // Game interaction is not an authoring gesture. Besides keeping Edit
    // static, disabling the isolated subtree prevents @pixi/ui hover handlers
    // from enqueueing tweedle animations that would survive React teardown in
    // the package-global group and crash when Play later advances it.
    value.eventMode = 'none';
    const ownedAnimations = newGsapAnimations(animationsBefore);
    // A delayed GSAP call is already live once construction returns. Waiting
    // until disposal lets it mutate the supposedly held document for its whole
    // visible lifetime, so remove construction-owned work immediately.
    for (const animation of ownedAnimations) animation.kill();
    return { value, dispose: () => {} };
  } catch (error) {
    for (const animation of newGsapAnimations(animationsBefore)) animation.kill();
    throw error;
  } finally {
    ticker.add = originalAdd;
  }
}
