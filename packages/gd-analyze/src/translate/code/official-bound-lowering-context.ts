import type { GodotNativeTypePart } from './native-types';
import type { BoundGodotCallReceiver } from '../../analyze/call-receivers';
import { builtinDatatype } from '../../analyze/refined-types';
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
  GodotCodeRuleEntry,
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
import type { TargetTsExpression, TargetTsSpan, TargetTsType } from './target-ts-syntax';

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

/** Every refusal one script's lowering recorded (`LoweringContext.recover`), reported together. */
export class BoundLoweringRefusals extends Error {
  constructor(readonly refusals: readonly BoundLoweringRefusal[]) {
    super(refusals.map((refusal) => refusal.message).join('\n'));
    this.name = 'BoundLoweringRefusals';
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
  /** An indexed property's accessor: the index it takes after the receiver (`ADD_PROPERTYI`). */
  readonly index?: number;
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
  'cast',
  'dictionary-object-literal',
  'get-node',
  'lambda',
  'literal',
  'local-identifier',
  'preload',
  'stringify',
  'member-identifier',
  'self',
  'subscript-attribute',
  'subscript-element',
  'ternary',
  'type-default',
  'type-test',
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
  /** An indexed property's index (`ADD_PROPERTYI`), which its accessors take before the value. */
  readonly index?: number;
  /** The property's Variant type as the API dump states it (`Vector2`, `float`). */
  readonly type?: string;
}

/** A native class's property, found up the ancestry the API dump states, or undefined. */
/** Whether this script's chain has @onready fields, as `@implicit_ready` needs it. */
export interface ImplicitReadyChain {
  /** This script or a script ancestor declares an @onready field. */
  readonly self: boolean;
  /** The immediate script base does, so its `$implicit_ready` runs first. */
  readonly base: boolean;
  /** A script ancestor defines `_ready`. */
  readonly ancestorDefinesReady: boolean;
}

export type NativePropertyLookup = (className: string, property: string) => NativeProperty | undefined;

/** A native class's method, found up the ancestry the API dump states, or undefined. */
export type NativeMethodLookup = (className: string, method: string) => NativePropertyAccessor | undefined;

/** A native class's integer constant or enum value, up the ancestry, or undefined. */
export type NativeConstantLookup = (className: string, name: string) => number | undefined;

/** A datatype rule's target naming "the class generated for this script datatype". */
export const SCRIPT_CLASS_TYPE = '$ScriptClass';

/** A datatype rule's target naming "the type compat's modules take for this engine class" (`native-types.ts`). */
export const NATIVE_CLASS_TYPE = '$NativeClass';

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
    readonly implicitReady?: ImplicitReadyChain,
    /** The generated class a project script's datatype names, and where to import it from. */
    readonly scriptClass?: (
      resPath: string,
    ) => { readonly name: string; readonly module?: string } | undefined,
    readonly nativeConstants?: NativeConstantLookup,
    /** The native class the script's chain extends, when it does. */
    readonly nativeBase?: string,
    readonly nativeMethods?: NativeMethodLookup,
    /** The member variables a project script and its script ancestors declare. */
    readonly scriptMembers?: (resPath: string) => ReadonlySet<string> | undefined,
    /** The AnimationTree a scene node expression holds in each scene, with its parameters, where its graph is known. */
    readonly treeParameters?: (nodeId: number) => readonly { readonly at: string; readonly parameters: ReadonlySet<string> }[],
    /** The scene component a project scene's resource path is written as, and where to import it from. */
    readonly packedScene?: (resPath: string) => { readonly name: string; readonly module: string } | undefined,
    /** The parts of an engine class's TS type (`native-types.ts`), most derived first. */
    readonly nativeType?: (className: string) => readonly GodotNativeTypePart[],
    /** The nodes whose datatype `is T` narrowing gave (`type-test-narrowing`). */
    readonly narrowedNodes: ReadonlySet<number> = new Set(),
    /** Calls lowered to a switch over the project scripts that declare the method (`call-receivers.ts`). */
    readonly scriptSwitches: ReadonlyMap<number, readonly string[]> = new Map(),
    /** The engine class up a class's chain that declares a signal of this name. */
    readonly nativeSignalOwner?: (className: string, signal: string) => string | undefined,
    /** Variables holding an int or a float, as tagged numbers (`numeric-variant`). */
    readonly numericVariants?: {
      readonly variables: readonly number[];
      readonly taggedArguments: readonly { readonly callId: number; readonly indexes: readonly number[] }[];
      readonly evidenceClaimId: string;
    },
    /** Godot's operator table: the result type of `left op right` (right absent for a unary). */
    readonly operatorResult?: (left: string, operator: number, right: string | undefined) => string | undefined,
  ) {
    this.#numericVariables = new Set(numericVariants?.variables ?? []);
    for (const entry of numericVariants?.taggedArguments ?? []) {
      const call = script.nodes[entry.callId];
      if (call?.kind !== 'CALL') continue;
      for (const index of entry.indexes) {
        const argument = call.arguments[index];
        if (argument !== undefined) this.#taggedArguments.set(argument, entry.callId);
      }
    }
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

  #returnType: GodotBoundNode | undefined;

  /** The declared return type of the function being lowered, if it declares one. */
  get returnType(): GodotBoundNode | undefined {
    return this.#returnType;
  }

  withReturnType<Result>(returnType: GodotBoundNode | undefined, operation: () => Result): Result {
    const outer = this.#returnType;
    this.#returnType = returnType;
    try {
      return operation();
    } finally {
      this.#returnType = outer;
    }
  }

  nativeConstant(className: string, name: string): number | undefined {
    return this.nativeConstants?.(className, name);
  }

  nativeMethod(className: string, method: string): NativePropertyAccessor | undefined {
    return this.nativeMethods?.(className, method);
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
    const override = this.#overrides.get(id);
    if (override !== undefined) return { ...node, datatype: override.datatype } as GodotBoundNode;
    const types = this.numericTypes(node);
    if (types === undefined) return node;
    if (types.size > 1) {
      // Only the switches over the tag take a tagged number; a tagged argument passes on to a
      // tagged parameter as it is.
      if (this.#taggedArguments.get(id) === owner.id && owner.kind === 'CALL') return node;
      this.refuse(
        node,
        `this value is an int or a float (${node.kind === 'IDENTIFIER' ? `the untyped \`${node.name}\` holds both` : 'an operation on such a variable'}), and ${owner.kind} does not switch over the two`,
      );
    }
    const [type] = types;
    if (type === undefined || type === 'unknown') this.refuse(node, 'an operation on an int-or-float variable that the operator table does not type');
    return { ...node, datatype: builtinDatatype(type) } as GodotBoundNode;
  }

  /** An official node as the bound program holds it, bypassing the int-or-float checks. */
  rawNode(id: number, owner: GodotBoundNode): GodotBoundNode {
    const node = id < 0 ? undefined : this.script.nodes[id];
    if (node === undefined) this.refuse(owner, `official bound node ${String(id)} is missing`);
    const override = this.#overrides.get(id);
    return override === undefined ? node : ({ ...node, datatype: override.datatype } as GodotBoundNode);
  }

  readonly #numericVariables: ReadonlySet<number>;
  readonly #taggedArguments = new Map<number, number>();
  readonly #overrides = new Map<number, { readonly datatype: GodotBoundNode['datatype']; readonly value: TargetTsExpression }>();

  /** Whether a VARIABLE, PARAMETER or IDENTIFIER is an int-or-float variable. */
  isNumericVariable(node: GodotBoundNode): boolean {
    return this.#numericVariables.has(node.id) && !this.#overrides.has(node.id);
  }

  /** The call a node is a tagged argument of (it reaches a tagged parameter). */
  taggedArgumentCall(node: GodotBoundNode): number | undefined {
    return this.#taggedArguments.get(node.id);
  }

  /** The value a switch branch substitutes for an operand. */
  overrideValue(node: GodotBoundNode): TargetTsExpression | undefined {
    return this.#overrides.get(node.id)?.value;
  }

  /** Lowers `operation` with operands read as the given types and values (one switch branch). */
  withOverrides<Result>(
    overrides: ReadonlyMap<number, { readonly datatype: GodotBoundNode['datatype']; readonly value: TargetTsExpression }>,
    operation: () => Result,
  ): Result {
    const saved = new Map([...overrides.keys()].map((id) => [id, this.#overrides.get(id)] as const));
    for (const [id, entry] of overrides) this.#overrides.set(id, entry);
    try {
      return operation();
    } finally {
      for (const [id, entry] of saved) {
        if (entry === undefined) this.#overrides.delete(id);
        else this.#overrides.set(id, entry);
      }
    }
  }

  /**
   * The built-in types a value may have when an int-or-float variable reaches it: {int, float} for
   * the variable, an operator's results over its operands' (Godot's operator table), `String` for
   * `str()` of one; undefined where no such variable reaches. `unknown` marks a combination the
   * table does not type.
   */
  numericTypes(node: GodotBoundNode): ReadonlySet<string> | undefined {
    if (this.#numericVariables.size === 0) return undefined;
    const override = this.#overrides.get(node.id);
    if (override !== undefined) {
      const type = override.datatype.kind === 'ENUM' ? 'int' : override.datatype.builtinType;
      return new Set([type]);
    }
    if (node.kind === 'IDENTIFIER') return this.#numericVariables.has(node.id) ? new Set(['int', 'float']) : undefined;
    const own = (child: GodotBoundNode): ReadonlySet<string> =>
      this.numericTypes(child) ?? new Set([child.datatype.kind === 'ENUM' ? 'int' : child.datatype.kind === 'BUILTIN' ? child.datatype.builtinType : 'unknown']);
    if (node.kind === 'BINARY_OPERATOR' || node.kind === 'UNARY_OPERATOR') {
      const children = (node.kind === 'BINARY_OPERATOR' ? [node.leftOperand, node.rightOperand] : [node.operand]).map((id) => this.script.nodes[id]);
      if (children.some((child) => child === undefined)) return undefined;
      if (!children.some((child) => this.numericTypes(child as GodotBoundNode) !== undefined)) return undefined;
      const [left, right] = children.map((child) => own(child as GodotBoundNode));
      const results = new Set<string>();
      for (const l of left as ReadonlySet<string>) {
        for (const r of right ?? new Set<string | undefined>([undefined])) {
          results.add(this.operatorResult?.(l, node.variantOperatorId, r) ?? 'unknown');
        }
      }
      return results;
    }
    if (node.kind === 'CALL' && node.functionName === 'str' && node.compilerTarget.kind === 'variant-utility') {
      return node.arguments.some((id) => {
        const argument = this.script.nodes[id];
        return argument !== undefined && this.numericTypes(argument) !== undefined;
      })
        ? new Set(['String'])
        : undefined;
    }
    return undefined;
  }

  /** The analysis claim an int-or-float lowering rests on. */
  numericRequirement(): OfficialBoundLoweringRequirement {
    const claimId = this.numericVariants?.evidenceClaimId;
    if (claimId === undefined) throw new Error('numeric variants lowered without their claim');
    return { kind: 'evidence-requirement', layer: 'analysis', claimId, canonicalIdentity: `${this.sourceRevision}\0analyze\0numeric-variant` };
  }

  refuse(node: GodotBoundNode, message: string): never {
    throw new BoundLoweringRefusal(this.script, node, message);
  }

  readonly #refusals: BoundLoweringRefusal[] = [];

  /** The refusals `recover` recorded, in source order of discovery. */
  get refusals(): readonly BoundLoweringRefusal[] {
    return this.#refusals;
  }

  /**
   * Lowers one statement or member, or records its refusal and yields `fallback`, so a refused
   * script reports every refusal it holds rather than its first. A script with any recorded
   * refusal is still refused whole; the fallback only lets the rest of it be read.
   */
  recover<T>(fallback: T, lower: () => T): T {
    try {
      return lower();
    } catch (error) {
      if (!(error instanceof BoundLoweringRefusal)) throw error;
      this.#refusals.push(error);
      return fallback;
    }
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
  /**
   * Why an operand is untyped, when the cause is an untyped local its function assigns values of
   * more than one type (`var d = sign(x)` then `d = ... else 1`): no single type fixes it, so no
   * rule for one type applies. Looks through the operands and their own operands.
   */
  untypedLocalCause(inputNodes: readonly GodotBoundNode[]): string | undefined {
    // An input analysis named the cause of (an exported node reference no scene settles).
    for (const input of inputNodes) {
      const named = input.kind === 'CALL' ? undefined : this.untypedCalls.get(input.id);
      if (named !== undefined) return named;
    }
    const nodes = this.script.nodes;
    const typeName = (datatype: GodotBoundNode['datatype']): string | undefined =>
      datatype.kind === 'BUILTIN' ? datatype.builtinType : datatype.kind === 'NATIVE' ? datatype.nativeType : datatype.kind === 'ENUM' ? 'int' : undefined;
    // The types a value may have: a ternary's two branches, else its own datatype.
    const valueTypes = (id: number): (string | undefined)[] => {
      const value = nodes[id];
      if (value === undefined) return [undefined];
      if (value.kind === 'TERNARY_OPERATOR') return [...valueTypes(value.trueExpression), ...valueTypes(value.falseExpression)];
      // A Variant-returning call (`sign(x)`) is named by its function: its type is decided at run time.
      if (value.kind === 'CALL' && value.datatype.kind === 'VARIANT') return [`Variant (from ${value.functionName}())`];
      return [typeName(value.datatype) ?? value.datatype.display];
    };
    const within = (inner: GodotBoundNode, outer: GodotBoundNode) => inner.startLine >= outer.startLine && inner.endLine <= outer.endLine;
    const visit = (node: GodotBoundNode, depth: number): string | undefined => {
      if (node.kind === 'IDENTIFIER' && node.source === 'LOCAL_VARIABLE' && node.datatype.kind === 'VARIANT') {
        const scope = nodes.find((candidate) => candidate.kind === 'FUNCTION' && within(node, candidate));
        if (scope === undefined) return undefined;
        const types: (string | undefined)[] = [];
        for (const candidate of nodes) {
          if (!within(candidate, scope)) continue;
          if (candidate.kind === 'VARIABLE') {
            const identifier = nodes[candidate.identifier];
            if (identifier?.kind === 'IDENTIFIER' && identifier.name === node.name && candidate.initializer >= 0) types.push(...valueTypes(candidate.initializer));
          } else if (candidate.kind === 'ASSIGNMENT') {
            const assignee = nodes[candidate.assignee];
            if (assignee?.kind === 'IDENTIFIER' && assignee.name === node.name) types.push(...valueTypes(candidate.assignedValue));
          }
        }
        const distinct = [...new Set(types.filter((type): type is string => type !== undefined))].sort();
        if (distinct.length > 1) {
          return `the untyped local \`${node.name}\` is assigned ${distinct.join(' and ')} values, so no one type fixes it and no rule for one type applies`;
        }
        return undefined;
      }
      if (depth === 0) return undefined;
      const children =
        node.kind === 'BINARY_OPERATOR' ? [node.leftOperand, node.rightOperand] : node.kind === 'UNARY_OPERATOR' ? [node.operand] : [];
      for (const child of children) {
        const found = nodes[child];
        const cause = found === undefined ? undefined : visit(found, depth - 1);
        if (cause !== undefined) return cause;
      }
      return undefined;
    };
    for (const input of inputNodes) {
      const cause = visit(input, 2);
      if (cause !== undefined) return cause;
    }
    return undefined;
  }

  selectRule(
    node: GodotBoundNode,
    semanticKeys: readonly string[],
    inputNodes: readonly GodotBoundNode[],
    expected: readonly GodotCodeRuleRecipe['kind'][],
    includeResultDatatype = true,
    ownAnnotations = true,
  ): OfficialBoundRuleUse {
    const semanticKey = semanticKeys[0] as string;
    const annotations = (ownAnnotations ? node.annotations : []).map((id) => {
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
    // A rule may hold for an annotation whatever its arguments (`@export_range:…:*`): the
    // arguments of an editor-facing annotation carry no runtime meaning.
    const anyArguments = annotations.map((entry) => entry.replace(/^([^:]*:[^:]*:[^:]*):.*$/, '$1:*'));
    const identityFor = (key: string, list: readonly string[]): GodotCodeRuleIdentity => ({
      sourceRevision: this.sourceRevision,
      nodeKind: node.kind,
      semanticKey: `${key}|annotations:[${list.join(',')}]`,
      inputDatatypes: inputNodes.map((input) => godotBoundDatatypeIdentity(input.datatype)),
      resultDatatype: includeResultDatatype ? godotBoundDatatypeIdentity(node.datatype) : '',
    });
    const identity = identityFor(semanticKey, annotations);
    let entry: GodotCodeRuleEntry | undefined;
    for (const key of semanticKeys) {
      entry = this.rules.rule(identityFor(key, annotations));
      if (entry === undefined && annotations.length > 0) {
        entry = this.rules.rule(identityFor(key, anyArguments));
      }
      if (entry !== undefined) break;
    }
    if (entry === undefined) {
      const cause = this.untypedLocalCause(inputNodes);
      this.refuse(
        node,
        cause ?? `no evidenced code rule for ${node.kind}:${semanticKey}; identity=${JSON.stringify(identity)}`,
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
    if ((node.kind === 'VARIABLE' || node.kind === 'PARAMETER') && this.#numericVariables.has(node.id)) {
      // An int-or-float variable holds compat's tagged number (`numeric.ts`).
      return {
        type: { kind: 'type-reference', name: 'GodotNumeric', arguments: [] },
        requirements: [
          { kind: 'compat-import-requirement', module: 'lib/godot-compat/numeric', imported: 'GodotNumeric', local: 'GodotNumeric', typeOnly: true },
          this.numericRequirement(),
        ],
      };
    }
    const entry = this.rules.datatype(node.datatype);
    if (entry === undefined) {
      this.refuse(
        node,
        `no evidenced datatype rule for ${node.datatype.display}; identity=${godotBoundDatatypeIdentity(node.datatype)}`,
      );
    }
    this.prove(node, entry.evidenceClaimId, 'translate-code', godotDatatypeRuleKey(entry));
    if (entry.targetType.kind === 'type-reference' && entry.targetType.name === SCRIPT_CLASS_TYPE) {
      // A script-class datatype names the class generated for that script.
      const found =
        node.datatype.kind === 'CLASS' ? this.scriptClass?.(node.datatype.scriptPath) : undefined;
      if (found === undefined) {
        this.refuse(node, `datatype ${node.datatype.display} names no generated script class`);
      }
      return {
        type: { kind: 'type-reference', name: found.name, arguments: [] },
        requirements: [
          {
            kind: 'evidence-requirement',
            layer: 'language',
            claimId: entry.evidenceClaimId,
            canonicalIdentity: godotDatatypeRuleKey(entry),
          },
          ...(found.module === undefined
            ? []
            : [
                {
                  kind: 'project-import-requirement' as const,
                  module: found.module,
                  imported: found.name,
                  local: found.name,
                  typeOnly: true,
                },
              ]),
        ],
      };
    }
    if (entry.targetType.kind === 'type-reference' && entry.targetType.name === NATIVE_CLASS_TYPE) {
      // An engine-class datatype is the type compat's modules take for that class and its ancestors.
      const evidence: OfficialBoundLoweringRequirement = {
        kind: 'evidence-requirement',
        layer: 'language',
        claimId: entry.evidenceClaimId,
        canonicalIdentity: godotDatatypeRuleKey(entry),
      };
      if (node.datatype.kind !== 'NATIVE' || node.datatype.nativeType === '' || this.nativeType === undefined) {
        this.refuse(node, `datatype ${node.datatype.display} names no engine class type`);
      }
      const parts = this.nativeType(node.datatype.nativeType);
      if (parts.length === 0) return { type: { kind: 'keyword-type', keyword: 'object' }, requirements: [evidence] };
      const local = (part: GodotNativeTypePart) => `$Native_${part.exportName}`;
      const references: TargetTsType[] = parts.map((part) => ({ kind: 'type-reference', name: local(part), arguments: [] }));
      return {
        type: references.length === 1 ? (references[0] as TargetTsType) : { kind: 'intersection-type', members: references },
        requirements: [
          evidence,
          ...parts.map((part): OfficialBoundLoweringRequirement =>
            part.compat
              ? { kind: 'compat-import-requirement', module: part.module, imported: part.exportName, local: local(part), typeOnly: true }
              : { kind: 'project-import-requirement', module: part.module, imported: part.exportName, local: local(part), typeOnly: true },
          ),
        ],
      };
    }
    if (entry.sourceDatatype === 'BUILTIN:Array[*]' && node.datatype.containerTypes.length === 1) {
      // A typed array is an array of its element type, where a rule states that type.
      const element = { ...node, datatype: node.datatype.containerTypes[0] as GodotBoundNode['datatype'] } as GodotBoundNode;
      if (this.hasTargetType(element)) {
        const inner = this.targetType(element);
        return {
          type: { kind: 'array-type', element: inner.type },
          requirements: [
            { kind: 'evidence-requirement', layer: 'language', claimId: entry.evidenceClaimId, canonicalIdentity: godotDatatypeRuleKey(entry) },
            ...inner.requirements,
          ],
        };
      }
    }
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

  /** Whether a datatype rule states the node's datatype as a TS type. */
  hasTargetType(node: GodotBoundNode): boolean {
    return this.rules.datatype(node.datatype) !== undefined;
  }

    /** Whether the node's datatype is one an `is T` test narrowed it to. */
  narrowed(node: GodotBoundNode): boolean {
    return this.narrowedNodes.has(node.id);
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
