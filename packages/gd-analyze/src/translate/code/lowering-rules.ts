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
  | { readonly kind: 'refusal'; readonly reason: string };

export type GodotStructuralConstruct =
  | 'annotation-elision'
  | 'array-literal'
  | 'autoload-identifier'
  | 'await'
  | 'bound-identifier'
  | 'break'
  | 'call'
  | 'class'
  | 'constant'
  | 'continue'
  | 'dictionary-object-literal'
  | 'enum'
  | 'for-of'
  | 'function'
  | 'if'
  | 'lambda'
  | 'literal'
  | 'local-identifier'
  | 'member-identifier'
  | 'parameter'
  | 'pass'
  | 'return'
  | 'self'
  | 'subscript-attribute'
  | 'subscript-element'
  | 'suite'
  | 'ternary'
  | 'variable'
  | 'while';

export interface GodotCodeRuleEntry {
  readonly source: GodotCodeRuleIdentity;
  readonly target: GodotCodeRuleRecipe;
  readonly evidenceClaimId: string;
}

export interface GodotDatatypeRuleEntry {
  readonly sourceRevision: string;
  readonly sourceDatatype: string;
  readonly targetType: TargetTsType;
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
    return this.#rules.get(godotCodeRuleKey(identity));
  }

  datatype(datatype: GodotBoundDatatype): GodotDatatypeRuleEntry | undefined {
    return this.#datatypes.get(godotBoundDatatypeIdentity(datatype));
  }
}
