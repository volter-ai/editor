import { fontSizeVar, text } from '@volter/editor-sdk/widgets';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { useEffect, useRef, useState } from 'react';
import { listProjectSourceFiles, readProjectSourceText } from '@volter/editor-sdk/kit/api/project-source';
import {
  loadProjectThumbnailManifest,
  resetProjectThumbnailManifestCache,
  THUMBNAIL_MANIFEST_PATH,
  ThumbnailJobQueue,
} from '../asset-workflow/thumbnail-system';
import {
  DOCUMENT_PREVIEW_HEIGHT,
  DOCUMENT_PREVIEW_RECIPE,
  DOCUMENT_PREVIEW_WIDTH,
  type DocumentPreviewSource,
} from '@volter/editor-sdk/kit/document-preview-source';
import { projectFiles } from '@volter/editor-sdk/kit/files/project-files';
import { getCurrentProject } from '../project-manager';
import { getStorageBackend } from '@volter/editor-sdk/kit/storage/index';

interface CaptureJob {
  readonly run: () => Promise<string>;
  readonly consumers: Set<AbortSignal>;
}
const captureJobs = new Map<string, CaptureJob>();
const captureQueue = new ThumbnailJobQueue<string>(async (key) => {
  const job = captureJobs.get(key)!;
  await new Promise<void>((resume) => {
    if (typeof requestIdleCallback === 'function')
      requestIdleCallback(() => resume(), { timeout: 1000 });
    else setTimeout(resume, 0);
  });
  if ([...job.consumers].every((consumer) => consumer.aborted)) {
    throw new DOMException('Preview demand was cancelled.', 'AbortError');
  }
  return job.run();
}, 1);
let dependencyFingerprint: Promise<string> | null = null;
let dependencyProject: string | undefined;
let dependencyWatchDispose: (() => void) | null = null;
const dependencyListeners = new Set<() => void>();

async function listPublicDependencyFacts(path: string): Promise<string[]> {
  const backend = getStorageBackend();
  let entries: Awaited<ReturnType<typeof backend.list>>;
  try {
    entries = await backend.list(path);
  } catch {
    return [];
  }
  const facts: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'dir') facts.push(...(await listPublicDependencyFacts(entry.path)));
    else facts.push(`${entry.path}:${entry.size ?? 0}:${entry.mtime ?? 0}`);
  }
  return facts;
}

async function projectDependencyFingerprint(): Promise<string> {
  const project = getCurrentProject()?.rootPath;
  if (dependencyProject !== project) {
    dependencyProject = project;
    dependencyFingerprint = null;
  }
  dependencyFingerprint ??= Promise.all([
    listProjectSourceFiles([
      MANIFEST_FILENAME,
      'vgai.adapter.ts',
      '.storybook/**/*',
      'src/**/*.ts',
      'src/**/*.tsx',
      'src/**/*.js',
      'src/**/*.jsx',
      'src/**/*.mjs',
      'src/**/*.cjs',
      'src/**/*.json',
      'src/**/*.css',
    ]).then(async (paths) =>
      // The files as written: the dev server's transform of each one would build the
      // project's own page entry and fingerprint output, not source.
      Promise.all(paths.map(async (path) => `${path}:${(await readProjectSourceText(path)) ?? ''}`)),
    ),
    listPublicDependencyFacts(''),
  ]).then(([source, assets]) => digest([...source, ...assets].sort().join('\n')));
  return dependencyFingerprint;
}

function subscribeProjectDependencies(listener: () => void): () => void {
  dependencyListeners.add(listener);
  dependencyWatchDispose ??= projectFiles.watch((event) => {
    if (event.path === THUMBNAIL_MANIFEST_PATH) {
      resetProjectThumbnailManifestCache();
      for (const current of dependencyListeners) current();
      return;
    }
    if (
      !/^(src|public|\.storybook)\//.test(event.path) &&
      event.path !== MANIFEST_FILENAME &&
      event.path !== 'vgai.adapter.ts'
    )
      return;
    dependencyFingerprint = null;
    for (const current of dependencyListeners) current();
  });
  return () => {
    dependencyListeners.delete(listener);
    if (dependencyListeners.size === 0) {
      dependencyWatchDispose?.();
      dependencyWatchDispose = null;
      dependencyFingerprint = null;
    }
  };
}

async function serializedCapture(
  key: string,
  signal: AbortSignal,
  run: () => Promise<string>,
): Promise<string> {
  signal.throwIfAborted();
  let job = captureJobs.get(key);
  if (!job) {
    job = { run, consumers: new Set() };
    captureJobs.set(key, job);
  }
  job.consumers.add(signal);
  const request = captureQueue.request(key, 1);
  signal.addEventListener('abort', request.cancel, { once: true });
  try {
    return await request.promise;
  } finally {
    signal.removeEventListener('abort', request.cancel);
    job.consumers.delete(signal);
    if (job.consumers.size === 0 && captureJobs.get(key) === job) captureJobs.delete(key);
  }
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeDataUrl(value: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) throw new Error('Document preview owner returned an invalid image data URL.');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1]!, bytes };
}

