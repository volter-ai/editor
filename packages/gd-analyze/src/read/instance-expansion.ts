/**
 * Project-level expansion of readable Godot PackedScenes.
 *
 * A text scene may parent an authored override below a node supplied by `instance=ExtResource`.
 * The per-file reader cannot place that line because it has not opened the referenced document.
 * Once the project owns every document, this module stamps readable `.tscn` trees exactly: node
 * paths are rebased at the mount, resource ids are namespaced into the owner document, inherited
 * properties are patched in outer-to-inner precedence, and the previously unplaced line joins the
 * real parent. Parsed text `.tscn` and binary `.scn` documents share this path; imported/missing
 * targets remain instance boundaries, because inventing their tree is still forbidden. An
 * `[editable]` marker is not opacity: it authorizes the outer scene's serialized override lines,
 * and those lines are merged below only after the complete readable base tree has been mounted.
 */

import type {
  Diagnostic,
  ExtResourceRef,
  InlineScriptResource,
  SceneDocument,
  SceneNode,
  SignalConnection,
  SubResource,
  UnplacedNode,
} from './godot-types';
import type { GodotEntry, GodotValue, ResourceId } from './godot-value';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

interface ExpandedNode extends Omit<Mutable<SceneNode>, 'children'> {
  children: ExpandedNode[];
}

type IndexedExpandedNode = ExpandedNode | 'ambiguous';

interface MutableDocumentParts {
  readonly extResources: ExtResourceRef[];
  readonly subResources: SubResource[];
  readonly inlineScripts: InlineScriptResource[];
  readonly connections: SignalConnection[];
  importSerial: number;
}

interface ResourceRemap {
  readonly ext: ReadonlyMap<ResourceId, ResourceId>;
  readonly sub: ReadonlyMap<ResourceId, ResourceId>;
}

interface MaterializedScene {
  readonly document: SceneDocument;
  /** True when this result stopped at a cycle selected by the caller's current ancestry. */
  readonly chainSensitive: boolean;
}

interface MaterializedTemplate {
  readonly document: SceneDocument;
  readonly diagnostics: readonly Diagnostic[];
}

export function isReadablePackedScene(
  document: SceneDocument | undefined,
): document is SceneDocument & {
  readonly root: SceneNode;
} {
  // The decoded document shape, not its logical suffix, is the authority. Import remaps expose a
  // binary PackedScene under the SOURCE path ResourceLoader uses (often `.glb`), and binary
  // resource containers can carry a PackedScene under `.res`. Both have an exact decoded root.
  // A source glTF document is deliberately distinct: its retained model host and glTF node
  // addressing must remain intact for the model-patch emitter rather than being flattened here.
  return document?.root !== undefined && document.gltfOrigin === undefined;
}

