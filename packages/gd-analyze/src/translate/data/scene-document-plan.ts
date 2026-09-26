import type {
  BoundGodotProject,
  BoundGodotResourceData,
  BoundGodotSceneDocument,
  BoundGodotSceneNode,
} from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';
import { isImportedResourceId } from '../../read/instance-expansion';
import { type SceneSetterLookup, type TargetSceneValue, targetSceneValue } from './scene-setters';
import {
  type GodotCompatExport,
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
  /**
   * A native entity's kind; `scene-instance` mounts `instance`'s generated component,
   * `imported-scene` an imported model's tree (`model`).
   */
  readonly targetKind: TargetSceneNodeKind | 'scene-instance' | 'imported-scene';
  /** For `imported-scene`: the importer's tree over the model file, and this scene's edits in it. */
  readonly model?: TargetGodotImportedModelPlan;
  /** A node this scene places under a node of an imported model: that instance and the path. */
  readonly portal?: { readonly instanceNodePath: string; readonly at: string };
  /** For `imported-scene`: the nodes this scene places under its model's nodes. */
  readonly placements?: readonly { readonly at: string; readonly node: TargetGodotSceneNodePlan }[];
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
  /** The protocol that makes the mounted entity the node its class creates. */
  readonly mount?: GodotCompatExport;
  /** `unique_name_in_owner`: the scene root finds the node as `%Name`. */
  readonly unique?: true;
  /** Authored properties without a JSX rule: their setters' calls on the entity at mount, in order. */
  readonly setters: readonly TargetGodotSceneSetterPlan[];
  readonly children: readonly TargetGodotSceneNodePlan[];
  readonly evidenceClaimId: string;
  readonly placementEvidenceClaimId?: string;
}

/** One node of an imported model's tree (`GodotImportedSceneNode` in compat's packed-scene). */
export interface TargetGodotImportedModelNode {
  readonly path: string;
  readonly name: string;
  readonly classes: readonly string[];
  readonly nonSpatial?: true;
  readonly gltfNode?: number;
  readonly matrix: readonly number[];
}

/** An instanced imported model: the file, Godot's tree over it, and this scene's overrides in it. */
export interface TargetGodotImportedModelPlan {
  readonly sourceResPath: string;
  readonly rootClasses: readonly string[];
  readonly nodes: readonly TargetGodotImportedModelNode[];
  /** Authored properties of the model's own nodes, by their setters on the node's entity. */
  readonly overrides: readonly { readonly at: string; readonly setters: readonly TargetGodotSceneSetterPlan[] }[];
}

/** A value a setter receives: a target value, or a resource this document's plan constructs. */
export type TargetGodotSceneValue =
  | Exclude<TargetSceneValue, { readonly kind: 'resource' }>
  | { readonly kind: 'resource'; readonly key: string };

/** One authored property as its setter's bound call. */
export interface TargetGodotSceneSetterPlan {
  readonly propertyName: string;
  readonly setter: { readonly module: string; readonly exportName: string; readonly localName: string };
  readonly index?: number;
  readonly value: TargetGodotSceneValue;
  readonly evidenceClaimId: string;
}

/** A resource the scene constructs once, then sets its authored properties on. */
export interface TargetGodotSceneResourcePlan {
  /** Document-unique: `sub:<id>`, or `ext:<res path>` and its own `ext:<res path>#sub:<id>`. */
  readonly key: string;
  readonly className: string;
  readonly construct: GodotCompatExport;
  readonly setters: readonly TargetGodotSceneSetterPlan[];
  readonly evidenceClaimId: string;
}

export interface TargetGodotScenePropertyPlan {
  readonly propertyName: string;
  readonly targetKind: TargetScenePropertyKind;
  readonly value: readonly number[];
  readonly evidenceClaimId: string;
}

/**
 * An authored `[connection]`: when the scene mounts, `fromNodePath`'s signal (through its compat
 * accessor) calls `method` on `toNodePath`'s script instance with the signal's arguments.
 */
