/**
 * The scene-particles proof: CPUParticles3D systems as the platformer's scenes author them — a
 * bullet's trail (a sphere mesh with its material, no spread or gravity, a scale curve, a fading
 * colour ramp, no shadow) and a coin's burst (one shot, explosive, a sphere-surface emitter, a
 * plane mesh, a scale curve with its own limits, a three-point ramp with constant interpolation),
 * each with a fixed seed — instantiated in official Godot and stepped at a fixed 60 fps, each
 * system's multimesh buffer read after every frame (the headless renderer's `frame_pre_draw`
 * emitted by hand, since it draws nothing), against the components the production pipeline emits
 * for the same project, mounted in Node by @react-three/fiber, entered into compat's tree on the
 * same frame and stepped by its clock, each buffer read through compat.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { bindGodotProject } from '../../analyze/bound-project';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { writeGodotTranslationArtifacts } from '../../materialize';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import { GODOT_SCENE_PARTICLES_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const FRAMES = 75;
const SYSTEMS = ['Trail', 'Burst'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene particles proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=10 format=3]

[sub_resource type="StandardMaterial3D" id="Trail_material"]
shading_mode = 0
albedo_color = Color(1, 0.8, 0.4, 1)

[sub_resource type="SphereMesh" id="Trail_mesh"]
material = SubResource("Trail_material")
radius = 0.125
height = 0.25
radial_segments = 16
rings = 8

[sub_resource type="Curve" id="Trail_scale"]
_data = [Vector2(0, 1), 0.0, 0.0, 0, 0, Vector2(1, 0), 0.0, 0.0, 0, 0]
point_count = 2

[sub_resource type="Gradient" id="Trail_ramp"]
colors = PackedColorArray(1, 1, 1, 1, 1, 1, 1, 0)

[sub_resource type="StandardMaterial3D" id="Burst_material"]
transparency = 1
blend_mode = 1
cull_mode = 2
shading_mode = 0
vertex_color_use_as_albedo = true
vertex_color_is_srgb = true
albedo_color = Color(1, 1, 0.759137, 1)
billboard_mode = 3
billboard_keep_scale = true
particles_anim_h_frames = 1
particles_anim_v_frames = 1
particles_anim_loop = false
proximity_fade_enabled = true
proximity_fade_distance = 0.5

[sub_resource type="PlaneMesh" id="Burst_mesh"]
material = SubResource("Burst_material")
size = Vector2(0.25, 0.25)
orientation = 2

[sub_resource type="Curve" id="Burst_scale"]
_limits = [0.0, 3.0, 0.0, 1.0]
_data = [Vector2(0, 0), 0.0, 0.0, 0, 0, Vector2(0.2, 0.6), 0.0, 0.0, 0, 0, Vector2(1, 0), 0.0, 0.0, 0, 0]
point_count = 3

[sub_resource type="Gradient" id="Burst_ramp"]
interpolation_mode = 2
offsets = PackedFloat32Array(0, 0.642276, 1)
colors = PackedColorArray(1, 1, 1, 1, 1, 1, 1, 0.180392, 1, 1, 1, 0)

[sub_resource type="QuadMesh" id="Glow_mesh"]

[sub_resource type="Gradient" id="Glow_gradient"]
interpolation_mode = 2
offsets = PackedFloat32Array(0, 0.642276, 1)
colors = PackedColorArray(1, 1, 1, 1, 1, 1, 1, 0.180392, 1, 1, 1, 0)

[sub_resource type="GradientTexture2D" id="Glow_texture"]
gradient = SubResource("Glow_gradient")
fill = 1
fill_from = Vector2(0.5, 0.5)
fill_to = Vector2(0.5, 0.01)

[sub_resource type="StandardMaterial3D" id="Glow_material"]
transparency = 1
blend_mode = 1
shading_mode = 0
albedo_color = Color(1, 0.858824, 0.572549, 0.25098)
albedo_texture = SubResource("Glow_texture")
billboard_mode = 1
proximity_fade_enabled = true
proximity_fade_distance = 0.15

[node name="Main" type="Node3D"]

[node name="Glow" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0)
visibility_range_begin = 3.0
visibility_range_begin_margin = 3.0
visibility_range_fade_mode = 1
mesh = SubResource("Glow_mesh")
surface_material_override/0 = SubResource("Glow_material")

[node name="Trail" type="CPUParticles3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, -2)
cast_shadow = 0
amount = 16
lifetime = 0.4
visibility_aabb = AABB(-4, -4, -4, 8, 8, 8)
mesh = SubResource("Trail_mesh")
use_fixed_seed = true
seed = 1234
spread = 0.0
gravity = Vector3(0, 0, 0)
initial_velocity_min = 0.5
initial_velocity_max = 1.5
scale_amount_curve = SubResource("Trail_scale")
color_ramp = SubResource("Trail_ramp")

[node name="Burst" type="CPUParticles3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -0.000732422, 0.542954, 0)
amount = 16
one_shot = true
explosiveness = 1.0
lifetime_randomness = 0.2
mesh = SubResource("Burst_mesh")
use_fixed_seed = true
seed = 99
emission_shape = 2
emission_sphere_radius = 0.4
direction = Vector3(0, 1, 0)
spread = 25.0
initial_velocity_min = 1.0
initial_velocity_max = 2.0
scale_amount_curve = SubResource("Burst_scale")
color_ramp = SubResource("Burst_ramp")
`,
};

/**
 * The native probe, written into the project only after the target side has read it: the scene
 * enters the tree in the first frame's `process_frame`, then each later `process_frame` reads every
 * system's buffer (its float32 bytes) and whether it still emits.
 */
