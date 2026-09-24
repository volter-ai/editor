/**
 * `editor.recording` — real-time gameplay evidence through the existing live
 * editor session. The browser owns MediaRecorder and the game pixels/audio;
 * the project server streams the standard WebM to disk while this namespace
 * exposes the start/stop controls and optional final copy destination.
 *
 * Recording deliberately is not a CLI workflow of its own. Agents start and
 * stop it through the one general door (`volter-game-editor eval`) and use ordinary ffmpeg,
 * ffprobe, and filesystem tools to review or trim the result.
 */

import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import type {
  EditorClient,
  GameplayRecordingOptions,
  GameplayRecordingStarted,
  GameplayReplayCapture,
} from '@volter/editor-sdk';

export interface GameplayRecordingResult extends GameplayRecordingStarted {
  /** Absolute path to the standard WebM written on stop. */
  path: string;
  durationMs: number;
  droppedFrames: number;
  frameErrors: number;
}

function recordingPath(destination: string): string {
  if (destination.trim() === '') throw new Error('recording destination must not be empty');
  const withExtension = extname(destination) === '' ? `${destination}.webm` : destination;
  return isAbsolute(withExtension) ? withExtension : resolve(process.cwd(), withExtension);
}

export class LiveGameplayRecording {
  readonly #client: EditorClient;

  constructor(client: EditorClient) {
    this.#client = client;
  }

  /** Export the current paused run as fixed-step video; this advances game
   * state. The result's `audio` says whether a track was muxed (the world's
   * `AudioAdapter.renderOffline`, rendered over the same sim window) or is
   * `false` for a genuinely silent file.
   * Frames include the initial state. FPS must divide 60; maximum five minutes. */
  async export(options: { frames: number; fps?: number; name?: string }) {
    return this.#client.exportGameplayVideo(options);
  }

  /** Start a real-time recording owned by the page until stop().
   * `format: "canvas-dom"` captures the native canvas WebM plus rrweb DOM
   * events. The WebM alone omits the HUD; use captureReplay for composite stills.
   * The default remains a directly playable composite WebM. */
  async start(options: GameplayRecordingOptions = {}): Promise<GameplayRecordingStarted> {
    return this.#client.startGameplayRecording(options);
  }

  /** Reconstruct one full canvas + HUD frame without presenting a replay UI.
   * Accepts the original project recording’s replayPath or its basename.
   * Copies outside .vgai/recordings are archival, not served by this API. */
  async captureReplay(replayPath: string, positionMs: number): Promise<GameplayReplayCapture> {
    return this.#client.captureGameplayReplay(replayPath, positionMs);
  }

  /** Post-process a recorded interval, including its HUD and captured audio.
   * This reads the completed recording; it does not advance the live game. */
  async exportReplay(options: {
    replayPath: string;
    fps?: number;
    startMs?: number;
    endMs?: number;
    name?: string;
  }) {
    return this.#client.exportGameplayReplay(options);
  }

  /** Finalize the active recording, write it to disk, and return honest media
   * metadata without echoing the large base64 transport payload to stdout. */
  async stop(destination?: string): Promise<GameplayRecordingResult> {
    const capture = await this.#client.stopGameplayRecording();
    const path = destination === undefined ? capture.path : recordingPath(destination);
    let replayPath = capture.replayPath;
    if (path !== capture.path) {
      await mkdir(dirname(path), { recursive: true });
      await copyFile(capture.path, path);
      if (capture.replayPath !== null) {
        replayPath = `${path.slice(0, -extname(path).length)}.replay`;
        await rm(replayPath, { recursive: true, force: true });
        await cp(capture.replayPath, replayPath, { recursive: true });
        const manifestPath = resolve(replayPath, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<
          string,
          unknown
        >;
        await writeFile(
          manifestPath,
          `${JSON.stringify({ ...manifest, video: basename(path) }, null, 2)}\n`,
          'utf-8',
        );
      }
    }
    return {
      ...capture,
      // The caller's `destination` copy, when there was one — otherwise the
      // project path the recorder wrote. Spread first so this wins.
      path,
      replayPath,
    };
  }
}
