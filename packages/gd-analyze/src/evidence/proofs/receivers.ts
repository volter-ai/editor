/**
 * The receiver-typing proof (`scene-node-receiver`, `classdb-method-selection`): for every dynamic
 * call the analysis typed, official Godot's `get_node(path).get_class()` for its `$path` base and
 * the class ClassDB reports as declaring the member (the first class up `get_parent_class` for
 * which `class_has_method(class, member, true)`), against the node class and the selected owner
 * `typeCallReceivers` produced on the same project. A call on a node that carries a script must
 * stay untyped (Godot calls the script first).
 *
 * The project nests instanced scenes and an imported `.glb` child path (the platformer's
 * `Enemy/Skeleton` shape): the fixture's `enemy.glb`, imported by the official editor first.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  GODOT_RECEIVER_IMPLEMENTATION_FILES,
  godotAnalysisAuthority,
} from '../../analyze/authority-data';
import { bindGodotProject } from '../../analyze/bound-project';
import { resolveScenePath } from '../../analyze/call-receivers';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../../snapshot/toolchain-snapshot';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MODEL_DIR = path.join(PACKAGE_ROOT, 'test/fixtures/platformer-3d-godot4/enemy');

/** Every dynamic call in main.gd on a `$path` base: [node path, member]. */
const CALLS = [
  ['Model/Skeleton/RayFloor', 'is_colliding'],
  ['Model/AnimationPlayer', 'get_animation_list'],
  ['Model/Skeleton/Skeleton3D', 'get_bone_count'],
  ['Level/Door', 'get_collision_layer'],
  ['Level/Inner/Lamp', 'get_param'],
  ['Level/Inner', 'get_visibility_parent'],
  ['Scripted', 'shout'],
] as const;

/**
 * Dynamic calls on another typed call's result: [base expression, member]. The receiver is a
 * built-in value, whose type the API dump states for the call, member or index that made it; a
 * built-in's methods are its own (no inheritance), so the declaring type is the value's type.
 */
const CHAINED = [
  ['$Level/Door.get_global_transform()', 'orthonormalized'],
  ['$Level/Door.get_global_transform().basis[2]', 'normalized'],
  ['$Level/Door.get_global_transform().origin', 'length'],
  ['self', 'get_position'],
] as const;

const argumentsOf = (member: string): string => (member === 'get_param' ? '0' : '');

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Receiver typing proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.gd': `extends Node3D

func typed_calls() -> void:
${CALLS.map(([nodePath, member]) => `\t$${nodePath}.${member}(${argumentsOf(member)})`).join('\n')}
${CHAINED.map(([base, member]) => `\t${base}.${member}()`).join('\n')}

func declaring(cls: String, member: String) -> String:
\tvar current := cls
\twhile current != "":
\t\tif ClassDB.class_has_method(current, member, true):
\t\t\treturn current
\t\tcurrent = ClassDB.get_parent_class(current)
\treturn ""

func _ready() -> void:
\tvar rows: Array = []
${CALLS.map(
  ([nodePath, member]) =>
    `\tvar n_${member}_${nodePath.replaceAll('/', '_')} = get_node(${JSON.stringify(nodePath)})\n\trows.append([${JSON.stringify(nodePath)}, ${JSON.stringify(member)}, n_${member}_${nodePath.replaceAll('/', '_')}.get_class(), declaring(n_${member}_${nodePath.replaceAll('/', '_')}.get_class(), ${JSON.stringify(member)}), n_${member}_${nodePath.replaceAll('/', '_')}.get_script() != null])`,
).join('\n')}
${CHAINED.map(
  ([base, member], index) =>
    `\tvar chained_${String(index)} = ${base}\n\tvar chained_class_${String(index)} = chained_${String(index)}.get_class() if typeof(chained_${String(index)}) == TYPE_OBJECT else type_string(typeof(chained_${String(index)}))\n\trows.append([${JSON.stringify(base)}, ${JSON.stringify(member)}, chained_class_${String(index)}, declaring(chained_class_${String(index)}, ${JSON.stringify(member)}) if typeof(chained_${String(index)}) == TYPE_OBJECT else chained_class_${String(index)}, false])`,
).join('\n')}
\tprint("RECEIVERS " + JSON.stringify(rows))
\tget_tree().quit()
`,
  'scripted.gd': `extends Node3D

func shout() -> int:
\treturn 1
`,
  'inner.tscn': `[gd_scene format=3]

[node name="Inner" type="Node3D"]

[node name="Lamp" type="OmniLight3D" parent="."]
`,
  'level.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://inner.tscn" id="1_inner"]

[node name="Level" type="Node3D"]

[node name="Door" type="StaticBody3D" parent="."]

[node name="Inner" parent="." instance=ExtResource("1_inner")]
`,
  // main.tscn instanced again: main.gd is also attached to this copy, where the RayFloor line
  // main.tscn places into the model is reached through the copied node's provenance.
  'outer.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://main.tscn" id="1_main"]

