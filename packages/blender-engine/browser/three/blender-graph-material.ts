/**
 * A COMPILED MATERIAL GRAPH ON THE PRESENTER'S STANDARD MATERIAL.
 *
 * The graph (`blender-node-graph.ts`) drives the surface inputs it carries;
 * everything else -- lighting, the physical inputs, the door's normal map --
 * stays three's MeshPhysicalMaterial with the door's constants. The graph's
 * program is spliced into that material's own shader at the chunk each input
 * is read in, so an input the graph drives is read from the graph and nothing
 * else about the material changes.
 *
 * Per draw, the geometry decides which attribute channel each named UV layer
 * is (`blenderUvChannels`, as the door's textures read it) and carries the
 * Generated coordinates as an `blenderOrco` attribute -- Blender's own orco,
 * built from the mesh's texture space (`orcoAttribute`).
 */
import * as THREE from 'three';
import {presenterChanged} from './blender-presenter-change';
import {attributeVarying, type CompiledGraph, rampTexture, uvVarying} from './blender-node-graph';
import {graphAttributeName} from './blender-runtime-geometry';

interface Binding {
  compiled: CompiledGraph;
  uniforms: Record<string, THREE.IUniform>;
  ramps: THREE.DataTexture[];
  /** Named UV layer to the channel the current draw's geometry holds it in. */
  channels: Record<string, number>;
}
const bindings = new WeakMap<THREE.MeshPhysicalMaterial, Binding>();
/** Graph structures whose program the GPU refused. A material whose graph is
 *  one of these is drawn from the door's constants instead -- a compiler
 *  defect must never make geometry disappear. */
const failed = new Set<string>();

export function materialGraph(material: THREE.MeshPhysicalMaterial): CompiledGraph | null {
  return bindings.get(material)?.compiled ?? null;
}

type ImageTexture = THREE.Texture | {tiles: THREE.Texture; map: THREE.Texture} | null;

/**
 * A NEW PROGRAM COMPILES OFF THE DRAW, as EEVEE's do: until it is ready the
 * material draws what it drew before (its previous graph, or the door's
 * constants), and the swap happens on the draw after `compileAsync` reports
 * the program linked (`bindGraphDraw`). A structural edit therefore never
 * blocks a frame on the GPU's compiler. A PHOTOGRAPH (`immediate`) cannot
 * wait for a later frame and switches at once.
 */
interface Pending {
  binding: Binding;
  started: boolean;
}
const pendings = new WeakMap<THREE.MeshPhysicalMaterial, Pending>();
/** The proxy material a swapped-in program was compiled through, disposed
 *  once the material itself holds that program (its second draw after). */
const retiring = new WeakMap<THREE.MeshPhysicalMaterial, {shadow: THREE.Material; draws: number}>();

function dropPending(material: THREE.MeshPhysicalMaterial): void {
  const waiting = pendings.get(material);
  if (!waiting) return;
  pendings.delete(material);
  for (const ramp of waiting.binding.ramps) ramp.dispose();
}

/** Point `material` at `compiled` (or at nothing). `texture` answers each
 *  image the graph samples; a new structure recompiles, new values do not. */
export function setMaterialGraph(
  material: THREE.MeshPhysicalMaterial,
  compiled: CompiledGraph | null,
  texture: (image: CompiledGraph['images'][number]) => ImageTexture,
  immediate = false,
): void {
  const held = bindings.get(material);
  if (compiled && failed.has(compiled.key)) compiled = null;
  if (!compiled) {
    dropPending(material);
    if (held) {
      for (const ramp of held.ramps) ramp.dispose();
      bindings.delete(material);
      material.needsUpdate = true;
    }
    return;
  }
  if (held && held.compiled.key === compiled.key) {
    dropPending(material);
    fill(held, compiled, texture);
    return;
  }
  if (immediate) {
    dropPending(material);
    for (const ramp of held?.ramps ?? []) ramp.dispose();
    const binding: Binding = {compiled, uniforms: {}, ramps: [], channels: held?.channels ?? {}};
    fill(binding, compiled, texture);
    bindings.set(material, binding);
    material.needsUpdate = true;
    return;
  }
  const waiting = pendings.get(material);
  if (waiting && waiting.binding.compiled.key === compiled.key) {
    fill(waiting.binding, compiled, texture);
    return;
  }
  dropPending(material);
  const binding: Binding = {compiled, uniforms: {}, ramps: [], channels: held?.channels ?? {}};
  fill(binding, compiled, texture);
  pendings.set(material, {binding, started: false});
}

