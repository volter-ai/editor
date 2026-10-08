/**
 * ENVIRONMENT IMAGES: panoramas a view can light by and draw behind the scene
 * (`PreviewLighting.environment.image`), registered as data by the integration
 * that ships them (a `*.environment.ts` contribution, point `workspace.environment`).
 * A view names an image by id, never by URL: the URL is a built asset's, which a
 * rebuild renames, and a saved view outlives the build that wrote it.
 */

export interface EnvironmentImage {
  readonly id: string;
  readonly title: string;
  /** The image as served: an equirectangular panorama in scene-referred light. */
  readonly url: string;
  readonly format: 'exr' | 'hdr';
}

/** What a `*.environment.ts` contribution exports as `environment`: one integration's images. */
export interface EnvironmentImageSet {
  readonly id: string;
  /** Where the images come from and under what terms, as the shipping integration states it. */
  readonly source: string;
  readonly images: readonly EnvironmentImage[];
}

const images = new Map<string, EnvironmentImage>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Register a set's images; returns the unregister. An id already registered is refused. */
export function registerEnvironmentImages(set: EnvironmentImageSet): () => void {
  for (const image of set.images) {
    if (images.has(image.id)) throw new Error(`registerEnvironmentImages: "${image.id}" is already registered.`);
  }
  for (const image of set.images) images.set(image.id, image);
  changed();
  return () => {
    for (const image of set.images) if (images.get(image.id) === image) images.delete(image.id);
    changed();
  };
}

export function environmentImage(id: string): EnvironmentImage | null {
  return images.get(id) ?? null;
}

export function environmentImages(): readonly EnvironmentImage[] {
  return [...images.values()];
}

export function subscribeEnvironmentImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
