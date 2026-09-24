/**
 * Project authoring capabilities.
 *
 * The editor package ships the catalog, project-owned source payloads, and
 * canonical skills. A scaffold installs the capabilities selected by its
 * template; `vgai capabilities add` uses the same code later. The project keeps
 * only a small catalog plus an ownership file under `.vgai/catalog/`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import { mergeAdapterRegionIncludes, type RegionIncludeAddition } from './adapter-region-merge.js';

export const PROJECT_CATALOG_DIR = join('.vgai', 'catalog');

/** The neutral Three starter deliberately installs no game-specific capability. */
export const DEFAULT_THREEJS_CAPABILITIES = [] as const;

/** The React composition needs its project-owned DOM-root adapter implementation. */
export const DEFAULT_REACT_CAPABILITIES = ['react-root'] as const;

/**
 * One library binary a capability's SOURCE reads at runtime, in the exact shape
 * `asset-manifest.json` declares (`packages/editor/src/asset-workflow/asset-pack-manifest.ts`).
 *
 * Why a capability declares this at all: a capability is source, and source can
 * be copied. Its reference BINARIES cannot — they are 7 MB library objects that
 * would be hand-placed files with no provenance if they rode along in `files`.
 * So the capability declares the pack, `addCapabilities` merges the declaration
 * into the project's own `asset-manifest.json`, and the bytes arrive through the
 * one materialization contract (D-AP1/D-AP3: pinned digest, verified fetch,
 * `.vgai/assets.json` ledger). Without this, `vgai add humanoid` landed source
 * that fetched a URL nothing had ever delivered.
 */
export interface CatalogAssetPackEntry {
  /** `source:id` — the library's variant-precise identity. */
  key: string;
  /** Project-relative destination the bytes are materialized to. */
  dest: string;
  /** The PIN: sha256 of those bytes, 64 lowercase hex digits. */
  sha256: string;
}

/** The three native surfaces a manifest root can render on. */
export type CatalogSurface = 'three' | 'canvas' | 'dom';

export const CATALOG_SURFACES: readonly CatalogSurface[] = ['three', 'canvas', 'dom'];

export interface CatalogEntry {
  /** Named packs this capability's source needs on disk, merged into the
   *  project's `asset-manifest.json` when the capability is added. */
  assetPacks?: Record<string, CatalogAssetPackEntry[]>;
  description: string;
  files: string[];
  id: string;
  /**
   * WHICH SURFACE THIS CAPABILITY'S JSX RENDERS ON, per surface, as the
   * project-relative globs a region `include` is written in.
   *
   * Why the capability states it and not the project: the editor stamps ONE
   * source-id attribute per file, and which one is right is a fact about the
   * FILE — `ground-projection.tsx` renders `<group>`/`<mesh>`, on any project,
   * forever. What the project decides is only WHICH of its roots owns them, and
   * `addCapabilities` reads that off `vgai.project.json`. Without this the
   * declaration existed only where somebody had typed it by hand (the starter
   * template's adapter names `src/lib/reflections/**` and
   * `src/lib/static-batch/**` and nothing else), so every `vgai add` of a
   * capability with a `.tsx` in it left a fresh project's console RED with
   * `OID001` and no automatic repair — measured on a cold run, 2026-08-29.
   *
   * `dom` is declarable and worth declaring — it turns the stamp into a
   * decision — but it is never REQUIRED, because `data-oid` is already the
   * documented default and the OID001 noise gate stays quiet for a file whose
   * host elements are DOM elements. `three` and `canvas` are required: those
   * are the stamps the default gets WRONG.
   */
  regions?: Partial<Record<CatalogSurface, string[]>>;
  packageJson?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    vgaiTools?: Array<string | Record<string, unknown>>;
  };
  requires: string[];
  skills: string[];
  title: string;
  version: string;
}

/**
 * The provenance stamp written beside a capability the project vendors.
 *
 * A copied capability belongs to the project and is never overwritten — that is
 * the entire model — so a byte difference against the distribution is ambiguous:
 * the project may have EDITED it, or it may have gone STALE. Git already knows
 * which lines the project changed; the one thing it cannot know is that upstream
 * moved. The stamp supplies exactly that and nothing more.
 *
 * `scripts/project-capability-mirror.mjs` derives the same path for the in-repo
 * projects it regenerates; the two must agree, which
 * `catalog.test.ts` asserts.
 */
export const CAPABILITY_STAMP_FILENAME = 'capability.json';

export function capabilityStampPath(entry: CatalogEntry): string {
  const libDir = entry.files
    .filter((file) => file.startsWith(`src/lib/${entry.id}/`))
    .map((file) => file.split('/').slice(0, 3).join('/'))[0];
  return libDir
    ? `${libDir}/${CAPABILITY_STAMP_FILENAME}`
    : `src/tools/${entry.id}.${CAPABILITY_STAMP_FILENAME}`;
}

export interface AddCapabilitiesOptions {
  catalogDir: string;
  dryRun?: boolean;
  ids: string[];
  projectDir: string;
  /** Synchronously install the merged dependencies before publishing source or tool registrations. */
  installDependencies?: (names: string[]) => void;
  /**
   * Rewrite a capability's declared dependency spec before it is merged.
   * Supplied by callers that scaffold from a CHECKOUT: see
   * `checkoutPackageSpec` in scaffold.ts for what it answers and the refusal
   * that made it necessary. Omitted, every spec is taken as the entry wrote it.
   */
  resolveDependencySpec?: DependencySpecResolver;
}

/** `(name, spec) => spec` — see {@link AddCapabilitiesOptions.resolveDependencySpec}. */
export type DependencySpecResolver = (name: string, spec: string) => string;

/** A declared pack entry, tagged with the pack that declares it. */
export interface DeclaredAssetPackEntry extends CatalogAssetPackEntry {
  pack: string;
}

export interface CatalogAddReport {
  alreadyInstalled: string[];
  /**
   * Every pack entry the added capabilities declare, after the merge — i.e.
   * what the project's `asset-manifest.json` now says its capability source
   * needs on disk. The CALLER materializes these (`vgai add` does); this
   * function only writes the declaration, so `addCapabilities` stays
   * filesystem-only and offline.
   */
  declaredAssets: DeclaredAssetPackEntry[];
  dependencyNames: string[];
  dryRun: boolean;
  installed: string[];
  /** Files already present, left exactly as the project has them. */
  kept: string[];
  planned: string[];
  projectDir: string;
  /**
   * Region declarations this project could not be given automatically — see
   * `mergedAdapterModule`. NON-EMPTY MEANS THE EDITOR WILL REPORT `OID001` for
   * those files, so the caller prints it rather than letting a silent gap turn
   * into a red console somebody else has to bisect.
   */
  unplacedRegions: UnplacedCapabilityRegion[];
  writtenFiles: string[];
}

