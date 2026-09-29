/**
 * @godot-class CanvasItemMaterial
 * @role BINDING
 *
 * Godot 4.7's `CanvasItemMaterial` (`scene/resources/canvas_item_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): how a canvas item blends into what is behind it,
 * drawn on the page as its element's CSS blend mode. The light mode and particle animation are
 * stored: the page's canvas has no 2D lights.
 */

export interface CanvasItemMaterial {
  blendMode: number;
  lightMode: number;
  particlesAnimation: boolean;
}

const MATERIALS = new WeakSet<object>();

/** `CanvasItemMaterial::BlendMode` (`canvas_item_material.h:41`) as CSS blends: mix, add, sub, mul, premultiplied alpha. */
const CSS_BLENDS = ['normal', 'plus-lighter', 'difference', 'multiply', 'normal'];

/**
 * A new CanvasItemMaterial, with the properties a scene states (`blendMode`, `lightMode`).
 *
 * @godot CanvasItemMaterial (protocol)
 * @source scene/resources/canvas_item_material.cpp:267
 */
export function godot_canvas_item_material_new(properties: Readonly<Record<string, unknown>> = {}): CanvasItemMaterial {
  const self: CanvasItemMaterial = {
    blendMode: (properties['blendMode'] as number | undefined) ?? 0,
    lightMode: (properties['lightMode'] as number | undefined) ?? 0,
    particlesAnimation: (properties['particlesAnimation'] as boolean | undefined) ?? false,
  };
  MATERIALS.add(self);
  return self;
}

/**
 * @godot CanvasItemMaterial.CanvasItemMaterial
 * @source scene/resources/canvas_item_material.cpp:267
 */
export function construct(): CanvasItemMaterial {
  return godot_canvas_item_material_new();
}

/**
 * The CSS blend mode a material draws its item with; `normal` for any other material (a shader
 * material's shader is not run by the page's canvas).
 *
 * @godot CanvasItemMaterial (protocol)
 * @source scene/resources/canvas_item_material.cpp:66
 */
export function godot_canvas_item_material_css_blend(material: object | null): string {
  return material !== null && MATERIALS.has(material) ? (CSS_BLENDS[(material as CanvasItemMaterial).blendMode] ?? 'normal') : 'normal';
}

/**
 * @godot CanvasItemMaterial.set_blend_mode
 * @source scene/resources/canvas_item_material.cpp:167
 */
export function set_blend_mode(self: CanvasItemMaterial, mode: number): void {
  self.blendMode = mode;
}

/**
 * @godot CanvasItemMaterial.get_blend_mode
 * @source scene/resources/canvas_item_material.cpp:176
 */
export function get_blend_mode(self: CanvasItemMaterial): number {
  return self.blendMode;
}

/**
 * @godot CanvasItemMaterial.set_light_mode
 * @source scene/resources/canvas_item_material.cpp:180
 */
export function set_light_mode(self: CanvasItemMaterial, mode: number): void {
  self.lightMode = mode;
}

/**
 * @godot CanvasItemMaterial.get_light_mode
 * @source scene/resources/canvas_item_material.cpp:189
 */
export function get_light_mode(self: CanvasItemMaterial): number {
  return self.lightMode;
}
