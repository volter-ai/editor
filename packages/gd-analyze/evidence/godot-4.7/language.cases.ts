import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotLanguageEvidenceFile } from '../../src/evidence/case';

/**
 * Language cases for the type-generic structural rules and the built-in binding routes. Each case
 * is a static function run by official Godot and, lowered by production code lowering, in Node.
 * `copy_is_independent` is the value-semantics case: a write through a copy leaves the original.
 */
const SOURCE = `class_name LanguageCases
extends RefCounted

static func inferred_local() -> Vector3:
\tvar v := Vector3(1.5, -2.0, 3.25)
\treturn v

static func typed_local() -> Vector3:
\tvar v: Vector3 = Vector3(0.1, 0.2, 0.3)
\treturn v

static func argument_passing(value: Vector3, weight: float) -> Vector3:
\treturn value.lerp(Vector3(4.0, 5.0, 6.0), weight)

static func binary_operators() -> Vector3:
\tvar a := Vector3(1.0, 2.0, 3.0)
\tvar b := Vector3(0.5, -0.25, 8.0)
\treturn a + b * 2.0 - b / 3.0

static func unary_operator() -> Vector3:
\tvar a := Vector3(1.0, -2.0, 0.0)
\treturn -a

static func comparison() -> bool:
\tvar a := Vector3(1.0, 2.0, 3.0)
\treturn a == Vector3(1.0, 2.0, 3.0)

static func constant() -> Vector3:
\treturn Vector3.UP

static func member_read() -> float:
\tvar a := Vector3(1.0, 2.5, 3.0)
\treturn a.y

static func member_write() -> Vector3:
\tvar a := Vector3(1.0, 2.0, 3.0)
\ta.x = 5.0
\treturn a

static func copy_is_independent() -> Vector3:
\tvar a := Vector3(1.0, 2.0, 3.0)
\tvar b := a
\tb.x = 9.0
\treturn a

static func assigned_copy() -> Vector3:
\tvar a := Vector3(1.0, 2.0, 3.0)
\tvar b := Vector3.ZERO
\tb = a
\tb.z = -1.0
\treturn a + b

static func one_argument() -> float:
\tvar a := Vector3(3.0, 0.0, 4.0)
\treturn a.dot(Vector3(0.5, 2.0, -1.0))

static func method_chain() -> Vector3:
\tvar a := Vector3(3.0, 0.0, 4.0)
\treturn a.lerp(Vector3(0.0, 1.0, 0.0), 0.25).normalized().rotated(Vector3.UP, 0.5)
`;


const COMPILER = 'modules/gdscript/gdscript_compiler.cpp';
const B = 'BUILTIN:*';
/** A callee the official frontend leaves untyped: the call's own target carries its identity. */
const CALLEE = 'UNRESOLVED|UNDETECTED|<unresolved type>|Nil|||||mutable|writable|instance|concrete|sync|[]';

/**
 * Rules keyed by datatype class hold for every built-in: under the compat representation a
 * built-in value is an immutable record (Array and Dictionary shared references), so declaring,
 * reading, passing, returning and assigning one means the same for every type. What depends on the
 * type goes through the binding table (operators, constants, member writes), whose rows carry
 * their own claims.
 */
