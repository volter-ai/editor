/**
 * How a script's `load(path)` makes each imported file it can load (`resource-loads.ts`), by the
 * importer that imported it: the compat protocol that loads it from its copy beside the app, as a
 * scene's resource of that kind is loaded. The copy is served at `/godot/<path under res://>`,
 * where the translation writes imported assets.
 */
import type { ImportedResourceKind } from '../../analyze/resource-loads';

export interface GodotCodeResourceLoad {
  readonly module: string;
  readonly exportName: string;
}

/** A kind absent here has no code-level load yet: such a `load()` refuses. */
export const GODOT_CODE_RESOURCE_LOADS: Readonly<Partial<Record<ImportedResourceKind, GodotCodeResourceLoad>>> = {
  // `AudioStreamOggVorbis::load_from_buffer` (modules/vorbis/audio_stream_ogg_vorbis.cpp:581).
  'ogg-vorbis': { module: 'lib/godot-compat/audio-stream-ogg-vorbis', exportName: 'godot_audio_stream_ogg_vorbis_load' },
  mp3: { module: 'lib/godot-compat/audio-stream-mp3', exportName: 'godot_audio_stream_mp3_load' },
  // `CompressedTexture2D::load` (scene/resources/compressed_texture.cpp:132).
  texture: { module: 'lib/godot-compat/compressed-texture-2d', exportName: 'godot_compressed_texture_2d_load' },
};

/** The URL an imported asset's copy is served at. */
export function godotImportedAssetUrl(resPath: string): string {
  return `/godot/${resPath.slice('res://'.length)}`;
}
