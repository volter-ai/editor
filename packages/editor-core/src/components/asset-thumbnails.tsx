/**
 * Shared asset-thumbnail visuals for browser-style surfaces: the flat kind
 * icon, the synthetic per-kind glyph thumbnails, and the live model-thumbnail
 * resolution pipeline (project manifest first, then the shared offscreen
 * render queue). Extracted verbatim from AssetBrowser so FolderPreviewTile can
 * composite the exact same visuals inside folder tiles without an import
 * cycle; behavior for direct asset tiles is unchanged.
 */

import {
  faBoxArchive,
  faCode,
  faCubes,
  faFile,
  faFileCode,
  faFileImage,
  faFilm,
  faFolder,
  faMusic,
  faPuzzlePiece,
} from '@fortawesome/free-solid-svg-icons';
import { border, EditorIcon } from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AssetCapabilityKind } from '../asset-workflow/asset-capabilities';
import {
  getAssetAudioPreview,
  loadAudioWaveformPeaks,
  subscribeAssetAudioPreview,
} from '../asset-workflow/audio-preview-player';
import { AUDIO_WAVEFORM_BARS } from '../asset-workflow/audio-waveform';
import {
  loadProjectThumbnailManifest,
  ThumbnailJobQueue,
} from '../asset-workflow/thumbnail-system';
import { getModelThumbnailRenderer, modelThumbnailFormat } from '../model-thumbnail';

/** Every kind a browser entry can carry: capability kinds plus directories. */
export type AssetGlyphKind = AssetCapabilityKind | 'component' | 'folder';

/**
 * Per-kind category colors. Defined in theme.css's `.vgai-editor-theme`
 * block; the `--vgai-` prefix keeps them under the design-system migration
 * guard's dangling-variable check, so a definition can no longer be deleted
 * without failing the unit gate (which is exactly how the earlier `--asset-*`
 * spelling silently became invisible glyphs).
 */
export const assetIconColors: Record<AssetGlyphKind, string> = {
  folder: 'var(--vgai-asset-icon-folder)',
  model: 'var(--vgai-asset-icon-model)',
  prefab: 'var(--vgai-asset-icon-prefab)',
  component: 'var(--vgai-asset-icon-component)',
  audio: 'var(--vgai-asset-icon-audio)',
  image: 'var(--vgai-asset-icon-image)',
  video: 'var(--vgai-asset-icon-video)',
  json: 'var(--vgai-asset-icon-json)',
  unknown: 'var(--vgai-asset-icon-unknown)',
  source: 'var(--vgai-asset-icon-source)',
};

export const assetIconMap: Record<AssetGlyphKind, typeof faFolder> = {
  folder: faFolder,
  model: faCubes,
  prefab: faPuzzlePiece,
  component: faCode,
  audio: faMusic,
  image: faFileImage,
  video: faFilm,
  json: faFileCode,
  unknown: faFile,
  source: faBoxArchive,
};

export function AssetIcon({ kind, size = 24 }: { kind: AssetGlyphKind; size?: number }) {
  return (
    <EditorIcon
      icon={assetIconMap[kind]}
      style={{ fontSize: size, color: assetIconColors[kind] }}
    />
  );
}

/** Queue priority for thumbnails a direct asset tile requests. */
export const ASSET_TILE_THUMBNAIL_PRIORITY = 100;
/** Folder composite cells queue below direct asset tiles — they must never delay them. */
export const FOLDER_CELL_THUMBNAIL_PRIORITY = 50;

/** Renders an offscreen 3D preview thumbnail for supported model assets. */
export const projectThumbnailQueue = new ThumbnailJobQueue<string>((url) => {
  const format = modelThumbnailFormat(url);
  if (!format) return Promise.reject(new Error(`No model preview loader for ${url}.`));
  return getModelThumbnailRenderer().render({
    url,
    format,
    background: 'neutral',
    output: 'webp',
  });
}, 2);

export interface ModelThumbnailSource {
  /** Manifest image path or rendered data URL; null while resolving. */
  src: string | null;
  /** True when `src` is a manifest path whose file may turn out missing. */
  fromManifest: boolean;
  failed: boolean;
  /** Discard a broken manifest path and fall back to a live render. */
  rejectManifest(): void;
}

/**
 * Resolve a model asset's thumbnail: `.vgai/thumbnails.json` manifest entry
 * first, otherwise a live offscreen render through the shared queue at the
 * given priority.
 */
