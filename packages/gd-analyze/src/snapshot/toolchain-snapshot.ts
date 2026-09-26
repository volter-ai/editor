import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type EngineSourceState,
  readEngineSourceState,
} from '../../../game-editor/node/scaffold/baseline.js';
import { type CatalogEntry, readCatalog } from '../../../game-editor/node/scaffold/catalog.js';
import { type GodotApiDump, parseGodotApiDump } from '../analyze/api-dump';
import type { GodotAnalysisAuthority } from '../analyze/authority';
import { godotAnalysisAuthority } from '../analyze/authority-data';
import {
  captureGodotBoundExporterSnapshot,
  type GodotBoundExporterSnapshot,
} from '../godot-frontend/run-bound-program';
import { selectGodotFrontendAuthority } from '../godot-frontend/select-frontend';
import type { GodotSourceAuthority } from '../godot-frontend/source-authority';
import type { GodotReadAuthority } from '../read/authority';
import { godotReadAuthority } from '../read/authority-data';
import type { GodotCodeTranslationAuthority } from '../translate/code/authority';
import { godotCodeTranslationAuthority } from '../translate/code/authority-data';
import type { GodotFieldValueAuthority } from '../translate/data/field-value-authority';
import { godotFieldValueAuthority } from '../translate/data/field-value-authority-data';
import type { GodotLifecycleAuthority } from '../translate/data/lifecycle-authority';
import { godotLifecycleAuthority } from '../translate/data/lifecycle-authority-data';
import type { GodotSceneNodeAuthority } from '../translate/data/scene-node-authority';
import { godotSceneNodeAuthority } from '../translate/data/scene-node-authority-data';
import type { GodotProjectSnapshot } from './project-snapshot';

export const GODOT_TOOLCHAIN_SNAPSHOT_VERSION = 16 as const;

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MONO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const DEFAULT_CATALOG_DIR = path.join(PACKAGE_DIR, 'capabilities', 'catalog');
const DEFAULT_TEMPLATE_DIR = path.join(MONO_ROOT, 'packages', 'game-editor', 'template');
const DEFAULT_ENGINE_PACKAGE = path.join(MONO_ROOT, 'packages', 'game-runtime', 'package.json');
const DEFAULT_PACKAGE_LOCK = path.join(MONO_ROOT, 'package-lock.json');
const DEFAULT_IMPORT_PACKAGE_LOCK = path.join(PACKAGE_DIR, 'toolchain', 'package-lock.json');
const DEFAULT_NODE_MODULES = path.join(MONO_ROOT, 'node_modules');
const DEFAULT_EXTENSION_API_DIR = path.join(PACKAGE_DIR, 'vendor', 'extension-api');

export interface CapabilityCopyArtifact {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly origin: {
    readonly kind: 'capability-copy';
    readonly capabilityId: string;
    readonly capabilityVersion: string;
    readonly catalogPath: string;
  };
}

export interface GodotResolvedPackage {
  readonly name: string;
  readonly engineRange?: string;
  readonly declaredRanges: readonly string[];
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
}

export interface GodotToolchainFileArtifact {
  /** Normalized path relative to the disposable toolchain root. */
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
}

export interface GodotToolchainFrontendSnapshot {
  readonly authority: GodotSourceAuthority;
  readonly analysisAuthority: GodotAnalysisAuthority;
  readonly analysisAuthorityDigest: string;
  readonly readAuthority: GodotReadAuthority;
  readonly readAuthorityDigest: string;
  readonly exporter: GodotBoundExporterSnapshot;
  readonly apiDump: GodotToolchainApiDumpSnapshot;
  readonly codeAuthority: GodotCodeTranslationAuthority;
  readonly codeAuthorityDigest: string;
  readonly fieldValueAuthority: GodotFieldValueAuthority;
  readonly fieldValueAuthorityDigest: string;
  readonly sceneNodeAuthority: GodotSceneNodeAuthority;
  readonly sceneNodeAuthorityDigest: string;
  readonly lifecycleAuthority: GodotLifecycleAuthority;
  readonly lifecycleAuthorityDigest: string;
}

export interface GodotToolchainApiDumpSnapshot {
  readonly fileName: string;
  readonly digest: string;
  readonly bytes: Uint8Array;
  readonly parsed: GodotApiDump;
}

