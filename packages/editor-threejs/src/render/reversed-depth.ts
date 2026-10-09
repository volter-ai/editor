/**
 * REVERSED DEPTH: the editor's renderers store depth from 1 at the near plane to 0 at the far one
 * (`reversedDepthBuffer`, WebGL's `EXT_clip_control`), into 32-bit float depth buffers. A float's
 * precision follows its exponent, so with the mapping reversed the depth buffer resolves surfaces
 * evenly from a few centimetres to many kilometres: a camera keeps a near plane of a tenth of a metre
 * in a world of any size, where a fixed-point buffer forced the near plane out as the world grew
 * (`viewport/clip-planes.ts`: a file with sets 3 km away put a game's near plane at 11.6 m, and the
 * character in front of the camera was never drawn).
 *
 * three.js does the core of it: the projection matrices (`camera.reversedDepth`), the depth test and
 * clear, the shadow maps. What it cannot know is the editor's own code that reads depth or builds a
 * projection by hand; each such place asks `reversedDepthOf` and answers for both mappings.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** The renderer options every scene renderer is made with. Where the GPU lacks `EXT_clip_control`,
 *  three keeps the ordinary mapping and `reversedDepthOf` answers false. */
export const DEPTH_RENDERER_OPTIONS = { reversedDepthBuffer: true } as const;

/** Whether this renderer draws with reversed depth. */
export function rendererReversedDepth(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.reversedDepthBuffer === true;
}

/** Whether this camera's projection is the reversed one (three sets it on a camera the first time a
 *  reversed-depth renderer draws through it). */
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

/**
 * A CAMERA REVERSED BEFORE ITS FIRST DRAW. three flips a camera to reversed depth lazily, inside the
 * draw (`setProgram`), after it has already culled, sorted and built the shadow matrices from the
 * ordinary projection: a fresh camera's first frame (every photograph's only frame) came out wrong.
 * This flips it, and every shadow-casting light's shadow camera in the scene, before three looks.
 */
export function adoptReversedDepth(camera: THREE.Camera): void {
  const flag = camera as THREE.Camera & { _reversedDepth?: boolean; updateProjectionMatrix?: () => void };
  if (flag._reversedDepth === true) return;
  flag._reversedDepth = true;
  flag.updateProjectionMatrix?.();
}

function adoptScene(scene: THREE.Object3D, camera: THREE.Camera): void {
  adoptReversedDepth(camera);
  scene.traverseVisible((object) => {
    const light = object as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.castShadow && light.shadow?.camera) adoptReversedDepth(light.shadow.camera);
  });
}

/** A scene renderer, set up for the depth it draws with: where it is reversed, its sorts by distance. */
export function configureDepth(renderer: THREE.WebGLRenderer): THREE.WebGLRenderer {
  if (renderer.capabilities.reversedDepthBuffer === true) {
    renderer.setOpaqueSort(opaqueByDistance as unknown as (a: unknown, b: unknown) => number);
    renderer.setTransparentSort(transparentByDistance as unknown as (a: unknown, b: unknown) => number);
    const draw = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => { adoptScene(scene, camera); draw(scene, camera); };
  }
  return renderer;
}

/**
 * AN ORTHOGRAPHIC RAY FROM A REVERSED CAMERA. three r180's `Raycaster.setFromCamera` puts an
 * orthographic ray's origin at NDC z = (near + far) / (near - far), the camera plane under the
 * ordinary mapping; reversed, that point lies beyond the far plane and every pick missed (clicks in an
 * axis view, the view cube). Reversed, the camera plane is at z = far / (far - near).
 */
const setFromCamera = THREE.Raycaster.prototype.setFromCamera;
THREE.Raycaster.prototype.setFromCamera = function (this: THREE.Raycaster, coords: THREE.Vector2, camera: THREE.Camera): void {
  const ortho = camera as THREE.OrthographicCamera;
  if (!ortho.isOrthographicCamera || !reversedDepthOf(ortho)) { setFromCamera.call(this, coords, camera); return; }
  this.ray.origin.set(coords.x, coords.y, ortho.far / (ortho.far - ortho.near)).unproject(ortho);
  this.ray.direction.set(0, 0, -1).transformDirection(ortho.matrixWorld);
  this.camera = ortho;
};

let copyQuad: FullScreenQuad | null = null;
/** A target's pixels put on `output` (the canvas when null) exactly as they are: no tone mapping, no
 *  colour conversion, no blending. For a target three drew as it draws the screen. */
export function copyToOutput(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): void {
  copyQuad ??= new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { source: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D source; varying vec2 vUv; void main() { gl_FragColor = texture2D(source, vUv); }',
    blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  (copyQuad.material as THREE.ShaderMaterial).uniforms['source']!.value = source.texture;
  renderer.setRenderTarget(output);
  copyQuad.render(renderer);
}
