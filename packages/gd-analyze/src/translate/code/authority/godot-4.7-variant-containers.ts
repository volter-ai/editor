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
];
