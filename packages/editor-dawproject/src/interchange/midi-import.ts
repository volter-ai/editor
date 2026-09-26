/**
 * MIDI IMPORT: a Standard MIDI File as a piece's source, written in the piece's own units so a
 * person (or a model) reads and edits it like any hand-written piece: `<Note at="3:2.5"
 * pitch="F#5" dur="8" vel={0.62} />`, one literal element per note.
 *
 * What a file carries and where it lands:
 *   - each MIDI track's notes on one channel → a `<Track>` with a `<Channel>` (CC7 → `volume` in dB,
 *     CC10 → `pan`) and a soundfont `<Device>` (its first program change; channel 10 → drums), and
 *     ONE `<Clip>` of whole bars spanning everything the track plays;
 *   - notes as written units; a length that is not exactly a note value stays a number of beats;
 *   - tempo changes → `<Points target="tempo">` (every point holds: MIDI tempo is a step);
 *   - the first time signature → `meter`; the first key signature decides sharps or flats;
 *   - CC1, CC11, CC64 and pitch bend → `<Points>` lanes in the clip (every point holds, repeats thinned);
 *   - marker meta events → `<Marker>`s.
 * A note with no length plays as a 64th; a note never released ends where its key is struck
 * next in the track, else at the track's last event; a channel with lanes and no notes keeps
 * its lanes on an empty clip. What it does not carry is named and counted in the generated
 * file's header, never dropped silently.
 *
 * Positions are MIDI ticks over the file's own ticks-per-quarter, so a performed (humanised) file
 * imports as exactly what it plays, off the grid where it was played off the grid.
 */

import { beatsOf, formatAt, formatDuration, formatPitch } from '@volter/dawproject';
import { BasicMIDI } from 'spessasynth_core';

export interface MidiImportOptions {
  /** The file's name, for the header comment. */
  readonly source: string;
  /** The sound bank the devices name (project-relative). */
  readonly bank: string;
  /** The component's name. */
  readonly componentName: string;
}

interface ImportedNote {
  readonly tick: number;
  readonly end: number;
  readonly key: number;
  readonly velocity: number;
}

interface ImportedPoint {
  readonly tick: number;
  readonly value: number;
}

interface ImportedTrack {
  name: string;
  readonly channel: number;
  program: number | null;
  bankNumber: number | null;
  volume: number | null;
  pan: number | null;
  readonly notes: ImportedNote[];
  readonly lanes: Map<string, ImportedPoint[]>;
}

const LANE_CONTROLLERS: Record<number, string> = { 1: 'cc1', 11: 'cc11', 64: 'cc64' };
const DRUM_CHANNEL = 9;

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * A tempo's microseconds per quarter as BPM, with the fewest decimals that land within a
 * microsecond of it: writers truncate (92 BPM is written 652173 µs), so the exact quotient would
 * read `92.0001`, and a microsecond per quarter is far below anything a tempo map resolves.
 */
function bpmOf(microseconds: number): number {
  for (let places = 0; places < 9; places++) {
    const bpm = round(60_000_000 / microseconds, places);
    if (Math.abs(60_000_000 / bpm - microseconds) <= 1) return bpm;
  }
  return 60_000_000 / microseconds;
}

/** Drop a point that repeats the value before it. */
function thin(points: readonly ImportedPoint[]): ImportedPoint[] {
  const out: ImportedPoint[] = [];
  for (const point of [...points].sort((a, b) => a.tick - b.tick)) {
    const last = out[out.length - 1];
    if (last && last.tick === point.tick) out[out.length - 1] = point;
    else if (!last || last.value !== point.value) out.push(point);
  }
  return out;
}

