import {
  documentViewport,
  documentViewportsVersion,
  subscribeDocumentViewports,
} from '@volter/sdk/kit/document-viewports';
import {
  bindDocumentSecondAreaHeader,
  documentAreasVersion,
  documentSecondArea,
  subscribeDocumentAreas,
} from '@volter/sdk/kit/document-areas';
import { type ReactNode, Suspense, useCallback, useSyncExternalStore } from 'react';
import { chromeRegionsKey, subscribeChromeRegions } from '@volter/sdk/kit/workspace-regions';

/**
 * THE DOCUMENT HEADER STRIP — the one region every document's header lives
 * in, drawn by the host. Three kinds of content share the row:
 *
 *  - the document's OWN header (`children`: the descriptor's `Toolbar`, or a
 *    contribution's `export const Toolbar` mounted through `ToolHost`), which
 *    keeps the leading, full-width part of the row;
 *  - the host's TRANSFORM controls (`transformControls`: orientation, pivot,
 *    snap, transform options), for a document whose stage takes them — they
 *    are HEADER controls in Blender's 3D viewport, not tool-shelf ones, and
 *    the shelf holds tools only;
 *  - the controls the document's stage adds to its header (a three.js
 *    stage's frame, camera, shading, environment and preview capture) for
 *    ANY document whose stage registered a viewport
 *    (`@volter/sdk/kit/document-viewports`), so no descriptor has to
 *    declare them. A chromeless mount (an inspector preview) registers none
 *    and gets no strip.
 *
 * AFTER THEM, THE HEADER OF THE DOCUMENT'S SECOND AREA (`@volter/sdk/kit/document-areas`):
 * an empty region as wide as the document asked, which it draws that area's header into, so a
 * document split into areas side by side has one header over each, as Blender's areas do.
 *
 * The strip renders when either kind has something to show. Exported so the
 * bounded host, which mounts a document without the dock, draws the
 * SAME strip instead of a copy.
 */
export function DocumentHeaderStrip({
  documentId,
  runtime = false,
  island = false,
  assetPath,
  transformControls,
  children,
}: {
  readonly documentId: string;
  /** Runtime controls belong to the live view, independent of authoring chrome. */
  readonly runtime?: boolean;
  /** The floating-composition island treatment for a world document. */
  readonly island?: boolean;
  /** The asset this document opened, when it is an asset document — the
   *  caller that knows (the dock, through `assetDocumentSpec`) passes it, so
   *  this module never imports the asset-document machinery and a host
   *  without it (a bounded host) pays only for the toolbar. */
  readonly assetPath?: string | undefined;
  /** The host's TRANSFORM controls (`TransformHeaderControls`), passed by the
   *  caller that knows whether this document's stage takes them — the GIZMO
   *  arm of the same `stageTransformDriver` answer that gates the shelf's tool
   *  strip, because every one of these four wells configures the editor
   *  viewport's gizmo and a stage with none has nothing for them to set. They
   *  render at the trailing edge beside the 3D controls, which is where
   *  Blender's viewport header carries them. */
  readonly transformControls?: ReactNode;
  readonly children?: ReactNode;
}) {
  useSyncExternalStore(
    subscribeDocumentViewports,
    documentViewportsVersion,
    documentViewportsVersion,
  );
  const regionsVersion = useSyncExternalStore(
    subscribeChromeRegions,
    chromeRegionsKey,
    chromeRegionsKey,
  );
  useSyncExternalStore(subscribeDocumentAreas, documentAreasVersion, documentAreasVersion);
  const endWidth = documentSecondArea(documentId)?.headerWidth ?? null;
  const bindEnd = useCallback(
    (element: HTMLDivElement | null) => bindDocumentSecondAreaHeader(documentId, element),
    [documentId],
  );
  const HeaderControls = documentViewport(documentId)?.HeaderControls;
  if (!children && !HeaderControls && !transformControls) return null;
  // The workspace's knob, not the document's: a skin that hides headers hides
  // them for every document in that workspace (`EditorWorkspaceRegions`).
  if (!runtime && regionsVersion.includes('header:hidden')) return null;
  return (
    <div
      className={
        island
          ? 'volter-dock-document-toolbar volter-chrome-island volter-glass-island'
          : 'volter-dock-document-toolbar'
      }
      data-runtime-toolbar={runtime || undefined}
      data-island-scale="compact"
      data-testid={`document-header:${documentId}`}
    >
      {children ? <div className="volter-dock-document-toolbar-own">{children}</div> : null}
      {transformControls}
      {HeaderControls ? (
        <Suspense fallback={null}>
          <HeaderControls
            documentId={documentId}
            {...(assetPath && !assetPath.startsWith('online:') ? { assetPath } : {})}
          />
        </Suspense>
      ) : null}
      {endWidth === null ? null : (
        <div
          ref={bindEnd}
          className="volter-dock-document-toolbar-area"
          data-testid={`document-header-area:${documentId}`}
          // Its own header, painted over the first area's row: controls that run past the first
          // area's width go under it rather than over the second's, as a narrow Blender area's
          // header runs out of room at its own edge.
          style={{
            flex: '0 0 auto',
            width: endWidth,
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            position: 'relative',
            zIndex: 1,
            background: 'var(--volter-surface-chrome)',
          }}
        />
      )}
    </div>
  );
}
