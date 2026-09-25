import { threeStateOf } from '../three-state';
import { lazy, Suspense, use, useEffect, useSyncExternalStore } from 'react';
import { connectAssetEvents } from '../asset-events';
import { installAssetSelectionAutoClear } from '../asset-selection';
import { registerEditorShellHotkeys } from '../editor-hotkeys';
import {
  useEditorInit,
  useEditorStore,
  useHistoryCommands,
  useHistoryService,
} from '../editor-runtime';
import { installAuxiliaryEvents } from '../workspace-aux-commands';
import { installUtilityAutoOpen } from '../workspace-utility-commands';
import { AgentPresentationNotice } from './AgentPresentationNotice';
import { useCenterDocuments } from './CenterDocuments';
import { ensureCoreUtilitiesRegistered } from './core-utilities';
import { installKindDocumentRefresh } from './kind-documents';
import { ProjectLayout } from './ProjectLayout';
import { PaletteActionPublisher } from './palette-action-publisher';
import { ensureCoreStatusContributionsRegistered } from './status-contributions';
import { installStandingToolDocuments } from './tool-documents';
import { setWorkspaceHistoryService } from '@volter/editor-sdk/kit/components/workspace-history';

// Session discovery remains alive even when every document tab is closed.
const ProjectAuthoringBootstrap = lazy(async () => {
  const module = await import('./NonThreeAuthoringBootstrap');
  return { default: module.ProjectAuthoringBootstrap };
});

export function DefaultEditorLayout() {
  const store = useEditorStore();
  const history = useHistoryService();
  const historyCommands = useHistoryCommands();
  use(useEditorInit()); // suspends until project is detected

  // Subscribe to store changes: the reads below are what need it; the version
  // itself is not read.
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  // W1 — install the authored document plus the warm runtime host (whose Game
  // tab is rail-visible only while active) and keep registry activation synced
  // with the store's activeViewportTab (T6.3 gate).
  useCenterDocuments(store);
  // W3 (workspace-shell §9/W3) — the shell contributions the new center
  // documents ride on:
  //  - the STANDING tool documents (`installStandingToolDocuments`): every
  //    discovered document contribution the project declares `standing` opens
  //    as a pinned board beside `3D`/`UI`/`Dev` and stays in step with
  //    discovery, so a capability added mid-session brings its tab with it and
  //    a deleted one takes its tab away. The editor owns no per-asset
  //    documents of its own — a capability's own tool is what puts a board
  //    here (the `data-tables` Data tab is the worked case);
  //  - the Build Output utility + build-progress status contribution
  //    (server mode only — builds spawn npm scripts server-side).
  // W4 (workspace-shell §9/W4) — status-bar contributions register BEFORE the
  // build ensure below so the order-0 items sequence save-status first; the
  // utility auto-open watcher (save/build failure → the right utility) is
  // per-store. Core utilities register before the host reconciles.
  useEffect(() => ensureCoreStatusContributionsRegistered(), []);
  useEffect(() => ensureCoreUtilitiesRegistered(), []);
  useEffect(() => installUtilityAutoOpen(history), [history]);
  useEffect(() => installAuxiliaryEvents(), []);
  useEffect(() => installStandingToolDocuments(), [store]);
  useEffect(() => installKindDocumentRefresh(), [store]);
  useEffect(() => setWorkspaceHistoryService(history), [history]);
  // Undo/redo/save/delete live here, not on the world root's stage: a canvas-only
  // project never mounts that panel, and Ctrl+Z was a silent no-op there.
  useEffect(() => registerEditorShellHotkeys(store, historyCommands), [store, historyCommands]);
  // W2 (§5.1) — an ENTITY selection change drops the asset selection, so the
  // Inspector goes back to being purely entity-contextual (asset-selection.ts).
  useEffect(() => installAssetSelectionAutoClear(store), [store]);

  // Subscribe to server-sent asset move events (file watcher)
  useEffect(() => {
    // Purely a REFRESH signal. Documents that carry asset refs are rewritten
    // by `project-asset-operations.ts` as part of the move itself, so nothing
    // here rewrites anything in memory.
    return connectAssetEvents(
      () => window.dispatchEvent(new CustomEvent('editor:assets-changed')),
      (detail) => window.dispatchEvent(new CustomEvent('editor:assets-changed', { detail })),
    );
  }, []);

  // There is deliberately NO shell-level document reload watcher here: each
  // adapter owns its own external-change contract
  // (`PersistenceProvider.applyExternal`), because only the adapter knows how
  // to read its own truth back.

  return (
    <>
      {/* Edit-time audio is `@vgai/game`'s `edit-mode-audio.service.ts`: the
          graph it installs is the engine's audio RUNTIME, and the shell used to
          import it for every project including one that plays nothing. */}
      {/* Edit-time networking config (declared server + authored identity) for a
          multiplayer project, with no game running. No-op for single-player. */}
      <Suspense fallback={null}>
        <ProjectAuthoringBootstrap store={threeStateOf(store)} />
      </Suspense>
      <ProjectLayout />
      <AgentPresentationNotice />
      {/* THE PALETTE IS THE WORKBENCH'S (⌘⇧P). This publishes the editor's live
          action table to the bridge, which registers one
          `MenuId.CommandPalette` item per entry with our own label — so the
          workbench's palette lists OUR actions, and there is no second one. */}
      <PaletteActionPublisher />
    </>
  );
}
