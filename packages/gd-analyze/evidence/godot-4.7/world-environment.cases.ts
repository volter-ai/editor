/**
 * WorldEnvironment: its environment set and read back in official Godot; and (`render-mapping`)
 * what the stage environment draws on three: the ambient light (`Color::srgb_to_linear` of the
 * colour times its energy, three's intensity PI for Godot's `albedo * ambient`,
 * `rasterizer_scene_gles3.cpp:1618`, `scene.glsl:2580`) and the fog (the linear fog colour times its
 * energy, the density, `rasterizer_scene_gles3.cpp:1646`).
 */
import { Group, PerspectiveCamera, Scene } from 'three';
import * as CAM from '../../capabilities/catalog/project-source/src/lib/godot-compat/camera-3d';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as E from '../../capabilities/catalog/project-source/src/lib/godot-compat/environment';
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/world-environment';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('WorldEnvironment');
c.add('set_environment', 'set_environment', ['var w := WorldEnvironment.new()', 'var e := Environment.new()', 'w.set_environment(e)', 'var same := w.get_environment() == e', 'w.free()', 'return same'], () => {
  const w = new Group();
  const e = E.construct();
  W.set_environment(w, e);
  return W.get_environment(w) === e;
});
c.add('get_environment-default', 'get_environment', ['var w := WorldEnvironment.new()', 'var none := w.get_environment() == null', 'w.free()', 'return none'], () => W.get_environment(new Group()) === null);

const f32 = Math.fround;
/** `Color::srgb_to_linear` (`core/math/color.h:192`) of one channel, in binary32. */
const linear = (v: number): number => (v < 0.04045 ? f32(v * f32(1 / 12.92)) : f32(Math.pow(f32((v + 0.055) * (1 / 1.055)), 2.4)));
const stage = (): E.Environment =>
  E.godot_environment_new({ backgroundMode: 2, ambientLightSource: 2, ambientLightColor: [0.6, 0.6, 0.6, 1], ambientLightSkyContribution: 0, tonemapMode: 4, fogEnabled: true, fogDensity: 0.0015, fogSkyAffect: 0 });
const g = f32(linear(f32(0.6)) * 1);
c.cases.push(
  {
    id: 'ambient-stage',
    symbol: { kind: 'native-member', owner: 'WorldEnvironment', member: 'set_environment' },
    gdscript: '',
    target: () => {
      const ambient = W.godot_world_environment_ambient(stage());
      return ambient === null ? null : [...ambient.color, ambient.intensity].join(',');
    },
    comparator: 'render-mapping',
    fact: { value: [g, g, g, Math.PI].join(','), source: { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'ambient_light_color_energy = color.srgb_to_linear() * energy', line: 1618 } },
  },
  {
    id: 'fog-stage',
    symbol: { kind: 'native-member', owner: 'WorldEnvironment', member: 'set_environment' },
    gdscript: '',
    target: () => {
      const fog = W.godot_world_environment_fog(stage());
      return fog === null ? null : [...fog.color, fog.density].join(',');
    },
    comparator: 'render-mapping',
    fact: {
      value: [f32(linear(f32(0.518))), f32(linear(f32(0.553))), f32(linear(f32(0.608))), f32(0.0015)].join(','),
      source: { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'fog_light_color = environment_get_fog_light_color().srgb_to_linear() * fog_energy', line: 1648 },
    },
  },
);
// Which environment a viewport draws with a camera: the camera's own, else the world's.
c.cases.push({
  id: 'camera-environment-resolution',
  symbol: { kind: 'native-member', owner: 'WorldEnvironment', member: 'set_environment' },
  gdscript: '',
  target: () => {
    const scene = new Scene();
    const world = new Group();
    const worldEnv = E.construct();
    const ownEnv = E.construct();
    W.set_environment(world, worldEnv);
    const withdraw = W.godot_world_environment_register(scene, world);
    const own = new PerspectiveCamera();
    CAM.set_environment(own, ownEnv);
    const plain = new PerspectiveCamera();
    const name = (env: E.Environment | null) => (env === ownEnv ? 'camera' : env === worldEnv ? 'world' : 'none');
    const out = [name(W.godot_world_environment_resolve(scene, own)), name(W.godot_world_environment_resolve(scene, plain))];
    withdraw();
    out.push(name(W.godot_world_environment_resolve(scene, plain)));
    return out.join(',');
  },
  comparator: 'render-mapping',
  fact: { value: 'camera,world,none', source: { file: 'servers/rendering/renderer_scene_cull.cpp', symbol: 'RendererSceneCull::_render_get_environment', line: 3722 } },
});
void C;

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'WorldEnvironment', compatModule: 'lib/godot-compat/world-environment', cases: c.cases };
export default EVIDENCE;
