/**
 * The scene-ui proof: a touch-screen HUD as a scene authors it (a canvas layer over a full-rect
 * Control, an anchored bar box of a label with label settings and texture rects, a wrapping label
 * anchored to the bottom centre, a touch-screen button over a canvas texture) and a 2D world of a
 * Node2D and a Sprite2D, built by official Godot and read back through Godot's getters (each
 * Control's global rect, combined minimum size and line count, each 2D item's transforms and the
 * sprite's rect), against the components the production pipeline emits for the same project,
 * mounted in Node by @react-three/fiber and read through compat's getters on the mounted entities.
 * It proves the UI node rules, the resource rules and that authored layout properties
 * (`layout_mode`, `anchors_preset`, anchors, offsets, grow directions, size flags) reach their
 * setters at mount. The mount performs the host's duties the composition site owes a UI scene:
 * the tree root, the root window's size and its resize, the default theme font, and the scene's
 * entry into the tree (which the composition performs only for a scene with script attachments).
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
import { GODOT_SCENE_UI_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

/** The root window's size as the scene enters the tree, and the size the host then resizes it to. */
const ENTRY_WINDOW = [320, 200] as const;
const WINDOW = [640, 360] as const;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene UI proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=${WINDOW[0]}
window/size/viewport_height=${WINDOW[1]}

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

[sub_resource type="LabelSettings" id="LabelSettings_a"]
font_size = 24
outline_size = 2
outline_color = Color(0, 0, 0, 1)

[sub_resource type="PlaceholderTexture2D" id="PlaceholderTexture2D_b"]
size = Vector2(32, 16)

[sub_resource type="CanvasTexture" id="CanvasTexture_c"]
diffuse_texture = SubResource("PlaceholderTexture2D_b")

[node name="Main" type="Node"]

[node name="UI" type="CanvasLayer" parent="."]
layer = 2
offset = Vector2(5, 7)

