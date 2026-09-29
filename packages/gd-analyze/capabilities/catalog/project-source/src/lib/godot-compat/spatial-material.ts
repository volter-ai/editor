/**
 * @godot-class ShaderMaterial
 * @role PROTOCOL
 *
 * A ShaderMaterial of a `spatial` shader drawn as three draws a custom lit material: a
 * `three-custom-shader-material` over `MeshStandardMaterial` (`MeshBasicMaterial` when `unshaded`),
 * its two stages the ones the translation lowered (`spatial-shader.ts`), its uniforms the shader's
 * defaults and then the material's parameters, kept current as they are set. The render modes are
 * the material's settings: `cull_*` its side, `blend_add` additive blending, `depth_draw_never`,
 * `depth_draw_always` and `depth_test_disabled` its depth, and a written `ALPHA` makes it transparent (Godot's transparent
 * pass, `scene/resources/material.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`).
 * `source_color` uniforms are converted from sRGB to linear, as Godot's are. `TIME` is the
 * `godot_TIME` uniform, which the scene sets from R3F's clock each frame.
 *
 * A shader reading the screen or depth texture reads the frame's opaque pass, captured once per
 * frame (`capture`), at Godot's screen UV and in Godot's reversed-Z depth; `VIEWPORT_SIZE` and
 * `INV_PROJECTION_MATRIX` are set each draw.
 *
 * Where it differs: `SPECULAR` is not drawn (three's standard material keeps Godot's default
 * 0.5), and `shadows_disabled` does not stop the mesh receiving shadows (a mesh setting in three).
 */

import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import {
  AdditiveBlending,
  BackSide,
  type Camera,
  Color as ThreeColor,
  DepthTexture,
  DoubleSide,
  FrontSide,
  HalfFloatType,
  LinearMipmapLinearFilter,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  RepeatWrapping,
  type Scene,
  type Texture,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
  Vector4 as ThreeVector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { GodotShaderUniform } from './shader';
import type { ShaderMaterial } from './shader-material';

/** `ShaderLanguage::TextureFilter` and `TextureRepeat` (`servers/rendering/shader_language.h:331`). */
const FILTER_NEAREST = 0;
const REPEAT_ENABLE = 1;

/** The three material, with the time uniform its scene sets each frame. */
export type GodotSpatialMaterial = Material & { readonly uniforms: { readonly godot_TIME: { value: number } } };

const THREE_MATERIALS = new WeakMap<ShaderMaterial, GodotSpatialMaterial>();
const OF_THREE = new WeakMap<Material, ShaderMaterial>();

/**
 * The ShaderMaterial a three material draws, where it is one (a mesh's override read back).
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_shader_material_of_three(material: unknown): ShaderMaterial | undefined {
  return typeof material === 'object' && material !== null ? OF_THREE.get(material as Material) : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, number>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A uniform's value as three's uniform holds it, from a parameter's value or the shader default. */
function uniformValue(uniform: GodotShaderUniform & { readonly color?: true; readonly filter?: number; readonly repeat?: number }, value: unknown): unknown {
  if (uniform.type.startsWith('sampler')) {
    const texture = value as Texture | null;
    if (texture !== null && texture !== undefined) {
      if (uniform.filter === FILTER_NEAREST) texture.magFilter = texture.minFilter = NearestFilter;
      if (uniform.repeat === REPEAT_ENABLE) texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.needsUpdate = true;
    }
    return texture ?? null;
  }
  const components: readonly number[] = Array.isArray(value)
    ? (value as number[])
    : typeof value === 'number' || typeof value === 'boolean'
      ? [Number(value)]
      : isRecord(value)
        ? 'r' in value
          ? [value['r'] as number, value['g'] as number, value['b'] as number, value['a'] as number]
          : Object.values(value)
        : [];
  const values = [...components];
  if (uniform.color === true && values.length >= 3) {
    const linear = new ThreeColor(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0).convertSRGBToLinear();
    values[0] = linear.r;
    values[1] = linear.g;
    values[2] = linear.b;
  }
  switch (uniform.type) {
    case 'vec2':
      return new ThreeVector2(values[0] ?? 0, values[1] ?? 0);
    case 'vec3':
      return new ThreeVector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    case 'vec4':
      return new ThreeVector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1);
    case 'bool':
      return (values[0] ?? 0) !== 0;
    default:
      return values[0] ?? 0;
  }
}

/**
 * The frame's opaque pass, which a shader reading `hint_screen_texture` or `hint_depth_texture`
 * samples: rendered once per frame and camera, as the first such material draws, into a target
 * holding its colour (mipmapped, as `filter_linear_mipmap` reads it) and its depth. The meshes drawn
 * in the transparent pass (three's transparent materials, which those shaders' are) are left out,
 * as Godot copies the screen after its opaque pass (`RenderForwardClustered::_render_scene`).
 */
interface Capture {
  frame: number;
  camera: Camera | null;
  readonly target: WebGLRenderTarget;
}

const CAPTURES = new WeakMap<WebGLRenderer, Capture>();
let capturing = false;
const drawingSize = new ThreeVector2();

