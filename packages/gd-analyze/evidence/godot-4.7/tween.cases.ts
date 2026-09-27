import * as TW from '../../capabilities/catalog/project-source/src/lib/godot-compat/tween';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { signalCase } from './native-signal-case';
import { frames, type Op, type Segment, tweenCase } from './tween-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = tweenCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Tween', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });

const node2d = (tag = 'a'): Op => ({ node: tag, kind: 'Node2D' });
const node3d = (tag = 'a'): Op => ({ node: tag, kind: 'Node3D' });
const watchAll = (tween = 't'): Op[] => [
  { watch: tween, signal: 'step_finished' },
  { watch: tween, signal: 'loop_finished' },
  { watch: tween, signal: 'finished' },
];
const pos = (tag = 'a'): Op => ({ value: tag, property: 'position' });
const state = (tween = 't'): Op[] => [
  { read: 'is_running', of: tween },
  { read: 'is_valid', of: tween },
];

// --- tween_property: each value type, read frame by frame, with its signals.

add('tween_property-vector2-position', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [100, -50.5] }, duration: 0.25 }),
  ...frames(18, pos(), ...state()),
]);
add('tween_property-vector3-position', 'tween_property', [
  now(node3d(), { tween: 't' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v3: [1.2, -2.1, -2.75] }, duration: 0.1 }),
  ...frames(9, pos(), ...state()),
]);
add('tween_property-color-modulate', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'modulate', to: { color: [1.2, 1.2, 1.2, 0.5] }, duration: 0.1 }),
  ...frames(9, { value: 'a', property: 'modulate' }),
]);
add('tween_property-float-rotation', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'rotation', to: 2.5, duration: 0.3 }),
  ...frames(21, { value: 'a', property: 'rotation' }),
]);
add('tween_property-scale-to-zero', 'tween_property', [
  now(node2d(), { set: 'a', property: 'scale', to: { v2: [1.1, 0.9] } }, { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [0, 0] }, duration: 0.2 }),
  ...frames(15, { value: 'a', property: 'scale' }),
]);
add('tween_property-zero-duration', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [3, 4] }, duration: 0 }, pos()),
  ...frames(3, pos(), ...state()),
]);
// The initial value is read when the tweener's step starts: a write after the call, before the
// first pass, and a second step that starts where the first ended.
add('tween_property-initial-at-start', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [10, 0] }, duration: 0.1 }, { set: 'a', property: 'position', to: { v2: [-30, 7] } }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [20, 5] }, duration: 0.1 }),
  ...frames(14, pos()),
]);
// A write during the tween does not move its start: the next frame writes the eased value again.
add('tween_property-write-during', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [60, 0] }, duration: 0.2 }),
  ...frames(4, pos()),
  { await: 'process', ops: [{ set: 'a', property: 'position', to: { v2: [-100, -100] } }, pos()] },
  ...frames(12, pos()),
]);
add('tween_property-type-mismatch', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v3: [1, 2, 3] }, duration: 0.1, logNull: true }, { read: 'has_tweeners', of: 't' }),
  ...frames(2, ...state()),
]);
// A target freed mid-tween: its tweener finishes, the next step runs, the tween finishes.
add('tween_property-target-freed', 'tween_property', [
  now(node2d(), node2d('b'), { tween: 't' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [50, 50] }, duration: 0.2 }, { watchTweener: 'p' }, { prop: 'q', tween: 't', target: 'b', property: 'position', to: { v2: [-5, 5] }, duration: 0.05 }),
  ...frames(4, pos('b')),
  { await: 'process', ops: [{ free: 'a' }, { log: 'freed' }] },
  ...frames(6, pos('b'), ...state()),
]);
// Leftover time passes to the next step in the same frame.
add('tween_property-leftover', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [8, 0] }, duration: 0.025 }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [8, 16] }, duration: 0.04 }, { callback: 'c', tween: 't', log: 'callback' }),
  ...frames(6, pos()),
]);
add('tween_property-after-start', 'tween_property', [
  now(node2d(), { tween: 't', on: 'a' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [8, 0] }, duration: 0.1 }),
  { await: 'process', ops: [{ prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [9, 9] }, duration: 0.1, logNull: true }] },
  ...frames(7, pos()),
]);

