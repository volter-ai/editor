/** Godot 2D drawable families on retained Pixi Mesh/Graphics/Sprite primitives. */

import {
  BufferImageSource,
  Container,
  FillGradient,
  Graphics,
  GlProgram,
  GpuProgram,
  Mesh,
  MeshGeometry,
  Matrix,
  NineSliceSprite,
  Rectangle,
  Shader,
  Sprite,
  Texture,
  TilingSprite,
  UniformGroup,
  earcut,
} from 'pixi.js';
import type { ColorValue } from './variant';
import type { GodotConnection } from './signal';
import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';
import {
  getTextureRectExpand,
  getTextureRectExpandMode,
  setTextureRectExpand,
  setTextureRectExpandMode,
} from './control-layout-runtime';
import {
  getBone2DIndex,
  getSkeleton2DBoneCount,
  isGodotSkeleton2D,
  resolveSkeleton2DBone,
  skeleton2DFinalTransforms,
  skeleton2DBoneSetupChanged,
  type GodotSkeleton2D,
} from './skeleton-2d';

export interface DrawPoint { x: number; y: number }

function colorNumber(color: ColorValue): number {
  const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));
  return (byte(color.r) << 16) | (byte(color.g) << 8) | byte(color.b);
}

function colorRgba(color: ColorValue): string {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));
  const alpha = Math.max(0, Math.min(1, color.a));
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}

export interface Polygon2DOptions {
  readonly points: readonly DrawPoint[];
  readonly uvs?: readonly DrawPoint[];
  readonly indices?: readonly number[];
  readonly texture?: Texture;
  readonly color?: ColorValue;
  readonly vertexColors?: readonly ColorValue[];
  readonly invert?: boolean;
  readonly bones?: readonly Polygon2DBoneWeight[];
  readonly antialiased?: boolean;
  readonly offset?: DrawPoint;
}
export interface Polygon2DBoneWeight {
  readonly path: string;
  readonly weights: readonly number[];
}
export interface Polygon2DApi {
  polygon: DrawPoint[];
  uv: DrawPoint[];
  polygons: number[];
  color: ColorValue;
  texture: Texture;
  offset: DrawPoint;
  skeleton: string;
  set_polygon(value: DrawPoint[]): void;
  get_polygon(): DrawPoint[];
  set_uv(value: DrawPoint[]): void;
  get_uv(): DrawPoint[];
  set_polygons(value: number[]): void;
  get_polygons(): number[];
  set_color(value: ColorValue): void;
  get_color(): ColorValue;
  set_texture(value: Texture): void;
  get_texture(): Texture;
  set_offset(value: DrawPoint): void;
  get_offset(): DrawPoint;
  set_skeleton(value: string): void;
  get_skeleton(): string;
  clear_bones(): void;
  add_bone(path: string, weights: readonly number[]): void;
  get_bone_count(): number;
  get_bone_path(index: number): string;
  get_bone_weights(index: number): number[];
  set_bone_path(index: number, path: string): void;
  set_bone_weights(index: number, weights: readonly number[]): void;
  erase_bone(index: number): void;
}
export type GodotPolygon2D = Mesh<MeshGeometry> & Polygon2DApi;
const RELEASED_POLYGONS = new WeakSet<GodotPolygon2D>();

interface PolygonSkinState {
  points: DrawPoint[];
  bones: Polygon2DBoneWeight[];
  skeleton: GodotSkeleton2D | undefined;
  skeletonPath: string;
  shader: Shader | undefined;
  uniforms: UniformGroup | undefined;
  paletteSource: BufferImageSource | undefined;
  paletteTexture: Texture | undefined;
  setupConnection: GodotConnection | undefined;
  pendingPathAdded: (() => void) | undefined;
  readonly originalShader: GodotPolygon2D['shader'];
  readonly previousOnRender: GodotPolygon2D['onRender'];
}
const POLYGON_SKINS = new WeakMap<GodotPolygon2D, PolygonSkinState>();

function polygonGeometry(points: readonly DrawPoint[], uvs: readonly DrawPoint[], indices?: readonly number[]): MeshGeometry {
  if (uvs.length !== 0 && uvs.length !== points.length) {
    throw new Error(`Polygon2D has ${points.length} vertices but ${uvs.length} UVs.`);
  }
  const positions = new Float32Array(points.flatMap((point) => [point.x, point.y]));
  const textureUvs = new Float32Array((uvs.length === 0 ? points.map(() => ({ x: 0, y: 0 })) : uvs)
    .flatMap((point) => [point.x, point.y]));
  if (points.length < 3 && (indices === undefined || indices.length === 0)) {
    return new MeshGeometry({ positions, uvs: textureUvs, indices: new Uint32Array() });
  }
  const triangles = indices === undefined || indices.length === 0
    ? earcut([...positions], undefined, 2)
    : [...indices];
  if (triangles.length % 3 !== 0 || triangles.some((index) => index < 0 || index >= points.length)) {
    throw new Error('Polygon2D.polygons must be valid triangle indices into polygon.');
  }
  return new MeshGeometry({ positions, uvs: textureUvs, indices: new Uint32Array(triangles) });
}

export function createGodotPolygon2D(): GodotPolygon2D {
  const polygon = bindGodotCanvasNode2DApi(createPolygon2D({ points: [] })) as GodotPolygon2D;
  registerGodotObjectIdentity(polygon, 'Polygon2D');
  registerCanvasNodeRelease(polygon, () => releasePolygon2D(polygon));
  return polygon;
}

