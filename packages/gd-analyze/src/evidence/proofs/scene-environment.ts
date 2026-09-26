/**
 * The scene-environment proof: the platformer's stage environment (a WorldEnvironment whose
 * Environment draws a sky from a ShaderMaterial of `stage/skybox.gdshader` sampling the imported
 * cubemap `stage/skybox.webp`, a constant ambient colour, AgX tone mapping and exponential fog),
 * imported and loaded by official Godot and read back through Godot's getters (the environment's
 * background, ambient, tone mapping and fog; the sky's settings; the shader's mode and the
 * material's parameters; each cubemap face's bytes as RGBA8), against the components the production
 * pipeline emits for the same project, mounted in Node by @react-three/fiber with the copied image
 * sliced on the page, read through compat.
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
  'main.tscn': `[gd_scene load_steps=5 format=3]

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

[node name="Main" type="Node3D"]

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_vpofs")
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
};
await act(async () => { root.unmount(); });
writeFileSync('environment.json', JSON.stringify(rows));
process.exit(0);
`;

function mountedEnvironment(out: string): unknown {
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
    const toolchain = captureGodotImportToolchainSnapshot({ projectEngine: snapshot.engine, boundExporterBinary: exporterBinary, officialBinary });
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
