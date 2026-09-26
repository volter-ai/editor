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

export const GODOT_4_7_SCENE_NODE_INPUT_SHA256 =
  '7a0e61b5b23c75d7bc298b82991dee4b55725c98b5e2813f3deda8e105556954' as const;
export const GODOT_4_7_SCENE_NODE_IMPLEMENTATION_SHA256 =
  'a928e000611539ab6e6fe2c4274043d4017c73d7aa94eadddc7e486f2c1a8af4' as const;
export const GODOT_4_7_SCENE_NODE_OBSERVED_OUTPUT_SHA256 =
  'b895dba02a62435021a6eb96d7cb06e6d44a0a9f03f353fc0b125586cef46428' as const;
export const GODOT_4_7_SCENE_NODE_COMPARISON_SHA256 =
  '31d421ccdb7e0d90f2002f2feea551c6e1c3bd796a34c453954238bcfe6f09b3' as const;

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

const reproductionCommand = [
  'npm',
  'run',
  'godot-scene-node-proof',
  '-w',
  '@vgai/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

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
