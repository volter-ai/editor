import {
  armSceneDepthTexture,
  disarmSceneDepthTexture,
  farDepthTexture,
  type SceneDepthTextureConsumer,
} from '@volter/threejs-runtime/render/soft-particle-depth';
import {
  Filter,
  GlProgram,
  Texture as PixiTexture,
  type UNIFORM_TYPES,
  type UniformData,
  UniformGroup,
} from 'pixi.js';
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  FrontSide,
  type IUniform,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  MultiplyBlending,
  NormalBlending,
  SubtractiveBlending,
  type Material as ThreeMaterial,
  ShaderMaterial as ThreeShaderMaterial,
  Texture as ThreeTexture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotObjectBindingOf, godotObjectIsClass } from './object';
import {
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotNativeShaderSource, GodotShader, GodotShaderUniform } from './shader';
import { prepareGodotThreeSampler, releaseGodotThreeSamplers } from './shader-sampler';

export type GodotShaderParameter = unknown;
export type GodotShaderParameters = Readonly<Record<string, GodotShaderParameter>>;

export interface GodotShaderMaterialBinding<TNative extends object> {
  readonly native: TNative;
  shader: GodotShader;
  readonly parameters: Map<string, GodotShaderParameter>;
  readonly overriddenParameters: Set<string>;
  shaderRevision: number;
  readonly backend: 'three' | 'pixi';
  readonly prepareParameter: (name: string, value: GodotShaderParameter) => () => void;
  readonly prepareShader: (shader: GodotShader) => () => void;
  readonly release?: () => void;
}

const bindings = new WeakMap<object, GodotShaderMaterialBinding<object>>();

function shaderParameterName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('godot-compat: ShaderMaterial parameter name requires String/StringName.');
  }
  return value;
}

/** Shared Godot Resource identity; native backend materials are minted only at a retained draw. */
export class GodotShaderMaterial {
  private shaderValue: GodotShader | null = null;
  readonly parameters = new Map<string, GodotShaderParameter>();
  private readonly natives = new Set<object>();
  private releaseShaderChange: (() => void) | undefined;
  private revision = 0;

  public constructor(shader: GodotShader | null = null, authored: GodotShaderParameters = {}) {
    for (const [name, value] of Object.entries(authored)) this.parameters.set(name, value);
    bindGodotMaterial<GodotShaderMaterial>(this, {}, 'ShaderMaterial', {
      createDuplicate: (source) =>
        new GodotShaderMaterial(source.shaderValue, Object.fromEntries(source.parameters)),
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources) return;
        if (source.shaderValue !== null) {
          target.setShader(duplicateGodotSubresource(source.shaderValue, memo));
        }
        for (const [name, value] of source.parameters) {
          target.setShaderParameter(name, duplicateGodotSubresource(value, memo));
        }
      },
    });
    this.setShader(shader);
  }

  public get shader(): GodotShader | null {
    return this.shaderValue;
  }

  public set shader(value: GodotShader | null) {
    this.setShader(value);
  }

  public setShader(shader: GodotShader | null): void {
    if (shader === this.shaderValue) return;
    if (shader === null && this.natives.size > 0) {
      throw new Error('ShaderMaterial.shader cannot become null while retained draws consume it.');
    }
    const prepared =
      shader === null ? [] : [...this.natives].map((native) => prepareNativeShader(native, shader));
    const previous = this.shaderValue;
    const previousRelease = this.releaseShaderChange;
    const nextRelease = shader?.onChanged(() => this.syncNatives());
    this.shaderValue = shader;
    try {
      for (const commit of prepared) commit();
    } catch (error) {
      nextRelease?.();
      this.shaderValue = previous;
      throw error;
    }
    previousRelease?.();
    this.releaseShaderChange = nextRelease;
    this.revision += 1;
    this.emitChanged();
  }

  public set_shader(shader: GodotShader | null): void {
    this.setShader(shader);
  }
  public get_shader(): GodotShader | null {
    return this.shader;
  }

  public setShaderParameter(name: string, value: GodotShaderParameter): void {
    name = shaderParameterName(name);
    const prepared = [...this.natives].map((native) =>
      prepareNativeShaderParameter(native, name, value),
    );
    this.parameters.set(name, value);
    for (const commit of prepared) commit();
    this.revision += 1;
    this.emitChanged();
  }

  public set_shader_parameter(name: string, value: GodotShaderParameter): void {
    this.setShaderParameter(name, value);
  }

  public getShaderParameter(name: string): GodotShaderParameter {
    name = shaderParameterName(name);
    return this.parameters.has(name)
      ? this.parameters.get(name)
      : (this.shaderValue?.getDefaultParameterValue(name) ?? null);
  }

  public get_shader_parameter(name: string): GodotShaderParameter {
    return this.getShaderParameter(name);
  }

  public createThreeMaterial(): ThreeMaterial {
    const shader = this.requireShader('Three');
    const native = createGodotThreeShaderMaterial(shader, Object.fromEntries(this.parameters));
    this.natives.add(native);
    return native;
  }

  public createPixiMaterial(): Filter {
    const shader = this.requireShader('Pixi');
    const native = createGodotPixiShaderMaterial(shader, Object.fromEntries(this.parameters));
    this.natives.add(native);
    return native;
  }

  public releaseNative(native: object): void {
    this.natives.delete(native);
  }

  public getShaderParameterList(): readonly string[] {
    const names = new Set(this.shaderValue?.getShaderUniformList().map((uniform) => uniform.name));
    for (const name of this.parameters.keys()) names.add(name);
    return [...names];
  }

  public get_shader_parameter_list(): readonly string[] {
    return this.getShaderParameterList();
  }

  public hasShaderParameter(name: string): boolean {
    return this.parameters.has(name) || this.shaderValue?.hasParameter(name) === true;
  }

  public has_shader_parameter(name: string): boolean {
    return this.hasShaderParameter(name);
  }

  public getRevision(): number {
    return this.revision;
  }

  public onChanged(listener: () => void): () => void {
    const connection = godotResourceChangedSignal(this).connect(listener);
    return () => connection.disconnect();
  }

  public duplicate(deep = false): GodotShaderMaterial {
    return duplicateGodotMaterial<GodotShaderMaterial>(
      this,
      (material) =>
        new GodotShaderMaterial(
          deep ? (material.shaderValue?.duplicate() ?? null) : material.shaderValue,
          Object.fromEntries(material.parameters),
        ),
      deep,
      'ShaderMaterial',
    );
  }

  private requireShader(backend: string): GodotShader {
    if (this.shaderValue === null) {
      throw new Error(`ShaderMaterial assigned to a ${backend} draw has no Shader resource.`);
    }
    return this.shaderValue;
  }

  private syncNatives(): void {
    if (this.shaderValue === null) {
      if (this.natives.size > 0) {
        throw new Error(
          'ShaderMaterial.shader cannot become null while retained draws consume it.',
        );
      }
      return;
    }
    const prepared = [...this.natives].map((native) =>
      prepareNativeShader(native, this.shaderValue!),
    );
    for (const commit of prepared) commit();
    this.revision += 1;
    this.emitChanged();
  }

  private emitChanged(): void {
    godotResourceEmitChanged(this);
  }
}

