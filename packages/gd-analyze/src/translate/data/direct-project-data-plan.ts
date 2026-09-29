import { planCapabilityPackageJson } from '../../../../game-editor/node/scaffold/catalog.js';
import { godotCompositionHasControls } from './scene-refs';
import type { BoundGodotProject } from '../../analyze/bound-project';
import type { GodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import type { DirectGodotProjectCompositionPlan } from './direct-project-composition-plan';
import {
  type DirectGodotProjectShellFilePlan,
  planDirectGodotProjectShell,
} from './direct-project-shell-plan';
import { planFrozenPackageLock } from './package-lock-plan';

export const DIRECT_GODOT_PROJECT_DATA_PLAN_VERSION = 5 as const;

const TEMPLATE_PREFIX = 'packages/game-editor/template/';
const DEFAULT_WINDOW = { width: 1024, height: 600 } as const;

export type DirectJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DirectJsonValue[]
  | { readonly [key: string]: DirectJsonValue };

export interface DirectGodotProjectModulePlan {
  readonly targetPath: string;
  readonly sourcePaths: readonly string[];
}

export interface DirectGodotPackageRequirement {
  readonly name: string;
  readonly declaration: 'dependency' | 'dev-dependency' | 'optional-dependency';
  readonly declaredRange: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
}

export interface DirectGodotCapabilityRequirement {
  readonly id: string;
  readonly version: string;
  readonly artifacts: readonly { readonly path: string; readonly digest: string }[];
}

export interface DirectGodotProjectDataPlan {
  readonly version: typeof DIRECT_GODOT_PROJECT_DATA_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly toolchainDigest: string;
  readonly worldModule: DirectGodotProjectModulePlan;
  /** The page's Controls (`src/ui.tsx`), a `dom` root over the world's, when a scene renders any. */
  readonly uiModule?: DirectGodotProjectModulePlan;
  readonly manifest: DirectJsonValue;
  readonly packageManifest: DirectJsonValue;
  readonly packageLock: DirectJsonValue;
  readonly shellFiles: readonly DirectGodotProjectShellFilePlan[];
  readonly requirements: {
    readonly engine: {
      readonly packageName: '@volter/game-runtime';
      readonly version: string;
      readonly packageJsonDigest: string;
      readonly sourceBuild?: { readonly sha: string; readonly dirty: boolean };
      /** What the template's `main.ts` mounts a `three` root with: fiber's `<Canvas>`. */
      readonly entryPoint: '@react-three/fiber';
    };
    readonly packages: readonly DirectGodotPackageRequirement[];
    readonly capabilities: readonly DirectGodotCapabilityRequirement[];
  };
}

export interface DirectGodotProjectDataDiagnostic {
  readonly at: string;
  readonly message: string;
}

export type DirectGodotProjectDataResult =
  | { readonly kind: 'accepted-project-data'; readonly plan: DirectGodotProjectDataPlan }
  | {
      readonly kind: 'refused-project-data';
      readonly diagnostics: readonly DirectGodotProjectDataDiagnostic[];
    };

interface MutablePackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  volter?: unknown;
  [key: string]: unknown;
}

interface PackageLockRow {
  readonly version?: unknown;
  readonly resolved?: unknown;
  readonly integrity?: unknown;
}

interface PackageLockDocument {
  readonly packages?: Readonly<Record<string, PackageLockRow>>;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'game'
  );
}

function appId(name: string): string {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return `com.volter.import.${compact || 'game'}`;
}

function frozenTemplateText(toolchain: GodotImportToolchainSnapshot, projectPath: string): string {
  const path = `${TEMPLATE_PREFIX}${projectPath}`;
  const artifact = toolchain.scaffoldArtifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) throw new Error(`${path}: absent from frozen scaffold snapshot`);
  return Buffer.from(artifact.bytes).toString('utf8');
}

function installedPackageVersion(toolchain: GodotImportToolchainSnapshot, name: string): string {
  const path = `node_modules/${name}/package.json`;
  const artifact = toolchain.scaffoldArtifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) throw new Error(`${path}: absent from frozen scaffold snapshot`);
  const manifest = JSON.parse(Buffer.from(artifact.bytes).toString('utf8')) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== 'string') throw new Error(`${path}: version is absent`);
  return manifest.version;
}

