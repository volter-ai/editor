/**
 * CPUParticles3D: a particle system made in official Godot (added under the case's holder, then
 * frames stepped at a fixed 60 fps, the multimesh buffer read after each `process_frame` with the
 * renderer's `frame_pre_draw` emitted by hand, since the headless renderer draws nothing) and in
 * compat (the same tree driven by `scene-tree.ts`'s clock, the buffer the node last wrote). Every
 * case fixes the seed, so each particle's randomness is the same on both sides.
 */
import { Group, Scene } from 'three';
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/cpu-particles-3d';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as CU from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as SM from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-mesh';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';

const DT = 1 / 60;
type Entity = Group;

/** A property as both sides set it: the GDScript statement over `p`, and the compat call. */
interface Prop {
  readonly gd: string;
  readonly ts: (p: Entity) => void;
}

const v3 = (x: number, y: number, z: number): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
/** Integer properties, written as GDScript integers. */
const INTS = new Set(['amount', 'emission_shape', 'fixed_fps', 'seed']);
const prop = (name: string, value: number | boolean, ts: (p: Entity) => void): Prop => ({
  gd: `p.${name} = ${typeof value === 'boolean' || INTS.has(name) ? String(value) : gd(value)}`,
  ts,
});
const param = (which: number, min: number, max: number): Prop[] => [
  { gd: `p.set_param_min(${String(which)}, ${gd(min)})`, ts: (p) => P.set_param_min(p, which, min) },
  { gd: `p.set_param_max(${String(which)}, ${gd(max)})`, ts: (p) => P.set_param_max(p, which, max) },
];
const vector = (setter: 'direction' | 'gravity' | 'emission_box_extents', x: number, y: number, z: number): Prop => ({
  gd: `p.${setter} = ${v3(x, y, z)}`,
  ts: (p) => (setter === 'direction' ? P.set_direction : setter === 'gravity' ? P.set_gravity : P.set_emission_box_extents)(p, V.construct(x, y, z)),
});
const flag = (which: number, on: boolean): Prop => ({ gd: `p.set_particle_flag(${String(which)}, ${String(on)})`, ts: (p) => P.set_particle_flag(p, which, on) });
/** A curve of points `[x, y]` for a parameter. */
const curve = (which: number, points: readonly (readonly [number, number])[]): Prop => ({
  gd: [`var c${String(which)} := Curve.new()`, ...points.map(([x, y]) => `c${String(which)}.add_point(Vector2(${gd(x)}, ${gd(y)}))`), `p.set_param_curve(${String(which)}, c${String(which)})`].join('\n'),
  ts: (p) => {
    const c = CU.construct();
    for (const [x, y] of points) CU.add_point(c, V2.construct(x, y));
    P.set_param_curve(p, which, c);
  },
});
/** A gradient of `[offset, r, g, b, a]` points for the colour ramp or the initial ramp. */
const ramp = (initial: boolean, points: readonly (readonly [number, number, number, number, number])[]): Prop => ({
  gd: [
    `var g${initial ? 'i' : 'r'} := Gradient.new()`,
    `g${initial ? 'i' : 'r'}.offsets = PackedFloat32Array([${points.map((point) => gd(point[0])).join(', ')}])`,
    `g${initial ? 'i' : 'r'}.colors = PackedColorArray([${points.map(([, r, g, b, a]) => `Color(${[r, g, b, a].map(gd).join(', ')})`).join(', ')}])`,
    `p.${initial ? 'color_initial_ramp' : 'color_ramp'} = g${initial ? 'i' : 'r'}`,
  ].join('\n'),
  ts: (p) => {
    const g = G.godot_gradient_new({ offsets: points.map((point) => point[0]), colors: points.flatMap(([, r, gg, b, a]) => [r, gg, b, a]) });
    (initial ? P.set_color_initial_ramp : P.set_color_ramp)(p, g);
  },
});

