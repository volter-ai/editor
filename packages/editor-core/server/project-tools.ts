import {
  type ProviderModeResolver,
  withProviderExecution,
} from '@volter/editor-sdk/tools/provider-execution';
import type { EditorAccountService } from './account-service';
import { readGenerationJobs } from './generation-jobs';
/**
 * Registered project-tool discovery and execution.
 *
 * Project modules stay ordinary TS/JS. This server-side boundary is the only
 * loader: it reads explicit `package.json#vgai.tools` registrations, asks the
 * owning Vite server to load each callable module in Node, validates the
 * exported ToolDefinition, and dispatches through the existing internal SDK
 * registry.
 *
 * CALLABLES are enumerated (`vgai.tools`); the project's own CONTRIBUTION
 * MODULES are found by walking `src/contributions/` for the naming convention
 * (`isToolContributionModule`); a DEPENDENCY's contribution modules are the
 * ones it enumerates under its own `package.json#vgai.contributions`
 * (`packageContributionModules`). They are still separate browser modules and
 * are never imported here, merely listed.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ProductIdentity } from '@volter/editor-sdk/session/product-locator';
import type { z } from 'zod';
import type { GenerationJob, GenerationToolContribution } from '@volter/editor-sdk/generations';
import type {
  ProjectToolCatalog,
  ProjectToolCatalogEntry,
  ProjectToolContribution,
  ProjectToolLoadError,
} from '@volter/editor-sdk/project-tool-catalog';
import { noProjectModuleHostError } from '@volter/editor-sdk/project-tool-catalog';
import type { ToolDefinition, ToolOutcome } from '@volter/editor-sdk/tools/registry';
import { ToolRegistry } from '@volter/editor-sdk/tools/registry';
import { applyGenerationContribution } from './generation-jobs';
import { runWithGenerativeExecutionCapture } from './generative-execution-context';
import {
  createProjectOutputWriter,
  reconcileAcceptedGenerationProvenance,
} from './project-output-writer';
import { isToolContributionModule } from './server-utils';
import { productComposedPackages, sessionProduct } from './session-product';

export type ProjectModuleLoader = (absoluteModuleId: string) => Promise<unknown>;
export type {
  ProjectToolCatalog,
  ProjectToolCatalogEntry,
  ProjectToolContribution,
  ToolContributionPoint,
} from '@volter/editor-sdk/project-tool-catalog';

interface LoadedCatalog extends ProjectToolCatalog {
  definitions: Map<string, ToolDefinition>;
  generationContributions: Map<string, GenerationToolContribution>;
}

interface ToolModule {
  absolutePath: string;
  sourcePath: string;
  registrationError?: string;
}

type ToolRegistration = string | { entry: string };

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  vgai?: { tools?: ToolRegistration[]; contributions?: unknown };
}

async function readPackageJson(path: string): Promise<PackageJsonShape | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageJsonShape;
  } catch {
    return null;
  }
}

function registrationEntry(registration: ToolRegistration): string | null {
  return typeof registration === 'string' ? registration : registration?.entry;
}

function validRelativeModule(spec: unknown): spec is string {
  return typeof spec === 'string' && spec.startsWith('./') && !spec.includes('..');
}

/**
 * Every contribution module below one directory, by the naming convention.
 *
 * Nothing lists these. A manifest listing them was a fact that lived in two
 * places — the file exists AND the file is named — and the second copy was the
 * only one that could ever be wrong. `directory` is walked recursively so a
 * dependency may organise its UI however it likes (`src/editor/` today).
 */
async function scanContributionModules(directory: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = (await readdir(directory, { withFileTypes: true })) as import('node:fs').Dirent[];
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await scanContributionModules(absolute)));
    } else if (entry.isFile() && isToolContributionModule(entry.name)) {
      found.push(absolute);
    }
  }
  return found;
}

/** Project-source contributions: `src/contributions/`, project-relative paths. */
async function projectContributionModules(projectRoot: string): Promise<ProjectToolContribution[]> {
  const found = await scanContributionModules(resolve(projectRoot, 'src', 'contributions'));
  return found
    .map((absolute) => ({ entryPath: relative(projectRoot, absolute).split(sep).join('/') }))
    .sort((a, b) => a.entryPath.localeCompare(b.entryPath));
}

