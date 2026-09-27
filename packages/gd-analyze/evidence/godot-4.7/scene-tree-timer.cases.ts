import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, type Segment, TREE_PROBE_HELPERS, treeCase } from './tree-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = treeCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'SceneTreeTimer', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });

add('get_time_left', 'get_time_left', [now({ timer: 't', delay: 0.05 }, { readTimer: 't' }), proc({ readTimer: 't' }), proc({ readTimer: 't' }), proc({ readTimer: 't' }), proc({ readTimer: 't' })]);
add('set_time_left', 'set_time_left', [now({ timer: 't', delay: 10 }, { setTimer: 't', value: 0.02 }, { readTimer: 't' }), proc({ readTimer: 't' }), proc(), proc({ setTimer: 't', value: -3 }, { readTimer: 't' })]);

const TIMER_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'SceneTreeTimer',
  compatModule: 'lib/godot-compat/scene-tree-timer',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default TIMER_EVIDENCE;