const RULES: GodotLanguageEvidenceFile['rules'] = [
  {
    id: 'variable-inferred-builtin',
    nodeKind: 'VARIABLE',
    semanticKey: 'variable:inferred:instance|annotations:[]',
    inputDatatypes: [B],
    resultDatatype: '',
    target: { kind: 'structural', construct: 'variable' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block VARIABLE', line: 2213 },
  },
  {
    id: 'variable-declared-builtin',
    nodeKind: 'VARIABLE',
    semanticKey: 'variable:declared:instance|annotations:[]',
    inputDatatypes: [B],
    resultDatatype: '',
    target: { kind: 'structural', construct: 'variable' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block VARIABLE', line: 2213 },
  },
  {
    id: 'return-builtin',
    nodeKind: 'RETURN',
    semanticKey: 'return:value|annotations:[]',
    inputDatatypes: [B],
    resultDatatype: '',
    target: { kind: 'structural', construct: 'return' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block RETURN', line: 2159 },
  },
  {
    id: 'local-variable-builtin',
    nodeKind: 'IDENTIFIER',
    semanticKey: 'local-identifier:LOCAL_VARIABLE|annotations:[]',
    inputDatatypes: [],
    resultDatatype: B,
    target: { kind: 'structural', construct: 'local-identifier' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression IDENTIFIER', line: 262 },
  },
  {
    id: 'parameter-builtin',
    nodeKind: 'IDENTIFIER',
    semanticKey: 'local-identifier:FUNCTION_PARAMETER|annotations:[]',
    inputDatatypes: [],
    resultDatatype: B,
    target: { kind: 'structural', construct: 'local-identifier' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression IDENTIFIER', line: 262 },
  },
  ...[0, 1, 2, 3].map((arguments_) => ({
    id: `call-builtin-${String(arguments_)}-arguments`,
    nodeKind: 'CALL' as const,
    semanticKey: 'call:instance|annotations:[]',
    inputDatatypes: [CALLEE, ...Array.from({ length: arguments_ }, () => B)],
    resultDatatype: B,
    target: { kind: 'structural' as const, construct: 'call' as const },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression CALL', line: 603 },
  })),
  {
    id: 'operator-builtin-binary',
    nodeKind: 'BINARY_OPERATOR',
    semanticKey: 'operator:variant-evaluate|annotations:[]',
    inputDatatypes: [B, B],
    resultDatatype: B,
    target: { kind: 'binding' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression BINARY_OPERATOR', line: 867 },
  },
  {
    id: 'operator-builtin-unary',
    nodeKind: 'UNARY_OPERATOR',
    semanticKey: 'operator:variant-evaluate|annotations:[]',
    inputDatatypes: [B],
    resultDatatype: B,
    target: { kind: 'binding' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression UNARY_OPERATOR', line: 849 },
  },
  {
    id: 'builtin-constant',
    nodeKind: 'SUBSCRIPT',
    semanticKey: 'subscript-attribute:builtin-constant|annotations:[]',
    inputDatatypes: [],
    resultDatatype: B,
    target: { kind: 'binding' },
    source: {
      file: 'modules/gdscript/gdscript_analyzer.cpp',
      symbol: 'GDScriptAnalyzer::reduce_identifier_from_base builtin constant',
      line: 4084,
    },
  },
  {
    id: 'member-read-builtin',
    nodeKind: 'SUBSCRIPT',
    semanticKey: 'subscript-attribute|annotations:[]',
    inputDatatypes: [B],
    resultDatatype: B,
    target: { kind: 'structural', construct: 'subscript-attribute' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression SUBSCRIPT', line: 784 },
  },
  {
    id: 'assign-builtin',
    nodeKind: 'ASSIGNMENT',
    semanticKey: 'operator:OP_NONE:25|annotations:[]',
    inputDatatypes: [B, B],
    resultDatatype: B,
    target: { kind: 'assignment', operator: '=' },
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression ASSIGNMENT set back', line: 1172 },
  },
];

const LANGUAGE_EVIDENCE: GodotLanguageEvidenceFile = {
  kind: 'language',
  className: 'LanguageCases',
  source: SOURCE,
  compatModules: ['lib/godot-compat/vector3'],
  rules: RULES,
  cases: [
    {
      id: 'argument_passing',
      call: 'argument_passing',
      arguments: {
        gdscript: 'Vector3(1.0, 1.0, 1.0), 0.5',
        target: () => [V.construct(1, 1, 1), 0.5],
      },
      comparator: 'exact' as const,
    },
    ...[
    'inferred_local',
    'typed_local',
    'binary_operators',
    'unary_operator',
    'comparison',
    'constant',
    'member_read',
    'member_write',
    'copy_is_independent',
    'assigned_copy',
    'one_argument',
    'method_chain',
  ].map((call) => ({ id: call, call, comparator: 'exact' as const })),
  ],
};

export default LANGUAGE_EVIDENCE;