/**
 * A DEPENDENCY's contributions — the plug-in door of the universal editor
 * (ARCHITECTURE-CORE §The universal editor, owner ruling 2026-09-15): a skew
 * package (`@volter/editor-blender`, `@vgai/production`, …) enumerates its contribution
 * modules under its own `package.json#vgai.contributions`, and the editor
 * lists them for every dependency the OPEN PROJECT DECLARES.
 *
 * Declared, never scanned. There is still no walk of `node_modules`: a
 * package that is not in the project's `dependencies`/`devDependencies`
 * contributes nothing however it got installed, and a package that is
 * declared contributes only what it enumerates — the same explicit
 * registration idiom `vgai.tools` uses for callables. That is what keeps the
 * surface visible: `package.json` names the package, the package's own
 * `package.json` names the modules, and both are ordinary files a person
 * reads. Entries are `./`-relative modules by the contribution naming
 * convention; anything else is reported by name, never skipped silently.
 *
 * Paths are absolute (realpath, so a linked workspace package serves from
 * its checkout) — `ProjectToolContribution.entryPath` was defined as
 * "project-relative or package-absolute" for exactly this. A package is
 * located by walking `node_modules` up from the project the way Node does
 * (a workspace member's dependency is hoisted to the monorepo root), and
 * NOT through `require.resolve`: that caches per process, and a long-lived
 * editor server kept answering a package's OLD path after it was replaced
 * on disk (measured 2026-09-15).
 */
