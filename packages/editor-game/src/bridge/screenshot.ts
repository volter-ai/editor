/**
 * `bridge-screenshot` and the recording verbs' shared frame plumbing, moved
 * out of the editor's `command-listener.ts` with the verbs they serve
 * (WORK.md §The workbench). Play mode, the play/gameplay recorders, the
 * composite capture and the editor console are reached through the
 * `@editor/*` alias until those modules move too. Nothing here is host API.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import {
  type CaptureFlatness,
  CaptureLayerError,
  capturePlayComposite,
  sampleFlatness,
} from '@volter/editor-sdk/kit/composite-screenshot';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { presentationSurface } from '@volter/editor-sdk/kit/presentation-surface';
import type { EditorCommandMessage, EditorCommandResult } from '@volter/editor-sdk/commands';
import { notPlayingResult, structuredErrorResult } from '../command-results';
import { isIngestActive } from '../ingest/active-ingest';
import {
  getInstanceCanvas,
  getInstanceContainer,
  getPlayRuntimeAccess,
  isPlayModeActive,
} from '../play/play-mode';
import { livePlayRecording } from '../play/play-recording';
import { hasLiveDebugPlane } from './dispatch';
import { captureLiveCanvasFrame } from './live-frames';

/** `bridge-screenshot` relay op handler — captures the live play-mode game
 *  view and returns it in the same `{base64, mimeType}` shape
 *  `capture-viewport` already uses. #146: the capture is now the FULL game
 *  stack — canvas(es) plus the DOM UI layers (React adapter roots,
 *  react-world layers) composited via `capturePlayComposite` — because a
 *  canvas-only frame of a game whose score/health lives in the HUD is not
 *  "what the game looks like". When the composite leg can't run (no
 *  container, no DOM Image/XMLSerializer — e.g. the node-side relay tests —
 *  or a rasterization failure), it degrades to the original canvas-only
 *  `toDataURL` capture, marked
 *  honestly with `composite: false`. A caller (`RelayTransport.screenshot`
 *  in `@volter/editor-live`) writes the PNG to disk — this relay op stays a pure
 *  "hand back the pixels" primitive, matching `bridge-call`'s own
 *  session-generic, run-lifecycle-free shape.
 *
 *  Both legs also carry the PIXEL-honesty fields — `flatness` (how much of the
 *  frame is one flat surface, with the caller-facing sentence written here
 *  where the pixels are) and `loopRecoveryFrame` (this frame exists because
 *  capture recovered a starved runtime with one deterministic tick). Shaped by
 *  {@link screenshotResult} so the two legs cannot drift apart.
 *
 *  BOTH legs read a canvas, and a canvas is only readable after its frame when
 *  its WebGL context was created with `preserveDrawingBuffer: true`. Every
 *  canvas the vgai RUNTIME mounts sets it (`@volter/editor-game/runtime/create-runtime`,
 *  D5 §1/§4); a canvas an INGESTED game created is the game's own and usually
 *  does not, which read as a silently BLACK screenshot over a perfectly
 *  healthy running game. {@link liveCanvasFrame} is the answer for that
 *  case — one seam over both substrates' recovery mechanisms — and it
 *  is `null` for everything else, leaving the first-party path untouched. */

/** The clip a delivered still belongs to — see {@link screenshotRecordingNotice}. */
interface GameCaptureRecordingNote {
  readonly path: string;
  readonly startedAt: string;
  /** The sentence the caller shows verbatim, written here where the pixels are. */
  readonly notice: string;
}

function screenshotResult(
  base64: string,
  parts: {
    composite: boolean;
    layers?: { canvases: number; domOverlays: number };
    flatness: CaptureFlatness | null | undefined;
    loopRecoveryFrame: boolean;
  },
): EditorCommandResult {
  const recording = screenshotRecordingNotice();
  return {
    ok: true,
    data: {
      base64,
      mimeType: 'image/png',
      composite: parts.composite,
      ...(parts.layers ? { layers: parts.layers } : {}),
      ...(parts.flatness ? { flatness: parts.flatness } : {}),
      ...(parts.loopRecoveryFrame ? { loopRecoveryFrame: true } : {}),
      ...(recording ? { recording } : {}),
    },
  };
}

