/** The field-value authority's proof: official Godot's authored field values versus the plan. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { godotAnalysisAuthority } from '../../analyze/authority-data';
import { bindGodotProject } from '../../analyze/bound-project';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../../snapshot/toolchain-snapshot';
import {
  GODOT_FIELD_VALUE_IMPLEMENTATION_FILES,
  godotFieldValueAuthority,
} from '../../translate/data/field-value-authority-data';
import { planScriptFieldInitializations } from '../../translate/data/script-field-initialization-plan';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Field value proof"
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'field_values.gd': `extends Node

@export var count: int = 0
@export var ratio: float = 0.0
@export var enabled: bool = false
@export var title: String = ""

func _ready() -> void:
	print(JSON.stringify({"count": count, "ratio": ratio, "enabled": enabled, "title": title}))
	get_tree().quit()
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://field_values.gd" id="1_fields"]

[node name="Main" type="Node"]
script = ExtResource("1_fields")
count = 7
ratio = 2.5
enabled = true
title = "hello"
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

export function measureFieldValueProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = packageImplementationDigest(GODOT_FIELD_VALUE_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-field-values-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
    const sourceAuthority = godotSourceAuthority(4);
    const readAuthority = godotReadAuthority(sourceAuthority);
    const snapshot = captureGodotProjectSnapshot(temp);
    const project = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
      bindGodotResources(readGodotProjectSnapshot(snapshot, readAuthority), readAuthority),
      godotAnalysisAuthority(sourceAuthority),
      sourceAuthority,
      captureGodotApiDumpSnapshot(sourceAuthority),
      readGodotProjectSnapshot(snapshot, readAuthority),
    );
    const result = planScriptFieldInitializations(project, godotFieldValueAuthority(sourceAuthority));
    if (result.kind !== 'accepted-field-initializations') {
      throw new Error(result.diagnostics.map((entry) => entry.message).join('\n'));
    }
    const attachment = result.plan.attachments[0];
    if (result.plan.attachments.length !== 1 || attachment === undefined) {
      throw new Error(
        `field-value plan has wrong attachment count: ${result.plan.attachments.length}`,
      );
    }
    const target = Object.fromEntries(
      attachment.fields.map((field) => [field.fieldName, field.value.value]),
    );
    const nativeRun = spawnSync(officialBinary, ['--headless', '--path', temp], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (nativeRun.error !== undefined || nativeRun.status !== 0) {
      throw new Error(
        `native field-value probe failed: ${nativeRun.error?.message ?? nativeRun.stderr}`,
      );
    }
    const nativeLine = nativeRun.stdout.split('\n').find((line) => line.startsWith('{'));
    if (nativeLine === undefined)
      throw new Error(`native field-value probe had no value: ${nativeRun.stdout}`);
    const native = JSON.parse(nativeLine) as unknown;
    const nativeJson = JSON.stringify(canonical(native));
    const targetJson = JSON.stringify(canonical(target));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: true });
    if (nativeJson !== targetJson)
      throw new Error(`field-value mismatch: ${nativeJson} != ${targetJson}`);
    const actualObserved = sha256(nativeJson);
    const actualComparison = sha256(comparison);
    return [
      {
        name: 'field-values',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: actualObserved,
          comparison: actualComparison,
        },
        agree: true,
        detail: comparison,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
