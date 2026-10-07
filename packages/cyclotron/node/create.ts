/** The modeling composition belongs to this product, including its starter files. */
import { spawn } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameManifestSchema } from '@volter/editor-project/manifest/schema';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import type { ProductCreateDeclaration } from '@volter/editor-sdk/session/product-create';
import type { UpgradingProduct } from '@volter/editor-sdk/session/project-upgrade';
import productPackage from '../package.json';

export const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * WHO UPGRADES A PROJECT, and the name this product replaced (owner decision D235). Nothing
 * publishes that name any more, so a project that still declares it is moved here by
 * `npx @volter/cyclotron upgrade`, and every other verb refuses it with that line.
 */
export const UPGRADING: UpgradingProduct = {
  packageName: productPackage.name,
  command: Object.keys(productPackage.bin)[0]!,
  dir: productRoot,
  replaces: [{
    packageName: '@volter/model-editor',
    command: 'volter-model-editor',
    names: [['Volter Model Editor', 'Volter Cyclotron'], ['Model Editor', 'Cyclotron']],
  }],
};

/**
 * WHAT "PLAYABLE" ADDS TO A MODELS PROJECT, declared once. `writeProject`'s
 * `playable` template scaffolds from it, and `add-play` (`add-play.ts`) merges
 * the same rows into a project that started as `models` — so a project made
 * playable later declares exactly what one created playable does, and a change
 * to the template (a React bump, a second root) reaches both doors at once.
 *
 * The example is ONE SET, not seven files: `track.play.ts` drives the objects
 * `track.blend` names (`Cube`, `Track`, the wheels), publishes `race-state.ts`,
 * and `src/ui/game.tsx` — the manifest root's entry — reads that state.
 */
export const PLAYABLE = {
  uiRoot: { id: 'ui', adapter: 'dom', entry: 'src/ui/game.tsx', zOrder: 1 },
  resolution: { width: 1280, height: 720 },
  dependencies: { react: '~19.2.4', 'react-dom': '~19.2.4', three: '^0.180.0' } as Record<string, string>,
  /** The kit packages Play and the DOM root need, at the kit version this product was released against. */
  devDependencies: (kit: string): Record<string, string> => ({ '@volter/editor-model-play': kit, '@volter/editor-ui': kit, '@volter/editor-react': kit }),
  /** The adapter line that lets the UI board discover `src/ui` stories. */
  regionIncludes: "  regionIncludes: { ui: { include: ['src/ui/**/*.tsx'] } },\n",
  defaultDocument: 'model:src/models/track.blend',
  /** Starter file → project path. */
  example: [
    ['track.blend', 'src/models/track.blend'], ['track.py', 'src/models/track.py'],
    ['track.play.ts', 'src/models/track.play.ts'], ['race-state.ts', 'src/models/race-state.ts'],
    ['ui/game.tsx', 'src/ui/game.tsx'], ['ui/race-hud.tsx', 'src/ui/race-hud.tsx'], ['ui/game.stories.tsx', 'src/ui/game.stories.tsx'],
  ] as const,
} as const;

/** The compiler configuration every Cyclotron project starts with (see `writeProject`). */
export const PROJECT_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    jsx: 'react-jsx', resolveJsonModule: true, esModuleInterop: true,
    strict: true, skipLibCheck: true, noEmit: true,
  },
  include: ['src/**/*.ts', 'src/**/*.tsx'],
}, null, 2) + '\n';

/** This product's own release and the kit version its projects install beside it. The kit a
 *  project installs is the version this product was released against. The engine it pins is
 *  editor-core's: that is the version the editor reports as running. */
