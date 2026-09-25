/**
 * MUSICXML EXPORT: a piece's WRITTEN layer as a score (MusicXML 4.0, partwise), for notation
 * programs (MuseScore, Dorico, Sibelius, Finale). What is written, not what is performed: the
 * notes as the source spells them (`F#5` stays F sharp, `Bb3` stays B flat), at their written
 * positions and lengths; humanising and articulation lengths are the performance's and are not
 * here (`perform.ts`).
 *
 *   - one `<part>` per track, drum tracks left out (a pitched staff cannot show a kit);
 *   - measures from the meter, every voice of every measure filled to exactly the meter with
 *     notes and rests;
 *   - simultaneous notes of one length are a chord; notes that overlap otherwise go to a second
 *     voice;
 *   - a written length that does not fit its measure, or is not one note value, is tied: across
 *     the barline, and within the measure into the fewest note values that spell it;
 *   - the tempo (and every change of the tempo lane, `rit.`/`accel.` over a ramp) and the markers
 *     (as rehearsal marks) are directions on the first part;
 *   - articulations: staccato, staccatissimo, tenuto, accent, marcato (strong accent). `legato`
 *     is a slur a notation program draws from phrasing, so it is not exported.
 */

import { assignChannels } from '../render-offline';
import type { Piece, PieceNote, PieceTrack } from '@volter/dawproject/piece';

export interface MusicXmlOptions {
  readonly title: string;
  readonly software?: string;
}

/** A note value MusicXML names: its type, dots, and whether it is a triplet. */
interface NoteValue {
  readonly divisions: number;
  readonly type: string;
  readonly dots: number;
  readonly triplet: boolean;
  readonly cost: number;
}

const BASE_TYPES: readonly [string, number][] = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
  ['64th', 0.0625],
];

const ARTICULATION: Record<string, string> = {
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  tenuto: 'tenuto',
  accent: 'accent',
  marcato: 'strong-accent',
};

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Whole within `tolerance`: written positions carry six decimals (`4:1.333333` is a triplet). */
function isWhole(value: number, tolerance = 1e-6): boolean {
  return Math.abs(value - Math.round(value)) < tolerance;
}

/** The smallest divisions per quarter note that make every given beat count a whole number. */
function divisionsFor(beats: readonly number[]): number {
  for (let divisions = 1; divisions <= 960; divisions++) {
    if (beats.every((value) => isWhole(value * divisions, 1e-3))) return divisions;
  }
  const offender = beats.find((value) => !isWhole(value * 960, 1e-3));
  throw new Error(`A position or length of ${offender} beats is finer than 1/960 of a beat; a score cannot spell it.`);
}

function noteValues(divisions: number): NoteValue[] {
  const out: NoteValue[] = [];
  for (const [type, quarters] of BASE_TYPES) {
    let length = quarters;
    let add = quarters;
    for (let dots = 0; dots <= 2; dots++) {
      if (dots > 0) {
        add /= 2;
        length += add;
      }
      if (isWhole(length * divisions)) out.push({ divisions: Math.round(length * divisions), type, dots, triplet: false, cost: 1 + dots * 0.15 });
    }
    const triplet = (quarters * 2) / 3;
    if (isWhole(triplet * divisions)) out.push({ divisions: Math.round(triplet * divisions), type, dots: 0, triplet: true, cost: 1.6 });
  }
  return out;
}

/** The fewest note values (plain before dotted before triplet) that sum to `length` divisions. */
function spell(length: number, values: readonly NoteValue[], cache: Map<number, NoteValue[] | null>): NoteValue[] | null {
  if (cache.has(length)) return cache.get(length) ?? null;
  const best: { cost: number; from: NoteValue | null }[] = [{ cost: 0, from: null }];
  for (let total = 1; total <= length; total++) {
    let cell = { cost: Number.POSITIVE_INFINITY, from: null as NoteValue | null };
    for (const value of values) {
      if (value.divisions > total) continue;
      const before = best[total - value.divisions]!;
      if (before.cost + value.cost < cell.cost) cell = { cost: before.cost + value.cost, from: value };
    }
    best.push(cell);
  }
  if (!Number.isFinite(best[length]!.cost)) {
    cache.set(length, null);
    return null;
  }
  const out: NoteValue[] = [];
  for (let total = length; total > 0; ) {
    const value = best[total]!.from!;
    out.push(value);
    total -= value.divisions;
  }
  out.sort((a, b) => b.divisions - a.divisions);
  cache.set(length, out);
  return out;
}

interface WrittenPitch {
  readonly step: string;
  readonly alter: number;
  readonly octave: number;
  readonly midi: number;
  readonly artic: string | null;
}

