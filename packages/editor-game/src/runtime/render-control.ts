/**
 * Render-control runtime seam (I2). This is the harness a deterministic-capture host
 * (Playwright/CDP, I0/I3/I4) drives: exact-time seeks against the canonical
 * `AnimationClock` (`animation/animation-clock.ts`), and single `preRender`+`render`
 * phase passes across every world on a `Game` (`runtime/game.ts`) — WITHOUT ever
 * advancing gameplay fixed-step substeps
 * (`input`/`prePhysics`/`physics`/`postPhysics`/`gameLogic`/`animation` are never
 * invoked by this seam; `--simulate` (I5) is a different, later, path that
 * deliberately drives `game.runFrame(fixedDt)` instead).
 *
 * This module does NOT reuse `PlayState.step()` (`Game.play.step()`) — that
 * surface only advances the currently-FROZEN (paused) set of roots and is a
 * whole-call no-op while unpaused (see its doc comment in `runtime/game.ts`);
 * the spec review explicitly flagged it as the wrong seam. `renderOnce`
 * instead walks `game.roots` directly and calls each world's own
 * `RootFrameHooks.runPhase` for exactly two phases.
 *
 * Also does NOT install anything by default — a caller must explicitly call
 * {@link installRenderControlHarness}, and even then it only actually
 * publishes `window.__vgaiRender` when the page's URL opts in via
 * `?vgai-render=1` (AC 4: unavailable/protected in normal production
 * gameplay unless explicitly enabled). See `render-seed.ts` for the
 * matching `Math.random` determinism hardening, which must run BEFORE this
 * module (or any other game module) is even imported.
 *
 * I5 (`--simulate` render, §15 I5) is implemented HERE, alongside `renderOnce`:
 * {@link VgaiRenderHarness.simulateSubsteps} drives `game.runFrame(fixedDt)` a
 * fixed integer number of times — the FULL fixed-step gameplay frame (every
 * phase in `PHASE_ORDER`, including `physics`/`gameLogic`/`animation`), unlike
 * `renderOnce`'s deliberately gameplay-free `preRender`+`render`-only pass.
 * A caller that never invokes `simulateSubsteps` (the default, sequence-
 * controlled render — I4) gets byte-identical behavior to before this method
 * existed: `renderOnce`/`seek`/`seekFrame`/`advanceFrame` are untouched by
 * this addition.
 */

import { SystemPhase } from './core/types';
import type { Game, GameInternal, RootFrameHooks } from './game';
import { RENDER_MODE_QUERY_PARAM } from './render-seed';

/** Per-subsystem readiness verdict (I2 AC: "Runtime reports asset, shader,
 *  font, sequence, Tone, and scene readiness"). `not-applicable` is the
 *  correct answer for any subsystem genuinely absent from a given fixture
 *  (spec note: "If a subsystem isn't present in the fixture, report it as
 *  not-applicable rather than failing") — never coerced to `ready`. */
export type ReadinessStatus = 'ready' | 'not-applicable' | 'error';

export interface ReadinessEntry {
  readonly status: ReadinessStatus;
  readonly detail?: string;
}

/** The full readiness report `ready()` resolves. One entry per subsystem
 *  named in the I2 AC, always present (never a sparse/optional object) so a
 *  caller can read every key unconditionally. */
export interface ReadinessReport {
  readonly assets: ReadinessEntry;
  readonly shaders: ReadinessEntry;
  readonly fonts: ReadinessEntry;
  readonly sequences: ReadinessEntry;
  readonly tone: ReadinessEntry;
  readonly scene: ReadinessEntry;
}

/**
 * Caller-supplied per-subsystem readiness checks. Each hook is optional:
 * absence means that subsystem genuinely does not exist in this fixture/game
 * (reported `not-applicable`), NOT that it's assumed ready. A hook that
 * resolves is `ready`; one that throws/rejects is `error` with the message
 * captured (never silently swallowed, never escalated to fail the whole
 * `ready()` call — one subsystem's failure must not hide the others' status).
 * `fonts` has no hook slot: it is always checked directly against
 * `document.fonts.ready` (universally meaningful in a browser render page),
 * matching the AC's explicit `document.fonts.ready` callout.
 */
export interface RenderReadinessHooks {
  assets?(): Promise<void> | void;
  shaders?(): Promise<void> | void;
  sequences?(): Promise<void> | void;
  tone?(): Promise<void> | void;
  scene?(): Promise<void> | void;
}

