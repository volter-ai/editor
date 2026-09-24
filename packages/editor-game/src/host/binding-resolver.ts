/**
 * ONE manifest root → the surface-tagged adapter that mounts it, plus the
 * DECLARATION the host completes into a `RootBinding` at registration.
 *
 * A game is a native program plus a declaration of itself; the editor is a
 * universal client of that declaration. This module is where the declaration
 * is READ: the manifest root, the project's parsed `vgai.adapter.ts`, and the
 * entry module's own static surface, resolved against ONE realm
 * (`realm-services.ts` — dev or packaged).
 *
 * ## What used to be here, and is not any more
 *
 * The realm question — where a root's entry module is loaded FROM — was
 * answered independently inside the three,
 * canvas and dom resolvers, three copies that had already drifted apart in
 * their error messages and branch order. It is `RealmServices.loadEntryModule`
 * now, asked once per root. Entry adjudication ("what does this three module
 * MEAN?") likewise had two copies calling two DIFFERENT engine doors, one of
 * which crashed the packaged runtime; it is `entry-adjudication.ts` now. The
 * `{ module }` guards live in `roots/module-root.ts`, the two DOM identities in
 * `roots/react-root.ts`, and the ingest descriptors — whose served-bundle
 * choice is per-PROJECT, not per-realm — in `ingest/resolve-{three,canvas}.ts`.
 *
 * ## Why the return is a `{ surface, adapter }` PAIR
 *
 * Every identity produces an adapter for a DIFFERENT render surface, each with
 * its own host-context parameter. A single `Promise<RootAdapter>` channel can
 * only be ONE of them, so callers used to re-assert the real kind with
 * `as unknown as` — kind ERASURE: information the manifest already carried,
 * thrown away here and guessed back there. Widening to a bare union does NOT
 * fix it — a union of function types intersects its parameters, so
 * `.mount(host)` becomes uncallable at every call site. Carrying the surface
 * alongside makes the result a discriminated union, so `switch (r.surface)`
 * narrows `r.adapter` to a single signature.
 */

import {
  beginProjectMountEpoch,
  type EntrypointSelectionOverride,
} from '@vgai/editor-sdk/session/project-module-url';
import {
  nativeDebugBindingFromEntryModule,
  nativeSystemsBindingFromEntryModule,
} from '@vgai/game-runtime/adapter/native-debug-module';
import type { RootMountSpec } from '@vgai/game-runtime/runtime/create-runtime';
import type { MountEntry } from '@vgai/game-runtime/runtime/mount-manifest';
import type { SurfaceAdapter } from '@vgai/project/adapter';
import type { AdapterDefinition } from '@vgai/project/adapter/adapter-module';
import { assertNever } from '@vgai/project/adapter/adapter-surface';
import type { RootDeclaration } from '@vgai/project/adapter/binding';
import { declaredRoots } from '@vgai/project/adapter/manifest-interpreter';
import type { ResolvedAdapterRoot, ResolvedGameManifest } from '@vgai/project/manifest/load';
import { adjudicateThreeEntry } from './entry-adjudication';
import { projectAdapterDefinition } from './project-adapter';
import { activeRealmServices, type RealmServices } from './realm-services';
import { resolveModuleAdapter } from './roots/module-root';
import { resolveDomAdapter, resolveIngestReactAdapter } from './roots/react-root';

/**
 * What a root's binding is BEFORE anything mounts.
 *
 * `RootBinding` itself cannot exist yet: its `substrate.mounted` is the handle
 * the adapter's `mount` returns, and mounting is the HOST's job, one layer
 * further out. So resolution produces the adapter to mount and the declaration
 * half; `create-runtime.ts`'s `register<Surface>Root` calls
 * `createRootBinding` with both plus `mounted` at registration.
 */
export interface ResolvedRootBinding {
  readonly adapter: SurfaceAdapter;
  /** Absent only for a captured ingest, which never becomes a `RootAdapter`. */
  readonly declaration: RootDeclaration;
}

