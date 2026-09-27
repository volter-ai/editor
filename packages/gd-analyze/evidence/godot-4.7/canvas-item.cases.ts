import * as CI from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-item';
import * as CL from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-layer';
import * as COLOR from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceFact } from '../../src/evidence/case';
import { drawn } from './canvas-draw';
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

// What the page draws: the renderer's canvas item state as element styles.
const CULL: GodotEvidenceFact['source'] = { file: 'servers/rendering/renderer_canvas_cull.cpp', symbol: 'RendererCanvasCull::_cull_canvas_item', line: 304 };
const mapping = (id: string, member: string, fact: string, source: GodotEvidenceFact['source'], target: () => unknown): GodotEvidenceCase => ({
  id,
  symbol: { kind: 'native-member', owner: 'CanvasItem', member },
  gdscript: '',
  target,
  comparator: 'render-mapping',
  fact: { value: fact, source },
});
cases.push(
  // A Control's element is placed by its drawn transform, the origin snapped to whole pixels
  // (`Control::_update_canvas_item_transform`), inside its layer's element stacked by the layer.
  mapping(
    'draw-control-in-layer',
    'get_transform',
    [
      'position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; pointer-events: none; z-index: 3; transform-origin: 0px 0px; transform: matrix(1, 0, 0, 1, 5, 6);',
      // The width is the size Godot keeps, `40.4f - 10.4f` in single precision.
      'position: absolute; left: 0px; top: 0px; width: 30.000001907348633px; height: 40px; transform-origin: 0px 0px; transform: matrix(1, 0, 0, 1, 10, 21); z-index: 0;',
    ].join('\n'),
    { file: 'scene/gui/control.cpp', symbol: 'Control::_update_canvas_item_transform', line: 755 },
    () => {
      const page = drawn();
      const layer = page.node('CanvasLayer', 'layer');
      CL.set_layer(layer, 3);
      CL.set_offset(layer, V2.construct(5, 6));
      const control = page.node('Control', 'c', layer);
      C.set_position(control, V2.construct(10.4, 20.6));
      C.set_size(control, V2.construct(30, 40));
      page.draw();
      return [page.style('layer'), page.style('c')].join('\n');
    },
  ),
  // Hidden: the element (and so its children) is not displayed (`canvas_item_set_visible`).
  mapping('draw-hidden', 'set_visible', 'display: none;', CULL, () => {
    const page = drawn();
    const control = page.node('Control', 'c');
    CI.hide(control);
    page.draw();
    return /display: none;/.exec(page.style('c'))?.[0] ?? '';
  }),
  // Modulate multiplies the item and its children: a filter scaling each channel in sRGB.
  mapping('draw-modulate', 'set_modulate', 'url(#godot-modulate-1)|sRGB|0.5 0 0 0 0 0 0.25 0 0 0 0 0 1 0 0 0 0 0 0.75 0', CULL, () => {
    const page = drawn();
    const control = page.node('Control', 'c');
    CI.set_modulate(control, COLOR.construct(0.5, 0.25, 1, 0.75));
    page.draw();
    const filter = /filter: ([^;]*);/.exec(page.style('c'))?.[1] ?? '';
    const element = page.root.querySelector('filter');
    return [filter.replace(/godot-modulate-\d+/, 'godot-modulate-1'), element?.getAttribute('color-interpolation-filters'), element?.firstElementChild?.getAttribute('values')].join('|');
  }),
  // A rotated Control keeps its unsnapped transform; z index orders it among its siblings.
  mapping('draw-rotated-z', 'set_z_index', 'transform: matrix(0.9553365111351013, 0.29552021622657776, -0.29552021622657776, 0.9553365111351013, 10.5, 20.25); z-index: 7;', CULL, () => {
    const page = drawn();
    const control = page.node('Control', 'c');
    C.set_position(control, V2.construct(10.5, 20.25));
    C.set_rotation(control, 0.3);
    CI.set_z_index(control, 7);
    page.draw();
    return /transform: matrix[^;]*; z-index: \d+;/.exec(page.style('c'))?.[0] ?? '';
  }),
);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'CanvasItem', compatModule: 'lib/godot-compat/canvas-item', cases };
export default EVIDENCE;
