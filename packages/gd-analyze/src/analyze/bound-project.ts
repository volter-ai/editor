import { type BoundGodotTypedValue, typeProjectSettingValues } from './project-setting-types';
import { type BoundGodotRefinedType, type RefinedScriptInfo, refineDatatypes } from './refined-types';
import * as path from 'node:path';
import type {
  GodotBoundClassNode,
  GodotBoundDatatype,
  GodotBoundFunctionNode,
  GodotBoundIdentifierNode,
  GodotBoundProgram,
  GodotBoundScript,
} from '../godot-frontend/bound-program';
import type { BoundGodotResourceProgram } from '../godot-frontend/protocol';
import { assertBoundGodotResourceProgram } from '../godot-frontend/protocol';
import type { GodotSourceAuthority } from '../godot-frontend/source-authority';
import type {
  Autoload,
  Diagnostic,
  GodotProject,
  SceneDocument,
  SceneNode,
  ScriptAttachment,
  UnplacedNode,
} from '../read/godot-types';
import { walkSceneNodes } from '../read/godot-types';
import type { GodotValue } from '../read/godot-value';
import { indexParsedSceneScriptAttachments } from '../read/scene-attachment-index';
import type { GodotTextureImportParams } from '../read/import-sidecar';
import type { GodotProjectSnapshot, GodotProjectSnapshotEntry } from '../snapshot/project-snapshot';
import { GodotProjectSnapshotReader } from '../snapshot/project-snapshot-reader';
import type { GodotToolchainApiDumpSnapshot } from '../snapshot/toolchain-snapshot';
import type { GodotApiClass, GodotApiDump } from './api-dump';
import type { GodotAnalysisAuthority, GodotAnalysisRuleId } from './authority';
import {
  type BoundGodotCallReceiver,
  type BoundGodotUntypedCall,
  typeCallReceivers,
} from './call-receivers';
import { GodotAnalysisAuthorityResolver } from './authority';
import {
  type BoundGodotScriptSingletonReference,
  type BoundGodotScriptSingletonTarget,
  bindGodotScriptSingletonReferences,
} from './bound-autoload-references';

export const BOUND_GODOT_PROJECT_VERSION = 4 as const;

export interface BoundGodotSourceScript {
  readonly resPath: string;
  readonly sourceDigest: string;
  readonly program: GodotBoundScript;
  readonly class: BoundGodotScriptClass;
  readonly inheritance: BoundGodotScriptInheritance;
  /** Every exact runtime node placement selected by decoded scene composition. */
  readonly attachments: readonly BoundGodotScriptAttachment[];
  /** ProjectSettings autoloads that instantiate this script as a bare Node. */
  readonly autoloads: readonly BoundGodotScriptAutoload[];
  /** Official identifier nodes already joined to their exact project singleton identity. */
  readonly singletonReferences: readonly BoundGodotScriptSingletonReference[];
  /** Effective callback owner selected through the already-resolved script ancestry. */
  readonly lifecycle: readonly BoundGodotLifecycleEntry[];
  /** Official declarations joined to attachment-specific initialization inputs. */
  readonly fields: readonly BoundGodotScriptField[];
  /** Dynamic calls whose receiver class the project fixes, with Godot's runtime selection. */
  readonly callReceivers: readonly BoundGodotCallReceiver[];
  /** Dynamic calls left untyped, each with the reason; lowering refuses them where they stand. */
  readonly untypedCalls: readonly BoundGodotUntypedCall[];
  /** Variant values the project fixes the type of (`project-setting-type`). */
  readonly settingTypes: readonly BoundGodotTypedValue[];
  /** Datatypes the project fixes where the analyzer left a node untyped (`refineDatatypes`). */
  readonly refinedTypes: readonly BoundGodotRefinedType[];
}

export interface BoundGodotScriptFieldAttachmentValue {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly source: 'authored-value' | 'script-default';
  readonly valueKind: 'value' | 'node-reference';
  readonly authoredValue?: GodotValue;
}

export interface BoundGodotScriptField {
  readonly nodeId: number;
  readonly name: string;
  readonly static: boolean;
  readonly exported: boolean;
  /** Datatype selected by the official analyzer; later phases never infer it from source text. */
  readonly datatype: GodotBoundDatatype;
  readonly initialization: 'class-load' | 'instance-construction' | 'ready';
  readonly initializerNodeId?: number;
  readonly setterNodeId?: number;
  readonly getterNodeId?: number;
  readonly attachmentValues: readonly BoundGodotScriptFieldAttachmentValue[];
  readonly evidenceClaimId: string;
}

export interface BoundGodotScriptAttachment {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly nodeClass?: string;
  readonly authoredProperties: Readonly<Record<string, GodotValue>>;
  readonly nodePathProperties: readonly string[];
  readonly evidenceClaimId: string;
}

export interface BoundGodotScriptAutoload {
  readonly name: string;
  readonly singleton: boolean;
}

export type BoundGodotLifecyclePhase =
  | 'enter-tree'
  | 'ready'
  | 'process'
  | 'physics-process'
  | 'input'
  | 'shortcut-input'
  | 'unhandled-input'
  | 'unhandled-key-input'
  | 'exit-tree';

export interface BoundGodotLifecycleEntry {
  readonly phase: BoundGodotLifecyclePhase;
  readonly methodName: string;
  readonly ownerResPath: string;
  readonly nodeId: number;
  readonly evidenceClaimId: string;
}

const LIFECYCLE_METHODS: readonly {
  readonly phase: BoundGodotLifecyclePhase;
  readonly methodName: string;
}[] = [
  { phase: 'enter-tree', methodName: '_enter_tree' },
  { phase: 'ready', methodName: '_ready' },
  { phase: 'process', methodName: '_process' },
  { phase: 'physics-process', methodName: '_physics_process' },
  { phase: 'input', methodName: '_input' },
  { phase: 'shortcut-input', methodName: '_shortcut_input' },
  { phase: 'unhandled-input', methodName: '_unhandled_input' },
  { phase: 'unhandled-key-input', methodName: '_unhandled_key_input' },
  { phase: 'exit-tree', methodName: '_exit_tree' },
];

export interface BoundGodotProjectEntrypoints {
  readonly mainScene?: string;
  readonly autoloads: readonly {
    readonly name: string;
    readonly resPath: string;
    readonly singleton: boolean;
    readonly kind: Autoload['kind'];
  }[];
}

