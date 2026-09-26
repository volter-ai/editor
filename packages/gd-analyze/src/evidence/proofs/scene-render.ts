/**
 * The scene-render proof: mesh instances over primitive meshes with materials (a sub-resource
 * override, a `.tres` material on the mesh, none), and directional and omni lights, built by
 * official Godot and read back through Godot's getters, against the scene the production pipeline
 * emits for the same project (idiomatic JSX: three's geometries, materials and lights with literal
 * props), mounted in Node by @react-three/fiber and read from the three objects themselves.
 *
 * Exact: each node's class, render layers and shadow casting; each mesh's shape parameters as
 * three's geometry states them (a sphere's `rings + 1` bands, a cylinder's `rings + 1` height
 * segments, a plane's orientation read from its normals); each material's shading, metallic,
 * roughness, transparency, blending and opacity; each light's drawn energy (three's intensity over
 * pi), range, attenuation and shadow. Measured and named: the colours three draws against the
 * linear values Godot's Compatibility shader computes (`colour-quantization`: the albedo as an 8-bit
 * sRGB hex decoded exactly, where the shader uses a polynomial), the geometry three builds against
 * Godot's surface arrays (`primitive-geometry`: every vertex's position, normal and UV, three's UV
 * origin at the bottom, matched as sets), and the sun's direction (`light-direction`).
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
import { GODOT_SCENE_RENDER_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene render proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'glow.tres': `[gd_resource type="StandardMaterial3D" format=3]

[resource]
albedo_color = Color(0.7, 0.7, 0.7, 1)
metallic = 0.1
roughness = 0.0
emission_enabled = true
emission = Color(1, 0.884824, 0.513098, 1)
emission_energy_multiplier = 3.71
`,
  'main.tscn': `[gd_scene load_steps=8 format=3]

[ext_resource type="Material" path="res://glow.tres" id="1_glow"]

[sub_resource type="CylinderMesh" id="CylinderMesh_a"]
top_radius = 0.2
bottom_radius = 0.2
height = 0.05
radial_segments = 16
rings = 1

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_b"]
albedo_color = Color(1.5, 1.26, 0, 1)
metallic = 1.0
roughness = 0.2

[sub_resource type="SphereMesh" id="SphereMesh_c"]
material = ExtResource("1_glow")
radius = 0.25
height = 0.5
radial_segments = 16
rings = 8

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_d"]
transparency = 1
blend_mode = 1
shading_mode = 0
albedo_color = Color(0.701961, 0.698039, 0.513726, 0.5)

[sub_resource type="PlaneMesh" id="PlaneMesh_e"]
material = SubResource("StandardMaterial3D_d")
size = Vector2(0.25, 0.25)
orientation = 2

[sub_resource type="QuadMesh" id="QuadMesh_f"]

[node name="Main" type="Node3D"]

[node name="Coin" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, -3.6199901e-06, -1, 0, 1, -3.6199901e-06, 0.1, 0.5, 0)
layers = 2
mesh = SubResource("CylinderMesh_a")
surface_material_override/0 = SubResource("StandardMaterial3D_b")

[node name="Bullet" type="MeshInstance3D" parent="."]
cast_shadow = 0
mesh = SubResource("SphereMesh_c")

[node name="Spark" type="MeshInstance3D" parent="."]
mesh = SubResource("PlaneMesh_e")

[node name="Card" type="MeshInstance3D" parent="."]
mesh = SubResource("QuadMesh_f")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.5, 0.866025, 0, -0.866025, 0.5, 0, 4, 0)
light_color = Color(1, 0.95, 0.9, 1)
light_energy = 0.75
shadow_enabled = true
shadow_bias = 0.02
shadow_blur = 1.5
sky_mode = 1
directional_shadow_mode = 0
directional_shadow_fade_start = 1.0
directional_shadow_max_distance = 55.0

[node name="Lamp" type="OmniLight3D" parent="."]
light_color = Color(1, 0.72, 0.3, 1)
light_energy = 2.5
omni_range = 3.0
omni_attenuation = 2.0
shadow_enabled = true
shadow_bias = 0.03
`,
};

/** The native probe, written into the project only after the target side has read it. */
const OBSERVE = `extends SceneTree

func _bits(value: float) -> String:
\treturn PackedFloat64Array([value]).to_byte_array().hex_encode()

func _f32(value: float) -> String:
\treturn _bits(PackedFloat32Array([value])[0])

# The Compatibility shader's srgb_to_linear (tonemap_inc.glsl:22).
func _poly(c: float) -> float:
\treturn c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878)

func _shape(mesh) -> Array:
\tif mesh is CylinderMesh:
\t\treturn ["cylinder", _f32(mesh.top_radius), _f32(mesh.bottom_radius), _f32(mesh.height), mesh.radial_segments, mesh.rings, mesh.cap_top, mesh.cap_bottom]
\tif mesh is SphereMesh:
\t\treturn ["sphere", _f32(mesh.radius), _f32(mesh.height), mesh.radial_segments, mesh.rings, mesh.is_hemisphere]
\treturn ["plane", _f32(mesh.size.x), _f32(mesh.size.y), mesh.subdivide_width, mesh.subdivide_depth, mesh.orientation]

func _tuples(arrays: Array) -> Array:
\tvar out := []
\tvar v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
\tvar n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
\tvar uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
\tfor i in v.size():
\t\tout.append([v[i].x, v[i].y, v[i].z, n[i].x, n[i].y, n[i].z, uv[i].x, uv[i].y])
\treturn out

var main: Node

func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)

func _process(_delta: float) -> bool:
\tvar exact := {}
\tvar measured := {}
\tfor node in main.get_children():
\t\tvar row := {"class": node.get_class()}
\t\tvar seen := {}
\t\tif node is MeshInstance3D:
\t\t\trow["layers"] = node.layers
\t\t\trow["cast_shadow"] = 0 if node.cast_shadow == 0 else 1
\t\t\trow["shape"] = _shape(node.mesh)
\t\t\tvar m = node.get_surface_override_material(0)
\t\t\tif m == null:
\t\t\t\tm = node.mesh.material
\t\t\tvar albedo := Color(0.6, 0.6, 0.6, 1)
\t\t\tvar emission := [0.0, 0.0, 0.0]
\t\t\tif m == null:
\t\t\t\trow["material"] = [1, _f32(0.2), _f32(0.8), 0, 0]
\t\t\telse:
\t\t\t\talbedo = m.albedo_color
\t\t\t\tvar shaded: bool = m.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED
\t\t\t\trow["material"] = [m.shading_mode, _f32(m.metallic) if shaded else null, _f32(m.roughness) if shaded else null, m.transparency, m.blend_mode]
\t\t\t\tif m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
\t\t\t\t\trow["opacity"] = _f32(albedo.a)
\t\t\t\tif shaded and m.emission_enabled:
\t\t\t\t\tvar e: Color = m.emission * m.emission_energy_multiplier
\t\t\t\t\temission = [_poly(e.r), _poly(e.g), _poly(e.b)]
\t\t\tseen["albedo"] = [_poly(albedo.r), _poly(albedo.g), _poly(albedo.b)]
\t\t\tseen["emission"] = emission
\t\t\tseen["surface"] = _tuples(node.mesh.surface_get_arrays(0))
\t\tif node is Light3D:
\t\t\tvar sky_only: bool = node is DirectionalLight3D and node.sky_mode == DirectionalLight3D.SKY_MODE_SKY_ONLY
\t\t\trow["energy"] = _f32(0.0 if sky_only else node.light_energy)
\t\t\trow["shadow"] = node.shadow_enabled
\t\t\tseen["shadow"] = [node.shadow_bias, node.shadow_normal_bias, node.directional_shadow_max_distance if node is DirectionalLight3D else 0.0, node.directional_shadow_mode if node is DirectionalLight3D else -1, node.omni_range if node is OmniLight3D else 0.0]
\t\t\tvar c: Color = node.light_color.srgb_to_linear()
\t\t\tseen["color"] = [c.r, c.g, c.b]
\t\tif node is OmniLight3D:
\t\t\trow["range"] = _f32(node.omni_range)
\t\t\trow["attenuation"] = _f32(node.omni_attenuation)
\t\tif node is DirectionalLight3D:
\t\t\tvar d: Vector3 = -node.global_transform.basis.z.normalized()
\t\t\tseen["direction"] = [d.x, d.y, d.z]
\t\texact[node.name] = row
\t\tmeasured[node.name] = seen
\tprint("RENDER " + JSON.stringify({"exact": exact, "measured": measured}))
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
 * Mounts the emitted main scene with R3F's own root and reads each three object it made. It runs
 * in the emitted project's directory, so tsx compiles the scene under that project's own tsconfig.
 */
const MOUNT = `import { createElement, act } from 'react';
import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
import { MainScene } from './src/scenes/main';

