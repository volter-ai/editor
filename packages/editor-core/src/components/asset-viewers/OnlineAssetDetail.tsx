import { faCheck, faDownload, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { Button, EditorIcon, SectionHeader, Select, themeVars } from '@volter/editor-sdk/widgets';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { beginAssetImportJob, updateAssetImportJob } from '../../asset-workflow/asset-import-jobs';
import {
  AssetDeliveryError,
  type AssetFileOption,
  assetDeliveryIssueMessage,
  getOnlineAssetFiles,
  getOnlineAssetPreview,
  type OnlineAssetPreview,
} from '../../editor-api';
import type { OnlineAssetInfo } from '../../asset-selection';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import { downloadOnlineAssetWithHistory } from '../asset-editor-persistence';

const Object3DPreview = lazy(() =>
  import('./Object3DPreview').then((module) => ({ default: module.Object3DPreview })),
);

const selectStyle: React.CSSProperties = {
  width: '100%',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  online: OnlineAssetInfo;
  /** The Library Inspector and center Asset Editor reuse one acquisition
   * implementation while placing preview and properties in the outer shell. */
  mode?: 'full' | 'inspector' | 'preview';
  /** Selection-only Inspector details show one bounded live preview. Asset
   * document details leave preview ownership to the center document. */
  showPreview?: boolean;
  /** W2: called with the local serving path once the download lands — the
   *  owning asset DOCUMENT (`asset-documents.tsx`) swaps to the local viewer
   *  in place (was `store.resolveOnlineAssetTab` in the right-rail era). */
  onResolved?: (localPath: string) => void;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one catalog document coordinates preview resolution, metadata, format selection, and explicit project import.
export function OnlineAssetDetail({
  online,
  mode = 'full',
  showPreview = false,
  onResolved,
}: Props) {
  const [fileOptions, setFileOptions] = useState<AssetFileOption[]>([]);
  const [selectedFile, setSelectedFile] = useState<AssetFileOption | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OnlineAssetPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [thumbnailUnavailable, setThumbnailUnavailable] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>(
    'idle',
  );

  useEffect(() => {
    if (mode === 'preview') {
      setLoadingFiles(false);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    setFilesError(null);
    getOnlineAssetFiles(online.source, online.id)
      .then((files) => {
        if (cancelled) return;
        setFileOptions(files);
        if (files.length > 0) setSelectedFile(files[0]!);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFileOptions([]);
          setFilesError(
            error instanceof AssetDeliveryError
              ? assetDeliveryIssueMessage(error.code)
              : error instanceof Error
                ? error.message
                : 'Asset delivery metadata is unavailable while offline.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, online.source, online.id]);

  const supportsInteractivePreview =
    online.source === 'local' &&
    (online.type === 'model' || online.type === 'animation' || online.type === 'source');

  useEffect(() => {
    if (mode === 'inspector' && !showPreview) {
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setPreview(null);
    setPreviewUnavailable(false);
    setThumbnailUnavailable(false);
    if (!supportsInteractivePreview) {
      setLoadingPreview(false);
      return;
    }
    setLoadingPreview(true);
    getOnlineAssetPreview(online.source, online.id)
      .then((resolved) => {
        if (cancelled) return;
        setPreview(resolved);
        setPreviewUnavailable(!resolved);
      })
      .catch(() => {
        if (!cancelled) setPreviewUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, online.id, online.source, showPreview, supportsInteractivePreview]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one explicit acquisition transition owns job state, atomic history, document resolution, cancellation, and recovery.
  const onDownload = useCallback(async () => {
    if (!selectedFile) return;
    const jobId = `single:${online.source}:${online.id}`;
    const job = beginAssetImportJob(jobId, online.name);
    updateAssetImportJob(jobId, {
      stage: 'fetch',
      loaded: 0,
      total: selectedFile.sizeBytes ?? 0,
      status: 'running',
    });
    setDownloadStatus('downloading');
    try {
      const params: Parameters<typeof downloadOnlineAssetWithHistory>[0] = {
        source: online.source,
        id: online.id,
        name: online.name,
        url: selectedFile.url,
        format: selectedFile.format,
        jobId,
        signal: job.controller.signal,
      };
      if (selectedFile.includes) params.includes = selectedFile.includes;
      const result = await downloadOnlineAssetWithHistory(params);
      if (result.ok && result.path) {
        updateAssetImportJob(jobId, {
          stage: 'commit',
          loaded: selectedFile.sizeBytes ?? 1,
          total: selectedFile.sizeBytes ?? 1,
          status: result.alreadyExists ? 'skipped' : 'imported',
          message: result.path,
        });
        setDownloadStatus('done');
        // SAY WHERE IT WENT. "Add to Project" adds the FILE, and this document
        // then shows it — which a tester read as the asset being stranded in a
        // tab: they were trying to build a scene and could not see how to get
        // it there (runhuman pass 81: "they're all on different tabs, and I
        // don't see a way to add them directly to the game"). Name the panel
        // that now holds it and the gesture that places it.
        showTransientHint(
          `${online.name} added to Content — drag it from there into the viewport to place it.`,
        );
        // Switch this document to the local asset viewer
        onResolved?.(`/${result.path}`);
      } else {
        updateAssetImportJob(jobId, {
          status: 'failed',
          message: result.error ?? 'The import was rejected.',
        });
        setDownloadStatus('error');
      }
    } catch (error) {
      updateAssetImportJob(jobId, {
        status: job.controller.signal.aborted ? 'cancelled' : 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      setDownloadStatus('error');
    }
  }, [online, selectedFile, onResolved]);

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mode !== 'preview' && (
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: themeVars.content.primary,
            wordBreak: 'break-all',
          }}
        >
          {online.name}
        </div>
      )}

      {(mode !== 'inspector' || showPreview) && (
        <>
          <div
            style={{
              width: '100%',
              height: '100%',
              minHeight: mode === 'inspector' ? 160 : 240,
              background: themeVars.surface.shell,
              borderRadius: themeVars.shape.small,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {loadingPreview ? (
              <div style={{ color: themeVars.content.muted, fontSize: 11 }}>
                <EditorIcon icon={faSpinner} spin style={{ marginRight: 5 }} />
                Loading Asset Editor preview…
              </div>
            ) : preview ? (
              <Suspense
                fallback={<span style={{ color: themeVars.content.muted }}>Loading preview…</span>}
              >
                <Object3DPreview
                  assetPath={preview.path}
                  materialPath={preview.materialPath}
                  displayName={online.name}
                />
              </Suspense>
            ) : (
              <img
                src={
                  thumbnailUnavailable
                    ? '/__editor/asset-library/local-placeholder.svg'
                    : online.thumbnailUrl
                }
                alt={thumbnailUnavailable ? `${online.name} preview unavailable` : online.name}
                onError={() => setThumbnailUnavailable(true)}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            )}
          </div>
          {thumbnailUnavailable && (
            <div role="status" style={{ color: themeVars.content.dim, fontSize: 10 }}>
              The catalog preview could not be loaded; showing the typed fallback.
            </div>
          )}
          {previewUnavailable && (
            <div style={{ color: themeVars.content.dim, fontSize: 10 }}>
              Interactive preview is unavailable for this variant; showing its catalog thumbnail.
            </div>
          )}
        </>
      )}

      {mode !== 'preview' && (
        <>
          <SectionHeader label="Info">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: themeVars.content.dim,
                    marginBottom: 2,
                  }}
                >
                  Source
                </div>
                <div style={{ fontSize: 11, color: themeVars.content.primary }}>
                  {online.source === 'polyhaven'
                    ? 'Poly Haven'
                    : online.source === 'ambientcg'
                      ? 'ambientCG'
                      : 'Full Catalog'}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: themeVars.content.dim,
                    marginBottom: 2,
                  }}
                >
                  Type
                </div>
                <div style={{ fontSize: 11, color: themeVars.content.primary }}>{online.type}</div>
              </div>
              {online.tags.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: themeVars.content.dim,
                      marginBottom: 2,
                    }}
                  >
                    Tags
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {online.tags.slice(0, 12).map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          background: themeVars.surface.raised,
                          borderRadius: themeVars.shape.small,
                          color: themeVars.content.muted,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {online.author && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: themeVars.content.dim,
                      marginBottom: 2,
                    }}
                  >
                    Author
                  </div>
                  <div style={{ fontSize: 11, color: themeVars.content.primary }}>
                    {online.author}
                  </div>
                </div>
              )}
            </div>
          </SectionHeader>

          {/* Explicit project acquisition section */}
          <SectionHeader label="Add to Project">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingFiles ? (
                <div style={{ fontSize: 11, color: themeVars.content.dim }}>
                  <EditorIcon icon={faSpinner} spin style={{ marginRight: 4 }} />
                  Loading options...
                </div>
              ) : filesError ? (
                <div role="alert" style={{ fontSize: 11, color: themeVars.content.muted }}>
                  Delivery unavailable: {filesError}
                </div>
              ) : fileOptions.length > 0 ? (
                <>
                  <Select
                    aria-label="Asset delivery"
                    value={selectedFile ? fileOptions.indexOf(selectedFile) : 0}
                    onChange={(e) => setSelectedFile(fileOptions[Number(e.target.value)] ?? null)}
                    style={selectStyle}
                  >
                    {fileOptions.map((f, i) => (
                      <option key={i} value={i}>
                        {f.label}
                        {f.sizeBytes ? ` (${formatBytes(f.sizeBytes)})` : ''}
                      </option>
                    ))}
                  </Select>

                  <Button
                    type="button"
                    variant={downloadStatus === 'done' ? 'success' : 'primary'}
                    size="comfortable"
                    onClick={onDownload}
                    disabled={downloadStatus === 'downloading'}
                    style={{
                      width: '100%',
                    }}
                  >
                    <EditorIcon
                      icon={
                        downloadStatus === 'done'
                          ? faCheck
                          : downloadStatus === 'downloading'
                            ? faSpinner
                            : faDownload
                      }
                      spin={downloadStatus === 'downloading'}
                      style={{ fontSize: 10 }}
                    />
                    {downloadStatus === 'done'
                      ? 'Downloaded'
                      : downloadStatus === 'downloading'
                        ? 'Downloading...'
                        : downloadStatus === 'error'
                          ? 'Retry'
                          : 'Add to Project'}
                  </Button>
                </>
              ) : (
                <div role="status" style={{ fontSize: 11, color: themeVars.content.dim }}>
                  {online.source === 'local'
                    ? 'No healthy SSD or cloud delivery is available for this asset.'
                    : 'This provider has no compatible remote delivery for the selected asset.'}
                </div>
              )}
            </div>
          </SectionHeader>

          <div style={{ fontSize: 10, color: themeVars.content.dim, padding: '4px 0' }}>
            License: {online.license ?? 'CC0 (Public Domain)'}
          </div>
        </>
      )}
    </div>
  );
}
