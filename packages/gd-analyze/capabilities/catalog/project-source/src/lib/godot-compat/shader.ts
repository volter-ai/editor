import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourcePath,
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceDuplicate,
  godotResourceEmitChanged,
  resourceLoaderGetCachedRef,
} from './resource-io';

export type GodotShaderMode = 'spatial' | 'canvas_item' | 'particles' | 'sky' | 'fog';
export type GodotShaderUniformScope = 'local' | 'global' | 'instance';

/** Shader.Mode, pinned to Godot 4.7's extension API and the shared first three Godot 3 values. */
export const GODOT_SHADER_MODE = {
  SPATIAL: 0,
  CANVAS_ITEM: 1,
  PARTICLES: 2,
  SKY: 3,
  FOG: 4,
  TEXTURE_BLIT: 5,
} as const;
export type GodotShaderModeValue = (typeof GODOT_SHADER_MODE)[keyof typeof GODOT_SHADER_MODE];

export interface GodotShaderUniform {
  readonly name: string;
  readonly type: string;
  readonly scope: GodotShaderUniformScope;
  readonly hint?: string;
  readonly defaultSource?: string;
  readonly order: number;
}

export interface GodotShaderUniformGroup {
  readonly kind: 'group';
  readonly name: string;
  readonly subgroup: string;
  readonly order: number;
}

export type GodotShaderParameterRow = GodotShaderUniform | GodotShaderUniformGroup;

