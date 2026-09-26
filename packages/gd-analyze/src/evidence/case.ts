/**
 * Differential evidence cases. A compat case is a GDScript expression the official Godot binary
 * evaluates beside a target thunk that runs the same inputs through a compat export. A language
 * case is a GDScript function the official binary runs beside the same function lowered by
 * production code lowering and executed. `gd-analyze evidence <name>` runs both and compares the
 * typed results.
 */
import type { GodotBoundNode } from '../godot-frontend/bound-program';
import type { GodotCodeRuleRecipe } from '../translate/code/lowering-rules';

export type GodotEvidenceSymbolKind =
  | 'builtin-member'
  | 'builtin-constructor'
  | 'builtin-constant'
  | 'builtin-member-set'
  | 'builtin-operator'
  /** A `@GlobalScope` utility function (`Variant::call_utility_function`); owner `@GlobalScope`. */
  | 'utility-function'
  /**
   * A native class's method (`Node3D.set_position`); owner is the class the API dump declares it
   * on, and the receiver is the call's first argument.
   */
  | 'native-member'
  /**
   * A method of an engine singleton (`Input.is_action_pressed`), bound like a native member but
   * with no receiver: lowering drops the singleton.
   */
  | 'singleton-member';

export interface GodotEvidenceSymbol {
  readonly kind: GodotEvidenceSymbolKind;
  /** The Godot class, built-in type or singleton that owns the member. */
  readonly owner: string;
  /** Godot's member name; for an operator, the `Variant::Operator` name (`OP_ADD`). */
  readonly member: string;
  /** An operator's right operand type (`Vector3`, `float`, `int`); absent for a unary one. */
  readonly right?: string;
}

/**
 * `exact`: every float agrees bit for bit (a NaN only equals a NaN).
 * `float32-ulp`: every float is a 32-bit value within one float32 ulp of the native one.
 * `platform-libm`: every float is within one float64 ulp of the native one. Only for a member
 * Godot delegates to the platform C library (`Math::sin` is `std::sin`), whose result Godot does
 * not fix across its platforms; never for anything Godot computes itself. The claim records the
 * measured maximum distance.
 */
export type GodotEvidenceComparator = 'exact' | 'float32-ulp' | 'platform-libm';

export interface GodotEvidenceCase {
  readonly id: string;
  readonly symbol: GodotEvidenceSymbol;
  /**
   * One GDScript expression over literal inputs, or a function body (several lines, ending in
   * `return`), evaluated in the official binary.
   */
  readonly gdscript: string;
  /** The same inputs through the compat export. */
  readonly target: () => unknown;
  readonly comparator: GodotEvidenceComparator;
}

export interface GodotEvidenceCaseFile {
  /**
   * `compat` (the default): each case is an expression or function body over literal values.
   * `node`: each case is a function body with `holder`, a plain `Node` inside the running
   * SceneTree, under which it builds its node tree (so global transforms resolve); the probe runs
   * on the first frame and frees `holder` after each case. Its target builds the same tree of
   * native entities. Node cases run with `--fixed-fps 60`, one physics step per main loop
   * iteration, and may `await physics_frame` / `await process_frame` to step frames.
   */
  readonly kind?: 'compat' | 'node';
  /** The Godot class the compat module transcribes (`Vector3`). */
  readonly godotClass: string;
  /** The compat module, relative to the project-source catalog's `src/` (`lib/godot-compat/vector3`). */
  readonly compatModule: string;
  /** The module's exported value type, the TS type of this class's datatype (`Vector3`). */
  readonly typeExport?: string;
  /** Where Godot declares the type (`core/variant/variant.h`, `Variant::VECTOR3`). */
  readonly typeSource?: { readonly file: string; readonly symbol: string; readonly line: number };
  readonly cases: readonly GodotEvidenceCase[];
}

/** A code rule a language case file proposes, keyed by exact datatypes or datatype classes. */
export interface GodotLanguageRuleDefinition {
  readonly id: string;
  readonly nodeKind: GodotBoundNode['kind'];
  /** The rule's semantic key including its annotation suffix (`return:value|annotations:[]`). */
  readonly semanticKey: string;
  readonly inputDatatypes: readonly string[];
  readonly resultDatatype: string;
  readonly target: GodotCodeRuleRecipe;
  /** Where the official compiler gives the construct this meaning. */
  readonly source: { readonly file: string; readonly symbol: string; readonly line: number };
}

export interface GodotLanguageCase {
  readonly id: string;
  /** A static function of `source`, called on both sides. */
  readonly call: string;
  /** Its arguments, as GDScript and as the same values in Node; none when absent. */
  readonly arguments?: {
    readonly gdscript: string;
    readonly target: () => readonly unknown[];
  };
  readonly comparator: GodotEvidenceComparator;
}

export interface GodotLanguageEvidenceFile {
  readonly kind: 'language';
  /** `class_name` of `source`. */
  readonly className: string;
  /** One GDScript file of static case functions. */
  readonly source: string;
  /** Compat modules the lowered cases import; their bytes join the implementation identity. */
  readonly compatModules: readonly string[];
  readonly rules: readonly GodotLanguageRuleDefinition[];
  readonly cases: readonly GodotLanguageCase[];
}
