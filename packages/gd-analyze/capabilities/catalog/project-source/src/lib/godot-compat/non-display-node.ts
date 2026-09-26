import { registerGodotObjectIdentity } from './object';

/**
 * A plain Godot Node has tree identity but no renderer identity. In particular, Node3D's
 * ENTER_TREE path casts its DIRECT parent to Node3D; a Node between two Node3Ds therefore breaks
 * the transform chain instead of contributing an identity transform. Keeping this carrier out of
 * Three is what preserves that distinction.
 */
export interface GodotNonDisplayNode {
  name: string;
  readonly siblingIndex: number;
}

export interface NonDisplayNodeTree {
  registerNonDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
}

export function createGodotNonDisplayNode(
  name: string,
  siblingIndex: number,
): GodotNonDisplayNode {
  if (!Number.isSafeInteger(siblingIndex) || siblingIndex < 0) {
    throw new RangeError(
      `godot-compat: Node sibling index must be a non-negative safe integer; got ${String(siblingIndex)}.`,
    );
  }
  const node: GodotNonDisplayNode = { name, siblingIndex };
  registerGodotObjectIdentity(node, 'Node');
  return node;
}

/** Attach the one retained non-display Node to the authored SceneTree parent. */
export function attachGodotNonDisplayNode(
  tree: NonDisplayNodeTree,
  parent: object,
  node: GodotNonDisplayNode,
): () => void {
  return tree.registerNonDisplayChild(parent, node, node.siblingIndex);
}
