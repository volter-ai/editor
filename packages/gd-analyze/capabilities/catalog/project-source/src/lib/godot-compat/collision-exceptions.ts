/** World-owned, unordered Godot CollisionObject exception pairs. */

import { armContactFilter } from './collision-layers';

export interface FilterableCollider {
  activeHooks(): number;
  setActiveHooks(activeHooks: number): void;
}

export interface CollisionObjectBody {
  readonly handle: number;
  numColliders(): number;
  collider(index: number): FilterableCollider;
}

export interface CollisionExceptions {
  add(a: number, b: number): void;
  remove(a: number, b: number): void;
  has(a: number, b: number): boolean;
  others(body: number): readonly number[];
}

export function createCollisionExceptions(): CollisionExceptions {
  const pairs = new Set<string>();
  const byBody = new Map<number, Set<number>>();
  const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  return {
    add: (a, b) => {
      pairs.add(key(a, b));
      const fromA = byBody.get(a) ?? new Set<number>();
      const fromB = byBody.get(b) ?? new Set<number>();
      fromA.add(b);
      fromB.add(a);
      byBody.set(a, fromA);
      byBody.set(b, fromB);
    },
    remove: (a, b) => {
      pairs.delete(key(a, b));
      byBody.get(a)?.delete(b);
      byBody.get(b)?.delete(a);
    },
    has: (a, b) => pairs.has(key(a, b)),
    others: (body) => [...(byBody.get(body) ?? [])],
  };
}

export function addCollisionExceptionWith(
  body: CollisionObjectBody,
  other: CollisionObjectBody,
  exceptions: CollisionExceptions,
): void {
  exceptions.add(body.handle, other.handle);
  enableContactFilter(body);
  enableContactFilter(other);
}

export function removeCollisionExceptionWith(
  body: CollisionObjectBody,
  other: CollisionObjectBody,
  exceptions: CollisionExceptions,
): void {
  exceptions.remove(body.handle, other.handle);
  // Keep FILTER_CONTACT_PAIRS armed. A body can still participate in another exception and the
  // world's Godot layer rule is evaluated by the same hook; clearing it here would silently bypass
  // both live registries. An armed hook whose pair is no longer present simply computes contacts.
}

function enableContactFilter(body: CollisionObjectBody): void {
  for (let i = 0; i < body.numColliders(); i += 1) {
    armContactFilter(body.collider(i));
  }
}