/** A bone of an imported skeleton: its name, glTF joint node and the importer's pose. */
export interface BoundGodotImportedBone {
  readonly name: string;
  readonly gltfNode: number;
  readonly pose: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
  };
}

export interface BoundGodotSceneDocument {
  readonly resPath: string;
  readonly sourceDigest: string;
  readonly sourceKind: 'packed-scene' | 'imported-gltf';
  /** One normalized row per effective or unresolved authored node; no downstream tree walk. */
  readonly nodes: readonly BoundGodotSceneNode[];
  /**
   * An imported model's source (`.glb`): its bytes, and each Godot node path the importer made
   * from a glTF node, by that node's `nodes[]` index (`GltfSceneOrigin`).
   */
  readonly model?: {
    readonly bytes: Uint8Array;
    readonly nodeIndexByPath: Readonly<Record<string, number>>;
    /** Each Skeleton3D's bones in Godot's order: names, glTF joint nodes and imported poses. */
    readonly bonesByPath: Readonly<Record<string, readonly BoundGodotImportedBone[]>>;
    readonly externalImageUris: readonly string[];
  };
  /** The document's `[sub_resource]`s and `[ext_resource]`s (an instance's copied under its ids). */
  readonly subResources: readonly BoundGodotResourceData[];
  readonly extResources: readonly BoundGodotExtResource[];
  readonly connectionCount: number;
  /** The document's `[connection]` lines, as authored. */
  readonly connections: readonly BoundGodotSceneConnection[];
  readonly subResourceCount: number;
  readonly editablePaths: readonly string[];
}

/** One authored `[connection]`: `from`'s signal calls `method` on `to` (node paths in the document). */
export interface BoundGodotSceneConnection {
  readonly signal: string;
  readonly from: string;
  readonly to: string;
  readonly method: string;
  /** `Object::ConnectFlags` beyond `CONNECT_PERSIST`; 0 when only the default was saved. */
  readonly flags: number;
  /** Arguments bound onto (`binds`) or dropped from (`unbinds`) the call. */
  readonly bindCount: number;
  readonly unbinds: number;
}

export interface BoundGodotSceneNodeClass {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly authoredName: string;
  readonly nativeName: string;
  readonly nativeCanonicalIdentity: string;
  /** Native ClassDB ancestry, the selected class first and Object last. */
  readonly nativeAncestry: readonly string[];
  readonly nativeAncestryEvidenceClaimId: string;
  readonly resolutionEvidenceClaimId: string;
  readonly source:
    | { readonly kind: 'native-class' }
    | { readonly kind: 'project-script-class'; readonly scriptResPath: string };
}

export interface BoundGodotNodeOrigin {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly gltfNodeIndex?: number;
  readonly gltfName?: string;
}

export type BoundGodotSceneNodePlacement =
  | { readonly kind: 'root' }
  | { readonly kind: 'child'; readonly parentNodePath: string }
  | {
      readonly kind: 'unresolved-parent';
      readonly authoredParentPath: string;
      readonly inheritedParent?: BoundGodotNodeOrigin;
    };

export interface BoundGodotSceneNode {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly name: string;
  readonly class: BoundGodotSceneNodeClass;
  readonly placement: BoundGodotSceneNodePlacement;
  readonly authoredProperties: Readonly<Record<string, GodotValue>>;
  readonly nodePathProperties: readonly string[];
  readonly groups: readonly string[];
  readonly scriptResPath?: string;
  readonly instanceSceneResPath?: string;
  readonly instancePlaceholderResPath?: string;
  readonly inheritedNode?: BoundGodotNodeOrigin;
  readonly ownerPath?: string;
  readonly sourceOrder?: number;
  readonly siblingIndex?: number;
}

/** Decoded project documents with snapshot provenance; translation never reopens their paths. */
/** A resource a document declares (`[sub_resource]`, or a `.tres`'s `[resource]`), as authored. */
export interface BoundGodotResourceData {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, GodotValue>>;
}

/** A document's `[ext_resource]`: the resource another file holds. */
export interface BoundGodotExtResource {
  readonly id: string;
  readonly type: string;
  readonly resPath: string;
}

/** One `.tres` resource document: its own resource and the resources it declares. */
export interface BoundGodotResourceDocument {
  readonly resPath: string;
  readonly sourceDigest: string;
  readonly resource: BoundGodotResourceData;
  readonly subResources: readonly BoundGodotResourceData[];
  readonly extResources: readonly BoundGodotExtResource[];
}

export interface BoundGodotProjectDocuments {
  readonly scenes: readonly BoundGodotSceneDocument[];
  readonly resources: readonly BoundGodotResourceDocument[];
  /** Images Godot's `texture` importer imports: the source bytes and the importer's options. */
  readonly textures: readonly BoundGodotTextureDocument[];
}

/** An image imported as a `CompressedTexture2D` (`[remap] importer="texture"`). */
export interface BoundGodotTextureDocument {
  readonly resPath: string;
  readonly sourceDigest: string;
  readonly bytes: Uint8Array;
  readonly importParams: GodotTextureImportParams;
}

export interface BoundGodotScriptMethod {
  readonly nodeId: number;
  readonly name: string;
  readonly static: boolean;
  readonly coroutine: boolean;
}

export interface BoundGodotScriptClass {
  readonly rootNodeId: number;
  readonly fqcn: string;
  readonly abstract: boolean;
  readonly methods: readonly BoundGodotScriptMethod[];
}

export type BoundGodotImmediateBase =
  | { readonly kind: 'script'; readonly resPath: string }
  | { readonly kind: 'native'; readonly className: string }
  | { readonly kind: 'unresolved'; readonly reason: string };

export interface BoundGodotScriptInheritance {
  readonly immediate: BoundGodotImmediateBase;
  /** Project script ancestors, nearest first. */
  readonly scriptAncestors: readonly string[];
  readonly engineBase?: string;
  readonly refusal?: string;
  readonly evidenceClaimId: string;
}

/**
 * The one immutable join handed from source acquisition to analysis and translation.
 *
 * It deliberately contains no source root, handwritten syntax tree, parser object, callback or
 * lazy filesystem handle. Later analysis products extend this data graph with resolved project
 * relationships; they never reacquire the source bytes represented here.
 */
