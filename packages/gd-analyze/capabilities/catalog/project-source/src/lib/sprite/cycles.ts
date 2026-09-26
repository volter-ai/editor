/**
 * THE CYCLE-SET CONTRACTS — the 2D analog of the humanoid rig contract.
 *
 * A 3D character kit standardizes ANATOMY (a named skeleton every clip can
 * drive). A 2D sprite has no anatomy to standardize; what a game's code
 * actually binds to is the set of CYCLE NAMES an actor can be asked to play.
 * So the contract is the cycle set: which cycles exist, how many frames each
 * has, whether it loops, and where the sprite's pivot sits.
 *
 * These are contracts, not code that runs. A project's rig module cites the one
 * it implements when it declares its frame catalogue, which is what keeps the
 * bake and the runtime from drifting apart in frame COUNT (they already cannot
 * drift in NAME — the runtime throws by name on a missing animation).
 *
 * Honouring a set is also the whole bring-your-own-sprites seam: the baked
 * artifact is a standard spritesheet with a named `animations` map, so a sheet
 * exported from Aseprite or TexturePacker drops in unchanged when its animation
 * names match a set here (and with a JSON `animations` remap when they do not).
 */

export interface CycleContract {
  /** The cycle's canonical name. An animation is conventionally
   *  `<subject>-<cycle>`, e.g. `hero-walk`. */
  readonly cycle: string;
  /** Frame count. Frame `i` is posed at phase `i / frames`. */
  readonly frames: number;
  readonly loops: boolean;
  readonly note: string;
}

export interface CycleSet {
  readonly id: string;
  /**
   * Whether SHIPPED art has ever been baked against this set. An unproven set
   * is a written-down intention: treat its frame counts as a starting point,
   * not as a measurement.
   */
  readonly proven: boolean;
  /** Where the rig's (0, 0) sits in its cell. */
  readonly origin: 'center' | 'top-left';
  /** Where the art's contact point sits relative to that origin. */
  readonly pivot: string;
  readonly cycles: Readonly<Record<string, CycleContract>>;
}

/**
 * SWARM CRITTER — one looping cycle, no facing.
 *
 * PROVEN: the donor's imp (`imp-hop`) and brute (`brute-lumber`) are both this
 * set. A chaser that turns to face you needs a turn animation nobody is going
 * to bake for a 26px blob, so the art is drawn symmetric on purpose
 * (`examples/top-down-survivor/src/tools/sprite-bake/rigs.ts:26-28`); the whole
 * horde then runs off one cycle desynchronised by a per-entity phase.
 */
export const SWARM_CRITTER: CycleSet = {
  id: 'swarm-critter',
  proven: true,
  origin: 'center',
  pivot: 'ground contact BELOW the origin — the cell centre is the body, not the feet',
  cycles: {
    loop: {
      cycle: 'loop',
      frames: 6,
      loops: true,
      note: 'The creature’s one motion — hop, lumber, drift. Six frames is what the donor found readable at 24–40 on-screen px.',
    },
  },
};

/**
 * TOP-DOWN — idle and walk, one authored facing, mirrored at runtime.
 *
 * PROVEN: the donor's hero. It is authored FACING RIGHT and mirrored by a
 * negative `scale.x`, so no part may carry a glyph that reads wrong reversed
 * (`rigs.ts:24-26`). Four- and eight-direction variants are the same set with
 * a facing suffix (`walk-n`, `walk-ne`, …) and are NOT proven here.
 */
export const TOP_DOWN: CycleSet = {
  id: 'top-down',
  proven: true,
  origin: 'center',
  pivot:
    'ground contact BELOW the origin; the actor is positioned by its feet, drawn from its middle',
  cycles: {
    idle: {
      cycle: 'idle',
      frames: 4,
      loops: true,
      note: 'Breath and settle only. Feet planted and level — the fact that has to be true for idle to be told from walk at a glance.',
    },
    walk: {
      cycle: 'walk',
      frames: 6,
      loops: true,
      note: 'Two bobs per stride, a constant forward lean, and cloth that LAGS the stride so a single frame still reads as walking.',
    },
  },
};

/**
 * SIDE-SCROLLER — the platformer set.
 *
 * PROVEN by the live-rig platformer. Its ranger keeps the whole side-scroller
 * locomotion pose readable while gameplay independently aims `weapon-arm`.
 * The cycle lengths remain the interchange contract for baked replacements;
 * the live example evaluates the same phase continuously between those frames.
 */
export const SIDE_SCROLLER: CycleSet = {
  id: 'side-scroller',
  proven: true,
  origin: 'center',
  pivot: 'ground contact BELOW the origin, on the character’s centre line',
  cycles: {
    idle: { cycle: 'idle', frames: 4, loops: true, note: 'Breath, blink, weight shift.' },
    run: { cycle: 'run', frames: 8, loops: true, note: 'Contact / down / pass / up, twice.' },
    jump: {
      cycle: 'jump',
      frames: 3,
      loops: false,
      note: 'Anticipation, launch, rise. Holds on the last frame.',
    },
    fall: { cycle: 'fall', frames: 2, loops: true, note: 'Apex float and descent.' },
    attack: {
      cycle: 'attack',
      frames: 5,
      loops: false,
      note: 'Anticipation, strike, follow-through — the strike frame carries the hitbox.',
    },
  },
};

