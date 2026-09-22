/**
 * The DOM half of `canvas-dom` gameplay recording.
 *
 * The moving world stays a native canvas MediaStream. rrweb records the much
 * cheaper DOM mutation stream around it, plus nested UI canvases such as a die.
 * Large data-URL images are interned once into the recording sidecar instead
 * of being repeated through the event log. Events and assets stream while the
 * run is live, rather than retaining the whole event timeline in the page.
 */

import { type eventWithTime, record } from 'rrweb';
import {
  appendGameplayRecordingAsset,
  appendGameplayRecordingDomEvents,
  type GameplayRecordingSink,
} from './editor-api';

const BLOCK_ATTRIBUTE = 'data-vgai-replay-block';
const VIDEO_ATTRIBUTE = 'data-vgai-replay-video';
const ASSET_PREFIX = 'https://replay-assets.invalid/';
const EVENT_FLUSH_MS = 1_000;
const EVENT_FLUSH_CHARS = 256 * 1024;
const DATA_IMAGE_PATTERN = /data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-zA-Z0-9+/=]+/g;

export interface ReplayRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface GameplayReplayMetadata {
  readonly version: 1;
  readonly recorder: 'rrweb@2.1.6';
  readonly events: 'events.json';
  readonly assets: 'assets/';
  readonly video: string;
  readonly videoStartEpochMs: number;
  readonly firstEventEpochMs: number | null;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly surface: ReplayRect;
  readonly surfaceNodeId: number;
  readonly canvas: ReplayRect & {
    readonly nodeId: number;
    readonly drawingWidth: number;
    readonly drawingHeight: number;
  };
  readonly eventCount: number;
  readonly assetCount: number;
  readonly assetBytes: number;
  readonly rrwebErrors: readonly string[];
}

export interface GameplayDomRecording {
  markVideoStarted(epochMs: number): void;
  stop(videoFile: string): Promise<GameplayReplayMetadata>;
  abort(): Promise<void>;
}

function rectOf(element: Element): ReplayRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function extensionFor(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    default:
      return null;
  }
}

function decodeImageDataUrl(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error('image data URL is not base64 encoded');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1]!.toLowerCase() });
}

/** Mark everything beside the game surface as blocked while rrweb takes its
 * document snapshot. Style/link/script elements stay visible to the recorder,
 * because they are what makes the reconstructed HUD look like the game. */
function blockOutside(container: HTMLElement): () => void {
  const marked: Element[] = [];
  for (
    let node: Element | null = container;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children) as Element[]) {
      if (
        sibling !== node &&
        !['STYLE', 'LINK', 'SCRIPT'].includes(sibling.tagName) &&
        !sibling.hasAttribute(BLOCK_ATTRIBUTE)
      ) {
        sibling.setAttribute(BLOCK_ATTRIBUTE, '');
        marked.push(sibling);
      }
    }
  }
  return () => {
    for (const element of marked) element.removeAttribute(BLOCK_ATTRIBUTE);
  };
}

