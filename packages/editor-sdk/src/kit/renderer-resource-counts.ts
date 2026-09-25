/**
 * Renderer resource counts a media integration reports for the session's diagnostics
 * (`status.rendererResources`): the Three viewport's interactive renderers, for one. The kit
 * reads what is registered and imports no renderer.
 */
export interface RendererResourceCount {
  readonly active: number;
  readonly idle: number;
}

const providers = new Map<string, () => RendererResourceCount>();

/** Report counts under `key`. Returns the teardown. */
export function registerRendererResourceCounts(key: string, read: () => RendererResourceCount): () => void {
  providers.set(key, read);
  return () => {
    if (providers.get(key) === read) providers.delete(key);
  };
}

/** Every registered provider's counts, read now. */
export function rendererResourceCounts(): Record<string, RendererResourceCount> {
  return Object.fromEntries([...providers].map(([key, read]) => [key, read()]));
}