const bits = (value) => Buffer.from(new Float64Array([value]).buffer).toString('hex');
const f32 = (value) => bits(Math.fround(value));
// In Node, R3F's CommonJS build and this ESM probe load two copies of three, so R3F may assign a
// colour prop as the value it was given; the browser's one bundle converts it. Read it as three would.
const linear = (value) => {
  if (Array.isArray(value)) return value;
  const c = typeof value === 'string' ? new THREE.Color(value) : value;
  return [c.r, c.g, c.b];
};
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
await act(async () => { root.render(createElement('group', { ref: holder }, createElement(MainScene))); });
const CLASS = { Mesh: 'MeshInstance3D', DirectionalLight: 'DirectionalLight3D', PointLight: 'OmniLight3D' };
const BLEND = { 1: 0, 2: 1, 3: 2, 4: 3 };
const exact = {};
const measured = {};
for (const node of holder.current.children[0].children) {
  const row = { class: CLASS[node.type] ?? node.type };
  const seen = {};
  if (node.type === 'Mesh') {
    row.layers = node.layers.mask;
    row.cast_shadow = node.castShadow ? 1 : 0;
    const geometry = node.geometry;
    const p = geometry.parameters;
    const normal = geometry.getAttribute('normal');
    if (geometry.type === 'CylinderGeometry') {
      row.shape = ['cylinder', f32(p.radiusTop), f32(p.radiusBottom), f32(p.height), p.radialSegments, p.heightSegments - 1, !p.openEnded, !p.openEnded];
    } else if (geometry.type === 'SphereGeometry') {
      const whole = p.phiLength === Math.PI * 2 && p.thetaStart === 0 && p.thetaLength === Math.PI;
      row.shape = ['sphere', f32(p.radius), f32(p.radius * 2), p.widthSegments, p.heightSegments - 1, !whole];
    } else {
      // A plane faces where its normals point (Godot's orientation: FACE_X 0, FACE_Y 1, FACE_Z 2).
      const facing = [normal.getX(0), normal.getY(0), normal.getZ(0)].findIndex((value) => Math.abs(value - 1) < 1e-6);
      row.shape = ['plane', f32(p.width), f32(p.height), p.widthSegments - 1, p.heightSegments - 1, facing];
    }
    const m = node.material;
    const shaded = m.type !== 'MeshBasicMaterial';
    const transparency = m.transparent ? (m.alphaTest > 0 ? 2 : 1) : 0;
    row.material = [shaded ? 1 : 0, shaded ? f32(m.metalness) : null, shaded ? f32(m.roughness) : null, transparency, BLEND[m.blending]];
    if (transparency !== 0) row.opacity = f32(m.opacity);
    seen.albedo = linear(m.color);
    seen.emission = shaded ? linear(m.emissive).map((value) => value * m.emissiveIntensity) : [0, 0, 0];
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    seen.surface = Array.from({ length: position.count }, (_, i) => [
      position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i), uv.getX(i), 1 - uv.getY(i),
    ]);
  }
  if (node.type === 'DirectionalLight' || node.type === 'PointLight') {
    row.energy = f32(node.intensity / Math.PI);
    row.shadow = node.castShadow;
    const shadow = node.shadow;
    seen.shadow = [shadow.bias, shadow.normalBias, shadow.mapSize.x, shadow.mapSize.y, shadow.camera.left ?? 0, shadow.camera.right ?? 0, shadow.camera.bottom ?? 0, shadow.camera.top ?? 0, shadow.camera.near, shadow.camera.far];
    seen.color = linear(node.color);
  }
  if (node.type === 'PointLight') {
    row.range = f32(node.distance);
    row.attenuation = f32(node.decay);
  }
  if (node.type === 'DirectionalLight') {
    node.updateWorldMatrix(true, true);
    const from = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const to = new THREE.Vector3().setFromMatrixPosition(node.target.matrixWorld);
    const d = to.sub(from).normalize();
    seen.direction = [d.x, d.y, d.z];
  }
  exact[node.name] = row;
  measured[node.name] = seen;
}
await act(async () => { root.unmount(); });
console.log('RENDER ' + JSON.stringify({ exact, measured }));
`;

function mountedRender(out: string): unknown {
  writeFileSync(path.join(out, 'gd-analyze-mount.mts'), MOUNT);
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'gd-analyze-mount.mts'], {
    cwd: out,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = run.stdout.split('\n').find((entry) => entry.startsWith('RENDER '));
  if (run.error !== undefined || line === undefined) {
    throw new Error(`mounting the emitted scene failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(line.slice('RENDER '.length)) as unknown;
}

