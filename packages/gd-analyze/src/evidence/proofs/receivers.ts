/**
 * The receiver-typing proof (`scene-node-receiver`, `classdb-method-selection`): for every dynamic
 * call the analysis typed, official Godot's `get_node(path).get_class()` for its `$path` base and
 * the class ClassDB reports as declaring the member (the first class up `get_parent_class` for
 * which `class_has_method(class, member, true)`), against the node class and the selected owner
 * `typeCallReceivers` produced on the same project. A call on a node that carries a script must
 * stay untyped (Godot calls the script first).
 *
 * The datatypes the analysis fixes (`scene-node-receiver`, `classdb-method-selection`): each
 * `$Path` / `%Unique` node's class or script and its members' types, against Godot's
 * `get_class()` / script path / `typeof` of the same values.
 *
 * Calls inside `if n is A or n is B:` are typed by the narrowed classes (`type-test-narrowing`):
 * each class's ClassDB selection, when they agree.
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

/**
 * Dynamic calls on a local inside `if n is A or n is B:` (`type-test-narrowing`): [classes, member].
 * Godot runs the branch only for those classes; each selects the member through ClassDB.
 */
const NARROWED = [
  [['RigidBody3D', 'CharacterBody3D'], 'get_rid'],
  [['StaticBody3D'], 'get_collision_layer'],
  [['OmniLight3D', 'SpotLight3D'], 'get_param'],
] as const;

/**
 * Expressions whose datatype the analysis fixes (`refineDatatypes`): scene nodes by `$Path` and
 * `%Unique` (their class, or their script when they carry one), and member reads on them (a
 * native property's getter type, a script field's declared type).
 */
const REFINED = [
  '$Level/Door',
  '$Scripted',
  '%Marker',
  '%Tip',
  '$Level/Inner/Lamp.omni_range',
  '$Level/Door.collision_layer',
  '$Scripted.level',
  '$Scripted.position',
  '%Marker.gizmo_extents',
] as const;

/** The keys of \`intersect_ray\`'s result the analysis types. */
const RAY_KEYS = ['position', 'normal', 'face_index', 'shape', 'collider_id'] as const;

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

func refined_values() -> Array:
\treturn [${REFINED.join(', ')}]

# A ray's result Dictionary, read by its keys (\`ray-result-schema\`).
func ray_values() -> Array:
\tvar hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(0, 10, 0), Vector3(0, -10, 0)))
\treturn [${RAY_KEYS.map((key) => `hit.${key}`).join(', ')}]

func narrowed(n: Node) -> void:
${NARROWED.map(([classes, member]) => `\tif ${classes.map((name) => `n is ${name}`).join(' or ')}:\n\t\tn.${member}(${argumentsOf(member)})`).join('\n')}

func agreed(classes: Array, member: String) -> String:
\tvar owner := declaring(classes[0], member)
\tfor cls in classes:
\t\tif declaring(cls, member) != owner:
\t\t\treturn "disagree"
\treturn owner

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
${NARROWED.map(
  ([classes, member]) =>
    `\trows.append([${JSON.stringify(classes.join('|'))}, ${JSON.stringify(member)}, ${JSON.stringify(classes.join('|'))}, agreed(${JSON.stringify(classes)}, ${JSON.stringify(member)}), false])`,
).join('\n')}
\tvar refined := []
\tfor value in refined_values():
\t\tif typeof(value) == TYPE_OBJECT:
\t\t\trefined.append(value.get_script().resource_path if value.get_script() != null else value.get_class())
\t\telse:
\t\t\trefined.append(type_string(typeof(value)))
\trows.append(["refined", "", JSON.stringify(refined), "", false])
\tawait get_tree().physics_frame
\tvar ray := []
\tfor value in ray_values():
\t\tray.append(type_string(typeof(value)))
\trows.append(["ray", "", JSON.stringify(ray), "", false])
\tprint("RECEIVERS " + JSON.stringify(rows))
\tget_tree().quit()
`,
  'scripted.gd': `extends Node3D

