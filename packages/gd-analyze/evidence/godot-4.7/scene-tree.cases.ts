import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, type Segment, TREE_PROBE_HELPERS, treeCase } from './tree-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = treeCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'SceneTree', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });
const frames = (count: number): Segment[] => Array.from({ length: count }, () => proc());

for (const delay of [0, 0.001, 1 / 60, 0.05, 0.1]) {
  add(`create_timer-process-${String(delay)}`, 'create_timer', [now({ new: 'a' }, { add: 'a' }, { timer: 't', delay }), ...frames(8)]);
  add(`create_timer-physics-${String(delay)}`, 'create_timer', [now({ new: 'a' }, { add: 'a' }, { timer: 't', delay, physics: true }), ...frames(8)]);
}
add('create_timer-from-physics', 'create_timer', [now({ new: 'a' }, { add: 'a' }), phys({ timer: 'p', delay: 0.02, physics: true }, { timer: 'q', delay: 0.02 }), ...frames(4)]);
add('create_timer-negative', 'create_timer', [now({ timer: 'n', delay: -1 }, { log: 'created' }), proc()]);
add('get_root', 'get_root', [now({ new: 'a' }, { add: 'a' }, { read: ['viewport_is_root', 'a'] })]);
add('get_frame', 'get_frame', [now({ read: ['tree_frame'] }), phys({ read: ['tree_frame'] }), proc({ read: ['tree_frame'] }), phys({ read: ['tree_frame'] })]);
add('queue_delete', 'queue_delete', [now({ new: 'a' }, { add: 'a' }), proc({ queueDelete: 'a' }, { read: ['queued', 'a'] }, { log: 'queued' }), proc()]);
add('reload_current_scene-without-scene', 'reload_current_scene', [now({ read: ['reload'] })]);

const SCENE_TREE_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'SceneTree',
  compatModule: 'lib/godot-compat/scene-tree',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default SCENE_TREE_EVIDENCE;
