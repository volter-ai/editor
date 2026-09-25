/**
 * Module-adapter auto-mounting. Every `{ module }` surface resolves through
 * `resolveAllRoots` and mounts through the universal roots host. The mounted
 * root's own `AuthoringAdapter` drives the generic hierarchy and inspector;
 * absence produces the same explicit no-authoring floor as ingest.
 */

import { measureAdapterReach } from '../host/adapter-reach';
import { setActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import { setActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import {
  addMountFailureReport,
  clearMountFailureReports,
  formatMountFailureMessage,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { makeNoAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/no-authoring-adapter';
import { resolveAllRoots } from '../host/binding-resolver';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { fetchGameManifest } from '@volter/editor-core/manifest-project';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import type { GameSession, RootMountSpec } from '@volter/game-runtime/runtime/create-runtime';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { declaredRoots, ingestRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { ResolvedAdapterRoot, ResolvedGameManifest } from '@volter/editor-project/manifest/load';

interface ModuleSession {
  store: EditorShellStore;
  stop: () => void;
}

let _session: ModuleSession | null = null;

/** True if a `{ module }` adapter world is currently auto-mounted. */
export function isModuleModeActive(): boolean {
  return _session !== null;
}

/**
 * Selection is editor-global UI state (the SAME rule `ThreeAuthoringAdapter`'s
 * own doc comment states) — a custom `{ module }` adapter has no `EditorShellStore`
 * reference to delegate to (by design: `ThreeHostContext` is editor-neutral), so
 * the hierarchy panel's row click (`adapter.selection?.set([node.id])`) would
 * silently no-op without this. Wrap the mounted adapter with a store-backed
 * `SelectionProvider` UNLESS it already declares its own (an adapter author
 * who genuinely wants custom multi-select semantics is not overridden). This
 * costs the adapter author nothing — they never see `EditorShellStore` at all.
 */
export function withStoreSelection(
  authoring: AuthoringAdapter,
  store: EditorShellStore,
): AuthoringAdapter {
  if (authoring.selection) return authoring;
  return {
    ...authoring,
    selection: {
      get: () => [...store.shell.selectedEntityIds],
      set: (ids) => store.shell.selectMultiple(ids),
    },
  };
}

/** Tear down the auto-mounted module session. */
export function exitModuleMode(): void {
  const s = _session;
  if (!s) return;
  _session = null;
  setActiveAuthoring(null);
  setActiveSystems(null);
  clearMountFailureReports(); // D-W3: no session -> nothing left to report (mirrors ingest/mount-ingest-root.ts's unmountThreeIngestRoot)
  s.store.shell.setPlayState('stopped');
  try {
    s.stop();
  } catch {
    /* ignore */
  }
  delete (window as unknown as Record<string, unknown>)['__vgaiModule'];
  editorConsole.log('Module adapter mode stopped', 'adapter');
}

/**
 * Mount a single `{ module }` world through the universal host: a one-element
 * `resolveAllRoots` + `createGameRuntime`
 * — with NO global side effects of its own (no `setActiveAuthoring`, no
 * `store`/viewport writes, no dev hooks). The editor's module route and
 * composite module siblings share this exact resolve-and-mount step.
 */
export async function mountModuleRootRuntime(
  manifest: ResolvedGameManifest,
  world: ResolvedAdapterRoot,
  projectRoot: string,
  container: HTMLElement,
  width: number,
  height: number,
): Promise<{ session: GameSession; specs: RootMountSpec[] }> {
  const { createGameRuntime } = await import('@volter/game-runtime/runtime/create-runtime');
  const specs = await resolveAllRoots({ ...manifest, roots: [world] }, projectRoot);
  const session = await createGameRuntime({ container, roots: specs, width, height });
  return { session, specs };
}

export async function enterModuleModeFromManifestRoot(
  store: EditorShellStore,
  manifest: ResolvedGameManifest,
  world: ResolvedAdapterRoot,
  projectRoot: string,
): Promise<void> {
  // The Game document exists only while a runtime does, so install it (and
  // wait for its panel to commit) before reading the container it owns.
  await acquireLiveDocument();
  const gameContainer = liveDocumentContainer();
  if (!gameContainer) {
    editorConsole.error('Game container not mounted — cannot auto-mount module adapter', 'adapter');
    return;
  }

  store.shell.setPlayState('playing');
  editorConsole.log(
    `Mounting custom adapter module for world "${world.id}" (kind: ${world.surface})`,
    'adapter',
  );

  const w = gameContainer.clientWidth || 800;
  const h = gameContainer.clientHeight || 600;
  const { session, specs } = await mountModuleRootRuntime(
    manifest,
    world,
    projectRoot,
    gameContainer,
    w,
    h,
  );

  const worldInstance = session.game.roots[0]!;
  const mounted = worldInstance.mounted;
  const adapterId = specs[0]!.adapter.id;

  _session = { store, stop: () => session.stop() };

  let activeAuthoring: AuthoringAdapter;
  if (mounted.authoring) {
    activeAuthoring = withStoreSelection(mounted.authoring, store);
  } else {
    // Honest answer for a module adapter that declares no authoring surface.
    activeAuthoring = makeNoAuthoringAdapter(store.shell, `${adapterId} (no authoring surface)`);
  }
  setActiveAuthoring(activeAuthoring);
  setActiveSystems(mounted.systems ?? {});
  store.shell.notifyIngestEdit();
  clearMountFailureReports(); // D-W3: mount succeeded

  // Measured from the mounted adapter rather than declared by the route.
  const reach = measureAdapterReach(mounted);

  (window as unknown as Record<string, unknown>)['__vgaiModule'] = {
    worldId: world.id,
    adapterId,
    reach,
    ...(import.meta.env.DEV ? { adapter: activeAuthoring, store } : {}),
  };
}

/**
 * Route 0 of `ingest/mount-ingest-root.ts`'s `autoLaunchIngest` (checked before the
 * ingest routes — see that function's doc comment): a manifest-backed project
 * whose FIRST world declares a `{ module }` adapter auto-mounts it. Same
 * "applied or not" contract as `tryManifestIngestRoute`.
 *
 * D-V2 (composite): if the manifest declares ANY `{ ingest }` world (anywhere
 * in `roots`, not just first), this route declines — composites are owned by
 * the ingest routes (`ingest/mount-ingest-root.ts`'s `tryManifestIngestRoute*`), which
 * mount the one ingest world through their own enter path and any `{ module
 * }` SIBLING through the scoped runtime (`ingest-siblings.ts`, D-V4) instead
 * of this single-world route's global-side-effect-laden mount. Without this
 * guard, a composite whose FIRST world happens to be a `{ module }` sibling
 * (array order is manifest order, independent of which world is the primary
 * ingest) would be mis-mounted here as if it were a standalone module world.
 * This route's own `firstRoot.adapter.type !== 'module'` behavior for a
 * non-composite manifest is otherwise untouched.
 */
export async function tryManifestModuleRoute(store: EditorShellStore): Promise<boolean> {
  const manifest = await fetchGameManifest().catch(() => null);
  if (manifest && ingestRoots(manifest).length > 0) return false;
  const firstRoot = manifest ? declaredRoots(manifest)[0] : undefined;
  if (firstRoot === undefined || firstRoot.adapter.type !== 'module') return false;

  const project = getCurrentProject();
  if (!project) {
    editorConsole.error(
      'Manifest declares a { module } world but no project is open — cannot auto-mount',
      'adapter',
    );
    return true;
  }
  // No acquire/refuse here: `enterModuleModeFromManifestRoot` mounts into the Game
  // document's container, so they own `acquireGameDocument` (see
  // `ingest/mount-ingest-root.ts`'s module doc — a route-level refusal would
  // pre-empt the mount and leave a bare console line instead of the
  // mount-failure report below).
  try {
    await enterModuleModeFromManifestRoot(store, manifest!, firstRoot, project.rootPath);
  } catch (err) {
    editorConsole.error(`Manifest { module } auto-mount failed: ${err}`, 'adapter');
    // The fourth of the four manifest-route catch blocks (three/pixi/react in
    // ingest/mount-ingest-root.ts, this one for `{ module }` roots); same loud
    // mount-failure-slot population.
    addMountFailureReport({
      worldId: firstRoot.id,
      kind: firstRoot.surface,
      identity: firstRoot.adapter.identity,
      message: formatMountFailureMessage(err),
    });
  }
  return true;
}

import { acquireLiveDocument, liveDocumentContainer } from '@volter/editor-sdk/kit/live-document';
// THE MODULE LANE, as the host sees it (`live-session-registry.ts`).
import { registerLiveSession } from '@volter/editor-sdk/kit/live-session-registry';

registerLiveSession({
  id: 'module',
  priority: 2,
  mounted: isModuleModeActive,
  playing: isModuleModeActive,
  stop: exitModuleMode,
  instanceContainer: () => null,
});
