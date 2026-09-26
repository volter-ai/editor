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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const MAIN = `[gd_scene load_steps=8 format=3]

[ext_resource type="Script" path="res://probe.gd" id="1_probe"]

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
${Object.entries(ACTS)
  .map(([frame, calls]) => `\tif frames == ${frame}:\n${calls.map(([method, ...args]) => `\t\tanim.${method}(${args.map(gdLiteral).join(', ')})`).join('\n')}`)
  .join('\n')}
\tvar circle: Node3D = main.get_node("Circle")
\tvar glow: OmniLight3D = main.get_node("Glow")
\tvar mover: Node3D = main.get_node("Mover")
\trows.append([_v(circle.rotation), _v(circle.scale), _bits(glow.omni_range), _bits(glow.light_energy), glow.shadow_enabled, _v(mover.position), _v(mover.scale), String(anim.current_animation), _bits(anim.get_current_animation_position() if anim.is_animation_active() else -1.0), anim.is_playing(), main.notes.duplicate()])
\tif frames < ${String(FRAMES)}:
\t\treturn false
\tvar file := FileAccess.open("res://animation.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify({"rows": rows, "signals": signals}))
\tfile.close()
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
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
globalThis.fetch = async (url) => {
  const text = String(url);
  const bytes = readFileSync(text.startsWith('file:') ? new URL(text) : './public' + text);
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
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
const script = N.godot_node_object(main);
const acts = ${JSON.stringify(ACTS)};
const calls = { play: AP.play, queue: AP.queue, seek: AP.seek, stop: AP.stop };
let frames = 1;
const signals = [];
AM.godot_animation_mixer_signal(anim, 'animation_started').connect((n) => signals.push(['started', n, frames]));
AM.godot_animation_mixer_signal(anim, 'animation_finished').connect((n) => signals.push(['finished', n, frames]));
AP.godot_animation_player_signal(anim, 'animation_changed').connect((o, n) => signals.push(['changed', o, n, frames]));
AP.godot_animation_player_signal(anim, 'current_animation_changed').connect((n) => signals.push(['current', n, frames]));
const rows = [];
let time = 0;
for (frames = 1; frames <= ${String(FRAMES)}; frames += 1) {
  if (frames > 1) {
    frames -= 1;
    await act(async () => { advance((time += 1000 / 60)); });
    frames += 1;
  }
  for (const [method, ...args] of acts[frames] ?? []) calls[method](anim, ...args);
  rows.push([v(N3.get_rotation(circle)), v(N3.get_scale(circle)), bits(L3.get_param(glow, 4)), bits(L3.get_param(glow, 0)), L3.has_shadow(glow), v(N3.get_position(mover)), v(N3.get_scale(mover)), AP.get_current_animation(anim), bits(AP.is_animation_active(anim) ? AP.get_current_animation_position(anim) : -1), AP.is_playing(anim), [...script.notes]]);
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
