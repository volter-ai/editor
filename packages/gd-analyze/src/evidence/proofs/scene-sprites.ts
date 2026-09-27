/**
 * The scene-sprites proof: the fps and city-builder kits' sprite nodes as they author them — a
 * Sprite3D selector drawing an imported image, a muzzle AnimatedSprite3D over a SpriteFrames `.tres`
 * of AtlasTexture cells with an empty last frame (authored at that frame, on render layer 2), and an
 * impact AnimatedSprite3D over the scene's own SpriteFrames (its animation named, one-sided, no depth
 * test, no shadow, a small pixel size) whose `animation_finished` is connected to the root's script — with
 * a root script that restarts the muzzle and plays both as it becomes ready. Official Godot imports
 * the kit's lossless images and runs the scene at a fixed 60 fps, each sprite read after every
 * frame (animation, frame, progress bits, playing, AABB bits, whether it draws, its texture's size)
 * and the impact's finished count; against the emitted world mounted in Node by @react-three/fiber
 * on a jsdom canvas, one `advance()` per frame, read through compat.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_SPRITES_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { EMITTED_RESOLVE_HOOK, linkEmittedNodeModules } from './emitted-node-modules';
import { NODE_MOUNT_IMPORTS } from '../node-assets';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
/** The fps kit's lossless sprite images (the kit's own sprite sheets are VRAM- or lossy-compressed). */
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/starter-kit-fps');
const IMAGES = ['sprites/blob_shadow.png', 'sprites/crosshair-repeater.png'] as const;
const FRAMES = 14;
const SPRITES = ['Selector', 'Muzzle', 'Impact'] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene sprites proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'sprites/burst_animation.tres': `[gd_resource type="SpriteFrames" load_steps=4 format=3]

[ext_resource type="Texture2D" path="res://sprites/blob_shadow.png" id="1_blob"]

[sub_resource type="AtlasTexture" id="AtlasTexture_left"]
atlas = ExtResource("1_blob")
region = Rect2(0, 0, 128, 256)

[sub_resource type="AtlasTexture" id="AtlasTexture_right"]
atlas = ExtResource("1_blob")
region = Rect2(128, 0, 128, 256)

[resource]
animations = [{
"frames": [{
"duration": 1.0,
"texture": SubResource("AtlasTexture_left")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_right")
}, {
"duration": 1.0,
"texture": null
}],
"loop": false,
"name": &"default",
"speed": 30.0
}]
`,
  'main.gd': `extends Node3D

@onready var muzzle = $Muzzle
var finished := 0


func _on_impact_finished():
	finished += 1


func _ready():
	muzzle.frame = 0
	muzzle.play("default")
	$Impact.play("shot")
`,
  'main.tscn': `[gd_scene load_steps=11 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="Texture2D" path="res://sprites/blob_shadow.png" id="2_blob"]
[ext_resource type="Texture2D" path="res://sprites/crosshair-repeater.png" id="3_cross"]
[ext_resource type="SpriteFrames" path="res://sprites/burst_animation.tres" id="4_burst"]

[sub_resource type="AtlasTexture" id="AtlasTexture_a"]
atlas = ExtResource("3_cross")
region = Rect2(0, 0, 64, 64)

[sub_resource type="AtlasTexture" id="AtlasTexture_b"]
atlas = ExtResource("3_cross")
region = Rect2(64, 0, 64, 64)

[sub_resource type="AtlasTexture" id="AtlasTexture_c"]
atlas = ExtResource("3_cross")
region = Rect2(0, 64, 64, 64)

[sub_resource type="AtlasTexture" id="AtlasTexture_d"]
atlas = ExtResource("3_cross")
region = Rect2(64, 64, 64, 64)

[sub_resource type="SpriteFrames" id="SpriteFrames_shot"]
animations = [{
"frames": [{
"duration": 1.0,
"texture": SubResource("AtlasTexture_a")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_b")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_c")
}, {
"duration": 1.0,
"texture": SubResource("AtlasTexture_d")
}],
"loop": false,
"name": &"shot",
"speed": 30.0
}]

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Selector" type="Sprite3D" parent="."]
transform = Transform3D(1, 0, 0, 0, -4.37114e-08, -1, 0, 1, -4.37114e-08, 0, 0.06, 0)
texture = ExtResource("2_blob")

[node name="Muzzle" type="AnimatedSprite3D" parent="."]
transform = Transform3D(0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, -0.45, 0.3, 0.4)
layers = 2
sprite_frames = ExtResource("4_burst")
frame = 2

[node name="Impact" type="AnimatedSprite3D" parent="."]
cast_shadow = 0
pixel_size = 0.0025
double_sided = false
no_depth_test = true
sprite_frames = SubResource("SpriteFrames_shot")
animation = &"shot"

[connection signal="animation_finished" from="Impact" to="." method="_on_impact_finished"]
`,
};

/**
 * The native probe: the main scene is added to the root as the probe starts. `MainLoop::_process`
 * runs before the tree's nodes process (`SceneTree::process`, scene_tree.cpp:700), so the read at
 * the start of frame k + 1 is the state after k frames: the first read (before any frame) is
 * dropped, and ${String(FRAMES)} are kept.
 */
