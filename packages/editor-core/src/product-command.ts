/**
 * THE PRODUCT'S COMMAND, as every kit message names it.
 *
 * The kit has no command of its own: a person runs `volter-editor` or
 * `volter-game-editor`, and a message that tells them to run a verb must name
 * the one they have. The owner of the answer is the served product's
 * package.json — its single `bin` key and `vgai.product.displayName`
 * (`readProductManifest`, `@volter/editor-sdk/session/product-locator`). The
 * server learns it at boot (`packaged.ts`); the page learns it from
 * `/__editor/project`, which its mount asks once (`loadProductNames`).
 *
 * Until the identity exists nothing guesses a product: a verb is written as
 * "the editor's `status` command".
 */

export interface ProductNames {
  /** The command a person types — `volter-game-editor`. */
  readonly command: string;
  /** The name a person sees — `Volter Game Editor`. */
  readonly displayName: string;
}

let names: ProductNames | null = null;

/** Record the served product's names. Called once per process/page. */
export function setProductNames(next: ProductNames): void {
  names = { command: next.command, displayName: next.displayName };
}

/** The served product's names, or `null` before they are known. */
export function productNames(): ProductNames | null {
  return names;
}

/** The product's command (`volter-game-editor`), or `null` before it is known. */
export function productCommand(): string | null {
  return names?.command ?? null;
}

/**
 * One verb as a person should type it, backticked: `` `volter-game-editor
 * status` ``. Before the identity is known: ``the editor's `status` command``.
 */
export function commandLine(verb: string): string {
  return names ? `\`${names.command} ${verb}\`` : `the editor's \`${verb}\` command`;
}

/** The product's display name, or a generic phrase before it is known. */
export function productDisplayName(): string {
  return names?.displayName ?? 'the editor';
}

let loading: Promise<void> | null = null;

/**
 * Page side: learn the names from `/__editor/project`'s `product`. Asked once;
 * a failed ask is retried by the next caller rather than latched.
 */
export function loadProductNames(): Promise<void> {
  loading ??= fetch('/__editor/project')
    .then((res) => res.json() as Promise<{ product?: Partial<ProductNames> | null }>)
    .then((body) => {
      const product = body.product;
      if (product && typeof product.command === 'string' && typeof product.displayName === 'string') {
        setProductNames({ command: product.command, displayName: product.displayName });
      }
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}
