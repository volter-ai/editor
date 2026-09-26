/** Shader: the mode its `shader_type` selects, read back in official Godot. */
import * as SH from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('Shader');
for (const [mode, body] of [
  ['sky', 'void sky() {}'],
  ['spatial', 'void fragment() {}'],
  ['canvas_item', 'void fragment() {}'],
] as const) {
  c.add(`get_mode-${mode}`, 'get_mode', ['var s := Shader.new()', `s.code = "shader_type ${mode}; ${body}"`, 'return s.get_mode()'], () =>
    SH.get_mode(SH.godot_shader_new({ mode, uniforms: [], functions: '', entry: '' })),
  );
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Shader', compatModule: 'lib/godot-compat/shader', cases: c.cases };
export default EVIDENCE;
