/**
 * Pure `game.events.expect` matcher — no Playwright. Default mode is an
 * ordered SUBSEQUENCE match (extra actual events are tolerated, including
 * interleaved ones); `{ exact: true }` requires the actual (fenced) event
 * window to equal `expected` position-for-position with nothing extra.
 */

import type { TickStampedEvent } from './types.js';

export interface EventsMatchOptions {
  exact?: boolean;
  /** All matched expected events must land within this many ticks of the
   *  fence (the snapshot `actual` was already filtered to). Optional —
   *  unset means no timing constraint beyond ordering. */
  withinTicks?: number;
}

export interface EventsMatchResult {
  matched: boolean;
  /** Index into `expected` of the first expectation the match couldn't
   *  satisfy; `null` when `matched` is true. */
  firstUnmatchedIndex: number | null;
}

/**
 * M9: `fenceTick` is the REAL fence (the tick `game.events.expect` fenced
 * `actual` from — `GameClient.fenceTick`, i.e. the test's own start), not
 * `actual[0].tick`. Using the first EVENT's tick as the fence under-counts
 * `withinTicks`: if the fence is tick 10 and the first matching event
 * happens at tick 50 (40 ticks after the fence), `actual[0].tick` would make
 * that look like "0 ticks since the fence" instead of 40.
 *
 * It is REQUIRED, and comes BEFORE `opts`. It used to be a trailing optional
 * with an `actual[0]?.tick ?? 0` back-compat default — i.e. the very
 * under-counting bug above, silently reinstated for anyone who forgot the
 * argument. The one production caller always had a real fence, so the
 * default only ever existed to be wrong. Also (M9): `{ exact: true }` honors
 * `withinTicks` too — previously only the default subsequence mode checked
 * it at all.
 */
export function matchEventsSubsequence(
  expected: string[],
  actual: TickStampedEvent[],
  fenceTick: number,
  opts: EventsMatchOptions = {},
): EventsMatchResult {
  if (opts.exact) {
    return matchExact(expected, actual, opts.withinTicks, fenceTick);
  }
  return matchSubsequence(expected, actual, opts.withinTicks, fenceTick);
}

function matchSubsequence(
  expected: string[],
  actual: TickStampedEvent[],
  withinTicks: number | undefined,
  fenceTick: number,
): EventsMatchResult {
  let expectedIdx = 0;
  for (const e of actual) {
    const wantName = expected[expectedIdx];
    if (wantName === undefined) break;
    if (e.event !== wantName) continue;
    if (withinTicks !== undefined && e.tick - fenceTick > withinTicks) continue;
    expectedIdx += 1;
  }
  if (expectedIdx >= expected.length) {
    return { matched: true, firstUnmatchedIndex: null };
  }
  return { matched: false, firstUnmatchedIndex: expectedIdx };
}

function matchExact(
  expected: string[],
  actual: TickStampedEvent[],
  withinTicks: number | undefined,
  fenceTick: number,
): EventsMatchResult {
  const len = Math.max(expected.length, actual.length);
  for (let i = 0; i < len; i++) {
    const want = expected[i];
    const gotEvent = actual[i];
    if (want !== gotEvent?.event) {
      return { matched: false, firstUnmatchedIndex: Math.min(i, Math.max(expected.length - 1, 0)) };
    }
    if (
      withinTicks !== undefined &&
      gotEvent !== undefined &&
      gotEvent.tick - fenceTick > withinTicks
    ) {
      return { matched: false, firstUnmatchedIndex: Math.min(i, Math.max(expected.length - 1, 0)) };
    }
  }
  return { matched: true, firstUnmatchedIndex: null };
}

/** Renders the "predicate" line `events.expect` uses in its failure block —
 *  there is no user predicate function for this assertion, so the failure
 *  block's generic `predicateSource` slot gets a description instead. */
export function describeEventsExpectation(
  expected: string[],
  opts: EventsMatchOptions = {},
): string {
  const optsText = opts.exact ? ', { exact: true }' : '';
  return `events.expect(${JSON.stringify(expected)}${optsText})`;
}
