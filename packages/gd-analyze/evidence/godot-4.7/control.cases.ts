import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { int, type Op, type Pair, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Control', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const RECTS = (tag: string): Op[] => [
  { read: 'get_position', on: tag },
  { read: 'get_size', on: tag },
  { read: 'get_global_rect', on: tag },
  { read: 'get_rect', on: tag },
];
const EDGES = (tag: string): Op[] =>
  [0, 1, 2, 3].flatMap((side): Op[] => [
    { read: 'get_anchor', on: tag, args: [int(side)] },
    { read: 'get_offset', on: tag, args: [int(side)] },
  ]);

// Anchors and offsets against the viewport, then against a parent Control that is resized.
const ANCHORS: Segment[] = [
  {
    ops: [
      { node: 'a', kind: 'Control' },
      { call: 'set_anchor', on: 'a', args: [int(0), 0.25] },
      { call: 'set_anchor', on: 'a', args: [int(2), 0.75, true] },
      { call: 'set_anchor', on: 'a', args: [int(1), 0.5, false, false] },
      { call: 'set_anchor', on: 'a', args: [int(3), 0.2, false, true] },
      { call: 'set_offset', on: 'a', args: [int(0), 10.5] },
      { call: 'set_offset', on: 'a', args: [int(3), -7.25] },
      { call: 'set_anchor_and_offset', on: 'a', args: [int(2), 0.9, 3] },
      ...EDGES('a'),
      ...RECTS('a'),
      { node: 'b', kind: 'Control', parent: 'a' },
      { call: 'set_anchor', on: 'b', args: [int(0), 0.5] },
      { call: 'set_anchor', on: 'b', args: [int(2), 1] },
      { call: 'set_anchor', on: 'b', args: [int(3), 1] },
      { call: 'set_offset', on: 'b', args: [int(1), 4] },
      { call: 'set_begin', on: 'b', args: [v2(2, 3)] },
      { call: 'set_end', on: 'b', args: [v2(-1.5, -2)] },
      ...EDGES('b'),
      ...RECTS('b'),
      { read: 'get_begin', on: 'b' },
      { read: 'get_end', on: 'b' },
      { read: 'get_parent_area_size', on: 'b' },
    ],
  },
  { await: 1, ops: [{ call: 'set_offset', on: 'a', args: [int(2), 60] }, ...RECTS('a'), ...RECTS('b')] },
  { await: 1, ops: [...RECTS('b'), { read: 'get_global_position', on: 'b' }] },
];
for (const member of ['set_anchor', 'get_anchor', 'set_offset', 'get_offset', 'set_anchor_and_offset', 'set_begin', 'get_begin', 'set_end', 'get_end', 'get_parent_area_size']) {
  add(`${member}-anchors`, member, ANCHORS);
}

// Every preset in every resize mode, with and without a margin, on a node with a minimum size.
const PRESETS: Segment[] = [
  {
    ops: [
      { node: 'p', kind: 'Control' },
      { call: 'set_custom_minimum_size', on: 'p', args: [v2(40, 20)] },
      { call: 'set_size', on: 'p', args: [v2(100, 50)] },
      ...Array.from({ length: 16 }, (_, preset) => preset).flatMap((preset): Op[] =>
        [0, 1, 2, 3].flatMap((mode): Op[] => [
          { call: 'set_anchors_and_offsets_preset', on: 'p', args: [int(preset), int(mode), int(mode === 2 ? 7 : 0)] },
          ...EDGES('p'),
          ...RECTS('p'),
          { call: 'set_size', on: 'p', args: [v2(100, 50)] },
        ]),
      ),
      { call: 'set_anchors_preset', on: 'p', args: [int(8), true] },
      ...EDGES('p'),
      { call: 'set_offsets_preset', on: 'p', args: [int(3)] },
      ...EDGES('p'),
      ...RECTS('p'),
    ],
  },
];
for (const member of ['set_anchors_preset', 'set_offsets_preset', 'set_anchors_and_offsets_preset', 'set_custom_minimum_size', 'get_custom_minimum_size', 'get_combined_minimum_size', 'get_minimum_size']) {
  add(`${member}-presets`, member, [
    ...PRESETS,
    { ops: [{ read: 'get_custom_minimum_size', on: 'p' }, { read: 'get_combined_minimum_size', on: 'p' }, { read: 'get_minimum_size', on: 'p' }] },
  ]);
}