export interface CatalogStatus {
  available: CatalogEntry[];
  /** Ids whose every file is present in the project. */
  installed: string[];
  projectDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, manifestPath: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${manifestPath}: ${field} must be an array of strings`);
  }
  return value as string[];
}

/**
 * Capability ids that were RENAMED, mapped to what they are called now.
 *
 * A renamed id is read by NOTHING. Its only job is this error message — the
 * `vgai.game.json` precedent exactly (`packages/project/src/manifest/filename.ts`):
 * the removed spelling REJECTS LOUDLY with the one-line fix spelled out, and is
 * deliberately never silently mapped onto the new one, because a second
 * accepted name is the defect rather than the convenience. Both get written,
 * and a project that keeps limping on the old id never learns it moved.
 *
 * `mesh` -> `blender` (owner, 2026-09-19): `mesh` named the TypeScript BMesh
 * kit the entry used to declare beside `@volter/editor-blender`. That kit is deleted —
 * a model is a `.blend` now — so the id named a thing that no longer exists.
 */
const RENAMED_CAPABILITY_IDS: ReadonlyMap<string, string> = new Map([['mesh', 'blender']]);

/** The verbatim rejection a renamed capability id earns, fix included. */
export function renamedCapabilityIdMessage(where: string, oldId: string, newId: string): string {
  return (
    `${where}: capability id \`${oldId}\` was RENAMED to \`${newId}\` (2026-09-19). ` +
    `Nothing reads \`${oldId}\` any more, and it is deliberately NOT mapped onto ` +
    `\`${newId}\`, because a second accepted name is the defect.\n` +
    `Fix: in this project, rename the file — \`git mv .vgai/catalog/${oldId}.json ` +
    `.vgai/catalog/${newId}.json\` — and change its \`"id"\` to \`"${newId}"\`. ` +
    `If a stamp file names the old id, rename that too (\`src/tools/${oldId}.*\` -> ` +
    `\`src/tools/${newId}.*\`). Then \`vgai outdated\` will report against the ` +
    `current entry. Nothing else about the capability changed.`
  );
}