// --- tween_callback.

add('tween_callback-alone', 'tween_callback', [now({ tween: 't' }, ...watchAll(), { callback: 'c', tween: 't', log: 'called' }, { log: 'made' }), ...frames(2, ...state())]);
add('tween_callback-after-property', 'tween_callback', [
  now(node3d(), { tween: 't' }, { tweenCall: 't', call: 'set_ease', args: [3] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v3: [1.2, -2.1, -2.75] }, duration: 0.1 }, { callback: 'c', tween: 't', log: 'change_weapon' }),
  ...frames(9, pos()),
]);
add('tween_callback-parallel', 'tween_callback', [
  now({ tween: 't' }, { tweenCall: 't', call: 'set_parallel', args: [true] }, ...watchAll(), { callback: 'c', tween: 't', log: 'first' }, { callback: 'd', tween: 't', log: 'second' }),
  ...frames(2),
]);
add('tween_callback-invalid', 'tween_callback', [now({ tween: 't' }, { tweenCall: 't', call: 'kill' }, { callback: 'c', tween: 't', log: 'never', logNull: true }), ...frames(2)]);

// --- Steps: parallel and chained.

const scaleOf = (tag = 'a'): Op => ({ value: tag, property: 'scale' });
add('set_parallel-true', 'set_parallel', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_parallel', args: [true] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [1.1, 1.1] }, duration: 0.1 }, { prop: 'q', tween: 't', target: 'a', property: 'modulate', to: { color: [1.2, 1.2, 1.2, 1] }, duration: 0.15 }),
  ...frames(11, scaleOf(), { value: 'a', property: 'modulate' }),
]);
add('set_parallel-false', 'set_parallel', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_parallel', args: [false] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [2, 2] }, duration: 0.05 }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [4, 4] }, duration: 0.05 }),
  ...frames(8, scaleOf(), pos()),
]);
add('parallel-one', 'parallel', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [2, 2] }, duration: 0.05 }, { tweenCall: 't', call: 'parallel' }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [4, 4] }, duration: 0.08 }, { prop: 'r', tween: 't', target: 'a', property: 'rotation', to: 1, duration: 0.05 }),
  ...frames(12, scaleOf(), pos(), { value: 'a', property: 'rotation' }),
]);
add('chain-after-parallel', 'chain', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_parallel', args: [true] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [2, 2] }, duration: 0.05 }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [4, 4] }, duration: 0.05 }, { tweenCall: 't', call: 'chain' }, { prop: 'r', tween: 't', target: 'a', property: 'rotation', to: 1, duration: 0.05 }, { prop: 's', tween: 't', target: 'a', property: 'modulate', to: { color: [0, 0, 0, 0] }, duration: 0.03 }),
  ...frames(10, scaleOf(), pos(), { value: 'a', property: 'rotation' }, { value: 'a', property: 'modulate' }),
]);

// --- Loops.

add('set_loops-three', 'set_loops', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_loops', args: [3] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [9, 0] }, duration: 0.05 }, { callback: 'c', tween: 't', log: 'lap' }),
  ...frames(13, pos(), { read: 'get_loops_left', of: 't' }),
]);
add('set_loops-infinite', 'set_loops', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_loops' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'rotation', to: 1, duration: 0.05 }),
  ...frames(12, { value: 'a', property: 'rotation' }, { read: 'get_loops_left', of: 't' }),
]);
// Looping forever over steps that take no time: Godot's editor build stops at the second empty lap.
add('set_loops-infinite-empty', 'set_loops', [
  now({ tween: 't' }, { tweenCall: 't', call: 'set_loops', args: [0] }, ...watchAll(), { callback: 'c', tween: 't', log: 'lap' }),
  ...frames(3, ...state()),
]);
add('get_loops_left', 'get_loops_left', [
  now({ tween: 't' }, { read: 'get_loops_left', of: 't' }, { tweenCall: 't', call: 'set_loops', args: [2] }, { read: 'get_loops_left', of: 't' }, { callback: 'c', tween: 't', log: 'c' }),
  ...frames(3, { read: 'get_loops_left', of: 't' }),
]);

