/**
 * Godot's `Timer` — mutable state and one source-ordered timeout per caller-owned tree tick.
 *
 * The pilot runs on four of these (`StartTimer` 2 s one-shot, `MobTimer` 0.5 s,
 * `ScoreTimer` 1 s, `MessageTimer` 2 s one-shot) plus two
 * `get_tree().create_timer(1)` waits, and they are the game's entire clock:
 * every mob spawn, every point scored and both `yield`s hang off a `timeout`.
 *
 * The dt comes from the port, through `scene-tree.ts`'s `tick(dt)`, from
 * time the game already has — the host's SIM dt in both emitted lanes
 * (`useTick(({ deltaMS }) => …)` on the game-time-pinned Pixi ticker for a
 * canvas port, `useFrame((_state, delta) => …)` on the `frameloop: 'never'` R3F
 * root for a three port). `scene-tree.ts`'s header spells both wirings out.
 *
 * Counting stays here because both pinned Timer implementations use a strict `time_left < 0`
 * boundary and emit at most once per process notification. The engine's general Countdown uses
 * `<= 0` and deliberately drains every elapsed period in one step; using it here changes both
 * boundary timing and event count during a hitch. This tiny state machine owns no clock or loop.
 *
 *  - **the member names and their Godot meanings**: `wait_time`, `one_shot`,
 *    `time_left` (0 when stopped), `is_stopped()`, and `timeout` as a real
 *    connectable SIGNAL rather than the engine countdown's single callback —
 *    `signal.ts`'s `connect`/`disconnect`/one-shot is what an emitted
 *    `$MobTimer.timeout.connect(...)` and `yield(timer, "timeout")` bind to.
 *  - **`one_shot`'s default**, which is Godot's `false` — a `Timer` REPEATS
 *    unless the `.tscn` says otherwise.
 *  - **`start(sec)`'s Godot 3.x meaning**: the argument is ASSIGNED to
 *    `wait_time` and the timer restarts — it is not a one-off duration. The
 *    pilot calls `$MobTimer.start()` on an already-running timer at
 *    `Main.gd:61`, which restarts it at the current `wait_time`.
 *  - **`wait_time`'s refusal.** Godot treats a non-positive `wait_time` as an
 *    error and never emits `timeout`, so a port that hits it looks HUNG rather
 *    than misconfigured. This file says that in the error text, before the
 *    engine's own generic range check can — the sentence is what a porter
 *    needs and the engine has no business knowing it.
 *  - **`autostart`**, as a `.tscn`-authored timer with `autostart = true` does
 *    the moment it enters the tree.
 *
 * ## Resource ownership
 *
 * A timer owns one signal, its countdown numbers, and the release for its one SceneTree slot.
 * `attachTimerToTree` records the real parent/tree identity and `exitTree` releases that slot.
 */

import { createSignal, type GodotSignal } from './signal';

/** Godot's retained `Timer` state, stepped only by its owning SceneTree. */
export interface GodotTimer {
  /** Node name used by SceneTree path/child traversal; empty until dynamic add_child assigns one. */
  name: string;
  /** `timer.timeout` — emitted each time the countdown reaches zero. */
  readonly timeout: GodotSignal<[]>;
  /** `timer.wait_time`. Reading it reflects the last `start(sec)`. */
  waitTime: number;
  /** `timer.one_shot`. */
  oneShot: boolean;
  /** `timer.autostart`; consumed and reset when the node enters the tree. */
  autostart: boolean;
  /** Pausing suspends countdown without changing `time_left` or stopped state. */
  paused: boolean;
  ignoreTimeScale: boolean;
  processCallback: number;
  /** `timer.time_left` — seconds remaining, or 0 when stopped. */
  readonly timeLeft: number;
  /** `timer.is_stopped()`. */
  readonly isStopped: boolean;
  readonly isInsideTree: boolean;
  readonly parent: object | null;
  readonly tree: TimerTree | null;
  /** Authored sibling seat; absent on dynamic Timer.new(), whose add_child appends. */
  readonly siblingIndex: number | undefined;
  /** Internal SceneTreeTimer policy: ordinary Timer nodes always process while their Node mode allows. */
  readonly processAlways: boolean;
  /** SceneTreeTimer phase selection. Timer nodes use processCallback instead. */
  readonly processInPhysics: boolean;
  setWaitTime(waitTime: number): void;
  setOneShot(enabled: boolean): void;
  setAutostart(enabled: boolean): void;
  setPaused(paused: boolean): void;
  setIgnoreTimeScale(ignore: boolean): void;
  setTimerProcessCallback(callback: number): void;
  getTimeLeft(): number;
  /**
   * `timer.start()` / `timer.start(sec)`. Restarts a running timer. Passing
   * `waitTime` overwrites the timer's own, exactly as Godot 3.x does.
   */
  start(waitTime?: number): void;
  /** `timer.stop()`. Emits nothing — Godot's `stop()` is silent. */
  stop(): void;
  /**
   * Advance by `dt` SECONDS. Called by `SceneTree.tick`; a timer the tree does
   * not know about is one the port must step itself.
   *
   * A step larger than the period emits once and carries overshoot. If it remains negative, later
   * tree ticks catch up one timeout each, matching Timer::_notification's single `if`.
   */
  tick(dt: number, rawDt?: number, phase?: 'idle' | 'physics', treePaused?: boolean): void;
  /** Compat lifecycle seam used by SceneTree/add_child; not a second scheduler. */
  enterTree(tree: TimerTree, parent: object, release: () => void): void;
  /** Idempotently leave the one SceneTree that owns this timer's stepping slot. */
  exitTree(): void;
}

