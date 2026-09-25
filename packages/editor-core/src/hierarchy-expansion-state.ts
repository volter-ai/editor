/**
 * Project-scoped hierarchy expansion preferences.
 *
 * Expansion belongs to an authored node's stable adapter id, not to its
 * current row index. That lets the same preference survive an edit/live
 * adapter replacement (Play/Stop) and ordinary React remounts. The project
 * scope prevents common ids such as `game` or `root` leaking between games.
 *
 * Only explicit user choices are stored. A node with no entry follows the
 * hierarchy's current shallow-open default, so changing the projection does
 * not require a migration of a fully materialized tree state.
 */

/** The section of the project-local document this module owns. */
const SECTION = 'hierarchyExpansion';

import {
  projectLocalSection,
  projectLocalStateReady,
  writeProjectLocalSection,
} from '@volter/editor-sdk/kit/project-local-state';

type ProjectPreferences = Map<string, boolean>;

const preferences = new Map<string, ProjectPreferences>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  if (!projectLocalStateReady()) return;
  hydrated = true;
  const parsed = projectLocalSection<Record<string, Record<string, boolean>>>(SECTION) ?? {};
  for (const [projectId, nodes] of Object.entries(parsed)) {
    preferences.set(projectId, new Map(Object.entries(nodes)));
  }
}

function persist(): void {
  const serialized: Record<string, Record<string, boolean>> = {};
  for (const [projectId, nodes] of preferences) {
    serialized[projectId] = Object.fromEntries(nodes);
  }
  writeProjectLocalSection(SECTION, serialized);
}

export function hierarchyExpansionPreference(
  projectId: string,
  nodeId: string,
): boolean | undefined {
  hydrate();
  return preferences.get(projectId)?.get(nodeId);
}

/** Apply a whole branch/view operation with one storage write. */
export function setHierarchyExpansionPreferences(
  projectId: string,
  entries: Iterable<readonly [nodeId: string, expanded: boolean]>,
): void {
  hydrate();
  let project = preferences.get(projectId);
  if (!project) {
    project = new Map();
    preferences.set(projectId, project);
  }
  for (const [nodeId, expanded] of entries) project.set(nodeId, expanded);
  persist();
}

/** Return every node in one project to the shallow first-open policy. */
export function clearHierarchyExpansionPreferences(projectId: string): void {
  hydrate();
  preferences.delete(projectId);
  persist();
}

/** Test-only reset for this process (the in-memory map; the document is untouched). */
export function _resetHierarchyExpansionPreferencesForTest(): void {
  preferences.clear();
  hydrated = true;
}
