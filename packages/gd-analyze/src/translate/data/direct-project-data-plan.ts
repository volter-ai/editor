import {
  capabilityStampPath,
  planCapabilityPackageJson,
} from '../../../../game-editor/node/scaffold/catalog.js';
import type { BoundGodotProject } from '../../analyze/bound-project';
import type { GodotImportToolchainSnapshot } from '../../snapshot/toolchain-snapshot';
import type { DirectGodotProjectCompositionPlan } from './direct-project-composition-plan';
import {
  type DirectGodotProjectShellFilePlan,
  planDirectGodotProjectShell,
} from './direct-project-shell-plan';
import { GodotLifecycleAuthorityResolver } from './lifecycle-authority';
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

export interface DirectGodotCapabilityStampPlan {
  readonly targetPath: string;
  readonly toolchainSource: { readonly path: string; readonly digest: string };
  readonly value: { readonly id: string; readonly version: string };
}

export interface DirectGodotProjectDataPlan {
  readonly version: typeof DIRECT_GODOT_PROJECT_DATA_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly toolchainDigest: string;
  readonly worldModule: DirectGodotProjectModulePlan;
  readonly manifest: DirectJsonValue;
  readonly packageManifest: DirectJsonValue;
  readonly packageLock: DirectJsonValue;
  readonly shellFiles: readonly DirectGodotProjectShellFilePlan[];
  readonly capabilityStamps: readonly DirectGodotCapabilityStampPlan[];
  readonly evidence: {
    readonly projectStartupClaimIds: readonly string[];
    readonly lifecycleRegistryDigest: string;
  };
  readonly requirements: {
    readonly engine: {
      readonly packageName: '@volter/game-runtime';
      readonly version: string;
      readonly packageJsonDigest: string;
      readonly sourceBuild?: { readonly sha: string; readonly dirty: boolean };
      readonly entryPoint: '@volter/game-runtime/world3d-react';
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
  vgai?: unknown;
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
  return `com.vgai.import.${compact || 'game'}`;
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
    if (frozenRoot[field] === undefined) delete planned[field];
    else planned[field] = { ...frozenRoot[field] };
  }
}

function plannedPackageManifest(
  project: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
): MutablePackageManifest {
  const manifest = JSON.parse(
    frozenTemplateText(toolchain, 'package.json'),
  ) as MutablePackageManifest;
  manifest.name = slugify(project.projectName);
  manifest.dependencies ??= {};
  manifest.dependencies['@volter/game-runtime'] = `^${installedPackageVersion(toolchain, '@volter/game-runtime')}`;
  manifest.devDependencies ??= {};
  // The template names the product's packages; each is pinned to the installed build.
  for (const field of [manifest.dependencies, manifest.devDependencies]) {
    for (const name of Object.keys(field)) {
      if (name.startsWith('@volter/')) field[name] = `^${installedPackageVersion(toolchain, name)}`;
    }
  }
  manifest.scripts = {
    vgai: 'volter-game-editor',
    dev: 'volter-game-editor edit .',
    'dev:standalone': 'vite',
    build: 'vite build',
    preview: 'vite preview',
    typecheck: 'tsc --noEmit',
  };
  delete manifest.vgai;
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

function capabilityStampPlans(
  toolchain: GodotImportToolchainSnapshot,
): readonly DirectGodotCapabilityStampPlan[] {
  const catalogArtifacts = new Map(
    toolchain.catalogArtifacts.map((artifact) => [artifact.path, artifact] as const),
  );
  if (catalogArtifacts.size !== toolchain.catalogArtifacts.length) {
    throw new Error('toolchain snapshot contains duplicate catalog artifact paths');
  }
  return toolchain.capabilities.map((capability) => {
    const path = `catalog/entries/${capability.id}.json`;
    const artifact = catalogArtifacts.get(path);
    if (artifact === undefined) {
      throw new Error(`${path}: capability stamp has no captured catalog source`);
    }
    let source: unknown;
    try {
      source = JSON.parse(Buffer.from(artifact.bytes).toString('utf8'));
    } catch (error) {
      throw new Error(
        `${path}: captured capability catalog source is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      typeof source !== 'object' ||
      source === null ||
      Array.isArray(source) ||
      (source as Record<string, unknown>)['id'] !== capability.id ||
      (source as Record<string, unknown>)['version'] !== capability.version
    ) {
      throw new Error(`${path}: captured capability identity does not match the toolchain entry`);
    }
    return {
      targetPath: capabilityStampPath(capability),
      toolchainSource: { path, digest: artifact.digest },
      value: { id: capability.id, version: capability.version },
    };
  });
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
      message: `viewport is absent; the direct plan has not yet evidenced the ${DEFAULT_WINDOW.width}x${DEFAULT_WINDOW.height} engine default`,
    });
  }
  return diagnostics;
}

function projectStartupEvidence(
  composition: DirectGodotProjectCompositionPlan,
  toolchain: GodotImportToolchainSnapshot,
): DirectGodotProjectDataPlan['evidence'] {
  const lifecycle = new GodotLifecycleAuthorityResolver(toolchain.frontend.lifecycleAuthority);
  if (composition.sourceRevision !== lifecycle.sourceRevision) {
    throw new Error('composition and project-startup lifecycle authority differ');
  }
  const startupRule =
    composition.scriptAutoloads.length === 0 ? undefined : lifecycle.projectStartupRule();
  if (composition.scriptAutoloads.length > 0 && startupRule === undefined) {
    throw new Error('autoload-before-main project startup has no live evidence rule');
  }
  // Every project runs inside `Main`'s loop (`compat/main.tsx`).
  const mainLoopRule = lifecycle.mainLoopRule();
  if (mainLoopRule === undefined) throw new Error("Main's loop has no live evidence rule");
  return {
    projectStartupClaimIds: [...(startupRule === undefined ? [] : [startupRule.evidenceClaimId]), mainLoopRule.evidenceClaimId],
    lifecycleRegistryDigest: lifecycle.registryDigest,
  };
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
    const evidence = projectStartupEvidence(composition, toolchain);
    const packageManifest = plannedPackageManifest(project, toolchain);
    const packageLockText = planFrozenPackageLock(
      `${JSON.stringify(packageManifest, null, 2)}\n`,
      toolchain.importPackageLockBytes,
    );
    const packageLock = JSON.parse(packageLockText) as PackageLockDocument;
    const engineVersion = installedPackageVersion(toolchain, '@volter/game-runtime');
    return {
      kind: 'accepted-project-data',
      plan: {
        version: DIRECT_GODOT_PROJECT_DATA_PLAN_VERSION,
        snapshotDigest: project.snapshotDigest,
        toolchainDigest: toolchain.digest,
        worldModule: worldModule(composition),
        manifest: {
          $schema: './node_modules/@volter/editor-project/schemas/vgai-project.schema.json',
          manifestVersion: 2,
          name: project.projectName,
          appId: appId(project.projectName),
          version: '0.1.0',
          engine: { version: engineVersion },
          resolution: project.window,
          roots: [{ id: 'world', adapter: 'three', entry: 'src/world.tsx' }],
        },
        packageManifest: packageManifest as DirectJsonValue,
        packageLock: packageLock as DirectJsonValue,
        shellFiles: planDirectGodotProjectShell(project.projectName, toolchain),
        capabilityStamps: capabilityStampPlans(toolchain),
        evidence,
        requirements: {
          engine: {
            packageName: '@volter/game-runtime',
            version: engineVersion,
            packageJsonDigest: toolchain.enginePackageJsonDigest,
            ...(toolchain.engineSource === undefined
              ? {}
              : { sourceBuild: { ...toolchain.engineSource } }),
            entryPoint: '@volter/game-runtime/world3d-react',
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