export function createGodotShaderMaterial(
  shader: GodotShader | null = null,
  authored: GodotShaderParameters = {},
): GodotShaderMaterial {
  return new GodotShaderMaterial(shader, authored);
}

/** Release one retained Three consumer of a ShaderMaterial Resource and its native GPU program. */
export function releaseGodotThreeShaderMaterial(
  material: GodotShaderMaterial,
  native: ThreeMaterial,
): void {
  material.releaseNative(native);
  bindings.get(native)?.release?.();
  native.dispose();
}

function parameterSeed(
  shader: GodotShader,
  authored: GodotShaderParameters,
): Map<string, GodotShaderParameter> {
  const parameters = new Map<string, GodotShaderParameter>();
  for (const uniform of shader.getShaderUniformList()) {
    parameters.set(uniform.name, shader.getDefaultParameterValue(uniform.name));
  }
  for (const [name, texture] of shader.defaultTextureParameters()) parameters.set(name, texture);
  for (const [name, value] of Object.entries(authored)) parameters.set(name, value);
  return parameters;
}

function reseedParameters(
  shader: GodotShader,
  current: ReadonlyMap<string, GodotShaderParameter>,
  overridden: ReadonlySet<string>,
): Map<string, GodotShaderParameter> {
  const authored: Record<string, GodotShaderParameter> = {};
  for (const name of overridden) authored[name] = current.get(name);
  return parameterSeed(shader, authored);
}

function replaceParameters(
  target: Map<string, GodotShaderParameter>,
  source: ReadonlyMap<string, GodotShaderParameter>,
): void {
  target.clear();
  for (const [name, value] of source) target.set(name, value);
}

function threeUniforms(
  shader: GodotShader,
  parameters: ReadonlyMap<string, GodotShaderParameter>,
  ownedSamplers: Map<string, ThreeTexture>,
): Record<string, IUniform> {
  const uniforms: Record<string, IUniform> = {};
  for (const declaration of shader.getShaderUniformList()) {
    const value = parameters.has(declaration.name)
      ? parameters.get(declaration.name)
      : shader.getDefaultParameterValue(declaration.name);
    const prepared = prepareThreeUniformValue(shader, declaration, value);
    if (prepared.owned !== undefined) ownedSamplers.set(declaration.name, prepared.owned);
    uniforms[declaration.name] = { value: prepared.value };
  }
  for (const [name, value] of parameters) {
    if (uniforms[name] !== undefined) continue;
    uniforms[name] = { value };
  }
  return uniforms;
}

function threeTextureSize(value: unknown, sampler: string): Vector2 {
  // WebGL binds a one-pixel incomplete-texture fallback for an unset sampler.
  if (value === null) return new Vector2(1, 1);
  if (!(value instanceof ThreeTexture)) {
    throw new TypeError(
      `ShaderMaterial textureSize sampler ${sampler} requires a native Three Texture or null.`,
    );
  }
  const image = value.image as
    | {
        readonly width?: unknown;
        readonly height?: unknown;
        readonly videoWidth?: unknown;
        readonly videoHeight?: unknown;
      }
    | undefined;
  const width = Number(image?.width ?? image?.videoWidth);
  const height = Number(image?.height ?? image?.videoHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new TypeError(
      `ShaderMaterial textureSize sampler ${sampler} has no finite positive base-level dimensions.`,
    );
  }
  return new Vector2(Math.trunc(width), Math.trunc(height));
}

function installThreeTextureSizeUniforms(
  source: GodotNativeShaderSource | undefined,
  uniforms: Record<string, IUniform>,
): void {
  for (const binding of source?.textureSizes ?? []) {
    uniforms[binding.uniform] = {
      value: threeTextureSize(uniforms[binding.sampler]?.value ?? null, binding.sampler),
    };
  }
}

function updateThreeTextureSizeUniforms(
  source: GodotNativeShaderSource | undefined,
  uniformSets: Iterable<Record<string, IUniform>>,
  sampler: string,
  value: unknown,
): void {
  const bindings = source?.textureSizes?.filter((binding) => binding.sampler === sampler) ?? [];
  if (bindings.length === 0) return;
  const size = threeTextureSize(value, sampler);
  for (const uniforms of uniformSets) {
    for (const binding of bindings) {
      const current = uniforms[binding.uniform]?.value;
      if (current instanceof Vector2) current.copy(size);
      else uniforms[binding.uniform] = { value: size.clone() };
    }
  }
}

function threeProgramUniforms(
  shader: GodotShader,
  parameters: ReadonlyMap<string, GodotShaderParameter>,
  ownedSamplers: Map<string, ThreeTexture>,
): Record<string, IUniform> {
  const uniforms = threeUniforms(shader, parameters, ownedSamplers);
  installThreeTextureSizeUniforms(shader.sourcesFor('three'), uniforms);
  if (shader.sourcesFor('three')?.usesViewportSize === true) {
    uniforms['godotViewportSize'] = { value: new Vector2(1, 1) };
  }
  if (shader.sourcesFor('three')?.usesDepthTexture === true) {
    uniforms['godotProjectionMatrix'] = { value: new Matrix4() };
    uniforms['godotInverseProjectionMatrix'] = { value: new Matrix4() };
    uniforms['godotInverseViewMatrix'] = { value: new Matrix4() };
    for (const declaration of depthTextureUniforms(shader)) {
      uniforms[declaration.name] = { value: farDepthTexture() };
    }
  }
  return uniforms;
}

