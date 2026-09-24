import type { SystemFn, SystemOptions, SystemPhaseName } from '@volter/editor-project/core/system-phase';
import * as THREE from 'three';
import type { AnyStateMachine } from 'xstate';
import { deleteUserData, getUserData, setUserData } from '../ecs/user-data';
import { attachAnimationRuntimeInspection } from './runtime-inspection';
import {
  type AnimationBoneMask,
  type AnimationMetaStateNodeLike,
  asBlendTreeDef,
  type BlendTreeDef,
  clipNamesOf,
  collectMachineAnimationMeta,
  isBlendTreeAnimationMeta,
  type MachineAnimationMetaEntry,
  type StateAnimationMeta,
} from './xstate-animation-meta';

/**
 * The slice of a host's system runner this binding drives — declared
 * STRUCTURALLY rather than imported, because the runner is
 * `@volter/game-runtime`'s and a twin may not depend on another twin (the
 * project contract owns the phase vocabulary both speak). `createSystemRunner`
 * satisfies it.
 */
export interface SystemRunnerSlice {
  add(phase: SystemPhaseName, fn: SystemFn, options?: SystemOptions): void;
  remove(phase: SystemPhaseName, fn: SystemFn): void;
}

/**
 * The snapshot half of {@link XStateAnimationActor} — the three members this
 * binder and the editor's machine inspectors actually read off a snapshot.
 * Named here rather than imported so the seam stays XState-free; see the
 * actor's own note for why that matters.
 */
export interface XStateAnimationSnapshot {
  /** Active state value (`'idle'`, `{ locomotion: 'run' }`). XState's
   *  `StateValue`, kept as `unknown` here — only the inspector interprets it. */
  readonly value: unknown;
  /** Live machine context, read for blend-tree parameters. */
  readonly context: unknown;
  /** Meta of every active state, keyed by state id — how the binder learns
   *  which states are active and what `meta.animation` they carry. */
  readonly getMeta: () => Record<string, unknown>;
}

/**
 * What this binder needs from a running actor — a MINIMAL STRUCTURAL shape
 * that names no XState type at all. It is satisfied by `Actor<TMachine>`, by
 * `ActorRefFrom<typeof machine>`, and by anything else that can report a
 * snapshot and be subscribed to.
 *
 * TWO REASONS IT IS SPELLED OUT INSTEAD OF IMPORTED, both measured:
 *
 *  - A nominal `Actor<AnyStateMachine>` parameter rejects the type XState's own
 *    React docs reach for — `ActorRefFrom<typeof machine>`, e.g. in a
 *    `useRef<ActorRefFrom<typeof machine> | null>` — which carries no `logic`,
 *    `clock` or `options`. The call then fails with a wall of "missing the
 *    following properties" and the only obvious escape is
 *    `bindXStateAnimation(actor as any, …)`, a cast that also disables checking
 *    of the clip map and options.
 *  - XState's own `AnyActorRef` fixes that but is DEEP, and a game does not
 *    compile against the same physical copy of `xstate` the engine does: a
 *    scaffolded project installs its own, and the moment those two copies
 *    differ in version TypeScript stops deduplicating them by package id (the
 *    id is name + subpath + VERSION) and has to
 *    compare `Actor<StateMachine<…>>` from one copy against `AnyActorRef` from
 *    the other — structurally, through `system`, `src`, `_parent` and a generic
 *    `select`, until it gives up with `TS2321: Excessive stack depth`. Measured
 *    on a fresh scaffold with a second xstate copy, where every in-repo gate
 *    stayed green because the monorepo resolves exactly one copy. A shape this
 *    shallow cannot blow that budget however many copies are in play.
 *
 * Both actor shapes still carry the machine — `Actor.logic`, and `machine` on
 * every `MachineSnapshot` — so {@link machineOfXStateActor} reads it and no
 * caller casts.
 */
export interface XStateAnimationActor {
  readonly getSnapshot: () => XStateAnimationSnapshot;
  readonly subscribe: (next: (snapshot: XStateAnimationSnapshot) => void) => {
    unsubscribe: () => void;
  };
}

/** A binding-time problem such as a missing clip, bone, or ambiguous layer. */
export class AnimationBindingError extends Error {
  constructor(
    message: string,
    readonly stateId?: string,
  ) {
    super(message);
    this.name = 'AnimationBindingError';
  }
}

