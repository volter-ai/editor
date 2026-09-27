/**
 * The scene-environment proof: the platformer's stage environment (a WorldEnvironment whose
 * Environment draws a sky from a ShaderMaterial of `stage/skybox.gdshader` sampling the imported
 * cubemap `stage/skybox.webp`, a constant ambient colour, AgX tone mapping and exponential fog),
 * imported and loaded by official Godot and read back through Godot's getters (the environment's
 * background, ambient, tone mapping and fog; the sky's settings; the shader's mode and the
 * material's parameters; each cubemap face's bytes as RGBA8), against the components the production
 * pipeline emits for the same project, mounted in Node by @react-three/fiber with the copied image
 * sliced on the page, read through compat. A camera's own environment draws a PanoramaSkyMaterial,
 * whose shaders its class generates (captured from the exporter and lowered, `shader-lowering`):
 * its filtering, energy and panorama read back; two more cameras' environments draw a
 * ProceduralSkyMaterial and a PhysicalSkyMaterial, their properties read back. The directional
 * lights the sky pass receives (`_setup_sky`: visible, sky mode not `LIGHT_ONLY`, tree order, each
 * direction, energy, colour and angular size) are read on the native side from the nodes as
 * `rasterizer_scene_gles3.cpp:741` reads them (the size's `deg_to_rad(float)` re-expressed in
 * GDScript), against compat's `godot_world_environment_sky_lights` over the mounted scene: a sun
 * rotated about two axes, a light under a rotated parent, one in `LIGHT_ONLY` and a hidden one.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_ENVIRONMENT_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { NODE_MOUNT_IMPORTS } from '../node-assets';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const IMAGES = ['stage/skybox.webp'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene environment proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'stage/skybox.gdshader': readFileSync(path.join(FIXTURE, 'stage/skybox.gdshader'), 'utf8'),
  'main.tscn': `[gd_scene load_steps=14 format=3]

[ext_resource type="Shader" path="res://stage/skybox.gdshader" id="3_s88my"]
[ext_resource type="CompressedCubemap" path="res://stage/skybox.webp" id="4_ve7pq"]

[sub_resource type="ShaderMaterial" id="ShaderMaterial_ve7pq"]
shader = ExtResource("3_s88my")
shader_parameter/source_panorama = ExtResource("4_ve7pq")
shader_parameter/exposure = 1.0

[sub_resource type="Sky" id="Sky_qdkmq"]
sky_material = SubResource("ShaderMaterial_ve7pq")

[sub_resource type="Environment" id="Environment_vpofs"]
background_mode = 2
sky = SubResource("Sky_qdkmq")
ambient_light_source = 2
ambient_light_color = Color(0.6, 0.6, 0.6, 1)
ambient_light_sky_contribution = 0.0
tonemap_mode = 4
fog_enabled = true
fog_density = 0.0015
fog_sky_affect = 0.0

[sub_resource type="PanoramaSkyMaterial" id="PanoramaSkyMaterial_fjheq"]
filter = false
energy_multiplier = 0.5

[sub_resource type="Sky" id="Sky_7bk1c"]
sky_material = SubResource("PanoramaSkyMaterial_fjheq")

[sub_resource type="Environment" id="Environment_camera"]
background_mode = 2
sky = SubResource("Sky_7bk1c")
ambient_light_source = 2

[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_lg8b7"]
sky_horizon_color = Color(0.67451, 0.682353, 0.698039, 1)
sky_curve = 0.0175
ground_bottom_color = Color(1, 1, 1, 1)
ground_curve = 0.171484
sun_angle_max = 12.5
sky_energy_multiplier = 1.5

[sub_resource type="Sky" id="Sky_procedural"]
sky_material = SubResource("ProceduralSkyMaterial_lg8b7")

[sub_resource type="Environment" id="Environment_procedural"]
background_mode = 2
sky = SubResource("Sky_procedural")
ambient_light_source = 2

[sub_resource type="PhysicalSkyMaterial" id="PhysicalSkyMaterial_1"]
turbidity = 25.0
mie_color = Color(0.9, 0.8, 0.7, 1)
use_debanding = false

[sub_resource type="Sky" id="Sky_physical"]
sky_material = SubResource("PhysicalSkyMaterial_1")

[sub_resource type="Environment" id="Environment_physical"]
background_mode = 2
sky = SubResource("Sky_physical")
ambient_light_source = 2

[node name="Main" type="Node3D"]

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_vpofs")

[node name="Camera" type="Camera3D" parent="."]
environment = SubResource("Environment_camera")

[node name="ProceduralCamera" type="Camera3D" parent="."]
environment = SubResource("Environment_procedural")

[node name="PhysicalCamera" type="Camera3D" parent="."]
environment = SubResource("Environment_physical")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866025, -0.25, 0.433013, 0, 0.866025, 0.5, -0.5, -0.433013, 0.75, 0, 4, 0)
light_color = Color(1, 0.95, 0.8, 1)
light_energy = 1.3

[node name="LightOnly" type="DirectionalLight3D" parent="."]
sky_mode = 1

[node name="Hidden" type="DirectionalLight3D" parent="."]
visible = false

[node name="Group" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.5, -0.866025, 0, 0.866025, 0.5, 0, 0, 0)

[node name="SkyOnly" type="DirectionalLight3D" parent="Group"]
transform = Transform3D(0.707107, 0, -0.707107, 0, 1, 0, 0.707107, 0, 0.707107, 0, 0, 0)
light_energy = 0.4
sky_mode = 2
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _sha(bytes: PackedByteArray) -> String:
\tvar ctx := HashingContext.new()
\tctx.start(HashingContext.HASH_SHA256)
\tctx.update(bytes)
\treturn ctx.finish().hex_encode()

func _panorama(m: PanoramaSkyMaterial) -> Array:
\treturn [m.filter, _bits(m.energy_multiplier), m.panorama == null]

func _c(c: Color) -> Array:
\treturn [_bits(c.r), _bits(c.g), _bits(c.b), _bits(c.a)]

func _procedural(m: ProceduralSkyMaterial) -> Array:
\treturn [_c(m.sky_top_color), _c(m.sky_horizon_color), _bits(m.sky_curve), _bits(m.sky_energy_multiplier), m.sky_cover == null, _c(m.sky_cover_modulate), _c(m.ground_bottom_color), _c(m.ground_horizon_color), _bits(m.ground_curve), _bits(m.ground_energy_multiplier), _bits(m.sun_angle_max), _bits(m.sun_curve), m.use_debanding, _bits(m.energy_multiplier)]

func _physical(m: PhysicalSkyMaterial) -> Array:
\treturn [_bits(m.rayleigh_coefficient), _c(m.rayleigh_color), _bits(m.mie_coefficient), _bits(m.mie_eccentricity), _c(m.mie_color), _bits(m.turbidity), _bits(m.sun_disk_scale), _c(m.ground_color), _bits(m.energy_multiplier), m.use_debanding, m.night_sky == null]

func _f32(v: float) -> float:
\treturn PackedFloat32Array([v])[0]

# \`_setup_sky\` (rasterizer_scene_gles3.cpp:741): the visible directional lights not LIGHT_ONLY, in
# tree order, at most four; direction \`basis.xform(Vector3(0, 0, 1)).normalized()\`, energy,
# colour as authored, size \`Math::deg_to_rad(float)\`.
func _sky_lights(node: Node) -> Array:
\tvar out := []
\tfor light in node.find_children("*", "DirectionalLight3D", true, false):
\t\tvar l: DirectionalLight3D = light
\t\tif not l.is_visible_in_tree() or l.sky_mode == DirectionalLight3D.SKY_MODE_LIGHT_ONLY or out.size() >= 4:
\t\t\tcontinue
\t\tvar d := (l.global_transform.basis * Vector3(0, 0, 1)).normalized()
\t\tvar size := _f32(_f32(l.light_angular_distance) * _f32(_f32(PI) / 180.0))
\t\tout.append([_bits(d.x), _bits(d.y), _bits(d.z), _bits(l.light_energy), _bits(l.light_color.r), _bits(l.light_color.g), _bits(l.light_color.b), _bits(size)])
\treturn out

func _process(_delta: float) -> bool:
\tvar main: Node = load("res://main.tscn").instantiate()
\troot.add_child(main)
\tvar we: WorldEnvironment = main.get_node("WorldEnvironment")
\tvar env: Environment = we.environment
\tvar material: ShaderMaterial = env.sky.sky_material
\tvar cube: TextureLayered = material.get_shader_parameter("source_panorama")
\t# The headless renderer keeps no layer data: the layers are sliced from the source as the
\t# importer slices them (\`ResourceImporterLayeredTexture::import\`, 2x3, row by row), the
\t# imported cubemap's own layer count and size checked beside them.
\tvar faces: Array = [[cube.get_layers(), cube.get_width(), cube.get_height()]]
\tvar source := Image.load_from_file("res://stage/skybox.webp")
\tvar w := source.get_width() / 2
\tvar h := source.get_height() / 3
\tfor i in 3:
\t\tfor j in 2:
\t\t\tvar img: Image = source.get_region(Rect2i(w * j, h * i, w, h))
\t\t\timg.convert(Image.FORMAT_RGBA8)
\t\t\tfaces.append([img.get_width(), img.get_height(), _sha(img.get_data())])
\tvar rows := {
\t\t"environment": [env.background_mode, env.ambient_light_source, _bits(env.ambient_light_color.r), _bits(env.ambient_light_color.g), _bits(env.ambient_light_color.b), _bits(env.ambient_light_sky_contribution), _bits(env.ambient_light_energy), env.tonemap_mode, _bits(env.tonemap_exposure), _bits(env.tonemap_agx_white), env.fog_enabled, _bits(env.fog_density), _bits(env.fog_sky_affect)],
\t\t"sky": [env.sky.radiance_size, env.sky.process_mode],
\t\t"material": [material.shader.get_mode(), _bits(material.get_shader_parameter("exposure"))],
\t\t"faces": faces,
\t\t"panorama": _panorama(main.get_node("Camera").environment.sky.sky_material),
\t\t"procedural": _procedural(main.get_node("ProceduralCamera").environment.sky.sky_material),
\t\t"physical": _physical(main.get_node("PhysicalCamera").environment.sky.sky_material),
\t\t"skyLights": _sky_lights(main),
\t}
\tprint("ENVIRONMENT " + JSON.stringify(rows))
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, ...Object.fromEntries(IMAGES.flatMap((image) => [[image, sha256(readFileSync(path.join(FIXTURE, image)))], [`${image}.import`, readFileSync(path.join(FIXTURE, `${image}.import`), 'utf8')]])) })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/** Mounts the emitted main scene with R3F's own root and reads the environment through compat. */
const MOUNT = `import { createElement, act } from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import * as IMG from './src/lib/godot-compat/image';
import * as E from './src/lib/godot-compat/environment';
import * as SK from './src/lib/godot-compat/sky';
import * as SM from './src/lib/godot-compat/shader-material';
import * as SH from './src/lib/godot-compat/shader';
import * as W from './src/lib/godot-compat/world-environment';
import * as C3 from './src/lib/godot-compat/camera-3d';
import * as PS from './src/lib/godot-compat/panorama-sky-material';
import * as PR from './src/lib/godot-compat/procedural-sky-material';
import * as PH from './src/lib/godot-compat/physical-sky-material';

const require = createRequire(import.meta.url);
IMG.godot_image_webp_module(await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))));
globalThis.fetch = async (url) => {
  const bytes = readFileSync('./public' + String(url));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const { MainScene } = await import('./src/scenes/main');
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
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
for (let i = 0; i < 20 && holder.current === null; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const main = holder.current.children[0];
const we = main.getObjectByName('WorldEnvironment');
const env = W.get_environment(we);
const sky = E.get_sky(env);
const material = SK.get_material(sky);
const cube = SM.get_shader_parameter(material, 'source_panorama');
const faces = [[cube.image.length, cube.image[0].image.width, cube.image[0].image.height], ...cube.image.map((face) => [face.image.width, face.image.height, createHash('sha256').update(face.image.data).digest('hex')])];
const c = E.get_ambient_light_color(env);
const rows = {
  environment: [E.get_background(env), E.get_ambient_source(env), bits(c.r), bits(c.g), bits(c.b), bits(E.get_ambient_light_sky_contribution(env)), bits(E.get_ambient_light_energy(env)), E.get_tonemapper(env), bits(E.get_tonemap_exposure(env)), bits(E.get_tonemap_agx_white(env)), E.is_fog_enabled(env), bits(E.get_fog_density(env)), bits(E.get_fog_sky_affect(env))],
  sky: [SK.get_radiance_size(sky), SK.get_process_mode(sky)],
  material: [SH.get_mode(SM.get_shader(material)), bits(SM.get_shader_parameter(material, 'exposure'))],
  faces,
  panorama: (() => {
    const m = SK.get_material(E.get_sky(C3.get_environment(main.getObjectByName('Camera'))));
    return [PS.is_filtering_enabled(m), bits(PS.get_energy_multiplier(m)), PS.get_panorama(m) === null];
  })(),
  procedural: (() => {
    const m = SK.get_material(E.get_sky(C3.get_environment(main.getObjectByName('ProceduralCamera'))));
    const c = (v) => [bits(v.r), bits(v.g), bits(v.b), bits(v.a)];
    return [c(PR.get_sky_top_color(m)), c(PR.get_sky_horizon_color(m)), bits(PR.get_sky_curve(m)), bits(PR.get_sky_energy_multiplier(m)), PR.get_sky_cover(m) === null, c(PR.get_sky_cover_modulate(m)), c(PR.get_ground_bottom_color(m)), c(PR.get_ground_horizon_color(m)), bits(PR.get_ground_curve(m)), bits(PR.get_ground_energy_multiplier(m)), bits(PR.get_sun_angle_max(m)), bits(PR.get_sun_curve(m)), PR.get_use_debanding(m), bits(PR.get_energy_multiplier(m))];
  })(),
  physical: (() => {
    const m = SK.get_material(E.get_sky(C3.get_environment(main.getObjectByName('PhysicalCamera'))));
    const c = (v) => [bits(v.r), bits(v.g), bits(v.b), bits(v.a)];
    return [bits(PH.get_rayleigh_coefficient(m)), c(PH.get_rayleigh_color(m)), bits(PH.get_mie_coefficient(m)), bits(PH.get_mie_eccentricity(m)), c(PH.get_mie_color(m)), bits(PH.get_turbidity(m)), bits(PH.get_sun_disk_scale(m)), c(PH.get_ground_color(m)), bits(PH.get_energy_multiplier(m)), PH.get_use_debanding(m), PH.get_night_sky(m) === null];
  })(),
  skyLights: W.godot_world_environment_sky_lights(main).map((l) => [...l.direction.map(bits), bits(l.energy), ...l.color.map(bits), bits(l.size)]),
};
await act(async () => { root.unmount(); });
writeFileSync('environment.json', JSON.stringify(rows));
process.exit(0);
`;

function mountedEnvironment(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, [...NODE_MOUNT_IMPORTS, 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(readFileSync(path.join(out, 'environment.json'), 'utf8')) as unknown;
}

export async function measureSceneEnvironmentProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_ENVIRONMENT_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-environment-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      writeFileSync(path.join(project, relative), source);
    }
    for (const image of IMAGES) {
      mkdirSync(path.dirname(path.join(project, image)), { recursive: true });
      copyFileSync(path.join(FIXTURE, image), path.join(project, image));
      copyFileSync(path.join(FIXTURE, `${image}.import`), path.join(project, `${image}.import`));
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({ projectEngine: snapshot.engine, boundExporterBinary: exporterBinary, officialBinary: tools.pipelineOfficialBinary ?? officialBinary });
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
    const target = mountedEnvironment(out);

    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], { encoding: 'utf8', timeout: 180_000 });
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    }
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('ENVIRONMENT '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native environment probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('ENVIRONMENT '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-environment',
        identities: { input: actualInput, implementation: actualImplementation, observed: sha256(nativeJson), comparison: sha256(comparison) },
        agree: nativeJson === targetJson,
        detail: `native ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else console.error(`kept ${temp}`);
  }
}
