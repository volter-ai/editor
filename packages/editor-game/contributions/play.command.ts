/**
 * THE PLAY VERBS of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): `play`, `stop`, `pause`, `resume`,
 * `step`, and the paused run's `bridge-recording-export`.
 *
 * These left `command-listener.ts`'s switch when Play left the host (WORK.md
 * §The workbench, P3b). What did NOT leave is the host's dispatch PROLOGUE,
 * which still runs before any contributed handler is looked up and therefore
 * still owns the two gates that are not Play's: the ingest play-control latch
 * (a captured ingest answers `play`/`stop`/`pause`/`resume`/`step` itself —
 * P4's move) and the mount-failure refusal. The prologue also refuses every
 * OTHER command while a video export owns a paused run, reading
 * `gameplay-export-state.ts`, which stays host-visible for exactly that (the
 * PlayBar reads it too). The AbortController behind that flag is this file's:
 * `stop` falls THROUGH the prologue so the handler below can cancel the export
 * before tearing the run down.
 *
 * Host internals Play still holds are reached through the `@editor/*` alias
 * the editor's Vite serves to every contribution (precedent:
 * `instances.command.ts`); the doors a lane is meant to use are
 * `@volter/editor-sdk/host`.
 *
 * `play-recording.ts` is Play's own (`../src/play/`): its idle watchdog reads
 * every relayed command through `host.session.onCommandDispatched`, the door
 * P4b added, so the stamp is no longer a host call. `gameplay-recording.ts`
 * stays in the host — `components/GameplaySessionTimeline.tsx`, which
 * `ToolHost.tsx` mounts directly for the `workspace.analytics` point, imports
 * it, and no contribution point injects a panel's header component.
 */

import { getActiveSystems } from '@volter/editor-core/authoring/active-systems';
import { setGameplayExportActive } from '@volter/editor-core/gameplay-export-state';
import { stopGameplayRecording } from '../src/host/gameplay-recording';
import { liveInstanceContainer } from '@volter/editor-core/live-session-registry';
import type { CommandContribution } from '@volter/editor-sdk/commands';
import { editorHost } from '@volter/editor-sdk/host';
import type { OfflineAudioRenderer } from '@volter/editor-project/adapter';
import { flushSync } from 'react-dom';
import { notPlayingResult, structuredErrorResult } from '../src/command-results';
import {
  enterPlayMode,
  exitPlayMode,
  getPlayRuntimeAccess,
  pausePlayMode,
  resumePlayMode,
  stepPlayMode,
} from '../src/play/play-mode';
import { beginPlayRecording, endPlayRecording, notePlayActivity } from '../src/play/play-recording';

export const point = 'workspace.command';

/** Pixel recovery is a command-time concern. Keeping this indirection here
 * avoids loading the Pixi extraction stack merely because the control relay
 * is listening for a future screenshot/recording command. */
async function captureLiveCanvasFrame(
  canvas: HTMLCanvasElement,
): Promise<CanvasImageSource | null> {
  const { liveCanvasFrame } = await import('@volter/editor-core/live-canvas-frame');
  return liveCanvasFrame(canvas);
}

/** Both recording entry points keep a hidden native game's pixels current. */
function refreshRecordingFrame(): void {
  const runtime = getPlayRuntimeAccess();
  if (runtime?.loop.liveness === 'loop-starved') runtime.runTicks?.(1, { render: 'last' });
}

/**
 * The fixed-step export's audio, or `undefined` when this world has none.
 *
 * Two facts have to line up, and BOTH come from the live run, never from a
 * default. The world's `AudioAdapter` must implement `renderOffline` (the
 * offline, deterministic sibling of the recorder's real-time
 * `acquireRecordingStream` — a paused run being stepped makes no real-time
 * sound at all), and the run must be able to say WHERE IT STANDS on its own
 * canonical clock, because the render is asked for an ABSOLUTE sim window.
 * `time` is the engine's built-in debug state provider
 * (`engine/src/runtime/debug-registry.ts`), the same one the play log stamps
 * entries from.
 *
 * A world that cannot answer the clock question — an ingest root with no tick
 * runner — gets no audio rather than a fabricated `start: 0`, which would
 * silently render the wrong slice of the score against the right frames.
 */
function exportAudioSource(): { startSeconds: number; render: OfflineAudioRenderer } | undefined {
  const audio = getActiveSystems().audio;
  const render = audio?.renderOffline;
  if (!audio || !render) return undefined;
  let startSeconds: number | null = null;
  try {
    const time = getActiveSystems().debug?.state('time') as { simSeconds?: number } | undefined;
    if (typeof time?.simSeconds === 'number' && Number.isFinite(time.simSeconds)) {
      startSeconds = time.simSeconds;
    }
  } catch {
    startSeconds = null;
  }
  if (startSeconds === null) return undefined;
  return { startSeconds, render: render.bind(audio) };
}

/** The in-flight video export's cancel handle. Module state, like the flag it
 *  raises in `gameplay-export-state.ts`: one paused run, one export. */
let gameplayExportAbort: AbortController | null = null;

