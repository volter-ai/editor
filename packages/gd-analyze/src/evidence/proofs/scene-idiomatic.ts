/**
 * The scene-idiomatic proof: the reference scene (GODOT.md, "The output is idiomatic three.js": a
 * sun, a current camera, a static floor with a box collider and a plane mesh with a material, and
 * a sphere whose script spins it and raises it while `ui_accept` is held, with an authored export),
 * run by official Godot for a fixed number of frames at `--fixed-fps 60` with Space pressed and
 * released on chosen frames, against the emitted project's world module mounted in Node by
 * @react-three/fiber on a jsdom canvas, one `advance()` per frame, the same key reaching the canvas.
 *
 * Exact: the node names in tree order, the ball's global transform bits and its script's export,
 * the camera's currency (R3F's default camera), its field of view and clip planes, the light's
 * energy (three's intensity over pi), the sphere's and plane's parameters (three's geometry), the
 * collider's half extents, and the material's sRGB colour at 8 bits. Measured and named: the
 * sun's and camera's global transforms, which the scene writes as position/rotation/scale and
 * compat reads back from three's quaternion (`transform-decomposition`), the direction the sun
 * shines (Godot's -Z of its global basis; three's from the light toward its target,
 * `light-direction`), and the material colour's 8-bit quantization (`colour-quantization`). The
 * sun and camera state no scale (they draw with it removed, `disable_scale`): their global
 * transforms carry the authored basis's rounding as the measured difference, and the camera's
 * `get_scale` the rounding itself (`disabled-scale-omitted`). Exact as well: a space query down
 * onto the floor finds the StaticBody3D the scene declares as a `@react-three/rapier` body, its
 * shape, and the hit.
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
import { GODOT_SCENE_IDIOMATIC_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { linkEmittedNodeModules } from './emitted-node-modules';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';


const PRESS = 5;
const RELEASE = 12;
const READ = 24;
/** The measured deviations' bounds: float32 rounding of a decomposed transform, and 8-bit colour. */
const TRANSFORM_TOLERANCE = 1e-6;
const COLOUR_TOLERANCE = 0.5 / 255 + 1e-5;
/**
 * A camera or light with no children and no script states no scale: it draws without one
 * (`disable_scale`), and the authored basis's scale is only the rounding its `.tscn` rotation
 * carries, which `get_scale` alone still shows.
 */
const SCALE_TOLERANCE = 1e-3;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Tiny"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7", "Forward Plus")

[display]
window/size/viewport_width=1024
window/size/viewport_height=600
`,
  'spin.gd': `extends Node3D

@export var speed := 1.5

func _process(delta: float) -> void:
\trotate_y(speed * delta)
\tif Input.is_action_pressed("ui_accept"):
\t\tposition.y += delta
`,
  'main.tscn': `[gd_scene load_steps=6 format=3]

[ext_resource type="Script" path="res://spin.gd" id="1"]

[sub_resource type="PlaneMesh" id="PlaneMesh_1"]
size = Vector2(4, 4)

[sub_resource type="StandardMaterial3D" id="Mat_1"]
albedo_color = Color(0.8, 0.3, 0.2, 1)

[sub_resource type="SphereMesh" id="SphereMesh_1"]

[sub_resource type="BoxShape3D" id="Box_1"]
size = Vector3(4, 0.2, 4)

[node name="Main" type="Node3D"]

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.707107, 0.707107, 0, -0.707107, 0.707107, 0, 4, 0)
light_energy = 1.2

[node name="Camera" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.94, 0.34, 0, -0.34, 0.94, 0, 2, 6)

[node name="Floor" type="StaticBody3D" parent="."]

[node name="Shape" type="CollisionShape3D" parent="Floor"]
shape = SubResource("Box_1")

[node name="Mesh" type="MeshInstance3D" parent="Floor"]
mesh = SubResource("PlaneMesh_1")
surface_material_override/0 = SubResource("Mat_1")

