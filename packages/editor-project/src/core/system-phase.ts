/**
 * THE SYSTEM-PHASE VOCABULARY — the order a frame runs in, and the shape a
 * project's own system declares itself with.
 *
 * It lives in the CONTRACT because two runtimes speak it and neither owns it:
 * `@vgai/game-runtime`'s loop and system runner schedule by phase, and
 * `@vgai/threejs-runtime`'s animation clock orders its evaluators by the same
 * `PHASE_ORDER`. A vocabulary two shipped twins both read is the contract's,
 * or it is a value edge between twins — and that edge is the one thing the
 * twin row may not have (docs/ARCHITECTURE-CORE.md §The target shape: a twin
 * depends on the project contract and its medium's libraries).
 *
 * `scripts/generate-engine-manifest.ts` renders this file into
 * `packages/project/schemas/engine-api.json`.
 */

/**
 * System execution phases, in order.
 * Each frame, systems run in this exact sequence.
 */
export const SystemPhase = {
  INPUT: 'input',
  PRE_PHYSICS: 'prePhysics',
  PHYSICS: 'physics',
  POST_PHYSICS: 'postPhysics',
  GAME_LOGIC: 'gameLogic',
  ANIMATION: 'animation',
  PRE_RENDER: 'preRender',
  RENDER: 'render',
} as const;

export type SystemPhaseName = (typeof SystemPhase)[keyof typeof SystemPhase];

/** Order of phase execution */
export const PHASE_ORDER: SystemPhaseName[] = [
  SystemPhase.INPUT,
  SystemPhase.PRE_PHYSICS,
  SystemPhase.PHYSICS,
  SystemPhase.POST_PHYSICS,
  SystemPhase.GAME_LOGIC,
  SystemPhase.ANIMATION,
  SystemPhase.PRE_RENDER,
  SystemPhase.RENDER,
];

/** A system is just a function that takes delta time */
export type SystemFn = (dt: number) => void;

export interface SystemOptions {
  /** Stable diagnostic label; falls back to the function name. */
  readonly name?: string;
}
