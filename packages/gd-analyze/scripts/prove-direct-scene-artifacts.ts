#!/usr/bin/env -S node --import tsx
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { bindGodotProject } from '../src/analyze/bound-project';
import { captureGodotBoundProgram } from '../src/godot-frontend/run-bound-program';
import { readGodotProjectSnapshot } from '../src/read/godot-project';
import { bindGodotResources } from '../src/read/resource-program';
import { captureGodotProjectSnapshot } from '../src/snapshot/project-snapshot';
import { captureGodotImportToolchainSnapshot } from '../src/snapshot/toolchain-snapshot';
import type { GodotEmittedSourceTranslationArtifact } from '../src/translate/artifacts/types';
import { emitGodotTranslation, type GodotOutputArtifact } from '../src/translate/emit';
import { planGodotTranslation } from '../src/translate/plan';

function isPrimarySourceTranslation(
  artifact: GodotOutputArtifact,
): artifact is GodotEmittedSourceTranslationArtifact {
  return artifact.kind === 'source-translation' && artifact.role === 'primary';
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing ${name}`);
  return path.resolve(value);
}

const projectSource = `config_version=5

[application]
config/name="Direct scene artifact proof"
config/features=PackedStringArray("4.7")
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=960
window/size/viewport_height=540

[rendering]
renderer/rendering_method="gl_compatibility"
`;

const sceneSource = `[gd_scene format=3]

[node name="Main" type="Node3D"]
position = Vector3(1.25, -2, 3)
rotation = Vector3(0.2, -0.4, 0.7)
scale = Vector3(2, 3, 4)

[node name="Child" type="Node3D" parent="."]
position = Vector3(-4, 5.5, 6)
`;

const exporterBinary = argument('--exporter-binary');
const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-direct-scene-artifacts-'));
try {
  writeFileSync(path.join(temp, 'project.godot'), projectSource);
  writeFileSync(path.join(temp, 'main.tscn'), sceneSource);
  const snapshot = captureGodotProjectSnapshot(temp);
  const toolchain = captureGodotImportToolchainSnapshot({
    projectEngine: snapshot.engine,
    boundExporterBinary: exporterBinary,
    officialBinary: argument('--official-binary'),
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
  const artifacts = emitGodotTranslation(translation).artifacts.filter(
    (candidate): candidate is GodotEmittedSourceTranslationArtifact =>
      isPrimarySourceTranslation(candidate) && candidate.path.startsWith('src/scenes/'),
  );
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    artifact?.path !== 'src/scenes/main.tsx' ||
    artifact.origin.sourcePath !== 'res://main.tscn' ||
    artifact.origin.sourceDigest !== project.documents.scenes[0]?.sourceDigest
  ) {
    throw new Error(`direct scene artifacts differ: ${JSON.stringify(artifacts)}`);
  }
  const text = Buffer.from(artifact.bytes).toString('utf8');
  if (
    text.includes('export function MainScene(props: Omit<ThreeElements["group"], "ref">)') ===
      false ||
    text.includes('<group name="Main"') === false ||
    text.includes('{...props}') === false ||
    text.includes('rotation={[0.2, -0.4, 0.7, "YXZ"]}') === false ||
    text.includes('<group name="Child" position={[-4, 5.5, 6]}') === false
  ) {
    throw new Error(`direct scene source differs:\n${text}`);
  }
  process.stdout.write(
    `${JSON.stringify({ verdict: 'mechanical-scene-artifact', path: artifact.path, digest: artifact.digest, origin: artifact.origin, text })}\n`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
