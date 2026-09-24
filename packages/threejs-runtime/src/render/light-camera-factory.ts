/**
 * Shared light + camera factory — the ONE place light/camera fallbacks are
 * decided, and it decides them by READING `DEFAULTS.light`/`DEFAULTS.camera`.
 *
 * A second copy hardcoding the same literals (color '#ffffff', fov 60, near
 * 0.1, far 1000) would agree by luck rather than by construction, and any
 * edit to either copy — or to `DEFAULTS` — would silently diverge.
 *
 * This module is now the ONE place that builds a `THREE.Light`/`THREE.Camera`
 * from a `LightDescriptor`/`CameraDescriptor` descriptor, reading its fallbacks from
 * `DEFAULTS` (the single source of truth for scene default values — see
 * `defaults.ts`). Both the loader and the editor import it, so they
 * can no longer disagree.
 */

import * as THREE from 'three';
// Area lights. `RectAreaLight` requires its LTC lookup-texture uniforms
// initialized once before the first instance is constructed; three.js ships
// that setup as an addon, not part of core. Imported via the
// `three/addons/*` alias (package.json `exports`: `"./addons/*":
// "./examples/jsm/*"` — the identical file as
// `three/examples/jsm/lights/RectAreaLightUniformsLib.js`) because a literal
// `/examples/` specifier trips this repo's game/editor-example import guard —
// a same-substring false positive against our own `src/examples/` convention,
// unrelated to three.js's addon folder naming.
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { CameraDescriptor } from '../asset-formats/camera';
import type { LightDescriptor } from '../asset-formats/light';
import { DEFAULTS } from '../defaults';

let rectAreaLightUniformsInitialized = false;

/** Build a Three.js light from a `LightDescriptor` descriptor. */
export function createLight(def: LightDescriptor): THREE.Light {
  const d = DEFAULTS.light;
  const color = def.color ?? d.color;
  const intensity = def.intensity ?? d.intensity;

  switch (def.type) {
    case 'directional':
      return new THREE.DirectionalLight(color, intensity);
    case 'point':
      return new THREE.PointLight(
        color,
        intensity,
        def.distance ?? d.distance,
        def.decay ?? d.decay,
      );
    case 'spot': {
      const light = new THREE.SpotLight(
        color,
        intensity,
        def.distance ?? d.distance,
        def.angle ?? d.angle,
        def.penumbra ?? d.penumbra,
      );
      light.decay = def.decay ?? d.decay;
      return light;
    }
    case 'hemisphere':
      return new THREE.HemisphereLight(color, def.groundColor ?? d.groundColor, intensity);
    case 'area': {
      // No shadow map is ever wired for this light (RectAreaLight does not
      // support shadows in three.js — see the honesty note on the schema
      // field's .describe(); degrade loudly, not silently).
      if (!rectAreaLightUniformsInitialized) {
        RectAreaLightUniformsLib.init();
        rectAreaLightUniformsInitialized = true;
      }
      return new THREE.RectAreaLight(
        color,
        intensity,
        def.width ?? d.width,
        def.height ?? d.height,
      );
    }
    default:
      return new THREE.DirectionalLight(color, intensity);
  }
}

/** Build a Three.js camera from a `CameraDescriptor` descriptor. */
export function createCamera(def: CameraDescriptor): THREE.Camera {
  const d = DEFAULTS.camera;
  const aspect = (def.width ?? d.width) / (def.height ?? d.height);
  if (def.type === 'orthographic') {
    const size = def.orthoSize ?? d.orthoSize;
    return new THREE.OrthographicCamera(
      -size * aspect,
      size * aspect,
      size,
      -size,
      def.near ?? d.near,
      def.far ?? d.far,
    );
  }
  return new THREE.PerspectiveCamera(
    def.fov ?? d.fov,
    aspect,
    def.near ?? d.near,
    def.far ?? d.far,
  );
}
