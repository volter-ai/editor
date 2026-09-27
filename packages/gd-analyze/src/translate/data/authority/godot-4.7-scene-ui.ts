/**
 * UI node families: canvas layers, Controls and their containers, labels and texture rects, 2D
 * nodes, sprites and touch-screen buttons, and the resources they take (canvas and placeholder
 * textures, label settings).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_UI_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['CanvasTexture', 'canvas-texture', 'godot_canvas_texture_new', 'scene/main/canvas_item.cpp', 2087],
    ['PlaceholderTexture2D', 'placeholder-texture-2d', 'godot_placeholder_texture_2d_new', 'scene/resources/placeholder_textures.cpp', 70],
    ['LabelSettings', 'label-settings', 'godot_label_settings_new', 'scene/resources/label_settings.h', 152],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  source: { file, symbol: `${className}::${className}`, line },
}));