interface RenderState {
  readonly exact: unknown;
  readonly measured: Readonly<
    Record<
      string,
      {
        readonly albedo?: readonly number[];
        readonly emission?: readonly number[];
        readonly color?: readonly number[];
        readonly surface?: readonly (readonly number[])[];
        readonly direction?: readonly number[];
        readonly shadow?: readonly number[];
      }
    >
  >;
}

/**
 * The named deviations' bounds. `colour-quantization`: the largest difference over [0, 1] between
 * the exact decode of the nearest 8-bit sRGB value and the Compatibility shader's polynomial
 * (0.00492). `primitive-geometry`: Godot stores a surface's normals octahedrally in 16 bits and its
 * UVs in 16 bits (`RS::ARRAY_FLAG_COMPRESS_ATTRIBUTES`; measured 9.2e-5 and 1.5e-5), positions as
 * float. `sphere-pole-u`: three puts a pole vertex's `u` half a segment on. `light-direction`: the
 * float32 aim. `cylinder-uv-layout` is recorded, not bounded: Godot lays a cylinder's sides over the
 * top half of the texture and its caps as discs in the bottom half (`primitive_meshes.cpp:1136`),
 * three its sides over the whole texture and each cap as a disc over it.
 */
const TOLERANCES = {
  'colour-quantization': 0.005,
  'primitive-geometry': 1.5e-4,
  'primitive-uv': 1.5e-4,
  'sphere-pole-u': 0.5 + 1e-6,
  'cylinder-uv-layout': Number.POSITIVE_INFINITY,
  'light-direction': 1e-6,
} as const;

