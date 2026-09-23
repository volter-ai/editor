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
import {type CompiledGraph, rampTexture, uvVarying} from './blender-node-graph';

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

/** Point `material` at `compiled` (or at nothing). `texture` answers each
 *  image the graph samples; a new structure recompiles, new values do not. */
export function setMaterialGraph(
  material: THREE.MeshPhysicalMaterial,
  compiled: CompiledGraph | null,
  texture: (image: CompiledGraph['images'][number]) => THREE.Texture | null,
): void {
  const held = bindings.get(material);
  if (compiled && failed.has(compiled.key)) compiled = null;
  if (!compiled) {
    if (held) {
      for (const ramp of held.ramps) ramp.dispose();
      bindings.delete(material);
      material.needsUpdate = true;
    }
    return;
  }
  let binding = held;
  if (!binding || binding.compiled.key !== compiled.key) {
    for (const ramp of held?.ramps ?? []) ramp.dispose();
    binding = {compiled, uniforms: {}, ramps: [], channels: held?.channels ?? {}};
    bindings.set(material, binding);
    material.needsUpdate = true;
  }
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
  for (const image of compiled.images)
    (binding.uniforms[image.uniform] ??= {value: null}).value = texture(image);
}

/** Part of the material's program cache key: the graph's structure and the
 *  UV channels the current geometry puts its layers in. */
export function graphProgramKey(material: THREE.MeshPhysicalMaterial): string {
  const binding = bindings.get(material);
  if (!binding) return '';
  return `${binding.compiled.key}|${JSON.stringify(binding.channels)}`;
}

/** Per draw: the channel each named layer is in on this geometry (a layer the
 *  mesh lacks reads zeros, Blender's missing attribute), and the orco. */
export function bindGraphDraw(material: THREE.MeshPhysicalMaterial, geometry: THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer): void {
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
  const named = geometry.userData['blenderUvChannels'] as Record<string, number> | undefined;
  const count = geometry.getAttribute('position')?.count ?? 0;
  const channels: Record<string, number> = {};
  for (const name of binding.compiled.uvs) {
    let channel = name === '' ? 0 : named?.[name];
    if (channel === undefined) {
      channel = 9;
      if (geometry.getAttribute('uv9')?.count !== count)
        geometry.setAttribute('uv9', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    channels[name] = channel;
  }
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
  if (geometry.userData['blenderOrcoStamp'] !== stamp) {
    geometry.setAttribute('blenderOrco', orcoAttribute(geometry, texspace));
    geometry.userData['blenderOrcoStamp'] = stamp;
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
${compiled.uvs.map(n => `varying vec2 ${uvVarying(n)};`).join('\n')}`;
  shader.vertexShader = `${guards}\nattribute vec3 blenderOrco;\n${varyings}\n${shader.vertexShader}`.replace(
    '#include <project_vertex>',
    `vBlenderObjectPosition = transformed;
vBlenderObjectNormal = objectNormal;
vBlenderWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBlenderWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * objectNormal);
vBlenderOrco = blenderOrco;
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
  } else {
    fragment.push(['#include <color_fragment>', `diffuseColor.rgb = ${out('Base Color')}.rgb;`, false]);
    fragment.push(['#include <alphamap_fragment>', `diffuseColor.a = ${out('Alpha')};`, false]);
    // The physical material rewrites roughnessmap_fragment in place; the
    // chunk three reads next is metalnessmap_fragment.
    fragment.push(['#include <metalnessmap_fragment>', `roughnessFactor = ${out('Roughness')};`, true]);
    fragment.push(['#include <metalnessmap_fragment>', `metalnessFactor = ${out('Metallic')};`, false]);
    fragment.push(['#include <emissivemap_fragment>',
      `totalEmissiveRadiance = ${out('Emission Color')}.rgb * ${out('Emission Strength')};`, false]);
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
