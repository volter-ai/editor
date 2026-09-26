import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-material';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('PhysicsMaterial');
const READS = ['get_friction', 'is_rough', 'get_bounce', 'is_absorbent'] as const;
const gdReads = `return [${READS.map((r) => `m.${r}()`).join(', ')}]`;
for (const reader of READS) c.add(`${reader}-default`, reader, ['var m := PhysicsMaterial.new()', `return m.${reader}()`], () => M[reader](M.construct()));
for (const [setter, gd, write] of [
  ['set_friction', 'm.set_friction(0.35)', (m: M.PhysicsMaterial) => M.set_friction(m, 0.35)],
  ['set_rough', 'm.set_rough(true)', (m: M.PhysicsMaterial) => M.set_rough(m, true)],
  ['set_bounce', 'm.set_bounce(0.7)', (m: M.PhysicsMaterial) => M.set_bounce(m, 0.7)],
  ['set_absorbent', 'm.set_absorbent(true)', (m: M.PhysicsMaterial) => M.set_absorbent(m, true)],
] as const) {
  c.add(setter, setter, ['var m := PhysicsMaterial.new()', gd, gdReads], () => {
    const m = M.construct();
    write(m);
    return READS.map((r) => M[r](m));
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PhysicsMaterial', compatModule: 'lib/godot-compat/physics-material', cases: c.cases };
export default EVIDENCE;
