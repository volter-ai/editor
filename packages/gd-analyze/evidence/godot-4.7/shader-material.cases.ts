/** ShaderMaterial: its shader and parameters set and read back in official Godot (a null value clears). */
import * as SH from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader';
import * as SM from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader-material';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('ShaderMaterial');
const lowered = { mode: 'sky', uniforms: [{ name: 'exposure', glsl: 'godot_u_exposure', type: 'float', default: [1] }], functions: '', entry: '' };
c.add('set_shader', 'set_shader', ['var m := ShaderMaterial.new()', 'var s := Shader.new()', 's.code = "shader_type sky; uniform float exposure = 1.0; void sky() {}"', 'm.set_shader(s)', 'return m.get_shader() == s'], () => {
  const m = SM.construct();
  const s = SH.godot_shader_new(lowered);
  SM.set_shader(m, s);
  return SM.get_shader(m) === s;
});
c.add('get_shader-default', 'get_shader', ['return ShaderMaterial.new().get_shader() == null'], () => SM.get_shader(SM.construct()) === null);
c.add('set_shader_parameter', 'set_shader_parameter', [
  'var m := ShaderMaterial.new()',
  'var s := Shader.new()',
  's.code = "shader_type sky; uniform float exposure = 1.0; void sky() {}"',
  'm.set_shader(s)',
  'var out := [m.get_shader_parameter("exposure")]',
  'm.set_shader_parameter("exposure", 2.5)',
  'out.append(m.get_shader_parameter("exposure"))',
  'm.set_shader_parameter("exposure", null)',
  'out.append(m.get_shader_parameter("exposure"))',
  'return out',
], () => {
  const m = SM.construct();
  SM.set_shader(m, SH.godot_shader_new(lowered));
  const out = [SM.get_shader_parameter(m, 'exposure')];
  SM.set_shader_parameter(m, 'exposure', 2.5);
  out.push(SM.get_shader_parameter(m, 'exposure'));
  SM.set_shader_parameter(m, 'exposure', null);
  out.push(SM.get_shader_parameter(m, 'exposure'));
  return out;
});
c.add('get_shader_parameter-unset', 'get_shader_parameter', ['return ShaderMaterial.new().get_shader_parameter("anything")'], () => SM.get_shader_parameter(SM.construct(), 'anything'));

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ShaderMaterial', compatModule: 'lib/godot-compat/shader-material', cases: c.cases };
export default EVIDENCE;
