/**
 * Chord voicing for this project's pieces: chord symbols to MIDI pitches, voiced with the
 * smallest total movement from the previous chord (keyboard-style voice leading), inside a range.
 * The piece's pads and arpeggios are generated from its chord table through these.
 */

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const QUALITIES: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

/** Pitch classes of a chord symbol such as `D`, `F#m`, `Em7`, `Asus4`, `Bb`. */
export function chordTones(symbol: string): number[] {
  const match = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  if (!match) throw new Error(`Not a chord symbol: ${symbol}`);
  const [, letter = 'C', accidental = '', quality = ''] = match;
  const root = ((NOTE_INDEX[letter] ?? 0) + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
  const intervals = QUALITIES[quality];
  if (!intervals) throw new Error(`Unknown chord quality "${quality}" in ${symbol}`);
  return intervals.map((interval) => (root + interval) % 12);
}

/** Every pitch in [low, high] whose class is in `classes`. */
function candidates(classes: readonly number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let pitch = low; pitch <= high; pitch++) if (classes.includes(pitch % 12)) out.push(pitch);
  return out;
}

/**
 * Voice a chord progression in `voices` parts within [low, high]: each chord takes the voicing
 * (one pitch per voice, all chord tones covered when voices allow) nearest the previous one.
 */
export function voiceLead(symbols: readonly string[], voices = 3, low = 60, high = 72): number[][] {
  const out: number[][] = [];
  let previous: number[] | null = null;
  for (const symbol of symbols) {
    const classes = chordTones(symbol);
    const pool = candidates(classes, low, high);
    let best: number[] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    const choose = (start: number, chosen: number[]): void => {
      if (chosen.length === voices) {
        const covered = new Set(chosen.map((pitch) => pitch % 12)).size;
        const coverage = Math.min(voices, classes.length);
        if (covered < coverage) return;
        const cost = previous
          ? chosen.reduce((sum, pitch, index) => sum + Math.abs(pitch - (previous?.[index] ?? pitch)), 0)
          : Math.abs(chosen.reduce((sum, pitch) => sum + pitch, 0) / voices - (low + high) / 2);
        if (cost < bestCost) {
          bestCost = cost;
          best = [...chosen];
        }
        return;
      }
      for (let index = start; index < pool.length; index++) {
        const pitch = pool[index] ?? 0;
        if (chosen.length > 0 && pitch - (chosen[chosen.length - 1] ?? 0) < 2) continue; // no semitone clusters
        chosen.push(pitch);
        choose(index + 1, chosen);
        chosen.pop();
      }
    };
    choose(0, []);
    if (!best) throw new Error(`No ${voices}-voice voicing of ${symbol} fits ${low}–${high}.`);
    out.push(best);
    previous = best;
  }
  return out;
}
