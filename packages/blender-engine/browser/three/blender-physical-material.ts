/** Principled socket values stay Blender-owned; this file applies them to the
 * actual Three material. Units cross the wire unchanged (turns and nanometres).
 * Shader adjustments cover the coat IOR/tint and specular grazing behavior
 * that MeshPhysicalMaterial does not expose as properties. */
import * as THREE from 'three';
import {z} from 'zod';
import {bindNamedUvChannels} from './blender-texture-samplers';

const scalar = z.number().finite();
const color = z.tuple([scalar, scalar, scalar]);
export const physicalMaterialSchema = z.object({
  coat: scalar, coat_roughness: scalar, coat_ior: scalar, coat_tint: color,
  sheen: scalar, sheen_roughness: scalar, sheen_tint: color,
  anisotropy: scalar, anisotropy_rotation: scalar,
  specular_level: scalar, specular_tint: color,
  film_thickness: scalar, film_ior: scalar,
}).strict();
type Physical = z.infer<typeof physicalMaterialSchema>;
const defaults: Physical = {
  coat: 0, coat_roughness: 0.03, coat_ior: 1.5, coat_tint: [1, 1, 1],
  sheen: 0, sheen_roughness: 0.5, sheen_tint: [1, 1, 1],
  anisotropy: 0, anisotropy_rotation: 0,
  specular_level: 0.5, specular_tint: [1, 1, 1], film_thickness: 0, film_ior: 1.33,
};
const uniforms = new WeakMap<THREE.MeshPhysicalMaterial, {
  blenderCoatIor: {value: number}; blenderCoatTint: {value: THREE.Color};
  blenderMapClip: {value: boolean}; blenderRoughnessClip: {value: boolean}; blenderNormalClip: {value: boolean};
}>();

export function applyPhysicalMaterial(material: THREE.MeshPhysicalMaterial, input?: Physical,
  clips: {map?: boolean; roughness?: boolean; normal?: boolean} = {}): void {
  const data = input ?? defaults;
  material.clearcoat = data.coat;
  material.clearcoatRoughness = data.coat_roughness;
  material.sheen = data.sheen;
  material.sheenRoughness = data.sheen_roughness;
  material.sheenColor.setRGB(...data.sheen_tint, THREE.LinearSRGBColorSpace);
  material.anisotropy = data.anisotropy;
  material.anisotropyRotation = data.anisotropy_rotation * Math.PI * 2;
  material.specularIntensity = data.specular_level * 2;
  material.specularColor.setRGB(...data.specular_tint, THREE.LinearSRGBColorSpace);
  material.iridescence = data.film_thickness > 0 ? 1 : 0;
  material.iridescenceIOR = data.film_ior;
  material.iridescenceThicknessRange = [data.film_thickness, data.film_thickness];
  let values = uniforms.get(material);
  if (!values) {
    values = {blenderCoatIor: {value: 1.5}, blenderCoatTint: {value: new THREE.Color(1, 1, 1)},
      blenderMapClip: {value: false}, blenderRoughnessClip: {value: false}, blenderNormalClip: {value: false}};
    uniforms.set(material, values);
    const held = values;
    material.customProgramCacheKey = () => 'blender-principled-physical-v3';
    material.onBeforeRender = (_renderer, _scene, _camera, geometry) => bindNamedUvChannels(material, geometry);
    material.onBeforeCompile = shader => {
      // Three declares channels 0..3. Blender has eight named UV maps in
      // addition to the default channel; only the used attributes survive GLSL.
      shader.vertexShader = [4, 5, 6, 7, 8].map(i => `attribute vec2 uv${i};`).join('\n') + '\n' + shader.vertexShader;
      Object.assign(shader.uniforms, held);
      shader.fragmentShader = `uniform float blenderCoatIor;
        uniform vec3 blenderCoatTint;
        uniform bool blenderMapClip, blenderRoughnessClip, blenderNormalClip;
        vec4 blenderImageSample(sampler2D image, vec2 uv, bool clipImage) {
          vec4 pixel = texture2D(image, uv);
          if (clipImage && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))) pixel = vec4(0.0);
          return pixel;
        }
      ` + shader.fragmentShader;
      const physical = THREE.ShaderChunk.lights_physical_fragment
        .replace('material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );',
          'material.specularF90 = 1.0;')
        .replace('material.clearcoatF0 = vec3( 0.04 );',
          'material.clearcoatF0 = vec3( pow2( ( blenderCoatIor - 1.0 ) / ( blenderCoatIor + 1.0 ) ) );');
      const normals = THREE.ShaderChunk.normal_fragment_maps
        .replace('normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 blenderBaseNormal = normal; normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0; normal.y *= normalScale.y < 0.0 ? -1.0 : 1.0;')
        .replace('normal = normalize( normalMatrix * normal );',
          'normal = normalize(mix(blenderBaseNormal, normalize(normalMatrix * normal), max(0.0, normalScale.x)));')
        .replace('mapN.xy *= normalScale;',
          'mapN.xy *= normalScale; mapN.z = mix(1.0, mapN.z, clamp(normalScale.x, 0.0, 1.0));')
        .replaceAll('texture2D( normalMap, vNormalMapUv )', 'blenderImageSample(normalMap, vNormalMapUv, blenderNormalClip)');
      const baseMap = THREE.ShaderChunk.map_fragment
        .replace('texture2D( map, vMapUv )', 'blenderImageSample(map, vMapUv, blenderMapClip)')
        // Blender's Color socket does not connect Image Alpha to Principled Alpha.
        .replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb *= sampledDiffuseColor.rgb;');
      const roughnessMap = THREE.ShaderChunk.roughnessmap_fragment
        .replace('texture2D( roughnessMap, vRoughnessMapUv )', 'blenderImageSample(roughnessMap, vRoughnessMapUv, blenderRoughnessClip)');
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', physical)
        .replace('#include <normal_fragment_maps>', normals)
        .replace('#include <map_fragment>', baseMap)
        .replace('#include <roughnessmap_fragment>', roughnessMap)
        .replace('vec3 Fcc = F_Schlick', `
          // Blender's slab_transmittance_at_angle (gpu_shader_material_principled.glsl):
          // Beer-Lambert attenuation through a refracting coat at this view angle.
          float coatPath = blenderCoatIor * inversesqrt(max(1e-8,
            blenderCoatIor * blenderCoatIor - (1.0 - dotNVcc * dotNVcc)));
          outgoingLight *= mix(vec3(1.0), pow(max(blenderCoatTint, vec3(0.0)), vec3(coatPath)), material.clearcoat);
          vec3 Fcc = F_Schlick`);
    };
    material.needsUpdate = true;
  }
  values.blenderCoatIor.value = Math.max(1, data.coat_ior);
  values.blenderCoatTint.value.setRGB(...data.coat_tint, THREE.LinearSRGBColorSpace);
  values.blenderMapClip.value = clips.map === true;
  values.blenderRoughnessClip.value = clips.roughness === true;
  values.blenderNormalClip.value = clips.normal === true;
}