function numericShaderLiteral(source: string): number | undefined {
  const normalized = source.trim().replace(/[fFuU]$/, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function constructorArguments(source: string, name: string): readonly string[] | undefined {
  const match = new RegExp(`^${name}\\s*\\((.*)\\)$`).exec(source.trim());
  if (match?.[1] === undefined) return undefined;
  // Shader uniform defaults are constant expressions. This small splitter accepts the scalar
  // constructors the native Three/Pixi bindings can represent and refuses nested expressions.
  const values = match[1].split(',').map((part) => part.trim());
  return values.some((part) => part.includes('(') || part.includes(')')) ? undefined : values;
}

function vectorDefault(
  source: string,
  constructor: string,
  dimensions: 2 | 3 | 4,
  integer: boolean,
): Readonly<Record<string, number>> | undefined {
  const args = constructorArguments(source, constructor);
  if (args === undefined) return undefined;
  const values = args.map(numericShaderLiteral);
  if (values.some((value) => value === undefined)) return undefined;
  const expanded = values.length === 1 ? Array(dimensions).fill(values[0]) : values;
  if (expanded.length !== dimensions) return undefined;
  const normalized = expanded.map((value) => (integer ? Math.trunc(value!) : value!));
  return Object.fromEntries(
    ['x', 'y', 'z', 'w'].slice(0, dimensions).map((key, index) => [key, normalized[index]!]),
  );
}

function colorDefault(source: string): Readonly<Record<string, number>> | undefined {
  const args = constructorArguments(source, 'Color');
  if (args === undefined) return undefined;
  const values = args.map(numericShaderLiteral);
  if (values.some((value) => value === undefined) || (values.length !== 3 && values.length !== 4)) {
    return undefined;
  }
  return { r: values[0]!, g: values[1]!, b: values[2]!, a: values[3] ?? 1 };
}

function identityMatrix(size: 3 | 4): Float32Array {
  const matrix = new Float32Array(size * size);
  for (let index = 0; index < size; index += 1) matrix[index * size + index] = 1;
  return matrix;
}

function intrinsicUniformDefault(type: string): unknown {
  if (type === 'bool') return false;
  if (type === 'int' || type === 'uint' || type === 'float') return 0;
  if (type === 'vec2' || type === 'ivec2' || type === 'uvec2') return { x: 0, y: 0 };
  if (type === 'vec3' || type === 'ivec3' || type === 'uvec3') return { x: 0, y: 0, z: 0 };
  if (type === 'vec4' || type === 'ivec4' || type === 'uvec4') return { x: 0, y: 0, z: 0, w: 0 };
  if (type === 'color') return { r: 0, g: 0, b: 0, a: 1 };
  if (type === 'mat3') return identityMatrix(3);
  if (type === 'mat4') return identityMatrix(4);
  if (type.startsWith('sampler')) return null;
  return undefined;
}

function parsedUniformDefault(uniform: GodotShaderUniform): unknown {
  const source = uniform.defaultSource;
  if (source === undefined) return intrinsicUniformDefault(uniform.type);
  if (source === 'true') return true;
  if (source === 'false') return false;
  const numeric = numericShaderLiteral(source);
  if (numeric !== undefined) {
    return uniform.type === 'int' || uniform.type === 'uint' ? Math.trunc(numeric) : numeric;
  }
  const vectors: Readonly<Record<string, readonly [string, 2 | 3 | 4, boolean]>> = {
    vec2: ['vec2', 2, false],
    vec3: ['vec3', 3, false],
    vec4: ['vec4', 4, false],
    ivec2: ['ivec2', 2, true],
    ivec3: ['ivec3', 3, true],
    ivec4: ['ivec4', 4, true],
    uvec2: ['uvec2', 2, true],
    uvec3: ['uvec3', 3, true],
    uvec4: ['uvec4', 4, true],
  };
  const vector = vectors[uniform.type];
  if (vector !== undefined) return vectorDefault(source, ...vector);
  if (uniform.type === 'color') return colorDefault(source);
  if (uniform.type === 'mat3' && source.trim() === 'mat3(1.0)') return identityMatrix(3);
  if (uniform.type === 'mat4' && source.trim() === 'mat4(1.0)') return identityMatrix(4);
  throw new Error(
    `godot-compat: Shader uniform ${uniform.name} has unsupported exact default expression ${source}.`,
  );
}

export interface GodotNativeShaderSource {
  readonly vertex: string;
  readonly fragment: string;
  /** Fragment program injected before Three's standard lighting consumes diffuseColor. */
  readonly standardMaterialPatch?: true;
  /** Native uniforms installed by the exact authored compiler rather than declared by the game. */
  readonly usesTime?: boolean;
  readonly usesScreenTexture?: boolean;
  readonly usesDepthTexture?: boolean;
  readonly usesViewportSize?: boolean;
  /** The authored fragment writes ALPHA and therefore uses Godot's transparent render pipeline. */
  readonly usesAlpha?: boolean;
  /** Sampler state is retained outside GLSL and applied to a material-local Three texture view. */
  readonly samplers?: readonly GodotNativeShaderSampler[];
  /** Material-owned vec2 uniforms carrying exact base-level textureSize results. */
  readonly textureSizes?: readonly GodotNativeShaderTextureSize[];
}

export interface GodotNativeShaderTextureSize {
  readonly sampler: string;
  readonly uniform: string;
}

export interface GodotNativeShaderSampler {
  readonly name: string;
  readonly default?: 'white';
  readonly filter?: 'nearest' | 'linear';
  readonly repeat?: 'disabled';
}

export interface GodotShaderBackendSources {
  readonly three?: GodotNativeShaderSource;
  readonly pixi?: GodotNativeShaderSource;
}

const SHADER_TYPE = /(?:^|\n)\s*shader_type\s+(spatial|canvas_item|particles|sky|fog)\s*;/;
const RENDER_MODE = /(?:^|\n)\s*render_mode\s+([^;]+);/g;
const UNIFORM_GROUP =
  /(?:^|\n)\s*group_uniforms(?:\s+([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?)?\s*;/g;
const UNIFORM =
  /(?:^|\n)\s*(?:(global|instance)\s+)?uniform\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^=;]+?))?(?:\s*=\s*([^;]+?))?\s*;/g;

function stripShaderComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n\r]*/g, '');
}

function shaderModeOf(code: string): GodotShaderMode {
  const found = SHADER_TYPE.exec(stripShaderComments(code));
  return (found?.[1] as GodotShaderMode | undefined) ?? 'spatial';
}