function readCatalogEntry(path: string): CatalogEntry {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error(`${path}: capability manifest must be an object`);
  for (const field of ['description', 'id', 'title'] as const) {
    if (typeof parsed[field] !== 'string' || parsed[field].length === 0) {
      throw new Error(`${path}: ${field} must be a non-empty string`);
    }
  }
  const renamedTo = RENAMED_CAPABILITY_IDS.get(parsed['id'] as string);
  if (renamedTo !== undefined) {
    throw new Error(renamedCapabilityIdMessage(path, parsed['id'] as string, renamedTo));
  }
  // A capability with no version cannot tell a copy that upstream moved, so
  // the field is required rather than defaulted — a silent "0.0.0" would make
  // every project look permanently behind.
  if (typeof parsed['version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed['version'])) {
    throw new Error(`${path}: version must be a semver string like "0.1.0"`);
  }
  const manifest: CatalogEntry = {
    description: parsed['description'] as string,
    files: stringArray(parsed['files'], 'files', path),
    id: parsed['id'] as string,
    requires: stringArray(parsed['requires'], 'requires', path),
    skills: stringArray(parsed['skills'], 'skills', path),
    title: parsed['title'] as string,
    version: parsed['version'],
  };
  if (parsed['packageJson'] !== undefined) {
    if (!isRecord(parsed['packageJson'])) {
      throw new Error(`${path}: packageJson must be an object`);
    }
    const packageJson = parsed['packageJson'];
    const dependencies = readStringRecord(packageJson['dependencies'], 'dependencies', path);
    const devDependencies = readStringRecord(
      packageJson['devDependencies'],
      'devDependencies',
      path,
    );
    const scripts = readStringRecord(packageJson['scripts'], 'scripts', path);
    const vgaiTools = packageJson['vgaiTools'];
    // A tool entry is a plain module path. The object form survives only for
    // entries that still carry extra keys; contributions are no longer among
    // them (they are discovered by scanning), so most entries are strings now.
    if (
      vgaiTools !== undefined &&
      (!Array.isArray(vgaiTools) ||
        vgaiTools.some((entry) => typeof entry !== 'string' && !isRecord(entry)))
    ) {
      throw new Error(`${path}: packageJson.vgaiTools must be an array of module paths`);
    }
    manifest.packageJson = {
      ...(dependencies ? { dependencies } : {}),
      ...(devDependencies ? { devDependencies } : {}),
      ...(scripts ? { scripts } : {}),
      ...(vgaiTools ? { vgaiTools: vgaiTools as Array<string | Record<string, unknown>> } : {}),
    };
  }
  const assetPacks = readAssetPacks(parsed['assetPacks'], path);
  if (assetPacks) manifest.assetPacks = assetPacks;
  const regions = readRegions(parsed['regions'], path);
  if (regions) manifest.regions = regions;
  assertJsxSurfacesDeclared(manifest, path);
  return manifest;
}

/** Validate an entry's `regions`. Hand-rolled like every other check in this
 *  file (this package deliberately carries no `zod`). */
function readRegions(
  value: unknown,
  manifestPath: string,
): Partial<Record<CatalogSurface, string[]>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${manifestPath}: regions must be an object`);
  const regions: Partial<Record<CatalogSurface, string[]>> = {};
  for (const [surface, globs] of Object.entries(value)) {
    if (!(CATALOG_SURFACES as readonly string[]).includes(surface)) {
      throw new Error(
        `${manifestPath}: regions key must be one of ${CATALOG_SURFACES.join(', ')} — got ${surface}`,
      );
    }
    const list = stringArray(globs, `regions.${surface}`, manifestPath);
    if (list.length === 0) {
      throw new Error(`${manifestPath}: regions.${surface} must name at least one glob`);
    }
    for (const glob of list) assertRelativeProjectPath(glob);
    regions[surface as CatalogSurface] = list;
  }
  return regions;
}

/**
 * The GLOB DIALECT the region resolver reads (`packages/editor/src/ui-source/
 * file-region-resolver.ts`'s `globToRegExp`), restated here because this
 * package deliberately depends on neither the editor nor a glob library, and
 * the check below has to agree with the reader that will consume what we write.
 * `**` spans any number of segments, `*` stays inside one, `?` is one character.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 3 : 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/**
 * EVERY `.tsx` A CAPABILITY SHIPS MUST HAVE ITS SURFACE DECLARED — checked
 * here, where every consumer of the catalog already goes through, so a new JSX
 * file added to a capability cannot ship without one.
 *
 * This is the class-closing half of {@link CatalogEntry.regions}: the mechanism
 * alone would still let the next capability repeat the defect silently, because
 * the symptom (`OID001` at boot in somebody else's fresh project) is nowhere
 * near the commit that caused it.
 *
 * `src/contributions/**` and `src/tools/**` are exempt: an editor contribution is React DOM by contract —
 * it renders into the editor's own panels, never into a game root — so its
 * `data-oid` default is already the right stamp and there is no project root to
 * declare it onto.
 */
function assertJsxSurfacesDeclared(manifest: CatalogEntry, manifestPath: string): void {
  const globs = Object.values(manifest.regions ?? {})
    .flat()
    .map(globToRegExp);
  const undeclared = manifest.files.filter(
    (file) =>
      file.endsWith('.tsx') &&
      !file.startsWith('src/tools/') &&
      !file.startsWith('src/contributions/') &&
      !globs.some((pattern) => pattern.test(file)),
  );
  if (undeclared.length > 0) {
    throw new Error(
      `${manifestPath}: these .tsx files name no surface in \`regions\` — ${undeclared.join(', ')}. ` +
        'The editor stamps one source-id attribute per file and the default (`data-oid`) is ' +
        'correct only for React DOM; an R3F component that takes it breaks the running game ' +
        '(fiber pierces the dash and throws on the second apply). Declare each file under the ' +
        'surface it renders on — `three`, `canvas`, or `dom`.',
    );
  }
}

/**
 * Validate an entry's `assetPacks`. Hand-rolled like every other check in this
 * file (this package deliberately carries no `zod`), but the SHAPE is the one
 * `AssetPackManifestSchema` enforces on the project side — a declaration that
 * would not parse there must not be writable from here.
 */
function readAssetPacks(
  value: unknown,
  manifestPath: string,
): Record<string, CatalogAssetPackEntry[]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${manifestPath}: assetPacks must be an object`);
  const packs: Record<string, CatalogAssetPackEntry[]> = {};
  for (const [pack, entries] of Object.entries(value)) {
    if (pack.length === 0) throw new Error(`${manifestPath}: an assetPacks name must be non-empty`);
    if (!Array.isArray(entries)) {
      throw new Error(`${manifestPath}: assetPacks.${pack} must be an array`);
    }
    packs[pack] = entries.map((entry) => {
      if (!isRecord(entry))
        throw new Error(`${manifestPath}: assetPacks.${pack} entries must be objects`);
      const { key, dest, sha256 } = entry;
      if (typeof key !== 'string' || !/^[^:]+:.+$/.test(key)) {
        throw new Error(`${manifestPath}: assetPacks.${pack} entry key must be "source:id"`);
      }
      if (typeof dest !== 'string' || dest.length === 0) {
        throw new Error(`${manifestPath}: assetPacks.${pack} entry dest must be a non-empty path`);
      }
      assertRelativeProjectPath(dest);
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error(
          `${manifestPath}: assetPacks.${pack} entry sha256 must be 64 lowercase hex digits`,
        );
      }
      return { key, dest, sha256 };
    });
  }
  return packs;
}

function readStringRecord(
  value: unknown,
  field: string,
  manifestPath: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new Error(`${manifestPath}: packageJson.${field} must map strings to strings`);
  }
  return value as Record<string, string>;
}

function listManifestPaths(catalogDir: string): string[] {
  if (!existsSync(catalogDir)) throw new Error(`Catalog entries not found: ${catalogDir}`);
  return readdirSync(catalogDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(catalogDir, name));
}

export function readCatalog(catalogDir: string): CatalogEntry[] {
  const manifests = listManifestPaths(join(catalogDir, 'entries')).map(readCatalogEntry);
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) throw new Error(`Duplicate capability id: ${manifest.id}`);
    ids.add(manifest.id);
  }
  for (const manifest of manifests) {
    for (const required of manifest.requires) {
      if (!ids.has(required)) {
        throw new Error(`Capability ${manifest.id} requires unknown capability ${required}`);
      }
    }
  }
  return manifests;
}

export function initializeProjectCatalog(projectDir: string, catalogDir: string): void {
  const targetDir = join(projectDir, PROJECT_CATALOG_DIR);
  mkdirSync(targetDir, { recursive: true });
  for (const manifestPath of listManifestPaths(join(catalogDir, 'entries'))) {
    const targetPath = join(targetDir, manifestPath.slice(manifestPath.lastIndexOf(sep) + 1));
    writeFileSync(targetPath, readFileSync(manifestPath));
  }
}

/**
 * Ids the project vendors. The version stamp answers this outright when it is
 * there; a byte heuristic is the fallback for copies that predate stamping.
 */
export function presentCapabilityIds(projectDir: string, catalogDir: string): string[] {
  const resolvedProject = resolve(projectDir);
  const resolvedCatalog = resolve(catalogDir);
  let catalog: CatalogEntry[];
  try {
    catalog = readCatalog(resolvedCatalog);
  } catch {
    return [];
  }
  return catalog
    .filter((manifest) => {
      // A stamp is written by `add` and deleted by `remove`, so its presence is
      // the fact itself — and it holds however heavily the project has since
      // edited the source, which is the whole point of copying it in.
      if (existsSync(join(resolvedProject, capabilityStampPath(manifest)))) return true;

      // Fallback for pre-stamp copies: MOST of a unit's declared files are here
      // and byte-match what the catalog ships. A majority rather than "any"
      // because units share files — one shared match must not mark an unrelated
      // unit installed — and rather than "all" because editing or deleting a few
      // files is a normal thing to do to source you own, and must not make the
      // unit vanish. Unrelated project source occupying one of our paths never
      // byte-matches. It is a coin-flip at the margin, which is exactly why the
      // stamp above exists.
      const files = entryFiles(manifest, resolvedCatalog);
      if (files.length === 0) return false;
      const matching = files.filter((file) => {
        const target = join(resolvedProject, file.relativePath);
        return existsSync(target) && readFileSync(target).equals(file.bytes);
      }).length;
      return matching * 2 > files.length;
    })
    .map((manifest) => manifest.id)
    .sort();
}

function assertRelativeProjectPath(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error(`Capability file must be project-relative: ${path}`);
  }
}

function collectFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

interface PlannedFile {
  bytes: Buffer;
  owner: string;
  relativePath: string;
}

const PROJECT_SKILL_ROOTS = [
  join('.agents', 'skills'),
  join('.claude', 'skills'),
  join('.github', 'skills'),
] as const;

function entryFiles(manifest: CatalogEntry, catalogDir: string): PlannedFile[] {
  const files: PlannedFile[] = [];
  for (const relativePath of manifest.files) {
    assertRelativeProjectPath(relativePath);
    const source = join(catalogDir, 'project-source', relativePath);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(`Capability ${manifest.id} source file is missing: ${source}`);
    }
    files.push({ bytes: readFileSync(source), owner: manifest.id, relativePath });
  }
  for (const skill of manifest.skills) {
    if (!/^[a-z0-9-]+$/.test(skill)) throw new Error(`Invalid skill name: ${skill}`);
    const skillRoot = join(dirname(catalogDir), 'template', '.agents', 'skills', skill);
    if (!existsSync(skillRoot) || !statSync(skillRoot).isDirectory()) {
      throw new Error(`Capability ${manifest.id} skill is missing: ${skillRoot}`);
    }
    for (const source of collectFiles(skillRoot)) {
      for (const projectSkillRoot of PROJECT_SKILL_ROOTS) {
        files.push({
          bytes: readFileSync(source),
          owner: manifest.id,
          relativePath: join(projectSkillRoot, skill, relative(skillRoot, source)),
        });
      }
    }
  }
  return files;
}

function dependencyOrder(ids: string[], byId: Map<string, CatalogEntry>): CatalogEntry[] {
  const ordered: CatalogEntry[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Capability dependency cycle includes ${id}`);
    const manifest = byId.get(id);
    // Name the alternatives rather than dead-ending. A bare id is easy to
    // mistype and easy to guess wrong, and the listing lives behind a bare
    // `vgai add` that nothing else advertises — so this error is one of the few
    // places a caller learns the real vocabulary.
    if (!manifest) {
      // A RENAMED id is not an unknown one, and must not be answered as if it
      // were: "Unknown capability: mesh" next to an `Available:` list
      // containing `blender` makes a caller guess at the relationship. Say it.
      const renamedTo = RENAMED_CAPABILITY_IDS.get(id);
      if (renamedTo !== undefined) {
        throw new Error(
          `Capability id \`${id}\` was RENAMED to \`${renamedTo}\` (2026-09-19). ` +
            `Nothing accepts \`${id}\` any more, and it is deliberately NOT mapped ` +
            `onto \`${renamedTo}\`, because a second accepted name is the defect.\n` +
            `Fix: use the current name — \`${renamedTo}\`. Nothing else changed.`,
        );
      }
      throw new Error(
        `Unknown capability: ${id}\nAvailable: ${[...byId.keys()].sort().join(', ')}`,
      );
    }
    visiting.add(id);
    for (const required of manifest.requires) visit(required);
    visiting.delete(id);
    visited.add(id);
    ordered.push(manifest);
  };
  for (const id of ids) visit(id);
  return ordered;
}

