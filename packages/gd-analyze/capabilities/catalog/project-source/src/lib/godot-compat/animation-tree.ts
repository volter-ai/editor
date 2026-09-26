/**
 * `AnimationTree` — Godot's blend-graph over three's own `AnimationMixer` + `AnimationAction`s.
 *
 * `platformer-3d`'s `player.tscn` drives an `AnimationNodeBlendTree` (SubResource 23): five
 * `AnimationNodeAnimation` leaves (`idle`, `walk-cycle`, `jump-up-cycle`, `falling-cycle`,
 * `shooting_standing`) fed through three `Blend2`s (`walk`, `air_dir`, `gun`), one `TimeScale`
 * (`scale`) and one two-input `Transition` (`state`), with the script writing
 * `parameters/walk/blend_amount`, `parameters/air_dir/blend_amount`, `parameters/state/current`
 * and `parameters/gun/blend_amount` every physics frame and calling `set_active(true)` once
 * (`player.gd:32`, `:128`-`:132`). This is the first blend GRAPH in the lane — dodge/squash used
 * only `AnimationPlayer` — and the owner decision is to PORT the graph faithfully, never to
 * substitute the engine's own animator.
 *
 * ## What this ports, and why three can host it exactly
 *
 * three's `AnimationMixer` blends `AnimationAction`s by weight and is itself the animation system;
 * a Godot blend graph is a WEIGHT COMPUTATION over a set of clips, which is the mixer's own model.
 * So the faithful port is not a second animator: {@link evaluateBlendTree} reads the Godot graph
 * exactly as Godot does and produces one effective WEIGHT (and a TimeScale factor) per clip, and
 * {@link applyAnimationTree} writes those onto three's own actions. It hands back nothing of its
 * own — the caller keeps three's `AnimationMixer`/`AnimationAction`s and every later call is
 * three's API (return path, not call path).
 *
 * ## The one thing reading the C++ does NOT let you guess: Godot's blend is ORDER-DEPENDENT
 *
 * Godot 3's `AnimationTree` does not compute a normalized weighted average. `_process_graph`
 * blends each contributing track into an accumulator with an INCREMENTAL lerp
 * (`scene/animation/animation_tree.cpp:928`, `t->loc = t->loc.linear_interpolate(loc, blend)`):
 * the FIRST processed track initialises the accumulator and its own blend is discarded (`:913`),
 * every later track lerps the accumulator toward itself by its RAW cumulative blend, and any track
 * whose cumulative blend is below `CMP_EPSILON` is SKIPPED entirely (`:846`) so it is neither the
 * initialiser nor a contributor. The cumulative blend itself is the product of the node factors
 * down the tree — `Blend2` sends input 0 `blend*(1-amount)` and input 1 `blend*amount`
 * (`animation_blend_tree.cpp:468`-`472`), `TimeScale` passes the blend through and multiplies TIME
 * by its scale (`:558`-`563`), `Transition` with the default `xfade == 0` routes the whole blend to
 * the selected input and nothing to the rest (`:689`-`757`), and the tree walks input 0 before
 * input 1 (`_blend_node`, `animation_tree.cpp:259`). So for three overlapping clips at partial
 * weight the effective weights are NOT the naive products: with `walk=0.5, gun=0.5` the on-floor
 * pose is `idle 0.375 / walk 0.125 / shoot 0.5`, not `0.25 / 0.25 / 0.5` — measured in
 * `packages/gd-analyze/test/ground-truth/godot36-animation.json`, reproduced here by replaying the
 * same incremental lerp over the same visit order. Those effective weights always sum to 1 (a chain
 * of lerps is a partition of unity), so three's weighted action blend reproduces the pose exactly —
 * which is the whole reason a faithful port onto the mixer is possible rather than a deviation.
 *
 * ## Stateful and extended blend nodes
 *
 *  - Authored AnimationNode filters are retained as NodePath sets. Compat partitions each real
 *    Three AnimationClip into cached native subclips, then applies Godot's FILTER_PASS,
 *    FILTER_STOP and FILTER_BLEND track-weight routing without a parallel animation scheduler.
 * Transition crossfades and auto-advance, OneShot, Add2/Add3, Blend3, TimeSeek and nested state
 * machines retain their timing in the tree state and are advanced by the same caller-supplied
 * delta that advances the native mixer. State-machine playback is a plain compat object stored at
 * `parameters/playback`; it owns no scheduler and no source-platform class hierarchy.
 *
 * ## Which leaves ADVANCE, and which are frozen
 *
 * Godot does not merely weight a leaf to zero — it stops VISITING it. `AnimationNodeBlend2::process`
 * blends each input with `optimize = !sync` (`animation_blend_tree.cpp:468`-`472`), and
 * `AnimationTree::_blend_node` skips an optimized subtree whose cumulative blend is below
 * `CMP_EPSILON` entirely, so that leaf's PLAYHEAD does not advance; an `AnimationNodeTransition`'s
 * unselected inputs are never blended at all, same effect. `TimeScale` and `Transition` pass
 * `optimize = false`, so their one live input is processed even at zero blend. Leaving a
 * zero-weight three action RUNNING instead drifts its phase for as long as the state lasts, and the
 * drift shows the instant the graph selects it again — so {@link applyAnimationTree} PAUSES every
 * leaf the graph did not process this frame (a paused three action keeps its `time`), and unpauses
 * the ones it did.
 *
 * ### `Blend2.sync` — MEASURED against the real 3.6 binary, not read off the source
 *
 * `sync` was carried from the C++ and never measured, which left two plausible readings open: that
 * it only toggles the optimize-skip, or that it also NORMALISES the two inputs' time base (Godot 4
 * calls the base class `AnimationNodeSync`, and "synchronise" could reasonably mean phase-locking a
 * short clip to a long one). A probe against `Godot Engine v3.6.stable.official.de2f0f147`
 * settles it: a `Blend2` over a 1.0 s and a 2.5 s ramp clip, `advance(1/60)` per step, each clip
 * keying its own probe node so the read-back IS that leaf's playhead in seconds.
 *
 *  - **Zero blend, then swing to it** (60 steps at `blend_amount = 0`, then `= 1`). At the first
 *    step after the swing the input-1 playhead reads **0.016667 s with `sync = false`** — frozen at
 *    0 for the whole zero-blend second, resuming one dt in — and **1.016666 s with `sync = true`**,
 *    which is exactly the elapsed sim time. A full 1.0 s of difference.
 *  - **No time-base normalisation.** Under `sync = true` the two clips advance at 1:1 real time,
 *    never at the length ratio: at t = 1.5 s the 1.0 s clip sits clamped at its end while the 2.5 s
 *    clip sits at 1.5 s (phase-locking would have put it at 2.5 s).
 *  - **Nothing else.** With `blend_amount = 0.5` from the start — both inputs live, so the
 *    optimize-skip cannot apply — the `sync = false` and `sync = true` runs are BIT-identical
 *    across 90 steps (step 45 reads `x = 0.74999994039535520` / `0.29999998211860660` in both).
 *
 * So `sync` toggles the `CMP_EPSILON` optimize-skip and nothing more, which is what `childOptimize`
 * below carries. The ordering in {@link evaluateBlendTree} is what makes it work: `timeScale.set()`
 * runs BEFORE the sub-epsilon `continue`, so a synced zero-blend leaf still appears in the
 * `LeafDrive[]` at `weight: 0` — and {@link applyAnimationTree} therefore unpauses it (playhead
 * advances) while it contributes nothing to the pose, exactly the measured Godot behaviour.
 *
 * A leaf's LOOP is the clip's own (`AnimationNodeAnimation` honours it): `player.tscn`'s
 * `shooting_standing` authors no `loop`, so it must be `LoopOnce` + clamp rather than ping-ponging
 * forever. That is why {@link applyAnimationTree} takes {@link AnimationTreeActions} — the action
 * PLUS the authored loop — instead of a bare action map.
 *
 * ## Resource ownership
 *
 * **Owns:** the parameter map and the `active` flag of ONE `AnimationTree` node — Godot state, held
 * in a plain record. **Does not own:** the `AnimationMixer` or the `AnimationAction`s (the port
 * built them from the model and holds them), and it starts no clock — the port calls
 * {@link applyAnimationTree} each frame and steps the mixer itself. **Teardown:** none; dropping the
 * record is enough, and the port disposes the mixer it owns.
 */

import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  AnimationUtils,
  type AnimationAction,
  LoopOnce,
  LoopRepeat,
  NormalAnimationBlendMode,
} from 'three';
import {
  createAnimationStateMachinePlayback,
  createAnimationTreeEvaluationRuntime,
  type AnimationStateMachine,
  type AnimationStateMachinePlayback,
  type AnimationStateMachineTransition,
  type AnimationTreeEvaluationRuntime,
  type AnimationTreeLeafVisit,
  type AnimationTreeParameterStore,
  type AnimationTrackScope,
} from './animation-state-machine';
import {
  blendSpace1DWeights,
  blendSpace2DWeights,
  type BlendSpaceMode,
} from './animation-blend-space';
import {
  animationNodeFilterSnapshot,
  bindAnimationNodeFilter,
  type AnimationNodeFilterSnapshot,
} from './animation-node-filter';
import {
  bindAnimationLeafNode,
  bindAnimationBlendSpace1DNode,
  bindAnimationBlendSpace2DNode,
  bindAnimationOneShotNode,
  bindAnimationStateMachineNode,
  bindAnimationStateMachineTransition,
  bindAnimationSyncNode,
  bindAnimationTimeScaleNode,
  bindAnimationTimeSeekNode,
  bindAnimationTransitionNode,
} from './animation-node-runtime';
import type { GodotRandom } from './random';
import type { GodotCurve } from './curve';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';
import { vec2, type Vector2 } from './vector2';
import { packedStringArray } from './packed-array';

export type {
  AnimationStateMachine,
  AnimationStateMachinePlayback,
  AnimationStateMachineTransition,
  StateMachineSwitchMode,
} from './animation-state-machine';

/**
 * Godot's `CMP_EPSILON` (`core/math/math_defs.h`). A track whose cumulative blend is below this is
 * SKIPPED by `_process_graph` (`animation_tree.cpp:846`), which is what makes a zero-weight leaf
 * neither initialise the accumulator nor contribute to it.
 */
