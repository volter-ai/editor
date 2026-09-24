import { onAssetReload } from '@volter/editor-sdk/kit/project-asset-refresh';

/**
 * R3F design session (W4) — mounts an entry-based R3F three world at DESIGN
 * TIME so the editor's native viewport, gizmo, hierarchy, and inspector drive
 * the LIVE fiber scene in EDIT mode, with writes going back to the `.tsx`
 * source through `R3fSourceAuthoringAdapter`.
 *
 * The project mounts against a design host borrowing the viewport renderer
 * for offscreen GPU work. Fiber's canvas and renderer lifecycle remain owned
 * by the host; its simulation uses frameloop 'never'. No second context is
 * created and no automatic game tick runs in Edit mode.
 * The EDITOR's own renderer draws the scene: the fiber `THREE.Scene` is
 * adopted into the store (`enterPlayScene`, the same swap play/ingest use —
 * viewport `setScene`, objectMap from the adapter's stamped `entityId`s,
 * composer rebuild), while `playState` stays 'stopped', so this is an
 * EDIT-mode surface: hierarchy/pick/gizmo all work through the existing
 * native-three machinery.
 *
 * Edit shows the AUTHORED pose and never advances content time. Physics preview
 * is explicit simulation, just as animation preview is explicit transport;
 * opening a scene must not hide it behind a build-quiescence wait plus 90
 * invisible simulation steps. That is both the architecture's Edit ≠ Play
 * rule and the ordinary Unity/Godot scene-editor contract.
 *
 * Component-only R3F modules use native Fast Refresh on this persistent root.
 * Mixed exports still use the controlled entry-update/remount path. Completed
 * HMR source hashes acknowledge matching collaboration revisions; a revision
 * whose update was lost retains a bounded cold-remount fallback. The native
 * authoring adapter observes reconciled child additions/removals.
 *
 * Play handoff mirrors `design-time-layers.ts`: entering play suspends the
 * session (scene restored, fiber root disposed, Boundary disclosure node
 * back in the composite); Stop queues one edit-mode rebuild which recreates
 * the session fresh.
 *
 * DEBUG PLANE OWNERSHIP (ARCHITECTURE-CORE §Editor chrome — "the edit-time
 * design session PUBLISHES its debug plane"), stated once, here:
 *
 *  - OWNER: this session. While a design world is mounted and `playState` is
 *    'stopped', it registers the design `Game`'s own `systemAdapters` — its
 *    game-scoped debug registry, carrying whatever the mounted world actually
 *    registered — through the SAME `setActiveSystems` door play/ingest/module
 *    modes use, under the UNNAMED (solo) seat. That is what lets the relay
 *    answer `list-gameplay-state`/`inspect-gameplay-state`/
 *    `list-debug-commands`/`invoke-debug-command` and `vgai eval`'s
 *    `game.state()`/`game.commands()` from the EDIT world. It publishes
 *    declarations, never a run: the loop is still never advanced.
 *  - SHARERS: none, ever, at the same instant. Play mode registers its mount
 *    under its OWN mount id, so a seat held by both would make
 *    `systemsForInstance(undefined)` ambiguous and break every unaddressed
 *    `vgai eval` call. The store subscription below therefore withdraws this
 *    seat the moment `playState` leaves 'stopped' — synchronously, at
 *    `store.setPlayState('playing')`, long before play's own
 *    `setActiveSystems` lands — and republishes when play ends without a
 *    rebuild. (When play DID suspend this session, Stop queues the rebuild and
 *    the FRESH session publishes; this one only withdraws.)
 *  - TEARDOWN: `withdrawPlane()` is the one path that ends it, and it is
 *    idempotent. Its callers are the play-entry subscription, `disposeMounted`
 *    (so an HMR remount can never leave the disposed game's stripped registry
 *    published), and the returned disposer.
 */

import { setActiveSystems, updateInstanceSystems } from '@volter/editor-core/authoring/active-systems';
import {
  BoundaryAuthoringAdapter,
  type BoundaryRootInfo,
} from '@volter/editor-core/authoring/boundary-authoring-adapter';
import type { CompositeAuthoringAdapter } from '@volter/editor-core/authoring/composite-authoring-adapter';
import {
  collaborationSnapshot,
  subscribeCollaborationRevision,
} from '@volter/editor-core/collaboration-client';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { adjudicateThreeEntry } from '../../host/entry-adjudication';
import { onPlayTransitionSettled } from '@volter/editor-core/live-transition';
import { fetchRawGameManifest } from '@volter/editor-core/manifest-project';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { activeRealmServices } from '../../host/realm-services';
import { pickGameCamera } from '@volter/editor-core/scene-framing';
import { tierSourceWriteBackend } from '@volter/editor-core/ui-source/tier-source-write-backend';
import type {
  MountedThreeRoot,
  RootAdapter,
  SystemAdapters,
} from '@volter/editor-project/adapter';
import type { GameThreeHostContext } from '@volter/game-runtime/runtime/host-context';
import { nodeKeyedPhysics } from '@volter/editor-project/adapter';
import { declaredRoots, rootById } from '@volter/editor-project/adapter/manifest-interpreter';
import {
  installNativeDebugBindings,
  installNativeSystemsBindings,
  type NativeDebugBinding,
  type NativeSystemsBinding,
  nativeDebugBindingFromEntryModule,
  nativeSystemsBindingFromEntryModule,
} from '@volter/game-runtime/adapter/native-debug-module';
import { createAssetCache } from '@volter/threejs-runtime/assets';
import { createGameLoop } from '@volter/game-runtime/core/game-loop';
import { registerThreeRoot } from '@volter/game-runtime/runtime/create-runtime';
import { createGame, type GameInternal } from '@volter/game-runtime/runtime/game';
import {
  beginProjectMountEpoch,
  viteUpdateImportPath,
} from '@volter/editor-sdk/session/project-module-url';
import * as THREE from 'three';
import { createDesignTimeRenderer } from './design-time-renderer';

/**
 * Which three world is FOCUSED — the project's three root.
 *
 * The `find` is EXACT, not a first-wins pick: a project declares at most one
 * world root per medium, and `GameManifestSchema`'s `roots` `superRefine`
 * rejects a manifest with a second `three` root outright. So there is nothing
 * for this to choose between — it returns the one three root, or `null` when
 * the project has none.
 *
 * Every three root is entry-based, so focus is a property of the manifest
 * alone — nothing about what is currently loaded can move it. It lives HERE,
 * in this integration, because it names a surface: the kit's edit-mode
 * installer asks `active-adapter.ts`'s factory seam by surface instead.
 */
