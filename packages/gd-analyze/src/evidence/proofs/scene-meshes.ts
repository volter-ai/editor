/**
 * The scene-meshes proof: the platformer's binary `ArrayMesh` resources (`stage/meshes/*.res`,
 * which name `stage/tile_material.tres` over two imported textures as their surface material)
 * instanced by MeshInstance3Ds, loaded by official Godot and read back through Godot's getters
 * (each surface's primitive and its 13 arrays as `surface_get_arrays` returns them, its material's
 * filter, repeat flag and textures' image digests), against the scene the production pipeline
 * emits for the same project (each mesh a `<bufferGeometry>` over its data file, its material
 * three's), mounted in Node by @react-three/fiber and read from the three objects: each array
 * converted back from three's conventions (winding, UV origin, tangent handedness) and hashed as
 * Godot's bytes, the maps' images read through compat's texture registry.
 *
 * Exact: every array but the UVs, the maps' images, and the samplers three was given against the
 * GL filters the Compatibility renderer sets for the material's filter
 * (`TextureStorage::gl_set_filter`, `texture_storage.h:252`). Measured and named: the UVs, whose
 * `1 - v` round trip through float32 is exact to half a float32 step at 1 (`uv-origin`).
 * Recorded: the anisotropic filters' anisotropy, which three is not given (`anisotropy`), and the
 * roughness map three samples in its green channel where Godot samples the material's
 * `roughness_texture_channel` (red; equal for these grey images). The Label3D's text layout and
 * AABB are exact (`label-3d.ts`).
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
\t\t\tvar uvs := []
\t\t\tvar all := mesh.surface_get_arrays(s)
\t\t\tfor i in all.size():
\t\t\t\tvar a = all[i]
\t\t\t\tif (i == Mesh.ARRAY_TEX_UV or i == Mesh.ARRAY_TEX_UV2) and a != null:
\t\t\t\t\tvar flat := []
\t\t\t\t\tfor uv in a:
\t\t\t\t\t\tflat.append_array([uv.x, uv.y])
\t\t\t\t\tuvs.append(flat)
\t\t\t\t\tarrays.append("uv")
\t\t\t\telse:
\t\t\t\t\tarrays.append(null if a == null else _hash(a.to_byte_array()))
\t\t\tvar m: StandardMaterial3D = mesh.surface_get_material(s)
\t\t\tvar material = null
\t\t\tif m != null:
\t\t\t\tvar mipmaps: int = m.albedo_texture.get_image().get_mipmap_count() + 1 if m.albedo_texture != null else 1
\t\t\t\tmaterial = [m.texture_filter, m.get_flag(BaseMaterial3D.FLAG_USE_TEXTURE_REPEAT), mipmaps, _image(m.albedo_texture), _image(m.roughness_texture)]
\t\t\tsurfaces.append([mesh.surface_get_primitive_type(s), arrays, material, uvs])
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
import * as T2D from './src/lib/godot-compat/texture-2d';
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
const image = (texture) => (texture === null || texture === undefined ? null : hash(IMG.get_data(T2D.get_image(texture))));
const f32 = (values) => hash(new Uint8Array(Float32Array.from(values).buffer));
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
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene))); });
// The scene suspends while its textures load.
for (let wait = 0; wait < 1000 && holder.current.children.length === 0; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = holder.current.children[0];
godot_message_queue_flush();
const rows = {};
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
const sign = main.getObjectByName('Sign');
const box = VI.get_aabb(sign);
const m = L3.get_modulate(sign);
rows.Sign = [L3.get_text(sign), L3.get_font_size(sign), bits(L3.get_pixel_size(sign)), L3.get_draw_flag(sign, 1), L3.get_draw_flag(sign, 2), [m.r, m.g, m.b, m.a].map(bits), [v(box.position), v(box.size)]];
const FILTER = { 1003: 'NEAREST', 1006: 'LINEAR', 1005: 'NEAREST_MIPMAP_LINEAR', 1008: 'LINEAR_MIPMAP_LINEAR', 1004: 'NEAREST_MIPMAP_NEAREST', 1007: 'LINEAR_MIPMAP_NEAREST' };
const WRAP = { 1000: 'REPEAT', 1001: 'CLAMP_TO_EDGE' };
for (const node of main.children) {
  if (node.name === 'Sign') continue;
  const geometry = node.geometry;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  const groups = geometry.groups.length === 0 ? [{ start: 0, count: geometry.index.count, materialIndex: 0 }] : geometry.groups;
  const surfaces = groups.map((group) => {
    // The surface's vertices: the range its indices reach.
    const own = Array.from(geometry.index.array.slice(group.start, group.start + group.count));
    const first = Math.min(...own);
    const last = Math.max(...own);
    const attribute = (name) => {
      const found = geometry.getAttribute(name);
      return found === undefined ? null : Array.from(found.array.slice(first * found.itemSize, (last + 1) * found.itemSize));
    };
    // Back from three's conventions: each triangle's last two indices exchanged again, v to 1 - v,
    // a tangent's handedness flipped back.
    const index = [];
    for (let i = 0; i + 2 < own.length; i += 3) index.push(own[i] - first, own[i + 2] - first, own[i + 1] - first);
    const tangent = attribute('tangent');
    const uv = attribute('uv');
    const uv1 = attribute('uv1');
    const arrays = [
      f32(attribute('position')),
      attribute('normal') === null ? null : f32(attribute('normal')),
      tangent === null ? null : f32(tangent.map((value, i) => (i % 4 === 3 ? -value : value))),
      attribute('color') === null ? null : f32(attribute('color')),
      uv === null ? null : 'uv',
      uv1 === null ? null : 'uv',
      null, null, null, null, null, null,
      hash(new Uint8Array(Int32Array.from(index).buffer)),
    ];
    const uvs = [uv, uv1].filter((entry) => entry !== null).map((flat) => flat.map((value, i) => (i % 2 === 1 ? 1 - value : value)));
    const material = materials[group.materialIndex];
    const map = material.map ?? null;
    const sampler = map === null ? null : [FILTER[map.magFilter], FILTER[map.minFilter], WRAP[map.wrapS], WRAP[map.wrapT]];
    return [3, arrays, material === undefined ? null : [sampler, image(map), image(material.roughnessMap ?? null)], uvs];
  });
  rows[node.name] = [surfaces];
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

/** `1 - v` rounded to float32 and back: half a float32 step at 1. */
const UV_ORIGIN_TOLERANCE = 2 ** -25;

