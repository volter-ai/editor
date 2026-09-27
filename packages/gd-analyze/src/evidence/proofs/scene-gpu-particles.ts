/**
 * The scene-gpu-particles proof: GPUParticles3D systems as the 3D platformer kit authors them —
 * the player's trail (60 particles stepped by the frame's delta, a sphere emitter, Y aligned to
 * velocity, a scale curve) and a brick's burst (one shot, explosive, fully random, pre-processed,
 * sped up, at a fixed 60 fps in local coordinates, with a scale curve and a colour ramp), each
 * with a fixed seed and a quad draw pass.
 *
 * Headless Godot has no renderer to simulate GPU particles, so the native side is official Godot
 * in a window on the Compatibility renderer (the web export's renderer) at `--fixed-fps 60`; after
 * each frame it reads `GPUParticles3D.capture_aabb()`, which reads the particle buffer back from
 * the GPU (`ParticlesStorage::particles_get_current_aabb`). The target side is the production
 * pipeline's emitted project in headless Chromium (`browser-harness.ts`), mounted as the game
 * mounts it, compat's clock at the same fixed 60 fps, stepping frame by frame and reading compat's
 * `capture_aabb`. Both run on this machine's GPU through Metal; the comparator allows the GPU's
 * float error (`GPU_ULPS` units in the last place of float32, per component), since neither side
 * computes the simulation's transcendental functions itself.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { GODOT_SCENE_GPU_PARTICLES_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { runBrowserProof } from '../browser-harness';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const FRAMES = 90;
const SYSTEMS = ['Trail', 'Burst'] as const;
/** How far apart two GPUs' float32 results may be, in units in the last place. */
const GPU_ULPS = 4;

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7", "GL Compatibility")

