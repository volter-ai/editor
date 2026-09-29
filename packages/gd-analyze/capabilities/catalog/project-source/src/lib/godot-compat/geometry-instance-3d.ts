/**
 * @godot-class GeometryInstance3D
 * @role BINDING
 *
 * Godot 4.7's `GeometryInstance3D` shadow casting (`scene/3d/visual_instance_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto three's `castShadow`: an instance casts
 * unless its setting is `SHADOW_CASTING_SETTING_OFF`, and every instance receives shadows (the
 * scene shader samples them for every lit surface), which three enables with `receiveShadow`.
 * `SHADOWS_ONLY` (cast, not drawn) draws in three as well: three draws no shadow for a hidden
 * object. A scene's mesh states its casting as three's `castShadow`, which the setting reads back
 * until a script sets it.
 *
 * Its transparency is stored and read back; the Compatibility renderer (the web's) does not draw it.
 *
 * Its material override is drawn by the node's own drawing, which says how
 * (`godot_geometry_instance_3d_draws_override`): a particle system draws its instances with it.
 *
 * Its visibility range is the Compatibility renderer's cull (`renderer_scene_cull.cpp:2835`): a scene
 * writes it as `<GodotVisibilityRange>` around the node's element, three's `LOD`, which the renderer
 * updates for each camera before drawing.
 */

import { type BaseMaterial3D, godot_base_material_3d_of, godot_base_material_3d_three } from './base-material-3d';
import { godot_element_callsite } from './node';
import type { ShaderMaterial } from './shader-material';
import { godot_shader_material_of_three } from './spatial-material';
import { type ReactElement, type ReactNode, createElement, useLayoutEffect, useState } from 'react';
import { Box3, type Camera, LOD, type Material, type Object3D, Vector3 } from 'three';

const SETTING = new WeakMap<Object3D, number>();

/**
 * A geometry instance as Godot creates it: casting (`SHADOW_CASTING_SETTING_ON`,
 * `visual_instance_3d.h:124`) and receiving shadows.
 *
 * @godot GeometryInstance3D (protocol)
 * @source scene/3d/visual_instance_3d.h:124
 */
export function godot_geometry_instance_3d_mount(self: Object3D): void {
  self.castShadow = (SETTING.get(self) ?? 1) !== 0;
  self.receiveShadow = true;
}

/**
 * @godot GeometryInstance3D.set_cast_shadows_setting
 * @source scene/3d/visual_instance_3d.cpp:373
 */
export function set_cast_shadows_setting(self: Object3D, setting: number): void {
  SETTING.set(self, setting);
  self.castShadow = setting !== 0;
}

/**
 * @godot GeometryInstance3D.get_cast_shadows_setting
 * @source scene/3d/visual_instance_3d.cpp:379
 */
export function get_cast_shadows_setting(self: Object3D): number {
  // A scene states the setting in the node's `userData` beside three's `castShadow`.
  const stated = self.userData['cast_shadow'];
  return SETTING.get(self) ?? (typeof stated === 'number' ? stated : self.castShadow ? 1 : 0);
}

// --- Transparency: stored, and drawn as the web's renderer draws it.

const TRANSPARENCY = new WeakMap<object, number>();

/**
 * Clamped to [0, 1] (`visual_instance_3d.cpp:243`). The renderer's geometry instance keeps it as
 * `force_alpha = 1 - transparency` (`renderer_geometry_instance.cpp:110`), which only the
 * RenderingDevice renderers' shaders read; the Compatibility renderer, the web's
 * (`rendering_method.web`, `main/main.cpp:2644`), never reads it (`rasterizer_scene_gles3.cpp:1479`):
 * the geometry draws as its materials say, so three's material is left as it is.
 *
 * @godot GeometryInstance3D.set_transparency
 * @source scene/3d/visual_instance_3d.cpp:242
 */
export function set_transparency(self: object, transparency: number): void {
  TRANSPARENCY.set(self, stored(transparency));
}

/** A transparency as the node's `float` holds it, clamped (`visual_instance_3d.cpp:243`). */
function stored(transparency: number): number {
  const value = Math.fround(transparency);
  return Number.isNaN(value) ? value : Math.min(Math.max(value, 0), 1);
}

/**
 * @godot GeometryInstance3D.get_transparency
 * @source scene/3d/visual_instance_3d.cpp:248
 */
export function get_transparency(self: object): number {
  // A scene states it in the node's `userData` (0 until set, `visual_instance_3d.h:134`).
  const stated = (self as Partial<Object3D>).userData?.['transparency'];
  return TRANSPARENCY.get(self) ?? (typeof stated === 'number' ? stored(stated) : 0);
}

// --- GI mode: stored; the page has no baked light or dynamic GI for it to include the geometry in.

const GI_MODE = new WeakMap<object, number>();

/**
 * Whether baked light (a LightmapGI) or dynamic GI (VoxelGI, SDFGI) lights the geometry
 * (`instance_geometry_set_flag`); the page bakes and traces none, so only the mode is kept.
 *
 * @godot GeometryInstance3D.set_gi_mode
 * @source scene/3d/visual_instance_3d.cpp:472
 */
