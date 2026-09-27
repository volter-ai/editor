/**
 * The native surfaces a contribution is handed beyond the kit's own (`surfaces.Object3DAuthoring`
 * and the rest a medium's integration adds to `ToolContributionSurfaces` from its public API), as
 * that integration registers them. The kit forwards whatever is registered under a surface's name
 * and imports no medium: a composition without the integration registers none, and a
 * contribution that asks for one shows the kit's placeholder until one is.
 *
 * The surfaces reach contributions through their props, not an import, because a project's
 * contributions are modules of the project's own graph and cannot import the editor's components.
 */
import type { ComponentType } from 'react';
import type { ToolContributionSurfaces } from '../contributions';

export type ContributionSurfaceRegistration = {
  readonly [Name in keyof ToolContributionSurfaces]?: ToolContributionSurfaces[Name];
};

const registered = new Map<string, ComponentType<never>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Install an integration's surfaces by name. Returns the teardown. */
export function registerContributionSurfaces(surfaces: ContributionSurfaceRegistration): () => void {
  const entries = Object.entries(surfaces) as [string, ComponentType<never>][];
  for (const [name, surface] of entries) registered.set(name, surface);
  notify();
  return () => {
    for (const [name, surface] of entries) {
      if (registered.get(name) === surface) registered.delete(name);
    }
    notify();
  };
}

/** The surface registered under `name`, or null when no integration has registered one. */
export function contributionSurface(name: string): ComponentType<never> | null {
  return registered.get(name) ?? null;
}

export function subscribeContributionSurfaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
