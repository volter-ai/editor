import type { OfflineAudioRenderer } from '@volter/editor-project/adapter';
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny';
import type { CaptureOptions } from '@volter/editor-sdk/kit/composite-screenshot';
import { createImageSnapshotCache, drawPlayCompositeFrame } from '@volter/editor-sdk/kit/composite-screenshot';

/** RMS and peak over all channels and samples: evidence the track is sound, not an all-zero
 *  buffer. */
function pcmStats(channelData: readonly Float32Array[]): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;
  let count = 0;
  for (const data of channelData) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0;
      sumSquares += v * v;
      peak = Math.max(peak, Math.abs(v));
      count++;
    }
  }
  return { rms: count > 0 ? Math.sqrt(sumSquares / count) : 0, peak };
}

/**
 * Opus in the SAME WebM `Output` the video track already uses — the whole
 * audio decision of this module, written down because the alternative is what
 * goes wrong.
 *
 * The export's container is produced by mediabunny (`Output` +
 * `WebMOutputFormat` + `CanvasSource`). Audio therefore goes in as a second
 * TRACK on that same `Output`, via mediabunny's own `AudioBufferSource`.
 * There is no ffmpeg step, no second muxer, and no WAV file on the way: a
 * second container pipeline beside the first is how one export's timing,
 * metadata and codec support drift away from the other's.
 *
 * The `AudioBuffer` and the muxer are in the same JS heap, so the samples go
 * to the encoder as they are; encoding to 16-bit WAV on the way would quantize
 * them for no reason at all. {@link pcmStats} gives the non-silence evidence in
 * the result.
 *
 * Opus rather than a PCM track (Matroska can carry `A_PCM/INT/LIT`) because
 * WebM's normal audio codec is what every player and every `ffprobe` build
 * handles without argument, and because a PCM track would dominate the file
 * size of a five-minute clip. libopus is deterministic for identical input
 * and configuration, which is what the fixed-step promise below needs.
 */
const AUDIO_CODEC = 'opus' as const;
const AUDIO_BITRATE = 128_000;

export interface GameplayExportOptions {
  /** Number of output frames, including the current paused frame. */
  frames: number;
  /** Must divide the engine's 60 Hz stepping cadence. */
  fps?: number;
}

export function validateGameplayExport(options: GameplayExportOptions): number {
  const fps = options.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60 || 60 % fps !== 0) {
    throw new Error('Video export FPS must be a positive divisor of 60.');
  }
  if (!Number.isSafeInteger(options.frames) || options.frames < 1) {
    throw new Error('Video export frames must be a positive safe integer.');
  }
  if (options.frames / fps > 300)
    throw new Error('Video export is limited to five minutes per file.');
  return fps;
}

export async function assertGameplayVideoSupport(container: HTMLElement): Promise<void> {
  if (
    !(await canEncodeVideo('vp9', {
      width: container.clientWidth,
      height: container.clientHeight,
    }))
  ) {
    throw new Error('This browser cannot encode VP9 video at the game resolution.');
  }
}

/** What the exported file's audio track actually is, when there is one.
 *  `rms`/`peak` are measured over the raw float PCM before encoding, so a
 *  caller can tell "a real score" from "a muxed-in silent track" without
 *  decoding the WebM it just received. */
export interface GameplayExportAudio {
  readonly codec: typeof AUDIO_CODEC;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSeconds: number;
  readonly rms: number;
  readonly peak: number;
}

export interface GameplayExportResult {
  blob: Blob;
  frames: number;
  fps: number;
  durationMs: number;
  wallMs: number;
  width: number;
  height: number;
  /** `false` when the world supplied no offline audio renderer — the file is
   *  genuinely video-only. This is a RUNTIME value, never a literal: the type
   *  has to be able to say "there is a track" for the runs where there is
   *  one. */
  audio: GameplayExportAudio | false;
}

/** How the export gets sound: the world's own audio for the ABSOLUTE sim
 *  window the frame walk covers, rendered offline.
 *
 *  THE OFFSET TRAP, stated at the call site because it is the correctness
 *  argument of this whole path: an offline render of `[10, 10.72)` schedules its first event at
 *  LOCAL time 0, not absolute 10. `startSeconds` is where the paused run
 *  stands on its own canonical clock when frame 0 is captured; `render` is
 *  asked for `[startSeconds, startSeconds + frames / fps)` and must subtract
 *  `startSeconds` itself, because the buffer it returns is placed at
 *  timestamp 0 of the clip — the same instant frame 0 shows.
 *
 *  Real-time capture (`AudioAdapter.acquireRecordingStream`) is deliberately
 *  NOT an option here. A paused run being stepped emits no real-time audio,
 *  and a wall-clock tap would make two exports of the same window differ. */
export interface GameplayExportAudioSource {
  readonly startSeconds: number;
  readonly render: OfflineAudioRenderer;
}

/** Render the export window's audio and describe the track it will become.
 *  Split out of `exportGameplayVideo` so the frame walk stays readable; it
 *  runs before any mediabunny object exists. */