/** The minimal clock surface this seam drives — `AnimationClock`'s `seek`/
 *  `seekFrame` (`animation/animation-clock.ts`). Typed narrowly (not
 *  imported as a value) so this module never depends on the clock's full
 *  surface, just the two methods the render seam actually calls. */
export interface SeekableClock {
  seek(t: number): unknown;
  seekFrame(n: number, fps: number): unknown;
}

/**
 * I8 render-integration seam: a per-frame, fixed-`dt` advance hook — exactly
 * the engine's `SystemFn` shape (`core/types.ts`) — for a
 * cinematic-participating system whose live-gameplay driver `renderOnce()`
 * deliberately bypasses. The motivating case is `bindXStateAnimation`'s
 * `tick` (`animation/xstate-animation-binding.ts`, E2): in live play it
 * rides the fixed-step `'animation'` phase
 * (`ctx.systems.add(SystemPhase.ANIMATION, binding.tick)`), but
 * `renderOnce()` (I2) runs ONLY `preRender`+`render` — the `'animation'`
 * phase, along with every other gameplay phase, is never touched by design
 * (see this module's top doc comment). Without a distinct advance hook, an
 * `AnimationMixer` driven this way would sit frozen for the entire render:
 * nothing would ever call `mixer.update(dt)`. `advanceFrame` (below) is that
 * hook — a small, explicit registry of `FrameAdvancer`s a render-mode page
 * opts into via {@link RenderControlHarnessOptions.frameAdvancers}, invoked
 * in registration order.
 */
export type FrameAdvancer = (dt: number) => void;

/** The `window.__vgaiRender` surface (I2 AC, extended by I8's `advanceFrame`).
 *  Every method here is synchronous except the two that genuinely need to
 *  wait on the browser (composited render completion, async readiness
 *  probes). */
