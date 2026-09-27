export const GODOT_FIELD_VALUE_AUTHORITY_VERSION = 1 as const;

/** A serialized field value's kind; `node-path` is a property the scene stores as a NodePath (`node_paths`). */
export type SerializedPrimitiveIdentity = 'bool' | 'number:float' | 'number:int' | 'string' | 'node-path';

/** What the target sets: a primitive, or (`node-reference`) the node at the path once the scene exists. */
export type TargetPrimitiveKind = 'boolean' | 'number' | 'string' | 'node-reference';

export interface GodotFieldValueRule {
  readonly sourceRevision: string;
  readonly fieldDatatype: string;
  readonly serializedValue: SerializedPrimitiveIdentity;
  readonly targetKind: TargetPrimitiveKind;
}

export interface GodotFieldValueAuthority {
  readonly version: typeof GODOT_FIELD_VALUE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotFieldValueRule[];
}

function godotFieldValueRuleKey(
  sourceRevision: string,
  fieldDatatype: string,
  serializedValue: SerializedPrimitiveIdentity,
): string {
  return [sourceRevision, 'script-field-value', fieldDatatype, serializedValue].join('\0');
}

/** Immutable lookup for serialized ScriptInstance field values. */
export class GodotFieldValueAuthorityResolver {
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotFieldValueRule>;

  constructor(authority: GodotFieldValueAuthority) {
    if (authority.version !== GODOT_FIELD_VALUE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot field-value authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    const rules = new Map<string, GodotFieldValueRule>();
    for (const rule of authority.rules) {
      const key = godotFieldValueRuleKey(
        rule.sourceRevision,
        rule.fieldDatatype,
        rule.serializedValue,
      );
      if (rule.sourceRevision !== authority.sourceRevision) {
        throw new Error(`Godot field-value rule has a different source: ${key}`);
      }
      if (rules.has(key)) throw new Error(`duplicate Godot field-value rule: ${key}`);
      rules.set(key, rule);
    }
    this.#rules = rules;
  }

  /** The rule for the exact datatype, else for its class (`NATIVE:*`), when one is keyed by class. */
  rule(
    fieldDatatype: string,
    serializedValue: SerializedPrimitiveIdentity,
    datatypeClass?: string,
  ): GodotFieldValueRule | undefined {
    return (
      this.#rules.get(godotFieldValueRuleKey(this.sourceRevision, fieldDatatype, serializedValue)) ??
      (datatypeClass === undefined ? undefined : this.#rules.get(godotFieldValueRuleKey(this.sourceRevision, datatypeClass, serializedValue)))
    );
  }
}