const CMP_EPSILON = 0.00001;

/**
 * One node of an `AnimationNodeBlendTree`, as DATA — what a port builds from the `.tscn`'s
 * `tree_root`. `param` is the full Godot parameter path the script writes (e.g.
 * `"parameters/walk/blend_amount"`), so {@link evaluateBlendTree} reads it straight from the
 * parameter map the game populates.
 */
export type BlendNode =
  | { readonly type: 'output'; readonly input: string }
  | {
      readonly type: 'animation';
      readonly clip: string;
      readonly backwardParam?: string;
      readonly playMode?: 'forward' | 'backward';
    }
  | {
      readonly type: 'blend2';
      readonly input0: string;
      readonly input1: string;
      readonly param: string;
      /** Godot's `AnimationNodeBlend2` per-track filter gate. */
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
      /** `AnimationNodeBlend2.sync`. Godot blends its inputs with `optimize = !sync`, so the
       *  DEFAULT (`false`) is what freezes a zero-weight subtree's playhead; `true` keeps it
       *  advancing in lockstep. */
      readonly sync?: boolean;
    }
  | { readonly type: 'timescale'; readonly input: string; readonly param: string }
  | {
      readonly type: 'timeseek';
      readonly input: string;
      readonly param: string;
      readonly explicitElapse?: boolean;
    }
  | {
      readonly type: 'blend3';
      readonly input0: string;
      readonly input1: string;
      readonly input2: string;
      readonly param: string;
      readonly sync?: boolean;
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
    }
  | {
      readonly type: 'add2';
      readonly input0: string;
      readonly input1: string;
      readonly param: string;
      readonly sync?: boolean;
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
    }
  | {
      readonly type: 'sub2';
      readonly input0: string;
      readonly input1: string;
      readonly param: string;
      readonly sync?: boolean;
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
    }
  | {
      readonly type: 'add3';
      readonly input0: string;
      readonly input1: string;
      readonly input2: string;
      readonly param: string;
      readonly sync?: boolean;
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
    }
  | {
      readonly type: 'oneshot';
      readonly input: string;
      readonly shot: string;
      readonly requestParam: string;
      readonly activeParam: string;
      readonly requestMode?: 'activeBool';
      readonly fadeIn: number;
      readonly fadeOut: number;
      readonly fadeInCurve?: GodotCurve | null;
      readonly fadeOutCurve?: GodotCurve | null;
      readonly mixMode?: 'blend' | 'add';
      readonly breakLoopAtEnd?: boolean;
      readonly abortOnReset?: boolean;
      readonly autorestart?: boolean;
      readonly autorestartDelay?: number;
      readonly autorestartRandomDelay?: number;
      readonly sync?: boolean;
      readonly filterEnabled?: boolean;
      readonly filterPaths?: readonly string[];
    }
  | {
      readonly type: 'stateMachine';
      readonly machine: AnimationStateMachine;
      readonly playbackParam: string;
    }
  | {
      readonly type: 'blendSpace1D';
      readonly points: readonly { readonly position: number; readonly tree: BlendTree }[];
      readonly param: string;
      readonly mode: BlendSpaceMode;
      readonly sync?: boolean;
      readonly minSpace?: number;
      readonly maxSpace?: number;
      readonly snap?: number;
      readonly valueLabel?: string;
    }
  | {
      readonly type: 'blendSpace2D';
      readonly points: readonly { readonly x: number; readonly y: number; readonly tree: BlendTree }[];
      readonly triangles: readonly (readonly [number, number, number])[];
      readonly param: string;
      readonly mode: BlendSpaceMode;
      readonly sync?: boolean;
      readonly minSpace?: { readonly x: number; readonly y: number };
      readonly maxSpace?: { readonly x: number; readonly y: number };
      readonly snap?: { readonly x: number; readonly y: number };
      readonly xLabel?: string;
      readonly yLabel?: string;
      readonly autoTriangles?: boolean;
    }
  | {
      readonly type: 'transition';
      readonly inputs: readonly (string | null)[];
      readonly param: string;
      readonly inputNames?: readonly string[];
      readonly currentStateParam?: string;
      readonly requestParam?: string;
      /** Godot's cross-fade time. */
      readonly xfade?: number;
      /** `input_<i>/auto_advance`, per input. */
      readonly autoAdvance?: readonly boolean[];
      readonly breakLoopAtEnd?: readonly boolean[];
      readonly inputReset?: readonly boolean[];
      readonly advanceCondition?: readonly string[];
    };

/** An `AnimationNodeBlendTree`: its nodes by id. `"output"` is the required root. */
export interface BlendTree {
  readonly nodes: Readonly<Record<string, BlendNode>>;
}

export interface GodotAnimationBlendTree extends BlendTree {
  get_node(name: string): BlendNode | null;
  has_node(name: string): boolean;
}

/** One clip's drive for a frame: its effective blend weight and its accumulated time scale. Only
 *  leaves Godot PROCESSED this frame appear (see this file's header); a leaf the graph optimized
 *  away is absent, which is what tells {@link applyAnimationTree} to freeze its playhead. A
 *  processed leaf may still carry `weight === 0` — that is a `sync` blend or a zero-blend
 *  `Transition`/`TimeScale` input, which Godot advances without contributing. */
export interface LeafDrive {
  readonly clip: string;
  readonly weight: number;
  readonly timeScale: number;
  readonly blendMode?: 'normal' | 'additive';
  readonly seek?: number;
  readonly reset?: boolean;
  readonly trackScopes?: readonly AnimationTrackScope[];
}

/** One leaf VISIT in Godot's processing order, with the cumulative blend and time scale reaching
 *  it. Internal to the evaluator. */
function nodeOf(tree: BlendTree, id: string): BlendNode {
  const node = tree.nodes[id];
  if (node === undefined) {
    throw new Error(
      `godot-compat: AnimationNodeBlendTree references node "${id}", which is not in the tree. ` +
        'A port builds `nodes` from the .tscn `tree_root`; a dangling connection is a build error.',
    );
  }
  return node;
}

/**
 * Walk the graph from `output`, input 0 before input 1, collecting each leaf Godot PROCESSES in the
 * ORDER its `_blend_node` visits it, with the cumulative blend (product of node factors) and time
 * scale reaching it. This is the visit order the incremental blend then depends on.
 *
 * `optimize` is the flag the PARENT passed to `blend_input`: `!sync` from a `Blend2`, and `false`
 * from `TimeScale`/`Transition`, which process their one live input regardless. An optimized
 * subtree whose cumulative blend is below `CMP_EPSILON` is not walked at all — that is Godot
 * freezing it, and the leaves' ABSENCE from this list is what carries it.
 */
function numericParameter(params: AnimationTreeParameterStore, path: string, fallback: number): number {
  const value = params.get(path);
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: AnimationTree parameter ${JSON.stringify(path)} must be finite`);
  }
  return value;
}

function vector2Parameter(
  params: AnimationTreeParameterStore,
  path: string,
): { readonly x: number; readonly y: number } {
  const value = params.get(path);
  if (value === undefined) return { x: 0, y: 0 };
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: AnimationTree parameter ${JSON.stringify(path)} must be Vector2-like`);
  }
  const x = Number(Reflect.get(value, 'x'));
  const y = Number(Reflect.get(value, 'y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`godot-compat: AnimationTree parameter ${JSON.stringify(path)} must contain finite x/y`);
  }
  return { x, y };
}

function inheritClipLengths(
  parent: AnimationTreeEvaluationRuntime,
  child: AnimationTreeEvaluationRuntime,
): void {
  child.clipLengths.clear();
  for (const [clip, length] of parent.clipLengths) child.clipLengths.set(clip, length);
  child.clipLoops.clear();
  for (const [clip, loop] of parent.clipLoops) child.clipLoops.set(clip, loop);
}

function currentAnimationFilter(node: object & {
  readonly filterEnabled?: boolean;
  readonly filterPaths?: readonly string[];
}): AnimationNodeFilterSnapshot {
  return animationNodeFilterSnapshot(node, {
    enabled: node.filterEnabled === true,
    paths: node.filterPaths ?? [],
  });
}

