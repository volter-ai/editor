/**
 * THE LIVE TRANSITION — the immersive Liquid Glass hand-off between
 * authoring chrome and the running game, the host's side of
 * `host.viewport.transition` (WORK.md §Play leaves the host, P3). A lane
 * says when it starts (`beginLiveTransition`), when it is ready and when it
 * ends; the host decides whether the presentation is immersive and resolves
 * the flight target from the authored scene.
 *
 * On Play: the chrome dissolves, the editor viewport camera flies along a
 * Catmull-Rom spline from the preview pose to the AUTHORED game camera's
 * pose, and when both the flight has landed and the game runtime is ready the
 * Scene document cross-fades into the Game document. On Stop everything
 * reverses: camera snaps back to the pre-play preview pose and the chrome
 * re-materializes. `prefers-reduced-motion` collapses the whole choreography
 * to instant state changes with the same end state.
 *
 * Layering: this module owns TIMING, and it touches no layout at all. The
 * camera flight is the Three integration's (`@volter/editor-sdk/kit/play-camera-flight`,
 * registered by `@volter/editor-threejs`'s `play-camera-flight.ts`). The LAYOUT HOST registers `hideChrome`/`showChrome` through
 * {@link installPlayTransitionDock} — under the Code-OSS frame those are the
 * workbench's own parts going away and coming back (`frame/bridge.tsx`'s
 * `setImmersive`), which is the same inversion `workspace-host-commands.ts`
 * uses for semantic commands. Workspace persistence is suppressed for the
 * whole immersive play session (`setWorkspacePersistenceSuppressed`) so a
 * play-time open set can never overwrite the user's own. A non-immersive play
 * never enters this controller: it keeps the ordinary workspace visible.
 *
 * The pure parts — the durations, the phase reducer — are plain functions
 * with no DOM.
 */

import { layoutPolicy } from './layout-policy';
import { effectiveSettings } from '@volter/editor-sdk/kit/settings-store';
import { type LiveCameraLookup, playCameraFlight } from '@volter/editor-sdk/kit/play-camera-flight';
import { setWorkspacePersistenceSuppressed } from './workspace-persistence-gate';

/** Full-bleed play is the MOUNTED LAYOUT's own declaration
 *  (`WorkspaceLayoutPolicy.immersivePlay` — `GameLayout` is the shipped
 *  instance); no appearance axis implies it. */
export function usesImmersivePlayPresentation(): boolean {
  return (layoutPolicy()?.immersivePlay ?? false) && !effectiveSettings().play?.keepPanelsVisible;
}





// ---------------------------------------------------------------------------
// Pure transition phase reducer
// ---------------------------------------------------------------------------

export type PlayTransitionPhase =
  | 'idle'
  /** Dissolve + flight running concurrently. */
  | 'entering'
  /** Flight landed but the game runtime is still booting — hold the pose. */
  | 'holding'
  /** Both done — Scene → Game opacity cross-fade in progress. */
  | 'crossfade'
  /** Hand-off complete; game owns the screen until stop. */
  | 'playing';

export type PlayTransitionEvent =
  | 'start'
  | 'start-reduced'
  | 'flight-done'
  | 'game-ready'
  | 'crossfade-done'
  | 'stop';

export interface PlayTransitionState {
  readonly phase: PlayTransitionPhase;
  readonly flightDone: boolean;
  readonly gameReady: boolean;
}

export const IDLE_TRANSITION_STATE: PlayTransitionState = {
  phase: 'idle',
  flightDone: false,
  gameReady: false,
};

function reduceEnteringPhase(
  state: PlayTransitionState,
  event: PlayTransitionEvent,
): PlayTransitionState {
  const flightDone = state.flightDone || event === 'flight-done';
  const gameReady = state.gameReady || event === 'game-ready';
  if (flightDone && gameReady) return { phase: 'crossfade', flightDone, gameReady };
  if (flightDone) return { phase: 'holding', flightDone, gameReady };
  return { ...state, flightDone, gameReady };
}

/** Pure phase reducer — every timing side effect lives in the controller. */
export function reducePlayTransition(
  state: PlayTransitionState,
  event: PlayTransitionEvent,
): PlayTransitionState {
  if (event === 'stop') return IDLE_TRANSITION_STATE;
  switch (state.phase) {
    case 'idle':
      if (event === 'start') return { phase: 'entering', flightDone: false, gameReady: false };
      if (event === 'start-reduced') return { phase: 'playing', flightDone: true, gameReady: true };
      return state;
    case 'entering':
      return reduceEnteringPhase(state, event);
    case 'holding':
      if (event === 'game-ready') return { ...state, phase: 'crossfade', gameReady: true };
      return state;
    case 'crossfade':
      if (event === 'crossfade-done') return { ...state, phase: 'playing' };
      return state;
    case 'playing':
      return state;
  }
}

