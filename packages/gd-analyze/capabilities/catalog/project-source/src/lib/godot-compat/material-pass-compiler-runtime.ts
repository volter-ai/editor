export type GodotMaterialPassRid = string | number;

export const GODOT_MATERIAL_RENDER_PASS = {
  DEPTH: 'depth',
  COLOR: 'color',
  SHADOW: 'shadow',
  MOTION: 'motion',
  OVERLAY: 'overlay',
} as const;

export type GodotMaterialRenderPass =
  (typeof GODOT_MATERIAL_RENDER_PASS)[keyof typeof GODOT_MATERIAL_RENDER_PASS];

export const GODOT_MATERIAL_CULL_MODE = {
  DISABLED: 0,
  FRONT: 1,
  BACK: 2,
} as const;

export const GODOT_MATERIAL_DEPTH_DRAW_MODE = {
  OPAQUE_ONLY: 0,
  ALWAYS: 1,
  NEVER: 2,
} as const;

export const GODOT_MATERIAL_BLEND_MODE = {
  MIX: 0,
  ADD: 1,
  SUB: 2,
  MUL: 3,
  PREMULTIPLIED_ALPHA: 4,
} as const;

export interface GodotMaterialPassDescriptor {
  readonly rid: GodotMaterialPassRid;
  readonly shader: GodotMaterialPassRid | null;
  readonly nextPass?: GodotMaterialPassRid | null;
  readonly shadowPass?: GodotMaterialPassRid | null;
  readonly priority?: number;
  readonly transparent?: boolean;
  readonly blendMode?: number;
  readonly cullMode?: number;
  readonly depthDrawMode?: number;
  readonly depthTest?: boolean;
  readonly depthWrite?: boolean;
  readonly alphaToCoverage?: boolean;
  readonly wireframe?: boolean;
  readonly castsShadow?: boolean;
  readonly receivesShadow?: boolean;
  readonly usesScreenTexture?: boolean;
  readonly usesDepthTexture?: boolean;
  readonly usesNormalTexture?: boolean;
  readonly vertexDisplacement?: boolean;
  readonly instanceUniforms?: readonly string[];
  readonly textureBindings?: Readonly<Record<string, GodotMaterialPassRid | null>>;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly defines?: Readonly<Record<string, string | number | boolean>>;
}

export interface GodotMaterialPassVariant {
  readonly pass: GodotMaterialRenderPass;
  readonly framebufferFormat: GodotMaterialPassRid | null;
  readonly vertexFormat: GodotMaterialPassRid | null;
  readonly sampleCount?: number;
  readonly viewCount?: number;
  readonly reverseCull?: boolean;
  readonly forceDoubleSided?: boolean;
  readonly forceOpaque?: boolean;
  readonly instanceFormat?: number;
  readonly specialization?: Readonly<Record<string, string | number | boolean>>;
}

export interface GodotCompiledMaterialPass {
  readonly key: string;
  readonly material: GodotMaterialPassRid;
  readonly sourceMaterial: GodotMaterialPassRid;
  readonly shader: GodotMaterialPassRid | null;
  readonly pass: GodotMaterialRenderPass;
  readonly passIndex: number;
  readonly framebufferFormat: GodotMaterialPassRid | null;
  readonly vertexFormat: GodotMaterialPassRid | null;
  readonly sampleCount: number;
  readonly viewCount: number;
  readonly instanceFormat: number;
  readonly priority: number;
  readonly transparent: boolean;
  readonly blendMode: number;
  readonly cullMode: number;
  readonly depthDrawMode: number;
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly alphaToCoverage: boolean;
  readonly wireframe: boolean;
  readonly castsShadow: boolean;
  readonly receivesShadow: boolean;
  readonly usesScreenTexture: boolean;
  readonly usesDepthTexture: boolean;
  readonly usesNormalTexture: boolean;
  readonly vertexDisplacement: boolean;
  readonly instanceUniforms: readonly string[];
  readonly textureBindings: Readonly<Record<string, GodotMaterialPassRid | null>>;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly defines: Readonly<Record<string, string | number | boolean>>;
  readonly revision: number;
}

