import type {
  BoundGodotProject,
  BoundGodotSceneDocument,
  BoundGodotSceneNode,
} from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';
import { isImportedResourceId } from '../../read/instance-expansion';
import {
  type GodotSceneNodeAuthority,
  GodotSceneNodeAuthorityResolver,
  type GodotSceneStructureRuleId,
  type SerializedScenePropertyIdentity,
  type TargetSceneNodeKind,
  type TargetScenePropertyKind,
} from './scene-node-authority';

export const GODOT_SCENE_DOCUMENT_PLAN_VERSION = 2 as const;

/** One planned node: a native entity, or an instanced scene's generated component. */
export interface TargetGodotSceneNodePlan {
  readonly nodePath: string;
  readonly parentNodePath?: string;
  readonly name: string;
  /** A native entity's kind; `scene-instance` mounts `instance`'s generated component. */
  readonly targetKind: TargetSceneNodeKind | 'scene-instance';
  /** The instanced scene, for a `scene-instance` node. */
  readonly instance?: { readonly sourceResPath: string };
  readonly scriptResPath?: string;
  /** Authored values (for an instance, its root overrides), each through a property rule. */
  readonly properties: readonly TargetGodotScenePropertyPlan[];
  /** Groups the Node protocol receives at mount, in authored order. */
  readonly groups: readonly string[];
  /**
   * The node's Godot class and native ancestors, nearest first, which the Node protocol records at
   * mount (type tests read it); empty for an instance, whose component records its own root.
   */
  readonly classes: readonly string[];
  readonly children: readonly TargetGodotSceneNodePlan[];
  readonly evidenceClaimId: string;
  readonly placementEvidenceClaimId?: string;
}

export interface TargetGodotScenePropertyPlan {
  readonly propertyName: string;
  readonly targetKind: TargetScenePropertyKind;
  readonly value: readonly number[];
  readonly evidenceClaimId: string;
}

export interface TargetGodotSceneDocumentPlan {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
  readonly exportName: string;
  readonly root: TargetGodotSceneNodePlan;
}

export interface GodotSceneDocumentPlan {
  readonly version: typeof GODOT_SCENE_DOCUMENT_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly scenes: readonly TargetGodotSceneDocumentPlan[];
  readonly evidenceClaimIds: readonly string[];
  readonly semanticClaimRegistryDigest: string;
}

/**
 * Why a scene does not plan. `structure` is a scene-structure rule this plan has not got;
 * `node-family` a node class without a scene-node rule (`subject` names the class); `property` a
 * node property without a property rule (`Class.property`); `resource` a property whose value is a
 * resource; `signal` a signal connection; `editable-children` an override or node authored inside
 * an instanced scene below its root.
 */
export type GodotSceneRefusalCategory =
  | 'structure'
  | 'node-family'
  | 'property'
  | 'resource'
  | 'signal'
  | 'editable-children';

export interface GodotSceneDocumentDiagnostic {
  readonly at: string;
  readonly message: string;
  readonly category?: GodotSceneRefusalCategory;
  readonly subject?: string;
}

export type GodotSceneDocumentResult =
  | { readonly kind: 'accepted-scene-documents'; readonly plan: GodotSceneDocumentPlan }
  | {
      readonly kind: 'refused-scene-documents';
      readonly diagnostics: readonly GodotSceneDocumentDiagnostic[];
    };

function targetPath(resPath: string): string {
  const relative = resPath.slice('res://'.length).replace(/\.(?:t)?scn$/u, '');
  return `src/scenes/${relative}.tsx`;
}

export function godotSceneExportName(resPath: string): string {
  const basename = resPath.slice(resPath.lastIndexOf('/') + 1).replace(/\.(?:t)?scn$/u, '');
  const words = basename.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
  const joined = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
  return /^[A-Za-z_]/u.test(joined) ? `${joined}Scene` : `Scene${joined}`;
}

export function godotSceneTargetPath(resPath: string): string {
  return targetPath(resPath);
}

/**
 * Whether a value on a node this document copied from an instanced scene is the instanced node's
 * own value: equal, with a resource reference on the copy naming the instanced document's resource
 * under the id instance expansion gave it.
 */
function sameValue(copy: GodotValue | undefined, origin: GodotValue | undefined): boolean {
  if (copy === undefined || origin === undefined) return copy === origin;
  if (
    copy.kind === 'ctor' &&
    origin.kind === 'ctor' &&
    copy.name === origin.name &&
    (copy.name === 'ExtResource' || copy.name === 'SubResource')
  ) {
    const [copyId] = copy.args;
    const [originId] = origin.args;
    if (copyId?.kind === 'string' && originId?.kind === 'string' && isImportedResourceId(copyId.value, originId.value)) {
      return true;
    }
  }
  return JSON.stringify(copy) === JSON.stringify(origin);
}

