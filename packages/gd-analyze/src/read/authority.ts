import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../godot-frontend/semantic-claims';

export const GODOT_READ_AUTHORITY_VERSION = 1 as const;

export type GodotReadRuleId =
  | 'project-settings'
  | 'text-resource'
  | 'obj-import-options'
  | 'cubemap-import-options';

export interface GodotReadRule {
  readonly id: GodotReadRuleId;
  readonly sourceRevision: string;
  readonly evidenceClaimId: string;
}

export interface GodotReadClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

export interface GodotReadAuthority {
  readonly version: typeof GODOT_READ_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotReadRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotReadClaimLiveness[];
}

export function godotReadRuleKey(sourceRevision: string, id: GodotReadRuleId): string {
  return [sourceRevision, 'read', id].join('\0');
}

/**
 * The only door through which serialized Godot meaning enters the reader. Merely possessing a
 * checked-in table is insufficient: each consumed rule must still match the source, native
 * executable, proof input, and exact implementation bytes that produced its observation.
 */
export class GodotReadAuthorityResolver {
  readonly registryDigest: string;
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<GodotReadRuleId, GodotReadRule>;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, SemanticClaimLiveness>;

  constructor(authority: GodotReadAuthority) {
    if (authority.version !== GODOT_READ_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot read authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    this.#registry = new SemanticClaimRegistry(authority.claims);
    this.registryDigest = this.#registry.digest;
    this.#liveness = new Map(
      authority.liveness.map((entry) => {
        if (
          entry.sourceRevision !== authority.sourceRevision ||
          entry.apiDumpSha256 !== authority.apiDumpSha256
        ) {
          throw new Error(`Godot read liveness has a different source: ${entry.claimId}`);
        }
        return [entry.claimId, entry];
      }),
    );
    this.#rules = new Map(
      authority.rules.map((rule) => {
        if (rule.sourceRevision !== authority.sourceRevision) {
          throw new Error(`Godot read rule has a different source: ${rule.id}`);
        }
        return [rule.id, rule];
      }),
    );
    if (this.#rules.size !== authority.rules.length) {
      throw new Error('Godot read authority contains a duplicate rule');
    }
    if (this.#liveness.size !== authority.liveness.length) {
      throw new Error('Godot read authority contains duplicate claim liveness');
    }
  }

  require(id: GodotReadRuleId): SemanticClaimRecord {
    const rule = this.#rules.get(id);
    if (rule === undefined) throw new Error(`Godot read authority has no ${id} rule`);
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot read claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (
      claim.layer !== 'read' ||
      claim.canonicalIdentity !== godotReadRuleKey(this.sourceRevision, id)
    ) {
      throw new Error(`Godot read claim does not prove ${id}: ${rule.evidenceClaimId}`);
    }
    return claim;
  }
}
