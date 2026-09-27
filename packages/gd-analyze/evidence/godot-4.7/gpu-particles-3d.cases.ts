/**
 * GPUParticles3D: the node's state as its setters leave it and its getters read it, on a node added
 * under the case's holder, from the constructor's defaults on. Setters that fail past a bound (an
 * amount below 1, a lifetime not above 0, a draw pass count below 1, a pass outside the draw
 * passes) are driven at and past it; ratios Godot does not clamp are driven past 0 and 1; `real_t`
 * members (32-bit) and `double` ones are set to values that tell them apart; the seed is a
 * `uint32_t`.
 *
 * Headless Godot keeps the node's state but cannot simulate GPU particles (its particle storage is
 * the dummy one), so nothing here steps the system or reads its particles: the simulation and
 * `capture_aabb` are the windowed proof's (`src/evidence/proofs/scene-gpu-particles.ts`).
 */
import { Group, Scene } from 'three';
import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/aabb';
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/gpu-particles-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/particle-process-material';
import * as QM from '../../capabilities/catalog/project-source/src/lib/godot-compat/quad-mesh';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as SM from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-mesh';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { signalCase } from './native-signal-case';

const CLASSES = ['GPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'];

/** A GPUParticles3D entity as the element mounts it (the Node protocol's adoption, then the node's). */
function made(): Group {
  const p = new Group();
  N.godot_node_adopt(p, { kind: 'spatial', classes: CLASSES });
  P.godot_gpu_particles_3d_adopt(p);
  return p;
}

const cases: GodotEvidenceCase[] = [];
/** A case over `p`, a new GPUParticles3D under the holder: its GDScript lines, and the same through compat. */
function add(id: string, member: string, lines: readonly string[], ts: (p: Group) => unknown): void {
  cases.push({
    id,
    symbol: { kind: 'native-member', owner: 'GPUParticles3D', member },
    gdscript: ['var p := GPUParticles3D.new()', 'holder.add_child(p)', ...lines].join('\n'),
    target: () => {
      const root = new Scene();
      ST.godot_tree_set_root(root);
      const holder = new Group();
      N.godot_node_adopt(holder, { kind: 'node' });
      N.add_child(root, holder);
      const p = made();
      N.add_child(holder, p);
      return ts(p);
    },
    comparator: 'exact',
  });
}

/**
 * A setter over `values`, each set then read back through its getter; and the getter's default on
 * a new node (unless `getDefault` is false: the default seed is random).
 */
function property<T>(
  name: string,
  getter: string,
  get: (p: Group) => unknown,
  set: (p: Group, value: T) => void,
  values: readonly T[],
  literal: (value: T) => string,
  getDefault = true,
): void {
  add(`set_${name}`, `set_${name}`, ['var out := []', ...values.flatMap((value) => [`p.set_${name}(${literal(value)})`, `out.append(p.${getter}())`]), 'return out'], (p) =>
    values.map((value) => {
      set(p, value);
      return get(p);
    }),
  );
  if (getDefault) add(getter, getter, [`return p.${getter}()`], get);
}
const int = (value: number): string => String(value);
const bool = (value: boolean): string => String(value);