/**
 * `shadow-mapping`: the three shadow for Godot's `[bias, normal bias, max distance, directional mode,
 * omni range]`. A directional light's bias is `SHADOW_BIAS / 100` of its shadow camera's depth range
 * (`rasterizer_scene_gles3.cpp:2256`, bias scale `renderer_scene_cull.cpp:2360`), three's bias in its
 * normalized depth towards the light; its normal bias `SHADOW_NORMAL_BIAS` texels
 * (`rasterizer_scene_gles3.cpp:1809`, `renderer_scene_cull.cpp:2359`) of its map (the 4096 atlas, or a
 * 2048 quarter per split) over a camera box `SHADOW_MAX_DISTANCE` around the light. An omni light's
 * bias is world distance (`scene.glsl:2751`) over three's cube camera from 0.5 to its range; its map a
 * 1024 cube face (`rasterizer_scene_gles3.cpp:2298`).
 */
function shadowMapping(godot: readonly number[]): readonly number[] {
  const [bias, normalBias, distance, mode, range] = godot as [number, number, number, number, number];
  if (mode >= 0) {
    const size = mode === 0 ? 4096 : 2048;
    return [-bias / 100, (normalBias * 2 * distance) / size, size, size, -distance, distance, -distance, distance, -distance, distance];
  }
  return [-bias / (range - 0.5), 0, 1024, 1024];
}

function maxDifference(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return a.reduce((worst, value, index) => Math.max(worst, Math.abs(value - (b[index] as number))), 0);
}

/** The largest distance from a vertex of either set to its nearest in the other (max-abs per component). */
function setDistance(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : Number.POSITIVE_INFINITY;
  const nearest = (from: readonly (readonly number[])[], to: readonly (readonly number[])[]) =>
    from.reduce((worst, tuple) => Math.max(worst, to.reduce((best, other) => Math.min(best, maxDifference(tuple, other)), Number.POSITIVE_INFINITY)), 0);
  return Math.max(nearest(a, b), nearest(b, a));
}

