/**
 * scaffold — the single shared implementation of "create a game project from
 * the game editor's template". Used by this product's `create`
 * (`../create.ts`), which the `volter-game-editor create` verb and the
 * product's `presets.mjs` both reach.
 *
 * THE KIT NAMES NO PRODUCT (ARCHITECTURE-CORE §The target shape, rule 1).
 * There is no preset table and no template name here: the caller hands over
 * the additions this project ends with and the composition its product
 * declares (`./product.ts`), and this library owns everything below that — the
 * template's files, the additions' rewrites, the manifest, the catalog and the
 * baseline.
 *
 * Pure library: no `process.exit`, no `console.log` — callers own UX/error
 * reporting. Throws `Error` on failure.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { type ParseError, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
// The manifest FILENAME has ONE owner (`@volter/editor-project`'s
// manifest/filename.ts + its filesystem half, manifest/locate.ts). Reaching for
// `locate` rather than `load-file` is deliberate: `locate.ts` is the Zod-free
// half, so this predicate does not drag the manifest SCHEMA (and Zod) into the
// scaffolder's bundle.
import { hasManifest, resolveManifestPath } from '@volter/editor-project/manifest/locate';
import {
  adapterSourceFor,
  closeAdditions,
  joinAdditionFinders,
  KIT_DECLARED_PACKAGES,
  REACT_ONLY_FILES,
  REACT_ONLY_REMOVED_PATHS,
  type ScaffoldAddition,
  STUDIO_OWNED_PATHS,
  THREE_OWNED_PATHS,
  withAgentsContract,
  withEditorDeclaration,
} from './additions';
import type { ScaffoldComposition } from './product.js';

export type { ScaffoldAddition } from './additions';
export {
  ADDITION_INFO,
  closeAdditions,
  isScaffoldAddition,
  REACT_ONLY_PAGE_SOURCE,
  SCAFFOLD_ADDITIONS,
} from './additions';
export {
  assertProductCreateDeclaration,
  assertScaffoldComposition,
  type ProductCreateDeclaration,
  type ScaffoldComposition,
  type ScaffoldEditorDeclaration,
} from './product.js';

import {
  hashFile,
  SCAFFOLD_BASELINE_RELATIVE_PATH,
  type ScaffoldBaseline,
  writeScaffoldBaseline,
} from './baseline.js';
import {
  addCapabilities,
  DEFAULT_REACT_CAPABILITIES,
  initializeProjectCatalog,
} from './catalog.js';
import { satisfiesRange } from './engine-version.js';
import { SCAFFOLD_PRESENTATIONS, type ScaffoldPresentation } from './templates.js';

/**
 * Retired post-copy presentation vocabulary, retained while older editor
 * clients drain. `blank` is now an identity because the normalized default
 * composition is the blank scene.
 */
export { SCAFFOLD_PRESENTATIONS, type ScaffoldPresentation };

export interface ScaffoldOptions {
  /** Display name of the project (vgai.project.json `name`, index.html title). */
  name: string;
  /** Absolute path to create the project at. Must not already exist. */
  targetDir: string;
  /**
   * The additions this project ends with — already closed over
   * {@link closeAdditions}'s requirements by the door the caller took (a
   * product's preset plus its `--with`, or the New Project checklist).
   * Ignored, with {@link ScaffoldOptions.composition}, when `exampleId` is set:
   * an example is copied whole and declares its own.
   */
  additions?: readonly ScaffoldAddition[];
  /**
   * What this project's PRODUCT declares for those additions — the editor-side
   * packages it ends with and how its adapter presents. Required unless
   * `exampleId` is set.
   */
  composition?: ScaffoldComposition;
  /**
   * Absolute path to either the repository root (a checkout) or the npm
   * installation root whose `node_modules` resolves this product's packages.
   * Versions are read from it; generated projects always use package
   * dependencies.
   */
  monoRoot: string;
  /**
   * Absolute path to this product package's own directory. `template/`,
   * `template-dotfiles/`, `catalog/` and `starter/` are its files, in a
   * checkout and in an install alike.
   */
  productDir: string;
  /**
   * Which `examples/<id>/` project to copy INSTEAD of composing the template.
   * An example is a finished project: it is copied whole, and its own
   * `package.json` and adapter are what it opens with.
   */
  exampleId?: string;
  /**
   * Retired presentation field accepted for older editor clients. `'blank'`
   * is an identity: the default composition is already the blank scene.
   */
  presentation?: ScaffoldPresentation;
}

/**
 * THE RUNTIME PACKAGES a scaffolded project depends on: the project contract
 * and the two shipped twins (the engine split into them on 2026-09-21). Every
 * place below that used to name one engine package walks this list instead —
 * the dependency block, the shared-version pins, the tsconfig `paths`.
 */
export const RUNTIME_PACKAGES = [
  { name: '@volter/editor-project', dir: 'editor-project' },
  { name: '@volter/threejs-runtime', dir: 'threejs-runtime' },
  { name: '@volter/game-runtime', dir: 'game-runtime' },
] as const;

/** Resolve source shipped either by this checkout or by published @volter packages. */
export function resolveScaffoldPackageDir(
  monoRoot: string,
  checkoutRelativePath: string,
  packageName: string,
): string {
  const checkoutDir = join(monoRoot, checkoutRelativePath);
  if (existsSync(checkoutDir)) return checkoutDir;

  const installedDir = join(monoRoot, 'node_modules', packageName);
  if (existsSync(installedDir)) return installedDir;

  return checkoutDir;
}

/**
 * Resolve canonical example projects in either supported distribution shape.
 * A checkout owns them at `<root>/examples`; an installed product carries them
 * in its own `examples/`.
 */
export function resolveScaffoldExamplesDir(monoRoot: string, productDir: string): string {
  const checkoutExamples = join(monoRoot, 'examples');
  if (existsSync(checkoutExamples)) return checkoutExamples;
  return join(productDir, 'examples');
}

/**
 * The starter MODEL files, shipped as BYTES: a `.blend` Blender itself wrote
 * and the bpy script that wrote it. They cannot be string constants like every
 * other starter file — a `.blend` is binary — so they are real files in this
 * product's own `starter/`, which its `files` publishes beside `template/`.
 */
export const STARTER_MODEL_FILES = ['cube.blend', 'cube.py'] as const;

export function resolveScaffoldStarterDir(productDir: string): string {
  return join(productDir, 'starter');
}

