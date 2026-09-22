import { PROJECT_ASSET_COMMANDS } from './asset-workflow/project-asset-commands';
import { getActiveAuthoring } from './authoring/active-adapter';
import { NO_AUTHORING_ID } from './authoring/no-authoring-adapter';
import {
  activeHierarchyRows,
  selectAllAuthoringNodes,
  selectAuthoringNodes,
} from './authoring/shell-document-ops';
import {
  alignCameraToViewport,
  cameraAuthoringPresentation,
  currentCameraAuthoringSubject,
  leaveCameraView,
  pilotCamera,
  toggleCameraPreviewPin,
  viewThroughCamera,
} from './camera-authoring';
import { openAccountDocument } from './components/account-documents';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteSelection,
} from './editor-hotkeys';
import type { EditorShellStore } from './editor-shell-store';
import type { HistoryCommandSnapshot, HistoryCommands } from './history/history-commands';
import { editorKeymaps, setEditorKeymapPreference, shortcutFor } from './keymap-presets';
import { requestTransformMode } from './transform-mode-request';
import { openUndoHistory } from './workspace-aux-commands';
import { CORE_WORKSPACE_UTILITIES } from './workspace-core-utilities';
import {
  showWorkspaceStaticPanel,
  showWorkspaceUtility,
  toggleWorkspaceFocus,
} from './workspace-host-commands';
import {
  cycleEditorWorkspace,
  editorWorkspaces,
  setEditorWorkspace,
  workspaceApplies,
} from './workspace-presets';
import { applyWorkspaceStyle, workspaceStyles } from './workspace-style';
import { toggleConsoleUtility } from './workspace-utility-commands';

export interface EditorAction {
  id: string;
  label: string;
  category: 'action' | 'entity' | 'asset';
  /**
   * The printed hint, resolved from the ACTIVE keymap (`keymap-presets.ts`)
   * rather than spelled here — so the palette tells the truth under `blender`
   * as well as `vgai`. Explicitly `| undefined` because a keymap may leave an
   * action deliberately unbound, and printing a stale key would be worse than
   * printing none.
   */
  shortcut?: string | undefined;
  execute: () => void | Promise<void>;
}

const RECENT_KEY = 'editor:recent-actions';
const MAX_RECENT = 10;

