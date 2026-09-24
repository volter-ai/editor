/**
 * WHICH PRODUCT THIS SESSION IS SERVING — the session's half of the resolution
 * the CLI already did.
 *
 * `vgai edit` resolves the product from the project's own dependencies
 * (`@volter/editor-sdk/session/product-locator`) so a bad or missing declaration
 * is named before a server exists, then hands the directory over in
 * `VGAI_PRODUCT_DIR`, beside `VGAI_WORKBENCH_DIR`. The session reads it back
 * for the two things only it can do: SERVE the product's entry through
 * `/__editor/served-modules`, and REPORT it (`EditorState.product`, printed by
 * `vgai status` on the workbench's line) — a process reports what it is running.
 *
 * A session started without the variable resolves from the project itself
 * rather than guessing, so `npx tsx packages/editor/server/dev.ts` by hand
 * behaves the same as a CLI launch and fails with the same sentence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  productComposedPackages as composedPackages,
  type ProductIdentity,
  readProductManifest,
  resolveProductForProject,
} from '@volter/editor-sdk/session/product-locator';

/** The product directory the CLI resolved and handed over. */
export const PRODUCT_DIR_ENV = 'VGAI_PRODUCT_DIR';

/**
 * The product this session serves, or `null` when there is none to find — a
 * session with no project open yet, or one whose project declares none. The
 * served-modules door turns that `null` into its own refusal, naming the
 * install line, rather than serving nothing silently.
 */
export function sessionProduct(projectPath: string | null): ProductIdentity | null {
  const handed = process.env[PRODUCT_DIR_ENV];
  if (handed !== undefined && handed !== '' && existsSync(handed)) {
    const product = readProductManifest(handed);
    if (product !== null) return product;
  }
  if (projectPath === null) return null;
  try {
    return resolveProductForProject(projectPath);
  } catch {
    // The refusal belongs to the door that was asked, not to this read: the CLI
    // already prints it at launch, and `served-modules` prints it to the frame.
    return null;
  }
}

/** `resolveProductForProject` — the same resolution, refusal and all, for the
 *  door that must say why. `productComposedPackages` — what that product
 *  mounts, read through the manifest mirror the estate gate keeps equal to the
 *  composition in its entry. */
export {
  productComposedPackages,
  resolveProductForProject,
} from '@volter/editor-sdk/session/product-locator';

/**
 * EVERY CONTRIBUTION MODULE THE PRODUCT COMPOSES, as absolute files — what
 * Vite's dependency crawl has to be HANDED, because it cannot walk to them.
 *
 * The product names a package as `vgai:contributions/<name>`, and that module
 * is synthesized (`vite-plugin-product-contributions.ts`): it hangs off no file
 * on disk, so `optimizeDeps`' esbuild scanner never reaches the `import()` rows
 * inside it. `vite-plugin-module-doorways.ts`'s header records the same failure
 * class from the other synthesized module and the same cure — read the entries
 * out of the SAME declaration the browser is served, rather than letting the
 * optimizer discover them when a lane first mounts.
 *
 * MEASURED 2026-09-21 on a `--template game` scaffold, before this existed: the
 * boot pass prebundled the kit's own graph, the game editor's five packages
 * then dragged in `storybook/internal/preview-api`, `storybook/internal/csf`,
 * `@gltf-transform/{core,extensions,functions}` and `axe-core` as their
 * contributions loaded, and Vite answered with `optimized dependencies changed.
 * reloading` — a hard reload of the one tab, mid-boot, which drops the
 * session's editor and every command with it.
 */
export function productContributionFiles(product: ProductIdentity): string[] {
  const resolveFrom = createRequire(pathToFileURL(join(product.dir, 'package.json')));
  const files: string[] = [];
  for (const name of composedPackages(product)) {
    let manifestPath: string;
    try {
      manifestPath = resolveFrom.resolve(`${name}/package.json`);
    } catch {
      continue;
    }
    let declared: unknown;
    try {
      declared = (JSON.parse(readFileSync(manifestPath, 'utf8')) as ContributingManifest).vgai
        ?.contributions;
    } catch {
      continue;
    }
    if (!Array.isArray(declared)) continue;
    const dir = dirname(manifestPath);
    for (const entry of declared) {
      if (typeof entry !== 'string') continue;
      const file = join(dir, entry);
      if (existsSync(file)) files.push(file);
    }
  }
  return files;
}

interface ContributingManifest {
  vgai?: { contributions?: unknown; serving?: unknown };
}

/**
 * EVERY SERVING MODULE THE PRODUCT COMPOSES — each composed package's
 * `package.json#vgai.serving`, as an absolute file: the server half of an integration,
 * whose Vite plugins take part in serving the project's own modules
 * (`@volter/editor-sdk/session/project-serving`). Read from the same composition
 * {@link productContributionFiles} reads, so the kit names no package.
 */
export function productServingModules(product: ProductIdentity): string[] {
  const resolveFrom = createRequire(pathToFileURL(join(product.dir, 'package.json')));
  const files: string[] = [];
  for (const name of composedPackages(product)) {
    let manifestPath: string;
    try {
      manifestPath = resolveFrom.resolve(`${name}/package.json`);
    } catch {
      continue;
    }
    const declared = (JSON.parse(readFileSync(manifestPath, 'utf8')) as ContributingManifest).vgai
      ?.serving;
    if (declared === undefined) continue;
    if (typeof declared !== 'string') {
      throw new Error(`${name}'s package.json#vgai.serving must name one module file.`);
    }
    const file = join(dirname(manifestPath), declared);
    if (!existsSync(file)) {
      throw new Error(`${name} declares vgai.serving ${declared}, and ${file} does not exist. Build the package.`);
    }
    files.push(file);
  }
  return files;
}
