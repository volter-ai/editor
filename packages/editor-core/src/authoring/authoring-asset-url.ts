import type { AuthoringAssetSubject } from '@volter/editor-project/adapter';

const SVG_XMLNS = 'http://www.w3.org/2000/svg';

/**
 * HTML gives an embedded `<svg>` its namespace implicitly, so `outerHTML`
 * commonly omits `xmlns`. An `<img>` data URL is a standalone XML document
 * and needs the namespace spelled out. Preserve an adapter that already
 * supplied one and otherwise add it to the root SVG start tag.
 */
export function standaloneSvgMarkup(markup: string): string {
  const root = /<svg\b/i.exec(markup);
  if (!root) return markup;
  const tagEnd = markup.indexOf('>', root.index);
  if (tagEnd < 0) return markup;
  const startTag = markup.slice(root.index, tagEnd + 1);
  if (/\sxmlns\s*=/.test(startTag)) return markup;
  const insertAt = root.index + root[0].length;
  return `${markup.slice(0, insertAt)} xmlns="${SVG_XMLNS}"${markup.slice(insertAt)}`;
}

/** A browser-safe URL for an adapter-owned in-memory image asset. */
export function authoringAssetDataUrl(subject: AuthoringAssetSubject): string {
  const text =
    subject.mediaType === 'image/svg+xml' ? standaloneSvgMarkup(subject.text) : subject.text;
  return `data:${subject.mediaType};charset=utf-8,${encodeURIComponent(text)}`;
}