/** The only SceneTree surface Timer attachment needs. */
export interface TimerTree {
  addTimer(timer: GodotTimer): () => void;
  registerNonDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
  queueFreeTimer(timer: GodotTimer): void;
}

/** What {@link createTimer} needs. Mirrors the three properties a `Timer` node
 *  carries in a `.tscn`. */
export interface CreateTimerOptions {
  /** Authored Node name. Dynamic `Timer.new()` starts unnamed. */
  readonly name?: string;
  /** Authored index among every sibling, including render and non-render Nodes. */
  readonly siblingIndex?: number;
  /** `wait_time`. Godot's own default is 1 second. */
  readonly waitTime?: number;
  /** `one_shot` — stop after the first `timeout` instead of repeating. */
  readonly oneShot?: boolean;
  /** `autostart` — begin counting immediately, as a `.tscn`-authored timer
   *  with `autostart = true` does the moment it enters the tree. */
  readonly autostart?: boolean;
  /** Begin suspended while retaining running/time-left state. */
  readonly paused?: boolean;
  readonly ignoreTimeScale?: boolean;
  readonly processCallback?: number;
  /** SceneTreeTimer process_always. Kept here so one retained countdown implements both timer kinds. */
  readonly processAlways?: boolean;
  /** SceneTreeTimer process_in_physics. */
  readonly processInPhysics?: boolean;
}

/**
 * Godot's own refusal, with the port-facing reason it matters: a non-positive
 * wait silently leaves gameplay waiting forever if it is not rejected here.
 */
function assertPositive(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `godot-compat: Timer wait_time must be a positive number of seconds, got ${String(value)}. ` +
        'Godot treats a non-positive wait_time as an error and never emits timeout, so a port ' +
        'that hits this looks hung rather than misconfigured.',
    );
  }
}

/**
 * Build a timer.
 *
 * ```ts
 * const mobTimer = createTimer({ waitTime: 0.5 });
 * tree.addTimer(mobTimer);
 * mobTimer.timeout.connect(() => spawnMob());
 * ```
 */