const OBSERVE = `extends SceneTree

var rows: Array = []

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _material(m: BaseMaterial3D) -> Array:
\treturn [m.cull_mode, m.billboard_mode, m.get_flag(BaseMaterial3D.FLAG_ALBEDO_FROM_VERTEX_COLOR), m.get_flag(BaseMaterial3D.FLAG_SRGB_VERTEX_COLOR), m.get_flag(BaseMaterial3D.FLAG_BILLBOARD_KEEP_SCALE), m.proximity_fade_enabled, _bits(m.proximity_fade_distance), m.transparency, m.blend_mode]

func _initialize() -> void:
\tprocess_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
\tvar main: Node = load("res://main.tscn").instantiate()
\troot.add_child(main)
\tfor i in ${String(FRAMES)}:
\t\tawait process_frame
\t\tRenderingServer.emit_signal("frame_pre_draw")
\t\tvar row: Array = []
\t\tfor name in ${JSON.stringify(SYSTEMS)}:
\t\t\tvar p: CPUParticles3D = main.get_node(name)
\t\t\trow.append([RenderingServer.multimesh_get_buffer(p.get_base()).to_byte_array().hex_encode(), p.emitting])
\t\trows.append(row)
\tvar materials: Array = []
\tfor name in ${JSON.stringify(SYSTEMS)}:
\t\tvar m: BaseMaterial3D = main.get_node(name).mesh.surface_get_material(0)
\t\tmaterials.append(_material(m))
\tvar glow: MeshInstance3D = main.get_node("Glow")
\tvar g: BaseMaterial3D = glow.get_surface_override_material(0)
\tmaterials.append(_material(g))
\tvar t: GradientTexture2D = g.albedo_texture
\tmaterials.append([t.get_width(), t.get_height(), t.fill, _bits(t.fill_from.x), _bits(t.fill_from.y), _bits(t.fill_to.x), _bits(t.fill_to.y), t.gradient.interpolation_mode, t.gradient.get_point_count()])
\tmaterials.append([_bits(glow.visibility_range_begin), _bits(glow.visibility_range_begin_margin), glow.visibility_range_fade_mode])
\trows.append(materials)
\tprint("PARTICLES " + JSON.stringify(rows))
\tquit()
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/**
 * Mounts the emitted main scene with R3F's own root, then enters it into compat's tree in the first
 * frame's `process_frame` (as the root's `add_child` does in Godot) and steps frames as
 * `Main::iteration` does at a fixed 60 fps, reading every system after each `process_frame`.
 */
const MOUNT = `import { createElement, act } from 'react';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import * as P from './src/lib/godot-compat/cpu-particles-3d';
import * as B from './src/lib/godot-compat/base-material-3d';
import * as G from './src/lib/godot-compat/geometry-instance-3d';
import * as T from './src/lib/godot-compat/texture-2d';
import * as GT from './src/lib/godot-compat/gradient-texture-2d';
import * as GR from './src/lib/godot-compat/gradient';
import * as N from './src/lib/godot-compat/node';
import * as ST from './src/lib/godot-compat/scene-tree';

