import type {
  BoundGodotProject,
  BoundGodotSceneDocument,
  BoundGodotSceneNode,
} from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';
import {
  type GodotSceneNodeAuthority,
  GodotSceneNodeAuthorityResolver,
  type SerializedScenePropertyIdentity,
  type TargetSceneNodeKind,
  type TargetScenePropertyKind,
} from './scene-node-authority';

export const GODOT_SCENE_DOCUMENT_PLAN_VERSION = 1 as const;

export interface TargetGodotSceneNodePlan {
  readonly nodePath: string;
  readonly parentNodePath?: string;
  readonly name: string;
  readonly targetKind: TargetSceneNodeKind;
  readonly scriptResPath?: string;
  readonly properties: readonly TargetGodotScenePropertyPlan[];
  readonly children: readonly TargetGodotSceneNodePlan[];
  readonly evidenceClaimId: string;
  readonly placementEvidenceClaimId?: string;
}

export interface TargetGodotScenePropertyPlan {
  readonly propertyName: string;
  readonly targetKind: TargetScenePropertyKind;
  readonly value: readonly [number, number, number];
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

export interface GodotSceneDocumentDiagnostic {
  readonly at: string;
  readonly message: string;
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

function exportName(resPath: string): string {
  const basename = resPath.slice(resPath.lastIndexOf('/') + 1).replace(/\.(?:t)?scn$/u, '');
  const words = basename.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
  const joined = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
  return /^[A-Za-z_]/u.test(joined) ? `${joined}Scene` : `Scene${joined}`;
}

function refuseUnsupportedNode(
  node: BoundGodotSceneNode,
  diagnostics: GodotSceneDocumentDiagnostic[],
): boolean {
  const at = `${node.documentPath}#${node.nodePath}`;
  const refusals = [
    [node.placement.kind === 'unresolved-parent', 'node parent is unresolved'],
    [node.instanceSceneResPath !== undefined, 'PackedScene instance composition is not planned'],
    [node.instancePlaceholderResPath !== undefined, 'instance placeholder is not planned'],
    [node.inheritedNode !== undefined, 'inherited node override is not planned'],
    [node.nodePathProperties.length > 0, 'authored NodePath properties are not planned'],
    [node.groups.length > 0, 'node groups are not planned'],
    [node.siblingIndex !== undefined, 'explicit sibling order is not planned'],
  ] as const;
  for (const [present, message] of refusals) {
    if (present) diagnostics.push({ at, message });
  }
  return refusals.some(([present]) => present);
}

function vector3(value: GodotValue): readonly [number, number, number] | undefined {
  if (value.kind !== 'ctor' || value.name !== 'Vector3' || value.args.length !== 3)
    return undefined;
  const [x, y, z] = value.args;
  return x?.kind === 'number' && y?.kind === 'number' && z?.kind === 'number'
    ? [x.value, y.value, z.value]
    : undefined;
}

function planNodeProperties(
  node: BoundGodotSceneNode,
  authority: GodotSceneNodeAuthorityResolver,
  diagnostics: GodotSceneDocumentDiagnostic[],
  evidence: Set<string>,
): readonly TargetGodotScenePropertyPlan[] {
  const result: TargetGodotScenePropertyPlan[] = [];
  for (const [propertyName, value] of Object.entries(node.authoredProperties)) {
    const targetValue = vector3(value);
    const serialized: SerializedScenePropertyIdentity | undefined =
      targetValue === undefined ? undefined : 'ctor:Vector3(number,number,number)';
    const rule =
      serialized === undefined
        ? undefined
        : authority.propertyRule(node.class.nativeCanonicalIdentity, propertyName, serialized);
    if (rule === undefined || targetValue === undefined) {
      diagnostics.push({
        at: `${node.documentPath}#${node.nodePath}.${propertyName}`,
        message:
          serialized === undefined
            ? `serialized ${value.kind} value has no scene-property identity`
            : `no live scene-property evidence for ${propertyName} receiving ${serialized}`,
      });
      continue;
    }
    result.push({
      propertyName,
      targetKind: rule.targetKind,
      value: targetValue,
      evidenceClaimId: rule.evidenceClaimId,
    });
    evidence.add(rule.evidenceClaimId);
  }
  return result;
}

function validateSceneMetadata(
  scene: BoundGodotSceneDocument,
  diagnostics: GodotSceneDocumentDiagnostic[],
): void {
  if (scene.connectionCount > 0) {
    diagnostics.push({ at: scene.resPath, message: 'signal connections are not planned' });
  }
  if (scene.subResourceCount > 0) {
    diagnostics.push({ at: scene.resPath, message: 'scene subresources are not planned' });
  }
}

function planNode(
  node: BoundGodotSceneNode,
  authority: GodotSceneNodeAuthorityResolver,
  diagnostics: GodotSceneDocumentDiagnostic[],
  evidence: Set<string>,
): TargetGodotSceneNodePlan | undefined {
  if (refuseUnsupportedNode(node, diagnostics)) return undefined;
  const rule = authority.rule(node.class.nativeCanonicalIdentity);
  if (rule === undefined) {
    diagnostics.push({
      at: `${node.documentPath}#${node.nodePath}`,
      message: `no live scene-node evidence for ${node.class.nativeCanonicalIdentity}`,
    });
    return undefined;
  }
  evidence.add(rule.evidenceClaimId);
  const placementRule =
    node.placement.kind === 'child' ? authority.placementRule('child') : undefined;
  if (node.placement.kind === 'child' && placementRule === undefined) {
    diagnostics.push({
      at: `${node.documentPath}#${node.nodePath}`,
      message: 'no live scene placement evidence for a child node',
    });
    return undefined;
  }
  if (placementRule !== undefined) evidence.add(placementRule.evidenceClaimId);
  const properties = planNodeProperties(node, authority, diagnostics, evidence);
  return {
    nodePath: node.nodePath,
    ...(node.placement.kind === 'child' ? { parentNodePath: node.placement.parentNodePath } : {}),
    name: node.name,
    targetKind: rule.targetKind,
    ...(node.scriptResPath === undefined ? {} : { scriptResPath: node.scriptResPath }),
    properties,
    children: [],
    evidenceClaimId: rule.evidenceClaimId,
    ...(placementRule === undefined
      ? {}
      : { placementEvidenceClaimId: placementRule.evidenceClaimId }),
  };
}

function assembleSceneTree(
  scene: BoundGodotSceneDocument,
  plannedNodes: readonly TargetGodotSceneNodePlan[],
  diagnostics: GodotSceneDocumentDiagnostic[],
): TargetGodotSceneNodePlan | undefined {
  const roots = plannedNodes.filter((node) => node.parentNodePath === undefined);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) {
    diagnostics.push({
      at: scene.resPath,
      message: roots.length === 0 ? 'scene has no planned root' : 'scene has two roots',
    });
    return undefined;
  }
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
      diagnostics.push({
        at: `${scene.resPath}#${node.nodePath}`,
        message: 'planned parent is absent',
      });
    }
  }
  return result;
}

