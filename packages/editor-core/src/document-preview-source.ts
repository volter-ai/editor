import type { EditorCameraState } from '@volter/editor-sdk';

export const DOCUMENT_PREVIEW_WIDTH = 320;
export const DOCUMENT_PREVIEW_HEIGHT = 180;
export const DOCUMENT_PREVIEW_RECIPE = 'document-preview-v4';

export interface DocumentPreviewCaptureRequest {
  readonly width: number;
  readonly height: number;
  readonly camera?: EditorCameraState | undefined;
}

/** The document owner supplies pixels and dependency identity; the host owns
 * scheduling, disk cache, visibility priority, and tile state. */
export interface DocumentPreviewSource {
  /** Stable identity for source and imported-dependency state. */
  revision(): string;
  subscribe(listener: () => void): () => void;
  capture(request: DocumentPreviewCaptureRequest): Promise<string>;
}
