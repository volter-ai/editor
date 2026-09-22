/**
 * THE PALETTE'S ACTION TABLE — built once, read by whichever palette owns the
 * window (`editor-commands.ts`, WORK.md §The core is Code-OSS U8).
 *
 * `buildPaletteActions` is the list a palette assembles
 * inline in a `useMemo`. It is a function here for one reason: under the
 * Code-OSS frame our palette is never mounted, and the WORKBENCH's ⌘⇧P has to
 * list the same entries with the same labels. One author, two readers.
 *
 * `PaletteActionPublisher` is the frame's reader. It renders nothing; it
 * subscribes to exactly what the palette's `useMemo` depended on (the shell
 * store, the history commands, the contributed-chrome version) and publishes
 * the resulting table into `editor-commands.ts`, where the bridge picks it
 * up. It republishes only when the table's SIGNATURE changes — the store
 * emits on every shell change and re-registering three dozen VS Code menu
 * items for an unchanged list would be churn the frame can see.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { buildEntityActions, buildStaticActions, type EditorAction } from '../action-registry';
import { buildBoardOpenActions } from '../board-open-actions';
import {
  contributedActions,
  contributedChromeVersion,
  subscribeContributedChrome,
} from '../chrome-registry';
import { publishPaletteActions } from '../editor-commands';
import { useEditorStore, useHistoryCommandSnapshot, useHistoryCommands } from '../editor-runtime';
import type { EditorShellStore } from '../editor-shell-store';
import type { HistoryCommandSnapshot, HistoryCommands } from '../history/history-commands';
import { editorKeymapsVersion, subscribeEditorKeymap } from '../keymap-presets';
import { subscribeWorkspaceStyles, workspaceStylesVersion } from '../workspace-style';
import { buildProjectToolActions } from './project-tool-documents';
import { buildToolActions } from './tool-documents';

/**
 * Every action the palette would list, in the order it groups them. Reads
 * live snapshots throughout: the caller re-invokes rather than this caching.
 */
export function buildPaletteActions(
  store: EditorShellStore,
  history: HistoryCommands,
  historySnapshot: HistoryCommandSnapshot,
): EditorAction[] {
  const statics = buildStaticActions(store, history, historySnapshot);
  // W3 (workspace-shell §9/W3) — document-open discovery lives HERE now
  // that the permanent bottom tabs are gone: document-placement project
  // tools and contributed documents. All read live snapshots. A PACKAGE's
  // live set (the Behavior debugger's one action per running actor) arrives
  // through `contributedActions()` below, pushed by its own service — the
  // host names no package here.
  const documents = [
    ...buildProjectToolActions(store),
    ...buildBoardOpenActions(),
    ...buildToolActions(store),
  ];
  const entities = buildEntityActions(store);
  // A package's actions (`@volter/editor-sdk/chrome`), beside the editor's own.
  const contributed: EditorAction[] = contributedActions().map((action) => ({
    id: action.id,
    label: action.label,
    category: 'action',
    execute: action.execute,
  }));
  return [...statics, ...documents, ...contributed, ...entities];
}

function signatureOf(actions: readonly EditorAction[]): string {
  return actions.map((action) => `${action.id}\u0000${action.label}`).join('\u0001');
}

/** Renders nothing: it publishes the action table ⌘⇧P lists. Mounted by
 *  `DefaultEditorLayout`. */
export function PaletteActionPublisher() {
  const store = useEditorStore();
  const history = useHistoryCommands();
  const historySnapshot = useHistoryCommandSnapshot();
  const chromeVersion = useSyncExternalStore(
    subscribeContributedChrome,
    contributedChromeVersion,
    contributedChromeVersion,
  );
  // The store's own version: the entity actions are the SELECTION's, so the
  // table is stale the moment a selection changes without this.
  const shellVersion = useSyncExternalStore(
    store.subscribe,
    store.getShellSnapshot ?? store.getSnapshot,
  );
  // THE LOOK AND THE KEYMAP REGISTRIES, which `buildStaticActions` also reads
  // and neither of the two above covers. A package registers its
  // `workspace.style`/`workspace.keymap` contribution when the project's
  // packages load — AFTER this publisher first mounts — and without these two
  // subscriptions the table it published is the one from before that moment,
  // permanently: under the frame this component is mounted for the window's
  // whole life, so nothing ever re-runs the memo. Measured 2026-09-20 on a
  // `--template models` scaffold: ⌘⇧P listed `VGAI: Workspace Style: Classic /
  // Glass / Maya / Substance` and NOT `Blender`, so the one gesture that
  // switches the LOOK (palette + material + icons + regions in one act, which
  // is why it is a command and not a settings key) did not exist in the only
  // palette that window has — walk 2's beat 10. Standalone was hidden by an
  // accident: a palette component is mounted per open, so an identical memo
  // is fresh every time.
  const styleVersion = useSyncExternalStore(
    subscribeWorkspaceStyles,
    workspaceStylesVersion,
    workspaceStylesVersion,
  );
  const keymapVersion = useSyncExternalStore(
    subscribeEditorKeymap,
    editorKeymapsVersion,
    editorKeymapsVersion,
  );
  const actions = useMemo(
    () => buildPaletteActions(store, history, historySnapshot),
    // The four versions ARE the subscriptions' snapshots: they are dependencies
    // so that a package loading, or a selection changing, re-lists the table.
    [store, history, historySnapshot, chromeVersion, shellVersion, styleVersion, keymapVersion],
  );
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    const signature = signatureOf(actions);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    publishPaletteActions(
      actions.map((action) => ({
        id: action.id,
        label: action.label,
        category: action.category,
        run: action.execute,
      })),
    );
  }, [actions]);
  useEffect(
    () => () => {
      lastSignature.current = null;
      publishPaletteActions([]);
    },
    [],
  );
  return null;
}
