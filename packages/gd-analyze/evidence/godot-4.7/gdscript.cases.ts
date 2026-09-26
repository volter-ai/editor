import { Group, Object3D } from 'three';
import { add_child, godot_node_adopt } from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type {
  GodotLanguageCase,
  GodotLanguageDatatypeDefinition,
  GodotLanguageEvidenceFile,
  GodotLanguageRuleDefinition,
} from '../../src/evidence/case';
import type { GodotCodeRuleRecipe } from '../../src/translate/code/lowering-rules';

/**
 * GDScript language cases. Each is a function run by official Godot and, lowered by production
 * code lowering, in Node; the rules below are what the lowering selected for them.
 *
 * Rules keyed by datatype CLASS (`BUILTIN:*`, `NATIVE:*`, `ENUM:*`) hold for every type of the
 * class: under the compat representation a built-in value is an immutable record (Array and
 * Dictionary shared references) and an object a shared reference, so declaring, reading, passing,
 * returning and assigning one means the same for every type. Rules whose meaning depends on the
 * type are keyed by TYPE (`BUILTIN:int`): arithmetic, comparison, logic, conversion, defaults.
 *
 * GDScript's int is 64-bit; the target represents it as a JS number. The int rules are measured on
 * values inside ±2^53, where a JS number is that exact integer: their claims hold there, and an int
 * computation leaving that range (or overflowing 64 bits, where Godot wraps) is outside them.
 */

const COMPILER = 'modules/gdscript/gdscript_compiler.cpp';
const ANALYZER = 'modules/gdscript/gdscript_analyzer.cpp';
const VARIANT_OP = 'core/variant/variant_op.cpp';
const B = 'BUILTIN:*';
const INT = 'BUILTIN:int';
const FLOAT = 'BUILTIN:float';
const BOOL = 'BUILTIN:bool';
const NATIVE = 'NATIVE:*';
const ENUM = 'ENUM:*';
const CLASS = 'CLASS:*';
/** A callee the official frontend leaves untyped: the call's own target carries its identity. */
const CALLEE = 'UNRESOLVED|UNDETECTED|<unresolved type>|Nil|||||mutable|writable|instance|concrete|sync|[]';

const rules: GodotLanguageRuleDefinition[] = [];
const rule = (
  id: string,
  nodeKind: GodotLanguageRuleDefinition['nodeKind'],
  key: string,
  inputs: readonly string[],
  result: string,
  target: GodotCodeRuleRecipe,
  source: GodotLanguageRuleDefinition['source'],
): void => {
  rules.push({
    id,
    nodeKind,
    semanticKey: `${key}|annotations:[]`,
    inputDatatypes: inputs,
    resultDatatype: result,
    target,
    source,
  });
};
const structural = (construct: string) =>
  ({ kind: 'structural', construct }) as GodotCodeRuleRecipe;

// ---------------------------------------------------------------------------------------------
// Value-transparent constructs, keyed by datatype class.

const BLOCK = { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block', line: 2159 };
const EXPRESSION = { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression', line: 262 };
for (const [name, cls] of [
  ['builtin', B],
  ['native', NATIVE],
  ['enum', ENUM],
  ['class', CLASS],
  ['variant', 'VARIANT:*'],
] as const) {
  rule(`variable-inferred-${name}`, 'VARIABLE', 'variable:inferred:instance', [cls], '', structural('variable'), BLOCK);
  rule(`variable-declared-${name}`, 'VARIABLE', 'variable:declared:instance', [cls], '', structural('variable'), BLOCK);
  rule(`return-${name}`, 'RETURN', 'return:value', [cls], '', structural('return'), BLOCK);
  rule(`local-variable-${name}`, 'IDENTIFIER', 'local-identifier:LOCAL_VARIABLE', [], cls, structural('local-identifier'), EXPRESSION);
  rule(`parameter-${name}`, 'IDENTIFIER', 'local-identifier:FUNCTION_PARAMETER', [], cls, structural('local-identifier'), EXPRESSION);
  rule(`assign-${name}`, 'ASSIGNMENT', 'operator:OP_NONE:25', [cls, cls], cls, { kind: 'assignment', operator: '=' }, {
    file: COMPILER,
    symbol: 'GDScriptCompiler::_parse_expression ASSIGNMENT',
    line: 982,
  });
  rule(`member-variable-${name}`, 'IDENTIFIER', 'member-identifier:MEMBER_VARIABLE', [], cls, structural('member-identifier'), EXPRESSION);
  rule(`member-constant-${name}`, 'IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], cls, structural('member-identifier'), EXPRESSION);
  rule(`field-inferred-${name}`, 'VARIABLE', 'variable:inferred:instance', [cls], '', structural('variable'), BLOCK);
}
// Remove the duplicate field rows (a field and a local VARIABLE share one key).
for (const name of ['builtin', 'native', 'enum', 'class', 'variant']) {
  const index = rules.findIndex((entry) => entry.id === `field-inferred-${name}`);
  rules.splice(index, 1);
}
for (const [name, cls] of [
  ['builtin', B],
  ['enum', ENUM],
] as const) {
  rule(`constant-inferred-${name}`, 'CONSTANT', 'constant:inferred:class-static', [cls], '', structural('constant'), {
    file: COMPILER,
    symbol: 'GDScriptCompiler::_prepare_compilation constants',
    line: 2945,
  });
  rule(`constant-declared-${name}`, 'CONSTANT', 'constant:declared:class-static', [cls], '', structural('constant'), {
    file: COMPILER,
    symbol: 'GDScriptCompiler::_prepare_compilation constants',
    line: 2945,
  });
}
rule('self', 'SELF', 'self', [], CLASS, structural('self'), EXPRESSION);
// An engine singleton as a call's receiver (`Input.is_action_pressed`) is its class's one object.
rule('singleton', 'IDENTIFIER', 'singleton', [], '', structural('singleton'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression IDENTIFIER (global map: engine singleton)',
  line: 419,
});
rule('variable-declared-uninitialized', 'VARIABLE', 'variable:declared:instance', [], '', structural('variable'), BLOCK);
rule('member-constant-enum-type', 'IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], 'ENUM:meta:*', structural('member-identifier'), EXPRESSION);
rule('enum-value', 'SUBSCRIPT', 'subscript-attribute', [`${ENUM.slice(0, -1)}meta:*`], ENUM, structural('subscript-attribute'), {
  file: ANALYZER,
  symbol: 'GDScriptAnalyzer::reduce_identifier_from_base enum value',
  line: 4084,
});
// A call passes its arguments and result through unchanged whatever they are; what it does is
// its selected target's (a binding row, the script's own function).
for (const [kind, arities] of [
  ['instance', [0, 1, 2, 3, 4, 5]],
  ['static', [0, 1, 2, 3, 4, 5]],
] as const) {
  for (const arity of arities) {
    rule(
      `call-${kind}-any-${String(arity)}-arguments`,
      'CALL',
      `call:${kind}`,
      [CALLEE, ...Array.from({ length: arity }, () => '*')],
      '*',
      structural('call'),
      { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression CALL', line: 603 },
    );
  }
}
rule('builtin-constant', 'SUBSCRIPT', 'subscript-attribute:builtin-constant', [], B, { kind: 'binding' }, {
  file: ANALYZER,
  symbol: 'GDScriptAnalyzer::reduce_identifier_from_base builtin constant',
  line: 4084,
});
rule('member-read-builtin', 'SUBSCRIPT', 'subscript-attribute', [B], B, structural('subscript-attribute'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression SUBSCRIPT',
  line: 784,
});
rule('operator-builtin-binary', 'BINARY_OPERATOR', 'operator:variant-evaluate', [B, B], B, { kind: 'binding' }, {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression BINARY_OPERATOR',
  line: 867,
});
rule('compound-assignment-builtin', 'ASSIGNMENT', 'operator:variant-evaluate', [B, B], B, { kind: 'binding' }, {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression compound ASSIGNMENT (Variant operator)',
  line: 1033,
});
rule('operator-builtin-unary', 'UNARY_OPERATOR', 'operator:variant-evaluate', [B], B, { kind: 'binding' }, {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression UNARY_OPERATOR',
  line: 849,
});
rule('literal-nil', 'LITERAL', 'literal:nil:reduced', [], 'BUILTIN:null', structural('literal'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression LITERAL',
  line: 229,
});
for (const [op, id, js] of [
  ['OP_COMP_EQUAL', 0, '==='],
  ['OP_COMP_NOT_EQUAL', 1, '!=='],
] as const) {
  rule(`${op}-enum`, 'BINARY_OPERATOR', `operator:${op}:${String(id)}`, [ENUM, ENUM], B, { kind: 'binary', operator: js }, {
    file: VARIANT_OP,
    symbol: `OperatorEvaluator ${op} int (enum values)`,
    line: 498,
  });
}
// The analyzer admits only `null` as a built-in operand of an object comparison.
rule('object-equal-null', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [NATIVE, B], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectNil (null identity)',
  line: 510,
});
rule('object-equal-script', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [NATIVE, CLASS], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectEqual (identity)',
  line: 509,
});
rule('script-equal', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [CLASS, CLASS], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectEqual (identity)',
  line: 509,
});
rule('script-equal-object', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [CLASS, NATIVE], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectEqual (identity)',
  line: 509,
});
rule('script-equal-null', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [CLASS, B], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectNil (null identity)',
  line: 510,
});
rule('object-equal', 'BINARY_OPERATOR', 'operator:OP_COMP_EQUAL:0', [NATIVE, NATIVE], B, { kind: 'binary', operator: '===' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorObjectEqual (identity)',
  line: 509,
});

