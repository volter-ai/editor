/**
 * Rules for GDScript's Variant containers and the plain constructs around them, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`:
 *
 * - A typed parameter with a default (`pitch: float = 1.0`) is a JS default parameter: GDScript
 *   evaluates the default only when the caller omits the argument (the function's default-argument
 *   jump table, `GDScriptFunction::call`, modules/gdscript/gdscript_vm.cpp:573), as JS evaluates a
 *   default only for a missing argument. `lowerOfficialParameters` refuses a default that would
 *   convert (other than an int into a float).
 * - A String stored into a StringName place and the reverse convert through the target's
 *   constructor (`write_assign_with_conversion`); compat represents both as the same JS string, so
 *   the conversion is the identity.
 * - A dictionary literal of any size is a `Map` of its entries in source order (`Dictionary`'s
 *   insertion-ordered `HashMap`, core/variant/dictionary.cpp:46).
 * - An element read of an Array or PackedStringArray (`a[i]`) is Variant indexing
 *   (`VariantIndexedSetGet`, core/variant/variant_setget.cpp): a negative index counts from the end,
 *   which JS's `Array.prototype.at` does too; a constant non-negative index is a plain element.
 *   An Array's element store writes the shared array in place; a PackedStringArray's writes the
 *   variable's own copy (`Vector<String>` is copy-on-write), so compat's `with_indexed` returns a
 *   new frozen array and the store assigns it back to the variable's place.
 *   A Dictionary's `d[k]` reads the key through `Dictionary.get` and `d[k] = v` stores it through
 *   `Dictionary.set` (`Variant::get` / `Variant::set` keyed, core/variant/variant_setget.cpp).
 */
import type { GodotCodeRuleEntry, GodotCodeRuleRecipe, GodotDatatypeRuleEntry } from '../lowering-rules';
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from './godot-4.7-seed';

function rule(
  nodeKind: GodotCodeRuleEntry['source']['nodeKind'],
  semanticKey: string,
  inputDatatypes: readonly string[],
  resultDatatype: string,
  target: GodotCodeRuleRecipe,
): GodotCodeRuleEntry {
  return {
    source: { sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION, nodeKind, semanticKey: `${semanticKey}|annotations:[]`, inputDatatypes, resultDatatype },
    target,
  };
}

/** A rule whose node carries annotations (`@onready`, `@export_range`), by their key. */
function annotatedRule(
  nodeKind: GodotCodeRuleEntry['source']['nodeKind'],
  semanticKey: string,
  annotations: string,
  inputDatatypes: readonly string[],
  resultDatatype: string,
  target: GodotCodeRuleRecipe,
): GodotCodeRuleEntry {
  return {
    source: { sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION, nodeKind, semanticKey: `${semanticKey}|annotations:[${annotations}]`, inputDatatypes, resultDatatype },
    target,
  };
}

const OPERAND_CLASSES = ['VARIANT:*', 'BUILTIN:*', 'NATIVE:*', 'CLASS:*', 'SCRIPT:*', 'ENUM:*'];
/** Every pair of operand classes with an untyped operand. */
const VARIANT_OPERAND_PAIRS = OPERAND_CLASSES.flatMap((left) =>
  OPERAND_CLASSES.flatMap((right) => (left === 'VARIANT:*' || right === 'VARIANT:*' ? [[left, right] as const] : [])),
);

const CONVERTIBLE = ['BUILTIN:*', 'NATIVE:*', 'CLASS:*', 'SCRIPT:*', 'ENUM:*', 'VARIANT:*'];
const OBJECTS = new Set(['NATIVE:*', 'CLASS:*', 'SCRIPT:*']);
/** Converting pairs (target, value) with an untyped side, or between object types, the known ones left out. */
const CONVERTED_PAIRS = CONVERTIBLE.flatMap((target) =>
  CONVERTIBLE.flatMap((value) => {
    const untyped = target === 'VARIANT:*' || value === 'VARIANT:*';
    const objects = OBJECTS.has(target) && OBJECTS.has(value);
    const known = objects && ((target === 'NATIVE:*' && value === 'NATIVE:*') || (target === 'CLASS:*' && value === 'NATIVE:*') || (target === 'CLASS:*' && value === 'CLASS:*') || (target === 'NATIVE:*' && value === 'CLASS:*'));
    return (untyped || objects) && !known ? [[target, value] as const] : [];
  }),
);

