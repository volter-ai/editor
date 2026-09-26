/** Script-visible AnimationNode resource members installed on the retained graph records. */
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';
import { vec2, type Vector2 } from './vector2';
import { delaunayBlendSpaceTriangles } from './animation-blend-space';
import type { GodotCurve } from './curve';

type MutableRecord = Record<string, unknown>;

function finite(value: unknown, property: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: ${property} must be finite`);
  }
  return value;
}

function bool(value: unknown, property: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`godot-compat: ${property} must be boolean`);
  }
  return value;
}

function stringName(value: unknown, property: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`godot-compat: ${property} must be StringName-compatible`);
  }
  return value;
}

function curveOrNull(value: unknown, propertyName: string): GodotCurve | null {
  if (value === null) return null;
  if (typeof value !== 'object' || typeof Reflect.get(value, 'sample') !== 'function') {
    throw new TypeError(`godot-compat: ${propertyName} must be a Curve or null`);
  }
  return value as GodotCurve;
}

function method(node: object, name: string, value: (...args: unknown[]) => unknown): void {
  const mutates = /^(?:set_|add_|remove_|rename_|connect_|disconnect_|reorder_)/.test(name);
  Object.defineProperty(node, name, {
    configurable: true,
    enumerable: false,
    value: (...args: unknown[]) => {
      const result = value(...args);
      if (mutates) godotResourceEmitChanged(node);
      return result;
    },
  });
}

function property(
  node: object,
  name: string,
  get: () => unknown,
  set: (value: unknown) => void,
): void {
  Object.defineProperty(node, name, {
    configurable: true,
    enumerable: false,
    get,
    set: (value: unknown) => {
      set(value);
      godotResourceEmitChanged(node);
    },
  });
}

function bindSync(node: MutableRecord): void {
  let sync = node['sync'] === true;
  property(
    node,
    'sync',
    () => sync,
    (value) => { sync = bool(value, 'AnimationNodeSync.sync'); },
  );
  method(node, 'set_use_sync', (value) => { sync = bool(value, 'AnimationNodeSync.sync'); });
  method(node, 'is_using_sync', () => sync);
}

export function bindAnimationLeafNode(node: MutableRecord): void {
  registerGodotObjectIdentity(node, 'AnimationNodeAnimation');
  property(
    node,
    'animation',
    () => node['clip'],
    (value) => { node['clip'] = stringName(value, 'AnimationNodeAnimation.animation'); },
  );
  method(node, 'set_animation', (value) => {
    node['clip'] = stringName(value, 'AnimationNodeAnimation.animation');
  });
  method(node, 'get_animation', () => node['clip']);
  property(
    node,
    'play_mode',
    () => node['playMode'] === 'backward' ? 1 : 0,
    (value) => {
      const mode = finite(value, 'AnimationNodeAnimation.play_mode');
      if (mode !== 0 && mode !== 1) throw new RangeError('godot-compat: AnimationNodeAnimation.play_mode must be 0 or 1');
      node['playMode'] = mode === 1 ? 'backward' : 'forward';
    },
  );
  method(node, 'set_play_mode', (value) => {
    const mode = finite(value, 'AnimationNodeAnimation.play_mode');
    if (mode !== 0 && mode !== 1) throw new RangeError('godot-compat: AnimationNodeAnimation.play_mode must be 0 or 1');
    node['playMode'] = mode === 1 ? 'backward' : 'forward';
  });
  method(node, 'get_play_mode', () => node['playMode'] === 'backward' ? 1 : 0);
}

export function bindAnimationSyncNode(node: MutableRecord): void {
  bindSync(node);
}

export function bindAnimationOneShotNode(node: MutableRecord): void {
  bindSync(node);
  let autorestart = node['autorestart'] === true;
  let fadeInCurve = curveOrNull(node['fadeInCurve'] ?? null, 'AnimationNodeOneShot.fadein_curve');
  let fadeOutCurve = curveOrNull(node['fadeOutCurve'] ?? null, 'AnimationNodeOneShot.fadeout_curve');
  let breakLoopAtEnd = node['breakLoopAtEnd'] === true;
  let abortOnReset = node['abortOnReset'] === true;
  const mixMode = (value: unknown): 'blend' | 'add' => {
    const result = integer(value, 'AnimationNodeOneShot.mix_mode');
    if (result !== 0 && result !== 1) {
      throw new RangeError('godot-compat: AnimationNodeOneShot.mix_mode must be MIX_MODE_BLEND or MIX_MODE_ADD');
    }
    return result === 1 ? 'add' : 'blend';
  };
  property(node, 'fadein_time', () => node['fadeIn'], (value) => {
    node['fadeIn'] = finite(value, 'AnimationNodeOneShot.fadein_time');
  });
  property(node, 'fadeout_time', () => node['fadeOut'], (value) => {
    node['fadeOut'] = finite(value, 'AnimationNodeOneShot.fadeout_time');
  });
  method(node, 'set_fadein_time', (value) => {
    node['fadeIn'] = finite(value, 'AnimationNodeOneShot.fadein_time');
  });
  method(node, 'get_fadein_time', () => node['fadeIn']);
  method(node, 'set_fadeout_time', (value) => {
    node['fadeOut'] = finite(value, 'AnimationNodeOneShot.fadeout_time');
  });
  method(node, 'get_fadeout_time', () => node['fadeOut']);
  property(node, 'fadein_curve', () => fadeInCurve, (value) => {
    fadeInCurve = curveOrNull(value, 'AnimationNodeOneShot.fadein_curve');
    node['fadeInCurve'] = fadeInCurve;
  });
  method(node, 'set_fadein_curve', (value) => {
    fadeInCurve = curveOrNull(value, 'AnimationNodeOneShot.fadein_curve');
    node['fadeInCurve'] = fadeInCurve;
  });
  method(node, 'get_fadein_curve', () => fadeInCurve);
  property(node, 'fadeout_curve', () => fadeOutCurve, (value) => {
    fadeOutCurve = curveOrNull(value, 'AnimationNodeOneShot.fadeout_curve');
    node['fadeOutCurve'] = fadeOutCurve;
  });
  method(node, 'set_fadeout_curve', (value) => {
    fadeOutCurve = curveOrNull(value, 'AnimationNodeOneShot.fadeout_curve');
    node['fadeOutCurve'] = fadeOutCurve;
  });
  method(node, 'get_fadeout_curve', () => fadeOutCurve);
  property(node, 'mix_mode', () => node['mixMode'] === 'add' ? 1 : 0, (value) => {
    node['mixMode'] = mixMode(value);
  });
  method(node, 'set_mix_mode', (value) => { node['mixMode'] = mixMode(value); });
  method(node, 'get_mix_mode', () => node['mixMode'] === 'add' ? 1 : 0);
  property(node, 'break_loop_at_end', () => breakLoopAtEnd, (value) => {
    breakLoopAtEnd = bool(value, 'AnimationNodeOneShot.break_loop_at_end');
    node['breakLoopAtEnd'] = breakLoopAtEnd;
  });
  method(node, 'set_break_loop_at_end', (value) => {
    breakLoopAtEnd = bool(value, 'AnimationNodeOneShot.break_loop_at_end');
    node['breakLoopAtEnd'] = breakLoopAtEnd;
  });
  method(node, 'is_loop_broken_at_end', () => breakLoopAtEnd);
  property(node, 'abort_on_reset', () => abortOnReset, (value) => {
    abortOnReset = bool(value, 'AnimationNodeOneShot.abort_on_reset');
    node['abortOnReset'] = abortOnReset;
  });
  method(node, 'set_abort_on_reset', (value) => {
    abortOnReset = bool(value, 'AnimationNodeOneShot.abort_on_reset');
    node['abortOnReset'] = abortOnReset;
  });
  method(node, 'is_aborted_on_reset', () => abortOnReset);
  property(node, 'autorestart', () => autorestart, (value) => {
    autorestart = bool(value, 'AnimationNodeOneShot.autorestart');
  });
  method(node, 'set_autorestart', (value) => {
    autorestart = bool(value, 'AnimationNodeOneShot.autorestart');
  });
  method(node, 'has_autorestart', () => autorestart);
  method(node, 'set_autorestart_delay', (value) => {
    node['autorestartDelay'] = finite(value, 'AnimationNodeOneShot.autorestart_delay');
  });
  method(node, 'get_autorestart_delay', () => node['autorestartDelay'] ?? 1);
  property(node, 'autorestart_delay', () => node['autorestartDelay'] ?? 1, (value) => {
    node['autorestartDelay'] = finite(value, 'AnimationNodeOneShot.autorestart_delay');
  });
  method(node, 'set_autorestart_random_delay', (value) => {
    node['autorestartRandomDelay'] = finite(value, 'AnimationNodeOneShot.autorestart_random_delay');
  });
  method(node, 'get_autorestart_random_delay', () => node['autorestartRandomDelay'] ?? 0);
  property(node, 'autorestart_random_delay', () => node['autorestartRandomDelay'] ?? 0, (value) => {
    node['autorestartRandomDelay'] = finite(value, 'AnimationNodeOneShot.autorestart_random_delay');
  });
}

function integer(value: unknown, propertyName: string): number {
  const result = finite(value, propertyName);
  if (!Number.isInteger(result)) throw new TypeError(`godot-compat: ${propertyName} must be an integer`);
  return result;
}

function vector2(value: unknown, propertyName: string): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: ${propertyName} must be Vector2-like`);
  }
  return vec2(
    finite(Reflect.get(value, 'x'), `${propertyName}.x`),
    finite(Reflect.get(value, 'y'), `${propertyName}.y`),
  );
}

