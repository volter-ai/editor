/**
 * A PIECE OF MUSIC IS A REACT COMPONENT whose elements are DAWproject's own model
 * (github.com/bitwig/dawproject, `Project.xsd`) — the same nouns — written in a composer's
 * units (`./notation`): positions as `bar:beat`, pitches as note names, lengths as note values.
 * A piece imports these and nothing of the editor:
 *
 * ```tsx
 * import { Channel, Clip, Device, Note, Project, Track, Transport } from '@volter/dawproject';
 *
 * export default function Theme() {
 *   return (
 *     <Project>
 *       <Transport tempo={96} meter="4/4" />
 *       <Track name="Lead">
 *         <Channel volume={-6} pan={0} />
 *         <Clip at="1" bars={2}>
 *           <Note at="1:1" pitch="E4" dur="q" vel={0.8} />
 *           <Note at="1:2.5" pitch="F#4" dur="8" />
 *         </Clip>
 *       </Track>
 *     </Project>
 *   );
 * }
 * ```
 *
 * Positions are ABSOLUTE bars of the piece; a clip is a region of the arrangement, and every
 * note inside it states the bar it sounds in.
 *
 * Each export is the element's TYPE NAME, a string, so the elements carry no identity of
 * this module: the renderer (`./render`) recognizes them by name wherever the piece's copy
 * of this package was resolved from. DAWproject's `Note` spells its key `key`, which React
 * reserves, so the note name is `pitch`.
 */

import type { FC, ReactNode } from 'react';

/** A position in the piece: `bar` or `bar:beat`, both counted from 1 (`9:2.5`). */
export type Position = string;
/** A note value: `w h q 8 16 32`, dots, `t` for a triplet; or a number of quarter-note beats. */
export type Length = string | number;

export interface ProjectProps {
  readonly children?: ReactNode;
}

/** DAWproject `Transport`: `Tempo` in BPM and `TimeSignature` as `n/d` (default `4/4`). */
export interface TransportProps {
  readonly tempo: number;
  readonly meter?: string;
  /** A tempo lane: `<Points target="tempo">`. */
  readonly children?: ReactNode;
}

/** DAWproject `Track`: a named lane that owns a channel and its clips. */
export interface TrackProps {
  readonly name: string;
  readonly color?: string;
  readonly children?: ReactNode;
}

/**
 * DAWproject `Channel`: the mixer strip. `volume` is in decibels, `pan` in −1…1. `role` is the
 * schema's: `regular` (a track's own strip, the default), `effect` (a bus other channels send to,
 * such as a reverb), `submix` (a group track's strip: the tracks inside that `<Track>` sum into
 * it), or `master` (the one strip everything ends in).
 */
export interface ChannelProps {
  readonly role?: 'regular' | 'effect' | 'master' | 'submix';
  readonly volume?: number;
  readonly pan?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
  readonly children?: ReactNode;
}

/**
 * A modulator on a `<Channel>`, as Bitwig's LFO: a wave added to one of the channel's own
 * parameters, `target` `volume` or `send:<bus>` (±`depth` dB) or `pan` (±`depth`, the sum
 * clamped to −1…1). One cycle lasts `period` (a note value or a number of beats, so it follows
 * the tempo), counted from the piece's first beat and offset by `phase` (0–1 of a cycle). It adds
 * to the parameter's written value, or to its automation lane where it has one. DAWproject has no
 * modulators: its export writes the moving parameter as automation points.
 */
export interface LfoProps {
  readonly target: string;
  readonly shape?: 'sine' | 'triangle' | 'square' | 'saw';
  readonly period: Length;
  readonly depth: number;
  readonly phase?: number;
}

/** DAWproject `Send`: this channel feeds the `effect` channel of the track named `to`, at `level` dB. */
export interface SendProps {
  readonly to: string;
  readonly level: number;
  /** Taken before the fader (`pre`) rather than after it (the default). */
  readonly pre?: boolean;
}

/** A device parameter: a number, a string, a switch, or a list of them (an equaliser's bands). */
export type DeviceParam =
  | number
  | string
  | boolean
  | readonly Readonly<Record<string, number | string | boolean>>[]
  | Readonly<Record<string, number>>;

/**
 * DAWproject `Device`: an instrument or effect on a channel, named by its plugin. The built-in
 * effects take the schema's own device types: `equalizer` (`bands`: `{ type: 'highPass' | 'lowPass'
 * | 'lowShelf' | 'highShelf' | 'bell', freq, gain?, q? }`), `compressor` (`threshold`, `ratio`,
 * `attack`, `release`, `knee`, `makeup`), `limiter` (`ceiling`, `release`), and `convolution`
 * (`ir`: a project path to an impulse response WAV, `predelay` ms, `wet` 0–1).
 *
 * The instrument is `soundfont` (`bank`: a project path to an .sf2/.sf3, `program`, `bankNumber`,
 * `drums`). Its `articulations` maps a note's `artic` to the program in the same bank that plays
 * it, where the bank records that articulation apart (`{ staccato: 101, pizzicato: 102 }`): a
 * note with a mapped `artic` sounds on that patch, every other note on `program`.
 */
export interface DeviceProps {
  readonly plugin: string;
  readonly name?: string;
  /** The plugin's own parameters, by the plugin's own names. */
  readonly params?: Readonly<Record<string, DeviceParam>>;
}