interface Build {
  readonly props: readonly Prop[];
  /** The node's place under the holder. */
  readonly at?: readonly [number, number, number];
  readonly frames: number;
  /** Statements run after a frame's read (by frame index), as both sides make them. */
  readonly during?: Readonly<Record<number, Prop>>;
  /** Reads after the buffer each frame. */
  readonly reads?: readonly Prop[];
}

function gdscript(b: Build): string {
  const lines = ['var p := CPUParticles3D.new()', 'p.use_fixed_seed = true', 'p.seed = 12345', ...b.props.flatMap((entry) => entry.gd.split('\n'))];
  if (b.at !== undefined) lines.push(`p.position = ${v3(...b.at)}`);
  lines.push('holder.add_child(p)', 'var out := []', `for i in ${String(b.frames)}:`, '\tawait process_frame', '\tRenderingServer.emit_signal("frame_pre_draw")');
  lines.push('\tout.append(Array(RenderingServer.multimesh_get_buffer(p.get_base())))');
  for (const read of b.reads ?? []) lines.push(`\tout.append(${read.gd})`);
  for (const [frame, act] of Object.entries(b.during ?? {})) lines.push(`\tif i == ${frame}:`, ...act.gd.split('\n').map((line) => `\t\t${line}`));
  lines.push('return out');
  return lines.join('\n');
}

function target(b: Build, readTs: readonly ((p: Entity) => unknown)[]): () => unknown {
  return () => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const out: unknown[] = [];
    let done = false;
    tree.process_frame.connect(
      () => {
        const p = new Group();
        N.godot_node_adopt(p, { kind: 'spatial', classes: ['CPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'] });
        P.godot_cpu_particles_3d_adopt(p);
        P.set_use_fixed_seed(p, true);
        P.set_seed(p, 12345);
        for (const entry of b.props) entry.ts(p);
        if (b.at !== undefined) N3.set_position(p, V.construct(...b.at));
        N.add_child(holder, p);
        let frame = 0;
        const step = (): void => {
          out.push(Array.from(P.godot_cpu_particles_3d_buffer(p)));
          for (const read of readTs) out.push(read(p));
          b.during?.[frame]?.ts(p);
          frame += 1;
          if (frame < b.frames) tree.process_frame.connect(step, { oneShot: true });
          else done = true;
        };
        tree.process_frame.connect(step, { oneShot: true });
      },
      { oneShot: true },
    );
    ST.godot_tree_frame(DT);
    for (let guard = 0; !done && guard < 1000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      ST.godot_tree_frame(DT);
    }
    return out;
  };
}

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, b: Build, readTs: readonly ((p: Entity) => unknown)[] = []): void {
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CPUParticles3D', member }, gdscript: gdscript(b), target: target(b, readTs), comparator: 'exact' });
}

