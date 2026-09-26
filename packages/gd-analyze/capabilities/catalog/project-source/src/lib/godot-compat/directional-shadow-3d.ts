/**
 * Godot 3's camera-fitted directional shadow, over the engine's own fitter.
 *
 * ## The defect this exists for
 *
 * Godot fits a `DirectionalLight`'s shadow to the ACTIVE CAMERA every frame:
 * `directional_shadow_max_distance` is a distance measured from the camera, and the split volumes
 * are re-derived from the camera frustum each time the light is rendered. Three has no such fit —
 * `DirectionalLightShadow` is an ordinary `OrthographicCamera` parented to the light, and it sits
 * wherever the light's own authored transform puts it, forever.
 *
 * A translation that carries only the light's transform therefore carries a shadow box centred on
 * the light's authored ORIGIN. On the measured platformer that origin is `(0, 0, 0)` and the box is
 * +/-20, so every caster past x ~ 20 has no shadow at all while the level runs out to x ~ 55 — the
 * game visibly loses its shadows as the player walks right, which no amount of bias or map size
 * fixes because the geometry is outside the frustum.
 *
 * ## What is the ENGINE's, and what is Godot's
 *
 * The GEOMETRY is not Godot's and no longer lives here: the frustum-slice bounding sphere, the
 * texel-quantized centre snap in the light's basis, and the fitted texel size are
 * `@vgai/engine/render/directional-shadow-fit`'s `fitDirectionalShadowToCamera` — standard
 * shadow-mapping technique that every travelling camera needs, first-party or ported. Read that
 * header for why the box is a SPHERE around the slice (its radius is the camera's fov and aspect,
 * not `maxDistance / 2`) and why the snap is what stops shadow edges crawling.
 *
 * What stays here is Godot protocol, and only that:
 *
 *  - **the marker and the authored properties.** `directional_shadow_max_distance` and
 *    `directional_shadow_normal_bias` ride on the emitted `<directionalLight>` as
 *    {@link GodotDirectionalShadowData}, and the system discovers lights by traversing for it.
 *  - **Godot's ORTHOGONAL-camera rule.** `_light_instance_update_shadow` ignores
 *    `directional_shadow_max_distance` entirely under an orthographic game camera ("its impractical
 *    (and leads to unwanted behaviors) to set max distance in orthogonal camera") and shadows the
 *    camera's whole range. That is a Godot decision, not a shadow-mapping one, so it is applied
 *    HERE, as the distance this lane hands the fitter.
 *  - **the normal-bias calibration.** Three's `shadow.normalBias` is a RECEIVER-side offset in world
 *    units; Godot 3.6's `directional_shadow_normal_bias` is a slope-scaled CASTER-depth offset, also
 *    in world units (`render_shadow` -> `z_slope_scale`, applied in `scene.glsl`'s depth pass).
 *    There is no exact unit translation between the two, so `authored x one fitted texel` is a
 *    MEASURED calibration of this lane's — per-texel-unit semantics are Godot 4's, not 3.6's — and
 *    it belongs beside the protocol rather than in a general fitter.
 *  - **the light NODE motion**, below.
 *
 * The DEPTH range (`shadow.camera.near`/`far`) stays the emitter's, at Godot's own +/-maxDistance:
 * it is what `shadow.bias` is normalized against (`translate/shadow.ts`), and it is already deep
 * enough for the fitted box.
 *
 * ## The measurement that sized the box
 *
 * Measured 2026-08-14 against the real 3.6 binary through the MATCH rung, at a fixed half-extent:
 *
 *   half-extent | ledge/wall-shaded | closeup/background | ledge mean |delta| | ledge FORM r
 *   20 (old)    | +18.4 bytes       | +9.8 bytes         | 7.9                | 0.967
 *   40          |  +0.2             | +0.3               | 4.4                | 0.983
 *   this fit    |  +0.2             | +0.3               | 3.9                | 0.987
 *
 * The two rejected explanations are recorded because each was a live hypothesis: shadow REACH is
 * not the mechanism (pushing the light's depth range from +/-40 to +/-400 changed not one byte),
 * and neither is the ambient term on shadowed surfaces (with the box sized correctly, every shaded
 * region lands within 0.3 bytes of Godot without any ambient change). Nor is it cascade count: the
 * measured demo authors `directional_shadow_mode = 0`, i.e. Godot renders ONE split here too.
 *
 * ## The thing that moves is the light NODE
 *
 * That is deliberate rather than incidental:
 *
 *  - Three derives the shadow camera's placement FROM the light every frame
 *    (`WebGLShadowMap` -> `LightShadow.updateMatrices`, which copies the light's world position and
 *    looks at `light.target`'s world position), so writing `shadow.camera.position` directly would
 *    be overwritten before the depth pass ever ran.
 *  - A `DirectionalLight`'s position has no other rendering effect in Three: direction is
 *    `position -> target`, and the translated light's target is a CHILD object one unit down its own
 *    local -Z, so it translates with the light and the direction is unchanged by definition.
 *
 * The authored position is captured at construction and restored on `dispose()`, because the light
 * belongs to the game's own scene and this helper only borrows it for the life of the mount.
 */
import {
  type DirectionalShadowFit,
  fitDirectionalShadowToCamera,
} from '@volter/threejs-runtime/render/directional-shadow-fit';
import {
  type Camera,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  Quaternion,
  type Scene,
  type Vector2,
  type Vector3,
} from 'three';