function depthTextureUniforms(shader: GodotShader): readonly GodotShaderUniform[] {
  return shader
    .getShaderUniformList()
    .filter(
      (uniform) =>
        uniform.type.startsWith('sampler') &&
        uniform.hint?.split(',').some((hint) => hint.trim() === 'hint_depth_texture'),
    );
}

function createThreeDepthTextureBinding(
  initialShader: GodotShader,
  uniformSets: () => Iterable<Record<string, IUniform>>,
): { sync(shader: GodotShader): void; release(): void } {
  let shader = initialShader;
  let armed = false;
  let texture: ThreeTexture = farDepthTexture();
  const consumer: SceneDepthTextureConsumer = {
    setDepthTexture(next): void {
      texture = next;
      for (const uniforms of uniformSets()) {
        for (const declaration of depthTextureUniforms(shader)) {
          uniforms[declaration.name] ??= { value: texture };
          uniforms[declaration.name]!.value = texture;
        }
      }
    },
  };
  return {
    sync(next): void {
      const needsDepth = next.sourcesFor('three')?.usesDepthTexture === true;
      if (armed && !needsDepth) {
        disarmSceneDepthTexture(consumer);
        armed = false;
      }
      shader = next;
      if (!armed && needsDepth) {
        armed = true;
        armSceneDepthTexture(consumer);
      } else if (needsDepth) {
        consumer.setDepthTexture(texture);
      }
    },
    release(): void {
      if (!armed) return;
      disarmSceneDepthTexture(consumer);
      armed = false;
    },
  };
}

/** Three uses OpenGL's -1..1 clip depth; Godot's depth-texture shaders reconstruct 0..1 NDC. */
function copyGodotProjection(target: Matrix4, source: Matrix4): void {
  target.copy(source);
  const elements = target.elements;
  for (const column of [0, 1, 2, 3]) {
    const z = column * 4 + 2;
    const w = column * 4 + 3;
    elements[z] = 0.5 * (elements[z]! + elements[w]!);
  }
}

function updateThreeScreenUniforms(
  source: GodotNativeShaderSource | undefined,
  uniforms: Iterable<Record<string, IUniform>>,
  renderer: { getDrawingBufferSize(target: Vector2): Vector2 },
  camera: { readonly projectionMatrix: Matrix4; readonly matrixWorld: Matrix4 },
  viewport: Vector2,
): void {
  for (const set of uniforms) {
    if (source?.usesViewportSize === true) {
      renderer.getDrawingBufferSize(viewport);
      (set['godotViewportSize']?.value as Vector2 | undefined)?.copy(viewport);
    }
    if (source?.usesDepthTexture === true) {
      const projection = set['godotProjectionMatrix']?.value as Matrix4 | undefined;
      const inverseProjection = set['godotInverseProjectionMatrix']?.value as Matrix4 | undefined;
      const inverseView = set['godotInverseViewMatrix']?.value as Matrix4 | undefined;
      if (
        projection === undefined ||
        inverseProjection === undefined ||
        inverseView === undefined
      ) {
        throw new Error('ShaderMaterial depth program lost its screen reconstruction uniforms.');
      }
      copyGodotProjection(projection, camera.projectionMatrix);
      inverseProjection.copy(projection).invert();
      inverseView.copy(camera.matrixWorld);
    }
  }
}

function numericComponents(value: unknown, names: readonly string[], uniform: string): number[] {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const values = Array.from(value as ArrayLike<number>, Number);
    if (values.length === names.length && values.every(Number.isFinite)) return values;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const values = names.map((name) => Number(record[name]));
    if (values.every(Number.isFinite)) return values;
  }
  throw new TypeError(
    `ShaderMaterial uniform ${uniform} requires ${names.length} finite components (${names.join(', ')}).`,
  );
}

function matrixElements(value: unknown, size: 3 | 4, uniform: string): number[] {
  if (value instanceof Matrix3 || value instanceof Matrix4) return [...value.elements];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const elements = Array.from(value as ArrayLike<number>, Number);
    if (elements.length === size * size && elements.every(Number.isFinite)) return elements;
  }
  throw new TypeError(
    `ShaderMaterial uniform ${uniform} requires ${size * size} finite matrix elements.`,
  );
}