/**
 * Range prefix and version core of a dependency spec, or null for anything this
 * comparison has no business ruling on — a git url, a workspace protocol, `*`,
 * a compound range. Unknown shapes fall back to exact string equality, which is
 * the conservative answer.
 */
function specParts(spec: string): { prefix: string; core: string } | null {
  const m = /^\s*([\^~]?)=?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/.exec(spec);
  return m ? { prefix: m[1] ?? '', core: m[2]! } : null;
}

const SPEC_WIDTH: Record<string, number> = { '^': 2, '~': 1, '': 0 };

/**
 * Two specs CONFLICT only when they name different versions. `4.3.6` and
 * `^4.3.6` name the same one and differ only in how much newer they accept, so
 * refusing the pair is a false conflict — and a load-bearing one. It throws
 * during the dependency merge, which aborts `vgai upgrade` outright, and a
 * project that cannot upgrade keeps whatever vendored copies it was scaffolded
 * with. `check-idioms.ts` is one of those: rules added upstream since then
 * never run, and nothing announces that they are not running, because a lint
 * rule that is absent breaks no build. This guard was causing that failure
 * rather than catching one.
 *
 * When the cores agree, keep the WIDER spec — narrowing a caret to an exact pin
 * because one capability happened to spell it that way pins the project by
 * accident.
 *
 * The one exception is the PROJECT's own spec, and it is the mirror of the
 * same accident: a spec the project package.json set itself (the template's
 * `react: ~19.2.4`, or one the user typed) is a decision, and a capability
 * that spells the same core with a caret must not widen it — `~19.2.4`
 * widened to `^19.2.4` resolved react 19.3.0, which `@react-three/fiber`'s
 * peer range `<19.3` refuses, and the `full` template (every addition at
 * once) could not install (2026-09-15). So the project's spec stands over an
 * agreeing capability spec; wider-wins applies between capabilities, where
 * neither side is a decision the project made.
 */
function widerSpec(a: string, b: string): string | null {
  if (a === b) return a;
  const pa = specParts(a);
  const pb = specParts(b);
  if (!pa || !pb || pa.core !== pb.core) return null;
  return (SPEC_WIDTH[pa.prefix] ?? 0) >= (SPEC_WIDTH[pb.prefix] ?? 0) ? a : b;
}

function mergeStringDependencies(
  target: Record<string, unknown>,
  field: 'dependencies' | 'devDependencies' | 'scripts',
  incoming: Record<string, string> | undefined,
  owner: string,
  /** Who last set each spec, so a real conflict names both sides truthfully. */
  origins: Map<string, string>,
  resolveSpec?: DependencySpecResolver,
): void {
  if (!incoming) return;
  const current = target[field];
  if (current !== undefined && !isRecord(current)) {
    throw new Error(`package.json ${field} must be an object`);
  }
  const merged = { ...(current ?? {}) } as Record<string, unknown>;
  for (const [name, declared] of Object.entries(incoming)) {
    const spec = field === 'scripts' ? declared : (resolveSpec?.(name, declared) ?? declared);
    const existing = merged[name];
    const key = `${field}.${name}`;
    if (existing !== undefined) {
      const projectOwned = !origins.has(key);
      const winner =
        typeof existing !== 'string'
          ? null
          : field === 'scripts'
            ? existing === spec
              ? existing
              : null
            : projectOwned
              ? widerSpec(existing, spec) === null
                ? null
                : existing
              : widerSpec(existing, spec);
      if (winner === null) {
        // Name where the existing value CAME FROM. "package.json has …" sends
        // the reader to a file that often already agrees, because the value is
        // usually another capability's, merged a moment earlier.
        const from = origins.get(key) ?? 'the project package.json';
        throw new Error(
          `Capability ${owner} requires ${key}=${spec}, but ${from} already set ${key}=${String(existing)}`,
        );
      }
      merged[name] = winner;
      if (winner !== existing) origins.set(key, `capability ${owner}`);
      continue;
    }
    merged[name] = spec;
    origins.set(key, `capability ${owner}`);
  }
  target[field] = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

type ProjectToolEntry = string | Record<string, unknown>;

function toolIdentity(tool: ProjectToolEntry): string {
  if (typeof tool === 'string') return tool;
  const identity = tool['entry'] ?? tool['id'];
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new Error('Capability tool requires an entry or id');
  }
  return identity;
}

