/**
 * The scene-imported proof: a scene instancing the platformer's `enemy.glb` and `player.glb` (a
 * transform on an instance root, a node placed under a node of each model, a child of a placed
 * node, bone pose overrides on the enemy's skeleton), imported and built by official Godot and
 * read back (every node's path, class and global transform bits; each skeleton's bone names and
 * drawn bone transforms, to 1e-4; the overridden bones' poses exactly), against the emitted
 * component mounted in Node by @react-three/fiber: three's glTF loader loads the copied `.glb` and
 * compat's packed scene makes Godot's importer tree of it, its skeletons' bones the loader's joints,
 * read through compat. A scene inheriting enemy.glb (a bone scale override and a node placed into
 * its skeleton) is instanced too. Two starter-kit models referencing one image outside their files
 * (`Textures/colormap.png`) read back each mesh's albedo texture path, filter and repeat, and
 * whether the two models sample one texture.
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
import { GODOT_SCENE_IMPORTED_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { NODE_MOUNT_IMPORTS } from '../node-assets';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const MODELS = ['enemy/enemy.glb', 'player/player.glb'] as const;
/** Kit models whose images are outside their files, with the image they share. */
const KIT = path.join(PACKAGE_ROOT, 'test/fixtures/starter-kit-3d-platformer');
const KIT_FILES = ['models/block-coin.glb', 'models/brick.glb', 'models/Textures/colormap.png'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene imported proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  // The scene's script reads a node it places into the player model as \`%Hand\` (a unique name
  // the scene root owns through the placement).
  'main.gd': `extends Node3D

var hand: String = ""

func _ready() -> void:
\thand = str(%Hand.name)
`,
  // A scene inheriting enemy.glb: a bone pose override on its skeleton and a node placed into it.
  'enemy_edit.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="1_enemy"]

[node name="EnemyEdit" instance=ExtResource("1_enemy")]

[node name="Skeleton3D" parent="Skeleton" index="0"]
bones/2/scale = Vector3(1.25, 1.25, 1.25)

[node name="Flag" type="Node3D" parent="Skeleton" index="1"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.5, 0)
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="1_enemy"]
[ext_resource type="PackedScene" path="res://player/player.glb" id="2_player"]
[ext_resource type="PackedScene" path="res://enemy_edit.tscn" id="4_edit"]

[ext_resource type="Script" path="res://main.gd" id="3_main"]
[ext_resource type="PackedScene" path="res://models/block-coin.glb" id="5_block"]
[ext_resource type="PackedScene" path="res://models/brick.glb" id="6_brick"]

[node name="Main" type="Node3D"]
script = ExtResource("3_main")

[node name="Enemy" parent="." instance=ExtResource("1_enemy")]
transform = Transform3D(0.8, 0, -0.6, 0, 1, 0, 0.6, 0, 0.8, 1.5, 0, -2)

[node name="Skeleton3D" parent="Enemy/Skeleton" index="0"]
bones/1/position = Vector3(-5.04871e-28, 0.661877, 0)
bones/1/rotation = Quaternion(0.70710677, -2.4853694e-07, -1.9540794e-07, 0.70710677)
bones/3/rotation = Quaternion(1, -2.4919705e-38, 7.54979e-08, -1.05879e-22)
bones/5/scale = Vector3(1.5, 0.5, 1)

[node name="Marker" type="Node3D" parent="Enemy/Skeleton" index="1"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0.25)

[node name="Tip" type="Node3D" parent="Enemy/Skeleton/Marker"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0.125, 0, 0)

[node name="Player" parent="." instance=ExtResource("2_player")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -3, 0.2, 1)

[node name="Robot" parent="Player/Skeleton/Skeleton3D" index="0"]
layers = 2

[node name="Hand" type="Node3D" parent="Player/Skeleton" index="1"]
unique_name_in_owner = true
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0.3, 1.1, 0)

[node name="Edited" parent="." instance=ExtResource("4_edit")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 0, 0)

[node name="BlockA" parent="." instance=ExtResource("5_block")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 3)

[node name="BlockB" parent="." instance=ExtResource("6_brick")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 3)

