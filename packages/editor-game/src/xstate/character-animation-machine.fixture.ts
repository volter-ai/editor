/**
 * E3/E4 demo + test fixture — mirrors `characterAnimationMachine`
 * (`examples/third-person/src/components.ts`) EXACTLY (same states, events,
 * guards, `meta.animation`). Not a re-export: that machine is a module-
 * private `const` in the example game (never exported), and
 * `examples/third-person` is outside `packages/editor`'s tsconfig `include`
 * (no path alias reaches it — confirmed: `packages/editor/tsconfig*.json`
 * only maps the runtime packages), so the editor package cannot
 * import it directly without either widening the example's public surface or
 * adding a new cross-package path alias — both bigger changes than this lean
 * inspector unit warrants. A representative fixture machine is
 * spec-sanctioned for exactly this case ("import it or a representative
 * fixture machine").
 *
 * Keep this in sync with `examples/third-person/src/components.ts` by hand if
 * that machine's shape ever changes — there is no structural coupling
 * enforcing it (a comment-only contract, same as any other fixture mirroring
 * real game code).
 */

import { assign, setup as xstateSetup } from 'xstate';

export const characterAnimationMachine = xstateSetup({
  types: {
    context: {} as { speed: number; grounded: boolean },
    events: {} as { type: 'UPDATE'; speed: number; grounded: boolean } | { type: 'JUMP' },
  },
}).createMachine({
  id: 'character-animation',
  initial: 'idle',
  context: { speed: 0, grounded: true },
  on: {
    UPDATE: {
      actions: assign({
        speed: ({ event }) => event.speed,
        grounded: ({ event }) => event.grounded,
      }),
    },
  },
  states: {
    idle: {
      meta: { animation: { clip: 'idle', loop: true, crossfade: { duration: 0.2 } } },
      on: { JUMP: 'airborne' },
      always: { guard: ({ context }) => context.speed > 0.1, target: 'locomotion' },
    },
    locomotion: {
      meta: {
        animation: {
          blendTree: {
            type: '1D',
            parameter: 'speed',
            children: [
              { clip: 'walk', threshold: 1 },
              { clip: 'run', threshold: 5 },
            ],
          },
          crossfade: { duration: 0.2 },
        },
      },
      on: { JUMP: 'airborne' },
      always: { guard: ({ context }) => context.speed <= 0.1, target: 'idle' },
    },
    airborne: {
      meta: { animation: { clip: 'jump', loop: false, crossfade: { duration: 0.1 } } },
      always: [
        {
          guard: ({ context }) => context.grounded && context.speed > 0.1,
          target: 'locomotion',
        },
        { guard: ({ context }) => context.grounded, target: 'idle' },
      ],
    },
  },
});
