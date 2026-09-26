import {
  type SemanticClaimLayer,
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../../godot-frontend/semantic-claims';
import { GodotBindingResolver, type GodotBindingTable } from './bindings';
import { GodotCodeRuleResolver, type GodotCodeRuleTable } from './lowering-rules';

export const GODOT_CODE_TRANSLATION_AUTHORITY_VERSION = 1 as const;

export interface GodotCodeClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

/** One immutable authority for every semantic decision direct code lowering may consume. */
export interface GodotCodeTranslationAuthority {
  readonly version: typeof GODOT_CODE_TRANSLATION_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly bindings: GodotBindingTable;
  readonly rules: GodotCodeRuleTable;
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotCodeClaimLiveness[];
}

export class GodotCodeEvidenceResolver {
  readonly registryDigest: string;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, SemanticClaimLiveness>;
  readonly #sourceRevision: string;
  readonly #apiDumpSha256: string;

  constructor(authority: GodotCodeTranslationAuthority) {
    if (authority.version !== GODOT_CODE_TRANSLATION_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot code authority version: ${String(authority.version)}`);
    }
    const liveness = new Map<string, SemanticClaimLiveness>();
    for (const entry of authority.liveness) {
      if (liveness.has(entry.claimId)) {
        throw new Error(`duplicate semantic-claim liveness: ${entry.claimId}`);
      }
      if (
        entry.sourceRevision !== authority.sourceRevision ||
        entry.apiDumpSha256 !== authority.apiDumpSha256
      ) {
        throw new Error(
          `semantic-claim liveness has a different source authority: ${entry.claimId}`,
        );
      }
      liveness.set(entry.claimId, entry);
    }
    this.#registry = new SemanticClaimRegistry(authority.claims);
    this.registryDigest = this.#registry.digest;
    this.#liveness = liveness;
    this.#sourceRevision = authority.sourceRevision;
    this.#apiDumpSha256 = authority.apiDumpSha256;
  }

  claim(id: string, layer: SemanticClaimLayer, canonicalIdentity: string): SemanticClaimRecord {
    const liveness = this.#liveness.get(id);
    if (liveness === undefined) throw new Error(`semantic claim has no liveness record: ${id}`);
    const claim = this.#registry.claim(id, liveness);
    if (
      claim.layer !== layer ||
      claim.canonicalIdentity !== canonicalIdentity ||
      claim.godot.sourceRevision !== this.#sourceRevision ||
      claim.godot.apiDumpSha256 !== this.#apiDumpSha256
    ) {
      throw new Error(`semantic claim does not prove ${layer}:${canonicalIdentity}: ${id}`);
    }
    return claim;
  }
}

/** Resolved lookup surfaces plus the evidence authority that makes their accepted rows usable. */
export class GodotCodeTranslationAuthorityResolver {
  readonly bindings: GodotBindingResolver;
  readonly rules: GodotCodeRuleResolver;
  readonly evidence: GodotCodeEvidenceResolver;
  readonly sourceRevision: string;

  constructor(authority: GodotCodeTranslationAuthority) {
    if (
      authority.bindings.sourceRevision !== authority.sourceRevision ||
      authority.rules.sourceRevision !== authority.sourceRevision
    ) {
      throw new Error('Godot code authority tables do not share one source revision');
    }
    this.bindings = new GodotBindingResolver(authority.bindings);
    this.rules = new GodotCodeRuleResolver(authority.rules);
    this.evidence = new GodotCodeEvidenceResolver(authority);
    this.sourceRevision = authority.sourceRevision;
  }
}
