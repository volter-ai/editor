import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductIdentity } from '@volter/editor-sdk/session/product-locator';

/**
 * WHERE THE EDITOR'S FRAME ENTRY POINT IS — and it is the PRODUCT's, not the
 * kit's.
 *
 * The module the Code-OSS contribution imports (`/__editor/served-modules`,
 * routes/served-modules.ts) is `@vgai/game-editor`'s or `@vgai/model-editor`'s
 * ONE source entry, which composes the product and re-exports `mountVgai`
 * (`packages/editor/src/frame/product.ts`). The kit's own mount is
 * `frame/bridge.tsx`'s `mountEditor`, which names no product and is not served
 * to anybody.
 *
 * There is no constant here to spell it, and that is the point: which file it
 * is depends on WHICH PRODUCT the project resolved, so the one source is the
 * product's own `package.json#vgai.product.entry`
 * (`@volter/editor-sdk/session/product-locator`). Three readers agree through it:
 * the dev host builds a Vite URL from it, the packaged host finds it in the
 * product's production build manifest by it, and
 * `packages/editor/vite-product-build.ts` makes it that build's rollup input.
 */

/** The entry as a path relative to `fromDir`, POSIX — which is what a Vite
 *  manifest key is, and what a dev-server URL is built from. */
export { productEntryPath } from '@volter/editor-sdk/session/product-locator';

/**
 * The URL the packaged host serves the built product entry's CSS-loading
 * wrapper at.
 *
 * A production build emits the entry's stylesheet as its own asset and nothing
 * injects the `<link>`: under the frame there is no HTML of ours for Vite's
 * HTML plugin to write into — the page is the workbench's. So the packaged host
 * serves a three-line ES module that adds the entry's own stylesheets and
 * re-exports the built chunk, and the door hands back THIS url. The
 * contribution still imports one module and still reads `mountVgai` off it.
 */
export const FRAME_BRIDGE_PACKAGED_PATH = '/__editor/frame-bridge.js';

/** What a production build emitted for the product entry, read off its manifest. */
export interface BuiltProductEntry {
  /** The entry chunk's url under the served `dist/`, e.g. `/assets/product-a1b2.js`. */
  readonly js: string;
  /** Its own stylesheets, in the manifest's order. */
  readonly css: readonly string[];
}

/**
 * The product entry inside a product's `dist/`, or a throw naming the build.
 *
 * `build.manifest` is on for exactly this read (repo-root `vite.config.ts`) —
 * the entry's file name is content-hashed, so the only honest way to find it is
 * the manifest the build writes. A `dist/` cut before this product existed
 * answers the door with this sentence rather than a 404 two layers down.
 *
 * THE KEY IS MATCHED BY SUFFIX, not spelled. A Vite manifest key is the entry
 * module's path relative to the build's ROOT, and the root is the repo the
 * build ran in — a fact this process, reading an INSTALLED product out of
 * `node_modules`, has no way to reconstruct. What it does know is the
 * product's own declaration (`./src/index.ts`), and that is the tail of the
 * key whatever the build's root was. `isEntry` is what keeps the match honest:
 * only a rollup entry may answer this door.
 */
export function readBuiltProductEntry(
  distPath: string,
  product: ProductIdentity,
): BuiltProductEntry {
  const manifestPath = join(distPath, '.vite', 'manifest.json');
  const rebuild = `npm run build -w ${product.name}`;
  let manifest: Record<string, { file?: string; css?: string[]; isEntry?: boolean }>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch (error) {
    throw new Error(
      `${manifestPath} is not readable (${error instanceof Error ? error.message : String(error)}), so this ` +
        `session cannot find ${product.name}'s entry in its own production build. Rebuild it:\n  ${rebuild}`,
    );
  }
  const tail = product.entry.replace(/^\.\//, '');
  const found = Object.entries(manifest).find(
    ([key, value]) => value.isEntry === true && (key === tail || key.endsWith(`/${tail}`)),
  );
  const entry = found?.[1];
  if (!entry || typeof entry.file !== 'string') {
    throw new Error(
      `${manifestPath} names no entry ending in ${tail}, so this ${product.name} build predates ` +
        `its frame entry and cannot be framed. Rebuild it:\n  ${rebuild}`,
    );
  }
  return { js: `/${entry.file}`, css: (entry.css ?? []).map((file) => `/${file}`) };
}

/**
 * The wrapper module the packaged host serves at
 * {@link FRAME_BRIDGE_PACKAGED_PATH}: the built entry's stylesheets, then the
 * built entry itself, re-exported whole so `mountVgai` is read off this module
 * exactly as it is read off the dev one.
 */
export function builtFrameBridgeModule(built: BuiltProductEntry): string {
  const sheets = JSON.stringify(built.css);
  return (
    '// Generated per request by packages/editor/server/frame-bridge.ts — the\n' +
    "// product's production build entry, with the stylesheets no HTML of ours injects.\n" +
    `for (const href of ${sheets}) {\n` +
    '  if (document.head.querySelector(`link[href="${href}"]`)) continue;\n' +
    "  const link = document.createElement('link');\n" +
    "  link.rel = 'stylesheet';\n" +
    '  link.href = href;\n' +
    '  document.head.appendChild(link);\n' +
    '}\n' +
    `export * from ${JSON.stringify(built.js)};\n`
  );
}