function maxDifference(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return a.reduce((worst, value, index) => Math.max(worst, Math.abs(value - (b[index] as number))), 0);
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
    const native = JSON.parse(line.slice('MESHES '.length)) as Readonly<Record<string, readonly unknown[]>>;
    const drawn = target as Readonly<Record<string, readonly unknown[]>>;
    // Godot's side as three must hold it: the samplers the Compatibility renderer sets for the
    // material's filter, the UVs apart; the target's likewise.
    let uvOrigin = 0;
    let anisotropic = false;
    const expected: Record<string, unknown> = {};
    const measured: Record<string, unknown> = {};
    for (const [name, row] of Object.entries(native)) {
      if (name === 'Sign') {
        expected[name] = row;
        measured[name] = drawn[name];
        continue;
      }
      const surfaces = row[1] as readonly (readonly [number, readonly unknown[], readonly [number, boolean, number, unknown, unknown] | null, readonly (readonly number[])[]])[];
      const targetSurfaces = ((drawn[name] ?? [])[0] ?? []) as readonly (readonly [number, readonly unknown[], readonly [unknown, unknown, unknown] | null, readonly (readonly number[])[]])[];
      expected[name] = surfaces.map(([primitive, arrays, material]) => {
        if (material === null) return [primitive, arrays, null];
        const [filter, repeat, mipmaps, albedo, roughness] = material;
        if (filter >= 4) anisotropic = true;
        return [primitive, arrays, [samplerOf(filter, mipmaps, repeat), albedo, roughness]];
      });
      measured[name] = targetSurfaces.map(([primitive, arrays, material]) => [primitive, arrays, material]);
      surfaces.forEach(([, , , uvs], index) => {
        const theirs = targetSurfaces[index]?.[3] ?? [];
        uvs.forEach((values, set) => {
          uvOrigin = Math.max(uvOrigin, maxDifference(values, theirs[set] ?? []));
        });
      });
    }
    const nativeJson = JSON.stringify(canonical(expected));
    const targetJson = JSON.stringify(canonical(measured));
    const agree = nativeJson === targetJson && uvOrigin <= UV_ORIGIN_TOLERANCE;
    const comparison = JSON.stringify({ native: nativeJson, tolerances: { 'uv-origin': UV_ORIGIN_TOLERANCE }, anisotropy: anisotropic ? 'recorded' : 'absent', agree });
    return [
      {
        name: 'scene-meshes',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(JSON.stringify(canonical(native))),
          comparison: sha256(comparison),
        },
        agree,
        detail: `uv-origin ${String(uvOrigin)}\nnative ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
