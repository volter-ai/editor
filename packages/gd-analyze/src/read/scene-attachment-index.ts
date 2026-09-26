/**
 * Exact script placements through parsed PackedScene composition.
 *
 * A Script resource is authored in one document, but it executes at every placement of the node
 * that owns it. Text-scene expansion already stamps most ordinary `.tscn` instances into their
 * outer document. This index covers the remaining exact shapes without requiring a second mutable
 * tree: binary PackedScenes, inherited roots, and overrides whose parent is supplied by another
 * parsed scene. Missing/imported/plugin scenes remain opaque and contribute nothing.
 */

import type {
  SceneDocument,
  SceneNode,
  ScriptAttachment,
  UnplacedNode,
} from './godot-types';
import { isReadablePackedScene } from './instance-expansion';
import { resourceKindOf } from './res-path';

interface SourceNode {
  readonly scene: SceneDocument;
  readonly node: SceneNode | UnplacedNode;
  readonly sourcePath: string;
}

interface RuntimeNode {
  /** Source declarations at one runtime position, outermost override first. */
  readonly layers: readonly SourceNode[];
  readonly runtimePath: string;
}

function sourcePath(node: SceneNode | UnplacedNode): string {
  if ('path' in node) return node.path;
  return node.parentPath === '.' || node.parentPath === ''
    ? node.name
    : `${node.parentPath}/${node.name}`;
}

function childPath(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`;
}

function sourceChildren(layer: SourceNode): readonly SourceNode[] {
  const direct = 'children' in layer.node
    ? layer.node.children.map((node) => ({ scene: layer.scene, node, sourcePath: node.path }))
    : [];
  const unplaced = layer.scene.unplacedNodes
    .filter((node) => node.parentPath === layer.sourcePath)
    .map((node) => ({ scene: layer.scene, node, sourcePath: sourcePath(node) }));
  if (unplaced.length === 0) return direct;
  const directNames = new Set(direct.map(({ node }) => node.name));
  return [...direct, ...unplaced.filter(({ node }) => !directNames.has(node.name))];
}

function parsedInstanceRoot(
  layer: SourceNode,
  scenes: ReadonlyMap<string, SceneDocument>,
): SourceNode | undefined {
  const instanceOf = layer.node.instanceOf;
  if (instanceOf === undefined) return undefined;
  const scene = scenes.get(instanceOf);
  if (!isReadablePackedScene(scene)) return undefined;
  return { scene, node: scene.root, sourcePath: '.' };
}

/**
 * Append inherited root declarations at this same runtime position. The first declaration wins
 * for script ownership, while every layer remains available for child composition. A source
 * identity repeated in the current chain is a PackedScene cycle and terminates only that edge.
 */
function inheritedLayers(
  initial: readonly SourceNode[],
  scenes: ReadonlyMap<string, SceneDocument>,
  lineage: ReadonlySet<string>,
): readonly SourceNode[] {
  const result: SourceNode[] = [];
  const seen = new Set(lineage);
  for (const layer of initial) {
    let at: SourceNode | undefined = layer;
    while (at !== undefined) {
      const identity = `${at.scene.resPath}\0${at.sourcePath}`;
      if (seen.has(identity)) break;
      seen.add(identity);
      result.push(at);
      at = parsedInstanceRoot(at, scenes);
    }
  }
  return result;
}

function effectiveChildren(
  node: RuntimeNode,
  scenes: ReadonlyMap<string, SceneDocument>,
  lineage: ReadonlySet<string>,
): readonly RuntimeNode[] {
  const byName = new Map<string, SourceNode[]>();
  const order: string[] = [];
  for (const layer of node.layers) {
    for (const child of sourceChildren(layer)) {
      let declarations = byName.get(child.node.name);
      if (declarations === undefined) {
        declarations = [];
        byName.set(child.node.name, declarations);
        order.push(child.node.name);
      }
      declarations.push(child);
    }
  }
  return order.flatMap((name) => {
    const declarations = byName.get(name);
    if (declarations === undefined || declarations.length === 0) return [];
    // A typed or explicitly instanced child is a new node at that name, not an inherited
    // property-only override. Only a typeless/uninstanced declaration composes with the same-name
    // node supplied by an inner scene.
    const first = declarations[0];
    const effectiveDeclarations =
      first !== undefined && (first.node.type !== undefined || first.node.instanceOf !== undefined)
        ? [first]
        : declarations;
    const layers = inheritedLayers(effectiveDeclarations, scenes, lineage);
    if (layers.length === 0) return [];
    return [{ layers, runtimePath: childPath(node.runtimePath, name) }];
  });
}

function effectiveScript(layers: readonly SourceNode[]): string | undefined {
  // Godot applies the outer scene's script property override before the instantiated root's
  // authored value. An explicit null script is serialized as a property value rather than a
  // scriptPath; the scene reader intentionally does not claim that as a GDScript attachment.
  for (const layer of layers) {
    if (layer.node.scriptPath !== undefined) return layer.node.scriptPath;
    // An explicit `script = null` is an override that removes the inherited script. The scene
    // reader retains the serialized property even though it correctly produces no scriptPath.
    if (Object.hasOwn(layer.node.properties, 'script')) return undefined;
  }
  return undefined;
}

function attachmentKey(scriptPath: string, attachment: ScriptAttachment): string {
  return `${scriptPath}\0${attachment.documentPath}\0${attachment.nodePath ?? ''}`;
}

/**
 * Return every exact runtime Script attachment implied by parsed scene composition.
 *
 * Every scene is indexed as its own PackedScene root because it can be instantiated dynamically;
 * outer placements add additional attachment contexts. This mirrors the reader's existing direct
 * attachment policy while extending it through exact parsed instance edges. It deliberately does
 * not infer reachability from filenames, node names, or missing external references.
 */
export function indexParsedSceneScriptAttachments(
  sceneList: readonly SceneDocument[],
): ReadonlyMap<string, readonly ScriptAttachment[]> {
  const scenes = new Map(sceneList.map((scene) => [scene.resPath, scene]));
  const attachments = new Map<string, ScriptAttachment[]>();
  const keys = new Set<string>();

  const add = (scriptPath: string | undefined, attachment: ScriptAttachment): void => {
    if (scriptPath === undefined || resourceKindOf(scriptPath) !== 'script') return;
    const key = attachmentKey(scriptPath, attachment);
    if (keys.has(key)) return;
    keys.add(key);
    const rows = attachments.get(scriptPath);
    if (rows === undefined) attachments.set(scriptPath, [attachment]);
    else rows.push(attachment);
  };

  const walk = (
    owner: SceneDocument,
    runtime: RuntimeNode,
    lineage: ReadonlySet<string>,
  ): void => {
    const identities = runtime.layers.map((layer) => `${layer.scene.resPath}\0${layer.sourcePath}`);
    if (identities.some((identity) => lineage.has(identity))) return;
    const nextLineage = new Set(lineage);
    for (const identity of identities) nextLineage.add(identity);

    add(effectiveScript(runtime.layers), {
      documentPath: owner.resPath,
      nodePath: runtime.runtimePath,
    });
    for (const child of effectiveChildren(runtime, scenes, nextLineage)) {
      walk(owner, child, nextLineage);
    }
  };

  for (const scene of sceneList) {
    if (!isReadablePackedScene(scene)) continue;
    const rootLayer: SourceNode = { scene, node: scene.root, sourcePath: '.' };
    const layers = inheritedLayers([rootLayer], scenes, new Set());
    if (layers.length === 0) continue;
    walk(scene, { layers, runtimePath: '.' }, new Set());
  }

  return attachments;
}
