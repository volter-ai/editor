/**
 * NOTE RECORDING: what a person plays while Record runs, from a MIDI controller (Web MIDI) or the
 * computer keyboard, captured against the playhead and written into the piece when it stops.
 *
 * The computer keyboard is laid out as Bitwig's and Ableton's: the home row is the white keys
 * from C (A S D F G H J K L), the row above the black ones (W E T Y U O), Z and X shift an octave.
 * Times are kept at MIDI's 480 ticks a beat, as played (quantizing is a later, undoable gesture).
 *
 * The take is ONE whole-file edit and ONE undo entry: its notes go into the literal clip on the
 * track that holds all of them, or into a new clip named "take" over the bars they span.
 */

import { formatAt, formatDuration, formatPitch } from '@volter/dawproject/notation';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import ts from 'typescript';
import { type SourceIndex } from './source-index';
import { attributeText, elementAt, elements, indentOf, insertElement, parseSource, rewriteNotes } from './source-notes';

/** Semitones above the keyboard's C for each key (`KeyboardEvent.code`). */
export const KEY_SEMITONES: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/** A played note: its pitch, velocity 0–1, and where it began and ended in beats of the piece. */
export interface TakeNote {
  readonly pitch: number;
  readonly vel: number;
  readonly start: number;
  readonly end: number;
}

const TICKS = 480;

function ticks(beats: number): number {
  return Math.round(beats * TICKS) / TICKS;
}

/** `<Note … />` for a played note, at the take's resolution. */
function noteText(note: TakeNote, beatsPerBar: number): string {
  const start = ticks(note.start);
  const duration = Math.max(1 / TICKS, ticks(note.end) - start);
  return `<Note ${[
    attributeText('at', formatAt(start, beatsPerBar)),
    attributeText('pitch', formatPitch(note.pitch)),
    attributeText('dur', formatDuration(duration)),
    attributeText('vel', Math.round(note.vel * 100) / 100),
  ].join(' ')} />`;
}

/**
 * The source with a take's notes written on `track`: into its literal clip that spans them all,
 * else into a new `<Clip name="take">` over their bars, after the clip before it (or the
 * channel). Throws, naming why, when there is no single literal place for them.
 */
export function writeTake(source: string, pieceFile: string, piece: Piece, track: PieceTrack, index: SourceIndex, notes: readonly TakeNote[]): string {
  const beatsPerBar = piece.transport.beatsPerBar;
  const from = Math.min(...notes.map((note) => note.start));
  const to = Math.max(...notes.map((note) => note.end));
  const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;
  const inserts = notes.map((note) => ({ start: ticks(note.start), text: noteText(note, beatsPerBar) }));
  const holding = track.clips.find((clip) => clip.time <= from + 1e-9 && clip.time + clip.duration >= to - 1e-9 && own(clip.oid));
  if (holding?.oid) {
    const entry = index.get(holding.oid);
    if (!entry) throw new Error('The source index has not caught up with this clip yet; try again.');
    return rewriteNotes(source, { line: entry.line, col: entry.col }, [], inserts, beatsPerBar);
  }
  // A new clip over the bars the take spans, placed after the clip that starts before it.
  const firstBar = Math.floor(from / beatsPerBar + 1e-9);
  const bars = Math.max(1, Math.ceil(to / beatsPerBar - 1e-9) - firstBar);
  const before = track.clips.filter((clip) => clip.time <= firstBar * beatsPerBar && own(clip.oid)).at(-1);
  const anchorOid = before?.oid ?? (own(track.channel?.oid ?? null) ? track.channel!.oid : null);
  if (!anchorOid || !own(track.oid)) throw new Error(`${track.name} is generated, so a recorded clip has no single place to go.`);
  const entry = index.get(anchorOid);
  if (!entry) throw new Error('The source index has not caught up with the piece yet; try again.');
  const file = parseSource(source, pieceFile);
  const anchor = elementAt(file, entry.line, entry.col, entry.tag);
  if (!anchor) throw new Error('The source index has not caught up with the piece yet; try again.');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const indent = indentOf(source, file, anchor);
  const opening = `<Clip ${attributeText('at', formatAt(firstBar * beatsPerBar, beatsPerBar, { bar: true }))} ${attributeText('bars', bars)} ${attributeText('name', 'take')}>`;
  const withClip = insertElement(source, file, anchor, 'after', `${opening}${newline}${indent}</Clip>`);
  // The new clip is the first `<Clip name="take">` whose opening text is ours after the anchor.
  const next = parseSource(withClip, pieceFile);
  const anchorEnd = anchor.end;
  const clip = elements(next, 'Clip').find((element) => element.getStart(next) >= anchorEnd && ts.isJsxElement(element) && element.openingElement.getText(next) === opening);
  if (!clip) throw new Error('The recorded clip could not be placed; nothing was written.');
  const start = next.getLineAndCharacterOfPosition(clip.getStart(next));
  return rewriteNotes(withClip, { line: start.line + 1, col: start.character }, [], inserts, beatsPerBar);
}
