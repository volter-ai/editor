/**
 * THE UNIVERSAL INSTRUMENTS — time scale, pause/frame-step, collider draw and
 * frame time, furnished by the ENGINE for every game before it has written a
 * line.
 *
 * These are physics of the medium, not genre ontology. Time runs; it can run
 * slower or stop; a frame can be stepped; colliders can be drawn; frames take
 * time. None of that is a decision any particular game makes, so none of it
 * belongs in a game's own declarations — and none of it belongs on the game's
 * own dev panel either, which shows ONLY what the game itself declared
 * (`stat()`, `cheat()`). They publish as DOORS: an agent drives them through
 * `game.state()`/`game.command()`, and a human drives the same controls from
 * the editor chrome that already owns them — pause and frame-step on the
 * transport, frame time on the stats overlay, colliders in the play-adopted
 * Scene viewport.
 *
 * WHAT IS NOT HERE, and why: a FREE CAMERA. The editor already ships one
 * (owner, 2026-08-10): play adoption swaps the live game scene into the editor
 * viewport (`enterPlayScene`), so the Scene view during play IS a free orbit
 * camera over the running game — no game-side camera override needed, and the
 * game's own camera writes never fight it because the game keeps rendering
 * through its own canvas untouched. Per the non-redundancy rule that governs
 * this list, a control the editor's own chrome furnishes gets no instrument;
 * agents reach that camera through the editor half of `vgai eval`, not the
 * game registry.
 *
 * ── THE DOOR ────────────────────────────────────────────────────────────────
 * The HOST publishes these itself ({@link publishDevInstruments}, called by
 * the mount install paths): one provider per reading
 * (`instrument.timescale`), one command per action
 * (`instrument.timescale.set`), plus the `instruments` index provider. The
 * registry IS the product, so every reader of an instrument reaches the SAME
 * registration — and a game writes zero lines and mounts nothing to have
 * them.
 *
 * ── DEGRADING ───────────────────────────────────────────────────────────────
 * An instrument whose subject this game does not have (no physics adapter ⇒ no
 * colliders) READS `null` — honest emptiness rather than a fabricated value.
 * Its ACTION, invoked anyway, THROWS and names what is missing. Silence is the
 * one thing forbidden: an agent that calls `instrument.colliders.toggle` and
 * gets `undefined` back learns nothing.
 *
 * ── RESOURCE OWNERSHIP, STATED ONCE ─────────────────────────────────────────
 * {@link createDevInstruments} owns everything it allocates: the frame-time
 * ring buffer and its ONE `game.onRenderStep` subscription. SHARER: the host
 * install path ({@link publishDevInstruments}), which creates one set per
 * mounted game. TEARDOWN: the returned {@link DevInstrumentSet.dispose} — the
 * ONE path that ends it. Nothing else here holds a resource; the time-scale, pause and
 * collider instruments only drive state that `Game` already owns.
 */

import { nodeKeyedPhysics } from '@volter/editor-project/adapter/system-adapter';
import { z } from 'zod';
import { clampTimeScale, TIME_SCALE_RANGE } from '../core/frame-pacing';
import { getDebugRegistry } from '../debug-registry';
import type { Game } from '../game';

/** What shape an instrument's reading is, and what drives it. Data, not
 *  layout: a reader learns how to interpret and actuate an instrument without
 *  having to recognise it by name. */
export type DevInstrumentControl =
  /** A value only. */
  | { readonly kind: 'reading' }
  /** On/off, driven by the named action. */
  | { readonly kind: 'toggle'; readonly action: string }
  /** A continuous value, driven by the named action (one numeric argument). */
  | {
      readonly kind: 'scale';
      readonly action: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
    }
  /** A {@link FrameTimeReading} — a window of samples, not a scalar. */
  | { readonly kind: 'plot' };

/** One instrument verb. Every action declares an args tuple — `z.tuple([])`
 *  for a verb that takes none — so the debug registry REJECTS an unexpected
 *  argument at the door instead of passing it through to a handler that
 *  ignores it. */
export interface DevInstrumentAction {
  /** Second half of the command name: `instrument.<id>.<this>`. */
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly args: z.ZodTuple;
  run(values: readonly unknown[]): unknown;
}

export interface DevInstrument {
  /** Second half of the provider name: `instrument.<this>`. */
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** Trailing unit for a scalar reading (`x`, `ms`). */
  readonly unit?: string;
  readonly control: DevInstrumentControl;
  readonly actions: readonly DevInstrumentAction[];
  /** This instant's value, or `null` when this game has no such subject. */
  read(): unknown;
}

export interface DevInstrumentSet {
  readonly instruments: readonly DevInstrument[];
  /** See the ownership note above — the ONE teardown path. */
  dispose(): void;
}