export function createPolygon2D(options: Polygon2DOptions): GodotPolygon2D {
  if (options.invert === true) throw new Error('Polygon2D.invert is unsupported; Pixi Mesh has no inverted-fill mode.');
  if ((options.vertexColors?.length ?? 0) > 0) throw new Error('Polygon2D.vertex_colors is unsupported by Pixi Mesh default texture shader.');
  if (options.antialiased === true) throw new Error('Polygon2D.antialiased is unsupported; Pixi Mesh does not expose per-polygon antialiasing.');
  let points = options.points.map((point) => ({ ...point }));
  let uvs = (options.uvs ?? []).map((point) => ({ ...point }));
  let indices = [...(options.indices ?? [])];
  let color = options.color ?? { r: 1, g: 1, b: 1, a: 1 };
  let polygonOffset = { ...(options.offset ?? { x: 0, y: 0 }) };
  if (![polygonOffset.x, polygonOffset.y].every(Number.isFinite)) {
    throw new TypeError('Polygon2D.offset requires a finite Vector2.');
  }
  const texture = options.texture ?? Texture.WHITE;
  const renderedPoints = (): DrawPoint[] => points.map((point) => ({
    x: point.x + polygonOffset.x,
    y: point.y + polygonOffset.y,
  }));
  const polygon = new Mesh({ geometry: polygonGeometry(renderedPoints(), uvs, indices), texture }) as GodotPolygon2D;
  const skin: PolygonSkinState = {
    points,
    bones: (options.bones ?? []).map((bone) => ({ path: bone.path, weights: [...bone.weights] })),
    skeleton: undefined,
    skeletonPath: '',
    shader: undefined,
    uniforms: undefined,
    paletteSource: undefined,
    paletteTexture: undefined,
    setupConnection: undefined,
    pendingPathAdded: undefined,
    originalShader: polygon.shader,
    previousOnRender: polygon.onRender,
  };
  POLYGON_SKINS.set(polygon, skin);
  const nativeTexture = descriptorOf(polygon, 'texture');
  const rebuild = (): void => {
    const previous = polygon.geometry;
    polygon.geometry = polygonGeometry(renderedPoints(), uvs, indices);
    skin.points = points;
    previous.destroy();
    if (skin.skeleton !== undefined) installPolygonSkinShader(polygon, skin, skin.skeleton);
  };
  Object.defineProperties(polygon, {
    texture: {
      configurable: true,
      enumerable: true,
      get: () => nativeTexture.get?.call(polygon),
      set: (value: Texture) => {
        const previous = nativeTexture.get?.call(polygon) as Texture;
        if (previous === value) return;
        releaseGradientTexture2D(previous);
        nativeTexture.set?.call(polygon, value);
        if (skin.shader !== undefined) {
          skin.shader.resources['uTexture'] = value.source;
          skin.shader.resources['uSampler'] = value.source.style;
          if (skin.uniforms !== undefined) {
            skin.uniforms.uniforms['uTextureMatrix'] = value.textureMatrix.mapCoord;
            skin.uniforms.update();
          }
        }
      },
    },
    polygon: { configurable: true, enumerable: true, get: () => points.map((point) => ({ ...point })), set: (value: DrawPoint[]) => { points = value.map((point) => ({ ...point })); rebuild(); } },
    uv: { configurable: true, enumerable: true, get: () => uvs.map((point) => ({ ...point })), set: (value: DrawPoint[]) => { uvs = value.map((point) => ({ ...point })); rebuild(); } },
    polygons: { configurable: true, enumerable: true, get: () => [...indices], set: (value: number[]) => { indices = [...value]; rebuild(); } },
    color: { configurable: true, enumerable: true, get: () => ({ ...color }), set: (value: ColorValue) => { color = { ...value }; polygon.tint = colorNumber(value); polygon.alpha = value.a; } },
    offset: {
      configurable: true,
      enumerable: true,
      get: () => ({ ...polygonOffset }),
      set: (value: DrawPoint) => {
        if (typeof value !== 'object' || value === null || ![value.x, value.y].every(Number.isFinite)) {
          throw new TypeError('Polygon2D.offset requires a finite Vector2.');
        }
        polygonOffset = { x: value.x, y: value.y };
        rebuild();
      },
    },
    skeleton: {
      configurable: true,
      enumerable: true,
      get: () => getPolygon2DSkeletonPath(polygon),
      set: (value: string) => setPolygon2DSkeletonPath(polygon, value),
    },
  });
  Object.assign(polygon, {
    set_polygon: (value: DrawPoint[]): void => { polygon.polygon = value; },
    get_polygon: (): DrawPoint[] => polygon.polygon,
    set_uv: (value: DrawPoint[]): void => { polygon.uv = value; },
    get_uv: (): DrawPoint[] => polygon.uv,
    set_polygons: (value: number[]): void => { polygon.polygons = value; },
    get_polygons: (): number[] => polygon.polygons,
    set_color: (value: ColorValue): void => { polygon.color = value; },
    get_color: (): ColorValue => ({ ...polygon.color }),
    set_texture: (value: Texture): void => { polygon.texture = value; },
    get_texture: (): Texture => polygon.texture,
    set_offset: (value: DrawPoint): void => { polygon.offset = value; },
    get_offset: (): DrawPoint => ({ ...polygon.offset }),
    set_skeleton: (value: string): void => setPolygon2DSkeletonPath(polygon, value),
    get_skeleton: (): string => getPolygon2DSkeletonPath(polygon),
    clear_bones: (): void => clearPolygon2DBones(polygon),
    add_bone: (path: string, weights: readonly number[]): void => addPolygon2DBone(polygon, path, weights),
    get_bone_count: (): number => getPolygon2DBoneCount(polygon),
    get_bone_path: (index: number): string => getPolygon2DBonePath(polygon, index),
    get_bone_weights: (index: number): number[] => getPolygon2DBoneWeights(polygon, index),
    set_bone_path: (index: number, path: string): void => setPolygon2DBonePath(polygon, index, path),
    set_bone_weights: (index: number, weights: readonly number[]): void => setPolygon2DBoneWeights(polygon, index, weights),
    erase_bone: (index: number): void => erasePolygon2DBone(polygon, index),
  });
  polygon.color = color;
  return polygon;
}

export function releasePolygon2D(polygon: GodotPolygon2D): void {
  if (RELEASED_POLYGONS.has(polygon)) return;
  RELEASED_POLYGONS.add(polygon);
  polygon.geometry.destroy();
  releaseGradientTexture2D(polygon.texture);
  const skin = POLYGON_SKINS.get(polygon);
  if (skin !== undefined) {
    polygon.onRender = skin.previousOnRender;
    polygon.shader = skin.originalShader;
    skin.shader?.destroy(false);
    skin.paletteTexture?.destroy(true);
    skin.setupConnection?.disconnect();
    if (skin.pendingPathAdded !== undefined) polygon.off('added', skin.pendingPathAdded);
  }
  POLYGON_SKINS.delete(polygon);
}

interface Matrix2DValue { a: number; b: number; c: number; d: number; tx: number; ty: number }

function matrixValue(matrix: Matrix): Matrix2DValue {
  return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.tx, ty: matrix.ty };
}

