/**
 * THE SCENE AS GLTF, ANIMATION INCLUDED (`blender-export-gltf`, `docs/SCENE-ANIMATION.md` step 6): the
 * clips the editor plays, written so another engine (Godot, Unity, a viewer) plays the same.
 *
 * - THE MODEL is the presented scene (`BlenderRuntimeView.root`: meshes with their skins, materials,
 *   cameras, lights), through three.js's `GLTFExporter`.
 * - EVERY ARMATURE'S ACTIONS (its assigned action and its NLA strips' actions, a game's clip library)
 *   become one glTF animation each, `<armature>|<action>`: its bones' transforms as Blender sampled
 *   them (`blenderActionClip`, the clip door Play reads), on node channels.
 * - THE SCENE'S MOVIE (`blender-play-movie.ts`) becomes the animation `Scene`: the moving objects and
 *   cameras on node channels, the shape keys as morph target weights.
 * - A MATERIAL'S KEYED INPUTS (base colour, alpha, emission) become `KHR_animation_pointer` channels on
 *   the material in the animation `Materials`; an emission over 1 is carried by
 *   `KHR_materials_emissive_strength`.
 *
 * What glTF has no channel for is named, not written: a keyed visibility, constraints (an export
 * holds them as the frame does).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import { mixerClip } from './blender-mixer-pose';
import { playMovie } from './blender-play-movie';
import type { BlenderActionClip, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';

/** A glTF document as JSON, as far as this file writes into it. */
interface GltfJson {
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] }; emissiveFactor?: number[]; extensions?: Record<string, unknown> }[];
  animations?: { name?: string; samplers: { input: number; output: number; interpolation: string }[]; channels: unknown[] }[];
  accessors?: unknown[];
  bufferViews?: unknown[];
  buffers?: { byteLength: number; uri?: string }[];
  extensionsUsed?: string[];
}

/** What a model's geometry carries into glTF: the standard attributes. Everything else on a drawn
 *  geometry is the presenter's (the drawn vertex's Blender vertex, its orco, a shading's inputs). */
const MODEL_ATTRIBUTES = new Set(['position', 'normal', 'tangent', 'uv', 'uv1', 'uv2', 'uv3', 'color', 'skinIndex', 'skinWeight']);

/** One keyed material input, as the movie plays it on a presented mesh. */
interface Pointer { readonly material: THREE.Material; readonly prop: 'color' | 'emissive' | 'opacity'; readonly track: THREE.KeyframeTrack }

export interface GltfExport {
  readonly json: GltfJson;
  readonly animations: readonly string[];
  readonly pointers: number;
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
}