function childPath(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`;
}

function rebasePath(path: string, mountPath: string): string {
  if (path === '.' || path === '') return mountPath;
  return mountPath === '.' ? path : `${mountPath}/${path}`;
}

function cloneEntry(entry: GodotEntry, remap: ResourceRemap): GodotEntry {
  return {
    key: entry.key,
    ...(entry.keyValue === undefined ? {} : { keyValue: cloneValue(entry.keyValue, remap) }),
    value: cloneValue(entry.value, remap),
  };
}

function cloneValue(value: GodotValue, remap: ResourceRemap): GodotValue {
  if (value.kind === 'array') {
    return {
      kind: 'array',
      items: value.items.map((item) => cloneValue(item, remap)),
      ...(value.elementType === undefined
        ? {}
        : { elementType: cloneValue(value.elementType, remap) }),
    };
  }
  if (value.kind === 'dict') {
    return {
      kind: 'dict',
      entries: value.entries.map((entry) => cloneEntry(entry, remap)),
      ...(value.keyType === undefined ? {} : { keyType: cloneValue(value.keyType, remap) }),
      ...(value.valueType === undefined ? {} : { valueType: cloneValue(value.valueType, remap) }),
    };
  }
  if (value.kind !== 'ctor') return value;
  const first = value.args[0];
  const currentId = first?.kind === 'string' || first?.kind === 'number' ? first.value : undefined;
  const replacement =
    value.name === 'ExtResource' && currentId !== undefined
      ? remap.ext.get(currentId)
      : value.name === 'SubResource' && currentId !== undefined
        ? remap.sub.get(currentId)
        : undefined;
  const args = value.args.map((argument, index) =>
    index === 0 && replacement !== undefined
      ? { kind: 'string' as const, value: String(replacement) }
      : cloneValue(argument, remap),
  );
  return {
    kind: 'ctor',
    name: value.name,
    args,
    fields: value.fields.map((entry) => cloneEntry(entry, remap)),
  };
}

function cloneProperties(
  properties: Readonly<Record<string, GodotValue>>,
  remap: ResourceRemap,
): Readonly<Record<string, GodotValue>> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, cloneValue(value, remap)]),
  );
}

function mergeNames(inner: readonly string[], outer: readonly string[]): readonly string[] {
  return [...new Set([...inner, ...outer])];
}

function cloneLocalNode(node: SceneNode): ExpandedNode {
  // expandNode owns the recursive walk. Deep-cloning here cloned every descendant once for each
  // ancestor and then immediately discarded those cloned children when expandNode replaced them.
  return { ...node, children: [] };
}

function indexExpandedNodes(
  root: ExpandedNode,
  into: Map<string, IndexedExpandedNode>,
  onIndexed?: (path: string) => void,
): number {
  indexExpandedPath(into, root.path, root, onIndexed);
  for (const alias of root.authoredPathAliases ?? []) {
    indexExpandedPath(into, alias, root, onIndexed);
  }
  let count = 1;
  for (const child of root.children) count += indexExpandedNodes(child, into, onIndexed);
  return count;
}

function indexExpandedPath(
  into: Map<string, IndexedExpandedNode>,
  path: string,
  node: ExpandedNode,
  onIndexed?: (path: string) => void,
): void {
  const previous = into.get(path);
  if (previous === undefined) into.set(path, node);
  else if (previous !== node) into.set(path, 'ambiguous');
  onIndexed?.(path);
}

function retainPathAlias(node: ExpandedNode, path: string): void {
  if (path === node.path || node.authoredPathAliases?.includes(path) === true) return;
  node.authoredPathAliases = [...(node.authoredPathAliases ?? []), path];
}

function remapForImport(source: SceneDocument, parts: MutableDocumentParts): ResourceRemap {
  const serial = parts.importSerial++;
  const prefix = `__vgai_instance_${String(serial)}`;
  const ext = new Map<ResourceId, ResourceId>();
  const sub = new Map<ResourceId, ResourceId>();
  for (const ref of source.extResources) ext.set(ref.id, `${prefix}_ext_${String(ref.id)}`);
  for (const ref of source.subResources) sub.set(ref.id, `${prefix}_sub_${String(ref.id)}`);
  const remap = { ext, sub };
  for (const ref of source.extResources) {
    parts.extResources.push({ ...ref, id: ext.get(ref.id) as ResourceId });
  }
  for (const resource of source.subResources) {
    parts.subResources.push({
      ...resource,
      id: sub.get(resource.id) as ResourceId,
      properties: cloneProperties(resource.properties, remap),
    });
  }
  for (const script of source.inlineScripts ?? []) {
    if (!parts.inlineScripts.some((candidate) => candidate.resPath === script.resPath)) {
      parts.inlineScripts.push(script);
    }
  }
  return remap;
}

function cloneImportedNode(
  node: SceneNode,
  mountPath: string,
  remap: ResourceRemap,
  sourceDocumentPath: string,
  rootName?: string,
  sourceRootName: string = node.name,
): ExpandedNode {
  const path = rebasePath(node.path, mountPath);
  const sourcePath =
    node.path === '.' || node.path === '' ? sourceRootName : `${sourceRootName}/${node.path}`;
  const authoredPathAliases = [
    ...new Set([
      ...(node.authoredPathAliases ?? []).map((alias) => rebasePath(alias, mountPath)),
      rebasePath(sourcePath, mountPath),
    ]),
  ].filter((alias) => alias !== path);
  return {
    ...node,
    name: rootName ?? node.name,
    path,
    inheritedNode: { documentPath: sourceDocumentPath, nodePath: node.path },
    // Always overwrite the source document's aliases, including with an empty set, so no
    // unrebased spelling can survive the spread above when the mount canonicalizes it away.
    authoredPathAliases,
    ...(node.ownerPath === undefined ? {} : { ownerPath: rebasePath(node.ownerPath, mountPath) }),
    properties: cloneProperties(node.properties, remap),
    children: node.children.map((child) =>
      cloneImportedNode(child, mountPath, remap, sourceDocumentPath, undefined, sourceRootName),
    ),
  };
}

function remapConnection(
  connection: SignalConnection,
  mountPath: string,
  remap: ResourceRemap,
): SignalConnection {
  return {
    ...connection,
    from: rebasePath(connection.from, mountPath),
    to: rebasePath(connection.to, mountPath),
    ...(connection.binds === undefined
      ? {}
      : { binds: connection.binds.map((value) => cloneValue(value, remap)) }),
  };
}

function instanceDiagnostic(
  diagnostics: Diagnostic[],
  scenePath: string,
  nodePath: string,
  code: string,
  message: string,
): void {
  diagnostics.push({ severity: 'warning', code, message, at: `${scenePath}#${nodePath}` });
}

