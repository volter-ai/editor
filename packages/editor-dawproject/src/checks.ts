/**
 * STRUCTURAL CHECKS: the questions a composer answers by eye, answered by count, on the piece
 * exactly as it mounts. Read by `render-piece` (into `report.problems`) and by `check-piece`.
 *
 *   - notes that run outside their clip; a piece that is not whole bars
 *   - notes outside their instrument's practical range (General MIDI program → range)
 *   - parallel perfect fifths, and short runs of parallel octaves (a long run is a doubling),
 *     between the TOP line of every pair of pitched tracks,
 *     and between each track and the bass (lowest line of the lowest track), half-beat by
 *     half-beat; against a single-line bass track the pair is already the top-line pair, so it
 *     is not counted twice
 *   - the same pitch struck again in a track while it is still sounding
 *
 * It cannot tell whether the music is good; it tells where it is certainly careless.
 */

import type { Piece } from '@volter/dawproject/piece';

/** Practical ranges (MIDI), by General MIDI program. Unlisted programs are not range-checked. */
const RANGES: Record<number, readonly [number, number, string]> = {
  0: [21, 108, 'piano'], 1: [21, 108, 'piano'], 4: [28, 103, 'e.piano'], 6: [29, 89, 'harpsichord'],
  8: [60, 108, 'celesta'], 9: [79, 108, 'glockenspiel'], 10: [60, 96, 'music box'], 11: [53, 89, 'vibraphone'],
  12: [45, 96, 'marimba'], 13: [65, 108, 'xylophone'], 14: [60, 84, 'tubular bells'],
  19: [24, 96, 'organ'], 24: [40, 84, 'nylon guitar'], 25: [40, 84, 'steel guitar'],
  32: [28, 55, 'acoustic bass'], 33: [28, 60, 'electric bass'],
  40: [55, 100, 'violin'], 41: [48, 88, 'viola'], 42: [36, 76, 'cello'], 43: [28, 60, 'contrabass'],
  44: [28, 96, 'tremolo strings'], 45: [28, 96, 'pizzicato strings'], 46: [24, 103, 'harp'], 47: [40, 55, 'timpani'],
  48: [28, 96, 'string ensemble'], 49: [28, 96, 'slow strings'], 52: [48, 81, 'choir aahs'], 53: [48, 81, 'voice oohs'],
  56: [54, 84, 'trumpet'], 57: [40, 72, 'trombone'], 58: [28, 65, 'tuba'], 60: [34, 77, 'french horn'], 61: [34, 84, 'brass section'],
  68: [58, 91, 'oboe'], 69: [52, 81, 'english horn'], 70: [34, 75, 'bassoon'], 71: [50, 94, 'clarinet'],
  72: [74, 108, 'piccolo'], 73: [60, 96, 'flute'], 74: [60, 96, 'recorder'], 75: [60, 96, 'pan flute'],
  79: [60, 96, 'ocarina'],
};

const EPSILON = 1e-9;

interface Line {
  readonly name: string;
  readonly drums: boolean;
  readonly notes: readonly { readonly start: number; readonly duration: number; readonly pitch: number }[];
}

type Pick = 'top' | 'bottom';

export interface PieceChecks {
  readonly problems: readonly string[];
  /** How many of the problems are parallel fifths or octaves. */
  readonly parallels: number;
}

