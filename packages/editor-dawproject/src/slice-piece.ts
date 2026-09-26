import type { Piece, PiecePoint, PiecePoints } from '@volter/dawproject/piece';

/** A lane restricted to a beat range, retaining its boundary values and interpolation. */
function sliceLane(lane: PiecePoints, from: number, to: number, fallback?: number): PiecePoints {
  const points = [...lane.points].sort((a, b) => a.time - b.time);
  if (fallback !== undefined && (!points.length || points[0]!.time > 0)) {
    points.unshift({ id: lane.id, oid: lane.oid, time: 0, value: fallback, hold: true });
  }
  if (!points.length) return { ...lane, points: [] };
  const at = (time: number): PiecePoint => {
    let previous = points[0]!;
    for (const point of points) {
      if (point.time > time) break;
      previous = point;
    }
    const next = points.find((point) => point.time > time);
    const value = time < previous.time || previous.hold || !next
      ? previous.value
      : previous.value + (next.value - previous.value) * (time - previous.time) / (next.time - previous.time);
    return { ...previous, time: time - from, value, hold: time < previous.time || previous.hold };
  };
  return {
    ...lane,
    // The endpoint keeps a ramp aimed at its original value, even when its next point is outside.
    points: [at(from), ...points.filter((p) => p.time > from && p.time < to).map((p) => ({ ...p, time: p.time - from })), at(to)],
  };
}

/** The arrangement as if it began at fromBeat and ended at toBeat; identities stay intact. */
export function slicePiece(piece: Piece, fromBeat: number, toBeat: number): Piece {
  if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat) || fromBeat < 0 || toBeat <= fromBeat || toBeat > piece.length) {
    throw new Error('A piece slice must be a nonempty range within the piece.');
  }
  const tempoPoints = piece.transport.tempoPoints
    ? sliceLane(piece.transport.tempoPoints, fromBeat, toBeat, piece.transport.tempo)
    : null;
  return {
    ...piece,
    length: toBeat - fromBeat,
    markers: [],
    transport: { ...piece.transport, tempo: tempoPoints?.points[0]?.value ?? piece.transport.tempo, tempoPoints },
    tracks: piece.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.time < toBeat && clip.time + clip.duration > fromBeat).map((clip) => {
        const start = Math.max(clip.time, fromBeat);
        return {
          ...clip,
          time: start - fromBeat,
          duration: Math.min(clip.time + clip.duration, toBeat) - start,
          notes: clip.notes.filter((note) => note.start >= fromBeat && note.start < toBeat).map((note) => ({
            ...note, start: note.start - fromBeat, time: note.start - start,
          })),
          lanes: clip.lanes.map((lane) => sliceLane(lane, fromBeat, toBeat)),
        };
      }),
    })),
  };
}
