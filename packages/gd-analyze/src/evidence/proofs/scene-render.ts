/**
 * The scene-render proof: mesh instances over primitive meshes with materials (a sub-resource
 * override and a `.tres` material on the mesh), and directional and omni lights, built by official
 * Godot and read back through Godot's getters (each node's layers and shadow setting, its mesh's
 * `surface_get_arrays(0)`, its active material's parameters, each light's color, parameters,
 * shadow and sky mode), against the components the production pipeline emits for the same
 * project, mounted in Node by @react-three/fiber and read through compat's getters on the mounted
 * entities. It proves the render node rules, the resource rules and that authored properties reach
 * their setters.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_RENDER_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene render proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'glow.tres': `[gd_resource type="StandardMaterial3D" format=3]

[resource]
albedo_color = Color(0.7, 0.7, 0.7, 1)
metallic = 0.1
roughness = 0.0
emission_enabled = true
emission = Color(1, 0.884824, 0.513098, 1)
emission_energy_multiplier = 3.71
`,
  'main.tscn': `[gd_scene load_steps=8 format=3]

[ext_resource type="Material" path="res://glow.tres" id="1_glow"]

[sub_resource type="CylinderMesh" id="CylinderMesh_a"]
top_radius = 0.2
bottom_radius = 0.2
height = 0.05
radial_segments = 16
rings = 1

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_b"]
albedo_color = Color(1.5, 1.26, 0, 1)
metallic = 1.0
roughness = 0.2

[sub_resource type="SphereMesh" id="SphereMesh_c"]
material = ExtResource("1_glow")
radius = 0.25
height = 0.5
radial_segments = 16
rings = 8

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_d"]
transparency = 1
blend_mode = 1
shading_mode = 0
albedo_color = Color(0.701961, 0.698039, 0.513726, 0.5)

[sub_resource type="PlaneMesh" id="PlaneMesh_e"]
material = SubResource("StandardMaterial3D_d")
size = Vector2(0.25, 0.25)
orientation = 2

[sub_resource type="QuadMesh" id="QuadMesh_f"]

[node name="Main" type="Node3D"]

[node name="Coin" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, -3.6199901e-06, -1, 0, 1, -3.6199901e-06, 0.1, 0.5, 0)
layers = 2
mesh = SubResource("CylinderMesh_a")
surface_material_override/0 = SubResource("StandardMaterial3D_b")

[node name="Bullet" type="MeshInstance3D" parent="."]
cast_shadow = 0
mesh = SubResource("SphereMesh_c")

[node name="Spark" type="MeshInstance3D" parent="."]
mesh = SubResource("PlaneMesh_e")

[node name="Card" type="MeshInstance3D" parent="."]
mesh = SubResource("QuadMesh_f")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.5, 0.866025, 0, -0.866025, 0.5, 0, 4, 0)
light_color = Color(1, 0.95, 0.9, 1)
light_energy = 0.75
shadow_enabled = true
sky_mode = 1

[node name="Lamp" type="OmniLight3D" parent="."]
light_color = Color(1, 0.72, 0.3, 1)
light_energy = 2.5
omni_range = 3.0
omni_attenuation = 2.0
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _floats(values) -> Array:
\tvar out := []
\tfor value in values:
\t\tif value is Vector3:
\t\t\tout.append_array([_bits(value.x), _bits(value.y), _bits(value.z)])
\t\telif value is Vector2:
\t\t\tout.append_array([_bits(value.x), _bits(value.y)])
\t\telse:
\t\t\tout.append(_bits(value))
\treturn out

func _color(value: Color) -> Array:
\treturn [_bits(value.r), _bits(value.g), _bits(value.b), _bits(value.a)]

func _material(m) -> Variant:
\tif m == null:
\t\treturn null
\treturn {"albedo": _color(m.albedo_color), "metallic": _bits(m.metallic), "roughness": _bits(m.roughness), "emission_enabled": m.emission_enabled, "emission": _color(m.emission), "energy": _bits(m.emission_energy_multiplier), "transparency": m.transparency, "blend": m.blend_mode, "shading": m.shading_mode}

var main: Node

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tvar rows := {}
\tfor node in main.get_children():
\t\tvar row := {"class": node.get_class()}
\t\tif node is MeshInstance3D:
\t\t\tvar arrays: Array = node.mesh.surface_get_arrays(0)
\t\t\trow["layers"] = node.layers
\t\t\trow["cast_shadow"] = node.cast_shadow
\t\t\trow["vertices"] = _floats(arrays[Mesh.ARRAY_VERTEX])
\t\t\trow["normals"] = _floats(arrays[Mesh.ARRAY_NORMAL])
\t\t\trow["uvs"] = _floats(arrays[Mesh.ARRAY_TEX_UV])
\t\t\trow["indices"] = Array(arrays[Mesh.ARRAY_INDEX])
\t\t\tvar active = node.get_surface_override_material(0)
\t\t\tif active == null:
\t\t\t\tactive = node.mesh.material
\t\t\trow["material"] = _material(active)
\t\tif node is Light3D:
\t\t\trow["color"] = _color(node.light_color)
\t\t\trow["params"] = [_bits(node.get_param(0)), _bits(node.get_param(3)), _bits(node.get_param(4)), _bits(node.get_param(6))]
\t\t\trow["shadow"] = node.shadow_enabled
\t\tif node is DirectionalLight3D:
\t\t\trow["sky_mode"] = node.sky_mode
\t\trows[node.name] = row
\tprint("RENDER " + JSON.stringify(rows))
\treturn true
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
 * Mounts the emitted main scene with R3F's own root and reads each mounted entity through compat.
 * It runs in the emitted project's directory, so tsx compiles the scene under that project's own
 * tsconfig.
 */
