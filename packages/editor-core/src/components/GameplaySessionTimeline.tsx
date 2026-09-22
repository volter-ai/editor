import { fontSizeVar, space, themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { captureGameplayReplay } from '../gameplay-replay';
import { gameplayRecordingMediaTimeMs } from '../gameplay-session-time';
import { toolContributionRecording, toolGameplaySessions } from '../gameplay-sessions';

function clock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the fixed 28px transport intentionally keeps its live/finalized/empty visual states together.
export function GameplaySessionTimeline() {
  const state = useSyncExternalStore(
    toolGameplaySessions.subscribe,
    toolGameplaySessions.getSnapshot,
    toolGameplaySessions.getSnapshot,
  );
  const rail = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [preview, setPreview] = useState<{ ms: number; x: number } | null>(null);
  const liveRecording = useSyncExternalStore(
    toolContributionRecording.subscribe,
    toolContributionRecording.getSnapshot,
    toolContributionRecording.getSnapshot,
  );
  const session = state.selectedSession;
  const recording = session?.recording?.finalized ? session.recording : null;
  const [replayFrame, setReplayFrame] = useState<{ src?: string; error?: string } | null>(null);
  const replayQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    setReplayFrame(null);
    if (!recording || recording.format !== 'canvas-dom' || !recording.replay || !preview) return;
    let cancelled = false;
    const path = recording.replay;
    const at = gameplayRecordingMediaTimeMs(
      session?.startedAt ?? 0,
      recording.startedAt ?? session?.startedAt ?? 0,
      preview.ms,
    );
    const timer = setTimeout(() => {
      // Serial reconstruction plus stale-request rejection: scrubbing never
      // launches a pile of offscreen players or publishes an older hover.
      replayQueue.current = replayQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (cancelled) return;
          try {
            const frame = await captureGameplayReplay(path, at);
            if (!cancelled) setReplayFrame({ src: `data:image/png;base64,${frame.base64}` });
          } catch (error) {
            if (!cancelled)
              setReplayFrame({ error: error instanceof Error ? error.message : String(error) });
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recording?.replay, recording?.format, recording?.startedAt, preview?.ms, session?.startedAt]);

  const liveRecordingStartedAt = liveRecording ? Date.parse(liveRecording.startedAt) : Number.NaN;
  const livePreview =
    session?.status === 'live' &&
    liveRecording &&
    Number.isFinite(liveRecordingStartedAt) &&
    liveRecordingStartedAt >= session.startedAt
      ? liveRecording
      : null;
  const previewWallAt = session && preview ? session.startedAt + preview.ms : null;
  const liveFrame =
    livePreview && previewWallAt !== null
      ? (livePreview.frames.reduce<(typeof livePreview.frames)[number] | null>((closest, frame) => {
          const capturedAt = Date.parse(frame.capturedAt);
          if (!Number.isFinite(capturedAt)) return closest;
          if (!closest) return frame;
          return Math.abs(capturedAt - previewWallAt) <
            Math.abs(Date.parse(closest.capturedAt) - previewWallAt)
            ? frame
            : closest;
        }, null) ?? null)
      : null;
  const liveFrameAt = liveFrame ? Date.parse(liveFrame.capturedAt) : Number.NaN;
  const liveFrameCloseEnough =
    liveFrame &&
    previewWallAt !== null &&
    Number.isFinite(liveFrameAt) &&
    Math.abs(liveFrameAt - previewWallAt) <= Math.max(1_000, 2_000 / (livePreview?.sampleFps ?? 1))
      ? liveFrame
      : null;

  function seekPreview(element: HTMLVideoElement, at: { ms: number }) {
    if (!Number.isFinite(element.duration)) return;
    const sessionStart = session?.startedAt ?? 0;
    const mediaTimeMs = gameplayRecordingMediaTimeMs(
      sessionStart,
      recording?.startedAt ?? sessionStart,
      at.ms,
    );
    element.currentTime = Math.min(mediaTimeMs / 1_000, Math.max(0, element.duration - 0.01));
  }

  useEffect(() => {
    const element = video.current;
    if (!element || !preview) return;
    seekPreview(element, preview);
  }, [preview, recording?.startedAt, session?.startedAt]);

  function timeAt(clientX: number): { ms: number; x: number } {
    const rect = rail.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return { ms: 0, x: 0 };
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return { ms: (x / rect.width) * state.liveEdgeMs, x };
  }

  if (state.loading && state.sessions.length === 0) {
    return <div style={{ padding: `4px ${space[3]}`, fontSize: 11 }}>Loading sessions…</div>;
  }

  if (state.error && state.sessions.length === 0) {
    return (
      <div
        role="alert"
        style={{ padding: `4px ${space[3]}`, fontSize: 11, color: themeVars.semantic.danger }}
      >
        Gameplay Sessions unavailable: {state.error}
      </div>
    );
  }

  return (
    <div
      style={{
        height: 28,
        minHeight: 28,
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        padding: `0 ${space[3]}`,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
        background: themeVars.surface.inset,
        position: 'relative',
        zIndex: 2,
      }}
    >
      <select
        aria-label="Gameplay Session"
        value={state.selectedSessionId ?? ''}
        onChange={(event) => toolGameplaySessions.select(event.currentTarget.value)}
        style={{ maxWidth: 180, height: 20, fontSize: 11 }}
      >
        {state.sessions.length === 0 ? <option value="">No sessions yet</option> : null}
        {state.sessions.map((candidate, index) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.status === 'live'
              ? 'Live'
              : (candidate.run ?? `Session ${state.sessions.length - index}`)}
          </option>
        ))}
      </select>
      <span style={{ width: 34, fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        {clock(state.cursorMs)}
      </span>
      <div
        ref={rail}
        role="slider"
        aria-label="Session time"
        aria-valuemin={0}
        aria-valuemax={state.liveEdgeMs}
        aria-valuenow={state.cursorMs}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          toolGameplaySessions.seek(timeAt(event.clientX).ms);
        }}
        onPointerMove={(event) => {
          const at = timeAt(event.clientX);
          setPreview(at);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            toolGameplaySessions.seek(at.ms);
        }}
        onPointerLeave={() => setPreview(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') toolGameplaySessions.seek(state.cursorMs - 1_000);
          if (event.key === 'ArrowRight') toolGameplaySessions.seek(state.cursorMs + 1_000);
        }}
        style={{
          flex: 1,
          height: 12,
          position: 'relative',
          cursor: 'ew-resize',
          outline: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 5,
            height: 2,
            background: themeVars.boundary.strong,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${state.liveEdgeMs > 0 ? (state.cursorMs / state.liveEdgeMs) * 100 : 0}%`,
            top: 1,
            width: 2,
            height: 10,
            background: themeVars.accent.default,
          }}
        />
        {preview && (recording || livePreview) ? (
          <div
            style={{
              position: 'absolute',
              left: Math.max(0, preview.x - 80),
              top: 16,
              width: 160,
              padding: 3,
              background: themeVars.surface.raised,
              border: `1px solid ${themeVars.boundary.strong}`,
              boxShadow: '0 6px 18px rgba(0,0,0,.35)',
              pointerEvents: 'none',
            }}
          >
            {recording?.format === 'canvas-dom' ? (
              replayFrame?.src ? (
                <img
                  src={replayFrame.src}
                  alt="Recorded gameplay with HUD"
                  style={{ width: '100%', display: 'block' }}
                />
              ) : (
                <div role="status" style={{ padding: space[4], fontSize: fontSizeVar.sm }}>
                  {replayFrame?.error ?? 'Reconstructing frame…'}
                </div>
              )
            ) : recording ? (
              <video
                ref={video}
                src={recording.url}
                muted
                preload="metadata"
                onLoadedMetadata={(event) => {
                  if (preview) seekPreview(event.currentTarget, preview);
                }}
                style={{ width: '100%', display: 'block' }}
              />
            ) : liveFrameCloseEnough ? (
              <img
                src={liveFrameCloseEnough.src}
                alt="Live gameplay recording preview"
                style={{ width: '100%', display: 'block' }}
              />
            ) : (
              <div style={{ padding: 8, fontSize: 10, color: themeVars.content.muted }}>
                {livePreview?.frames.length === 0
                  ? 'Frame previews are available after recording stops.'
                  : `This point is outside the ${clock(livePreview?.retentionMs ?? 0)} live preview window.`}
              </div>
            )}
            <div style={{ fontSize: 10, textAlign: 'center', paddingTop: 2 }}>
              {clock(preview.ms)}
            </div>
          </div>
        ) : null}
      </div>
      <span style={{ width: 34, fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        {clock(state.liveEdgeMs)}
      </span>
      {session?.status === 'live' ? (
        <span style={{ color: themeVars.semantic.danger, fontSize: 10 }}>
          ● LIVE{livePreview ? ' VIDEO' : ''}
        </span>
      ) : recording ? (
        <span style={{ fontSize: 10, color: themeVars.content.muted }}>VIDEO</span>
      ) : null}
      {state.error ? (
        <span
          role="status"
          title={state.error}
          style={{ color: themeVars.semantic.warning, fontSize: 11 }}
        >
          ⚠
        </span>
      ) : null}
    </div>
  );
}
