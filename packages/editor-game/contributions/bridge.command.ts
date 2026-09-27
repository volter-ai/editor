/**
 * The PAGE-BRIDGE verbs of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): the session-generic `bridge-call`, the
 * game-stack still, and the gameplay recorder's start/stop/timeline.
 *
 * These hand control to the GAME's own code (or read its pixels), so their
 * budgets are the game's, not the editor's — carried here from the host's own
 * table row for row.
 *
 * `bridge-recording-export` deliberately did NOT come with them: it reads and
 * subscribes to the EditorShellStore's `playState` (pause is its
 * precondition, and a play-state change is what cancels it), and a
 * contributed handler is handed the command only. It stays in
 * `command-listener.ts` with the host gate that refuses every command while
 * an export owns the paused run, until Play itself leaves the host.
 *
 * Play mode, the recorders and the composite capture are the game skew's own
 * modules, still housed in the editor until Play leaves the host (WORK.md
 * §The workbench, G); they are reached through the `@editor/*` alias the
 * editor's Vite serves to every contribution, and become this package's own
 * imports when they move. Nothing here is host API.
 */

import { getActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import {
  activeGameplayRecordingTimeline,
  startGameplayRecording,
  stopGameplayRecording,
} from '../src/host/gameplay-recording';
import { captureGameplayReplay, exportGameplayReplay } from '@volter/editor-sdk/kit/gameplay-replay';
import type { CommandContribution } from '@volter/editor-sdk/commands';
import { handleBridgeCall } from '../src/bridge/call';
import { hasLiveDebugPlane } from '../src/bridge/dispatch';
import { captureLiveCanvasFrame, refreshRecordingFrame } from '../src/bridge/live-frames';
import { handleBridgeScreenshot } from '../src/bridge/screenshot';
import { notPlayingResult, structuredErrorResult } from '../src/command-results';
import { isIngestActive } from '../src/ingest/active-ingest';
import { getInstanceContainer, isPlayModeActive } from '../src/play/play-mode';

export const point = 'workspace.command';

export const commands: CommandContribution['commands'] = {
  // #140 — the session-generic debug-seam relay: see `dispatchBridgeMethod`'s
  // doc comment for why this is a distinct primitive from the NAMED
  // debug-seam verbs (`list-gameplay-state` etc., `gameplay.command.ts`)
  // rather than a duplicate of them.
  'bridge-call': { timeoutMs: 60_000, derivedRefresh: 'always', handle: handleBridgeCall },
  'bridge-screenshot': {
    timeoutMs: 15_000,
    derivedRefresh: 'if-content-changed',
    handle: handleBridgeScreenshot,
  },
  'bridge-recording-start': {
    timeoutMs: 15_000,
    derivedRefresh: 'none',
    handle: async (cmd) => {
      if (!isPlayModeActive() && !hasLiveDebugPlane() && !isIngestActive()) {
        return notPlayingResult();
      }
      const container = getInstanceContainer();
      if (!container) {
        return { ok: false, error: 'no play-mode game surface is mounted yet' };
      }
      // Recording belongs to the RUNNING game, never the edit-time Asset Lab
      // audio fallback. A game with no audio adapter must produce an honest
      // video-only WebM instead of attaching a suspended preview track.
      const audio = getActiveSystems().audio?.acquireRecordingStream?.() ?? null;
      try {
        const started = await startGameplayRecording(container, {
          fps: typeof cmd['fps'] === 'number' ? cmd['fps'] : undefined,
          format:
            cmd['format'] === 'canvas-dom' || cmd['format'] === 'composite-webm'
              ? cmd['format']
              : undefined,
          name: typeof cmd['name'] === 'string' || cmd['name'] === null ? cmd['name'] : undefined,
          canvasFrame: captureLiveCanvasFrame,
          refreshFrame: refreshRecordingFrame,
          audio,
        });
        return { ok: true, data: { ...started } };
      } catch (error) {
        return structuredErrorResult(error);
      }
    },
  },
  'bridge-recording-stop': {
    timeoutMs: 60_000,
    derivedRefresh: 'none',
    handle: async () => {
      try {
        const capture = await stopGameplayRecording();
        return { ok: true, data: { ...capture } };
      } catch (error) {
        return structuredErrorResult(error);
      }
    },
  },
  'bridge-recording-timeline': {
    derivedRefresh: 'none',
    handle: () => {
      const timeline = activeGameplayRecordingTimeline();
      return timeline === null
        ? { ok: false, error: 'no gameplay recording is active' }
        : { ok: true, data: { ...timeline } };
    },
  },
  'bridge-recording-replay-capture': {
    timeoutMs: 60_000,
    derivedRefresh: 'none',
    handle: async (cmd) => {
      try {
        if (typeof cmd['replayPath'] !== 'string') {
          return { ok: false, error: 'replayPath is required' };
        }
        if (typeof cmd['positionMs'] !== 'number' || !Number.isFinite(cmd['positionMs'])) {
          return { ok: false, error: 'finite positionMs is required' };
        }
        const capture = await captureGameplayReplay(cmd['replayPath'], cmd['positionMs']);
        return { ok: true, data: { ...capture } };
      } catch (error) {
        return structuredErrorResult(error);
      }
    },
  },
  'bridge-recording-replay-export': {
    timeoutMs: 600_000,
    derivedRefresh: 'none',
    handle: async (cmd) => {
      try {
        if (typeof cmd['replayPath'] !== 'string')
          return { ok: false, error: 'replayPath is required' };
        const { blob, ...result } = await exportGameplayReplay({
          replayPath: cmd['replayPath'],
          ...(typeof cmd['fps'] === 'number' ? { fps: cmd['fps'] } : {}),
          ...(typeof cmd['startMs'] === 'number' ? { startMs: cmd['startMs'] } : {}),
          ...(typeof cmd['endMs'] === 'number' ? { endMs: cmd['endMs'] } : {}),
        });
        const {
          beginGameplayRecordingSink,
          appendGameplayRecordingChunk,
          finishGameplayRecordingSink,
          abortGameplayRecordingSink,
        } = await import('@volter/editor-sdk/kit/editor-api');
        const sink = await beginGameplayRecordingSink({
          startedAt: new Date().toISOString(),
          mimeType: 'video/webm',
          purpose: 'export',
          name: typeof cmd['name'] === 'string' ? cmd['name'] : `replay-export-${Date.now()}`,
        });
        try {
          for (
            let offset = 0, sequence = 0;
            offset < blob.size;
            offset += 4 * 1024 * 1024, sequence++
          )
            await appendGameplayRecordingChunk(
              sink,
              sequence,
              blob.slice(offset, offset + 4 * 1024 * 1024),
            );
          await finishGameplayRecordingSink(sink, 'post-processed canvas and DOM recording');
        } catch (error) {
          await abortGameplayRecordingSink(sink);
          throw error;
        }
        return { ok: true, data: { ...result, path: sink.path } };
      } catch (error) {
        return structuredErrorResult(error);
      }
    },
  },
};
