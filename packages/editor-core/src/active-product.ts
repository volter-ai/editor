/**
 * WHICH PRODUCT THIS PAGE IS — set once, by the product's own entry module,
 * before anything mounts.
 *
 * A product is the last mile: thin code that stitches packages onto the kit and
 * holds only purpose-specific choices (ARCHITECTURE-CORE §The target shape).
 * `@vgai/game-editor` and `@vgai/model-editor` each have ONE source entry which
 * IS that product's frame entry, and the first thing it does is call
 * `product({ … })` (`frame/product.ts`), which lands here.
 *
 * THE KIT KNOWS NO PRODUCT BY NAME (rule 1). This module holds a record it was
 * HANDED and never a table of products; the two readers below ask it for a
 * default and fall back to their own when there is none, so the host still
 * stands up with no product at all (a Storybook page, a measurement of one
 * surface). What it is NOT is a switch on which product is open (rule 4): a
 * product is the running program, and this is that program telling the kit what
 * it composed, not the kit choosing between compositions.
 *
 * Its two readers, both defaults and both outranked by anything the person or
 * the project said:
 *   - `workspace-style.ts` resolves {@link ActiveProduct.look} to a style
 *     bundle and makes its palette/material/icons the editor's DEFAULT
 *     appearance, beneath `~/.vgai/settings.json`, the project's own
 *     `.vgai/settings.json` and the adapter's declaration;
 *   - `workspace-presets.ts` uses {@link ActiveProduct.workspace} as the
 *     workspace a project opens in when this checkout has none recorded and the
 *     adapter declares none.
 */

/** What a product's entry composed, as the kit reads it. */
export interface ActiveProduct {
  /** The product's id — `game-editor`, `model-editor`. Reported by the session
   *  beside the workbench (`vgai status`), never read as a branch. */
  readonly id: string;
  /** The packages it mounts, by name, in composition order. The contributions
   *  themselves are already in the bundle (`tool-loader.ts`); this is the list
   *  for anything that needs to SAY what is installed. */
  readonly packages: readonly string[];
  /** The style bundle id this product wears by default (`workspace-style.ts`). */
  readonly look: string;
  /** The workspace it opens in by default (`workspace-presets.ts`). */
  readonly workspace: string;
  /** Use the workbench application menu instead of a second product menu. */
  readonly nativeMenus?: boolean | undefined;
}

let _product: ActiveProduct | null = null;
const listeners = new Set<() => void>();

/** The composed product, or `null` on a surface no product stood up. */
export function activeProduct(): ActiveProduct | null {
  return _product;
}

/**
 * Record the composition. Called once, by the product's entry, at module scope
 * — so every default below is in force before the first module that reads one.
 * A second call with a different id is a page with two products in it, which is
 * the one thing this record cannot be honest about.
 */
export function setActiveProduct(next: ActiveProduct): void {
  if (_product !== null && _product.id !== next.id)
    throw new Error(
      `Two products in one page: "${_product.id}" is already composed and "${next.id}" asked to be. ` +
        'A product is the running program; one page runs one.',
    );
  _product = next;
  for (const listener of listeners) listener();
}

export function subscribeActiveProduct(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