/**
 * How many display frames the frame-time reading keeps. ~1 second at 60 Hz —
 * long enough that a hitch is still in the window when you look, short enough
 * that the mean tracks what the game is doing NOW.
 */
export const FRAME_TIME_WINDOW = 60;

/** What `instrument.frame-time` reads. `null`s (rather than zeros) before the
 *  first sampled frame: a stopped game has no frame time, and `0 ms / 0 fps`
 *  would read as a measurement. */
export interface FrameTimeReading {
  /** Mean wall-clock milliseconds per display frame over the window. */
  readonly ms: number | null;
  /** Frames per second implied by {@link ms}. */
  readonly fps: number | null;
  /** The worst single frame in the window — the hitch the mean hides. */
  readonly worstMs: number | null;
  /** Oldest first, for the plot. */
  readonly samples: readonly number[];
}

/** Pure: the whole frame-time reading from a window of samples. */
export function summarizeFrameTimes(samples: readonly number[]): FrameTimeReading {
  if (samples.length === 0) return { ms: null, fps: null, worstMs: null, samples: [] };
  let total = 0;
  let worst = 0;
  for (const sample of samples) {
    total += sample;
    if (sample > worst) worst = sample;
  }
  const ms = total / samples.length;
  return {
    ms: round(ms, 2),
    fps: ms > 0 ? round(1000 / ms, 1) : null,
    worstMs: round(worst, 2),
    samples: samples.map((sample) => round(sample, 2)),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const NO_COLLIDERS =
  'No physics adapter on this game implements setDebugDrawEnabled, so nothing can draw its ' +
  'colliders. A first-party three root with Rapier physics registers one; a game with no ' +
  'physics has no colliders to draw.';

const NO_ARGS = z.tuple([]);

/**
 * Build this game's universal instrument set. One call per mounted game; the
 * caller owns the returned {@link DevInstrumentSet.dispose}.
 */
export function createDevInstruments(game: Game): DevInstrumentSet {
  // --- Frame time: one subscription, one ring buffer ------------------------
  const samples: number[] = [];
  let previousFrameAt = now();
  const stopSampling = game.onRenderStep(() => {
    const at = now();
    samples.push(at - previousFrameAt);
    previousFrameAt = at;
    if (samples.length > FRAME_TIME_WINDOW) samples.shift();
  });

  // --- Collider draw: the adapter has a setter and no getter, so the ON/OFF
  // state is ours to remember. It is only ever written through the one action
  // below, which is also the only thing that calls the adapter.
  let collidersDrawn = false;
  const colliderDraw = () => {
    // Node-id keyed only — `setDebugDrawEnabled` draws THREE wireframes into
    // the world, which a canvas mount's display-keyed carrier has no analogue
    // for and does not declare.
    const adapter = nodeKeyedPhysics(game.systemAdapters.physics);
    return adapter?.setDebugDrawEnabled ? adapter : null;
  };

  const instruments: readonly DevInstrument[] = [
    {
      id: 'timescale',
      label: 'Time scale',
      hint: 'Sim speed multiplier. 1 is real time, 0 freezes the simulation while the game keeps drawing.',
      unit: 'x',
      control: {
        kind: 'scale',
        action: 'set',
        min: TIME_SCALE_RANGE.min,
        max: TIME_SCALE_RANGE.max,
        step: 0.05,
      },
      actions: [
        {
          id: 'set',
          label: 'Set',
          hint: `Set the sim speed multiplier (${TIME_SCALE_RANGE.min}–${TIME_SCALE_RANGE.max}).`,
          args: z.tuple([z.number()]),
          run: (values) => {
            // The LOOP clamps and warns; asking for the clamp here too would
            // be a second opinion about the same range. It reads back the
            // value that actually took effect, never the one requested.
            game.loop.timeScale = clampTimeScale(values[0] as number);
            return game.loop.timeScale;
          },
        },
      ],
      read: () => game.loop.timeScale,
    },
    {
      id: 'paused',
      label: 'Paused',
      hint: 'Freeze the simulation. The game keeps drawing, so you can look at a frozen frame.',
      control: { kind: 'toggle', action: 'toggle' },
      actions: [
        {
          id: 'toggle',
          label: 'Toggle',
          hint: 'Pause or resume the simulation.',
          args: NO_ARGS,
          run: () => {
            if (game.play.paused) game.play.resume();
            else game.play.pause();
            return game.play.paused;
          },
        },
        {
          id: 'step',
          label: 'Step',
          hint: 'Advance exactly one fixed substep. Pauses first if the game is running.',
          args: NO_ARGS,
          run: () => {
            // Frame advance implies pause — `Game.play.step()` is a
            // deliberate whole-call no-op while running, and a button that
            // silently does nothing is the failure this instrument exists to
            // avoid.
            if (!game.play.paused) game.play.pause();
            game.play.step();
            return game.play.paused;
          },
        },
      ],
      read: () => game.play.paused,
    },
    {
      id: 'colliders',
      label: 'Colliders drawn',
      hint: "Draw the physics colliders over the world, through the game's own physics adapter.",
      control: { kind: 'toggle', action: 'toggle' },
      actions: [
        {
          id: 'toggle',
          label: 'Toggle',
          hint: 'Turn collider wireframes on or off.',
          args: NO_ARGS,
          run: () => {
            const adapter = colliderDraw();
            if (!adapter) throw new Error(NO_COLLIDERS);
            collidersDrawn = !collidersDrawn;
            adapter.setDebugDrawEnabled?.(collidersDrawn);
            return collidersDrawn;
          },
        },
      ],
      read: () => (colliderDraw() === null ? null : collidersDrawn),
    },
    {
      id: 'frame-time',
      label: 'Frame time',
      hint: 'Wall-clock milliseconds per display frame, newest last. The window is where a hitch shows; the mean hides it.',
      unit: 'ms',
      control: { kind: 'plot' },
      actions: [
        {
          id: 'clear',
          label: 'Clear',
          hint: 'Forget the sampled window and start measuring again.',
          args: NO_ARGS,
          run: () => {
            samples.length = 0;
            return null;
          },
        },
      ],
      read: () => summarizeFrameTimes(samples),
    },
  ];

  return {
    instruments,
    dispose() {
      stopSampling();
      samples.length = 0;
    },
  };
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

// ---------------------------------------------------------------------------
// Host publication — the instruments' OWN door
// ---------------------------------------------------------------------------
//
// The HOST publishes these (the editor's mount install path), so every game
// gets them for literally zero lines — no capability, no bridge component, no
// mount. One provider per reading (`instrument.timescale`), one command per
// action (`instrument.timescale.set`), plus ONE index provider
// (`instruments`) carrying every descriptor with this instant's values, so an
// outside reader gets the whole panel in one round trip. Naming is unchanged
// from when the dev-tools capability published them, so every existing reader
// keeps working; only the publisher moved realms.

/** The index provider's name. */
export const INSTRUMENTS_PROVIDER = 'instruments';

/** The registry scope the host publishes under. Not a mounted world —
 *  instruments are game-scoped host furniture. */
const INSTRUMENTS_WORLD_ID = '__instruments__';

/** One instrument in the index: descriptor plus this instant's value. A
 *  throwing read is reported as itself, never swallowed. */
export interface PublishedInstrumentReading {
  readonly name: string;
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly unit?: string;
  readonly control: DevInstrumentControl;
  readonly actions: readonly {
    readonly name: string;
    readonly id: string;
    readonly label: string;
    readonly hint: string;
  }[];
  readonly value: unknown;
  readonly error?: string;
}

function readingOf(instrument: DevInstrument): PublishedInstrumentReading {
  const base = {
    name: `instrument.${instrument.id}`,
    id: instrument.id,
    label: instrument.label,
    hint: instrument.hint,
    ...(instrument.unit === undefined ? {} : { unit: instrument.unit }),
    control: instrument.control,
    actions: instrument.actions.map((action) => ({
      name: `instrument.${instrument.id}.${action.id}`,
      id: action.id,
      label: action.label,
      hint: action.hint,
    })),
  };
  try {
    return { ...base, value: instrument.read() };
  } catch (error) {
    return { ...base, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Create this game's instrument set and register every door on its debug
 * registry. Called once per mounted Game by the host install path; the
 * returned disposer ends the set's one resource (the frame-time
 * subscription) — the registrations die with the Game itself.
 */
export function publishDevInstruments(game: Game): () => void {
  const registry = getDebugRegistry(game);
  if (!registry) {
    throw new Error('Cannot publish dev instruments: mounted Game has no debug registry.');
  }
  const set = createDevInstruments(game);
  const scope = registry.forRoot(INSTRUMENTS_WORLD_ID);
  for (const instrument of set.instruments) {
    scope.registerStateProvider(`instrument.${instrument.id}`, () => instrument.read(), {
      tier: 'assisted',
    });
    for (const action of instrument.actions) {
      scope.registerCommand(
        `instrument.${instrument.id}.${action.id}`,
        {
          description: `${instrument.label}: ${action.label} — ${action.hint}`,
          locus: 'client',
          args: action.args,
        },
        (...values: unknown[]) => action.run(values),
      );
    }
  }
  scope.registerStateProvider(INSTRUMENTS_PROVIDER, () => set.instruments.map(readingOf), {
    tier: 'assisted',
  });
  return () => set.dispose();
}
