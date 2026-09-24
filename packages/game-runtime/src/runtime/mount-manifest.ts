// The standalone manifest-mount helper: an ENGINE-side generalization of
// `examples/tri-world/src/main.ts`'s hand-built `RootMountSpec[]`.
//
// `resolveAllRoots`/`resolveRootBinding` (`packages/editor/src/
// binding-resolver.ts`) already do this translation for the EDITOR, but they
// are Vite-coupled by construction (`/@fs/` dynamic imports of project files
// through the dev server, §0.1/§0.5 of the design doc) — unusable from a
// plain static build. This module mirrors their per-kind dispatch
// (`default-three`/`default-pixi`/`default-react`, `{ module }`, `{ ingest }`)
// but never imports a project file itself: the caller's OWN bundler already
// resolved whatever module graph the manifest's roots need, and hands the
// already-built pieces in via `entries` (keyed by world id) — no `/@fs/`, no
// dev server, no editor import.
//
// Engine-core react/pixi-free discipline (§0.6, mirrored from
// `create-runtime.ts`'s own documented rule for its `ReactRootAdapter`
// type-only import): this file never value-imports
// `pixi.js`, `react`, or `react-dom` — a
// canvas or react world's adapter is ALWAYS supplied already-constructed via
// `entries[id].adapter` (the caller's own module graph built it), so no
// surface's library is pulled into a game that has no world on it.

import { assertNever } from '@volter/editor-project/adapter/adapter-surface';
import type { RootDeclaration } from '@volter/editor-project/adapter/binding';
import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { RootAdapter } from '@volter/editor-project/adapter/root-adapter';
// Value-imported from the implementer's OWN path, not the type-only
// `../adapter` barrel (P-6).
import {
  loadGameManifest,
  type ResolvedAdapterRoot,
  type ResolvedGameManifest,
} from '@volter/editor-project/manifest/load';
import { createGameRuntime, type GameSession, type RootMountSpec } from './create-runtime';
import { type DebugBridgeWindowTarget, maybeInstallDebugBridge } from './debug-bridge';
import { getDebugRegistry } from './debug-registry';
import { getGameplayRngTrapControl } from './gameplay-rng-trap';
import type { PlaytestContext } from './playtest';
import { RENDER_SEED_QUERY_PARAM } from './render-seed';

// ---------------------------------------------------------------------------
// The `entries` contract
// ---------------------------------------------------------------------------

/**
 * A caller-supplied entry for a `kind: 'three'` world — two ways to satisfy
 * it, matching the two shapes `resolveDefaultThreeAdapter` supports (an
 * `entry`-module `setup`, or full caller control via a pre-built adapter):
 *
 *  - `{ adapter }` — a fully-constructed {@link RootAdapter} (first-party or
 *    not). Always wins if present, regardless of the world's `entry` field —
 *    full caller control, including for a `{ module }`-adapter world
 *    (mountManifestRoots cannot import an arbitrary module path itself —
 *    for a default-exported world, build the adapter with
 *    `resolveR3FEntryAdapter(entryModule, worldId)` from
 *    `@volter/game-runtime/world3d-react` and pass it here).
 */
export interface ThreeMountEntry extends MountEntryDeclaration {
  readonly kind: 'three';
  readonly adapter?: RootAdapter | undefined;
}

/**
 * The half of a root's binding declaration a CALLER holds — everything in
 * `adapter/binding.ts`'s {@link RootDeclaration} except `root`, which this
 * file already has from the manifest it just resolved.
 *
 * Optional throughout, and absent is the honest state for a caller who built
 * an adapter by hand out of its own module graph: there is no entry namespace
 * to report a static surface for, so the root registers with `binding: null`
 * rather than one describing a module nobody loaded.
 */
export interface MountEntryDeclaration {
  readonly declaration?: Omit<RootDeclaration, 'root'> | undefined;
}

