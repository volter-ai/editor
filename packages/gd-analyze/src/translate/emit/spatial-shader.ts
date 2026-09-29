/**
 * The spatial shader mode's built-ins as `three-custom-shader-material` draws them over three's
 * `MeshStandardMaterial` (`spatial-material.ts` in compat): each stage's outputs are locals the
 * stage's prologue declares with Godot's defaults (`servers/rendering/shader_types.cpp:43`, the
 * Compatibility renderer's `scene.glsl`) and its epilogue hands to the library's `csm_*` outputs;
 * its inputs are three's own attributes and varyings. `VERTEX` and `NORMAL` in `vertex()` are the
 * model-space position and normal (world-space with `world_vertex_coords`); in `fragment()`,
 * `NORMAL` and `VIEW` are view-space, as three's `vNormal` and `vViewPosition` are. A `TANGENT` and
 * `BINORMAL` `vertex()` writes are the tangent frame a `NORMAL_MAP` is read in.
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
  MODELVIEW_MATRIX: 'modelViewMatrix',
  NODE_POSITION_WORLD: 'modelMatrix[3].xyz',
  INSTANCE_ID: 'gl_InstanceID',
  TANGENT: 'godot_TANGENT',
  BINORMAL: 'godot_BINORMAL',
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
  NORMAL_MAP: 'godot_NORMAL_MAP',
  NORMAL_MAP_DEPTH: 'godot_NORMAL_MAP_DEPTH',
  NORMAL: 'normalize(vNormal)',
  VIEW: 'normalize(vViewPosition)',
  UV: 'godot_v_UV',
  COLOR: 'godot_v_COLOR',
  TIME: 'godot_TIME',
  FRAGCOORD: 'gl_FragCoord',
  FRONT_FACING: 'gl_FrontFacing',
  VIEW_MATRIX: 'viewMatrix',
  PROJECTION_MATRIX: 'projectionMatrix',
  NODE_POSITION_WORLD: 'godot_v_NODE_POSITION_WORLD',
};

/**
 * The varyings and uniform every stage declares: the UV, colour and node position the fragment
 * reads, the view-space tangent frame `vertex()` writes, and `TIME`.
 */
export const GODOT_SPATIAL_SHARED =
  'uniform float godot_TIME;\nvarying vec2 godot_v_UV;\nvarying vec4 godot_v_COLOR;\nvarying vec3 godot_v_NODE_POSITION_WORLD;\nvarying vec3 godot_v_TANGENT;\nvarying vec3 godot_v_BINORMAL;';

/** How a spatial shader's stages are drawn: its `world_vertex_coords`, and whether `vertex()` writes a tangent frame. */
export interface GodotSpatialStageOptions {
  readonly worldVertexCoords: boolean;
  readonly vertexTangents: boolean;
}

/**
 * `vertex()`'s prologue and epilogue: its outputs start as the vertex's own (in world space with
 * `world_vertex_coords`), and are handed on in model space; the tangent frame it writes goes to the
 * fragment in view space.
 */
export function godotSpatialVertexStage(body: string, builtins: ReadonlySet<string>, options: GodotSpatialStageOptions = { worldVertexCoords: false, vertexTangents: false }): string {
  const world = options.worldVertexCoords;
  const toView = world ? 'mat3(viewMatrix)' : 'normalMatrix';
  return [
    world ? '\tvec3 godot_VERTEX = (modelMatrix * vec4(position, 1.0)).xyz;' : '\tvec3 godot_VERTEX = position;',
    world ? '\tvec3 godot_NORMAL = normalize(mat3(modelMatrix) * normal);' : '\tvec3 godot_NORMAL = normal;',
    '\tvec3 godot_TANGENT = vec3(0.0);',
    '\tvec3 godot_BINORMAL = vec3(0.0);',
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
    '\tgodot_v_NODE_POSITION_WORLD = modelMatrix[3].xyz;',
    `\tgodot_v_TANGENT = ${toView} * godot_TANGENT;`,
    `\tgodot_v_BINORMAL = ${toView} * godot_BINORMAL;`,
    ...(builtins.has('VERTEX') ? [world ? '\tcsm_Position = (inverse(modelMatrix) * vec4(godot_VERTEX, 1.0)).xyz;' : '\tcsm_Position = godot_VERTEX;'] : []),
    ...(builtins.has('NORMAL') ? [world ? '\tcsm_Normal = normalize(inverse(mat3(modelMatrix)) * godot_NORMAL);' : '\tcsm_Normal = godot_NORMAL;'] : []),
  ].join('\n');
}

/** The vertex stage of a shader with no `vertex()`: the UV and colour handed to the fragment. */
export const GODOT_SPATIAL_DEFAULT_VERTEX = godotSpatialVertexStage('', new Set());

/**
 * A written `NORMAL_MAP` as the fragment's view-space normal (`csm_FragNormal`): its tangent-space
 * normal, blue rebuilt from red and green as Godot does (`scene.glsl`), in the tangent frame three
 * builds from the screen-space derivatives of the position and UV (`getTangentFrame`,
 * `normalmap_pars_fragment`), mixed into the surface's normal by `NORMAL_MAP_DEPTH`.
 */
