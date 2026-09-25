/**
 * THE ANIMATION PANEL (`workspace.utility`): the active document's stage transport, drawn by the
 * kit's own strip. A world document's stage attaches every clip its scene can show — a GLTF's
 * own `animations`, and the mixers the game's code made (`animation-mixers.service.ts`) — and
 * this is where a person scrubs and plays them in Edit, as Unity's Animation window does beside
 * its Scene view. While Play drives time the strip goes read-only and says why.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { TransportStrip } from '@volter/editor-sdk/kit/transport-strip';
import { Text } from '@volter/editor-sdk/widgets';
import { useCallback, useSyncExternalStore } from 'react';

export const point = 'workspace.utility';
export const title = 'Animation';

export default function AnimationTimeline() {
  const { documents, transport } = editorHost();
  const activeId = useSyncExternalStore(documents.subscribe, documents.activeId, documents.activeId);
  const handle = useSyncExternalStore(
    transport.subscribe,
    useCallback(() => (activeId ? transport.for(activeId) : null), [activeId, transport]),
  );
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => (handle ? handle.subscribe(listener) : () => {}), [handle]),
    useCallback(() => handle?.snapshot() ?? null, [handle]),
  );
  if (!handle || !snapshot || snapshot.activeSubject === null) {
    return (
      <Text
        as="p"
        variant="caption"
        data-testid="animation-timeline-empty"
        data-document={activeId ?? ''}
        data-transport={handle ? 'yes' : 'no'}
        style={{ padding: 'var(--vgai-space-2) var(--vgai-space-3)' }}
      >
        {handle
          ? 'Nothing in the active document plays an animation.'
          : 'The active document has no stage to animate.'}
      </Text>
    );
  }
  return <TransportStrip transport={handle} />;
}
