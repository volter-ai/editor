import { DirectionalLight, PointLight } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as D from '../../capabilities/catalog/project-source/src/lib/godot-compat/directional-light-3d';
import * as L from '../../capabilities/catalog/project-source/src/lib/godot-compat/light-3d';
import * as O from '../../capabilities/catalog/project-source/src/lib/godot-compat/omni-light-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const omni = (): PointLight => {
  const l = new PointLight();
  O.godot_omni_light_3d_mount(l);
  return l;
};
const directional = (): DirectionalLight => {
  const l = new DirectionalLight();
  D.godot_directional_light_3d_mount(l);
  return l;
};
const c = resourceCases('Light3D');
for (let param = 0; param <= 20; param += 1) {
  c.add(`get_param-omni-default-${String(param)}`, 'get_param', [`return OmniLight3D.new().get_param(${String(param)})`], () => L.get_param(omni(), param));
  c.add(`get_param-directional-default-${String(param)}`, 'get_param', [`return DirectionalLight3D.new().get_param(${String(param)})`], () => L.get_param(directional(), param));
}
for (const [param, value] of [
  [0, 0.25],
  [4, 12.5],
  [6, 2],
  [21, 3],
] as const) {
  c.add(`set_param-${String(param)}-${gd(value)}`, 'set_param', ['var l := OmniLight3D.new()', `l.set_param(${String(param)}, ${gd(value)})`, `return l.get_param(${String(param)})`], () => {
    const l = omni();
    L.set_param(l, param, value);
    return L.get_param(l, param);
  });
}
c.add('get_color-default', 'get_color', ['return OmniLight3D.new().get_color()'], () => L.get_color(omni()));
c.add('set_color', 'set_color', ['var l := DirectionalLight3D.new()', `l.set_color(Color(${gd(1)}, ${gd(0.9)}, ${gd(0.7)}, ${gd(1)}))`, 'return l.get_color()'], () => {
  const l = directional();
  L.set_color(l, C.construct(1, 0.9, 0.7, 1));
  return L.get_color(l);
});
c.add('has_shadow-default', 'has_shadow', ['return DirectionalLight3D.new().has_shadow()'], () => L.has_shadow(directional()));
c.add('set_shadow', 'set_shadow', ['var l := DirectionalLight3D.new()', 'l.set_shadow(true)', 'return l.has_shadow()'], () => {
  const l = directional();
  L.set_shadow(l, true);
  return L.has_shadow(l);
});

// What three draws from the parameters: the Compatibility renderer's light data (cited).
const f32 = Math.fround;
const LIGHTS = { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'RasterizerSceneGLES3::_setup_lights', line: 1970 };
const srgbToLinear = (v: number): number =>
  v < f32(0.04045) ? f32(v * f32(1 / 12.92)) : f32(Math.pow(f32((v + 0.055) * (1 / 1.055)), f32(2.4)));
const mapping = (id: string, member: string, fact: unknown, target: () => unknown): GodotEvidenceCase => ({
  id: `three-${id}`,
  symbol: { kind: 'native-member', owner: 'Light3D', member },
  gdscript: '',
  target,
  comparator: 'render-mapping',
  fact: { value: fact, source: LIGHTS },
});
c.cases.push(
  mapping('energy-pi', 'set_param', f32(0.25 * Math.PI), () => {
    const l = omni();
    L.set_param(l, 0, 0.25);
    return l.intensity;
  }),
  mapping('omni-range-attenuation', 'set_param', [12.5, 2].join(','), () => {
    const l = omni();
    L.set_param(l, 4, 12.5);
    L.set_param(l, 6, 2);
    return [l.distance, l.decay].join(',');
  }),
  mapping('color-linear', 'set_color', [srgbToLinear(1), srgbToLinear(f32(0.9)), srgbToLinear(f32(0.7))].join(','), () => {
    const l = directional();
    L.set_color(l, C.construct(1, 0.9, 0.7, 1));
    return [l.color.r, l.color.g, l.color.b].join(',');
  }),
  mapping('shadow-cast', 'set_shadow', true, () => {
    const l = directional();
    L.set_shadow(l, true);
    return l.castShadow;
  }),
);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Light3D', compatModule: 'lib/godot-compat/light-3d', cases: c.cases };
export default EVIDENCE;
