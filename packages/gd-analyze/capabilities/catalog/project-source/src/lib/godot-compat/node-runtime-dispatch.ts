/** Exact runtime dispatch for a statically open value which must still carry a Godot Node. */

import { Container } from 'pixi.js';
import { Object3D } from 'three';
import { addChild, getNodeInTree, getParent, getPath, isInsideTree, queueFree, removeChild } from './node';
import { addChild3D, getNodeInTree3D, getParent3D, getPath3D, isInsideTree3D, queueFree3D, removeChild3D } from './node-3d';
import { godotObjectBindingOf, godotObjectIsClass, godotObjectScriptValue } from './object';
import { isGodotNodePath, type GodotNodePath } from './node-path';
import { isRetainedGodotSceneTree, type SceneTree } from './scene-tree';

const NODE_HIERARCHY_METHODS = new Set([
  'add_child',
  'is_in_group',
  'queue_free',
  'get_node',
  'get_parent',
  'get_path',
  'get_children',
  'is_inside_tree',
  'add_to_group',
  'remove_child',
  'find_child',
  'get_nodes_in_group',
]);

function arity(method: string, args: readonly unknown[], major: 3 | 4): void {
  const [minimum, maximum] = method === 'add_child'
    ? [1, major === 3 ? 2 : 3]
    : method === 'add_to_group'
      ? [1, 2]
      : method === 'find_child'
        ? [1, 3]
        : method === 'get_node' || method === 'is_in_group' ||
            method === 'remove_child' || method === 'get_nodes_in_group'
      ? [1, 1]
      : method === 'get_children' && major === 4
        ? [0, 1]
        : [0, 0];
  if (args.length < minimum || args.length > maximum) {
    throw new TypeError(
      `Node.${method} requires ${minimum === maximum ? String(minimum) : `${minimum}–${maximum}`} argument(s); received ${args.length}.`,
    );
  }
}

function requireNode(value: unknown, major: 3 | 4, member: string) {
  const binding = godotObjectBindingOf(value);
  if (!godotObjectIsClass(value, 'Node', major) || binding.context === undefined) {
    throw new TypeError(
      `godot-compat: Node.${member} requires a retained Godot Node carrier; ${binding.godotClass} is not one.`,
    );
  }
  return binding;
}

function treeOf(binding: ReturnType<typeof godotObjectBindingOf>): SceneTree<object> {
  const tree = (binding.context as { readonly tree?: SceneTree<object> } | undefined)?.tree;
  if (tree === undefined) {
    throw new Error('godot-compat: open Node hierarchy dispatch requires an owning retained SceneTree context.');
  }
  return tree;
}

function addRuntimeChild(receiver: unknown, args: readonly unknown[], major: 3 | 4): void {
  const parent = requireNode(receiver, major, 'add_child');
  const child = requireNode(args[0], major, 'add_child child');
  if (args[1] !== undefined && typeof args[1] !== 'boolean') {
    throw new TypeError('Node.add_child force_readable_name/legible_unique_name must be bool.');
  }
  if (args[1] === true) {
    throw new Error('Node.add_child force-readable/legible-unique naming is not available through an open runtime receiver.');
  }
  if (
    major === 4 &&
    args[2] !== undefined &&
    (typeof args[2] !== 'number' || !Number.isSafeInteger(args[2]) || args[2] !== 0)
  ) {
    throw new Error('Node.add_child internal mode is not available through an open runtime receiver.');
  }
  const tree = treeOf(parent);
  if (parent.native instanceof Container && child.native instanceof Container) {
    addChild(parent.native, child.native, tree as SceneTree<Container>);
    return;
  }
  if (parent.native instanceof Object3D && child.native instanceof Object3D) {
    addChild3D(parent.native, child.native, tree as SceneTree<Object3D>);
    return;
  }
  throw new Error(
    'Node.add_child requires parent and child to belong to the same retained Pixi or Three scene tree.',
  );
}

/**
 * Dispatch a finite Node hierarchy method on a statically open Variant/Node receiver.
 * Registered Godot identity and ClassDB ancestry are mandatory; arbitrary JS objects never pass.
 */
