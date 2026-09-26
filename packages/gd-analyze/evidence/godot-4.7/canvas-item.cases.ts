import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { JOYSTICK, TRANSFORM } from './control.cases';
import { color, int, type Op, type Pair, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CanvasItem', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const SEEN = (...tags: string[]): Op[] =>
  tags.flatMap((tag): Op[] => [
    { read: 'is_visible', on: tag },
    { read: 'is_visible_in_tree', on: tag },
  ]);

// Visibility through a layer, a parent and a child: hidden parents hide their children in the tree.
const VISIBILITY: Segment[] = [
  {
    ops: [
      { node: 'layer', kind: 'CanvasLayer' },
      { node: 'outer', kind: 'Control', parent: 'layer' },
      { node: 'inner', kind: 'Control', parent: 'outer' },
      { node: 'free', kind: 'Control' },
      ...SEEN('outer', 'inner', 'free'),
      { call: 'hide', on: 'outer' },
      ...SEEN('outer', 'inner'),
      { call: 'set_visible', on: 'inner', args: [false] },
      { call: 'show', on: 'outer' },
      ...SEEN('outer', 'inner'),
      { call: 'show', on: 'inner' },
      { call: 'hide', on: 'layer' },
      ...SEEN('outer', 'inner', 'free'),
      { call: 'show', on: 'layer' },
      ...SEEN('outer', 'inner'),
    ],
  },
  { await: 1, ops: [{ remove: 'inner' }, ...SEEN('inner')] },
];
for (const member of ['set_visible', 'is_visible', 'show', 'hide', 'is_visible_in_tree']) add(`${member}-visibility`, member, VISIBILITY);

// Modulation, z index and top level are stored as set; a top-level item leaves its parent's transform.
const STATE: Segment[] = [
  {
    ops: [
      { node: 'parent', kind: 'Control' },
      { call: 'set_position', on: 'parent', args: [v2(30, 40)] },
      { node: 'item', kind: 'Control', parent: 'parent' },
      { call: 'set_position', on: 'item', args: [v2(5, 6)] },
      { read: 'get_modulate', on: 'item' },
      { read: 'get_self_modulate', on: 'item' },
      { read: 'get_z_index', on: 'item' },
      { read: 'is_z_relative', on: 'item' },
      { read: 'is_set_as_top_level', on: 'item' },
      { call: 'set_modulate', on: 'item', args: [color(0.5, 0.25, 1, 0.75)] },
      { call: 'set_self_modulate', on: 'item', args: [color(0, 0, 0, 1)] },
      { call: 'set_z_index', on: 'item', args: [int(5)] },
      { call: 'set_z_index', on: 'item', args: [int(5000)] },
      { call: 'set_z_as_relative', on: 'item', args: [false] },
      { read: 'get_modulate', on: 'item' },
      { read: 'get_self_modulate', on: 'item' },
      { read: 'get_z_index', on: 'item' },
      { read: 'is_z_relative', on: 'item' },
      { read: 'get_global_transform', on: 'item' },
      { call: 'set_as_top_level', on: 'item', args: [true] },
      { read: 'is_set_as_top_level', on: 'item' },
      { read: 'get_global_transform', on: 'item' },
    ],
  },
];
for (const member of [
  'set_modulate',
  'get_modulate',
  'set_self_modulate',
  'get_self_modulate',
  'set_z_index',
  'get_z_index',
  'set_z_as_relative',
  'is_z_relative',
  'set_as_top_level',
  'is_set_as_top_level',
]) {
  add(`${member}-state`, member, STATE);
}

add('get_transform-transform', 'get_transform', TRANSFORM);
add('get_global_transform-transform', 'get_global_transform', TRANSFORM);
add('get_global_transform_with_canvas-joystick', 'get_global_transform_with_canvas', JOYSTICK);
add('get_global_transform_with_canvas-layer', 'get_global_transform_with_canvas', [
  {
    ops: [
      { node: 'layer', kind: 'CanvasLayer' },
      { call: 'set_offset', on: 'layer', args: [v2(12, -3)] },
      { call: 'set_scale', on: 'layer', args: [v2(2, 2)] },
      { node: 'c', kind: 'Control', parent: 'layer' },
      { call: 'set_position', on: 'c', args: [v2(7, 8)] },
      { read: 'get_global_transform', on: 'c' },
      { read: 'get_global_transform_with_canvas', on: 'c' },
      { node: 'bare', kind: 'Control' },
      { call: 'set_position', on: 'bare', args: [v2(1, 2)] },
      { read: 'get_global_transform_with_canvas', on: 'bare' },
    ],
  },
]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'CanvasItem', compatModule: 'lib/godot-compat/canvas-item', cases };
export default EVIDENCE;
