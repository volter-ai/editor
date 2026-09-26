/**
 * Godot 3.6/4.7 SpriteBase3D and Sprite3D state on the retained THREE.Mesh.
 * Geometry/UV construction follows `scene/3d/sprite_3d.cpp::draw_texture_rect` and
 * `Sprite3D::_draw`; Three's render callback carries Godot's enabled/fixed-Y billboards
 * without a second clock or mirror object.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NearestMipmapNearestFilter,
  RepeatWrapping,
  type Camera,
  type Texture,
  Vector3,
} from 'three';
import {
  bindBillboard3D,
  type Billboard3DBinding,
  type Billboard3DMode,
} from '../sprite/billboard-3d';
import { godotColor } from './color';
import { godotResourceChangedSignal } from './resource-io';
import {
  createSignal,
  type GodotConnection,
  type GodotSignal,
  type SignalHandle,
} from './signal';
import type { ColorValue } from './variant';
import { type Vector2, vec2 } from './vector2';

export const SPRITE_3D_FLAG_TRANSPARENT = 0;
export const SPRITE_3D_FLAG_SHADED = 1;
export const SPRITE_3D_FLAG_DOUBLE_SIDED = 2;
export const SPRITE_3D_FLAG_DISABLE_DEPTH_TEST = 3;
export const SPRITE_3D_FLAG_FIXED_SIZE = 4;
export const SPRITE_3D_ALPHA_CUT_DISABLED = 0;
export const SPRITE_3D_ALPHA_CUT_DISCARD = 1;
export const SPRITE_3D_ALPHA_CUT_OPAQUE_PREPASS = 2;
export const SPRITE_3D_ALPHA_CUT_HASH = 3;
export const SPRITE_3D_BILLBOARD_DISABLED = 0;
export const SPRITE_3D_BILLBOARD_ENABLED = 1;
export const SPRITE_3D_BILLBOARD_FIXED_Y = 2;

export interface Sprite3DRect {
  readonly position: Vector2;
  readonly size: Vector2;
}

export interface Sprite3DOptions {
  readonly major: 3 | 4;
  readonly texture: Texture | null;
  readonly pixelSize?: number;
  readonly axis?: number;
  readonly centered?: boolean;
  readonly offset?: Vector2;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly modulate?: ColorValue;
  readonly opacity?: number;
  readonly billboard?: number;
  readonly transparent?: boolean;
  readonly shaded?: boolean;
  readonly doubleSided?: boolean;
  readonly noDepthTest?: boolean;
  readonly fixedSize?: boolean;
  readonly alphaCut?: number;
  readonly alphaScissorThreshold?: number;
  readonly renderPriority?: number;
  readonly textureFilter?: number;
  readonly hframes?: number;
  readonly vframes?: number;
  readonly frame?: number;
  readonly regionEnabled?: boolean;
  readonly regionRect?: Sprite3DRect;
}

interface Sprite3DState {
  major: 3 | 4;
  sourceTexture: Texture | null;
  texture: Texture | null;
  pixelSize: number;
  axis: number;
  centered: boolean;
  offset: Vector2;
  flipH: boolean;
  flipV: boolean;
  modulate: ColorValue;
  opacity: number;
  billboard: number;
  flags: [boolean, boolean, boolean, boolean, boolean];
  alphaCut: number;
  alphaScissorThreshold: number;
  renderPriority: number;
  textureFilter: number;
  hframes: number;
  vframes: number;
  frame: number;
  regionEnabled: boolean;
  regionRect: Sprite3DRect;
  readonly authoredScale: Vector3;
  readonly previousBeforeRender: Mesh['onBeforeRender'];
  readonly previousAfterRender: Mesh['onAfterRender'];
  billboardBinding: Billboard3DBinding | null;
  fixedSizePoseApplied: boolean;
  readonly frameChanged: SignalHandle<readonly []>;
  readonly textureChanged: SignalHandle<readonly []>;
  textureChangedConnection: GodotConnection | null;
  depthPrepass: Mesh<BufferGeometry, MeshDepthMaterial> | undefined;
}

const STATE = new WeakMap<Mesh, Sprite3DState>();
const WORLD_POSITION = new Vector3();
const CAMERA_POSITION = new Vector3();

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires a finite float.`);
  return value;
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${member} requires an integer.`);
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function vector2(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Vector2.`);
  const point = value as Partial<Vector2>;
  return vec2(finite(point.x, `${member}.x`), finite(point.y, `${member}.y`));
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Color.`);
  const input = value as Partial<ColorValue>;
  return godotColor(
    finite(input.r, `${member}.r`),
    finite(input.g, `${member}.g`),
    finite(input.b, `${member}.b`),
    finite(input.a, `${member}.a`),
  );
}

function stateOf(mesh: Mesh, member: string): Sprite3DState {
  const state = STATE.get(mesh);
  if (state === undefined) throw new Error(`${member} requires a retained Sprite3D binding.`);
  return state;
}

function textureSize(texture: Texture): Vector2 {
  const getter = Reflect.get(texture, 'get_size');
  if (typeof getter === 'function') {
    const size = getter.call(texture) as Partial<Vector2>;
    const width = size?.x;
    const height = size?.y;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
        typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
      throw new Error('Sprite3D Texture2D.get_size() returned invalid dimensions.');
    }
    return vec2(width, height);
  }
  const image = texture.image as { width?: unknown; height?: unknown } | undefined;
  const width = image?.width;
  const height = image?.height;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    throw new Error('Sprite3D texture dimensions are unavailable; load the authored Texture2D before binding the sprite.');
  }
  return vec2(width, height);
}

function baseRect(state: Sprite3DState): Sprite3DRect {
  if (state.regionEnabled) return state.regionRect;
  if (state.sourceTexture === null) return { position: vec2(), size: vec2() };
  return { position: vec2(), size: textureSize(state.sourceTexture) };
}

function itemRect(state: Sprite3DState): Sprite3DRect {
  const source = baseRect(state);
  const size = vec2(source.size.x / state.hframes, source.size.y / state.vframes);
  const position = state.centered
    ? vec2(state.offset.x - size.x * 0.5, state.offset.y - size.y * 0.5)
    : vec2(state.offset.x, state.offset.y);
  return { position, size: size.x === 0 && size.y === 0 ? vec2(1, 1) : size };
}

type Sprite3DMaterial = MeshBasicMaterial | MeshStandardMaterial;

function materialOf(mesh: Mesh): Sprite3DMaterial {
  if (!(mesh.material instanceof MeshBasicMaterial) && !(mesh.material instanceof MeshStandardMaterial)) throw new Error('Sprite3D requires a native Three basic or standard material.');
  return mesh.material;
}

function ensureMaterial(mesh: Mesh, shaded: boolean): Sprite3DMaterial {
  const current = materialOf(mesh);
  if (shaded ? current instanceof MeshStandardMaterial : current instanceof MeshBasicMaterial) return current;
  const next = shaded ? new MeshStandardMaterial({ roughness: 1, metalness: 0 }) : new MeshBasicMaterial();
  mesh.material = next;
  current.dispose();
  return next;
}

function syncMaterial(mesh: Mesh, state: Sprite3DState): void {
  const material = ensureMaterial(mesh, state.flags[SPRITE_3D_FLAG_SHADED]);
  material.map = state.texture;
  syncAccumulatedColor(mesh, state, material);
  material.transparent = state.flags[SPRITE_3D_FLAG_TRANSPARENT] && (state.alphaCut === SPRITE_3D_ALPHA_CUT_DISABLED || state.alphaCut === SPRITE_3D_ALPHA_CUT_OPAQUE_PREPASS);
  material.side = state.flags[SPRITE_3D_FLAG_DOUBLE_SIDED] ? DoubleSide : FrontSide;
  material.depthTest = !state.flags[SPRITE_3D_FLAG_DISABLE_DEPTH_TEST];
  material.alphaTest = state.flags[SPRITE_3D_FLAG_TRANSPARENT] && state.alphaCut === SPRITE_3D_ALPHA_CUT_DISCARD ? state.alphaScissorThreshold : 0;
  material.alphaHash = state.flags[SPRITE_3D_FLAG_TRANSPARENT] && state.alphaCut === SPRITE_3D_ALPHA_CUT_HASH;
  material.depthWrite = state.alphaCut !== SPRITE_3D_ALPHA_CUT_OPAQUE_PREPASS;
  material.needsUpdate = true;
  mesh.renderOrder = state.renderPriority;
  syncDepthPrepass(mesh, state);
}

function syncDepthPrepass(mesh: Mesh, state: Sprite3DState): void {
  const enabled = state.flags[SPRITE_3D_FLAG_TRANSPARENT] && state.alphaCut === SPRITE_3D_ALPHA_CUT_OPAQUE_PREPASS;
  if (!enabled) {
    if (state.depthPrepass !== undefined) {
      mesh.remove(state.depthPrepass);
      state.depthPrepass.material.dispose();
      state.depthPrepass = undefined;
    }
    return;
  }
  let pass = state.depthPrepass;
  if (pass === undefined) {
    const material = new MeshDepthMaterial();
    material.colorWrite = false;
    material.depthWrite = true;
    pass = new Mesh(mesh.geometry as BufferGeometry, material);
    pass.name = '__godot_sprite3d_alpha_depth_prepass';
    pass.frustumCulled = false;
    pass.onBeforeRender = (renderer, scene, camera, geometry, passMaterial, group) => mesh.onBeforeRender(renderer, scene, camera, geometry, passMaterial, group);
    pass.onAfterRender = (renderer, scene, camera, geometry, passMaterial, group) => mesh.onAfterRender(renderer, scene, camera, geometry, passMaterial, group);
    mesh.add(pass);
    state.depthPrepass = pass;
  }
  pass.geometry = mesh.geometry as BufferGeometry;
  pass.material.map = state.texture;
  pass.material.alphaMap = null;
  pass.material.alphaTest = state.alphaScissorThreshold;
  pass.material.needsUpdate = true;
  pass.renderOrder = state.renderPriority - 1;
}

function syncAccumulatedColor(mesh: Mesh, state: Sprite3DState, material = materialOf(mesh)): void {
  const accumulated = accumulatedModulate(mesh, state);
  material.color.setRGB(accumulated.r, accumulated.g, accumulated.b);
  material.opacity = accumulated.a * state.opacity;
}

function accumulatedModulate(mesh: Mesh, state: Sprite3DState): ColorValue {
  let r = state.modulate.r;
  let g = state.modulate.g;
  let b = state.modulate.b;
  let a = state.modulate.a;
  const parent = mesh.parent;
  if (parent instanceof Mesh) {
    const ancestor = STATE.get(parent);
    if (ancestor !== undefined) {
      const inherited = accumulatedModulate(parent, ancestor);
      r *= inherited.r;
      g *= inherited.g;
      b *= inherited.b;
      a *= inherited.a;
    }
  }
  return godotColor(r, g, b, a);
}

function assertSupportedState(state: Sprite3DState): void {
  if (state.sourceTexture !== null) textureSize(state.sourceTexture);
  if (state.axis < 0 || state.axis > 2) throw new RangeError(`SpriteBase3D.axis ${state.axis} is outside AXIS_X..AXIS_Z.`);
  if (state.billboard < 0 || state.billboard > 2) throw new RangeError(`SpriteBase3D.billboard ${state.billboard} is unsupported.`);
  if (state.major === 3 && state.alphaCut === SPRITE_3D_ALPHA_CUT_HASH) throw new RangeError('SpriteBase3D ALPHA_CUT_HASH does not exist in Godot 3.');
  if (state.alphaCut < 0 || state.alphaCut > 3) throw new RangeError(`SpriteBase3D alpha_cut mode ${state.alphaCut} is outside Godot's enum.`);
  if (state.textureFilter < 0 || state.textureFilter > 5) throw new RangeError(`SpriteBase3D.texture_filter ${state.textureFilter} is outside Godot's TextureFilter enum.`);
  if (state.renderPriority < -128 || state.renderPriority > 127) throw new RangeError('SpriteBase3D.render_priority must be between -128 and 127.');
  if (state.hframes < 1 || state.vframes < 1) throw new RangeError('Sprite3D hframes/vframes must be at least 1.');
  if (state.frame < 0 || state.frame >= state.hframes * state.vframes) throw new RangeError(`Sprite3D.frame ${state.frame} is outside the sheet.`);
}

function syncTextureFilter(state: Sprite3DState): void {
  const filter = state.textureFilter;
  if (filter < 0 || filter > 5) throw new RangeError(`SpriteBase3D.texture_filter ${filter} is outside Godot's TextureFilter enum.`);
  const nearest = filter === 0 || filter === 2 || filter === 4;
  const mipmaps = filter >= 2;
  const anisotropic = filter === 4 || filter === 5;
  if (state.texture === null) return;
  state.texture.magFilter = nearest ? NearestFilter : LinearFilter;
  state.texture.minFilter = nearest
    ? (mipmaps ? NearestMipmapNearestFilter : NearestFilter)
    : (mipmaps ? LinearMipmapLinearFilter : LinearFilter);
  state.texture.generateMipmaps = mipmaps;
  // Godot's anisotropic enum selects the device's supported sampler level. Three clamps this
  // request to the renderer capability when the texture uploads.
  state.texture.anisotropy = anisotropic ? 16 : 1;
  state.texture.needsUpdate = true;
}

function syncGeometry(mesh: Mesh, state: Sprite3DState): void {
  if (state.axis < 0 || state.axis > 2) throw new RangeError(`SpriteBase3D.axis ${state.axis} is outside AXIS_X..AXIS_Z.`);
  if (state.frame < 0 || state.frame >= state.hframes * state.vframes) {
    throw new RangeError(`Sprite3D.frame ${state.frame} is outside 0..${state.hframes * state.vframes - 1}.`);
  }
  if (state.sourceTexture === null || state.texture === null) {
    const geometry = mesh.geometry instanceof BufferGeometry ? mesh.geometry : new BufferGeometry();
    geometry.setDrawRange(0, 0);
    mesh.geometry = geometry;
    if (state.depthPrepass !== undefined) state.depthPrepass.geometry = geometry;
    return;
  }
  const source = baseRect(state);
  const frameSize = vec2(source.size.x / state.hframes, source.size.y / state.vframes);
  const column = state.frame % state.hframes;
  const row = Math.floor(state.frame / state.hframes);
  const item = itemRect(state);
  const left = item.position.x * state.pixelSize;
  const right = (item.position.x + item.size.x) * state.pixelSize;
  const top = -item.position.y * state.pixelSize;
  const bottom = -(item.position.y + item.size.y) * state.pixelSize;
  const planar = [[left, bottom], [right, bottom], [right, top], [left, top]] as const;
  const positions = new Float32Array(12);
  for (let index = 0; index < planar.length; index += 1) {
    let [x, y] = planar[index] as readonly [number, number];
    if (state.axis === 0) x = -x;
    if (state.axis === 1) y = -y;
    const xAxis = state.axis === 2 ? 0 : state.axis === 0 ? 2 : 0;
    const yAxis = state.axis === 2 ? 1 : state.axis === 0 ? 1 : 2;
    positions[index * 3 + xAxis] = x;
    positions[index * 3 + yAxis] = y;
  }
  const texture = textureSize(state.sourceTexture);
  let u0 = (source.position.x + column * frameSize.x) / texture.x;
  let v0 = 1 - (source.position.y + row * frameSize.y + frameSize.y) / texture.y;
  let u1 = u0 + frameSize.x / texture.x;
  let v1 = v0 + frameSize.y / texture.y;
  if (state.flipH) [u0, u1] = [u1, u0];
  if (state.flipV) [v0, v1] = [v1, v0];
  const repeats = Math.min(u0, u1, v0, v1) < 0 || Math.max(u0, u1, v0, v1) > 1;
  const wrapping = repeats ? RepeatWrapping : ClampToEdgeWrapping;
  if (state.texture.wrapS !== wrapping || state.texture.wrapT !== wrapping) {
    state.texture.wrapS = wrapping;
    state.texture.wrapT = wrapping;
    state.texture.needsUpdate = true;
  }
  const uv = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]);
  const geometry = mesh.geometry instanceof BufferGeometry ? mesh.geometry : new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setDrawRange(0, 6);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
  if (state.depthPrepass !== undefined) state.depthPrepass.geometry = geometry;
}

function bindSpriteRenderLifecycle(mesh: Mesh, state: Sprite3DState): void {
  mesh.onBeforeRender = (renderer, scene, camera: Camera, geometry, material, group) => {
    state.previousBeforeRender.call(mesh, renderer, scene, camera, geometry, material, group);
    syncAccumulatedColor(mesh, state);
    if (!state.flags[SPRITE_3D_FLAG_FIXED_SIZE]) return;
    state.authoredScale.copy(mesh.scale);
    mesh.getWorldPosition(WORLD_POSITION);
    CAMERA_POSITION.copy(WORLD_POSITION);
    camera.worldToLocal(CAMERA_POSITION);
    const projection = camera.projectionMatrix.elements;
    const scale = projection[15] !== 0 ? Math.abs(1 / (projection[5] as number)) : -CAMERA_POSITION.z;
    mesh.scale.multiplyScalar(scale);
    mesh.updateMatrixWorld();
    state.fixedSizePoseApplied = true;
  };
  mesh.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
    if (state.fixedSizePoseApplied) {
      mesh.scale.copy(state.authoredScale);
      mesh.updateMatrixWorld();
      state.fixedSizePoseApplied = false;
    }
    state.previousAfterRender.call(mesh, renderer, scene, camera, geometry, material, group);
  };
}

function syncBillboard(_mesh: Mesh, state: Sprite3DState): void {
  if (state.billboard < 0 || state.billboard > 2) throw new RangeError(`SpriteBase3D.billboard ${state.billboard} is unsupported.`);
  if (state.billboardBinding !== null) state.billboardBinding.mode = state.billboard as Billboard3DMode;
}

function syncSprite(mesh: Mesh, state: Sprite3DState): void {
  syncGeometry(mesh, state);
  syncTextureFilter(state);
  syncMaterial(mesh, state);
  syncBillboard(mesh, state);
}

function bindSourceTextureChanges(mesh: Mesh, state: Sprite3DState): void {
  state.textureChangedConnection?.disconnect();
  state.textureChangedConnection = null;
  const sourceTexture = state.sourceTexture;
  const texture = state.texture;
  if (sourceTexture === null || texture === null || typeof Reflect.get(sourceTexture, 'get_atlas') !== 'function') return;
  state.textureChangedConnection = godotResourceChangedSignal(sourceTexture).connect(() => {
    texture.copy(sourceTexture);
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    syncSprite(mesh, state);
  });
}

export function bindGodotSprite3D(mesh: Mesh, options: Sprite3DOptions): Mesh {
  const map = options.texture?.clone() ?? null;
  if (map !== null) {
    map.wrapS = ClampToEdgeWrapping;
    map.wrapT = ClampToEdgeWrapping;
  }
  const material = mesh.material instanceof MeshBasicMaterial ? mesh.material : new MeshBasicMaterial();
  mesh.material = material;
  const modulate = options.modulate ?? godotColor(1, 1, 1, 1);
  const state: Sprite3DState = {
    major: options.major,
    sourceTexture: options.texture,
    texture: map,
    pixelSize: finite(options.pixelSize ?? 0.01, 'SpriteBase3D.pixel_size'),
    axis: integer(options.axis ?? 2, 'SpriteBase3D.axis'),
    centered: boolean(options.centered ?? true, 'SpriteBase3D.centered'),
    offset: options.offset === undefined ? vec2() : vector2(options.offset, 'SpriteBase3D.offset'),
    flipH: boolean(options.flipH ?? false, 'SpriteBase3D.flip_h'),
    flipV: boolean(options.flipV ?? false, 'SpriteBase3D.flip_v'),
    modulate: color(modulate, 'SpriteBase3D.modulate'),
    opacity: finite(options.opacity ?? 1, 'SpriteBase3D.opacity'),
    billboard: integer(options.billboard ?? 0, 'SpriteBase3D.billboard'),
    flags: [boolean(options.transparent ?? true, 'SpriteBase3D.transparent'), boolean(options.shaded ?? false, 'SpriteBase3D.shaded'), boolean(options.doubleSided ?? true, 'SpriteBase3D.double_sided'), boolean(options.noDepthTest ?? false, 'SpriteBase3D.no_depth_test'), boolean(options.fixedSize ?? false, 'SpriteBase3D.fixed_size')],
    alphaCut: integer(options.alphaCut ?? 0, 'SpriteBase3D.alpha_cut'),
    alphaScissorThreshold: finite(options.alphaScissorThreshold ?? (options.major === 3 ? 0.98 : 0.5), 'SpriteBase3D.alpha_scissor_threshold'),
    renderPriority: integer(options.renderPriority ?? 0, 'SpriteBase3D.render_priority'),
    textureFilter: integer(options.textureFilter ?? (options.major === 4 ? 3 : 1), 'SpriteBase3D.texture_filter'),
    hframes: integer(options.hframes ?? 1, 'Sprite3D.hframes'),
    vframes: integer(options.vframes ?? 1, 'Sprite3D.vframes'),
    frame: integer(options.frame ?? 0, 'Sprite3D.frame'),
    regionEnabled: boolean(options.regionEnabled ?? false, 'Sprite3D.region_enabled'),
    regionRect: options.regionRect === undefined ? { position: vec2(), size: vec2() } : { position: vector2(options.regionRect.position, 'Sprite3D.region_rect.position'), size: vector2(options.regionRect.size, 'Sprite3D.region_rect.size') },
    authoredScale: mesh.scale.clone(),
    previousBeforeRender: mesh.onBeforeRender,
    previousAfterRender: mesh.onAfterRender,
    billboardBinding: null,
    fixedSizePoseApplied: false,
    frameChanged: createSignal(),
    textureChanged: createSignal(),
    textureChangedConnection: null,
    depthPrepass: undefined,
  };
  assertSupportedState(state);
  STATE.set(mesh, state);
  bindSpriteRenderLifecycle(mesh, state);
  state.billboardBinding = bindBillboard3D(mesh, state.billboard as Billboard3DMode);
  bindSourceTextureChanges(mesh, state);
  syncSprite(mesh, state);
  return mesh;
}

export function releaseGodotSprite3D(mesh: Mesh): void {
  const state = STATE.get(mesh);
  if (state === undefined) return;
  state.billboardBinding?.release();
  state.billboardBinding = null;
  if (state.fixedSizePoseApplied) mesh.scale.copy(state.authoredScale);
  state.textureChangedConnection?.disconnect();
  state.texture?.dispose();
  if (state.depthPrepass !== undefined) {
    mesh.remove(state.depthPrepass);
    state.depthPrepass.material.dispose();
  }
  mesh.onBeforeRender = state.previousBeforeRender;
  mesh.onAfterRender = state.previousAfterRender;
  STATE.delete(mesh);
}

export function setSprite3DCentered(mesh: Mesh, value: boolean): void { const state = stateOf(mesh, 'set_centered'); state.centered = boolean(value, 'SpriteBase3D.centered'); syncGeometry(mesh, state); }
export function isSprite3DCentered(mesh: Mesh): boolean { return stateOf(mesh, 'is_centered').centered; }
export function setSprite3DOffset(mesh: Mesh, value: Vector2): void { const state = stateOf(mesh, 'set_offset'); state.offset = vector2(value, 'SpriteBase3D.offset'); syncGeometry(mesh, state); }
export function getSprite3DOffset(mesh: Mesh): Vector2 { const value = stateOf(mesh, 'get_offset').offset; return vec2(value.x, value.y); }
export function setSprite3DFlipH(mesh: Mesh, value: boolean): void { const state = stateOf(mesh, 'set_flip_h'); state.flipH = boolean(value, 'SpriteBase3D.flip_h'); syncGeometry(mesh, state); }
export function isSprite3DFlippedH(mesh: Mesh): boolean { return stateOf(mesh, 'is_flipped_h').flipH; }
export function setSprite3DFlipV(mesh: Mesh, value: boolean): void { const state = stateOf(mesh, 'set_flip_v'); state.flipV = boolean(value, 'SpriteBase3D.flip_v'); syncGeometry(mesh, state); }
export function isSprite3DFlippedV(mesh: Mesh): boolean { return stateOf(mesh, 'is_flipped_v').flipV; }
export function setSprite3DModulate(mesh: Mesh, value: ColorValue): void { const state = stateOf(mesh, 'set_modulate'); state.modulate = color(value, 'SpriteBase3D.modulate'); syncMaterial(mesh, state); }
export function getSprite3DModulate(mesh: Mesh): ColorValue { const value = stateOf(mesh, 'get_modulate').modulate; return godotColor(value.r, value.g, value.b, value.a); }
export function setSprite3DOpacity(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_opacity'); state.opacity = finite(value, 'SpriteBase3D.opacity'); syncMaterial(mesh, state); }
export function getSprite3DOpacity(mesh: Mesh): number { return stateOf(mesh, 'get_opacity').opacity; }
export function setSprite3DPixelSize(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_pixel_size'); state.pixelSize = finite(value, 'SpriteBase3D.pixel_size'); syncGeometry(mesh, state); }
export function getSprite3DPixelSize(mesh: Mesh): number { return stateOf(mesh, 'get_pixel_size').pixelSize; }
export function setSprite3DAxis(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_axis'); const next = integer(value, 'SpriteBase3D.axis'); if (next < 0 || next > 2) throw new RangeError(`SpriteBase3D.axis ${next} is outside AXIS_X..AXIS_Z.`); state.axis = next; syncGeometry(mesh, state); }
export function getSprite3DAxis(mesh: Mesh): number { return stateOf(mesh, 'get_axis').axis; }
export function setSprite3DBillboard(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_billboard_mode'); const next = integer(value, 'SpriteBase3D.billboard'); if (next < 0 || next > 2) throw new RangeError(`SpriteBase3D.billboard ${next} is unsupported.`); state.billboard = next; syncBillboard(mesh, state); }
export function getSprite3DBillboard(mesh: Mesh): number { return stateOf(mesh, 'get_billboard_mode').billboard; }
export function setSprite3DDrawFlag(mesh: Mesh, flag: number, value: boolean): void { const state = stateOf(mesh, 'set_draw_flag'); const index = integer(flag, 'SpriteBase3D.flag'); if (index < 0 || index >= state.flags.length) throw new RangeError(`SpriteBase3D flag ${index} is out of range.`); state.flags[index] = boolean(value, 'SpriteBase3D.flag value'); syncMaterial(mesh, state); }
export function getSprite3DDrawFlag(mesh: Mesh, flag: number): boolean { const state = stateOf(mesh, 'get_draw_flag'); const index = integer(flag, 'SpriteBase3D.flag'); if (index < 0 || index >= state.flags.length) throw new RangeError(`SpriteBase3D flag ${index} is out of range.`); return state.flags[index] as boolean; }
export function setSprite3DAlphaCut(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_alpha_cut_mode'); const next = integer(value, 'SpriteBase3D.alpha_cut'); if (next < 0 || next > (state.major === 3 ? 2 : 3)) throw new RangeError(`SpriteBase3D alpha_cut mode ${next} is outside Godot's enum.`); state.alphaCut = next; syncMaterial(mesh, state); }
export function getSprite3DAlphaCut(mesh: Mesh): number { return stateOf(mesh, 'get_alpha_cut_mode').alphaCut; }
export function setSprite3DAlphaScissorThreshold(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_alpha_scissor_threshold'); state.alphaScissorThreshold = finite(value, 'SpriteBase3D.alpha_scissor_threshold'); syncMaterial(mesh, state); }
export function getSprite3DAlphaScissorThreshold(mesh: Mesh): number { return stateOf(mesh, 'get_alpha_scissor_threshold').alphaScissorThreshold; }
export function setSprite3DRenderPriority(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_render_priority'); const next = integer(value, 'SpriteBase3D.render_priority'); if (next < -128 || next > 127) throw new RangeError('SpriteBase3D.render_priority must be between -128 and 127.'); state.renderPriority = next; syncMaterial(mesh, state); }
export function getSprite3DRenderPriority(mesh: Mesh): number { return stateOf(mesh, 'get_render_priority').renderPriority; }
export function setSprite3DTextureFilter(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_texture_filter'); const next = integer(value, 'SpriteBase3D.texture_filter'); if (next < 0 || next > 5) throw new RangeError(`SpriteBase3D.texture_filter ${next} is outside Godot's enum.`); state.textureFilter = next; syncTextureFilter(state); }
export function getSprite3DTextureFilter(mesh: Mesh): number { return stateOf(mesh, 'get_texture_filter').textureFilter; }
export function setSprite3DTexture(mesh: Mesh, texture: Texture | null): void { const state = stateOf(mesh, 'set_texture'); if (state.sourceTexture === texture) return; if (texture !== null) textureSize(texture); const next = texture?.clone() ?? null; if (next !== null) { next.wrapS = ClampToEdgeWrapping; next.wrapT = ClampToEdgeWrapping; } const previousTexture = state.texture; const previousSource = state.sourceTexture; state.sourceTexture = texture; state.texture = next; try { syncSprite(mesh, state); } catch (error) { state.sourceTexture = previousSource; state.texture = previousTexture; next?.dispose(); throw error; } bindSourceTextureChanges(mesh, state); previousTexture?.dispose(); state.textureChanged.emit(); }
export function getSprite3DTexture(mesh: Mesh): Texture | null { return stateOf(mesh, 'get_texture').sourceTexture; }
export function setSprite3DRegionEnabled(mesh: Mesh, value: boolean): void { const state = stateOf(mesh, 'set_region_enabled'); state.regionEnabled = boolean(value, 'Sprite3D.region_enabled'); syncGeometry(mesh, state); }
export function isSprite3DRegionEnabled(mesh: Mesh): boolean { return stateOf(mesh, 'is_region_enabled').regionEnabled; }
export function setSprite3DRegionRect(mesh: Mesh, value: Sprite3DRect): void { const state = stateOf(mesh, 'set_region_rect'); state.regionRect = { position: vector2(value.position, 'Sprite3D.region_rect.position'), size: vector2(value.size, 'Sprite3D.region_rect.size') }; if (state.regionEnabled) syncGeometry(mesh, state); }
export function getSprite3DRegionRect(mesh: Mesh): Sprite3DRect { const value = stateOf(mesh, 'get_region_rect').regionRect; return { position: vec2(value.position.x, value.position.y), size: vec2(value.size.x, value.size.y) }; }
export function setSprite3DFrame(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_frame'); const next = integer(value, 'Sprite3D.frame'); if (next < 0 || next >= state.hframes * state.vframes) throw new RangeError(`Sprite3D.frame ${next} is outside the sheet.`); if (next === state.frame) return; state.frame = next; syncGeometry(mesh, state); state.frameChanged.emit(); }
export function getSprite3DFrame(mesh: Mesh): number { return stateOf(mesh, 'get_frame').frame; }
export function setSprite3DHframes(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_hframes'); const next = integer(value, 'Sprite3D.hframes'); if (next < 1) throw new RangeError('Sprite3D.hframes must be at least 1.'); if (next === state.hframes) return; if (state.major === 4 && state.vframes > 1) { const column = state.frame % state.hframes; const row = Math.floor(state.frame / state.hframes); state.frame = column >= next ? 0 : row * next + column; } state.hframes = next; if (state.major === 4 && state.frame >= state.vframes * state.hframes) state.frame = 0; syncGeometry(mesh, state); }
export function getSprite3DHframes(mesh: Mesh): number { return stateOf(mesh, 'get_hframes').hframes; }
export function setSprite3DVframes(mesh: Mesh, value: number): void { const state = stateOf(mesh, 'set_vframes'); const next = integer(value, 'Sprite3D.vframes'); if (next < 1) throw new RangeError('Sprite3D.vframes must be at least 1.'); if (next === state.vframes) return; state.vframes = next; if (state.major === 4 && state.frame >= state.vframes * state.hframes) state.frame = 0; syncGeometry(mesh, state); }
export function getSprite3DVframes(mesh: Mesh): number { return stateOf(mesh, 'get_vframes').vframes; }
export function getSprite3DFrameCoords(mesh: Mesh): Vector2 { const state = stateOf(mesh, 'get_frame_coords'); return vec2(state.frame % state.hframes, Math.floor(state.frame / state.hframes)); }
export function setSprite3DFrameCoords(mesh: Mesh, value: Vector2): void { const state = stateOf(mesh, 'set_frame_coords'); const point = vector2(value, 'Sprite3D.frame_coords'); const x = integer(point.x, 'Sprite3D.frame_coords.x'); const y = integer(point.y, 'Sprite3D.frame_coords.y'); if (x < 0 || x >= state.hframes || y < 0 || y >= state.vframes) throw new RangeError('Sprite3D.frame_coords is outside the sheet.'); setSprite3DFrame(mesh, y * state.hframes + x); }
export function getSprite3DItemRect(mesh: Mesh): Sprite3DRect { return itemRect(stateOf(mesh, 'get_item_rect')); }
export function sprite3DSignal(mesh: Mesh, name: 'frame_changed' | 'texture_changed'): GodotSignal<readonly []> { const state = stateOf(mesh, `Sprite3D.${name}`); return name === 'frame_changed' ? state.frameChanged.signal : state.textureChanged.signal; }
