/**
 * ParticleProcessMaterial: the values its setters store and its getters read back, from the
 * constructor's defaults on. Floats Godot keeps as `float`/`real_t` (32-bit) and the two it keeps as
 * `double` (the inherit-velocity ratio, lifetime randomness) are set to values that tell them apart;
 * each `Parameter`'s minimum and maximum keep min <= max by moving the other; each index past the
 * enums fails and leaves the state; a `CurveTexture` with no curve set on a parameter gets a flat
 * curve over the parameter's range (`_adjust_curve_range`). The material's generated shader is the
 * translation's (captured by the exporter), not measured here.
 */
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as K from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve';
import * as CT from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve-texture';
import * as GT from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient-texture-1d';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/particle-process-material';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

type Material = M.ParticleProcessMaterial;
const c = resourceCases('ParticleProcessMaterial');
const PARAM_MAX = 18;
const FLAG_MAX = 5;
const PARAMS = Array.from({ length: PARAM_MAX }, (_, i) => i);
const FLAGS = Array.from({ length: FLAG_MAX }, (_, i) => i);

const constructed = {
  id: 'new',
  symbol: { kind: 'native-constructor' as const, owner: 'ParticleProcessMaterial', member: 'ParticleProcessMaterial' },
  gdscript: [
    'var m := ParticleProcessMaterial.new()',
    `return [m.direction, m.spread, m.flatness, m.color, m.gravity, m.emission_shape, m.lifetime_randomness, ${PARAMS.map((i) => `m.get_param_min(${String(i)}), m.get_param_max(${String(i)})`).join(', ')}, ${FLAGS.map((i) => `m.get_particle_flag(${String(i)})`).join(', ')}]`,
  ].join('\n'),
  target: () => {
    const m = M.construct();
    return [M.get_direction(m), M.get_spread(m), M.get_flatness(m), M.get_color(m), M.get_gravity(m), M.get_emission_shape(m), M.get_lifetime_randomness(m), ...PARAMS.flatMap((i) => [M.get_param_min(m, i), M.get_param_max(m, i)]), ...FLAGS.map((i) => M.get_particle_flag(m, i))];
  },
  comparator: 'exact' as const,
};
c.cases.push(constructed);

/** A value as both sides write it. */
interface Value {
  readonly gd: string;
  readonly ts: () => unknown;
}
const num = (value: number): Value => ({ gd: gd(value), ts: () => value });
const vec = (x: number, y: number, z: number): Value => ({ gd: `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`, ts: () => V.construct(x, y, z) });

/**
 * A property's case pair: its setter over `values` (each set then read back), and its getter's
 * default on a new material.
 */
function property(name: string, get: (m: Material) => unknown, set: (m: Material, value: never) => void, values: readonly Value[]): void {
  c.add(`set_${name}`, `set_${name}`, ['var m := ParticleProcessMaterial.new()', 'var out := []', ...values.flatMap((value) => [`m.set_${name}(${value.gd})`, `out.append(m.get_${name}())`]), 'return out'], () => {
    const m = M.construct();
    return values.map((value) => {
      set(m, value.ts() as never);
      return get(m);
    });
  });
  c.add(`get_${name}`, `get_${name}`, ['var m := ParticleProcessMaterial.new()', `return m.get_${name}()`], () => get(M.construct()));
}

// `float`/`real_t` members: stored as 32-bit (0.1 rounds, 1e40 overflows to INF).
const FLOATS = [num(0.1), num(-33.3), num(0), num(1e40), num(-1e-7), num(720)];
property('spread', M.get_spread, M.set_spread, FLOATS);
property('flatness', M.get_flatness, M.set_flatness, FLOATS);
property('emission_sphere_radius', M.get_emission_sphere_radius, M.set_emission_sphere_radius, FLOATS);
property('emission_ring_height', M.get_emission_ring_height, M.set_emission_ring_height, FLOATS);
property('emission_ring_radius', M.get_emission_ring_radius, M.set_emission_ring_radius, FLOATS);
property('emission_ring_inner_radius', M.get_emission_ring_inner_radius, M.set_emission_ring_inner_radius, FLOATS);
property('emission_ring_cone_angle', M.get_emission_ring_cone_angle, M.set_emission_ring_cone_angle, FLOATS);
// `double` members: stored as given.
property('inherit_velocity_ratio', M.get_inherit_velocity_ratio, M.set_inherit_velocity_ratio, FLOATS);
property('lifetime_randomness', M.get_lifetime_randomness, M.set_lifetime_randomness, FLOATS);
const VECTORS = [vec(0.1, -2.5, 3), vec(0, 0, 0), vec(1e40, -1e-7, 0.3)];
property('direction', M.get_direction, M.set_direction, VECTORS);
property('velocity_pivot', M.get_velocity_pivot, M.set_velocity_pivot, VECTORS);
property('emission_box_extents', M.get_emission_box_extents, M.set_emission_box_extents, VECTORS);
property('emission_ring_axis', M.get_emission_ring_axis, M.set_emission_ring_axis, VECTORS);
property('emission_shape_offset', M.get_emission_shape_offset, M.set_emission_shape_offset, VECTORS);
property('emission_shape_scale', M.get_emission_shape_scale, M.set_emission_shape_scale, VECTORS);
property('gravity', M.get_gravity, M.set_gravity, VECTORS);
property('color', M.get_color, M.set_color, [
  { gd: 'Color(0.1, 0.5, 0.9, 0.3)', ts: () => C.construct(0.1, 0.5, 0.9, 0.3) },
  { gd: 'Color(2, -1, 0, 1)', ts: () => C.construct(2, -1, 0, 1) },
]);
// The emission shape: 0 to 6 are taken, 7 and -1 fail and leave it.
property('emission_shape', M.get_emission_shape, M.set_emission_shape, [3, 7, 6, -1, 0, 1].map((shape) => ({ gd: String(shape), ts: () => shape })));

