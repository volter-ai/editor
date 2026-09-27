import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { BOX, TOUCH_BUTTONS } from './box-container.cases';
import { int, type Op, type Pair, rect, ref, type Segment, uiCase } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Container', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const RECTS = (...tags: string[]): Op[] =>
  tags.flatMap((tag): Op[] => [
    { read: 'get_position', on: tag },
    { read: 'get_size', on: tag },
  ]);

// A child fitted by hand, by each size flag, then re-sorted by the box on the next frame.
const FIT: Segment[] = [
  {
    ops: [
      { node: 'box', kind: 'HBoxContainer' },
      { call: 'set_size', on: 'box', args: [{ v2: [200, 100] }] },
      ...[0, 1, 4, 8].flatMap((flags): Op[] => [
        { node: `f${String(flags)}`, kind: 'Control', parent: 'box' },
        { call: 'set_custom_minimum_size', on: `f${String(flags)}`, args: [{ v2: [11, 13] }] },
        { call: 'set_h_size_flags', on: `f${String(flags)}`, args: [int(flags)] },
        { call: 'set_v_size_flags', on: `f${String(flags)}`, args: [int(flags)] },
      ]),
    ],
  },
  {
    await: 1,
    ops: [
      ...[0, 1, 4, 8].flatMap((flags): Op[] => [
        { call: 'fit_child_in_rect', on: 'box', args: [ref(`f${String(flags)}`), rect(3.5, 4.25, 60.5, 41)] },
        ...RECTS(`f${String(flags)}`),
      ]),
      { call: 'queue_sort', on: 'box' },
      ...RECTS('f0', 'f1', 'f4', 'f8'),
    ],
  },
  { await: 1, ops: RECTS('f0', 'f1', 'f4', 'f8') },
];
add('fit_child_in_rect-flags', 'fit_child_in_rect', FIT);
add('queue_sort-flags', 'queue_sort', FIT);
add('fit_child_in_rect-touch-buttons', 'fit_child_in_rect', TOUCH_BUTTONS);
add('fit_child_in_rect-box', 'fit_child_in_rect', BOX);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Container', compatModule: 'lib/godot-compat/container', cases };
export default EVIDENCE;
