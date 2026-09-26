/**
 * The scene-meshes proof: the platformer's binary `ArrayMesh` resources (`stage/meshes/*.res`,
 * which name `stage/tile_material.tres` over two imported textures as their surface material)
 * instanced by MeshInstance3Ds, loaded by official Godot and read back through Godot's getters
 * (each mesh's surface count, each surface's primitive and the SHA-256 of each of its 13 arrays'
 * bytes as `surface_get_arrays` returns them, its material's filter, repeat flag and textures'
 * image digests), against the components the production pipeline emits for the same project,
 * mounted in Node by @react-three/fiber, read through compat's getters.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_MESH_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';
import { readFileSync } from 'node:fs';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
/** The platformer's images this proof imports, with their `.import` sidecars. */
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const MESHES = ['stage/meshes/floor.res', 'stage/meshes/wall.res', 'stage/meshes/tree_top.res', 'stage/meshes/ramp.res'] as const;
/** The files the project copies from the platformer: the meshes, their material and its images. */
const IMAGES = [
  ...MESHES,
  'stage/tile_material.tres',
  'stage/tiles_albedo.webp',
  'stage/tiles_rough.webp',
] as const;
const SIDECARS = ['stage/tiles_albedo.webp', 'stage/tiles_rough.webp'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene meshes proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

${MESHES.map((mesh, index) => `[ext_resource type="ArrayMesh" path="res://${mesh}" id="${String(index + 1)}_mesh"]`).join('\n')}

[node name="Main" type="Node3D"]

[node name="Sign" type="Label3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 17.2106, 6, -1.99773)
pixel_size = 0.01
double_sided = false
no_depth_test = true
modulate = Color(0.301961, 0.623529, 0.862745, 1)
text = "You have found
a secret area!"
font_size = 48
${MESHES.map((mesh, index) => `
[node name="Mesh${String(index)}" type="MeshInstance3D" parent="."]
mesh = ExtResource("${String(index + 1)}_mesh")`).join('\n')}
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _hash(bytes: PackedByteArray) -> String:
\tvar ctx := HashingContext.new()
\tctx.start(HashingContext.HASH_SHA256)
\tctx.update(bytes)
\treturn ctx.finish().hex_encode()

func _image(texture: Texture2D) -> Variant:
\tif texture == null:
\t\treturn null
\treturn _hash(texture.get_image().get_data())

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(value: Vector3) -> Array:
\treturn [_bits(value.x), _bits(value.y), _bits(value.z)]

var main: Node
var frames := 0

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

# A Label3D lays its text out in a deferred call: read on the second frame.
func _process(_delta: float) -> bool:
\tframes += 1
\tif frames < 2:
\t\treturn false
\tvar rows := {}
\tvar sign: Label3D = main.get_node("Sign")
\trows["Sign"] = [sign.text, sign.font_size, _bits(sign.pixel_size), sign.get_draw_flag(1), sign.get_draw_flag(2), [_bits(sign.modulate.r), _bits(sign.modulate.g), _bits(sign.modulate.b), _bits(sign.modulate.a)], [_v(sign.get_aabb().position), _v(sign.get_aabb().size)]]
\tfor node in main.get_children():
\t\tif not node is MeshInstance3D:
\t\t\tcontinue
\t\tvar mesh: Mesh = node.mesh
\t\tvar surfaces := []
\t\tfor s in mesh.get_surface_count():
\t\t\tvar arrays := []
\t\t\tfor a in mesh.surface_get_arrays(s):
\t\t\t\tarrays.append(null if a == null else _hash(a.to_byte_array()))
\t\t\tvar m: StandardMaterial3D = mesh.surface_get_material(s)
\t\t\tsurfaces.append([mesh.surface_get_primitive_type(s), arrays, null if m == null else [m.texture_filter, m.get_flag(BaseMaterial3D.FLAG_USE_TEXTURE_REPEAT), _image(m.albedo_texture), _image(m.roughness_texture)]])
\t\trows[node.name] = [mesh.resource_name, surfaces]
\tprint("MESHES " + JSON.stringify(rows))
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, ...Object.fromEntries(IMAGES.map((image) => [image, sha256(readFileSync(path.join(FIXTURE, image)))])), ...Object.fromEntries(SIDECARS.map((image) => [`${image}.import`, readFileSync(path.join(FIXTURE, `${image}.import`), 'utf8')])) })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/**
 * Mounts the emitted main scene with R3F's own root and reads each texture through compat. The
 * WebP decoder is handed its module and `fetch` reads the copied files before the scene module (whose
 * textures start loading when it is evaluated) is imported; the reads wait for every load.
 */
