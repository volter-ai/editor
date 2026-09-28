/**
 * @godot-class AudioStreamOggVorbis
 * @role BINDING
 *
 * Godot 4.7's `AudioStreamOggVorbis` (`modules/vorbis/audio_stream_ogg_vorbis.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a Web Audio `AudioBuffer`: the `.ogg` file
 * is copied beside the app and decoded by the browser, which reads Ogg Vorbis itself; its loop and
 * loop offset are the `oggvorbisstr` importer's options (`resource_importer_ogg_vorbis.cpp`).
 */

import { use } from 'react';
import { godot_audio_stream_register } from './audio-stream';
import { godot_resource_loader_track } from './resource-loader';

/** The `oggvorbisstr` importer options the import applies. */
export interface GodotOggVorbisImport {
  readonly loop: boolean;
  readonly loopOffset: number;
}

export interface AudioStreamOggVorbis {
  loop: boolean;
  loopOffset: number;
  buffer: AudioBuffer | null;
}

function stream(options: GodotOggVorbisImport): AudioStreamOggVorbis {
  const self: AudioStreamOggVorbis = { loop: options.loop, loopOffset: options.loopOffset, buffer: null };
  godot_audio_stream_register(self, {
    length: () => self.buffer?.duration ?? 0,
    start: () => ({
      buffer: self.buffer,
      loop: self.loop && self.buffer !== null ? { begin: self.loopOffset, end: self.buffer.duration } : null,
      pitchScale: 1,
      volumeScale: 1,
    }),
  });
  return self;
}

/** The copied file at `url`, decoded by the browser (no page gesture is needed to decode). */
async function decode(self: AudioStreamOggVorbis, url: string): Promise<void> {
  const bytes = await (await fetch(url)).arrayBuffer();
  self.buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
}

/**
 * `load()` of an imported `.ogg`: the stream now, its samples once the copied file at `url` is
 * decoded; the load is tracked so the scenes mount after it.
 *
 * @godot AudioStreamOggVorbis (protocol)
 * @source modules/vorbis/audio_stream_ogg_vorbis.cpp:581
 */
export function godot_audio_stream_ogg_vorbis_load(url: string, options: GodotOggVorbisImport): AudioStreamOggVorbis {
  const self = stream(options);
  godot_resource_loader_track(decode(self, url));
  return self;
}

const SCENE_LOADS = new Map<string, { readonly stream: AudioStreamOggVorbis; readonly loaded: Promise<void> }>();

/**
 * A scene's imported `.ogg`, as a component loads it: the stream of the copied file at `url`, once
 * for every scene that uses it (Godot's resource cache), the component suspended until it decodes.
 *
 * @godot AudioStreamOggVorbis (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function useGodotAudioStreamOggVorbis(url: string, options: GodotOggVorbisImport): AudioStreamOggVorbis {
  const key = `${url}\0${JSON.stringify(options)}`;
  let load = SCENE_LOADS.get(key);
  if (load === undefined) {
    const self = stream(options);
    load = { stream: self, loaded: decode(self, url) };
    SCENE_LOADS.set(key, load);
  }
  use(load.loaded);
  return load.stream;
}

/**
 * @godot AudioStreamOggVorbis.set_loop
 * @source modules/vorbis/audio_stream_ogg_vorbis.cpp:502
 */
export function set_loop(self: AudioStreamOggVorbis, enable: boolean): void {
  self.loop = Boolean(enable);
}

/**
 * @godot AudioStreamOggVorbis.has_loop
 * @source modules/vorbis/audio_stream_ogg_vorbis.cpp:506
 */
export function has_loop(self: AudioStreamOggVorbis): boolean {
  return self.loop;
}

/**
 * @godot AudioStreamOggVorbis.set_loop_offset
 * @source modules/vorbis/audio_stream_ogg_vorbis.cpp:510
 */
export function set_loop_offset(self: AudioStreamOggVorbis, seconds: number): void {
  self.loopOffset = seconds;
}

/**
 * @godot AudioStreamOggVorbis.get_loop_offset
 * @source modules/vorbis/audio_stream_ogg_vorbis.cpp:514
 */
export function get_loop_offset(self: AudioStreamOggVorbis): number {
  return self.loopOffset;
}
