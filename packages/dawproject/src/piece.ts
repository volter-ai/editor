/**
 * THE PIECE, READ: a mounted graph ({@link DawNode}) as the arrangement a DAW shows. Tracks
 * with their channel, devices and clips; clips with their notes; transport and markers. Times
 * stay in beats; a note's `start` is its clip's `time` plus its own.
 *
 * Nothing here decides what may be edited. A node carries the source element it came from
 * (`oid`); whether a given prop of that element is a literal the editor may write is the
 * source's answer, read at the element (the editor's source index), never guessed here. The one
 * fact the graph itself knows is REPETITION: when one source element rendered several nodes
 * (a `.map()`, a loop, a component used twice), those nodes share an oid, and no single one of
 * them is that element's own.
 */

import type { DawNode } from './render';

export interface PieceTransport {
  readonly tempo: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly oid: string | null;
}

export interface PieceNote {
  readonly id: string;
  readonly oid: string | null;
  /** Absolute start in beats (clip time + note time). */
  readonly start: number;
  /** The note's own `time`, relative to its clip. */
  readonly time: number;
  readonly duration: number;
  readonly pitch: number;
  readonly vel: number;
}

export interface PieceClip {
  readonly id: string;
  readonly oid: string | null;
  readonly name: string | null;
  readonly time: number;
  readonly duration: number;
  readonly notes: readonly PieceNote[];
}

export interface PieceDevice {
  readonly id: string;
  readonly oid: string | null;
  readonly plugin: string;
  readonly name: string | null;
  readonly params: Readonly<Record<string, number | string | boolean>>;
}

export interface PieceChannel {
  readonly oid: string | null;
  readonly volume: number;
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
  readonly devices: readonly PieceDevice[];
}

export interface PieceTrack {
  readonly id: string;
  readonly oid: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly channel: PieceChannel | null;
  readonly clips: readonly PieceClip[];
}

export interface PieceMarker {
  readonly id: string;
  readonly oid: string | null;
  readonly time: number;
  readonly name: string;
}

export interface Piece {
  readonly transport: PieceTransport;
  readonly tracks: readonly PieceTrack[];
  readonly markers: readonly PieceMarker[];
  /** The last beat any clip reaches. */
  readonly length: number;
  /** How many nodes each oid rendered; above 1 means the element repeats. */
  readonly oidCounts: ReadonlyMap<string, number>;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function countOids(node: DawNode, counts: Map<string, number>): void {
  if (node.oid) counts.set(node.oid, (counts.get(node.oid) ?? 0) + 1);
  for (const child of node.children) countOids(child, counts);
}

/** Read a mounted graph as a piece. Refuses a root that is not a `<Project>`. */
export function readPiece(root: DawNode): Piece {
  if (root.type !== 'Project') throw new Error(`A piece's root is <Project>; this one is <${root.type}>.`);
  const oidCounts = new Map<string, number>();
  countOids(root, oidCounts);
  let transport: PieceTransport = { tempo: 120, numerator: 4, denominator: 4, oid: null };
  const tracks: PieceTrack[] = [];
  const markers: PieceMarker[] = [];
  let length = 0;
  root.children.forEach((node, index) => {
    if (node.type === 'Transport') {
      transport = {
        tempo: num(node.props['tempo'], 120),
        numerator: num(node.props['numerator'], 4),
        denominator: num(node.props['denominator'], 4),
        oid: node.oid,
      };
    } else if (node.type === 'Marker') {
      markers.push({ id: `marker:${index}`, oid: node.oid, time: num(node.props['time'], 0), name: str(node.props['name']) ?? '' });
    } else if (node.type === 'Track') {
      const trackId = `track:${index}`;
      let channel: PieceChannel | null = null;
      const clips: PieceClip[] = [];
      node.children.forEach((child, childIndex) => {
        if (child.type === 'Channel') {
          channel = {
            oid: child.oid,
            volume: num(child.props['volume'], 0),
            pan: num(child.props['pan'], 0),
            mute: bool(child.props['mute']),
            solo: bool(child.props['solo']),
            devices: child.children
              .filter((device) => device.type === 'Device')
              .map((device, deviceIndex) => ({
                id: `${trackId}:device:${deviceIndex}`,
                oid: device.oid,
                plugin: str(device.props['plugin']) ?? '',
                name: str(device.props['name']),
                params: (device.props['params'] ?? {}) as Record<string, number | string | boolean>,
              })),
          };
        } else if (child.type === 'Clip') {
          const clipId = `${trackId}:clip:${childIndex}`;
          const time = num(child.props['time'], 0);
          const duration = num(child.props['duration'], 0);
          const notes: PieceNote[] = child.children
            .filter((note) => note.type === 'Note')
            .map((note, noteIndex) => {
              const noteTime = num(note.props['time'], 0);
              return {
                id: `${clipId}:note:${noteIndex}`,
                oid: note.oid,
                start: time + noteTime,
                time: noteTime,
                duration: num(note.props['duration'], 0),
                pitch: num(note.props['pitch'], 60),
                vel: num(note.props['vel'], 0.8),
              };
            });
          length = Math.max(length, time + duration);
          clips.push({ id: clipId, oid: child.oid, name: str(child.props['name']), time, duration, notes });
        }
      });
      tracks.push({
        id: trackId,
        oid: node.oid,
        name: str(node.props['name']) ?? `Track ${tracks.length + 1}`,
        color: str(node.props['color']),
        channel,
        clips,
      });
    }
  });
  return { transport, tracks, markers, length, oidCounts };
}

/** Seconds per beat at the piece's tempo (a constant tempo; tempo automation is not read yet). */
export function secondsPerBeat(piece: Piece): number {
  return 60 / piece.transport.tempo;
}
