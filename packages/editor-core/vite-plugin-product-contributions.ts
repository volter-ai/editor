/**
 * `vgai:contributions/<package>` — a package's DECLARED contributions, read at
 * build/serve time and served as a module of static `import()`s.
 *
 * A PRODUCT is code (ARCHITECTURE-CORE §The target shape, rule 8: "Compositions
 * are code; the frame's and the loader's manifests are declarations and stay").
 * `packages/game-editor/src/index.ts` and `packages/model-editor/src/index.ts`
 * name the packages they mount, in TypeScript, and each name is spelled as an
 * import of this virtual module:
 *
 *   import blender from 'vgai:contributions/@vgai/blender';
 *
 * whose body this plugin synthesizes from that package's own
 * `package.json#vgai.contributions`:
 *
 *   export default [
 *     { entryPath: '@vgai/blender/contributions/blender.command.ts',
 *       load: () => import('@vgai/blender/contributions/blender.command') },
 *     …
 *   ];
 *
 * The declaration is the ONE source. Nothing is committed that a script
 * generates, and a package that grows a contribution grows every product that
 * names it with no second edit anywhere — which is the defect the generated
 * table (`builds.generated.ts`, 529 committed lines derived from `builds/*.json`)
 * existed to remove and then re-introduced from the other side: the table was
 * committed, so it went stale, and a pre-commit check had to exist to notice.
 *
 * WHY A PLUGIN AND NOT `import.meta.glob`. A glob is a path pattern over THIS
 * package's tree; what a product mounts is another package's own list, and a
 * package's contributions live behind its export map, not at a path a consumer
 * may guess. So the plugin reads the manifest the loader already reads
 * (`server/project-tools.ts`'s `packageContributionModules` reads the same key
 * for a PROJECT's declared packages) and emits the same `{ entryPath, load }`
 * shape `tool-loader.ts` consumes. `vite-plugin-module-doorways.ts` is the
 * precedent for the mechanism: `resolveId` maps a private id, `load` answers
 * with a literal module body of static statements, and every specifier in it
 * goes through the serving instance's own resolver.
 *
 * THE `entryPath` IS THE PACKAGE SPECIFIER, with its extension, because that is
 * what the SESSION reports for the same module (`project-tools.ts` records a
 * package's contribution by the manifest's own `./contributions/x.ts` spelling)
 * and `tool-loader.ts` dedupes a package the product bundles against one the
 * open project declares BY THAT STRING. The `load` import drops the extension
 * for the same reason the old generator did: `@vgai/x/contributions/*` is an
 * export-map wildcard, and the bundler resolves the extension.
 *
 * WHERE THE MANIFEST IS FOUND. From the IMPORTER — the product module doing the
 * importing — through Node resolution of `<name>/package.json`, so the product
 * reads the package its own install resolves. `resolveId` is the only hook with
 * an importer, so it resolves the manifest and remembers it for `load`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/** The specifier prefix a product writes. Part of the kit's public surface: a
 *  product package's source contains this string and nothing else about how a
 *  contribution is found. */
export const PRODUCT_CONTRIBUTIONS_PREFIX = 'vgai:contributions/';

/** One contribution a product bundles: the package specifier `tool-loader.ts`
 *  records as the module's `file`, and the lazy import the bundler follows. */
export interface BundledContribution {
  readonly entryPath: string;
  readonly load: () => Promise<unknown>;
}

/** The module text served for one package's declared contributions. Exported so
 *  the closure meter can read the same list this serves without re-deriving the
 *  rule (`scripts/validate-editor-closure.mjs`). */
