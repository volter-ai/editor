/**
 * THE ROUTING from a draw-call reading to the one-line fix.
 *
 * `dev/render-vitals.ts` can already tell a game it is submitting 4,000 draws
 * and `dev/render-census.ts` can already say which subtree they are in. Both
 * require someone to ASK, and both require that someone to already know that
 * static batching exists, is possible here, and is spelled `<Frozen>`. An
 * agent building a game does not know any of that, so the measurement has to
 * do the routing itself — the same idiom as dev-tools' unconfigured-section
 * warning: the reading names the exact edit.
 *
 * ── THE DECISION IS PURE, THE SCHEDULE IS NOT ───────────────────────────────
 * {@link decideStaticBatchAdvisory} takes a draw-call count and two scan
 * reports and answers with an advisory or `null`. It reads no clock, no
 * scene, no console. `dev/register-render-vitals.ts` owns the impure half —
 * when to scan, and warning once — because that is where the profiler
 * subscription already lives.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * The scan is TWO walks of the scene graph, once, after the frame rate has
 * settled ({@link ADVISOR_SETTLE_FRAMES}). Never per frame: a walk of 4,000
 * nodes every frame is itself the kind of cost this advisory exists to
 * remove, and the answer does not change from one frame to the next in a world
 * whose scenery is mount-static — which is the only world the advice applies
 * to anyway.
 *
 * ── WHY IT ASKS INSTEAD OF ACTING ───────────────────────────────────────────
 * "These 2,600 meshes are the same draw" is measurable. "These 2,600 meshes
 * never move" is NOT — nothing in a scene graph distinguishes scenery from a
 * thing that will move on the next input. Inferring it and batching anyway is
 * how a batcher freezes a door half-open. So the advisory names the subtree
 * and the wrapper, and the author (who knows) places it.
 */

import type { CensusReport, StructuralBatchReport } from './render-census';

/**
 * Draw calls below which no advisory fires, however batchable the scene.
 *
 * The field measurement this capability came out of: ~4,000 draws cost ~11 ms
 * of CPU submission per frame — about 2.75 µs each on a desktop browser. At
 * 500 draws that is ~1.4 ms, roughly 8% of a 60 Hz frame: the first point
 * where halving it is a visible win rather than noise a profiler cannot
 * separate from jitter. Below it, an advisory would be a nag pointing at
 * something that is not costing anything, and a nag that is usually wrong is
 * one nobody reads when it is right.
 */
export const ADVISOR_DRAW_CALL_THRESHOLD = 500;

/**
 * The share of the draw calls that must be collapsible before the advice is
 * worth an edit. Half: below that, the wrapper leaves most of the cost exactly
 * where it was, and "you could remove a third of a third" is not a payoff
 * anyone should restructure a scene for.
 */
export const ADVISOR_COLLAPSIBLE_SHARE = 0.5;

/**
 * A subtree must hold at least this share of the collapsible meshes to be
 * named as THE address. Under it the advisory says "across the scene" — an
 * invented address is worse than none, because the reader wraps the wrong
 * group and measures no change.
 */
export const ADVISOR_SUBTREE_SHARE = 0.4;

/**
 * Presented frames to wait before scanning — ~2 s at 60 Hz. Long enough for
 * asset loads and the first setup pass to finish populating the graph (a scan
 * at frame one measures an empty world and stays silent forever), short enough
 * that the line lands while the author is still looking at the boot.
 */
export const ADVISOR_SETTLE_FRAMES = 120;

/** The finding, as a caller can present it however it likes. */
export interface StaticBatchAdvisory {
  /** The reading that triggered it. */
  readonly drawCalls: number;
  /** Meshes sitting in a structural family of two or more. */
  readonly collapsible: number;
  /** The subtree holding most of them, or `null` when they are spread out. */
  readonly subtree: string | null;
  /** The exact edit, ready to paste — `<Frozen name="Terminal">`. */
  readonly fix: string;
  /** The one-line console message: payoff, address, edit, install. */
  readonly message: string;
}

