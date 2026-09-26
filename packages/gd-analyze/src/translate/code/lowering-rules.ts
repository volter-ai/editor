import type { GodotBoundDatatype, GodotBoundNode } from '../../godot-frontend/bound-program';
import type {
  TargetTsAssignmentOperator,
  TargetTsBinaryOperator,
  TargetTsType,
  TargetTsUnaryOperator,
} from './target-ts-syntax';

export const GODOT_CODE_RULE_TABLE_VERSION = 1 as const;

/**
 * Exact official-bound meaning at one lowering site. The datatype strings are the official
 * frontend's selected, recursive identities rather than names inferred by this compiler.
 */
export interface GodotCodeRuleIdentity {
  readonly sourceRevision: string;
  readonly nodeKind: GodotBoundNode['kind'];
  readonly semanticKey: string;
  readonly inputDatatypes: readonly string[];
  readonly resultDatatype: string;
}

/**
 * Closed direct-JavaScript-equivalence recipes. A recipe is data, never executable lowering or
 * emitted source. Constructs without a live evidenced recipe refuse at their official span.
 */
export type GodotCodeRuleRecipe =
  | { readonly kind: 'structural'; readonly construct: GodotStructuralConstruct }
  | { readonly kind: 'unary'; readonly operator: TargetTsUnaryOperator }
  | { readonly kind: 'binary'; readonly operator: TargetTsBinaryOperator }
  | { readonly kind: 'assignment'; readonly operator: TargetTsAssignmentOperator }
  /** The operation lowers through the binding table (`builtin-operator`, `builtin-constant`). */
  | { readonly kind: 'binding' }
  /** GDScript int `*`, `%` and truncating `/` on JS numbers, with -0 normalized to 0. */
  | { readonly kind: 'integer-binary'; readonly operator: '*' | '%' | '/' }
  /** GDScript int negation: `0 - x`, which never yields -0. */
  | { readonly kind: 'integer-negate' }
  | { readonly kind: 'refusal'; readonly reason: string };

export type GodotStructuralConstruct =
  | 'annotation-elision'
  | 'array-literal'
  | 'autoload-identifier'
  | 'await'
  | 'bound-identifier'
  | 'break'
  | 'call'
  | 'cast'
  | 'class'
  | 'constant'
  | 'continue'
  | 'dictionary-object-literal'
  | 'enum'
  | 'for-of'
  | 'for-range'
  | 'function'
  | 'get-node'
  | 'if'
  | 'implicit-ready'
  | 'lambda'
  | 'literal'
  | 'local-identifier'
  | 'member-identifier'
  | 'parameter'
  | 'pass'
  | 'return'
  | 'self'
  | 'singleton'
  | 'subscript-attribute'
  | 'subscript-element'
  | 'suite'
  | 'ternary'
  | 'type-default'
  | 'type-test'
  | 'variable'
  | 'while';

export interface GodotCodeRuleEntry {
  readonly source: GodotCodeRuleIdentity;
  readonly target: GodotCodeRuleRecipe;
  readonly evidenceClaimId: string;
}

export interface GodotDatatypeRuleEntry {
  readonly sourceRevision: string;
  /** An exact datatype identity, or a type key `BUILTIN:Vector3` (see godotDatatypeTypeKey). */
  readonly sourceDatatype: string;
  readonly targetType: TargetTsType;
  /** The compat module (relative to the project's `src/`) that exports the named target type. */
  readonly typeImport?: { readonly module: string; readonly exportName: string };
  readonly evidenceClaimId: string;
}

export interface GodotCodeRuleTable {
  readonly version: typeof GODOT_CODE_RULE_TABLE_VERSION;
  readonly sourceRevision: string;
  readonly entries: readonly GodotCodeRuleEntry[];
  readonly datatypes: readonly GodotDatatypeRuleEntry[];
}

export function godotBoundDatatypeIdentity(datatype: GodotBoundDatatype): string {
  const containers = datatype.containerTypes.map(godotBoundDatatypeIdentity).join(',');
  return [
    datatype.kind,
    datatype.typeSource,
    datatype.display,
    datatype.builtinType,
    datatype.nativeType,
    datatype.enumType,
    datatype.scriptPath,
    datatype.className,
    datatype.constant ? 'constant' : 'mutable',
    datatype.readOnly ? 'readonly' : 'writable',
    datatype.metaType ? 'meta' : 'instance',
    datatype.pseudoType ? 'pseudo' : 'concrete',
    datatype.coroutine ? 'coroutine' : 'sync',
    `[${containers}]`,
  ].join('|');
}

const GENERALIZED_KINDS = new Set(['BUILTIN', 'NATIVE', 'SCRIPT', 'CLASS', 'ENUM', 'VARIANT']);

function datatypeFields(identity: string): readonly string[] {
  return identity.split('|');
}

/**
 * The TYPE of a datatype identity, dropping how the frontend learned it and whether the value is a
 * constant: `BUILTIN:float`, `BUILTIN:Array[RID]`, `NATIVE:Node`, `ENUM:Player._Anim`,
 * `CLASS:res://player/player.gd`; a meta-type (the type used as a value) gains `:meta`. A rule
 * keyed by types holds for every datatype of those types, so it is registered for constructs whose
 * meaning depends on the type but not on its provenance or constness (int arithmetic).
 */
export function godotDatatypeType(identity: string): string {
  if (identity === '') return identity;
  const fields = datatypeFields(identity);
  const kind = fields[0] as string;
  if (!GENERALIZED_KINDS.has(kind)) return identity;
  const meta = fields[10] === 'meta' ? ':meta' : '';
  switch (kind) {
    case 'NATIVE':
      return `NATIVE:${fields[4] as string}${meta}`;
    case 'CLASS':
    case 'SCRIPT':
      return `${kind}:${fields[6] as string}${meta}`;
    default:
      return `${kind}:${fields[2] as string}${meta}`;
  }
}

