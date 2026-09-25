/** The Inspector image captured from an existing native authoring viewport. */

import { useEffect, useState } from 'react';

export function InspectorCanvasPreview({
  capture,
  previewKey,
  size,
}: {
  readonly capture: (size: number) => Promise<string | null>;
  readonly previewKey: string;
  readonly size: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    void capture(size).then(
      (next) => {
        if (!cancelled) setUrl(next);
      },
      () => {
        if (!cancelled) setUrl(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [capture, previewKey, size]);

  return url ? (
    <img src={url} alt="Selected object preview" className="vgai-component-thumbnail" />
  ) : null;
}
