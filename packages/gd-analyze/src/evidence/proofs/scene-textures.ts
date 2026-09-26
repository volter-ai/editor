/**
 * The scene-textures proof: images from the platformer (PNG and lossless WebP, with and without
 * alpha, premultiplied, edge-fixed, with mipmaps) and their `.import` sidecars, used by a
 * TextureRect, a Sprite2D and two StandardMaterial3Ds (the default filter and repeat, and
 * nearest without repeat), imported by official Godot and read back through Godot's getters (each
 * texture's image: width, height, format, mipmap count and the SHA-256 of every byte; each
 * material's filter and repeat flag), against the components the production pipeline emits for the
 * same project, mounted in Node by @react-three/fiber with the images fetched from their copies:
 * a material's map read from three (its image through compat's texture registry, its sampler
 * against the GL filters the Compatibility renderer sets for the material's filter), a canvas
 * item's texture through compat's getters.
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
import { GODOT_SCENE_TEXTURE_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';
import { readFileSync } from 'node:fs';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
/** The platformer's images this proof imports, with their `.import` sidecars. */
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const IMAGES = [
  'touch_screen_ui/virtual_joystick/textures/joystick_base_outline.png',
  'player/controls/osb_jump.webp',
  'stage/tiles_albedo.webp',
  'particle.webp',
] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene textures proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=8 format=3]

[ext_resource type="Texture2D" path="res://${IMAGES[0]}" id="1_base"]
[ext_resource type="Texture2D" path="res://${IMAGES[1]}" id="2_jump"]
[ext_resource type="Texture2D" path="res://${IMAGES[2]}" id="3_tiles"]
[ext_resource type="Texture2D" path="res://${IMAGES[3]}" id="4_particle"]

[sub_resource type="QuadMesh" id="QuadMesh_q"]

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_tiles"]
albedo_texture = ExtResource("3_tiles")

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_particle"]
albedo_texture = ExtResource("4_particle")
texture_filter = 0
texture_repeat = false

[node name="Main" type="Node3D"]

[node name="Tiles" type="MeshInstance3D" parent="."]
mesh = SubResource("QuadMesh_q")
surface_material_override/0 = SubResource("StandardMaterial3D_tiles")

[node name="Spark" type="MeshInstance3D" parent="."]
mesh = SubResource("QuadMesh_q")
surface_material_override/0 = SubResource("StandardMaterial3D_particle")

[node name="UI" type="CanvasLayer" parent="."]

[node name="Base" type="TextureRect" parent="UI"]
texture = ExtResource("1_base")

[node name="Jump" type="Sprite2D" parent="UI"]
texture = ExtResource("2_jump")
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _image(texture: Texture2D) -> Array:
\tvar img := texture.get_image()
\tvar ctx := HashingContext.new()
\tctx.start(HashingContext.HASH_SHA256)
\tctx.update(img.get_data())
\treturn [img.get_width(), img.get_height(), img.get_format(), img.get_mipmap_count(), ctx.finish().hex_encode()]

func _process(_delta: float) -> bool:
\tvar main: Node = load("res://main.tscn").instantiate()
\troot.add_child(main)
\tvar rows := {}
\tfor name in ["Tiles", "Spark"]:
\t\tvar m: StandardMaterial3D = main.get_node(name).get_surface_override_material(0)
\t\trows[name] = [m.texture_filter, m.get_flag(BaseMaterial3D.FLAG_USE_TEXTURE_REPEAT), _image(m.albedo_texture)]
\trows["Base"] = _image(main.get_node("UI/Base").texture)
\trows["Jump"] = _image(main.get_node("UI/Jump").texture)
\tprint("TEXTURES " + JSON.stringify(rows))
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
import * as T2D from './src/lib/godot-compat/texture-2d';
import * as TR from './src/lib/godot-compat/texture-rect';
import * as S from './src/lib/godot-compat/sprite-2d';
import { godot_resource_loader_settled } from './src/lib/godot-compat/resource-loader';

const require = createRequire(import.meta.url);
IMG.godot_image_webp_module(await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))));
globalThis.fetch = async (url) => {
  const bytes = readFileSync('./public' + String(url));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const { MainScene } = await import('./src/scenes/main');
await godot_resource_loader_settled();
const image = (texture) => {
  const img = T2D.get_image(texture);
  return [IMG.get_width(img), IMG.get_height(img), IMG.get_format(img), IMG.get_mipmap_count(img), createHash('sha256').update(IMG.get_data(img)).digest('hex')];
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
// The scene suspends while its materials' textures load.
for (let wait = 0; wait < 1000 && holder.current.children.length === 0; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = holder.current.children[0];
const find = (name) => main.getObjectByName(name);
const rows = {};
const FILTER = { 1003: 'NEAREST', 1006: 'LINEAR', 1005: 'NEAREST_MIPMAP_LINEAR', 1008: 'LINEAR_MIPMAP_LINEAR', 1004: 'NEAREST_MIPMAP_NEAREST', 1007: 'LINEAR_MIPMAP_NEAREST' };
const WRAP = { 1000: 'REPEAT', 1001: 'CLAMP_TO_EDGE' };
for (const name of ['Tiles', 'Spark']) {
  // The sampler three was given, and the image its map holds.
  const map = find(name).material.map;
  rows[name] = [[FILTER[map.magFilter], FILTER[map.minFilter], WRAP[map.wrapS], WRAP[map.wrapT]], image(map)];
}
rows.Base = image(TR.get_texture(find('Base')));
rows.Jump = image(S.get_texture(find('Jump')));
await act(async () => { root.unmount(); });
console.log('TEXTURES ' + JSON.stringify(rows));
process.exit(0);
`;

function mountedTextures(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('TEXTURES '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('TEXTURES '.length)) as unknown;
}

/**
 * The GL filters and wraps the Compatibility renderer sets for a material's `texture_filter`
 * (`TextureStorage::gl_set_filter`, `texture_storage.h:252`, `use_nearest_mip_filter` off) over an
 * image of `mipmaps` levels, and its repeat flag (`gl_set_repeat`).
 */
function samplerOf(filter: number, mipmaps: number, repeat: boolean): readonly string[] {
  const nearest = filter === 0 || filter === 2 || filter === 4;
  const mag = nearest ? 'NEAREST' : 'LINEAR';
  const min = filter <= 1 || mipmaps <= 1 ? mag : nearest ? 'NEAREST_MIPMAP_LINEAR' : 'LINEAR_MIPMAP_LINEAR';
  const wrap = repeat ? 'REPEAT' : 'CLAMP_TO_EDGE';
  return [mag, min, wrap, wrap];
}

export async function measureSceneTexturesProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_TEXTURE_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-textures-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
    }
    for (const image of IMAGES) {
      mkdirSync(path.dirname(path.join(project, image)), { recursive: true });
      copyFileSync(path.join(FIXTURE, image), path.join(project, image));
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
    const target = mountedTextures(out);

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
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('TEXTURES '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native textures probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('TEXTURES '.length)) as Readonly<Record<string, readonly unknown[]>>;
    // A material's filter and repeat flag as the GL sampler the Compatibility renderer sets for it.
    const expected = Object.fromEntries(
      Object.entries(native).map(([name, row]) => {
        if (name !== 'Tiles' && name !== 'Spark') return [name, row];
        const [filter, repeat, image] = row as [number, boolean, readonly unknown[]];
        return [name, [samplerOf(filter, (image[3] as number) + 1, repeat), image]];
      }),
    );
    const nativeJson = JSON.stringify(canonical(expected));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-textures',
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
