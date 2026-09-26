#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { godotAnalysisAuthority } from '../src/analyze/authority-data';
import { bindGodotProject } from '../src/analyze/bound-project';
import { captureGodotBoundProgram } from '../src/godot-frontend/run-bound-program';
import { godotSourceAuthority } from '../src/godot-frontend/source-authority';
import { godotReadAuthority } from '../src/read/authority-data';
import { readGodotProjectSnapshot } from '../src/read/godot-project';
import { bindGodotResources } from '../src/read/resource-program';
import { captureGodotProjectSnapshot } from '../src/snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../src/snapshot/toolchain-snapshot';
import {
  GODOT_4_7_LANGUAGE_COMPARISON_SHA256,
  GODOT_4_7_LANGUAGE_IMPLEMENTATION_SHA256,
  GODOT_4_7_LANGUAGE_INPUT_SHA256,
  GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256,
} from '../src/translate/code/authority/godot-4.7-language-semantics';
import { GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256 } from '../src/translate/code/authority/godot-4.7-seed';
import { godotCodeTranslationAuthority } from '../src/translate/code/authority-data';
import { lowerOfficialBoundProgram } from '../src/translate/code/lower-official-bound';
import { printTargetTsSourceFile } from '../src/translate/emit/target-ts-printer';

const LANGUAGE_SOURCE = `class_name LanguageSemantics
extends RefCounted

const OFFSET: int = 3
const SCALE: float = 2.5
static var total: int = 0
@export var amount: float = 1.5
var enabled: bool = true

enum Mode { OFF, ON = 4 }

func instance_value(input: float) -> float:
\treturn input * SCALE + amount

static func evaluate(seed: int = 4) -> Array[int]:
\tvar sum: int = seed + OFFSET
\tvar values: Array[int] = [1, 2, 3]
\tvar before: int = sum
\tif sum > 5:
\t\tsum += values[0]
\telse:
\t\tsum -= 1
\tvar index: int = 0
\twhile index < 2:
\t\tsum += index
\t\tindex += 1
\twhile true:
\t\tsum += 1
\t\tbreak
\tfor value: int in values:
\t\tif value == 2:
\t\t\tcontinue
\t\tsum += value
\tvar negated: int = -sum
\tvar positive: bool = sum > 0
\tvar choice: int = sum if positive else 0
\ttotal = sum
\treturn [sum, negated, 1 if positive else 0, before, choice]
`;
const PROJECT_SOURCE = `config_version=5

[application]
config/name="VGAI language semantics authority"
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`;
const MAIN_SCENE = `[gd_scene format=3]\n\n[node name="Main" type="Node"]\n`;
const NATIVE_PROBE = `extends SceneTree

func _initialize() -> void:
\tvar script = load("res://language_semantics.gd")
\tvar instance = script.new()
\tprint(JSON.stringify({"target": script.evaluate(), "total": script.total, "instance": instance.instance_value(2.0), "mode": script.Mode}))
\tquit()
`;
const IMPLEMENTATION_FILES = [
  'src/translate/code/bindings.ts',
  'src/translate/code/lower-official-bound.ts',
  'src/translate/code/lower-official-statement.ts',
  'src/translate/code/lower-official-expression.ts',
  'src/translate/code/official-bound-lowering-context.ts',
  'src/translate/code/lowering-rules.ts',
  'src/translate/code/target-ts-syntax.ts',
  'src/translate/emit/target-ts-printer.ts',
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

function nativeValue(officialBinary: string, project: string): unknown {
  const probe = path.join(project, 'native_probe.gd');
  writeFileSync(probe, NATIVE_PROBE);
  const result = spawnSync(
    officialBinary,
    ['--headless', '--path', project, '--script', 'res://native_probe.gd'],
    { encoding: 'utf8' },
  );
  rmSync(probe);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`native language probe failed: ${result.error?.message ?? result.stderr}`);
  }
  const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('{'));
  if (line === undefined)
    throw new Error(`native language probe returned no value: ${result.stdout}`);
  return JSON.parse(line) as unknown;
}

