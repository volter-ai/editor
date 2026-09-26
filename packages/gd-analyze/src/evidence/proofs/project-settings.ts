/**
 * The setting-type proof (`project-setting-type`): official Godot's
 * `type_string(typeof(ProjectSettings.get_setting(key)))` for each literal key main.gd reads, and of
 * each operator over such values, against the type `typeProjectSettingValues` gave the same call or
 * operator. The keys cover a value `project.godot` declares (of another type than the registered
 * default's), registered defaults of several types, and a key with neither (stays untyped).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  GODOT_PROJECT_SETTING_IMPLEMENTATION_FILES,
  godotAnalysisAuthority,
} from '../../analyze/authority-data';
import { bindGodotProject } from '../../analyze/bound-project';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../../snapshot/toolchain-snapshot';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

/** Expressions main.gd evaluates: each a `get_setting` call or an operator over such calls. */
const EXPRESSIONS = [
  'ProjectSettings.get_setting("physics/3d/default_gravity")',
  'ProjectSettings.get_setting("physics/3d/default_gravity_vector")',
  'ProjectSettings.get_setting("physics/3d/default_gravity") * ProjectSettings.get_setting("physics/3d/default_gravity_vector")',
  'ProjectSettings.get_setting("physics/3d/default_gravity_vector") * ProjectSettings.get_setting("physics/3d/default_gravity")',
  'ProjectSettings.get_setting("physics/2d/default_gravity")',
  'ProjectSettings.get_setting("display/window/size/viewport_width")',
  'ProjectSettings.get_setting("application/config/name")',
  'ProjectSettings.get_setting("rendering/environment/defaults/default_clear_color")',
  'ProjectSettings.get_setting("application/run/disable_stdout")',
  'ProjectSettings.get_setting("game/custom/speed")',
  'ProjectSettings.get_setting("game/custom/undeclared")',
  'ProjectSettings.get_setting("game/custom/speed") + ProjectSettings.get_setting("physics/3d/default_gravity")',
  'ProjectSettings.get_setting("display/window/size/viewport_width") / ProjectSettings.get_setting("display/window/size/viewport_height")',
] as const;

const files: Readonly<Record<string, string>> = {
  // physics/2d/default_gravity is registered as a float; the project declares an int.
  'project.godot': `config_version=5

[application]
config/name="Setting type proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960

[game]
custom/speed=4.5

[physics]
2d/default_gravity=900
3d/default_gravity=14.0
`,
  'main.gd': `extends Node

func _ready() -> void:
\tvar rows: Array = []
${EXPRESSIONS.map(
  (expression, index) =>
    `\tvar value_${String(index)} = ${expression}\n\trows.append(type_string(typeof(value_${String(index)})))`,
).join('\n')}
\tprint("SETTINGS " + JSON.stringify(rows))
\tget_tree().quit()
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]

[node name="Main" type="Node"]
script = ExtResource("1_main")
`,
};

function inputDigest(): string {
  return sha256(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

export function measureProjectSettingProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = packageImplementationDigest(GODOT_PROJECT_SETTING_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-settings-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
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
    // Each `var value_i = <expression>`: the initializer is the expression.
    const target = EXPRESSIONS.map((_, index) => {
      const variable = program.nodes.find((node) => {
        if (node.kind !== 'VARIABLE') return false;
        const identifier = program.nodes[node.identifier];
        return identifier?.kind === 'IDENTIFIER' && identifier.name === `value_${String(index)}`;
      });
      if (variable?.kind !== 'VARIABLE') throw new Error(`main.gd has no value_${String(index)}`);
      const typed = main.settingTypes.find((entry) => entry.nodeId === variable.initializer);
      return typed === undefined ? 'untyped' : typed.builtinType;
    });

    const run = spawnSync(officialBinary, ['--headless', '--path', temp], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    const line = run.stdout.split('\n').find((entry) => entry.startsWith('SETTINGS '));
    if (run.error !== undefined || line === undefined) {
      throw new Error(`native setting probe failed: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
    }
    const nativeTypes = JSON.parse(line.slice('SETTINGS '.length)) as string[];
    // A value no project fact fixes stays untyped: Godot returns `null` for an undeclared,
    // unregistered key, which the analysis must not claim a type for.
    const native = nativeTypes.map((type) => (type === 'Nil' ? 'untyped' : type));
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'project-settings',
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
