import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, type Segment, TREE_PROBE_HELPERS, treeCase } from './tree-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = treeCase(segments);
  cases.push({ id, symbol: { kind: 'singleton-member', owner: 'Engine', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });

const TIMELINE: Segment[] = [now({ read: ['frames'] }, { read: ['in_physics'] }), phys({ read: ['frames'] }, { read: ['in_physics'] }), proc({ read: ['frames'] }, { read: ['in_physics'] }), proc({ read: ['frames'] }), phys({ read: ['frames'] })];
add('get_process_frames', 'get_process_frames', TIMELINE);
add('get_physics_frames', 'get_physics_frames', TIMELINE);
add('is_in_physics_frame', 'is_in_physics_frame', TIMELINE);

const ENGINE_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Engine',
  compatModule: 'lib/godot-compat/engine',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default ENGINE_EVIDENCE;
