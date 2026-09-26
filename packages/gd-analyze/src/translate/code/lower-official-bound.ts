import * as path from 'node:path';
import type {
  BoundGodotLifecycleEntry,
  BoundGodotProject,
  BoundGodotScriptAttachment,
  BoundGodotScriptAutoload,
  BoundGodotScriptField,
  BoundGodotSourceScript,
} from '../../analyze/bound-project';
import type { GodotApiDump } from '../../analyze/api-dump';
import type { GodotBoundNode, GodotBoundScript } from '../../godot-frontend/bound-program';
import { safeIdent } from '../target-names';
import type { GodotCodeEvidenceResolver } from './authority';
import {
  type GodotCodeTranslationAuthority,
  GodotCodeTranslationAuthorityResolver,
} from './authority';
import { type GodotBindingResolver, godotOfficialSymbolKey } from './bindings';
import { lowerOfficialClassMembers } from './lower-official-statement';
import type { GodotCodeRuleResolver } from './lowering-rules';
import {
  BoundLoweringRefusal,
  LoweringContext,
  type OfficialBoundAutoloadCandidate,
  type OfficialBoundAutoloadReference,
  type OfficialBoundLoweringDiagnostic,
  type ImplicitReadyChain,
  type NativeConstantLookup,
  type NativeMethodLookup,
  type NativePropertyAccessor,
  type NativePropertyLookup,
  type OfficialBoundLoweringRequirement,
  officialBoundDiagnostic,
  officialBoundSpan,
} from './official-bound-lowering-context';
import {
  TARGET_TS_SYNTAX_VERSION,
  type TargetTsClassMember,
  type TargetTsImportBinding,
  type TargetTsSourceFile,
  type TargetTsStatement,
} from './target-ts-syntax';

export type { OfficialBoundLoweringDiagnostic } from './official-bound-lowering-context';

export interface OfficialBoundCodePlan {
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly sourceFiles: readonly TargetTsSourceFile[];
  readonly scriptModules: readonly OfficialBoundScriptModulePlan[];
  readonly analysisEvidenceClaimIds: readonly string[];
  readonly languageEvidenceClaimIds: readonly string[];
  readonly bindingEvidenceClaimIds: readonly string[];
  readonly requiredCompatSymbols: readonly string[];
  readonly semanticClaimRegistryDigest: string;
}

/** Composition-facing identity for one generated class; bodies remain TargetTsSyntax only. */
export interface OfficialBoundScriptModulePlan {
  readonly resPath: string;
  readonly sourceDigest: string;
  readonly sourcePath: string;
  readonly className: string;
  readonly engineBase?: string;
  readonly nativeCarrier: boolean;
  readonly attachments: readonly BoundGodotScriptAttachment[];
  readonly autoloads: readonly BoundGodotScriptAutoload[];
  readonly lifecycle: readonly BoundGodotLifecycleEntry[];
  readonly fields: readonly BoundGodotScriptField[];
  readonly autoloadReferences: readonly OfficialBoundAutoloadReference[];
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
}

export type OfficialBoundCodeResult =
  | { readonly kind: 'accepted-code'; readonly plan: OfficialBoundCodePlan }
  | {
      readonly kind: 'refused-code';
      readonly diagnostics: readonly OfficialBoundLoweringDiagnostic[];
    };

interface ImportDemand {
  readonly module: string;
  readonly imported: string;
  readonly local: string;
  readonly typeOnly: boolean;
}

