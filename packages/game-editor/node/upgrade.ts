/**
 * `volter-game-editor upgrade [version]`: the kit's `upgrade` (`@volter/sdk/session/project-upgrade`) for a game,
 * then the game's runtime image. A game installs nothing of its own: its `node_modules` links the image of the
 * game editor's version (`runtime-image.ts`), so once the project names the new version, the image for that version
 * is installed (once per version) and the link moved to it. Before 0.5.204 the game editor had no `upgrade` at all,
 * and a game made before 0.5.203 had no way onto the renamed packages and the `editor/` folder.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import productPackage from '../package.json';
import { hasManifest } from '@volter/project/manifest/locate';
import { upgradeProject, type UpgradingProduct } from '@volter/sdk/session/project-upgrade';
import { productRoot } from './create';
import { ensureRuntimeImage, relinkRuntimeImage, usesRuntimeImage } from './runtime-image';
import { hashFile, SCAFFOLD_BASELINE_RELATIVE_PATH } from './scaffold/baseline';

export const UPGRADING: UpgradingProduct = {
  packageName: productPackage.name,
  command: Object.keys(productPackage.bin)[0]!,
  dir: productRoot,
};

/**
 * The product's own tooling the scaffold copied into a game, not the game itself: when the person never changed one
 * (its bytes still hash to the scaffold baseline's), an upgrade to this release replaces it with this release's
 * template copy. check-idioms.ts read `src/tools` and `src/contributions` until 0.5.203 moved them into `editor/`;
 * an older copy then checked nothing there and said nothing (t_0caa932a).
 */
const REFRESHED_TOOLING = ['check-idioms.ts'] as const;

function readBaseline(project: string): { path: string; raw: string; json: { files?: Record<string, string> } } | null {
  const path = join(project, SCAFFOLD_BASELINE_RELATIVE_PATH);
  try {
    const raw = readFileSync(path, 'utf8');
    return { path, raw, json: JSON.parse(raw) as { files?: Record<string, string> } };
  } catch {
    return null;
  }
}

/** Which tooling files are still the scaffold's, read BEFORE the kit's upgrade rewrites any of them. */
function untouchedTooling(project: string): string[] {
  const files = readBaseline(project)?.json.files ?? {};
  return REFRESHED_TOOLING.filter((name) => existsSync(join(project, name)) && files[name] === hashFile(join(project, name)));
}

/** Replace each untouched tooling file with this release's, and record its new hash in the baseline. */
function refreshTooling(project: string, untouched: readonly string[], target: string | undefined): void {
  if (target !== productPackage.version) return; // only the running release's template is in hand
  const baseline = readBaseline(project);
  let replaced = false;
  for (const name of REFRESHED_TOOLING) {
    const template = join(productRoot, 'template', name);
    const file = join(project, name);
    if (!existsSync(template) || !existsSync(file)) continue;
    if (!untouched.includes(name)) {
      if (readFileSync(template, 'utf8') !== readFileSync(file, 'utf8'))
        console.log(`${name} keeps your changes; this release's copy (it checks editor/) is ${template}.`);
      continue;
    }
    if (readFileSync(template, 'utf8') === readFileSync(file, 'utf8')) continue;
    copyFileSync(template, file);
    replaced = true;
    if (baseline?.json.files) baseline.json.files[name] = hashFile(file);
    console.log(`${name} is now this release's (it was the scaffold's, unchanged).`);
  }
  if (replaced && baseline?.json.files) {
    const indent = /^[{[]\r?\n([ \t]+)\S/.exec(baseline.raw)?.[1] ?? '  ';
    writeFileSync(baseline.path, JSON.stringify(baseline.json, null, indent) + '\n');
  }
}

export async function upgradeGameProject(requested?: string, cwd = process.cwd()): Promise<void> {
  let project: string | null = resolve(cwd);
  while (!hasManifest(project)) {
    const parent = dirname(project);
    if (parent === project) { project = null; break; }
    project = parent;
  }
  // A game that installs its own dependencies keeps them and is told to `npm install`; one linked to an image, or with
  // none (a create that stopped before it linked), is linked to the new version's image, and `npm install` there
  // would write into the image every game of that version shares. A game with no node_modules yet but its own
  // package-lock.json (one that installs its own, just cloned) installs its own too: `create` writes no lockfile
  // for a game on the image.
  const links = project !== null && (usesRuntimeImage(project)
    || (!existsSync(join(project, 'node_modules')) && !existsSync(join(project, 'package-lock.json'))));
  const untouched = project === null ? [] : untouchedTooling(project);
  await upgradeProject({ ...UPGRADING, linksNodeModules: links }, requested, cwd);
  if (project === null) return;
  const packagePath = join(project, 'package.json');
  if (!existsSync(packagePath)) return;
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const version = pkg.devDependencies?.[UPGRADING.packageName] ?? pkg.dependencies?.[UPGRADING.packageName];
  refreshTooling(project, untouched, version);
  if (!links) return;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.log(`The game's node_modules was not linked to a runtime image: package.json declares ${UPGRADING.packageName} as ${version ?? 'nothing'}, not one exact version. Name one (npx ${UPGRADING.packageName}@latest upgrade <version>), or run npm install for a game that installs its own dependencies.`);
    return;
  }
  const image = await ensureRuntimeImage(productRoot, version);
  if (relinkRuntimeImage(project, image)) console.log(`The game's node_modules now links the ${version} runtime image (${image}).`);
}
