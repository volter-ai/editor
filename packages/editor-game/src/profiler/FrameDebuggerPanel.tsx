/**
 * Frame debugger tab (W4b, F11) — the read-only single-frame draw-call
 * introspection surface over `SystemAdapters.RenderDebugAdapter`:
 *
 *  - a CAPTURE button (`frame-capture-button`) arms the first-party WebGL2
 *    capture and appends the next rendered frame's draw list to a bounded
 *    ring (shared with the Game-tab `game-capture-frame` button via
 *    `frame-debugger-store.ts`);
 *  - a capture HISTORY strip (last 10) to switch between captures;
 *  - the selected capture's DRAW CALLS grouped under render-target headers,
 *    with prev/next step buttons walking a per-draw selection;
 *  - a selected-draw DETAIL panel: entry point, mode/count/instances, program
 *    label, geometry attributes, blend/depth/cull/scissor flags, viewport, and
 *    the draw's attribution — or an honest "not attributable" for a
 *    shadow/composer-pass draw the instrument could not attribute.
 *
 * This is a capture LIST with per-draw STATE, NOT a GPU replayer — the header
 * says so. Degradation ladder rendered honestly (W3a contract): no adapter →
 * the register-an-adapter notice; a capture rejection (paused/stopped world,
 * no frame rendered) → the reason printed, never a fabricated draw list.
 * Editor code speaks only the `RenderDebugAdapter` interface and the plain
 * capture shapes — never the WebGL2 instrument.
 */

import {
  deriveRenderDebugCapabilities,
  groupDrawCallsByTarget,
  summarizeCapture,
} from '../host/components/frame-debugger-model';
import { editorHost, useHostAvailabilitySelector } from '@volter/editor-sdk/host';
import { Button, themeVars } from '@volter/editor-sdk/widgets';
import type {
  FrameCapture,
  FrameCaptureDrawCall,
} from '@volter/game-runtime/dev/webgl-frame-capture';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  captureFrame,
  clearCaptures,
  frameDebuggerVersion,
  getCaptureHistory,
  isCapturing,
  lastCaptureError,
  selectCapture,
  subscribeFrameDebugger,
  syncFrameDebuggerAdapter,
} from './frame-debugger-store';

const MONO: React.CSSProperties = {
  fontFamily: themeVars.typography.mono,
  fontSize: 11,
};

// --- Draw-call rows ---------------------------------------------------------

function DrawRow({
  draw,
  selected,
  onSelect,
}: {
  draw: FrameCaptureDrawCall;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid="frame-draw-row"
      data-draw-index={draw.index}
      data-selected={selected || undefined}
      className="vgai-frame-draw-row"
      onClick={onSelect}
    >
      <span style={{ ...MONO, color: themeVars.content.dim, width: 34, display: 'inline-block' }}>
        #{draw.index}
      </span>
      <span style={{ ...MONO, color: themeVars.content.primary }}>{draw.mode}</span>
      <span style={{ ...MONO, color: themeVars.content.muted }}> {draw.count}</span>
      {draw.instanceCount !== null && (
        <span style={{ ...MONO, color: themeVars.content.muted }}> ×{draw.instanceCount}</span>
      )}
      <span
        style={{
          ...MONO,
          color: draw.annotation ? themeVars.content.primary : themeVars.content.dim,
          fontStyle: draw.annotation ? 'normal' : 'italic',
        }}
      >
        {' '}
        {draw.annotation
          ? draw.annotation.object.name || draw.annotation.object.type
          : 'unattributed'}
      </span>
    </Button>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '1px 0' }}>
      <span style={{ fontSize: 10, color: themeVars.content.muted, width: 92, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ ...MONO, color: themeVars.content.primary }}>{value}</span>
    </div>
  );
}

const onOff = (b: boolean): string => (b ? 'on' : 'off');

function formatDrawTarget(target: FrameCaptureDrawCall['target']): string {
  if (target.kind === 'canvas') return 'canvas (default framebuffer)';
  const size =
    target.width !== null && target.height !== null
      ? `${target.width}×${target.height}`
      : '(size not queryable)';
  return `${target.label ?? 'framebuffer'} ${size}`;
}

function formatDrawState(state: FrameCaptureDrawCall['state']): string {
  return `blend ${onOff(state.blend)} · depth test ${onOff(state.depthTest)} · depth write ${onOff(
    state.depthWrite,
  )} · cull ${state.cull} · scissor ${onOff(state.scissor)}`;
}

function formatCountLine(draw: FrameCaptureDrawCall): string {
  const instances =
    draw.instanceCount !== null ? ` · ${draw.instanceCount} instances` : ' · not instanced';
  return `${draw.mode} · ${draw.count}${instances}`;
}

