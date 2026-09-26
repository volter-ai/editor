import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/global-scope';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd, gs } from './literals';

/** A number's text, keeping the sign of -0. */
const idn = (value: number): string => (Object.is(value, -0) ? '-0' : `${value}`);

const c = caseCollector('@GlobalScope');
const u = c.utility;

const REALS = [0, -0, 0.5, -0.5, 1, -1, 2.5, -2.5, 0.1, 1e-300, 3.141592653589793, 100, -1e10, 1e300, 0.49999999999999994, Infinity, -Infinity, Number.NaN];
const INTS = [0, 1, -1, 7, -42, 9007199254740991, -9007199254740991];

for (const x of REALS) {
  c.add(`abs-float-${idn(x)}`, u('abs'), `abs(${gd(x)})`, () => G.abs(x));
  c.add(`absf-${idn(x)}`, u('absf'), `absf(${gd(x)})`, () => G.absf(x));
  c.add(`sign-float-${idn(x)}`, u('sign'), `sign(${gd(x)})`, () => G.sign(x));
  c.add(`signf-${idn(x)}`, u('signf'), `signf(${gd(x)})`, () => G.signf(x));
  c.add(`round-float-${idn(x)}`, u('round'), `round(${gd(x)})`, () => G.round(x));
  c.add(`deg_to_rad-${idn(x)}`, u('deg_to_rad'), `deg_to_rad(${gd(x)})`, () => G.deg_to_rad(x));
  c.add(`log-${idn(x)}`, u('log'), `log(${gd(x)})`, () => G.log(x));
  c.add(`linear_to_db-${idn(x)}`, u('linear_to_db'), `linear_to_db(${gd(x)})`, () => G.linear_to_db(x));
}
for (const x of [1.5, 2.5, -1.5, -2.5, 0.5000000000000001, 1e16]) {
  c.add(`round-half-${idn(x)}`, u('round'), `round(${gd(x)})`, () => G.round(x));
}
// 2^52 - 0.5 is a double, but the GDScript literal 4503599627370495.5 parses to 2^52 - 1: build it.
for (const sign of [1, -1]) {
  c.add(`round-half-2p52-${idn(sign)}`, u('round'), `round(${gd(sign)} * (4503599627370495.0 + 0.5))`, () =>
    G.round(sign * (4503599627370495 + 0.5)),
  );
}
for (const x of INTS) {
  c.add(`abs-int-${idn(x)}`, u('abs'), `abs(${idn(x)})`, () => G.abs(x));
  c.add(`sign-int-${idn(x)}`, u('sign'), `sign(${idn(x)})`, () => G.sign(x));
  c.add(`round-int-${idn(x)}`, u('round'), `round(${idn(x)})`, () => G.round(x));
}
for (const [y, x] of [
  [0, 1], [1, 0], [0, -1], [-0, -1], [1, 1], [-1, -1], [0.5, -2], [3, 4], [-1e-300, -1], [Infinity, -Infinity], [1e-8, -1],
] as const) {
  c.add(`atan2-${idn(y)}-${idn(x)}`, u('atan2'), `atan2(${gd(y)}, ${gd(x)})`, () => G.atan2(y, x));
}
for (const [x, lo, hi] of [
  [5, 0, 3], [-1, 0, 3], [2, 0, 3], [0.5, 0, 1], [1.5, 0.25, 0.75], [Number.NaN, 0, 1], [3, 5, 1], [-0, 0, 1],
] as const) {
  c.add(`clampf-${idn(x)}-${idn(lo)}-${idn(hi)}`, u('clampf'), `clampf(${gd(x)}, ${gd(lo)}, ${gd(hi)})`, () => G.clampf(x, lo, hi));
  c.add(`clamp-float-${idn(x)}-${idn(lo)}-${idn(hi)}`, u('clamp'), `clamp(${gd(x)}, ${gd(lo)}, ${gd(hi)})`, () => G.clamp(x, lo, hi));
}
for (const [x, lo, hi] of [[5, 0, 3], [-1, 0, 3], [2, 0, 3], [3, 5, 1]] as const) {
  c.add(`clamp-int-${idn(x)}-${idn(lo)}-${idn(hi)}`, u('clamp'), `clamp(${idn(x)}, ${idn(lo)}, ${idn(hi)})`, () => G.clamp(x, lo, hi));
}
c.add('clamp-mixed', u('clamp'), 'clamp(5, 0.5, 3)', () => G.clamp(5, 0.5, 3));
for (const [a, b, w] of [
  [0, 10, 0.5], [0, 10, 0.1], [-3.5, 2.25, 0.75], [1, 2, 1.5], [1, 2, -0.5], [1e300, -1e300, 0.5], [0.1, 0.2, 0.3],
] as const) {
  c.add(`lerpf-${idn(a)}-${idn(b)}-${idn(w)}`, u('lerpf'), `lerpf(${gd(a)}, ${gd(b)}, ${gd(w)})`, () => G.lerpf(a, b, w));
  c.add(`lerp-float-${idn(a)}-${idn(b)}-${idn(w)}`, u('lerp'), `lerp(${gd(a)}, ${gd(b)}, ${gd(w)})`, () => G.lerp(a, b, w));
}
c.add('lerp-int', u('lerp'), 'lerp(1, 4, 0.5)', () => G.lerp(1, 4, 0.5));
for (const [a, b, w] of [
  [0, 3, 0.5], [3, 0, 0.5], [0.1, 6.2, 0.5], [-3, 3, 0.25], [10, -10, 0.1], [0, 3.141592653589793, 0.5], [1, 1, 0.5], [0, 100, 1],
] as const) {
  c.add(`lerp_angle-${idn(a)}-${idn(b)}-${idn(w)}`, u('lerp_angle'), `lerp_angle(${gd(a)}, ${gd(b)}, ${gd(w)})`, () =>
    G.lerp_angle(a, b, w),
  );
}
for (const [v, i0, i1, o0, o1] of [
  [5, 0, 10, 0, 100], [0.3, 0, 1, -1, 1], [2, 1, 1, 0, 1], [15, 0, 10, 100, 200], [0.1, 0.2, 0.7, 3, 9],
] as const) {
  c.add(`remap-${idn(v)}-${idn(i0)}-${idn(i1)}`, u('remap'), `remap(${gd(v)}, ${gd(i0)}, ${gd(i1)}, ${gd(o0)}, ${gd(o1)})`, () =>
    G.remap(v, i0, i1, o0, o1),
  );
}
for (const args of [[1, 2], [2, 1], [1.5, -3, 7.25], [-0, 0], [0, -0], [Number.NaN, 1], [1, Number.NaN], [3, 3, 3]] as const) {
  const text = args.map(gd).join(', ');
  c.add(`max-float-${text}`, u('max'), `max(${text})`, () => G.max(...args));
  c.add(`min-float-${text}`, u('min'), `min(${text})`, () => G.min(...args));
}
c.add('max-int', u('max'), 'max(3, -7, 12)', () => G.max(3, -7, 12));
c.add('min-int', u('min'), 'min(3, -7, 12)', () => G.min(3, -7, 12));
c.add('max-mixed', u('max'), 'max(1, 2.5)', () => G.max(1, 2.5));
c.add('min-mixed', u('min'), 'min(1, 0.5)', () => G.min(1, 0.5));
for (const [x, y] of [[1, 2], [2, 1], [-0, 0], [0, -0], [Number.NaN, 1], [1, Number.NaN]] as const) {
  c.add(`minf-${idn(x)}-${idn(y)}`, u('minf'), `minf(${gd(x)}, ${gd(y)})`, () => G.minf(x, y));
}
for (const [x, lo, hi] of [
  [5.5, 0, 3], [-1.25, 0, 3], [3, 0, 3], [0.5, 0, 1e-6], [-7, -2, 5], [2.9999999, 0, 3], [1, 2, 2], [370, 0, 360],
] as const) {
  c.add(`wrap-float-${idn(x)}-${idn(lo)}-${idn(hi)}`, u('wrap'), `wrap(${gd(x)}, ${gd(lo)}, ${gd(hi)})`, () => G.wrap(x, lo, hi));
}
for (const [x, lo, hi] of [[5, 0, 3], [-1, 0, 3], [3, 0, 3], [-7, -2, 5], [1, 2, 2], [370, 0, 360], [10, 5, 0]] as const) {
  c.add(`wrap-int-${idn(x)}-${idn(lo)}-${idn(hi)}`, u('wrap'), `wrap(${idn(x)}, ${idn(lo)}, ${idn(hi)})`, () => G.wrap(x, lo, hi));
}