/** The state machine behind a bound actor, from whichever half of the actor
 *  shape carries it. Throws rather than silently binding nothing when the
 *  actor is not a state-machine actor (a promise/callback actor has no
 *  `meta.animation` to collect). */
export function machineOfXStateActor(actor: XStateAnimationActor): AnyStateMachine {
  const logic = (actor as { logic?: unknown }).logic as AnyStateMachine | undefined;
  if (logic?.root) return logic;
  const snapshot = actor.getSnapshot() as XStateAnimationSnapshot & { machine?: AnyStateMachine };
  if (snapshot?.machine?.root) return snapshot.machine;
  throw new AnimationBindingError(
    '[bindXStateAnimation] the actor exposes no state machine — only a state-machine ' +
      'actor carries the `meta.animation` this binder reads',
  );
}

export interface XStateAnimationBindingOptions {
  /** Select live numeric/boolean blend-tree parameters from actor context. */
  selectParameters?: (context: unknown) => Record<string, number | boolean>;
  /** Root whose named Bone/Object3D hierarchy is used by `boneMask`. Defaults to mixer root. */
  root?: THREE.Object3D;
  /** Entity that exposes this binding to editor/runtime inspection. Defaults to `root`. */
  owner?: THREE.Object3D;
  /**
   * Engine runner used to register `tick` in the canonical animation phase.
   * Pass `ctx.systems`; disposal removes the callback automatically. When
   * omitted, the caller owns ticking (useful for standalone Three tests).
   */
  systems?: SystemRunnerSlice;
}

export interface XStateAnimationLayerState {
  readonly layer: string;
  readonly stateId: string;
  readonly clips: readonly string[];
  /** Live native AnimationAction weights, including an in-progress crossfade. */
  readonly clipWeights: readonly { readonly clip: string; readonly weight: number }[];
  readonly weight: number;
  readonly blendMode: 'override' | 'additive';
  readonly boneMask?: AnimationBoneMask;
}

export interface XStateAnimationBinding {
  /** Advance native actions/mixer. Register this in the engine animation phase. */
  tick: (dt: number) => void;
  readonly actor: XStateAnimationActor;
  /** Live numeric/boolean values after the binding's optional parameter selector.
   *  This is the exact parameter surface used by blend evaluation, exposed so
   *  editor instrumentation never guesses by reading actor context directly. */
  getParameters: () => ReadonlyMap<string, number | boolean>;
  /** Current native composition, useful to the editor and game diagnostics. */
  getActiveLayers: () => readonly XStateAnimationLayerState[];
  /** Unsubscribe, stop/uncache actions, and remove owner inspection data. Idempotent. */
  dispose: () => void;
}

let inspectionVersion = 0;
const inspectionListeners = new Set<() => void>();

/** React/useSyncExternalStore-compatible lifecycle signal for live editor inspection. */
export function subscribeXStateAnimationBindings(listener: () => void): () => void {
  inspectionListeners.add(listener);
  return () => inspectionListeners.delete(listener);
}

/** Monotonic snapshot changed whenever a binding is attached or disposed. */
export function getXStateAnimationBindingsVersion(): number {
  return inspectionVersion;
}

function notifyInspectionLifecycle(): void {
  inspectionVersion++;
  for (const listener of inspectionListeners) listener();
}

interface WeightedClip {
  clip: string;
  actionKey: string;
  weight: number;
}

interface ActiveState {
  layer: string;
  stateId: string;
  meta: StateAnimationMeta;
  natural: WeightedClip[];
  dominantActionKey: string;
  crossfadeRemaining: number;
}

interface CachedAction {
  action: THREE.AnimationAction;
  clip: THREE.AnimationClip;
}

const layerOf = (meta: StateAnimationMeta): string => meta.layer ?? 'base';
const layerWeightOf = (meta: StateAnimationMeta): number => meta.weight ?? 1;
const blendModeOf = (meta: StateAnimationMeta): 'override' | 'additive' =>
  meta.blendMode ?? 'override';

function targetNameOf(track: THREE.KeyframeTrack): string {
  try {
    return THREE.PropertyBinding.parseTrackName(track.name).nodeName ?? '';
  } catch {
    const dot = track.name.indexOf('.');
    return dot < 0 ? track.name : track.name.slice(0, dot);
  }
}

