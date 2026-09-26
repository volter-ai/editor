/** The autoload-reference authority's proof: official Godot's autoload singletons versus the emitted project. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID } from '../../analyze/bound-autoload-references';
import { bindGodotProject } from '../../analyze/bound-project';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import { emitGodotTranslation } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import { GODOT_AUTOLOAD_REFERENCE_IMPLEMENTATION_FILES } from '../../translate/code/authority-data';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const FILES: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Autoload reference proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[autoload]
Settings="*res://settings.gd"
Globals="*res://globals.gd"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'settings.gd': `class_name SettingsState
extends Node
`,
  'globals.gd': `class_name GlobalsState
extends Node

func settings_singleton():
	return Settings
`,
  'consumer_base.gd': `class_name ConsumerBase
extends Node3D

func globals_singleton():
	return Globals
`,
  'consumer.gd': `class_name Consumer
extends "res://consumer_base.gd"
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://consumer.gd" id="1_consumer"]

[node name="Main" type="Node3D"]
script = ExtResource("1_consumer")
`,
};

const NATIVE_PROBE = `extends Node

func _ready() -> void:
	var settings = get_node("/root/Settings")
	var globals = get_node("/root/Globals")
	var consumer = load("res://consumer.gd").new()
	print(JSON.stringify({"consumer_identity": consumer.globals_singleton() == globals, "globals_identity": globals.settings_singleton() == settings, "global_globals_identity": Globals == globals, "global_settings_identity": Settings == settings}))
	get_tree().quit()
`;

const NATIVE_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://native_probe.gd" id="1_probe"]

[node name="NativeProbe" type="Node"]
script = ExtResource("1_probe")
`;

function sourceSetDigest(): string {
  return sha256(
    Object.entries(FILES)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${source}`)
      .join('\n'),
  );
}

function nativeValue(officialBinary: string, project: string): unknown {
  const probe = path.join(project, 'native_probe.gd');
  const scene = path.join(project, 'native_probe.tscn');
  writeFileSync(probe, NATIVE_PROBE);
  writeFileSync(scene, NATIVE_SCENE);
  const result = spawnSync(
    officialBinary,
    ['--headless', '--path', project, 'res://native_probe.tscn'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  rmSync(probe);
  rmSync(scene);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`native autoload probe failed: ${result.error?.message ?? result.stderr}`);
  }
  const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('{'));
  if (line === undefined) {
    throw new Error(`native autoload probe returned no value: ${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(line) as unknown;
}

function loadModule(
  source: string,
  resolve: (specifier: string) => unknown = (specifier) => {
    throw new Error(`unexpected generated import ${specifier}`);
  },
): Record<string, unknown> {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  Function('exports', 'module', 'require', transpiled)(module.exports, module, resolve);
  return module.exports;
}

function loadClass(
  source: string,
  name: string,
  resolve?: (specifier: string) => unknown,
): new (
  native: object,
) => Record<string, unknown> {
  const result = loadModule(source, resolve)[name];
  if (typeof result !== 'function') throw new Error(`${name}: generated class is absent`);
  return result as new (
    native: object,
  ) => Record<string, unknown>;
}

export function measureAutoloadReferenceProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-autoload-reference-'));
  try {
    for (const [relative, source] of Object.entries(FILES)) {
      writeFileSync(path.join(temp, relative), source);
    }
    const snapshot = captureGodotProjectSnapshot(temp);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
    });
    const project = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
      bindGodotResources(
        readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
        toolchain.frontend.readAuthority,
      ),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority),
    );
    const result = planGodotTranslation(project, toolchain);
    if (result.kind !== 'accepted-translation') {
      throw new Error(result.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
    }
    const artifacts = emitGodotTranslation(result).artifacts;
    const source = (targetPath: string): string => {
      const artifact = artifacts.find((candidate) => candidate.path === targetPath);
      if (artifact === undefined) throw new Error(`${targetPath}: artifact is absent`);
      return Buffer.from(artifact.bytes).toString('utf8');
    };
    const settingsSource = source('src/scripts/settings.ts');
    const globalsSource = source('src/scripts/globals.ts');
    const consumerSource = source('src/scripts/consumer.ts');
    const consumerBaseSource = source('src/scripts/consumer_base.ts');
    const sceneSource = source('src/scenes/main.tsx');
    const worldSource = source('src/world.tsx');
    const Settings = loadClass(settingsSource, 'SettingsState');
    const Globals = loadClass(globalsSource, 'GlobalsState');
    const ConsumerBase = loadClass(consumerBaseSource, 'ConsumerBase');
    const Consumer = loadClass(consumerSource, 'Consumer', (specifier) => {
      if (specifier === './consumer_base') return { ConsumerBase };
      throw new Error(`unexpected Consumer import ${specifier}`);
    });
    const settings = new Settings({});
    const globals = new Globals({});
    const autoloadRefs = [{ current: settings }, { current: globals }];
    let autoloadRefIndex = 0;
    const jsx = (type: unknown, props: Readonly<Record<string, unknown>>) => ({ type, props });
    const world = loadModule(worldSource, (specifier) => {
      if (specifier === 'react') return { useRef: () => autoloadRefs[autoloadRefIndex++] };
      if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (specifier === './scripts/settings') return { SettingsState: Settings };
      if (specifier === './scripts/globals') return { GlobalsState: Globals };
      if (specifier === './scenes/main') {
        return { MainScene: () => null, MainSceneAutoloads: () => null };
      }
      if (specifier === './lib/godot-compat/react-lifecycle') {
        return { GodotProjectStartup: () => null, useGodotScriptTreeAttachment: () => undefined };
      }
      throw new Error(`unexpected World import ${specifier}`);
    });
    const World = world['default'];
    if (typeof World !== 'function') throw new Error('generated World is absent');
    const worldElement = World() as { readonly props?: { readonly prepare?: unknown } };
    const prepare = worldElement.props?.prepare;
    if (typeof prepare !== 'function') throw new Error('generated World prepare callback is absent');
    prepare();
    let attachedOwner: Record<string, unknown> | undefined;
    const sceneRefs = [{ current: { children: [] } }, { current: null }];
    let sceneRefIndex = 0;
    const sceneModule = loadModule(sceneSource, (specifier) => {
      if (specifier === 'react') {
        return {
          createContext: () => ({}),
          useContext: () => ({ Globals: { current: globals } }),
          useRef: () => sceneRefs[sceneRefIndex++],
        };
      }
      if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (specifier.includes('/godot-compat')) {
        return {
          useGodotScriptTreeAttachment: (
            _root: unknown,
            attach: () => {
              readonly bindings: readonly { readonly owner: Record<string, unknown> }[];
            },
          ) => {
            attachedOwner = attach().bindings[0]?.owner;
          },
        };
      }
      if (specifier.endsWith('/scripts/consumer')) return { Consumer };
      throw new Error(`unexpected MainScene import ${specifier}`);
    });
    const MainScene = sceneModule['MainScene'];
    if (typeof MainScene !== 'function') throw new Error('generated MainScene is absent');
    MainScene({});
    const consumer = attachedOwner;
    if (consumer === undefined) throw new Error('generated MainScene attached no Consumer instance');
    const settingsSingleton = globals['settings_singleton'];
    if (typeof settingsSingleton !== 'function') {
      throw new Error('GlobalsState.settings_singleton() is absent');
    }
    const globalsSingleton = consumer['globals_singleton'];
    if (typeof globalsSingleton !== 'function') {
      throw new Error('Consumer.globals_singleton() is absent');
    }
    const target = {
      consumer_identity: globalsSingleton.call(consumer) === globals,
      globals_identity: settingsSingleton.call(globals) === settings,
      global_globals_identity: consumer['$autoload_Globals'] === globals,
      global_settings_identity: globals['$autoload_Settings'] === settings,
    };
    const nativeJson = JSON.stringify(canonical(nativeValue(officialBinary, temp)));
    const targetJson = JSON.stringify(canonical(target));
    if (nativeJson !== targetJson)
      throw new Error(`autoload mismatch: ${nativeJson} != ${targetJson}`);
    const globalsPlan = result.plan.composition.scriptAutoloads.find(
      (autoload) => autoload.name === 'Globals',
    );
    const consumerPlan = result.plan.composition.scenes[0]?.root.scriptInstance;
    if (
      JSON.stringify(globalsPlan?.autoloadReferences) !==
        JSON.stringify([
          { name: 'Settings', resPath: 'res://settings.gd', fieldName: '$autoload_Settings' },
        ]) ||
      JSON.stringify(consumerPlan?.autoloadReferences) !==
        JSON.stringify([
          { name: 'Globals', resPath: 'res://globals.gd', fieldName: '$autoload_Globals' },
        ]) ||
      JSON.stringify(result.plan.composition.evidence.analysisClaimIds) !==
        JSON.stringify([
          'godot-4.7-analysis-field-attachment-join',
          'godot-4.7-analysis-native-ancestry',
          'godot-4.7-analysis-scene-class-resolution',
          'godot-4.7-analysis-script-inheritance',
        ]) ||
      JSON.stringify(result.plan.composition.evidence.codeAnalysisClaimIds) !==
        JSON.stringify([BOUND_GODOT_AUTOLOAD_REFERENCE_CLAIM_ID]) ||
      globalsSource.includes('import type { SettingsState as $AutoloadType_Settings }') === false ||
      globalsSource.includes('$autoload_Settings!: $AutoloadType_Settings') === false ||
      globalsSource.includes('return this.$autoload_Settings') === false ||
      consumerBaseSource.includes('import type { GlobalsState as $AutoloadType_Globals }') ===
        false ||
      consumerBaseSource.includes('$autoload_Globals!: $AutoloadType_Globals') === false ||
      consumerBaseSource.includes('return this.$autoload_Globals') === false ||
      consumerSource.includes('export class Consumer extends ConsumerBase') === false ||
      sceneSource.includes('export const MainSceneAutoloads = createContext') === false ||
      sceneSource.includes('$instance_0.$autoload_Globals = $autoload_0_Globals') === false ||
      worldSource.includes('$instance_autoload_1.$autoload_Settings') ||
      worldSource.includes(
        '$autoloadInstance_1.current.$autoload_Settings = $autoloadInstance_0.current',
      ) === false ||
      worldSource.includes('<MainSceneAutoloads value={{') === false
    ) {
      throw new Error(
        `autoload translation shape differs: ${JSON.stringify({ globalsPlan, consumerPlan, globalsSource, consumerBaseSource, consumerSource, sceneSource, worldSource })}`,
      );
    }
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: true });
    const evidence = {
      input: sourceSetDigest(),
      implementation: monorepoImplementationDigest(GODOT_AUTOLOAD_REFERENCE_IMPLEMENTATION_FILES),
      observed: sha256(nativeJson),
      comparison: sha256(comparison),
    };
    writeFileSync(
      path.join(temp, 'consumer.gd'),
      `class_name Consumer
extends "res://consumer_base.gd"

static func invalid_static_singleton():
	return Globals
`,
    );
    const refusedSnapshot = captureGodotProjectSnapshot(temp);
    const refusedProject = bindGodotProject(
      refusedSnapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
      bindGodotResources(
        readGodotProjectSnapshot(refusedSnapshot, toolchain.frontend.readAuthority),
        toolchain.frontend.readAuthority,
      ),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      readGodotProjectSnapshot(refusedSnapshot, toolchain.frontend.readAuthority),
    );
    const refused = planGodotTranslation(refusedProject, toolchain);
    if (
      refused.kind !== 'refused-translation' ||
      refused.diagnostics.some((entry) =>
        entry.message.includes('post-construction instance method'),
      ) === false
    ) {
      throw new Error('static singleton access did not refuse at its official bound identifier');
    }
    return [{ name: 'autoload-reference', identities: evidence, agree: true, detail: comparison }];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
