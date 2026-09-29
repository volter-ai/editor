/**
 * Godot members and built-in types whose lowering takes a shape of its own beyond a bound call
 * (docs/GODOT.md §The lane's law, row 3): the plan-time table lowering reads, by the member's Godot
 * identity or the value's datatype, so lowering itself never compares a class or type name.
 */
import type { GodotBoundDatatype } from '../../godot-frontend/bound-program';

/** How a call to a Godot method is lowered, beyond its binding. */
export type GodotCallShape =
  /**
   * `tween_property(object, "property", …)`: the object is its native entity and the property's
   * getter and setter bindings follow the call's own arguments (tween.cpp:104).
   */
  | 'tweened-property'
  /**
   * `has_method(name)`: compat answers from the script chain, so the name must be a literal that no
   * engine class declares (object.cpp:1601).
   */
  | 'script-chain-method'
  /**
   * A tween or timer made by a script (`create_tween`, `get_tree().create_timer`): owned by the
   * script that makes it, whose component steps it, so the call hands its creator (`this`) to the
   * binding right after the receiver (docs/GODOT.md §The emitted game's shape, step 6).
   */
  | 'creator-owned'
  /**
   * `ResourceLoader.load(path)` / `ResourceSaver.save(resource, path)`: a project resource the
   * translation builds, or one the page's storage keeps, the project's script resource classes
   * handed by their scripts' paths (`resource-loader.ts`).
   */
  | 'resource-load'
  | 'resource-save';

const CALL_SHAPES: Readonly<Record<string, GodotCallShape>> = {
  'ResourceLoader.load': 'resource-load',
  'ResourceSaver.save': 'resource-save',
  'Tween.tween_property': 'tweened-property',
  'Object.has_method': 'script-chain-method',
  'Node.create_tween': 'creator-owned',
  'SceneTree.create_tween': 'creator-owned',
  'SceneTree.create_timer': 'creator-owned',
};

/** The call shape of the Godot method `owner.member`, if it has one. */
export function godotCallShape(owner: string, member: string): GodotCallShape | undefined {
  return CALL_SHAPES[`${owner}.${member}`];
}

/**
 * The native classes a subscript reads its parameters from (`tree[&"parameters/…"]`, which
 * `AnimationTree::_set`/`_get` answers, animation_tree.cpp:1057).
 */
const PARAMETER_SUBSCRIPTS: ReadonlySet<string> = new Set(['AnimationTree']);

/** Whether a subscript on a value of the native class `className` reads a tree parameter. */
export function godotSubscriptsParameters(className: string): boolean {
  return PARAMETER_SUBSCRIPTS.has(className);
}

/**
 * How a subscript on a value of a built-in type is lowered, by the built-in type (the value's
 * datatype as analysis gives it), so lowering selects the shape without naming the type.
 */
export type GodotBuiltinSubscriptShape =
  /**
   * An Array or PackedStringArray, which compat holds as a JS array: `a[i]` is Variant indexing
   * (`VariantIndexedSetGet`, core/variant/variant_setget.cpp), a negative index counting from the
   * end as `Array.prototype.at` does.
   */
  | { readonly kind: 'array-element' }
  /**
   * A Dictionary: `d[k]` (and `d.key` where analysis fixed the key's type) is keyed Variant access
   * (`Variant::get` / `Variant::set`, variant_setget.cpp), through the built-in's own getter and
   * setter methods.
   */
  | { readonly kind: 'keyed-entry'; readonly owner: string; readonly getter: 'get'; readonly setter: 'set' }
  /**
   * A numeric struct or Basis: a constant in-range integer index reads the member at that place
   * (`VariantIndexedSetGet_*`, variant_setget.cpp:847-857; Basis's columns, `get_column`).
   */
  | { readonly kind: 'indexed-member'; readonly members: readonly string[] };

const ARRAY_ELEMENT: GodotBuiltinSubscriptShape = { kind: 'array-element' };

const BUILTIN_SUBSCRIPT_SHAPES: Readonly<Record<string, GodotBuiltinSubscriptShape>> = {
  Array: ARRAY_ELEMENT,
  PackedStringArray: ARRAY_ELEMENT,
  Dictionary: { kind: 'keyed-entry', owner: 'Dictionary', getter: 'get', setter: 'set' },
  Vector2: { kind: 'indexed-member', members: ['x', 'y'] },
  Vector2i: { kind: 'indexed-member', members: ['x', 'y'] },
  Vector3: { kind: 'indexed-member', members: ['x', 'y', 'z'] },
  Vector3i: { kind: 'indexed-member', members: ['x', 'y', 'z'] },
  Quaternion: { kind: 'indexed-member', members: ['x', 'y', 'z', 'w'] },
  Color: { kind: 'indexed-member', members: ['r', 'g', 'b', 'a'] },
  Basis: { kind: 'indexed-member', members: ['x', 'y', 'z'] },
};