export const commands: CommandContribution['commands'] = {
  play: {
    // `play` boots the game, including its full async `setup()` (asset loads,
    // procedural worldgen); under the generic budget any substantial game
    // reported "did not respond" while play in fact succeeded.
    timeoutMs: 120_000,
    derivedRefresh: 'always',
    handle: async (cmd) => {
      // Fix for the ghost-runtime bug — deliberately no "already running"
      // guard here: `play` on an already-playing (or still-booting) session
      // is a RESTART, not a no-op, matching the SDK's own documented contract
      // (`play.start`'s summary: "Start (or restart) play mode" —
      // `packages/vgai-sdk/src/play/lifecycle-operations.ts`). What used to
      // make a restart unsafe was `enterPlayMode()` having no reentrancy
      // guard for the async-boot window before it assigns `_session` — two
      // overlapping calls ran their entire prologues concurrently and
      // corrupted shared module state (proven by a real console-patching
      // stack overflow — see `play-mode-reentry-ghost.test.ts`). That is
      // fixed at the source in `enterPlayMode()` itself (a FIFO queue
      // serializes every invocation), so every caller of THIS handler — CLI,
      // SDK, a UI Play-button click racing a relayed command — gets a safe,
      // clean restart for free without needing a guard here too.
      try {
        // D15/T-D15.6 (objection-4 fix) — `vgai play --seed <n>` relays as
        // `cmd['seed']`; `enterPlayMode`'s explicit-config seed leg (beats
        // manifest.determinism.defaultSeed/?vgai-seed=).
        const seed = cmd['seed'];
        // `vgai play --name <text>` rides the same wire as `--seed`: a plain
        // field on the relayed command, slugified server-side into this run's
        // log filename and journal line. Absent, everything is unchanged.
        const runName = cmd['name'];
        await enterPlayMode(
          typeof seed === 'number' ? seed : undefined,
          undefined,
          typeof runName === 'string' ? runName : null,
        );
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // PD-1 — never ack a play that did not start. `enterPlayMode()` resolving
      // does NOT mean play is running: it also resolves for every path that
      // abandoned this run (a Stop or a newer play landed during the async
      // boot, invalidating this generation). Those used to return `{ok:true}`,
      // and the CLI — seeing `playState: 'stopped'` a moment later — fell back
      // to "✗ Play mode failed — check logs/play-*.jsonl", a message naming no
      // cause and pointing at a log that says nothing about it. Ack the
      // measured truth (the live registry, the same predicate `collectState`
      // derives `playState` from) instead of the call returning.
      // The other honest answers are adapter-owned: a root with design-time
      // pieces is a deferred ingest Play session, a boot-mounted ingest runs
      // through its explicit play-control latch, and a standalone `{ module }`
      // route owns its module session. None allocates `play-mode.ts`'s
      // first-party session object, and answering "play did not start" over a
      // visibly running game is the same fabrication in the other direction.
      if (!editorHost().live.playing()) {
        return {
          ok: false,
          error:
            'Play did not start: the run was superseded before it finished booting (a stop, or a ' +
            'newer play, landed during startup). Nothing is running.',
        };
      }
      // EVERY PLAY RECORDS. There is no flag and no opt-in — see
      // `play-recording.ts` for why the capability had to stop being one an
      // agent must remember to switch on. `cmd['record']` only NAMES the file
      // (`vgai play --record <name>`); its absence names the clip after the
      // durable Gameplay Session.
      //
      // Started here rather than inside `enterPlayMode` on purpose: this
      // handler is the RELAYED play (`vgai play`, the SDK's `play.start`),
      // which is exactly the population the recording exists for. A human
      // clicking the editor's own Play button is their own witness and gets
      // play unchanged.
      const record = cmd['record'];
      const recording = await beginPlayRecording(
        liveInstanceContainer() ?? editorHost().workspace.liveDocument.container(),
        {
          name: typeof record === 'string' ? record : null,
          audio: getActiveSystems().audio?.acquireRecordingStream?.() ?? null,
          canvasFrame: captureLiveCanvasFrame,
          // A hidden tab's game loop is STOPPED (`engine/src/core/game-loop.ts`
          // never arms rAF while `document.hidden`), so its canvas holds one
          // frozen frame. This is the still-capture path's own recovery — one
          // deterministic tick, rendered — applied per recorded frame.
          refreshFrame: refreshRecordingFrame,
        },
      );
      return { ok: true, ...(recording ? { data: { recording } } : {}) };
    },
  },
  stop: {
    // `stop` waits on teardown (dispose chain, Rapier world free, renderer
    // teardown) — routinely past the generic budget under software rendering.
    timeoutMs: 30_000,
    derivedRefresh: 'always',
    handle: async () => {
      // A video export OWNS the paused run it is stepping, and Stop is the one
      // command the host prologue lets past its refusal so it can cancel it.
      gameplayExportAbort?.abort(new Error('Video export cancelled by Stop.'));
      // Finalize the clip BEFORE the surface it is photographing is torn down:
      // a WebM is unreadable until its recorder closes it, and compositing
      // through a teardown truncates the last seconds — which are the ones
      // someone stopping the run wanted to look at.
      const capture = await endPlayRecording('stop');
      exitPlayMode();
      return { ok: true, ...(capture ? { data: { recording: capture } } : {}) };
    },
  },
  pause: {
    derivedRefresh: 'always',
    handle: () => {
      pausePlayMode();
      return { ok: true };
    },
  },
  resume: {
    derivedRefresh: 'always',
    handle: () => {
      resumePlayMode();
      return { ok: true };
    },
  },
  step: {
    derivedRefresh: 'always',
    handle: () => {
      stepPlayMode();
      return { ok: true };
    },
  },
  // The video export hands control to the GAME (it steps a paused run frame
  // by frame), so its budget is the game's, not the editor's.
  'bridge-recording-export': {
    timeoutMs: 600_000,
    derivedRefresh: 'none',
    handle: async (cmd) => {
      const host = editorHost();
      if (host.session.playState() !== 'paused')
        return { ok: false, error: 'Pause the game before exporting video.' };
      const container = liveInstanceContainer();
      if (!container) return notPlayingResult();
      if (gameplayExportAbort) return { ok: false, error: 'A video export is already active.' };
      const { exportGameplayVideo, validateGameplayExport, assertGameplayVideoSupport } =
        await import('../src/host/gameplay-export');
      const exportOptions = {
        frames: Number(cmd['frames']),
        fps: cmd['fps'] === undefined ? 30 : Number(cmd['fps']),
      };
      try {
        validateGameplayExport(exportOptions);
      } catch (error) {
        return structuredErrorResult(error);
      }
      if (gameplayExportAbort) return { ok: false, error: 'A video export is already active.' };
      const controller = new AbortController();
      gameplayExportAbort = controller;
      setGameplayExportActive(true);
      const deadline = setTimeout(
        () => controller.abort(new Error('Video export exceeded its ten-minute deadline.')),
        590_000,
      );
      const playStartedAt = host.live.runWindow()?.startedAt ?? null;
      const unsubscribe = host.session.subscribe(() => {
        if (
          host.session.playState() !== 'paused' ||
          (host.live.runWindow()?.startedAt ?? null) !== playStartedAt
        ) {
          controller.abort(new Error('Video export cancelled: the Play session changed.'));
        }
      });
      // The world's own audio for the sim window the frame walk will cover.
      // `renderOffline` is the fixed-step sibling of the recorder's real-time
      // `acquireRecordingStream`; a world that does not implement it exports a
      // genuinely video-only file, said so in the result and in the clip note.
      const offlineAudio = exportAudioSource();
      try {
        await assertGameplayVideoSupport(container);
        controller.signal.throwIfAborted();
        const { gameplayRecordingActive } = await import('../src/host/gameplay-recording');
        if (gameplayRecordingActive()) await stopGameplayRecording();
        const { blob, ...result } = await exportGameplayVideo(container, exportOptions, {
          step: () => flushSync(() => stepPlayMode()),
          assertActive: () => {
            notePlayActivity();
            if (
              host.session.playState() !== 'paused' ||
              liveInstanceContainer() !== container ||
              (host.live.runWindow()?.startedAt ?? null) !== playStartedAt
            ) {
              throw new Error('Video export interrupted: its game must remain paused and mounted.');
            }
          },
          canvasFrame: captureLiveCanvasFrame,
          signal: controller.signal,
          ...(offlineAudio ? { audio: offlineAudio } : {}),
        });
        const {
          beginGameplayRecordingSink,
          appendGameplayRecordingChunk,
          finishGameplayRecordingSink,
          abortGameplayRecordingSink,
        } = await import('@volter/editor-core/editor-api');
        controller.signal.throwIfAborted();
        const sink = await beginGameplayRecordingSink(
          {
            startedAt: new Date().toISOString(),
            mimeType: 'video/webm',
            purpose: 'export',
            name: typeof cmd['name'] === 'string' ? cmd['name'] : `export-${Date.now()}`,
          },
          controller.signal,
        );
        try {
          for (
            let offset = 0, sequence = 0;
            offset < blob.size;
            offset += 4 * 1024 * 1024, sequence++
          ) {
            controller.signal.throwIfAborted();
            await appendGameplayRecordingChunk(
              sink,
              sequence,
              blob.slice(offset, offset + 4 * 1024 * 1024),
              controller.signal,
            );
          }
          controller.signal.throwIfAborted();
          await finishGameplayRecordingSink(
            sink,
            result.audio
              ? `fixed-step export with audio (${result.audio.codec}, ${result.audio.channels}ch @ ${result.audio.sampleRate} Hz)`
              : 'fixed-step export, video only: this world has no AudioAdapter.renderOffline',
            controller.signal,
          );
          controller.signal.throwIfAborted();
        } catch (error) {
          await abortGameplayRecordingSink(sink);
          throw error;
        }
        return { ok: true, data: { ...result, path: sink.path } };
      } catch (error) {
        return structuredErrorResult(error);
      } finally {
        unsubscribe();
        clearTimeout(deadline);
        gameplayExportAbort = null;
        setGameplayExportActive(false);
      }
    },
  },
};
