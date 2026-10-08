/**
 * `volter-game-editor upgrade [version]`: the kit's `upgrade` (`@volter/sdk/session/project-upgrade`) for a game,
 * then the game's runtime image. A game installs nothing of its own: its `node_modules` links the image of the
 * game editor's version (`runtime-image.ts`), so once the project names the new version, the image for that version
 * is installed (once per version) and the link moved to it. Before 0.5.204 the game editor had no `upgrade` at all,
 * and a game made before 0.5.203 had no way onto the renamed packages and the `editor/` folder.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import productPackage from '../package.json';
import { hasManifest } from '@volter/project/manifest/locate';
import { upgradeProject, type UpgradingProduct } from '@volter/sdk/session/project-upgrade';
import { productRoot } from './create';
import { ensureRuntimeImage, relinkRuntimeImage, usesRuntimeImage } from './runtime-image';

export const UPGRADING: UpgradingProduct = {
  packageName: productPackage.name,
  command: Object.keys(productPackage.bin)[0]!,
  dir: productRoot,
};

export async function upgradeGameProject(requested?: string, cwd = process.cwd()): Promise<void> {
  await upgradeProject(UPGRADING, requested, cwd);
  let project = resolve(cwd);
  while (!hasManifest(project)) {
    const parent = dirname(project);
    if (parent === project) return;
    project = parent;
  }
  // A game that installs its own dependencies (a real node_modules) keeps them; one linked to an image, or with none
  // (a create that stopped before it linked), is linked to the new version's image.
  if (existsSync(join(project, 'node_modules')) && !usesRuntimeImage(project)) return;
  const packagePath = join(project, 'package.json');
  if (!existsSync(packagePath)) return;
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const version = pkg.devDependencies?.[UPGRADING.packageName] ?? pkg.dependencies?.[UPGRADING.packageName];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return;
  const image = await ensureRuntimeImage(productRoot, version);
  if (relinkRuntimeImage(project, image)) console.log(`  + node_modules now links the ${version} runtime image (${image})`);
}
