/**
 * The scene-gridmap proof: the platformer's tile library (`stage/tiles.tres`, its binary meshes and
 * shapes, its textured material) and level (`stage/grid_map.scn`, instanced as it is in the
 * platformer), beside a GridMap authored in the scene with a non-default cell size, an uncentred
 * axis, a collision layer and metadata, whose script sets a cell as it becomes ready. Official
 * Godot runs the scene for a few physics frames at `--fixed-fps 60`; the emitted world runs the
 * same frames mounted in Node by @react-three/fiber on a jsdom canvas, one `advance()` per frame.
 *
 * Exact: each GridMap's cells in order with their items and orientations, the metadata, the
 * layers; each cell's drawn transform (Godot's `get_meshes()`, the cell's placement times the item's
 * mesh placement, against the matrix of that cell's instance in its item's `InstancedMesh`); and
 * ray queries straight down onto the first cells of each map, onto the cell the script set, and with
 * a mask that excludes the map's layer: which collider each hits (the GridMap) or that it misses.
 * Measured and named: each hit's point and normal (`ray-hit`, Rapier's ray test against
 * GodotPhysics3D's).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_GRIDMAP_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { linkEmittedNodeModules } from './emitted-node-modules';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4');
/** The platformer's files the proof copies: the level, the library, its meshes, shapes and textures. */
const COPIED = ['stage/grid_map.scn', 'stage/tiles.tres', 'stage/tile_material.tres', 'stage/tiles_albedo.webp', 'stage/tiles_albedo.webp.import', 'stage/tiles_rough.webp', 'stage/tiles_rough.webp.import', 'stage/meshes', 'stage/collision'] as const;

const READ = 4;
/** Cells of each map a ray is cast down onto, in the map's order. */
const RAYS = 6;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene gridmap proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=64
window/size/viewport_height=64

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'probe.gd': `extends Node3D

func _ready() -> void:
\tvar small: GridMap = $Small
\tsmall.set_cell_item(Vector3i(5, 0, 0), 7, 10)
`,
  'main.tscn': `[gd_scene load_steps=4 format=3]

[ext_resource type="PackedScene" path="res://stage/grid_map.scn" id="1_grid"]
[ext_resource type="MeshLibrary" path="res://stage/tiles.tres" id="2_tiles"]
[ext_resource type="Script" path="res://probe.gd" id="3_probe"]

[node name="Main" type="Node3D"]
script = ExtResource("3_probe")

[node name="Level" parent="." instance=ExtResource("1_grid")]

[node name="Small" type="GridMap" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 40, 60)
mesh_library = ExtResource("2_tiles")
cell_size = Vector3(1.5, 1, 2)
cell_center_y = false
collision_layer = 4
data = {
"cells": PackedInt32Array(0, 0, 7, 65537, 3, 1048583, -1, 0, 655368, 2, 0, 15)
}
metadata/_editor_floor_ = Vector3(0, 2, 0)
`,
};

const OBSERVE = `extends SceneTree

var frames := 0
var main: Node

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _f32(value: float) -> String:
\treturn _bits(PackedFloat32Array([value])[0])

func _tb(t: Transform3D) -> Array:
\treturn [_f32(t.basis.x.x), _f32(t.basis.x.y), _f32(t.basis.x.z), _f32(t.basis.y.x), _f32(t.basis.y.y), _f32(t.basis.y.z), _f32(t.basis.z.x), _f32(t.basis.z.y), _f32(t.basis.z.z), _f32(t.origin.x), _f32(t.origin.y), _f32(t.origin.z)]

func _ray(from: Vector3, to: Vector3, mask: int) -> Variant:
\tvar hit: Dictionary = main.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to, mask))
\tif hit.is_empty():
\t\treturn null
\treturn [String(hit.collider.name), _f32(hit.position.x), _f32(hit.position.y), _f32(hit.position.z), _f32(hit.normal.x), _f32(hit.normal.y), _f32(hit.normal.z)]

func _map(g: GridMap) -> Dictionary:
\tvar cells := []
\tfor cell in g.get_used_cells():
\t\tcells.append([cell.x, cell.y, cell.z, g.get_cell_item(cell), g.get_cell_item_orientation(cell)])
\tvar drawn := []
\tvar meshes := g.get_meshes()
\tfor i in range(0, meshes.size(), 2):
\t\tdrawn.append(_tb(meshes[i]))
\tvar rays := []
\tvar used := g.get_used_cells()
\tfor i in min(${String(RAYS)}, used.size()):
\t\tvar top: Vector3 = g.global_transform * (g.map_to_local(used[i]) + Vector3(0, g.cell_size.y * 4, 0))
\t\trays.append(_ray(top, top - Vector3(0, g.cell_size.y * 8, 0), 0xffffffff))
\treturn {"cells": cells, "drawn": drawn, "rays": rays, "layer": g.collision_layer, "mask": g.collision_mask}

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _physics_process(_delta: float) -> bool:
\tframes += 1
\tif frames < ${String(READ)}:
\t\treturn false
\tvar small: GridMap = main.get_node("Small")
\tvar set_top: Vector3 = small.global_transform * (small.map_to_local(Vector3i(5, 0, 0)) + Vector3(0, 4, 0))
\tvar state := {
\t\t"level": _map(main.get_node("Level")),
\t\t"small": _map(small),
\t\t"meta": [small.get_meta("_editor_floor_").x, small.get_meta("_editor_floor_").y, small.get_meta("_editor_floor_").z],
\t\t"set_cell": _ray(set_top, set_top - Vector3(0, 8, 0), 4),
\t\t"masked": _ray(set_top, set_top - Vector3(0, 8, 0), 2),
\t}
\tvar file := FileAccess.open("res://gridmap.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(state))
\tfile.close()
\treturn true
`;

