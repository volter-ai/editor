#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import productPackage from '../package.json';
import { createGameProject, presets } from './create';
import { isScaffoldAddition, SCAFFOLD_ADDITIONS, type ScaffoldAddition } from './scaffold/additions';
import { launch, type LaunchingProduct } from '@volter/editor-core/server/launcher/launch';
import { control } from '@volter/editor-core/server/launcher/control';
import { listRecentProjects, listSessions, openProject, restart, screenshot, showProject, SCREENSHOT_OPTIONS, SCREENSHOT_USAGE } from '@volter/editor-core/server/launcher/session-verbs';
import { hasManifest } from '@volter/editor-project/manifest/locate';
import { CAPABILITY_OPTIONS, runCapabilityCommand } from './capabilities';
import { resolveWorkbench, writeWorkbenchDeclaration } from '@volter/editor-sdk/session/workbench-locator';

const PRODUCT: LaunchingProduct = { packageName: '@volter/game-editor', id: 'game-editor', displayName: 'Volter Game Editor', command: 'volter-game-editor' };

/** `play` and `stop` are `@volter/editor-game`'s contributed session verbs
 *  (`contributions/play.command.ts`), relayed over the session's command wire. */
async function playVerb(verb: 'play' | 'stop'): Promise<void> {
  const { connect } = await import('@volter/editor-live');
  const { EditorClient } = await import('@volter/editor-sdk/client');
  const live = await connect();
  const client = new EditorClient({ url: `http://127.0.0.1:${live.session.port}` });
  const result: unknown = verb === 'play' ? await client.play() : await client.stop();
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    workbench: { type: 'string' }, reason: { type: 'string' }, 'no-open': { type: 'boolean' },
    template: { type: 'string' }, with: { type: 'string' },
    port: { type: 'string' }, version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    ...SCREENSHOT_OPTIONS, ...CAPABILITY_OPTIONS,
  } });
  const [verb = 'edit', folder = '.'] = positionals;
  for (const key of Object.keys(SCREENSHOT_OPTIONS) as (keyof typeof SCREENSHOT_OPTIONS)[])
    if (values[key] !== undefined && verb !== 'screenshot') throw new Error(`--${key} belongs to screenshot.`);
  for (const key of Object.keys(CAPABILITY_OPTIONS) as (keyof typeof CAPABILITY_OPTIONS)[])
    if (values[key] !== undefined && verb !== 'add' && verb !== 'remove' && verb !== 'outdated') throw new Error(`--${key} belongs to add, remove and outdated.`);
  if (values.version) {
    console.log(verb === 'blender-mcp' ? `BlenderMCP ${(await import('@volter/editor-blender/mcp')).BLENDER_MCP_VERSION}` : productPackage.version);
  } else if (values.help) {
    console.log(`Volter Game Editor
  volter-game-editor create <folder> [--template ${Object.keys(presets.templates).join('|')}] [--with ${SCAFFOLD_ADDITIONS.join(',')}] [--workbench <dir>]
  volter-game-editor edit [folder] [--workbench <dir>] [--no-open] [--port <n>]
  volter-game-editor status | console | close
  volter-game-editor console ack <id> --reason <text>
  volter-game-editor eval <JavaScript body>   # { editor, game, page, tools, session } in scope
  volter-game-editor play | stop | restart
  volter-game-editor ${SCREENSHOT_USAGE}
  volter-game-editor sessions | project | projects
  volter-game-editor open <path>
  volter-game-editor add [id...] | remove <id...> | outdated   [--project <path>] [--dry-run] [--json]
  volter-game-editor blender-mcp    # stdio MCP transport to Blender in the editor`);
  } else if (verb === 'blender-mcp') {
    if (positionals.length !== 1) throw new Error('Usage: volter-game-editor blender-mcp');
    let project = resolve(process.cwd());
    while (!hasManifest(project)) {
      const parent = dirname(project);
      if (parent === project) throw new Error('Run volter-game-editor blender-mcp inside a game project.');
      project = parent;
    }
    const { serveBlenderMcp } = await import('@volter/editor-blender/mcp');
    // MCP must answer initialization immediately. Only a scene request opens
    // an editor; launcher output goes to stderr so stdout remains JSON-RPC.
    await serveBlenderMcp(project, async () => {
      const { resolveSession } = await import('@volter/editor-live');
      try { await resolveSession(project); return; } catch { /* launch diagnoses stale sessions */ }
      await new Promise<void>((done, fail) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'edit', project], {
          cwd: project, stdio: ['ignore', 2, 2], env: process.env,
        });
        child.once('error', fail);
        child.once('close', code => code === 0 ? done() : fail(new Error(`Blender editor startup exited with code ${code}`)));
      });
    }, PRODUCT.command);
  } else if (verb === 'add' || verb === 'remove' || verb === 'outdated') {
    runCapabilityCommand(verb, positionals.slice(1), values);
  } else if (verb === 'screenshot') {
    if (positionals.length > 2) throw new Error(`Usage: volter-game-editor ${SCREENSHOT_USAGE}`);
    await screenshot(positionals[1], values);
  } else if (verb === 'restart') {
    if (positionals.length > 1) throw new Error('Usage: volter-game-editor restart');
    const { connect } = await import('@volter/game-live');
    await restart(PRODUCT.command, { reloadPage: async () => (await connect()).page.reload() });
  } else if (verb === 'sessions' || verb === 'project' || verb === 'projects') {
    if (positionals.length > 1) throw new Error(`Usage: volter-game-editor ${verb}`);
    await (verb === 'sessions' ? listSessions() : verb === 'project' ? showProject() : listRecentProjects());
  } else if (verb === 'open') {
    if (positionals.length !== 2) throw new Error('Usage: volter-game-editor open <path>');
    await openProject(positionals[1]!);
  } else if (verb === 'console' && positionals[1] === 'ack') {
    if (positionals.length !== 3 || !values.reason?.trim()) throw new Error('Usage: volter-game-editor console ack <id> --reason <text>');
    await control(PRODUCT.command, 'console-ack', positionals[2], values.reason);
  } else if (['status', 'console', 'eval', 'close'].includes(verb)) {
    if (positionals.length > (verb === 'eval' ? 2 : 1)) throw new Error('Unexpected arguments.');
    // `eval`'s scope adds the game half (`@volter/game-live`) on the same session.
    const { gameBindings } = await import('@volter/game-live');
    await control(PRODUCT.command, verb, positionals[1], undefined, live => {
      const { game, page, recording } = gameBindings(live.session);
      return { editor: Object.assign(live.editor, { recording }), game, page };
    });
  } else if (verb === 'play' || verb === 'stop') {
    if (positionals.length > 1) throw new Error('Unexpected arguments.');
    await playVerb(verb);
  } else {
    if (positionals.length > 2) throw new Error('Unexpected positional arguments.');
    if (verb !== 'create' && verb !== 'edit') throw new Error(`Unknown command: ${verb}`);
    if (verb !== 'create' && (values.template !== undefined || values.with !== undefined)) throw new Error('--template and --with belong to create.');
    if (verb === 'create') {
      if (!positionals[1]) throw new Error('create requires a new folder name.');
      const additions: ScaffoldAddition[] = [];
      for (const value of (values.with ?? '').split(',').filter(Boolean)) {
        if (!isScaffoldAddition(value)) throw new Error(`--with must name additions from: ${SCAFFOLD_ADDITIONS.join(', ')} — got "${value}"`);
        additions.push(value);
      }
      if (values.workbench) resolveWorkbench(resolve(values.workbench), PRODUCT.id);
      await createGameProject({
        name: folder.split(/[\\/]/).at(-1)!, targetDir: resolve(folder), additions,
        ...(values.template === undefined ? {} : { template: values.template }),
      });
      if (values.workbench) writeWorkbenchDeclaration(resolve(folder), resolve(values.workbench));
    }
    await launch(folder, PRODUCT, {
      ...(values.workbench ? { workbench: values.workbench } : {}),
      ...(values['no-open'] ? { noOpen: true } : {}),
      ...(values.port ? { port: Number(values.port) } : {}),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
