/** Draw the Python-owned density grid directly as a Three.js volume. */
import * as THREE from 'three';
import { z } from 'zod';

const scalar = z.number().finite();
const vector = z.tuple([scalar, scalar, scalar]);
export const volumeSchema = z
  .object({
    min: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    max: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    density: z.array(scalar),
    voxelSize: scalar.positive(),
    color: vector,
    emission: vector,
    densityScale: scalar.nonnegative(),
  })
  .strict();
export type VolumeData = z.infer<typeof volumeSchema>;

export function volumeMesh(data: VolumeData): THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> {
  const size = data.max.map((v, i) => v - data.min[i]! + 1);
  if (size.some((v) => v <= 0) || size.reduce((a, b) => a * b, 1) !== data.density.length)
    throw new Error('Volume density dimensions do not match the evaluated grid');
  const texture = new THREE.Data3DTexture(
    new Float32Array(data.density),
    size[0]!,
    size[1]!,
    size[2]!,
  );
  texture.format = THREE.RedFormat;
  texture.type = THREE.FloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const minimum = new THREE.Vector3(...data.min).addScalar(-0.5).multiplyScalar(data.voxelSize);
  const extent = new THREE.Vector3(size[0], size[1], size[2]).multiplyScalar(data.voxelSize);
  const geometry = new THREE.BoxGeometry(extent.x, extent.y, extent.z);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    positions.setXYZ(
      i,
      minimum.x + (positions.getX(i) > 0 ? extent.x : 0),
      minimum.y + (positions.getY(i) > 0 ? extent.y : 0),
      minimum.z + (positions.getZ(i) > 0 ? extent.z : 0),
    );
  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    uniforms: {
      densityGrid: { value: texture },
      minimum: { value: minimum },
      extent: { value: extent },
      voxelSize: { value: data.voxelSize },
      densityScale: { value: data.densityScale },
      volumeColor: { value: new THREE.Vector3(...data.color) },
      emission: { value: new THREE.Vector3(...data.emission) },
      cameraLocal: { value: new THREE.Vector3() },
      rayLocal: { value: new THREE.Vector3() },
      orthographic: { value: false },
      worldScale: { value: new THREE.Matrix3() },
    },
    vertexShader: `
      out vec3 localPosition;
      void main() {
        localPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp sampler3D;
      uniform sampler3D densityGrid;
      uniform vec3 minimum, extent, volumeColor, emission, cameraLocal, rayLocal;
      uniform float voxelSize, densityScale;
      uniform bool orthographic;
      uniform mat3 worldScale;
      in vec3 localPosition;
      out vec4 outputColor;
      #define gl_FragColor outputColor
      void main() {
        vec3 direction = normalize(orthographic ? rayLocal : localPosition - cameraLocal);
        vec3 origin = orthographic ? localPosition - direction * length(extent) * 2.0 : cameraLocal;
        vec3 inverseRay = 1.0 / direction;
        vec3 nearPlane = (minimum - origin) * inverseRay;
        vec3 farPlane = (minimum + extent - origin) * inverseRay;
        vec3 lo = min(nearPlane, farPlane), hi = max(nearPlane, farPlane);
        float start = max(0.0, max(lo.x, max(lo.y, lo.z)));
        float end = min(hi.x, min(hi.y, hi.z));
        if (end <= start) discard;
        float stepSize = min(voxelSize * 0.5, end - start);
        float worldStep = length(worldScale * direction) * stepSize;
        vec3 radiance = vec3(0.0);
        float transmission = 1.0;
        for (float t = start + stepSize * 0.5; t < end; t += stepSize) {
          vec3 uvw = (origin + direction * t - minimum) / extent;
          float density = max(0.0, texture(densityGrid, uvw).r);
          float extinction = density * densityScale;
          float attenuation = exp(-extinction * worldStep);
          float integral = extinction > 0.000001 ? (1.0 - attenuation) / extinction : worldStep;
          radiance += transmission * (volumeColor * extinction + emission * density) * integral;
          transmission *= attenuation;
          if (transmission < 0.001) break;
        }
        outputColor = vec4(radiance, 1.0 - transmission);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const inverse = new THREE.Matrix4();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(mesh.matrixWorld).invert();
    material.uniforms['cameraLocal']!.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(
      inverse,
    );
    camera.getWorldDirection(material.uniforms['rayLocal']!.value).transformDirection(inverse);
    material.uniforms['orthographic']!.value = Boolean(
      (camera as THREE.OrthographicCamera).isOrthographicCamera,
    );
    material.uniforms['worldScale']!.value.setFromMatrix4(mesh.matrixWorld);
  };
  material.addEventListener('dispose', () => texture.dispose());
  return mesh;
}