/** Write the presented scene and its animation as a glTF document (JSON, buffers and images inline). */
export async function exportSceneGltf(view: BlenderRuntimeView,
  read: { clip(armature: string, action: string): Promise<BlenderActionClip | null>; movie(): Promise<BlenderSceneMovie | null> }): Promise<GltfExport> {
  const clips: THREE.AnimationClip[] = [];
  const failed: string[] = [];
  const skipped = new Set<string>();
  // EVERY ARMATURE'S ACTIONS: one animation each
  const facts = view.animationFacts();
  for (const rig of view.skeletons.rigs()) {
    const entry = facts.armatures[rig.armature];
    if (!entry) continue;
    const names = new Set<string>();
    if (entry.action) names.add(entry.action);
    for (const track of entry.animation?.tracks ?? []) for (const strip of track.strips) if (strip.action) names.add(strip.action);
    for (const action of [...names].sort()) {
      try {
        const baked = await read.clip(rig.armature, action);
        const clip = baked ? mixerClip(baked) : null;
        if (!clip) continue;
        const frames = Math.max(1, Math.round(clip.end - clip.start) + 1);
        const times = Float32Array.from({ length: frames }, (_, i) => i / clip.fps);
        const column = (values: Float32Array, stride: number): [Float32Array, Float32Array] =>
          values.length === stride ? [new Float32Array([0]), values] : [times.slice(0, values.length / stride), values];
        const tracks: THREE.KeyframeTrack[] = [];
        for (const [name, sampled] of clip.bones) {
          const bone = rig.bones.get(name);
          if (!bone) continue;
          tracks.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, ...column(sampled.position, 3)));
          tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, ...column(sampled.quaternion, 4)));
          tracks.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.scale`, ...column(sampled.scale, 3)));
        }
        if (tracks.length) clips.push(new THREE.AnimationClip(`${rig.armature}|${action}`, (frames - 1) / clip.fps, tracks));
      } catch (error) {
        failed.push(`${rig.armature} / ${action}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // THE SCENE'S MOVIE: objects and cameras, shape keys (morph weights), and materials (pointers below),
  // with the meshes in their own materials whatever the viewport shows
  const data = await read.movie();
  return view.withAuthoredMaterials(async () => {
  const movie = data ? playMovie(view, data, new THREE.AnimationMixer(view.root)) : null;
  for (const warning of movie?.warnings ?? []) skipped.add(warning);
  const pointers: Pointer[] = [];
  const sceneTracks: THREE.KeyframeTrack[] = [];
  for (const clip of movie?.clips() ?? []) {
    for (const track of clip.tracks) {
      const material = /^([^.]+)\.material(?:\[(\d+)\])?\.(color|emissive|opacity)$/.exec(track.name);
      if (material) {
        const mesh = view.root.getObjectByProperty('uuid', material[1]!) as THREE.Mesh | undefined;
        const worn = mesh ? (Array.isArray(mesh.material) ? mesh.material[Number(material[2] ?? 0)] : mesh.material) : undefined;
        if (worn) pointers.push({ material: worn, prop: material[3] as Pointer['prop'], track });
        continue;
      }
      if (track.name.endsWith('.visible')) { skipped.add('a keyed visibility (glTF has no channel for it)'); continue; }
      sceneTracks.push(track);
    }
  }
  if (sceneTracks.length) clips.push(new THREE.AnimationClip('Scene', -1, sceneTracks));
  view.root.updateMatrixWorld(true);
  // THE PRESENTER'S OWN ATTRIBUTES (the drawn vertex's Blender vertex, its orco, the Solid shading's
  // hints) are the editor's bookkeeping, not the model's: set aside while it writes
  const aside: [THREE.BufferGeometry, string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][] = [];
  view.root.traverse((object) => {
    const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!geometry?.attributes) return;
    for (const name of Object.keys(geometry.attributes)) {
      if (MODEL_ATTRIBUTES.has(name)) continue;
      aside.push([geometry, name, geometry.getAttribute(name)]);
      geometry.deleteAttribute(name);
    }
  });
  let json: GltfJson;
  try {
    json = (await new GLTFExporter().parseAsync(view.root, { binary: false, animations: clips, onlyVisible: false })) as GltfJson;
  } finally {
    for (const [geometry, name, attribute] of aside) geometry.setAttribute(name, attribute);
    movie?.dispose();
  }
  writePointers(json, pointers);
  return { json, animations: (json.animations ?? []).map((one) => one.name ?? ''), pointers: pointers.length, skipped: [...skipped], failed };
  });
}

