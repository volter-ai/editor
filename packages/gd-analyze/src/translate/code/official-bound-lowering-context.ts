import type { BoundGodotCallReceiver } from '../../analyze/call-receivers';
import type { GodotBoundNode, GodotBoundScript } from '../../godot-frontend/bound-program';
import type { SemanticClaimLayer } from '../../godot-frontend/semantic-claims';
import { safeIdent } from '../target-names';
import type { GodotCodeEvidenceResolver } from './authority';
import type {
  GodotBindingResolver,
  GodotOfficialSymbolIdentity,
  GodotTargetBinding,
} from './bindings';
import { godotOfficialSymbolKey } from './bindings';
import type {
  GodotCodeRuleIdentity,
  GodotCodeRuleRecipe,
  GodotCodeRuleResolver,
  GodotStructuralConstruct,
} from './lowering-rules';
import {
  godotBoundDatatypeIdentity,
  godotCodeRuleKey,
  godotDatatypeRuleKey,
} from './lowering-rules';
import type { TargetTsSpan, TargetTsType } from './target-ts-syntax';

export class BoundLoweringRefusal extends Error {
  constructor(
    readonly script: GodotBoundScript,
    readonly node: GodotBoundNode,
    message: string,
  ) {
    super(message);
    this.name = 'BoundLoweringRefusal';
  }
}

export interface OfficialBoundLoweringDiagnostic extends TargetTsSpan {
  readonly message: string;
}

export interface OfficialBoundAutoloadReference {
  readonly name: string;
  readonly resPath: string;
  readonly targetClassName: string;
  readonly fieldName: string;
  readonly typeLocalName: string;
  readonly typeImport?: {
    readonly module: string;
    readonly imported: string;
    readonly local: string;
  };
}

export type OfficialBoundLoweringRequirement =
  | {
      readonly kind: 'binding-requirement';
      readonly symbol: GodotOfficialSymbolIdentity;
      readonly target: Exclude<GodotTargetBinding, { readonly kind: 'refusal-binding' }>;
    }
  | {
      readonly kind: 'evidence-requirement';
      readonly layer: 'analysis' | 'language';
      readonly claimId: string;
      readonly canonicalIdentity: string;
    }
  | {
      readonly kind: 'autoload-reference-requirement';
      readonly reference: OfficialBoundAutoloadReference;
    }
  | {
      /** An import from a compat module; its specifier is made relative to the emitting module. */
      readonly kind: 'compat-import-requirement';
      readonly module: string;
      readonly imported: string;
      readonly local: string;
      readonly typeOnly: boolean;
    }
  | {
      readonly kind: 'project-import-requirement';
      readonly module: string;
      readonly imported: string;
      readonly local: string;
      readonly typeOnly: boolean;
    };