export interface VgaiRenderHarness {
  /** Evaluate every registered sequence/cinematic-participating evaluator at
   *  exact time `t` (seconds) via `clock.seek(t)` — never advances gameplay
   *  substeps. Synchronous: the clock's subscribed evaluators run inline,
   *  before this call returns. */
  seek(t: number): void;
  /** Exact-frame variant — `clock.seekFrame(n, fps)`, i.e. `start + n/fps`,
   *  bit-exact and drift-free across repeated calls. Same no-substep
   *  semantics as {@link seek}. */
  seekFrame(n: number, fps: number): void;
  /**
   * I8 render-integration seam: advance every registered
   * {@link FrameAdvancer} (e.g. an XState/`AnimationMixer` binding's `tick`)
   * by exactly `dt` seconds, in registration order. A render-mode capture
   * loop calls this ONCE per OUTPUT frame, with `dt = 1 / fps`, BEFORE
   * `seekFrame`/`renderOnce` for that frame — see
   * `packages/vgai-sdk/src/render/render-cinematic.ts`'s `captureFrames`, which
   * drives exactly this sequence. `advanceFrame` is a genuinely
   * FORWARD-ONLY, INCREMENTAL tick (it has no notion of "time" to seek
   * to — it only knows "advance by `dt` more") — unlike {@link seek}/
   * {@link seekFrame}, which are absolute and idempotent, calling
   * `advanceFrame` twice never undoes or re-derives a prior call, it always
   * accumulates. This composes correctly with I4's default sequence-
   * controlled render (and I8's reference cinematic) specifically BECAUSE
   * that capture loop only ever walks output frames monotonically forward
   * (`n = 0, 1, 2, ...`); it is NOT safe to call from a scrubber/editor
   * preview that seeks backward or re-visits a frame — a caller that needs
   * that (a future `--simulate`/preview seam) must not reuse this hook as-is.
   * A no-op when no advancers are registered (the default), so this method
   * is always present and always safe to call even for a fixture with
   * nothing to advance (e.g. the I0 `render-cinematic` fixture).
   */
  advanceFrame(dt: number): void;
  /** Runs exactly one `preRender`+`render` phase pass across every
   *  host-driven world on the `Game` (z-order is a DOM/canvas-stacking
   *  concern already handled by `create-runtime.ts`'s surface stack — this
   *  call does not need to reorder anything to composite correctly), then
   *  resolves after a double-`requestAnimationFrame` composition fence. */
  renderOnce(): Promise<void>;
  /** Resolves once every declared subsystem has reported in (see
   *  {@link ReadinessReport}). */
  ready(): Promise<ReadinessReport>;
  /**
   * I5 `--simulate` seam: advance the FULL fixed-step gameplay frame
   * (`game.runFrame(fixedDt)` — every phase in `PHASE_ORDER`: input,
   * prePhysics, physics, postPhysics, gameLogic, animation, preRender,
   * render) exactly `steps` times, synchronously, in a tight loop. This is
   * what makes physics/gameplay/AI/particles/participating-audio evolve
   * BETWEEN captured output frames under `--simulate` — every real gameplay
   * phase runs, unlike {@link renderOnce} (which runs ONLY `preRender`+
   * `render`, by design, for the I4 sequence-controlled default) or
   * {@link advanceFrame} (which ticks only registered {@link FrameAdvancer}s,
   * never a gameplay phase).
   *
   * `fixedDt` is fixed for the lifetime of this harness (see
   * {@link RenderControlHarnessOptions.simulateFixedDt}, default `1/60` —
   * the same fixed timestep every real host's `createGameLoop` config
   * uses) — callers choose HOW MANY substeps to run per captured frame
   * (`steps`), not the substep's own `dt`, matching the I5 AC's "a fixed
   * integer number of times per output frame" wording exactly.
   *
   * A capture loop that wants BOTH a warmup period (I5 AC: "simulation
   * state can warm up before the capture range") and per-frame substeps
   * calls this twice: once with the warmup step count before frame 0, then
   * once per captured frame with the per-frame step count — there is no
   * separate "warmup" method, because warmup is just simulateSubsteps called
   * before the capture loop starts (see `render-cinematic.ts`'s
   * `captureFrames`, which drives exactly this sequence for `--simulate`
   * requests).
   */
  simulateSubsteps(steps: number): void;
  /**
   * I5 AC 5 ("the render report names every subsystem excluded from
   * deterministic participation"): every subsystem NOT participating in
   * deterministic capture, computed fresh on every call from two sources —
   * (1) `RenderControlHarnessOptions.excludedFromDeterminism`, a static,
   * page-declared list (e.g. "live Colyseus networking", "non-seeded ambient
   * audio") this fixture/game names about itself, and (2) any world this
   * seam itself could not frame-gate (a `drivesOwnLoop` world, or a
   * host-driven world with no `RootFrameHooks` — the SAME two conditions
   * {@link renderOnce}'s `renderableRoots` skips, described here as policy
   * rather than merely warned about once to the console). Declared entries
   * come first, in declaration order; world-exclusion entries follow, in
   * `game.roots` declaration order.
   */
  excludedFromDeterminism(): string[];
  /**
   * I7 fold-in (I5 nit): the ACTUAL fixed substep `dt` (seconds) this
   * harness passes to every `game.runFrame(fixedDt)` call inside
   * {@link simulateSubsteps} — i.e. `RenderControlHarnessOptions.simulateFixedDt`,
   * resolved with its own `1/60` default already applied. Exists so the
   * render pipeline (`render-cinematic.ts`'s `RenderManifestSimulate
   * .fixedTimestep`) can report the REAL value a fixture is using instead of
   * assuming every fixture matches the harness's own default — a fixture
   * that configures a different `simulateFixedDt` (a different Rapier/
   * physics substep) now shows up correctly in the render manifest rather
   * than a silently wrong hardcoded `1/60`.
   */
  simulateFixedDt(): number;
  /**
   * W3d (F11 perf regression gates) — the `vgai perf` sampling seam. Runs
   * exactly `steps` FULL fixed-step gameplay frames (the same
   * `game.runFrame(fixedDt)` path {@link simulateSubsteps} drives — every
   * phase in `PHASE_ORDER`, including `render`, so `renderer.info`-backed
   * draw/triangle counters populate per frame) with the game's OWN
   * `PerformanceProfiler` (`dev/performance-profiler.ts`) enabled, sampling
   * it after every frame, then restores the profiler's prior enabled state.
   * Returns per-frame CPU/phase timings + render counters, plus a
   * structural node/entity count of every three/canvas world's live scene
   * graph. NOT a parallel instrumentation layer: every number here comes
   * from the existing profiler (timings, render counters) or the live world
   * roots themselves (counts).
   *
   * Honesty notes, recorded here because this seam is what `vgai perf`
   * reports: `gpuMs` is whatever the profiler's render reporter measured —
   * `null` under headless SwiftShader (no usable GPU timer), never a
   * fabricated 0; CPU timings include the profiler's own (small) phase
   * bookkeeping, inherent to profiling; warmup belongs OUTSIDE this call
   * (drive {@link simulateSubsteps} first — profiler disabled, zero
   * overhead).
   */
  perfSample(steps: number): PerfSampleReport;
}

