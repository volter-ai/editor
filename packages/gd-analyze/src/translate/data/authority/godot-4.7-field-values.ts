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
import type { GodotFieldValueClaimLiveness, GodotFieldValueRule } from '../field-value-authority';
import { godotFieldValueRuleKey } from '../field-value-authority';

const FIELD_VALUES_IDENTITIES = godotProofIdentities('field-values');
export const GODOT_4_7_FIELD_VALUE_INPUT_SHA256 = FIELD_VALUES_IDENTITIES.input;
export const GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256 = FIELD_VALUES_IDENTITIES.implementation;
export const GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256 = FIELD_VALUES_IDENTITIES.observed;
export const GODOT_4_7_FIELD_VALUE_COMPARISON_SHA256 = FIELD_VALUES_IDENTITIES.comparison;

const MUTABLE_INT =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_FLOAT =
  'BUILTIN|ANNOTATED_EXPLICIT|float|float|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_BOOL =
  'BUILTIN|ANNOTATED_EXPLICIT|bool|bool|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_STRING =
  'BUILTIN|ANNOTATED_EXPLICIT|String|String|||||mutable|writable|instance|concrete|sync|[]';

/** The same fields declared by inference (`@export var speed := 1.5`): the value is set the same way. */
const inferred = (explicit: string) => explicit.replace('ANNOTATED_EXPLICIT', 'ANNOTATED_INFERRED');

export const GODOT_4_7_FIELD_VALUE_RULES: readonly GodotFieldValueRule[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_INT,
    serializedValue: 'number:int',
    targetKind: 'number',
    evidenceClaimId: 'godot-4.7-field-value-int',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_FLOAT,
    serializedValue: 'number:float',
    targetKind: 'number',
    evidenceClaimId: 'godot-4.7-field-value-float',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_BOOL,
    serializedValue: 'bool',
    targetKind: 'boolean',
    evidenceClaimId: 'godot-4.7-field-value-bool',
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: MUTABLE_STRING,
    serializedValue: 'string',
    targetKind: 'string',
    evidenceClaimId: 'godot-4.7-field-value-string',
  },
  ...(
    [
      [MUTABLE_INT, 'number:int', 'number', 'int'],
      [MUTABLE_FLOAT, 'number:float', 'number', 'float'],
      [MUTABLE_BOOL, 'bool', 'boolean', 'bool'],
      [MUTABLE_STRING, 'string', 'string', 'string'],
    ] as const
  ).map(([datatype, serializedValue, targetKind, name]) => ({
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    fieldDatatype: inferred(datatype),
    serializedValue,
    targetKind,
    evidenceClaimId: `godot-4.7-field-value-${name}-inferred`,
  })),
];

const reproductionCommand = GODOT_4_7_PROOF_REPRODUCTION_COMMAND;

function claim(rule: GodotFieldValueRule): SemanticClaimRecord {
  return {
    registryVersion: 1,
    claimId: rule.evidenceClaimId,
    layer: 'translate-data',
    canonicalIdentity: godotFieldValueRuleKey(
      rule.sourceRevision,
      rule.fieldDatatype,
      rule.serializedValue,
    ),
    godot: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
      sourceFile: 'scene/resources/packed_scene.cpp',
      sourceSymbol: 'SceneState::instantiate',
      sourceLine: 494,
    },
    native: {
      executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
      buildIdentity: 'Godot 4.7-stable official 5b4e0cb0f',
      inputSha256: GODOT_4_7_FIELD_VALUE_INPUT_SHA256,
      callsite: 'res://field_values.gd:8 _ready()',
      observedOutputSha256: GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256,
      callsite: 'planScriptFieldInitializations(boundProject, authority)',
      observedOutputSha256: GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_FIELD_VALUE_COMPARISON_SHA256,
    },
    reproductionCommand,
  };
}

/**
 * A field the scene stores as a NodePath (`node_paths`), whatever its object type (keyed by the
 * datatype's class): set to the node at the path once the scene's nodes all exist
 * (`SceneState::instantiate`, packed_scene.cpp:597), measured by the scene-structure proof's root
 * script reading its references in `_ready`.
 */
export const GODOT_4_7_NODE_REFERENCE_RULES: readonly GodotFieldValueRule[] = (['NATIVE:*', 'CLASS:*'] as const).map((datatype) => ({
  sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
  fieldDatatype: datatype,
  serializedValue: 'node-path',
  targetKind: 'node-reference',
  evidenceClaimId: `godot-4.7-field-value-node-reference-${datatype === 'NATIVE:*' ? 'native' : 'class'}`,
}));

const STRUCTURE_IDENTITIES = godotProofIdentities('scene-structure');

function nodeReferenceClaim(rule: GodotFieldValueRule): SemanticClaimRecord {
  const base = claim(rule);
  return {
    ...base,
    godot: { ...base.godot, sourceSymbol: 'SceneState::instantiate deferred_node_paths', sourceLine: 597 },
    native: { ...base.native, inputSha256: STRUCTURE_IDENTITIES.input, callsite: 'res://main.gd _ready()', observedOutputSha256: STRUCTURE_IDENTITIES.observed },
    target: { implementationSha256: STRUCTURE_IDENTITIES.implementation, callsite: 'MainScene mounted by @react-three/fiber, read through compat', observedOutputSha256: STRUCTURE_IDENTITIES.observed },
    comparison: { ...base.comparison, resultSha256: STRUCTURE_IDENTITIES.comparison },
  };
}

export const GODOT_4_7_FIELD_VALUE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_FIELD_VALUE_RULES.map(claim),
  ...GODOT_4_7_NODE_REFERENCE_RULES.map(nodeReferenceClaim),
];

const liveness = (claims: readonly SemanticClaimRecord[]): readonly GodotFieldValueClaimLiveness[] =>
  claims.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: entry.native.inputSha256,
    implementationSha256: entry.target.implementationSha256,
  }));

export const GODOT_4_7_FIELD_VALUE_LIVENESS = liveness(GODOT_4_7_FIELD_VALUE_RULES.map(claim));
/** The node-reference claims' liveness: the scene-structure proof's implementation. */
export const GODOT_4_7_NODE_REFERENCE_LIVENESS = liveness(GODOT_4_7_NODE_REFERENCE_RULES.map(nodeReferenceClaim));
