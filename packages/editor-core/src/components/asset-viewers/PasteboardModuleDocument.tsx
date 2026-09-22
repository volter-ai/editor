/**
 * THE PASTEBOARD DOCUMENT (queue item 4): an ordinary project `.tsx` whose
 * default export renders the pasteboard capability's `Pasteboard` helper,
 * opened as the design canvas it IS.
 *
 * Deliberately nothing but a routing shim: the surface is the SAME
 * {@link RootDocumentContent} every root/board document mounts — design-time
 * react mount, `ReactRootAuthoringAdapter` with the tier write backend,
 * selection overlay, align/snap, pan/zoom backdrop — pointed at a SYNTHETIC
 * design-time root descriptor whose `entryOnly` skips the project story board
 * (the file is the canvas; a gallery of every dom story is a different
 * document). Dragging an `<At>` child therefore writes its `x`/`y` JSX
 * literals through the box-edit path's pasteboard branch
 * (`react-world-authoring-adapter.ts`).
 */

import { themeVars } from '@volter/editor-sdk/widgets';
import { useMemo } from 'react';
import type { DesignTimeRootDescriptor } from '../../authoring/design-time-layers';
import { activeRootDocumentHost, RootDocumentContent } from '../world-documents';

export function PasteboardModuleDocument({
  documentId,
  active,
  modulePath,
}: {
  readonly documentId: string;
  readonly active: boolean;
  /** Project-relative path of the pasteboard `.tsx`. */
  readonly modulePath: string;
}) {
  const host = activeRootDocumentHost();
  const descriptor = useMemo<DesignTimeRootDescriptor>(
    () => ({
      worldId: `pasteboard:${modulePath}`,
      kind: 'dom',
      path: modulePath,
      zOrder: 0,
      pausable: false,
      entryOnly: true,
    }),
    [modulePath],
  );
  if (!host) {
    return (
      <div style={{ padding: 20, color: themeVars.content.muted }}>
        This pasteboard needs the project session&apos;s root-document host, which is not installed
        yet. Reopen the file once the project finishes loading.
      </div>
    );
  }
  return (
    // RootDocumentContent's own root is `position:absolute; inset:0`; the
    // asset-document host hands a plain block container, so this wrapper is
    // the positioned, full-height box it fills (the LiveModuleDocument FILL
    // note, same measurement).
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <RootDocumentContent
        documentId={documentId}
        active={active}
        composite={host.composite}
        descriptor={descriptor}
        store={host.store}
      />
    </div>
  );
}