function sameProperties(
  copy: Readonly<Record<string, GodotValue>>,
  origin: Readonly<Record<string, GodotValue>>,
): boolean {
  const names = new Set([...Object.keys(copy), ...Object.keys(origin)]);
  return [...names].every((name) => sameValue(copy[name], origin[name]));
}

const f32 = Math.fround;

function numbers(args: readonly GodotValue[]): readonly number[] | undefined {
  const values = args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
  return values.every((value): value is number => value !== undefined) ? values : undefined;
}

/**
 * A serialized value as its target value. `Transform3D(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy,
 * oz)` is written row by row (`VariantWriter`, core/variant/variant_parser.cpp:2111) and parsed as
 * `real_t`s into `Basis(rows)` (:894); the Object3D matrix is column-major, so element (r, c) is
 * `e[c * 4 + r]`, each component rounded to float as Godot stores it.
 */
function serializedValue(
  value: GodotValue,
): { readonly identity: SerializedScenePropertyIdentity; readonly value: readonly number[] } | undefined {
  if (value.kind === 'number') return { identity: 'number', value: [f32(value.value)] };
  if (value.kind !== 'ctor') return undefined;
  const args = numbers(value.args);
  if (args === undefined) return undefined;
  if (value.name === 'Vector3' && args.length === 3) {
    return { identity: 'ctor:Vector3(number,number,number)', value: args };
  }
  if ((value.name === 'Transform3D' || value.name === 'Transform') && args.length === 12) {
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz] = args.map(f32) as number[];
    return {
      identity: 'ctor:Transform3D(number*12)',
      value: [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, ox, oy, oz, 1] as number[],
    };
  }
  return undefined;
}

function isResourceValue(value: GodotValue): boolean {
  if (value.kind === 'ctor') {
    return (
      value.name === 'ExtResource' ||
      value.name === 'SubResource' ||
      value.args.some((arg) => isResourceValue(arg))
    );
  }
  if (value.kind === 'array') return value.items.some(isResourceValue);
  return false;
}

interface PlanContext {
  /** Exported fields a script (and its script ancestors) declares: set by the field plan. */
  readonly scriptFields: (resPath: string) => ReadonlySet<string>;
  readonly authority: GodotSceneNodeAuthorityResolver;
  readonly scenes: ReadonlyMap<string, BoundGodotSceneDocument>;
  readonly diagnostics: GodotSceneDocumentDiagnostic[];
  readonly evidence: Set<string>;
}

function refuse(
  context: PlanContext,
  at: string,
  message: string,
  category: GodotSceneRefusalCategory,
  subject?: string,
): void {
  context.diagnostics.push({ at, message, category, ...(subject === undefined ? {} : { subject }) });
}

function structure(
  context: PlanContext,
  at: string,
  id: GodotSceneStructureRuleId,
): boolean {
  const rule = context.authority.structureRule(id);
  if (rule === undefined) {
    refuse(context, at, `no live scene-structure evidence for ${id}`, 'structure');
    return false;
  }
  context.evidence.add(rule.evidenceClaimId);
  return true;
}

function planProperties(
  context: PlanContext,
  node: BoundGodotSceneNode,
  properties: Readonly<Record<string, GodotValue>>,
): readonly TargetGodotScenePropertyPlan[] | undefined {
  const result: TargetGodotScenePropertyPlan[] = [];
  let refused = false;
  for (const [propertyName, value] of Object.entries(properties)) {
    const at = `${node.documentPath}#${node.nodePath}.${propertyName}`;
    if (isResourceValue(value)) {
      refuse(context, at, `${propertyName} is a resource value`, 'resource', `${node.class.nativeName}.${propertyName}`);
      refused = true;
      continue;
    }
    const serialized = serializedValue(value);
    // A property belongs to the class in the ancestry that declares it (ClassDB::set).
    const rule =
      serialized === undefined
        ? undefined
        : node.class.nativeAncestry
            .map((className) =>
              context.authority.propertyRule(
                `${node.class.nativeCanonicalIdentity.slice(0, node.class.nativeCanonicalIdentity.lastIndexOf('\0'))}\0${className}`,
                propertyName,
                serialized.identity,
              ),
            )
            .find((candidate) => candidate !== undefined);
    if (rule === undefined || serialized === undefined) {
      refuse(
        context,
        at,
        serialized === undefined
          ? `serialized ${value.kind} value has no scene-property identity`
          : `no live scene-property evidence for ${propertyName} receiving ${serialized.identity}`,
        'property',
        `${node.class.nativeName}.${propertyName}`,
      );
      refused = true;
      continue;
    }
    context.evidence.add(rule.evidenceClaimId);
    result.push({
      propertyName,
      targetKind: rule.targetKind,
      value: serialized.value,
      evidenceClaimId: rule.evidenceClaimId,
    });
  }
  return refused ? undefined : result;
}

