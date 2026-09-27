import type { GodotBoundNode } from '../../../godot-frontend/bound-program';
import type {
  GodotCodeRuleEntry,
  GodotCodeRuleRecipe,
  GodotDatatypeRuleEntry,
  GodotStructuralConstruct,
} from '../lowering-rules';
import type { TargetTsType } from '../target-ts-syntax';
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from './godot-4.7-seed';

const CI = 'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||constant|writable|instance|concrete|sync|[]';
const MI = 'BUILTIN|ANNOTATED_EXPLICIT|int|int|||||mutable|writable|instance|concrete|sync|[]';
const II = 'BUILTIN|ANNOTATED_INFERRED|int|int|||||mutable|writable|instance|concrete|sync|[]';
const ICI = 'BUILTIN|ANNOTATED_INFERRED|int|int|||||constant|writable|instance|concrete|sync|[]';
const CB = 'BUILTIN|ANNOTATED_EXPLICIT|bool|bool|||||constant|writable|instance|concrete|sync|[]';
const MB = 'BUILTIN|ANNOTATED_EXPLICIT|bool|bool|||||mutable|writable|instance|concrete|sync|[]';
const CF = 'BUILTIN|ANNOTATED_EXPLICIT|float|float|||||constant|writable|instance|concrete|sync|[]';
const MF = 'BUILTIN|ANNOTATED_EXPLICIT|float|float|||||mutable|writable|instance|concrete|sync|[]';
const IF = 'BUILTIN|ANNOTATED_INFERRED|float|float|||||mutable|writable|instance|concrete|sync|[]';
const IB = 'BUILTIN|ANNOTATED_INFERRED|bool|bool|||||mutable|writable|instance|concrete|sync|[]';
const CAI = `BUILTIN|ANNOTATED_EXPLICIT|Array[int]|Array|||||constant|writable|instance|concrete|sync|[${MI}]`;
const MAI = `BUILTIN|ANNOTATED_EXPLICIT|Array[int]|Array|||||mutable|writable|instance|concrete|sync|[${MI}]`;

interface RuleDefinition {
  readonly nodeKind: GodotBoundNode['kind'];
  readonly semanticKey: string;
  readonly inputs: readonly string[];
  readonly result: string;
  readonly target: GodotCodeRuleRecipe;
  readonly annotations?: string;
}

function structural(
  nodeKind: GodotBoundNode['kind'],
  semanticKey: string,
  inputs: readonly string[],
  result: string,
  construct: GodotStructuralConstruct,
): RuleDefinition {
  return {
    nodeKind,
    semanticKey,
    inputs,
    result,
    target: { kind: 'structural', construct },
  };
}

function operation(
  nodeKind: 'ASSIGNMENT' | 'BINARY_OPERATOR' | 'UNARY_OPERATOR',
  semanticKey: string,
  inputs: readonly string[],
  result: string,
  target: GodotCodeRuleRecipe,
): RuleDefinition {
  return {
    nodeKind,
    semanticKey,
    inputs,
    result,
    target,
  };
}

