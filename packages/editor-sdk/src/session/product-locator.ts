/**
 * WHICH PRODUCT OPENS THIS PROJECT — one declaration, one resolver.
 *
 * A PRODUCT is the running program (ARCHITECTURE-CORE §The target shape, rule
 * 4): `@vgai/game-editor` and `@vgai/model-editor` each stitch packages onto
 * the editor kit in code and each carry a `bin`. **Which product runs is never
 * a switch** — there is no `--product` flag, no id in the manifest, no setting,
 * the same way a folder never names which VS Code opens it and a `.blend` never
 * names Blender.
 *
 * So the resolution is a DEPENDENCY resolution, exactly as
 * `assertEditorProjectInstalled` resolves `@vgai/editor`: the project's
 * `dependencies` ∪ `devDependencies` are read, each `@vgai/*` among them is
 * resolved from the project, and the one whose `package.json` carries
 * `vgai.product` is the product. A project's `package.json` naming a product as
 * a devDependency is the person's convenience — what `npm run dev` launches —
 * and not a rule about the project.
 *
 * NONE and TWO are both refusals by name, because either answer would otherwise
 * be guessed. None prints the `npm install --save-dev` line for both products;
 * two names both and says the project must resolve it, because a page runs one
 * product and nothing here can pick.
 *
 * WHO CALLS THIS, and why twice. The CLI resolves to REFUSE EARLY and to hand
 * the directory to the session; the session resolves to SERVE the product's
 * entry and to REPORT it (`EditorState.product`), because what it is serving is
 * its own fact. One function, one set of refusal texts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The manifest key a product declares. A DECLARATION, not a config: it says
 *  what this package IS so the CLI and the session can find its entry without
 *  running it (ARCHITECTURE-CORE §The target shape, rule 8). */
export const PRODUCT_DECLARATION_KEY = 'vgai.product';

/** Light or dark — the two the workbench's own `ColorScheme` has plain names
 *  for, and the only two a product needs to state (a high-contrast scheme is a
 *  person's accessibility choice, never a product's declaration). */
export type ProductColorTheme = 'dark' | 'light';

/**
 * THE WORKBENCH THIS PRODUCT IS, named as a published release.
 *
 * A product is the running program, and the program is the Code-OSS workbench
 * its kit and its half were compiled INTO (ARCHITECTURE-CORE §The target
 * shape: "one product number per release, pinning the fork, the kit, the API
 * and its media"). So which release those bytes are is not a machine's setting
 * and not a person's choice — it is what the product IS, declared beside
 * `entry` and `colorTheme` and read without running anything (rule 8).
 *
 * `release` is the tag `scripts/workbench/build-release.mjs --publish` cuts on
 * the fork's own repository, `<product>-<fork sha 12>-<platform>`;
 * `tarballSha256` is the pin, verified against the downloaded bytes before a
 * single one of them is extracted. Both come out of that script's own
 * `BUILD.json`, and it prints this block to paste.
 *
 * A machine that has already fetched it keeps it in `~/.vgai/workbenches/<tag>`
 * and a project that has one names it in `.vgai/workbench.json`, so this is
 * consulted exactly once per machine per release — see
 * `workbench-locator.ts`'s `resolveWorkbenchForProject`.
 */
export interface ProductWorkbench {
  /** The GitHub Release tag on `volter-ai/code-oss`. */
  readonly release: string;
  /** The sha256 of that release's tarball asset, hex. */
  readonly tarballSha256: string;
}

