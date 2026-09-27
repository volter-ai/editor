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

import type { DeviceParam } from './index';
import { beatAt, beatsOf, beatsPerBarOf, midiOf } from './notation';
import type { DawNode } from './render';

export interface PieceTransport {
  readonly tempo: number;
  readonly numerator: number;
  readonly denominator: number;
  /** Quarter-note beats per bar (`6/8` → 3). */
  readonly beatsPerBar: number;
  readonly oid: string | null;
  /** The tempo lane (`<Points target="tempo">`), or `null` for one tempo throughout. */
  readonly tempoPoints: PiecePoints | null;
}

export interface PieceNote {
  readonly id: string;
  readonly oid: string | null;
  /** Start in beats from the piece's start. */
  readonly start: number;
  /** Start in beats from its clip's start. */
  readonly time: number;
  readonly duration: number;
  readonly pitch: number;
  readonly vel: number;
  /** How it is played (`staccato`, `legato`, …), or `null`. */
  readonly artic: string | null;
  /** As written: `at`, `pitch` and `dur` exactly as the source spells them. */
  readonly written: { readonly at: string; readonly pitch: string; readonly dur: string };
}

export interface PiecePoint {
  readonly id: string;
  readonly oid: string | null;
  /** Beats from the piece's start. */
  readonly time: number;
  readonly value: number;
  readonly hold: boolean;
}

/**
 * An automation lane: in a clip a controller (`cc11`) or `pitchbend`; on the transport `tempo`; on
 * a track its mixer (`volume`, `pan`, `send:<bus>`).
 */
export interface PiecePoints {
  readonly id: string;
  readonly oid: string | null;
  readonly target: string;
  readonly points: readonly PiecePoint[];
}

export interface PieceClip {
  readonly id: string;
  readonly oid: string | null;
  readonly name: string | null;
  readonly time: number;
  readonly duration: number;
  readonly notes: readonly PieceNote[];
  readonly lanes: readonly PiecePoints[];
  /** The recorded file this clip plays (`<Audio>`), or `null` for a note clip. */
  readonly audio: PieceAudio | null;
}

/** A clip's recorded file: a WAV at a project path, from `offset` seconds into it, at `gain` dB. */
export interface PieceAudio {
  readonly oid: string | null;
  readonly file: string;
  readonly offset: number;
  readonly gain: number;
}

export interface PieceDevice {
  readonly id: string;
  readonly oid: string | null;
  readonly plugin: string;
  readonly name: string | null;
  readonly params: Readonly<Record<string, DeviceParam>>;
}

export interface PieceSend {
  readonly oid: string | null;
  /** The name of the track whose `effect` channel this feeds. */
  readonly to: string;
  readonly level: number;
  readonly pre: boolean;
}

/** A channel's LFO (`<Lfo>`): a wave added to `target`, one cycle per `period` beats. */
export interface PieceLfo {
  readonly oid: string | null;
  readonly target: string;
  readonly shape: 'sine' | 'triangle' | 'square' | 'saw';
  readonly period: number;
  readonly depth: number;
  readonly phase: number;
  /** The period as written (`"h"`, `2`), for an editor field. */
  readonly writtenPeriod: string;
}

export interface PieceChannel {
  readonly oid: string | null;
  /** `submix`: a group track's channel, summing the tracks it contains (DAWproject's role). */
  readonly role: 'regular' | 'effect' | 'master' | 'submix';
  readonly volume: number;
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
  readonly devices: readonly PieceDevice[];
  readonly sends: readonly PieceSend[];
  readonly lfos: readonly PieceLfo[];
}

export interface PieceTrack {
  readonly id: string;
  readonly oid: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly channel: PieceChannel | null;
  readonly clips: readonly PieceClip[];
  /**
   * The track's own automation across the arrangement (`<Points>` children of `<Track>`, outside
   * any clip): `volume` and `send:<bus>` in dB, `pan` −1…1. Points in piece time.
   */
  readonly lanes: readonly PiecePoints[];
  /** The group track this one sits in (its `submix` channel sums this track), or `null`. */
  readonly parent: string | null;
}

