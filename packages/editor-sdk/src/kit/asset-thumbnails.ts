/**
 * ASSET THUMBNAILS BY THE MEDIUM THAT CAN DRAW THEM — a model file's picture is
 * rendered offscreen by the integration that loads that format. The kit's asset
 * browser asks here whether a file has a rendered thumbnail and queues the
 * render; a file no renderer accepts keeps its icon.
 */
export interface AssetThumbnailRenderer {
  accepts(url: string): boolean;
  /** A data URL of the file's picture. */
  render(url: string): Promise<string>;
}

let renderers: readonly AssetThumbnailRenderer[] = [];

export function registerAssetThumbnailRenderer(renderer: AssetThumbnailRenderer): () => void {
  renderers = [...renderers, renderer];
  return () => {
    renderers = renderers.filter((existing) => existing !== renderer);
  };
}

/** The first registered renderer that draws `url`, or null. */
export function assetThumbnailRenderer(url: string): AssetThumbnailRenderer | null {
  return renderers.find((renderer) => renderer.accepts(url)) ?? null;
}
