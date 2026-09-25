import { text } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';
import { listAssets } from '@volter/editor-sdk/kit/api/assets';
import { projectPathForAssetUrl } from '@volter/editor-sdk/kit/project-asset-roots';

type MediaKind = 'image' | 'video' | 'audio';
type MediaFacts = { width?: number; height?: number; duration?: number };

/** File properties shared by Content selection and the open media document. */
export function MediaProperties({
  assetPath,
  kind,
  sizeBytes,
}: {
  assetPath: string;
  kind: MediaKind;
  sizeBytes?: number | undefined;
}) {
  // The key also resets failed/loaded state when another file is selected.
  return (
    <MediaFileProperties key={assetPath} assetPath={assetPath} kind={kind} sizeBytes={sizeBytes} />
  );
}

function MediaFileProperties({
  assetPath,
  kind,
  sizeBytes,
}: {
  assetPath: string;
  kind: MediaKind;
  sizeBytes?: number | undefined;
}) {
  const path = assetPath.split('#')[0]!;
  const source = path.startsWith('/') || /^(?:data|blob|https?):/.test(path) ? path : `/${path}`;
  const projectPath = projectPathForAssetUrl(path);
  const [size, setSize] = useState(sizeBytes);
  const [facts, setFacts] = useState<MediaFacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sizeBytes !== undefined) {
      setSize(sizeBytes);
      return;
    }
    let cancelled = false;
    const [root, ...segments] = projectPath.split('/');
    const name = segments.pop();
    void listAssets(root!, segments.join('/')).then((result) => {
      if (!cancelled && result.ok)
        setSize(result.entries.find((entry) => entry.name === name)?.size);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, sizeBytes]);

  useEffect(() => {
    setFacts(null);
    setError(null);
    if (kind === 'image') {
      const image = new Image();
      image.onload = () => setFacts({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => setError('Image properties could not be read.');
      image.src = source;
      return () => {
        image.onload = null;
        image.onerror = null;
      };
    }
    const media = document.createElement(kind);
    media.preload = 'metadata';
    media.onloadedmetadata = () =>
      setFacts({
        ...(Number.isFinite(media.duration) ? { duration: media.duration } : {}),
        ...(media instanceof HTMLVideoElement
          ? { width: media.videoWidth, height: media.videoHeight }
          : {}),
      });
    media.onerror = () =>
      setError('Media properties could not be read. The file may be missing or unsupported.');
    media.src = source;
    return () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    };
  }, [source, kind]);

  const width = facts?.width;
  const height = facts?.height;
  const rows: Array<[string, string]> = [];
  if (width && height) {
    let a = width;
    let b = height;
    while (b) [a, b] = [b, a % b];
    rows.push(
      ['Dimensions', `${width} × ${height} px`],
      ['Aspect ratio', `${width / a}:${height / a}`],
    );
  }
  if (facts?.duration !== undefined)
    rows.push(['Duration', `${Number(facts.duration.toFixed(3))} s`]);
  const extension = path.split('?')[0]!.match(/\.([^./]+)$/)?.[1];
  if (extension) rows.push(['Format', extension.toUpperCase()]);
  if (size !== undefined)
    rows.push([
      'File size',
      size < 1024
        ? `${size} B`
        : `${(size / (size < 1024 * 1024 ? 1024 : 1024 * 1024)).toFixed(1)} ${size < 1024 * 1024 ? 'KB' : 'MB'}`,
    ]);
  rows.push(['Location', projectPath]);
  return (
    <div data-testid="media-properties" style={{ padding: 8, fontSize: 12 }}>
      {error ? (
        <p role="status" style={{ color: text[2] }}>
          {error}
        </p>
      ) : (
        !facts && (
          <p role="status" style={{ color: text[3] }}>
            Reading media properties…
          </p>
        )
      )}
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          gap: '10px 12px',
        }}
      >
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt style={{ color: text[3] }}>{label}</dt>
            <dd style={{ margin: 0, color: text[1], overflowWrap: 'anywhere' }}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
