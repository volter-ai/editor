import { type ReactNode, useSyncExternalStore } from 'react';
import { chromeRegionsKey, subscribeChromeRegions } from '@volter/editor-sdk/kit/workspace-regions';

/**
 * THE DOCUMENT SHELF — Blender's tool shelf (T), the host's second region
 * after the header strip (`DocumentHeaderStrip`): a vertical rail at the
 * leading edge of a document's content box, drawn by the host, contents
 * contributed: the host's transform tools on top for every three stage
 * (`WorkspaceDocumentSurface`, selection or not — Blender's rail is
 * persistent), then the document's own — the mesh document its operators, a
 * project's own document whatever it exports as `Shelf`. The rail sits INSIDE the content box (absolute, over the stage —
 * the position `.vgai-dock-document-content` now provides), so the header
 * strip above it is never covered and the stage keeps its full size.
 *
 * Nothing renders when there is nothing to show; a document without a shelf
 * has no rail, not an empty one.
 */
export function DocumentShelfRail({
  documentId,
  children,
}: {
  readonly documentId: string;
  readonly children?: ReactNode;
}) {
  const regionsVersion = useSyncExternalStore(
    subscribeChromeRegions,
    chromeRegionsKey,
    chromeRegionsKey,
  );
  if (!children) return null;
  // The workspace's knob (`EditorWorkspaceRegions.shelf`), the same way the
  // header strip reads its own.
  if (regionsVersion.includes('shelf:hidden')) return null;
  return (
    <div
      className="vgai-dock-document-shelf"
      data-testid={`document-shelf:${documentId}`}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Document tools"
    >
      {children}
    </div>
  );
}
