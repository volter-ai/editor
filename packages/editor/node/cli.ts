#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasManifest } from '@volter/editor-project/manifest/locate';
import productPackage from '../package.json';
import { declaration } from './create';
import { launch, type LaunchingProduct } from '@volter/editor-core/server/launcher/launch';
import { control } from '@volter/editor-core/server/launcher/control';
import { resolveWorkbench, writeWorkbenchDeclaration } from '@volter/editor-sdk/session/workbench-locator';

const PRODUCT: LaunchingProduct = { packageName: '@volter/editor', id: 'editor', displayName: 'Volter Editor', command: 'volter-editor' };

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    workbench: { type: 'string' }, reason: { type: 'string' }, 'no-open': { type: 'boolean' },
    port: { type: 'string' }, version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
  } });
  const [verb = 'edit', folder = '.'] = positionals;
  if (values.version) {
    console.log(verb === 'blender-mcp' ? `BlenderMCP ${(await import('./blender-mcp')).BLENDER_MCP_VERSION}` : productPackage.version);
  } else if (values.help) {
    console.log('Volter Editor\n  volter-editor create <folder> [--workbench <dir>]\n  volter-editor edit [folder] [--workbench <dir>] [--no-open] [--port <n>]\n  volter-editor status | console | close\n  volter-editor console ack <id> --reason <text>\n  volter-editor eval <JavaScript body>\n  volter-editor blender-mcp    # stdio MCP transport to Blender in the editor');
  } else if (verb === 'blender-mcp') {
    if (positionals.length !== 1) throw new Error('Usage: volter-editor blender-mcp');
    let project = resolve(process.cwd());
    while (!hasManifest(project)) {
      const parent = dirname(project);
      if (parent === project) throw new Error('Run volter-editor blender-mcp inside a modeling project.');
      project = parent;
    }
    const { serveBlenderMcp } = await import('./blender-mcp');
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
    });
  } else if (verb === 'console' && positionals[1] === 'ack') {
    if (positionals.length !== 3 || !values.reason?.trim()) throw new Error('Usage: volter-editor console ack <id> --reason <text>');
    await control(PRODUCT.command, 'console-ack', positionals[2], values.reason);
  } else if (['status', 'console', 'eval', 'close'].includes(verb)) {
    if (positionals.length > (verb === 'eval' ? 2 : 1)) throw new Error('Unexpected arguments.');
    await control(PRODUCT.command, verb, positionals[1]);
  } else {
    if (positionals.length > 2) throw new Error('Unexpected positional arguments.');
    if (verb !== 'create' && verb !== 'edit') throw new Error(`Unknown command: ${verb}`);
    if (verb === 'create') {
      if (!positionals[1]) throw new Error('create requires a new folder name.');
      if (values.workbench) resolveWorkbench(resolve(values.workbench), 'editor');
      await declaration.create({ name: folder.split(/[\\/]/).at(-1)!, targetDir: resolve(folder) });
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