function collectLeaves(
  tree: BlendTree,
  params: AnimationTreeParameterStore,
  runtime: AnimationTreeEvaluationRuntime,
  delta: number,
): AnimationTreeLeafVisit[] {
  const out: AnimationTreeLeafVisit[] = [];
  const visit = (
    id: string,
    blend: number,
    timeScale: number,
    optimize: boolean,
    blendMode: 'normal' | 'additive' = 'normal',
    seek?: number,
    reset?: boolean,
    trackScopes: readonly AnimationTrackScope[] = [],
  ): void => {
    if (optimize && blend < CMP_EPSILON) return;
    const node = nodeOf(tree, id);
    switch (node.type) {
      case 'output':
        visit(node.input, blend, timeScale, false, blendMode, seek, reset, trackScopes);
        return;
      case 'animation':
        {
          const parameterBackward = node.backwardParam === undefined
            ? false
            : Boolean(params.get(node.backwardParam));
          const authoredBackward = node.playMode === 'backward';
          const direction = parameterBackward === authoredBackward ? 1 : -1;
        out.push({
          clip: node.clip,
          blend,
          timeScale: timeScale * direction,
          blendMode,
          ...(seek === undefined ? {} : { seek }),
          ...(reset === undefined ? {} : { reset }),
          ...(trackScopes.length === 0 ? {} : { trackScopes }),
        });
        return;
        }
      case 'blend2': {
        // Godot default blend_amount is 0 (animation_blend_tree.cpp:459). Input 0 (the "in"/blend
        // base) is walked FIRST, then input 1 (the "blend" side) — the order the incremental blend
        // reads. Both go through `blend_input(…, optimize = !sync)` (:468-:472).
        const amount = numericParameter(params, node.param, 0);
        const childOptimize = node.sync !== true;
        const filter = currentAnimationFilter(node);
        if (filter.enabled) {
          const matched: readonly AnimationTrackScope[] = [
            ...trackScopes, { paths: filter.paths, include: true },
          ];
          const unmatched: readonly AnimationTrackScope[] = [
            ...trackScopes, { paths: filter.paths, include: false },
          ];
          // FILTER_BLEND: filtered tracks blend, every other track passes at the parent's weight.
          visit(node.input0, blend * (1 - amount), timeScale, childOptimize, blendMode, seek, reset, matched);
          visit(node.input0, blend, timeScale, false, blendMode, seek, reset, unmatched);
          // FILTER_PASS: only authored filtered tracks enter from the blend input.
          visit(node.input1, blend * amount, timeScale, childOptimize, blendMode, seek, reset, matched);
        } else {
          visit(node.input0, blend * (1 - amount), timeScale, childOptimize, blendMode, seek, reset, trackScopes);
          visit(node.input1, blend * amount, timeScale, childOptimize, blendMode, seek, reset, trackScopes);
        }
        return;
      }
      case 'timescale': {
        // Godot default scale is 1.0 (animation_blend_tree.cpp:551). It passes the blend through
        // and multiplies the TIME base (:563), with `optimize = false`.
        const scale = numericParameter(params, node.param, 1);
        visit(node.input, blend, timeScale * scale, false, blendMode, seek, reset, trackScopes);
        return;
      }
      case 'timeseek': {
        const position = numericParameter(params, node.param, -1);
        visit(node.input, blend, timeScale, false, blendMode, position >= 0 ? position : seek, reset, trackScopes);
        if (position >= 0) params.set(node.param, -1);
        return;
      }
      case 'blend3': {
        const amount = numericParameter(params, node.param, 0);
        const optimizeChildren = node.sync !== true;
        const filter = currentAnimationFilter(node);
        if (filter.enabled) {
          const matched: readonly AnimationTrackScope[] = [
            ...trackScopes, { paths: filter.paths, include: true },
          ];
          const unmatched: readonly AnimationTrackScope[] = [
            ...trackScopes, { paths: filter.paths, include: false },
          ];
          visit(node.input0, blend * Math.max(0, -amount), timeScale, optimizeChildren, blendMode, seek, reset, matched);
          visit(node.input1, blend * (1 - Math.abs(amount)), timeScale, optimizeChildren, blendMode, seek, reset, matched);
          visit(node.input1, blend, timeScale, false, blendMode, seek, reset, unmatched);
          visit(node.input2, blend * Math.max(0, amount), timeScale, optimizeChildren, blendMode, seek, reset, matched);
        } else {
          visit(node.input0, blend * Math.max(0, -amount), timeScale, optimizeChildren, blendMode, seek, reset, trackScopes);
          visit(node.input1, blend * (1 - Math.abs(amount)), timeScale, optimizeChildren, blendMode, seek, reset, trackScopes);
          visit(node.input2, blend * Math.max(0, amount), timeScale, optimizeChildren, blendMode, seek, reset, trackScopes);
        }
        return;
      }
      case 'add2': {
        const amount = numericParameter(params, node.param, 0);
        visit(node.input0, blend, timeScale, false, blendMode, seek, reset, trackScopes);
        const filter = currentAnimationFilter(node);
        const addScopes: readonly AnimationTrackScope[] = filter.enabled
          ? [...trackScopes, { paths: filter.paths, include: true }]
          : trackScopes;
        visit(node.input1, blend * amount, timeScale, node.sync !== true, 'additive', seek, reset, addScopes);
        return;
      }
      case 'sub2': {
        const amount = numericParameter(params, node.param, 0);
        // Godot evaluates the subtract input first with FILTER_PASS and negative weight, then the
        // base with FILTER_IGNORE. Three's native additive clip mode carries the inverse delta.
        const filter = currentAnimationFilter(node);
        const subtractScopes: readonly AnimationTrackScope[] = filter.enabled
          ? [...trackScopes, { paths: filter.paths, include: true }]
          : trackScopes;
        visit(node.input1, blend * -amount, timeScale, node.sync !== true, 'additive', seek, reset, subtractScopes);
        visit(node.input0, blend, timeScale, false, blendMode, seek, reset, trackScopes);
        return;
      }
      case 'add3': {
        const amount = numericParameter(params, node.param, 0);
        visit(node.input1, blend, timeScale, false, blendMode, seek, reset, trackScopes);
        const filter = currentAnimationFilter(node);
        const addScopes: readonly AnimationTrackScope[] = filter.enabled
          ? [...trackScopes, { paths: filter.paths, include: true }]
          : trackScopes;
        visit(node.input0, blend * Math.max(0, -amount), timeScale, node.sync !== true, 'additive', seek, reset, addScopes);
        visit(node.input2, blend * Math.max(0, amount), timeScale, node.sync !== true, 'additive', seek, reset, addScopes);
        return;
      }
      case 'oneshot': {
        const filter = currentAnimationFilter(node);
        let state = runtime.oneShots.get(id);
        if (state === undefined) {
          state = {
            active: false,
            previousRequestActive: false,
            elapsed: 0,
            fadeInElapsed: 0,
            fadeElapsed: 0,
            stopping: false,
            restartDelay: -1,
          };
          runtime.oneShots.set(id, state);
        }
        const authoredActive = node.requestMode === 'activeBool'
          ? Boolean(params.get(node.requestParam))
          : undefined;
        let request = node.requestMode === 'activeBool'
          ? authoredActive === state.previousRequestActive ? 0 : authoredActive ? 1 : 2
          : Math.trunc(numericParameter(params, node.requestParam, 0));
        if (authoredActive !== undefined) state.previousRequestActive = authoredActive;
        let restartWithoutFade = false;
        let didStart = false;
        if (reset && node.requestMode === 'activeBool' && state.active) {
          state.elapsed = 0;
          state.fadeInElapsed = 0;
          state.fadeElapsed = 0;
          state.stopping = false;
          didStart = true;
        } else if (reset && request !== 1) {
          if (state.stopping || (node.abortOnReset === true && state.active)) {
            request = 2;
          } else if (state.active) {
            request = 1;
            restartWithoutFade = true;
          }
        }
        if (request !== 0) {
          if (request === 1) {
            const wasInternallyActive = state.active && !state.stopping;
            state.active = true;
            state.elapsed = 0;
            state.fadeInElapsed = wasInternallyActive || restartWithoutFade ? node.fadeIn : 0;
            state.fadeElapsed = 0;
            state.stopping = false;
            state.restartDelay = -1;
            didStart = true;
          } else if (request === 2) {
            state.active = false;
            state.elapsed = 0;
            state.fadeInElapsed = 0;
            state.fadeElapsed = 0;
            state.stopping = false;
            state.restartDelay = -1;
          } else if (request === 3 && state.active && !state.stopping) {
            state.stopping = true;
            state.fadeElapsed = 0;
            state.restartDelay = -1;
          } else if (request !== 3) {
            throw new RangeError(`godot-compat: AnimationNodeOneShot ${JSON.stringify(id)} request ${request} is invalid`);
          }
          if (node.requestMode !== 'activeBool') params.set(node.requestParam, 0);
        }
        if (!state.active && state.restartDelay >= 0) {
          state.restartDelay -= Math.max(0, delta);
          if (state.restartDelay < 0) {
            state.active = true;
            state.elapsed = 0;
            state.fadeInElapsed = 0;
            state.fadeElapsed = 0;
            state.stopping = false;
            didStart = true;
          }
        }
        if (node.requestMode !== 'activeBool') params.set(node.activeParam, state.active);
        if (!state.active) {
          visit(node.input, blend, timeScale, false, blendMode, seek, reset, trackScopes);
          return;
        }
        const linearFadeIn = node.fadeIn <= 0 ? 1 : Math.min(1, state.fadeInElapsed / node.fadeIn);
        const fadeIn = node.fadeInCurve?.sample(linearFadeIn) ?? linearFadeIn;
        const fadeOut = state.stopping
          ? (() => {
            const linear = node.fadeOut <= 0 ? 0 : Math.max(0, 1 - state.fadeElapsed / node.fadeOut);
            return node.fadeOutCurve === undefined || node.fadeOutCurve === null
              ? linear
              : 1 - node.fadeOutCurve.sample(1 - linear);
          })()
          : 1;
        const shotWeight = fadeIn * fadeOut;
        const filtered = filter.enabled;
        const matched: readonly AnimationTrackScope[] = filtered
          ? [...trackScopes, { paths: filter.paths, include: true }]
          : trackScopes;
        const unmatched: readonly AnimationTrackScope[] = filtered
          ? [...trackScopes, { paths: filter.paths, include: false }]
          : trackScopes;
        if (node.mixMode === 'add') {
          visit(node.input, blend, timeScale, false, blendMode, seek, reset, trackScopes);
        } else if (filtered) {
          visit(node.input, blend * (1 - shotWeight), timeScale, node.sync !== true, blendMode, seek, reset, matched);
          visit(node.input, blend, timeScale, false, blendMode, seek, reset, unmatched);
        } else {
          visit(node.input, blend * (1 - shotWeight), timeScale, node.sync !== true, blendMode, seek, reset, trackScopes);
        }
        const shotStart = out.length;
        visit(
          node.shot,
          blend * shotWeight,
          timeScale,
          false,
          node.mixMode === 'add' ? 'additive' : blendMode,
          seek,
          didStart || reset,
          matched,
        );
        const shotLength = out.slice(shotStart).reduce(
          (longest, leaf) => Math.max(
            longest,
            (runtime.clipLengths.get(leaf.clip) ?? 0) /
              Math.max(0.00001, Math.abs(leaf.timeScale)),
          ),
          0,
        );
        const loopingShot = out.slice(shotStart).some((leaf) => runtime.clipLoops.get(leaf.clip) === true);
        const naturalFadeStart = Math.max(0, shotLength - Math.max(0, node.fadeOut));
        if (!state.stopping && shotLength > 0 && (!loopingShot || node.breakLoopAtEnd === true) &&
          state.elapsed >= naturalFadeStart) {
          state.stopping = true;
          state.fadeElapsed = Math.max(0, state.elapsed - naturalFadeStart);
        }
        state.elapsed += Math.max(0, delta);
        state.fadeInElapsed += Math.max(0, delta);
        if (state.stopping) state.fadeElapsed += Math.max(0, delta);
        if (state.stopping && (node.fadeOut <= 0 || state.fadeElapsed >= node.fadeOut)) {
          state.active = false;
          state.stopping = false;
          state.elapsed = 0;
          state.fadeInElapsed = 0;
          state.fadeElapsed = 0;
          if (node.autorestart) {
            state.restartDelay = (node.autorestartDelay ?? 1) +
              runtime.random() * (node.autorestartRandomDelay ?? 0);
          }
          params.set(node.activeParam, false);
        }
        return;
      }
      case 'stateMachine': {
        let playback = runtime.stateMachines.get(id);
        if (playback === undefined) {
          const installed = params.get(node.playbackParam);
          playback = isStateMachinePlayback(installed)
            ? installed
            : createAnimationStateMachinePlayback(node.machine, collectLeaves, runtime.random);
          runtime.stateMachines.set(id, playback);
          params.set(node.playbackParam, playback);
        }
        playback.setClipLengths(runtime.clipLengths);
        playback.setClipLoops(runtime.clipLoops);
        for (const leaf of playback.evaluate(params, delta)) {
          out.push({
            ...leaf,
            blend: leaf.blend * blend,
            timeScale: leaf.timeScale * timeScale,
          });
        }
        return;
      }
      case 'blendSpace1D': {
        const position = numericParameter(params, node.param, 0);
        const weighted = blendSpace1DWeights(node.points, position, node.mode);
        const weights = node.sync === true
          ? node.points.map((_point, index) => ({
              index,
              weight: weighted.find((entry) => entry.index === index)?.weight ?? 0,
            }))
          : weighted.filter((entry) => entry.weight >= CMP_EPSILON);
        const selected = weights.length === 1 ? weights[0]?.index : undefined;
        const prior = runtime.blendSpaceSelection.get(id);
        if (selected !== undefined) runtime.blendSpaceSelection.set(id, selected);
        for (const weight of weights) {
          const runtimeKey = `${id}:1d:${weight.index}`;
          const childRuntime = runtime.subtrees.get(runtimeKey) ??
            createAnimationTreeEvaluationRuntime(runtime.random);
          runtime.subtrees.set(runtimeKey, childRuntime);
          inheritClipLengths(runtime, childRuntime);
          const child = collectLeaves(node.points[weight.index]?.tree as BlendTree, params, childRuntime, delta);
          for (const leaf of child) out.push({
            ...leaf,
            blend: leaf.blend * blend * weight.weight,
            timeScale: leaf.timeScale * timeScale,
            reset: node.mode === 'discrete' && selected !== prior,
          });
        }
        return;
      }
      case 'blendSpace2D': {
        const position = vector2Parameter(params, node.param);
        const weighted = blendSpace2DWeights(node.points, node.triangles, position, node.mode);
        const weights = node.sync === true
          ? node.points.map((_point, index) => ({
              index,
              weight: weighted.find((entry) => entry.index === index)?.weight ?? 0,
            }))
          : weighted.filter((entry) => entry.weight >= CMP_EPSILON);
        const selected = weights.length === 1 ? weights[0]?.index : undefined;
        const prior = runtime.blendSpaceSelection.get(id);
        if (selected !== undefined) runtime.blendSpaceSelection.set(id, selected);
        for (const weight of weights) {
          const runtimeKey = `${id}:2d:${weight.index}`;
          const childRuntime = runtime.subtrees.get(runtimeKey) ??
            createAnimationTreeEvaluationRuntime(runtime.random);
          runtime.subtrees.set(runtimeKey, childRuntime);
          inheritClipLengths(runtime, childRuntime);
          const child = collectLeaves(node.points[weight.index]?.tree as BlendTree, params, childRuntime, delta);
          for (const leaf of child) out.push({
            ...leaf,
            blend: leaf.blend * blend * weight.weight,
            timeScale: leaf.timeScale * timeScale,
            reset: node.mode === 'discrete' && selected !== prior,
          });
        }
        return;
      }
      case 'transition': {
        const xfade = node.xfade ?? 0;
        if (!Number.isFinite(xfade) || xfade < 0) throw new RangeError(`AnimationNodeTransition ${id} xfade must be >= 0`);
        let current = Math.trunc(numericParameter(params, node.param, 0));
        if (node.requestParam !== undefined) {
          const request = params.get(node.requestParam);
          if (typeof request === 'string' && request.length > 0) {
            const requestedIndex = node.inputNames?.indexOf(request) ?? -1;
            if (requestedIndex < 0) {
              throw new Error(`godot-compat: AnimationNodeTransition ${JSON.stringify(id)} has no input ${JSON.stringify(request)}`);
            }
            current = requestedIndex;
            params.set(node.param, current);
            params.set(node.requestParam, '');
          }
        }
        // Godot returns 0 (drives nothing) when current is out of range (animation_blend_tree.cpp:713).
        if (current < 0 || current >= node.inputs.length) return;
        const selected = node.inputs[current];
        if (selected === undefined || selected === null) return;
        let state = runtime.transitions.get(id);
        if (state === undefined) {
          state = { current, previous: current, elapsed: xfade };
          runtime.transitions.set(id, state);
        }
        const switched = state.current !== current;
        if (switched) {
          state.previous = state.current;
          state.current = current;
          state.elapsed = 0;
        } else {
          state.elapsed += Math.max(0, delta);
        }
        const condition = node.advanceCondition?.[current];
        if (current + 1 < node.inputs.length && condition !== undefined && condition.length > 0 &&
          Boolean(params.get(`parameters/conditions/${condition}`))) {
          state.previous = current;
          current += 1;
          state.current = current;
          state.elapsed = 0;
          params.set(node.param, current);
        }
        if (node.currentStateParam !== undefined) {
          params.set(node.currentStateParam, node.inputNames?.[current] ?? '');
        }
        const mix = xfade <= 0 ? 1 : Math.min(1, state.elapsed / xfade);
        if (mix < 1) {
          const previous = node.inputs[state.previous];
          if (previous !== undefined && previous !== null) {
            visit(previous, blend * (1 - mix), timeScale, false, blendMode, seek, reset);
          }
        }
        const selectedStart = out.length;
        visit(
          selected,
          blend * mix,
          timeScale,
          false,
          blendMode,
          seek,
          reset || switched && (node.inputReset?.[current] ?? true),
        );
        if ((node.autoAdvance?.[current] ?? false) && node.inputs.length > 0) {
          const duration = out.slice(selectedStart).reduce((longest, leaf) => {
            const clipLength = runtime.clipLengths.get(leaf.clip) ?? 0;
            return Math.max(longest, clipLength / Math.max(CMP_EPSILON, Math.abs(leaf.timeScale)));
          }, 0);
          const looping = out.slice(selectedStart).some(
            (leaf) => runtime.clipLoops.get(leaf.clip) === true,
          );
          if (duration > 0 && (!looping || (node.breakLoopAtEnd?.[current] ?? false)) &&
            state.elapsed >= Math.max(0, duration - xfade)) {
            params.set(node.param, (current + 1) % node.inputs.length);
          }
        }
        return;
      }
      default: {
        const exhaustive: never = node;
        throw new Error(
          `godot-compat: unsupported AnimationTree node ${JSON.stringify(exhaustive)}. Only ` +
            'output/animation/blend2/blend3/add2/add3/sub2/timescale/timeseek/transition/oneshot/' +
            'state-machine/blend-space nodes are ported. Expression nodes remain unsupported.',
        );
      }
    }
  };
  visit('output', 1, 1, false);
  return out;
}

