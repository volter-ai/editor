/**
 * The QA TESTER's REPERTOIRE — everything this game's bot knows how to do,
 * as ordinary game-owned code.
 *
 * The tester is the person holding the controller: it plays THIS game, at sim
 * speed, through the real input pipeline. What it can be asked to do is
 * game-specific by nature, so this file is a plain `Record<string, behavior>`.
 * There is deliberately NO behavior tree, utility system,
 * goal stack, or standardized brain here: a behavior is a function that gets
 * stepped once per tick and returns whether it is still going. A game that
 * wants a planner writes one inside its own behavior; nothing here needs to
 * know.
 *
 * The repertoire ACCRETES per mechanic. When a slice ships a mechanic, the
 * tester learns to exercise it — a new entry below, in the same breath as that
 * mechanic's exported setup function and readout. That is what makes "give the bot a goal"
 * a thing the developer can say at the REPL instead of hand-flying the game.
 *
 * A behavior may ONLY act through `ctx.hands` (virtual input, which merges
 * into the same keys feed a human's keyboard drives) and read whatever state
 * the game exposes. It never teleports, never writes game state, and never
 * calls a setup function: buying ARRIVAL at a situation is the developer's
 * job (ordinary exported functions reached from the REPL), and playing it is
 * the tester's.
 *
 * Goals are started with `hireTester` from `tester-station.ts`; the repertoire
 * is returned by `describeTester`. Both are ordinary exports on the running
 * module — see `src/bot/QaTester.tsx`.
 */

import { z } from 'zod';

/** What a behavior reports after one tick. `running` means "give me another
 *  tick"; the other two end the run. */
export type TesterOutcome = 'running' | 'done' | 'failed';

/** One sim tick, as the behavior sees it. `dt` is the fixed step the engine
 *  loop just ran; `elapsed` is sim seconds since this goal started — the unit
 *  every budget in a behavior should be written in. */
export interface TesterTick {
  readonly dt: number;
  readonly elapsed: number;
}

/**
 * The tester's HANDS: the only way a behavior is allowed to touch the game.
 *
 * Every method here is a virtual actuation of one of the game's OWN declared
 * input actions, which the engine merges into the same reads a real key
 * produces (edges included). There is no state-write door on this interface on
 * purpose — see this module's header.
 */
export interface TesterHands {
  /** Every input action this game actually declared. A behavior that needs an
   *  action should check this rather than assume: driving an undeclared action
   *  throws, which fails the run loudly. */
  actions(): readonly string[];
  /** Hold (or level-set) an action — `true`/`false` for a digital action, a
   *  number for a scalar, `{x, y}` for a vector2. Exactly what holding and
   *  releasing a key does. */
  set(action: string, value: boolean | number | { x: number; y: number }): void;
  /** One honest press, carried through a full tick. */
  tap(action: string): void;
  /** Let go of everything this tester is holding. */
  release(): void;
}

/** What a behavior is handed when it is created. */
export interface TesterContext {
  readonly hands: TesterHands;
  /** Publish what the tester is doing, to `bot.status` and the in-game HUD.
   *  Cheap; call it when something changes, not every tick. */
  report(patch: { step?: string; progress?: number; note?: string }): void;
}

/**
 * One thing the tester knows how to do.
 *
 * `create` runs once when the goal starts and returns the per-tick step
 * function, so anything the behavior needs to remember is an ordinary closure
 * variable. `params` (when declared) is parsed by the driver BEFORE `create`,
 * so a mistyped goal fails at the door with zod's own message rather than
 * halfway through a run.
 */
export interface TesterBehavior<P = unknown> {
  /** One line, written for the developer choosing a goal — say what the tester
   *  will DO and name the params it takes. This is the discovery surface. */
  readonly summary: string;
  readonly params?: z.ZodType;
  create(ctx: TesterContext, params: P): (tick: TesterTick) => TesterOutcome;
}

const sweepParams = z
  .object({
    actions: z
      .array(z.string())
      .optional()
      .describe('Which declared actions to press, in order. Defaults to all of them.'),
    holdSimSeconds: z
      .number()
      .positive()
      .default(0.75)
      .describe('How long to hold each action, in sim seconds.'),
  })
  .strict();

type SweepParams = z.infer<typeof sweepParams>;

/**
 * `sweep` — the STARTER behavior, and the one a real game deletes first.
 *
 * It holds each of the game's declared input actions in turn for a sim-time
 * budget, reporting as it goes. That is a genuinely useful first goal (it
 * proves the controller is wired: bindings exist, something consumes them,
 * the world reacts), and it is deliberately the least intelligent thing a
 * tester can do — pressing every button is not playing the game. The moment
 * this project has a mechanic, replace this with a goal named after what the
 * tester is trying to ACHIEVE (`reach-the-ledge`, `kill-the-first-wave`), and
 * let the repertoire grow from there.
 *
 * On the neutral starter world it fails, loudly and correctly: a project that
 * declares no input actions has no controller for a tester to hold, and
 * reporting `done` for having pressed nothing would be a lie the whole live
 * loop is built to prevent.
 */
const sweep: TesterBehavior<SweepParams> = {
  summary:
    'Hold each declared input action in turn for a sim-time budget — the starter goal that ' +
    'proves the controller is wired. Params: {actions?: string[], holdSimSeconds?: number}. ' +
    "Replace it with this game's first real goal (see src/bot/behaviors.ts).",
  params: sweepParams,
  create(ctx, params) {
    const actions = params.actions ?? [...ctx.hands.actions()];
    const hold = params.holdSimSeconds;

    if (actions.length === 0) {
      return () => {
        ctx.report({
          note:
            'this project declares no input actions, so the tester has no controller to hold — ' +
            'declare your actions in src/input.ts (and read them from the mechanic that cares), ' +
            'then give the tester a goal that plays the mechanic it drives',
        });
        return 'failed';
      };
    }

    let index = -1;
    let releaseAt = 0;

    return (tick) => {
      if (tick.elapsed < releaseAt) return 'running';

      const finished = actions[index];
      if (finished !== undefined) ctx.hands.set(finished, false);

      index += 1;
      const next = actions[index];
      if (next === undefined) {
        ctx.report({ progress: actions.length, note: 'swept every declared action' });
        return 'done';
      }

      releaseAt = tick.elapsed + hold;
      ctx.hands.set(next, true);
      ctx.report({ step: `hold ${next}`, progress: index });
      return 'running';
    };
  },
};

/**
 * THE repertoire. Add a behavior by adding a key — nothing else registers it,
 * and nothing outside this file decides what a goal means.
 */
export const testerBehaviors: Record<string, TesterBehavior> = {
  sweep,
};

/** The repertoire as data, for the Tester contribution and the live REPL. */
export function describeTesterBehaviors(): Array<{ name: string; summary: string }> {
  return Object.entries(testerBehaviors).map(([name, behavior]) => ({
    name,
    summary: behavior.summary,
  }));
}

/**
 * Look up a goal by name, or throw naming the whole repertoire — an unknown
 * goal is a typo or a behavior nobody has written yet, and both are answered
 * by seeing what the tester actually knows.
 */
export function resolveTesterBehavior(name: string): TesterBehavior {
  const behavior = testerBehaviors[name];
  if (behavior) return behavior;
  const known = Object.keys(testerBehaviors);
  throw new Error(
    `hireTester: this game's tester has no behavior named "${name}". ` +
      (known.length === 0
        ? 'Its repertoire is empty — add one in src/bot/behaviors.ts.'
        : `It knows: ${known.join(', ')}. Add another in src/bot/behaviors.ts.`),
  );
}