function placement(
  context: PlanContext,
  node: BoundGodotSceneNode,
): { readonly parentNodePath?: string; readonly evidenceClaimId?: string } | undefined {
  if (node.placement.kind !== 'child') return {};
  const rule = context.authority.placementRule('child');
  if (rule === undefined) {
    refuse(context, `${node.documentPath}#${node.nodePath}`, 'no live scene placement evidence for a child node', 'structure');
    return undefined;
  }
  context.evidence.add(rule.evidenceClaimId);
  return { parentNodePath: node.placement.parentNodePath, evidenceClaimId: rule.evidenceClaimId };
}

function groupsOf(context: PlanContext, node: BoundGodotSceneNode): readonly string[] | undefined {
  if (node.groups.length === 0) return [];
  return structure(context, `${node.documentPath}#${node.nodePath}`, 'node-groups') ? node.groups : undefined;
}

/** A node the document authors itself: a native entity of its class. */
function planNativeNode(context: PlanContext, node: BoundGodotSceneNode): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  let ok = true;
  if (node.nodePathProperties.length > 0) {
    refuse(context, at, 'authored NodePath properties are not planned', 'structure');
    ok = false;
  }
  if (node.instancePlaceholderResPath !== undefined) {
    refuse(context, at, 'instance placeholder is not planned', 'structure');
    ok = false;
  }
  const rule = context.authority.rule(node.class.nativeCanonicalIdentity);
  if (rule === undefined) {
    refuse(context, at, `no live scene-node evidence for ${node.class.nativeName}`, 'node-family', node.class.nativeName);
    ok = false;
  } else {
    context.evidence.add(rule.evidenceClaimId);
  }
  const fields = node.scriptResPath === undefined ? new Set<string>() : context.scriptFields(node.scriptResPath);
  const properties = planProperties(
    context,
    node,
    Object.fromEntries(Object.entries(node.authoredProperties).filter(([name]) => !fields.has(name))),
  );
  const groups = groupsOf(context, node);
  const placed = placement(context, node);
  if (!ok || rule === undefined || properties === undefined || groups === undefined || placed === undefined) {
    return undefined;
  }
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    targetKind: rule.targetKind,
    ...(node.scriptResPath === undefined ? {} : { scriptResPath: node.scriptResPath }),
    properties,
    groups,
    classes: node.class.nativeAncestry,
    children: [],
    evidenceClaimId: rule.evidenceClaimId,
    ...(placed.evidenceClaimId === undefined ? {} : { placementEvidenceClaimId: placed.evidenceClaimId }),
  };
}

/**
 * The root of an instanced scene: that scene's generated component, the values this document
 * authors on it beyond the instanced root's own as its props (Godot applies them over the
 * instantiated root, packed_scene.cpp:400), and its name.
 */
function planInstanceRoot(
  context: PlanContext,
  node: BoundGodotSceneNode,
  instanced: BoundGodotSceneDocument,
): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  if (!structure(context, at, 'scene-instance')) return undefined;
  const origin = instanced.nodes.find((candidate) => candidate.nodePath === '.');
  if (origin === undefined) {
    refuse(context, at, `${instanced.resPath} has no root`, 'structure');
    return undefined;
  }
  let ok = true;
  const overrides = Object.fromEntries(
    Object.entries(node.authoredProperties).filter(
      ([name, value]) => !sameValue(value, origin.authoredProperties[name]),
    ),
  );
  const fields = origin.scriptResPath === undefined ? new Set<string>() : context.scriptFields(origin.scriptResPath);
  const fieldOverrides = Object.keys(overrides).filter((name) => fields.has(name));
  if (fieldOverrides.length > 0) {
    refuse(context, at, `script field overrides on an instance (${fieldOverrides.join(', ')}) are not planned`, 'structure');
    ok = false;
  }
  if (Object.keys(overrides).length > 0 && !structure(context, at, 'instance-root-override')) ok = false;
  if (node.scriptResPath !== origin.scriptResPath) {
    refuse(context, at, 'an instance root with its own script is not planned', 'structure');
    ok = false;
  }
  if (JSON.stringify(node.groups) !== JSON.stringify(origin.groups)) {
    refuse(context, at, 'groups authored on an instance root are not planned', 'structure');
    ok = false;
  }
  if (node.nodePathProperties.length > origin.nodePathProperties.length) {
    refuse(context, at, 'authored NodePath properties are not planned', 'structure');
    ok = false;
  }
  const properties = planProperties(context, node, overrides);
  const placed = placement(context, node);
  if (!ok || properties === undefined || placed === undefined) return undefined;
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    targetKind: 'scene-instance',
    instance: { sourceResPath: instanced.resPath },
    properties,
    groups: [],
    classes: [],
    children: [],
    evidenceClaimId: context.authority.structureRule('scene-instance')?.evidenceClaimId ?? '',
    ...(placed.evidenceClaimId === undefined ? {} : { placementEvidenceClaimId: placed.evidenceClaimId }),
  };
}

