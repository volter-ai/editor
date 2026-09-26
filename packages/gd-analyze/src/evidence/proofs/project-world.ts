/**
 * The project-world proof: a project whose main scene has a script (`_ready`, `_physics_process`,
 * `_process` and `_input`, logging frame counters and action state), a current camera, a rigid
 * body falling onto a static floor, and a Label in a canvas layer whose text the script sets, run
 * by official Godot for a fixed number of frames at `--fixed-fps 60` with the Space key pressed
 * and released on chosen frames, against the emitted project's world module (`<GodotMain>` around
 * the startup transaction) mounted in Node by @react-three/fiber on a jsdom canvas, driven one
 * `advance()` per frame with the same key reaching the canvas as DOM keyboard events. It compares
 * the script's log, the actions' state, the Label's text and rect and the camera's currency
 * exactly, and the ball's height as the script reads it each physics frame within Rapier's
 * geometry (0.05). Headless Godot's root window is
 * 64x64, so the canvas is too.
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
import { GODOT_PROJECT_WORLD_IMPLEMENTATION_FILES } from '../../translate/data/lifecycle-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { linkEmittedNodeModules } from './emitted-node-modules';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';


/** The frames (iterations, from 1) the key goes down and up in, and the one whose start is read. */
const PRESS = 5;
const RELEASE = 12;
const READ = 24;
/** Rapier's geometry against Godot's solver, for the ball's origin (the physics lane's allowance). */
const BODY_TOLERANCE = 0.05;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Project world proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[input]
jump={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":32,"key_label":0,"unicode":32,"location":0,"echo":false,"script":null)
]
}

[physics]
common/physics_ticks_per_second=60
`,
  'main.gd': `extends Node3D

var log: Array = []
var heights: Array = []
@onready var status: Label = $UI/Status
@onready var ball: Node3D = $Ball

func _ready() -> void:
\tlog.append("ready")
\tlog.append(Engine.get_physics_frames())
\tlog.append(Engine.get_process_frames())

func _input(event: InputEvent) -> void:
\tlog.append("input")
\tlog.append(Engine.get_process_frames())
\tlog.append(event.is_pressed())

func _physics_process(_delta: float) -> void:
\tlog.append("physics")
\tlog.append(Engine.get_physics_frames())
\tlog.append(Input.is_action_pressed("jump"))
\tlog.append(Input.is_action_just_pressed("jump"))
\tlog.append(Input.is_action_pressed("ui_accept"))
\theights.append(ball.global_position.y)

func _process(_delta: float) -> void:
\tlog.append("process")
\tlog.append(Engine.get_process_frames())
\tlog.append(Input.is_action_pressed("jump"))
\tlog.append(Input.is_action_just_released("jump"))
\tif Input.is_action_pressed("jump"):
\t\tstatus.text = "Jumping over rocks"
\telse:
\t\tstatus.text = "Idle"
`,
  // The floor and the ball are scenes of their own (the physics families are written only as
  // idiomatic scenes), instanced by the main scene, whose Label is in the earlier shape.
  'floor.tscn': `[gd_scene load_steps=2 format=3]

[sub_resource type="BoxShape3D" id="BoxShape3D_floor"]
size = Vector3(10, 1, 10)

[node name="Floor" type="StaticBody3D"]

[node name="Shape" type="CollisionShape3D" parent="."]
shape = SubResource("BoxShape3D_floor")
`,
  'ball.tscn': `[gd_scene load_steps=2 format=3]

[sub_resource type="SphereShape3D" id="SphereShape3D_ball"]
radius = 0.5

[node name="Ball" type="RigidBody3D"]

[node name="Shape" type="CollisionShape3D" parent="."]
shape = SubResource("SphereShape3D_ball")
`,
  'main.tscn': `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://floor.tscn" id="2_floor"]
[ext_resource type="PackedScene" path="res://ball.tscn" id="3_ball"]

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Camera" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 6)
current = true

[node name="Floor" parent="." instance=ExtResource("2_floor")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0)

[node name="Ball" parent="." instance=ExtResource("3_ball")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0)

[node name="UI" type="CanvasLayer" parent="."]

[node name="Status" type="Label" parent="UI"]
offset_left = 4.0
offset_top = 4.0
text = "Idle"
`,
};

/**
 * The native probe, written into the project only after the target side has read it. It adds the
 * main scene as `Main::start` does, presses and releases Space as the web's key events arrive
 * (buffered, delivered at the next iteration), and reads at the start of iteration READ.
 */
const OBSERVE = `extends SceneTree

var frames := 0
var main: Node

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _key(pressed: bool) -> void:
\tvar event := InputEventKey.new()
\tevent.pressed = pressed
\tevent.keycode = KEY_SPACE
\tevent.physical_keycode = KEY_SPACE
\tevent.key_label = KEY_SPACE
\tevent.unicode = 32
\tInput.parse_input_event(event)