function subtreeNames(root: THREE.Object3D, requested: readonly string[], trackNames: Set<string>) {
  const names = new Set<string>();
  const missing: string[] = [];
  for (const requestedName of requested) {
    let found = false;
    root.traverse((object) => {
      if (object.name !== requestedName) return;
      found = true;
      object.traverse((descendant) => {
        if (descendant.name) names.add(descendant.name);
      });
    });
    // Some exporters target a named node not retained as a discoverable Bone.
    // Exact track-target matches remain useful, but cannot imply descendants.
    if (trackNames.has(requestedName)) {
      found = true;
      names.add(requestedName);
    }
    if (!found) missing.push(requestedName);
  }
  return { names, missing };
}

function maskedClip(
  source: THREE.AnimationClip,
  mask: AnimationBoneMask,
  root: THREE.Object3D,
  stateId: string,
): THREE.AnimationClip {
  const trackNames = new Set(source.tracks.map(targetNameOf));
  const included = mask.include ? subtreeNames(root, mask.include, trackNames) : undefined;
  const excluded = mask.exclude ? subtreeNames(root, mask.exclude, trackNames) : undefined;
  const missing = [...(included?.missing ?? []), ...(excluded?.missing ?? [])];
  if (missing.length) {
    throw new AnimationBindingError(
      `[bindXStateAnimation] state "${stateId}" boneMask names unknown bones/objects: ${missing.join(', ')}`,
      stateId,
    );
  }
  const tracks = source.tracks.filter((track) => {
    const name = targetNameOf(track);
    return (!included || included.names.has(name)) && !excluded?.names.has(name);
  });
  if (tracks.length === 0) {
    throw new AnimationBindingError(
      `[bindXStateAnimation] state "${stateId}" boneMask removes every track from clip "${source.name}"`,
      stateId,
    );
  }
  return new THREE.AnimationClip(
    source.name,
    source.duration,
    tracks.map((track) => track.clone()),
  );
}

function dominantOf(weights: WeightedClip[]): WeightedClip {
  return weights.reduce((a, b) => (b.weight > a.weight ? b : a), weights[0]!);
}

/**
 * Optional integration that maps a native XState actor to native Three
 * actions. XState remains a behavior primitive; this bridge is useful when a
 * project deliberately chooses to let one behavior statechart emit animation
 * policy, but it is not the engine's animation model. Animation inspection is
 * published separately through `AnimationRuntimeInspection`.
 *
 * One active animated state is allowed per named layer. Parallel XState
 * regions therefore compose lower-body locomotion, upper-body weapon states,
 * facial animation, and other independent layers without introducing a
 * second transition language. Bone masks clone/filter native clip tracks;
 * additive layers use `AnimationUtils.makeClipAdditive` and Three's additive
 * blend mode. Single unlayered machines retain the original clip/action path.
 */
