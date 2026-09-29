/**
 * @godot-class AudioStreamMP3
 * @role BINDING
 *
 * Godot 4.7's `AudioStreamMP3` (`modules/mp3/audio_stream_mp3.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a Web Audio `AudioBuffer` as an Ogg stream
 * is (`audio-stream-ogg-vorbis.ts`): the `.mp3` file is copied beside the app and decoded by the
 * browser, which reads MP3 itself; its loop and loop offset are the `mp3` importer's options
 * (`resource_importer_mp3.cpp`).
 */

import { type AudioStreamOggVorbis, type GodotOggVorbisImport, godot_audio_stream_ogg_vorbis_load, useGodotAudioStreamOggVorbis } from './audio-stream-ogg-vorbis';

export type AudioStreamMP3 = AudioStreamOggVorbis;

/**
 * `load()` of an imported `.mp3`: the stream now, its samples once the copied file is decoded.
 *
 * @godot AudioStreamMP3 (protocol)
 * @source modules/mp3/audio_stream_mp3.cpp:315
 */
export function godot_audio_stream_mp3_load(url: string, options: GodotOggVorbisImport): AudioStreamMP3 {
  return godot_audio_stream_ogg_vorbis_load(url, options);
}

/**
 * A scene's imported `.mp3`, as a component loads it (Godot's resource cache), suspended until it decodes.
 *
 * @godot AudioStreamMP3 (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function useGodotAudioStreamMP3(url: string, options: GodotOggVorbisImport): AudioStreamMP3 {
  return useGodotAudioStreamOggVorbis(url, options);
}