/** A string attribute: a plain JSX string when it can be one, else an expression. */
function quote(text: string): string {
  return /^[^"{}<>\\\n]*$/.test(text) ? `"${text}"` : `{${JSON.stringify(text)}}`;
}

/** `harbor-imported` → `HarborImported`. */
export function componentNameOf(fileName: string): string {
  const words = fileName.replace(/\.[^.]*$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  return /^[A-Za-z]/.test(name) ? name : `Piece${name}`;
}

/** A Standard MIDI File as the TSX source of a piece. */
export function importMidi(bytes: ArrayBuffer, options: MidiImportOptions): string {
  const midi = BasicMIDI.fromArrayBuffer(bytes, options.source);
  const ppq = midi.timeDivision;
  const tempos: ImportedPoint[] = [];
  const markers: { tick: number; name: string }[] = [];
  let meter: { numerator: number; denominator: number; tick: number } | null = null;
  let meterChanges = 0;
  let flats: boolean | null = null;
  /** The first key signature's sharps/flats byte. */
  let firstKey: number | null = null;
  const decoder = new TextDecoder();
  const tracks: ImportedTrack[] = [];
  /** What the file carries that the piece does not, with how many of each. */
  const dropped = new Map<string, number>();
  const drop = (what: string): void => {
    dropped.set(what, (dropped.get(what) ?? 0) + 1);
  };

  midi.tracks.forEach((midiTrack) => {
    const byChannel = new Map<number, ImportedTrack>();
    const trackFor = (channel: number): ImportedTrack => {
      let track = byChannel.get(channel);
      if (!track) {
        track = { name: midiTrack.name.trim(), channel, program: null, bankNumber: null, volume: null, pan: null, notes: [], lanes: new Map() };
        byChannel.set(channel, track);
      }
      return track;
    };
    /** Each channel-and-key's note-ons (a velocity) and note-offs (`null`), in file order. */
    const keyEvents = new Map<number, { tick: number; velocity: number | null }[]>();
    const keyEvent = (key: number, tick: number, velocity: number | null): void => {
      const list = keyEvents.get(key) ?? [];
      list.push({ tick, velocity });
      keyEvents.set(key, list);
    };
    let lastTick = 0;
    for (const event of midiTrack.events) {
      lastTick = Math.max(lastTick, event.ticks);
      const status = event.statusByte;
      const data = event.data;
      if (status < 0x80) {
        // Meta events: statusByte is the meta type.
        if (status === 0x51 && data.length >= 3) {
          const microseconds = ((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0);
          tempos.push({ tick: event.ticks, value: bpmOf(microseconds) });
        } else if (status === 0x58 && data.length >= 2) {
          const next = { numerator: data[0] ?? 4, denominator: 2 ** (data[1] ?? 2), tick: event.ticks };
          if (!meter || next.tick < meter.tick) meter = next;
          meterChanges++;
        } else if (status === 0x59 && data.length >= 1 && firstKey === null) {
          firstKey = data[0] ?? 0;
          flats = ((data[0] ?? 0) << 24) >> 24 < 0;
        } else if (status === 0x06) {
          markers.push({ tick: event.ticks, name: decoder.decode(data).trim() });
        } else if (status === 0x01 || status === 0x02 || status === 0x05 || status === 0x07) {
          drop(({ 1: 'text events', 2: 'copyright notices', 5: 'lyrics', 7: 'cue points' } as Record<number, string>)[status]!);
        } else if (status === 0x59 && data.length >= 1 && data[0] !== firstKey) {
          drop('key-signature changes after the first (the first decides sharps or flats)');
        }
        continue;
      }
      if (status >= 0xf0) {
        if (status === 0xf0) drop('system-exclusive messages');
        continue;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0x90 && (data[1] ?? 0) > 0) {
        trackFor(channel);
        keyEvent(channel * 128 + (data[0] ?? 0), event.ticks, data[1] ?? 0);
      } else if (kind === 0x80 || kind === 0x90) {
        keyEvent(channel * 128 + (data[0] ?? 0), event.ticks, null);
      } else if (kind === 0xc0) {
        const track = trackFor(channel);
        if (track.program === null) track.program = data[0] ?? 0;
        else if (track.program !== (data[0] ?? 0)) drop('program changes after the first (a track plays one program)');
      } else if (kind === 0xb0) {
        const controller = data[0] ?? 0;
        const value = data[1] ?? 0;
        const track = trackFor(channel);
        const lane = LANE_CONTROLLERS[controller];
        if (lane) {
          const points = track.lanes.get(lane) ?? [];
          points.push({ tick: event.ticks, value: round(value / 127, 4) });
          track.lanes.set(lane, points);
        } else if (controller === 0 && track.bankNumber === null) track.bankNumber = value;
        else if (controller === 7 && track.volume === null) track.volume = value <= 0 ? -60 : round(40 * Math.log10(value / 127), 2);
        else if (controller === 10 && track.pan === null) track.pan = round(Math.max(-1, Math.min(1, (value - 64) / 63)), 2);
        else if (controller === 7 || controller === 10) drop(`CC${controller} changes after the first (the channel's ${controller === 7 ? 'volume' : 'pan'} is one value)`);
        else if (controller === 0 && value !== track.bankNumber) drop('bank selects after the first');
        else if (controller !== 0 && controller !== 32) drop(`CC${controller}`);
      } else if (kind === 0xe0) {
        const value = ((data[1] ?? 0) << 7) | (data[0] ?? 0);
        const track = trackFor(channel);
        const points = track.lanes.get('pitchbend') ?? [];
        points.push({ tick: event.ticks, value: round(Math.max(-1, Math.min(1, (value - 8192) / 8191)), 4) });
        track.lanes.set('pitchbend', points);
      } else if (kind === 0xa0 || kind === 0xd0) {
        drop(kind === 0xa0 ? 'polyphonic aftertouch' : 'channel pressure');
      }
    }
    // Notes, per key: each note-off releases the earliest held strike. A strike that the rest of
    // the track has too few note-offs to release is never released: it ends where its key is
    // struck next, and the last one at the track's last event. (Overlapping strikes that are all
    // released keep their own note-offs.)
    for (const [key, list] of keyEvents) {
      const notes = trackFor(Math.floor(key / 128)).notes;
      const pitch = key % 128;
      let offsAfter = list.filter((event) => event.velocity === null).length;
      const held: { tick: number; velocity: number }[] = [];
      for (const event of list) {
        if (event.velocity === null) {
          offsAfter--;
          const start = held.shift();
          if (start) notes.push({ tick: start.tick, end: event.tick, key: pitch, velocity: start.velocity });
          continue;
        }
        if (held.length + 1 > offsAfter && held.length > 0) {
          const start = held.shift()!;
          notes.push({ tick: start.tick, end: event.tick, key: pitch, velocity: start.velocity });
        }
        held.push({ tick: event.tick, velocity: event.velocity });
      }
      for (const start of held) notes.push({ tick: start.tick, end: Math.max(start.tick, lastTick), key: pitch, velocity: start.velocity });
    }
    // A channel with notes, or with controller lanes alone (they land on an empty clip).
    const kept = [...byChannel.values()].filter((track) => track.notes.length > 0 || [...track.lanes.values()].some((points) => points.length > 0));
    for (const track of byChannel.values()) {
      if (!kept.includes(track)) drop('channels with no notes and no lanes (their program, volume and pan)');
    }
    for (const track of kept) {
      if (kept.length > 1) track.name = `${track.name || 'Track'} (channel ${track.channel + 1})`;
      tracks.push(track);
    }
  });

  const chosenMeter: { numerator: number; denominator: number } = meter ?? { numerator: 4, denominator: 4 };
  const beatsPerBar = (chosenMeter.numerator * 4) / chosenMeter.denominator;
  const at = (tick: number): string => formatAt(tick / ppq, beatsPerBar);
  const barAt = (tick: number): string => formatAt(tick / ppq, beatsPerBar, { bar: true });
  const spell = (key: number): string => formatPitch(key, flats === true);

  const tempoPoints = thin(tempos);
  const first = tempoPoints[0];
  const tempo = first && first.tick === 0 ? first.value : 120;
  const tempoChanges = tempoPoints.filter((point, index) => !(index === 0 && point.tick === 0) && point.value !== (index === 0 ? tempo : tempoPoints[index - 1]!.value));

  const used = new Set(['Project', 'Transport', 'Track', 'Channel', 'Device', 'Clip', 'Note']);
  const lines: string[] = [];
  const out = (depth: number, text: string): void => {
    lines.push(`${'  '.repeat(depth + 1)}${text}`);
  };

  out(2, tempoChanges.length > 0 ? `<Transport tempo={${tempo}} meter="${chosenMeter.numerator}/${chosenMeter.denominator}">` : `<Transport tempo={${tempo}} meter="${chosenMeter.numerator}/${chosenMeter.denominator}" />`);
  if (tempoChanges.length > 0) {
    used.add('Points');
    used.add('Point');
    out(3, '<Points target="tempo">');
    for (const point of tempoChanges) out(4, `<Point at="${at(point.tick)}" value={${point.value}} hold />`);
    out(3, '</Points>');
    out(2, '</Transport>');
  }
  for (const marker of [...markers].sort((a, b) => a.tick - b.tick)) {
    used.add('Marker');
    out(2, `<Marker at="${barAt(marker.tick)}" name=${quote(marker.name)} />`);
  }

  for (const track of tracks) {
    const notes = [...track.notes].sort((a, b) => a.tick - b.tick || a.key - b.key);
    const lanes = [...track.lanes.entries()].map(([target, points]) => [target, thin(points)] as const).filter(([, points]) => points.length > 0);
    let startTick = Math.min(...notes.map((note) => note.tick));
    let endTick = Math.max(...notes.map((note) => note.end));
    for (const [, points] of lanes) {
      for (const point of points) {
        startTick = Math.min(startTick, point.tick);
        endTick = Math.max(endTick, point.tick);
      }
    }
    const barTicks = beatsPerBar * ppq;
    const firstBar = Math.floor(startTick / barTicks + 1e-9);
    const lastBar = Math.max(firstBar + 1, Math.ceil(endTick / barTicks - 1e-9));
    const drums = track.channel === DRUM_CHANNEL;
    const name = track.name || `Track ${tracks.indexOf(track) + 1}`;
    const params = [`bank: BANK`];
    if (track.program !== null || !drums) params.push(`program: ${track.program ?? 0}`);
    if (track.bankNumber) params.push(`bankNumber: ${track.bankNumber}`);
    if (drums) params.push('drums: true');
    const channelProps = [track.volume !== null ? `volume={${track.volume}}` : '', track.pan !== null ? `pan={${track.pan}}` : ''].filter(Boolean).join(' ');
    out(2, `<Track name=${quote(name)}>`);
    out(3, `<Channel${channelProps ? ` ${channelProps}` : ''}>`);
    out(4, `<Device plugin="soundfont" params={{ ${params.join(', ')} }} />`);
    out(3, '</Channel>');
    out(3, `<Clip at="${firstBar + 1}" bars={${lastBar - firstBar}} name=${quote(name)}>`);
    for (const [target, points] of lanes) {
      used.add('Points');
      used.add('Point');
      out(4, `<Points target="${target}">`);
      for (const point of points) out(5, `<Point at="${at(point.tick)}" value={${point.value}} hold />`);
      out(4, '</Points>');
    }
    for (const note of notes) {
      // A note with no length (on and off on one tick) plays as a 64th, the shortest a piece reads as a strike.
      const beats = note.end > note.tick ? (note.end - note.tick) / ppq : 1 / 16;
      const value = formatDuration(beats);
      const isValue = /^(w|h|q|8|16|32)t?\.*$/.test(value) && Math.abs(beatsOf(value) - beats) < 1e-9;
      const durProp = isValue ? `"${value}"` : `{${round(beats, 6)}}`;
      out(4, `<Note at="${at(note.tick)}" pitch="${spell(note.key)}" dur=${durProp} vel={${round(note.velocity / 127, 4)}} />`);
    }
    out(3, '</Clip>');
    out(2, '</Track>');
  }

  const header = [
    '/**',
    ` * Imported from ${options.source} (${tracks.length} track${tracks.length === 1 ? '' : 's'}, ${ppq} ticks per quarter).`,
    ' *',
    ' * The notes are the file\'s own: where it was played off the grid, the positions are off the grid,',
    ' * and a length that is not exactly a note value is a number of beats.',
  ];
  const notCarried: string[] = [];
  if (meterChanges > 1) notCarried.push(`${meterChanges - 1} later time-signature change${meterChanges > 2 ? 's' : ''} (a piece has one meter)`);
  if (dropped.size > 0) notCarried.push([...dropped].sort(([a], [b]) => a.localeCompare(b)).map(([what, count]) => `${what} (${count})`).join(', '));
  if (notCarried.length > 0) header.push(' *', ` * Not carried: ${notCarried.join('; ')}.`);
  header.push(' */');

  const elements = ['Channel', 'Clip', 'Device', 'Marker', 'Note', 'Point', 'Points', 'Project', 'Track', 'Transport'].filter((element) => used.has(element));
  return [
    ...header,
    `import { ${elements.join(', ')} } from '@volter/dawproject';`,
    '',
    `const BANK = ${JSON.stringify(options.bank)};`,
    '',
    `export default function ${options.componentName}() {`,
    '  return (',
    '    <Project>',
    ...lines,
    '    </Project>',
    '  );',
    '}',
    '',
  ].join('\n');
}
