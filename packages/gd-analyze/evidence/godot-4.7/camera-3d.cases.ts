import { Group, Mesh, PerspectiveCamera, Scene } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/camera-3d';
import * as ENV from '../../capabilities/catalog/project-source/src/lib/godot-compat/environment';
import * as NODE from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/sub-viewport';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { int, scene, type Step, v2, v3, type Value } from './scene-tree';

const cases: GodotEvidenceCase[] = [];

function add(id: string, member: string, steps: readonly Step[], call: string, args: readonly Value[] = []): void {
  const built = scene(steps, { call, on: 'c', args }, [C, N], (viewport, size) => SV.set_size(viewport, size as never));
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Camera3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const cam = (w: number, h: number): Step => ({ node: 'c', camera: [w, h] });

for (const getter of ['get_fov', 'get_near', 'get_far', 'get_keep_aspect_mode'] as const) {
  add(`fresh-${getter}`, getter, [cam(640, 480)], getter);
}
for (const fov of [75, 1, 179, 0.5, 200, 33.3]) {
  add(`set_fov-${String(fov)}`, 'set_fov', [cam(640, 480), { call: 'set_fov', on: 'c', args: [fov] }], 'get_fov');
}
for (const near of [0.05, 0.1, 1e-4, 3.3]) add(`set_near-${String(near)}`, 'set_near', [cam(640, 480), { call: 'set_near', on: 'c', args: [near] }], 'get_near');
for (const far of [4000, 100.5, 1e6]) add(`set_far-${String(far)}`, 'set_far', [cam(640, 480), { call: 'set_far', on: 'c', args: [far] }], 'get_far');
for (const mode of [0, 1]) {
  add(`set_keep_aspect_mode-${String(mode)}`, 'set_keep_aspect_mode', [cam(640, 480), { call: 'set_keep_aspect_mode', on: 'c', args: [int(mode)] }], 'get_keep_aspect_mode');
}

const SIZES: readonly (readonly [number, number])[] = [
  [640, 480],
  [1920, 1080],
  [300, 900],
  [1, 1],
];
const POINTS = [v2(0, 0), v2(320, 240), v2(10.5, 400.25), v2(-50, 1000), v2(639, 479)];
const POSES: readonly (readonly [string, readonly Step[]])[] = [
  ['identity', []],
  ['moved', [
    { call: 'set_position', on: 'c', args: [v3(1, 5, -3)] },
    { call: 'set_rotation', on: 'c', args: [v3(-0.4, 0.8, 0.1)] },
  ]],
  ['scaled', [
    { call: 'set_scale', on: 'c', args: [v3(2, 0.5, 3)] },
    { call: 'set_rotation', on: 'c', args: [v3(0.2, -0.3, 0.9)] },
  ]],
  ['looking', [{ call: 'look_at_from_position', on: 'c', args: [v3(4, 3, 2), v3(0, 0, 0)] }]],
];
for (const [w, h] of SIZES) {
  for (const [poseName, pose] of POSES) {
    for (const [lensName, lens] of [
      ['default', []],
      ['wide', [{ call: 'set_fov', on: 'c', args: [110] }, { call: 'set_near', on: 'c', args: [0.3] }]],
      ['keep-width', [{ call: 'set_keep_aspect_mode', on: 'c', args: [int(0)] }, { call: 'set_fov', on: 'c', args: [60] }]],
    ] as const) {
      const steps: Step[] = [cam(w, h), ...lens, ...pose];
      for (const [index, point] of POINTS.entries()) {
        add(`project_ray_normal-${String(w)}x${String(h)}-${poseName}-${lensName}-${String(index)}`, 'project_ray_normal', steps, 'project_ray_normal', [point]);
      }
      add(`project_ray_origin-${String(w)}x${String(h)}-${poseName}-${lensName}`, 'project_ray_origin', steps, 'project_ray_origin', [POINTS[1] as Value]);
    }
  }
}

/**
 * Which camera a viewport draws with: cameras `a`, `b`, `c` built outside the tree, then added to
 * or removed from one SubViewport and made or cleared current; the case returns each camera's
 * `is_current()`.
 */
type CurrentOp = readonly ['add' | 'remove' | 'make' | 'clear' | 'clear-only' | 'on' | 'off', 'a' | 'b' | 'c'];

function currentCase(id: string, member: string, ops: readonly CurrentOp[]): void {
  const lines = ['var vp := SubViewport.new()', 'holder.add_child(vp)', 'var a := Camera3D.new()', 'var b := Camera3D.new()', 'var c := Camera3D.new()'];
  for (const [op, cam] of ops) {
    lines.push(
      {
        add: `vp.add_child(${cam})`,
        remove: `vp.remove_child(${cam})`,
        make: `${cam}.make_current()`,
        clear: `${cam}.clear_current()`,
        'clear-only': `${cam}.clear_current(false)`,
        on: `${cam}.current = true`,
        off: `${cam}.current = false`,
      }[op],
    );
  }
  lines.push('var out := [a.is_current(), b.is_current(), c.is_current()]');
  lines.push('for n in [a, b, c]:', '\tif not n.is_inside_tree():', '\t\tn.free()');
  lines.push('return out');
  const target = (): unknown => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const holder = new Group();
    NODE.godot_node_adopt(holder, { kind: 'node' });
    NODE.add_child(root, holder);
    const vp = new Scene();
    NODE.godot_node_adopt(vp, { kind: 'node', classes: ['SubViewport', 'Viewport', 'Node'] });
    NODE.add_child(holder, vp);
    const cams = { a: new PerspectiveCamera(75, 1, 0.05, 4000), b: new PerspectiveCamera(75, 1, 0.05, 4000), c: new PerspectiveCamera(75, 1, 0.05, 4000) };
    for (const cam of Object.values(cams)) C.godot_camera_3d_mount(cam);
    for (const [op, name] of ops) {
      const cam = cams[name];
      if (op === 'add') NODE.add_child(vp, cam);
      else if (op === 'remove') NODE.remove_child(vp, cam);
      else if (op === 'make') C.make_current(cam);
      else if (op === 'clear') C.clear_current(cam);
      else if (op === 'clear-only') C.clear_current(cam, false);
      else C.set_current(cam, op === 'on');
    }
    return [C.is_current(cams.a), C.is_current(cams.b), C.is_current(cams.c)];
  };
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Camera3D', member }, gdscript: lines.join('\n'), target, comparator: 'exact' });
}