/**
 * Evaluate the blend graph for a parameter vector, reproducing Godot 3.6's own blend EXACTLY: skip
 * sub-`CMP_EPSILON` contributions, then replay the incremental lerp over the visit order so the
 * first surviving leaf initialises and each later leaf lerps the accumulated weights toward itself
 * by its raw blend. The returned weights sum to 1 (when any leaf survives), so three's weighted
 * action blend reproduces the pose. Validated against
 * `packages/gd-analyze/test/ground-truth/godot36-animation.json`.
 */
export function evaluateBlendTree(
  tree: BlendTree,
  params: Readonly<Record<string, number>>,
): LeafDrive[] {
  const visits = collectLeaves(
    tree,
    new Map(Object.entries(params)),
    createAnimationTreeEvaluationRuntime(() => 0),
    0,
  );
  return combineLeafVisits(visits);
}

function combineLeafVisits(visits: readonly AnimationTreeLeafVisit[]): LeafDrive[] {
  // Effective weight per clip, built by the same incremental lerp Godot's accumulator runs:
  // r = r*(1-blend) + this*blend, with the first survivor initialising (its blend discarded).
  const scopeKey = (scopes: readonly AnimationTrackScope[] | undefined): string =>
    scopes === undefined || scopes.length === 0
      ? '*'
      : scopes.map((scope) =>
          `${scope.include ? '+' : '-'}${[...scope.paths].sort().join('\u0001')}`,
        ).join('\u0002');
  const driveKey = (clip: string, scopes: readonly AnimationTrackScope[] | undefined): string =>
    `${clip}\u0000${scopeKey(scopes)}`;
  const normalWeight = new Map<string, number>();
  const additiveWeight = new Map<string, number>();
  const visitState = new Map<string, Pick<LeafDrive, 'clip' | 'timeScale' | 'seek' | 'reset' | 'trackScopes'>>();
  const initializedScopes = new Set<string>();
  for (const v of visits) {
    const key = driveKey(v.clip, v.trackScopes);
    const group = scopeKey(v.trackScopes);
    visitState.set(key, {
      clip: v.clip,
      timeScale: v.timeScale,
      ...(v.seek === undefined ? {} : { seek: v.seek }),
      ...(v.reset === undefined ? {} : { reset: v.reset }),
      ...(v.trackScopes === undefined ? {} : { trackScopes: v.trackScopes }),
    });
    if (v.blendMode === 'additive') {
      if (Math.abs(v.blend) < CMP_EPSILON) continue;
      additiveWeight.set(key, (additiveWeight.get(key) ?? 0) + v.blend);
      continue;
    }
    if (v.blend < CMP_EPSILON) continue;
    if (!initializedScopes.has(group)) {
      normalWeight.set(key, 1);
      initializedScopes.add(group);
    } else {
      for (const [candidate, w] of normalWeight) {
        if (candidate.endsWith(`\u0000${group}`)) normalWeight.set(candidate, w * (1 - v.blend));
      }
      normalWeight.set(key, (normalWeight.get(key) ?? 0) + v.blend);
    }
  }
  // One entry per PROCESSED leaf — including a zero-weight one, whose playhead Godot still
  // advances (see {@link LeafDrive}).
  const out: LeafDrive[] = [];
  for (const [key, state] of visitState) {
    const additive = additiveWeight.get(key);
    if (additive !== undefined && normalWeight.has(key)) {
      throw new Error(
        `godot-compat: AnimationTree drives clip ${JSON.stringify(state.clip)} through both normal and ` +
          'additive branches in one frame; one native AnimationAction cannot hold both blend modes.',
      );
    }
    if (additive !== undefined) {
      out.push({ weight: additive, blendMode: 'additive', ...state });
    } else {
      out.push({ weight: normalWeight.get(key) ?? 0, blendMode: 'normal', ...state });
    }
  }
  return out;
}