function threeUniformValue(uniform: GodotShaderUniform, value: unknown): unknown {
  switch (uniform.type) {
    case 'bool':
      return Boolean(value);
    case 'int': {
      const scalar = Number(value);
      if (!Number.isFinite(scalar)) {
        throw new TypeError(`ShaderMaterial uniform ${uniform.name} requires a finite int.`);
      }
      return Math.trunc(scalar);
    }
    case 'uint': {
      const scalar = Number(value);
      if (!Number.isFinite(scalar) || scalar < 0) {
        throw new TypeError(
          `ShaderMaterial uniform ${uniform.name} requires a non-negative finite uint.`,
        );
      }
      return Math.trunc(scalar);
    }
    case 'float': {
      const scalar = Number(value);
      if (!Number.isFinite(scalar)) {
        throw new TypeError(`ShaderMaterial uniform ${uniform.name} requires a finite float.`);
      }
      return scalar;
    }
    case 'vec2': {
      const components = numericComponents(value, ['x', 'y'], uniform.name);
      return new Vector2(components[0]!, components[1]!);
    }
    case 'vec3': {
      const components = numericComponents(value, ['x', 'y', 'z'], uniform.name);
      return new Vector3(components[0]!, components[1]!, components[2]!);
    }
    case 'vec4': {
      const components = numericComponents(value, ['x', 'y', 'z', 'w'], uniform.name);
      return new Vector4(components[0]!, components[1]!, components[2]!, components[3]!);
    }
    case 'ivec2':
    case 'ivec3':
    case 'ivec4': {
      const dimensions = Number(uniform.type.at(-1));
      const names = ['x', 'y', 'z', 'w'].slice(0, dimensions);
      return new Int32Array(
        numericComponents(value, names, uniform.name).map((component) => Math.trunc(component)),
      );
    }
    case 'uvec2':
    case 'uvec3':
    case 'uvec4': {
      const dimensions = Number(uniform.type.at(-1));
      const names = ['x', 'y', 'z', 'w'].slice(0, dimensions);
      const components = numericComponents(value, names, uniform.name);
      if (components.some((component) => component < 0)) {
        throw new TypeError(
          `ShaderMaterial uniform ${uniform.name} requires non-negative uint components.`,
        );
      }
      return new Uint32Array(components.map((component) => Math.trunc(component)));
    }
    case 'color': {
      const components = numericComponents(value, ['r', 'g', 'b', 'a'], uniform.name);
      return new Vector4(components[0]!, components[1]!, components[2]!, components[3]!);
    }
    case 'mat3':
      return new Matrix3().fromArray(matrixElements(value, 3, uniform.name));
    case 'mat4':
      return new Matrix4().fromArray(matrixElements(value, 4, uniform.name));
    default:
      if (isSampler(uniform.type)) {
        if (value === null || value instanceof ThreeTexture) return value;
        if (
          typeof value === 'object' &&
          value !== null &&
          (godotObjectIsClass(value, 'ViewportTexture', 3) ||
            godotObjectIsClass(value, 'ViewportTexture', 4)) &&
          (value as { readonly three?: unknown }).three instanceof ThreeTexture
        ) {
          return (value as { readonly three: ThreeTexture }).three;
        }
        throw new TypeError(
          `ShaderMaterial sampler ${uniform.name} requires a native Three Texture or null.`,
        );
      }
      throw new Error(
        `ShaderMaterial Three uniform ${uniform.name} uses unsupported exact type ${uniform.type}.`,
      );
  }
}

function prepareThreeUniformValue(
  shader: GodotShader,
  uniform: GodotShaderUniform,
  value: unknown,
): { readonly value: unknown; readonly owned?: ThreeTexture } {
  const converted = threeUniformValue(uniform, value);
  if (!isSampler(uniform.type)) return { value: converted };
  const prepared = prepareGodotThreeSampler(
    shader.sourcesFor('three'),
    uniform.name,
    converted as ThreeTexture | null,
  );
  return {
    value: prepared.value,
    ...(prepared.owned === undefined ? {} : { owned: prepared.owned }),
  };
}

function applyThreeRenderModes(material: ThreeMaterial, shader: GodotShader): void {
  const modes = new Set(shader.getRenderModes());
  const usesAlpha = shader.sourcesFor('three')?.usesAlpha === true;
  material.side = modes.has('cull_disabled')
    ? DoubleSide
    : modes.has('cull_front')
      ? BackSide
      : FrontSide;
  material.depthTest = !modes.has('depth_test_disabled');
  material.depthWrite = !modes.has('depth_draw_never') && !usesAlpha;
  material.transparent =
    usesAlpha || modes.has('blend_add') || modes.has('blend_sub') || modes.has('blend_mul');
  material.blending = modes.has('blend_add')
    ? AdditiveBlending
    : modes.has('blend_sub')
      ? SubtractiveBlending
      : modes.has('blend_mul')
        ? MultiplyBlending
        : NormalBlending;
  material.polygonOffset = modes.has('depth_draw_always');
  material.polygonOffsetFactor = modes.has('depth_draw_always') ? -1 : 0;
}

export function createGodotThreeShaderMaterial(
  shader: GodotShader,
  authored: GodotShaderParameters = {},
): ThreeMaterial {
  const source = shader.sourcesFor('three');
  if (source === undefined) {
    throw new Error('ShaderMaterial requires translated Three vertex and fragment sources.');
  }
  const parameters = parameterSeed(shader, authored);
  if (source.standardMaterialPatch === true) {
    return createGodotThreeStandardPatchMaterial(shader, parameters, authored);
  }
  let ownedSamplers = new Map<string, ThreeTexture>();
  const native = new ThreeShaderMaterial({
    vertexShader: source.vertex,
    fragmentShader: source.fragment,
    uniforms: threeProgramUniforms(shader, parameters, ownedSamplers),
  });
  const depthTexture = createThreeDepthTextureBinding(shader, () => [native.uniforms]);
  applyThreeRenderModes(native, shader);
  const binding: GodotShaderMaterialBinding<ThreeShaderMaterial> = {
    native,
    shader,
    parameters,
    overriddenParameters: new Set(Object.keys(authored)),
    shaderRevision: shader.getRevision(),
    backend: 'three',
    release: () => {
      depthTexture.release();
      releaseGodotThreeSamplers(ownedSamplers.values());
      ownedSamplers.clear();
    },
    prepareParameter(name, value) {
      const declaration = binding.shader.uniform(name);
      const prepared =
        declaration === undefined
          ? { value }
          : prepareThreeUniformValue(binding.shader, declaration, value);
      return () => {
        ownedSamplers.get(name)?.dispose();
        ownedSamplers.delete(name);
        if (prepared.owned !== undefined) ownedSamplers.set(name, prepared.owned);
        parameters.set(name, value);
        binding.overriddenParameters.add(name);
        native.uniforms[name] ??= { value: prepared.value };
        native.uniforms[name].value = prepared.value;
        updateThreeTextureSizeUniforms(
          binding.shader.sourcesFor('three'),
          [native.uniforms],
          name,
          prepared.value,
        );
        native.uniformsNeedUpdate = true;
        godotResourceEmitChanged(native);
      };
    },
    prepareShader(next) {
      const sources = next.sourcesFor('three');
      if (sources === undefined) {
        throw new Error('ShaderMaterial requires translated Three vertex and fragment sources.');
      }
      const nextParameters = reseedParameters(next, parameters, binding.overriddenParameters);
      const nextOwnedSamplers = new Map<string, ThreeTexture>();
      const uniforms = threeProgramUniforms(next, nextParameters, nextOwnedSamplers);
      return () => {
        releaseGodotThreeSamplers(ownedSamplers.values());
        ownedSamplers = nextOwnedSamplers;
        binding.shader = next;
        binding.shaderRevision = next.getRevision();
        replaceParameters(parameters, nextParameters);
        native.vertexShader = sources.vertex;
        native.fragmentShader = sources.fragment;
        native.uniforms = uniforms;
        depthTexture.sync(next);
        applyThreeRenderModes(native, next);
        native.needsUpdate = true;
        godotResourceEmitChanged(native);
      };
    },
  };
  bindings.set(native, binding as GodotShaderMaterialBinding<object>);
  depthTexture.sync(shader);
  const inheritedBeforeRender = native.onBeforeRender;
  const viewport = new Vector2();
  native.onBeforeRender = (...args): void => {
    inheritedBeforeRender.apply(native, args);
    updateThreeScreenUniforms(
      binding.shader.sourcesFor('three'),
      [native.uniforms],
      args[0],
      args[2],
      viewport,
    );
  };
  bindGodotMaterial<ThreeMaterial>(native, {}, 'ShaderMaterial', {
    createDuplicate: duplicateBoundThreeShaderMaterial,
  });
  return native;
}