export const CYCLE_SETS: readonly CycleSet[] = [SWARM_CRITTER, TOP_DOWN, SIDE_SCROLLER];

// ---------------------------------------------------------------------------
// Checking a real sheet against these contracts
// ---------------------------------------------------------------------------

/**
 * An animation name split into the two things a contract talks about.
 *
 * The convention is `<subject>-<cycle>` (`hero-walk`), so the LAST hyphen is
 * the seam — a subject may carry one of its own (`orbit-blade-spin`). A name
 * with no hyphen is one actor with one nameless motion (`blade`, `floor`), and
 * it is its own subject.
 */
export function splitAnimationName(name: string): { subject: string; cycle: string } {
  const seam = name.lastIndexOf('-');
  if (seam <= 0 || seam === name.length - 1) return { subject: name, cycle: name };
  return { subject: name.slice(0, seam), cycle: name.slice(seam + 1) };
}

/** Every subject a sheet's animation names describe, in first-seen order. */
export function animationSubjects(frameCounts: Readonly<Record<string, number>>): string[] {
  const subjects: string[] = [];
  for (const name of Object.keys(frameCounts)) {
    const { subject } = splitAnimationName(name);
    if (!subjects.includes(subject)) subjects.push(subject);
  }
  return subjects;
}

/** One contract cycle, answered (or not) by one of the subject's animations. */
export interface CycleCheck {
  readonly cycle: string;
  /** The animation that answered for it, or `null` when nothing did. */
  readonly animation: string | null;
  readonly expectedFrames: number;
  /** The answering animation's real frame count, or `null`. */
  readonly frames: number | null;
  readonly ok: boolean;
}

export interface CycleSetConformance {
  readonly subject: string;
  readonly set: CycleSet;
  readonly checks: readonly CycleCheck[];
  /** The subject's animations no cycle in this set claimed. */
  readonly unclaimed: readonly string[];
  /** Every cycle answered at the right length, and nothing left over. */
  readonly conforms: boolean;
}

/**
 * Check one subject's animations against one cycle set.
 *
 * The matching rule is the naming convention (`<subject>-<cycle>`), with ONE
 * documented exception: a set with a single cycle, held by a subject with a
 * single animation, matches whatever that animation is called. That is not a
 * loosening — it is {@link SWARM_CRITTER}'s own contract ("the creature's one
 * motion — hop, lumber, drift"), whose two proven implementations are named
 * `imp-hop` and `brute-lumber`. Every other set names its cycles because every
 * other set has more than one, and there the name IS the binding.
 */
export function checkCycleSet(
  subject: string,
  frameCounts: Readonly<Record<string, number>>,
  set: CycleSet,
): CycleSetConformance {
  const owned = Object.keys(frameCounts).filter(
    (name) => splitAnimationName(name).subject === subject,
  );
  const contracts = Object.values(set.cycles);
  const oneMotion = contracts.length === 1 && owned.length === 1;
  const claimed = new Set<string>();
  const checks = contracts.map((contract): CycleCheck => {
    const byName = `${subject}-${contract.cycle}`;
    const animation = owned.includes(byName) ? byName : oneMotion ? (owned[0] as string) : null;
    if (animation) claimed.add(animation);
    const frames = animation ? (frameCounts[animation] ?? null) : null;
    return {
      cycle: contract.cycle,
      animation,
      expectedFrames: contract.frames,
      frames,
      ok: frames === contract.frames,
    };
  });
  const unclaimed = owned.filter((name) => !claimed.has(name));
  return {
    subject,
    set,
    checks,
    unclaimed,
    conforms: unclaimed.length === 0 && checks.every((check) => check.ok),
  };
}

/**
 * The contract this subject is CLOSEST to, or `null` when no set answers a
 * single one of its cycles.
 *
 * Closest means: most cycles answered, then fewest animations left over, then
 * a PROVEN set over an aspirational one. Returning null rather than the least
 * bad set is the honest answer for art whose names were never shaped by a
 * contract — a wall of red crosses against an arbitrary set reads as a
 * failure, and it is not one.
 */
export function bestCycleSet(
  subject: string,
  frameCounts: Readonly<Record<string, number>>,
  sets: readonly CycleSet[] = CYCLE_SETS,
): CycleSetConformance | null {
  let best: CycleSetConformance | null = null;
  let bestScore: readonly [number, number, number] = [0, 0, 0];
  for (const set of sets) {
    const result = checkCycleSet(subject, frameCounts, set);
    const answered = result.checks.filter((check) => check.animation !== null).length;
    if (answered === 0) continue;
    const score = [answered, -result.unclaimed.length, set.proven ? 1 : 0] as const;
    if (
      best !== null &&
      !(
        score[0] > bestScore[0] ||
        (score[0] === bestScore[0] &&
          (score[1] > bestScore[1] || (score[1] === bestScore[1] && score[2] > bestScore[2])))
      )
    ) {
      continue;
    }
    best = result;
    bestScore = score;
  }
  return best;
}
