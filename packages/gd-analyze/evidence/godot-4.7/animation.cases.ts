import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation';
import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/quaternion';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceComparator } from '../../src/evidence/case';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

type Triple = readonly [number, number, number];
type Quad = readonly [number, number, number, number];
/** A key as both sides build it: time, value and transition. */
type Key = readonly [number, number | boolean | Triple | Quad, number];

const gv = (value: Key[1]): string =>
  typeof value === 'number' ? gd(value) : typeof value === 'boolean' ? String(value) : value.length === 3 ? `Vector3(${value.map(gd).join(', ')})` : `Quaternion(${value.map(gd).join(', ')})`;
const tv = (value: Key[1]): unknown =>
  typeof value === 'number' || typeof value === 'boolean' ? value : value.length === 3 ? V.construct(...value) : Q.construct(...value);

interface Build {
  readonly type: number;
  readonly keys: readonly Key[];
  readonly length?: number;
  readonly loop?: number;
  readonly interp?: number;
  readonly update?: number;
  readonly wrap?: boolean;
}

function gdBuild(b: Build): string[] {
  return [
    'var a := Animation.new()',
    `a.length = ${gd(b.length ?? 2)}`,
    `a.loop_mode = ${String(b.loop ?? 0)}`,
    `var t := a.add_track(${String(b.type)})`,
    'a.track_set_path(t, "Node:prop")',
    ...(b.interp === undefined ? [] : [`a.track_set_interpolation_type(t, ${String(b.interp)})`]),
    ...(b.update === undefined ? [] : [`a.value_track_set_update_mode(t, ${String(b.update)})`]),
    ...(b.wrap === undefined ? [] : [`a.track_set_interpolation_loop_wrap(t, ${String(b.wrap)})`]),
    ...b.keys.map(([time, value, transition]) => `a.track_insert_key(t, ${gd(time)}, ${gv(value)}, ${gd(transition)})`),
  ];
}

function tsBuild(b: Build): A.Animation {
  const a = A.construct();
  A.set_length(a, b.length ?? 2);
  A.set_loop_mode(a, b.loop ?? 0);
  const t = A.add_track(a, b.type);
  A.track_set_path(a, t, 'Node:prop');
  if (b.interp !== undefined) A.track_set_interpolation_type(a, t, b.interp);
  if (b.update !== undefined) A.value_track_set_update_mode(a, t, b.update);
  if (b.wrap !== undefined) A.track_set_interpolation_loop_wrap(a, t, b.wrap);
  for (const [time, value, transition] of b.keys) A.track_insert_key(a, t, time, tv(value), transition);
  return a;
}

const c = resourceCases('Animation');
const TIMES = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.3, 1.5, 1.99, 2, 2.4, -0.2] as const;

function sample(id: string, member: string, gdCall: string, build: Build, call: (a: A.Animation, time: number) => unknown, comparator: GodotEvidenceComparator = 'exact'): void {
  c.add(id, member, [...gdBuild(build), `return [${TIMES.map((time) => gdCall.replace('$T', gd(time))).join(', ')}]`], () => {
    const a = tsBuild(build);
    return TIMES.map((time) => call(a, time));
  });
  const last = c.cases[c.cases.length - 1];
  if (last !== undefined && comparator !== 'exact') (last as { comparator: GodotEvidenceComparator }).comparator = comparator;
}