function matrixMultiply(a: Matrix2DValue, b: Matrix2DValue): Matrix2DValue {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

function matrixInverse(value: Matrix2DValue): Matrix2DValue {
  const determinant = value.a * value.d - value.b * value.c;
  if (determinant === 0) throw new Error('Polygon2D skinning cannot invert its zero-determinant global transform.');
  const inverse = 1 / determinant;
  return {
    a: value.d * inverse,
    b: -value.b * inverse,
    c: -value.c * inverse,
    d: value.a * inverse,
    tx: (value.c * value.ty - value.d * value.tx) * inverse,
    ty: (value.b * value.tx - value.a * value.ty) * inverse,
  };
}

const POLYGON_SKIN_PALETTE_WIDTH = 256;

const POLYGON_SKIN_VERTEX = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aBoneIndices;
in vec4 aBoneWeights;
out vec2 vUV;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform skinUniforms {
  mat3 uSkeletonToPolygon;
  mat3 uTextureMatrix;
  float uPaletteWidth;
};
uniform sampler2D uBonePalette;
mat3 bone_matrix(int index) {
  int first = index * 2;
  ivec2 p0 = ivec2(first % int(uPaletteWidth), first / int(uPaletteWidth));
  ivec2 p1 = ivec2((first + 1) % int(uPaletteWidth), (first + 1) / int(uPaletteWidth));
  vec4 basis = texelFetch(uBonePalette, p0, 0);
  vec4 origin = texelFetch(uBonePalette, p1, 0);
  return mat3(basis.x, basis.y, 0.0, basis.z, basis.w, 0.0, origin.x, origin.y, 1.0);
}
void main(void) {
  vec3 source = vec3(aPosition, 1.0);
  vec3 skinned = source;
  float total = aBoneWeights.x + aBoneWeights.y + aBoneWeights.z + aBoneWeights.w;
  if (total > 0.0) {
    skinned = vec3(0.0);
    skinned += (uSkeletonToPolygon * bone_matrix(int(aBoneIndices.x)) * source) * aBoneWeights.x;
    skinned += (uSkeletonToPolygon * bone_matrix(int(aBoneIndices.y)) * source) * aBoneWeights.y;
    skinned += (uSkeletonToPolygon * bone_matrix(int(aBoneIndices.z)) * source) * aBoneWeights.z;
    skinned += (uSkeletonToPolygon * bone_matrix(int(aBoneIndices.w)) * source) * aBoneWeights.w;
    skinned /= total;
  }
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(skinned.xy, 1.0)).xy, 0.0, 1.0);
  vUV = (uTextureMatrix * vec3(aUV, 1.0)).xy;
  vColor = uWorldColorAlpha;
}`;

const POLYGON_SKIN_FRAGMENT = `
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
void main(void) {
  finalColor = texture(uTexture, vUV) * vColor;
}`;

const POLYGON_SKIN_WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
struct SkinUniforms {
  uSkeletonToPolygon: mat3x3<f32>,
  uTextureMatrix: mat3x3<f32>,
  uPaletteWidth: f32,
};
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> skinUniforms: SkinUniforms;
@group(1) @binding(1) var uTexture: texture_2d<f32>;
@group(1) @binding(2) var uSampler: sampler;
@group(1) @binding(3) var uBonePalette: texture_2d<f32>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};
@vertex fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aBoneIndices: vec4<f32>,
  @location(3) aBoneWeights: vec4<f32>,
) -> VertexOutput {
  let source = vec3<f32>(aPosition, 1.0);
  let total = dot(aBoneWeights, vec4<f32>(1.0));
  var skinned = source;
  if (total > 0.0) {
    let paletteWidth = u32(skinUniforms.uPaletteWidth);
    let i0 = u32(aBoneIndices.x) * 2u;
    let i1 = u32(aBoneIndices.y) * 2u;
    let i2 = u32(aBoneIndices.z) * 2u;
    let i3 = u32(aBoneIndices.w) * 2u;
    let b00 = textureLoad(uBonePalette, vec2<i32>(i32(i0 % paletteWidth), i32(i0 / paletteWidth)), 0);
    let b01 = textureLoad(uBonePalette, vec2<i32>(i32((i0 + 1u) % paletteWidth), i32((i0 + 1u) / paletteWidth)), 0);
    let b10 = textureLoad(uBonePalette, vec2<i32>(i32(i1 % paletteWidth), i32(i1 / paletteWidth)), 0);
    let b11 = textureLoad(uBonePalette, vec2<i32>(i32((i1 + 1u) % paletteWidth), i32((i1 + 1u) / paletteWidth)), 0);
    let b20 = textureLoad(uBonePalette, vec2<i32>(i32(i2 % paletteWidth), i32(i2 / paletteWidth)), 0);
    let b21 = textureLoad(uBonePalette, vec2<i32>(i32((i2 + 1u) % paletteWidth), i32((i2 + 1u) / paletteWidth)), 0);
    let b30 = textureLoad(uBonePalette, vec2<i32>(i32(i3 % paletteWidth), i32(i3 / paletteWidth)), 0);
    let b31 = textureLoad(uBonePalette, vec2<i32>(i32((i3 + 1u) % paletteWidth), i32((i3 + 1u) / paletteWidth)), 0);
    let bone0 = mat3x3<f32>(b00.x, b00.y, 0.0, b00.z, b00.w, 0.0, b01.x, b01.y, 1.0);
    let bone1 = mat3x3<f32>(b10.x, b10.y, 0.0, b10.z, b10.w, 0.0, b11.x, b11.y, 1.0);
    let bone2 = mat3x3<f32>(b20.x, b20.y, 0.0, b20.z, b20.w, 0.0, b21.x, b21.y, 1.0);
    let bone3 = mat3x3<f32>(b30.x, b30.y, 0.0, b30.z, b30.w, 0.0, b31.x, b31.y, 1.0);
    skinned =
      (skinUniforms.uSkeletonToPolygon * bone0 * source) * aBoneWeights.x +
      (skinUniforms.uSkeletonToPolygon * bone1 * source) * aBoneWeights.y +
      (skinUniforms.uSkeletonToPolygon * bone2 * source) * aBoneWeights.z +
      (skinUniforms.uSkeletonToPolygon * bone3 * source) * aBoneWeights.w;
    skinned /= total;
  }
  let projected = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * vec3<f32>(skinned.xy, 1.0);
  let uv = (skinUniforms.uTextureMatrix * vec3<f32>(aUV, 1.0)).xy;
  return VertexOutput(vec4<f32>(projected.xy, 0.0, 1.0), uv, globalUniforms.uWorldColorAlpha);
}
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, input.uv) * input.color;
}`;

function matrixArray(value: Matrix2DValue): Float32Array {
  return new Float32Array([value.a, value.b, 0, value.c, value.d, 0, value.tx, value.ty, 1]);
}

function updatePolygonSkinPalette(polygon: GodotPolygon2D, state: PolygonSkinState): void {
  const skeleton = state.skeleton;
  if (skeleton === undefined) return;
  const finalTransforms = skeleton2DFinalTransforms(skeleton);
  const uniforms = state.uniforms;
  if (uniforms === undefined) return;
  const skeletonToPolygon = matrixMultiply(matrixInverse(matrixValue(polygon.worldTransform)), matrixValue(skeleton.worldTransform));
  const paletteSource = state.paletteSource;
  if (paletteSource === undefined) return;
  const palette = paletteSource.resource as unknown as Float32Array;
  palette.fill(0);
  for (let index = 0; index < finalTransforms.length; index += 1) {
    const transform = finalTransforms[index];
    if (transform === undefined) continue;
    palette.set([
      transform.x.x, transform.x.y, transform.y.x, transform.y.y,
      transform.origin.x, transform.origin.y, 0, 0,
    ], index * 8);
  }
  uniforms.uniforms['uSkeletonToPolygon'] = matrixArray(skeletonToPolygon);
  uniforms.update();
  paletteSource.update();
}

function buildPolygonSkinAttributes(state: PolygonSkinState, geometry: MeshGeometry, skeleton: GodotSkeleton2D): void {
  const influences = state.points.map(() => [] as Array<{ bone: number; weight: number }>);
  for (const authored of state.bones) {
    if (authored.weights.length !== state.points.length) continue;
    const bone = resolveSkeleton2DBone(skeleton, authored.path);
    if (bone === undefined) continue;
    const index = getBone2DIndex(bone);
    if (index < 0) continue;
    for (let vertex = 0; vertex < authored.weights.length; vertex += 1) {
      const weight = authored.weights[vertex] as number;
      if (!Number.isFinite(weight)) throw new TypeError(`Polygon2D bone ${authored.path} weight ${vertex} is not finite.`);
      if (weight <= 0) continue;
      const list = influences[vertex] as Array<{ bone: number; weight: number }>;
      list.push({ bone: index, weight });
      list.sort((a, b) => b.weight - a.weight);
      if (list.length > 4) list.length = 4;
    }
  }
  const indices = new Float32Array(state.points.length * 4);
  const weights = new Float32Array(state.points.length * 4);
  for (let vertex = 0; vertex < state.points.length; vertex += 1) {
    const list = influences[vertex] as Array<{ bone: number; weight: number }>;
    const total = list.reduce((sum, item) => sum + item.weight, 0);
    if (total > 0) {
      for (let slot = 0; slot < list.length; slot += 1) {
        const influence = list[slot] as { bone: number; weight: number };
        indices[vertex * 4 + slot] = influence.bone;
        weights[vertex * 4 + slot] = influence.weight / total;
      }
    }
  }
  geometry.addAttribute('aBoneIndices', { buffer: indices, format: 'float32x4', stride: 16, offset: 0 });
  geometry.addAttribute('aBoneWeights', { buffer: weights, format: 'float32x4', stride: 16, offset: 0 });
}

