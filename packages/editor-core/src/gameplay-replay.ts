/**
 * On-demand reconstruction of a canvas + DOM recording.
 *
 * rrweb is an intermediate representation here, not the delivery UI. A read
 * seeks the recorded canvas video and DOM timeline offscreen, puts that video
 * frame back into rrweb's canvas placeholder, then calls the ordinary game
 * compositor. The same primitive can feed a later batch video encoder without
 * making live gameplay pay the DOM rasterization cost.
 */

import {
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Input,
  Output,
  Quality,
  UrlSource,
  WEBM,
  WebMOutputFormat,
} from 'mediabunny';
import { EventType, type eventWithTime, Replayer } from 'rrweb';
import { BASE } from './api/base';
import {
  type CompositeCapture,
  capturePlayComposite,
  createImageSnapshotCache,
  drawPlayCompositeFrame,
} from './composite-screenshot';
import type { GameplayReplayMetadata, ReplayRect } from './gameplay-dom-recording';

interface ReplayManifest extends GameplayReplayMetadata {
  readonly status: 'complete';
  readonly format: 'canvas-dom';
  readonly capture: {
    readonly durationMs: number;
    readonly audio: boolean;
  };
}

export interface GameplayReplayCapture extends CompositeCapture {
  readonly replayPath: string;
  readonly positionMs: number;
  readonly width: number;
  readonly height: number;
}

interface CanvasLayout {
  readonly rect: ReplayRect;
  readonly drawingWidth: number;
  readonly drawingHeight: number;
}

function replayFileUrl(path: string, file: string): string {
  const query = new URLSearchParams({ replay: path, file });
  return `${BASE}/recording/replay-file?${query}`;
}

async function fetchedText(path: string, file: string): Promise<string> {
  const response = await fetch(replayFileUrl(path, file));
  if (!response.ok) throw new Error(`could not load replay ${file}: HTTP ${response.status}`);
  return response.text();
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read replay asset'));
    reader.readAsDataURL(blob);
  });
}

async function loadEvents(path: string): Promise<eventWithTime[]> {
  let text = await fetchedText(path, 'events.json');
  const names = new Set(
    text.match(/https:\/\/replay-assets\.invalid\/\d{6}\.(?:png|jpg|webp|gif|svg)/g) ?? [],
  );
  const replacements = await Promise.all(
    [...names].map(async (url) => {
      const name = url.split('/').at(-1)!;
      const response = await fetch(replayFileUrl(path, `assets/${name}`));
      if (!response.ok) throw new Error(`could not load replay asset ${name}`);
      return [url, await blobDataUrl(await response.blob())] as const;
    }),
  );
  for (const [url, dataUrl] of replacements) text = text.replaceAll(url, dataUrl);
  const events = JSON.parse(text) as unknown;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('replay contains no DOM events');
  }
  return events as eventWithTime[];
}

function domOffset(manifest: ReplayManifest, events: readonly eventWithTime[], videoMs: number) {
  return Math.max(0, manifest.videoStartEpochMs + videoMs - events[0]!.timestamp);
}

function layoutAt(
  manifest: ReplayManifest,
  events: readonly eventWithTime[],
  videoMs: number,
): CanvasLayout {
  const epochMs = manifest.videoStartEpochMs + videoMs;
  let layout: CanvasLayout = {
    rect: manifest.canvas,
    drawingWidth: manifest.canvas.drawingWidth,
    drawingHeight: manifest.canvas.drawingHeight,
  };
  for (const event of events) {
    if (event.timestamp > epochMs) break;
    if (
      event.type === EventType.Custom &&
      event.data.tag === 'vgai-canvas-layout' &&
      event.data.payload &&
      typeof event.data.payload === 'object' &&
      'rect' in event.data.payload &&
      'drawingWidth' in event.data.payload &&
      'drawingHeight' in event.data.payload
    ) {
      layout = event.data.payload as CanvasLayout;
    }
  }
  return layout;
}

async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('replay video failed to load'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('replay video load timed out'));
    }, 15_000);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onLoaded();
    else {
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    }
  });
  if (Math.abs(video.currentTime - seconds) < 0.001) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('replay video seek failed'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('replay video seek timed out'));
    }, 15_000);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = seconds;
  });
}