[editable path="Enemy"]
`,
};

const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(value: Vector3) -> Array:
\treturn [_bits(value.x), _bits(value.y), _bits(value.z)]

# A bone's drawn transform is three's float64 composition of its pose: compared to 1e-4.
func _n(value: float) -> String:
\treturn "%.4f" % (0.0 if absf(value) < 0.00005 else value)

func _r(value: Vector3) -> Array:
\treturn [_n(value.x), _n(value.y), _n(value.z)]

func _walk(main: Node, node: Node, rows: Array) -> void:
\tvar row := {"path": str(main.get_path_to(node)), "class": node.get_class()}
\tif node is Node3D:
\t\tvar t: Transform3D = node.global_transform
\t\trow["global"] = [_v(t.basis.x), _v(t.basis.y), _v(t.basis.z), _v(t.origin)]
\tif node is VisualInstance3D:
\t\trow["layers"] = node.layers
# A kit model's material: its albedo texture's path, filter and repeat.
\tif node is MeshInstance3D and str(main.get_path_to(node)).begins_with("Block"):
\t\tvar albedo := []
\t\tfor i in node.mesh.get_surface_count():
\t\t\tvar m: BaseMaterial3D = node.get_active_material(i)
\t\t\talbedo.append([m.albedo_texture.resource_path, m.texture_filter, m.get_flag(BaseMaterial3D.FLAG_USE_TEXTURE_REPEAT)])
\t\t\ttextures.append(m.albedo_texture)
\t\trow["albedo"] = albedo
\tif node is Skeleton3D:
\t\tvar bones := []
\t\tfor i in node.get_bone_count():
\t\t\tvar g: Transform3D = node.global_transform * node.get_bone_global_pose(i)
\t\t\tvar bone := [node.get_bone_name(i), _r(g.basis.x) + _r(g.basis.y) + _r(g.basis.z) + _r(g.origin)]
\t\t\t# The components main.tscn overrides.
\t\t\tif str(main.get_path_to(node)).begins_with("Enemy"):
\t\t\t\tvar q: Quaternion = node.get_bone_pose_rotation(i)
\t\t\t\tif i == 1:
\t\t\t\t\tbone.append(_v(node.get_bone_pose_position(i)))
\t\t\t\tif i == 1 or i == 3:
\t\t\t\t\tbone.append([_bits(q.x), _bits(q.y), _bits(q.z), _bits(q.w)])
\t\t\t\tif i == 5:
\t\t\t\t\tbone.append(_v(node.get_bone_pose_scale(i)))
\t\t\tbones.append(bone)
\t\trow["bones"] = bones
\trows.append(row)
\tfor child in node.get_children():
\t\t_walk(main, child, rows)

var main: Node
var textures := []

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tvar rows := []
\t_walk(main, main, rows)
\trows.append(["hand", main.hand])
\trows.append(["shared", textures.size() > 1 and textures.all(func(t): return t == textures[0])])
\tprint("TREE " + JSON.stringify(rows))
\treturn true
`;

function inputDigest(): string {
  return sha256(
    [
      ...Object.entries({ ...files, 'observe.gd': OBSERVE }).map(([relative, source]) => `${relative}\0${sha256(source)}`),
      ...MODELS.flatMap((model) =>
        [model, `${model}.import`].map((relative) => `${relative}\0${sha256(readFileSync(path.join(FIXTURE, relative)))}`),
      ),
      ...KIT_FILES.flatMap((file) =>
        [file, `${file}.import`].map((relative) => `kit/${relative}\0${sha256(readFileSync(path.join(KIT, relative)))}`),
      ),
    ]
      .sort()
      .join('\n'),
  );
}

/**
 * Mounts the emitted main scene with R3F's own root, the copied models served to three's loader
 * as data URLs (Node has no HTTP origin), and reads the Godot nodes through compat.
 */