function isInside(path: string, root: string): boolean {
  return root === '.' ? path !== '.' : path.startsWith(`${root}/`);
}

function planScene(context: PlanContext, scene: BoundGodotSceneDocument): TargetGodotSceneDocumentPlan | undefined {
  if (scene.sourceKind !== 'packed-scene') return undefined;
  if (scene.connectionCount > 0) {
    refuse(context, scene.resPath, 'signal connections are not planned', 'signal');
  }
  if (!structure(context, scene.resPath, 'authored-order')) return undefined;
  // Instance roots: a node this document copied from another scene's root.
  const instanceRoots = new Map<string, BoundGodotSceneDocument>();
  const planned: TargetGodotSceneNodePlan[] = [];
  let refused = false;
  for (const node of scene.nodes) {
    const at = `${scene.resPath}#${node.nodePath}`;
    const enclosing = [...instanceRoots.keys()].find((root) => isInside(node.nodePath, root));
    if (enclosing !== undefined) {
      // Inside an instanced scene: its component renders the copied nodes; what this document
      // changes or adds there, below the instance root, is an editable-children edit.
      const instanced = instanceRoots.get(enclosing) as BoundGodotSceneDocument;
      const origin =
        node.inheritedNode === undefined
          ? undefined
          : context.scenes
              .get(node.inheritedNode.documentPath)
              ?.nodes.find((candidate) => candidate.nodePath === node.inheritedNode?.nodePath);
      if (origin !== undefined) {
        const changed =
          !sameProperties(node.authoredProperties, origin.authoredProperties) ||
          JSON.stringify(node.groups) !== JSON.stringify(origin.groups) ||
          node.scriptResPath !== origin.scriptResPath;
        if (changed) {
          refuse(context, at, `an override inside instanced ${instanced.resPath} is not planned`, 'editable-children');
          refused = true;
        }
        continue;
      }
      const parent = node.placement.kind === 'child' ? node.placement.parentNodePath : undefined;
      if (parent !== enclosing) {
        refuse(context, at, `a node placed inside instanced ${instanced.resPath} is not planned`, 'editable-children');
        refused = true;
        continue;
      }
      if (!structure(context, at, 'instance-children')) {
        refused = true;
        continue;
      }
    }
    if (node.placement.kind === 'unresolved-parent') {
      refuse(context, at, 'a node placed inside an instanced scene is not planned', 'editable-children');
      refused = true;
      continue;
    }
    if (node.siblingIndex !== undefined) {
      refuse(context, at, 'explicit sibling order is not planned', 'structure');
      refused = true;
      continue;
    }
    const origin = node.inheritedNode;
    if (origin !== undefined && origin.nodePath === '.') {
      const instanced = context.scenes.get(origin.documentPath);
      if (node.nodePath === '.') {
        refuse(context, at, 'scene inheritance is not planned', 'structure');
        refused = true;
        continue;
      }
      if (instanced === undefined || instanced.sourceKind !== 'packed-scene') {
        instanceRoots.set(node.nodePath, instanced ?? scene);
        refuse(
          context,
          at,
          `an instanced ${instanced?.sourceKind ?? 'unread'} scene (${origin.documentPath}) has no scene-node rule`,
          'node-family',
          instanced?.sourceKind === 'imported-gltf' ? 'imported .glb' : 'instanced scene',
        );
        refused = true;
        continue;
      }
      instanceRoots.set(node.nodePath, instanced);
      const plannedRoot = planInstanceRoot(context, node, instanced);
      if (plannedRoot === undefined) refused = true;
      else planned.push(plannedRoot);
      continue;
    }
    if (origin !== undefined) {
      refuse(context, at, 'a node copied from an instanced scene outside it is not planned', 'structure');
      refused = true;
      continue;
    }
    const plannedNode = planNativeNode(context, node);
    if (plannedNode === undefined) refused = true;
    else planned.push(plannedNode);
  }
  if (refused) return undefined;
  const root = assembleSceneTree(context, scene, planned);
  if (root === undefined) return undefined;
  return {
    sourceResPath: scene.resPath,
    sourceDigest: scene.sourceDigest,
    targetPath: targetPath(scene.resPath),
    exportName: godotSceneExportName(scene.resPath),
    root,
  };
}