function renderModesOf(code: string): readonly string[] {
  const modes: string[] = [];
  for (const declaration of stripShaderComments(code).matchAll(RENDER_MODE)) {
    for (const mode of declaration[1]?.split(',') ?? []) {
      const normalized = mode.trim();
      if (normalized.length > 0 && !modes.includes(normalized)) modes.push(normalized);
    }
  }
  return modes;
}

function uniformsOf(code: string): readonly GodotShaderUniform[] {
  const uniforms: GodotShaderUniform[] = [];
  for (const declaration of stripShaderComments(code).matchAll(UNIFORM)) {
    const type = declaration[2];
    const name = declaration[3];
    if (type === undefined || name === undefined) continue;
    const hint = declaration[4]?.trim();
    uniforms.push({
      name,
      type: type === 'vec4' && (hint === 'hint_color' || hint === 'source_color') ? 'color' : type,
      scope:
        declaration[1] === 'global'
          ? 'global'
          : declaration[1] === 'instance'
            ? 'instance'
            : 'local',
      ...(hint ? { hint } : {}),
      ...(declaration[5]?.trim() ? { defaultSource: declaration[5].trim() } : {}),
      order: uniforms.length,
    });
  }
  return uniforms;
}

/**
 * Godot's `group_uniforms` declarations are standalone statements, not hints on a uniform. Merge
 * their source offsets with the uniform offsets so `get_shader_uniform_list(true)` retains the
 * semantic declaration order used by the inspector and runtime property list.
 */
function parameterRowsOf(code: string): readonly GodotShaderParameterRow[] {
  const source = stripShaderComments(code);
  const entries: Array<
    | {
        readonly at: number;
        readonly kind: 'group';
        readonly name: string;
        readonly subgroup: string;
      }
    | { readonly at: number; readonly kind: 'uniform'; readonly uniform: GodotShaderUniform }
  > = [];
  for (const declaration of source.matchAll(UNIFORM_GROUP)) {
    entries.push({
      at: declaration.index,
      kind: 'group',
      name: declaration[1] ?? '',
      subgroup: declaration[2] ?? '',
    });
  }
  for (const declaration of source.matchAll(UNIFORM)) {
    const type = declaration[2];
    const name = declaration[3];
    if (type === undefined || name === undefined) continue;
    entries.push({
      at: declaration.index,
      kind: 'uniform',
      uniform: {
        name,
        type:
          type === 'vec4' &&
          (declaration[4]?.trim() === 'hint_color' || declaration[4]?.trim() === 'source_color')
            ? 'color'
            : type,
        scope:
          declaration[1] === 'global'
            ? 'global'
            : declaration[1] === 'instance'
              ? 'instance'
              : 'local',
        ...(declaration[4]?.trim() ? { hint: declaration[4].trim() } : {}),
        ...(declaration[5]?.trim() ? { defaultSource: declaration[5].trim() } : {}),
        order: 0,
      },
    });
  }
  return entries
    .sort((left, right) => left.at - right.at)
    .map(
      (entry, order): GodotShaderParameterRow =>
        entry.kind === 'group'
          ? { kind: 'group', name: entry.name, subgroup: entry.subgroup, order }
          : { ...entry.uniform, order },
    );
}

export class GodotShader {
  private source = '';
  private revision = 0;
  private shaderMode: GodotShaderMode = 'spatial';
  private renderModeNames: readonly string[] = [];
  private uniformRows: readonly GodotShaderUniform[] = [];
  private parameterRows: readonly GodotShaderParameterRow[] = [];
  /** Godot 4 supports indexed texture-array defaults; Godot 3 always addresses index zero. */
  private readonly defaultTextures = new Map<string, Map<number, unknown>>();
  private customDefinesValue = '';
  private backendSources: GodotShaderBackendSources = {};

  public constructor(code = '', backendSources: GodotShaderBackendSources = {}) {
    registerGodotObjectIdentity(this, 'Shader');
    bindGodotResourceProtocol<GodotShader>(this, {
      createDuplicate: (source) => {
        const duplicate = new GodotShader(source.source, source.backendSources);
        duplicate.customDefinesValue = source.customDefinesValue;
        for (const [name, indexed] of source.defaultTextures) {
          duplicate.defaultTextures.set(name, new Map(indexed));
        }
        return duplicate;
      },
      populateDuplicate: (_source, target, subresources, memo) => {
        if (!subresources) return;
        for (const indexed of target.defaultTextures.values()) {
          for (const [index, texture] of indexed) {
            indexed.set(index, duplicateGodotSubresource(texture, memo));
          }
        }
      },
    });
    this.setCode(code);
    this.backendSources = backendSources;
  }