[node name="Ball" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0)
mesh = SubResource("SphereMesh_1")
script = ExtResource("1")
speed = 2.0
`,
};

const OBSERVE = `extends SceneTree

var frames := 0
var main: Node

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _f32(value: float) -> String:
\treturn _bits(PackedFloat32Array([value])[0])

func _t(t: Transform3D) -> Array:
\treturn [t.basis.x.x, t.basis.x.y, t.basis.x.z, t.basis.y.x, t.basis.y.y, t.basis.y.z, t.basis.z.x, t.basis.z.y, t.basis.z.z, t.origin.x, t.origin.y, t.origin.z]

func _v(v: Vector3) -> Array:
\treturn [v.x, v.y, v.z]

func _ray(hit: Dictionary) -> Array:
\treturn [String(hit.collider.name), hit.shape, _f32(hit.position.y), _f32(hit.normal.y)]

func _tb(t: Transform3D) -> Array:
\tvar out := []
\tfor value in _t(t):
\t\tout.append(_bits(value))
\treturn out

func _names(node: Node, out: Array) -> void:
\tout.append(str(main.get_path_to(node)))
\tfor child in node.get_children():
\t\t_names(child, out)

func _hex(c: Color) -> String:
\treturn "#%02x%02x%02x" % [roundi(clampf(c.r, 0, 1) * 255), roundi(clampf(c.g, 0, 1) * 255), roundi(clampf(c.b, 0, 1) * 255)]

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
\tvar names := []
\t_names(main, names)
\tvar ball: MeshInstance3D = main.get_node("Ball")
\tvar camera: Camera3D = main.get_node("Camera")
\tvar sun: DirectionalLight3D = main.get_node("Sun")
\tvar sphere: SphereMesh = ball.mesh
\tvar plane: PlaneMesh = main.get_node("Floor/Mesh").mesh
\tvar albedo: Color = main.get_node("Floor/Mesh").get_surface_override_material(0).albedo_color
\tvar box: BoxShape3D = main.get_node("Floor/Shape").shape
\tvar exact := {
\t\t"names": names,
\t\t"ball": _tb(ball.global_transform),
\t\t"speed": ball.speed,
\t\t"camera": [camera.is_current(), _f32(camera.fov), _f32(camera.near), _f32(camera.far)],
\t\t"energy": _f32(sun.light_energy),
\t\t"sphere": [_f32(sphere.radius), sphere.radial_segments, sphere.rings],
\t\t"plane": [_f32(plane.size.x), _f32(plane.size.y), "face_y" if plane.orientation == PlaneMesh.FACE_Y else "other"],
\t\t"collider": [_f32(box.size.x / 2), _f32(box.size.y / 2), _f32(box.size.z / 2), main.get_node("Floor").get_class()],
\t\t"colour": _hex(albedo),
\t\t"floor_ray": _ray(ball.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(1, 3, 1), Vector3(1, -3, 1)))),
\t}
\tvar measured := {
\t\t"sun": _t(sun.global_transform),
\t\t"camera": _t(camera.global_transform),
\t\t"light": _v(-sun.global_transform.basis.z.normalized()),
\t\t"camera_scale": _v(camera.scale),
\t\t"albedo": [albedo.r, albedo.g, albedo.b],
\t}
\tprint("WORLD " + JSON.stringify({"exact": exact, "measured": measured}))
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
    Object.entries({ ...files, 'observe.gd': OBSERVE, frames: `${String(PRESS)} ${String(RELEASE)} ${String(READ)}` })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

