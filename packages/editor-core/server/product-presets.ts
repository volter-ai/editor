/**
 * WHAT THIS SESSION'S PRODUCT CAN CREATE — the New Project screen's half of
 * the declaration a product's `bin` reads.
 *
 * CREATION IS THE PRODUCT'S (ARCHITECTURE-CORE §The target shape, rule 1): the
 * presets, their names and what a project declares live in
 * `<product>/presets.mjs`, never in the kit. The CLI reads that file when
 * a person types `<product> create`; this session reads the SAME file, of the
 * SAME product it is already serving, so the wizard and the command line
 * cannot offer different compositions.
 *
 * Plain ESM, dynamically imported: the declaration is a product's code, not a
 * config, and a running session must not compile it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProductCreateDeclaration, type ProductCreateDeclaration } from '@volter/editor-sdk/session/product-create';
import { sessionProduct } from './session-product';

/**
 * Where a product declares its presets, relative to its package root. Beside
 * `src/`, never inside it: `src/` is the product's FRAME entry — the one module
 * its workbench build compiles — and this declaration is read by Node, at the
 * command line and here, and compiled by nothing.
 */
export const PRODUCT_PRESETS_PATH = 'presets.mjs';

export interface ProductCreatePresets {
  readonly declaration: ProductCreateDeclaration;
  /** The file it came from — every refusal names it. */
  readonly source: string;
}

/**
 * The create declaration of the product this session serves, or `null` when
 * there is no product to ask (no project open, or a project that declares
 * none). A product that exists but ships no declaration THROWS: it is a broken
 * product, and a wizard silently offering nothing is how that stays unnoticed.
 */
export async function sessionCreatePresets(
  projectPath: string | null,
): Promise<ProductCreatePresets | null> {
  const product = sessionProduct(projectPath);
  if (product === null) return null;
  const source = join(product.dir, PRODUCT_PRESETS_PATH);
  if (!existsSync(source))
    throw new Error(
      `${product.name} declares no create presets (${source} is missing), so this session cannot ` +
        'create a project. A product owns its own compositions — see ' +
        '@volter/editor-sdk/session/product-create for its executable declaration.',
    );
  const module = (await import(pathToFileURL(source).href)) as { default?: unknown };
  return { declaration: assertProductCreateDeclaration(module.default, source), source };
}
