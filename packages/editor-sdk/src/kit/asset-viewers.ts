/**
 * ASSET VIEWERS BY ROUTE — the Asset Lab's native views for the formats a media
 * integration renders (a model, an environment map, a LUT, a shader, a live
 * modeling module, an entity's model). The kit's asset documents render the
 * registered viewer for a route and their own fallback when none is: a
 * composition with no three.js integration still opens the file, as text or as
 * a file with no renderer. One registration per route; `useAssetViewer` re-renders
 * when one arrives, so a document restored before its integration loaded
 * upgrades in place.
 */
import { type ComponentType, createElement, type ReactNode, useSyncExternalStore } from 'react';

export type AssetViewerRoute = 'model' | 'environment' | 'lut' | 'shader' | 'module' | 'entity-model';

export interface AssetViewerProps {
  readonly documentId: string;
  /** The asset's project path; empty for an `entity-model`. */
  readonly assetPath: string;
  readonly displayName: string;
  readonly active: boolean;
  /** `entity-model`: the live entity whose model this is. */
  readonly entityId?: string;
  /** `module`: the project root the module is served from. */
  readonly projectRoot?: string;
  /** What to show when the viewer finds nothing it renders (a `module` that
   *  builds no Object3D). */
  readonly fallback?: ReactNode;
}

const viewers = new Map<AssetViewerRoute, ComponentType<AssetViewerProps>>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Register the viewer for one route. Returns the removal. */
export function registerAssetViewer(
  route: AssetViewerRoute,
  viewer: ComponentType<AssetViewerProps>,
): () => void {
  const existing = viewers.get(route);
  if (existing && existing !== viewer) throw new Error(`An asset viewer for "${route}" is already registered.`);
  viewers.set(route, viewer);
  changed();
  return () => {
    if (viewers.get(route) !== viewer) return;
    viewers.delete(route);
    changed();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The registered viewer for `route`, or null; re-renders when one arrives. */
export function useAssetViewer(route: AssetViewerRoute): ComponentType<AssetViewerProps> | null {
  useSyncExternalStore(subscribe, () => version, () => version);
  return viewers.get(route) ?? null;
}

/** The registered viewer for `route` with `props`, or `whenUnregistered` when this
 *  composition registered none. `props.fallback` still reaches the viewer. */
export function AssetViewerSlot({
  route,
  whenUnregistered,
  ...props
}: AssetViewerProps & { readonly route: AssetViewerRoute; readonly whenUnregistered: ReactNode }): ReactNode {
  const Viewer = useAssetViewer(route);
  return Viewer ? createElement(Viewer, props) : whenUnregistered;
}
