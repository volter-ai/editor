/**
 * RULERS + PERSISTENT GUIDES on the DOM component board (design ledger:
 * snapping/guides). Figma's gesture grammar: drag OFF the top ruler to place
 * a horizontal guide, off the left ruler for a vertical one; drag a guide to
 * move it; drop it back on its ruler (or double-click it) to delete. Guides
 * live in BOARD coordinates and persist per project+document
 * (`board-guides.ts`); rendering maps them through the live pan/zoom.
 */

import { THEME } from '@volter/editor-sdk/widgets';
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  activeBreakpoint,
  setActiveBreakpoint,
  subscribeBreakpoint,
} from '@volter/editor-sdk/kit/breakpoint-state';
import { getRootPan, subscribeRootPan } from '@volter/editor-sdk/kit/world-pan-state';
import {
  addBoardGuide,
  type BoardGuide,
  boardGuides,
  moveBoardGuide,
  registerBoardGuideTransform,
  removeBoardGuide,
  subscribeBoardGuides,
} from './board-guides';

const RULER = 16;
const GUIDE_COLOR = 'rgba(255, 82, 82, 0.9)';
const RULER_BG = 'rgba(18, 22, 26, 0.92)';
const TICK_COLOR = 'rgba(255, 255, 255, 0.28)';

/** A round tick step that keeps labels ~≥60px apart at the current zoom. */
function tickStep(zoom: number): number {
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  return steps.find((s) => s * zoom >= 60) ?? 10000;
}

function formatTick(v: number): string {
  return Math.abs(v) >= 1000 ? `${v / 1000}k` : String(v);
}

interface DragState {
  kind: 'place' | 'move';
  axis: BoardGuide['axis'];
  id: string | null;
  /** Container-local pointer coordinate along the guide's axis. */
  at: number;
}