// The textures: the one set is the one read back, and null clears it.
const TEXTURES: readonly [string, (m: Material) => object | null, (m: Material, texture: unknown) => void, 'curve' | 'gradient'][] = [
  ['color_ramp', M.get_color_ramp, M.set_color_ramp, 'gradient'],
  ['color_initial_ramp', M.get_color_initial_ramp, M.set_color_initial_ramp, 'gradient'],
  ['alpha_curve', M.get_alpha_curve, M.set_alpha_curve, 'curve'],
  ['emission_curve', M.get_emission_curve, M.set_emission_curve, 'curve'],
  ['velocity_limit_curve', M.get_velocity_limit_curve, M.set_velocity_limit_curve, 'curve'],
];
for (const [name, get, set, kind] of TEXTURES) {
  const made = kind === 'curve' ? 'CurveTexture' : 'GradientTexture1D';
  c.add(`set_${name}`, `set_${name}`, ['var m := ParticleProcessMaterial.new()', `var t := ${made}.new()`, `m.set_${name}(t)`, `var same := m.get_${name}() == t`, `m.set_${name}(null)`, `return [same, m.get_${name}() == null]`], () => {
    const m = M.construct();
    const t = kind === 'curve' ? CT.construct() : GT.construct();
    set(m, t);
    const same = get(m) === t;
    set(m, null);
    return [same, get(m) === null];
  });
  c.add(`get_${name}`, `get_${name}`, ['var m := ParticleProcessMaterial.new()', `return m.get_${name}() == null`], () => get(M.construct()) === null);
}

// Each parameter's minimum and maximum: a maximum below the minimum lowers it, a minimum above the
// maximum raises it.
for (const i of PARAMS) {
  const p = String(i);
  c.add(`param-min-max-${p}`, 'set_param_min', [
    'var m := ParticleProcessMaterial.new()',
    `m.set_param_min(${p}, 2.5)`,
    `var a := [m.get_param_min(${p}), m.get_param_max(${p})]`,
    `m.set_param_max(${p}, 0.1)`,
    `var b := [m.get_param_min(${p}), m.get_param_max(${p})]`,
    `m.set_param_min(${p}, -7.3)`,
    `m.set_param_max(${p}, 1e40)`,
    `return [a, b, m.get_param_min(${p}), m.get_param_max(${p})]`,
  ], () => {
    const m = M.construct();
    M.set_param_min(m, i, 2.5);
    const a = [M.get_param_min(m, i), M.get_param_max(m, i)];
    M.set_param_max(m, i, 0.1);
    const b = [M.get_param_min(m, i), M.get_param_max(m, i)];
    M.set_param_min(m, i, -7.3);
    M.set_param_max(m, i, 1e40);
    return [a, b, M.get_param_min(m, i), M.get_param_max(m, i)];
  });
}
c.add('param-max-lowers-min', 'set_param_max', ['var m := ParticleProcessMaterial.new()', 'm.set_param_max(8, -0.5)', 'm.set_param_max(16, 0.3)', 'return [m.get_param_min(8), m.get_param_max(8), m.get_param_min(16), m.get_param_max(16)]'], () => {
  const m = M.construct();
  M.set_param_max(m, 8, -0.5);
  M.set_param_max(m, 16, 0.3);
  return [M.get_param_min(m, 8), M.get_param_max(m, 8), M.get_param_min(m, 16), M.get_param_max(m, 16)];
});
// An index past `PARAM_MAX` fails: the setters change nothing, the getters read 0.
c.add('param-out-of-range', 'get_param_min', ['var m := ParticleProcessMaterial.new()', 'm.set_param_min(18, 5.0)', 'm.set_param_max(18, 5.0)', 'return [m.get_param_min(18), m.get_param_max(18), m.get_param_min(-1)]'], () => {
  const m = M.construct();
  M.set_param_min(m, 18, 5);
  M.set_param_max(m, 18, 5);
  return [M.get_param_min(m, 18), M.get_param_max(m, 18), M.get_param_min(m, -1)];
});
c.add('get_param_max', 'get_param_max', ['var m := ParticleProcessMaterial.new()', `return [${PARAMS.map((i) => `m.get_param_max(${String(i)})`).join(', ')}, m.get_param_max(18)]`], () => {
  const m = M.construct();
  return [...PARAMS.map((i) => M.get_param_max(m, i)), M.get_param_max(m, 18)];
});