// The amount: 1 and above are taken; 0 and below fail and leave it.
property('amount', 'get_amount', P.get_amount, P.set_amount, [5, 0, -3, 1, 100000, 8], int);
// The lifetime (`double`): above 0 is taken; 0 and below fail and leave it.
property('lifetime', 'get_lifetime', P.get_lifetime, P.set_lifetime, [2.5, 0, -1, 1e-9, 0.1, 1e40], gd);
property('one_shot', 'get_one_shot', P.get_one_shot, P.set_one_shot, [true, false, true], bool);
property('use_fixed_seed', 'get_use_fixed_seed', P.get_use_fixed_seed, P.set_use_fixed_seed, [true, true, false], bool);
// The seed is a `uint32_t`: -1 wraps to 4294967295, 2^32 + 7 to 7.
property('seed', 'get_seed', P.get_seed, P.set_seed, [99, 4294967295, -1, 4294967303, 0], int, false);
add('get_seed', 'get_seed', ['p.seed = 12345', 'return p.get_seed()'], (p) => {
  P.set_seed(p, 12345);
  return P.get_seed(p);
});
// `double` members: kept as given.
const DOUBLES = [0.1, -2, 1e40, 0];
property('pre_process_time', 'get_pre_process_time', P.get_pre_process_time, P.set_pre_process_time, DOUBLES, gd);
property('speed_scale', 'get_speed_scale', P.get_speed_scale, P.set_speed_scale, [...DOUBLES, 1], gd);
// `real_t` and `float` ratios: stored as 32-bit and not clamped (the 0 to 1 range is only the editor's hint).
const RATIOS = [0.1, 1.5, -0.5, 1e40, 1];
property('explosiveness_ratio', 'get_explosiveness_ratio', P.get_explosiveness_ratio, P.set_explosiveness_ratio, RATIOS, gd);
property('randomness_ratio', 'get_randomness_ratio', P.get_randomness_ratio, P.set_randomness_ratio, RATIOS, gd);
property('amount_ratio', 'get_amount_ratio', P.get_amount_ratio, P.set_amount_ratio, RATIOS, gd);
property('use_local_coordinates', 'get_use_local_coordinates', P.get_use_local_coordinates, P.set_use_local_coordinates, [true, false], bool);
property('fixed_fps', 'get_fixed_fps', P.get_fixed_fps, P.set_fixed_fps, [60, 0, -5, 24], int);
property('fractional_delta', 'get_fractional_delta', P.get_fractional_delta, P.set_fractional_delta, [false, true], bool);
property('interpolate', 'get_interpolate', P.get_interpolate, P.set_interpolate, [false, true], bool);
// The draw order: index, lifetime, reverse lifetime (view depth needs the camera's sort, which
// compat refuses by name).
property('draw_order', 'get_draw_order', P.get_draw_order, P.set_draw_order, [1, 2, 0], int);
property('transform_align', 'get_transform_align', P.get_transform_align, P.set_transform_align, [1, 2, 3, 4, 0], int);

// The visibility AABB, stored as given (a negative size too), 32-bit.
type Box = readonly [number, number, number, number, number, number];
const box = ([x, y, z, w, h, d]: Box) => A.construct(V.construct(x, y, z), V.construct(w, h, d));
property<Box>('visibility_aabb', 'get_visibility_aabb', P.get_visibility_aabb, (p, b) => P.set_visibility_aabb(p, box(b)), [[-1.1, -2, -3, 2.2, 4, 6], [0.1, 0, 0, -1, -2, 0.3]], ([x, y, z, w, h, d]) => `AABB(Vector3(${gd(x)}, ${gd(y)}, ${gd(z)}), Vector3(${gd(w)}, ${gd(h)}, ${gd(d)}))`);

// The emitting flag: on from the constructor; off; a one-shot system started again.
add('set_emitting', 'set_emitting', ['var out := [p.emitting]', 'p.emitting = false', 'out.append(p.emitting)', 'p.use_fixed_seed = true', 'p.one_shot = true', 'p.emitting = true', 'out.append(p.emitting)', 'p.emitting = true', 'out.append(p.emitting)', 'p.emitting = false', 'out.append([p.emitting, p.one_shot])', 'return out'], (p) => {
  const out: unknown[] = [P.is_emitting(p)];
  P.set_emitting(p, false);
  out.push(P.is_emitting(p));
  P.set_use_fixed_seed(p, true);
  P.set_one_shot(p, true);
  P.set_emitting(p, true);
  out.push(P.is_emitting(p));
  P.set_emitting(p, true);
  out.push(P.is_emitting(p));
  P.set_emitting(p, false);
  out.push([P.is_emitting(p), P.get_one_shot(p)]);
  return out;
});
add('is_emitting', 'is_emitting', ['return p.is_emitting()'], P.is_emitting);

// The process material: the one set is the one read back; null clears it.
add('set_process_material', 'set_process_material', ['var m := ParticleProcessMaterial.new()', 'p.process_material = m', 'var same := p.get_process_material() == m', 'p.process_material = null', 'return [same, p.get_process_material() == null]'], (p) => {
  const m = M.construct();
  P.set_process_material(p, m);
  const same = P.get_process_material(p) === m;
  P.set_process_material(p, null);
  return [same, P.get_process_material(p) === null];
});
add('get_process_material', 'get_process_material', ['return p.get_process_material() == null'], (p) => P.get_process_material(p) === null);

