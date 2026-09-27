/**
 * `applyWorldRendererConfig` — the three.js half of the renderer-config seam.
 *
 * The SHAPE is the project contract's (`@volter/editor-project/adapter/renderer-config`,
 * whose header states the rule and the three load-bearing properties); this
 * file is what writes it onto a live `WebGLRenderer` and hands back the
 * restore. A mounted three root declares it (`MountedThreeRoot.rendererConfig`)
 * and the editor's world-root stage applies it.
 */

import type {
  WorldOutputColorSpace,
  WorldRendererConfig,
  WorldShadowMapType,
  WorldToneMapping,
} from '@volter/editor-project/adapter/renderer-config';
import type * as THREE from 'three';

export type {
  WorldOutputColorSpace,
  WorldRendererConfig,
  WorldShadowMapType,
  WorldToneMapping,
} from '@volter/editor-project/adapter/renderer-config';

/**
 * Apply `config` to `renderer`, returning the restore function that puts back what was there.
 *
 * `three` is passed in rather than imported for values so the enum constants come from the HOST's
 * three instance — the same identity rule `r3f-root.tsx` follows for the scene and camera.
 */
export function applyWorldRendererConfig(
  three: typeof THREE,
  renderer: THREE.WebGLRenderer,
  config: WorldRendererConfig,
): () => void {
  // A host that mounts a world WITHOUT rasterizing it hands the adapter a duck-typed renderer —
  // the editor's design session (`createDesignTimeRenderer`: four members, deliberately never
  // widened) and jsdom test harnesses both do. Such a surface has no colour pipeline to configure:
  // the frame the user sees is drawn by a DIFFERENT renderer (the editor's own), so applying the
  // world's config there is meaningless — and calling `getClearColor` on it is a TypeError that
  // unmounts the whole world at edit time (measured: every Godot port's edit viewport blanked with
  // '"world" failed to mount — renderer.getClearColor is not a function'). Detect the real
  // `WebGLRenderer` surface by the one method this function must call, and no-op otherwise.
  if (typeof renderer.getClearColor !== 'function') {
    return () => {};
  }
  const toneMappings: Record<WorldToneMapping, THREE.ToneMapping> = {
    none: three.NoToneMapping,
    linear: three.LinearToneMapping,
    reinhard: three.ReinhardToneMapping,
    cineon: three.CineonToneMapping,
    aces: three.ACESFilmicToneMapping,
    agx: three.AgXToneMapping,
    neutral: three.NeutralToneMapping,
  };
  const colorSpaces: Record<WorldOutputColorSpace, THREE.ColorSpace> = {
    srgb: three.SRGBColorSpace,
    'srgb-linear': three.LinearSRGBColorSpace,
  };
  const shadowMapTypes: Record<WorldShadowMapType, THREE.ShadowMapType> = {
    basic: three.BasicShadowMap,
    pcf: three.PCFShadowMap,
    'pcf-soft': three.PCFSoftShadowMap,
    vsm: three.VSMShadowMap,
  };

  const restores: (() => void)[] = [];

  if (config.toneMapping !== undefined) {
    const previous = renderer.toneMapping;
    renderer.toneMapping = toneMappings[config.toneMapping];
    restores.push(() => {
      renderer.toneMapping = previous;
    });
  }
  if (config.toneMappingExposure !== undefined) {
    const previous = renderer.toneMappingExposure;
    renderer.toneMappingExposure = config.toneMappingExposure;
    restores.push(() => {
      renderer.toneMappingExposure = previous;
    });
  }
  if (config.outputColorSpace !== undefined) {
    const previous = renderer.outputColorSpace;
    renderer.outputColorSpace = colorSpaces[config.outputColorSpace];
    restores.push(() => {
      renderer.outputColorSpace = previous;
    });
  }
  if (config.shadowMapType !== undefined && renderer.shadowMap !== undefined) {
    const previous = renderer.shadowMap.type;
    renderer.shadowMap.type = shadowMapTypes[config.shadowMapType];
    renderer.shadowMap.needsUpdate = true;
    restores.push(() => {
      renderer.shadowMap.type = previous;
      renderer.shadowMap.needsUpdate = true;
    });
  }
  if (config.clearColor !== undefined) {
    const previousColor = new three.Color();
    renderer.getClearColor(previousColor);
    // Alpha is READ BACK and re-passed, never assumed: see `clearColor`'s doc above.
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(new three.Color(config.clearColor), alpha);
    restores.push(() => {
      renderer.setClearColor(previousColor, alpha);
    });
  }

  return () => {
    // Reverse order, so a field written twice (it cannot be, today) unwinds correctly.
    for (let i = restores.length - 1; i >= 0; i--) restores[i]?.();
  };
}
