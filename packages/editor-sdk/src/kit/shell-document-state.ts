/**
 * THE SHELL STORE'S MEDIA-NEUTRAL HALF (ARCHITECTURE.md §The plan, unit 3): what a document
 * surface of any medium shares with the kit — selection, project history and change
 * notification. A kit module that needs only these types itself against this interface, never
 * against `EditorShellStore`, whose other half (the Three scene, its object map, cameras and
 * viewport tools) leaves the kit for `@volter/editor-threejs`.
 */
import type { HistoryService } from './history/history-service';

export interface ShellDocumentState {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  getShellSnapshot(): number;
  readonly contentVersion: number;
  readonly hierarchyRowFacetVersion: number;
  readonly projectHistory: HistoryService | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selectedEntityId: string | null;
  readonly selectedEntityIds: ReadonlySet<string>;
  select(id: string | null, notification?: 'immediate' | 'deferred'): void;
  selectMultiple(ids: string[], notification?: 'immediate' | 'deferred'): void;
  addToSelection(id: string): void;
  toggleSelection(id: string): void;
  /** Content changed without a history step (a live edit, a projection refresh). */
  notifyIngestEdit(): void;
}
