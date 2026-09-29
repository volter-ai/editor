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

/** One bus of the layout (`AudioServer::Bus`): its volume, mute, solo, bypass and send. */
export interface GodotAudioBus {
  readonly name: string;
  volumeDb: number;
  mute: boolean;
  solo: boolean;
  bypassFx: boolean;
  send: string;
}

const BUSES: GodotAudioBus[] = [{ name: 'Master', volumeDb: 0, mute: false, solo: false, bypassFx: false, send: '' }];
const NODES = new WeakMap<AudioContext, Map<string, GainNode>>();

/**
 * The layout's buses, which `AudioServer` reads and changes (`audio-server.ts`).
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:944
 */
export function godot_audio_buses(): GodotAudioBus[] {
  return BUSES;
}

/**
 * The default bus layout, set as the world starts (`AudioServer::set_bus_layout`,
 * `audio_server.cpp:1755`): Master first.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:1755
 */
export function godot_audio_bus_layout(buses: readonly Readonly<GodotAudioBus>[]): void {
  BUSES.splice(0, BUSES.length, ...buses.map((bus) => ({ ...bus })));
  if (context !== undefined && context !== null) NODES.delete(context);
}

/** A bus's gain: silent while muted, or while another bus is soloed and it is not. */
function gainOf(bus: GodotAudioBus): number {
  const soloing = BUSES.some((other) => other.solo);
  return bus.mute || (soloing && !bus.solo && bus !== BUSES[0]) ? 0 : 10 ** (bus.volumeDb / 20);
}

/**
 * The bus a player's sound goes into (a bus the layout lacks is Master, as
 * `AudioServer::thread_find_bus_index` finds): a gain node sending into its target bus, Master
 * into the page's output.
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:997
 */
export function godot_audio_bus_output(audio: AudioContext, bus: string): AudioNode {
  let nodes = NODES.get(audio);
  if (nodes === undefined) {
    nodes = new Map();
    NODES.set(audio, nodes);
  }
  const node = (target: GodotAudioBus, depth: number): GainNode => {
    let gain = nodes.get(target.name);
    if (gain === undefined) {
      gain = audio.createGain();
      gain.gain.value = gainOf(target);
      const send = target === BUSES[0] || depth > BUSES.length ? undefined : (BUSES.find((other) => other.name === target.send) ?? BUSES[0]);
      gain.connect(send === undefined || send === target ? audio.destination : node(send, depth + 1));
      nodes.set(target.name, gain);
    }
    return gain;
  };
  return node(BUSES.find((entry) => entry.name === bus) ?? (BUSES[0] as GodotAudioBus), 0);
}

/**
 * The buses' gains after a change to their volume, mute or solo (`AudioServer`'s setters).
 *
 * @godot AudioStream (protocol)
 * @source servers/audio/audio_server.cpp:1006
 */
export function godot_audio_bus_changed(): void {
  const nodes = context === undefined || context === null ? undefined : NODES.get(context);
  if (nodes === undefined) return;
  for (const bus of BUSES) {
    const gain = nodes.get(bus.name);
    if (gain !== undefined) gain.gain.value = gainOf(bus);
  }
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
