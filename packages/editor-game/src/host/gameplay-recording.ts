/**
 * Live gameplay recording over the SAME clean game compositor used by
 * `vgai screenshot`: world canvases + DOM HUD, no editor chrome.
 *
 * This is intentionally a browser primitive, not a CLI workflow. The page
 * owns `MediaRecorder` and the live pixels/audio, streams bounded chunks to
 * the project server, and `@volter/editor-live` merely starts/stops it through the
 * existing session wire.
 *
 * KNOWN, MEASURED LIMIT — THE HUD LAYER IS INTERMITTENT, AND THIS FILE CANNOT
 * TELL YOU WHEN. Measured on a hidden tab at ~29 fps (third-person, 8412
 * frames): the world canvas is in every frame, and the DOM HUD is missing from
 * a substantial minority of them, sometimes partially (header bar but no
 * panels). The overlay IS built every frame — `drawPlayCompositeFrame` reports
 * a non-zero `domOverlays` on the frames whose pixels have no HUD — so the loss
 * is Chromium rasterizing the foreignObject blank, which nothing here can
 * observe without reading back pixels every frame. `capturePlayComposite`, the
 * STILL path, buys reliability with a compositor settle window of several
 * hundred milliseconds per frame; a real-time recorder cannot spend that.
 *
 * A counter for it was written, shipped and REMOVED in the same afternoon: it
 * keyed on `domOverlays === 0` and therefore reported a clean zero over clips
 * visibly missing their HUD. A measurement that can only ever say "fine" is
 * worse than none, so the limit is stated — here, and in the ack `vgai stop`
 * prints — rather than counted. Read the world layer as complete evidence and
 * the HUD as present-when-present.
 */

import type {
  ToolContributionRecordingFrame,
  ToolContributionRecordingSnapshot,
} from '@volter/editor-sdk/contributions';
import type { AudioRecordingHandle } from '@volter/editor-project/adapter';
import type {
  CaptureOptions,
  CompositeFrame,
  ImageSnapshotCache,
  OverlayFrameCache,
} from '@volter/editor-core/composite-screenshot';
import {
  createImageSnapshotCache,
  createOverlayFrameCache,
  drawPlayCompositeFrame,
  isRootCanvas,
} from '@volter/editor-core/composite-screenshot';
import {
  abortGameplayRecordingSink,
  appendGameplayRecordingChunk,
  beginGameplayRecordingSink,
  finishGameplayRecordingSink,
  type GameplayRecordingSink,
} from '@volter/editor-sdk/kit/editor-api';
import { type GameplayDomRecording, startGameplayDomRecording } from '@volter/editor-core/gameplay-dom-recording';
import { publishToolContributionRecording } from '@volter/editor-core/gameplay-sessions';
import { createRecordingPreviewEncoder } from './recording-preview';

export interface GameplayRecordingStartOptions {
  readonly fps?: number | undefined;
  /** Preserve one composite WebM, or capture the world canvas directly and
   * stream a synchronized DOM replay sidecar. */
  readonly format?: 'composite-webm' | 'canvas-dom' | undefined;
  readonly canvasFrame?: CaptureOptions['canvasFrame'];
  readonly audio?: AudioRecordingHandle | null | undefined;
  /**
   * The file this recording lands in, under the project's `.vgai/recordings/`.
   * During Play, absent is named after the Gameplay Session; outside one it
   * falls back to `play-latest.webm`. A name is the caller's own keepsake. The server owns the literals — see
   * `editor-server.ts`'s `/__editor/recording/start`.
   */
  readonly name?: string | null | undefined;
  /**
   * Called immediately before each composite draw, to make the pixels this
   * frame is about to read CURRENT.
   *
   * A hidden tab gets no rAF, so a game's own render loop is stopped and its
   * canvas holds whatever it last drew — the recorder would encode one frozen
   * frame for the whole run. The caller supplies the recovery it already owns
   * for the still-capture path (`handleBridgeScreenshot`'s
   * `runtime.runTicks(1, { render: 'last' })` when `loop.liveness` reports
   * `'loop-starved'`); this is the same seam on the video path. Throwing is
   * the caller's business — a throw here is counted as a frame error and the
   * stream keeps running on the preceding good frame.
   */
  readonly refreshFrame?: (() => void) | undefined;
}