/** The subscript shape of a value of this datatype: a built-in value's, by its type. */
export function godotBuiltinSubscriptShape(datatype: GodotBoundDatatype): GodotBuiltinSubscriptShape | undefined {
  if (datatype.kind !== 'BUILTIN' || datatype.metaType) return undefined;
  return BUILTIN_SUBSCRIPT_SHAPES[datatype.builtinType];
}

/** The built-in types Godot holds by shared reference; every other built-in value is copied. */
const SHARED_BUILTINS: ReadonlySet<string> = new Set(['Array', 'Dictionary']);

/** Whether a value of this datatype is a built-in Godot copies (not Array or Dictionary). */
export function godotBuiltinCopied(datatype: GodotBoundDatatype): boolean {
  return datatype.kind === 'BUILTIN' && !datatype.metaType && !SHARED_BUILTINS.has(datatype.builtinType);
}

/**
 * What a built-in type's values do where lowering's shape depends on the type itself, by the
 * built-in type (the value's datatype as analysis gives it). A type absent from the table takes
 * none of these shapes and is stated as its TS type.
 */
interface GodotBuiltinShape {
  /** `await` on the value awaits a Signal's next emission (`OPCODE_AWAIT`, gdscript_vm.cpp:2563), as a promise. */
  readonly awaits?: true;
  /** `for v in x` counts from 0 below x (`OPCODE_ITERATE_BEGIN_INT`, gdscript_vm.cpp). */
  readonly iteratesRange?: true;
  /**
   * False where lowering never asserts a value of the type as its TS type (Nil: its datatype rule
   * states it as `null`, the one value TS already gives it, so a cast adds nothing). An untyped
   * value is not a built-in and never reaches this table (`godotStatedValueType`).
   */
  readonly stated?: false;
  /**
   * As a function's return type, the type is `-> void`: the analyzer resolves `void` to Nil
   * (`resolve_datatype`, gdscript_analyzer.cpp:680), so the function returns nothing (TS `void`),
   * where a Nil value elsewhere (`const X = null`) is `null`.
   */
  readonly returnsNothing?: true;
}

const BUILTIN_SHAPES: Readonly<Record<string, GodotBuiltinShape>> = {
  Nil: { stated: false, returnsNothing: true },
  Signal: { awaits: true },
  int: { iteratesRange: true },
};

function builtinShape(datatype: GodotBoundDatatype): GodotBuiltinShape | undefined {
  return datatype.kind === 'BUILTIN' ? BUILTIN_SHAPES[datatype.builtinType] : undefined;
}

/** Whether `await` on a value of this datatype awaits a Signal's next emission, as a promise. */
export function godotAwaitsEmission(datatype: GodotBoundDatatype): boolean {
  return !datatype.metaType && builtinShape(datatype)?.awaits === true;
}

/** Whether a function whose return type is this datatype returns nothing (`-> void`). */
export function godotReturnsNothing(datatype: GodotBoundDatatype): boolean {
  return !datatype.metaType && builtinShape(datatype)?.returnsNothing === true;
}

/** Whether `for v in x` over a value of this datatype counts from 0 below x. */
export function godotIteratesRange(datatype: GodotBoundDatatype): boolean {
  return builtinShape(datatype)?.iteratesRange === true;
}

/** The Variant types compat's Tween interpolates (`tween.ts`, `Animation::interpolate_variant`), by the property's API type. */
const TWEENED_TYPES: ReadonlySet<string> = new Set(['float', 'Vector2', 'Vector3', 'Color']);

/** Whether `tween_property` of a property of this API type is lowered (compat interpolates it). */
export function godotTweenInterpolates(apiType: string): boolean {
  return TWEENED_TYPES.has(apiType);
}

/**
 * The value a typed variable of this datatype holds before anything is assigned: GDScript clears a
 * built-in to its zero-argument construction (`constructed`), a few to a JS primitive, and an
 * object or untyped variable to null (`gdscript_compiler.cpp:2365`, `:2235`).
 */
export type GodotTypeDefault = { readonly kind: 'literal'; readonly value: null | boolean | number } | { readonly kind: 'constructed'; readonly builtinType: string };

const PRIMITIVE_DEFAULTS: Readonly<Record<string, null | boolean | number>> = { Nil: null, bool: false, int: 0, float: 0 };

export function godotTypeDefault(datatype: GodotBoundDatatype): GodotTypeDefault {
  if (datatype.kind === 'ENUM') return { kind: 'literal', value: 0 };
  if (datatype.kind !== 'BUILTIN' || datatype.metaType) return { kind: 'literal', value: null };
  const primitive = PRIMITIVE_DEFAULTS[datatype.builtinType];
  return primitive === undefined ? { kind: 'constructed', builtinType: datatype.builtinType } : { kind: 'literal', value: primitive };
}