/** Pure package merge used by both filesystem installation and pre-write import planning. */
export function planCapabilityPackageJson(
  originalBytes: Uint8Array,
  manifests: readonly CatalogEntry[],
  label = 'package.json',
  resolveSpec?: DependencySpecResolver,
): Uint8Array {
  const original = Buffer.from(originalBytes);
  const parsed = JSON.parse(original.toString('utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error(`${label}: package.json must be an object`);
  const origins = new Map<string, string>();
  for (const manifest of manifests) {
    const patch = manifest.packageJson;
    if (!patch) continue;
    mergeStringDependencies(
      parsed,
      'dependencies',
      patch.dependencies,
      manifest.id,
      origins,
      resolveSpec,
    );
    mergeStringDependencies(
      parsed,
      'devDependencies',
      patch.devDependencies,
      manifest.id,
      origins,
      resolveSpec,
    );
    mergeStringDependencies(parsed, 'scripts', patch.scripts, manifest.id, origins);
    if (patch.vgaiTools) {
      const vgai = parsed['vgai'] === undefined ? {} : parsed['vgai'];
      if (!isRecord(vgai)) throw new Error(`${label}: vgai must be an object`);
      const currentTools = vgai['tools'] === undefined ? [] : vgai['tools'];
      if (
        !Array.isArray(currentTools) ||
        currentTools.some((tool) => typeof tool !== 'string' && !isRecord(tool))
      ) {
        throw new Error(`${label}: vgai.tools must be an array of strings or objects`);
      }
      const tools = (currentTools as ProjectToolEntry[]).map((tool) =>
        typeof tool === 'string' ? tool : { ...tool },
      );
      for (const tool of patch.vgaiTools) {
        const id = toolIdentity(tool);
        const existing = tools.find((candidate) => toolIdentity(candidate) === id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(tool)) {
          throw new Error(
            `Capability ${manifest.id} conflicts with existing vgai.tools entry ${id}`,
          );
        }
        if (!existing) tools.push(tool);
      }
      tools.sort((a, b) => toolIdentity(a).localeCompare(toolIdentity(b)));
      vgai['tools'] = tools;
      parsed['vgai'] = vgai;
    }
  }
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
}

function mergedPackageJson(
  projectDir: string,
  manifests: CatalogEntry[],
  resolveSpec?: DependencySpecResolver,
): { bytes: Buffer; changed: boolean } | undefined {
  const path = join(projectDir, 'package.json');
  const needsMerge = manifests.some((manifest) => manifest.packageJson !== undefined);
  if (!needsMerge) return undefined;
  if (!existsSync(path))
    throw new Error(`Cannot install capability package changes: ${path} is missing`);
  const original = readFileSync(path);
  const bytes = Buffer.from(planCapabilityPackageJson(original, manifests, path, resolveSpec));
  return { bytes, changed: !original.equals(bytes) };
}

/** Project-relative name of the asset-pack declaration (D-AP1), the sibling of
 *  `vgai.project.json`. Spelled here because this package deliberately does not
 *  depend on the editor; `hosted-asset-materialization.ts` owns the reader. */
const ASSET_MANIFEST_FILE = 'asset-manifest.json';

/**
 * Merge every added capability's `assetPacks` into the project's
 * `asset-manifest.json`, creating the file when the project has none.
 *
 * ADD-ONLY, like `mergedPackageJson`: a destination the project ALREADY
 * declares is left exactly as the project has it, because the declaration is
 * project-owned the moment it lands (the capability model) — a re-pinned
 * capability must not silently re-cut a pin the project reviewed. A conflicting
 * declaration is therefore reported by `git diff`, not resolved here.
 */
function mergedAssetManifest(
  projectDir: string,
  manifests: CatalogEntry[],
): { bytes: Buffer; changed: boolean; declared: DeclaredAssetPackEntry[] } | undefined {
  const declared: DeclaredAssetPackEntry[] = [];
  for (const manifest of manifests) {
    for (const [pack, entries] of Object.entries(manifest.assetPacks ?? {})) {
      for (const entry of entries) declared.push({ ...entry, pack });
    }
  }
  if (declared.length === 0) return undefined;

  const file = join(projectDir, ASSET_MANIFEST_FILE);
  const original = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  const parsed: { packs?: Record<string, CatalogAssetPackEntry[]> } =
    original.length > 0 ? (JSON.parse(original.toString('utf8')) as { packs?: never }) : {};
  if (parsed.packs !== undefined && !isRecord(parsed.packs)) {
    throw new Error(`${ASSET_MANIFEST_FILE}: packs must be an object`);
  }
  const packs = parsed.packs ?? {};
  const claimed = new Set(
    Object.values(packs).flatMap((entries) => entries.map((entry) => entry.dest)),
  );
  for (const entry of declared) {
    if (claimed.has(entry.dest)) continue;
    const existing = packs[entry.pack] ?? [];
    existing.push({ key: entry.key, dest: entry.dest, sha256: entry.sha256 });
    packs[entry.pack] = existing;
    claimed.add(entry.dest);
  }
  parsed.packs = packs;
  const bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  // Report the POST-MERGE entry for each capability-declared destination — the
  // project's own entry where the project already claimed the dest. The caller
  // materializes what it is handed, so handing back the capability's pin here
  // would overwrite the project-owned bytes/ledger the add-only merge above
  // just refused to re-pin.
  const byDest = new Map<string, DeclaredAssetPackEntry>();
  for (const [pack, entries] of Object.entries(packs)) {
    for (const entry of entries) {
      byDest.set(entry.dest, { key: entry.key, dest: entry.dest, sha256: entry.sha256, pack });
    }
  }
  const merged = [...new Set(declared.map((entry) => entry.dest))].map(
    (dest) => byDest.get(dest) as DeclaredAssetPackEntry,
  );
  return { bytes, changed: !original.equals(bytes), declared: merged };
}

/** The game's adapter module lives beside `vgai.project.json`, by contract. */
const ADAPTER_MODULE_FILE = 'vgai.adapter.ts';

/** Root id -> the surface it renders on, read off `vgai.project.json`'s
 *  `roots[]`. `adapter` is the sole discriminator: a builtin adapter names the
 *  surface outright, and a module/ingest root carries a `surface` field. */
function rootSurfaces(projectDir: string): Map<string, CatalogSurface> {
  const surfaces = new Map<string, CatalogSurface>();
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(resolveManifestPath(projectDir), 'utf8'));
  } catch {
    return surfaces;
  }
  if (!isRecord(manifest) || !Array.isArray(manifest['roots'])) return surfaces;
  for (const root of manifest['roots']) {
    if (!isRecord(root) || typeof root['id'] !== 'string') continue;
    const adapter = root['adapter'];
    const surface =
      typeof adapter === 'string'
        ? adapter
        : isRecord(adapter) && typeof adapter['surface'] === 'string'
          ? adapter['surface']
          : undefined;
    if (surface && (CATALOG_SURFACES as readonly string[]).includes(surface)) {
      surfaces.set(root['id'], surface as CatalogSurface);
    }
  }
  return surfaces;
}

/** A capability's region declaration this project could not be given, and why —
 *  reported by the caller rather than swallowed. */
export interface UnplacedCapabilityRegion {
  capability: string;
  globs: string[];
  reason: string;
  surface: CatalogSurface;
}

/**
 * Declare every added capability's `regions` in the project's own
 * `vgai.adapter.ts` — see `adapter-region-merge.ts` for why the capability
 * states the surface and the project states the root.
 *
 * A surface with exactly ONE root in `vgai.project.json` is unambiguous and
 * merges. Anything else is REPORTED, never guessed: two `three` roots is a real
 * choice only the game can make, and no `three` root at all means the
 * capability's components have nowhere to render.
 *
 * `dom` is the one surface a missing root is silent about, on the same terms
 * the OID001 noise gate already uses: `data-oid` is the default, so an
 * unplaced DOM file already carries the attribute it needs.
 */
function mergedAdapterModule(
  projectDir: string,
  manifests: CatalogEntry[],
): { bytes: Buffer; changed: boolean; unplaced: UnplacedCapabilityRegion[] } | undefined {
  const declaring = manifests.filter((manifest) => manifest.regions !== undefined);
  if (declaring.length === 0) return undefined;

  const surfaces = rootSurfaces(projectDir);
  const unplaced: UnplacedCapabilityRegion[] = [];
  const byRootId = new Map<string, string[]>();
  for (const manifest of declaring) {
    // `CATALOG_SURFACES` is walked, not `Object.entries(manifest.regions)`.
    // The original reason was a global type augmentation of
    // `ObjectConstructor.entries` reaching this program; that dependency is
    // gone (memory-holed 2026-09-20). The walk stays on its own merits: it
    // gives the loop the surface VOCABULARY, which is what retires the
    // `surface as CatalogSurface` cast below and makes a surface added to
    // `CATALOG_SURFACES` reach this placement automatically.
    for (const surface of CATALOG_SURFACES) {
      const globs = manifest.regions?.[surface];
      if (globs === undefined) continue;
      const roots = [...surfaces].filter(([, value]) => value === surface).map(([id]) => id);
      if (roots.length !== 1) {
        if (surface === 'dom' && roots.length === 0) continue;
        unplaced.push({
          capability: manifest.id,
          globs,
          reason:
            roots.length === 0
              ? `${projectDir} declares no \`${surface}\` root to own them`
              : `${projectDir} declares ${roots.length} \`${surface}\` roots (${roots.join(', ')}) — only the game can say which owns them`,
          surface,
        });
        continue;
      }
      const rootId = roots[0]!;
      byRootId.set(rootId, [...(byRootId.get(rootId) ?? []), ...globs]);
    }
  }

  const path = join(projectDir, ADAPTER_MODULE_FILE);
  if (byRootId.size === 0 || !existsSync(path)) {
    for (const [rootId, globs] of byRootId) {
      unplaced.push({
        capability: declaring.map((manifest) => manifest.id).join(', '),
        globs,
        reason: `${path} does not exist — add \`regionIncludes: { ${rootId}: { include: [...] } }\` to one`,
        surface: surfaces.get(rootId) as CatalogSurface,
      });
    }
    return { bytes: Buffer.alloc(0), changed: false, unplaced };
  }

  const additions: RegionIncludeAddition[] = [...byRootId]
    .map(([rootId, globs]) => ({ rootId, globs: [...new Set(globs)].sort() }))
    .sort((a, b) => a.rootId.localeCompare(b.rootId));
  const original = readFileSync(path);
  const merge = mergeAdapterRegionIncludes(original.toString('utf8'), additions);
  if (merge.kind === 'unreadable') {
    for (const addition of additions) {
      unplaced.push({
        capability: declaring.map((manifest) => manifest.id).join(', '),
        globs: [...addition.globs],
        reason: `${path} could not be edited automatically — ${merge.reason}. Declare them on the \`${addition.rootId}\` region by hand`,
        surface: surfaces.get(addition.rootId) as CatalogSurface,
      });
    }
    return { bytes: original, changed: false, unplaced };
  }
  if (merge.kind === 'unchanged') return { bytes: original, changed: false, unplaced };
  return { bytes: Buffer.from(merge.text), changed: true, unplaced };
}

