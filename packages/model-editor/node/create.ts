/** The modeling composition belongs to this product, including its starter files. */
import { spawn } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameManifestSchema } from '@volter/editor-project/manifest/schema';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import type { ProductCreateDeclaration } from '@volter/editor-sdk/session/product-create';

const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const declaration: ProductCreateDeclaration = {
  product: '@volter/model-editor',
  templates: [
    { id: 'models', name: 'Models', description: 'Blender modeling with a starter cube.' },
    { id: 'playable', name: 'Playable', description: 'A cube circuit with a model play script and React HUD.' },
  ],
  async create(request) {
    const result = await writeProject(request);
    // A CHECKOUT'S PROJECT LINKS THE CHECKOUT'S OWN INSTALL, as a game links
    // its runtime image (`@volter/game-editor`'s runtime-image.ts): these
    // packages are not in any registry a checkout could install from.
    const checkout = checkoutNodeModules();
    if (checkout) {
      symlinkSync(checkout, join(result.targetDir, 'node_modules'), 'dir');
      return result;
    }
    console.log("Installing project dependencies…");
    await new Promise<void>((done, fail) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: result.targetDir, stdio: 'inherit' });
      child.once('error', fail);
      child.once('exit', code => code === 0 ? done() : fail(new Error(`Dependency installation failed (${code}); project source remains at ${result.targetDir}.`)));
    });
    return result;
  },
};

/** The checkout root's `node_modules` when this product runs from a checkout. */
function checkoutNodeModules(): string | null {
  for (let dir = productRoot; dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, 'packages', 'model-editor', 'package.json'))) {
      const nodeModules = join(dir, 'node_modules');
      return existsSync(join(nodeModules, '@volter', 'editor-project', 'package.json')) ? nodeModules : null;
    }
  }
  return null;
}

export async function writeProject({ name, targetDir, template }: Parameters<ProductCreateDeclaration['create']>[0]) {
    if (template !== undefined && !['models', 'playable'].includes(template)) throw new Error('Unknown Model Editor template.');
    const playable = template === 'playable';
    if (!name.trim()) throw new Error('A project name is required.');
    const target = resolve(targetDir);
    const product = JSON.parse(await readFile(join(productRoot, 'package.json'), 'utf8'));
    // The kit a project installs is the version this product was released against. The engine
    // it pins is editor-core's: that is the version the editor reports as running.
    const kit = product.dependencies['@volter/editor-project'];
    const manifest = GameManifestSchema.parse({
      manifestVersion: 2, name, version: '0.1.0',
      engine: { version: product.dependencies['@volter/editor-core'] },
      roots: playable ? [{ id: 'ui', adapter: 'dom', entry: 'src/ui/game.tsx', zOrder: 1 }] : [],
      ...(playable ? { resolution: { width: 1280, height: 720 } } : {}),
    });
    // Exclusive mkdir refuses even an existing empty directory. Creation never
    // overwrites an author's files, and a failed install leaves source intact.
    await mkdir(dirname(target), { recursive: true });
    await mkdir(target);
    await mkdir(join(target, 'src/models'), { recursive: true });
    const write = (path: string, content: string) => writeFile(join(target, path), content, { flag: 'wx' });
    await write(MANIFEST_FILENAME, JSON.stringify(manifest, null, 2) + '\n');
    await write('package.json', JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'models',
      private: true, version: '0.1.0', type: 'module',
      scripts: { dev: 'volter-model-editor edit .', 'volter-model-editor': 'volter-model-editor' },
      ...(playable ? { dependencies: { react: '~19.2.4', 'react-dom': '~19.2.4', three: '^0.180.0' } } : {}),
      devDependencies: {
        '@volter/model-editor': product.version,
        '@volter/editor-project': kit,
        '@volter/editor-blender': product.dependencies['@volter/editor-blender'],
        ...(playable ? { '@volter/editor-model-play': kit, '@volter/editor-ui': kit, '@volter/editor-react': kit } : {}),
      },
    }, null, 2) + '\n');
    await write('volter.adapter.ts', `import { defineAdapter } from '@volter/editor-project/adapter/adapter-module';
import { ModelLayout } from '@volter/editor-blender/layouts';
import { blenderStyle, blenderKeymap } from '@volter/editor-blender/looks';

export default defineAdapter({
${playable ? "  regionIncludes: { ui: { include: ['src/ui/**/*.tsx'] } },\n" : ''}  editor: { Layout: ModelLayout, style: blenderStyle, keymap: blenderKeymap, inspector: 'properties' },
  documents: { ${playable ? "default: 'model:src/models/track.blend', " : ''}find: [{ finder: 'modelsFromBlendFiles', include: ['src/models/**/*.blend'] }] },
});
`);
    // THE PROJECT NAMES ITS AGENT'S SERVERS, as every scaffolded project does
    // (editor-core's project-mcp-servers.ts reads this file into the Chat's runtime,
    // and a person's own Claude Code reads it by hand). Resolve the project's
    // package, then its public bin declaration: checkout-linked node_modules
    // need not have a .bin shim. Import in this process, without npm or a shell.
    const mcpEntry = [
      "const { dirname, resolve } = require('node:path');",
      "const { pathToFileURL } = require('node:url');",
      "const manifest = require.resolve('@volter/model-editor/package.json');",
      "const cli = resolve(dirname(manifest), require(manifest).bin['volter-model-editor']);",
      'process.argv.splice(1, 0, cli);',
      'import(pathToFileURL(cli).href);',
    ].join(' ');
    const blenderMcp = { command: 'node', args: ['--input-type=commonjs', '--eval', mcpEntry, '--', 'blender-mcp'] };
    await write('.mcp.json', JSON.stringify({ mcpServers: { blender: blenderMcp } }, null, 2) + '\n');
    // Codex reads project configuration after the person trusts the folder.
    // Both clients launch exactly the same transport; no global config is changed.
    await mkdir(join(target, '.codex'));
    await write('.codex/config.toml', [
      '[mcp_servers.blender]',
      `command = ${JSON.stringify(blenderMcp.command)}`,
      `args = [${blenderMcp.args.map(arg => JSON.stringify(arg)).join(', ')}]`,
      '',
    ].join('\n'));
    await write('.gitignore', 'node_modules\n.volter/\nlogs/\n');
    if (playable) {
      for (const file of ['track.blend', 'track.py', 'track.play.ts', 'race-state.ts'])
        await copyFile(join(productRoot, 'starter', file), join(target, 'src/models', file));
      await mkdir(join(target, 'src/ui'));
      for (const file of ['game.tsx', 'race-hud.tsx', 'game.stories.tsx'])
        await copyFile(join(productRoot, 'starter/ui', file), join(target, 'src/ui', file));
    } else {
      for (const file of ['cube.blend', 'cube.py'])
        await copyFile(join(productRoot, 'starter', file), join(target, 'src/models', file));
    }
    return { targetDir: target, manifest };
}