export interface ScaffoldResult {
  targetDir: string;
  slug: string;
  /** The final contents written to the scaffolded project's vgai.project.json. */
  manifest: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

/** Turn an arbitrary project name into a filesystem/npm-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/**
 * Rewrite a template-authored path like `../../engine/src/foo.d.ts` (relative
 * to `packages/editor/template/`) into a path relative to the *scaffolded*
 * project's location, using the already-computed engine-relative path.
 *
 * This is the fix for the tsconfig `files` bug (T3.6): the template's
 * `tsconfig.json` lists ambient `.d.ts` files by a path relative to its own
 * location inside the monorepo. Every prior scaffolder copied that array
 * verbatim, so once a project was scaffolded anywhere other than the
 * template's exact sibling depth, `tsc` failed with TS6053 (file not found).
 * Since every such entry always points into `a runtime package's `src/`, we
 * relocate it against that package's own installed root, rather than
 * assuming a fixed depth.
 *
 * Exported (not just an internal helper) so `vgai upgrade`'s new-template
 * snapshot (`upgrade.ts`'s `reapplyScaffoldRewrites`) can reuse this EXACT
 * rewrite when mirroring `rewriteTsconfig`'s `files` array handling —
 * without it, the snapshot's `tsconfig.json` would never match a real
 * scaffolded project's rewritten `files` array, permanently
 * misclassifying `tsconfig.json` as `template-updated` on every run.
 */
export function rewriteEngineRelativeFilePath(original: string, _engineRelPath: string): string {
  for (const pkg of RUNTIME_PACKAGES) {
    const marker = `${pkg.dir}/src/`;
    const idx = original.indexOf(marker);
    if (idx === -1) continue;
    return `node_modules/${pkg.name}/src/${original.slice(idx + marker.length)}`;
  }
  return original; // not a runtime-package path — leave untouched
}

/**
 * Pin every dependency the scaffolded project shares with the RUNTIME PACKAGES
 * (three, postprocessing, zod, rapier, colyseus, ...) to the EXACT version
 * already resolved in this checkout's `node_modules`.
 *
 * Why this is necessary: the engine is vendored into scaffolded projects as a
 * `file:` dependency that npm resolves as a symlink back into this checkout
 * (see the runtime-package rewrite below). Node/TS module resolution for code
 * *inside* that symlinked engine walks up from its real (monorepo) location,
 * so the engine's copies of these libraries always come from THIS checkout's
 * `node_modules` — pinned by this repo's lockfile. The scaffolded project, by
 * contrast, gets a brand-new independent `npm install` with no lockfile, so a
 * floating range (e.g. `^4.3.6`) can resolve to whatever is newest on the
 * registry that day. Several of these libraries encode nominal/branded
 * version tags in their types (observed: zod v4's internal
 * `_zod.version.minor`, and `postprocessing`'s `Pass` base class identity) —
 * two different physical installations, even semver-compatible ones, are
 * then NOT structurally assignable, and `tsc` fails across every file that
 * touches them. Pinning to this checkout's exact resolved version keeps both
 * installations identical so this dual-package hazard can't occur.
 *
 * The engine is a real package inside the project's OWN `node_modules`, so npm dedupes the
 * shared libraries into one copy from overlapping ranges. Pinning still runs
 * there, and is still wanted: it makes a scaffold reproducible rather than
 * "whatever the registry served that day".
 *
 * Exported so `vgai upgrade`'s new-template snapshot (`upgrade.ts`'s
 * `reapplyScaffoldRewrites`) can reuse this EXACT pinning when mirroring
 * `rewritePackageJson`'s handling of `package.json` — without it, the
 * snapshot's `package.json` would keep the template's floating dependency
 * ranges while a real scaffolded project's `package.json` has them pinned
 * to this checkout's exact installed versions, permanently misclassifying
 * `package.json` as `template-updated` on every run (found via a real
 * create + `vgai upgrade` end-to-end smoke test).
 *
 * `fallbackDir`: a second directory to read
 * BOTH the engine's declared dependency names and each shared dep's
 * installed version from, tried whenever the `monoRoot`-rooted read fails.
 * Only `vgai upgrade`'s snapshot builder passes this (as the PROJECT
 * directory being upgraded) — `rewritePackageJson`'s real scaffold-time
 * call site never does, since a freshly-scaffolded project has no
 * `node_modules` of its own yet.
 *
 * Why this is needed: in a genuine no-checkout upgrade, `monoRoot` is
 * whatever the CLI bundle's own `ENGINE_ROOT` resolves to — which may have
 * `packages/engine/package.json` (so the dependency-NAME list is still
 * readable) but no `node_modules` under it at all (so `readInstalledVersion`
 * fails for every shared dep, silently no-opping the pin). The project being
 * upgraded, by contrast, already ran its OWN `npm install` and has the real
 * resolved version sitting in its own `node_modules` — reading it back from
 * there converges the snapshot on the exact SAME version the project
 * already has, instead of falling back to the template's floating range and
 * spuriously un-pinning a pristine project's `package.json` on every
 * no-checkout upgrade run (see `upgrade-no-checkout-shared-deps.test.ts`).
 *
 * The `fallbackDir` behavior above
 * OVER-corrects if taken unconditionally. `deps[name]` on entry is always
 * the NEW template's declared range for that dep (this function runs before
 * anything else touches a shared-dep line — see both call sites: at real
 * scaffold time `deps` comes straight from the freshly-copied template, and
 * in `upgrade.ts`'s `reapplyScaffoldRewrites` it comes from the freshly-copied
 * NEW-template snapshot). If a future engine/template release WIDENS a
 * shared range (e.g. `three: "^0.170.0"` -> `"^0.180.0"`) while the project
 * being upgraded still has the OLDER version installed, blindly pinning to
 * the installed version overwrites the new, wider range with the old exact
 * version — the snapshot then matches the project's current (also old)
 * `package.json` byte-for-byte, `classifyTemplateFiles` calls it
 * `unchanged`, and the bump never reaches the project. Fix: only pin to the
 * installed version when it still SATISFIES the range already sitting in
 * `deps[name]` (`satisfiesRange`, engine-version.ts); otherwise leave the
 * (new, wider) declared range in place so the snapshot legitimately differs
 * from the project's stale pin and the re-sync step propagates it.
 */
export function pinSharedDependencyVersions(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  engineDir: string,
  monoRoot: string,
  fallbackDir?: string,
): void {
  const engineDeps = resolveEngineDependencyNames(engineDir, fallbackDir);
  if (!engineDeps) return;

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      // The runtime packages' own `@volter/*` dependencies are specified by
      // `engineDependencySpec`, one rule for every `@volter/*` package: an
      // exact pin here beside a caret there installs two copies of
      // `@volter/editor-project` the day a newer release exists.
      if (!engineDeps.has(name) || name.startsWith('@volter/')) continue;
      const installedVersion = readInstalledVersionWithFallback(monoRoot, fallbackDir, name);
      if (!installedVersion) continue;
      // deps[name] is still the un-touched, freshly-copied template's
      // declared range at this point (PG-1) — only collapse it to the
      // installed exact version when that version is actually within it.
      if (satisfiesRange(installedVersion, deps[name]!)) {
        deps[name] = installedVersion;
      }
    }
  }
}

/**
 * The template devDependencies that `pinSharedDependencyVersions` cannot
 * reach, because neither is one of the game runtime's OWN dependencies and its
 * `engineDeps` loop therefore never sees them:
 *
 * - `@playwright/test` — `@volter/editor-live`'s peerDependency. Pinning to the
 *   checkout's exact resolved version keeps the project's copy and the
 *   checkout's identical, which is what makes a single physical
 *   `@playwright/test` instance possible under copy semantics (`.npmrc`'s
 *   `install-links=true`, template-scaffolded verbatim — see that file's own
 *   comment for the full single-instance argument).
 * - `ztrack` — the project-work tracker every scaffold now initializes
 *   (`ensureProjectTracker`). It is a dependency of `@volter/editor-core`, not of the
 *   engine. The project needs its OWN copy because the installed validation
 *   preset (`.volter/tracker/validation/preset.mts`) imports
 *   `ztrack/preset-kit`: without it `ztrack check`/`ztrack loop` fail, and
 *   ztrack itself says so at init time ("`ztrack` isn't resolvable as a
 *   project dependency here … a one-off `npx` install is not enough"). Pinning
 *   also keeps the project on the same ztrack the editor's Project Work panel
 *   reads its board with, so the preset and the reader never disagree.
 */
const STANDALONE_PINNED_DEPENDENCIES = ['@playwright/test', 'ztrack'] as const;

/**
 * Pin the template devDependencies above to this checkout's exact installed
 * versions — same `satisfiesRange`-gated idiom as `pinSharedDependencyVersions`,
 * but a standalone read per package.
 *
 * Why pin at all: the scaffolded project gets a brand-new independent `npm
 * install` with no lockfile, so a floating range could resolve to whatever is
 * newest on the registry that day.
 */
export function pinStandaloneDependencyVersions(
  pkg: { devDependencies?: Record<string, string> },
  monoRoot: string,
): void {
  const deps = pkg.devDependencies;
  if (!deps) return;
  for (const name of STANDALONE_PINNED_DEPENDENCIES) {
    const declaredRange = deps[name];
    if (!declaredRange) continue;
    const installedVersion = readInstalledVersion(monoRoot, name);
    if (!installedVersion) continue;
    if (satisfiesRange(installedVersion, declaredRange)) {
      deps[name] = installedVersion;
    }
  }
}

/**
 * Project-relative path of the roadmap — and, by owner decision (2026-08-09),
 * the project's WHOLE ztrack issue store.
 *
 * The tracker ships BAKED INTO THE TEMPLATE (`packages/editor/template/`):
 * `ztrack init --preset spec` was run there once, its installed
 * `.volter/tracker/validation/preset.mts` had the `passed_ac_missing_evidence`
 * gate removed (a game's proof lives in its playtest record, not in a commit
 * citation on the board), and this file was registered as the config's ONLY
 * `document` source. So a scaffold gets the whole tracker through the ordinary
 * template copy, with no ztrack invocation and nothing to fail — the one
 * per-project field is the H1 title, rewritten below beside every other
 * scaffold rewrite.
 *
 * Consequences worth knowing, all of them ztrack's own behavior:
 * - Every issue lives in this one file. `ztrack issue create` refuses ("no
 *   writable issue-per-file source … a document source cannot be minted
 *   into"); you add an issue by writing its `## <ID> — <title>` heading here,
 *   which is ztrack's documented path for a document source. `issue edit`,
 *   checking an AC, `check`, `export` and the editor's board all read and
 *   write it.
 * - The board starts EMPTY because the scaffold does not know the user's game
 *   brief. The installed preset emits a visible warning until the building
 *   agent carefully files the complete playable prototype as the first task.
 * - Moving to a `roadmap/` FOLDER later is a registration change, not a
 *   redesign: point the source entry at the directory instead.
 */
export const PROJECT_ROADMAP_RELATIVE_PATH = 'ROADMAP.md';

/** The project-owned Markdown journal every scaffold carries. */
export const PROJECT_DEVELOPMENT_LOG_RELATIVE_PATH = 'DEVLOG.md';

/**
 * Retitle the copied roadmap after this game — "Roadmap" deliberately leads
 * the H1 because ztrack issue ids lead issue headings, and a hyphenated project
 * slug must remain document chrome rather than becoming a phantom issue. The same shape as
 * `rewriteIndexHtml` below, and the only per-project field in the baked
 * tracker (the config and preset carry no project identity at all).
 */
