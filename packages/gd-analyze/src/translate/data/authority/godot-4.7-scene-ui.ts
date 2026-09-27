/**
 * UI node families: canvas layers, Controls and their containers, labels and texture rects, 2D
 * nodes, sprites and touch-screen buttons, and the resources they take (canvas and placeholder
 * textures, label settings).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneNodeRule, GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

/** Each UI class: the compat element that writes it (`Godot<Class>` in its module), and its constructor. */
export const GODOT_4_7_UI_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = (
  [
    ['CanvasLayer', 'canvas-layer', 'scene/main/canvas_layer.cpp', 359],
    ['Control', 'control', 'scene/gui/control.cpp', 5161],
    ['HBoxContainer', 'h-box-container', 'scene/gui/box_container.h', 85],
    ['Label', 'label', 'scene/gui/label.cpp', 1526],
    ['TextureRect', 'texture-rect', 'scene/gui/texture_rect.cpp', 299],
    ['Node2D', 'node-2d', 'scene/2d/node_2d.cpp', 519],
    ['Sprite2D', 'sprite-2d', 'scene/2d/sprite_2d.cpp', 555],
    ['TouchScreenButton', 'touch-screen-button', 'scene/2d/physics/touch_screen_button.cpp', 458],
  ] as const
).map(([className, module, file, line]) => ({
  sourceRevision: REVISION,
  nativeCanonicalIdentity: identityOf(className),
  targetKind: 'three-node' as const,
  source: { file, symbol: `${className}::${className}`, line },
}));

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
