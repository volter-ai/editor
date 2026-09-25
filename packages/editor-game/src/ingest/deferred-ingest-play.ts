/**
 * The play-time half of an ingest root that declares a design-time world
 * (the root's `world` — see the manifest schema's own description).
 *
 * WHAT THIS EXISTS FOR. An ingest root used to mount at BOOT and stay mounted:
 * the running game WAS the edit surface, so the Scene view showed the game's
 * mount surfaces (a `Canvas` root with a nested `DOM UI` document) as its
 * hierarchy roots, and whatever the game animated animated there. A scene is a
 * single root by definition (owner, 2026-08-15) and Edit ≠ Play
 * (ARCHITECTURE-CORE: LOADING CONSTRUCTS, PLAY RUNS), so for a root that names
 * its own world component the two mounts split:
 *
 *   EDIT — isolation documents (or `r3f-design-session.ts` for a named world
 *          component) mount each piece ALONE. Nothing ticks.
 *   PLAY — this module mounts the WHOLE GAME through the ordinary ingest
 *          routes (`mount-ingest-root.ts`), byte-for-byte the mount that used
 *          to happen at boot: its own entry, its own contract shim, its own
 *          composition, HUD, physics and loop. Stop tears it down and asks for
 *          one edit-mode rebuild, which recreates the design session.
 *
 * A root that declares neither a world component nor isolation-document
 * scene tabs is untouched by all of this: it mounts at boot exactly as
 * before, and {@link ingestMountIsDeferredToPlay} answers `false` for it.
 *
 * RESOURCE OWNERSHIP. The ingest SESSION is owned by `active-ingest.ts`, as it
 * always was, and the one teardown path allowed to end it stays
 * `exitActiveIngest()`. This module owns nothing but the decision of WHEN the
 * existing mount runs; `_claimedPlay` below is a latch over that decision, so
 * Stop only tears down a session THIS module started (an ordinary boot-time
 * ingest keeps its own lifecycle).
 */

import { activateLiveDocument } from '@volter/editor-sdk/kit/live-document';
import { commandLine } from '@volter/editor-sdk/kit/product-command';
import { queueEditModeRebuild } from '@volter/editor-core/authoring/edit-mode-authoring';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { fetchGameManifest } from '@volter/editor-core/manifest-project';
import {
  type ProjectAdapterFacet,
  projectAdapterFacet,
  subscribeProjectAdapter,
} from '@volter/editor-core/project-adapter';
import { sceneTabRow } from '@volter/editor-core/scene-document-plan';
import { ingestRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import { activeIngest } from './active-ingest';
import {
  beginDeferredIngestPlaySession,
  deferredIngestPlayActive,
  endDeferredIngestPlaySession,
} from './deferred-ingest-session';
import { getIngestPlayControl } from './ingest-play-control';
import { exitActiveIngest } from './unmount-ingest-root';

export { deferredIngestPlayActive };

/**
 * Does Edit already own pieces for this ingest root, so the live game must
 * wait for Play?
 *
 * Two declarations, same answer:
 *  - the root's `world` — a named design-time world component;
 *  - isolation-document rows on the adapter scene table — per-piece Edit
 *    tabs (bubbo Title / Game / Result).
 *
 * Either one means Edit mounts constructs, not the running game
 * (ARCHITECTURE-CORE: LOADING CONSTRUCTS, PLAY RUNS). A self-booting
 * ingest with neither still mounts at boot — that is the degenerate
 * "smallest piece is the whole game" case.
 *
 */
export async function ingestMountIsDeferredToPlay(): Promise<boolean> {
  const manifest = await fetchGameManifest().catch(() => null);
  if (!manifest) return false;
  const declared = ingestRoots(manifest);
  // Exactly one: a manifest declaring two ingest roots is already a named
  // failure in `mount-ingest-root.ts`, and that error must keep being the one
  // the user sees rather than being pre-empted by a silent deferral here.
  if (declared.length !== 1) return false;
  if (declared[0]!.world !== undefined) return true;
  const facet = await adapterFacetWhenReady();
  return isolationDocumentsDeclared(facet);
}

/** How long boot waits for the adapter facet before deciding it has none. */
const FACET_WAIT_MS = 4000;

/**
 * The scene table is published asynchronously (`startProjectAdapterLoad`).
 * Boot must wait for that publish — a miss here is how isolation tabs exist
 * AND the live game still mounts underneath them.
 */
function adapterFacetWhenReady(): Promise<ProjectAdapterFacet | null> {
  const existing = projectAdapterFacet();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(projectAdapterFacet());
    }, FACET_WAIT_MS);
    const unsub = subscribeProjectAdapter(() => {
      const facet = projectAdapterFacet();
      if (!facet) return;
      clearTimeout(timer);
      unsub();
      resolve(facet);
    });
  });
}

function isolationDocumentsDeclared(facet: ProjectAdapterFacet | null): boolean {
  if (!facet) return false;
  return sceneTabRow(facet.scenes).some((row) => row.plan.kind === 'isolation-document');
}

