import * as THREE from 'three';

/** Distance that fits an axis-aligned world box for one perspective viewing direction. */
export function perspectiveDistanceToFitBox(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  direction: THREE.Vector3,
  padding = 1.15,
): number {
  if (box.isEmpty()) return 3;
  const viewDirection = direction.clone().normalize();
  const fallbackUp =
    Math.abs(viewDirection.dot(camera.up)) > 0.999 ? new THREE.Vector3(0, 0, 1) : camera.up;
  const right = new THREE.Vector3().crossVectors(fallbackUp, viewDirection).normalize();
  const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
  const center = box.getCenter(new THREE.Vector3());
  let halfDepth = 0;
  let halfHeight = 0;
  let halfWidth = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(center);
        halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)));
        halfHeight = Math.max(halfHeight, Math.abs(offset.dot(up)));
        halfDepth = Math.max(halfDepth, Math.abs(offset.dot(viewDirection)));
      }
    }
  }
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.01));
  const fitDistance = Math.max(
    halfHeight / Math.tan(verticalHalfFov),
    halfWidth / Math.tan(horizontalHalfFov),
  );
  // The floor is the camera's own near plane, not a metre count: a 3 m floor
  // framed every prop under two metres at the same distance, so a 0.5 m
  // mushroom opened as a thumb-sized thing in the middle of the viewport
  // and Frame did nothing (measured 2026-09-06: fit 0.62 m, answer 3.0 m).
  return Math.max(fitDistance * padding + halfDepth, camera.near * 4, 0.01);
}
