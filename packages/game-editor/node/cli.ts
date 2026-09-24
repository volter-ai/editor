#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import productPackage from '../package.json';
import { createGameProject, presets } from './create';
import { isScaffoldAddition, SCAFFOLD_ADDITIONS, type ScaffoldAddition } from './scaffold/additions';
import { launch, type LaunchingProduct } from '@volter/editor-core/server/launcher/launch';
import { control } from '@volter/editor-core/server/launcher/control';
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
  } });
  const [verb = 'edit', folder = '.'] = positionals;
  if (values.version) {
    console.log(productPackage.version);
  } else if (values.help) {
    console.log(`Volter Game Editor
  volter-game-editor create <folder> [--template ${Object.keys(presets.templates).join('|')}] [--with ${SCAFFOLD_ADDITIONS.join(',')}] [--workbench <dir>]
  volter-game-editor edit [folder] [--workbench <dir>] [--no-open] [--port <n>]
  volter-game-editor status | console | close
  volter-game-editor console ack <id> --reason <text>
  volter-game-editor eval <JavaScript body>
  volter-game-editor play | stop`);
  } else if (verb === 'console' && positionals[1] === 'ack') {
    if (positionals.length !== 3 || !values.reason?.trim()) throw new Error('Usage: volter-game-editor console ack <id> --reason <text>');
    await control(PRODUCT.command, 'console-ack', positionals[2], values.reason);
  } else if (['status', 'console', 'eval', 'close'].includes(verb)) {
    if (positionals.length > (verb === 'eval' ? 2 : 1)) throw new Error('Unexpected arguments.');
    await control(PRODUCT.command, verb, positionals[1]);
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
