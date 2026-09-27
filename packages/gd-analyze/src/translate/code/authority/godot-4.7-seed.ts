import type { GodotCodeRuleEntry, GodotDatatypeRuleEntry } from '../lowering-rules';

export const GODOT_4_7_CODE_SEED_SOURCE_REVISION =
  '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88' as const;
export const GODOT_4_7_CODE_SEED_API_DUMP_SHA256 =
  '53d37f85be32b6d10fb2266ca51f6ef0c3a55728acdb7c8301b1458a93c00943' as const;

const INT_VALUE =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||constant|writable|instance|concrete|sync|[]';
const INT_TYPE =
  'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';

export const GODOT_4_7_CODE_SEED_RULES: readonly GodotCodeRuleEntry[] = [
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'CLASS',
      semanticKey: 'class:concrete|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'class' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'FUNCTION',
      semanticKey: 'function:static:synchronous|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'function' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'SUITE',
      semanticKey: 'suite|annotations:[]',
      inputDatatypes: [],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'suite' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'RETURN',
      semanticKey: 'return:value|annotations:[]',
      inputDatatypes: [INT_VALUE],
      resultDatatype: '',
    },
    target: { kind: 'structural', construct: 'return' },
  },
  {
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: 'LITERAL',
      semanticKey: 'literal:int:reduced|annotations:[]',
      inputDatatypes: [],
      resultDatatype: INT_VALUE,
    },
    target: { kind: 'structural', construct: 'literal' },
  },
];

export const GODOT_4_7_CODE_SEED_DATATYPES: readonly GodotDatatypeRuleEntry[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceDatatype: INT_TYPE,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
];
