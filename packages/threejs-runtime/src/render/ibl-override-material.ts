/**
 * Replace Three's image-based-lighting functions on a `MeshStandardMaterial`,
 * per fragment, without forking three.
 *
 * A local-probe system cannot express itself as `material.envMap`: one envMap
 * per object picks ONE environment for the whole draw, and the decisive work —
 * which probe volume contains this fragment, how it fades at the boundary,
 * what happens where volumes overlap — is per-fragment and can differ across a
 * single `InstancedMesh`. Every such system therefore does the same three
 * things to three's own program, and this module is that shared mechanism:
 *
 *   1. take `ShaderChunk.envmap_physical_pars_fragment` and rename its two
 *      entry points, so the caller's replacement can still call them as its
 *      fallback ({@link baseIblFunctions});
 *   2. publish the fragment's world position as a varying, spliced into
 *      `<worldpos_vertex>` under `USE_ENVMAP` ({@link IBL_WORLD_POSITION});
 *   3. swap the fragment chunk for the caller's own GLSL and extend the
 *      program cache key so the variant is not shared with an unpatched
 *      material ({@link overrideMaterialIbl}).
 *
 * What the caller keeps is exactly what makes its system ITS system: the
 * lighting model in the GLSL body, the uniforms behind it, and how probes are
 * discovered, scheduled and captured. This module decides none of that — it
 * hands back three's own shader object and gets out of the way.
 *
 * Consumers today: the `reflections` capability's native probe system, and
 * `godot-compat`'s Godot `ReflectionProbe`, whose per-fragment models are
 * deliberately different renderers over this one splice.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
import {
  CubeUVReflectionMapping,
  DataTexture,
  type Mesh,
  type MeshStandardMaterial,
  RGBAFormat,
  ShaderChunk,
  type Texture,
  UnsignedByteType,
} from 'three';

/** The shader object three hands to `onBeforeCompile`. */
export type IblOverrideShader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

/**
 * The `varying vec3` the vertex splice publishes and the fragment body reads.
 *
 * It is ONE name across every consumer on purpose: the splice that declares it
 * lives here, so a per-consumer name would be a string two files have to agree
 * on with nothing checking that they do.
 */
export const IBL_WORLD_POSITION = 'vgaiIblWorldPosition';

/**
 * Three's own IBL chunk with `getIBLIrradiance`/`getIBLRadiance` renamed to
 * `getBaseIBLIrradiance`/`getBaseIBLRadiance`.
 *
 * A replacement chunk defines the original names itself; calling the renamed
 * pair is how it falls back to the scene environment where no probe applies.
 */
export function baseIblFunctions(): string {
  return ShaderChunk.envmap_physical_pars_fragment
    .replaceAll('getIBLIrradiance', 'getBaseIBLIrradiance')
    .replaceAll('getIBLRadiance', 'getBaseIBLRadiance');
}

/**
 * Every material a mesh draws with that {@link overrideMaterialIbl} accepts.
 *
 * `isMeshStandardMaterial` is true for `MeshPhysicalMaterial` too, which is the
 * intent: both compile the physical IBL chunk this module replaces.
 */
export function standardMaterialsOf(mesh: Mesh): readonly MeshStandardMaterial[] {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.filter((material): material is MeshStandardMaterial =>
    Boolean((material as MeshStandardMaterial).isMeshStandardMaterial),
  );
}

/**
 * A black native texture whose only job is to compile Three's IBL branch.
 *
 * Local reflection systems can light a scene from captured probes when neither
 * `scene.environment` nor a material `envMap` exists. Three removes both IBL
 * entry points from that program unless one native input is present, so the
 * caller temporarily assigns this neutral texture and restores what it found.
 */
export function createIblSentinelTexture(): Texture {
  const texture = new DataTexture(
    new Uint8Array(16 * 16 * 4),
    16,
    16,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.mapping = CubeUVReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export interface IblOverrideOptions {
  /**
   * The GLSL that replaces `#include <envmap_physical_pars_fragment>`. Read at
   * COMPILE time, not at install time, so a caller whose probe count is still
   * settling does not have to reinstall to change it.
   */
  readonly fragment: () => string;
  /**
   * Appended to the material's own `customProgramCacheKey`, after a `|`. Must
   * distinguish every shape of {@link IblOverrideOptions.fragment} the caller
   * can produce — a probe COUNT belongs in here, because it changes the
   * declared uniform array sizes.
   */
  readonly cacheKey: () => string;
  /**
   * Runs at the end of `onBeforeCompile`, with the shader three is compiling.
   * Seed uniforms here: this is the only moment the caller is handed the
   * object whose `uniforms` map the program will read.
   */
  readonly onCompile?: (shader: IblOverrideShader) => void;
}

export interface IblOverride {
  readonly material: MeshStandardMaterial;
  /**
   * The shader three compiled this material with, or null before the first
   * compile and after {@link IblOverride.restore}. Uniform writes go through
   * `shader.uniforms`.
   */
  readonly shader: IblOverrideShader | null;
  /** Put the material's own `onBeforeCompile`/`customProgramCacheKey` back. */
  restore(): void;
}

/**
 * Install the override. The returned handle is the only way to reach the
 * compiled shader or to undo the patch; the material is otherwise untouched
 * (in particular this never assigns `envMap`, which stays the caller's).
 *
 * The caller's own `onBeforeCompile` runs FIRST and its result is what gets
 * spliced, so an override composes over a material that already had one.
 */
export function overrideMaterialIbl(
  material: MeshStandardMaterial,
  options: IblOverrideOptions,
): IblOverride {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  let compiled: IblOverrideShader | null = null;

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    requireChunk(shader.vertexShader, '#include <worldpos_vertex>');
    requireChunk(shader.fragmentShader, '#include <envmap_physical_pars_fragment>');
    shader.vertexShader = `varying vec3 ${IBL_WORLD_POSITION};\n${shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
#if defined(USE_ENVMAP)
  ${IBL_WORLD_POSITION} = worldPosition.xyz;
#endif`,
    )}`;
    shader.fragmentShader = `varying vec3 ${IBL_WORLD_POSITION};\n${shader.fragmentShader.replace(
      '#include <envmap_physical_pars_fragment>',
      options.fragment(),
    )}`;
    compiled = shader;
    options.onCompile?.(shader);
  };
  material.customProgramCacheKey = () => `${previousCacheKey.call(material)}|${options.cacheKey()}`;
  material.needsUpdate = true;

  return {
    material,
    get shader() {
      return compiled;
    },
    restore() {
      material.onBeforeCompile = previousCompile;
      material.customProgramCacheKey = previousCacheKey;
      material.needsUpdate = true;
      compiled = null;
    },
  };
}

/**
 * A missing chunk is a NAMED error rather than a silent no-op.
 *
 * `String.replace` with no match returns the string unchanged, which would
 * leave the varying declared and never assigned — a shader that links and
 * renders the wrong thing. The only way to reach this today is a preceding
 * `onBeforeCompile` in the same chain having already replaced the chunk (two
 * IBL overrides stacked on one material), and that is worth a message naming
 * the chunk instead of a black frame.
 */
function requireChunk(source: string, chunk: string): void {
  if (source.includes(chunk)) return;
  throw new Error(
    `overrideMaterialIbl needs three's ${chunk} shader chunk, and this material's program no longer contains it.`,
  );
}
