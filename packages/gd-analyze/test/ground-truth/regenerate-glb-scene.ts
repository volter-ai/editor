/**
 * test/ground-truth/regenerate-glb-scene.ts — re-run `probe-glb-scene.gd` against a REAL Godot 4
 * and rewrite the two committed oracles.
 *
 *   GODOT4=/path/to/Godot.app/Contents/MacOS/Godot \
 *     npx tsx packages/gd-analyze/test/ground-truth/regenerate-glb-scene.ts
 *
 * ## Why this is a script and not a paragraph in the probe's header
 *
 * The probe's header states the four commands. Typing them is where the two mistakes live, and
 * both produce a plausible wrong oracle rather than an error:
 *
 *  1. **Running Godot against the repo fixture.** Godot writes `.godot/` and rewrites every
 *     `*.import` in whatever project it opens, and `test/fixtures/**` is byte-locked by
 *     `verify-unaltered.mjs`. This script copies to a temp dir, always, and never accepts a target
 *     inside the repo.
 *  2. **Booting the editor per question.** Each fixture gets exactly ONE import boot and ONE probe
 *     boot, recording every `.glb` in the project in that single pass — the standing instrument
 *     rule (FIDELITY.md header). Adding a `.glb` to a fixture costs no extra boot.
 *
 * It also RECORDS the engine it ran, by dumping the extension API and comparing the sha256 against
 * the lane's pinned `vendor/extension-api/godot-4.7-extension_api.json.sha256`. A `--version`
 * string agreeing is a claim; an identical dump is the same engine, and the importer's output is
 * version-specific in ways nothing announces.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, '..', 'fixtures');
const PINNED_SHA = path.join(
  HERE,
  '..',
  '..',
  'vendor',
  'extension-api',
  'godot-4.7-extension_api.json.sha256',
);

/** The fixtures whose `.glb` trees the reader is validated against, and the oracle each writes. */
const TARGETS: readonly { readonly fixture: string; readonly oracle: string }[] = [
  { fixture: 'starter-kit-3d-platformer', oracle: 'godot47-glb-scene-starter-kit.json' },
  { fixture: 'platformer-3d-godot4', oracle: 'godot47-glb-scene-platformer-3d-godot4.json' },
];

const godot = process.env['GODOT4'];
if (godot === undefined || godot === '') {
  throw new Error(
    'regenerate-glb-scene: set GODOT4 to a Godot 4.7 binary, e.g. ' +
      'GODOT4=/Applications/Godot.app/Contents/MacOS/Godot npx tsx ' +
      'packages/gd-analyze/test/ground-truth/regenerate-glb-scene.ts',
  );
}

function run(args: readonly string[], cwd: string): string {
  return execFileSync(godot as string, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

// The engine identity check, first — a wrong binary would silently write a wrong oracle.
const apiDir = mkdtempSync(path.join(tmpdir(), 'gd-api-'));
run(['--headless', '--dump-extension-api'], apiDir);
const dumped = createHash('sha256')
  .update(readFileSync(path.join(apiDir, 'extension_api.json')))
  .digest('hex');
rmSync(apiDir, { recursive: true, force: true });
const pinned = readFileSync(PINNED_SHA, 'utf8').trim().split(/\s+/)[0];
if (dumped !== pinned) {
  throw new Error(
    `regenerate-glb-scene: GODOT4 dumps extension_api.json sha256 ${dumped}, but the lane pins ` +
      `${pinned}. The oracles and the reader are keyed to ONE engine build; regenerating with a ` +
      'different one would move the oracle under the reader without saying so.',
  );
}
process.stdout.write(`engine verified: extension_api sha256 ${dumped}\n`);

for (const { fixture, oracle } of TARGETS) {
  const scratch = mkdtempSync(path.join(tmpdir(), `gd-glb-${fixture}-`));
  const project = path.join(scratch, fixture);
  cpSync(path.join(FIXTURES, fixture), project, { recursive: true });
  cpSync(path.join(HERE, 'probe-glb-scene.gd'), path.join(project, 'probe-glb-scene.gd'));

  run(['--headless', '--path', project, '--import'], scratch);
  const log = run(['--headless', '--path', project, '-s', 'res://probe-glb-scene.gd'], scratch);
  process.stdout.write(`${fixture}: ${log.trim().split('\n').at(-1) ?? ''}\n`);

  const produced = readFileSync(path.join(project, 'probe-glb-scene.json'), 'utf8');
  writeFileSync(path.join(HERE, oracle), `${produced.trimEnd()}\n`, 'utf8');
  process.stdout.write(`wrote ground-truth/${oracle}\n`);
  rmSync(scratch, { recursive: true, force: true });
}