export interface GameplayRecordingStarted {
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly startedAt: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly audio: boolean;
  readonly layers: CompositeFrame;
  /**
   * Where the bytes are landing, known AT START rather than at stop.
   *
   * That is the point of reporting it here: a caller that only learns the path
   * when the file is finished cannot tell anyone where the evidence for a run
   * still in progress will be, which is exactly the question asked while it is
   * running.
   */
  readonly path: string;
  readonly replayPath: string | null;
  /** True only for the out-of-session rotating fallback. */
  readonly rotates: boolean;
  /** The `logs/play-*.jsonl` this run is writing (`null` when nothing is). */
  readonly logFile: string | null;
}

export interface GameplayRecordingCapture extends GameplayRecordingStarted {
  readonly durationMs: number;
  /** Composite updates missed relative to the requested cadence. The encoded
   * stream may repeat the preceding frame during those intervals, which is
   * exactly the real-time pacing evidence a recorder must preserve. */
  readonly droppedFrames: number;
  readonly frameErrors: number;
  /**
   * The cadence this recording ACHIEVED — composited frames over its wall
   * duration — as distinct from `fps`, which is the cadence it asked for.
   *
   * Reported because the two genuinely diverge and the reader has to know by
   * how much: a browser is free to throttle a hidden tab's clock, and the
   * answer to that is to record anyway and say what was captured, never to
   * refuse. Read this before reasoning about a clip's timing.
   */
  readonly effectiveFps: number;
  /** True when the tab was hidden for any part of the recording — the case
   *  `effectiveFps` is worth reading for. */
  readonly hidden: boolean;
}

export interface GameplayRecordingTimeline {
  readonly startedAt: string;
  readonly elapsedMs: number;
}

interface ActiveRecording {
  readonly started: GameplayRecordingStarted;
  readonly recorder: MediaRecorder;
  readonly output: HTMLCanvasElement;
  /** Async compositing never clears the canvas MediaRecorder is sampling. */
  readonly staging: HTMLCanvasElement | null;
  readonly stream: MediaStream;
  readonly audio: AudioRecordingHandle | null;
  readonly sink: GameplayRecordingSink;
  readonly startedWallMs: number;
  readonly intervalMs: number;
  readonly container: HTMLElement;
  readonly options: Pick<GameplayRecordingStartOptions, 'canvasFrame' | 'refreshFrame'>;
  clock: FrameClock | null;
  frameTask: Promise<void> | null;
  drawing: boolean;
  /** Earliest time the next frame may draw — see the duty-cycle note in
   *  {@link paintFrame}. */
  nextFrameAt: number;
  /** Static-pixel reuse across this recording's frames — see
   *  {@link ImageSnapshotCache}. */
  readonly snapshots: ImageSnapshotCache;
  /** The DOM overlay raster, rebuilt on mutation instead of per frame — see
   *  {@link OverlayFrameCache}. Disposed (observer disconnected) on stop. */
  readonly overlayCache: OverlayFrameCache | null;
  readonly domRecording: GameplayDomRecording | null;
  /**
   * RESOURCE OWNERSHIP: this recording owns the thumbnail canvas, every Blob
   * URL in `previewFrames`, and their one teardown path. Contributions only
   * borrow those URLs; eviction and `stopGameplayRecording` revoke them.
   */
  readonly previewEncoder: ReturnType<typeof createRecordingPreviewEncoder>;
  readonly previewFrames: ToolContributionRecordingFrame[];
  previewSnapshot: ToolContributionRecordingSnapshot;
  previewTask: Promise<void> | null;
  previewEncoding: boolean;
  previewError: string | null;
  nextPreviewAt: number;
  nextPreviewSequence: number;
  frames: number;
  frameErrors: number;
  hidden: boolean;
  recorderError: Error | null;
  uploadError: Error | null;
  uploads: Promise<void>;
  nextSequence: number;
  stopping: boolean;
}

