import { Texture } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as TR from '../../capabilities/catalog/project-source/src/lib/godot-compat/texture-rect';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { drawn } from './canvas-draw';
import { int, type Op, type Pair, ref, type Segment, uiCase, v2 } from './ui-tree';

const VIEWPORT: Pair = [640, 360];
const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = uiCase(VIEWPORT, segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'TextureRect', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const RECTS = (...tags: string[]): Op[] =>
  tags.flatMap((tag): Op[] => [
    { read: 'get_position', on: tag },
    { read: 'get_size', on: tag },
    { read: 'get_combined_minimum_size', on: tag },
  ]);

// Each expand mode's minimum size against a node smaller than its texture; the texture resized.
const MODES: Segment[] = [
  {
    ops: [
      { placeholder: 'tex' },
      { call: 'set_size', on: 'tex', args: [v2(120.9, 60.2)] },
      ...[0, 1, 2, 3, 4, 5].flatMap((mode): Op[] => [
        { node: `r${String(mode)}`, kind: 'TextureRect' },
        { call: 'set_position', on: `r${String(mode)}`, args: [v2(10, 10)] },
        { call: 'set_size', on: `r${String(mode)}`, args: [v2(50, 30)] },
        { call: 'set_expand_mode', on: `r${String(mode)}`, args: [int(mode)] },
        { call: 'set_texture', on: `r${String(mode)}`, args: [ref('tex')] },
        { read: 'get_expand_mode', on: `r${String(mode)}` },
        ...RECTS(`r${String(mode)}`),
      ]),
    ],
  },
  { await: 1, ops: [0, 1, 2, 3, 4, 5].flatMap((mode): Op[] => RECTS(`r${String(mode)}`)) },
  { await: 1, ops: [{ call: 'set_size', on: 'tex', args: [v2(33, 250)] }, ...RECTS('r0')] },
  { await: 1, ops: [0, 1, 2, 3, 4, 5].flatMap((mode): Op[] => [...RECTS(`r${String(mode)}`), { read: 'get_texture', on: `r${String(mode)}`, then: 'get_size' }]) },
];
for (const member of ['set_texture', 'get_texture', 'set_expand_mode', 'get_expand_mode']) add(`${member}-modes`, member, MODES);

// The corpus's joystick base and tip: 200 and 100 pixel textures, centered, stretch mode 5.
const JOYSTICK: Segment[] = [
  {
    ops: [
      { placeholder: 'base_tex' },
      { call: 'set_size', on: 'base_tex', args: [v2(200, 200)] },
      { placeholder: 'tip_tex' },
      { call: 'set_size', on: 'tip_tex', args: [v2(100, 100)] },
      { node: 'joystick', kind: 'Control', detached: true },
      { call: 'set_anchors_preset', on: 'joystick', args: [int(2)] },
      { call: 'set_anchor', on: 'joystick', args: [int(1), 1] },
      { call: 'set_anchor', on: 'joystick', args: [int(3), 1] },
      { call: 'set_offset', on: 'joystick', args: [int(1), -308] },
      { call: 'set_offset', on: 'joystick', args: [int(2), 300] },
      { call: 'set_offset', on: 'joystick', args: [int(3), -8] },
      { call: 'set_v_grow_direction', on: 'joystick', args: [int(0)] },
      { node: 'base', kind: 'TextureRect', detached: true },
      { call: 'set_anchors_preset', on: 'base', args: [int(8)] },
      { call: 'set_anchor', on: 'base', args: [int(0), 0.5] },
      { call: 'set_anchor', on: 'base', args: [int(1), 0.5] },
      { call: 'set_anchor', on: 'base', args: [int(2), 0.5] },
      { call: 'set_anchor', on: 'base', args: [int(3), 0.5] },
      { call: 'set_offset', on: 'base', args: [int(0), -100] },
      { call: 'set_offset', on: 'base', args: [int(1), -100] },
      { call: 'set_offset', on: 'base', args: [int(2), 100] },
      { call: 'set_offset', on: 'base', args: [int(3), 100] },
      { call: 'set_h_grow_direction', on: 'base', args: [int(2)] },
      { call: 'set_v_grow_direction', on: 'base', args: [int(2)] },
      { call: 'set_pivot_offset', on: 'base', args: [v2(100, 100)] },
      { call: 'set_texture', on: 'base', args: [ref('base_tex')] },
      { call: 'set_stretch_mode', on: 'base', args: [int(5)] },
      { add: 'base', to: 'joystick' },
      { node: 'tip', kind: 'TextureRect', detached: true },
      { call: 'set_anchors_preset', on: 'tip', args: [int(8)] },
      { call: 'set_offset', on: 'tip', args: [int(0), -50] },
      { call: 'set_offset', on: 'tip', args: [int(1), -50] },
      { call: 'set_offset', on: 'tip', args: [int(2), 50] },
      { call: 'set_offset', on: 'tip', args: [int(3), 50] },
      { call: 'set_h_grow_direction', on: 'tip', args: [int(2)] },
      { call: 'set_v_grow_direction', on: 'tip', args: [int(2)] },
      { call: 'set_pivot_offset', on: 'tip', args: [v2(50, 50)] },
      { call: 'set_texture', on: 'tip', args: [ref('tip_tex')] },
      { call: 'set_stretch_mode', on: 'tip', args: [int(5)] },
      { add: 'tip', to: 'base' },
      { add: 'joystick' },
      ...RECTS('joystick', 'base', 'tip'),
      { read: 'get_stretch_mode', on: 'base' },
    ],
  },
  {
    await: 1,
    ops: [
      ...RECTS('joystick', 'base', 'tip'),
      { read: 'get_global_rect', on: 'tip' },
      { call: 'set_global_position', on: 'tip', args: [v2(130, 170)] },
      { read: 'get_global_rect', on: 'tip' },
      { call: 'set_position', on: 'tip', args: [v2(50, 50)] },
      { read: 'get_global_rect', on: 'tip' },
    ],
  },
];
for (const member of ['set_stretch_mode', 'get_stretch_mode']) add(`${member}-joystick`, member, JOYSTICK);

add('flip', 'set_flip_h', [
  {
    ops: [
      { node: 'r', kind: 'TextureRect' },
      { read: 'is_flipped_h', on: 'r' },
      { read: 'is_flipped_v', on: 'r' },
      { call: 'set_flip_h', on: 'r', args: [true] },
      { call: 'set_flip_v', on: 'r', args: [true] },
      { read: 'is_flipped_h', on: 'r' },
      { read: 'is_flipped_v', on: 'r' },
    ],
  },
]);
for (const member of ['is_flipped_h', 'set_flip_v', 'is_flipped_v']) {
  add(`${member}-flip`, member, [
    { ops: [{ node: 'r', kind: 'TextureRect' }, { call: 'set_flip_h', on: 'r', args: [true] }, { call: 'set_flip_v', on: 'r', args: [true] }, { read: 'is_flipped_h', on: 'r' }, { read: 'is_flipped_v', on: 'r' }] },
  ]);
}

// What the page draws: the texture's image at the rect `NOTIFICATION_DRAW` draws it in.
const DRAW = { file: 'scene/gui/texture_rect.cpp', symbol: 'TextureRect::_notification', line: 39 };
const drawCase = (id: string, mode: number, flip: boolean, fact: string): GodotEvidenceCase => ({
  id,
  symbol: { kind: 'native-member', owner: 'TextureRect', member: 'set_stretch_mode' },
  gdscript: '',
  comparator: 'render-mapping',
  fact: { value: fact, source: DRAW },
  target: () => {
    const page = drawn();
    const rect = page.node('Control', 'r', undefined, (entity) => TR.godot_texture_rect_mount(entity));
    const texture = new Texture({ src: 'data:image/png;base64,AAAA', width: 200, height: 100 } as unknown as HTMLImageElement);
    TR.set_expand_mode(rect, 1);
    TR.set_texture(rect, texture);
    TR.set_stretch_mode(rect, mode);
    TR.set_flip_h(rect, flip);
    C.set_size(rect, V2.construct(100, 100));
    page.draw();
    return page.root.querySelector('[data-godot-content]')?.getAttribute('style') ?? '';
  },
});
cases.push(
  // KEEP_ASPECT_CENTERED: 200x100 fitted to 100 wide is 100x50, centered (`texture_rect.cpp:62`).
  drawCase(
    'draw-keep-aspect-centered',
    5,
    false,
    'position: absolute; left: 0px; top: 25px; width: 100px; height: 50px; background-image: url("data:image/png;base64,AAAA"); background-repeat: no-repeat; background-size: 100% 100%; background-position: 0px 0px;',
  ),
  // KEEP_ASPECT_COVERED, flipped: the node's rect showing the texture's middle 100x100 region.
  drawCase(
    'draw-keep-aspect-covered-flipped',
    6,
    true,
    'position: absolute; left: 0px; top: 0px; width: 100px; height: 100px; transform: scale(-1, 1); background-image: url("data:image/png;base64,AAAA"); background-repeat: no-repeat; background-size: 200px 100px; background-position: -50px 0px;',
  ),
);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'TextureRect', compatModule: 'lib/godot-compat/texture-rect', cases };
export default EVIDENCE;
