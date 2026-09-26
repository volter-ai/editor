import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../../godot-frontend/semantic-claims';

export const GODOT_LIFECYCLE_AUTHORITY_VERSION = 2 as const;

export type DirectGodotLifecyclePhase = 'enter-tree' | 'ready' | 'exit-tree';

export interface GodotLifecycleRule {
  readonly sourceRevision: string;
  readonly phases: readonly DirectGodotLifecyclePhase[];
  readonly targetOperation: 'compat-native-hierarchy-mount';
  readonly evidenceClaimId: string;
}

export interface GodotProjectStartupRule {
  readonly sourceRevision: string;
  readonly sourceOrder: 'autoloads-then-main';
  readonly targetOperation: 'react-native-startup-batch';
  readonly evidenceClaimId: string;
}

export interface GodotLifecycleClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

export interface GodotLifecycleAuthority {
  readonly version: typeof GODOT_LIFECYCLE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotLifecycleRule[];
  readonly projectStartupRules: readonly GodotProjectStartupRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotLifecycleClaimLiveness[];
}

export function godotProjectStartupRuleKey(sourceRevision: string): string {
  return [sourceRevision, 'project-startup', 'autoloads-then-main'].join('\0');
}

export function godotLifecycleRuleKey(
  sourceRevision: string,
  phases: readonly DirectGodotLifecyclePhase[],
): string {
  return [sourceRevision, 'scene-lifecycle', ...phases].join('\0');
}

/** Exact-evidence lookup for lifecycle policy accepted into generated native composition. */
export class GodotLifecycleAuthorityResolver {
  readonly registryDigest: string;
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotLifecycleRule>;
  readonly #projectStartupRules: ReadonlyMap<string, GodotProjectStartupRule>;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, GodotLifecycleClaimLiveness>;

  constructor(authority: GodotLifecycleAuthority) {
    if (authority.version !== GODOT_LIFECYCLE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot lifecycle authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    this.#registry = new SemanticClaimRegistry(authority.claims);
    this.registryDigest = this.#registry.digest;
    for (const entry of authority.liveness) {
      if (
        entry.sourceRevision !== authority.sourceRevision ||
        entry.apiDumpSha256 !== authority.apiDumpSha256
      ) {
        throw new Error(`Godot lifecycle liveness has a different source: ${entry.claimId}`);
      }
    }
    for (const rule of authority.rules) {
      if (rule.sourceRevision !== authority.sourceRevision) {
        throw new Error(`Godot lifecycle rule has a different source: ${rule.evidenceClaimId}`);
      }
    }
    for (const rule of authority.projectStartupRules) {
      if (rule.sourceRevision !== authority.sourceRevision) {
        throw new Error(
          `Godot project-startup rule has a different source: ${rule.evidenceClaimId}`,
        );
      }
    }
    this.#liveness = new Map(authority.liveness.map((entry) => [entry.claimId, entry]));
    this.#rules = new Map(
      authority.rules.map((rule) => [
        godotLifecycleRuleKey(rule.sourceRevision, rule.phases),
        rule,
      ]),
    );
    this.#projectStartupRules = new Map(
      authority.projectStartupRules.map((rule) => [
        godotProjectStartupRuleKey(rule.sourceRevision),
        rule,
      ]),
    );
    if (
      this.#liveness.size !== authority.liveness.length ||
      this.#rules.size !== authority.rules.length ||
      this.#projectStartupRules.size !== authority.projectStartupRules.length
    ) {
      throw new Error('Godot lifecycle authority contains duplicate identities.');
    }
  }

  projectStartupRule(): GodotProjectStartupRule | undefined {
    const key = godotProjectStartupRuleKey(this.sourceRevision);
    const rule = this.#projectStartupRules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot project-startup claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'compat' || claim.canonicalIdentity !== key) {
      throw new Error(
        `Godot project-startup claim does not prove its rule: ${rule.evidenceClaimId}`,
      );
    }
    return rule;
  }

  rule(phases: readonly DirectGodotLifecyclePhase[]): GodotLifecycleRule | undefined {
    const key = godotLifecycleRuleKey(this.sourceRevision, phases);
    const rule = this.#rules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot lifecycle claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'compat' || claim.canonicalIdentity !== key) {
      throw new Error(`Godot lifecycle claim does not prove its rule: ${rule.evidenceClaimId}`);
    }
    return rule;
  }
}