let active: ActiveRecording | null = null;

/** Page-lifetime observers; an ActiveRecording owns pixels, never listeners. */

const MIN_FPS = 1;
const MAX_FPS = 60;
const DEFAULT_FPS = 30;
const PREVIEW_SAMPLE_FPS = 2;
const PREVIEW_INTERVAL_MS = 1000 / PREVIEW_SAMPLE_FPS;
const PREVIEW_RETENTION_MS = 120_000;
const PREVIEW_MAX_FRAMES = (PREVIEW_RETENTION_MS / 1000) * PREVIEW_SAMPLE_FPS;
const PREVIEW_WIDTH = 256;
const PREVIEW_MIME_TYPE = 'image/webp';
const PREVIEW_QUALITY = 0.72;

interface FrameClock {
  stop(): void;
}

/**
 * The recorder's frame clock — a dedicated Worker's interval, with
 * `setInterval` as the fallback.
 *
 * `setInterval` on the page is the obvious pacer and it is the wrong one for
 * the case this recorder exists to serve. Chrome clamps a background tab's
 * timers to 1 Hz, and to roughly 1/min once the tab has been hidden for five
 * minutes — and an agent's `vgai edit` tab is hidden BY DESIGN (worktree
 * sessions open behind the human's window; see `after-paint.ts` for the same
 * fact stated for rAF). A 30 fps request would encode as a handful of frames.
 *
 * A worker's timer is not clamped on the same schedule, and worker MESSAGE
 * delivery is not throttled at all — the property `server/tab-heartbeat.ts`
 * already relies on to keep a hidden tab present. That file also states the
 * honest limit: Chrome "may throttle workers", so the cadence is NOT assumed
 * to hold. Nothing here asserts a rate; `effectiveFps` on the capture reports
 * what was actually achieved.
 *
 * The worker source is a Blob rather than a served script because this must
 * work on the hosted editor build too, which serves no `/__editor/*` file.
 * Every failure — no `Worker`, no `Blob`/`createObjectURL`, a CSP that
 * forbids `blob:` workers — falls back to the page timer, which still
 * records, at whatever cadence the browser grants.
 */
function startFrameClock(intervalMs: number, tick: () => void): FrameClock {
  const source =
    "'use strict';var t=null;onmessage=function(e){clearInterval(t);t=null;" +
    'if(e.data&&e.data.ms>0){t=setInterval(function(){postMessage(0)},e.data.ms)}};';
  try {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    // A worker that cannot start is not an error to report — the timer below
    // is the answer, and it is installed the moment the worker says so.
    let fallback: number | null = null;
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      if (fallback === null) fallback = window.setInterval(tick, intervalMs);
    });
    worker.addEventListener('message', () => tick());
    worker.postMessage({ ms: intervalMs });
    return {
      stop() {
        worker.postMessage({ ms: 0 });
        worker.terminate();
        if (fallback !== null) window.clearInterval(fallback);
      },
    };
  } catch {
    const timer = window.setInterval(tick, intervalMs);
    return {
      stop() {
        window.clearInterval(timer);
      },
    };
  }
}

function requestedFps(value: number | undefined): number {
  const fps = value ?? DEFAULT_FPS;
  if (!Number.isFinite(fps) || !Number.isInteger(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    throw new Error(`gameplay recording fps must be an integer from ${MIN_FPS} to ${MAX_FPS}`);
  }
  return fps;
}

function recordingMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const supported = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!supported) throw new Error('this browser exposes MediaRecorder but no WebM video codec');
  return supported;
}

function notifyPreviewListeners(): void {
  publishToolContributionRecording(active?.previewSnapshot ?? null);
}

