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

export const GODOT_4_7_FIELD_VALUE_CLAIMS: readonly SemanticClaimRecord[] =
  GODOT_4_7_FIELD_VALUE_RULES.map(claim);

export const GODOT_4_7_FIELD_VALUE_LIVENESS: readonly GodotFieldValueClaimLiveness[] =
  GODOT_4_7_FIELD_VALUE_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_FIELD_VALUE_INPUT_SHA256,
    implementationSha256: GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256,
  }));