// ---------------------------------------------------------------------------
// Pure edge-reveal machine (macOS auto-hide semantics)
//
// GLOBAL reveal (owner decision, 2026-07-20): dwelling at ANY screen edge
// reveals ALL the play chrome together — header, hierarchy, inspector,
// assets, bottom bar — and it all retracts together once the pointer leaves
// both the hot zones and every revealed surface. Per-edge independent
// reveals (the original design) made the chrome feel unpredictable and
// forced users to hunt each panel at its own edge.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Controller — DOM / viewport integration seams
// ---------------------------------------------------------------------------

/**
 * THE TRANSITION'S DURATIONS, owned here and read by the stylesheet.
 *
 * Every one of these is a JS timer AND a CSS animation: the phase machine
 * schedules the next step off the constant while `workspace-surfaces.css`
 * animates the pixels, so a mismatch is not a cosmetic drift — it advances the machine
 * before the frames land (a half-dissolved chrome snapped away mid-fade) or
 * holds it after they do. They used to be typed twice, with three comments here
 * saying "must match the CSS", which is a hand-maintained equality across two
 * files and no checker.
 *
 * They are published as custom properties by
 * {@link publishPlayTransitionDurations}, from {@link installPlayTransitionDock}
 * — which is also what makes an unpublished property unreachable rather than a
 * silent failure: nothing ever adds `vgai-play-chrome-exit`,
 * `vgai-play-chrome-enter` or `vgai-play-crossfade` except this module, and
 * this module cannot act before the host is installed.
 */

/** Chrome dissolve. CSS: `--vgai-play-dissolve-duration`. */
export const PLAY_DISSOLVE_MS = 450;
/** Fast, unstaggered re-materialization after a reveal request. CSS:
 *  `--vgai-play-materialize-duration`. */
export const PLAY_MATERIALIZE_MS = 220;
/** Per-element stagger step, published as `--vgai-play-stagger`. */
export const PLAY_DISSOLVE_STAGGER_MS = 50;
/** Scene→Game opacity cross-fade. CSS: `--vgai-play-crossfade-duration`. */
export const PLAY_CROSSFADE_MS = 250;

/**
 * Hand the three durations above to the stylesheet. On the document element,
 * so they inherit everywhere the play classes can land — a host may park a
 * surface in a top-level overlay outside the root it handed us.
 */
function publishPlayTransitionDurations(root: HTMLElement): void {
  root.style.setProperty('--vgai-play-dissolve-duration', `${PLAY_DISSOLVE_MS}ms`);
  root.style.setProperty('--vgai-play-materialize-duration', `${PLAY_MATERIALIZE_MS}ms`);
  root.style.setProperty('--vgai-play-crossfade-duration', `${PLAY_CROSSFADE_MS}ms`);
}

/** What the LAYOUT HOST registers: chrome hide/show plus the root element the
 *  flight/cross-fade CSS classes land on. Whatever draws the chrome stays
 *  behind this seam — under the frame it is the workbench's own parts. */
export interface PlayTransitionDockHooks {
  root: HTMLElement;
  hideChrome(animate: boolean): void;
  showChrome(animate: boolean): void;
}

/** The narrow viewport surface the flight needs (the world root's stage registers the
 *  real EditorViewport; unit tests pass a fake). */


let _dock: PlayTransitionDockHooks | null = null;