var level: int = 3

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
  // main.tscn places into the model is reached through the copied node's provenance, and `%Tip`
  // (a line main.tscn places into the model) is a unique node the instance root itself owns.
  'outer.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://main.tscn" id="1_main"]

[node name="Outer" type="Node3D"]

[node name="Main" parent="." instance=ExtResource("1_main")]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0)
`,
  'main.tscn': `[gd_scene load_steps=5 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://enemy/enemy.glb" id="2_model"]
[ext_resource type="PackedScene" path="res://level.tscn" id="3_level"]
[ext_resource type="Script" path="res://scripted.gd" id="4_scripted"]

[sub_resource type="BoxShape3D" id="GroundBox"]
size = Vector3(4, 1, 4)

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Model" parent="." instance=ExtResource("2_model")]

[node name="RayFloor" type="RayCast3D" parent="Model/Skeleton"]

[node name="Tip" type="Marker3D" parent="Model/Skeleton"]
unique_name_in_owner = true

[node name="Level" parent="." instance=ExtResource("3_level")]

[node name="Scripted" type="Node3D" parent="."]
script = ExtResource("4_scripted")

[node name="Marker" type="Marker3D" parent="Level"]
unique_name_in_owner = true

[node name="Ground" type="StaticBody3D" parent="."]

[node name="Box" type="CollisionShape3D" parent="Ground"]
shape = SubResource("GroundBox")
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
    const narrowedTarget = NARROWED.map(([classes, member]) => {
      const call = program.nodes.find((node) => {
        if (node.kind !== 'CALL' || node.functionName !== member) return false;
        const callee = program.nodes[node.callee];
        if (callee?.kind !== 'SUBSCRIPT') return false;
        const base = program.nodes[callee.base];
        return base?.kind === 'IDENTIFIER' && base.name === 'n';
      });
      const typed = call === undefined ? undefined : main.callReceivers.find((entry) => entry.nodeId === call.id);
      return {
        path: classes.join('|'),
        member,
        nodeClass: classes.join('|'),
        declaring: typed === undefined ? 'untyped' : typed.target.owner,
      };
    });
    // The datatype the analysis fixed for each element of refined_values()'s array.
    const refinedArray = program.nodes.find((node) => node.kind === 'ARRAY' && node.elements.length === REFINED.length);
    if (refinedArray?.kind !== 'ARRAY') throw new Error('main.gd has no refined_values() array');
    const refinedTarget = refinedArray.elements.map((id) => {
      const datatype = main.refinedTypes.find((entry) => entry.nodeId === id)?.datatype;
      if (datatype === undefined) return 'untyped';
      if (datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT') return datatype.scriptPath;
      if (datatype.kind === 'NATIVE') return datatype.nativeType;
      return datatype.kind === 'ENUM' ? 'int' : datatype.builtinType;
    });
    const rayArray = program.nodes.find(
      (node) =>
        node.kind === 'ARRAY' &&
        node.elements.length === RAY_KEYS.length &&
        node.elements.every((id) => program.nodes[id]?.kind === 'SUBSCRIPT'),
    );
    if (rayArray?.kind !== 'ARRAY') throw new Error('main.gd has no ray_values() array');
    const rayTarget = rayArray.elements.map((id) => {
      const datatype = main.refinedTypes.find((entry) => entry.nodeId === id)?.datatype;
      return datatype === undefined ? 'untyped' : datatype.builtinType;
    });
    const target = [
      ...pathTarget,
      ...chainedTarget,
      ...narrowedTarget,
      { path: 'refined', member: '', nodeClass: JSON.stringify(refinedTarget), declaring: '' },
      { path: 'ray', member: '', nodeClass: JSON.stringify(rayTarget), declaring: '' },
    ];

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