export function bindAnimationTimeScaleNode(node: MutableRecord): void {
  registerGodotObjectIdentity(node, 'AnimationNodeTimeScale');
}

export function bindAnimationTimeSeekNode(node: MutableRecord): void {
  registerGodotObjectIdentity(node, 'AnimationNodeTimeSeek');
  let explicitElapse = node['explicitElapse'] === true;
  property(node, 'explicit_elapse', () => explicitElapse, (value) => {
    explicitElapse = bool(value, 'AnimationNodeTimeSeek.explicit_elapse');
  });
  method(node, 'set_explicit_elapse', (value) => {
    explicitElapse = bool(value, 'AnimationNodeTimeSeek.explicit_elapse');
  });
  method(node, 'is_explicit_elapse', () => explicitElapse);
}

export function bindAnimationTransitionNode(node: MutableRecord): void {
  registerGodotObjectIdentity(node, 'AnimationNodeTransition');
  bindSync(node);
  let xfadeCurve = curveOrNull(node['xfadeCurve'] ?? null, 'AnimationNodeTransition.xfade_curve');
  let allowTransitionToSelf = node['allowTransitionToSelf'] === true;
  property(node, 'xfade_time', () => node['xfade'] ?? 0, (value) => {
    const next = finite(value, 'AnimationNodeTransition.xfade_time');
    if (next < 0) throw new RangeError('godot-compat: AnimationNodeTransition.xfade_time must be non-negative');
    node['xfade'] = next;
  });
  method(node, 'set_xfade_time', (value) => {
    const next = finite(value, 'AnimationNodeTransition.xfade_time');
    if (next < 0) throw new RangeError('godot-compat: AnimationNodeTransition.xfade_time must be non-negative');
    node['xfade'] = next;
  });
  method(node, 'get_xfade_time', () => node['xfade'] ?? 0);
  method(node, 'set_cross_fade_time', (value) => {
    const next = finite(value, 'AnimationNodeTransition.xfade_time');
    if (next < 0) throw new RangeError('godot-compat: AnimationNodeTransition.xfade_time must be non-negative');
    node['xfade'] = next;
  });
  method(node, 'get_cross_fade_time', () => node['xfade'] ?? 0);
  property(node, 'xfade_curve', () => xfadeCurve, (value) => {
    xfadeCurve = curveOrNull(value, 'AnimationNodeTransition.xfade_curve');
    node['xfadeCurve'] = xfadeCurve;
  });
  method(node, 'set_xfade_curve', (value) => {
    xfadeCurve = curveOrNull(value, 'AnimationNodeTransition.xfade_curve');
    node['xfadeCurve'] = xfadeCurve;
  });
  method(node, 'get_xfade_curve', () => xfadeCurve);
  property(node, 'allow_transition_to_self', () => allowTransitionToSelf, (value) => {
    allowTransitionToSelf = bool(value, 'AnimationNodeTransition.allow_transition_to_self');
    node['allowTransitionToSelf'] = allowTransitionToSelf;
  });
  method(node, 'set_allow_transition_to_self', (value) => {
    allowTransitionToSelf = bool(value, 'AnimationNodeTransition.allow_transition_to_self');
    node['allowTransitionToSelf'] = allowTransitionToSelf;
  });
  method(node, 'is_allow_transition_to_self', () => allowTransitionToSelf);
  method(node, 'get_input_count', () => (node['inputs'] as readonly unknown[]).length);
  const setInputCount = (value: unknown): void => {
    const count = integer(value, 'AnimationNodeTransition.input_count');
    if (count < 0) throw new RangeError('godot-compat: AnimationNodeTransition.input_count must be non-negative');
    const inputs = [...(node['inputs'] as readonly (string | null)[])];
    const names = [...((node['inputNames'] as readonly string[] | undefined) ?? [])];
    const automatic = [...((node['autoAdvance'] as readonly boolean[] | undefined) ?? [])];
    const conditions = [...((node['advanceCondition'] as readonly string[] | undefined) ?? [])];
    const breakLoops = [...((node['breakLoopAtEnd'] as readonly boolean[] | undefined) ?? [])];
    const resets = [...((node['inputReset'] as readonly boolean[] | undefined) ?? [])];
    while (inputs.length < count) inputs.push(null);
    while (names.length < count) names.push(`state_${names.length}`);
    while (automatic.length < count) automatic.push(false);
    while (conditions.length < count) conditions.push('');
    while (breakLoops.length < count) breakLoops.push(false);
    while (resets.length < count) resets.push(true);
    inputs.length = count;
    names.length = count;
    automatic.length = count;
    conditions.length = count;
    breakLoops.length = count;
    resets.length = count;
    node['inputs'] = inputs;
    node['inputNames'] = names;
    node['autoAdvance'] = automatic;
    node['advanceCondition'] = conditions;
    node['breakLoopAtEnd'] = breakLoops;
    node['inputReset'] = resets;
  };
  method(node, 'set_input_count', setInputCount);
  method(node, 'set_enabled_inputs', setInputCount);
  method(node, 'get_enabled_inputs', () => (node['inputs'] as readonly unknown[]).length);
  const index = (value: unknown, member: string): number => {
    const result = integer(value, `AnimationNodeTransition.${member}`);
    const count = (node['inputs'] as readonly unknown[]).length;
    if (result < 0 || result >= count) throw new RangeError(`godot-compat: ${member} index ${result} is out of range`);
    return result;
  };
  method(node, 'set_input_name', (at, value) => {
    const names = [...((node['inputNames'] as readonly string[] | undefined) ?? [])];
    names[index(at, 'set_input_name')] = stringName(value, 'AnimationNodeTransition input name');
    node['inputNames'] = names;
  });
  method(node, 'get_input_name', (at) =>
    ((node['inputNames'] as readonly string[] | undefined) ?? [])[index(at, 'get_input_name')] ?? '');
  method(node, 'set_input_caption', (at, value) => {
    const names = [...((node['inputNames'] as readonly string[] | undefined) ?? [])];
    names[index(at, 'set_input_caption')] = stringName(value, 'AnimationNodeTransition input caption');
    node['inputNames'] = names;
  });
  method(node, 'get_input_caption', (at) =>
    ((node['inputNames'] as readonly string[] | undefined) ?? [])[index(at, 'get_input_caption')] ?? '');
  const setInputAutoAdvance = (at: unknown, value: unknown): void => {
    const automatic = [...((node['autoAdvance'] as readonly boolean[] | undefined) ?? [])];
    automatic[index(at, 'set_input_auto_advance')] = bool(value, 'AnimationNodeTransition auto_advance');
    node['autoAdvance'] = automatic;
  };
  method(node, 'set_input_as_auto_advance', setInputAutoAdvance);
  method(node, 'set_input_auto_advance', setInputAutoAdvance);
  method(node, 'is_input_set_as_auto_advance', (at) =>
    ((node['autoAdvance'] as readonly boolean[] | undefined) ?? [])[index(at, 'is_input_set_as_auto_advance')] === true);
  method(node, 'set_input_advance_condition', (at, value) => {
    const conditions = [...((node['advanceCondition'] as readonly string[] | undefined) ?? [])];
    conditions[index(at, 'set_input_advance_condition')] = stringName(value, 'AnimationNodeTransition advance_condition');
    node['advanceCondition'] = conditions;
  });
  method(node, 'get_input_advance_condition', (at) =>
    ((node['advanceCondition'] as readonly string[] | undefined) ?? [])[index(at, 'get_input_advance_condition')] ?? '');
  method(node, 'set_input_break_loop_at_end', (at, value) => {
    const values = [...((node['breakLoopAtEnd'] as readonly boolean[] | undefined) ?? [])];
    values[index(at, 'set_input_break_loop_at_end')] = bool(value, 'AnimationNodeTransition break_loop_at_end');
    node['breakLoopAtEnd'] = values;
  });
  method(node, 'is_input_loop_broken_at_end', (at) =>
    ((node['breakLoopAtEnd'] as readonly boolean[] | undefined) ?? [])[index(at, 'is_input_loop_broken_at_end')] === true);
  method(node, 'set_input_reset', (at, value) => {
    const values = [...((node['inputReset'] as readonly boolean[] | undefined) ?? [])];
    values[index(at, 'set_input_reset')] = bool(value, 'AnimationNodeTransition input reset');
    node['inputReset'] = values;
  });
  method(node, 'is_input_reset', (at) =>
    ((node['inputReset'] as readonly boolean[] | undefined) ?? [])[index(at, 'is_input_reset')] !== false);
}