export function checkPiece(piece: Piece): PieceChecks {
  const { beatsPerBar } = piece.transport;
  const problems: string[] = [];
  const barBeat = (beat: number): string =>
    `bar ${Math.floor(beat / beatsPerBar + EPSILON) + 1} beat ${Math.round(((beat % beatsPerBar) + 1) * 100) / 100}`;

  const lines: Line[] = piece.tracks.map((track) => {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    return {
      name: track.name,
      drums: device?.params['drums'] === true,
      notes: track.clips.flatMap((clip) => clip.notes.map(({ start, duration, pitch }) => ({ start, duration, pitch }))),
    };
  });

  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    const program = typeof device?.params['program'] === 'number' ? device.params['program'] : null;
    const range = program === null || device?.params['drums'] === true ? undefined : RANGES[program];
    for (const clip of track.clips) {
      for (const note of clip.notes) {
        if (note.time < -EPSILON || note.time + note.duration > clip.duration + EPSILON) {
          problems.push(`${track.name}: note at ${barBeat(note.start)} runs outside its clip "${clip.name ?? 'clip'}" (${clip.duration} beats)`);
        }
        if (range && (note.pitch < range[0] || note.pitch > range[1])) {
          problems.push(`${track.name} (${range[2]}): pitch ${note.pitch} at ${barBeat(note.start)} is outside ${range[0]}–${range[1]}`);
        }
      }
    }
  }

  const bars = piece.length / beatsPerBar;
  if (Math.abs(bars - Math.round(bars)) > EPSILON) problems.push(`The piece is ${piece.length} beats: not whole ${beatsPerBar}-beat bars`);

  for (const line of lines) {
    const sorted = [...line.notes].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length && sorted[j]!.start < a.start + a.duration - EPSILON; j++) {
        if (sorted[j]!.pitch === a.pitch && sorted[j]!.start > a.start + EPSILON) {
          problems.push(`${line.name}: ${a.pitch} struck again at ${barBeat(sorted[j]!.start)} while still sounding`);
        }
      }
    }
  }

  const sounding = (line: Line, beat: number, pick: Pick): number | null => {
    const at = line.notes.filter((note) => note.start <= beat + EPSILON && beat < note.start + note.duration - EPSILON).map((note) => note.pitch);
    if (at.length === 0) return null;
    return pick === 'top' ? Math.max(...at) : Math.min(...at);
  };
  const pitched = lines.filter((line) => !line.drums && line.notes.length > 0);
  const lowest = (line: Line): number => Math.min(...line.notes.map((note) => note.pitch));
  const bassLine = [...pitched].sort((a, b) => lowest(a) - lowest(b))[0];
  const pairs: [Line, Pick, Line, Pick][] = [];
  for (let i = 0; i < pitched.length; i++) {
    for (let j = i + 1; j < pitched.length; j++) pairs.push([pitched[i]!, 'top', pitched[j]!, 'top']);
    if (bassLine && pitched[i] !== bassLine) pairs.push([pitched[i]!, 'top', bassLine, 'bottom']);
  }
  // Parallel octaves (or unisons) that go on for DOUBLING_MOVES moves or more are one part doubling
  // another (a bass doubled at the octave, a melody in octaves): orchestration, not a slip. A run
  // shorter than that is reported; parallel fifths are always reported.
  const DOUBLING_MOVES = 3;
  // A pair where the sparser part mostly sounds the other's pitch class at its own onsets is one
  // line doubled (contrabass under cello, a melody in octaves), whatever the rhythm between.
  const DOUBLING_SHARE = 0.7;
  const doubles = (x: Line, xPick: Pick, y: Line, yPick: Pick): boolean => {
    // Compared on the LINES being checked (a chord's top voice, the bass's bottom), not any note
    // of a chord: a pad always contains the bass's root, and that is not a doubling.
    const [sparse, sparsePick, dense, densePick] = x.notes.length <= y.notes.length ? [x, xPick, y, yPick] : [y, yPick, x, xPick];
    const onsets = [...new Set(sparse.notes.map((note) => note.start))];
    if (onsets.length === 0) return false;
    let shared = 0;
    for (const onset of onsets) {
      const a = sounding(sparse, onset, sparsePick);
      const b = sounding(dense, onset, densePick);
      if (a !== null && b !== null && a % 12 === b % 12) shared++;
    }
    return shared / onsets.length >= DOUBLING_SHARE;
  };
  let parallels = 0;
  for (const [upper, upperPick, lower, lowerPick] of pairs) {
    const doubling = doubles(upper, upperPick, lower, lowerPick);
    let previous: [number, number] | null = null;
    let octaveRun: string[] = [];
    const endRun = (): void => {
      if (octaveRun.length > 0 && octaveRun.length < DOUBLING_MOVES) {
        parallels += octaveRun.length;
        problems.push(...octaveRun);
      }
      octaveRun = [];
    };
    for (let beat = 0; beat < piece.length; beat += 0.5) {
      const a = sounding(upper, beat, upperPick);
      const b = sounding(lower, beat, lowerPick);
      if (a === null || b === null) {
        endRun();
        previous = null;
        continue;
      }
      // Against the bass, only where the bass track is chordal: a single line is already the top pair.
      if (lowerPick === 'bottom' && sounding(lower, beat, 'top') === b) {
        previous = [a, b];
        continue;
      }
      const interval = (((a - b) % 12) + 12) % 12;
      if (previous) {
        const [pa, pb]: [number, number] = previous;
        const previousInterval = (((pa - pb) % 12) + 12) % 12;
        const moved = a !== pa && b !== pb && Math.sign(a - pa) === Math.sign(b - pb);
        const where = `${upper.name}/${lower.name}${lowerPick === 'bottom' ? ' (bass)' : ''}`;
        if (moved && interval === previousInterval && interval === 7) {
          parallels++;
          problems.push(`${where}: parallel fifths into ${barBeat(beat)}`);
        }
        if (moved && interval === 0 && previousInterval === 0 && !doubling) octaveRun.push(`${where}: parallel octaves into ${barBeat(beat)}`);
        else if (interval !== 0) endRun();
      }
      previous = [a, b];
    }
    endRun();
  }
  return { problems, parallels };
}
