/**
 * Particles: `CPUParticles3D` nodes (compat's `<GodotCPUParticles3D>`, its simulation transcribed,
 * drawing its mesh as an `InstancedMesh`), the `Curve` and `Gradient` resources their parameters
 * take, the `GradientTexture2D` a material samples, and `ReflectionProbe` nodes (the game editor's
 * reflections capability). Their own proof (`src/evidence/proofs/scene-particles.ts`) instantiates
 * them in official Godot and reads each system's multimesh buffer frame by frame, its material,
 * the gradient texture and the probe back, against the emitted scene mounted in Node and stepped by
 * compat's tree clock.
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

const PARTICLE_IDENTITIES = godotProofIdentities('scene-particles');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_PARTICLE_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('CPUParticles3D'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-cpu-particles-3d',
    source: { file: 'scene/3d/cpu_particles_3d.cpp', symbol: 'CPUParticles3D::CPUParticles3D', line: 1812 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('ReflectionProbe'),
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-reflection-probe',
    source: { file: 'scene/3d/reflection_probe.cpp', symbol: 'ReflectionProbe::ReflectionProbe', line: 308 },
  },
];

export const GODOT_4_7_PARTICLE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['Curve', 'curve', 'godot_curve_new', 'scene/resources/curve.cpp', 41],
    ['Gradient', 'gradient', 'godot_gradient_new', 'scene/resources/gradient.cpp', 36],
    ['GradientTexture2D', 'gradient-texture-2d', 'godot_gradient_texture_2d_new', 'scene/resources/gradient_texture.cpp', 193],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  evidenceClaimId: `godot-4.7-scene-resource-${module}`,
  source: { file, symbol: `${className}::${className}`, line },
}));

function particleClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: PARTICLE_IDENTITIES.input,
      callsite: 'res://observe.gd process_frame',
      observedOutputSha256: PARTICLE_IDENTITIES.observed,
    },
    target: {
      implementationSha256: PARTICLE_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber, stepped by compat scene-tree, read through compat',
      observedOutputSha256: PARTICLE_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'per-frame multimesh buffers (transform rows, colour, custom) and emitting state exact equality',
      tolerance: 'exact',
      resultSha256: PARTICLE_IDENTITIES.comparison,
    },
    reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
  };
}

export const GODOT_4_7_PARTICLE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_PARTICLE_RESOURCE_RULES.map((rule) =>
    particleClaim(godotSceneResourceRuleKey(rule.sourceRevision, rule.className), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_PARTICLE_NODE_RULES.map((rule) =>
    particleClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_PARTICLE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_PARTICLE_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: PARTICLE_IDENTITIES.input,
  implementationSha256: PARTICLE_IDENTITIES.implementation,
}));