/** A product package, as everything outside it needs to know it. */
export interface ProductIdentity {
  /** The package name — `@vgai/game-editor`. */
  readonly name: string;
  /** Its version, reported beside the workbench by `vgai status`. */
  readonly version: string;
  /**
   * The command a person types to run it — the ONE key of its package.json
   * `bin` (`volter-game-editor`). Every message the kit writes about a verb
   * names this, because the kit itself has no command of its own.
   */
  readonly command: string;
  /** The name a person sees — `vgai.product.displayName` (`Volter Game Editor`). */
  readonly displayName: string;
  /** Its package root, absolute. */
  readonly dir: string;
  /**
   * Its ONE source entry, package-relative and POSIX (`./src/index.ts`). That
   * entry IS the product's frame entry: it composes and re-exports `mountVgai`,
   * which is the name the fork's contribution reads off the served module.
   */
  readonly entry: string;
  /**
   * WHICH WAY ROUND THIS PRODUCT PAINTS, before one line of its code runs.
   *
   * Measured 2026-09-21 on both releases: the web workbench's FIRST PAINT is
   * LIGHT (`workbenchThemeService.ts`, `this.settings.getPreferredColorScheme()
   * ?? (isWeb ? ColorScheme.LIGHT : ColorScheme.DARK)`), so the product's
   * opening cover — which paints in `--vscode-*` variables, as it must — was
   * white for its whole life and flipped dark the instant the real theme
   * landed. The supported door is `IWorkbenchConstructionOptions
   * .initialColorTheme`, which is read out of the PAGE CONFIG, before any
   * extension or setting is available; the session's proxy injects it
   * (`packages/editor/server/frame-proxy.ts`).
   *
   * It is a DECLARATION and not a setting (ARCHITECTURE-CORE §The target
   * shape, rule 8): it says what the product IS, the same way `entry` does, and
   * it has to be readable without running the product because the proxy needs
   * it before the product exists. A person's own `workbench.colorTheme` still
   * wins on every open after the first — the workbench prefers its stored theme
   * over this and only falls back here when it has none.
   */
  readonly colorTheme: ProductColorTheme;
  /** WHICH WORKBENCH THIS PRODUCT IS — see {@link ProductWorkbench}. */
  readonly workbench: ProductWorkbench | null;
}

/** The install line a refusal quotes, for a project that already EXISTS. Both
 *  products, because a person choosing between them is choosing what they are
 *  building, not a flag. */
export const PRODUCT_INSTALL_LINES = ['  npm install --save-dev @volter/editor'] as const;

/**
 * The create line a refusal or a help screen quotes, for a project that does
 * not exist yet. CREATION IS THE PRODUCT'S (ARCHITECTURE-CORE §The target
 * shape, rule 1): a product scaffolds the project it opens, declaring its own
 * presets, and there is no create verb in the kit's CLI for either of them to
 * be an alias of.
 *
 * This is the ONE place the two product names are spelled outside the products
 * themselves; the CLI and the session quote it rather than keeping a copy.
 */
export const PRODUCT_CREATE_LINES = ['  npx @volter/editor create <name>'] as const;

interface ProductManifestShape {
  private?: unknown;
  name?: unknown;
  version?: unknown;
  bin?: unknown;
  vgai?: { product?: { entry?: unknown; colorTheme?: unknown; workbench?: unknown; displayName?: unknown } };
}

const PRODUCT_COLOR_THEMES: readonly ProductColorTheme[] = ['dark', 'light'];

/**
 * Read one product package's declaration, or `null` when the manifest is not a
 * product's. Throws when it declares `vgai.product` and the declaration is
 * unusable — a half-written product must be named, never skipped.
 */
export function readProductManifest(packageDir: string): ProductIdentity | null {
  const manifestPath = join(packageDir, 'package.json');
  let manifest: ProductManifestShape;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProductManifestShape;
  } catch {
    return null;
  }
  const declared = manifest.vgai?.product;
  if (declared === undefined) return null;
  const entry = declared.entry;
  if (typeof entry !== 'string' || !entry.startsWith('./'))
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY} but its "entry" is ` +
        `${JSON.stringify(entry)}. It must be a ./-relative module — the product's ONE source ` +
        'entry, which is also its frame entry (e.g. "./src/index.ts").',
    );
  const resolved = join(packageDir, entry);
  if (!existsSync(resolved))
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY}.entry ${JSON.stringify(entry)}, ` +
        `which does not exist (${resolved}).`,
    );
  const colorTheme = declared.colorTheme;
  // REQUIRED, like `entry`, and for the same reason: a product that does not
  // say which way round it paints gets the workbench's web default, which is
  // LIGHT, and its cover is white until its real theme loads. There is no
  // defensible default to invent here — a dark product and a light product are
  // both ordinary — so an unstated one is named rather than guessed.
  if (typeof colorTheme !== 'string' || !PRODUCT_COLOR_THEMES.includes(colorTheme as never))
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY} but its "colorTheme" is ` +
        `${JSON.stringify(colorTheme)}. It must be ${PRODUCT_COLOR_THEMES.map((one) =>
          JSON.stringify(one),
        ).join(' or ')} — which way round this product paints, read before any of its code ` +
        "runs so the workbench's first frame is already the product's own background.",
    );
  // REQUIRED, for the same reason as `entry`: the kit names verbs in every
  // message it writes, and there is no command to name but the product's own.
  const bin = manifest.bin;
  const commands = bin !== null && typeof bin === 'object' ? Object.keys(bin) : [];
  if (commands.length !== 1)
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY} but its "bin" names ` +
        `${commands.length === 0 ? 'no command' : `${commands.length} commands`}. A product has ` +
        'exactly one command — the one every session message tells a person to run.',
    );
  const displayName = declared.displayName;
  if (typeof displayName !== 'string' || displayName.trim() === '')
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY} but its "displayName" is ` +
        `${JSON.stringify(displayName)}. It must be the name a person sees (e.g. "Volter Editor").`,
    );
  return {
    name: typeof manifest.name === 'string' ? manifest.name : packageDir,
    version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
    command: commands[0]!,
    displayName,
    dir: packageDir,
    entry,
    colorTheme: colorTheme as ProductColorTheme,
    // A private source product may use an explicitly selected matching checkout.
    // Public packages must always carry a downloadable, checksummed workbench.
    workbench: manifest.private === true && declared.workbench === undefined
      ? null : readProductWorkbench(manifestPath, declared.workbench),
  };
}

