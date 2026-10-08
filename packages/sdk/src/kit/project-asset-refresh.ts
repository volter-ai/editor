/** Project asset BYTES changed on disk. A lane whose loaders cache parsed assets
 * across mounts listens here, invalidates those paths, then reloads — so
 * replacing a GLB updates every placement without editing source.
 */
const ASSET_RELOAD_EVENT = 'editor:asset-loaders-changed';

export function announceAssetReload(paths: readonly string[]): void {
  if (
    typeof window === 'undefined' ||
    !paths.some((path) => /\.(glb|gltf|png|jpe?g|webp|avif)$/i.test(path))
  )
    return;
  window.dispatchEvent(new CustomEvent(ASSET_RELOAD_EVENT, { detail: { paths } }));
}

export function onAssetReload(listener: (paths: readonly string[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event): void => {
    listener((event as CustomEvent<{ paths: readonly string[] }>).detail?.paths ?? []);
  };
  window.addEventListener(ASSET_RELOAD_EVENT, handler);
  return () => window.removeEventListener(ASSET_RELOAD_EVENT, handler);
}