/** Start the streamed DOM event log paired with a direct canvas WebM. */
export function startGameplayDomRecording(
  container: HTMLElement,
  videoCanvas: HTMLCanvasElement,
  sink: GameplayRecordingSink,
): GameplayDomRecording {
  if (sink.format !== 'canvas-dom' || sink.replayPath === null) {
    throw new Error('gameplay DOM recording requires a canvas-dom sink');
  }

  const releaseBlocks = blockOutside(container);
  const previousVideoMarker = videoCanvas.getAttribute(VIDEO_ATTRIBUTE);
  videoCanvas.setAttribute(VIDEO_ATTRIBUTE, '');
  const releaseMarkers = (): void => {
    releaseBlocks();
    if (previousVideoMarker === null) videoCanvas.removeAttribute(VIDEO_ATTRIBUTE);
    else videoCanvas.setAttribute(VIDEO_ATTRIBUTE, previousVideoMarker);
  };

  const eventStrings: string[] = [];
  const assetsByDataUrl = new Map<string, string>();
  const errors: string[] = [];
  let eventChars = 0;
  let eventCount = 0;
  let assetBytes = 0;
  let nextEventSequence = 0;
  let nextAssetSequence = 0;
  let firstEventEpochMs: number | null = null;
  let videoStartEpochMs = Date.now();
  let uploadError: Error | null = null;
  let uploads = Promise.resolve();
  let stopped = false;

  const enqueue = (label: string, task: () => Promise<void>): void => {
    uploads = uploads.then(async () => {
      if (uploadError) return;
      try {
        await task();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        uploadError = new Error(`${label}: ${message}`);
      }
    });
  };

  const internAsset = (dataUrl: string): string => {
    const existing = assetsByDataUrl.get(dataUrl);
    if (existing) return `${ASSET_PREFIX}${existing}`;
    const mimeType = /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? '';
    const extension = extensionFor(mimeType);
    if (!extension) return dataUrl;
    const name = `${String(nextAssetSequence).padStart(6, '0')}.${extension}`;
    nextAssetSequence += 1;
    assetsByDataUrl.set(dataUrl, name);
    enqueue(`replay asset ${name}`, async () => {
      // The workbench's CSP quite correctly omits `data:` from connect-src, so
      // fetching the URL is forbidden even though the bytes are already in
      // this document. Decode the base64 locally and upload only the Blob.
      const asset = decodeImageDataUrl(dataUrl);
      assetBytes += asset.size;
      await appendGameplayRecordingAsset(sink, name, asset);
    });
    return `${ASSET_PREFIX}${name}`;
  };

  const internAssets = (value: string): string =>
    value.includes('data:image/') ? value.replace(DATA_IMAGE_PATTERN, internAsset) : value;

  const flush = (): void => {
    if (eventStrings.length === 0) return;
    const body = new Blob([`[${eventStrings.join(',')}]`], { type: 'application/json' });
    eventStrings.length = 0;
    eventChars = 0;
    const sequence = nextEventSequence;
    nextEventSequence += 1;
    enqueue(`DOM event batch ${sequence}`, () =>
      appendGameplayRecordingDomEvents(sink, sequence, body),
    );
  };

  let stopRecorder: ReturnType<typeof record>;
  try {
    stopRecorder = record({
      emit(event: eventWithTime) {
        firstEventEpochMs ??= event.timestamp;
        const json = JSON.stringify(event, (_key, value: unknown) =>
          typeof value === 'string' ? internAssets(value) : value,
        );
        eventStrings.push(json);
        eventChars += json.length;
        eventCount += 1;
        if (eventChars >= EVENT_FLUSH_CHARS) flush();
      },
      blockSelector: `[${BLOCK_ATTRIBUTE}], [${VIDEO_ATTRIBUTE}]`,
      recordCanvas: true,
      inlineStylesheet: true,
      inlineImages: false,
      collectFonts: true,
      sampling: {
        mousemove: false,
        mouseInteraction: false,
        scroll: 100,
        canvas: 15,
      },
      errorHandler(error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return true;
      },
    });
  } catch (error) {
    releaseMarkers();
    throw error;
  }

  if (!stopRecorder) {
    releaseMarkers();
    throw new Error('rrweb could not start the DOM recording');
  }

  const ownerWindow = container.ownerDocument.defaultView ?? window;
  const initialViewport = {
    width: ownerWindow.innerWidth,
    height: ownerWindow.innerHeight,
    dpr: ownerWindow.devicePixelRatio,
  };
  const initialSurface = rectOf(container);
  const initialCanvas = rectOf(videoCanvas);
  const surfaceNodeId = record.mirror.getId(container);
  const canvasNodeId = record.mirror.getId(videoCanvas);
  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          record.addCustomEvent('vgai-canvas-layout', {
            rect: rectOf(videoCanvas),
            drawingWidth: videoCanvas.width,
            drawingHeight: videoCanvas.height,
            dpr: ownerWindow.devicePixelRatio,
          });
        });
  resizeObserver?.observe(videoCanvas);
  record.addCustomEvent('vgai-canvas-layout', {
    rect: initialCanvas,
    drawingWidth: videoCanvas.width,
    drawingHeight: videoCanvas.height,
    dpr: ownerWindow.devicePixelRatio,
  });

  const flushTimer = ownerWindow.setInterval(flush, EVENT_FLUSH_MS);
  const release = (): void => {
    ownerWindow.clearInterval(flushTimer);
    resizeObserver?.disconnect();
    releaseMarkers();
  };

  return {
    markVideoStarted(epochMs) {
      videoStartEpochMs = epochMs;
    },
    async stop(videoFile) {
      if (stopped) throw new Error('gameplay DOM recording is already stopped');
      stopped = true;
      record.addCustomEvent('vgai-recording-stop', {});
      stopRecorder();
      release();
      flush();
      await uploads;
      if (uploadError) throw uploadError;
      return {
        version: 1,
        recorder: 'rrweb@2.1.6',
        events: 'events.json',
        assets: 'assets/',
        video: videoFile,
        videoStartEpochMs,
        firstEventEpochMs,
        viewport: initialViewport,
        surface: initialSurface,
        surfaceNodeId,
        canvas: {
          ...initialCanvas,
          nodeId: canvasNodeId,
          drawingWidth: videoCanvas.width,
          drawingHeight: videoCanvas.height,
        },
        eventCount,
        assetCount: assetsByDataUrl.size,
        assetBytes,
        rrwebErrors: errors,
      };
    },
    async abort() {
      if (stopped) return;
      stopped = true;
      stopRecorder();
      release();
      eventStrings.length = 0;
      await uploads;
    },
  };
}