function assembleSceneTree(
  context: PlanContext,
  scene: BoundGodotSceneDocument,
  plannedNodes: readonly TargetGodotSceneNodePlan[],
): TargetGodotSceneNodePlan | undefined {
  const roots = plannedNodes.filter((node) => node.parentNodePath === undefined);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) {
    refuse(context, scene.resPath, roots.length === 0 ? 'scene has no planned root' : 'scene has two roots', 'structure');
    return undefined;
  }
  // Children in document order, the order SceneState::instantiate adds them.
  const children = new Map<string, TargetGodotSceneNodePlan[]>();
  for (const node of plannedNodes) {
    if (node.parentNodePath === undefined) continue;
    const siblings = children.get(node.parentNodePath) ?? [];
    siblings.push(node);
    children.set(node.parentNodePath, siblings);
  }
  const reachable = new Set<string>();
  const attach = (node: TargetGodotSceneNodePlan): TargetGodotSceneNodePlan => {
    reachable.add(node.nodePath);
    return { ...node, children: (children.get(node.nodePath) ?? []).map(attach) };
  };
  const result = attach(root);
  for (const node of plannedNodes) {
    if (!reachable.has(node.nodePath)) {
      refuse(context, `${scene.resPath}#${node.nodePath}`, 'planned parent is absent', 'structure');
    }
  }
  return reachable.size === plannedNodes.length ? result : undefined;
}

/** Pure scene translation from normalized bound facts; no source read, syntax, or emission. */
export function planGodotSceneDocuments(
  project: BoundGodotProject,
  sourceAuthority: GodotSceneNodeAuthority,
): GodotSceneDocumentResult {
  const authority = new GodotSceneNodeAuthorityResolver(sourceAuthority);
  if (authority.sourceRevision !== project.authority.revision) {
    throw new Error('bound Godot project and scene-node authority use different revisions');
  }
  const byScript = new Map(project.scripts.map((script) => [script.resPath, script] as const));
  const context: PlanContext = {
    scriptFields: (resPath) => {
      const script = byScript.get(resPath);
      const names = new Set<string>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const field of byScript.get(scriptPath)?.fields ?? []) names.add(field.name);
      }
      return names;
    },
    authority,
    scenes: new Map(project.documents.scenes.map((scene) => [scene.resPath, scene] as const)),
    diagnostics: [],
    evidence: new Set<string>(),
  };
  const scenes = project.documents.scenes.flatMap((scene) => {
    const planned = planScene(context, scene);
    return planned === undefined ? [] : [planned];
  });
  const plannedPaths = new Set(scenes.map((scene) => scene.sourceResPath));
  // An instance of a scene that did not plan cannot mount its component.
  const missing = (node: TargetGodotSceneNodePlan): string[] => [
    ...(node.instance !== undefined && !plannedPaths.has(node.instance.sourceResPath)
      ? [node.instance.sourceResPath]
      : []),
    ...node.children.flatMap(missing),
  ];
  for (const scene of scenes) {
    for (const resPath of missing(scene.root)) {
      refuse(context, scene.sourceResPath, `instanced ${resPath} did not plan`, 'structure', resPath);
    }
  }
  const targetPaths = new Set<string>();
  for (const scene of scenes) {
    if (targetPaths.has(scene.targetPath)) {
      refuse(context, scene.sourceResPath, `duplicate target path ${scene.targetPath}`, 'structure');
    }
    targetPaths.add(scene.targetPath);
  }
  if (context.diagnostics.length > 0) {
    return { kind: 'refused-scene-documents', diagnostics: context.diagnostics };
  }
  return {
    kind: 'accepted-scene-documents',
    plan: {
      version: GODOT_SCENE_DOCUMENT_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      scenes,
      evidenceClaimIds: [...context.evidence].sort(),
      semanticClaimRegistryDigest: authority.registryDigest,
    },
  };
}