const MOUNT = `import { createElement, act, Fragment } from 'react';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { _roots, advance, createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as N3 from './src/lib/godot-compat/node-3d';
import * as W3 from './src/lib/godot-compat/world-3d';
import { intersect_ray } from './src/lib/godot-compat/physics-direct-space-state-3d';
import { create as rayQuery } from './src/lib/godot-compat/physics-ray-query-parameters-3d';
import { construct as vector3 } from './src/lib/godot-compat/vector3';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const f32 = (value) => bits(Math.fround(value));
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
godot_main_timer_sync_set_fixed_fps(60);
const root = createRoot(canvas);
await root.configure({ gl, size: { width: 64, height: 64, top: 0, left: 0 }, frameloop: 'never' });
let state;
// The world renders straight into R3F's scene, the tree root, as the app mounts it; an empty
// probe group beside it finds that scene.
const holder = { current: null };
await act(async () => { root.render(createElement(Fragment, null, createElement('group', { ref: holder, name: 'Probe' }), createElement(World))); });
const scene = () => holder.current?.parent;
const findMain = () => scene()?.children.find((child) => child.name === 'Main');
for (let wait = 0; wait < 1000 && findMain() === undefined; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
const main = findMain();
const key = (type) => canvas.dispatchEvent(new dom.window.KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
let time = 0;
for (let frame = 1; frame < ${String(READ)}; frame += 1) {
  await act(async () => { advance((time += 1000 / 60)); });
  if (frame === ${String(PRESS)}) key('keydown');
  if (frame === ${String(RELEASE)}) key('keyup');
}
const find = (path) => path.split('/').reduce((node, name) => node.children.find((child) => child.name === name), main);
const names = [];
const walk = (node, path) => {
  names.push(path);
  for (const child of N.get_children(node)) walk(child, path === '.' ? N.get_name(child) : path + '/' + N.get_name(child));
};
walk(main, '.');
const t = (object) => {
  const g = N3.get_global_transform(object);
  return [g.basis.x.x, g.basis.x.y, g.basis.x.z, g.basis.y.x, g.basis.y.y, g.basis.y.z, g.basis.z.x, g.basis.z.y, g.basis.z.z, g.origin.x, g.origin.y, g.origin.z];
};
const ball = find('Ball');
const camera = find('Camera');
const sun = find('Sun');
const floorMesh = find('Floor/Mesh');
const shape = find('Floor/Shape');
const sphere = ball.geometry.parameters;
const plane = floorMesh.geometry.parameters;
// The plane faces +Y as Godot's FACE_Y plane does: its first normal is (0, 1, 0).
const normal = floorMesh.geometry.getAttribute('normal');
const facing = normal.getX(0) === 0 && Math.abs(normal.getY(0) - 1) < 1e-12 && Math.abs(normal.getZ(0)) < 1e-12 ? 'face_y' : 'other';
// The collider @react-three/rapier made for the Shape, from its <Physics> context (found on
// the React tree R3F renders): its half extents, and whether its body is fixed.
const contextValue = (() => {
  const container = _roots.get(canvas)?.fiber;
  const stack = [container?.current];
  while (stack.length > 0) {
    const fiber = stack.pop();
    if (fiber === null || fiber === undefined) continue;
    const value = fiber.memoizedProps?.value;
    if (value !== null && typeof value === 'object' && 'colliderStates' in value && 'world' in value) return value;
    stack.push(fiber.child, fiber.sibling);
  }
  return undefined;
})();
const colliderState = contextValue === undefined ? undefined : [...contextValue.colliderStates.values()].find((entry) => entry.object === shape);
const collider = colliderState?.collider;
const half = collider === undefined ? [] : [collider.halfExtents().x, collider.halfExtents().y, collider.halfExtents().z].map(f32);
const floorClass = collider?.parent()?.isFixed() === true && find('Floor') !== undefined ? 'StaticBody3D' : 'none';
// In Node, R3F's CommonJS build and this ESM probe load two copies of three, so R3F assigns a
// colour prop as the string it was given; the browser's one bundle converts it. Read it as three would.
const colour = typeof floorMesh.material.color === 'string' ? new THREE.Color(floorMesh.material.color) : floorMesh.material.color;
state = {
  exact: {
    names,
    ball: t(ball).map(bits),
    speed: N.godot_node_object(ball).speed,
    camera: [scene().__r3f?.root.getState().camera === camera, f32(camera.fov), f32(camera.near), f32(camera.far)],
    energy: f32(sun.intensity / Math.PI),
    // Three's sphere has a band more than Godot's rings (Godot's builder makes rings + 2 rows).
    sphere: [f32(sphere.radius), sphere.widthSegments, sphere.heightSegments - 1],
    plane: [f32(plane.width), f32(plane.height), facing],
    collider: [...half, floorClass],
    colour: '#' + colour.getHexString(),
    // Compat's space query finds the floor body the JSX declares.
    floor_ray: (() => {
      const hit = intersect_ray(W3.get_direct_space_state(N3.get_world_3d(ball)), rayQuery(vector3(1, 3, 1), vector3(1, -3, 1)));
      return [N.get_name(hit.get('collider')), hit.get('shape'), f32(hit.get('position').y), f32(hit.get('normal').y)];
    })(),
  },
  measured: {
    sun: t(sun),
    camera: t(camera),
    camera_scale: (() => { const s = N3.get_scale(camera); return [s.x, s.y, s.z]; })(),
    // Three's light shines from the light toward its target.
    light: (() => {
      sun.updateWorldMatrix(true, true);
      const from = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld);
      const to = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
      const d = to.sub(from).normalize();
      return [d.x, d.y, d.z];
    })(),
    albedo: (() => { const c = colour.clone().convertLinearToSRGB(); return [c.r, c.g, c.b]; })(),
  },
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

interface WorldState {
  readonly exact: unknown;
  readonly measured: {
    readonly sun: readonly number[];
    readonly camera: readonly number[];
    readonly light: readonly number[];
    readonly camera_scale: readonly number[];
    readonly albedo: readonly number[];
  };
}

function maxDifference(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return a.reduce((worst, value, index) => Math.max(worst, Math.abs(value - (b[index] as number))), 0);
}

export async function measureSceneIdiomaticProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_IDIOMATIC_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-idiomatic-'));
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
    const target = mountedWorld(out) as WorldState;

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
    const native = JSON.parse(line.slice('WORLD '.length)) as WorldState;
    const deviations = {
      'transform-decomposition': Math.max(
        maxDifference(native.measured.sun, target.measured.sun),
        maxDifference(native.measured.camera, target.measured.camera),
      ),
      'colour-quantization': maxDifference(native.measured.albedo, target.measured.albedo),
      'light-direction': maxDifference(native.measured.light, target.measured.light),
      'disabled-scale-omitted': maxDifference(native.measured.camera_scale, target.measured.camera_scale),
    };
    const exactAgree = JSON.stringify(canonical(native.exact)) === JSON.stringify(canonical(target.exact));
    const agree =
      exactAgree &&
      deviations['transform-decomposition'] <= TRANSFORM_TOLERANCE &&
      deviations['light-direction'] <= TRANSFORM_TOLERANCE &&
      deviations['disabled-scale-omitted'] <= SCALE_TOLERANCE &&
      deviations['colour-quantization'] <= COLOUR_TOLERANCE;
    const comparison = JSON.stringify({
      exact: canonical(native.exact),
      tolerances: {
        'transform-decomposition': TRANSFORM_TOLERANCE,
        'light-direction': TRANSFORM_TOLERANCE,
        'disabled-scale-omitted': SCALE_TOLERANCE,
        'colour-quantization': COLOUR_TOLERANCE,
      },
      agree,
    });
    return [
      {
        name: 'scene-idiomatic',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(JSON.stringify(canonical(native))),
          comparison: sha256(comparison),
        },
        agree,
        detail: `deviations ${JSON.stringify(deviations)}\nnative ${JSON.stringify(canonical(native))}\ntarget ${JSON.stringify(canonical(target))}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else process.stdout.write(`${temp}\n`);
  }
}
