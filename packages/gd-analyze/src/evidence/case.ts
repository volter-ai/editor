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
  | 'builtin-static'
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
  | 'singleton-member'
  /**
   * A native class's static method (`PhysicsRayQueryParameters3D.create`): the API dump's method
   * identity, called with no receiver.
   */
  | 'native-static';

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
 * `physics-trajectory`: every float within 0.1 of the native one. Only for a rigid body in contact,
 * whose contact resolution is Rapier's solver rather than GodotPhysics3D's (the bounded deviation
 * rigid-body-3d.ts names), over cases of at most two seconds; never for kinematic bodies, queries
 * or a body in free flight. The claim records the measured maximum.
 * `rapier-geometry`: every float within 0.05 of the native one. Only for query and kinematic results
 * whose contact points, normals, depths and cast fractions are Rapier's queries rather than
 * GodotPhysics3D's narrow phase (the bounded deviation the compat module names), and the positions
 * and velocities that follow from them; stable facts (hit or not, floor or wall, signal sets) in
 * such a case still agree exactly as integers and booleans. The claim records the measured maximum.
 * `web-platform-fact`: the value Godot's web export gives where it differs from the native binary's
 * platform (the rendering method): the case's `fact`, cited to the web platform's code path, stands
 * in for the native run, and the target must equal it exactly.
 * `render-mapping`: a renderer setting the target maps a Godot rasterizer state to, as the case's
 * `fact` cites (the Godot kernel and the library setting chosen for it); the target must produce
 * exactly that setting. What it looks like is judged visually, not by this comparator.
 */
export type GodotEvidenceComparator =
  | 'exact'
  | 'float32-ulp'
  | 'platform-libm'
  | 'physics-trajectory'
  | 'rapier-geometry'
  | 'web-platform-fact'
  | 'render-mapping';

/** A cited value that stands in for the native run of a `web-platform-fact` or `render-mapping` case. */
export interface GodotEvidenceFact {
  readonly value: unknown;
  readonly source: { readonly file: string; readonly symbol: string; readonly line: number };
}

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
  /** For a `web-platform-fact` or `render-mapping` case, the cited value in place of a native run. */
  readonly fact?: GodotEvidenceFact;
  /** For a `rapier-geometry` case, the values its collision geometry decides beyond the 0.05 bound. */
  readonly geometryFacts?: readonly GodotEvidenceGeometryFact[];
  /**
   * For a `rapier-geometry` case, how a derived value is compared through what it derives from
   * (`get_real_velocity() / 60`, the frame's displacement, as a position); the claim records it.
   */
  readonly derivation?: string;
}

/**
 * A value in a `rapier-geometry` case that Rapier's collision geometry decides and that is not a
 * stable fact: how many contact points one collision has and where along a line contact the
 * reported one lies (GodotPhysics3D's SAT manifold against Rapier's single contact), how many
 * collisions one frame's slides meet (a graze Godot's GJK sweep misses and Rapier's query meets).
 * It may differ by at most `within`; the claim records `fact` and the measured largest difference.
 * Every other integer in the case agrees exactly and every other float within 0.05.
 */
export interface GodotEvidenceGeometryFact {
  /**
   * The value's place: indexes from the case's value down, `'*'` for any index, ending in `'x'`,
   * `'y'` or `'z'` for one component of a Vector3.
   */
  readonly at: readonly (number | '*' | 'x' | 'y' | 'z')[];
  readonly within: number;
  /** What the value is and where Godot's and Rapier's differ (`contact points: Godot 2 / Rapier 1 …`). */
  readonly fact: string;
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
  /** GDScript functions a node probe's cases call, appended to the probe script. */
  readonly probeHelpers?: string;
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
  /** The class the case runs; the file's `className` when absent. */
  readonly className?: string;
  /** A static function called on both sides; ignored for an instance case. */
  readonly call: string;
  /** Its arguments, as GDScript and as the same values in Node; none when absent. */
  readonly arguments?: {
    readonly gdscript: string;
    readonly target: () => readonly unknown[];
  };
  /**
   * An instance case: construct the class (`.new()` / `new`), run each step, and compare the list
   * of step results. A step names a method called with no arguments, or `$ready`: the native
   * `NOTIFICATION_READY`, which the target receives as its `_ready()`.
   */
  readonly instance?: {
    readonly steps: readonly string[];
    /** The native entity the generated class is constructed on (its `$native`), when it has one. */
    readonly native?: () => unknown;
    /**
     * A scene file (by name) whose root carries the class: the native side instantiates it in
     * place of `.new()`, so the instance has the scene's children; `native` builds the same tree.
     */
    readonly scene?: string;
    /**
     * The native side adds the instance to the running tree (under the root) before its steps, so
     * it is inside the tree and the viewport's world; `native` builds the target's tree and world.
     */
    readonly tree?: true;
    /**
     * Seats the constructed instance on its native tree as the composition site does (the Node
     * protocol's adoption), given the generated classes by name for scripted children.
     */
    readonly adopt?: (
      instance: object,
      native: unknown,
      classes: ReadonlyMap<string, new (native?: unknown) => object>,
    ) => void;
  };
  readonly comparator: GodotEvidenceComparator;
}

/** A datatype rule a language case file proposes. */
export interface GodotLanguageDatatypeDefinition {
  readonly id: string;
  /** A type key (`BUILTIN:float`) or class key (`NATIVE:*`). */
  readonly sourceDatatype: string;
  readonly targetType: import('../translate/code/target-ts-syntax').TargetTsType;
  readonly source: { readonly file: string; readonly symbol: string; readonly line: number };
}

export interface GodotLanguageEvidenceFile {
  readonly kind: 'language';
  /** The class static cases run on by default. */
  readonly className: string;
  /** GDScript files, by file name in the project root. */
  readonly scripts: readonly { readonly file: string; readonly className: string; readonly source: string }[];
  /**
   * Scene files, by file name. A script attached to a scene node is a native carrier: its
   * generated class holds the native entity it is attached to.
   */
  readonly scenes?: readonly { readonly file: string; readonly source: string }[];
  /** Compat modules the lowered cases import; their bytes join the implementation identity. */
  readonly compatModules: readonly string[];
  readonly rules: readonly GodotLanguageRuleDefinition[];
  readonly datatypes?: readonly GodotLanguageDatatypeDefinition[];
  readonly cases: readonly GodotLanguageCase[];
}
