/**
 * What a medium adds to the hierarchy panel's rows: a row's detail line (an instanced mesh names
 * the units one object draws), the adapter's component marks, and the store's structural change
 * log that lets the panel patch rows instead of rebuilding them. The Three integration registers
 * its answers; with none registered a row has no detail, no marks, and the panel rebuilds.
 */
import type { AuthoringAdapter, HierarchyProvider } from '@volter/editor-project/adapter';
import type { NodeMarkReader } from './hierarchy-component-marks';
import type { ShellStore } from './shell-store';

/** Which projected parents changed after an epoch; `null` when the panel must rebuild. */
export interface HierarchyStructureLog {
  epoch(): number;
  parentChangesSince(epoch: number): { readonly epoch: number; readonly changedParentIds: ReadonlySet<string> } | null;
}

export interface HierarchyRowMedia {
  detail(adapter: AuthoringAdapter, nodeId: string, store: ShellStore): string | null;
  marks(hierarchy: Pick<HierarchyProvider, 'object3D'>): NodeMarkReader;
  structureLog(store: ShellStore): HierarchyStructureLog | null;
}

let registered: HierarchyRowMedia | null = null;
const listeners = new Set<() => void>();

export function registerHierarchyRowMedia(media: HierarchyRowMedia): () => void {
  registered = media;
  for (const listener of listeners) listener();
  return () => {
    if (registered !== media) return;
    registered = null;
    for (const listener of listeners) listener();
  };
}

export function hierarchyRowMedia(): HierarchyRowMedia | null {
  return registered;
}

export function subscribeHierarchyRowMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
