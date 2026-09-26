/**
 * DAWPROJECT EXPORT: a piece as a `.dawproject` file (github.com/bitwig/dawproject), the open
 * format Bitwig, Studio One, Cubase and others read. A piece's elements already ARE that format's
 * nouns, so the export is a transcription: `project.xml` and `metadata.xml` in a zip.
 *
 *   - `Transport`: `Tempo` (bpm) and `TimeSignature`;
 *   - `Structure`: a `Track` per track with its `Channel` (its role: `regular`, an `effect` bus or
 *     the `master`; volume as linear gain, pan normalized 0…1, mute, solo, its sends as `Sends` to
 *     the bus channels they feed) routed to the master channel (the piece's own, else one made
 *     for it); its devices as generic `Device`s with their parameters, the soundfont as the
 *     instrument (its bank the device's external `State` file, since no DAW has a SpessaSynth
 *     plugin to load), humanize as a note effect and every other device as an audio effect;
 *   - `Arrangement`: `Lanes` in beats, per track `Lanes` > `Clips` > `Clip` > `Lanes` holding the
 *     clip's `Notes` (times from the clip's start) and its controller lanes as `Points`
 *     (`channelController` / `pitchBend`); the tempo lane as `TempoAutomation`; markers.
 *
 * The notes are the WRITTEN ones, as a DAW's piano roll holds them: humanising and articulation
 * lengths are the performance (`perform.ts`), not the arrangement.
 */

import { strToU8, zipSync } from 'fflate';
import packageJson from '../../package.json';
import { assignChannels } from '../render-offline';
import type { Piece, PiecePoints } from '@volter/dawproject/piece';

