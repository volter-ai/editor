/**
 * What a piece's notes add up to, read the way a composer reads a score, for an author who cannot
 * listen: the key of each section, the chord each half bar implies and its degree, the cadence
 * each section ends on and the one it loops back through, voicing that muddies or crosses, and
 * each melodic line's shape: its range, its steps and leaps, how much it repeats itself, and how
 * much of it another piece of the project already says.
 *
 * Nothing here is a rule the piece breaks (`checks.ts` holds those); it is the numbers a
 * revision is judged by. Keys use the Krumhansl–Kessler profiles; a chord is the triad or seventh
 * whose tones carry most of the window's sounding duration, preferring the one rooted on the bass.
 */

import { formatPitch } from '@volter/dawproject/notation';
import type { Piece } from '@volter/dawproject/piece';

const EPSILON = 1e-9;

interface Sounding {
  readonly start: number;
  readonly duration: number;
  readonly pitch: number;
}

interface Part {
  readonly name: string;
  readonly notes: readonly Sounding[];
}

export interface Key {
  readonly tonic: number;
  readonly minor: boolean;
  /** The profile's correlation with the section's pitch classes, −1…1. */
  readonly fit: number;
}

export interface Chord {
  readonly root: number;
  readonly quality: Quality;
  /** The bass's pitch class when it is a chord tone other than the root. */
  readonly bass: number | null;
}

type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'sus4' | '7' | 'maj7' | 'm7' | 'm7b5';

const QUALITIES: readonly (readonly [Quality, readonly number[]])[] = [
  ['maj', [0, 4, 7]], ['min', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus4', [0, 5, 7]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['m7b5', [0, 3, 6, 10]],
];
const SUFFIX: Record<Quality, string> = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus4', '7': '7', maj7: 'maj7', m7: 'm7', m7b5: 'm7b5' };
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const DEGREES = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
/** Keys spelled with flats: F and the flat majors, and their relative minors. */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1, 6]);

export interface SectionAnalysis {
  readonly name: string;
  /** From beat, to beat. */
  readonly span: readonly [number, number];
  readonly key: Key;
  /** Per bar: its half-bar chords (one when both halves imply the same), null where nothing sounds. */
  readonly bars: readonly { readonly bar: number; readonly chords: readonly (Chord | null)[] }[];
  /** The last two different chords, and the chord the loop returns to. */
  readonly cadence: { readonly from: Chord | null; readonly to: Chord | null; readonly kind: string };
  readonly seam: { readonly from: Chord | null; readonly to: Chord | null; readonly kind: string };
}

export interface LineAnalysis {
  readonly name: string;
  readonly notes: number;
  readonly low: number;
  readonly high: number;
  /** Shares of the melodic intervals: steps (≤ 2 semitones), leaps (≥ 5). */
  readonly steps: number;
  readonly leaps: number;
  readonly largestLeap: { readonly semitones: number; readonly beat: number } | null;
  /** Share of its sounding bars that repeat an earlier bar exactly, and transposed. */
  readonly repeatedBars: number;
  readonly sequencedBars: number;
  /** Distinct 4-interval figures over all of them: 1 never repeats a figure. */
  readonly variety: number;
}

export interface VoicingAnalysis {
  /** Two notes closer than a fifth (not a unison or octave) with the upper below C3: they muddy. */
  readonly lowCloseIntervals: readonly { readonly beat: number; readonly pitches: readonly [number, number]; readonly parts: string }[];
  /** A lower part sounding above a higher one, as runs. */
  readonly crossings: readonly { readonly upper: string; readonly lower: string; readonly runs: number; readonly first: number }[];
}

export interface PieceAnalysis {
  readonly key: Key;
  readonly sections: readonly SectionAnalysis[];
  readonly lines: readonly LineAnalysis[];
  readonly voicing: VoicingAnalysis;
}

function parts(piece: Piece): Part[] {
  return piece.tracks
    .filter((track) => !track.channel?.devices.some((device) => device.plugin === 'soundfont' && device.params['drums'] === true))
    .map((track) => ({ name: track.name, notes: track.clips.flatMap((clip) => clip.notes.map(({ start, duration, pitch }) => ({ start, duration, pitch }))) }))
    .filter((part) => part.notes.length > 0);
}