function installPolygonSkinShader(polygon: GodotPolygon2D, state: PolygonSkinState, skeleton: GodotSkeleton2D): void {
  const boneCount = Math.max(1, getSkeleton2DBoneCount(skeleton));
  buildPolygonSkinAttributes(state, polygon.geometry, skeleton);
  const paletteHeight = Math.max(1, Math.ceil((boneCount * 2) / POLYGON_SKIN_PALETTE_WIDTH));
  const paletteSource = new BufferImageSource({
    resource: new Float32Array(POLYGON_SKIN_PALETTE_WIDTH * paletteHeight * 4),
    width: POLYGON_SKIN_PALETTE_WIDTH,
    height: paletteHeight,
    format: 'rgba32float',
    alphaMode: 'no-premultiply-alpha',
  });
  const paletteTexture = new Texture({ source: paletteSource });
  const uniforms = new UniformGroup({
    uSkeletonToPolygon: { value: matrixArray({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }), type: 'mat3x3<f32>' },
    uTextureMatrix: { value: polygon.texture.textureMatrix.mapCoord, type: 'mat3x3<f32>' },
    uPaletteWidth: { value: POLYGON_SKIN_PALETTE_WIDTH, type: 'f32' },
  }, { ubo: true, isStatic: true });
  const shader = new Shader({
    glProgram: GlProgram.from({ vertex: POLYGON_SKIN_VERTEX, fragment: POLYGON_SKIN_FRAGMENT, name: 'godot-polygon-2d-skin' }),
    gpuProgram: GpuProgram.from({
      vertex: { source: POLYGON_SKIN_WGSL, entryPoint: 'mainVertex' },
      fragment: { source: POLYGON_SKIN_WGSL, entryPoint: 'mainFragment' },
      name: 'godot-polygon-2d-skin',
    }),
    resources: {
      skinUniforms: uniforms,
      uTexture: polygon.texture.source,
      uSampler: polygon.texture.source.style,
      uBonePalette: paletteTexture.source,
    },
  });
  // CanvasItemMaterial remains native Pixi blend state and ShaderMaterial remains the node's
  // retained filter, so replacing only Mesh's vertex program composes skinning before either
  // authored material path instead of discarding it.
  state.shader?.destroy(false);
  state.paletteTexture?.destroy(true);
  state.uniforms = uniforms;
  state.paletteSource = paletteSource;
  state.paletteTexture = paletteTexture;
  state.shader = shader;
  polygon.shader = shader as unknown as typeof polygon.shader;
}

export function bindPolygon2DSkeleton(
  polygon: GodotPolygon2D,
  skeleton: GodotSkeleton2D | null,
  path = '',
): void {
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined) throw new Error('bindPolygon2DSkeleton requires a retained Polygon2D.');
  state.skeleton = skeleton ?? undefined;
  state.skeletonPath = path;
  state.setupConnection?.disconnect();
  state.setupConnection = undefined;
  if (state.pendingPathAdded !== undefined) {
    polygon.off('added', state.pendingPathAdded);
    state.pendingPathAdded = undefined;
  }
  if (skeleton === null) {
    polygon.shader = state.originalShader;
    state.shader?.destroy(false);
    state.shader = undefined;
    state.uniforms = undefined;
    state.paletteTexture?.destroy(true);
    state.paletteTexture = undefined;
    state.paletteSource = undefined;
    polygon.onRender = state.previousOnRender;
    return;
  }
  installPolygonSkinShader(polygon, state, skeleton);
  state.setupConnection = skeleton2DBoneSetupChanged(skeleton).connect(() => {
    installPolygonSkinShader(polygon, state, skeleton);
  });
  polygon.onRender = (renderer) => {
    state.previousOnRender?.call(polygon, renderer);
    updatePolygonSkinPalette(polygon, state);
  };
}

function resolvePolygonSkeletonPath(polygon: GodotPolygon2D, path: string): GodotSkeleton2D | undefined {
  if (path === '' || path.startsWith('/')) return undefined;
  let current: Container | null = polygon;
  for (const part of path.replace(/^\.\//, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { current = current?.parent ?? null; continue; }
    current = current?.children.find((child) => child instanceof Container && child.name === part) as Container | undefined ?? null;
  }
  return isGodotSkeleton2D(current) ? current : undefined;
}

export function setPolygon2DSkeletonPath(polygon: GodotPolygon2D, path: string): void {
  if (typeof path !== 'string') throw new TypeError('Polygon2D.skeleton requires NodePath/String.');
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined) throw new Error('Polygon2D.skeleton requires a retained Polygon2D.');
  const skeleton = resolvePolygonSkeletonPath(polygon, path);
  if (skeleton === undefined && polygon.parent === null && path !== '') {
    state.skeletonPath = path;
    const attach = (): void => {
      state.pendingPathAdded = undefined;
      setPolygon2DSkeletonPath(polygon, path);
    };
    state.pendingPathAdded = attach;
    polygon.once('added', attach);
    return;
  }
  if (skeleton === undefined && path !== '') {
    throw new Error(`Polygon2D.skeleton NodePath ${path} does not resolve to a retained Skeleton2D.`);
  }
  bindPolygon2DSkeleton(polygon, skeleton ?? null, path);
}

export function getPolygon2DSkeletonPath(polygon: GodotPolygon2D): string {
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined) throw new Error('Polygon2D.skeleton requires a retained Polygon2D.');
  return state.skeletonPath;
}

export function clearPolygon2DBones(polygon: GodotPolygon2D): void {
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined) throw new Error('Polygon2D.clear_bones requires a retained Polygon2D.');
  state.bones = [];
  if (state.skeleton !== undefined) installPolygonSkinShader(polygon, state, state.skeleton);
}

export function addPolygon2DBone(polygon: GodotPolygon2D, path: string, weights: readonly number[]): void {
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined) throw new Error('Polygon2D.add_bone requires a retained Polygon2D.');
  if (typeof path !== 'string') throw new TypeError('Polygon2D.add_bone path requires NodePath/String.');
  if (weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight))) throw new TypeError('Polygon2D.add_bone weights require finite floats.');
  state.bones.push({ path, weights: [...weights] });
  if (state.skeleton !== undefined) installPolygonSkinShader(polygon, state, state.skeleton);
}

export function getPolygon2DBoneCount(polygon: GodotPolygon2D): number {
  return POLYGON_SKINS.get(polygon)?.bones.length ?? 0;
}

export function getPolygon2DBonePath(polygon: GodotPolygon2D, index: number): string {
  if (!Number.isSafeInteger(index)) throw new TypeError('Polygon2D.get_bone_path index requires int.');
  const bone = POLYGON_SKINS.get(polygon)?.bones[index];
  if (bone === undefined) throw new RangeError(`Polygon2D bone index ${index} is out of range.`);
  return bone.path;
}

export function getPolygon2DBoneWeights(polygon: GodotPolygon2D, index: number): number[] {
  if (!Number.isSafeInteger(index)) throw new TypeError('Polygon2D.get_bone_weights index requires int.');
  const bone = POLYGON_SKINS.get(polygon)?.bones[index];
  if (bone === undefined) throw new RangeError(`Polygon2D bone index ${index} is out of range.`);
  return [...bone.weights];
}

export function setPolygon2DBonePath(polygon: GodotPolygon2D, index: number, path: string): void {
  if (!Number.isSafeInteger(index)) throw new TypeError('Polygon2D.set_bone_path index requires int.');
  if (typeof path !== 'string') throw new TypeError('Polygon2D.set_bone_path path requires NodePath/String.');
  const state = POLYGON_SKINS.get(polygon);
  const bone = state?.bones[index];
  if (state === undefined || bone === undefined) throw new RangeError(`Polygon2D bone index ${index} is out of range.`);
  state.bones[index] = { path, weights: bone.weights };
  if (state.skeleton !== undefined) installPolygonSkinShader(polygon, state, state.skeleton);
}

export function setPolygon2DBoneWeights(polygon: GodotPolygon2D, index: number, weights: readonly number[]): void {
  if (!Number.isSafeInteger(index)) throw new TypeError('Polygon2D.set_bone_weights index requires int.');
  if (!Array.isArray(weights) || weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight))) {
    throw new TypeError('Polygon2D.set_bone_weights weights require a finite PackedFloat32Array.');
  }
  const state = POLYGON_SKINS.get(polygon);
  const bone = state?.bones[index];
  if (state === undefined || bone === undefined) throw new RangeError(`Polygon2D bone index ${index} is out of range.`);
  state.bones[index] = { path: bone.path, weights: [...weights] };
  if (state.skeleton !== undefined) installPolygonSkinShader(polygon, state, state.skeleton);
}