export interface BoundGodotProject {
  readonly version: typeof BOUND_GODOT_PROJECT_VERSION;
  readonly snapshotDigest: string;
  /** `[application] config/name`, normalized by the one project reader. */
  readonly projectName: string;
  /** Authored viewport extent. Absence remains explicit for translation to resolve or refuse. */
  readonly window?: { readonly width: number; readonly height: number };
  readonly engine: GodotProjectSnapshot['engine'];
  readonly authority: GodotSourceAuthority;
  /** Complete classified source census without captured bytes or a filesystem handle. */
  readonly inputs: readonly GodotProjectSnapshotEntry[];
  /** Exhaustive reader product, minus the filesystem root that later phases may never reacquire. */
  readonly read: Omit<GodotProject, 'projectDir'>;
  /** Exact normalized import/resource program selected from the same reader product. */
  readonly resourceProgram: BoundGodotResourceProgram;
  readonly analysisEvidence: {
    readonly claimIds: readonly string[];
    readonly registryDigest: string;
  };
  readonly documents: BoundGodotProjectDocuments;
  readonly scripts: readonly BoundGodotSourceScript[];
  readonly entrypoints: BoundGodotProjectEntrypoints;
}

type DecodedProjectRelationships = GodotProject;

class AnalysisEvidence {
  readonly claimIds = new Set<string>();
  readonly resolver: GodotAnalysisAuthorityResolver;

  constructor(authority: GodotAnalysisAuthority) {
    this.resolver = new GodotAnalysisAuthorityResolver(authority);
  }

  require(id: GodotAnalysisRuleId): string {
    const claimId = this.resolver.require(id).claimId;
    this.claimIds.add(claimId);
    return claimId;
  }

  /** The rule's live claim, or undefined when the rule has no live evidence (the join refuses). */
  liveClaim(id: GodotAnalysisRuleId): string | undefined {
    try {
      return this.require(id);
    } catch {
      return undefined;
    }
  }
}

function retainedReadProduct(project: GodotProject): Omit<GodotProject, 'projectDir'> {
  const { projectDir: _sourceRoot, ...retained } = project;
  return retained;
}

interface BoundProjectSceneClass {
  readonly className: string;
  readonly resPath: string;
  readonly nativeName: string;
}

function nativeAncestry(
  selected: GodotApiClass,
  classes: ReadonlyMap<string, GodotApiClass>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current: GodotApiClass | undefined = selected;
  while (current !== undefined) {
    if (seen.has(current.name))
      throw new Error(`ClassDB inheritance cycle through ${current.name}`);
    seen.add(current.name);
    result.push(current.name);
    if (current.base_class === '') break;
    const base = current.base_class;
    current = classes.get(base);
    if (current === undefined) {
      throw new Error(`ClassDB ${result.at(-1)} inherits missing ${base}`);
    }
  }
  return result;
}

type ResolvedSceneClass = Omit<BoundGodotSceneNodeClass, 'documentPath' | 'nodePath'>;

function sceneClassResolver(
  authority: GodotSourceAuthority,
  apiDump: GodotApiDump,
  projectClasses: readonly BoundProjectSceneClass[],
  evidence: AnalysisEvidence,
): (authoredName: string) => ResolvedSceneClass {
  const native = new Map<string, GodotApiClass>();
  for (const entry of apiDump.classes) {
    if (native.has(entry.name)) throw new Error(`ClassDB repeats class ${entry.name}`);
    native.set(entry.name, entry);
  }
  const global = new Map<string, BoundProjectSceneClass>();
  for (const entry of projectClasses) {
    if (global.has(entry.className)) {
      throw new Error(`project repeats global class ${entry.className}`);
    }
    global.set(entry.className, entry);
  }
  const cache = new Map<string, ResolvedSceneClass>();
  return (authoredName: string): ResolvedSceneClass => {
    const cached = cache.get(authoredName);
    if (cached !== undefined) return cached;
    const declared = global.get(authoredName);
    const candidate = declared?.nativeName ?? authoredName;
    const scriptResPath = declared?.resPath;
    if (!native.has(candidate))
      throw new Error(`node class ${authoredName} is absent from the exact ClassDB`);
    const selected = native.get(candidate) as GodotApiClass;
    if (selected.apiType !== 'core') {
      throw new Error(`node class ${authoredName} resolves to editor-only ${selected.name}`);
    }
    const resolved: ResolvedSceneClass = {
      authoredName,
      nativeName: selected.name,
      nativeCanonicalIdentity: [authority.revision, 'ClassDB', selected.name].join('\0'),
      nativeAncestry: nativeAncestry(selected, native),
      nativeAncestryEvidenceClaimId: evidence.require('native-ancestry'),
      resolutionEvidenceClaimId: evidence.require('scene-class-resolution'),
      source:
        scriptResPath === undefined
          ? { kind: 'native-class' }
          : { kind: 'project-script-class', scriptResPath },
    };
    cache.set(authoredName, resolved);
    return resolved;
  };
}

function parentNodePath(nodePath: string): string {
  const separator = nodePath.lastIndexOf('/');
  return separator < 0 ? '.' : nodePath.slice(0, separator);
}

function optionalBoundNodeFacts(node: SceneNode | UnplacedNode) {
  return {
    ...(node.scriptPath === undefined ? {} : { scriptResPath: node.scriptPath }),
    ...(node.instanceOf === undefined ? {} : { instanceSceneResPath: node.instanceOf }),
    ...(node.instancePlaceholder === undefined
      ? {}
      : { instancePlaceholderResPath: node.instancePlaceholder }),
    ...(node.inheritedNode === undefined ? {} : { inheritedNode: node.inheritedNode }),
    ...(node.ownerPath === undefined ? {} : { ownerPath: node.ownerPath }),
    ...(node.sourceOrder === undefined ? {} : { sourceOrder: node.sourceOrder }),
    ...(node.siblingIndex === undefined ? {} : { siblingIndex: node.siblingIndex }),
  };
}

function normalizedAuthoredNodeProperties(
  node: SceneNode | UnplacedNode,
  scriptFieldNames: ReadonlySet<string>,
): Readonly<Record<string, GodotValue>> {
  return Object.fromEntries(
    Object.entries(node.properties).filter(
      ([name]) =>
        !(name === 'script' && node.scriptPath !== undefined) && !scriptFieldNames.has(name),
    ),
  );
}