function createGodotThreeStandardPatchMaterial(
  shader: GodotShader,
  parameters: Map<string, GodotShaderParameter>,
  authored: GodotShaderParameters,
): MeshStandardMaterial {
  const source = shader.sourcesFor('three');
  if (source?.standardMaterialPatch !== true) {
    throw new Error('ShaderMaterial standard patch requires translated patch sources.');
  }
  const native = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  Object.defineProperty(native, 'defines', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { USE_UV: '' },
  });
  const liveUniforms = new Set<Record<string, IUniform>>();
  const depthTexture = createThreeDepthTextureBinding(shader, () => liveUniforms);
  let activeShader = shader;
  let activeSource = source;
  let ownedSamplers = new Map<string, ThreeTexture>();
  let preparedProgramUniforms = threeProgramUniforms(shader, parameters, ownedSamplers);
  const install = (program: {
    uniforms: Record<string, IUniform>;
    fragmentShader: string;
  }): void => {
    Object.assign(program.uniforms, preparedProgramUniforms);
    liveUniforms.add(program.uniforms);
    program.fragmentShader = program.fragmentShader
      .replace('#include <common>', `#include <common>\n${activeSource.fragment}`)
      .replace(
        '#include <color_fragment>',
        'vec3 godotAlbedo = diffuseColor.rgb;\nfloat godotAlpha = diffuseColor.a;\n' +
          'godotSpatialFragment(godotAlbedo, godotAlpha, vUv);\n' +
          'diffuseColor = vec4(godotAlbedo, godotAlpha);',
      );
  };
  native.onBeforeCompile = install;
  native.customProgramCacheKey = (): string =>
    `godot-standard-shader:${activeShader.getRevision()}:${activeSource.fragment}`;
  const binding: GodotShaderMaterialBinding<MeshStandardMaterial> = {
    native,
    shader,
    parameters,
    overriddenParameters: new Set(Object.keys(authored)),
    shaderRevision: shader.getRevision(),
    backend: 'three',
    release: () => {
      depthTexture.release();
      releaseGodotThreeSamplers(ownedSamplers.values());
      ownedSamplers.clear();
    },
    prepareParameter(name, value) {
      const declaration = binding.shader.uniform(name);
      const prepared =
        declaration === undefined
          ? { value }
          : prepareThreeUniformValue(binding.shader, declaration, value);
      return () => {
        ownedSamplers.get(name)?.dispose();
        ownedSamplers.delete(name);
        if (prepared.owned !== undefined) ownedSamplers.set(name, prepared.owned);
        parameters.set(name, value);
        binding.overriddenParameters.add(name);
        preparedProgramUniforms[name] ??= { value: prepared.value };
        preparedProgramUniforms[name].value = prepared.value;
        for (const uniforms of liveUniforms) {
          uniforms[name] ??= { value: prepared.value };
          uniforms[name].value = prepared.value;
        }
        updateThreeTextureSizeUniforms(
          activeSource,
          [preparedProgramUniforms, ...liveUniforms],
          name,
          prepared.value,
        );
        godotResourceEmitChanged(native);
      };
    },
    prepareShader(next) {
      const nextSource = next.sourcesFor('three');
      if (nextSource?.standardMaterialPatch !== true) {
        throw new Error(
          'Retained standard-patch ShaderMaterial requires another translated standard patch.',
        );
      }
      const nextParameters = reseedParameters(next, parameters, binding.overriddenParameters);
      const nextOwnedSamplers = new Map<string, ThreeTexture>();
      const nextProgramUniforms = threeProgramUniforms(next, nextParameters, nextOwnedSamplers);
      return () => {
        releaseGodotThreeSamplers(ownedSamplers.values());
        ownedSamplers = nextOwnedSamplers;
        preparedProgramUniforms = nextProgramUniforms;
        binding.shader = next;
        binding.shaderRevision = next.getRevision();
        activeShader = next;
        activeSource = nextSource;
        replaceParameters(parameters, nextParameters);
        liveUniforms.clear();
        depthTexture.sync(next);
        native.needsUpdate = true;
        applyThreeRenderModes(native, next);
        godotResourceEmitChanged(native);
      };
    },
  };
  bindings.set(native, binding as GodotShaderMaterialBinding<object>);
  depthTexture.sync(shader);
  const inheritedBeforeRender = native.onBeforeRender;
  const viewport = new Vector2();
  native.onBeforeRender = (...args): void => {
    inheritedBeforeRender.apply(native, args);
    updateThreeScreenUniforms(activeSource, liveUniforms, args[0], args[2], viewport);
  };
  applyThreeRenderModes(native, shader);
  bindGodotMaterial<ThreeMaterial>(native, {}, 'ShaderMaterial', {
    createDuplicate: duplicateBoundThreeShaderMaterial,
  });
  return native;
}

function duplicateBoundThreeShaderMaterial(source: ThreeMaterial): ThreeMaterial {
  const binding = godotShaderMaterialBinding(source);
  const copy = createGodotThreeShaderMaterial(
    binding.shader,
    Object.fromEntries(binding.parameters),
  );
  const copyBinding = godotShaderMaterialBinding(copy);
  copyBinding.overriddenParameters.clear();
  for (const name of binding.overriddenParameters) copyBinding.overriddenParameters.add(name);
  return copy;
}