[node name="Outer" type="Node3D"]

[node name="Main" parent="." instance=ExtResource("1_main")]
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="2_model"]
[ext_resource type="PackedScene" path="res://level.tscn" id="3_level"]
[ext_resource type="Script" path="res://scripted.gd" id="4_scripted"]

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Model" parent="." instance=ExtResource("2_model")]

[node name="RayFloor" type="RayCast3D" parent="Model/Skeleton"]

[node name="Level" parent="." instance=ExtResource("3_level")]

[node name="Scripted" type="Node3D" parent="."]
script = ExtResource("4_scripted")
`,
};

function inputDigest(): string {
  return sha256(
    [
      ...Object.entries(files).map(([relative, source]) => `${relative}\0${sha256(source)}`),
      ...['enemy.glb', 'enemy.glb.import'].map(
        (name) => `enemy/${name}\0${sha256(readFileSync(path.join(MODEL_DIR, name)))}`,
      ),
    ]
      .sort()
      .join('\n'),
  );
}

export function measureReceiverProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = packageImplementationDigest(GODOT_RECEIVER_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-receivers-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
    mkdirSync(path.join(temp, 'enemy'));
    for (const name of ['enemy.glb', 'enemy.glb.import']) {
      copyFileSync(path.join(MODEL_DIR, name), path.join(temp, 'enemy', name));
    }
    const imported = spawnSync(
      officialBinary,
      ['--editor', '--headless', '--path', temp, '--import', '--quit'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    }

    // Target: the analysis over the same project.
    const snapshot = captureGodotProjectSnapshot(temp);
    const source = godotSourceAuthority(4);
    const readAuthority = godotReadAuthority(source);
    const decoded = readGodotProjectSnapshot(snapshot, readAuthority);
    const project = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
      bindGodotResources(decoded, readAuthority),
      godotAnalysisAuthority(source),
      source,
      captureGodotApiDumpSnapshot(source),
      readGodotProjectSnapshot(snapshot, readAuthority),
    );
    const main = project.scripts.find((entry) => entry.resPath === 'res://main.gd');
    if (main === undefined) throw new Error('bound project omitted res://main.gd');
    const scenes = new Map(decoded.scenes.map((scene) => [scene.resPath, scene] as const));
    const attachment = { documentPath: 'res://main.tscn', nodePath: '.' };
    const program = main.program;
    const chainedCalls = program.nodes.filter(
      (node) =>
        node.kind === 'CALL' &&
        (node.compilerTarget.kind === 'dynamic' || node.compilerTarget.kind === 'unresolved') &&
        CHAINED.some(([, member]) => member === node.functionName),
    );
    const chainedTarget = CHAINED.map(([base, member]) => {
      const call = chainedCalls.find((node) => node.kind === 'CALL' && node.functionName === member);
      const typed = call === undefined ? undefined : main.callReceivers.find((entry) => entry.nodeId === call.id);
      return {
        path: base,
        member,
        nodeClass: typed === undefined ? 'untyped' : typed.target.owner,
        declaring: typed === undefined ? 'untyped' : typed.target.owner,
      };
    });
    const pathTarget = CALLS.map(([nodePath, member]) => {
      const call = program.nodes.find((node) => {
        if (node.kind !== 'CALL' || node.functionName !== member) return false;
        const callee = program.nodes[node.callee];
        if (callee?.kind !== 'SUBSCRIPT') return false;
        const base = program.nodes[callee.base];
        return base?.kind === 'GET_NODE' && base.fullPath === nodePath;
      });
      if (call === undefined) throw new Error(`main.gd has no call ${nodePath}.${member}`);
      const typed = main.callReceivers.find((entry) => entry.nodeId === call.id);
      const resolved = resolveScenePath(scenes, attachment, nodePath);
      return {
        path: nodePath,
        member,
        nodeClass: typeof resolved === 'string' ? `unresolved: ${resolved}` : resolved.className,
        declaring: typed === undefined ? 'untyped' : typed.target.owner,
      };
    });
    const target = [...pathTarget, ...chainedTarget];

    // Native: the running scene.
    const run = spawnSync(officialBinary, ['--headless', '--path', temp], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('RECEIVERS '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native receiver probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const rows = JSON.parse(line.slice('RECEIVERS '.length)) as [string, string, string, string, boolean][];
    const native = rows.map(([nodePath, member, nodeClass, declaring, scripted]) => ({
      path: nodePath,
      member,
      nodeClass,
      // Godot calls the script's member first; the analysis must leave such a call untyped.
      declaring: scripted ? 'untyped' : declaring,
    }));
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'receivers',
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
