/**
 * The scene-animation proof: a scene whose AnimationPlayer holds two libraries (the default one with
 * a RESET, a looping `spin` and a `take`; `extra` with `pop`), autoplays `spin`, and animates a
 * Node3D's rotation and scale, an OmniLight3D's range, energy (with an eased key) and shadow flag (a
 * discrete track), another Node3D's position and scale (3D tracks), and calls the root script's
 * function and the light's native `set_param` from method tracks. Official Godot runs it at
 * `--fixed-fps 60`, the probe playing `take`, queueing `extra/pop`, replaying `spin` with a seek and
 * stopping on fixed frames; the emitted world runs the same frames mounted in Node by
 * @react-three/fiber on a jsdom canvas, one `advance()` per frame, the same calls made on the same
 * frames through compat.
 *
 * Exact, every frame: each animated value's float bits, the player's current animation, position
 * and playing flag, the script's recorded calls, and the player's signals with the frame each
 * arrived on.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_ANIMATION_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { linkEmittedNodeModules } from './emitted-node-modules';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

/** The frames read, and the calls the probe makes before reading a frame. */
const FRAMES = 96;
/** The tree parameters the probe sets before reading a frame. */
const TREE_ACTS: Readonly<Record<number, readonly (readonly [string, number])[]>> = {
  24: [['parameters/blend/blend_amount', 0.8]],
  40: [['parameters/scale/scale', 0.5]],
  64: [['parameters/blend/blend_amount', 0], ['parameters/scale/scale', 2]],
};
const ACTS: Readonly<Record<number, readonly (readonly [string, ...(string | number | boolean)[]])[]>> = {
  20: [['play', 'take'], ['queue', 'extra/pop']],
  72: [['play', 'spin'], ['seek', 1.5, true]],
  88: [['stop']],
};

const value = (text: string): string => text;
const track = (index: number, type: string, trackPath: string, keys: string): string =>
  [
    `tracks/${String(index)}/type = "${type}"`,
    `tracks/${String(index)}/imported = false`,
    `tracks/${String(index)}/enabled = true`,
    `tracks/${String(index)}/path = NodePath("${trackPath}")`,
    `tracks/${String(index)}/interp = 1`,
    `tracks/${String(index)}/loop_wrap = true`,
    `tracks/${String(index)}/keys = ${keys}`,
  ].join('\n');
const keys = (times: string, transitions: string, update: number | undefined, values: string): string =>
  `{\n"times": PackedFloat32Array(${times}),\n"transitions": PackedFloat32Array(${transitions}),\n${update === undefined ? '' : `"update": ${String(update)},\n`}"values": [${values}]\n}`;
const call = (method: string, args: string): string => `{\n"args": [${args}],\n"method": &"${method}"\n}`;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
/** The platformer's enemy model, whose AnimationPlayer the scene gives the enemy scene's walk. */
const COPIED = ['enemy/enemy.glb', 'enemy/enemy.glb.import'] as const;
/** The enemy scene's own `walk` (its bone tracks, keyed as Godot's importer saved them). */
const WALK = ((): string => {
  const source = readFileSync(path.join(FIXTURE, 'enemy/enemy.tscn'), 'utf8');
  const start = source.indexOf('[sub_resource type="Animation" id="Animation_ce6v8"]');
  return source.slice(start, source.indexOf('\n[', start + 1)).trim();
})();
/** The robot's bones the walk moves: body, eyes and the four legs. */
const WALKED_BONES = [1, 2, 3, 5, 7, 9] as const;