/** Optional per-root context for {@link resolveRootBinding}. */
export interface ResolveRootBindingOptions {
  /**
   * Serve this world's entry with its swap-slot const rewritten to `key`.
   * Host-owned remount — the file on disk is untouched. Dev-only; the browser
   * realms refuse it by name.
   */
  readonly selectionOverride?: EntrypointSelectionOverride | undefined;
}

/**
 * Resolve one manifest root against one realm.
 *
 * `adapterDef` is an INPUT, never something this function goes and fetches:
 * `vgai.adapter.ts` loading stays in `project-adapter.ts`, and the binding is
 * the hand-off's shape rather than a second loader.
 */
export async function resolveRootBinding(
  root: ResolvedAdapterRoot,
  realm: RealmServices,
  adapterDef: AdapterDefinition | null,
  opts?: ResolveRootBindingOptions,
): Promise<ResolvedRootBinding> {
  const { adapter, module } = await resolveSurfaceAdapter(root, realm, opts);
  return { adapter, declaration: declare(root, adapterDef, module) };
}

/** The declaration half: the manifest root, the parsed definition, the entry
 *  namespace with its reach stated, and the entry's two static declared
 *  bindings harvested from that same namespace. */
function declare(
  root: ResolvedAdapterRoot,
  definition: AdapterDefinition | null,
  module: Record<string, unknown>,
): RootDeclaration {
  const debug = nativeDebugBindingFromEntryModule(root.id, module);
  const systems = nativeSystemsBindingFromEntryModule(root.id, module, root.surface);
  return {
    root,
    definition,
    entry: { reach: 'full', module },
    ...(debug ? { entryDebug: debug } : {}),
    ...(systems ? { entrySystems: systems } : {}),
  };
}

/**
 * The per-identity dispatch. Each branch's tag is the identity's own surface,
 * not a guess: `load.ts` derives a builtin identity FROM the declared surface
 * and an ingest identity likewise, so identity and surface agree by
 * construction. `{ module }` is the one identity that does not fix a surface,
 * and it dispatches on `root.surface` itself.
 */
