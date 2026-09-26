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
 *   - a technique (`pizzicato`, `tremolo`) on a track whose instrument names no patch for it in
 *     `articulations`: nothing else can play it, so it would sound as a sustained note
 *   - with the piece's banks: a note no sample of its patch plays, a program a bank lacks
 *   - more melodic tracks than the synthesizer has channels (15, channel 10 being the drums'), or
 *     two drum tracks: tracks past that share a channel, and each hears the other's program
 *   - a send to anything but an effect bus (it is dropped), a solo on a bus or the master (only
 *     a regular track's solo counts), a marker at or past the end or sharing another's beat (it
 *     makes no section)
 *
 * It cannot tell whether the music is good; it tells where it is certainly careless.
 */

import type { Piece } from '@volter/dawproject/piece';
import type { BasicSoundBank } from 'spessasynth_core';
import { articulationPrograms } from './articulations';
import { soundingKeys } from './bank-coverage';
import { validBands } from './mix/dsp';
import { mixTarget } from './mix/automation';
import { formatPitch } from '@volter/dawproject/notation';

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

/**
 * `banks` (by the project path a device's `params.bank` names), when given, adds the check that
 * matters most for a sampled instrument: every note has a sample in the patch that plays it.
 */
export function checkPiece(piece: Piece, banks?: ReadonlyMap<string, BasicSoundBank>): PieceChecks {
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

  // A technique only a separate patch plays, on an instrument that names none.
  const TECHNIQUES = new Set(['pizzicato', 'tremolo']);
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    const map = device?.params['articulations'];
    const mapped = map && typeof map === 'object' && !Array.isArray(map) ? (map as Readonly<Record<string, number>>) : {};
    const reported = new Set<string>();
    for (const clip of track.clips) {
      for (const note of clip.notes) {
        if (!note.artic || !TECHNIQUES.has(note.artic) || typeof mapped[note.artic] === 'number' || reported.has(note.artic)) continue;
        reported.add(note.artic);
        problems.push(`${track.name}: ${note.artic} at ${barBeat(note.start)} has no patch (its device's params.articulations names none), so it plays as a sustained note`);
      }
    }
  }

  // Every note sounds: its pitch is covered by the patch it plays on (its articulation's, or the
  // device's program), in the bank the device names.
  if (banks) {
    const patchOf = articulationPrograms(piece);
    for (const track of piece.tracks) {
      const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
      const path = device?.params['bank'];
      if (!device || typeof path !== 'string') continue;
      const bank = banks.get(path);
      if (!bank) continue;
      const drums = device.params['drums'] === true;
      const bankNumber = typeof device.params['bankNumber'] === 'number' ? device.params['bankNumber'] : 0;
      const baseProgram = typeof device.params['program'] === 'number' ? device.params['program'] : 0;
      const cache = new Map<number, Set<number> | null>();
      const missing = new Map<number, { pitches: Set<number>; first: number }>();
      for (const clip of track.clips) {
        for (const note of clip.notes) {
          const program = drums ? baseProgram : (patchOf.get(track.id)?.(note.artic) ?? baseProgram);
          if (!cache.has(program)) cache.set(program, soundingKeys(bank, bankNumber, program, drums));
          const keys = cache.get(program);
          if (keys === null) {
            if (!missing.has(-1 - program)) missing.set(-1 - program, { pitches: new Set(), first: note.start });
            continue;
          }
          if (keys && !keys.has(note.pitch)) {
            const entry = missing.get(program) ?? { pitches: new Set<number>(), first: note.start };
            entry.pitches.add(note.pitch);
            missing.set(program, entry);
          }
        }
      }
      for (const [program, { pitches, first }] of missing) {
        if (program < 0) {
          problems.push(`${track.name}: ${path} has no ${drums ? 'drum kit' : 'preset'} at ${drums ? '' : `bank ${bankNumber} `}program ${-1 - program}, so its notes (from ${barBeat(first)}) play whatever the synthesizer falls back to`);
          continue;
        }
        const keys = [...(cache.get(program) ?? [])].sort((a, b) => a - b);
        problems.push(
          `${track.name}: no sample plays ${[...pitches].sort((a, b) => a - b).map((pitch) => formatPitch(pitch)).join(', ')} on program ${program} of ${path} (it sounds ${formatPitch(keys[0]!)}–${formatPitch(keys[keys.length - 1]!)}${keys.length !== keys[keys.length - 1]! - keys[0]! + 1 ? ', with gaps' : ''}); those notes are silent, first at ${barBeat(first)}`,
        );
      }
    }
  }

  // Channels: 15 melodic tracks and one drum track fit the synthesizer's 16 channels.
  const instruments = piece.tracks.filter((track) => {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    return device && typeof device.params['bank'] === 'string';
  });
  const drumTracks = instruments.filter((track) => track.channel?.devices.find((device) => device.plugin === 'soundfont')?.params['drums'] === true);
  const melodic = instruments.filter((track) => !drumTracks.includes(track));
  if (melodic.length > 15) {
    problems.push(`${melodic.length} melodic tracks, and the synthesizer has 15 channels for them: ${melodic.slice(15).map((track) => track.name).join(', ')} ${melodic.length === 16 ? 'shares' : 'share'} a channel with an earlier track and ${melodic.length === 16 ? 'hears' : 'hear'} its program. Combine parts onto fewer tracks.`);
  }
  if (drumTracks.length > 1) {
    problems.push(`${drumTracks.length} drum tracks share the one drum channel (${drumTracks.map((track) => track.name).join(', ')}): the last kit selected plays for all. Put the kits' notes on one track.`);
  }
  // Sends, solos, markers.
  const buses = new Set(piece.tracks.filter((track) => track.channel?.role === 'effect').map((track) => track.name));
  for (const track of piece.tracks) {
    for (const send of track.channel?.sends ?? []) {
      if (!buses.has(send.to)) {
        const target = piece.tracks.find((candidate) => candidate.name === send.to);
        problems.push(`${track.name}: its send to "${send.to}" goes nowhere (${target ? `"${send.to}" is a ${target.channel?.role ?? 'regular'} channel, not an effect bus` : 'no track has that name'}), so nothing of it is heard`);
      }
    }
    for (const device of track.channel?.devices ?? []) {
      if (device.plugin !== 'equalizer') continue;
      const bands = device.params['bands'];
      const count = Array.isArray(bands) ? bands.length : 0;
      const skipped = count - validBands(bands).length;
      if (skipped > 0) {
        problems.push(`${track.name}: ${skipped} of the equalizer's ${count} bands ${skipped === 1 ? 'is' : 'are'} not played (each needs a type of highPass, lowPass, lowShelf, highShelf or bell, a freq above 0, and a q above 0 if it has one)`);
      }
    }
    for (const lane of track.lanes) {
      const target = mixTarget(lane.target);
      if (!target) {
        problems.push(`${track.name}: a track lane's target "${lane.target}" is none of volume, pan or send:<bus>, so it moves nothing (a controller lane belongs inside a clip)`);
      } else if (target.kind === 'send' && !(track.channel?.sends ?? []).some((send) => send.to === target.to)) {
        problems.push(`${track.name}: its "${lane.target}" lane automates a send the track does not have; add <Send to="${target.to}"> to its channel`);
      } else if (target.kind === 'pan' && lane.points.some((point) => point.value < -1 || point.value > 1)) {
        problems.push(`${track.name}: its pan lane has values outside −1…1; they are clamped`);
      }
    }
    if (track.channel?.solo && track.channel.role !== 'regular') {
      problems.push(`${track.name}: a solo on the ${track.channel.role === 'master' ? 'master' : 'effect bus'} channel does nothing; solo the regular tracks that feed it`);
    }
  }
  const markers = [...piece.markers].sort((a, b) => a.time - b.time);
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    if (marker.time >= piece.length - EPSILON) {
      problems.push(`The marker "${marker.name}" is at or past the piece's end (${barBeat(marker.time)}), so it makes no section`);
    } else if (i + 1 < markers.length && Math.abs(markers[i + 1]!.time - marker.time) < EPSILON) {
      problems.push(`The markers "${marker.name}" and "${markers[i + 1]!.name}" share ${barBeat(marker.time)}, so "${marker.name}" makes no section`);
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