export function addCapabilities(options: AddCapabilitiesOptions): CatalogAddReport {
  const projectDir = resolve(options.projectDir);
  const catalogDir = resolve(options.catalogDir);
  const catalog = readCatalog(catalogDir);
  const byId = new Map(catalog.map((manifest) => [manifest.id, manifest]));
  const ordered = dependencyOrder(options.ids, byId);
  const plannedFiles = ordered.flatMap((manifest) => entryFiles(manifest, catalogDir));
  const targets = new Map<string, PlannedFile>();
  for (const file of plannedFiles) {
    const prior = targets.get(file.relativePath);
    if (prior && !prior.bytes.equals(file.bytes)) {
      throw new Error(
        `Capabilities ${prior.owner} and ${file.owner} provide different contents for ${file.relativePath}`,
      );
    }
    targets.set(file.relativePath, file);
  }

  const present = new Set(presentCapabilityIds(projectDir, catalogDir));
  const alreadyInstalled = ordered.filter((m) => present.has(m.id)).map((m) => m.id);
  const newManifests = ordered.filter((manifest) => !present.has(manifest.id));

  // Adding never overwrites and never merges — the copy is the project's the
  // moment it lands. Identical content is a no-op; DIFFERENT content is only a
  // no-op on a RE-add (the unit is already here, so this is the project's own
  // edit). Different content for a unit that is NOT here yet is a genuine
  // collision with unrelated project source, and stays loud.
  const toWrite: PlannedFile[] = [];
  const kept: string[] = [];
  for (const file of targets.values()) {
    const target = join(projectDir, file.relativePath);
    if (!existsSync(target)) {
      toWrite.push(file);
      continue;
    }
    if (!readFileSync(target).equals(file.bytes) && !present.has(file.owner)) {
      throw new Error(
        `Capability ${file.owner} would overwrite existing file: ${file.relativePath}`,
      );
    }
    kept.push(file.relativePath);
  }
  // Merge for every PLANNED unit, not just newly-written ones: the starter
  // template already vendors some units' source, so those read as present and
  // would never contribute their dependencies. The merge is add-only and
  // idempotent, so running it over the full closure is both safe and the only
  // way to guarantee a unit's dependencies actually land.
  const packageMerge = mergedPackageJson(projectDir, ordered, options.resolveDependencySpec);
  // Same reason as the package.json merge above: run it over the full planned
  // closure, so a capability the template already vendors still contributes its
  // pack declaration.
  const assetMerge = mergedAssetManifest(projectDir, ordered);
  // And again for the same reason: a capability the template already vendors
  // still owes the project its region declaration.
  const adapterMerge = mergedAdapterModule(projectDir, ordered);
  const writtenFiles = toWrite.map((file) => file.relativePath);
  if (packageMerge?.changed) writtenFiles.push('package.json');
  if (assetMerge?.changed) writtenFiles.push(ASSET_MANIFEST_FILE);
  if (adapterMerge?.changed) writtenFiles.push(ADAPTER_MODULE_FILE);

  // Stamp only what we actually WROTE. A re-add keeps the project's existing
  // files untouched, so bumping its stamp would claim a version this copy never
  // took — turning a stale copy into one that reports itself current.
  const stamps = newManifests.map((manifest) => ({
    bytes: Buffer.from(
      `${JSON.stringify({ id: manifest.id, version: manifest.version }, null, 2)}\n`,
    ),
    relativePath: capabilityStampPath(manifest),
  }));
  for (const stamp of stamps) writtenFiles.push(stamp.relativePath);

  const dependencyNames = packageMerge?.changed
    ? [
        ...new Set(
          ordered.flatMap((manifest) => [
            ...Object.keys(manifest.packageJson?.dependencies ?? {}),
            ...Object.keys(manifest.packageJson?.devDependencies ?? {}),
          ]),
        ),
      ].sort()
    : [];

  if (!options.dryRun) {
    if (options.installDependencies && dependencyNames.length > 0 && packageMerge) {
      const packagePath = join(projectDir, 'package.json');
      const original = readFileSync(packagePath);
      const prepared = JSON.parse(original.toString('utf8'));
      const merged = JSON.parse(packageMerge.bytes.toString('utf8'));
      // An open editor must keep seeing its existing tools while npm works.
      // Publishing the new registrations or contributions first loads modules
      // whose dependencies do not exist yet and retains false console errors.
      for (const section of ['dependencies', 'devDependencies']) {
        if (merged[section]) prepared[section] = merged[section];
      }
      const preparedBytes = Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`);
      writeFileSync(packagePath, preparedBytes);
      try {
        options.installDependencies(dependencyNames);
      } catch (error) {
        if (existsSync(packagePath) && readFileSync(packagePath).equals(preparedBytes)) {
          writeFileSync(packagePath, original);
        }
        throw error;
      }
      if (!existsSync(packagePath) || !readFileSync(packagePath).equals(preparedBytes)) {
        throw new Error(
          'package.json changed during dependency installation; edits were preserved. Retry the capability addition.',
        );
      }
      // npm can take long enough for project edits to arrive. Re-plan against
      // those bytes, retaining the normal collision checks and add-only merges.
      const { installDependencies: _installer, ...publishOptions } = options;
      const published = addCapabilities(publishOptions);
      return {
        ...published,
        dependencyNames,
        writtenFiles: [...new Set([...published.writtenFiles, 'package.json'])].sort(),
      };
    }
    const isContribution = (file: PlannedFile) =>
      file.relativePath.replaceAll('\\', '/').startsWith('src/contributions/');
    const write = (file: { relativePath: string; bytes: Buffer }) => {
      const target = join(projectDir, file.relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    };
    // Tools and their imports exist before registration; panels appear last.
    for (const file of toWrite.filter((file) => !isContribution(file))) write(file);
    if (assetMerge?.changed) {
      writeFileSync(join(projectDir, ASSET_MANIFEST_FILE), assetMerge.bytes);
    }
    if (adapterMerge?.changed) {
      writeFileSync(join(projectDir, ADAPTER_MODULE_FILE), adapterMerge.bytes);
    }
    if (packageMerge?.changed) writeFileSync(join(projectDir, 'package.json'), packageMerge.bytes);
    for (const file of toWrite.filter(isContribution)) write(file);
    for (const stamp of stamps) write(stamp);
  }

  return {
    alreadyInstalled,
    declaredAssets: assetMerge?.declared ?? [],
    unplacedRegions: adapterMerge?.unplaced ?? [],
    dependencyNames,
    dryRun: options.dryRun ?? false,
    installed: newManifests.map((manifest) => manifest.id),
    kept: kept.sort(),
    planned: ordered.map((manifest) => manifest.id),
    projectDir,
    writtenFiles: writtenFiles.sort(),
  };
}

/**
 * Every project-relative path a catalog unit declares, for the units present
 * in this project. `vgai upgrade` uses it to keep unit-owned files out of the
 * generic template-file pass: those files are ordinary project source, and the
 * project — not a shadow baseline — owns what happens to them.
 */
export function catalogOwnedPaths(projectDir: string, catalogDir: string): Set<string> {
  const owned = new Set<string>();
  const resolvedProject = resolve(projectDir);
  const resolvedCatalog = resolve(catalogDir);
  let catalog: CatalogEntry[];
  try {
    catalog = readCatalog(resolvedCatalog);
  } catch {
    return owned;
  }
  const present = new Set(presentCapabilityIds(resolvedProject, resolvedCatalog));
  for (const manifest of catalog) {
    if (!present.has(manifest.id)) continue;
    for (const file of manifest.files) owned.add(file);
  }
  return owned;
}

export interface RemoveCapabilitiesOptions {
  catalogDir: string;
  dryRun?: boolean;
  ids: string[];
  projectDir: string;
}

/** One file whose difference from the distribution cannot be attributed. */
export interface DivergedCapabilityFile {
  /** The capability whose file this is. */
  capabilityId: string;
  /** Version the project's copy was stamped with; `null` for a pre-stamp copy. */
  copied: string | null;
  /** Version the distribution being compared against ships. */
  current: string;
  /** Project-relative path. */
  path: string;
}

export interface CatalogRemovalReport {
  dryRun: boolean;
  /** Ids actually removed (present in the install state). */
  removed: string[];
  /** Requested ids that were not installed — a no-op, reported not thrown. */
  notInstalled: string[];
  /** Pristine files deleted (or that would be, under `dryRun`). */
  deletedFiles: string[];
  /**
   * Project-edited files deliberately left on disk.
   *
   * ONLY files whose difference is genuinely attributable to the project: the
   * copy's stamped version matches the distribution being compared against, so
   * the bytes it was written from are the bytes in hand. When the versions
   * differ, the difference is unattributable and the file goes to
   * {@link CatalogRemovalReport.keptDivergedFiles} instead.
   */
  keptModifiedFiles: string[];
  /**
   * Files kept because the project vendored a DIFFERENT version of the
   * capability than the distribution in hand, so a byte difference cannot be
   * told from a project edit. See {@link removeCapabilities}.
   */
  keptDivergedFiles: DivergedCapabilityFile[];
  /** Files left because another installed capability still provides them. */
  keptSharedFiles: string[];
  /** `vgai.tools` registration identities removed from package.json. */
  removedToolEntries: string[];
  /** Dependencies the removed capabilities had contributed — left installed. */
  orphanedDependencyNames: string[];
  projectDir: string;
}

/**
 * The version the project's copy of `entry` was taken from, or `null` for a
 * pre-stamp copy (or an unreadable/malformed stamp — never guessed).
 *
 * Extracted from {@link capabilityVersions}, which did this read inline; both
 * callers now ask the same question the same way.
 */
function stampedCapabilityVersion(projectDir: string, entry: CatalogEntry): string | null {
  try {
    const stamp = JSON.parse(
      readFileSync(join(projectDir, capabilityStampPath(entry)), 'utf8'),
    ) as {
      version?: unknown;
    };
    return typeof stamp.version === 'string' ? stamp.version : null;
  } catch {
    return null;
  }
}

/**
 * Remove installed capabilities. Throws when a capability that stays installed
 * `requires` one being removed — that would leave the project importing files
 * nothing provides — naming the dependents so the caller can widen the set.
 *
 * WHAT A BYTE DIFFERENCE MEANS, AND WHEN IT MEANS NOTHING
 * ------------------------------------------------------
 * A file that does not match the distribution used to be reported as "you
 * edited this file". That claim is only available when the distribution in
 * hand is the one the copy came FROM — which the stamp beside the copy is the
 * one record of. Measured on a minutes-old scaffold (2026-08-19): the project
 * vendored `static-batch` 0.1.2 from the checkout's template while its own
 * `npm install` pulled `@volter/editor-core` from the registry, whose catalog ships
 * `static-batch` 0.1.1 with two files genuinely different. `vgai remove
 * static-batch` then told the user they had edited two files they had never
 * opened, kept them, and left the capability half-removed.
 *
 * {@link capabilityVersions} already states the rule this now obeys: telling
 * "stale" from "stale AND edited" needs the bytes of the version the project
 * copied, and only the current one ships. So a difference is attributed to the
 * project ONLY when the stamped version matches the distribution's; otherwise
 * it is unattributable, the file is still kept (never delete work that might
 * be real), and the report says so — naming both versions and pointing at git,
 * which is what actually knows.
 */
export function removeCapabilities(options: RemoveCapabilitiesOptions): CatalogRemovalReport {
  const projectDir = resolve(options.projectDir);
  const catalogDir = resolve(options.catalogDir);
  const dryRun = options.dryRun ?? false;
  const catalog = readCatalog(catalogDir);
  const byId = new Map(catalog.map((manifest) => [manifest.id, manifest]));
  const present = presentCapabilityIds(projectDir, catalogDir);

  const requested = [...new Set(options.ids)];
  const removing = requested.filter((id) => present.includes(id));
  const notInstalled = requested.filter((id) => !present.includes(id));

  const staying = present.filter((id) => !removing.includes(id));
  const blockers = staying.flatMap((id) => {
    const manifest = byId.get(id);
    const needed = (manifest?.requires ?? []).filter((required) => removing.includes(required));
    return needed.map((required) => `${id} requires ${required}`);
  });
  if (blockers.length > 0) {
    throw new Error(
      `Cannot remove: ${blockers.join(', ')}. Remove the dependent capabilities too, or keep these.`,
    );
  }

  // Paths still provided by a capability that stays — never delete those.
  const keptPaths = new Set<string>();
  for (const id of staying) {
    for (const path of byId.get(id)?.files ?? []) keptPaths.add(path);
  }

  const report: CatalogRemovalReport = {
    deletedFiles: [],
    dryRun,
    keptDivergedFiles: [],
    keptModifiedFiles: [],
    keptSharedFiles: [],
    notInstalled,
    orphanedDependencyNames: [],
    projectDir,
    removed: removing,
    removedToolEntries: [],
  };

  for (const id of removing) {
    const manifest = byId.get(id);
    // The stamp is what says whether the distribution in hand is the one this
    // copy came from — see this function's doc. Read once per capability.
    const copied = manifest ? stampedCapabilityVersion(projectDir, manifest) : null;
    const comparable = manifest !== undefined && copied === manifest.version;
    for (const file of manifest ? entryFiles(manifest, catalogDir) : []) {
      const path = file.relativePath;
      if (keptPaths.has(path)) {
        report.keptSharedFiles.push(path);
        continue;
      }
      const target = join(projectDir, path);
      if (!existsSync(target)) continue; // already gone — nothing to do
      // The DISTRIBUTION is the comparison basis — no stored baseline needed —
      // but only while it is the SAME distribution this copy was written from.
      if (!readFileSync(target).equals(file.bytes)) {
        if (comparable) {
          // Same version, different bytes: the project edited it. Its work.
          report.keptModifiedFiles.push(path);
        } else {
          // Different (or unrecorded) version: drift, edit, or both — and
          // nothing here can tell them apart, so it must not claim to.
          report.keptDivergedFiles.push({
            capabilityId: id,
            copied,
            current: manifest?.version ?? '(unknown)',
            path,
          });
        }
        continue;
      }
      report.deletedFiles.push(path);
      if (!dryRun) rmSync(target, { force: true });
    }
    // The stamp is provenance for a copy that no longer exists. It goes
    // unconditionally — unlike the source files, there is nothing in it a
    // project could have meaningfully edited and want to keep.
    if (manifest) {
      const stampTarget = join(projectDir, capabilityStampPath(manifest));
      if (existsSync(stampTarget)) {
        report.deletedFiles.push(capabilityStampPath(manifest));
        if (!dryRun) rmSync(stampTarget, { force: true });
      }
    }
    report.orphanedDependencyNames.push(
      ...Object.keys(byId.get(id)?.packageJson?.dependencies ?? {}),
      ...Object.keys(byId.get(id)?.packageJson?.devDependencies ?? {}),
    );
  }
  report.deletedFiles.sort();
  report.keptModifiedFiles.sort();
  report.keptDivergedFiles.sort((a, b) => a.path.localeCompare(b.path));
  report.keptSharedFiles = [...new Set(report.keptSharedFiles)].sort();
  report.orphanedDependencyNames = [...new Set(report.orphanedDependencyNames)].sort();

  // Drop the removed capabilities' tool registrations so the editor stops
  // looking for entries whose files are gone.
  const packagePath = join(projectDir, 'package.json');
  if (existsSync(packagePath)) {
    const original = readFileSync(packagePath);
    const parsed = JSON.parse(original.toString('utf8')) as Record<string, unknown>;
    const vgai = parsed['vgai'];
    if (isRecord(vgai) && Array.isArray(vgai['tools'])) {
      const doomed = new Set(
        removing.flatMap((id) =>
          (byId.get(id)?.packageJson?.vgaiTools ?? []).map((tool) => toolIdentity(tool)),
        ),
      );
      const tools = (vgai['tools'] as ProjectToolEntry[]).filter(
        (tool) => !doomed.has(toolIdentity(tool)),
      );
      report.removedToolEntries = [...doomed].sort();
      if (tools.length !== (vgai['tools'] as ProjectToolEntry[]).length) {
        vgai['tools'] = tools;
        if (!dryRun) {
          writeFileSync(packagePath, Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`));
        }
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Reference-triggered discovery — which capability provides a given tool name.
//
// Capability tool files declare their runnable name inside the source
// (`defineTool({ name: 'project.humanoid.bake', … })`); the catalog manifest
// only records the entry path. Scanning the shipped project-source for the
// declared name lets a CLI invocation of an uninstalled capability's tool
// converge the project (auto-add) instead of erroring.
// ---------------------------------------------------------------------------

