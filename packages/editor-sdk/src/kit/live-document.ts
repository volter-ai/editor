/**
 * THE LIVE DOCUMENT's lifetime — the host's one center document for running
 * content (`workspace:game`, titled `Game`). When nothing runs there is no
 * live document at all — no tab, no panel, no hidden-but-mounted host.
 *
 * The editor's standing center documents are the authoring ones (Scene / the
 * world documents, `UI`, `3D`). The live document is not one of them: it is
 * the running lane's own surface, so it EXISTS exactly as long as a runtime
 * does. It is installed when a runtime is about to mount and closed when
 * that runtime ends, through the ordinary `workspace-document-registry`
 * path every other document uses — never a parallel host, never a
 * permanently-mounted panel whose tab is hidden.
 *
 * ## Resource ownership (stated here, once)
 *
 * This module OWNS the open/close of `workspace:game`, the focus it borrows,
 * and the CONTAINER element every lane mounts into. Sharers:
 * `components/CenterDocuments.tsx` binds the session's tab hook
 * ({@link bindLiveDocument}) and reports play-state edges
 * ({@link syncLiveDocumentPlayState}); the package that runs things registers
 * what the document DRAWS ({@link registerLiveDocumentContent}, through
 * `@volter/editor-sdk/host`'s `workspace.liveDocument`) and its panel reports
 * the container's attach/detach ({@link setLiveDocumentContainer} /
 * {@link releaseLiveDocumentContainer}); the runtimes that {@link
 * acquireLiveDocument} are exactly the ones that MOUNT INTO the container —
 * Play, the module lane's two enter paths, and each per-surface ingest mount
 * — each acquiring immediately before it reads {@link liveDocumentContainer}.
 * A dispatcher above them (`ingest/mount-ingest-root.ts`) never acquires: a
 * second, earlier acquire there could only refuse ahead of the mount that
 * owns the answer. {@link releaseLiveDocument} is the ONE teardown path and
 * it is idempotent — a failed play calls it directly, and every ordinary stop
 * reaches it through the playing → stopped edge.
 *
 * ## Why acquiring is asynchronous
 *
 * A runtime mounts into the document's own DOM (the registered content's
 * panel), so the element only exists once React has committed the panel
 * that this module just opened. `acquireLiveDocument` therefore opens the
 * document and then waits for that commit, which the panel reports through
 * {@link setLiveDocumentContainer}.
 */

import type { LiveDocumentContent, LiveDocumentContentProps } from '@volter/editor-sdk/host';
import type { ComponentType } from 'react';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocumentId,
  closeWorkspaceDocument,
  openWorkspaceDocument,
  openWorkspaceDocuments,
  type WorkspaceDocumentDescriptor,
} from '@volter/editor-sdk/kit/workspace-document-registry';

/** How long an acquire waits for the panel's first commit before giving up.
 *  The caller's failure message ("the game container is not mounted…") is the
 *  honest report; hanging forever would be worse than a bounded refusal. */
const CONTAINER_MOUNT_TIMEOUT_MS = 4000;

/** The editor session's binding: the live document exists only while one is bound. */
interface LiveDocumentHooks {
  readonly session: true;
}

let _hooks: LiveDocumentHooks | null = null;
let _content: LiveDocumentContent | null = null;
let _container: HTMLElement | null = null;
let _containerMounted = false;
let _restoreDocumentId: string | null = null;
let _wasLive = false;
const _mountWaiters = new Set<() => void>();

/** Reached only when a lane acquires the document before any package
 *  registered content — a build that mounts nothing never opens it. */
const NoLiveContent: ComponentType<LiveDocumentContentProps> = () => null;

function descriptor(): WorkspaceDocumentDescriptor | null {
  const hooks = _hooks;
  if (!hooks) return null;
  const content = _content;
  return {
    id: GAME_DOCUMENT_ID,
    title: 'Game',
    kind: 'game',
    workspaceRole: 'authored-subject',
    Content: content?.Content ?? NoLiveContent,
    // The document-local toolbar — the lane's own — appears only while the
    // live document is active (§6.3).
    ...(content?.Toolbar ? { Toolbar: content.Toolbar } : {}),
    closeable: false,
    presentation: () => ({ kind: 'workspace', id: GAME_DOCUMENT_ID }),
  };
}

/**
 * Bind this editor session. `useCenterDocuments` calls this in
 * the same effect that installs the other center documents, and the returned
 * cleanup releases the document with the session.
 */
export function bindLiveDocument(): () => void {
  const hooks: LiveDocumentHooks = { session: true };
  _hooks = hooks;
  return () => {
    if (_hooks !== hooks) return;
    releaseLiveDocument();
    _hooks = null;
  };
}

/** The package that runs things registers what the document draws. While
 *  the document is open, re-registering refreshes its mount slots. */
export function registerLiveDocumentContent(content: LiveDocumentContent): () => void {
  _content = content;
  if (liveDocumentOpen()) {
    const next = descriptor();
    if (next) openWorkspaceDocument(next, { activate: false });
  }
  return () => {
    if (_content === content) _content = null;
  };
}

/** Whether the live document is currently open. */
export function liveDocumentOpen(): boolean {
  return openWorkspaceDocuments().some((d) => d.descriptor.id === GAME_DOCUMENT_ID);
}

