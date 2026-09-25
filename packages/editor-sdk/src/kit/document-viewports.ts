/**
 * A DOCUMENT'S VIEWPORT, as the stage that shows it answers for it: the camera,
 * the diagnostic view, the grid, framing, a document's own selection and a
 * photograph of what it draws. The kit's view presentation and its current-view
 * readout (`EditorView.viewport`) ask here for the active document, so a view
 * link reaches whichever medium draws that document. A document no stage
 * registered has no viewport, which is what `EditorView` then says.
 */
import type { CaptureDimensions, EditorView } from '../types';

export type EditorViewViewport = NonNullable<EditorView['viewport']>;

export interface DocumentViewport {
  /** Camera pose, diagnostic and grid now; null while nothing is drawn yet. */
  read(): Pick<EditorViewViewport, 'camera' | 'diagnostic' | 'grid'> | null;
  setGrid(on: boolean): void;
  /** False when this viewport has no such diagnostic view. */
  setDiagnostic(diagnostic: NonNullable<EditorViewViewport['diagnostic']>): boolean;
  /** False when this viewport has no such camera. */
  setCamera(camera: NonNullable<EditorViewViewport['camera']>): boolean;
  /** False when there is nothing to frame. */
  frame(target: NonNullable<EditorViewViewport['frame']>): boolean;
  /** A document that keeps its own selection (an Object3D document) answers
   *  and applies it here; one that does not uses the shell's. */
  readonly selection?: {
    read(): readonly string[];
    apply(ids: readonly string[]): void;
  };
  /** A PNG data URL of what it draws, when it can render one on demand. */
  capture?(size?: CaptureDimensions): string | null;
  /** Settles before a view is applied (an asynchronously mounting document). */
  prepare?(): Promise<void>;
}

const viewports = new Map<string, DocumentViewport>();

/** Register the viewport of one document. Returns the removal. */
export function registerDocumentViewport(documentId: string, viewport: DocumentViewport): () => void {
  viewports.set(documentId, viewport);
  return () => {
    if (viewports.get(documentId) === viewport) viewports.delete(documentId);
  };
}

export function documentViewport(documentId: string | null | undefined): DocumentViewport | null {
  return documentId ? (viewports.get(documentId) ?? null) : null;
}

const announced = new Map<string, number>();

/**
 * A DOCUMENT'S STAGE ANNOUNCES ITSELF AS IT RENDERS, before the viewport it will
 * register exists — the fact an opener's `ready` needs and cannot get from
 * anywhere else: whether a document mounts a stage is a fact of its MOUNT,
 * never of its address. Counted, so overlapping mounts of one document (a
 * revision swap) release in any order. Returns the release.
 */
export function announceDocumentStage(documentId: string): () => void {
  announced.set(documentId, (announced.get(documentId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const open = (announced.get(documentId) ?? 0) - 1;
    if (open > 0) announced.set(documentId, open);
    else announced.delete(documentId);
  };
}

/** Whether a stage for this document has begun mounting. */
export function documentStageAnnounced(documentId: string): boolean {
  return (announced.get(documentId) ?? 0) > 0;
}
