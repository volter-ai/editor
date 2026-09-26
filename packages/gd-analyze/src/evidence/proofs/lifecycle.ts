/**
 * The lifecycle and project-startup authorities' proof: official Godot's notification order and
 * autoload startup versus the generated composition, plus the direct translation plan it emits.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { createElement, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import { mountGodotScriptTree } from '../../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import {
  GodotProjectStartup,
  useGodotScriptTreeAttachment,
} from '../../../capabilities/catalog/project-source/src/lib/godot-compat/react-lifecycle';
import { bindGodotProject } from '../../analyze/bound-project';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import {
  promoteGodotTranslation,
  restoreGodotTranslationArtifacts,
  writeGodotTranslationArtifacts,
} from '../../materialize';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import type { GodotEmittedSourceTranslationArtifact } from '../../translate/artifacts/types';
import { emitGodotTranslation, type GodotOutputArtifact } from '../../translate/emit';
import { planGodotTranslation } from '../../translate/plan';
import {
  GODOT_LIFECYCLE_IMPLEMENTATION_FILES,
  GODOT_PROJECT_STARTUP_IMPLEMENTATION_FILES,
} from '../../translate/data/lifecycle-authority-data';
import { type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

function isPrimarySourceTranslation(
  artifact: GodotOutputArtifact,
): artifact is GodotEmittedSourceTranslationArtifact {
  return artifact.kind === 'source-translation' && artifact.role === 'primary';
}

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Direct composition proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[autoload]
Globals="*res://globals.gd"
Settings="*res://settings.gd"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'component.gd': `class_name Component
extends Node3D

@export var ratio: float = 0.0

func _enter_tree():
	var value: int = 1

func _ready():
	var value: int = 1

func _exit_tree():
	var value: int = 1
`,
  'globals.gd': `class_name GlobalsState
extends Node

var enabled: bool = true

func _enter_tree():
	var value: int = 1

func _ready():
	var value: int = 1

func _exit_tree():
	var value: int = 1
`,
  'settings.gd': `class_name SettingsState
extends Node

var volume: float = 1.0

func _enter_tree():
	var value: int = 1

func _ready():
	var value: int = 1

func _exit_tree():
	var value: int = 1
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://component.gd" id="1_component"]

[node name="Main" type="Node3D"]
position = Vector3(1, 2, 3)
script = ExtResource("1_component")
ratio = 2.5
`,
};

const nativeStartupFiles: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Native startup evidence"
run/main_scene="res://main.tscn"

[autoload]
First="*res://first.gd"
Second="*res://second.gd"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'first.gd': `extends Node

func _init() -> void:
	print("startup:first:init")
func _enter_tree() -> void:
	print("startup:first:enter:second=" + str(Second != null))
func _ready() -> void:
	print("startup:first:ready:second=" + str(Second != null))
func _exit_tree() -> void:
	print("startup:first:exit")
`,
  'second.gd': `extends Node

func _init() -> void:
	print("startup:second:init")
func _enter_tree() -> void:
	print("startup:second:enter:first=" + str(First != null))
func _ready() -> void:
	print("startup:second:ready:first=" + str(First != null))
func _exit_tree() -> void:
	print("startup:second:exit")
`,
  'main.gd': `extends Node

func _init() -> void:
	print("startup:main:init")
func _enter_tree() -> void:
	print("startup:main:enter:both=" + str(First != null and Second != null))
func _ready() -> void:
	print("startup:main:ready:both=" + str(First != null and Second != null))
	get_tree().quit()
func _exit_tree() -> void:
	print("startup:main:exit")
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]

[node name="Main" type="Node"]
script = ExtResource("1_main")
`,
};

const nativeProbe = `extends SceneTree

class LifecycleProbe:
	extends Node
	var label: String
	func _init(value: String) -> void:
		label = value
	func _enter_tree() -> void:
		print("lifecycle:" + label + ":enter")
	func _ready() -> void:
		print("lifecycle:" + label + ":ready")
	func _exit_tree() -> void:
		print("lifecycle:" + label + ":exit")

func _initialize() -> void:
	call_deferred("run_probe")

func run_probe() -> void:
	var root = load("res://main.tscn").instantiate()
	print(JSON.stringify({"script": root.get_script().resource_path, "ratio": root.ratio}))
	root.free()
	var lifecycle_root = LifecycleProbe.new("root")
	lifecycle_root.add_child(LifecycleProbe.new("first"))
	lifecycle_root.add_child(LifecycleProbe.new("second"))
	get_root().add_child(lifecycle_root)
	lifecycle_root.free()
	quit()
`;



function sourceSetDigest(sources: Readonly<Record<string, string>>): string {
  return sha256(
    Object.entries(sources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${source}`)
      .join('\n'),
  );
}

export function measureLifecycleProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-direct-composition-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
    const snapshot = captureGodotProjectSnapshot(temp);
    const toolchain = captureGodotImportToolchainSnapshot({
      projectEngine: snapshot.engine,
      boundExporterBinary: exporterBinary,
      officialBinary,
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
    const translation = planGodotTranslation(project, toolchain);
    if (translation.kind !== 'accepted-translation') {
      throw new Error(
        translation.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'),
      );
    }
    const composition = translation.plan.composition;
    const expected = {
      mainScene: 'res://main.tscn',
      instance: {
        scriptResPath: 'res://component.gd',
        documentPath: 'res://main.tscn',
        nodePath: '.',
        nodeClass: 'Node3D',
        generatedClass: {
          modulePath: 'src/scripts/component.ts',
          exportName: 'Component',
          engineBase: 'Node3D',
          nativeCarrier: true,
        },
        fields: [
          {
            fieldName: 'ratio',
            application: 'script-property-set',
            value: { kind: 'number', value: 2.5 },
            evidenceClaimId: 'godot-4.7-field-value-float',
          },
        ],
        lifecycle: composition.scenes[0]?.root.scriptInstance?.lifecycle,
        autoloadReferences: [],
      },
      autoloads: [
        {
          name: 'Globals',
          singleton: true,
          scriptResPath: 'res://globals.gd',
          generatedClass: {
            modulePath: 'src/scripts/globals.ts',
            exportName: 'GlobalsState',
            engineBase: 'Node',
            nativeCarrier: true,
          },
          lifecycle: composition.scriptAutoloads[0]?.lifecycle,
          autoloadReferences: [],
        },
        {
          name: 'Settings',
          singleton: true,
          scriptResPath: 'res://settings.gd',
          generatedClass: {
            modulePath: 'src/scripts/settings.ts',
            exportName: 'SettingsState',
            engineBase: 'Node',
            nativeCarrier: true,
          },
          lifecycle: composition.scriptAutoloads[1]?.lifecycle,
          autoloadReferences: [],
        },
      ],
    };
    const observed = {
      mainScene: composition.mainScene,
      instance: composition.scenes[0]?.root.scriptInstance,
      autoloads: composition.scriptAutoloads,
    };
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      throw new Error(`direct composition differs: ${JSON.stringify(observed)}`);
    }
    if (
      composition.scenes[0]?.root.name !== 'Main' ||
      composition.scenes[0]?.root.scriptInstance?.scriptResPath !== 'res://component.gd' ||
      JSON.stringify(
        composition.scenes[0]?.root.scriptInstance?.lifecycle.map((entry) => entry.phase),
      ) !== JSON.stringify(['enter-tree', 'ready', 'exit-tree']) ||
      !composition.evidence.sceneClaimIds.includes('godot-4.7-scene-node-node3d-group') ||
      JSON.stringify(composition.evidence.analysisClaimIds) !==
        JSON.stringify([
          'godot-4.7-analysis-field-attachment-join',
          'godot-4.7-analysis-lifecycle-selection',
          'godot-4.7-analysis-native-ancestry',
          'godot-4.7-analysis-scene-class-resolution',
          'godot-4.7-analysis-script-inheritance',
        ]) ||
      JSON.stringify(composition.evidence.codeAnalysisClaimIds) !== JSON.stringify([])
    ) {
      throw new Error('direct composition did not retain the accepted scene plan and evidence');
    }
    if (
      JSON.stringify(translation.plan.sceneModules.evidenceClaimIds) !==
      JSON.stringify(['godot-4.7-native-hierarchy-lifecycle'])
    ) {
      throw new Error('direct scene syntax did not retain its live lifecycle evidence');
    }
    if (
      JSON.stringify(translation.plan.projectData.evidence.projectStartupClaimIds) !==
      JSON.stringify(['godot-4.7-project-autoload-startup', 'godot-4.7-project-main-loop'])
    ) {
      throw new Error('direct project startup did not retain its live autoload evidence');
    }
    const emitted = emitGodotTranslation(translation);
    const artifacts = emitted.artifacts;
    for (const planned of translation.plan.artifacts) {
      if (!('sourceMapPath' in planned)) continue;
      const primary = artifacts.find((artifact) => artifact.path === planned.path);
      const sourceMap = artifacts.find((artifact) => artifact.path === planned.sourceMapPath);
      const expectedSources =
        'sourcePath' in planned.origin
          ? [planned.origin.sourcePath]
          : [...new Set(planned.origin.sourcePaths)].sort();
      const decodedMap = JSON.parse(Buffer.from(sourceMap?.bytes ?? []).toString('utf8')) as {
        readonly sources?: unknown;
        readonly mappings?: unknown;
      };
      if (
        primary?.role !== 'primary' ||
        sourceMap?.role !== 'source-map' ||
        primary.planIdentity !== planned.planIdentity ||
        sourceMap.planIdentity !== planned.planIdentity ||
        JSON.stringify(decodedMap.sources) !== JSON.stringify(expectedSources) ||
        typeof decodedMap.mappings !== 'string' ||
        decodedMap.mappings.length === 0 ||
        Buffer.from(primary.bytes)
          .toString('utf8')
          .includes(`//# sourceMappingURL=${path.posix.basename(planned.sourceMapPath)}`) === false
      ) {
        throw new Error(`${planned.path}: emitted source-map closure differs`);
      }
    }
    const codeArtifacts = artifacts.filter(
      (artifact): artifact is GodotEmittedSourceTranslationArtifact =>
        isPrimarySourceTranslation(artifact) && artifact.path.startsWith('src/scripts/'),
    );
    const componentArtifact = codeArtifacts.find(
      (artifact) => artifact.path === 'src/scripts/component.ts',
    );
    if (
      codeArtifacts.length !== 3 ||
      componentArtifact?.path !== 'src/scripts/component.ts' ||
      componentArtifact.origin.sourcePath !== 'res://component.gd' ||
      componentArtifact.origin.sourceDigest !== project.scripts[0]?.sourceDigest ||
      Buffer.from(componentArtifact.bytes).toString('utf8').includes('export class Component') ===
        false
    ) {
      throw new Error(`direct code artifacts differ: ${JSON.stringify(codeArtifacts)}`);
    }
    const componentSource = Buffer.from(componentArtifact.bytes).toString('utf8');
    const transpiledComponent = ts.transpileModule(componentSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const componentModule = { exports: {} as Record<string, unknown> };
    Function('exports', 'module', transpiledComponent)(componentModule.exports, componentModule);
    const Component = componentModule.exports['Component'] as new (
      native: object,
    ) => {
      readonly $native: object;
      ratio: number;
    };
    const nativeCarrier = {};
    const component = new Component(nativeCarrier);
    component.ratio = 2.5;
    if (component.$native !== nativeCarrier || component.ratio !== 2.5) {
      throw new Error('generated script did not retain its exact native carrier and authored field');
    }
    const sceneArtifact = artifacts.find(
      (artifact): artifact is GodotEmittedSourceTranslationArtifact =>
        isPrimarySourceTranslation(artifact) && artifact.path === 'src/scenes/main.tsx',
    );
    if (sceneArtifact === undefined) throw new Error('accepted plan emitted no main scene');
    const sceneSource = Buffer.from(sceneArtifact?.bytes ?? []).toString('utf8');
    if (
      sceneArtifact?.path !== 'src/scenes/main.tsx' ||
      sceneSource.includes('new $Script_0($native_0)') === false ||
      sceneSource.includes('$instance_0.ratio = 2.5') === false ||
      sceneSource.includes('useGodotScriptTreeAttachment($node_0') === false ||
      sceneSource.includes('"enterTree": () => $instance_0._enter_tree()') === false ||
      sceneSource.includes('"ready": () => $instance_0._ready()') === false ||
      sceneSource.includes('"exitTree": () => $instance_0._exit_tree()') === false ||
      sceneSource.includes('<group name="Main" ref={$node_0}') === false
    ) {
      throw new Error(`scripted scene artifact differs:\n${sceneSource}`);
    }
    const projectArtifacts = artifacts.filter(
      (artifact) => artifact.kind === 'project-data' && artifact.role === 'primary',
    );
    const byPath = new Map(projectArtifacts.map((artifact) => [artifact.path, artifact]));
    const worldSource = Buffer.from(byPath.get('src/world.tsx')?.bytes ?? []).toString('utf8');
    const mainSource = Buffer.from(byPath.get('src/main.ts')?.bytes ?? []).toString('utf8');
    const manifest = JSON.parse(
      Buffer.from(byPath.get('vgai.project.json')?.bytes ?? []).toString('utf8'),
    ) as { readonly name?: unknown; readonly resolution?: unknown; readonly roots?: unknown };
    const capabilityStampPlans = translation.plan.projectData.capabilityStamps;
    const capabilityStampsClosed = capabilityStampPlans.every((stamp) => {
      const artifact = byPath.get(stamp.targetPath);
      if (
        artifact?.origin.kind !== 'project-data' ||
        JSON.stringify(artifact.origin.toolchainSources) !==
          JSON.stringify([stamp.toolchainSource]) ||
        stamp.toolchainSource.path !== `catalog/entries/${stamp.value.id}.json`
      ) {
        return false;
      }
      return (
        Buffer.from(artifact.bytes).toString('utf8') === `${JSON.stringify(stamp.value, null, 2)}\n`
      );
    });
    if (
      byPath.size !== projectArtifacts.length ||
      JSON.stringify([...byPath.keys()].sort()) !==
        JSON.stringify(
          [
            'index.html',
            'package-lock.json',
            'package.json',
            'public/.gitkeep',
            ...capabilityStampPlans.map((stamp) => stamp.targetPath),
            'src/main.ts',
            'src/project/input-map.json',
            'src/project/settings.json',
            'src/world.tsx',
            'tsconfig.json',
            'vgai.adapter.ts',
            'vgai.project.json',
            'vite.config.ts',
          ].sort(),
        ) ||
      mainSource.includes('import World from "./world";') === false ||
      mainSource.includes('"src/world.tsx": {') === false ||
      mainSource.includes('"default": World') === false ||
      /react-root|net-config|server\/rooms|virtual:vgai-manifest-entries/u.test(mainSource) ||
      worldSource.includes('import { MainScene } from "./scenes/main";') === false ||
      worldSource.includes(
        'import { GodotProjectStartup, useGodotScriptTreeAttachment } from "./lib/godot-compat/react-lifecycle";',
      ) === false ||
      worldSource.includes('function $Autoload_0(props:') === false ||
      worldSource.includes('new $AutoloadScript_0($native_autoload_0)') === false ||
      worldSource.includes('function $Autoload_1(props:') === false ||
      worldSource.includes('new $AutoloadScript_1($native_autoload_1)') === false ||
      worldSource.includes('<GodotProjectStartup>') === false ||
      worldSource.indexOf('<$Autoload_0 instanceRef={$autoloadInstance_0}/>') >
        worldSource.indexOf('<$Autoload_1 instanceRef={$autoloadInstance_1}/>') ||
      worldSource.indexOf('<$Autoload_1 instanceRef={$autoloadInstance_1}/>') >
        worldSource.indexOf('<MainScene name="Main"') ||
      worldSource.includes('export default function World()') === false ||
      worldSource.includes('<MainScene name="Main"') === false ||
      worldSource.includes('position={[1, 2, 3]}') === false ||
      manifest.name !== 'Direct composition proof' ||
      JSON.stringify(manifest.resolution) !== JSON.stringify({ width: 960, height: 540 }) ||
      JSON.stringify(manifest.roots) !==
        JSON.stringify([{ id: 'world', adapter: 'three', entry: 'src/world.tsx' }]) ||
      capabilityStampPlans.length === 0 ||
      !capabilityStampsClosed ||
      translation.plan.projectData.requirements.packages.length === 0 ||
      translation.plan.projectData.requirements.capabilities.some(
        (entry) => entry.artifacts.length === 0,
      )
    ) {
      throw new Error(
        `direct project artifacts differ: ${JSON.stringify({ paths: [...byPath.keys()].sort(), worldSource, manifest, capabilityStampPlans, capabilityStampsClosed, requirements: translation.plan.projectData.requirements })}`,
      );
    }
    for (const requiredPath of [
      'src/main.ts',
      'vgai.adapter.ts',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'public/.gitkeep',
    ]) {
      if (!byPath.has(requiredPath)) throw new Error(`direct project shell omitted ${requiredPath}`);
    }
    const staging = path.join(temp, 'translation-staging');
    const promoted = path.join(temp, 'translation-output');
    mkdirSync(staging);
    writeGodotTranslationArtifacts(emitted, staging);
    // What acceptance leaves in the candidate: its install and its build.
    mkdirSync(path.join(staging, 'node_modules', 'three'), { recursive: true });
    mkdirSync(path.join(staging, 'dist', 'assets'), { recursive: true });
    writeFileSync(path.join(staging, 'node_modules', 'three', 'package.json'), '{}\n');
    writeFileSync(path.join(staging, 'dist', 'assets', 'index.js'), 'derived\n');
    writeFileSync(path.join(staging, 'dist', 'index.html'), 'derived\n');
    restoreGodotTranslationArtifacts(artifacts, staging);
    if (existsSync(path.join(staging, 'node_modules')) || existsSync(path.join(staging, 'dist'))) {
      throw new Error('acceptance-derived state survived exact artifact restoration');
    }
    promoteGodotTranslation(staging, promoted);
    if (readFileSync(path.join(promoted, 'src/world.tsx'), 'utf8') !== worldSource) {
      throw new Error('atomic materialization changed the emitted world artifact');
    }
    const staleAuthority = planGodotTranslation(project, {
      ...toolchain,
      frontend: {
        ...toolchain.frontend,
        sceneNodeAuthorityDigest: '0'.repeat(64),
      },
    });
    if (
      staleAuthority.kind !== 'refused-translation' ||
      staleAuthority.diagnostics.some(
        (entry) => entry.message === 'scene-node translation authority changed after capture',
      ) === false
    ) {
      throw new Error('direct planning accepted a stale scene-node authority');
    }
    const staleLifecycleAuthority = planGodotTranslation(project, {
      ...toolchain,
      frontend: {
        ...toolchain.frontend,
        lifecycleAuthorityDigest: '0'.repeat(64),
      },
    });
    if (
      staleLifecycleAuthority.kind !== 'refused-translation' ||
      staleLifecycleAuthority.diagnostics.some(
        (entry) => entry.message === 'lifecycle translation authority changed after capture',
      ) === false
    ) {
      throw new Error('direct planning accepted a stale lifecycle authority');
    }
    writeFileSync(path.join(temp, 'native_probe.gd'), nativeProbe);
    const native = spawnSync(
      officialBinary,
      ['--headless', '--path', temp, '--script', 'res://native_probe.gd'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (native.error !== undefined || native.status !== 0) {
      throw new Error(`native composition probe failed: ${native.error?.message ?? native.stderr}`);
    }
    const nativeLine = native.stdout.split('\n').find((line) => line.startsWith('{'));
    if (nativeLine === undefined)
      throw new Error(`native composition probe had no value: ${native.stdout}`);
    const nativeValue = JSON.parse(nativeLine) as unknown;
    const expectedNative = { ratio: 2.5, script: 'res://component.gd' };
    if (JSON.stringify(nativeValue) !== JSON.stringify(expectedNative)) {
      throw new Error(`native composition observation differs: ${JSON.stringify(nativeValue)}`);
    }
    const nativeLifecycle = native.stdout.split('\n').filter((line) => line.startsWith('lifecycle:'));
    const targetLifecycle: string[] = [];
    const first = { name: 'First', children: [] as object[] };
    const second = { name: 'Second', children: [] as object[] };
    // Every Godot node has a name; a nameless object is a container, not a node.
    const lifecycleRoot = { name: 'Root', children: [first, second] as object[] };
    const lifecycleBinding = (nativeNode: object, label: string) => ({
      native: nativeNode,
      owner: {},
      enterTree: () => targetLifecycle.push(`lifecycle:${label}:enter`),
      ready: () => targetLifecycle.push(`lifecycle:${label}:ready`),
      exitTree: () => targetLifecycle.push(`lifecycle:${label}:exit`),
    });
    const releaseLifecycle = mountGodotScriptTree(lifecycleRoot, [
      lifecycleBinding(lifecycleRoot, 'root'),
      lifecycleBinding(first, 'first'),
      lifecycleBinding(second, 'second'),
    ]);
    releaseLifecycle();
    if (JSON.stringify(targetLifecycle) !== JSON.stringify(nativeLifecycle)) {
      throw new Error(
        `lifecycle order differs: ${JSON.stringify({ native: nativeLifecycle, target: targetLifecycle, stdout: native.stdout })}`,
      );
    }
    const lifecycleComparison = JSON.stringify({
      native: nativeLifecycle,
      target: targetLifecycle,
      equal: true,
    });
    const lifecycleEvidence = {
      input: sha256(nativeProbe),
      implementation: monorepoImplementationDigest(GODOT_LIFECYCLE_IMPLEMENTATION_FILES),
      observed: sha256(JSON.stringify(nativeLifecycle)),
      comparison: sha256(lifecycleComparison),
    };
    const nativeStartupDir = path.join(temp, 'native-startup');
    mkdirSync(nativeStartupDir);
    for (const [relative, source] of Object.entries(nativeStartupFiles)) {
      writeFileSync(path.join(nativeStartupDir, relative), source);
    }
    const nativeStartupProcess = spawnSync(
      officialBinary,
      ['--headless', '--path', nativeStartupDir, '--quit-after', '10'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (nativeStartupProcess.error !== undefined || nativeStartupProcess.status !== 0) {
      throw new Error(
        `native project-startup probe failed: ${nativeStartupProcess.error?.message ?? nativeStartupProcess.stderr}`,
      );
    }
    const nativeStartup = nativeStartupProcess.stdout
      .split('\n')
      .filter((line) => line.startsWith('startup:'));
    const targetStartup: string[] = [];
    const firstRoot = { name: 'First', children: [] as object[] };
    const secondRoot = { name: 'Second', children: [] as object[] };
    const mainRoot = { name: 'Main', children: [] as object[] };
    const StartupAttachment = ({
      nativeNode,
      label,
    }: {
      readonly nativeNode: object;
      readonly label: 'first' | 'second' | 'main';
    }) => {
      const nativeRef = useRef<object | null>(nativeNode);
      useGodotScriptTreeAttachment(nativeRef, () => {
        targetStartup.push(`startup:${label}:init`);
        return {
          bindings: [
            {
              native: nativeNode,
              owner: {},
              enterTree: () =>
                targetStartup.push(
                  label === 'main'
                    ? 'startup:main:enter:both=true'
                    : `startup:${label}:enter:${label === 'first' ? 'second' : 'first'}=true`,
                ),
              ready: () =>
                targetStartup.push(
                  label === 'main'
                    ? 'startup:main:ready:both=true'
                    : `startup:${label}:ready:${label === 'first' ? 'second' : 'first'}=true`,
                ),
              exitTree: () => targetStartup.push(`startup:${label}:exit`),
            },
          ],
          release: () => undefined,
        };
      });
      return null;
    };
    const startupDom = new JSDOM('<!doctype html><div id="root"></div>');
    Object.assign(globalThis, {
      window: startupDom.window,
      document: startupDom.window.document,
    });
    try {
      const startupContainer = startupDom.window.document.getElementById('root');
      if (startupContainer === null) throw new Error('React startup proof has no container');
      const startupRoot = createRoot(startupContainer);
      flushSync(() => {
        startupRoot.render(
          createElement(
            GodotProjectStartup,
            {
              prepare: () => {
                if (
                  JSON.stringify(targetStartup) !==
                  JSON.stringify(['startup:first:init', 'startup:second:init', 'startup:main:init'])
                ) {
                  throw new Error('project startup prepared before every script instance existed');
                }
              },
            },
            createElement(StartupAttachment, { nativeNode: firstRoot, label: 'first' }),
            createElement(StartupAttachment, { nativeNode: secondRoot, label: 'second' }),
            createElement(StartupAttachment, { nativeNode: mainRoot, label: 'main' }),
          ),
        );
      });
      flushSync(() => startupRoot.unmount());
    } finally {
      startupDom.window.close();
    }
    if (JSON.stringify(targetStartup) !== JSON.stringify(nativeStartup)) {
      throw new Error(
        `project startup order differs: ${JSON.stringify({ native: nativeStartup, target: targetStartup, stdout: nativeStartupProcess.stdout })}`,
      );
    }
    const startupComparison = JSON.stringify({
      native: nativeStartup,
      target: targetStartup,
      equal: true,
    });
    const startupEvidence = {
      input: sourceSetDigest(nativeStartupFiles),
      implementation: monorepoImplementationDigest(GODOT_PROJECT_STARTUP_IMPLEMENTATION_FILES),
      observed: sha256(JSON.stringify(nativeStartup)),
      comparison: sha256(startupComparison),
    };
    return [
      {
        name: 'lifecycle',
        identities: lifecycleEvidence,
        agree: true,
        detail: lifecycleComparison,
      },
      {
        name: 'project-startup',
        identities: startupEvidence,
        agree: true,
        detail: startupComparison,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
