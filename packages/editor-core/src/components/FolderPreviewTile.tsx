/**
 * Composite folder thumbnail for the asset-browser grid. Resolves the
 * folder's representative contents through the memoized `getFolderPreview`
 * scan and composites up to four cells inside the standard tile preview box:
 * 1 → full bleed, 2 → side-by-side halves, 3 → hero left + two stacked right,
 * 4 → 2×2 grid. Cells reuse the exact asset-tile pipelines — `<img>` for
 * images, manifest-then-queued offscreen render for models (at LOWER queue
 * priority than direct asset tiles, so folder cells never delay them), and
 * the synthetic glyphs for the remaining kinds. The flat folder icon shows
 * until the summary resolves (then the composite fades in, no layout shift);
 * an empty folder renders a distinct dimmed open-folder state.
 *
 * The whole composite is decorative (`aria-hidden`): the folder card itself
 * is the `role="option"` whose accessible name is the folder name, and any
 * label inside the preview would concatenate into that name — breaking
 * exact-name selectors and double-announcing to screen readers.
 */

import { faFolder, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { EditorIcon } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  type FolderPreviewItem,
  type FolderPreviewSummary,
  getFolderPreview,
} from '../asset-workflow/folder-preview';
import { type AssetRootId, assetRootServingUrl } from '@volter/editor-sdk/kit/project-asset-roots';
import {
  AssetIcon,
  FOLDER_CELL_THUMBNAIL_PRIORITY,
  TypedAssetThumbnail,
  useModelThumbnailSource,
} from './asset-thumbnails';

/** Root-relative preview item path → the URL its root serves it at. */
function folderItemUrl(root: AssetRootId, item: FolderPreviewItem): string {
  return assetRootServingUrl(root, item.path);
}

function FolderPreviewImageCell({ root, item }: { root: AssetRootId; item: FolderPreviewItem }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <AssetIcon kind="image" size={14} />;
  return (
    <img
      src={folderItemUrl(root, item)}
      alt={item.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function FolderPreviewModelCell({ root, item }: { root: AssetRootId; item: FolderPreviewItem }) {
  const thumbnail = useModelThumbnailSource(
    folderItemUrl(root, item),
    FOLDER_CELL_THUMBNAIL_PRIORITY,
  );
  if (thumbnail.failed) return <AssetIcon kind="model" size={14} />;
  // Quiet while resolving: the inset cell background reads as pending —
  // folder cells never show per-cell spinners.
  if (!thumbnail.src) return null;
  return (
    <img
      src={thumbnail.src}
      alt={item.name}
      data-fit="contain"
      onError={thumbnail.fromManifest ? thumbnail.rejectManifest : undefined}
    />
  );
}

function FolderPreviewCell({ root, item }: { root: AssetRootId; item: FolderPreviewItem }) {
  if (assetCapabilities(item.name).editor === 'environment') {
    return <TypedAssetThumbnail kind="image" name={item.name} variant="cell" />;
  }
  if (item.kind === 'image') return <FolderPreviewImageCell root={root} item={item} />;
  if (item.kind === 'model') return <FolderPreviewModelCell root={root} item={item} />;
  return <TypedAssetThumbnail kind={item.kind} name={item.name} variant="cell" />;
}

export interface FolderPreviewTileProps {
  /** Which asset root this folder lives in — passed through to
   *  `getFolderPreview` AND used to build each cell's serving URL. */
  root: AssetRootId;
  /** Folder path relative to the asset root. */
  folderPath: string;
  /** Bump after `invalidateFolderPreviews` to re-resolve without remounting. */
  revision: number;
}

export function FolderPreviewTile({ root, folderPath, revision }: FolderPreviewTileProps) {
  const [summary, setSummary] = useState<FolderPreviewSummary | 'failed' | null>(null);

  useEffect(() => {
    setSummary(null);
  }, [root, folderPath]);

  useEffect(() => {
    let cancelled = false;
    getFolderPreview(root, folderPath).then(
      (result) => {
        if (!cancelled) setSummary(result);
      },
      () => {
        if (!cancelled) setSummary('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [root, folderPath, revision]);

  // Loading (and scan failure): the classic flat folder icon, no spinner —
  // the composite swaps in with a fade once the summary resolves.
  if (summary === null || summary === 'failed') return <AssetIcon kind="folder" />;

  if (summary.totalAssets === 0) {
    return (
      <div className="vgai-folder-preview" data-testid="folder-preview-empty" aria-hidden="true">
        <div className="vgai-folder-preview__empty">
          <EditorIcon icon={faFolderOpen} className="vgai-folder-preview__empty-glyph" />
          <span className="vgai-folder-preview__empty-caption">Empty</span>
        </div>
      </div>
    );
  }

  const count = summary.scannedAll ? `${summary.totalAssets}` : `${summary.totalAssets}+`;

  // Assets exist but none are previewable — keep the flat folder identity,
  // still faded in and counted so the tile reflects the resolved summary.
  if (summary.items.length === 0) {
    return (
      <div className="vgai-folder-preview" data-testid="folder-preview-plain" aria-hidden="true">
        <div className="vgai-folder-preview__fallback">
          <AssetIcon kind="folder" />
        </div>
        <span className="vgai-folder-preview__count">{count}</span>
      </div>
    );
  }

  return (
    <div className="vgai-folder-preview" data-testid="folder-preview" aria-hidden="true">
      <div className="vgai-folder-preview__grid" data-count={summary.items.length}>
        {summary.items.map((item) => (
          <div key={item.path} className="vgai-folder-preview__cell">
            <FolderPreviewCell root={root} item={item} />
          </div>
        ))}
      </div>
      <span className="vgai-folder-preview__chip">
        <EditorIcon icon={faFolder} />
      </span>
      <span className="vgai-folder-preview__count">{count}</span>
    </div>
  );
}
