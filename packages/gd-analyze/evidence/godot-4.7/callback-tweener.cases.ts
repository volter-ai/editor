import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { frames, type Op, type Segment, tweenCase } from './tween-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = tweenCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CallbackTweener', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });

// No delay sits exactly on a frame boundary: the native loop's process step is 1/60 plus the
// rounding `MainTimerSync` accumulates over the probe's run (2 ulps at a measured frame), which a
// boundary would compare rather than the tweener.
for (const delay of [0, 0.01, 0.02, 0.05, 0.1]) {
  add(`set_delay-${String(delay)}`, 'set_delay', [
    now({ node: 'a', kind: 'Node2D' }, { tween: 't', on: 'a' }, { watch: 't', signal: 'finished' }, { callback: 'c', tween: 't', log: 'called' }, { tweenerCall: 'c', call: 'set_delay', args: [delay] }, { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [6, 0] }, duration: 0.05 }),
    ...frames(10, { value: 'a', property: 'position' }),
  ]);
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'CallbackTweener', compatModule: 'lib/godot-compat/callback-tweener', cases };
export default EVIDENCE;