export interface StaticBatchAdvisoryInput {
  /** `render.vitals`' own reading. `null` before the first presented frame. */
  readonly drawCalls: number | null;
  /** The one-level census, used only to sanity-check the address against a
   *  subtree that genuinely exists in the graph. */
  readonly census: CensusReport;
  /** The STRUCTURAL scan — see `render-census.ts` for why the identity scan
   *  cannot answer this. */
  readonly structural: StructuralBatchReport;
}

/** `2600` → `2,600`. Digits a person reads at a glance, in the one place the
 *  message is built, so every number in it is grouped the same way. */
function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Decide whether this frame's cost is worth an advisory, and what it should
 * say. Pure — every input is an argument, and the same arguments always
 * produce the same message.
 */
export function decideStaticBatchAdvisory(
  input: StaticBatchAdvisoryInput,
): StaticBatchAdvisory | null {
  const { drawCalls, census, structural } = input;
  if (drawCalls === null || drawCalls < ADVISOR_DRAW_CALL_THRESHOLD) return null;

  const { collapsible } = structural;
  if (collapsible < drawCalls * ADVISOR_COLLAPSIBLE_SHARE) return null;

  // The address, when one subtree genuinely dominates. `bySubtree` is already
  // sorted, and a name that no census row confirms is not offered: it would
  // send the reader looking for a node the other render.* commands cannot
  // find either.
  const addressable = new Set(census.subtrees.map((row) => row.name));
  const leader = structural.bySubtree[0];
  const subtree =
    leader &&
    leader.collapsible >= collapsible * ADVISOR_SUBTREE_SHARE &&
    addressable.has(leader.name)
      ? leader.name
      : null;

  const fix = subtree === null ? '<Frozen>' : `<Frozen name="${subtree}">`;
  const where = subtree === null ? 'spread across the scene' : `mostly under "${subtree}"`;
  const message =
    // `collapsible` counts meshes in the graph (culled ones included) and `drawCalls` this
    // frame's submissions, so each number is stated in its own unit, never as a share.
    `[static-batch] ${grouped(drawCalls)} draw calls this frame; ~${grouped(collapsible)} meshes ` +
    `are repeats of ${grouped(structural.familyCount)} structural families, ` +
    `${where}. If that scenery is mount-static — nothing under it moves, re-colours or ` +
    `unmounts after mount — one wrapper collapses it to a few draws: wrap it in ` +
    `${fix}…</Frozen>  (vgai add static-batch). Reactive scenery goes outside the wrapper, ` +
    `and a subtree that must stay unbatched declares it: userData={{ staticBatch: false }}.`;

  return { drawCalls, collapsible, subtree, fix, message };
}

/**
 * Once per PAGE, not once per module evaluation — a hot reload re-runs this
 * module, and an advisory that reappears on every save is one that gets muted
 * along with everything else on the console. Same mechanism, and the same
 * reason, as dev-tools' unconfigured-section warning.
 */
const WARNED_KEY = '__vgaiStaticBatchAdvised';

function alreadyWarned(): boolean {
  return (globalThis as unknown as Record<string, boolean | undefined>)[WARNED_KEY] === true;
}

/**
 * The console IS this advisory's channel: `vgai status` reports console
 * warnings, which is where a building agent already looks. An in-editor
 * banner would be one nobody opens, and a provider would be one nobody reads
 * without already knowing to ask.
 */
function warnOnConsole(message: string): void {
  // biome-ignore lint/suspicious/noConsole: this function's entire job — see above.
  console.warn(message);
}

/**
 * Emit `advisory` on the console, at most once per page. Answers whether it
 * warned, so a caller can stop scanning.
 */
export function warnStaticBatchAdvisory(
  advisory: StaticBatchAdvisory,
  /** Injectable so the decision is testable without a console. */
  warn: (message: string) => void = warnOnConsole,
): boolean {
  if (alreadyWarned()) return false;
  (globalThis as unknown as Record<string, boolean>)[WARNED_KEY] = true;
  warn(advisory.message);
  return true;
}

/** Test-only: forget that the advisory was ever emitted. */
export function __resetStaticBatchAdvisoryForTest(): void {
  (globalThis as unknown as Record<string, boolean | undefined>)[WARNED_KEY] = undefined;
}