function mergeOverride(target: ExpandedNode, override: SceneNode | UnplacedNode): void {
  if (override.type !== undefined) target.type = override.type;
  if (override.inheritedNode !== undefined) target.inheritedNode = override.inheritedNode;
  if (override.scriptPath !== undefined) {
    target.scriptPath = override.scriptPath;
  } else if (Object.hasOwn(override.properties, 'script')) {
    // `script = null` is a real outer override, not an absent declaration. Leaving the imported
    // scriptPath behind would reattach the base script after Godot explicitly removed it, and the
    // analyzer would then attribute every project member at this runtime node to stale source.
    delete target.scriptPath;
  }
  if (override.ownerPath !== undefined) target.ownerPath = override.ownerPath;
  target.groups = mergeNames(target.groups, override.groups);
  target.nodePathProperties = mergeNames(target.nodePathProperties, override.nodePathProperties);
  target.properties = { ...target.properties, ...override.properties };
}

function insertChild(parent: ExpandedNode, child: ExpandedNode): void {
  const index = child.siblingIndex;
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) {
    parent.children.push(child);
    return;
  }
  parent.children.splice(Math.min(index, parent.children.length), 0, child);
}

function applyInheritedSiblingIndex(
  parent: ExpandedNode,
  child: ExpandedNode,
  siblingIndex: number | undefined,
): void {
  if (siblingIndex === undefined || !Number.isSafeInteger(siblingIndex) || siblingIndex < 0) return;
  const current = parent.children.indexOf(child);
  if (current < 0) return;
  parent.children.splice(current, 1);
  parent.children.splice(Math.min(siblingIndex, parent.children.length), 0, child);
}

function isInheritedOverride(node: SceneNode | UnplacedNode): boolean {
  return (
    node.type === undefined &&
    node.instanceOf === undefined &&
    node.instancePlaceholder === undefined
  );
}

function inheritedOverrideTarget(
  parent: ExpandedNode,
  override: SceneNode | UnplacedNode,
  instanceRoot: ExpandedNode = parent,
): ExpandedNode | undefined {
  if (!isInheritedOverride(override)) return undefined;
  const named = parent.children.find((candidate) => candidate.name === override.name);
  if (named !== undefined) return named;

  // Godot 3 resolves an instantiated node by asking the serialized parent for a DIRECT child of
  // this name (`PackedScene::instantiate`, TYPE_INSTANTIATED). `index=` is where that already
  // resolved child is ordered; it is not a path-independent node id. Old editable-instance data
  // can survive after the source scene reparents a node, leaving the same name elsewhere in the
  // instance tree. In that case Godot reports the override as vanished and ignores the line. Do
  // not reinterpret its destination index as a rename of the unrelated child now occupying it.
  const inheritedDocument = parent.inheritedNode?.documentPath;
  const namedElsewhere = (node: ExpandedNode): boolean => {
    if (
      inheritedDocument !== undefined &&
      node !== parent &&
      node.name === override.name &&
      node.inheritedNode?.documentPath === inheritedDocument
    ) {
      return true;
    }
    return node.children.some(namedElsewhere);
  };
  if (namedElsewhere(instanceRoot)) return undefined;

  // A changed name has no surviving same-name source node. Retain the exact sibling-position
  // recovery used by newer inherited scenes, whose stable serialized position is the only source
  // identity available after the rename.
  const index = override.siblingIndex;
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) return undefined;
  return parent.children[index];
}

function adoptOverrideIdentity(target: ExpandedNode, override: SceneNode | UnplacedNode): void {
  if (target.name === override.name) return;
  const previousPath = target.path;
  const nextPath = childPath(
    'parentPath' in override
      ? override.parentPath
      : override.path.includes('/')
        ? override.path.slice(0, override.path.lastIndexOf('/'))
        : '.',
    override.name,
  );
  const rebase = (path: string): string =>
    path === previousPath
      ? nextPath
      : path.startsWith(`${previousPath}/`)
        ? `${nextPath}${path.slice(previousPath.length)}`
        : path;
  const visit = (node: ExpandedNode): void => {
    const authoredPath = node.path;
    node.path = rebase(authoredPath);
    retainPathAlias(node, authoredPath);
    if (node.ownerPath !== undefined) node.ownerPath = rebase(node.ownerPath);
    for (const child of node.children) visit(child);
  };
  target.name = override.name;
  visit(target);
}

