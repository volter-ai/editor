import * as THREE from 'three';
import type {OutlineEffect, DepthPass, RenderPass} from 'postprocessing';

type OutlineDepth = OutlineEffect & {camera: THREE.Camera; scene: THREE.Scene; depthPass: DepthPass & {renderPass?: RenderPass}};

/** The outline samples scene depth only where a selected surface draws. Cull
 * depth occluders against a conservative selection rectangle, then restore the
 * ORIGINAL projection before uploading any draw uniforms. Raster positions,
 * depth values, mask/edge passes and the color pass retain their original math.
 * Unknown callbacks/cameras and bounds crossing the near plane use the full pass. */
export function bindOutlineDepthCulling(effect: OutlineEffect): void {
  const outline = effect as OutlineDepth;
  const depth = outline.depthPass;
  const render = depth.render.bind(depth);
  const originalProjection = new THREE.Matrix4();
  const originalInverse = new THREE.Matrix4();
  const crop = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const viewCentre = new THREE.Vector3();
  const corner = new THREE.Vector4();

  depth.render = (renderer, input, output, delta, stencil) => {
    const camera = outline.camera;
    const scene = outline.scene;
    if (renderer.xr.isPresenting || renderer.capabilities.reversedDepthBuffer ||
        (!(camera instanceof THREE.PerspectiveCamera) && !(camera instanceof THREE.OrthographicCamera)) ||
        scene.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
        scene.onAfterRender !== THREE.Object3D.prototype.onAfterRender) {
      render(renderer, input, output, delta, stencil);
      return;
    }
    // No callback may see the temporary culling projection. The only supported
    // non-default object callback is Three's own batch culling; shader uploads
    // happen after renderBufferDirect restores the original camera below.
    let supported = true;
    scene.traverseVisible(object => {
      if (object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender &&
          (!(object instanceof THREE.BatchedMesh) ||
            object.onBeforeRender !== THREE.BatchedMesh.prototype.onBeforeRender)) supported = false;
      if (object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) supported = false;
      if (object.layers.isEnabled(effect.selection.layer) && !effect.selection.has(object) &&
          (object instanceof THREE.Mesh || object instanceof THREE.Line ||
            object instanceof THREE.Points || object instanceof THREE.Sprite)) supported = false;
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => !material.allowOverride)) supported = false;
      }
    });
    const material = depth.renderPass?.overrideMaterial;
    if (!supported || !(material instanceof THREE.MeshDepthMaterial) ||
        material.onBeforeRender !== THREE.Material.prototype.onBeforeRender ||
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) {
      render(renderer, input, output, delta, stencil);
      return;
    }
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const object of effect.selection) {
      let shown = true;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
        if (!parent.visible) { shown = false; break; }
      if (!shown) continue;
      if (!(object instanceof THREE.Mesh) || !object.frustumCulled) { supported = false; break; }
      const bounded = object as THREE.Mesh & {boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void};
      if (bounded.boundingSphere !== undefined) {
        if (bounded.boundingSphere === null) bounded.computeBoundingSphere?.();
        if (!bounded.boundingSphere) { supported = false; break; }
        sphere.copy(bounded.boundingSphere);
      } else {
        if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
        if (!object.geometry.boundingSphere) { supported = false; break; }
        sphere.copy(object.geometry.boundingSphere);
      }
      // Three's usual max-axis sphere scale is insufficient under shear.
      // The Frobenius norm bounds every scale direction, including shear and
      // reflected/non-uniform transforms; a wider crop costs work, never pixels.
      const e = object.matrixWorld.elements;
      const scale = Math.hypot(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!);
      sphere.center.applyMatrix4(object.matrixWorld);
      sphere.radius *= scale;
      viewCentre.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse);
      // A box enclosing the world sphere is also conservative in camera axes.
      // Perspective division is bounded by its corners only wholly ahead of near.
      if (Number.isFinite(sphere.radius) && -viewCentre.z + sphere.radius < camera.near) continue;
      if (!Number.isFinite(sphere.radius) || -viewCentre.z - sphere.radius <= camera.near) {
        supported = false; break;
      }
      for (let i = 0; i < 8; i++) {
        corner.set(viewCentre.x + (i & 1 ? 1 : -1) * sphere.radius,
          viewCentre.y + (i & 2 ? 1 : -1) * sphere.radius,
          viewCentre.z + (i & 4 ? 1 : -1) * sphere.radius, 1).applyMatrix4(camera.projectionMatrix);
        const x = corner.x / corner.w, y = corner.y / corner.w;
        if (!Number.isFinite(x + y)) { supported = false; break; }
        left = Math.min(left, x); right = Math.max(right, x);
        bottom = Math.min(bottom, y); top = Math.max(top, y);
      }
      if (!supported) break;
    }
    if (!supported) { render(renderer, input, output, delta, stencil); return; }
    // No selected fragment can sample depth. The stock mask pass still clears
    // and redraws, so a previously visible outline cannot leave stale pixels.
    if (left > right || right < -1 || left > 1 || top < -1 || bottom > 1) return;
    // One NDC percent of margin keeps the rejection conservative at edges;
    // it affects CPU culling only, never a shader's projection or pixels.
    left = Math.max(-1, left - .01); right = Math.min(1, right + .01);
    bottom = Math.max(-1, bottom - .01); top = Math.min(1, top + .01);
    if (left <= -1 && right >= 1 && bottom <= -1 && top >= 1) {
      render(renderer, input, output, delta, stencil); return;
    }
    originalProjection.copy(camera.projectionMatrix);
    originalInverse.copy(camera.projectionMatrixInverse);
    crop.set(2 / (right - left), 0, 0, -(right + left) / (right - left),
      0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom),
      0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.premultiply(crop);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const originalDraw = renderer.renderBufferDirect;
    let restored = false;
    const restoreProjection = () => {
      if (restored) return;
      restored = true;
      camera.projectionMatrix.copy(originalProjection);
      camera.projectionMatrixInverse.copy(originalInverse);
    };
    renderer.renderBufferDirect = function (...args) {
      restoreProjection();
      return originalDraw.apply(this, args);
    };
    try { render(renderer, input, output, delta, stencil); }
    finally { restoreProjection(); renderer.renderBufferDirect = originalDraw; }
  };
}
