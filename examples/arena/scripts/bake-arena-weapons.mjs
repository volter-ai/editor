/**
 * Bake the arena weapon family through the editor session's Blender.
 *
 *   npm run bake:weapons                    # all three, into public/models/generated/
 *   npm run bake:weapons -- --dry           # into .vgai/tmp/ instead, unrecorded
 *   npm run bake:weapons -- arena-pistol    # one of them
 *   npm run bake:weapons -- --document      # also save src/models/arena-weapons.blend
 *
 * WHY A SCRIPT AND NOT A REGISTERED TOOL. The kit's source is
 * `src/assets/arena-weapons.py` — Blender Python — and the only thing that can
 * run it is the Blender the editor session holds. The door onto that session
 * is the `blender` MCP server (`vgai blender-mcp`), whose `execute_blender_code`
 * tool runs a script AND mirrors whatever it wrote into the project. A file
 * that lands under `public/` is POSTed to the session's
 * `/__editor/blender-output`, which commits the bytes and the
 * `.vgai/provenance.json` entry as one transaction — so the recording door is
 * the transport, and a second project-side tool in front of it would only be
 * a tool that shells this one. A `.blend` is mirrored with a plain write and
 * deliberately not recorded: the ledger is about what the project SHIPS.
 *
 * THE SESSION IS REUSE-OR-START. This script needs an editor session on this
 * project, and it starts one when none is live — and then CLOSES exactly what
 * it started (owner ruling 2026-09-19; the first bpy lane's script required an
 * already-open editor, which made the bake depend on a step nobody had run).
 * A session that was already up is left running, because it is someone's.
 *
 * ONE REFUSAL THAT COSTS A RUN: the code handed to `execute_blender_code` is
 * TEXT-SCANNED before it runs, and a build whose payload lacks a capability
 * refuses by NAME when the script so much as mentions it — in a comment as
 * readily as in a call. `arena-weapons.py` says "Smooth by Angle" in prose for
 * exactly that reason.
 *
 * AND ONE RULE FOR READING THE RESULT: verify a bake by the FILE'S sha on
 * disk, never by the script's own "wrote N bytes" line. That line is the
 * WORKER's filesystem talking, and a re-bake that never mirrored out looks
 * exactly like a successful one.
 *
 * IF YOU COPY THIS SHAPE FOR A MEASUREMENT RATHER THAN A BAKE, CHECK THE
 * WORKING TREE OVER `src/models/` AFTERWARDS. The session opens a `.blend` at
 * start and SAVES BACK TO IT, and the worker binds to whatever Model document
 * the tab is showing — which in this project is
 * `src/models/arena-weapons.blend`. A probe that starts
 * `bpy.ops.wm.read_factory_settings(use_empty=True)` and imports something
 * else has just replaced this kit (measured 2026-09-19: 877,137 ->
 * 5,909,319 bytes, plus a `.blend1`). It is a tracked BINARY, so no diff will
 * tell you and no gate in the repo looks at it; restore it from HEAD.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = resolve(project, 'src/assets/arena-weapons.py');
const ASSETS = ['arena-pistol', 'arena-rifle', 'arena-grenade-launcher'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const withDocument = args.includes('--document');
const named = args.filter((arg) => !arg.startsWith('--'));
const assets = named.length > 0 ? named : ASSETS;
for (const asset of assets) {
  if (!ASSETS.includes(asset)) throw new Error(`Unknown asset '${asset}'. One of: ${ASSETS}`);
}

const vgai = (argv, options = {}) =>
  new Promise((done) => {
    const child = spawn('npm', ['run', '--silent', 'vgai', '--', ...argv], {
      cwd: project,
      stdio: options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...options.spawn,
    });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => done({ code, out }));
  });

// Reuse-or-start. `vgai sessions` names the projects that are live; anything
// else is this script's to start and this script's to close.
const listed = await vgai(['sessions']);
const alreadyLive = listed.out.includes(project);
let started = false;
if (!alreadyLive) {
  console.log('no live session for this project — starting one');
  const child = spawn('npm', ['run', '--silent', 'vgai', '--', 'edit', '.'], {
    cwd: project,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  started = true;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((done) => setTimeout(done, 1000));
    const again = await vgai(['sessions']);
    if (again.out.includes(project)) break;
  }
}

const transport = new StdioClientTransport({
  command: 'npm',
  args: ['run', '--silent', 'vgai', '--', 'blender-mcp'],
  cwd: project,
  stderr: 'inherit',
});
const client = new Client({ name: 'bake-arena-weapons', version: '1' }, { capabilities: {} });
await client.connect(transport);

const kit = readFileSync(KIT, 'utf8');
let failed = 0;
const run = async (label, call) => {
  const begun = Date.now();
  const answer = await client.callTool(
    // The kit is sent whole, with the one call that selects an asset
    // appended. It is not imported: `execute_blender_code` takes code, the
    // session keeps no module cache we would have to invalidate between
    // edits, and a file read from disk each run is a file whose edits are
    // always the ones that ran.
    { name: 'execute_blender_code', arguments: { code: `${kit}\n${call}\n` } },
    undefined,
    { timeout: 30 * 60 * 1000 },
  );
  const text = (answer.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  console.log(`${text}\n  ${label} in ${((Date.now() - begun) / 1000).toFixed(1)}s`);
  if (/^Error executing code:/m.test(text)) failed += 1;
};

for (const asset of assets) {
  await run(asset, `bake(${JSON.stringify(asset)}, dry_run=${dryRun ? 'True' : 'False'})`);
}
if (withDocument) await run('document', `document(dry_run=${dryRun ? 'True' : 'False'})`);

await client.close();
if (started) {
  console.log('closing the session this bake started');
  await vgai(['close'], { inherit: true });
}
process.exit(failed > 0 ? 1 : 0);