function DrawDetail({ draw }: { draw: FrameCaptureDrawCall }) {
  return (
    <div data-testid="frame-draw-detail" style={{ padding: 8 }}>
      <DetailField label="entry point" value={draw.entryPoint} />
      <DetailField label="mode / count" value={formatCountLine(draw)} />
      <DetailField label="program" value={draw.programLabel ?? 'none bound'} />
      <DetailField label="target" value={formatDrawTarget(draw.target)} />
      <DetailField label="viewport" value={`[${draw.viewport.join(', ')}]`} />
      <DetailField label="state" value={formatDrawState(draw.state)} />
      {draw.annotation ? (
        <>
          <DetailField
            label="object"
            value={`${draw.annotation.object.name || '(unnamed)'} · ${draw.annotation.object.type}`}
          />
          <DetailField
            label="geometry"
            value={`${draw.annotation.geometry.name || draw.annotation.geometry.type}${
              draw.annotation.geometry.indexed ? ' · indexed' : ''
            }`}
          />
          <DetailField
            label="attributes"
            value={draw.annotation.geometry.attributes.join(', ') || '—'}
          />
          <DetailField
            label="material"
            value={`${draw.annotation.material.name || '(unnamed)'} · ${draw.annotation.material.type}`}
          />
        </>
      ) : (
        <div
          data-testid="frame-draw-unattributed"
          style={{
            marginTop: 6,
            fontSize: 11,
            fontStyle: 'italic',
            color: themeVars.content.muted,
          }}
        >
          Not attributable (shadow / post-processing pass — the instrument attributes only main-pass
          draws through each object's onBeforeRender, and reports the gap honestly rather than
          guessing).
        </div>
      )}
    </div>
  );
}

// --- Selected-capture body --------------------------------------------------

/** The two-column view of the selected capture: draw list grouped by target
 *  with prev/next stepping, and the selected-draw detail. Owns the per-draw
 *  selection index (reset by its `capture.id` key at the call site). */