const MAIN = `[gd_scene load_steps=8 format=3]

[ext_resource type="Script" path="res://probe.gd" id="1_probe"]
[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="2_enemy"]

${WALK}

[sub_resource type="Animation" id="Animation_ta"]
resource_name = "a"
length = 1.0
loop_mode = 1
${track(0, 'position_3d', 'Mover2', value('PackedFloat32Array(0, 1, 0, 0, 0, 1, 1, 2, 0, 0)'))}
${track(1, 'value', 'Circle2:rotation', keys('0, 1', '1, 1', 0, 'Vector3(0, 0, 0), Vector3(0, 3, 0)'))}

[sub_resource type="Animation" id="Animation_tb"]
resource_name = "b"
length = 0.8
${track(0, 'position_3d', 'Mover2', value('PackedFloat32Array(0, 1, 0, 0, 0, 0.8, 1, 0, 2, -1)'))}
${track(1, 'value', 'Circle2:rotation', keys('0, 0.8', '1, 1', 0, 'Vector3(1, 0, 0), Vector3(0, 0, 1)'))}

[sub_resource type="AnimationLibrary" id="AnimationLibrary_rig"]
_data = {
&"a": SubResource("Animation_ta"),
&"b": SubResource("Animation_tb")
}

[sub_resource type="AnimationNodeAnimation" id="Node_a"]
animation = &"a"

[sub_resource type="AnimationNodeAnimation" id="Node_b"]
animation = &"b"

[sub_resource type="AnimationNodeTimeScale" id="Node_scale"]

[sub_resource type="AnimationNodeBlend2" id="Node_blend"]
filter_enabled = true
filters = ["Mover2"]

[sub_resource type="AnimationNodeBlendTree" id="Tree_root"]
nodes/a/node = SubResource("Node_a")
nodes/a/position = Vector2(-200, 0)
nodes/b/node = SubResource("Node_b")
nodes/scale/node = SubResource("Node_scale")
nodes/blend/node = SubResource("Node_blend")
node_connections = [&"output", 0, &"blend", &"blend", 0, &"a", &"blend", 1, &"scale", &"scale", 0, &"b"]

[sub_resource type="AnimationLibrary" id="AnimationLibrary_robot"]
_data = {
&"walk": SubResource("Animation_ce6v8")
}

[sub_resource type="Animation" id="Animation_reset"]
length = 0.001
${track(0, 'value', 'Circle:rotation', keys('0', '1', 0, 'Vector3(1.5708, 0, 0)'))}
${track(1, 'value', 'Glow:omni_range', keys('0', '1', 0, '5.0'))}
${track(2, 'value', 'Glow:shadow_enabled', keys('0', '1', 1, 'true'))}

[sub_resource type="Animation" id="Animation_spin"]
resource_name = "spin"
length = 2.0
loop_mode = 1
${track(0, 'value', 'Circle:rotation', keys('0, 2', '1, 1', 0, 'Vector3(1.5708, 6.28319, 0), Vector3(1.5708, 0, 0)'))}
${track(1, 'value', 'Glow:light_energy', keys('0, 1, 2', '1, 0.5, 1', 0, '1.0, 3.0, 1.0'))}

[sub_resource type="Animation" id="Animation_take"]
resource_name = "take"
length = 0.5
${track(0, 'value', 'Glow:omni_range', keys('0, 0.5', '-2, -2', 0, '5.0, 0.0'))}
${track(1, 'value', 'Glow:shadow_enabled', keys('0, 0.25', '1, 1', 1, 'true, false'))}
${track(2, 'method', '.', keys('0.1', '1', undefined, call('note', '"took"')))}
${track(3, 'method', 'Glow', keys('0.3', '1', undefined, call('set_param', '0, 2.5')))}
${track(4, 'position_3d', 'Mover', value('PackedFloat32Array(0, 1, 0, 0, 0, 0.5, 1, 1, 2, 3)'))}
${track(5, 'scale_3d', 'Mover', value('PackedFloat32Array(0, 1, 1, 1, 1, 0.5, 1, 2, 2, 2)'))}

[sub_resource type="AnimationLibrary" id="AnimationLibrary_main"]
_data = {
&"RESET": SubResource("Animation_reset"),
&"spin": SubResource("Animation_spin"),
&"take": SubResource("Animation_take")
}

[sub_resource type="Animation" id="Animation_pop"]
resource_name = "pop"
length = 0.25
${track(0, 'value', 'Circle:scale', keys('0, 0.25', '1, 1', 0, 'Vector3(1, 1, 1), Vector3(2, 1, 2)'))}
${track(1, 'method', '.', keys('0.25', '1', undefined, call('note', '"popped"')))}

[sub_resource type="AnimationLibrary" id="AnimationLibrary_extra"]
_data = {
&"pop": SubResource("Animation_pop")
}

[node name="Main" type="Node3D"]
script = ExtResource("1_probe")

[node name="Circle" type="Node3D" parent="."]

[node name="Glow" type="OmniLight3D" parent="."]

[node name="Mover" type="Node3D" parent="."]

[node name="Animation" type="AnimationPlayer" parent="."]
libraries/ = SubResource("AnimationLibrary_main")
libraries/extra = SubResource("AnimationLibrary_extra")
autoplay = &"spin"

[node name="Robot" parent="." instance=ExtResource("2_enemy")]

[node name="AnimationPlayer" parent="Robot" index="1"]
libraries/ = SubResource("AnimationLibrary_robot")
autoplay = &"walk"

[node name="Mover2" type="Node3D" parent="."]

[node name="Circle2" type="Node3D" parent="."]

[node name="Rig" type="AnimationPlayer" parent="."]
libraries/ = SubResource("AnimationLibrary_rig")

[node name="Tree" type="AnimationTree" parent="."]
tree_root = SubResource("Tree_root")
anim_player = NodePath("../Rig")
parameters/blend/blend_amount = 0.3
parameters/scale/scale = 1.5

[editable path="Robot"]
`;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene animation proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'probe.gd': `extends Node3D

var notes: Array = []


func note(what: String) -> void:
\tnotes.append(what)
`,
  'main.tscn': MAIN,
};