export interface GodotToolchainSnapshot {
  readonly version: typeof GODOT_TOOLCHAIN_SNAPSHOT_VERSION;
  readonly digest: string;
  readonly enginePackageJsonDigest: string;
  readonly engineSource?: EngineSourceState;
  readonly workspacePackageLockDigest: string;
  readonly workspacePackageLockBytes: Uint8Array;
  readonly importPackageLockDigest: string;
  readonly importPackageLockBytes: Uint8Array;
  readonly frontend?: GodotToolchainFrontendSnapshot;
  readonly capabilities: readonly CatalogEntry[];
  readonly capabilityCopies: readonly CapabilityCopyArtifact[];
  readonly catalogArtifacts: readonly GodotToolchainFileArtifact[];
  readonly scaffoldArtifacts: readonly GodotToolchainFileArtifact[];
  readonly packages: readonly GodotResolvedPackage[];
}

export interface GodotImportToolchainSnapshot extends GodotToolchainSnapshot {
  readonly frontend: GodotToolchainFrontendSnapshot;
}

export interface CaptureGodotToolchainOptions {
  readonly catalogDir?: string;
  readonly templateDir?: string;
  readonly enginePackagePath?: string;
  readonly packageLockPath?: string;
  readonly importPackageLockPath?: string;
  readonly nodeModulesDir?: string;
}

export interface CaptureGodotImportToolchainOptions extends CaptureGodotToolchainOptions {
  readonly projectEngine: GodotProjectSnapshot['engine'];
  readonly boundExporterBinary: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Capture and decode the exact API dump named by the selected source authority once. */
export function captureGodotApiDumpSnapshot(
  authority: GodotSourceAuthority,
  extensionApiDir: string = DEFAULT_EXTENSION_API_DIR,
): GodotToolchainApiDumpSnapshot {
  const bytes = readFileSync(path.join(extensionApiDir, authority.apiDumpFile));
  const digest = sha256(bytes);
  if (digest !== authority.apiDumpSha256) {
    throw new Error(
      `${authority.apiDumpFile}: API dump digest ${digest} does not match ${authority.apiDumpSha256}`,
    );
  }
  const parsed = parseGodotApiDump(JSON.parse(bytes.toString('utf8')), authority.major);
  return { fileName: authority.apiDumpFile, digest, bytes, parsed };
}

function selectedCapabilities(catalog: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const selected: CatalogEntry[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const entry = byId.get(id);
    if (entry === undefined) throw new Error(`translation requires unknown capability ${id}`);
    visited.add(id);
    for (const dependency of entry.requires) visit(dependency);
    selected.push(entry);
  };
  visit('godot-compat');
  return selected;
}

function capabilityCopies(
  catalogDir: string,
  capabilities: readonly CatalogEntry[],
): readonly CapabilityCopyArtifact[] {
  const copies = new Map<string, CapabilityCopyArtifact>();
  const add = (
    entry: CatalogEntry,
    destination: string,
    bytes: Uint8Array,
    catalogPath: string,
    allowIdenticalDuplicate = false,
  ): void => {
    const copy: CapabilityCopyArtifact = {
      path: destination,
      bytes,
      digest: sha256(bytes),
      origin: {
        kind: 'capability-copy',
        capabilityId: entry.id,
        capabilityVersion: entry.version,
        catalogPath,
      },
    };
    const prior = copies.get(destination);
    if (prior !== undefined) {
      if (allowIdenticalDuplicate && prior.digest === copy.digest) return;
      throw new Error(`capability copy destination has more than one origin: ${destination}`);
    }
    copies.set(destination, copy);
  };
  for (const entry of capabilities) {
    for (const relative of entry.files) {
      const catalogPath = path.posix.join('project-source', relative);
      add(entry, relative, readFileSync(path.join(catalogDir, catalogPath)), catalogPath);
    }
    for (const skill of entry.skills) {
      const skillRoot = path.join(path.dirname(catalogDir), 'template', '.agents', 'skills', skill);
      for (const relative of collectFiles(skillRoot)) {
        const bytes = readFileSync(path.join(skillRoot, ...relative.split('/')));
        for (const root of ['.agents', '.claude', '.github'] as const) {
          add(
            entry,
            path.posix.join(root, 'skills', skill, relative),
            bytes,
            path.posix.join('../template/.agents/skills', skill, relative),
            true,
          );
        }
      }
    }
  }
  return [...copies.values()];
}

function collectFiles(root: string, relativeRoot = ''): readonly string[] {
  const files: string[] = [];
  const visit = (absolute: string, relative: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`toolchain snapshot refuses symlink: ${childAbsolute}`);
      }
      if (entry.isDirectory()) visit(childAbsolute, childRelative);
      else if (entry.isFile()) files.push(childRelative);
      else throw new Error(`toolchain snapshot refuses non-file entry: ${childAbsolute}`);
    }
  };
  visit(root, relativeRoot);
  return files;
}

