import type { GodotBoundNode } from '../../../godot-frontend/bound-program';
import type { SemanticClaimRecord } from '../../../godot-frontend/semantic-claims';
import type { GodotCodeClaimLiveness } from '../authority';
import {
  type GodotCodeRuleEntry,
  type GodotCodeRuleRecipe,
  type GodotDatatypeRuleEntry,
  type GodotStructuralConstruct,
  godotCodeRuleKey,
  godotDatatypeRuleKey,
} from '../lowering-rules';
import type { TargetTsType } from '../target-ts-syntax';
import {
  GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
  GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
  GODOT_4_7_CODE_SEED_SOURCE_REVISION,
} from './godot-4.7-seed';

export const GODOT_4_7_LANGUAGE_INPUT_SHA256 =
  'bbc626d02b14f5c883d334917991e4dab852f8fc74d968105e0cf0fb122c2299' as const;
export const GODOT_4_7_LANGUAGE_IMPLEMENTATION_SHA256 =
  'c67ef03ea4a1338955a8fc9b660aaeac5abfce940408f1a92dccae9ac6586aa4' as const;
export const GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256 =
  '5a92f266ea9d2faf0b5b7e43300c77009f74b8cb11a9083c70fa5efca0e4a59c' as const;
export const GODOT_4_7_LANGUAGE_COMPARISON_SHA256 =
  '0c6bb22e4623492d56cb80a0c2aa7157035ddfd142df6fea536fe1f64a0586ff' as const;

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
  readonly id: string;
  readonly nodeKind: GodotBoundNode['kind'];
  readonly semanticKey: string;
  readonly inputs: readonly string[];
  readonly result: string;
  readonly target: GodotCodeRuleRecipe;
  readonly annotations?: string;
}

function structural(
  id: number,
  nodeKind: GodotBoundNode['kind'],
  semanticKey: string,
  inputs: readonly string[],
  result: string,
  construct: GodotStructuralConstruct,
): RuleDefinition {
  return {
    id: `godot-4.7-language-${String(id)}`,
    nodeKind,
    semanticKey,
    inputs,
    result,
    target: { kind: 'structural', construct },
  };
}

function operation(
  id: number,
  nodeKind: 'ASSIGNMENT' | 'BINARY_OPERATOR' | 'UNARY_OPERATOR',
  semanticKey: string,
  inputs: readonly string[],
  result: string,
  target: GodotCodeRuleRecipe,
): RuleDefinition {
  return {
    id: `godot-4.7-language-${String(id)}`,
    nodeKind,
    semanticKey,
    inputs,
    result,
    target,
  };
}

