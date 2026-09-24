/**
 * IngestRootAdapter — the {@link RootAdapter} for an UNMODIFIED external three.js
 * game. Its `mount()` is the host-and-ingest path: install the render accessor
 * trap on the shared `three`, run the unmodified game (its own renderer/scene/
 * camera/rAF), capture its live scene on the first frame, and return a
 * {@link MountedThreeRoot} whose `authoring` is the three authoring adapter
 * over that live `Object3D` tree, parameterized by what the captured graph
 * MEASURES as: a world carrying serve-time source stamps gets OID identity plus
 * JSX write-back ({@link oidSourceThree}), one without them keeps
 * structural-path identity and creation-site persistence
 * ({@link structuralThree}). See {@link countStampedObjects} for why that
 * is a measurement rather than a manifest field. `drivesOwnLoop` is true — the
 * host does not tick it.
 *
 * This is the runtime half of the Phase-B inversion: an unmodified game becomes a
 * peer implementer of the SAME `RootAdapter`/`MountedThreeRoot` contract first-party
 * content uses — no separate editor data model.
 */

import { authoringOidOf } from '@volter/editor-core/authoring/component-instance-root';
import { setIngestDataWriter } from '../../host/authoring/ingest-data-writer';
import { editorConsole } from '@volter/editor-core/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { GAME_SURFACE_CONTAINMENT_CSS } from '../../host/game-realm-page';
import { clearGameSurface, gameLoopGate, setGameSurface } from '../../host/gated-globals';
import { authoringJournal } from '../../host/history/json-history-resource';
import { clearPresentationSurface, recordPresentationSurface } from '@volter/editor-core/presentation-surface';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { clearRootReadiness, recordRootReadiness } from '@volter/editor-core/readiness';
import {
  type SameRealmLoopGate,
  type SameRealmLoopVerdict,
  verifySameRealmLoopControl,
} from '../../host/same-realm-loop-gate';
import { ensureScopedGameStyles } from '@volter/editor-core/scoped-game-css';
import { resolveThreeIngestRuntimeForEditor } from '../../host/three-ingest-runtime';
import type { OidEntry } from '@volter/editor-react/source/oid-transform';
import { createHttpSourceWriteBackend } from '@volter/editor-core/ui-source/source-write-backend';
import { serverRecordsSourceWrites } from '@volter/editor-core/ui-source/tier-source-write-backend';
import { clearWorldAdoption, worldAdoptionRecorder } from '@volter/editor-core/world-adoption';
import { markGameCssScope } from '@volter/editor-sdk/session/game-css-scope';
import type { MountedThreeRoot } from '@volter/editor-project/adapter';
import {
  readGamePresentation,
  readGameReady,
  readGameWorld,
} from '@volter/editor-project/adapter/ingest/game-contract';
import { describeMountFailure } from '@volter/editor-project/adapter/ingest/mount-readiness';
import { formatLoopGateMessage } from '@volter/editor-project/adapter/loop-gate-report';
import {
  oidSourceThree,
  structuralThree,
  type ThreeAuthoringAdapter,
} from '../../three/authoring/three-authoring-adapter';
import { isHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import {
  type CapturedThreeRenderer,
  installSceneCapture,
  type SceneCaptureHandle,
} from '@volter/threejs-runtime/adapter/ingest/scene-capture';
// TYPES ONLY. Every VALUE this module needs from `three` — the namespace the
// capture trap is installed on, its `DefaultLoadingManager`, and the two addon
// renderer classes — comes from `resolveThreeIngestRuntimeForEditor()` instead,
// because under the packaged runtime the shell's copy is not the one the
// ingested game's own modules resolve. See `../three-ingest-runtime.ts`.
import type * as THREE from 'three';
import { setCaptureWait } from '../capture-wait-report';
import { DOM_STUB_MARK } from '../dom-stub-mark';
import { ingestGameRealmWindow, readIngestGameContract } from '../game-contract-realm';
import { installGamePointerLockGate, releaseGamePointerLock } from '../game-pointer-lock';
import { claimHostSurfaceBox, hostSurfaceBackingSize } from '../host-surface-box';
import { clearIngestFrameSource } from '../ingest-frame-snapshot';
import { wireIngestSystems } from '../ingest-render-debug';
import type { IngestGame } from '../types';

export interface MountIngestOptions {
  /**
   * How long to wait for the game's first captured frame before the mount FAILS
   * by name. A game that needs a long boot raises it.
   */
  captureTimeoutMs?: number | undefined;
}

/** A mounted ingest game plus the host-side handles the editor needs to tear down. */
export interface IngestMount {
  game: MountedThreeRoot;
  /** The live-scene authoring adapter. */
  authoring: ThreeAuthoringAdapter;
  hostEl: HTMLElement;
  /** Live capture stats (draw count, child count) for proof/telemetry. */
  capture: SceneCaptureHandle;
  /** The captured scene (== game.scene). */
  scene: THREE.Scene;
  /**
   * The measured loop verdict, read LIVE (a function, not a snapshot — the
   * probe re-runs at every pause, so a frozen value would start lying the
   * moment the game's shape changed); `null` before the first pause, because a
   * verdict is a measurement and there has not been one yet.
   */
  realmLoopVerdict?: (() => SameRealmLoopVerdict | null) | undefined;
}

/**
 * D10/T7.6 loop-gate honesty check, extracted for direct unit testing
 * builds the `setPaused` a mounted
 * ingest game exposes to `Game.play.pause()`/`resume()` — separate from
 * the authoring adapter's own edit-time `loop.pause()`/`loop.resume()`
 * (gizmo freeze/unfreeze), which always calls through regardless of whether
 * the loop is genuinely gateable.
 *
 * S-5 (the SimCity ingest ledger) rewrote both halves of this.
 *
 * COVERAGE. Pausing used to be `loop.pause()` alone — `setAnimationLoop(null)`,
 * which reaches exactly one loop driver. SimCity renders through
 * `setAnimationLoop` and SIMULATES through `setInterval(this.simulate, 1000)`,
 * so pause froze the picture while the city kept building (measured: the game
 * still advanced after the gate reported success). A pause now also HOLDS the
 * same-realm scheduling gate (`../ingest/same-realm-loop-gate.ts`), which the
 * dev-server prelude has shadowed into every game module.
 *
 * HONESTY. The old check asked `capture.getAnimationLoop(renderer) !== null` —
 * whether the game had ever DECLARED a loop through the renderer — and warned
 * only when it had not. That is a declaration, not a measurement, and it is why
 * a gate that controlled none of SimCity's simulation still "reported success".
 * Every pause now runs the probe (`verifySameRealmLoopControl`): control is
 * claimed only when something was actually withheld, nothing gated ran, and the
 * game renderer's own frame counter did not advance. Anything else warns loudly
 * with the measured reason.
 */
export function createIngestLoopGate(
  capture: Pick<SceneCaptureHandle, 'getAnimationLoop' | 'getDrawCount'>,
  renderer: CapturedThreeRenderer,
  worldId: string,
  loop: { pause(): void; resume(): void },
  opts: {
    /** The same-realm scheduling gate (`gated-globals.ts`) — `null` when none
     *  is installed, which the probe reports as `self-driven`. Injected so this
     *  is unit-testable with a fake gate and no browser. */
    realmGate?: SameRealmLoopGate | null;
    /** Called with the MEASURED verdict after each pause. */
    onVerdict?: (verdict: SameRealmLoopVerdict) => void;
    verifyWindowMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): { setPaused(paused: boolean): void; lastVerdict(): SameRealmLoopVerdict | null } {
  let lastVerdict: SameRealmLoopVerdict | null = null;
  return {
    setPaused(paused: boolean) {
      if (!paused) {
        loop.resume();
        // Release the scheduling gate LAST so a parked simulation tick never
        // runs against a renderer that has not been handed its loop back.
        opts.realmGate?.release();
        return;
      }
      // S-5: pausing is BOTH halves. `setAnimationLoop(null)` stops the game's
      // rendering; the same-realm gate parks the scheduling its simulation runs
      // on. Freezing only the first is what let a "gated" SimCity keep building
      // its city — its sim tick is a bare `setInterval`, which
      // `setAnimationLoop(null)` does not touch and the old declaration-only
      // check (`getAnimationLoop(renderer) !== null`) never even looked at.
      loop.pause();
      opts.realmGate?.hold();
      // MEASURE, never assume — the honesty gate. A verdict is reported for
      // every pause, including the `self-driven` ones the old check could not
      // produce (it only ever warned about a game that never called
      // `setAnimationLoop`, and said nothing at all otherwise).
      void verifySameRealmLoopControl({
        gate: opts.realmGate ?? null,
        progress: () => renderer.info?.render.frame ?? capture.getDrawCount(),
        ...(opts.verifyWindowMs !== undefined ? { windowMs: opts.verifyWindowMs } : {}),
        ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
      }).then((verdict) => {
        lastVerdict = verdict;
        opts.onVerdict?.(verdict);
        if (verdict.loop === 'gated') return;
        // A NEW native console.warn site — suppressed to keep this task's
        // diff at zero NEW lint warnings (same reasoning as
        // `runtime/game.ts`'s `reportGateShortfallOnce`).
        // biome-ignore lint/suspicious/noConsole: see comment above
        console.warn(
          formatLoopGateMessage({
            worldId,
            reason: capture.getAnimationLoop(renderer)
              ? verdict.reason
              : `${verdict.reason} (this game also never called renderer.setAnimationLoop)`,
          }),
        );
      });
    },
    lastVerdict: () => lastVerdict,
  };
}

/**
 * How many objects in the captured world carry a serve-time source stamp —
 * THE measurement that decides which authoring lane this mount gets.
 *
 * Exported for the unit test that proves the decision is made on the graph
 * rather than on a game id: a stamped scene picks the OID lane, an unstamped
 * one keeps the structural lane.
 */
export function countStampedObjects(scene: THREE.Object3D): number {
  let stamped = 0;
  scene.traverse((object) => {
    if (authoringOidOf(object) !== undefined) stamped++;
  });
  return stamped;
}

/**
 * The same count, given a bounded window to become true.
 *
 * A ONE-SHOT count taken the instant `waitForSceneToSettle` returns is the
 * wrong instrument, and it decorrelates exactly where it matters. That helper
 * watches `scene.children.length`, so a React world sitting in a Suspense
 * fallback while its GLBs stream reads as "settled" with its authored tree not
 * yet committed — every object unstamped, and the mount silently takes the
 * structural lane for the rest of its life. Measured on racing-game, whose
 * WARM boot took the OID lane (`r3f:<world>:<oid>` rows, 101 of 107 objects
 * source-addressable) and whose COLD boot on the same bytes took the
 * structural one (`ingest:0:Mesh:` rows, nothing writable) — the same game,
 * the same source, a different instant.
 *
 * So the count gets a window. It returns the moment a stamp appears, which is
 * immediately for a world that already committed; only a world with none pays
 * the full budget, and that is the case where the answer genuinely is not
 * knowable yet.
 */
export async function countStampedObjectsWhenCommitted(
  scene: THREE.Object3D,
  maxMs = 2500,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
  const start = performance.now();
  for (;;) {
    const stamped = countStampedObjects(scene);
    if (stamped > 0) return stamped;
    if (performance.now() - start >= maxMs) return 0;
    await sleep(100);
  }
}

/**
 * Resolve one project-relative path against a project root, POSIX-style.
 *
 * Spelled out rather than borrowed from `node:path` (this runs in the browser)
 * or from `new URL(rel, 'file://…')` (which percent-encodes, so the result stops
 * comparing equal to the raw absolute paths the OID index carries). `..` in a
 * declared path is the ORDINARY case for a repo-vendored fixture — racing-game's
 * root declares its world as `../../../../../../vendor/games/racing-game/src/App.tsx`
 * — so resolving it is the whole job.
 */
export function resolveProjectPath(projectRoot: string, relative: string): string {
  const rel = relative.replace(/\\/g, '/');
  const base = rel.startsWith('/') ? '' : projectRoot.replace(/\\/g, '/');
  const out: string[] = [];
  for (const segment of `${base}/${rel}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return `/${out.join('/')}`;
}

/**
 * The directory trees THIS ingest root's own source lives under — the scope the
 * serve-time index door (below) is allowed to answer from.
 *
 * It is derived from MOUNTING FACTS the manifest already states, never guessed:
 * the project folder itself (a user's own ingested game keeps its source there)
 * plus the parent directory of every source module the root declares
 * (`entry`, `world.entry` — carried on the descriptor as
 * {@link IngestGame.sourceModules}). The second is what covers a repo-vendored
 * game, whose project folder holds only a manifest and a host shim while its
 * actual TSX lives under `vendor/games/<id>/src/` — measured on racing-game,
 * where all 41 stamped files sit outside the project folder.
 */
export function ingestSourceRoots(
  projectRoot: string | null | undefined,
  sourceModules: readonly string[] | undefined,
): string[] {
  if (!projectRoot) return [];
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const roots = new Set<string>([root]);
  for (const module of sourceModules ?? []) {
    const resolved = resolveProjectPath(root, module);
    const dir = resolved.slice(0, resolved.lastIndexOf('/'));
    if (dir) roots.add(dir);
  }
  return [...roots];
}

/**
 * THE SERVE-TIME DOOR: did the OID transform stamp any of THIS root's own
 * source, according to the index the dev server built while serving it?
 *
 * `GET /__ui-source/index` (`@volter/editor-react`'s `serving/ui-oid-plugin.ts`) records exactly what the
 * transform stamped, and it is populated at TRANSFORM time — before the module
 * is evaluated, and therefore long before any object exists to carry a stamp.
 * That is precisely the ordering the graph door cannot have: on a project's
 * first-ever cold mount (fresh Vite transform, streaming GLBs) fiber has not
 * committed yet when the graph is counted, the count is 0, and the mount used
 * to freeze on the structural lane for the whole session while every warm mount
 * on the same bytes healed to the OID lane.
 *
 * Scoped by {@link ingestSourceRoots} rather than asking "is the index
 * non-empty": a project can serve stamped TSX that has nothing to do with this
 * root (a sibling `dom` root's HUD is the standing case), and answering yes for
 * that would put a plain three.js ingest — whose creation sites really are in
 * its own source — onto the wrong lane.
 */
export function indexStampsSourceUnder(
  index: Readonly<Record<string, { readonly file?: unknown }>> | null | undefined,
  sourceRoots: readonly string[],
): boolean {
  if (!index || sourceRoots.length === 0) return false;
  for (const entry of Object.values(index)) {
    const file = entry?.file;
    if (typeof file !== 'string') continue;
    const clean = file.replace(/\\/g, '/');
    if (sourceRoots.some((root) => clean === root || clean.startsWith(`${root}/`))) return true;
  }
  return false;
}

/**
 * WHICH LANE, from the two doors — the only place that decision is spelled.
 *
 * OID lane iff EITHER door says yes; structural only on a double no.
 *
 * The graph door stays as the second door on purpose: a warm server restart can
 * serve stamped bytes out of Vite's own cache without repopulating the plugin's
 * in-memory index, and a hosted (non-dev) tier has no index endpoint at all —
 * in both, the stamps on the live objects are the only evidence there is.
 */
export function chooseIngestAuthoringLane(doors: {
  readonly servedStampedSource: boolean;
  readonly graphStamps: number;
}): 'oid-source' | 'structural' {
  return doors.servedStampedSource || doors.graphStamps > 0 ? 'oid-source' : 'structural';
}

/**
 * The served OID index, or `null` when THIS SESSION'S HOST serves no
 * `/__ui-source/*` route to ask, or the request fails. Never throws: a door
 * that cannot answer is a `null`,
 * and the graph door still decides.
 *
 * The route, not `import.meta.env.DEV`: the packaged editor serves this index
 * from a PRODUCTION shell bundle, and asking the build flag closed the served
 * door on exactly the tier the index exists for
 * (`../ui-source/tier-source-write-backend.ts`).
 */
async function readServedOidIndex(): Promise<Record<string, OidEntry> | null> {
  if (!(await serverRecordsSourceWrites())) return null;
  try {
    return (await createHttpSourceWriteBackend().index?.()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Uncaught page errors logged during a game's BOOT WINDOW (M29).
 *
 * Reads the same 'runtime'-source console entries `command-listener.ts`'s
 * `collectPageErrors` does — the window error/unhandledrejection capture
 * `installEditorConsoleCapture` installs — fenced to this mount's own window
 * rather than to a play run, because an ingest mount IS the run. Capped: the
 * point is to NAME the blocker inside one sentence, not to reprint the console
 * (the full text is there, and this list is a pointer to it).
 */
function bootWindowPageErrors(startedAt: number): string[] {
  return editorConsole
    .getEntries()
    .filter(
      (entry) =>
        entry.level === 'error' && entry.source === 'runtime' && entry.timestamp >= startedAt,
    )
    .slice(-10)
    .map((entry) => (entry.count > 1 ? `${entry.message} (×${entry.count})` : entry.message));
}

/**
 * Wait for the game's world to be BUILT, declaration first.
 *
 * A game that declares `window.vgaiGame.ready` is awaited exactly once and the
 * measured poll never runs — the game states when it is done, so the host has
 * nothing to estimate. Everything else keeps {@link waitForSceneToSettle},
 * which is the MEASURED fallback and is labelled as such wherever readiness is
 * reported (`readiness.ts`).
 *
 * A declared signal that REJECTS does not fail the mount: the world is already
 * captured by this point, so refusing here would throw away a live scene over a
 * boot-completion promise. It degrades to the measured wait, LOUDLY, and the
 * facet then reports this root as `measured` — which is the truth about which
 * answer actually stood.
 */
async function awaitWorldReady(
  gameId: string,
  scene: THREE.Scene,
  ready: (() => Promise<unknown>) | null,
): Promise<'declared' | 'measured'> {
  if (ready) {
    try {
      await ready();
      return 'declared';
    } catch (err) {
      editorConsole.error(
        `Ingest game "${gameId}" declared \`window.vgaiGame.ready\` and it REJECTED (${String(err)}) ` +
          '— the world was already captured, so the host fell back to the measured settle wait. ' +
          'This root now reports readiness as measured.',
        'ingest',
      );
    }
  }
  await waitForSceneToSettle(scene);
  return 'measured';
}

/** Wait until the game's async world (e.g. a streamed GLTF) stops growing. */
async function waitForSceneToSettle(scene: THREE.Scene, maxMs = 5000): Promise<void> {
  const start = performance.now();
  let last = -1;
  let stableTicks = 0;
  return new Promise((resolve) => {
    const tick = () => {
      const n = scene.children.length;
      stableTicks = n === last ? stableTicks + 1 : 0;
      last = n;
      if (stableTicks >= 3 || performance.now() - start > maxMs) return resolve();
      setTimeout(tick, 120);
    };
    tick();
  });
}

/**
 * Settle which element the host adopts into its surface, and put it there.
 *
 * Some games append their canvas to `document.body` — reparent it into the
 * host. A DOM-hybrid game (React/R3F with HTML UI: HUDs, overlay panels, drei
 * `<Html>` portals) can declare the element that OWNS its canvas via
 * `window.vgaiGame.root` (the declared game→host contract, game-contract.ts;
 * `__vgaiGameRoot` is the pre-contract alias). Adopting only the bare canvas
 * would strand that UI at page level over the editor chrome, and following the
 * canvas would require the game to know host layout internals — an arcane
 * demand. Adopt the declared root wholesale so the game's own DOM structure
 * survives intact; games that declare nothing keep the bare-canvas behaviour.
 *
 * THE PAGE IS A LEGITIMATE ANSWER, and it used to kill the mount. A game whose
 * canvas, title wrapper, pause wrapper and game-over overlay are all direct
 * children of the body has no wrapper div to name, so its shim declares
 * `root: document.body` and is right to. The
 * page is an ANCESTOR of our surface, so adopting it is not merely wrong, it
 * throws — `hostEl.appendChild(document.body)` → "The new child element
 * contains the parent" — and the whole mount died there. In-realm, that
 * declaration means "everything I appended to the page", and everything the
 * game appended to the page is already inside the surface, because the realm
 * put it there (game-realm-page.ts). So the surface IS the adopted root, and
 * there is nothing left to reparent or restyle: the host already owns its box.
 *
 * Otherwise the pane sizes the adopted element from here on, so strip whatever
 * page-level positioning the game used while it owned the whole window (S-4:
 * this runs for the BARE-CANVAS case too, which is the case it was missing — a
 * game that declares no root hands us a canvas three already stamped with
 * literal `${w}px`/`${h}px`, and the host's own resizes use
 * `updateStyle:false`, so nothing else would ever write that stamp again).
 */
function adoptGameDomRoot(hostEl: HTMLElement, surface: HTMLElement): HTMLElement {
  const realmWindow = ingestGameRealmWindow();
  const declaredRoot =
    readIngestGameContract()?.root ??
    (realmWindow as unknown as { __vgaiGameRoot?: unknown }).__vgaiGameRoot;
  const declared =
    declaredRoot instanceof HTMLElement && declaredRoot.contains(surface) ? declaredRoot : surface;
  if (declared.contains(hostEl)) return hostEl;
  // Already nested INSIDE the game's own DOM under the host (a staged page's
  // renderer lives inside its own `#container`, among siblings whose paint
  // order the page designed): the page owns its layout — hoisting the element
  // to the host's end re-stacks it OVER later siblings (measured on
  // css3d_periodictable: the renderer covered the page's own `#menu`, so its
  // TABLE/SPHERE buttons never received a click). Only a DIRECT child gets
  // the host's box claim, and only a DETACHED/outside element is rescued in.
  if (declared.parentElement !== hostEl && hostEl.contains(declared)) return declared;
  claimHostSurfaceBox(declared);
  if (declared.parentElement !== hostEl) hostEl.appendChild(declared);
  return declared;
}

/**
 * Mount an unmodified game and capture its live scene as a `MountedThreeRoot`.
 * `store` is needed by the authoring adapter for shared selection state; the
 * captured objects get stable structural-path ids in the live authoring
 * adapter's projection (never a fabricated descriptor and never a foreign
 * `userData` mutation).
 */
export async function mountIngestGame(
  store: EditorShellStore,
  game: IngestGame,
  gameContainer: HTMLElement,
  opts: MountIngestOptions = {},
): Promise<IngestMount> {
  // The upstream games expect an element with id="container" to mount into.
  const hostEl = document.createElement('div');
  hostEl.id = 'container';
  hostEl.style.cssText = `position:absolute;inset:0;width:100%;height:100%;overflow:hidden;${GAME_SURFACE_CONTAINMENT_CSS}`;
  gameContainer.appendChild(hostEl);

  // THE GAME'S PAGE IS THIS BOX, from before its first module runs. A game
  // written to own a tab appends its canvas and every overlay to
  // `document.body`; the realm hands it this element instead, and the
  // containment CSS above makes the element the containing block for the
  // `position:fixed` overlays that would otherwise paint over editor chrome.
  // Host policy, not per-game CSS — see `game-realm-page.ts` for the four
  // page-shaped assumptions this covers and why each one breaks an in-realm
  // mount. Registered on the DEFAULT realm because an ingest descriptor's
  // module urls carry no `?vgai-mount=` (binding-resolver.ts's
  // `resolveIngestDescriptor` builds bare `fsImportPath` urls).
  const realmPage = setGameSurface(hostEl);

  // THE GAME'S OWN PAGE STYLESHEET, contained to this box. `hostEl` IS the
  // game's page in-realm, so it is exactly the right scope root: the sheet's
  // `html`/`body` rules land on it, everything else lands on what the game
  // appends inside it, and the editor's document sees none of it
  // (`scoped-game-css.ts` — the rules are served inside `@scope`). Awaited
  // BEFORE the game's entry runs so the HUD's first paint is already styled.
  // A project that declares no stylesheet mounts exactly as it did before.
  markGameCssScope(hostEl);
  const scopedCssProject = getCurrentProject();
  if (scopedCssProject) await ensureScopedGameStyles(scopedCssProject.rootPath);

  // DOM-shim: stub the elements a DOM-dependent game expects (e.g. #blocker),
  // so its getElementById calls succeed without editing the game. A stub is
  // MARKED so the served-bundle boot can retire it when the game's own staged
  // page supplies that id (`served-html-boot.ts`): stubs are made before the
  // declared DOM is staged, so this existence check cannot see the real
  // element yet, and a stub left in place shadows it — measured on
  // css3d_periodictable, whose TABLE/SPHERE buttons bound their listeners to
  // invisible stubs while the visible buttons did nothing.
  const stubEls: HTMLElement[] = [];
  for (const id of game.domStubs ?? []) {
    if (document.getElementById(id)) continue;
    const stub = document.createElement('div');
    stub.id = id;
    stub.style.display = 'none';
    stub.dataset[DOM_STUB_MARK] = '';
    hostEl.appendChild(stub);
    stubEls.push(stub);
  }

  // THE `three` THE GAME'S OWN MODULES WILL RESOLVE — and therefore the ONE
  // whose `WebGLRenderer.prototype` is worth trapping. Under the packaged
  // runtime the game's entry is served as `/@fs/<project>/…` by the
  // PROJECT-rooted Vite (the only Vite there — the editor's shell is a
  // prebuilt static bundle with its own `three` inlined), so a shell namespace
  // traps a class nobody constructs. MEASURED on a packaged build against a
  // ~30-line unmodified three.js game: three.js's own "Multiple instances of
  // Three.js being imported" warning, then the mount failing by name 15s later
  // with "the game never rendered, or it bundles its own (un-shared) copy of
  // three". Resolved ONCE here and handed to everything below; see
  // `../three-ingest-runtime.ts`. Under dev/hosted there is one graph
  // and this is byte-identical to the static imports it replaces.
  const runtime = await resolveThreeIngestRuntimeForEditor();
  const projectThree = runtime.three;

  // 1. Trap the shared three's renderer (the game's `import 'three'` resolves here).
  // Also pass the shared `EffectComposer` addon ctor so a
  // game's own composer is collected too — resize wiring below (D-C3).
  // `isHostRenderer` keeps the EDITOR's own drawing out of the capture: the
  // trap is on the shared prototype, so our renders reach it too — including
  // the offscreen thumbnail/preview renderers the editor builds on demand.
  const capture: SceneCaptureHandle = installSceneCapture(projectThree, runtime.EffectComposer, {
    isHostRenderer,
    // CSS3DRenderer is a shared Three addon exactly like EffectComposer: the
    // host and an unmodified `three/addons/renderers/CSS3DRenderer.js` import
    // resolve to this one class. Its prototype render carries the same scene +
    // camera pair even though it never touches WebGLRenderer.
    additionalRendererCtors: [runtime.CSS3DRenderer],
    // ZERO INFERENCE, first leg: the game's own contract may name its world, in
    // which case first-render-wins never runs. Read LAZILY — the contract is
    // declared by the game's own modules, which have not executed yet at this
    // line. A malformed declaration is refused by name below rather than
    // silently falling back, so a wrong `world` is attributable.
    declaredScene: () => {
      const reading = readGameWorld(readIngestGameContract());
      if (reading.malformed !== null) {
        editorConsole.error(
          `Ingest game "${game.id}" ${reading.malformed} — falling back to the MEASURED ` +
            'first-render adoption.',
          'ingest',
        );
      }
      return reading.world;
    },
    // ZERO INFERENCE, second leg: whichever way the world was adopted, the
    // provenance and every later distinct world become a recorded fact
    // (`world-adoption.ts` → the `worldAdoption` facet), never a silent
    // permanent commitment.
    onWorldAdoption: worldAdoptionRecorder(game.id),
  });

  // 2. Asset-path adapter: redirect the game's relative asset paths to the served files.
  if (game.assets) {
    const map = game.assets;
    projectThree.DefaultLoadingManager.setURLModifier((url) => {
      for (const key of Object.keys(map)) if (url.includes(key)) return map[key]!;
      return url;
    });
  }

  // 3. Run the unmodified game; the trap captures on its first rendered frame.
  // Signal COLD MOUNT before the entry executes: editor mounts are for
  // inspection first, so a session-driven game MAY defer its side-effects
  // (backend connection, narrative, audio) until the editor's play control
  // dispatches 'vgai:ingest-play' (getIngestPlayControl, ingest/mount-ingest-root.ts).
  // Rendering must continue regardless — capture needs a frame — and games
  // that ignore the flag behave exactly as before (opt-in, never demanded).
  (window as unknown as { __vgaiMountCold?: boolean }).__vgaiMountCold = true;
  // THE BOOT WINDOW OPENS HERE (M29). Everything the page throws from this
  // instant until the mount resolves belongs to this game's boot, and it is the
  // fact that separates "crashed before ready" from "never became ready" — the
  // two the old single sentence could not tell apart.
  const bootWindowStartedAt = Date.now();
  await game.load();
  const timeoutMs = opts.captureTimeoutMs ?? 10_000;
  // WHO ANSWERS "is it ready" — read once, right after the game's own modules
  // have run and therefore after its contract exists. A declaration makes this
  // root's readiness `declared`; its absence leaves the MEASURED waits below
  // standing, and says so in the facet rather than silently.
  const declaredReady = readGameReady(readIngestGameContract());
  if (declaredReady.malformed !== null) {
    editorConsole.error(
      `Ingest game "${game.id}" ${declaredReady.malformed} — the host is measuring readiness ` +
        'instead.',
      'ingest',
    );
  }
  const readinessSource = declaredReady.ready === null ? 'measured' : 'declared';
  recordRootReadiness({
    rootId: game.id,
    mechanism: declaredReady.ready === null ? 'measured-wait' : 'contract-ready',
    source: readinessSource,
    state: 'waiting',
  });
  let rt: Awaited<ReturnType<SceneCaptureHandle['waitForCapture']>>;
  try {
    // The window is VISIBLE time (see `visible-capture-window.ts`): a tab that
    // boots in the background parks here instead of dying, with the trap still
    // installed, so the first frame after the human foregrounds the tab is the
    // captured one. `setCaptureWait` is what keeps that park from reading as a
    // hung mount — `vgai status` names it.
    rt = await capture.waitForCapture({
      timeoutMs,
      onWait: (wait) => setCaptureWait(game.id, wait),
    });
  } catch (err) {
    // Nothing was captured: the game's `three` never reached the host trap, so
    // there is no live scene to author. Tear the host state down and fail by
    // name.
    capture.uninstall();
    projectThree.DefaultLoadingManager.setURLModifier((u) => u);
    for (const el of stubEls) el.remove();
    clearGameSurface();
    hostEl.remove();
    clearWorldAdoption(game.id);
    // M29 — THREE BLOCKERS, THREE SENTENCES. The old single line said "rendered
    // no capturable frame within timeout" for all of them, which pointed a
    // reader at the host's wait when the actual blocker was the game's own
    // async-init throw (it misdirected two sweep measurements). The choice is
    // made from facts already in hand: did anything throw during the boot
    // window, and did the game declare readiness at all.
    const description = describeMountFailure({
      gameId: game.id,
      timeoutMs,
      readinessSource,
      pageErrors: bootWindowPageErrors(bootWindowStartedAt),
      cause: String(err),
    });
    recordRootReadiness({
      rootId: game.id,
      mechanism: declaredReady.ready === null ? 'measured-wait' : 'contract-ready',
      source: readinessSource,
      state: 'failed',
      failure: description.kind,
    });
    throw new Error(description.message);
  }

  const gameDomRoot = adoptGameDomRoot(hostEl, rt.renderer.domElement);

  // WHICH CANVAS IS THE GAME'S PICTURE — declaration first. The contract's
  // `presentation` is the game's own statement; absent it, the captured
  // renderer's element is the host's MEASUREMENT (a real read off the render
  // trap, not the DOM-order guess every late reader used to make). Both are
  // recorded with their provenance, which is what lets the screenshot,
  // staleness and canvas-medium readers stop sniffing (`presentation-surface.ts`).
  const declaredPresentation = readGamePresentation(readIngestGameContract());
  if (declaredPresentation.malformed !== null) {
    editorConsole.error(
      `Ingest game "${game.id}" ${declaredPresentation.malformed} — the host is using the ` +
        'captured renderer’s canvas instead.',
      'ingest',
    );
  }
  recordPresentationSurface(
    game.id,
    declaredPresentation.canvas ?? rt.renderer.domElement,
    declaredPresentation.canvas ? 'declared' : 'measured',
  );

  // Pointer lock: a first-person game asks for it on its OWN element (a click
  // handler on its canvas), which no
  // window/document proxy can see. The gate is installed on the element
  // method itself and scoped to registered game surfaces, so the editor
  // viewport's own pointer lock is untouched.
  installGamePointerLockGate();

  // 4. Let the game finish building its world — its own `ready` when it
  // declares one, the measured settle poll otherwise — then build the
  // authoring adapter.
  const readinessStood = await awaitWorldReady(game.id, rt.scene, declaredReady.ready);
  recordRootReadiness({
    rootId: game.id,
    mechanism: readinessStood === 'declared' ? 'contract-ready' : 'measured-wait',
    source: readinessStood,
    state: 'ready',
  });

  // Loop gate (begin/endEdit): the scene-capture trap recorded the game's
  // setAnimationLoop callback, so we freeze the game's OWN loop (set null) and
  // resume it (re-set the recorded callback) for stable editing — even of dynamic
  // objects. (Games driving their loop via raw requestAnimationFrame instead of
  // setAnimationLoop have no recorded callback → pause is a no-op for them.)
  const loop = {
    pause: () => rt.renderer.setAnimationLoop?.(null),
    resume: () => {
      const cb = capture.getAnimationLoop(rt.renderer);
      if (cb) rt.renderer.setAnimationLoop?.(cb);
    },
  };
  // The game's own DATA writer, if it declares one — registered for EVERY
  // ingest mount, including as `null`, because setting it is also what takes
  // the previous mount's writer back down (see `ingest-data-writer.ts`
  // §RESOURCE OWNERSHIP). It is only a loader here; nothing imports it until an
  // edit needs it.
  setIngestDataWriter(game.dataWriter ?? null);

  // WHICH AUTHORING LANE — decided by MEASUREMENT, never by the game's id.
  //
  // A game whose own source the serve-time OID transform reached carries that
  // stamp on the objects fiber constructed from it (`userData.oid`; the
  // transform's R3F dialect emits `userData-oid`, which fiber pierces onto the
  // object). For such a world the JSX callsite IS the object's source address,
  // and the creation-site registry the structural lane writes through is
  // structurally EMPTY — every `new` expression that built it lives in
  // `node_modules`.
  //
  // TWO DOORS, and the SERVE-TIME one is asked first because it is already true
  // at this instant on the coldest boot: the transform populates the index
  // before the module it stamped is even evaluated, while the graph can only
  // answer once fiber has committed. The graph door remains, for the case
  // where no index exists to read (a warm server restart serving cached
  // bytes). Structural only when BOTH say no — see
  // `chooseIngestAuthoringLane`.
  const sourceRoots = ingestSourceRoots(getCurrentProject()?.rootPath, game.sourceModules);
  const servedStampedSource = indexStampsSourceUnder(await readServedOidIndex(), sourceRoots);
  // The graph poll is the SECOND door, so it is only worth paying for when the
  // first said no; a yes has already decided the lane.
  const graphStamps = servedStampedSource ? 0 : await countStampedObjectsWhenCommitted(rt.scene);
  const authoring =
    chooseIngestAuthoringLane({ servedStampedSource, graphStamps }) === 'oid-source'
      ? oidSourceThree(store, rt.scene, {
          worldId: game.id,
          loop,
          camera: rt.camera,
          journal: authoringJournal(game.id),
        })
      : structuralThree(store, rt.scene, {
          loop,
          camera: rt.camera,
          journal: authoringJournal(game.id),
        });

  // D10/T7.6: the game-level play-state control surface (`Game.play.pause()`)
  // calls THIS `setPaused` — separately from the authoring adapter's own
  // edit-time freeze/unfreeze (which calls `loop.pause()`/`loop.resume()`
  // directly, above), so a gizmo drag never trips the loop-gate honesty
  // report `createIngestLoopGate` makes for an actual play/pause request.
  // S-5: hand the in-page mount the SAME-REALM scheduling gate, so pausing
  // freezes the game's `setInterval`/`setTimeout`/raw-rAF drivers too and the
  // verdict is MEASURED rather than declared.
  const loopGate = createIngestLoopGate(capture, rt.renderer, game.id, loop, {
    realmGate: gameLoopGate(),
    // The probe is ASYNC (it watches a real-time window), so the verdict lands
    // well after `setPaused` returned. Nothing else would notify the store, and
    // `collectState` is push-based — the control API would keep serving a
    // snapshot taken before the measurement existed, reporting `loop: null`
    // forever. Broadcast so `vgai status` sees the verdict it just produced.
    onVerdict: () => store.notifyIngestEdit(),
  });
  // The game's DECLARED system surface (`window.vgaiGame.systems`), projected
  // onto the host's ordinary `SystemAdapters.debug`. `activateCapturedThreeIngest`
  // hands `mounted.systems` straight to `setActiveSystems`, so a shim that
  // declares verbs makes `game.commands()`/`game.state()` work through the same
  // bridge path first-party content uses — no ingest-specific door. A game that
  // declares nothing yields `null` here and keeps the pre-contract floor.
  const { systems, renderDebug, debugCollisions } = wireIngestSystems({
    contractSystems: readIngestGameContract()?.systems,
    surface: 'three',
    runtime: rt,
    setRenderPassHooks: (hooks) => capture.setRenderPassHooks(hooks),
  });
  // A name two feeders both declare is REFUSED when called, by a coded error
  // naming both. Said here too — same as the canvas mount — because a refusal
  // nobody sees until they call the name is a defect that ships.
  for (const collision of debugCollisions) {
    editorConsole.error(`Ingest game "${game.id}" — ${collision}; it will refuse`, 'ingest');
  }
  const mounted: MountedThreeRoot = {
    kind: 'three',
    scene: rt.scene,
    camera: rt.camera,
    drivesOwnLoop: true,
    ...(Object.keys(systems).length > 0 ? { systems } : {}),
    setPaused: (paused) => loopGate.setPaused(paused),
    // Also resize any composer the game renders through, so
    // its own (intentionally downsampled, e.g. `UnrealBloomPass`) render
    // targets track the host pane instead of staying stale at mount size.
    resize: (w, h) => {
      // WHO OWNS THE PICTURE'S SHAPE. A game that registered its own `resize`
      // listener has a size policy — letterboxing to a fixed aspect is the
      // common one — and the realm now reports the
      // PANE as `window.innerWidth`/`innerHeight`, so its own handler produces
      // the right answer for the pane. Forcing `setSize(pane)` on top of that
      // would stretch exactly the game that took the trouble to letterbox
      // itself. So: tell the game, and let it size its renderer.
      if (realmPage.gameResizesItself) {
        realmPage.dispatchResize();
        return;
      }
      // Otherwise the host owns it, exactly as before.
      const size = hostSurfaceBackingSize(w, h);
      rt.renderer.setSize(size.width, size.height, false);
      capture.resizeComposers(size.width, size.height);
      // S-4: re-assert the host's CSS box. `setSize(…, false)` deliberately
      // never touches style, so this is the only thing that survives a game's
      // own window-resize handler re-stamping pixels.
      claimHostSurfaceBox(gameDomRoot);
    },
    dispose: () => {
      // Drop the render-pass bracket and reject any armed capture BEFORE the
      // renderer goes, so no wrapper outlives the mount on the game's objects.
      capture.setRenderPassHooks(null);
      // The bracket's second consumer, released through its own ONE teardown
      // path — a screenshot waiting on a frame settles now rather than hanging
      // out its timeout over a mount that is gone.
      clearIngestFrameSource();
      renderDebug?.dispose();
      try {
        rt.renderer.setAnimationLoop?.(null);
        rt.renderer.dispose?.();
      } catch {
        /* ignore */
      }
      capture.uninstall();
      projectThree.DefaultLoadingManager.setURLModifier((url) => url);
      for (const el of stubEls) el.remove();
      // A game that held pointer lock must not keep it past its own mount, and
      // the realm must stop standing in for a surface that no longer exists.
      releaseGamePointerLock();
      clearGameSurface();
      // RESOURCE OWNERSHIP: this mount recorded these three per-root facts, so
      // this mount's ONE teardown path drops them. Per-root, never a blanket
      // clear — a composite mounts roots independently and a sibling's answers
      // are still true (the rule `clearMountFailureReport` already follows).
      clearPresentationSurface(game.id);
      clearRootReadiness(game.id);
      clearWorldAdoption(game.id);
      // Removing the surface removes the game's ENTIRE DOM with it — canvas,
      // title wrapper, pause wrapper, game-over overlay — because the realm
      // put every one of them inside it (game-realm-page.ts, reason 1).
      hostEl.remove();
    },
    authoring,
  };

  return {
    game: mounted,
    authoring,
    hostEl,
    capture,
    scene: rt.scene,
    realmLoopVerdict: () => loopGate.lastVerdict(),
  };
}
