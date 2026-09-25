/**
 * Composite sibling mounts — D-V2/D-V3/D-V4/D-V7 (residual), extended by D-B1/
 * D-B3 (Slice B): when a manifest declares exactly
 * one `{ ingest }` world alongside OTHER roots ("siblings"),
 * `ingest/mount-ingest-root.ts`'s composite routes mount the ingest world through their
 * existing enter path and then call {@link mountIngestSiblings} here to mount
 * every OTHER world in manifest order (already z-sorted by the loader),
 * degrading loudly per world rather than silently ignoring them (the F24/F9
 * anti-pattern this closes):
 *
 *  - a builtin `dom` world — a bare (no `<WorldProvider>`) DOM layer, D-V3.
 *    There is no native `Game` beside an ingest world, so wrapping one would
 *    fabricate first-party data (anti-shim) — the sibling's own `useWorldState`/
 *    `useGame` calls are simply unavailable, and this says so once per world.
 *    Has no loop at all, so its `SiblingMount.setPaused` stays `undefined`
 *    (D-B1) — never a fabricated no-op.
 *  - `{ module }` (any kind) OR a builtin `three`/`canvas` world
 *  (D-B3 — the residual this closes: a second `{ ingest }` world is
 *    structurally unreachable here, D-V2 already fails the whole route
 *    before any sibling loop runs, so `resolveAllRoots`'s one-element call
 *    below never hits its `MULTI_WORLD_ALLOWED_IDENTITIES` guard, which only
 *    applies for `roots.length > 1`) — a SCOPED single-world runtime, D-V4:
 *    the exact resolve+mount `module-mode.ts`'s `mountModuleRootRuntime`
 *    proves out, reused via `mountModuleRootRuntime`, but with NONE of that
 *    route's global side effects (no `setActiveAuthoring`/`setActiveSystems`,
 *    no viewport-tab switch, no `__vgaiModule` hook, no play-surface writes).
 *    Its `SiblingMount.setPaused` (D-B1) is wired straight from the scoped
 *    `GameSession.pause()`/`.resume()` `mountModuleRootRuntime` hands back —
 *    the SAME honest, already-existing capability `play-mode.ts`'s own
 *    `pausePlayMode`/`resumePlayMode` call on the PRIMARY route's session
 *    (`create-runtime.ts`'s `Game.play.pause()`/`.resume()`, gated per
 *    `pausable` world) — never a fabricated pause.
 *  - anything else — `rejectUnmountableSibling`'s named, loud non-goal for a
 *    genuinely unroutable shape (there is none known today; every currently
 *    resolvable identity is handled above): a per-world mount-failure entry,
 *    never silence.
 *
 * A failing sibling NEVER unmounts the ingest world: each failure is caught
 * individually and appended to the (D-V5) multi-entry mount-failure report;
 * the loop continues to the next sibling. Every successfully-mounted
 * sibling's handle is returned so `ingest/mount-ingest-root.ts` can store it on the
 * unified `_active` slot, dispose it (reverse order) on exit, and fan pause/
 * resume out to it (D-B2, `getIngestPlayControl()`).
 */