function targetValue(source: string): unknown {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  Function('exports', 'module', transpiled)(module.exports, module);
  const language = module.exports['LanguageSemantics'] as
    | {
        evaluate?: () => unknown;
        total?: unknown;
        Mode?: unknown;
        new (): { instance_value?: (input: number) => unknown };
      }
    | undefined;
  if (typeof language?.evaluate !== 'function') {
    throw new Error('target language class has no evaluate()');
  }
  const instance = new language();
  if (typeof instance.instance_value !== 'function') {
    throw new Error('target language class has no instance_value()');
  }
  return {
    target: language.evaluate(),
    total: language.total,
    instance: instance.instance_value(2),
    mode: language.Mode,
  };
}

const exporterBinary = argument('--exporter-binary');
const officialBinary = argument('--official-binary');
if (sha256(readFileSync(officialBinary)) !== GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256) {
  throw new Error('official Godot executable does not match the language authority pin');
}
if (sha256(LANGUAGE_SOURCE) !== GODOT_4_7_LANGUAGE_INPUT_SHA256) {
  throw new Error('language authority input changed');
}
if (implementationDigest() !== GODOT_4_7_LANGUAGE_IMPLEMENTATION_SHA256) {
  throw new Error('language authority lowering implementation changed; regenerate its evidence');
}

const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-language-authority-'));
try {
  writeFileSync(path.join(temp, 'project.godot'), PROJECT_SOURCE);
  writeFileSync(path.join(temp, 'main.tscn'), MAIN_SCENE);
  writeFileSync(path.join(temp, 'language_semantics.gd'), LANGUAGE_SOURCE);
  const snapshot = captureGodotProjectSnapshot(temp);
  const sourceAuthority = godotSourceAuthority(4);
  const readAuthority = godotReadAuthority(sourceAuthority);
  const boundProject = bindGodotProject(
    snapshot,
    captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
    bindGodotResources(readGodotProjectSnapshot(snapshot, readAuthority), readAuthority),
    godotAnalysisAuthority(sourceAuthority),
    sourceAuthority,
    captureGodotApiDumpSnapshot(sourceAuthority),
    readGodotProjectSnapshot(snapshot, readAuthority),
  );
  const result = lowerOfficialBoundProgram(
    boundProject,
    godotCodeTranslationAuthority(sourceAuthority),
  );
  if (
    result.kind !== 'accepted-code' ||
    result.plan.sourceFiles.length !== 1 ||
    result.plan.scriptModules.length !== 1
  ) {
    throw new Error(
      result.kind === 'refused-code'
        ? result.diagnostics
            .map((entry) => `${entry.sourcePath}:${entry.startLine} ${entry.message}`)
            .join('\n')
        : 'language lowering emitted the wrong source-file count',
    );
  }
  const module = result.plan.scriptModules[0];
  if (
    module?.resPath !== 'res://language_semantics.gd' ||
    module.sourcePath !== 'language_semantics.ts' ||
    module.className !== 'LanguageSemantics' ||
    module.engineBase !== 'RefCounted' ||
    module.attachments.length !== 0 ||
    module.autoloads.length !== 0 ||
    module.lifecycle.length !== 0
  ) {
    throw new Error(`language script module differs: ${JSON.stringify(module)}`);
  }
  const printed = printTargetTsSourceFile(result.plan.sourceFiles[0]);
  const nativeJson = JSON.stringify(canonical(nativeValue(officialBinary, temp)));
  const targetJson = JSON.stringify(canonical(targetValue(printed)));
  const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: true });
  if (nativeJson !== targetJson)
    throw new Error(`language mismatch: ${nativeJson} != ${targetJson}`);
  if (
    sha256(nativeJson) !== GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256 ||
    sha256(targetJson) !== GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256 ||
    sha256(comparison) !== GODOT_4_7_LANGUAGE_COMPARISON_SHA256
  ) {
    throw new Error('language authority observation digest changed');
  }
  process.stdout.write(
    `${JSON.stringify({ verdict: 'exact-match', native: JSON.parse(nativeJson), target: JSON.parse(targetJson), languageRules: result.plan.languageEvidenceClaimIds.length })}\n`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
