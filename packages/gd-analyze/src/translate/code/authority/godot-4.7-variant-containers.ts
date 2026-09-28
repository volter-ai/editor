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