const DICTIONARY_ENTRY_COUNTS = [4, 5, 6, 7, 8, 10, 12, 16];

export const GODOT_4_7_VARIANT_CONTAINER_RULES: readonly GodotCodeRuleEntry[] = [
  ...['declared', 'inferred'].flatMap((declared) =>
    ['BUILTIN:*', 'ENUM:*'].map((input) => rule('PARAMETER', `parameter:${declared}:defaulted`, [input], '', { kind: 'structural', construct: 'parameter' })),
  ),
  rule('ASSIGNMENT', 'operator:OP_NONE:25:conversion', ['BUILTIN:StringName', 'BUILTIN:String'], 'BUILTIN:String', { kind: 'assignment', operator: '=' }),
  rule('ASSIGNMENT', 'operator:OP_NONE:25:conversion', ['BUILTIN:String', 'BUILTIN:StringName'], 'BUILTIN:StringName', { kind: 'assignment', operator: '=' }),
  ...DICTIONARY_ENTRY_COUNTS.map((entries) =>
    rule('DICTIONARY', 'dictionary-object-literal:PYTHON_DICT', Array.from({ length: entries * 2 }, () => '*'), '*', { kind: 'structural', construct: 'dictionary-object-literal' }),
  ),
  // A loop variable bound to each element of a container the analysis typed (`container-types.ts`).
  rule('IDENTIFIER', 'local-identifier:LOCAL_ITERATOR', [], 'BUILTIN:*', { kind: 'structural', construct: 'local-identifier' }),
  rule('SUBSCRIPT', 'subscript-element:array', ['*', '*'], '*', { kind: 'structural', construct: 'subscript-element' }),
  rule('SUBSCRIPT', 'subscript-element:dictionary', ['*', '*'], '*', { kind: 'binding' }),
  // An operator (or a compound assignment's) with an untyped operand: `Variant::evaluate` on the
  // values the operands hold at run time (`variant-operator.ts`).
  ...VARIANT_OPERAND_PAIRS.flatMap(([left, right]) =>
    (['BINARY_OPERATOR', 'ASSIGNMENT'] as const).flatMap((nodeKind) =>
      ['VARIANT:*', 'BUILTIN:*', 'NATIVE:*', ''].map((result) => rule(nodeKind, 'operator:variant-evaluate', [left, right], result, { kind: 'variant-operator' })),
    ),
  ),
  ...['VARIANT:*', 'BUILTIN:*'].map((result) => rule('UNARY_OPERATOR', 'operator:variant-evaluate', ['VARIANT:*'], result, { kind: 'variant-operator' })),
  // A native property read the compiler left untyped (an object narrowed by `is`): its getter's
  // value, whatever the compiler stated for it.
  ...['NATIVE:*', 'CLASS:*'].map((input) => rule('SUBSCRIPT', 'subscript-attribute:native-property', [input], 'VARIANT:*', { kind: 'binding' })),
  // A store, return or declaration converting a value only the run time types, or an object into
  // another object type: Godot converts (or checks) the value as it runs, compat holds it as is.
  ...CONVERTED_PAIRS.map(([target, value]) => rule('ASSIGNMENT', 'operator:OP_NONE:25:conversion', [target, value], value, { kind: 'assignment', operator: '=' })),
  ...CONVERTED_PAIRS.filter(([target, value]) => !(target === 'VARIANT:*' && value === 'BUILTIN:*')).flatMap(([target, value]) => [
    rule('RETURN', 'return:value:conversion', [target, value], '', { kind: 'structural', construct: 'return' }),
    rule('VARIABLE', 'variable:declared:instance:conversion', [target, value], '', { kind: 'structural', construct: 'variable' }),
    rule('VARIABLE', 'variable:declared:local:conversion', [target, value], '', { kind: 'structural', construct: 'variable' }),
  ]),
  // A dictionary literal of any size, in either style (`{"a": 1}` or `{a = 1}`): a `Map` of its
  // entries in source order (`GODOT_CODE_RULE_REST` takes any number of keys and values).
  rule('DICTIONARY', 'dictionary-object-literal:PYTHON_DICT', ['*...'], '*', { kind: 'structural', construct: 'dictionary-object-literal' }),
  rule('DICTIONARY', 'dictionary-object-literal:LUA_TABLE', ['*...'], '*', { kind: 'structural', construct: 'dictionary-object-literal' }),
  // A class constant of an object value (a preloaded scene or resource), any type.
  ...['NATIVE:*', 'CLASS:*', 'SCRIPT:*', 'VARIANT:*'].flatMap((input) =>
    ['declared', 'inferred'].map((declared) => rule('CONSTANT', `constant:${declared}:class-static`, [input], '', { kind: 'structural', construct: 'constant' })),
  ),
  // `is` and `as` of a value whatever the analysis typed it as: tested at run time.
  ...['VARIANT:*', 'CLASS:*', 'SCRIPT:*'].map((input) => rule('TYPE_TEST', 'type-test:script', [input], 'BUILTIN:*', { kind: 'structural', construct: 'type-test' })),
  ...['VARIANT:*', 'SCRIPT:*'].map((input) => rule('TYPE_TEST', 'type-test:native', [input], 'BUILTIN:*', { kind: 'structural', construct: 'type-test' })),
  ...['VARIANT:*', 'CLASS:*', 'SCRIPT:*'].map((input) => rule('CAST', 'cast:script', [input], 'CLASS:*', { kind: 'structural', construct: 'cast' })),
  ...['VARIANT:*', 'SCRIPT:*'].map((input) => rule('CAST', 'cast:native', [input], 'NATIVE:*', { kind: 'structural', construct: 'cast' })),
  // A Variant stored into an object-typed place (`player.stream = sounds[i]`): the value as that
  // class, which Godot's typed assignment checks.
  ...['NATIVE:*', 'CLASS:*'].map((place) => rule('ASSIGNMENT', 'operator:OP_NONE:25', [place, 'VARIANT:*'], 'VARIANT:*', { kind: 'assignment', operator: '=' })),
  // A loop variable typed as an object class over a list of objects: each element as that class.
  ...['NATIVE:*', 'CLASS:*', 'SCRIPT:*'].map((variable) => rule('FOR', 'for-of:conversion', ['BUILTIN:*', variable], '', { kind: 'structural', construct: 'for-of' })),
  // An enum is its int in arithmetic (`Mood.size() - 1`, `mood + 1`): the numbers' own `+` and `-`.
  ...(
    [
      ['OP_ADDITION:6', '+'],
      ['OP_SUBTRACTION:7', '-'],
    ] as const
  ).flatMap(([operator, symbol]) =>
    [
      ['ENUM:*', 'BUILTIN:*'],
      ['BUILTIN:*', 'ENUM:*'],
      ['ENUM:*', 'ENUM:*'],
    ].map((inputs) => rule('BINARY_OPERATOR', `operator:${operator}`, inputs, 'BUILTIN:*', { kind: 'binary', operator: symbol })),
  ),
  // A lambda whatever it returns (a typed `-> void` one's function is Nil).
  rule('LAMBDA', 'lambda:synchronous', ['BUILTIN:*'], 'BUILTIN:*', { kind: 'structural', construct: 'lambda' }),
  rule('LAMBDA', 'lambda:coroutine', ['BUILTIN:*'], 'BUILTIN:*', { kind: 'structural', construct: 'lambda' }),
  // An @onready member without a type or an initializer the analysis types (`@onready var skin`).
  ...[['VARIANT:*'], []].map((inputs) => annotatedRule('VARIABLE', 'variable:declared:instance', '@onready:resolved:applied:*', inputs, '', { kind: 'structural', construct: 'variable' })),
  // An exported number with its editor range (`@export_range`), which only the editor reads.
  annotatedRule('VARIABLE', 'variable:inferred:instance', '@export_range:resolved:applied:*', ['BUILTIN:*'], '', { kind: 'structural', construct: 'variable' }),
  // An object-typed place given null, a script instance, or an int given an enum.
  rule('ASSIGNMENT', 'operator:OP_NONE:25', ['NATIVE:*', 'BUILTIN:*'], 'BUILTIN:*', { kind: 'assignment', operator: '=' }),
  rule('ASSIGNMENT', 'operator:OP_NONE:25', ['NATIVE:*', 'CLASS:*'], 'NATIVE:*', { kind: 'assignment', operator: '=' }),
  rule('ASSIGNMENT', 'operator:OP_NONE:25', ['BUILTIN:*', 'ENUM:*'], 'ENUM:*', { kind: 'assignment', operator: '=' }),
  rule('AWAIT', 'await', ['VARIANT:*'], 'VARIANT:*', { kind: 'structural', construct: 'await' }),
  // An inherited engine signal named bare (`body_entered.connect(…)`), through its signal binding.
  rule('IDENTIFIER', 'member-identifier:INHERITED_VARIABLE', [], 'BUILTIN:*', { kind: 'binding' }),
  // A for over a Dictionary, its keys.
  rule('FOR', 'for-of:direct-binding', ['BUILTIN:*'], '', { kind: 'structural', construct: 'for-of' }),
  // A script enum's member read off the enum (`CameraType.MAX`) where the analyzer types it an int.
  rule('SUBSCRIPT', 'subscript-attribute', ['ENUM:meta:*'], 'BUILTIN:*', { kind: 'structural', construct: 'subscript-attribute' }),
  // An engine singleton's signal (`RenderingServer.frame_post_draw`), through its signal binding.
  rule('SUBSCRIPT', 'subscript-attribute:native-signal', ['NATIVE:meta:*'], 'BUILTIN:*', { kind: 'binding' }),
  // An engine singleton named as a value (`RenderingServer.frame_post_draw`): its binding's value.
  rule('IDENTIFIER', 'bound-identifier:NATIVE_CLASS', [], 'NATIVE:meta:*', { kind: 'structural', construct: 'bound-identifier' }),
  // `value as Enum` of an int or an enum: the value itself, an enum being its int.
  ...['BUILTIN:*', 'ENUM:*', 'VARIANT:*'].map((input) => rule('CAST', 'cast:enum', [input], 'ENUM:*', { kind: 'structural', construct: 'cast' })),
  // `await` of a value only the run time types: a Signal's next emission, a coroutine's result, or
  // the value itself (`OPCODE_AWAIT`, gdscript_vm.cpp:2563).
  rule('AWAIT', 'await', ['VARIANT:*'], '*', { kind: 'structural', construct: 'await' }),
  // A member read by name, whatever the value it holds: an untyped or script-typed member, or a
  // constant of any type (the script's own field, `this.name`).
  ...['VARIANT:*', 'SCRIPT:*'].map((result) => rule('IDENTIFIER', 'member-identifier:MEMBER_VARIABLE', [], result, { kind: 'structural', construct: 'member-identifier' })),
  ...['VARIANT:*', 'SCRIPT:*', 'CLASS:*', 'NATIVE:*'].map((result) => rule('IDENTIFIER', 'member-identifier:MEMBER_CONSTANT', [], result, { kind: 'structural', construct: 'member-identifier' })),
];

export const GODOT_4_7_VARIANT_CONTAINER_DATATYPES: readonly GodotDatatypeRuleEntry[] = [
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    // A copy-on-write value: compat's `packed-string-array.ts` holds it as a frozen string array,
    // and a store writes a new array back (`with_indexed`), so the type stays read-only.
    sourceDatatype: 'BUILTIN:PackedStringArray',
    targetType: { kind: 'type-reference', name: 'ReadonlyArray', arguments: [{ kind: 'keyword-type', keyword: 'string' }] },
  },
  {
    sourceRevision: GODOT_4_7_CODE_SEED_SOURCE_REVISION,
    // A Callable is the function it calls (`callable.ts`: `call`, `bind`, a signal's `connect`),
    // taking whatever it is called with.
    sourceDatatype: 'BUILTIN:Callable',
    targetType: { kind: 'function-type', parameters: [{ name: 'args', type: { kind: 'array-type', element: { kind: 'keyword-type', keyword: 'never' } }, rest: true }], result: { kind: 'keyword-type', keyword: 'unknown' } },
  },
];