/**
 * The runtime STATE of one `AnimationTree` node: its graph, the parameter map the game writes, and
 * whether it is active. Godot state, held as a plain record — no clock, no scheduler.
 */
export interface AnimationTreeState {
  tree: BlendTree;
  readonly parameters: Map<string, unknown>;
  readonly runtime: AnimationTreeEvaluationRuntime;
  active: boolean;
}

/**
 * Build the state for one `AnimationTree`. `active` is the node's AUTHORED `active` property, whose
 * Godot default is FALSE — `player.gd` turns it on in `_ready` with `set_active(true)`.
 */
export function createAnimationTree(options: {
  readonly tree: BlendTree;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly active?: boolean;
  readonly random: Pick<GodotRandom, 'randf'>;
}): AnimationTreeState {
  const result: AnimationTreeState = {
    tree: options.tree,
    parameters: new Map(Object.entries(options.parameters ?? {})),
    runtime: createAnimationTreeEvaluationRuntime(() => options.random.randf()),
    active: options.active ?? false,
  };
  installAnimationNodeFilterBindings(result.tree);
  installStateMachinePlaybacks(result.tree, result.parameters, result.runtime);
  return result;
}

interface AnimationBlendTreeResourceState {
  graphOffset: Vector2;
  readonly positions: Map<string, Vector2>;
}

const BLEND_TREE_RESOURCE_STATES = new WeakMap<object, AnimationBlendTreeResourceState>();

function resourceStringName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`godot-compat: ${member} requires a non-empty StringName.`);
  }
  return value;
}