function mergeNode(
  target: ExpandedNode,
  override: ExpandedNode,
  instanceRoot: ExpandedNode,
  diagnostics: Diagnostic[],
  scenePath: string,
): void {
  mergeOverride(target, override);
  for (const child of override.children) {
    const inherited = inheritedOverrideTarget(target, child, instanceRoot);
    if (inherited !== undefined) {
      adoptOverrideIdentity(inherited, child);
      mergeNode(inherited, child, instanceRoot, diagnostics, scenePath);
      applyInheritedSiblingIndex(target, inherited, child.siblingIndex);
    } else if (isInheritedOverride(child)) {
      // A typeless node is TYPE_INSTANTIATED in Godot's PackedScene state. If no inherited direct
      // child resolves, the engine creates nothing and applies none of the stale properties.
      instanceDiagnostic(
        diagnostics,
        scenePath,
        child.path,
        'instance-override-stale',
        `typeless override "${child.name}" has no inherited direct child below "${target.path}" and is ignored exactly as PackedScene instantiation ignores a vanished override`,
      );
    } else {
      insertChild(target, child);
    }
  }
}

/** Expand every exact parsed text/binary PackedScene instance into an effective retained tree. */
function materialize(
  source: SceneDocument,
  scenes: ReadonlyMap<string, SceneDocument>,
  diagnostics: Diagnostic[],
  chain: readonly string[],
  templates: Map<string, MaterializedTemplate>,
): MaterializedScene {
  if (source.root === undefined) return { document: source, chainSensitive: false };
  const cached = templates.get(source.resPath);
  if (cached !== undefined) {
    diagnostics.push(...cached.diagnostics);
    return { document: cached.document, chainSensitive: false };
  }
  // Cache entries replay the same per-placement diagnostics in the same traversal order. Buffer
  // one candidate template locally until its entire dependency walk proves chain-independent.
  const materializedDiagnostics: Diagnostic[] = [];
  const parts: MutableDocumentParts = {
    extResources: [...source.extResources],
    subResources: [...source.subResources],
    inlineScripts: [...(source.inlineScripts ?? [])],
    connections: [...source.connections],
    importSerial: 0,
  };
  let chainSensitive = false;

  const expandNode = (authored: SceneNode, owner: SceneDocument): ExpandedNode => {
    const local = cloneLocalNode(authored);
    local.children = authored.children.map((child) => expandNode(child, owner));
    if (authored.instancePlaceholder !== undefined) {
      instanceDiagnostic(
        materializedDiagnostics,
        source.resPath,
        authored.path,
        'instance-placeholder-unexpanded',
        `node "${authored.name}" uses instance_placeholder=${authored.instancePlaceholder}; no packed descendants are present to splice`,
      );
      return local;
    }
    if (authored.instanceOf === undefined) return local;
    if (chain.includes(authored.instanceOf) || authored.instanceOf === source.resPath) {
      chainSensitive = true;
      instanceDiagnostic(
        materializedDiagnostics,
        source.resPath,
        authored.path,
        'instance-expansion-cycle',
        `readable scene instance cycle ${[...chain, source.resPath, authored.instanceOf].join(' -> ')}`,
      );
      return local;
    }
    const target = scenes.get(authored.instanceOf);
    if (!isReadablePackedScene(target)) {
      const reference = owner.extResources.find(
        (candidate) => candidate.resPath === authored.instanceOf,
      );
      if (reference?.present === false) {
        instanceDiagnostic(
          materializedDiagnostics,
          source.resPath,
          authored.path,
          'instance-expansion-missing',
          `instance ${authored.instanceOf} has no parsed target and its external resource is missing`,
        );
        return local;
      }
      instanceDiagnostic(
        materializedDiagnostics,
        source.resPath,
        authored.path,
        'instance-expansion-opaque',
        `instance ${authored.instanceOf} is not an exact parsed text/binary PackedScene and remains an opaque runtime boundary`,
      );
      return local;
    }
    const expandedTarget = materialize(
      target,
      scenes,
      materializedDiagnostics,
      [...chain, source.resPath],
      templates,
    );
    if (expandedTarget.chainSensitive) chainSensitive = true;
    if (expandedTarget.document.root === undefined) return local;
    const remap = remapForImport(expandedTarget.document, parts);
    const imported = cloneImportedNode(
      expandedTarget.document.root,
      authored.path,
      remap,
      expandedTarget.document.resPath,
      authored.name,
    );
    delete imported.instanceOf;
    delete imported.instancePlaceholder;
    if (authored.sourceOrder !== undefined) imported.sourceOrder = authored.sourceOrder;
    mergeOverride(imported, authored);
    for (const child of local.children) {
      const inherited = inheritedOverrideTarget(imported, child, imported);
      if (inherited !== undefined) {
        adoptOverrideIdentity(inherited, child);
        mergeNode(inherited, child, imported, materializedDiagnostics, source.resPath);
        applyInheritedSiblingIndex(imported, inherited, child.siblingIndex);
      } else if (isInheritedOverride(child)) {
        instanceDiagnostic(
          materializedDiagnostics,
          source.resPath,
          child.path,
          'instance-override-stale',
          `typeless override "${child.name}" has no inherited direct child below "${imported.path}" and is ignored exactly as PackedScene instantiation ignores a vanished override`,
        );
      } else {
        insertChild(imported, child);
      }
    }
    for (const connection of expandedTarget.document.connections) {
      parts.connections.push(remapConnection(connection, authored.path, remap));
    }
    return imported;
  };

  const root = expandNode(source.root, source);
  const nodesByPath = new Map<string, IndexedExpandedNode>();
  let placedNodeCount = indexExpandedNodes(root, nodesByPath);
  const unresolved = new Set(source.unplacedNodes);
  const waitingByParent = new Map<string, UnplacedNode[]>();
  for (const override of source.unplacedNodes) {
    const waiting = waitingByParent.get(override.parentPath) ?? [];
    waiting.push(override);
    waitingByParent.set(override.parentPath, waiting);
  }

  /** Place one flat authored line only after its complete parent was materialized. A scene can
   * serialize a descendant before the inherited/instanced override which supplies its parent;
   * the text reader correctly retains both as unplaced because neither exists in that document's
   * local tree yet. Expansion is the first point where the parent is authoritative, so placement
   * is a dependency-order operation rather than a one-pass source-order operation. */
  const placeAuthoredNode = (override: UnplacedNode): readonly string[] | undefined => {
    const indexedParent = override.parentPath === '' ? root : nodesByPath.get(override.parentPath);
    if (indexedParent === undefined || indexedParent === 'ambiguous') return undefined;
    const parent = indexedParent;
    const indexedPaths = new Set<string>();
    const retainIndexedPath = (indexedPath: string): void => {
      indexedPaths.add(indexedPath);
    };

    const authoredPath = childPath(override.parentPath, override.name);
    const path = childPath(parent.path, override.name);
    const inherited = inheritedOverrideTarget(parent, override, root);
    if (inherited !== undefined) {
      adoptOverrideIdentity(inherited, override);
      mergeOverride(inherited, override);
      retainPathAlias(inherited, authoredPath);
      indexExpandedNodes(inherited, nodesByPath, retainIndexedPath);
      indexExpandedPath(nodesByPath, authoredPath, inherited, retainIndexedPath);
      applyInheritedSiblingIndex(parent, inherited, override.siblingIndex);
      return [...indexedPaths];
    }
    if (isInheritedOverride(override)) {
      instanceDiagnostic(
        materializedDiagnostics,
        source.resPath,
        authoredPath,
        'instance-override-stale',
        `typeless override "${override.name}" has no inherited direct child below "${parent.path}" and is ignored exactly as PackedScene instantiation ignores a vanished override`,
      );
      return [];
    }

    const added: SceneNode = {
      name: override.name,
      path,
      ...(override.type === undefined ? {} : { type: override.type }),
      ...(override.instanceOf === undefined ? {} : { instanceOf: override.instanceOf }),
      ...(override.instancePlaceholder === undefined
        ? {}
        : { instancePlaceholder: override.instancePlaceholder }),
      ...(override.ownerPath === undefined ? {} : { ownerPath: override.ownerPath }),
      ...(override.sourceOrder === undefined ? {} : { sourceOrder: override.sourceOrder }),
      ...(override.siblingIndex === undefined ? {} : { siblingIndex: override.siblingIndex }),
      ...(override.scriptPath === undefined ? {} : { scriptPath: override.scriptPath }),
      ...(authoredPath === path ? {} : { authoredPathAliases: [authoredPath] }),
      groups: override.groups,
      nodePathProperties: override.nodePathProperties,
      properties: override.properties,
      children: [],
    };
    const expanded = expandNode(added, source);
    insertChild(parent, expanded);
    placedNodeCount += indexExpandedNodes(expanded, nodesByPath, retainIndexedPath);
    return [...indexedPaths];
  };

  // Dependency-indexed ready queue: every authored node is considered once when its parent first
  // becomes concrete. Deep retained parent chains are therefore O(nodes + parent edges), rather
  // than rescanning the whole unresolved set once per depth level.
  const ready: UnplacedNode[] = [];
  const queued = new Set<UnplacedNode>();
  const enqueueChildrenOf = (parentPath: string): void => {
    if (parentPath !== '' && nodesByPath.get(parentPath) === 'ambiguous') return;
    for (const override of waitingByParent.get(parentPath) ?? []) {
      if (!unresolved.has(override) || queued.has(override)) continue;
      queued.add(override);
      ready.push(override);
    }
  };
  enqueueChildrenOf('');
  for (const indexedPath of nodesByPath.keys()) enqueueChildrenOf(indexedPath);
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const override = ready[cursor]!;
    queued.delete(override);
    if (!unresolved.has(override)) continue;
    const indexedPaths = placeAuthoredNode(override);
    if (indexedPaths === undefined) continue;
    unresolved.delete(override);
    for (const indexedPath of indexedPaths) enqueueChildrenOf(indexedPath);
  }
  const remaining = source.unplacedNodes.filter((node) => unresolved.has(node));
  if (remaining.length > 0) {
    const unresolvedPaths = new Set(remaining.map((node) => childPath(node.parentPath, node.name)));
    const cyclicOrBlocked = remaining.filter((node) => unresolvedPaths.has(node.parentPath));
    const missing = remaining.length - cyclicOrBlocked.length;
    instanceDiagnostic(
      materializedDiagnostics,
      source.resPath,
      '.',
      'node-parent-dependency-unresolved',
      `${remaining.length} authored node parent dependencies remain unresolved ` +
        `(${cyclicOrBlocked.length} cyclic/transitively blocked, ${missing} missing or ambiguous)`,
    );
  }

  const document: SceneDocument = {
    ...source,
    root,
    nodeCount: placedNodeCount + remaining.length,
    unplacedNodes: remaining,
    extResources: parts.extResources,
    subResources: parts.subResources,
    inlineScripts: parts.inlineScripts,
    connections: parts.connections,
  };
  diagnostics.push(...materializedDiagnostics);
  if (!chainSensitive) {
    templates.set(source.resPath, { document, diagnostics: materializedDiagnostics });
  }
  return { document, chainSensitive };
}