function inputDigest(): string {
  const copied = (relative: string): [string, string][] => {
    const full = path.join(FIXTURE, relative);
    if (statSync(full).isDirectory()) return readdirSync(full).flatMap((entry) => copied(path.posix.join(relative, entry)));
    return [[relative, sha256(readFileSync(full))]];
  };
  return sha256(
    Object.entries({ ...files, 'observe.gd': OBSERVE, ...Object.fromEntries(COPIED.flatMap(copied)) })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

const MOUNT = `import { createElement, act, Fragment } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { advance, createRoot, extend } from '@react-three/fiber';
import World from './src/world';
import * as N from './src/lib/godot-compat/node';
import * as N3 from './src/lib/godot-compat/node-3d';
import * as G from './src/lib/godot-compat/grid-map';
import * as ML from './src/lib/godot-compat/mesh-library';
import * as O from './src/lib/godot-compat/object';
import * as IMG from './src/lib/godot-compat/image';
import * as W3 from './src/lib/godot-compat/world-3d';
import { op_multiply as xform } from './src/lib/godot-compat/transform-3d';
import { intersect_ray } from './src/lib/godot-compat/physics-direct-space-state-3d';
import { create as rayQuery } from './src/lib/godot-compat/physics-ray-query-parameters-3d';
import { construct as vector3 } from './src/lib/godot-compat/vector3';
import { construct as vector3i } from './src/lib/godot-compat/vector3i';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';

const require = createRequire(import.meta.url);
IMG.godot_image_webp_module(await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))));
const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const f32 = (value) => bits(Math.fround(value));
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
let time = 0;
for (let frame = 1; frame < ${String(READ)}; frame += 1) {
  await act(async () => { advance((time += 1000 / 60)); });
}
const find = (name) => N.get_children(main).find((child) => N.get_name(child) === name);
const tb = (t) => [t.basis.x.x, t.basis.x.y, t.basis.x.z, t.basis.y.x, t.basis.y.y, t.basis.y.z, t.basis.z.x, t.basis.z.y, t.basis.z.z, t.origin.x, t.origin.y, t.origin.z].map(f32);
const space = W3.get_direct_space_state(N3.get_world_3d(main));
const ray = (from, to, mask) => {
  const hit = intersect_ray(space, rayQuery(from, to, mask));
  if (hit.size === 0) return null;
  const p = hit.get('position');
  const n = hit.get('normal');
  return [N.get_name(hit.get('collider')), f32(p.x), f32(p.y), f32(p.z), f32(n.x), f32(n.y), f32(n.z)];
};
const plus = (a, b) => vector3(a.x + b.x, a.y + b.y, a.z + b.z);
const map = (g) => {
  const used = G.get_used_cells(g);
  const cells = used.map((cell) => [cell.x, cell.y, cell.z, G.get_cell_item(g, cell), G.get_cell_item_orientation(g, cell)]);
  // Each cell's instance: its item's InstancedMesh (the one drawing the item's geometry), at the
  // cell's index among that item's cells.
  const library = G.get_mesh_library(g);
  const instances = g.children.filter((child) => child.isInstancedMesh);
  const seen = new Map();
  const drawn = [];
  for (const cell of used) {
    const item = G.get_cell_item(g, cell);
    const entry = ML.godot_mesh_library_item(library, item);
    if (entry === undefined || entry.mesh === null) continue;
    const index = seen.get(item) ?? 0;
    seen.set(item, index + 1);
    const mesh = instances.find((candidate) => candidate.geometry === entry.mesh.geometry);
    const m = new THREE.Matrix4();
    if (mesh !== undefined) mesh.getMatrixAt(index, m);
    const e = m.elements;
    drawn.push(mesh === undefined ? null : [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]].map(f32));
  }
  const global = N3.get_global_transform(g);
  const size = G.get_cell_size(g);
  const rays = used.slice(0, ${String(RAYS)}).map((cell) => {
    const top = xform(global, plus(G.map_to_local(g, cell), vector3(0, Math.fround(size.y * 4), 0)));
    return ray(top, plus(top, vector3(0, -Math.fround(size.y * 8), 0)), 0xffffffff);
  });
  return { cells, drawn, rays, layer: G.get_collision_layer(g), mask: G.get_collision_mask(g) };
};
const small = find('Small');
const setTop = xform(N3.get_global_transform(small), plus(G.map_to_local(small, vector3i(5, 0, 0)), vector3(0, 4, 0)));
const floor = O.get_meta(small, '_editor_floor_');
const state = {
  level: map(find('Level')),
  small: map(small),
  meta: [floor.x, floor.y, floor.z],
  set_cell: ray(setTop, plus(setTop, vector3(0, -8, 0)), 4),
  masked: ray(setTop, plus(setTop, vector3(0, -8, 0)), 2),
};
await act(async () => { root.unmount(); });
// The state is large: written to a file, not a pipe that may be cut at exit.
const { writeFileSync } = await import('node:fs');
writeFileSync('gridmap.json', JSON.stringify(state));
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
  const file = path.join(out, 'gridmap.json');
  if (run.error !== undefined || run.status !== 0 || !existsSync(file)) {
    throw new Error(`mounting the emitted world failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 8000)}`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

/**
 * `ray-hit`: a ray's hit point and normal as Rapier and GodotPhysics3D each compute them for the
 * same shape (float32 geometry, their own ray-shape tests; measured 9.9e-6 on a normal, a few
 * float32 steps at the level's coordinates).
 */
const RAY_HIT_TOLERANCE = 2e-5;

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

export async function measureSceneGridMapProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_GRIDMAP_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-gridmap-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(project, relative), source);
    for (const relative of COPIED) cpSync(path.join(FIXTURE, relative), path.join(project, relative), { recursive: true });
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
    const target = mountedWorld(out);

    // Native: Godot's editor imports the textures by their sidecars, then the scene runs.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', project, '--import', '--quit'], { encoding: 'utf8', timeout: 300_000 });
    if (imported.error !== undefined || imported.status !== 0) throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--fixed-fps', '60', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    const written = path.join(project, 'gridmap.json');
    if (run.error !== undefined || !existsSync(written)) {
      throw new Error(`native gridmap probe failed: ${run.error?.message ?? ''}\n${run.stdout.slice(0, 4000)}\n${run.stderr.slice(0, 4000)}`);
    }
    const native = JSON.parse(readFileSync(written, 'utf8')) as unknown;
    // Ray hits: the collider and hit-or-miss exact, the point and normal within `ray-hit`.
    const hits = (state: unknown): (readonly unknown[] | null)[] => {
      const value = state as { level: { rays: (readonly unknown[] | null)[] }; small: { rays: (readonly unknown[] | null)[] }; set_cell: readonly unknown[] | null; masked: readonly unknown[] | null };
      return [...value.level.rays, ...value.small.rays, value.set_cell, value.masked];
    };
    const decode = (hex: unknown) => Buffer.from(String(hex), 'hex').readDoubleLE(0);
    let rayHit = 0;
    let raysAgree = true;
    const nativeHits = hits(native);
    const targetHits = hits(target);
    nativeHits.forEach((hit, index) => {
      const other = targetHits[index] ?? null;
      if ((hit === null) !== (other === null) || (hit !== null && other !== null && hit[0] !== other[0])) raysAgree = false;
      if (hit === null || other === null) return;
      for (let component = 1; component < 7; component += 1) rayHit = Math.max(rayHit, Math.abs(decode(hit[component]) - decode(other[component])));
    });
    const withoutRays = (state: unknown) => {
      const value = state as Record<string, unknown> & { level: Record<string, unknown>; small: Record<string, unknown> };
      return { ...value, level: { ...value.level, rays: undefined }, small: { ...value.small, rays: undefined }, set_cell: undefined, masked: undefined };
    };
    const nativeJson = JSON.stringify(canonical(withoutRays(native)));
    const targetJson = JSON.stringify(canonical(withoutRays(target)));
    const agree = nativeJson === targetJson && raysAgree && rayHit <= RAY_HIT_TOLERANCE;
    const comparison = JSON.stringify({ native: sha256(nativeJson), raysAgree, tolerance: RAY_HIT_TOLERANCE, agree });
    return [
      {
        name: 'scene-gridmap',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree,
        detail: `ray-hit ${String(rayHit)} rays ${String(raysAgree)}\ndifferences ${JSON.stringify(differences(native, target).slice(0, 20))}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else process.stdout.write(`${temp}\n`);
  }
}