// Each parameter's texture: an empty CurveTexture gets a flat curve over the parameter's range
// (none for the initial velocity, the animation offset, the turbulence velocity and displacement,
// the radial and directional velocities); a texture with a curve keeps it.
const curveRead = (t: string) => `[${t}.curve == null] if ${t}.curve == null else [${t}.curve.point_count, ${t}.curve.min_value, ${t}.curve.max_value, ${t}.curve.get_point_position(0), ${t}.curve.get_point_position(1)]`;
const curveReadTs = (t: CT.CurveTexture) => {
  const k = CT.get_curve(t);
  return k === null ? [true] : [K.get_point_count(k), K.get_min_value(k), K.get_max_value(k), K.get_point_position(k, 0), K.get_point_position(k, 1)];
};
for (const i of PARAMS) {
  const p = String(i);
  c.add(`param-texture-${p}`, 'set_param_texture', [
    'var m := ParticleProcessMaterial.new()',
    'var t := CurveTexture.new()',
    `m.set_param_texture(${p}, t)`,
    'var own := Curve.new()',
    'own.add_point(Vector2(0, 0.25))',
    'own.add_point(Vector2(1, 0.75))',
    'var u := CurveTexture.new()',
    'u.curve = own',
    `m.set_param_texture(${p}, u)`,
    `var same := m.get_param_texture(${p}) == u`,
    `m.set_param_texture(${p}, null)`,
    `return [${curveRead('t')}, ${curveRead('u')}, u.curve == own, same, m.get_param_texture(${p}) == null]`,
  ], () => {
    const m = M.construct();
    const t = CT.construct();
    M.set_param_texture(m, i, t);
    const own = K.construct();
    K.add_point(own, V2.construct(0, 0.25));
    K.add_point(own, V2.construct(1, 0.75));
    const u = CT.construct();
    CT.set_curve(u, own);
    M.set_param_texture(m, i, u);
    const same = M.get_param_texture(m, i) === u;
    M.set_param_texture(m, i, null);
    return [curveReadTs(t), curveReadTs(u), CT.get_curve(u) === own, same, M.get_param_texture(m, i) === null];
  });
}
c.add('param-texture-gradient', 'set_param_texture', ['var m := ParticleProcessMaterial.new()', 'var g := GradientTexture1D.new()', 'm.set_param_texture(8, g)', 'm.set_param_texture(18, g)', 'return [m.get_param_texture(8) == g, m.get_param_texture(18) == null]'], () => {
  const m = M.construct();
  const g = GT.construct();
  M.set_param_texture(m, 8, g);
  M.set_param_texture(m, 18, g);
  return [M.get_param_texture(m, 8) === g, M.get_param_texture(m, 18) === null];
});
c.add('get_param_texture', 'get_param_texture', ['var m := ParticleProcessMaterial.new()', `return [${PARAMS.map((i) => `m.get_param_texture(${String(i)}) == null`).join(', ')}]`], () => {
  const m = M.construct();
  return PARAMS.map((i) => M.get_param_texture(m, i) === null);
});

// The particle flags: each on and off; an index past `PARTICLE_FLAG_MAX` fails and reads false.
c.add('particle-flags', 'set_particle_flag', [
  'var m := ParticleProcessMaterial.new()',
  'var out := []',
  ...FLAGS.flatMap((i) => [`m.set_particle_flag(${String(i)}, true)`, `out.append([${FLAGS.map((j) => `m.get_particle_flag(${String(j)})`).join(', ')}])`]),
  'm.set_particle_flag(2, false)',
  'm.set_particle_flag(5, true)',
  `out.append([${FLAGS.map((j) => `m.get_particle_flag(${String(j)})`).join(', ')}, m.get_particle_flag(5)])`,
  'return out',
], () => {
  const m = M.construct();
  const out: unknown[] = [];
  for (const i of FLAGS) {
    M.set_particle_flag(m, i, true);
    out.push(FLAGS.map((j) => M.get_particle_flag(m, j)));
  }
  M.set_particle_flag(m, 2, false);
  M.set_particle_flag(m, 5, true);
  out.push([...FLAGS.map((j) => M.get_particle_flag(m, j)), M.get_particle_flag(m, 5)]);
  return out;
});
c.add('get_particle_flag', 'get_particle_flag', ['var m := ParticleProcessMaterial.new()', `return [${FLAGS.map((i) => `m.get_particle_flag(${String(i)})`).join(', ')}, m.get_particle_flag(-1)]`], () => {
  const m = M.construct();
  return [...FLAGS.map((i) => M.get_particle_flag(m, i)), M.get_particle_flag(m, -1)];
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ParticleProcessMaterial', compatModule: 'lib/godot-compat/particle-process-material', cases: c.cases };
export default EVIDENCE;