// ---------------------------------------------------------------------------------------------
// The scene tree from script: `$Path`, type tests and casts on objects.

rule('get-node', 'GET_NODE', 'get-node', [], NATIVE, structural('get-node'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression GET_NODE (Node.get_node on self)',
  line: 744,
});
for (const [id, test, operand] of [
  ['type-test-native-on-native', 'native', NATIVE],
  ['type-test-native-on-script', 'native', CLASS],
  ['type-test-script-on-native', 'script', NATIVE],
] as const) {
  rule(id, 'TYPE_TEST', `type-test:${test}`, [operand], B, structural('type-test'), {
    file: 'modules/gdscript/gdscript_vm.cpp',
    symbol: test === 'native' ? 'OPCODE_TYPE_TEST_NATIVE' : 'OPCODE_TYPE_TEST_SCRIPT',
    line: test === 'native' ? 932 : 954,
  });
}
rule('cast-native-on-native', 'CAST', 'cast:native', [NATIVE], NATIVE, structural('cast'), {
  file: 'modules/gdscript/gdscript_vm.cpp',
  symbol: 'OPCODE_CAST_TO_NATIVE',
  line: 1656,
});
rule('cast-script-on-native', 'CAST', 'cast:script', [NATIVE], CLASS, structural('cast'), {
  file: 'modules/gdscript/gdscript_vm.cpp',
  symbol: 'OPCODE_CAST_TO_SCRIPT',
  line: 1687,
});

// ---------------------------------------------------------------------------------------------
// Control flow on bool, by type.

