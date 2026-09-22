/**
 * Video Asset Lab document: the clip itself, with the browser's own controls.
 *
 * Deliberately no custom transport, no autoplay and no muting — a reference
 * clip is watched, and `<video controls>` is already the control surface every
 * person on this machine knows. The bytes come from the session, which serves
 * the project's own files.
 */

import { Text, text } from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useState } from 'react';

export function VideoViewer({ assetPath }: { assetPath: string }) {
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const source = assetPath;
  useEffect(() => {
    setFailed(false);
  }, [source]);
  const name = assetPath.split('/').pop() ?? assetPath;
  const measure = useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    if (element.error) {
      setFailed(true);
      return;
    }
    if (element.videoWidth <= 0) return;
    setSize((current) =>
      current && current.w === element.videoWidth && current.h === element.videoHeight
        ? current
        : { w: element.videoWidth, h: element.videoHeight },
    );
  }, []);

  return (
    <div
      data-testid="video-asset-document"
      style={{
        height: '100%',
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
        <Text tone="dim" variant="label">
          {name}
        </Text>
        {size && (
          <Text tone="muted" variant="code">
            {size.w} × {size.h}
          </Text>
        )}
      </div>
      <div
        className="vgai-asset-transparency-well"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
        }}
      >
        {failed ? (
          <div style={{ color: text[2], fontSize: 12, textAlign: 'center' }}>
            {name} could not be played from {source}. The file may be missing, or its codec may not
            be one this browser decodes.
          </div>
        ) : (
          <video
            key={source}
            src={source}
            controls
            playsInline
            preload="metadata"
            // MEASURED, not just listened for: a clip whose metadata is already
            // decoded when React attaches (a cached file, a reopened document)
            // fires `loadedmetadata` BEFORE the listener exists, and the header
            // then reported no dimensions over a video the layout had already
            // sized from real ones. The ref reads the element's own state on
            // attach; the event covers everything that arrives later.
            //
            // `measure` is STABLE and its write is a no-change guard, both for
            // the same reason: an inline ref is a new function every render, so
            // React detaches and re-runs it every render, and a `setSize` that
            // writes a fresh object each time is then an infinite update loop.
            // Measured here — it took the editor's chrome down with
            // "Maximum update depth exceeded".
            ref={measure}
            onError={() => setFailed(true)}
            onLoadedMetadata={(event) => measure(event.currentTarget)}
            style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
          />
        )}
      </div>
    </div>
  );
}