export function bindXStateAnimation(
  actor: XStateAnimationActor,
  mixer: THREE.AnimationMixer,
  clips: Map<string, THREE.AnimationClip>,
  options: XStateAnimationBindingOptions = {},
): XStateAnimationBinding {
  const mixerRoot = mixer.getRoot();
  const root = options.root ?? (mixerRoot instanceof THREE.Object3D ? mixerRoot : undefined);
  if (!root) {
    throw new AnimationBindingError(
      '[bindXStateAnimation] a THREE.Object3D `root` option is required when the mixer uses AnimationObjectGroup',
    );
  }
  const owner = options.owner ?? root;
  const machineRoot = machineOfXStateActor(actor).root as unknown as AnimationMetaStateNodeLike;
  const entries: MachineAnimationMetaEntry[] = collectMachineAnimationMeta(machineRoot);
  const metaByStateId = new Map(entries.map((entry) => [entry.stateId, entry.meta]));

  for (const entry of entries) {
    for (const clipName of clipNamesOf(entry.meta)) {
      if (!clips.has(clipName)) {
        throw new AnimationBindingError(
          `[bindXStateAnimation] state "${entry.stateId}" references clip "${clipName}", which is ` +
            `not present in the supplied clips map. Known clips: ${[...clips.keys()].join(', ') || '(none)'}`,
          entry.stateId,
        );
      }
    }
  }

  // Different layers need distinct AnimationActions even when they use the
  // same source clip. A plain base state keeps the original clip identity for
  // backwards-compatible mixer.existingAction(sourceClip) behavior.
  const preparedClips = new Map<string, THREE.AnimationClip>();
  function actionKey(stateId: string, meta: StateAnimationMeta, clipName: string): string {
    const transformed =
      layerOf(meta) !== 'base' || Boolean(meta.boneMask) || blendModeOf(meta) === 'additive';
    return transformed ? `${stateId}\u0000${clipName}` : clipName;
  }
  for (const { stateId, meta } of entries) {
    for (const clipName of clipNamesOf(meta)) {
      const key = actionKey(stateId, meta, clipName);
      if (preparedClips.has(key)) continue;
      const source = clips.get(clipName)!;
      let prepared = meta.boneMask ? maskedClip(source, meta.boneMask, root, stateId) : source;
      if (prepared !== source || key !== clipName) {
        if (prepared === source) prepared = source.clone();
        prepared.name = `${source.name}@${layerOf(meta)}:${stateId}`;
      }
      if (blendModeOf(meta) === 'additive') {
        THREE.AnimationUtils.makeClipAdditive(prepared);
        prepared.blendMode = THREE.AdditiveAnimationBlendMode;
      } else {
        prepared.blendMode = THREE.NormalAnimationBlendMode;
      }
      preparedClips.set(key, prepared);
    }
  }

  const actionCache = new Map<string, CachedAction>();
  function ensureAction(
    key: string,
    loop: boolean,
    speed: number,
    weight: number,
  ): THREE.AnimationAction {
    let cached = actionCache.get(key);
    if (!cached) {
      const clip = preparedClips.get(key);
      if (!clip)
        throw new AnimationBindingError(`[bindXStateAnimation] prepared clip "${key}" not found`);
      const action = mixer.clipAction(clip);
      action.setEffectiveWeight(0);
      action.play();
      cached = { action, clip };
      actionCache.set(key, cached);
    }
    cached.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    cached.action.clampWhenFinished = !loop;
    cached.action.timeScale = speed;
    cached.action.weight = weight;
    return cached.action;
  }

  function readParameters(context: unknown): Map<string, number | boolean> {
    const raw = options.selectParameters
      ? options.selectParameters(context)
      : (context as Record<string, number | boolean> | null | undefined);
    return new Map(Object.entries(raw ?? {}));
  }

  function weightsOf(stateId: string, meta: StateAnimationMeta, context: unknown): WeightedClip[] {
    const weights = isBlendTreeAnimationMeta(meta)
      ? evaluateBlendTree(asBlendTreeDef(meta.blendTree), readParameters(context))
      : [{ clip: meta.clip, weight: 1 }];
    return weights.map(({ clip, weight }) => ({
      clip,
      weight,
      actionKey: actionKey(stateId, meta, clip),
    }));
  }

  const activeLayers = new Map<string, ActiveState>();
  let disposed = false;
  let detachRuntimeInspection = () => {};
  function silence(weights: WeightedClip[], except: string | undefined, duration: number): void {
    for (const weighted of weights) {
      if (weighted.actionKey === except) continue;
      const action = actionCache.get(weighted.actionKey)?.action;
      if (!action) continue;
      if (duration > 0) action.fadeOut(duration);
      else action.setEffectiveWeight(0);
    }
  }

  function applyLiveBlendWeights(state: ActiveState, context: unknown): void {
    if (!isBlendTreeAnimationMeta(state.meta)) return;
    state.natural = weightsOf(state.stateId, state.meta, context);
    const layerWeight = layerWeightOf(state.meta);
    for (const weighted of state.natural) {
      actionCache.get(weighted.actionKey)?.action.setEffectiveWeight(weighted.weight * layerWeight);
    }
  }

  function enterState(stateId: string, meta: StateAnimationMeta, context: unknown): void {
    const layer = layerOf(meta);
    const outgoing = activeLayers.get(layer) ?? null;
    const weights = weightsOf(stateId, meta, context);
    const dominant = dominantOf(weights);
    const loop = isBlendTreeAnimationMeta(meta) ? true : meta.loop;
    const speed = isBlendTreeAnimationMeta(meta) ? 1 : meta.speed;
    const layerWeight = layerWeightOf(meta);

    for (const weighted of weights) ensureAction(weighted.actionKey, loop, speed, layerWeight);
    const dominantAction = actionCache.get(dominant.actionKey)!.action;
    dominantAction.reset().setEffectiveWeight(layerWeight);
    for (const weighted of weights) {
      if (weighted.actionKey === dominant.actionKey) continue;
      actionCache.get(weighted.actionKey)!.action.reset().setEffectiveWeight(0);
    }

    const duration = meta.crossfade?.duration ?? 0;
    const warp = meta.crossfade?.warp ?? false;
    if (!outgoing) {
      if (duration > 0) dominantAction.fadeIn(duration);
    } else {
      silence(outgoing.natural, outgoing.dominantActionKey, duration);
      const previous = actionCache.get(outgoing.dominantActionKey)?.action;
      if (previous && duration > 0) previous.crossFadeTo(dominantAction, duration, warp);
      else {
        previous?.setEffectiveWeight(0);
        dominantAction.setEffectiveWeight(layerWeight);
      }
    }

    const active: ActiveState = {
      layer,
      stateId,
      meta,
      natural: weights,
      dominantActionKey: dominant.actionKey,
      crossfadeRemaining: duration,
    };
    activeLayers.set(layer, active);
    if (isBlendTreeAnimationMeta(meta) && duration <= 0) applyLiveBlendWeights(active, context);
  }

  function activeStateIds(snapshot: { getMeta: () => Record<string, unknown> }): string[] {
    return Object.keys(snapshot.getMeta()).filter((id) => metaByStateId.has(id));
  }

  function reconcile(snapshot: { getMeta: () => Record<string, unknown>; context: unknown }): void {
    const nextByLayer = new Map<string, string>();
    for (const stateId of activeStateIds(snapshot)) {
      const meta = metaByStateId.get(stateId)!;
      const layer = layerOf(meta);
      const previous = nextByLayer.get(layer);
      if (previous) {
        throw new AnimationBindingError(
          `[bindXStateAnimation] animated states "${previous}" and "${stateId}" are both active ` +
            `on layer "${layer}". Give parallel regions distinct meta.animation.layer names.`,
          stateId,
        );
      }
      nextByLayer.set(layer, stateId);
    }

    for (const [layer, active] of activeLayers) {
      if (nextByLayer.has(layer)) continue;
      silence(active.natural, undefined, 0);
      activeLayers.delete(layer);
    }
    for (const [layer, stateId] of nextByLayer) {
      if (activeLayers.get(layer)?.stateId === stateId) continue;
      enterState(stateId, metaByStateId.get(stateId)!, snapshot.context);
    }
  }

  const initialSnapshot = actor.getSnapshot();
  reconcile(initialSnapshot);
  const subscription = actor.subscribe((snapshot) => {
    if (!disposed) reconcile(snapshot);
  });

  function tick(dt: number): void {
    if (disposed) return;
    const elapsed = dt;
    const context = actor.getSnapshot().context;
    for (const active of activeLayers.values()) {
      if (active.crossfadeRemaining > 0) {
        active.crossfadeRemaining = Math.max(0, active.crossfadeRemaining - elapsed);
        if (active.crossfadeRemaining <= 0) applyLiveBlendWeights(active, context);
      } else {
        applyLiveBlendWeights(active, context);
      }
    }
    mixer.update(elapsed);
  }

  const binding: XStateAnimationBinding = {
    tick,
    actor,
    getParameters: () => readParameters(actor.getSnapshot().context),
    getActiveLayers: () =>
      [...activeLayers.values()].map((active) => ({
        layer: active.layer,
        stateId: active.stateId,
        clips: active.natural.map((weighted) => weighted.clip),
        clipWeights: active.natural.map((weighted) => ({
          clip: weighted.clip,
          weight: actionCache.get(weighted.actionKey)?.action.getEffectiveWeight() ?? 0,
        })),
        weight: layerWeightOf(active.meta),
        blendMode: blendModeOf(active.meta),
        ...(active.meta.boneMask ? { boneMask: active.meta.boneMask } : {}),
      })),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      detachRuntimeInspection();
      options.systems?.remove('animation', tick);
      subscription.unsubscribe();
      for (const { action, clip } of actionCache.values()) {
        action.stop();
        mixer.uncacheAction(clip, action.getRoot());
      }
      actionCache.clear();
      activeLayers.clear();
      if (getUserData(owner, '_xstateAnimation') === binding) {
        deleteUserData(owner, '_xstateAnimation');
        notifyInspectionLifecycle();
      }
    },
  };
  detachRuntimeInspection = attachAnimationRuntimeInspection(owner, { mixer, clips });
  setUserData(owner, '_xstateAnimation', binding);
  notifyInspectionLifecycle();
  options.systems?.add('animation', tick);
  return binding;
}