const gdLiteral = (entry: string | number | boolean): string => (typeof entry === 'string' ? JSON.stringify(entry) : String(entry));

const OBSERVE = `extends SceneTree

var frames := 0
var main: Node
var rows := []
var signals := []

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(v: Vector3) -> Array:
\treturn [_bits(v.x), _bits(v.y), _bits(v.z)]

func _q(q: Quaternion) -> Array:
\treturn [_bits(q.x), _bits(q.y), _bits(q.z), _bits(q.w)]

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _physics_process(_delta: float) -> bool:
\tframes += 1
\tvar anim: AnimationPlayer = main.get_node("Animation")
\t# Connected once the scene runs, as the target connects once its world has mounted.
\tif frames == 1:
\t\tanim.animation_started.connect(func(n): signals.append(["started", String(n), frames]))
\t\tanim.animation_finished.connect(func(n): signals.append(["finished", String(n), frames]))
\t\tanim.animation_changed.connect(func(o, n): signals.append(["changed", String(o), String(n), frames]))
\t\tanim.current_animation_changed.connect(func(n): signals.append(["current", String(n), frames]))
\t\tvar tree_node: AnimationTree = main.get_node("Tree")
\t\ttree_node.animation_started.connect(func(n): signals.append(["tree-started", String(n), frames]))
\t\ttree_node.animation_finished.connect(func(n): signals.append(["tree-finished", String(n), frames]))
${Object.entries(TREE_ACTS)
  .map(([frame, sets]) => `\tif frames == ${frame}:\n${sets.map(([name, set]) => `\t\tmain.get_node("Tree").set(${JSON.stringify(name)}, ${String(set)})`).join('\n')}`)
  .join('\n')}
${Object.entries(ACTS)
  .map(([frame, calls]) => `\tif frames == ${frame}:\n${calls.map(([method, ...args]) => `\t\tanim.${method}(${args.map(gdLiteral).join(', ')})`).join('\n')}`)
  .join('\n')}
\tvar circle: Node3D = main.get_node("Circle")
\tvar glow: OmniLight3D = main.get_node("Glow")
\tvar mover: Node3D = main.get_node("Mover")
\tvar skeleton: Skeleton3D = main.get_node("Robot/Skeleton/Skeleton3D")
\tvar bones := []
\tfor bone in [${WALKED_BONES.join(', ')}]:
\t\tbones.append([_v(skeleton.get_bone_pose_position(bone)), _q(skeleton.get_bone_pose_rotation(bone))])
\trows.append([_v(circle.rotation), _v(circle.scale), _bits(glow.omni_range), _bits(glow.light_energy), glow.shadow_enabled, _v(mover.position), _v(mover.scale), String(anim.current_animation), _bits(anim.get_current_animation_position() if anim.is_animation_active() else -1.0), anim.is_playing(), main.notes.duplicate(), bones, _v(main.get_node("Mover2").position), _v(main.get_node("Circle2").rotation), _bits(main.get_node("Tree").get("parameters/a/current_position")), _bits(main.get_node("Tree").get("parameters/b/current_position"))])
\tif frames < ${String(FRAMES)}:
\t\treturn false
\tvar file := FileAccess.open("res://animation.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"rows": rows, "signals": signals}))
\tfile.close()
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, ...Object.fromEntries(COPIED.map((relative) => [relative, readFileSync(path.join(FIXTURE, relative))])) })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

const MOUNT = `import { createElement, act, Fragment } from 'react';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { advance, createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as N3 from './src/lib/godot-compat/node-3d';
import * as L3 from './src/lib/godot-compat/light-3d';
import * as AM from './src/lib/godot-compat/animation-mixer';
import * as AP from './src/lib/godot-compat/animation-player';
import * as SK from './src/lib/godot-compat/skeleton-3d';
import * as AT from './src/lib/godot-compat/animation-tree';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const text = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (text.startsWith('data:')) return nodeFetch(url, init);
  const bytes = readFileSync(text.startsWith('file:') ? new URL(text) : './public' + text);
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
// The robot model's embedded images decode through createImageBitmap, which Node lacks; three's
// FileLoader reports progress with ProgressEvent. The copied model is served as a data URL, to three
// and to drei's CommonJS three alike (as the scene-imported proof does).
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
const modelUrl = (url) => (url.startsWith('/godot/') ? 'data:model/gltf-binary;base64,' + readFileSync('public' + url).toString('base64') : url);
THREE.DefaultLoadingManager.setURLModifier(modelUrl);
const { createRequire } = await import('node:module');
createRequire(import.meta.url)('three').DefaultLoadingManager.setURLModifier(modelUrl);
const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
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
godot_main_timer_sync_set_fixed_fps(60);
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 64, height: 64, top: 0, left: 0 }, frameloop: 'never' });
const holder = { current: null };
await act(async () => { root.render(createElement(Fragment, null, createElement('group', { ref: holder, name: 'Probe' }), createElement(World))); });
const scene = () => holder.current?.parent;
const findMain = () => scene()?.children.find((child) => child.name === 'Main');
for (let wait = 0; wait < 2000 && findMain() === undefined; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = findMain();
const find = (name) => N.get_children(main).find((child) => N.get_name(child) === name);
const anim = find('Animation');
const circle = find('Circle');
const glow = find('Glow');
const mover = find('Mover');
const skeleton = N.get_node(main, 'Robot/Skeleton/Skeleton3D');
const q = (value) => [bits(value.x), bits(value.y), bits(value.z), bits(value.w)];
const script = N.godot_node_object(main);
const acts = ${JSON.stringify(ACTS)};
const calls = { play: AP.play, queue: AP.queue, seek: AP.seek, stop: AP.stop };
let frames = 1;
const signals = [];
AM.godot_animation_mixer_signal(anim, 'animation_started').connect((n) => signals.push(['started', n, frames]));
AM.godot_animation_mixer_signal(anim, 'animation_finished').connect((n) => signals.push(['finished', n, frames]));
AP.godot_animation_player_signal(anim, 'animation_changed').connect((o, n) => signals.push(['changed', o, n, frames]));
AP.godot_animation_player_signal(anim, 'current_animation_changed').connect((n) => signals.push(['current', n, frames]));
const treeNode = find('Tree');
AM.godot_animation_mixer_signal(treeNode, 'animation_started').connect((n) => signals.push(['tree-started', n, frames]));
AM.godot_animation_mixer_signal(treeNode, 'animation_finished').connect((n) => signals.push(['tree-finished', n, frames]));
const treeActs = ${JSON.stringify(TREE_ACTS)};
const rows = [];
let time = 0;
for (frames = 1; frames <= ${String(FRAMES)}; frames += 1) {
  if (frames > 1) {
    frames -= 1;
    await act(async () => { advance((time += 1000 / 60)); });
    frames += 1;
  }
  for (const [method, ...args] of acts[frames] ?? []) calls[method](anim, ...args);
  for (const [name, set] of treeActs[frames] ?? []) AT.godot_animation_tree_set(treeNode, name, set);
  rows.push([v(N3.get_rotation(circle)), v(N3.get_scale(circle)), bits(L3.get_param(glow, 4)), bits(L3.get_param(glow, 0)), L3.has_shadow(glow), v(N3.get_position(mover)), v(N3.get_scale(mover)), AP.get_current_animation(anim), bits(AP.is_animation_active(anim) ? AP.get_current_animation_position(anim) : -1), AP.is_playing(anim), [...script.notes], ${JSON.stringify(WALKED_BONES)}.map((bone) => [v(SK.get_bone_pose_position(skeleton, bone)), q(SK.get_bone_pose_rotation(skeleton, bone))]), v(N3.get_position(find('Mover2'))), v(N3.get_rotation(find('Circle2'))), bits(AT.godot_animation_tree_get(treeNode, 'parameters/a/current_position')), bits(AT.godot_animation_tree_get(treeNode, 'parameters/b/current_position'))]);
}
await act(async () => { root.unmount(); });
const { writeFileSync } = await import('node:fs');
writeFileSync('animation.json', JSON.stringify({ rows, signals }));
process.exit(0);
`;

function mountedWorld(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const file = path.join(out, 'animation.json');
  if (run.error !== undefined || run.status !== 0 || !existsSync(file)) {
    throw new Error(`mounting the emitted world failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 8000)}`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

/** Where two JSON values differ, by path: the first of each. */
function differences(a: unknown, b: unknown, at = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = a.length === b.length ? [] : [`${at} length ${String(a.length)} vs ${String(b.length)}`];
    for (let index = 0; index < Math.min(a.length, b.length) && out.length < 20; index += 1) out.push(...differences(a[index], b[index], `${at}[${String(index)}]`));
    return out;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`),
    );
  }
  return [`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
}

export async function measureSceneAnimationProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_ANIMATION_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-animation-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
    for (const relative of COPIED) {
      mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      cpSync(path.join(FIXTURE, relative), path.join(project, relative));
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary,
    });
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
    linkEmittedNodeModules(out);
    const target = mountedWorld(out);

    // Native: Godot's editor imports the model by its sidecar, then the scene runs.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], { encoding: 'utf8', timeout: 300_000 });
    if (imported.error !== undefined || imported.status !== 0) throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    const written = path.join(project, 'animation.json');
    if (run.error !== undefined || !existsSync(written)) {
      throw new Error(`native animation probe failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 4000)}`);
    }
    const native = JSON.parse(readFileSync(written, 'utf8')) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const agree = nativeJson === targetJson;
    const comparison = JSON.stringify({ native: sha256(nativeJson), agree });
    return [
      {
        name: 'scene-animation',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree,
        detail: `differences ${JSON.stringify(differences(native, target).slice(0, 20))}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else process.stdout.write(`${temp}\n`);
  }
}