function resolveThreeRootId(
  roots: readonly { readonly id: string; readonly surface: string }[],
): string | null {
  return roots.find((w) => w.surface === 'three')?.id ?? null;
}

import {
  type EditModeRootSpec,
  parseEditModeManifest,
  queueEditModeRebuild,
} from '@volter/editor-core/authoring/edit-mode-authoring';
import { liveGestureActive, whenLiveGestureIdle } from '@volter/editor-sdk/kit/live-gesture-lock';
import {
  addMountFailureReport,
  clearMountFailureReport,
  formatMountFailureMessage,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { SelectionRemountHandoff } from '../../host/authoring/selection-remount-handoff';
import {
  type RefreshSource,
  SourceRefreshRevisions,
} from '../../host/authoring/source-refresh-revisions';
import type { R3fSourceAuthoringAdapter } from './r3f-source-authoring-adapter';
import { isThreeScene } from './three-scene-identity';
import { evictDreiCaches } from '../drei-asset-caches';

// The world root's stage is recreated when the workspace changes.
// The outgoing panel restores the editor scene and the incoming panel loads
// it again before remounting the same R3F world; both operations clear the
// shared EditorShellStore selection. Keep a same-store handoff outside that reset
// path. WeakMap prevents a closed project/store from being retained.
const selectionRemountHandoff = new SelectionRemountHandoff<EditorShellStore>();

/**
 * A three entry that is neither a `RootAdapter` nor a default-exported
 * component used to return `null` from the design session's import, which
 * then `return () => {}` — a blank Scene, `mountFailures: []`, no console
 * error. The coverage warning ("seven editor providers missing") is not
 * loudness. Name the root and the file so the empty viewport says why.
 */
export function unresolvedDesignEntryError(
  worldId: string,
  entry: string,
  exported: readonly string[],
): Error {
  return new Error(
    `three root "${worldId}" failed to mount: ${entry} did not export a RootAdapter or a ` +
      `default React component (exports: ${exported.join(', ') || '(nothing)'}).`,
  );
}

/**
 * The one loudness write for a design-mount failure. `failToBoundary` (and
 * tests) go through this so a blank Scene cannot lose the named report.
 */
export function reportDesignMountFailure(worldId: string, err: unknown): string {
  const message = formatMountFailureMessage(err);
  editorConsole.error(`[r3f-design] world "${worldId}" failed to mount: ${message}`, 'authoring');
  addMountFailureReport({
    worldId,
    kind: 'three',
    identity: 'default-three',
    message,
  });
  return message;
}

/**
 * Load the component Edit mounts and the manifest root's static module surface
 * in one realm epoch. They are frequently the same file; translated players
 * deliberately split them so Edit can open an authored scene without booting
 * the player shell. In that split case, declarations still belong to the root
 * entry and must not be looked up on the scene module.
 */
export async function loadR3FDesignEntryModules(
  realm: Pick<Awaited<ReturnType<typeof activeRealmServices>>, 'loadEntryModule'>,
  worldId: string,
  designEntry: string,
  rootEntry: string,
): Promise<{
  designModule: Record<string, unknown>;
  rootModule: Record<string, unknown>;
}> {
  const designModule = await realm.loadEntryModule(designEntry, worldId, 'three');
  const rootModule =
    rootEntry === designEntry
      ? designModule
      : await realm.loadEntryModule(rootEntry, worldId, 'three');
  return { designModule, rootModule };
}

/** Complete and install one design root's declared observation/system plane. */
export function registerR3FDesignRoot(
  game: GameInternal,
  adapter: RootAdapter,
  mounted: MountedThreeRoot,
  worldId: string,
  entryDebug: NativeDebugBinding | null,
  entrySystems: NativeSystemsBinding | null,
): void {
  registerThreeRoot(game, adapter, mounted, { id: worldId });
  installNativeDebugBindings(game, entryDebug ? [entryDebug] : []);
  installNativeSystemsBindings(game, entrySystems ? [entrySystems] : []);
}

/**
 * The design host borrows the viewport renderer (see the module doc comment).
 *
 * It carries a real `Game` whose loop is NEVER started. Without one, every
 * game-owned service would be missing, and behavior written the idiomatic
 * way — a hook reading the game handle (`useOptionalGame()?.input`) at the
 * top, as the starter's player controller does — would find nothing at
 * design time. The pre-D26 shape hid this by accident: a
 * a component reads `ctx.input` in `useFrame`, and design time never ticks.
 *
 * A Game here is not a shim — it is the real object, just inert: nothing
 * advances the loop, so no frame, physics step or `useFrame` callback ever
 * runs, and design time stays the still scene this session's contract
 * promises. It also gets its OWN debug registry (registries are game-scoped),
 * so design-time providers can't collide with the play game's.
 *
 * Input is explicitly DISABLED: `new InputManager()` binds window-level
 * keyboard/mouse listeners in its constructor, and design time is not play
 * (T6.3's invariant). `dispose()` unbinds them — the caller must call it.
 *
 * Its renderer is `createDesignTimeRenderer`, which isolates Fiber configuration
 * and permits real offscreen work without transferring canvas ownership.
 */
function createDesignHost(renderer: THREE.WebGLRenderer): {
  host: GameThreeHostContext;
  game: GameInternal;
  dispose: () => void;
} {
  const canvas = document.createElement('canvas');
  const borrowedRenderer = createDesignTimeRenderer(canvas, renderer);
  const assets = createAssetCache();
  const game = createGame({ loop: createGameLoop({ update: () => {} }), assets });
  game.input.setEnabled(false);
  return {
    game,
    host: {
      three: THREE,
      surface: { canvas, width: 1280, height: 720 },
      renderer: borrowedRenderer,
      assets,
      headless: false,
      game,
    },
    dispose: () => game.dispose(),
  };
}

function boundaryInfo(world: EditModeRootSpec): BoundaryRootInfo {
  return {
    id: world.id,
    kind: world.surface,
    adapter: world.adapter,
    entryOrScenePath: world.entry ?? world.scene,
    zOrder: world.zOrder ?? 0,
    pausable: world.pausable ?? true,
  };
}

function rebuildWhenPlayStops(store: EditorShellStore): () => void {
  let disposed = false;
  let requested = false;
  const request = () => {
    if (disposed || requested || store.playState !== 'stopped') return;
    requested = true;
    queueEditModeRebuild();
  };
  const unsubscribe = store.subscribe(request);
  request();
  return () => {
    disposed = true;
    unsubscribe();
  };
}

/**
 * Mount the R3F design session for the focused ENTRY-BASED three world (if
 * this project has one and this session can serve it). Returns a disposer.
 * A project whose Three world is a `setup`-export entry no-ops.
 *
 * BROWSER (hosted, no dev server) sessions run this too. Three dev-server
 * dependencies had to be replaced first:
 *   - the entry import was a `/@fs/<abs path>` URL only Vite can serve;
 *   - source write-back posted to `/__ui-source/*` →
 *     the session's recorder reads/writes the same files through
 *     storage, running the SAME `planSourceEdit` the server does;
 *   - the remount trigger was Vite's `vgai:r3f-entry-update` HMR event →
 *     `StorageBackend.watch`, which in a server-less editor reports the
 *     editor's own writes (exactly the signal absorb-by-remount needs).
 * A hosted EXAMPLE (`?project=<id>`) is still excluded: it is opened read-only
 * and has no writable storage root, so there is nothing honest to write back
 * to.
 */
export async function mountR3FDesignSession(
  store: EditorShellStore,
  composite: CompositeAuthoringAdapter,
  renderer: THREE.WebGLRenderer,
): Promise<() => void> {
  const project = getCurrentProject();
  if (!project) return () => {};
  const rawManifest = await fetchRawGameManifest();

  // Mirror design-time-layers' entry guard: while play is already running,
  // mount nothing and wait for Stop's rebuild.
  if (store.playState !== 'stopped') {
    return rebuildWhenPlayStops(store);
  }

  const manifest = parseEditModeManifest(rawManifest);
  if (!manifest) return () => {};
  const threeRootId = resolveThreeRootId(declaredRoots(manifest));
  const world = threeRootId ? rootById(manifest, threeRootId) : undefined;
  if (!world) return () => {};
  // WHAT THIS SESSION MOUNTS, and why it is not always the root's `entry`.
  //
  // Usually the two are the same file: `entry` IS the world component. A root
  // that declares `world` says otherwise — its `entry` mounts the whole GAME
  // (its own composition, HUD and loop), while the named component is the
  // thing an AUTHOR edits. Edit mounts that; Play mounts the game
  // (`ingest/deferred-ingest-play.ts`). Reading the fact here is what makes
  // "a scene is a single root" true without this module knowing anything
  // about WHY a given game has a shell — an ingested game's own App.tsx and a
  // translated Unity port's scene HOST are the two shipped cases, and the
  // second is why the field is not an ingest one: a Unity port's `entry`
  // starts the built player on EditorBuildSettings index 0, which for the FPS
  // microgame is a uGUI menu with three three-surface nodes and not one
  // renderer among them. Edit opened on that and drew nothing at all.
  const designEntry = world.world?.entry ?? world.entry;
  const designExport = world.world?.export;
  if (!designEntry || !/\.(tsx|jsx)$/.test(designEntry)) {
    return () => {};
  }
  // These two independent graphs are the expensive local-development lane:
  // the game's own entry and the editor's full native-Three authoring adapter.
  // Start the latter here and await it beside the entry below. Keeping the
  // adapter as a static import serialized both graphs on a cold browser even
  // though neither depends on the other.
  const sourceAdapterModule = import('./r3f-source-authoring-adapter');
  const writeBackend = tierSourceWriteBackend();

  let torndown = false;
  let suspended = false;
  let mounted: MountedThreeRoot | null = null;
  let adapter: R3fSourceAuthoringAdapter | null = null;
  let sceneAdopted = false;
  let adoptedScene: THREE.Scene | null = null;
  let remountQueued = false;
  // One-shot guard for the transient-failure retry below.
  let remountRetried = false;
  let disposeHot: (() => void) | undefined;
  let disposeDesignHost: (() => void) | undefined;
  let unsubscribeSystemAdapters: (() => void) | undefined;
  let unsubStore: (() => void) | undefined;
  /** The mounted design world's own `Game` — the debug plane's source. */
  let designGame: GameInternal | null = null;
  /** The bag currently registered under the solo seat, or `null` when this
   *  session holds no seat. Doubles as the idempotence flag for the pair
   *  below — see this module's DEBUG PLANE OWNERSHIP note. */
  let publishedSystems: SystemAdapters | null = null;

  const worldId = world.id;
  const entry = designEntry;

  /** Take the solo `setActiveSystems` seat for the edit world. No-op unless a
   *  design world is mounted, this session is live, and play is stopped. */
  const publishPlane = (): void => {
    if (publishedSystems || !designGame) return;
    if (torndown || suspended || store.playState !== 'stopped') return;
    publishedSystems = designGame.systemAdapters;
    setActiveSystems(publishedSystems);
  };

  /** Release it. The ONE teardown path; idempotent. */
  const withdrawPlane = (): void => {
    if (!publishedSystems) return;
    publishedSystems = null;
    setActiveSystems(null);
  };

  const importEntry = async (): Promise<{
    adapter: RootAdapter;
    entryDebug: NativeDebugBinding | null;
    entrySystems: NativeSystemsBinding | null;
    components?: unknown;
  } | null> => {
    // PD-3: a design remount IS a new mount generation, so it opens a new
    // mount epoch — and therefore its own realm value over that epoch. WHERE
    // the entry comes from (dev `/@fs`, or the packaged project graph) is the
    // realm's one answer; this session used to carry its own copy of it.
    const realm = await activeRealmServices(project.rootPath, beginProjectMountEpoch());
    // This whole session is scoped to a THREE root (`resolveThreeRootId`
    // above), so the declared surface is known outright.
    const { designModule: mod, rootModule } = await loadR3FDesignEntryModules(
      realm,
      worldId,
      entry,
      world.entry ?? entry,
    );
    // The manifest root entry owns this root's static debug/system surface,
    // even when Edit mounts a narrower `world.world.entry` scene component.
    // Harvesting the scene namespace silently dropped stable root-level slots
    // (translated Unity physics is one) from the stopped design session.
    const entryDebug = nativeDebugBindingFromEntryModule(worldId, rootModule);
    const entrySystems = nativeSystemsBindingFromEntryModule(worldId, rootModule, 'three');
    // WHAT that module means is `entry-adjudication.ts`'s one answer — the
    // same one play mode and the runtime mount get, which is what keeps design
    // mode from disagreeing with them about a world file. `world.export` names
    // ONE component in a module that exports several (a game's `App.tsx`
    // exporting `Scene` beside `Hud` and `App`); it is handed to the SAME
    // resolver a default export is, and a name the module does not export is a
    // NAMED failure there, never a silent fall-back to `default` (which for
    // such a module would mount the whole game into the Scene view).
    const adapter = await adjudicateThreeEntry(mod, worldId, {
      ...(designExport === undefined ? {} : { namedExport: designExport }),
      entryPath: entry,
    });
    if (!adapter) {
      throw unresolvedDesignEntryError(worldId, entry, Object.keys(mod));
    }
    // A named world component is one component out of its module; the module's
    // OTHER exports are not this world's component table.
    if (designExport !== undefined) return { adapter, entryDebug, entrySystems };
    return {
      adapter,
      entryDebug,
      entrySystems,
      components: mod['components'] ?? mod['behaviors'],
    };
  };

  /**
   * A mounted design world and the host resources that must die WITH it.
   *
   * `mountRoot` hands this back rather than installing it, because a remount
   * mounts the NEW world before tearing the OLD one down: assigning
   * `disposeDesignHost` inside `mountRoot` (what it used to do) meant the
   * teardown that followed disposed the *incoming* Game and leaked the
   * outgoing one's window listeners. `game.dispose()` strips the debug
   * registry, so with the plane published that mis-wiring showed up as a
   * design session that answered nothing after the first source edit.
   * Ownership is `adoptMount`'s, and only after `disposeMounted`.
   */
  interface DesignMount {
    root: MountedThreeRoot;
    game: GameInternal;
    disposeHost: () => void;
  }

  const mountRoot = async (
    adapterExport: RootAdapter,
    entryDebug: NativeDebugBinding | null,
    entrySystems: NativeSystemsBinding | null,
  ): Promise<DesignMount> => {
    const { host, game: hostGame, dispose: disposeHost } = createDesignHost(renderer);
    let result: MountedThreeRoot;
    try {
      result = await adapterExport.mount(host);
    } catch (err) {
      disposeHost();
      throw err;
    }
    if (result.kind !== 'three' || !isThreeScene(result.scene)) {
      result.dispose();
      disposeHost();
      throw new Error(`entry adapter for world "${worldId}" did not mount a three scene`);
    }
    // This is a real Game shell, so its real root registry must own the mount.
    // `game.systemAdapters` intentionally folds only registered roots; leaving
    // the design mount detached stranded every React-effect contribution
    // (Rapier, game debug providers, and future native systems) on
    // `mounted.systems` even though the component registered successfully.
    registerR3FDesignRoot(hostGame, adapterExport, result, worldId, entryDebug, entrySystems);
    return { root: result, game: hostGame, disposeHost };
  };

  /** Install a freshly-mounted design world as THE live one. The previous one
   *  must already be down (`disposeMounted`) — this overwrites its disposer. */
  const adoptMount = (next: DesignMount): void => {
    mounted = next.root;
    designGame = next.game;
    // Physics/debug contributions register from React effects, which may land
    // after adapter.mount() returns. Keep the edit-mode plane and Inspector
    // projection on the Game's CURRENT aggregate just as Play mode does; a
    // one-time `game.systemAdapters` snapshot permanently reported those
    // late contributions as implemented-empty.
    unsubscribeSystemAdapters?.();
    const adoptedGame = next.game;
    unsubscribeSystemAdapters = adoptedGame.subscribeSystemAdapters?.(() => {
      if (designGame !== adoptedGame) return;
      const systems = adoptedGame.systemAdapters;
      if (publishedSystems) {
        publishedSystems = systems;
        updateInstanceSystems(systems);
      }
      store.notifyIngestEdit();
    });
    // The design Game outlives `mount()` (the world holds its ctx) and must go
    // down with the mount, or every HMR remount leaks another window-listener
    // set and another debug registry.
    disposeDesignHost = next.disposeHost;
  };

  const disposeMounted = (): void => {
    // Before anything is disposed: a published bag must never outlive the
    // registry behind it (`game.dispose()` strips it), or a remount would
    // leave the relay reading a dead plane.
    withdrawPlane();
    unsubscribeSystemAdapters?.();
    unsubscribeSystemAdapters = undefined;
    designGame = null;
    try {
      mounted?.dispose();
    } catch (err) {
      editorConsole.error(`[r3f-design] dispose failed: ${err}`, 'authoring');
    }
    mounted = null;
    try {
      disposeDesignHost?.();
    } catch (err) {
      editorConsole.error(`[r3f-design] design host dispose failed: ${err}`, 'authoring');
    }
    disposeDesignHost = undefined;
  };

  const restoreEditorScene = (): void => {
    if (!sceneAdopted) return;
    sceneAdopted = false;
    const scene = adoptedScene;
    adoptedScene = null;
    // Release OUR adoption specifically: at the deferred play hand-off (see
    // the suspend deferral below) play has already adopted the live game
    // scene OVER this one, and a blind exitPlayScene would pop PLAY's frame
    // instead of ours (editor-store.releaseAdoptedScene).
    if (scene) store.releaseAdoptedScene(scene);
    else store.exitPlayScene();
  };

  const suspendForPlay = (): void => {
    suspended = true;
    restoreEditorScene();
    disposeMounted();
    composite.replaceChild(
      worldId,
      new BoundaryAuthoringAdapter(
        store,
        boundaryInfo(world),
        'R3F design session suspended by play mode — Stop restores it.',
      ),
    );
    store.notifyIngestEdit();
  };

  const failToBoundary = (err: unknown): void => {
    const message = reportDesignMountFailure(worldId, err);
    composite.replaceChild(
      worldId,
      new BoundaryAuthoringAdapter(store, boundaryInfo(world), message),
    );
    store.notifyIngestEdit();
  };

  // ---------------------------------------------------------- initial mount
  // Stall watchdog: the import/bundle step can HANG without throwing (realm
  // services, the in-browser bundler, esbuild-wasm's own binary download on a
  // slow network) — and a hang is invisible: the editor chrome runs at full
  // FPS over an empty scene with a clean console. A human sat on exactly that
  // for 2.5 minutes and gave up (runhuman pass 42). Narrate the wait so a
  // stall is a diagnosable report, never silence.
  const stallTimer = setTimeout(() => {
    editorConsole.warn(
      `[r3f-design] world "${worldId}" is still importing after 20s (${entry}). ` +
        'The in-browser compiler or a module download may be stalled on a slow ' +
        'connection — it keeps trying; reload the tab if nothing appears.',
      'authoring',
    );
  }, 20_000);
  try {
    const [loaded, { R3fSourceAuthoringAdapter }, persistence] = await Promise.all([
      importEntry(),
      sourceAdapterModule,
      writeBackend,
    ]);
    clearTimeout(stallTimer);
    if (!loaded) {
      editorConsole.warn(
        `[r3f-design] world "${worldId}" produced no design entry (${entry}) — ` +
          'the scene stays empty. This is a bug worth reporting; reload the tab to retry.',
        'authoring',
      );
      return () => {};
    }
    if (torndown) return () => {};
    // Restart can enter Play while this design import is in flight.
    if (store.playState !== 'stopped') return rebuildWhenPlayStops(store);
    const first = await mountRoot(loaded.adapter, loaded.entryDebug, loaded.entrySystems);
    adoptMount(first);
    if (torndown || store.playState !== 'stopped') {
      disposeMounted();
      return torndown ? () => {} : rebuildWhenPlayStops(store);
    }
    adapter = new R3fSourceAuthoringAdapter(store, first.root.scene, {
      worldId,
      entryPath: entry,
      writeBackend: persistence,
      physics: () => nodeKeyedPhysics(designGame?.systemAdapters.physics),
    });
    composite.replaceChild(worldId, adapter);
    // The hierarchy can become interactive as soon as the composite child is
    // replaced, while this async mount is still completing. Preserve a user
    // selection made in that window across enterPlayScene(), which clears the
    // store selection while adopting the mounted scene. OID-signature ids are
    // stable across the boundary, so only restore ids the new composite owns.
    const selectedIds = selectionRemountHandoff.take(store, store.selectedEntityIds);
    // The world's own colour pipeline travels WITH the adoption: this session
    // mounted it against a renderer that draws nothing, so the declaration has
    // to reach the viewport's renderer through the adoption instead (see
    // `MountedThreeRoot.rendererConfig` and `EditorShellStore.adoptedImageConfig`).
    store.enterPlayScene(first.root.scene, first.root.rendererConfig);
    sceneAdopted = true;
    adoptedScene = first.root.scene;
    // FIRST LOOK. Adoption alone leaves the viewport on its construction-time
    // default pose (`editor-viewport.ts`'s `camera.position.set(10, 10, 10)`
    // looking at the origin), which is a statement about nothing: a
    // world-scale world simply contains that point, and the reader's opening
    // frame is the inside of whatever geometry happens to sit there. Measured
    // on the racing game — the first look, and the doctor's own
    // `01-first-look.png`, came back a flat field of canyon rock, with the
    // live camera still reading exactly (10, 10, 10) -> (0, 0, 0).
    //
    // This is byte-for-byte the ask `ingest/mount-three-ingest-root.ts` makes
    // after ITS adoption, and deliberately so: the answer was already built
    // there. The viewport's auto-frame window seeds from the world's own
    // camera when it has one — gated by `scene-framing.ts`'s
    // `seededViewShowsWorld`, so a camera posed inside geometry is refused
    // rather than adopted — and otherwise (and on refusal) falls back to
    // `frameableContentBounds` framing, which always shows something. The
    // lookup is passed LIVE, never resolved here: a design-mounted tree
    // resolves its `<Suspense>` content after this point, so a camera read
    // once at mount would miss the case this exists for.
    //
    // FIRST mount only, deliberately: `remount()` below re-adopts on every
    // source edit, and re-framing there would yank the reader's camera out
    // from under them on every save. A first look is opened once.
    store.focusOnScene(() => pickGameCamera(null, first.root.scene));
    const alive = selectedIds.filter((id) => composite.hierarchy.node(id) !== null);
    if (alive.length > 0) store.selectMultiple(alive);
    clearMountFailureReport(worldId);
    publishPlane();
    store.notifyIngestEdit();
    editorConsole.log(
      `[r3f-design] world "${worldId}" mounted for design-time authoring (${entry})`,
      'authoring',
    );
  } catch (err) {
    clearTimeout(stallTimer);
    // PD-1: report the failure and FALL THROUGH — a first mount that throws
    // must not kill the session. This used to `return`, which skipped the
    // `vgai:r3f-entry-update` subscription and the play-handoff store
    // subscription installed below, so the world stayed a Boundary
    // ("Unavailable" in the hierarchy) with a stale error report for the rest
    // of the page's life: fixing the source recovered NOTHING, and the only
    // exit was a hard reload of the editor tab. A failed remount already
    // behaved correctly (`failToBoundary` inside `remount`, subscriptions
    // intact) — the asymmetry was the whole defect. `remount` handles the
    // no-adapter-yet state this leaves behind.
    failToBoundary(err);
  }

  /**
   * A SLOW remount says where its time went; a fast one says nothing.
   *
   * An edit's whole cost is these three phases, and until this line existed
   * the only way to attribute them was a human with a stopwatch reporting a
   * single number (runhuman passes 96-99 measured 22-49s that way, and
   * splitting it took offline reconstruction). `import` covers reading the
   * project's sources and bundling them — `browser-transpile.ts` breaks that
   * down further on the same threshold; `mount` is building the new React
   * world; `settle` is waiting for an in-flight gesture and the write pipeline
   * before the swap, which is deliberate and bounded but should be ~0 for an
   * ordinary edit; `adopt` is everything AFTER the swap — disposing the
   * outgoing world, adopting the scene, rebuilding the object map and the
   * notify that re-renders every panel.
   *
   * `adopt` is here because the first version of this line stopped measuring
   * at the swap, so a tester counting 3-5 seconds by hand saw NO line at all
   * (runhuman pass 101): the phases it covered really were under the
   * threshold, and the cost was in the tail it excluded. A partial measurement
   * that reads as "fast" is worse than none.
   *
   * Threshold, not always-on: an edit that already feels instant does not need
   * to narrate itself.
   */
  const reportSlowRemount = (
    id: string,
    startedAt: number,
    importedAt: number,
    mountedAt: number,
    settledAt: number,
  ): void => {
    const total = performance.now() - startedAt;
    if (total < 400) return;
    // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb, same channel as the stall notes above
    console.info(
      `[r3f-design] world "${id}" remounted in ${total.toFixed(0)}ms ` +
        `(import ${(importedAt - startedAt).toFixed(0)}ms, ` +
        `mount ${(mountedAt - importedAt).toFixed(0)}ms, ` +
        `settle ${(settledAt - mountedAt).toFixed(0)}ms, ` +
        `adopt ${(performance.now() - settledAt).toFixed(0)}ms)`,
    );
  };

  // ---------------------------------------------------------------- remount
  const remount = async (): Promise<void> => {
    if (torndown || suspended) return;
    const selectedIds = [...store.selectedEntityIds];
    // Same stall watchdog as the initial mount, per stage: after a crashed
    // mount the NEXT remount was observed to hang silently — no "mounted", no
    // "failed" — leaving the world Unavailable with a clean console.
    const startedAtWriteStamp = writeStamp;
    const historyBusyAtStart = store.projectHistory?.getSnapshot().busy === true;
    let stage: 'importing' | 'mounting' = 'importing';
    const stallTimer = setTimeout(() => {
      editorConsole.warn(
        `[r3f-design] world "${worldId}" remount is still ${stage} after 20s (${entry}) — ` +
          'it keeps trying; reload the tab if nothing appears.',
        'authoring',
      );
    }, 20_000);
    const remountStartedAt = performance.now();
    let importedAt = remountStartedAt;
    let mountedAt = remountStartedAt;
    let settledAt = remountStartedAt;
    try {
      const loaded = await importEntry();
      importedAt = performance.now();
      if (!loaded || torndown || suspended) {
        // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
        console.info(
          `[r3f-design] world "${worldId}" remount abandoned after import (${!loaded ? 'no entry' : torndown ? 'torn down' : 'suspended'})`,
        );
        return;
      }
      stage = 'mounting';
      const next = await mountRoot(loaded.adapter, loaded.entryDebug, loaded.entrySystems);
      mountedAt = performance.now();
      // THE SWAP WAITS FOR THE HAND — AND FOR THE HAND'S WRITE. Adopting a
      // fresh world mid-drag moves the gesture's objects out from under it,
      // and adopting between a release and its write landing snaps the object
      // to PRE-drag source for a beat before the write's own remount corrects
      // it — the "snap back, then it went back to where I released it" every
      // rapid drag showed (runhuman passes 49/54/55). The build above ran in
      // parallel; only the swap holds: first for the gesture, then for the
      // project write pipeline to drain. If anything landed new source since
      // this bundle was read, this mount is STALE — drop it and let the
      // remount those writes queued deliver.
      // SETTLE LOOP: a lock taken in the same task that released the previous
      // one (pointer-up ends the drag lock; the gesture's write-hold begins
      // immediately after) can race a waiter that already resolved — re-check
      // both gates until one pass finds both quiet.
      for (let settle = 0; settle < 50; settle += 1) {
        await whenLiveGestureIdle();
        await whenProjectHistoryIdle();
        if (!liveGestureActive() && store.projectHistory?.getSnapshot().busy !== true) break;
      }
      settledAt = performance.now();
      if (!torndown && !suspended && writeStamp !== startedAtWriteStamp) {
        next.root.dispose();
        next.disposeHost();
        // AND SCHEDULE THE ONE THAT DELIVERS THEM. Dropping the stale mount
        // used to just return, trusting the newer write's own scheduleRemount
        // — and under a burst that trust did not hold: three library drops
        // 0.28s apart produced ONE remount, all three writes reached the file
        // and only the first reached the scene, permanently, with nothing in
        // the console (Opus reproduction, 2026-09-01; at ~1s spacing the last
        // of three was stranded, at ~2.4s all three landed — the window is the
        // bundle+mount time). Convergence is this session's job: whatever the
        // interleaving, the last write gets a mount.
        scheduleRemount();
        return;
      }
      if (torndown || suspended) {
        // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
        console.info(
          `[r3f-design] world "${worldId}" remount abandoned after mount (${torndown ? 'torn down' : 'suspended'})`,
        );
        next.root.dispose();
        next.disposeHost();
        return;
      }
      // READ THE USER'S SELECTION BEFORE THE SWAP. `restoreEditorScene()`
      // releases this session's adoption, and `exitPlayScene` restores the
      // selection snapshot the PREVIOUS adoption pushed — so a click made
      // while this remount ran was already overwritten by the time the
      // mid-remount guard below read the store, and the guard never fired:
      // gizmo-move tree A, click tree B during the 2.5 s remount, and the
      // selection snapped back to A 255 ms after the adopt (Opus
      // reproduction on preview-b53, 2/2 with a non-reverting control; the
      // human typed their Position X into the wrong tree — runhuman pass 128).
      const selectionAtSwap = new Set(store.selectedEntityIds);
      restoreEditorScene();
      // The OUTGOING world goes down first, with its OWN host — then the
      // incoming one is adopted. Reversing these disposes the incoming Game.
      disposeMounted();
      adoptMount(next);
      if (adapter) {
        adapter.adoptScene(next.root.scene);
        // A FAILED remount left a Boundary in the composite (`failToBoundary`);
        // a later successful one adopted the fresh scene into this adapter
        // but never put the adapter back, so the hierarchy read "Unavailable"
        // forever while the world had in fact remounted — what looked like a
        // post-crash hang was this (measured after the crash auto-undo).
        const current = composite
          .childAdapters()
          .find((child) => child.worldId === worldId)?.adapter;
        if (current !== adapter) {
          composite.replaceChild(worldId, adapter);
          editorConsole.log(
            `[r3f-design] world "${worldId}" recovered and remounted for design-time authoring (${entry})`,
            'authoring',
          );
        }
      } else {
        // PD-1 recovery leg: the FIRST mount failed, so the composite still
        // holds this world's Boundary and no source-authoring adapter exists
        // yet. Build it now — otherwise the world would mount invisibly
        // (scene adopted, hierarchy still "Unavailable"), which is the same
        // dead end from the user's side.
        const [{ R3fSourceAuthoringAdapter }, persistence] = await Promise.all([
          sourceAdapterModule,
          writeBackend,
        ]);
        adapter = new R3fSourceAuthoringAdapter(store, next.root.scene, {
          worldId,
          entryPath: entry,
          writeBackend: persistence,
          physics: () => nodeKeyedPhysics(designGame?.systemAdapters.physics),
        });
        composite.replaceChild(worldId, adapter);
        editorConsole.log(
          `[r3f-design] world "${worldId}" recovered and mounted for design-time authoring (${entry})`,
          'authoring',
        );
      }
      // A click landing DURING the remount is the newer intent: restoring the
      // ids captured at write time stomped it — a human coloring box A then
      // clicking box B watched the selection "jump back to the one I just
      // colored" on every color edit (runhuman pass 35). Only restore when
      // the user did not select something else while the remount ran.
      const selectionChangedMidRemount =
        selectionAtSwap.size > 0 &&
        (selectionAtSwap.size !== selectedIds.length ||
          selectedIds.some((id) => !selectionAtSwap.has(id)));
      store.enterPlayScene(next.root.scene, next.root.rendererConfig);
      sceneAdopted = true;
      adoptedScene = next.root.scene;
      // W4e — selection survives: oid-signature ids re-resolve onto the fresh
      // objects (exitPlayScene cleared the store selection; restore it).
      const restoreIds = selectionChangedMidRemount ? [...selectionAtSwap] : selectedIds;
      const alive = restoreIds.filter((id) => adapter?.hierarchy.node(id) !== null);
      if (alive.length > 0) store.selectMultiple(alive);
      // PD-1: this world is mounted again — retract its failure report so the
      // status item (and `vgai status`) can go back to healthy.
      clearMountFailureReport(worldId);
      // The plane follows the FRESH game (`disposeMounted` withdrew the old
      // one's), so a stat added by the edit that triggered this remount is
      // readable without entering play.
      publishPlane();
      store.notifyIngestEdit();
      reportSlowRemount(worldId, remountStartedAt, importedAt, mountedAt, settledAt);
      refreshRevisions.mounted();
      clearTimeout(revisionFallback);
      remountRetried = false;
    } catch (err) {
      failToBoundary(err);
      // ONE automatic retry per failure burst: a read racing a write commit
      // clears within milliseconds, and
      // without this a single unlucky remount stranded the author on an
      // unmounted world until a manual page reload (runhuman passes 19/21).
      // A persistent failure fails again immediately — and if the editor's
      // own edit caused it, that edit is undone (below) rather than left in
      // source, where a reload would fail the same way.
      if (!remountRetried && !torndown && !suspended) {
        remountRetried = true;
        setTimeout(() => {
          if (!torndown && !suspended) scheduleRemount();
        }, 400);
      } else if (!torndown && !suspended) {
        // Only a TRUSTED failure may trigger the auto-undo: one whose bundle
        // was built from settled source (no write landed during the mount,
        // no write in flight when it started). Under a rapid drag burst a
        // half-written module can evaluate and throw INSIDE the fiber — the
        // message says "fiber crashed" but the edit is fine, and undoing it
        // reverted a good drag about one burst in seven (runhuman pass 58).
        // An untrusted failure just remounts again once things settle.
        if (writeStamp === startedAtWriteStamp && !historyBusyAtStart) {
          void undoCrashingEdit(err);
        } else {
          remountRetried = false;
          scheduleRemount();
        }
      }
    } finally {
      clearTimeout(stallTimer);
      // A write that landed while this mount was adopting is not covered by
      // the stale check above (it runs before the adopt): same convergence
      // rule, checked once more on the way out.
      if (!torndown && !suspended && writeStamp !== startedAtWriteStamp) scheduleRemount();
    }
  };

  /** Resolve when the project history (the sha-guarded write pipeline) has no
   *  in-flight work — bounded, so a wedged pipeline degrades to the stale-drop
   *  guard instead of holding the swap forever. */
  const whenProjectHistoryIdle = async (): Promise<void> => {
    const history = store.projectHistory;
    if (!history) return;
    const deadline = Date.now() + 10_000;
    while (history.getSnapshot().busy && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        const unsubscribe = history.subscribe(() => {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        });
      });
    }
  };

  /**
   * A source edit that crashes the world must not stay in source: a human
   * set a grid size the component could not draw, the world failed, and the
   * failure was still there after a reload — nothing they could reach undid
   * it (runhuman pass 48). When the remount fails persistently and the
   * project's newest history entry is seconds old, undo it and say so. The
   * undo is sha-guarded, so a file changed by anything else refuses rather
   * than clobbers; an unrelated failure with no recent edit leaves history
   * alone.
   */
  const undoCrashingEdit = async (err: unknown): Promise<void> => {
    // ONLY a genuine world crash earns an auto-undo: the world's module
    // mounted and its render threw ("fiber crashed"). A bundling/read failure
    // under a rapid write burst is a TRANSIENT (the import raced the next
    // write), and undoing there silently reverted the user's own drag seconds
    // after release — "they move without us doing anything" (runhuman pass
    // 57's multi-select snap-backs were this feature misfiring, not the
    // gesture pipeline). Transients converge on the next scheduled remount.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('fiber crashed')) return;
    // AN ASSET THAT WOULD NOT LOAD IS NOT THE EDIT'S FAULT. A render that
    // threw because a project file came back as HTML or failed to fetch
    // crashed the fiber all the same,
    // and undoing the author's last edit for it reverted every edit of a
    // session while the real cause stayed (runhuman pass 138: the crash at
    // t+0, then "everything reverted on its own"). Name the asset instead;
    // the late-claim path in `storage-served-game-files.ts` remounts.
    if (/Could not load |Failed to fetch|Unexpected token '<'|not valid JSON/.test(message)) {
      editorConsole.error(
        `World "${worldId}" failed to load a project asset (${message}). The edit is kept; ` +
          'the world remounts once the asset can be served.',
        'authoring',
      );
      return;
    }
    const history = store.projectHistory;
    if (!history) return;
    const snapshot = history.getSnapshot();
    const last = snapshot.canUndo ? snapshot.transactions[snapshot.cursor - 1] : undefined;
    if (!last || Date.now() - last.timestamp > 15_000) {
      // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
      console.info(
        `[r3f-design] world "${worldId}" crash auto-undo skipped (${!last ? (snapshot.canUndo ? 'no entry' : `cannot undo: busy=${snapshot.busy} blocked=${snapshot.blocked}`) : 'last edit too old'})`,
      );
      return;
    }
    const undone = await history.undo().catch(() => false);
    if (!undone) {
      // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
      console.info(`[r3f-design] world "${worldId}" crash auto-undo refused by history`);
      return;
    }
    remountRetried = false;
    editorConsole.error(
      `Undid “${last.label}”: that edit crashed world "${worldId}" (${
        err instanceof Error ? err.message : String(err)
      }). The previous source is restored.`,
      'authoring',
    );
    scheduleRemount();
  };

  /** Bumped on every source-change signal; a mount that started before the
   *  latest bump was built from stale bytes. */
  let writeStamp = 0;
  const refreshRevisions = new SourceRefreshRevisions();
  let revisionFallback: ReturnType<typeof setTimeout> | undefined;

  const scheduleRemount = (): void => {
    if (torndown || suspended) {
      // Diagnostic, not noise: a remount request that lands on a torn-down or
      // suspended session is the one state a "world stays Unavailable"
      // report cannot explain from the console otherwise.
      // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
      console.info(
        `[r3f-design] world "${worldId}" remount skipped: ${torndown ? 'session torn down' : 'suspended for play'}`,
      );
      return;
    }
    if (remountQueued) return;
    remountQueued = true;
    // Small debounce: one remount per write burst (a gesture can touch the
    // file more than once in quick succession).
    setTimeout(() => {
      remountQueued = false;
      void remount();
    }, 80);
  };

  const stopAssetReload = onAssetReload((paths) => {
    void evictDreiCaches(paths).then(() => {
      writeStamp += 1;
      scheduleRemount();
    });
  });

  const hot = import.meta.hot;
  if (hot) {
    const onUpdate = (): void => {
      writeStamp += 1;
      scheduleRemount();
    };
    const onSource = (source: RefreshSource): void => refreshRevisions.source(source);
    const onRefreshed = async (event: {
      updates: { acceptedPath: string; timestamp: number; explicitImportRequired?: boolean }[];
    }): Promise<void> => {
      if (torndown || suspended) return;
      const relevant = event.updates.filter((update) => refreshRevisions.matches(update));
      if (!relevant.length) return;
      if (
        !mounted ||
        composite.childAdapters().find((child) => child.worldId === worldId)?.adapter !== adapter
      ) {
        // Fast Refresh cannot adopt a root that failed its initial mount.
        scheduleRemount();
        return;
      }
      const results = await Promise.allSettled(
        relevant.map(
          (update) =>
            import(/* @vite-ignore */ viteUpdateImportPath(update, import.meta.env.BASE_URL)),
        ),
      );
      // Every mounted variant must evaluate. A successful sibling does not
      // acknowledge a failed instance of the same source file.
      if (results.every((result) => result.status === 'fulfilled'))
        refreshRevisions.complete(relevant);
      if (!refreshRevisions.needsRemount()) clearTimeout(revisionFallback);
      // The native adapter observes child additions/removals. Property-only
      // refreshes still need an inspector/viewport notification.
      store.notifyIngestEdit();
    };
    hot.on('vgai:r3f-entry-update', onUpdate);
    hot.on('vgai:r3f-refresh-source', onSource);
    hot.on('vite:afterUpdate', onRefreshed);
    disposeHot = () => {
      hot.off('vgai:r3f-entry-update', onUpdate);
      hot.off('vgai:r3f-refresh-source', onSource);
      hot.off('vite:afterUpdate', onRefreshed);
      clearTimeout(revisionFallback);
    };
  }

  // Collaboration is the reliable fallback when a share tunnel loses Vite's
  // websocket. Suppress only revisions whose exact bytes completed HMR.
  let lastRevision = collaborationSnapshot()?.revision ?? 0;
  const disposeRevisionSub = subscribeCollaborationRevision((revision) => {
    writeStamp += 1;
    const snapshot = collaborationSnapshot();
    const revisions = snapshot?.revisions.filter((r) => r.revision > lastRevision) ?? [];
    if (revisions.length !== revision - lastRevision) refreshRevisions.missing();
    lastRevision = revision;
    const resources = revisions.flatMap((r) => r.resources);
    refreshRevisions.revision(resources);
    if (resources.length && !refreshRevisions.needsRemount()) return;
    // SSE can arrive before or after Vite. Give the matching update a bounded
    // chance to finish; a dropped/disconnected socket retains cold recovery.
    clearTimeout(revisionFallback);
    revisionFallback = setTimeout(() => {
      if (resources.length && !refreshRevisions.needsRemount()) return;
      writeStamp += 1;
      scheduleRemount();
    }, 2_000);
  });

  // ------------------------------------------------------------ play handoff
  let stopRebuildRequested = false;
  let suspendQueued = false;
  unsubStore = store.subscribe(() => {
    if (torndown) return;
    // Seat handover, BEFORE the deferred visual suspend below: play mode
    // registers under its own mount id, so holding both seats would make an
    // unaddressed `vgai eval` ambiguous. This fires at
    // `store.setPlayState('playing')`, which precedes play's own
    // `setActiveSystems` — so the two never overlap in either direction.
    if (store.playState === 'stopped') publishPlane();
    else withdrawPlane();
    if (!suspended && !suspendQueued && store.playState !== 'stopped') {
      // Keep the adopted design scene alive UNDER the play-entry transition.
      // Suspending at the playState flip swapped the viewport back to the
      // placeholder editor scene mid-flight — the whole screen flashed the
      // scene's default clear color until the cross-fade caught up. The
      // transition settling (cross-fade done, or torn down by an early Stop)
      // is the correct hand-off point; the guards re-check state because
      // settle can also mean "play already ended" — in that case the design
      // session simply stays live, no suspend/rebuild churn at all.
      suspendQueued = true;
      onPlayTransitionSettled(() => {
        suspendQueued = false;
        if (torndown || suspended || store.playState === 'stopped') return;
        suspendForPlay();
      });
      return;
    }
    if (suspended && !stopRebuildRequested && store.playState === 'stopped') {
      stopRebuildRequested = true;
      queueEditModeRebuild();
    }
  });

  return () => {
    torndown = true;
    // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb for a silent-stall report
    console.info(`[r3f-design] world "${worldId}" design session torn down`);
    withdrawPlane();
    disposeHot?.();
    stopAssetReload();
    disposeRevisionSub();
    clearTimeout(revisionFallback);
    unsubStore?.();
    // Normal design-session replacement (including Classic/Glass composition
    // changes) should preserve editor-global selection. Play suspension is a
    // different scene lifecycle and deliberately keeps exitPlayScene's normal
    // clearing semantics.
    if (!suspended && store.playState === 'stopped' && store.selectedEntityIds.size > 0) {
      selectionRemountHandoff.remember(store, store.selectedEntityIds);
    }
    restoreEditorScene();
    disposeMounted();
  };
}
