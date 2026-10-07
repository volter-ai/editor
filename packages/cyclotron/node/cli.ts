#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasManifest } from '@volter/editor-project/manifest/locate';
import productPackage from '../package.json';
import { declaration, UPGRADING } from './create';
import { startupProject } from './startup';
import { chat, CHAT_USAGE } from './chat';
import { playLog, PLAY_LOG_USAGE } from './play-log';
import { addPlay, ADD_PLAY_USAGE } from './add-play';
import { camera, CAMERA_OPTIONS, CAMERA_USAGE } from './camera';
import { play, PLAY_USAGE } from './play';
import { launch, prepareSession, VIEW_BUILD_USAGE, viewBuild, type LaunchingProduct } from '@volter/editor-core/server/launcher/launch';
import { control, hostedControl, HOSTED_USAGE } from '@volter/editor-core/server/launcher/control';
import { capture, CAPTURE_OPTIONS, CAPTURE_USAGE, listRecentProjects, listSessions, openProject, screenshot, showProject, SCREENSHOT_OPTIONS, SCREENSHOT_USAGE } from '@volter/editor-core/server/launcher/session-verbs';
import { resolveWorkbench, writeWorkbenchDeclaration } from '@volter/editor-sdk/session/workbench-locator';
import { declaredRetiredProduct, retiredProjectError, upgradeProject, UPGRADE_USAGE } from '@volter/editor-sdk/session/project-upgrade';

// The command and the name a person sees are the package's own declarations
// (`bin`, `volter.product.displayName`), the same ones the session reads.
const PRODUCT: LaunchingProduct = { packageName: productPackage.name, id: 'cyclotron', displayName: productPackage.volter.product.displayName, command: Object.keys(productPackage.bin)[0]! };

/** A project still on a name this product replaced opens nowhere but `upgrade`, which moves it. */
function refuseRetired(from: string): void {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (hasManifest(dir)) {
      const retired = declaredRetiredProduct(UPGRADING, dir);
      if (retired !== null) throw retiredProjectError(UPGRADING, retired, dir);
      return;
    }
    if (dirname(dir) === dir) return;
  }
}

