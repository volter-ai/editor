/**
 * @godot-class SpriteBase3D
 * @role BINDING
 *
 * Godot 4.7's `SpriteBase3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh`: one quad of the texture
 * region its class draws (`draw_texture_rect`), `pixel_size` world units per texture pixel, centred
 * on the origin unless not `centered`, moved by `offset`, flipped by `flip_h`/`flip_v`, in the plane
 * across its `axis`. Its material is unshaded and blended (alpha cut disabled), tinted by `modulate`,
 * double-sided and depth-tested by the draw flags. The quad is redrawn in a deferred call after a
 * change (`_queue_redraw`). A billboard faces the camera (`BILLBOARD_ENABLED`) or turns about its Y
 * axis toward it (`BILLBOARD_FIXED_Y`) as it is drawn, its node's transform untouched. Fixed size,
 * the shaded flag and alpha cut modes are stored, not drawn.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, type Camera, Matrix4, type Mesh, MeshBasicMaterial, Quaternion, Vector3 as ThreeVector3 } from 'three';
import { godot_atlas_texture_region } from './atlas-texture';
import { godot_base_material_3d_model_map } from './base-material-3d';
import { construct as color, type Color } from './color';
import { godot_node_entity } from './node';
import { godot_message_queue_push } from './object';
import { get_height as heightOf, get_width as widthOf } from './texture-2d';
import { godot_visual_instance_3d_aabb } from './visual-instance-3d';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** `SpriteBase3D::DrawFlags` (`sprite_3d.h:44`): shaded, double-sided, no depth test, fixed size. */
const FLAG_DOUBLE_SIDED = 1;
const FLAG_DISABLE_DEPTH_TEST = 2;
const FLAG_MAX = 4;

/** The texture region a sprite class draws: its texture (an AtlasTexture's atlas region) or none. */
export type GodotSpriteSource = () => object | null;

