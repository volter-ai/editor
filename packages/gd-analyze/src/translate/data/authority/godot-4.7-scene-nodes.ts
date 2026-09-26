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
  type GodotSceneStructureRule,
  godotSceneNodeRuleKey,
  godotScenePlacementRuleKey,
  godotScenePropertyRuleKey,
  godotSceneStructureRuleKey,
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

// ---------------------------------------------------------------------------------------------
// Scene structure: its own proof (`src/evidence/proofs/scene-structure.ts`), which builds a scene
// project natively and reads its tree against the emitted components mounted in Node.

const STRUCTURE_IDENTITIES = godotProofIdentities('scene-structure');
const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;
const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_STRUCTURE_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Node'),
    targetKind: 'three-node',
    evidenceClaimId: 'godot-4.7-scene-node-node-group',
    source: { file: 'scene/main/node.cpp', symbol: 'Node::Node', line: 4092 },
  },
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Camera3D'),
    targetKind: 'three-perspective-camera',
    evidenceClaimId: 'godot-4.7-scene-node-camera3d',
    source: { file: 'scene/3d/camera_3d.cpp', symbol: 'Camera3D::Camera3D', line: 871 },
  },
];

export const GODOT_4_7_STRUCTURE_PROPERTY_RULES: readonly (GodotScenePropertyRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Node3D'),
    propertyName: 'transform',
    serializedValue: 'ctor:Transform3D(number*12)',
    targetKind: 'three-matrix',
    evidenceClaimId: 'godot-4.7-scene-node3d-transform',
    source: { file: 'scene/3d/node_3d.cpp', symbol: 'Node3D::set_transform', line: 399 },
  },
  ...(
    [
      ['fov', 'camera-fov', 737],
      ['near', 'camera-near', 749],
      ['far', 'camera-far', 759],
    ] as const
  ).map(([propertyName, targetKind, line]) => ({
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('Camera3D'),
    propertyName,
    serializedValue: 'number' as const,
    targetKind,
    evidenceClaimId: `godot-4.7-scene-camera3d-${propertyName}`,
    source: { file: 'scene/3d/camera_3d.cpp', symbol: `Camera3D::set_${propertyName}`, line },
  })),
];

export const GODOT_4_7_STRUCTURE_RULES: readonly (GodotSceneStructureRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    id: 'scene-instance',
    evidenceClaimId: 'godot-4.7-scene-structure-instance',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (instance)', line: 233 },
  },
  {
    sourceRevision: REVISION,
    id: 'instance-root-override',
    evidenceClaimId: 'godot-4.7-scene-structure-instance-override',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (properties)', line: 400 },
  },
  {
    sourceRevision: REVISION,
    id: 'instance-children',
    evidenceClaimId: 'godot-4.7-scene-structure-instance-children',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (parent)', line: 540 },
  },
  {
    sourceRevision: REVISION,
    id: 'node-groups',
    evidenceClaimId: 'godot-4.7-scene-structure-groups',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (groups)', line: 511 },
  },
  {
    sourceRevision: REVISION,
    id: 'authored-order',
    evidenceClaimId: 'godot-4.7-scene-structure-order',
    source: { file: 'scene/resources/packed_scene.cpp', symbol: 'SceneState::instantiate (node order)', line: 186 },
  },
];

function structureClaim(canonicalIdentity: string, claimId: string, source: Source): SemanticClaimRecord {
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
      inputSha256: STRUCTURE_IDENTITIES.input,
      callsite: 'res://observe.gd _ready()',
      observedOutputSha256: STRUCTURE_IDENTITIES.observed,
    },
    target: {
      implementationSha256: STRUCTURE_IDENTITIES.implementation,
      callsite: 'emitted scene components mounted by @react-three/fiber',
      observedOutputSha256: STRUCTURE_IDENTITIES.observed,
    },
    comparison: {
      comparator: 'canonical tree (names, classes, global transform bits, groups, camera) exact equality',
      tolerance: 'exact',
      resultSha256: STRUCTURE_IDENTITIES.comparison,
    },
    reproductionCommand,
  };
}

export const GODOT_4_7_STRUCTURE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_STRUCTURE_NODE_RULES.map((rule) =>
    structureClaim(godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity), rule.evidenceClaimId, rule.source),
  ),
  ...GODOT_4_7_STRUCTURE_PROPERTY_RULES.map((rule) =>
    structureClaim(
      godotScenePropertyRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity, rule.propertyName, rule.serializedValue),
      rule.evidenceClaimId,
      rule.source,
    ),
  ),
  ...GODOT_4_7_STRUCTURE_RULES.map((rule) =>
    structureClaim(godotSceneStructureRuleKey(rule.sourceRevision, rule.id), rule.evidenceClaimId, rule.source),
  ),
];

export const GODOT_4_7_STRUCTURE_LIVENESS: readonly GodotSceneNodeClaimLiveness[] =
  GODOT_4_7_STRUCTURE_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: STRUCTURE_IDENTITIES.input,
    implementationSha256: STRUCTURE_IDENTITIES.implementation,
  }));