/**
 * A caller-supplied entry for a `kind: 'canvas'` world — ALWAYS a
 * fully-constructed `RootAdapter<'canvas'>`, built by the caller's own module
 * graph. There is no "mountManifestRoots builds it for
 * you" branch here — doing so would require this file to value-import
 * `pixi.js`, which it deliberately never does (see this file's header
 * comment).
 */
export interface PixiMountEntry extends MountEntryDeclaration {
  readonly kind: 'canvas';
  readonly adapter: RootAdapter<'canvas'>;
}

/**
 * A caller-supplied entry for a `kind: 'dom'` world — ALWAYS a
 * fully-constructed `RootAdapter<'dom'>` (the caller's own module graph
 * calls `createRoot(host.container).render(<WorldProvider game={host.game}>
 * <Entry/></WorldProvider>)` itself, exactly like `tri-world`'s original
 * hand-mount did). A standalone build has ONE module graph, so there is no
 * context-identity hazard the editor's per-project `WorldProvider`
 * indirection exists to solve — the caller's own `<WorldProvider>` import
 * is already the single canonical instance its `Entry` component's own
 * hooks resolve against. This file never value-imports `react`/`react-dom`
 * itself (see this file's header comment) — building the adapter is
 * entirely the caller's job.
 */
export interface ReactMountEntry extends MountEntryDeclaration {
  readonly kind: 'dom';
  readonly adapter: RootAdapter<'dom'>;
}

export type MountEntry = ThreeMountEntry | PixiMountEntry | ReactMountEntry;

// ---------------------------------------------------------------------------
// Options / return shape
// ---------------------------------------------------------------------------

export interface MountManifestOptions {
  /**
   * A raw (unparsed) manifest value OR an already-`loadGameManifest`d
   * {@link ResolvedGameManifest}. `mountManifestRoots` NEVER fetches or
   * fs-reads the manifest itself (stays environment-neutral — Node CLI,
   * browser, or headless test alike): the caller owns getting the JSON off
   * disk/network (`loadGameManifestFile` for Node, a plain `fetch()` for a
   * browser build) and may pass either the raw parsed JSON (run through the
   * pure `loadGameManifest` here) or its own already-resolved manifest.
   */
  readonly manifest: unknown;
  /** The host creates one absolutely-positioned surface per world inside
   *  this element — see `RootsRuntimeConfig.container`. */
  readonly container: HTMLElement;
  /** Caller-supplied, already-imported entries keyed by manifest world id.
   *  Optional overall — a manifest whose every world is scene-driven
   *  three with no custom component registry needs none at all. */
  readonly entries?: Readonly<Record<string, MountEntry>> | undefined;
  /** Defaults to the manifest's own `resolution` field if declared, else
   *  the container's own size (`RootsRuntimeConfig`'s existing default). */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /** Forwarded to `createGameRuntime` — Node/headless test harnesses only,
   *  never a real host. See `RootsRuntimeConfig.headless`. */
  readonly headless?: boolean | undefined;
  /**
   * Task 2.1: overrides for the `?vgai-debug=1` bridge `mountManifestRoots`
   * installs at the tail of every mount — the engine-owned install point so
   * every standalone project gets it with zero template edits. Omit both in
   * a real host (defaults to `window.location`/ `window`); a headless test
   * supplies fakes here instead of touching the global object, mirroring
   * `render-control.ts`'s own `location`/`target` override precedent.
   */
  readonly debugBridge?:
    | {
        readonly url?: { readonly search: string } | undefined;
        readonly window?: DebugBridgeWindowTarget | undefined;
      }
    | undefined;
  /**
   * D15 (T-D15.1) — the "explicit config" leg of the boot-time seed
   * precedence (`manifest.determinism.defaultSeed` → `?vgai-seed=` → this),
   * highest-precedence, for a caller that already knows the exact seed it
   * wants (a future CLI `--seed`/probe fixture `seed` option, T-D15.6).
   * Ignored entirely unless the manifest declares
   * `determinism.seededRandom` — see `resolveDeterminismSeed` below.
   */
  readonly seed?: number | undefined;
  /** Host identity for a private play run or coordinated Team Test. */
  readonly playtest?: PlaytestContext | null | undefined;
  /** Where to read `?vgai-seed=` from for the boot-time seed reader. Same
   *  override precedent as `debugBridge.url` (defaults to `window.location`
   *  when a real `window` exists; a headless caller with no override gets no
   *  query-param seed, same as `maybeInstallDebugBridge`'s own url default). */
  readonly seedUrl?: { readonly search: string } | undefined;
}