const definitions: readonly RuleDefinition[] = [
  structural(1, 'CONSTANT', 'constant:declared:class-static', [CI], '', 'constant'),
  structural(2, 'VARIABLE', 'variable:declared:static', [CI], '', 'variable'),
  structural(3, 'PARAMETER', 'parameter:declared:defaulted', [CI], '', 'parameter'),
  structural(4, 'VARIABLE', 'variable:declared:instance', [II], '', 'variable'),
  operation(5, 'BINARY_OPERATOR', 'operator:OP_ADDITION:6', [MI, CI], II, {
    kind: 'binary',
    operator: '+',
  }),
  structural(6, 'IDENTIFIER', 'local-identifier:FUNCTION_PARAMETER', [], MI, 'local-identifier'),
  structural(7, 'IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], CI, 'member-identifier'),
  structural(8, 'VARIABLE', 'variable:declared:instance', [CAI], '', 'variable'),
  structural(9, 'ARRAY', 'array-literal', [CI, CI, CI], CAI, 'array-literal'),
  structural(10, 'VARIABLE', 'variable:declared:instance', [MI], '', 'variable'),
  structural(11, 'IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MI, 'local-identifier'),
  structural(12, 'IF', 'if', [IB], '', 'if'),
  operation(13, 'BINARY_OPERATOR', 'operator:OP_COMP_GREATER:4', [MI, CI], IB, {
    kind: 'binary',
    operator: '>',
  }),
  operation(14, 'ASSIGNMENT', 'operator:OP_ADDITION:6', [MI, MI], II, {
    kind: 'assignment',
    operator: '+=',
  }),
  structural(15, 'SUBSCRIPT', 'subscript-element', [MAI, CI], MI, 'subscript-element'),
  structural(16, 'IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MAI, 'local-identifier'),
  operation(17, 'ASSIGNMENT', 'operator:OP_SUBTRACTION:7', [MI, CI], II, {
    kind: 'assignment',
    operator: '-=',
  }),
  structural(18, 'VARIABLE', 'variable:declared:instance', [CI], '', 'variable'),
  structural(19, 'WHILE', 'while', [IB], '', 'while'),
  operation(20, 'BINARY_OPERATOR', 'operator:OP_COMP_LESS:2', [MI, CI], IB, {
    kind: 'binary',
    operator: '<',
  }),
  operation(21, 'ASSIGNMENT', 'operator:OP_ADDITION:6', [MI, CI], II, {
    kind: 'assignment',
    operator: '+=',
  }),
  structural(22, 'WHILE', 'while', [CB], '', 'while'),
  structural(23, 'LITERAL', 'literal:bool:reduced', [], CB, 'literal'),
  structural(24, 'BREAK', 'break', [], '', 'break'),
  structural(25, 'FOR', 'for-of:direct-binding', [MAI], '', 'for-of'),
  operation(26, 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [MI, CI], IB, {
    kind: 'binary',
    operator: '===',
  }),
  structural(27, 'IDENTIFIER', 'local-identifier:LOCAL_ITERATOR', [], MI, 'local-identifier'),
  structural(28, 'CONTINUE', 'continue', [], '', 'continue'),
  operation(29, 'UNARY_OPERATOR', 'operator:OP_NEGATIVE:10', [MI], II, {
    kind: 'unary',
    operator: '-',
  }),
  structural(30, 'VARIABLE', 'variable:declared:instance', [IB], '', 'variable'),
  structural(31, 'TERNARY_OPERATOR', 'ternary', [MB, MI, CI], II, 'ternary'),
  structural(32, 'IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], MB, 'local-identifier'),
  operation(33, 'ASSIGNMENT', 'operator:OP_NONE:25', [MI, MI], MI, {
    kind: 'assignment',
    operator: '=',
  }),
  structural(34, 'IDENTIFIER', 'member-identifier:STATIC_VARIABLE', [], MI, 'member-identifier'),
  structural(35, 'RETURN', 'return:value', [CAI], '', 'return'),
  structural(36, 'ARRAY', 'array-literal', [MI, MI, ICI, MI, MI], CAI, 'array-literal'),
  structural(37, 'TERNARY_OPERATOR', 'ternary', [MB, CI, CI], ICI, 'ternary'),
  structural(38, 'CONSTANT', 'constant:declared:class-static', [CF], '', 'constant'),
  structural(39, 'LITERAL', 'literal:float:reduced', [], CF, 'literal'),
  structural(40, 'VARIABLE', 'variable:declared:instance', [CF], '', 'variable'),
  structural(41, 'VARIABLE', 'variable:declared:instance', [CB], '', 'variable'),
  structural(42, 'ENUM', 'enum:named', [], '', 'enum'),
  structural(43, 'FUNCTION', 'function:instance:synchronous', [], '', 'function'),
  structural(44, 'PARAMETER', 'parameter:declared:required', [], '', 'parameter'),
  structural(45, 'RETURN', 'return:value', [IF], '', 'return'),
  operation(46, 'BINARY_OPERATOR', 'operator:OP_ADDITION:6', [IF, MF], IF, {
    kind: 'binary',
    operator: '+',
  }),
  operation(47, 'BINARY_OPERATOR', 'operator:OP_MULTIPLICATION:8', [MF, CF], IF, {
    kind: 'binary',
    operator: '*',
  }),
  structural(48, 'IDENTIFIER', 'local-identifier:FUNCTION_PARAMETER', [], MF, 'local-identifier'),
  structural(49, 'IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], CF, 'member-identifier'),
  structural(50, 'IDENTIFIER', 'member-identifier:MEMBER_VARIABLE', [], MF, 'member-identifier'),
  {
    id: 'godot-4.7-language-51',
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
    evidenceClaimId: definition.id,
  }),
);

const datatypeDefinitions: readonly {
  readonly id: string;
  readonly sourceDatatype: string;
  readonly targetType: TargetTsType;
}[] = [
  {
    id: 'godot-4.7-language-datatype-1',
    sourceDatatype: CI,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    id: 'godot-4.7-language-datatype-2',
    sourceDatatype: MAI,
    targetType: { kind: 'array-type', element: { kind: 'keyword-type', keyword: 'number' } },
  },
  {
    id: 'godot-4.7-language-datatype-3',
    sourceDatatype: MB,
    targetType: { kind: 'keyword-type', keyword: 'boolean' },
  },
  {
    id: 'godot-4.7-language-datatype-4',
    sourceDatatype: CF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    id: 'godot-4.7-language-datatype-5',
    sourceDatatype: MF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
  {
    id: 'godot-4.7-language-datatype-6',
    sourceDatatype: IF,
    targetType: { kind: 'keyword-type', keyword: 'number' },
  },
];

export const GODOT_4_7_LANGUAGE_DATATYPES: readonly GodotDatatypeRuleEntry[] =
  datatypeDefinitions.map((definition) => ({
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    sourceDatatype: definition.sourceDatatype,
    targetType: definition.targetType,
    evidenceClaimId: definition.id,
  }));

const reproductionCommand = [
  'npm',
  'run',
  'godot-code-authority-language-proof',
  '-w',
  '@volter/gd-analyze',
  '--',
  '--exporter-binary',
  '.vgai/tmp/godot-bound-exporter/godot-4.7-bound-exporter-arm64',
  '--official-binary',
  '.vgai/tmp/godot-4.7-stable/Godot.app/Contents/MacOS/Godot',
] as const;

interface SourceCitation {
  readonly file: string;
  readonly symbol: string;
  readonly line: number;
}

function citation(nodeKind: GodotBoundNode['kind']): SourceCitation {
  const parser = 'modules/gdscript/gdscript_parser.cpp';
  const analyzer = 'modules/gdscript/gdscript_analyzer.cpp';
  switch (nodeKind) {
    case 'VARIABLE':
      return { file: parser, symbol: 'GDScriptParser::parse_variable', line: 1231 };
    case 'CONSTANT':
      return { file: parser, symbol: 'GDScriptParser::parse_constant', line: 1473 };
    case 'PARAMETER':
      return { file: parser, symbol: 'GDScriptParser::parse_parameter', line: 1515 };
    case 'RETURN':
      return { file: parser, symbol: 'GDScriptParser::parse_statement/RETURN', line: 2091 };
    case 'BREAK':
      return { file: parser, symbol: 'GDScriptParser::parse_break', line: 2287 };
    case 'CONTINUE':
      return { file: parser, symbol: 'GDScriptParser::parse_continue', line: 2297 };
    case 'FOR':
      return { file: parser, symbol: 'GDScriptParser::parse_for', line: 2308 };
    case 'IF':
      return { file: parser, symbol: 'GDScriptParser::parse_if', line: 2363 };
    case 'WHILE':
      return { file: parser, symbol: 'GDScriptParser::parse_while', line: 2721 };
    case 'LITERAL':
      return { file: parser, symbol: 'GDScriptParser::parse_literal', line: 2880 };
    case 'ENUM':
      return { file: parser, symbol: 'GDScriptParser::parse_enum', line: 1590 };
    case 'FUNCTION':
      return { file: parser, symbol: 'GDScriptParser::parse_function', line: 1777 };
    case 'ASSIGNMENT':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_assignment', line: 2871 };
    case 'BINARY_OPERATOR':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_binary_op', line: 3110 };
    case 'ARRAY':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_array', line: 2714 };
    case 'IDENTIFIER':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_identifier', line: 4388 };
    case 'SUBSCRIPT':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_subscript', line: 4794 };
    case 'TERNARY_OPERATOR':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_ternary_op', line: 5160 };
    case 'UNARY_OPERATOR':
      return { file: analyzer, symbol: 'GDScriptAnalyzer::reduce_unary_op', line: 5250 };
    default:
      throw new Error(`missing language authority citation for ${nodeKind}`);
  }
}

function claim(claimId: string, canonicalIdentity: string, source: SourceCitation) {
  return {
    registryVersion: 1,
    claimId,
    layer: 'translate-code',
    canonicalIdentity,
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
      inputSha256: GODOT_4_7_LANGUAGE_INPUT_SHA256,
      callsite: 'res://language_semantics.gd:7 LanguageSemantics.evaluate()',
      observedOutputSha256: GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256,
    },
    target: {
      implementationSha256: GODOT_4_7_LANGUAGE_IMPLEMENTATION_SHA256,
      callsite: 'printed TargetTsSyntax LanguageSemantics.evaluate()',
      observedOutputSha256: GODOT_4_7_LANGUAGE_OBSERVED_OUTPUT_SHA256,
    },
    comparison: {
      comparator: 'canonical JSON exact equality',
      tolerance: 'exact',
      resultSha256: GODOT_4_7_LANGUAGE_COMPARISON_SHA256,
    },
    reproductionCommand,
  } as const satisfies SemanticClaimRecord;
}

export const GODOT_4_7_LANGUAGE_CLAIMS: readonly SemanticClaimRecord[] = [
  ...GODOT_4_7_LANGUAGE_RULES.map((entry) =>
    claim(entry.evidenceClaimId, godotCodeRuleKey(entry.source), citation(entry.source.nodeKind)),
  ),
  ...GODOT_4_7_LANGUAGE_DATATYPES.map((entry) =>
    claim(entry.evidenceClaimId, godotDatatypeRuleKey(entry), {
      file: 'modules/gdscript/gdscript_analyzer.cpp',
      symbol: 'GDScriptAnalyzer::resolve_datatype',
      line: 654,
    }),
  ),
];

export const GODOT_4_7_LANGUAGE_LIVENESS: readonly GodotCodeClaimLiveness[] =
  GODOT_4_7_LANGUAGE_CLAIMS.map((entry) => ({
    claimId: entry.claimId,
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    apiDumpSha256: GODOT_4_7_CODE_SEED_API_DUMP_SHA256,
    executableSha256: GODOT_4_7_CODE_SEED_NATIVE_EXECUTABLE_SHA256,
    inputSha256: GODOT_4_7_LANGUAGE_INPUT_SHA256,
    implementationSha256: GODOT_4_7_LANGUAGE_IMPLEMENTATION_SHA256,
  }));
