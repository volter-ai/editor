/**
 * @godot-class SpriteBase3D
 * @role BINDING
 *
 * Godot 4.7's `SpriteBase3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh`: the node's quad is the
 * mesh's geometry and its 2D material the mesh's material. A change queues one redraw, deferred
 * (`_queue_redraw`, only inside the tree) or run as the node enters the tree (`_im_update`); the
 * subclass draws (`Sprite3D`, `AnimatedSprite3D` register their `_draw` and `get_item_rect`), and
 * `draw_texture_rect` writes the four vertices and UVs Godot writes, in float, and the AABB it sets.
 * A draw without a texture takes the mesh away (`set_base(RID())`): the geometry draws nothing.
 *
 * The quad as three draws it: Godot's triangles (0 1 2, 0 2 3) wind clockwise to face +Z
 * (`glFrontFace(GL_CW)`), three's counter-clockwise, so each triangle's last two indices are
 * exchanged; the texture is uploaded flipped (`godot_base_material_3d_scene_map`), so each UV's `v`
 * is `1 - v`. The material is `get_material_for_2d` (`scene/resources/material.cpp:2992`) as the
 * Compatibility renderer draws it: unshaded unless `shaded`; alpha-blended (no depth writes) while
 * `transparent`; culling the back unless `double_sided`; no depth test with `no_depth_test`; the
 * texture sampled with the node's filter, repeating only when a UV leaves 0..1. An alpha-blended or
 * depth-test-free sprite casts no shadow (its surface is in the alpha pass only,
 * `rasterizer_scene_gles3.cpp:257`).
 *
 * Bound: `pixel_size`, the draw flags and `get_item_rect`, what the corpus reaches. The other
 * properties keep Godot's defaults and are not bound: centred, no offset or flip, white `modulate`
 * (so the vertex colour Godot multiplies in is white), axis Z, no billboard, no alpha cut, the
 * linear-with-mipmaps filter, render priority 0.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, type Material, type Mesh, MeshBasicMaterial, MeshStandardMaterial, type Texture } from 'three';
import { godot_atlas_texture_of, godot_atlas_texture_rect_region, godot_atlas_texture_source } from './atlas-texture';
import { godot_base_material_3d_scene_map } from './base-material-3d';
import { get_cast_shadows_setting, godot_geometry_instance_3d_mount, set_cast_shadows_setting } from './geometry-instance-3d';
import { godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { godot_message_queue_push } from './object';
import type { GodotElementProp } from './react-lifecycle';
import { construct as rect2, type Rect2 } from './rect2';
import { get_height as texture_height, get_width as texture_width } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3 } from './vector3';
import { type AABB, godot_visual_instance_3d_aabb, set_layer_mask } from './visual-instance-3d';

const f32 = Math.fround;

/** `SpriteBase3D::DrawFlags` (`sprite_3d.h:43`). */
const FLAG_TRANSPARENT = 0;
const FLAG_SHADED = 1;
const FLAG_DOUBLE_SIDED = 2;
const FLAG_DISABLE_DEPTH_TEST = 3;
const FLAG_MAX = 5;
/** `TEXTURE_FILTER_LINEAR_WITH_MIPMAPS` (`sprite_3d.h:95`). */
const TEXTURE_FILTER = 3;

/** What a subclass draws and measures (`_draw`, `get_item_rect`, pure virtual in SpriteBase3D). */
export interface GodotSpriteBase3DClass {
  readonly draw: (entity: Mesh) => void;
  readonly itemRect: (entity: Mesh) => Rect2;
}

interface SpriteBase3DState {
  readonly subclass: GodotSpriteBase3DClass;
  pixelSize: number;
  readonly flags: boolean[];
  aabb: AABB;
  redrawNeeded: boolean;
  pendingUpdate: boolean;
  /** Whether the mesh is the node's base (`set_base(mesh)`), else `set_base(RID())`. */
  based: boolean;
  /** The four vertices and UVs `draw_texture_rect` last wrote, in Godot's order and convention. */
  vertices: readonly (readonly [number, number, number])[];
  uvs: readonly (readonly [number, number])[];
}

const SPRITES = new WeakMap<Mesh, SpriteBase3DState>();

