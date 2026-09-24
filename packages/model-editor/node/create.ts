/** The modeling composition belongs to this product, including its starter files. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameManifestSchema } from '@volter/editor-project/manifest/schema';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import type { ProductCreateDeclaration } from '@volter/editor-sdk/session/product-create';

const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const declaration: ProductCreateDeclaration = {
  product: '@volter/model-editor',
  templates: [{ id: 'models', name: 'Models', description: 'Blender modeling with a starter cube.' }],
  async create(request) {
    const result = await writeProject(request);
    await new Promise<void>((done, fail) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: result.targetDir, stdio: 'inherit' });
      child.once('error', fail);
      child.once('exit', code => code === 0 ? done() : fail(new Error(`Dependency installation failed (${code}); project source remains at ${result.targetDir}.`)));
    });
    return result;
  },
};

export async function writeProject({ name, targetDir, template }: Parameters<ProductCreateDeclaration['create']>[0]) {
    if (template !== undefined && template !== 'models') throw new Error('The model editor creates modeling projects.');
    if (!name.trim()) throw new Error('A project name is required.');
    const target = resolve(targetDir);
    const product = JSON.parse(await readFile(join(productRoot, 'package.json'), 'utf8'));
    const manifest = GameManifestSchema.parse({
      manifestVersion: 2, name, version: '0.1.0',
      engine: { version: product.version }, roots: [],
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
      devDependencies: {
        '@volter/model-editor': product.version,
        '@volter/editor-project': product.version,
        '@volter/editor-blender': product.dependencies['@volter/editor-blender'],
      },
    }, null, 2) + '\n');
    await write('vgai.adapter.ts', `import { defineAdapter } from '@volter/editor-project/adapter/adapter-module';
import { ModelLayout } from '@volter/editor-blender/layouts';
import { blenderStyle, blenderKeymap } from '@volter/editor-blender/looks';

export default defineAdapter({
  editor: { Layout: ModelLayout, style: blenderStyle, keymap: blenderKeymap, inspector: 'properties' },
  documents: { find: [{ finder: 'modelsFromBlendFiles', include: ['src/models/**/*.blend'] }] },
});
`);
    // THE PROJECT NAMES ITS AGENT'S SERVERS, as every scaffolded project does
    // (editor-core's project-mcp-servers.ts reads this file into the Chat's runtime,
    // and a person's own Claude Code reads it by hand). Through the package script,
    // as the game template does, so the command is the project's own install.
    await write('.mcp.json', JSON.stringify({
      mcpServers: { blender: { command: 'npm', args: ['run', '--silent', 'volter-model-editor', '--', 'blender-mcp'] } },
    }, null, 2) + '\n');
    await write('.gitignore', 'node_modules/\n.vgai/\nlogs/\n');
    for (const file of ['cube.blend', 'cube.py']) {
      await copyFile(join(productRoot, 'starter', file), join(target, 'src/models', file));
    }
    return { targetDir: target, manifest };
}
