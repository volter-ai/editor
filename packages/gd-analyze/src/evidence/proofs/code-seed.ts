/** The code-lowering seed's proof: official Godot's `Answer.answer()` versus the lowered class. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

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

export function measureCodeSeedProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = sha256(ANSWER_SOURCE);
  const actualImplementation = packageImplementationDigest(GODOT_CODE_IMPLEMENTATION_FILES);
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
    return [
      {
        name: 'code-seed',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: sha256(nativeJson),
          comparison: sha256(JSON.stringify({ native: nativeJson, target: targetJson, equal: true })),
        },
        agree: true,
        detail: nativeJson,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
