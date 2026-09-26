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
 * Its visibility range is the Compatibility renderer's cull (`renderer_scene_cull.cpp:2835`): a scene
 * writes it as `<GodotVisibilityRange>` around the node's element, three's `LOD`, which the renderer
 * updates for each camera before drawing.
 */

import { type ReactElement, type ReactNode, createElement, useLayoutEffect, useState } from 'react';
import { Box3, type Camera, LOD, type Object3D, Vector3 } from 'three';

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
  return SETTING.get(self) ?? (self.castShadow ? 1 : 0);
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
export function GodotVisibilityRange({ children, begin, beginMargin, end, endMargin, fadeMode }: GodotVisibilityRangeProps): ReactElement {
  const [lod] = useState(() => new VisibilityRangeLOD());
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
}
