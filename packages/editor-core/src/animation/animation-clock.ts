import { PHASE_ORDER, type SystemPhaseName } from '@volter/editor-project/core/system-phase';

/**
 * D1 — the canonical `AnimationClock` (spec §10 D1, §3.2, §4).
 *
 * VGAI owns exactly one clock per cinematic/scene context. It is the single
 * source of truth for "what time is it" that registered sequences,
 * GSAP timelines, and cinematic cue evaluators are seeked against (D2/D5/D7
 * — NOT implemented here, this unit is the clock only). The render seam
 * (I2) drives this clock's `seek(t)`/frame-index API directly, without ever
 * advancing gameplay substeps.
 *
 * Design constraints (from the spec and the D1 review notes):
 *
 *  - Time is in SECONDS with no hidden wall-clock read. This class never
 *    reads the system clock or a monotonic timer directly — the caller (the
 *    fixed-step game loop for live playback, or a render/export harness for
 *    offline scrubbing) is the only source of `dt`/target time. That is
 *    what makes `seek(t)` and frame-index seeking reproducible offline.
 *  - No parallel scheduler. Evaluator registration reuses the engine's own
 *    `SystemPhaseName`/`PHASE_ORDER` vocabulary (`core/types.ts`) — the same
 *    phase names every system in the engine already uses —
 *    so a sequence binding (D2), a GSAP registration (D7), and a cue
 *    evaluator (D5) can each declare which phase they conceptually belong
 *    to and be invoked in one deterministic, engine-wide order instead of
 *    each subsystem inventing its own ordering rule. IMPORTANT: this only
 *    orders evaluators relative to each other WITHIN one `emit()` — i.e.
 *    within a single `seek()`/`advance()` call. Registering at `'preRender'`
 *    does NOT mean an evaluator runs during the live engine's own
 *    `system-runner` `preRender` phase inside a running RAF frame — the
 *    clock is independent of the live game loop's phase execution (and
 *    during offline export/scrub there is no RAF frame at all). The shared
 *    vocabulary buys a familiar, documented ordering convention between
 *    clock-side evaluators, not a promise of interleaving with unrelated
 *    engine systems that happen to run in a same-named phase during a live
 *    frame.
 *  - Frame-index seeking for export must be EXACT: frame `n` at fps `f`
 *    always evaluates `start + n / f`, computed directly from `n` and `f`
 *    on every call — never by accumulating `1/f` repeatedly, which would
 *    drift. See `seekFrame` below.
 */

/** Sign of time evolution while the clock is actually playing. */
export type ClockDirection = 'forward' | 'reverse';

/** Coarse playback state. `advance()` is a no-op unless this is `'playing'`. */
export type ClockPlaybackState = 'playing' | 'paused' | 'stopped';

/** Loop/range metadata — the valid time domain `[start, end]`. */
export interface ClockRange {
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
}

/**
 * One contiguous, monotonic sweep of time within a single `[start, end]`
 * lap. A step that crosses a loop boundary produces MORE THAN ONE interval
 * (one per lap segment) so a cue evaluator can test each segment
 * independently and never conflate "crossed near the end of lap 1" with
 * "crossed near the start of lap 2".
 *
 * ## Cue-crossing detection convention (half-open)
 *
 * A cue/marker at time `t` is considered CROSSED by an interval iff:
 *
 *  - forward interval: `t > interval.from && t <= interval.to`
 *  - reverse interval: `t < interval.from && t >= interval.to`
 *
 * This is deliberately half-open on the "from" side and closed on the "to"
 * side (i.e. the endpoint the sweep is *arriving at* counts, the endpoint it
 * *departed from* does not). Consumers (D5 cinematic cues) MUST use exactly
 * this convention, never an inclusive-both-ends test: `seek()` is
 * idempotent and re-asserts a zero-length interval `{from: t, to: t}` on a
 * repeated seek to the same `t` (see `AnimationClock.seek`), and an
 * inclusive-both-ends detector would re-match that zero-length interval
 * (`from === to === t`) and double-fire on every repeated seek. The
 * half-open test above never matches a zero-length interval (`t > t` and
 * `t < t` are both always false), so a fire-once cue evaluator built on it
 * gets idempotent re-seeks "for free" with no extra bookkeeping.
 */
export interface ClockInterval {
  readonly from: number;
  readonly to: number;
  readonly direction: ClockDirection;
}

/**
 * What a subscribed evaluator receives on every `seek`/`advance` call that
 * changes (or idempotently re-asserts) the clock's position.
 */