export function getRecentActionIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function pushRecentAction(id: string): void {
  const recent = getRecentActionIds().filter((r) => r !== id);
  recent.unshift(id);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

/** Build the static list of editor command actions. */
export function buildStaticActions(
  store: EditorShellStore,
  history: HistoryCommands,
  historySnapshot?: HistoryCommandSnapshot,
): EditorAction[] {
  const isMac = navigator.platform.includes('Mac');
  const mod = isMac ? '\u2318' : 'Ctrl+';
  const cameraPresentation = cameraAuthoringPresentation();
  const cameraSubject = currentCameraAuthoringSubject();
  const authoring = getActiveAuthoring(store);
  const clipboardIds = [...store.selectedEntityIds];
  const selectedId = clipboardIds[0];
  const pasteParentId = selectedId
    ? (authoring.hierarchy.node(selectedId)?.parentId ?? null)
    : null;
  const canCopy =
    clipboardIds.length > 0 &&
    !!authoring.structure?.copy &&
    (authoring.structure.canCopy?.(clipboardIds) ?? true);
  const canCut = canCopy && !!authoring.structure?.cut;
  const canPaste =
    !!authoring.structure?.paste && (authoring.structure.canPaste?.(pasteParentId) ?? true);
  const clipboardActions: EditorAction[] = [
    ...(canCut
      ? [
          {
            id: 'editor.cut',
            label: 'Cut',
            category: 'action' as const,
            shortcut: shortcutFor('edit.cut'),
            execute: () => cutSelection(store),
          },
        ]
      : []),
    ...(canCopy
      ? [
          {
            id: 'editor.copy',
            label: 'Copy',
            category: 'action' as const,
            shortcut: shortcutFor('edit.copy'),
            execute: () => copySelection(store),
          },
        ]
      : []),
    ...(canPaste
      ? [
          {
            id: 'editor.paste',
            label: 'Paste',
            category: 'action' as const,
            shortcut: shortcutFor('edit.paste'),
            execute: () => pasteSelection(store),
          },
        ]
      : []),
  ];
  const cameraActions: EditorAction[] = cameraPresentation.view
    ? [
        {
          id: 'camera.exitView',
          label: 'Exit Camera View',
          category: 'action',
          execute: leaveCameraView,
        },
      ]
    : cameraSubject
      ? [
          {
            id: 'camera.viewThrough',
            label: `View Through ${cameraSubject.name}`,
            category: 'action',
            execute: () => viewThroughCamera(cameraSubject),
          },
          ...(cameraSubject.canAuthorPose
            ? [
                {
                  id: 'camera.pilot',
                  label: `Pilot ${cameraSubject.name}`,
                  category: 'action' as const,
                  execute: () => pilotCamera(cameraSubject),
                },
                {
                  id: 'camera.alignToView',
                  label: `Align ${cameraSubject.name} to Current View`,
                  category: 'action' as const,
                  execute: () => alignCameraToViewport(cameraSubject),
                },
              ]
            : []),
          {
            id: 'camera.pinPreview',
            label: cameraPresentation.previewPinned ? 'Unpin Camera Preview' : 'Pin Camera Preview',
            category: 'action',
            execute: toggleCameraPreviewPin,
          },
        ]
      : [];

  return [
    {
      id: 'account.open',
      label: 'Account and Provider Connections',
      category: 'action',
      execute: () => {
        openAccountDocument();
      },
    },
    {
      id: 'editor.undo',
      label: historySnapshot?.undoLabel ? `Undo ${historySnapshot.undoLabel}` : 'Undo',
      category: 'action',
      shortcut: shortcutFor('edit.undo'),
      // H2: shell actions use the project-scoped command service. Its temporary
      // compatibility bridge preserves chronology with producers not yet migrated.
      execute: async () => {
        await history.undo();
      },
    },
    {
      id: 'editor.redo',
      label: historySnapshot?.redoLabel ? `Redo ${historySnapshot.redoLabel}` : 'Redo',
      category: 'action',
      shortcut: shortcutFor('edit.redo'),
      execute: async () => {
        await history.redo();
      },
    },
    ...clipboardActions,
    {
      id: 'editor.duplicate',
      label: 'Duplicate',
      category: 'action',
      shortcut: shortcutFor('edit.duplicate'),
      execute: () => void duplicateSelection(store),
    },
    {
      id: 'editor.delete',
      label: 'Delete Selected',
      category: 'action',
      shortcut: shortcutFor('edit.delete'),
      execute: () => void deleteSelection(store),
    },
    {
      id: 'editor.select-all',
      label: 'Select All',
      category: 'action',
      shortcut: shortcutFor('edit.selectAll'),
      execute: () => selectAllAuthoringNodes(store),
    },
    {
      id: 'editor.deselect',
      label: 'Deselect All',
      category: 'action',
      shortcut: shortcutFor('edit.deselectAll') ?? shortcutFor('edit.exitScopeOrDeselect'),
      execute: () => selectAuthoringNodes(store, []),
    },
    {
      id: 'mode.select',
      label: 'Select Tool (no gizmo)',
      category: 'action',
      shortcut: shortcutFor('transform.select'),
      execute: () => requestTransformMode(store, 'select'),
    },
    {
      id: 'mode.combined',
      label: 'Transform Mode (all handles)',
      category: 'action',
      shortcut: shortcutFor('transform.combined'),
      execute: () => requestTransformMode(store, 'combined'),
    },
    {
      id: 'mode.translate',
      label: 'Translate Mode',
      category: 'action',
      shortcut: shortcutFor('transform.translate'),
      execute: () => requestTransformMode(store, 'translate'),
    },
    {
      id: 'mode.rotate',
      label: 'Rotate Mode',
      category: 'action',
      shortcut: shortcutFor('transform.rotate'),
      execute: () => requestTransformMode(store, 'rotate'),
    },
    {
      id: 'mode.scale',
      label: 'Scale Mode',
      category: 'action',
      shortcut: shortcutFor('transform.scale'),
      execute: () => requestTransformMode(store, 'scale'),
    },
    {
      id: 'mode.world',
      label: 'World Space',
      category: 'action',
      execute: () => store.setTransformSpace('world'),
    },
    {
      id: 'mode.local',
      label: 'Local Space',
      category: 'action',
      execute: () => store.setTransformSpace('local'),
    },
    {
      id: 'toggle.grid',
      label: 'Toggle Grid',
      category: 'action',
      execute: () => store.toggleGrid(),
    },
    {
      id: 'toggle.helpers',
      label: 'Toggle Helpers',
      category: 'action',
      execute: () => store.toggleHelpers(),
    },
    {
      id: 'toggle.stats',
      label: 'Toggle Stats Overlay',
      category: 'action',
      execute: () => store.toggleStats(),
    },
    {
      id: 'toggle.snap',
      label: 'Toggle Snap',
      category: 'action',
      execute: () => store.toggleSnap(),
    },
    {
      id: 'toggle.surface-snap',
      label: 'Toggle Surface Snap',
      category: 'action',
      execute: () => store.toggleSnapToSurface(),
    },
    {
      id: 'shading.solid',
      label: 'Material Shading',
      category: 'action',
      execute: () => store.setShadingMode('solid'),
    },
    {
      id: 'shading.clay',
      label: 'Solid Shading',
      category: 'action',
      execute: () => store.setShadingMode('clay'),
    },
    {
      id: 'shading.wireframe',
      label: 'Wireframe Shading',
      category: 'action',
      execute: () => store.setShadingMode('wireframe'),
    },
    {
      id: 'shading.unlit',
      label: 'Unlit Shading',
      category: 'action',
      execute: () => store.setShadingMode('unlit'),
    },
    {
      id: 'shading.normals',
      label: 'Normal Shading',
      category: 'action',
      execute: () => store.setShadingMode('normals'),
    },
    {
      id: 'shading.overdraw',
      label: 'Overdraw Shading',
      category: 'action',
      execute: () => store.setShadingMode('overdraw'),
    },
    {
      id: 'view.top',
      label: 'Top View',
      category: 'action',
      shortcut: shortcutFor('view.top'),
      execute: () => store.setViewPreset('top'),
    },
    {
      id: 'view.front',
      label: 'Front View',
      category: 'action',
      shortcut: shortcutFor('view.front'),
      execute: () => store.setViewPreset('front'),
    },
    {
      id: 'view.right',
      label: 'Right View',
      category: 'action',
      shortcut: shortcutFor('view.right'),
      execute: () => store.setViewPreset('right'),
    },
    {
      id: 'view.perspective',
      label: 'Perspective View',
      category: 'action',
      shortcut: shortcutFor('view.perspective'),
      execute: () => store.setViewPreset('perspective'),
    },
    {
      id: 'focus.selected',
      label: 'Focus Selected',
      category: 'action',
      shortcut: shortcutFor('viewport.frameSelection'),
      execute: () => store.focusOnSelection(),
    },
    ...cameraActions,
    {
      id: 'toggle.console',
      label: 'Toggle Console',
      category: 'action',
      shortcut: shortcutFor('view.toggleConsole'),
      execute: () => {
        toggleConsoleUtility();
      },
    },
    {
      id: 'view.focusMode',
      label: 'Toggle Focus Mode',
      category: 'action',
      shortcut: shortcutFor('view.focusMode'),
      execute: () => {
        toggleWorkspaceFocus();
      },
    },
    // NAMED WORKSPACES (ARCHITECTURE-CORE §Editor chrome): one action per
    // registered workspace, plus the cycle pair. The ruling calls for these to
    // be palette-ready, which is exactly what this registry is — a seventh
    // workspace would appear here on its own.
    ...editorWorkspaces().map(
      (choice): EditorAction => ({
        id: `workspace.${choice.id}`,
        label: `Workspace: ${choice.title}`,
        category: 'action',
        execute: () => {
          // A workspace the project's declared shape does not meet is not a
          // destination (ARCHITECTURE-CORE §Roots).
          if (workspaceApplies(choice.id)) setEditorWorkspace(choice.id);
        },
      }),
    ),
    {
      id: 'workspace.cycleNext',
      label: 'Next Workspace',
      category: 'action',
      // Blender's own workspace cycle keys, and free in this registry.
      shortcut: shortcutFor('workspace.cycleNext'),
      execute: () => {
        cycleEditorWorkspace(1);
      },
    },
    {
      id: 'workspace.cyclePrevious',
      label: 'Previous Workspace',
      category: 'action',
      shortcut: shortcutFor('workspace.cyclePrevious'),
      execute: () => {
        cycleEditorWorkspace(-1);
      },
    },
    // KEYMAPS (ARCHITECTURE-CORE §Editor chrome: "Keymaps are orthogonal to
    // workspaces"). One action per registered keymap, exactly as the workspace
    // axis above — orthogonal to it, and the switch is live.
    ...editorKeymaps().map(
      (choice): EditorAction => ({
        id: `keymap.${choice.id}`,
        label: `Keymap: ${choice.title}`,
        category: 'action',
        execute: () => {
          setEditorKeymapPreference(choice.id);
        },
      }),
    ),
    // Workspace style bundles (Glass-UI spike, Unit 3): one action per named
    // palette+material+icons+regions bundle — a third bundle appears here
    // automatically.
    ...workspaceStyles().map(
      (choice): EditorAction => ({
        id: `view.workspaceStyle.${choice.id}`,
        label: `Workspace Style: ${choice.title}`,
        category: 'action',
        execute: () => {
          applyWorkspaceStyle(choice.id);
        },
      }),
    ),
    {
      id: 'view.undoHistory',
      label: 'Undo History',
      category: 'action',
      execute: () => {
        // Undo History is an on-demand panel, not a permanent tab. The host
        // defaults it beside Inspector but preserves a user's later move.
        // §8 naming: 'Undo History', not 'History'.
        openUndoHistory();
      },
    },
    {
      id: 'view.lightExplorer',
      label: 'Open Light Explorer',
      category: 'action',
      execute: () => showWorkspaceUtility(CORE_WORKSPACE_UTILITIES.lightExplorer.id),
    },
    ...Object.values(PROJECT_ASSET_COMMANDS)
      .filter((command) => command.id !== PROJECT_ASSET_COMMANDS.open.id)
      .map((command) => ({
        id: command.id,
        label: `${command.id
          .replace('project-asset.', '')
          .split('-')
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join(' ')} Project Asset`,
        category: 'asset' as const,
        ...(command.shortcut ? { shortcut: command.shortcut.replace('Mod', mod) } : {}),
        execute: () => {
          window.dispatchEvent(
            new CustomEvent('editor:project-asset-command', { detail: { id: command.id } }),
          );
        },
      })),
    {
      // Content and Library are permanent peer navigators; individual
      // results open as center asset documents.
      id: 'view.asset-library',
      label: 'Asset Library',
      category: 'action' as const,
      execute: () => {
        showWorkspaceStaticPanel('asset-library');
      },
    },
  ];
}

/** Build dynamic node actions from the active authoring adapter's hierarchy.
 *
 *  THE NO-AUTHORING FLOOR IS A MESSAGE, NOT AN ENTITY. `makeNoAuthoringAdapter`
 *  publishes one `role: 'boundary'` row so the panels can say "no authoring
 *  surface" honestly; mapping it like a node put a command literally called
 *  **VGAI Entity: No authoring adapter** in the palette, whose whole effect is
 *  to select and focus nothing (measured under the frame on a Model document,
 *  U8 walk 3, 2026-09-20). */
export function buildEntityActions(store: EditorShellStore): EditorAction[] {
  return activeHierarchyRows(store)
    .filter((row) => row.id !== NO_AUTHORING_ID)
    .map((row) => ({
      id: `entity:${row.id}`,
      label: row.name,
      category: 'entity' as const,
      execute: () => {
        selectAuthoringNodes(store, [row.id]);
        store.focusOnEntity(row.id);
      },
    }));
}