export function installPlayTransitionDock(hooks: PlayTransitionDockHooks): () => void {
  _dock = hooks;
  if (typeof document !== 'undefined') publishPlayTransitionDurations(document.documentElement);
  return () => {
    if (_dock === hooks) _dock = null;
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}







interface ActiveTransition {
  state: PlayTransitionState;
  reducedMotion: boolean;
  /** The viewport is flying (`kit/play-camera-flight`): a viewport and an authored camera existed. */
  flying: boolean;
  timeouts: Set<ReturnType<typeof setTimeout>>;
}

let _active: ActiveTransition | null = null;

/** Current phase (exported for tests/e2e via the debug handle below). */
export function playTransitionPhase(): PlayTransitionPhase {
  return _active?.state.phase ?? 'idle';
}

// --- Settle listeners --------------------------------------------------------

const _settleListeners = new Set<() => void>();

function flushSettleListeners(): void {
  if (_settleListeners.size === 0) return;
  const fns = [..._settleListeners];
  _settleListeners.clear();
  for (const fn of fns) fn();
}

/**
 * Run `fn` once the play-entry transition SETTLES — the cross-fade completed
 * (phase 'playing') or the transition tore down early (Stop/Escape/boot
 * failure) — or immediately when no transition is in flight. One-shot.
 *
 * This is the hand-off point for work that must NOT happen while the flight
 * still renders the editor viewport: the R3F design session keeps its adopted
 * fiber scene alive under the flight (suspending at the playState flip made
 * the whole screen flash the placeholder scene's clear color) and suspends
 * here instead. Settle can mean "play never happened" as well as "play is
 * fully on screen" — callbacks must re-check store state.
 */
export function onPlayTransitionSettled(fn: () => void): void {
  if (!_active || _active.state.phase === 'playing') {
    fn();
    return;
  }
  _settleListeners.add(fn);
}

function later(active: ActiveTransition, ms: number, fn: () => void): void {
  const handle = setTimeout(() => {
    active.timeouts.delete(handle);
    fn();
  }, ms);
  active.timeouts.add(handle);
}


function dispatch(event: PlayTransitionEvent): void {
  const active = _active;
  if (!active) return;
  const prev = active.state;
  const next = reducePlayTransition(prev, event);
  if (next === prev) return;
  active.state = next;
  if (next.phase === 'crossfade' && prev.phase !== 'crossfade') {
    _dock?.root.classList.add('vgai-play-crossfade');
    later(active, PLAY_CROSSFADE_MS + 30, () => dispatch('crossfade-done'));
  }
  if (next.phase === 'playing' && prev.phase !== 'playing') {
    _dock?.root.classList.remove('vgai-play-flight', 'vgai-play-crossfade');
    if (active.flying) playCameraFlight()?.settle();
    flushSettleListeners();
  }
}


/**
 * Begin the play-entry transition. Called by `play-mode.ts` immediately
 * before `setPlayState('playing')`. Never blocks play — all choreography is
 * fire-and-forget alongside the runtime boot. Safe no-op degradation when no
 * dock/viewport is registered (headless unit-test stores).
 */
export interface PlayEntryTransitionOptions {
  readonly immersive: boolean;
}

/**
 * A lane is starting: call BEFORE the session flips to playing. The mounted
 * layout chooses immersive Play; when
 * immersive, the authored camera MUST be resolved here, before playState
 * changes — the R3F design session then suspends and removes its drei camera
 * from the store. Every exit path funnels through `endPlayTransition`.
 */
export function beginLiveTransition(): void {
  beginPlayEntryTransition({ immersive: usesImmersivePlayPresentation() });
}

export function beginPlayEntryTransition(options: PlayEntryTransitionOptions): void {
  if (_active) endPlayTransition();
  // Non-immersive play has no transition state, persistence gate, camera
  // flight, or chrome mutation at all.
  if (!options.immersive) return;
  const reducedMotion = prefersReducedMotion();
  setWorkspacePersistenceSuppressed(true);
  const active: ActiveTransition = {
    state: IDLE_TRANSITION_STATE,
    reducedMotion,
    flying: false,
    timeouts: new Set(),
  };
  _active = active;
  _dock?.hideChrome(!reducedMotion);

  if (reducedMotion) {
    dispatch('start-reduced');
    return;
  }
  dispatch('start');

  // The flight resolves the authored camera NOW, before playState changes (the R3F design
  // session then suspends and removes its drei camera from the store).
  active.flying = playCameraFlight()?.begin(() => { if (_active === active) dispatch('flight-done'); }) ?? false;
  if (!active.flying) {
    // No authored camera (or headless): dissolve still runs, no flight.
    dispatch('flight-done');
    return;
  }
  _dock?.root.classList.add('vgai-play-flight');
}

/**
 * Reconcile an already-running session with appearance-axis changes. Moving
 * away from an immersive presentation must restore the chrome immediately;
 * moving into one mid-session deliberately does not replay entry
 * choreography.
 */
export function reconcilePlayPresentationPolicy(isPlaying: boolean, immersive: boolean): void {
  if (!isPlaying || !immersive) endPlayTransition();
}

/**
 * The game runtime finished its async boot (play-mode's ack point).
 * `getLiveCamera` gives the flight its final convergence target — the game's
 * actual render camera — so the cross-fade is pixel-continuous even when game
 * code repositions the camera during boot.
 */
export function notifyPlayTransitionGameReady(getLiveCamera?: LiveCameraLookup): void {
  const active = _active;
  if (!active) return;
  if (active.flying && getLiveCamera) playCameraFlight()?.track(getLiveCamera);
  dispatch('game-ready');
}




/**
 * Tear the transition down (Stop/Escape/boot failure — any exit path).
 * Restores the pre-play camera pose, re-materializes the chrome, and
 * re-enables layout persistence. Idempotent.
 */
export function endPlayTransition(): void {
  const active = _active;
  if (!active) return;
  _active = null;
  for (const handle of active.timeouts) clearTimeout(handle);
  active.timeouts.clear();
  // Early teardown is also "settled" — deferred hand-off work (see
  // onPlayTransitionSettled) must run, and its store-state guards decide
  // whether there is anything left to do.
  flushSettleListeners();
  _dock?.root.classList.remove('vgai-play-flight', 'vgai-play-crossfade');

  if (active.flying) playCameraFlight()?.end();

  _dock?.showChrome(!prefersReducedMotion());
  setWorkspacePersistenceSuppressed(false);
}

// Dev/e2e handle: lets specs observe the transition phase deterministically.
if (typeof window !== 'undefined' && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as Record<string, unknown>)['__vgaiPlayTransition'] = {
    phase: playTransitionPhase,
  };
}