/** Duration-weighted pitch classes of the notes sounding in [from, to). */
function histogram(notes: readonly Sounding[], from: number, to: number): number[] {
  const weights = new Array<number>(12).fill(0);
  for (const note of notes) {
    const overlap = Math.min(to, note.start + note.duration) - Math.max(from, note.start);
    if (overlap > EPSILON) weights[note.pitch % 12]! += overlap;
  }
  return weights;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function estimateKey(weights: readonly number[]): Key {
  let best: Key = { tonic: 0, minor: false, fit: -1 };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weights.map((_, pc) => weights[(pc + tonic) % 12]!);
    for (const minor of [false, true]) {
      const fit = correlation(rotated, minor ? MINOR_PROFILE : MAJOR_PROFILE);
      if (fit > best.fit) best = { tonic, minor, fit };
    }
  }
  return best;
}

function chordOf(notes: readonly Sounding[], from: number, to: number): Chord | null {
  const weights = histogram(notes, from, to);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return null;
  const inWindow = notes.filter((note) => note.start < to - EPSILON && note.start + note.duration > from + EPSILON);
  const bassPc = Math.min(...inWindow.map((note) => note.pitch)) % 12;
  let best: { chord: Chord; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [quality, intervals] of QUALITIES) {
      const tones = intervals.map((interval) => (root + interval) % 12);
      const matched = tones.reduce((sum, pc) => sum + weights[pc]!, 0) / total;
      const missing = tones.filter((pc) => weights[pc]! < 0.05 * total).length;
      const score = matched - 0.12 * missing - (tones.length === 4 ? 0.03 : 0) - (quality === 'aug' || quality === 'sus4' ? 0.02 : 0) + (root === bassPc ? 0.08 : 0);
      if (!best || score > best.score + EPSILON) {
        best = { chord: { root, quality, bass: bassPc !== root && tones.includes(bassPc) ? bassPc : null }, score };
      }
    }
  }
  return best!.chord;
}

function sameChord(a: Chord | null, b: Chord | null): boolean {
  return a === b || (a !== null && b !== null && a.root === b.root && a.quality === b.quality && a.bass === b.bass);
}

/** The same harmony, whatever its inversion. */
function sameHarmony(a: Chord | null, b: Chord | null): boolean {
  return a === b || (a !== null && b !== null && a.root === b.root && a.quality === b.quality);
}

function pcName(pc: number, flats: boolean): string {
  return formatPitch(60 + pc, flats).replace(/-?\d+$/, '');
}

export function keyName(key: Key): string {
  return `${pcName(key.tonic, flatKey(key))} ${key.minor ? 'minor' : 'major'}`;
}

function flatKey(key: Key): boolean {
  return FLAT_MAJORS.has(key.minor ? (key.tonic + 3) % 12 : key.tonic);
}

export function chordName(chord: Chord | null, key: Key): string {
  if (!chord) return '—';
  const flats = flatKey(key);
  return `${pcName(chord.root, flats)}${SUFFIX[chord.quality]}${chord.bass === null ? '' : `/${pcName(chord.bass, flats)}`}`;
}

export function romanNumeral(chord: Chord | null, key: Key): string {
  if (!chord) return '—';
  const degree = DEGREES[(chord.root - key.tonic + 12) % 12]!;
  const minorish = chord.quality === 'min' || chord.quality === 'm7' || chord.quality === 'dim' || chord.quality === 'm7b5';
  const numeral = minorish ? degree.toLowerCase() : degree;
  const mark = chord.quality === 'dim' ? '°' : chord.quality === 'm7b5' ? 'ø7' : chord.quality === 'aug' ? '+' : chord.quality === 'sus4' ? 'sus4' : chord.quality === '7' || chord.quality === 'm7' ? '7' : chord.quality === 'maj7' ? 'maj7' : '';
  return `${numeral}${mark}`;
}

/** How a progression from one chord to the next closes, in a key. */
export function cadenceKind(from: Chord | null, to: Chord | null, key: Key): string {
  if (!to) return 'silence';
  const degree = (chord: Chord): number => (chord.root - key.tonic + 12) % 12;
  const home = degree(to) === 0;
  if (!from) return home ? 'on the tonic' : 'open';
  const before = degree(from);
  const dominant = before === 7 && (from.quality === 'maj' || from.quality === '7');
  if (home && dominant) return 'authentic (V–I)';
  if (home && before === 11 && (from.quality === 'dim' || from.quality === 'm7b5')) return 'authentic (vii°–I)';
  if (home && before === 5) return 'plagal (IV–I)';
  if (home) return 'to the tonic';
  if (degree(to) === 7) return 'half (to V)';
  if (dominant && degree(to) === (key.minor ? 8 : 9)) return 'deceptive';
  return 'open';
}