function resourceVector2(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: ${member} requires a Vector2 value.`);
  }
  const x = Number(Reflect.get(value, 'x'));
  const y = Number(Reflect.get(value, 'y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`godot-compat: ${member} requires finite x/y channels.`);
  }
  return vec2(x, y);
}

function resourceMethod(
  resource: object,
  name: string,
  implementation: (...args: unknown[]) => unknown,
  changed = false,
): void {
  Object.defineProperty(resource, name, {
    configurable: true,
    enumerable: false,
    value: (...args: unknown[]) => {
      const result = implementation(...args);
      if (changed) godotResourceEmitChanged(resource);
      return result;
    },
  });
}

function blendTreeState(tree: BlendTree): AnimationBlendTreeResourceState {
  const state = BLEND_TREE_RESOURCE_STATES.get(tree);
  if (state === undefined) {
    throw new Error('godot-compat: AnimationNodeBlendTree has no bound Resource state.');
  }
  return state;
}

function nodeInputCount(node: BlendNode): number {
  switch (node.type) {
    case 'output':
    case 'timescale':
    case 'timeseek':
      return 1;
    case 'blend2':
    case 'add2':
    case 'sub2':
      return 2;
    case 'blend3':
    case 'add3':
      return 3;
    case 'oneshot':
      return 2;
    case 'transition':
      return node.inputs.length;
    default:
      return 0;
  }
}

function setNodeInput(node: BlendNode, input: number, source: string): void {
  if (!Number.isSafeInteger(input) || input < 0 || input >= nodeInputCount(node)) {
    throw new RangeError(`godot-compat: AnimationNode input ${String(input)} is out of range.`);
  }
  if (node.type === 'output' || node.type === 'timescale' || node.type === 'timeseek') {
    (node as { input: string }).input = source;
  } else if (node.type === 'blend2' || node.type === 'add2' || node.type === 'sub2') {
    (node as { input0: string; input1: string })[input === 0 ? 'input0' : 'input1'] = source;
  } else if (node.type === 'blend3' || node.type === 'add3') {
    const field = (['input0', 'input1', 'input2'] as const)[input];
    if (field !== undefined) (node as { input0: string; input1: string; input2: string })[field] = source;
  } else if (node.type === 'oneshot') {
    if (input === 0) (node as { input: string }).input = source;
    else (node as { shot: string }).shot = source;
  } else if (node.type === 'transition') {
    const inputs = [...node.inputs];
    inputs[input] = source.length === 0 ? null : source;
    (node as { inputs: readonly (string | null)[] }).inputs = inputs;
  }
}

function renameNodeReferences(tree: BlendTree, from: string, to: string): void {
  for (const node of Object.values(tree.nodes)) {
    const replace = (value: string): string => value === from ? to : value;
    if (node.type === 'output' || node.type === 'timescale' || node.type === 'timeseek') {
      (node as { input: string }).input = replace(node.input);
    } else if (node.type === 'blend2' || node.type === 'add2' || node.type === 'sub2') {
      (node as { input0: string; input1: string }).input0 = replace(node.input0);
      (node as { input0: string; input1: string }).input1 = replace(node.input1);
    } else if (node.type === 'blend3' || node.type === 'add3') {
      (node as { input0: string; input1: string; input2: string }).input0 = replace(node.input0);
      (node as { input0: string; input1: string; input2: string }).input1 = replace(node.input1);
      (node as { input0: string; input1: string; input2: string }).input2 = replace(node.input2);
    } else if (node.type === 'oneshot') {
      (node as { input: string }).input = replace(node.input);
      (node as { shot: string }).shot = replace(node.shot);
    } else if (node.type === 'transition') {
      (node as { inputs: readonly (string | null)[] }).inputs = node.inputs.map((value) =>
        value === null ? null : replace(value));
    }
  }
}

function assignNodeParameterPrefix(node: BlendNode, name: string, previous?: string): void {
  const rewrite = (path: string, suffix: string): string => {
    if (previous !== undefined && path.startsWith(`parameters/${previous}/`)) {
      return `parameters/${name}/${path.slice(`parameters/${previous}/`.length)}`;
    }
    if (!path.startsWith('parameters/') || path.indexOf('/', 'parameters/'.length) < 0) {
      return `parameters/${name}/${suffix}`;
    }
    return path;
  };
  if (node.type === 'blend2' || node.type === 'blend3' || node.type === 'add2' ||
      node.type === 'sub2' || node.type === 'add3') {
    (node as { param: string }).param = rewrite(node.param, 'blend_amount');
  } else if (node.type === 'timescale') {
    (node as { param: string }).param = rewrite(node.param, 'scale');
  } else if (node.type === 'transition') {
    (node as { param: string }).param = rewrite(node.param, 'current_index');
  } else if (node.type === 'oneshot') {
    (node as { requestParam: string }).requestParam = rewrite(
      node.requestParam,
      node.requestMode === 'activeBool' ? 'active' : 'request',
    );
    (node as { activeParam: string }).activeParam = rewrite(node.activeParam, 'active');
  }
}

function bindAnimationBlendTreeResource(tree: BlendTree): void {
  if (BLEND_TREE_RESOURCE_STATES.has(tree)) return;
  const state: AnimationBlendTreeResourceState = { graphOffset: vec2(), positions: new Map() };
  BLEND_TREE_RESOURCE_STATES.set(tree, state);
  registerGodotObjectIdentity(tree, 'AnimationNodeBlendTree');
  bindGodotResourceProtocol(tree, {
    createDuplicate(source) {
      const sourceState = blendTreeState(source);
      const copy: BlendTree = { nodes: { ...source.nodes } };
      bindAnimationBlendTreeResource(copy);
      const copyState = blendTreeState(copy);
      copyState.graphOffset = vec2(sourceState.graphOffset.x, sourceState.graphOffset.y);
      for (const [name, position] of sourceState.positions) {
        copyState.positions.set(name, vec2(position.x, position.y));
      }
      return copy;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      const nodes = target.nodes as Record<string, BlendNode>;
      for (const [name, node] of Object.entries(source.nodes)) {
        nodes[name] = duplicateGodotSubresource(node, memo);
      }
    },
  });
  resourceMethod(tree, 'get_node', (name) => {
    if (typeof name !== 'string') {
      throw new TypeError('godot-compat: AnimationNodeBlendTree.get_node name must be a StringName.');
    }
    return tree.nodes[name] ?? null;
  });
  resourceMethod(tree, 'has_node', (name) => typeof name === 'string' && tree.nodes[name] !== undefined);
  resourceMethod(tree, 'get_node_list', () => packedStringArray(Object.keys(tree.nodes).sort()));
  resourceMethod(tree, 'add_node', (nameValue, nodeValue, positionValue = vec2()) => {
    const name = resourceStringName(nameValue, 'AnimationNodeBlendTree.add_node name');
    if (name === 'output' || tree.nodes[name] !== undefined) {
      throw new Error(`godot-compat: AnimationNodeBlendTree already contains ${JSON.stringify(name)}.`);
    }
    if (typeof nodeValue !== 'object' || nodeValue === null || typeof Reflect.get(nodeValue, 'type') !== 'string') {
      throw new TypeError('godot-compat: AnimationNodeBlendTree.add_node requires an AnimationNode resource.');
    }
    (tree.nodes as Record<string, BlendNode>)[name] = nodeValue as BlendNode;
    assignNodeParameterPrefix(nodeValue as BlendNode, name);
    blendTreeState(tree).positions.set(name, resourceVector2(positionValue, 'AnimationNodeBlendTree node position'));
    bindBlendNodeResource(nodeValue as BlendNode);
  }, true);
  resourceMethod(tree, 'remove_node', (nameValue) => {
    const name = resourceStringName(nameValue, 'AnimationNodeBlendTree.remove_node name');
    if (name === 'output') throw new Error('godot-compat: AnimationNodeBlendTree cannot remove output.');
    if (tree.nodes[name] === undefined) {
      throw new Error(`godot-compat: AnimationNodeBlendTree has no node ${JSON.stringify(name)}.`);
    }
    delete (tree.nodes as Record<string, BlendNode>)[name];
    blendTreeState(tree).positions.delete(name);
    renameNodeReferences(tree, name, '');
  }, true);
  resourceMethod(tree, 'rename_node', (fromValue, toValue) => {
    const from = resourceStringName(fromValue, 'AnimationNodeBlendTree.rename_node from');
    const to = resourceStringName(toValue, 'AnimationNodeBlendTree.rename_node to');
    if (from === 'output' || to === 'output') throw new Error('godot-compat: output is a reserved blend-tree node name.');
    const node = tree.nodes[from];
    if (node === undefined) throw new Error(`godot-compat: AnimationNodeBlendTree has no node ${JSON.stringify(from)}.`);
    if (tree.nodes[to] !== undefined) throw new Error(`godot-compat: AnimationNodeBlendTree already contains ${JSON.stringify(to)}.`);
    const nodes = tree.nodes as Record<string, BlendNode>;
    nodes[to] = node;
    delete nodes[from];
    const state = blendTreeState(tree);
    const position = state.positions.get(from);
    state.positions.delete(from);
    if (position !== undefined) state.positions.set(to, position);
    assignNodeParameterPrefix(node, to, from);
    renameNodeReferences(tree, from, to);
  }, true);
  resourceMethod(tree, 'connect_node', (inputNodeValue, inputValue, outputNodeValue) => {
    const inputNode = resourceStringName(inputNodeValue, 'AnimationNodeBlendTree.connect_node input_node');
    const outputNode = resourceStringName(outputNodeValue, 'AnimationNodeBlendTree.connect_node output_node');
    const target = tree.nodes[inputNode];
    if (target === undefined || tree.nodes[outputNode] === undefined) {
      throw new Error('godot-compat: AnimationNodeBlendTree.connect_node references a missing node.');
    }
    setNodeInput(target, Number(inputValue), outputNode);
  }, true);
  resourceMethod(tree, 'disconnect_node', (inputNodeValue, inputValue) => {
    const inputNode = resourceStringName(inputNodeValue, 'AnimationNodeBlendTree.disconnect_node input_node');
    const target = tree.nodes[inputNode];
    if (target === undefined) throw new Error(`godot-compat: AnimationNodeBlendTree has no node ${JSON.stringify(inputNode)}.`);
    setNodeInput(target, Number(inputValue), '');
  }, true);
  resourceMethod(tree, 'set_node_position', (nameValue, positionValue) => {
    const name = resourceStringName(nameValue, 'AnimationNodeBlendTree.set_node_position name');
    if (tree.nodes[name] === undefined) throw new Error(`godot-compat: AnimationNodeBlendTree has no node ${JSON.stringify(name)}.`);
    blendTreeState(tree).positions.set(name, resourceVector2(positionValue, 'AnimationNodeBlendTree node position'));
  }, true);
  resourceMethod(tree, 'get_node_position', (nameValue) => {
    const name = resourceStringName(nameValue, 'AnimationNodeBlendTree.get_node_position name');
    const position = blendTreeState(tree).positions.get(name) ?? vec2();
    return vec2(position.x, position.y);
  });
  Object.defineProperty(tree, 'graph_offset', {
    configurable: true,
    enumerable: false,
    get: () => {
      const value = blendTreeState(tree).graphOffset;
      return vec2(value.x, value.y);
    },
    set: (value: unknown) => {
      blendTreeState(tree).graphOffset = resourceVector2(value, 'AnimationNodeBlendTree.graph_offset');
      godotResourceEmitChanged(tree);
    },
  });
  resourceMethod(tree, 'set_graph_offset', (value) => {
    blendTreeState(tree).graphOffset = resourceVector2(value, 'AnimationNodeBlendTree.graph_offset');
  }, true);
  resourceMethod(tree, 'get_graph_offset', () => {
    const value = blendTreeState(tree).graphOffset;
    return vec2(value.x, value.y);
  });
}

const ANIMATION_NODE_INPUT_NAMES = new WeakMap<object, string[]>();

function animationNodeClass(node: BlendNode): string {
  switch (node.type) {
    case 'output': return 'AnimationNodeOutput';
    case 'animation': return 'AnimationNodeAnimation';
    case 'blend2': return 'AnimationNodeBlend2';
    case 'timescale': return 'AnimationNodeTimeScale';
    case 'timeseek': return 'AnimationNodeTimeSeek';
    case 'transition': return 'AnimationNodeTransition';
    case 'blend3': return 'AnimationNodeBlend3';
    case 'add2': return 'AnimationNodeAdd2';
    case 'sub2': return 'AnimationNodeSub2';
    case 'add3': return 'AnimationNodeAdd3';
    case 'oneshot': return 'AnimationNodeOneShot';
    case 'stateMachine': return 'AnimationNodeStateMachine';
    case 'blendSpace1D': return 'AnimationNodeBlendSpace1D';
    case 'blendSpace2D': return 'AnimationNodeBlendSpace2D';
  }
}

function defaultInputNames(node: BlendNode): string[] {
  switch (node.type) {
    case 'output': return ['output'];
    case 'timescale':
    case 'timeseek': return ['in'];
    case 'blend2':
    case 'add2':
    case 'sub2': return ['in', 'blend'];
    case 'blend3':
    case 'add3': return ['in', '-blend', '+blend'];
    case 'oneshot': return ['in', 'shot'];
    case 'transition': return [...(node.inputNames ?? node.inputs.map((_, index) => String(index)))];
    default: return [];
  }
}

function copyBlendNodeRecord(source: BlendNode): BlendNode {
  const sync = Reflect.get(source, 'sync');
  const autorestart = source.type === 'oneshot' ? Reflect.get(source, 'autorestart') : undefined;
  const copy = { ...source } as BlendNode;
  if (source.type === 'transition') {
    Object.assign(copy, {
      inputs: [...source.inputs],
      ...(source.inputNames === undefined ? {} : { inputNames: [...source.inputNames] }),
      ...(source.autoAdvance === undefined ? {} : { autoAdvance: [...source.autoAdvance] }),
      ...(source.advanceCondition === undefined
        ? {}
        : { advanceCondition: [...source.advanceCondition] }),
    });
  } else if (source.type === 'stateMachine') {
    const positions = source.machine.positions === undefined
      ? undefined
      : Object.fromEntries(Object.entries(source.machine.positions).map(([name, position]) => [
        name,
        vec2(position.x, position.y),
      ]));
    Object.assign(copy, {
      machine: {
        ...source.machine,
        states: { ...source.machine.states },
        transitions: [...source.machine.transitions],
        ...(positions === undefined ? {} : { positions }),
      },
    });
  }
  bindBlendNodeResource(copy);
  if (typeof sync === 'boolean' && Reflect.has(copy, 'sync')) {
    Reflect.set(copy, 'sync', sync);
  }
  if (source.type === 'oneshot' && typeof autorestart === 'boolean') {
    Reflect.set(copy, 'autorestart', autorestart);
  }
  const names = ANIMATION_NODE_INPUT_NAMES.get(source);
  const copyNames = ANIMATION_NODE_INPUT_NAMES.get(copy);
  if (names !== undefined && copyNames !== undefined) {
    copyNames.splice(0, copyNames.length, ...names);
  }
  return copy;
}

function bindAnimationNodeCommon(node: BlendNode): void {
  const names = defaultInputNames(node);
  ANIMATION_NODE_INPUT_NAMES.set(node, names);
  const currentNames = (): string[] => node.type === 'transition'
    ? [...(node.inputNames ?? node.inputs.map((_, index) => String(index)))]
    : names;
  const replaceNames = (next: string[]): void => {
    if (node.type === 'transition') {
      (node as { inputNames?: readonly string[] }).inputNames = next;
    } else {
      names.splice(0, names.length, ...next);
    }
  };
  resourceMethod(node, 'add_input', (nameValue) => {
    const name = resourceStringName(nameValue, 'AnimationNode.add_input name');
    const next = currentNames();
    if (next.includes(name)) throw new Error(`godot-compat: AnimationNode input ${JSON.stringify(name)} already exists.`);
    next.push(name);
    if (node.type === 'transition') {
      (node as { inputs: readonly (string | null)[] }).inputs = [...node.inputs, null];
    }
    replaceNames(next);
  }, true);
  resourceMethod(node, 'remove_input', (indexValue) => {
    const index = Number(indexValue);
    const next = currentNames();
    if (!Number.isSafeInteger(index) || index < 0 || index >= next.length) {
      throw new RangeError(`godot-compat: AnimationNode.remove_input index ${String(indexValue)} is out of range.`);
    }
    next.splice(index, 1);
    if (node.type === 'transition') {
      const inputs = [...node.inputs];
      inputs.splice(index, 1);
      (node as { inputs: readonly (string | null)[] }).inputs = inputs;
    }
    replaceNames(next);
  }, true);
  resourceMethod(node, 'set_input_name', (indexValue, nameValue) => {
    const index = Number(indexValue);
    const next = currentNames();
    if (!Number.isSafeInteger(index) || index < 0 || index >= next.length) {
      throw new RangeError(`godot-compat: AnimationNode.set_input_name index ${String(indexValue)} is out of range.`);
    }
    const name = resourceStringName(nameValue, 'AnimationNode.set_input_name name');
    if (next.some((current, currentIndex) => currentIndex !== index && current === name)) {
      throw new Error(`godot-compat: AnimationNode input ${JSON.stringify(name)} already exists.`);
    }
    next[index] = name;
    replaceNames(next);
  }, true);
  resourceMethod(node, 'get_input_name', (indexValue) => {
    const index = Number(indexValue);
    const current = currentNames();
    if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
      throw new RangeError(`godot-compat: AnimationNode.get_input_name index ${String(indexValue)} is out of range.`);
    }
    return current[index];
  });
  resourceMethod(node, 'get_input_count', () => currentNames().length);
  resourceMethod(node, 'find_input', (nameValue) =>
    typeof nameValue === 'string' ? currentNames().indexOf(nameValue) : -1);
}

function bindBlendNodeResource(node: BlendNode): void {
  if (ANIMATION_NODE_INPUT_NAMES.has(node)) return;
  const filterClass = node.type === 'blend2' ? 'AnimationNodeBlend2'
    : node.type === 'blend3' ? 'AnimationNodeBlend3'
      : node.type === 'add2' ? 'AnimationNodeAdd2'
        : node.type === 'add3' ? 'AnimationNodeAdd3'
          : node.type === 'sub2' ? 'AnimationNodeSub2'
            : node.type === 'oneshot' ? 'AnimationNodeOneShot'
              : undefined;
  if (filterClass !== undefined) {
    bindAnimationNodeFilter(node, filterClass, {
      enabled: 'filterEnabled' in node && node.filterEnabled === true,
      paths: 'filterPaths' in node ? node.filterPaths ?? [] : [],
    });
  }
  if (node.type === 'animation') {
    bindAnimationLeafNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'timescale') {
    bindAnimationTimeScaleNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'timeseek') {
    bindAnimationTimeSeekNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'transition') {
    bindAnimationTransitionNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'stateMachine') {
    bindAnimationStateMachineNode(
      node as unknown as Record<string, unknown>,
      bindAnimationStateMachineTransition,
    );
  } else if (node.type === 'blendSpace1D') {
    bindAnimationBlendSpace1DNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'blendSpace2D') {
    bindAnimationBlendSpace2DNode(node as unknown as Record<string, unknown>);
  } else if (node.type === 'oneshot') {
    bindAnimationOneShotNode(node as unknown as Record<string, unknown>);
  } else if (
    node.type === 'blend2' || node.type === 'blend3' || node.type === 'add2' ||
    node.type === 'add3' || node.type === 'sub2'
  ) {
    bindAnimationSyncNode(node as unknown as Record<string, unknown>);
  } else {
    registerGodotObjectIdentity(node, animationNodeClass(node));
  }
  bindAnimationNodeCommon(node);
  bindGodotResourceProtocol(node, {
    createDuplicate: copyBlendNodeRecord,
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      if (source.type === 'transition' && target.type === 'transition') {
        const curve = Reflect.get(source, 'xfadeCurve');
        if (typeof curve === 'object' && curve !== null) {
          Reflect.set(target, 'xfade_curve', duplicateGodotSubresource(curve, memo));
        }
      } else if (source.type === 'oneshot' && target.type === 'oneshot') {
        const fadeInCurve = Reflect.get(source, 'fadein_curve');
        const fadeOutCurve = Reflect.get(source, 'fadeout_curve');
        if (typeof fadeInCurve === 'object' && fadeInCurve !== null) {
          Reflect.set(target, 'fadein_curve', duplicateGodotSubresource(fadeInCurve, memo));
        }
        if (typeof fadeOutCurve === 'object' && fadeOutCurve !== null) {
          Reflect.set(target, 'fadeout_curve', duplicateGodotSubresource(fadeOutCurve, memo));
        }
      } else if (source.type === 'stateMachine' && target.type === 'stateMachine') {
        const targetStates = target.machine.states as Record<string, BlendTree>;
        for (const [name, state] of Object.entries(source.machine.states)) {
          targetStates[name] = duplicateGodotSubresource(state, memo);
        }
        const targetMachine = target.machine as { transitions: readonly AnimationStateMachineTransition[] };
        targetMachine.transitions = source.machine.transitions.map((transition) =>
          duplicateGodotSubresource(transition, memo));
      }
    },
  });
}

export function createAnimationNodeAnimation(options: {
  readonly animation?: string;
  readonly playMode?: 'forward' | 'backward';
} = {}): Extract<BlendNode, { readonly type: 'animation' }> {
  const node: Extract<BlendNode, { readonly type: 'animation' }> = {
    type: 'animation',
    clip: options.animation ?? '',
    ...(options.playMode === undefined ? {} : { playMode: options.playMode }),
  };
  bindBlendNodeResource(node);
  return node;
}

export function createAnimationNodeBlend2(): Extract<BlendNode, { readonly type: 'blend2' }> {
  const node: Extract<BlendNode, { readonly type: 'blend2' }> = {
    type: 'blend2',
    input0: '',
    input1: '',
    param: 'parameters/blend_amount',
  };
  bindBlendNodeResource(node);
  return node;
}

/** Godot AnimationNodeBlend3's three retained inputs and signed blend amount. */
export function createAnimationNodeBlend3(): Extract<BlendNode, { readonly type: 'blend3' }> {
  const node: Extract<BlendNode, { readonly type: 'blend3' }> = {
    type: 'blend3',
    input0: '',
    input1: '',
    input2: '',
    param: 'parameters/blend_amount',
  };
  bindBlendNodeResource(node);
  return node;
}

export function createAnimationNodeOneShot(
  godotMajor: 3 | 4 = 4,
): Extract<BlendNode, { readonly type: 'oneshot' }> {
  const node: Extract<BlendNode, { readonly type: 'oneshot' }> = {
    type: 'oneshot',
    input: '',
    shot: '',
    requestParam: godotMajor === 3 ? 'parameters/active' : 'parameters/request',
    activeParam: 'parameters/active',
    ...(godotMajor === 3 ? { requestMode: 'activeBool' as const } : {}),
    fadeIn: godotMajor === 3 ? 0.1 : 0,
    fadeOut: godotMajor === 3 ? 0.1 : 0,
    mixMode: 'blend',
    autorestart: false,
    autorestartDelay: 1,
    autorestartRandomDelay: 0,
    breakLoopAtEnd: false,
    abortOnReset: false,
    sync: false,
  };
  bindBlendNodeResource(node);
  return node;
}

export function createAnimationNodeTimeScale(): Extract<BlendNode, { readonly type: 'timescale' }> {
  const node: Extract<BlendNode, { readonly type: 'timescale' }> = {
    type: 'timescale',
    input: '',
    param: 'parameters/scale',
  };
  bindBlendNodeResource(node);
  return node;
}

export function createAnimationNodeTransition(
  inputCount = 2,
): Extract<BlendNode, { readonly type: 'transition' }> {
  if (!Number.isSafeInteger(inputCount) || inputCount < 0) {
    throw new RangeError('godot-compat: AnimationNodeTransition input count must be non-negative.');
  }
  const node: Extract<BlendNode, { readonly type: 'transition' }> = {
    type: 'transition',
    inputs: Array.from({ length: inputCount }, () => null),
    inputNames: Array.from({ length: inputCount }, (_, index) => String(index)),
    param: 'parameters/current_index',
  };
  bindBlendNodeResource(node);
  return node;
}

export function createAnimationNodeBlendTree(): GodotAnimationBlendTree {
  const tree: BlendTree = { nodes: { output: { type: 'output', input: '' } } };
  installAnimationNodeFilterBindings(tree);
  return tree as GodotAnimationBlendTree;
}

function installAnimationNodeFilterBindings(tree: BlendTree): void {
  bindAnimationBlendTreeResource(tree);
  for (const node of Object.values(tree.nodes)) {
    bindBlendNodeResource(node);
    if (node.type === 'stateMachine') {
      for (const transition of node.machine.transitions) {
        bindAnimationStateMachineTransition(transition as unknown as Record<string, unknown>);
      }
      for (const childTree of Object.values(node.machine.states)) {
        installAnimationNodeFilterBindings(childTree);
      }
    } else if (node.type === 'blendSpace1D' || node.type === 'blendSpace2D') {
      for (const point of node.points) installAnimationNodeFilterBindings(point.tree);
    }
  }
}

/** The retained authored root resource. It is the same graph identity used by evaluation. */
export function getAnimationTreeRoot(state: AnimationTreeState): GodotAnimationBlendTree {
  return state.tree as GodotAnimationBlendTree;
}

/** Replace the retained root Resource consumed by the next native AnimationMixer evaluation. */
export function setAnimationTreeRoot(
  state: AnimationTreeState,
  tree: GodotAnimationBlendTree,
): void {
  if (
    typeof tree !== 'object' ||
    tree === null ||
    typeof tree.get_node !== 'function' ||
    typeof tree.has_node !== 'function'
  ) {
    throw new TypeError('godot-compat: AnimationTree.tree_root requires an AnimationNodeBlendTree.');
  }
  state.tree = tree;
  installAnimationNodeFilterBindings(tree);
  installStateMachinePlaybacks(tree, state.parameters, state.runtime);
}

function installStateMachinePlaybacks(
  tree: BlendTree,
  parameters: Map<string, unknown>,
  runtime: AnimationTreeEvaluationRuntime,
): void {
  for (const node of Object.values(tree.nodes)) {
    if (node.type === 'stateMachine') {
      const playback = createAnimationStateMachinePlayback(node.machine, collectLeaves, runtime.random);
      parameters.set(node.playbackParam, playback);
      for (const childTree of Object.values(node.machine.states)) {
        installStateMachinePlaybacks(childTree, parameters, runtime);
      }
    } else if (node.type === 'blendSpace1D' || node.type === 'blendSpace2D') {
      for (const point of node.points) installStateMachinePlaybacks(point.tree, parameters, runtime);
    }
  }
}

function isStateMachinePlayback(value: unknown): value is AnimationStateMachinePlayback {
  return typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'travel') === 'function' &&
    typeof Reflect.get(value, 'evaluate') === 'function';
}

/**
 * `AnimationTree.set_active(bool)` — `player.gd:32`.
 *
 * Godot's `set_active(false)` stops the tree's playing caches (`animation_tree.cpp:490`-`496`); the
 * effect a port sees is that the tree stops driving the pose — the skeleton HOLDS the last pose the
 * tree wrote. Here the flag gates {@link applyAnimationTree}, which PAUSES every action it manages
 * when inactive (three's `stop()` would restore the bind pose instead, which is the one thing Godot
 * never does — see `animation-player.ts`'s header).
 */
export function setAnimationTreeActive(state: AnimationTreeState, active: boolean): void {
  state.active = active;
}

/** `AnimationTree.is_active()`. */
export function isAnimationTreeActive(state: AnimationTreeState): boolean {
  return state.active;
}

/** `$AnimationTree["parameters/…"] = v` — the per-frame parameter writes (`player.gd:128`-`:132`). */
export function setAnimationTreeParameter(
  state: AnimationTreeState,
  path: string,
  value: unknown,
): void {
  state.parameters.set(path, value);
}

/** `$AnimationTree["parameters/…"]` read. */
export function getAnimationTreeParameter<T = number>(state: AnimationTreeState, path: string): T {
  return (state.parameters.get(path) ?? 0) as T;
}

/** One blend-graph leaf as the PORT holds it: three's own `AnimationAction` plus the Godot
 *  `Animation.loop` of the clip behind it. `AnimationNodeAnimation` honours the clip's own loop, and
 *  `player.tscn`'s `shooting_standing` authors none — a leaf is NOT loopable by assumption. */
export interface AnimationTreeLeaf {
  readonly action: AnimationAction;
  /** The clip's authored `Animation.loop`. */
  readonly loop: boolean;
}

export interface AnimationTreeClipTiming {
  readonly length: number;
  readonly loop: boolean;
}

/** Evaluate one authored tree frame independently of the render surface consuming its drives. */
export function animationTreeFrame(
  state: AnimationTreeState,
  clips: ReadonlyMap<string, AnimationTreeClipTiming>,
  delta: number,
): readonly LeafDrive[] {
  if (!Number.isFinite(delta) || delta < 0) {
    throw new RangeError('godot-compat: AnimationTree delta must be finite and non-negative');
  }
  state.runtime.clipLengths.clear();
  state.runtime.clipLoops.clear();
  for (const [name, clip] of clips) {
    state.runtime.clipLengths.set(name, clip.length);
    state.runtime.clipLoops.set(name, clip.loop);
  }
  for (const playback of state.runtime.stateMachines.values()) playback.setClipLengths(state.runtime.clipLengths);
  for (const playback of state.runtime.stateMachines.values()) playback.setClipLoops(state.runtime.clipLoops);
  if (!state.active) return [];
  return combineLeafVisits(collectLeaves(state.tree, state.parameters, state.runtime, delta));
}

/** The port's map from CLIP NAME to the leaf it built against the model — what
 *  {@link applyAnimationTree} drives. */
export type AnimationTreeActions = ReadonlyMap<string, AnimationTreeLeaf>;

const ADDITIVE_ACTIONS = new WeakMap<AnimationTreeLeaf, AnimationAction>();
const FILTERED_ACTIONS = new WeakMap<AnimationTreeLeaf, Map<string, AnimationAction>>();

function additiveAction(leaf: AnimationTreeLeaf): AnimationAction {
  const current = ADDITIVE_ACTIONS.get(leaf);
  if (current !== undefined) return current;
  const clip = leaf.action.getClip().clone();
  AnimationUtils.makeClipAdditive(clip);
  const action = leaf.action.getMixer().clipAction(clip);
  ADDITIVE_ACTIONS.set(leaf, action);
  return action;
}

function filterScopeKey(scopes: readonly AnimationTrackScope[]): string {
  return scopes.map((scope) =>
    `${scope.include ? '+' : '-'}${[...scope.paths].sort().join('\u0001')}`,
  ).join('\u0002');
}

function godotFilterPathMatchesThreeTrack(path: string, trackName: string): boolean {
  const authored = path.replace(/^\.\//, '').replace(/\\/g, '/');
  const propertyDot = trackName.lastIndexOf('.');
  const binding = propertyDot < 0 ? trackName : trackName.slice(0, propertyDot);
  const threeProperty = propertyDot < 0 ? '' : trackName.slice(propertyDot + 1);
  const boneMatch = /\.bones\[([^\]]+)\]$/.exec(binding);
  const target = boneMatch?.[1] ?? binding.split(/[/:]/).at(-1) ?? binding;
  const colon = authored.lastIndexOf(':');
  const authoredTarget = (colon < 0 ? authored : authored.slice(colon + 1)).split('/').at(-1) ?? authored;
  const authoredProperty = colon < 0 ? '' : authored.slice(colon + 1);
  return authored === trackName || authored === binding || authoredTarget === target ||
    (binding.length === 0 && authoredProperty === threeProperty);
}

function scopesIncludeTrack(scopes: readonly AnimationTrackScope[], trackName: string): boolean {
  return scopes.every((scope) => {
    const matched = scope.paths.some((path) => godotFilterPathMatchesThreeTrack(path, trackName));
    return scope.include ? matched : !matched;
  });
}

function scopedAnimationAction(
  leaf: AnimationTreeLeaf,
  scopes: readonly AnimationTrackScope[],
  blendMode: 'normal' | 'additive',
): AnimationAction | undefined {
  const key = `${blendMode}:${filterScopeKey(scopes)}`;
  const cache = FILTERED_ACTIONS.get(leaf) ?? new Map<string, AnimationAction>();
  FILTERED_ACTIONS.set(leaf, cache);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const source = leaf.action.getClip();
  const tracks = source.tracks
    .filter((track) => scopesIncludeTrack(scopes, track.name))
    .map((track) => track.clone());
  if (tracks.length === 0) return undefined;
  const clip = new AnimationClip(
    `${source.name}#godot-filter:${filterScopeKey(scopes)}`,
    source.duration,
    tracks,
    source.blendMode,
  );
  if (blendMode === 'additive') AnimationUtils.makeClipAdditive(clip);
  const action = leaf.action.getMixer().clipAction(clip);
  cache.set(key, action);
  return action;
}