function catalogArtifacts(
  catalogDir: string,
  capabilities: readonly CatalogEntry[],
  copies: readonly CapabilityCopyArtifact[],
): readonly GodotToolchainFileArtifact[] {
  const artifacts = new Map<string, GodotToolchainFileArtifact>();
  const add = (relativePath: string, bytes: Uint8Array): void => {
    const normalized = relativePath.replaceAll(path.sep, '/');
    const prior = artifacts.get(normalized);
    if (prior !== undefined) {
      if (prior.digest !== sha256(bytes)) {
        throw new Error(`toolchain catalog path has conflicting origins: ${normalized}`);
      }
      return;
    }
    artifacts.set(normalized, { path: normalized, bytes, digest: sha256(bytes) });
  };

  for (const capability of capabilities) {
    add(
      path.posix.join('catalog', 'entries', `${capability.id}.json`),
      readFileSync(path.join(catalogDir, 'entries', `${capability.id}.json`)),
    );
  }
  for (const copy of copies) {
    if (copy.origin.catalogPath.startsWith('project-source/')) {
      add(path.posix.join('catalog', copy.origin.catalogPath), copy.bytes);
    }
  }

  const templateDir = path.join(path.dirname(catalogDir), 'template');
  for (const skill of [...new Set(capabilities.flatMap((entry) => entry.skills))].sort()) {
    const relativeRoot = path.posix.join('.agents', 'skills', skill);
    const skillRoot = path.join(templateDir, ...relativeRoot.split('/'));
    for (const relativeFile of collectFiles(skillRoot, relativeRoot)) {
      add(
        path.posix.join('template', relativeFile),
        readFileSync(path.join(templateDir, ...relativeFile.split('/'))),
      );
    }
  }
  return [...artifacts.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function scaffoldArtifacts(
  templateDir: string,
  nodeModulesDir: string,
  enginePackageBytes: Uint8Array,
  packages: readonly GodotResolvedPackage[],
  frozenCatalog: readonly GodotToolchainFileArtifact[],
): readonly GodotToolchainFileArtifact[] {
  const artifacts = new Map<string, GodotToolchainFileArtifact>();
  const add = (relativePath: string, bytes: Uint8Array): void => {
    const normalized = relativePath.replaceAll(path.sep, '/');
    const digest = sha256(bytes);
    const prior = artifacts.get(normalized);
    if (prior !== undefined) {
      if (prior.digest !== digest) {
        throw new Error(`scaffold snapshot path has conflicting origins: ${normalized}`);
      }
      return;
    }
    artifacts.set(normalized, { path: normalized, bytes, digest });
  };

  for (const relativeFile of collectFiles(templateDir)) {
    const topLevel = relativeFile.split('/')[0];
    if (
      topLevel === 'node_modules' ||
      topLevel === 'dist' ||
      topLevel === 'logs' ||
      topLevel === '.vgai'
    ) {
      continue;
    }
    add(
      path.posix.join('packages', 'game-editor', 'template', relativeFile),
      readFileSync(path.join(templateDir, ...relativeFile.split('/'))),
    );
  }
  for (const artifact of frozenCatalog) {
    add(path.posix.join('packages', 'editor', artifact.path), artifact.bytes);
  }
  add('packages/engine/package.json', enginePackageBytes);

  const templatePackage = JSON.parse(
    readFileSync(path.join(templateDir, 'package.json'), 'utf8'),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  const packageNames = new Set([
    ...Object.keys(templatePackage.dependencies ?? {}),
    ...Object.keys(templatePackage.devDependencies ?? {}),
    ...packages.map((entry) => entry.name),
  ]);
  for (const name of [...packageNames].sort()) {
    const manifestPath = path.join(nodeModulesDir, name, 'package.json');
    add(path.posix.join('node_modules', name, 'package.json'), readFileSync(manifestPath));
  }
  return [...artifacts.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function dependencyRanges(
  capabilities: readonly CatalogEntry[],
  engineDependencies: Readonly<Record<string, string>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const ranges = new Map<string, Set<string>>();
  const add = (name: string, range: string): void => {
    const values = ranges.get(name) ?? new Set<string>();
    values.add(range);
    ranges.set(name, values);
  };
  for (const [name, range] of Object.entries(engineDependencies)) add(name, range);
  for (const capability of capabilities) {
    for (const [name, range] of Object.entries(capability.packageJson?.dependencies ?? {})) {
      add(name, range);
    }
  }
  return ranges;
}

function resolvedPackages(
  lock: Readonly<Record<string, unknown>>,
  ranges: ReadonlyMap<string, ReadonlySet<string>>,
  engineDependencies: Readonly<Record<string, string>>,
): readonly GodotResolvedPackage[] {
  const packages = lock['packages'];
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) {
    throw new Error('package-lock.json has no npm v3 packages table');
  }
  const rows = packages as Readonly<Record<string, unknown>>;
  return [...ranges.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, declaredRanges]) => {
      const value = rows[`node_modules/${name}`];
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`package-lock.json has no root resolution for ${name}`);
      }
      const row = value as Readonly<Record<string, unknown>>;
      if (
        typeof row['version'] !== 'string' ||
        typeof row['resolved'] !== 'string' ||
        typeof row['integrity'] !== 'string'
      ) {
        throw new Error(`package-lock.json resolution for ${name} is not exact and integral`);
      }
      return {
        name,
        ...(engineDependencies[name] === undefined
          ? {}
          : { engineRange: engineDependencies[name] }),
        declaredRanges: [...declaredRanges].sort(),
        version: row['version'],
        resolved: row['resolved'],
        integrity: row['integrity'],
      };
    });
}