function applyFrozenDependencyDeclarations(
  planned: MutablePackageManifest,
  toolchain: GodotImportToolchainSnapshot,
): void {
  const frozenLock = JSON.parse(Buffer.from(toolchain.importPackageLockBytes).toString('utf8')) as {
    readonly packages?: Readonly<Record<string, MutablePackageManifest>>;
  };
  const frozenRoot = frozenLock.packages?.[''];
  if (frozenRoot === undefined) throw new Error('frozen package-lock.json has no root package row');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const plannedNames = Object.keys(planned[field] ?? {}).sort();
    const frozenNames = Object.keys(frozenRoot[field] ?? {}).sort();
    if (JSON.stringify(plannedNames) !== JSON.stringify(frozenNames)) {
      throw new Error(
        `frozen package-lock.json ${field} names do not match planned capability requirements: planned-only [${plannedNames.filter((name) => !frozenNames.includes(name)).join(', ')}], frozen-only [${frozenNames.filter((name) => !plannedNames.includes(name)).join(', ')}]`,
      );
    }
    // The lock resolved the ranges its root row names; a range the merge planned differently (the
    // project's `react: ~19.2.4` against a capability's caret) is a stale lock, not a choice.
    const drifted = plannedNames.filter((name) => planned[field]?.[name] !== frozenRoot[field]?.[name]);
    if (drifted.length > 0) {
      throw new Error(
        `frozen package-lock.json ${field} ranges differ from the planned merge: ${drifted.map((name) => `${name} planned ${planned[field]?.[name]}, frozen ${frozenRoot[field]?.[name]}`).join('; ')}`,
      );
    }
    if (frozenRoot[field] === undefined) delete planned[field];
    else planned[field] = { ...frozenRoot[field] };
  }
}

/**
 * The template's packages an imported game neither runs nor builds with: its multiplayer server's
 * (`server/`, which an import does not carry) and its manifest validator's schema library.
 */
const TEMPLATE_PACKAGES_NOT_CARRIED = ['@colyseus/schema', '@colyseus/sdk', '@colyseus/ws-transport', 'colyseus', 'zod'] as const;
/** The template's packages only the editor's files use (`volter.adapter.ts`, `vite.config.ts`): development dependencies. */
const EDITOR_FILE_PACKAGES = ['@volter/editor-project'] as const;

function plannedPackageManifest(
  project: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
): MutablePackageManifest {
  const manifest = JSON.parse(
    frozenTemplateText(toolchain, 'package.json'),
  ) as MutablePackageManifest;
  manifest.name = slugify(project.projectName);
  manifest.dependencies ??= {};
  manifest.devDependencies ??= {};
  for (const name of TEMPLATE_PACKAGES_NOT_CARRIED) {
    delete manifest.dependencies[name];
    delete manifest.devDependencies[name];
  }
  for (const name of EDITOR_FILE_PACKAGES) {
    const range = manifest.dependencies[name];
    if (range === undefined) continue;
    delete manifest.dependencies[name];
    manifest.devDependencies[name] = range;
  }
  manifest.dependencies['@volter/game-runtime'] = `^${installedPackageVersion(toolchain, '@volter/game-runtime')}`;
  // The template names the product's packages; each is pinned to the installed build.
  for (const field of [manifest.dependencies, manifest.devDependencies]) {
    for (const name of Object.keys(field)) {
      if (name.startsWith('@volter/')) field[name] = `^${installedPackageVersion(toolchain, name)}`;
    }
  }
  manifest.scripts = {
    volter: 'volter-game-editor',
    dev: 'volter-game-editor edit .',
    'dev:standalone': 'vite',
    build: 'vite build',
    preview: 'vite preview',
    typecheck: 'tsc --noEmit',
  };
  delete manifest.volter;
  const merged = planCapabilityPackageJson(
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    toolchain.capabilities,
  );
  const planned = JSON.parse(Buffer.from(merged).toString('utf8')) as MutablePackageManifest;
  applyFrozenDependencyDeclarations(planned, toolchain);
  return planned;
}

function packageRequirements(
  manifest: MutablePackageManifest,
  lock: PackageLockDocument,
): readonly DirectGodotPackageRequirement[] {
  if (lock.packages === undefined) throw new Error('package-lock.json: packages table is absent');
  const fields = [
    ['dependencies', 'dependency'],
    ['devDependencies', 'dev-dependency'],
    ['optionalDependencies', 'optional-dependency'],
  ] as const;
  return fields.flatMap(([field, declaration]) =>
    Object.entries(manifest[field] ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, declaredRange]) => {
        const row = lock.packages?.[`node_modules/${name}`];
        if (
          row === undefined ||
          typeof row.version !== 'string' ||
          typeof row.resolved !== 'string' ||
          typeof row.integrity !== 'string'
        ) {
          throw new Error(`package-lock.json: ${name} has no exact integral root resolution`);
        }
        return {
          name,
          declaration,
          declaredRange,
          version: row.version,
          resolved: row.resolved,
          integrity: row.integrity,
        };
      }),
  );
}

