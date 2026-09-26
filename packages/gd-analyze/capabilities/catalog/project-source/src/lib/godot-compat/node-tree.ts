import { type GodotNodePath, godotNodePathNew, godotNodePathString } from './node-path';

/** The renderer-neutral part of a Godot node tree. */
export interface TreeNodeLike<TNode extends object> {
  readonly parent: TNode | null;
  readonly children: readonly TNode[];
}

/** The renderer-neutral access SceneTree supplies when its virtual `/root` also owns non-display
 * autoload nodes. Renderer nodes still use their native parent/children arrays; only the names and
 * root children Godot owns outside those arrays are overlaid here. */
export interface NodeTreeAccess<TNode extends object> {
  parentOf(node: TNode): TNode | null;
  childrenOf(node: TNode): readonly TNode[];
  nameOf(node: TNode): string;
  /** `%Name`, resolved in the receiver's owner scene. */
  uniqueNodeOf(from: TNode, name: string): TNode | null;
}

function pathString(path: GodotNodePath | string): string {
  return typeof path === 'string' ? path : godotNodePathString(path);
}

/** `Node.is_inside_tree()` against the port-owned scene root. */
export function isNodeInsideTree<TNode extends object>(
  root: TNode,
  node: TNode,
  parentOf: (node: TNode) => TNode | null = (candidate) =>
    (candidate as TreeNodeLike<TNode>).parent,
): boolean {
  let current: TNode | null = node;
  while (current !== null) {
    if (current === root) return true;
    current = parentOf(current);
  }
  return false;
}

/** Godot's non-throwing `get_node_or_null` walk, including the virtual `/root` Viewport. */
export function resolveNodeOrNull<TNode extends object>(
  root: TNode,
  from: TNode,
  path: GodotNodePath | string,
  nameOf: (node: TNode) => string,
  access?: NodeTreeAccess<TNode>,
): TNode | null {
  const parsed = godotNodePathNew(pathString(path));
  if (parsed.subnames.length > 0 || parsed.names.length === 0) return null;

  let current: TNode;
  let segments: readonly string[] = parsed.names;
  if (parsed.absolute) {
    if (!isNodeInsideTree(root, from, access?.parentOf)) return null;
    // The port's OUTER renderer root is the host-owned counterpart of Godot's root Window. Its
    // renderer label is deliberately irrelevant: `/root` names this object itself, and its main
    // scene plus autoloads are direct children.
    if (segments[0] !== 'root') return null;
    current = root;
    segments = segments.slice(1);
  } else {
    current = from;
  }

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] as string;
    if (segment === '.') continue;
    if (segment === '..') {
      const parent = access?.parentOf(current) ?? (current as TreeNodeLike<TNode>).parent;
      if (current === root || parent === null) return null;
      current = parent;
      continue;
    }
    if (index === 0 && segment.startsWith('%')) {
      const unique = access?.uniqueNodeOf(from, segment.slice(1)) ?? null;
      if (unique === null) return null;
      current = unique;
      continue;
    }
    const children = access?.childrenOf(current) ?? (current as TreeNodeLike<TNode>).children;
    const child = children.find(
      (candidate) => (access?.nameOf(candidate) ?? nameOf(candidate)) === segment,
    );
    if (child === undefined) return null;
    current = child;
  }
  return current;
}

/** `Node.has_node`, including the virtual root Window itself (`/root`). */
export function hasNodePath<TNode extends object>(
  root: TNode,
  from: TNode,
  path: GodotNodePath | string,
  nameOf: (node: TNode) => string,
  access?: NodeTreeAccess<TNode>,
): boolean {
  const parsed = godotNodePathNew(pathString(path));
  if (
    parsed.absolute &&
    parsed.subnames.length === 0 &&
    parsed.names.length === 1 &&
    parsed.names[0] === 'root'
  ) {
    return isNodeInsideTree(root, from, access?.parentOf);
  }
  return resolveNodeOrNull(root, from, parsed, nameOf, access) !== null;
}

/** `Node.get_path()` as an absolute NodePath rooted at Godot's virtual `/root` Window. */
export function nodePathInTree<TNode extends object>(
  root: TNode,
  node: TNode,
  nameOf: (node: TNode) => string,
  parentOf: (node: TNode) => TNode | null = (candidate) =>
    (candidate as TreeNodeLike<TNode>).parent,
): GodotNodePath {
  const names: string[] = [];
  let current: TNode | null = node;
  while (current !== null) {
    names.push(nameOf(current));
    if (current === root) {
      // `root` is the translated Window counterpart, not the mounted scene. Its renderer label is
      // host metadata and must never become a NodePath segment.
      const belowRoot = names.reverse().slice(1);
      return godotNodePathNew(belowRoot.length === 0 ? '/root' : `/root/${belowRoot.join('/')}`);
    }
    current = parentOf(current);
  }
  // node.cpp Node::get_path uses ERR_FAIL_COND_V_MSG(..., NodePath()), so the engine logs the
  // misuse and returns an empty value. Compat has no global engine-error channel; preserving the
  // returned value and control flow is more faithful than throwing JavaScript through the game.
  return godotNodePathNew();
}