import {
  addMountFailureReport,
  formatMountFailureMessage,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { withStoreSelection } from '../host/authoring/mounted-authoring';
import { makeNoAuthoringAdapter } from '@volter/editor-core/authoring/no-authoring-adapter';
import { PixiAuthoringAdapter } from '../host/authoring/pixi-authoring-adapter';
import { createLiveCanvasWriteTarget } from '../host/authoring/pixi-live-write-target';
import { resolveCanvasPixiForEditor } from '../host/canvas-entry-runtime';
import { CrashNullBoundary } from '@volter/editor-sdk/kit/crash-null-boundary';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { authoringJournal } from '../host/history/json-history-resource';
import { activeRealmServices } from '../host/realm-services';
import { resolveReactAdapterRootComponent } from '../host/roots/react-root';
import { sourceWriteBackendIfPrimed } from '@volter/editor-core/ui-source/tier-source-write-backend';
import { DomAuthoringAdapter } from '../react/dom-authoring-adapter';
import { ReactRootAuthoringAdapter, walkOidTree } from '../react/react-world-authoring-adapter';
import { beginProjectMountEpoch } from '@volter/editor-sdk/session/project-module-url';
import { createPhysics2DRegistry } from '@volter/game-runtime/pixi/physics-registry';
import { createPhysicsAdapter2D } from '@volter/game-runtime/pixi/system-adapters';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { ResolvedAdapterRoot, ResolvedGameManifest } from '@volter/editor-project/manifest/load';
import { structuralThree } from '../three/authoring/three-authoring-adapter';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { mountModuleRootRuntime } from './module-mode';

/** One mounted sibling world's handle — stored on `ingest/active-ingest.ts`'s unified
 *  `_active` slot and disposed (reverse order) by `exitActiveIngest()`. */
export interface SiblingMount {
  readonly worldId: string;
  /**
   * D-B1 (Slice B): an OPTIONAL, honest pause capability — present only when
   * this sibling's own mounted session exposes a REAL pause (today: every
   * `mountScopedRuntimeSibling` kind, via its scoped
   * `GameSession.pause()`/`.resume()`). Absent (never a fake no-op) for a
   * kind with no loop to gate at all — the bare `default-react` sibling.
   * `getIngestPlayControl()` (`ingest/mount-ingest-root.ts`, D-B2) calls this
   * `?.`-optionally after its own primary-surface call, mirroring the
   * reverse-order dispose fan-out below.
   */
  setPaused?(paused: boolean): void;
  /**
   * An OPTIONAL, HONEST authoring surface for this sibling — present iff `store`
   * was supplied to {@link mountIngestSiblings} (every production caller
   * supplies one; the parameter stays optional only so the one pre-existing test
   * that calls this module directly without a store keeps compiling/running
   * unchanged). When present, it is NEVER a fabricated stand-in:
   *  - a scoped-runtime sibling (`{ module }`, or a builtin
   *    `three`/`canvas` world) gets its OWN mounted
   *    `AuthoringAdapter` (`mounted.authoring`), store-selection-wrapped
   *    (`withStoreSelection`) — or, when it exposes none, the SAME named
   *    no-authoring floor the primary module route uses
   *    (`makeNoAuthoringAdapter`), so the world still appears in the hierarchy
   *    as a group with its honest label, never silently omitted.
   *  - a bare `default-react` sibling gets a {@link ReactRootAuthoringAdapter}
   *    over its own layer DOM root — an un-instrumented entry (no
   *    `data-oid`) yields an EMPTY subtree under its group node, never
   *    fabricated nodes.
   * `ingest/mount-ingest-root.ts`'s composite routes promote to a `CompositeAuthoringAdapter`
   * over the primary + every sibling's `authoring` once any sibling mounts
   * (D-E2); a `SiblingMount` with no `authoring` (store omitted) simply
   * cannot participate in that promotion.
   */
  readonly authoring?: AuthoringAdapter;
  dispose(): void;
}

/** Position/size/z-order every sibling layer shares — same absolute-fill
 *  convention `create-runtime.ts`'s own react-world DOM layer uses
 *  (`mountOneReactRoot`), so a sibling stacks exactly like a native world
 *  would have. `pointerEvents` differs per sibling kind below (module roots
 *  own real canvases that need real hit-testing; the react sibling's layer
 *  stays `none` by the same HUD-overlay convention `mountOneReactRoot` uses,
 *  its rendered content opts back in per-element). */
function styleSiblingLayer(
  layer: HTMLElement,
  world: ResolvedAdapterRoot,
  pointerEvents: string,
): void {
  layer.style.position = 'absolute';
  layer.style.top = '0';
  layer.style.left = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.zIndex = String(world.zOrder ?? 0);
  layer.style.pointerEvents = pointerEvents;
}

/**
 * D-V3: mount a `default-react` sibling as a bare DOM layer — no
 * `<WorldProvider>` wrap (anti-shim: there is no native `Game` to hand it).
 * Reuses `binding-resolver.ts`'s exact entry-loading step
 * (`resolveReactAdapterRootComponent` — the same D4 `scene`-forbidden/
 * `entry`-required checks and default-export validation
 * `resolveDefaultReactAdapter` itself uses) rather than duplicating it.
 *
 * If the entry component throws at mount/first render (most commonly: it
 * calls `useGame`/`useWorldState` with no provider in the tree), the error
 * boundary above catches it, this function removes the layer it just
 * created, and RETHROWS so the caller's uniform per-sibling catch
 * (`mountOneIngestSibling`'s caller, {@link mountIngestSiblings}) can turn it
 * into a named mount-failure-report entry for THIS world, exactly like any
 * other sibling failure — the ingest world stays mounted regardless.
 */
async function mountDefaultReactSibling(
  world: ResolvedAdapterRoot,
  gameContainer: HTMLElement,
  projectRoot: string,
  store: EditorShellStore | undefined,
): Promise<SiblingMount> {
  // A sibling react layer is mounted on its own, outside a composition
  // resolve, so it opens its OWN mount epoch — it shares no project module
  // graph with anything else by construction.
  const realm = await activeRealmServices(projectRoot, beginProjectMountEpoch());
  const Entry = await resolveReactAdapterRootComponent(world, realm);

  const layer = document.createElement('div');
  layer.dataset['vgaiRootSurface'] = 'true';
  styleSiblingLayer(layer, world, 'none');
  gameContainer.appendChild(layer);

  // D-V3: one structured note per world naming the degrade — never silent
  // about the missing bridge.
  editorConsole.log(
    `react sibling "${world.id}": no native Game beside an ingest world — useWorldState unavailable`,
    'ingest',
  );

  const root = createRoot(layer);
  let caught: unknown = null;
  // `flushSync` forces the initial mount (render + commit + error-boundary
  // recovery, if the entry throws) to complete SYNCHRONOUSLY, so `caught` is
  // reliably populated by the time this call returns — react-dom's default
  // scheduler does not guarantee that for a bare `root.render()` call (a
  // production API, not a test-only affordance: this host needs the throw/
  // no-throw outcome immediately, to decide whether to keep the layer or
  // tear it down and report a named failure).
  flushSync(() => {
    root.render(
      createElement(
        CrashNullBoundary,
        {
          onCaught: (error: unknown) => {
            caught = error;
          },
        },
        createElement(Entry),
      ),
    );
  });

  if (caught !== null) {
    root.unmount();
    layer.remove();
    throw caught instanceof Error ? caught : new Error(String(caught));
  }

  // Once mounted, probe the REAL committed layer with `walkOidTree` — a
  // partially-stamped tree counts as stamped (the walk's transparent-skip
  // contract already handles instrumentation gaps), so this is a single "any
  // node at all?" check, not a completeness one. A non-empty tree keeps the
  // exact D-E1 construction below (a STAMPED first-party entry — the
  // sanctioned JSX write-back seam). A genuinely EMPTY tree (no `data-oid`
  // reachable at all — e.g. an ingest-REACT sibling swept into the D-Y4
  // foreign-game exclusion, or an entry that rendered nothing yet) falls back
  // to `DomAuthoringAdapter`: a LIVE-ONLY surface over the live DOM, no
  // `SourceWriteBackend` of any kind — never a write seam over source the
  // stamping pipeline declined to instrument. Only computed when a store was
  // supplied (see `SiblingMount.authoring`'s doc comment) — never fabricated.
  let authoring: ReactRootAuthoringAdapter | DomAuthoringAdapter | undefined;
  if (store) {
    const stamped = walkOidTree(layer).nodes.size > 0;
    if (stamped) {
      // D-E1: the exact play-mode react-branch construction (`play-mode.ts`
      // `installMultiRootAuthoring` :341-347) over THIS sibling's own layer
      // DOM root — no `<WorldProvider>`/`DomHostContext` required. Whether the
      // recorder exists is what the HOST serves, never how the editor shell was
      // built — `ui-source/tier-source-write-backend.ts`, and the packaged-
      // editor bug the old `import.meta.env.DEV` gate carried here.
      const writeBackend = sourceWriteBackendIfPrimed('An ingest sibling’s react layer');
      authoring = new ReactRootAuthoringAdapter(layer, store, {
        ...(writeBackend ? { writeBackend } : {}),
      });
    } else {
      authoring = new DomAuthoringAdapter(layer, store, {
        journal: authoringJournal(world.id),
      });
    }
  }

  return {
    worldId: world.id,
    ...(authoring ? { authoring } : {}),
    dispose(): void {
      root.unmount();
      layer.remove();
    },
  };
}

/**
 * D-V4/D-B3: mount a `{ module }` sibling (any kind) OR a native
 * builtin `three`/`canvas` sibling through the SCOPED single-world
 * runtime `module-mode.ts`'s `mountModuleRootRuntime` provides — the exact
 * resolve+mount the primary module route performs, reused here with none
 * of that route's global side effects: no `setActiveAuthoring`/
 * `setActiveSystems`, no viewport-tab switch, no `__vgaiModule` hook, no
 * mount-failure-report clear. Mounts into its OWN layer div (never straight
 * into the shared `gameContainer` the way the primary/single-world routes
 * do) so its internal canvas/DOM stacking never collides with the ingest
 * world's own canvas/DOM layer already in that container.
 *
 * `mountModuleRootRuntime` is kind-agnostic BY CONSTRUCTION here, not just
 * for `{ module }` adapters: it calls `resolveAllRoots` with a ONE-element
 * `roots` array, and `resolveAllRoots`'s `MULTI_WORLD_ALLOWED_IDENTITIES`
 * scope guard only fires for `roots.length > 1` — so `resolveRootBinding`'s
 * full identity switch (including `three`/`canvas`) is reached
 * directly, unmodified, with the guard never consulted (D-B3's ground-truth
 * finding; `MULTI_WORLD_ALLOWED_IDENTITIES` itself stays byte-identical).
 *
 * D-B1: the returned `SiblingMount.setPaused` calls the scoped
 * `GameSession.pause()`/`.resume()` `mountModuleRootRuntime` hands back —
 * the SAME honest, already-existing capability `play-mode.ts`'s own
 * `pausePlayMode`/`resumePlayMode` call on the PRIMARY route's session
 * (`create-runtime.ts`'s `Game.play.pause()`/`.resume()`, gated per
 * `pausable` world within this scoped, single-world `Game`) — never a
 * fabricated no-op.
 *
 * D-G1 (closing the residual this doc comment used to name): the
 * mounted world's authoring surface converges with play-mode's own
 * multi-world construction (`play-mode.ts`'s `installMultiRootAuthoring`,
 * verbatim per branch):
 *  1. `mounted.authoring` present (a `{ module }` adapter that ships its own
 *     surface, with its own persistence if any) — kept byte-for-byte,
 *     store-selection-wrapped, exactly as before this slice. NEVER wrapped
 *     in an editor-owned adapter: the module's own choice wins.
 *  2. Else `worldInstance.kind === 'three'` (a native `default-three`
 *     sibling, or a `{ module }` sibling that mounted a three world with no
 *     authoring of its own) — a real three authoring adapter over
 *     `worldInstance.threeScene()` with structural identity and creation-site
 *     persistence (`structuralThree`), whose edits are LIVE-ONLY unless
 *     every consent gate is open.
 *  3. Else `kind === 'canvas'` — the canvas analog through
 *     `PixiAuthoringAdapter`, physics wired via
 *     `createPhysicsAdapter2D(worldInstance.physics2d ??
 *     createPhysics2DRegistry())` exactly like play-mode's own branch.
 *  4. Else (no mounted.authoring, not a first-party-authorable kind) — the
 *     named `makeNoAuthoringAdapter` floor, unchanged.
 * D-G3: `composite-authoring-adapter.ts`'s persistence routing (OR-dirty,
 * per-child save, `' + '`-joined destinations) needs NO changes — it keys on
 * `capabilities.persist`, and a live-only child simply never joins that set.
 */
async function mountScopedRuntimeSibling(
  manifest: ResolvedGameManifest,
  world: ResolvedAdapterRoot,
  gameContainer: HTMLElement,
  projectRoot: string,
  store: EditorShellStore | undefined,
): Promise<SiblingMount> {
  const layer = document.createElement('div');
  styleSiblingLayer(layer, world, 'auto');
  gameContainer.appendChild(layer);

  try {
    const w = gameContainer.clientWidth || 800;
    const h = gameContainer.clientHeight || 600;
    const { session } = await mountModuleRootRuntime(manifest, world, projectRoot, layer, w, h);
    // D-G1: `session.game.roots[0]` is the SAME `RootInstance` shape
    // play-mode iterates (`kind`, `threeScene()`, `canvasRoot()`, `physics2d`) —
    // a single-element `resolveAllRoots` call always registers exactly one.
    const worldInstance = session.game.roots[0]!;
    const mountedAuthoring = worldInstance.mounted.authoring;
    let authoring: AuthoringAdapter | undefined;
    if (store) {
      if (mountedAuthoring) {
        // D-E1 (byte-stable): the module's own surface (and its own
        // persistence, if any) wins — never wrap an editor-owned adapter
        // around it.
        authoring = withStoreSelection(mountedAuthoring, store);
      } else if (worldInstance.kind === 'three') {
        // `frameControl: 'host'` from this mount's own tick-ownership fact:
        // the sibling's scoped `GameSession` drives the frame and this
        // adapter is handed no `loop` handle that could stop it, so a
        // mid-session gizmo edit must refuse rather than be overwritten on
        // the next frame (omitting it fails OPEN — see
        // `ThreeAuthoringOptions.frameControl`). The session's own
        // `pause()`/`resume()` is deliberately NOT wired in as `loop`: it is
        // gated per-world by `pausable`, so a `pausable: false` sibling would
        // silently be back to the same overwritten edit.
        authoring = structuralThree(store, worldInstance.threeScene(), {
          frameControl: 'host',
          journal: authoringJournal(world.id),
        });
      } else if (worldInstance.kind === 'canvas') {
        if (
          worldInstance.mounted.kind !== 'canvas' ||
          worldInstance.mounted.substrate.name !== 'pixi'
        ) {
          authoring =
            worldInstance.mounted.authoring ??
            makeNoAuthoringAdapter(
              store.shell,
              `${world.id} (${worldInstance.mounted.kind === 'canvas' ? worldInstance.mounted.substrate.name : 'unknown'} authoring unavailable)`,
            );
        } else {
          const physics = createPhysicsAdapter2D(
            worldInstance.physics2d ?? createPhysics2DRegistry(),
          );
          authoring = new PixiAuthoringAdapter(worldInstance.canvasRoot(), store, {
            // A module root's own source mounts this stage, so it is the
            // project graph's under the packaged runtime — see
            // `../vite-plugin-module-doorways.ts`.
            pixi: await resolveCanvasPixiForEditor(),
            target: createLiveCanvasWriteTarget({ physics }),
            journal: authoringJournal(world.id),
            // The sibling's own layer IS its surface: `mountModuleRootRuntime`
            // creates this world's canvas inside it, filling it exactly.
            surface: () => layer,
          });
        }
      } else {
        authoring = makeNoAuthoringAdapter(store.shell, `${world.id} (no authoring surface)`);
      }
    }
    return {
      worldId: world.id,
      ...(authoring ? { authoring } : {}),
      setPaused(paused: boolean): void {
        if (paused) session.pause();
        else session.resume();
      },
      dispose(): void {
        session.stop();
        layer.remove();
      },
    };
  } catch (err) {
    layer.remove();
    throw err;
  }
}

/**
 * D-V7 (updated by D-B3): a sibling reaching here is neither a builtin `dom`
 * world nor routable through the scoped runtime above (`{ module }` of any
 * kind, or a builtin `three`/`canvas` world) — a genuinely unroutable shape.
 * No such shape is known to exist today (every currently-resolvable adapter
 * identity is handled above); this is a named, loud non-goal for a
 * hypothetical future one, never silently ignored (the F24 anti-pattern) and
 * never half-mounted. (A second `{ ingest }` world is structurally
 * unreachable here — D-V2's route-level guard already fails the whole
 * composite before any sibling loop runs.)
 */
function rejectUnmountableSibling(world: ResolvedAdapterRoot): never {
  throw new Error(
    `sibling world "${world.id}" (kind: ${world.surface}, adapter identity: ` +
      `"${world.adapter.identity}") has no known composite-sibling mount path — every ` +
      'currently-resolvable identity (three/canvas/dom/module) is ' +
      'routed above; this is reached only for a genuinely unroutable shape.',
  );
}

/** Which mount shape a sibling world takes, by adapter identity alone.
 *
 *  Split out of {@link mountOneIngestSibling} so the routing TRUTH is
 *  checkable without mounting anything: the builtin `canvas` identity used to
 *  fall through to {@link rejectUnmountableSibling} while this module's own
 *  doc comment and that function's thrown message both named it as routed.
 *  There was no mechanism gap behind that — `mountScopedRuntimeSibling` calls
 *  `resolveAllRoots` with a ONE-element array, so `resolveRootBinding`'s full
 *  identity switch (including `canvas`) is reached unmodified, and the mount's
 *  own authoring branch already had a `kind === 'canvas'` case waiting for a
 *  world that could never arrive.
 *
 *  `null` ⇒ genuinely unroutable (the caller rejects loudly). */
export function siblingMountRoute(
  world: ResolvedAdapterRoot,
): 'scoped-runtime' | 'react-layer' | null {
  if (world.adapter.type === 'module') return 'scoped-runtime';
  if (world.adapter.identity === 'three' || world.adapter.identity === 'canvas') {
    return 'scoped-runtime';
  }
  if (world.adapter.identity === 'dom') return 'react-layer';
  return null;
}

async function mountOneIngestSibling(
  manifest: ResolvedGameManifest,
  world: ResolvedAdapterRoot,
  gameContainer: HTMLElement,
  projectRoot: string,
  store: EditorShellStore | undefined,
): Promise<SiblingMount> {
  switch (siblingMountRoute(world)) {
    case 'scoped-runtime':
      return mountScopedRuntimeSibling(manifest, world, gameContainer, projectRoot, store);
    case 'react-layer':
      return mountDefaultReactSibling(world, gameContainer, projectRoot, store);
    default:
      rejectUnmountableSibling(world);
  }
}

/**
 * D-V2: mount every world in `manifest.roots` OTHER than the primary ingest
 * world (`ingestRootId`), in manifest order (already z-sorted by the
 * loader). A failing sibling never unmounts the ingest world or stops the
 * loop — it is caught, reported (D-V5's multi-entry mount-failure report,
 * deduped by worldId), and the loop continues to the next sibling.
 */
export async function mountIngestSiblings(
  manifest: ResolvedGameManifest,
  ingestRootId: string,
  gameContainer: HTMLElement,
  projectRoot: string,
  // D-E1: optional ONLY so the one pre-existing direct caller
  // (`ingest-composite-sibling-pause.test.ts`, which never inspects
  // `SiblingMount.authoring`) keeps compiling/running unchanged — every
  // production caller (`ingest/mount-ingest-root.ts`'s composite routes) supplies one.
  store?: EditorShellStore,
): Promise<SiblingMount[]> {
  const mounted: SiblingMount[] = [];
  for (const world of declaredRoots(manifest)) {
    if (world.id === ingestRootId) continue;
    try {
      mounted.push(await mountOneIngestSibling(manifest, world, gameContainer, projectRoot, store));
    } catch (err) {
      editorConsole.error(`Composite sibling "${world.id}" failed to mount: ${err}`, 'ingest');
      addMountFailureReport({
        worldId: world.id,
        kind: world.surface,
        identity: world.adapter.identity,
        message: formatMountFailureMessage(err),
      });
    }
  }
  return mounted;
}
