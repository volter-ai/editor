/**
 * read/binary-document.ts — a decoded `RSRC`/`RSCC` container → the SAME `SceneDocument` /
 * `ResourceDocument` the text reader yields.
 *
 * `binary-format.ts` stops at "the container's resources and their `GodotValue` properties". That
 * is already the whole story for a `.res`: its main resource is a `ResourceDocument` and its other
 * internal rows are that document's sub-resources. A `.scn` needs one more step, and it is the
 * interesting one — a packed SCENE does not store a node tree. It stores a `PackedScene` whose
 * single `_bundled` dictionary holds a name table, a variant table and a FLAT `PackedInt32Array`
 * of node records, and the tree is what you get by walking that array. Godot's own reader is
 * `SceneState::set_bundled_scene` (`scene/resources/packed_scene.cpp:1656-1790` at
 * `godotengine/godot@4.7-stable`), and every field below cites the line it mirrors.
 *
 * ## Why unbundle at all
 *
 * Because the alternative is a second document shape, and then every consumer downstream of S0
 * grows a branch for "the scene that came from a `.scn`". The whole claim of this file is that
 * there is no such thing: `stage.tscn` mounting `res://stage/grid_map.scn` and `stage.tscn`
 * mounting `res://stage/grid_map.tscn` produce the same `SceneDocument`, so `instanceOf` edges,
 * node counts, script attachments and property reads work without knowing which serialization
 * the project happened to use.
 *
 * ## What it does NOT do, deliberately
 *
 * The text reader refuses to splice an instanced scene into its instancing parent
 * (`godot-types.ts`), and a node whose parent path belongs to an instanced subtree is RECORDED in
 * `unplacedNodes` rather than invented. The bundle expresses that same case with its own
 * mechanism — `nd.parent` carrying `FLAG_ID_IS_PATH` instead of a node index
 * (`packed_scene.cpp:1094`) — and it lands in `unplacedNodes` with the same two diagnostic codes.
 * The 4.7 `node_ids`/`id_paths` tables are ignored for the reason `scene.ts`'s `buildNode`
 * docstring gives about `unique_id=`/`parent_id_path=`: they are a second, hash-based address for
 * nodes the string paths already resolve.
 */

import type { BinaryResourceFile } from './binary-format';
import { GodotBinaryParseError } from './binary-format';
import type {
  Diagnostic,
  ExtResourceRef,
  ResourceDocument,
  SceneDocument,
  SceneNode,
  SignalConnection,
  SubResource,
  UnplacedNode,
} from './godot-types';
import type { GodotValue, ResourceId } from './godot-value';
import { resourceRefId } from './godot-value';
import type { DocumentContext } from './scene';
import { classifyExtResource, instancedAncestorOf, nodePathOf } from './scene';

/** `packed_scene.h:53-54, 123-128` at `4.7-stable`. */
const NAME_INDEX_BITS = 18;
const NAME_MASK = (1 << NAME_INDEX_BITS) - 1;
const FLAG_ID_IS_PATH = 1 << 30;
const TYPE_INSTANTIATED = 0x7fffffff;
const FLAG_INSTANCE_IS_PLACEHOLDER = 1 << 30;
const FLAG_PATH_PROPERTY_IS_NODE = 1 << 30;
const FLAG_PROP_NAME_MASK = FLAG_PATH_PROPERTY_IS_NODE - 1;
const FLAG_MASK = (1 << 24) - 1;

/** The Godot class whose binary form is a packed scene rather than a plain resource. Read from
 *  the container's declared TYPE, never from the file extension: `.scn`/`.res` is Godot's naming
 *  convention and either extension can hold either thing. */
const PACKED_SCENE_TYPE = 'PackedScene';

function fail(resPath: string, message: string): never {
  throw new GodotBinaryParseError(`${resPath}: ${message}`);
}

/** The external-resource table, classified exactly as an `[ext_resource]` line would be.
 *
 * The id is the row's INDEX, because that is the identity the binary format itself uses: a
 * property citing an external resource stores `OBJECT_EXTERNAL_RESOURCE_INDEX` and an index
 * (`resource_format_binary.cpp:426-428`), and `binary-format.ts` decodes it to
 * `ExtResource(<index>)`. Ids are only ever compared WITHIN one document — which is the same
 * contract `ResourceId` already carries for Godot 3's numbers and Godot 4's `"1_ybvw5"` tokens. */