const FLOATS: readonly Key[] = [[0, 0, 1], [0.5, 2.5, 1], [1.5, -1, 1]];
const EASED: readonly Key[] = [[0, 0, -2], [0.5, 2.5, 0.5], [1.5, -1, 3.5], [1.9, 7, 0]];
const VECTORS: readonly Key[] = [[0, [1.5708, 6.28319, 0], 1], [2, [1.5708, 0, 0], 1]];
const BOOLS: readonly Key[] = [[0, false, 1], [0.4, true, 1], [1.2, false, 1]];
for (const [name, keys] of [['floats', FLOATS], ['eased', EASED]] as const) {
  for (const loop of [0, 1]) {
    sample(`value_track_interpolate-${name}-loop${String(loop)}`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys, loop }, (a, time) => A.value_track_interpolate(a, 0, time));
    sample(`value_track_interpolate-${name}-loop${String(loop)}-backward`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T, true)', { type: 0, keys, loop }, (a, time) => A.value_track_interpolate(a, 0, time, true));
  }
  sample(`value_track_interpolate-${name}-discrete`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys, update: 1 }, (a, time) => A.value_track_interpolate(a, 0, time));
  sample(`value_track_interpolate-${name}-nearest`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys, interp: 0 }, (a, time) => A.value_track_interpolate(a, 0, time));
  sample(`value_track_interpolate-${name}-nowrap`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys, loop: 1, wrap: false }, (a, time) => A.value_track_interpolate(a, 0, time));
}
for (const loop of [0, 1]) {
  sample(`value_track_interpolate-vectors-loop${String(loop)}`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys: VECTORS, loop }, (a, time) => A.value_track_interpolate(a, 0, time));
  sample(`value_track_interpolate-bools-loop${String(loop)}`, 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys: BOOLS, loop }, (a, time) => A.value_track_interpolate(a, 0, time));
}
sample('value_track_interpolate-one-key', 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys: [[0.3, 4.5, 1]] }, (a, time) => A.value_track_interpolate(a, 0, time));
sample('value_track_interpolate-past-end', 'value_track_interpolate', 'a.value_track_interpolate(t, $T)', { type: 0, keys: [[2.5, 4.5, 1]] }, (a, time) => A.value_track_interpolate(a, 0, time));

const POSITIONS: readonly Key[] = [[0, [0, 0.643772, 0], 1], [0.4, [0.1, 0.7, -0.2], 1], [1.1, [-0.3, 0.5, 0.25], -2]];
const ROTATIONS: readonly Key[] = [[0, [0, 0, 0, 1], 1], [0.6, [0.0998334, 0, 0, 0.9950042], 1], [1.4, [0.5, 0.5, 0.5, 0.5], 1]];
for (const loop of [0, 1]) {
  sample(`position_track_interpolate-loop${String(loop)}`, 'position_track_interpolate', 'a.position_track_interpolate(t, $T)', { type: 1, keys: POSITIONS, loop }, (a, time) => A.position_track_interpolate(a, 0, time));
  sample(`scale_track_interpolate-loop${String(loop)}`, 'scale_track_interpolate', 'a.scale_track_interpolate(t, $T)', { type: 3, keys: POSITIONS, loop }, (a, time) => A.scale_track_interpolate(a, 0, time));
  sample(`rotation_track_interpolate-loop${String(loop)}`, 'rotation_track_interpolate', 'a.rotation_track_interpolate(t, $T)', { type: 2, keys: ROTATIONS, loop }, (a, time) => A.rotation_track_interpolate(a, 0, time), 'float32-ulp');
}

