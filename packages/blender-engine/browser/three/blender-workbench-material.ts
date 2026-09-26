/**
 * BLENDER'S SOLID SHADING, as Blender computes it: `get_world_lighting` from
 * `draw/engines/workbench/shaders/workbench_world_light_lib.glsl`, transcribed line for line,
 * over the four studio lights of the factory `Default` (`SOLID_LIGHTS`, read back from Blender
 * 5.2's preferences with their specular colours) and no ambient (`light_ambient` is zero).
 *
 * Per light: a wrapped diffuse term, `(N·L + wrap) / (1 + wrap)²`; a normalized Blinn specular
 * whose gloss the wrap softens, blended toward a wrapped "environment" term by `wrap²`; a
 * Fresnel lift of the specular colour (`brdf_approx`); and energy conservation that takes the
 * specular's grey level off the diffuse. The surface is the material's VIEWPORT DISPLAY
 * (`Material.diffuse_color`, `roughness`, `metallic`), which is what Solid's MATERIAL colour type
 * reads — never its node graph.
 *
 * WHY A FUNCTION AND NOT A LIGHT RIG: three's lambert and BRDF cannot express the wrap, the
 * coupled specular or the per-light specular colour, so the four lights plus one fitted gain
 * could match the default view's three faces only by absorbing the difference, and missed a
 * face square to the view by 18 levels (143 against Blender's 161). This function, evaluated
 * offline for that face, gives 161.
 *
 * Built on `MeshLambertMaterial` so skinning, morphs and the view-space normal come with it;
 * only the final colour is replaced. Blender uses a fast reciprocal (`fast_rcp`); this uses the
 * exact one.
 */
import * as THREE from 'three';
import { SOLID_LIGHTS } from './blender-runtime-lighting';

/** What Blender's Solid reads off a material. */
export interface ViewportDisplay {
  readonly color: readonly [number, number, number, number];
  readonly roughness: number;
  readonly metallic: number;
}

/** For a surface with no material: the factory cube's material's display, read back from Blender
 *  5.2 (grey 0.8, roughness 0.5, metallic 0). Blender's own default surface was not measured. */
export const DEFAULT_VIEWPORT_DISPLAY: ViewportDisplay = { color: [0.8, 0.8, 0.8, 1], roughness: 0.5, metallic: 0 };

const WORKBENCH_GLSL = /* glsl */ `
uniform vec3 wbDir[4];
uniform vec3 wbDiffuse[4];
uniform vec3 wbSpecular[4];
uniform vec4 wbWrap;
uniform float wbRoughness;
uniform float wbMetallic;

vec4 wbWrapped(vec4 NL, vec4 w) {
  vec4 w1 = w + 1.0;
  return clamp((NL + w) / (w1 * w1), 0.0, 1.0);
}

vec3 vgaiWorkbenchLighting(vec3 baseColor, vec3 N, vec3 I) {
  vec3 diffuseColor = mix(baseColor, vec3(0.0), wbMetallic);
  vec3 specularColor = mix(vec3(0.05), baseColor, wbMetallic);
  vec3 R = -reflect(I, N);
  vec4 wrapNL = vec4(dot(wbDir[0], R), dot(wbDir[1], R), dot(wbDir[2], R), dot(wbDir[3], R));
  vec4 specAngle = clamp(vec4(
    dot(normalize(wbDir[0] + I), N), dot(normalize(wbDir[1] + I), N),
    dot(normalize(wbDir[2] + I), N), dot(normalize(wbDir[3] + I), N)), 0.0, 1.0);
  vec4 specNL = clamp(vec4(dot(wbDir[0], N), dot(wbDir[1], N), dot(wbDir[2], N), dot(wbDir[3], N)), 0.0, 1.0);
  vec4 gloss = vec4(1.0 - wbRoughness) * (1.0 - wbWrap);
  vec4 shininess = exp2(10.0 * gloss + 1.0);
  vec4 specLight = pow(specAngle, shininess) * specNL * (shininess * 0.125 + 1.0);
  vec4 envW = mix(wbWrap, vec4(1.0), wbRoughness);
  vec4 specEnv = wbWrapped(wrapNL, envW);
  specLight = mix(specLight, specEnv, wbWrap * wbWrap);
  vec3 specularLight = specLight.x * wbSpecular[0] + specLight.y * wbSpecular[1] +
    specLight.z * wbSpecular[2] + specLight.w * wbSpecular[3];
  float NV = clamp(dot(N, I), 0.0, 1.0);
  float fresnel = exp2(-8.35 * NV) * (1.0 - wbRoughness);
  specularColor = mix(specularColor, vec3(1.0), fresnel);
  specularLight *= specularColor;
  vec4 diffNL = vec4(dot(wbDir[0], N), dot(wbDir[1], N), dot(wbDir[2], N), dot(wbDir[3], N));
  vec4 diffLight = wbWrapped(diffNL, wbWrap);
  vec3 diffuseLight = diffLight.x * wbDiffuse[0] + diffLight.y * wbDiffuse[1] +
    diffLight.z * wbDiffuse[2] + diffLight.w * wbDiffuse[3];
  float specEnergy = dot(specularColor, vec3(0.33333));
  diffuseLight *= diffuseColor * (1.0 - specEnergy);
  return diffuseLight + specularLight;
}
`;

const vec3s = (pick: (light: (typeof SOLID_LIGHTS)[number]) => readonly number[]) =>
  SOLID_LIGHTS.map((light) => {
    const [x = 0, y = 0, z = 0] = pick(light);
    return new THREE.Vector3(x, y, z);
  });
const LIGHT_DIRECTIONS = vec3s((light) => light.direction).map((v) => v.normalize());
const LIGHT_DIFFUSE = vec3s((light) => light.diffuse);
const LIGHT_SPECULAR = vec3s((light) => light.specular);
const LIGHT_WRAP = new THREE.Vector4(...SOLID_LIGHTS.map((light) => light.smooth));

/** One Solid-shaded surface: Blender's function over this viewport display. */
export function workbenchMaterial(display: ViewportDisplay, side: THREE.Side): THREE.MeshLambertMaterial {
  const [r, g, b] = display.color;
  const material = new THREE.MeshLambertMaterial({ side });
  material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  material.name = 'vgai:blender-solid';
  material.onBeforeCompile = (shader) => {
    shader.uniforms['wbDir'] = { value: LIGHT_DIRECTIONS };
    shader.uniforms['wbDiffuse'] = { value: LIGHT_DIFFUSE };
    shader.uniforms['wbSpecular'] = { value: LIGHT_SPECULAR };
    shader.uniforms['wbWrap'] = { value: LIGHT_WRAP };
    shader.uniforms['wbRoughness'] = { value: display.roughness };
    shader.uniforms['wbMetallic'] = { value: display.metallic };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${WORKBENCH_GLSL}\nvoid main() {`)
      .replace(
        '#include <opaque_fragment>',
        // The view direction toward the eye, as Blender's `I`: constant in an orthographic view.
        'outgoingLight = vgaiWorkbenchLighting(diffuseColor.rgb, normal, isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition));\n#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'vgai-blender-workbench';
  return material;
}