// --- Speed, transition and ease defaults.

for (const speed of [2, 0.5, 0]) {
  add(`set_speed_scale-${String(speed)}`, 'set_speed_scale', [
    now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_speed_scale', args: [speed] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'rotation', to: 3, duration: 0.2 }),
    ...frames(14, { value: 'a', property: 'rotation' }, { read: 'get_total_elapsed_time', of: 't' }),
  ]);
}
const TRANS = ['LINEAR', 'SINE', 'QUINT', 'QUART', 'QUAD', 'EXPO', 'ELASTIC', 'CUBIC', 'CIRC', 'BOUNCE', 'BACK', 'SPRING'] as const;
const EASE = ['IN', 'OUT', 'IN_OUT', 'OUT_IN'] as const;
// Every transition and ease, a Vector2 and a float property eased over 0.2 s, frame by frame.
TRANS.forEach((trans, transIndex) => {
  EASE.forEach((ease, easeIndex) => {
    add(`set_trans-${trans}-${ease}`, 'set_trans', [
      now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_trans', args: [transIndex] }, { tweenCall: 't', call: 'set_ease', args: [easeIndex] }, { tweenCall: 't', call: 'set_parallel' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [100, -40.25] }, duration: 0.2 }, { prop: 'q', tween: 't', target: 'a', property: 'rotation', to: -1.75, duration: 0.2 }),
      ...frames(13, pos(), { value: 'a', property: 'rotation' }),
    ]);
  });
});
EASE.forEach((ease, easeIndex) => {
  add(`set_ease-${ease}`, 'set_ease', [
    now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_ease', args: [easeIndex] }, { tweenCall: 't', call: 'set_trans', args: [1] }, { prop: 'p', tween: 't', target: 'a', property: 'modulate', to: { color: [0.2, 0.4, 0.6, 0.8] }, duration: 0.15 }),
    ...frames(11, { value: 'a', property: 'modulate' }),
  ]);
});
// The default ease (IN_OUT) and transition (LINEAR) apply when the tween sets neither.
add('set_ease-default', 'set_ease', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_trans', args: [7] }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [10, 10] }, duration: 0.1 }),
  ...frames(8, pos()),
]);
// A default set after a tweener is appended does not reach it.
add('set_trans-after-append', 'set_trans', [
  now(node2d(), { tween: 't', on: 'a' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [10, 10] }, duration: 0.1 }, { tweenCall: 't', call: 'set_trans', args: [5] }, { tweenCall: 't', call: 'set_ease', args: [0] }),
  ...frames(8, pos()),
]);

// --- interpolate_value: each equation at times across and beyond its duration.

