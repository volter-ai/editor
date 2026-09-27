/**
 * RandomNumberGenerator: a seeded generator's sequences (randi, randf, randf_range, randi_range)
 * and seed read back, and a new one's (clock-seeded, so only that it yields values in range).
 */
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/random-number-generator';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';
import { gd } from './literals';

const c = resourceCases('RandomNumberGenerator');
const SEEDS = [0, 1, 12345, 2 ** 40 + 3, -7];
for (const seed of SEEDS) {
  const setup = ['var r := RandomNumberGenerator.new()', `r.seed = ${String(seed)}`];
  const make = () => {
    const r = R.construct();
    R.set_seed(r, seed);
    return r;
  };
  c.add(`seed-${String(seed)}`, 'set_seed', [...setup, 'return r.seed'], () => R.get_seed(make()));
  c.add(`get_seed-${String(seed)}`, 'get_seed', [...setup, 'return r.get_seed()'], () => R.get_seed(make()));
  c.add(`randi-${String(seed)}`, 'randi', [...setup, 'return [r.randi(), r.randi(), r.randi()]'], () => {
    const r = make();
    return [R.randi(r), R.randi(r), R.randi(r)];
  });
  c.add(`randf-${String(seed)}`, 'randf', [...setup, 'return [r.randf(), r.randf(), r.randf()]'], () => {
    const r = make();
    return [R.randf(r), R.randf(r), R.randf(r)];
  });
  for (const [from, to] of [[0.1, 2], [-5, 5], [3, -1.5]] as const) {
    c.add(`randf_range-${String(seed)}-${String(from)}-${String(to)}`, 'randf_range', [...setup, `return [r.randf_range(${gd(from)}, ${gd(to)}), r.randf_range(${gd(from)}, ${gd(to)})]`], () => {
      const r = make();
      return [R.randf_range(r, from, to), R.randf_range(r, from, to)];
    });
  }
  for (const [from, to] of [[0, 10], [-3, 3], [5, 5], [7, -2]] as const) {
    c.add(`randi_range-${String(seed)}-${String(from)}-${String(to)}`, 'randi_range', [...setup, `return [r.randi_range(${String(from)}, ${String(to)}), r.randi_range(${String(from)}, ${String(to)}), r.randi_range(${String(from)}, ${String(to)})]`], () => {
      const r = make();
      return [R.randi_range(r, from, to), R.randi_range(r, from, to), R.randi_range(r, from, to)];
    });
  }
}
// A new generator is seeded from the clock: its draws are in range.
c.cases.push({
  id: 'new-clock-seeded',
  symbol: { kind: 'native-constructor', owner: 'RandomNumberGenerator', member: 'RandomNumberGenerator' },
  gdscript: ['var r := RandomNumberGenerator.new()', 'var x := r.randf_range(0.1, 2.0)', 'return [x >= 0.1 and x <= 2.0, r.randi_range(1, 1)]'].join('\n'),
  target: () => {
    const r = R.construct();
    const x = R.randf_range(r, 0.1, 2.0);
    return [x >= Math.fround(0.1) && x <= 2, R.randi_range(r, 1, 1)];
  },
  comparator: 'exact',
});
c.add('randomize', 'randomize', ['var r := RandomNumberGenerator.new()', 'r.seed = 5', 'r.randomize()', 'return r.seed != 5'], () => {
  const r = R.construct();
  R.set_seed(r, 5);
  R.randomize(r);
  return R.get_seed(r) !== 5;
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'RandomNumberGenerator', compatModule: 'lib/godot-compat/random-number-generator', cases: c.cases };
export default EVIDENCE;