async function settleReplayDocument(document: Document): Promise<void> {
  if (document.fonts.size > 0 && document.fonts.status !== 'loaded') {
    await Promise.race([
      document.fonts.ready.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
}

/** Reconstruct and rasterize one moment without presenting a replay player. */
async function withGameplayReplay<T>(
  replayPath: string,
  visit: (reader: {
    manifest: ReplayManifest;
    render(positionMs: number): Promise<HTMLElement>;
  }) => Promise<T>,
): Promise<T> {
  const [manifestText, events] = await Promise.all([
    fetchedText(replayPath, 'manifest.json'),
    loadEvents(replayPath),
  ]);
  const manifest = JSON.parse(manifestText) as ReplayManifest;
  if (
    manifest.status !== 'complete' ||
    manifest.format !== 'canvas-dom' ||
    manifest.version !== 1 ||
    !manifest.capture ||
    typeof manifest.capture.durationMs !== 'number'
  ) {
    throw new Error('replay manifest is incomplete or unsupported');
  }
  const host = document.createElement('div');
  // Reconstructing an older capture during Play must not record the
  // reconstruction itself into the new capture's DOM event stream.
  host.setAttribute('data-vgai-replay-block', '');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${manifest.viewport.width}px`,
    height: `${manifest.viewport.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  const mount = document.createElement('div');
  host.append(mount);
  document.body.append(host);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = replayFileUrl(replayPath, 'video');
  host.append(video);

  let player: Replayer | undefined;
  try {
    player = new Replayer(events, {
      root: mount,
      showWarning: false,
      showDebug: false,
      mouseTail: false,
      UNSAFE_replayCanvas: true,
      insertStyleRules: ['[data-vgai-replay-video] { visibility: hidden !important; }'],
    });
    const replay = player;
    return await visit({
      manifest,
      async render(positionMs) {
        const bounded = Math.max(0, Math.min(positionMs, manifest.capture.durationMs));
        await seekVideo(video, bounded / 1000);
        replay.pause(domOffset(manifest, events, bounded));
        await settleReplayDocument(replay.iframe.contentDocument!);

        const canvasNode = replay.getMirror().getNode(manifest.canvas.nodeId);
        const surfaceNode = replay.getMirror().getNode(manifest.surfaceNodeId);
        if (!canvasNode || (canvasNode as Element).tagName !== 'CANVAS') {
          throw new Error('replay canvas placeholder is unavailable');
        }
        if (
          !surfaceNode ||
          typeof (surfaceNode as HTMLElement).getBoundingClientRect !== 'function'
        ) {
          throw new Error('replay game surface is unavailable');
        }
        const canvas = canvasNode as HTMLCanvasElement;
        const surface = surfaceNode as HTMLElement;
        canvas.setAttribute('data-vgai-root-surface', 'true');
        const layout = layoutAt(manifest, events, bounded);
        canvas.width = layout.drawingWidth;
        canvas.height = layout.drawingHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('replay canvas has no 2D context');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.style.setProperty('visibility', 'visible', 'important');

        return surface;
      },
    });
  } finally {
    video.pause();
    player?.destroy();
    video.removeAttribute('src');
    video.load();
    host.remove();
  }
}

/** One reconstructed screenshot; no player or live game mutation. */
export async function captureGameplayReplay(
  replayPath: string,
  positionMs: number,
): Promise<GameplayReplayCapture> {
  return withGameplayReplay(replayPath, async ({ manifest, render }) => {
    const bounded = Math.max(0, Math.min(positionMs, manifest.capture.durationMs));
    const surface = await render(bounded);
    const capture = await capturePlayComposite(surface);
    const rect = surface.getBoundingClientRect();
    return {
      ...capture,
      replayPath,
      positionMs: bounded,
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  });
}

export interface GameplayReplayExportOptions {
  replayPath: string;
  fps?: number;
  startMs?: number;
  endMs?: number;
  name?: string;
}

/** Encode recorded pixels and UI after capture. The live simulation is never stepped. */
export async function exportGameplayReplay(options: GameplayReplayExportOptions) {
  const fps = options.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60)
    throw new Error('replay export fps must be an integer from 1 to 60');
  return withGameplayReplay(options.replayPath, async ({ manifest, render }) => {
    const startMs = options.startMs ?? 0;
    const endMs = options.endMs ?? manifest.capture.durationMs;
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > manifest.capture.durationMs ||
      endMs - startMs > 300_000
    ) {
      throw new Error('replay export requires a valid recorded interval of at most five minutes');
    }
    const start = startMs / 1000;
    const end = endMs / 1000;
    const frames = Math.ceil((end - start) * fps);
    const surface = await render(startMs);
    const canvas = document.createElement('canvas');
    const rect = surface.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const size = { width: canvas.width, height: canvas.height };
    const target = new BufferTarget();
    const output = new Output({ target, format: new WebMOutputFormat() });
    const source = new CanvasSource(canvas, {
      codec: 'vp9',
      quality: new Quality({ bitrate: 3_000_000 }),
    });
    output.addVideoTrack(source, { frameRate: fps });
    const input = new Input({
      source: new UrlSource(replayFileUrl(options.replayPath, 'video')),
      formats: [WEBM],
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (manifest.capture.audio && !track) throw new Error('recorded audio track is missing');
      const audio = track
        ? new AudioSampleSource({ codec: 'opus', quality: new Quality({ bitrate: 128_000 }) })
        : null;
      if (audio) output.addAudioTrack(audio);
      await output.start();
      const encodeAudio = async () => {
        if (!audio || !track) return;
        for await (const sample of new AudioSampleSink(track).samples(start, end)) {
          try {
            const from = Math.max(0, Math.ceil((start - sample.timestamp) * sample.sampleRate));
            const to = Math.min(
              sample.numberOfFrames,
              Math.ceil((end - sample.timestamp) * sample.sampleRate),
            );
            if (to <= from) continue;
            const trimmed = sample.trim(from, to);
            try {
              trimmed.setTimestamp(Math.max(0, trimmed.timestamp - start));
              await audio.add(trimmed);
            } finally {
              trimmed.close();
            }
          } finally {
            sample.close();
          }
        }
        audio.close();
      };
      const encodeVideo = async () => {
        const snapshots = createImageSnapshotCache();
        for (let frame = 0; frame < frames; frame++) {
          const at = frame / fps;
          await drawPlayCompositeFrame(await render(startMs + at * 1000), canvas, {
            size,
            snapshots,
          });
          await source.add(at, Math.min(1 / fps, end - start - at), {
            keyFrame: frame % (fps * 2) === 0,
          });
        }
        source.close();
      };
      // The muxer applies cross-track backpressure. Feeding all audio before
      // starting video deadlocks once its interleave queue fills.
      await Promise.all([encodeAudio(), encodeVideo()]);
      await output.finalize();
      if (!target.buffer) throw new Error('replay encoder produced no output');
      return {
        blob: new Blob([target.buffer], { type: 'video/webm' }),
        frames,
        fps,
        durationMs: endMs - startMs,
        ...size,
        audio: track !== null,
      };
    } catch (error) {
      if (output.state !== 'finalized') await output.cancel();
      throw error;
    } finally {
      input.dispose();
    }
  });
}