function pixiUniformType(uniform: GodotShaderUniform): UNIFORM_TYPES | undefined {
  switch (uniform.type) {
    case 'bool':
    case 'int':
      return 'i32';
    case 'float':
      return 'f32';
    case 'vec2':
      return 'vec2<f32>';
    case 'vec3':
      return 'vec3<f32>';
    case 'vec4':
    case 'color':
      return 'vec4<f32>';
    case 'ivec2':
      return 'vec2<i32>';
    case 'ivec3':
      return 'vec3<i32>';
    case 'ivec4':
      return 'vec4<i32>';
    case 'mat3':
      return 'mat3x3<f32>';
    case 'mat4':
      return 'mat4x4<f32>';
    default:
      return undefined;
  }
}

function isSampler(type: string): boolean {
  return type.startsWith('sampler');
}

function pixiUniformValue(type: UNIFORM_TYPES, value: unknown): unknown {
  if (type === 'i32' || type === 'f32') {
    const scalar = Number(value);
    if (!Number.isFinite(scalar)) {
      throw new TypeError(`ShaderMaterial ${type} uniform requires a finite scalar.`);
    }
    return type === 'f32' ? scalar : Math.trunc(scalar);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (type === 'vec2<f32>' || type === 'vec2<i32>') {
      const values = [Number(record['x'] ?? 0), Number(record['y'] ?? 0)];
      return type === 'vec2<i32>'
        ? new Int32Array(values.map(Math.trunc))
        : new Float32Array(values);
    }
    if (type === 'vec3<f32>' || type === 'vec3<i32>') {
      const values = [Number(record['x'] ?? 0), Number(record['y'] ?? 0), Number(record['z'] ?? 0)];
      return type === 'vec3<i32>'
        ? new Int32Array(values.map(Math.trunc))
        : new Float32Array(values);
    }
    if (type === 'vec4<f32>' || type === 'vec4<i32>') {
      const values = [
        Number(record['x'] ?? record['r'] ?? 0),
        Number(record['y'] ?? record['g'] ?? 0),
        Number(record['z'] ?? record['b'] ?? 0),
        Number(record['w'] ?? record['a'] ?? 0),
      ];
      return type === 'vec4<i32>'
        ? new Int32Array(values.map(Math.trunc))
        : new Float32Array(values);
    }
  }
  return value ?? 0;
}

function pixiSamplerValue(name: string, value: unknown): unknown {
  if (value instanceof PixiTexture) return value.source;
  if (value === null) return undefined;
  throw new TypeError(`ShaderMaterial sampler ${name} requires a native Pixi Texture or null.`);
}

interface PixiRuntime {
  readonly group: UniformGroup<Record<string, UniformData>>;
  readonly resources: Record<string, unknown>;
}

function pixiResources(
  shader: GodotShader,
  parameters: ReadonlyMap<string, GodotShaderParameter>,
): PixiRuntime {
  const structures: Record<string, UniformData> = {};
  const resources: Record<string, unknown> = {};
  for (const uniform of shader.getShaderUniformList()) {
    const value = parameters.get(uniform.name) ?? shader.getDefaultTextureParameter(uniform.name);
    if (isSampler(uniform.type)) {
      const resource = pixiSamplerValue(uniform.name, value);
      if (resource !== undefined) resources[uniform.name] = resource;
      continue;
    }
    const type = pixiUniformType(uniform);
    if (type === undefined) {
      throw new Error(
        `ShaderMaterial Pixi uniform ${uniform.name} uses unsupported exact type ${uniform.type}.`,
      );
    }
    structures[uniform.name] = { value: pixiUniformValue(type, value), type };
  }
  if (shader.sourcesFor('pixi')?.usesTime === true) {
    structures['godotTime'] = { value: 0, type: 'f32' };
  }
  const group = new UniformGroup(structures);
  resources['godotUniforms'] = group;
  return { group, resources };
}

function applyPixiRenderModes(filter: Filter, shader: GodotShader): void {
  const modes = new Set(shader.getRenderModes());
  filter.blendMode = modes.has('blend_add') ? 'add' : 'normal';
}

function prepareNativeShader(native: object, shader: GodotShader): () => void {
  const binding = bindings.get(native);
  if (binding === undefined) {
    throw new Error('ShaderMaterial retained native has no Godot binding.');
  }
  return binding.prepareShader(shader);
}

function prepareNativeShaderParameter(
  native: object,
  name: string,
  value: GodotShaderParameter,
): () => void {
  const binding = bindings.get(native);
  if (binding === undefined) {
    throw new Error('ShaderMaterial retained native has no Godot binding.');
  }
  return binding.prepareParameter(name, value);
}

