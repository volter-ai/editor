export const GODOT_BINDING_TABLE_VERSION = 1 as const;

/** Exact source meaning already selected by the official frontend at one use site. */
export interface GodotOfficialSymbolIdentity {
  readonly sourceRevision: string;
  readonly kind:
    | 'global'
    | 'native-class'
    | 'native-member'
    | 'builtin-constructor'
    | 'builtin-member'
    /** A static method of a built-in type (`Basis.looking_at`), called without a receiver. */
    | 'builtin-static'
    /** `left <op> right` on a built-in left operand: owner is the left type, member the
     *  `Variant::Operator` name, signature `right:<type>` or `unary`. */
    | 'builtin-operator'
    /** A built-in type's constant (`Vector3.UP`); signature `constant`. */
    | 'builtin-constant'
    /** A write to a built-in value's member (`v.x = e`), lowered as `v = with_x(v, e)`;
     *  signature `set`. */
    | 'builtin-member-set'
    /** A store into an element of a built-in value Godot copies (`a[i] = e` on a
     *  PackedStringArray), lowered as `a = with_indexed(a, i, e)`; member `set_indexed`
     *  (`Variant::set_indexed`), signature `set`. */
    | 'builtin-indexed-set'
    /** An engine signal read as a value (`player.finished`): owner the declaring class, member the
     *  signal, signature `signal`; called with the object's native entity. */
    | 'native-signal';
  readonly owner: string;
  readonly member: string;
  readonly signature: string;
}

export type GodotTargetBindingUse =
  | { readonly kind: 'value' }
  | {
      readonly kind: 'call';
      readonly sourceReceiver: 'absent' | 'first-argument' | 'evaluate-before-call';
    }
  | { readonly kind: 'construct' };

export type GodotTargetBinding =
  | {
      readonly kind: 'native-binding';
      readonly module: string;
      readonly exportName: string;
      readonly localName: string;
      readonly use: GodotTargetBindingUse;
    }
  | {
      readonly kind: 'compat-binding';
      readonly capabilityId: 'godot-compat';
      readonly module: string;
      readonly exportName: string;
      readonly localName: string;
      readonly use: GodotTargetBindingUse;
    }
  | {
      readonly kind: 'refusal-binding';
      readonly reason: string;
    };

/**
 * `Variant::Operator` by value (`core/variant/variant.h:566`), the operator identity the official
 * frontend records as `variantOperatorId`.
 */
export const GODOT_VARIANT_OPERATOR_NAMES = [
  'OP_EQUAL',
  'OP_NOT_EQUAL',
  'OP_LESS',
  'OP_LESS_EQUAL',
  'OP_GREATER',
  'OP_GREATER_EQUAL',
  'OP_ADD',
  'OP_SUBTRACT',
  'OP_MULTIPLY',
  'OP_DIVIDE',
  'OP_NEGATE',
  'OP_POSITIVE',
  'OP_MODULE',
  'OP_POWER',
  'OP_SHIFT_LEFT',
  'OP_SHIFT_RIGHT',
  'OP_BIT_AND',
  'OP_BIT_OR',
  'OP_BIT_XOR',
  'OP_BIT_NEGATE',
  'OP_AND',
  'OP_OR',
  'OP_XOR',
  'OP_NOT',
  'OP_IN',
] as const;

export interface GodotBindingEntry {
  readonly source: GodotOfficialSymbolIdentity;
  readonly target: GodotTargetBinding;
}

export interface GodotBindingTable {
  readonly version: typeof GODOT_BINDING_TABLE_VERSION;
  readonly sourceRevision: string;
  readonly entries: readonly GodotBindingEntry[];
}

export function godotOfficialSymbolKey(symbol: GodotOfficialSymbolIdentity): string {
  return [symbol.sourceRevision, symbol.kind, symbol.owner, symbol.member, symbol.signature].join(
    '\0',
  );
}

/** Pure lookup only; source overload/member selection has already happened in the frontend. */
export class GodotBindingResolver {
  readonly sourceRevision: string;
  readonly #entries: ReadonlyMap<string, GodotTargetBinding>;
  readonly #targetLocalNames: readonly string[];

  constructor(table: GodotBindingTable) {
    if (table.version !== GODOT_BINDING_TABLE_VERSION) {
      throw new Error(`unsupported Godot binding table version: ${String(table.version)}`);
    }
    this.sourceRevision = table.sourceRevision;
    const entries = new Map<string, GodotTargetBinding>();
    for (const entry of table.entries) {
      if (entry.source.sourceRevision !== table.sourceRevision) {
        throw new Error(
          `Godot target binding source revision mismatch: ${entry.source.sourceRevision}`,
        );
      }
      const key = godotOfficialSymbolKey(entry.source);
      if (entries.has(key)) throw new Error(`duplicate Godot target binding for ${key}`);
      entries.set(key, entry.target);
    }
    this.#entries = entries;
    const targetLocalNames = new Set<string>();
    for (const target of entries.values()) {
      if (target.kind !== 'refusal-binding') targetLocalNames.add(target.localName);
    }
    this.#targetLocalNames = [...targetLocalNames].sort();
  }

  targetLocalNames(): readonly string[] {
    return this.#targetLocalNames;
  }

  /** The target a lowered call's local name belongs to, when it is a binding's. */
  targetByLocalName(localName: string): GodotTargetBinding | undefined {
    for (const target of this.#entries.values()) if (target.kind !== 'refusal-binding' && target.localName === localName) return target;
    return undefined;
  }

  resolve(symbol: GodotOfficialSymbolIdentity): GodotTargetBinding {
    if (this.sourceRevision !== symbol.sourceRevision) {
      throw new Error(
        `Godot binding source revision mismatch: ${this.sourceRevision} != ${symbol.sourceRevision}`,
      );
    }
    return (
      this.#entries.get(godotOfficialSymbolKey(symbol)) ?? {
        kind: 'refusal-binding',
        reason: `no target binding for ${symbol.owner}.${symbol.member} ${symbol.signature}`,
      }
    );
  }
}
