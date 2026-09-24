import { useFrame } from '@react-three/fiber';
import { fitDirectionalShadowToCamera } from '@volter/threejs-runtime/render/directional-shadow-fit';
import { type RefObject, useEffect } from 'react';
import * as THREE from 'three';

/** Frame scratch. Read and dropped inside one synchronous callback, so one set serves every instance. */
const _lightOrientation = new THREE.Quaternion();
const _parentInverse = new THREE.Matrix4();
const _authoredAim = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * How much farther than the framed subject the shadow box reaches. 1.0 would
 * stop the slice exactly at what the camera orbits; this covers the ground the
 * subject's shadow falls on and whatever stands just behind it, and at the
 * authored camera it reproduces the box the starter used to hardcode
 * (`shadow-camera-left/right/top/bottom = ±12`) to within a few percent — the
 * meter-scale look is unchanged by construction.
 */
const VIEW_DEPTH_FACTOR = 1.35;

/** Shadow-map texels of offset along the surface normal. The standard cure for
 *  self-shadow acne on curved casters, and the reason it is derived from the
 *  fit rather than authored: a constant would be wrong by exactly the factor
 *  the box changed size. */
const NORMAL_BIAS_TEXELS = 1.5;

/** Depth range, as a multiple of the box radius, either side of the light. The
 *  fit puts the light AT the box centre, so casters stand on both sides of it
 *  and the range is symmetric. */
const DEPTH_RANGE_FACTOR = 3;

/**
 * Size the sun's shadow box to WHAT THE CAMERA IS LOOKING AT, so shadows are
 * correct at whatever scale this game turns out to be.
 *
 * THE DEFECT THIS CLOSES (measured 2026-08-29). `DirectionalLightShadow` is an
 * orthographic camera with authored extents, and the starter authored ±12
 * units over a 2048 map — 11.7 mm of world per shadow texel. That is invisible
 * on the 2.55 m focal cube this scene ships with, and ruinous the moment a game
 * is built at another scale: on a 96 mm ceramic mug one texel spans an eighth
 * of the whole object, so the cast shadow disappears into quantization and the
 * glaze wears diagonal acne stripes. No amount of `shadow-bias` fixes it,
 * because the resolution — not the offset — is what is wrong. A starter scene
 * must not encode a scale, and ±12 is a scale.
 *
 * `fitDirectionalShadowToCamera` (engine) supplies the geometry: the bounding
 * sphere of the camera's frustum slice, with the centre quantized to whole
 * shadow texels so a moving camera cannot make shadow edges crawl. Its method
 * is transcribed from `top-down-strategy`'s `CameraFittedShadow`, which fits
 * the same light to a panning camera. What is THIS scene's:
 *
 *  - **the view depth is read, not authored.** The strategy scene knows its own
 *    map is worth 45 units of shadow; a starter knows nothing about the game
 *    that will grow out of it, so the depth comes from how far the camera is
 *    from what it orbits ({@link VIEW_DEPTH_FACTOR}). Frame a mug from 26 cm
 *    and the texel is a third of a millimetre; frame a hillside from 200 m and
 *    it is centimetres. That IS the scale-honesty.
 *  - **the depth range and `normalBias` are fitted too.** A range in world
 *    units is as much a hardcoded scale as the lateral extents, and
 *    `shadow.bias` is normalized against it — so both are derived from the
 *    fitted radius, and the light's authored `shadow-bias` keeps its meaning at
 *    every scale.
 *
 * The light's authored `position` stays the sun's DIRECTION; this moves the
 * node so the box is centred on the view, and re-anchors the aim onto a target
 * parented to the light so moving it cannot rotate the sun.
 */
export function SunShadowFit({
  light,
}: {
  /** The sun to fit. Its authored transform stays the sun's DIRECTION. */
  light: RefObject<THREE.DirectionalLight | null>;
}) {
  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    const authoredPosition = sun.position.clone();
    const authoredTarget = sun.target;
    sun.updateWorldMatrix(true, false);
    authoredTarget.updateWorldMatrix(true, false);
    // Aim by a target parented to the light, so moving the light translates
    // both and the direction is unchanged by definition.
    const travellingTarget = new THREE.Object3D();
    travellingTarget.position.copy(
      sun.worldToLocal(_authoredAim.setFromMatrixPosition(authoredTarget.matrixWorld)),
    );
    sun.add(travellingTarget);
    sun.target = travellingTarget;
    return () => {
      sun.remove(travellingTarget);
      sun.target = authoredTarget;
      sun.position.copy(authoredPosition);
    };
  }, [light]);

  useFrame((state) => {
    const sun = light.current;
    const shadow = sun?.shadow;
    if (!sun || !shadow || sun.parent === null) return;
    const camera = state.camera;
    camera.updateWorldMatrix(true, false);
    sun.updateWorldMatrix(true, false);
    sun.getWorldQuaternion(_lightOrientation);

    // What the camera is looking at: the default controls' orbit target when
    // there are controls (the starter's OrbitControls declares `makeDefault`),
    // else the world origin — the point a scene with no controls is composed
    // around. Either way it is a POINT IN THE WORLD, so its distance from the
    // camera is in the game's own units and carries the game's own scale.
    const target = (state.controls as unknown as { target?: unknown } | null)?.target;
    const framed = target instanceof THREE.Vector3 ? target : _origin.set(0, 0, 0);
    const viewDepth = camera.position.distanceTo(framed) * VIEW_DEPTH_FACTOR;

    const fit = fitDirectionalShadowToCamera(
      camera,
      _lightOrientation,
      viewDepth,
      shadow.mapSize.x,
    );
    const box = shadow.camera;
    box.left = -fit.radius;
    box.right = fit.radius;
    box.top = fit.radius;
    box.bottom = -fit.radius;
    // Symmetric, because the light sits at the box centre with casters on both
    // sides of it. Authored `shadow-bias` is a fraction of THIS range, so it
    // stays a fixed fraction of the scene rather than a fixed world distance.
    box.far = fit.radius * DEPTH_RANGE_FACTOR;
    box.near = -box.far;
    box.updateProjectionMatrix();
    shadow.normalBias = fit.texelWorldSize * NORMAL_BIAS_TEXELS;
    // `position` is parent-local; the fitted centre is in world space.
    sun.parent.updateWorldMatrix(true, false);
    sun.position.copy(
      fit.center.applyMatrix4(_parentInverse.copy(sun.parent.matrixWorld).invert()),
    );
  });

  return null;
}