function rewriteRoadmap(targetDir: string, name: string): void {
  const path = join(targetDir, PROJECT_ROADMAP_RELATIVE_PATH);
  if (!existsSync(path)) return;
  const body = readFileSync(path, 'utf-8').replace(/^# .*$/m, `# Roadmap — ${name}`);
  writeFileSync(path, body, 'utf-8');
}

/** `readEngineDependencyNames(engineDir)`, falling back to `<fallbackDir>/node_modules/@volter/game-runtime`'s own `package.json` when the primary read fails — see `pinSharedDependencyVersions`'s `fallbackDir` doc comment. */
function resolveEngineDependencyNames(
  engineDir: string,
  fallbackDir: string | undefined,
): Set<string> | undefined {
  const primary = readEngineDependencyNames(engineDir);
  if (primary) return primary;
  if (!fallbackDir) return undefined;
  return readEngineDependencyNames(join(fallbackDir, 'node_modules', '@volter', 'game-runtime'));
}

/** `readInstalledVersion(monoRoot, name)`, falling back to `readInstalledVersion(fallbackDir, name)` when the primary read fails — see `pinSharedDependencyVersions`'s `fallbackDir` doc comment. */
function readInstalledVersionWithFallback(
  monoRoot: string,
  fallbackDir: string | undefined,
  name: string,
): string | undefined {
  const primary = readInstalledVersion(monoRoot, name);
  if (primary) return primary;
  if (!fallbackDir) return undefined;
  return readInstalledVersion(fallbackDir, name);
}

function readEngineDependencyNames(engineDir: string): Set<string> | undefined {
  try {
    const enginePkg = JSON.parse(readFileSync(join(engineDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    return new Set(Object.keys(enginePkg.dependencies ?? {}));
  } catch {
    return undefined; // no engine package.json to compare against — leave ranges as-is
  }
}

/**
 * Read `packageName`'s installed version from `<monoRoot>/node_modules`.
 * Exported (not just an internal helper) so `vgai upgrade`'s CLI call site
 * (`packages/vgai-cli/src/index.ts`) can default `currentEngineVersion` from
 * `readInstalledVersion(monoRoot, '@volter/editor-project')` — the SAME resolution
 * `rewriteGameManifest`/`pinSharedDependencyVersions` use at scaffold time —
 * rather than a second, possibly-diverging lookup.
 */
export function readInstalledVersion(monoRoot: string, packageName: string): string | undefined {
  try {
    const installed = JSON.parse(
      readFileSync(join(monoRoot, 'node_modules', packageName, 'package.json'), 'utf-8'),
    ) as { version?: string };
    return installed.version;
  } catch {
    return undefined; // not installed at monoRoot — leave the template's declared range alone
  }
}

/**
 * Step 1: copy the base host template or a real `examples/<id>/` project.
 */
function materializeTemplate(
  templateDir: string,
  targetDir: string,
  examplesDir: string,
  exampleId: string | undefined,
): void {
  if (exampleId === undefined) {
    mkdirSync(targetDir, { recursive: true });
    cpSync(templateDir, targetDir, {
      recursive: true,
      filter: (src) => shouldCopyStarterPath(templateDir, src),
    });
    return;
  }

  {
    const examplesSrcDir = join(examplesDir, exampleId);
    if (!existsSync(examplesSrcDir) || !hasManifest(examplesSrcDir)) {
      // NO EXAMPLES SHIP IN THE FIRST LAUNCH (2026-09-19, docs/WORK.md §The
      // examples are ARCHIVED), so the common failure here is no longer a
      // TYPO — it is asking for a thing this release does not have. Those are
      // different refusals and a reader acts on them differently: one says
      // "check the spelling against the list", the other says "there is no
      // list". Tell them apart by whether ANY example is present.
      if (!existsSync(examplesDir) || readdirSync(examplesDir).length === 0) {
        throw new Error(
          `Cannot scaffold from example "${exampleId}": NO EXAMPLES SHIP IN THIS RELEASE.\n` +
            'They are archived whole at the git tag `archive/examples-2026-09-19` and are ' +
            'restored from it when their turn comes (docs/WORK.md §The examples are ARCHIVED).\n' +
            'Fix: create the project without --example, which scaffolds from the starter ' +
            'template your product composes.',
        );
      }
      throw new Error(
        `Unknown example id "${exampleId}": no vgai.project.json found at ${examplesSrcDir}`,
      );
    }
    mkdirSync(targetDir, { recursive: true });
    // In a source checkout, copy only files Git knows about so ignored secrets
    // and untracked build/recording output cannot enter a remix. The published
    // editor tree has already been staged from that same tracked allowlist, so
    // an installed package safely uses the bounded path filter as its fallback.
    if (!copyTrackedExampleFiles(examplesSrcDir, targetDir)) {
      cpSync(examplesSrcDir, targetDir, {
        recursive: true,
        filter: (src) => shouldCopyExamplePath(examplesSrcDir, src),
      });
    }
    return;
  }
}

/** npm intentionally omits `.gitignore` and `.npmrc` from package tarballs.
 * Restore their packaging-safe copies without replacing an example's own
 * tracked dotfiles when scaffolding directly from a source checkout. */
export function restorePackagedTemplateDotfiles(productDir: string, targetDir: string): void {
  for (const filename of ['.gitignore']) {
    const destination = join(targetDir, filename);
    if (existsSync(destination)) continue;
    const source = join(productDir, 'template-dotfiles', filename.slice(1));
    if (!existsSync(source)) {
      throw new Error(
        `Editor distribution omitted ${filename} and its template-dotfiles/${filename.slice(1)} fallback`,
      );
    }
    copyFileSync(source, destination);
  }
}

const EXAMPLE_PROJECT_SUPPORT_PATHS = [
  '.agents',
  '.claude',
  '.github',
  '.mcp.json',
  '.npmrc',
  'AGENTS.md',
  'CLAUDE.md',
  PROJECT_DEVELOPMENT_LOG_RELATIVE_PATH,
] as const;

/**
 * An example remix is a first-class standalone game, not a raw archive copy.
 * Add the same compact project-support layer as a fresh scaffold without
 * overwriting any file the example deliberately owns.
 */
function installExampleProjectSupport(templateDir: string, targetDir: string): void {
  for (const relativePath of EXAMPLE_PROJECT_SUPPORT_PATHS) {
    const source = join(templateDir, relativePath);
    const destination = join(targetDir, relativePath);
    if (!existsSync(source)) continue;
    copyMissingProjectSupport(templateDir, source, destination);
  }
}

/** Every project starts with the ordinary Markdown journal promised by the
 * scaffold contract. This runtime assertion is the tripwire: a broken package
 * or filtered template refuses to create a journal-less project. */
function assertDevelopmentLog(targetDir: string): void {
  const path = join(targetDir, PROJECT_DEVELOPMENT_LOG_RELATIVE_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `Scaffolded project is missing ${PROJECT_DEVELOPMENT_LOG_RELATIVE_PATH}; restore it from the VGAI starter template`,
    );
  }
}

/** Merge starter project support recursively while preserving example-owned files. */
function copyMissingProjectSupport(templateDir: string, source: string, destination: string): void {
  if (!shouldCopyStarterPath(templateDir, source)) return;
  const sourceStat = lstatSync(source);
  if (sourceStat.isDirectory()) {
    if (existsSync(destination) && !lstatSync(destination).isDirectory()) return;
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyMissingProjectSupport(templateDir, join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!sourceStat.isFile() || existsSync(destination)) return;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

/**
 * Return tracked paths when this example belongs to a Git checkout. An
 * installed npm package normally has no Git index; an empty result is treated
 * as unavailable so its already-sanitized packaged tree uses the fallback.
 */
function trackedExampleFiles(exampleDir: string): string[] | null {
  const result = spawnSync('git', ['-C', exampleDir, 'ls-files', '--cached', '-z', '--', '.'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || !result.stdout) return null;
  const paths = result.stdout.toString('utf8').split('\0').filter(Boolean);
  return paths.includes('vgai.project.json') ? paths : null;
}

function copyTrackedExampleFiles(exampleDir: string, targetDir: string): boolean {
  const paths = trackedExampleFiles(exampleDir);
  if (!paths) return false;
  for (const relativePath of paths) {
    const source = join(exampleDir, relativePath);
    if (!shouldCopyExamplePath(exampleDir, source)) continue;
    // `git ls-files` still reports a tracked file deleted in the current
    // working tree. Treat that exactly like a committed deletion so scaffold
    // verification can run before the migration commit lands.
    if (!existsSync(source)) continue;
    const sourceStat = lstatSync(source);
    if (!sourceStat.isFile()) {
      throw new Error(`Example remixes only accept regular tracked files: ${source}`);
    }
    const destination = join(targetDir, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return true;
}

/**
 * Accept the retired blank presentation as an identity while older editor
 * clients drain. Blank is now the normalized default tree itself; rewriting
 * its world here would recreate the obsolete second, non-prefab scene.
 */
function applyPresentation(_targetDir: string, presentation: ScaffoldPresentation): void {
  switch (presentation) {
    case 'blank':
      return;
  }
}

function writeExampleReadme(
  targetDir: string,
  projectName: string,
  exampleId: string | undefined,
): void {
  const path = join(targetDir, 'README.md');
  if (existsSync(path)) return;
  writeFileSync(
    path,
    `# ${projectName}\n\n` +
      `An editable standalone VGAI project scaffolded from the \`${exampleId ?? 'example'}\` reference. ` +
      'Its gameplay source and assets were copied unchanged; this folder is now your project.\n\n' +
      '```bash\n' +
      'npm run dev                 # open/reuse the visual editor\n' +
      'npm run vgai -- play        # verify Play mode\n' +
      'npm run typecheck\n' +
      'npm run validate-manifest\n' +
      'npm run validate-assets\n' +
      '```\n\n' +
      'Coding agents start with `AGENTS.md`; MCP-compatible hosts discover the project-scoped server through `.mcp.json`.\n',
    'utf-8',
  );
}

/** Runtime/build output beside a reference project must not enter its copy. */
export function shouldCopyExamplePath(exampleDir: string, sourcePath: string): boolean {
  const relativePath = relative(exampleDir, sourcePath).replaceAll('\\', '/');
  const topLevel = relativePath.split('/')[0] ?? '';
  const segments = relativePath.split('/');
  return (
    !['node_modules', 'dist', 'logs', '.vgai', '.git', 'package-lock.json'].includes(topLevel) &&
    !segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))
  );
}

/** Runtime/installation output beside the checked-in starter must never leak
 * into a newly-created game. This is path-relative rather than substring-
 * based so a legitimate source file whose name contains "logs" still copies. */
export function shouldCopyStarterPath(templateDir: string, sourcePath: string): boolean {
  const relativePath = relative(templateDir, sourcePath).replaceAll('\\', '/');
  const topLevel = relativePath.split('/')[0] ?? '';
  return !['node_modules', 'dist', 'logs', '.vgai'].includes(topLevel);
}

/**
 * Step 2: package.json — name + engine file dependency + pinned
 * shared deps.
 *
 */
function rewritePackageJson(
  targetDir: string,
  slug: string,
  engineDir: string,
  monoRoot: string,
): void {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [k: string]: unknown;
  };
  pkg.name = slug;
  pkg.dependencies = pkg.dependencies ?? {};
  for (const runtime of RUNTIME_PACKAGES)
    pkg.dependencies[runtime.name] = engineDependencySpec(monoRoot, runtime.name);
  // `@volter/editor-live`, `@volter/game-live` and `@volter/editor-sdk`:
  // devDependencies the template declares at a range. Rewritten to this
  // distribution's own version like every runtime package: both live clients
  // depend on `@volter/editor-sdk`, and capability source
  // (`src/tools/*.tool.ts`, editor contributions) imports `@volter/editor-sdk`
  // directly, so they are declared together.
  for (const name of ['@volter/editor-live', '@volter/game-live', '@volter/editor-sdk'] as const) {
    if (pkg.devDependencies?.[name] !== undefined) {
      pkg.devDependencies[name] = engineDependencySpec(monoRoot, name);
    }
  }
  // Anything else in-checkout: an EXAMPLE's package.json may declare further
  // @volter/* packages as `file:` specs, and those specs are meaningless
  // outside this checkout — a scaffolded project would `npm install` a path
  // that does not exist. Rewrite ANY remaining one generically rather than
  // extending the list above.
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith('@volter/') || !spec.startsWith('file:')) continue;
      deps[name] = engineDependencySpec(monoRoot, name, spec.slice('file:'.length));
    }
  }

  // A script written as `vgai <verb>` (an example's) runs through the
  // project's own `vgai` script, which the template points at this product's
  // command.
  pkg.scripts ??= {};
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (name !== 'vgai' && script.startsWith('vgai ')) {
      pkg.scripts[name] = `npm run vgai -- ${script.slice('vgai '.length)}`;
    }
  }
  pkg.devDependencies = pkg.devDependencies ?? {};
  pkg.devDependencies['@volter/editor-core'] = engineDependencySpec(monoRoot, '@volter/editor-core');
  pinSharedDependencyVersions(pkg, engineDir, monoRoot);
  pinStandaloneDependencyVersions(pkg, monoRoot);
  writeJson(pkgPath, pkg);
}

/**
 * Exported so `vgai upgrade`'s new-template snapshot (`upgrade.ts`'s
 * `reapplyScaffoldRewrites`) can reuse the exact package-native roots that a
 * fresh scaffold writes. Keeping one definition prevents upgrade snapshots
 * from drifting from newly created projects.
 */
export function resolvePackageRoots(): {
  engineRelPath: string;
  editorRelPath: string;
  liveRelPath: string;
  editorSdkRelPath: string;
} {
  return {
    engineRelPath: 'node_modules/@volter/game-runtime',
    editorRelPath: 'node_modules/@volter/editor-core',
    liveRelPath: 'node_modules/@volter/editor-live',
    editorSdkRelPath: 'node_modules/@volter/editor-sdk',
  };
}

/**
 * The dependency spec for a vgai package: a caret range on the version this
 * engine distribution currently holds.
 *
 * The manifest's exact engine compatibility pin is a separate axis and is not
 * relaxed here; this function only writes npm dependency specs.
 */
/**
 * The version of an in-checkout package, read from the directory a `file:` spec
 * points at. `readInstalledVersion` resolves against node_modules, which only
 * answers for packages the CURRENT install happens to carry — a published
 * product scaffolding an example that depends on a newer package has no
 * such entry and would otherwise fail registry-mode scaffolding outright.
 */
function versionFromCheckout(monoRoot: string, relPath: string): string | undefined {
  const cleaned = relPath.replace(/^(\.\.\/)+/, '');
  const candidate = resolve(monoRoot, cleaned, 'package.json');
  if (!existsSync(candidate)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function engineDependencySpec(monoRoot: string, packageName: string, checkoutRelPath = ''): string {
  const version =
    readInstalledVersion(monoRoot, packageName) ?? versionFromCheckout(monoRoot, checkoutRelPath);
  if (!version) {
    throw new Error(`Cannot scaffold: ${packageName} has no resolvable version in ${monoRoot}.`);
  }
  return `^${version}`;
}

/**
 * Step 3.5: vgai.project.json — name + engine.version (T3.3 §1G).
 *
 * Reuses `readInstalledVersion` — the SAME installed-version resolution
 * `pinSharedDependencyVersions` already uses for shared deps — rather than a
 * second lookup mechanism; the runtime packages resolve via the npm workspace
 * symlink at `<monoRoot>/node_modules/@volter/<pkg>` to this checkout's own
 * `packages/engine/package.json` version.
 *
 * The `empty` template ships no manifest at all (`materializeTemplate` only
 * copies `package.json`/`tsconfig.json`/`vite.config.ts`/`index.html` for
 * it), so this function writes a minimal but real one — one `three`
 * world with the `default` adapter pointing at the scaffolded default scene
 * — the FIRST time it's called for such a project. The `starter` template
 * already ships a `vgai.project.json` (stale `name`/frozen `engine.version`);
 * that file is read back and only those two fields are rewritten.
 */
function rewriteGameManifest(
  targetDir: string,
  name: string,
  slug: string,
  additions: ReadonlySet<ScaffoldAddition> | null,
  monoRoot: string,
): JsonRecord {
  const manifestPath = join(targetDir, 'vgai.project.json');
  const engineVersion = readInstalledVersion(monoRoot, '@volter/editor-project');

  let manifest: JsonRecord;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as JsonRecord;
  } else {
    manifest = {
      manifestVersion: 2,
      name,
      version: '0.1.0',
      engine: { version: engineVersion ?? '0.0.0' },
      // A three root's document IS its TSX entry. (This branch only fires when
      // the template shipped NO manifest, which it always does.)
      roots: [{ id: 'world', adapter: 'three', entry: 'src/world.tsx' }],
      resolution: { width: 1280, height: 720 },
    };
  }

  manifest['name'] = name;
  manifest['manifestVersion'] = 2;
  manifest['$schema'] = './node_modules/@volter/editor-project/schemas/vgai-project.schema.json';
  manifest['appId'] = `com.example.${slug.replace(/[^a-zA-Z0-9]/g, '')}`;
  if (additions) {
    // The empty project declares nothing; each addition declares its own
    // (ARCHITECTURE-CORE §The project model).
    const roots: JsonRecord[] = [];
    if (additions.has('three'))
      roots.push({ id: 'world', adapter: 'three', entry: 'src/world.tsx' });
    if (additions.has('ui'))
      roots.push({ id: 'ui', adapter: 'dom', entry: 'src/ui/game.tsx', zOrder: 0 });
    manifest['roots'] = roots;
    const configurations = (manifest['configurations'] as JsonRecord[] | undefined) ?? [];
    manifest['configurations'] = configurations.filter((configuration) => {
      const kind = configuration['kind'];
      if (kind === 'process' || kind === 'compound') return additions.has('server');
      return true;
    });
  }
  if (engineVersion) {
    manifest['engine'] = {
      ...(manifest['engine'] as JsonRecord | undefined),
      version: engineVersion,
    };
  }

  writeJson(manifestPath, manifest);
  return manifest;
}

/**
 * Step 5 (post-install): re-pin `engine.version` from the PROJECT's own
 * installed `@volter/editor-project`.
 *
 * `rewriteGameManifest` stamps the pin BEFORE the project's `npm install`
 * runs, from the CLI checkout's engine — the only version that exists at
 * that moment. A registry install can then resolve a NEWER published engine
 * (the checkout's package.json lags the release train between cuts), leaving
 * `vgai validate` reporting pin ≠ installed on a project nobody has touched.
 * This runs after a successful install, reads the version the project
 * ACTUALLY got, and rewrites the pin — plus the scaffold baseline's
 * `engineVersion` and the manifest's recorded hash, so pristine-baseline
 * classification (`vgai upgrade`) still sees the manifest as unchanged. A
 * `file:`-linked dev scaffold resolves to the checkout's own version, so
 * this is a no-op there.
 *
 * Returns `{from, to}` when a rewrite happened; `null` when the pin already
 * matched or no installed engine is readable (install skipped/failed — the
 * scaffold-time stamp stays, being the best value known).
 */
export function repinEngineAfterInstall(targetDir: string): { from: string; to: string } | null {
  const installed = readInstalledVersion(targetDir, '@volter/editor-project');
  if (!installed) return null;
  const manifestPath = resolveManifestPath(targetDir);
  let manifest: JsonRecord;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as JsonRecord;
  } catch {
    return null;
  }
  const engine = (manifest['engine'] ?? {}) as JsonRecord;
  const from = typeof engine['version'] === 'string' ? engine['version'] : '';
  if (from === installed) return null;
  manifest['engine'] = { ...engine, version: installed };
  writeJson(manifestPath, manifest);

  const baselinePath = join(targetDir, SCAFFOLD_BASELINE_RELATIVE_PATH);
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as ScaffoldBaseline;
    baseline.engineVersion = installed;
    baseline.files['vgai.project.json'] = hashFile(manifestPath);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
  } catch {
    // No baseline (or unreadable) — nothing to keep consistent with.
  }
  return { from, to: installed };
}

