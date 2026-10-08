/**
 * Godot's TEMPORARY PIVOT on a 2D view: a point, in the view's world frame, that rotation turns
 * the selection around without changing any node's own pivot. Pivot mode sets it with Shift+click
 * (and Shift+click on the Pivot button puts it at the selection's centre); Escape in Pivot mode,
 * or a new selection, clears it. One per view.
 */

import type { RootViewController } from '@volter/sdk/kit/world-pan-state';

type Point = { readonly x: number; readonly y: number };

const pivots = new WeakMap<RootViewController, Point>();
const listeners = new Set<() => void>();
let version = 0;

export function temporaryPivot(view: RootViewController): Point | null {
  return pivots.get(view) ?? null;
}

export function setTemporaryPivot(view: RootViewController, point: Point | null): void {
  if (point) pivots.set(view, point);
  else pivots.delete(view);
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeTemporaryPivot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function temporaryPivotVersion(): number {
  return version;
}
