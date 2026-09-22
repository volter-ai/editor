// The game manifest loader/validator.
//
// Pure data-in/data-out: `loadGameManifest(raw)` parses `raw` against
// `GameManifestSchema`, runs the cross-field checks §3 promises beyond what
// Zod alone can express, resolves every optional/derivable field, and
// returns a `ResolvedGameManifest` with nothing left implicit. This is the
// schema's runtime reader (T4.1 policy) — every described field in
// `schema.ts` either drives a check here or is carried into the resolved
// output explicitly (see the per-field comments below and
// `packages/engine/test/schema-consumption-map.ts`'s `manifest.*` entries).
//
// No `fs` import here on purpose — `load-file.ts` is the thin Node-only

// wrapper that reads a path and calls this function, so browser bundles that
// only need `loadGameManifest` never pull in `node:fs`.

import {
  configurationIssues,
  configurationKind,
  type DeclaredConfiguration,
} from './configuration-kinds';
import {
  type AdapterRoot,
  type GameManifest,
  GameManifestSchema,
  type LearnMetadata,
  type RootAdapter,
} from './schema';

// ---------------------------------------------------------------------------
// Resolved shapes
// ---------------------------------------------------------------------------

/** D6's resolved adapter identities. */
export type ResolvedAdapter =
  | {
      readonly type: 'builtin';
      readonly identity: 'three' | 'canvas' | 'dom';
      readonly surface: 'three' | 'canvas' | 'dom';
    }
  | {
      readonly type: 'module';
      readonly identity: 'module';
      readonly module: string;
      readonly surface: 'three' | 'canvas' | 'dom';
    }
  | {
      readonly type: 'ingest';
      // 'ingest-react' (Track N, N1) is assigned here purely structurally
      // (surface === 'dom'), same as 'ingest-three'/'ingest-pixi'.
      readonly identity: 'ingest-three' | 'ingest-pixi' | 'ingest-react';
      readonly surface: 'three' | 'canvas' | 'dom';
      /**
       * Project-relative ES module declaring `window.vgaiGame` beside a
       * pristine copy. OPTIONAL rather than required-and-possibly-undefined
       * (the shape its siblings above use) because most ingested games have
       * nothing to say about it, and requiring the key would only make every
       * construction site say `undefined`.
       */
      readonly contractShim?: string | undefined;
      /**
       * Project-relative ES module that writes this game'''s own DATA file back
       * (see the field'''s schema description). Same OPTIONAL shape and same
       * reason as {@link contractShim}: a game whose truth is entirely source
       * declares nothing here.
       */
      readonly dataWriter?: string | undefined;
      readonly assets: Record<string, string> | undefined;
      readonly domStubs: string[] | undefined;
      readonly captureTimeoutMs: number | undefined;
    };

export interface ResolvedAdapterRoot {
  readonly id: string;
  readonly surface: ResolvedAdapter['surface'];
  readonly description: string | undefined;
  readonly adapter: ResolvedAdapter;
  readonly entry: string | undefined;
  /**
   * The component this root's WORLD is, in the game's own source (see the
   * field's schema description). Present ⇒ Edit mounts THAT component alone as
   * its design-time document and Play mounts the game through `entry`;
   * absent ⇒ `entry` is what both modes mount.
   */
  readonly world?: { readonly entry: string; readonly export: string | undefined } | undefined;
  readonly zOrder: number;
  readonly pausable: boolean;
  readonly loop: 'gated' | 'self-driven';
}