export interface ClockCrossing {
  readonly previousTime: number;
  readonly currentTime: number;
  /** Direction of this specific crossing (not necessarily `clock.direction`,
   *  which reflects live playback intent — a `seek()` while paused still
   *  reports the direction it moved, or the last known direction if it was
   *  a no-op re-seek to the same time). */
  readonly direction: ClockDirection;
  readonly timeScale: number;
  /** True iff this crossing wrapped a loop boundary (produced 2+ intervals). */
  readonly looped: boolean;
  /**
   * The monotonic sweep segment(s) covered by this crossing, in
   * chronological evaluation order. Normally exactly one interval
   * `[previousTime, currentTime]`; a loop-wrapping step yields one interval
   * per lap segment traversed. A subscriber determines exactly which cue
   * times were crossed (and in which direction) by testing each interval,
   * never by comparing `previousTime`/`currentTime` directly — that alone
   * is ambiguous across a wrap.
   */
  readonly intervals: readonly ClockInterval[];
}

export type ClockEvaluator = (crossing: ClockCrossing) => void;

export interface ClockEvaluatorHandle {
  dispose(): void;
}

export interface AnimationClockOptions {
  /** Range start, in seconds. Default 0. */
  start?: number;
  /** Range end, in seconds. Default `Math.max(start, 1)`. */
  end?: number;
  /** Whether `advance()` wraps at the range boundary instead of clamping. Default false. */
  loop?: boolean;
  /** Playback rate multiplier, must be finite and >= 0. Default 1. */
  timeScale?: number;
}

const EPSILON = 1e-9;
// Bails a pathological single `advance(dt)` call out of lap-by-lap interval
// enumeration (e.g. an absurd `dt` at max time scale over a tiny loop range)
// so a single call can never spin unboundedly. Real fixed-step `dt`s never
// approach this.
const MAX_LAPS_PER_ADVANCE = 100_000;

interface SweepResult {
  pos: number;
  intervals: ClockInterval[];
  looped: boolean;
}

/** Advance `p0` forward by `distance` (>= 0) within `range`, honoring loop/clamp. */
function sweepForward(p0: number, distance: number, range: ClockRange): SweepResult {
  const length = range.end - range.start;
  const canLoop = range.loop && length > EPSILON;
  const intervals: ClockInterval[] = [];
  let pos = p0;
  let remaining = distance;
  let looped = false;
  let laps = 0;

  for (;;) {
    const distToEnd = range.end - pos;
    if (!canLoop || remaining <= distToEnd + EPSILON) {
      // Always clamp to range.end here, even when canLoop is true: this
      // terminal branch is reached whenever `remaining` is within EPSILON of
      // `distToEnd` (not just when it's exactly equal), so `pos + remaining`
      // can overshoot `range.end` by up to EPSILON on a loop range. Clamping
      // unconditionally (D1 follow-up, spec §10 D5) keeps `clock.time` from
      // ever exceeding `range.end`, which in turn keeps the NEXT advance()'s
      // `distToEnd` non-negative and prevents a degenerate `from > to`
      // interval on the following call.
      const to = Math.min(pos + remaining, range.end);
      intervals.push({ from: pos, to, direction: 'forward' });
      pos = to;
      break;
    }
    intervals.push({ from: pos, to: range.end, direction: 'forward' });
    remaining -= distToEnd;
    pos = range.start;
    looped = true;
    laps++;
    if (laps > MAX_LAPS_PER_ADVANCE) {
      const wrapped = range.start + (remaining % length);
      intervals.push({ from: pos, to: wrapped, direction: 'forward' });
      pos = wrapped;
      break;
    }
  }

  return { pos, intervals, looped };
}

/** Advance `p0` backward by `distance` (>= 0) within `range`, honoring loop/clamp. */
function sweepReverse(p0: number, distance: number, range: ClockRange): SweepResult {
  const length = range.end - range.start;
  const canLoop = range.loop && length > EPSILON;
  const intervals: ClockInterval[] = [];
  let pos = p0;
  let remaining = distance;
  let looped = false;
  let laps = 0;

  for (;;) {
    const distToStart = pos - range.start;
    if (!canLoop || remaining <= distToStart + EPSILON) {
      // Mirror of the forward-sweep clamp above: always clamp to
      // range.start here so a reverse advance() cannot undershoot it by up
      // to EPSILON on a loop range (D1 follow-up, spec §10 D5).
      const to = Math.max(pos - remaining, range.start);
      intervals.push({ from: pos, to, direction: 'reverse' });
      pos = to;
      break;
    }
    intervals.push({ from: pos, to: range.start, direction: 'reverse' });
    remaining -= distToStart;
    pos = range.end;
    looped = true;
    laps++;
    if (laps > MAX_LAPS_PER_ADVANCE) {
      const wrapped = range.end - (remaining % length);
      intervals.push({ from: pos, to: wrapped, direction: 'reverse' });
      pos = wrapped;
      break;
    }
  }

  return { pos, intervals, looped };
}

