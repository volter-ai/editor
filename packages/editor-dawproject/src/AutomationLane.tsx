/**
 * A CLIP'S AUTOMATION LANE under the piano roll, as Bitwig draws a note clip's expression lanes:
 * one `<Points target="cc11">` of the clip, its points joined by the ramps the performance plays
 * (`perform.ts` interpolates linearly; a `hold` point steps).
 *
 *   drag a point          `at` and `value` on its `<Point>`
 *   double-click the lane a new `<Point>` in the `<Points>`, after the point before it in time
 *   double-click a point  its `<Point>` taken out
 *
 * Every write is one undoable edit on the piece's own source; a lane or point the source
 * generates, or whose value is computed, refuses with the reason.
 */

import { formatAt } from '@volter/dawproject/notation';
import type { Piece, PiecePoint, PiecePoints } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { formatNumber, recordStructWrite, setProps, setRefusal, type SourceIndex, writeStruct } from './source-index';

export const LANE_H = 48;
const DOT = 7;

/** The range a lane's values live in: pitch bend is bipolar, a controller 0…1. */
function rangeOf(target: string): readonly [number, number] {
  return target === 'pitchbend' ? [-1, 1] : [0, 1];
}

export function AutomationLane(props: {
  readonly lane: PiecePoints;
  readonly piece: Piece;
  readonly index: SourceIndex;
  /** The clip's start, in beats from the piece's start: point times are the piece's. */
  readonly clipTime: number;
  readonly clipDuration: number;
  readonly pxPerBeat: number;
  readonly snap: number;
  readonly width: number;
  readonly color: string;
  readonly pieceFile: string;
  readonly documentId: string | null;
  readonly onMessage: (message: string | null) => void;
}) {
  const { lane, piece, index, clipTime, pxPerBeat } = props;
  const [low, high] = rangeOf(lane.target);
  const beatsPerBar = piece.transport.beatsPerBar;
  const inner = LANE_H - DOT - 2;
  const yOf = (value: number): number => DOT / 2 + 1 + (1 - (value - low) / (high - low)) * inner;
  const xOf = (time: number): number => (time - clipTime) * pxPerBeat;
  const drag = useRef<{ point: PiecePoint; x: number; y: number; time: number; value: number } | null>(null);
  const [shown, setShown] = useState<{ id: string; time: number; value: number } | null>(null);
  useEffect(() => setShown(null), [lane]);
  const resource = { file: props.pieceFile, documentId: props.documentId };

  const refusal = (point: PiecePoint): string | null => {
    const count = point.oid ? (piece.oidCounts.get(point.oid) ?? 0) : 0;
    return setRefusal(index, point.oid, 'at', count) ?? setRefusal(index, point.oid, 'value', count);
  };

  const onDown = (point: PiecePoint, event: ReactPointerEvent): void => {
    const why = refusal(point);
    if (why) {
      props.onMessage(why);
      return;
    }
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    props.onMessage(null);
    drag.current = { point, x: event.clientX, y: event.clientY, time: point.time, value: point.value };
  };
  const onMove = (event: ReactPointerEvent): void => {
    const current = drag.current;
    if (!current) return;
    const raw = current.point.time + (event.clientX - current.x) / pxPerBeat;
    const time = Math.max(clipTime, Math.min(clipTime + props.clipDuration, Math.round(raw / props.snap) * props.snap));
    const value = Math.max(low, Math.min(high, Math.round((current.point.value - ((event.clientY - current.y) / inner) * (high - low)) * 100) / 100));
    if (time === current.time && value === current.value) return;
    drag.current = { ...current, time, value };
    setShown({ id: current.point.id, time, value });
  };
  const onUp = (): void => {
    const current = drag.current;
    drag.current = null;
    const oid = current?.point.oid;
    if (!current || !oid) return;
    const { point, time, value } = current;
    const next: Record<string, string | number> = {};
    if (time !== point.time) next['at'] = formatAt(time, beatsPerBar);
    if (value !== point.value) next['value'] = value;
    if (Object.keys(next).length === 0) {
      setShown(null);
      return;
    }
    setProps(`Move ${lane.target} Point`, index, oid, next, resource).catch((error: unknown) => {
      setShown(null);
      props.onMessage(error instanceof Error ? error.message : String(error));
    });
  };

  const addPoint = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const count = lane.oid ? (piece.oidCounts.get(lane.oid) ?? 0) : 0;
    if (!lane.oid || count !== 1) {
      props.onMessage(`This ${lane.target} lane is generated: one <Points> in the source renders it more than once.`);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const time = clipTime + Math.round((event.clientX - box.left) / pxPerBeat / props.snap) * props.snap;
    const value = Math.round((high - ((event.clientY - box.top - DOT / 2 - 1) / inner) * (high - low)) * 100) / 100;
    const snippet = `<Point at="${formatAt(time, beatsPerBar)}" value={${formatNumber(Math.max(low, Math.min(high, value)))}} />`;
    const before = lane.points
      .filter((point) => point.time <= time && refusal(point) === null)
      .sort((a, b) => a.time - b.time)
      .at(-1);
    props.onMessage(null);
    (before?.oid ? writeStruct(before.oid, 'create-sibling', snippet) : writeStruct(lane.oid, 'create', snippet)).then(
      (write) => {
        if (write) recordStructWrite(`Add ${lane.target} Point`, write, { index, pieceFile: props.pieceFile, documentId: props.documentId }, props.onMessage);
      },
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };

  const deletePoint = (point: PiecePoint): void => {
    const why = refusal(point);
    if (why || !point.oid) {
      props.onMessage(why);
      return;
    }
    writeStruct(point.oid, 'delete').then(
      (write) => {
        if (write) recordStructWrite(`Delete ${lane.target} Point`, write, { index, pieceFile: props.pieceFile, documentId: props.documentId }, props.onMessage);
      },
      (error: unknown) => props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };

  const points = lane.points
    .map((point) => (shown?.id === point.id ? { ...point, time: shown.time, value: shown.value } : point))
    .sort((a, b) => a.time - b.time);
  // The polyline the performance plays: ramps between points, a step after a `hold`, flat to
  // the lane's ends.
  const path: string[] = [];
  points.forEach((point, i) => {
    const x = xOf(point.time);
    const y = yOf(point.value);
    if (i === 0) path.push(`M 0 ${y} L ${x} ${y}`);
    else {
      const previous = points[i - 1]!;
      if (previous.hold) path.push(`L ${x} ${yOf(previous.value)}`);
      path.push(`L ${x} ${y}`);
    }
    if (i === points.length - 1) path.push(`L ${props.width} ${y}`);
  });

  return (
    <div
      data-lane={lane.target}
      onDoubleClick={addPoint}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{ position: 'relative', width: props.width, height: LANE_H, flex: 'none' }}
    >
      <svg width={props.width} height={LANE_H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
        <path d={path.join(' ')} fill="none" stroke={props.color} strokeWidth={1.5} opacity={0.8} />
      </svg>
      {points.map((point) => {
        const why = refusal(point);
        return (
          <div
            key={point.id}
            data-point={point.id}
            title={why ?? `${lane.target} ${formatAt(point.time, beatsPerBar)} = ${point.value}${point.hold ? ' (hold)' : ''}`}
            onPointerDown={(event) => onDown(point, event)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              deletePoint(point);
            }}
            style={{
              position: 'absolute',
              left: xOf(point.time) - DOT / 2,
              top: yOf(point.value) - DOT / 2,
              width: DOT,
              height: DOT,
              borderRadius: DOT,
              boxSizing: 'border-box',
              background: why ? 'transparent' : props.color,
              border: `1px ${why ? 'dashed' : 'solid'} ${why ? props.color : themeVars.surface.panel}`,
              cursor: why ? 'not-allowed' : 'move',
            }}
          />
        );
      })}
    </div>
  );
}