/** A binding's values: uniforms, ramp tables and textures. */
function fill(binding: Binding, compiled: CompiledGraph, texture: (image: CompiledGraph['images'][number]) => ImageTexture): void {
  binding.compiled = compiled;
  for (const [name, value] of compiled.uniforms) {
    const next = typeof value === 'number' ? value
      : value.length === 2 ? new THREE.Vector2(...(value as [number, number]))
      : value.length === 3 ? new THREE.Vector3(...(value as [number, number, number]))
      : new THREE.Vector4(...(value as [number, number, number, number]));
    const uniform = binding.uniforms[name];
    if (uniform) uniform.value = next;
    else binding.uniforms[name] = {value: next};
  }
  for (const ramp of binding.ramps) ramp.dispose();
  binding.ramps = compiled.ramps.map(r => {
    const tex = rampTexture(r.table);
    (binding.uniforms[r.uniform] ??= {value: null}).value = tex;
    return tex;
  });
  for (const image of compiled.images) {
    const value = texture(image);
    if (image.tiled) {
      const tiled = value !== null && 'tiles' in value ? value : null;
      (binding.uniforms[image.uniform] ??= {value: null}).value = tiled?.tiles ?? null;
      (binding.uniforms[`${image.uniform}Map`] ??= {value: null}).value = tiled?.map ?? null;
    } else {
      (binding.uniforms[image.uniform] ??= {value: null}).value = value !== null && 'tiles' in value ? null : value;
    }
  }
}

/** Part of the material's program cache key: the graph's structure and the
 *  UV channels the current geometry puts its layers in. */
export function graphProgramKey(material: THREE.MeshPhysicalMaterial): string {
  const binding = bindings.get(material);
  if (!binding) return '';
  return `${binding.compiled.key}|${JSON.stringify(binding.channels)}`;
}

/** The channel each named UV layer is in on `geometry` (a layer the mesh
 *  lacks reads zeros from channel 9, Blender's missing attribute). */