// The draw passes: one from the constructor; a pass outside them fails and reads none; a smaller
// count clears the passes past it, and passes a larger count adds have none.
add('set_draw_pass_mesh', 'set_draw_pass_mesh', [
  'var m := SphereMesh.new()',
  'var q := QuadMesh.new()',
  'p.set_draw_pass_mesh(0, m)',
  'var out := [p.get_draw_pass_mesh(0) == m, p.draw_pass_1 == m]',
  'p.set_draw_pass_mesh(1, q)',
  'p.set_draw_pass_mesh(-1, q)',
  'out.append([p.get_draw_passes(), p.get_draw_pass_mesh(0) == m, p.get_draw_pass_mesh(1) == null])',
  'p.draw_pass_1 = q',
  'out.append(p.get_draw_pass_mesh(0) == q)',
  'p.set_draw_pass_mesh(0, null)',
  'out.append(p.get_draw_pass_mesh(0) == null)',
  'return out',
], (p) => {
  const m = SM.construct();
  const q = QM.construct();
  P.set_draw_pass_mesh(p, 0, m);
  const out: unknown[] = [P.get_draw_pass_mesh(p, 0) === m, P.get_draw_pass_mesh(p, 0) === m];
  P.set_draw_pass_mesh(p, 1, q);
  P.set_draw_pass_mesh(p, -1, q);
  out.push([P.get_draw_passes(p), P.get_draw_pass_mesh(p, 0) === m, P.get_draw_pass_mesh(p, 1) === null]);
  P.set_draw_pass_mesh(p, 0, q);
  out.push(P.get_draw_pass_mesh(p, 0) === q);
  P.set_draw_pass_mesh(p, 0, null);
  out.push(P.get_draw_pass_mesh(p, 0) === null);
  return out;
});
add('get_draw_pass_mesh', 'get_draw_pass_mesh', ['return [p.get_draw_pass_mesh(0) == null, p.get_draw_pass_mesh(3) == null]'], (p) => [P.get_draw_pass_mesh(p, 0) === null, P.get_draw_pass_mesh(p, 3) === null]);
const PASSES = [3, 0, -1, 2, 3, 1];
add('set_draw_passes', 'set_draw_passes', [
  'var meshes := [SphereMesh.new(), QuadMesh.new(), SphereMesh.new()]',
  'var out := []',
  ...PASSES.flatMap((count, step) => [
    `p.set_draw_passes(${String(count)})`,
    ...(step === 0 ? ['for i in 3:', '\tp.set_draw_pass_mesh(i, meshes[i])'] : []),
    'out.append([p.get_draw_passes(), p.get_draw_pass_mesh(0) == meshes[0], p.get_draw_pass_mesh(1) == meshes[1], p.get_draw_pass_mesh(2) == meshes[2], p.get_draw_pass_mesh(2) == null])',
  ]),
  'return out',
], (p) => {
  const meshes = [SM.construct(), QM.construct(), SM.construct()];
  return PASSES.map((count, step) => {
    P.set_draw_passes(p, count);
    if (step === 0) meshes.forEach((mesh, i) => P.set_draw_pass_mesh(p, i, mesh));
    return [P.get_draw_passes(p), P.get_draw_pass_mesh(p, 0) === meshes[0], P.get_draw_pass_mesh(p, 1) === meshes[1], P.get_draw_pass_mesh(p, 2) === meshes[2], P.get_draw_pass_mesh(p, 2) === null];
  });
});
add('get_draw_passes', 'get_draw_passes', ['return p.get_draw_passes()'], P.get_draw_passes);

// Restarting: emitting again, a kept or fixed seed kept.
add('restart', 'restart', [
  'p.one_shot = true',
  'p.use_fixed_seed = false',
  'p.seed = 5',
  'p.emitting = false',
  'p.restart(true)',
  'var out := [p.emitting, p.seed]',
  'p.use_fixed_seed = true',
  'p.emitting = false',
  'p.restart()',
  'out.append([p.emitting, p.seed])',
  'return out',
], (p) => {
  P.set_one_shot(p, true);
  P.set_use_fixed_seed(p, false);
  P.set_seed(p, 5);
  P.set_emitting(p, false);
  P.restart(p, true);
  const out: unknown[] = [P.is_emitting(p), P.get_seed(p)];
  P.set_use_fixed_seed(p, true);
  P.set_emitting(p, false);
  P.restart(p);
  out.push([P.is_emitting(p), P.get_seed(p)]);
  return out;
});

cases.push(signalCase({ owner: 'GPUParticles3D', member: 'finished', make: 'GPUParticles3D.new()', free: 'o.free()', args: '', signal: () => ({ signal: P.finished(made()) as never, args: [] }) }));

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'GPUParticles3D',
  compatModule: 'lib/godot-compat/gpu-particles-3d',
  cases,
};
export default EVIDENCE;
