import { SectionHeader, themeVars } from '@volter/editor-sdk/widgets';
import { resolveUrl } from '@volter/editor-threejs/loader';
import { useEffect, useState } from 'react';
import { CodeView, type CodeViewLanguage } from '../CodeView';

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: themeVars.content.muted,
  marginBottom: 2,
};

export function GenericJsonViewer({ assetPath }: { assetPath: string }) {
  const [content, setContent] = useState<string | null>(null);
  // A file that failed to parse is shown verbatim, so it is shown as plain
  // text too — JSON highlighting over non-JSON would be a lie about the bytes.
  const [language, setLanguage] = useState<CodeViewLanguage>('json');
  const [error, setError] = useState(false);
  const fileName = assetPath.split('/').pop() ?? assetPath;

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(false);
    fetch(resolveUrl(assetPath))
      .then((r) => r.text())
      .then((text) => {
        // Pretty-print if valid JSON
        try {
          const parsed = JSON.parse(text);
          if (!cancelled) {
            setLanguage('json');
            setContent(JSON.stringify(parsed, null, 2));
          }
        } catch {
          if (!cancelled) {
            setLanguage('text');
            setContent(text);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assetPath]);

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          fontWeight: 600,
          fontSize: 12,
          color: themeVars.content.primary,
          wordBreak: 'break-all',
        }}
      >
        {fileName}
      </div>
      <div
        // §2.31 P2 amendment: JSON text reads over a local frost layer.
        className="vgai-content-frost"
        style={{
          // §2.31: whole-body JSON well goes hairline-only — the panel
          // surface shows through.
          border: `1px solid ${themeVars.boundary.default}`,
          borderRadius: themeVars.shape.small,
          padding: 8,
          // CodeView owns the scroll so its line-number gutter stays pinned;
          // the well keeps the height budget it always had.
          overflow: 'hidden',
          maxHeight: 500,
        }}
      >
        {error ? (
          <span style={{ color: themeVars.semantic.danger, fontSize: 11 }}>
            Failed to load file
          </span>
        ) : content === null ? (
          <span style={{ color: themeVars.content.muted, fontSize: 11 }}>Loading...</span>
        ) : (
          <CodeView
            value={content}
            language={language}
            fontSize={10}
            maxHeight={484}
            ariaLabel={`Contents of ${fileName}`}
          />
        )}
      </div>
      <SectionHeader label="Info" defaultOpen={false}>
        <div>
          <div style={labelStyle}>Path</div>
          <div style={{ fontSize: 11, color: themeVars.content.primary, wordBreak: 'break-all' }}>
            {assetPath}
          </div>
        </div>
      </SectionHeader>
    </div>
  );
}