export interface CatalogToolProvider {
  capabilityId: string;
  /** The manifest's vgai.tools entry path, e.g. `./src/tools/humanoid-bake.tool.ts` — the registration identity in a project's package.json. */
  entry: string;
}

const DEFINE_TOOL_NAME_PATTERN = /defineTool\(\s*\{[\s\S]*?\bname\s*:\s*(['"])([^'"]+)\1/;

/** The `defineTool({ name })` a capability-shipped tool source declares, or undefined when the file has none. */
function declaredToolName(sourcePath: string): string | undefined {
  if (!existsSync(sourcePath)) return undefined;
  return DEFINE_TOOL_NAME_PATTERN.exec(readFileSync(sourcePath, 'utf8'))?.[2];
}

/**
 * Every catalog capability whose shipped `vgai.tools` contribution declares
 * `toolName`. Multiple providers means the trigger is ambiguous — callers
 * must not auto-add in that case.
 */
export function findEntriesProvidingTool(
  catalogDir: string,
  toolName: string,
): CatalogToolProvider[] {
  const resolved = resolve(catalogDir);
  const providers: CatalogToolProvider[] = [];
  for (const manifest of readCatalog(resolved)) {
    for (const tool of manifest.packageJson?.vgaiTools ?? []) {
      const entry = typeof tool === 'string' ? tool : tool['entry'];
      if (typeof entry !== 'string' || entry.length === 0) continue;
      const sourcePath = join(resolved, 'project-source', entry.replace(/^\.\//, ''));
      if (declaredToolName(sourcePath) === toolName) {
        providers.push({ capabilityId: manifest.id, entry });
      }
    }
  }
  return providers;
}

export interface CapabilityVersionRow {
  /** Version this project's copy was taken from; null for a pre-stamp copy. */
  copied: string | null;
  /** Version the installed distribution ships now. */
  current: string;
  id: string;
  outdated: boolean;
}

/**
 * Which vendored capabilities the distribution has moved past.
 *
 * This reports ONE fact — upstream moved — and deliberately does not try to
 * classify the project's own edits. It could not do so honestly: telling
 * "stale" from "stale AND edited" needs the bytes of the version the project
 * copied, and only the current one ships. The project's edits are git's to
 * report, and git already does it better than any heuristic here would.
 */
export function capabilityVersions(
  projectDirInput: string,
  catalogDir: string,
): CapabilityVersionRow[] {
  const projectDir = resolve(projectDirInput);
  const resolvedCatalog = resolve(catalogDir);
  const byId = new Map(readCatalog(resolvedCatalog).map((entry) => [entry.id, entry]));
  const rows: CapabilityVersionRow[] = [];
  for (const id of presentCapabilityIds(projectDir, resolvedCatalog)) {
    const entry = byId.get(id);
    if (!entry) continue;
    // `null` for a pre-stamp copy — reported as unknown, never guessed.
    const copied = stampedCapabilityVersion(projectDir, entry);
    rows.push({ copied, current: entry.version, id, outdated: copied !== entry.version });
  }
  return rows;
}

export function readCatalogStatus(projectDirInput: string, catalogDir: string): CatalogStatus {
  const projectDir = resolve(projectDirInput);
  // Prefer the project's own catalog copy; fall back to the distribution so a
  // project that never had one can still be asked what is available.
  const projectCatalog = join(projectDir, PROJECT_CATALOG_DIR);
  const available = existsSync(projectCatalog)
    ? listManifestPaths(projectCatalog).map(readCatalogEntry)
    : readCatalog(resolve(catalogDir));
  return { available, installed: presentCapabilityIds(projectDir, catalogDir), projectDir };
}