export function set_gi_mode(self: object, mode: number): void {
  GI_MODE.set(self, mode);
}

/**
 * `GI_MODE_STATIC` until set (`visual_instance_3d.h:142`).
 *
 * @godot GeometryInstance3D.get_gi_mode
 * @source scene/3d/visual_instance_3d.cpp:492
 */
export function get_gi_mode(self: object): number {
  return GI_MODE.get(self) ?? 1;
}

// --- Material override: drawn by the node's own drawing.

const OVERRIDE = new WeakMap<object, BaseMaterial3D | null>();
const DRAWS_OVERRIDE = new WeakMap<object, (material: Material | null) => void>();

/**
 * How a geometry instance draws its material override, as its drawing makes it (a particle system
 * draws its instances with it); the override it already holds is drawn at once.
 *
 * @godot GeometryInstance3D (protocol)
 * @source scene/3d/visual_instance_3d.cpp:218
 */
export function godot_geometry_instance_3d_draws_override(self: object, draw: (material: Material | null) => void): void {
  DRAWS_OVERRIDE.set(self, draw);
  const held = OVERRIDE.get(self);
  if (held !== undefined) draw(held === null ? null : godot_base_material_3d_three(held));
}

/**
 * The material every surface of the geometry draws with instead of its own. A node whose drawing
 * does not draw an override fails by name.
 *
 * @godot GeometryInstance3D.set_material_override
 * @source scene/3d/visual_instance_3d.cpp:218
 */
export function set_material_override(self: object, material: BaseMaterial3D | null): void {
  const draw = DRAWS_OVERRIDE.get(self);
  if (draw === undefined) throw new Error('godot-compat: GeometryInstance3D.set_material_override is not drawn for this node.');
  OVERRIDE.set(self, material);
  draw(material === null ? null : godot_base_material_3d_three(material));
}

/**
 * The override as a scene states it: three's material, drawn as it is, and read back as the Godot
 * material it is (`godot_base_material_3d_of`).
 *
 * @godot GeometryInstance3D (protocol)
 * @source scene/3d/visual_instance_3d.cpp:218
 */
export function godot_geometry_instance_3d_material_override(self: object, material: Material): void {
  const draw = DRAWS_OVERRIDE.get(self);
  if (draw === undefined) throw new Error('godot-compat: GeometryInstance3D.set_material_override is not drawn for this node.');
  OVERRIDE.set(self, godot_base_material_3d_of(material));
  draw(material);
}

/**
 * @godot GeometryInstance3D.get_material_override
 * @source scene/3d/visual_instance_3d.cpp:229
 */
export function get_material_override(self: object): BaseMaterial3D | ShaderMaterial | null {
  // A mesh the scene drew with a spatial shader's material reads it back as its ShaderMaterial.
  return OVERRIDE.get(self) ?? godot_shader_material_of_three((self as { readonly material?: unknown }).material) ?? null;
}

// --- Visibility range: `RendererSceneCull::_visibility_range_check`, as the Compatibility renderer draws it.

/** A geometry's visibility range (`visual_instance_3d.h:128`), in float. */
interface VisibilityRange {
  begin: number;
  end: number;
  beginMargin: number;
  endMargin: number;
  fadeMode: number;
  /** Whether it was drawn at the last check (`viewport_state`), for the hysteresis. */
  shown: boolean;
}

const RANGE = new WeakMap<object, VisibilityRange>();

function rangeOf(self: object): VisibilityRange {
  let range = RANGE.get(self);
  if (range === undefined) {
    range = { begin: 0, end: 0, beginMargin: 0, endMargin: 0, fadeMode: 0, shown: true };
    RANGE.set(self, range);
  }
  return range;
}

/**
 * @godot GeometryInstance3D.set_visibility_range_begin
 * @source scene/3d/visual_instance_3d.cpp:252
 */
export function set_visibility_range_begin(self: object, distance: number): void {
  rangeOf(self).begin = Math.fround(distance);
}

/**
 * @godot GeometryInstance3D.get_visibility_range_begin
 * @source scene/3d/visual_instance_3d.cpp:258
 */
export function get_visibility_range_begin(self: object): number {
  return rangeOf(self).begin;
}

/**
 * @godot GeometryInstance3D.set_visibility_range_end
 * @source scene/3d/visual_instance_3d.cpp:262
 */
export function set_visibility_range_end(self: object, distance: number): void {
  rangeOf(self).end = Math.fround(distance);
}

/**
 * @godot GeometryInstance3D.get_visibility_range_end
 * @source scene/3d/visual_instance_3d.cpp:268
 */
export function get_visibility_range_end(self: object): number {
  return rangeOf(self).end;
}

/**
 * @godot GeometryInstance3D.set_visibility_range_begin_margin
 * @source scene/3d/visual_instance_3d.cpp:272
 */
export function set_visibility_range_begin_margin(self: object, distance: number): void {
  rangeOf(self).beginMargin = Math.fround(distance);
}

