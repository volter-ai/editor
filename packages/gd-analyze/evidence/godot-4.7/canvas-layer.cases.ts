import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { int, type Pair, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CanvasLayer', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const LAYER: Segment[] = [
  {
    ops: [
      { node: 'layer', kind: 'CanvasLayer' },
      { node: 'c', kind: 'Control', parent: 'layer' },
      { read: 'get_layer', on: 'layer' },
      { read: 'is_visible', on: 'layer' },
      { read: 'get_offset', on: 'layer' },
      { read: 'get_rotation', on: 'layer' },
      { read: 'get_scale', on: 'layer' },
      { read: 'get_transform', on: 'layer' },
      { read: 'get_final_transform', on: 'layer' },
      { call: 'set_layer', on: 'layer', args: [int(3)] },
      { call: 'set_offset', on: 'layer', args: [v2(20, 10.5)] },
      { read: 'get_transform', on: 'layer' },
      { call: 'set_rotation', on: 'layer', args: [0.4] },
      { call: 'set_scale', on: 'layer', args: [v2(1.5, 0.75)] },
      { read: 'get_layer', on: 'layer' },
      { read: 'get_offset', on: 'layer' },
      { read: 'get_rotation', on: 'layer' },
      { read: 'get_scale', on: 'layer' },
      { read: 'get_transform', on: 'layer' },
      { read: 'get_final_transform', on: 'layer' },
      { read: 'get_global_transform_with_canvas', on: 'c' },
      { call: 'hide', on: 'layer' },
      { read: 'is_visible', on: 'layer' },
      { read: 'is_visible_in_tree', on: 'c' },
      { call: 'show', on: 'layer' },
      { call: 'set_visible', on: 'layer', args: [false] },
      { call: 'set_visible', on: 'layer', args: [true] },
      { read: 'is_visible', on: 'layer' },
      { read: 'is_visible_in_tree', on: 'c' },
    ],
  },
];
for (const member of [
  'set_layer',
  'get_layer',
  'set_visible',
  'is_visible',
  'show',
  'hide',
  'set_offset',
  'get_offset',
  'set_rotation',
  'get_rotation',
  'set_scale',
  'get_scale',
  'get_transform',
  'get_final_transform',
]) {
  add(`${member}-layer`, member, LAYER);
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'CanvasLayer', compatModule: 'lib/godot-compat/canvas-layer', cases };
export default EVIDENCE;