export function erasePolygon2DBone(polygon: GodotPolygon2D, index: number): void {
  if (!Number.isSafeInteger(index)) throw new TypeError('Polygon2D.erase_bone index requires int.');
  const state = POLYGON_SKINS.get(polygon);
  if (state === undefined || index < 0 || index >= state.bones.length) throw new RangeError(`Polygon2D bone index ${index} is out of range.`);
  state.bones.splice(index, 1);
  if (state.skeleton !== undefined) installPolygonSkinShader(polygon, state, state.skeleton);
}

export interface Line2DOptions {
  readonly points: readonly DrawPoint[];
  readonly width?: number;
  readonly color?: ColorValue;
  readonly closed?: boolean;
  readonly jointMode?: number;
  readonly beginCapMode?: number;
  readonly endCapMode?: number;
  readonly textureMode?: number;
  readonly gradient?: boolean;
  readonly antialiased?: boolean;
  readonly roundPrecision?: number;
  readonly sharpLimit?: number;
}
export interface Line2DApi {
  points: DrawPoint[];
  width: number;
  default_color: ColorValue;
  closed: boolean;
  joint_mode: number;
  begin_cap_mode: number;
  end_cap_mode: number;
  texture_mode: number;
  antialiased: boolean;
  round_precision: number;
  sharp_limit: number;
  set_points(points: DrawPoint[]): void;
  get_points(): DrawPoint[];
  set_width(width: number): void;
  get_width(): number;
  set_default_color(color: ColorValue): void;
  get_default_color(): ColorValue;
  set_closed(closed: boolean): void;
  is_closed(): boolean;
  set_joint_mode(mode: number): void;
  get_joint_mode(): number;
  set_begin_cap_mode(mode: number): void;
  get_begin_cap_mode(): number;
  set_end_cap_mode(mode: number): void;
  get_end_cap_mode(): number;
  set_texture_mode(mode: number): void;
  get_texture_mode(): number;
  set_antialiased(enabled: boolean): void;
  get_antialiased(): boolean;
  add_point(position: DrawPoint, index?: number): void;
  remove_point(index: number): void;
  clear_points(): void;
  get_point_count(): number;
  get_point_position(index: number): DrawPoint;
  set_point_position(index: number, position: DrawPoint): void;
}
export type GodotLine2D = Graphics & Line2DApi;

function linePoint(value: DrawPoint, member: string): DrawPoint {
  if (
    typeof value !== 'object' || value === null ||
    typeof value.x !== 'number' || !Number.isFinite(value.x) ||
    typeof value.y !== 'number' || !Number.isFinite(value.y)
  ) {
    throw new TypeError(`Line2D.${member} requires a finite Vector2.`);
  }
  return { x: value.x, y: value.y };
}