function extResourcesOf(
  file: BinaryResourceFile,
  resPath: string,
  ctx: DocumentContext,
  diagnostics: Diagnostic[],
): ExtResourceRef[] {
  return file.extResources.map((ref, index) =>
    classifyExtResource(
      {
        id: index,
        resPath: ref.path,
        type: ref.type,
        ...(ref.uid === undefined ? {} : { uid: ref.uid }),
      },
      ctx,
      resPath,
      `${resPath}#ext_resource ${index}`,
      diagnostics,
    ),
  );
}

/** Every internal row but the LAST, which is the container's main resource
 *  (`resource_format_binary.cpp:651`). */
function subResourcesOf(file: BinaryResourceFile): SubResource[] {
  return file.internalResources.slice(0, -1).map((res) => ({
    id: res.id,
    type: res.type,
    properties: res.properties,
  }));
}

function mainResourceOf(file: BinaryResourceFile, resPath: string) {
  const main = file.internalResources[file.internalResources.length - 1];
  if (main === undefined) {
    fail(resPath, 'the container declares no internal resources, so it has no main resource');
  }
  return main;
}

/** `script = ExtResource(n)` → the referenced `res://` path, the way `scene.ts`'s `refPath` does
 *  it for a text document. */
function refPath(
  value: GodotValue | undefined,
  byId: ReadonlyMap<ResourceId, ExtResourceRef>,
): string | undefined {
  const id = resourceRefId(value, 'ExtResource');
  return id === undefined ? undefined : byId.get(id)?.resPath;
}

interface MutableNode {
  readonly name: string;
  readonly path: string;
  readonly type?: string;
  readonly instanceOf?: string;
  readonly instancePlaceholder?: string;
  readonly ownerPath?: string;
  readonly sourceOrder?: number;
  readonly siblingIndex?: number;
  readonly scriptPath?: string;
  readonly groups: readonly string[];
  readonly nodePathProperties: readonly string[];
  readonly properties: Readonly<Record<string, GodotValue>>;
  readonly children: MutableNode[];
}

/** A cursor over the flat `nodes` / `conns` int arrays. Both are written and read as one running
 *  index (`packed_scene.cpp:1706-1748`), so a mis-sized record desynchronizes everything after
 *  it — which is why running off the end is a refusal, not a truncation. */
class IntCursor {
  private index = 0;

  constructor(
    private readonly values: readonly number[],
    private readonly resPath: string,
    private readonly what: string,
  ) {}

  next(): number {
    const value = this.values[this.index];
    if (value === undefined) {
      fail(
        this.resPath,
        `the packed scene's "${this.what}" array ends after ${this.values.length} word(s), mid-record`,
      );
    }
    this.index += 1;
    return value;
  }
}

function intArrayOf(
  value: GodotValue | undefined,
  ctorName: string,
  resPath: string,
  key: string,
): number[] {
  if (value === undefined) fail(resPath, `the _bundled dictionary has no "${key}"`);
  if (value.kind !== 'ctor' || value.name !== ctorName) {
    fail(
      resPath,
      `_bundled["${key}"] is ${value.kind === 'ctor' ? `${value.name}(…)` : `a ${value.kind}`}, not a ${ctorName}`,
    );
  }
  return value.args.map((arg) => {
    if (arg.kind !== 'number')
      fail(resPath, `_bundled["${key}"] holds a ${arg.kind}, not a number`);
    return arg.value;
  });
}

function stringArrayOf(value: GodotValue | undefined, resPath: string, key: string): string[] {
  if (value === undefined) fail(resPath, `the _bundled dictionary has no "${key}"`);
  if (value.kind !== 'ctor' || value.name !== 'PackedStringArray') {
    fail(
      resPath,
      `_bundled["${key}"] is ${value.kind === 'ctor' ? `${value.name}(…)` : `a ${value.kind}`}, not a PackedStringArray`,
    );
  }
  return value.args.map((arg) => {
    if (arg.kind !== 'string')
      fail(resPath, `_bundled["${key}"] holds a ${arg.kind}, not a string`);
    return arg.value;
  });
}

function arrayOf(
  value: GodotValue | undefined,
  resPath: string,
  key: string,
): readonly GodotValue[] {
  if (value === undefined) return [];
  if (value.kind !== 'array') {
    fail(
      resPath,
      `_bundled["${key}"] is ${value.kind === 'ctor' ? `${value.name}(…)` : `a ${value.kind}`}, not an Array`,
    );
  }
  return value.items;
}

