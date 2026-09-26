import { assign, setup as xstateSetup } from 'xstate';
import { FIRE_CLIP_NAME } from './player-fire-clip';

/**
 * Animation machine for the player's Arena Vanguard body (the first-person
 * "shadow avatar" — see src/player-body-animation.ts). Same layered layout
 * the enemy machine proved, on the baked humanoid's Mixamo-family clips:
 * locomotion below the chest, gunplay above it.
 *
 *   lower  — Idle / (Walk↔Run 1D blend on real player speed), hips down
 *   upper  — Idle arms when relaxed; the project-authored 'Fire' aim+recoil
 *            loop (src/player-fire-clip.ts) while shots are landing
 *
 * The Mixamo-family source has no attack clip (Idle/Run/TPose/Walk only) —
 * 'Fire' is composed at runtime, which is why it is not in the baked GLB.
 */

const LOWER_BODY = { include: ['mixamorigHips'], exclude: ['mixamorigSpine1'] } as const;
const UPPER_BODY = { include: ['mixamorigSpine1'] } as const;

/** How long the firing pose holds after the last shot, seconds. */
const FIRE_HOLD_SECONDS = 0.42;

export interface PlayerBodyContext {
  speed: number;
  shots: number;
  sinceShot: number;
}

export type PlayerBodyEvent = {
  type: 'UPDATE';
  /** Horizontal player speed, m/s (0 when paused/dead). */
  speed: number;
  /** Monotonic shot counter from the FpsController. */
  shots: number;
  dt: number;
};

export const playerBodyMachine = xstateSetup({
  types: {
    context: {} as PlayerBodyContext,
    events: {} as PlayerBodyEvent,
  },
}).createMachine({
  id: 'arena-player-body',
  context: { speed: 0, shots: 0, sinceShot: FIRE_HOLD_SECONDS },
  on: {
    UPDATE: {
      actions: assign({
        speed: ({ event }) => event.speed,
        shots: ({ event }) => event.shots,
        sinceShot: ({ context, event }) =>
          event.shots > context.shots ? 0 : context.sinceShot + event.dt,
      }),
    },
  },
  type: 'parallel',
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
          always: { guard: ({ context }) => context.speed > 0.5, target: 'locomotion' },
        },
        locomotion: {
          meta: {
            animation: {
              // Real player speeds: 6.6 m/s base, 9.4 m/s sprinting.
              blendTree: {
                type: '1D',
                parameter: 'speed',
                children: [
                  { clip: 'Walk', threshold: 5 },
                  { clip: 'Run', threshold: 9.4 },
                ],
              },
              layer: 'lower',
              boneMask: LOWER_BODY,
              crossfade: { duration: 0.16 },
            },
          },
          always: { guard: ({ context }) => context.speed <= 0.5, target: 'idle' },
        },
      },
    },
    gunplay: {
      initial: 'relaxed',
      states: {
        relaxed: {
          meta: {
            animation: {
              clip: 'Idle',
              layer: 'upper',
              boneMask: UPPER_BODY,
              loop: true,
              crossfade: { duration: 0.16 },
            },
          },
          always: {
            guard: ({ context }) => context.sinceShot < FIRE_HOLD_SECONDS,
            target: 'firing',
          },
        },
        firing: {
          meta: {
            animation: {
              clip: FIRE_CLIP_NAME,
              layer: 'upper',
              boneMask: UPPER_BODY,
              loop: true,
              crossfade: { duration: 0.1 },
            },
          },
          always: {
            guard: ({ context }) => context.sinceShot >= FIRE_HOLD_SECONDS,
            target: 'relaxed',
          },
        },
      },
    },
  },
});
