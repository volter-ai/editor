#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Group } from 'three';
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
  GODOT_4_7_SCENE_NODE_COMPARISON_SHA256,
  GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256,
  GODOT_4_7_SCENE_NODE_INPUT_SHA256,
  GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
} from '../src/translate/data/authority/godot-4.7-scene-nodes';
import {
  planGodotSceneDocuments,
  type TargetGodotSceneNodePlan,
} from '../src/translate/data/scene-document-plan';
import { godotSceneNodeAuthority } from '../src/translate/data/scene-node-authority-data';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Scene node proof"
run/main_scene="res://main.tscn"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'observe.gd': `extends Node3D

func observe(node: Node3D, node_path: String, rows: Array[Dictionary]) -> void:
	rows.append({
		"name": node.name,
		"path": node_path,
		"position": [node.position.x, node.position.y, node.position.z],
		"rotation": [node.rotation.x, node.rotation.y, node.rotation.z],
		"quaternion": [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
		"scale": [node.scale.x, node.scale.y, node.scale.z],
	})
	for child in node.get_children():
		observe(child, child.name if node_path == "." else node_path + "/" + child.name, rows)

func _ready() -> void:
	var rows: Array[Dictionary] = []
	observe(self, ".", rows)
	print(JSON.stringify(rows))
	get_tree().quit()
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://observe.gd" id="1_observe"]

[node name="Main" type="Node3D"]
script = ExtResource("1_observe")
position = Vector3(1.25, -2, 3)
rotation = Vector3(0.2, -0.4, 0.7)
scale = Vector3(2, 3, 4)

[node name="Child" type="Node3D" parent="."]
position = Vector3(-4, 5.5, 6)
rotation = Vector3(-0.3, 0.6, -0.8)
scale = Vector3(0.5, 1.5, 2.5)
`,
};

const IMPLEMENTATION_FILES = [
  'src/analyze/bound-project.ts',
  'src/translate/data/scene-node-authority.ts',
  'src/translate/data/scene-document-plan.ts',
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

function instantiate(node: TargetGodotSceneNodePlan): Group {
  if (node.targetKind !== 'three-group') throw new Error(`unexpected ${node.targetKind}`);
  const target = new Group();
  target.name = node.name;
  for (const property of node.properties) {
    switch (property.targetKind) {
      case 'three-position':
        target.position.fromArray(property.value);
        break;
      case 'three-rotation-yxz':
        target.rotation.set(...property.value, 'YXZ');
        break;
      case 'three-scale':
        target.scale.fromArray(property.value);
        break;
      default:
        throw new Error(`unexpected scene property ${property.targetKind}`);
    }
  }
  for (const child of node.children) target.add(instantiate(child));
  return target;
}

function observeTarget(root: Group): unknown[] {
  const rows: unknown[] = [];
  const visit = (node: Group, nodePath: string): void => {
    rows.push({
      name: node.name,
      path: nodePath,
      position: node.position.toArray(),
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
      quaternion: node.quaternion.toArray(),
      scale: node.scale.toArray(),
    });
    for (const child of node.children) {
      if (!(child instanceof Group)) throw new Error('scene plan materialized a non-Group child');
      visit(child, nodePath === '.' ? child.name : `${nodePath}/${child.name}`);
    }
  };
  visit(root, '.');
  return rows;
}

function quantized(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1_000_000) / 1_000_000;
  if (Array.isArray(value)) return value.map(quantized);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, quantized(child)]),
  );
}

const exporterBinary = argument('--exporter-binary');
const officialBinary = argument('--official-binary');
const actualInput = inputDigest();
const actualImplementation = implementationDigest();
if (sha256(readFileSync(officialBinary)) !== GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256) {
  throw new Error('official Godot executable does not match the scene-node authority pin');
}
if (actualInput !== GODOT_4_7_SCENE_NODE_INPUT_SHA256) {
  throw new Error(`scene-node authority input changed: ${actualInput}`);
}
if (actualImplementation !== GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256) {
  throw new Error(`scene-node authority implementation changed: ${actualImplementation}`);
}

const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-scene-node-'));
try {
  for (const [relative, source] of Object.entries(files))
    writeFileSync(path.join(temp, relative), source);
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
  const result = planGodotSceneDocuments(project, godotSceneNodeAuthority(sourceAuthority));
  if (result.kind !== 'accepted-scene-documents') {
    throw new Error(result.diagnostics.map((entry) => `${entry.at}: ${entry.message}`).join('\n'));
  }
  const scene = result.plan.scenes[0];
  if (result.plan.scenes.length !== 1 || scene === undefined) {
    throw new Error(`scene plan has wrong scene count: ${result.plan.scenes.length}`);
  }
  const target = observeTarget(instantiate(scene.root));
  const nativeRun = spawnSync(officialBinary, ['--headless', '--path', temp], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (nativeRun.error !== undefined || nativeRun.status !== 0) {
    throw new Error(
      `native scene-node probe failed: ${nativeRun.error?.message ?? nativeRun.stderr}`,
    );
  }
  const nativeLine = nativeRun.stdout.split('\n').find((line) => line.startsWith('[{'));
  if (nativeLine === undefined)
    throw new Error(`native scene-node probe had no value: ${nativeRun.stdout}`);
  const native = quantized(JSON.parse(nativeLine) as unknown);
  const quantizedTarget = quantized(target);
  const nativeJson = JSON.stringify(native);
  const targetJson = JSON.stringify(quantizedTarget);
  const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: true });
  if (nativeJson !== targetJson)
    throw new Error(`scene-node mismatch: ${nativeJson} != ${targetJson}`);
  const actualObserved = sha256(nativeJson);
  const actualComparison = sha256(comparison);
  if (actualObserved !== GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256) {
    throw new Error(`scene-node observed output changed: ${actualObserved}`);
  }
  if (actualComparison !== GODOT_4_7_SCENE_NODE_COMPARISON_SHA256) {
    throw new Error(`scene-node comparison changed: ${actualComparison}`);
  }
  process.stdout.write(
    `${JSON.stringify({ verdict: 'exact-match', native, target: quantizedTarget, scene, evidence: result.plan.evidenceClaimIds })}\n`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
