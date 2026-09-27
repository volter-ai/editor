/**
 * read/godot-value.ts — the value model shared by every Godot text format.
 *
 * `project.godot`, `.tscn`, `.tres` and `.gdns` are ONE syntax with three roles: an INI-ish
 * skeleton of `[section attr=value]` headers and `key = value` bodies, where every `value` is a
 * Godot *variant literal*. That literal grammar is what lives here.
 *
 * A parsed value is INERT DATA, never a constructed object — the same call
 * `rbx-analyze/src/read/datamodel-types.ts` records for its own property values. An analyzer
 * reports which classes, nodes and resources a project references; it never evaluates a
 * `Vector2( 17, 17 )`, so decoding one into a real vector would be work with no reader. What the
 * reader keeps is the constructor's NAME and its arguments, which is exactly what a later stage
 * needs in order to decide a mapping.
 */

/** A Godot variant literal, as written in a text-format file. */
export type GodotValue =
  | { readonly kind: 'string'; readonly value: string }
  | {
      readonly kind: 'number';
      readonly value: number;
      /** Serialized Variant tag; integral float payloads remain float rather than becoming int. */
      readonly variantType?: 'int' | 'float';
    }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'null' }
  /** A bare identifier — Godot writes class names unquoted inside `Object( InputEventKey, … )`. */
  | { readonly kind: 'ident'; readonly name: string }
  | {
      readonly kind: 'array';
      readonly items: readonly GodotValue[];
      /**
       * The `T` of Godot 4's typed-array text literal `Array[T]([…])`. Absent on an untyped `[…]`,
       * which is every array Godot 3 writes and most of what Godot 4 writes.
       *
       * Typing belongs to the CONTAINER. The pinned 4.7 dump declares that as Array constructor
       * index 2 (`base: Array`, `type: int`, `class_name: StringName`, `script: Variant`) plus
       * `is_typed` — the values inside stay ordinary Variants (`indexing_return_type: Variant`,
       * dump type spelling `typedarray::T`). So this sits beside `items` rather than changing
       * what an item is, the same way `&`/`^` decode onto kinds consumers already read.
       *
       * The three spellings Godot's writer emits land on the two `GodotValue` kinds that already
       * carry them, verbatim and unresolved:
       *
       *   `Array[int]([…])`                    a built-in variant type name → `{ kind: 'ident' }`
       *   `Array[Node]([…])`                   an engine class name         → `{ kind: 'ident' }`
       *   `Array[ExtResource("2_i825w")]([…])`  the SCRIPT that types it     → `{ kind: 'ctor' }`
       *
       * Telling the first from the second needs a variant-type table and a ClassDB, and resolving
       * the third needs the document's `[ext_resource]` list — all three are `analyze/`'s job.
       * The reader's job is that the type is not silently dropped: an array whose element type
       * went missing reads as an untyped one, and nothing downstream can tell that apart from a
       * document that authored no type at all.
       */
      readonly elementType?: GodotValue;
    }
  | {
      readonly kind: 'dict';
      readonly entries: readonly GodotEntry[];
      /** The `K, V` authored by Godot 4's `Dictionary[K, V]({…})` text literal. */
      readonly keyType?: GodotValue;
      readonly valueType?: GodotValue;
    }
  /**
   * `Name( arg, arg, "key":value, … )` — the single shape behind `Vector2( … )`,
   * `ExtResource( 1 )`, `SubResource( 2 )`, `PoolStringArray( … )`, `NodePath( "…" )` and
   * `Object( InputEventKey, "scancode":32, … )`. Positional arguments land in `args`, the
   * `"key":value` pairs `Object` uses land in `fields`; no other constructor mixes them.
   */
  | {
      readonly kind: 'ctor';
      readonly name: string;
      readonly args: readonly GodotValue[];
      readonly fields: readonly GodotEntry[];
    };

export interface GodotEntry {
  /** Canonical text key used by the long-standing string-key consumers. */
  readonly key: string;
  /** Present when the document authored a non-string Variant key (for example ExtResource(…)). */
  readonly keyValue?: GodotValue;
  readonly value: GodotValue;
}

export function asString(value: GodotValue | undefined): string | undefined {
  return value?.kind === 'string' ? value.value : undefined;
}

export function asNumber(value: GodotValue | undefined): number | undefined {
  return value?.kind === 'number' ? value.value : undefined;
}