func _physics_process(_delta: float) -> bool:
\tframes += 1
\tif frames < ${String(READ)}:
\t\treturn false
\tvar rect: Rect2 = main.get_node("UI/Status").get_global_rect()
\tvar state := {
\t\t"log": main.log,
\t\t"ball": main.heights,
\t\t"label": [main.get_node("UI/Status").text, _bits(rect.position.x), _bits(rect.position.y), _bits(rect.size.x), _bits(rect.size.y)],
\t\t"camera": main.get_node("Camera").is_current(),
\t\t"actions": [Input.is_action_pressed("jump"), Input.is_action_pressed("ui_accept"), Input.is_action_pressed("ui_select")],
\t\t"window": [root.size.x, root.size.y],
\t}
\tprint("WORLD " + JSON.stringify(state))
\treturn true

func _process(_delta: float) -> bool:
\tif frames == ${String(PRESS)}:
\t\t_key(true)
\tif frames == ${String(RELEASE)}:
\t\t_key(false)
\treturn false
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, 'frames': `${String(PRESS)} ${String(RELEASE)} ${String(READ)}` })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/**
 * Mounts the emitted world module with R3F's own root on a jsdom canvas (64x64, the headless
 * window's size), waits for `<GodotMain>` to load Rapier and the font, then advances R3F one frame
 * per Godot iteration, dispatching Space on the canvas after iterations PRESS and RELEASE.
 */
const MOUNT = `import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { advance, createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as C from './src/lib/godot-compat/control';
import * as L from './src/lib/godot-compat/label';
import * as CAM from './src/lib/godot-compat/camera-3d';
import * as I from './src/lib/godot-compat/input';
import * as W from './src/lib/godot-compat/window';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
// The page serves the capability's own font file; here it is read from the emitted project.
globalThis.fetch = async (url) => {
  const bytes = readFileSync(new URL(String(url)));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const dom = new JSDOM('<!doctype html><html><body><div id="host" style="position:relative"></div></body></html>');
const document = dom.window.document;
const canvas = document.createElement('canvas');
canvas.width = 64;
canvas.height = 64;
document.getElementById('host').appendChild(canvas);
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const gl = {
  domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, getPixelRatio: () => 1,
  setAnimationLoop() {}, dispose() {}, shadowMap: {}, info: { render: {} }, capabilities: {},
  xr: { enabled: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
  getContext: () => ({}),
};
// Godot's --fixed-fps 60, as the native run uses.
godot_main_timer_sync_set_fixed_fps(60);
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 64, height: 64, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(World))); });
for (let wait = 0; wait < 500 && holder.current.children.length === 0; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = holder.current.children[0];
const key = (type) => canvas.dispatchEvent(new dom.window.KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
let time = 0;
for (let frame = 1; frame < ${String(READ)}; frame += 1) {
  await act(async () => { advance((time += 1000 / 60)); });
  if (frame === ${String(PRESS)}) key('keydown');
  if (frame === ${String(RELEASE)}) key('keyup');
}
const find = (path) => path.split('/').reduce((node, name) => N.get_children(node).find((child) => N.get_name(child) === name), main);
const status = find('UI/Status');
const rect = C.get_global_rect(status);
const size = W.get_size(holder.current.parent);
const state = {
  log: N.godot_node_object(main).log,
  ball: N.godot_node_object(main).heights,
  label: [L.get_text(status), bits(rect.position.x), bits(rect.position.y), bits(rect.size.x), bits(rect.size.y)],
  camera: CAM.is_current(find('Camera')),
  actions: [I.is_action_pressed('jump'), I.is_action_pressed('ui_accept'), I.is_action_pressed('ui_select')],
  window: [size.x, size.y],
};
await act(async () => { root.unmount(); });
console.log('WORLD ' + JSON.stringify(state));
process.exit(0);
`;

function mountedWorld(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('WORLD '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted world failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('WORLD '.length)) as unknown;
}

/** Everything but the ball exact; the ball's height at each physics frame within BODY_TOLERANCE. */
function compare(native: Record<string, unknown>, target: Record<string, unknown>): boolean {
  const { ball: nativeBall, ...nativeRest } = native;
  const { ball: targetBall, ...targetRest } = target;
  if (JSON.stringify(canonical(nativeRest)) !== JSON.stringify(canonical(targetRest))) return false;
  const a = nativeBall as number[];
  const b = targetBall as number[];
  return a.length === b.length && a.every((value, step) => Math.abs(value - (b[step] as number)) <= BODY_TOLERANCE);
}

export async function measureProjectWorldProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_PROJECT_WORLD_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-project-world-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
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
    linkEmittedNodeModules(out);
    const target = mountedWorld(out) as Record<string, unknown>;

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('WORLD '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native world probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('WORLD '.length)) as Record<string, unknown>;
    const agree = compare(native, target);
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const { ball: _ball, ...observed } = native;
    const comparison = JSON.stringify({ observed: canonical(observed), tolerance: BODY_TOLERANCE, agree });
    return [
      {
        name: 'project-world',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(JSON.stringify(canonical(observed))),
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