const { MainScene } = await import('./src/scenes/main');
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const canvas = {
  width: 64, height: 64, style: {}, clientWidth: 64, clientHeight: 64,
  addEventListener() {}, removeEventListener() {}, getContext() { return null; },
  getBoundingClientRect() { return { width: 64, height: 64, top: 0, left: 0 }; },
};
const gl = {
  domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
  setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
  xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
  getContext: () => ({}),
};
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 64, height: 64, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene, { name: 'Main' }))); });
const main = holder.current.children[0];
ST.godot_tree_set_root(holder.current.parent);
const tree = ST.godot_tree();
const hex = (buffer) => Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('hex');
const rows = [];
let frame = 0;
const read = () => {
  rows.push(${JSON.stringify(SYSTEMS)}.map((name) => {
    const p = main.getObjectByName(name);
    return [hex(P.godot_cpu_particles_3d_buffer(p)), P.is_emitting(p)];
  }));
  frame += 1;
  if (frame < ${String(FRAMES)}) tree.process_frame.connect(read, { oneShot: true });
};
tree.process_frame.connect(() => {
  N.mountGodotScriptTree(main, []);
  tree.process_frame.connect(read, { oneShot: true });
}, { oneShot: true });
ST.godot_tree_frame(1 / 60);
for (let guard = 0; frame < ${String(FRAMES)} && guard < 1000; guard += 1) {
  ST.godot_tree_physics_step(1 / 60);
  ST.godot_tree_frame(1 / 60);
}
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const material = (m) => {
  const b = B.godot_base_material_3d_of(m);
  return [B.get_cull_mode(b), B.get_billboard_mode(b), B.get_flag(b, 1), B.get_flag(b, 2), B.get_flag(b, 5), B.is_proximity_fade_enabled(b), bits(B.get_proximity_fade_distance(b)), B.get_transparency(b), B.get_blend_mode(b)];
};
const glow = main.getObjectByName('Glow');
// The drawn material holds its Godot state: the particles' instanced mesh, the glow's mesh.
const drawnMaterial = (name) => main.getObjectByName(name).children.find((child) => child.isInstancedMesh).material;
const map = glow.material.map;
rows.push([
  ...${JSON.stringify(SYSTEMS)}.map((name) => material(drawnMaterial(name))),
  material(glow.material),
  (() => {
    const t = GT.godot_gradient_texture_2d_of(B.godot_base_material_3d_of(glow.material).textures[0]);
    const from = GT.get_fill_from(t);
    const to = GT.get_fill_to(t);
    const gradient = GT.get_gradient(t);
    return [T.get_width(map), T.get_height(map), GT.get_fill(t), bits(from.x), bits(from.y), bits(to.x), bits(to.y), GR.get_interpolation_mode(gradient), GR.get_point_count(gradient)];
  })(),
  [bits(G.get_visibility_range_begin(glow)), bits(G.get_visibility_range_begin_margin(glow)), G.get_visibility_range_fade_mode(glow)],
]);
await act(async () => { root.unmount(); });
// The rows are larger than a pipe takes before the process exits: written to a file.
writeFileSync('particles.json', JSON.stringify(rows));
process.exit(0);
`;

function mountedParticles(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(readFileSync(path.join(out, 'particles.json'), 'utf8')) as unknown;
}

export async function measureSceneParticlesProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_PARTICLES_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-particles-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary,
    });
    const read = readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority);
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(read, toolchain.frontend.readAuthority),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      read,
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const out = path.join(temp, 'out');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    symlinkSync(path.join(MONOREPO_ROOT, 'node_modules'), path.join(out, 'node_modules'));
    const target = mountedParticles(out);

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('PARTICLES '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native particles probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('PARTICLES '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-particles',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree: nativeJson === targetJson,
        detail: `native ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else console.error(`kept ${temp}`);
  }
}