interface SpriteBase3DState {
  centered: boolean;
  offset: Vector2;
  flipH: boolean;
  flipV: boolean;
  modulate: Color;
  pixelSize: number;
  axis: number;
  billboard: number;
  flags: boolean[];
  alphaCut: number;
  textureFilter: number;
  renderPriority: number;
  /** The frame's region of its texture, as the class chooses it, in pixels (`region` for a Sprite3D's frames). */
  region: (texture: object) => { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined;
  source: GodotSpriteSource;
  pending: boolean;
  aabb: { position: Vector3; size: Vector3 };
}

const SPRITES = new WeakMap<object, SpriteBase3DState>();

function stateOf(self: object, member: string): SpriteBase3DState {
  const state = SPRITES.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a SpriteBase3D`);
  return state;
}

const EMPTY = new BufferGeometry();

/** `draw_texture_rect` (`sprite_3d.cpp:100`): the quad of the source's region. */
function draw(mesh: Mesh, state: SpriteBase3DState): void {
  state.pending = false;
  const texture = state.source();
  const whole = texture === null ? null : godot_atlas_texture_region(texture);
  const own = texture === null ? undefined : state.region(texture);
  const region = whole === null ? null : own === undefined ? whole : { ...whole, x: whole.x + own.x, y: whole.y + own.y, width: own.width, height: own.height };
  if (region === null || region.width <= 0 || region.height <= 0) {
    mesh.geometry = EMPTY;
    state.aabb = { position: vector3(), size: vector3() };
    return;
  }
  const px = state.pixelSize;
  const x = state.offset.x - (state.centered ? region.width / 2 : 0);
  const y = state.offset.y - (state.centered ? region.height / 2 : 0);
  const [x0, x1, y0, y1] = [x * px, (x + region.width) * px, y * px, (y + region.height) * px];
  const atlasWidth = widthOf(region.texture) || region.width;
  const atlasHeight = heightOf(region.texture) || region.height;
  let [u0, u1] = [region.x / atlasWidth, (region.x + region.width) / atlasWidth];
  // The image's top row is its first (the map is uploaded unflipped): the quad's top is `v0`.
  let [vTop, vBottom] = [region.y / atlasHeight, (region.y + region.height) / atlasHeight];
  if (state.flipH) [u0, u1] = [u1, u0];
  if (state.flipV) [vTop, vBottom] = [vBottom, vTop];
  // The plane across `axis`: its x and y along the other two (`sprite_3d.cpp:189`).
  const place = (a: number, b: number): readonly [number, number, number] => (state.axis === 0 ? [0, b, -a] : state.axis === 1 ? [a, 0, -b] : [a, b, 0]);
  const corners = [place(x0, y0), place(x1, y0), place(x1, y1), place(x0, y1)];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(corners.flat()), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from([u0, vBottom, u1, vBottom, u1, vTop, u0, vTop]), 2));
  const normal = state.axis === 0 ? [1, 0, 0] : state.axis === 1 ? [0, 1, 0] : [0, 0, 1];
  geometry.setAttribute('normal', new BufferAttribute(Float32Array.from([...normal, ...normal, ...normal, ...normal]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
  mesh.geometry = geometry;
  const material = mesh.material as MeshBasicMaterial;
  material.map = godot_base_material_3d_model_map(region.texture as never, state.textureFilter, false);
  material.color.setRGB(state.modulate.r, state.modulate.g, state.modulate.b);
  material.opacity = state.modulate.a;
  material.transparent = true;
  material.side = state.flags[FLAG_DOUBLE_SIDED] === true ? DoubleSide : FrontSide;
  material.depthTest = state.flags[FLAG_DISABLE_DEPTH_TEST] !== true;
  material.needsUpdate = true;
  const axis = (index: number) => corners.map((corner) => corner[index] as number);
  const low = [0, 1, 2].map((index) => Math.min(...axis(index))) as [number, number, number];
  const high = [0, 1, 2].map((index) => Math.max(...axis(index))) as [number, number, number];
  state.aabb = { position: vector3(...low), size: vector3(high[0] - low[0], high[1] - low[1], high[2] - low[2]) };
}

const position = new ThreeVector3();
const rotation = new Quaternion();
const scale = new ThreeVector3();
const facing = new Quaternion();
const turned = new Matrix4();

/**
 * A billboard's world matrix for the camera it is drawn with (the material's billboard,
 * `BaseMaterial3D::BILLBOARD_*`, `material.cpp:1450`): its position and scale kept, its rotation the
 * camera's (enabled) or the camera's turn about Y (fixed Y). Set just before the draw, so the node's
 * own transform is untouched.
 */
function billboard(mesh: Mesh, state: SpriteBase3DState, camera: Camera): void {
  if (state.billboard === 0) return;
  mesh.matrixWorld.decompose(position, rotation, scale);
  camera.getWorldQuaternion(facing);
  if (state.billboard === 2) {
    const forward = new ThreeVector3(0, 0, 1).applyQuaternion(facing);
    facing.setFromAxisAngle(new ThreeVector3(0, 1, 0), Math.atan2(forward.x, forward.z));
  }
  mesh.matrixWorld.copy(turned.compose(position, facing, scale));
}

/**
 * Queues the sprite's redraw (`_queue_redraw`, `sprite_3d.cpp:240`): one deferred draw after changes.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:240
 */
export function godot_sprite_base_3d_redraw(self: object): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'redraw');
  if (state.pending) return;
  state.pending = true;
  godot_message_queue_push(entity, () => draw(entity, state));
}

/**
 * Makes `entity` a sprite drawing what `source` gives (its class's texture or frame), the region
 * of it `region` gives; defaults as `SpriteBase3D::SpriteBase3D` (`sprite_3d.cpp:760`).
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:760
 */
export function godot_sprite_base_3d_mount(
  entity: Mesh,
  source: GodotSpriteSource,
  region: SpriteBase3DState['region'] = () => undefined,
): void {
  const state: SpriteBase3DState = {
    centered: true,
    offset: vector2(),
    flipH: false,
    flipV: false,
    modulate: color(1, 1, 1, 1),
    pixelSize: f32(0.01),
    axis: 2,
    billboard: 0,
    flags: Array.from({ length: FLAG_MAX }, (_, flag) => flag === FLAG_DOUBLE_SIDED),
    alphaCut: 0,
    textureFilter: 3,
    renderPriority: 0,
    region,
    source,
    pending: false,
    aabb: { position: vector3(), size: vector3() },
  };
  SPRITES.set(entity, state);
  entity.onBeforeRender = (_renderer, _scene, camera) => billboard(entity, state, camera);
  entity.material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  entity.geometry = EMPTY;
  godot_visual_instance_3d_aabb(entity, () => state.aabb);
  godot_sprite_base_3d_redraw(entity);
}

function setter<K extends keyof SpriteBase3DState>(key: K, member: string) {
  return (self: object, value: SpriteBase3DState[K]): void => {
    const state = stateOf(self, member);
    if (state[key] === value) return;
    state[key] = value;
    godot_sprite_base_3d_redraw(self);
  };
}

/**
 * @godot SpriteBase3D.set_centered
 * @source scene/3d/sprite_3d.cpp:262
 */
export function set_centered(self: object, centered: boolean): void {
  setter('centered', 'set_centered')(self, centered);
}

/**
 * @godot SpriteBase3D.is_centered
 * @source scene/3d/sprite_3d.cpp:270
 */
export function is_centered(self: object): boolean {
  return stateOf(self, 'is_centered').centered;
}

/**
 * @godot SpriteBase3D.set_offset
 * @source scene/3d/sprite_3d.cpp:274
 */
export function set_offset(self: object, offset: Vector2): void {
  setter('offset', 'set_offset')(self, offset);
}

/**
 * @godot SpriteBase3D.get_offset
 * @source scene/3d/sprite_3d.cpp:282
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot SpriteBase3D.set_flip_h
 * @source scene/3d/sprite_3d.cpp:286
 */
export function set_flip_h(self: object, flip: boolean): void {
  setter('flipH', 'set_flip_h')(self, flip);
}

/**
 * @godot SpriteBase3D.is_flipped_h
 * @source scene/3d/sprite_3d.cpp:294
 */
export function is_flipped_h(self: object): boolean {
  return stateOf(self, 'is_flipped_h').flipH;
}

/**
 * @godot SpriteBase3D.set_flip_v
 * @source scene/3d/sprite_3d.cpp:298
 */
export function set_flip_v(self: object, flip: boolean): void {
  setter('flipV', 'set_flip_v')(self, flip);
}

/**
 * @godot SpriteBase3D.is_flipped_v
 * @source scene/3d/sprite_3d.cpp:306
 */
export function is_flipped_v(self: object): boolean {
  return stateOf(self, 'is_flipped_v').flipV;
}

/**
 * @godot SpriteBase3D.set_modulate
 * @source scene/3d/sprite_3d.cpp:310
 */
export function set_modulate(self: object, modulate: Color): void {
  setter('modulate', 'set_modulate')(self, modulate);
}

/**
 * @godot SpriteBase3D.get_modulate
 * @source scene/3d/sprite_3d.cpp:320
 */
export function get_modulate(self: object): Color {
  return stateOf(self, 'get_modulate').modulate;
}

/**
 * @godot SpriteBase3D.set_pixel_size
 * @source scene/3d/sprite_3d.cpp:340
 */
export function set_pixel_size(self: object, pixel_size: number): void {
  setter('pixelSize', 'set_pixel_size')(self, f32(pixel_size));
}

/**
 * @godot SpriteBase3D.get_pixel_size
 * @source scene/3d/sprite_3d.cpp:348
 */
export function get_pixel_size(self: object): number {
  return stateOf(self, 'get_pixel_size').pixelSize;
}

/**
 * An axis outside `0..2` fails.
 *
 * @godot SpriteBase3D.set_axis
 * @source scene/3d/sprite_3d.cpp:352
 */
export function set_axis(self: object, axis: number): void {
  if (axis < 0 || axis > 2) return;
  setter('axis', 'set_axis')(self, axis);
}

/**
 * @godot SpriteBase3D.get_axis
 * @source scene/3d/sprite_3d.cpp:363
 */
export function get_axis(self: object): number {
  return stateOf(self, 'get_axis').axis;
}

/**
 * @godot SpriteBase3D.set_draw_flag
 * @source scene/3d/sprite_3d.cpp:392
 */
export function set_draw_flag(self: object, flag: number, enabled: boolean): void {
  if (flag < 0 || flag >= FLAG_MAX) return;
  const state = stateOf(self, 'set_draw_flag');
  if (state.flags[flag] === enabled) return;
  state.flags[flag] = enabled;
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot SpriteBase3D.get_draw_flag
 * @source scene/3d/sprite_3d.cpp:403
 */
export function get_draw_flag(self: object, flag: number): boolean {
  return stateOf(self, 'get_draw_flag').flags[flag] === true;
}

/**
 * @godot SpriteBase3D.set_billboard_mode
 * @source scene/3d/sprite_3d.cpp:430
 */
export function set_billboard_mode(self: object, mode: number): void {
  stateOf(self, 'set_billboard_mode').billboard = mode;
}

/**
 * @godot SpriteBase3D.get_billboard_mode
 * @source scene/3d/sprite_3d.cpp:438
 */
export function get_billboard_mode(self: object): number {
  return stateOf(self, 'get_billboard_mode').billboard;
}

/**
 * Stored; the material blends whatever the mode.
 *
 * @godot SpriteBase3D.set_alpha_cut_mode
 * @source scene/3d/sprite_3d.cpp:408
 */
export function set_alpha_cut_mode(self: object, mode: number): void {
  stateOf(self, 'set_alpha_cut_mode').alphaCut = mode;
}

/**
 * @godot SpriteBase3D.set_texture_filter
 * @source scene/3d/sprite_3d.cpp:472
 */
export function set_texture_filter(self: object, filter: number): void {
  setter('textureFilter', 'set_texture_filter')(self, filter);
}

/**
 * @godot SpriteBase3D.set_render_priority
 * @source scene/3d/sprite_3d.cpp:328
 */
export function set_render_priority(self: object, priority: number): void {
  stateOf(self, 'set_render_priority').renderPriority = priority;
}

/**
 * The props every sprite class states (`sprite_3d.cpp:700`), by the setters above.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:700
 */
export function godot_sprite_base_3d_props(): (readonly [string, (entity: Mesh, value: never) => void])[] {
  return [
    ['centered', (entity, value: boolean) => set_centered(entity, value)],
    ['offset', (entity, value: readonly [number, number]) => set_offset(entity, vector2(...value))],
    ['flipH', (entity, value: boolean) => set_flip_h(entity, value)],
    ['flipV', (entity, value: boolean) => set_flip_v(entity, value)],
    ['modulate', (entity, value: readonly [number, number, number, number]) => set_modulate(entity, color(...value))],
    ['pixelSize', (entity, value: number) => set_pixel_size(entity, value)],
    ['axis', (entity, value: number) => set_axis(entity, value)],
    ['billboard', (entity, value: number) => set_billboard_mode(entity, value)],
    ['shaded', (entity, value: boolean) => set_draw_flag(entity, 0, value)],
    ['doubleSided', (entity, value: boolean) => set_draw_flag(entity, 1, value)],
    ['noDepthTest', (entity, value: boolean) => set_draw_flag(entity, 2, value)],
    ['fixedSize', (entity, value: boolean) => set_draw_flag(entity, 3, value)],
    ['alphaCut', (entity, value: number) => set_alpha_cut_mode(entity, value)],
    ['textureFilter', (entity, value: number) => set_texture_filter(entity, value)],
    ['renderPriority', (entity, value: number) => set_render_priority(entity, value)],
    // A GeometryInstance3D's: stored, never drawn by the web's renderer.
    ['transparency', () => undefined],
    ['castShadow', (entity, value: number) => void (entity.castShadow = value !== 0)],
    ['layers', (entity, value: number) => void (entity.layers.mask = value)],
  ];
}
