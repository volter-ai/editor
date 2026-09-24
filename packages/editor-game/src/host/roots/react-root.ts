/**
 * The two DOM-surface identities — `dom` (first-party React UI) and
 * `ingest-react` (a vendored React game reached through a host shim).
 *
 * They mount through the SAME react host stack: the same realm entry load, the
 * same default-export-component validation, the same `<WorldProvider>` wrap,
 * the same `createRoot(...).render(...)` body. Only the identity label
 * differs, so a failure is attributed to the right one. "One stacking model,
 * no special case": the automatic `<WorldProvider>` wrap is context-only and
 * harmless to a foreign tree.
 *
 * An ingest-react world's `entry` is NOT a first-party component — it is a
 * HOST-SHIM module living beside the ingested game's manifest, importing the
 * vendored game's own `App`/store and default-exporting the composed
 * component. Neither resolver has any knowledge of the vendored game's own
 * standalone entry point (its raw `ReactDOM.render` call): only the manifest's
 * declared `entry` is ever imported, so that entry point is never reached.
 */

import type { MountedReactGame, ReactRootAdapter } from '@vgai/game-runtime/runtime/create-runtime';
import type { Game } from '@vgai/game-runtime/runtime/game';
import type { DomHostContext } from '@vgai/project/adapter';
import type { ResolvedAdapterRoot } from '@vgai/project/manifest/load';
import type { ComponentType } from 'react';
import { resolveWorldProviderForProject } from '../react-mount-runtime';
import type { RealmServices } from '../realm-services';

/**
 * The shape a react world's `entry` module must satisfy: default-export a
 * React component. Validated loudly at import time — a project whose entry
 * exports the wrong shape gets a named error naming the world and the export
 * it actually found, not a cryptic "X is not a function" deep inside
 * `createRoot`/`render`.
 */
function loadReactEntryComponent(
  world: ResolvedAdapterRoot,
  mod: { default?: unknown },
  identityLabel: 'dom' | 'ingest-react',
): ComponentType {
  if (typeof mod.default !== 'function') {
    throw new Error(
      `resolveRootBinding: world "${world.id}" (${identityLabel}) entry module does not ` +
        `default-export a component — got ${typeof mod.default}. A react world's \`entry\` must ` +
        'default-export a React component.',
    );
  }
  return mod.default as ComponentType;
}

/**
 * `DomHostContext.game` is a typed, guaranteed field on the native multi-root
 * mount path. The loud check here stays for the one host that legitimately
 * carries none — a `dom` sibling mounted BESIDE an ingest root
 * (`ingest-siblings.ts`) has no native `Game`, and that host renders the entry
 * component BARE rather than fabricating an empty Game into `<WorldProvider>`.
 * A hand-rolled host that skipped the engine's mount path must fail loudly
 * here, never lie an `undefined` Game into the provider.
 */
function requireHostGame(world: ResolvedAdapterRoot, host: DomHostContext, label: string): Game {
  const game = host.game;
  if (!game) {
    throw new Error(
      `resolveRootBinding: world "${world.id}" (${label}) mount() received a DomHostContext ` +
        'with no `game` — WorldProvider needs a live Game at mount time and this host did not ' +
        'carry one.',
    );
  }
  return game;
}

/**
 * The shared entry-loading step, exported so a composite's `dom` SIBLING mount
 * (`ingest-siblings.ts`) reuses the EXACT SAME `entry`-required check and
 * component-shape validation without duplicating any of it. The sibling then
 * renders the returned component bare; {@link resolveDomAdapter} below wraps
 * it in `<WorldProvider>`.
 */
export async function resolveReactAdapterRootComponent(
  world: ResolvedAdapterRoot,
  realm: RealmServices,
  onEntryModule?: (module: Record<string, unknown>) => void,
): Promise<ComponentType> {
  if (world.entry === undefined) {
    // Unreachable in practice: `load.ts`'s entry rules require `entry` for
    // every built-in adapter world at manifest-load time. Still loud.
    throw new Error(
      `resolveRootBinding: world "${world.id}" is a dom root with no \`entry\` — this should ` +
        'have been rejected by manifest validation.',
    );
  }
  const mod = await realm.loadEntryModule(world.entry, world.id, 'dom');
  onEntryModule?.(mod);
  return loadReactEntryComponent(world, mod, 'dom');
}

/** Build the `mount` half both identities share. */
function reactMount(
  world: ResolvedAdapterRoot,
  label: 'dom' | 'ingest-react',
  Entry: ComponentType,
  WorldProvider: ComponentType<{ game: Game; children?: unknown }>,
  realm: RealmServices,
  /** Commit the initial DOM synchronously. The play authoring adapter is
   *  installed immediately after `mount()` resolves, so a first-party root
   *  flushes to give its first hierarchy snapshot the OID tree instead of an
   *  empty container. */
  flushInitialRender: boolean,
): ReactRootAdapter {
  return {
    id: world.id,
    async mount(host: DomHostContext): Promise<MountedReactGame> {
      const game = requireHostGame(world, host, label);
      // The runtime comes from the realm — the PROJECT's own react under the
      // packaged runtime, the editor's static imports otherwise — so this
      // mount always shares ONE react instance with the entry component's own
      // hooks.
      const runtime = await realm.reactDomRuntime();
      const root = runtime.createRoot(host.container);
      const render = () => {
        root.render(
          runtime.createElement(WorldProvider, { game, children: runtime.createElement(Entry) }),
        );
      };
      if (flushInitialRender) runtime.flushSync(render);
      else render();
      return {
        kind: 'dom',
        container: host.container,
        drivesOwnLoop: false,
        dispose(): void {
          root.unmount();
        },
      };
    },
  };
}

/** A first-party `dom` root. */
export async function resolveDomAdapter(
  world: ResolvedAdapterRoot,
  realm: RealmServices,
  onEntryModule?: ((module: Record<string, unknown>) => void) | undefined,
): Promise<ReactRootAdapter> {
  const Entry = await resolveReactAdapterRootComponent(world, realm, onEntryModule);
  const WorldProvider = await resolveWorldProviderForProject();
  return reactMount(world, 'dom', Entry, WorldProvider, realm, true);
}

/**
 * An `ingest-react` root. `entry` is REQUIRED — there is no scene-or-entry
 * choice: an ingest-react world IS its host shim.
 *
 * There is no `writeBackend` for an ingest-react world and this function
 * returns `{ id, mount }` only. Play mode enforces the write boundary
 * explicitly, by installing a read-only boundary authoring adapter whenever
 * the declaration identity is `ingest-react`; universal hierarchy membership
 * does not imply write authority over vendored source.
 */
export async function resolveIngestReactAdapter(
  world: ResolvedAdapterRoot,
  realm: RealmServices,
): Promise<{ readonly adapter: ReactRootAdapter; readonly module: Record<string, unknown> }> {
  const { adapter } = world;
  if (adapter.type !== 'ingest') {
    throw new Error(`resolveRootBinding: world "${world.id}" is not an { ingest } world.`);
  }
  if (world.entry === undefined) {
    throw new Error(
      `resolveRootBinding: world "${world.id}" (ingest-react) has no \`entry\` — an ingested ` +
        "react world's `entry` MUST point at a host-shim module that imports the vendored " +
        "game's own component and default-exports it.",
    );
  }
  const mod = await realm.loadEntryModule(world.entry, world.id, 'dom');
  const Entry = loadReactEntryComponent(world, mod, 'ingest-react');
  const WorldProvider = await resolveWorldProviderForProject();
  return {
    adapter: reactMount(world, 'ingest-react', Entry, WorldProvider, realm, false),
    module: mod,
  };
}