/**
 * D15 (T-D15.1) boot-time seed reader — resolves the root seed
 * `mountManifestRoots` threads into `createGameRuntime` (and therefore
 * `createGame`, BEFORE any world's `mount()`/`setup()` runs). Returns
 * `undefined` when the manifest doesn't declare `determinism.seededRandom`
 * at all — `?vgai-seed=` and `defaultSeed` are both ignored in that case
 * (§2.a: "the mount path seeds ctx.random ... iff declared"; an undeclared
 * project's `ctx.random` still exists, just boots from `createGame`'s own
 * fixed default, unaffected by the manifest or the URL).
 *
 * Precedence when declared (highest wins): `explicitSeed` (a caller-supplied
 * config value) → `?vgai-seed=<int>` on `url` → `manifest.determinism
 * .defaultSeed`.
 */
export function resolveDeterminismSeed(opts: {
  readonly determinism: ResolvedGameManifest['determinism'];
  readonly explicitSeed: number | undefined;
  readonly url: { readonly search: string } | undefined;
}): number | undefined {
  if (opts.determinism?.seededRandom !== true) return undefined;
  const querySeed = opts.url ? readSeedQueryParam(opts.url) : undefined;
  return opts.explicitSeed ?? querySeed ?? opts.determinism.defaultSeed;
}

