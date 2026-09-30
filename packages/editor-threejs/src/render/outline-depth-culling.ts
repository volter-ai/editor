import * as THREE from 'three';
import type {OutlineEffect, DepthPass, RenderPass} from 'postprocessing';

type OutlineDepth = OutlineEffect & {camera: THREE.Camera; scene: THREE.Scene; depthPass: DepthPass & {renderPass?: RenderPass}};

/** The outline samples scene depth only where a selected surface draws. Reject
 * ordinary depth draws outside a conservative selection rectangle. Camera and
 * object callbacks retain their original inputs, order and transforms; helpers
 * and custom draws use the full path. Nothing changes in the color/mask passes. */
export function bindOutlineDepthCulling(effect: OutlineEffect): void {
  const outline = effect as OutlineDepth;
  const depth = outline.depthPass;
  const render = depth.render.bind(depth);
  const originalProjection = new THREE.Matrix4();
  const originalView = new THREE.Matrix4();
  const clip = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const worldCentre = new THREE.Vector3();
  const crop = new THREE.Matrix4();
  const objectView = new THREE.Matrix4();
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
    let supported = true;
    // A drawable sharing the selection layer without belonging to Selection
    // would also write the mask, so the selected objects alone cannot bound it.
    scene.traverseVisible(object => {
      if (object.layers.isEnabled(effect.selection.layer) && !effect.selection.has(object) &&
          (object instanceof THREE.Mesh || object instanceof THREE.Line ||
            object instanceof THREE.Points || object instanceof THREE.Sprite)) supported = false;
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
      if (!(object instanceof THREE.Mesh) || !object.frustumCulled ||
          object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
          object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) { supported = false; break; }
      const selectedMaterials = Array.isArray(object.material) ? object.material : [object.material];
      if (selectedMaterials.some(material => !material.allowOverride)) { supported = false; break; }
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
      // Bound scale in CAMERA space too: authored cameras may carry scale.
      // Gershgorin's upper bound on the symmetric A^T A matrix bounds every
      // direction, including shear; orthogonal placements keep a tight sphere.
      objectView.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
      const e = objectView.elements;
      if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) { supported = false; break; }
      const dot = (a: number, b: number) => e[a]! * e[b]! + e[a + 1]! * e[b + 1]! + e[a + 2]! * e[b + 2]!;
      const xy = Math.abs(dot(0, 4)), xz = Math.abs(dot(0, 8)), yz = Math.abs(dot(4, 8));
      const scale = Math.sqrt(Math.max(dot(0, 0) + xy + xz, dot(4, 4) + xy + yz, dot(8, 8) + xz + yz));
      viewCentre.copy(sphere.center).applyMatrix4(objectView);
      sphere.radius *= scale * (1 + 16 * Number.EPSILON);
      // A box enclosing this sphere is conservative in camera axes.
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
    originalView.copy(camera.matrixWorldInverse);
    crop.set(2 / (right - left), 0, 0, -(right + left) / (right - left),
      0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom),
      0, 0, 1, 0, 0, 0, 0, 1);
    clip.multiplyMatrices(crop, originalProjection).multiply(originalView);
    frustum.setFromProjectionMatrix(clip, camera.coordinateSystem);
    // These planes never become the renderer's camera. Object/material hooks
    // execute normally before renderBufferDirect; custom/deforming draws are
    // never rejected. The cache lives for only this pass and contains booleans.
    const outside = new WeakMap<THREE.Object3D, boolean>();
    const originalDraw = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (drawCamera, drawScene, geometry, drawMaterial, object, group) {
      if (drawCamera !== camera || drawScene !== scene ||
          !camera.projectionMatrix.equals(originalProjection) || !camera.matrixWorldInverse.equals(originalView) ||
          !(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh ||
          (!object.frustumCulled && typeof object.userData['depthOccluderWorldSphere'] !== 'function') ||
          Object.keys(geometry.morphAttributes).length ||
          object.onBeforeRender !== (object instanceof THREE.BatchedMesh ? THREE.BatchedMesh.prototype.onBeforeRender : THREE.Object3D.prototype.onBeforeRender) ||
          object.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
          !(drawMaterial instanceof THREE.MeshDepthMaterial) || drawMaterial.displacementMap ||
          drawMaterial.onBeforeRender !== THREE.Material.prototype.onBeforeRender ||
          drawMaterial.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
          drawMaterial.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey)
        return originalDraw.call(this, drawCamera, drawScene, geometry, drawMaterial, object, group);
      let hidden = outside.get(object);
      if (hidden === undefined) {
        hidden = false;
        const worldBound = object.userData['depthOccluderWorldSphere'];
        if (!object.frustumCulled && typeof worldBound === 'function') {
          // Owned ordered batches expose real contents separately from their
          // sorting anchor. A null/invalid bound retains the original draw.
          const bound = worldBound() as THREE.Sphere | null;
          if (bound instanceof THREE.Sphere && Number.isFinite(bound.radius + bound.center.x + bound.center.y + bound.center.z) && bound.radius >= 0) {
            for (const plane of frustum.planes) {
              const distance = plane.distanceToPoint(bound.center);
              const margin = 1e-6 * (Math.abs(plane.normal.x * bound.center.x) + Math.abs(plane.normal.y * bound.center.y) +
                Math.abs(plane.normal.z * bound.center.z) + Math.abs(plane.constant) + bound.radius + 1);
              if (distance + bound.radius < -margin) { hidden = true; break; }
            }
          }
          outside.set(object, hidden);
          if (!hidden) return originalDraw.call(this, drawCamera, drawScene, geometry, drawMaterial, object, group);
          return;
        }
        const bounded = object as THREE.Mesh & {boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void};
        if (bounded.boundingSphere === null) bounded.computeBoundingSphere?.();
        if (bounded.boundingSphere === undefined && !geometry.boundingSphere) geometry.computeBoundingSphere();
        const bound = bounded.boundingSphere === undefined ? geometry.boundingSphere : bounded.boundingSphere;
        const e = object.matrixWorld.elements;
        if (bound && Number.isFinite(bound.radius) && bound.radius >= 0 && e[3] === 0 && e[7] === 0 && e[11] === 0 && e[15] === 1) {
          worldCentre.copy(bound.center).applyMatrix4(object.matrixWorld);
          // Support of the transformed local sphere along each plane normal:
          // unlike max-column scale this remains conservative with shear.
          for (const plane of frustum.planes) {
            const n = plane.normal;
            const radius = bound.radius * Math.hypot(
              n.x * e[0]! + n.y * e[1]! + n.z * e[2]!,
              n.x * e[4]! + n.y * e[5]! + n.z * e[6]!,
              n.x * e[8]! + n.y * e[9]! + n.z * e[10]!);
            const distance = plane.distanceToPoint(worldCentre);
            const margin = 1e-6 * (Math.abs(n.x * worldCentre.x) + Math.abs(n.y * worldCentre.y) +
              Math.abs(n.z * worldCentre.z) + Math.abs(plane.constant) + radius + 1);
            if (distance + radius < -margin) { hidden = true; break; }
          }
        }
        outside.set(object, hidden);
      }
      if (!hidden) return originalDraw.call(this, drawCamera, drawScene, geometry, drawMaterial, object, group);
    };
    try { render(renderer, input, output, delta, stencil); }
    finally { renderer.renderBufferDirect = originalDraw; }
  };
}