  public get code(): string {
    return this.source;
  }

  public set code(value: string) {
    this.setCode(value);
  }

  public get custom_defines(): string {
    return this.getCustomDefines();
  }
  public set custom_defines(value: string) {
    this.setCustomDefines(value);
  }

  public setCode(value: string): void {
    if (this.source === value && this.revision !== 0) return;
    this.source = value;
    this.shaderMode = shaderModeOf(value);
    this.renderModeNames = renderModesOf(value);
    this.uniformRows = uniformsOf(value);
    this.parameterRows = parameterRowsOf(value);
    // Backend source is a translation of this exact Godot source. A runtime `code = ...` write
    // cannot reuse the previous program; the next retained draw refuses until the new code has a
    // translated backend program rather than plausibly rendering the stale shader.
    this.backendSources = {};
    this.revision += 1;
    this.emitChanged();
  }

  public getCode(): string {
    return this.source;
  }

  public set_code(value: string): void {
    this.setCode(value);
  }
  public get_code(): string {
    return this.getCode();
  }

  public getMode(): GodotShaderMode {
    return this.shaderMode;
  }

  public getModeValue(): GodotShaderModeValue {
    switch (this.shaderMode) {
      case 'spatial':
        return GODOT_SHADER_MODE.SPATIAL;
      case 'canvas_item':
        return GODOT_SHADER_MODE.CANVAS_ITEM;
      case 'particles':
        return GODOT_SHADER_MODE.PARTICLES;
      case 'sky':
        return GODOT_SHADER_MODE.SKY;
      case 'fog':
        return GODOT_SHADER_MODE.FOG;
    }
  }

  public get_mode(): GodotShaderModeValue {
    return this.getModeValue();
  }

  public getRenderModes(): readonly string[] {
    return this.renderModeNames;
  }

  public get_render_modes(): readonly string[] {
    return this.getRenderModes();
  }

  public getShaderUniformList(): readonly GodotShaderUniform[];
  public getShaderUniformList(getGroups: false): readonly GodotShaderUniform[];
  public getShaderUniformList(getGroups: true): readonly GodotShaderParameterRow[];
  public getShaderUniformList(getGroups = false): readonly GodotShaderParameterRow[] {
    return getGroups ? this.parameterRows : this.uniformRows;
  }

  public get_shader_uniform_list(getGroups = false): readonly GodotShaderParameterRow[] {
    return getGroups ? this.getShaderUniformList(true) : this.getShaderUniformList(false);
  }

  public hasParameter(name: string): boolean {
    return this.uniformRows.some((uniform) => uniform.name === name);
  }

  /** Godot 3 spelling retained alongside Godot 4's uniform-list API. */
  public hasParam(name: string): boolean {
    return this.hasParameter(name);
  }

  public has_parameter(name: string): boolean {
    return this.hasParameter(name);
  }
  public has_param(name: string): boolean {
    return this.hasParam(name);
  }

  public uniform(name: string): GodotShaderUniform | undefined {
    return this.uniformRows.find((uniform) => uniform.name === name);
  }

  public getDefaultParameterValue(name: string): unknown {
    const texture = this.getDefaultTextureParameter(name);
    if (texture !== null) return texture;
    const uniform = this.uniform(name);
    return uniform === undefined ? null : parsedUniformDefault(uniform);
  }

  public get_default_parameter(name: string): unknown {
    return this.getDefaultParameterValue(name);
  }