/** Mutate the project scene list only after every candidate document has been parsed. */
export function expandReadableSceneInstances(
  scenes: SceneDocument[],
  diagnostics: Diagnostic[],
): void {
  const originals = new Map(scenes.map((scene) => [scene.resPath, scene]));
  const templates = new Map<string, MaterializedTemplate>();
  const consumedDiagnosticLocations = new Set<string>();
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    if (!isReadablePackedScene(scene)) continue;
    const expanded = materialize(scene, originals, diagnostics, [], templates).document;
    scenes[index] = expanded;

    const retained = new Set(expanded.unplacedNodes);
    for (const authored of scene.unplacedNodes) {
      if (retained.has(authored) || authored.sourceDiagnosticAt === undefined) continue;
      consumedDiagnosticLocations.add(authored.sourceDiagnosticAt);
      const nodePath = childPath(authored.parentPath, authored.name);
      consumedDiagnosticLocations.add(`${scene.resPath}#${nodePath}`);
    }
  }

  // `node-parent-*` rows are provisional reader diagnostics. Remove only the exact text line
  // whose retained UnplacedNode was consumed by authoritative expansion. Text documents carry a
  // line and binary bundles carry a node-record index, so neither format needs message/name
  // matching. All unrelated parse/resource diagnostics at that location remain untouched.
  for (let index = diagnostics.length - 1; index >= 0; index--) {
    const diagnostic = diagnostics[index];
    if (
      diagnostic !== undefined &&
      (diagnostic.code === 'node-parent-instanced' ||
        diagnostic.code === 'node-parent-unresolved') &&
      consumedDiagnosticLocations.has(diagnostic.at)
    ) {
      diagnostics.splice(index, 1);
    }
  }
}
