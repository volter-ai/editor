/**
 * The scene-physics proof: a scene of static, rigid and character bodies, an area whose
 * `body_entered` the scene connects to its script, a ray cast and a marker, an instanced rigid
 * body whose instance root overrides its mass, material and an axis lock, with box, sphere,
 * capsule, convex and concave collision shapes and physics materials, built by official Godot and
 * read back after two physics frames (the bodies the area reported, with the frame; each node's
 * path, class and global transform bits; bodies' layers, masks, axis locks and settings; shapes
 * and their parameters; the ray cast's result and rays cast into the world, whose hit points and
 * normals are Rapier's geometry and compare to 1e-4), against the emitted project's world module
 * (its Rapier world hand-over and the main scene) mounted in Node by @react-three/fiber, two
 * physics steps run on compat's SceneTree clock as the composition site runs them, read through
 * compat's getters.
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
import { GODOT_SCENE_PHYSICS_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { linkEmittedNodeModules } from './emitted-node-modules';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';


const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene physics proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.gd': `extends Node3D

var entered: Array = []

func _on_coin_body_entered(body: Node3D) -> void:
\tentered.append([body.name, Engine.get_physics_frames()])
`,
  'ball.tscn': `[gd_scene load_steps=2 format=3]

[sub_resource type="SphereShape3D" id="Ball"]
radius = 0.27

[node name="Ball" type="RigidBody3D"]
mass = 0.4
custom_integrator = true

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
shape = SubResource("Ball")
`,
  'main.tscn': `[gd_scene load_steps=12 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://ball.tscn" id="2_ball"]

[sub_resource type="PhysicsMaterial" id="Ice"]
friction = 0.2
bounce = 0.1

[sub_resource type="PhysicsMaterial" id="Slick"]
friction = 0.0
rough = true

[sub_resource type="BoxShape3D" id="FloorBox"]
size = Vector3(20, 1, 20)

[sub_resource type="SphereShape3D" id="Ball"]
radius = 0.68

[sub_resource type="BoxShape3D" id="Lid"]
size = Vector3(1.14506, 0.776818, 1.12102)

[sub_resource type="CapsuleShape3D" id="Capsule"]
radius = 0.4
height = 1.8

[sub_resource type="SphereShape3D" id="CoinBall"]
radius = 0.375

[sub_resource type="ConvexPolygonShape3D" id="Wedge"]
points = PackedVector3Array(-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 1, -1, -1, 1, 1)

[sub_resource type="ConcavePolygonShape3D" id="Sheet"]
data = PackedVector3Array(-2, 0, -2, 2, 0, -2, -2, 0, 2, 2, 0, -2, 2, 0, 2, -2, 0, 2)
backface_collision = true

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Floor" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0)
collision_layer = 3
collision_mask = 5
physics_material_override = SubResource("Ice")

[node name="Box" type="CollisionShape3D" parent="Floor"]
shape = SubResource("FloorBox")

[node name="Crate" type="RigidBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 3, 0)
mass = 2.5
gravity_scale = 0.5
axis_lock_angular_x = true
axis_lock_angular_y = true
axis_lock_angular_z = true
physics_material_override = SubResource("Slick")
custom_integrator = true
contact_monitor = true
max_contacts_reported = 5

[node name="Sphere1" type="CollisionShape3D" parent="Crate"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.74185, 0.267137)
shape = SubResource("Ball")

[node name="Sphere2" type="CollisionShape3D" parent="Crate"]
transform = Transform3D(0.617236, 0, 0.786778, 0, 1, 0, -0.786778, 0, 0.617236, -0.0445105, 1.04515, 0.0531231)
shape = SubResource("Lid")
disabled = true

[node name="Player" type="CharacterBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -3, 1, 0)
floor_snap_length = 0.2
safe_margin = 0.01

[node name="CollisionCapsule" type="CollisionShape3D" parent="Player"]
shape = SubResource("Capsule")

[node name="RayFloor" type="RayCast3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.5)
target_position = Vector3(0, -2, 0.5)
collision_mask = 3

[node name="Muzzle" type="Marker3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0.6)
gizmo_extents = 0.5

[node name="Coin" type="Area3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 3)
collision_layer = 2
input_ray_pickable = false

[node name="CollisionShape3D" type="CollisionShape3D" parent="Coin"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0.00894194, 0.575859, 0.0193955)
shape = SubResource("CoinBall")

[node name="Ramp" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0)

[node name="Hull" type="CollisionShape3D" parent="Ramp"]
shape = SubResource("Wedge")

[node name="Ball2" parent="." instance=ExtResource("2_ball")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 6, -2)
mass = 1.5
physics_material_override = SubResource("Ice")
axis_lock_linear_x = true

[node name="Pad" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 3.2)

[node name="Box" type="CollisionShape3D" parent="Pad"]
shape = SubResource("Lid")

[node name="Deck" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -6, 2, -6)

[node name="Mesh" type="CollisionShape3D" parent="Deck"]
shape = SubResource("Sheet")

[connection signal="body_entered" from="Coin" to="." method="_on_coin_body_entered"]
`,
};

const RAYS = [
  [[1, 10, 0.2], [1, -10, 0.2]],
  [[0, 10, -8], [0, -10, -8]],
  [[5.5, 10, 0], [5.5, -10, 0]],
  [[-6, 10, -6], [-6, -10, -6]],
  [[0, 1.6, 10], [0, 1.6, -10]],
  [[2, 10, -2], [2, -10, -2]],
] as const;

const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _v(value: Vector3) -> Array:
\treturn [_bits(value.x), _bits(value.y), _bits(value.z)]

# A hit's point and normal are Rapier's geometry against GodotPhysics3D's: compared to 1e-4.
func _r(value: float) -> String:
	return "%.4f" % (0.0 if absf(value) < 0.00005 else value)

func _g(value: Vector3) -> Array:
	return [_r(value.x), _r(value.y), _r(value.z)]

func _vs(values: PackedVector3Array) -> Array:
\tvar out := []
\tfor value in values:
\t\tout.append(_v(value))
\treturn out

func _shape(s: Shape3D) -> Variant:
\tif s is BoxShape3D:
\t\treturn ["Box", _v(s.size)]
\tif s is CapsuleShape3D:
\t\treturn ["Capsule", _bits(s.radius), _bits(s.height)]
\tif s is SphereShape3D:
\t\treturn ["Sphere", _bits(s.radius)]
\tif s is ConvexPolygonShape3D:
\t\treturn ["Convex", _vs(s.points)]
\tif s is ConcavePolygonShape3D:
\t\treturn ["Concave", _vs(s.get_faces()), s.backface_collision]
\treturn null

func _material(m: PhysicsMaterial) -> Variant:
\tif m == null:
\t\treturn null
\treturn [_bits(m.friction), _bits(m.bounce), m.rough, m.absorbent]

func _walk(main: Node, node: Node, rows: Array) -> void:
\tvar row := {"path": str(main.get_path_to(node)), "class": node.get_class()}
\tif node is Node3D:
\t\tvar t: Transform3D = node.global_transform
\t\trow["global"] = [_v(t.basis.x), _v(t.basis.y), _v(t.basis.z), _v(t.origin)]
\tif node is CollisionObject3D:
\t\trow["layers"] = [node.collision_layer, node.collision_mask, node.input_ray_pickable]
\tif node is PhysicsBody3D:
\t\trow["locks"] = [node.get_axis_lock(1), node.get_axis_lock(2), node.get_axis_lock(4), node.get_axis_lock(8), node.get_axis_lock(16), node.get_axis_lock(32)]
\tif node is StaticBody3D:
\t\trow["material"] = _material(node.physics_material_override)
\tif node is RigidBody3D:
\t\trow["rigid"] = [_bits(node.mass), _bits(node.gravity_scale), node.custom_integrator, node.contact_monitor, node.max_contacts_reported, _material(node.physics_material_override)]
\tif node is CharacterBody3D:
\t\trow["character"] = [_bits(node.floor_snap_length), _bits(node.safe_margin), _bits(node.floor_max_angle)]
\tif node is Area3D:
\t\trow["monitoring"] = node.monitoring
\tif node is CollisionShape3D:
\t\trow["shape"] = [node.disabled, _shape(node.shape)]
\tif node is RayCast3D:
\t\tvar hit: Variant = null
\t\tif node.is_colliding():
\t\t\thit = [String(node.get_collider().name), node.get_collider_shape(), _g(node.get_collision_point()), _g(node.get_collision_normal())]
\t\trow["ray"] = [_v(node.target_position), node.collision_mask, hit]
\tif node is Marker3D:
\t\trow["gizmo"] = _bits(node.gizmo_extents)
\trows.append(row)
\tfor child in node.get_children():
\t\t_walk(main, child, rows)

var main: Node

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

var frames := 0

# Read after two physics steps: an area reports the bodies inside it at the second's flush.
func _process(_delta: float) -> bool:
\tframes += 1
\tif frames < 2:
\t\treturn false
\tvar rows := [main.entered]
\t_walk(main, main, rows)
\tvar space := root.find_world_3d().direct_space_state
\tfor ray in ${JSON.stringify(RAYS.map(([from, to]) => [...from, ...to]))}:
\t\tvar hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(ray[0], ray[1], ray[2]), Vector3(ray[3], ray[4], ray[5])))
\t\trows.append(null if hit.is_empty() else [String(hit.collider.name), hit.shape, _g(hit.position), _g(hit.normal)])
\tprint("PHYSICS " + JSON.stringify(rows))
\treturn true
`;

function inputDigest(): string {
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE })
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .sort()
      .join('\n'),
  );
}

/**
 * Mounts the emitted world module (the Rapier world hand-over and the main scene) with R3F's own
 * root, runs one physics step on compat's SceneTree clock (the composition site's fixed step), and
 * reads the Godot nodes through compat.
 */