export interface TargetGodotSceneConnectionPlan {
  readonly signal: string;
  readonly fromNodePath: string;
  readonly toNodePath: string;
  readonly method: string;
  readonly accessor: { readonly module: string; readonly exportName: string; readonly named: boolean };
  /** The signal's argument count, each passed on to the method. */
  readonly arguments: number;
  readonly evidenceClaimId: string;
}

export interface TargetGodotSceneDocumentPlan {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
  readonly exportName: string;
  readonly root: TargetGodotSceneNodePlan;
  /** Resources the scene's setters pass, dependencies before the resources that use them. */
  readonly resources: readonly TargetGodotSceneResourcePlan[];
  /** Authored connections, in document order (the order `SceneState::instantiate` connects). */
  readonly connections: readonly TargetGodotSceneConnectionPlan[];
}

export interface GodotSceneDocumentPlan {
  readonly version: typeof GODOT_SCENE_DOCUMENT_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly scenes: readonly TargetGodotSceneDocumentPlan[];
  readonly evidenceClaimIds: readonly string[];
  /** Setter binding claims the scenes use: code-layer claims, joined with the code plan's. */
  readonly bindingEvidenceClaimIds: readonly string[];
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

/** The resources of the document being planned, and those its setters have planned so far. */
interface DocumentResources {
  readonly scene: BoundGodotSceneDocument;
  readonly planned: Map<string, TargetGodotSceneResourcePlan | null>;
  readonly order: TargetGodotSceneResourcePlan[];
}

interface PlanContext {
  /** The setter an authored property calls, when the code authority binds it. */
  readonly setters?: SceneSetterLookup;
  readonly project?: BoundGodotProject;
  document?: DocumentResources;
  /** Setter binding claims the scenes use (code-layer claims, joined with the code plan's). */
  readonly bindingEvidence: Set<string>;
  /** Exported fields a script (and its script ancestors) declares: set by the field plan. */
  readonly scriptFields: (resPath: string) => ReadonlySet<string>;
  /** Functions a script (and its script ancestors) declares. */
  readonly scriptMethods: (resPath: string) => ReadonlySet<string>;
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

/**
 * An authored value as the value its setter receives; a resource reference plans that resource
 * (constructed once per document, its own properties set by their setters).
 */
function setterValue(
  context: PlanContext,
  at: string,
  subject: string,
  value: GodotValue,
  scope: string,
): TargetGodotSceneValue | undefined {
  const target = targetSceneValue(value);
  if (target === undefined) {
    refuse(context, at, `a ${value.kind} value is not passed to a setter`, 'property', subject);
    return undefined;
  }
  if (target.kind !== 'resource') return target;
  const key = planResource(context, at, target.reference, target.id, scope);
  return key === undefined ? undefined : { kind: 'resource', key };
}

/**
 * Plans the resource a `SubResource`/`ExtResource` names: a sub-resource of the scene (or of the
 * `.tres` whose scope it is in), or a `.tres` resource document. Its class needs a resource rule
 * and each authored property a bound setter; its key, or undefined when it does not plan.
 */
function planResource(
  context: PlanContext,
  at: string,
  reference: 'sub' | 'ext',
  id: string,
  scope: string,
): string | undefined {
  const document = context.document;
  if (document === undefined) return undefined;
  let key: string;
  let data: BoundGodotResourceData | undefined;
  let nestedScope = scope;
  if (scope === '') {
    if (reference === 'sub') {
      key = `sub:${id}`;
      data = document.scene.subResources.find((entry) => entry.id === id);
    } else {
      const ext = document.scene.extResources.find((entry) => entry.id === id);
      key = `ext:${ext?.resPath ?? id}`;
      const resource = context.project?.documents.resources.find((entry) => entry.resPath === ext?.resPath);
      data = resource?.resource;
      nestedScope = ext?.resPath ?? '';
    }
  } else {
    const resource = context.project?.documents.resources.find((entry) => entry.resPath === scope);
    if (reference === 'sub') {
      key = `ext:${scope}#sub:${id}`;
      data = resource?.subResources.find((entry) => entry.id === id);
    } else {
      const ext = resource?.extResources.find((entry) => entry.id === id);
      key = `ext:${ext?.resPath ?? id}`;
      data = context.project?.documents.resources.find((entry) => entry.resPath === ext?.resPath)?.resource;
      nestedScope = ext?.resPath ?? '';
    }
  }
  if (document.planned.has(key)) return document.planned.get(key) === null ? undefined : key;
  document.planned.set(key, null);
  if (data === undefined) {
    refuse(context, at, `${key} is not a resource this scene or a .tres declares`, 'resource', 'external resource');
    return undefined;
  }
  const rule = context.authority.resourceRule(data.type);
  if (rule === undefined) {
    refuse(context, at, `no live resource rule constructs ${data.type}`, 'resource', data.type);
    return undefined;
  }
  const setters: TargetGodotSceneSetterPlan[] = [];
  let ok = true;
  for (const [propertyName, value] of Object.entries(data.properties)) {
    const setter = setterPlan(context, `${at}(${key}).${propertyName}`, data.type, propertyName, value, nestedScope);
    if (setter === undefined) ok = false;
    else setters.push(setter);
  }
  if (!ok) return undefined;
  context.evidence.add(rule.evidenceClaimId);
  const planned = { key, className: data.type, construct: rule.construct, setters, evidenceClaimId: rule.evidenceClaimId };
  document.planned.set(key, planned);
  document.order.push(planned);
  return key;
}

/** One authored property of `className` (a node's or a resource's) as its setter's call. */
function setterPlan(
  context: PlanContext,
  at: string,
  className: string,
  propertyName: string,
  value: GodotValue,
  scope: string,
): TargetGodotSceneSetterPlan | undefined {
  const subject = `${className}.${propertyName}`;
  const found = context.setters?.(className, propertyName);
  if (found === undefined || typeof found === 'string') {
    refuse(context, at, found ?? `no setter lookup for ${propertyName}`, 'property', subject);
    return undefined;
  }
  if (!structure(context, at, 'property-setter')) return undefined;
  const target = setterValue(context, at, subject, value, scope);
  if (target === undefined) return undefined;
  context.bindingEvidence.add(found.evidenceClaimId);
  return {
    propertyName,
    setter: { module: found.module, exportName: found.exportName, localName: found.localName },
    ...(found.index === undefined ? {} : { index: found.index }),
    value: target,
    evidenceClaimId: found.evidenceClaimId,
  };
}

function planProperties(
  context: PlanContext,
  node: BoundGodotSceneNode,
  properties: Readonly<Record<string, GodotValue>>,
  setters?: TargetGodotSceneSetterPlan[],
): readonly TargetGodotScenePropertyPlan[] | undefined {
  const result: TargetGodotScenePropertyPlan[] = [];
  let refused = false;
  for (const [propertyName, value] of Object.entries(properties)) {
    const at = `${node.documentPath}#${node.nodePath}.${propertyName}`;
    if (isResourceValue(value) && setters === undefined) {
      refuse(context, at, `${propertyName} is a resource value`, 'resource', `${node.class.nativeName}.${propertyName}`);
      refused = true;
      continue;
    }
    const serialized = isResourceValue(value) ? undefined : serializedValue(value);
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
    if ((rule === undefined || serialized === undefined) && setters !== undefined) {
      // No JSX rule: the property's setter, called on the entity at mount.
      const setter = setterPlan(context, at, node.class.nativeName, propertyName, value, '');
      if (setter === undefined) refused = true;
      else setters.push(setter);
      continue;
    }
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
  const setters: TargetGodotSceneSetterPlan[] = [];
  // `unique_name_in_owner` registers the node with its owner (`Node::set_unique_name_in_owner`).
  const uniqueValue = node.authoredProperties['unique_name_in_owner'];
  const unique = uniqueValue?.kind === 'bool' && uniqueValue.value;
  if (uniqueValue !== undefined && !structure(context, at, 'unique-name')) ok = false;
  const properties = planProperties(
    context,
    node,
    Object.fromEntries(
      Object.entries(node.authoredProperties).filter(([name]) => !fields.has(name) && name !== 'unique_name_in_owner'),
    ),
    setters,
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
    ...(rule.mount === undefined ? {} : { mount: rule.mount }),
    ...(unique ? { unique: true as const } : {}),
    setters,
    children: [],
    evidenceClaimId: rule.evidenceClaimId,
    ...(placed.evidenceClaimId === undefined ? {} : { placementEvidenceClaimId: placed.evidenceClaimId }),
  };
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/**
 * An instanced imported model (`.glb`): Godot's importer tree over the file (`imported-scene`), the
 * instance root's authored values as props, and room for this scene's edits inside it.
 */
function planImportedInstance(
  context: PlanContext,
  node: BoundGodotSceneNode,
  imported: BoundGodotSceneDocument,
): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  if (!structure(context, at, 'imported-scene')) return undefined;
  const model = imported.model;
  const root = imported.nodes.find((candidate) => candidate.nodePath === '.');
  if (model === undefined || root === undefined) {
    refuse(context, at, `${imported.resPath} has no imported model source`, 'node-family', 'imported .glb');
    return undefined;
  }
  if (model.externalImageUris.length > 0) {
    // The copied model is the `.glb` alone; its images outside the file are not copied beside it.
    refuse(context, at, `${imported.resPath} references images outside the file`, 'resource', 'imported .glb');
    return undefined;
  }
  const nodes: TargetGodotImportedModelNode[] = [];
  for (const member of imported.nodes) {
    if (member.nodePath === '.') continue;
    if (member.authoredProperties['visible'] !== undefined) {
      // A node the importer hid needs Node3D visibility, which compat does not bind yet.
      refuse(context, at, `${imported.resPath}: ${member.nodePath} is hidden by the importer`, 'property', 'Node3D.visible');
      return undefined;
    }
    const transform = member.authoredProperties['transform'];
    const matrix = transform === undefined ? undefined : serializedValue(transform)?.value;
    const gltfNode = model.nodeIndexByPath[member.nodePath];
    nodes.push({
      path: member.nodePath,
      name: member.name,
      classes: member.class.nativeAncestry,
      ...(member.class.nativeAncestry.includes('Node3D') ? {} : { nonSpatial: true as const }),
      ...(gltfNode === undefined ? {} : { gltfNode }),
      matrix: matrix ?? IDENTITY_MATRIX,
    });
  }
  const properties = planProperties(context, node, node.authoredProperties);
  const placed = placement(context, node);
  if (properties === undefined || placed === undefined) return undefined;
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    targetKind: 'imported-scene',
    model: { sourceResPath: imported.resPath, rootClasses: root.class.nativeAncestry, nodes, overrides: [] },
    properties,
    groups: [],
    classes: [],
    setters: [],
    children: [],
    evidenceClaimId: context.authority.structureRule('imported-scene')?.evidenceClaimId ?? '',
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
    setters: [],
    children: [],
    evidenceClaimId: context.authority.structureRule('scene-instance')?.evidenceClaimId ?? '',
    ...(placed.evidenceClaimId === undefined ? {} : { placementEvidenceClaimId: placed.evidenceClaimId }),
  };
}

function isInside(path: string, root: string): boolean {
  return root === '.' ? path !== '.' : path.startsWith(`${root}/`);
}

function planScene(context: PlanContext, scene: BoundGodotSceneDocument): TargetGodotSceneDocumentPlan | undefined {
  context.document = { scene, planned: new Map(), order: [] };
  if (scene.sourceKind !== 'packed-scene') return undefined;
  if (!structure(context, scene.resPath, 'authored-order')) return undefined;
  // Instance roots: a node this document copied from another scene's root.
  const instanceRoots = new Map<string, BoundGodotSceneDocument>();
  const importedPlans = new Map<
    string,
    {
      readonly nodes: readonly TargetGodotImportedModelNode[];
      readonly overrides: { at: string; setters: readonly TargetGodotSceneSetterPlan[] }[];
      readonly placedAt: Map<string, number>;
    }
  >();
  // Nodes this document placed under an imported model's nodes: their own children are ordinary.
  const placedUnderModels = new Set<string>();
  const planned: TargetGodotSceneNodePlan[] = [];
  let refused = false;
  for (const authoredNode of scene.nodes) {
    // A node under a node this document placed in a model: the binder, which does not model the
    // imported tree, leaves its parent unresolved; the parent is that placed node.
    const node: BoundGodotSceneNode =
      authoredNode.placement.kind === 'unresolved-parent' &&
      placedUnderModels.has(authoredNode.placement.authoredParentPath)
        ? { ...authoredNode, placement: { kind: 'child', parentNodePath: authoredNode.placement.authoredParentPath } }
        : authoredNode;
    const at = `${scene.resPath}#${node.nodePath}`;
    const enclosing = [...instanceRoots.keys()].find((root) => isInside(node.nodePath, root));
    const importedEnclosing = enclosing === undefined ? undefined : importedPlans.get(enclosing);
    const underPlaced = [...placedUnderModels].some((placedPath) => isInside(node.nodePath, placedPath));
    if (enclosing !== undefined && importedEnclosing !== undefined && !underPlaced) {
      // Inside an imported model: an override of one of its nodes is that node's setters, a node
      // placed under one of its nodes a portal into it.
      const relative = node.nodePath.slice(enclosing.length + 1);
      const origin =
        node.inheritedNode === undefined
          ? undefined
          : context.scenes
              .get(node.inheritedNode.documentPath)
              ?.nodes.find((candidate) => candidate.nodePath === node.inheritedNode?.nodePath);
      if (origin !== undefined) {
        const setters: TargetGodotSceneSetterPlan[] = [];
        let ok = structure(context, at, 'imported-scene-edits');
        for (const [propertyName, value] of Object.entries(node.authoredProperties)) {
          if (sameValue(value, origin.authoredProperties[propertyName])) continue;
          const setter = setterPlan(context, `${at}.${propertyName}`, node.class.nativeName, propertyName, value, '');
          if (setter === undefined) ok = false;
          else setters.push(setter);
        }
        if (!ok) refused = true;
        else if (setters.length > 0) importedEnclosing.overrides.push({ at: relative, setters });
        continue;
      }
      const authoredParent =
        node.placement.kind === 'child'
          ? node.placement.parentNodePath
          : node.placement.kind === 'unresolved-parent'
            ? node.placement.authoredParentPath
            : undefined;
      if (authoredParent !== undefined && authoredParent !== enclosing && isInside(authoredParent, enclosing)) {
        const target = authoredParent.slice(enclosing.length + 1);
        const modelChildren = importedEnclosing.nodes.filter(
          (member) => member.path.lastIndexOf('/') >= 0 && member.path.slice(0, member.path.lastIndexOf('/')) === target,
        ).length;
        const placedBefore = importedEnclosing.placedAt.get(target) ?? 0;
        // Placed after the model's own children, in authored order.
        if (node.siblingIndex !== undefined && node.siblingIndex !== modelChildren + placedBefore) {
          refuse(context, at, 'a placement at a sibling index before the model node\'s own children is not planned', 'structure');
          refused = true;
          continue;
        }
        if (!importedEnclosing.nodes.some((member) => member.path === target)) {
          refuse(context, at, `${target} is not a node of the imported model`, 'editable-children');
          refused = true;
          continue;
        }
        // It takes its sibling index, and its children are this document's nodes under it,
        // whether or not it plans.
        importedEnclosing.placedAt.set(target, placedBefore + 1);
        placedUnderModels.add(node.nodePath);
        if (!structure(context, at, 'imported-scene-edits')) {
          refused = true;
          continue;
        }
        const { siblingIndex: _siblingIndex, ...unindexed } = node;
        const plannedNode = planNativeNode(context, { ...unindexed, placement: { kind: 'root' } });
        if (plannedNode === undefined) {
          refused = true;
          continue;
        }
        planned.push({ ...plannedNode, portal: { instanceNodePath: enclosing, at: target } });
        continue;
      }
    }
    if (enclosing !== undefined && importedEnclosing === undefined && !underPlaced) {
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
      if (instanced?.sourceKind === 'imported-gltf') {
        instanceRoots.set(node.nodePath, instanced);
        const plannedRoot = planImportedInstance(context, node, instanced);
        if (plannedRoot === undefined || plannedRoot.model === undefined) {
          refused = true;
        } else {
          const overrides: { at: string; setters: readonly TargetGodotSceneSetterPlan[] }[] = [];
          importedPlans.set(node.nodePath, { nodes: plannedRoot.model.nodes, overrides, placedAt: new Map() });
          planned.push({ ...plannedRoot, model: { ...plannedRoot.model, overrides } });
        }
        continue;
      }
      if (instanced === undefined || instanced.sourceKind !== 'packed-scene') {
        instanceRoots.set(node.nodePath, instanced ?? scene);
        refuse(
          context,
          at,
          `an instanced ${instanced?.sourceKind ?? 'unread'} scene (${origin.documentPath}) has no scene-node rule`,
          'node-family',
          'instanced scene',
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
  const connections = planConnections(context, scene, planned, instanceRoots);
  if (refused || connections === undefined) return undefined;
  const root = assembleSceneTree(context, scene, planned);
  if (root === undefined) return undefined;
  return {
    sourceResPath: scene.resPath,
    sourceDigest: scene.sourceDigest,
    targetPath: targetPath(scene.resPath),
    exportName: godotSceneExportName(scene.resPath),
    root,
    resources: context.document.order,
    connections,
  };
}

/**
 * The document's connections (`SceneState::instantiate`, packed_scene.cpp:651): each between two
 * native nodes this scene mounts, to a function of the target's script, from a signal whose class
 * has a connection rule, with no binds, unbinds or flags beyond `CONNECT_PERSIST`.
 */
/** Whether a connection is one an instanced scene authors, copied into this document with it. */
function representedByInstance(
  connection: BoundGodotSceneDocument['connections'][number],
  instanceRoots: ReadonlyMap<string, BoundGodotSceneDocument>,
): boolean {
  const relative = (nodePath: string, root: string): string | undefined =>
    nodePath === root ? '.' : nodePath.startsWith(`${root}/`) ? nodePath.slice(root.length + 1) : undefined;
  for (const [root, instanced] of instanceRoots) {
    const from = relative(connection.from, root);
    const to = relative(connection.to, root);
    if (from === undefined || to === undefined) continue;
    return instanced.connections.some(
      (own) =>
        own.signal === connection.signal &&
        own.method === connection.method &&
        own.from === from &&
        own.to === to &&
        own.flags === connection.flags &&
        own.bindCount === connection.bindCount &&
        own.unbinds === connection.unbinds,
    );
  }
  return false;
}

function planConnections(
  context: PlanContext,
  scene: BoundGodotSceneDocument,
  planned: readonly TargetGodotSceneNodePlan[],
  instanceRoots: ReadonlyMap<string, BoundGodotSceneDocument>,
): readonly TargetGodotSceneConnectionPlan[] | undefined {
  const mounted = new Map(
    planned.filter((node) => node.targetKind !== 'scene-instance').map((node) => [node.nodePath, node] as const),
  );
  const bound = new Map(scene.nodes.map((node) => [node.nodePath, node] as const));
  let ok = true;
  const result: TargetGodotSceneConnectionPlan[] = [];
  for (const connection of scene.connections) {
    // The instanced scene's component makes its own connections.
    if (representedByInstance(connection, instanceRoots)) continue;
    const at = `${scene.resPath}#${connection.from}:${connection.signal}`;
    const from = mounted.get(connection.from);
    const to = mounted.get(connection.to);
    const fromClass = bound.get(connection.from)?.class;
    if (connection.flags !== 0 || connection.bindCount > 0 || connection.unbinds > 0) {
      refuse(context, at, 'connection flags, binds or unbinds are not planned', 'signal', 'connection options');
      ok = false;
      continue;
    }
    if (from === undefined || to === undefined || fromClass === undefined) {
      refuse(context, at, 'a connection with an end this scene does not mount natively is not planned', 'signal', 'connection end');
      ok = false;
      continue;
    }
    if (to.scriptResPath === undefined || !context.scriptMethods(to.scriptResPath).has(connection.method)) {
      refuse(context, at, `the target has no script function ${connection.method}`, 'signal', 'connection target');
      ok = false;
      continue;
    }
    const rule = context.authority.signalRule(fromClass.nativeAncestry, connection.signal);
    if (rule === undefined) {
      refuse(
        context,
        at,
        `${fromClass.nativeName}.${connection.signal} has no connection rule`,
        'signal',
        `${fromClass.nativeName}.${connection.signal}`,
      );
      ok = false;
      continue;
    }
    context.evidence.add(rule.evidenceClaimId);
    result.push({
      signal: connection.signal,
      fromNodePath: connection.from,
      toNodePath: connection.to,
      method: connection.method,
      accessor: rule.accessor,
      arguments: rule.arguments,
      evidenceClaimId: rule.evidenceClaimId,
    });
  }
  return ok ? result : undefined;
}

function assembleSceneTree(
  context: PlanContext,
  scene: BoundGodotSceneDocument,
  plannedNodes: readonly TargetGodotSceneNodePlan[],
): TargetGodotSceneNodePlan | undefined {
  const roots = plannedNodes.filter((node) => node.parentNodePath === undefined && node.portal === undefined);
  const portals = new Map<string, TargetGodotSceneNodePlan[]>();
  for (const node of plannedNodes) {
    if (node.portal === undefined) continue;
    const list = portals.get(node.portal.instanceNodePath) ?? [];
    list.push(node);
    portals.set(node.portal.instanceNodePath, list);
  }
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
    const placements = (portals.get(node.nodePath) ?? []).map((placed) => ({
      at: (placed.portal as { readonly at: string }).at,
      node: attach(placed),
    }));
    return {
      ...node,
      children: (children.get(node.nodePath) ?? []).map(attach),
      ...(placements.length === 0 ? {} : { placements }),
    };
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
  setters?: SceneSetterLookup,
): GodotSceneDocumentResult {
  const authority = new GodotSceneNodeAuthorityResolver(sourceAuthority);
  if (authority.sourceRevision !== project.authority.revision) {
    throw new Error('bound Godot project and scene-node authority use different revisions');
  }
  const byScript = new Map(project.scripts.map((script) => [script.resPath, script] as const));
  const context: PlanContext = {
    ...(setters === undefined ? {} : { setters }),
    project,
    bindingEvidence: new Set<string>(),
    scriptFields: (resPath) => {
      const script = byScript.get(resPath);
      const names = new Set<string>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const field of byScript.get(scriptPath)?.fields ?? []) names.add(field.name);
      }
      return names;
    },
    scriptMethods: (resPath) => {
      const script = byScript.get(resPath);
      const names = new Set<string>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const method of byScript.get(scriptPath)?.class.methods ?? []) names.add(method.name);
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
      bindingEvidenceClaimIds: [...context.bindingEvidence].sort(),
      semanticClaimRegistryDigest: authority.registryDigest,
    },
  };
}
