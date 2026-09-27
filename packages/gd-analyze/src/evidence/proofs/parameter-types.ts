/**
 * The parameter-typing proof (`engine-virtual-parameter`, `signal-handler-parameter`,
 * `call-site-parameter`, `script-method-dispatch`): a running scene records the runtime type of
 * each untyped parameter as its callers pass it (the engine's `_process` / `_physics_process`, a
 * script signal and a native signal through scene connections, a script's own calls) and of what a
 * script function returns when called through a receiver declared as its base script class,
 * against the datatypes the analysis gave the same parameter reads and call (`bindGodotProject`),
 * and whether it classified the call as a script dispatch; an untyped member takes the one type
 * every value stored in it has (`member-assignment-type`), a call on it typed by that class; a call on such a parameter is typed by
 * its class's ClassDB method; a compound assignment of a typed member
 * with such a parameter has the operator's result type (the member's own). A parameter whose callers disagree (the
 * recorder's own `value`, the handler of a signal emitted with an int and a String) or that a `Callable` reaches (`escaped`) must stay untyped; the native
 * side records such a parameter as untyped when its values had more than one type.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { GODOT_PARAMETER_IMPLEMENTATION_FILES, godotAnalysisAuthority } from '../../analyze/authority-data';
import { bindGodotProject } from '../../analyze/bound-project';
import type { GodotBoundDatatype } from '../../godot-frontend/bound-program';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../../snapshot/toolchain-snapshot';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Parameter typing proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'main.gd': `extends Node3D

signal hit(amount: int)
signal counted
signal mixed_signal

var rows := {}
var frames := 0
var accumulated := 0.0
# Untyped members: one stores ints only (\`+=\` an int), one a float then an int (untyped), one a
# RandomNumberGenerator a call is made on.
var hits = 0
var speed = 1.5
var rng = RandomNumberGenerator.new()

# The type each label's value had, or "untyped" when its values had more than one.
func record(label, value) -> void:
\tvar seen: String = value.get_class() if typeof(value) == TYPE_OBJECT else type_string(typeof(value))
\tif rows.has(label) and rows[label] != seen:
\t\tseen = "untyped"
\trows[label] = seen

func _ready() -> void:
\thelper(1.5)
\thelper(2.25)
\tvar b: Base = $Derived
\trecord("returned", b.value())
\tescaped(1.5)
\thit.connect(escaped)
\thit.emit(3)
\thits += 1
\thits = hits + 2
\trecord("member-int", hits)
\trecord("member-mixed", speed)
\tspeed = 3
\trecord("member-mixed", speed)
\trng.seed = 4
\trecord("member-receiver", rng.randf_range(0.0, 1.0))
\tvar score: int = 7
\tcounted.emit(score)
\temit_signal("counted", 8)
\tmixed_signal.emit(1)
\tmixed_signal.emit("one")
\t$Emitter.add_child(Node.new())

func helper(x) -> void:
\trecord("from-calls", x)

# Called directly with a float and, through a Callable the analysis does not follow, by a signal
# with an int: it must stay untyped.
func escaped(v) -> void:
\trecord("escaped", v)

# An untyped signal every emission passes an int: its handler's parameter is an int.
func _on_counted(value) -> void:
\trecord("emitted-signal", value)

# Emissions that disagree (int, then String): the handler stays untyped.
func _on_mixed(value) -> void:
\trecord("mixed-signal", value)

func _on_hit(amount) -> void:
\trecord("script-signal", amount)

func _on_child(node) -> void:
\trecord("native-signal", node)
\t# A call on the typed parameter: ClassDB selects the method for the parameter's class.
\trecord("parameter-receiver", node.is_inside_tree())

func _process(delta) -> void:
\trecord("idle", delta)

func _physics_process(delta) -> void:
\trecord("physics", delta)
\t# A compound assignment of a typed member with the parameter: the operator's result type.
\taccumulated += delta
\trecord("compound", accumulated)
\tframes += 1

func _notification(what: int) -> void:
\tif what == NOTIFICATION_PROCESS and frames >= 2 and rows.has("idle"):
\t\trecord("mixed", 1)
\t\tprint("PARAMETERS " + JSON.stringify(rows))
\t\tget_tree().quit()
`,
  'base.gd': `class_name Base
extends Node3D

func value() -> int:
\treturn 1
`,
  'derived.gd': `extends Base

func value() -> int:
\treturn 2
`,
  'main.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="Script" path="res://derived.gd" id="2_derived"]

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Derived" type="Node3D" parent="."]
script = ExtResource("2_derived")

[node name="Emitter" type="Node" parent="."]

[connection signal="hit" from="." to="." method="_on_hit"]
[connection signal="counted" from="." to="." method="_on_counted"]
[connection signal="mixed_signal" from="." to="." method="_on_mixed"]
[connection signal="child_entered_tree" from="Emitter" to="." method="_on_child"]
`,
};

function inputDigest(): string {
  return sha256(
    Object.entries(files)
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .sort()
      .join('\n'),
  );
}

function typeName(datatype: GodotBoundDatatype | undefined): string {
  if (datatype === undefined) return 'untyped';
  if (datatype.kind === 'NATIVE') return datatype.nativeType;
  if (datatype.kind === 'CLASS' || datatype.kind === 'SCRIPT') return datatype.scriptPath;
  if (datatype.kind === 'ENUM') return 'int';
  return datatype.builtinType;
}

export function measureParameterTypeProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-parameter-types-'));
  try {
    for (const [relative, source] of Object.entries(files)) writeFileSync(path.join(temp, relative), source);

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
    const program = main.program;
    const target: Record<string, string> = {};
    for (const node of program.nodes) {
      if (node.kind !== 'CALL' || node.functionName !== 'record' || node.arguments.length !== 2) continue;
      const label = program.nodes[node.arguments[0] as number];
      const argument = program.nodes[node.arguments[1] as number];
      if (label?.kind !== 'LITERAL' || label.value.kind !== 'string' || argument === undefined) continue;
      const refined = main.refinedTypes.find((entry) => entry.nodeId === argument.id)?.datatype;
      if (argument.kind === 'CALL') {
        // A script dispatch or a receiver the analysis typed: classified, with its return type.
        const typed = main.scriptCalls.some((entry) => entry.nodeId === argument.id) || main.callReceivers.some((entry) => entry.nodeId === argument.id);
        target[label.value.value] = typed ? typeName(refined ?? (argument.datatype.kind === 'VARIANT' ? undefined : argument.datatype)) : 'untyped';
      } else {
        target[label.value.value] = typeName(refined ?? (argument.datatype.kind === 'VARIANT' ? undefined : argument.datatype));
      }
    }
    // The compound assignment's value: the refined type of the `+=` itself.
    const compound = program.nodes.find((node) => {
      if (node.kind !== 'ASSIGNMENT' || node.operation === 'OP_NONE') return false;
      const assignee = program.nodes[node.assignee];
      return assignee?.kind === 'IDENTIFIER' && assignee.name === 'accumulated';
    });
    target['compound'] = typeName(compound === undefined ? undefined : main.refinedTypes.find((entry) => entry.nodeId === compound.id)?.datatype ?? (compound.datatype.kind === 'VARIANT' ? undefined : compound.datatype));
    // The recorder's own `value` is passed values of several types: it stays untyped.
    const recorder = program.nodes.find((node) => node.kind === 'IDENTIFIER' && node.source === 'FUNCTION_PARAMETER' && node.name === 'value');
    target['recorder-value'] = typeName(recorder === undefined ? undefined : main.refinedTypes.find((entry) => entry.nodeId === recorder.id)?.datatype);

    // Native: the running scene, after the editor's import registers the global class.
    const imported = spawnSync(officialBinary, ['--editor', '--headless', '--path', temp, '--import', '--quit'], { encoding: 'utf8', timeout: 120_000 });
    if (imported.error !== undefined || imported.status !== 0) {
      throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
    }
    const run = spawnSync(officialBinary, ['--headless', '--path', temp], { encoding: 'utf8', timeout: 60_000 });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('PARAMETERS '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native parameter probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const native = JSON.parse(line.slice('PARAMETERS '.length)) as Record<string, string>;
    // The recorder is called with values of several types; Godot's runtime has no one type for it.
    const nativeRows = { ...native, 'recorder-value': 'untyped' };
    const nativeJson = JSON.stringify(canonical(nativeRows));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'parameter-types',
        identities: {
          input: inputDigest(),
          implementation: packageImplementationDigest(GODOT_PARAMETER_IMPLEMENTATION_FILES),
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