export interface AnimationBlendPointRuntime {
  position?: number;
  x?: number;
  y?: number;
  tree: object;
}

function bindBlendSpaceCommon(node: MutableRecord, className: 'AnimationNodeBlendSpace1D' | 'AnimationNodeBlendSpace2D'): void {
  registerGodotObjectIdentity(node, className);
  bindSync(node);
  property(node, 'blend_mode', () => {
    const mode = node['mode'];
    return mode === 'discrete' ? 1 : mode === 'discreteCarry' ? 2 : 0;
  }, (value) => {
    const mode = integer(value, `${className}.blend_mode`);
    if (mode < 0 || mode > 2) throw new RangeError(`godot-compat: ${className}.blend_mode must be 0..2`);
    node['mode'] = (['interpolated', 'discrete', 'discreteCarry'] as const)[mode];
  });
  method(node, 'set_blend_mode', (value) => {
    const mode = integer(value, `${className}.blend_mode`);
    if (mode < 0 || mode > 2) throw new RangeError(`godot-compat: ${className}.blend_mode must be 0..2`);
    node['mode'] = (['interpolated', 'discrete', 'discreteCarry'] as const)[mode];
  });
  method(node, 'get_blend_mode', () => node['mode'] === 'discrete' ? 1 : node['mode'] === 'discreteCarry' ? 2 : 0);
  method(node, 'get_blend_point_count', () => (node['points'] as readonly unknown[]).length);
  method(node, 'get_blend_point_node', (at) => {
    const points = node['points'] as readonly AnimationBlendPointRuntime[];
    const point = points[integer(at, `${className}.get_blend_point_node`)];
    if (point === undefined) throw new RangeError(`godot-compat: ${className} blend point is out of range`);
    return point.tree;
  });
  method(node, 'remove_blend_point', (at) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const point = integer(at, `${className}.remove_blend_point`);
    if (point < 0 || point >= points.length) throw new RangeError(`godot-compat: ${className} blend point is out of range`);
    points.splice(point, 1);
    node['points'] = points;
  });
}