/** The analysis; `others` (other pieces of the project, by name) are what novelty is measured against. */
export function analyzePiece(piece: Piece, others: ReadonlyMap<string, Piece> = new Map()): PieceAnalysis & { readonly novelty: readonly { readonly piece: string; readonly shared: number }[] } {
  const { beatsPerBar } = piece.transport;
  const all = parts(piece);
  const notes = all.flatMap((part) => part.notes);
  const key = estimateKey(histogram(notes, 0, piece.length));
  const window = beatsPerBar >= 4 && beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;

  const markers = [...piece.markers].sort((a, b) => a.time - b.time).filter((marker, i, list) => marker.time < piece.length - EPSILON && (i === 0 || marker.time > list[i - 1]!.time + EPSILON));
  const spans: { name: string; from: number; to: number }[] = [];
  if (markers.length === 0 || markers[0]!.time > EPSILON) spans.push({ name: markers.length === 0 ? 'Piece' : '(before the first marker)', from: 0, to: markers[0]?.time ?? piece.length });
  markers.forEach((marker, i) => spans.push({ name: marker.name, from: marker.time, to: markers[i + 1]?.time ?? piece.length }));

  const sections = spans.map(({ name, from, to }): SectionAnalysis => {
    const sectionKey = estimateKey(histogram(notes, from, to));
    const bars: { bar: number; chords: (Chord | null)[] }[] = [];
    const sequence: (Chord | null)[] = [];
    for (let barStart = Math.floor(from / beatsPerBar) * beatsPerBar; barStart < to - EPSILON; barStart += beatsPerBar) {
      const chords: (Chord | null)[] = [];
      for (let at = Math.max(barStart, from); at < Math.min(barStart + beatsPerBar, to) - EPSILON; at += window) {
        chords.push(chordOf(notes, at, Math.min(at + window, to)));
      }
      sequence.push(...chords);
      bars.push({ bar: barStart / beatsPerBar + 1, chords: chords.length === 2 && sameChord(chords[0]!, chords[1]!) ? [chords[0]!] : chords });
    }
    // Harmonic changes, an inversion of the same chord is not one.
    const distinct = sequence.filter((chord, i) => chord && (i === 0 || !sameHarmony(chord, sequence[i - 1]!)));
    const last = distinct[distinct.length - 1] ?? null;
    const previous = distinct[distinct.length - 2] ?? null;
    const first = sequence.find((chord) => chord) ?? null;
    return {
      name,
      span: [from, to],
      key: sectionKey,
      bars,
      cadence: { from: previous, to: last, kind: cadenceKind(previous, last, sectionKey) },
      seam: { from: last, to: first, kind: sameHarmony(last, first) ? 'holds' : cadenceKind(last, first, sectionKey) },
    };
  });

  const lines = all.filter(isLine).map((part) => lineAnalysis(part, beatsPerBar));
  const novelty = [...others].map(([name, other]) => ({ piece: name, shared: sharedFigures(piece, other) })).sort((a, b) => b.shared - a.shared);
  return { key, sections, lines, voicing: voicing(all, piece.length), novelty };
}

/** A melodic line: one note at a time at nearly every onset. */
function isLine(part: Part): boolean {
  const onsets = [...new Set(part.notes.map((note) => note.start))];
  const single = onsets.filter((onset) => part.notes.filter((note) => note.start <= onset + EPSILON && note.start + note.duration > onset + EPSILON).length === 1).length;
  return onsets.length >= 4 && single / onsets.length >= 0.9;
}

function melody(part: Part): Sounding[] {
  return [...part.notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch).filter((note, i, list) => i === 0 || note.start > list[i - 1]!.start + EPSILON);
}

function figures(line: readonly Sounding[]): string[] {
  const intervals = line.slice(1).map((note, i) => note.pitch - line[i]!.pitch);
  return intervals.slice(3).map((_, i) => intervals.slice(i, i + 4).join(','));
}