function boundSceneNodes(
  scene: SceneDocument,
  indexedNodes: readonly IndexedSceneNode[],
  resolve: (authoredName: string) => ResolvedSceneClass,
  projectNodes: ReadonlyMap<string, SceneNode | UnplacedNode>,
  scriptFields: ReadonlyMap<string, ReadonlySet<string>>,
): readonly BoundGodotSceneNode[] {
  const rows: BoundGodotSceneNode[] = [];
  const inheritedClass = (
    node: SceneNode | UnplacedNode,
    seen: ReadonlySet<string> = new Set(),
  ): string | undefined => {
    if (node.type !== undefined) return node.type;
    const origin =
      node.inheritedNode ??
      (node.instanceOf === undefined
        ? undefined
        : { documentPath: node.instanceOf, nodePath: '.' });
    if (origin === undefined) return undefined;
    const key = `${origin.documentPath}\0${origin.nodePath}`;
    if (seen.has(key)) throw new Error(`scene node inheritance cycle through ${key}`);
    const inherited = projectNodes.get(key);
    return inherited === undefined ? undefined : inheritedClass(inherited, new Set([...seen, key]));
  };
  const add = ({ nodePath, node, placement }: IndexedSceneNode): void => {
    const authoredName = inheritedClass(node);
    if (authoredName === undefined) {
      if ('projectionCarrier' in node && node.projectionCarrier !== undefined) return;
      throw new Error(`${scene.resPath}#${nodePath}: node class is unresolved`);
    }
    let resolved: ResolvedSceneClass;
    try {
      resolved = resolve(authoredName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${scene.resPath}#${nodePath}: ${message}`, { cause: error });
    }
    const resolvedClass: BoundGodotSceneNodeClass = {
      documentPath: scene.resPath,
      nodePath,
      ...resolved,
    };
    rows.push({
      documentPath: scene.resPath,
      nodePath,
      name: node.name,
      class: resolvedClass,
      placement,
      authoredProperties: normalizedAuthoredNodeProperties(
        node,
        scriptFields.get(`${scene.resPath}\0${nodePath}`) ?? new Set(),
      ),
      nodePathProperties: node.nodePathProperties,
      groups: node.groups,
      ...optionalBoundNodeFacts(node),
    });
  };
  for (const indexed of indexedNodes) add(indexed);
  return rows;
}

function boundDocuments(
  snapshot: GodotProjectSnapshotReader,
  authority: GodotSourceAuthority,
  apiDump: GodotApiDump,
  decoded: DecodedProjectRelationships,
  projectClasses: readonly BoundProjectSceneClass[],
  projectNodes: IndexedSceneNodeIndex,
  scriptFields: ReadonlyMap<string, ReadonlySet<string>>,
  evidence: AnalysisEvidence,
): BoundGodotProjectDocuments {
  const resolveSceneClass = sceneClassResolver(authority, apiDump, projectClasses, evidence);
  const provenance = (document: { readonly resPath: string }) => {
    const entry = snapshot.entryByResPath(document.resPath);
    if (entry?.entryType !== 'file' || entry.digest === undefined) {
      throw new Error(`${document.resPath}: decoded document has no captured source bytes`);
    }
    return { resPath: document.resPath, sourceDigest: entry.digest };
  };
  const unique = <T extends { readonly resPath: string }>(
    kind: string,
    documents: readonly T[],
  ): readonly T[] => {
    const seen = new Set<string>();
    return [...documents]
      .sort((left, right) => left.resPath.localeCompare(right.resPath))
      .map((document) => {
        if (seen.has(document.resPath)) {
          throw new Error(`decoded project repeats ${kind} ${document.resPath}`);
        }
        seen.add(document.resPath);
        return document;
      });
  };
  return {
    scenes: unique(
      'scene',
      decoded.scenes.map((document) => {
        return {
          ...provenance(document),
          sourceKind: document.gltfOrigin === undefined ? 'packed-scene' : 'imported-gltf',
          ...(document.gltfOrigin === undefined
            ? {}
            : {
                model: {
                  bytes: snapshot.bytesByResPath(document.resPath),
                  nodeIndexByPath: Object.fromEntries(document.gltfOrigin.nodeIndexByPath),
                  bonesByPath: Object.fromEntries(document.gltfOrigin.bonesByPath),
                  externalImageUris: document.gltfOrigin.externalImageUris,
                },
              }),
          nodes: boundSceneNodes(
            document,
            projectNodes.byDocument.get(document.resPath) ?? [],
            resolveSceneClass,
            projectNodes.byKey,
            scriptFields,
          ),
          subResources: document.subResources.map((resource) => ({
            id: String(resource.id),
            type: resource.type,
            properties: resource.properties,
          })),
          extResources: document.extResources.map((resource) => ({
            id: String(resource.id),
            type: resource.type,
            resPath: resource.resPath,
          })),
          connectionCount: document.connections.length,
          connections: document.connections.map((connection) => ({
            signal: connection.signal,
            from: connection.from,
            to: connection.to,
            method: connection.method,
            flags: (connection.flags ?? 2) & ~2,
            bindCount: connection.binds?.length ?? connection.bindCount ?? 0,
            unbinds: connection.unbinds ?? 0,
          })),
          subResourceCount: document.subResources.length,
          editablePaths: document.editablePaths,
        };
      }),
    ),
    textures: unique(
      'texture',
      decoded.imports.flatMap((sidecar) => {
        if (sidecar.importer !== 'texture' || sidecar.resourceType !== 'CompressedTexture2D') return [];
        if (sidecar.sourceFile === undefined || sidecar.textureImport === undefined) return [];
        const entry = snapshot.entryByResPath(sidecar.sourceFile);
        if (entry?.entryType !== 'file' || entry.digest === undefined) return [];
        return [
          {
            resPath: sidecar.sourceFile,
            sourceDigest: entry.digest,
            bytes: snapshot.bytesByResPath(sidecar.sourceFile),
            importParams: sidecar.textureImport,
          },
        ];
      }),
    ),
    resources: unique(
      'resource',
      decoded.resources.map((document) => ({
        ...provenance(document),
        resource: { id: '', type: document.type, properties: document.properties },
        subResources: document.subResources.map((resource) => ({
          id: String(resource.id),
          type: resource.type,
          properties: resource.properties,
        })),
        extResources: document.extResources.map((resource) => ({
          id: String(resource.id),
          type: resource.type,
          resPath: resource.resPath,
        })),
      })),
    ),
  };
}

/**
 * A reader ERROR (a missing file, an unreadable document) refuses the project here. A reader
 * WARNING is a fact translation must discharge where it is used: an opaque asset format is copied
 * or converted by the family that references it, and a model instanced as a scene is planned by
 * its node family. Translation refuses at that use when no family plans it; a warning never
 * disappears silently, because the read product carries it into the bound project.
 */
function refuseDecodedDiagnostics(all: readonly Diagnostic[]): void {
  const diagnostics = all.filter((diagnostic) => diagnostic.severity === 'error');
  if (diagnostics.length === 0) return;
  throw new Error(
    diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.at}: reader ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
      )
      .join('\n'),
  );
}

