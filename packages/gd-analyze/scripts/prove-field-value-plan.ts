#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { godotAnalysisAuthority } from '../src/analyze/authority-data';
import { bindGodotProject } from '../src/analyze/bound-project';
import { captureGodotBoundProgram } from '../src/godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../src/godot-frontend/source-authority';
import { godotReadAuthority } from '../src/read/authority-data';
import { readGodotProjectSnapshot } from '../src/read/godot-project';
import { bindGodotResources } from '../src/read/resource-program';
import { captureGodotProjectSnapshot } from '../src/snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../src/snapshot/toolchain-snapshot';
import { GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256 } from '../src/translate/code/authority/godot-4.7-seed';
import {
  GODOT_4_7_FIELD_VALUE_COMPARISON_SHA256,
  GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256,
  GODOT_4_7_FIELD_VALUE_INPUT_SHA256,
  GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256,
} from '../src/translate/data/authority/godot-4.7-field-values';
import { godotFieldValueAuthority } from '../src/translate/data/field-value-authority-data';
import { planScriptFieldInitializations } from '../src/translate/data/script-field-initialization-plan';

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

const IMPLEMENTATION_FILES = [
  'src/analyze/bound-project.ts',
  'src/translate/data/field-value-authority.ts',
  'src/translate/data/script-field-initialization-plan.ts',
] as const;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing ${name}`);
  return path.resolve(value);
}

function inputDigest(): string {
  return sha256(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

function implementationDigest(): string {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  return sha256(
    [...IMPLEMENTATION_FILES]
      .sort()
      .map((relative) => `${relative}\0${sha256(readFileSync(path.join(packageRoot, relative)))}`)
      .join('\n'),
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

const exporterBinary = argument('--exporter-binary');
const officialBinary = argument('--official-binary');
const actualInput = inputDigest();
const actualImplementation = implementationDigest();
if (sha256(readFileSync(officialBinary)) !== GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256) {
  throw new Error('official Godot executable does not match the field-value authority pin');
}
if (actualInput !== GODOT_4_7_FIELD_VALUE_INPUT_SHA256) {
  throw new Error(`field-value authority input changed: ${actualInput}`);
}
if (actualImplementation !== GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256) {
  throw new Error(`field-value authority implementation changed: ${actualImplementation}`);
}

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
  if (
    actualObserved !== GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256 ||
    sha256(targetJson) !== GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256 ||
    actualComparison !== GODOT_4_7_FIELD_VALUE_COMPARISON_SHA256
  ) {
    throw new Error(
      `field-value observations changed: observed=${actualObserved} comparison=${actualComparison}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ verdict: 'exact-match', native, target, evidence: result.plan.evidenceClaimIds })}\n`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
