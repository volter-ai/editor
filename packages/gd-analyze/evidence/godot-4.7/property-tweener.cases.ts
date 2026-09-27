import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { frames, type Op, type Segment, tweenCase } from './tween-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = tweenCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'PropertyTweener', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const pos: Op = { value: 'a', property: 'position' };
const base: Op[] = [{ node: 'a', kind: 'Node2D' }, { tween: 't', on: 'a' }, { watch: 't', signal: 'step_finished' }, { watch: 't', signal: 'finished' }];
const tweenTo = (to: readonly [number, number], duration = 0.1): Op => ({ prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: to }, duration });

// Its own transition and ease over the tween's defaults.
for (const [trans, ease] of [[10, 1], [6, 1], [9, 0], [11, 3], [5, 2]] as const) {
  add(`set_trans-${String(trans)}-${String(ease)}`, 'set_trans', [
    now(...base, { tweenCall: 't', call: 'set_trans', args: [1] }, tweenTo([64, -12], 0.2), { tweenerCall: 'p', call: 'set_trans', args: [trans] }, { tweenerCall: 'p', call: 'set_ease', args: [ease] }),
    ...frames(14, pos),
  ]);
}
for (const ease of [0, 1, 2, 3]) {
  add(`set_ease-${String(ease)}`, 'set_ease', [
    now(...base, { tweenCall: 't', call: 'set_trans', args: [4] }, tweenTo([10, 20], 0.15), { tweenerCall: 'p', call: 'set_ease', args: [ease] }),
    ...frames(11, pos),
  ]);
}
// A delay: the start value is read when the delay ends (a write during it moves the start).
add('set_delay-reads-after-delay', 'set_delay', [
  now(...base, tweenTo([30, 0]), { tweenerCall: 'p', call: 'set_delay', args: [0.05] }),
  ...frames(2, pos),
  { await: 'process', ops: [{ set: 'a', property: 'position', to: { v2: [-10, 4] } }, pos] },
  ...frames(10, pos),
]);
add('set_delay-parallel', 'set_delay', [
  now(...base, { tweenCall: 't', call: 'set_parallel' }, tweenTo([30, 0], 0.05), { prop: 'q', tween: 't', target: 'a', property: 'rotation', to: 1, duration: 0.05 }, { tweenerCall: 'q', call: 'set_delay', args: [0.04] }),
  ...frames(9, pos, { value: 'a', property: 'rotation' }),
]);
add('from', 'from', [
  now(...base, { set: 'a', property: 'position', to: { v2: [5, 5] } }, tweenTo([30, 0]), { tweenerCall: 'p', call: 'from', args: [{ v2: [-20, 10] }] }, pos),
  ...frames(8, pos),
]);
// `from_current`: the value when the tweener was made, not when its step starts.
add('from_current', 'from_current', [
  now(...base, { set: 'a', property: 'position', to: { v2: [5, 5] } }, tweenTo([30, 0]), { tweenerCall: 'p', call: 'from_current' }, { set: 'a', property: 'position', to: { v2: [100, 100] } }),
  ...frames(8, pos),
]);
add('as_relative', 'as_relative', [
  now(...base, { set: 'a', property: 'position', to: { v2: [5, -5] } }, tweenTo([30, 2]), { tweenerCall: 'p', call: 'as_relative' }, { prop: 'q', tween: 't', target: 'a', property: 'position', to: { v2: [-1, -1] }, duration: 0.05 }, { tweenerCall: 'q', call: 'as_relative' }),
  ...frames(12, pos),
]);
// A relative tween looped: each lap starts where the last ended.
add('as_relative-looped', 'as_relative', [
  now(...base, { tweenCall: 't', call: 'set_loops', args: [3] }, tweenTo([4, 0], 0.05), { tweenerCall: 'p', call: 'as_relative' }),
  ...frames(12, pos),
]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'PropertyTweener', compatModule: 'lib/godot-compat/property-tweener', cases };
export default EVIDENCE;