/**
 * Built-in type pairs whose values are the same JS value under compat, so assigning one to a place
 * of the other converts nothing: an int into a float, and a String into a StringName or back.
 */
const SAME_COMPAT_VALUE: ReadonlySet<string> = new Set(['int>float', 'String>StringName', 'StringName>String']);

/** Whether a typed place of built-in type `to` converts a value of datatype `from` as it is bound. */
export function godotBuiltinConverts(from: GodotBoundDatatype, to: GodotBoundDatatype): boolean {
  if (to.kind !== 'BUILTIN' || to.metaType) return false;
  const fromType = from.kind === 'ENUM' ? 'int' : from.kind === 'BUILTIN' ? from.builtinType : undefined;
  return fromType !== to.builtinType && !SAME_COMPAT_VALUE.has(`${String(fromType)}>${to.builtinType}`);
}

/**
 * How compat holds an int-or-float variable's value (`numeric-variant`), per numeric built-in type:
 * the helper that tags a plain value of the type, and the one that reads a tagged value into a
 * place of the type (an int place truncates, `Variant::operator int64_t`; a float place takes
 * either as its value).
 */
export interface GodotNumericTag {
  readonly tag: string;
  readonly read: string;
}

const NUMERIC_TAGS: ReadonlyMap<string, GodotNumericTag> = new Map([
  ['int', { tag: 'godot_numeric_int', read: 'godot_numeric_to_int' }],
  ['float', { tag: 'godot_numeric_float', read: 'godot_numeric_value' }],
]);

/** The built-in types an int-or-float value can hold, in the order a switch over its tag branches. */
export const GODOT_NUMERIC_TYPES: readonly string[] = [...NUMERIC_TAGS.keys()];

/** The tag of a numeric built-in type, or undefined for any other type. */
export function godotNumericTag(type: string | undefined): GodotNumericTag | undefined {
  return type === undefined ? undefined : NUMERIC_TAGS.get(type);
}

/** Numeric stores that keep the value as it is into a place of a wider type: an int into a float. */
const NUMERIC_WIDENING: ReadonlySet<string> = new Set(['int>float']);

/** Whether a numeric result of type `from` is a place of type `to`'s value as it is. */
export function godotNumericStoresAs(from: string | undefined, to: string | undefined): boolean {
  return from === to || NUMERIC_WIDENING.has(`${String(from)}>${String(to)}`);
}

/** Whether lowering asserts a value of this datatype as its TS type: an object, or a built-in the table does not mark unstated. */
export function godotStatedValueType(datatype: GodotBoundDatatype): boolean {
  return datatype.kind === 'NATIVE' || datatype.kind === 'CLASS' || (datatype.kind === 'BUILTIN' && builtinShape(datatype)?.stated !== false);
}

/**
 * How a value's truth is read where GDScript tests it (`if v:`, `while v:`, `c if v else d`, `and`,
 * `or`, `not`): `Variant::booleanize`, which is `!is_zero()` (core/variant/variant.cpp:878), by the
 * value's datatype as analysis gives it.
 */
export type GodotTruthShape =
  /** A bool is its own truth. */
  | { readonly kind: 'boolean' }
  /** An Object: live is true, null or freed false (compat's `godot_object_truthy`). */
  | { readonly kind: 'object' }
  /** An int, float or enum: `v !== 0`. */
  | { readonly kind: 'nonzero' }
  /** A String or StringName: `v !== ''` (`String()` is empty). */
  | { readonly kind: 'nonempty-text' }
  /** An Array or packed array, which compat holds as a JS array: `v.length > 0`. */
  | { readonly kind: 'nonempty-array' }
  /** A Dictionary, which compat holds as a Map: `v.size > 0`. */
  | { readonly kind: 'nonempty-map' }
  /** A vector whose zero construction has every member 0: true when any member is not 0. */
  | { readonly kind: 'nonzero-members'; readonly members: readonly string[] }
  /** An untyped value: its truth by the type it holds at run time (compat's `godot_variant_truthy`). */
  | { readonly kind: 'variant' };

const NONZERO: GodotTruthShape = { kind: 'nonzero' };
const NONEMPTY_TEXT: GodotTruthShape = { kind: 'nonempty-text' };
const NONEMPTY_ARRAY: GodotTruthShape = { kind: 'nonempty-array' };

const BUILTIN_TRUTH: Readonly<Record<string, GodotTruthShape>> = {
  bool: { kind: 'boolean' },
  int: NONZERO,
  float: NONZERO,
  String: NONEMPTY_TEXT,
  StringName: NONEMPTY_TEXT,
  Array: NONEMPTY_ARRAY,
  PackedStringArray: NONEMPTY_ARRAY,
  Dictionary: { kind: 'nonempty-map' },
  Vector2: { kind: 'nonzero-members', members: ['x', 'y'] },
  Vector2i: { kind: 'nonzero-members', members: ['x', 'y'] },
  Vector3: { kind: 'nonzero-members', members: ['x', 'y', 'z'] },
  Vector3i: { kind: 'nonzero-members', members: ['x', 'y', 'z'] },
};

