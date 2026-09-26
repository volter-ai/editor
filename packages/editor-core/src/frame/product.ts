/**
 * `product({ … })` — THE DOOR A PRODUCT CALLS, and the whole of what a product
 * package's entry has to do.
 *
 * A product is the last mile (ARCHITECTURE-CORE §The target shape): thin code
 * that stitches packages onto the kit and holds only purpose-specific choices.
 * `@vgai/game-editor` and `@vgai/model-editor` each have ONE source entry, and
 * it IS that product's frame entry:
 *
 *   import { product } from '@editor/frame/product';
 *   import blender from 'vgai:contributions/@volter/editor-blender';
 *
 *   export const { mountVgai } = product({
 *     id: 'model-editor',
 *     packages: { '@volter/editor-blender': blender },
 *     look: 'blender',
 *     workspace: 'model',
 *   });
 *
 * `mountVgai` is the name the fork's contribution reads off the served module
 * (`server/routes/served-modules.ts`); the kit's own mount is `mountEditor` in
 * `bridge.tsx`, which names no package and no product. Composing at module
 * scope and handing back the mount is what makes the ordering unarguable:
 * everything the composition decides is in force before the frame can call it.
 *
 * WHAT IT DOES NOT DO. It registers nothing itself: a contribution is mounted
 * by the loader when the session's catalog pass runs (`tool-loader.ts`), the
 * same pass that mounts the open PROJECT's own declared packages, so a package
 * the product bundles and the project declares is loaded once. A product may
 * not reach past this door into the kit's registries — that would be a product
 * doing a package's job (rule 3).
 */
import { setActiveProduct } from '../active-product';
import { type BundledPackageContribution, setBundledPackageContributions } from '../tool-loader';
import { mountEditor } from './bridge';

/** What a product's entry declares. Every field is a decision only a product
 *  can make: which packages it is, what it looks like, what it opens in. */
export interface ProductDefinition {
  /** The product's id — `game-editor`, `model-editor`. Reported beside the
   *  workbench by `vgai status`; never branched on. */
  readonly id: string;
  /**
   * The packages this product mounts, keyed by package name, each value the
   * default export of that package's `vgai:contributions/<name>` module.
   *
   * The KEY is here so the composition says what it composed in one place a
   * person can read, and so `activeProduct().packages` can answer "what is
   * installed" without re-deriving it from entry paths. The VALUE is the
   * package's own declared list — the product never enumerates contributions.
   */
  readonly packages: Readonly<Record<string, readonly BundledPackageContribution[]>>;
  /** The style bundle this product wears by default (`workspace-style.ts`) —
   *  beneath the person's settings, the project's, and its adapter's. */
  readonly look: string;
  /** The workspace it opens in when nothing is recorded and the adapter
   *  declares none (`workspace-presets.ts`). */
  readonly workspace: string;
  readonly nativeMenus?: boolean;
  /** The product's own logo, a brand.volter.ai URL (the repository bundles no brand art). */
  readonly logo?: string;
}

/**
 * Compose a product and hand back its frame entry. Called once, at the product
 * entry's module scope.
 */
export function product(definition: ProductDefinition): { mountVgai: typeof mountEditor } {
  const names = Object.keys(definition.packages);
  setActiveProduct({
    id: definition.id,
    packages: names,
    look: definition.look,
    workspace: definition.workspace,
    nativeMenus: definition.nativeMenus,
    logo: definition.logo,
  });
  setBundledPackageContributions(names.flatMap((name) => definition.packages[name] ?? []));
  return { mountVgai: mountEditor };
}
