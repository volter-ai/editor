/** Shared explicit Object lifetime observed by Object.free and Godot WeakRef. */

const FREED_OBJECTS = new WeakSet<object>();
const LIFETIME_GROUPS = new WeakMap<object, Set<object>>();

/** One Godot Object may be an emitted script instance plus its retained renderer identity. */
export function linkGodotObjectLifetime(left: object, right: object): void {
  const leftGroup = LIFETIME_GROUPS.get(left) ?? new Set([left]);
  const rightGroup = LIFETIME_GROUPS.get(right) ?? new Set([right]);
  if (leftGroup !== rightGroup) {
    for (const value of rightGroup) leftGroup.add(value);
    for (const value of leftGroup) LIFETIME_GROUPS.set(value, leftGroup);
  }
}

export function markGodotObjectFreed(value: object): void {
  for (const member of LIFETIME_GROUPS.get(value) ?? [value]) FREED_OBJECTS.add(member);
}

export function isGodotObjectFreed(value: object): boolean {
  return FREED_OBJECTS.has(value);
}
