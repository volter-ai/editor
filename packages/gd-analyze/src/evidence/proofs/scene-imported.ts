/**
 * The scene-imported proof: a scene instancing the platformer's `enemy.glb` and `player.glb` (a
 * transform on an instance root, a node placed under a node of each model, a child of a placed
 * node, bone pose overrides on the enemy's skeleton), imported and built by official Godot and
 * read back (every node's path, class and global transform bits; each skeleton's bone names and
 * drawn bone transforms, to 1e-4; the overridden bones' poses exactly), against the emitted
 * component mounted in Node by @react-three/fiber: three's glTF loader loads the copied `.glb` and
 * compat's packed scene makes Godot's importer tree of it, its skeletons' bones the loader's joints,
 * read through compat.
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
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
const MODELS = ['enemy/enemy.glb', 'player/player.glb'] as const;

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
  'main.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="1_enemy"]
[ext_resource type="PackedScene" path="res://player/player.glb" id="2_player"]

[node name="Main" type="Node3D"]

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

[node name="Hand" type="Node3D" parent="Player/Skeleton" index="1"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0.3, 1.1, 0)

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

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tvar rows := []
\t_walk(main, main, rows)
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
import { get_children, get_name, godot_is_native, godot_node_is_spatial } from './src/lib/godot-compat/node';
import { get_global_transform } from './src/lib/godot-compat/node-3d';
import * as SK from './src/lib/godot-compat/skeleton-3d';

// Embedded images decode through createImageBitmap, which Node lacks: the tree does not read pixels.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
// three's FileLoader reports progress with the browser's ProgressEvent, which Node lacks.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
THREE.DefaultLoadingManager.setURLModifier((url) =>
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
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene, { name: 'Main' }))); });
for (let tries = 0; tries < 200 && (holder.current?.children[0]?.children.length ?? 0) === 0; tries += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
}
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
await act(async () => { root.unmount(); });
console.log('TREE ' + JSON.stringify(rows));
`;

function mountedTree(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
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
    rmSync(temp, { recursive: true, force: true });
  }
}