/** Capture native package resolution and exact copied-capability bytes before translation starts. */
function captureToolchainSnapshot(
  options: CaptureGodotToolchainOptions,
  frontend?: GodotToolchainFrontendSnapshot,
): GodotToolchainSnapshot {
  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR;
  const templateDir = options.templateDir ?? DEFAULT_TEMPLATE_DIR;
  const enginePackagePath = options.enginePackagePath ?? DEFAULT_ENGINE_PACKAGE;
  const packageLockPath = options.packageLockPath ?? DEFAULT_PACKAGE_LOCK;
  const importPackageLockPath = options.importPackageLockPath ?? DEFAULT_IMPORT_PACKAGE_LOCK;
  const nodeModulesDir = options.nodeModulesDir ?? DEFAULT_NODE_MODULES;
  const catalog = readCatalog(catalogDir);
  const capabilities = selectedCapabilities(catalog);
  const enginePackageBytes = readFileSync(enginePackagePath);
  const workspacePackageLockBytes = readFileSync(packageLockPath);
  const importPackageLockBytes = readFileSync(importPackageLockPath);
  const enginePackage = JSON.parse(enginePackageBytes.toString('utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  const engineDependencies = enginePackage.dependencies ?? {};
  const ranges = dependencyRanges(capabilities, engineDependencies);
  const packages = resolvedPackages(
    JSON.parse(workspacePackageLockBytes.toString('utf8')) as Readonly<Record<string, unknown>>,
    ranges,
    engineDependencies,
  );
  const copies = capabilityCopies(catalogDir, capabilities);
  const frozenCatalog = catalogArtifacts(catalogDir, capabilities, copies);
  const frozenScaffold = scaffoldArtifacts(
    templateDir,
    nodeModulesDir,
    enginePackageBytes,
    packages,
    frozenCatalog,
  );
  const enginePackageJsonDigest = sha256(enginePackageBytes);
  const engineSource = readEngineSourceState(path.dirname(enginePackagePath));
  const workspacePackageLockDigest = sha256(workspacePackageLockBytes);
  const importPackageLockDigest = sha256(importPackageLockBytes);
  const digest = sha256(
    JSON.stringify({
      version: GODOT_TOOLCHAIN_SNAPSHOT_VERSION,
      enginePackageJsonDigest,
      engineSource,
      workspacePackageLockDigest,
      importPackageLockDigest,
      ...(frontend === undefined
        ? {}
        : {
            frontend: {
              authority: frontend.authority,
              analysisAuthorityDigest: frontend.analysisAuthorityDigest,
              readAuthorityDigest: frontend.readAuthorityDigest,
              apiDump: {
                fileName: frontend.apiDump.fileName,
                digest: frontend.apiDump.digest,
              },
              codeAuthorityDigest: frontend.codeAuthorityDigest,
              fieldValueAuthorityDigest: frontend.fieldValueAuthorityDigest,
              sceneNodeAuthorityDigest: frontend.sceneNodeAuthorityDigest,
              lifecycleAuthorityDigest: frontend.lifecycleAuthorityDigest,
              exporter: {
                version: frontend.exporter.version,
                executableSha256: frontend.exporter.executableSha256,
                captureScriptSha256: frontend.exporter.captureScriptSha256,
                exporterSourceSha256: frontend.exporter.exporterSourceSha256,
              },
            },
          }),
      capabilities: copies.map((copy) => ({
        path: copy.path,
        digest: copy.digest,
        origin: copy.origin,
      })),
      catalogArtifacts: frozenCatalog.map(({ path: artifactPath, digest: artifactDigest }) => ({
        path: artifactPath,
        digest: artifactDigest,
      })),
      scaffoldArtifacts: frozenScaffold.map(({ path: artifactPath, digest: artifactDigest }) => ({
        path: artifactPath,
        digest: artifactDigest,
      })),
      packages,
    }),
  );
  return {
    version: GODOT_TOOLCHAIN_SNAPSHOT_VERSION,
    digest,
    enginePackageJsonDigest,
    ...(engineSource === undefined ? {} : { engineSource }),
    workspacePackageLockDigest,
    workspacePackageLockBytes,
    importPackageLockDigest,
    importPackageLockBytes,
    ...(frontend === undefined ? {} : { frontend }),
    capabilities,
    capabilityCopies: copies,
    catalogArtifacts: frozenCatalog,
    scaffoldArtifacts: frozenScaffold,
    packages,
  };
}

export function captureGodotToolchainSnapshot(
  options: CaptureGodotToolchainOptions = {},
): GodotToolchainSnapshot {
  return captureToolchainSnapshot(options);
}

/** Capture the source-matched official frontend and every other import toolchain input once. */
export function captureGodotImportToolchainSnapshot(
  options: CaptureGodotImportToolchainOptions,
): GodotImportToolchainSnapshot {
  const authority = selectGodotFrontendAuthority(options.projectEngine);
  const analysisAuthority = godotAnalysisAuthority(authority);
  const codeAuthority = godotCodeTranslationAuthority(authority);
  const readAuthority = godotReadAuthority(authority);
  const fieldValueAuthority = godotFieldValueAuthority(authority);
  const sceneNodeAuthority = godotSceneNodeAuthority(authority);
  const lifecycleAuthority = godotLifecycleAuthority(authority);
  const frontend: GodotToolchainFrontendSnapshot = {
    authority,
    analysisAuthority,
    analysisAuthorityDigest: sha256(JSON.stringify(analysisAuthority)),
    readAuthority,
    readAuthorityDigest: sha256(JSON.stringify(readAuthority)),
    exporter: captureGodotBoundExporterSnapshot(options.boundExporterBinary),
    apiDump: captureGodotApiDumpSnapshot(authority),
    codeAuthority,
    codeAuthorityDigest: sha256(JSON.stringify(codeAuthority)),
    fieldValueAuthority,
    fieldValueAuthorityDigest: sha256(JSON.stringify(fieldValueAuthority)),
    sceneNodeAuthority,
    sceneNodeAuthorityDigest: sha256(JSON.stringify(sceneNodeAuthority)),
    lifecycleAuthority,
    lifecycleAuthorityDigest: sha256(JSON.stringify(lifecycleAuthority)),
  };
  return captureToolchainSnapshot(options, frontend) as GodotImportToolchainSnapshot;
}

function materializeArtifacts(
  artifacts: readonly GodotToolchainFileArtifact[],
  destinationRoot: string,
): void {
  const resolvedRoot = path.resolve(destinationRoot);
  for (const artifact of artifacts) {
    const segments = artifact.path.split('/');
    if (
      artifact.path.length === 0 ||
      path.isAbsolute(artifact.path) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`toolchain artifact has unsafe path: ${artifact.path}`);
    }
    if (sha256(artifact.bytes) !== artifact.digest) {
      throw new Error(`toolchain artifact bytes changed after capture: ${artifact.path}`);
    }
    const target = path.join(resolvedRoot, ...segments);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, artifact.bytes);
    if (sha256(readFileSync(target)) !== artifact.digest) {
      throw new Error(`materialized toolchain artifact has wrong bytes: ${artifact.path}`);
    }
  }
}

/** Reconstruct every scaffold input using only bytes captured before translation. */
export function materializeGodotScaffoldToolchain(
  snapshot: GodotToolchainSnapshot,
  destinationRoot: string,
): string {
  materializeArtifacts(snapshot.scaffoldArtifacts, destinationRoot);
  return path.resolve(destinationRoot);
}

/** Compatibility-free operational entrypoint for report/probe callers needing exact copy bytes. */
export function planGodotCapabilityCopies(
  catalogDir: string = DEFAULT_CATALOG_DIR,
): readonly CapabilityCopyArtifact[] {
  const catalog = readCatalog(catalogDir);
  return capabilityCopies(catalogDir, selectedCapabilities(catalog));
}