function publishPreviewSnapshot(recording: ActiveRecording, liveEdgeMs: number): void {
  recording.previewSnapshot = {
    startedAt: recording.started.startedAt,
    width: recording.started.width,
    height: recording.started.height,
    liveEdgeMs,
    sampleFps: PREVIEW_SAMPLE_FPS,
    retentionMs: PREVIEW_RETENTION_MS,
    frames: [...recording.previewFrames],
    previewError: recording.previewError,
  };
  if (active === recording) notifyPreviewListeners();
}

function releasePreviewFrames(recording: ActiveRecording): void {
  for (const frame of recording.previewFrames) URL.revokeObjectURL(frame.src);
  recording.previewFrames.length = 0;
}

/**
 * Copy an already-composited video frame into the bounded live filmstrip.
 * Encoding is never queued: if the preceding thumbnail is still encoding,
 * this sample is skipped just like a recorder tick that cannot meet cadence.
 */
function samplePreviewFrame(recording: ActiveRecording, mediaTimeMs: number): void {
  if (
    recording.stopping ||
    recording.previewEncoding ||
    recording.previewError ||
    mediaTimeMs < recording.nextPreviewAt
  ) {
    return;
  }
  recording.nextPreviewAt = mediaTimeMs + PREVIEW_INTERVAL_MS;

  const scale = Math.min(1, PREVIEW_WIDTH / Math.max(1, recording.output.width));
  const width = Math.max(1, Math.round(recording.output.width * scale));
  const height = Math.max(1, Math.round(recording.output.height * scale));
  recording.previewEncoding = true;
  const capturedAt = new Date().toISOString();
  const sequence = recording.nextPreviewSequence;
  recording.nextPreviewSequence += 1;
  const task = recording.previewEncoder
    .encode(recording.output, width, height, PREVIEW_MIME_TYPE, PREVIEW_QUALITY)
    .then((blob) => {
      if (recording.stopping) return;
      if (!blob) {
        recording.previewError = 'The browser could not encode recording previews.';
        publishPreviewSnapshot(recording, mediaTimeMs);
        return;
      }
      const frame: ToolContributionRecordingFrame = {
        sequence,
        mediaTimeMs: Math.max(0, Math.round(mediaTimeMs)),
        capturedAt,
        src: URL.createObjectURL(blob),
        width,
        height,
      };
      recording.previewFrames.push(frame);
      while (
        recording.previewFrames.length > PREVIEW_MAX_FRAMES ||
        (recording.previewFrames[0]?.mediaTimeMs ?? frame.mediaTimeMs) <
          frame.mediaTimeMs - PREVIEW_RETENTION_MS
      ) {
        const evicted = recording.previewFrames.shift();
        if (evicted) URL.revokeObjectURL(evicted.src);
      }
      publishPreviewSnapshot(recording, frame.mediaTimeMs);
    })
    .catch((error) => {
      if (recording.stopping) return;
      recording.previewError =
        error instanceof Error ? error.message : 'The browser could not encode recording previews.';
      publishPreviewSnapshot(recording, mediaTimeMs);
    })
    .finally(() => {
      recording.previewEncoding = false;
    });
  recording.previewTask = task;
}

/**
 * A HIDDEN TAB RECORDS. There is deliberately no visibility gate here.
 *
 * The refusal this replaced ("show the editor tab, then start recording")
 * exempted exactly the sessions the recorder exists for: an agent's
 * `vgai edit` tab opens behind the human's window and stays hidden for the
 * whole run, so every unattended playthrough — the ones with no human to
 * describe what happened — would have produced no evidence at all. What a
 * hidden tab actually costs is two things, and both are handled rather than
 * refused: rAF stops, so the game's canvas goes stale (the caller's
 * `refreshFrame` drives one deterministic tick per frame), and the page's
 * timers are clamped (the frame clock is a worker, and `effectiveFps` reports
 * whatever cadence was really achieved).
 */
function assertCanStartRecording(): void {
  if (active)
    throw new Error('a gameplay recording is already active; stop it before starting one');
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('this browser does not support MediaRecorder gameplay capture');
  }
}