export function useModelThumbnailSource(url: string, priority: number): ModelThumbnailSource {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [manifestPath, setManifestPath] = useState<string | null>(null);
  const [manifestRejected, setManifestRejected] = useState(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    setManifestPath(null);
    setManifestRejected(false);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    let queued: ReturnType<typeof projectThumbnailQueue.request> | null = null;
    void loadProjectThumbnailManifest()
      .then((read) => {
        if (cancelled) return;
        // A read-only consumer: `absent` and `unreadable` both mean "no
        // manifest entry to serve", and both fall through to a live render.
        const entry =
          read.status === 'ok' ? read.manifest.entries[url.replace(/^\/+/, '')] : undefined;
        if (
          !manifestRejected &&
          entry?.path &&
          (entry.state === 'generated' || entry.state === 'upstream')
        ) {
          setManifestPath(entry.path.startsWith('/') ? entry.path : `/${entry.path}`);
          return;
        }
        queued = projectThumbnailQueue.request(url, priority);
        return queued.promise;
      })
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      queued?.cancel();
    };
  }, [manifestRejected, priority, url]);

  const rejectManifest = useCallback(() => {
    setManifestPath(null);
    setManifestRejected(true);
  }, []);

  return { src: manifestPath ?? src, fromManifest: manifestPath !== null, failed, rejectManifest };
}

export function ModelThumbnail({ url }: { url: string }) {
  const thumbnail = useModelThumbnailSource(url, ASSET_TILE_THUMBNAIL_PRIORITY);

  if (thumbnail.failed) return <AssetIcon kind="model" />;
  if (thumbnail.fromManifest && thumbnail.src) {
    return (
      <img
        src={thumbnail.src}
        alt="cached model preview"
        onError={thumbnail.rejectManifest}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    );
  }
  if (!thumbnail.src) {
    // Loading spinner
    return (
      <div
        style={{
          width: 28,
          height: 28,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          className="vgai-anim-spin"
          style={{
            width: 16,
            height: 16,
            border: `2px solid ${border[2]}`,
            borderTopColor: assetIconColors.model,
            borderRadius: '50%',
          }}
        />
      </div>
    );
  }
  return (
    <img
      src={thumbnail.src}
      alt="model preview"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

export function AudioAssetThumb({ url, name }: { url: string; name: string }) {
  const [peaks, setPeaks] = useState<readonly number[]>(() =>
    Array.from({ length: AUDIO_WAVEFORM_BARS }, () => 0.15),
  );
  const preview = useSyncExternalStore(subscribeAssetAudioPreview, getAssetAudioPreview);
  useEffect(() => {
    let cancelled = false;
    void loadAudioWaveformPeaks(url).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const active = preview.url === url;
  const progress = active ? preview.progress : 0;
  return (
    <div
      role="img"
      aria-label={`${name} waveform preview`}
      style={{
        display: 'flex',
        // Midline, like a DAW clip — flex-end reads as a histogram piled at the top.
        alignItems: 'center',
        gap: 1,
        width: '86%',
        height: '62%',
      }}
    >
      {peaks.map((amplitude, index) => {
        const played = index / peaks.length <= progress;
        return (
          <i
            key={index}
            style={{
              flex: 1,
              height: `${12 + amplitude * 88}%`,
              background: 'var(--vgai-asset-icon-audio)',
              opacity: active && played ? 1 : 0.28,
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

export function TypedAssetThumbnail({
  kind,
  name,
  variant = 'tile',
}: {
  kind: AssetGlyphKind;
  name: string;
  /** 'cell' scales the glyph fluidly for folder-composite cells. */
  variant?: 'tile' | 'cell';
}) {
  const color = assetIconColors[kind];
  const cell = variant === 'cell';
  if (kind === 'audio') {
    return (
      <svg
        role="img"
        aria-label={`${name} waveform preview`}
        viewBox="0 0 64 48"
        width={cell ? '78%' : 52}
        height={cell ? '78%' : 44}
      >
        <rect width="64" height="48" rx="4" fill="var(--vgai-bg-inset)" />
        {Array.from({ length: 16 }, (_, index) => (
          <rect
            key={index}
            x={index * 4 + 1}
            y={24 - ((index * 13) % 18) / 2}
            width="2"
            height={((index * 13) % 18) + 3}
            fill={color}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg
      role="img"
      aria-label={`${name} ${kind} preview`}
      viewBox="0 0 52 48"
      width={cell ? '66%' : 48}
      height={cell ? '72%' : 44}
    >
      <rect x="5" y="3" width="42" height="42" rx="4" fill="var(--vgai-bg-inset)" stroke={color} />
      <path d="M13 15h26M13 23h18M13 31h22" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