/**
 * DAWproject `Clip`: a region of a track's timeline, from bar `at` for `bars` bars. In a
 * `<ClipSlot>` a clip has no `at`: it is a loop of its own, and its notes' positions count from
 * its start as bar 1.
 */
export interface ClipProps {
  readonly at?: Position;
  readonly bars: number;
  readonly name?: string;
  readonly children?: ReactNode;
}

/**
 * DAWproject `Note`: a note name at a position for a length. `vel` and `rel` are 0…1. `artic` is
 * how it is played: `staccato`, `staccatissimo`, `tenuto`, `accent`, `marcato` or `legato`, or a
 * technique a sampled instrument records apart, `pizzicato` or `tremolo`. A soundfont device's
 * `articulations` names the patch that plays each (see `DeviceProps`).
 */
export interface NoteProps {
  readonly at: Position;
  readonly pitch: string;
  readonly dur: Length;
  readonly vel?: number;
  readonly rel?: number;
  readonly artic?: 'staccato' | 'staccatissimo' | 'tenuto' | 'accent' | 'marcato' | 'legato' | 'pizzicato' | 'tremolo';
}

/**
 * DAWproject `Audio`: a recorded file a `<Clip>` plays, instead of notes. `file` is a WAV at a
 * project path; it plays from the clip's start (or from `offset` seconds into the file) for the
 * clip's length, at `gain` dB. A track whose clips hold audio is an audio track: its strip's input
 * is the files, not an instrument.
 */
export interface AudioProps {
  readonly file: string;
  readonly offset?: number;
  readonly gain?: number;
  /**
   * The take's name, when a clip holds several recordings of one part (one per pass of a loop):
   * the newest (last) plays unless `<Comp>`s pick others.
   */
  readonly take?: string;
}

/**
 * A comp choice in a clip of several takes: from `at` (a position of the piece, inside the clip)
 * the take named `take` plays, until the next `<Comp>`. Before the first, the newest take plays.
 * Where the take changes, the two cross in 5 ms.
 */
export interface CompProps {
  readonly take: string;
  readonly at: Position;
}

/**
 * DAWproject `Points`: an automation lane. In a `<Clip>`, `target` is a MIDI controller
 * (`cc1` modulation, `cc11` expression, `cc64` sustain, …) or `pitchbend`, with values 0–1
 * (pitch bend −1…1). In `<Transport>`, `target="tempo"` and values are BPM.
 */
export interface PointsProps {
  readonly target: string;
  readonly children?: ReactNode;
}

/** A point on a lane. Values move linearly to the next point unless the point `hold`s. */
export interface PointProps {
  readonly at: Position;
  readonly value: number;
  readonly hold?: boolean;
}

/**
 * DAWproject `Scene`: a row of the clip launcher, a child of `<Project>`. Launching it plays each
 * of its `<ClipSlot>`s on that slot's track, looping, from the next bar, and stops the tracks it
 * has no slot for: one scene is one state of the music (a game's explore, combat, calm).
 */
export interface SceneProps {
  readonly name: string;
  readonly children?: ReactNode;
}

/** DAWproject `ClipSlot`: the launcher cell of the track named `track` in a scene, holding one `<Clip>`. */
export interface ClipSlotProps {
  readonly track: string;
  readonly children?: ReactNode;
}

/** DAWproject `Marker`: a named point on the arrangement's timeline. */
export interface MarkerProps {
  readonly at: Position;
  readonly name: string;
}

function element<P>(name: string): FC<P> {
  return name as unknown as FC<P>;
}

export const Project = element<ProjectProps>('dawproject.Project');
export const Transport = element<TransportProps>('dawproject.Transport');
export const Track = element<TrackProps>('dawproject.Track');
export const Channel = element<ChannelProps>('dawproject.Channel');
export const Send = element<SendProps>('dawproject.Send');
export const Device = element<DeviceProps>('dawproject.Device');
export const Clip = element<ClipProps>('dawproject.Clip');
export const Note = element<NoteProps>('dawproject.Note');
export const Marker = element<MarkerProps>('dawproject.Marker');
export const Points = element<PointsProps>('dawproject.Points');
export const Audio = element<AudioProps>('dawproject.Audio');
export const Point = element<PointProps>('dawproject.Point');
export const Lfo = element<LfoProps>('dawproject.Lfo');
export const Comp = element<CompProps>('dawproject.Comp');
export const Scene = element<SceneProps>('dawproject.Scene');
export const ClipSlot = element<ClipSlotProps>('dawproject.ClipSlot');

/** Every element this package names, keyed by its short name. */
export const ELEMENT_TYPES = {
  Project: 'dawproject.Project',
  Transport: 'dawproject.Transport',
  Track: 'dawproject.Track',
  Channel: 'dawproject.Channel',
  Send: 'dawproject.Send',
  Device: 'dawproject.Device',
  Clip: 'dawproject.Clip',
  Note: 'dawproject.Note',
  Marker: 'dawproject.Marker',
  Points: 'dawproject.Points',
  Point: 'dawproject.Point',
  Audio: 'dawproject.Audio',
  Lfo: 'dawproject.Lfo',
  Comp: 'dawproject.Comp',
  Scene: 'dawproject.Scene',
  ClipSlot: 'dawproject.ClipSlot',
} as const;

export type ElementName = keyof typeof ELEMENT_TYPES;

/** The written units' spellings, for code that generates notes (`at={formatAt(beat, 4)}`). */
export { beatAt, beatsOf, formatAt, formatDuration, formatPitch, midiOf } from './notation';