/**
 * One frame, driven by the clock tick.
 *
 * A tick that lands while the previous draw is still in flight is DROPPED
 * rather than queued: a queue would let a slow composite build an unbounded
 * backlog that then encodes as fast-forward. The dropped tick shows up in
 * `droppedFrames`, which is derived from the achieved count against the
 * requested cadence.
 */
function paintFrame(recording: ActiveRecording): void {
  if (recording.stopping || recording.drawing) return;
  if (performance.now() < recording.nextFrameAt) return;
  if (typeof document !== 'undefined' && document.hidden) recording.hidden = true;
  recording.drawing = true;
  recording.frameTask = (async () => {
    const drawStart = performance.now();
    try {
      // Make the pixels current BEFORE reading them. On a hidden tab this is
      // the whole difference between a real recording and one frozen frame.
      recording.options.refreshFrame?.();
      if (recording.started.format === 'composite-webm') {
        const staging = recording.staging;
        const overlayCache = recording.overlayCache;
        if (!staging || !overlayCache) {
          throw new Error('gameplay recording: composite buffers unavailable');
        }
        await drawPlayCompositeFrame(recording.container, staging, {
          canvasFrame: recording.options.canvasFrame,
          snapshots: recording.snapshots,
          overlayCache,
        });
        // Publish one complete frame synchronously. Awaiting canvas recovery or
        // HUD decoding on the captured canvas exposes blank/partial frames.
        const { output } = recording;
        const context = output.getContext('2d');
        if (!context) throw new Error('gameplay recording: output context unavailable');
        if (output.width !== staging.width) output.width = staging.width;
        if (output.height !== staging.height) output.height = staging.height;
        context.globalCompositeOperation = 'copy';
        context.drawImage(staging, 0, 0);
        context.globalCompositeOperation = 'source-over';
        samplePreviewFrame(recording, performance.now() - recording.startedWallMs);
      }
      // In canvas-dom mode MediaRecorder samples the game's canvas directly.
      // This tick only keeps a hidden-tab game rendering and measures cadence.
      recording.frames += 1;
    } catch {
      // Keep the real-time stream alive on the preceding good frame. The stop
      // result reports this count, so a visually incomplete recording is never
      // silently presented as clean evidence.
      recording.frameErrors += 1;
    } finally {
      recording.drawing = false;
      // THE RECORDER MAY NEVER OWN THE MAIN THREAD. Dropping ticks while a
      // draw is in flight bounds the QUEUE, not the utilization: a draw that
      // costs more than the interval makes the very next tick eligible, so an
      // expensive composite ran back-to-back and recording consumed ~90% of
      // the main thread (measured: the game's own frame at 0%, a trivial
      // relay reply queued 4.5s, every capture/stop 504). A draw that cost D
      // is therefore not eligible again until 2·D after it STARTED — an idle
      // gap of at least D, capping recording at half the main thread — while
      // a cheap draw keeps the requested cadence (the floor is HALF the
      // interval, not the interval: the clock's own ticks already pace the
      // cadence, and a full-interval floor raced their jitter and dropped
      // every other healthy tick). The shortfall is reported, not hidden
      // (`droppedFrames`/`effectiveFps` on the capture).
      const drawCost = performance.now() - drawStart;
      recording.nextFrameAt = drawStart + Math.max(recording.intervalMs / 2, 2 * drawCost);
    }
  })();
}