async function locatePackageJson(fromDir: string, name: string): Promise<string | null> {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    try {
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch {
      /* not here; try the parent */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * PACKAGES THE EDITOR SHIPS FOR EVERY PROJECT IT OPENS, whatever the project's
 * roots or its declared dependencies — "what is part of the editing SESSION
 * itself", which no manifest can imply because it is not about the project at
 * all: the agent-conversation surface is chrome over the worktree the editor is
 * open on, the way the console and the status bar are.
 *
 * WHAT A PROJECT NEEDS TO RUN IS THE PROJECT'S OWN DECLARATION and nothing
 * else. A list here used to IMPLY a lane from the manifest's roots —
 * `@vgai/game` and `@vgai/dom` — resolved out of the EDITOR's own `node_modules` when the
 * project declared none. It is deleted: the kit names no package (ARCHITECTURE-
 * CORE §The target shape, rule 1), and the packages a session mounts beyond the
 * project's own are the PRODUCT's, already in its bundle.
 *
 * `@vgai/asset-library` joins it on the same test and for the same reason
 * (2026-09-18, phase 1 unit 10). The Library panel is a STOREFRONT the editor
 * carries: it reaches our hosted catalog and it opens with a project that has
 * no content at all, so no manifest can imply it — importing a result into the
 * project is the last step, not the subject, exactly as the agent chat's
 * subject is the harness and not the worktree it writes. It was a host static
 * panel until that unit, present in every project whatever its manifest said,
 * and this line is what keeps that true now that its surface is a package.
 *
 * THE PRODUCT ANSWERS SEPARATELY, and the difference is deliberate: a product
 * bundles what its own entry composes (`packages/game-editor/src/index.ts`), so
 * the model editor carries neither this package nor the game lane, and each
 * panel's place renders the honest emptiness a chrome slot with no filler
 * gives. This list is the SESSION's own answer, for chrome that is about the
 * worktree rather than about the project.
 *
 * `@vgai/collaboration` joined on the same test (2026-09-19, phase 1 unit 15).
 * Who is in a live editor SESSION is a fact about the session, not about the
 * project: the people control and the presence publisher are wanted by a
 * modeling-only worktree exactly as much as by a game, and no manifest could
 * imply them.
 */
// Empty since the launch-scope sweep (2026-09-20): `@vgai/agents`,
// `@vgai/asset-library` and `@vgai/collaboration` are archived at
// `archive/launch-scope-2026-09-20`; a session package returns here with them.
const SESSION_PACKAGES: readonly string[] = [];

/**
 * EVERY PACKAGE THIS SESSION MOUNTS, from the two places one can come from.
 *
 * 1. THE PRODUCT'S COMPOSITION. `@vgai/game-editor`'s and
 *    `@vgai/model-editor`'s entries name the packages they mount in code, and
 *    those names are the product's own dependencies (the estate gate is what
 *    keeps the manifest equal to the composition —
 *    `scripts/validate-package-estate.mjs`, `productComposedPackages`). They
 *    resolve from the PRODUCT's install, so a project declaring none of them
 *    still opens in a whole editor. This is what the manifest-implied lanes
 *    used to do badly: they guessed five packages from a project's ROOTS and
 *    resolved them out of the editor's own tree, so every project got every
 *    lane (WORK.md step 3's census, count three).
 *
 *    A product's package is listed by its PACKAGE SPECIFIER, not by path,
 *    because those modules are already in the product's bundle — the page
 *    imports them through the loader the product registered rather than
 *    fetching a second copy through `/@fs/` (`tool-loader.ts`'s
 *    `bundledPackageLoaders`, keyed by exactly this string).
 *
 * 2. THE PROJECT'S OWN DECLARED DEPENDENCIES — a tool over the project's
 *    content that the project pins itself (CLAUDE.md's 2026-09-15 amendment).
 *    Those are not in any bundle, so they are listed by absolute path and
 *    served from the filesystem.
 *
 * A package on BOTH lists is the product's: its copy is the one already in the
 * page, and loading the project's second copy is a duplicate registration.
 */
async function packageContributionModules(
  projectRoot: string,
  product: ProductIdentity | null,
  loadErrors: ProjectToolLoadError[],
): Promise<ProjectToolContribution[]> {
  const projectPackage = await readPackageJson(resolve(projectRoot, 'package.json'));
  const declared = Object.keys({
    ...(projectPackage?.dependencies ?? {}),
    ...(projectPackage?.devDependencies ?? {}),
    // An optional dependency contributes when it is installed (the Volter brand's private
    // package is the natural one to list this way); one that is not is skipped below.
    ...(projectPackage?.optionalDependencies ?? {}),
  }).sort();
  const composed = product === null ? [] : productComposedPackages(product);
  const bundled = new Set(composed);
  const sources: Array<{ name: string; from: string; bundled: boolean }> = [
    ...composed.map((name) => ({ name, from: (product as ProductIdentity).dir, bundled: true })),
    ...[...declared, ...SESSION_PACKAGES.filter((name) => !declared.includes(name))]
      .filter((name) => !bundled.has(name))
      .map((name) => ({ name, from: projectRoot, bundled: false })),
  ];
  if (sources.length === 0) return [];
  const found: ProjectToolContribution[] = [];
  for (const { name, from, bundled: inBundle } of sources) {
    const packageJsonPath = await locatePackageJson(from, name);
    // Not installed: a package that cannot be found cannot contribute, and
    // that is not an error — most dependencies are libraries with nothing
    // to say here.
    if (packageJsonPath === null) continue;
    const manifest = await readPackageJson(packageJsonPath);
    const registrations = manifest?.vgai?.contributions;
    if (registrations === undefined) continue;
    const source = `${name}/package.json#vgai.contributions`;
    if (!Array.isArray(registrations)) {
      loadErrors.push({ sourcePath: source, message: 'must be an array of ./-relative modules' });
      continue;
    }
    const packageDir = dirname(packageJsonPath);
    for (const [index, entry] of registrations.entries()) {
      const sourcePath = `${source}[${index}]`;
      if (!validRelativeModule(entry)) {
        loadErrors.push({
          sourcePath,
          message: 'must be a ./-relative contribution module without parent traversal',
        });
        continue;
      }
      if (!isToolContributionModule(entry)) {
        loadErrors.push({
          sourcePath,
          message:
            'is not a contribution module by name (*.document/.inspector/.asset-inspector/.result/.utility/.analytics/.kind/.finder .ts/.tsx)',
        });
        continue;
      }
      let absolutePath: string;
      try {
        absolutePath = await realpath(resolve(packageDir, entry));
      } catch {
        loadErrors.push({ sourcePath, message: `${entry} does not exist in ${name}` });
        continue;
      }
      // The file is checked either way — a declaration naming a module that is
      // not there is a load error, not a silent skip — but a BUNDLED package is
      // reported by its specifier, which is the key its loader is registered
      // under in the page.
      found.push({
        entryPath: inBundle ? `${name}/${entry.replace(/^\.\//, '')}` : absolutePath,
        package: name,
        ...(inBundle ? { filePath: absolutePath } : {}),
      });
    }
  }
  return found;
}

async function projectToolModules(projectRoot: string): Promise<ToolModule[]> {
  const projectPackage = await readPackageJson(resolve(projectRoot, 'package.json'));
  const registrations = projectPackage?.vgai?.tools;
  if (!Array.isArray(registrations)) return [];
  return registrations.map((registration, index): ToolModule => {
    const entry = registrationEntry(registration);
    const registrationPath = `package.json#vgai.tools[${index}]`;
    if (!validRelativeModule(entry)) {
      return {
        absolutePath: resolve(projectRoot, 'package.json'),
        sourcePath: registrationPath,
        registrationError: 'must be a ./-relative tool module without parent traversal',
      };
    }
    const absolutePath = resolve(projectRoot, entry);
    if (!absolutePath.startsWith(`${projectRoot}${sep}`)) {
      return {
        absolutePath,
        sourcePath: registrationPath,
        registrationError: 'resolves outside the project',
      };
    }
    return { absolutePath, sourcePath: entry.slice(2) };
  });
}

function operationShape(value: unknown): value is ToolDefinition {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ToolDefinition>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.description === 'string' &&
    candidate.input !== null &&
    typeof candidate.input === 'object' &&
    typeof candidate.input.safeParse === 'function' &&
    candidate.result !== null &&
    typeof candidate.result === 'object' &&
    typeof candidate.result.safeParse === 'function' &&
    Array.isArray(candidate.errors) &&
    candidate.requires !== null &&
    typeof candidate.requires === 'object' &&
    (candidate.host === 'node' ||
      candidate.host === 'editor-browser' ||
      candidate.host === 'runtime-page') &&
    typeof candidate.mutates === 'boolean' &&
    typeof candidate.supportsDryRun === 'boolean' &&
    candidate.permission !== null &&
    typeof candidate.permission === 'object' &&
    typeof candidate.impl === 'function'
  );
}

function generationContributionShape(value: unknown): value is GenerationToolContribution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GenerationToolContribution>;
  return (
    typeof candidate.provider === 'string' &&
    candidate.provider.length > 0 &&
    ((candidate.role === 'submit' && typeof candidate.toJob === 'function') ||
      ((candidate.role === 'poll' || candidate.role === 'cancel' || candidate.role === 'accept') &&
        typeof candidate.toUpdate === 'function'))
  );
}

function jsonSchema(schema: z.ZodType): unknown {
  // Project schemas may come from a different Zod version than the bundled host.
  return schema.toJSONSchema();
}

function toCatalogEntry(
  definition: ToolDefinition,
  sourcePath: string,
  generation?: GenerationToolContribution,
): ProjectToolCatalogEntry {
  return {
    name: definition.name,
    summary: definition.summary,
    description: definition.description,
    sourcePath,
    inputSchema: jsonSchema(definition.input),
    resultSchema: jsonSchema(definition.result),
    errors: definition.errors.map((error) => ({
      code: error.code,
      summary: error.summary,
      ...(error.data ? { dataSchema: jsonSchema(error.data) } : {}),
    })),
    requires: { ...definition.requires },
    host: definition.host,
    mutates: definition.mutates,
    supportsDryRun: definition.supportsDryRun,
    longRunning: definition.longRunning === true,
    permission: { ...definition.permission },
    ...(generation ? { generation: { provider: generation.provider, role: generation.role } } : {}),
  };
}

async function loadCatalog(
  projectRoot: string,
  loadModule: ProjectModuleLoader | undefined,
): Promise<LoadedCatalog> {
  // WHICH PRODUCT IS SERVING THIS PROJECT — resolved the same way the CLI
  // resolved it, so the packages the page already has and the packages this
  // catalog lists are the same set. `null` means no product (a session started
  // by hand against a project that declares none); the catalog then holds only
  // the project's own, and the frame's own door says why there is no editor.
  const product = sessionProduct(projectRoot);
  const definitions = new Map<string, ToolDefinition>();
  const generationContributions = new Map<string, GenerationToolContribution>();
  const tools: ProjectToolCatalogEntry[] = [];
  const loadErrors: ProjectToolLoadError[] = [];
  // Contributions are SCANNED, so they never depend on a callable loading —
  // a project whose tool module throws still shows its documents' teaching
  // errors rather than silently losing the whole UI half of the catalog.
  const contributions = [
    ...(await projectContributionModules(projectRoot)),
    ...(await packageContributionModules(projectRoot, product, loadErrors)),
  ];
  const files = (await projectToolModules(projectRoot)).sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath),
  );

  const loadableFiles = files.filter((file) => {
    if (!file.registrationError) return true;
    loadErrors.push({ sourcePath: file.sourcePath, message: file.registrationError });
    return false;
  });

  if (loadableFiles.length > 0 && !loadModule) {
    loadErrors.push(noProjectModuleHostError());
    return { tools, contributions, loadErrors, definitions, generationContributions };
  }

  const registry = new ToolRegistry();
  for (const { absolutePath, sourcePath } of loadableFiles) {
    try {
      const imported = (await loadModule?.(absolutePath)) as Record<string, unknown> | undefined;
      const definition = imported?.['tool'];
      if (!operationShape(definition)) {
        throw new Error(
          'does not export a complete `tool` definition; export `tool = defineTool({...})` from @vgai/sdk/tools',
        );
      }
      if (!definition.name.startsWith('project.')) {
        throw new Error(
          `declares ${JSON.stringify(definition.name)}; project-local tool names must start with "project."`,
        );
      }
      if (definition.mutates && definition.permission.risk === 'read') {
        throw new Error(
          `declares mutates:true with read risk; mutating operations must declare write or destructive risk`,
        );
      }
      const advertisedGeneration = imported?.['generation'];
      if (
        advertisedGeneration !== undefined &&
        !generationContributionShape(advertisedGeneration)
      ) {
        throw new Error(
          'exports invalid `generation` metadata; use a provider id, submit/poll/cancel/accept role, and the matching mapper function',
        );
      }
      const generation = advertisedGeneration as GenerationToolContribution | undefined;
      registry.register(definition);
      const entry = toCatalogEntry(definition, sourcePath, generation);
      definitions.set(definition.name, definition);
      if (generation) generationContributions.set(definition.name, generation);
      tools.push(entry);
    } catch (error) {
      loadErrors.push({
        sourcePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));
  return { tools, contributions, loadErrors, definitions, generationContributions };
}

export async function discoverProjectTools(
  projectRoot: string,
  loadModule: ProjectModuleLoader | undefined,
): Promise<ProjectToolCatalog> {
  const {
    definitions: _definitions,
    generationContributions: _generationContributions,
    ...catalog
  } = await loadCatalog(projectRoot, loadModule);
  return catalog;
}

export type ProjectToolExecution =
  | {
      status: 200;
      body: ToolOutcome & { generation?: GenerationJob; generationWarning?: string };
      changedProject: boolean;
    }
  | {
      status: 404 | 409;
      body: { ok: false; error: { code: string; message: string } };
      changedProject: false;
    };

export async function executeProjectTool(options: {
  account?: EditorAccountService | undefined;
  projectRoot: string;
  loadModule: ProjectModuleLoader | undefined;
  name: string;
  input: unknown;
  confirmed: boolean;
  /** WHICH mounted instance a game-driving tool should address (multiplayer
   *  authoring). Reaches the tool as `ctx.instance`; omitted is the sole
   *  instance. */
  instance?: string;
  signal?: AbortSignal;
}): Promise<ProjectToolExecution> {
  const loaded = await loadCatalog(options.projectRoot, options.loadModule);
  const definition = loaded.definitions.get(options.name);
  if (!definition) {
    return {
      status: 404,
      changedProject: false,
      body: {
        ok: false,
        error: {
          code: 'PROJECT_TOOL_NOT_FOUND',
          message: `No registered project tool is named ${JSON.stringify(options.name)}.`,
        },
      },
    };
  }
  if (definition.host !== 'node') {
    return {
      status: 409,
      changedProject: false,
      body: {
        ok: false,
        error: {
          code: 'PROJECT_TOOL_HOST_UNAVAILABLE',
          message:
            `Project tool ${JSON.stringify(options.name)} declares host ${JSON.stringify(definition.host)}. ` +
            'This host currently executes Node-hosted project tools; call reusable browser/runtime functions directly.',
        },
      },
    };
  }
  if ((definition.mutates || definition.permission.risk !== 'read') && !options.confirmed) {
    return {
      status: 409,
      changedProject: false,
      body: {
        ok: false,
        error: {
          code: 'PROJECT_TOOL_CONFIRMATION_REQUIRED',
          message:
            `${definition.permission.risk} tool ${JSON.stringify(options.name)} requires explicit confirmation: ` +
            definition.permission.summary +
            ' Set confirm: true in the invocation options after authorization.',
        },
      },
    };
  }

  const registry = new ToolRegistry();
  registry.register(definition);
  const generation = loaded.generationContributions.get(options.name);
  // THE credential read for a generation job: this tool's OWN declared
  // provider, one credential-manager item, at the moment the job runs. A tool
  // that declares no provider reads nothing (`provider-credentials.ts`'s
  // header states the rule and what a boot-time sweep costs).
  if (generation && options.account) {
    await options.account.ensureProviderCredential(generation.provider);
  }
  const provenanceInput = definition.input.safeParse(options.input);
  const operationSource = loaded.tools.find((entry) => entry.name === options.name)?.sourcePath;
  const resolveMode: ProviderModeResolver = async (provider, requestId) => {
    const job = requestId
      ? (await readGenerationJobs(options.projectRoot)).jobs.find(
          (job) => job.provider === provider && job.externalId === requestId,
        )
      : undefined;
    if (!options.account)
      throw new Error('Provider execution requires the editor account service.');
    return options.account.providerExecutionMode(provider, job?.mode);
  };
  const outcome = await withProviderExecution(
    resolveMode,
    () =>
      runWithGenerativeExecutionCapture(() =>
        registry.dispatch(options.name, options.input, {
          projectRoot: options.projectRoot,
          projectOutputs: createProjectOutputWriter(options.projectRoot, {
            operationName: definition.name,
            ...(operationSource ? { operationSource } : {}),
            ...(provenanceInput.success ? { input: provenanceInput.data } : {}),
          }),
          ...(options.instance !== undefined ? { instance: options.instance } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.loadModule ? { loadProjectModule: options.loadModule } : {}),
        }),
      ),
    async (job) => {
      await applyGenerationContribution(
        options.projectRoot,
        {
          role: 'submit',
          provider: job.provider,
          toJob: () => job,
        },
        {},
        {},
      );
    },
  );
  let body: ToolOutcome & { generation?: GenerationJob; generationWarning?: string } = outcome;
  if (outcome.ok && generation && provenanceInput.success) {
    try {
      const generationJob = await applyGenerationContribution(
        options.projectRoot,
        generation,
        provenanceInput.data,
        outcome.data,
      );
      await reconcileAcceptedGenerationProvenance(options.projectRoot, generationJob);
      body = {
        ...outcome,
        generation: generationJob,
      };
    } catch (error) {
      // Never turn successful paid provider submission into an apparent
      // failure that tempts a retry and duplicate charge. Tracking failure is
      // explicit alongside the successful native result.
      body = {
        ...outcome,
        generationWarning: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    status: 200,
    body,
    changedProject: definition.mutates && outcome.ok,
  };
}
