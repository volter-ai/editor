import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../../godot-frontend/semantic-claims';

export const GODOT_SCENE_NODE_AUTHORITY_VERSION = 1 as const;

export type TargetSceneNodeKind = 'three-group';

export interface GodotSceneNodeRule {
  readonly sourceRevision: string;
  readonly nativeCanonicalIdentity: string;
  readonly targetKind: TargetSceneNodeKind;
  readonly evidenceClaimId: string;
}

export type GodotScenePlacementKind = 'child';

export interface GodotScenePlacementRule {
  readonly sourceRevision: string;
  readonly placement: GodotScenePlacementKind;
  readonly targetOperation: 'native-child';
  readonly evidenceClaimId: string;
}

export type SerializedScenePropertyIdentity = 'ctor:Vector3(number,number,number)';
export type TargetScenePropertyKind = 'three-position' | 'three-rotation-yxz' | 'three-scale';

export interface GodotScenePropertyRule {
  readonly sourceRevision: string;
  readonly nativeCanonicalIdentity: string;
  readonly propertyName: string;
  readonly serializedValue: SerializedScenePropertyIdentity;
  readonly targetKind: TargetScenePropertyKind;
  readonly evidenceClaimId: string;
}

export interface GodotSceneNodeClaimLiveness extends SemanticClaimLiveness {
  readonly claimId: string;
}

export interface GodotSceneNodeAuthority {
  readonly version: typeof GODOT_SCENE_NODE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotSceneNodeRule[];
  readonly placementRules: readonly GodotScenePlacementRule[];
  readonly propertyRules: readonly GodotScenePropertyRule[];
  readonly claims: readonly SemanticClaimRecord[];
  readonly liveness: readonly GodotSceneNodeClaimLiveness[];
}

export function godotScenePlacementRuleKey(
  sourceRevision: string,
  placement: GodotScenePlacementKind,
): string {
  return [sourceRevision, 'scene-node-placement', placement].join('\0');
}

export function godotSceneNodeRuleKey(
  sourceRevision: string,
  nativeCanonicalIdentity: string,
): string {
  return [sourceRevision, 'scene-node-target', nativeCanonicalIdentity].join('\0');
}

export function godotScenePropertyRuleKey(
  sourceRevision: string,
  nativeCanonicalIdentity: string,
  propertyName: string,
  serializedValue: SerializedScenePropertyIdentity,
): string {
  return [
    sourceRevision,
    'scene-node-property',
    nativeCanonicalIdentity,
    propertyName,
    serializedValue,
  ].join('\0');
}

function indexLiveness(
  authority: GodotSceneNodeAuthority,
): ReadonlyMap<string, GodotSceneNodeClaimLiveness> {
  const result = new Map<string, GodotSceneNodeClaimLiveness>();
  for (const entry of authority.liveness) {
    if (result.has(entry.claimId)) {
      throw new Error(`duplicate Godot scene-node liveness: ${entry.claimId}`);
    }
    if (
      entry.sourceRevision !== authority.sourceRevision ||
      entry.apiDumpSha256 !== authority.apiDumpSha256
    ) {
      throw new Error(`Godot scene-node liveness has a different source: ${entry.claimId}`);
    }
    result.set(entry.claimId, entry);
  }
  return result;
}

function indexNodeRules(
  authority: GodotSceneNodeAuthority,
): ReadonlyMap<string, GodotSceneNodeRule> {
  const result = new Map<string, GodotSceneNodeRule>();
  for (const rule of authority.rules) {
    if (rule.sourceRevision !== authority.sourceRevision) {
      throw new Error(`Godot scene-node rule has a different source: ${rule.evidenceClaimId}`);
    }
    const key = godotSceneNodeRuleKey(rule.sourceRevision, rule.nativeCanonicalIdentity);
    if (result.has(key)) throw new Error(`duplicate Godot scene-node rule: ${key}`);
    result.set(key, rule);
  }
  return result;
}

function indexPlacementRules(
  authority: GodotSceneNodeAuthority,
): ReadonlyMap<string, GodotScenePlacementRule> {
  const result = new Map<string, GodotScenePlacementRule>();
  for (const rule of authority.placementRules) {
    if (rule.sourceRevision !== authority.sourceRevision) {
      throw new Error(`Godot scene placement has a different source: ${rule.evidenceClaimId}`);
    }
    const key = godotScenePlacementRuleKey(rule.sourceRevision, rule.placement);
    if (result.has(key)) throw new Error(`duplicate Godot scene placement rule: ${key}`);
    result.set(key, rule);
  }
  return result;
}

function indexPropertyRules(
  authority: GodotSceneNodeAuthority,
): ReadonlyMap<string, GodotScenePropertyRule> {
  const result = new Map<string, GodotScenePropertyRule>();
  for (const rule of authority.propertyRules) {
    if (rule.sourceRevision !== authority.sourceRevision) {
      throw new Error(`Godot scene property has a different source: ${rule.evidenceClaimId}`);
    }
    const key = godotScenePropertyRuleKey(
      rule.sourceRevision,
      rule.nativeCanonicalIdentity,
      rule.propertyName,
      rule.serializedValue,
    );
    if (result.has(key)) throw new Error(`duplicate Godot scene property rule: ${key}`);
    result.set(key, rule);
  }
  return result;
}

/** Exact-evidence lookup from an already-bound native ClassDB identity to one target node kind. */
export class GodotSceneNodeAuthorityResolver {
  readonly registryDigest: string;
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotSceneNodeRule>;
  readonly #placementRules: ReadonlyMap<string, GodotScenePlacementRule>;
  readonly #propertyRules: ReadonlyMap<string, GodotScenePropertyRule>;
  readonly #registry: SemanticClaimRegistry;
  readonly #liveness: ReadonlyMap<string, GodotSceneNodeClaimLiveness>;

  constructor(authority: GodotSceneNodeAuthority) {
    if (authority.version !== GODOT_SCENE_NODE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot scene-node authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    this.#registry = new SemanticClaimRegistry(authority.claims);
    this.registryDigest = this.#registry.digest;
    this.#liveness = indexLiveness(authority);
    this.#rules = indexNodeRules(authority);
    this.#placementRules = indexPlacementRules(authority);
    this.#propertyRules = indexPropertyRules(authority);
  }

  rule(nativeCanonicalIdentity: string): GodotSceneNodeRule | undefined {
    const key = godotSceneNodeRuleKey(this.sourceRevision, nativeCanonicalIdentity);
    const rule = this.#rules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot scene-node claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== key) {
      throw new Error(`Godot scene-node claim does not prove its rule: ${rule.evidenceClaimId}`);
    }
    return rule;
  }

  placementRule(placement: GodotScenePlacementKind): GodotScenePlacementRule | undefined {
    const key = godotScenePlacementRuleKey(this.sourceRevision, placement);
    const rule = this.#placementRules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot scene placement claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== key) {
      throw new Error(
        `Godot scene placement claim does not prove its rule: ${rule.evidenceClaimId}`,
      );
    }
    return rule;
  }

  propertyRule(
    nativeCanonicalIdentity: string,
    propertyName: string,
    serializedValue: SerializedScenePropertyIdentity,
  ): GodotScenePropertyRule | undefined {
    const key = godotScenePropertyRuleKey(
      this.sourceRevision,
      nativeCanonicalIdentity,
      propertyName,
      serializedValue,
    );
    const rule = this.#propertyRules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot scene property claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== key) {
      throw new Error(
        `Godot scene property claim does not prove its rule: ${rule.evidenceClaimId}`,
      );
    }
    return rule;
  }
}
