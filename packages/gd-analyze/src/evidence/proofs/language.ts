/** The language-semantics authority's proof: official Godot versus the lowered class. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
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
  GODOT_CODE_IMPLEMENTATION_FILES,
  godotCodeTranslationAuthority,
} from '../../translate/code/authority-data';
import { lowerOfficialBoundProgram } from '../../translate/code/lower-official-bound';
import { printTargetTsSourceFile } from '../../translate/emit/target-ts-printer';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

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

export function measureLanguageProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = sha256(LANGUAGE_SOURCE);
  const actualImplementation = packageImplementationDigest(GODOT_CODE_IMPLEMENTATION_FILES);
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
    const printed = printTargetTsSourceFile(
      result.plan.sourceFiles[0] as (typeof result.plan.sourceFiles)[number],
    );
    const nativeJson = JSON.stringify(canonical(nativeValue(officialBinary, temp)));
    const targetJson = JSON.stringify(canonical(targetValue(printed)));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: true });
    if (nativeJson !== targetJson)
      throw new Error(`language mismatch: ${nativeJson} != ${targetJson}`);
    return [
      {
        name: 'language',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree: true,
        detail: comparison,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