const MOUNT = `import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as N3 from './src/lib/godot-compat/node-3d';
import * as ST from './src/lib/godot-compat/scene-tree';
import * as W from './src/lib/godot-compat/world-3d';
import * as CO from './src/lib/godot-compat/collision-object-3d';
import * as PB from './src/lib/godot-compat/physics-body-3d';
import * as SB from './src/lib/godot-compat/static-body-3d';
import * as RB from './src/lib/godot-compat/rigid-body-3d';
import * as CB from './src/lib/godot-compat/character-body-3d';
import * as AR from './src/lib/godot-compat/area-3d';
import * as CS from './src/lib/godot-compat/collision-shape-3d';
import * as PM from './src/lib/godot-compat/physics-material';
import * as RC from './src/lib/godot-compat/ray-cast-3d';
import * as MK from './src/lib/godot-compat/marker-3d';
import * as DSS from './src/lib/godot-compat/physics-direct-space-state-3d';
import * as RQ from './src/lib/godot-compat/physics-ray-query-parameters-3d';
import * as V from './src/lib/godot-compat/vector3';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const v = (value) => [bits(value.x), bits(value.y), bits(value.z)];
const r = (value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
const g = (value) => [r(value.x), r(value.y), r(value.z)];
const CLASSES = ['CollisionShape3D', 'StaticBody3D', 'RigidBody3D', 'CharacterBody3D', 'Area3D', 'RayCast3D', 'Marker3D', 'Node3D', 'Node'];
const is = (node, name) => N.godot_is_native(node, name);
const material = (m) => m === null ? null : [bits(PM.get_friction(m)), bits(PM.get_bounce(m)), PM.is_rough(m), PM.is_absorbent(m)];
const shape = (s) => {
  if ('size' in s) return ['Box', v(s.size)];
  if ('height' in s) return ['Capsule', bits(s.radius), bits(s.height)];
  if ('radius' in s) return ['Sphere', bits(s.radius)];
  if ('points' in s) return ['Convex', s.points.map(v)];
  if ('faces' in s) return ['Concave', s.faces.map(v), s.backface_collision];
  return null;
};
extend(THREE);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The world module's <GodotMain> loads the capability's font file (read here from the emitted
// project) and listens to the canvas's page, which this stub stands in for.
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
// <GodotMain> mounts the scene once Rapier and the font are loaded, and makes R3F's scene the root.
for (let wait = 0; wait < 500 && holder.current.children.length === 0; wait += 1) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
ST.godot_tree_physics_step(1 / 60);
ST.godot_tree_frame(1 / 60);
ST.godot_tree_physics_step(1 / 60);
ST.godot_tree_frame(1 / 60);
const main = holder.current.children[0];
const rows = [N.godot_node_object(main).entered];
const walk = (path, node) => {
  const row = { path, class: CLASSES.find((name) => is(node, name)) };
  if (N.godot_node_is_spatial(node)) {
    const t = N3.get_global_transform(node);
    row.global = [v(t.basis.x), v(t.basis.y), v(t.basis.z), v(t.origin)];
  }
  if (is(node, 'CollisionObject3D')) row.layers = [CO.get_collision_layer(node), CO.get_collision_mask(node), CO.is_ray_pickable(node)];
  if (is(node, 'PhysicsBody3D')) row.locks = [1, 2, 4, 8, 16, 32].map((axis) => PB.get_axis_lock(node, axis));
  if (is(node, 'StaticBody3D')) row.material = material(SB.get_physics_material_override(node));
  if (is(node, 'RigidBody3D')) {
    row.rigid = [bits(RB.get_mass(node)), bits(RB.get_gravity_scale(node)), RB.is_using_custom_integrator(node), RB.is_contact_monitor_enabled(node), RB.get_max_contacts_reported(node), material(RB.get_physics_material_override(node))];
  }
  if (is(node, 'CharacterBody3D')) row.character = [bits(CB.get_floor_snap_length(node)), bits(CB.get_safe_margin(node)), bits(CB.get_floor_max_angle(node))];
  if (is(node, 'Area3D')) row.monitoring = AR.is_monitoring(node);
  if (is(node, 'CollisionShape3D')) row.shape = [CS.is_disabled(node), shape(CS.get_shape(node))];
  if (is(node, 'RayCast3D')) {
    const hit = RC.is_colliding(node)
      ? [N.get_name(RC.get_collider(node)), RC.get_collider_shape(node), g(RC.get_collision_point(node)), g(RC.get_collision_normal(node))]
      : null;
    row.ray = [v(RC.get_target_position(node)), RC.get_collision_mask(node), hit];
  }
  if (is(node, 'Marker3D')) row.gizmo = bits(MK.get_gizmo_extents(node));
  rows.push(row);
  for (const child of N.get_children(node)) walk(path === '.' ? N.get_name(child) : path + '/' + N.get_name(child), child);
};
walk('.', main);
const state = W.get_direct_space_state(W.godot_world_3d());
for (const [x0, y0, z0, x1, y1, z1] of ${JSON.stringify(RAYS.map(([from, to]) => [...from, ...to]))}) {
  const hit = DSS.intersect_ray(state, RQ.create(V.construct(x0, y0, z0), V.construct(x1, y1, z1)));
  rows.push(hit.size === 0 ? null : [N.get_name(hit.get('collider')), hit.get('shape'), g(hit.get('position')), g(hit.get('normal'))]);
}
await act(async () => { root.unmount(); });
console.log('PHYSICS ' + JSON.stringify(rows));
`;

function mountedPhysics(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('PHYSICS '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted world failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('PHYSICS '.length)) as unknown;
}

export async function measureScenePhysicsProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_PHYSICS_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-physics-'));
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
    const target = mountedPhysics(out);

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('PHYSICS '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native physics probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('PHYSICS '.length)) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'scene-physics',
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