function capture(renderer: WebGLRenderer, scene: Scene, camera: Camera): Capture {
  const target = renderer.getRenderTarget();
  if (target === null) renderer.getDrawingBufferSize(drawingSize);
  else drawingSize.set(target.width, target.height);
  let held = CAPTURES.get(renderer);
  if (held === undefined) {
    const made = new WebGLRenderTarget(drawingSize.x, drawingSize.y, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, depthTexture: new DepthTexture(drawingSize.x, drawingSize.y) });
    held = { frame: -1, camera: null, target: made };
    CAPTURES.set(renderer, held);
  }
  if (held.frame === renderer.info.render.frame && held.camera === camera) return held;
  held.camera = camera;
  if (held.target.width !== drawingSize.x || held.target.height !== drawingSize.y) held.target.setSize(drawingSize.x, drawingSize.y);
  const hidden: Object3D[] = [];
  scene.traverseVisible((object) => {
    const material = (object as Mesh).material as Material | Material[] | undefined;
    if (material === undefined) return;
    if ((Array.isArray(material) ? material : [material]).some((entry) => entry.transparent)) hidden.push(object);
  });
  for (const object of hidden) object.visible = false;
  const shadows = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  capturing = true;
  renderer.setRenderTarget(held.target);
  renderer.clear();
  renderer.render(scene, camera);
  // The nested render counts a frame: the outer one's later draws read this capture.
  held.frame = renderer.info.render.frame;
  renderer.setRenderTarget(target);
  capturing = false;
  renderer.shadowMap.autoUpdate = shadows;
  for (const object of hidden) object.visible = true;
  return held;
}

/**
 * Godot's depth correction (`Projection::set_depth_correction`): Y flipped, and depth mapped to
 * reversed Z in [0, 1]; its inverse takes Godot's clip coordinates to three's.
 */
const DEPTH_CORRECTION_INVERSE = new Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -2, 1, 0, 0, 0, 1);

/**
 * `ambient_light_disabled` on a lit shader: neither the ambient light nor the indirect specular
 * (reflections, GI) reaches the surface (`scene_forward_clustered.glsl:1687`, `:1800`, `:2246`),
 * three's indirect irradiance and radiance zeroed before they are added.
 */
const AMBIENT_LIGHT_DISABLED = {
  '*': { '#include <lights_fragment_end>': 'irradiance = vec3(0.0);\niblIrradiance = vec3(0.0);\nradiance = vec3(0.0);\n#include <lights_fragment_end>' },
};

/**
 * The three material a ShaderMaterial of a spatial shader draws with, made once per material.
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_shader_material_three(material: ShaderMaterial): GodotSpatialMaterial {
  const held = THREE_MATERIALS.get(material);
  if (held !== undefined) return held;
  const lowered = material.shader?.lowered;
  const spatial = lowered?.spatial;
  if (lowered === undefined || spatial === undefined) throw new Error('godot-compat: a ShaderMaterial without a spatial shader draws no mesh.');
  const uniforms: Record<string, { value: unknown }> = { godot_TIME: { value: 0 }, godot_VIEWPORT_SIZE: { value: new ThreeVector2(1, 1) }, godot_INV_PROJECTION_MATRIX: { value: new Matrix4() } };
  const byName = new Map(lowered.uniforms.map((uniform) => [uniform.name, uniform] as const));
  for (const uniform of lowered.uniforms) {
    if (uniform.source !== undefined) {
      uniforms[uniform.glsl] = { value: null };
      continue;
    }
    const value = material.parameters.has(uniform.name) ? material.parameters.get(uniform.name) : uniform.default;
    uniforms[uniform.glsl] = { value: value === null ? (uniform.type.startsWith('sampler') ? null : uniformValue(uniform, [])) : uniformValue(uniform, value) };
  }
  const modes = new Set(lowered.renderModes);
  const made = new CustomShaderMaterial({
    baseMaterial: modes.has('unshaded') ? MeshBasicMaterial : MeshStandardMaterial,
    vertexShader: spatial.vertexShader,
    fragmentShader: spatial.fragmentShader,
    uniforms,
    transparent: spatial.transparent,
    vertexColors: spatial.vertexColors,
    side: modes.has('cull_disabled') ? DoubleSide : modes.has('cull_front') ? BackSide : FrontSide,
    ...(modes.has('blend_add') ? { blending: AdditiveBlending } : {}),
    // A transparent material writes depth only with `depth_draw_always`.
    depthWrite: !modes.has('depth_draw_never') && (!spatial.transparent || modes.has('depth_draw_always')),
    depthTest: !modes.has('depth_test_disabled'),
    ...(modes.has('ambient_light_disabled') && !modes.has('unshaded') ? { patchMap: AMBIENT_LIGHT_DISABLED } : {}),
  });
  // Each draw: the viewport's size and Godot's inverse projection, and the frame's capture for the
  // screen and depth textures it samples.
  const screen = lowered.uniforms.filter((uniform) => uniform.source !== undefined);
  made.onBeforeRender = (renderer, scene, camera) => {
    const target = renderer.getRenderTarget();
    const size = uniforms['godot_VIEWPORT_SIZE']?.value as ThreeVector2;
    if (target === null) renderer.getDrawingBufferSize(size);
    else size.set(target.width, target.height);
    (uniforms['godot_INV_PROJECTION_MATRIX']?.value as Matrix4).multiplyMatrices(camera.projectionMatrixInverse, DEPTH_CORRECTION_INVERSE);
    if (screen.length === 0 || capturing) return;
    const held = capture(renderer, scene, camera);
    for (const uniform of screen) (uniforms[uniform.glsl] as { value: unknown }).value = uniform.source === 'depth' ? held.target.depthTexture : held.target.texture;
  };
  material.listeners.add((name, value) => {
    const uniform = byName.get(name);
    if (uniform === undefined || uniform.source !== undefined) return;
    const slot = uniforms[uniform.glsl] as { value: unknown };
    slot.value = value === null || value === undefined ? uniformValue(uniform, uniform.default ?? []) : uniformValue(uniform, value);
  });
  const drawn = made as unknown as GodotSpatialMaterial;
  THREE_MATERIALS.set(material, drawn);
  OF_THREE.set(drawn, material);
  return drawn;
}
