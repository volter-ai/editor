import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { int, type Op, type Pair, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];

const RECTS = (...tags: string[]): Op[] =>
  tags.flatMap((tag): Op[] => [
    { read: 'get_position', on: tag },
    { read: 'get_size', on: tag },
    { read: 'get_global_rect', on: tag },
  ]);

/**
 * The corpus's touch buttons: an HBoxContainer at the right edge, centered vertically, holding two
 * expanding Controls each with a full-rect child; read before and after the deferred sort.
 */
export const TOUCH_BUTTONS: Segment[] = [
  {
    ops: [
      // The scene's properties in its file's order, set before the instance enters the tree.
      { node: 'layer', kind: 'CanvasLayer', detached: true },
      { node: 'box', kind: 'HBoxContainer', detached: true },
      { call: 'set_anchors_preset', on: 'box', args: [int(6)] },
      { call: 'set_anchor', on: 'box', args: [int(0), 1] },
      { call: 'set_anchor', on: 'box', args: [int(1), 0.5] },
      { call: 'set_anchor', on: 'box', args: [int(2), 1] },
      { call: 'set_anchor', on: 'box', args: [int(3), 0.5] },
      { call: 'set_offset', on: 'box', args: [int(0), -256] },
      { call: 'set_offset', on: 'box', args: [int(1), -64] },
      { call: 'set_offset', on: 'box', args: [int(3), 64] },
      { call: 'set_h_grow_direction', on: 'box', args: [int(0)] },
      { call: 'set_v_grow_direction', on: 'box', args: [int(2)] },
      { add: 'box', to: 'layer' },
      ...['jump', 'shoot'].flatMap((tag): Op[] => [
        { node: tag, kind: 'Control', detached: true },
        { call: 'set_h_size_flags', on: tag, args: [int(3)] },
        { add: tag, to: 'box' },
        { node: `${tag}_label`, kind: 'Control', detached: true },
        { call: 'set_anchors_preset', on: `${tag}_label`, args: [int(15)] },
        { call: 'set_anchor', on: `${tag}_label`, args: [int(2), 1] },
        { call: 'set_anchor', on: `${tag}_label`, args: [int(3), 1] },
        { call: 'set_h_grow_direction', on: `${tag}_label`, args: [int(2)] },
        { call: 'set_v_grow_direction', on: `${tag}_label`, args: [int(2)] },
        { add: `${tag}_label`, to: tag },
      ]),
      { add: 'layer' },
      ...RECTS('box', 'jump', 'shoot', 'jump_label'),
      { read: 'get_combined_minimum_size', on: 'box' },
      { read: 'get_theme_constant', on: 'box', args: ['separation'] },
    ],
  },
  { await: 1, ops: [...RECTS('box', 'jump', 'shoot', 'jump_label', 'shoot_label')] },
];

// Separation, alignment, stretch ratios, minimum sizes, shrink flags, a hidden child, a removed one.
export const BOX: Segment[] = [
  {
    ops: [
      { node: 'box', kind: 'HBoxContainer' },
      { call: 'set_position', on: 'box', args: [v2(10, 20)] },
      { call: 'set_size', on: 'box', args: [v2(401, 50)] },
      { node: 'a', kind: 'Control', parent: 'box' },
      { call: 'set_custom_minimum_size', on: 'a', args: [v2(30.5, 10)] },
      { node: 'b', kind: 'Control', parent: 'box' },
      { call: 'set_h_size_flags', on: 'b', args: [int(3)] },
      { call: 'set_stretch_ratio', on: 'b', args: [2] },
      { node: 'c', kind: 'Control', parent: 'box' },
      { call: 'set_h_size_flags', on: 'c', args: [int(3)] },
      { call: 'set_custom_minimum_size', on: 'c', args: [v2(150, 0)] },
      { node: 'd', kind: 'Control', parent: 'box' },
      { call: 'set_h_size_flags', on: 'd', args: [int(2)] },
      { call: 'set_v_size_flags', on: 'd', args: [int(4)] },
      { call: 'set_custom_minimum_size', on: 'd', args: [v2(20, 21)] },
    ],
  },
  { await: 1, ops: [...RECTS('box', 'a', 'b', 'c', 'd'), { read: 'get_combined_minimum_size', on: 'box' }, { read: 'get_alignment', on: 'box' }, { read: 'is_vertical', on: 'box' }] },
  {
    await: 1,
    ops: [
      { call: 'add_theme_constant_override', on: 'box', args: ['separation', int(9)] },
      { call: 'set_v_size_flags', on: 'd', args: [int(8)] },
      { call: 'hide', on: 'a' },
      ...RECTS('b'),
    ],
  },
  { await: 1, ops: [...RECTS('box', 'b', 'c', 'd'), { read: 'get_combined_minimum_size', on: 'box' }, { call: 'set_alignment', on: 'box', args: [int(1)] }, ...RECTS('b', 'c', 'd')] },
  {
    await: 1,
    ops: [
      { call: 'set_h_size_flags', on: 'b', args: [int(0)] },
      { call: 'set_h_size_flags', on: 'c', args: [int(0)] },
      { call: 'set_h_size_flags', on: 'd', args: [int(0)] },
      { call: 'set_alignment', on: 'box', args: [int(2)] },
      ...RECTS('b', 'c', 'd'),
    ],
  },
  { await: 1, ops: [...RECTS('b', 'c', 'd'), { remove: 'c' }, { call: 'set_size', on: 'box', args: [v2(99, 7)] }, ...RECTS('box')] },
  { await: 1, ops: [...RECTS('box', 'b', 'd'), { read: 'get_combined_minimum_size', on: 'box' }] },
];

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'BoxContainer', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
for (const member of ['set_alignment', 'get_alignment', 'is_vertical']) add(`${member}-box`, member, BOX);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'BoxContainer', compatModule: 'lib/godot-compat/box-container', cases };
export default EVIDENCE;
