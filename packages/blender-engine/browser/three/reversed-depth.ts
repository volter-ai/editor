/**
 * REVERSED DEPTH, as the presenter's own code meets it (the editor's renderers draw with three's
 * `reversedDepthBuffer` where the GPU has `EXT_clip_control`; `@volter/editor-threejs`'s
 * `render/reversed-depth.ts` says why). three handles the projection, the depth test, the clear and
 * the shadow maps; this answers the places the presenter reads depth or builds a projection itself.
 */
import * as THREE from 'three';

/** The renderer options every scene renderer is made with (three keeps the ordinary mapping where
 *  the GPU lacks `EXT_clip_control`). */
export const DEPTH_RENDERER_OPTIONS = { reversedDepthBuffer: true } as const;

/** Whether this camera's projection is reversed (three sets it the first time a reversed-depth
 *  renderer draws through the camera). */
export function reversedDepthOf(camera: THREE.Camera): boolean {
  return (camera as THREE.Camera & { reversedDepth?: boolean }).reversedDepth === true;
}

/** A 32-bit float depth texture: what a scene target needs for reversed depth to pay off. */
export function floatDepthTexture(width: number, height: number): THREE.DepthTexture {
  return new THREE.DepthTexture(Math.max(1, width), Math.max(1, height), THREE.FloatType);
}

/**
 * A mesh's polygon offset, stated as the ordinary mapping states it (positive pushes away from the
 * eye) and signed at each draw for the camera drawing it: reversed, away is toward zero.
 */
export function signedPolygonOffset(mesh: THREE.Object3D, factor: number, units: number): void {
  mesh.onBeforeRender = (_renderer, _scene, camera, _geometry, material) => {
    const flip = reversedDepthOf(camera) ? -1 : 1;
    const m = material as THREE.Material;
    m.polygonOffsetFactor = factor * flip;
    m.polygonOffsetUnits = units * flip;
  };
}

type RenderItem = { groupOrder: number; renderOrder: number; z: number; id: number; material: { id: number }; program?: { id: number } | null };
/** three sorts by clip z, which falls with distance once depth is reversed: opaque then went back to
 *  front (losing early depth rejection) and transparent front to back (drawing wrongly). These sort by
 *  distance either way. */
const opaqueByDistance = (a: RenderItem, b: RenderItem): number =>
  a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || (a.material.id !== b.material.id ? a.material.id - b.material.id : 0) || b.z - a.z || a.id - b.id;
const transparentByDistance = (a: RenderItem, b: RenderItem): number =>
  a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.z - b.z || a.id - b.id;

/** A scene renderer, set up for the depth it draws with: where it is reversed, its sorts by distance. */
export function configureDepth(renderer: THREE.WebGLRenderer): THREE.WebGLRenderer {
  if (renderer.capabilities.reversedDepthBuffer === true) {
    renderer.setOpaqueSort(opaqueByDistance as unknown as (a: unknown, b: unknown) => number);
    renderer.setTransparentSort(transparentByDistance as unknown as (a: unknown, b: unknown) => number);
  }
  return renderer;
}