// Godot's defaults: 8 particles a second from a point, no velocity, falling under gravity.
add('defaults', 'set_emitting', { props: [], frames: 70 });
add('velocity-spread', 'set_spread', {
  props: [prop('amount', 5, (p) => P.set_amount(p, 5)), prop('lifetime', 0.5, (p) => P.set_lifetime(p, 0.5)), ...param(0, 2, 4), prop('spread', 30, (p) => P.set_spread(p, 30)), prop('flatness', 0.25, (p) => P.set_flatness(p, 0.25)), vector('direction', 0, 1, 0.5)],
  at: [1, 2, -3],
  frames: 45,
});
add('sphere-damping-angle', 'set_emission_sphere_radius', {
  props: [
    prop('amount', 4, (p) => P.set_amount(p, 4)),
    prop('lifetime', 0.4, (p) => P.set_lifetime(p, 0.4)),
    prop('emission_shape', 1, (p) => P.set_emission_shape(p, 1)),
    prop('emission_sphere_radius', 1.5, (p) => P.set_emission_sphere_radius(p, 1.5)),
    ...param(0, 3, 5),
    ...param(6, 1, 4),
    ...param(1, -90, 180),
    ...param(7, 10, 45),
    ...param(8, 0.5, 2),
    flag(1, true),
  ],
  frames: 40,
});
add('sphere-surface-accelerations', 'set_emission_shape', {
  props: [
    prop('amount', 3, (p) => P.set_amount(p, 3)),
    prop('lifetime', 0.3, (p) => P.set_lifetime(p, 0.3)),
    prop('emission_shape', 2, (p) => P.set_emission_shape(p, 2)),
    ...param(0, 1, 2),
    ...param(3, 1, 3),
    ...param(4, -2, 2),
    ...param(5, 0.5, 1.5),
    vector('gravity', 0, -2, 0),
  ],
  at: [0, 1, 0],
  frames: 30,
});
add('box-explosive-local', 'set_emission_box_extents', {
  props: [
    prop('amount', 6, (p) => P.set_amount(p, 6)),
    prop('lifetime', 0.5, (p) => P.set_lifetime(p, 0.5)),
    prop('emission_shape', 3, (p) => P.set_emission_shape(p, 3)),
    vector('emission_box_extents', 2, 0.5, 1),
    prop('explosiveness', 0.8, (p) => P.set_explosiveness_ratio(p, 0.8)),
    prop('randomness', 0.5, (p) => P.set_randomness_ratio(p, 0.5)),
    prop('lifetime_randomness', 0.3, (p) => P.set_lifetime_randomness(p, 0.3)),
    prop('local_coords', true, (p) => P.set_use_local_coordinates(p, true)),
    ...param(0, 1, 1),
    flag(0, true),
  ],
  at: [2, 0, 1],
  frames: 40,
});
add('colours-and-curves', 'set_color_ramp', {
  props: [
    prop('amount', 3, (p) => P.set_amount(p, 3)),
    prop('lifetime', 0.5, (p) => P.set_lifetime(p, 0.5)),
    { gd: 'p.color = Color(0.5, 0.75, 1, 0.8)', ts: (p) => P.set_color(p, C.construct(0.5, 0.75, 1, 0.8)) },
    ramp(false, [[0, 1, 0, 0, 1], [1, 0, 0, 1, 0.5]]),
    ramp(true, [[0, 1, 1, 1, 1], [1, 0.2, 0.4, 0.6, 1]]),
    ...param(9, 0.1, 0.4),
    curve(9, [[0, 0.5], [1, 1]]),
    curve(8, [[0, 0.2], [0.5, 1], [1, 0.4]]),
    ...param(0, 1, 2),
    curve(0, [[0, 1], [1, 3]]),
  ],
  frames: 35,
});
add('initial-ramp', 'set_color_initial_ramp', { props: [prop('amount', 2, (p) => P.set_amount(p, 2)), ramp(true, [[0, 0, 1, 0, 1], [1, 1, 0, 1, 1]])], frames: 20 });
add('param-curves', 'set_param_curve', {
  props: [
    prop('amount', 3, (p) => P.set_amount(p, 3)),
    prop('lifetime', 0.4, (p) => P.set_lifetime(p, 0.4)),
    ...param(0, 1, 2),
    ...param(1, 30, 60),
    curve(1, []),
    ...param(6, 0, 2),
    curve(6, [[0, 10], [1, 50]]),
    ...param(10, 1, 2),
    curve(10, [[0, 0], [1, 100]]),
    ...param(11, 0.1, 0.3),
    curve(11, [[0, 1], [1, 0.5]]),
  ],
  frames: 30,
});
add('disable-z', 'set_particle_flag', {
  props: [prop('amount', 4, (p) => P.set_amount(p, 4)), prop('lifetime', 0.4, (p) => P.set_lifetime(p, 0.4)), flag(2, true), ...param(0, 2, 3), ...param(7, -30, 30), ...param(5, 1, 2), vector('direction', 1, 1, 0)],
  frames: 30,
});
add('disable-z-align', 'set_direction', {
  props: [prop('amount', 3, (p) => P.set_amount(p, 3)), prop('lifetime', 0.4, (p) => P.set_lifetime(p, 0.4)), flag(2, true), flag(0, true), ...param(0, 2, 3), vector('direction', 0, 1, 0)],
  frames: 25,
});
add('fixed-fps-preprocess', 'set_fixed_fps', {
  props: [
    prop('amount', 4, (p) => P.set_amount(p, 4)),
    prop('lifetime', 0.6, (p) => P.set_lifetime(p, 0.6)),
    prop('fixed_fps', 24, (p) => P.set_fixed_fps(p, 24)),
    prop('preprocess', 0.3, (p) => P.set_pre_process_time(p, 0.3)),
    prop('speed_scale', 1.5, (p) => P.set_speed_scale(p, 1.5)),
    ...param(0, 1, 2),
  ],
  frames: 30,
});
add('whole-frames', 'set_fractional_delta', { props: [prop('amount', 3, (p) => P.set_amount(p, 3)), prop('fract_delta', false, (p) => P.set_fractional_delta(p, false)), ...param(0, 1, 2)], frames: 30 });
add('one-shot', 'set_one_shot', {
  props: [prop('amount', 3, (p) => P.set_amount(p, 3)), prop('lifetime', 0.25, (p) => P.set_lifetime(p, 0.25)), prop('one_shot', true, (p) => P.set_one_shot(p, true)), ...param(0, 1, 2)],
  frames: 40,
  reads: [{ gd: 'p.emitting', ts: () => undefined }],
}, [(p) => P.is_emitting(p)]);
add('stopped-and-restarted', 'restart', {
  props: [prop('amount', 3, (p) => P.set_amount(p, 3)), prop('lifetime', 0.3, (p) => P.set_lifetime(p, 0.3)), ...param(0, 1, 2)],
  frames: 50,
  during: { 10: { gd: 'p.emitting = false', ts: (p) => P.set_emitting(p, false) }, 35: { gd: 'p.restart()', ts: (p) => P.restart(p) } },
});
add('emitting-read', 'is_emitting', {
  props: [prop('emitting', false, (p) => P.set_emitting(p, false))],
  frames: 3,
  reads: [{ gd: 'p.is_emitting()', ts: () => undefined }],
}, [(p) => P.is_emitting(p)]);
add('amount', 'set_amount', { props: [prop('amount', 2, (p) => P.set_amount(p, 2)), prop('amount', 0, (p) => P.set_amount(p, 0))], frames: 2, reads: [{ gd: 'p.amount', ts: () => undefined }] }, [(p) => P.get_amount(p)]);
add('amount-read', 'get_amount', { props: [prop('amount', 3, (p) => P.set_amount(p, 3))], frames: 1, reads: [{ gd: 'p.get_amount()', ts: () => undefined }] }, [(p) => P.get_amount(p)]);
add('lifetime', 'set_lifetime', { props: [prop('lifetime', 0.2, (p) => P.set_lifetime(p, 0.2)), prop('lifetime', -1, (p) => P.set_lifetime(p, -1)), ...param(0, 1, 1)], frames: 20 });
add('preprocess', 'set_pre_process_time', { props: [prop('preprocess', 0.5, (p) => P.set_pre_process_time(p, 0.5)), ...param(0, 1, 2)], frames: 4 });
add('explosiveness', 'set_explosiveness_ratio', { props: [prop('amount', 4, (p) => P.set_amount(p, 4)), prop('explosiveness', 1, (p) => P.set_explosiveness_ratio(p, 1)), ...param(0, 1, 2)], frames: 20 });
add('randomness', 'set_randomness_ratio', { props: [prop('amount', 4, (p) => P.set_amount(p, 4)), prop('randomness', 1, (p) => P.set_randomness_ratio(p, 1))], frames: 70 });
add('lifetime-randomness', 'set_lifetime_randomness', { props: [prop('amount', 4, (p) => P.set_amount(p, 4)), prop('lifetime_randomness', 0.9, (p) => P.set_lifetime_randomness(p, 0.9))], frames: 70 });
add('local-coordinates', 'set_use_local_coordinates', { props: [prop('local_coords', true, (p) => P.set_use_local_coordinates(p, true)), ...param(0, 1, 2)], at: [3, 0, 0], frames: 20 });
add('speed-scale', 'set_speed_scale', { props: [prop('speed_scale', 3, (p) => P.set_speed_scale(p, 3)), ...param(0, 1, 2)], frames: 20 });
add('visibility-aabb', 'set_visibility_aabb', { props: [{ gd: 'p.visibility_aabb = AABB(Vector3(-1, -1, -1), Vector3(2, 2, 2))', ts: (p) => P.set_visibility_aabb(p, null) }], frames: 3 });
add('mesh', 'set_mesh', { props: [{ gd: 'p.mesh = SphereMesh.new()', ts: (p) => P.set_mesh(p, SM.construct()) }, ...param(0, 1, 2)], frames: 5 });
add('flatness', 'set_flatness', { props: [prop('flatness', 1, (p) => P.set_flatness(p, 1)), ...param(0, 1, 2)], frames: 20 });
add('param-min', 'set_param_min', { props: [...param(0, 1, 2), { gd: 'p.set_param_min(0, 5)', ts: (p) => P.set_param_min(p, 0, 5) }], frames: 2, reads: [{ gd: '[p.get_param_min(0), p.get_param_max(0)]', ts: () => undefined }] }, [(p) => [P.get_param_min(p, 0), P.get_param_max(p, 0)]]);
add('param-max', 'set_param_max', { props: [...param(8, 1, 2), { gd: 'p.set_param_max(8, 0.5)', ts: (p) => P.set_param_max(p, 8, 0.5) }], frames: 2, reads: [{ gd: '[p.get_param_min(8), p.get_param_max(8)]', ts: () => undefined }] }, [(p) => [P.get_param_min(p, 8), P.get_param_max(p, 8)]]);
add('param-min-read', 'get_param_min', { props: param(7, -10, 20), frames: 1, reads: [{ gd: 'p.get_param_min(7)', ts: () => undefined }] }, [(p) => P.get_param_min(p, 7)]);
add('param-max-read', 'get_param_max', { props: param(7, -10, 20), frames: 1, reads: [{ gd: 'p.get_param_max(7)', ts: () => undefined }] }, [(p) => P.get_param_max(p, 7)]);
add('color', 'set_color', { props: [{ gd: 'p.color = Color(0.25, 0.5, 0.75, 0.5)', ts: (p) => P.set_color(p, C.construct(0.25, 0.5, 0.75, 0.5)) }], frames: 5 });
add('gravity', 'set_gravity', { props: [vector('gravity', 1, 0, -2), ...param(0, 1, 2)], frames: 20 });
add('fixed-seed', 'set_use_fixed_seed', { props: [prop('one_shot', true, (p) => P.set_one_shot(p, true)), prop('amount', 2, (p) => P.set_amount(p, 2))], frames: 3, during: { 1: { gd: 'p.restart()', ts: (p) => P.restart(p) } } });
add('seed', 'set_seed', { props: [prop('seed', 99, (p) => P.set_seed(p, 99)), ...param(0, 1, 2)], frames: 20, reads: [{ gd: 'p.seed', ts: () => undefined }] }, [(p) => P.get_seed(p)]);
add('seed-read', 'get_seed', { props: [prop('seed', 4000000000, (p) => P.set_seed(p, 4000000000))], frames: 1, reads: [{ gd: 'p.get_seed()', ts: () => undefined }] }, [(p) => P.get_seed(p)]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'CPUParticles3D',
  compatModule: 'lib/godot-compat/cpu-particles-3d',
  cases,
};
export default EVIDENCE;