/** One measured fixed-step frame from {@link VgaiRenderHarness.perfSample}. */
export interface PerfFrameSample {
  /** CPU time (ms) for the whole `runFrame` pass (profiler `cpuMs`). */
  readonly cpuMs: number;
  /** Per-phase CPU ms (profiler phase timings), keyed by phase name. */
  readonly phases: Readonly<Record<string, number>>;
  /** Renderer counters reported during this frame's `render` phase
   *  (`profiler.reportRender` — renderer.info). All zeros/null for a world
   *  whose adapter never reports render stats. */
  readonly render: {
    readonly gpuMs: number | null;
    readonly drawCalls: number;
    readonly triangles: number;
    readonly geometries: number;
    readonly textures: number;
  };
}

/** Per-world structural counts from {@link VgaiRenderHarness.perfSample}. */
export interface PerfRootCount {
  readonly id: string;
  readonly kind: string;
  /** Total scene-graph descendants of the world root (exclusive of the root
   *  itself). Exact and deterministic under a seed. */
  readonly nodes: number;
  /** Descendants carrying `userData.entityId` (the loader/editor entity
   *  tag). 0 for a hand-built world that tags nothing — an honest count of
   *  tagged nodes, not a guess at "entities". */
  readonly entities: number;
}

export interface PerfSampleReport {
  readonly frames: readonly PerfFrameSample[];
  /** three/canvas worlds only — a react/DOM world has no scene-graph node
   *  count; it is omitted rather than fabricated. */
  readonly worlds: readonly PerfRootCount[];
}

export interface RenderControlHarnessOptions {
  /**
   * `GameInternal` (not just the game-facing `Game`) — this harness is
   * itself a host (the render/capture driver), and I5's
   * {@link VgaiRenderHarness.simulateSubsteps} needs the host-only
   * `runFrame` surface (`runtime/game.ts`'s `GameInternal.runFrame` doc
   * comment: "the host loop ... and `GameSession.step()` are the only
   * callers"). Every real call site already holds a `GameInternal` (the
   * direct return of `createGame(...)`), so this is not a new construction
   * requirement, just a narrower declared type than before I5.
   */
  readonly game: GameInternal;
  readonly clock: SeekableClock;
  readonly readiness?: RenderReadinessHooks;
  /** Where to publish the harness. Defaults to the real `window` — override
   *  in a unit test to avoid touching the global object. */
  readonly target?: Record<string, unknown>;
  /** Where to read `?vgai-render=1` from. Defaults to `window.location`. */
  readonly location?: { readonly search: string };
  /** I8 render-integration seam — see {@link VgaiRenderHarness.advanceFrame}.
   *  Zero or more `FrameAdvancer`s invoked, in array order, on every
   *  `harness.advanceFrame(dt)` call. Default `[]` (no-op), which is exactly
   *  what a fixture with nothing gameplay-phase-driven (e.g. I0's fixture)
   *  needs — `advanceFrame` is still present on the harness, it just has
   *  nothing to do. */
  readonly frameAdvancers?: readonly FrameAdvancer[];
  /**
   * I5 `--simulate` seam: the fixed substep `dt` (seconds)
   * {@link VgaiRenderHarness.simulateSubsteps} passes to every
   * `game.runFrame(fixedDt)` call. Default `1/60` — the same fixed timestep
   * every real host's `createGameLoop` config uses (`create-runtime.ts`), so
   * a `--simulate` fixture's Rapier world (whose own `integrationParameters.dt`
   * defaults to `1/60`) stays in lockstep with the gameplay substep unless a
   * fixture deliberately configures both to a different, still-matching,
   * value.
   */
  readonly simulateFixedDt?: number;
  /**
   * I5 AC 5 — see {@link VgaiRenderHarness.excludedFromDeterminism}. A
   * static, page-declared list of subsystems this fixture/game has that do
   * NOT participate in deterministic capture (e.g. live networking,
   * non-seeded ambient audio) — named here as an explicit, reviewable
   * policy rather than silently dropped. Default `[]` (nothing to declare —
   * correct for a fixture with no such subsystem).
   */
  readonly excludedFromDeterminism?: readonly string[];
}

