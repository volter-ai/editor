// The S-D composer (design lineage Stage S-D). Builds ON `mount-manifest.ts`'s
// `mountManifestRoots` (never duplicates its per-kind dispatch/validation) to add
// the one thing that module deliberately does NOT have: a KIND REGISTRY, so a
// project doesn't have to hand-build an `entries` map inline in its own `main.ts`
// every time — it registers a `AdapterSurfaceFactory` per kind it uses (once, at
// module load) and then mounts with a single `mountGameFromManifest(manifest,
// host)` call.
//
// Engine-core react/pixi-free discipline (mirrors `mount-manifest.ts`'s own
// header comment, and the HARD INVARIANT this file was built under): this
// registry is pure mechanism — it holds whatever `AdapterSurfaceFactory` functions
// callers register, but it registers NONE itself. In particular there is no
// built-in 'canvas'/'react' registration here (that would require this file
// to value-import `pixi.js`/`react`/`react-dom`, exactly what `mount-manifest
// .ts` forbids); a project that has a three, canvas, or react world MUST
// register a factory for that kind itself — the factories live with the
// modules that own their dependencies (`r3fRootFactory` in
// `@volter/game-runtime/world3d-react`, its Pixi twin in `@volter/game-runtime/canvas-react`), never
// wired up here automatically.

import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import {
  installNativeDebugBindings,
  installNativeSystemsBindings,
  type NativeDebugBinding,
  type NativeSystemsBinding,
  nativeDebugBindingFromEntryModule,
  nativeSystemsBindingFromEntryModule,
} from '../adapter/native-debug-module';
import { publishDevInstruments } from '../dev/instruments';
import type { GameSession } from './create-runtime';
import { type MountEntry, mountManifestRoots, resolveManifest } from './mount-manifest';
import { assertExportedOrInEditor } from './unexported-game-trap';

// ---------------------------------------------------------------------------
// The host contract (design/26 §5 D1's `ManifestHost`)
// ---------------------------------------------------------------------------

/**
 * What a caller of `mountGameFromManifest` provides. Deliberately minimal —
 * this file never fetches/reads the manifest itself (same rule
 * `mount-manifest.ts` follows: the caller already has a parsed manifest or a
 * raw JSON value in hand).
 */
export interface ManifestHost {
  /** The host creates one absolutely-positioned surface per world inside
   *  this element — see `RootsRuntimeConfig.container`. */
  readonly container: HTMLElement;
  /**
   * Resolve a manifest-declared `entry` (a project-relative module path,
   * e.g. `"src/scripts/main.ts"`) to the ALREADY-IMPORTED module namespace a
   * registered {@link AdapterSurfaceFactory} needs to build a `MountEntry` from.
   *
   * Deliberately NOT "import this arbitrary string path" — a static bundler
   * (Vite/rollup building a `dist/`) cannot resolve a runtime-computed import
   * specifier, so the recommended shape is a small caller-owned lookup table
   * of STATIC imports keyed by the manifest's own `entry` strings (see
   * `packages/editor/template/src/main.ts` for the worked pattern) rather
   * than a literal `import(path)`. Optional — a manifest whose every world
   * either declares no `entry` or is fully satisfied by an explicit
   * `opts.entries` needs none at all.
   */
  loadEntryModule?(path: string): Promise<unknown>;
  /** Resolve asset/scene URLs relative to the project — forwarded to a
   *  registered {@link AdapterSurfaceFactory} via {@link AdapterSurfaceFactoryContext},
   *  never called by this module itself (a factory only needs it for a
   *  non-default resolution scheme, e.g. a project served under a base path). */
  resolveUrl?(path: string): string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /** Forwarded to `createGameRuntime` — Node/headless test harnesses only,
   *  never a real host. See `RootsRuntimeConfig.headless`. */
  readonly headless?: boolean | undefined;
}

/** What a registered {@link AdapterSurfaceFactory} is handed for one world. */
export interface AdapterSurfaceFactoryContext {
  readonly host: ManifestHost;
  /**
   * The result of `host.loadEntryModule(world.entry)`, if the world declares
   * an `entry` AND the host supports loading it — `undefined` for a
   * scene-only world, or when the host has no `loadEntryModule`.
   */
  readonly entryModule?: unknown;
}

/**
 * A caller-registered per-kind mount strategy: given the world's resolved
 * manifest entry and the loaded entry module (if any), produce the
 * `MountEntry` `mountManifestRoots` needs to mount it (exactly what a
 * project used to hand-build inline as its own `entries[id]` — see
 * `examples/tri-world/src/main.ts`'s pre-E4 shape). May be async (loading an
 * asset, fetching a scene file, etc.).
 */
export type AdapterSurfaceFactory = (
  world: ResolvedAdapterRoot,
  ctx: AdapterSurfaceFactoryContext,
) => MountEntry | Promise<MountEntry>;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const registry = new Map<string, AdapterSurfaceFactory>();

/**
 * Register a `AdapterSurfaceFactory` for a manifest world `kind` (`'three'` /
 * `'canvas'` / `'react'`, or any future kind the manifest schema grows).
 * Call once, at module load — mirrors `registerSceneUIRenderer()`'s existing
 * "call before mounting" convention (`packages/editor/template/src/main.ts`).
 *
 * Throws on double-registration of the SAME kind: an accidental duplicate
 * (two side-effect imports of the same registration module, or a copy-paste)
 * is far more likely than an intentional runtime swap — a caller that really
 * wants to replace a registration must `unregisterAdapter` first, making
 * the intent explicit.
 */