function numberOf(value: GodotValue | undefined, resPath: string, key: string): number {
  if (value?.kind !== 'number') fail(resPath, `_bundled["${key}"] is not a number`);
  return value.value;
}

/** A `NodePath` variant's text, the spelling `binary-format.ts` decodes it to and the one the
 *  text reader produces for `^"…"`. */
function nodePathTextOf(value: GodotValue | undefined, resPath: string, what: string): string {
  if (value?.kind === 'ctor' && value.name === 'NodePath' && value.args[0]?.kind === 'string') {
    return value.args[0].value;
  }
  if (value?.kind === 'string') return value.value;
  return fail(resPath, `${what} is not a NodePath`);
}

/** `SceneState::set_bundled_scene` (`packed_scene.cpp:1656-1790`) — the flat tables, decoded. */
interface Bundle {
  readonly names: readonly string[];
  readonly variants: readonly GodotValue[];
  readonly nodes: readonly number[];
  readonly nodeCount: number;
  readonly conns: readonly number[];
  readonly connCount: number;
  readonly nodePaths: readonly GodotValue[];
  readonly editableInstances: readonly GodotValue[];
  readonly baseSceneIndex?: number;
  readonly version: number;
}

function readBundle(bundled: GodotValue, resPath: string): Bundle {
  if (bundled.kind !== 'dict') {
    fail(resPath, `the PackedScene's _bundled property is a ${bundled.kind}, not a Dictionary`);
  }
  const at = new Map(bundled.entries.map((entry) => [entry.key, entry.value]));
  // :1665-1670 — an absent "version" means 1, and a version newer than the engine's own
  // PACKED_SCENE_VERSION is Godot's own hard refusal ("Save format version too new").
  const version = at.has('version') ? numberOf(at.get('version'), resPath, 'version') : 1;
  if (version > 3) {
    fail(
      resPath,
      `packed-scene bundle version ${version}; 4.7-stable writes PACKED_SCENE_VERSION 3 (packed_scene.h) and this reader decodes 1..3`,
    );
  }
  const baseSceneIndex = at.has('base_scene')
    ? numberOf(at.get('base_scene'), resPath, 'base_scene')
    : undefined;
  return {
    names: stringArrayOf(at.get('names'), resPath, 'names'), // :1680-1688
    variants: arrayOf(at.get('variants'), resPath, 'variants'), // :1690-1701
    nodes: intArrayOf(at.get('nodes'), 'PackedInt32Array', resPath, 'nodes'), // :1673
    nodeCount: numberOf(at.get('node_count'), resPath, 'node_count'), // :1672
    conns: intArrayOf(at.get('conns'), 'PackedInt32Array', resPath, 'conns'), // :1677
    connCount: numberOf(at.get('conn_count'), resPath, 'conn_count'), // :1676
    nodePaths: arrayOf(at.get('node_paths'), resPath, 'node_paths'), // :1755-1763
    editableInstances: arrayOf(at.get('editable_instances'), resPath, 'editable_instances'), // :1775-1787
    ...(baseSceneIndex === undefined ? {} : { baseSceneIndex }), // :1780-1782
    version,
  };
}

/** One record of the flat `nodes` array (`packed_scene.cpp:1707-1726`). */
interface NodeRecord {
  readonly parent: number;
  readonly owner: number;
  readonly type: number;
  readonly name: number;
  readonly siblingIndex?: number;
  readonly instance: number;
  readonly properties: readonly { readonly name: number; readonly value: number }[];
  readonly groups: readonly number[];
}

function readNodeRecords(bundle: Bundle, resPath: string): NodeRecord[] {
  const cursor = new IntCursor(bundle.nodes, resPath, 'nodes');
  const records: NodeRecord[] = [];
  for (let i = 0; i < bundle.nodeCount; i++) {
    const parent = cursor.next(); // :1709
    const owner = cursor.next(); // :1710
    const type = cursor.next(); // :1711
    // :1712-1715 — one word packs the name index (low 18 bits) and the sibling index (the rest,
    // stored +1 so that 0 means "no index"). Preserve the index because an inherited/instanced
    // override can be serialized away from its runtime sibling position; expansion must apply the
    // same ordering after its parent becomes available.
    const packedName = cursor.next();
    const name = packedName & NAME_MASK;
    const encodedSiblingIndex = packedName >>> NAME_INDEX_BITS;
    const siblingIndex = encodedSiblingIndex === 0 ? undefined : encodedSiblingIndex - 1;
    const instance = cursor.next(); // :1716
    const propertyCount = cursor.next(); // :1717
    const properties: { name: number; value: number }[] = [];
    for (let p = 0; p < propertyCount; p++) {
      properties.push({ name: cursor.next(), value: cursor.next() }); // :1719-1720
    }
    const groupCount = cursor.next(); // :1722
    const groups: number[] = [];
    for (let g = 0; g < groupCount; g++) groups.push(cursor.next()); // :1724
    records.push({
      parent,
      owner,
      type,
      name,
      ...(siblingIndex === undefined ? {} : { siblingIndex }),
      instance,
      properties,
      groups,
    });
  }
  return records;
}