/**
 * Evaluates a blend tree and returns weights for each child clip.
 *
 * 1D blend: interpolates between sorted blend points based on a single parameter.
 *   Example: speed=3 with children at [walk:1, run:5] → weights [0.5, 0.5]
 *
 * 2D blend: uses two parameters (e.g., strafe locomotion). Weights are computed by
 *   inverse-distance weighting (IDW): each child's weight is proportional to
 *   1/distance from the (parameter, parameterY) sample point to that child's
 *   (threshold, thresholdY) position, then normalized so all weights sum to 1.
 *   A sample landing exactly on a child gives that child ~full weight. This is a
 *   smooth approximation, not a Delaunay/barycentric blend (so non-adjacent
 *   children still receive a small share); it is intentionally kept simple.
 *
 * Direct: each child has an explicit weight.
 */
export function evaluateBlendTree(
  def: BlendTreeDef,
  parameters: Map<string, number | boolean>,
): { clip: string; weight: number }[] {
  switch (def.type) {
    case '1D':
      return evaluate1D(def, parameters);
    case '2D':
      return evaluate2D(def, parameters);
    case 'direct':
      return evaluateDirect(def);
    default:
      return def.children.map((c) => ({ clip: c.clip, weight: 1 / def.children.length }));
  }
}

function evaluate1D(
  def: BlendTreeDef,
  parameters: Map<string, number | boolean>,
): { clip: string; weight: number }[] {
  const paramValue = Number(parameters.get(def.parameter) ?? 0);
  const children = [...def.children].sort((a, b) => a.threshold - b.threshold);
  const results = children.map((c) => ({ clip: c.clip, weight: 0 }));

  if (children.length === 0) return results;
  if (children.length === 1) {
    results[0]!.weight = 1;
    return results;
  }

  // Below first threshold
  if (paramValue <= children[0]!.threshold) {
    results[0]!.weight = 1;
    return results;
  }

  // Above last threshold
  if (paramValue >= children[children.length - 1]!.threshold) {
    results[results.length - 1]!.weight = 1;
    return results;
  }

  // Between two thresholds — linear interpolation
  for (let i = 0; i < children.length - 1; i++) {
    const lo = children[i]!;
    const hi = children[i + 1]!;
    if (paramValue >= lo.threshold && paramValue <= hi.threshold) {
      const range = hi.threshold - lo.threshold;
      const t = range > 0 ? (paramValue - lo.threshold) / range : 0;
      results[i]!.weight = 1 - t;
      results[i + 1]!.weight = t;
      return results;
    }
  }

  return results;
}