export function bindAnimationBlendSpace1DNode(node: MutableRecord): void {
  bindBlendSpaceCommon(node, 'AnimationNodeBlendSpace1D');
  let minSpace = typeof node['minSpace'] === 'number' ? node['minSpace'] : -1;
  let maxSpace = typeof node['maxSpace'] === 'number' ? node['maxSpace'] : 1;
  let snap = typeof node['snap'] === 'number' ? node['snap'] : 0.1;
  let valueLabel = typeof node['valueLabel'] === 'string' ? node['valueLabel'] : 'value';
  const setMin = (value: unknown): void => {
    const next = finite(value, 'AnimationNodeBlendSpace1D.min_space');
    minSpace = next >= maxSpace ? maxSpace - 1 : next;
  };
  const setMax = (value: unknown): void => {
    const next = finite(value, 'AnimationNodeBlendSpace1D.max_space');
    maxSpace = next <= minSpace ? minSpace + 1 : next;
  };
  property(node, 'min_space', () => minSpace, setMin);
  property(node, 'max_space', () => maxSpace, setMax);
  property(node, 'snap', () => snap, (value) => { snap = finite(value, 'AnimationNodeBlendSpace1D.snap'); });
  property(node, 'value_label', () => valueLabel, (value) => {
    valueLabel = stringName(value, 'AnimationNodeBlendSpace1D.value_label');
  });
  method(node, 'set_min_space', setMin);
  method(node, 'get_min_space', () => minSpace);
  method(node, 'set_max_space', setMax);
  method(node, 'get_max_space', () => maxSpace);
  method(node, 'set_snap', (value) => { snap = finite(value, 'AnimationNodeBlendSpace1D.snap'); });
  method(node, 'get_snap', () => snap);
  method(node, 'set_value_label', (value) => {
    valueLabel = stringName(value, 'AnimationNodeBlendSpace1D.value_label');
  });
  method(node, 'get_value_label', () => valueLabel);
  method(node, 'add_blend_point', (tree, position, atIndex = -1) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const at = integer(atIndex, 'AnimationNodeBlendSpace1D.add_blend_point at_index');
    const next = { tree: tree as object, position: finite(position, 'AnimationNodeBlendSpace1D position') };
    if (at < 0 || at >= points.length) points.push(next);
    else points.splice(at, 0, next);
    node['points'] = points;
  });
  method(node, 'set_blend_point_position', (at, position) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const index = integer(at, 'AnimationNodeBlendSpace1D.set_blend_point_position');
    const point = points[index];
    if (point === undefined) throw new RangeError('godot-compat: AnimationNodeBlendSpace1D blend point is out of range');
    points[index] = { ...point, position: finite(position, 'AnimationNodeBlendSpace1D position') };
    node['points'] = points;
  });
  method(node, 'get_blend_point_position', (at) => {
    const point = (node['points'] as readonly AnimationBlendPointRuntime[])[integer(at, 'AnimationNodeBlendSpace1D.get_blend_point_position')];
    if (point === undefined) throw new RangeError('godot-compat: AnimationNodeBlendSpace1D blend point is out of range');
    return point.position;
  });
}

