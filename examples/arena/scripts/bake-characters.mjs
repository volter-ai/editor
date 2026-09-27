/**
 * Bake this game's characters from their Blender documents.
 *
 *   npm run bake:characters                    # all three, into public/models/generated/
 *   npm run bake:characters -- --dry           # into .vgai/tmp/ instead, unrecorded
 *   npm run bake:characters -- arena-vanguard  # one of them
 *
 * THE SOURCE IS THE `.blend`, NOT A SPEC. `src/models/<character>.blend` holds
 * the mesh, the 65-bone armature, its vertex groups and weights, the vertex
 * colours, the material and the Idle/Walk/Run actions. `src/assets/characters.py`
 * opens one and exports the game's `.glb`; this script is the transport that
 * runs it in the editor session's Blender, which is the only Blender there is.
 * To change a character, change the document — see that file's header.
 *
 * WHY A SCRIPT AND NOT A REGISTERED TOOL, THE SESSION'S REUSE-OR-START
 * CONTRACT, THE TEXT SCAN, AND "VERIFY BY THE FILE'S SHA, NEVER BY THE
 * SCRIPT'S OWN BYTE COUNT": all four are `bake-arena-weapons.mjs`'s reasons,
 * unchanged, and that header is where they are written down.
 *
 * AND ONE THING TO DO AFTERWARDS, EVERY TIME: `git status` over `src/models/`.
 * The session re-saves the `.blend` it holds on the way out, and a re-save is
 * a re-serialization rather than a copy — same scene, same byte COUNT, a
 * different file. This script already reopens the session's own document after
 * the last bake (without that it saved a character's scene OVER it, measured
 * 2026-09-19 in all three examples), so what is left is churn, not damage:
 * `git checkout` any `.blend` that comes back modified. A bake does not edit a
 * document; if one shows up changed for any other reason, that IS the finding.
 *
 * ONE THING THAT HEADER DOES NOT CARRY, AND IT COSTS EVERY RUN UNTIL YOU KNOW
 * IT: `blender-start` presents into the tab's OPEN MODEL DOCUMENT, and when
 * none is open it reaches for the standing `blender:runtime` address — which a
 * project that declares its own `.blend` files does not list. The refusal then
 * reads `The project's document table lists no document: blender:runtime`,
 * which sounds like a missing package and means "nothing is open". So this
 * script opens the project's own model document first, through the session's
 * ordinary `editor.open`, and retries while the tab is still evaluating its
 * contributions (a tab mid-load answers `unknown command type "blender-start"`
 * instead — same symptom, different cause).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = resolve(project, 'src/assets/characters.py');
const ASSETS = ['arena-vanguard', 'redline-breacher', 'redline-overwatch'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const named = args.filter((arg) => !arg.startsWith('--'));
const assets = named.length > 0 ? named : ASSETS;
for (const asset of assets) {
  if (!ASSETS.includes(asset)) throw new Error(`Unknown character '${asset}'. One of: ${ASSETS}`);
}

const shell = (command, argv, options = {}) =>
  new Promise((done) => {
    const child = spawn(command, argv, {
      cwd: project,
      stdio: options.inherit === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...options.spawn,
    });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => done({ code, out }));
  });
const vgai = (argv, options) => shell('npm', ['run', '--silent', 'vgai', '--', ...argv], options);

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

const openModelDocument = `
  const state = await editor.status();
  const entries = state.adapter?.scenes?.entries ?? [];
  const model = entries.find((entry) => entry.kind === 'model');
  if (!model) throw new Error('this project declares no model document');
  await editor.open(model.id);
  // A SENTINEL, not the id. The id is model:src/models/<name>.blend for a
  // project that already holds a .blend, and blender:runtime for one that does
  // not yet (the standing entry project-adapter.ts injects), so matching the
  // id's SHAPE silently fails on exactly the FIRST import into a project — the
  // one run that has no document of its own. (No backticks in here: this
  // comment lives inside a JS template literal, and one would end it.)
  return 'MODEL-DOCUMENT-OPEN ' + model.id;
`;
for (let attempt = 1; ; attempt += 1) {
  const opened = await vgai(['eval', openModelDocument]);
  if (/MODEL-DOCUMENT-OPEN/.test(opened.out)) break;
  if (attempt >= 30) {
    console.error(opened.out);
    throw new Error('the tab never opened a Model document; Blender cannot start without one');
  }
  console.log(`  waiting for the tab to open its Model document (${attempt})`);
  await new Promise((done) => setTimeout(done, 4000));
}

const transport = new StdioClientTransport({
  command: 'npm',
  args: ['run', '--silent', 'vgai', '--', 'blender-mcp'],
  cwd: project,
  stderr: 'inherit',
});
const client = new Client({ name: 'bake-characters', version: '1' }, { capabilities: {} });
await client.connect(transport);

const kit = readFileSync(MODULE, 'utf8');
const run = async (call) => {
  const answer = await client.callTool(
    { name: 'execute_blender_code', arguments: { code: `${kit}\n${call}\n` } },
    undefined,
    { timeout: 30 * 60 * 1000 },
  );
  return (answer.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
};

// THE SESSION'S OWN DOCUMENT, read BEFORE the first bake opens its own, and
// reopened after the last one. Without it the session saves whichever
// character was last in memory over the `.blend` the tab holds — measured
// 2026-09-19 in all three examples, one tracked binary per project, silently.
// It cannot live in `bake()`'s own `finally`: the recording door reads
// `bpy.data.filepath` after the call returns to learn which `.blend` the
// `.glb` came from, so restoring inside the bake would make every artifact
// name the session's document instead of its real source.
const held = (await run('session_document()')).match(/SESSION-DOCUMENT (\S+)/)?.[1] ?? '';

let failed = 0;
for (const asset of assets) {
  const begun = Date.now();
  const text = await run(`bake(${JSON.stringify(asset)}, dry_run=${dryRun ? 'True' : 'False'})`);
  console.log(`${text}\n  ${asset} in ${((Date.now() - begun) / 1000).toFixed(1)}s`);
  if (/^Error executing code:/m.test(text)) failed += 1;
}
if (held !== '') console.log(await run(`restore_session_document(${JSON.stringify(held)})`));

await client.close();
if (started) {
  console.log('closing the session this bake started');
  await vgai(['close'], { inherit: true });
}
process.exit(failed > 0 ? 1 : 0);
