/** Stateful AnimationTree nodes. The caller owns the clock and native AnimationMixer. */
import type { BlendTree } from './animation-tree';
import { createGodotCurve, type GodotCurve } from './curve';
import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedArrayValue } from './packed-array';
import { bindGodotResourceProtocol } from './resource-io';

export type StateMachineSwitchMode = 'immediate' | 'sync' | 'atEnd';

export interface AnimationTransitionCurvePoint {
  readonly x: number;
  readonly y: number;
  readonly leftTangent: number;
  readonly rightTangent: number;
  readonly leftMode: number;
  readonly rightMode: number;
}

export interface AnimationTransitionCurveSpec {
  readonly points: readonly AnimationTransitionCurvePoint[];
}

export function createAnimationTransitionCurve(
  spec: AnimationTransitionCurveSpec,
): GodotCurve {
  const curve = createGodotCurve();
  for (const point of spec.points) {
    curve.add_point(
      { x: point.x, y: point.y },
      point.leftTangent,
      point.rightTangent,
      point.leftMode,
      point.rightMode,
    );
  }
  return curve;
}

export interface AnimationStateMachineTransition {
  readonly from: string;
  readonly to: string;
  readonly xfadeTime: number;
  readonly switchMode: StateMachineSwitchMode;
  readonly advanceMode?: 'disabled' | 'enabled' | 'auto';
  readonly advanceCondition?: string;
  readonly advanceExpression?: string;
  readonly priority?: number;
  readonly reset?: boolean;
  readonly breakLoopAtEnd?: boolean;
  readonly xfadeCurve?: GodotCurve | null;
}

export interface AnimationStateMachine {
  readonly states: Readonly<Record<string, BlendTree>>;
  readonly positions?: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly transitions: readonly AnimationStateMachineTransition[];
  readonly startNode?: string;
  readonly endNode?: string;
}

export interface AnimationTreeLeafVisit {
  readonly clip: string;
  readonly blend: number;
  readonly timeScale: number;
  readonly blendMode: 'normal' | 'additive';
  readonly seek?: number;
  readonly reset?: boolean;
  /** Nested AnimationNode filter decisions reaching this leaf. Each decision restricts the
   * native Three tracks in the leaf clip to the authored Godot NodePath set or its complement. */
  readonly trackScopes?: readonly AnimationTrackScope[];
}

export interface AnimationTrackScope {
  readonly paths: readonly string[];
  readonly include: boolean;
}

export interface AnimationTransitionRuntime {
  current: number;
  previous: number;
  elapsed: number;
}

export interface AnimationOneShotRuntime {
  active: boolean;
  previousRequestActive: boolean;
  elapsed: number;
  fadeInElapsed: number;
  fadeElapsed: number;
  stopping: boolean;
  restartDelay: number;
}

export interface AnimationTreeEvaluationRuntime {
  readonly transitions: Map<string, AnimationTransitionRuntime>;
  readonly oneShots: Map<string, AnimationOneShotRuntime>;
  readonly stateMachines: Map<string, AnimationStateMachinePlayback>;
  readonly clipLengths: Map<string, number>;
  readonly clipLoops: Map<string, boolean>;
  readonly blendSpaceSelection: Map<string, number>;
  readonly subtrees: Map<string, AnimationTreeEvaluationRuntime>;
  readonly random: () => number;
}

export type AnimationTreeParameterStore = Map<string, unknown>;

export type EvaluateAnimationSubtree = (
  tree: BlendTree,
  parameters: AnimationTreeParameterStore,
  runtime: AnimationTreeEvaluationRuntime,
  delta: number,
) => AnimationTreeLeafVisit[];

export function createAnimationTreeEvaluationRuntime(
  random: () => number,
): AnimationTreeEvaluationRuntime {
  return {
    transitions: new Map(),
    oneShots: new Map(),
    stateMachines: new Map(),
    clipLengths: new Map(),
    clipLoops: new Map(),
    blendSpaceSelection: new Map(),
    subtrees: new Map(),
    random,
  };
}

export interface AnimationStateMachinePlayback {
  travel(toNode: string, reset?: boolean): void;
  start(node: string, reset?: boolean): void;
  next(): void;
  stop(): void;
  isPlaying(): boolean;
  getCurrentNode(): string;
  getCurrentPlayPosition(): number;
  getCurrentLength(): number;
  getFadingFromNode(): string;
  getTravelPath(): PackedArrayValue<string>;
  setClipLengths(lengths: ReadonlyMap<string, number>): void;
  setClipLoops(loops: ReadonlyMap<string, boolean>): void;
  evaluate(parameters: AnimationTreeParameterStore, delta: number): AnimationTreeLeafVisit[];
}