/**
 * Step 6 (post-install, sibling of {@link repinEngineAfterInstall}): point a
 * project scaffolded FROM A CHECKOUT at that checkout's own `@volter/*`
 * packages.
 *
 * THE DEFECT THIS CLOSES. A scaffolded project declares ordinary versioned
 * dependencies (`engineDependencySpec` above writes `^<version>`), so its own
 * `npm install` fetches `@volter/editor-core` from the REGISTRY — even when the CLI
 * that scaffolded it is this checkout's. `@volter/editor-core` is where the
 * CAPABILITY CATALOG lives, and `vgai add` copies from the catalog of
 * whichever distribution answers (`catalogDistributionDir()` in
 * `packages/vgai-cli/src/index.ts`, resolved from the RUNNING CLI's own root
 * — and a project's `npm run vgai` runs the project's OWN
 * `node_modules/.bin/vgai`, which the scaffold's package.json scripts point
 * every other verb at). Measured on a minutes-old scaffold, 2026-08-20:
 * `vgai add unity-compat` copied capability 0.22.0 while this checkout's
 * catalog was at 0.29.0 — seven versions of the day's work silently absent,
 * with nothing to notice it by, because the PACKAGE version was 0.5.22 on
 * both sides. `removeCapabilities`'s doc in ./catalog.ts measured the same
 * split from the other end (`static-batch` 0.1.2 vs 0.1.1).
 *
 * THE RULE. A scaffold created from a checkout uses that checkout's catalog;
 * a scaffold created from a published install uses its published catalog.
 * So the CONTEXT is read off the scaffolding root itself — see
 * {@link checkoutVgaiPackageDirs} — and this is a no-op in a published
 * install. Deliberately no environment variable: a dev loop that is only true
 * when you remember to export something is not true.
 *
 * THE MECHANISM is transcribed from the import lane's own acceptance run
 * (`packages/gd-analyze/src/import-project.ts`, `runAcceptance`), which has
 * always done exactly this — and is why the import lanes never saw the stale
 * catalog while a human's create did: `npm link --no-save <checkout
 * package dirs>`. `--no-save` leaves `package.json` and the lockfile naming
 * ordinary versioned packages, so the project stays location-free and
 * publishable; only the on-disk `node_modules` entries change — including the
 * `.bin` shims, which is what redirects `npm run vgai` at the checkout's CLI.
 *
 * Runs BEFORE `repinEngineAfterInstall`, so the re-pin reads the version the
 * project actually has after linking (the checkout's) rather than the
 * registry version it briefly held.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
export type NpmLinkRunner = (projectDir: string, packageDirs: readonly string[]) => void;

const runNpmLink: NpmLinkRunner = (projectDir, packageDirs) => {
  // THE GLOBAL `vgai` IS NOT OURS TO MOVE. `npm link <dir>` is two steps, and
  // the first one is GLOBAL: it links each named directory into the npm
  // prefix, which on this box is where the `vgai` every other session resolves
  // lives. Scaffolding from a task checkout therefore silently retargeted the
  // box's CLI at that checkout -- measured twice, and docs/LOCAL-DEV.md says
  // the global links point at the donor checkout and nowhere else.
  //
  // So the global half is redirected into a prefix the CHECKOUT owns. The
  // project still gets its `node_modules/@volter/*` symlinks and `.bin` shims,
  // because those resolve through this prefix to the same checkout
  // directories; the box's real prefix is never written. The prefix is stable
  // rather than temporary on purpose -- the project's symlinks point INTO it,
  // so a directory deleted afterwards would leave a dangling chain.
  const checkout = packageDirs[0] ? resolve(packageDirs[0], '..', '..') : projectDir;
  const prefix = join(checkout, '.vgai', 'npm-link-prefix');
  // npm's global layout under a prefix is `lib/node_modules` (+ `bin`), and
  // `npm link` lstats `lib` before creating anything: an empty prefix dir
  // fails with ENOENT and the scaffold silently keeps the registry's
  // `@volter/editor-core` (measured 2026-09-17 — a blind probe walked a published
  // shell believing it was this checkout's).
  mkdirSync(join(prefix, 'lib', 'node_modules'), { recursive: true });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  const result = spawnSync('npm', ['link', '--no-save', ...packageDirs], {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, npm_config_prefix: prefix },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm link exited with code ${result.status ?? 'unknown'}`);
  }
};

export interface CheckoutLinkPlan {
  /** `@volter/*` package names to be linked, sorted. Empty means "nothing to do" — a published install, or a project that declares none. */
  packages: string[];
  /** The checkout directories for {@link packages}, in the same order — what `npm link` is handed. */
  directories: string[];
}