function readSeedQueryParam(url: { readonly search: string }): number | undefined {
  const raw = new URLSearchParams(url.search).get(RENDER_SEED_QUERY_PARAM);
  if (raw === null || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasRealWindow(): boolean {
  return typeof window !== 'undefined';
}

// `mountManifestRoots` returns the SAME `GameSession` shape
// `createGameRuntime` returns (D-Z2: "the same session shape... or a thin
// superset") — callers keep exactly one teardown path (`session.stop()`)
// whether they mounted through `createGameRuntime` directly or through this
// helper.
export type MountedManifestSession = GameSession;

// ---------------------------------------------------------------------------
// Raw-vs-resolved manifest detection
// ---------------------------------------------------------------------------

/**
 * Distinguish an already-`loadGameManifest`d {@link ResolvedGameManifest}
 * from a raw (pre-Zod-parse) manifest value. The two shapes differ in
 * exactly one load-bearing way for this check: a `ResolvedAdapterRoot.adapter`
 * is `{ type: 'default' | 'module' | 'ingest', identity, ... }`, while a raw
 * `AdapterRoot.adapter` is the literal string `'default'` or a bare `{module}`/
 * `{ingest}` object with NO `type`/`identity` fields (`schema.ts`'s
 * `RootAdapterSchema`). An empty `roots` array is treated as "not resolved"
 * (falls through to `loadGameManifest`, whose own Zod validation reports the
 * empty-array error, if any, more precisely than a guess here could).
 */
function looksAlreadyResolved(value: unknown): value is ResolvedGameManifest {
  if (typeof value !== 'object' || value === null) return false;
  // The loader's own output field is the surest mark: a raw manifest never
  // carries it (the schema is strict). Without this, a RESOLVED manifest
  // with `roots: []` — a models project, nothing to play — fell through to
  // `loadGameManifest`, whose strict parse refused THIS key ("Unrecognized
  // key: deferredConfigurationKinds") instead of saying "no roots"
  // (blind lantern round 21, 2026-09-06, sent there by the never-played nag).
  if (
    Array.isArray((value as { deferredConfigurationKinds?: unknown }).deferredConfigurationKinds)
  ) {
    return true;
  }
  const roots = (value as { roots?: unknown }).roots;
  if (!Array.isArray(roots) || roots.length === 0) return false;
  return roots.every((world) => {
    if (typeof world !== 'object' || world === null) return false;
    const adapter = (world as { adapter?: unknown }).adapter;
    if (typeof adapter !== 'object' || adapter === null) return false;
    const type = (adapter as { type?: unknown }).type;
    return type === 'builtin' || type === 'module' || type === 'ingest';
  });
}

/**
 * Exported (E4) so `mount-game.ts`'s `mountGameFromManifest` composer can
 * share this exact raw-vs-resolved detection instead of re-implementing it
 * — the two modules must always agree on what "already resolved" means.
 */
export function resolveManifest(raw: unknown): ResolvedGameManifest {
  if (looksAlreadyResolved(raw)) return raw;
  return loadGameManifest(raw, { configurationKinds: 'defer' });
}

// ---------------------------------------------------------------------------
// Per-kind entry -> adapter resolution (mirrors `resolveRootBinding`'s
// per-identity dispatch, `packages/editor/src/binding-resolver.ts`)
// ---------------------------------------------------------------------------

function resolveThreeAdapter(
  world: ResolvedAdapterRoot,
  entry: ThreeMountEntry | undefined,
): RootAdapter {
  if (entry?.adapter) return entry.adapter;

  if (world.adapter.type === 'module') {
    throw new Error(
      `mountManifestRoots: world "${world.id}" (three) declares a { module } adapter ` +
        `("${world.adapter.module}") — mountManifestRoots never imports an arbitrary module ` +
        'path itself (no `/@fs/`, no dev server). Import the module yourself and supply the ' +
        `constructed adapter via entries["${world.id}"] = { kind: 'three', adapter }.`,
    );
  }
  if (world.adapter.type === 'ingest') {
    throw new Error(
      `mountManifestRoots: world "${world.id}" (three) declares an { ingest } adapter — ` +
        "captured ingest roots require the editor's dev-server-backed mount machinery (an EditorStore " +
        'plus in-realm scene capture, see resolveIngestDescriptor + ' +
        'mountThreeIngestRootFromManifest) and are ' +
        'not supported by mountManifestRoots (no porting aids, no hosted ingest routes).',
    );
  }

  // type === 'default'
  if (world.entry !== undefined) {
    throw new Error(
      `mountManifestRoots: world "${world.id}" (three) declares \`entry\` "${world.entry}" ` +
        `— supply entries["${world.id}"] = { kind: 'three', adapter } (for a default-exported ` +
        'world, build it with `resolveR3FEntryAdapter(entryModule, worldId)` from ' +
        '`@volter/game-runtime/world3d-react`). Got ' +
        `${entry === undefined ? 'no entry at all' : 'an entry with no `adapter`'}.`,
    );
  }
  // Unreachable in practice: `load.ts`'s `checkAdapterSceneEntryRules` requires
  // `entry` for every 'default' THREE adapter world at manifest-load time (and
  // rejects any other content declaration on one outright).
  throw new Error(
    `mountManifestRoots: world "${world.id}" is default-three with no \`entry\` — this ` +
      'should have been rejected by manifest validation.',
  );
}

function resolvePixiAdapter(
  world: ResolvedAdapterRoot,
  entry: PixiMountEntry | undefined,
): RootAdapter<'canvas'> {
  if (entry?.adapter) return entry.adapter;
  throw new Error(
    `mountManifestRoots: world "${world.id}" (canvas) has no entries["${world.id}"] — a canvas ` +
      'world always needs a caller-supplied, already-constructed adapter ' +
      `(entries["${world.id}"] = { kind: 'canvas', adapter }, constructed from your own ` +
      'already-imported pixi module graph) — mountManifestRoots never ' +
      "value-imports pixi.js (mirrors create-runtime.ts's own pixi-free-core discipline).",
  );
}

function resolveReactAdapter(
  world: ResolvedAdapterRoot,
  entry: ReactMountEntry | undefined,
): RootAdapter<'dom'> {
  if (entry?.adapter) return entry.adapter;
  throw new Error(
    `mountManifestRoots: world "${world.id}" (react) has no entries["${world.id}"] — a react ` +
      "world always needs a caller-supplied, already-constructed `RootAdapter<'dom'>` " +
      `(entries["${world.id}"] = { kind: 'dom', adapter }, mounting via your own already-imported ` +
      'react-dom `createRoot` + your own `<WorldProvider>`) — mountManifestRoots never ' +
      "value-imports react/react-dom (mirrors create-runtime.ts's own react-free-core discipline).",
  );
}

function buildRootMountSpec(
  world: ResolvedAdapterRoot,
  entry: MountEntry | undefined,
): RootMountSpec {
  if (entry !== undefined && entry.kind !== world.surface) {
    throw new Error(
      `mountManifestRoots: entries["${world.id}"] declares kind "${entry.kind}" but the ` +
        `manifest's root "${world.id}" uses surface "${world.surface}" — fix the entries key (or the ` +
        'manifest) so the two agree.',
    );
  }

  const base = {
    id: world.id,
    zOrder: world.zOrder,
    pausable: world.pausable,
    // `root` is this file's own resolved manifest record; the rest — the
    // parsed `vgai.adapter.ts`, the entry namespace, the entry's declared
    // debug/systems bindings — only the caller who loaded the entry can know.
    ...(entry?.declaration === undefined
      ? {}
      : { declaration: { root: world, ...entry.declaration } }),
  };

  // `entry`'s `kind` is guaranteed to agree with `world.kind` past the guard
  // above (or `entry` is `undefined`) — TS can't narrow a `Record` lookup
  // through that runtime check, so each branch casts to its own entry shape;
  // the actual safety comes from the mismatch guard, not from the cast.
  if (world.surface === 'three') {
    const threeEntry = entry as ThreeMountEntry | undefined;
    return { ...base, kind: 'three', adapter: resolveThreeAdapter(world, threeEntry) };
  }
  if (world.surface === 'canvas') {
    const pixiEntry = entry as PixiMountEntry | undefined;
    return { ...base, kind: 'canvas', adapter: resolvePixiAdapter(world, pixiEntry) };
  }
  if (world.surface === 'dom') {
    const reactEntry = entry as ReactMountEntry | undefined;
    return { ...base, kind: 'dom', adapter: resolveReactAdapter(world, reactEntry) };
  }
  // Exhaustiveness guard (§7.4-2, same idiom as `resolveAllRoots`'s own
  // dispatch loop): `world.kind` is the closed `AdapterRoot['kind']` union
  // (`z.enum(['three','canvas','react'])`), so a hypothetical 4th kind
  // must fail to compile here, not silently fall through.
  return assertNever(world.surface, 'mountManifestRoots');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Mount every world declared by a `vgai.project.json` manifest onto `container`,
 * standalone — no editor, no dev server. The generalization of
 * `examples/tri-world/src/main.ts`'s hand-built `RootMountSpec[]` (D-Z2). Reuses
 * the pure `loadGameManifest` + `createGameRuntime({ roots })` and mirrors
 * `resolveAllRoots`'s per-kind dispatch — but every entry the manifest needs
 * beyond what a `default`- adapter scene/entry can express on its own comes from
 * the caller's OWN already-imported module graph (`opts.entries`), never a
 * dynamic import this file performs itself.
 *
 * Degrades loudly: a missing entry, a kind/shape mismatch, a `{ module }`/`{
 * ingest }` adapter with no caller-supplied adapter, or an empty manifest all
 * throw a named `Error` identifying the world id, its kind, and what was
 * expected — never a silent skip or a partially-mounted session.
 */
export async function mountManifestRoots(opts: MountManifestOptions): Promise<GameSession> {
  const manifest = resolveManifest(opts.manifest);
  const mountPlan = declaredRoots(manifest);
  if (mountPlan.length === 0) {
    throw new Error('mountManifestRoots: manifest declares no roots — nothing to mount.');
  }
  const entries = opts.entries ?? {};

  const roots: RootMountSpec[] = mountPlan.map((world) =>
    buildRootMountSpec(world, entries[world.id]),
  );

  // D15 (T-D15.1) — resolved BEFORE `createGameRuntime` (which constructs the
  // Game, and therefore `ctx.random`, before any world's `mount()`/`setup()`
  // runs — see `createGame`'s own doc comment): the seed must be baked in at
  // construction time, not patched in afterward, or a world's `setup()`
  // would already have drawn from the wrong (default) sequence before any
  // post-hoc reseed could take effect.
  const seedUrl = opts.seedUrl ?? (hasRealWindow() ? window.location : undefined);
  const resolvedSeed = resolveDeterminismSeed({
    determinism: manifest.determinism,
    explicitSeed: opts.seed,
    url: seedUrl,
  });

  const session = await createGameRuntime({
    container: opts.container,
    roots,
    width: opts.width ?? manifest.resolution?.width,
    height: opts.height ?? manifest.resolution?.height,
    headless: opts.headless,
    // `rendering.antialias` reaches the WebGL context at CONSTRUCTION and can be honoured
    // nowhere else — see the manifest schema's own `rendering` block and
    // `adapter/renderer-config.ts`'s header for why it is not a world-level declaration.
    ...(manifest.rendering === undefined ? {} : { antialias: manifest.rendering.antialias }),
    seed: resolvedSeed,
    playtest: opts.playtest,
  });

  // D15 (T-D15.3) — the dev-mode Math.random phase trap: only while the
  // manifest declares the contract AND this is a dev build (mirrors D18's
  // debug-bridge gate — `import.meta.env.DEV`, never a production build
  // unless something ELSE explicitly opts in, which this trap has no
  // opt-in for at all: it is dev-only, full stop). `getGameplayRngTrapControl`
  // returns `null` only for a bare `Game`-shaped test stand-in predating
  // T7.1 — real mounts always have one (same precedent as `getDebugRegistry`
  // just below).
  if (manifest.determinism?.seededRandom === true && Boolean(import.meta.env?.DEV)) {
    getGameplayRngTrapControl(session.game)?.setEnabled(true);
  }

  // Task 2.1 — install the `?vgai-debug=1` bridge at the TAIL of every
  // manifest mount (engine-owned, so a standalone project gets it with zero
  // template edits). `getDebugRegistry` returns `null` only for a bare
  // `Game`-shaped test stand-in predating T7.1 — real mounts always have one.
  const debugRegistry = getDebugRegistry(session.game);
  if (debugRegistry) {
    // Defect 3 fix: `setRoomDeclared` (the locus-required rule — a project
    // with a Colyseus room must declare `locus: 'client' | 'server'` on every
    // debug command) was never actually called from a real mount path — this
    // is that wiring. `manifest.server` (`ResolvedGameManifest.server`,
    // `manifest/load.ts`) is `{ room, module } | undefined`; its mere presence
    // is the "this project declares a room" signal, independent of
    // whether/when the game actually joins it.
    if (manifest.configurations.some((configuration) => configuration.kind === 'process')) {
      debugRegistry.setRoomDeclared(true);
    }
    // Defect 5 fix: `maybeInstallDebugBridge` adds `window` listeners and
    // publishes `window.__vgai` with no way to undo either — wire its
    // `uninstall()` into THIS session's own `stop()` so a caller that tears
    // this mount down doesn't leave the bridge (and its listeners) live.
    const bridgeHandle = maybeInstallDebugBridge({
      registry: debugRegistry,
      manifest,
      url: opts.debugBridge?.url,
      window: opts.debugBridge?.window,
    });
    if (bridgeHandle) {
      const stopSession = session.stop;
      session.stop = () => {
        bridgeHandle.uninstall();
        stopSession();
      };
    }
  }

  return session;
}