/** How a value of this datatype is tested for truth, or undefined where the lane reads none. */
export function godotTruthShape(datatype: GodotBoundDatatype): GodotTruthShape | undefined {
  if (datatype.metaType) return undefined;
  switch (datatype.kind) {
    case 'NATIVE':
    case 'CLASS':
    case 'SCRIPT':
      return { kind: 'object' };
    case 'ENUM':
      return NONZERO;
    case 'VARIANT':
      return { kind: 'variant' };
    case 'BUILTIN':
      return BUILTIN_TRUTH[datatype.builtinType];
    default:
      return undefined;
  }
}

/** Opaque literals written as their text: a NodePath is its path text (`NodePath::operator String`), which `Node.get_node` walks. */
const TEXT_LITERALS: ReadonlySet<string> = new Set(['NodePath']);

export function godotLiteralIsText(type: string): boolean {
  return TEXT_LITERALS.has(type);
}

/**
 * How a value of a built-in type is recognised at run time, where an untyped value's member is
 * selected then (`variant-named.ts`): compat's predicate for the kind of JS value the type is held
 * as, and for a record its members (a Basis's are vectors: `nested`).
 */
export interface GodotBuiltinTest {
  readonly exportName: string;
  readonly members?: string;
  readonly nested?: true;
}

const PACKED_ARRAYS = ['PackedByteArray', 'PackedInt32Array', 'PackedInt64Array', 'PackedFloat32Array', 'PackedFloat64Array', 'PackedStringArray', 'PackedVector2Array', 'PackedVector3Array', 'PackedVector4Array', 'PackedColorArray'];
const record = (members: string, nested?: true): GodotBuiltinTest => ({ exportName: 'godot_variant_is_record', members, ...(nested === undefined ? {} : { nested }) });

const BUILTIN_TESTS: Readonly<Record<string, GodotBuiltinTest>> = {
  Array: { exportName: 'godot_variant_is_array' },
  ...Object.fromEntries(PACKED_ARRAYS.map((type) => [type, { exportName: 'godot_variant_is_array' }])),
  Dictionary: { exportName: 'godot_variant_is_dictionary' },
  String: { exportName: 'godot_variant_is_text' },
  StringName: { exportName: 'godot_variant_is_text' },
  NodePath: { exportName: 'godot_variant_is_text' },
  int: { exportName: 'godot_variant_is_number' },
  float: { exportName: 'godot_variant_is_number' },
  Signal: { exportName: 'godot_variant_is_signal' },
  Callable: { exportName: 'godot_variant_is_callable' },
  Vector2: record('x,y'),
  Vector2i: record('x,y'),
  Vector3: record('x,y,z'),
  Vector3i: record('x,y,z'),
  Vector4: record('x,y,z,w'),
  Vector4i: record('x,y,z,w'),
  Quaternion: record('x,y,z,w'),
  Color: record('r,g,b,a'),
  Rect2: record('position,size'),
  Rect2i: record('position,size'),
  AABB: record('position,size'),
  Plane: record('normal,d'),
  Basis: record('x,y,z', true),
  Transform2D: record('x,y,origin'),
  Transform3D: record('basis,origin'),
  Projection: record('x,y,z,w', true),
};

/** How a value of the built-in type `type` is recognised at run time, if compat can tell. */
export function godotBuiltinTest(type: string): GodotBuiltinTest | undefined {
  return Object.hasOwn(BUILTIN_TESTS, type) ? BUILTIN_TESTS[type] : undefined;
}

/** The native classes whose script instances `ResourceSaver.save` stores and `ResourceLoader.load` makes again. */
const STORED_RESOURCE_ROOTS: ReadonlySet<string> = new Set(['Resource']);

/** Whether a script rooted in the native class `className` is a resource the loader stores. */
export function godotStoredResourceRoot(className: string | undefined): boolean {
  return className !== undefined && STORED_RESOURCE_ROOTS.has(className);
}

/** GDScript's own constants (`GDScriptLanguage` `PI`, `TAU`, `INF`, `NAN`, gdscript.cpp:2169). */
const LANGUAGE_CONSTANTS: Readonly<Record<string, number>> = { PI: Math.PI, TAU: Math.PI * 2, INF: Number.POSITIVE_INFINITY, NAN: Number.NaN };

/** The value of GDScript's constant `name`, if it is one. */
export function godotLanguageConstant(name: string): number | undefined {
  return Object.hasOwn(LANGUAGE_CONSTANTS, name) ? LANGUAGE_CONSTANTS[name] : undefined;
}