function CaptureDetailView({
  capture,
  drawIndex,
  setDrawIndex,
}: {
  capture: FrameCapture;
  drawIndex: number;
  setDrawIndex: (index: number) => void;
}) {
  const drawCount = capture.drawCalls.length;
  const boundedIndex = Math.min(drawIndex, Math.max(0, drawCount - 1));
  const selectedDraw = capture.drawCalls[boundedIndex] ?? null;
  const groups = groupDrawCallsByTarget(capture);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* Draw list, grouped by render target */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'auto',
          borderRight: `1px solid ${themeVars.boundary.default}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            padding: 4,
            borderBottom: `1px solid ${themeVars.boundary.default}`,
          }}
        >
          <Button
            type="button"
            size="compact"
            variant="ghost"
            data-testid="frame-draw-prev"
            disabled={boundedIndex <= 0}
            onClick={() => setDrawIndex(Math.max(0, boundedIndex - 1))}
          >
            ◀ Prev
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            data-testid="frame-draw-next"
            disabled={boundedIndex >= drawCount - 1}
            onClick={() => setDrawIndex(Math.min(drawCount - 1, boundedIndex + 1))}
          >
            Next ▶
          </Button>
          <span style={{ fontSize: 10, color: themeVars.content.muted }}>
            {drawCount === 0 ? '0' : boundedIndex + 1}/{drawCount}
          </span>
        </div>
        {groups.map((group) => (
          <div key={group.target} data-testid="frame-target-group" data-target={group.target}>
            <div
              style={{
                ...MONO,
                // §2.31: hairline group separator instead of a fill.
                padding: '2px 8px',
                color: themeVars.content.muted,
                borderTop: `1px solid ${themeVars.boundary.default}`,
                borderBottom: `1px solid ${themeVars.boundary.default}`,
              }}
            >
              {group.target} · {group.draws.length} draws
            </div>
            {group.draws.map((draw) => (
              <DrawRow
                key={draw.index}
                draw={draw}
                selected={draw.index === boundedIndex}
                onSelect={() => setDrawIndex(draw.index)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Selected-draw detail */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {selectedDraw ? (
          <DrawDetail draw={selectedDraw} />
        ) : (
          <div style={{ padding: 12, color: themeVars.content.muted, fontSize: 12 }}>
            This capture recorded no draws.
          </div>
        )}
        {capture.notes.length > 0 && (
          <div
            style={{ padding: '4px 8px', fontSize: 10, color: themeVars.content.dim }}
            data-testid="frame-capture-notes"
          >
            {capture.notes.join(' ')}
          </div>
        )}
      </div>
    </div>
  );
}

/** The capture-history strip (last N captures). */
function CaptureHistoryStrip({
  captures,
  selectedId,
}: {
  captures: readonly FrameCapture[];
  selectedId: number | null;
}) {
  return (
    <div
      data-testid="frame-capture-history"
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        padding: '4px 8px',
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      {captures.map((capture) => {
        const summary = summarizeCapture(capture);
        return (
          <Button
            key={capture.id}
            type="button"
            size="compact"
            variant="ghost"
            data-testid="frame-capture-item"
            data-capture-id={capture.id}
            data-selected={capture.id === selectedId || undefined}
            onClick={() => selectCapture(capture.id)}
          >
            #{capture.id} · {summary.drawCalls} draws
            {summary.unattributed > 0 ? ` · ${summary.unattributed} unattr` : ''}
            {summary.truncated > 0 ? ` · +${summary.truncated} capped` : ''}
          </Button>
        );
      })}
    </div>
  );
}

// --- The panel --------------------------------------------------------------

export function FrameDebuggerPanel() {
  useSyncExternalStore(subscribeFrameDebugger, frameDebuggerVersion, frameDebuggerVersion);
  const [selectedDrawIndex, setSelectedDrawIndex] = useState(0);

  const adapter = useHostAvailabilitySelector(
    () => editorHost().systems.inspected().renderDebug ?? null,
  );
  // Reset the shared ring when the adapter identity changes (new mount / stop).
  useEffect(() => {
    syncFrameDebuggerAdapter(adapter);
  }, [adapter]);

  const caps = deriveRenderDebugCapabilities(adapter);
  const history = getCaptureHistory();
  const selected = history.selected;

  // Reset the per-draw selection when the selected capture changes.
  useEffect(() => {
    setSelectedDrawIndex(0);
  }, [selected?.id]);

  if (!adapter || !caps) {
    return (
      <div
        data-testid="frame-debugger-empty"
        style={{ padding: 16, color: themeVars.content.muted, fontSize: 12, lineHeight: '18px' }}
      >
        <div style={{ color: themeVars.content.primary, marginBottom: 4 }}>
          No render-debug adapter — no game session is running.
        </div>
        Frame capture exists only while a game session runs. Press Play: first-party worlds register
        a <code style={MONO}>RenderDebugAdapter</code> automatically when they hold a real WebGL2
        context; a custom world exposes its own via{' '}
        <code style={MONO}>{"ctx.registerSystemAdapter?.('renderDebug', adapter)"}</code>. A
        headless mount registers none — there is nothing to capture.
      </div>
    );
  }

  const captureError = lastCaptureError();
  const capturing = isCapturing();

  return (
    <div
      data-testid="frame-debugger"
      // §2.31 P2 amendment: text-dense output region reads over a local
      // frosted layer (inert for non-frost themes).
      className="vgai-content-frost"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', fontSize: 12 }}
    >
      {/* Header: capture control + honest scope statement + history strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          padding: '4px 8px',
          borderBottom: `1px solid ${themeVars.boundary.default}`,
        }}
      >
        <Button
          type="button"
          size="compact"
          data-testid="frame-capture-button"
          disabled={capturing}
          onClick={() => void captureFrame(adapter)}
        >
          {capturing ? 'Capturing…' : 'Capture frame'}
        </Button>
        <span style={{ fontSize: 10, color: themeVars.content.dim }}>
          Single-frame draw-call list with per-draw state — not a GPU replayer.
        </span>
        {history.all.length > 0 && (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            data-testid="frame-capture-clear"
            onClick={() => clearCaptures()}
          >
            Clear
          </Button>
        )}
      </div>

      {captureError && (
        <div
          data-testid="frame-capture-error"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            color: themeVars.semantic.danger,
            borderBottom: `1px solid ${themeVars.boundary.default}`,
          }}
        >
          Capture failed: {captureError}
        </div>
      )}

      {history.all.length > 0 && (
        <CaptureHistoryStrip captures={history.all} selectedId={selected?.id ?? null} />
      )}

      {selected ? (
        <CaptureDetailView
          key={selected.id}
          capture={selected}
          drawIndex={selectedDrawIndex}
          setDrawIndex={setSelectedDrawIndex}
        />
      ) : (
        <div
          data-testid="frame-debugger-no-capture"
          style={{ padding: 12, color: themeVars.content.muted, fontSize: 12 }}
        >
          No frame captured yet. Press <strong>Capture frame</strong> while the game renders.
        </div>
      )}
    </div>
  );
}
