import type { GodotValue } from '../../read/godot-value';
import type {
  BoundGodotLifecycleEntry,
  BoundGodotProject,
  BoundGodotSceneNode,
  BoundGodotScriptAttachment,
} from '../../analyze/bound-project';
import type {
  OfficialBoundCodePlan,
  OfficialBoundScriptModulePlan,
} from '../code/lower-official-bound';
import type {
  GodotSceneDocumentPlan,
  TargetGodotSceneDocumentPlan,
  TargetGodotSceneNodePlan,
} from './scene-document-plan';
import type {
  ScriptAttachmentFieldInitializationPlan,
  ScriptFieldInitializationPlan,
  ScriptFieldValuePlan,
} from './script-field-initialization-plan';

export const DIRECT_GODOT_COMPOSITION_PLAN_VERSION = 3 as const;

export interface DirectGodotGeneratedClass {
  readonly modulePath: string;
  readonly exportName: string;
  readonly engineBase: string;
  readonly nativeCarrier: boolean;
}

export interface DirectGodotAutoloadReferencePlan {
  readonly name: string;
  readonly resPath: string;
  readonly fieldName: string;
}

export interface DirectGodotScriptInstancePlan {
  readonly scriptResPath: string;
  readonly documentPath: string;
  readonly nodePath: string;
  readonly nodeClass: string;
  readonly generatedClass: DirectGodotGeneratedClass;
  readonly fields: readonly ScriptFieldValuePlan[];
  readonly lifecycle: readonly BoundGodotLifecycleEntry[];
  readonly autoloadReferences: readonly DirectGodotAutoloadReferencePlan[];
}

export interface DirectGodotScriptAutoloadPlan {
  readonly name: string;
  readonly singleton: boolean;
  readonly scriptResPath: string;
  readonly generatedClass: DirectGodotGeneratedClass;
  readonly lifecycle: readonly BoundGodotLifecycleEntry[];
  readonly autoloadReferences: readonly DirectGodotAutoloadReferencePlan[];
}

/** Final scene ownership: the native node and its one retained script instance travel together. */
export type DirectGodotSceneNodePlan = Omit<
  TargetGodotSceneNodePlan,
  'children' | 'scriptResPath' | 'placements'
> & {
  readonly scriptInstance?: DirectGodotScriptInstancePlan;
  readonly children: readonly DirectGodotSceneNodePlan[];
  readonly placements?: readonly { readonly at: string; readonly node: DirectGodotSceneNodePlan }[];
};

export type DirectGodotSceneDocumentPlan = Omit<TargetGodotSceneDocumentPlan, 'root'> & {
  readonly root: DirectGodotSceneNodePlan;
};

export interface DirectGodotSourceModulePlan {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
}

/** A project setting's value as the translated project holds it (the compat value it builds). */
export type DirectGodotSettingValue =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'Vector2' | 'Vector3' | 'Color'; readonly components: readonly number[] };

/** A setting the project's scripts read by literal key, at the value project facts fix for it. */
export interface DirectGodotProjectSettingPlan {
  readonly key: string;
  readonly value: DirectGodotSettingValue;
}

export interface DirectGodotProjectCompositionPlan {
  readonly version: typeof DIRECT_GODOT_COMPOSITION_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly mainScene: string;
  /** The settings the world loads before any script runs. */
  readonly projectSettings: readonly DirectGodotProjectSettingPlan[];
  readonly sourceModules: readonly DirectGodotSourceModulePlan[];
  readonly scenes: readonly DirectGodotSceneDocumentPlan[];
  readonly scriptAutoloads: readonly DirectGodotScriptAutoloadPlan[];
  readonly requiredCompatSymbols: readonly string[];
  readonly evidence: {
    readonly readClaimIds: readonly string[];
    readonly analysisClaimIds: readonly string[];
    readonly codeAnalysisClaimIds: readonly string[];
    readonly languageClaimIds: readonly string[];
    readonly bindingClaimIds: readonly string[];
    readonly fieldValueClaimIds: readonly string[];
    readonly sceneClaimIds: readonly string[];
    readonly readRegistryDigest: string;
    readonly analysisRegistryDigest: string;
    readonly codeRegistryDigest: string;
    readonly fieldValueRegistryDigest: string;
    readonly sceneRegistryDigest: string;
  };
}

