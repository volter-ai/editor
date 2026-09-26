import {
  AnchoredMenu,
  EditorIcon,
  editorIcons,
  MenuItem,
  MenuTrigger,
  MenuSeparator as Separator,
} from '@volter/editor-sdk/widgets';
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { selectAllAuthoringNodes } from '@volter/editor-sdk/kit/authoring/shell-document-ops';
import { useAvailabilitySelector } from '@volter/editor-sdk/kit/availability-tick';
import {
  contributedChromeVersion,
  contributedDisabledFingerprint,
  contributedMenuItems,
  subscribeContributedChrome,
} from '@volter/editor-sdk/kit/chrome-registry';
import { openCommandPalette } from '@volter/editor-sdk/kit/editor-commands';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { currentEditorViewUrl } from '../editor-current-view';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteSelection,
} from '../editor-hotkeys';
import { useEditorStore, useHistoryCommandSnapshot, useHistoryCommands } from '@volter/editor-sdk/kit/editor-runtime';
import { editorKeymapsVersion, subscribeEditorKeymap } from '@volter/editor-sdk/kit/keymap-presets';
import {
  LEARN_MANUAL_URL,
  LEARN_QUICK_STARTS_URL,
  LEARN_SITE_URL,
  learnReferenceUrl,
  openLearnLink,
  referenceVersionPin,
} from '../learn-links';
import { getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/project-manager';
import { getProjectTools, subscribeProjectTools } from '@volter/editor-sdk/kit/project-tools';
import { getSurfaceToolContributions, subscribeToolContributions } from '../tool-loader';
import { openUndoHistory } from '../workspace-aux-commands';
import { CORE_WORKSPACE_UTILITIES } from '@volter/editor-sdk/kit/workspace-core-utilities';
import {
  showWorkspaceStaticPanel,
  showWorkspaceUtility,
  toggleWorkspaceFocus,
} from '@volter/editor-sdk/kit/workspace-host-commands';
import {
  activeEditorWorkspace,
  editorWorkspaces,
  editorWorkspacesVersion,
  setEditorWorkspace,
  subscribeEditorWorkspace,
  subscribeEditorWorkspaces,
  workspaceApplies,
} from '../workspace-presets';
import { subscribeWorkspaceStyles, workspaceStylesVersion } from '../workspace-style';
import { toggleConsoleUtility } from '@volter/editor-sdk/kit/workspace-utility-commands';
import { openProjectToolsDocument } from './project-tool-documents';
import { openToolDocument } from './tool-documents';

type MenuId = 'edit' | 'view' | 'window' | 'debug' | 'tools' | 'help';

export function ApplicationMenus() {
  const store = useEditorStore();
  const activeAuthoring = getActiveAuthoring(store);
  const structure = activeAuthoring.structure;
  const clipboardIds = [...store.selectedEntityIds];
  const selectedId = clipboardIds[0];
  const pasteParentId = selectedId
    ? (activeAuthoring.hierarchy.node(selectedId)?.parentId ?? null)
    : null;
  const history = useHistoryCommands();
  const historySnapshot = useHistoryCommandSnapshot();
  // DOCUMENTS AND UTILITIES BOTH: this menu is the only door onto a project's
  // `workspace.utility` drawer tab, which registers hidden by default.
  const tools = useSyncExternalStore(
    subscribeToolContributions,
    getSurfaceToolContributions,
    getSurfaceToolContributions,
  );
  // The three look registries: a package's workspace, keymap or style that
  // registers after this menu mounted still lists (WORKBENCH.md §Contribution points).
  useSyncExternalStore(subscribeEditorWorkspaces, editorWorkspacesVersion, editorWorkspacesVersion);
  useSyncExternalStore(subscribeEditorKeymap, editorKeymapsVersion, editorKeymapsVersion);
  useSyncExternalStore(subscribeWorkspaceStyles, workspaceStylesVersion, workspaceStylesVersion);
  useSyncExternalStore(
    subscribeContributedChrome,
    contributedChromeVersion,
    contributedChromeVersion,
  );
  /** A package's items at the end of a menu (`@volter/editor-sdk/chrome`). */
  const contributed = (menu: 'view' | 'window' | 'debug' | 'tools' | 'help') => {
    const items = contributedMenuItems(menu);
    if (items.length === 0) return null;
    return (
      <>
        <Separator />
        {items.map((item) => (
          <MenuItem
            key={item.id}
            {...(item.testId ? { 'data-testid': item.testId } : {})}
            disabled={item.disabled?.({}) ?? false}
            onSelect={choose(() => void item.execute({}))}
          >
            {typeof item.label === 'function' ? item.label() : item.label}
          </MenuItem>
        ))}
      </>
    );
  };
  const commands = useSyncExternalStore(subscribeProjectTools, getProjectTools, getProjectTools);
  const workspace = useSyncExternalStore(
    subscribeEditorWorkspace,
    activeEditorWorkspace,
    activeEditorWorkspace,
  );
  // Help/Learn menu (G6): the Reference link pins to the open project's
  // engine version, so re-render on project change. `getCurrentProject`
  // returns a stable reference between changes.
  const project = useSyncExternalStore(onProjectChange, getCurrentProject, getCurrentProject);
  const engineVersion = project?.config.engine.version ?? null;
  const referencePin = referenceVersionPin(engineVersion);
  const [open, setOpen] = useState<MenuId | null>(null);
  // A contributed item's `disabled` (and dynamic label) is asked at render,
  // and the point promises it may follow session state — which needs
  // SOMETHING to re-render the bar when that state moves. Sample the answers
  // on the shared availability tick, but only while a menu is open: closed,
  // this costs nothing; open, an item can go live or dead under the cursor.
  useAvailabilitySelector(() => (open ? contributedDisabledFingerprint() : ''));
  const rootRef = useRef<HTMLDivElement>(null);
  // ONE STABLE REF PER MENU WORD, minted on first ask. `AnchoredMenu` measures
  // this element every layout pass, so a fresh object per render would rebuild
  // its placement callback on every one.
  const anchorRefs = useRef<Record<string, RefObject<HTMLDivElement | null>>>({});
  const anchorRef = (id: MenuId): RefObject<HTMLDivElement | null> =>
    (anchorRefs.current[id] ??= { current: null });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (action: () => unknown | Promise<unknown>) => () => {
    setOpen(null);
    void action();
  };
  const panels: Record<MenuId, React.ReactNode> = {
    edit: (
      <>
        <MenuItem
          disabled={historySnapshot.busy || !historySnapshot.canUndo}
          onSelect={choose(() => history.undo())}
        >
          {historySnapshot.undoLabel ? `Undo ${historySnapshot.undoLabel}` : 'Undo'}
        </MenuItem>
        <MenuItem
          disabled={historySnapshot.busy || !historySnapshot.canRedo}
          onSelect={choose(() => history.redo())}
        >
          {historySnapshot.redoLabel ? `Redo ${historySnapshot.redoLabel}` : 'Redo'}
        </MenuItem>
        <Separator />
        <MenuItem onSelect={choose(openUndoHistory)}>Undo History…</MenuItem>
        <Separator />
        <MenuItem
          disabled={
            clipboardIds.length === 0 ||
            !structure?.cut ||
            !(structure.canCopy?.(clipboardIds) ?? true)
          }
          onSelect={choose(() => cutSelection(store))}
        >
          Cut
        </MenuItem>
        <MenuItem
          disabled={
            clipboardIds.length === 0 ||
            !structure?.copy ||
            !(structure.canCopy?.(clipboardIds) ?? true)
          }
          onSelect={choose(() => copySelection(store))}
        >
          Copy
        </MenuItem>
        <MenuItem
          disabled={!structure?.paste || !(structure.canPaste?.(pasteParentId) ?? true)}
          onSelect={choose(() => pasteSelection(store))}
        >
          Paste
        </MenuItem>
        <Separator />
        <MenuItem
          disabled={store.selectedEntityIds.size === 0}
          onSelect={choose(() => void duplicateSelection(store))}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          disabled={store.selectedEntityIds.size === 0}
          onSelect={choose(() => void deleteSelection(store))}
        >
          Delete
        </MenuItem>
        <Separator />
        <MenuItem onSelect={choose(() => selectAllAuthoringNodes(store))}>Select All</MenuItem>
        <MenuItem
          disabled={store.selectedEntityIds.size === 0}
          onSelect={choose(() => store.select(null))}
        >
          Deselect All
        </MenuItem>
      </>
    ),
    view: (
      <>
        <MenuItem onSelect={choose(() => openCommandPalette())}>Command Palette…</MenuItem>
        <MenuItem
          onSelect={choose(async () => {
            const url = currentEditorViewUrl(store);
            try {
              await navigator.clipboard.writeText(url);
              editorConsole.log('Copied a link to the current editor view.', 'editor');
            } catch (error) {
              editorConsole.error(
                `Could not copy the editor view link: ${error instanceof Error ? error.message : String(error)}`,
                'editor',
              );
            }
          })}
        >
          Copy View Link
        </MenuItem>
        <Separator />
        <MenuItem onSelect={choose(toggleWorkspaceFocus)}>Toggle Focus Mode</MenuItem>
        {contributed('view')}
      </>
    ),
    window: (
      <>
        {/* NAMED WORKSPACES (ARCHITECTURE-CORE §Editor chrome). This run IS
            `Window → Workspace` — the ruling's switching door, with the active
            one checked. There is deliberately no persistent picker strip, and
            nothing else in the editor calls `setEditorWorkspace`: switching
            happens here, through the registered actions, or through
            `editor.workspace(id)`. */}
        {editorWorkspaces()
          .filter((choice) => workspaceApplies(choice.id))
          .map((choice) => (
            <MenuItem
              key={choice.id}
              role="menuitemradio"
              aria-checked={workspace === choice.id}
              data-testid={`workspace-${choice.id}`}
              title={choice.description}
              onSelect={choose(() => setEditorWorkspace(choice.id))}
            >
              <EditorIcon
                icon={editorIcons.status.success}
                style={{ opacity: workspace === choice.id ? 1 : 0 }}
              />
              Workspace: {choice.title}
            </MenuItem>
          ))}
        <Separator />
        <MenuItem onSelect={choose(toggleConsoleUtility)}>Console</MenuItem>
        <MenuItem
          onSelect={choose(() => showWorkspaceUtility(CORE_WORKSPACE_UTILITIES.lightExplorer.id))}
        >
          Light Explorer
        </MenuItem>
        <MenuItem onSelect={choose(() => showWorkspaceStaticPanel('asset-library'))}>
          Asset Library
        </MenuItem>
        <MenuItem onSelect={choose(() => showWorkspaceUtility('generations'))}>
          Generations
        </MenuItem>
        {contributed('window')}
      </>
    ),
    debug: <>{contributed('debug')}</>,
    tools: (
      <>
        <MenuItem onSelect={choose(() => openProjectToolsDocument())}>
          Project Tools…
          {commands.tools.length > 0 ? ` (${commands.tools.length})` : ''}
        </MenuItem>
        <Separator />
        {tools.length ? (
          tools.map((tool) => {
            return (
              <MenuItem
                key={tool.id}
                onSelect={choose(() => {
                  if (tool.point === 'workspace.document') openToolDocument(tool.id);
                  else showWorkspaceUtility(`tool:${tool.id}`);
                })}
              >
                {tool.title}
              </MenuItem>
            );
          })
        ) : (
          <MenuItem disabled>No custom project tools</MenuItem>
        )}
        {contributed('tools')}
      </>
    ),
    help: (
      <>
        {/* Learning lives on the Learn SITE — the editor links out (new tab), it
            never embeds lessons. Reference pins to the project's engine
            version (`/reference/<major>.<minor>/`, the zero-base immutable
            snapshot routes); with no parseable version it falls back to the
            unpinned reference root. URL shapes: `learn-links.ts`. */}
        <MenuItem
          data-testid="help-learn-home"
          onSelect={choose(() => openLearnLink(LEARN_SITE_URL))}
        >
          vgai Learn
        </MenuItem>
        <MenuItem
          data-testid="help-quick-starts"
          onSelect={choose(() => openLearnLink(LEARN_QUICK_STARTS_URL))}
        >
          Quick-starts
        </MenuItem>
        <MenuItem
          data-testid="help-manual"
          onSelect={choose(() => openLearnLink(LEARN_MANUAL_URL))}
        >
          Manual
        </MenuItem>
        <Separator />
        <MenuItem
          data-testid="help-reference"
          title={
            referencePin
              ? `API/schema reference pinned to this project's engine (v${engineVersion})`
              : 'API/schema reference (no engine version pin available)'
          }
          onSelect={choose(() => openLearnLink(learnReferenceUrl(engineVersion)))}
        >
          {referencePin ? `Reference for v${engineVersion}` : 'Reference'}
        </MenuItem>
        {contributed('help')}
      </>
    ),
  };

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', alignItems: 'stretch', marginLeft: 'var(--vgai-space-2)' }}
    >
      {(['edit', 'view', 'window', 'debug', 'tools', 'help'] as const).map((id) => (
        <div key={id} ref={anchorRef(id)} style={{ position: 'relative' }}>
          <MenuTrigger
            data-testid={`app-menu-${id}`}
            aria-haspopup="menu"
            aria-expanded={open === id}
            onClick={() => setOpen((current) => (current === id ? null : id))}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              setOpen(id);
            }}
            onPointerEnter={() => {
              if (open) setOpen(id);
            }}
            style={{ textTransform: 'capitalize' }}
          >
            {id}
          </MenuTrigger>
          {open === id && (
            /* PORTALED, NOT `position: absolute`. These words live in the app's
                 title bar, and under the Code-OSS frame that bar is the workbench's
                 own `.part.titlebar` — 26 px tall with `overflow: hidden`, as are
                 `.titlebar-container` and our host slot inside it. An absolutely
                 positioned popup was laid out correctly (190x279, every item with a
                 box) and PAINTED one row: measured 2026-09-20 on U8's walk 3, where
                 the Window menu showed `Workspace: Model` and hid eleven items.
                 `AnchoredMenu` is the same primitive the toolbar, the telemetry
                 cluster and the Object3D toolbar already use for exactly this — it
                 measures the trigger, places the menu in viewport coordinates and
                 portals it to the theme root, which is outside every clip. */
            <AnchoredMenu
              anchorRef={anchorRef(id)}
              dismissBoundaryRef={anchorRef(id)}
              align="start"
              gap={0}
              clamp
              autoFocusFirst
              onDismiss={() => {
                const trigger = rootRef.current?.querySelector<HTMLButtonElement>(
                  `[data-testid="app-menu-${id}"]`,
                );
                setOpen(null);
                requestAnimationFrame(() => trigger?.focus());
              }}
              style={{ minWidth: 190 }}
            >
              {panels[id]}
            </AnchoredMenu>
          )}
        </div>
      ))}
    </div>
  );
}
