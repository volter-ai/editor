import {
  type SemanticClaimLiveness,
  type SemanticClaimRecord,
  SemanticClaimRegistry,
} from '../../godot-frontend/semantic-claims';

export const GODOT_SCENE_NODE_AUTHORITY_VERSION = 1 as const;

/**
 * The native entity a Godot node class mounts as: a Node3D is a `<group>`; a plain Node a
 * `<group>` compat marks non-spatial (identity matrix, skipped by Node3D's parent rule); a
 * Camera3D a `<perspectiveCamera>` mounted with Godot's defaults.
 */
export type TargetSceneNodeKind = 'three-group' | 'three-node' | 'three-perspective-camera';

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

export type SerializedScenePropertyIdentity =
  | 'ctor:Vector3(number,number,number)'
  | 'ctor:Transform3D(number*12)'
  | 'number';
export type TargetScenePropertyKind =
  | 'three-position'
  | 'three-rotation-yxz'
  | 'three-scale'
  /** The authored `Transform3D` as the Object3D's local matrix, exactly (`matrixAutoUpdate` off). */
  | 'three-matrix'
  | 'camera-fov'
  | 'camera-near'
  | 'camera-far';

/**
 * What a `.tscn` says about structure, independent of node class (GODOT.md §Scene structure):
 * an instanced scene as its generated component, the instance root's authored overrides as its
 * props, children authored under the instance root as its children, groups handed to the Node
 * protocol at mount, and authored sibling order as JSX order.
 */
export type GodotSceneStructureRuleId =
  | 'scene-instance'
  | 'instance-root-override'
  | 'instance-children'
  | 'node-groups'
  | 'authored-order';

export interface GodotSceneStructureRule {
  readonly sourceRevision: string;
  readonly id: GodotSceneStructureRuleId;
  readonly evidenceClaimId: string;
}

export function godotSceneStructureRuleKey(
  sourceRevision: string,
  id: GodotSceneStructureRuleId,
): string {
  return [sourceRevision, 'scene-structure', id].join('\0');
}

/**
 * An authored `[connection]` from a native class's signal: the composition site connects it by the
 * compat accessor that exposes that signal on the node's entity (`accessor(entity)` or, `named`,
 * `accessor(entity, signal)`), to the target script instance's method, when the scene mounts.
 */
export interface GodotSceneSignalRule {
  readonly sourceRevision: string;
  /** The native class that declares the signal (the API dump's `signals`). */
  readonly ownerClass: string;
  readonly signal: string;
  readonly accessor: { readonly module: string; readonly exportName: string; readonly named: boolean };
  /** The signal's declared argument count (the API dump's), passed on to the method. */
  readonly arguments: number;
  readonly evidenceClaimId: string;
}

export function godotSceneSignalRuleKey(sourceRevision: string, ownerClass: string, signal: string): string {
  return [sourceRevision, 'scene-connection', ownerClass, signal].join('\0');
}

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
  readonly structureRules: readonly GodotSceneStructureRule[];
  readonly signalRules: readonly GodotSceneSignalRule[];
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
  readonly #structureRules: ReadonlyMap<string, GodotSceneStructureRule>;
  readonly #signalRules: ReadonlyMap<string, GodotSceneSignalRule>;
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
    const structure = new Map<string, GodotSceneStructureRule>();
    for (const rule of authority.structureRules) {
      const key = godotSceneStructureRuleKey(rule.sourceRevision, rule.id);
      if (structure.has(key)) throw new Error(`duplicate Godot scene structure rule: ${key}`);
      structure.set(key, rule);
    }
    this.#structureRules = structure;
    const signals = new Map<string, GodotSceneSignalRule>();
    for (const rule of authority.signalRules) {
      const key = godotSceneSignalRuleKey(rule.sourceRevision, rule.ownerClass, rule.signal);
      if (signals.has(key)) throw new Error(`duplicate Godot scene connection rule: ${key}`);
      signals.set(key, rule);
    }
    this.#signalRules = signals;
  }

  /**
   * The live connection rule for a signal of a node whose native ancestry (nearest first) is
   * given: the rule of the nearest class that has one; undefined when none has live evidence.
   */
  signalRule(ancestry: readonly string[], signal: string): GodotSceneSignalRule | undefined {
    for (const ownerClass of ancestry) {
      const key = godotSceneSignalRuleKey(this.sourceRevision, ownerClass, signal);
      const rule = this.#signalRules.get(key);
      if (rule === undefined) continue;
      const liveness = this.#liveness.get(rule.evidenceClaimId);
      if (liveness === undefined) {
        throw new Error(`Godot scene connection claim has no liveness: ${rule.evidenceClaimId}`);
      }
      const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
      if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== key) {
        throw new Error(`Godot scene connection claim does not prove its rule: ${rule.evidenceClaimId}`);
      }
      return rule;
    }
    return undefined;
  }

  /** A live structure rule, or undefined when the rule has no live evidence. */
  structureRule(id: GodotSceneStructureRuleId): GodotSceneStructureRule | undefined {
    const key = godotSceneStructureRuleKey(this.sourceRevision, id);
    const rule = this.#structureRules.get(key);
    if (rule === undefined) return undefined;
    const liveness = this.#liveness.get(rule.evidenceClaimId);
    if (liveness === undefined) {
      throw new Error(`Godot scene structure claim has no liveness: ${rule.evidenceClaimId}`);
    }
    const claim = this.#registry.claim(rule.evidenceClaimId, liveness);
    if (claim.layer !== 'translate-data' || claim.canonicalIdentity !== key) {
      throw new Error(`Godot scene structure claim does not prove its rule: ${rule.evidenceClaimId}`);
    }
    return rule;
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