function indexedScriptFieldProperties(
  scripts: readonly BoundGodotSourceScript[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const script of scripts) {
    for (const field of script.fields) {
      for (const attachment of field.attachmentValues) {
        if (attachment.source !== 'authored-value') continue;
        const key = `${attachment.documentPath}\0${attachment.nodePath}`;
        const names = result.get(key) ?? new Set<string>();
        names.add(field.name);
        result.set(key, names);
      }
    }
  }
  return result;
}

function normalizedAttachments(
  attachments: readonly ScriptAttachment[],
  nodes: ReadonlyMap<string, SceneNode | UnplacedNode>,
  evidence: AnalysisEvidence,
): readonly BoundGodotScriptAttachment[] {
  const seen = new Set<string>();
  return attachments
    .flatMap((attachment): BoundGodotScriptAttachment[] => {
      const nodePath = attachment.nodePath ?? '.';
      const key = `${attachment.documentPath}\0${nodePath}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const node = nodes.get(key);
      if (node === undefined) {
        throw new Error(
          `${attachment.documentPath}#${nodePath}: decoded script attachment has no node`,
        );
      }
      return [
        {
          documentPath: attachment.documentPath,
          nodePath,
          ...(node.type === undefined ? {} : { nodeClass: node.type }),
          authoredProperties: node.properties,
          nodePathProperties: node.nodePathProperties,
          evidenceClaimId: evidence.require('field-attachment-join'),
        },
      ];
    })
    .sort((left, right) =>
      `${left.documentPath}\0${left.nodePath}`.localeCompare(
        `${right.documentPath}\0${right.nodePath}`,
      ),
    );
}

interface IndexedSceneNode {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly node: SceneNode | UnplacedNode;
  readonly placement: BoundGodotSceneNodePlacement;
}

interface IndexedSceneNodeIndex {
  readonly byKey: ReadonlyMap<string, SceneNode | UnplacedNode>;
  readonly byDocument: ReadonlyMap<string, readonly IndexedSceneNode[]>;
}

function indexedSceneNodes(decoded: DecodedProjectRelationships): IndexedSceneNodeIndex {
  const byKey = new Map<string, SceneNode | UnplacedNode>();
  const byDocument = new Map<string, IndexedSceneNode[]>();
  const add = (entry: IndexedSceneNode): void => {
    const { documentPath, nodePath, node } = entry;
    const key = `${documentPath}\0${nodePath}`;
    if (byKey.has(key)) throw new Error(`${documentPath}#${nodePath}: decoded scene repeats node`);
    byKey.set(key, node);
    const rows = byDocument.get(documentPath) ?? [];
    rows.push(entry);
    byDocument.set(documentPath, rows);
  };
  for (const scene of decoded.scenes) {
    if (scene.root !== undefined) {
      walkSceneNodes(scene.root, (node) =>
        add({
          documentPath: scene.resPath,
          nodePath: node.path,
          node,
          placement:
            node.path === '.'
              ? { kind: 'root' }
              : { kind: 'child', parentNodePath: parentNodePath(node.path) },
        }),
      );
    }
    for (const node of scene.unplacedNodes) {
      const nodePath =
        node.parentPath === '.' || node.parentPath === ''
          ? node.name
          : `${node.parentPath}/${node.name}`;
      add({
        documentPath: scene.resPath,
        nodePath,
        node,
        placement: {
          kind: 'unresolved-parent',
          authoredParentPath: node.parentPath,
          ...(node.inheritedParent === undefined ? {} : { inheritedParent: node.inheritedParent }),
        },
      });
    }
  }
  return { byKey, byDocument };
}

/** The first @onready member of a script, if it has one. */
function firstOnreadyField(script: GodotBoundScript): number | undefined {
  return classRoot(script).members.find((nodeId) => {
    const node = script.nodes[nodeId];
    return node?.kind === 'VARIABLE' && node.onready;
  });
}

function lifecycleEntries(
  resPath: string,
  ancestry: BoundGodotScriptInheritance,
  classes: ReadonlyMap<string, BoundGodotScriptClass>,
  evidence: AnalysisEvidence,
  onreadyField: (resPath: string) => number | undefined,
): readonly BoundGodotLifecycleEntry[] {
  const owners = [resPath, ...ancestry.scriptAncestors];
  return LIFECYCLE_METHODS.flatMap(({ phase, methodName }): BoundGodotLifecycleEntry[] => {
    if (phase === 'ready') {
      // NOTIFICATION_READY calls `_ready` on the script instance whether or not a script defines
      // it, and that call runs every @onready initializer first (`GDScriptInstance::callp`,
      // gdscript.cpp:1946): a chain with @onready fields takes part in the ready phase.
      for (const ownerResPath of owners) {
        const nodeId = onreadyField(ownerResPath);
        if (nodeId !== undefined) {
          return [
            {
              phase,
              methodName,
              ownerResPath: resPath,
              nodeId,
              evidenceClaimId: evidence.require('lifecycle-selection'),
            },
          ];
        }
      }
    }
    for (const ownerResPath of owners) {
      const method = classes
        .get(ownerResPath)
        ?.methods.find((candidate) => !candidate.static && candidate.name === methodName);
      if (method !== undefined) {
        return [
          {
            phase,
            methodName,
            ownerResPath,
            nodeId: method.nodeId,
            evidenceClaimId: evidence.require('lifecycle-selection'),
          },
        ];
      }
    }
    return [];
  });
}