/**
 * Bring the live document to the front, if it is open. Answers whether it was.
 *
 * ▶ IS A DELIBERATE ACT ON THE GAME, and this is the half a BOOT-MOUNTED
 * ingest was missing. `landIngestBootInEdit` puts the authoring Scene in front
 * at mount — correctly, because that mount IS edit mode — and until 2026-09-20
 * nothing moved it back: the ingest transport's ▶ released content time and
 * left the person looking at the Scene, which for `three-points-waves` is the
 * honest "No renderable content" card while the points ran unseen behind it
 * (walk 3, beat 19). A play-time mount already does this for itself
 * (`deferred-ingest-play.ts` activates this document).
 *
 * It activates rather than writing the viewport tab because THIS module owns
 * `workspace:game`: activation fires the descriptor's `onActivate`, which is
 * the one place that writes `activeViewportTab = 'play'` — so the tab, the
 * registry and the input gate cannot drift apart. A caller with no store in
 * hand (the ingest play control is a pure control surface) needs exactly this.
 */
export function activateLiveDocument(): boolean {
  if (!liveDocumentOpen()) return false;
  return activateWorkspaceDocument(GAME_DOCUMENT_ID);
}

/** The container element every lane mounts into, or null while no panel is
 *  committed. */
export function liveDocumentContainer(): HTMLElement | null {
  return _container;
}

/** The panel's ATTACH half. */
export function setLiveDocumentContainer(el: HTMLElement): void {
  _container = el;
  _containerMounted = true;
  for (const waiter of [..._mountWaiters]) waiter();
  _mountWaiters.clear();
}

/**
 * The panel's DETACH half, keyed by the element it is letting go of — never
 * a bare "set null".
 *
 * Two panel instances briefly coexist whenever the live document closes and
 * reopens in one gesture (every ingest mount's `exitActiveIngest()` →
 * `acquireLiveDocument()` sequence), and React gives no cross-component
 * ordering promise between the old panel's cleanup ref and the new panel's
 * attach ref. Measured on bubbo-bubbo (2026-08-21, probe in the mount path):
 * the acquire resolved `true` in 36ms — the NEW panel's element had attached
 * — and the container was null anyway, because the OLD panel's cleanup ran
 * after the attach and clobbered the singleton. Keying the release on the
 * element makes a stale panel's cleanup a no-op: only the panel that still
 * OWNS the slot may empty it.
 */
export function releaseLiveDocumentContainer(el: HTMLElement): void {
  if (_container !== el) return;
  _container = null;
  _containerMounted = false;
}

/**
 * Install the live document and resolve once its container has mounted.
 *
 * Called by every runtime that mounts into that container — play, ingest and
 * module mode — BEFORE it reads {@link liveDocumentContainer}. Resolves `false` when no
 * session has bound a descriptor, or when the panel did not commit in time; the
 * caller reports that as its own start failure rather than mounting into
 * nothing.
 *
 * Opening ACTIVATES the document (entering a runtime is a deliberate act on the
 * game), and remembers whichever document had focus so
 * {@link releaseLiveDocument} can hand it back.
 */
export async function acquireLiveDocument(
  timeoutMs = CONTAINER_MOUNT_TIMEOUT_MS,
): Promise<boolean> {
  const next = descriptor();
  if (!next) return false;
  if (!liveDocumentOpen()) {
    _restoreDocumentId = activeWorkspaceDocumentId();
    openWorkspaceDocument(next);
  } else {
    activateWorkspaceDocument(next.id);
  }
  if (_containerMounted) return true;
  return new Promise<boolean>((resolve) => {
    const waiter = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      _mountWaiters.delete(waiter);
      resolve(_containerMounted);
    }, timeoutMs);
    _mountWaiters.add(waiter);
  });
}

/**
 * The ONE teardown path: close the live document and give focus back to
 * whatever held it before the runtime borrowed it. Idempotent — safe from a
 * failed start and from an ordinary stop, both of which reach it.
 */
export function releaseLiveDocument(): void {
  if (!_hooks || !liveDocumentOpen()) {
    _restoreDocumentId = null;
    return;
  }
  const restore = _restoreDocumentId;
  _restoreDocumentId = null;
  // THE LATCH GOES STALE-FALSE HERE, EAGERLY — before React has flushed the
  // panel's unmount. Closing the document makes "the container is mounted"
  // untrue at THIS line, but the panel's own detach only
  // lands on the next React commit, so between here and that commit the latch
  // used to still say true. A caller that tears a runtime down and
  // immediately re-acquires (every ingest mount's `exitActiveIngest()` →
  // `acquireLiveDocument()` sequence) then got an instant `true` from the
  // stale latch, read the container in the unmount gap, and refused
  // with "Game container not mounted" — measured on bubbo-bubbo (2026-08-21):
  // every ▶ after a creation-site write failed this way, because the write is
  // what first materializes the held ingest session the next play must tear
  // down. Clearing the latch first makes the re-acquire genuinely WAIT for
  // the reopened panel's commit, which is the contract its doc claims.
  _containerMounted = false;
  // `discardDirty` because the live document is never an authored draft — it
  // has nothing to save and a close must never be refused.
  closeWorkspaceDocument(GAME_DOCUMENT_ID, { discardDirty: true });
  // Closing already activated a neighbour (the registry's own "there is always
  // an active center document" fallback); restoring the pre-play document is
  // only a correction of WHICH one, never a rescue from having none.
  if (restore) activateWorkspaceDocument(restore);
}

/**
 * Report the store's live/stopped state on every notify. A runtime ENDING is
 * the edge that closes the document; the stopped state on its own must not,
 * because {@link acquireLiveDocument} deliberately runs while the store still
 * says stopped (a runtime needs the container before it can start).
 */
export function syncLiveDocumentPlayState(live: boolean): void {
  if (_wasLive && !live) releaseLiveDocument();
  _wasLive = live;
}

/** Test-only reset — drops the binding and every latch WITHOUT closing. */
export function __resetLiveDocumentForTest(): void {
  _hooks = null;
  _content = null;
  _container = null;
  _containerMounted = false;
  _restoreDocumentId = null;
  _wasLive = false;
  _mountWaiters.clear();
}
