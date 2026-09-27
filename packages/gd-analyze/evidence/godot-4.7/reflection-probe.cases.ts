/**
 * ReflectionProbe: each parameter set and read back in official Godot (the platformer's stage
 * probes' values, and the clamps: the distance's range, the capture point kept inside the box as
 * either changes), and (`render-mapping`) the reflections capability's props a probe maps to, cited
 * to the Compatibility renderer's capture (`servers/rendering/renderer_scene_cull.cpp:3814`).
 */
import { Group } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/reflection-probe';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('ReflectionProbe');
const gv = (x: number, y: number, z: number): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;

type Scalar = readonly [setter: string, getter: string, values: readonly (number | boolean)[], literal: (value: number | boolean) => string];
const float = (value: number | boolean): string => gd(value as number);
const int = (value: number | boolean): string => String(value);
const bool = (value: number | boolean): string => String(value);
const SCALARS: readonly Scalar[] = [
  ['set_intensity', 'get_intensity', [0.5], float],
  ['set_blend_distance', 'get_blend_distance', [2.5], float],
  ['set_ambient_mode', 'get_ambient_mode', [2], int],
  ['set_ambient_color_energy', 'get_ambient_color_energy', [3], float],
  ['set_max_distance', 'get_max_distance', [60, 18.7, 300000, -5], float],
  ['set_mesh_lod_threshold', 'get_mesh_lod_threshold', [2], float],
  ['set_enable_box_projection', 'is_box_projection_enabled', [true], bool],
  ['set_as_interior', 'is_set_as_interior', [true], bool],
  ['set_enable_shadows', 'are_shadows_enabled', [true], bool],
  ['set_cull_mask', 'get_cull_mask', [5], int],
  ['set_reflection_mask', 'get_reflection_mask', [7], int],
  ['set_update_mode', 'get_update_mode', [1], int],
];
type Fn = (self: object, value?: unknown) => unknown;
const call = (name: string): Fn => (R as unknown as Record<string, Fn>)[name] as Fn;
for (const [setter, getter, values, literal] of SCALARS) {
  for (const value of values) {
    c.add(`${setter}-${String(value)}`, setter, ['var p := ReflectionProbe.new()', `p.${setter}(${literal(value)})`, `return p.${getter}()`], () => {
      const p = new Group();
      call(setter)(p, value);
      return call(getter)(p);
    });
  }
  c.add(`${getter}-default`, getter, [`return ReflectionProbe.new().${getter}()`], () => call(getter)(new Group()));
}
c.add('set_ambient_color', 'set_ambient_color', ['var p := ReflectionProbe.new()', 'p.set_ambient_color(Color(0.2, 0.4, 0.6))', 'return p.get_ambient_color()'], () => {
  const p = new Group();
  R.set_ambient_color(p, C.construct(0.2, 0.4, 0.6));
  return R.get_ambient_color(p);
});
c.add('get_ambient_color-default', 'get_ambient_color', ['return ReflectionProbe.new().get_ambient_color()'], () => R.get_ambient_color(new Group()));
// The stage's probes: a size, then an offset inside it; an offset outside a small box, then the box
// shrunk under an offset.
const PLACEMENTS: readonly (readonly [string, 'size' | 'offset', readonly [number, number, number]][])[] = [
  [['stage', 'size', [35.9516, 20, 52.5818]], ['stage', 'offset', [0, -1.5, 0]]],
  [['small', 'size', [1, 1, 1]], ['small', 'offset', [2, 0, -3]]],
  [['shrunk', 'offset', [4, 0, 0]], ['shrunk', 'size', [2, 2, 2]]],
  [['flat', 'size', [0, 6, 0]], ['flat', 'offset', [0.5, 1, -0.5]]],
];
for (const steps of PLACEMENTS) {
  const name = steps[0]?.[0] as string;
  const member = steps[steps.length - 1]?.[1] === 'size' ? 'set_size' : 'set_origin_offset';
  c.add(`placement-${name}`, member, [
    'var p := ReflectionProbe.new()',
    ...steps.map(([, what, [x, y, z]]) => `p.${what === 'size' ? 'set_size' : 'set_origin_offset'}(${gv(x, y, z)})`),
    'return [p.get_size(), p.get_origin_offset()]',
  ], () => {
    const p = new Group();
    for (const [, what, [x, y, z]] of steps) (what === 'size' ? R.set_size : R.set_origin_offset)(p, V.construct(x, y, z));
    return [R.get_size(p), R.get_origin_offset(p)];
  });
}
c.add('get_size-default', 'get_size', ['return ReflectionProbe.new().get_size()'], () => R.get_size(new Group()));
c.add('get_origin_offset-default', 'get_origin_offset', ['return ReflectionProbe.new().get_origin_offset()'], () => R.get_origin_offset(new Group()));

// The capture a probe maps to: the stage's first probe (a far distance beyond its box) and its
// second (the box's faces beyond the unset distance), each face's distance from the capture point.
const CAPTURE = { file: 'servers/rendering/renderer_scene_cull.cpp', symbol: 'RendererSceneCull::_render_reflection_probe_step', line: 3814 };
const f32 = Math.fround;
const mapping = (id: string, authored: Readonly<Record<string, unknown>>, fact: string): GodotEvidenceCase => ({
  id: `capture-${id}`,
  symbol: { kind: 'native-member', owner: 'ReflectionProbe', member: 'set_max_distance' },
  gdscript: '',
  target: () => {
    const props = R.godot_reflection_probe_props(authored) as Record<string, unknown>;
    return [props['size'], props['captureOffset'], props['near'], props['far'], props['parallaxProjection'], props['parallaxSize'], props['captureMode'], props['intensity']]
      .map((value) => JSON.stringify(value))
      .join(';');
  },
  comparator: 'render-mapping',
  fact: { value: fact, source: CAPTURE },
});
c.cases.push(
  mapping(
    'reflection1',
    { intensity: 0.5, max_distance: 60, size: [35.9516, 20, 52.5818], origin_offset: [0, -1.5, 0], box_projection: true },
    [JSON.stringify([f32(35.9516), 20, f32(52.5818)]), JSON.stringify([0, -1.5, 0]), '0.01', '60', 'true', JSON.stringify([f32(35.9516), 20, f32(52.5818)]), '"on-change"', '0.5'].join(';'),
  ),
  mapping(
    'reflection2',
    { intensity: 0.5, size: [16, 6, 6], origin_offset: [0, -0.22168, 0], box_projection: true },
    [JSON.stringify([16, 6, 6]), JSON.stringify([0, f32(-0.22168), 0]), '0.01', '8', 'true', JSON.stringify([16, 6, 6]), '"on-change"', '0.5'].join(';'),
  ),
);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ReflectionProbe', compatModule: 'lib/godot-compat/reflection-probe', cases: c.cases };
export default EVIDENCE;