/** Shared by {@link installRenderControlHarness} and any caller that wants
 *  to check the opt-in flag before doing render-mode-only setup work (e.g.
 *  `render-seed.ts`'s own gate uses the same query param name). */
export function isRenderModeRequested(location: { readonly search: string }): boolean {
  return new URLSearchParams(location.search).get(RENDER_MODE_QUERY_PARAM) === '1';
}

const RENDER_ONLY_PHASES = [SystemPhase.PRE_RENDER, SystemPhase.RENDER] as const;

/**
 * Run exactly one `preRender`+`render` phase pass across every host-driven
 * (`!drivesOwnLoop`) world on `game`, then await the GPU/DOM composition
 * fence. This is the ENTIRE frame this call drives — no `input`,
 * `prePhysics`, `physics`, `postPhysics`, `gameLogic`, or `animation` phase
 * is ever touched, which is what makes this safe to call from a paused-or-
 * stopped clock without silently ticking gameplay. Phases are run as global
 * barriers across roots (mirroring `GameInternal.runFrame`'s own phase-then-
 * world nesting in `runtime/game.ts`): every world's `preRender` runs before
 * any world's `render`, in `game.roots` declaration order.
 *
 * Ordering within a phase mirrors `GameInternal.runFrame` EXACTLY (see its
 * doc comment in `runtime/game.ts`): the game-scoped `SystemRunner`
 * (`game.systems`) runs FIRST, before any world's frame hooks. `game.systems`
 * is empty for every game today (nothing registers against it yet), so this
 * is a no-op in practice — but a later slice that registers a Game-scoped
 * `preRender`/`render` system (e.g. a cinematic camera crossfade that must
 * paint once per captured frame) would otherwise be silently MISSED by
 * capture while running fine in live playback, since live playback goes
 * through `runFrame`. Running it here keeps the seam a faithful subset of
 * `runFrame`'s phase pass, not a divergent one.
 *
 * A `drivesOwnLoop` world (self-driven, raw-rAF) has no phase hooks this
 * seam can drive — it is skipped with a loud, once-per-call warning rather
 * than silently omitted, mirroring this file's "fail loudly, never a silent
 * no-op" convention. A host-driven world with no `frame` (an opaque/foreign
 * mount) is skipped the same way — there is no phase hook to call. Both
 * checks happen ONCE, up front (see {@link renderableRoots}), not per
 * phase — a world unrenderable in `preRender` is unrenderable in `render`
 * too, so warning twice would just be noise.
 */
async function renderOnce(game: Game): Promise<void> {
  const roots = renderableRoots(game);
  for (const phase of RENDER_ONLY_PHASES) {
    // Game-scoped systems first, then per-world frame hooks — the SAME order
    // GameInternal.runFrame uses (runtime/game.ts). See doc comment above.
    game.systems.runPhase(phase, 0);
    for (const world of roots) {
      world.frame.runPhase(phase, 0);
    }
  }
  await compositionFence();
}

interface RenderableRoot {
  readonly id: string;
  readonly frame: RootFrameHooks;
}

/** Filter `game.roots` down to the ones {@link renderOnce} can actually
 *  drive (host-driven, with real `RootFrameHooks`) — see that function's
 *  doc comment for why an excluded world is warned about loudly, not
 *  silently dropped. */
function renderableRoots(game: Game): RenderableRoot[] {
  const result: RenderableRoot[] = [];
  for (const world of game.roots) {
    if (world.mounted.drivesOwnLoop) {
      warnUnrenderable(world.id, 'drives its own loop — renderOnce() cannot frame-gate it');
      continue;
    }
    if (!world.frame) {
      warnUnrenderable(
        world.id,
        `(kind: ${world.kind}) has no phase hooks — renderOnce() cannot drive it (opaque/foreign ` +
          'mount with no frame-gated entry point)',
      );
      continue;
    }
    result.push({ id: world.id, frame: world.frame });
  }
  return result;
}

function warnUnrenderable(worldLabel: string, reason: string): void {
  // biome-ignore lint/suspicious/noConsole: structured, greppable — mirrors runtime/game.ts's own direct console.warn idiom for "cannot gate this world" capability shortfalls.
  console.warn(`[render-control] world "${worldLabel}" ${reason}.`);
}

