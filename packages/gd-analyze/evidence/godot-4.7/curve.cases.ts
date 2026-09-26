import * as K from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('Curve');
// The platformer's particle scale curve (`_data`), and a curve with tangents and linear modes.
type Entry = readonly [number, number, number, number, number, number];
const SCALE: readonly Entry[] = [
  [0, 0, 0, 0, 0, 0],
  [0.101562, 1, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0],
];
const SHAPED: readonly Entry[] = [
  [0, 0.2, 0, 1.5, 0, 0],
  [0.4, 0.9, -0.5, 0.25, 1, 1],
  [0.75, 0.35, 2, -3, 0, 1],
  [1, 0.6, 0.5, 0, 0, 0],
];
const gdData = (entries: readonly Entry[]) => `[${entries.map(([x, y, l, r, lm, rm]) => `Vector2(${gd(x)}, ${gd(y)}), ${gd(l)}, ${gd(r)}, ${String(lm)}, ${String(rm)}`).join(', ')}]`;
const tsData = (entries: readonly Entry[]) => entries.flatMap(([x, y, l, r, lm, rm]) => [V.construct(x, y), l, r, lm, rm]);
const SAMPLES = [-0.25, 0, 0.05, 0.101562, 0.2, 0.33, 0.5, 0.61, 0.75, 0.9, 1, 1.3];
for (const [name, entries] of [['scale', SCALE], ['shaped', SHAPED]] as const) {
  const build = ['var k := Curve.new()', `k._data = ${gdData(entries)}`, `k.point_count = ${String(entries.length)}`];
  const made = () => {
    const k = K.construct();
    K._set_data(k, tsData(entries));
    K.set_point_count(k, entries.length);
    return k;
  };
  c.add(`sample-${name}`, 'sample', [...build, `return [${SAMPLES.map((s) => `k.sample(${gd(s)})`).join(', ')}]`], () => SAMPLES.map((s) => K.sample(made(), s)));
  c.add(`sample-baked-${name}`, 'sample_baked', [...build, `return [${SAMPLES.map((s) => `k.sample_baked(${gd(s)})`).join(', ')}]`], () => {
    const k = made();
    return SAMPLES.map((s) => K.sample_baked(k, s));
  });
  c.add(`set-data-${name}`, '_set_data', [...build, `return [${entries.map((_, i) => `k.get_point_position(${String(i)})`).join(', ')}]`], () => {
    const k = made();
    return entries.map((_, i) => K.get_point_position(k, i));
  });
}
c.add('get_point_count', 'get_point_count', ['var k := Curve.new()', `k._data = ${gdData(SHAPED)}`, 'return k.get_point_count()'], () => {
  const k = K.construct();
  K._set_data(k, tsData(SHAPED));
  return K.get_point_count(k);
});
c.add('get_point_position', 'get_point_position', ['var k := Curve.new()', 'k.add_point(Vector2(0.3, 0.4))', 'return [k.get_point_position(0), k.get_point_position(3)]'], () => {
  const k = K.construct();
  K.add_point(k, V.construct(0.3, 0.4));
  return [K.get_point_position(k, 0), K.get_point_position(k, 3)];
});
// Points added out of order, clamped to the ranges, with linear tangents following their neighbours.
c.add('add-point-order', 'add_point', [
  'var k := Curve.new()',
  'var a := k.add_point(Vector2(0.8, 0.5), 0.0, 0.0, 1, 1)',
  'var b := k.add_point(Vector2(0.2, 1.7), 0.0, 0.0, 1, 1)',
  'var d := k.add_point(Vector2(0.5, 0.25))',
  'var e := k.add_point(Vector2(-3.0, -1.0))',
  'return [a, b, d, e, k.get_point_count(), k.get_point_position(0), k.get_point_position(1), k.get_point_position(2), k.get_point_position(3), k.sample(0.35), k.sample(0.65), k.sample(0.9)]',
], () => {
  const k = K.construct();
  const a = K.add_point(k, V.construct(0.8, 0.5), 0, 0, 1, 1);
  const b = K.add_point(k, V.construct(0.2, 1.7), 0, 0, 1, 1);
  const d = K.add_point(k, V.construct(0.5, 0.25));
  const e = K.add_point(k, V.construct(-3, -1));
  return [a, b, d, e, K.get_point_count(k), ...[0, 1, 2, 3].map((i) => K.get_point_position(k, i)), K.sample(k, 0.35), K.sample(k, 0.65), K.sample(k, 0.9)];
});
c.add('set-point-count-grows', 'set_point_count', ['var k := Curve.new()', 'k.point_count = 3', 'return [k.get_point_count(), k.get_point_position(0), k.get_point_position(1), k.get_point_position(2)]'], () => {
  const k = K.construct();
  K.set_point_count(k, 3);
  return [K.get_point_count(k), ...[0, 1, 2].map((i) => K.get_point_position(k, i))];
});
c.add('bake', 'bake', ['var k := Curve.new()', `k._data = ${gdData(SHAPED)}`, 'k.bake_resolution = 7', 'k.bake()', 'return [k.sample_baked(0.3), k.sample_baked(0.8), k.get_bake_resolution()]'], () => {
  const k = K.construct();
  K._set_data(k, tsData(SHAPED));
  K.set_bake_resolution(k, 7);
  K.bake(k);
  return [K.sample_baked(k, 0.3), K.sample_baked(k, 0.8), K.get_bake_resolution(k)];
});
for (const member of ['set_bake_resolution', 'get_bake_resolution'] as const) {
  c.add(member, member, ['var k := Curve.new()', 'k.bake_resolution = 12', 'return k.get_bake_resolution()'], () => {
    const k = K.construct();
    K.set_bake_resolution(k, 12);
    return K.get_bake_resolution(k);
  });
}
for (const [member, gdSet, set] of [
  ['set_min_value', 'k.min_value = -2.0', (k: K.Curve) => K.set_min_value(k, -2)],
  ['set_max_value', 'k.max_value = 3.5', (k: K.Curve) => K.set_max_value(k, 3.5)],
  ['get_min_value', 'k.max_value = 0.004', (k: K.Curve) => K.set_max_value(k, 0.004)],
  ['get_max_value', 'k.min_value = 0.995', (k: K.Curve) => K.set_min_value(k, 0.995)],
] as const) {
  c.add(member, member, ['var k := Curve.new()', gdSet, 'return [k.get_min_value(), k.get_max_value()]'], () => {
    const k = K.construct();
    set(k);
    return [K.get_min_value(k), K.get_max_value(k)];
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Curve', compatModule: 'lib/godot-compat/curve', cases: c.cases };
export default EVIDENCE;