async function resolveSurfaceAdapter(
  root: ResolvedAdapterRoot,
  realm: RealmServices,
  opts?: ResolveRootBindingOptions,
): Promise<{ adapter: SurfaceAdapter; module: Record<string, unknown> }> {
  const { adapter } = root;
  switch (adapter.identity) {
    case 'three':
      return resolveThreeRoot(root, realm, opts);
    case 'canvas':
      return resolveCanvasRoot(root, realm, opts);
    case 'dom': {
      let module: Record<string, unknown> = {};
      const built = await resolveDomAdapter(root, realm, (m) => {
        module = m;
      });
      return { adapter: { surface: 'dom', adapter: built }, module };
    }
    case 'module': {
      const { resolved, module } = await resolveModuleAdapter(root, realm.projectRoot, realm.epoch);
      return { adapter: resolved, module };
    }
    case 'ingest-react': {
      const { adapter: built, module } = await resolveIngestReactAdapter(root, realm);
      return { adapter: { surface: 'dom', adapter: built }, module };
    }
    case 'ingest-pixi':
    case 'ingest-three':
      return rejectCapturedIngestAsRootAdapter(root);
    default: {
      const exhaustive: never = adapter;
      throw new Error(
        `resolveRootBinding: unhandled adapter identity ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** A three root: `entry` is the only way one is authored, and what that module
 *  MEANS is `entry-adjudication.ts`'s single answer. */
async function resolveThreeRoot(
  root: ResolvedAdapterRoot,
  realm: RealmServices,
  opts?: ResolveRootBindingOptions,
): Promise<{ adapter: SurfaceAdapter; module: Record<string, unknown> }> {
  if (root.entry === undefined) {
    // Unreachable in practice: `load.ts` requires `entry` for every three root
    // at manifest-load time.
    throw new Error(
      `resolveRootBinding: world "${root.id}" is a three root with no \`entry\` — this should ` +
        'have been rejected by manifest validation. A three root is authored as a TSX/R3F world ' +
        'module.',
    );
  }
  const module = await realm.loadEntryModule(root.entry, root.id, 'three', opts?.selectionOverride);
  const built = await adjudicateThreeEntry(module, root.id, { entryPath: root.entry });
  if (!built) {
    throw new Error(
      `Project script at ${root.entry} neither exports \`adapter\` nor default-exports a ` +
        'React world component — every explicit first-party entry module satisfies one of the ' +
        'two (`export default function World() { … }`, or an `adapter` export for full control).',
    );
  }
  return { adapter: { surface: 'three', adapter: built }, module };
}

/**
 * A canvas root is source-as-truth exactly like a three root: its `entry` is a
 * TSX world file, and what that file EXPORTS is adjudicated in ONE place —
 * `resolveCanvasEntryAdapter` (`@vgai/game-runtime/canvas-react`, reached through the
 * realm so the packaged runtime takes it from the PROJECT's graph), the same
 * function the standalone mount path uses. Keeping the adjudication there
 * rather than here is what stops the editor and the standalone build from
 * disagreeing about what a world file means.
 */
async function resolveCanvasRoot(
  root: ResolvedAdapterRoot,
  realm: RealmServices,
  opts?: ResolveRootBindingOptions,
): Promise<{ adapter: SurfaceAdapter; module: Record<string, unknown> }> {
  if (root.entry === undefined) {
    throw new Error(
      `resolveRootBinding: world "${root.id}" is a canvas root with no \`entry\` — this should ` +
        'have been rejected by manifest validation. A canvas root is authored as a TSX world ' +
        'module; point `entry` at it.',
    );
  }
  const module = await realm.loadEntryModule(
    root.entry,
    root.id,
    'canvas',
    opts?.selectionOverride,
  );
  const built = await realm.pixiRuntime(module, root.id);
  if (!built) {
    throw new Error(
      `Project script at ${root.entry} (canvas root "${root.id}") must default-export a React ` +
        'component (`export default function World() { … }`) — or export an `adapter` for full ' +
        'control.',
    );
  }
  return { adapter: { surface: 'canvas', adapter: built }, module };
}

/**
 * Captured Three/Canvas ingests are not `RootAdapter`s. The foreign game owns
 * the renderer, canvas, loop and capture lifecycle, while a normal
 * `RootAdapter.mount(host)` receives a host-owned renderer/surface. Returning
 * an adapter whose `mount()` only throws would fabricate mountability.
 */
function rejectCapturedIngestAsRootAdapter(root: ResolvedAdapterRoot): never {
  const resolver =
    root.adapter.identity === 'ingest-pixi'
      ? 'resolveIngest2DDescriptor + mountCanvasIngestRootFromManifest'
      : 'resolveIngestDescriptor + mountThreeIngestRootFromManifest';
  throw new Error(
    `resolveRootBinding: world "${root.id}" (${root.adapter.identity}) is a captured foreign ` +
      `runtime, not a host-mounted RootAdapter; dispatch it through ${resolver}`,
  );
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Editor-only context for resolving a whole manifest composition. */
export interface ResolveAllRootEntriesOptions {
  /**
   * Remount the named region's entrypoint at this swap-slot key. Only that
   * world's entry URL carries the override; siblings share `?vgai-mount=`
   * alone so the module graph stays one instance.
   */
  readonly selectionOverride?:
    | (EntrypointSelectionOverride & { readonly regionId: string })
    | undefined;
}

interface ResolvedComposition {
  readonly roots: { world: ResolvedAdapterRoot; resolved: ResolvedRootBinding }[];
  readonly mountId: string;
}

/**
 * Resolve every declared root in manifest order, against ONE realm and ONE
 * mount epoch.
 *
 * The epoch opens HERE — once, before any root imports its entry — so every
 * root of this composition resolves shared project modules to the same urls.
 * It is the only place that call belongs: it is the single point every
 * multi-root resolve funnels through, and moving it into the per-root
 * resolvers would give each root its own generation, which is the defect.
 *
 * The COMPOSITION level is likewise where the project's two ambient inputs are
 * fetched — the realm's services and the parsed `vgai.adapter.ts` — because
 * both are properties of the open project rather than of any one root, and
 * asking once per composition is what keeps every root of a game bound to the
 * same declaration. `resolveRootBinding` itself still fetches neither: it is
 * handed both, which is the rule that stops it becoming a second loader.
 */
async function resolveComposition(
  manifest: ResolvedGameManifest,
  projectRoot: string,
  opts?: ResolveAllRootEntriesOptions,
): Promise<ResolvedComposition> {
  const epoch = beginProjectMountEpoch();
  const realm = await activeRealmServices(projectRoot, epoch);
  const adapterDef = await projectAdapterDefinition();

  const out: { world: ResolvedAdapterRoot; resolved: ResolvedRootBinding }[] = [];
  for (const world of declaredRoots(manifest)) {
    const override = opts?.selectionOverride;
    const resolved = await resolveRootBinding(world, realm, adapterDef, {
      ...(override && world.id === override.regionId
        ? { selectionOverride: { selection: override.selection, key: override.key } }
        : {}),
    });
    out.push({ world, resolved });
  }
  // Stringified because that is the form the id travels in everywhere else:
  // the entry url's `?vgai-mount=` value, and therefore the key
  // `gated-globals.ts` reads back off a module url.
  return { roots: out, mountId: String(epoch) };
}

/** Every host-mounted root as a `RootMountSpec[]` — the shape
 *  `createGameRuntime({ roots })` takes directly. */
export async function resolveAllRoots(
  manifest: ResolvedGameManifest,
  projectRoot: string,
): Promise<RootMountSpec[]> {
  const { roots } = await resolveComposition(manifest, projectRoot);

  const specs: RootMountSpec[] = [];
  for (const { world, resolved } of roots) {
    const base = {
      id: world.id,
      zOrder: world.zOrder,
      pausable: world.pausable,
      declaration: resolved.declaration,
    };
    const r = resolved.adapter;
    switch (r.surface) {
      case 'canvas':
        specs.push({ ...base, kind: 'canvas', adapter: r.adapter });
        break;
      case 'dom':
        specs.push({ ...base, kind: 'dom', adapter: r.adapter });
        break;
      case 'three':
        specs.push({ ...base, kind: 'three', adapter: r.adapter });
        break;
      default:
        assertNever(r, 'resolveAllRoots');
    }
  }
  return specs;
}

/**
 * `resolveAllRoots`'s composer-path sibling: the same loop, returning
 * `mountManifestRoots`'s own `entries` shape (`{ kind, adapter }` per world id)
 * instead of a hand-built `RootMountSpec[]` — so `zOrder`/`pausable` and the
 * per-kind spec ASSEMBLY come from `mount-manifest.ts`'s `buildRootMountSpec`,
 * the one authoritative place that translation lives, rather than being
 * duplicated here AND at the `mountManifestRoots` call site.
 *
 * It also returns this composition's `mountId` — the identity the whole
 * isolation layer is keyed by. It is minted here (one epoch per composition),
 * rides every project module url as `?vgai-mount=`, and is what
 * `gated-globals.ts` resolves a realm and an input gate under.
 *
 * It does NOT return the entry modules' harvested `debug`/`systems` bindings.
 * Those ride each root's own declaration into its binding, and
 * `installAdapterRuntimeBindings` reads them off `game.roots` there — one
 * carrier for one fact, instead of a second array the caller had to thread
 * from here to the install site by hand.
 */
export async function resolveAllRootEntries(
  manifest: ResolvedGameManifest,
  projectRoot: string,
  opts?: ResolveAllRootEntriesOptions,
): Promise<{
  entries: Record<string, MountEntry>;
  mountId: string;
}> {
  const { roots, mountId } = await resolveComposition(manifest, projectRoot, opts);

  const entries: Record<string, MountEntry> = {};
  for (const { world, resolved } of roots) {
    const { root: _root, ...declaration } = resolved.declaration;
    const r = resolved.adapter;
    switch (r.surface) {
      case 'canvas':
        entries[world.id] = { kind: 'canvas', adapter: r.adapter, declaration };
        break;
      case 'dom':
        entries[world.id] = { kind: 'dom', adapter: r.adapter, declaration };
        break;
      case 'three':
        entries[world.id] = { kind: 'three', adapter: r.adapter, declaration };
        break;
      default:
        assertNever(r, 'resolveAllRootEntries');
    }
  }
  return { entries, mountId };
}