function blobUrl(bytes: Uint8Array, mime = 'image/png'): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
}

async function previewCamera(documentId: string) {
  const read = await loadProjectThumbnailManifest();
  if (read.status !== 'ok') return undefined;
  const framing = read.manifest.entries[`document:${documentId}`]?.framing;
  return framing
    ? {
        position: { x: framing.position[0], y: framing.position[1], z: framing.position[2] },
        target: { x: framing.target[0], y: framing.target[1], z: framing.target[2] },
        ...(framing.fov === undefined ? {} : { fov: framing.fov }),
      }
    : undefined;
}

async function resolvePreview(
  documentId: string,
  source: DocumentPreviewSource,
  force: number,
  signal: AbortSignal,
): Promise<string> {
  const projectId = getCurrentProject()?.rootPath ?? 'no-project';
  const camera = await previewCamera(documentId);
  const identity = JSON.stringify({
    projectId,
    documentId,
    recipe: DOCUMENT_PREVIEW_RECIPE,
    revision: source.revision(),
    dependencies: await projectDependencyFingerprint(),
    camera,
  });
  signal.throwIfAborted();
  const key = await digest(identity);
  const path = `.vgai/cache/document-previews/${key}.png`;
  if (force === 0 && (await projectFiles.exists(path))) {
    return blobUrl(await projectFiles.readBytes(path));
  }
  const dataUrl = await serializedCapture(key, signal, () =>
    source.capture({
      width: DOCUMENT_PREVIEW_WIDTH,
      height: DOCUMENT_PREVIEW_HEIGHT,
      ...(camera ? { camera } : {}),
    }),
  );
  signal.throwIfAborted();
  const image = decodeDataUrl(dataUrl);
  await projectFiles.write(path, image.bytes);
  return blobUrl(image.bytes, image.mime);
}

export function DocumentThumbnail({
  documentId,
  source,
  previewRevision,
}: {
  readonly documentId: string;
  readonly source: DocumentPreviewSource;
  readonly previewRevision: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [visible, setVisible] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const demand = useRef<AbortController | null>(null);
  const liveUrl = useRef<string | null>(null);
  const lastRefresh = useRef({ previewRevision, retry });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      demand.current?.abort();
      setRefreshing(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSourceRevision((value) => value + 1), 750);
    };
    const unsubscribeSource = source.subscribe(invalidate);
    // Imported modules are part of the rendered document even when the entry
    // registry itself does not republish. The project watcher is the broad,
    // truthful invalidation signal for that dependency graph.
    const unsubscribeFiles = subscribeProjectDependencies(invalidate);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeSource();
      unsubscribeFiles();
    };
  }, [source]);

  useEffect(
    () => () => {
      if (liveUrl.current?.startsWith('blob:')) URL.revokeObjectURL(liveUrl.current);
    },
    [],
  );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    demand.current = controller;
    const force =
      lastRefresh.current.previewRevision !== previewRevision || lastRefresh.current.retry !== retry
        ? 1
        : 0;
    setError(null);
    setRefreshing(true);
    void resolvePreview(documentId, source, force, controller.signal)
      .then((resolved) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(resolved);
          return;
        }
        if (liveUrl.current) URL.revokeObjectURL(liveUrl.current);
        lastRefresh.current = { previewRevision, retry };
        liveUrl.current = resolved;
        setUrl(resolved);
        setRefreshing(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setRefreshing(false);
      });
    return () => controller.abort();
  }, [documentId, previewRevision, retry, source, sourceRevision, visible]);

  return (
    <div
      ref={host}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {url && (
        <img
          src={url}
          alt={`${documentId} preview`}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {error ? (
        <button
          type="button"
          title={error}
          onClick={(event) => {
            event.stopPropagation();
            setRetry((value) => value + 1);
          }}
          style={{
            position: 'absolute',
            bottom: 0,
            border: 0,
            background: 'var(--vscode-editor-background)',
            color: text[3],
            pointerEvents: 'auto',
          }}
        >
          Preview unavailable · Retry
        </button>
      ) : refreshing ? (
        <span
          role="status"
          style={{
            position: 'absolute',
            bottom: 0,
            background: 'var(--vscode-editor-background)',
            color: text[3],
            fontSize: fontSizeVar.xs,
          }}
        >
          {url ? 'Refreshing preview…' : 'Loading preview…'}
        </span>
      ) : null}
    </div>
  );
}