  public setDefaultTextureParameter(name: string, texture: unknown | null, index = 0): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(
        `Shader default texture index must be a non-negative integer; got ${index}.`,
      );
    }
    const indexed = this.defaultTextures.get(name) ?? new Map<number, unknown>();
    if (texture === null) indexed.delete(index);
    else indexed.set(index, texture);
    if (indexed.size === 0) this.defaultTextures.delete(name);
    else this.defaultTextures.set(name, indexed);
    this.revision += 1;
    this.emitChanged();
  }

  public set_default_texture_parameter(name: string, texture: unknown | null, index = 0): void {
    this.setDefaultTextureParameter(name, texture, index);
  }

  public getDefaultTextureParameter(name: string, index = 0): unknown | null {
    return this.defaultTextures.get(name)?.get(index) ?? null;
  }

  public get_default_texture_parameter(name: string, index = 0): unknown | null {
    return this.getDefaultTextureParameter(name, index);
  }

  public hasDefaultTextureParameter(name: string, index = 0): boolean {
    return this.defaultTextures.get(name)?.has(index) ?? false;
  }

  public has_default_texture_parameter(name: string, index = 0): boolean {
    return this.hasDefaultTextureParameter(name, index);
  }

  public defaultTextureParameters(): ReadonlyMap<string, unknown> {
    return new Map(
      [...this.defaultTextures]
        .filter(([, indexed]) => indexed.has(0))
        .map(([name, indexed]) => [name, indexed.get(0)] as const),
    );
  }

  public defaultTextureParameterLayers(): ReadonlyMap<string, ReadonlyMap<number, unknown>> {
    return this.defaultTextures;
  }

  /** Godot 3 compatibility spellings. */
  public setDefaultTextureParam(name: string, texture: unknown | null): void {
    this.setDefaultTextureParameter(name, texture, 0);
  }

  public set_default_texture_param(name: string, texture: unknown | null): void {
    this.setDefaultTextureParam(name, texture);
  }

  public getDefaultTextureParam(name: string): unknown | null {
    return this.getDefaultTextureParameter(name, 0);
  }

  public get_default_texture_param(name: string): unknown | null {
    return this.getDefaultTextureParam(name);
  }

  public setCustomDefines(value: string): void {
    if (this.customDefinesValue === value) return;
    this.customDefinesValue = value;
    this.revision += 1;
    this.emitChanged();
  }

  public set_custom_defines(value: string): void {
    this.setCustomDefines(value);
  }

  public getCustomDefines(): string {
    return this.customDefinesValue;
  }

  public get_custom_defines(): string {
    return this.getCustomDefines();
  }

  public setBackendSources(sources: GodotShaderBackendSources): void {
    this.backendSources = sources;
    this.revision += 1;
    this.emitChanged();
  }

  public sourcesFor(backend: keyof GodotShaderBackendSources): GodotNativeShaderSource | undefined {
    return this.backendSources[backend];
  }

  public getRevision(): number {
    return this.revision;
  }

  public onChanged(listener: () => void): () => void {
    const connection = godotResourceChangedSignal(this).connect(listener);
    return () => connection.disconnect();
  }

  private emitChanged(): void {
    godotResourceEmitChanged(this);
  }

  public duplicate(subresources = false): GodotShader {
    return godotResourceDuplicate(this, subresources);
  }
}

export function createGodotShader(
  code = '',
  backendSources: GodotShaderBackendSources = {},
): GodotShader {
  return new GodotShader(code, backendSources);
}

/** Static `preload("res://…shader")`: one ResourceLoader-cached Shader identity with path provenance. */
export function preloadGodotShader(
  resourcePath: string,
  code: string,
  backendSources: GodotShaderBackendSources,
): GodotShader {
  const cached = resourceLoaderGetCachedRef<unknown>(resourcePath);
  if (cached !== null) {
    if (!(cached instanceof GodotShader)) {
      throw new Error(
        `godot-compat: preloaded Shader path ${resourcePath} is occupied by another Resource type.`,
      );
    }
    if (cached.code !== code) {
      throw new Error(
        `godot-compat: preloaded Shader path ${resourcePath} changed source while its cached identity is live.`,
      );
    }
    return cached;
  }
  const shader = new GodotShader(code, backendSources);
  bindGodotResourcePath(shader, resourcePath);
  return shader;
}
