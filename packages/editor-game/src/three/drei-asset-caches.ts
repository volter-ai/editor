/**
 * drei's parsed-asset caches (`useGLTF`, `useTexture`) outlive a mount. A lane
 * that reloads after project asset bytes change clears the changed paths
 * first, or the next mount is handed the old bytes.
 */
export async function evictDreiCaches(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { useGLTF, useTexture } = await import('@react-three/drei');
  for (const path of paths) {
    useGLTF.clear(path);
    useTexture.clear(path);
  }
}