function nameAt(bundle: Bundle, index: number, resPath: string, what: string): string {
  const value = bundle.names[index];
  if (value === undefined) {
    fail(
      resPath,
      `${what} cites name ${index}, but the name table has ${bundle.names.length} entr(ies)`,
    );
  }
  return value;
}

function variantAt(bundle: Bundle, index: number, resPath: string, what: string): GodotValue {
  const value = bundle.variants[index];
  if (value === undefined) {
    fail(
      resPath,
      `${what} cites variant ${index}, but the variant table has ${bundle.variants.length} entr(ies)`,
    );
  }
  return value;
}

/**
 * A packed scene's connection endpoint (`packed_scene.cpp:1735-1736`), which is either a node
 * INDEX or — with `FLAG_ID_IS_PATH` — an index into `node_paths` (:1294-1312 writing). Reported
 * as the node PATH, because that is what a text `[connection from="…" to="…"]` states and what
 * `SignalConnection` carries.
 */
function endpointPath(
  id: number,
  bundle: Bundle,
  paths: readonly string[],
  resPath: string,
): string {
  if ((id & FLAG_ID_IS_PATH) !== 0) {
    return nodePathTextOf(
      bundle.nodePaths[id & FLAG_MASK],
      resPath,
      `connection endpoint ${id & FLAG_MASK}`,
    );
  }
  const path = paths[id & FLAG_MASK];
  if (path === undefined) {
    fail(resPath, `a connection cites node ${id & FLAG_MASK}, which this scene does not author`);
  }
  return path;
}

/** A PackedScene node relationship is either a prior node index or an authored NodePath-table
 * index. Parents and owners use the same representation; `-1` is the format's null identity.
 * Refuse a dangling numeric index rather than substituting the root, since doing so would invent
 * both hierarchy and ownership. */
function relatedNodePath(
  id: number,
  bundle: Bundle,
  paths: readonly string[],
  resPath: string,
  what: string,
): string | undefined {
  if (id === -1) return undefined;
  if ((id & FLAG_ID_IS_PATH) !== 0) {
    return nodePathTextOf(
      bundle.nodePaths[id & FLAG_MASK],
      resPath,
      `${what} path ${id & FLAG_MASK}`,
    );
  }
  const related = paths[id & FLAG_MASK];
  if (related === undefined) {
    fail(resPath, `${what} cites node ${id & FLAG_MASK}, which precedes no node`);
  }
  return related;
}

function placeBinaryChild(parent: MutableNode, child: MutableNode): void {
  const index = child.siblingIndex;
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) {
    parent.children.push(child);
    return;
  }
  parent.children.splice(Math.min(index, parent.children.length), 0, child);
}