function writtenPitch(note: PieceNote): WrittenPitch {
  const match = /^([A-Ga-g])(##|bb|#|b)?(-?\d)$/.exec(note.written.pitch.trim());
  if (!match) throw new Error(`Not a note name: "${note.written.pitch}"`);
  const [, letter = 'C', accidental = '', octave = '4'] = match;
  const alter = accidental === '#' ? 1 : accidental === '##' ? 2 : accidental === 'b' ? -1 : accidental === 'bb' ? -2 : 0;
  return { step: letter.toUpperCase(), alter, octave: Number(octave), midi: note.pitch, artic: note.artic };
}

/** A span of one voice: a chord (pitches) or a rest (none), in divisions from the piece's start. */
interface VoiceEvent {
  readonly start: number;
  readonly end: number;
  readonly pitches: readonly WrittenPitch[];
}

/** Chords (same start, same length) laid into voices: each goes to the first voice free at its start. */
function voicesOf(track: PieceTrack, divisions: number): VoiceEvent[][] {
  const chords = new Map<string, { start: number; end: number; pitches: WrittenPitch[] }>();
  for (const note of track.clips.flatMap((clip) => clip.notes)) {
    const start = Math.round(note.start * divisions);
    const end = Math.round((note.start + note.duration) * divisions);
    const key = `${start}:${end}`;
    const chord = chords.get(key) ?? { start, end, pitches: [] };
    if (!chord.pitches.some((pitch) => pitch.midi === note.pitch)) chord.pitches.push(writtenPitch(note));
    chords.set(key, chord);
  }
  const voices: VoiceEvent[][] = [];
  for (const chord of [...chords.values()].sort((a, b) => a.start - b.start || b.end - a.end)) {
    chord.pitches.sort((a, b) => a.midi - b.midi);
    let voice = voices.find((events) => (events[events.length - 1]?.end ?? 0) <= chord.start);
    if (!voice) {
      voice = [];
      voices.push(voice);
    }
    voice.push(chord);
  }
  return voices;
}

interface Direction {
  readonly time: number;
  readonly xml: string;
}

function tempoDirection(bpm: number): string {
  const rounded = Math.round(bpm * 100) / 100;
  return `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${rounded}</per-minute></metronome></direction-type>__OFFSET__<sound tempo="${rounded}"/>`;
}

function directionsOf(piece: Piece, divisions: number): Direction[] {
  const out: Direction[] = [{ time: 0, xml: tempoDirection(piece.transport.tempo) }];
  const points = [...(piece.transport.tempoPoints?.points ?? [])].sort((a, b) => a.time - b.time);
  let current = piece.transport.tempo;
  points.forEach((point, index) => {
    const time = Math.round(point.time * divisions);
    if (Math.abs(point.value - current) > 1e-9) {
      out.push({ time, xml: tempoDirection(point.value) });
      current = point.value;
    }
    const next = points[index + 1];
    if (next && !point.hold && Math.abs(next.value - point.value) > 1e-9) {
      out.push({ time, xml: `<direction-type><words>${next.value < point.value ? 'rit.' : 'accel.'}</words></direction-type>__OFFSET__` });
    }
  });
  for (const marker of piece.markers) {
    out.push({ time: Math.round(marker.time * divisions), xml: `<direction-type><rehearsal>${escape(marker.name)}</rehearsal></direction-type>__OFFSET__` });
  }
  return out.sort((a, b) => a.time - b.time);
}

function noteXml(
  pitch: WrittenPitch | null,
  value: NoteValue,
  voice: number,
  options: { chord: boolean; tieStop: boolean; tieStart: boolean; articulate: boolean; measureRest?: number },
): string {
  const parts: string[] = ['<note>'];
  if (options.chord) parts.push('<chord/>');
  if (pitch) {
    parts.push(`<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`);
  } else {
    parts.push(options.measureRest !== undefined ? '<rest measure="yes"/>' : '<rest/>');
  }
  parts.push(`<duration>${options.measureRest ?? value.divisions}</duration>`);
  if (pitch && options.tieStop) parts.push('<tie type="stop"/>');
  if (pitch && options.tieStart) parts.push('<tie type="start"/>');
  parts.push(`<voice>${voice}</voice>`);
  if (options.measureRest === undefined) {
    parts.push(`<type>${value.type}</type>`);
    for (let i = 0; i < value.dots; i++) parts.push('<dot/>');
    if (value.triplet) parts.push('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  }
  const notations: string[] = [];
  if (pitch && options.tieStop) notations.push('<tied type="stop"/>');
  if (pitch && options.tieStart) notations.push('<tied type="start"/>');
  const articulation = pitch?.artic ? ARTICULATION[pitch.artic] : undefined;
  if (articulation && options.articulate) notations.push(`<articulations><${articulation}/></articulations>`);
  if (notations.length > 0) parts.push(`<notations>${notations.join('')}</notations>`);
  parts.push('</note>');
  return parts.join('');
}

/** The piece's written layer as a MusicXML 4.0 partwise document. */
export function pieceToMusicXml(piece: Piece, options: MusicXmlOptions): string {
  const assignments = assignChannels(piece);
  const tracks = piece.tracks.filter((track) => {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    return device?.params['drums'] !== true && track.clips.some((clip) => clip.notes.length > 0);
  });
  const { beatsPerBar, numerator, denominator } = piece.transport;
  const allNotes = tracks.flatMap((track) => track.clips.flatMap((clip) => clip.notes));
  const divisions = divisionsFor([
    beatsPerBar,
    ...allNotes.flatMap((note) => [note.start, note.duration]),
    ...(piece.transport.tempoPoints?.points.map((point) => point.time) ?? []),
    ...piece.markers.map((marker) => marker.time),
  ]);
  const measure = Math.round(beatsPerBar * divisions);
  const values = noteValues(divisions);
  const cache = new Map<number, NoteValue[] | null>();
  const lastBeat = Math.max(piece.length, ...allNotes.map((note) => note.start + note.duration));
  const measures = Math.max(1, Math.ceil(lastBeat / beatsPerBar - 1e-9));
  const directions = directionsOf(piece, divisions);

  const spellOrThrow = (length: number, where: string): NoteValue[] => {
    const spelled = spell(length, values, cache);
    if (!spelled) throw new Error(`${where}: ${length / divisions} beats cannot be spelled in note values.`);
    return spelled;
  };

  const partList: string[] = [];
  const parts: string[] = [];
  tracks.forEach((track, index) => {
    const id = `P${index + 1}`;
    const assignment = assignments.get(track.id);
    const pan = Math.round((track.channel?.pan ?? 0) * 90);
    partList.push(
      [
        `<score-part id="${id}">`,
        `<part-name>${escape(track.name)}</part-name>`,
        `<score-instrument id="${id}-I1"><instrument-name>${escape(track.name)}</instrument-name></score-instrument>`,
        assignment
          ? `<midi-instrument id="${id}-I1"><midi-channel>${assignment.channel + 1}</midi-channel><midi-program>${assignment.program + 1}</midi-program><pan>${pan}</pan></midi-instrument>`
          : '',
        '</score-part>',
      ].join(''),
    );
    const voices = voicesOf(track, divisions);
    const pitches = allNotesOf(track)
      .map((note) => note.pitch)
      .sort((a, b) => a - b);
    const median = pitches[Math.floor(pitches.length / 2)] ?? 60;
    const clef = median >= 60 ? '<clef><sign>G</sign><line>2</line></clef>' : '<clef><sign>F</sign><line>4</line></clef>';
    const body: string[] = [`<part id="${id}">`];
    for (let m = 0; m < measures; m++) {
      const from = m * measure;
      const to = from + measure;
      const content: string[] = [];
      if (m === 0) {
        content.push(`<attributes><divisions>${divisions}</divisions><time><beats>${numerator}</beats><beat-type>${denominator}</beat-type></time>${clef}</attributes>`);
      }
      if (index === 0) {
        for (const direction of directions) {
          if (direction.time < from || direction.time >= to) continue;
          const offset = direction.time - from;
          content.push(`<direction placement="above">${direction.xml.replace('__OFFSET__', offset > 0 ? `<offset>${offset}</offset>` : '')}</direction>`);
        }
      }
      let wroteVoice = false;
      voices.forEach((events, voiceIndex) => {
        const voice = voiceIndex + 1;
        const inside = events.filter((event) => event.end > from && event.start < to);
        if (inside.length === 0 && voice > 1) return;
        if (wroteVoice) content.push(`<backup><duration>${measure}</duration></backup>`);
        wroteVoice = true;
        if (inside.length === 0) {
          content.push(noteXml(null, values[0]!, voice, { chord: false, tieStop: false, tieStart: false, articulate: false, measureRest: measure }));
          return;
        }
        let cursor = from;
        const rest = (until: number): void => {
          if (until <= cursor) return;
          for (const value of spellOrThrow(until - cursor, `${track.name}, measure ${m + 1}`)) {
            content.push(noteXml(null, value, voice, { chord: false, tieStop: false, tieStart: false, articulate: false }));
          }
          cursor = until;
        };
        for (const event of inside) {
          const start = Math.max(event.start, from);
          const end = Math.min(event.end, to);
          rest(start);
          const pieces = spellOrThrow(end - start, `${track.name}, measure ${m + 1}`);
          pieces.forEach((value, pieceIndex) => {
            const tieStop = pieceIndex > 0 || start > event.start;
            const tieStart = pieceIndex < pieces.length - 1 || end < event.end;
            event.pitches.forEach((pitch, pitchIndex) => {
              content.push(noteXml(pitch, value, voice, { chord: pitchIndex > 0, tieStop, tieStart, articulate: !tieStop }));
            });
          });
          cursor = end;
        }
        rest(to);
      });
      if (!wroteVoice) {
        content.push(noteXml(null, values[0]!, 1, { chord: false, tieStop: false, tieStart: false, articulate: false, measureRest: measure }));
      }
      body.push(`<measure number="${m + 1}">`, ...content, '</measure>');
    }
    body.push('</part>');
    parts.push(body.join('\n'));
  });

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${escape(options.title)}</work-title></work>`,
    `<identification><encoding><software>${escape(options.software ?? 'Volter Editor')}</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>`,
    `<part-list>${partList.join('')}</part-list>`,
    ...parts,
    '</score-partwise>',
    '',
  ].join('\n');
}

function allNotesOf(track: PieceTrack): PieceNote[] {
  return track.clips.flatMap((clip) => clip.notes);
}
