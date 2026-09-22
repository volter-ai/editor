/**
 * THE RUN-CONFIGURATION KIND REGISTRY — the open set of kinds a manifest's
 * `configurations[]` may declare (ARCHITECTURE-CORE §The project model). A run
 * configuration is one of the project's ENTRYPOINTS: something the editor,
 * the CLI or a harness can start by id. The engine registers two kinds
 * here; a capability registers more through the same door; the manifest
 * validates each declaration against its kind's own schema at load, and an
 * unregistered kind refuses loudly naming the registered ones.
 *
 * The implicit configuration every project with roots has is `play` — mount
 * every root in the host — which is never declared and may be named by a
 * `compound`.
 */

import { type ZodType, z } from 'zod';

/** The envelope every declaration carries; the rest is the kind's. */
export interface ConfigurationEnvelope {
  readonly id: string;
  readonly kind: string;
}

export type ConfigurationRole = 'run' | 'build';

export interface ConfigurationKindRegistration<
  T extends ConfigurationEnvelope = ConfigurationEnvelope,
> {
  readonly kind: T['kind'];
  /** Where a configuration of this kind surfaces and which verb starts it:
   *  `run` (the transport, `vgai run`) or `build` (Export, `vgai build`). */
  readonly role: ConfigurationRole;
  /** The declaration's full shape, envelope included; `.strict()`. */
  readonly schema: ZodType<T>;
  /** One line for schema output and refusals. */
  readonly describe: string;
  /** A build-role kind backed by a project TOOL (the operation catalog):
   *  the host runs `tool` with `input(configuration)` and reports its
   *  outcome as the build's. This is how a capability's bake becomes a
   *  build without the engine knowing what a bake is. */
  readonly build?: { readonly tool: string; readonly input: (configuration: T) => unknown };
}

/**
 * What a CONTRIBUTION exports to register a kind — a plain object, so a
 * project module (evaluated with the project's own copy of the engine)
 * hands it to the HOST, which registers it in the host's registry. A module
 * `src/contributions/<name>.kind.ts` exports it as `kind`.
 */
export type ConfigurationKindContribution = ConfigurationKindRegistration;

const CONFIGURATION_ROLES: readonly ConfigurationRole[] = ['run', 'build'];

/** Register a contribution's kind after checking its shape by name. */
export function registerContributedConfigurationKind(value: unknown, source: string): () => void {
  const record = (value ?? {}) as Partial<ConfigurationKindContribution>;
  const problems: string[] = [];
  if (typeof record.kind !== 'string' || record.kind.length === 0)
    problems.push('`kind` must be a non-empty string');
  if (!CONFIGURATION_ROLES.includes(record.role as ConfigurationRole))
    problems.push("`role` must be 'run' or 'build'");
  if (typeof record.describe !== 'string') problems.push('`describe` must be a string');
  const schema = record.schema as { safeParse?: unknown } | undefined;
  if (!schema || typeof schema.safeParse !== 'function')
    problems.push('`schema` must be a Zod schema');
  const build = record.build as { tool?: unknown; input?: unknown } | undefined;
  if (
    build !== undefined &&
    (typeof build.tool !== 'string' || typeof build.input !== 'function')
  ) {
    problems.push('`build` must be `{ tool: string; input(configuration) }`');
  }
  if (problems.length > 0) {
    throw new Error(`${source}: not a configuration kind — ${problems.join('; ')}`);
  }
  return registerConfigurationKind(record as ConfigurationKindContribution);
}

const registry = new Map<string, ConfigurationKindRegistration>();

/** Register a kind. A second registration replaces the first (a module
 *  re-evaluated on save); never throws. */
export function registerConfigurationKind<T extends ConfigurationEnvelope>(
  registration: ConfigurationKindRegistration<T>,
): () => void {
  const entry = registration as unknown as ConfigurationKindRegistration;
  registry.set(registration.kind, entry);
  return () => {
    if (registry.get(registration.kind) === entry) registry.delete(registration.kind);
  };
}

export function registeredConfigurationKinds(): readonly string[] {
  return [...registry.keys()];
}

export function configurationKind(kind: string): ConfigurationKindRegistration | undefined {
  return registry.get(kind);
}

/** The id of the implicit configuration: mount every root in the host. */
export const PLAY_CONFIGURATION_ID = 'play';

/** A process the project runs beside the host: an entry module started
 *  with the project's own toolchain, listening on a port when it has one. */
