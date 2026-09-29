/**
 * The canvas_item shader mode's `fragment()` built-ins (`servers/rendering/shader_types.cpp:319`),
 * as compat's canvas shader material declares them (`canvas-shader-material.ts`): the item's rect
 * drawn as one quad, its `UV` from the top-left, `COLOR` the item's colour times its texture's texel
 * there (Godot's default white 4×4 texture for an untextured draw, `texture_storage.cpp:85`), and the
 * screen's coordinates from the item's rect on it. `vertex()`, `light()` and the other built-ins
 * refuse by name.
 */
import type { GodotShaderBuiltins } from './shader-glsl';

export const GODOT_CANVAS_FRAGMENT_BUILTINS: GodotShaderBuiltins = {
  PI: '3.14159265358979',
  TAU: '6.28318530717959',
  E: '2.71828182845905',
  COLOR: 'godot_COLOR',
  UV: 'godot_v_UV',
  TEXTURE: 'godot_TEXTURE',
  TEXTURE_PIXEL_SIZE: 'godot_TEXTURE_PIXEL_SIZE',
  SCREEN_UV: 'godot_SCREEN_UV',
  SCREEN_PIXEL_SIZE: 'godot_SCREEN_PIXEL_SIZE',
  FRAGCOORD: 'vec4(godot_SCREEN_UV / godot_SCREEN_PIXEL_SIZE, gl_FragCoord.zw)',
  TIME: 'godot_TIME',
};

/** The uniforms and varying every canvas stage declares, which compat sets for each item it draws. */
export const GODOT_CANVAS_SHARED = [
  'uniform float godot_TIME;',
  'uniform sampler2D godot_TEXTURE;',
  'uniform vec2 godot_TEXTURE_PIXEL_SIZE;',
  'uniform vec4 godot_COLOR_IN;',
  '// The item\'s rect on the screen, in screen UV from the top-left: its corner and its size.',
  'uniform vec4 godot_SCREEN_RECT;',
  'uniform vec2 godot_SCREEN_PIXEL_SIZE;',
  'varying vec2 godot_v_UV;',
].join('\n');

/** The quad's vertex stage: its corners over the whole target, `UV` from the top-left. */
export const GODOT_CANVAS_VERTEX = [GODOT_CANVAS_SHARED, 'void main() {', '\tgodot_v_UV = vec2(uv.x, 1.0 - uv.y);', '\tgl_Position = vec4(position.xy, 0.0, 1.0);', '}'].join('\n');

/** `fragment()`'s prologue and epilogue: `COLOR` in, the screen UV at the fragment, `COLOR` out. */
export function godotCanvasFragmentStage(head: string, body: string): string {
  return [
    GODOT_CANVAS_SHARED,
    head,
    'void main() {',
    '\tvec4 godot_COLOR = godot_COLOR_IN * texture(godot_TEXTURE, godot_v_UV);',
    '\tvec2 godot_SCREEN_UV = godot_SCREEN_RECT.xy + godot_v_UV * godot_SCREEN_RECT.zw;',
    body,
    '\tgl_FragColor = godot_COLOR;',
    '}',
  ].join('\n');
}
