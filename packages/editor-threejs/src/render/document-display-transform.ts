import type * as THREE from 'three';

/** An integration's scene-linear to display resolve. The stage owns its HDR
 * input; the integration owns the transform and its GPU resources. Output is
 * already display encoded, with associated alpha for the canvas and straight
 * alpha for a transparent photograph. No readback belongs on this path. */
export interface DocumentDisplayTransform {
  render(
    renderer: THREE.WebGLRenderer,
    input: Pick<THREE.WebGLRenderTarget, 'texture'>,
    output: THREE.WebGLRenderTarget | null,
    straightAlpha: boolean,
  ): void;
}