/** THE MATERIALS' ANIMATION as `KHR_animation_pointer` channels, with their keys in a buffer of their own. */
function writePointers(json: GltfJson, pointers: readonly Pointer[]): void {
  // AN EMISSION OVER 1 (a glow the movie set, an emission strength) is a factor of at most 1 times a strength
  for (const material of json.materials ?? []) {
    const factor = material.emissiveFactor;
    const top = factor ? Math.max(...factor) : 0;
    if (!factor || top <= 1) continue;
    material.emissiveFactor = factor.map((one) => one / top);
    const had = (material.extensions?.['KHR_materials_emissive_strength'] as { emissiveStrength?: number } | undefined)?.emissiveStrength ?? 1;
    material.extensions = { ...material.extensions, KHR_materials_emissive_strength: { emissiveStrength: had * top } };
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_emissive_strength'])];
  }
  if (!pointers.length) return;
  const accessors = (json.accessors ??= []);
  const views = (json.bufferViews ??= []);
  const buffers = (json.buffers ??= []);
  const chunks: Float32Array[] = [];
  let offset = 0;
  const buffer = buffers.length;
  const accessor = (values: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', bounds = false): number => {
    views.push({ buffer, byteOffset: offset, byteLength: values.byteLength });
    const size = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
    accessors.push({
      bufferView: views.length - 1, componentType: 5126, count: values.length / size, type,
      ...(bounds ? { min: [Math.min(...values)], max: [Math.max(...values)] } : {}),
    });
    chunks.push(values);
    offset += values.byteLength;
    return accessors.length - 1;
  };
  const samplers: { input: number; output: number; interpolation: string }[] = [];
  const channels: unknown[] = [];
  const used = new Set<string>(['KHR_animation_pointer']);
  const channel = (times: Float32Array, values: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', pointer: string): void => {
    samplers.push({ input: accessor(times, 'SCALAR', true), output: accessor(values, type), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer } } } });
  };
  const byMaterial = new Map<THREE.Material, Partial<Record<Pointer['prop'], THREE.KeyframeTrack>>>();
  for (const one of pointers) byMaterial.set(one.material, { ...byMaterial.get(one.material), [one.prop]: one.track });
  for (const [material, props] of byMaterial) {
    const index = (json.materials ?? []).findIndex((one) => one.name === material.name);
    if (index < 0) continue;
    const own = material as THREE.MeshStandardMaterial;
    // BASE COLOUR AND ALPHA are one glTF factor
    if (props.color || props.opacity) {
      const times = (props.color ?? props.opacity)!.times as Float32Array;
      const color = props.color?.values as Float32Array | undefined;
      const alpha = props.opacity?.values as Float32Array | undefined;
      const values = new Float32Array(times.length * 4);
      for (let i = 0; i < times.length; i++) {
        values[i * 4] = color ? color[Math.min(i, color.length / 3 - 1) * 3]! : own.color?.r ?? 1;
        values[i * 4 + 1] = color ? color[Math.min(i, color.length / 3 - 1) * 3 + 1]! : own.color?.g ?? 1;
        values[i * 4 + 2] = color ? color[Math.min(i, color.length / 3 - 1) * 3 + 2]! : own.color?.b ?? 1;
        values[i * 4 + 3] = alpha ? alpha[Math.min(i, alpha.length - 1)]! : own.opacity ?? 1;
      }
      channel(times, values, 'VEC4', `/materials/${index}/pbrMetallicRoughness/baseColorFactor`);
    }
    // EMISSION: glTF's factor is at most 1; the strength over it goes in KHR_materials_emissive_strength
    if (props.emissive) {
      const times = props.emissive.times as Float32Array;
      const glow = props.emissive.values as Float32Array;
      const count = Math.min(times.length, glow.length / 3);
      const factor = new Float32Array(count * 3);
      const strength = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const top = Math.max(1, glow[i * 3]!, glow[i * 3 + 1]!, glow[i * 3 + 2]!);
        strength[i] = top;
        for (let c = 0; c < 3; c++) factor[i * 3 + c] = glow[i * 3 + c]! / top;
      }
      channel(times.slice(0, count), factor, 'VEC3', `/materials/${index}/emissiveFactor`);
      if (strength.some((one) => one > 1)) {
        const entry = json.materials![index]!;
        entry.extensions = { ...entry.extensions, KHR_materials_emissive_strength: { emissiveStrength: Math.max(...strength) } };
        used.add('KHR_materials_emissive_strength');
        channel(times.slice(0, count), strength, 'SCALAR', `/materials/${index}/extensions/KHR_materials_emissive_strength/emissiveStrength`);
      }
    }
  }
  if (!channels.length) return;
  const bytes = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) { bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), at); at += chunk.byteLength; }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  buffers.push({ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` });
  (json.animations ??= []).push({ name: 'Materials', samplers, channels });
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), ...used])];
}