try {
  // Explicit args: a project's .mcp.json starts this CLI under `node --eval`, where parseArgs'
  // default drops only the exec path and reads the CLI's own path as the verb.
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
    workbench: { type: 'string' }, template: { type: 'string' }, reason: { type: 'string' }, 'no-open': { type: 'boolean' },
    port: { type: 'string' }, version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' }, list: { type: 'boolean' },
    'existing-session': { type: 'boolean' },
    since: { type: 'string' }, kind: { type: 'string' }, document: { type: 'string' }, json: { type: 'boolean' },
    ...SCREENSHOT_OPTIONS, ...CAPTURE_OPTIONS, ...CAMERA_OPTIONS,
  } });
  const [verb = 'edit', folder = '.'] = positionals;
  if (values.template && verb !== 'create') throw new Error('--template belongs to create.');
  if (values.list && verb !== 'eval') throw new Error('--list belongs to eval.');
  if (values['existing-session'] && verb !== 'blender-mcp') throw new Error('--existing-session belongs to blender-mcp.');
  for (const key of Object.keys(SCREENSHOT_OPTIONS) as (keyof typeof SCREENSHOT_OPTIONS)[])
    if (values[key] !== undefined && verb !== 'screenshot') throw new Error(`--${key} belongs to screenshot.`);
  for (const key of ['since', 'kind', 'json'] as const)
    if (values[key] !== undefined && verb !== 'play-log') throw new Error(`--${key} belongs to play-log.`);
  if (values.document !== undefined && verb !== 'play-log' && verb !== 'play') throw new Error('--document belongs to play-log and play.');
  for (const [owner, options] of [['capture', CAPTURE_OPTIONS], ['camera', CAMERA_OPTIONS]] as const)
    for (const key of Object.keys(options) as (keyof typeof options)[])
      // `--out` is also view build's: where the static view is written.
      if (values[key] !== undefined && verb !== owner && !(key === 'out' && verb === 'view')) throw new Error(`--${key} belongs to ${owner}.`);
  if (!values.help && !values.version && verb !== 'create' && verb !== 'upgrade') {
    // The project a verb acts on: the folder it names, or the one around the working directory —
    // and for `open <path>`, the project that owns that path as well, wherever this runs from.
    refuseRetired(['edit', 'add-play', 'prepare'].includes(verb) && positionals.length > 1 ? folder : process.cwd());
    if (verb === 'open' && positionals[1] !== undefined) refuseRetired(positionals[1]);
  }
  if (values.version) {
    console.log(verb === 'blender-mcp' ? `BlenderMCP ${(await import('@volter/editor-blender/mcp')).BLENDER_MCP_VERSION}` : productPackage.version);
  } else if (values.help) {
    console.log(`Volter Cyclotron\n  cyclotron                 # open this project, or prepare your starter model\n  cyclotron create <folder> [--template models|playable] [--workbench <dir>]\n  cyclotron ${ADD_PLAY_USAGE}\n  cyclotron ${UPGRADE_USAGE}\n  cyclotron prepare [folder]    # run the session's dependency optimizer ahead of time (an image build's step)\n  cyclotron edit [folder] [--workbench <dir>] [--no-open] [--port <n>]\n  cyclotron ${CHAT_USAGE}\n  cyclotron status | console | close    # exit 1 for an unresolved console error; warnings print, exit 0\n  cyclotron console ack <id> --reason <text>\n  cyclotron eval <JavaScript> | --list\n  cyclotron ${PLAY_LOG_USAGE}    # what the running model play script logged\n  cyclotron ${SCREENSHOT_USAGE}\n  cyclotron ${CAPTURE_USAGE}    # the editor as seen, to .volter/captures/ by default\n  cyclotron ${CAMERA_USAGE}\n  cyclotron ${PLAY_USAGE}    # the Game panel's controls\n  cyclotron ${VIEW_BUILD_USAGE}    # a static limited view of the project (docs/LIMITED-VIEW.md)
  cyclotron ${HOSTED_USAGE}\n  cyclotron sessions | project | projects\n  cyclotron open <path>\n  cyclotron blender-mcp [--existing-session]    # stdio MCP; optionally refuse editor startup`);
  } else if (verb === 'play') {
    console.log(JSON.stringify(await play(positionals.slice(1), values.document), null, 2));
  } else if (verb === 'chat') {
    console.log(JSON.stringify(await chat(positionals.slice(1)), null, 2));
  } else if (verb === 'view') {
    if (positionals[1] !== 'build' || positionals.length > 3) throw new Error(`Usage: volter-model-editor ${VIEW_BUILD_USAGE}`);
    await viewBuild(positionals[2] ?? '.', PRODUCT, {
      ...(values.out ? { out: values.out } : {}),
      ...(values.workbench ? { workbench: values.workbench } : {}),
    });
  } else if (verb === 'hosted') {
    await hostedControl(PRODUCT.command, positionals.slice(1));
  } else if (verb === 'blender-mcp') {
    if (positionals.length !== 1) throw new Error('Usage: cyclotron blender-mcp');
    let project = resolve(process.cwd());
    while (!hasManifest(project)) {
      const parent = dirname(project);
      if (parent === project) throw new Error('Run cyclotron blender-mcp inside a modeling project.');
      project = parent;
    }
    const { serveBlenderMcp } = await import('@volter/editor-blender/mcp');
    // MCP must answer initialization immediately. Only a scene request opens
    // an editor; launcher output goes to stderr so stdout remains JSON-RPC.
    await serveBlenderMcp(project, async () => {
      const { resolveSession } = await import('@volter/editor-live');
      if (values['existing-session']) {
        // Propagate attachment failures without the ordinary lazy editor launch.
        await resolveSession(project);
        return;
      }
      try { await resolveSession(project); return; } catch { /* launch diagnoses stale sessions */ }
      await new Promise<void>((done, fail) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'edit', project], {
          windowsHide: true,
          cwd: project, stdio: ['ignore', 2, 2], env: process.env,
        });
        child.once('error', fail);
        child.once('close', code => code === 0 ? done() : fail(new Error(`Blender editor startup exited with code ${code}`)));
      });
    }, PRODUCT.command);
  } else if (verb === 'play-log') {
    if (positionals.length > 1) throw new Error(`Usage: cyclotron ${PLAY_LOG_USAGE}`);
    await playLog(values);
  } else if (verb === 'add-play') {
    if (positionals.length > 2) throw new Error(`Usage: cyclotron ${ADD_PLAY_USAGE}`);
    await addPlay(folder);
  } else if (verb === 'upgrade') {
    if (positionals.length > 2) throw new Error(`Usage: cyclotron ${UPGRADE_USAGE}`);
    await upgradeProject(UPGRADING, positionals[1]);
  } else if (verb === 'camera') {
    if (positionals.length > 1) throw new Error(`Usage: cyclotron ${CAMERA_USAGE}`);
    await camera(values);
  } else if (verb === 'capture') {
    if (positionals.length > 1) throw new Error(`Usage: cyclotron ${CAPTURE_USAGE}`);
    await capture(values);
  } else if (verb === 'screenshot') {
    if (positionals.length > 2) throw new Error(`Usage: cyclotron ${SCREENSHOT_USAGE}`);
    await screenshot(positionals[1], values);
  } else if (verb === 'sessions' || verb === 'project' || verb === 'projects') {
    if (positionals.length > 1) throw new Error(`Usage: cyclotron ${verb}`);
    await (verb === 'sessions' ? listSessions() : verb === 'project' ? showProject() : listRecentProjects());
  } else if (verb === 'prepare') {
    if (positionals.length > 2) throw new Error('Usage: cyclotron prepare [folder]');
    await prepareSession(folder, PRODUCT);
  } else if (verb === 'open') {
    if (positionals.length !== 2) throw new Error('Usage: cyclotron open <path>');
    await openProject(positionals[1]!, PRODUCT.command);
  } else if (verb === 'console' && positionals[1] === 'ack') {
    if (positionals.length !== 3 || !values.reason?.trim()) throw new Error('Usage: cyclotron console ack <id> --reason <text>');
    await control(PRODUCT.command, 'console-ack', positionals[2], values.reason);
  } else if (['status', 'console', 'eval', 'close'].includes(verb)) {
    if (positionals.length > (verb === 'eval' ? 2 : 1)) throw new Error('Unexpected arguments.');
    await control(PRODUCT.command, verb, values.list ? '--list' : positionals[1]);
  } else {
    if (positionals.length > 2) throw new Error('Unexpected positional arguments.');
    if (verb !== 'create' && verb !== 'edit') throw new Error(`Unknown command: ${verb}`);
    if (verb === 'create') {
      if (!positionals[1]) throw new Error('create requires a new folder name.');
      if (values.workbench) resolveWorkbench(resolve(values.workbench), PRODUCT.id);
      console.log(`Creating Cyclotron project at ${resolve(folder)}…`);
      await declaration.create({ name: folder.split(/[\\/]/).at(-1)!, targetDir: resolve(folder), ...(values.template ? { template: values.template } : {}) });
      if (values.workbench) writeWorkbenchDeclaration(resolve(folder), resolve(values.workbench));

    }
    const project = verb === 'edit' && positionals.length < 2 ? await startupProject(declaration.create) : folder;
    console.log(`Opening Cyclotron for ${resolve(project)}…`);
    await launch(project, PRODUCT, {
      ...(values.workbench ? { workbench: values.workbench } : {}),
      ...(values['no-open'] ? { noOpen: true } : {}),
      ...(values.port ? { port: Number(values.port) } : {}),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