export interface GodotMaterialPassCompilation {
  readonly material: GodotMaterialPassRid;
  readonly variant: GodotMaterialPassVariant;
  readonly key: string;
  readonly passes: readonly GodotCompiledMaterialPass[];
  readonly transparent: boolean;
  readonly needsScreenTexture: boolean;
  readonly needsDepthTexture: boolean;
  readonly needsNormalTexture: boolean;
  readonly hasVertexDisplacement: boolean;
  readonly revision: number;
}

export interface GodotMaterialPassCompilerSnapshot {
  readonly materials: number;
  readonly compilations: number;
  readonly dirtyMaterials: number;
  readonly revision: number;
}

export interface GodotMaterialPassBackend<THandle = unknown> {
  create(pass: GodotCompiledMaterialPass): THandle;
  update?(handle: THandle, pass: GodotCompiledMaterialPass): void;
  destroy(handle: THandle, pass: GodotCompiledMaterialPass): void;
}

export interface GodotMaterialPassHandle<THandle = unknown> {
  readonly pass: GodotCompiledMaterialPass;
  readonly handle: THandle;
}

interface MutableMaterial {
  rid: GodotMaterialPassRid;
  shader: GodotMaterialPassRid | null;
  nextPass: GodotMaterialPassRid | null;
  shadowPass: GodotMaterialPassRid | null;
  priority: number;
  transparent: boolean;
  blendMode: number;
  cullMode: number;
  depthDrawMode: number;
  depthTest: boolean;
  depthWrite: boolean;
  alphaToCoverage: boolean;
  wireframe: boolean;
  castsShadow: boolean;
  receivesShadow: boolean;
  usesScreenTexture: boolean;
  usesDepthTexture: boolean;
  usesNormalTexture: boolean;
  vertexDisplacement: boolean;
  instanceUniforms: string[];
  textureBindings: Record<string, GodotMaterialPassRid | null>;
  parameters: Record<string, unknown>;
  defines: Record<string, string | number | boolean>;
  revision: number;
}

interface CompilationCache {
  signature: string;
  compilation: GodotMaterialPassCompilation;
}

interface HandleCache<THandle> {
  signature: string;
  pass: GodotCompiledMaterialPass;
  handle: THandle;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: ${member} requires a finite number.`);
  }
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = finite(value, member);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function ridKey(value: GodotMaterialPassRid | null): string {
  return value === null ? '-' : `${typeof value}:${String(value)}`;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (ArrayBuffer.isView(value)) {
    return `[${Array.from(value as unknown as ArrayLike<unknown>).map(stable).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

function cloneRecord<T>(value: Readonly<Record<string, T>> | undefined): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, value ?? {});
}

function reverseCull(mode: number): number {
  if (mode === GODOT_MATERIAL_CULL_MODE.FRONT) return GODOT_MATERIAL_CULL_MODE.BACK;
  if (mode === GODOT_MATERIAL_CULL_MODE.BACK) return GODOT_MATERIAL_CULL_MODE.FRONT;
  return mode;
}

function variantKey(variant: GodotMaterialPassVariant): string {
  return stable({
    pass: variant.pass,
    framebufferFormat: ridKey(variant.framebufferFormat),
    vertexFormat: ridKey(variant.vertexFormat),
    sampleCount: variant.sampleCount ?? 1,
    viewCount: variant.viewCount ?? 1,
    reverseCull: variant.reverseCull ?? false,
    forceDoubleSided: variant.forceDoubleSided ?? false,
    forceOpaque: variant.forceOpaque ?? false,
    instanceFormat: variant.instanceFormat ?? 0,
    specialization: variant.specialization ?? {},
  });
}

function descriptor(value: GodotMaterialPassDescriptor, revision: number): MutableMaterial {
  if (value.rid === null || value.rid === undefined) throw new TypeError('godot-compat: material pass RID is required.');
  const instanceUniforms = [...new Set(value.instanceUniforms ?? [])];
  if (!instanceUniforms.every((name) => typeof name === 'string' && name.length > 0)) {
    throw new TypeError('godot-compat: instance uniform names require non-empty strings.');
  }
  return {
    rid: value.rid,
    shader: value.shader,
    nextPass: value.nextPass ?? null,
    shadowPass: value.shadowPass ?? null,
    priority: integer(value.priority ?? 0, 'material priority', -128, 127),
    transparent: value.transparent ?? false,
    blendMode: integer(value.blendMode ?? 0, 'material blend mode', 0, 4),
    cullMode: integer(value.cullMode ?? 2, 'material cull mode', 0, 2),
    depthDrawMode: integer(value.depthDrawMode ?? 0, 'material depth draw mode', 0, 2),
    depthTest: value.depthTest ?? true,
    depthWrite: value.depthWrite ?? !(value.transparent ?? false),
    alphaToCoverage: value.alphaToCoverage ?? false,
    wireframe: value.wireframe ?? false,
    castsShadow: value.castsShadow ?? true,
    receivesShadow: value.receivesShadow ?? true,
    usesScreenTexture: value.usesScreenTexture ?? false,
    usesDepthTexture: value.usesDepthTexture ?? false,
    usesNormalTexture: value.usesNormalTexture ?? false,
    vertexDisplacement: value.vertexDisplacement ?? false,
    instanceUniforms,
    textureBindings: cloneRecord(value.textureBindings),
    parameters: cloneRecord(value.parameters),
    defines: cloneRecord(value.defines),
    revision,
  };
}

export class GodotMaterialPassCompilerRuntime<THandle = unknown> {
  private readonly materials = new Map<GodotMaterialPassRid, MutableMaterial>();
  private readonly dependants = new Map<GodotMaterialPassRid, Set<GodotMaterialPassRid>>();
  private readonly compilations = new Map<string, CompilationCache>();
  private readonly handles = new Map<string, HandleCache<THandle>>();
  private readonly dirty = new Set<GodotMaterialPassRid>();
  private readonly watchers = new Set<(compilation: GodotMaterialPassCompilation) => void>();
  private revision = 1;