export function bindAnimationBlendSpace2DNode(node: MutableRecord): void {
  bindBlendSpaceCommon(node, 'AnimationNodeBlendSpace2D');
  let minSpace = vector2(node['minSpace'] ?? vec2(-1, -1), 'AnimationNodeBlendSpace2D.min_space');
  let maxSpace = vector2(node['maxSpace'] ?? vec2(1, 1), 'AnimationNodeBlendSpace2D.max_space');
  let snap = vector2(node['snap'] ?? vec2(0.1, 0.1), 'AnimationNodeBlendSpace2D.snap');
  let xLabel = typeof node['xLabel'] === 'string' ? node['xLabel'] : 'x';
  let yLabel = typeof node['yLabel'] === 'string' ? node['yLabel'] : 'y';
  let autoTriangles = node['autoTriangles'] !== false;
  const regenerateTriangles = (): void => {
    const points = node['points'] as readonly AnimationBlendPointRuntime[];
    node['triangles'] = delaunayBlendSpaceTriangles(points.map((point) => ({
      x: finite(point.x, 'AnimationNodeBlendSpace2D point.x'),
      y: finite(point.y, 'AnimationNodeBlendSpace2D point.y'),
    })));
  };
  const setMin = (value: unknown): void => {
    const next = vector2(value, 'AnimationNodeBlendSpace2D.min_space');
    minSpace = vec2(next.x >= maxSpace.x ? maxSpace.x - 1 : next.x, next.y >= maxSpace.y ? maxSpace.y - 1 : next.y);
  };
  const setMax = (value: unknown): void => {
    const next = vector2(value, 'AnimationNodeBlendSpace2D.max_space');
    maxSpace = vec2(next.x <= minSpace.x ? minSpace.x + 1 : next.x, next.y <= minSpace.y ? minSpace.y + 1 : next.y);
  };
  property(node, 'min_space', () => vec2(minSpace.x, minSpace.y), setMin);
  property(node, 'max_space', () => vec2(maxSpace.x, maxSpace.y), setMax);
  property(node, 'snap', () => vec2(snap.x, snap.y), (value) => {
    snap = vector2(value, 'AnimationNodeBlendSpace2D.snap');
  });
  property(node, 'x_label', () => xLabel, (value) => {
    xLabel = stringName(value, 'AnimationNodeBlendSpace2D.x_label');
  });
  property(node, 'y_label', () => yLabel, (value) => {
    yLabel = stringName(value, 'AnimationNodeBlendSpace2D.y_label');
  });
  property(node, 'auto_triangles', () => autoTriangles, (value) => {
    const enabled = bool(value, 'AnimationNodeBlendSpace2D.auto_triangles');
    autoTriangles = enabled;
    if (autoTriangles) regenerateTriangles();
  });
  method(node, 'set_min_space', setMin);
  method(node, 'get_min_space', () => vec2(minSpace.x, minSpace.y));
  method(node, 'set_max_space', setMax);
  method(node, 'get_max_space', () => vec2(maxSpace.x, maxSpace.y));
  method(node, 'set_snap', (value) => { snap = vector2(value, 'AnimationNodeBlendSpace2D.snap'); });
  method(node, 'get_snap', () => vec2(snap.x, snap.y));
  method(node, 'set_x_label', (value) => { xLabel = stringName(value, 'AnimationNodeBlendSpace2D.x_label'); });
  method(node, 'get_x_label', () => xLabel);
  method(node, 'set_y_label', (value) => { yLabel = stringName(value, 'AnimationNodeBlendSpace2D.y_label'); });
  method(node, 'get_y_label', () => yLabel);
  method(node, 'set_auto_triangles', (value) => {
    const enabled = bool(value, 'AnimationNodeBlendSpace2D.auto_triangles');
    autoTriangles = enabled;
    if (autoTriangles) regenerateTriangles();
  });
  method(node, 'get_auto_triangles', () => autoTriangles);
  method(node, 'add_blend_point', (tree, position, atIndex = -1) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const at = integer(atIndex, 'AnimationNodeBlendSpace2D.add_blend_point at_index');
    const nextPosition = vector2(position, 'AnimationNodeBlendSpace2D position');
    const next = { tree: tree as object, x: nextPosition.x, y: nextPosition.y };
    if (at < 0 || at >= points.length) points.push(next);
    else points.splice(at, 0, next);
    node['points'] = points;
    if (autoTriangles) regenerateTriangles();
  });
  method(node, 'remove_blend_point', (at) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const removed = integer(at, 'AnimationNodeBlendSpace2D.remove_blend_point');
    if (removed < 0 || removed >= points.length) {
      throw new RangeError('godot-compat: AnimationNodeBlendSpace2D blend point is out of range');
    }
    points.splice(removed, 1);
    const triangles = (node['triangles'] as readonly (readonly [number, number, number])[])
      .filter((triangle) => !triangle.includes(removed))
      .map((triangle) => triangle.map((point) => point > removed ? point - 1 : point) as [number, number, number]);
    node['points'] = points;
    node['triangles'] = triangles;
    if (autoTriangles) regenerateTriangles();
  });
  method(node, 'set_blend_point_position', (at, position) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const index = integer(at, 'AnimationNodeBlendSpace2D.set_blend_point_position');
    const point = points[index];
    if (point === undefined) throw new RangeError('godot-compat: AnimationNodeBlendSpace2D blend point is out of range');
    const next = vector2(position, 'AnimationNodeBlendSpace2D position');
    points[index] = { ...point, x: next.x, y: next.y };
    node['points'] = points;
    if (autoTriangles) regenerateTriangles();
  });
  method(node, 'get_blend_point_position', (at) => {
    const point = (node['points'] as readonly AnimationBlendPointRuntime[])[integer(at, 'AnimationNodeBlendSpace2D.get_blend_point_position')];
    if (point === undefined) throw new RangeError('godot-compat: AnimationNodeBlendSpace2D blend point is out of range');
    return vec2(
      finite(point.x, 'AnimationNodeBlendSpace2D point.x'),
      finite(point.y, 'AnimationNodeBlendSpace2D point.y'),
    );
  });
  method(node, 'add_triangle', (x, y, z, atIndex = -1) => {
    const points = node['points'] as readonly AnimationBlendPointRuntime[];
    const triangle = [x, y, z].map((value) => {
      const index = integer(value, 'AnimationNodeBlendSpace2D triangle point');
      if (index < 0 || index >= points.length) throw new RangeError('godot-compat: BlendSpace2D triangle point is out of range');
      return index;
    }).sort((a, b) => a - b) as [number, number, number];
    if (triangle[0] === triangle[1] || triangle[1] === triangle[2]) {
      throw new Error('godot-compat: AnimationNodeBlendSpace2D triangle points must be distinct');
    }
    const triangles = [...(node['triangles'] as readonly (readonly [number, number, number])[])];
    if (triangles.some((existing) =>
      existing[0] === triangle[0] && existing[1] === triangle[1] && existing[2] === triangle[2])) {
      throw new Error('godot-compat: AnimationNodeBlendSpace2D triangle already exists');
    }
    const at = integer(atIndex, 'AnimationNodeBlendSpace2D.add_triangle at_index');
    if (at < 0 || at >= triangles.length) triangles.push(triangle);
    else triangles.splice(at, 0, triangle);
    node['triangles'] = triangles;
  });
  method(node, 'get_triangle_count', () =>
    (node['triangles'] as readonly (readonly [number, number, number])[]).length);
  method(node, 'get_triangle_point', (triangleIndex, pointIndex) => {
    const triangles = node['triangles'] as readonly (readonly [number, number, number])[];
    const triangle = triangles[integer(triangleIndex, 'AnimationNodeBlendSpace2D triangle')];
    if (triangle === undefined) throw new RangeError('godot-compat: BlendSpace2D triangle is out of range');
    const point = integer(pointIndex, 'AnimationNodeBlendSpace2D triangle corner');
    if (point < 0 || point > 2) throw new RangeError('godot-compat: BlendSpace2D triangle corner must be 0..2');
    return triangle[point];
  });
  method(node, 'remove_triangle', (at) => {
    const triangles = [...(node['triangles'] as readonly (readonly [number, number, number])[])];
    const index = integer(at, 'AnimationNodeBlendSpace2D.remove_triangle');
    if (index < 0 || index >= triangles.length) throw new RangeError('godot-compat: BlendSpace2D triangle is out of range');
    triangles.splice(index, 1);
    node['triangles'] = triangles;
  });
  method(node, 'has_triangle', (x, y, z) => {
    const sought = [x, y, z].map((value) =>
      integer(value, 'AnimationNodeBlendSpace2D.has_triangle point'),
    ).sort((a, b) => a - b);
    return (node['triangles'] as readonly (readonly [number, number, number])[]).some((triangle) =>
      triangle[0] === sought[0] && triangle[1] === sought[1] && triangle[2] === sought[2]);
  });
  method(node, 'reorder_blend_point', (fromValue, toValue) => {
    const points = [...(node['points'] as readonly AnimationBlendPointRuntime[])];
    const from = integer(fromValue, 'AnimationNodeBlendSpace2D.reorder_blend_point from');
    const to = integer(toValue, 'AnimationNodeBlendSpace2D.reorder_blend_point to');
    if (from < 0 || from >= points.length || to < 0 || to >= points.length) {
      throw new RangeError('godot-compat: AnimationNodeBlendSpace2D reorder index is out of range');
    }
    if (from === to) return;
    const [moved] = points.splice(from, 1);
    if (moved === undefined) return;
    points.splice(to, 0, moved);
    const remap = (point: number): number => {
      if (point === from) return to;
      if (from < to && point > from && point <= to) return point - 1;
      if (to < from && point >= to && point < from) return point + 1;
      return point;
    };
    node['points'] = points;
    node['triangles'] = (node['triangles'] as readonly (readonly [number, number, number])[])
      .map((triangle) => triangle.map(remap).sort((a, b) => a - b) as [number, number, number]);
    if (autoTriangles) regenerateTriangles();
  });
}

