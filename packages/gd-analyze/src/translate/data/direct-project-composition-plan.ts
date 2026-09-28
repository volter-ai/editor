import type { GodotScriptNodeSite } from './script-node-paths';
import { type GodotSceneRefsPlan, planGodotSceneRefs } from './scene-refs';
import { godotSceneNodeIdiom } from './scene-node-idioms';
import { planGodotSceneSkyLights } from './scene-sky-lights';
import { type GodotSceneBodyProp, type GodotSceneColliderPlan, planGodotSceneBodies } from './scene-body-idioms';
import { planGodotSceneCollectedSetters, planGodotSceneSurfaces } from './scene-surface-idioms';
import type { GodotValue } from '../../read/godot-value';
import { godotResolveNodePath } from './scene-animation';
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
import { type DirectGodotInputActionPlan, planDirectGodotInputMap } from './input-map-plan';
import type { GodotSceneNodeIdiom } from './scene-node-idioms';
import {
  type GodotSceneDocumentPlan,
  godotSceneHeldNodes,
  godotSceneSubnodes,
  type TargetGodotSceneDocumentPlan,
  type TargetGodotSceneNodePlan,
  type TargetGodotSceneSetterPlan,
  type TargetGodotSceneValue,
} from './scene-document-plan';
import type {
  ScriptAttachmentFieldInitializationPlan,
  ScriptFieldInitializationPlan,
  ScriptFieldValuePlan,
} from './script-field-initialization-plan';

export const DIRECT_GODOT_COMPOSITION_PLAN_VERSION = 4 as const;

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
  /** Whether the script makes timers or tweens, which its component steps. */
  readonly ownsTimed: boolean;
  readonly autoloadReferences: readonly DirectGodotAutoloadReferencePlan[];
}

export interface DirectGodotScriptAutoloadPlan {
  readonly name: string;
  readonly singleton: boolean;
  readonly scriptResPath: string;
  readonly generatedClass: DirectGodotGeneratedClass;
  readonly lifecycle: readonly BoundGodotLifecycleEntry[];
  /** Whether the script makes timers or tweens, which its component steps. */
  readonly ownsTimed: boolean;
  readonly autoloadReferences: readonly DirectGodotAutoloadReferencePlan[];
}

/** Final scene ownership: the native node and its one retained script instance travel together. */
export type DirectGodotSceneNodePlan = Omit<
  TargetGodotSceneNodePlan,
  'children' | 'scriptResPath' | 'placements'
> & {
  readonly scriptInstance?: DirectGodotScriptInstancePlan;
  /**
   * An instance's overrides of its scene root script's fields: the values this document authors
   * on the instance, which the instanced component's script takes over its own (`exports`).
   */
  readonly instanceExports?: readonly ScriptFieldValuePlan[];
  /** The node's Godot-only state, its `userData` (`scene-body-idioms.ts`). */
  readonly data?: Readonly<Record<string, unknown>>;
  /** A MeshInstance3D's mesh and, per surface, the material it draws (`scene-surface-idioms.ts`). */
  readonly surfaces?: { readonly mesh?: string; readonly materials: readonly (string | undefined)[]; readonly layers: number; readonly castShadow: boolean };
  /** A Camera3D's lens, cull mask and own environment (`scene-surface-idioms.ts`). */
  readonly lens?: { readonly fov: number; readonly near: number; readonly far: number; readonly cullMask: number; readonly environment?: TargetGodotSceneValue };
  /** An instance: what its element needs of the scene it instances (`scene-body-idioms.ts`). */
  readonly instanceOf?: {
    readonly exportName: string;
    readonly targetPath: string;
    readonly rootClass?: string;
    readonly rootIdiom?: GodotSceneNodeIdiom;
    readonly data: Readonly<Record<string, unknown>>;
    /** How many setters the instance states on the root beside its visibility. */
    readonly stated: number;
    /** Those of them that differ from the root's own. */
    readonly changed: readonly TargetGodotSceneSetterPlan[];
  };
  /** A collision shape's Rapier collider (`scene-body-idioms.ts`). */
  readonly collider?: GodotSceneColliderPlan;
  /** A physics body's `<RigidBody>` props (`scene-body-idioms.ts`). */
  readonly body?: readonly GodotSceneBodyProp[];
  /** An instance of a scene rooted in a body: the props its overrides change (`scene-body-idioms.ts`). */
  readonly bodyOverrides?: readonly GodotSceneBodyProp[];
  readonly children: readonly DirectGodotSceneNodePlan[];
  readonly placements?: readonly { readonly at: string; readonly node: DirectGodotSceneNodePlan }[];
};

