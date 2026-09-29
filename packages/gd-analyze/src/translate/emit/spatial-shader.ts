/**
 * The spatial shader mode's built-ins as `three-custom-shader-material` draws them over three's
 * `MeshStandardMaterial` (`spatial-material.ts` in compat): each stage's outputs are locals the
 * stage's prologue declares with Godot's defaults (`servers/rendering/shader_types.cpp:43`, the
 * Compatibility renderer's `scene.glsl`) and its epilogue hands to the library's `csm_*` outputs;
 * its inputs are three's own attributes and varyings. `VERTEX` and `NORMAL` in `vertex()` are the
 * model-space position and normal (Godot's default, without `world_vertex_coords`); in
 * `fragment()`, `NORMAL` and `VIEW` are view-space, as three's `vNormal` and `vViewPosition` are.
 * `TIME` is the material's own uniform, the page's time in seconds (`RenderingServer`'s shader
 * time). A built-in not listed here refuses by name.
 */
import type { GodotShaderBuiltins } from './shader-glsl';

const CONSTANTS = { PI: '3.14159265358979', TAU: '6.28318530717959', E: '2.71828182845905' };

export const GODOT_SPATIAL_VERTEX_BUILTINS: GodotShaderBuiltins = {
  ...CONSTANTS,
  VERTEX: 'godot_VERTEX',
  NORMAL: 'godot_NORMAL',
  UV: 'godot_UV',
  COLOR: 'godot_COLOR',
  TIME: 'godot_TIME',
  MODEL_MATRIX: 'modelMatrix',
  VIEW_MATRIX: 'viewMatrix',
  PROJECTION_MATRIX: 'projectionMatrix',
  INV_VIEW_MATRIX: 'inverse(viewMatrix)',
};

export const GODOT_SPATIAL_FRAGMENT_BUILTINS: GodotShaderBuiltins = {
  ...CONSTANTS,
  ALBEDO: 'godot_ALBEDO',
  ALPHA: 'godot_ALPHA',
  ALPHA_SCISSOR_THRESHOLD: 'godot_ALPHA_SCISSOR_THRESHOLD',
  EMISSION: 'godot_EMISSION',
  ROUGHNESS: 'godot_ROUGHNESS',
  METALLIC: 'godot_METALLIC',
  SPECULAR: 'godot_SPECULAR',
  NORMAL: 'normalize(vNormal)',
  VIEW: 'normalize(vViewPosition)',
  UV: 'godot_v_UV',
  COLOR: 'godot_v_COLOR',
  TIME: 'godot_TIME',
  FRAGCOORD: 'gl_FragCoord',
  FRONT_FACING: 'gl_FrontFacing',
  VIEW_MATRIX: 'viewMatrix',
  PROJECTION_MATRIX: 'projectionMatrix',
};

/** The varyings and uniform every stage declares: the UV and colour the fragment reads, and `TIME`. */
export const GODOT_SPATIAL_SHARED = 'uniform float godot_TIME;\nvarying vec2 godot_v_UV;\nvarying vec4 godot_v_COLOR;';

/** `vertex()`'s prologue and epilogue: its outputs start as the vertex's own, and are handed on. */
export function godotSpatialVertexStage(body: string, builtins: ReadonlySet<string>): string {
  return [
    '\tvec3 godot_VERTEX = position;',
    '\tvec3 godot_NORMAL = normal;',
    '\tvec2 godot_UV = uv;',
    // The mesh's vertex colour, which three declares when the material draws vertex colours.
    '#if defined(USE_COLOR_ALPHA)',
    '\tvec4 godot_COLOR = color;',
    '#elif defined(USE_COLOR)',
    '\tvec4 godot_COLOR = vec4(color, 1.0);',
    '#else',
    '\tvec4 godot_COLOR = vec4(1.0);',
    '#endif',
    body,
    '\tgodot_v_UV = godot_UV;',
    '\tgodot_v_COLOR = godot_COLOR;',
    ...(builtins.has('VERTEX') ? ['\tcsm_Position = godot_VERTEX;'] : []),
    ...(builtins.has('NORMAL') ? ['\tcsm_Normal = godot_NORMAL;'] : []),
  ].join('\n');
}

/** The vertex stage of a shader with no `vertex()`: the UV and colour handed to the fragment. */
export const GODOT_SPATIAL_DEFAULT_VERTEX = godotSpatialVertexStage('', new Set());

/**
 * `fragment()`'s prologue and epilogue: Godot's defaults (`ALBEDO` white, `ALPHA` 1, `ROUGHNESS` 1,
 * `METALLIC` 0, `SPECULAR` 0.5, no emission), then the written ones handed to the library's outputs,
 * and an alpha scissor as the discard Godot's `ALPHA_SCISSOR_THRESHOLD` makes (`scene.glsl`).
 */
export function godotSpatialFragmentStage(body: string, builtins: ReadonlySet<string>): string {
  return [
    '\tvec3 godot_ALBEDO = vec3(1.0);',
    '\tfloat godot_ALPHA = 1.0;',
    '\tfloat godot_ALPHA_SCISSOR_THRESHOLD = 0.0;',
    '\tvec3 godot_EMISSION = vec3(0.0);',
    '\tfloat godot_ROUGHNESS = 1.0;',
    '\tfloat godot_METALLIC = 0.0;',
    '\tfloat godot_SPECULAR = 0.5;',
    body,
    '\tcsm_DiffuseColor = vec4(godot_ALBEDO, godot_ALPHA);',
    ...(builtins.has('EMISSION') ? ['\tcsm_Emissive = godot_EMISSION;'] : []),
    ...(builtins.has('ROUGHNESS') ? ['\tcsm_Roughness = godot_ROUGHNESS;'] : []),
    ...(builtins.has('METALLIC') ? ['\tcsm_Metalness = godot_METALLIC;'] : []),
    ...(builtins.has('ALPHA_SCISSOR_THRESHOLD') ? ['\tif (godot_ALPHA < godot_ALPHA_SCISSOR_THRESHOLD) discard;'] : []),
  ].join('\n');
}

/**
 * The render modes a spatial material draws (`shader_types.cpp:215`), as the three material's
 * settings; the rest of the defaults change nothing three draws, and any other refuses by name.
 */
export const GODOT_SPATIAL_RENDER_MODES: ReadonlySet<string> = new Set([
  'blend_mix',
  'blend_add',
  'cull_back',
  'cull_front',
  'cull_disabled',
  'depth_draw_opaque',
  'depth_draw_never',
  'depth_test_disabled',
  'unshaded',
  // Only beside `unshaded`, which draws no light at all (`spatialShaderPlan`).
  'ambient_light_disabled',
  'shadows_disabled',
  'diffuse_burley',
  'diffuse_lambert',
  'specular_schlick_ggx',
]);
