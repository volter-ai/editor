import * as THREE from 'three';

function corners(box: THREE.Box3): THREE.Vector3[] {
  return [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) =>
      [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z)),
    ),
  );
}

/** Vertices of the box/frustum intersection, including receivers crossing the view. */
export function visibleShadowReceivers(box: THREE.Box3, frustum: THREE.Frustum): THREE.Vector3[] {
  if (box.isEmpty() || !frustum.intersectsBox(box)) return [];
  const points = corners(box);
  if (points.every((point) => frustum.containsPoint(point))) return points;
  const planes = [
    ...frustum.planes,
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z),
  ];
  const result: THREE.Vector3[] = [];
  const bc = new THREE.Vector3(),
    ca = new THREE.Vector3(),
    ab = new THREE.Vector3();
  const point = new THREE.Vector3();
  const epsilon = Math.max(1, box.min.length(), box.max.length()) * 1e-8;
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const a = planes[i]!,
          b = planes[j]!,
          c = planes[k]!;
        bc.crossVectors(b.normal, c.normal);
        const determinant = a.normal.dot(bc);
        if (Math.abs(determinant) < 1e-12) continue;
        ca.crossVectors(c.normal, a.normal);
        ab.crossVectors(a.normal, b.normal);
        point
          .copy(bc)
          .multiplyScalar(-a.constant)
          .addScaledVector(ca, -b.constant)
          .addScaledVector(ab, -c.constant)
          .divideScalar(determinant);
        if (planes.every((plane) => plane.distanceToPoint(point) >= -epsilon))
          result.push(point.clone());
      }
  return result;
}

/** Fit visible receivers laterally; retain offscreen casters along the light rays. */
export function fitModelDirectionalShadow(
  light: THREE.DirectionalLight,
  receivers: THREE.Vector3[],
  casters: THREE.Box3[],
): void {
  if (!light.castShadow || !receivers.length) return;
  light.shadow.updateMatrices(light);
  const camera = light.shadow.camera;
  const view = camera.matrixWorldInverse;
  const bounds = new THREE.Box3().setFromPoints(
    receivers.map((point) => point.clone().applyMatrix4(view)),
  );
  const size = bounds.getSize(new THREE.Vector3());
  const epsilon = Math.max(size.length() * 1e-6, Number.EPSILON);
  // PCFSoft reaches two texels per axis; the normal offset can move the
  // lookup another 2*sqrt(2) texels. Reserve that same footprint for both
  // the map and the casters that can contribute to its edge samples.
  const support = 2 + 2 * Math.SQRT2;
  const texel =
    Math.max(size.x, size.y, epsilon) /
    Math.max(1, Math.min(light.shadow.mapSize.x, light.shadow.mapSize.y) - 2 * support);
  const normalBias = 2 * Math.SQRT2 * texel;
  const padding = support * texel;
  bounds.min.x -= padding;
  bounds.min.y -= padding;
  bounds.max.x += padding;
  bounds.max.y += padding;
  for (const box of casters) {
    if (box.isEmpty()) continue;
    const caster = new THREE.Box3().setFromPoints(
      corners(box).map((point) => point.applyMatrix4(view)),
    );
    if (
      caster.max.x < bounds.min.x ||
      caster.min.x > bounds.max.x ||
      caster.max.y < bounds.min.y ||
      caster.min.y > bounds.max.y
    )
      continue;
    bounds.min.z = Math.min(bounds.min.z, caster.min.z);
    bounds.max.z = Math.max(bounds.max.z, caster.max.z);
  }
  camera.left = bounds.min.x;
  camera.right = bounds.max.x;
  camera.bottom = bounds.min.y;
  camera.top = bounds.max.y;
  // A SUN's authored position has no physical meaning; an orthographic depth
  // interval can include geometry on either side of that position.
  camera.near = -bounds.max.z - normalBias - epsilon;
  camera.far = -bounds.min.z + normalBias + epsilon;
  camera.updateProjectionMatrix();
  light.shadow.normalBias = normalBias;
}
