#!/usr/bin/env -S node --import tsx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { godotSourceAuthority } from '../src/godot-frontend/source-authority';
import {
  GODOT_4_7_READ_COMPARISON_SHA256,
  GODOT_4_7_READ_IMPLEMENTATION_SHA256,
  GODOT_4_7_READ_INPUT_SHA256,
  GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256,
} from '../src/read/authority/godot-4.7-read';
import { godotReadAuthority } from '../src/read/authority-data';
import { readGodotProjectSnapshot } from '../src/read/godot-project';
import { bindGodotResources } from '../src/read/resource-program';
import { captureGodotProjectSnapshot } from '../src/snapshot/project-snapshot';
import { GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256 } from '../src/translate/code/authority/godot-4.7-seed';

const files: Readonly<Record<string, string>> = {
  'project.godot': `config_version=5

[application]
config/name="Read authority proof"
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`,
  'read_probe.gd': `extends Node

func _ready() -> void:
	var obj := ConfigFile.new()
	obj.load("res://cube.obj.import")
	var cubemap := ConfigFile.new()
	cubemap.load("res://sky.png.import")
	var gravity_scalar: float = ProjectSettings.get_setting("physics/3d/default_gravity")
	var gravity_direction: Vector3 = ProjectSettings.get_setting("physics/3d/default_gravity_vector")
	var scale: Vector3 = obj.get_value("params", "scale_mesh")
	var offset: Vector3 = obj.get_value("params", "offset_mesh")
	var layouts := ["1x6", "2x3", "3x2", "6x1"]
	print(JSON.stringify({
		"projectName": ProjectSettings.get_setting("application/config/name"),
		"mainScene": ProjectSettings.get_setting("application/run/main_scene"),
		"window": [ProjectSettings.get_setting("display/window/size/viewport_width"), ProjectSettings.get_setting("display/window/size/viewport_height")],
		"gravity3D": [gravity_direction.x * gravity_scalar, gravity_direction.y * gravity_scalar, gravity_direction.z * gravity_scalar],
		"childOwner": str(get_path_to($Child.owner)),
		"obj": {
			"generateTangents": obj.get_value("params", "generate_tangents"),
			"scaleMesh": [scale.x, scale.y, scale.z],
			"offsetMesh": [offset.x, offset.y, offset.z],
			"forceDisableMeshCompression": obj.get_value("params", "force_disable_mesh_compression"),
			"importerVersion": obj.get_value("remap", "importer_version"),
		},
		"cubemapArrangement": layouts[cubemap.get_value("params", "slices/arrangement")],
	}))
	get_tree().quit()
`,
  'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://read_probe.gd" id="1_probe"]

[node name="Main" type="Node"]
script = ExtResource("1_probe")

[node name="Child" type="Node" parent="."]
`,
  'cube.obj': `o Triangle
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
f 1/1 2/2 3/3
`,
  // This record intentionally selects the cubemap importer. The native ConfigFile and our reader
  // consume the same Godot serialization; the option's meaning/default is source-pinned at
  // resource_importer_layered_texture.cpp:162.
  'sky.png.import': `[remap]
importer="cubemap_texture"
type="CompressedCubemap"

[deps]
source_file="res://sky.png"

[params]
slices/arrangement=1
`,
};

const IMPLEMENTATION_FILES = [
  'src/read/godot-value.ts',
  'src/read/text-format.ts',
  'src/read/known-settings.ts',
  'src/read/project-settings.ts',
  'src/read/scene.ts',
  'src/read/import-sidecar.ts',
  'src/read/godot-project.ts',
  'src/read/resource-program.ts',
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

const officialBinary = argument('--official-binary');
const measure = process.argv.includes('--measure');
const actualInput = inputDigest();
const actualImplementation = implementationDigest();
const nativeExecutable = sha256(readFileSync(officialBinary));
if (nativeExecutable !== GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256) {
  throw new Error(`official Godot executable changed: ${nativeExecutable}`);
}
const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-read-authority-'));
try {
  for (const [relative, source] of Object.entries(files)) {
    writeFileSync(path.join(temp, relative), source);
  }
  const imported = spawnSync(
    officialBinary,
    ['--editor', '--headless', '--path', temp, '--import', '--quit'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (imported.error !== undefined || imported.status !== 0) {
    throw new Error(`native import failed: ${imported.error?.message ?? imported.stderr}`);
  }
  const snapshot = captureGodotProjectSnapshot(temp);
  const authority = godotReadAuthority(godotSourceAuthority(4));
  const decoded = readGodotProjectSnapshot(snapshot, authority);
  const resources = bindGodotResources(decoded, authority);
  const scene = decoded.scenes.find((candidate) => candidate.resPath === 'res://main.tscn');
  const child = scene?.root?.children.find((candidate) => candidate.name === 'Child');
  const obj = resources.imports.find((candidate) => candidate.kind === 'wavefront-obj');
  const cubemap = resources.imports.find((candidate) => candidate.kind === 'cubemap-texture');
  if (obj?.kind !== 'wavefront-obj' || cubemap?.kind !== 'cubemap-texture') {
    throw new Error('target read omitted the OBJ or cubemap import');
  }
  const target = {
    projectName: decoded.projectName,
    mainScene: decoded.mainScene,
    window:
      decoded.window === undefined ? undefined : [decoded.window.width, decoded.window.height],
    gravity3D: [decoded.gravity3D.x, decoded.gravity3D.y, decoded.gravity3D.z],
    childOwner: child?.ownerPath,
    obj: {
      generateTangents: obj.generateTangents,
      scaleMesh: obj.scaleMesh,
      offsetMesh: obj.offsetMesh,
      forceDisableMeshCompression: obj.forceDisableMeshCompression,
      importerVersion: obj.importerVersion,
    },
    cubemapArrangement: cubemap.arrangement,
  };
  const nativeRun = spawnSync(officialBinary, ['--headless', '--path', temp], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (nativeRun.error !== undefined || nativeRun.status !== 0) {
    throw new Error(`native read probe failed: ${nativeRun.error?.message ?? nativeRun.stderr}`);
  }
  const nativeLine = nativeRun.stdout.split('\n').find((line) => line.startsWith('{'));
  if (nativeLine === undefined)
    throw new Error(`native read probe had no value: ${nativeRun.stdout}`);
  const native = JSON.parse(nativeLine) as unknown;
  const nativeJson = JSON.stringify(canonical(native));
  const targetJson = JSON.stringify(canonical(target));
  const actualObserved = sha256(nativeJson);
  const actualComparison = sha256(
    JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson }),
  );
  const identities = {
    input: actualInput,
    implementation: actualImplementation,
    nativeExecutable,
    observed: actualObserved,
    comparison: actualComparison,
  };
  if (measure) {
    process.stdout.write(`${JSON.stringify({ identities, native, target }, null, 2)}\n`);
  } else {
    if (nativeJson !== targetJson) throw new Error(`read mismatch: ${nativeJson} != ${targetJson}`);
    if (
      actualInput !== GODOT_4_7_READ_INPUT_SHA256 ||
      actualImplementation !== GODOT_4_7_READ_IMPLEMENTATION_SHA256 ||
      actualObserved !== GODOT_4_7_READ_OBSERVED_OUTPUT_SHA256 ||
      actualComparison !== GODOT_4_7_READ_COMPARISON_SHA256
    ) {
      throw new Error(`read authority identities changed: ${JSON.stringify(identities)}`);
    }
    process.stdout.write(
      `${JSON.stringify({ verdict: 'exact-match', native, target, evidence: resources.evidence })}\n`,
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