const TIMES = [0, 0.013, 0.07, 0.1, 0.25, 0.3333, 0.4, 0.5, 0.6, 0.63, 0.75, 0.9, 0.97, 0.999, 1, 1.2, -0.1];
TRANS.forEach((trans, transIndex) => {
  EASE.forEach((ease, easeIndex) => {
    const duration = 0.85;
    const gdscript = [
      'var out: Array = []',
      `for t in [${TIMES.map((time) => gd(time * duration)).join(', ')}]:`,
      `\tout.append(Tween.interpolate_value(0.0, 1.0, t, ${gd(duration)}, ${String(transIndex)}, ${String(easeIndex)}))`,
      `\tout.append(Tween.interpolate_value(Vector2(-3.5, 2.0), Vector2(10.0, -0.25), t, ${gd(duration)}, ${String(transIndex)}, ${String(easeIndex)}))`,
      `\tout.append(Tween.interpolate_value(Color(0.1, 0.2, 0.3, 1.0), Color(0.5, -0.2, 1.0, -0.5), t, ${gd(duration)}, ${String(transIndex)}, ${String(easeIndex)}))`,
      'return out',
    ].join('\n');
    cases.push({
      id: `interpolate_value-${trans}-${ease}`,
      symbol: { kind: 'native-static', owner: 'Tween', member: 'interpolate_value' },
      gdscript,
      target: () =>
        TIMES.flatMap((time) => {
          const at = time * duration;
          return [
            TW.interpolate_value(0.0, 1.0, at, duration, transIndex, easeIndex),
            TW.interpolate_value(V2.construct(-3.5, 2), V2.construct(10, -0.25), at, duration, transIndex, easeIndex),
            TW.interpolate_value(C.construct(0.1, 0.2, 0.3, 1), C.construct(0.5, -0.2, 1, -0.5), at, duration, transIndex, easeIndex),
          ];
        }),
      comparator: 'exact',
    });
  });
});
cases.push({
  id: 'interpolate_value-zero-duration',
  symbol: { kind: 'native-static', owner: 'Tween', member: 'interpolate_value' },
  gdscript: 'return [Tween.interpolate_value(2.0, 3.0, 0.0, 0.0, 6, 1), Tween.interpolate_value(Vector2(1.0, 1.0), Vector2(0.5, -1.0), 0.5, 0.0, 10, 2)]',
  target: () => [TW.interpolate_value(2, 3, 0, 0, 6, 1), TW.interpolate_value(V2.construct(1, 1), V2.construct(0.5, -1), 0.5, 0, 10, 2)],
  comparator: 'exact',
});

// --- Control: kill, stop, pause, play.

add('kill-mid-tween', 'kill', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [30, 0] }, duration: 0.2 }),
  ...frames(4, pos()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'kill' }, ...state(), pos()] },
  ...frames(4, pos(), ...state()),
]);
add('stop-then-play', 'stop', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [30, 0] }, duration: 0.1 }),
  ...frames(3, pos()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'stop' }, ...state(), { read: 'get_total_elapsed_time', of: 't' }] },
  ...frames(2, pos()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'play' }, ...state()] },
  ...frames(9, pos(), ...state()),
]);
add('stop-after-finish', 'stop', [
  now({ tween: 't' }, ...watchAll(), { callback: 'c', tween: 't', log: 'c' }),
  ...frames(1, ...state()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'stop' }, { tweenCall: 't', call: 'play' }, ...state()] },
  ...frames(2, ...state()),
]);
add('pause-then-play', 'pause', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [30, 0] }, duration: 0.1 }),
  ...frames(3, pos()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'pause' }, ...state()] },
  ...frames(3, pos()),
  { await: 'process', ops: [{ tweenCall: 't', call: 'play' }, ...state()] },
  ...frames(6, pos(), ...state()),
]);
add('play-finished', 'play', [
  now({ tween: 't' }, ...watchAll(), { callback: 'c', tween: 't', log: 'c' }),
  ...frames(1),
  { await: 'process', ops: [{ tweenCall: 't', call: 'play' }, ...state()] },
  ...frames(2, ...state()),
]);
add('is_running-lifecycle', 'is_running', [
  now({ tween: 't' }, ...state(), { callback: 'c', tween: 't', log: 'c' }, ...state()),
  ...frames(2, ...state()),
]);
add('is_valid-empty', 'is_valid', [now({ tween: 't' }, ...state(), { read: 'has_tweeners', of: 't' }), ...frames(2, ...state())]);
add('has_tweeners', 'has_tweeners', [
  now(node2d(), { tween: 't' }, { read: 'has_tweeners', of: 't' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [1, 1] }, duration: 0.02 }, { read: 'has_tweeners', of: 't' }),
  ...frames(3, { read: 'has_tweeners', of: 't' }),
]);
add('get_total_elapsed_time', 'get_total_elapsed_time', [
  now(node2d(), { tween: 't' }, { read: 'get_total_elapsed_time', of: 't' }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [1, 1] }, duration: 0.07 }),
  ...frames(7, { read: 'get_total_elapsed_time', of: 't' }),
]);

// --- The bound node: outside the tree it holds the tween, freed it drops it.