[node name="Screen" type="Control" parent="UI"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2

[node name="Bar" type="HBoxContainer" parent="UI/Screen"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_left = 8.0
offset_top = 4.0
offset_right = -8.0
offset_bottom = 44.0
grow_horizontal = 2
alignment = 1

[node name="Score" type="Label" parent="UI/Screen/Bar"]
layout_mode = 2
size_flags_horizontal = 3
text = "Score: 12"
label_settings = SubResource("LabelSettings_a")
horizontal_alignment = 1

[node name="Icon" type="TextureRect" parent="UI/Screen/Bar"]
layout_mode = 2
texture = SubResource("PlaceholderTexture2D_b")

[node name="Badge" type="TextureRect" parent="UI/Screen/Bar"]
custom_minimum_size = Vector2(20, 0)
layout_mode = 2
size_flags_vertical = 4
texture = SubResource("PlaceholderTexture2D_b")
expand_mode = 1
stretch_mode = 5

[node name="Hint" type="Label" parent="UI/Screen"]
layout_mode = 1
anchors_preset = 7
anchor_left = 0.5
anchor_top = 1.0
anchor_right = 0.5
anchor_bottom = 1.0
offset_left = -60.0
offset_top = -30.0
offset_right = 60.0
grow_horizontal = 2
grow_vertical = 0
text = "Tap the button to jump over the rocks"
autowrap_mode = 3

[node name="Jump" type="TouchScreenButton" parent="UI"]
position = Vector2(500, 300)
scale = Vector2(2, 2)
texture_normal = SubResource("CanvasTexture_c")
action = "jump"

[node name="World" type="Node2D" parent="."]
position = Vector2(10, 20)
rotation = 0.5
scale = Vector2(1.5, 1.5)

[node name="Hero" type="Sprite2D" parent="World"]
position = Vector2(4, 4)
texture = SubResource("PlaceholderTexture2D_b")
centered = false
offset = Vector2(1, 2)
hframes = 2
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(value) -> Array:
\treturn [_bits(value.x), _bits(value.y)]

func _rect(value: Rect2) -> Array:
\treturn _v(value.position) + _v(value.size)

func _xform(value: Transform2D) -> Array:
\treturn _v(value.x) + _v(value.y) + _v(value.origin)

var main: Node
var frames := 0


func _walk(rows: Dictionary, path: String, node: Node) -> void:
\tvar row := {"class": node.get_class()}
\tif node is CanvasLayer:
\t\trow["layer"] = node.layer
\tif node is Control:
\t\trow["rect"] = _rect(node.get_global_rect())
\t\trow["minimum"] = _v(node.get_combined_minimum_size())
\tif node is Label:
\t\trow["lines"] = node.get_line_count()
\tif node is Node2D:
\t\trow["global"] = _xform(node.get_global_transform())
\t\trow["canvas"] = _xform(node.get_global_transform_with_canvas())
\tif node is Sprite2D:
\t\trow["sprite"] = _rect(node.get_rect())
\tif node is TouchScreenButton:
\t\trow["action"] = node.action
\trows[path] = row
\tfor child in node.get_children():
\t\t_walk(rows, child.name if path == "." else path + "/" + child.name, child)

# The headless display server sizes the root window to 64x64 after initialization; the window
# takes the proof's entry size on the first frame, before the scene enters it, and is resized on
# the next.
func _process(_delta: float) -> bool:
\tframes += 1
\tif frames == 1:
\t\troot.size = Vector2i(${ENTRY_WINDOW[0]}, ${ENTRY_WINDOW[1]})
\t\tmain = load("res://main.tscn").instantiate()
\t\troot.add_child(main)
\tif frames == 2:
\t\troot.size = Vector2i(${WINDOW[0]}, ${WINDOW[1]})
\tif frames < 4:
\t\treturn false
\tvar rows := {"window": [root.size.x, root.size.y]}
\t_walk(rows, ".", main)
\tprint("UI " + JSON.stringify(rows))
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
 * Mounts the emitted main scene with R3F's own root and reads each mounted entity through compat.
 * Before the scene mounts it does what the composition site owes a UI scene: R3F's scene is the
 * tree's root, the root window takes its size (and later its new size), and the default theme
 * font is loaded. It runs in the emitted project's directory, so tsx compiles the scene under that
 * project's own tsconfig.
 */
const MOUNT = `import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import { MainScene } from './src/scenes/main';
import { godot_is_native, mountGodotScriptTree } from './src/lib/godot-compat/node';
import { godot_tree_set_root, godot_tree_frame } from './src/lib/godot-compat/scene-tree';
import { godot_message_queue_flush } from './src/lib/godot-compat/object';
import { godot_window_set_size, get_size } from './src/lib/godot-compat/window';
import { godot_font_default, godot_font_load } from './src/lib/godot-compat/font';
import { construct as vector2i } from './src/lib/godot-compat/vector2i';
import * as CI from './src/lib/godot-compat/canvas-item';
import * as CL from './src/lib/godot-compat/canvas-layer';
import * as C from './src/lib/godot-compat/control';
import * as L from './src/lib/godot-compat/label';
import * as S from './src/lib/godot-compat/sprite-2d';
import * as TSB from './src/lib/godot-compat/touch-screen-button';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const v = (value) => [bits(value.x), bits(value.y)];
const rect = (value) => [...v(value.position), ...v(value.size)];
const xform = (value) => [...v(value.x), ...v(value.y), ...v(value.origin)];
// Most derived first: the class the Node protocol's type test names.
const CLASSES = ['TouchScreenButton', 'Sprite2D', 'Node2D', 'Label', 'TextureRect', 'HBoxContainer', 'Control', 'CanvasLayer', 'Node'];
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
await act(async () => { root.render(createElement('group', { ref: holder })); });
const scene = holder.current.parent;
godot_tree_set_root(scene);
godot_window_set_size(scene, vector2i(${ENTRY_WINDOW[0]}, ${ENTRY_WINDOW[1]}));
godot_font_default(godot_font_load(new Uint8Array(readFileSync('./src/lib/godot-compat/OpenSans_SemiBold.woff2'))));
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene, { name: 'Main' }))); });
// The scene is built with its authored properties set outside the tree (SceneState::instantiate),
// then enters it, as the root's add_child does; the composition attaches no script here.
mountGodotScriptTree(holder.current.children[0], []);
godot_message_queue_flush();
godot_tree_frame(1 / 60);
// The host resizes the root window as the page resizes the canvas.
godot_window_set_size(scene, vector2i(${WINDOW[0]}, ${WINDOW[1]}));
for (let frame = 0; frame < 2; frame += 1) godot_tree_frame(1 / 60);
const size = get_size(scene);
const rows = { window: [size.x, size.y] };
const walk = (path, node) => {
  const className = CLASSES.find((name) => godot_is_native(node, name)) ?? 'none';
  const row = { class: className };
  const is = (name) => godot_is_native(node, name);
  if (is('CanvasLayer')) row.layer = CL.get_layer(node);
  if (is('Control')) {
    row.rect = rect(C.get_global_rect(node));
    row.minimum = v(C.get_combined_minimum_size(node));
  }
  if (is('Label')) row.lines = L.get_line_count(node);
  if (is('Node2D')) {
    row.global = xform(CI.get_global_transform(node));
    row.canvas = xform(CI.get_global_transform_with_canvas(node));
  }
  if (is('Sprite2D')) row.sprite = rect(S.get_rect(node));
  if (is('TouchScreenButton')) row.action = TSB.get_action(node);
  rows[path] = row;
  for (const child of node.children) walk(path === '.' ? child.name : path + '/' + child.name, child);
};
walk('.', holder.current.children[0]);
await act(async () => { root.unmount(); });
console.log('UI ' + JSON.stringify(rows));
`;

function mountedUi(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('UI '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('UI '.length)) as unknown;
}

export async function measureSceneUiProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_UI_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-ui-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(project, relative), source);
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
    const target = mountedUi(out);

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('UI '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native UI probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('UI '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-ui',
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