// The camera's own environment, set and read back.
cases.push(
  {
    id: 'set_environment',
    symbol: { kind: 'native-member', owner: 'Camera3D', member: 'set_environment' },
    gdscript: ['var c := Camera3D.new()', 'var e := Environment.new()', 'c.set_environment(e)', 'var same := c.get_environment() == e', 'c.set_environment(null)', 'var cleared := c.get_environment() == null', 'c.free()', 'return [same, cleared]'].join('\n'),
    target: () => {
      const c = new PerspectiveCamera();
      const e = ENV.construct();
      C.set_environment(c, e);
      const same = C.get_environment(c) === e;
      C.set_environment(c, null);
      return [same, C.get_environment(c) === null];
    },
    comparator: 'exact',
  },
  {
    id: 'get_environment-default',
    symbol: { kind: 'native-member', owner: 'Camera3D', member: 'get_environment' },
    gdscript: ['var c := Camera3D.new()', 'var none := c.get_environment() == null', 'c.free()', 'return none'].join('\n'),
    target: () => C.get_environment(new PerspectiveCamera()) === null,
    comparator: 'exact',
  },
);

const CURRENT: readonly (readonly [string, string, readonly CurrentOp[]])[] = [
  ['outside', 'is_current', []],
  ['first-added', 'is_current', [['add', 'a']]],
  ['second-added', 'is_current', [['add', 'a'], ['add', 'b']]],
  ['current-before-add', 'set_current', [['add', 'a'], ['on', 'b'], ['add', 'b']]],
  ['made-inside', 'make_current', [['add', 'a'], ['add', 'b'], ['make', 'b']]],
  ['made-outside', 'make_current', [['make', 'c']]],
  ['cleared-next', 'clear_current', [['add', 'a'], ['add', 'b'], ['add', 'c'], ['clear', 'a']]],
  ['cleared-no-next', 'clear_current', [['add', 'a'], ['add', 'b'], ['clear-only', 'a']]],
  ['cleared-not-current', 'clear_current', [['add', 'a'], ['add', 'b'], ['clear', 'b']]],
  ['off', 'set_current', [['add', 'a'], ['add', 'b'], ['off', 'a']]],
  ['removed-current', 'is_current', [['add', 'a'], ['add', 'b'], ['remove', 'a']]],
  ['removed-keeps-flag', 'is_current', [['add', 'a'], ['add', 'b'], ['remove', 'a'], ['add', 'a']]],
  ['removed-other', 'is_current', [['add', 'a'], ['add', 'b'], ['add', 'c'], ['remove', 'b'], ['clear', 'a']]],
  ['set-order', 'clear_current', [['add', 'a'], ['add', 'b'], ['add', 'c'], ['remove', 'a'], ['add', 'a'], ['clear', 'b']]],
  ['swap-last', 'clear_current', [['add', 'a'], ['add', 'b'], ['add', 'c'], ['remove', 'a'], ['make', 'b'], ['add', 'a'], ['clear', 'b']]],
  ['readd-outside-current', 'is_current', [['add', 'a'], ['make', 'b'], ['add', 'b'], ['remove', 'b'], ['add', 'c'], ['add', 'b']]],
];
for (const [name, member, ops] of CURRENT) currentCase(`current-${name}`, member, ops);

