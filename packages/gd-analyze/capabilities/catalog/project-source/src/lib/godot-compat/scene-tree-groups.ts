/** SceneTree group operations over the authoritative retained membership registry. */

import { notifyGodotNode } from './node-lifecycle';
import { godotObjectCall, godotObjectSet } from './object';

export interface GodotGroupSceneTree {
  getNodesInGroup(group: string): readonly object[];
  readonly deferred: { setDeferred(call: () => void): void };
}

const GROUP_CALL_REVERSE = 1;
const GROUP_CALL_DEFERRED = 2;

function groupName(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`SceneTree.${member} requires a non-empty StringName group.`);
  }
  return value;
}

function flagsValue(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`SceneTree.${member} requires non-negative integer flags.`);
  }
  return value as number;
}

function orderedMembers(tree: GodotGroupSceneTree, group: string, flags: number): readonly object[] {
  const members = [...tree.getNodesInGroup(group)];
  if ((flags & GROUP_CALL_REVERSE) !== 0) members.reverse();
  return members;
}

function dispatch(tree: GodotGroupSceneTree, flags: number, operation: () => void): void {
  if ((flags & GROUP_CALL_DEFERRED) !== 0) tree.deferred.setDeferred(operation);
  else operation();
}

export function godotSceneTreeCallGroupFlags(
  tree: GodotGroupSceneTree,
  flags: unknown,
  group: unknown,
  method: unknown,
  ...args: unknown[]
): void {
  const normalizedFlags = flagsValue(flags, 'call_group_flags');
  const normalizedGroup = groupName(group, 'call_group_flags');
  if (typeof method !== 'string') throw new TypeError('SceneTree.call_group_flags requires a StringName method.');
  for (const member of orderedMembers(tree, normalizedGroup, normalizedFlags)) {
    dispatch(tree, normalizedFlags, () => { godotObjectCall(member, [method, ...args]); });
  }
}

export function godotSceneTreeNotifyGroup(
  tree: GodotGroupSceneTree,
  group: unknown,
  notification: unknown,
): void {
  godotSceneTreeNotifyGroupFlags(tree, 0, group, notification);
}

export function godotSceneTreeNotifyGroupFlags(
  tree: GodotGroupSceneTree,
  flags: unknown,
  group: unknown,
  notification: unknown,
): void {
  const normalizedFlags = flagsValue(flags, 'notify_group_flags');
  const normalizedGroup = groupName(group, 'notify_group_flags');
  for (const member of orderedMembers(tree, normalizedGroup, normalizedFlags)) {
    dispatch(tree, normalizedFlags, () => { notifyGodotNode(member, notification); });
  }
}

export function godotSceneTreeSetGroup(
  tree: GodotGroupSceneTree,
  group: unknown,
  property: unknown,
  value: unknown,
): void {
  godotSceneTreeSetGroupFlags(tree, 0, group, property, value);
}

export function godotSceneTreeSetGroupFlags(
  tree: GodotGroupSceneTree,
  flags: unknown,
  group: unknown,
  property: unknown,
  value: unknown,
): void {
  const normalizedFlags = flagsValue(flags, 'set_group_flags');
  const normalizedGroup = groupName(group, 'set_group_flags');
  if (typeof property !== 'string') throw new TypeError('SceneTree.set_group_flags requires a StringName property.');
  for (const member of orderedMembers(tree, normalizedGroup, normalizedFlags)) {
    dispatch(tree, normalizedFlags, () => { godotObjectSet(member, property, value); });
  }
}