export interface ProcessConfiguration extends ConfigurationEnvelope {
  readonly kind: 'process';
  /** Project-relative entry module (`server/main.ts`). */
  readonly entry: string;
  /** The command that starts it, run in a shell at `cwd`; `npx tsx <entry>`
   *  when omitted. Declare it when the entry needs its own flags. */
  readonly command?: string;
  /** The port it listens on, when readiness means a port. */
  readonly port?: number;
  /** Project-relative working directory; the project root when omitted. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** How a runner knows it is up: the port accepting connections (the
   *  default when `port` is set), or an HTTP path answering 2xx on it. */
  readonly ready?: { readonly http?: string };
}

/** Several configurations started together, `play` included by name. */
export interface CompoundConfiguration extends ConfigurationEnvelope {
  readonly kind: 'compound';
  readonly run: readonly string[];
  /** How many instances of the host mount to run against the rest (the
   *  editor's Instances picker is this parameter). */
  readonly instances?: number;
}

/** A packaged build of the project's own web bundle: the project's build
 *  script, then `dist/` packaged as the web artifact. The first build-role
 *  kind; a capability registers more (a bake, a static site). */
export interface BundleConfiguration extends ConfigurationEnvelope {
  readonly kind: 'bundle';
  /** The package.json script that builds (`build`). */
  readonly script?: string;
  /** Extra arguments after `--` (`['--base', './']` for an itch-style relative bundle). */
  readonly args?: readonly string[];
}

export type DeclaredConfiguration = ConfigurationEnvelope & Readonly<Record<string, unknown>>;

registerConfigurationKind<ProcessConfiguration>({
  kind: 'process',
  role: 'run',
  describe: 'A process beside the host: an entry module, a port, readiness',
  schema: z
    .object({
      id: z.string().min(1).describe('Configuration id'),
      kind: z.literal('process'),
      entry: z.string().min(1).describe('Project-relative entry module'),
      command: z
        .string()
        .min(1)
        .optional()
        .describe('Shell command that starts it; `npx tsx <entry>` when omitted'),
      port: z.number().int().min(1).max(65535).optional().describe('Port it listens on'),
      cwd: z.string().min(1).optional().describe('Project-relative working directory'),
      env: z.record(z.string(), z.string()).optional().describe('Environment for the process'),
      ready: z
        .object({ http: z.string().min(1).optional().describe('HTTP path answering 2xx when up') })
        .strict()
        .optional()
        .describe('Readiness beyond the port accepting connections'),
    })
    .strict() as unknown as ZodType<ProcessConfiguration>,
});

registerConfigurationKind<CompoundConfiguration>({
  kind: 'compound',
  role: 'run',
  describe: 'Several configurations started together; `play` names the host mount',
  schema: z
    .object({
      id: z.string().min(1).describe('Configuration id'),
      kind: z.literal('compound'),
      run: z.array(z.string().min(1)).min(1).describe('Configuration ids, `play` included'),
      instances: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Instances of the host mount to run against the rest'),
    })
    .strict() as unknown as ZodType<CompoundConfiguration>,
});

registerConfigurationKind<BundleConfiguration>({
  kind: 'bundle',
  role: 'build',
  describe: "The project's web bundle: its build script, then dist/ packaged as the artifact",
  schema: z
    .object({
      id: z.string().min(1).describe('Configuration id'),
      kind: z.literal('bundle'),
      script: z.string().min(1).optional().describe('package.json script that builds (`build`)'),
      args: z.array(z.string()).optional().describe('Arguments passed after `--`'),
    })
    .strict() as unknown as ZodType<BundleConfiguration>,
});

/** Validate `configurations[]` against the registry: every kind registered, every
 *  declaration its kind's shape, ids unique, compound members declared. */
export function configurationIssues(configurations: readonly ConfigurationEnvelope[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const declaration of configurations) {
    if (ids.has(declaration.id)) issues.push(`configurations: duplicate id "${declaration.id}"`);
    ids.add(declaration.id);
    const registration = registry.get(declaration.kind);
    if (!registration) {
      issues.push(
        `configurations "${declaration.id}": unknown kind "${declaration.kind}" — registered: ${registeredConfigurationKinds()
          .map((k) => `"${k}"`)
          .join(', ')}`,
      );
      continue;
    }
    const parsed = registration.schema.safeParse(declaration);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(
          `configurations "${declaration.id}" (${declaration.kind}): ${issue.path.join('.') || '(declaration)'}: ${issue.message}`,
        );
      }
    }
  }
  for (const declaration of configurations) {
    if (declaration.kind !== 'compound') continue;
    const members = (declaration as { run?: readonly string[] }).run ?? [];
    for (const member of members) {
      if (member !== PLAY_CONFIGURATION_ID && !ids.has(member)) {
        issues.push(
          `configurations "${declaration.id}": member "${member}" is not a declared configuration (or "${PLAY_CONFIGURATION_ID}")`,
        );
      }
    }
  }
  return issues;
}