export function BoardRulers({
  docId,
  containerRef,
}: {
  docId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}): ReactElement {
  const view = useSyncExternalStore(subscribeRootPan, getRootPan);
  const guides = useSyncExternalStore(subscribeBoardGuides, () => boardGuides(docId));
  const [drag, setDrag] = useState<DragState | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Register the live board transform so gesture overlays can convert guide
  // coordinates into their own space (see board-guides.ts). Re-measured on
  // every pan/zoom/guide change; a pure window resize between pans can leave
  // it briefly stale, which only softens snapping — never breaks a write.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    registerBoardGuideTransform(docId, {
      originX: rect.left,
      originY: rect.top,
      panX: view.x,
      panY: view.y,
      zoom: view.zoom,
    });
    return () => registerBoardGuideTransform(docId, null);
  }, [docId, containerRef, view.x, view.y, view.zoom]);

  const toBoard = (local: number, axis: BoardGuide['axis']): number =>
    Math.round((local - (axis === 'x' ? view.x : view.y)) / view.zoom);
  const toLocal = (value: number, axis: BoardGuide['axis']): number =>
    (axis === 'x' ? view.x : view.y) + value * view.zoom;

  const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  };

  const beginPlace = (axis: BoardGuide['axis']) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = localPoint(e);
    setDrag({ kind: 'place', axis, id: null, at: axis === 'x' ? p.x : p.y });
  };

  const beginMove = (guide: BoardGuide) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = localPoint(e);
    setDrag({ kind: 'move', axis: guide.axis, id: guide.id, at: guide.axis === 'x' ? p.x : p.y });
  };

  const onDragMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    const p = localPoint(e);
    const at = drag.axis === 'x' ? p.x : p.y;
    setDrag({ ...drag, at });
    if (drag.kind === 'move' && drag.id) moveBoardGuide(docId, drag.id, toBoard(at, drag.axis));
  };

  const onDragEnd = (e: React.PointerEvent): void => {
    if (!drag) return;
    const p = localPoint(e);
    const at = drag.axis === 'x' ? p.x : p.y;
    const overRuler = at <= RULER;
    if (drag.kind === 'place') {
      if (!overRuler) addBoardGuide(docId, drag.axis, toBoard(at, drag.axis));
    } else if (drag.id) {
      if (overRuler) removeBoardGuide(docId, drag.id);
      else moveBoardGuide(docId, drag.id, toBoard(at, drag.axis));
    }
    setDrag(null);
  };

  // Visible tick range along one axis.
  const ticks = (axis: BoardGuide['axis']): number[] => {
    const el = containerRef.current;
    const extent = el ? (axis === 'x' ? el.clientWidth : el.clientHeight) : 0;
    const step = tickStep(view.zoom);
    const first = Math.ceil(toBoard(RULER, axis) / step) * step;
    const last = toBoard(extent, axis);
    const out: number[] = [];
    for (let v = first; v <= last && out.length < 200; v += step) out.push(v);
    return out;
  };

  const rulerStyle: React.CSSProperties = {
    position: 'absolute',
    background: RULER_BG,
    zIndex: 61,
    userSelect: 'none',
    touchAction: 'none',
    overflow: 'hidden',
  };

  return (
    <div
      ref={layerRef}
      data-testid="board-rulers"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 60 }}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
    >
      {/* Placed guides. */}
      {guides.map((guide) => {
        const local = toLocal(guide.value, guide.axis);
        const vertical = guide.axis === 'x';
        return (
          <div
            key={guide.id}
            data-testid={`board-guide-${guide.axis}-${guide.value}`}
            title={`${guide.axis} = ${guide.value} — drag to move, drop on the ruler or double-click to remove`}
            onPointerDown={beginMove(guide)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onDoubleClick={() => removeBoardGuide(docId, guide.id)}
            style={{
              position: 'absolute',
              pointerEvents: 'auto',
              cursor: vertical ? 'col-resize' : 'row-resize',
              zIndex: 60,
              ...(vertical
                ? { left: local - 2, top: 0, bottom: 0, width: 5 }
                : { top: local - 2, left: 0, right: 0, height: 5 }),
            }}
          >
            <div
              style={{
                position: 'absolute',
                background: GUIDE_COLOR,
                ...(vertical
                  ? { left: 2, top: 0, bottom: 0, width: 1 }
                  : { top: 2, left: 0, right: 0, height: 1 }),
              }}
            />
          </div>
        );
      })}
      {/* Placement/move preview line. */}
      {drag && (
        <div
          style={{
            position: 'absolute',
            background: GUIDE_COLOR,
            zIndex: 62,
            ...(drag.axis === 'x'
              ? { left: drag.at, top: 0, bottom: 0, width: 1 }
              : { top: drag.at, left: 0, right: 0, height: 1 }),
          }}
        >
          <span
            style={{
              position: 'absolute',
              ...(drag.axis === 'x' ? { top: RULER + 4, left: 4 } : { left: RULER + 4, top: 4 }),
              fontSize: 9,
              fontFamily: 'ui-monospace, monospace',
              color: GUIDE_COLOR,
              background: RULER_BG,
              padding: '1px 3px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
            }}
          >
            {toBoard(drag.at, drag.axis)}
          </span>
        </div>
      )}
      {/* Top ruler — places HORIZONTAL guides? No: Figma grammar — the top
          ruler measures X, and dragging DOWN from it places a horizontal
          guide; the left ruler measures Y and places vertical guides. We
          follow the measurement axis for ticks and Figma's pull direction
          for placement. */}
      <div
        data-testid="board-ruler-top"
        onPointerDown={beginPlace('y')}
        style={{
          ...rulerStyle,
          top: 0,
          left: RULER,
          right: 0,
          height: RULER,
          cursor: 'row-resize',
          pointerEvents: 'auto',
        }}
      >
        {ticks('x').map((v) => (
          <span
            key={v}
            style={{
              position: 'absolute',
              left: toLocal(v, 'x'),
              bottom: 0,
              borderLeft: `1px solid ${TICK_COLOR}`,
              height: 5,
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 2,
                bottom: 3,
                fontSize: 8,
                color: TICK_COLOR,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {formatTick(v)}
            </span>
          </span>
        ))}
      </div>
      {/* Left ruler. */}
      <div
        data-testid="board-ruler-left"
        onPointerDown={beginPlace('x')}
        style={{
          ...rulerStyle,
          top: RULER,
          left: 0,
          bottom: 0,
          width: RULER,
          cursor: 'col-resize',
          pointerEvents: 'auto',
        }}
      >
        {ticks('y').map((v) => (
          <span
            key={v}
            style={{
              position: 'absolute',
              top: toLocal(v, 'y'),
              right: 0,
              borderTop: `1px solid ${TICK_COLOR}`,
              width: 5,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 1,
                right: 3,
                fontSize: 8,
                color: TICK_COLOR,
                fontFamily: 'ui-monospace, monospace',
                writingMode: 'vertical-rl',
              }}
            >
              {formatTick(v)}
            </span>
          </span>
        ))}
      </div>
      <BreakpointArmedPill />
      {/* Corner square. */}
      <div
        style={{
          ...rulerStyle,
          top: 0,
          left: 0,
          width: RULER,
          height: RULER,
          borderRight: `1px solid ${THEME.border}`,
          borderBottom: `1px solid ${THEME.border}`,
        }}
      />
    </div>
  );
}

/** The armed-BREAKPOINT cue on the board itself (blind-walk friction: the
 *  breakpoint select is sticky, and with the inspector scrolled elsewhere the
 *  only sign that edits were scoped — and frames were previewing narrow —
 *  was a dropdown nobody was looking at). One pill, click to disarm. */
function BreakpointArmedPill(): ReactElement | null {
  const bp = useSyncExternalStore(subscribeBreakpoint, activeBreakpoint);
  if (!bp) return null;
  return (
    <button
      type="button"
      data-testid="board-breakpoint-pill"
      title="Style edits are scoped to this breakpoint — click to return to Base"
      onClick={() => setActiveBreakpoint(null)}
      style={{
        position: 'absolute',
        top: RULER + 8,
        right: 12,
        zIndex: 62,
        pointerEvents: 'auto',
        background: 'rgba(18, 22, 26, 0.92)',
        color: THEME.accent,
        border: `1px solid ${THEME.accent}`,
        borderRadius: 999,
        fontSize: 10,
        padding: '3px 10px',
        cursor: 'pointer',
      }}
    >
      @ {bp} · editing this breakpoint — click to clear
    </button>
  );
}