  constructor(private backend?: GodotMaterialPassBackend<THandle>) {}

  define(value: GodotMaterialPassDescriptor): void {
    const old = this.materials.get(value.rid);
    if (old !== undefined) this.unlink(old);
    const material = descriptor(value, ++this.revision);
    this.materials.set(material.rid, material);
    this.link(material);
    this.invalidate(material.rid);
  }

  patch(rid: GodotMaterialPassRid, patch: Partial<Omit<GodotMaterialPassDescriptor, 'rid'>>): void {
    const current = this.require(rid);
    this.define({
      rid,
      shader: patch.shader === undefined ? current.shader : patch.shader,
      nextPass: patch.nextPass === undefined ? current.nextPass : patch.nextPass,
      shadowPass: patch.shadowPass === undefined ? current.shadowPass : patch.shadowPass,
      priority: patch.priority ?? current.priority,
      transparent: patch.transparent ?? current.transparent,
      blendMode: patch.blendMode ?? current.blendMode,
      cullMode: patch.cullMode ?? current.cullMode,
      depthDrawMode: patch.depthDrawMode ?? current.depthDrawMode,
      depthTest: patch.depthTest ?? current.depthTest,
      depthWrite: patch.depthWrite ?? current.depthWrite,
      alphaToCoverage: patch.alphaToCoverage ?? current.alphaToCoverage,
      wireframe: patch.wireframe ?? current.wireframe,
      castsShadow: patch.castsShadow ?? current.castsShadow,
      receivesShadow: patch.receivesShadow ?? current.receivesShadow,
      usesScreenTexture: patch.usesScreenTexture ?? current.usesScreenTexture,
      usesDepthTexture: patch.usesDepthTexture ?? current.usesDepthTexture,
      usesNormalTexture: patch.usesNormalTexture ?? current.usesNormalTexture,
      vertexDisplacement: patch.vertexDisplacement ?? current.vertexDisplacement,
      instanceUniforms: patch.instanceUniforms ?? current.instanceUniforms,
      textureBindings: patch.textureBindings ?? current.textureBindings,
      parameters: patch.parameters ?? current.parameters,
      defines: patch.defines ?? current.defines,
    });
  }

  remove(rid: GodotMaterialPassRid): boolean {
    const material = this.materials.get(rid);
    if (material === undefined) return false;
    this.unlink(material);
    this.materials.delete(rid);
    this.invalidate(rid);
    this.dependants.delete(rid);
    return true;
  }

