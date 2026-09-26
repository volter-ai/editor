import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../../godot-frontend/semantic-claims';

export const GODOT_FIELD_VALUE_AUTHORITY_VERSION = 1 as const;

export type SerializedPrimitiveIdentity = 'bool' | 'number:float' | 'number:int' | 'string';

export type TargetPrimitiveKind = 'boolean' | 'number' | 'string';

export interface GodotFieldValueRule {
  readonly sourceRevision: string;
  readonly fieldDatatype: string;
  readonly serializedValue: SerializedPrimitiveIdentity;
  readonly targetKind: TargetPrimitiveKind;
  readonly evidenceClaimId: string;
}

export interface GodotFieldValueClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

export interface GodotFieldValueAuthority {
  readonly version: typeof GODOT_FIELD_VALUE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotFieldValueRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotFieldValueClaimLiveness[];
}

export function godotFieldValueRuleKey(
  sourceRevision: string,
  fieldDatatype: string,
  serializedValue: SerializedPrimitiveIdentity,
): string {
  return [sourceRevision, 'script-field-value', fieldDatatype, serializedValue].join('\0');
}

/** Immutable, exact-evidence lookup for serialized ScriptInstance field values. */
export class GodotFieldValueAuthorityResolver {
  readonly registryDigest: string;
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotFieldValueRule>;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, SemanticClaimLiveness>;

  constructor(authority: GodotFieldValueAuthority) {
    if (authority.version !== GODOT_FIELD_VALUE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot field-value authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    this.#registry = new SemanticClaimRegistry(authority.claims);
    this.registryDigest = this.#registry.digest;
    const liveness = new Map<string, SemanticClaimLiveness>();
    for (const entry of authority.liveness) {
      if (liveness.has(entry.claimId)) {
        throw new Error(`duplicate Godot field-value liveness: ${entry.claimId}`);
      }
      if (
        entry.sourceRevision !== authority.sourceRevision ||
        entry.apiDumpSha256 !== authority.apiDumpSha256
      ) {
        throw new Error(`Godot field-value liveness has a different source: ${entry.claimId}`);
      }
      liveness.set(entry.claimId, entry);
    }
    const rules = new Map<string, GodotFieldValueRule>();
    for (const rule of authority.rules) {
      if (rule.sourceRevision !== authority.sourceRevision) {
        throw new Error(`Godot field-value rule has a different source: ${rule.evidenceClaimId}`);
      }
      const key = godotFieldValueRuleKey(
        rule.sourceRevision,
        rule.fieldDatatype,
        rule.serializedValue,
      );
      if (rules.has(key)) throw new Error(`duplicate Godot field-value rule: ${key}`);
      rules.set(key, rule);
    }
    this.#liveness = liveness;
    this.#rules = rules;
  }

  rule(
    fieldDatatype: string,
    serializedValue: SerializedPrimitiveIdentity,
  ): GodotFieldValueRule | undefined {
    const rule = this.#rules.get(
      godotFieldValueRuleKey(this.sourceRevision, fieldDatatype, serializedValue),
    );
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot field-value claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    const identity = godotFieldValueRuleKey(
      rule.sourceRevision,
      rule.fieldDatatype,
      rule.serializedValue,
    );
    if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== identity) {
      throw new Error(`Godot field-value claim does not prove its rule: ${rule.evidenceClaimId}`);
    }
    return rule;
  }
}
