import type { ToolContext } from '@vgai/sdk/tools';
import type * as THREE from 'three';
import type { Object3DSourceBuild } from '../bake/object3d-source';
import {
  collectMorphTargets,
  exportObject3DToGlb,
  type GlbValidationOptions,
  installNodeThreePolyfills,
  validateExportedGlb,
} from './gltf-bake';

type SourceFacts = Record<string, unknown>;

type ToolOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function captureOutcome<T>(operation: Promise<T>): Promise<ToolOutcome<T>> {
  try {
    return { ok: true, value: await operation };
  } catch (error) {
    return { ok: false, error };
  }
}

export interface Object3DBakeOptions<
  TBuild extends Object3DSourceBuild,
  TFacts extends SourceFacts,
> {
  ctx: ToolContext;
  name: string;
  dryRun: boolean;
  build(): TBuild;
  resolveAnimations?(
    build: TBuild,
  ): readonly THREE.AnimationClip[] | Promise<readonly THREE.AnimationClip[]>;
  validateSource?(build: TBuild, animations: readonly THREE.AnimationClip[]): void | Promise<void>;
  /** Round-trip validation thresholds. May be a function of the built source
   *  so source-derived facts (bone count, a sampled vertex color) can be
   *  asserted against the reimported GLB. `requiredClips` and
   *  `requiredMorphTargets` are NOT settable here: both are read off the built
   *  source below, so no lib can bake an asset that quietly asserts less than
   *  what it authored. */
  validation:
    | Omit<GlbValidationOptions, 'requiredClips' | 'requiredMorphTargets'>
    | ((build: TBuild) => Omit<GlbValidationOptions, 'requiredClips' | 'requiredMorphTargets'>);
  inspectSource(build: TBuild): TFacts;
}

/**
 * Compile an ordinary Object3D factory into the runtime asset pair. This is a
 * build helper, not a modeling abstraction: geometry, materials, hierarchy,
 * rigging, and animation remain native Three.js in the caller.
 */
export async function bakeObject3DSource<
  TBuild extends Object3DSourceBuild,
  TFacts extends SourceFacts,
>(options: Object3DBakeOptions<TBuild, TFacts>) {
  const { ctx } = options;
  const projectOutputs = ctx.projectOutputs;
  if (!projectOutputs) throw new Error('Object3D baking requires a project output writer.');
  if (ctx.signal?.aborted) throw new Error('Object3D baking was cancelled.');

  const restoreGlobals = installNodeThreePolyfills();
  let built: TBuild | undefined;
  const runOperation = async () => {
    const currentBuild = options.build();
    built = currentBuild;
    const animations = options.resolveAnimations
      ? await options.resolveAnimations(currentBuild)
      : (currentBuild.animations ?? []);
    await options.validateSource?.(currentBuild, animations);

    const requiredMorphTargets = collectMorphTargets(currentBuild.root);
    const glb = await exportObject3DToGlb(currentBuild.root, animations);
    const validationOptions =
      typeof options.validation === 'function'
        ? options.validation(currentBuild)
        : options.validation;
    const validation = await validateExportedGlb(glb, {
      ...validationOptions,
      requiredClips: animations.map((clip) => clip.name),
      requiredMorphTargets,
    });
    const model = `public/models/generated/${options.name}.glb`;
    const output = await projectOutputs.write(
      [{ path: model, content: glb, mediaType: 'model/gltf-binary', role: 'asset' }],
      { dryRun: options.dryRun },
    );
    return {
      model,
      ...options.inspectSource(currentBuild),
      ...validation,
      ...output,
    };
  };

  const outcome = await captureOutcome(runOperation());
  const operationError = outcome.ok ? undefined : outcome.error;

  const cleanupErrors: unknown[] = [];
  if (built) {
    try {
      built.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    restoreGlobals();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      operationError === undefined ? cleanupErrors : [operationError, ...cleanupErrors],
      'Object3D baking failed to clean up completely.',
    );
  }
  if (operationError !== undefined) throw operationError;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