/**
 * WHAT A STILL CAN AND CANNOT ANSWER, said ON the still.
 *
 * A screenshot answers "what does it look like". It cannot answer "did the
 * jump land", "did the enemy path around the wall", "did the shot register" —
 * a single frame answers those only by luck, and a lucky answer is
 * indistinguishable from a real one, which is how a broken game gets reported
 * as working. So every capture taken during a recorded run carries the clip's
 * coordinates: the file, the wall-clock start its offsets are measured from,
 * and the play log whose event timestamps convert an event into an offset.
 *
 * THIS USED TO BE A REFUSAL, AND THE REFUSAL WAS THE DEFECT (2026-08-29,
 * cold fox #3). Because `vgai play` always records, refusing the still made
 * `vgai screenshot` dead for the rest of the session — and the look lane's
 * questions ("is the ear proportion right", "is the fox sunk into the
 * ground") are exactly the ones a still DOES answer. The refusal was
 * discouraging a wrong question by making a right one impossible, and the
 * cold agents' whole loop is play → look.
 *
 * Nothing about the clip changed: play still records unconditionally
 * (`play-recording.ts` — the evidence must not depend on anyone remembering
 * to ask for it), and the capture reads the canvas and composites the DOM
 * layers into an offscreen image, which the recorder's own stream never sees.
 * What changed is that the redirect is now attached to a delivered frame
 * instead of replacing it.
 *
 * No tool instructions here on purpose: the reader knows how to extract frames
 * from a WebM. What they cannot know without being told is WHERE the clip is,
 * WHEN it started, and HOW MANY frames constitute looking.
 */
function screenshotRecordingNotice(): GameCaptureRecordingNote | null {
  const live = livePlayRecording();
  if (!live) return null;
  return {
    path: live.path,
    startedAt: live.startedAt,
    notice: [
      `This run is being RECORDED — the still above is one frame of ${live.path}.`,
      'A still cannot answer a question about a moving game (did the jump land, did the shot',
      'register). If that is the question, read the clip:',
      '',
      `  recording: ${live.path}${live.rotates ? `   (the next ${commandLine('play')} replaces this file)` : '   (named — never rotated)'}`,
      ...(live.format === 'canvas-dom'
        ? [
            `  HUD replay: ${live.replayPath}`,
            '  The raw WebM contains the canvas only. Reconstruct HUD stills with',
            '  editor.recording.captureReplay, or export a full video with editor.recording.exportReplay.',
          ]
        : []),
      `  startedAt: ${live.startedAt}   (clip offset 0)`,
      `  play log:  ${live.logFile === null ? '(none — nothing is logging this run)' : `logs/${live.logFile}`}   (event timestamps → clip offsets)`,
      '',
      'THE BAR for a temporal question: examine AT LEAST 10 frames spanning no more than 5',
      'seconds around the moment. One frame, or ten frames spread across the run, is the same',
      'guess a single screenshot was.',
      '',
      `The clip is finalized and readable when play stops — ${commandLine('stop')}, or the idle`,
      `auto-stop after ${Math.round(live.idleAutoStopMs / 1000)}s with no session command and no player input.`,
    ].join('\n'),
  };
}

