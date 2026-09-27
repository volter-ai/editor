/**
 * GPU particles: `GPUParticles3D` nodes (compat's `<GodotGPUParticles3D>`: the Compatibility
 * renderer's particle pass on the page's WebGL2 context, Godot's own `particles.glsl` with each
 * process material's generated shader), the `ParticleProcessMaterial` that generates the shader,
 * and the `CurveTexture` and `GradientTexture1D` its parameters sample. Their proof
 * (`src/evidence/proofs/scene-gpu-particles.ts`) runs official Godot in a window on the
 * Compatibility renderer and reads each system's `capture_aabb()` frame by frame, against the
 * emitted scene in headless Chromium stepped by compat's clock at the same fixed rate.
 */
import {
  GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  godotProofIdentities,
} from '../../../godot-frontend/proof-identities';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import {
  type GodotSceneNodeClaimLiveness,
  type GodotSceneNodeRule,
  godotSceneNodeRuleKey,
  type GodotSceneResourceRule,
  godotSceneResourceRuleKey,
} from '../scene-node-authority';

const IDENTITIES = godotProofIdentities('scene-gpu-particles');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_GPU_PARTICLE_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('GPUParticles3D'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-gpu-particles-3d',
    source: { file: 'scene/3d/gpu_particles_3d.cpp', symbol: 'GPUParticles3D::GPUParticles3D', line: 933 },
  },
];

export const GODOT_4_7_GPU_PARTICLE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['ParticleProcessMaterial', 'particle-process-material', 'godot_particle_process_material_new', 'scene/resources/particle_process_material.cpp', 2747],
    // No constructor of its own: the class declaration.
    ['CurveTexture', 'curve-texture', 'godot_curve_texture_new', 'scene/resources/curve_texture.h', 36],
    ['GradientTexture1D', 'gradient-texture-1d', 'godot_gradient_texture_1d_new', 'scene/resources/gradient_texture.cpp', 38],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

function gpuParticleClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId,
    layer: 'translate-data',
    canonicalIdentity,
    godot: {
      sourceRevision: REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f, windowed, gl_compatibility, --fixed-fps 60',
      inputSha256: IDENTITIES.input,
      callsite: 'res://observe.gd _process',
      observedOutputSha256: IDENTITIES.observed,
    },
    target: {
      implementationSha256: IDENTITIES.implementation,
      callsite: 'emitted world in headless Chromium (WebGL2), stepped at compat fixed fps 60, read through compat',
      observedOutputSha256: IDENTITIES.observed,
    },
    comparison: {
      comparator: 'per-frame capture_aabb() of each system and its emitting state',
      tolerance: 'float32 components within 4 ulps (both sides simulate on the GPU)',
      resultSha256: IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_GPU_PARTICLE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_GPU_PARTICLE_RESOURCE_RULES.map((rule) =>
    gpuParticleClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_GPU_PARTICLE_NODE_RULES.map((rule) =>
    gpuParticleClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_GPU_PARTICLE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_GPU_PARTICLE_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: IDENTITIES.input,
  implementationSha256: IDENTITIES.implementation,
}));