/**
 * @godot GeometryInstance3D.get_visibility_range_begin_margin
 * @source scene/3d/visual_instance_3d.cpp:278
 */
export function get_visibility_range_begin_margin(self: object): number {
  return rangeOf(self).beginMargin;
}

/**
 * @godot GeometryInstance3D.set_visibility_range_end_margin
 * @source scene/3d/visual_instance_3d.cpp:282
 */
export function set_visibility_range_end_margin(self: object, distance: number): void {
  rangeOf(self).endMargin = Math.fround(distance);
}

/**
 * @godot GeometryInstance3D.get_visibility_range_end_margin
 * @source scene/3d/visual_instance_3d.cpp:288
 */
export function get_visibility_range_end_margin(self: object): number {
  return rangeOf(self).endMargin;
}

/**
 * @godot GeometryInstance3D.set_visibility_range_fade_mode
 * @source scene/3d/visual_instance_3d.cpp:292
 */
export function set_visibility_range_fade_mode(self: object, mode: number): void {
  rangeOf(self).fadeMode = mode;
}

/**
 * @godot GeometryInstance3D.get_visibility_range_fade_mode
 * @source scene/3d/visual_instance_3d.cpp:298
 */
export function get_visibility_range_fade_mode(self: object): number {
  return rangeOf(self).fadeMode;
}

/**
 * Whether the geometry is drawn with the camera at `distance` from the centre of its world bounds
 * (`_visibility_range_check`, `renderer_scene_cull.cpp:2835`, as the cull calls it: without the
 * fade check, `VIS_RANGE_CHECK`, `:2924`). The Compatibility renderer draws no fade (its geometry
 * instances never read `set_fade_range`), so with a fade mode the margins widen the range and the
 * cut is hard; without one they are hysteresis, narrowing the range while it is hidden.
 *
 * @godot GeometryInstance3D (protocol)
 * @source servers/rendering/renderer_scene_cull.cpp:2835
 */
export function godot_geometry_instance_3d_visibility_check(self: object, distance: number): boolean {
  const range = rangeOf(self);
  if (range.begin <= 0 && range.end <= 0) return true;
  let beginOffset = -range.beginMargin;
  let endOffset = range.endMargin;
  if (range.fadeMode === 0 && !range.shown) {
    beginOffset = -beginOffset;
    endOffset = -endOffset;
  }
  const d = Math.fround(distance);
  const shown = !((range.end > 0 && d > Math.fround(range.end + endOffset)) || (range.begin > 0 && d < Math.fround(range.begin + beginOffset)));
  range.shown = shown;
  return shown;
}

const bounds = new Box3();
const centre = new Vector3();
const eye = new Vector3();

/**
 * Three's `LOD`, which the renderer updates for each camera before drawing: each child is drawn by
 * its visibility range, measured from the camera to the centre of the child's world bounds
 * (`transformed_aabb.get_center()`, `renderer_scene_cull.cpp:1480`).
 */
class VisibilityRangeLOD extends LOD {
  override update(camera: Camera): void {
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const child of this.children) {
      bounds.setFromObject(child, true);
      if (bounds.isEmpty()) centre.setFromMatrixPosition(child.matrixWorld);
      else bounds.getCenter(centre);
      child.visible = godot_geometry_instance_3d_visibility_check(child, eye.distanceTo(centre));
    }
  }
}

/**
 * A geometry's visibility range as a scene writes it: `<GodotVisibilityRange begin={…}>` around the
 * node's element (a nameless container, which the Node protocol does not count), its props the
 * node's authored range, set on the node as it mounts.
 *
 * @godot GeometryInstance3D (protocol)
 * @source scene/3d/visual_instance_3d.cpp:252
 */
export function GodotVisibilityRange({ children, begin, beginMargin, end, endMargin, fadeMode, __volterOid }: GodotVisibilityRangeProps): ReactElement {
  const [lod] = useState(() => new VisibilityRangeLOD());
  godot_element_callsite(lod, __volterOid);
  // The node's element is the child R3F attached before this effect: its range set as it mounts.
  useLayoutEffect(() => {
    for (const child of lod.children) {
      if (begin !== undefined) set_visibility_range_begin(child, begin);
      if (beginMargin !== undefined) set_visibility_range_begin_margin(child, beginMargin);
      if (end !== undefined) set_visibility_range_end(child, end);
      if (endMargin !== undefined) set_visibility_range_end_margin(child, endMargin);
      if (fadeMode !== undefined) set_visibility_range_fade_mode(child, fadeMode);
    }
  }, [lod, begin, beginMargin, end, endMargin, fadeMode]);
  return createElement('primitive', { object: lod }, children);
}

/** A visibility range as a scene states it around a node's element. */
export interface GodotVisibilityRangeProps {
  readonly begin?: number;
  readonly beginMargin?: number;
  readonly end?: number;
  readonly endMargin?: number;
  readonly fadeMode?: number;
  readonly children?: ReactNode;
  /** The editor's callsite address (`godot_element_callsite`); its label is dropped. */
  readonly __volterOid?: string;
  readonly __volterLabel?: string;
}
