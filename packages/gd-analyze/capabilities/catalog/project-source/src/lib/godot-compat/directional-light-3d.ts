/**
 * @godot-class DirectionalLight3D
 * @role BINDING
 *
 * Godot 4.7's `DirectionalLight3D` (`scene/3d/light_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `DirectionalLight`. Godot's
 * directional light shines along its node's -Z (`rasterizer_scene_gles3.cpp:1741`); three's shines
 * from the light toward its target, so the light's target is a child one unit down its -Z.
 */

import { DirectionalLight, Object3D, Vector3 } from 'three';
import { godot_camera_3d_of_viewport } from './camera-3d';
import { type GodotLight3DAuthored, godot_light_3d_authored, godot_light_3d_mount, godot_light_3d_sky_mode } from './light-3d';
import { godot_node_duplicate_state } from './node';

/**
 * A directional light as `DirectionalLight3D()` creates it (`light_3d.cpp:612`): shadow max
 * distance 100, fade start 0.8, normal bias 2, intensity 100000 and specular 1 over Light3D's
 * parameters, its target along -Z.
 *
 * @godot DirectionalLight3D (protocol)
 * @source scene/3d/light_3d.cpp:612
 */
export function godot_directional_light_3d_mount(self: DirectionalLight): void {
  godot_directional_light_3d_aim(self);
  godot_light_3d_mount(self);
}

const AIMED = new WeakSet<DirectionalLight>();

/**
 * Aims three's light along the node's -Z, the direction Godot's shines in: its target is a
 * nameless child (not a node) one unit down -Z, added once however often R3F reports an update.
 *
 * @godot DirectionalLight3D (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1741
 */
export function godot_directional_light_3d_aim(self: DirectionalLight): void {
  if (AIMED.has(self)) return;
  AIMED.add(self);
  const target = new Object3D();
  target.position.set(0, 0, -1);
  self.add(target);
  self.target = target;
  followView(self);
}

/**
 * How far around what the camera sees the shadow reaches sharply: Godot's split shadow keeps its
 * nearest splits (10% and 20% of the shadow's max distance, `light_3d.cpp:499`) at full resolution,
 * which one map over the whole distance would blur; the map follows the view instead.
 */
const FOLLOW_REACH = 20;
const VIEW = new Vector3();
const AHEAD = new Vector3();
const FROM = new Vector3();
const TO = new Vector3();

/**
 * The light's shadow is drawn around what the viewport's camera sees, as three's own scenes keep a
 * directional shadow sharp: before each shadow render its box is centred just ahead of the camera,
 * along the light's own direction.
 */
function followView(light: DirectionalLight): void {
  const shadow = light.shadow;
  const base = shadow.updateMatrices.bind(shadow);
  shadow.updateMatrices = (lit) => {
    let viewport: Object3D | null = light.parent;
    while (viewport !== null && (viewport as { readonly isScene?: boolean }).isScene !== true) viewport = viewport.parent;
    const view = viewport === null ? null : godot_camera_3d_of_viewport(viewport);
    if (view === null) {
      base(lit);
      return;
    }
    const box = shadow.camera;
    if (box.right !== FOLLOW_REACH) {
      Object.assign(box, { left: -FOLLOW_REACH, right: FOLLOW_REACH, bottom: -FOLLOW_REACH, top: FOLLOW_REACH });
      box.updateProjectionMatrix();
    }
    light.getWorldPosition(FROM);
    light.target.getWorldPosition(TO);
    const direction = TO.sub(FROM).normalize();
    const centre = view.getWorldPosition(VIEW).addScaledVector(view.getWorldDirection(AHEAD), FOLLOW_REACH * 0.75);
    const own = light.matrixWorld.elements.slice(12, 15);
    const aimed = light.target.matrixWorld.elements.slice(12, 15);
    light.matrixWorld.setPosition(centre.x - direction.x, centre.y - direction.y, centre.z - direction.z);
    light.target.matrixWorld.setPosition(centre);
    base(lit);
    light.matrixWorld.setPosition(own[0] as number, own[1] as number, own[2] as number);
    light.target.matrixWorld.setPosition(aimed[0] as number, aimed[1] as number, aimed[2] as number);
  };
}