export function productContributionsModuleSource(
  packageName: string,
  declared: readonly string[],
): string {
  const rows = declared.map((entry) => {
    const relative = entry.replace(/^\.\//, '');
    const specifier = `${packageName}/${relative}`;
    const importable = specifier.replace(/\.(tsx|ts|jsx|js)$/, '');
    return (
      `  { entryPath: ${JSON.stringify(specifier)}, ` +
      `load: () => import(${JSON.stringify(importable)}) },`
    );
  });
  return [
    `// ${packageName}'s package.json#vgai.contributions, read at build time by`,
    '// packages/editor/vite-plugin-product-contributions.ts.',
    'export default [',
    ...rows,
    '];',
    '',
  ].join('\n');
}

/** A package's declared contribution modules, or a throw naming the package. */
export function readDeclaredContributions(manifestPath: string, packageName: string): string[] {
  let manifest: { vgai?: { contributions?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch (error) {
    throw new Error(
      `${manifestPath} is not readable (${error instanceof Error ? error.message : String(error)}), ` +
        `so ${packageName}'s contributions cannot be composed into this product.`,
    );
  }
  const declared = manifest.vgai?.contributions;
  if (declared === undefined)
    throw new Error(
      `${packageName} declares no package.json#vgai.contributions, so there is nothing for a ` +
        'product to mount from it. A package that contributes declares its modules there; a ' +
        'package that only exports code is imported by name instead.',
    );
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== 'string'))
    throw new Error(
      `${packageName}'s package.json#vgai.contributions must be an array of ./-relative modules.`,
    );
  return declared as string[];
}

/**
 * Resolve `<name>/package.json` from the importing module's own directory.
 *
 * `createRequire` walks `node_modules` upward exactly as the runtime does, so a
 * product resolves the package version its own install carries — and in this
 * workspace that is the checkout's symlink, which is the same file the estate
 * scan reads.
 */
function locateManifest(packageName: string, importer: string | undefined): string {
  const from = importer && isAbsolute(importer) ? importer : join(process.cwd(), 'index.js');
  const require = createRequire(pathToFileURL(from));
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    // An export map without a `./package.json` entry: fall back to the package
    // directory Node resolves for the bare name's own files.
    const resolvedFrom = createRequire(pathToFileURL(from));
    const found = resolvedFrom.resolve(packageName);
    let dir = dirname(found);
    for (;;) {
      const candidate = join(dir, 'package.json');
      try {
        if (JSON.parse(readFileSync(candidate, 'utf8')).name === packageName) return candidate;
      } catch {
        /* keep walking */
      }
      const parent = dirname(dir);
      if (parent === dir)
        throw new Error(
          `${packageName} is not installed where ${from} can resolve it, so this product cannot ` +
            'mount its contributions. Declare it as a dependency of the product package.',
        );
      dir = parent;
    }
  }
}

/**
 * The ONE plugin serving every `vgai:contributions/<package>` a product names.
 *
 * Registered on the repo-root `vite.config.ts` — which is both the product
 * BUILD's config and the dev session's `configFile`
 * (`packages/editor/server/dev.ts`), so one registration answers both hosts.
 * The PACKAGED host's project-rooted instance never sees a product module (the
 * product is a built chunk there), so it registers nothing.
 */
export function productContributionsPlugin(): Plugin {
  const manifests = new Map<string, string>();
  return {
    name: 'vgai-product-contributions',
    resolveId(id, importer) {
      if (!id.startsWith(PRODUCT_CONTRIBUTIONS_PREFIX)) return null;
      const packageName = id.slice(PRODUCT_CONTRIBUTIONS_PREFIX.length);
      if (packageName === '')
        throw new Error(
          `"${id}" names no package — the form is \`${PRODUCT_CONTRIBUTIONS_PREFIX}<package>\`.`,
        );
      const virtual = `\0${id}`;
      manifests.set(virtual, locateManifest(packageName, importer));
      return virtual;
    },
    load(id) {
      const manifestPath = manifests.get(id);
      if (manifestPath === undefined) return null;
      const packageName = id.slice(`\0${PRODUCT_CONTRIBUTIONS_PREFIX}`.length);
      // Watched, so a package that grows a contribution refreshes the product
      // in a live session instead of waiting for a restart.
      this.addWatchFile(manifestPath);
      return productContributionsModuleSource(
        packageName,
        readDeclaredContributions(manifestPath, packageName),
      );
    },
  };
}