// A rect smaller than the minimum size grows by the grow direction; a maximum size caps it.
const GROW: Segment[] = [
  {
    ops: [0, 1, 2].flatMap((grow): Op[] => [
      { node: `g${String(grow)}`, kind: 'Control' },
      { call: 'set_anchors_and_offsets_preset', on: `g${String(grow)}`, args: [int(8)] },
      { call: 'set_offset', on: `g${String(grow)}`, args: [int(0), -10] },
      { call: 'set_offset', on: `g${String(grow)}`, args: [int(2), 10] },
      { call: 'set_h_grow_direction', on: `g${String(grow)}`, args: [int(grow)] },
      { call: 'set_v_grow_direction', on: `g${String(grow)}`, args: [int(grow)] },
      { call: 'set_custom_minimum_size', on: `g${String(grow)}`, args: [v2(51, 33)] },
      { read: 'get_h_grow_direction', on: `g${String(grow)}` },
      { read: 'get_v_grow_direction', on: `g${String(grow)}` },
    ]),
  },
  {
    await: 1,
    ops: [
      ...[0, 1, 2].flatMap((grow): Op[] => RECTS(`g${String(grow)}`)),
      { node: 'm', kind: 'Control' },
      { call: 'set_anchors_and_offsets_preset', on: 'm', args: [int(15)] },
      { call: 'set_h_grow_direction', on: 'm', args: [int(2)] },
      { call: 'set_custom_maximum_size', on: 'm', args: [v2(200, -1)] },
      { read: 'get_custom_maximum_size', on: 'm' },
      ...RECTS('m'),
      { call: 'set_size', on: 'm', args: [v2(500, 100)] },
      ...RECTS('m'),
      ...EDGES('m'),
    ],
  },
];
for (const member of ['set_h_grow_direction', 'get_h_grow_direction', 'set_v_grow_direction', 'get_v_grow_direction', 'set_custom_maximum_size', 'get_custom_maximum_size']) {
  add(`${member}-grow`, member, GROW);
}

// Moving and resizing by position and size, keeping offsets or anchors, and resetting the size.
const PLACE: Segment[] = [
  {
    ops: [
      { node: 's', kind: 'Control' },
      { call: 'set_anchor', on: 's', args: [int(0), 0.1] },
      { call: 'set_anchor', on: 's', args: [int(1), 0.2] },
      { call: 'set_anchor', on: 's', args: [int(2), 0.6] },
      { call: 'set_anchor', on: 's', args: [int(3), 0.7] },
      { call: 'set_position', on: 's', args: [v2(33.3, 44.4)] },
      ...EDGES('s'),
      ...RECTS('s'),
      { call: 'set_position', on: 's', args: [v2(12, 13), true] },
      ...EDGES('s'),
      ...RECTS('s'),
      { call: 'set_size', on: 's', args: [v2(77.7, 11.1)] },
      ...EDGES('s'),
      ...RECTS('s'),
      { call: 'set_size', on: 's', args: [v2(120, 90), true] },
      ...EDGES('s'),
      ...RECTS('s'),
      { call: 'set_custom_minimum_size', on: 's', args: [v2(15, 25)] },
      { call: 'reset_size', on: 's' },
      ...EDGES('s'),
      ...RECTS('s'),
    ],
  },
];
for (const member of ['set_position', 'get_position', 'set_size', 'get_size', 'reset_size', 'get_rect']) add(`${member}-place`, member, PLACE);

// Rotation, scale and pivot in the rects and transforms, under a moved parent; global placement.
export const TRANSFORM: Segment[] = [
  {
    ops: [
      { node: 'parent', kind: 'Control' },
      { call: 'set_position', on: 'parent', args: [v2(100, 50)] },
      { call: 'set_size', on: 'parent', args: [v2(300, 200)] },
      { call: 'set_scale', on: 'parent', args: [v2(2, 0.5)] },
      { node: 't', kind: 'Control', parent: 'parent' },
      { call: 'set_position', on: 't', args: [v2(10, 20)] },
      { call: 'set_size', on: 't', args: [v2(40, 30)] },
      { call: 'set_pivot_offset', on: 't', args: [v2(20, 15)] },
      { call: 'set_rotation', on: 't', args: [0.3] },
      { call: 'set_scale', on: 't', args: [v2(1.5, 0)] },
      { read: 'get_rotation', on: 't' },
      { read: 'get_scale', on: 't' },
      { read: 'get_pivot_offset', on: 't' },
      { read: 'get_transform', on: 't' },
      { read: 'get_global_transform', on: 't' },
      ...RECTS('t'),
      { read: 'get_global_position', on: 't' },
      { call: 'set_global_position', on: 't', args: [v2(150, 90)] },
      ...EDGES('t'),
      ...RECTS('t'),
      { call: 'set_global_position', on: 't', args: [v2(151, 91), true] },
      ...EDGES('t'),
      { read: 'get_global_position', on: 't' },
    ],
  },
];
for (const member of ['set_rotation', 'get_rotation', 'set_scale', 'get_scale', 'set_pivot_offset', 'get_pivot_offset', 'get_global_rect', 'get_global_position', 'set_global_position']) {
  add(`${member}-transform`, member, TRANSFORM);
}