// The cull mask: a new camera's, set and read back, and by layer number.
add('get_cull_mask-default', 'get_cull_mask', [cam(640, 480)], 'get_cull_mask');
for (const mask of [1, 2, 0, 0xfffff, 0x80001]) {
  add(`set_cull_mask-${String(mask)}`, 'set_cull_mask', [cam(640, 480), { call: 'set_cull_mask', on: 'c', args: [int(mask)] }], 'get_cull_mask');
}
for (const [layer, value] of [[1, false], [2, true], [20, false], [0, false], [21, true]] as const) {
  add(`set_cull_mask_value-${String(layer)}-${String(value)}`, 'set_cull_mask_value', [cam(640, 480), { call: 'set_cull_mask', on: 'c', args: [int(1)] }, { call: 'set_cull_mask_value', on: 'c', args: [int(layer), value] }], 'get_cull_mask');
}
for (const layer of [1, 2, 20, 0, 21]) {
  add(`get_cull_mask_value-${String(layer)}`, 'get_cull_mask_value', [cam(640, 480), { call: 'set_cull_mask', on: 'c', args: [int(0x80001)] }], 'get_cull_mask_value', [int(layer)]);
}
// Which camera draws a mesh on render layer 2 (`LAYER_CHECK`, renderer_scene_cull.cpp:2922: the
// camera's cull mask and the instance's layer mask share a bit), against three's `layers.test`
// between the mesh's layers (as its element states them) and the camera's: a new camera draws it,
// a cull mask of 1 hides it.
cases.push({
  id: 'cull-mask-draws-layer-2',
  symbol: { kind: 'native-member', owner: 'Camera3D', member: 'set_cull_mask' },
  gdscript: [
    'var c := Camera3D.new()',
    'var m := MeshInstance3D.new()',
    'm.layers = 2',
    'var drawn := (c.cull_mask & m.layers) != 0',
    'c.cull_mask = 1',
    'var hidden := (c.cull_mask & m.layers) == 0',
    'c.free()',
    'm.free()',
    'return [drawn, hidden]',
  ].join('\n'),
  target: () => {
    const camera = C.construct();
    const mesh = new Mesh();
    mesh.layers.mask = 2;
    const drawn = mesh.layers.test(camera.layers);
    C.set_cull_mask(camera, 1);
    return [drawn, !mesh.layers.test(camera.layers)];
  },
  comparator: 'exact',
});

const CAMERA3D_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Camera3D',
  compatModule: 'lib/godot-compat/camera-3d',
  cases,
};

export default CAMERA3D_EVIDENCE;
