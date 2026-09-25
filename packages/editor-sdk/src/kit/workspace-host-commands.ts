import type { WorkspaceStaticPanelKind } from './workspace-static-panels';

/**
 * THE IMPERATIVE BOUNDARY between the editor's semantic commands and whatever
 * layout host is mounted — today the Code-OSS frame, which installs the
 * implementations from `frame/bridge.tsx` and answers them with the
 * workbench's own views and editor groups.
 *
 * Callers ask to reveal a capability by stable ID and never encode its current
 * coordinates: a person may have moved that view since startup, and the host
 * is the only thing that knows where it is now. A command asked before a host
 * has installed is QUEUED and flushes on the install, so a startup gesture is
 * never lost to boot order.
 */

export interface WorkspaceHostCommands {
  /** Capture only the utility presentation a temporary layout behavior will change. */
  captureUtilities?(ids: readonly string[]): () => void;
  /** Focus one of the editor's built-in persistent panels. The vocabulary is
   *  the static-panel REGISTRY (`workspace-static-panels.ts`) — the host maps
   *  a kind to its own surface, and no caller keeps a second list. */
  showStaticPanel(kind: WorkspaceStaticPanelKind): void;
  /** Materialize an on-demand utility tab without opening the utility region:
   *  the drawer presents itself collapsed to its tab strip, so the new tab and
   *  its badge are discoverable while the body stays closed. */
  ensureUtility?(id: string): void;
  showUtility(id: string): void;
  toggleUtility(id: string): void;
  /** Remove a transient utility from wherever the host put it. Hosts restore
   * the utility that was active before it was revealed, or collapse the
   * utility region when it was opened only for this one. */
  closeUtility?(id: string): void;
  showAuxiliary(id: 'undo-history'): void;
  toggleFocus(): void;
  setFocus?(focused: boolean): void;
}

let commands: WorkspaceHostCommands | null = null;
let pending: Array<(value: WorkspaceHostCommands) => void> = [];
let activeUtilityId: string | null = null;
let activeStaticPanel: WorkspaceStaticPanelKind | null = null;
let _utilityVersion = 0;
const utilityListeners = new Set<() => void>();
let utilityTabIds: readonly string[] = [];
const utilityTabsListeners = new Set<() => void>();

export function setActiveWorkspaceUtility(id: string | null): void {
  if (activeUtilityId === id) return;
  activeUtilityId = id;
  _utilityVersion++;
  for (const listener of utilityListeners) listener();
}

export function activeWorkspaceUtility(): string | null {
  return activeUtilityId;
}

export function subscribeActiveWorkspaceUtility(listener: () => void): () => void {
  utilityListeners.add(listener);
  return () => utilityListeners.delete(listener);
}

/** The static panel holding the dock's focus, or `null` when a document or a
 *  drawer utility does. The dock reports it from its own active-panel event,
 *  so this is what a human is looking at — not the last thing asked for. */
export function setActiveWorkspaceStaticPanel(kind: WorkspaceStaticPanelKind | null): void {
  activeStaticPanel = kind;
}

export function activeWorkspaceStaticPanel(): WorkspaceStaticPanelKind | null {
  return activeStaticPanel;
}

/** The utility tabs the host currently holds, in its own order. The host owns
 * the tab strip's presentation; this list is the semantic readout of it
 * (stories, and callers asking what exists). */
export function setWorkspaceUtilityTabs(ids: readonly string[]): void {
  if (
    ids.length === utilityTabIds.length &&
    ids.every((id, index) => id === utilityTabIds[index])
  ) {
    return;
  }
  utilityTabIds = [...ids];
  for (const listener of utilityTabsListeners) listener();
}

export function workspaceUtilityTabs(): readonly string[] {
  return utilityTabIds;
}

function invoke(operation: (value: WorkspaceHostCommands) => void): void {
  if (commands) operation(commands);
  else pending.push(operation);
}

export function installWorkspaceHostCommands(next: WorkspaceHostCommands): () => void {
  commands = next;
  const queued = pending;
  pending = [];
  for (const operation of queued) operation(next);
  return () => {
    if (commands === next) commands = null;
  };
}

export function showWorkspaceUtility(id: string): void {
  invoke((value) => value.showUtility(id));
}

export function ensureWorkspaceUtility(id: string): void {
  invoke((value) => value.ensureUtility?.(id));
}

export function showWorkspaceStaticPanel(kind: WorkspaceStaticPanelKind): void {
  invoke((value) => value.showStaticPanel(kind));
}

export function toggleWorkspaceUtility(id: string): void {
  invoke((value) => value.toggleUtility(id));
}

export function closeWorkspaceUtility(id: string): void {
  invoke((value) => value.closeUtility?.(id));
}

export function showWorkspaceAuxiliary(id: 'undo-history'): void {
  invoke((value) => value.showAuxiliary(id));
}

export function toggleWorkspaceFocus(): void {
  invoke((value) => value.toggleFocus());
}

export function setWorkspaceFocus(focused: boolean): void {
  invoke((value) => value.setFocus?.(focused));
}

export function captureWorkspaceUtilities(ids: readonly string[]): () => void {
  return commands?.captureUtilities?.(ids) ?? (() => {});
}
