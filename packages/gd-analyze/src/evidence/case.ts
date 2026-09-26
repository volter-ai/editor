/**
 * One differential evidence case: a GDScript expression the official Godot binary evaluates and a
 * target thunk that runs the same inputs through a compat export. `gd-analyze evidence <class>`
 * runs both and compares the typed results.
 */
export type GodotEvidenceSymbolKind =
  | 'builtin-member'
  | 'builtin-constructor'
  | 'constant'
  | 'operator';

export interface GodotEvidenceSymbol {
  readonly kind: GodotEvidenceSymbolKind;
  /** The Godot class, built-in type or singleton that owns the member. */
  readonly owner: string;
  /** Godot's member name; for an operator, the `Variant::Operator` name (`OP_ADD`). */
  readonly member: string;
}

/**
 * `exact`: every float agrees bit for bit (a NaN only equals a NaN).
 * `float32-ulp`: every float is a 32-bit value within one float32 ulp of the native one.
 */
export type GodotEvidenceComparator = 'exact' | 'float32-ulp';

export interface GodotEvidenceCase {
  readonly id: string;
  readonly symbol: GodotEvidenceSymbol;
  /** One GDScript expression over literal inputs, evaluated in the official binary. */
  readonly gdscript: string;
  /** The same inputs through the compat export. */
  readonly target: () => unknown;
  readonly comparator: GodotEvidenceComparator;
}

export interface GodotEvidenceCaseFile {
  /** The Godot class the compat module transcribes (`Vector3`). */
  readonly godotClass: string;
  /** The compat module, relative to the project-source catalog's `src/` (`lib/godot-compat/vector3`). */
  readonly compatModule: string;
  readonly cases: readonly GodotEvidenceCase[];
}