const OBSERVE = `extends SceneTree

var frames := 0
var rows := []
var main: Node

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _sprite(s: SpriteBase3D) -> Array:
\tvar box := s.get_aabb()
\tvar row := [_bits(box.position.x), _bits(box.position.y), _bits(box.size.x), _bits(box.size.y), s.get_base().is_valid(), _bits(s.pixel_size), s.get_draw_flag(0), s.get_draw_flag(2), s.get_draw_flag(3), s.layers, s.cast_shadow]
\tif s is AnimatedSprite3D:
\t\tvar t: Texture2D = s.sprite_frames.get_frame_texture(s.animation, s.frame)
\t\trow.append_array([String(s.animation), s.frame, _bits(s.frame_progress), s.is_playing(), null if t == null else [t.get_width(), t.get_height()]])
\telse:
\t\trow.append([s.texture.get_width(), s.texture.get_height()])
\treturn row

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tframes += 1
\tvar row := []
\tfor name in ${JSON.stringify(SPRITES)}:
\t\trow.append(_sprite(main.get_node(name)))
\trow.append(main.finished)
\tif frames > 1:
\t\trows.append(row)
\tif frames < ${String(FRAMES + 1)}:
\t\treturn false
\tvar file := FileAccess.open("res://sprites.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(rows))
\tfile.close()
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({
      ...files,
      'observe.gd': OBSERVE,
      ...Object.fromEntries(IMAGES.flatMap((image) => [[image, sha256(readFileSync(path.join(FIXTURE, image)))], [`${image}.import`, readFileSync(path.join(FIXTURE, `${image}.import`), 'utf8')]])),
    })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

/**
 * Mounts the emitted world (its <GodotMain> enters the main scene and steps Godot's frame from R3F's)
 * on a jsdom canvas, the images fetched from their copies; after each `advance()` every sprite is
 * read through compat.
 */
const MOUNT = `import { createElement, act, Fragment } from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { advance, createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as SB from './src/lib/godot-compat/sprite-base-3d';
import * as S3 from './src/lib/godot-compat/sprite-3d';
import * as AS from './src/lib/godot-compat/animated-sprite-3d';
import * as SF from './src/lib/godot-compat/sprite-frames';
import * as T2D from './src/lib/godot-compat/texture-2d';
import * as VI from './src/lib/godot-compat/visual-instance-3d';
import * as GI from './src/lib/godot-compat/geometry-instance-3d';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
globalThis.fetch = async (url) => {
  const text = String(url);
  const bytes = readFileSync(text.startsWith('file:') ? new URL(text) : './public' + text);
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
const size = (t) => [T2D.get_width(t), T2D.get_height(t)];
const sprite = (s, animated) => {
  const box = VI.get_aabb(s);
  const row = [bits(box.position.x), bits(box.position.y), bits(box.size.x), bits(box.size.y), SB.godot_sprite_base_3d_surface(s).based, bits(SB.get_pixel_size(s)), SB.get_draw_flag(s, 0), SB.get_draw_flag(s, 2), SB.get_draw_flag(s, 3), VI.get_layer_mask(s), GI.get_cast_shadows_setting(s)];
  if (animated) {
    const t = SF.get_frame_texture(AS.get_sprite_frames(s), AS.get_animation(s), AS.get_frame(s));
    row.push(AS.get_animation(s), AS.get_frame(s), bits(AS.get_frame_progress(s)), AS.is_playing(s), t === null ? null : size(t));
  } else {
    row.push(size(S3.get_texture(s)));
  }
  return row;
};
const rows = [];
let time = 0;
for (let frame = 0; frame < ${String(FRAMES)}; frame += 1) {
  await act(async () => { advance((time += 1000 / 60)); });
  const impact = find('Impact');
  rows.push([sprite(find('Selector'), false), sprite(find('Muzzle'), true), sprite(impact, true), N.godot_node_object(main).finished]);
}
await act(async () => { root.unmount(); });
writeFileSync('sprites.json', JSON.stringify(rows));
process.exit(0);
`;

function mountedWorld(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, [...NODE_MOUNT_IMPORTS, '--import', `./${EMITTED_RESOLVE_HOOK}`, 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const file = path.join(out, 'sprites.json');
  if (run.error !== undefined || run.status !== 0 || !existsSync(file)) {
    throw new Error(`mounting the emitted world failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 8000)}`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

export async function measureSceneSpritesProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_SPRITES_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-sprites-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(path.join(project, 'sprites'), { recursive: true });
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
    for (const image of IMAGES) {
      copyFileSync(path.join(FIXTURE, image), path.join(project, image));
      copyFileSync(path.join(FIXTURE, `${image}.import`), path.join(project, `${image}.import`));
    }
    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary: tools.pipelineOfficialBinary ?? officialBinary,
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

    // Native: Godot's editor imports the images by their sidecars, then the scene runs.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], { encoding: 'utf8', timeout: 300_000 });
    if (imported.error !== undefined || imported.status !== 0) throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    const written = path.join(project, 'sprites.json');
    if (run.error !== undefined || !existsSync(written)) {
      throw new Error(`native sprites probe failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 4000)}`);
    }
    const native = JSON.parse(readFileSync(written, 'utf8')) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-sprites',
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