function scriptFields(
  script: GodotBoundScript,
  attachments: readonly BoundGodotScriptAttachment[],
  evidence: AnalysisEvidence,
): readonly BoundGodotScriptField[] {
  const root = classRoot(script);
  return root.members.flatMap((nodeId): BoundGodotScriptField[] => {
    const node = script.nodes[nodeId];
    if (node?.kind !== 'VARIABLE') return [];
    const name = identifier(script, node.identifier).name;
    return [
      {
        nodeId,
        name,
        static: node.static,
        exported: node.exported,
        datatype: node.datatype,
        initialization: node.static
          ? 'class-load'
          : node.onready
            ? 'ready'
            : 'instance-construction',
        ...(node.initializer < 0 ? {} : { initializerNodeId: node.initializer }),
        ...(node.setter < 0 ? {} : { setterNodeId: node.setter }),
        ...(node.getter < 0 ? {} : { getterNodeId: node.getter }),
        attachmentValues: node.static
          ? []
          : attachments.map((attachment) => {
              const authoredValue = attachment.authoredProperties[name];
              const authored = node.exported && authoredValue !== undefined;
              return {
                documentPath: attachment.documentPath,
                nodePath: attachment.nodePath,
                source: authored ? 'authored-value' : 'script-default',
                valueKind: attachment.nodePathProperties.includes(name)
                  ? 'node-reference'
                  : 'value',
                ...(authored ? { authoredValue } : {}),
              };
            }),
        evidenceClaimId: evidence.require('field-attachment-join'),
      },
    ];
  });
}

function classRoot(script: GodotBoundScript): GodotBoundClassNode {
  const root = script.nodes[script.rootNodeId];
  if (root?.kind !== 'CLASS') {
    throw new Error(`${script.resPath}: official frontend root is not a CLASS node`);
  }
  return root;
}

function identifier(script: GodotBoundScript, nodeId: number): GodotBoundIdentifierNode {
  const node = script.nodes[nodeId];
  if (node?.kind !== 'IDENTIFIER') {
    throw new Error(`${script.resPath}: official member identifier ${String(nodeId)} is missing`);
  }
  return node;
}

function scriptClass(script: GodotBoundScript): BoundGodotScriptClass {
  const root = classRoot(script);
  const methods = root.members.flatMap((nodeId): readonly BoundGodotScriptMethod[] => {
    const node = script.nodes[nodeId];
    if (node?.kind !== 'FUNCTION') return [];
    const fn = node as GodotBoundFunctionNode;
    return [
      {
        nodeId,
        name: identifier(script, fn.identifier).name,
        static: fn.static,
        coroutine: fn.coroutine,
      },
    ];
  });
  return {
    rootNodeId: root.id,
    fqcn: root.fqcn,
    abstract: root.abstract,
    methods,
  };
}

function resolvedScriptPath(owner: string, candidate: string): string {
  if (candidate.startsWith('res://')) return `res://${path.posix.normalize(candidate.slice(6))}`;
  return `res://${path.posix.normalize(path.posix.join(path.posix.dirname(owner.slice(6)), candidate))}`;
}

/**
 * The project's global script classes: each script whose official root datatype names it with a
 * `class_name` (`ScriptServer`'s global class list, which the editor's import registers). A name
 * two scripts declare is left out.
 */
function globalScriptClasses(scripts: ReadonlyMap<string, GodotBoundScript>): ReadonlyMap<string, string> {
  const found = new Map<string, string | null>();
  for (const [resPath, script] of scripts) {
    const root = script.nodes[script.rootNodeId];
    if (root?.kind !== 'CLASS') continue;
    const name = root.datatype.className;
    if (root.datatype.scriptPath !== resPath || !/^[A-Za-z_]\w*$/.test(name)) continue;
    found.set(name, found.has(name) ? null : resPath);
  }
  return new Map([...found].flatMap(([name, resPath]) => (resPath === null ? [] : [[name, resPath] as const])));
}

/**
 * Read the official analyzer's already-selected base identity. The one name it leaves unresolved in
 * the bound program is a global class name in `extends` (`extends Tagged`), which the analyzer
 * resolves through the global class list (`GDScriptAnalyzer::resolve_class_inheritance`,
 * modules/gdscript/gdscript_analyzer.cpp:469): that list is the project's `class_name` scripts.
 */
function immediateBase(
  script: GodotBoundScript,
  globalClasses: ReadonlyMap<string, string> = new Map(),
): BoundGodotImmediateBase {
  const root = classRoot(script);
  const chain = root.extends.map((nodeId) => identifier(script, nodeId));
  const globalBase =
    chain.length === 1 && chain[0]?.datatype.kind === 'UNRESOLVED' ? globalClasses.get(chain[0].name) : undefined;
  const selectedScript =
    chain.find((entry) => entry.datatype.scriptPath !== '')?.datatype.scriptPath ?? globalBase;
  const authoredScript = root.extendsPath;
  if (selectedScript !== undefined || authoredScript !== '') {
    return {
      kind: 'script',
      resPath: resolvedScriptPath(script.resPath, selectedScript ?? authoredScript),
    };
  }
  const selectedNative =
    root.datatype.nativeType ||
    [...chain].reverse().find((entry) => entry.datatype.nativeType !== '')?.datatype.nativeType;
  if (selectedNative !== undefined) return { kind: 'native', className: selectedNative };
  if (chain.length === 0) return { kind: 'native', className: 'RefCounted' };
  return {
    kind: 'unresolved',
    reason: `official frontend selected no script or native base for ${chain.map((part) => part.name).join('.')}`,
  };
}