export async function handleBridgeScreenshot(
  cmd: EditorCommandMessage,
): Promise<EditorCommandResult> {
  // A recorded run does NOT gate this capture — `screenshotResult` attaches the
  // clip's coordinates to the frame instead (see `screenshotRecordingNotice`).
  // Same reachability rule `handleBridgeCall` uses, and for the same reason:
  // an ingested game's mount IS the running game, so it never creates a
  // first-party play session and `isPlayModeActive()` alone made
  // `vgai screenshot` permanently unusable against ingest. Loosening the gate
  // costs nothing in honesty — the ingest mount renders into the very
  // container `getInstanceContainer()` returns (`play-mode.ts`'s
  // `getGameContainer` is shared with the ingest mount paths), and when there is
  // genuinely nothing to capture both legs below still refuse by name with
  // `BRIDGE_SCREENSHOT_UNAVAILABLE`.
  //
  // `isIngestActive()` is the third reader, and it is what makes the refusal
  // TRUE. `hasLiveDebugPlane()` covers an ingest that publishes a debug plane
  // projected from a declared contract — which a canvas ingest has no way to
  // do (`mount-canvas-ingest-root.ts` publishes `setActiveSystems({})`), so
  // `vgai screenshot` answered "not in play mode" over a mounted, running,
  // self-ticking game whose play state the mount had itself set to `playing`.
  // A lying refusal is worse than a missing feature: it sends the reader to
  // `vgai play`, which is not the thing that was wrong. The question this gate
  // asks is "is a game surface live here", and a live ingest is one.
  if (!isPlayModeActive() && !hasLiveDebugPlane() && !isIngestActive()) return notPlayingResult();
  // Capture the ADDRESSED seat, not always the primary. `game.instance(id)`
  // sends its id here, so `game.instance('2').screenshot()` grabs seat 2's game
  // stack; an unaddressed call still captures the primary, and a caller that
  // wants every seat captures each id in turn (one image per instance).
  const instance = cmd['instance'] as string | undefined;
  const container = getInstanceContainer(instance);
  // WHICH SURFACE CARRIES THIS GAME'S PICTURE — a read, not a sniff, in both
  // halves. `getInstanceCanvas` resolves the ELEMENT through
  // `presentation-surface.ts` (the host's own mount stamp, then a self-booting
  // game's contract, then the labelled measured sweep), and `medium` is what
  // the adapter's region table DECLARES this project is presented on.
  const canvas = getInstanceCanvas(instance);
  const medium = presentationSurface(container).medium;
  // A starved canvas is provably stale, but a React-only root has no canvas:
  // its DOM is self-driven and `capturePlayComposite` has its own bounded
  // on-demand paint fallback. The gate keys on the presentation surface
  // EXISTING, which is the question it always meant to ask — and that existence
  // check now reads a declaration before it measures anything.
  const runtime = getPlayRuntimeAccess();
  let loopRecoveryFrame = false;
  let compositeFailure: unknown = null;
  if (canvas && runtime?.loop.liveness === 'loop-starved') {
    if (cmd['refreshStarvedFrame'] === true && runtime.runTicks) {
      try {
        runtime.runTicks(1, { render: 'last' });
        // Stamp the RESULT, not just the log: a frame that exists because the
        // capture drove the game is current but nobody was watching it, and
        // every caller (CLI, poke surface, relay transport) has to be able to
        // say so without inferring it from its own retry bookkeeping.
        loopRecoveryFrame = true;
      } catch (err) {
        return structuredErrorResult(err);
      }
    } else {
      return {
        ok: false,
        error:
          "cannot capture a fresh game frame while the host loop reports 'loop-starved' — " +
          'inspect the separate visibility readings, let presentation resume, or request a ' +
          'deterministic loop-recovery frame',
        data: { code: 'BRIDGE_SCREENSHOT_STALE' },
      };
    }
  }
  if (
    container &&
    typeof Image !== 'undefined' &&
    typeof XMLSerializer !== 'undefined' &&
    typeof container.getBoundingClientRect === 'function'
  ) {
    try {
      const composite = await capturePlayComposite(container, {
        canvasFrame: captureLiveCanvasFrame,
        // The DECLARED medium, from the adapter's region table. `undefined`
        // (no table loaded yet) leaves the compositor-settle heuristic on its
        // own canvas count, exactly as before.
        ...(medium === 'unknown' ? {} : { presentsOnCanvas: medium === 'canvas' }),
      });
      if (composite.layers.canvases === 0 && composite.layers.domOverlays === 0) {
        throw new CaptureLayerError(
          medium === 'dom' ? 'dom-overlay' : 'composite-output',
          'no game layers were mounted',
        );
      }
      return screenshotResult(composite.base64, {
        composite: true,
        layers: composite.layers,
        flatness: composite.flatness,
        loopRecoveryFrame,
      });
    } catch (error) {
      compositeFailure = error;
      editorConsole.warn(
        `Full-stack screenshot failed; returning the canvas-only fallback — ${error instanceof Error ? error.message : String(error)}`,
        'screenshot',
      );
      // Degrade to the canvas-only leg below — a HUD-less capture beats no
      // capture, and `composite: false` keeps the degradation visible.
    }
  }
  // A native React game has no canvas by design. The composite leg above is
  // therefore the PRIMARY capture path for a React-only root, not an
  // enhancement after a canvas precondition. Only fail once both the full
  // game-stack capture and the canvas fallback are unavailable.
  if (!canvas) {
    const compositeReason =
      compositeFailure instanceof Error ? compositeFailure.message : String(compositeFailure);
    return {
      ok: false,
      error:
        compositeFailure !== null
          ? `full game-stack capture failed — ${compositeReason}; no canvas layer is available as a fallback`
          : isIngestActive()
            ? 'the ingest mount is live but no DOM overlay or canvas layer is mounted for capture'
            : 'no play-mode DOM overlay or canvas layer is mounted yet',
      data: { code: 'BRIDGE_SCREENSHOT_UNAVAILABLE' },
    };
  }
  try {
    // Same seam as the composite leg, for the same reason: a game's own canvas
    // is unreadable this late, so ask for a same-frame copy first and fall back
    // to reading the canvas itself.
    const frameModule = await import('@volter/editor-sdk/kit/live-canvas-frame');
    const readable =
      frameModule.readablePngSource(await frameModule.liveCanvasFrame(canvas)) ?? canvas;
    const dataUrl = readable.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    // The degraded leg gets the same honesty check as the composite one — a
    // canvas-only frame of a buried camera is exactly as blank.
    return screenshotResult(base64, {
      composite: false,
      flatness: sampleFlatness(readable, canvas.ownerDocument),
      loopRecoveryFrame,
    });
  } catch (err) {
    // e.g. a tainted canvas (a cross-origin texture loaded with no CORS
    // headers, which WebGL refuses to read back even with
    // preserveDrawingBuffer:true) — a distinct, rarer failure from "no
    // canvas at all" above, surfaced honestly rather than swallowed.
    return {
      ok: false,
      error:
        `bridge-screenshot: canvas layer capture failed — ${
          err instanceof Error ? err.message : String(err)
        }` +
        (compositeFailure === null
          ? ''
          : `; full game-stack capture also failed — ${
              compositeFailure instanceof Error
                ? compositeFailure.message
                : String(compositeFailure)
            }`),
      data: { code: 'BRIDGE_SCREENSHOT_UNAVAILABLE' },
    };
  }
}
