/** Node notification and propagation over the retained native renderer tree. */

import { isInternalCanvasChild } from './node';
import { godotObjectCall } from './object';
import { godotObjectGet } from './object';
import { godotNodePathNew, godotNodePathString, type GodotNodePath } from './node-path';

interface RetainedNode {
  readonly children?: readonly object[];
}

function children(node: object): readonly object[] {
  return ((node as RetainedNode).children ?? []).filter((child) => !isInternalCanvasChild(child));
}

function notificationCode(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new TypeError('Node.notification requires an integer notification code.');
  return value as number;
}

function callNotification(node: object, what: number, reversed: boolean): void {
  const callback = Reflect.get(node, '_notification');
  if (typeof callback === 'function') Reflect.apply(callback, node, [what, reversed]);
}

/** Deliver a notification only to the receiver's translated script instance. */
export function notifyGodotNode(node: object, what: unknown, reversed = false): void {
  if (typeof reversed !== 'boolean') throw new TypeError('Node.notification reversed must be bool.');
  callNotification(node, notificationCode(what), reversed);
}

/** Depth-first propagation using Godot's children-first notification order. */
export function propagateGodotNodeNotification(node: object, what: unknown): void {
  const code = notificationCode(what);
  const visit = (current: object): void => {
    for (const child of children(current)) visit(child);
    callNotification(current, code, false);
  };
  visit(node);
}

/** Invoke one source method through exact Object dispatch over this retained subtree. */
export function propagateGodotNodeCall(
  node: object,
  method: unknown,
  args: unknown = [],
  parentFirst = false,
): void {
  if (typeof method !== 'string') throw new TypeError('Node.propagate_call requires a StringName method.');
  if (!Array.isArray(args)) throw new TypeError('Node.propagate_call requires an Array of arguments.');
  if (typeof parentFirst !== 'boolean') throw new TypeError('Node.propagate_call parent_first must be bool.');
  const invoke = (current: object): void => {
    godotObjectCall(current, [method, ...args]);
  };
  const visit = (current: object): void => {
    if (parentFirst) invoke(current);
    for (const child of children(current)) visit(child);
    if (!parentFirst) invoke(current);
  };
  visit(node);
}

/** Godot's process delta methods read the authoritative SceneTree clocks. */
export function getGodotNodeProcessDeltaTime(tree: {
  getProcessDeltaTime(): number;
}): number {
  return tree.getProcessDeltaTime();
}

export function getGodotNodePhysicsProcessDeltaTime(tree: {
  getPhysicsProcessDeltaTime(): number;
}): number {
  return tree.getPhysicsProcessDeltaTime();
}

export interface GodotPathSceneTree {
  getNode(from: object, path: GodotNodePath | string): object;
  getNodeOrNull(from: object, path: GodotNodePath | string): object | null;
}

function nodeOnlyPath(path: GodotNodePath): GodotNodePath {
  return { absolute: path.absolute, names: path.names, subnames: [] };
}

/** Resolve the Node and then the longest Resource property chain carried by a NodePath. */
export function getGodotNodeAndResource(
  tree: GodotPathSceneTree,
  from: object,
  pathValue: GodotNodePath | string,
): readonly [object, object | null, GodotNodePath] {
  const path = godotNodePathNew(typeof pathValue === 'string' ? pathValue : godotNodePathString(pathValue));
  const node = tree.getNode(from, nodeOnlyPath(path));
  let resource: object | null = null;
  let current: unknown = node;
  let consumed = 0;
  for (const subname of path.subnames) {
    const next = godotObjectGet(current, subname);
    if (typeof next !== 'object' || next === null) break;
    current = next;
    resource = next;
    consumed += 1;
  }
  return [
    node,
    resource,
    {
      absolute: false,
      names: [],
      subnames: path.subnames.slice(consumed),
    },
  ];
}

export function hasGodotNodeAndResource(
  tree: GodotPathSceneTree,
  from: object,
  pathValue: GodotNodePath | string,
): boolean {
  const path = godotNodePathNew(typeof pathValue === 'string' ? pathValue : godotNodePathString(pathValue));
  const node = tree.getNodeOrNull(from, nodeOnlyPath(path));
  if (node === null) return false;
  if (path.subnames.length === 0) return true;
  let current: unknown = node;
  for (const subname of path.subnames) {
    current = godotObjectGet(current, subname);
    if (typeof current !== 'object' || current === null) return false;
  }
  return true;
}