function clampToRange(t: number, range: ClockRange): number {
  if (t < range.start) return range.start;
  if (t > range.end) return range.end;
  return t;
}

interface EvaluatorEntry {
  phase: SystemPhaseName;
  order: number;
  fn: ClockEvaluator;
}

/**
 * The engine-owned canonical clock. See the module doc comment above for
 * the design constraints this implementation is bound by.
 */
export class AnimationClock {
  private _previousTime: number;
  private _currentTime: number;
  private _range: ClockRange;
  private _timeScale: number;
  private _playDirection: ClockDirection = 'forward';
  private _lastCrossingDirection: ClockDirection = 'forward';
  private _playbackState: ClockPlaybackState = 'stopped';
  private _evaluators: EvaluatorEntry[] = [];
  private _registrationCounter = 0;

  constructor(options: AnimationClockOptions = {}) {
    const start = options.start ?? 0;
    const end = options.end ?? Math.max(start, 1);
    if (end < start) {
      throw new Error(`[AnimationClock] range end (${end}) must be >= start (${start})`);
    }
    const timeScale = options.timeScale ?? 1;
    if (!Number.isFinite(timeScale) || timeScale < 0) {
      throw new Error(`[AnimationClock] timeScale must be a finite number >= 0, got ${timeScale}`);
    }
    this._range = { start, end, loop: options.loop ?? false };
    this._timeScale = timeScale;
    this._previousTime = start;
    this._currentTime = start;
  }

  /** Current playhead time, in seconds. */
  get time(): number {
    return this._currentTime;
  }

  /** Playhead time immediately before the most recent seek/advance. */
  get previousTime(): number {
    return this._previousTime;
  }

  /**
   * Playback direction. `'paused'` whenever `playbackState !== 'playing'`
   * (covers both `pause()` and `stop()`) — matches the spec's literal
   * `direction: forward | reverse | paused` acceptance criterion. The
   * underlying intended direction is preserved across pause/resume; see
   * `play()`.
   */
  get direction(): ClockDirection | 'paused' {
    return this._playbackState === 'playing' ? this._playDirection : 'paused';
  }

  get playbackState(): ClockPlaybackState {
    return this._playbackState;
  }

  get timeScale(): number {
    return this._timeScale;
  }