export const GODOT_DIRECTIONAL_SHADOW_DATA = 'godotDirectionalShadow' as const;

/** What the translated `<directionalLight>` records for its own shadow fit. */
export interface GodotDirectionalShadowData {
  /** `directional_shadow_max_distance` — the view depth the shadow covers, from the camera. */
  readonly maxDistance: number;
  /** `directional_shadow_normal_bias`, carried as authored. The runtime converts it to three's
   *  world-unit `shadow.normalBias` as `authored x one fitted shadow texel` — the lane's measured
   *  calibration (see the header: Godot 3.6's own mechanism is a caster-depth offset, so no exact
   *  unit translation exists) — which needs the fitted texel size and cannot be done until the box
   *  exists. */
  readonly normalBiasTexels: number;
}

export interface GodotDirectionalShadowSystem {
  /** Re-fit every discovered light's shadow box to `camera`, for this frame. */
  update(camera: Camera): void;
  /** Put every light back at its authored position. */
  dispose(): void;
}

export function isGodotDirectionalShadowData(value: unknown): value is GodotDirectionalShadowData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Partial<GodotDirectionalShadowData>;
  return typeof data.maxDistance === 'number' && typeof data.normalBiasTexels === 'number';
}

/**
 * Godot's own `SHADOW_ORTHOGONAL` fit: the engine's frustum-slice fitter, handed the distance
 * GODOT would shadow.
 *
 * The one Godot decision in the geometry is the orthographic-camera rule — Godot's own
 * `_light_instance_update_shadow` drops `directional_shadow_max_distance` there and shadows the
 * whole camera range — so it is applied as the distance rather than as a branch inside the fitter,
 * which stays projection-driven for both camera kinds.
 */
export function fitGodotDirectionalShadow(
  camera: Camera,
  lightOrientation: Quaternion,
  maxDistance: number,
  mapSize: number,
): DirectionalShadowFit {
  const view = camera as Camera & { far?: number; isOrthographicCamera?: boolean };
  const shadowDistance =
    view.isOrthographicCamera === true && typeof view.far === 'number' ? view.far : maxDistance;
  return fitDirectionalShadowToCamera(camera, lightOrientation, shadowDistance, mapSize);
}

interface FollowedLight {
  readonly light: Object3D;
  readonly data: GodotDirectionalShadowData;
  readonly authoredPosition: Vector3;
}

/** The half of a three light this helper writes — narrowed here rather than importing
 *  `DirectionalLight`, because the traversal that finds it only knows it is an `Object3D`. */
interface ShadowCastingLight extends Object3D {
  shadow?: {
    camera: OrthographicCamera;
    mapSize: Vector2;
    normalBias: number;
  };
}

/**
 * Discover every translated directional light in `scene` and re-fit its shadow box each frame.
 *
 * Discovery is by traversal, on the same `userData` marker the ReflectionProbe helper uses and for
 * the same reason: the light is authored inside whichever scene component owns it, several
 * instanced scenes down from the world that drives the frame, and a marker keeps the world from
 * having to know the shape of the tree below it. Lights that appear later (a scene reload, a
 * spawned scene) are picked up on the next `update`.
 */
export function createGodotDirectionalShadowSystem(scene: Scene): GodotDirectionalShadowSystem {
  const followed = new Map<Object3D, FollowedLight>();
  const lightOrientation = new Quaternion();
  const parentInverse = new Matrix4();

  const discover = (): void => {
    scene.traverse((object) => {
      if (followed.has(object)) return;
      const data = object.userData[GODOT_DIRECTIONAL_SHADOW_DATA];
      if (!isGodotDirectionalShadowData(data)) return;
      followed.set(object, {
        light: object,
        data,
        authoredPosition: object.position.clone(),
      });
    });
  };

  return {
    update(camera: Camera): void {
      discover();
      if (followed.size === 0) return;
      camera.updateWorldMatrix(true, false);
      for (const entry of followed.values()) {
        const light = entry.light as ShadowCastingLight;
        // A light whose scene unmounted is no longer in this tree; drop it rather than driving a
        // detached object forever.
        if (light.parent === null) {
          followed.delete(light);
          continue;
        }
        light.updateWorldMatrix(true, false);
        light.getWorldQuaternion(lightOrientation);
        const shadow = light.shadow;
        const fit = fitGodotDirectionalShadow(
          camera,
          lightOrientation,
          entry.data.maxDistance,
          shadow?.mapSize.x ?? 0,
        );
        if (shadow !== undefined) {
          const box = shadow.camera;
          box.left = -fit.radius;
          box.right = fit.radius;
          box.top = fit.radius;
          box.bottom = -fit.radius;
          box.updateProjectionMatrix();
          // The lane's calibration: authored bias x one fitted texel, in three's world units.
          shadow.normalBias = entry.data.normalBiasTexels * fit.texelWorldSize;
        }
        // `position` is PARENT-local and the light is authored under its scene's own nodes, so the
        // world-space centre comes back through the parent's inverse.
        light.parent.updateWorldMatrix(true, false);
        light.position.copy(
          fit.center.applyMatrix4(parentInverse.copy(light.parent.matrixWorld).invert()),
        );
      }
    },
    dispose(): void {
      for (const entry of followed.values()) entry.light.position.copy(entry.authoredPosition);
      followed.clear();
    },
  };
}