function stateOf(self: object, member: string): SpriteBase3DState {
  const state = SPRITES.get(godot_node_entity(self) as Mesh);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a SpriteBase3D`);
  return state;
}

/** `_im_update` (`sprite_3d.cpp:429`): the queued redraw, run once. */
function imUpdate(entity: Mesh, state: SpriteBase3DState): void {
  if (!state.redrawNeeded) return;
  state.subclass.draw(entity);
  state.redrawNeeded = false;
  state.pendingUpdate = false;
}

/**
 * `_queue_redraw` (`sprite_3d.cpp:439`): a redraw is needed; inside the tree, one deferred call
 * runs it.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:439
 */
export function godot_sprite_base_3d_queue_redraw(self: object): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, '_queue_redraw');
  state.redrawNeeded = true;
  if (!is_inside_tree(entity)) return;
  if (state.pendingUpdate) return;
  state.pendingUpdate = true;
  godot_message_queue_push(entity, () => imUpdate(entity, state));
}

/**
 * Makes `entity` a SpriteBase3D with its defaults (`SpriteBase3D::SpriteBase3D`,
 * `sprite_3d.cpp:716`): transparent and double-sided, pixel size 0.01, a quad of four vertices at
 * the origin drawn with the 2D material; it draws what is queued as it enters the tree
 * (`NOTIFICATION_ENTER_TREE`, `:74`).
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:716
 */
export function godot_sprite_base_3d_mount(entity: Mesh, subclass: GodotSpriteBase3DClass): void {
  const zero = [0, 0, 0] as const;
  const state: SpriteBase3DState = {
    subclass,
    pixelSize: f32(0.01),
    flags: Array.from({ length: FLAG_MAX }, (_, flag) => flag === FLAG_TRANSPARENT || flag === FLAG_DOUBLE_SIDED),
    aabb: { position: vector3(), size: vector3() },
    redrawNeeded: false,
    pendingUpdate: false,
    based: true,
    vertices: [zero, zero, zero, zero],
    uvs: [[0, 0], [0, 0], [0, 0], [0, 0]],
  };
  SPRITES.set(entity, state);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  entity.geometry = geometry;
  entity.material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  // A GeometryInstance3D casts (`SHADOW_CASTING_SETTING_ON`) until its material says otherwise.
  godot_geometry_instance_3d_mount(entity);
  godot_visual_instance_3d_aabb(entity, () => state.aabb);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => imUpdate(entity, state));
}

/**
 * `set_base(RID())` or `set_base(mesh)` (`Sprite3D::_draw`, `sprite_3d.cpp:803`): whether the quad
 * draws.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:803
 */
export function godot_sprite_base_3d_set_based(self: object, based: boolean): void {
  const entity = godot_node_entity(self) as Mesh;
  stateOf(entity, 'set_base').based = based;
  entity.geometry.setDrawRange(0, based ? Infinity : 0);
}

/** `AABB::expand_to` (`core/math/aabb.h:356`) in single precision. */
function expandTo(aabb: AABB, x: number, y: number, z: number): AABB {
  const begin = [aabb.position.x, aabb.position.y, aabb.position.z];
  const end = [f32(aabb.position.x + aabb.size.x), f32(aabb.position.y + aabb.size.y), f32(aabb.position.z + aabb.size.z)];
  [x, y, z].forEach((value, axis) => {
    if (value < (begin[axis] as number)) begin[axis] = value;
    if (value > (end[axis] as number)) end[axis] = value;
  });
  const [bx, by, bz] = begin as [number, number, number];
  const [ex, ey, ez] = end as [number, number, number];
  return { position: vector3(bx, by, bz), size: vector3(f32(ex - bx), f32(ey - by), f32(ez - bz)) };
}

const times = (v: Vector2, s: number): readonly [number, number] => [f32(v.x * s), f32(v.y * s)];

/** The 2D material (`get_material_for_2d`, `material.cpp:2992`) as three draws it. */
function material(entity: Mesh, state: SpriteBase3DState, texture: Texture, repeat: boolean): void {
  const shaded = state.flags[FLAG_SHADED] === true;
  let target = entity.material as Material;
  if (shaded !== target instanceof MeshStandardMaterial) {
    target.dispose();
    // `specular` 0.5, `metallic` 0, `roughness` 1 (`sprite_3d.cpp:724`).
    target = shaded ? new MeshStandardMaterial({ metalness: 0, roughness: 1 }) : new MeshBasicMaterial();
    entity.material = target;
  }
  const transparent = state.flags[FLAG_TRANSPARENT] === true;
  const depthTest = state.flags[FLAG_DISABLE_DEPTH_TEST] !== true;
  target.transparent = transparent;
  target.depthWrite = !transparent;
  target.depthTest = depthTest;
  target.side = state.flags[FLAG_DOUBLE_SIDED] === true ? DoubleSide : FrontSide;
  const source = godot_atlas_texture_source(texture);
  const map = source === null ? null : godot_base_material_3d_scene_map(source, TEXTURE_FILTER, repeat);
  const drawn = target as MeshBasicMaterial;
  if (drawn.map !== map) {
    drawn.map = map;
    target.needsUpdate = true;
  }
  entity.castShadow = get_cast_shadows_setting(entity) !== 0 && !transparent && depthTest;
}

/**
 * `draw_texture_rect` (`sprite_3d.cpp:99`): `dst` of `texture` from `src`, as the quad's four
 * vertices (`pixel_size` world units per pixel, flipped to 3D's upward Y) and UVs over the texture
 * the renderer samples (an AtlasTexture's atlas), and the AABB they cover.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:99
 */
export function godot_sprite_base_3d_draw_texture_rect(self: object, texture: Texture, dst: Rect2, src: Rect2): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'draw_texture_rect');
  const region = godot_atlas_texture_rect_region(texture, dst, src);
  if (region === null) return;
  const { srcRect } = region;
  let finalRect = region.rect;
  if (finalRect.size.x === 0 || finalRect.size.y === 0) return;
  // (1) The rectangle's place within `dst`, mirrored in Y.
  finalRect = rect2(
    finalRect.position.x,
    f32(f32(dst.position.y + dst.size.y) - f32(f32(finalRect.position.y + finalRect.size.y) - dst.position.y)),
    finalRect.size.x,
    finalRect.size.y,
  );
  const px = state.pixelSize;
  const p = finalRect.position;
  const s = finalRect.size;
  // (2) Vertices 0 1 2 3: top-left, top-right, bottom-right, bottom-left in 3D.
  const vertices2 = [
    times(vector2(p.x, f32(p.y + s.y)), px),
    times(vector2(f32(p.x + s.x), f32(p.y + s.y)), px),
    times(vector2(f32(p.x + s.x), p.y), px),
    times(p, px),
  ];
  // An AtlasTexture's UVs divide by its atlas's size (`sprite_3d.cpp:143`).
  const atlas = godot_atlas_texture_of(texture);
  const sized = atlas === undefined ? texture : atlas.atlas;
  const tw = sized === null ? 0 : texture_width(sized);
  const th = sized === null ? 0 : texture_height(sized);
  const sp = srcRect.position;
  const ss = srcRect.size;
  const uv = (x: number, y: number): readonly [number, number] => [f32(x / tw), f32(y / th)];
  // (3) UVs a b c d, in the vertices' order.
  const uvs = [uv(sp.x, sp.y), uv(f32(sp.x + ss.x), sp.y), uv(f32(sp.x + ss.x), f32(sp.y + ss.y)), uv(sp.x, f32(sp.y + ss.y))];
  const [u0, , u2] = uvs as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const repeat = Math.min(u0[0], u2[0]) < 0 || Math.min(u0[1], u2[1]) < 0 || Math.max(u0[0], u2[0]) > 1 || Math.max(u0[1], u2[1]) > 1;
  // Axis Z: x is 2D's x, y is 2D's y (`x_axis = 0`, `y_axis = 1`).
  const vertices = vertices2.map(([x, y]) => [x, y, 0] as const);
  let aabb: AABB = { position: vector3(...(vertices[0] as readonly [number, number, number])), size: vector3() };
  for (const vertex of vertices.slice(1)) aabb = expandTo(aabb, ...vertex);
  state.vertices = vertices;
  state.uvs = uvs;
  state.aabb = aabb;
  const geometry = entity.geometry;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const uvAttribute = geometry.getAttribute('uv') as BufferAttribute;
  vertices.forEach(([x, y, z], i) => position.setXYZ(i, x, y, z));
  uvs.forEach(([u, v], i) => uvAttribute.setXY(i, u, 1 - v));
  position.needsUpdate = true;
  uvAttribute.needsUpdate = true;
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
  material(entity, state, texture, repeat);
}

/**
 * The quad as Godot last wrote it: its four vertices and UVs in Godot's order and UV convention, and
 * whether it draws.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:235
 */
export function godot_sprite_base_3d_surface(self: object): {
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly uvs: readonly (readonly [number, number])[];
  readonly based: boolean;
} {
  const state = stateOf(self, 'surface');
  return { vertices: state.vertices, uvs: state.uvs, based: state.based };
}

/**
 * Where a subclass draws a texture of `size`: the node's offset, less half the size when centred
 * (`Sprite3D::_draw`, `sprite_3d.cpp:823`); centred with no offset, as the class starts.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:823
 */
export function godot_sprite_base_3d_origin(size: Vector2): Vector2 {
  return vector2(f32(0 - f32(size.x / 2)), f32(0 - f32(size.y / 2)));
}

/**
 * @godot SpriteBase3D.set_pixel_size
 * @source scene/3d/sprite_3d.cpp:401
 */
export function set_pixel_size(self: object, pixel_size: number): void {
  const state = stateOf(self, 'set_pixel_size');
  const value = f32(pixel_size);
  if (state.pixelSize === value) return;
  state.pixelSize = value;
  godot_sprite_base_3d_queue_redraw(self);
}

/**
 * @godot SpriteBase3D.get_pixel_size
 * @source scene/3d/sprite_3d.cpp:410
 */
export function get_pixel_size(self: object): number {
  return stateOf(self, 'get_pixel_size').pixelSize;
}

/**
 * A flag outside `0..4` fails.
 *
 * @godot SpriteBase3D.set_draw_flag
 * @source scene/3d/sprite_3d.cpp:518
 */
export function set_draw_flag(self: object, flag: number, enabled: boolean): void {
  if (flag < 0 || flag >= FLAG_MAX) return;
  const state = stateOf(self, 'set_draw_flag');
  if (state.flags[flag] === enabled) return;
  state.flags[flag] = enabled;
  godot_sprite_base_3d_queue_redraw(self);
}

/**
 * A flag outside `0..4` fails and reads false.
 *
 * @godot SpriteBase3D.get_draw_flag
 * @source scene/3d/sprite_3d.cpp:529
 */
export function get_draw_flag(self: object, flag: number): boolean {
  if (flag < 0 || flag >= FLAG_MAX) return false;
  return stateOf(self, 'get_draw_flag').flags[flag] === true;
}

/**
 * The subclass's rectangle (`Sprite3D::get_item_rect`, `AnimatedSprite3D::get_item_rect`).
 *
 * @godot SpriteBase3D.get_item_rect
 * @source scene/3d/sprite_3d.h:172
 */
export function get_item_rect(self: object): Rect2 {
  const entity = godot_node_entity(self) as Mesh;
  return stateOf(entity, 'get_item_rect').subclass.itemRect(entity);
}


/**
 * The SpriteBase3D properties a scene states on a sprite's element, by the prop that states each:
 * `pixel_size`, the draw flags a scene writes as `transparent`, `shaded`, `double_sided` and
 * `no_depth_test` (`ADD_PROPERTYI`, `sprite_3d.cpp:690`), and the GeometryInstance3D and
 * VisualInstance3D `cast_shadow` and `layers`.
 *
 * @godot SpriteBase3D (protocol)
 * @source scene/3d/sprite_3d.cpp:690
 */
export function godot_sprite_base_3d_props(): readonly (readonly [string, GodotElementProp<Mesh>])[] {
  return [
    ['pixelSize', (entity, value: number) => set_pixel_size(entity, value)],
    ['transparent', (entity, value: boolean) => set_draw_flag(entity, FLAG_TRANSPARENT, value)],
    ['shaded', (entity, value: boolean) => set_draw_flag(entity, FLAG_SHADED, value)],
    ['doubleSided', (entity, value: boolean) => set_draw_flag(entity, FLAG_DOUBLE_SIDED, value)],
    ['noDepthTest', (entity, value: boolean) => set_draw_flag(entity, FLAG_DISABLE_DEPTH_TEST, value)],
    ['castShadow', (entity, value: number) => set_cast_shadows_setting(entity, value)],
    ['layers', (entity, value: number) => set_layer_mask(entity, value)],
  ];
}