/**
 * Does the live ingest session belong to a PLAY RUN this module started?
 *
 * Two surfaces ask, and both ask it about the same thing — whether ⏹ means
 * anything here. An ingest that mounted at boot IS the editor's open document,
 * so "stop" can only honestly mean "pause its loop" (`ingest-play-commands.ts`
 * says exactly that, and the PlayBar's ingest toolbar offers no Stop). A
 * deferred run inverts that premise: Play constructed it, so Stop ends it and
 * hands the surface back to the design-time Scene.
 */
/**
 * Play's mount for a deferred ingest root: run the ordinary ingest routes,
 * then start the game through its own play control (the same ▶ the PlayBar
 * drives for a boot-mounted ingest — contract-first `lifecycle.start`, else
 * the wire event, plus the loop gate).
 *
 * Returns `false` when this project has no deferred ingest root, which is the
 * signal for `play-mode.ts` to continue into its ordinary first-party boot.
 */
export async function mountDeferredIngestForPlay(store: EditorShellStore): Promise<boolean> {
  if (!(await ingestMountIsDeferredToPlay())) return false;
  // Edit isolation and the live game share the browser's Pixi module realm.
  // Isolation may therefore have initialized the singleton Assets manager,
  // while the untouched game quite correctly initializes it at boot. Reset at
  // the explicit realm-ownership boundary: live Play now owns the manager and
  // loads its own manifest without a duplicate-init warning. Existing Edit
  // display objects retain their texture objects while hidden; Stop rebuilds
  // the Edit presentation through the ordinary path below.
  //
  // ON THIS SURFACE'S OWN NAMESPACE (`../vite-plugin-module-doorways.ts`): the
  // manager being reset is a MODULE-GLOBAL of one `pixi.js` instance, so a
  // reset on the wrong instance resets nothing at all — the same shape as
  // `owned-pixi-ticker-listeners.ts`'s `Ticker.shared`. Under the packaged
  // runtime both halves of the sentence above live in the PROJECT's graph:
  // `mount-isolated-pixi-screen.ts` initializes assets through the game's own
  // module (`authoring/pixi-isolation-assets.ts` calls the game's
  // `initialize`), and the game's boot does too. A static `pixi.js` here is
  // the shell's third instance, which neither of them ever touched.
  const manifest = await fetchGameManifest().catch(() => null);
  const deferredCanvasRoot = manifest
    ? ingestRoots(manifest).some((root) => root.adapter.surface === 'canvas')
    : false;
  // …but ONLY when no full game boot owns the realm yet. When a held ingest
  // session is live (a creation-site write materializes one — the write needs
  // the live object), the shared singletons hold THE GAME'S OWN warm state,
  // and this reset tears exactly half of it: the Assets cache empties while
  // sibling registries the same boot populated (`@pixi/sound`'s alias table)
  // stay full. The next boot then re-loads every bundle into duplicate-alias
  // asserts, the load breaks partway, and the game never renders a frame —
  // measured on bubbo-bubbo (2026-08-21): every ▶ after an authoring write
  // died in the 30s capture timeout this way. A warm second boot instead
  // finds its bundles cached (Assets.init warns duplicate-init and keeps the
  // manifest, which is the same manifest) and renders. The reset stays for
  // the case it was built for: isolation initialized the manager and no game
  // boot ever ran, where the game's first boot deserves a virgin manager.
  if (deferredCanvasRoot && !activeIngest()) {
    const { resolveCanvasPixiForEditor } = await import('../host/canvas-entry-runtime');
    const pixi = await resolveCanvasPixiForEditor();
    pixi.Assets.reset();
  }
  const { launchIngestRoutes } = await import('./mount-ingest-root');
  await launchIngestRoutes(store);
  if (!activeIngest()) {
    // The routes already reported the failure through the mount-failure
    // report and reset the play surface; say why play produced nothing rather
    // than leaving the caller to infer it from a quiet return.
    throw new Error(
      "Play could not start: this project's ingest root failed to mount — see the mount " +
        `failure reported above (and in ${commandLine('status')}).`,
    );
  }
  beginDeferredIngestPlaySession();
  // The GAME document is where a running runtime presents (ARCHITECTURE-CORE:
  // Game is a PLAY-TIME document). The three ingest mount leaves the editor on
  // the Scene tab because, until now, that mount WAS edit mode; a play-time
  // mount belongs on the play surface — which is also what opens the input
  // gate (`mount-three-ingest-root.ts`'s `ingestInputActive` requires the play
  // tab, which is the Game document having focus), so the game is drivable rather than
  // merely visible.
  activateLiveDocument();
  getIngestPlayControl()?.play();
  return true;
}

/**
 * Stop's half. Returns `true` when it tore a play-claimed ingest down, so
 * `exitPlayMode` can skip a first-party teardown that has nothing to tear.
 * Idempotent; a no-op for a boot-mounted ingest.
 */
export function exitDeferredIngestPlay(store: EditorShellStore): boolean {
  if (!deferredIngestPlayActive()) return false;
  endDeferredIngestPlaySession();
  // `exitActiveIngest` is the ONE teardown path for the session (this module's
  // ownership note) — it unmounts by kind, clears the authoring override and
  // the adopted scene, and resets the play surface.
  exitActiveIngest();
  store.shell.setPlayState('stopped');
  // Edit mode is rebuilt through the ONE authoritative reinstall path
  // (`the world root's stage`'s `installAll`), which is what recreates the R3F design
  // session over the world component.
  queueEditModeRebuild();
  return true;
}