export function bindAnimationStateMachineTransition(transition: MutableRecord): void {
  registerGodotObjectIdentity(transition, 'AnimationNodeStateMachineTransition');
  let priority = typeof transition['priority'] === 'number' ? transition['priority'] : 1;
  let reset = transition['reset'] !== false;
  let breakLoopAtEnd = transition['breakLoopAtEnd'] === true;
  let advanceExpression = typeof transition['advanceExpression'] === 'string' ? transition['advanceExpression'] : '';
  let xfadeCurve = curveOrNull(transition['xfadeCurve'] ?? null, 'AnimationNodeStateMachineTransition.xfade_curve');
  const enumValue = (value: unknown, propertyName: string, max: number): number => {
    const result = integer(value, propertyName);
    if (result < 0 || result > max) throw new RangeError(`godot-compat: ${propertyName} must be 0..${max}`);
    return result;
  };
  property(transition, 'xfade_time', () => transition['xfadeTime'], (value) => {
    const next = finite(value, 'AnimationNodeStateMachineTransition.xfade_time');
    if (next < 0) throw new RangeError('godot-compat: AnimationNodeStateMachineTransition.xfade_time must be non-negative');
    transition['xfadeTime'] = next;
  });
  property(transition, 'xfade_curve', () => xfadeCurve, (value) => {
    xfadeCurve = curveOrNull(value, 'AnimationNodeStateMachineTransition.xfade_curve');
    transition['xfadeCurve'] = xfadeCurve;
  });
  property(transition, 'break_loop_at_end', () => breakLoopAtEnd, (value) => {
    breakLoopAtEnd = bool(value, 'AnimationNodeStateMachineTransition.break_loop_at_end');
    transition['breakLoopAtEnd'] = breakLoopAtEnd;
  });
  property(transition, 'advance_expression', () => advanceExpression, (value) => {
    advanceExpression = stringName(value, 'AnimationNodeStateMachineTransition.advance_expression');
    transition['advanceExpression'] = advanceExpression;
  });
  property(transition, 'switch_mode', () =>
    transition['switchMode'] === 'sync' ? 1 : transition['switchMode'] === 'atEnd' ? 2 : 0,
  (value) => { transition['switchMode'] = (['immediate', 'sync', 'atEnd'] as const)[enumValue(value, 'switch_mode', 2)]; });
  property(transition, 'advance_mode', () =>
    transition['advanceMode'] === 'enabled' ? 1 : transition['advanceMode'] === 'auto' ? 2 : 0,
  (value) => { transition['advanceMode'] = (['disabled', 'enabled', 'auto'] as const)[enumValue(value, 'advance_mode', 2)]; });
  property(transition, 'advance_condition', () => transition['advanceCondition'] ?? '', (value) => {
    transition['advanceCondition'] = stringName(value, 'AnimationNodeStateMachineTransition.advance_condition');
  });
  property(transition, 'priority', () => priority, (value) => {
    priority = integer(value, 'AnimationNodeStateMachineTransition.priority');
  });
  property(transition, 'reset', () => reset, (value) => {
    reset = bool(value, 'AnimationNodeStateMachineTransition.reset');
  });
  method(transition, 'set_xfade_time', (value) => {
    const next = finite(value, 'AnimationNodeStateMachineTransition.xfade_time');
    if (next < 0) throw new RangeError('godot-compat: AnimationNodeStateMachineTransition.xfade_time must be non-negative');
    transition['xfadeTime'] = next;
  });
  method(transition, 'get_xfade_time', () => transition['xfadeTime']);
  method(transition, 'set_xfade_curve', (value) => {
    xfadeCurve = curveOrNull(value, 'AnimationNodeStateMachineTransition.xfade_curve');
    transition['xfadeCurve'] = xfadeCurve;
  });
  method(transition, 'get_xfade_curve', () => xfadeCurve);
  method(transition, 'set_break_loop_at_end', (value) => {
    breakLoopAtEnd = bool(value, 'AnimationNodeStateMachineTransition.break_loop_at_end');
    transition['breakLoopAtEnd'] = breakLoopAtEnd;
  });
  method(transition, 'is_loop_broken_at_end', () => breakLoopAtEnd);
  method(transition, 'set_advance_expression', (value) => {
    advanceExpression = stringName(value, 'AnimationNodeStateMachineTransition.advance_expression');
    transition['advanceExpression'] = advanceExpression;
  });
  method(transition, 'get_advance_expression', () => advanceExpression);
  method(transition, 'set_switch_mode', (value) => {
    transition['switchMode'] = (['immediate', 'sync', 'atEnd'] as const)[enumValue(value, 'switch_mode', 2)];
  });
  method(transition, 'get_switch_mode', () =>
    transition['switchMode'] === 'sync' ? 1 : transition['switchMode'] === 'atEnd' ? 2 : 0);
  method(transition, 'set_advance_mode', (value) => {
    transition['advanceMode'] = (['disabled', 'enabled', 'auto'] as const)[enumValue(value, 'advance_mode', 2)];
  });
  method(transition, 'get_advance_mode', () =>
    transition['advanceMode'] === 'enabled' ? 1 : transition['advanceMode'] === 'auto' ? 2 : 0);
  method(transition, 'set_advance_condition', (value) => {
    transition['advanceCondition'] = stringName(value, 'AnimationNodeStateMachineTransition.advance_condition');
  });
  method(transition, 'get_advance_condition', () => transition['advanceCondition'] ?? '');
  method(transition, 'set_priority', (value) => {
    priority = integer(value, 'AnimationNodeStateMachineTransition.priority');
  });
  method(transition, 'get_priority', () => priority);
  method(transition, 'set_reset', (value) => {
    reset = bool(value, 'AnimationNodeStateMachineTransition.reset');
  });
  method(transition, 'is_reset', () => reset);
  bindGodotResourceProtocol(transition, {
    createDuplicate(source) {
      const duplicate: MutableRecord = {
        ...(typeof source['from'] === 'string' ? { from: source['from'] } : {}),
        ...(typeof source['to'] === 'string' ? { to: source['to'] } : {}),
        xfadeTime: source['xfadeTime'],
        switchMode: source['switchMode'],
        advanceMode: source['advanceMode'],
        advanceCondition: source['advanceCondition'],
        advanceExpression: Reflect.get(source, 'advance_expression'),
        priority: Reflect.get(source, 'priority'),
        reset: Reflect.get(source, 'reset'),
        breakLoopAtEnd: Reflect.get(source, 'break_loop_at_end'),
        xfadeCurve: Reflect.get(source, 'xfade_curve'),
      };
      bindAnimationStateMachineTransition(duplicate);
      return duplicate;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      const curve = Reflect.get(source, 'xfade_curve');
      if (typeof curve === 'object' && curve !== null) {
        Reflect.set(target, 'xfade_curve', duplicateGodotSubresource(curve, memo));
      }
    },
  });
}