async function renderExportAudio(
  audio: GameplayExportAudioSource,
  durationSeconds: number,
  fps: number,
): Promise<{ buffer: AudioBuffer; track: GameplayExportAudio }> {
  const { buffer } = await audio.render(audio.startSeconds, audio.startSeconds + durationSeconds);
  // The muxed length is the BUFFER's, not the renderer's self-report, so that
  // is what gets checked against the video's. A track that drifts past one
  // frame is a broken export, not a tolerance to absorb.
  const bufferSeconds = buffer.length / buffer.sampleRate;
  if (Math.abs(bufferSeconds - durationSeconds) > 1 / fps) {
    throw new Error(
      `Offline audio render returned ${bufferSeconds.toFixed(4)}s for a ` +
        `${durationSeconds.toFixed(4)}s export window (tolerance one frame, ` +
        `${(1 / fps).toFixed(4)}s).`,
    );
  }
  if (
    !(await canEncodeAudio(AUDIO_CODEC, {
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    }))
  ) {
    throw new Error(
      `This browser cannot encode ${AUDIO_CODEC} at ${buffer.sampleRate} Hz, ` +
        `${buffer.numberOfChannels} channel(s).`,
    );
  }
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channelData.push(buffer.getChannelData(ch));
  const stats = pcmStats(channelData);
  return {
    buffer,
    track: {
      codec: AUDIO_CODEC,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      durationSeconds: bufferSeconds,
      rms: stats.rms,
      peak: stats.peak,
    },
  };
}

/** Browser-only export. The caller owns pause, stepping and saving the
 * returned file. Encoding backpressure changes wall time, never media time —
 * and that holds for the audio too, which is rendered from the SIM clock, not
 * captured from the speakers. */
export async function exportGameplayVideo(
  container: HTMLElement,
  options: GameplayExportOptions,
  control: {
    step(): void;
    assertActive(): void;
    canvasFrame?: CaptureOptions['canvasFrame'];
    signal?: AbortSignal;
    audio?: GameplayExportAudioSource;
  },
): Promise<GameplayExportResult> {
  const fps = validateGameplayExport(options);
  const started = performance.now();
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  if (canvas.width < 1 || canvas.height < 1)
    throw new Error('Game surface has no exportable size.');
  const width = canvas.width;
  const height = canvas.height;
  const durationSeconds = options.frames / fps;

  // Audio is rendered BEFORE the output exists: mediabunny takes every track
  // before `start()`, and the offline render needs no output at all. It also
  // must happen before the frame walk, because the walk advances the paused
  // run past `startSeconds`.
  const prepared = control.audio
    ? await renderExportAudio(control.audio, durationSeconds, fps)
    : null;
  control.signal?.throwIfAborted();
  control.assertActive();
  let audioSource: AudioBufferSource | null = null;

  const target = new BufferTarget();
  const output = new Output({ target, format: new WebMOutputFormat() });
  const source = new CanvasSource(canvas, {
    codec: 'vp9',
    quality: new Quality({ bitrate: 3_000_000 }),
  });
  output.addVideoTrack(source, { frameRate: fps });
  if (prepared) {
    // `startTimestamp` defaults to 0 and is left there deliberately: the
    // buffer is the sim window starting at the instant frame 0 shows, so
    // local 0 is exactly where it belongs (see GameplayExportAudioSource).
    audioSource = new AudioBufferSource({
      codec: AUDIO_CODEC,
      quality: new Quality({ bitrate: AUDIO_BITRATE }),
    });
    output.addAudioTrack(audioSource);
  }
  const snapshots = createImageSnapshotCache();
  let cancellation: Promise<void> | null = null;
  const abort = () => {
    cancellation ??= output.cancel();
  };
  control.signal?.addEventListener('abort', abort, { once: true });
  try {
    control.signal?.throwIfAborted();
    await output.start();
    if (audioSource && prepared) {
      // The whole window in one `add` — it is already fully rendered, and
      // audio is small beside VP9, so writing it first lets the muxer
      // interleave against a track it never has to wait on.
      await audioSource.add(prepared.buffer);
      audioSource.close();
      control.signal?.throwIfAborted();
    }
    for (let frame = 0; frame < options.frames; frame++) {
      control.signal?.throwIfAborted();
      control.assertActive();
      if (!container.isConnected) throw new Error('Game surface was removed during video export.');
      if (container.clientWidth !== width || container.clientHeight !== height) {
        throw new Error('Game surface resized during video export.');
      }
      if (frame > 0) for (let tick = 0; tick < 60 / fps; tick++) control.step();
      // No wall-time overlay cache: every exported frame needs its own current
      // HUD. The caller's step commits React before this snapshot is taken.
      await drawPlayCompositeFrame(container, canvas, {
        size: { width, height },
        snapshots,
        canvasFrame: control.canvasFrame,
      });
      control.signal?.throwIfAborted();
      control.assertActive();
      if (container.clientWidth !== width || container.clientHeight !== height) {
        throw new Error('Game surface resized during video export.');
      }
      await source.add(frame / fps, 1 / fps, { keyFrame: frame % (fps * 2) === 0 });
    }
    control.assertActive();
    control.signal?.throwIfAborted();
    await output.finalize();
    control.signal?.throwIfAborted();
    control.assertActive();
    if (!target.buffer) throw new Error('Video encoder produced no output.');
    return {
      blob: new Blob([target.buffer], { type: 'video/webm' }),
      frames: options.frames,
      fps,
      durationMs: (options.frames * 1000) / fps,
      wallMs: performance.now() - started,
      width,
      height,
      audio: prepared?.track ?? false,
    };
  } catch (error) {
    if (cancellation) await cancellation;
    else if (output.state !== 'finalized') await output.cancel();
    throw error;
  } finally {
    control.signal?.removeEventListener('abort', abort);
  }
}