const MOUNT = `import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import * as IMG from './src/lib/godot-compat/image';
import * as B from './src/lib/godot-compat/base-material-3d';
import * as T2D from './src/lib/godot-compat/texture-2d';
import * as AM from './src/lib/godot-compat/mesh';
import { get_mesh } from './src/lib/godot-compat/mesh-instance-3d';
import * as L3 from './src/lib/godot-compat/label-3d';
import * as VI from './src/lib/godot-compat/visual-instance-3d';
import * as F from './src/lib/godot-compat/font';
import { godot_message_queue_flush } from './src/lib/godot-compat/object';
import { godot_resource_loader_settled } from './src/lib/godot-compat/resource-loader';

const require = createRequire(import.meta.url);
IMG.godot_image_webp_module(await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))));
globalThis.fetch = async (url) => {
  const bytes = readFileSync('./public' + String(url));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
F.godot_font_default(F.godot_font_load(new Uint8Array(readFileSync('./src/lib/godot-compat/OpenSans_SemiBold.woff2'))));
const { MainScene } = await import('./src/scenes/main');
await godot_resource_loader_settled();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const image = (texture) => (texture === null ? null : hash(IMG.get_data(T2D.get_image(texture))));
const floats = (values) => new Uint8Array(new Float32Array(values).buffer);
const packed = (array, index) => {
  if (array === null) return null;
  if (index === 12) return hash(new Uint8Array(new Int32Array(array).buffer));
  if (index === 0 || index === 1) return hash(floats(array.flatMap((v) => [v.x, v.y, v.z])));
  if (index === 4 || index === 5) return hash(floats(array.flatMap((v) => [v.x, v.y])));
  return hash(floats(array));
};
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
godot_message_queue_flush();
const rows = {};
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
const sign = main.getObjectByName('Sign');
const box = VI.get_aabb(sign);
const m = L3.get_modulate(sign);
rows.Sign = [L3.get_text(sign), L3.get_font_size(sign), bits(L3.get_pixel_size(sign)), L3.get_draw_flag(sign, 1), L3.get_draw_flag(sign, 2), [m.r, m.g, m.b, m.a].map(bits), [v(box.position), v(box.size)]];
for (const node of main.children) {
  if (node.name === 'Sign') continue;
  const mesh = get_mesh(node);
  const surfaces = [];
  for (let s = 0; s < AM.get_surface_count(mesh); s += 1) {
    const m = AM.surface_get_material(mesh, s);
    surfaces.push([3, AM.surface_get_arrays(mesh, s).map(packed), m === null ? null : [B.get_texture_filter(m), B.get_flag(m, 16), image(B.get_texture(m, 0)), image(B.get_texture(m, 2))]]);
  }
  rows[node.name] = [mesh.resource_name, surfaces];
}
await act(async () => { root.unmount(); });
console.log('MESHES ' + JSON.stringify(rows));
process.exit(0);
`;

function mountedMeshes(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('MESHES '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('MESHES '.length)) as unknown;
}

export async function measureSceneMeshesProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_MESH_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-meshes-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
    }
    for (const image of IMAGES) {
      mkdirSync(path.dirname(path.join(project, image)), { recursive: true });
      copyFileSync(path.join(FIXTURE, image), path.join(project, image));
    }
    for (const image of SIDECARS) {
      copyFileSync(path.join(FIXTURE, `${image}.import`), path.join(project, `${image}.import`));
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
    const target = mountedMeshes(out);

    // Native: Godot's editor imports the images by their sidecars, then the scene is instantiated.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], {
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    }
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('MESHES '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native meshes probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('MESHES '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-meshes',
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