const MOUNT = `import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import { MainScene } from './src/scenes/main';
import { get_layer_mask } from './src/lib/godot-compat/visual-instance-3d';
import { get_cast_shadows_setting } from './src/lib/godot-compat/geometry-instance-3d';
import { get_mesh, get_surface_override_material } from './src/lib/godot-compat/mesh-instance-3d';
import { get_mesh_arrays, get_material } from './src/lib/godot-compat/primitive-mesh';
import * as B from './src/lib/godot-compat/base-material-3d';
import * as L from './src/lib/godot-compat/light-3d';
import { get_sky_mode } from './src/lib/godot-compat/directional-light-3d';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const floats = (values) => values.flatMap((value) =>
  typeof value === 'number' ? [bits(value)] : 'z' in value ? [bits(value.x), bits(value.y), bits(value.z)] : [bits(value.x), bits(value.y)]);
const color = (value) => [bits(value.r), bits(value.g), bits(value.b), bits(value.a)];
const material = (m) => m === null ? null : {
  albedo: color(B.get_albedo(m)), metallic: bits(B.get_metallic(m)), roughness: bits(B.get_roughness(m)),
  emission_enabled: B.get_feature(m, 0), emission: color(B.get_emission(m)), energy: bits(B.get_emission_energy_multiplier(m)),
  transparency: B.get_transparency(m), blend: B.get_blend_mode(m), shading: B.get_shading_mode(m),
};
const CLASS = { Mesh: 'MeshInstance3D', DirectionalLight: 'DirectionalLight3D', PointLight: 'OmniLight3D' };
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const canvas = {
  width: 640, height: 480, style: {}, clientWidth: 640, clientHeight: 480,
  addEventListener() {}, removeEventListener() {}, getContext() { return null; },
  getBoundingClientRect() { return { width: 640, height: 480, top: 0, left: 0 }; },
};
const gl = {
  domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
  setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
  xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
  getContext: () => ({}),
};
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 640, height: 480, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene, { name: 'Main' }))); });
const rows = {};
for (const node of holder.current.children[0].children) {
  const row = { class: CLASS[node.type] ?? node.type };
  if (node.type === 'Mesh') {
    const mesh = get_mesh(node);
    const arrays = get_mesh_arrays(mesh);
    row.layers = get_layer_mask(node);
    row.cast_shadow = get_cast_shadows_setting(node);
    row.vertices = floats(arrays[0]);
    row.normals = floats(arrays[1]);
    row.uvs = floats(arrays[4]);
    row.indices = arrays[12];
    row.material = material(get_surface_override_material(node, 0) ?? get_material(mesh));
    // The drawn geometry is the stored surface: as many vertices as the arrays report.
    if (node.geometry.getAttribute('position').count !== arrays[0].length) row.drawn = 'geometry differs';
  }
  if (node.type === 'DirectionalLight' || node.type === 'PointLight') {
    row.color = color(L.get_color(node));
    row.params = [bits(L.get_param(node, 0)), bits(L.get_param(node, 3)), bits(L.get_param(node, 4)), bits(L.get_param(node, 6))];
    row.shadow = L.has_shadow(node);
  }
  if (node.type === 'DirectionalLight') row.sky_mode = get_sky_mode(node);
  rows[node.name] = row;
}
await act(async () => { root.unmount(); });
console.log('RENDER ' + JSON.stringify(rows));
`;

function mountedRender(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('RENDER '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('RENDER '.length)) as unknown;
}

export async function measureSceneRenderProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_RENDER_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-render-'));
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
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(
        readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
        toolchain.frontend.readAuthority,
      ),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const out = path.join(temp, 'out');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    symlinkSync(path.join(MONOREPO_ROOT, 'node_modules'), path.join(out, 'node_modules'));
    const target = mountedRender(out);

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('RENDER '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native render probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('RENDER '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-render',
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
    rmSync(temp, { recursive: true, force: true });
  }
}