/**
 * I5 AC 5 policy text for the two conditions {@link renderableRoots} skips —
 * shared so {@link VgaiRenderHarness.excludedFromDeterminism} names the SAME
 * roots `renderOnce()` warns about, in the SAME words, rather than
 * maintaining a second, driftable description of the same two checks.
 */
function computeRootExclusionReasons(game: Game): string[] {
  const reasons: string[] = [];
  for (const world of game.roots) {
    if (world.mounted.drivesOwnLoop) {
      reasons.push(
        `world "${world.id}" drives its own loop — cannot be frame-gated for deterministic ` +
          'capture (the policy is to FAIL LOUDLY, or be excluded only by an explicit declared ' +
          'policy).',
      );
      continue;
    }
    if (!world.frame) {
      reasons.push(
        `world "${world.id}" (kind: ${world.kind}) has no phase hooks — an opaque/foreign mount ` +
          'with no frame-gated entry point cannot participate in deterministic capture.',
      );
    }
  }
  return reasons;
}

/** Structural scene-graph walk shared by three (`Object3D`) and canvas
 *  (`Container`) roots — both expose a `children` array, and three nodes
 *  additionally carry `userData` (where the loader/editor entity tag lives).
 *  Deliberately duck-typed so this file keeps its type-only three/pixi rule. */
function countRootGraph(root: { readonly children?: readonly unknown[] }): {
  nodes: number;
  entities: number;
} {
  let nodes = 0;
  let entities = 0;
  const stack: unknown[] = [...(root.children ?? [])];
  while (stack.length > 0) {
    const node = stack.pop() as {
      readonly children?: readonly unknown[];
      readonly userData?: Record<string, unknown>;
    };
    nodes++;
    if (node.userData?.['entityId'] !== undefined) entities++;
    if (node.children) stack.push(...node.children);
  }
  return { nodes, entities };
}

/** See {@link PerfSampleReport.worlds} — three/canvas worlds only; a
 *  react/DOM world has no scene-graph node count and is omitted, never
 *  fabricated. */