function resolveInheritance(
  scripts: ReadonlyMap<string, GodotBoundScript>,
  evidence: AnalysisEvidence,
): ReadonlyMap<string, BoundGodotScriptInheritance> {
  const resolved = new Map<string, BoundGodotScriptInheritance>();
  const resolving = new Set<string>();
  const globalClasses = globalScriptClasses(scripts);
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one dependency-directed ancestry walk with exhaustive terminal outcomes
  const visit = (resPath: string): BoundGodotScriptInheritance => {
    const known = resolved.get(resPath);
    if (known !== undefined) return known;
    const script = scripts.get(resPath);
    const evidenceClaimId = evidence.require('script-inheritance');
    if (script === undefined) {
      return {
        immediate: { kind: 'unresolved', reason: `${resPath} is absent from the official program` },
        scriptAncestors: [],
        refusal: `${resPath} is absent from the official program`,
        evidenceClaimId,
      };
    }
    const immediate = immediateBase(script, globalClasses);
    if (immediate.kind === 'native') {
      const result = {
        immediate,
        scriptAncestors: [],
        engineBase: immediate.className,
        evidenceClaimId,
      } as const;
      resolved.set(resPath, result);
      return result;
    }
    if (immediate.kind === 'unresolved') {
      const result = {
        immediate,
        scriptAncestors: [],
        refusal: immediate.reason,
        evidenceClaimId,
      } as const;
      resolved.set(resPath, result);
      return result;
    }
    if (resolving.has(immediate.resPath)) {
      const refusal = `official script inheritance cycle through ${immediate.resPath}`;
      const result = {
        immediate,
        scriptAncestors: [immediate.resPath],
        refusal,
        evidenceClaimId,
      } as const;
      resolved.set(resPath, result);
      return result;
    }
    if (!scripts.has(immediate.resPath)) {
      const refusal = `official base script ${immediate.resPath} is absent from the project snapshot`;
      const result = {
        immediate,
        scriptAncestors: [immediate.resPath],
        refusal,
        evidenceClaimId,
      } as const;
      resolved.set(resPath, result);
      return result;
    }
    resolving.add(resPath);
    const parent = visit(immediate.resPath);
    resolving.delete(resPath);
    const scriptAncestors = [immediate.resPath, ...parent.scriptAncestors];
    const result: BoundGodotScriptInheritance = {
      immediate,
      scriptAncestors,
      ...(parent.engineBase === undefined ? {} : { engineBase: parent.engineBase }),
      ...(parent.refusal === undefined ? {} : { refusal: parent.refusal }),
      evidenceClaimId,
    };
    resolved.set(resPath, result);
    return result;
  };
  for (const resPath of scripts.keys()) visit(resPath);
  return resolved;
}

function assertCompatibleInputs(
  source: GodotProjectSnapshot,
  code: GodotBoundProgram,
  resources: BoundGodotResourceProgram,
  authority: GodotSourceAuthority,
  apiDump: GodotToolchainApiDumpSnapshot,
  decoded: DecodedProjectRelationships,
): void {
  if (authority.major !== source.engine.major) {
    throw new Error('Godot project snapshot and selected frontend authority disagree on engine');
  }
  if (decoded.engine.major !== source.engine.major) {
    throw new Error('Godot decoded project and captured snapshot disagree on engine major');
  }
  if (apiDump.digest !== authority.apiDumpSha256 || apiDump.fileName !== authority.apiDumpFile) {
    throw new Error('Godot ClassDB artifact and selected source authority disagree on exact pin');
  }
  if (apiDump.parsed.major !== authority.major) {
    throw new Error('Godot ClassDB dump and selected source authority disagree on engine major');
  }
  assertBoundGodotResourceProgram(resources);
  if (code.engine.major !== source.engine.major || resources.engineMajor !== source.engine.major) {
    throw new Error(
      'Godot snapshot, official bound code, and resource program disagree on engine major',
    );
  }
  if (
    code.authority.sourceRevision !== authority.revision ||
    resources.sourceRevision !== authority.revision ||
    resources.apiDumpSha256 !== authority.apiDumpSha256
  ) {
    throw new Error('Godot bound project inputs do not share the selected exact source authority');
  }
}