/** A launcher cell: the clip the track named `track` loops when the slot is launched. */
export interface PieceSlot {
  readonly id: string;
  readonly oid: string | null;
  readonly track: string;
  /** Its clip, whose `time` is 0 and whose notes count from its start; `null` for an empty slot. */
  readonly clip: PieceClip | null;
}

/** A row of the clip launcher (`<Scene>`). */
export interface PieceScene {
  readonly id: string;
  readonly oid: string | null;
  readonly name: string;
  readonly slots: readonly PieceSlot[];
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
  /** The clip launcher's rows, in source order. */
  readonly scenes: readonly PieceScene[];
  /** The last beat any arrangement clip reaches. */
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
  // The transport first: every position in the piece is read against its meter.
  const transportNode = root.children.find((node) => node.type === 'Transport');
  const meter = str(transportNode?.props['meter']) ?? '4/4';
  const beatsPerBar = beatsPerBarOf(meter);
  const [numerator = 4, denominator = 4] = meter.split('/').map(Number);
  const transport: PieceTransport = {
    tempo: num(transportNode?.props['tempo'], 120),
    numerator,
    denominator,
    beatsPerBar,
    oid: transportNode?.oid ?? null,
    tempoPoints: null,
  };
  const position = (value: unknown, where: string): number => {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${where} has no \`at\` position.`);
    return beatAt(value, beatsPerBar);
  };
  const readLane = (node: DawNode, id: string, where: string): PiecePoints => ({
    id,
    oid: node.oid,
    target: str(node.props['target']) ?? '',
    points: node.children
      .filter((point) => point.type === 'Point')
      .map((point, index) => ({
        id: `${id}:point:${index}`,
        oid: point.oid,
        time: position(point.props['at'], `A <Point> in ${where}`),
        value: num(point.props['value'], 0),
        hold: bool(point.props['hold']),
      })),
  });
  const tempoNode = transportNode?.children.find((node) => node.type === 'Points' && node.props['target'] === 'tempo');
  const withTempo: PieceTransport = tempoNode ? { ...transport, tempoPoints: readLane(tempoNode, 'transport:tempo', '<Transport>') } : transport;
  const tracks: PieceTrack[] = [];
  const markers: PieceMarker[] = [];
  const scenes: PieceScene[] = [];
  let length = 0;
  /**
   * A clip: on a track, a region from its `at`; in a launcher slot (`arranged` false), a loop of its
   * own whose time is 0, so its notes' `at` counts from its start as bar 1.
   */
  const readClip = (child: DawNode, clipId: string, trackName: string, arranged: boolean): PieceClip => {
    const clipName = str(child.props['name']);
    const where = `<Clip${clipName ? ` "${clipName}"` : ''}> on ${trackName}`;
    const time = arranged ? position(child.props['at'], where) : 0;
    const duration = num(child.props['bars'], 0) * beatsPerBar;
    const notes: PieceNote[] = child.children
      .filter((note) => note.type === 'Note')
      .map((note, noteIndex) => {
        const writtenPitch = String(note.props['pitch'] ?? '');
        const writtenDur = note.props['dur'];
        const start = position(note.props['at'], `A <Note> in ${where}`);
        return {
          id: `${clipId}:note:${noteIndex}`,
          oid: note.oid,
          start,
          time: start - time,
          duration: beatsOf(typeof writtenDur === 'number' ? writtenDur : String(writtenDur ?? '')),
          pitch: midiOf(writtenPitch),
          vel: num(note.props['vel'], 0.7),
          artic: str(note.props['artic']),
          written: { at: String(note.props['at'] ?? ''), pitch: writtenPitch, dur: String(writtenDur ?? '') },
        };
      });
    const lanes = child.children.filter((lane) => lane.type === 'Points').map((lane, laneIndex) => readLane(lane, `${clipId}:lane:${laneIndex}`, where));
    const audioNode = child.children.find((part) => part.type === 'Audio');
    const audio: PieceAudio | null = audioNode
      ? { oid: audioNode.oid, file: str(audioNode.props['file']) ?? '', offset: num(audioNode.props['offset'], 0), gain: num(audioNode.props['gain'], 0) }
      : null;
    return { id: clipId, oid: child.oid, name: clipName, time, duration, notes, lanes, audio };
  };
  /**
   * A track, and (after it) every track it contains: a group's children sum into its strip, the
   * group's channel `role="submix"`. `parent` is the group track's id.
   */
  const readTrack = (node: DawNode, trackId: string, parent: string | null): void => {
    const trackName = str(node.props['name']) ?? `Track ${tracks.length + 1}`;
    let channel: PieceChannel | null = null;
    const clips: PieceClip[] = [];
    const trackLanes: PiecePoints[] = [];
    node.children.forEach((child, childIndex) => {
      if (child.type === 'Channel') {
        const role = str(child.props['role']);
        channel = {
          oid: child.oid,
          role: role === 'effect' || role === 'master' || role === 'submix' ? role : 'regular',
          sends: child.children
            .filter((send) => send.type === 'Send')
            .map((send) => ({ oid: send.oid, to: str(send.props['to']) ?? '', level: num(send.props['level'], 0), pre: bool(send.props['pre']) })),
          lfos: child.children
            .filter((lfo) => lfo.type === 'Lfo')
            .map((lfo) => {
              const shape = str(lfo.props['shape']);
              const period = lfo.props['period'];
              return {
                oid: lfo.oid,
                target: str(lfo.props['target']) ?? '',
                shape: shape === 'triangle' || shape === 'square' || shape === 'saw' ? shape : 'sine',
                period: (() => {
                  try {
                    return beatsOf(typeof period === 'number' ? period : String(period ?? ''));
                  } catch (error) {
                    throw new Error(`The <Lfo> on ${trackName}'s channel has no period it can cycle over: ${error instanceof Error ? error.message : String(error)}`);
                  }
                })(),
                depth: num(lfo.props['depth'], 0),
                phase: num(lfo.props['phase'], 0),
                writtenPeriod: String(period ?? ''),
              };
            }),
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
              params: (device.props['params'] ?? {}) as Record<string, DeviceParam>,
            })),
        };
      } else if (child.type === 'Clip') {
        const clip = readClip(child, `${trackId}:clip:${childIndex}`, trackName, true);
        length = Math.max(length, clip.time + clip.duration);
        clips.push(clip);
      } else if (child.type === 'Points') {
        trackLanes.push(readLane(child, `${trackId}:lane:${childIndex}`, `<Track "${trackName}">`));
      }
    });
    tracks.push({ id: trackId, oid: node.oid, name: trackName, color: str(node.props['color']), channel, clips, lanes: trackLanes, parent });
    for (const [childIndex, child] of node.children.entries()) {
      if (child.type === 'Track') readTrack(child, `${trackId}/track:${childIndex}`, trackId);
    }
  };
  root.children.forEach((node, index) => {
    if (node.type === 'Marker') {
      markers.push({ id: `marker:${index}`, oid: node.oid, time: position(node.props['at'], 'A <Marker>'), name: str(node.props['name']) ?? '' });
    } else if (node.type === 'Track') {
      readTrack(node, `track:${index}`, null);
    } else if (node.type === 'Scene') {
      const sceneId = `scene:${index}`;
      const slots = node.children.flatMap((slot, slotIndex): PieceSlot[] => {
        if (slot.type !== 'ClipSlot') return [];
        const track = str(slot.props['track']) ?? '';
        const clipNode = slot.children.find((child) => child.type === 'Clip');
        const id = `${sceneId}:slot:${slotIndex}`;
        return [{ id, oid: slot.oid, track, clip: clipNode ? readClip(clipNode, `${id}:clip`, track, false) : null }];
      });
      scenes.push({ id: sceneId, oid: node.oid, name: str(node.props['name']) ?? `Scene ${scenes.length + 1}`, slots });
    }
  });
  return { transport: withTempo, tracks, markers, scenes, length, oidCounts };
}

/** Seconds per beat at the piece's tempo (a constant tempo; tempo automation is not read yet). */
export function secondsPerBeat(piece: Piece): number {
  return 60 / piece.transport.tempo;
}
