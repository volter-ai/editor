/**
 * Imported textures: an image the `texture` importer imports losslessly, loaded by
 * `CompressedTexture2D` from its copy beside the app.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_TEXTURE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    className: 'CompressedTexture2D',
    construct: { module: 'lib/godot-compat/compressed-texture-2d', exportName: 'godot_compressed_texture_2d_load' },
    source: { file: 'scene/resources/compressed_texture.cpp', symbol: 'CompressedTexture2D::load', line: 132 },
  },
  {
    sourceRevision: REVISION,
    className: 'AtlasTexture',
    construct: { module: 'lib/godot-compat/atlas-texture', exportName: 'godot_atlas_texture_new' },
    source: { file: 'scene/resources/atlas_texture.cpp', symbol: 'AtlasTexture::AtlasTexture', line: 280 },
  },
  {
    sourceRevision: REVISION,
    className: 'SpriteFrames',
    construct: { module: 'lib/godot-compat/sprite-frames', exportName: 'godot_sprite_frames_new' },
    source: { file: 'scene/resources/sprite_frames.cpp', symbol: 'SpriteFrames::SpriteFrames', line: 268 },
  },
];
