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
  type GodotScenePlacementRule,
  type GodotScenePropertyRule,
  godotSceneNodeRuleKey,
  godotScenePlacementRuleKey,
  godotScenePropertyRuleKey,
} from '../scene-node-authority';

const SCENE_NODES_IDENTITIES = godotProofIdentities('scene-nodes');
export const GODOT_4_7_SCENE_NODE_INPUT_SHA256 = SCENE_NODES_IDENTITIES.input;
export const GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256 = SCENE_NODES_IDENTITIES.implementation;
export const GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256 = SCENE_NODES_IDENTITIES.observed;
export const GODOT_4_7_SCENE_NODE_COMPARISON_SHA256 = SCENE_NODES_IDENTITIES.comparison;

const NODE_3D_IDENTITY = `${GODOT_4_7_CODE_SEED_SOURCE_REVISION}\0ClassDB\0Node3D`;

export const GODOT_4_7_SCENE_NODE_RULES: readonly GodotSceneNodeRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    targetKind: 'three-group',
    evidenceClaimId: 'godot-4.7-scene-node-node3d-group',
  },
];

export const GODOT_4_7_SCENE_PLACEMENT_RULES: readonly GodotScenePlacementRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    placement: 'child',
    targetOperation: 'native-child',
    evidenceClaimId: 'godot-4.7-scene-placement-child',
  },
];

export const GODOT_4_7_SCENE_PROPERTY_RULES: readonly GodotScenePropertyRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'position',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-position',
    evidenceClaimId: 'godot-4.7-scene-node3d-position',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'rotation',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-rotation-yxz',
    evidenceClaimId: 'godot-4.7-scene-node3d-rotation-yxz',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    nativeCanonicalIdentity: NODE_3D_IDENTITY,
    propertyName: 'scale',
    serializedValue: 'ctor:Vector3(number,number,number)',
    targetKind: 'three-scale',
    evidenceClaimId: 'godot-4.7-scene-node3d-scale',
  },
];

const reproductionCommand = GODOT_4_7_PROOF_REPRODUCTION_COMMAND;

function claim(rule: GodotSceneNodeRule): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'translate-data',
    canonicalIdentity: godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity),
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: 'scene/3d/node_3d.cpp',
      sourceSymbol: 'Node3D::Node3D',
      sourceLine: 1550,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_SCENE_NODE_INPUT_SHA256,
      callsite: 'res://observe.gd:16 _ready()',
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256,
      callsite: 'planGodotSceneDocuments(boundProject, authority) -> THREE.Group',
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_SCENE_NODE_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

function placementClaim(rule: GodotScenePlacementRule): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'translate-data',
    canonicalIdentity: godotScenePlacementRuleKey(rule.sourceRevision, rule.placement),
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: 'scene/main/node.cpp',
      sourceSymbol: 'Node::add_child',
      sourceLine: 1711,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_SCENE_NODE_INPUT_SHA256,
      callsite: 'res://observe.gd:16 _ready()',
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256,
      callsite: 'planGodotSceneDocuments(boundProject, authority) -> THREE.Object3D.add',
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_SCENE_NODE_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

function propertyClaim(rule: GodotScenePropertyRule): SemanticClaimRecord {
  const source = {
    position: {
      file: 'scene/3d/node_3d.cpp',
      symbol: 'Node3D::set_position',
      line: 714,
      target: 'position',
    },
    rotation: {
      file: 'scene/3d/node_3d.h',
      symbol: 'Node3D::Data::euler_rotation_order',
      line: 119,
      target: 'rotation/YXZ',
    },
    scale: {
      file: 'scene/3d/node_3d.cpp',
      symbol: 'Node3D::set_scale',
      line: 819,
      target: 'scale',
    },
  }[rule.propertyName];
  if (source === undefined) throw new Error(`unknown scene property claim ${rule.propertyName}`);
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'translate-data',
    canonicalIdentity: godotScenePropertyRuleKey(
      rule.sourceRevision,
      rule.nativeCanonicalIdentity,
      rule.propertyName,
      rule.serializedValue,
    ),
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: source.file,
      sourceSymbol: source.symbol,
      sourceLine: source.line,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_SCENE_NODE_INPUT_SHA256,
      callsite: 'res://observe.gd:16 _ready()',
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256,
      callsite: `planGodotSceneDocuments(boundProject, authority) -> THREE.Object3D.${source.target}`,
      observedOutputSha256: GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON equality after 1e-6 component quantization',
      tolerance: 'absolute 1e-6',
      resultSha256: GODOT_4_7_SCENE_NODE_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

export const GODOT_4_7_SCENE_NODE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_SCENE_NODE_RULES.map(claim),
  ...GODOT_4_7_SCENE_PLACEMENT_RULES.map(placementClaim),
  ...GODOT_4_7_SCENE_PROPERTY_RULES.map(propertyClaim),
];

export const GODOT_4_7_SCENE_NODE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] =
  GODOT_4_7_SCENE_NODE_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_SCENE_NODE_INPUT_SHA256,
    implementationSha256: GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256,
  }));