/**
 * A scene's directional light as it mounts: aimed along -Z, and its Godot state the values the
 * scene authors (`godot_light_3d_authored`, and whether its splits blend).
 *
 * @godot DirectionalLight3D (protocol)
 * @source scene/3d/light_3d.cpp:612
 */
export function godot_directional_light_3d_authored_prop(authored: GodotLight3DAuthored & { readonly blendSplits?: boolean }): (self: DirectionalLight) => void {
  return (self) => {
    godot_directional_light_3d_aim(self);
    if (!AUTHORED.has(self)) {
      AUTHORED.add(self);
      godot_light_3d_authored(self, authored);
      if (authored.blendSplits !== undefined) BLEND_SPLITS.set(self, authored.blendSplits);
    }
  };
}

const AUTHORED = new WeakSet<DirectionalLight>();

const SHADOW_MODE = new WeakMap<DirectionalLight, number>();
const BLEND_SPLITS = new WeakMap<DirectionalLight, boolean>();

// `duplicate` copies the shadow mode and split blending; the copy is aimed through a target of its own.
godot_node_duplicate_state((from, to) => {
  if (!(to instanceof DirectionalLight)) return;
  const copy = to;
  const mode = SHADOW_MODE.get(from as DirectionalLight);
  if (mode !== undefined) SHADOW_MODE.set(copy, mode);
  const blend = BLEND_SPLITS.get(from as DirectionalLight);
  if (blend !== undefined) BLEND_SPLITS.set(copy, blend);
  godot_directional_light_3d_aim(copy);
});

/**
 * Three draws a directional light's shadow into one orthographic map, Godot's
 * `SHADOW_ORTHOGONAL`; the PSSM split modes draw into that one map as well.
 *
 * @godot DirectionalLight3D.set_shadow_mode
 * @source scene/3d/light_3d.cpp:531
 */
export function set_shadow_mode(self: DirectionalLight, mode: number): void {
  SHADOW_MODE.set(self, mode);
}

/**
 * `SHADOW_PARALLEL_4_SPLITS` until set (`light_3d.cpp:620`).
 *
 * @godot DirectionalLight3D.get_shadow_mode
 * @source scene/3d/light_3d.cpp:537
 */
export function get_shadow_mode(self: DirectionalLight): number {
  return SHADOW_MODE.get(self) ?? 2;
}

/**
 * Stored: blending blurs the seams between the PSSM splits' maps (`light_3d.cpp:541`), and three
 * draws the light's shadow into one map that follows the view (`followView`), which has no splits
 * to blend.
 *
 * @godot DirectionalLight3D.set_blend_splits
 * @source scene/3d/light_3d.cpp:541
 */
export function set_blend_splits(self: DirectionalLight, enabled: boolean): void {
  BLEND_SPLITS.set(self, enabled);
}

/**
 * Off until set (`light_3d.cpp:621`).
 *
 * @godot DirectionalLight3D.is_blend_splits_enabled
 * @source scene/3d/light_3d.cpp:546
 */
export function is_blend_splits_enabled(self: DirectionalLight): boolean {
  return BLEND_SPLITS.get(self) ?? false;
}

/**
 * @godot DirectionalLight3D.set_sky_mode
 * @source scene/3d/light_3d.cpp:550
 */
export function set_sky_mode(self: DirectionalLight, mode: number): void {
  godot_light_3d_sky_mode(self, mode);
}

/**
 * @godot DirectionalLight3D.get_sky_mode
 * @source scene/3d/light_3d.cpp:555
 */
export function get_sky_mode(self: DirectionalLight): number {
  return godot_light_3d_sky_mode(self);
}