export interface OfficialBoundBindingUse {
  readonly target: Exclude<GodotTargetBinding, { readonly kind: 'refusal-binding' }>;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export interface OfficialBoundAutoloadUse {
  readonly reference: OfficialBoundAutoloadReference;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export interface OfficialBoundRuleUse {
  readonly recipe: GodotCodeRuleRecipe;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export interface OfficialBoundTypeUse {
  readonly type: TargetTsType;
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export interface OfficialBoundAutoloadCandidate {
  readonly nodeId: number;
  readonly name: string;
  readonly resPath: string;
  readonly sourceClassName: string;
  readonly targetClassName: string;
  readonly module: string;
  readonly evidenceClaimId: string;
  readonly canonicalIdentity: string;
}

const VALUE_STRUCTURAL_CONSTRUCTS: ReadonlySet<GodotStructuralConstruct> = new Set([
  'array-literal',
  'autoload-identifier',
  'await',
  'bound-identifier',
  'call',
  'dictionary-object-literal',
  'lambda',
  'literal',
  'local-identifier',
  'member-identifier',
  'self',
  'subscript-attribute',
  'subscript-element',
  'ternary',
]);

export interface NativePropertyAccessor {
  /** The class in the ancestry that declares the accessor method. */
  readonly owner: string;
  readonly name: string;
  readonly hash: number;
}

export interface NativeProperty {
  /** The class in the ancestry that declares the property. */
  readonly owner: string;
  readonly getter?: NativePropertyAccessor;
  readonly setter?: NativePropertyAccessor;
}

/** A native class's property, found up the ancestry the API dump states, or undefined. */
export type NativePropertyLookup = (className: string, property: string) => NativeProperty | undefined;

export class LoweringContext {
  #temporaryIndex = 0;
  #instanceAutoloadAccess = 0;
  readonly #reservedTargetNames: Set<string>;
  readonly #lexicalNames: ReadonlyMap<string, string>;

  constructor(
    readonly sourceRevision: string,
    readonly script: GodotBoundScript,
    readonly bindings: GodotBindingResolver,
    readonly rules: GodotCodeRuleResolver,
    readonly evidence: GodotCodeEvidenceResolver,
    readonly classIdentifier: string,
    readonly autoloads: ReadonlyMap<number, OfficialBoundAutoloadCandidate>,
    /** Dynamic calls analysis typed from project facts, and why the rest stayed untyped. */
    readonly callReceivers: ReadonlyMap<number, BoundGodotCallReceiver> = new Map(),
    readonly untypedCalls: ReadonlyMap<number, string> = new Map(),
    readonly nativeProperties?: NativePropertyLookup,
  ) {
    const allocated = new Set([classIdentifier, ...bindings.targetLocalNames()]);
    const lexicalNames = new Map<string, string>();
    const sourceNames = new Set<string>();
    for (const node of script.nodes) {
      if (node.kind === 'IDENTIFIER') sourceNames.add(node.name);
    }
    let collisionIndex = 0;
    for (const sourceName of [...sourceNames].sort()) {
      let targetName = safeIdent(sourceName);
      while (allocated.has(targetName)) {
        targetName = `$godot_local_${String(collisionIndex)}`;
        collisionIndex += 1;
      }
      lexicalNames.set(sourceName, targetName);
      allocated.add(targetName);
    }
    this.#lexicalNames = lexicalNames;
    this.#reservedTargetNames = allocated;
  }

  nativeProperty(className: string, property: string): NativeProperty | undefined {
    return this.nativeProperties?.(className, property);
  }

  autoload(
    node: Extract<GodotBoundNode, { readonly kind: 'IDENTIFIER' }>,
  ): OfficialBoundAutoloadUse | undefined {
    const candidate = this.autoloads.get(node.id);
    if (candidate === undefined) return undefined;
    if (this.#instanceAutoloadAccess === 0) {
      this.refuse(
        node,
        `singleton ${node.name} requires a post-construction instance method; static, field-initializer, and _init access is not yet planned`,
      );
    }
    if (
      node.source !== 'UNDEFINED_SOURCE' ||
      node.name !== candidate.name ||
      node.datatype.kind !== 'CLASS' ||
      node.datatype.constant !== true ||
      node.datatype.scriptPath !== candidate.resPath ||
      (candidate.sourceClassName !== '' && node.datatype.className !== candidate.sourceClassName)
    ) {
      this.refuse(
        node,
        `official identifier ${node.name} does not carry the bound identity of singleton ${candidate.resPath}`,
      );
    }
    this.prove(node, candidate.evidenceClaimId, 'analyze', candidate.canonicalIdentity);
    const rule = this.rule(
      node,
      'autoload-identifier:resolved-script-singleton',
      [],
      'structural',
      false,
    );
    const recipe = rule.recipe;
    if (recipe.kind !== 'structural' || recipe.construct !== 'autoload-identifier') {
      this.refuse(node, 'autoload singleton rule does not select direct typed field access');
    }
    const fieldName = `$autoload_${node.name}`;
    const typeLocalName =
      candidate.resPath === this.script.resPath
        ? this.classIdentifier
        : `$AutoloadType_${node.name}`;
    const reference = {
      name: node.name,
      resPath: candidate.resPath,
      targetClassName: candidate.targetClassName,
      fieldName,
      typeLocalName,
      ...(candidate.resPath === this.script.resPath
        ? {}
        : {
            typeImport: {
              module: candidate.module,
              imported: candidate.targetClassName,
              local: typeLocalName,
            },
          }),
    };
    return {
      reference,
      requirements: [
        {
          kind: 'evidence-requirement',
          layer: 'analysis',
          claimId: candidate.evidenceClaimId,
          canonicalIdentity: candidate.canonicalIdentity,
        },
        ...rule.requirements,
        { kind: 'autoload-reference-requirement', reference },
      ],
    };
  }

  withInstanceAutoloadAccess<Result>(operation: () => Result): Result {
    this.#instanceAutoloadAccess += 1;
    try {
      return operation();
    } finally {
      this.#instanceAutoloadAccess -= 1;
    }
  }

  node(id: number, owner: GodotBoundNode): GodotBoundNode {
    const node = id < 0 ? undefined : this.script.nodes[id];
    if (node === undefined) this.refuse(owner, `official bound node ${String(id)} is missing`);
    return node;
  }

  refuse(node: GodotBoundNode, message: string): never {
    throw new BoundLoweringRefusal(this.script, node, message);
  }

  prove(
    node: GodotBoundNode,
    claimId: string,
    layer: SemanticClaimLayer,
    canonicalIdentity: string,
  ): void {
    try {
      this.evidence.claim(claimId, layer, canonicalIdentity);
    } catch (error) {
      this.refuse(
        node,
        error instanceof Error ? error.message : `semantic evidence failed: ${String(error)}`,
      );
    }
  }

  bindingUse(symbol: GodotOfficialSymbolIdentity, node: GodotBoundNode): OfficialBoundBindingUse {
    const target = this.bindings.resolve(symbol);
    if (target.kind === 'refusal-binding') this.refuse(node, target.reason);
    if (
      !/^[$A-Z_a-z][$\w]*$/.test(target.localName) ||
      safeIdent(target.localName) !== target.localName
    ) {
      this.refuse(
        node,
        `binding target local is not a valid TypeScript lexical name: ${target.localName}`,
      );
    }
    this.prove(node, target.evidenceClaimId, 'binding', godotOfficialSymbolKey(symbol));
    return {
      target,
      requirements: [
        {
          kind: 'binding-requirement',
          symbol,
          target,
        },
      ],
    };
  }

  rule(
    node: GodotBoundNode,
    semanticKey: string,
    inputNodes: readonly GodotBoundNode[],
    expected: GodotCodeRuleRecipe['kind'],
    includeResultDatatype = true,
  ): OfficialBoundRuleUse {
    return this.selectRule(node, [semanticKey], inputNodes, [expected], includeResultDatatype);
  }

  /**
   * The first semantic key, in order, that has an evidenced rule (exact datatypes first, then the
   * datatype classes the resolver generalizes to), whose recipe is one of `expected`.
   */
  selectRule(
    node: GodotBoundNode,
    semanticKeys: readonly string[],
    inputNodes: readonly GodotBoundNode[],
    expected: readonly GodotCodeRuleRecipe['kind'][],
    includeResultDatatype = true,
  ): OfficialBoundRuleUse {
    const semanticKey = semanticKeys[0] as string;
    const annotations = node.annotations.map((id) => {
      const annotation = this.node(id, node);
      if (annotation.kind !== 'ANNOTATION') {
        this.refuse(annotation, `annotation id ${String(id)} resolves to ${annotation.kind}`);
      }
      return [
        annotation.name,
        annotation.resolved ? 'resolved' : 'unresolved',
        annotation.applied ? 'applied' : 'unapplied',
        JSON.stringify(annotation.resolvedArguments),
      ].join(':');
    });
    const identityFor = (key: string): GodotCodeRuleIdentity => ({
      sourceRevision: this.sourceRevision,
      nodeKind: node.kind,
      semanticKey: `${key}|annotations:[${annotations.join(',')}]`,
      inputDatatypes: inputNodes.map((input) => godotBoundDatatypeIdentity(input.datatype)),
      resultDatatype: includeResultDatatype ? godotBoundDatatypeIdentity(node.datatype) : '',
    });
    const identity = identityFor(semanticKey);
    let entry = this.rules.rule(identity);
    for (const key of semanticKeys.slice(1)) {
      if (entry !== undefined) break;
      entry = this.rules.rule(identityFor(key));
    }
    if (entry === undefined) {
      this.refuse(
        node,
        `no evidenced code rule for ${node.kind}:${semanticKey}; identity=${JSON.stringify(identity)}`,
      );
    }
    if (entry.target.kind === 'refusal') this.refuse(node, entry.target.reason);
    if (!expected.includes(entry.target.kind)) {
      this.refuse(
        node,
        `code rule ${node.kind}:${semanticKey} produced ${entry.target.kind}, expected ${expected.join(' or ')}`,
      );
    }
    this.prove(node, entry.evidenceClaimId, 'translate-code', godotCodeRuleKey(entry.source));
    return {
      recipe: entry.target,
      requirements: [
        {
          kind: 'evidence-requirement',
          layer: 'language',
          claimId: entry.evidenceClaimId,
          canonicalIdentity: godotCodeRuleKey(entry.source),
        },
      ],
    };
  }

  structural(
    node: GodotBoundNode,
    construct: GodotStructuralConstruct,
    inputNodes: readonly GodotBoundNode[] = [],
    semanticKey: string = construct,
  ): readonly OfficialBoundLoweringRequirement[] {
    const rule = this.rule(
      node,
      semanticKey,
      inputNodes,
      'structural',
      VALUE_STRUCTURAL_CONSTRUCTS.has(construct),
    );
    const recipe = rule.recipe;
    if (recipe.kind !== 'structural' || recipe.construct !== construct) {
      this.refuse(node, `code rule for ${node.kind} does not select ${construct}`);
    }
    return rule.requirements;
  }

  targetType(node: GodotBoundNode): OfficialBoundTypeUse {
    const entry = this.rules.datatype(node.datatype);
    if (entry === undefined) {
      this.refuse(
        node,
        `no evidenced datatype rule for ${node.datatype.display}; identity=${godotBoundDatatypeIdentity(node.datatype)}`,
      );
    }
    this.prove(node, entry.evidenceClaimId, 'translate-code', godotDatatypeRuleKey(entry));
    if (entry.typeImport !== undefined && entry.targetType.kind !== 'type-reference') {
      this.refuse(node, `datatype rule ${entry.sourceDatatype} imports a type it does not name`);
    }
    return {
      type: entry.targetType,
      requirements: [
        {
          kind: 'evidence-requirement',
          layer: 'language',
          claimId: entry.evidenceClaimId,
          canonicalIdentity: godotDatatypeRuleKey(entry),
        },
        ...(entry.typeImport === undefined || entry.targetType.kind !== 'type-reference'
          ? []
          : [
              {
                kind: 'compat-import-requirement' as const,
                module: entry.typeImport.module,
                imported: entry.typeImport.exportName,
                local: entry.targetType.name,
                typeOnly: true,
              },
            ]),
      ],
    };
  }

  temporary(): string {
    while (true) {
      const name = `__godot_value_${String(this.#temporaryIndex)}`;
      this.#temporaryIndex += 1;
      if (this.#reservedTargetNames.has(name)) continue;
      this.#reservedTargetNames.add(name);
      return name;
    }
  }

  lexicalName(sourceName: string): string {
    return this.#lexicalNames.get(sourceName) ?? safeIdent(sourceName);
  }
}

export function officialBoundSpan(script: GodotBoundScript, node: GodotBoundNode): TargetTsSpan {
  return {
    sourcePath: script.resPath,
    startLine: node.startLine,
    startColumn: node.startColumn,
    endLine: node.endLine,
    endColumn: node.endColumn,
  };
}

export function officialBoundIdentifier(
  context: LoweringContext,
  id: number,
  owner: GodotBoundNode,
): string {
  return context.lexicalName(officialBoundPropertyName(context, id, owner));
}

/** Property names may be target-language keywords; lexical bindings may not. */
export function officialBoundPropertyName(
  context: LoweringContext,
  id: number,
  owner: GodotBoundNode,
): string {
  const node = context.node(id, owner);
  if (node.kind !== 'IDENTIFIER') {
    context.refuse(node, `expected IDENTIFIER, received ${node.kind}`);
  }
  if (!/^[$A-Z_a-z][$\w]*$/.test(node.name)) {
    context.refuse(node, `identifier cannot be represented in TypeScript: ${node.name}`);
  }
  return node.name;
}

export function officialBoundDiagnostic(
  error: BoundLoweringRefusal,
): OfficialBoundLoweringDiagnostic {
  return { ...officialBoundSpan(error.script, error.node), message: error.message };
}
