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
 * Layering: this module owns TIMING and the camera flight, and it touches no
 * layout at all. The LAYOUT HOST registers `hideChrome`/`showChrome` through
 * {@link installPlayTransitionDock} — under the Code-OSS frame those are the
 * workbench's own parts going away and coming back (`frame/bridge.tsx`'s
 * `setImmersive`), which is the same inversion `workspace-host-commands.ts`
 * uses for semantic commands. The flight reads the authored viewport's rig
 * through `viewport-door.ts` and rides its frame hook, so flight pacing rides
 * the editor's own frame clock. Workspace persistence is suppressed for the
 * whole immersive play session (`setWorkspacePersistenceSuppressed`) so a
 * play-time open set can never overwrite the user's own. A non-immersive play
 * never enters this controller: it keeps the ordinary workspace visible.
 *
 * The pure parts — spline construction, the durations, the phase reducer —
 * are plain functions with no DOM.
 */

import * as THREE from 'three';
import { layoutPolicy } from './layout-policy';
import { effectiveSettings } from '@volter/editor-sdk/kit/settings-store';
import { onViewportFrame, viewportRig } from '@volter/editor-sdk/kit/viewport-door';
import { setWorkspacePersistenceSuppressed } from './workspace-persistence-gate';
import { hostHierarchyObjects } from '@volter/editor-sdk/kit/host-hierarchy-objects';

/** Full-bleed play is the MOUNTED LAYOUT's own declaration
 *  (`WorkspaceLayoutPolicy.immersivePlay` — `GameLayout` is the shipped
 *  instance); no appearance axis implies it. */
export function usesImmersivePlayPresentation(): boolean {
  return (layoutPolicy()?.immersivePlay ?? false) && !effectiveSettings().play?.keepPanelsVisible;
}

// ---------------------------------------------------------------------------
// Pure flight math
// ---------------------------------------------------------------------------

/** Flight time scales mildly with distance so short hops feel snappy and
 *  cross-scene flights stay graceful, clamped to a tight band. */