export function registerAdapter(kind: string, factory: AdapterSurfaceFactory): void {
  if (registry.has(kind)) {
    throw new Error(
      `registerAdapter: a factory is already registered for kind "${kind}" — ` +
        'call unregisterAdapter(kind) first if you intend to replace it (an accidental ' +
        'double-registration, e.g. two side-effect imports of the same registration module, ' +
        'is far more common than an intentional swap).',
    );
  }
  registry.set(kind, factory);
}

/** Remove a kind's registration (e.g. before re-registering a replacement). */
export function unregisterAdapter(kind: string): void {
  registry.delete(kind);
}

/** Whether a factory is currently registered for `kind`. */
export function isAdapterRegistered(kind: string): boolean {
  return registry.has(kind);
}

/**
 * Test-only escape hatch: clears every registration. Registrations are
 * meant to be one-time, process-lifetime — production code should never
 * call this; it exists so unit tests can start each case from a clean
 * registry without cross-test leakage.
 */
export function __clearAdapterSurfaceRegistryForTests(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

export interface MountGameOptions {
  /** Explicit per-world entries, same shape `mountManifestRoots` accepts —
   *  ALWAYS wins over a registered kind factory for that world id (backward
   *  compat: a caller mid-migration, or one that just prefers building one
   *  entry by hand, never has to touch the registry at all). */
  readonly entries?: Readonly<Record<string, MountEntry>> | undefined;
}

/** True for the one shape `mountManifestRoots` can ALREADY mount with zero
 *  `entries[id]` at all.
 *
 *  NOTHING is self-sufficient: `load.ts` rejects a three root with no
 *  `entry` outright, so every world needs a registered factory or an explicit
 *  entry. This predicate is retained so the loud-degrade error stays the
 *  documented outcome rather than a silent skip. */
function worldIsSelfSufficient(_world: ResolvedAdapterRoot): boolean {
  return false;
}

function nativeDebugForEntry(
  world: ResolvedAdapterRoot,
  entryModule: unknown,
): NativeDebugBinding[] {
  if (entryModule === undefined || world.adapter.type !== 'builtin') return [];
  const binding = nativeDebugBindingFromEntryModule(world.id, entryModule);
  return binding ? [binding] : [];
}

function nativeSystemsForEntry(
  world: ResolvedAdapterRoot,
  entryModule: unknown,
): NativeSystemsBinding[] {
  if (entryModule === undefined || world.adapter.type !== 'builtin') return [];
  const binding = nativeSystemsBindingFromEntryModule(world.id, entryModule, world.surface);
  return binding ? [binding] : [];
}

/**
 * Mount every world declared by a `vgai.project.json` manifest onto `host
 * .container`, resolving each world's kind through the `registerAdapter`
 * registry — falling back to an explicit `opts.entries[id]` where supplied,
 * exactly like `mountManifestRoots` (so a caller can migrate one world at a
 * time, or never touch the registry if it prefers hand-building entries).
 *
 * This is the "one call" scaffold/example projects mount through (E4
 * acceptance): register whatever kinds you need once, then
 * `await mountGameFromManifest(manifest, host)` — see
 * `packages/editor/template/src/main.ts` for the worked single-world
 * example and `examples/tri-world/src/main.ts` for a multi-kind one.
 *
 * Degrades loudly (carried into E4): a world whose kind has no registered
 * factory AND no explicit entry, and which cannot self-mount from the
 * manifest alone, throws a named `Error` identifying the world id + kind and
 * BOTH ways to fix it (`registerAdapter` or `opts.entries`) — never a silent
 * skip.
 */
export async function mountGameFromManifest(
  manifestInput: unknown,
  host: ManifestHost,
  opts: MountGameOptions = {},
): Promise<GameSession> {
  // Owner invariant: an unexported game never mounts outside the editor. The
  // editor mounts through its own resolver, so every caller of THIS function
  // is a standalone page — and on a dev server, that page refuses to boot
  // (see unexported-game-trap.ts for why this is a trap and not a rule).
  assertExportedOrInEditor();
  const manifest = resolveManifest(manifestInput);
  const entries: Record<string, MountEntry> = { ...opts.entries };
  const nativeDebug: NativeDebugBinding[] = [];
  const nativeSystems: NativeSystemsBinding[] = [];

  for (const world of declaredRoots(manifest)) {
    if (entries[world.id] !== undefined) continue; // explicit entry always wins

    const factory = registry.get(world.adapter.identity);
    if (factory) {
      const entryModule =
        world.entry !== undefined && host.loadEntryModule
          ? await host.loadEntryModule(world.entry)
          : undefined;
      nativeDebug.push(...nativeDebugForEntry(world, entryModule));
      nativeSystems.push(...nativeSystemsForEntry(world, entryModule));
      entries[world.id] = await factory(world, { host, entryModule });
      continue;
    }

    if (worldIsSelfSufficient(world)) continue; // mountManifestRoots needs nothing further

    throw new Error(
      `mountGameFromManifest: root "${world.id}" (adapter "${world.adapter.identity}") has no registered ` +
        `adapter factory and no explicit entries["${world.id}"] — call ` +
        `registerAdapter("${world.adapter.identity}", factory) before mounting (see ` +
        '`r3fRootFactory` in `@volter/game-runtime/world3d-react` for the worked three factory), or pass ' +
        `opts.entries["${world.id}"] directly (see mount-manifest.ts's \`MountEntry\`).`,
    );
  }

  const session = await mountManifestRoots({
    manifest,
    container: host.container,
    entries,
    width: host.width,
    height: host.height,
    headless: host.headless,
  });
  installNativeDebugBindings(session.game, nativeDebug);
  installNativeSystemsBindings(session.game, nativeSystems);
  // The universal instruments are host furniture on EVERY mount path — the
  // editor installs them in its own bindings pass; the standalone composer
  // installs them here. The disposer is deliberately dropped: the set's one
  // resource lives on this Game and dies with it.
  publishDevInstruments(session.game);
  return session;
}
