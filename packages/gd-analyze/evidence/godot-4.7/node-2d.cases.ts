import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { inputCase, type Op } from './input-tree';

const cases: GodotEvidenceCase[] = [];
const OPS: Op[] = [
  { node: 'parent', kind: 'Node2D' },
  { node: 'child', kind: 'Node2D', parent: 'parent' },
  ...['get_position', 'get_rotation', 'get_skew', 'get_scale'].map((read): Op => ({ read, on: 'child' })),
  { call: 'set_position', on: 'parent', args: [[10.5, -3]] },
  { call: 'set_rotation', on: 'parent', args: [0.7] },
  { call: 'set_scale', on: 'parent', args: [[2, 0.5]] },
  { call: 'set_skew', on: 'parent', args: [0.2] },
  { call: 'set_position', on: 'child', args: [[4, 5]] },
  { call: 'set_rotation', on: 'child', args: [-1.3] },
  { call: 'set_scale', on: 'child', args: [[0, 3]] },
  ...['get_position', 'get_rotation', 'get_skew', 'get_scale', 'get_transform', 'get_global_transform', 'get_global_position'].map((read): Op => ({ read, on: 'child' })),
  { call: 'set_global_position', on: 'child', args: [[30, 40]] },
  ...['get_position', 'get_global_position'].map((read): Op => ({ read, on: 'child' })),
  { call: 'set_global_position', on: 'parent', args: [[-7, 9.25]] },
  ...['get_position', 'get_global_transform'].map((read): Op => ({ read, on: 'parent' })),
];
for (const member of ['set_position', 'get_position', 'set_rotation', 'get_rotation', 'set_skew', 'get_skew', 'set_scale', 'get_scale', 'get_global_position', 'set_global_position']) {
  const built = inputCase(OPS);
  cases.push({ id: `${member}-tree`, symbol: { kind: 'native-member', owner: 'Node2D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Node2D', compatModule: 'lib/godot-compat/node-2d', cases };
export default EVIDENCE;
