import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../godot-frontend/semantic-claims';

export const GODOT_ANALYSIS_AUTHORITY_VERSION = 1 as const;

export type GodotAnalysisRuleId =
  | 'native-ancestry'
  | 'script-inheritance'
  | 'lifecycle-selection'
  | 'scene-class-resolution'
  | 'field-attachment-join';

export interface GodotAnalysisRule {
  readonly id: GodotAnalysisRuleId;
  readonly sourceRevision: string;
  readonly evidenceClaimId: string;
}

export interface GodotAnalysisClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

export interface GodotAnalysisAuthority {
  readonly version: typeof GODOT_ANALYSIS_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotAnalysisRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotAnalysisClaimLiveness[];
}

export function godotAnalysisRuleKey(sourceRevision: string, id: GodotAnalysisRuleId): string {
  return [sourceRevision, 'analyze', id].join('\0');
}

/** Exact-evidence resolver for the joins that turn frontend/read facts into one bound project. */
export class GodotAnalysisAuthorityResolver {
  readonly registryDigest: string;
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<GodotAnalysisRuleId, GodotAnalysisRule>;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, SemanticClaimLiveness>;

  constructor(authority: GodotAnalysisAuthority) {
    if (authority.version !== GODOT_ANALYSIS_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot analysis authority: ${String(authority.version)}`);
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
          throw new Error(`Godot analysis liveness has a different source: ${entry.claimId}`);
        }
        return [entry.claimId, entry];
      }),
    );
    this.#rules = new Map(
      authority.rules.map((rule) => {
        if (rule.sourceRevision !== authority.sourceRevision) {
          throw new Error(`Godot analysis rule has a different source: ${rule.id}`);
        }
        return [rule.id, rule];
      }),
    );
    if (this.#rules.size !== authority.rules.length) {
      throw new Error('Godot analysis authority contains a duplicate rule');
    }
    if (this.#liveness.size !== authority.liveness.length) {
      throw new Error('Godot analysis authority contains duplicate claim liveness');
    }
  }

  require(id: GodotAnalysisRuleId): SemanticClaimRecord {
    const rule = this.#rules.get(id);
    if (rule === undefined) throw new Error(`Godot analysis authority has no ${id} rule`);
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot analysis claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (
      claim.layer !== 'analyze' ||
      claim.canonicalIdentity !== godotAnalysisRuleKey(this.sourceRevision, id)
    ) {
      throw new Error(`Godot analysis claim does not prove ${id}: ${rule.evidenceClaimId}`);
    }
    return claim;
  }
}
