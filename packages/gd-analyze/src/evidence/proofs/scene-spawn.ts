/**
 * The scene-spawn proof: a script instantiates a project scene (`preload("res://shot.tscn")
 * .instantiate()`), positions it, adds it, and frees it later, once from `_ready` and once from
 * `_physics_process`, run by official Godot and by the translation mounted in Node (R3F's root, the
 * world module, compat's SceneTree stepped at 60 Hz). Compared: the instance's name, tree state and
 * children before and after `add_child`, the node paths it is reached by, its global transform on
 * its first physics frame and after three steps (to 1e-4), the enter/ready/exit order and the
 * scene-authored signal of both instances, the deletion queue, whether a ray meets the instance
 * while it is outside the tree and after it is freed, and a falling instance removed from the tree
 * for three steps and added back (its body must neither move nor gain speed out of the tree).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_SPAWN_IMPLEMENTATION_FILES } from '../../translate/code/authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { EMITTED_RESOLVE_HOOK, linkEmittedNodeModules } from './emitted-node-modules';
import { NODE_MOUNT_IMPORTS } from '../node-assets';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7")

[rendering]
renderer/rendering_method="gl_compatibility"

[autoload]

Trace="*res://trace.gd"

[display]

window/size/viewport_width=960
window/size/viewport_height=540
`,
  'trace.gd': `extends Node

var events: Array = []
`,
  'shot.gd': `class_name Shot
extends RigidBody3D

var hits: int = 0

func _enter_tree() -> void:
\tTrace.events.append(["shot-enter", is_inside_tree()])

func _ready() -> void:
\tTrace.events.append(["shot-ready", get_children().size()])

func _exit_tree() -> void:
\tTrace.events.append(["shot-exit"])

func _on_marker_ready() -> void:
\thits += 1
\tTrace.events.append(["marker-ready-signal", hits])
`,
  'marker.gd': `extends Node3D

func _enter_tree() -> void:
\tTrace.events.append(["marker-enter"])

func _ready() -> void:
\tTrace.events.append(["marker-ready"])
`,
  'shot.tscn': `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://shot.gd" id="1"]
[ext_resource type="Script" path="res://marker.gd" id="2"]

[sub_resource type="SphereShape3D" id="Ball"]
radius = 0.25

[node name="Shot" type="RigidBody3D"]
script = ExtResource("1")

[node name="Marker" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0)
script = ExtResource("2")

[node name="Shape" type="CollisionShape3D" parent="."]
shape = SubResource("Ball")

[connection signal="ready" from="Marker" to="." method="_on_marker_ready"]
`,
  'main.gd': `extends Node3D

var trace: Array = []
var shot: Node3D
var ticks: int = 0
var done: bool = false

func _clear(x: float) -> bool:
\tvar hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, 10.0, 0.0), Vector3(x, -10.0, 0.0)))
\treturn hit.is_empty()

func _spawn(at: Vector3) -> void:
\tshot = preload("res://shot.tscn").instantiate() as Node3D
\ttrace.append(["instantiated", shot.name, shot.is_inside_tree(), shot.get_children().size(), Trace.events.size(), _clear(0.0)])
\tshot.position = at
\tadd_child(shot)
\ttrace.append(["added", shot.is_inside_tree(), shot.get_parent() == self, shot.global_position, get_node("Shot") == shot, (get_node("Shot/Marker") as Node3D).global_position])

func _ready() -> void:
\t_spawn(Vector3(1.0, 3.0, 0.0))

func _physics_process(_delta: float) -> void:
\tticks += 1
\tif ticks == 1 or ticks == 5:
\t\ttrace.append(["first-physics", ticks, shot.global_position, _clear(shot.global_position.x)])
\tif ticks == 3 or ticks == 13:
\t\tshot.queue_free()
\t\ttrace.append(["queued", ticks, shot.is_queued_for_deletion()])
\tif ticks == 4:
\t\ttrace.append(["freed", get_children().size(), get_node_or_null("Shot") == null, _clear(1.0)])
\t\t_spawn(Vector3(-1.0, 2.0, 0.0))
\tif ticks == 7:
\t\ttrace.append(["falling", shot.global_position.x, shot.global_position.y])
\t\tremove_child(shot)
\t\ttrace.append(["removed", shot.is_inside_tree(), get_children().size(), _clear(-1.0)])
\tif ticks == 10:
\t\tadd_child(shot)
\t\ttrace.append(["readded", shot.is_inside_tree(), shot.global_position.y == shot.position.y])
\tif ticks == 12:
\t\ttrace.append(["falling", shot.global_position.x, shot.global_position.y])
\tif ticks == 14:
\t\ttrace.append(["freed", get_children().size(), get_node_or_null("Shot") == null, _clear(-1.0)])
\t\tdone = true
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node3D"]
script = ExtResource("1")
`,
};

/**
 * Official Godot runs the main scene as the project does (added to the root before the first
 * iteration, one physics step per iteration) and prints the trace once the script is done. A
 * Vector3 is its components' float64 bits; the falling instance's position is compared to 1e-4.
 */
