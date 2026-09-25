/**
 * A PIECE OF MUSIC IS A REACT COMPONENT whose elements are DAWproject's own model
 * (github.com/bitwig/dawproject, `Project.xsd`): the same nouns, the same attribute names,
 * time in beats. A piece imports these and nothing of the editor:
 *
 * ```tsx
 * import { Channel, Clip, Note, Project, Track, Transport } from '@volter/dawproject';
 *
 * export default function Theme() {
 *   return (
 *     <Project>
 *       <Transport tempo={96} numerator={4} denominator={4} />
 *       <Track name="Lead">
 *         <Channel volume={-6} pan={0} />
 *         <Clip time={0} duration={4}>
 *           <Note time={0} duration={1} pitch={64} vel={0.8} />
 *         </Clip>
 *       </Track>
 *     </Project>
 *   );
 * }
 * ```
 *
 * Each export is the element's TYPE NAME, a string, so the elements carry no identity of
 * this module: the renderer (`./render`) recognizes them by name wherever the piece's copy
 * of this package was resolved from.
 *
 * One name departs from the schema. DAWproject's `Note` spells its MIDI key `key`, which
 * React reserves for list identity, so the prop is `pitch` (a MIDI key number, 0–127).
 * Everything else is the schema's own spelling.
 */

import type { FC, ReactNode } from 'react';

/** Beats from the start of the enclosing timeline (DAWproject `timeUnit="beats"`). */
export type Beats = number;

export interface ProjectProps {
  readonly children?: ReactNode;
}

/** DAWproject `Transport`: `Tempo` in BPM and `TimeSignature`. */
export interface TransportProps {
  readonly tempo: number;
  readonly numerator?: number;
  readonly denominator?: number;
}

/** DAWproject `Track`: a named lane that owns a channel and its clips. */
export interface TrackProps {
  readonly name: string;
  readonly color?: string;
  readonly children?: ReactNode;
}

/** DAWproject `Channel`: the mixer strip. `volume` is in decibels, `pan` in −1…1. */
export interface ChannelProps {
  readonly volume?: number;
  readonly pan?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
  readonly children?: ReactNode;
}

/** DAWproject `Device`: an instrument or effect on a channel, named by its plugin. */
export interface DeviceProps {
  readonly plugin: string;
  readonly name?: string;
  /** The plugin's own parameters, by the plugin's own names. */
  readonly params?: Readonly<Record<string, number | string | boolean>>;
}

/** DAWproject `Clip`: a region of a track's timeline. Its notes' times are relative to it. */
export interface ClipProps {
  readonly time: Beats;
  readonly duration: Beats;
  readonly name?: string;
  readonly children?: ReactNode;
}

/** DAWproject `Note`. `vel` and `rel` are 0…1; `pitch` is the schema's `key`. */
export interface NoteProps {
  readonly time: Beats;
  readonly duration: Beats;
  readonly pitch: number;
  readonly vel?: number;
  readonly rel?: number;
  readonly channel?: number;
}

/** DAWproject `Marker`: a named point on the arrangement's timeline. */
export interface MarkerProps {
  readonly time: Beats;
  readonly name: string;
}

function element<P>(name: string): FC<P> {
  return name as unknown as FC<P>;
}

export const Project = element<ProjectProps>('dawproject.Project');
export const Transport = element<TransportProps>('dawproject.Transport');
export const Track = element<TrackProps>('dawproject.Track');
export const Channel = element<ChannelProps>('dawproject.Channel');
export const Device = element<DeviceProps>('dawproject.Device');
export const Clip = element<ClipProps>('dawproject.Clip');
export const Note = element<NoteProps>('dawproject.Note');
export const Marker = element<MarkerProps>('dawproject.Marker');

/** Every element this package names, keyed by its short name. */
export const ELEMENT_TYPES = {
  Project: 'dawproject.Project',
  Transport: 'dawproject.Transport',
  Track: 'dawproject.Track',
  Channel: 'dawproject.Channel',
  Device: 'dawproject.Device',
  Clip: 'dawproject.Clip',
  Note: 'dawproject.Note',
  Marker: 'dawproject.Marker',
} as const;

export type ElementName = keyof typeof ELEMENT_TYPES;
