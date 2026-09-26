import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/box-shape-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gv, resourceCases, type Triple } from './resource-cases';

const c = resourceCases('BoxShape3D');
c.add('get_size-default', 'get_size', ['return BoxShape3D.new().get_size()'], () => S.get_size(S.construct()));
for (const [name, size] of [
  ['unit', [1, 1, 1]],
  ['decimals', [0.3, 2.7, 1e-3]],
  ['zero', [0, 0, 0]],
  ['negative', [-1, 2, 3]],
  ['large', [1e20, 5, 0.5]],
] as const satisfies readonly (readonly [string, Triple])[]) {
  c.add(`set_size-${name}`, 'set_size', ['var s := BoxShape3D.new()', `s.set_size(${gv(size)})`, 'return s.get_size()'], () => {
    const s = S.construct();
    S.set_size(s, V.construct(...size));
    return S.get_size(s);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'BoxShape3D', compatModule: 'lib/godot-compat/box-shape-3d', cases: c.cases };
export default EVIDENCE;