function pauseLeafActions(leaf: AnimationTreeLeaf): void {
  leaf.action.setEffectiveWeight(0);
  leaf.action.paused = true;
  const additive = ADDITIVE_ACTIONS.get(leaf);
  if (additive !== undefined) {
    additive.setEffectiveWeight(0);
    additive.paused = true;
  }
  for (const action of FILTERED_ACTIONS.get(leaf)?.values() ?? []) {
    action.setEffectiveWeight(0);
    action.paused = true;
  }
}

/**
 * Drive three's own `AnimationAction`s from the current graph + parameters. The port calls this
 * once per frame before stepping the mixer.
 *
 * When the tree is INACTIVE, every managed action is PAUSED — Godot's `set_active(false)` stops the
 * tree's caches and leaves the pose it last wrote, where three's `stop()` would restore the bind
 * pose. When active, each clip the graph PROCESSED gets its effective weight and time scale, runs
 * unpaused, and is looped per its own authored `loop` (a non-looping leaf is `LoopOnce` and clamps
 * on its last frame, not a ping-pong). A leaf the graph did not process is weighted to zero AND
 * paused, so its playhead freezes exactly as Godot's does.
 *
 * `leaves` is the port's map from CLIP NAME to the action + authored loop it built against the model.
 */
export function applyAnimationTree(
  state: AnimationTreeState,
  leaves: AnimationTreeActions,
  delta = 0,
): void {
  if (!state.active) {
    for (const leaf of leaves.values()) pauseLeafActions(leaf);
    return;
  }
  const clips = new Map<string, AnimationTreeClipTiming>();
  for (const [name, leaf] of leaves) {
    clips.set(name, { length: leaf.action.getClip().duration, loop: leaf.loop });
  }
  const drives = animationTreeFrame(state, clips, delta);
  const driven = new Set<AnimationAction>();
  const scopedClocks = new Set<AnimationTreeLeaf>();
  const unscopedLeaves = new Set(
    drives.filter((drive) => drive.trackScopes === undefined)
      .flatMap((drive) => {
        const leaf = leaves.get(drive.clip);
        return leaf === undefined ? [] : [leaf];
      }),
  );
  for (const drive of drives) {
    const leaf = leaves.get(drive.clip);
    if (leaf === undefined) {
      throw new Error(
        `godot-compat: AnimationTree drives clip "${drive.clip}", which the port's action map does ` +
          'not contain. Every AnimationNodeAnimation leaf needs an AnimationAction built against ' +
          'the model.',
      );
    }
    const action = drive.trackScopes === undefined
      ? drive.blendMode === 'additive' ? additiveAction(leaf) : leaf.action
      : scopedAnimationAction(leaf, drive.trackScopes, drive.blendMode ?? 'normal');
    if (action === undefined) continue;
    if (drive.trackScopes !== undefined) {
      // One zero-weight native action is the shared playhead for every partition of this Godot
      // AnimationNodeAnimation leaf. A FILTER_PASS partition may disappear/reappear as weights
      // optimize, but it must resume at the leaf's time rather than starting its own clock.
      if (!unscopedLeaves.has(leaf) && !scopedClocks.has(leaf)) {
        if (drive.reset) leaf.action.reset();
        leaf.action.setLoop(leaf.loop ? LoopRepeat : LoopOnce, leaf.loop ? Number.POSITIVE_INFINITY : 1);
        leaf.action.clampWhenFinished = !leaf.loop;
        leaf.action.enabled = true;
        leaf.action.paused = false;
        leaf.action.setEffectiveWeight(0);
        leaf.action.setEffectiveTimeScale(drive.timeScale);
        if (drive.seek !== undefined) leaf.action.time = Math.max(0, drive.seek);
        if (!leaf.action.isRunning()) leaf.action.play();
        driven.add(leaf.action);
        scopedClocks.add(leaf);
      }
      if (!unscopedLeaves.has(leaf)) action.time = leaf.action.time;
    }
    if (drive.reset) action.reset();
    action.blendMode = drive.blendMode === 'additive'
      ? AdditiveAnimationBlendMode
      : NormalAnimationBlendMode;
    action.setLoop(leaf.loop ? LoopRepeat : LoopOnce, leaf.loop ? Number.POSITIVE_INFINITY : 1);
    action.clampWhenFinished = !leaf.loop;
    action.enabled = true;
    action.paused = false;
    action.setEffectiveWeight(drive.weight);
    action.setEffectiveTimeScale(drive.timeScale);
    if (drive.seek !== undefined) action.time = Math.max(0, drive.seek);
    if (!action.isRunning()) action.play();
    driven.add(action);
  }
  for (const leaf of leaves.values()) {
    const actions = [leaf.action, ADDITIVE_ACTIONS.get(leaf), ...(FILTERED_ACTIONS.get(leaf)?.values() ?? [])];
    for (const action of actions) {
      if (action === undefined || driven.has(action)) continue;
      action.setEffectiveWeight(0);
      action.paused = true;
    }
  }
}
