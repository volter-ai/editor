/** Pure authored Shader/ShaderMaterial decode. Rendering compilation is an injected exact seam. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface AuthoredShaderResource {
  readonly resPath: string;
  readonly code: string;
}

export interface CompiledShaderSampler {
  readonly name: string;
  readonly default?: 'white';
  readonly filter?: 'nearest' | 'linear';
  readonly repeat?: 'disabled';
}

export interface CompiledShaderTextureSize {
  readonly sampler: string;
  readonly uniform: string;
}

export interface CompiledShaderBackend {
  readonly vertex: string;
  readonly fragment: string;
  /** The translated fragment is injected into Three's native standard-lighting program. */
  readonly standardMaterialPatch?: true;
  readonly usesTime?: boolean;
  readonly usesScreenTexture?: boolean;
  readonly usesDepthTexture?: boolean;
  readonly usesViewportSize?: boolean;
  readonly usesAlpha?: boolean;
  /** Per-uniform sampler state carried separately from GLSL because WebGL binds it on textures. */
  readonly samplers?: readonly CompiledShaderSampler[];
  /** Compiler-owned uniforms that carry textureSize(sampler2D, 0) base-level dimensions. */
  readonly textureSizes?: readonly CompiledShaderTextureSize[];
}

export type AuthoredShaderParameterValue =
  | null
  | boolean
  | number
  | string
  | readonly number[]
  | Readonly<Record<'x' | 'y', number>>
  | Readonly<Record<'x' | 'y' | 'z', number>>
  | Readonly<Record<'x' | 'y' | 'z' | 'w', number>>
  | Readonly<Record<'r' | 'g' | 'b' | 'a', number>>
  | { readonly kind: 'texture'; readonly resPath: string }
  | { readonly kind: 'viewport-texture'; readonly nodePath: string };

export interface AuthoredShaderMaterialSpec {
  readonly shader: AuthoredShaderResource;
  readonly backend: CompiledShaderBackend;
  readonly parameters: Readonly<Record<string, AuthoredShaderParameterValue>>;
  readonly resourceLocalToScene: boolean;
}

export interface ReadAuthoredShaderMaterialInput {
  readonly at: string;
  readonly properties: Readonly<Record<string, GodotValue>>;
  readonly resolveShader: (value: GodotValue, at: string) => AuthoredShaderResource;
  readonly resolveTexture: (
    value: GodotValue,
    at: string,
  ) => Extract<AuthoredShaderParameterValue, { readonly kind: 'texture' | 'viewport-texture' }> | undefined;
  readonly compile: (shader: AuthoredShaderResource) => CompiledShaderBackend;
}

function finite(value: GodotValue, at: string): number {
  if (value.kind !== 'number' || !Number.isFinite(value.value)) {
    throw new TranslateError(at, 'ShaderMaterial parameter must be a finite number.');
  }
  return value.value;
}

function vector(
  value: Extract<GodotValue, { readonly kind: 'ctor' }>,
  dimensions: 2 | 3 | 4,
  at: string,
): AuthoredShaderParameterValue {
  if (value.args.length !== dimensions) {
    throw new TranslateError(at, `${value.name} shader parameter requires ${dimensions} components.`);
  }
  const numbers = value.args.map((part, index) => finite(part, `${at}[${index}]`));
  return Object.fromEntries(
    ['x', 'y', 'z', 'w'].slice(0, dimensions).map((name, index) => [name, numbers[index]!]),
  ) as AuthoredShaderParameterValue;
}

function color(
  value: Extract<GodotValue, { readonly kind: 'ctor' }>,
  at: string,
): AuthoredShaderParameterValue {
  if (value.args.length !== 3 && value.args.length !== 4) {
    throw new TranslateError(at, 'Color shader parameter requires three or four components.');
  }
  const values = value.args.map((part, index) => finite(part, `${at}[${index}]`));
  return { r: values[0]!, g: values[1]!, b: values[2]!, a: values[3] ?? 1 };
}

function parameterValue(
  value: GodotValue,
  at: string,
  resolveTexture: ReadAuthoredShaderMaterialInput['resolveTexture'],
): AuthoredShaderParameterValue {
  switch (value.kind) {
    case 'null': return null;
    case 'bool': return value.value;
    case 'number': return finite(value, at);
    case 'string': return value.value;
    case 'array': return value.items.map((part, index) => finite(part, `${at}[${index}]`));
    case 'ctor': {
      if (value.name === 'Vector2' || value.name === 'Vector2i') return vector(value, 2, at);
      if (value.name === 'Vector3' || value.name === 'Vector3i') return vector(value, 3, at);
      if (value.name === 'Vector4' || value.name === 'Vector4i') return vector(value, 4, at);
      if (value.name === 'Color') return color(value, at);
      const texture = resolveTexture(value, at);
      if (texture !== undefined) return texture;
      throw new TranslateError(at, `ShaderMaterial parameter constructor ${value.name} is unsupported.`);
    }
    case 'dict':
    case 'ident':
      throw new TranslateError(at, `ShaderMaterial parameter ${value.kind} values are unsupported.`);
  }
}

/** Decode one authored material without reading files, compiling shaders, or allocating natives. */
export function readAuthoredShaderMaterial(
  input: ReadAuthoredShaderMaterialInput,
): AuthoredShaderMaterialSpec {
  const shaderValue = input.properties['shader'];
  if (shaderValue === undefined || shaderValue.kind === 'null') {
    throw new TranslateError(input.at, 'ShaderMaterial.shader must resolve to an authored Shader.');
  }
  const shader = input.resolveShader(shaderValue, `${input.at}.shader`);
  const parameters: Record<string, AuthoredShaderParameterValue> = {};
  for (const [property, value] of Object.entries(input.properties)) {
    const prefix = property.startsWith('shader_param/')
      ? 'shader_param/'
      : property.startsWith('shader_parameter/')
        ? 'shader_parameter/'
        : undefined;
    if (prefix === undefined) continue;
    const name = property.slice(prefix.length);
    if (name === '') throw new TranslateError(input.at, 'ShaderMaterial has an empty parameter name.');
    parameters[name] = parameterValue(value, `${input.at}.${property}`, input.resolveTexture);
  }
  const local = input.properties['resource_local_to_scene'];
  if (local !== undefined && local.kind !== 'bool') {
    throw new TranslateError(input.at, 'ShaderMaterial.resource_local_to_scene must be a boolean.');
  }
  return {
    shader,
    backend: input.compile(shader),
    parameters,
    resourceLocalToScene: local?.value ?? false,
  };
}