const OBSERVE = `extends SceneTree

var main: Node

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _n(value: Variant) -> Variant:
\tif value is Vector3:
\t\treturn ["v", _bits(value.x), _bits(value.y), _bits(value.z)]
\tif value is Array:
\t\tvar out := []
\t\tfor entry in value:
\t\t\tout.append(_n(entry))
\t\treturn out
\tif value is StringName:
\t\treturn str(value)
\treturn value

func _row(row: Array) -> Variant:
\tif row[0] == "falling":
\t\treturn ["falling", "%.4f" % row[1], "%.4f" % row[2]]
\treturn _n(row)

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tif not main.done:
\t\treturn false
\tvar rows := []
\tfor row in main.trace:
\t\trows.append(_row(row))
\tprint("SPAWN " + JSON.stringify({"trace": rows, "events": _n(root.get_node("Trace").events)}))
\treturn true
`;

/**
 * Mounts the emitted world module with R3F's own root and steps compat's SceneTree (one physics
 * step, then one process frame, per iteration) until the main script is done.
 */
const MOUNT = `import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as ST from './src/lib/godot-compat/scene-tree';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const n = (value) => {
  if (Array.isArray(value)) return value.map(n);
  if (value !== null && typeof value === 'object' && typeof value.x === 'number' && typeof value.z === 'number') return ['v', bits(value.x), bits(value.y), bits(value.z)];
  return value;
};
const row = (entry) => (entry[0] === 'falling' ? ['falling', entry[1].toFixed(4), entry[2].toFixed(4)] : n(entry));
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async (url) => {
  const bytes = (await import('node:fs')).readFileSync(new URL(String(url)));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const page = { addEventListener() {}, removeEventListener() {} };
const canvas = {
  width: 640, height: 480, style: {}, clientWidth: 640, clientHeight: 480, tabIndex: 0,
  ownerDocument: { defaultView: page }, focus() {},
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
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(World))); });
const findMain = () => holder.current?.children.find((child) => child.name === 'Main');
for (let wait = 0; wait < 500 && findMain() === undefined; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = findMain();
const script = () => N.godot_node_object(main);
for (let iteration = 0; iteration < 60 && script().done !== true; iteration += 1) {
  ST.godot_tree_physics_step(1 / 60);
  ST.godot_tree_frame(1 / 60);
}
const trace = script().trace.map(row);
const events = n(script().$autoload_Trace.events);
await act(async () => { root.unmount(); });
console.log('SPAWN ' + JSON.stringify({ trace, events }));
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE })
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .sort()
      .join('\n'),
  );
}

function printed(stdout: string, stderr: string, what: string): unknown {
  const line = stdout.split('\n').find((entry) => entry.startsWith('SPAWN '));
  if (line === undefined) throw new Error(`${what} printed no trace:\n${stdout}\n${stderr}`);
  return JSON.parse(line.slice('SPAWN '.length)) as unknown;
}

export async function measureSceneSpawnProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-spawn-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary: tools.pipelineOfficialBinary ?? officialBinary,
    });
    const read = () => readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority);
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(read(), toolchain.frontend.readAuthority),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      read(),
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const out = path.join(temp, 'out');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    linkEmittedNodeModules(out);
    writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
    const mounted = spawnSync(process.execPath, [...NODE_MOUNT_IMPORTS, '--import', `./${EMITTED_RESOLVE_HOOK}`, 'gd-analyze-mount.mts'], {
      cwd: out,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (mounted.error !== undefined) throw mounted.error;
    const target = printed(mounted.stdout, mounted.stderr, 'the mounted translation');

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error !== undefined) throw run.error;
    const native = printed(run.stdout, run.stderr, 'official Godot');
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const agree = nativeJson === targetJson;
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, agree });
    return [
      {
        name: 'scene-spawn',
        identities: {
          input: inputDigest(),
          implementation: monorepoImplementationDigest(GODOT_SCENE_SPAWN_IMPLEMENTATION_FILES),
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree,
        detail: `native ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else process.stdout.write(`${temp}\n`);
  }
}