rule('if-bool', 'IF', 'if', [BOOL], '', structural('if'), { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block IF', line: 2066 });
rule('while-bool', 'WHILE', 'while', [BOOL], '', structural('while'), { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block WHILE', line: 2127 });
rule('for-range-int', 'FOR', 'for-range:int', [INT], '', structural('for-range'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_block FOR over int',
  line: 2080,
});
rule('local-iterator-int', 'IDENTIFIER', 'local-identifier:LOCAL_ITERATOR', [], INT, structural('local-identifier'), EXPRESSION);

// `and` / `or` are jumps over a booleanized left operand, never both evaluated
// (`GDScriptCompiler::_parse_expression` BINARY_OPERATOR OP_LOGIC_AND/OR, write_and_left_operand).
const LOGIC = { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression OP_LOGIC_AND/OR', line: 872 };
rule('and-bool', 'BINARY_OPERATOR', 'operator:OP_LOGIC_AND:20', [BOOL, BOOL], BOOL, { kind: 'binary', operator: '&&' }, LOGIC);
rule('or-bool', 'BINARY_OPERATOR', 'operator:OP_LOGIC_OR:21', [BOOL, BOOL], BOOL, { kind: 'binary', operator: '||' }, LOGIC);
rule('not-bool', 'UNARY_OPERATOR', 'operator:OP_LOGIC_NOT:23', [BOOL], BOOL, { kind: 'unary', operator: '!' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorNot<bool>',
  line: 882,
});
for (const [op, id, js] of [
  ['OP_COMP_EQUAL', 0, '==='],
  ['OP_COMP_NOT_EQUAL', 1, '!=='],
] as const) {
  rule(`${op}-bool`, 'BINARY_OPERATOR', `operator:${op}:${String(id)}`, [BOOL, BOOL], BOOL, { kind: 'binary', operator: js }, {
    file: VARIANT_OP,
    symbol: `OperatorEvaluator ${op} bool`,
    line: 498,
  });
}

// ---------------------------------------------------------------------------------------------
// int and float arithmetic and comparison, by type.

const NUMBERS = [
  ['ii', INT, INT, INT],
  ['ff', FLOAT, FLOAT, FLOAT],
  ['if', INT, FLOAT, FLOAT],
  ['fi', FLOAT, INT, FLOAT],
] as const;
const ARITHMETIC = [
  ['OP_ADDITION', 6, '+'],
  ['OP_SUBTRACTION', 7, '-'],
  ['OP_MULTIPLICATION', 8, '*'],
  ['OP_DIVISION', 9, '/'],
] as const;
for (const [pair, left, right, result] of NUMBERS) {
  for (const [op, id, js] of ARITHMETIC) {
    const recipe: GodotCodeRuleRecipe =
      pair === 'ii' && (js === '*' || js === '/')
        ? { kind: 'integer-binary', operator: js }
        : { kind: 'binary', operator: js };
    rule(`${op}-${pair}`, 'BINARY_OPERATOR', `operator:${op}:${String(id)}`, [left, right], result, recipe, {
      file: VARIANT_OP,
      symbol: `OperatorEvaluator ${op} ${pair}`,
      line: 225,
    });
  }
  for (const [op, id, js] of [
    ['OP_COMP_EQUAL', 0, '==='],
    ['OP_COMP_NOT_EQUAL', 1, '!=='],
    ['OP_COMP_LESS', 2, '<'],
    ['OP_COMP_LESS_EQUAL', 3, '<='],
    ['OP_COMP_GREATER', 4, '>'],
    ['OP_COMP_GREATER_EQUAL', 5, '>='],
  ] as const) {
    rule(`${op}-${pair}`, 'BINARY_OPERATOR', `operator:${op}:${String(id)}`, [left, right], BOOL, { kind: 'binary', operator: js }, {
      file: VARIANT_OP,
      symbol: `OperatorEvaluator ${op} ${pair}`,
      line: 498,
    });
  }
}
rule('OP_MODULO-ii', 'BINARY_OPERATOR', 'operator:OP_MODULO:12', [INT, INT], INT, { kind: 'integer-binary', operator: '%' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorModNZ<int64_t>',
  line: 395,
});
rule('OP_NEGATIVE-int', 'UNARY_OPERATOR', 'operator:OP_NEGATIVE:10', [INT], INT, { kind: 'integer-negate' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorNeg<int64_t>',
  line: 456,
});
rule('OP_NEGATIVE-float', 'UNARY_OPERATOR', 'operator:OP_NEGATIVE:10', [FLOAT], FLOAT, { kind: 'unary', operator: '-' }, {
  file: VARIANT_OP,
  symbol: 'OperatorEvaluatorNeg<double>',
  line: 457,
});
const COMPOUND = [
  ['OP_ADDITION', 6, '+='],
  ['OP_SUBTRACTION', 7, '-='],
  ['OP_MULTIPLICATION', 8, '*='],
] as const;
for (const [op, id, js] of COMPOUND) {
  for (const [pair, target, value] of [
    ['ff', FLOAT, FLOAT],
    ['fi', FLOAT, INT],
  ] as const) {
    rule(`assign-${op}-${pair}`, 'ASSIGNMENT', `operator:${op}:${String(id)}`, [target, value], FLOAT, { kind: 'assignment', operator: js }, {
      file: COMPILER,
      symbol: `GDScriptCompiler::_parse_expression compound ASSIGNMENT ${op}`,
      line: 1033,
    });
  }
}
for (const [op, id, js] of [
  ['OP_ADDITION', 6, '+='],
  ['OP_SUBTRACTION', 7, '-='],
] as const) {
  rule(`assign-${op}-ii`, 'ASSIGNMENT', `operator:${op}:${String(id)}`, [INT, INT], INT, { kind: 'assignment', operator: js }, {
    file: COMPILER,
    symbol: `GDScriptCompiler::_parse_expression compound ASSIGNMENT ${op}`,
    line: 1033,
  });
}

// Conversions a typed target applies (`write_assign_with_conversion`): int into float is the
// identity on JS numbers. Float into int truncates and has no rule, so it refuses.
const CONVERSION = { file: COMPILER, symbol: 'GDScriptCompiler write_assign_with_conversion', line: 1006 };
rule('assign-convert-int-float', 'ASSIGNMENT', 'operator:OP_NONE:25:conversion', [FLOAT, INT], INT, { kind: 'assignment', operator: '=' }, CONVERSION);
rule('variable-convert-int-float', 'VARIABLE', 'variable:declared:instance:conversion', [INT, FLOAT], '', structural('variable'), CONVERSION);
rule('return-convert-int-float', 'RETURN', 'return:value:conversion', [INT, FLOAT], '', structural('return'), CONVERSION);

// Defaults: a typed variable before assignment (implicit initializer / clear_address).
const DEFAULTS = { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function implicit initializer', line: 2365 };
for (const [name, type] of [
  ['int', INT],
  ['float', FLOAT],
  ['bool', BOOL],
] as const) {
  rule(`default-${name}`, 'VARIABLE', 'type-default', [], type, structural('type-default'), DEFAULTS);
}
rule('default-builtin', 'VARIABLE', 'type-default', [], B, structural('type-default'), DEFAULTS);
rule('default-native', 'VARIABLE', 'type-default', [], NATIVE, structural('type-default'), DEFAULTS);
rule('default-enum', 'VARIABLE', 'type-default', [], ENUM, structural('type-default'), DEFAULTS);
rule('default-variant', 'VARIABLE', 'type-default', [], 'VARIANT:*', structural('type-default'), DEFAULTS);

// @export fields are ordinary fields in code; their arguments are editor hints.
for (const [annotation, name] of [
  ['@export:resolved:applied:*', 'export'],
  ['@export_range:resolved:applied:*', 'export-range'],
] as const) {
  rules.push({
    id: `field-${name}-declared-builtin`,
    nodeKind: 'VARIABLE',
    semanticKey: `variable:declared:instance|annotations:[${annotation}]`,
    inputDatatypes: [B],
    resultDatatype: '',
    target: structural('variable'),
    source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function implicit initializer', line: 2398 },
  });
}
rules.push({
  id: 'field-export-inferred-builtin',
  nodeKind: 'VARIABLE',
  semanticKey: 'variable:inferred:instance|annotations:[@export:resolved:applied:*]',
  inputDatatypes: [B],
  resultDatatype: '',
  target: structural('variable'),
  source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function implicit initializer', line: 2398 },
});
rules.push({
  id: 'field-onready-inferred-builtin',
  nodeKind: 'VARIABLE',
  semanticKey: 'variable:inferred:instance|annotations:[@onready:resolved:applied:*]',
  inputDatatypes: [B],
  resultDatatype: '',
  target: structural('variable'),
  source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function @implicit_ready', line: 2409 },
});
rules.push({
  id: 'field-onready-declared-builtin',
  nodeKind: 'VARIABLE',
  semanticKey: 'variable:declared:instance|annotations:[@onready:resolved:applied:*]',
  inputDatatypes: [B],
  resultDatatype: '',
  target: structural('variable'),
  source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function @implicit_ready', line: 2409 },
});
rule('implicit-ready', 'CLASS', 'implicit-ready', [], '', structural('implicit-ready'), {
  file: 'modules/gdscript/gdscript.cpp',
  symbol: 'GDScriptInstance::callp → _call_implicit_ready_recursively',
  line: 1946,
});

// Constructs an older exact rule already decides (seed and language-semantics authorities).
for (const id of ['member-constant-native', 'member-constant-class', 'member-variable-class', 'member-variable-variant', 'member-constant-variant', 'variable-inferred-variant', 'while-bool', 'local-iterator-int', 'OP_NEGATIVE-int', 'assign-OP_SUBTRACTION-ii']) {
  rules.splice(
    rules.findIndex((entry) => entry.id === id),
    1,
  );
}

// An Array literal is a new JS array of its elements in source order, typed or not (a typed
// array's element checks never fail on a well-typed program the analyzer accepted).
for (const elements of [0, 1, 2, 3, 5, 8]) {
  rule(
    `array-literal-${String(elements)}`,
    'ARRAY',
    'array-literal',
    Array.from({ length: elements }, () => '*'),
    '*',
    structural('array-literal'),
    { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression ARRAY', line: 505 },
  );
}
// A Dictionary literal is an insertion-ordered JS Map (godot-compat/dictionary.ts); its keys and
// values evaluate in source order.
for (let entries = 0; entries <= 3; entries += 1) {
  rule(
    `dictionary-literal-${String(entries)}`,
    'DICTIONARY',
    'dictionary-object-literal:PYTHON_DICT',
    Array.from({ length: entries * 2 }, () => '*'),
    '*',
    structural('dictionary-object-literal'),
    { file: COMPILER, symbol: 'GDScriptCompiler::_parse_expression DICTIONARY', line: 547 },
  );
}
for (const [kind, type] of [
  ['string', 'BUILTIN:String'],
  ['string-name', 'BUILTIN:StringName'],
] as const) {
  // String and StringName are JS strings (godot-compat/string.ts, dictionary.ts key equality).
  rule(`literal-${kind}`, 'LITERAL', `literal:${kind}:reduced`, [], type, structural('literal'), {
    file: COMPILER,
    symbol: 'GDScriptCompiler::_parse_expression LITERAL',
    line: 229,
  });
}
// A property of the script's own native base (`position`) reads and writes through its API-dump
// accessors on the instance's native entity (godot-compat receivers are native).
rule('native-property-builtin', 'IDENTIFIER', 'member-identifier:native-property', [], B, { kind: 'binding' }, {
  file: 'core/object/object.cpp',
  symbol: 'Object::get / Object::set through ClassDB property accessors',
  line: 243,
});
// A NodePath literal (`get_node("A/C")`'s argument, converted at compile time) is its path text,
// which Node.get_node walks (godot-compat/node.ts).
rule('literal-node-path', 'LITERAL', 'literal:opaque:reduced', [], 'BUILTIN:NodePath', structural('literal'), {
  file: COMPILER,
  symbol: 'GDScriptCompiler::_parse_expression LITERAL (NodePath constant)',
  line: 229,
});
// A native object's property (`$A.name`) reads through its API-dump getter on the object.
rule('native-property-read-builtin', 'SUBSCRIPT', 'subscript-attribute:native-property', [NATIVE], B, { kind: 'binding' }, {
  file: 'core/object/object.cpp',
  symbol: 'Object::get through ClassDB property accessors',
  line: 243,
});
// ClassDB integer constants and enum values are their values (the API dump states them).
for (const [name, result] of [
  ['enum', ENUM],
  ['int', INT],
] as const) {
  rule(`native-constant-${name}`, 'SUBSCRIPT', 'literal:native-constant', [], result, structural('literal'), {
    file: ANALYZER,
    symbol: 'GDScriptAnalyzer::reduce_identifier_from_base native class constant',
    line: 4108,
  });
}
rule('pass', 'PASS', 'pass', [], '', structural('pass'), { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block PASS', line: 2256 });
rule('while-bool-explicit', 'WHILE', 'while', [BOOL], '', structural('while'), { file: COMPILER, symbol: 'GDScriptCompiler::_parse_block WHILE', line: 2127 });
// A Variant stored into a typed built-in converts through the type's constructor binding.
for (const [id, key] of [
  ['variable-convert-variant', 'variable:declared:instance:conversion'],
  ['return-convert-variant', 'return:value:conversion'],
] as const) {
  rule(id, id.startsWith('variable') ? 'VARIABLE' : 'RETURN', key, ['VARIANT:*', B], '', structural(id.startsWith('variable') ? 'variable' : 'return'), CONVERSION);
}
rules.push({
  id: 'field-onready-convert-variant',
  nodeKind: 'VARIABLE',
  semanticKey: 'variable:declared:instance:conversion|annotations:[@onready:resolved:applied:*]',
  inputDatatypes: ['VARIANT:*', B],
  resultDatatype: '',
  target: structural('variable'),
  source: CONVERSION,
});
for (const [annotation, name] of [
  ['@onready:resolved:applied:*', 'onready'],
  ['@export:resolved:applied:*', 'export'],
] as const) {
  for (const [cls, clsName] of (name === 'export'
    ? [[ENUM, 'enum']]
    : [
        [NATIVE, 'native'],
        [ENUM, 'enum'],
      ]) as readonly (readonly [string, string])[]) {
    for (const declared of ['inferred', 'declared'] as const) {
      rules.push({
        id: `field-${name}-${declared}-${clsName}`,
        nodeKind: 'VARIABLE',
        semanticKey: `variable:${declared}:instance|annotations:[${annotation}]`,
        inputDatatypes: [cls],
        resultDatatype: '',
        target: structural('variable'),
        source: { file: COMPILER, symbol: 'GDScriptCompiler::_parse_function implicit initializer', line: 2398 },
      });
    }
  }
}

const datatypes: GodotLanguageDatatypeDefinition[] = [
  { id: 'datatype-int', sourceDatatype: INT, targetType: { kind: 'keyword-type', keyword: 'number' }, source: { file: 'core/variant/variant.h', symbol: 'Variant::INT', line: 97 } },
  { id: 'datatype-float', sourceDatatype: FLOAT, targetType: { kind: 'keyword-type', keyword: 'number' }, source: { file: 'core/variant/variant.h', symbol: 'Variant::FLOAT', line: 98 } },
  { id: 'datatype-bool', sourceDatatype: BOOL, targetType: { kind: 'keyword-type', keyword: 'boolean' }, source: { file: 'core/variant/variant.h', symbol: 'Variant::BOOL', line: 96 } },
  { id: 'datatype-void', sourceDatatype: 'BUILTIN:null', targetType: { kind: 'keyword-type', keyword: 'void' }, source: { file: ANALYZER, symbol: 'GDScriptAnalyzer::resolve_datatype void', line: 1855 } },
  { id: 'datatype-enum', sourceDatatype: ENUM, targetType: { kind: 'keyword-type', keyword: 'number' }, source: { file: 'core/variant/variant.h', symbol: 'Variant::INT (enum values)', line: 97 } },
  { id: 'datatype-script-class', sourceDatatype: CLASS, targetType: { kind: 'type-reference', name: '$ScriptClass', arguments: [] }, source: { file: 'modules/gdscript/gdscript.h', symbol: 'GDScript (script class instance)', line: 60 } },
  { id: 'datatype-script-class-type', sourceDatatype: 'CLASS:meta:*', targetType: { kind: 'type-reference', name: '$ScriptClass', arguments: [] }, source: { file: 'modules/gdscript/gdscript.h', symbol: 'GDScript (script class as a declared type)', line: 60 } },
  { id: 'datatype-variant', sourceDatatype: 'VARIANT:*', targetType: { kind: 'keyword-type', keyword: 'any' }, source: { file: 'core/variant/variant.h', symbol: 'Variant', line: 91 } },
  { id: 'datatype-dictionary', sourceDatatype: 'BUILTIN:Dictionary', targetType: { kind: 'type-reference', name: 'Map', arguments: [{ kind: 'keyword-type', keyword: 'unknown' }, { kind: 'keyword-type', keyword: 'unknown' }] }, source: { file: 'core/variant/dictionary.h', symbol: 'Dictionary', line: 45 } },
  // Array is a JS array and Dictionary a JS Map (godot-compat/array.ts, dictionary.ts), typed or not.
  { id: 'datatype-array', sourceDatatype: 'BUILTIN:Array', targetType: { kind: 'array-type', element: { kind: 'keyword-type', keyword: 'unknown' } }, source: { file: 'core/variant/array.h', symbol: 'Array', line: 49 } },
  { id: 'datatype-typed-array', sourceDatatype: 'BUILTIN:Array[*]', targetType: { kind: 'array-type', element: { kind: 'keyword-type', keyword: 'unknown' } }, source: { file: 'core/variant/typed_array.h', symbol: 'TypedArray', line: 39 } },
  { id: 'datatype-typed-dictionary', sourceDatatype: 'BUILTIN:Dictionary[*]', targetType: { kind: 'type-reference', name: 'Map', arguments: [{ kind: 'keyword-type', keyword: 'unknown' }, { kind: 'keyword-type', keyword: 'unknown' }] }, source: { file: 'core/variant/typed_dictionary.h', symbol: 'TypedDictionary', line: 39 } },
  { id: 'datatype-string', sourceDatatype: 'BUILTIN:String', targetType: { kind: 'keyword-type', keyword: 'string' }, source: { file: 'core/string/ustring.h', symbol: 'String', line: 247 } },
  { id: 'datatype-string-name', sourceDatatype: 'BUILTIN:StringName', targetType: { kind: 'keyword-type', keyword: 'string' }, source: { file: 'core/string/string_name.h', symbol: 'StringName', line: 42 } },
  { id: 'datatype-native', sourceDatatype: NATIVE, targetType: { kind: 'keyword-type', keyword: 'object' }, source: { file: 'core/object/object.h', symbol: 'Object', line: 590 } },
];

// ---------------------------------------------------------------------------------------------
// The GDScript.

const STATIC_SOURCE = `class_name GDScriptCases
extends Node

enum Mode { FIRST, SECOND = 4 }

const LIMIT: float = 2.5
const COUNT := 3
const FLAG: bool = true
const MODE := Mode.SECOND
const UNIT := Vector3(1.0, 1.0, 1.0)

static var hits: int = 0

static func touch(result: bool) -> bool:
\thits += 1
\treturn result

${ARITHMETIC.map(
  ([op, , js]) =>
    NUMBERS.map(
      ([pair, left, right, result]) =>
        `static func ${op.toLowerCase()}_${pair}(a: ${left.slice(8)}, b: ${right.slice(8)}) -> ${result.slice(8)}:\n\treturn a ${js} b\n`,
    ).join('\n'),
).join('\n')}
${['==', '!=', '<', '<=', '>', '>=']
  .map((js, index) =>
    NUMBERS.map(
      ([pair, left, right]) =>
        `static func compare_${String(index)}_${pair}(a: ${left.slice(8)}, b: ${right.slice(8)}) -> bool:\n\treturn a ${js} b\n`,
    ).join('\n'),
  )
  .join('\n')}
static func modulo(a: int, b: int) -> int:
\treturn a % b

static func negate_int(a: int) -> int:
\treturn -a

static func negate_float(a: float) -> float:
\treturn -a

static func int_zero_sign(a: int, b: int) -> float:
\tvar product: int = a * b
\treturn 1.0 / product

static func negated_zero_sign(a: int) -> float:
\tvar negated: int = -a
\treturn 1.0 / negated

static func compound(a: float, b: int) -> float:
\tvar x: float = a
\tx += b
\tx -= 0.25
\tx *= a
\tx -= b
\tx += 2.0
\tx -= a
\tx *= 3
\treturn x

static func compound_int(a: int) -> int:
\tvar n: int = a
\tn += 7
\tn -= 2
\treturn n

static func convert_int(a: int) -> float:
\tvar f: float = 0.5
\tf = a
\treturn f

static func declared_convert(a: int) -> float:
\tvar f: float = a
\treturn f

static func return_convert(a: int) -> float:
\treturn a

static func logic(a: bool, b: bool) -> int:
\tvar n := 0
\tif a and b:
\t\tn += 1
\tif a or b:
\t\tn += 10
\tif not a:
\t\tn += 100
\tif a == b:
\t\tn += 1000
\tif a != b:
\t\tn += 10000
\treturn n

static func short_circuit_and(a: bool) -> int:
\thits = 0
\tvar r: bool = a and touch(true)
\tif r:
\t\thits += 100
\treturn hits

static func short_circuit_or(a: bool) -> int:
\thits = 0
\tvar r: bool = a or touch(false)
\tif r:
\t\thits += 100
\treturn hits

static func loop_sum(n: int) -> int:
\tvar total := 0
\tfor i in n:
\t\tif i == 2:
\t\t\tcontinue
\t\ttotal += i
\tvar k := 0
\twhile k < 3:
\t\tk += 1
\treturn total * 10 + k

static func defaults() -> float:
\tvar i: int
\tvar f: float
\tvar b: bool
\tif b:
\t\treturn -1.0
\treturn i + f

static func default_vector() -> Vector3:
\tvar v: Vector3
\treturn v

static func constants() -> float:
\tvar m: int = MODE
\tif FLAG:
\t\treturn LIMIT * COUNT + m + UNIT.x
\treturn 0.0

static func enum_locals() -> int:
\tvar a := Mode.FIRST
\tvar b: Mode = Mode.SECOND
\tvar c := a
\tc = b
\treturn c

static func objects(n: Node) -> bool:
\tvar m: Node = n
\tvar k := m
\tvar j: Node
\tj = k
\treturn j == n

static func native_constants() -> int:
\tvar a: int = RenderingServer.SHADOW_QUALITY_SOFT_HIGH
\tvar b: int = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
\tvar c: int = Node.PROCESS_MODE_ALWAYS
\tvar q := RenderingServer.SHADOW_QUALITY_SOFT_HIGH
\tvar d: int = q
\treturn a * 1000 + b * 100 + c * 10 + d

static func singleton_calls() -> int:
\treturn Engine.get_process_frames() + Engine.get_physics_frames() * 10

static func while_call() -> int:
\thits = 0
\twhile touch(hits < 3):
\t\tpass
\treturn hits

static func untyped():
\treturn Vector3(1.0, 2.0, 3.0)

static func variant_flow(u):
\tvar a = u
\tvar b
\tb = a
\treturn b

static func variant_to_vector(u) -> Vector3:
\tvar v: Vector3 = u
\treturn v

static func variant_return(u) -> Vector3:
\treturn u

const TABLE := {"x": 1.5, 3: "three"}

static func dictionary_literal(n: int) -> Dictionary:
\thits = 0
\tvar d := {"a": n, touch(true): "b", n + 1: touch(false)}
\treturn d

static func strings() -> String:
\tvar s := "take"
\treturn s

static func string_name() -> StringName:
\treturn &"take"

static func typed_arrays() -> Array:
\tvar ints: Array[int] = []
\tvar vectors: Array[Vector3] = [Vector3(1.0, 2.0, 3.0)]
\tvar words: Array[String] = ["a", "b"]
\tvar plain: Array = [ints, vectors, words]
\treturn plain

static func typed_dictionary() -> Dictionary:
\tvar d: Dictionary[String, int] = {"one": 1}
\treturn d

static func dictionary_empty() -> Dictionary:
\treturn {}

static func dictionary_one(n: int) -> Dictionary:
\treturn {"k": n}

static func dictionary_constant() -> Dictionary:
\treturn TABLE

static func zero() -> float:
\treturn 0.5

static func sum2(a: float, b: float) -> float:
\treturn a + b

static func sum3(a: float, b: float, c: float) -> float:
\treturn a + b + c

static func sum4(a: float, b: float, c: float, d: float) -> float:
\treturn a + b + c + d

static func sum5(a: float, b: float, c: float, d: float, e: float) -> float:
\treturn a + b + c + d + e

static func static_calls() -> float:
\treturn zero() + sum2(1.0, 2.0) + sum3(1.0, 2.0, 3.0) + sum4(1.0, 2.0, 3.0, 4.0) + sum5(1.0, 2.0, 3.0, 4.0, 5.5)

static func object_pass(n: Node) -> Node:
\treturn n

static func objects_returned(n: Node) -> bool:
\treturn object_pass(n) == n

static func enum_param(m: Mode) -> int:
\treturn m

const HALF := 0.5

static func inferred_constant_float() -> float:
\treturn HALF

static func pass_through(value: Vector3) -> Vector3:
\treturn value

static func calls_static() -> Vector3:
\treturn pass_through(Vector3(1.0, 2.0, 3.0))
${readVectorSource()}`;

function readVectorSource(): string {
  return `
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
}

/** Fields and @onready: defaults at construction, @onready right before `_ready`. */
const MEMBER_SOURCE = `class_name MemberCases
extends Node

var marks: int = 0
var plain: float = _mark(1.5)
@export var exported: float = _mark(3.5)
@export_range(0, 10, 1) var ranged: float = 2.0
@onready var late: float = _mark(plain + exported)
@onready var late_vector := Vector3(late, 2.0, 3.0)
var untyped_default: float
var flag: bool = true
var vector: Vector3
@export var inferred_export := 4.5
var node_field: Node
enum Kind { LOW, HIGH = 7 }
const HIGH_KIND := Kind.HIGH
const DECLARED_KIND: Kind = Kind.LOW
var kind_field := Kind.HIGH
@export var exported_kind := Kind.HIGH
@export var declared_kind: Kind = Kind.LOW
@onready var holder := make_node()
@onready var typed_holder: Node = make_node()
@onready var ready_kind := Kind.HIGH
@onready var declared_ready_kind: Kind = Kind.LOW
@onready var from_variant: Vector3 = untyped()

static func make_node() -> Node:
\treturn null

static func untyped():
\treturn Vector3(4.0, 5.0, 6.0)

func holders_empty() -> bool:
\treturn holder == null and typed_holder == null and ready_kind != declared_ready_kind and exported_kind != declared_kind

func get_from_variant() -> Vector3:
\treturn from_variant

func _mark(value: float) -> float:
\tmarks += 1
\treturn value * 10.0 + marks

func get_marks() -> int:
\treturn marks

func get_plain() -> float:
\treturn plain

func get_exported() -> float:
\treturn exported

func get_ranged() -> float:
\treturn ranged

func get_late() -> float:
\treturn late

func get_late_vector() -> Vector3:
\treturn late_vector

func get_default() -> float:
\treturn untyped_default

func get_vector() -> Vector3:
\treturn vector

func get_inferred_export() -> float:
\treturn inferred_export

func node_field_is_null() -> bool:
\treturn node_field == null

func kinds() -> bool:
\tvar k: Kind = DECLARED_KIND
\tkind_field = HIGH_KIND
\treturn kind_field == Kind.HIGH and k != Kind.HIGH

func self_as_node() -> bool:
\tvar n: Node = self
\treturn n == self

func sum4i(a: float, b: float, c: float, d: float) -> float:
\treturn a * b + c * d

func sum5i(a: float, b: float, c: float, d: float, e: float) -> float:
\treturn a * b + c * d + e

func instance_calls() -> float:
\treturn sum4i(1.0, 2.0, 3.0, 4.0) + sum5i(1.5, 2.0, 3.0, 4.0, 5.0)

func takes(m: MemberCases) -> MemberCases:
\treturn m

func class_values() -> bool:
\tvar a := self
\tvar b: MemberCases = a
\tvar c := b
\tc = takes(a)
\treturn c == self

func toggle() -> bool:
\tflag = not flag
\tvector.y = 4.0
\treturn flag
`;

/** A script on a native base: its native properties and methods act on the attached entity. */
const NODE3D_SOURCE = `class_name Node3DCases
extends Node3D

func place() -> Vector3:
\tposition = Vector3(1.0, 2.0, 3.0)
\treturn position

func nudge() -> Vector3:
\tposition += Vector3(0.5, -0.25, 0.0)
\treturn position

func explicit_self() -> Vector3:
\treturn self.get_position()

func implicit_self() -> Vector3:
\treturn get_position()
`;

const NODE3D_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://node3d_cases.gd" id="1_cases"]

[node name="Main" type="Node3D"]
script = ExtResource("1_cases")
`;

const READY_SOURCE = `class_name ReadyCases
extends Node

var seen: float = -1.0
@onready var base_late: float = 7.0

func _ready() -> void:
\tseen = base_late

func get_seen() -> float:
\treturn seen

func get_base_late() -> float:
\treturn base_late
`;

const DERIVED_SOURCE = `class_name ReadyDerived
extends "res://ready_cases.gd"

@onready var derived_late: float = base_late + 1.0

func get_derived_late() -> float:
\treturn derived_late
`;

/** `$Path` and `get_node` on a scene the script's root carries. */
const NODE_PATH_SOURCE = `class_name NodePathCases
extends Node

func name_a() -> StringName:
\treturn $A.name

func name_b() -> StringName:
\treturn $A/B.name

func name_c() -> StringName:
\treturn get_node("A/C").name

func name_quoted() -> StringName:
\treturn $"A/B".name

func same_node() -> bool:
\treturn $A == get_node("A")

func parent_of_b() -> bool:
\treturn $A/B.get_parent() == $A
`;

const NODE_PATH_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://node_path_cases.gd" id="1_cases"]

[node name="Root" type="Node"]
script = ExtResource("1_cases")

[node name="A" type="Node" parent="."]

[node name="B" type="Node" parent="A"]

[node name="C" type="Node" parent="A"]
`;

const TAGGED_SOURCE = `class_name Tagged
extends Node3D
`;

const DERIVED_TAGGED_SOURCE = `class_name DerivedTagged
extends Tagged
`;

/** Type tests and casts over a scene of native and scripted nodes. */
const TYPE_SOURCE = `class_name TypeCases
extends Node3D

func natives() -> Array:
\tvar body: Node = $Body
\tvar character: Node = $Character
\tvar plain: Node = $Plain
\tvar me: Node = self
\treturn [body is RigidBody3D, body is PhysicsBody3D, body is CharacterBody3D, character is PhysicsBody3D, plain is Node3D, plain is Node, self is Node3D, me is RigidBody3D]

func scripts() -> Array:
\tvar tagged: Node = $Tagged
\tvar derived: Node = $Derived
\tvar body: Node = $Body
\treturn [tagged is Tagged, derived is Tagged, tagged is DerivedTagged, derived is DerivedTagged, body is Tagged]

func nulls() -> Array:
\tvar nothing: Node = null
\treturn [nothing is Node, nothing is Tagged]

func casts() -> Array:
\tvar body: Node = $Body
\tvar tagged: Node = $Tagged
\tvar derived: Node = $Derived
\tvar nothing: Node = null
\treturn [body as RigidBody3D == body, body as CharacterBody3D == null, derived as Tagged == derived, tagged as DerivedTagged == null, nothing as Node3D == null]
`;

const TYPE_SCENE = `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://type_cases.gd" id="1_cases"]
[ext_resource type="Script" path="res://tagged.gd" id="2_tagged"]
[ext_resource type="Script" path="res://derived_tagged.gd" id="3_derived"]

[node name="Root" type="Node3D"]
script = ExtResource("1_cases")

[node name="Body" type="RigidBody3D" parent="."]

[node name="Character" type="CharacterBody3D" parent="."]

[node name="Plain" type="Node" parent="."]

[node name="Tagged" type="Node3D" parent="."]
script = ExtResource("2_tagged")

[node name="Derived" type="Node3D" parent="."]
script = ExtResource("3_derived")
`;

/** A native node as the composition site adopts it: its kind and its Godot class chain. */
function nativeNode(name: string, classes: readonly string[], parent?: Object3D): Object3D {
  const entity = classes.includes('Node3D') ? new Object3D() : new Group();
  entity.name = name;
  godot_node_adopt(entity, { kind: classes.includes('Node3D') ? 'spatial' : 'node', classes });
  if (parent !== undefined) add_child(parent, entity);
  return entity;
}

const NODE = ['Node', 'Object'];
const NODE3D = ['Node3D', ...NODE];
const BODY3D = ['PhysicsBody3D', 'CollisionObject3D', ...NODE3D];

// ---------------------------------------------------------------------------------------------
// The cases.

const cases: GodotLanguageCase[] = [];
const add = (id: string, call: string, gdscript: string, target: () => readonly unknown[]): void => {
  cases.push({ id, call, arguments: { gdscript, target }, comparator: 'exact' });
};
const numberText = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(value);
const floatText = (value: number): string => {
  const text = String(value).replace('e+', 'e');
  return /[.e]/.test(text) ? text : `${text}.0`;
};
const INT_INPUTS: readonly (readonly [number, number])[] = [
  [7, 2],
  [-7, 2],
  [7, -2],
  [-7, -2],
  [0, 5],
  [9007199254740, 3],
  [-1, 1],
];
const FLOAT_INPUTS: readonly (readonly [number, number])[] = [
  [7.5, 2],
  [-0.1, 0.3],
  [1e300, 1e10],
  [0, -1],
];
for (const [op] of ARITHMETIC) {
  for (const [pair] of NUMBERS) {
    const inputs: readonly (readonly [number, number])[] =
      pair === 'ii'
        ? INT_INPUTS
        : pair === 'ff'
          ? FLOAT_INPUTS.map(([a, b]) => [a, b === 0 ? 1 : b] as const)
          : (
              [
                [7, 0.3],
                [-3, 2.5],
                [0, -1.5],
                [5, 1e300],
              ] as readonly (readonly [number, number])[]
            ).map(([a, b]) => (pair === 'if' ? ([a, b] as const) : ([b, a === 0 ? 4 : a] as const)));
    inputs.forEach(([a, b], index) => {
      const left = a;
      const right = b;
      const text = (value: number, kind: string) => (kind === 'i' ? numberText(value) : floatText(value));
      add(
        `${op.toLowerCase()}-${pair}-${String(index)}`,
        `${op.toLowerCase()}_${pair}`,
        `${text(left, pair[0] as string)}, ${text(right, pair[1] as string)}`,
        () => [left, right],
      );
    });
  }
}
for (let index = 0; index < 6; index += 1) {
  for (const [pair] of NUMBERS) {
    for (const [a, b] of [
      [1, 2],
      [2, 2],
      [3, 2],
      [-1, -1],
    ] as const) {
      const text = (value: number, kind: string) => (kind === 'i' ? numberText(value) : floatText(value));
      add(
        `compare-${String(index)}-${pair}-${String(a)}-${String(b)}`,
        `compare_${String(index)}_${pair}`,
        `${text(a, pair[0] as string)}, ${text(b, pair[1] as string)}`,
        () => [a, b],
      );
    }
  }
}
for (const [a, b] of [
  [7, 3],
  [-7, 3],
  [7, -3],
  [-7, -3],
  [-4, 2],
] as const) {
  add(`modulo-${String(a)}-${String(b)}`, 'modulo', `${String(a)}, ${String(b)}`, () => [a, b]);
}
for (const value of [5, -5, 0]) {
  add(`negate-int-${String(value)}`, 'negate_int', String(value), () => [value]);
  add(`negate-float-${String(value)}`, 'negate_float', floatText(value), () => [value]);
}
add('int-zero-sign', 'int_zero_sign', '-3, 0', () => [-3, 0]);
add('negated-zero-sign', 'negated_zero_sign', '0', () => [0]);
add('int-division-zero-sign', 'op_division_ii', '-1, 2', () => [-1, 2]);
add('compound', 'compound', '1.5, 3', () => [1.5, 3]);
add('compound-int', 'compound_int', '4', () => [4]);
add('convert-int', 'convert_int', '3', () => [3]);
add('declared-convert', 'declared_convert', '-2', () => [-2]);
add('return-convert', 'return_convert', '9', () => [9]);
for (const a of [true, false]) {
  for (const b of [true, false]) {
    add(`logic-${String(a)}-${String(b)}`, 'logic', `${String(a)}, ${String(b)}`, () => [a, b]);
  }
  add(`short-and-${String(a)}`, 'short_circuit_and', String(a), () => [a]);
  add(`short-or-${String(a)}`, 'short_circuit_or', String(a), () => [a]);
}
for (const n of [0, 1, 5]) add(`loop-${String(n)}`, 'loop_sum', String(n), () => [n]);
for (const call of [
  'defaults',
  'default_vector',
  'constants',
  'enum_locals',
  'calls_static',
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
]) {
  cases.push({ id: call, call, comparator: 'exact' });
}
add('argument-passing', 'argument_passing', 'Vector3(1.0, 1.0, 1.0), 0.5', () => [V.construct(1, 1, 1), 0.5]);
add('objects', 'objects', 'Node.new()', () => [{}]);
add('objects-returned', 'objects_returned', 'Node.new()', () => [{}]);
add('enum-param', 'enum_param', '4', () => [4]);
cases.push({ id: 'static-calls', call: 'static_calls', comparator: 'exact' });
add('dictionary-literal', 'dictionary_literal', '5', () => [5]);
cases.push({ id: 'dictionary-constant', call: 'dictionary_constant', comparator: 'exact' });
cases.push({ id: 'strings', call: 'strings', comparator: 'exact' });
cases.push({ id: 'dictionary-empty', call: 'dictionary_empty', comparator: 'exact' });
cases.push({ id: 'typed-arrays', call: 'typed_arrays', comparator: 'exact' });
cases.push({ id: 'typed-dictionary', call: 'typed_dictionary', comparator: 'exact' });
add('dictionary-one', 'dictionary_one', '7', () => [7]);
cases.push({ id: 'string-name', call: 'string_name', comparator: 'exact' });
for (const call of ['native_constants', 'while_call', 'singleton_calls']) {
  cases.push({ id: call.replaceAll('_', '-'), call, comparator: 'exact' });
}
for (const call of ['variant_flow', 'variant_to_vector', 'variant_return']) {
  add(call.replaceAll('_', '-'), call, 'Vector3(1.5, 2.0, 3.0)', () => [V.construct(1.5, 2, 3)]);
  if (call !== 'variant_flow') {
    add(`${call.replaceAll('_', '-')}-from-vector3i`, call, 'Vector3i(1, -2, 3)', () => [{ x: 1, y: -2, z: 3 }]);
  }
}
cases.push({ id: 'inferred-constant-float', call: 'inferred_constant_float', comparator: 'exact' });
cases.push({
  id: 'members-and-onready',
  className: 'MemberCases',
  call: '',
  instance: {
    steps: [
      'get_marks',
      'get_plain',
      'get_exported',
      'get_ranged',
      'get_late',
      'get_default',
      'get_vector',
      'get_inferred_export',
      'kinds',
      'self_as_node',
      'class_values',
      'instance_calls',
      '$ready',
      'get_marks',
      'get_late',
      'get_late_vector',
      'holders_empty',
      'get_from_variant',
      'toggle',
      'get_vector',
    ],
  },
  comparator: 'exact',
});
cases.push({
  id: 'native-base-properties',
  className: 'Node3DCases',
  call: '',
  instance: {
    steps: ['implicit_self', 'place', 'nudge', 'explicit_self', 'implicit_self'],
    native: () => new Object3D(),
  },
  comparator: 'exact',
});
cases.push({
  id: 'ready-order',
  className: 'ReadyCases',
  call: '',
  instance: { steps: ['get_seen', 'get_base_late', '$ready', 'get_seen', 'get_base_late'] },
  comparator: 'exact',
});
cases.push({
  id: 'ready-derived-order',
  className: 'ReadyDerived',
  call: '',
  instance: { steps: ['get_seen', 'get_derived_late', '$ready', 'get_seen', 'get_derived_late'] },
  comparator: 'exact',
});

cases.push({
  id: 'node-paths',
  className: 'NodePathCases',
  call: '',
  instance: {
    scene: 'node_path_cases.tscn',
    steps: ['name_a', 'name_b', 'name_c', 'name_quoted', 'same_node', 'parent_of_b'],
    native: () => {
      const root = nativeNode('Root', NODE);
      const a = nativeNode('A', NODE, root);
      nativeNode('B', NODE, a);
      nativeNode('C', NODE, a);
      return root;
    },
    adopt: (instance, native) => {
      godot_node_adopt(native as object, { binding: { owner: instance } });
    },
  },
  comparator: 'exact',
});
cases.push({
  id: 'type-tests-and-casts',
  className: 'TypeCases',
  call: '',
  instance: {
    scene: 'type_cases.tscn',
    steps: ['natives', 'scripts', 'nulls', 'casts'],
    native: () => {
      const root = nativeNode('Root', NODE3D);
      nativeNode('Body', ['RigidBody3D', ...BODY3D], root);
      nativeNode('Character', ['CharacterBody3D', ...BODY3D], root);
      nativeNode('Plain', NODE, root);
      nativeNode('Tagged', NODE3D, root);
      nativeNode('Derived', NODE3D, root);
      return root;
    },
    adopt: (instance, native, classes) => {
      const root = native as Object3D;
      godot_node_adopt(root, { binding: { owner: instance } });
      for (const [child, className] of [
        ['Tagged', 'Tagged'],
        ['Derived', 'DerivedTagged'],
      ] as const) {
        const entity = root.children.find((entry) => entry.name === child) as Object3D;
        const Script = classes.get(className) as new (native?: unknown) => object;
        godot_node_adopt(entity, { binding: { owner: new Script(entity) } });
      }
    },
  },
  comparator: 'exact',
});

const GDSCRIPT_EVIDENCE: GodotLanguageEvidenceFile = {
  kind: 'language',
  className: 'GDScriptCases',
  scripts: [
    { file: 'gdscript_cases.gd', className: 'GDScriptCases', source: STATIC_SOURCE },
    { file: 'member_cases.gd', className: 'MemberCases', source: MEMBER_SOURCE },
    { file: 'ready_cases.gd', className: 'ReadyCases', source: READY_SOURCE },
    { file: 'ready_derived.gd', className: 'ReadyDerived', source: DERIVED_SOURCE },
    { file: 'node3d_cases.gd', className: 'Node3DCases', source: NODE3D_SOURCE },
    { file: 'node_path_cases.gd', className: 'NodePathCases', source: NODE_PATH_SOURCE },
    { file: 'tagged.gd', className: 'Tagged', source: TAGGED_SOURCE },
    { file: 'derived_tagged.gd', className: 'DerivedTagged', source: DERIVED_TAGGED_SOURCE },
    { file: 'type_cases.gd', className: 'TypeCases', source: TYPE_SOURCE },
  ],
  scenes: [
    { file: 'main.tscn', source: NODE3D_SCENE },
    { file: 'node_path_cases.tscn', source: NODE_PATH_SCENE },
    { file: 'type_cases.tscn', source: TYPE_SCENE },
  ],
  compatModules: ['lib/godot-compat/vector3', 'lib/godot-compat/node-3d', 'lib/godot-compat/node', 'lib/godot-compat/engine'],
  rules,
  datatypes,
  cases,
};

export default GDSCRIPT_EVIDENCE;
