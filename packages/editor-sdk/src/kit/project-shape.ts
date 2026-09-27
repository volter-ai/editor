/**
 * What the active project DECLARES, as the chrome reads it (ARCHITECTURE-CORE
 * §Roots: "a project's shape is derived from what it declares, never
 * assumed"). Nothing here names a kind of project; the questions are the
 * ones chrome actually has — does anything mount? — answered from the
 * manifest's own `roots`.
 */

import { useSyncExternalStore } from 'react';
import { getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/active-project';

/** True when the active project declares at least one root — something the
 *  host mounts, plays and instances. A project config from before
 *  `rootCount` existed answers true, which is what every project was. */
export function projectMounts(): boolean {
  const count = getCurrentProject()?.config.rootCount;
  return count === undefined ? true : count > 0;
}

/** {@link projectMounts} as a React subscription. */
export function useProjectMounts(): boolean {
  return useSyncExternalStore(onProjectChange, projectMounts, projectMounts);
}

const shapeListeners = new Set<() => void>();

/** The adapter host resolved (or re-resolved) the document table: what the
 *  project declares may have changed without the project itself changing. */
export function notifyProjectShapeChanged(): void {
  for (const fn of shapeListeners) fn();
}

/** Fires on {@link notifyProjectShapeChanged} and on a project change. */
export function subscribeProjectShape(fn: () => void): () => void {
  shapeListeners.add(fn);
  const stopProject = onProjectChange(fn);
  return () => {
    shapeListeners.delete(fn);
    stopProject();
  };
}

/** The document kinds the active project's resolved table holds, supplied by
 *  the adapter host (`project-adapter.ts` registers it) so this module —
 *  which a bounded host's closure carries — imports no adapter machinery. `null`
 *  until an adapter has resolved. */
let documentKindsSupplier: (() => readonly string[] | null) | null = null;
export function registerDocumentKindsSupplier(supplier: () => readonly string[] | null): void {
  documentKindsSupplier = supplier;
}

/** True when the active project's resolved document table holds an entry
 *  of `kind` — what a workspace built around one kind of document requires
 *  (Model, Sculpt and Texture require a `model`). Before the adapter has
 *  resolved, the answer is true, so a workspace never vanishes mid-boot. */
export function projectDeclaresDocumentKind(kind: string): boolean {
  const kinds = documentKindsSupplier?.() ?? null;
  if (kinds === null) return true;
  return kinds.includes(kind);
}

/** The same answer as a LIST, for a message that has to name the vocabulary
 *  rather than test one value against it (`present-view`'s refusal on an
 *  unknown document kind). `null` before the adapter has resolved — a refusal
 *  that cannot read the table says less, never something invented. */
export function projectDocumentKinds(): readonly string[] | null {
  return documentKindsSupplier?.() ?? null;
}
