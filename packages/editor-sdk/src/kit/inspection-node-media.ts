/**
 * WHAT A SELECTED NODE LOOKS LIKE, answered by the medium that draws it. The
 * kit's inspection composer builds the Preview section, the instanced note and
 * the Asset Editor jump from this answer and names no medium itself: a three.js
 * node answers with its isolated live view, a node no registered medium draws
 * answers nothing and the composer falls back to a canvas capture or the
 * component's own picture.
 */
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { InspectionAction, InspectionSection } from './inspection-model';

export type InspectionPreviewRenderer = Extract<InspectionSection['body'], { readonly kind: 'preview' }>['render'];

export interface InspectionNodeMedia {
  /**
   * The node's own picture for the Preview section, or `null` for a node its
   * medium shows elsewhere (a camera's view is the viewport's) — which means no
   * Preview section at all, not a fallback picture.
   */
  readonly preview:
    | ((context: {
        readonly displayName: string;
        readonly previewKey: string;
        readonly actions: readonly InspectionAction[];
      }) => InspectionPreviewRenderer)
    | null;
  /** One object drawing many units, for the Transform section's note. */
  readonly instanced: {
    readonly units: number;
    readonly detail: string;
    readonly worldAnchored: boolean;
    readonly note: string | null;
  } | null;
  /** The node has an Asset Editor document to jump to; `open` answers its id. */
  readonly assetDocument: { readonly open: () => string | null } | null;
}

export type InspectionNodeMediaProvider = (
  adapter: AuthoringAdapter,
  nodeId: string,
) => InspectionNodeMedia | null;

const providers = new Set<InspectionNodeMediaProvider>();

/** Register a medium's answer. Returns the removal. */
export function registerInspectionNodeMedia(provider: InspectionNodeMediaProvider): () => void {
  providers.add(provider);
  return () => providers.delete(provider);
}

/** The first registered medium that draws this node, or null. */
export function inspectionNodeMedia(adapter: AuthoringAdapter, nodeId: string): InspectionNodeMedia | null {
  for (const provider of providers) {
    const media = provider(adapter, nodeId);
    if (media) return media;
  }
  return null;
}