// The corpus's virtual joystick: bottom-left of the screen, a base centered in it, a tip in that.
export const JOYSTICK: Segment[] = [
  {
    ops: [
      { node: 'layer', kind: 'CanvasLayer' },
      { node: 'joystick', kind: 'Control', parent: 'layer' },
      { call: 'set_anchors_preset', on: 'joystick', args: [int(2)] },
      { call: 'set_anchor', on: 'joystick', args: [int(1), 1] },
      { call: 'set_anchor', on: 'joystick', args: [int(3), 1] },
      { call: 'set_offset', on: 'joystick', args: [int(1), -308] },
      { call: 'set_offset', on: 'joystick', args: [int(2), 300] },
      { call: 'set_offset', on: 'joystick', args: [int(3), -8] },
      { call: 'set_v_grow_direction', on: 'joystick', args: [int(0)] },
      { node: 'base', kind: 'Control', parent: 'joystick' },
      { call: 'set_anchors_preset', on: 'base', args: [int(8)] },
      { call: 'set_offset', on: 'base', args: [int(0), -100] },
      { call: 'set_offset', on: 'base', args: [int(1), -100] },
      { call: 'set_offset', on: 'base', args: [int(2), 100] },
      { call: 'set_offset', on: 'base', args: [int(3), 100] },
      { call: 'set_pivot_offset', on: 'base', args: [v2(100, 100)] },
      { node: 'tip', kind: 'Control', parent: 'base' },
      { call: 'set_anchors_preset', on: 'tip', args: [int(8)] },
      { call: 'set_offset', on: 'tip', args: [int(0), -50] },
      { call: 'set_offset', on: 'tip', args: [int(1), -50] },
      { call: 'set_offset', on: 'tip', args: [int(2), 50] },
      { call: 'set_offset', on: 'tip', args: [int(3), 50] },
      { call: 'set_pivot_offset', on: 'tip', args: [v2(50, 50)] },
    ],
  },
  {
    await: 1,
    ops: [
      ...['joystick', 'base', 'tip'].flatMap((tag): Op[] => [...RECTS(tag), { read: 'get_global_position', on: tag }]),
      { read: 'get_global_transform_with_canvas', on: 'base' },
      { call: 'set_global_position', on: 'base', args: [v2(180, 210)] },
      ...RECTS('base'),
      ...RECTS('tip'),
      { call: 'set_global_position', on: 'tip', args: [v2(220, 190)] },
      ...RECTS('tip'),
    ],
  },
];
add('get_global_rect-joystick', 'get_global_rect', JOYSTICK);
add('set_global_position-joystick', 'set_global_position', JOYSTICK);

// Size flags and the stretch ratio are stored as set.
add('size-flags', 'set_h_size_flags', [
  {
    ops: [
      { node: 'f', kind: 'Control' },
      { read: 'get_h_size_flags', on: 'f' },
      { read: 'get_v_size_flags', on: 'f' },
      { read: 'get_stretch_ratio', on: 'f' },
      { call: 'set_h_size_flags', on: 'f', args: [int(3)] },
      { call: 'set_v_size_flags', on: 'f', args: [int(8)] },
      { call: 'set_stretch_ratio', on: 'f', args: [2.5] },
      { read: 'get_h_size_flags', on: 'f' },
      { read: 'get_v_size_flags', on: 'f' },
      { read: 'get_stretch_ratio', on: 'f' },
    ],
  },
]);
for (const member of ['get_h_size_flags', 'set_v_size_flags', 'get_v_size_flags', 'set_stretch_ratio', 'get_stretch_ratio']) {
  add(`${member}-size-flags`, member, [
    {
      ops: [
        { node: 'f', kind: 'Control' },
        { call: 'set_h_size_flags', on: 'f', args: [int(3)] },
        { call: 'set_v_size_flags', on: 'f', args: [int(8)] },
        { call: 'set_stretch_ratio', on: 'f', args: [2.5] },
        { read: 'get_h_size_flags', on: 'f' },
        { read: 'get_v_size_flags', on: 'f' },
        { read: 'get_stretch_ratio', on: 'f' },
      ],
    },
  ]);
}

