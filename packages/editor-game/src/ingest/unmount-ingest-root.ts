/**
 * Teardown for whatever `{ ingest }` root is live — the one path out of the
 * session slot (`active-ingest.ts`), and the three per-surface dispose bodies
 * it dispatches to.
 *
 * Every mount entry opens with {@link exitActiveIngest}, so this is also the
 * cross-surface switch: mounting a canvas root over a live three root disposes
 * the three session first, whichever surface it was.
 *
 * All three teardown bodies end at `reclaimGameRealm('')`. An ingested game
 * runs in the DEFAULT `gated-globals.ts` realm, and these bodies used to reset
 * its input gate to always-true and stop there — which left the dead game's
 * window/document listeners attached to the real `window` AND ungated, for the
 * rest of the tab's life, with the next ingest mount inheriting the list.
 * Ending the realm is what releases them; it also drops the gate entry, so
 * resetting the gate is no longer a separate step.
 */

import { setActiveAuthoring } from '@editor/authoring/active-adapter';
import { setActiveSystems } from '@editor/authoring/active-systems';
import { clearMountFailureReports } from '@editor/authoring/mount-failure-report';
import { editorConsole } from '@editor/editor-console';
import { reclaimGameRealm } from '@editor/game-realm-reclaim';
import { setGameRealmReloadHandler } from '@editor/gated-globals';
import {
  activeIngest,
  type IngestSession,
  type IngestSession2D,
  type IngestSessionReact,
  setActiveIngest,
} from './active-ingest';
import { readIngestGameContract } from './game-contract-realm';
import { clearIngestHook } from './ingest-evidence-hook';
import { resetIngestPlaySurface } from './ingest-play-control';

/**
 * D-V1 slot collapse: tears down WHATEVER kind is currently active,
 * dispatching to that kind's own teardown body ({@link disposeThreejsSession}/
 * {@link disposePixiSession}/{@link disposeReactSession}) — the exact same
 * per-kind dispose semantics as before the collapse (resizeObserver disconnect,
 * `exitPlayScene`, mount/embed dispose, undo-adapter unregister,
 * authoring/systems/mount-failure clears, canvas removal, react `stop()`),
 * just no longer gated behind "is THIS kind the one currently active" — every
 * mount entry guard calls this unconditionally, closing the cross-kind leak
 * (F26 residual): switching kinds always disposes the prior session, whichever
 * kind it was. {@link unmountThreeIngestRoot}/{@link unmountCanvasIngestRoot}/
 * {@link unmountDomIngestRoot} become thin wrappers around this that only act
 * when the slot holds their own kind — so a same-kind caller sees the exact
 * same observable behavior as before the collapse.
 *
 * D-V2 (composite): a composite session's `siblings` (mounted by
 * `ingest-siblings.ts`'s `mountIngestSiblings`, attached via
 * `attachIngestSiblings`) tear down FIRST, in REVERSE mount order,
 * before the primary session's own per-kind dispose body runs — every kind
 * shares this ONE teardown path, so a sibling never outlives the ingest
 * session it was mounted beside. A throwing sibling `dispose()` is caught
 * individually (never blocks the rest of teardown) and logged loudly, never
 * silently swallowed.
 */
export function exitActiveIngest(): void {
  // The realm reload translation belongs to the session that just ended.
  setGameRealmReloadHandler(null);
  const active = activeIngest();
  if (!active) return;
  setActiveIngest(null);
  resetIngestPlaySurface();
  // THE GAME'S OWN WAY OUT RUNS FIRST. A contract-declared `lifecycle.dispose`
  // is the one door that can end what the game's boot created — a self-booting
  // R3F root's frame loop is not the host's to stop (see the contract slot's
  // doc for the measured per-frame TypeError storm a dead mount's `useFrame`
  // produced without it). Read before `reclaimGameRealm` ends the realm the
  // contract lives in; declaration-gated, so a game that declares nothing
  // (every canvas warm-remount game) is untouched.
  try {
    readIngestGameContract()?.lifecycle?.dispose?.();
  } catch (err) {
    editorConsole.error(`The game's own lifecycle.dispose threw at teardown: ${err}`, 'ingest');
  }
  for (let i = active.siblings.length - 1; i >= 0; i--) {
    try {
      active.siblings[i]!.dispose();
    } catch (err) {
      editorConsole.error(`Composite sibling dispose failed: ${err}`, 'ingest');
    }
  }
  switch (active.kind) {
    case 'three':
      disposeThreejsSession(active.session);
      return;
    case 'canvas':
      disposePixiSession(active.session);
      return;
    case 'dom':
      disposeReactSession(active.session);
      return;
  }
}

