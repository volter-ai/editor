import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from '../../code/authority/godot-4.7-seed';
import type { GodotFieldValueClaimLiveness, GodotFieldValueRule } from '../field-value-authority';
import { godotFieldValueRuleKey } from '../field-value-authority';

export const GODOT_4_7_FIELD_VALUE_INPUT_SHA256 =
  '25188a4001d0db11d5ca3e34ac976697770e623b6a369584e9b7faa9035415ca' as const;
export const GODOT_4_7_FIELD_VALUE_IMPLEMENTATION_SHA256 =
  'c99aa59e3017970772dc174ffafcf3743b43ee230beb8bb9ea67d28c6a162901' as const;
export const GODOT_4_7_FIELD_VALUE_OBSERVED_OUTPUT_SHA256 =
  '68e939e023069b2bb650cf6ac8b6fab29454891067926ff7b4b5211ad821cdb1' as const;
export const GODOT_4_7_FIELD_VALUE_COMPARISON_SHA256 =
  '65a64b1f3953c5ef5c06bbfce1a39ffa41a297cddd380663e3c2a3ba43cf3a24' as const;

const MUTABLE_INT =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_FLOAT =
  'BUILTIN|ANNOTATED_EXPLICIT|float|float|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_BOOL =
  'BUILTIN|ANNOTATED_EXPLICIT|bool|bool|||||mutable|writable|instance|concrete|sync|[]';
const MUTABLE_STRING =
  'BUILTIN|ANNOTATED_EXPLICIT|String|String|||||mutable|writable|instance|concrete|sync|[]';

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
];

const reproductionCommand = [
  'npm',
  'run',
  'godot-field-value-proof',
  '-w',
  '@vgai/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

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