export type DirectGodotSceneDocumentPlan = Omit<TargetGodotSceneDocumentPlan, 'root'> & {
  readonly root: DirectGodotSceneNodePlan;
  /** The scene's first Camera3D and the one authored current (`scene-surface-idioms.ts`). */
  readonly cameras?: { readonly first?: string; readonly authored?: string };
  /** The nodes the scene's component holds refs to, and what instancing scenes take (`scene-refs.ts`). */
  readonly refs: GodotSceneRefsPlan;
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

/** The `<Physics>` world's settings the plan fixes from the project. */
export interface DirectGodotPhysicsWorldPlan {
  /** The contact penetration the solver leaves uncorrected (Rapier's `allowedLinearError`). */
  readonly allowedLinearError: number;
}

/**
 * The largest delta a frame hands the scripts' `_process`: `max_steps` physics steps at
 * `ticks_per_second`, from `physics/common/max_physics_steps_per_frame` and
 * `physics/common/physics_ticks_per_second` (Godot's defaults 8 and 60 when unset). Godot never
 * advances a frame by more (`main/main.cpp:4951`: a frame due more steps than the maximum drops the
 * excess from its process step), so a stall, such as a page's first frames while it loads, reaches
 * `_process` as at most 8/60 s, never as one long delta that throws a bobbing coin out of view.
 */
export interface DirectGodotProcessDeltaPlan {
  readonly maxSteps: number;
  readonly ticksPerSecond: number;
}

export interface DirectGodotProjectCompositionPlan {
  readonly version: typeof DIRECT_GODOT_COMPOSITION_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly mainScene: string;
  /** The settings the world loads before any script runs. */
  readonly projectSettings: readonly DirectGodotProjectSettingPlan[];
  /** The InputMap the world loads after the settings (`Main::setup`, `main/main.cpp:2102`). */
  readonly inputMap: readonly DirectGodotInputActionPlan[];
  readonly physicsWorld: DirectGodotPhysicsWorldPlan;
  readonly processDelta: DirectGodotProcessDeltaPlan;
  readonly sourceModules: readonly DirectGodotSourceModulePlan[];
  readonly scenes: readonly DirectGodotSceneDocumentPlan[];
  readonly scriptAutoloads: readonly DirectGodotScriptAutoloadPlan[];
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

/**
 * The script at `resPath` and its script ancestors: an instance runs code from every one of them, so
 * it owns the timers and tweens any of them makes.
 */
function scriptChain(project: BoundGodotProject, resPath: string): readonly string[] {
  const script = project.scripts.find((candidate) => candidate.resPath === resPath);
  return [resPath, ...(script?.inheritance.scriptAncestors ?? [])];
}

/** Whether an instance of the script at `resPath` makes timers or tweens, its own or inherited. */
function ownsTimedChain(project: BoundGodotProject, modulesByPath: ReadonlyMap<string, OfficialBoundScriptModulePlan>, resPath: string): boolean {
  return scriptChain(project, resPath).some((path) => modulesByPath.get(path)?.ownsTimed === true);
}

/**
 * A script that makes timers or tweens must run on a node or an autoload, whose component steps
 * them (docs/GODOT.md §The emitted game's shape, step 6): one no attached script or autoload has in
 * its chain (a RefCounted or Resource script) is refused by name. The check is per module: an
 * inner class, or a `Class.new()` node, of an attached script is not caught here, and nothing
 * steps what it makes.
 */
function unownedTimed(project: BoundGodotProject, modules: readonly OfficialBoundScriptModulePlan[], diagnostics: DirectGodotCompositionDiagnostic[]): void {
  const held = new Set<string>();
  for (const module of modules) if (module.attachments.length > 0) for (const path of scriptChain(project, module.resPath)) held.add(path);
  for (const autoload of project.entrypoints.autoloads) if (autoload.kind === 'script') for (const path of scriptChain(project, autoload.resPath)) held.add(path);
  for (const module of modules) {
    if (!module.ownsTimed || held.has(module.resPath)) continue;
    diagnostics.push({ at: module.resPath, message: 'makes timers or tweens, but no node or autoload runs it, so no component steps them' });
  }
}

/**
 * The nodes a script's scene hands it for its static paths (`script-node-paths.ts`), its own and its
 * ancestors', as node references from the node running it: what the plan recorded for that node. A
 * node running the script of the scene it instances has none: that scene's component hands them.
 */
function nodePathFields(
  project: BoundGodotProject,
  module: OfficialBoundScriptModulePlan,
  attachment: BoundGodotScriptAttachment,
  nodePaths: NodePathSites,
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly ScriptFieldValuePlan[] {
  const site = nodePaths.sites.get(nodeLocationKey(attachment.documentPath, attachment.nodePath));
  if (site === undefined) {
    const expected = scriptChain(project, module.resPath).some((resPath) => nodePaths.scripts.has(resPath));
    if (expected && nodePaths.ownScripted(attachment.documentPath, attachment.nodePath)) {
      diagnostics.push({ at: `${attachment.documentPath}#${attachment.nodePath}`, message: `${module.resPath} reads nodes its scene hands it, and the plan hands this node none` });
    }
    return [];
  }
  return site.fields.map((entry) => ({ fieldName: entry.field, application: 'script-property-set', value: { kind: 'node-reference', value: entry.path } }));
}

/** The code plan's handed nodes by the node running the script, and which nodes run their own. */
interface NodePathSites {
  readonly scripts: ReadonlySet<string>;
  readonly sites: ReadonlyMap<string, GodotScriptNodeSite>;
  readonly ownScripted: (documentPath: string, nodePath: string) => boolean;
}

function nodePathSites(code: OfficialBoundCodePlan, scenes: GodotSceneDocumentPlan): NodePathSites {
  const own = new Set<string>();
  for (const scene of scenes.scenes) {
    (function collect(node: TargetGodotSceneNodePlan): void {
      if (node.scriptResPath !== undefined) own.add(nodeLocationKey(scene.sourceResPath, node.nodePath));
      for (const child of godotSceneSubnodes(node)) collect(child);
    })(scene.root);
  }
  return {
    scripts: new Set(code.scriptNodePaths.scripts.map((entry) => entry.scriptResPath)),
    sites: new Map(code.scriptNodePaths.sites.map((site) => [nodeLocationKey(site.documentPath, site.nodePath), site] as const)),
    ownScripted: (documentPath, nodePath) => own.has(nodeLocationKey(documentPath, nodePath)),
  };
}

function scriptInstance(
  module: OfficialBoundScriptModulePlan,
  attachment: BoundGodotScriptAttachment,
  fields: ReadonlyMap<string, ScriptAttachmentFieldInitializationPlan>,
  autoloadReferences: readonly DirectGodotAutoloadReferencePlan[],
  ownsTimed: boolean,
  diagnostics: DirectGodotCompositionDiagnostic[],
  handed: readonly ScriptFieldValuePlan[],
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
    fields: [...(fields.get(key)?.fields ?? []), ...handed],
    lifecycle: module.lifecycle,
    ownsTimed,
    autoloadReferences,
  };
}

function scriptInstances(
  project: BoundGodotProject,
  modules: readonly OfficialBoundScriptModulePlan[],
  modulesByPath: ReadonlyMap<string, OfficialBoundScriptModulePlan>,
  fields: ReadonlyMap<string, ScriptAttachmentFieldInitializationPlan>,
  diagnostics: DirectGodotCompositionDiagnostic[],
  nodePaths: NodePathSites,
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
        ownsTimedChain(project, modulesByPath, module.resPath),
        diagnostics,
        nodePathFields(project, module, attachment, nodePaths, diagnostics),
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

/**
 * A script field authored as a node path is set to the node at that path once the scene's nodes all
 * exist (`SceneState::instantiate`, packed_scene.cpp:597): a node the scene itself writes, or null
 * for a path leaving the scene (it is not yet under a parent). A path by absolute path, unique name
 * or subpath, or into an instanced scene, is not planned.
 */
function validateNodeReferences(scene: Omit<DirectGodotSceneDocumentPlan, 'refs'>, diagnostics: DirectGodotCompositionDiagnostic[]): void {
  // The nodes a ref can hold (an instance's children here are the ones this document places under
  // it, a model's the ones it places and its own).
  const own = godotSceneHeldNodes(scene.root);
  const check = (node: DirectGodotSceneNodePlan): void => {
    for (const field of [...(node.scriptInstance?.fields ?? []), ...(node.instanceExports ?? [])]) {
      if (field.value.kind !== 'node-reference') continue;
      const path = field.value.value;
      const at = `${scene.sourceResPath}#${node.nodePath}.${field.fieldName}`;
      if (path.startsWith('/') || path.includes('%') || path.includes(':')) {
        diagnostics.push({ at, message: `a node reference by ${path.startsWith('/') ? 'absolute path' : path.includes('%') ? 'unique name' : 'subpath'} is not planned` });
        continue;
      }
      const target = godotResolveNodePath(node.nodePath, path);
      if (target !== undefined && !own.has(target)) diagnostics.push({ at, message: `a node reference to ${target}, which no ref of this scene holds (inside an instanced scene, or a collision shape), is not planned` });
    }
    for (const child of node.children) check(child);
  };
  check(scene.root);
}

function attachScriptInstances(
  project: BoundGodotProject,
  scenes: readonly TargetGodotSceneDocumentPlan[],
  instances: readonly DirectGodotScriptInstancePlan[],
  diagnostics: DirectGodotCompositionDiagnostic[],
): readonly Omit<DirectGodotSceneDocumentPlan, 'refs'>[] {
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
  const consumed = new Set<string>();
  const attach = (
    scene: TargetGodotSceneDocumentPlan,
    node: TargetGodotSceneNodePlan,
  ): DirectGodotSceneNodePlan => {
    const key = nodeLocationKey(scene.sourceResPath, node.nodePath);
    const located = byLocation.get(key);
    // The instanced scene's component attaches its own script: this document's node carries none.
    const represented = located !== undefined && node.scriptResPath === undefined && representedByInstance(located);
    const instance = represented ? undefined : located;
    const exports = represented ? located.fields : [];
    const boundNode = boundNodes.get(key);
    if (validateAttachedScript(scene, node, instance, boundNode, diagnostics)) consumed.add(key);
    const { scriptResPath: _scriptResPath, children, placements, ...nativeNode } = node;
    return {
      ...nativeNode,
      ...(instance === undefined ? {} : { scriptInstance: instance }),
      ...(exports.length === 0 ? {} : { instanceExports: exports }),
      children: children.map((child) => attach(scene, child)),
      ...(placements === undefined
        ? {}
        : { placements: placements.map((placed) => ({ at: placed.at, node: attach(scene, placed.node) })) }),
    };
  };
  const result = scenes.map((scene) => ({ ...scene, root: attach(scene, scene.root) }));
  for (const scene of result) validateNodeReferences(scene, diagnostics);
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
      ownsTimed: ownsTimedChain(project, modules, autoload.resPath),
      autoloadReferences: autoloadReferenceClosure(project, module, modules, diagnostics),
    });
  }
  return result;
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
function directGodotSettingValue(value: GodotValue): DirectGodotSettingValue | undefined {
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

/**
 * Engine settings compat reads while the game runs, carried when `project.godot` authors them
 * (compat holds each one's registered default): the main loop's clock (`main/main.cpp:2247`,
 * `:2262`), the default space's gravity and damping (`servers/physics_server_3d.cpp`),
 * Input's touch/mouse emulation (`main/main.cpp`), and the root window's base size and stretch
 * (`window.ts`, `scene/main/window.cpp:1302`).
 */
const ENGINE_SETTINGS = [
  'application/run/delta_smoothing',
  'display/window/size/viewport_height',
  'display/window/size/viewport_width',
  'display/window/stretch/aspect',
  'display/window/stretch/mode',
  'display/window/stretch/scale',
  'input_devices/pointing/emulate_mouse_from_touch',
  'physics/3d/default_angular_damp',
  'physics/3d/default_gravity',
  'physics/3d/default_gravity_vector',
  'physics/3d/default_linear_damp',
  'physics/common/max_physics_steps_per_frame',
  'physics/common/physics_jitter_fix',
  'physics/common/physics_ticks_per_second',
] as const;

/** The settings scripts read by literal key (`project-setting-type`), each once, and the engine's. */
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
  // Compat lays the 2D world out at the stretched size in `canvas_items` mode; `viewport` mode
  // (the whole game rendered at the base size and scaled) and integer scaling are not translated.
  const stretchMode = project.read.authoredSettings.get('display/window/stretch/mode');
  if (stretchMode?.kind === 'string' && stretchMode.value === 'viewport') {
    diagnostics.push({ at: 'project.godot#display/window/stretch/mode', message: 'the viewport stretch mode is not translated' });
  }
  // The keep aspects (keep, the default, keep_width, keep_height) letterbox the whole viewport in
  // Godot, 3D included (`window.cpp` `_update_viewport_size`); compat letterboxes only the 2D layer,
  // so a project that draws 3D through a camera under them is not translated.
  const aspect = project.read.authoredSettings.get('display/window/stretch/aspect');
  const aspectValue = aspect?.kind === 'string' ? aspect.value : 'keep';
  const drawsThreeD = project.documents.scenes.some((scene) =>
    scene.nodes.some((node) => node.class.nativeAncestry.some((name) => godotSceneNodeIdiom(name)?.form?.kind === 'camera')),
  );
  if (stretchMode?.kind === 'string' && stretchMode.value === 'canvas_items' && ['keep', 'keep_width', 'keep_height'].includes(aspectValue) && drawsThreeD) {
    diagnostics.push({ at: 'project.godot#display/window/stretch/aspect', message: `the ${aspectValue} stretch aspect with a 3D camera (a letterboxed 3D view) is not translated` });
  }
  const scaleMode = project.read.authoredSettings.get('display/window/stretch/scale_mode');
  if (scaleMode?.kind === 'string' && scaleMode.value === 'integer') {
    diagnostics.push({ at: 'project.godot#display/window/stretch/scale_mode', message: 'integer stretch scaling is not translated' });
  }
  for (const key of ENGINE_SETTINGS) {
    const authored = project.read.authoredSettings.get(key);
    if (authored === undefined || planned.has(key)) continue;
    const value = directGodotSettingValue(authored);
    if (value === undefined) {
      diagnostics.push({ at: `project.godot#${key}`, message: 'an engine setting value is not translated' });
      continue;
    }
    planned.set(key, { key, value });
  }
  return [...planned.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Rapier's `allowedLinearError`: the host's own contact tolerance, not a translation of a Godot
 * setting. Godot's engines leave a small penetration uncorrected (GodotPhysics3D its
 * `contact_max_allowed_penetration`, 0.01, `godot_body_pair_3d.cpp:341`; Jolt its
 * `penetration_slop`, 0.02, `jolt_project_settings.cpp:41`, ignoring the other,
 * `jolt_space_3d.cpp:278`), and at Rapier's own 0.001 a ball pressed against a wall stays wedged,
 * its push out bounding a friction that stops it rolling away, where both let it go. Rapier's
 * tolerance is not either engine's slop: it settles a resting body to its depth in the floor, so
 * Jolt's 0.02 sinks a walking enemy's floor probe where Jolt does not. 0.01 frees the wedged
 * ball and keeps resting bodies on their floors, whichever engine the project names.
 */
function physicsWorld(_project: BoundGodotProject): DirectGodotPhysicsWorldPlan {
  return { allowedLinearError: 0.01 };
}

/** The process delta's bound from the project's settings (`DirectGodotProcessDeltaPlan`). */
function processDelta(project: BoundGodotProject): DirectGodotProcessDeltaPlan {
  const setting = (key: string, fallback: number): number => {
    const value = project.read.authoredSettings.get(key);
    return value?.kind === 'number' && value.value > 0 ? value.value : fallback;
  };
  return {
    maxSteps: setting('physics/common/max_physics_steps_per_frame', 8),
    ticksPerSecond: setting('physics/common/physics_ticks_per_second', 60),
  };
}

/** Pure join of already-accepted code and data plans; it performs no source read or emission. */
/** The classes whose methods take an action by name. */
const ACTION_CLASSES = new Set(['Input', 'InputMap', 'InputEvent', 'InputEventAction', 'InputEventKey', 'InputEventMouseButton', 'InputEventJoypadButton', 'InputEventJoypadMotion', 'InputEventScreenTouch', 'InputEventMouseMotion', 'InputEventScreenDrag', 'InputEventWithModifiers', 'InputEventFromWindow', 'InputEventMouse']);

/**
 * The input actions the project's scripts name: each string argument of a call to a method of an
 * input class. A call whose arguments include a computed value may name any action, and GUI nodes
 * navigate with the built-in `ui_*` actions: either keeps every built-in.
 */
function usedInputActions(project: BoundGodotProject): ReadonlySet<string> | 'all' {
  const used = new Set<string>();
  for (const scene of project.documents.scenes) {
    if (scene.nodes.some((node) => node.class.nativeAncestry.includes('Control'))) return 'all';
  }
  for (const script of project.scripts) {
    const nodes = script.program.nodes;
    for (const node of nodes) {
      if (node.kind !== 'CALL' || !ACTION_CLASSES.has(node.compilerTarget.owner)) continue;
      for (const id of node.arguments) {
        const argument = nodes[id];
        if (argument?.kind === 'LITERAL' && (argument.value.kind === 'string' || argument.value.kind === 'string-name')) {
          used.add(argument.value.value);
        } else if (argument?.datatype.kind !== 'BUILTIN' || (argument.datatype.builtinType !== 'bool' && argument.datatype.builtinType !== 'float' && argument.datatype.builtinType !== 'int')) {
          return 'all';
        }
      }
    }
  }
  return used;
}

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
  const instances = scriptInstances(
    project,
    code.scriptModules,
    modules,
    fieldPlans,
    diagnostics,
    nodePathSites(code, scenes),
  );
  unownedTimed(project, code.scriptModules, diagnostics);
  const composedScenes = attachScriptInstances(project, scenes.scenes, instances, diagnostics);
  const autoloads = scriptAutoloads(project, modules, diagnostics);
  validateAutoloadReferences(instances, autoloads, diagnostics);
  const settings = projectSettings(project, diagnostics);
  const physics = physicsWorld(project);
  const inputMap = planDirectGodotInputMap(project.read.inputActions, (at, message) => diagnostics.push({ at, message }), usedInputActions(project));
  const bodied = planGodotSceneBodies(planGodotSceneSurfaces(planGodotSceneCollectedSetters(composedScenes)), diagnostics);
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
      inputMap,
      physicsWorld: physics,
      processDelta: processDelta(project),
      sourceModules: plannedSourceModules,
      scenes: planGodotSceneRefs(bodied.map(planGodotSceneSkyLights)),
      scriptAutoloads: autoloads,
    },
  };
}
