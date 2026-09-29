/**
 * @godot-class AudioStream
 * @role BINDING
 *
 * Godot 4.7's `AudioStream` (`servers/audio/audio_stream.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto Web Audio, as the web export plays audio
 * (`platform/web/audio_driver_web.cpp`): a stream class registers, for its resources, its length
 * and how a playback of it starts (the buffer a Web Audio source plays, with the pitch and volume
 * the class adds); the page's one `AudioContext` is created when a player first needs it and
 * resumed after the page's input (`OS_Web::resume_audio`; browsers start it suspended).
 */

import { AudioContext as ThreeAudioContext } from 'three';
/** What a stream class gives a playback: the samples, loop points, and its own pitch and gain. */
export interface GodotAudioStart {
  readonly buffer: AudioBuffer | null;
  readonly loop: { readonly begin: number; readonly end: number } | null;
  readonly pitchScale: number;
  readonly volumeScale: number;
}

interface StreamClass {
  readonly length: () => number;
  readonly start: (context: AudioContext) => GodotAudioStart;
}

const STREAMS = new WeakMap<object, StreamClass>();
let context: AudioContext | null | undefined;

/**
 * Registers a stream resource's class behaviour.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_stream.cpp:334
 */
export function godot_audio_stream_register(stream: object, behaviour: StreamClass): void {
  STREAMS.set(stream, behaviour);
}

/**
 * How a playback of `stream` starts, or null for a stream no class registered.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_stream.cpp:334
 */
export function godot_audio_stream_start(stream: object, audio: AudioContext): GodotAudioStart | null {
  return STREAMS.get(stream)?.start(audio) ?? null;
}

/**
 * The page's audio context, created on first use; null where the page has no Web Audio.
 *
 * @godot AudioStream (protocol)
 * @source platform/web/audio_driver_web.cpp:123
 */
export function godot_audio_context(): AudioContext | null {
  if (context === undefined) {
    const Constructor = (globalThis as { readonly AudioContext?: new () => AudioContext }).AudioContext;
    // three's shared context (`AudioContext.getContext`), which its own audio nodes use too.
    context = Constructor === undefined ? null : ThreeAudioContext.getContext();
  }
  return context;
}

/** A bus as the layout states it (`bus/N/*` of the default bus layout). */
export interface GodotAudioBusLayout {
  readonly name: string;
  readonly volumeDb: number;
  readonly mute: boolean;
  readonly solo: boolean;
  readonly bypassFx: boolean;
  readonly send: string;
}

/**
 * A bus on the page: a gain node of its volume, into a gain node of its mute, into one silenced
 * while another bus is soloed, into its send target's volume (Master's into the output). What Web
 * Audio cannot hold, whether it is soloed and the bus it sends to, is kept beside them.
 */
export interface GodotAudioBus {
  readonly name: string;
  readonly volume: GainNode;
  readonly mute: GainNode;
  readonly unsoloed: GainNode;
  solo: boolean;
  readonly send: string;
}

/** The page's buses, in the layout's order (Master first), once its audio context exists. */
let buses: GodotAudioBus[] | undefined;
let layout: readonly GodotAudioBusLayout[] = [{ name: 'Master', volumeDb: 0, mute: false, solo: false, bypassFx: false, send: '' }];

/** The buses of the layout as gain nodes on the page's context, wired to their targets. */
function busesOf(audio: AudioContext): GodotAudioBus[] {
  if (buses !== undefined) return buses;
  const made = layout.map((entry): GodotAudioBus => {
    const volume = audio.createGain();
    const mute = audio.createGain();
    const unsoloed = audio.createGain();
    volume.gain.value = 10 ** (entry.volumeDb / 20);
    mute.gain.value = entry.mute ? 0 : 1;
    volume.connect(mute).connect(unsoloed);
    return { name: entry.name, volume, mute, unsoloed, solo: entry.solo, send: entry.send };
  });
  // Each bus into its send (a bus the layout lacks is Master); Master, and a bus sending to itself or before
  // it, into the output.
  made.forEach((bus, index) => {
    const target = index === 0 ? undefined : (made.find((other) => other.name === bus.send) ?? made[0]);
    bus.unsoloed.connect(target === undefined || made.indexOf(target) >= index ? audio.destination : target.volume);
  });
  buses = made;
  soloed();
  return made;
}

/** Silences every bus but Master and the soloed ones while any is soloed. */
function soloed(): void {
  const all = buses ?? [];
  const soloing = all.some((bus) => bus.solo);
  all.forEach((bus, index) => {
    bus.unsoloed.gain.value = soloing && !bus.solo && index !== 0 ? 0 : 1;
  });
}

/**
 * The page's buses, which `AudioServer` reads and changes (`audio-server.ts`); none where the page
 * has no Web Audio.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:944
 */
export function godot_audio_buses(): readonly GodotAudioBus[] {
  const audio = godot_audio_context();
  return audio === null ? [] : busesOf(audio);
}

/**
 * The default bus layout, set as the world starts (`AudioServer::set_bus_layout`,
 * `audio_server.cpp:1755`): Master first.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:1755
 */
export function godot_audio_bus_layout(entries: readonly GodotAudioBusLayout[]): void {
  for (const bus of buses ?? []) bus.unsoloed.disconnect();
  layout = entries;
  buses = undefined;
}

/**
 * The bus a player's sound goes into (a bus the layout lacks is Master, as
 * `AudioServer::thread_find_bus_index` finds): its volume node.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:997
 */
export function godot_audio_bus_output(audio: AudioContext, bus: string): AudioNode {
  const all = busesOf(audio);
  return (all.find((entry) => entry.name === bus) ?? (all[0] as GodotAudioBus)).volume;
}

/**
 * `OS_Web::resume_audio` (`platform/web/os_web.cpp:62`): resumes a context the browser suspended until
 * the page's input.
 *
 * @godot AudioStream (protocol)
 * @source platform/web/os_web.cpp:62
 */
export function godot_audio_resume(): void {
  if (context !== undefined && context !== null && context.state === 'suspended') void context.resume();
}

/**
 * The stream's length in seconds; 0 for a stream no class registered.
 *
 * @godot AudioStream.get_length
 * @source servers/audio/audio_stream.cpp:253
 */
export function get_length(self: object): number {
  return STREAMS.get(self)?.length() ?? 0;
}