const NORMAL_MAP_SURFACE = [
  '\tvec3 godot_n = normalize(vNormal);',
  '#ifdef DOUBLE_SIDED',
  '\tgodot_n *= gl_FrontFacing ? 1.0 : -1.0;',
  '#endif',
];
const NORMAL_MAP_OUTPUT = [
  '\tvec2 godot_nm = godot_NORMAL_MAP.xy * 2.0 - 1.0;',
  '\tvec3 godot_mapped = godot_t * godot_nm.x + godot_b * godot_nm.y + godot_n * sqrt(max(0.0, 1.0 - dot(godot_nm, godot_nm)));',
  '\tcsm_FragNormal = normalize(mix(godot_n, godot_mapped, godot_NORMAL_MAP_DEPTH));',
];
/** The tangent frame `vertex()` wrote. */
const NORMAL_MAP_WRITTEN_FRAME = ['\tvec3 godot_t = normalize(godot_v_TANGENT);', '\tvec3 godot_b = normalize(godot_v_BINORMAL);'];
/** Three's frame from the derivatives, where `vertex()` wrote none. */
const NORMAL_MAP_DERIVED_FRAME = [
  '\tvec3 godot_q0 = dFdx(-vViewPosition);',
  '\tvec3 godot_q1 = dFdy(-vViewPosition);',
  '\tvec2 godot_st0 = dFdx(godot_v_UV);',
  '\tvec2 godot_st1 = dFdy(godot_v_UV);',
  '\tvec3 godot_q1perp = cross(godot_q1, godot_n);',
  '\tvec3 godot_q0perp = cross(godot_n, godot_q0);',
  '\tvec3 godot_t = godot_q1perp * godot_st0.x + godot_q0perp * godot_st1.x;',
  '\tvec3 godot_b = godot_q1perp * godot_st0.y + godot_q0perp * godot_st1.y;',
  '\tfloat godot_det = max(dot(godot_t, godot_t), dot(godot_b, godot_b));',
  '\tfloat godot_frame = godot_det == 0.0 ? 0.0 : inversesqrt(godot_det);',
  '\tgodot_t *= godot_frame;',
  '\tgodot_b *= godot_frame;',
];

/**
 * `fragment()`'s prologue and epilogue: Godot's defaults (`ALBEDO` white, `ALPHA` 1, `ROUGHNESS` 1,
 * `METALLIC` 0, `SPECULAR` 0.5, no emission, a flat normal map at depth 1), then the written ones
 * handed to the library's outputs, and an alpha scissor as the discard Godot's
 * `ALPHA_SCISSOR_THRESHOLD` makes (`scene.glsl`).
 */
export function godotSpatialFragmentStage(body: string, builtins: ReadonlySet<string>, options: GodotSpatialStageOptions = { worldVertexCoords: false, vertexTangents: false }): string {
  return [
    '\tvec3 godot_ALBEDO = vec3(1.0);',
    '\tfloat godot_ALPHA = 1.0;',
    '\tfloat godot_ALPHA_SCISSOR_THRESHOLD = 0.0;',
    '\tvec3 godot_EMISSION = vec3(0.0);',
    '\tfloat godot_ROUGHNESS = 1.0;',
    '\tfloat godot_METALLIC = 0.0;',
    '\tfloat godot_SPECULAR = 0.5;',
    '\tvec3 godot_NORMAL_MAP = vec3(0.5, 0.5, 1.0);',
    '\tfloat godot_NORMAL_MAP_DEPTH = 1.0;',
    body,
    '\tcsm_DiffuseColor = vec4(godot_ALBEDO, godot_ALPHA);',
    ...(builtins.has('EMISSION') ? ['\tcsm_Emissive = godot_EMISSION;'] : []),
    ...(builtins.has('ROUGHNESS') ? ['\tcsm_Roughness = godot_ROUGHNESS;'] : []),
    ...(builtins.has('METALLIC') ? ['\tcsm_Metalness = godot_METALLIC;'] : []),
    ...(builtins.has('NORMAL_MAP') ? [...NORMAL_MAP_SURFACE, ...(options.vertexTangents ? NORMAL_MAP_WRITTEN_FRAME : NORMAL_MAP_DERIVED_FRAME), ...NORMAL_MAP_OUTPUT] : []),
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
  'depth_draw_always',
  'depth_draw_never',
  'depth_test_disabled',
  'unshaded',
  // Lit, three's indirect light zeroed (compat's `spatial-material.ts`).
  'ambient_light_disabled',
  'shadows_disabled',
  'diffuse_burley',
  'diffuse_lambert',
  'specular_schlick_ggx',
  // `vertex()`'s VERTEX, NORMAL and tangent frame in world space (`godotSpatialVertexStage`).
  'world_vertex_coords',
  // Skinned along a particle's trail: the emitter skins the trail mesh itself (compat's
  // `cpu-particles-3d.ts`), whatever material draws it.
  'particle_trails',
]);
