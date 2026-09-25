/**
 * THE WRITTEN UNITS a piece is authored in: positions as `bar:beat`, pitches as note names,
 * lengths as note values, meter as `n/d`. These are a composer's units and the ones a language
 * model writes with the fewest slips (a format experiment on one brief: first drafts in these
 * units carried about 17 voice-leading faults against 24–27 in beats and MIDI numbers). The
 * reader (`piece.ts`) turns them into beats and MIDI keys; the editor writes them back with
 * `formatAt`, `formatPitch` and `formatDuration`, so a gesture leaves the spelling a person reads.
 *
 * Positions are ABSOLUTE: `9:2.5` is the second half of beat 2 of bar 9 of the piece, wherever
 * the note's clip starts. A clip is a region of the arrangement, not a second bar count.
 */

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** `C4` = 60 (scientific pitch); accidentals `#`, `b`, `##`, `bb`. */
export function midiOf(name: string): number {
  const match = /^([A-Ga-g])(##|bb|#|b)?(-?\d)$/.exec(name.trim());
  if (!match) throw new Error(`Not a note name: "${name}" (write it like F#5, Bb3, C4)`);
  const [, letter = 'C', accidental = '', octave = '4'] = match;
  const shift = accidental === '#' ? 1 : accidental === '##' ? 2 : accidental === 'b' ? -1 : accidental === 'bb' ? -2 : 0;
  return (Number(octave) + 1) * 12 + (LETTER[letter.toUpperCase()] ?? 0) + shift;
}

/** A MIDI key as a note name, spelled with flats when `flats` (a key on the flat side). */
export function formatPitch(midi: number, flats = false): string {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Whether a written pitch uses a flat: a gesture keeps the spelling family it found. */
export function spelledFlat(name: string): boolean {
  return /^[A-Ga-g]b/.test(name.trim());
}

const VALUE: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 };

/**
 * A note value in quarter-note beats: `w h q 8 16 32`, a dot per `.` (`q.` = 1.5), `t` for a
 * triplet (`8t` = 1/3). A plain positive number is beats (`2.5`, for a tie across values).
 */
export function beatsOf(value: string | number): number {
  if (typeof value === 'number') {
    if (value > 0 && Number.isFinite(value)) return value;
    throw new Error(`Not a length: ${value}`);
  }
  const match = /^(w|h|q|8|16|32)(t?)(\.*)$/.exec(value.trim());
  if (!match) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
    throw new Error(`Not a note value: "${value}" (w h q 8 16 32, a dot per ".", t for triplet, or beats)`);
  }
  const [, base = 'q', triplet = '', dots = ''] = match;
  let beats = VALUE[base] ?? 1;
  if (triplet) beats = (beats * 2) / 3;
  let add = beats;
  for (let i = 0; i < dots.length; i++) {
    add /= 2;
    beats += add;
  }
  return beats;
}

/** Beats as the plainest note value that spells them exactly, else the number of beats. */
export function formatDuration(beats: number): string {
  const candidates: [string, number][] = [];
  for (const base of ['w', 'h', 'q', '8', '16', '32']) {
    for (const dots of ['', '.', '..']) {
      candidates.push([`${base}${dots}`, beatsOf(`${base}${dots}`)]);
    }
    candidates.push([`${base}t`, beatsOf(`${base}t`)]);
  }
  const exact = candidates.find(([, value]) => Math.abs(value - beats) < 1e-9);
  return exact ? exact[0] : String(Math.round(beats * 1e6) / 1e6);
}

/** Quarter-note beats per bar: `4/4` → 4, `3/4` → 3, `6/8` → 3. */
export function beatsPerBarOf(meter: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(meter.trim());
  if (!match) throw new Error(`Not a meter: "${meter}" (write it like 3/4)`);
  return (Number(match[1]) * 4) / Number(match[2]);
}

/** `bar` or `bar:beat` (1-based; the beat may be fractional) to beats from the piece's start. */
export function beatAt(position: string | number, beatsPerBar: number): number {
  const text = String(position).trim();
  const match = /^(\d+)(?::(\d+(?:\.\d+)?))?$/.exec(text);
  if (!match) throw new Error(`Not a position: "${text}" (write bar:beat, like 9:2.5)`);
  const bar = Number(match[1]);
  const beat = match[2] === undefined ? 1 : Number(match[2]);
  if (bar < 1 || beat < 1 || beat >= beatsPerBar + 1 - 1e-9) {
    throw new Error(`"${text}" is not in a ${beatsPerBar}-beat bar (bars and beats count from 1)`);
  }
  return (bar - 1) * beatsPerBar + (beat - 1);
}

/**
 * Beats from the piece's start as `bar:beat`. A note always spells its beat (`9:1`); a clip or
 * marker on a downbeat is just its bar (`bar: true` → `9`).
 */
export function formatAt(beats: number, beatsPerBar: number, options: { readonly bar?: boolean } = {}): string {
  const rounded = Math.round(beats * 1e6) / 1e6;
  const bar = Math.floor(rounded / beatsPerBar + 1e-9) + 1;
  const beat = Math.round((rounded - (bar - 1) * beatsPerBar + 1) * 1e6) / 1e6;
  return options.bar && beat === 1 ? String(bar) : `${bar}:${beat}`;
}