function readSceneDocumentFromBundle(
  file: BinaryResourceFile,
  bundled: GodotValue,
  resPath: string,
  extResources: readonly ExtResourceRef[],
  diagnostics: Diagnostic[],
): SceneDocument {
  const bundle = readBundle(bundled, resPath);
  const records = readNodeRecords(bundle, resPath);
  const byId = new Map(extResources.map((ref) => [ref.id, ref]));

  const nodePathOfIndex: string[] = [];
  const byPath = new Map<string, MutableNode>();
  const unplacedNodes: UnplacedNode[] = [];
  let root: MutableNode | undefined;

  records.forEach((record, index) => {
    const name = nameAt(bundle, record.name, resPath, `node ${index}`);

    // :1063 — a node the SAVER did not type is one belonging to an instanced sub-scene, and its
    // class lives in that other document. The text format says the same thing by writing an
    // `instance=` node with no `type=`, and `SceneNode.type` is optional for exactly this case.
    const type =
      record.type === TYPE_INSTANTIATED
        ? undefined
        : nameAt(bundle, record.type, resPath, `node ${index}`);

    const properties: Record<string, GodotValue> = {};
    for (const property of record.properties) {
      // :376-396 — FLAG_PATH_PROPERTY_IS_NODE marks the NAME only; the value is an ordinary
      // variant-table index either way.
      const propertyName = nameAt(
        bundle,
        property.name & FLAG_PROP_NAME_MASK,
        resPath,
        `node ${index}`,
      );
      properties[propertyName] = variantAt(
        bundle,
        property.value,
        resPath,
        `node ${index}.${propertyName}`,
      );
    }

    // :239-263 — a placeholder instance stores the scene PATH as a string variant; an ordinary
    // one stores the PackedScene resource, which `binary-format.ts` decoded to an ExtResource ref.
    let instanceOf: string | undefined;
    let instancePlaceholder: string | undefined;
    if (record.instance !== -1) {
      const value = variantAt(
        bundle,
        record.instance & FLAG_MASK,
        resPath,
        `node ${index} instance`,
      );
      if ((record.instance & FLAG_INSTANCE_IS_PLACEHOLDER) !== 0) {
        if (value.kind !== 'string') {
          fail(resPath, `node ${index} placeholder instance is not a string resource path`);
        }
        instancePlaceholder = value.value;
      } else {
        instanceOf = refPath(value, byId);
      }
    } else if (index === 0 && bundle.baseSceneIndex !== undefined) {
      // :229-238 — an INHERITED scene names its base once, on the root, which is also where the
      // text format writes it (`[node name="X" instance=ExtResource("1")]` on the root line).
      instanceOf = refPath(variantAt(bundle, bundle.baseSceneIndex, resPath, 'base_scene'), byId);
    }

    const scriptPath = refPath(properties['script'], byId);
    const groups = record.groups.map((g) => nameAt(bundle, g, resPath, `node ${index} group`));

    const parentPath = index === 0
      ? undefined
      : relatedNodePath(record.parent, bundle, nodePathOfIndex, resPath, `node ${index} parent`);
    const ownerPath = relatedNodePath(
      record.owner,
      bundle,
      nodePathOfIndex,
      resPath,
      `node ${index} owner`,
    );

    const path = nodePathOf(parentPath, name);
    nodePathOfIndex[index] = path;

    const node: MutableNode = {
      name,
      path,
      ...(type === undefined ? {} : { type }),
      ...(instanceOf === undefined ? {} : { instanceOf }),
      ...(instancePlaceholder === undefined ? {} : { instancePlaceholder }),
      ...(ownerPath === undefined ? {} : { ownerPath }),
      sourceOrder: index,
      ...(record.siblingIndex === undefined ? {} : { siblingIndex: record.siblingIndex }),
      ...(scriptPath === undefined ? {} : { scriptPath }),
      groups,
      // A binary `.scn` carries no exported-NodePath list this reader can read: the bundle's own
      // `node_paths` table is the packed-scene parent/name index (`SceneNode.nodePathProperties`),
      // which is a different fact with the same spelling. Empty is the honest answer.
      nodePathProperties: [],
      properties,
      children: [],
    };

    if (parentPath === undefined) {
      root = node;
      byPath.set('.', node);
      return;
    }

    const parent = byPath.get(parentPath);
    if (parent === undefined) {
      // The bundle reached this node through `node_paths` rather than through a saved node — the
      // binary spelling of the text reader's "parent belongs to an instanced scene" case. It is
      // the text reader's OWN predicate, imported rather than re-typed: `instancedAncestorOf`.
      const instancedAncestor = instancedAncestorOf(parentPath, byPath);
      unplacedNodes.push({
        name,
        parentPath,
        sourceDiagnosticAt: `${resPath}#node-record-${String(index)}`,
        ...(instancedAncestor === undefined ? {} : { instancedScene: instancedAncestor }),
        ...(type === undefined ? {} : { type }),
        ...(instanceOf === undefined ? {} : { instanceOf }),
        ...(instancePlaceholder === undefined ? {} : { instancePlaceholder }),
        ...(ownerPath === undefined ? {} : { ownerPath }),
        sourceOrder: index,
        ...(record.siblingIndex === undefined ? {} : { siblingIndex: record.siblingIndex }),
        ...(scriptPath === undefined ? {} : { scriptPath }),
        groups,
        nodePathProperties: [],
        properties,
      });
      diagnostics.push(
        instancedAncestor === undefined
          ? {
              severity: 'error',
              code: 'node-parent-unresolved',
              message: `node "${name}" declares parent "${parentPath}", which this scene does not author`,
              at: `${resPath}#node-record-${String(index)}`,
            }
          : {
              severity: 'warning',
              code: 'node-parent-instanced',
              message: `node "${name}" overrides "${parentPath}" inside the instanced scene ${instancedAncestor}; S0 does not splice instanced scenes`,
              at: `${resPath}#node-record-${String(index)}`,
            },
      );
      return;
    }
    placeBinaryChild(parent, node);
    byPath.set(path, node);
  });

  const connections: SignalConnection[] = [];
  const connCursor = new IntCursor(bundle.conns, resPath, 'conns');
  for (let i = 0; i < bundle.connCount; i++) {
    const from = connCursor.next(); // :1735
    const to = connCursor.next(); // :1736
    const signal = connCursor.next(); // :1737
    const method = connCursor.next(); // :1738
    connCursor.next(); // flags, :1739 — Godot's CONNECT_* bitmask; no consumer here
    const bindCount = connCursor.next(); // :1740
    for (let b = 0; b < bindCount; b++) connCursor.next(); // :1743
    const unbinds = bundle.version >= 3 ? connCursor.next() : undefined; // :1745-1747
    connections.push({
      signal: nameAt(bundle, signal, resPath, `connection ${i}`),
      from: endpointPath(from, bundle, nodePathOfIndex, resPath),
      to: endpointPath(to, bundle, nodePathOfIndex, resPath),
      method: nameAt(bundle, method, resPath, `connection ${i}`),
      ...(unbinds === undefined ? {} : { unbinds }),
    });
  }

  for (const connection of connections) {
    if (!byPath.has(connection.from) || !byPath.has(connection.to)) {
      diagnostics.push({
        severity: 'warning',
        code: 'connection-endpoint-unresolved',
        message: `signal "${connection.signal}" wires ${connection.from} → ${connection.to}.${connection.method}; at least one endpoint is not a node this scene authors`,
        at: resPath,
      });
    }
  }

  return {
    resPath,
    ...(file.uid === undefined ? {} : { uid: file.uid }),
    // `SceneDocument.format` is the TEXT header's `format=` number and a binary scene has none.
    // The container's own format version (6) and the bundle's version (3) are different number
    // spaces; reporting either here would answer a question nobody asked with a number that means
    // something else.
    ...(root === undefined ? {} : { root: root as SceneNode }),
    nodeCount: bundle.nodeCount,
    unplacedNodes,
    extResources,
    subResources: subResourcesOf(file),
    inlineScripts: [],
    connections,
    editablePaths: bundle.editableInstances.map((value, i) =>
      nodePathTextOf(value, resPath, `editable_instances[${i}]`),
    ),
  };
}