function linePointIndex(value: number, length: number, member: string, allowEnd = false): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Line2D.${member} index requires an int.`);
  const upper = allowEnd ? length : length - 1;
  if (value < 0 || value > upper) {
    throw new RangeError(`Line2D.${member} index ${String(value)} is outside 0..${String(upper)}.`);
  }
  return value;
}

function lineEnum(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`Line2D.${member} must be 0, 1, or 2.`);
  }
  return value;
}

export function createLine2D(options: Line2DOptions): GodotLine2D {
  if ((options.textureMode ?? 0) !== 0) throw new Error('Line2D.texture_mode requires textured line UVs and is unsupported.');
  if (options.gradient === true) throw new Error('Line2D.gradient is unsupported by Pixi Graphics stroke interpolation.');
  if (options.antialiased === true) throw new Error('Line2D.antialiased is unsupported; Pixi Graphics owns renderer antialiasing globally.');
  if ((options.beginCapMode ?? 0) !== (options.endCapMode ?? 0)) throw new Error('Line2D different begin/end cap modes cannot be represented by one native Pixi stroke.');
  if (options.roundPrecision !== undefined && options.roundPrecision !== 8) throw new Error('Line2D.round_precision has no native Pixi Graphics equivalent.');
  if (options.sharpLimit !== undefined && options.sharpLimit !== 2) throw new Error('Line2D.sharp_limit has no native Pixi Graphics equivalent.');
  let points = options.points.map((point) => linePoint(point, 'points'));
  let width = options.width ?? 10;
  let color = options.color ?? { r: 1, g: 1, b: 1, a: 1 };
  let closed = options.closed ?? false;
  let jointMode = lineEnum(options.jointMode ?? 0, 'joint_mode');
  let beginCapMode = lineEnum(options.beginCapMode ?? 0, 'begin_cap_mode');
  let endCapMode = lineEnum(options.endCapMode ?? 0, 'end_cap_mode');
  let textureMode = options.textureMode ?? 0;
  let antialiased = options.antialiased ?? false;
  let roundPrecision = options.roundPrecision ?? 8;
  let sharpLimit = options.sharpLimit ?? 2;
  if (!Number.isFinite(width) || width < 0) throw new RangeError('Line2D.width must be finite and non-negative.');
  const line = new Graphics() as GodotLine2D;
  const joins = ['miter', 'round', 'bevel'] as const;
  const caps = ['butt', 'square', 'round'] as const;
  const rebuild = (): void => {
    line.clear();
    if (points.length < 2) return;
    line.poly(points.flatMap((point) => [point.x, point.y]), closed).stroke({
      width,
      color: colorNumber(color),
      alpha: color.a,
      join: joins[jointMode] ?? 'miter',
      cap: caps[beginCapMode] ?? 'butt',
    });
  };
  Object.defineProperties(line, {
    points: { configurable: true, enumerable: true, get: () => points.map((point) => ({ ...point })), set: (value: DrawPoint[]) => { points = value.map((point) => linePoint(point, 'points')); rebuild(); } },
    width: { configurable: true, enumerable: true, get: () => width, set: (value: number) => {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Line2D.width must be finite and non-negative.');
      width = value;
      rebuild();
    } },
    default_color: { configurable: true, enumerable: true, get: () => ({ ...color }), set: (value: ColorValue) => { color = { ...value }; rebuild(); } },
    closed: { configurable: true, enumerable: true, get: () => closed, set: (value: boolean) => { closed = value; rebuild(); } },
    joint_mode: { configurable: true, enumerable: true, get: () => jointMode, set: (value: number) => {
      jointMode = lineEnum(value, 'joint_mode');
      rebuild();
    } },
    begin_cap_mode: { configurable: true, enumerable: true, get: () => beginCapMode, set: (value: number) => {
      const next = lineEnum(value, 'begin_cap_mode');
      if (next !== endCapMode) throw new Error('Line2D different begin/end cap modes cannot be represented by one native Pixi stroke.');
      beginCapMode = next;
      rebuild();
    } },
    end_cap_mode: { configurable: true, enumerable: true, get: () => endCapMode, set: (value: number) => {
      const next = lineEnum(value, 'end_cap_mode');
      if (next !== beginCapMode) throw new Error('Line2D different begin/end cap modes cannot be represented by one native Pixi stroke.');
      endCapMode = next;
      rebuild();
    } },
    texture_mode: { configurable: true, enumerable: true, get: () => textureMode, set: (value: number) => {
      if (value !== 0) throw new Error('Line2D.texture_mode requires textured line UVs and is unsupported.');
      textureMode = value;
    } },
    antialiased: { configurable: true, enumerable: true, get: () => antialiased, set: (value: boolean) => {
      if (typeof value !== 'boolean') throw new TypeError('Line2D.antialiased requires bool.');
      if (value) throw new Error('Line2D.antialiased is unsupported; Pixi Graphics owns renderer antialiasing globally.');
      antialiased = value;
    } },
    round_precision: { configurable: true, enumerable: true, get: () => roundPrecision, set: (value: number) => {
      if (value !== 8) throw new Error('Line2D.round_precision has no native Pixi Graphics equivalent.');
      roundPrecision = value;
    } },
    sharp_limit: { configurable: true, enumerable: true, get: () => sharpLimit, set: (value: number) => {
      if (value !== 2) throw new Error('Line2D.sharp_limit has no native Pixi Graphics equivalent.');
      sharpLimit = value;
    } },
  });
  Object.assign(line, {
    set_points: (value: DrawPoint[]): void => { line.points = value; },
    get_points: (): DrawPoint[] => line.points,
    set_width: (value: number): void => { line.width = value; },
    get_width: (): number => line.width,
    set_default_color: (value: ColorValue): void => { line.default_color = value; },
    get_default_color: (): ColorValue => ({ ...line.default_color }),
    set_closed: (value: boolean): void => { line.closed = value; },
    is_closed: (): boolean => line.closed,
    set_joint_mode: (value: number): void => { line.joint_mode = value; },
    get_joint_mode: (): number => line.joint_mode,
    set_begin_cap_mode: (value: number): void => { line.begin_cap_mode = value; },
    get_begin_cap_mode: (): number => line.begin_cap_mode,
    set_end_cap_mode: (value: number): void => { line.end_cap_mode = value; },
    get_end_cap_mode: (): number => line.end_cap_mode,
    set_texture_mode: (value: number): void => { line.texture_mode = value; },
    get_texture_mode: (): number => line.texture_mode,
    set_antialiased: (value: boolean): void => { line.antialiased = value; },
    get_antialiased: (): boolean => line.antialiased,
  });
  line.add_point = (position: DrawPoint, index = -1): void => {
    const next = linePoint(position, 'add_point');
    if (index === -1) points.push(next);
    else points.splice(linePointIndex(index, points.length, 'add_point', true), 0, next);
    rebuild();
  };
  line.remove_point = (index: number): void => {
    points.splice(linePointIndex(index, points.length, 'remove_point'), 1);
    rebuild();
  };
  line.clear_points = (): void => {
    if (points.length === 0) return;
    points = [];
    rebuild();
  };
  line.get_point_count = (): number => points.length;
  line.get_point_position = (index: number): DrawPoint => ({
    ...points[linePointIndex(index, points.length, 'get_point_position')]!,
  });
  line.set_point_position = (index: number, position: DrawPoint): void => {
    points[linePointIndex(index, points.length, 'set_point_position')] = linePoint(position, 'set_point_position');
    rebuild();
  };
  rebuild();
  return line;
}

/** Runtime `Line2D.new()` retaining a single native Graphics draw owner. */
export function createGodotLine2D(): GodotLine2D {
  const line = createLine2D({ points: [] });
  registerGodotObjectIdentity(line, 'Line2D');
  return line;
}

export function releaseLine2D(line: GodotLine2D): void { line.clear(); }

export interface TextureRectOptions { readonly texture?: Texture; readonly width: number; readonly height: number; readonly stretchMode?: number; readonly flipH?: boolean; readonly flipV?: boolean }
export type GodotTextureRect = Container & {
  texture: Texture;
  stretch_mode: number;
  expand_mode: number;
  expand: boolean;
  ignore_texture_size: boolean;
  flip_h: boolean;
  flip_v: boolean;
  width: number;
  height: number;
  set_texture(texture: Texture): void;
  get_texture(): Texture;
  set_stretch_mode(mode: number): void;
  get_stretch_mode(): number;
  set_expand_mode(mode: number): void;
  get_expand_mode(): number;
  set_expand(enabled: boolean): void;
  has_expand(): boolean;
  set_ignore_texture_size(enabled: boolean): void;
  get_ignore_texture_size(): boolean;
  set_flip_h(enabled: boolean): void;
  is_flipped_h(): boolean;
  set_flip_v(enabled: boolean): void;
  is_flipped_v(): boolean;
};

interface TextureRectState {
  readonly sprite: Sprite;
  tile: TilingSprite | null;
  width: number;
  height: number;
  flipH: boolean;
  flipV: boolean;
}
const TEXTURE_RECTS = new WeakMap<GodotTextureRect, TextureRectState>();

function descriptorOf(target: object, name: string): PropertyDescriptor {
  for (let current: object | null = Object.getPrototypeOf(target); current !== null; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor !== undefined) return descriptor;
  }
  throw new Error(`Pixi ${target.constructor.name}.${name} has no native property descriptor.`);
}

function applyTextureRect(rect: GodotTextureRect, width: number, height: number, mode: number): void {
  const state = TEXTURE_RECTS.get(rect);
  if (state === undefined) throw new Error('TextureRect is not bound to its retained Sprite.');
  const { sprite } = state;
  state.tile?.removeFromParent();
  state.tile?.destroy({ texture: false, textureSource: false });
  state.tile = null;
  sprite.visible = true;
  const signX = state.flipH ? -1 : 1;
  const signY = state.flipV ? -1 : 1;
  const tw = Math.max(1, sprite.texture.orig.width);
  const th = Math.max(1, sprite.texture.orig.height);
  const draw = (drawWidth: number, drawHeight: number, offsetX = 0, offsetY = 0): void => {
    const scaleX = drawWidth / tw;
    const scaleY = drawHeight / th;
    // Anchor changes the Sprite's quad within its retained node without moving the node itself.
    // For a flipped quad its minimum edge is the opposite texture edge.
    sprite.anchor.set(
      drawWidth === 0 ? 0 : state.flipH ? 1 + offsetX / drawWidth : -offsetX / drawWidth,
      drawHeight === 0 ? 0 : state.flipV ? 1 + offsetY / drawHeight : -offsetY / drawHeight,
    );
    sprite.scale.set(signX * scaleX, signY * scaleY);
  };
  sprite.anchor.set(0);
  if (mode === 0) { draw(width, height); return; }
  if (mode === 1) {
    sprite.visible = false;
    state.tile = new TilingSprite({ texture: sprite.texture, width, height });
    state.tile.tileScale.set(signX, signY);
    state.tile.tilePosition.set(state.flipH ? width : 0, state.flipV ? height : 0);
    rect.addChild(state.tile);
    return;
  }
  if (mode === 2 || mode === 3) {
    draw(tw, th, mode === 3 ? (width - tw) / 2 : 0, mode === 3 ? (height - th) / 2 : 0);
    return;
  }
  if (mode < 4 || mode > 6) throw new Error(`TextureRect stretch_mode ${mode} is unsupported.`);
  const scale = mode === 6 ? Math.max(width / tw, height / th) : Math.min(width / tw, height / th);
  draw(tw * scale, th * scale, mode === 5 || mode === 6 ? (width - tw * scale) / 2 : 0, mode === 5 || mode === 6 ? (height - th * scale) / 2 : 0);
}

export function createTextureRect(options: TextureRectOptions): GodotTextureRect {
  const checkedDimension = (member: string, value: number): number => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${member} must be finite and non-negative.`);
    return value;
  };
  const checkedMode = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new RangeError('TextureRect.stretch_mode must be SCALE (0) through KEEP_ASPECT_COVERED (6).');
    return value;
  };
  let mode = checkedMode(options.stretchMode ?? 0);
  const rect = new Container() as GodotTextureRect;
  const sprite = new Sprite({ texture: options.texture ?? Texture.WHITE });
  rect.addChild(sprite);
  const nativeTexture = descriptorOf(sprite, 'texture');
  const state: TextureRectState = {
    sprite,
    tile: null,
    width: checkedDimension('TextureRect.width', options.width),
    height: checkedDimension('TextureRect.height', options.height),
    flipH: options.flipH ?? false,
    flipV: options.flipV ?? false,
  };
  TEXTURE_RECTS.set(rect, state);
  Object.defineProperty(rect, 'stretch_mode', { configurable: true, enumerable: true, get: () => mode, set: (value: number) => { mode = checkedMode(value); applyTextureRect(rect, state.width, state.height, mode); } });
  Object.defineProperties(rect, {
    texture: { configurable: true, enumerable: true, get: () => nativeTexture.get?.call(sprite), set: (value: Texture) => {
      const previous = nativeTexture.get?.call(sprite) as Texture;
      if (previous === value) return;
      releaseGradientTexture2D(previous);
      nativeTexture.set?.call(sprite, value);
      applyTextureRect(rect, state.width, state.height, mode);
    } },
    width: { configurable: true, enumerable: true, get: () => state.width, set: (value: number) => { state.width = checkedDimension('TextureRect.width', value); applyTextureRect(rect, state.width, state.height, mode); } },
    height: { configurable: true, enumerable: true, get: () => state.height, set: (value: number) => { state.height = checkedDimension('TextureRect.height', value); applyTextureRect(rect, state.width, state.height, mode); } },
    flip_h: { configurable: true, enumerable: true, get: () => state.flipH, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextureRect.flip_h must be bool.'); state.flipH = value; applyTextureRect(rect, state.width, state.height, mode); } },
    flip_v: { configurable: true, enumerable: true, get: () => state.flipV, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextureRect.flip_v must be bool.'); state.flipV = value; applyTextureRect(rect, state.width, state.height, mode); } },
    expand_mode: { configurable: true, enumerable: true, get: () => getTextureRectExpandMode(rect), set: (value: number) => setTextureRectExpandMode(rect, value) },
    expand: { configurable: true, enumerable: true, get: () => getTextureRectExpand(rect), set: (value: boolean) => setTextureRectExpand(rect, value) },
    ignore_texture_size: { configurable: true, enumerable: true, get: () => getTextureRectExpand(rect), set: (value: boolean) => setTextureRectExpand(rect, value) },
  });
  Object.assign(rect, {
    set_texture(value: Texture): void { rect.texture = value; },
    get_texture(): Texture { return rect.texture; },
    set_stretch_mode(value: number): void { rect.stretch_mode = value; },
    get_stretch_mode(): number { return rect.stretch_mode; },
    set_expand_mode(value: number): void { setTextureRectExpandMode(rect, value); },
    get_expand_mode(): number { return getTextureRectExpandMode(rect); },
    set_expand(value: boolean): void { setTextureRectExpand(rect, value); },
    has_expand(): boolean { return getTextureRectExpand(rect); },
    set_ignore_texture_size(value: boolean): void { setTextureRectExpand(rect, value); },
    get_ignore_texture_size(): boolean { return getTextureRectExpand(rect); },
    set_flip_h(value: boolean): void { if (typeof value !== 'boolean') throw new TypeError('TextureRect.flip_h must be bool.'); rect.flip_h = value; },
    is_flipped_h(): boolean { return state.flipH; },
    set_flip_v(value: boolean): void { if (typeof value !== 'boolean') throw new TypeError('TextureRect.flip_v must be bool.'); rect.flip_v = value; },
    is_flipped_v(): boolean { return state.flipV; },
  });
  rect.stretch_mode = mode;
  return rect;
}

export function releaseTextureRect(rect: GodotTextureRect): void {
  const state = TEXTURE_RECTS.get(rect);
  if (state === undefined) return;
  TEXTURE_RECTS.delete(rect);
  state.tile?.removeFromParent();
  state.tile?.destroy({ texture: false, textureSource: false });
  releaseGradientTexture2D(state.sprite.texture);
  rect.removeChild(state.sprite);
  state.sprite.destroy({ texture: false, textureSource: false });
}

export interface NinePatchRegionRect { readonly position: DrawPoint; readonly size: DrawPoint }
export interface NinePatchRectOptions { readonly texture?: Texture; readonly width: number; readonly height: number; readonly left?: number; readonly top?: number; readonly right?: number; readonly bottom?: number; readonly drawCenter?: boolean; readonly axisStretchHorizontal?: number; readonly axisStretchVertical?: number; readonly regionRect?: NinePatchRegionRect }
export type GodotNinePatchRect = NineSliceSprite & {
  draw_center: boolean;
  patch_margin_left: number;
  patch_margin_top: number;
  patch_margin_right: number;
  patch_margin_bottom: number;
  axis_stretch_horizontal: number;
  axis_stretch_vertical: number;
  region_rect: NinePatchRegionRect;
  set_texture(texture: Texture): void;
  get_texture(): Texture;
  set_patch_margin(margin: number, value: number): void;
  get_patch_margin(margin: number): number;
  set_draw_center(enabled: boolean): void;
  is_draw_center_enabled(): boolean;
  set_h_axis_stretch_mode(mode: number): void;
  get_h_axis_stretch_mode(): number;
  set_v_axis_stretch_mode(mode: number): void;
  get_v_axis_stretch_mode(): number;
  set_region_rect(rect: NinePatchRegionRect): void;
  get_region_rect(): NinePatchRegionRect;
};

const NINE_PATCH_RELEASE = new WeakMap<GodotNinePatchRect, () => void>();

export function createNinePatchRect(options: NinePatchRectOptions): GodotNinePatchRect {
  if ((options.axisStretchHorizontal ?? 0) !== 0 || (options.axisStretchVertical ?? 0) !== 0) {
    throw new Error('NinePatchRect tile/tile-fit axis stretch modes are unsupported by native NineSliceSprite.');
  }
  if (options.drawCenter === false) throw new Error('NinePatchRect.draw_center=false is unsupported: Pixi NineSliceSprite always emits its center quad.');
  const slice = new NineSliceSprite({ texture: options.texture ?? Texture.WHITE, width: options.width, height: options.height, leftWidth: options.left ?? 0, topHeight: options.top ?? 0, rightWidth: options.right ?? 0, bottomHeight: options.bottom ?? 0 }) as GodotNinePatchRect;
  registerGodotObjectIdentity(slice, 'NinePatchRect');
  const nativeTexture = descriptorOf(slice, 'texture');
  let sourceTexture = options.texture ?? Texture.WHITE;
  let framedTexture: Texture | null = null;
  let regionRect: NinePatchRegionRect = options.regionRect ?? { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
  let horizontalMode = options.axisStretchHorizontal ?? 0;
  let verticalMode = options.axisStretchVertical ?? 0;
  const checkedMargin = (member: string, value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${member} must be a non-negative integer.`);
    return value;
  };
  const checkedAxisMode = (member: string, value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError(`${member} must be STRETCH (0), TILE (1), or TILE_FIT (2).`);
    if (value !== 0) throw new Error(`${member} tile modes are unsupported by native NineSliceSprite.`);
    return value;
  };
  const checkedRegion = (value: NinePatchRegionRect): NinePatchRegionRect => {
    if (
      typeof value !== 'object' || value === null ||
      typeof value.position !== 'object' || value.position === null ||
      typeof value.size !== 'object' || value.size === null ||
      !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y) ||
      !Number.isFinite(value.size.x) || !Number.isFinite(value.size.y) ||
      value.size.x < 0 || value.size.y < 0
    ) throw new TypeError('NinePatchRect.region_rect must be a finite non-negative Rect2.');
    return { position: { x: value.position.x, y: value.position.y }, size: { x: value.size.x, y: value.size.y } };
  };
  const applyRegion = (): void => {
    if (regionRect.size.x === 0 || regionRect.size.y === 0) {
      nativeTexture.set?.call(slice, sourceTexture);
      framedTexture?.destroy(false);
      framedTexture = null;
      return;
    }
    const sourceWidth = sourceTexture.source.width;
    const sourceHeight = sourceTexture.source.height;
    if (
      regionRect.position.x < 0 || regionRect.position.y < 0 ||
      regionRect.position.x + regionRect.size.x > sourceWidth ||
      regionRect.position.y + regionRect.size.y > sourceHeight
    ) throw new RangeError('NinePatchRect.region_rect must lie inside the source texture.');
    const nextTexture = new Texture({
      source: sourceTexture.source,
      frame: new Rectangle(regionRect.position.x, regionRect.position.y, regionRect.size.x, regionRect.size.y),
    });
    nativeTexture.set?.call(slice, nextTexture);
    framedTexture?.destroy(false);
    framedTexture = nextTexture;
  };
  regionRect = checkedRegion(regionRect);
  Object.defineProperties(slice, {
    texture: {
      configurable: true,
      enumerable: true,
      get: () => sourceTexture,
      set: (value: Texture) => {
        if (!(value instanceof Texture)) throw new TypeError('NinePatchRect.texture must be Texture2D.');
        if (sourceTexture === value) return;
        const previous = sourceTexture;
        sourceTexture = value;
        try { applyRegion(); } catch (error) { sourceTexture = previous; throw error; }
        releaseGradientTexture2D(previous);
      },
    },
    draw_center: {
    configurable: true,
    enumerable: true,
    get: () => true,
    set: (value: boolean) => {
      if (value !== true) throw new Error('NinePatchRect.draw_center=false is unsupported: Pixi NineSliceSprite always emits its center quad.');
    },
    },
    patch_margin_left: { configurable: true, enumerable: true, get: () => slice.leftWidth, set: (value: number) => { slice.leftWidth = checkedMargin('NinePatchRect.patch_margin_left', value); } },
    patch_margin_top: { configurable: true, enumerable: true, get: () => slice.topHeight, set: (value: number) => { slice.topHeight = checkedMargin('NinePatchRect.patch_margin_top', value); } },
    patch_margin_right: { configurable: true, enumerable: true, get: () => slice.rightWidth, set: (value: number) => { slice.rightWidth = checkedMargin('NinePatchRect.patch_margin_right', value); } },
    patch_margin_bottom: { configurable: true, enumerable: true, get: () => slice.bottomHeight, set: (value: number) => { slice.bottomHeight = checkedMargin('NinePatchRect.patch_margin_bottom', value); } },
    axis_stretch_horizontal: { configurable: true, enumerable: true, get: () => horizontalMode, set: (value: number) => { horizontalMode = checkedAxisMode('NinePatchRect.axis_stretch_horizontal', value); } },
    axis_stretch_vertical: { configurable: true, enumerable: true, get: () => verticalMode, set: (value: number) => { verticalMode = checkedAxisMode('NinePatchRect.axis_stretch_vertical', value); } },
    region_rect: { configurable: true, enumerable: true, get: () => ({ position: { ...regionRect.position }, size: { ...regionRect.size } }), set: (value: NinePatchRegionRect) => { regionRect = checkedRegion(value); applyRegion(); } },
  });
  Object.assign(slice, {
    set_texture(value: Texture): void { slice.texture = value; },
    get_texture(): Texture { return slice.texture; },
    set_patch_margin(margin: number, value: number): void {
      const side = checkedMargin('NinePatchRect margin side', margin);
      const amount = checkedMargin('NinePatchRect margin value', value);
      if (side === 0) slice.patch_margin_left = amount;
      else if (side === 1) slice.patch_margin_top = amount;
      else if (side === 2) slice.patch_margin_right = amount;
      else if (side === 3) slice.patch_margin_bottom = amount;
      else throw new RangeError('NinePatchRect margin side must be LEFT (0) through BOTTOM (3).');
    },
    get_patch_margin(margin: number): number {
      const side = checkedMargin('NinePatchRect margin side', margin);
      if (side === 0) return slice.patch_margin_left;
      if (side === 1) return slice.patch_margin_top;
      if (side === 2) return slice.patch_margin_right;
      if (side === 3) return slice.patch_margin_bottom;
      throw new RangeError('NinePatchRect margin side must be LEFT (0) through BOTTOM (3).');
    },
    set_draw_center(value: boolean): void { slice.draw_center = value; },
    is_draw_center_enabled(): boolean { return slice.draw_center; },
    set_h_axis_stretch_mode(value: number): void { slice.axis_stretch_horizontal = value; },
    get_h_axis_stretch_mode(): number { return horizontalMode; },
    set_v_axis_stretch_mode(value: number): void { slice.axis_stretch_vertical = value; },
    get_v_axis_stretch_mode(): number { return verticalMode; },
    set_region_rect(value: NinePatchRegionRect): void { slice.region_rect = value; },
    get_region_rect(): NinePatchRegionRect { return { position: { ...regionRect.position }, size: { ...regionRect.size } }; },
  });
  applyRegion();
  NINE_PATCH_RELEASE.set(slice, () => {
    framedTexture?.destroy(false);
    releaseGradientTexture2D(sourceTexture);
  });
  return slice;
}

/** Runtime NinePatchRect.new() using the retained native Pixi NineSliceSprite carrier. */
export function createGodotCanvasNinePatchRect(): GodotNinePatchRect {
  return createNinePatchRect({
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    drawCenter: true,
    axisStretchHorizontal: 0,
    axisStretchVertical: 0,
  });
}

export function releaseNinePatchRect(slice: GodotNinePatchRect): void {
  NINE_PATCH_RELEASE.get(slice)?.();
  NINE_PATCH_RELEASE.delete(slice);
}

export interface GradientStop { readonly offset: number; readonly color: ColorValue }
export interface GradientTexture2DOptions { readonly from: DrawPoint; readonly to: DrawPoint; readonly width?: number; readonly height?: number; readonly stops: readonly GradientStop[]; readonly fill?: number; readonly repeat?: number }
const GRADIENT_TEXTURES = new WeakMap<Texture, { readonly gradient: FillGradient; readonly sourceTexture: Texture }>();

/** Godot GradientTexture2D becomes Pixi's own generated FillGradient texture. */
export function createGradientTexture2D(options: GradientTexture2DOptions): Texture {
  if ((options.fill ?? 0) !== 0) throw new Error('GradientTexture2D radial/square fill modes are unsupported by Pixi FillGradient.');
  if ((options.repeat ?? 0) !== 0) throw new Error('GradientTexture2D repeat modes are unsupported by Pixi FillGradient.');
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  if (width !== height) {
    throw new Error(`GradientTexture2D ${width}x${height} is unsupported: Pixi FillGradient owns a square source texture and a mismatched frame would distort it.`);
  }
  const gradient = new FillGradient({
    type: 'linear',
    start: options.from,
    end: options.to,
    colorStops: options.stops.map((stop) => ({ offset: stop.offset, color: colorRgba(stop.color) })),
    textureSpace: 'local',
    textureSize: Math.max(width, height),
  });
  gradient.buildGradient();
  const sourceTexture = gradient.texture;
  const texture = new Texture({
    source: sourceTexture.source,
    frame: sourceTexture.frame.clone(),
    orig: new Rectangle(0, 0, width, height),
  });
  GRADIENT_TEXTURES.set(texture, { gradient, sourceTexture });
  return texture;
}

export function releaseGradientTexture2D(texture: Texture): void {
  const binding = GRADIENT_TEXTURES.get(texture);
  if (binding === undefined) return;
  texture.destroy(false);
  binding.gradient.destroy();
  GRADIENT_TEXTURES.delete(texture);
}
