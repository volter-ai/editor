/** The analysis authority's proof: official Godot's instantiated tree versus `bindGodotProject`. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  GODOT_ANALYSIS_IMPLEMENTATION_FILES,
  godotAnalysisAuthority,
} from '../../analyze/authority-data';
import { bindGodotProject } from '../../analyze/bound-project';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { captureGodotApiDumpSnapshot } from '../../snapshot/toolchain-snapshot';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Bound relationships proof"
run/main_scene="res://main.tscn"

[autoload]
Globals="*res://autoload.gd"

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'base.gd': `extends Node

func _process(_delta: float) -> void:
	pass
`,
  'leaf.gd': `extends "res://base.gd"

@export var speed: int = 0
@onready var nested := $Nested

func _ready() -> void:
	pass

func _physics_process(_delta: float) -> void:
	pass
`,
  'nested.gd': `extends Node

func _enter_tree() -> void:
	pass
`,
  'autoload.gd': `extends Node

func _process(_delta: float) -> void:
	pass
`,
  'main.gd': `extends Node

func visit(node: Node, rows: Array[String]) -> void:
	var script = node.get_script()
	if script != null:
		rows.append(str(node.get_path()) + "=" + script.resource_path)
	for child in node.get_children():
		visit(child, rows)

func _ready() -> void:
	var rows: Array[String] = []
	visit(self, rows)
	rows.append(str(Globals.get_path()) + "=" + Globals.get_script().resource_path)
	rows.sort()
	print(JSON.stringify(rows))
	get_tree().quit()
`,
  'leaf.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://leaf.gd" id="1_leaf"]
[ext_resource type="Script" path="res://nested.gd" id="2_nested"]

[node name="Leaf" type="Node"]
script = ExtResource("1_leaf")
speed = 7

[node name="Nested" type="Node" parent="."]
script = ExtResource("2_nested")
`,
  'main.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://leaf.tscn" id="2_leaf"]

[node name="Main" type="Node"]
script = ExtResource("1_main")

[node name="MountedLeaf" parent="." instance=ExtResource("2_leaf")]
speed = 9
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

export function measureAnalysisProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const { exporterBinary, officialBinary } = tools;
  const actualInput = inputDigest();
  const actualImplementation = packageImplementationDigest(GODOT_ANALYSIS_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-bound-relationships-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
    const snapshot = captureGodotProjectSnapshot(temp);
    const authority = godotSourceAuthority(4);
    const readAuthority = godotReadAuthority(authority);
    const project = bindGodotProject(
      snapshot,
      captureGodotBoundProgram({ godotBinary: exporterBinary, projectDir: temp }),
      bindGodotResources(readGodotProjectSnapshot(snapshot, readAuthority), readAuthority),
      godotAnalysisAuthority(authority),
      authority,
      captureGodotApiDumpSnapshot(authority),
      readGodotProjectSnapshot(snapshot, readAuthority),
    );

    const script = (resPath: string) => {
      const result = project.scripts.find((candidate) => candidate.resPath === resPath);
      if (result === undefined) throw new Error(`bound project omitted ${resPath}`);
      return result;
    };
    const sceneRows = project.documents.scenes.map((entry) => ({
      resPath: entry.resPath,
      sourceDigest: entry.sourceDigest,
      root: entry.nodes.find((node) => node.placement.kind === 'root')?.name,
      nodes: entry.nodes.length,
    }));
    const classRows = project.documents.scenes.flatMap((entry) =>
      entry.nodes.map((node) => ({
        identity: `${node.documentPath}#${node.nodePath}`,
        authoredName: node.class.authoredName,
        nativeName: node.class.nativeName,
        nativeCanonicalIdentity: node.class.nativeCanonicalIdentity,
        nativeAncestry: node.class.nativeAncestry,
        source: node.class.source,
      })),
    );
    if (
      sceneRows.length !== 2 ||
      sceneRows[0]?.resPath !== 'res://leaf.tscn' ||
      sceneRows[0].root !== 'Leaf' ||
      sceneRows[0].nodes !== 2 ||
      sceneRows[1]?.resPath !== 'res://main.tscn' ||
      sceneRows[1].root !== 'Main' ||
      sceneRows[1].nodes !== 3
    ) {
      throw new Error(`bound project documents differ: ${JSON.stringify(sceneRows)}`);
    }
    const expectedClassRows = [
      'res://leaf.tscn#.:Node:Node>Object',
      'res://leaf.tscn#Nested:Node:Node>Object',
      'res://main.tscn#.:Node:Node>Object',
      'res://main.tscn#MountedLeaf:Node:Node>Object',
      'res://main.tscn#MountedLeaf/Nested:Node:Node>Object',
    ];
    const observedClassRows = classRows.map(
      (entry) => `${entry.identity}:${entry.nativeName}:${entry.nativeAncestry.join('>')}`,
    );
    if (JSON.stringify(observedClassRows) !== JSON.stringify(expectedClassRows)) {
      throw new Error(`bound scene classes differ: ${JSON.stringify(classRows)}`);
    }
    if (
      classRows.some(
        (entry) =>
          entry.nativeCanonicalIdentity !== `${authority.revision}\0ClassDB\0Node` ||
          entry.source.kind !== 'native-class',
      )
    ) {
      throw new Error(`bound scene class identities differ: ${JSON.stringify(classRows)}`);
    }
    const attachmentRows = (resPath: string) =>
      script(resPath).attachments.map((entry) => `${entry.documentPath}#${entry.nodePath}`);
    const expectedLeaf = ['res://leaf.tscn#.', 'res://main.tscn#MountedLeaf'];
    const expectedNested = ['res://leaf.tscn#Nested', 'res://main.tscn#MountedLeaf/Nested'];
    if (JSON.stringify(attachmentRows('res://leaf.gd')) !== JSON.stringify(expectedLeaf)) {
      throw new Error(`leaf attachments differ: ${JSON.stringify(attachmentRows('res://leaf.gd'))}`);
    }
    const leafAttachments = script('res://leaf.gd').attachments;
    const attachmentValues = leafAttachments.map((attachment) => ({
      nodeClass: attachment.nodeClass,
      speed: attachment.authoredProperties['speed'],
      nodePathProperties: attachment.nodePathProperties,
    }));
    const expectedAttachmentValues = [
      {
        nodeClass: 'Node',
        speed: { kind: 'number', value: 7, variantType: 'int' },
        nodePathProperties: [],
      },
      {
        nodeClass: 'Node',
        speed: { kind: 'number', value: 9, variantType: 'int' },
        nodePathProperties: [],
      },
    ];
    if (JSON.stringify(attachmentValues) !== JSON.stringify(expectedAttachmentValues)) {
      throw new Error(`attachment values differ: ${JSON.stringify(attachmentValues)}`);
    }
    const fieldBindings = script('res://leaf.gd').fields.map((field) => ({
      name: field.name,
      initialization: field.initialization,
      exported: field.exported,
      attachmentValues: field.attachmentValues,
    }));
    if (
      fieldBindings[0]?.name !== 'speed' ||
      fieldBindings[0].initialization !== 'instance-construction' ||
      fieldBindings[0].attachmentValues.some((entry) => entry.source !== 'authored-value') ||
      fieldBindings[1]?.name !== 'nested' ||
      fieldBindings[1].initialization !== 'ready' ||
      fieldBindings[1].attachmentValues.some((entry) => entry.source !== 'script-default')
    ) {
      throw new Error(`field binding plan differs: ${JSON.stringify(fieldBindings)}`);
    }
    if (JSON.stringify(attachmentRows('res://nested.gd')) !== JSON.stringify(expectedNested)) {
      throw new Error(
        `nested attachments differ: ${JSON.stringify(attachmentRows('res://nested.gd'))}`,
      );
    }
    const leafLifecycle = script('res://leaf.gd').lifecycle.map(
      (entry) => `${entry.phase}:${entry.ownerResPath}`,
    );
    const expectedLifecycle = [
      'ready:res://leaf.gd',
      'process:res://base.gd',
      'physics-process:res://leaf.gd',
    ];
    if (JSON.stringify(leafLifecycle) !== JSON.stringify(expectedLifecycle)) {
      throw new Error(`leaf lifecycle differs: ${JSON.stringify(leafLifecycle)}`);
    }
    if (
      project.entrypoints.mainScene !== 'res://main.tscn' ||
      JSON.stringify(script('res://autoload.gd').autoloads) !==
        JSON.stringify([{ name: 'Globals', singleton: true }])
    ) {
      throw new Error(
        `entrypoint/autoload relationships differ: ${JSON.stringify(project.entrypoints)}`,
      );
    }

    const native = spawnSync(officialBinary, ['--headless', '--path', temp], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (native.error !== undefined || native.status !== 0) {
      throw new Error(`native relationship probe failed: ${native.error?.message ?? native.stderr}`);
    }
    const nativeLine = native.stdout.split('\n').find((line) => line.startsWith('["/root/'));
    if (nativeLine === undefined)
      throw new Error(`native relationship probe had no result: ${native.stdout}`);
    const nativeRows = JSON.parse(nativeLine) as string[];
    const expectedNative = [
      '/root/Globals=res://autoload.gd',
      '/root/Main/MountedLeaf/Nested=res://nested.gd',
      '/root/Main/MountedLeaf=res://leaf.gd',
      '/root/Main=res://main.gd',
    ];
    if (JSON.stringify(nativeRows) !== JSON.stringify(expectedNative)) {
      throw new Error(`native relationship observation differs: ${JSON.stringify(nativeRows)}`);
    }
    const observation = {
      nativeRows,
      sceneRows,
      classRows,
      attachmentValues,
      fieldBindings,
      leafLifecycle,
      entrypoints: project.entrypoints,
      evidence: project.analysisEvidence,
    };
    // The registry digest includes the claim records themselves, so it is reported but deliberately
    // excluded from the observation pin; including it would make the claim hash depend on itself.
    const observedJson = JSON.stringify(
      canonical({
        ...observation,
        evidence: { claimIds: project.analysisEvidence.claimIds },
      }),
    );
    const actualObserved = sha256(observedJson);
    const actualComparison = sha256(
      JSON.stringify({ nativeRows, expectedNative, relationshipAssertions: 'exact', equal: true }),
    );
    return [
      {
        name: 'analysis',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: actualObserved,
          comparison: actualComparison,
        },
        agree: true,
        detail: observedJson,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