function channelsFor(compiled: CompiledGraph, geometry: THREE.BufferGeometry): Record<string, number> {
  const named = geometry.userData['blenderUvChannels'] as Record<string, number> | undefined;
  const count = geometry.getAttribute('position')?.count ?? 0;
  const channels: Record<string, number> = {};
  for (const name of compiled.uvs) {
    let channel = name === '' ? 0 : named?.[name];
    if (channel === undefined) {
      channel = 9;
      if (geometry.getAttribute('uv9')?.count !== count)
        geometry.setAttribute('uv9', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    channels[name] = channel;
  }
  return channels;
}

/** Per draw: a pending program started compiling (see `Pending`), a compiled
 *  one swapped in, a refused one dropped, and the channel of each named layer
 *  on this geometry. `shadowOf` makes the proxy a program compiles through:
 *  the same material, hooks and all, bound to the pending graph. */
export function bindGraphDraw(material: THREE.MeshPhysicalMaterial, geometry: THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, object: THREE.Object3D,
  shadowOf: (material: THREE.MeshPhysicalMaterial) => THREE.MeshPhysicalMaterial): void {
  const retired = retiring.get(material);
  if (retired && ++retired.draws > 1) {
    retired.shadow.dispose();
    retiring.delete(material);
  }
  const waiting = pendings.get(material);
  if (waiting && !waiting.started) {
    waiting.started = true;
    waiting.binding.channels = channelsFor(waiting.binding.compiled, geometry);
    const shadow = shadowOf(material);
    bindings.set(shadow, waiting.binding);
    const proxy = new THREE.Mesh(geometry, shadow);
    proxy.castShadow = object.castShadow;
    proxy.receiveShadow = object.receiveShadow;
    const swap = () => {
      if (pendings.get(material) !== waiting) {
        shadow.dispose();
        return;
      }
      pendings.delete(material);
      for (const ramp of bindings.get(material)?.ramps ?? []) ramp.dispose();
      bindings.set(material, waiting.binding);
      material.needsUpdate = true;
      retiring.get(material)?.shadow.dispose();
      retiring.set(material, {shadow, draws: 0});
      presenterChanged();
    };
    // A program the GPU refuses is found on the material's own first draw
    // with it (below), exactly as an immediate one is.
    renderer.compileAsync(proxy, camera, scene).then(swap, swap);
  }
  const binding = bindings.get(material);
  if (!binding) return;
  // THE PROGRAM THE LAST DRAW USED, if the GPU refused it: fall back to the
  // constants from the next draw on, and say so once. Three has already
  // logged the compiler's own errors.
  const program = (renderer.properties.get(material) as {currentProgram?: unknown}).currentProgram as
    {cacheKey?: string; diagnostics?: {runnable: boolean; fragmentShader: {log: string}}} | undefined;
  if (program?.diagnostics?.runnable === false && program.cacheKey?.includes(binding.compiled.key)) {
    failed.add(binding.compiled.key);
    bindings.delete(material);
    material.needsUpdate = true;
    const first = program.diagnostics.fragmentShader.log.split('\n').find(line => line.startsWith('ERROR')) ?? '';
    console.warn(`Blender material "${material.name}": its node graph did not compile for WebGL, ` +
      `so it is drawn with its constant values. ${first}`);
    return;
  }
  const channels = channelsFor(binding.compiled, geometry);
  if (JSON.stringify(channels) !== JSON.stringify(binding.channels)) {
    binding.channels = channels;
    material.needsUpdate = true;
  }
}

/**
 * THE ORCO A GRAPH-DRAWN MESH CARRIES, set when the view gives a mesh its
 * materials -- never from a draw hook. Three uploads a geometry's attributes
 * before any draw hook runs, so an attribute first added there has no GPU
 * buffer on that draw and the shader reads zeros: invisible in a viewport
 * that draws again next frame, and a constant pattern in a render, which
 * draws once.
 */
export function prepareGraphGeometry(mesh: THREE.Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!materials.some(m => m instanceof THREE.MeshPhysicalMaterial && bindings.has(m))) return;
  const geometry = mesh.geometry;
  const texspace = (mesh.userData['blenderTexspace'] ?? null) as [number[], number[]] | null;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const stamp = JSON.stringify([texspace, position?.version ?? 0, position?.count ?? 0]);
  // A deformed mesh's orco came with its columns (`DrawArrays.orco`).
  if (!geometry.userData['blenderOrcoFromDoor'] && geometry.userData['blenderOrcoStamp'] !== stamp) {
    geometry.setAttribute('blenderOrco', orcoAttribute(geometry, texspace));
    geometry.userData['blenderOrcoStamp'] = stamp;
  }
  // THE ATTRIBUTES THE GRAPHS READ. The draw carries every readable layer
  // (`graphAttributeLayers`); '' is the mesh's default colour attribute
  // (`GPU_attribute_default_color`), and a layer the mesh lacks reads zeros,
  // as a missing attribute does in EEVEE.
  const count = position?.count ?? 0;
  const defaultColor = mesh.userData['blenderDefaultColor'] as string | undefined;
  for (const material of materials) {
    const binding = material instanceof THREE.MeshPhysicalMaterial ? bindings.get(material) : undefined;
    for (const name of binding?.compiled.attributes ?? []) {
      const target = graphAttributeName(name);
      const source = name === '' ? (defaultColor === undefined ? undefined : geometry.getAttribute(graphAttributeName(defaultColor)))
        : geometry.getAttribute(target);
      if (source && source.count === count) {
        if (geometry.getAttribute(target) !== source) geometry.setAttribute(target, source);
      } else if (geometry.getAttribute(target)?.count !== count) {
        geometry.setAttribute(target, new THREE.BufferAttribute(new Float32Array(count * 4), 4));
      }
    }
  }
}

/**
 * GENERATED COORDINATES, as EEVEE's `attr_load_orco` reads them for a mesh
 * without deformation: the position through the texture space,
 * `(co - location) / size * 0.5 + 0.5`. `texspace` is the evaluated mesh's
 * (`session.py` puts it on the object row); without one, the bounds are used,
 * which is what Blender's automatic texture space is.
 */
export function orcoAttribute(
  geometry: THREE.BufferGeometry,
  texspace: readonly [readonly number[], readonly number[]] | null,
): THREE.BufferAttribute {
  const position = geometry.getAttribute('position');
  let location: number[];
  let size: number[];
  if (texspace) {
    location = [...texspace[0]];
    size = [...texspace[1]];
  } else {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    location = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
    size = [(box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2, (box.max.z - box.min.z) / 2];
  }
  // BKE_mesh_texspace_calc: a zero extent becomes one.
  size = size.map(s => (s === 0 ? 1 : s));
  const orco = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    orco[i * 3] = (position.getX(i) - location[0]!) / size[0]! * 0.5 + 0.5;
    orco[i * 3 + 1] = (position.getY(i) - location[1]!) / size[1]! * 0.5 + 0.5;
    orco[i * 3 + 2] = (position.getZ(i) - location[2]!) / size[2]! * 0.5 + 0.5;
  }
  return new THREE.BufferAttribute(orco, 3);
}

/** Splice the graph into three's physical shader. Called from the material's
 *  own `onBeforeCompile` after its physical adjustments. */
export function applyGraphShader(material: THREE.MeshPhysicalMaterial, shader: THREE.WebGLProgramParametersWithUniforms): void {
  const binding = bindings.get(material);
  if (!binding) return;
  const {compiled, channels} = binding;
  Object.assign(shader.uniforms, binding.uniforms, {blenderViewport: {value: viewport}});
  const attribute = (channel: number) => (channel === 0 ? 'uv' : `uv${channel}`);
  const guards = [1, 2, 3].map(i => `#ifndef USE_UV${i}\nattribute vec2 uv${i};\n#endif`).join('\n');
  const varyings = `varying vec3 vBlenderObjectPosition;
varying vec3 vBlenderObjectNormal;
varying vec3 vBlenderWorldPosition;
varying vec3 vBlenderWorldNormal;
varying vec3 vBlenderOrco;
${compiled.attributes.map(n => `varying vec4 ${attributeVarying(n)};`).join('\n')}
${compiled.uvs.map(n => `varying vec2 ${uvVarying(n)};`).join('\n')}`;
  const attributes = compiled.attributes.map(n => `attribute vec4 ${graphAttributeName(n)};`).join('\n');
  shader.vertexShader = `${guards}\nattribute vec3 blenderOrco;\n${attributes}\n${varyings}\n${shader.vertexShader}`.replace(
    '#include <project_vertex>',
    `vBlenderObjectPosition = transformed;
vBlenderObjectNormal = objectNormal;
vBlenderWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBlenderWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * objectNormal);
vBlenderOrco = blenderOrco;
${compiled.attributes.map(n => `${attributeVarying(n)} = ${graphAttributeName(n)};`).join('\n')}
${compiled.uvs.map(n => `${uvVarying(n)} = ${attribute(channels[n] ?? 0)};`).join('\n')}
#include <project_vertex>`,
  );
  const out = (name: string) => compiled.outputs[name]?.global;
  // [chunk, line, whether the line goes BEFORE the chunk]
  const fragment: [string, string, boolean][] = [];
  if (compiled.surface === 'ShaderNodeEmission') {
    fragment.push(['#include <color_fragment>', 'diffuseColor = vec4(0.0, 0.0, 0.0, 1.0);', false]);
    fragment.push(['#include <emissivemap_fragment>', `totalEmissiveRadiance = ${out('Color')}.rgb * ${out('Strength')};`, false]);
    // An Emission surface reflects nothing: what leaves it is its emission.
    fragment.push(['#include <opaque_fragment>', 'outgoingLight = totalEmissiveRadiance;', true]);
  } else if (compiled.surface === 'closure') {
    // A mix with no lit shader: nothing reflects, the composition below is all.
    fragment.push(['#include <color_fragment>', 'diffuseColor = vec4(0.0, 0.0, 0.0, 1.0);', false]);
    fragment.push(['#include <emissivemap_fragment>', 'totalEmissiveRadiance = vec3(0.0);', false]);
  } else {
    fragment.push(['#include <color_fragment>', `diffuseColor.rgb = ${out('Base Color')}.rgb;`, false]);
    fragment.push(['#include <alphamap_fragment>', `diffuseColor.a = ${out('Alpha')};`, false]);
    // The physical material rewrites roughnessmap_fragment in place; the
    // chunk three reads next is metalnessmap_fragment.
    fragment.push(['#include <metalnessmap_fragment>', `roughnessFactor = ${out('Roughness')};`, true]);
    fragment.push(['#include <metalnessmap_fragment>', `metalnessFactor = ${out('Metallic')};`, false]);
    fragment.push(['#include <emissivemap_fragment>',
      `totalEmissiveRadiance = ${out('Emission Color')}.rgb * ${out('Emission Strength')};`, false]);
    // A linked Normal replaces three's shading normal (view space), after its
    // own normal map and before the clearcoat normal is derived from it.
    if (out('Normal'))
      fragment.push(['#include <clearcoat_normal_fragment_begin>',
        `normal = normalize((viewMatrix * vec4(transpose(blender_from_three) * ${out('Normal')}, 0.0)).xyz);`, true]);
  }
  if (compiled.closure) {
    // THE SHADER MIX'S COMPOSITION (`bgClosure*`), before three writes the
    // pixel: radiance is the lit shader's (its own alpha already a mix with
    // transparency) plus emission; transmittance is the transparent weight
    // plus what the lit shader's alpha lets through. Three blends straight
    // alpha, so the radiance goes out divided by the coverage.
    fragment.push(['#include <opaque_fragment>', `{
  float blenderCoverage = diffuseColor.a;
  vec3 blenderRadiance = bgClosureP * blenderCoverage * outgoingLight + bgClosureE;
  float blenderAlpha = 1.0 - min(bgClosureT + bgClosureP * (1.0 - blenderCoverage), 1.0);
#ifdef OPAQUE
  outgoingLight = blenderRadiance;
#else
  outgoingLight = blenderRadiance / max(blenderAlpha, 1e-4);
#endif
  diffuseColor.a = blenderAlpha;
}`, true]);
  }
  // MACROS BOTH SIDES DEFINE (three's `saturate` and Blender's, say): each
  // side's code is compiled under its own definition -- Blender's library
  // between an #undef and a restore of three's line.
  // The shader still names its chunks (`#include <common>`) at this point;
  // three expands them after this hook, so the scan expands them itself.
  const expand = (text: string): string => text.replace(/^[ \t]*#include <(\w+)>/gm,
    (_, name: string) => expand((THREE.ShaderChunk as Record<string, string>)[name] ?? ''));
  const head = expand(shader.fragmentShader.slice(0, shader.fragmentShader.indexOf('void main() {')));
  const theirs = new Map([...head.matchAll(/^[ \t]*#define[ \t]+(\w+).*$/gm)].map(m => [m[1]!, m[0]!.trim()]));
  const ours = new Set([...compiled.declarations.matchAll(/^[ \t]*#define[ \t]+(\w+)/gm)].map(m => m[1]!));
  const shared = [...ours].filter(name => theirs.has(name));
  const library = [
    ...shared.map(name => `#undef ${name}`),
    compiled.declarations,
    ...shared.flatMap(name => [`#undef ${name}`, theirs.get(name)!]),
  ].join('\n');
  let text = shader.fragmentShader.replace('void main() {', `${varyings}\n${library}\nvoid main() {`)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tblenderGraph();');
  for (const [chunk, line, before] of fragment) {
    if (!text.includes(chunk)) throw new Error(`three's physical shader has no ${chunk}`);
    text = text.replace(chunk, before ? `${line}\n${chunk}` : `${chunk}\n${line}`);
  }
  shader.fragmentShader = text;
}

/** The drawing buffer size `coordinate_screen` divides by, refreshed per frame. */
const viewport = new THREE.Vector2(1, 1);
export function setGraphViewport(renderer: THREE.WebGLRenderer): void {
  renderer.getDrawingBufferSize(viewport);
}
