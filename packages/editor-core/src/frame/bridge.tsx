/**
 * THE EDITOR'S ENTRY POINT UNDER THE CODE-OSS FRAME — the vgai editor's own app
 * with a VS Code-backed LAYOUT HOST.
 *
 * THIS IS THE EDITOR'S MODULE, IN THE EDITOR'S TREE — forty of its imports are
 * this package's and none is the workbench's, so it is an editor module that
 * happens to mount inside a workbench. The Code-OSS contribution imports
 * whatever `/__editor/served-modules` hands back, and what the session serves
 * is this file (`packages/editor/server/routes/served-modules.ts`).
 *
 * Everything below is the real editor: AppRoot → EditorProvider →
 * DefaultEditorLayout → ProjectLayout → the project's ModelLayout, unchanged. The
 * one thing swapped is `@volter/editor-sdk/layouts`' LayoutHost: the adapter's
 * `<EditorHeader/>`, `<Workspace/>` and `<EditorFooter/>` render through THIS host,
 * which portals ProjectHeader and the active document surface + hierarchy + inspector
 * into the VS Code parts the contribution hands over (title bar, editor pane, two
 * sidebar views). The FOOTER portals nothing: the status bar is the workbench's own
 * and every vgai status item is a real entry in it (see `Footer` below).
 *
 * IT IS THE KIT'S MOUNT, AND IT IS NOT THE SERVED MODULE. A PRODUCT is what the
 * session serves (`packages/game-editor/src/index.ts`,
 * `packages/model-editor/src/index.ts`): it composes its packages, its look and
 * its workspace in code and re-exports this function as `mountVgai`, which is
 * the name the fork's contribution reads off whatever module
 * `/__editor/served-modules` hands it. So this file is product-neutral — it
 * names no package and no product (ARCHITECTURE-CORE §The target shape, rule 1)
 * — and `frame/product.ts` is the door a product calls.
 *
 * The runbook is docs/CODE-OSS.md; the `mountEditor` return value is the frame's
 * half of every host door, and each handle's own comment names the contribution
 * that consumes it.
 */
import { setFramePartShown } from '@volter/editor-sdk/kit/frame/frame-parts';
import { setWorkspaceStorageProvider, type WorkspaceStorageProvider } from '@volter/editor-sdk/kit/workspace-storage';
import { preloadUserLocalState } from '@volter/editor-sdk/kit/user-local-state';
import { loadProductNames, productDisplayName } from '@volter/editor-sdk/kit/product-command';
import '../editor-styles.css';
import '../authoring/instance-source-menu-register';
import { activeProduct } from '@volter/editor-sdk/kit/active-product';
import '../authoring/prefab-instance-inspector-section';
import '../authoring/null-inspection-subjects';
import { editorHost } from '@volter/editor-sdk/host';
import {
  type LayoutFrameProps,
  registerLayoutHost,
  type WorkspaceProps,
} from '@volter/editor-sdk/layouts';
import { invokeViewVerb, subscribeViewVerbs, viewVerbContributions } from '@volter/editor-sdk/views';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { subscribeAdapterEditorConfiguration } from '@volter/editor-sdk/kit/adapter-editor-config';
import { AppRoot } from '../components/AppRoot';
import { CompactInspectorCard } from '../components/CompactInspectorCard';
import { GameHierarchy } from '../components/GameHierarchy';
import { Inspector, InspectorShownAsCard } from '../components/Inspector';
import { ProjectHeader } from '../components/ProjectHeader';
import { DocumentView } from '../components/ProjectLayout';
import { WorkspaceDocumentSurface } from '../components/WorkspaceDocumentSurface';
import { WorkspaceUtilitySurface } from '../components/WorkspaceUtilitySurface';
import { WorkspaceStaticPanelSurface } from '../components/workspace-static-panel-registry';
import { installEditorConsoleReporting } from '../console-sync';
import { installSessionVitals } from '../coverage/session-vitals';
import {
  invokePaletteAction,
  paletteActions,
  setCommandExecutor,
  setPaletteOpener,
  subscribePaletteActions,
} from '@volter/editor-sdk/kit/editor-commands';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { installEditorHostDoor, setOutputProvider } from '../editor-host-door';
import { getProjectDefinePath } from '@volter/editor-sdk/kit/editor-mode';
import { type EditorNotification, setNotificationDelegate } from '@volter/editor-sdk/kit/editor-notifications';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { clearHierarchyHeaderSlot, setHierarchyHeaderSlot } from '../hierarchy-header-slot';
import { useActiveInspection } from '../inspection/use-active-inspection';
import { installLayoutPolicy } from '@volter/editor-sdk/kit/layout-policy';
import {
  installPlayTransitionDock,
  reconcilePlayPresentationPolicy,
  usesImmersivePlayPresentation,
} from '@volter/editor-sdk/kit/live-transition';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import {
  describeSessionOrphan,
  sessionOrphanIsWorthReporting,
  takeSessionOrphanRecord,
} from '../session-orphan-record';
import {
  declaredAdapterSettingEntries,
  effectiveSettings,
  preloadSettings,
  subscribeSettings,
} from '@volter/editor-sdk/kit/settings-store';
import { useSharedViewRestore } from '../shared-view-restore';
import { installStaleChunkRecovery } from '../stale-chunk-recovery';
import { installStoryLane } from '../stories/story-lane';
import { notifySurfaceKeyboard, setSurfaceKeyboardProbe } from '@volter/editor-sdk/kit/surface-keyboard';
import { preloadEditorThemeLibrary } from '@volter/editor-sdk/kit/theme-library';
import {
  editorPaletteSnapshot,
  installEditorTheme,
  subscribeEditorTheme,
} from '@volter/editor-sdk/kit/theme-preference';
import { lookColorCustomizations } from './look-colors';
import { primeSourceWriteRuntime } from '@volter/editor-sdk/kit/ui-source/tier-source-write-backend';
import { installViteErrorSurface } from '../vite-error-surface';
import { activeWorkspaceAreas, subscribeWorkspaceAreas } from '@volter/editor-sdk/kit/workspace-areas';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocument,
  activeWorkspaceDocumentViewId,
  closeWorkspaceDocument,
  openWorkspaceDocuments,
  setActiveWorkspaceDocumentView,
  subscribeWorkspaceDocuments,
  type WorkspaceDocumentDescriptor,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { reopenKindDocument } from '../components/kind-documents';
import { requestAvailableWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-available-documents';
import {
  installWorkspaceHostCommands,
  setActiveWorkspaceStaticPanel,
} from '@volter/editor-sdk/kit/workspace-host-commands';
import { notifyEditorWorkspaceApplied, setEditorWorkspace } from '@volter/editor-sdk/kit/workspace-presets';
import {
  installWorkspaceStatePersistence,
  waitForWorkspaceStateRestore,
} from '../workspace-state-persistence';
import { WORKSPACE_STATIC_PANELS } from '@volter/editor-sdk/kit/workspace-static-panels';
import {
  subscribeWorkspaceStatus,
  workspaceStatusContributions,
  workspaceStatusRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-status-registry';
import {
  availableUtilityFingerprint,
  availableWorkspaceUtilities,
  subscribeWorkspaceUtilities,
} from '@volter/editor-sdk/kit/workspace-utility-registry';
import { subscribeAvailabilityTick } from '@volter/editor-sdk/kit/availability-tick';
import { setWorkspaceViewportRect } from '../workspace-viewport-rect';

/**
 * WHAT THE FRAME GETS OF THE KEYBOARD — the editor's own door
 * (`@volter/editor-sdk/host`'s `keyboard`) reshaped into exactly the facts the
 * contribution's context keys need, so no file under `src/vs/` imports an
 * editor module. Its counterpart is `vgaiKeyboard.ts`'s `VgaiKeyboardBridge`.
 *
 * The CHORDS are deliberately not among them (U6b): they are package data
 * known at build time, generated into `extensions/vgai-keymaps`'s
 * `contributes.keybindings` by `scripts/workbench/generate-keymaps.mjs` from the same
 * `keymap-presets.ts`/`*.keymap.ts` tables this door would have read. What is
 * dynamic — WHICH keymap the project chose — is `activeKeymap()` below, and
 * the frame publishes it as the `vgai.keymap` context key each generated set
 * is gated on. The door's own `keymaps()`/`actions()` members stay the
 * editor's published API; the frame reads neither.
 */
export interface VgaiKeyboardHandle {
  activeKeymap(): string;
  invoke(id: string): boolean;
  subscribe(listener: () => void): () => void;
  facts(): {
    surface: string | null;
    mode: string | null;
    documentKind: string | null;
    play: string;
  };
  report(level: 'warn' | 'error', message: string): void;
}

/**
 * WHAT THE FRAME GETS OF THE OPEN DOCUMENTS — its counterpart is the
 * contribution's own `VgaiDocumentsBridge`, declared there so that no file
 * under `src/vs/` imports an editor module.
 *
 * ONE fact, because one command needs it: which file on disk the active
 * document IS. `VGAI: Show Explorer and Open Model Source Beside` opens the
 * active model's source beside the Model document, and before this it opened
 * the literal string `src/models/cube.ts` — a path the models template stopped
 * shipping when a model became a `.blend` plus the bpy that authored it
 * (`src/models/cube.py`). The frame cannot know that path; the editor does,
 * because a `model` document's id IS `model:<project-relative .blend>`
 * (`@volter/editor-blender`'s `models.finder.ts`), and this door is where that stops
 * being an id-parsing trick anyone else has to repeat.
 */
/**
 * WHAT THE FRAME GETS OF THE EDITOR'S HISTORY — the editor's own door
 * (`@volter/editor-sdk/host`'s `history`) reshaped into exactly what the
 * contribution needs, so no file under `src/vs/` imports an editor module. Its
 * counterpart is `vgaiHistory.ts`'s `VgaiHistoryBridge`.
 *
 * The elements carry PROJECT-RELATIVE paths and the frame resolves them
 * against the open workspace folder — that is what puts a gizmo drag on
 * `cube.ts`'s model and a keystroke in `cube.ts`'s text editor on ONE
 * resource's stack.
 */
export interface VgaiHistoryHandle {
  elements(): readonly VgaiHistoryElementHandle[];
  onElement(listener: (element: VgaiHistoryElementHandle) => void): () => void;
  onInvalidated(listener: (resources: readonly string[]) => void): () => void;
  changed(): void;
  focusedResource(): string | null;
  focusedDocument(): { id: string; label: string } | null;
  /** Hand the frame's OWN undo to the editor, so its Edit menu, palette and
   *  `vgai eval` reach the one stack instead of a cursor nobody drives. */
  setDelegate(delegate: {
    undo(): void | boolean | Promise<void | boolean>;
    redo(): void | boolean | Promise<void | boolean>;
    canUndo(): boolean;
    canRedo(): boolean;
    undoLabel?(): string | null;
    redoLabel?(): string | null;
  }): void;
  report(level: 'warn' | 'error', message: string): void;
}

export interface VgaiHistoryElementHandle {
  readonly id: string;
  readonly label: string;
  readonly resources: readonly string[];
  readonly document: string | null;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

/**
 * WHAT THE FRAME GETS OF THE PROJECT'S FILES — the editor's own door
 * (`@volter/editor-sdk/host`'s `files`) in the one direction the frame drives
 * it: the frame INSTALLS a provider, and from then on every vgai read and
 * write of the project's files is the workbench's own `IFileService` /
 * `ITextFileService` call. Its counterpart is `vgaiFiles.ts`'s
 * `VgaiFilesBridge`, declared there so that no file under `src/vs/` imports an
 * editor module.
 *
 * It arrives LATER than the ownership does, and that is deliberate:
 * `setFilesOwner('frame')` runs before the editor mounts, so nothing can be
 * written behind the workbench's back, while the provider needs services a
 * `ServicesAccessor` only yields inside the command's synchronous part. The
 * door falls back to the session's transports in that window — a write there
 * is a real write with nowhere else to go.
 */
export interface VgaiFilesHandle {
  setProvider(provider: {
    read(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
    write(path: string, data: string | Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
  }): void;
  report(level: 'warn' | 'error', message: string): void;
}

/**
 * WHAT THE FRAME GETS OF THE SETTINGS — the editor's own door
 * (`@volter/editor-sdk/host`'s `settings`) in the one direction the frame drives
 * it, plus the ONE fact only the editor knows: what the open project's
 * `vgai.adapter.ts` DECLARES. Its counterpart is `vgaiSettings.ts`'s
 * `VgaiSettingsBridge`, declared there so that no file under `src/vs/` imports
 * an editor module.
 *
 * The adapter's declaration is CODE — an imported `blenderStyle` object, not a
 * file the host parses (ARCHITECTURE-CORE §Adapters and contributions are
 * code) — so the frame cannot read it and must be handed it. It arrives as
 * dotted `vgai.*` keys, the same spelling the configuration service takes, and
 * the frame writes exactly those to its MEMORY target under the inspect gate.
 */
export interface VgaiSettingsHandle {
  setProvider(provider: {
    get(key: string): unknown;
    inspect(key: string): {
      default: unknown;
      user: unknown;
      adapter: unknown;
      project: unknown;
      effective: unknown;
    };
    set(key: string, value: unknown, target: 'user' | 'project'): Promise<void>;
    subscribe(listener: () => void): () => void;
  }): void;
  adapterValues(): readonly (readonly [string, unknown])[];
  /** VS CODE'S OWN keys the active LOOK answers, and today that is exactly one: the top
   *  bar's height (`window.titleBarHeight`, WORK.md U9). The frame writes it on the same
   *  MEMORY layer under the same inspect gate, and its own core edit 1 reads it in
   *  `BrowserTitlebarPart.minimumHeight`. See `vgaiTitleBar.ts` for why that edit exists and
   *  for the four routes measured before it was made. */
  workbenchValues(): readonly (readonly [string, unknown])[];
  /** The ACTIVE LOOK's own id — the editor's palette id. The frame maps it to the colour
   *  theme and product icon theme IT ships (`vgaiSettings.ts`'s `LOOK_THEMES`) and writes
   *  them on the same MEMORY layer, under the same inspect gate, as the top bar's height.
   *  The editor hands over the look and never a theme NAME: `Blender` and `blender-icons`
   *  are artifacts of the fork, and a panel naming one would be the inversion rule 2
   *  forbids. */
  lookId(): string;
  subscribe(listener: () => void): () => void;
  report(level: 'warn' | 'error', message: string): void;
  /** ONE event-shaped message to the PERSON, through `EditorHost.notify` — which under this
   *  frame is `INotificationService` (`vgaiNotifications.ts`). The frame uses it for the one
   *  thing the Settings editor cannot draw: a user value on an adapter-declared key, visible
   *  there and ineffective in this project. */
  notify(notification: {
    id: string;
    tone: 'info' | 'warning' | 'error';
    title: string;
    detail?: string;
  }): void;
}

/**
 * WHAT THE FRAME GETS OF THE OPEN DOCUMENTS — its counterpart is
 * `vgaiDocuments.ts`'s `VgaiDocumentsBridge`, declared there so that no file
 * under `src/vs/` imports an editor module.
 *
 * `activeSource` answers ONE fact for `VGAI: Show Explorer and Open Model
 * Source Beside`: which file on disk the active document IS.
 *
 * The other four are the open SET, and they arrived with walk 3's beat 19
 * (2026-09-20). The frame used to have exactly one editor whatever this
 * registry held, so an open-but-not-active document — an ingest root's Game,
 * which is where its pixels are — could not be reached by any workbench
 * gesture. `list`/`activeId`/`subscribe` are the read, `activate` is the
 * write, and the write is deliberately the registry's OWN activation rather
 * than a second notion of "which document is in front": activating fires the
 * descriptor's `onActivate`, which is what moves the store's viewport tab.
 */
export interface VgaiDocumentsHandle {
  whenRestored(): Promise<void>;
  /** The active document's kind and the project-relative file it is, or null
   *  when nothing is open or the active document is not a file on disk. */
  activeSource(): { kind: string; path: string } | null;
  /**
   * Every OPEN workspace document, in the registry's own order.
   *
   * `area` arrived with WORK.md's Timeline item 1 (2026-09-20). A workspace
   * AREA is an editor GROUP (orchestrator ruling, 2026-09-19), and the two
   * halves of the fact live in two places on this side: the registry
   * descriptor holds the area's ID (`WorkspaceDocumentDescriptor.area`,
   * written only by the workspace that opened it) and the ACTIVE workspace's
   * own `areas` entry holds its `place` and `ratio`
   * (`WorkspaceAreaContribution`, the same list the dock sizes its group
   * from). They are joined here so that nothing under `src/vs/` has to know
   * either module.
   */
  list(): readonly {
    readonly id: string;
    readonly title: string;
    readonly area?: {
      readonly id: string;
      readonly place: 'left' | 'right' | 'above' | 'below';
      readonly ratio: number;
    };
  }[];
  /** The registry's active document id, or null. */
  activeId(): string | null;
  /** Fires when the open set, the titles or the active document change. */
  subscribe(listener: () => void): () => void;
  /** Activate one open document — the frame's half of a tab click. */
  activate(id: string, viewId?: string): void;
  /**
   * CLOSE one open document — the frame's half of `View: Close Editor`.
   *
   * A person closing a vgai editor is closing the DOCUMENT; without this the
   * registry kept reporting it open and active while the workbench had no
   * editor for it, so `vgai status` disagreed with the screen and reopening it
   * was a no-op against a registry that never noticed (walk 4, W12). The
   * contribution calls this only for a close it did NOT make itself.
   */
  close(id: string): void;
  /** Native occurrence lifetime and attachment. A null element hides a view;
   * only `closed` releases its content. */
  setView(view: NativeDocumentView, closed: boolean): void;
}

export interface VscodeParts {
  /** The element that carries the vgai theme variables: `.monaco-workbench`. */
  chromeRoot: HTMLElement;
  header: HTMLElement;
  center: HTMLElement;
  outliner?: HTMLElement | undefined;
  properties?: HTMLElement | undefined;
  content?: HTMLElement;
}

let parts: VscodeParts | null = null;
let partsVersion = 0;
const partsListeners = new Set<() => void>();
function subscribeParts(listener: () => void): () => void {
  partsListeners.add(listener);
  return () => partsListeners.delete(listener);
}
function partsSnapshot(): number {
  return partsVersion;
}

/**
 * WHETHER A PART IS ON SCREEN, which an offer alone does not say: the workbench offers a view's
 * part when it first renders and withdraws it only when the view is disposed, while hiding the
 * view (another tab in front of it, its side bar closed) detaches the element without a word.
 * A ResizeObserver reports that detach, and the return, as a size change.
 */
const partWatchers = new Map<string, ResizeObserver>();
function watchPartShown(id: string, element: HTMLElement | null): void {
  partWatchers.get(id)?.disconnect();
  partWatchers.delete(id);
  const report = () => {
    const box = element?.isConnected ? element.getBoundingClientRect() : null;
    setFramePartShown(id, box !== null && box.width > 0 && box.height > 0);
  };
  report();
  if (element === null || typeof ResizeObserver === 'undefined') return;
  const watcher = new ResizeObserver(report);
  watcher.observe(element);
  partWatchers.set(id, watcher);
}

/**
 * RE-OFFER OR WITHDRAW ONE HANDED-OVER PART, after the mount.
 *
 * The mount's parts used to be captured once, which was true for exactly as
 * long as the pane that owned the centre lived. `View: Close Editor` on the
 * only vgai document disposes that pane AND its group, and the element this
 * module portals into goes with it — measured 2026-09-20 (walk 4, W12): the
 * workspace came back with the Timeline alone and reopening the document drew
 * into a detached node. So the contribution withdraws a dead part (`null`) and
 * offers the next pane's container under the same id, and the portal below
 * re-targets on the re-render that arrival causes.
 */
export function offerVgaiPart(id: keyof VscodeParts, element: HTMLElement | null): void {
  if (!parts) return;
  if (element === null) {
    // A WITHDRAWAL IS ONLY THE OWNER'S. Panes are built and disposed in any
    // order (a group split builds the area's pane before the main one goes),
    // so a late `clearInput` from a pane that no longer holds the part must
    // not delete the part its successor already offered.
    if (parts[id]?.isConnected) return;
  } else if (parts[id] === element) {
    return;
  }
  if (element === null && (id === 'outliner' || id === 'properties' || id === 'content')) {
    const next = { ...parts };
    delete next[id];
    parts = next;
  } else if (element !== null) {
    parts = { ...parts, [id]: element };
  }
  if (element !== null) stampPart(id, element);
  watchPartShown(id, element);
  partsVersion += 1;
  for (const listener of partsListeners) listener();
}

/**
 * THE PART'S OWN NAME, ON THE PART — written at the moment of the handover,
 * which is the only moment anything knows that THIS element is the Properties
 * view's body and that one is the Outliner's.
 *
 * It is here because the product door onto editor chrome
 * (`editor-document-probe.ts`, scopes `rail` and `outliner`) has to find a
 * view's live root, and these views are VS Code panes holding React portals:
 * there is no path down from the document's box to them, and no class name
 * that means "the Properties view" rather than "a panel". Reading the id the
 * workbench registered is the honest answer; a class guess is not. A disposed
 * pane takes its stamped element out of the document with it, so a closed view
 * answers "not open" instead of matching a stale node.
 *
 * Costs nothing to draw: a `data-` attribute on a container that already
 * exists.
 */
function stampPart(id: keyof VscodeParts, element: HTMLElement): void {
  element.dataset['vgaiPart'] = id;
}

/** Native occurrences survive pane detach/move; React keys follow their IDs. */
interface NativeDocumentView {
  readonly id: string;
  readonly documentId: string;
  readonly element: HTMLElement | null;
}
const documentViews = new Map<string, NativeDocumentView>();
let documentSlotsVersion = 0;
const documentSlotListeners = new Set<() => void>();
/** Every document open at some point in this page's life. A workbench tab for
 *  a document in it that is no longer open is one the person closed; a tab for
 *  one never in it is the workbench's own restore, whose document the kit's
 *  record did not bring back. */
const everOpenDocuments = new Set<string>();
let followingOpenDocuments = false;
function noteOpenDocuments(): void {
  for (const open of openWorkspaceDocuments()) everOpenDocuments.add(open.descriptor.id);
}
/** THE WORKBENCH RESTORES ITS TABS AND THE KIT ITS DOCUMENTS, from two
 *  records. When a restored tab names a document the kit did not reopen, the
 *  tab asks for it — a kind document through its table entry, anything else
 *  through the available-document request — rather than standing empty. */
function restoreDocumentOfView(documentId: string): void {
  if (!followingOpenDocuments) {
    followingOpenDocuments = true;
    subscribeWorkspaceDocuments(noteOpenDocuments);
  }
  noteOpenDocuments();
  if (!documentId || everOpenDocuments.has(documentId)) return;
  if (!reopenKindDocument(documentId)) requestAvailableWorkspaceDocument(documentId, false);
}

function setDocumentView(view: NativeDocumentView, closed: boolean): void {
  if (closed) {
    if (!documentViews.delete(view.id)) return;
  } else {
    if (!documentViews.has(view.id)) restoreDocumentOfView(view.documentId);
    const previous = documentViews.get(view.id);
    if (previous?.element === view.element && previous.documentId === view.documentId) return;
    documentViews.set(view.id, { ...view });
  }
  documentSlotsVersion += 1;
  for (const listener of [...documentSlotListeners]) listener();
}
function subscribeDocumentSlots(listener: () => void): () => void {
  documentSlotListeners.add(listener);
  return () => {
    documentSlotListeners.delete(listener);
  };
}
function documentSlotsSnapshot(): number {
  return documentSlotsVersion;
}

/** The shell's frame styling, per part (EditorShellFrame minus the absolute box). */
function PartShell({
  children,
  row = false,
  center = false,
}: {
  children: ReactNode;
  row?: boolean;
  center?: boolean;
}) {
  return (
    <div
      className="vgai-editor-shell vgai-part"
      // Code-OSS cancels wheel events at the workbench root. Our panels use
      // native overflow scrolling, so retain its default action inside this host.
      onWheel={(event) => event.stopPropagation()}
      data-editor-hotkey-scope="workspace"
      data-editor-hotkey-fallback
      style={{
        display: 'flex',
        flexDirection: row ? 'row' : 'column',
        justifyContent: center ? 'center' : undefined,
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
        // THE LOOK'S OWN FACE, and it is RESTATED here on purpose. `theme.css`
        // declares it on the theme root and every ordinary surface inherits it
        // — but under the frame the theme root IS `.monaco-workbench`, and the
        // parts we portal into are the workbench's own elements, several of
        // which declare a font of their own. Inheritance from the root loses to
        // a declaration on the part.
        // It read `var(--vgai-typography-sans, 'Inter', system-ui, sans-serif)`
        // while it lived in the fork: that variable is published by nothing, so
        // the frame wore the hard-coded fallback and never the look's face.
        fontFamily: 'var(--vgai-font-sans)',
        fontSize: 'var(--vgai-font-base)',
        color: 'var(--vgai-content-primary)',
      }}
    >
      {children}
    </div>
  );
}

function Frame({ children }: LayoutFrameProps) {
  return <>{children}</>;
}

function Header() {
  if (!parts) return null;
  return createPortal(
    <PartShell center>
      <ProjectHeader />
    </PartShell>,
    parts.header,
  );
}

/**
 * THE FOOTER IS NOT HOSTED — the status bar is the WORKBENCH'S (U8 step 7).
 *
 * The spike portalled `EditorBottomBar` into `.part.statusbar` and the skin hid the bar's own
 * `.items-container` to make room for it. U8 replaced that whole for-the-look arrangement with
 * the real thing: one `IStatusbarService` entry per `workspace.status` contribution, each
 * carrying our own element as its `content` (`vgaiStatus.ts`), and `StatusBar.tsx` drawing
 * nothing under frame ownership. The portal that stayed behind was then an EMPTY 1440x22 blob
 * covering every one of those entries — walk 2 measured them all at 0x0 with no `Hide <item>`
 * reachable, which is exactly what a second rendering of one part costs.
 *
 * WHAT THIS DROPS, named rather than silently degraded: `EditorBottomBar` is the status line
 * plus the `bottom-bar` CHROME SLOT, whose one filler is `@vgai/agents`' minimized conversation
 * tray. That tray has no frame home yet — neither does the `panel:agent` slot beside it, because
 * the agents surface is a dock PANEL and the dock is U10's to retire. It renders nothing in a
 * scaffolded project today (measured: the hosted slot's `innerText` was empty), and the two
 * halves of that surface move together when they move. docs/CODE-OSS.md §Views, colours, marks
 * and status carries the note.
 */
function Footer() {
  return null;
}

function OutlinerPart() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    setHierarchyHeaderSlot(element);
    return () => clearHierarchyHeaderSlot(element);
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* THE HEADER BAND the hierarchy's controls portal into. Its insets used to come from
          the dock's header rules; under the frame nothing else supplies them, so the row
          sat flush against the pane's corner. The frame's pane has no tab strip beside the
          row, so the search field takes the band (`GameHierarchy.tsx`'s basis variable) and
          the view menu and Create sit at its trailing edge. */}
      <div
        ref={slot}
        className="vgai-vscode-outliner-header"
        style={{ padding: 'var(--vgai-space-2) var(--vgai-space-4)', ['--vgai-hierarchy-search-basis' as string]: '100%' }}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <GameHierarchy />
      </div>
    </div>
  );
}

/**
 * THE VIEW BODIES the frame has handed over, by utility id. A module-scope store with its own
 * subscription for the reason `parts` is one: the workbench constructs a view pane when it
 * pleases (the panel is collapsed until someone opens it), so the element arrives long after
 * the bridge mounted and the React tree has to re-render when it does.
 */
const utilityBodies = new Map<string, HTMLElement>();
const utilityBodyListeners = new Set<() => void>();
let utilityBodyVersion = 0;
function setUtilityBody(id: string, element: HTMLElement | null): void {
  if (element) {
    if (utilityBodies.get(id) === element) return;
    // The document door's `utility` scope finds the showing body by this stamp.
    element.dataset['vgaiUtility'] = id;
    utilityBodies.set(id, element);
  } else if (!utilityBodies.delete(id)) {
    return;
  }
  utilityBodyVersion++;
  for (const listener of utilityBodyListeners) listener();
}

const statusBodies = new Map<string, HTMLElement>();
const statusBodyListeners = new Set<() => void>();
let statusBodyVersion = 0;
function setStatusBody(id: string, element: HTMLElement | null): void {
  if (element) {
    if (statusBodies.get(id) === element) return;
    statusBodies.set(id, element);
  } else if (!statusBodies.delete(id)) {
    return;
  }
  statusBodyVersion++;
  for (const listener of statusBodyListeners) listener();
}

/** Our status items, each portalled into the real status bar ENTRY the frame made for it (U8).
 *  No `PartShell` here: a status entry is already the workbench's own chrome, and wrapping it in
 *  our shell frame would put a second border inside one item. */
function StatusPortals() {
  useSyncExternalStore(
    subscribeWorkspaceStatus,
    workspaceStatusRegistryVersion,
    workspaceStatusRegistryVersion,
  );
  useSyncExternalStore(
    (listener: () => void) => {
      statusBodyListeners.add(listener);
      return () => statusBodyListeners.delete(listener);
    },
    () => statusBodyVersion,
    () => statusBodyVersion,
  );
  return (
    <>
      {[...workspaceStatusContributions('left'), ...workspaceStatusContributions('right')].map(
        (contribution) => {
          const body = statusBodies.get(contribution.id);
          if (!body) return null;
          const Content = contribution.Content;
          return <Fragment key={contribution.id}>{createPortal(<Content />, body)}</Fragment>;
        },
      )}
    </>
  );
}

/** Our utilities, each portalled into the VS Code view the frame made for it (U8). */
function UtilityPortals() {
  useSyncExternalStore(
    subscribeWorkspaceUtilities,
    availableUtilityFingerprint,
    availableUtilityFingerprint,
  );
  useSyncExternalStore(
    (listener: () => void) => {
      utilityBodyListeners.add(listener);
      return () => utilityBodyListeners.delete(listener);
    },
    () => utilityBodyVersion,
    () => utilityBodyVersion,
  );
  return (
    <>
      {availableWorkspaceUtilities().map((utility) => {
        const body = utilityBodies.get(utility.id);
        if (!body) return null;
        return (
          <Fragment key={utility.id}>
            {createPortal(
              <PartShell>
                <WorkspaceUtilitySurface utility={utility} />
              </PartShell>,
              body,
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** Keep the React portal target for a document stable across native tab moves.
 * Moving the host element preserves the mounted game's container and renderer. */
function NativeDocumentPortal({
  descriptor,
  viewId,
  slot,
  parking,
  visible,
  inspector,
}: {
  descriptor: WorkspaceDocumentDescriptor;
  viewId: string;
  slot: HTMLElement | undefined;
  parking: HTMLElement;
  visible: boolean;
  inspector: boolean;
}) {
  const [host] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    host.className = 'vgai-vscode-document-slot';
    host.dataset['vgaiDocument'] = descriptor.id;
    host.dataset['vgaiArea'] = descriptor.area ?? '';
    host.style.cssText = `display:${visible ? 'flex' : 'none'};flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;position:relative;`;
  }, [host, descriptor.id, descriptor.area, visible]);
  useLayoutEffect(() => {
    (slot ?? parking).appendChild(host);
    return () => host.remove();
  }, [host, slot, parking]);
  return createPortal(
    <PartShell>
      <WorkspaceDocumentSurface
        descriptor={descriptor}
        viewId={viewId}
        active={visible}
        chrome={!descriptor.area}
      />
      {inspector && <CompactInspectorCard />}
    </PartShell>,
    host,
  );
}

let inspectorColumn = true;

function Workspace({ arrangement, immersivePlay }: WorkspaceProps) {
  const store = useEditorStore();
  useSharedViewRestore(store);
  const inspection = useActiveInspection(store);
  useLayoutEffect(() => {
    inspectorColumn = inspection.column;
  }, [inspection.column]);
  const centerPart =
    documentViews.get(activeWorkspaceDocumentViewId() ?? '')?.element ?? parts?.center;
  useLayoutEffect(() => {
    if (!centerPart) return;
    const update = () =>
      setWorkspaceViewportRect({
        x: 0,
        y: 0,
        width: centerPart.clientWidth,
        height: centerPart.clientHeight,
      });
    const observer = new ResizeObserver(update);
    observer.observe(centerPart);
    update();
    return () => {
      observer.disconnect();
      setWorkspaceViewportRect(null);
    };
  }, [centerPart]);
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  // THE FRAME'S PER-DOCUMENT SLOTS (WORK.md's Timeline item 1): an area's pane is built after
  // this component first rendered, so its arrival has to be a re-render.
  useSyncExternalStore(subscribeDocumentSlots, documentSlotsSnapshot, documentSlotsSnapshot);
  // …and so does a re-offered PART: the centre's pane is disposed with its group when a person
  // closes the last vgai editor, and the next one hands over a different element (W12).
  useSyncExternalStore(subscribeParts, partsSnapshot, partsSnapshot);
  useLayoutEffect(() => {
    const stop = installLayoutPolicy({
      ...(arrangement ? { arrangement } : {}),
      ...(immersivePlay === undefined ? {} : { immersivePlay }),
      playUtilities: [],
    });
    if (arrangement) setEditorWorkspace(arrangement.id);
    // THE ACK a scripted caller waits on (`editor.workspace(id)`): this commit
    // IS the workspace being applied on our side, and the frame sizes its
    // editor groups from the same registry change in the same beat. Without a
    // caller here `whenEditorWorkspaceApplied()` never resolves and the verb
    // hangs on a switch that already happened.
    notifyEditorWorkspaceApplied();
    return stop;
  }, [arrangement, immersivePlay]);
  // WHAT THE DOCK DOES ON EVERY PLAY EDGE, minus the dock (U2). `endPlayTransition` is what
  // puts the chrome back, and it must run when play stops AND when a layout that is not
  // immersive starts something — the dock calls this from the same place for the same reason.
  // It is here rather than in the game handle because only a component sees the store's edges.
  const playing = store.playState !== 'stopped';
  const keepPanelsVisible = useSyncExternalStore(subscribeSettings, effectiveSettings).play
    ?.keepPanelsVisible;
  useEffect(() => {
    reconcilePlayPresentationPolicy(playing, usesImmersivePlayPresentation());
  }, [playing, immersivePlay, keepPanelsVisible]);
  // WORKSPACE-STATE PERSISTENCE: which named workspace this project was left
  // in, which documents were open and which was in front. It is installed HERE
  // because this component is the editor's one workspace — the same place the
  // dock used to install it from, for the same reason: the restore must not
  // run before a workspace exists to restore into, and the write-through must
  // stop when it goes.
  useEffect(() => installWorkspaceStatePersistence(store), [store]);
  if (!parts) return null;
  const parking = parts.center;
  const docs = openWorkspaceDocuments();
  const active = activeWorkspaceDocument() ?? docs[0] ?? null;
  (globalThis as unknown as { __vgaiBridge?: unknown }).__vgaiBridge = {
    documents: docs.map((d) => d.descriptor.id),
    active: active?.descriptor.id ?? null,
    workspace: arrangement?.id ?? null,
    areas: docs.flatMap((d) =>
      d.descriptor.area ? [{ id: d.descriptor.id, area: d.descriptor.area }] : [],
    ),
    slots: [...documentViews.values()].map(({ id, documentId, element }) => ({
      id,
      documentId,
      visible: !!element,
    })),
  };
  return (
    <>
      {[...documentViews.values()].map((view) => {
        const descriptor = docs.find((doc) => doc.descriptor.id === view.documentId)?.descriptor;
        if (!descriptor) return null;
        return (
          <NativeDocumentPortal
            key={view.id}
            descriptor={descriptor}
            viewId={view.id}
            slot={view.element ?? undefined}
            parking={parking}
            visible={!!view.element}
            inspector={inspection.card && descriptor.id === active?.descriptor.id}
          />
        );
      })}
      {docs.length === 0 &&
        createPortal(
          <PartShell>
            <div className="vgai-vscode-empty">No document open</div>
          </PartShell>,
          parts.center,
        )}
      {parts.outliner &&
        createPortal(
          <PartShell>
            <OutlinerPart />
          </PartShell>,
          parts.outliner,
        )}
      {parts.properties &&
        createPortal(
          <PartShell>
            {inspection.column ? (
              <Inspector />
            ) : (
              <InspectorShownAsCard surface={inspection.surface} />
            )}
          </PartShell>,
          parts.properties,
        )}
      {parts.content &&
        createPortal(
          <PartShell>
            <WorkspaceStaticPanelSurface kind="assets" />
          </PartShell>,
          parts.content,
        )}
      <UtilityPortals />
      <StatusPortals />
    </>
  );
}

/**
 * WHAT THE FRAME GETS OF OUR STATUS ITEMS (U8) — the editor's `workspace.status` registry, plus
 * the element each real status bar entry hands back. Its counterpart is `vgaiStatus.ts`'s
 * `VgaiStatusBridge`. The item's pixels never change: the same `Content` the bottom bar renders
 * is portalled into the entry the workbench made for it.
 */
export interface VgaiStatusHandle {
  list(): readonly {
    readonly id: string;
    readonly title: string;
    readonly align: 'left' | 'right';
    readonly order: number;
  }[];
  subscribe(listener: () => void): () => void;
  offerBody(itemId: string, element: HTMLElement | null): void;
}

/**
 * WHAT THE FRAME GETS OF OUR DRAWER UTILITIES (U8, ruling 1's other half) — the editor's live
 * `workspace.utility` registry, plus the door the frame hands each VIEW's body back through.
 * Its counterpart is `vgaiUtilityViews.ts`'s `VgaiUtilitiesBridge`.
 *
 * A utility's CONTENT never moves: `WorkspaceUtilitySurface` renders the same registration the
 * dock renders, portalled into the view's body. What changes is only where the body is.
 */
export interface VgaiUtilitiesHandle {
  list(): readonly { readonly id: string; readonly title: string; readonly order: number }[];
  subscribe(listener: () => void): () => void;
  offerBody(utilityId: string, element: HTMLElement | null): void;
}

/**
 * WHAT THE FRAME GETS OF OUR VIEWS (U8, ruling 1) — the SDK's view-verb registry, reshaped
 * into what a `vgai.<view>.<verb>` command needs. Its counterpart is `vgaiViews.ts`'s
 * `VgaiViewsBridge`. Arguments pass straight through and a refusal is the view's own thrown
 * sentence: what an argument means belongs to the view.
 */
export interface VgaiViewsHandle {
  list(): readonly {
    readonly view: string;
    readonly title: string;
    readonly verbs: readonly { readonly id: string; readonly title?: string }[];
  }[];
  invoke(view: string, verb: string, args?: Record<string, unknown>): unknown;
  subscribe(listener: () => void): () => void;
}

/**
 * WHAT THE FRAME GETS OF NOTIFICATIONS (U8) — one installer, because a notification is a
 * one-way message and there is nothing for the frame to read back. `null` hands them back to
 * the editor's own tray. Its counterpart is `vgaiNotifications.ts`'s
 * `VgaiNotificationsBridge`.
 */
export interface VgaiNotificationsHandle {
  setDelegate(show: ((notification: EditorNotification & { readonly source: string }) => () => void) | null): void;
}

/**
 * WHAT THE FRAME GETS OF THE PALETTE (U8) — the editor's live action table, reshaped into
 * exactly the facts a `MenuId.CommandPalette` item needs, so no file under `src/vs/` imports an
 * editor module. Its counterpart is `vgaiCommands.ts`'s `VgaiCommandsBridge`.
 *
 * Deliberately NOT here: the relay's verbs. `vgai <verb>` stays the SESSION's vocabulary (the
 * one-name table gives commands to VS Code in the same row that keeps relay verbs ours); this
 * is only the palette a PERSON opens.
 */
export interface VgaiCommandsHandle {
  list(): readonly { readonly id: string; readonly label: string; readonly category: string }[];
  invoke(id: string): boolean;
  subscribe(listener: () => void): () => void;
  setPaletteOpener(open: () => void): void;
  /** The frame's `ICommandService`, behind `editor.command(id, args)` — the editor's one door
   *  to a command BY ID, and the only way the product can drive a drawer VIEW (U8 ruling 1).
   *  Standalone the same door answers a `vgai.<view>.<verb>` id off the views registry, so this
   *  is the second implementation of one table, never a second table. */
  setCommandExecutor(run: ((id: string, args?: unknown) => Promise<unknown>) | null): void;
  report(level: 'warn' | 'error', message: string): void;
}

/**
 * WHAT THE FRAME ANSWERS FOR THE GAME SKEW (U2) — the three things the workspace
 * host must install for a game layout, answered by the workbench.
 *
 * Everything else of the Game layout needed nothing: `GameLayout` is the same three
 * layout-host members `ModelLayout` renders, the header carries the workspace tabs AND the
 * Play transport, and the Game document is an ordinary workspace document the active-document
 * portal already draws. Its counterpart is `vgaiGameSkew.ts`'s `VgaiGameBridge`.
 */
export interface VgaiGameHandle {
  setActiveStaticPanel(kind: string | null): void;
  focusCompactInspector(): boolean;
  setPaneActive(active: boolean): void;
  setImmersive(act: { enter(): void; exit(): void } | null): void;
  setDockCommands(
    commands: {
      showUtility(id: string): void;
      toggleUtility(id: string): void;
      ensureUtility(id: string): void;
      closeUtility(id: string): void;
      showStaticPanel(kind: string): void;
      setFocus(focused: boolean): void;
      toggleFocus(): void;
    } | null,
  ): void;
  report(level: 'warn' | 'error', message: string): void;
}

/** What the frame hands over besides its parts, before anything of the editor runs. */
export interface VscodeFrameServices {
  /** The workbench's workspace storage (`kit/workspace-storage`). */
  readonly workspaceStorage?: WorkspaceStorageProvider;
}

export async function mountEditor(next: VscodeParts, frame: VscodeFrameServices = {}): Promise<{
  host: HTMLElement;
  keyboard: VgaiKeyboardHandle;
  documents: VgaiDocumentsHandle;
  history: VgaiHistoryHandle;
  files: VgaiFilesHandle;
  settings: VgaiSettingsHandle;
  commands: VgaiCommandsHandle;
  notifications: VgaiNotificationsHandle;
  views: VgaiViewsHandle;
  utilities: VgaiUtilitiesHandle;
  output: { setProvider: typeof setOutputProvider };
  status: VgaiStatusHandle;
  game: VgaiGameHandle;
  /** Re-offer or withdraw one handed-over part after the mount — see
   *  {@link offerVgaiPart}. */
  offerPart(id: keyof VscodeParts, element: HTMLElement | null): void;
}> {
  parts = next;
  // THE WORKSPACE STORAGE FIRST: the project-local layer reads its document from
  // it when the project activates, which the mount below starts.
  if (frame.workspaceStorage) setWorkspaceStorageProvider(frame.workspaceStorage);
  // Which product this page belongs to — the command its messages name
  // (`product-command.ts`). Asked first; messages built before it lands say
  // "the editor's command" rather than guess.
  void loadProductNames();
  // The parts the mount was handed get the same stamp a re-offered one gets
  // ({@link stampPart}) — one rule, both arrival paths.
  for (const [id, element] of Object.entries(next)) {
    if (element) stampPart(id as keyof VscodeParts, element);
    watchPartShown(id, element ?? null);
  }
  // EVERY HOST DOOR'S FRAME HALF ARRIVES FROM THE CONTRIBUTION, which is the
  // only side that has the services — and it arrives AFTER this, because a
  // `ServicesAccessor` is valid only for the synchronous part of a command.
  // Each door falls back to the editor's own answer in that window rather than
  // refusing a real gesture; see the handles at the bottom of this file, and
  // each door's own module for what the fallback costs.
  // The theme scope is `#editor-chrome-root` and nothing else (index.html, the
  // appearance composer, the viewport's overlays) — so the workbench IS it.
  next.chromeRoot.id = 'editor-chrome-root';
  // THE ONE LAYOUT HOST. `DocumentView` is the editor's own document mount
  // (`components/ProjectLayout.tsx`); the other four are this file's, because
  // this file IS where the editor meets the workbench's parts.
  registerLayoutHost({ Frame, Header, Footer, Workspace, Document: DocumentView });
  // CAPTURE **AND** REPORT. This used to be `installEditorConsoleCapture()`
  // alone, copied out of the editor's `main.tsx` without the
  // `installConsoleSync()` line beside it — so this page's errors filled the
  // editor console and its bottom-bar counter and never reached the session
  // ledger `vgai console` reads. U6b's walk spent 44 React duplicate-key errors
  // inside that gap with a CLI calling the session clean. The editor now
  // publishes the two as one door that cannot be half-called.
  installEditorConsoleReporting();
  // SECOND: the editor starts watching its OWN vitals. Every live ontology
  // invariant (Edit is static, a scene has one root, the viewport canvas is
  // revealed, a visible tab renders, play draws) is checked on a timer and
  // reported as a session warning through the ledger the line above wired — so
  // a doctrine violation is loud on every `vgai` command instead of sitting in
  // a doc as a named, therefore licensed, "known problem".
  installSessionVitals();
  // THE NOTE THE LAST WINDOW AT THIS ADDRESS LEFT when it lost its server
  // (`session-orphan-record.ts`). Said right after the console pipe is wired,
  // because the server that would have recorded it is exactly the one that
  // died — this boot is the first moment the fact can reach `vgai console` and
  // the session journal at all. Taken, not peeked: one episode, said once.
  const orphaned = takeSessionOrphanRecord();
  if (orphaned && sessionOrphanIsWorthReporting(orphaned, Date.now())) {
    editorConsole.warn(describeSessionOrphan(orphaned, Date.now()), 'editor');
  }
  // A LAZY CHUNK THAT NO LONGER EXISTS reloads the page once, rather than
  // showing a crash whose Retry can never succeed.
  installStaleChunkRecovery();
  // The session turns Vite's full-screen error overlay OFF (a game that does
  // not compile must not brick the editor), so the `vite:error` payload is
  // routed to the editor's own error home instead. `import.meta.hot` exists
  // only while the session serves this module from source; a production build
  // has no HMR client and the failure arrives as an ordinary captured
  // `console.error` from Vite's own client.
  if (import.meta.hot) {
    installViteErrorSurface(
      import.meta.hot,
      () => getCurrentProject()?.rootPath ?? getProjectDefinePath(),
    );
  }
  primeSourceWriteRuntime();
  installEditorHostDoor();
  // PORTABLE CSF, the kit's own design-time state: the Content scope's
  // story-backed entries, a component's named states, the addresses a story
  // opens under, the palette's per-story action, `capture-story-variants` and
  // the discovery scan. The kit's own CSF needs no contribution to exist, so
  // the registrations are direct (`stories/story-lane.ts`).
  installStoryLane();
  await Promise.all([preloadSettings(), preloadEditorThemeLibrary(), preloadUserLocalState()]);
  installEditorTheme(next.chromeRoot);
  next.chromeRoot.classList.toggle('vgai-native-menus', activeProduct()?.nativeMenus === true);
  // AppRoot's own overlays (startup screens, notifications, the palette) render
  // here, over the workbench, exactly as index.html's #editor-root does.
  const host = document.createElement('div');
  host.id = 'editor-root';
  host.className = 'vgai-part';
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;';
  next.chromeRoot.appendChild(host);
  createRoot(host).render(<AppRoot />);
  const keyboard: VgaiKeyboardHandle = {
    activeKeymap: () => editorHost().keyboard.activeKeymap(),
    invoke: (id) => editorHost().keyboard.invoke(id),
    subscribe: (listener) => editorHost().keyboard.subscribe(listener),
    facts: () => {
      const door = editorHost();
      const stage = door.keyboard.stage();
      return {
        surface: stage.surface,
        mode: stage.mode,
        documentKind: door.documents.active()?.kind ?? null,
        play: door.session.playState(),
      };
    },
    // EVERY FRAME-SIDE REFUSAL COMES THROUGH HERE — `vgaiFiles`' dirty-model
    // refusal, `vgaiHistory`' "Nothing to undo in …", `vgaiSettings`' unknown
    // key, the game skew's "undo history has no panel under the frame" — so
    // this one function IS the frame's whole refusal channel, and what it
    // calls decides whether a refusal exists for anyone but the person
    // watching the screen. Measured 2026-09-19, a write refused under this
    // frame produced `sessionWarnings: {count: 0}`, no toast, and a ledger
    // carrying only the history layer's generic `Source write rolled back:
    // Failed to apply "…" (apply-failed)` — a channel with no reader.
    //
    // IT CALLS THE HOST DOOR, and it keeps doing so now that this file is the
    // editor's own. `editor-console.ts` is a module-level ring buffer, and the
    // page that runs this bridge also runs the fork's contribution — a second
    // realm with its own module instances, which is exactly the bet the SDK's
    // host registry exists to retire ("two module instances, so plain module
    // state would be an empty registry on the contribution's side", measured
    // 2026-09-17 and answered with a `Symbol.for` key). `EditorHost.console`
    // is the published door for precisely this — *"a contribution's
    // diagnostics go here, never to `console.*`, so they reach every door
    // whether or not anyone looks at the tab"* — and it is what the editor's
    // boot fills. Nothing under the frame should reach past it into the
    // editor's internals to say something.
    //
    // THE LEDGER AND NOT THE TRAY, which is this file's own standing split
    // (`VgaiSettingsHandle.notify`: *"Not `report`: the console is the record
    // an agent reads back"*). A refusal reaches the person anyway — it rolls
    // the write back, and `workspace-utility-commands.ts` reveals the Console
    // with the rollback line, which now CARRIES the refusing sentence rather
    // than restating "failed to apply" (`history-service.ts`'s
    // `causeSentence`). A notification per refusal would also fire on every
    // Cmd+Z at the bottom of a stack, which VS Code itself is silent about.
    report: (level, message) => {
      const door = editorHost();
      if (level === 'error') door.console.error(message, 'editor');
      else door.console.warn(message, 'editor');
    },
  };
  const documents: VgaiDocumentsHandle = {
    whenRestored: waitForWorkspaceStateRestore,
    activeSource: () => {
      const active = editorHost().documents.active();
      if (!active) return null;
      // Only a kind whose id CARRIES its file answers with one. `model` is the
      // one that does today (`model:<project-relative .blend>`); any other kind
      // answers with its name and an empty path, which is what lets the
      // command's refusal say WHICH document was open instead of just "none".
      const path =
        active.kind === 'model' && active.id.startsWith('model:')
          ? active.id.slice('model:'.length)
          : '';
      return { kind: active.kind, path };
    },
    // THE AREA IS JOINED FROM THE TWO PLACES THAT HOLD IT: the descriptor says WHICH area
    // this document fills (the workspace that opened it wrote the id), and the active
    // workspace's own `areas` entry says WHERE that area sits and how big it starts. An id
    // the active workspace no longer declares carries no area, which is the same answer
    // `workspace-areas.ts` gives a moment later when it closes the document.
    list: () =>
      openWorkspaceDocuments().map((open) => {
        const area = open.descriptor.area
          ? activeWorkspaceAreas().find((candidate) => candidate.id === open.descriptor.area)
          : undefined;
        return {
          id: open.descriptor.id,
          title: open.title,
          ...(area ? { area: { id: area.id, place: area.place, ratio: area.ratio } } : {}),
        };
      }),
    activeId: () => activeWorkspaceDocument()?.descriptor.id ?? null,
    subscribe: (listener) => {
      const registry = subscribeWorkspaceDocuments(listener);
      // The AREAS move on a workspace switch, and the registry is silent about that: the
      // documents it holds are the same objects, only the list that gives them a place and a
      // ratio has changed. The frame needs both edges.
      const areas = subscribeWorkspaceAreas(listener);
      return () => {
        registry();
        areas();
      };
    },
    activate: (id, viewId) => {
      if (viewId) setActiveWorkspaceDocumentView(id, viewId);
      else activateWorkspaceDocument(id);
    },
    // The registry's own close, which runs the descriptor's `onClose` and
    // activates whatever is left — the same door the dock's tab × used.
    //
    // IT CAN REFUSE, and the one reason it does is an unsaved draft: the
    // registry will not discard authored work on a close gesture. Our editor
    // input is Readonly, so the workbench asked nothing before closing it —
    // the next reconcile therefore re-opens the editor, and this says why
    // rather than letting the tab reappear on its own.
    close: (id) => {
      if (closeWorkspaceDocument(id)) return;
      const open = openWorkspaceDocuments().find((doc) => doc.descriptor.id === id);
      if (!open) return;
      keyboard.report(
        'warn',
        `“${open.title}” has unsaved changes, so it stayed open. Save it (⌘S) and close it again.`,
      );
    },
    setView: (view, closed) => setDocumentView(view, closed),
  };
  const history: VgaiHistoryHandle = {
    elements: () => editorHost().history.elements(),
    onElement: (listener) => editorHost().history.onElement(listener),
    onInvalidated: (listener) => editorHost().history.onInvalidated(listener),
    changed: () => editorHost().history.changed(),
    focusedResource: () => editorHost().history.focusedResource(),
    // The document's TITLE is what a refusal should say ("Nothing to undo in
    // MainScene"), and the id is what scopes the stack; both come from the
    // door's own `documents.active()` rather than a second notion here.
    focusedDocument: () => {
      const active = editorHost().documents.active();
      return active ? { id: active.id, label: active.title } : null;
    },
    setDelegate: (delegate) => editorHost().history.setDelegate(delegate),
    report: keyboard.report,
  };
  const files: VgaiFilesHandle = {
    setProvider: (provider) => editorHost().files.setProvider(provider),
    report: keyboard.report,
  };
  const settings: VgaiSettingsHandle = {
    setProvider: (provider) => editorHost().settings.setProvider(provider),
    // The DECLARATION, not the layer in force: what the frame writes to its
    // MEMORY target. Reading the layer would be circular — the layer in force
    // is what the frame just wrote.
    adapterValues: () => [...declaredAdapterSettingEntries()],
    // The ADAPTER's own stream, not the settings store's: the store notifies for
    // every layer including the memory values the frame itself just wrote, and
    // waking the frame's apply pass with its own writes is the re-entrancy
    // `vgaiSettings.ts`'s header names. This fires when a project opens or its
    // adapter module loads or unloads, which is the only time the declaration
    // can move.
    // THE LOOK'S TOP BAR, resolved rather than declared (U9). `--vgai-command-bar-height` is
    // what `.vgai-project-header`'s own `height` reads, so the title bar becomes exactly the
    // band our stylesheet would have drawn: Classic's 36 (`theme.ts`'s `chromeSize.commandBar`),
    // Blender's 26 (`blender.style.ts`'s `chrome.commandBar`, traced at 1x). Reading the
    // COMPUTED property rather than the style declaration is deliberate — the value is set on
    // `#editor-chrome-root` by the theme installer, and a look that declares no chrome density
    // inherits the editor's own, which only the computed value shows.
    workbenchValues: () => {
      const root = parts?.chromeRoot;
      if (!root) return [];
      const raw = getComputedStyle(root).getPropertyValue('--vgai-command-bar-height').trim();
      const height = Number.parseFloat(raw);
      // A property that has not been painted yet reads '' and parses NaN. Hand back NOTHING
      // rather than a guess: the frame then clears the key and the title bar keeps its own
      // 30/35 until the theme lands, which is a correct top bar rather than a wrong one.
      // The look's colours for the workbench's own ids and the stage's (`look-colors.ts`),
      // read off the same resolved root, so the frame and the page cannot disagree — and
      // handed over whatever the height's state, which is a separate answer.
      const colors: readonly [string, unknown] = ['workbench.colorCustomizations', lookColorCustomizations(root)];
      if (!Number.isFinite(height) || height <= 0) return [colors];
      return [['window.titleBarHeight', Math.round(height)], colors];
    },
    // THE LOOK ITSELF, so the frame can choose its own colour theme for it. `theme-blender`
    // used to set `workbench.colorTheme` as a blanket `configurationDefaults`, which is why
    // Classic still carried Blender's `--vscode-vgai-*` colours (the walk's beat 6). The
    // palette id IS the look — `subscribe` below already watches the theme stream, so a
    // person switching style re-runs the frame's apply pass with no extra wiring.
    lookId: () => editorPaletteSnapshot(),
    // `EditorHost.notify`, which under this frame IS `INotificationService` — the frame's
    // settings layer uses it for the one fact the Settings editor cannot draw: a user value
    // on an adapter-declared key, shown there and ineffective in this project.
    notify: (notification) => {
      editorHost().notify(notification);
    },
    subscribe: (listener) => {
      // BOTH streams, because the two answers move independently: the adapter's declaration
      // changes when a project or its adapter module loads, and the resolved chrome changes
      // when a person switches palette/material inside one project.
      const stopAdapter = subscribeAdapterEditorConfiguration(listener);
      const stopTheme = subscribeEditorTheme(listener);
      return () => {
        stopAdapter();
        stopTheme();
      };
    },
    report: keyboard.report,
  };
  const commands: VgaiCommandsHandle = {
    list: () =>
      paletteActions().map((entry) => ({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        ...(entry.menu ? { menu: entry.menu } : {}),
      })),
    invoke: (id) => invokePaletteAction(id),
    subscribe: (listener) => subscribePaletteActions(listener),
    setPaletteOpener: (open) => setPaletteOpener(open),
    setCommandExecutor: (run) => setCommandExecutor(run),
    report: keyboard.report,
  };
  const notifications: VgaiNotificationsHandle = {
    // The DELEGATE arrives from the contribution, which is the only side that
    // has `INotificationService` — later than the mount, because a
    // `ServicesAccessor` is valid only for a command's synchronous part.
    // Anything `notify()`-ed in that window is queued and shown on arrival
    // (`editor-notifications.ts`).
    // `source` is the toast's "Source:" line — the product's display name
    // (`product-command.ts`), never a kit name.
    setDelegate: (show) =>
      setNotificationDelegate(
        show ? { show: (notification) => show({ ...notification, source: productDisplayName() }) } : null,
      ),
  };
  const views: VgaiViewsHandle = {
    list: () =>
      viewVerbContributions().map((contribution) => ({
        view: contribution.view,
        title: contribution.title,
        verbs: contribution.verbs.map((verb) => ({
          id: verb.id,
          ...(verb.title ? { title: verb.title } : {}),
        })),
      })),
    invoke: (view, verb, args) => invokeViewVerb(view, verb, args),
    subscribe: (listener) => subscribeViewVerbs(listener),
  };
  const utilities: VgaiUtilitiesHandle = {
    list: () =>
      availableWorkspaceUtilities().map((utility, index) => ({
        id: utility.id,
        title: utility.title,
        order: utility.order ?? index,
      })),
    // A utility's availability is session state (State Watch and Network exist only while
    // a running game exposes their adapters), so the workbench hears when the AVAILABLE set
    // moves, not only when the registry does; otherwise a gate that opens at Play never
    // gets a view.
    subscribe: (listener) => {
      let fingerprint = availableUtilityFingerprint();
      const offRegistry = subscribeWorkspaceUtilities(listener);
      const offTick = subscribeAvailabilityTick(() => {
        const next = availableUtilityFingerprint();
        if (next === fingerprint) return;
        fingerprint = next;
        listener();
      });
      return () => {
        offRegistry();
        offTick();
      };
    },
    offerBody: (id, element) => setUtilityBody(id, element),
  };
  // ---- THE GAME SKEW'S THREE FRAME ANSWERS (U2). See `vgaiGameSkew.ts` for why each exists.
  //
  // The pane's active state is held here rather than re-asked, because the probe is read on
  // EVERY gated DOM event (`gated-globals.ts`'s `gateFor`) and must not cross the bridge to
  // answer. `notifySurfaceKeyboard()` is the edge the engine's latched `InputManager` needs.
  let paneActive = true;
  let stopImmersive: (() => void) | null = null;
  let stopDockCommands: (() => void) | null = null;
  setSurfaceKeyboardProbe(() => paneActive);
  const game: VgaiGameHandle = {
    setActiveStaticPanel: (kind) =>
      setActiveWorkspaceStaticPanel(
        WORKSPACE_STATIC_PANELS.find((p) => p.kind === kind)?.kind ?? null,
      ),
    focusCompactInspector: () => {
      if (inspectorColumn) return false;
      const card = parts?.center.querySelector<HTMLElement>(
        '[data-testid="compact-inspector-card"]',
      );
      if (!card) return false;
      card.tabIndex = -1;
      card.focus();
      setActiveWorkspaceStaticPanel('inspector');
      return true;
    },
    setPaneActive: (active) => {
      if (paneActive === active) return;
      paneActive = active;
      notifySurfaceKeyboard();
    },
    // IMMERSIVE PLAY RIDES THE EDITOR'S EXISTING SEAM. `live-transition.ts` owns the timing and
    // the camera flight and never touches a dock; what the dock registered here as a chrome
    // dissolve, the frame registers as a layout act. `root` is the element the transition's own
    // CSS classes land on, which under the frame is the workbench itself.
    setImmersive: (act) => {
      stopImmersive?.();
      stopImmersive = null;
      if (!act || !parts) return;
      stopImmersive = installPlayTransitionDock({
        root: parts.chromeRoot,
        hideChrome: () => act.enter(),
        showChrome: () => act.exit(),
      });
    },
    setDockCommands: (commands) => {
      stopDockCommands?.();
      stopDockCommands = null;
      if (!commands) return;
      stopDockCommands = installWorkspaceHostCommands({
        showUtility: (id) => commands.showUtility(id),
        toggleUtility: (id) => commands.toggleUtility(id),
        ensureUtility: (id) => commands.ensureUtility(id),
        closeUtility: (id) => commands.closeUtility(id),
        showStaticPanel: (kind) => commands.showStaticPanel(kind),
        setFocus: (focused) => commands.setFocus(focused),
        toggleFocus: () => commands.toggleFocus(),
        // `captureUtilities` is what a layout's `playUtilities` uses to show a set for the
        // duration of play and put the drawer back afterwards. The frame's version is the
        // views service: open each, and on release close exactly the ones this call opened.
        captureUtilities: (ids) => {
          for (const id of ids) commands.showUtility(id);
          return () => {
            for (const id of ids) commands.closeUtility(id);
          };
        },
        // UNDO HISTORY HAS NO FRAME HOME, and saying so is the honest answer: under the frame
        // the stack is VS Code's `IUndoRedoService` (U4), so a vgai "undo history" panel would
        // be a second, partial view of a stack the workbench already owns.
        showAuxiliary: () =>
          game.report(
            'warn',
            "Undo history has no panel under the VS Code frame: the stack is the workbench's own (U4), reached through Edit → Undo/Redo and the Timeline.",
          ),
      });
    },
    report: (level, message) => keyboard.report(level, message),
  };
  const statusItems: VgaiStatusHandle = {
    list: () =>
      (['left', 'right'] as const).flatMap((align) =>
        workspaceStatusContributions(align).map((contribution, index) => ({
          id: contribution.id,
          // THE NAME A PERSON READS, not the id. `vgaiStatus.ts` passes it as
          // the entry's `name` and `ariaLabel`, which is what the status bar's
          // own right-click menu says — `Hide Console errors`, never
          // `Hide console-counts`.
          title: contribution.name,
          align,
          order: contribution.order ?? index,
        })),
      ),
    subscribe: (listener) => subscribeWorkspaceStatus(listener),
    offerBody: (id, element) => setStatusBody(id, element),
  };
  return {
    host,
    keyboard,
    documents,
    history,
    files,
    commands,
    notifications,
    views,
    utilities,
    output: { setProvider: setOutputProvider },
    settings,
    status: statusItems,
    game,
    offerPart: offerVgaiPart,
  };
}