export interface ResolvedGameManifest {
  readonly manifestVersion: 2;
  readonly name: string;
  readonly appId: string | undefined;
  readonly version: string;
  readonly engine: { readonly version: string };
  /** Sorted by zOrder; ties broken by original array order (§3). */
  readonly roots: readonly ResolvedAdapterRoot[];
  /** The declared run configurations, validated by kind (`run-kinds.ts`). */
  readonly configurations: readonly DeclaredConfiguration[];
  /** Ids whose kind no registry here knows — only ever non-empty when the
   *  caller loaded with `configurationKinds: 'defer'` (a bundled host that
   *  cannot evaluate a project's kind contributions); the editor session
   *  is the validator for those. */
  readonly deferredConfigurationKinds: readonly string[];
  readonly resolution: { readonly width: number; readonly height: number } | undefined;
  /** Construction-time renderer properties no world can declare for itself — see the schema. */
  readonly rendering: { readonly antialias: boolean } | undefined;
  readonly authoring:
    | {
        readonly hierarchy?:
          | {
              readonly rootLabels?: Readonly<Record<string, string>> | undefined;
              readonly groups?:
                | readonly {
                    readonly id: string;
                    readonly label: string;
                    readonly roots: readonly string[];
                  }[]
                | undefined;
            }
          | undefined;
      }
    | undefined;
  /** D18 — read by the debug-bridge installer to gate `?vgai-debug=1` in production builds. */
  readonly debug: { readonly allowInProduction: boolean } | undefined;
  /** D15 — read by `mount-manifest.ts`'s boot-time seeding reader (gates
   *  whether `ctx.random` is seeded from `defaultSeed`/`?vgai-seed=`), the
   *  gameplay-rng-ban burn-down scan, and the dev-mode Math.random phase
   *  trap.. */
  readonly determinism:
    | { readonly seededRandom: boolean; readonly defaultSeed?: number | undefined }
    | undefined;
  /** W3d (F11 perf gates) — read by `vgai perf --assert-budget`
   *  (packages/vgai-cli/src/perf.ts, assertBudget): each set metric is
   *  compared against the seeded headless perf run's measured value and any
   *  exceedance fails the gate with a per-metric table + nonzero exit. */
  readonly budget:
    | {
        readonly frameCpuMsP95?: number | undefined;
        readonly physicsMsP95?: number | undefined;
        readonly maxEntities?: number | undefined;
        readonly maxDrawCalls?: number | undefined;
        readonly maxTriangles?: number | undefined;
      }
    | undefined;
  /** Learner-facing metadata on shipped example projects; read by the editor
   *  server's registry surface (`GET /__editor/examples`,
   *  packages/editor/server/editor-server.ts) to generate the
   *  gallery/wizard/Learn-catalog registries. */
  readonly learn: LearnMetadata | undefined;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

// ---------------------------------------------------------------------------
// Adapter shape guards
// ---------------------------------------------------------------------------

function isModuleAdapter(
  adapter: RootAdapter,
): adapter is Extract<RootAdapter, { module: string }> {
  return typeof adapter === 'object' && 'module' in adapter;
}

// ---------------------------------------------------------------------------
// Cross-field checks (§3 — beyond what Zod alone enforces)
// ---------------------------------------------------------------------------
//
// Root-id uniqueness used to be a cross-field check HERE
// (`checkUniqueRootIds`, removed) — it moved INTO `GameManifestSchema`'s
// `roots` `superRefine` (schema.ts) instead, so the generated JSON Schema and
// any other schema consumer see the same constraint the loader always
// enforced. `parseManifest` below catches that one recognizable schema-level
// issue and rethrows it as a clean, single `Error` — the exact message shape
// `checkUniqueRootIds` used to throw directly — rather than a raw multi-issue
// `ZodError` dump, so existing callers/tests that pattern-match the message
// text are unaffected by the enforcement moving one layer down.

function checkAdapterEntryRules(root: AdapterRoot): void {
  const { adapter } = root;
  if (typeof adapter === 'string' && !root.entry) {
    throw new Error(
      `Game manifest: root "${root.id}" uses the '${adapter}' adapter but declares no ` +
        '`entry` — a built-in adapter root is authored as an entry module.',
    );
  }
  if (typeof adapter === 'object' && 'ingest' in adapter && !root.entry) {
    throw new Error(
      `Game manifest: root "${root.id}" is an { ingest } root but declares no \`entry\` — the ` +
        "game's own entry module is what the host imports.",
    );
  }
}

// ---------------------------------------------------------------------------
// Resolution (§5)
// ---------------------------------------------------------------------------

function resolveAdapter(root: AdapterRoot): ResolvedAdapter {
  const { adapter } = root;

  if (typeof adapter === 'string') {
    return { type: 'builtin', identity: adapter, surface: adapter };
  }

  if (isModuleAdapter(adapter)) {
    return {
      type: 'module',
      identity: 'module',
      module: adapter.module,
      surface: adapter.surface,
    };
  }

  // isIngestAdapter (Track N, N1: 'ingest-react' joins 'ingest-three'/
  // 'ingest-pixi').
  const identity =
    adapter.surface === 'three'
      ? 'ingest-three'
      : adapter.surface === 'canvas'
        ? 'ingest-pixi'
        : 'ingest-react';
  const ingest = adapter.ingest;
  return {
    type: 'ingest',
    identity,
    surface: adapter.surface,
    contractShim: ingest.contractShim,
    dataWriter: ingest.dataWriter,
    assets: ingest.assets,
    domStubs: ingest.domStubs,
    captureTimeoutMs: ingest.captureTimeoutMs,
  };
}

function checkEngineVersionPin(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(
      `Game manifest: engine.version "${version}" is not a valid exact semver string (e.g. ` +
        '"0.1.0") — §1.5 requires an exact identity pin, not a range.',
    );
  }
}

