/**
 * THE LOADED ADAPTER'S OBSERVATION DECLARATIONS, held host-side with their
 * closures intact.
 *
 * Pushed rather than pulled, for exactly the reason `presentation-surface.ts`
 * is: the reader is an ingest MOUNT, and having the mount import
 * `project-adapter.ts` would drag the whole loader graph (the finder namespace,
 * the manifest fetchers, the story registry) into the mount's module closure.
 * `project-adapter.ts` stays the one place the table is decided; this is the
 * one place the part that cannot travel over the wire is kept.
 *
 * "Cannot travel" is the whole reason this module exists separately from the
 * `/__editor/state` facet. A declaration's `answer` is a CLOSURE evaluated
 * against the mounted game, so the facet publishes only the statically readable
 * half — id, kind, and whether an answer is bound — while the closures stay
 * here, in the host realm, reachable by the mount that has a game to evaluate
 * them against.
 */

import type {
  AdapterInputBinding,
  ObservationDeclaration,
} from '@volter/editor-project/adapter/adapter-module';

let _declarations: readonly ObservationDeclaration[] = [];
let _input: AdapterInputBinding | null = null;

/** Written by `project-adapter.ts` on every load — including with `[]`, so a
 *  project switch cannot leave the previous game's closures reachable. */
export function setAdapterObservations(declarations: readonly ObservationDeclaration[]): void {
  _declarations = declarations;
}

/** What the loaded adapter declares. Empty before the first load, and for a
 *  project whose adapter declares none — both are "nothing to project", which
 *  is the only distinction a mount needs. */
export function adapterObservations(): readonly ObservationDeclaration[] {
  return _declarations;
}

/** The loaded adapter's app-owned input binding, or `null` when it declares none. */
export function adapterInputBinding(): AdapterInputBinding | null {
  return _input;
}

/** Written beside {@link setAdapterObservations} on every project load. */
export function setAdapterInputBinding(binding: AdapterInputBinding | null): void {
  _input = binding;
}
