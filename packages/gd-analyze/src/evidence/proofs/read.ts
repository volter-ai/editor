/** The read authority's proof: official Godot's decoded project versus `readGodotProjectSnapshot`. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { packageImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { godotSourceAuthority } from '../../godot-frontend/source-authority';
import { GODOT_READ_IMPLEMENTATION_FILES, godotReadAuthority } from '../../read/authority-data';
import { readGodotProjectSnapshot } from '../../read/godot-project';
import { bindGodotResources } from '../../read/resource-program';
import { captureGodotProjectSnapshot } from '../../snapshot/project-snapshot';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

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

function inputDigest(): string {
  return sha256(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, source]) => `${relative}\0${sha256(source)}`)
      .join('\n'),
  );
}

export function measureReadProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const officialBinary = tools.officialBinary;
  const actualInput = inputDigest();
  const actualImplementation = packageImplementationDigest(GODOT_READ_IMPLEMENTATION_FILES);
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-read-authority-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      writeFileSync(path.join(temp, relative), source);
    }
    const imported = spawnSync(
      officialBinary,
      ['--editor', '--headless', '--path', temp, '--import', '--quit'],
      { encoding: 'utf8', timeout: 120_000 },
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
      timeout: 120_000,
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
    return [
      {
        name: 'read',
        identities: {
          input: actualInput,
          implementation: actualImplementation,
          observed: actualObserved,
          comparison: actualComparison,
        },
        agree: nativeJson === targetJson,
        detail: `native ${nativeJson}\ntarget ${targetJson}`,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