// Keys: insertion order, replacement at an equal time (a 3D key keeps the old transition),
// reads, and search.
const INSERTS: readonly Key[] = [[1, 5, 0.5], [0.25, 2, 1], [1, 6, 2], [1.0000001, 7, 3], [0.5, 3, -1]];
const readsGd = ['var n := a.track_get_key_count(t)', 'var out := [n]', 'for i in n:', '\tout.append([a.track_get_key_time(t, i), a.track_get_key_value(t, i), a.track_get_key_transition(t, i)])'];
c.add('track_insert_key-value', 'track_insert_key', [...gdBuild({ type: 0, keys: INSERTS }), ...readsGd, 'return out'], () => {
  const a = tsBuild({ type: 0, keys: INSERTS });
  const n = A.track_get_key_count(a, 0);
  return [n, ...Array.from({ length: n }, (_, i) => [A.track_get_key_time(a, 0, i), A.track_get_key_value(a, 0, i), A.track_get_key_transition(a, 0, i)])];
});
const VINSERTS: readonly Key[] = [[1, [1, 2, 3], 0.5], [1, [4, 5, 6], 2], [0.2, [7, 8, 9], 3]];
c.add('track_insert_key-position', 'track_insert_key', [...gdBuild({ type: 1, keys: VINSERTS }), ...readsGd, 'return out'], () => {
  const a = tsBuild({ type: 1, keys: VINSERTS });
  const n = A.track_get_key_count(a, 0);
  return [n, ...Array.from({ length: n }, (_, i) => [A.track_get_key_time(a, 0, i), A.track_get_key_value(a, 0, i), A.track_get_key_transition(a, 0, i)])];
});
for (const [mode, time, limit, backward] of [[0, 0.3, false, false], [0, 0.3, false, true], [1, 0.5000001, false, false], [2, 0.5000001, false, false], [2, 0.5, false, false], [0, 2.5, true, false], [0, -1, false, false], [0, 9, false, true]] as const) {
  c.add(`track_find_key-${String(mode)}-${gd(time)}-${String(limit)}-${String(backward)}`, 'track_find_key', [...gdBuild({ type: 0, keys: FLOATS }), `return a.track_find_key(t, ${gd(time)}, ${String(mode)}, ${String(limit)}, ${String(backward)})`], () =>
    A.track_find_key(tsBuild({ type: 0, keys: FLOATS }), 0, time, mode, limit, backward),
  );
}
c.add('method-keys', 'method_track_get_name', ['var a := Animation.new()', 'var t := a.add_track(Animation.TYPE_METHOD)', 'a.track_insert_key(t, 0.5, {"method": &"queue_free", "args": []})', 'a.track_insert_key(t, 0.2, {"method": &"_die", "args": [1.5, true]})', 'return [a.track_get_key_count(t), a.method_track_get_name(t, 0), a.method_track_get_params(t, 0), a.method_track_get_name(t, 1), a.method_track_get_params(t, 1)]'], () => {
  const a = A.construct();
  const t = A.add_track(a, 5);
  A.track_insert_key(a, t, 0.5, new Map<unknown, unknown>([['method', 'queue_free'], ['args', []]]));
  A.track_insert_key(a, t, 0.2, new Map<unknown, unknown>([['method', '_die'], ['args', [1.5, true]]]));
  return [A.track_get_key_count(a, t), A.method_track_get_name(a, t, 0), A.method_track_get_params(a, t, 0), A.method_track_get_name(a, t, 1), A.method_track_get_params(a, t, 1)];
});
c.add('method_track_get_params', 'method_track_get_params', ['var a := Animation.new()', 'var t := a.add_track(Animation.TYPE_METHOD)', 'a.track_insert_key(t, 0.5, {"method": &"f", "args": [3.5]})', 'return a.method_track_get_params(t, 0)'], () => {
  const a = A.construct();
  A.track_insert_key(a, A.add_track(a, 5), 0.5, new Map<unknown, unknown>([['method', 'f'], ['args', [3.5]]]));
  return A.method_track_get_params(a, 0, 0);
});
c.add('tracks', 'add_track', ['var a := Animation.new()', 'var p := a.add_track(Animation.TYPE_VALUE)', 'var q := a.add_track(Animation.TYPE_POSITION_3D, 0)', 'a.track_set_path(q, "Skeleton/Skeleton3D:body")', 'a.track_set_path(p, "Circle:rotation")', 'return [p, q, a.get_track_count(), a.track_get_type(0), a.track_get_type(1), str(a.track_get_path(0)), str(a.track_get_path(1)), a.find_track("Circle:rotation", Animation.TYPE_VALUE), a.find_track("Circle:rotation", Animation.TYPE_METHOD)]'], () => {
  const a = A.construct();
  const p = A.add_track(a, 0);
  const q = A.add_track(a, 1, 0);
  A.track_set_path(a, q, 'Skeleton/Skeleton3D:body');
  A.track_set_path(a, p, 'Circle:rotation');
  return [p, q, A.get_track_count(a), A.track_get_type(a, 0), A.track_get_type(a, 1), A.track_get_path(a, 0), A.track_get_path(a, 1), A.find_track(a, 'Circle:rotation', 0), A.find_track(a, 'Circle:rotation', 5)];
});
for (const member of ['track_get_type', 'track_get_path', 'find_track', 'get_track_count', 'track_set_path']) {
  const source = c.cases.find((entry) => entry.id === 'tracks');
  if (source !== undefined) c.cases.push({ ...source, id: `tracks-${member}`, symbol: { kind: 'native-member', owner: 'Animation', member } });
}
c.add('track-flags', 'track_set_enabled', ['var a := Animation.new()', 'var t := a.add_track(Animation.TYPE_VALUE)', 'var before := [a.track_is_enabled(t), a.track_is_imported(t), a.track_get_interpolation_type(t), a.track_get_interpolation_loop_wrap(t), a.value_track_get_update_mode(t)]', 'a.track_set_enabled(t, false)', 'a.track_set_imported(t, true)', 'a.track_set_interpolation_type(t, 0)', 'a.track_set_interpolation_loop_wrap(t, false)', 'a.value_track_set_update_mode(t, 1)', 'return [before, a.track_is_enabled(t), a.track_is_imported(t), a.track_get_interpolation_type(t), a.track_get_interpolation_loop_wrap(t), a.value_track_get_update_mode(t)]'], () => {
  const a = A.construct();
  const t = A.add_track(a, 0);
  const before = [A.track_is_enabled(a, t), A.track_is_imported(a, t), A.track_get_interpolation_type(a, t), A.track_get_interpolation_loop_wrap(a, t), A.value_track_get_update_mode(a, t)];
  A.track_set_enabled(a, t, false);
  A.track_set_imported(a, t, true);
  A.track_set_interpolation_type(a, t, 0);
  A.track_set_interpolation_loop_wrap(a, t, false);
  A.value_track_set_update_mode(a, t, 1);
  return [before, A.track_is_enabled(a, t), A.track_is_imported(a, t), A.track_get_interpolation_type(a, t), A.track_get_interpolation_loop_wrap(a, t), A.value_track_get_update_mode(a, t)];
});
for (const member of ['track_is_enabled', 'track_set_imported', 'track_is_imported', 'track_set_interpolation_type', 'track_get_interpolation_type', 'track_set_interpolation_loop_wrap', 'track_get_interpolation_loop_wrap', 'value_track_set_update_mode', 'value_track_get_update_mode']) {
  const source = c.cases.find((entry) => entry.id === 'track-flags');
  if (source !== undefined) c.cases.push({ ...source, id: `track-flags-${member}`, symbol: { kind: 'native-member', owner: 'Animation', member } });
}
c.add('length-loop-step', 'set_length', ['var a := Animation.new()', 'var before := [a.length, a.loop_mode, a.step]', 'a.length = 0.0001', 'var clamped := a.length', 'a.length = 2.5', 'a.loop_mode = Animation.LOOP_LINEAR', 'a.step = 0.1', 'return [before, clamped, a.get_length(), a.get_loop_mode(), a.get_step()]'], () => {
  const a = A.construct();
  const before = [A.get_length(a), A.get_loop_mode(a), A.get_step(a)];
  A.set_length(a, 0.0001);
  const clamped = A.get_length(a);
  A.set_length(a, 2.5);
  A.set_loop_mode(a, 1);
  A.set_step(a, 0.1);
  return [before, clamped, A.get_length(a), A.get_loop_mode(a), A.get_step(a)];
});
for (const member of ['get_length', 'set_loop_mode', 'get_loop_mode', 'set_step', 'get_step', 'track_get_key_count', 'track_get_key_time', 'track_get_key_transition', 'track_get_key_value']) {
  const source = c.cases.find((entry) => entry.id === (member.startsWith('track') ? 'track_insert_key-value' : 'length-loop-step'));
  if (source !== undefined) c.cases.push({ ...source, id: `${source.id}-${member}`, symbol: { kind: 'native-member', owner: 'Animation', member } });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Animation', compatModule: 'lib/godot-compat/animation', cases: c.cases };
export default EVIDENCE;