function lineAnalysis(part: Part, beatsPerBar: number): LineAnalysis {
  const line = melody(part);
  const intervals = line.slice(1).map((note, i) => ({ semitones: Math.abs(note.pitch - line[i]!.pitch), beat: note.start }));
  const largest = intervals.reduce<(typeof intervals)[number] | null>((best, interval) => (!best || interval.semitones > best.semitones ? interval : best), null);
  const byBar = new Map<number, Sounding[]>();
  for (const note of line) {
    const bar = Math.floor(note.start / beatsPerBar + EPSILON);
    byBar.set(bar, [...(byBar.get(bar) ?? []), note]);
  }
  const exact = new Set<string>();
  const shape = new Set<string>();
  let repeated = 0;
  let sequenced = 0;
  for (const [bar, barNotes] of [...byBar].sort((a, b) => a[0] - b[0])) {
    const rhythm = barNotes.map((note) => `${Math.round((note.start - bar * beatsPerBar) * 48)}:${Math.round(note.duration * 48)}`);
    const signature = barNotes.map((note, i) => `${rhythm[i]}@${note.pitch}`).join(' ');
    const relative = barNotes.map((note, i) => `${rhythm[i]}@${note.pitch - barNotes[0]!.pitch}`).join(' ');
    if (exact.has(signature)) repeated++;
    else if (shape.has(relative)) sequenced++;
    exact.add(signature);
    shape.add(relative);
  }
  const all = figures(line);
  const count = Math.max(1, intervals.length);
  return {
    name: part.name,
    notes: line.length,
    low: Math.min(...line.map((note) => note.pitch)),
    high: Math.max(...line.map((note) => note.pitch)),
    steps: intervals.filter((interval) => interval.semitones <= 2).length / count,
    leaps: intervals.filter((interval) => interval.semitones >= 5).length / count,
    largestLeap: largest,
    repeatedBars: byBar.size ? repeated / byBar.size : 0,
    sequencedBars: byBar.size ? sequenced / byBar.size : 0,
    variety: all.length ? new Set(all).size / all.length : 1,
  };
}

/** The share of this piece's melodic figures (4 intervals, any transposition) the other piece also has. */
function sharedFigures(piece: Piece, other: Piece): number {
  const of = (subject: Piece): Set<string> => new Set(parts(subject).filter(isLine).flatMap((part) => figures(melody(part))));
  const mine = of(piece);
  const theirs = of(other);
  if (mine.size === 0) return 0;
  return [...mine].filter((figure) => theirs.has(figure)).length / mine.size;
}

function voicing(all: readonly Part[], length: number): VoicingAnalysis {
  const lowCloseIntervals: { beat: number; pitches: [number, number]; parts: string }[] = [];
  const seen = new Set<string>();
  const median = (part: Part): number => {
    const pitches = part.notes.map((note) => note.pitch).sort((a, b) => a - b);
    return pitches[Math.floor(pitches.length / 2)]!;
  };
  const ordered = [...all].sort((a, b) => median(b) - median(a));
  const crossings = new Map<string, { upper: string; lower: string; runs: number; first: number; open: boolean }>();
  const soundingAt = (part: Part, beat: number): number[] =>
    part.notes.filter((note) => note.start <= beat + EPSILON && beat < note.start + note.duration - EPSILON).map((note) => note.pitch);
  for (let beat = 0; beat < length; beat += 0.5) {
    const now = all.flatMap((part) => soundingAt(part, beat).map((pitch) => ({ pitch, part: part.name }))).sort((a, b) => a.pitch - b.pitch);
    for (let i = 1; i < now.length; i++) {
      const [a, b] = [now[i - 1]!, now[i]!];
      const interval = b.pitch - a.pitch;
      if (b.pitch < 48 && interval > 0 && interval < 7) {
        const id = `${a.pitch}:${b.pitch}:${a.part}:${b.part}`;
        const struck = all.some((part) => part.notes.some((note) => Math.abs(note.start - beat) < EPSILON && (note.pitch === a.pitch || note.pitch === b.pitch)));
        if (struck && !seen.has(`${id}@${beat}`)) {
          seen.add(`${id}@${beat}`);
          lowCloseIntervals.push({ beat, pitches: [a.pitch, b.pitch], parts: a.part === b.part ? a.part : `${a.part}+${b.part}` });
        }
      }
    }
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const upper = soundingAt(ordered[i]!, beat);
        const lower = soundingAt(ordered[j]!, beat);
        const id = `${ordered[i]!.name}>${ordered[j]!.name}`;
        const entry = crossings.get(id) ?? { upper: ordered[i]!.name, lower: ordered[j]!.name, runs: 0, first: -1, open: false };
        const crossed = upper.length > 0 && lower.length > 0 && Math.max(...lower) > Math.max(...upper);
        if (crossed && !entry.open) {
          entry.runs++;
          if (entry.first < 0) entry.first = beat;
        }
        entry.open = crossed;
        crossings.set(id, entry);
      }
    }
  }
  return {
    lowCloseIntervals,
    crossings: [...crossings.values()].filter((entry) => entry.runs > 0).map(({ upper, lower, runs, first }) => ({ upper, lower, runs, first })),
  };
}