// The global generator: every case seeds first, on both sides.
for (const s of [0, 1, 42, -1, 12345678901, -9007199254740991]) {
  c.add(`randi-sequence-${idn(s)}`, u('randi'), `seed(${idn(s)})\nreturn [randi(), randi(), randi(), randi()]`, () => {
    G.seed(s);
    return [G.randi(), G.randi(), G.randi(), G.randi()];
  });
  c.add(`seed-${idn(s)}`, u('seed'), `seed(${idn(s)})\nreturn randi()`, () => {
    G.seed(s);
    return G.randi();
  });
  for (const [from, to] of [[0, 1], [0.5, 2.5], [-10, 10], [5, -5], [0, 1e-300]] as const) {
    c.add(`randf_range-${idn(s)}-${idn(from)}-${idn(to)}`, u('randf_range'), `seed(${idn(s)})\nreturn [randf_range(${gd(from)}, ${gd(to)}), randf_range(${gd(from)}, ${gd(to)}), randf_range(${gd(from)}, ${gd(to)})]`, () => {
      G.seed(s);
      return [G.randf_range(from, to), G.randf_range(from, to), G.randf_range(from, to)];
    });
  }
  for (const [from, to] of [[0, 10], [10, 0], [-5, 5], [3, 3], [0, 1], [-2147483648, 2147483647], [0, 4294967296], [0, 3000000000]] as const) {
    c.add(`randi_range-${idn(s)}-${idn(from)}-${idn(to)}`, u('randi_range'), `seed(${idn(s)})\nreturn [randi_range(${idn(from)}, ${idn(to)}), randi_range(${idn(from)}, ${idn(to)}), randi_range(${idn(from)}, ${idn(to)})]`, () => {
      G.seed(s);
      return [G.randi_range(from, to), G.randi_range(from, to), G.randi_range(from, to)];
    });
  }
}
c.add('randomize-then-seed', u('randomize'), 'randomize()\nseed(7)\nreturn randi()', () => {
  G.randomize();
  G.seed(7);
  return G.randi();
});

class ScriptObject {}
for (const [name, gdValue, jsValue] of [
  ['null', 'null', () => null],
  ['int', '1', () => 1],
  ['string', '"s"', () => 's'],
  ['array', '[]', () => []],
  ['dictionary', '{}', () => new Map()],
  ['vector2', 'Vector2(1.0, 2.0)', () => V.construct(1, 2)],
  ['callable', 'func(): pass', () => () => undefined],
  ['object', 'RefCounted.new()', () => new ScriptObject()],
] as const) {
  c.add(`is_instance_valid-${name}`, u('is_instance_valid'), `is_instance_valid(${gdValue})`, () => G.is_instance_valid(jsValue()));
}
for (const args of [['a'], ['a', 'b', ''], [true, false], [null], ['x', null, true], ['😀', 'é']] as const) {
  const text = args.map((value) => (typeof value === 'string' ? gs(value) : `${value}`)).join(', ');
  c.add(`str-${text}`, u('str'), `str(${text})`, () => G.str(...args));
}

const GLOBAL_SCOPE_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: '@GlobalScope',
  compatModule: 'lib/godot-compat/global-scope',
  cases: c.cases,
};

export default GLOBAL_SCOPE_EVIDENCE;
