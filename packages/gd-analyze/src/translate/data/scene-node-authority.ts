export const GODOT_SCENE_NODE_AUTHORITY_VERSION = 1 as const;

/** A compat export the composition calls: `module` relative to the project's `src/`. */
export interface GodotCompatExport {
  readonly module: string;
  readonly exportName: string;
}

/** A resource class the composition constructs (`construct`), then sets authored properties on. */
export interface GodotSceneResourceRule {
  readonly sourceRevision: string;
  readonly className: string;
  readonly construct: GodotCompatExport;
}

function godotSceneResourceRuleKey(sourceRevision: string, className: string): string {
  return [sourceRevision, 'scene-resource', className].join('\0');
}

export type GodotScenePlacementKind = 'child';

export interface GodotScenePlacementRule {
  readonly sourceRevision: string;
  readonly placement: GodotScenePlacementKind;
  readonly targetOperation: 'native-child';
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
  | 'authored-order'
  /** An authored property without a JSX rule is its setter's bound call on the entity at mount. */
  | 'property-setter'
  /** `unique_name_in_owner`: the node registers with its owner, which finds it as `%Name`. */
  | 'unique-name'
  /** An instanced imported model: Godot's importer tree over the loaded file. */
  | 'imported-scene'
  /** Overrides of an imported model's nodes, and nodes placed under them. */
  | 'imported-scene-edits'
  /** A scene written as idiomatic React Three Fiber (the owner's ruling, GODOT.md). */
  | 'idiomatic-scene';

export interface GodotSceneStructureRule {
  readonly sourceRevision: string;
  readonly id: GodotSceneStructureRuleId;
}

function godotSceneStructureRuleKey(
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
}

function godotSceneSignalRuleKey(sourceRevision: string, ownerClass: string, signal: string): string {
  return [sourceRevision, 'scene-connection', ownerClass, signal].join('\0');
}

export interface GodotScenePropertyRule {
  readonly sourceRevision: string;
  readonly nativeCanonicalIdentity: string;
  readonly propertyName: string;
  readonly serializedValue: SerializedScenePropertyIdentity;
  readonly targetKind: TargetScenePropertyKind;
}

export interface GodotSceneNodeAuthority {
  readonly version: typeof GODOT_SCENE_NODE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly placementRules: readonly GodotScenePlacementRule[];
  readonly propertyRules: readonly GodotScenePropertyRule[];
  readonly structureRules: readonly GodotSceneStructureRule[];
  readonly signalRules: readonly GodotSceneSignalRule[];
  readonly resourceRules: readonly GodotSceneResourceRule[];
}

function godotScenePlacementRuleKey(
  sourceRevision: string,
  placement: GodotScenePlacementKind,
): string {
  return [sourceRevision, 'scene-node-placement', placement].join('\0');
}

function godotScenePropertyRuleKey(
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

function indexPlacementRules(
  authority: GodotSceneNodeAuthority,
): ReadonlyMap<string, GodotScenePlacementRule> {
  const result = new Map<string, GodotScenePlacementRule>();
  for (const rule of authority.placementRules) {
    if (rule.sourceRevision !== authority.sourceRevision) {
      throw new Error(`Godot scene placement has a different source: ${rule.placement}`);
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
      throw new Error(`Godot scene property has a different source: ${rule.propertyName}`);
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

/**
 * Lookup of the scene rules a node's placement, properties, structure, connections and resources
 * are planned by. Which node classes the lane writes is the idiom table's (`scene-node-idioms.ts`).
 */
export class GodotSceneNodeAuthorityResolver {
  readonly sourceRevision: string;
  readonly #placementRules: ReadonlyMap<string, GodotScenePlacementRule>;
  readonly #propertyRules: ReadonlyMap<string, GodotScenePropertyRule>;
  readonly #structureRules: ReadonlyMap<string, GodotSceneStructureRule>;
  readonly #signalRules: ReadonlyMap<string, GodotSceneSignalRule>;
  readonly #resourceRules: ReadonlyMap<string, GodotSceneResourceRule>;

  constructor(authority: GodotSceneNodeAuthority) {
    if (authority.version !== GODOT_SCENE_NODE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot scene-node authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
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
    const resources = new Map<string, GodotSceneResourceRule>();
    for (const rule of authority.resourceRules) {
      const key = godotSceneResourceRuleKey(rule.sourceRevision, rule.className);
      if (resources.has(key)) throw new Error(`duplicate Godot scene resource rule: ${key}`);
      resources.set(key, rule);
    }
    this.#resourceRules = resources;
  }

  /** The rule that constructs a resource class, or undefined. */
  resourceRule(className: string): GodotSceneResourceRule | undefined {
    return this.#resourceRules.get(godotSceneResourceRuleKey(this.sourceRevision, className));
  }

  /**
   * The connection rule for a signal of a node whose native ancestry (nearest first) is given: the
   * rule of the nearest class that has one; undefined when none has.
   */
  signalRule(ancestry: readonly string[], signal: string): GodotSceneSignalRule | undefined {
    for (const ownerClass of ancestry) {
      const rule = this.#signalRules.get(godotSceneSignalRuleKey(this.sourceRevision, ownerClass, signal));
      if (rule !== undefined) return rule;
    }
    return undefined;
  }

  /** A structure rule, or undefined. */
  structureRule(id: GodotSceneStructureRuleId): GodotSceneStructureRule | undefined {
    return this.#structureRules.get(godotSceneStructureRuleKey(this.sourceRevision, id));
  }

  placementRule(placement: GodotScenePlacementKind): GodotScenePlacementRule | undefined {
    return this.#placementRules.get(godotScenePlacementRuleKey(this.sourceRevision, placement));
  }

  propertyRule(
    nativeCanonicalIdentity: string,
    propertyName: string,
    serializedValue: SerializedScenePropertyIdentity,
  ): GodotScenePropertyRule | undefined {
    return this.#propertyRules.get(
      godotScenePropertyRuleKey(this.sourceRevision, nativeCanonicalIdentity, propertyName, serializedValue),
    );
  }
}