/**
 * The CLASS of a datatype identity (`BUILTIN:*`, `NATIVE:*`, `ENUM:*`, and `BUILTIN:meta:*` for a
 * meta-type), or the identity itself when it has none. A rule keyed by classes holds for every
 * datatype of the class: it is registered only for constructs whose meaning does not depend on the
 * type under the compat representation (a built-in is an immutable record, an object, Array or
 * Dictionary a shared reference).
 */
export function godotDatatypeClass(identity: string): string {
  if (identity === '') return identity;
  const fields = datatypeFields(identity);
  const kind = fields[0] as string;
  if (!GENERALIZED_KINDS.has(kind)) return identity;
  return fields[10] === 'meta' ? `${kind}:meta:*` : `${kind}:*`;
}

/**
 * ANY value (`*`): a rule keyed by `*` holds for a value of every datatype, so it is registered only
 * for constructs that pass a value through unchanged whatever it is (a call's arguments and
 * result). A meta-type keeps its class key.
 */
export function godotDatatypeAny(identity: string): string {
  const cls = godotDatatypeClass(identity);
  return cls.endsWith(':*') && !cls.includes(':meta:') ? '*' : cls;
}

/** The type key a datatype rule may be registered under: `BUILTIN:Vector3`, `NATIVE:Node3D`. */
export function godotDatatypeTypeKey(datatype: GodotBoundDatatype): string | undefined {
  const type = godotDatatypeType(godotBoundDatatypeIdentity(datatype));
  return type.includes('|') ? undefined : type;
}

export function godotCodeRuleKey(identity: GodotCodeRuleIdentity): string {
  return [
    identity.sourceRevision,
    identity.nodeKind,
    identity.semanticKey,
    identity.inputDatatypes.join('\u001f'),
    identity.resultDatatype,
  ].join('\0');
}

export function godotDatatypeRuleKey(entry: GodotDatatypeRuleEntry): string {
  return [entry.sourceRevision, 'datatype', entry.sourceDatatype].join('\0');
}

export class GodotCodeRuleResolver {
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotCodeRuleEntry>;
  readonly #datatypes: ReadonlyMap<string, GodotDatatypeRuleEntry>;

  constructor(table: GodotCodeRuleTable) {
    if (table.version !== GODOT_CODE_RULE_TABLE_VERSION) {
      throw new Error(`unsupported Godot code rule table version: ${String(table.version)}`);
    }
    this.sourceRevision = table.sourceRevision;
    const rules = new Map<string, GodotCodeRuleEntry>();
    for (const entry of table.entries) {
      if (entry.source.sourceRevision !== table.sourceRevision) {
        throw new Error(`Godot code rule source revision mismatch: ${entry.source.sourceRevision}`);
      }
      const key = godotCodeRuleKey(entry.source);
      if (rules.has(key)) throw new Error(`duplicate Godot code rule for ${key}`);
      rules.set(key, entry);
    }
    const datatypes = new Map<string, GodotDatatypeRuleEntry>();
    for (const entry of table.datatypes) {
      if (entry.sourceRevision !== table.sourceRevision) {
        throw new Error(`Godot datatype rule source revision mismatch: ${entry.sourceRevision}`);
      }
      if (datatypes.has(entry.sourceDatatype)) {
        throw new Error(`duplicate Godot datatype rule for ${entry.sourceDatatype}`);
      }
      datatypes.set(entry.sourceDatatype, entry);
    }
    this.#rules = rules;
    this.#datatypes = datatypes;
  }

  rule(identity: GodotCodeRuleIdentity): GodotCodeRuleEntry | undefined {
    if (this.sourceRevision !== identity.sourceRevision) {
      throw new Error(
        `Godot code rule source revision mismatch: ${this.sourceRevision} != ${identity.sourceRevision}`,
      );
    }
    return (
      this.#rules.get(godotCodeRuleKey(identity)) ??
      this.#rules.get(
        godotCodeRuleKey({
          ...identity,
          inputDatatypes: identity.inputDatatypes.map(godotDatatypeType),
          resultDatatype: godotDatatypeType(identity.resultDatatype),
        }),
      ) ??
      this.#rules.get(
        godotCodeRuleKey({
          ...identity,
          inputDatatypes: identity.inputDatatypes.map(godotDatatypeClass),
          resultDatatype: godotDatatypeClass(identity.resultDatatype),
        }),
      ) ??
      this.#rules.get(
        godotCodeRuleKey({
          ...identity,
          inputDatatypes: identity.inputDatatypes.map(godotDatatypeAny),
          resultDatatype: godotDatatypeAny(identity.resultDatatype),
        }),
      )
    );
  }

  datatype(datatype: GodotBoundDatatype): GodotDatatypeRuleEntry | undefined {
    const exact = this.#datatypes.get(godotBoundDatatypeIdentity(datatype));
    if (exact !== undefined) return exact;
    const identity = godotBoundDatatypeIdentity(datatype);
    return (
      this.#datatypes.get(godotDatatypeType(identity)) ??
      // A typed container (`Array[RID]`, `Dictionary[String, int]`) has its container's
      // representation whatever its element types: `BUILTIN:Array[*]`.
      (datatype.kind === 'BUILTIN' && datatype.containerTypes.length > 0
        ? this.#datatypes.get(`BUILTIN:${datatype.builtinType}[*]`)
        : undefined) ??
      this.#datatypes.get(godotDatatypeClass(identity))
    );
  }
}