/**
 * The whole binary lane in one call: bytes already decoded by `binary-format.ts` → the document
 * the rest of S0 stores, plus the per-item diagnostics its dependencies earn.
 *
 * The discriminator is the container's declared type. A `PackedScene` is a scene document; every
 * other resource is a resource document — the same split the text lane makes between `[gd_scene]`
 * and `[gd_resource]`.
 */
export function readBinaryDocument(
  file: BinaryResourceFile,
  resPath: string,
  ctx: DocumentContext,
): {
  document:
    | { kind: 'scene'; scene: SceneDocument }
    | { kind: 'resource'; resource: ResourceDocument };
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const extResources = extResourcesOf(file, resPath, ctx, diagnostics);
  const main = mainResourceOf(file, resPath);

  if (main.type === PACKED_SCENE_TYPE) {
    const bundled = main.properties['_bundled'];
    if (bundled === undefined) {
      fail(resPath, 'the PackedScene declares no _bundled property, so it holds no scene');
    }
    return {
      document: {
        kind: 'scene',
        scene: readSceneDocumentFromBundle(file, bundled, resPath, extResources, diagnostics),
      },
      diagnostics,
    };
  }

  return {
    document: {
      kind: 'resource',
      resource: {
        resPath,
        ...(file.uid === undefined ? {} : { uid: file.uid }),
        type: main.type,
        properties: main.properties,
        extResources,
        subResources: subResourcesOf(file),
      },
    },
    diagnostics,
  };
}