/** Start one recording. A second start refuses rather than replace evidence. */
export async function startGameplayRecording(
  container: HTMLElement,
  options: GameplayRecordingStartOptions = {},
): Promise<GameplayRecordingStarted> {
  assertCanStartRecording();

  const fps = requestedFps(options.fps);
  const format = options.format ?? 'composite-webm';
  const compositeOutput = container.ownerDocument.createElement('canvas');
  const audio = options.audio ?? null;
  let stream: MediaStream | null = null;
  let sink: GameplayRecordingSink | null = null;
  let domRecording: GameplayDomRecording | null = null;
  const snapshots = createImageSnapshotCache();
  const overlayCache = createOverlayFrameCache();
  try {
    // The hybrid still takes one composite at startup to validate the mounted
    // surface and report an honest layer inventory. It never enters this DOM
    // raster path again during the live clip.
    const layers = await drawPlayCompositeFrame(container, compositeOutput, {
      canvasFrame: options.canvasFrame,
      snapshots,
      overlayCache,
    });
    if (layers.canvases === 0 && layers.domOverlays === 0) {
      throw new Error('gameplay recording: no game layers are mounted');
    }
    const rootCanvases = Array.from(container.querySelectorAll('canvas')).filter(isRootCanvas);
    if (format === 'canvas-dom' && rootCanvases.length !== 1) {
      throw new Error(
        `canvas-dom recording requires exactly one root canvas; this game has ${rootCanvases.length}`,
      );
    }
    const output = format === 'canvas-dom' ? rootCanvases[0]! : compositeOutput;
    if (typeof output.captureStream !== 'function') {
      throw new Error('this browser cannot capture a canvas as a media stream');
    }
    stream = output.captureStream(fps);
    if (audio) {
      for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
    }
    const mimeType = recordingMimeType(stream.getAudioTracks().length > 0);
    const recorder = new MediaRecorder(stream, { mimeType });
    const startedAt = new Date().toISOString();
    sink = await beginGameplayRecordingSink({
      startedAt,
      mimeType,
      name: options.name ?? null,
      format,
    });
    if (format === 'canvas-dom') {
      domRecording = startGameplayDomRecording(container, output, sink);
      overlayCache.dispose();
    }
    const started: GameplayRecordingStarted = {
      format,
      startedAt,
      mimeType,
      width: output.width,
      height: output.height,
      fps,
      audio: stream.getAudioTracks().length > 0,
      layers,
      path: sink.path,
      replayPath: sink.replayPath,
      rotates: sink.rotates,
      logFile: sink.logFile,
    };
    const recording: ActiveRecording = {
      started,
      recorder,
      output,
      staging: format === 'composite-webm' ? container.ownerDocument.createElement('canvas') : null,
      stream,
      audio,
      sink,
      startedWallMs: performance.now(),
      intervalMs: 1000 / fps,
      container,
      options: {
        canvasFrame: options.canvasFrame,
        refreshFrame: options.refreshFrame,
      },
      clock: null,
      frameTask: null,
      drawing: false,
      nextFrameAt: 0,
      snapshots,
      overlayCache: format === 'composite-webm' ? overlayCache : null,
      domRecording,
      previewEncoder: createRecordingPreviewEncoder(),
      previewFrames: [],
      previewSnapshot: {
        startedAt,
        width: output.width,
        height: output.height,
        liveEdgeMs: 0,
        sampleFps: PREVIEW_SAMPLE_FPS,
        retentionMs: PREVIEW_RETENTION_MS,
        frames: [],
        previewError: null,
      },
      previewTask: null,
      previewEncoding: false,
      previewError: null,
      nextPreviewAt: 0,
      nextPreviewSequence: 0,
      frames: 1,
      frameErrors: 0,
      hidden: typeof document !== 'undefined' && document.hidden,
      recorderError: null,
      uploadError: null,
      uploads: Promise.resolve(),
      nextSequence: 0,
      stopping: false,
    };
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0 || recording.uploadError) return;
      const sequence = recording.nextSequence;
      recording.nextSequence += 1;
      recording.uploads = recording.uploads.then(async () => {
        if (recording.uploadError) return;
        try {
          await appendGameplayRecordingChunk(recording.sink, sequence, event.data);
        } catch (error) {
          recording.uploadError = error instanceof Error ? error : new Error(String(error));
        }
      });
    });
    recorder.addEventListener('error', (event) => {
      recording.recorderError =
        (event as ErrorEvent).error ?? new Error('gameplay recording failed');
    });
    recorder.addEventListener('start', () => {
      recording.domRecording?.markVideoStarted(Date.now());
    });
    recorder.start(1000);
    active = recording;
    notifyPreviewListeners();
    if (format === 'composite-webm') samplePreviewFrame(recording, 0);
    recording.clock = startFrameClock(recording.intervalMs, () => paintFrame(recording));
    return started;
  } catch (error) {
    await domRecording?.abort();
    overlayCache.dispose();
    if (sink) await abortGameplayRecordingSink(sink);
    for (const track of stream?.getTracks() ?? []) track.stop();
    audio?.dispose();
    throw error;
  }
}