const definitions: readonly RuleDefinition[] = [
  structural('CONSTANT', 'constant:declared:class-static', [CI], '', 'constant'),
  structural('VARIABLE', 'variable:declared:static', [CI], '', 'variable'),
  structural('PARAMETER', 'parameter:declared:defaulted', [CI], '', 'parameter'),
  structural('VARIABLE', 'variable:declared:instance', [II], '', 'variable'),
  operation('BINARY_OPERATOR', 'operator:OP_ADDITION:6', [MI, CI], II, {
    kind: 'binary',
    operator: '+',
  }),
  structural('IDENTIFIER', 'local-identifier:FUNCTION_PARAMETER', [], MI, 'local-identifier'),
  structural('IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], CI, 'member-identifier'),
  structural('VARIABLE', 'variable:declared:instance', [CAI], '', 'variable'),
  structural('ARRAY', 'array-literal', [CI, CI, CI], CAI, 'array-literal'),
  structural('VARIABLE', 'variable:declared:instance', [MI], '', 'variable'),
  structural('IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MI, 'local-identifier'),
  structural('IF', 'if', [IB], '', 'if'),
  operation('BINARY_OPERATOR', 'operator:OP_COMP_GREATER:4', [MI, CI], IB, {
    kind: 'binary',
    operator: '>',
  }),
  operation('ASSIGNMENT', 'operator:OP_ADDITION:6', [MI, MI], II, {
    kind: 'assignment',
    operator: '+=',
  }),
  structural('SUBSCRIPT', 'subscript-element', [MAI, CI], MI, 'subscript-element'),
  structural('IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MAI, 'local-identifier'),
  operation('ASSIGNMENT', 'operator:OP_SUBTRACTION:7', [MI, CI], II, {
    kind: 'assignment',
    operator: '-=',
  }),
  structural('VARIABLE', 'variable:declared:instance', [CI], '', 'variable'),
  structural('WHILE', 'while', [IB], '', 'while'),
  operation('BINARY_OPERATOR', 'operator:OP_COMP_LESS:2', [MI, CI], IB, {
    kind: 'binary',
    operator: '<',
  }),
  operation('ASSIGNMENT', 'operator:OP_ADDITION:6', [MI, CI], II, {
    kind: 'assignment',
    operator: '+=',
  }),
  structural('WHILE', 'while', [CB], '', 'while'),
  structural('LITERAL', 'literal:bool:reduced', [], CB, 'literal'),
  structural('BREAK', 'break', [], '', 'break'),
  structural('FOR', 'for-of:direct-binding', [MAI], '', 'for-of'),
  operation('BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [MI, CI], IB, {
    kind: 'binary',
    operator: '===',
  }),
  structural('IDENTIFIER', 'local-identifier:LOCAL_ITERATOR', [], MI, 'local-identifier'),
  structural('CONTINUE', 'continue', [], '', 'continue'),
  // An int negation never yields -0 (`-a` of 0 is 0 in Godot, -0 under a plain unary minus).
  operation('UNARY_OPERATOR', 'operator:OP_NEGATIVE:10', [MI], II, { kind: 'integer-negate' }),
  structural('VARIABLE', 'variable:declared:instance', [IB], '', 'variable'),
  structural('TERNARY_OPERATOR', 'ternary', [MB, MI, CI], II, 'ternary'),
  structural('IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MB, 'local-identifier'),
  operation('ASSIGNMENT', 'operator:OP_NONE:25', [MI, MI], MI, {
    kind: 'assignment',
    operator: '=',
  }),
  structural('IDENTIFIER', 'member-identifier:STATIC_VARIABLE', [], MI, 'member-identifier'),
  structural('RETURN', 'return:value', [CAI], '', 'return'),
  structural('ARRAY', 'array-literal', [MI, MI, ICI, MI, MI], CAI, 'array-literal'),
  structural('TERNARY_OPERATOR', 'ternary', [MB, CI, CI], ICI, 'ternary'),
  structural('CONSTANT', 'constant:declared:class-static', [CF], '', 'constant'),
  structural('LITERAL', 'literal:float:reduced', [], CF, 'literal'),
  structural('VARIABLE', 'variable:declared:instance', [CF], '', 'variable'),
  structural('VARIABLE', 'variable:declared:instance', [CB], '', 'variable'),
  structural('ENUM', 'enum:named', [], '', 'enum'),
  structural('FUNCTION', 'function:instance:synchronous', [], '', 'function'),
  structural('PARAMETER', 'parameter:declared:required', [], '', 'parameter'),
  structural('RETURN', 'return:value', [IF], '', 'return'),
  operation('BINARY_OPERATOR', 'operator:OP_ADDITION:6', [IF, MF], IF, {
    kind: 'binary',
    operator: '+',
  }),
  operation('BINARY_OPERATOR', 'operator:OP_MULTIPLICATION:8', [MF, CF], IF, {
    kind: 'binary',
    operator: '*',
  }),
  structural('IDENTIFIER', 'local-identifier:FUNCTION_PARAMETER', [], MF, 'local-identifier'),
  structural('IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], CF, 'member-identifier'),
  structural('IDENTIFIER', 'member-identifier:MEMBER_VARIABLE', [], MF, 'member-identifier'),
  {
    nodeKind: 'VARIABLE',
    semanticKey: 'variable:declared:instance',
    inputs: [CF],
    result: '',
    target: { kind: 'structural', construct: 'variable' },
    annotations: '[@export:resolved:applied:[]]',
  },
];

export const GODOT_4_7_LANGUAGE_RULES: readonly GodotCodeRuleEntry[] = definitions.map(
  (definition) => ({
    source: {
      sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
      nodeKind: definition.nodeKind,
      semanticKey: `${definition.semanticKey}|annotations:${definition.annotations ?? '[]'}`,
      inputDatatypes: definition.inputs,
      resultDatatype: definition.result,
    },
    target: definition.target,
  }),
);

const datatypeDefinitions: readonly {
  readonly sourceDatatype: string;
  readonly targetType: TargetTsType;
}[] = [
  {
    sourceDatatype: CI,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    sourceDatatype: MAI,
    targetType: { kind: 'array-type', element: { kind: 'keyword-type', keyword: 'number' } },
  },
  {
    sourceDatatype: MB,
    targetType: { kind: 'keyword-type', keyword: 'boolean' },
  },
  {
    sourceDatatype: CF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    sourceDatatype: MF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    sourceDatatype: IF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
];

export const GODOT_4_7_LANGUAGE_DATATYPES: readonly GodotDatatypeRuleEntry[] =
  datatypeDefinitions.map((definition) => ({
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceDatatype: definition.sourceDatatype,
    targetType: definition.targetType,
  }));