function capabilityRequirements(
  toolchain: GodotImportToolchainSnapshot,
): readonly DirectGodotCapabilityRequirement[] {
  return toolchain.capabilities.map((capability) => ({
    id: capability.id,
    version: capability.version,
    artifacts: toolchain.capabilityCopies
      .filter((artifact) => artifact.origin.capabilityId === capability.id)
      .map((artifact) => ({ path: artifact.path, digest: artifact.digest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }));
}

function worldModule(composition: DirectGodotProjectCompositionPlan): DirectGodotProjectModulePlan {
  return {
    targetPath: 'src/world.tsx',
    sourcePaths: [
      ...new Set([
        'project.godot',
        composition.mainScene,
        ...composition.sourceModules.map((module) => module.sourceResPath),
        ...composition.scriptAutoloads.map((autoload) => autoload.scriptResPath),
      ]),
    ],
  };
}

function projectDataDiagnostics(
  project: BoundGodotProject,
  composition: DirectGodotProjectCompositionPlan,
): readonly DirectGodotProjectDataDiagnostic[] {
  const diagnostics: DirectGodotProjectDataDiagnostic[] = [];
  if (composition.snapshotDigest !== project.snapshotDigest) {
    diagnostics.push({
      at: 'project.godot',
      message: 'composition uses a different source snapshot',
    });
  }
  if (project.window === undefined) {
    diagnostics.push({
      at: 'project.godot#[display].window/size',
      message: `viewport is absent; the plan does not yet state the ${DEFAULT_WINDOW.width}x${DEFAULT_WINDOW.height} engine default`,
    });
  }
  return diagnostics;
}

/** Plan native project wiring and frozen requirements without reading source or writing output. */
export function planDirectGodotProjectData(
  project: BoundGodotProject,
  composition: DirectGodotProjectCompositionPlan,
  toolchain: GodotImportToolchainSnapshot,
): DirectGodotProjectDataResult {
  const diagnostics = projectDataDiagnostics(project, composition);
  if (diagnostics.length > 0 || project.window === undefined) {
    return { kind: 'refused-project-data', diagnostics };
  }
  try {
    const packageManifest = plannedPackageManifest(project, toolchain);
    const packageLockText = planFrozenPackageLock(
      `${JSON.stringify(packageManifest, null, 2)}\n`,
      toolchain.importPackageLockBytes,
    );
    const packageLock = JSON.parse(packageLockText) as PackageLockDocument;
    const engineVersion = installedPackageVersion(toolchain, '@volter/game-runtime');
    const controls = godotCompositionHasControls(composition);
    return {
      kind: 'accepted-project-data',
      plan: {
        version: DIRECT_GODOT_PROJECT_DATA_PLAN_VERSION,
        snapshotDigest: project.snapshotDigest,
        toolchainDigest: toolchain.digest,
        worldModule: worldModule(composition),
        ...(controls ? { uiModule: { targetPath: 'src/ui.tsx', sourcePaths: worldModule(composition).sourcePaths } } : {}),
        manifest: {
          $schema: './node_modules/@volter/editor-project/schemas/volter-project.schema.json',
          manifestVersion: 2,
          name: project.projectName,
          appId: appId(project.projectName),
          version: '0.1.0',
          engine: { version: engineVersion },
          resolution: project.window,
          // The page's Controls render over the world, as react-dom in a `dom` root (`main.ts`).
          roots: [{ id: 'world', adapter: 'three', entry: 'src/world.tsx' }, ...(controls ? [{ id: 'ui', adapter: 'dom', entry: 'src/ui.tsx', zOrder: 1 }] : [])],
        },
        packageManifest: packageManifest as DirectJsonValue,
        packageLock: packageLock as DirectJsonValue,
        shellFiles: planDirectGodotProjectShell(project.projectName, toolchain),
        requirements: {
          engine: {
            packageName: '@volter/game-runtime',
            version: engineVersion,
            packageJsonDigest: toolchain.enginePackageJsonDigest,
            ...(toolchain.engineSource === undefined
              ? {}
              : { sourceBuild: { ...toolchain.engineSource } }),
            entryPoint: '@react-three/fiber',
          },
          packages: packageRequirements(packageManifest, packageLock),
          capabilities: capabilityRequirements(toolchain),
        },
      },
    };
  } catch (error) {
    return {
      kind: 'refused-project-data',
      diagnostics: [
        {
          at: 'toolchain-snapshot',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