export interface DirectGodotCompositionDiagnostic {
  readonly at: string;
  readonly message: string;
}

export type DirectGodotCompositionResult =
  | {
      readonly kind: 'accepted-composition';
      readonly plan: DirectGodotProjectCompositionPlan;
    }
  | {
      readonly kind: 'refused-composition';
      readonly diagnostics: readonly DirectGodotCompositionDiagnostic[];
    };

function attachmentKey(scriptResPath: string, documentPath: string, nodePath: string): string {
  return `${scriptResPath}\0${documentPath}\0${nodePath}`;
}

function generatedClass(
  module: OfficialBoundScriptModulePlan,
): DirectGodotGeneratedClass | undefined {
  return module.engineBase === undefined
    ? undefined
    : {
        modulePath: `src/scripts/${module.sourcePath}`,
        exportName: module.className,
        engineBase: module.engineBase,
        nativeCarrier: module.nativeCarrier,
      };
}

function sourceModules(
  code: OfficialBoundCodePlan,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotSourceModulePlan[] {
  const sourcePaths = new Set<string>();
  for (const module of code.scriptModules) {
    if (sourcePaths.has(module.sourcePath)) {
      diagnostics.push({ at: module.resPath, message: `code plan repeats ${module.sourcePath}` });
    }
    sourcePaths.add(module.sourcePath);
  }
  return code.scriptModules.map((module) => ({
    sourceResPath: module.resPath,
    sourceDigest: module.sourceDigest,
    targetPath: `src/scripts/${module.sourcePath}`,
  }));
}

function indexFieldPlans(
  fields: ScriptFieldInitializationPlan,
  diagnostics: DirectGodotCompositionDiagnostic[],
): ReadonlyMap<string, ScriptAttachmentFieldInitializationPlan> {
  const indexed = new Map<string, ScriptAttachmentFieldInitializationPlan>();
  for (const attachment of fields.attachments) {
    const key = attachmentKey(
      attachment.scriptResPath,
      attachment.documentPath,
      attachment.nodePath,
    );
    if (indexed.has(key)) {
      diagnostics.push({
        at: `${attachment.documentPath}#${attachment.nodePath}`,
        message: `field-value plan repeats ${attachment.scriptResPath}`,
      });
    } else {
      indexed.set(key, attachment);
    }
  }
  return indexed;
}

function autoloadReferenceClosure(
  project: BoundGodotProject,
  module: OfficialBoundScriptModulePlan,
  modules: ReadonlyMap<string, OfficialBoundScriptModulePlan>,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotAutoloadReferencePlan[] {
  const source = project.scripts.find((script) => script.resPath === module.resPath);
  if (source === undefined) {
    diagnostics.push({ at: module.resPath, message: 'code module has no bound source script' });
    return [];
  }
  const references = new Map<string, DirectGodotAutoloadReferencePlan>();
  for (const resPath of [...source.inheritance.scriptAncestors, source.resPath]) {
    const owner = modules.get(resPath);
    if (owner === undefined) {
      diagnostics.push({
        at: module.resPath,
        message: `bound ancestor ${resPath} has no code module`,
      });
      continue;
    }
    for (const reference of owner.autoloadReferences) {
      const prior = references.get(reference.name);
      if (prior !== undefined && prior.resPath !== reference.resPath) {
        diagnostics.push({
          at: module.resPath,
          message: `inherited singleton ${reference.name} resolves to both ${prior.resPath} and ${reference.resPath}`,
        });
        continue;
      }
      references.set(reference.name, {
        name: reference.name,
        resPath: reference.resPath,
        fieldName: reference.fieldName,
      });
    }
  }
  return [...references.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function scriptInstance(
  module: OfficialBoundScriptModulePlan,
  attachment: BoundGodotScriptAttachment,
  fields: ReadonlyMap<string, ScriptAttachmentFieldInitializationPlan>,
  autoloadReferences: readonly DirectGodotAutoloadReferencePlan[],
  diagnostics: DirectGodotCompositionDiagnostic[],
): DirectGodotScriptInstancePlan | undefined {
  const at = `${attachment.documentPath}#${attachment.nodePath}`;
  const targetClass = generatedClass(module);
  if (targetClass === undefined || attachment.nodeClass === undefined) {
    diagnostics.push({
      at,
      message:
        targetClass === undefined
          ? `${module.resPath} has no resolved native engine base`
          : `${module.resPath} attachment has no resolved native node class`,
    });
    return undefined;
  }
  if (!targetClass.nativeCarrier) {
    diagnostics.push({ at, message: `${module.resPath} has no generated native carrier` });
    return undefined;
  }
  const key = attachmentKey(module.resPath, attachment.documentPath, attachment.nodePath);
  return {
    scriptResPath: module.resPath,
    documentPath: attachment.documentPath,
    nodePath: attachment.nodePath,
    nodeClass: attachment.nodeClass,
    generatedClass: targetClass,
    fields: fields.get(key)?.fields ?? [],
    lifecycle: module.lifecycle,
    autoloadReferences,
  };
}

function scriptInstances(
  project: BoundGodotProject,
  modules: readonly OfficialBoundScriptModulePlan[],
  modulesByPath: ReadonlyMap<string, OfficialBoundScriptModulePlan>,
  fields: ReadonlyMap<string, ScriptAttachmentFieldInitializationPlan>,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotScriptInstancePlan[] {
  const instances: DirectGodotScriptInstancePlan[] = [];
  const seen = new Set<string>();
  for (const module of modules) {
    for (const attachment of module.attachments) {
      const key = attachmentKey(module.resPath, attachment.documentPath, attachment.nodePath);
      if (seen.has(key)) {
        diagnostics.push({
          at: `${attachment.documentPath}#${attachment.nodePath}`,
          message: `code plan repeats attachment for ${module.resPath}`,
        });
        continue;
      }
      seen.add(key);
      const planned = scriptInstance(
        module,
        attachment,
        fields,
        autoloadReferenceClosure(project, module, modulesByPath, diagnostics),
        diagnostics,
      );
      if (planned !== undefined) instances.push(planned);
    }
  }
  for (const [key, fieldPlan] of fields) {
    if (seen.has(key)) continue;
    diagnostics.push({
      at: `${fieldPlan.documentPath}#${fieldPlan.nodePath}`,
      message: `field-value plan has no matching ${fieldPlan.scriptResPath} code attachment`,
    });
  }
  return instances;
}

function nodeLocationKey(documentPath: string, nodePath: string): string {
  return `${documentPath}\0${nodePath}`;
}

function validateAttachedScript(
  scene: TargetGodotSceneDocumentPlan,
  node: TargetGodotSceneNodePlan,
  instance: DirectGodotScriptInstancePlan | undefined,
  boundNode: BoundGodotSceneNode | undefined,
  diagnostics: DirectGodotCompositionDiagnostic[],
): boolean {
  const at = `${scene.sourceResPath}#${node.nodePath}`;
  if (boundNode === undefined) {
    diagnostics.push({ at, message: 'accepted scene node is absent from the bound project' });
    return false;
  }
  if (node.scriptResPath === undefined) {
    if (instance === undefined) return false;
    diagnostics.push({
      at,
      message: `${instance.scriptResPath} code attachment has no script on the scene node`,
    });
    return false;
  }
  if (instance === undefined) {
    diagnostics.push({
      at,
      message: `${node.scriptResPath} scene attachment has no generated script instance`,
    });
    return false;
  }
  if (instance.scriptResPath !== node.scriptResPath) {
    diagnostics.push({
      at,
      message: `scene attaches ${node.scriptResPath} but code plan attaches ${instance.scriptResPath}`,
    });
    return false;
  }
  if (instance.nodeClass !== boundNode.class.nativeName) {
    diagnostics.push({
      at,
      message: `script instance expects ${instance.nodeClass} but the bound node is ${boundNode.class.nativeName}`,
    });
    return false;
  }
  return true;
}

function attachScriptInstances(
  project: BoundGodotProject,
  scenes: readonly TargetGodotSceneDocumentPlan[],
  instances: readonly DirectGodotScriptInstancePlan[],
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotSceneDocumentPlan[] {
  const boundNodes = new Map(
    project.documents.scenes.flatMap((scene) =>
      scene.nodes.map((node) => [nodeLocationKey(scene.resPath, node.nodePath), node] as const),
    ),
  );
  const byLocation = new Map<string, DirectGodotScriptInstancePlan>();
  for (const instance of instances) {
    const key = nodeLocationKey(instance.documentPath, instance.nodePath);
    const prior = byLocation.get(key);
    if (prior !== undefined) {
      diagnostics.push({
        at: `${instance.documentPath}#${instance.nodePath}`,
        message: `node has both ${prior.scriptResPath} and ${instance.scriptResPath} script instances`,
      });
    } else {
      byLocation.set(key, instance);
    }
  }
  const consumed = new Set<string>();
  const attach = (
    scene: TargetGodotSceneDocumentPlan,
    node: TargetGodotSceneNodePlan,
  ): DirectGodotSceneNodePlan => {
    const key = nodeLocationKey(scene.sourceResPath, node.nodePath);
    const instance = byLocation.get(key);
    const boundNode = boundNodes.get(key);
    if (validateAttachedScript(scene, node, instance, boundNode, diagnostics)) consumed.add(key);
    const { scriptResPath: _scriptResPath, children, placements, ...nativeNode } = node;
    return {
      ...nativeNode,
      ...(instance === undefined ? {} : { scriptInstance: instance }),
      children: children.map((child) => attach(scene, child)),
      ...(placements === undefined
        ? {}
        : { placements: placements.map((placed) => ({ at: placed.at, node: attach(scene, placed.node) })) }),
    };
  };
  const result = scenes.map((scene) => ({ ...scene, root: attach(scene, scene.root) }));
  // A script attached to a node this document copied from an instanced scene, the same script
  // the instanced scene attaches there, is that scene's component's own attachment.
  const byDocument = new Map(project.documents.scenes.map((scene) => [scene.resPath, scene] as const));
  const representedByInstance = (instance: DirectGodotScriptInstancePlan): boolean => {
    const node = boundNodes.get(nodeLocationKey(instance.documentPath, instance.nodePath));
    const origin = node?.inheritedNode;
    if (origin === undefined) return false;
    const originNode = byDocument
      .get(origin.documentPath)
      ?.nodes.find((candidate) => candidate.nodePath === origin.nodePath);
    return originNode?.scriptResPath === instance.scriptResPath;
  };
  for (const instance of instances) {
    const key = nodeLocationKey(instance.documentPath, instance.nodePath);
    if (consumed.has(key) || representedByInstance(instance)) continue;
    diagnostics.push({
      at: `${instance.documentPath}#${instance.nodePath}`,
      message: `${instance.scriptResPath} code attachment is absent from accepted scene composition`,
    });
  }
  return result;
}

function scriptAutoloads(
  project: BoundGodotProject,
  modules: ReadonlyMap<string, OfficialBoundScriptModulePlan>,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotScriptAutoloadPlan[] {
  const result: DirectGodotScriptAutoloadPlan[] = [];
  for (const autoload of project.entrypoints.autoloads) {
    if (autoload.kind !== 'script') {
      diagnostics.push({
        at: `project.godot#[autoload].${autoload.name}`,
        message: `${autoload.kind} autoload requires a direct scene-module composition plan`,
      });
      continue;
    }
    const module = modules.get(autoload.resPath);
    const targetClass = module === undefined ? undefined : generatedClass(module);
    if (module === undefined || targetClass === undefined) {
      diagnostics.push({
        at: `project.godot#[autoload].${autoload.name}`,
        message:
          module === undefined
            ? `code plan omitted ${autoload.resPath}`
            : `${autoload.resPath} has no resolved native engine base`,
      });
      continue;
    }
    if (!targetClass.nativeCarrier) {
      diagnostics.push({
        at: `project.godot#[autoload].${autoload.name}`,
        message: `${autoload.resPath} has no generated native carrier`,
      });
      continue;
    }
    result.push({
      name: autoload.name,
      singleton: autoload.singleton,
      scriptResPath: autoload.resPath,
      generatedClass: targetClass,
      lifecycle: module.lifecycle,
      autoloadReferences: autoloadReferenceClosure(project, module, modules, diagnostics),
    });
  }
  return result;
}

function requiredCompatSymbols(
  code: OfficialBoundCodePlan,
  instances: readonly DirectGodotScriptInstancePlan[],
  autoloads: readonly DirectGodotScriptAutoloadPlan[],
): readonly string[] {
  return [
    ...new Set([
      ...code.requiredCompatSymbols,
      ...(instances.length > 0 || autoloads.length > 0 ? ['useGodotScriptTreeAttachment'] : []),
      ...(autoloads.length > 0 ? ['GodotProjectStartup'] : []),
    ]),
  ].sort();
}

function validateAutoloadReferences(
  instances: readonly DirectGodotScriptInstancePlan[],
  autoloads: readonly DirectGodotScriptAutoloadPlan[],
  diagnostics: DirectGodotCompositionDiagnostic[],
): void {
  const validate = (at: string, references: readonly DirectGodotAutoloadReferencePlan[]): void => {
    for (const reference of references) {
      const target = autoloads.find(
        (autoload) =>
          autoload.singleton &&
          autoload.name === reference.name &&
          autoload.scriptResPath === reference.resPath,
      );
      if (target === undefined) {
        diagnostics.push({
          at,
          message: `${reference.name} does not resolve to singleton ${reference.resPath}`,
        });
      }
    }
  };
  for (const instance of instances) {
    validate(`${instance.documentPath}#${instance.nodePath}`, instance.autoloadReferences);
  }
  for (const autoload of autoloads) {
    validate(`project.godot#[autoload].${autoload.name}`, autoload.autoloadReferences);
  }
}

/** A setting value as the compat value it builds; undefined for a type not translated. */
export function directGodotSettingValue(value: GodotValue): DirectGodotSettingValue | undefined {
  switch (value.kind) {
    case 'number':
      return { kind: 'number', value: value.value };
    case 'bool':
      return { kind: 'bool', value: value.value };
    case 'string':
      return { kind: 'string', value: value.value };
    case 'ctor': {
      const arity = { Vector2: [2], Vector3: [3], Color: [3, 4] }[value.name as 'Vector2' | 'Vector3' | 'Color'];
      if (arity === undefined || !arity.includes(value.args.length)) return undefined;
      const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
      if (!components.every((entry): entry is number => entry !== undefined)) return undefined;
      return { kind: value.name as 'Vector2' | 'Vector3' | 'Color', components };
    }
    default:
      return undefined;
  }
}

/** The settings scripts read by literal key (`project-setting-type`), each once. */
function projectSettings(
  project: BoundGodotProject,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly DirectGodotProjectSettingPlan[] {
  const planned = new Map<string, DirectGodotProjectSettingPlan>();
  for (const script of project.scripts) {
    for (const entry of script.settingTypes) {
      if (entry.setting === undefined || planned.has(entry.setting.key)) continue;
      const value = directGodotSettingValue(entry.setting.value);
      if (value === undefined) {
        diagnostics.push({
          at: `project.godot#${entry.setting.key}`,
          message: `a ${entry.builtinType} setting value is not translated`,
        });
        continue;
      }
      planned.set(entry.setting.key, { key: entry.setting.key, value });
    }
  }
  return [...planned.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** Pure join of already-accepted code and data plans; it performs no source read or emission. */
export function planDirectGodotProjectComposition(
  project: BoundGodotProject,
  code: OfficialBoundCodePlan,
  fields: ScriptFieldInitializationPlan,
  scenes: GodotSceneDocumentPlan,
): DirectGodotCompositionResult {
  const diagnostics: DirectGodotCompositionDiagnostic[] = [];
  if (
    code.snapshotDigest !== project.snapshotDigest ||
    fields.snapshotDigest !== project.snapshotDigest ||
    scenes.snapshotDigest !== project.snapshotDigest
  ) {
    diagnostics.push({
      at: 'direct-composition',
      message: 'bound project, code plan, and field-value plan do not share one snapshot',
    });
  }
  if (
    code.sourceRevision !== project.authority.revision ||
    fields.sourceRevision !== project.authority.revision ||
    scenes.sourceRevision !== project.authority.revision
  ) {
    diagnostics.push({
      at: 'direct-composition',
      message: 'bound project, code plan, and field-value plan do not share one source revision',
    });
  }
  const mainScene = project.entrypoints.mainScene;
  if (mainScene === undefined) {
    diagnostics.push({ at: 'project.godot#[application].run/main_scene', message: 'is absent' });
  } else if (!scenes.scenes.some((scene) => scene.sourceResPath === mainScene)) {
    diagnostics.push({
      at: 'project.godot#[application].run/main_scene',
      message: `${mainScene} has no accepted native scene plan`,
    });
  }
  const modules = new Map<string, OfficialBoundScriptModulePlan>();
  for (const module of code.scriptModules) {
    if (modules.has(module.resPath)) {
      diagnostics.push({ at: module.resPath, message: 'code plan repeats script module' });
    } else {
      modules.set(module.resPath, module);
    }
  }
  for (const script of project.scripts) {
    if (!modules.has(script.resPath)) {
      diagnostics.push({ at: script.resPath, message: 'accepted code plan omitted bound script' });
    }
  }
  const fieldPlans = indexFieldPlans(fields, diagnostics);
  const plannedSourceModules = sourceModules(code, diagnostics);
  const instances = scriptInstances(project, code.scriptModules, modules, fieldPlans, diagnostics);
  const composedScenes = attachScriptInstances(project, scenes.scenes, instances, diagnostics);
  const autoloads = scriptAutoloads(project, modules, diagnostics);
  validateAutoloadReferences(instances, autoloads, diagnostics);
  const settings = projectSettings(project, diagnostics);
  if (diagnostics.length > 0 || mainScene === undefined) {
    return { kind: 'refused-composition', diagnostics };
  }
  return {
    kind: 'accepted-composition',
    plan: {
      version: DIRECT_GODOT_COMPOSITION_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      mainScene,
      projectSettings: settings,
      sourceModules: plannedSourceModules,
      scenes: composedScenes,
      scriptAutoloads: autoloads,
      requiredCompatSymbols: requiredCompatSymbols(code, instances, autoloads),
      evidence: {
        readClaimIds: project.resourceProgram.evidence.claimIds,
        analysisClaimIds: project.analysisEvidence.claimIds,
        codeAnalysisClaimIds: code.analysisEvidenceClaimIds,
        languageClaimIds: code.languageEvidenceClaimIds,
        bindingClaimIds: [...new Set([...code.bindingEvidenceClaimIds, ...scenes.bindingEvidenceClaimIds])].sort(),
        fieldValueClaimIds: fields.evidenceClaimIds,
        sceneClaimIds: scenes.evidenceClaimIds,
        readRegistryDigest: project.resourceProgram.evidence.registryDigest,
        analysisRegistryDigest: project.analysisEvidence.registryDigest,
        codeRegistryDigest: code.semanticClaimRegistryDigest,
        fieldValueRegistryDigest: fields.semanticClaimRegistryDigest,
        sceneRegistryDigest: scenes.semanticClaimRegistryDigest,
      },
    },
  };
}