/**
 * Every `@volter/*` package `monoRoot` owns AS SOURCE, name → absolute
 * directory.
 *
 * This IS the context test, and it is asked positively: rather than guessing
 * "is this a checkout?" from one path, read what the root actually owns.
 * A directory qualifies when it is a directory whose own `package.json` names
 * an `@volter/*` package. A published install (whose `monoRoot` is the
 * consumer's own project root) has no `packages/` tree at all, so the map
 * comes back empty and every caller no-ops. Scanning rather than hardcoding a
 * list also means a package added to the repository — or an example's extra
 * dependency — is covered without editing this file.
 *
 * IT USED TO REQUIRE A `src/` TREE, and that silently excluded a real package
 * (2026-09-19, the L1 split): `@volter/blender-engine`'s trees are `browser/`,
 * `wasm/` and `bench/` — it has no `src/` — so the scaffolder never saw it,
 * never rewrote its `private` spec to a `file:` path, and the models
 * scaffold's first `npm install` 404'd on it at the registry. The `src/`
 * clause was carrying two jobs at once (is-this-a-directory, and
 * is-this-a-package); both are asked directly now, and neither invents a
 * layout every package must have. `packages/package-estate.mjs` already
 * spells the same fact the other way round ("the package directory itself for
 * a package with no `src/`").
 */
export function checkoutVgaiPackageDirs(monoRoot: string): Map<string, string> {
  const found = new Map<string, string>();
  const packagesDir = join(monoRoot, 'packages');
  let entries: string[];
  try {
    entries = readdirSync(packagesDir);
  } catch {
    return found; // no `packages/` at all — a published install
  }
  for (const entry of entries) {
    const dir = join(packagesDir, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    let name: unknown;
    try {
      name = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { name?: unknown })
        .name;
    } catch {
      continue; // no/unreadable package.json — not a package we can link
    }
    if (typeof name === 'string' && name.startsWith('@volter/')) found.set(name, dir);
  }
  return found;
}

/** The `@volter/*` packages `projectDir`'s package.json declares (both sections), sorted. */
function declaredVgaiDependencies(projectDir: string): string[] {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  return [
    ...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]),
  ]
    .filter((name) => name.startsWith('@volter/'))
    .sort();
}

/**
 * What {@link linkCheckoutPackages} would link: the intersection of the
 * project's DECLARED `@volter/*` dependencies with the packages the scaffolding
 * root owns as source. Only declared packages, so linking never adds a
 * dependency the project does not have.
 */
export function planCheckoutLink(projectDir: string, monoRoot: string): CheckoutLinkPlan {
  const owned = checkoutVgaiPackageDirs(monoRoot);
  if (owned.size === 0) return { packages: [], directories: [] };
  const packages = declaredVgaiDependencies(projectDir).filter((name) => owned.has(name));
  return { packages, directories: packages.map((name) => owned.get(name) as string) };
}