/**
 * D-V1: the three teardown body — byte-for-byte the pre-collapse
 * `unmountThreeIngestRoot` logic below, extracted so {@link exitActiveIngest}
 * can dispatch to it for ANY kind switch, not just a same-kind call.
 * The slot and {@link resetIngestPlaySurface} are handled by the caller — this
 * only does the threejs-specific teardown.
 */
function disposeThreejsSession(s: IngestSession): void {
  // The concrete ingest adapter owns a session history resource. Dispose it
  // when present; minimal/custom authoring implementations need no teardown.
  if (s.mount?.authoring) {
    s.mount.authoring.dispose?.();
  }
  setActiveAuthoring(null);
  setActiveSystems(null);
  clearMountFailureReports(); // D-W3: no session -> no mount failure left to report either
  s.resizeObserver?.disconnect();
  s.inputGateUnsubscribe?.();
  if (s.mount) {
    try {
      s.store.exitPlayScene();
    } catch {
      /* scene may not have been swapped if capture failed */
    }
  }
  s.store.setPlayState('stopped');

  // Tear down the mounted game (stops its loop, frees renderer, uninstalls trap).
  try {
    s.mount?.game.dispose();
  } catch {
    /* ignore */
  }

  reclaimGameRealm('', 'The ingested game');
  clearIngestHook('__vgaiIngest');
  editorConsole.log('Ingest root unmounted', 'ingest');
}

/**
 * D-V1: the pixi teardown body — byte-for-byte the pre-collapse
 * {@link unmountCanvasIngestRoot} logic, extracted so {@link exitActiveIngest}
 * can dispatch to it for ANY kind switch. The slot and
 * {@link resetIngestPlaySurface} are handled by the caller — this only does the
 * pixi-specific teardown.
 */
function disposePixiSession(s: IngestSession2D): void {
  // v4 §7.1-13: the live canvas write target now self-registers with the undo
  // timeline (mirrors `ThreeAuthoringAdapter` — see disposeThreejsSession's
  // identical call above), so this session's entries must be dropped the same
  // way on exit.
  if (s.adapter) {
    s.adapter.dispose();
  }
  setActiveAuthoring(null);
  setActiveSystems(null);
  clearMountFailureReports(); // D-W3: no session -> nothing left to report
  s.store.setPlayState('stopped');
  try {
    s.dispose();
  } catch {
    /* ignore */
  }
  reclaimGameRealm('', 'The ingested canvas game');
  clearIngestHook('__vgaiIngest2D');
  editorConsole.log('canvas ingest root unmounted', 'ingest');
}

/**
 * D-V1: the react teardown body — byte-for-byte the pre-collapse
 * {@link unmountDomIngestRoot} logic, extracted so {@link exitActiveIngest} can
 * dispatch to it for ANY kind switch. The slot and
 * {@link resetIngestPlaySurface} are handled by the caller — this only does the
 * react-specific teardown.
 */
function disposeReactSession(s: IngestSessionReact): void {
  // Disposal expires its session history and releases listeners.
  s.adapter.dispose();
  setActiveAuthoring(null);
  setActiveSystems(null);
  clearMountFailureReports(); // D-W3: no session -> nothing left to report (mirrors disposeThreejsSession's identical call)
  s.store.setPlayState('stopped');
  try {
    s.stop();
  } catch {
    /* ignore */
  }
  reclaimGameRealm('', 'The ingested DOM game');
  clearIngestHook('__vgaiIngestReact');
  editorConsole.log('DOM ingest root unmounted', 'ingest');
}

/**
 * Unmount a three ingest root: restore the editor scene and tear down the game.
 * D-V1: a thin wrapper that only acts when a three session is the one currently
 * in the slot — same observable behavior as before the collapse (a no-op if
 * nothing, or a DIFFERENT kind, is active); the actual teardown is
 * {@link disposeThreejsSession} via {@link exitActiveIngest}.
 */
export function unmountThreeIngestRoot(): void {
  if (activeIngest()?.kind !== 'three') return;
  exitActiveIngest();
}

/**
 * Unmount a canvas ingest root: tear down the captured game + adapter. D-V1: a
 * thin wrapper that only acts when a canvas session is the one currently in the
 * slot — same observable behavior as before the collapse; the actual teardown
 * is {@link disposePixiSession} via {@link exitActiveIngest}.
 */
export function unmountCanvasIngestRoot(): void {
  if (activeIngest()?.kind !== 'canvas') return;
  exitActiveIngest();
}

/**
 * Unmount a DOM (native-React) ingest root: unmount the react world + tear down
 * its Game/loop. D-V1: a thin wrapper that only acts when a dom session is the
 * one currently in the slot — same observable behavior as before the collapse;
 * the actual teardown is {@link disposeReactSession} via
 * {@link exitActiveIngest}.
 */
export function unmountDomIngestRoot(): void {
  if (activeIngest()?.kind !== 'dom') return;
  exitActiveIngest();
}
