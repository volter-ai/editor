#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  GODOT_4_7_CODE_SEED_COMPARISON_SHA256,
  GODOT_4_7_CODE_SEED_IMPLEMENTATION_SHA256,
  GODOT_4_7_CODE_SEED_INPUT_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256,
} from '../src/translate/code/authority/godot-4.7-seed';
import { godotCodeTranslationAuthority } from '../src/translate/code/authority-data';
import { lowerOfficialBoundProgram } from '../src/translate/code/lower-official-bound';
import { printTargetTsSourceFile } from '../src/translate/emit/target-ts-printer';

const ANSWER_SOURCE = `class_name Answer
extends RefCounted

static func answer() -> int:
\treturn 42
`;
const PROJECT_SOURCE = `config_version=5

[application]
config/name="VGAI code authority seed"
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`;
const MAIN_SCENE = `[gd_scene format=3]\n\n[node name="Main" type="Node"]\n`;
const NATIVE_PROBE = `extends SceneTree

func _initialize() -> void:
\tvar answer_script = load("res://answer.gd")
\tprint(JSON.stringify({"value": answer_script.answer()}))
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
    throw new Error(`native seed probe failed: ${result.error?.message ?? result.stderr}`);
  }
  const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('{"value":'));
  if (line === undefined) throw new Error(`native seed probe returned no value: ${result.stdout}`);
  return JSON.parse(line) as unknown;
}

function targetValue(source: string): unknown {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  Function('exports', 'module', transpiled)(module.exports, module);
  const answer = module.exports['Answer'] as { answer?: () => unknown } | undefined;
  if (typeof answer?.answer !== 'function') {
    throw new Error(
      `target seed class has no answer(); exports=${Object.keys(module.exports).join(',')}\n${source}`,
    );
  }
  return { value: answer.answer() };
}

const exporterBinary = argument('--exporter-binary');
const officialBinary = argument('--official-binary');
if (sha256(readFileSync(officialBinary)) !== GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256) {
  throw new Error('official Godot executable does not match the code authority pin');
}
if (sha256(ANSWER_SOURCE) !== GODOT_4_7_CODE_SEED_INPUT_SHA256) {
  throw new Error('code authority seed input changed');
}
if (implementationDigest() !== GODOT_4_7_CODE_SEED_IMPLEMENTATION_SHA256) {
  throw new Error('code authority seed lowering implementation changed; regenerate its evidence');
}

const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-code-authority-seed-'));
try {
  mkdirSync(temp, { recursive: true });
  writeFileSync(path.join(temp, 'project.godot'), PROJECT_SOURCE);
  writeFileSync(path.join(temp, 'main.tscn'), MAIN_SCENE);
  writeFileSync(path.join(temp, 'answer.gd'), ANSWER_SOURCE);
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
        : 'seed lowering emitted the wrong source-file count',
    );
  }
  const module = result.plan.scriptModules[0];
  if (
    module?.resPath !== 'res://answer.gd' ||
    module.sourcePath !== 'answer.ts' ||
    module.className !== 'Answer' ||
    module.engineBase !== 'RefCounted' ||
    module.attachments.length !== 0 ||
    module.autoloads.length !== 0 ||
    module.lifecycle.length !== 0
  ) {
    throw new Error(`seed script module differs: ${JSON.stringify(module)}`);
  }
  const printed = printTargetTsSourceFile(
    result.plan.sourceFiles[0] as (typeof result.plan.sourceFiles)[number],
  );
  const native = nativeValue(officialBinary, temp);
  const target = targetValue(printed);
  const nativeJson = JSON.stringify(native);
  const targetJson = JSON.stringify(target);
  if (nativeJson !== targetJson) throw new Error(`seed mismatch: ${nativeJson} != ${targetJson}`);
  if (
    sha256(nativeJson) !== GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256 ||
    sha256(targetJson) !== GODOT_4_7_CODE_SEED_OBSERVED_OUTPUT_SHA256 ||
    sha256(JSON.stringify({ native: nativeJson, target: targetJson, equal: true })) !==
      GODOT_4_7_CODE_SEED_COMPARISON_SHA256
  ) {
    throw new Error(
      `code authority seed observation digest changed: observation=${sha256(nativeJson)} comparison=${sha256(JSON.stringify({ native: nativeJson, target: targetJson, equal: true }))}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ verdict: 'exact-match', native, target, sourceFiles: result.plan.sourceFiles.length, scriptModules: result.plan.scriptModules.length })}\n`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