// Theme constant overrides over the default theme (which gives a plain Control no `separation`).
const THEME: Segment[] = [
  {
    ops: [
      { node: 'c', kind: 'Control' },
      { read: 'has_theme_constant_override', on: 'c', args: ['separation'] },
      { read: 'get_theme_constant', on: 'c', args: ['separation'] },
      { call: 'add_theme_constant_override', on: 'c', args: ['separation', int(9)] },
      { read: 'has_theme_constant_override', on: 'c', args: ['separation'] },
      { read: 'get_theme_constant', on: 'c', args: ['separation'] },
      { call: 'update_minimum_size', on: 'c' },
      { call: 'remove_theme_constant_override', on: 'c', args: ['separation'] },
      { read: 'has_theme_constant_override', on: 'c', args: ['separation'] },
      { read: 'get_theme_constant', on: 'c', args: ['separation'] },
    ],
  },
];
for (const member of ['add_theme_constant_override', 'remove_theme_constant_override', 'has_theme_constant_override', 'get_theme_constant', 'update_minimum_size']) {
  add(`${member}-theme`, member, THEME);
}

// The mouse filter is stored as set; an index outside the three filters is ignored.
for (const member of ['set_mouse_filter', 'get_mouse_filter']) {
  add(`${member}-filter`, member, [
    {
      ops: [
        { node: 'm', kind: 'Control' },
        { read: 'get_mouse_filter', on: 'm' },
        { call: 'set_mouse_filter', on: 'm', args: [int(1)] },
        { read: 'get_mouse_filter', on: 'm' },
        { call: 'set_mouse_filter', on: 'm', args: [int(2)] },
        { read: 'get_mouse_filter', on: 'm' },
        { call: 'set_mouse_filter', on: 'm', args: [int(5)] },
        { read: 'get_mouse_filter', on: 'm' },
      ],
    },
  ]);
}

// The scene's layout properties: `layout_mode`, `anchors_preset` and `anchor_*` set before the node
// is parented (as a scene sets them), then read once it is in a plain parent or a container.
const LAYOUT: Segment[] = [
  {
    ops: [
      { node: 'box', kind: 'HBoxContainer' },
      ...[
        ['a', 1, 15],
        ['b', 1, 8],
        ['c', 0, 6],
        ['d', 1, -1],
        ['e', 3, 3],
      ].flatMap(([tag, mode, preset]): Op[] => [
        { node: tag as string, kind: 'Control', detached: true },
        { call: 'set_custom_minimum_size', on: tag as string, args: [v2(20, 10)] },
        { call: '_set_layout_mode', on: tag as string, args: [int(mode as number)] },
        { call: '_set_anchors_layout_preset', on: tag as string, args: [int(preset as number)] },
        { call: '_set_anchor', on: tag as string, args: [int(2), 0.75] },
        { call: 'set_force_pass_scroll_events', on: tag as string, args: [false] },
        { read: '_get_layout_mode', on: tag as string },
        { read: '_get_anchors_layout_preset', on: tag as string },
        { read: 'is_force_pass_scroll_events', on: tag as string },
        ...EDGES(tag as string),
      ]),
      { add: 'a' },
      { add: 'b' },
      { add: 'c' },
      { add: 'd', to: 'box' },
      { add: 'e', to: 'a' },
      ...['a', 'b', 'c', 'd', 'e'].flatMap((tag): Op[] => [{ read: '_get_layout_mode', on: tag }, { read: '_get_anchors_layout_preset', on: tag }]),
    ],
  },
  { await: 1, ops: ['a', 'b', 'c', 'd', 'e'].flatMap((tag): Op[] => [...EDGES(tag), ...RECTS(tag)]) },
];
for (const member of ['_set_layout_mode', '_get_layout_mode', '_set_anchors_layout_preset', '_get_anchors_layout_preset', '_set_anchor', 'set_force_pass_scroll_events', 'is_force_pass_scroll_events']) {
  add(`${member}-layout`, member, LAYOUT);
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Control', compatModule: 'lib/godot-compat/control', cases };
export default EVIDENCE;
