/**
 * THE STATE REPORT'S CONTRIBUTED FIELDS — what a lane adds to `collectState`
 * (`command-listener.ts`: `vgai status`, the SDK's `editor.state`). The host
 * reports the session; a lane reports what only it knows (its loop's time
 * scale and liveness, its seed, whether a restart is required) through
 * `@volter/editor-sdk/host`'s `session.reportFacet`. Keys are spread in the
 * order of registration; a lane never overrides a host key.
 *
 * ## A FACET MAY BE REUSABLE, and that is what let coverage leave the host
 *
 * `collectState` takes a previous full snapshot whose expensive facets it may
 * COPY instead of re-deriving, and the list of copyable keys used to be a
 * host constant (`command-listener.ts`'s `REUSABLE_DERIVED_FACETS`). That is
 * the reason the four capability-GRADING families stayed host fields long
 * after everything around them had left: their derivation costs 76ms–1.3s and
 * a facet's collect ran on EVERY report, interaction path included, so
 * registering them from a package would have put that cost back on the
 * critical path this mechanism exists to keep it off.
 *
 * So a registration carries its own reusable key names, and the collect is
 * handed the `reuse` snapshot. A reusing collect returns the copied values (or
 * skips the work outright); {@link reusableFacetKeys} is what the host strips
 * from an interaction PATCH by name. The choice stays the caller's — only
 * `collectState`'s caller knows whether it is on a user's critical path — and
 * a package never has to invent a cache of its own to approximate it.
 */
export interface EditorStateFacetOptions {
  /**
   * The keys this facet's collect may serve from `reuse` rather than
   * re-deriving. They join the host's own reusable set: an interaction-path
   * PATCH omits them (the server still holds the last full snapshot), and the
   * deferred full collect that always follows makes them current again.
   */
  readonly reusableKeys?: readonly string[];
}

type FacetCollect = (reuse: Record<string, unknown> | null) => Record<string, unknown>;

interface RegisteredFacet {
  readonly collect: FacetCollect;
  readonly reusableKeys: readonly string[];
}

const facets = new Set<RegisteredFacet>();

export function registerEditorStateFacet(
  collect: FacetCollect,
  options?: EditorStateFacetOptions,
): () => void {
  const facet: RegisteredFacet = { collect, reusableKeys: options?.reusableKeys ?? [] };
  facets.add(facet);
  return () => {
    facets.delete(facet);
  };
}

export function collectEditorStateFacets(
  /** A previous full snapshot a registered collect may copy its own reusable
   *  keys from, or `null` for a full collect. */
  reuse: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const facet of facets) Object.assign(out, facet.collect(reuse));
  return out;
}

/** Every reusable key any registered facet declares — the contributed half of
 *  the host's `REUSABLE_DERIVED_FACETS`, read fresh because a contribution
 *  pass adds and removes facets while the session runs. */
export function reusableFacetKeys(): readonly string[] {
  const keys: string[] = [];
  for (const facet of facets) keys.push(...facet.reusableKeys);
  return keys;
}