export interface DawprojectOptions {
  readonly title: string;
  readonly application?: { readonly name: string; readonly version: string };
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attrs(values: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
    .join('');
}

/** Beats with the float noise of `bar:beat` arithmetic removed. */
function beats(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The piece's `project.xml`. */
export function pieceToProjectXml(piece: Piece, options: DawprojectOptions): string {
  let next = 0;
  const id = (): string => `id${next++}`;
  const assignments = assignChannels(piece);
  const lines: string[] = [];
  const out = (depth: number, text: string): void => {
    lines.push(`${'  '.repeat(depth)}${text}`);
  };
  const application = options.application ?? { name: 'Volter Editor', version: packageJson.version };

  out(0, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out(0, '<Project version="1.0">');
  out(1, `<Application${attrs(application)}/>`);
  const tempoId = id();
  out(1, '<Transport>');
  out(2, `<Tempo${attrs({ id: tempoId, name: 'Tempo', unit: 'bpm', value: piece.transport.tempo, min: 20, max: 666 })}/>`);
  out(2, `<TimeSignature${attrs({ id: id(), name: 'Time Signature', numerator: piece.transport.numerator, denominator: piece.transport.denominator })}/>`);
  out(1, '</Transport>');

  out(1, '<Structure>');
  const trackIds = new Map<string, string>();
  /** Each track's mixer parameters by lane target (`volume`, `pan`, `send:<bus>`): what a lane's Target names. */
  const paramIds = new Map<string, Map<string, string>>();
  // Every channel's id first, so a send can name the bus it feeds wherever that bus is listed.
  const channelIds = new Map<string, string>();
  for (const track of piece.tracks) {
    trackIds.set(track.id, id());
    channelIds.set(track.id, id());
  }
  const pieceMaster = piece.tracks.find((track) => track.channel?.role === 'master');
  const masterId = pieceMaster ? channelIds.get(pieceMaster.id)! : 'master';
  const busIds = new Map(piece.tracks.filter((track) => track.channel?.role === 'effect').map((track) => [track.name, channelIds.get(track.id)!]));
  for (const track of piece.tracks) {
    const trackId = trackIds.get(track.id)!;
    const channel = track.channel;
    const role = channel?.role ?? 'regular';
    out(2, `<Track${attrs({ id: trackId, name: track.name, color: track.color, contentType: role === 'regular' ? 'notes' : 'audio', loaded: true })}>`);
    out(3, `<Channel${attrs({ id: channelIds.get(track.id), role, audioChannels: 2, destination: role === 'master' ? null : masterId, solo: channel?.solo ?? false })}>`);
    if (channel && channel.devices.length > 0) {
      out(4, '<Devices>');
      for (const device of channel.devices) {
        const deviceRole = device.plugin === 'soundfont' ? 'instrument' : device.plugin === 'humanize' ? 'noteFX' : 'audioFX';
        out(5, `<Device${attrs({ id: id(), name: device.name ?? device.plugin, deviceName: device.plugin, deviceRole, deviceVendor: 'Volter', loaded: false })}>`);
        // Single numbers and switches are parameters; a list (an equaliser's bands) has no
        // generic-parameter form and is left to the device-specific elements.
        const numeric = Object.entries(device.params).filter(
          (entry): entry is [string, number | boolean] => typeof entry[1] === 'number' || typeof entry[1] === 'boolean',
        );
        if (numeric.length > 0) {
          out(6, '<Parameters>');
          for (const [key, value] of numeric) {
            if (typeof value === 'boolean') out(7, `<BoolParameter${attrs({ id: id(), name: key, value })}/>`);
            else if (Number.isInteger(value)) out(7, `<IntegerParameter${attrs({ id: id(), name: key, value })}/>`);
            else out(7, `<RealParameter${attrs({ id: id(), name: key, unit: 'linear', value })}/>`);
          }
          out(6, '</Parameters>');
        }
        const bank = device.params['bank'];
        if (typeof bank === 'string') out(6, `<State${attrs({ path: bank, external: true })}/>`);
        out(5, '</Device>');
      }
      out(4, '</Devices>');
    }
    out(4, `<Mute${attrs({ id: id(), name: 'Mute', value: channel?.mute ?? false })}/>`);
    const params = new Map<string, string>();
    paramIds.set(track.id, params);
    const panId = id();
    params.set('pan', panId);
    out(4, `<Pan${attrs({ id: panId, name: 'Pan', unit: 'normalized', value: beats(((channel?.pan ?? 0) + 1) / 2), min: 0, max: 1 })}/>`);
    const sends = (channel?.sends ?? []).filter((send) => busIds.has(send.to));
    if (sends.length > 0) {
      out(4, '<Sends>');
      for (const send of sends) {
        out(5, `<Send${attrs({ id: id(), name: `Send to ${send.to}`, destination: busIds.get(send.to), type: send.pre ? 'pre' : 'post' })}>`);
        const sendVolumeId = id();
        params.set(`send:${send.to}`, sendVolumeId);
        out(6, `<Volume${attrs({ id: sendVolumeId, name: 'Volume', unit: 'linear', value: beats(10 ** (send.level / 20)), min: 0, max: 2 })}/>`);
        out(5, '</Send>');
      }
      out(4, '</Sends>');
    }
    const volumeId = id();
    params.set('volume', volumeId);
    out(4, `<Volume${attrs({ id: volumeId, name: 'Volume', unit: 'linear', value: beats(10 ** ((channel?.volume ?? 0) / 20)), min: 0, max: 2 })}/>`);
    out(3, '</Channel>');
    out(2, '</Track>');
  }
  if (!pieceMaster) {
    out(2, `<Track${attrs({ id: id(), name: 'Master', contentType: 'audio notes', loaded: true })}>`);
    out(3, `<Channel${attrs({ id: masterId, role: 'master', audioChannels: 2 })}>`);
    out(4, `<Mute${attrs({ id: id(), name: 'Mute', value: false })}/>`);
    out(4, `<Pan${attrs({ id: id(), name: 'Pan', unit: 'normalized', value: 0.5, min: 0, max: 1 })}/>`);
    out(4, `<Volume${attrs({ id: id(), name: 'Volume', unit: 'linear', value: 1, min: 0, max: 2 })}/>`);
    out(3, '</Channel>');
    out(2, '</Track>');
  }
  out(1, '</Structure>');

  const lane = (depth: number, points: PiecePoints, midiChannel: number, origin: number): void => {
    const pitchBend = points.target === 'pitchbend';
    const controller = /^cc(\d+)$/.exec(points.target)?.[1];
    if (!pitchBend && controller === undefined) return;
    out(depth, `<Points${attrs({ id: id(), unit: 'normalized' })}>`);
    out(depth + 1, `<Target${attrs(pitchBend ? { expression: 'pitchBend', channel: midiChannel } : { expression: 'channelController', channel: midiChannel, controller: Number(controller) })}/>`);
    for (const point of [...points.points].sort((a, b) => a.time - b.time)) {
      // Pitch bend is −1…1 in a piece and 0…1 (centre 0.5) normalized.
      const value = pitchBend ? (point.value + 1) / 2 : point.value;
      out(depth + 1, `<RealPoint${attrs({ time: beats(point.time - origin), value: beats(value), interpolation: point.hold ? 'hold' : 'linear' })}/>`);
    }
    out(depth, '</Points>');
  };

  out(1, `<Arrangement${attrs({ id: id() })}>`);
  out(2, `<Lanes${attrs({ id: id(), timeUnit: 'beats' })}>`);
  for (const track of piece.tracks) {
    const midiChannel = assignments.get(track.id)?.channel ?? 0;
    out(3, `<Lanes${attrs({ id: id(), track: trackIds.get(track.id) })}>`);
    out(4, `<Clips${attrs({ id: id() })}>`);
    for (const clip of track.clips) {
      out(5, `<Clip${attrs({ name: clip.name, time: beats(clip.time), duration: beats(clip.duration), playStart: 0 })}>`);
      out(6, `<Lanes${attrs({ id: id() })}>`);
      out(7, `<Notes${attrs({ id: id() })}>`);
      for (const note of [...clip.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)) {
        out(8, `<Note${attrs({ time: beats(note.time), duration: beats(note.duration), channel: midiChannel, key: note.pitch, vel: beats(note.vel) })}/>`);
      }
      out(7, '</Notes>');
      for (const points of clip.lanes) lane(7, points, midiChannel, clip.time);
      out(6, '</Lanes>');
      out(5, '</Clip>');
    }
    out(4, '</Clips>');
    // The track's mixer automation, each lane on the parameter it moves (`<Target parameter>`).
    for (const points of track.lanes) {
      const parameter = paramIds.get(track.id)?.get(points.target);
      if (!parameter) continue;
      const pan = points.target === 'pan';
      out(4, `<Points${attrs({ id: id(), unit: pan ? 'normalized' : 'linear' })}>`);
      out(5, `<Target${attrs({ parameter })}/>`);
      for (const point of [...points.points].sort((a, b) => a.time - b.time)) {
        const value = pan ? (Math.max(-1, Math.min(1, point.value)) + 1) / 2 : 10 ** (point.value / 20);
        out(5, `<RealPoint${attrs({ time: beats(point.time), value: beats(value), interpolation: point.hold ? 'hold' : 'linear' })}/>`);
      }
      out(4, '</Points>');
    }
    out(3, '</Lanes>');
  }
  out(2, '</Lanes>');
  if (piece.markers.length > 0) {
    out(2, `<Markers${attrs({ id: id() })}>`);
    for (const marker of piece.markers) out(3, `<Marker${attrs({ name: marker.name, time: beats(marker.time) })}/>`);
    out(2, '</Markers>');
  }
  const tempo = piece.transport.tempoPoints;
  if (tempo && tempo.points.length > 0) {
    out(2, `<TempoAutomation${attrs({ id: id(), unit: 'bpm' })}>`);
    out(3, `<Target${attrs({ parameter: tempoId })}/>`);
    const points = [...tempo.points].sort((a, b) => a.time - b.time);
    // The tempo map holds the transport's tempo until the lane's first point.
    if ((points[0]?.time ?? 0) > 0) out(3, `<RealPoint${attrs({ time: 0, value: piece.transport.tempo, interpolation: 'hold' })}/>`);
    for (const point of points) out(3, `<RealPoint${attrs({ time: beats(point.time), value: point.value, interpolation: point.hold ? 'hold' : 'linear' })}/>`);
    out(2, '</TempoAutomation>');
  }
  out(1, '</Arrangement>');
  out(0, '</Project>');
  return `${lines.join('\n')}\n`;
}

/** The piece's `metadata.xml`. */
export function metadataXml(options: DawprojectOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<MetaData>',
    `  <Title>${escape(options.title)}</Title>`,
    '</MetaData>',
    '',
  ].join('\n');
}

/** The `.dawproject` file: a zip of `project.xml` and `metadata.xml`. */
export function pieceToDawproject(piece: Piece, options: DawprojectOptions): Uint8Array {
  // A fixed timestamp: the zip otherwise stamps each entry with the time of export, so the same
  // piece gave a different file every time.
  return zipSync(
    {
      'project.xml': strToU8(pieceToProjectXml(piece, options)),
      'metadata.xml': strToU8(metadataXml(options)),
    },
    { mtime: new Date(1980, 0, 1) },
  );
}
