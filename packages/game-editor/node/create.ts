/**
 * THE GAME EDITOR'S `create` — the presets this product offers, and the rule
 * that turns one into a project's own declarations.
 *
 * CREATION IS THE PRODUCT'S: the scaffolder (`./scaffold/`) owns the template,
 * the additions and every rewrite; WHICH additions `--template game` means,
 * what a game project declares beside this product, and which layout and
 * Inspector it opens in are this file's, because they are facts about what
 * this product is FOR.
 *
 * Read by the product's own `bin` (`volter-game-editor create`) and, through
 * `presets.mjs`, by the editor server's New Project route.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductCreateDeclaration, ProductCreateRequest, ProductCreateResult } from '@volter/editor-sdk/session/product-create';
import { closeAdditions, type ScaffoldAddition } from './scaffold/additions';
import { assertScaffoldComposition, type ProductCreateDeclaration as ScaffoldPresets } from './scaffold/product';
import { linkCheckoutPackages, repinEngineAfterInstall, scaffoldProject, type ScaffoldResult } from './scaffold/scaffold';
import { initGitRepo } from './scaffold/git-init';
import { loadTemplateRegistry } from './scaffold/templates';

export const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT = '@volter/game-editor';

export const presets: ScaffoldPresets = {
  product: PRODUCT,

  // Listed most-wanted first: this order IS the `--template` line in
  // `volter-game-editor --help`.
  templates: {
    // NOTHING PRESELECTED MAY ERROR. `studio` brings three stub contributions
    // that THROW on render, so a fresh `game` scaffold could never reach the
    // silent console the agent contract requires; they are an author's TODO
    // from the moment the author ASKS for those panels (`--with studio`, or
    // `--template full`).
    game: { additions: ['three', 'server', 'blender'] },
    /** A 3D world and its models: the smallest thing that plays. */
    prototype: { additions: ['three', 'blender'] },
    // EVERY addition in one project — the composition acceptance made
    // permanent. Check it against `SCAFFOLD_ADDITIONS` (./scaffold/additions.ts)
    // when the scaffolder grows one.
    full: { additions: ['three', 'ui', 'server', 'blender', 'studio'] },
    /** The design skew: a React root and no 3D world. */
    website: { additions: ['ui'] },
    /** Nothing but the project — the shape an author adds to. */
    empty: { additions: [] },
  },

  defaultTemplate: 'empty',

  examples: true,

  compose(additions) {
    const three = additions.has('three');
    const studio = additions.has('studio');
    // The editor's own layouts come from the SDK; a package's layout would
    // come from that package.
    const layouts = '@volter/editor-sdk/layouts';
    const design = additions.has('ui') && !three;
    return {
      // THE PRODUCT THIS PROJECT OPENS IN, and the 3D lane beside it:
      // `@volter/editor-game` is the 3D world's lane, and a project with no 3D
      // root has nothing for Play, the Game workspace or the instruments over
      // a running game to run.
      editorPackages: [PRODUCT, ...(three ? ['@volter/editor-game'] : [])],
      editor: {
        layout: { name: design ? 'DesignLayout' : studio ? 'StudioLayout' : 'GameLayout', from: layouts },
        inspector: studio ? 'column' : 'card',
      },
    };
  },
};

/** The directory whose `node_modules` resolves this product's packages: the
 *  repository root in a checkout, the installation root otherwise. */
export function installRoot(): string {
  for (let dir = productRoot; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', '@volter', 'editor-project', 'package.json'))) return dir;
    if (dirname(dir) === dir) throw new Error(`Cannot scaffold: @volter/editor-project is not installed above ${productRoot}.`);
  }
}

export interface GameCreateRequest extends ProductCreateRequest {
  /** Additions beyond the template's own (`--with`). */
  additions?: readonly ScaffoldAddition[];
}

/** Write the project's files; no install. */
export function writeProject({ name, targetDir, template, additions = [] }: GameCreateRequest): ScaffoldResult {
  if (!name.trim()) throw new Error('A project name is required.');
  const id = template ?? presets.defaultTemplate;
  const preset = presets.templates[id];
  if (!preset) throw new Error(`--template must be one of: ${Object.keys(presets.templates).join(', ')}`);
  const closed = new Set<ScaffoldAddition>(closeAdditions([...preset.additions, ...additions]));
  const composition = assertScaffoldComposition(presets.compose(closed), 'node/create.ts', PRODUCT);
  return scaffoldProject({
    name,
    targetDir: resolve(targetDir),
    monoRoot: installRoot(),
    productDir: productRoot,
    additions: [...closed],
    composition,
  });
}

/** Scaffold, install, point a checkout's packages at the checkout, re-pin, and start history. */
export async function createGameProject(request: GameCreateRequest): Promise<ProductCreateResult> {
  const result = writeProject(request);
  await new Promise<void>((done, fail) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: result.targetDir, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', code => code === 0 ? done() : fail(new Error(`Dependency installation failed (${code}); project source remains at ${result.targetDir}.`)));
  });
  const linked = linkCheckoutPackages(result.targetDir, installRoot());
  if (linked.packages.length > 0) console.error(`Linked this checkout's ${linked.packages.join(', ')} into the project.`);
  repinEngineAfterInstall(result.targetDir);
  console.error(initGitRepo(result.targetDir, request.name).notice);
  return { targetDir: result.targetDir, manifest: result.manifest };
}

const registry = new Map(loadTemplateRegistry().templates.map(entry => [entry.id, entry]));

export const declaration: ProductCreateDeclaration = {
  product: PRODUCT,
  templates: Object.keys(presets.templates).map(id => {
    const entry = registry.get(id);
    if (!entry) throw new Error(`templates.json has no entry for preset "${id}".`);
    return { id, name: entry.title, description: entry.description };
  }),
  create: request => createGameProject(request),
};