export function createTimer(options: CreateTimerOptions = {}): GodotTimer {
  const timeout = createSignal<[]>();
  let waitTime = options.waitTime ?? 1;
  assertPositive(waitTime);
  let oneShot = options.oneShot === true;
  let autostart = options.autostart === true;
  let paused = options.paused === true;
  let ignoreTimeScale = options.ignoreTimeScale === true;
  let processCallback = options.processCallback ?? 1;
  const processAlways = options.processAlways !== false;
  const processInPhysics = options.processInPhysics === true;
  if (processCallback !== 0 && processCallback !== 1) throw new RangeError('Timer.process_callback requires 0 or 1.');
  let insideTree = false;
  let parent: object | null = null;
  let tree: TimerTree | null = null;
  let treeRelease: (() => void) | undefined;
  let remaining = -1;
  let processing = false;

  const timer: GodotTimer = {
    name: options.name ?? '',
    timeout: timeout.signal,
    get waitTime(): number {
      return waitTime;
    },
    set waitTime(value: number) {
      timer.setWaitTime(value);
    },
    get oneShot(): boolean {
      return oneShot;
    },
    set oneShot(value: boolean) {
      timer.setOneShot(value);
    },
    get autostart(): boolean {
      return autostart;
    },
    set autostart(value: boolean) {
      timer.setAutostart(value);
    },
    get paused(): boolean {
      return paused;
    },
    get ignoreTimeScale(): boolean { return ignoreTimeScale; },
    set ignoreTimeScale(value: boolean) { timer.setIgnoreTimeScale(value); },
    get processCallback(): number { return processCallback; },
    set processCallback(value: number) { timer.setTimerProcessCallback(value); },
    set paused(value: boolean) {
      timer.setPaused(value);
    },
    get timeLeft(): number {
      return remaining > 0 ? remaining : 0;
    },
    get isStopped(): boolean {
      return timer.timeLeft <= 0;
    },
    get isInsideTree(): boolean {
      return insideTree;
    },
    get parent(): object | null {
      return parent;
    },
    get tree(): TimerTree | null {
      return tree;
    },
    get siblingIndex(): number | undefined {
      return options.siblingIndex;
    },
    get processAlways(): boolean { return processAlways; },
    get processInPhysics(): boolean { return processInPhysics; },
    setWaitTime(value): void {
      assertPositive(value);
      waitTime = value;
    },
    setOneShot(value): void {
      if (typeof value !== 'boolean') throw new TypeError('Timer.one_shot must be a boolean.');
      oneShot = value;
    },
    setAutostart(value): void {
      if (typeof value !== 'boolean') throw new TypeError('Timer.autostart must be a boolean.');
      autostart = value;
    },
    setPaused(value): void {
      if (typeof value !== 'boolean') throw new TypeError('Timer.paused must be a boolean.');
      paused = value;
    },
    setIgnoreTimeScale(value): void {
      if (typeof value !== 'boolean') throw new TypeError('Timer.ignore_time_scale must be a boolean.');
      ignoreTimeScale = value;
    },
    setTimerProcessCallback(value): void {
      if (value !== 0 && value !== 1) throw new RangeError('Timer.process_callback requires TIMER_PROCESS_PHYSICS or TIMER_PROCESS_IDLE.');
      processCallback = value;
    },
    getTimeLeft(): number {
      return timer.timeLeft;
    },
    start(newWaitTime): void {
      if (!insideTree) {
        throw new Error(
          'Timer.start requires the Timer to be inside the SceneTree; add_child(timer) or use autostart.',
        );
      }
      // Both pinned implementations accept -1 by default and only assign a strictly-positive
      // override; zero/negative values retain the current wait_time.
      if (newWaitTime !== undefined && newWaitTime > 0) timer.setWaitTime(newWaitTime);
      remaining = waitTime;
      processing = true;
    },
    stop(): void {
      remaining = -1;
      processing = false;
      autostart = false;
    },
    tick(dt, rawDt = dt, phase = 'idle', treePaused = false): void {
      if (!Number.isFinite(dt) || dt < 0) {
        throw new RangeError(`Timer tick delta must be finite and non-negative; received ${String(dt)}.`);
      }
      if (!processing || paused) return;
      if (options.processInPhysics !== undefined) {
        if (processInPhysics !== (phase === 'physics')) return;
        if (treePaused && !processAlways) return;
      } else if ((processCallback === 0) !== (phase === 'physics')) {
        return;
      }
      if (!Number.isFinite(rawDt) || rawDt < 0) throw new RangeError('Timer raw tick delta must be finite and non-negative.');
      remaining -= ignoreTimeScale ? rawDt : dt;
      if (remaining >= 0) return;
      if (oneShot) timer.stop();
      else remaining += waitTime;
      timeout.emit();
    },
    enterTree(nextTree, nextParent, release): void {
      if (insideTree) {
        throw new Error('Timer cannot enter a second SceneTree while it is already attached.');
      }
      insideTree = true;
      tree = nextTree;
      parent = nextParent;
      treeRelease = release;
      if (autostart) {
        timer.start();
        autostart = false;
      }
    },
    exitTree(): void {
      if (!insideTree) return;
      insideTree = false;
      tree = null;
      parent = null;
      const release = treeRelease;
      treeRelease = undefined;
      release?.();
    },
  };
  return timer;
}

/** Attach the Timer node to the caller-owned SceneTree stepping set. */
export function attachTimerToTree(tree: TimerTree, parent: object, timer: GodotTimer): () => void {
  if (timer.isInsideTree) {
    throw new Error('Timer cannot enter a second SceneTree while it is already attached.');
  }
  let releaseStep: (() => void) | undefined;
  let releaseChild: (() => void) | undefined;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    releaseStep?.();
    releaseChild?.();
  };
  try {
    releaseStep = tree.addTimer(timer);
    releaseChild = tree.registerNonDisplayChild(parent, timer, timer.siblingIndex);
    timer.enterTree(tree, parent, release);
  } catch (error) {
    release();
    throw error;
  }
  return () => timer.exitTree();
}

/** `Timer.queue_free()` — deferred through the owning tree and idempotent with parent teardown. */
export function queueFreeTimer(timer: GodotTimer): void {
  const tree = timer.tree;
  if (tree === null) return;
  tree.queueFreeTimer(timer);
}