function stateDistance(machine: AnimationStateMachine, from: string, to: string): number {
  const a = machine.positions?.[from];
  const b = machine.positions?.[to];
  if (a === undefined || b === undefined) return 1;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function shortestStatePath(machine: AnimationStateMachine, from: string, to: string): string[] {
  if (from === to) return [];
  const cost = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size > 0) {
    let current: string | undefined;
    for (const candidate of open) {
      const candidateCost = cost.get(candidate) ?? Number.POSITIVE_INFINITY;
      const currentCost = current === undefined
        ? Number.POSITIVE_INFINITY
        : cost.get(current) ?? Number.POSITIVE_INFINITY;
      if (current === undefined || candidateCost < currentCost ||
        (candidateCost === currentCost && candidate < current)) current = candidate;
    }
    if (current === undefined) break;
    open.delete(current);
    if (current === to) break;
    for (const transition of machine.transitions) {
      if (transition.from !== current || transition.advanceMode === 'disabled') continue;
      const candidateCost = (cost.get(current) ?? 0) +
        stateDistance(machine, current, transition.to) * Math.max(1, transition.priority ?? 1);
      if (candidateCost >= (cost.get(transition.to) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(transition.to, candidateCost);
      previous.set(transition.to, current);
      open.add(transition.to);
    }
  }
  if (!previous.has(to)) return [];
  const result: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    result.unshift(cursor);
    const parent = previous.get(cursor);
    if (parent === undefined) return [];
    cursor = parent;
  }
  return result;
}

function transitionCondition(
  transition: AnimationStateMachineTransition,
  parameters: AnimationTreeParameterStore,
): boolean {
  if (transition.advanceExpression !== undefined && transition.advanceExpression.length > 0) {
    throw new Error(
      `godot-compat: AnimationNodeStateMachineTransition.advance_expression ` +
        `${JSON.stringify(transition.advanceExpression)} requires GDScript expression evaluation, ` +
        'which is unavailable at the native AnimationTree boundary.',
    );
  }
  if (transition.advanceCondition === undefined || transition.advanceCondition.length === 0) {
    return transition.advanceMode === 'auto';
  }
  return Boolean(parameters.get(`parameters/conditions/${transition.advanceCondition}`));
}

export function createAnimationStateMachinePlayback(
  machine: AnimationStateMachine,
  evaluateSubtree: EvaluateAnimationSubtree,
  random: () => number,
): AnimationStateMachinePlayback {
  let current = '';
  let playing = false;
  let position = 0;
  let length = 0;
  let travelPath: string[] = [];
  let previous = '';
  let crossFadeElapsed = 0;
  let crossFadeDuration = 0;
  let pendingSyncSeek = false;
  let crossFadeCurve: GodotCurve | null = null;
  const clipLengths = new Map<string, number>();
  const clipLoops = new Map<string, boolean>();
  const stateRuntime = new Map<string, AnimationTreeEvaluationRuntime>();

  const requireState = (name: string): BlendTree => {
    const state = machine.states[name];
    if (state === undefined) {
      throw new Error(`godot-compat: AnimationNodeStateMachine has no state ${JSON.stringify(name)}`);
    }
    return state;
  };
  const enter = (name: string, reset: boolean, transition?: AnimationStateMachineTransition): void => {
    requireState(name);
    previous = current;
    current = name;
    playing = true;
    if (transition?.switchMode !== 'sync' && (reset || transition?.reset !== false)) position = 0;
    pendingSyncSeek = transition?.switchMode === 'sync';
    crossFadeDuration = Math.max(0, transition?.xfadeTime ?? 0);
    crossFadeCurve = transition?.xfadeCurve ?? null;
    crossFadeElapsed = 0;
  };
  const selectTransition = (to: string): AnimationStateMachineTransition | undefined =>
    machine.transitions.find((one) => one.from === current && one.to === to);
  const stateLength = (visits: readonly AnimationTreeLeafVisit[]): number => {
    let result = 0;
    for (const visit of visits) {
      const duration = clipLengths.get(visit.clip) ?? 0;
      result = Math.max(result, duration / Math.max(0.00001, Math.abs(visit.timeScale)));
    }
    return result;
  };
  const stateEvaluationRuntime = (name: string): AnimationTreeEvaluationRuntime => {
    const runtime = stateRuntime.get(name) ?? createAnimationTreeEvaluationRuntime(random);
    runtime.clipLengths.clear();
    for (const [clip, clipLength] of clipLengths) runtime.clipLengths.set(clip, clipLength);
    runtime.clipLoops.clear();
    for (const [clip, loop] of clipLoops) runtime.clipLoops.set(clip, loop);
    stateRuntime.set(name, runtime);
    return runtime;
  };

  const playback: AnimationStateMachinePlayback = {
    travel(toNode, reset = true) {
      requireState(toNode);
      if (!playing || current.length === 0) {
        enter(toNode, reset);
        travelPath = [];
        return;
      }
      travelPath = shortestStatePath(machine, current, toNode);
      if (travelPath.length === 0 && current !== toNode) enter(toNode, reset);
    },
    start(node, reset = true) {
      travelPath = [];
      enter(node, reset);
    },
    next() {
      const transition = machine.transitions.find(
        (one) => one.from === current && one.advanceMode !== 'disabled',
      );
      if (transition?.to === 'End') {
        playing = false;
        travelPath = [];
      } else if (transition !== undefined) {
        enter(transition.to, transition.reset !== false, transition);
      }
    },
    stop() {
      playing = false;
      travelPath = [];
      previous = '';
      position = 0;
    },
    isPlaying: () => playing,
    getCurrentNode: () => current,
    getCurrentPlayPosition: () => position,
    getCurrentLength: () => length,
    getFadingFromNode: () => previous,
    getTravelPath: () => packedStringArray(travelPath),
    setClipLengths(lengths) {
      clipLengths.clear();
      for (const [clip, clipLength] of lengths) clipLengths.set(clip, clipLength);
    },
    setClipLoops(loops) {
      clipLoops.clear();
      for (const [clip, loop] of loops) clipLoops.set(clip, loop);
    },
    evaluate(parameters, delta) {
      if (!playing) {
        const initial = machine.startNode ?? Object.keys(machine.states)[0];
        if (initial === undefined) return [];
        enter(initial, true);
      }
      position += Math.max(0, delta);
      let stopAfterCurrent = false;
      if (travelPath.length > 0) {
        const target = travelPath[0];
        const transition = target === undefined ? undefined : selectTransition(target);
        const mayEnter = transition?.switchMode !== 'atEnd' ||
          (length > 0 && position >= Math.max(0, length - transition.xfadeTime));
        if (target !== undefined && mayEnter) {
          travelPath.shift();
          enter(target, transition?.reset !== false, transition);
        }
      } else {
        const automatic = machine.transitions
          .filter((one) => one.from === current && one.advanceMode !== 'disabled')
          .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1))
          .find((one) => {
            if (!transitionCondition(one, parameters)) return false;
            return one.switchMode !== 'atEnd' ||
              (length > 0 && position >= Math.max(0, length - one.xfadeTime));
          });
        if (automatic?.to === 'End') stopAfterCurrent = true;
        else if (automatic !== undefined) enter(automatic.to, automatic.reset !== false, automatic);
      }
      const tree = requireState(current);
      const runtime = stateEvaluationRuntime(current);
      let currentVisits = evaluateSubtree(tree, parameters, runtime, delta);
      if (pendingSyncSeek) {
        currentVisits = currentVisits.map((visit) => ({ ...visit, seek: position }));
        pendingSyncSeek = false;
      }
      length = stateLength(currentVisits);
      if (stopAfterCurrent) {
        playing = false;
        travelPath = [];
      }
      if (crossFadeDuration <= 0 || previous.length === 0 || previous === current) {
        previous = '';
        return currentVisits;
      }
      crossFadeElapsed += Math.max(0, delta);
      const linearRatio = Math.min(1, crossFadeElapsed / crossFadeDuration);
      const sampledRatio = crossFadeCurve?.sample(linearRatio) ?? linearRatio;
      const ratio = Math.min(1, Math.max(0, sampledRatio));
      const oldTree = machine.states[previous];
      if (oldTree === undefined || ratio >= 1) {
        previous = '';
        return currentVisits;
      }
      const oldRuntime = stateEvaluationRuntime(previous);
      const oldVisits = evaluateSubtree(oldTree, parameters, oldRuntime, delta);
      return [
        ...oldVisits.map((visit) => ({ ...visit, blend: visit.blend * (1 - ratio) })),
        ...currentVisits.map((visit) => ({ ...visit, blend: visit.blend * ratio })),
      ];
    },
  };
  registerGodotObjectIdentity(playback, 'AnimationNodeStateMachinePlayback');
  bindGodotResourceProtocol(playback, {
    createDuplicate: () => createAnimationStateMachinePlayback(machine, evaluateSubtree, random),
  });
  return playback;
}
