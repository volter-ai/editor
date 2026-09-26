/**
 * The scene-structure proof: a scene project built by official Godot and read back (every node's
 * path, class, global transform bits, groups and camera values), against the components the
 * production pipeline emits for the same project, mounted in Node by @react-three/fiber (its own
 * `createRoot`, with a renderer stub; nothing is drawn) and read through compat.
 *
 * The project covers instanced scenes as components (nested, with a root override and a child the
 * instancing scene adds), a plain Node between Node3Ds, groups, authored order, Node3D transforms
 * and Camera3D with defaults and authored values.
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
import { GODOT_SCENE_STRUCTURE_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const GROUPS = ['a', 'b', 'props'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene structure proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'leaf.tscn': `[gd_scene format=3]

[node name="Leaf" type="Node3D"]
transform = Transform3D(0.8, 0.6, 0, -0.6, 0.8, 0, 0, 0, 1, 0.25, 0.5, -1.5)
`,
  'prop.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://leaf.tscn" id="1_leaf"]

[node name="Prop" type="Node3D" groups=["props"]]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 1.1, 0, 0)

[node name="Arm" type="Node3D" parent="."]
transform = Transform3D(2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0.3, 0)

[node name="Leaf" parent="Arm" instance=ExtResource("1_leaf")]
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://prop.tscn" id="1_prop"]

[node name="Main" type="Node3D"]

[node name="Plain" type="Node" parent="."]

[node name="UnderPlain" type="Node3D" parent="Plain"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0.1, 0.2, 0.3)

[node name="Placed" type="Node3D" parent="." groups=["a", "b"]]
transform = Transform3D(0.36, 0.48, -0.8, -0.8, 0.6, 0, 0.48, 0.64, 0.6, 3.3, -2.2, 1.1)

[node name="Cam" type="Camera3D" parent="Placed"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.7, 5)
fov = 60.0
near = 0.1

[node name="Prop1" parent="." instance=ExtResource("1_prop")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -4, 0, 2.5)

[node name="Extra" type="Node3D" parent="Prop1"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.75)

[node name="Prop2" parent="." instance=ExtResource("1_prop")]

[node name="DefaultCam" type="Camera3D" parent="."]
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

const GROUPS := ${JSON.stringify(GROUPS)}

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(value: Vector3) -> Array:
\treturn [_bits(value.x), _bits(value.y), _bits(value.z)]

func _walk(main: Node, node: Node, rows: Array) -> void:
\tvar row := {"path": str(main.get_path_to(node)), "class": node.get_class()}
\tif node is Node3D:
\t\tvar t: Transform3D = node.global_transform
\t\trow["global"] = [_v(t.basis.x), _v(t.basis.y), _v(t.basis.z), _v(t.origin)]
\tvar groups := []
\tfor group in GROUPS:
\t\tif node.is_in_group(group):
\t\t\tgroups.append(group)
\trow["groups"] = groups
\tif node is Camera3D:
\t\trow["camera"] = [_bits(node.fov), _bits(node.near), _bits(node.far)]
\trows.append(row)
\tfor child in node.get_children():
\t\t_walk(main, child, rows)

var main: Node

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

# Read once the tree runs: a node's global transform is defined only inside the tree.
func _process(_delta: float) -> bool:
\tvar rows := []
\t_walk(main, main, rows)
\tprint("TREE " + JSON.stringify(rows))
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
 * Mounts the emitted main scene with R3F's own root and reads the mounted tree through compat. It
 * runs in the emitted project's directory, so tsx compiles the scene under that project's own
 * tsconfig (its JSX runtime), and the scene and this reader share one set of compat modules.
 */
const MOUNT = `import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import { MainScene } from './src/scenes/main';
import { is_in_group, godot_node_is_spatial } from './src/lib/godot-compat/node';
import { get_global_transform } from './src/lib/godot-compat/node-3d';
import { get_fov, get_near, get_far } from './src/lib/godot-compat/camera-3d';

const GROUPS = ${JSON.stringify(GROUPS)};
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const canvas = {
  width: 640, height: 480, style: {}, clientWidth: 640, clientHeight: 480,
  addEventListener() {}, removeEventListener() {}, getContext() { return null; },
  getBoundingClientRect() { return { width: 640, height: 480, top: 0, left: 0 }; },
};
// A renderer stub: R3F's root needs one, and nothing is drawn.
const gl = {
  domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
  setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
  xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
  getContext: () => ({}),
};
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 640, height: 480, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement(MainScene, { name: 'Main', ref: holder })); });
const rows = [];
const walk = (path, object) => {
  const spatial = godot_node_is_spatial(object);
  const className = object.type === 'PerspectiveCamera' ? 'Camera3D' : spatial ? 'Node3D' : 'Node';
  const row = { path, class: className };
  if (spatial) {
    const t = get_global_transform(object);
    const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
    row.global = [v(t.basis.x), v(t.basis.y), v(t.basis.z), v(t.origin)];
  }
  row.groups = GROUPS.filter((group) => is_in_group(object, group));
  if (className === 'Camera3D') row.camera = [bits(get_fov(object)), bits(get_near(object)), bits(get_far(object))];
  rows.push(row);
  for (const child of object.children) walk(path === '.' ? child.name : path + '/' + child.name, child);
};
walk('.', holder.current);
await act(async () => { root.unmount(); });
console.log('TREE ' + JSON.stringify(rows));
`;

function mountedTree(out: string): unknown[] {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('TREE '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('TREE '.length)) as unknown[];
}

export async function measureSceneStructureProof(
  tools: GodotProofTools,
): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_STRUCTURE_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-structure-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
    }
    // Target: the production pipeline's emitted project.
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

    // Native: the same scene instantiated by official Godot.
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('TREE '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native scene probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('TREE '.length)) as unknown[];
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-structure',
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