/**
 * A DECLARED `@volter/*` DEPENDENCY THIS CHECKOUT OWNS points at the checkout,
 * not at the registry.
 *
 * `@volter/editor-blender` and `@volter/blender-engine` are the packages in the estate
 * marked `private: true`. The licence question is SETTLED (2026-09-19,
 * ARCHITECTURE-CORE §Licensing): the engine is Blender, so it is
 * GPL-3.0-or-later in its own package, and the driver stays AGPL. What still
 * gates PUBLICATION is the corresponding source — a GPL binary is conveyed
 * only with the fork, patches and recipe its manifest names, and that
 * repository does not exist yet (work order L0, WORK.md PHASE 2).
 * A models project must nevertheless DECLARE both: `@volter/editor-blender` is the
 * package that edits models (the Model document, the finder, the Blender
 * look) and the editor server enumerates a package's contributions only for
 * the dependencies the open project declares, while `@volter/blender-engine` is
 * its dependency and npm cannot fetch a private package transitively either.
 * Left as `^<version>`, the scaffold's very first `npm install` 404s on them
 * and the project gets no `node_modules` at all.
 *
 * So the spec written for such a package is the ABSOLUTE `file:` path of the
 * checkout directory — which is what it honestly is, and the same place
 * {@link linkCheckoutPackages} points `node_modules` at one step later.
 *
 * IT IS EVERY CHECKOUT-OWNED PACKAGE, not only the private ones (widened
 * 2026-09-21, when the engine split into `@volter/editor-project`,
 * `@volter/threejs-runtime` and `@volter/game-runtime`). `private: true` was a
 * PROXY for "the registry cannot serve it", and the proxy broke the first time
 * a checkout grew a public package the registry had never seen: the scaffold's
 * very first `npm install` 404s on it and the project gets no `node_modules`
 * at all. The general fact is simpler and always true — a project scaffolded
 * FROM a checkout uses THAT checkout's `@volter/*` packages (the two comments at
 * `linkCheckoutPackages`' call sites say so, and that step overwrites whatever
 * the registry served anyway), so fetching them is waste at best and a 404 at
 * worst.
 *
 * Scaffolding from a PUBLISHED install owns no packages, so nothing is
 * rewritten and the caret spec stands.
 *
 * Returns the names it rewrote.
 */
export function pointUnpublishedPackagesAtCheckout(projectDir: string, monoRoot: string): string[] {
  const pkgPath = join(projectDir, 'package.json');
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  const rewritten: string[] = [];
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      const spec = checkoutPackageSpec(name, monoRoot);
      if (spec === null || deps[name] === spec) continue;
      deps[name] = spec;
      rewritten.push(name);
    }
  }
  if (rewritten.length > 0) writeJson(pkgPath, pkg);
  return rewritten;
}

/**
 * THE ONE DECISION, so both paths that need it ask the same question: what
 * spec should this dependency have in a project scaffolded from THIS checkout?
 * `file:<dir>` for a checkout-owned package the registry cannot serve; `null`
 * for everything else, meaning "leave the caller's spec alone".
 *
 * IT EXISTS BECAUSE THE TWO PATHS DISAGREED, and the disagreement was a real
 * refusal a probe hit (2026-09-19, WORK.md §The mesh kit retires, the
 * r15-blocky entry): `scaffoldProject` ran {@link
 * pointUnpublishedPackagesAtCheckout} AFTER `addCapabilities`, so a project's
 * `package.json` already said `"@volter/editor-blender": "file:<checkout>"` — and a
 * LATER `vgai add <capability that requires it>` computed the desired `0.1.0`
 * from the catalog entry, saw a different existing value, and threw
 * `Capability mesh requires dependencies.@volter/editor-blender=0.1.0, but the project
 * package.json already set …=file:…`. Unpinning to `0.1.0` then 404s, because
 * the package is `private`. So `addCapabilities` now asks this function about
 * every incoming spec (its `resolveDependencySpec` option), which makes the
 * capability's spec and the project's the SAME string — and a newly
 * introduced private package lands pointed at the checkout rather than at a
 * version npm cannot fetch.
 */
export function checkoutPackageSpec(name: string, monoRoot: string): string | null {
  const dir = checkoutVgaiPackageDirs(monoRoot).get(name);
  return dir === undefined ? null : `file:${dir}`;
}

export type PackageBuildRunner = (packageDir: string) => void;