function planScene(
  scene: BoundGodotSceneDocument,
  authority: GodotSceneNodeAuthorityResolver,
  diagnostics: GodotSceneDocumentDiagnostic[],
  evidence: Set<string>,
): TargetGodotSceneDocumentPlan | undefined {
  if (scene.sourceKind !== 'packed-scene') return undefined;
  validateSceneMetadata(scene, diagnostics);
  const plannedNodes = scene.nodes.flatMap((node) => {
    const planned = planNode(node, authority, diagnostics, evidence);
    return planned === undefined ? [] : [planned];
  });
  const plannedRoot = assembleSceneTree(scene, plannedNodes, diagnostics);
  if (plannedRoot === undefined) return undefined;
  return {
    sourceResPath: scene.resPath,
    sourceDigest: scene.sourceDigest,
    targetPath: targetPath(scene.resPath),
    exportName: exportName(scene.resPath),
    root: plannedRoot,
  };
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
  const diagnostics: GodotSceneDocumentDiagnostic[] = [];
  const evidence = new Set<string>();
  const scenes = project.documents.scenes.flatMap((scene) => {
    const planned = planScene(scene, authority, diagnostics, evidence);
    return planned === undefined ? [] : [planned];
  });
  const targetPaths = new Set<string>();
  for (const scene of scenes) {
    if (targetPaths.has(scene.targetPath)) {
      diagnostics.push({
        at: scene.sourceResPath,
        message: `duplicate target path ${scene.targetPath}`,
      });
    }
    targetPaths.add(scene.targetPath);
  }
  if (diagnostics.length > 0) return { kind: 'refused-scene-documents', diagnostics };
  return {
    kind: 'accepted-scene-documents',
    plan: {
      version: GODOT_SCENE_DOCUMENT_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      scenes,
      evidenceClaimIds: [...evidence].sort(),
      semanticClaimRegistryDigest: authority.registryDigest,
    },
  };
}
