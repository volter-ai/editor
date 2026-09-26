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
  contributedMenuItems,
  subscribeContributedChrome,
} from '@volter/editor-sdk/kit/chrome-registry';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import { publishPaletteActions } from '../editor-commands';
import { useEditorStore, useHistoryCommandSnapshot, useHistoryCommands } from '@volter/editor-sdk/kit/editor-runtime';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import type { HistoryCommandSnapshot, HistoryCommands } from '@volter/editor-sdk/kit/history/history-commands';
import { editorKeymapsVersion, shortcutFor, subscribeEditorKeymap } from '@volter/editor-sdk/kit/keymap-presets';
import { subscribeWorkspaceStyles, workspaceStylesVersion } from '../workspace-style';
import { buildProjectToolActions } from './project-tool-documents';
import { buildToolActions } from './tool-documents';

/**
 * Every action the palette would list, in the order it groups them. Reads
 * live snapshots throughout: the caller re-invokes rather than this caching.
 */
export function buildPaletteActions(
  store: ShellStore,
  history: HistoryCommands,
  historySnapshot: HistoryCommandSnapshot,
): EditorAction[] {
  const statics = buildStaticActions(store, history, historySnapshot);
  // W3 (workspace-shell §9/W3) — document-open discovery lives HERE now
  // that the permanent bottom tabs are gone: document-placement project
  // tools and contributed documents. All read live snapshots. A PACKAGE's
  // live set of actions arrives through `contributedActions()` below, pushed
  // by its own service — the host names no package here.
  const documents = [
    ...buildProjectToolActions(),
    ...buildBoardOpenActions(),
    ...buildToolActions(),
  ];
  const entities = buildEntityActions(store);
  // A package's actions (`@volter/editor-sdk/chrome`), beside the editor's own.
  const contributed: EditorAction[] = contributedActions().map((action) => ({
    id: action.id,
    label: action.label,
    category: 'action',
    shortcut: action.shortcut ? shortcutFor(action.shortcut) : undefined,
    execute: action.execute,
  }));
  return [...statics, ...documents, ...contributed, ...applicationMenuActions(), ...entities];
}

const APPLICATION_MENUS = ['view', 'window', 'debug', 'tools', 'help'] as const;
const MENU_TITLES: Record<(typeof APPLICATION_MENUS)[number], string> = {
  view: 'View',
  window: 'Window',
  debug: 'Debug',
  tools: 'Tools',
  help: 'Help',
};

/**
 * A package's APPLICATION MENU items (`workspace.menu`), in the palette as "Debug: Bake NavMesh".
 * Under the Code-OSS frame the editor draws no menubar of its own (a product with `nativeMenus`),
 * so without this an item a package put on Debug or Tools had no door at all. An item its own
 * `disabled` refuses right now says so rather than doing nothing.
 */
function applicationMenuActions(): EditorAction[] {
  return APPLICATION_MENUS.flatMap((menu) =>
    contributedMenuItems(menu).map((item) => {
      const itemLabel = typeof item.label === 'function' ? item.label() : item.label;
      const label = `${MENU_TITLES[menu]}: ${itemLabel}`;
      return {
        id: item.id,
        label,
        category: 'action' as const,
        menu: { id: menu, label: itemLabel },
        execute: () => {
          if (item.disabled?.({})) {
            showTransientHint(`${label} is not available right now.`);
            return;
          }
          return item.execute({});
        },
      };
    }),
  );
}

function signatureOf(actions: readonly EditorAction[]): string {
  return actions.map((action) => `${action.id}\u0000${action.label}\u0000${action.menu?.id ?? ''}`).join('\u0001');
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
        ...(action.menu ? { menu: action.menu } : {}),
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