/** Join only already-selected official meaning and captured resource facts. */
export function bindGodotProject(
  source: GodotProjectSnapshot,
  code: GodotBoundProgram,
  resources: BoundGodotResourceProgram,
  analysisAuthority: GodotAnalysisAuthority,
  authority: GodotSourceAuthority,
  apiDump: GodotToolchainApiDumpSnapshot,
  decoded: DecodedProjectRelationships,
): BoundGodotProject {
  assertCompatibleInputs(source, code, resources, authority, apiDump, decoded);
  const analysisEvidence = new AnalysisEvidence(analysisAuthority);
  if (analysisEvidence.resolver.sourceRevision !== authority.revision) {
    throw new Error('Godot analysis authority and selected source authority disagree');
  }
  refuseDecodedDiagnostics(decoded.diagnostics);
  const snapshot = new GodotProjectSnapshotReader(source);
  const seen = new Set<string>();
  const programs = new Map<string, GodotBoundScript>();
  for (const program of code.scripts) {
    if (seen.has(program.resPath)) throw new Error(`official frontend repeats ${program.resPath}`);
    seen.add(program.resPath);
    programs.set(program.resPath, program);
  }
  const inheritance = resolveInheritance(programs, analysisEvidence);
  const classes = new Map(
    code.scripts.map((program) => [program.resPath, scriptClass(program)] as const),
  );
  const sceneNodes = indexedSceneNodes(decoded);
  const attachmentsByScript = indexParsedSceneScriptAttachments(decoded.scenes);
  const scriptAutoloads = new Map<string, BoundGodotScriptAutoload[]>();
  const singletonTargets: BoundGodotScriptSingletonTarget[] = [];
  for (const autoload of decoded.autoloads) {
    if (!autoload.present || autoload.kind !== 'script') continue;
    const rows = scriptAutoloads.get(autoload.resPath) ?? [];
    rows.push({ name: autoload.name, singleton: autoload.singleton });
    scriptAutoloads.set(autoload.resPath, rows);
    if (!autoload.singleton) continue;
    const targetClass = classes.get(autoload.resPath);
    if (targetClass === undefined) {
      throw new Error(`${autoload.name}: script autoload target is absent: ${autoload.resPath}`);
    }
    singletonTargets.push({
      name: autoload.name,
      resPath: autoload.resPath,
      className: targetClass.fqcn,
    });
  }
  // Which script sits at an exact scene node, and the method names it (and its script ancestors)
  // declares: a dynamic call on that node reaches the script before ClassDB.
  const scriptMethodsByNode = new Map<string, Set<string>>();
  for (const [resPath, rows] of attachmentsByScript) {
    const names = new Set<string>();
    for (const scriptPath of [resPath, ...(inheritance.get(resPath)?.scriptAncestors ?? [])]) {
      for (const method of classes.get(scriptPath)?.methods ?? []) names.add(method.name);
    }
    for (const row of rows) {
      scriptMethodsByNode.set(`${row.documentPath}\0${row.nodePath ?? '.'}`, names);
    }
  }
  // `self`: the native class at the root of the script's chain, and the methods the chain
  // declares (a script member is called before ClassDB's).
  const selfReceiver = (resPath: string) => {
    const chain = [resPath, ...(inheritance.get(resPath)?.scriptAncestors ?? [])];
    const root = inheritance.get(chain[chain.length - 1] as string)?.immediate;
    if (root?.kind !== 'native') return undefined;
    const methods = new Set<string>();
    for (const scriptPath of chain) {
      for (const method of classes.get(scriptPath)?.methods ?? []) methods.add(method.name);
    }
    return { nativeClass: root.className, scriptMethods: methods };
  };
  const programsByPath = new Map(code.scripts.map((program) => [program.resPath, program] as const));
  const scriptByNode = new Map<string, string>();
  for (const [resPath, rows] of attachmentsByScript) {
    for (const row of rows) scriptByNode.set(`${row.documentPath}\0${row.nodePath ?? '.'}`, resPath);
  }
  /** A script's class name, native base, and its (and its ancestors') member variable types. */
  const refinedScriptInfo = (resPath: string): RefinedScriptInfo | undefined => {
    const fqcn = classes.get(resPath)?.fqcn;
    const engineBase = inheritance.get(resPath)?.engineBase;
    if (fqcn === undefined || engineBase === undefined) return undefined;
    return {
      className: fqcn.startsWith('res://') || fqcn.includes('::') ? '' : fqcn,
      nativeBase: engineBase,
      fieldType: (name) => {
        for (const scriptPath of [resPath, ...(inheritance.get(resPath)?.scriptAncestors ?? [])]) {
          const program = programsByPath.get(scriptPath);
          const root = program?.nodes[program.rootNodeId];
          if (program === undefined || root?.kind !== 'CLASS') continue;
          for (const memberId of root.members) {
            const member = program.nodes[memberId];
            if (member?.kind !== 'VARIABLE') continue;
            const identifier = program.nodes[member.identifier];
            if (identifier?.kind === 'IDENTIFIER' && identifier.name === name) return member.datatype;
          }
        }
        return undefined;
      },
    };
  };
  const onreadyField = (resPath: string): number | undefined => {
    const program = programsByPath.get(resPath);
    return program === undefined ? undefined : firstOnreadyField(program);
  };
  const scripts = code.scripts.map((program): BoundGodotSourceScript => {
    const entry = snapshot.entryByResPath(program.resPath);
    if (
      entry?.entryType !== 'file' ||
      entry.kind !== 'source-config' ||
      entry.digest === undefined ||
      entry.digest !== program.sourceSha256
    ) {
      throw new Error(
        `${program.resPath}: official script bytes do not match the project snapshot`,
      );
    }
    const scriptInheritance = inheritance.get(program.resPath);
    if (scriptInheritance === undefined) {
      throw new Error(`${program.resPath}: official inheritance analysis produced no result`);
    }
    const attachments = normalizedAttachments(
      attachmentsByScript.get(program.resPath) ?? [],
      sceneNodes.byKey,
      analysisEvidence,
    );
    const callReceiverFacts = (
      bound: GodotBoundScript,
      placed: readonly BoundGodotScriptAttachment[],
    ): Pick<BoundGodotSourceScript, 'callReceivers' | 'untypedCalls'> => {
      const selfOf = selfReceiver(program.resPath);
      const typed = typeCallReceivers({
        program: bound,
        attachments: placed,
        read: decoded,
        apiDump: apiDump.parsed,
        scriptMethodsAt: (documentPath, nodePath) =>
          scriptMethodsByNode.get(`${documentPath}\0${nodePath}`),
        ...(selfOf === undefined ? {} : { self: selfOf }),
        claim: (rule) => analysisEvidence.liveClaim(rule),
      });
      return { callReceivers: typed.receivers, untypedCalls: typed.untyped };
    };
    return {
      resPath: program.resPath,
      sourceDigest: entry.digest,
      program,
      class: classes.get(program.resPath) as BoundGodotScriptClass,
      inheritance: scriptInheritance,
      attachments,
      autoloads: [...(scriptAutoloads.get(program.resPath) ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      singletonReferences: bindGodotScriptSingletonReferences(
        authority.revision,
        program,
        singletonTargets,
      ),
      lifecycle: lifecycleEntries(
        program.resPath,
        scriptInheritance,
        classes,
        analysisEvidence,
        onreadyField,
      ),
      fields: scriptFields(program, attachments, analysisEvidence),
      ...callReceiverFacts(program, attachments),
      refinedTypes: refineDatatypes({
        program,
        attachments,
        read: decoded,
        apiDump: apiDump.parsed,
        scriptAt: (documentPath, nodePath) => scriptByNode.get(`${documentPath}\0${nodePath}`),
        scriptInfo: refinedScriptInfo,
        claim: (rule) => analysisEvidence.liveClaim(rule),
      }),
      settingTypes: typeProjectSettingValues({
        program,
        projectSettings: decoded.authoredSettings,
        apiDump: apiDump.parsed,
        claim: () => analysisEvidence.liveClaim('project-setting-type'),
      }),
    };
  });
  const projectClasses: BoundProjectSceneClass[] = scripts.flatMap((script) => {
    if (script.class.fqcn.startsWith('res://') || script.class.fqcn.includes('::')) return [];
    if (script.inheritance.engineBase === undefined) {
      throw new Error(`${script.resPath}: global class ${script.class.fqcn} has no native base`);
    }
    return [
      {
        className: script.class.fqcn,
        resPath: script.resPath,
        nativeName: script.inheritance.engineBase,
      },
    ];
  });
  const documents = boundDocuments(
    snapshot,
    authority,
    apiDump.parsed,
    decoded,
    projectClasses,
    sceneNodes,
    indexedScriptFieldProperties(scripts),
    analysisEvidence,
  );

  return {
    version: BOUND_GODOT_PROJECT_VERSION,
    snapshotDigest: source.digest,
    projectName: decoded.projectName,
    ...(decoded.window === undefined ? {} : { window: decoded.window }),
    engine: source.engine,
    authority,
    inputs: source.entries,
    read: retainedReadProduct(decoded),
    resourceProgram: resources,
    analysisEvidence: {
      claimIds: [...analysisEvidence.claimIds].sort(),
      registryDigest: analysisEvidence.resolver.registryDigest,
    },
    documents,
    scripts,
    entrypoints: {
      ...(decoded.mainScene === undefined ? {} : { mainScene: decoded.mainScene }),
      autoloads: decoded.autoloads
        .filter((autoload) => autoload.present)
        .map((autoload) => ({
          name: autoload.name,
          resPath: autoload.resPath,
          singleton: autoload.singleton,
          kind: autoload.kind,
        })),
    },
  };
}
