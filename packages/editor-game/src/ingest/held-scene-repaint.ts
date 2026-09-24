/**
 * PRESENTATION repaints for a scene switch performed while the mount is HELD.
 *
 * The defect this closes: a canvas ingest ends held in Edit
 * (`holdIngestContentTimeForMode`) by stopping the game's own ticker — which is
 * also what drives its rendering. The game's navigation runs on its own
 * machinery (promises, gsap's own ticker), so picking a scene in the story
 * picker genuinely moves `current()` — measured live on bubbo-bubbo — while the
 * canvas keeps showing the OLD scene's last frame until ▶. The editor claims
 * "you are looking at scene X" while showing scene Y.
 *
 * The line this walks is the `edit-mode-static` invariant's own: CONTENT time
 * stays held (the ticker is never started, no game update runs), while
 * PRESENTATION may move. `render()` draws the stage as it is; the scene
 * transition's tweens advance on gsap's clock whether or not anyone draws, so
 * drawing during the switch is showing the truth, not advancing it.
 *
 * Bounded by construction: frames are requested only between `apply` and
 * SETTLE (the game's own `current()` reporting the requested scene) plus one
 * grace window for the transition's tail, with a hard deadline for a scene
 * that never arrives. No interval survives past that; an unheld mount renders
 * nothing here (the running ticker already draws).
 */

/** One frame-scheduler tick: `schedule(cb)` runs `cb(nowMs)` on the next
 *  presentation frame. Injectable so the loop is testable without wall-clock
 *  or rAF; production passes `requestAnimationFrame`. */
export type FrameScheduler = (cb: (nowMs: number) => void) => void;

export interface HeldSceneRepaintSeams {
  /** Is content time currently held? (An unheld mount needs no help drawing.) */
  readonly isHeld: () => boolean;
  /** The game's own answer for which scene is up. */
  readonly currentScene: () => string | null;
  /** Draw one presentation frame of the stage as it currently is. */
  readonly render: () => void;
  readonly schedule: FrameScheduler;
  /** Keep drawing this long after the scene settles, for the transition tail. */
  readonly settleGraceMs?: number;
  /** Give up on a scene that never arrives (a failed asset load refuses
   *  upstream and is reported there; this just stops drawing). */
  readonly deadlineMs?: number;
}

const DEFAULT_GRACE_MS = 1500;
const DEFAULT_DEADLINE_MS = 10000;

/**
 * Begin repainting toward `requestedSceneId`. Returns immediately; frames run
 * on the scheduler. Re-entrant calls are safe: each call is its own bounded
 * loop, and drawing the same stage twice in a frame is idempotent.
 */
export function repaintHeldSceneSwitch(
  requestedSceneId: string,
  seams: HeldSceneRepaintSeams,
): void {
  const grace = seams.settleGraceMs ?? DEFAULT_GRACE_MS;
  const deadline = seams.deadlineMs ?? DEFAULT_DEADLINE_MS;
  let startMs: number | null = null;
  let settledAtMs: number | null = null;
  const tick = (nowMs: number): void => {
    if (!seams.isHeld()) return; // released — the ticker draws from here on
    startMs ??= nowMs;
    if (settledAtMs === null && seams.currentScene() === requestedSceneId) {
      settledAtMs = nowMs;
    }
    seams.render();
    if (settledAtMs !== null && nowMs - settledAtMs >= grace) return;
    if (settledAtMs === null && nowMs - startMs >= deadline) return;
    seams.schedule(tick);
  };
  seams.schedule(tick);
}
