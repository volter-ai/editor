/**
 * @godot-class Shader
 * @role BINDING
 *
 * Godot 4.7's `Shader` (`scene/resources/shader.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the translation hands it over: a `.gdshader` read
 * by the pinned Godot's own shader frontend at import and lowered to GLSL (`shader-glsl.ts`), its
 * mode, uniforms, helper functions and entry body. How a mode's material draws the code is its
 * user's (`world-environment.ts` for a sky).
 */

/** `Shader::Mode` (`shader.h:45`). */
const MODES: Readonly<Record<string, number>> = { spatial: 0, canvas_item: 1, particles: 2, sky: 3, fog: 4 };

/** A lowered uniform: its Godot and GLSL names, its GLSL type, its default and whether it samples. */
export interface GodotShaderUniform {
  readonly name: string;
  readonly glsl: string;
  readonly type: string;
  readonly default: readonly number[] | null;
  /** A `source_color` uniform, converted from sRGB to linear. */
  readonly color?: true;
  /** A sampler's `filter_*` and `repeat_*` hints (`ShaderLanguage::TextureFilter`, `TextureRepeat`). */
  readonly filter?: number;
  readonly repeat?: number;
  /** A `hint_screen_texture` or `hint_depth_texture` sampler: the frame's capture (`spatial-material.ts`). */
  readonly source?: 'screen' | 'depth';
}

/** The lowered code: the GLSL the import printed from Godot's own parse of the shader. */
export interface GodotLoweredShader {
  readonly mode: string;
  /** The `render_mode`s the sky pass acts on (`use_debanding`). */
  readonly renderModes: readonly string[];
  readonly uniforms: readonly GodotShaderUniform[];
  readonly functions: string;
  readonly entry: string;
  /** A spatial shader's two stages as `three-custom-shader-material` takes them (`spatial-material.ts`). */
  readonly spatial?: { readonly vertexShader: string; readonly fragmentShader: string; readonly transparent: boolean; readonly vertexColors: boolean };
}

export interface Shader {
  readonly lowered: GodotLoweredShader;
}

/**
 * A shader of its lowered code.
 *
 * @godot Shader (protocol)
 * @source scene/resources/shader.cpp:300
 */
export function godot_shader_new(lowered: GodotLoweredShader): Shader {
  if (MODES[lowered.mode] === undefined) throw new Error(`godot-compat: shader_type ${lowered.mode} is not bound.`);
  return { lowered };
}

/**
 * The mode `shader_type` names (`Shader::set_code`, `shader.cpp:58`).
 *
 * @godot Shader.get_mode
 * @source scene/resources/shader.cpp:52
 */
export function get_mode(self: Shader): number {
  return MODES[self.lowered.mode] as number;
}
