import { DirectionalLight, Vector3 } from 'three';
import * as D from '../../capabilities/catalog/project-source/src/lib/godot-compat/directional-light-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const directional = (): DirectionalLight => {
  const l = new DirectionalLight();
  D.godot_directional_light_3d_mount(l);
  return l;
};
const c = resourceCases('DirectionalLight3D');
c.add('get_sky_mode-default', 'get_sky_mode', ['return DirectionalLight3D.new().get_sky_mode()'], () => D.get_sky_mode(directional()));
for (const mode of [1, 2]) {
  c.add(`set_sky_mode-${String(mode)}`, 'set_sky_mode', ['var l := DirectionalLight3D.new()', `l.set_sky_mode(${String(mode)})`, 'return l.get_sky_mode()'], () => {
    const l = directional();
    D.set_sky_mode(l, mode);
    return D.get_sky_mode(l);
  });
}
const mapping = (
  id: string,
  member: string,
  fact: unknown,
  source: { readonly file: string; readonly symbol: string; readonly line: number },
  target: () => unknown,
): GodotEvidenceCase => ({
  id: `three-${id}`,
  symbol: { kind: 'native-member', owner: 'DirectionalLight3D', member },
  gdscript: '',
  target,
  comparator: 'render-mapping',
  fact: { value: fact, source },
});
c.cases.push(
  mapping('sky-only-lights-nothing', 'set_sky_mode', 0, { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'SKY_ONLY directional lights skipped', line: 1724 }, () => {
    const l = directional();
    D.set_sky_mode(l, 2);
    return l.intensity;
  }),
  // Godot's light shines along the node's -Z (`rasterizer_scene_gles3.cpp:1741`): three's light
  // shines from its position toward its target, so the direction light-to-target is -Z.
  mapping('shines-along-minus-z', 'get_sky_mode', '0,0,-1', { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'directional light direction -Z', line: 1741 }, () => {
    const l = directional();
    l.updateMatrixWorld(true);
    const from = new Vector3().setFromMatrixPosition(l.matrixWorld);
    const to = new Vector3().setFromMatrixPosition(l.target.matrixWorld);
    const d = to.sub(from);
    return [d.x, d.y, d.z].join(',');
  }),
);
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'DirectionalLight3D', compatModule: 'lib/godot-compat/directional-light-3d', cases: c.cases };
export default EVIDENCE;