const runPackageBuild: PackageBuildRunner = (packageDir) => {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm run build exited with code ${result.status ?? 'unknown'} in ${packageDir}`,
    );
  }
};

/** One `bin` entry of a checkout package: the shim name npm will write, and the file it must point at. */
interface DeclaredBin {
  /** Package that declares it, for messages. */
  packageName: string;
  /** The `node_modules/.bin/<name>` npm creates. */
  binName: string;
  /** Absolute path to the file the shim targets. */
  target: string;
  /** Absolute path to the declaring package directory. */
  packageDir: string;
  /** Whether that package has a `build` script that could produce {@link target}. */
  buildable: boolean;
}

/** Every `bin` a checkout package directory declares, normalized (npm accepts a string or a map). */
function declaredBins(packageDir: string): DeclaredBin[] {
  let pkg: { name?: unknown; bin?: unknown; scripts?: Record<string, unknown> };
  try {
    pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  const packageName = typeof pkg.name === 'string' ? pkg.name : basename(packageDir);
  const buildable = typeof pkg.scripts?.['build'] === 'string';
  const entries: [string, unknown][] =
    typeof pkg.bin === 'string'
      ? [[basename(packageName), pkg.bin]]
      : pkg.bin && typeof pkg.bin === 'object'
        ? Object.entries(pkg.bin as Record<string, unknown>)
        : [];
  return entries.flatMap(([binName, rel]) =>
    typeof rel === 'string'
      ? [{ packageName, binName, target: join(packageDir, rel), packageDir, buildable }]
      : [],
  );
}

/**
 * Pre-link repair: build any checkout package whose declared `bin` target does
 * not exist on disk yet.
 *
 * THE DEFECT THIS CLOSES (measured on a fresh scaffold, 2026-08-29). `npm
 * link` writes a `node_modules/.bin/<name>` shim only when the linked
 * package's `bin` target FILE EXISTS — when it does not, npm links the
 * package and SILENTLY writes no shim. `@volter/game-editor`'s bin is
 * `dist-node/cli.js`, which a checkout only has after `npm run build:node -w
 * @volter/game-editor`. So {@link linkCheckoutPackages} would swap the
 * project's WORKING registry package (whose published tarball ships its
 * build) for a checkout copy with no bin — and the project's own documented door,
 * `npm run vgai -- <verb>`, died with `sh: vgai: command not found` on a
 * minutes-old scaffold. Linking must never take away a bin the plain install
 * had.
 *
 * Only MISSING targets are built; a stale one is a different question and
 * already has its own guard (`ensureCliDistFresh` in
 * `packages/vgai-cli/src/dist-freshness.ts`). A package with no `build`
 * script and no target is left alone — {@link assertLinkedBins} reports it
 * after the link, where the evidence is what the project actually got.
 */
export function ensureCheckoutBinTargets(
  directories: readonly string[],
  build: PackageBuildRunner = runPackageBuild,
): string[] {
  const built: string[] = [];
  for (const dir of directories) {
    const missing = declaredBins(dir).find((bin) => !existsSync(bin.target));
    if (!missing || !missing.buildable) continue;
    build(dir);
    built.push(missing.packageName);
  }
  return built;
}

/**
 * Post-link proof, because the failure this guards against is npm succeeding
 * quietly: assert every bin the linked checkout packages declare actually
 * arrived at `node_modules/.bin/`. Throws naming the package, the shim, and
 * the file that was not there.
 */
export function assertLinkedBins(projectDir: string, directories: readonly string[]): void {
  const binDir = join(projectDir, 'node_modules', '.bin');
  const absent = directories
    .flatMap((dir) => declaredBins(dir))
    .filter((bin) => !existsSync(join(binDir, bin.binName)));
  if (absent.length === 0) return;
  throw new Error(
    `npm link wrote no bin shim for ${absent.map((b) => `${b.packageName} (${b.binName})`).join(', ')} — ` +
      `npm skips a bin whose target file is missing: ${absent.map((b) => b.target).join(', ')}. ` +
      'Build the package in the checkout and re-run.',
  );
}

/**
 * Run {@link planCheckoutLink}'s plan. Returns the plan (empty ⇒ nothing ran).
 * Throws if `npm link` fails, or if the link left a declared bin unshimmed
 * (see {@link ensureCheckoutBinTargets}) — the caller owns the message.
 */
export function linkCheckoutPackages(
  projectDir: string,
  monoRoot: string,
  run: NpmLinkRunner = runNpmLink,
): CheckoutLinkPlan {
  const plan = planCheckoutLink(projectDir, monoRoot);
  if (plan.packages.length === 0) return plan;
  ensureCheckoutBinTargets(plan.directories);
  run(projectDir, plan.directories);
  assertLinkedBins(projectDir, plan.directories);
  return plan;
}

/**
 * Leave exactly `wanted` as the project's editor-side `devDependencies`, at
 * the spec the template already used for one of them.
 *
 * A composition's product and lanes are a REPLACEMENT, not an addition: the
 * base template is the game editor's full set, and a modeling scaffold must
 * end up with the model editor and none of the game editor's lanes — two
 * products in one project is a refusal `vgai edit` states by name.
 *
 * WHICH of the template's `@volter/*` are "editor-side" is read from the KIT's
 * side, the only side a library may name: everything the kit itself puts in a
 * project ({@link KIT_DECLARED_PACKAGES}) stays, and every other `@volter/*`
 * devDependency is the previous product's composition and goes.
 */
function writeEditorPackages(targetDir: string, wanted: readonly string[]): void {
  const pkgPath = join(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const kit = new Set<string>(KIT_DECLARED_PACKAGES);
  const replaced = Object.keys(pkg.devDependencies ?? {}).filter(
    (name) => name.startsWith('@volter/') && !kit.has(name),
  );
  // The editor-side packages release in lockstep with `@volter/editor-core`,
  // the kit package every project declares, whose spec `rewritePackageJson`
  // has just computed from this distribution's installed version. The
  // template's own editor-side spec is the fallback.
  const spec =
    pkg.devDependencies?.['@volter/editor-core'] ??
    replaced.map((name) => pkg.devDependencies?.[name]).find((value) => value !== undefined) ??
    '*';
  for (const name of [...replaced, ...wanted]) {
    delete pkg.dependencies?.[name];
    delete pkg.devDependencies?.[name];
  }
  pkg.devDependencies ??= {};
  for (const name of wanted) pkg.devDependencies[name] = spec;
  pkg.devDependencies = Object.fromEntries(
    Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeJson(pkgPath, pkg);
}

/**
 * A React-only scaffold must be genuinely React-only.
 */
function rewriteTemplateVariantFiles(
  targetDir: string,
  composition: ScaffoldComposition,
  additions: ReadonlySet<ScaffoldAddition>,
  starterDir: string,
): void {
  if (!additions.has('three') || !additions.has('studio')) {
    for (const relative of STUDIO_OWNED_PATHS) {
      rmSync(join(targetDir, relative), { force: true });
    }
  }
  // THE PRODUCT THIS PROJECT OPENS IN, and the editor-side packages beside it —
  // the composition its product handed over. The template carries the game
  // editor's set because it is that product's full starting point; every other
  // composition is this rewrite. Which product runs is never a switch — it is
  // what the project installed — so writing the name here IS the choice
  // (ARCHITECTURE-CORE §The target shape, rule 4), and the name came from the
  // product, never from this library.
  writeEditorPackages(targetDir, composition.editorPackages);
  if (!additions.has('three')) {
    // No 3D world: the template's composition goes, and the adapter declares
    // no region of its own (the additions that stay declare theirs).
    for (const relative of THREE_OWNED_PATHS) {
      rmSync(join(targetDir, relative), { recursive: true, force: true });
    }
    writeFileSync(join(targetDir, 'vgai.adapter.ts'), adapterSourceFor(additions), 'utf-8');
  } else {
    // The template's adapter keeps its scene and prefab finders; the finders
    // the other additions bring join them.
    const adapterPath = join(targetDir, 'vgai.adapter.ts');
    const source = joinAdditionFinders(readFileSync(adapterPath, 'utf-8'), additions);
    writeFileSync(adapterPath, source, 'utf-8');
  }
  if (additions.has('blender')) {
    // THE STARTER MODEL IS A `.blend` AND THE bpy THAT MADE IT
    // (ARCHITECTURE-CORE §The project model, "A model is Blender data"). Not a
    // string written from here: a `.blend` is Blender's binary document, so it
    // is a real file Blender itself wrote (`starter/` in this
    // package, authored through a live session on 2026-09-19 — a 1 m cube,
    // 8 verts, 6 faces, uncompressed `BLENDER_v502`). `cube.py` is its SOURCE
    // and stays in the project beside it; the Model document does not run it —
    // a person or an agent does, through the session's Blender.
    //
    // It used to be `src/models/cube.ts` exporting `build(): BufferGeometry`
    // with a tsconfig relaxation beside it (`noUncheckedIndexedAccess` off,
    // because a model module was a math script over rings and profiles). Both
    // are gone with the TypeScript model module itself: modeling happens in
    // Blender now, and a models project's own TypeScript is its adapter.
    mkdirSync(join(targetDir, 'src', 'models'), { recursive: true });
    for (const file of STARTER_MODEL_FILES) {
      const source = join(starterDir, file);
      if (!existsSync(source))
        throw new Error(
          `Cannot scaffold a models project: the starter model ${file} is missing from ` +
            `${starterDir}. It is a real Blender document, not a string this scaffolder can ` +
            'write, so there is nothing to fall back to.',
        );
      writeFileSync(join(targetDir, 'src', 'models', file), readFileSync(source));
    }
  }
  if (!additions.has('ui')) return;
  if (additions.has('three')) {
    // Composed with a 3D world the React root is an ADDITION: its own files
    // land beside the world and nothing of the world is removed
    // (`compositionKeepsPath` states the same rule for the browser seed).
    // The template's `main.ts` already registers both adapters.
    for (const [relative, source] of Object.entries(REACT_ONLY_FILES)) {
      if (relative === 'src/main.ts') continue;
      mkdirSync(dirname(join(targetDir, relative)), { recursive: true });
      writeFileSync(join(targetDir, relative), source, 'utf-8');
    }
    return;
  }
  // React-only must be a genuinely React-only starting point, not the default
  // Three.js starter with a different manifest. Dormant scene components and
  // inspector tools still participate in `tsc`; a game that legitimately
  // changes its own tuning schema would otherwise have to repair irrelevant
  // spinner/tool demo code before it could pass typecheck.
  for (const relative of REACT_ONLY_REMOVED_PATHS) {
    rmSync(join(targetDir, relative), { recursive: true, force: true });
  }
  mkdirSync(join(targetDir, 'public'), { recursive: true });
  mkdirSync(join(targetDir, 'src', 'ui'), { recursive: true });
  for (const [relative, source] of Object.entries(REACT_ONLY_FILES)) {
    writeFileSync(join(targetDir, relative), source, 'utf-8');
  }
}

/**
 * Step 4: tsconfig.json — normalize package path mappings and the `files` array
 * (the T3.6 bug: previously copied verbatim from the template, breaking
 * `tsc` in every project not scaffolded at the template's exact depth).
 *
 * `@volter/editor-live` itself gets no mapping — it resolves off `node_modules` like
 * any other devDependency. Its TRANSITIVE reach does need one, though: the
 * project's tools and logic tests import `GameClient` from it, its emitted
 * `.d.ts` names `@volter/editor-sdk` types, and `@volter/editor-sdk` is a
 * SOURCE export whose own files import `@volter/editor-project/manifest/load` etc. A single `tsc` program
 * resolves every reachable file under ITS OWN compilerOptions, and
 * a runtime package's export map points at extensionless `./src/*` — which
 * `tsc` cannot follow to a `.ts`. All three are therefore mapped here for the
 * same reason a package's own tsconfig carries the identical alias. It changes no emitted specifier (this project is
 * `noEmit`) and nothing at runtime, where npm's own resolution applies.
 */

function rewriteTsconfig(targetDir: string, engineRelPath: string, editorRelPath: string): void {
  const tsconfigPath = join(targetDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return;

  // tsconfig.json is natively JSONC. Shipped Pixi examples use comments to
  // explain their browser/Node split, so strict JSON parsing makes an example
  // remix fail even though TypeScript accepts the source config.
  const parseErrors: ParseError[] = [];
  const tsconfig = parseJsonc(readFileSync(tsconfigPath, 'utf-8'), parseErrors, {
    allowTrailingComma: true,
  }) as {
    compilerOptions?: { paths?: Record<string, string[]> };
    files?: string[];
    [k: string]: unknown;
  };
  if (parseErrors.length > 0) {
    const details = parseErrors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ');
    throw new Error(`Invalid TypeScript config ${tsconfigPath}: ${details}`);
  }
  tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};
  tsconfig.compilerOptions.paths = {
    ...Object.fromEntries(
      RUNTIME_PACKAGES.map((runtime) => [
        `${runtime.name}/*`,
        [`node_modules/${runtime.name}/src/*`],
      ]),
    ),
    // `@volter/editor-blender`'s two VALUE exports — the look and the layout a models
    // project's `vgai.adapter.ts` imports. Spelled entry by entry rather than
    // as a wildcard because the package's `exports` names them individually;
    // both entries are inert for a project that never declares the package.
    '@volter/editor-blender/looks': ['node_modules/@volter/editor-blender/src/looks.ts'],
    '@volter/editor-blender/layouts': ['node_modules/@volter/editor-blender/src/layouts.tsx'],
  };
  // `@editor/*`: the editor's own deep specifiers a project still names —
  // `@editor/game-module-access` in `src/contributions/`, and the R3F
  // authoring analyzer `check-idioms.ts` loads. The mapping makes both
  // typecheck in the scaffolded project (at runtime the editor's own Vite
  // server resolves the alias instead). The WIDGET KIT is not one of them: a
  // contribution imports `@volter/editor-sdk/widgets`, an ordinary package
  // export that needs no mapping.
  if (editorRelPath) {
    tsconfig.compilerOptions.paths['@editor/*'] = [`${editorRelPath}/src/*`];
  }
  if (Array.isArray(tsconfig.files)) {
    tsconfig.files = tsconfig.files.map((f) => rewriteEngineRelativeFilePath(f, engineRelPath));
  }
  writeJson(tsconfigPath, tsconfig);
}

/** Step 5: keep Vite's React singleton guard present in every copied project. */
function rewriteViteConfig(targetDir: string): void {
  const vitePath = join(targetDir, 'vite.config.ts');
  if (!existsSync(vitePath)) return;
  writeFileSync(vitePath, rewriteViteConfigContent(readFileSync(vitePath, 'utf-8')), 'utf-8');
}

/**
 * The pure text rewrite behind {@link rewriteViteConfig} — exported so
 * `vgai upgrade`'s new-template snapshot (`upgrade.ts`'s
 * `reapplyScaffoldRewrites`) applies the exact same transformation. Engine,
 * editor, P2P, and config-time data imports are package-native already and
 * therefore need no checkout-relative rewriting.
 */
export function rewriteViteConfigContent(content: string): string {
  return ensureReactDedupe(content);
}

/**
 * Guarantees the scaffolded `vite.config.ts` dedupes `react`/`react-dom`
 * (GH #123 — see the matching comment in `packages/editor/template/
 * vite.config.ts` for the full dual-React root cause). Called from
 * {@link rewriteViteConfigContent}, which runs for EVERY scaffold path —
 * both the starter template (already ships the dedupe entry as static
 * source, so this is a no-op there) and `template: 'example'` scaffolds,
 * which copy an `examples/<id>/vite.config.ts` that mostly does NOT ship it
 * (`examples/r3f-first-party/vite.config.ts` is the one exception, already
 * deduping `three`/`react`/`react-dom` for the equivalent react-world
 * reason). `rewriteViteConfigContent` is also the exact function
 * `upgrade.ts`'s `reapplyScaffoldRewrites` reuses to build the new-template
 * snapshot for 3-way classification, so an existing project with an
 * unmodified `vite.config.ts` picks up the dedupe automatically on `vgai
 * upgrade` (classified `template-updated`); a hand-edited `vite.config.ts`
 * is classified `user-edited` and left alone, same as any other
 * user customization.
 *
 * Idempotent and merge-aware: if a `resolve.dedupe` array is already
 * present, only the entries actually missing are appended — never a SECOND
 * `dedupe` key, which would silently shadow the first in the object
 * literal.
 */
export function ensureReactDedupe(content: string): string {
  const REQUIRED = ['react', 'react-dom'];
  const dedupeMatch = content.match(/dedupe:\s*\[([^\]]*)\]/);
  if (dedupeMatch) {
    const inner = dedupeMatch[1] ?? '';
    const missing = REQUIRED.filter((name) => !new RegExp(`['"]${name}['"]`).test(inner));
    if (missing.length === 0) return content;
    const trimmed = inner.trim();
    const additions = missing.map((name) => `'${name}'`).join(', ');
    const newInner =
      trimmed.length === 0 ? additions : `${inner.replace(/,\s*$/, '')}, ${additions}`;
    return content.replace(dedupeMatch[0], `dedupe: [${newInner}]`);
  }

  if (!/resolve:\s*{/.test(content)) return content;
  return content.replace(
    /resolve:\s*{/,
    "resolve: {\n    // react/react-dom dedupe (GH #123): see packages/editor/template/vite.config.ts's\n" +
      '    // matching comment for the dual-React-instance root cause this avoids.\n' +
      "    dedupe: ['react', 'react-dom'],",
  );
}

/** Step 6: index.html — set the title. */
function rewriteIndexHtml(targetDir: string, name: string): void {
  const htmlPath = join(targetDir, 'index.html');
  if (!existsSync(htmlPath)) return;

  const html = readFileSync(htmlPath, 'utf-8').replace(
    /<title>.*<\/title>/,
    `<title>${name}</title>`,
  );
  writeFileSync(htmlPath, html, 'utf-8');
}

/**
 * Scaffold a new game project from the editor template into `opts.targetDir`.
 * Copies template files, then rewrites every path that encodes this
 * source example's location (package dependency versions, tsconfig package
 * mappings and `files` array, Vite package aliases, index.html's title, and
 * the v2 manifest's name/appId/schema location).
 *
 * Does NOT run `npm install` — that is a caller-owned side effect.
 */
export function scaffoldProject(opts: ScaffoldOptions): ScaffoldResult {
  const { name, targetDir, monoRoot, exampleId } = opts;
  // An example is a finished project, copied whole: it declares its own
  // product, adapter and dependencies, so there is no composition to apply.
  const composed = exampleId === undefined;
  const additions: ReadonlySet<ScaffoldAddition> | null = composed
    ? new Set<ScaffoldAddition>(closeAdditions(opts.additions ?? []))
    : null;
  if (composed && !opts.composition) {
    throw new Error(
      'scaffoldProject: a composed project needs `composition` — the editor-side packages and ' +
        'editor declaration its PRODUCT declares (./product.ts). Only an ' +
        '`exampleId` scaffold goes without one.',
    );
  }
  const composition = opts.composition;

  const slug = slugify(name) || slugify(basename(targetDir));
  if (!slug) throw new Error('Invalid project name');

  if (existsSync(targetDir)) {
    throw new Error(`Directory already exists: ${targetDir}`);
  }

  const { productDir } = opts;
  const templateDir = join(productDir, 'template');
  const examplesDir = resolveScaffoldExamplesDir(monoRoot, productDir);
  const catalogDir = join(productDir, 'catalog');
  const engineDir = resolveScaffoldPackageDir(
    monoRoot,
    join('packages', 'game-runtime'),
    '@volter/game-runtime',
  );

  // Example remixes copy gameplay from examples/<id> and the compact project
  // support layer from the starter, so every route requires the template.
  if (!existsSync(templateDir)) {
    throw new Error(`Template not found at ${templateDir}. Is this product installed intact?`);
  }
  const hasCapabilityDistribution = existsSync(catalogDir);

  materializeTemplate(templateDir, targetDir, examplesDir, exampleId);
  restorePackagedTemplateDotfiles(productDir, targetDir);
  if (exampleId !== undefined) {
    installExampleProjectSupport(templateDir, targetDir);
    writeExampleReadme(targetDir, name, exampleId);
  }
  assertDevelopmentLog(targetDir);
  // Older callers may still send the retired identity presentation.
  if (opts.presentation) applyPresentation(targetDir, opts.presentation);

  const { engineRelPath, editorRelPath } = resolvePackageRoots();

  rewritePackageJson(targetDir, slug, engineDir, monoRoot);
  const manifest = rewriteGameManifest(targetDir, name, slug, additions, monoRoot);
  if (additions && composition) {
    rewriteTemplateVariantFiles(
      targetDir,
      composition,
      additions,
      resolveScaffoldStarterDir(productDir),
    );
    const adapterPath = join(targetDir, 'vgai.adapter.ts');
    writeFileSync(
      adapterPath,
      withEditorDeclaration(readFileSync(adapterPath, 'utf-8'), composition.editor),
      'utf-8',
    );
    const agentsPath = join(targetDir, 'AGENTS.md');
    writeFileSync(
      agentsPath,
      withAgentsContract(readFileSync(agentsPath, 'utf-8'), additions),
      'utf-8',
    );
  }
  rewriteTsconfig(targetDir, engineRelPath, editorRelPath);
  rewriteViteConfig(targetDir);
  rewriteIndexHtml(targetDir, name);
  rewriteRoadmap(targetDir, name);
  if (hasCapabilityDistribution) initializeProjectCatalog(targetDir, catalogDir);
  if (hasCapabilityDistribution && additions) {
    const ids = [
      ...(additions.has('ui') ? DEFAULT_REACT_CAPABILITIES : []),
      ...(additions.has('blender') ? (['blender'] as const) : []),
    ];
    if (ids.length > 0)
      addCapabilities({
        catalogDir,
        ids: [...ids],
        projectDir: targetDir,
        resolveDependencySpec: (name, spec) => checkoutPackageSpec(name, monoRoot) ?? spec,
      });
  }
  // A capability may declare a package the REGISTRY cannot serve (the two
  // blender packages are `private` until the GPL engine's corresponding source
  // is published — L0). Point those at this checkout, or the project's first
  // `npm install` 404s before anything else can run.
  pointUnpublishedPackagesAtCheckout(targetDir, monoRoot);

  // Pristine baseline (T2.3/D3 §1.D) — hashed AFTER every rewrite above, so
  // rewritten files (package.json, tsconfig.json, vite.config.ts,
  // vgai.project.json, ...) are recorded at their FINAL post-rewrite content,
  // not the template's pre-rewrite copy.
  const engineVersion = readInstalledVersion(monoRoot, '@volter/editor-project') ?? '0.0.0';
  writeScaffoldBaseline(targetDir, engineVersion, engineDir);

  return { targetDir, slug, manifest };
}
