import { Mesh } from 'three';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('VisualInstance3D');
c.add('get_layer_mask-default', 'get_layer_mask', ['return MeshInstance3D.new().get_layer_mask()'], () => V.get_layer_mask(new Mesh()));
for (const mask of [2, 1048575, 0]) {
  c.add(`set_layer_mask-${String(mask)}`, 'set_layer_mask', ['var n := MeshInstance3D.new()', `n.set_layer_mask(${String(mask)})`, 'return n.get_layer_mask()'], () => {
    const n = new Mesh();
    V.set_layer_mask(n, mask);
    return V.get_layer_mask(n);
  });
}
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'VisualInstance3D', compatModule: 'lib/godot-compat/visual-instance-3d', cases: c.cases };
export default EVIDENCE;
