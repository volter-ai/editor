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
    className: 'TileSet',
    construct: { module: 'lib/godot-compat/tile-set', exportName: 'godot_tile_set_new' },
    source: { file: 'scene/resources/2d/tile_set.cpp', symbol: 'TileSet::_set', line: 3960 },
  },
  {
    sourceRevision: REVISION,
    className: 'TileSetAtlasSource',
    construct: { module: 'lib/godot-compat/tile-set', exportName: 'godot_tile_set_atlas_source_new' },
    source: { file: 'scene/resources/2d/tile_set.cpp', symbol: 'TileSetAtlasSource::_set', line: 5130 },
  },
  {
    sourceRevision: REVISION,
    className: 'Shortcut',
    construct: { module: 'lib/godot-compat/shortcut', exportName: 'godot_shortcut_new' },
    source: { file: 'scene/gui/shortcut.cpp', symbol: 'Shortcut::Shortcut', line: 150 },
  },
  {
    sourceRevision: REVISION,
    className: 'ButtonGroup',
    construct: { module: 'lib/godot-compat/button-group', exportName: 'construct' },
    source: { file: 'scene/gui/base_button.cpp', symbol: 'ButtonGroup::ButtonGroup', line: 645 },
  },
  {
    sourceRevision: REVISION,
    className: 'InputEventAction',
    construct: { module: 'lib/godot-compat/input-event-action', exportName: 'godot_input_event_action_new' },
    source: { file: 'core/input/input_event.cpp', symbol: 'InputEventAction::InputEventAction', line: 1620 },
  },
  {
    sourceRevision: REVISION,
    className: 'CanvasItemMaterial',
    construct: { module: 'lib/godot-compat/canvas-item-material', exportName: 'godot_canvas_item_material_new' },
    source: { file: 'scene/resources/canvas_item_material.cpp', symbol: 'CanvasItemMaterial::CanvasItemMaterial', line: 267 },
  },
  {
    sourceRevision: REVISION,
    className: 'SpriteFrames',
    construct: { module: 'lib/godot-compat/sprite-frames', exportName: 'godot_sprite_frames_new' },
    source: { file: 'scene/resources/sprite_frames.cpp', symbol: 'SpriteFrames::SpriteFrames', line: 268 },
  },
];