interface ClosedOfficialBoundRequirements {
  readonly requirements: readonly OfficialBoundLoweringRequirement[];
  readonly imports: readonly ImportDemand[];
  readonly autoloadReferences: readonly OfficialBoundAutoloadReference[];
  readonly analysisEvidenceClaimIds: readonly string[];
  readonly languageEvidenceClaimIds: readonly string[];
  readonly bindingEvidenceClaimIds: readonly string[];
  readonly requiredCompatSymbols: readonly string[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive closed requirement union
function mergeOfficialBoundRequirements(
  context: LoweringContext,
  owner: GodotBoundNode,
  requirements: readonly OfficialBoundLoweringRequirement[],
  moduleDeclarations: readonly string[],
  sourcePath: string,
): ClosedOfficialBoundRequirements {
  const bindings = new Map<
    string,
    Extract<OfficialBoundLoweringRequirement, { kind: 'binding-requirement' }>
  >();
  const evidence = new Map<
    string,
    Extract<OfficialBoundLoweringRequirement, { kind: 'evidence-requirement' }>
  >();
  const autoloads = new Map<string, OfficialBoundAutoloadReference>();
  const projectImports = new Map<
    string,
    Extract<OfficialBoundLoweringRequirement, { kind: 'project-import-requirement' }>
  >();
  const compatImports = new Map<
    string,
    Extract<OfficialBoundLoweringRequirement, { kind: 'compat-import-requirement' }>
  >();
  const importsByLocal = new Map<string, ImportDemand>();
  const bindingEvidence = new Set<string>();
  const compatSymbols = new Set<string>();

  const addImport = (demand: ImportDemand): void => {
    if (moduleDeclarations.includes(demand.local)) {
      context.refuse(
        owner,
        `target import local ${demand.local} collides with a module declaration`,
      );
    }
    const prior = importsByLocal.get(demand.local);
    if (prior === undefined) {
      importsByLocal.set(demand.local, demand);
      return;
    }
    if (prior.module !== demand.module || prior.imported !== demand.imported) {
      context.refuse(
        owner,
        `target import local ${demand.local} selects both ${prior.module}:${prior.imported} and ${demand.module}:${demand.imported}`,
      );
    }
    importsByLocal.set(demand.local, {
      ...prior,
      typeOnly: prior.typeOnly && demand.typeOnly,
    });
  };

  for (const requirement of requirements) {
    switch (requirement.kind) {
      case 'binding-requirement': {
        const key = godotOfficialSymbolKey(requirement.symbol);
        const prior = bindings.get(key);
        if (prior !== undefined && !sameValue(prior.target, requirement.target)) {
          context.refuse(owner, `${key}: one official symbol selected conflicting target bindings`);
        }
        bindings.set(key, requirement);
        addImport({
          module:
            requirement.target.kind === 'compat-binding'
              ? compatModuleSpecifier(sourcePath, requirement.target.module)
              : requirement.target.module,
          imported: requirement.target.exportName,
          local: requirement.target.localName,
          typeOnly: false,
        });
        bindingEvidence.add(requirement.target.evidenceClaimId);
        if (requirement.target.kind === 'compat-binding') {
          compatSymbols.add(requirement.target.exportName);
        }
        break;
      }
      case 'evidence-requirement': {
        const prior = evidence.get(requirement.claimId);
        if (prior !== undefined && !sameValue(prior, requirement)) {
          context.refuse(owner, `${requirement.claimId}: semantic claim has conflicting uses`);
        }
        evidence.set(requirement.claimId, requirement);
        break;
      }
      case 'autoload-reference-requirement': {
        const prior = autoloads.get(requirement.reference.name);
        if (prior !== undefined && !sameValue(prior, requirement.reference)) {
          context.refuse(
            owner,
            `${requirement.reference.name}: autoload resolves to conflicting scripts`,
          );
        }
        autoloads.set(requirement.reference.name, requirement.reference);
        if (requirement.reference.typeImport !== undefined) {
          addImport({ ...requirement.reference.typeImport, typeOnly: true });
        }
        break;
      }
      case 'compat-import-requirement': {
        const key = `${requirement.module}\0${requirement.imported}\0${requirement.local}`;
        const prior = compatImports.get(key);
        compatImports.set(key, {
          ...requirement,
          typeOnly: (prior?.typeOnly ?? true) && requirement.typeOnly,
        });
        addImport({ ...requirement, module: compatModuleSpecifier(sourcePath, requirement.module) });
        break;
      }
      case 'project-import-requirement': {
        const key = `${requirement.module}\0${requirement.imported}\0${requirement.local}`;
        const prior = projectImports.get(key);
        projectImports.set(key, {
          ...requirement,
          typeOnly: (prior?.typeOnly ?? true) && requirement.typeOnly,
        });
        addImport(requirement);
        break;
      }
      default:
        requirement satisfies never;
    }
  }

  const sorted = <Value>(values: Iterable<Value>, identity: (value: Value) => string) =>
    [...values].sort((left, right) => identity(left).localeCompare(identity(right)));
  return {
    requirements: [
      ...sorted(bindings.values(), (entry) => godotOfficialSymbolKey(entry.symbol)),
      ...sorted(evidence.values(), (entry) => entry.claimId),
      ...sorted(autoloads.values(), (entry) => entry.name).map(
        (reference): OfficialBoundLoweringRequirement => ({
          kind: 'autoload-reference-requirement',
          reference,
        }),
      ),
      ...sorted(compatImports.values(), (entry) => `${entry.module}\0${entry.local}`),
      ...sorted(projectImports.values(), (entry) => `${entry.module}\0${entry.local}`),
    ],
    imports: sorted(importsByLocal.values(), (entry) => `${entry.module}\0${entry.local}`),
    autoloadReferences: sorted(autoloads.values(), (entry) => entry.name),
    analysisEvidenceClaimIds: sorted(
      [...evidence.values()]
        .filter((entry) => entry.layer === 'analysis')
        .map((entry) => entry.claimId),
      (entry) => entry,
    ),
    languageEvidenceClaimIds: sorted(
      [...evidence.values()]
        .filter((entry) => entry.layer === 'language')
        .map((entry) => entry.claimId),
      (entry) => entry,
    ),
    bindingEvidenceClaimIds: sorted(bindingEvidence, (entry) => entry),
    requiredCompatSymbols: sorted(compatSymbols, (entry) => entry),
  };
}

function imports(demands: readonly ImportDemand[]): readonly TargetTsStatement[] {
  const grouped = new Map<
    string,
    {
      readonly module: string;
      readonly typeOnly: boolean;
      readonly bindings: TargetTsImportBinding[];
    }
  >();
  for (const demand of demands) {
    const key = `${demand.typeOnly ? 'type' : 'value'}\0${demand.module}`;
    const group = grouped.get(key) ?? {
      module: demand.module,
      typeOnly: demand.typeOnly,
      bindings: [],
    };
    group.bindings.push({ imported: demand.imported, local: demand.local });
    grouped.set(key, group);
  }
  return [...grouped.values()].map(({ module, typeOnly, bindings: namedBindings }) => ({
    kind: 'import-statement',
    module,
    namedBindings,
    ...(typeOnly ? { typeOnly: true as const } : {}),
  }));
}

/**
 * A compat module (`lib/godot-compat/vector3`, relative to the project's `src/`) as the module
 * specifier the generated script at `src/scripts/<sourcePath>` imports it by.
 */
function compatModuleSpecifier(sourcePath: string, module: string): string {
  const relative = path.posix.relative(path.posix.dirname(`scripts/${sourcePath}`), module);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function fileName(resPath: string): string {
  return `${resPath.slice('res://'.length).replace(/\.gd$/i, '')}.ts`;
}

function scriptModule(fromResPath: string, targetResPath: string): string {
  const from = fileName(fromResPath);
  const target = fileName(targetResPath).replace(/\.ts$/, '');
  let relative = path.posix.relative(path.posix.dirname(from), target);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function safeClassName(candidate: string): string {
  const safe = candidate.replace(/[^A-Z_a-z0-9$]/g, '_');
  return safeIdent(/^[A-Z_a-z$]/.test(safe) ? safe : `Godot_${safe}`);
}

/** Preserve the official class identity; unnamed script classes use their module basename. */
function className(source: BoundGodotSourceScript): string {
  if (source.class.fqcn !== '') return safeClassName(source.class.fqcn);
  const base = source.resPath.split('/').at(-1)?.replace(/\.gd$/i, '') ?? 'GodotScript';
  return safeClassName(base);
}

function projectClassName(project: BoundGodotProject, resPath: string): string {
  const source = project.scripts.find((entry) => entry.resPath === resPath);
  if (source === undefined) throw new Error(`${resPath}: bound base script is missing`);
  return className(source);
}

function rootScriptPath(source: BoundGodotSourceScript): string {
  return source.inheritance.scriptAncestors.at(-1) ?? source.resPath;
}

function nativeCarrierRoot(
  project: BoundGodotProject,
  source: BoundGodotSourceScript,
): string | undefined {
  const rootPath = rootScriptPath(source);
  const root = project.scripts.find((entry) => entry.resPath === rootPath);
  if (root?.inheritance.immediate.kind !== 'native') return undefined;
  const used = project.scripts.some(
    (candidate) =>
      rootScriptPath(candidate) === rootPath &&
      (candidate.attachments.length > 0 || candidate.autoloads.length > 0),
  );
  return used ? rootPath : undefined;
}

function nativeCarrierMembers(): readonly TargetTsClassMember[] {
  const native = { kind: 'identifier-expression', name: 'native' } as const;
  return [
    {
      kind: 'field-member',
      name: '$native',
      modifiers: ['readonly'],
      type: { kind: 'keyword-type', keyword: 'object' },
    },
    {
      kind: 'constructor-member',
      parameters: [{ name: 'native', type: { kind: 'keyword-type', keyword: 'object' } }],
      body: [
        {
          kind: 'expression-statement',
          expression: {
            kind: 'assignment-expression',
            operator: '=',
            target: {
              kind: 'property-expression',
              object: { kind: 'this-expression' },
              property: '$native',
            },
            value: native,
          },
        },
      ],
    },
  ];
}

function autoloadCandidates(
  project: BoundGodotProject,
  source: BoundGodotSourceScript,
): ReadonlyMap<number, OfficialBoundAutoloadCandidate> {
  const result = new Map<number, OfficialBoundAutoloadCandidate>();
  for (const reference of source.singletonReferences) {
    const target = project.scripts.find((script) => script.resPath === reference.resPath);
    if (target === undefined) {
      throw new Error(`${source.resPath}: bound singleton target is absent: ${reference.resPath}`);
    }
    if (result.has(reference.nodeId)) {
      throw new Error(
        `${source.resPath}: bound singleton node repeats: ${String(reference.nodeId)}`,
      );
    }
    result.set(reference.nodeId, {
      nodeId: reference.nodeId,
      name: reference.name,
      resPath: reference.resPath,
      sourceClassName: reference.className,
      targetClassName: className(target),
      module: scriptModule(source.resPath, target.resPath),
      evidenceClaimId: reference.evidenceClaimId,
      canonicalIdentity: reference.canonicalIdentity,
    });
  }
  return result;
}

function autoloadReferenceMembers(
  references: readonly OfficialBoundAutoloadReference[],
): readonly TargetTsClassMember[] {
  return references.map((reference) => ({
    kind: 'field-member',
    name: reference.fieldName,
    type: { kind: 'type-reference', name: reference.typeLocalName, arguments: [] },
    definite: true,
  }));
}

function classMembersOf(source: BoundGodotSourceScript): readonly GodotBoundNode[] {
  const root = source.program.nodes[source.program.rootNodeId];
  if (root?.kind !== 'CLASS') return [];
  return root.members.flatMap((id) => {
    const node = source.program.nodes[id];
    return node === undefined ? [] : [node];
  });
}

function declaresOnready(source: BoundGodotSourceScript): boolean {
  return classMembersOf(source).some((node) => node.kind === 'VARIABLE' && node.onready);
}

function definesReady(source: BoundGodotSourceScript): boolean {
  return classMembersOf(source).some((node) => {
    if (node.kind !== 'FUNCTION' || node.static) return false;
    const identifier = source.program.nodes[node.identifier];
    return identifier?.kind === 'IDENTIFIER' && identifier.name === '_ready';
  });
}

/** The @onready facts of a script's chain, from its own class to its root script. */
export function implicitReadyChain(
  project: BoundGodotProject,
  source: BoundGodotSourceScript,
): ImplicitReadyChain {
  const byPath = new Map(project.scripts.map((entry) => [entry.resPath, entry] as const));
  const ancestors = source.inheritance.scriptAncestors.flatMap((resPath) => {
    const found = byPath.get(resPath);
    return found === undefined ? [] : [found];
  });
  return {
    self: declaresOnready(source) || ancestors.some(declaresOnready),
    base: ancestors.some(declaresOnready),
    ancestorDefinesReady: ancestors.some(definesReady),
  };
}

/**
 * The official program with the Variant values analysis typed from project facts
 * (`project-setting-type`) given that built-in type, so lowering selects rules and bindings for the
 * value the call returns at run time. Every other node is the official frontend's, unchanged.
 */
function refinedProgram(source: BoundGodotSourceScript): GodotBoundScript {
  if (source.settingTypes.length === 0 && source.refinedTypes.length === 0) return source.program;
  const types = new Map(source.settingTypes.map((entry) => [entry.nodeId, entry.builtinType] as const));
  const refined = new Map(source.refinedTypes.map((entry) => [entry.nodeId, entry.datatype] as const));
  return {
    ...source.program,
    nodes: source.program.nodes.map((node) => {
      const datatype = refined.get(node.id);
      if (datatype !== undefined) return { ...node, datatype } as GodotBoundNode;
      const builtinType = types.get(node.id);
      if (builtinType === undefined) return node;
      return {
        ...node,
        datatype: {
          ...node.datatype,
          kind: 'BUILTIN',
          typeSource: 'INFERRED',
          display: builtinType,
          builtinType,
          nativeType: '',
          enumType: '',
          scriptPath: '',
          className: '',
          metaType: false,
          containerTypes: [],
          enumValues: [],
        },
      } as GodotBoundNode;
    }),
  };
}

/** The member variables a project script and its script ancestors declare, or undefined. */
function scriptMemberNames(project: BoundGodotProject, resPath: string): ReadonlySet<string> | undefined {
  const script = project.scripts.find((entry) => entry.resPath === resPath);
  if (script === undefined) return undefined;
  const names = new Set<string>();
  for (const path of [resPath, ...script.inheritance.scriptAncestors]) {
    const program = project.scripts.find((entry) => entry.resPath === path)?.program;
    const root = program?.nodes[program.rootNodeId];
    if (program === undefined || root?.kind !== 'CLASS') return undefined;
    for (const memberId of root.members) {
      const member = program.nodes[memberId];
      if (member?.kind !== 'VARIABLE' && member?.kind !== 'CONSTANT') continue;
      const identifier = program.nodes[member.identifier];
      if (identifier?.kind === 'IDENTIFIER') names.add(identifier.name);
    }
  }
  return names;
}

function lowerScript(
  project: BoundGodotProject,
  source: BoundGodotSourceScript,
  bindings: GodotBindingResolver,
  rules: GodotCodeRuleResolver,
  evidence: GodotCodeEvidenceResolver,
  nativeProperties: NativePropertyLookup | undefined,
  nativeConstants: NativeConstantLookup | undefined,
  nativeMethods: NativeMethodLookup | undefined,
): {
  readonly sourceFile: TargetTsSourceFile;
  readonly module: OfficialBoundScriptModulePlan;
  readonly requirements: ClosedOfficialBoundRequirements;
} {
  const script = refinedProgram(source);
  const root = script.nodes[script.rootNodeId];
  if (root?.kind !== 'CLASS') {
    throw new Error(`${script.resPath}: official root is not a CLASS node`);
  }
  const context = new LoweringContext(
    project.authority.revision,
    script,
    bindings,
    rules,
    evidence,
    className(source),
    autoloadCandidates(project, source),
    new Map(source.callReceivers.map((entry) => [entry.nodeId, entry] as const)),
    new Map(source.untypedCalls.map((entry) => [entry.nodeId, entry.reason] as const)),
    nativeProperties,
    implicitReadyChain(project, source),
    (resPath) => {
      const target = project.scripts.find((entry) => entry.resPath === resPath);
      if (target === undefined) return undefined;
      return resPath === source.resPath
        ? { name: className(source) }
        : { name: className(target), module: scriptModule(source.resPath, resPath) };
    },
    nativeConstants,
    nativeBaseOf(project, source),
    nativeMethods,
    (resPath) => scriptMemberNames(project, resPath),
  );
  if (root.abstract) {
    context.refuse(root, 'abstract script classes need a target declaration recipe');
  }
  if (source.inheritance.refusal !== undefined) context.refuse(root, source.inheritance.refusal);
  const classRequirements = [
    ...context.structural(root, 'class', [], 'class:concrete'),
    // The claims that typed Variant values from project facts (refinedProgram).
    ...[...new Set(source.settingTypes.flatMap((entry) => entry.evidenceClaimIds))].map(
      (claimId): OfficialBoundLoweringRequirement => ({
        kind: 'evidence-requirement',
        layer: 'analysis',
        claimId,
        canonicalIdentity: `${project.authority.revision}\0analyze\0project-setting-type`,
      }),
    ),
    // The claims that fixed datatypes the analyzer left open (refinedProgram).
    ...[...new Map(source.refinedTypes.flatMap((entry) => entry.evidenceClaimIds.map((claimId) => [claimId, entry.rule] as const)))].map(
      ([claimId, rule]): OfficialBoundLoweringRequirement => ({
        kind: 'evidence-requirement',
        layer: 'analysis',
        claimId,
        canonicalIdentity: `${project.authority.revision}\0analyze\0${rule}`,
      }),
    ),
  ];
  const base = source.inheritance.immediate;
  const carrierRoot = nativeCarrierRoot(project, source);
  const baseRequirements: readonly OfficialBoundLoweringRequirement[] =
    base.kind === 'script'
      ? [
          {
            kind: 'project-import-requirement',
            module: scriptModule(script.resPath, base.resPath),
            imported: projectClassName(project, base.resPath),
            local: projectClassName(project, base.resPath),
            typeOnly: false,
          },
        ]
      : [];
  const sourceMembers = lowerOfficialClassMembers(context, root);
  const requirements = mergeOfficialBoundRequirements(
    context,
    root,
    [...classRequirements, ...baseRequirements, ...sourceMembers.requirements],
    [className(source)],
    fileName(script.resPath),
  );
  const statement: TargetTsStatement = {
    kind: 'class-statement',
    name: className(source),
    modifiers: ['export'],
    ...(base.kind === 'script'
      ? {
          extends: {
            kind: 'identifier-expression',
            name: projectClassName(project, base.resPath),
          } as const,
        }
      : {}),
    members: [
      ...(carrierRoot === source.resPath ? nativeCarrierMembers() : []),
      ...autoloadReferenceMembers(requirements.autoloadReferences),
      ...sourceMembers.members,
    ],
    span: officialBoundSpan(script, root),
  };
  const sourcePath = fileName(script.resPath);
  return {
    sourceFile: {
      syntaxVersion: TARGET_TS_SYNTAX_VERSION,
      sourcePath,
      statements: [...imports(requirements.imports), statement],
    },
    module: {
      resPath: source.resPath,
      sourceDigest: source.sourceDigest,
      sourcePath,
      className: className(source),
      ...(source.inheritance.engineBase === undefined
        ? {}
        : { engineBase: source.inheritance.engineBase }),
      nativeCarrier: carrierRoot !== undefined,
      attachments: source.attachments,
      autoloads: source.autoloads,
      lifecycle: source.lifecycle,
      fields: source.fields,
      autoloadReferences: requirements.autoloadReferences,
      requirements: requirements.requirements,
    },
    requirements,
  };
}

function collectRequirements(
  requirements: ClosedOfficialBoundRequirements,
  analysisEvidence: Set<string>,
  languageEvidence: Set<string>,
  bindingEvidence: Set<string>,
  compatSymbols: Set<string>,
): void {
  for (const id of requirements.analysisEvidenceClaimIds) analysisEvidence.add(id);
  for (const id of requirements.languageEvidenceClaimIds) languageEvidence.add(id);
  for (const id of requirements.bindingEvidenceClaimIds) bindingEvidence.add(id);
  for (const symbol of requirements.requiredCompatSymbols) compatSymbols.add(symbol);
}

/** Direct official-bound lowering. No handwritten GDScript syntax model is imported here. */
/**
 * A native class's property and its accessor methods, found up the class ancestry the API dump
 * states (`ClassDB::get_property`, which walks `inherits`); each accessor carries the method-bind
 * hash of the class that declares it, the identity a direct call to it binds by.
 */
export function nativeMethodLookup(apiDump: GodotApiDump): NativeMethodLookup {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const builtins = new Map((apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const));
  return (className, name) => {
    for (let current = classes.get(className); current !== undefined; ) {
      const found = current.methods.find((entry) => entry.name === name);
      if (found !== undefined) return { owner: current.name, name, hash: found.hash ?? 0 };
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    // A built-in type's method (`Dictionary.get`).
    const found = builtins.get(className)?.methods.find((entry) => entry.name === name);
    return found === undefined ? undefined : { owner: className, name, hash: found.hash ?? 0 };
  };
}

export function nativePropertyLookup(apiDump: GodotApiDump): NativePropertyLookup {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const method = (className: string, name: string): NativePropertyAccessor | undefined => {
    for (let current = classes.get(className); current !== undefined; ) {
      const found = current.methods.find((entry) => entry.name === name);
      if (found !== undefined) return { owner: current.name, name, hash: found.hash ?? 0 };
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };
  return (className, property) => {
    for (let current = classes.get(className); current !== undefined; ) {
      const found = current.properties.find((entry) => entry.name === property);
      if (found !== undefined) {
        const getter = found.getter ? method(current.name, found.getter) : undefined;
        const setter = found.setter ? method(current.name, found.setter) : undefined;
        return {
          owner: current.name,
          ...(getter === undefined ? {} : { getter }),
          ...(setter === undefined ? {} : { setter }),
          ...(found.index === undefined ? {} : { index: found.index }),
        };
      }
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };
}

/** ClassDB integer constants and enum values (the dump folds enum values into constants). */
export function nativeConstantLookup(apiDump: GodotApiDump): NativeConstantLookup {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  return (className, name) => {
    for (let current = classes.get(className); current !== undefined; ) {
      const value = current.constants[name];
      if (value !== undefined) return value;
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };
}

/** The native class at the root of a script's chain. */
function nativeBaseOf(project: BoundGodotProject, source: BoundGodotSourceScript): string | undefined {
  const root = project.scripts.find((entry) => entry.resPath === rootScriptPath(source));
  return root?.inheritance.immediate.kind === 'native' ? root.inheritance.immediate.className : undefined;
}

export function lowerOfficialBoundProgram(
  project: BoundGodotProject,
  authority: GodotCodeTranslationAuthority,
  apiDump?: GodotApiDump,
): OfficialBoundCodeResult {
  const resolved = new GodotCodeTranslationAuthorityResolver(authority);
  const nativeProperties = apiDump === undefined ? undefined : nativePropertyLookup(apiDump);
  const nativeConstants = apiDump === undefined ? undefined : nativeConstantLookup(apiDump);
  const nativeMethods = apiDump === undefined ? undefined : nativeMethodLookup(apiDump);
  if (resolved.sourceRevision !== project.authority.revision) {
    throw new Error('official program and code authority must share one source revision');
  }

  const sourceFiles: TargetTsSourceFile[] = [];
  const scriptModules: OfficialBoundScriptModulePlan[] = [];
  const diagnostics: OfficialBoundLoweringDiagnostic[] = [];
  const analysisEvidence = new Set<string>();
  const languageEvidence = new Set<string>();
  const bindingEvidence = new Set<string>();
  const compatSymbols = new Set<string>();
  for (const script of project.scripts) {
    try {
      const { sourceFile, module, requirements } = lowerScript(
        project,
        script,
        resolved.bindings,
        resolved.rules,
        resolved.evidence,
        nativeProperties,
        nativeConstants,
        nativeMethods,
      );
      sourceFiles.push(sourceFile);
      scriptModules.push(module);
      collectRequirements(
        requirements,
        analysisEvidence,
        languageEvidence,
        bindingEvidence,
        compatSymbols,
      );
    } catch (error) {
      if (error instanceof BoundLoweringRefusal) diagnostics.push(officialBoundDiagnostic(error));
      else throw error;
    }
  }

  if (diagnostics.length > 0) return { kind: 'refused-code', diagnostics };
  return {
    kind: 'accepted-code',
    plan: {
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      sourceFiles,
      scriptModules,
      analysisEvidenceClaimIds: [...analysisEvidence].sort(),
      languageEvidenceClaimIds: [...languageEvidence].sort(),
      bindingEvidenceClaimIds: [...bindingEvidence].sort(),
      requiredCompatSymbols: [...compatSymbols].sort(),
      semanticClaimRegistryDigest: resolved.evidence.registryDigest,
    },
  };
}