export function godotNodeHierarchyCall(
  receiver: unknown,
  method: string,
  args: readonly unknown[],
  major: 3 | 4,
): unknown {
  if (!NODE_HIERARCHY_METHODS.has(method)) {
    throw new Error(`godot-compat: unsupported open Node hierarchy method ${method}.`);
  }
  arity(method, args, major);
  if (method === 'find_child' && major !== 4) {
    throw new TypeError('godot-compat: Node.find_child is not declared in Godot 3; use find_node.');
  }
  if (method === 'get_nodes_in_group') {
    if (typeof args[0] !== 'string') {
      throw new TypeError('SceneTree.get_nodes_in_group requires a StringName group.');
    }
    if (!isRetainedGodotSceneTree(receiver)) {
      throw new TypeError(
        'godot-compat: SceneTree.get_nodes_in_group requires the retained SceneTree owner.',
      );
    }
    return [...receiver.getNodesInGroup(args[0])];
  }
  const binding = requireNode(receiver, major, method);
  if (method === 'add_child') {
    addRuntimeChild(receiver, args, major);
    return undefined;
  }
  if (method === 'get_children' && args[0] === true) {
    throw new Error('Node.get_children(include_internal=true) requires internal-child ownership not exposed by the retained tree.');
  }
  if (method === 'get_children' && args[0] !== undefined && typeof args[0] !== 'boolean') {
    throw new TypeError('Node.get_children include_internal must be bool.');
  }
  if (method === 'add_to_group') {
    if (typeof args[0] !== 'string') {
      throw new TypeError('Node.add_to_group requires a StringName group.');
    }
    if (args[1] !== undefined && typeof args[1] !== 'boolean') {
      throw new TypeError('Node.add_to_group persistent requires bool.');
    }
    treeOf(binding).addToGroup(args[0], binding.native as object, undefined, args[1] ?? false);
    return undefined;
  }
  if (method === 'is_in_group' && typeof args[0] !== 'string') {
    throw new TypeError('Node.is_in_group requires a StringName group.');
  }
  if (
    method === 'get_node' &&
    typeof args[0] !== 'string' &&
    !isGodotNodePath(args[0])
  ) {
    throw new TypeError('Node.get_node requires a String or NodePath.');
  }
  const tree = treeOf(binding);
  if (method === 'find_child') {
    if (typeof args[0] !== 'string') {
      throw new TypeError('Node.find_child requires a String pattern.');
    }
    if (args[1] !== undefined && typeof args[1] !== 'boolean') {
      throw new TypeError('Node.find_child recursive requires bool.');
    }
    if (args[2] !== undefined && typeof args[2] !== 'boolean') {
      throw new TypeError('Node.find_child owned requires bool.');
    }
    return tree.findChild(binding.native as object, args[0], args[1] ?? true, args[2] ?? true);
  }
  if (method === 'remove_child') {
    const child = requireNode(args[0], major, 'remove_child child');
    if (treeOf(child) !== tree) {
      throw new Error('Node.remove_child requires parent and child to belong to the same SceneTree.');
    }
    if (binding.native instanceof Container && child.native instanceof Container) {
      if (child.native.parent !== binding.native) {
        throw new Error('Node.remove_child target is not a child of this Node.');
      }
      removeChild(binding.native, child.native, tree as SceneTree<Container>);
      return undefined;
    }
    if (binding.native instanceof Object3D && child.native instanceof Object3D) {
      if (child.native.parent !== binding.native) {
        throw new Error('Node.remove_child target is not a child of this Node.');
      }
      removeChild3D(binding.native, child.native, tree as SceneTree<Object3D>);
      return undefined;
    }
    throw new Error('Node.remove_child requires matching retained Pixi or Three Node carriers.');
  }
  if (method === 'is_in_group') return tree.isInGroup(args[0] as string, binding.native as object);
  if (method === 'get_children') {
    return [...tree.getChildren(binding.native as object)].map((child) => godotObjectScriptValue(child));
  }
  if (binding.native instanceof Container) {
    if (method === 'queue_free') return queueFree(tree as SceneTree<Container>, binding.native);
    if (method === 'get_node') return getNodeInTree(tree as SceneTree<Container>, binding.native, args[0] as GodotNodePath | string);
    if (method === 'get_parent') return getParent(binding.native);
    if (method === 'get_path') return getPath(tree as SceneTree<Container>, binding.native);
    if (method === 'is_inside_tree') return isInsideTree(tree as SceneTree<Container>, binding.native);
  }
  if (binding.native instanceof Object3D) {
    if (method === 'queue_free') return queueFree3D(tree as SceneTree<Object3D>, binding.native);
    if (method === 'get_node') return getNodeInTree3D(tree as SceneTree<Object3D>, binding.native, args[0] as GodotNodePath | string);
    if (method === 'get_parent') return getParent3D(binding.native);
    if (method === 'get_path') return getPath3D(tree as SceneTree<Object3D>, binding.native);
    if (method === 'is_inside_tree') return isInsideTree3D(tree as SceneTree<Object3D>, binding.native);
  }
  throw new Error(`Node.${method} has no retained Pixi or Three native carrier.`);
}