/** The sha256 a release pins its tarball with, as `BUILD.json` writes it. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * REQUIRED, like `entry` and `colorTheme`, and for the sharpest reason of the
 * three: a product that does not say which workbench it is cannot be INSTALLED
 * — `npx @vgai/<product> create <name>` on a machine with nothing else on it
 * has no other way to find the bytes it runs in, and the person is left writing
 * a path to a directory they would have to build first. There is no default to
 * invent (the tag names a fork commit nobody can guess), so an unstated one is
 * named rather than guessed.
 */
function readProductWorkbench(manifestPath: string, declared: unknown): ProductWorkbench {
  const example =
    '  "vgai": { "product": { "workbench": { "release": "<product>-<fork sha 12>-<platform>", ' +
    '"tarballSha256": "<64 hex>" } } }\n' +
    '`node scripts/workbench/build-release.mjs --publish --out <release dir>` cuts the release ' +
    'and prints exactly that block.';
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared))
    throw new Error(
      `${manifestPath} declares ${PRODUCT_DECLARATION_KEY} but its "workbench" is ` +
        `${JSON.stringify(declared)}. A product IS the Code-OSS workbench it was compiled into, ` +
        `so it names the published release those bytes are:\n${example}`,
    );
  const record = declared as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => key !== 'release' && key !== 'tarballSha256');
  if (extra.length > 0)
    throw new Error(
      `${manifestPath}'s ${PRODUCT_DECLARATION_KEY}.workbench carries ` +
        `${extra.map((key) => `"${key}"`).join(', ')}, which this declaration has no meaning for. ` +
        `It names the release and the pin, and nothing else:\n${example}`,
    );
  const release = record['release'];
  if (typeof release !== 'string' || release.trim() === '')
    throw new Error(
      `${manifestPath}'s ${PRODUCT_DECLARATION_KEY}.workbench names no "release" — the GitHub ` +
        `Release tag its workbench was published under:\n${example}`,
    );
  const tarballSha256 = record['tarballSha256'];
  if (typeof tarballSha256 !== 'string' || !SHA256_HEX.test(tarballSha256))
    throw new Error(
      `${manifestPath}'s ${PRODUCT_DECLARATION_KEY}.workbench has tarballSha256 ` +
        `${JSON.stringify(tarballSha256)}, which is not 64 hex characters. It is the PIN — the ` +
        'hash the downloaded tarball is checked against before a byte of it is extracted, so it ' +
        `is never approximate:\n${example}`,
    );
  return { release, tarballSha256 };
}

/**
 * A product's SHORT id — `@vgai/model-editor` → `model-editor`.
 *
 * It is the product's own `product({ id })`, the directory its workbench half
 * lives in (`packages/<id>/workbench`), the `--product` flag the overlay and the
 * release build take, and what a release records in `BUILD.json`. One derivation
 * rather than four literals: the package name is the only place the product is
 * NAMED, and everything else is that name's last segment.
 */
export function workbenchProductId(packageName: string): string {
  return packageName.split('/').pop() ?? packageName;
}

/** A product's entry as a path relative to `fromDir`, POSIX — the spelling a
 *  Vite manifest key and a dev-server URL both use. */