/**
 * Resolve one already-Zod-validated root entry into its `ResolvedAdapterRoot`
 * (adapter identity, and a pass-through of every other field).
 * Every `AdapterRoot` field participates here or in a check above:
 * `id` drives uniqueness; `adapter` (incl. its surface and
 * `module`/`ingest.*` sub-fields) drives adapter identity
 * resolution; `entry` drives the entry cross-field rule and is
 * carried through; `world` is carried through for the ONE reader that mounts a
 * design-time document (the editor's design session) and is deliberately not
 * cross-checked against `entry` — the two name different modules on purpose;
 * `zOrder` drives the final sort; `pausable`/`loop` are
 * carried through as-is (their consumers are the runtime/CLI, T3.2/T3.3);
 * `description` (T3.3
 * slice 3) is carried through as-is — its consumer today is
 * `resolveIngestDescriptor` (packages/editor/src/ingest/resolve-three.ts), which
 * threads an ingest-three root's description into `IngestGame.description`.
 */
function resolveRoot(root: AdapterRoot): ResolvedAdapterRoot {
  checkAdapterEntryRules(root);
  const adapter = resolveAdapter(root);

  return {
    id: root.id,
    surface: adapter.surface,
    description: root.description,
    adapter,
    entry: root.entry,
    world:
      root.world === undefined ? undefined : { entry: root.world.entry, export: root.world.export },
    zOrder: root.zOrder,
    pausable: root.pausable,
    loop: root.loop,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse + validate + resolve a raw manifest value into a `ResolvedGameManifest`.
 * Pure data-in/data-out (no `fs`) — see `load-file.ts` for the Node path-based
 * wrapper. Throws a descriptive `Error` (naming the offending root/field) on
 * any Zod validation failure or cross-field rule violation.
 */
export interface LoadGameManifestOptions {
  /** `require` (default): a declaration of an unregistered kind refuses.
   *  `defer`: it is reported in `deferredConfigurationKinds` instead. */
  readonly configurationKinds?: 'require' | 'defer';
}

export function loadGameManifest(
  raw: unknown,
  options: LoadGameManifestOptions = {},
): ResolvedGameManifest {
  // Removed-format guard FIRST, on the raw value: a root declaring a removed
  // content field would otherwise fail Zod's `roots` discriminated union with
  // a confusing shape error instead of the named migration message.
  const parsed = GameManifestSchema.safeParse(raw);
  if (!parsed.success) {
    // D-V6: the `roots` `superRefine`'s composition issues — a duplicate root
    // id, or more than one world root of the same medium — are the
    // schema-level violations this loader surfaces as a clean, single `Error`
    // (matching `checkUniqueRootIds`'s pre-D-V6 message shape) rather than a
    // raw multi-issue dump, because each one already reads as a finished
    // sentence naming the offending ids. Every other schema violation keeps
    // propagating as the raw `ZodError` it always has (unchanged behavior,
    // e.g. an unrecognized key or a bad `manifestVersion`).
    const compositionIssue = parsed.error.issues.find(
      (issue) =>
        issue.message.startsWith('Game manifest: duplicate root id') ||
        issue.message.startsWith('Game manifest: a project has at most one'),
    );
    if (compositionIssue) throw new Error(compositionIssue.message);
    throw parsed.error;
  }
  const manifest: GameManifest = parsed.data;

  checkEngineVersionPin(manifest.engine.version);

  const resolvedWithIndex = manifest.roots.map((root, index) => ({
    root: resolveRoot(root),
    index,
  }));

  resolvedWithIndex.sort(
    (a, b) => a.root.zOrder - b.root.zOrder || a.index - b.index, // ties -> array order (§3)
  );

  const roots = resolvedWithIndex.map(({ root }) => root);

  const configurations = (manifest.configurations ?? []) as DeclaredConfiguration[];
  // Kinds are OPEN (ARCHITECTURE-CORE §The project model): each declaration
  // is checked against its registered kind's own schema HERE, where the
  // host's registry is, not in the Zod schema. A host that cannot evaluate a
  // project's kind contributions defers unknown kinds by name instead of
  // refusing them.
  const deferredConfigurationKinds: string[] = [];
  const kindIssues = configurationIssues(configurations).filter((issue) => {
    if (options.configurationKinds !== 'defer') return true;
    const unknown = /^configurations "([^"]+)": unknown kind/.exec(issue);
    if (!unknown) return true;
    deferredConfigurationKinds.push(unknown[1] as string);
    return false;
  });
  if (kindIssues.length > 0) {
    throw new Error(`Game manifest: ${kindIssues.join('\n  ')}`);
  }
  for (const configuration of configurations) {
    if (
      !configurationKind(configuration.kind) &&
      !deferredConfigurationKinds.includes(configuration.id)
    ) {
      deferredConfigurationKinds.push(configuration.id);
    }
  }

  return {
    manifestVersion: manifest.manifestVersion,
    name: manifest.name,
    appId: manifest.appId,
    version: manifest.version,
    engine: { version: manifest.engine.version },
    roots,
    configurations,
    deferredConfigurationKinds,
    resolution: manifest.resolution,
    rendering: manifest.rendering,
    authoring: manifest.authoring,
    debug: manifest.debug,
    determinism: manifest.determinism,
    budget: manifest.budget,
    learn: manifest.learn,
  };
}
