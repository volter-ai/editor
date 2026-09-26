/**
 * Idiomatic scenes (GODOT.md, "The output is idiomatic three.js"): a scene whose nodes, properties
 * and resources all have an idiomatic mapping is written as React Three Fiber JSX with converted
 * literal values, `@react-three/rapier` bodies and `useGodotScript` attachments. Its proof
 * (`src/evidence/proofs/scene-idiomatic.ts`) runs the reference scene in official Godot and as the
 * emitted world, frame by frame, and compares what the nodes hold.
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
  type GodotSceneStructureRule,
  godotSceneStructureRuleKey,
} from '../scene-node-authority';

const IDENTITIES = godotProofIdentities('scene-idiomatic');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

export const GODOT_4_7_IDIOMATIC_STRUCTURE_RULES: readonly (GodotSceneStructureRule & {
  readonly source: Readonly<{ file: string; symbol: string; line: number }>;
})[] = [
  {
    sourceRevision: REVISION,
    id: 'idiomatic-scene',
    evidenceClaimId: 'godot-4.7-scene-structure-idiomatic-scene',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate', line: 400 },
  },
];

export const GODOT_4_7_IDIOMATIC_CLAIMS: readonly SemanticClaimRecord[] = GODOT_4_7_IDIOMATIC_STRUCTURE_RULES.map((rule) => ({
  registryVersion: 1,
  claimId: rule.evidenceClaimId,
  layer: 'translate-data',
  canonicalIdentity: godotSceneStructureRuleKey(rule.sourceRevision, rule.id),
  godot: {
    sourceRevision: REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    sourceFile: rule.source.file,
    sourceSymbol: rule.source.symbol,
    sourceLine: rule.source.line,
  },
  native: {
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
    inputSha256: IDENTITIES.input,
    callsite: 'res://observe.gd _physics_process()',
    observedOutputSha256: IDENTITIES.observed,
  },
  target: {
    implementationSha256: IDENTITIES.implementation,
    callsite: 'the emitted world module mounted by @react-three/fiber on a jsdom canvas, one advance() per frame',
    observedOutputSha256: IDENTITIES.observed,
  },
  comparison: {
    comparator: 'node tree, classes and script state exact; transforms and render mappings as the proof names them',
    tolerance: 'named per value in the proof',
    resultSha256: IDENTITIES.comparison,
  },
  reproductionCommand: GODOT_4_7_PROOF_REPRODUCTION_COMMAND,
}));

export const GODOT_4_7_IDIOMATIC_LIVENESS: readonly GodotSceneNodeClaimLiveness[] = GODOT_4_7_IDIOMATIC_CLAIMS.map((entry) => ({
  claimId: entry.claimId,
  sourceRevision: REVISION,
  apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  inputSha256: IDENTITIES.input,
  implementationSha256: IDENTITIES.implementation,
}));