export async function measureSceneRenderProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_RENDER_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-render-'));
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
    const target = mountedRender(out);

    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(officialBinary, ['--headless', '--path', project, '--script', 'res://observe.gd'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('RENDER '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native render probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('RENDER '.length)) as RenderState;
    const rendered = target as RenderState;
    const deviations = {
      'colour-quantization': 0,
      'primitive-geometry': 0,
      'primitive-uv': 0,
      'sphere-pole-u': 0,
      'cylinder-uv-layout': 0,
      'light-direction': 0,
    };
    const perNode: Record<string, Record<string, number>> = {};
    let current = '';
    const worst = (key: keyof typeof deviations, value: number) => {
      deviations[key] = Math.max(deviations[key], value);
      perNode[current] = { ...perNode[current], [key]: Math.max(perNode[current]?.[key] ?? 0, value) };
    };
    let shadowAgree = true;
    const shapes = native.exact as Readonly<Record<string, { readonly shape?: readonly unknown[] }>>;
    for (const [name, seen] of Object.entries(native.measured)) {
      current = name;
      const drawn = rendered.measured[name] ?? {};
      for (const key of ['albedo', 'emission', 'color'] as const) {
        if (seen[key] !== undefined) worst('colour-quantization', maxDifference(seen[key] as readonly number[], (drawn[key] as readonly number[] | undefined) ?? []));
      }
      if (seen.surface !== undefined) {
        const godot = seen.surface;
        const three = drawn.surface ?? [];
        const positionNormal = (rows: readonly (readonly number[])[]) => rows.map((row) => row.slice(0, 6));
        worst('primitive-geometry', setDistance(positionNormal(godot), positionNormal(three)));
        const shape = shapes[name]?.shape;
        if (shape?.[0] === 'cylinder') {
          worst('cylinder-uv-layout', setDistance(godot, three));
        } else if (shape?.[0] === 'sphere') {
          // A pole vertex (on the axis) has a `u` of its own in each builder: compared apart, in
          // segments of the sphere.
          const pole = (row: readonly number[]) => Math.abs(row[0] as number) < 1e-7 && Math.abs(row[2] as number) < 1e-7;
          const off = (rows: readonly (readonly number[])[]) => rows.map((row) => (pole(row) ? [...row.slice(0, 6), 0, row[7] as number] : row));
          worst('primitive-uv', setDistance(off(godot), off(three)));
          worst('sphere-pole-u', setDistance(godot.filter(pole), three.filter(pole)) * (shape[3] as number));
        } else {
          worst('primitive-uv', setDistance(godot, three));
        }
      }
      if (seen.direction !== undefined) worst('light-direction', maxDifference(seen.direction, drawn.direction ?? []));
      // `shadow-mapping` (render-mapping): the three shadow the cited conversion gives for Godot's
      // parameters, against the one the scene states (each float32).
      if (seen.shadow !== undefined) {
        const expected = shadowMapping(seen.shadow);
        const stated = (drawn.shadow ?? []).slice(0, expected.length);
        shadowAgree &&= JSON.stringify(expected.map(Math.fround)) === JSON.stringify(stated.map(Math.fround));
      }
    }
    const exactAgree = JSON.stringify(canonical(native.exact)) === JSON.stringify(canonical(rendered.exact));
    const agree =
      exactAgree &&
      shadowAgree &&
      (Object.keys(deviations) as (keyof typeof deviations)[]).every((key) => deviations[key] <= TOLERANCES[key]);
    const comparison = JSON.stringify({ exact: canonical(native.exact), tolerances: Object.fromEntries(Object.entries(TOLERANCES).map(([key, value]) => [key, String(value)])), agree });
    return [
      {
        name: 'scene-render',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(JSON.stringify(canonical(native))),
          comparison: sha256(comparison),
        },
        agree,
        detail: `shadow-mapping ${String(shadowAgree)}\ndeviations ${JSON.stringify(deviations)}\nby node ${JSON.stringify(perNode)}\nnative ${JSON.stringify(canonical(native.exact))}\ntarget ${JSON.stringify(canonical(rendered.exact))}`,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