export async function productVersions(): Promise<{ product: { version: string; dependencies: Record<string, string> }; kit: string }> {
  const product = JSON.parse(await readFile(join(productRoot, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
  return { product, kit: product.dependencies['@volter/editor-project']! };
}

export const declaration: ProductCreateDeclaration = {
  product: '@volter/cyclotron',
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
      symlinkSync(checkout, join(result.targetDir, 'node_modules'), 'junction');
      return result;
    }
    console.log("Installing project dependencies…");
    await new Promise<void>((done, fail) => {
      // npm is npm.cmd on Windows, and node refuses to spawn a .cmd without a shell (EINVAL). Through the shell the
      // command goes as one string: arguments beside shell: true print Node 24's DEP0190 warning in a new user's
      // first install.
      const windows = process.platform === 'win32';
      const child = windows
        ? spawn('npm install', { windowsHide: true, cwd: result.targetDir, stdio: 'inherit', shell: true })
        : spawn('npm', ['install'], { windowsHide: true, cwd: result.targetDir, stdio: 'inherit' });
      child.once('error', fail);
      child.once('exit', code => code === 0 ? done() : fail(new Error(`Dependency installation failed (${code}); project source remains at ${result.targetDir}.`)));
    });
    return result;
  },
};

/** The checkout root's `node_modules` when this product runs from a checkout. */
function checkoutNodeModules(): string | null {
  for (let dir = productRoot; dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, 'packages', 'cyclotron', 'package.json'))) {
      const nodeModules = join(dir, 'node_modules');
      return existsSync(join(nodeModules, '@volter', 'editor-project', 'package.json')) ? nodeModules : null;
    }
  }
  return null;
}

export async function writeProject({ name, targetDir, template }: Parameters<ProductCreateDeclaration['create']>[0]) {
    if (template !== undefined && !['models', 'playable'].includes(template)) throw new Error('Unknown Cyclotron template.');
    const playable = template === 'playable';
    if (!name.trim()) throw new Error('A project name is required.');
    const target = resolve(targetDir);
    const { product, kit } = await productVersions();
    const manifest = GameManifestSchema.parse({
      manifestVersion: 2, name, version: '0.1.0',
      engine: { version: product.dependencies['@volter/editor-core'] },
      roots: playable ? [PLAYABLE.uiRoot] : [],
      ...(playable ? { resolution: PLAYABLE.resolution } : {}),
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
      scripts: { dev: 'cyclotron edit .', cyclotron: 'cyclotron' },
      // The two install scripts the editor's tree runs, reviewed: npm 11 lists unreviewed ones in a new user's first
      // install ("not yet covered by allowScripts") and a later npm blocks them. The entries are npm's own
      // name-only form (`npm approve-scripts --no-allow-scripts-pin`).
      allowScripts: { esbuild: true, 'msgpackr-extract': true },
      ...(playable ? { dependencies: PLAYABLE.dependencies } : {}),
      devDependencies: {
        '@volter/cyclotron': product.version,
        '@volter/editor-project': kit,
        '@volter/editor-blender': product.dependencies['@volter/editor-blender'],
        ...(playable ? PLAYABLE.devDependencies(kit) : {}),
      },
    }, null, 2) + '\n');
    // Source authoring can grow from a model into Play and React UI. Create the
    // shared compiler configuration before Vite starts, so the first check does
    // not have to create a tsconfig and reload the person's live editor.
    await write('tsconfig.json', PROJECT_TSCONFIG);
    await write('volter.adapter.ts', `import { defineAdapter } from '@volter/editor-project/adapter/adapter-module';
import { ModelLayout } from '@volter/editor-blender/layouts';
import { blenderStyle, blenderKeymap } from '@volter/editor-blender/looks';

export default defineAdapter({
${playable ? PLAYABLE.regionIncludes : ''}  editor: { Layout: ModelLayout, style: blenderStyle, keymap: blenderKeymap, inspector: 'properties' },
  documents: { default: '${playable ? PLAYABLE.defaultDocument : 'model:src/models/cube.blend'}', find: [{ finder: 'modelsFromBlendFiles', include: ['src/models/**/*.blend'] }] },
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
      "const manifest = require.resolve('@volter/cyclotron/package.json');",
      "const cli = resolve(dirname(manifest), require(manifest).bin['cyclotron']);",
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
    for (const file of ['AGENTS.md', 'CLAUDE.md'])
      await copyFile(join(productRoot, 'starter', file), join(target, file));
    if (playable) {
      await mkdir(join(target, 'src/ui'));
      for (const [from, to] of PLAYABLE.example) await copyFile(join(productRoot, 'starter', from), join(target, to));
    } else {
      for (const file of ['cube.blend', 'cube.py'])
        await copyFile(join(productRoot, 'starter', file), join(target, 'src/models', file));
    }
    return { targetDir: target, manifest };
}