add('bind_node-removed-and-readded', 'bind_node', [
  now(node2d(), node2d('b'), { tween: 't' }, { tweenCall: 't', call: 'bind_node', args: ['b'] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [30, 0] }, duration: 0.1 }),
  ...frames(2, pos()),
  { await: 'process', ops: [{ remove: 'b' }, { log: 'removed' }] },
  ...frames(3, pos(), ...state()),
  { await: 'process', ops: [{ add: 'b' }, { log: 'added' }] },
  ...frames(6, pos(), ...state()),
]);
add('bind_node-freed', 'bind_node', [
  now(node2d(), node2d('b'), { tween: 't' }, { tweenCall: 't', call: 'bind_node', args: ['b'] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [30, 0] }, duration: 0.1 }),
  ...frames(2, pos()),
  { await: 'process', ops: [{ free: 'b' }, { log: 'freed' }, ...state()] },
  ...frames(3, pos(), ...state()),
]);
// The match-3 kit: a node's own tween scaling it to zero, freed when the tween finishes.
add('bind_node-queue-free-on-finish', 'bind_node', [
  now(node2d(), { tween: 't', on: 'a' }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'scale', to: { v2: [0, 0] }, duration: 0.2 }),
  ...frames(13, scaleOf(), ...state()),
  { await: 'process', ops: [{ queueFree: 'a' }, ...state()] },
  ...frames(2, ...state()),
]);

// --- Process and pause modes.

add('set_process_mode-physics', 'set_process_mode', [
  now(node2d(), { tween: 't', on: 'a' }, { tweenCall: 't', call: 'set_process_mode', args: [0] }, ...watchAll(), { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [12, 0] }, duration: 0.05 }, { callback: 'c', tween: 't', log: 'called' }),
  ...Array.from({ length: 5 }, (): Segment[] => [phys({ log: 'physics' }, pos()), { await: 'process', ops: [{ log: 'process' }, pos()] }]).flat(),
]);
for (const [mode, name] of [[0, 'BOUND'], [1, 'STOP'], [2, 'PROCESS']] as const) {
  add(`set_pause_mode-${name}-disabled-node`, 'set_pause_mode', [
    now(node2d(), { node: 'b', kind: 'Node' }, { processMode: 'b', mode: 4 }, { tween: 't', on: 'b' }, { tweenCall: 't', call: 'set_pause_mode', args: [mode] }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [12, 0] }, duration: 0.05 }),
    ...frames(5, pos(), ...state()),
  ]);
}

// --- The kits' own tweens.

// starter-kit-match-3 tile.gd `move_to`: two parallel tweeners with their own transition and ease,
// the sprite's scale written just before the second.
add('tween_property-match3-move-to', 'tween_property', [
  now(
    node2d(),
    node2d('s'),
    { tween: 't', on: 'a' },
    { tweenCall: 't', call: 'set_parallel', args: [true] },
    ...watchAll(),
    { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [136, 264] }, duration: 0.3 },
    { tweenerCall: 'p', call: 'set_trans', args: [10] },
    { tweenerCall: 'p', call: 'set_ease', args: [1] },
    { set: 's', property: 'scale', to: { v2: [1.2, 0.8] } },
    { prop: 'q', tween: 't', target: 's', property: 'scale', to: { v2: [1, 1] }, duration: 0.3 },
    { tweenerCall: 'q', call: 'set_trans', args: [6] },
    { tweenerCall: 'q', call: 'set_ease', args: [1] },
  ),
  ...frames(20, pos(), scaleOf('s')),
]);

const TWEEN_EVIDENCE_SIGNALS = (['finished', 'step_finished', 'loop_finished'] as const).map((member) =>
  signalCase({
    owner: 'Tween',
    member,
    make: 'create_tween()',
    free: 'o.kill()',
    args: member === 'finished' ? '' : '1',
    signal: () => {
      const tween = ST.create_tween(ST.godot_tree());
      TW.kill(tween);
      return { signal: TW[member](tween) as never, args: member === 'finished' ? [] : [1] };
    },
  }),
);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Tween',
  compatModule: 'lib/godot-compat/tween',
  cases: [...cases, ...TWEEN_EVIDENCE_SIGNALS],
};
export default EVIDENCE;