export function flightDurationMs(distance: number): number {
  return Math.min(1600, Math.max(800, 900 + distance * 25));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Control points for the camera flight spline: start, two interior points
 * forming a gentle arc, end. The arc lifts along world-up and bows slightly
 * sideways, both proportional to (but clamped against) the travel distance —
 * a short hop barely arcs, a long flight gets a visible swoop, and a
 * degenerate zero-length flight returns a straight (stationary) curve.
 */
export function computeFlightControlPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  up: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): THREE.Vector3[] {
  const travel = new THREE.Vector3().subVectors(end, start);
  const distance = travel.length();
  if (distance < 1e-6) {
    return [start.clone(), start.clone(), end.clone(), end.clone()];
  }
  const lift = Math.min(distance * 0.18, 6);
  // Side bias perpendicular to travel and up — gives the arc a slight bank
  // instead of a purely vertical hump. Falls back to zero when travel is
  // parallel to up (straight vertical flights just lift).
  const side = new THREE.Vector3().crossVectors(travel, up);
  if (side.lengthSq() > 1e-9) side.normalize().multiplyScalar(Math.min(distance * 0.08, 2.5));
  else side.set(0, 0, 0);
  const liftVec = up.clone().normalize().multiplyScalar(lift);
  const p1 = start.clone().addScaledVector(travel, 0.3).add(liftVec).add(side);
  const p2 = end
    .clone()
    .addScaledVector(travel, -0.3)
    .addScaledVector(liftVec, 0.6)
    .addScaledVector(side, 0.5);
  return [start.clone(), p1, p2, end.clone()];
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
/** The narrow store surface `resolveAuthoredCameraTarget` reads. */
export interface PlayCameraSourceStore {
  readonly objectMap: ReadonlyMap<string, THREE.Object3D>;
}

export interface AuthoredCameraTarget {
  entityId: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
}

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

/** Editor-only overlays (helpers, gizmos) live on layer 31 — never flight targets. */
const EDITOR_ONLY_LAYER_MASK = 1 << 31;

function isEditorOnlyOrGizmo(obj: THREE.Object3D): boolean {
  return (obj.layers.mask & EDITOR_ONLY_LAYER_MASK) !== 0 || /gizmo/i.test(obj.name);
}

/** Depth-first search for the first real camera in a subtree, skipping
 *  editor-only/gizmo branches wholesale. */
function findCameraInSubtree(obj: THREE.Object3D): THREE.Camera | null {
  if (isEditorOnlyOrGizmo(obj)) return null;
  if ((obj as Partial<THREE.Camera>).isCamera) return obj as THREE.Camera;
  for (const child of obj.children) {
    const found = findCameraInSubtree(child);
    if (found) return found;
  }
  return null;
}

function targetFromObject(
  entityId: string,
  obj: THREE.Object3D,
  fov: number,
): AuthoredCameraTarget {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  obj.getWorldPosition(position);
  obj.getWorldQuaternion(quaternion);
  return {
    entityId,
    position: position.toArray() as [number, number, number],
    quaternion: quaternion.toArray() as [number, number, number, number],
    fov,
  };
}

/**
 * Find the authored game camera in the CURRENT (pre-play) editor scene.
 *
 * A world's source IS its document, so there is no descriptor to read a
 * declared camera out of: the design session adopts the mounted fiber scene
 * into the store, which makes the authored camera (e.g. drei
 * `<PerspectiveCamera makeDefault>`) a live `THREE.Camera` in the mapped
 * object graphs. Take the first one outside editor-only (layer-31) and gizmo
 * branches, at its live world transform.
 *
 * `null` when no camera is found — play then keeps today's behavior (game
 * starts at the preview pose, no flight).
 */
export function resolveAuthoredCameraTarget(
  store: PlayCameraSourceStore,
): AuthoredCameraTarget | null {
  for (const [id, obj] of store.objectMap) {
    const camera = findCameraInSubtree(obj);
    if (!camera) continue;
    const perspective = camera as Partial<THREE.PerspectiveCamera>;
    return targetFromObject(id, camera, perspective.isPerspectiveCamera ? perspective.fov! : 60);
  }
  return null;
}

interface FlightRuntime {
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  startFov: number;
  endPos: THREE.Vector3;
  endQuat: THREE.Quaternion;
  endFov: number;
  curve: THREE.CatmullRomCurve3;
  startedAt: number;
  durationMs: number;
  landed: boolean;
}

interface ActiveTransition {
  state: PlayTransitionState;
  reducedMotion: boolean;
  flight: FlightRuntime | null;
  cameraSnapshot: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null;
  /** Live game camera, registered at game-ready — the flight retargets to it
   *  each frame so the hand-off converges on whatever the game actually does
   *  with its camera during boot (follow rigs, SceneCamera components…). */
  getLiveCamera: (() => THREE.Object3D | null) | null;
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

function rebuildCurve(flight: FlightRuntime): void {
  flight.curve = new THREE.CatmullRomCurve3(
    computeFlightControlPoints(flight.startPos, flight.endPos),
  );
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
    settleOrbitAfterFlight();
    flushSettleListeners();
  }
}

/** After the flight, leave OrbitControls in a sane state at the landed pose
 *  so a `set-viewport-tab scene` during play still orbits correctly. */
function settleOrbitAfterFlight(): void {
  const viewport = viewportRig();
  const active = _active;
  if (!viewport || !active?.flight) return;
  const camera = viewport.camera;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const distance = active.cameraSnapshot
    ? Math.max(1, active.cameraSnapshot.position.distanceTo(active.cameraSnapshot.target))
    : 5;
  viewport.orbit.target.copy(camera.position).addScaledVector(forward, distance);
  viewport.orbit.enabled = true;
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
  const immersive = usesImmersivePlayPresentation();
  const objects = hostHierarchyObjects()?.objects();
  beginPlayEntryTransition(immersive && objects ? resolveAuthoredCameraTarget({ objectMap: objects }) : null, {
    immersive,
  });
}

export function beginPlayEntryTransition(
  target: AuthoredCameraTarget | null,
  options: PlayEntryTransitionOptions,
): void {
  if (_active) endPlayTransition();
  // Non-immersive play has no transition state, persistence gate, camera
  // flight, or chrome mutation at all.
  if (!options.immersive) return;
  const reducedMotion = prefersReducedMotion();
  setWorkspacePersistenceSuppressed(true);
  const active: ActiveTransition = {
    state: IDLE_TRANSITION_STATE,
    reducedMotion,
    flight: null,
    cameraSnapshot: null,
    getLiveCamera: null,
    timeouts: new Set(),
  };
  _active = active;
  _dock?.hideChrome(!reducedMotion);

  if (reducedMotion) {
    dispatch('start-reduced');
    return;
  }
  dispatch('start');

  const viewport = viewportRig();
  if (!target || !viewport) {
    // No authored camera (or headless): dissolve still runs, no flight.
    dispatch('flight-done');
    return;
  }
  active.cameraSnapshot = {
    position: viewport.camera.position.clone(),
    target: viewport.orbit.target.clone(),
    fov: viewport.camera.fov,
  };
  const startPos = viewport.camera.position.clone();
  const endPos = new THREE.Vector3().fromArray(target.position);
  const flight: FlightRuntime = {
    startPos,
    startQuat: viewport.camera.quaternion.clone(),
    startFov: viewport.camera.fov,
    endPos,
    endQuat: new THREE.Quaternion().fromArray(target.quaternion),
    endFov: target.fov,
    curve: new THREE.CatmullRomCurve3(computeFlightControlPoints(startPos, endPos)),
    startedAt: performance.now(),
    durationMs: flightDurationMs(startPos.distanceTo(endPos)),
    landed: false,
  };
  active.flight = flight;
  viewport.orbit.enabled = false;
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
export function notifyPlayTransitionGameReady(getLiveCamera?: () => THREE.Object3D | null): void {
  const active = _active;
  if (!active) return;
  active.getLiveCamera = getLiveCamera ?? null;
  dispatch('game-ready');
}

const _liveCamPos = new THREE.Vector3();
const _liveCamQuat = new THREE.Quaternion();

/**
 * Per-frame flight driver — called from the world root's stage's RAF loop right after
 * `viewport.update(dt)` so the flight has final say over the camera pose.
 */
onViewportFrame(playTransitionFrame);

function playTransitionFrame(): void {
  const active = _active;
  const viewport = viewportRig();
  const flight = active?.flight;
  if (!active || !viewport || !flight) return;
  const phase = active.state.phase;
  if (phase !== 'entering' && phase !== 'holding' && phase !== 'crossfade') return;

  // Retarget to the live game camera once it exists (see notify above).
  const liveCamera = active.getLiveCamera?.() ?? null;
  if (liveCamera) {
    liveCamera.getWorldPosition(_liveCamPos);
    liveCamera.getWorldQuaternion(_liveCamQuat);
    if (_liveCamPos.distanceToSquared(flight.endPos) > 1e-8) {
      flight.endPos.copy(_liveCamPos);
      rebuildCurve(flight);
    }
    flight.endQuat.copy(_liveCamQuat);
    const liveFov = (liveCamera as THREE.PerspectiveCamera).fov;
    if (typeof liveFov === 'number') flight.endFov = liveFov;
  }

  const camera = viewport.camera;
  if (flight.landed) {
    // Holding/cross-fading: pin to the (possibly live-tracked) end pose.
    camera.position.copy(flight.endPos);
    camera.quaternion.copy(flight.endQuat);
    if (camera.fov !== flight.endFov) {
      camera.fov = flight.endFov;
      camera.updateProjectionMatrix();
    }
    return;
  }

  const t = Math.min(1, (performance.now() - flight.startedAt) / flight.durationMs);
  const eased = easeInOutCubic(t);
  camera.position.copy(flight.curve.getPoint(eased));
  camera.quaternion.slerpQuaternions(flight.startQuat, flight.endQuat, eased);
  camera.fov = flight.startFov + (flight.endFov - flight.startFov) * eased;
  camera.updateProjectionMatrix();
  if (t >= 1) {
    flight.landed = true;
    dispatch('flight-done');
  }
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

  const viewport = viewportRig();
  if (viewport && active.cameraSnapshot) {
    const snap = active.cameraSnapshot;
    viewport.camera.position.copy(snap.position);
    viewport.orbit.target.copy(snap.target);
    viewport.camera.lookAt(snap.target);
    if (viewport.camera.fov !== snap.fov) {
      viewport.camera.fov = snap.fov;
      viewport.camera.updateProjectionMatrix();
    }
    viewport.orbit.enabled = true;
    viewport.orbit.update();
  } else if (viewport && active.flight) {
    viewport.orbit.enabled = true;
  }

  _dock?.showChrome(!prefersReducedMotion());
  setWorkspacePersistenceSuppressed(false);
}

// Dev/e2e handle: lets specs observe the transition phase deterministically.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>)['__vgaiPlayTransition'] = {
    phase: playTransitionPhase,
  };
}
