import { WebGLRenderer } from 'three';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rendering-server';
import { godot_viewport_attach_renderer } from '../../capabilities/catalog/project-source/src/lib/godot-compat/viewport';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';

/**
 * RenderingServer on the web platform. Neither member is observable headless in the native binary
 * (it runs the dummy renderer), so each case's value is the cited fact of Godot's web export: the
 * rendering method its project setting admits, and the three shadow-map type `viewport.ts` maps the
 * Compatibility rasterizer's directional kernel to.
 */

const member = (name: string): GodotEvidenceSymbol => ({ kind: 'singleton-member', owner: 'RenderingServer', member: name });
const cases: GodotEvidenceCase[] = [];

cases.push({
  id: 'get_current_rendering_method-web',
  symbol: member('get_current_rendering_method'),
  gdscript: 'RenderingServer.get_current_rendering_method()',
  target: () => R.get_current_rendering_method(),
  comparator: 'web-platform-fact',
  fact: {
    value: 'gl_compatibility',
    source: { file: 'main/main.cpp', symbol: 'rendering/renderer/rendering_method.web', line: 2644 },
  },
});

/** A renderer stand-in with the settings three's `WebGLRenderer` exposes for shadows. */
function renderer(): WebGLRenderer {
  return { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as unknown as WebGLRenderer;
}

// Godot's kernel per quality (drivers/gles3/rasterizer_scene_gles3.cpp:3674): HARD and SOFT_VERY_LOW
// one tap, SOFT_LOW and SOFT_MEDIUM PCF_5, SOFT_HIGH and SOFT_ULTRA PCF_13; three's BasicShadowMap
// (0), PCFShadowMap (1), PCFSoftShadowMap (2), three/src/constants.js:57-74.
for (const [quality, type] of [
  [0, 0],
  [1, 0],
  [2, 1],
  [3, 1],
  [4, 2],
  [5, 2],
] as const) {
  cases.push({
    id: `directional_soft_shadow_filter_set_quality-${String(quality)}`,
    symbol: member('directional_soft_shadow_filter_set_quality'),
    gdscript: `RenderingServer.directional_soft_shadow_filter_set_quality(${String(quality)})`,
    target: () => {
      const attached = renderer();
      const release = godot_viewport_attach_renderer(attached);
      R.directional_soft_shadow_filter_set_quality(quality);
      release();
      return attached.shadowMap.type;
    },
    comparator: 'render-mapping',
    fact: {
      value: type,
      source: { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'directional_shadow_quality kernel', line: 3674 },
    },
  });
}

const RENDERING_SERVER_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'RenderingServer',
  compatModule: 'lib/godot-compat/rendering-server',
  cases,
};

export default RENDERING_SERVER_EVIDENCE;
