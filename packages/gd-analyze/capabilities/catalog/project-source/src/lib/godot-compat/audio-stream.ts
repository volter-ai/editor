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
    context = Constructor === undefined ? null : new Constructor();
  }
  return context;
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