function countRoots(game: Game): PerfRootCount[] {
  const counts: PerfRootCount[] = [];
  for (const world of game.roots) {
    if (world.kind === 'three') {
      counts.push({ id: world.id, kind: world.kind, ...countRootGraph(world.threeScene()) });
    } else if (world.kind === 'canvas') {
      // Node counting is a substrate projection, not a surface fact. Pixi's
      // native tree exposes `children`; other canvas substrates are omitted
      // until their adapter declares an honest counter.
      if (world.mounted.kind === 'canvas' && world.mounted.substrate.name === 'pixi') {
        counts.push({ id: world.id, kind: world.kind, ...countRootGraph(world.canvasRoot()) });
      }
    }
  }
  return counts;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * GPU/DOM composition fence (I2 AC: "waits for GPU/DOM composition
 * (double-rAF fence ... ) rather than an arbitrary sleep"). Two nested
 * `requestAnimationFrame` callbacks: the first fires once the browser has
 * scheduled a new frame after our `render()` calls above; the second fires
 * once THAT frame has itself been produced and composited — by the time the
 * second callback runs, the compositor has committed the frame our render
 * calls painted, so a screenshot taken immediately after this resolves
 * reflects the seeked state, not a stale one. (The CDP screenshot
 * compositor-commit wait itself is the capture host's job — I0/I3 — this
 * fence is the runtime-side half.)
 */
async function compositionFence(): Promise<void> {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

async function resolveHook(
  hook: (() => Promise<void> | void) | undefined,
): Promise<ReadinessEntry> {
  if (!hook) return { status: 'not-applicable' };
  try {
    await hook();
    return { status: 'ready' };
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkFontsReady(): Promise<ReadinessEntry> {
  if (typeof document === 'undefined' || !document.fonts) return { status: 'not-applicable' };
  try {
    await document.fonts.ready;
    return { status: 'ready' };
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function buildReadinessReport(hooks: RenderReadinessHooks): Promise<ReadinessReport> {
  const [assets, shaders, fonts, sequences, tone, scene] = await Promise.all([
    resolveHook(hooks.assets),
    resolveHook(hooks.shaders),
    checkFontsReady(),
    resolveHook(hooks.sequences),
    resolveHook(hooks.tone),
    resolveHook(hooks.scene),
  ]);
  return { assets, shaders, fonts, sequences, tone, scene };
}

/**
 * Build (and, when render mode is actually requested, publish) the
 * `window.__vgaiRender` harness. AC 4 — production protection — lives HERE,
 * not just at the call site: even if a host application calls this
 * unconditionally on every boot, the harness is only ever constructed *and*
 * attached to `target` when `isRenderModeRequested(location)` is true;
 * otherwise this is a no-op that returns `undefined`. A normal production
 * gameplay page therefore never gets `window.__vgaiRender` no matter how
 * this function is wired into its entry point.
 */
export function installRenderControlHarness(
  opts: RenderControlHarnessOptions,
): VgaiRenderHarness | undefined {
  const location = opts.location ?? window.location;
  if (!isRenderModeRequested(location)) return undefined;

  const { game, clock, readiness = {} } = opts;
  const target = opts.target ?? (window as unknown as Record<string, unknown>);
  const frameAdvancers = opts.frameAdvancers ?? [];
  const simulateFixedDt = opts.simulateFixedDt ?? 1 / 60;
  const declaredExclusions = opts.excludedFromDeterminism ?? [];

  const harness: VgaiRenderHarness = {
    seek(t: number): void {
      clock.seek(t);
    },
    seekFrame(n: number, fps: number): void {
      clock.seekFrame(n, fps);
    },
    advanceFrame(dt: number): void {
      for (const advancer of frameAdvancers) advancer(dt);
    },
    renderOnce(): Promise<void> {
      return renderOnce(game);
    },
    ready(): Promise<ReadinessReport> {
      return buildReadinessReport(readiness);
    },
    simulateSubsteps(steps: number): void {
      for (let i = 0; i < steps; i++) {
        game.runFrame(simulateFixedDt);
      }
    },
    excludedFromDeterminism(): string[] {
      return [...declaredExclusions, ...computeRootExclusionReasons(game)];
    },
    simulateFixedDt(): number {
      return simulateFixedDt;
    },
    perfSample(steps: number): PerfSampleReport {
      const profiler = game.profiler;
      const wasEnabled = profiler.enabled;
      profiler.enabled = true;
      profiler.clear();
      const frames: PerfFrameSample[] = [];
      try {
        for (let i = 0; i < steps; i++) {
          game.runFrame(simulateFixedDt);
          const snapshot = profiler.getSnapshot();
          const latest = snapshot.frames.at(-1);
          frames.push({
            cpuMs: latest?.cpuMs ?? 0,
            phases: Object.fromEntries((latest?.phases ?? []).map((p) => [p.name, p.ms])),
            render: { ...snapshot.render },
          });
        }
      } finally {
        profiler.enabled = wasEnabled;
      }
      return { frames, worlds: countRoots(game) };
    },
  };

  target['__vgaiRender'] = harness;
  return harness;
}

/**
 * Defensive assertion for the I2 AC "Pixi roots are pinned to the WebGL
 * renderer (not WebGPU) in render mode". In THIS engine that invariant
 * already holds unconditionally — no in-repo mount constructs a Pixi
 * `Application` with a WebGPU preference, and `setup/setup-renderer.ts` never
 * constructs a `WebGPURenderer` for three roots either — so there is no
 * live WebGPU code path for a first-party render-mode page to disable.
 * This helper exists for a render-mode installer that mounts a CUSTOM/
 * foreign pixi adapter (`create-runtime.ts`'s `{ module }` pixi path) this
 * engine did not construct itself, to assert the invariant against the
 * live mounted renderer rather than merely trusting it. Duck-typed against
 * pixi.js v8's numeric `RendererType` (`WEBGL = 1`, `WEBGPU = 2`,
 * `CANVAS = 4`) so this file never value-imports `pixi.js` (the same
 * type-only-pixi rule `runtime/game.ts`/`create-runtime.ts` document for
 * themselves).
 */
export function assertPixiRootIsWebGL(rendererType: unknown, worldId: string): void {
  const isWebGPU =
    rendererType === 2 || (typeof rendererType === 'string' && /webgpu/i.test(rendererType));
  if (isWebGPU) {
    throw new Error(
      `[render-control] world "${worldId}": Pixi renderer is WebGPU in render mode — ` +
        'render-control requires WebGL.',
    );
  }
}
