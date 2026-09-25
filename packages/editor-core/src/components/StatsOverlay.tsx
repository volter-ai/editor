import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';
import { useEditorStats } from '../editor-runtime';
import { latestTabCensus } from '@volter/editor-sdk/kit/tab-census';

export function StatsOverlay() {
  const stats = useEditorStats();
  const [, setTick] = useState(0);
  // The tab's resource census (tab-census.ts) — the SAME sample the heartbeat
  // carries and a death line quotes, read here on the tick this overlay
  // already runs. The author sees the cost while authoring it, which is the
  // whole reason the census exists: the quality loop grades looks, and a
  // renderer killed at Chrome's undocumented ceiling grades nothing.
  const census = latestTabCensus();

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  return (
    // V-10 — this was an EIGHTH one-off "dark panel"
    // value (`rgba(0,0,0,0.7)`, flat black, no border) directly stacked
    // above-right of ViewportOverlay's cluster and CameraInfo's pill in the
    // same corner. Given the same border/radius treatment as its siblings so
    // the whole corner reads as one family.
    // P6-U6 (owner taste decision 3: HUD overlays → real islands): the paint
    // moved to `.vgai-hud-overlay` so islands chrome can promote it to the
    // shared glass-island material (compact tier); bars chrome paints the
    // exact pre-U6 overlay-whisper recipe from the same class.
    <div
      className="vgai-hud-overlay vgai-chrome-island vgai-glass-island"
      data-island-scale="compact"
      data-hud-border="strong"
      style={{
        position: 'absolute',
        // U6.5 F1/P2-18 — second HUD tier: below the viewport toolbar row.
        // The var carries the glass breathing band (54px islands / 102px the
        // floating header-island clearance, scoped in theme.css); the bare
        // fallback is the pre-glass 48px so treatment-less chrome ("bars":
        // graphite/classic/lite/reduced) stays pixel-identical to main.
        top: 'var(--vgai-viewport-overlay-hud-top, 48px)',
        right: 8,
        padding: '6px 10px',
        pointerEvents: 'auto',
        fontSize: 'var(--vgai-font-base)',
        color: themeVars.content.primary,
        fontFamily: themeVars.typography.mono,
        lineHeight: '16px',
      }}
    >
      <div>FPS: {stats.fps.toFixed(0)}</div>
      <div>Draw: {stats.drawCalls}</div>
      <div>Tris: {stats.triangles.toLocaleString()}</div>
      <div>Frame: {stats.frameTime.toFixed(1)}ms</div>
      {census !== null && (
        <>
          <div>
            Heap: {census.heapUsedMB === null ? 'n/a' : `${census.heapUsedMB.toFixed(0)}MB`}
            {census.heapLimitMB === null ? '' : ` / ${census.heapLimitMB.toFixed(0)}MB`}
          </div>
          <div>Mount epochs: {census.mountEpochs}</div>
          <div>
            Canvas: {census.canvasMB.toFixed(1)}MB ×{census.canvases}
          </div>
          {/* Absent, never zeroed, when no game has registered a render-debug
              adapter — "no textures" is a different claim from "unmeasured". */}
          {census.textures !== undefined && (
            <div>
              GPU: {census.textures} tex, {census.geometries ?? 0} geo
              {census.programs === undefined ? '' : `, ${census.programs} prog`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