export function createGodotPixiShaderMaterial(
  shader: GodotShader,
  authored: GodotShaderParameters = {},
): Filter {
  const source = shader.sourcesFor('pixi');
  if (source === undefined) {
    throw new Error('ShaderMaterial requires translated Pixi vertex and fragment sources.');
  }
  const parameters = parameterSeed(shader, authored);
  let runtime = pixiResources(shader, parameters);
  const native = new Filter({
    glProgram: GlProgram.from({ vertex: source.vertex, fragment: source.fragment }),
    resources: runtime.resources,
  });
  applyPixiRenderModes(native, shader);
  const startedAt = globalThis.performance?.now() ?? Date.now();
  {
    const apply = native.apply.bind(native);
    native.apply = ((...args: Parameters<Filter['apply']>) => {
      if ('godotTime' in runtime.group.uniforms) {
        runtime.group.uniforms['godotTime'] = (((globalThis.performance?.now() ?? Date.now()) -
          startedAt) /
          1_000) as never;
      }
      if (
        binding.shader.sourcesFor('pixi')?.usesScreenTexture === true &&
        native.resources['godotScreenTexture'] === undefined
      ) {
        throw new Error(
          'ShaderMaterial SCREEN_TEXTURE requires the preceding canvas back-buffer capture.',
        );
      }
      apply(...args);
    }) as Filter['apply'];
  }
  const binding: GodotShaderMaterialBinding<Filter> = {
    native,
    shader,
    parameters,
    overriddenParameters: new Set(Object.keys(authored)),
    shaderRevision: shader.getRevision(),
    backend: 'pixi',
    prepareParameter(name, value) {
      if (name in runtime.group.uniforms) {
        const declaration = binding.shader.uniform(name);
        const type = declaration === undefined ? undefined : pixiUniformType(declaration);
        if (type === undefined) {
          throw new Error(
            `ShaderMaterial Pixi uniform ${name} has no supported exact uniform declaration.`,
          );
        }
        const converted = pixiUniformValue(type, value);
        return () => {
          parameters.set(name, value);
          binding.overriddenParameters.add(name);
          runtime.group.uniforms[name] = converted as never;
          godotResourceEmitChanged(native);
        };
      }
      return () => {
        parameters.set(name, value);
        binding.overriddenParameters.add(name);
        const resource = pixiSamplerValue(name, value);
        if (resource === undefined) delete native.resources[name];
        else native.resources[name] = resource;
        godotResourceEmitChanged(native);
      };
    },
    prepareShader(next) {
      const sources = next.sourcesFor('pixi');
      if (sources === undefined) {
        throw new Error('ShaderMaterial requires translated Pixi vertex and fragment sources.');
      }
      const nextParameters = reseedParameters(next, parameters, binding.overriddenParameters);
      const nextRuntime = pixiResources(next, nextParameters);
      const nextProgram = GlProgram.from({ vertex: sources.vertex, fragment: sources.fragment });
      return () => {
        binding.shader = next;
        binding.shaderRevision = next.getRevision();
        replaceParameters(parameters, nextParameters);
        runtime = nextRuntime;
        native.glProgram = nextProgram;
        for (const name of Object.keys(native.resources)) delete native.resources[name];
        Object.assign(native.resources, runtime.resources);
        applyPixiRenderModes(native, next);
        godotResourceEmitChanged(native);
      };
    },
  };
  bindings.set(native, binding as GodotShaderMaterialBinding<object>);
  bindGodotMaterial(native, {}, 'ShaderMaterial', {
    createDuplicate: duplicateBoundPixiShaderMaterial,
  });
  return native;
}

function duplicateBoundPixiShaderMaterial(source: Filter): Filter {
  const binding = godotShaderMaterialBinding(source);
  const copy = createGodotPixiShaderMaterial(
    binding.shader,
    Object.fromEntries(binding.parameters),
  );
  const copyBinding = godotShaderMaterialBinding(copy);
  copyBinding.overriddenParameters.clear();
  for (const name of binding.overriddenParameters) copyBinding.overriddenParameters.add(name);
  return copy;
}

/** Supply Godot 4's explicit `hint_screen_texture` sampler from the preceding canvas copy. */
export function setGodotPixiScreenTexture(native: Filter, texture: PixiTexture): void {
  const binding = godotShaderMaterialBinding(native);
  const uniforms = binding.shader
    .getShaderUniformList()
    .filter(
      (uniform) =>
        uniform.type.startsWith('sampler') &&
        uniform.hint?.split(',').some((hint) => hint.trim() === 'hint_screen_texture'),
    );
  for (const uniform of uniforms) native.resources[uniform.name] = texture.source;
  if (binding.shader.sourcesFor('pixi')?.usesScreenTexture === true) {
    native.resources['godotScreenTexture'] = texture.source;
  }
}

export function clearGodotPixiScreenTexture(native: Filter): void {
  const binding = godotShaderMaterialBinding(native);
  for (const uniform of binding.shader.getShaderUniformList()) {
    if (
      uniform.type.startsWith('sampler') &&
      uniform.hint?.split(',').some((hint) => hint.trim() === 'hint_screen_texture')
    ) {
      delete native.resources[uniform.name];
    }
  }
  delete native.resources['godotScreenTexture'];
}

export function godotShaderMaterialBinding<TNative extends object>(
  native: TNative,
): GodotShaderMaterialBinding<TNative> {
  const binding = bindings.get(native) as GodotShaderMaterialBinding<TNative> | undefined;
  if (binding === undefined)
    throw new Error('Native material is not bound as a Godot ShaderMaterial.');
  return binding;
}

export function getShader<TNative extends object>(
  native: TNative | GodotShaderMaterial,
): GodotShader | null {
  if (native instanceof GodotShaderMaterial) return native.shader;
  return godotShaderMaterialBinding(native).shader;
}

export function setShader<TNative extends object>(
  native: TNative | GodotShaderMaterial,
  shader: GodotShader | null,
): void {
  if (native instanceof GodotShaderMaterial) {
    native.setShader(shader);
    return;
  }
  if (shader === null) throw new Error('A retained native ShaderMaterial cannot clear its Shader.');
  const binding = godotShaderMaterialBinding(native);
  binding.prepareShader(shader)();
}

export function setShaderParameter<TNative extends object>(
  native: TNative | GodotShaderMaterial,
  name: string,
  value: GodotShaderParameter,
): void {
  name = shaderParameterName(name);
  if (native instanceof GodotShaderMaterial) {
    native.setShaderParameter(name, value);
    return;
  }
  const binding = godotShaderMaterialBinding(native);
  binding.prepareParameter(name, value)();
}

export function getShaderParameter<TNative extends object>(
  native: TNative | GodotShaderMaterial,
  name: string,
): GodotShaderParameter {
  name = shaderParameterName(name);
  if (native instanceof GodotShaderMaterial) return native.getShaderParameter(name);
  const binding = godotShaderMaterialBinding(native);
  return binding.parameters.has(name)
    ? binding.parameters.get(name)
    : binding.shader.getDefaultParameterValue(name);
}

type OpenShaderMaterialMethod =
  | 'set_shader_param'
  | 'get_shader_param'
  | 'set_shader_parameter'
  | 'get_shader_parameter';

/**
 * Runtime refinement for a statically open Resource/Material receiver. Only the generated row for
 * the retained concrete ShaderMaterial identity may execute; script methods and arbitrary object
 * properties are deliberately outside this path.
 */