function evaluate2D(
  def: BlendTreeDef,
  parameters: Map<string, number | boolean>,
): { clip: string; weight: number }[] {
  const px = Number(parameters.get(def.parameter) ?? 0);
  const py = Number(parameters.get(def.parameterY ?? '') ?? 0);

  // Inverse-distance weighting: weight each child by 1/distance to its 2D point,
  // then normalize below so the returned weights sum to 1.
  const children = def.children;
  const results = children.map((c) => ({ clip: c.clip, weight: 0 }));

  let totalInvDist = 0;
  const invDists: number[] = [];

  for (const child of children) {
    const dx = px - child.threshold;
    const dy = py - (child.thresholdY ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const invDist = dist < 0.001 ? 1000 : 1 / dist;
    invDists.push(invDist);
    totalInvDist += invDist;
  }

  if (totalInvDist > 0) {
    for (let i = 0; i < results.length; i++) {
      results[i]!.weight = invDists[i]! / totalInvDist;
    }
  }

  return results;
}

function evaluateDirect(def: BlendTreeDef): { clip: string; weight: number }[] {
  const results = def.children.map((c) => ({ clip: c.clip, weight: c.weight ?? 0 }));
  // Normalize so weights sum to exactly 1.0 — otherwise the leftover weight
  // bleeds in the bind pose / T-pose (the actions add up to <1 or >1).
  const total = results.reduce((sum, r) => sum + r.weight, 0);
  if (total > 0) {
    for (const r of results) r.weight /= total;
  }
  return results;
}
