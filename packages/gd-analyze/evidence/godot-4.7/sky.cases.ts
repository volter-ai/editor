/** Sky: its material, radiance size and process mode set and read back in official Godot. */
import * as SKY from '../../capabilities/catalog/project-source/src/lib/godot-compat/sky';
import * as SM from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader-material';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('Sky');
for (const value of [0, 6, 7]) {
  c.add(`set_radiance_size-${String(value)}`, 'set_radiance_size', ['var s := Sky.new()', `s.set_radiance_size(${String(value)})`, 'return s.get_radiance_size()'], () => {
    const s = SKY.construct();
    SKY.set_radiance_size(s, value);
    return SKY.get_radiance_size(s);
  });
}
c.add('get_radiance_size-default', 'get_radiance_size', ['return Sky.new().get_radiance_size()'], () => SKY.get_radiance_size(SKY.construct()));
c.add('set_process_mode', 'set_process_mode', ['var s := Sky.new()', 's.set_process_mode(2)', 'return s.get_process_mode()'], () => {
  const s = SKY.construct();
  SKY.set_process_mode(s, 2);
  return SKY.get_process_mode(s);
});
c.add('get_process_mode-default', 'get_process_mode', ['return Sky.new().get_process_mode()'], () => SKY.get_process_mode(SKY.construct()));
c.add('set_material', 'set_material', ['var s := Sky.new()', 'var m := ShaderMaterial.new()', 's.set_material(m)', 'return s.get_material() == m'], () => {
  const s = SKY.construct();
  const m = SM.construct();
  SKY.set_material(s, m);
  return SKY.get_material(s) === m;
});
c.add('get_material-default', 'get_material', ['return Sky.new().get_material() == null'], () => SKY.get_material(SKY.construct()) === null);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Sky', compatModule: 'lib/godot-compat/sky', cases: c.cases };
export default EVIDENCE;