export function godotOpenShaderMaterialCall(
  receiver: unknown,
  major: 3 | 4,
  method: OpenShaderMaterialMethod,
  args: readonly unknown[],
): unknown {
  const legacy = method === 'set_shader_param' || method === 'get_shader_param';
  if (legacy !== (major === 3)) {
    throw new Error(`godot-compat: ShaderMaterial.${method} is not declared by Godot ${major}.x.`);
  }
  const expected = method.startsWith('set_') ? 2 : 1;
  if (args.length !== expected) {
    throw new TypeError(
      `godot-compat: ShaderMaterial.${method} requires exactly ${expected} argument${expected === 1 ? '' : 's'}.`,
    );
  }
  if (!godotObjectIsClass(receiver, 'ShaderMaterial', major)) {
    throw new TypeError(
      `godot-compat: open Resource.${method} requires a retained ShaderMaterial identity.`,
    );
  }
  const binding = godotObjectBindingOf(receiver);
  if (binding.scriptMembers?.has(method) === true) {
    throw new Error(
      `godot-compat: open Resource.${method} refuses a translated script override; only the native ShaderMaterial row is admissible.`,
    );
  }
  const native = binding.dispatch.methods[method];
  if (native === undefined || native === null) {
    // Runtime-created and duplicated ShaderMaterial resources begin as the compat Resource object
    // itself. They retain exact ShaderMaterial identity immediately, before any scene/backend has
    // installed a surface-specific generated dispatch table. Execute the same owned methods on
    // that exact resource carrier; native Three/Pixi materials still require their generated row.
    const retainedNative =
      (typeof receiver === 'object' && receiver !== null) || typeof receiver === 'function'
        ? bindings.has(receiver as object)
        : false;
    if (receiver instanceof GodotShaderMaterial || retainedNative) {
      const name = shaderParameterName(args[0]);
      if (method === 'set_shader_param' || method === 'set_shader_parameter') {
        setShaderParameter(receiver as object | GodotShaderMaterial, name, args[1]);
        return undefined;
      }
      return getShaderParameter(receiver as object | GodotShaderMaterial, name);
    }
    throw new Error(
      `godot-compat: ${binding.godotClass}.${method} has no exact generated native dispatch row.`,
    );
  }
  return native.call(binding, args);
}

export function syncShaderMaterial<TNative extends object>(native: TNative): void {
  const binding = godotShaderMaterialBinding(native);
  if (binding.shaderRevision === binding.shader.getRevision()) return;
  binding.prepareShader(binding.shader)();
}

export function duplicateThreeShaderMaterial(native: ThreeShaderMaterial): ThreeShaderMaterial {
  const binding = godotShaderMaterialBinding(native);
  const duplicate = duplicateGodotMaterial(
    native,
    (material) => material.clone(),
    false,
    'ShaderMaterial',
  );
  const copy = godotShaderMaterialBindingOrCreate(
    duplicate,
    binding.shader,
    binding.parameters,
    binding.overriddenParameters,
    'three',
  );
  return copy.native;
}

function godotShaderMaterialBindingOrCreate<TNative extends object>(
  native: TNative,
  shader: GodotShader,
  parameters: ReadonlyMap<string, GodotShaderParameter>,
  overriddenParameters: ReadonlySet<string>,
  backend: 'three' | 'pixi',
): GodotShaderMaterialBinding<TNative> {
  const existing = bindings.get(native) as GodotShaderMaterialBinding<TNative> | undefined;
  if (existing !== undefined) return existing;
  let ownedSamplers = new Map<string, ThreeTexture>();
  if (native instanceof ThreeShaderMaterial) {
    native.uniforms = threeProgramUniforms(shader, parameters, ownedSamplers);
  }
  const binding: GodotShaderMaterialBinding<TNative> = {
    native,
    shader,
    parameters: new Map(parameters),
    overriddenParameters: new Set(overriddenParameters),
    shaderRevision: shader.getRevision(),
    backend,
    ...(native instanceof ThreeShaderMaterial
      ? {
          release: () => {
            releaseGodotThreeSamplers(ownedSamplers.values());
            ownedSamplers.clear();
          },
        }
      : {}),
    prepareParameter(name, value) {
      const declaration = binding.shader.uniform(name);
      const prepared =
        declaration === undefined
          ? { value }
          : prepareThreeUniformValue(binding.shader, declaration, value);
      return () => {
        binding.parameters.set(name, value);
        binding.overriddenParameters.add(name);
        if (native instanceof ThreeShaderMaterial) {
          ownedSamplers.get(name)?.dispose();
          ownedSamplers.delete(name);
          if (prepared.owned !== undefined) ownedSamplers.set(name, prepared.owned);
          native.uniforms[name] ??= { value: prepared.value };
          native.uniforms[name].value = prepared.value;
          updateThreeTextureSizeUniforms(
            binding.shader.sourcesFor('three'),
            [native.uniforms],
            name,
            prepared.value,
          );
          native.uniformsNeedUpdate = true;
        }
      };
    },
    prepareShader(next) {
      if (!(native instanceof ThreeShaderMaterial)) {
        throw new Error('Only retained Three ShaderMaterial duplication is implemented.');
      }
      const source = next.sourcesFor('three');
      if (source === undefined)
        throw new Error('ShaderMaterial requires translated Three sources.');
      const nextParameters = reseedParameters(
        next,
        binding.parameters,
        binding.overriddenParameters,
      );
      const nextOwnedSamplers = new Map<string, ThreeTexture>();
      const uniforms = threeProgramUniforms(next, nextParameters, nextOwnedSamplers);
      return () => {
        releaseGodotThreeSamplers(ownedSamplers.values());
        ownedSamplers = nextOwnedSamplers;
        binding.shader = next;
        binding.shaderRevision = next.getRevision();
        replaceParameters(binding.parameters, nextParameters);
        native.vertexShader = source.vertex;
        native.fragmentShader = source.fragment;
        native.uniforms = uniforms;
        native.needsUpdate = true;
      };
    },
  };
  bindings.set(native, binding as GodotShaderMaterialBinding<object>);
  return binding;
}
