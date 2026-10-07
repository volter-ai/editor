/** Opening the product without a folder gives the person a saved starter to work on. */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { hasManifest } from '@volter/editor-project/manifest/locate';
import type { ProductCreateDeclaration } from '@volter/editor-sdk/session/product-create';
import { declaredRetiredProduct, retiredProjectError } from '@volter/editor-sdk/session/project-upgrade';
import { UPGRADING } from './create';

export async function startupProject(
  create: ProductCreateDeclaration['create'],
  { cwd = process.cwd(), home = homedir() } = {},
): Promise<string> {
  // Running from a project (including a source subfolder) opens that project.
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    if (hasManifest(folder)) return folder;
    if (dirname(folder) === folder) break;
  }

  const parent = join(home, 'Documents', 'Volter Models');
  for (let number = 1; ; number++) {
    const name = `Untitled Model${number === 1 ? '' : ` ${number}`}`;
    const targetDir = join(parent, name);
    if (!existsSync(targetDir)) {
      console.log(`Creating your starter model at ${targetDir}…`);
      await create({ name, targetDir, template: 'models' });
      return targetDir;
    }
    // Reopen the starter with its edits intact. An unrelated folder is never
    // overwritten or turned into a project, even if it has the same name.
    if (!hasManifest(targetDir)) continue;
    // A starter made under the name this product replaced is the person's work: it is moved, by
    // them, never shadowed by a fresh "Untitled Model 2".
    const retired = declaredRetiredProduct(UPGRADING, targetDir);
    if (retired !== null) throw retiredProjectError(UPGRADING, retired, targetDir);
    const pkg = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8'));
    if (pkg.dependencies?.['@volter/cyclotron'] || pkg.devDependencies?.['@volter/cyclotron']) return targetDir;
  }
}
