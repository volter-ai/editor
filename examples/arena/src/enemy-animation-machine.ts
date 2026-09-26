import { assign, setup as xstateSetup } from 'xstate';
import { AIM_STANCE_CLIP_NAME } from './enemy-combat-clips';

/** The same layered split the player's body machine uses on this rig
 *  (player-body-machine.ts): locomotion below the chest, combat above it. */
const LOWER_BODY = { include: ['mixamorigHips'], exclude: ['mixamorigSpine1'] } as const;
const UPPER_BODY = { include: ['mixamorigSpine1'] } as const;
const HIT_SECONDS = 0.34;
const FIRE_SECONDS = 0.42;

export interface EnemyAnimationContext {
  speed: number;
  aimPitch: number;
  aiming: boolean;
  fired: boolean;
  hit: boolean;
  dead: boolean;
  phaseSeconds: number;
}

export type EnemyAnimationEvent = {
  type: 'UPDATE';
  speed: number;
  aimPitch: number;
  aiming: boolean;
  fired: boolean;
  hit: boolean;
  dead: boolean;
  dt: number;
};

/**
 * The layered enemy layout, carried over from the original UAL1 build onto
 * the baked Redline humanoids (Mixamo-family skeleton): continuous
 * locomotion below the chest, an independent upper-body combat stance,
 * additive fire/hit reactions that preserve both, and one full-body death.
 *
 * - `lower` — Idle / Walk from the baked GLB, masked to the hips chain.
 *   The bots move at exactly one ground speed (1.55 — arena-bot.ts), so
 *   locomotion is a discrete pair, not a blend tree: every clip this graph
 *   names actually plays in a match.
 * - `upper` — upper-masked Idle arms when relaxed; the authored `AimStance`
 *   hold while the bot has line of sight (src/enemy-combat-clips.ts). The
 *   old UAL1 pitch-driven aim space cannot retarget onto this rig, so the
 *   PITCH half of aiming is procedural — src/enemy-animation.ts poses the
 *   right arm at the player after the mixer samples; `aimPitch` stays in
 *   context as its telemetry.
 * - `upper-action` — authored ADDITIVE Recoil/Flinch over whatever the
 *   stance layer holds (they avoid the right-arm chain, which the
 *   procedural aim owns).
 * - `full` — the authored full-body Death (src/enemy-death-clip.ts),
 *   clamped on its settled frame until respawn flips `dead` off.
 */
export const enemyAnimationMachine = xstateSetup({
  types: {
    context: {} as EnemyAnimationContext,
    events: {} as EnemyAnimationEvent,
  },
  actions: {
    resetPhase: assign({ phaseSeconds: () => 0 }),
  },
}).createMachine({
  id: 'arena-enemy-animation',
  initial: 'alive',
  context: {
    speed: 0,
    aimPitch: 0,
    aiming: false,
    fired: false,
    hit: false,
    dead: false,
    phaseSeconds: 0,
  },
  on: {
    UPDATE: {
      actions: assign({
        speed: ({ event }) => event.speed,
        aimPitch: ({ event }) => event.aimPitch,
        aiming: ({ event }) => event.aiming,
        fired: ({ event }) => event.fired,
        hit: ({ event }) => event.hit,
        dead: ({ event }) => event.dead,
        phaseSeconds: ({ context, event }) => context.phaseSeconds + event.dt,
      }),
    },
  },
  states: {
    alive: {
      type: 'parallel',
      always: { guard: ({ context }) => context.dead, target: 'dead' },
      states: {
        movement: {
          initial: 'idle',
          states: {
            idle: {
              meta: {
                animation: {
                  clip: 'Idle',
                  layer: 'lower',
                  boneMask: LOWER_BODY,
                  loop: true,
                  crossfade: { duration: 0.18 },
                },
              },
              always: {
                guard: ({ context }) => context.speed > 0.1,
                target: 'locomotion',
              },
            },
            locomotion: {
              meta: {
                animation: {
                  clip: 'Walk',
                  layer: 'lower',
                  boneMask: LOWER_BODY,
                  loop: true,
                  crossfade: { duration: 0.18 },
                },
              },
              always: {
                guard: ({ context }) => context.speed <= 0.1,
                target: 'idle',
              },
            },
          },
        },
        combat: {
          type: 'parallel',
          states: {
            stance: {
              initial: 'relaxed',
              states: {
                relaxed: {
                  meta: {
                    animation: {
                      clip: 'Idle',
                      layer: 'upper',
                      boneMask: UPPER_BODY,
                      loop: true,
                      crossfade: { duration: 0.12 },
                    },
                  },
                  always: { guard: ({ context }) => context.aiming, target: 'aiming' },
                },
                aiming: {
                  meta: {
                    animation: {
                      clip: AIM_STANCE_CLIP_NAME,
                      layer: 'upper',
                      boneMask: UPPER_BODY,
                      loop: true,
                      crossfade: { duration: 0.14 },
                    },
                  },
                  always: { guard: ({ context }) => !context.aiming, target: 'relaxed' },
                },
              },
            },
            action: {
              initial: 'ready',
              states: {
                ready: {
                  always: [
                    { guard: ({ context }) => context.hit, target: 'hit' },
                    { guard: ({ context }) => context.fired, target: 'firing' },
                  ],
                },
                firing: {
                  entry: 'resetPhase',
                  meta: {
                    animation: {
                      clip: 'Recoil',
                      layer: 'upper-action',
                      boneMask: UPPER_BODY,
                      blendMode: 'additive',
                      loop: false,
                      crossfade: { duration: 0.04 },
                    },
                  },
                  always: {
                    guard: ({ context }) => context.phaseSeconds >= FIRE_SECONDS,
                    target: 'ready',
                  },
                },
                hit: {
                  entry: 'resetPhase',
                  meta: {
                    animation: {
                      clip: 'Flinch',
                      layer: 'upper-action',
                      boneMask: UPPER_BODY,
                      blendMode: 'additive',
                      loop: false,
                      crossfade: { duration: 0.05 },
                    },
                  },
                  always: {
                    guard: ({ context }) => context.phaseSeconds >= HIT_SECONDS,
                    target: 'ready',
                  },
                },
              },
            },
          },
        },
      },
    },
    dead: {
      meta: {
        animation: {
          clip: 'Death',
          layer: 'full',
          loop: false,
          crossfade: { duration: 0.12 },
        },
      },
      always: { guard: ({ context }) => !context.dead, target: 'alive' },
    },
  },
});
