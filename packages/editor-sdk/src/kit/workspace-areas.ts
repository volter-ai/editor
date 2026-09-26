/**
 * THE ACTIVE WORKSPACE'S EDITOR AREAS — the live store the dock reads, and the
 * one place an area document is opened and closed.
 *
 * **A Blender editor AREA is an editor group; the drawer holds utilities**
 * (orchestrator ruling 2026-09-19; WORK.md §Inspection parity I5). Blender's UV
 * Editing is a side-by-side split of the centre, Shading and Animation a
 * top/bottom split, and both the dock and the Code-OSS frame have exactly that
 * shape in editor groups. So a workspace's second editor is a
 * `workspace.document` contribution opened into a second group — never a
 * drawer utility — and this module is the seam: `workspace-presets.ts`
 * publishes the active workspace's `areas` here on every switch, and this
 * module opens what that list names and closes what it no longer does.
 *
 * WHY THE OPEN LIVES HERE AND NOT IN THE DOCK. The dock is a RECONCILER: it
 * draws whatever the document registry holds, and `reconcileWorkspace` runs on
 * every mutation, so opening a document from inside it is a write during a
 * read. The registry is the truth; the frame places it (`vgaiDocuments.ts`'s
 * `reconcileAreaDocumentPanels`), and under the frame the layout host places
 * the same registry entry in a VS Code editor group instead. One list, two
 * hosts — the shape every U8 seam takes.
 *
 * WHY IT IS A MODULE AND NOT A REACT EFFECT. A workspace switch arrives from
 * four places (the menu, a registered action, `editor.workspace(id)`, the
 * per-project restore at boot) and three of them have no component mounted to
 * run an effect. `setWorkspaceAreas` is called by the same function that
 * publishes the regions, so the two halves of "apply this workspace" cannot
 * drift apart.
 */

import type { WorkspaceAreaContribution } from '@volter/editor-sdk/layout-arrangements';
import { openToolDocument, toolDocumentId } from './components/tool-documents';
import { subscribeToolContributions } from './tool-loader';
import { closeWorkspaceDocument, openWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';

let _areas: readonly WorkspaceAreaContribution[] = [];
let _version = 0;
const _listeners = new Set<() => void>();

/** The active workspace's areas, in declaration order. */
export function activeWorkspaceAreas(): readonly WorkspaceAreaContribution[] {
  return _areas;
}

/** Monotonic counter behind {@link subscribeWorkspaceAreas}. */
export function workspaceAreasVersion(): number {
  return _version;
}

export function subscribeWorkspaceAreas(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** The area one open document fills, or `null` — the dock's lookup. */
export function workspaceAreaFor(documentId: string): WorkspaceAreaContribution | null {
  return _areas.find((area) => toolDocumentId(area.document) === documentId) ?? null;
}

/**
 * THE WHOLE OPEN PASS LEAVES THE MODULE EVALUATION, and this is the second and
 * correct form of a fix the first attempt got half right.
 *
 * MEASURED TWICE, live, on a fresh `--template models` scaffold:
 *  1. `subscribeToolContributions(...)` at this file's top level →
 *     "editor app failed to start: ReferenceError: Cannot access 'listeners'
 *     before initialization at subscribeToolContributions
 *     (tool-loader.ts:372) at workspace-areas.ts:41", x3. The WHOLE editor
 *     down, not a degraded panel.
 *  2. The same subscription moved to the first `setWorkspaceAreas` call →
 *     the SAME error, one frame deeper: `... at ensureSubscribedToContributions
 *     ... at setWorkspaceAreas ... at publishWorkspaceRegions
 *     (workspace-presets.ts:119) at workspace-presets.ts:164`.
 *
 * The second reading is the one that names the real shape:
 * `workspace-presets.ts` calls `publishWorkspaceRegions()` AT MODULE SCOPE
 * (line 389 in source), so "the first publish" IS during module evaluation —
 * deferring to it deferred nothing. And this module is in one import cycle
 * with `tool-loader` (`workspace-areas` -> `components/tool-documents` ->
 * `tool-loader`), so every binding over there is still in its temporal dead
 * zone at that moment. `subscribeToolContributions` was merely the first of
 * this module's reaches into it; `openToolDocument` is the other, and it
 * would have thrown next.
 *
 * So the pass is queued as a MICROTASK. ES module evaluation is synchronous
 * end to end, so a microtask queued during it runs after the last module has
 * finished — every binding initialized, no ordering to reason about. The
 * publish itself stays synchronous: `_areas`, the version and the listeners
 * are this module's own state and nothing else's, and the dock must see the
 * new list on the same tick the workspace changed.
 */
let subscribed = false;
let pendingPass = false;

function runOpenPass(): void {
  pendingPass = false;
  if (!subscribed) {
    subscribed = true;
    // THE CONTRIBUTIONS ARRIVE AFTER THE WORKSPACE, EVERY TIME. A project's
    // packages import asynchronously, so the workspace restored at boot
    // publishes its `areas` while `blender-uv-editor.document` is still
    // loading and `openToolDocument` truthfully opens nothing. Contributions
    // changing is the other half of the same event — including a SAVE, which
    // re-evaluates the module and must re-open the document against the fresh
    // component.
    subscribeToolContributions(scheduleOpenPass);
  }
  const areas = _areas;
  const wanted = new Set(areas.map((area) => toolDocumentId(area.document)));
  // CLOSING IS BY AREA, NOT BY ID SET DIFFERENCE. A document that is open and
  // carries an `area` but is not in the new list is this module's to close,
  // and nothing else in the editor opens one — so the sweep reads the registry
  // rather than remembering what it opened, which is what survives a reload
  // that rebuilt the registry underneath.
  for (const open of openWorkspaceDocuments()) {
    if (!open.descriptor.area) continue;
    if (wanted.has(open.descriptor.id)) continue;
    closeWorkspaceDocument(open.descriptor.id);
  }
  for (const area of areas) {
    // `openToolDocument` is self-verifying: a contribution that has not loaded
    // yet opens nothing and answers false, and the subscription above runs
    // this pass again when it arrives. No queue, no retry timer.
    openToolDocument(area.document, { activate: false }, area.id);
  }
}

function scheduleOpenPass(): void {
  if (pendingPass) return;
  pendingPass = true;
  queueMicrotask(runOpenPass);
}

function areasKey(areas: readonly WorkspaceAreaContribution[]): string {
  return areas.map((area) => `${area.id}|${area.document}|${area.place}|${area.ratio}`).join(' ');
}

/**
 * Publish the active workspace's areas (`workspace-presets.ts`), opening the
 * documents it names and closing the ones the previous workspace had.
 */
export function setWorkspaceAreas(areas: readonly WorkspaceAreaContribution[]): void {
  const changed = areasKey(areas) !== areasKey(_areas);
  _areas = areas;
  scheduleOpenPass();
  if (!changed) return;
  _version += 1;
  for (const listener of _listeners) listener();
}

/** Re-run the open pass without changing the list — the door for "the
 *  contributions finished loading", which is when a workspace applied at boot
 *  can finally find the document it named. */
export function reopenWorkspaceAreas(): void {
  scheduleOpenPass();
}
