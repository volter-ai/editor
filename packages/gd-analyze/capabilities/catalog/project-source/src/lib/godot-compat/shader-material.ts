/**
 * @godot-class ShaderMaterial
 * @role BINDING
 *
 * Godot 4.7's `ShaderMaterial` (`scene/resources/material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a shader and the parameters set on it (the
 * `shader_parameter/NAME` properties, `ShaderMaterial::_set`, `material.cpp:197`), stored and read
 * back; a parameter never set reads as null (the shader's default draws). Its three material is its
 * mode's user's (`world-environment.ts` for a sky).
 */

import type { Shader } from './shader';

export interface ShaderMaterial {
  shader: Shader | null;
  readonly parameters: Map<string, unknown>;
  /** Called when a parameter changes, by the three material drawing this one. */
  changed?: (name: string, value: unknown) => void;
}

/**
 * A material with no shader and no parameters.
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function construct(): ShaderMaterial {
  return { shader: null, parameters: new Map() };
}

/**
 * @godot ShaderMaterial.set_shader
 * @source scene/resources/material.cpp:387
 */
export function set_shader(self: ShaderMaterial, shader: Shader | null): void {
  self.shader = shader;
}

/**
 * @godot ShaderMaterial.get_shader
 * @source scene/resources/material.cpp:415
 */
export function get_shader(self: ShaderMaterial): Shader | null {
  return self.shader;
}

/**
 * A null value clears the parameter.
 *
 * @godot ShaderMaterial.set_shader_parameter
 * @source scene/resources/material.cpp:419
 */
export function set_shader_parameter(self: ShaderMaterial, name: string, value: unknown): void {
  if (value === null || value === undefined) self.parameters.delete(name);
  else self.parameters.set(name, value);
  self.changed?.(name, value);
}

/**
 * @godot ShaderMaterial.get_shader_parameter
 * @source scene/resources/material.cpp:453
 */
export function get_shader_parameter(self: ShaderMaterial, name: string): unknown {
  return self.parameters.has(name) ? self.parameters.get(name) : null;
}

/**
 * A ShaderMaterial of its shader and the parameters a scene states (`shader_parameter/NAME`, by
 * Godot name), set in the order given.
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:197
 */
export function godot_shader_material_new(shader: Shader | null, parameters: Readonly<Record<string, unknown>> = {}): ShaderMaterial {
  const self = construct();
  set_shader(self, shader);
  for (const [name, value] of Object.entries(parameters)) set_shader_parameter(self, name, value);
  return self;
}