[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`,
  'main.tscn': `[gd_scene load_steps=10 format=3]

[sub_resource type="Curve" id="Curve_xh1e2"]
_data = [Vector2(0, 0), 0.0, 0.0, 0, 0, Vector2(0.249284, 1), 0.0, 0.0, 0, 0, Vector2(1, 0), 0.0, 0.0, 0, 0]
point_count = 3

[sub_resource type="CurveTexture" id="CurveTexture_f46kd"]
curve = SubResource("Curve_xh1e2")

[sub_resource type="ParticleProcessMaterial" id="ParticleProcessMaterial_3rerk"]
particle_flag_align_y = true
emission_shape = 1
emission_sphere_radius = 0.2
direction = Vector3(0, 0, 0)
gravity = Vector3(0, 0.1, 0)
scale_min = 0.75
scale_curve = SubResource("CurveTexture_f46kd")

[sub_resource type="Gradient" id="Gradient_pm7ss"]
colors = PackedColorArray(0.996094, 0.910156, 0.351563, 1, 1, 1, 1, 1)

[sub_resource type="GradientTexture1D" id="GradientTexture1D_1o7s2"]
gradient = SubResource("Gradient_pm7ss")

[sub_resource type="Curve" id="Curve_y3bws"]
_data = [Vector2(0.0075757504, 0.8651686), 0.0, 0.018773995, 0, 0, Vector2(0.9924243, 0), -3.356592, 0.0, 0, 0]
point_count = 2

[sub_resource type="CurveTexture" id="CurveTexture_iwokp"]
curve = SubResource("Curve_y3bws")

[sub_resource type="ParticleProcessMaterial" id="ParticleProcessMaterial_mi6g1"]
particle_flag_align_y = true
particle_flag_disable_z = true
emission_shape = 1
emission_sphere_radius = 0.6
direction = Vector3(0, 10, 0)
spread = 40.0
initial_velocity_min = 4.0
initial_velocity_max = 6.0
linear_accel_min = -2.0000021
linear_accel_max = -1.0000023
scale_min = 0.29999998
scale_curve = SubResource("CurveTexture_iwokp")
color_ramp = SubResource("GradientTexture1D_1o7s2")

[sub_resource type="QuadMesh" id="QuadMesh_q"]

[node name="Main" type="Node3D"]

[node name="Camera" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 6)

[node name="Trail" type="GPUParticles3D" parent="."]
amount = 60
fixed_fps = 0
use_fixed_seed = true
seed = 11
process_material = SubResource("ParticleProcessMaterial_3rerk")
draw_pass_1 = SubResource("QuadMesh_q")

[node name="Burst" type="GPUParticles3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 1.5, 0.25192702, 0)
amount = 5
one_shot = true
preprocess = 0.1
speed_scale = 1.25
explosiveness = 1.0
randomness = 1.0
fixed_fps = 60
local_coords = true
use_fixed_seed = true
seed = 29
process_material = SubResource("ParticleProcessMaterial_mi6g1")
draw_pass_1 = SubResource("QuadMesh_q")
`,
};

/** Official Godot, windowed: after each frame, each system's `capture_aabb()`. */
const OBSERVE = `extends SceneTree
var main: Node
var rows := []
func _initialize() -> void:
\tmain = load("res://main.tscn").instantiate()
\troot.add_child(main)
func _aabb(a: AABB) -> Array:
\treturn [a.position.x, a.position.y, a.position.z, a.size.x, a.size.y, a.size.z]
func _process(_delta: float) -> bool:
\tvar row := []
\tfor name in ${JSON.stringify(SYSTEMS)}:
\t\tvar p: GPUParticles3D = main.get_node(name)
\t\trow.append([_aabb(p.capture_aabb()), p.emitting])
\trows.append(row)
\tif rows.size() >= ${String(FRAMES)}:
\t\tprint("ROWS " + JSON.stringify(rows))
\t\treturn true
\treturn false
`;

/** The harness page: the emitted world, stepped by hand at a fixed 60 fps, read after each frame. */
const PAGE = `import { Canvas, useThree } from '@react-three/fiber';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import World from './src/world';
import { godot_main_timer_sync_set_fixed_fps } from './src/lib/godot-compat/main-timer-sync';
import { capture_aabb, is_emitting } from './src/lib/godot-compat/gpu-particles-3d';
import { is_inside_tree } from './src/lib/godot-compat/node';

godot_main_timer_sync_set_fixed_fps(60);
const SYSTEMS = ${JSON.stringify(SYSTEMS)};
const view = window as unknown as { godotProofRows?: unknown; godotProofError?: unknown };

function Driver() {
  const { advance, scene } = useThree();
  useEffect(() => {
    let live = true;
    const rows: unknown[] = [];
    const systems = () => SYSTEMS.map((name) => scene.getObjectByName(name));
    const step = async () => {
      try {
        // The world mounts its scene once its resources load; frames count from the systems' entry.
        for (let guard = 0; live && systems().some((system) => system === undefined || !is_inside_tree(system)); guard += 1) {
          if (guard > 600) throw new Error('the particle systems never entered the tree');
          advance(performance.now());
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        while (live && rows.length < ${String(FRAMES)}) {
          advance(performance.now());
          rows.push(systems().map((system) => {
            const a = capture_aabb(system as object);
            return [[a.position.x, a.position.y, a.position.z, a.size.x, a.size.y, a.size.z], is_emitting(system as object)];
          }));
        }
        view.godotProofRows = rows;
      } catch (error) {
        view.godotProofError = error instanceof Error ? error.stack ?? error.message : String(error);
      }
    };
    void step();
    return () => {
      live = false;
    };
  }, [advance, scene]);
  return null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  createElement(Canvas, { frameloop: 'never', gl: { preserveDrawingBuffer: true } }, createElement(World), createElement(Driver)),
);
`;

/** Whether two float32 values are within `GPU_ULPS` units in the last place. */
function nearF32(left: number, right: number): boolean {
  if (left === right) return true;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const bits = (value: number) => {
    const word = new Int32Array(new Float32Array([value]).buffer)[0] as number;
    return word < 0 ? -2147483648 - word : word;
  };
  return Math.abs(bits(left) - bits(right)) <= GPU_ULPS;
}

function compare(native: unknown, target: unknown, at = '$'): string | undefined {
  if (typeof native === 'number' && typeof target === 'number') return nearF32(native, target) ? undefined : `${at}: ${String(native)} != ${String(target)}`;
  if (Array.isArray(native) && Array.isArray(target)) {
    if (native.length !== target.length) return `${at}: length ${String(native.length)} != ${String(target.length)}`;
    for (let i = 0; i < native.length; i += 1) {
      const found = compare(native[i], target[i], `${at}[${String(i)}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return native === target ? undefined : `${at}: ${JSON.stringify(native)} != ${JSON.stringify(target)}`;
}

export async function measureSceneGpuParticlesProof(tools: GodotProofTools): Promise<readonly GodotProofMeasurement[]> {
  const { officialBinary, exporterBinary } = tools;
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-gpu-particles-proof-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(project, name), text);
    const actualInput = sha256(JSON.stringify(canonical({ files, OBSERVE, PAGE, FRAMES, GPU_ULPS })));
    const actualImplementation = monorepoImplementationDigest(GODOT_SCENE_GPU_PARTICLES_IMPLEMENTATION_FILES);

    const snapshot = captureGodotProjectSnapshot(project);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary: tools.pipelineOfficialBinary ?? officialBinary,
    });
    const decoded = readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority);
    const bound = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: project }),
      bindGodotResources(decoded, toolchain.frontend.readAuthority),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      decoded,
    );
    const translation = planGodotTranslation(bound, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const out = path.join(temp, 'out');
    mkdirSync(out);
    writeGodotTranslationArtifacts(emitGodotTranslation(translation), out);
    symlinkSync(path.join(MONOREPO_ROOT, 'node_modules'), path.join(out, 'node_modules'));
    const target = await runBrowserProof(out, { module: PAGE });

    // Native: import once headless, then run the scene in a window on the Compatibility renderer.
    const imported = spawnSync(officialBinary, ['--headless', '--path', project, '--import', '--quit'], { encoding: 'utf8', timeout: 180_000 });
    if (imported.error !== undefined || imported.status !== 0) throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    writeFileSync(path.join(project, 'observe.gd'), OBSERVE);
    const run = spawnSync(
      officialBinary,
      ['--path', project, '--rendering-method', 'gl_compatibility', '--fixed-fps', '60', '--resolution', '320x240', '--script', 'res://observe.gd'],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('ROWS '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native GPU particles probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('ROWS '.length)) as unknown;
    const difference = compare(native, target.rows);
    const nativeJson = JSON.stringify(native);
    const targetJson = JSON.stringify(target.rows);
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, ulps: GPU_ULPS, equal: difference === undefined });
    return [
      {
        name: 'scene-gpu-particles',
        identities: { input: actualInput, implementation: actualImplementation, observed: sha256(nativeJson), comparison: sha256(comparison) },
        agree: difference === undefined,
        detail: `${difference ?? 'agree'} (target renderer: ${target.renderer})\nnative ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    if (process.env['KEEP_WORLD'] === undefined) rmSync(temp, { recursive: true, force: true });
    else process.stdout.write(`${temp}\n`);
  }
}
