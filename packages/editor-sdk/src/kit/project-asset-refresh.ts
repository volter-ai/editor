/** Parsed asset caches outlive R3F mounts. Invalidate before asking a document
 * to reload, so replacing a GLB updates every placement without editing JSX.
 */
export async function evictLoaderCaches(paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  const { useGLTF, useTexture } = await import('@react-three/drei');
  for (const path of paths) {
    useGLTF.clear(path);
    useTexture.clear(path);
  }
}

export function announceAssetReload(paths: readonly string[]): void {
  if (
    typeof window === 'undefined' ||
    !paths.some((path) => /\.(glb|gltf|png|jpe?g|webp|avif)$/i.test(path))
  )
    return;
  window.dispatchEvent(new CustomEvent('editor:asset-loaders-changed'));
}

export function onAssetReload(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('editor:asset-loaders-changed', listener);
  return () => window.removeEventListener('editor:asset-loaders-changed', listener);
}