  has(rid: GodotMaterialPassRid): boolean {
    return this.materials.has(rid);
  }

  getDescriptor(rid: GodotMaterialPassRid): GodotMaterialPassDescriptor {
    const material = this.require(rid);
    return Object.freeze({
      rid: material.rid,
      shader: material.shader,
      nextPass: material.nextPass,
      shadowPass: material.shadowPass,
      priority: material.priority,
      transparent: material.transparent,
      blendMode: material.blendMode,
      cullMode: material.cullMode,
      depthDrawMode: material.depthDrawMode,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      alphaToCoverage: material.alphaToCoverage,
      wireframe: material.wireframe,
      castsShadow: material.castsShadow,
      receivesShadow: material.receivesShadow,
      usesScreenTexture: material.usesScreenTexture,
      usesDepthTexture: material.usesDepthTexture,
      usesNormalTexture: material.usesNormalTexture,
      vertexDisplacement: material.vertexDisplacement,
      instanceUniforms: Object.freeze([...material.instanceUniforms]),
      textureBindings: Object.freeze({ ...material.textureBindings }),
      parameters: Object.freeze({ ...material.parameters }),
      defines: Object.freeze({ ...material.defines }),
    });
  }

  compile(rid: GodotMaterialPassRid, variant: GodotMaterialPassVariant): GodotMaterialPassCompilation {
    const root = this.require(rid);
    this.validateVariant(variant);
    const variantSignature = variantKey(variant);
    const chain = this.chain(root, variant.pass);
    const signature = `${variantSignature}/${chain.map((material) => `${ridKey(material.rid)}@${material.revision}`).join('/')}`;
    const cacheKey = `${ridKey(rid)}/${variantSignature}`;
    const retained = this.compilations.get(cacheKey);
    if (retained?.signature === signature && !this.dirty.has(rid)) return retained.compilation;
    const passes = chain
      .map((material, passIndex) => this.compilePass(root, material, variant, passIndex))
      .filter((pass): pass is GodotCompiledMaterialPass => pass !== null);
    const compilation: GodotMaterialPassCompilation = Object.freeze({
      material: rid,
      variant: Object.freeze({ ...variant, specialization: Object.freeze({ ...(variant.specialization ?? {}) }) }),
      key: cacheKey,
      passes: Object.freeze(passes),
      transparent: passes.some((pass) => pass.transparent),
      needsScreenTexture: passes.some((pass) => pass.usesScreenTexture),
      needsDepthTexture: passes.some((pass) => pass.usesDepthTexture),
      needsNormalTexture: passes.some((pass) => pass.usesNormalTexture),
      hasVertexDisplacement: passes.some((pass) => pass.vertexDisplacement),
      revision: this.revision,
    });
    this.compilations.set(cacheKey, { signature, compilation });
    this.dirty.delete(rid);
    for (const watcher of this.watchers) watcher(compilation);
    return compilation;
  }

  getHandles(rid: GodotMaterialPassRid, variant: GodotMaterialPassVariant): readonly GodotMaterialPassHandle<THandle>[] {
    if (this.backend === undefined) throw new Error('godot-compat: material pass compiler has no backend.');
    const compilation = this.compile(rid, variant);
    const used = new Set<string>();
    const values = compilation.passes.map((pass) => {
      used.add(pass.key);
      const signature = `${pass.revision}/${stable(pass.defines)}/${stable(pass.parameters)}/${stable(pass.textureBindings)}`;
      let cached = this.handles.get(pass.key);
      if (cached === undefined) {
        cached = { signature, pass, handle: this.backend!.create(pass) };
        this.handles.set(pass.key, cached);
      } else if (cached.signature !== signature) {
        if (this.backend!.update !== undefined) this.backend!.update(cached.handle, pass);
        else {
          this.backend!.destroy(cached.handle, cached.pass);
          cached.handle = this.backend!.create(pass);
        }
        cached.signature = signature;
        cached.pass = pass;
      }
      return Object.freeze({ pass, handle: cached.handle });
    });
    const prefix = `${ridKey(rid)}/`;
    for (const [key, cached] of this.handles) {
      if (!key.startsWith(prefix) || used.has(key)) continue;
      this.backend.destroy(cached.handle, cached.pass);
      this.handles.delete(key);
    }
    return Object.freeze(values);
  }