/** Stop the active recorder and return its standard WebM bytes. `reason` is
 *  what ended it, journalled beside the finalized file. */
export async function stopGameplayRecording(
  reason?: string | null,
): Promise<GameplayRecordingCapture> {
  const recording = active;
  if (!recording) throw new Error('no gameplay recording is active');
  recording.stopping = true;
  recording.clock?.stop();
  recording.clock = null;
  await recording.frameTask;
  recording.previewEncoder.dispose();
  await recording.previewTask;

  let finalized = false;
  try {
    if (recording.recorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => {
        recording.recorder.addEventListener('stop', () => resolve(), { once: true });
      });
      recording.recorder.stop();
      await stopped;
    }
    if (recording.recorderError) throw recording.recorderError;
    await recording.uploads;
    if (recording.uploadError) throw recording.uploadError;
    const durationMs = Math.max(0, Math.round(performance.now() - recording.startedWallMs));
    const expectedFrames = Math.round((durationMs / 1000) * recording.started.fps);
    const capture: GameplayRecordingCapture = {
      ...recording.started,
      durationMs,
      droppedFrames: Math.max(0, expectedFrames - recording.frames),
      frameErrors: recording.frameErrors,
      effectiveFps:
        durationMs > 0 ? Math.round((recording.frames / (durationMs / 1000)) * 10) / 10 : 0,
      hidden: recording.hidden,
    };
    const videoFile = recording.sink.path.split(/[\\/]/).at(-1) ?? 'video.webm';
    const replay = await recording.domRecording?.stop(videoFile);
    await finishGameplayRecordingSink(
      recording.sink,
      reason ?? null,
      undefined,
      replay
        ? {
            ...replay,
            capture: {
              durationMs: capture.durationMs,
              droppedFrames: capture.droppedFrames,
              frameErrors: capture.frameErrors,
              effectiveFps: capture.effectiveFps,
              hidden: capture.hidden,
              fps: capture.fps,
              width: capture.width,
              height: capture.height,
              mimeType: capture.mimeType,
              audio: capture.audio,
            },
          }
        : null,
    );
    finalized = true;
    return capture;
  } finally {
    if (!finalized) {
      await recording.domRecording?.abort();
      await abortGameplayRecordingSink(recording.sink);
    }
    active = null;
    notifyPreviewListeners();
    releasePreviewFrames(recording);
    recording.overlayCache?.dispose();
    for (const track of recording.stream.getTracks()) track.stop();
    recording.audio?.dispose();
  }
}

export function gameplayRecordingActive(): boolean {
  return active !== null;
}

/** The live recording's start facts, or `null` when nothing is recording. */
export function activeGameplayRecording(): GameplayRecordingStarted | null {
  return active?.started ?? null;
}

export function recordingTimelineElapsedMs(startedWallMs: number, nowMs: number): number {
  return Math.max(0, Math.floor(nowMs - startedWallMs));
}

/** The live recorder's own monotonic timeline. Finalized `durationMs` is
 * calculated from the same `startedWallMs`; wall-clock timestamps deliberately
 * do not participate because sink setup separates the ISO start stamp from the
 * moment media capture begins. Flooring guarantees any observed position is
 * no later than the subsequently rounded finalized duration. */
export function activeGameplayRecordingTimeline(): GameplayRecordingTimeline | null {
  const recording = active;
  if (recording === null) return null;
  return {
    startedAt: recording.started.startedAt,
    elapsedMs: recordingTimelineElapsedMs(recording.startedWallMs, performance.now()),
  };
}
