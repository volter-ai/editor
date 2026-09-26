/**
 * Writes `vendor/project-settings/godot-4.7.json`: every setting the official Godot 4.7 binary
 * registers (its `GLOBAL_DEF`s), with the Variant type of its registered default, read as
 * `typeof(ProjectSettings.get_setting(name))` on a project that declares none of them.
 *
 *   npx tsx packages/gd-analyze/scripts/generate-project-setting-types.ts --official-binary <Godot>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const OFFICIAL_SHA256 = '445c6f95030e2ca767dd921be1e91bd99e50c3703f91d22a22cd31216c93a80f';
const index = process.argv.indexOf('--official-binary');
const binary = index < 0 ? undefined : process.argv[index + 1];
if (binary === undefined) throw new Error('pass --official-binary <official Godot 4.7>');
if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== OFFICIAL_SHA256) {
  throw new Error(`${binary} is not the official Godot 4.7-stable executable`);
}
const temp = mkdtempSync(path.join(tmpdir(), 'gd-analyze-settings-'));
try {
  writeFileSync(
    path.join(temp, 'project.godot'),
    'config_version=5\n\n[application]\nconfig/features=PackedStringArray("4.7")\n',
  );
  writeFileSync(
    path.join(temp, 'probe.gd'),
    `extends SceneTree

func _init() -> void:
\tvar rows := {}
\tfor property in ProjectSettings.get_property_list():
\t\tvar name: String = property["name"]
\t\tif ProjectSettings.has_setting(name):
\t\t\trows[name] = type_string(typeof(ProjectSettings.get_setting(name)))
\tprint("SETTINGS " + JSON.stringify(rows))
\tquit()
`,
  );
  const result = spawnSync(binary, ['--headless', '--path', temp, '--script', 'res://probe.gd'], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('SETTINGS '));
  if (line === undefined) throw new Error(`the probe printed no settings\n${result.stderr}`);
  const rows = JSON.parse(line.slice('SETTINGS '.length)) as Record<string, string>;
  // The probe's own project declares `application/config/features`; its registered type is the same.
  const sorted = Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path.join(import.meta.dirname, '..', 'vendor/project-settings/godot-4.7.json'),
    `${JSON.stringify({ executableSha256: OFFICIAL_SHA256, types: sorted }, null, 1)}\n`,
  );
  process.stdout.write(`${String(Object.keys(sorted).length)} registered settings\n`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