const MOUNT = `import { readFileSync } from 'node:fs';
import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import { MainScene } from './src/scenes/main';
import { GodotProjectStartup } from './src/lib/godot-compat/react-lifecycle';
import { godot_tree_set_root } from './src/lib/godot-compat/scene-tree';
import { get_children, get_name, godot_is_native, godot_node_enter_pending, godot_node_is_spatial, godot_node_object } from './src/lib/godot-compat/node';
import { get_global_transform } from './src/lib/godot-compat/node-3d';
import * as SK from './src/lib/godot-compat/skeleton-3d';
import { get_layer_mask } from './src/lib/godot-compat/visual-instance-3d';
import { godot_base_material_3d_map_texture } from './src/lib/godot-compat/base-material-3d';
import { godot_compressed_texture_2d_source } from './src/lib/godot-compat/compressed-texture-2d';

// Embedded images decode through createImageBitmap, which Node lacks: the tree does not read pixels.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
// three's FileLoader reports progress with the browser's ProgressEvent, which Node lacks.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
THREE.DefaultLoadingManager.setURLModifier((url) =>
  url.startsWith('/godot/') ? 'data:model/gltf-binary;base64,' + readFileSync('public' + url).toString('base64') : url);
// compat fetches an imported image's copied file.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) =>
  typeof url === 'string' && url.startsWith('/godot/') ? new Response(readFileSync('public' + url)) : nativeFetch(url, init);
// The texture filter a three map samples with, as Godot's BaseMaterial3D::TextureFilter.
const FILTER = (map) =>
  map.magFilter === THREE.NearestFilter ? (map.minFilter === THREE.NearestFilter ? 0 : 2) : map.minFilter === THREE.LinearFilter ? 1 : 3;
const textures = [];
// drei's loader loads through three's CommonJS build in Node (the project's bundle has one three):
// it serves the project's copied asset the same way.
const { createRequire } = await import('node:module');
createRequire(import.meta.url)('three').DefaultLoadingManager.setURLModifier((url) =>
  url.startsWith('/godot/') ? 'data:model/gltf-binary;base64,' + readFileSync('public' + url).toString('base64') : url);
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const CLASSES = ['Skeleton3D', 'MeshInstance3D', 'AnimationPlayer', 'Node3D', 'Node'];
const n = (value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
const classOf = (object) => CLASSES.find((name) => godot_is_native(object, name));
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
// Mounted as the world mounts a scene: under the tree root, inside the startup transaction.
const setRoot = (group) => {
  holder.current = group;
  if (group !== null) godot_tree_set_root(group);
};
await act(async () => { root.render(createElement('group', { ref: setRoot }, createElement(GodotProjectStartup, null, createElement(MainScene, { name: 'Main' })))); });
for (let tries = 0; tries < 200 && (holder.current?.children[0]?.children.length ?? 0) === 0; tries += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
}
// The SceneTree enters what React registered (Main::start readies the main scene before the first frame).
godot_node_enter_pending();
const rows = [];
holder.current.updateMatrixWorld(true);
const v3 = (value) => [bits(value.x), bits(value.y), bits(value.z)];
const walk = (path, object) => {
  const className = classOf(object);
  const row = { path, class: className };
  if (godot_node_is_spatial(object)) {
    const t = get_global_transform(object);
    const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
    row.global = [v(t.basis.x), v(t.basis.y), v(t.basis.z), v(t.origin)];
  }
  if (className === 'MeshInstance3D') {
    // The node's mask, when every three mesh drawing it (itself and the per-surface meshes the
    // loader made below it, which are not Godot nodes) is drawn on that mask.
    const mask = get_layer_mask(object);
    const drawn = [];
    const surfaces = (o) => {
      if (o.isMesh) drawn.push(o.layers.mask);
      const nodes = new Set(get_children(o));
      for (const child of o.children) if (!nodes.has(child)) surfaces(child);
    };
    surfaces(object);
    row.layers = drawn.length > 0 && drawn.every((entry) => entry === mask) ? mask : ['drawn', drawn];
    // A kit model's material: its albedo texture's path, filter and repeat.
    if (path.startsWith('Block')) {
      const maps = [];
      const materials = (o) => {
        if (o.isMesh) maps.push(o.material.map);
        const nodes = new Set(get_children(o));
        for (const child of o.children) if (!nodes.has(child)) materials(child);
      };
      materials(object);
      row.albedo = maps.map((map) => {
        const texture = godot_base_material_3d_map_texture(map);
        textures.push(texture);
        const source = godot_compressed_texture_2d_source(texture) ?? '';
        return [source.startsWith('/godot/') ? 'res://' + source.slice('/godot/'.length) : source, FILTER(map), map.wrapS === THREE.RepeatWrapping];
      });
    }
  }
  if (className === 'Skeleton3D') {
    const bones = [];
    for (let i = 0; i < SK.get_bone_count(object); i += 1) {
      // The drawn bone: its three object's world matrix, the basis columns then the origin.
      const e = SK.godot_skeleton_3d_bone_object(object, i).matrixWorld.elements;
      const bone = [SK.get_bone_name(object, i), [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]].map(n)];
      // The components main.tscn overrides.
      if (path.startsWith('Enemy')) {
        const q = SK.get_bone_pose_rotation(object, i);
        if (i === 1) bone.push(v3(SK.get_bone_pose_position(object, i)));
        if (i === 1 || i === 3) bone.push([bits(q.x), bits(q.y), bits(q.z), bits(q.w)]);
        if (i === 5) bone.push(v3(SK.get_bone_pose_scale(object, i)));
      }
      bones.push(bone);
    }
    row.bones = bones;
  }
  rows.push(row);
  for (const child of get_children(object)) {
    walk(path === '.' ? get_name(child) : path + '/' + get_name(child), child);
  }
};
walk('.', holder.current.children[0]);
rows.push(['hand', godot_node_object(holder.current.children[0]).hand]);
rows.push(['shared', textures.length > 1 && textures.every((texture) => texture === textures[0])]);
await act(async () => { root.unmount(); });
console.log('TREE ' + JSON.stringify(rows));
`;

function mountedTree(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, [...NODE_MOUNT_IMPORTS, 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('TREE '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('TREE '.length)) as unknown;
}

export async function measureSceneImportedProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_IMPORTED_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-imported-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
    for (const model of MODELS) {
      mkdirSync(path.join(project, path.dirname(model)), { recursive: true });
      for (const relative of [model, `${model}.import`]) {
        copyFileSync(path.join(FIXTURE, relative), path.join(project, relative));
      }
    }
    for (const file of KIT_FILES) {
      mkdirSync(path.join(project, path.dirname(file)), { recursive: true });
      for (const relative of [file, `${file}.import`]) copyFileSync(path.join(KIT, relative), path.join(project, relative));
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary: tools.pipelineOfficialBinary ?? officialBinary,
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
    const target = mountedTree(out);

    // Native: Godot imports the models, then instantiates the scene.
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
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('TREE '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native imported-scene probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('TREE '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-imported',
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
    else process.stdout.write(`${temp}\n`);
  }
}