export function bindAnimationStateMachineNode(
  node: MutableRecord,
  bindTransition: (transition: MutableRecord) => void,
): void {
  registerGodotObjectIdentity(node, 'AnimationNodeStateMachine');
  const machine = node['machine'] as MutableRecord;
  const states = (): MutableRecord => machine['states'] as MutableRecord;
  const transitions = (): MutableRecord[] => machine['transitions'] as MutableRecord[];
  const requireStateName = (value: unknown, memberName: string): string => {
    const name = stringName(value, `AnimationNodeStateMachine.${memberName}`);
    if (states()[name] === undefined) {
      throw new Error(`godot-compat: AnimationNodeStateMachine has no node ${JSON.stringify(name)}`);
    }
    return name;
  };
  method(node, 'has_node', (name) => typeof name === 'string' && states()[name] !== undefined);
  method(node, 'get_node', (name) => {
    if (typeof name !== 'string') throw new TypeError('godot-compat: AnimationNodeStateMachine.get_node name must be StringName');
    return states()[name] ?? null;
  });
  method(node, 'get_node_name', (resource) => {
    for (const [name, child] of Object.entries(states())) if (child === resource) return name;
    return '';
  });
  method(node, 'add_node', (name, resource, positionValue = vec2()) => {
    const stateName = stringName(name, 'AnimationNodeStateMachine.add_node name');
    if (states()[stateName] !== undefined) throw new Error(`godot-compat: duplicate AnimationNodeStateMachine node ${JSON.stringify(stateName)}`);
    if (typeof resource !== 'object' || resource === null) throw new TypeError('godot-compat: AnimationNodeStateMachine node must be AnimationRootNode-like');
    machine['states'] = { ...states(), [stateName]: resource };
    const position = vector2(positionValue, 'AnimationNodeStateMachine node position');
    machine['positions'] = { ...(machine['positions'] as MutableRecord | undefined), [stateName]: position };
  });
  method(node, 'remove_node', (name) => {
    const stateName = requireStateName(name, 'remove_node');
    const nextStates = { ...states() };
    delete nextStates[stateName];
    machine['states'] = nextStates;
    machine['transitions'] = transitions().filter((transition) =>
      transition['from'] !== stateName && transition['to'] !== stateName);
    const positions = { ...(machine['positions'] as MutableRecord | undefined) };
    delete positions[stateName];
    machine['positions'] = positions;
  });
  method(node, 'rename_node', (name, newName) => {
    const oldName = requireStateName(name, 'rename_node');
    const replacement = stringName(newName, 'AnimationNodeStateMachine.rename_node new_name');
    if (states()[replacement] !== undefined) throw new Error(`godot-compat: duplicate AnimationNodeStateMachine node ${JSON.stringify(replacement)}`);
    const nextStates = { ...states() };
    nextStates[replacement] = nextStates[oldName];
    delete nextStates[oldName];
    machine['states'] = nextStates;
    for (const transition of transitions()) {
      if (transition['from'] === oldName) transition['from'] = replacement;
      if (transition['to'] === oldName) transition['to'] = replacement;
    }
    const positions = { ...(machine['positions'] as MutableRecord | undefined) };
    positions[replacement] = positions[oldName];
    delete positions[oldName];
    machine['positions'] = positions;
  });
  method(node, 'set_node_position', (name, value) => {
    const stateName = requireStateName(name, 'set_node_position');
    machine['positions'] = {
      ...(machine['positions'] as MutableRecord | undefined),
      [stateName]: vector2(value, 'AnimationNodeStateMachine node position'),
    };
  });
  method(node, 'get_node_position', (name) => {
    const stateName = requireStateName(name, 'get_node_position');
    const value = (machine['positions'] as MutableRecord | undefined)?.[stateName];
    return value === undefined ? vec2() : vector2(value, 'AnimationNodeStateMachine node position');
  });
  method(node, 'get_transition_count', () => transitions().length);
  method(node, 'get_transition_from', (at) => {
    const transition = transitions()[integer(at, 'AnimationNodeStateMachine.get_transition_from')];
    if (transition === undefined) throw new RangeError('godot-compat: AnimationNodeStateMachine transition is out of range');
    return transition['from'];
  });
  method(node, 'get_transition_to', (at) => {
    const transition = transitions()[integer(at, 'AnimationNodeStateMachine.get_transition_to')];
    if (transition === undefined) throw new RangeError('godot-compat: AnimationNodeStateMachine transition is out of range');
    return transition['to'];
  });
  method(node, 'get_transition', (at) => {
    const transition = transitions()[integer(at, 'AnimationNodeStateMachine.get_transition')];
    if (transition === undefined) throw new RangeError('godot-compat: AnimationNodeStateMachine transition is out of range');
    return transition;
  });
  method(node, 'has_transition', (from, to) =>
    transitions().some((transition) => transition['from'] === from && transition['to'] === to));
  method(node, 'add_transition', (from, to, transition) => {
    const fromName = requireStateName(from, 'add_transition from');
    const toName = requireStateName(to, 'add_transition to');
    if (typeof transition !== 'object' || transition === null) {
      throw new TypeError('godot-compat: AnimationNodeStateMachine transition must be a transition resource');
    }
    const value = transition as MutableRecord;
    value['from'] = fromName;
    value['to'] = toName;
    bindTransition(value);
    machine['transitions'] = [...transitions(), value];
  });
  method(node, 'remove_transition', (from, to) => {
    machine['transitions'] = transitions().filter((transition) =>
      transition['from'] !== from || transition['to'] !== to);
  });
  method(node, 'remove_transition_by_index', (at) => {
    const values = [...transitions()];
    const index = integer(at, 'AnimationNodeStateMachine.remove_transition_by_index');
    if (index < 0 || index >= values.length) throw new RangeError('godot-compat: AnimationNodeStateMachine transition is out of range');
    values.splice(index, 1);
    machine['transitions'] = values;
  });
}