/**
 * An exact non-negative integer used by structural text-format fields.
 *
 * Godot 4 writes these as number Variants while Godot 3 may quote the same base-10 value. Keep
 * the accepted string grammar deliberately narrower than JavaScript's numeric coercion: signs,
 * whitespace, fractions, exponents, hexadecimal prefixes, and unsafe integers are malformed.
 */
export function asNonNegativeSafeInteger(value: GodotValue | undefined): number | undefined {
  const candidate = value?.kind === 'number'
    ? value.value
    : value?.kind === 'string' && /^[0-9]+$/.test(value.value)
      ? Number(value.value)
      : undefined;
  return candidate !== undefined && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

/** Every `string` item of an array/`PoolStringArray`, skipping anything that is not one. */
export function stringItems(value: GodotValue | undefined): string[] {
  if (value === undefined) return [];
  const items =
    value.kind === 'array' ? value.items : value.kind === 'ctor' ? value.args : undefined;
  if (items === undefined) return [];
  return items.flatMap((item) => (item.kind === 'string' ? [item.value] : []));
}

/**
 * The id an `[ext_resource]`/`[sub_resource]` header declares and an `ExtResource(…)`/
 * `SubResource(…)` reference cites.
 *
 * BOTH spellings, in one type and with no version branch. Godot 3 numbers them (`id=4`,
 * `ExtResource( 4 )`); Godot 4 mints an opaque per-resource token and quotes it
 * (`id="1_ybvw5"`, `ExtResource("1_ybvw5")`), including for the ones that still LOOK numeric
 * (`id="13"`, `SubResource("3")` — strings). A document uses one spelling throughout, so the
 * within-document `===` lookups every consumer does stay exact.
 *
 * The alternative — normalizing everything to `string` — was rejected: it would make one canonical
 * type, but at the price of silently redefining every `resource.id === <number>` comparison in
 * `translate/` and in the read-layer tests, and a `4` that has quietly become `"4"` is the kind of
 * change that regenerates goldens rather than announcing itself. Widening is provably INERT for
 * Godot 3 — the 3.x fixtures' regenerated ports are byte-identical — which is the property this
 * phase needs.
 */
export type ResourceId = string | number;

/** The id of an `ExtResource( n )` / `SubResource( n )` reference, or `undefined` for any other
 *  value — see {@link ResourceId} for why both a number and a string are ids. */
export function resourceRefId(value: GodotValue | undefined, ctor: string): ResourceId | undefined {
  if (value?.kind !== 'ctor' || value.name !== ctor) return undefined;
  const first = value.args[0];
  if (first?.kind === 'number' || first?.kind === 'string') return first.value;
  return undefined;
}

/** Every `ExtResource( n )` id appearing anywhere inside `value`, including nested arrays,
 *  dictionaries, constructor arguments and a typed array's ELEMENT TYPE. An `Animation`
 *  sub-resource buries stream references several levels down, so a shallow scan would
 *  under-report what a scene depends on — and a script-typed `Array[ExtResource("…")]([…])` cites
 *  its script at the type position and nowhere else, so skipping `elementType` would drop a
 *  reference the document really does make (`starter-kit-fps`'s `res://scripts/weapon.gd`). */
export function collectExtResourceIds(
  value: GodotValue,
  into: Set<ResourceId> = new Set(),
): Set<ResourceId> {
  switch (value.kind) {
    case 'array':
      if (value.elementType !== undefined) collectExtResourceIds(value.elementType, into);
      for (const item of value.items) collectExtResourceIds(item, into);
      break;
    case 'dict':
      if (value.keyType !== undefined) collectExtResourceIds(value.keyType, into);
      if (value.valueType !== undefined) collectExtResourceIds(value.valueType, into);
      for (const entry of value.entries) {
        if (entry.keyValue !== undefined) collectExtResourceIds(entry.keyValue, into);
        collectExtResourceIds(entry.value, into);
      }
      break;
    case 'ctor': {
      const id = resourceRefId(value, 'ExtResource');
      if (id !== undefined) into.add(id);
      for (const arg of value.args) collectExtResourceIds(arg, into);
      for (const field of value.fields) collectExtResourceIds(field.value, into);
      break;
    }
    default:
      break;
  }
  return into;
}