export function productEntryPath(product: ProductIdentity, fromDir: string): string {
  const absolute = join(product.dir, product.entry);
  const prefix = fromDir.endsWith('/') ? fromDir : `${fromDir}/`;
  const relative = absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
  return relative.split('\\').join('/');
}

/** Every `@vgai/*` this project declares, in either section, sorted. */
function declaredVgaiPackages(projectRoot: string): string[] {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as typeof manifest;
  } catch {
    return [];
  }
  return Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) })
    .filter((name) => name.startsWith('@volter/'))
    .sort();
}

/** Where a package resolves FROM THE PROJECT, or null when it is not installed. */
function locatePackage(projectRoot: string, name: string): string | null {
  const require = createRequire(pathToFileURL(join(projectRoot, 'package.json')));
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    // No `./package.json` export: walk up from whatever the bare name resolves
    // to, which is what a package with a strict export map leaves reachable.
    try {
      let dir = dirname(require.resolve(name));
      for (;;) {
        const candidate = join(dir, 'package.json');
        try {
          if ((JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }).name === name)
            return dir;
        } catch {
          /* keep walking */
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
      }
    } catch {
      return null;
    }
  }
}

/**
 * THE PACKAGES A PRODUCT COMPOSES — its `dependencies` that declare
 * `package.json#vgai.contributions`, resolved from the product's own install.
 *
 * COMPOSITIONS ARE CODE (ARCHITECTURE-CORE §The target shape, rule 8): the
 * product's entry names each of them as `vgai:contributions/<name>`, and that
 * import IS the composition. This function does not read the entry — it reads
 * the MIRROR of it in the manifest, which `scripts/validate-package-estate.mjs`
 * keeps equal to the source by scanning those same specifiers and writing the
 * dependency line. Two readings of one fact, one of them checked, and neither
 * of them a second list somebody maintains: a package the entry imports and the
 * manifest omits fails the gate, and a dependency the entry does not import is
 * a library the product uses rather than a composition it mounts (that is what
 * "declares contributions" tests).
 *
 * The runtime reads the manifest rather than the source because it is the cheap
 * and exact half: a `package.json` is JSON this process already parses, and a
 * source scan in the session would be a second implementation of the gate's.
 */
export function productComposedPackages(product: ProductIdentity): string[] {
  let manifest: { dependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(
      readFileSync(join(product.dir, 'package.json'), 'utf8'),
    ) as typeof manifest;
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
    const dir = locatePackage(product.dir, name);
    if (dir === null) continue;
    let dependency: { vgai?: { contributions?: unknown } };
    try {
      dependency = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as typeof dependency;
    } catch {
      continue;
    }
    if (Array.isArray(dependency.vgai?.contributions)) found.push(name);
  }
  return found;
}

/** The products this project declares AND resolves, in declaration order. */
export function declaredProducts(projectRoot: string): ProductIdentity[] {
  const found: ProductIdentity[] = [];
  for (const name of declaredVgaiPackages(projectRoot)) {
    const dir = locatePackage(projectRoot, name);
    if (dir === null) continue;
    const product = readProductManifest(dir);
    if (product !== null) found.push(product);
  }
  return found;
}

/**
 * THE product this project opens in, or a throw naming what is wrong.
 *
 * The refusals are the whole point: a project with none and a project with two
 * are both states a person can be in, and neither has an answer this code may
 * invent.
 */
export function resolveProductForProject(projectRoot: string): ProductIdentity {
  const products = declaredProducts(projectRoot);
  if (products.length === 1) return products[0] as ProductIdentity;
  if (products.length === 0)
    throw new Error(
      `${projectRoot} declares no editor product, so there is no editor to open it in.\n` +
        'The installed product supplies the editor,\n' +
        'and which one runs is what the project installed, never a flag.\n' +
        'For THIS folder, install the one you are building with:\n' +
        `${PRODUCT_INSTALL_LINES.join('\n')}\n` +
        "then run that product's `edit` command again. For a NEW project, the product creates it:\n" +
        `${PRODUCT_CREATE_LINES.join('\n')}`,
    );
  throw new Error(
    `${projectRoot} declares ${products.length} editor products — ` +
      `${products.map((product) => product.name).join(' and ')}.\n` +
      'One page runs one product, and nothing here may choose between them. Remove the one you\n' +
      'are not building with:\n' +
      products.map((product) => `  npm uninstall ${product.name}`).join('\n'),
  );
}