  invalidate(rid: GodotMaterialPassRid): void {
    this.revision++;
    const queue = [rid];
    const visited = new Set<GodotMaterialPassRid>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      this.dirty.add(current);
      for (const dependant of this.dependants.get(current) ?? []) queue.push(dependant);
    }
    for (const key of this.compilations.keys()) {
      const separator = key.indexOf('/');
      const rootKey = separator < 0 ? key : key.slice(0, separator);
      if ([...visited].some((candidate) => ridKey(candidate) === rootKey)) this.compilations.delete(key);
    }
    for (const [key, cached] of this.handles) {
      if (![...visited].some((candidate) => key.startsWith(`${ridKey(candidate)}/`))) continue;
      this.backend?.destroy(cached.handle, cached.pass);
      this.handles.delete(key);
    }
  }

  replaceBackend(backend: GodotMaterialPassBackend<THandle>): void {
    for (const cached of this.handles.values()) this.backend?.destroy(cached.handle, cached.pass);
    this.handles.clear();
    this.backend = backend;
  }

  watch(listener: (compilation: GodotMaterialPassCompilation) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  getSnapshot(): GodotMaterialPassCompilerSnapshot {
    return Object.freeze({
      materials: this.materials.size,
      compilations: this.compilations.size,
      dirtyMaterials: this.dirty.size,
      revision: this.revision,
    });
  }

  clear(): void {
    for (const cached of this.handles.values()) this.backend?.destroy(cached.handle, cached.pass);
    this.materials.clear();
    this.dependants.clear();
    this.compilations.clear();
    this.handles.clear();
    this.dirty.clear();
    this.revision++;
  }

  private compilePass(
    root: MutableMaterial,
    material: MutableMaterial,
    variant: GodotMaterialPassVariant,
    passIndex: number,
  ): GodotCompiledMaterialPass | null {
    if (variant.pass === GODOT_MATERIAL_RENDER_PASS.SHADOW && !material.castsShadow) return null;
    if (variant.pass === GODOT_MATERIAL_RENDER_PASS.DEPTH && material.depthDrawMode === GODOT_MATERIAL_DEPTH_DRAW_MODE.NEVER) return null;
    const transparent = !variant.forceOpaque && material.transparent && variant.pass !== GODOT_MATERIAL_RENDER_PASS.SHADOW;
    if (variant.pass === GODOT_MATERIAL_RENDER_PASS.DEPTH
      && transparent
      && material.depthDrawMode === GODOT_MATERIAL_DEPTH_DRAW_MODE.OPAQUE_ONLY) return null;
    const cullMode = variant.forceDoubleSided
      ? GODOT_MATERIAL_CULL_MODE.DISABLED
      : variant.reverseCull ? reverseCull(material.cullMode) : material.cullMode;
    const specialization = variant.specialization ?? {};
    const defines = Object.freeze({
      ...material.defines,
      ...specialization,
      GODOT_PASS_DEPTH: variant.pass === GODOT_MATERIAL_RENDER_PASS.DEPTH,
      GODOT_PASS_COLOR: variant.pass === GODOT_MATERIAL_RENDER_PASS.COLOR,
      GODOT_PASS_SHADOW: variant.pass === GODOT_MATERIAL_RENDER_PASS.SHADOW,
      GODOT_PASS_MOTION: variant.pass === GODOT_MATERIAL_RENDER_PASS.MOTION,
      GODOT_PASS_OVERLAY: variant.pass === GODOT_MATERIAL_RENDER_PASS.OVERLAY,
      GODOT_MULTIVIEW: (variant.viewCount ?? 1) > 1,
      GODOT_INSTANCING: (variant.instanceFormat ?? 0) !== 0,
      GODOT_ALPHA_TO_COVERAGE: material.alphaToCoverage,
      GODOT_VERTEX_DISPLACEMENT: material.vertexDisplacement,
      GODOT_RECEIVE_SHADOWS: material.receivesShadow,
    });
    const key = `${ridKey(root.rid)}/${variantKey(variant)}/${passIndex}/${ridKey(material.rid)}`;
    return Object.freeze({
      key,
      material: material.rid,
      sourceMaterial: root.rid,
      shader: material.shader,
      pass: variant.pass,
      passIndex,
      framebufferFormat: variant.framebufferFormat,
      vertexFormat: variant.vertexFormat,
      sampleCount: variant.sampleCount ?? 1,
      viewCount: variant.viewCount ?? 1,
      instanceFormat: variant.instanceFormat ?? 0,
      priority: root.priority + material.priority,
      transparent,
      blendMode: transparent ? material.blendMode : GODOT_MATERIAL_BLEND_MODE.MIX,
      cullMode,
      depthDrawMode: material.depthDrawMode,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite && !transparent,
      alphaToCoverage: material.alphaToCoverage,
      wireframe: material.wireframe,
      castsShadow: material.castsShadow,
      receivesShadow: material.receivesShadow,
      usesScreenTexture: material.usesScreenTexture,
      usesDepthTexture: material.usesDepthTexture,
      usesNormalTexture: material.usesNormalTexture,
      vertexDisplacement: material.vertexDisplacement,
      instanceUniforms: Object.freeze([...material.instanceUniforms]),
      textureBindings: Object.freeze({ ...material.textureBindings }),
      parameters: Object.freeze({ ...material.parameters }),
      defines,
      revision: material.revision,
    });
  }

  private chain(root: MutableMaterial, pass: GodotMaterialRenderPass): MutableMaterial[] {
    const values: MutableMaterial[] = [];
    const visited = new Set<GodotMaterialPassRid>();
    let material: MutableMaterial | undefined = root;
    if (pass === GODOT_MATERIAL_RENDER_PASS.SHADOW && root.shadowPass !== null) {
      material = this.materials.get(root.shadowPass);
      if (material === undefined) throw new Error(`godot-compat: missing shadow material ${ridKey(root.shadowPass)}.`);
    }
    while (material !== undefined) {
      if (visited.has(material.rid)) throw new Error(`godot-compat: material pass cycle at ${ridKey(material.rid)}.`);
      visited.add(material.rid);
      values.push(material);
      if (pass === GODOT_MATERIAL_RENDER_PASS.SHADOW) break;
      if (material.nextPass === null) break;
      material = this.materials.get(material.nextPass);
      if (material === undefined) throw new Error(`godot-compat: missing next-pass material ${ridKey(values.at(-1)!.nextPass)}.`);
    }
    return values;
  }

  private validateVariant(variant: GodotMaterialPassVariant): void {
    if (!Object.values(GODOT_MATERIAL_RENDER_PASS).includes(variant.pass)) {
      throw new RangeError(`godot-compat: unknown material render pass ${String(variant.pass)}.`);
    }
    integer(variant.sampleCount ?? 1, 'material sample count', 1, 64);
    integer(variant.viewCount ?? 1, 'material view count', 1, 32);
    integer(variant.instanceFormat ?? 0, 'material instance format', 0, 0x7fff_ffff);
  }

  private require(rid: GodotMaterialPassRid): MutableMaterial {
    const value = this.materials.get(rid);
    if (value === undefined) throw new Error(`godot-compat: unknown material ${ridKey(rid)}.`);
    return value;
  }

  private link(material: MutableMaterial): void {
    this.addDependant(material.nextPass, material.rid);
    this.addDependant(material.shadowPass, material.rid);
  }

  private unlink(material: MutableMaterial): void {
    this.dependants.get(material.nextPass!)?.delete(material.rid);
    this.dependants.get(material.shadowPass!)?.delete(material.rid);
  }

  private addDependant(dependency: GodotMaterialPassRid | null, dependant: GodotMaterialPassRid): void {
    if (dependency === null) return;
    let values = this.dependants.get(dependency);
    if (values === undefined) {
      values = new Set();
      this.dependants.set(dependency, values);
    }
    values.add(dependant);
  }
}

export function createGodotMaterialPassCompilerRuntime<THandle = unknown>(
  backend?: GodotMaterialPassBackend<THandle>,
): GodotMaterialPassCompilerRuntime<THandle> {
  return new GodotMaterialPassCompilerRuntime(backend);
}