  set timeScale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`[AnimationClock] timeScale must be a finite number >= 0, got ${value}`);
    }
    this._timeScale = value;
  }

  get range(): ClockRange {
    return this._range;
  }

  /**
   * Update loop/range metadata. The current playhead is clamped into the
   * new range if necessary (reported as an ordinary crossing — same
   * evaluator path as `seek`/`advance` — so subscribers observe it).
   */
  setRange(next: Partial<Pick<ClockRange, 'start' | 'end' | 'loop'>>): void {
    const start = next.start ?? this._range.start;
    const end = next.end ?? this._range.end;
    const loop = next.loop ?? this._range.loop;
    if (end < start) {
      throw new Error(`[AnimationClock] range end (${end}) must be >= start (${start})`);
    }
    this._range = { start, end, loop };
    const clamped = clampToRange(this._currentTime, this._range);
    if (clamped !== this._currentTime) {
      this.seek(clamped);
    }
  }

  /**
   * Begin/resume playback. `direction` sets (or re-asserts) the intended
   * playback direction for subsequent `advance()` calls; omit it to resume
   * in whatever direction was last set (default `'forward'` the first time).
   */
  play(direction?: ClockDirection): void {
    if (direction) this._playDirection = direction;
    this._playbackState = 'playing';
  }

  /** Halt playback at the current position. `advance()` becomes a no-op. */
  pause(): void {
    this._playbackState = 'paused';
  }

  /**
   * Halt playback at the current position (distinct from `pause()` only in
   * reported `playbackState`; this unit does not prescribe a reset-to-start
   * policy — that is a cinematic-controller/render-seam decision, D5/I2).
   * `advance()` is a no-op in this state, same as `paused`.
   */
  stop(): void {
    this._playbackState = 'stopped';
  }

  /**
   * Jump directly to `t` (clamped into `range`). Idempotent: calling
   * `seek(t)` twice in a row leaves `time`/`previousTime` identical to
   * calling it once — the second call is a true no-op (no state mutation,
   * though evaluators still fire so a subscriber can rely on `seek` always
   * producing a crossing for e.g. re-asserting visual state).
   */
  seek(t: number): ClockCrossing {
    const target = clampToRange(t, this._range);
    if (target === this._currentTime) {
      return this.emit(
        this._currentTime,
        this._currentTime,
        [{ from: target, to: target, direction: this._lastCrossingDirection }],
        false,
        this._lastCrossingDirection,
      );
    }
    const direction: ClockDirection = target > this._currentTime ? 'forward' : 'reverse';
    const prev = this._currentTime;
    this._previousTime = prev;
    this._currentTime = target;
    this._lastCrossingDirection = direction;
    return this.emit(prev, target, [{ from: prev, to: target, direction }], false, direction);
  }

  /**
   * Frame-index seek for export (D1 AC): seeks to EXACTLY `range.start +
   * n / fps`, computed fresh from `n`/`fps` on every call. This is what
   * keeps a rendered frame sequence drift-free — unlike repeatedly calling
   * `advance(1 / fps)` `n` times (which accumulates float error), this
   * always derives the same exact double for a given `(n, fps)` pair no
   * matter what the clock's prior state was.
   */
  seekFrame(n: number, fps: number): ClockCrossing {
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(`[AnimationClock] seekFrame fps must be a finite number > 0, got ${fps}`);
    }
    return this.seek(this._range.start + n / fps);
  }

  /**
   * Fixed-step advance by `dt` seconds (magnitude; sign of movement comes
   * from `direction`/`play()`, not from `dt`'s sign). A no-op whenever
   * `playbackState !== 'playing'` — this is what makes `advance()` do
   * nothing while paused (D1 AC). Returns `null` for that no-op case;
   * otherwise returns the resulting crossing (which may span multiple loop
   * laps if `dt * timeScale` exceeds the range length).
   */
  advance(dt: number): ClockCrossing | null {
    if (this._playbackState !== 'playing') return null;
    if (!Number.isFinite(dt)) {
      throw new Error(`[AnimationClock] advance(dt) requires a finite dt, got ${dt}`);
    }
    const magnitude = Math.abs(dt) * this._timeScale;
    const p0 = this._currentTime;
    if (magnitude === 0) {
      return this.emit(p0, p0, [], false, this._playDirection);
    }

    const result =
      this._playDirection === 'forward'
        ? sweepForward(p0, magnitude, this._range)
        : sweepReverse(p0, magnitude, this._range);

    this._previousTime = p0;
    this._currentTime = result.pos;
    this._lastCrossingDirection = this._playDirection;
    return this.emit(p0, result.pos, result.intervals, result.looped, this._playDirection);
  }

  /**
   * Register an evaluator against a phase from the engine's own
   * `SystemPhaseName` vocabulary (`core/types.ts`). Evaluators fire on
   * every `seek()`/`advance()` (including idempotent no-op seeks and
   * `setRange` clamps) in `PHASE_ORDER` order, then registration order
   * within a phase — the same "deterministic phase order" every other
   * engine system is invoked in, so a sequence binding, a registered-GSAP
   * seek, and a cue evaluator can each declare their phase and compose
   * without inventing a second ordering rule.
   */
  subscribe(phase: SystemPhaseName, evaluator: ClockEvaluator): ClockEvaluatorHandle {
    if (!PHASE_ORDER.includes(phase)) {
      throw new Error(
        `[AnimationClock] unknown phase "${phase}". Valid: ${PHASE_ORDER.join(', ')}`,
      );
    }
    const entry: EvaluatorEntry = { phase, order: this._registrationCounter++, fn: evaluator };
    this._evaluators.push(entry);
    return {
      dispose: () => {
        const idx = this._evaluators.indexOf(entry);
        if (idx !== -1) this._evaluators.splice(idx, 1);
      },
    };
  }

  private emit(
    previousTime: number,
    currentTime: number,
    intervals: ClockInterval[],
    looped: boolean,
    direction: ClockDirection,
  ): ClockCrossing {
    const crossing: ClockCrossing = {
      previousTime,
      currentTime,
      direction,
      timeScale: this._timeScale,
      looped,
      intervals,
    };
    if (this._evaluators.length > 0) {
      const ordered = [...this._evaluators].sort((a, b) => {
        const pa = PHASE_ORDER.indexOf(a.phase);
        const pb = PHASE_ORDER.indexOf(b.phase);
        return pa !== pb ? pa - pb : a.order - b.order;
      });
      for (const entry of ordered) {
        try {
          entry.fn(crossing);
        } catch (err) {
          console.error(`[AnimationClock] evaluator in phase "${entry.phase}" threw:`, err);
        }
      }
    }
    return crossing;
  }
}
